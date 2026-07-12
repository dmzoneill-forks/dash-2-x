// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: Contributors to XDock
import {
    Clutter,
    Pango,
    St,
} from '../dependencies/gi.js';

import {Main} from '../dependencies/shell/ui.js';

import {
    Docking,
    Utils,
} from '../imports.js';

const {cairo: Cairo} = imports;

import {IndicatorBase} from './base.js';
import {ProgressArcDrawingArea} from './progress.js';

/**
 * Get the badge override configuration for a specific app.
 *
 * @param {string} appId - The application ID
 * @returns {object|null} - The override config or null if none set
 */
export function getBadgeOverride(appId) {
    const {settings} = Docking.DockManager;
    const overridesStr = settings.get_string('badge-overrides');
    if (!overridesStr)
        return null;

    try {
        const overrides = JSON.parse(overridesStr);
        return overrides[appId] ?? null;
    } catch {
        return null;
    }
}

/**
 * Set the badge override configuration for a specific app.
 *
 * @param {string} appId - The application ID
 * @param {object} config - The override config ({enabled, source})
 */
export function setBadgeOverride(appId, config) {
    const {settings} = Docking.DockManager;
    const overridesStr = settings.get_string('badge-overrides');
    let overrides = {};

    if (overridesStr) {
        try {
            overrides = JSON.parse(overridesStr);
        } catch {
            overrides = {};
        }
    }

    // If config matches defaults, remove the entry
    if (config.enabled !== false && (!config.source || config.source === 'auto'))
        delete overrides[appId];
    else
        overrides[appId] = config;

    const newStr = Object.keys(overrides).length > 0
        ? JSON.stringify(overrides) : '';
    settings.set_string('badge-overrides', newStr);
}

/*
 * Unity like notification and progress indicators
 */
export class UnityIndicator extends IndicatorBase {
    static defaultProgressBar = {
        // default values for the progress bar itself
        background: {
            colorStart: {red: 204, green: 204, blue: 204, alpha: 255},
            colorEnd: null,
        },
        border: {
            colorStart: {red: 230, green: 230, blue: 230, alpha: 255},
            colorEnd: null,
        },
    };

    static defaultProgressBarTrack = {
        // default values for the progress bar track
        background: {
            colorStart: {red: 64, green: 64, blue: 64, alpha: 255},
            colorEnd: {red: 89, green: 89, blue: 89, alpha: 255},
            offsetStart: 0.4,
            offsetEnd: 0.9,
        },
        border: {
            colorStart: {red: 128, green: 128, blue: 128, alpha: 26},
            colorEnd: {red: 204, green: 204, blue: 204, alpha: 102},
            offsetStart: 0.5,
            offsetEnd: 0.9,
        },
    };

    static notificationBadgeSignals = Symbol('notification-badge-signals');

    constructor(source) {
        super(source);

        const {remoteModel, notificationsMonitor} = Docking.DockManager.getDefault() ?? {};
        const remoteEntry = remoteModel?.lookupById(this._source.app.id);
        this._remoteEntry = remoteEntry;

        this._signalsHandler.add([
            remoteEntry,
            ['count-changed', 'count-visible-changed'],
            () => this._updateNotificationsCount(),
        ], [
            remoteEntry,
            ['progress-changed', 'progress-visible-changed'],
            (sender, {progress, progress_visible: progressVisible}) =>
                this.setProgress(progressVisible ? progress : -1),
        ], [
            remoteEntry,
            'urgent-changed',
            (sender, {urgent}) => this.setUrgent(urgent),
        ], [
            remoteEntry,
            'updating-changed',
            (sender, {updating}) => this.setUpdating(updating),
        ], [
            notificationsMonitor,
            'changed',
            () => this._updateNotificationsCount(),
        ], [
            this._source,
            'style-changed',
            () => this._updateIconStyle(),
        ], [
            Docking.DockManager.settings,
            'changed::progress-indicator-style',
            () => this._onProgressStyleChanged(),
        ]);

        this._updateNotificationsCount();
        this.setProgress(this._remoteEntry.progress_visible
            ? this._remoteEntry.progress : -1);
        this.setUrgent(this._remoteEntry.urgent);
        this.setUpdating(this._remoteEntry.updating);
    }

    destroy() {
        this._notificationBadgeBin?.destroy();
        this._notificationBadgeBin = null;
        this._hideProgressOverlay();
        this._hideProgressArc();
        this.setUrgent(false);
        this.setUpdating(false);
        this._remoteEntry = null;

        super.destroy();
    }

    _updateNotificationBadgeStyle() {
        // ThemeContext here is for font metrics, not monitor-specific scale.
        const themeContext = St.ThemeContext.get_for_stage(global.stage);
        const fontDesc = themeContext.get_font();
        const defaultFontSize = fontDesc.get_size() / 1024;
        let fontSize = defaultFontSize * 0.9;
        const {iconSize} = Main.overview.dash;
        const defaultIconSize = Docking.DockManager.settings.get_default_value(
            'dash-max-icon-size').unpack();

        if (!fontDesc.get_size_is_absolute()) {
            // fontSize was expressed in points, so convert to pixel
            fontSize /= 0.75;
        }

        let sizeMultiplier;
        if (iconSize < defaultIconSize) {
            sizeMultiplier = Math.max(24, Math.min(iconSize +
                iconSize * 0.3, defaultIconSize)) / defaultIconSize;
        } else {
            sizeMultiplier = iconSize / defaultIconSize;
        }

        fontSize = Math.round(sizeMultiplier * fontSize);
        const leftMargin = Math.round(sizeMultiplier * 3);

        this._notificationBadgeBin.child.set_style(
            `font-size: ${fontSize}px;` +
            `margin-left: ${leftMargin}px`
        );
    }

    _notificationBadgeCountToText(count) {
        if (count <= 9999) {
            return count.toString();
        } else if (count < 1e5) {
            const thousands = count / 1e3;
            return `${thousands.toFixed(1).toString()}k`;
        } else if (count < 1e6) {
            const thousands = count / 1e3;
            return `${thousands.toFixed(0).toString()}k`;
        } else if (count < 1e8) {
            const millions = count / 1e6;
            return `${millions.toFixed(1).toString()}M`;
        } else if (count < 1e9) {
            const millions = count / 1e6;
            return `${millions.toFixed(0).toString()}M`;
        } else {
            const billions = count / 1e9;
            return `${billions.toFixed(1).toString()}B`;
        }
    }

    _updateNotificationsCount() {
        const appId = this._source.app?.id;
        const badgeOverride = appId ? getBadgeOverride(appId) : null;

        // If badge is explicitly disabled via per-app override, show nothing
        if (badgeOverride &&
            (badgeOverride.enabled === false || badgeOverride.source === 'none')) {
            this.setNotificationCount(0);
            return;
        }

        const badgeSource = badgeOverride?.source ?? 'auto';

        const remoteCount = this._remoteEntry['count-visible']
            ? this._remoteEntry.count ?? 0 : 0;

        // Per-app source override
        if (badgeSource === 'app-counter') {
            this.setNotificationCount(remoteCount);
            return;
        }

        const {notificationsMonitor} = Docking.DockManager.getDefault() ?? {};
        const notificationsCount = notificationsMonitor?.getAppNotificationsCount(
            this._source.app.id) ?? 0;

        if (badgeSource === 'notifications') {
            this.setNotificationCount(notificationsCount);
            return;
        }

        // Default 'auto' behavior — same as original logic
        if (remoteCount > 0 &&
            Docking.DockManager.settings.applicationCounterOverridesNotifications) {
            this.setNotificationCount(remoteCount);
            return;
        }

        this.setNotificationCount(remoteCount + notificationsCount);
    }

    _updateNotificationsBadge(text) {
        if (this._notificationBadgeBin) {
            this._notificationBadgeBin.child.text = text;
            return;
        }

        this._notificationBadgeBin = new St.Bin({
            child: new St.Label({
                styleClass: 'notification-badge',
                text,
            }),
            xAlign: Clutter.ActorAlign.END,
            yAlign: Clutter.ActorAlign.START,
            xExpand: true,
            yExpand: true,
        });
        this._notificationBadgeBin.child.clutterText.ellipsize =
            Pango.EllipsizeMode.MIDDLE;

        this._source._iconContainer.add_child(this._notificationBadgeBin);
        this._updateNotificationBadgeStyle();

        // ThemeContext used for signal connections; not monitor-specific.
        const themeContext = St.ThemeContext.get_for_stage(global.stage);
        this._signalsHandler.addWithLabel(UnityIndicator.notificationBadgeSignals, [
            themeContext,
            'changed',
            () => this._updateNotificationBadgeStyle(),
        ], [
            themeContext,
            'notify::scale-factor',
            () => this._updateNotificationBadgeStyle(),
        ], [
            this._source._iconContainer,
            'notify::size',
            () => this._updateNotificationBadgeStyle(),
        ]);
    }

    setNotificationCount(count) {
        if (count > 0) {
            const text = this._notificationBadgeCountToText(count);
            this._updateNotificationsBadge(text);
        } else if (this._notificationBadgeBin) {
            this._signalsHandler.removeWithLabel(UnityIndicator.notificationBadgeSignals);
            this._notificationBadgeBin.destroy();
            this._notificationBadgeBin = null;
        }
    }

    _showProgressOverlay() {
        if (this._progressOverlayArea) {
            this._updateProgressOverlay();
            return;
        }

        this._progressOverlayArea = new St.DrawingArea({x_expand: true, y_expand: true});
        this._progressOverlayArea.add_style_class_name('progress-bar');
        this._progressOverlayArea.connect('repaint', () => {
            this._drawProgressOverlay(this._progressOverlayArea);
        });

        this._source._iconContainer.add_child(this._progressOverlayArea);
        this._updateProgressOverlay();
    }

    _hideProgressOverlay() {
        this._progressOverlayArea?.destroy();
        this._progressOverlayArea = null;
    }

    _updateProgressOverlay() {
        this._progressOverlayArea?.queue_repaint();
    }

    _readGradientData(node, elementName, defaultValues) {
        const output = {
            colorStart: defaultValues.colorStart,
            colorEnd: defaultValues.colorEnd,
            offsetStart: defaultValues.offsetStart ?? 0.0,
            offsetEnd: defaultValues.offsetEnd ?? 1.0,
        };

        const [hasElementName, elementNameValue] = node.lookup_color(elementName, false);
        if (hasElementName) {
            output.colorStart = elementNameValue;
            output.colorEnd = null;
        } else {
            const [hasColorStart, colorStartValue] = node.lookup_color(`${elementName}-color-start`, false);
            const [hasColorEnd, colorEndValue] = node.lookup_color(`${elementName}-color-end`, false);
            if (hasColorStart && hasColorEnd) {
                output.colorStart = colorStartValue;
                output.colorEnd = colorEndValue;
            }
        }

        const [hasOffsetStart, offsetStartValue] = node.lookup_color(`${elementName}-offset-start`, false);
        if (hasOffsetStart)
            output.offsetStart = offsetStartValue;

        const [hasOffsetEnd, offsetEndValue] = node.lookup_color(`${elementName}-offset-end`, false);
        if (hasOffsetEnd)
            output.offsetEnd = offsetEndValue;

        return output;
    }

    _readThemeDoubleValue(node, elementName, defaultValue) {
        const [hasValue, value] = node.lookup_double(elementName, false);
        return hasValue ? value : defaultValue;
    }

    _readElementData(node, elementName, defaultValues) {
        return {
            background: this._readGradientData(node, `${elementName}-background`, defaultValues.background),
            border: this._readGradientData(node, `${elementName}-border`, defaultValues.border),
            lineWidth: this._readThemeDoubleValue(node, `${elementName}-line-width`,
                defaultValues.lineWidth ?? 1.0),
        };
    }

    _createGradient(values, x0, y0, x1, y1) {
        if (values.colorEnd) {
            const gradient = new Cairo.LinearGradient(x0, y0, x1, y1);
            gradient.addColorStopRGBA(values.offsetStart,
                values.colorStart.red / 255,
                values.colorStart.green / 255,
                values.colorStart.blue / 255,
                values.colorStart.alpha / 255);
            gradient.addColorStopRGBA(values.offsetEnd,
                values.colorEnd.red / 255,
                values.colorEnd.green / 255,
                values.colorEnd.blue / 255,
                values.colorEnd.alpha / 255);
            return gradient;
        } else {
            const gradient = Cairo.SolidPattern.createRGBA(values.colorStart.red / 255,
                values.colorStart.green / 255,
                values.colorStart.blue / 255,
                values.colorStart.alpha / 255);
            return gradient;
        }
    }

    _drawProgressOverlay(area) {
        // NOTE: global scaleFactor; per-monitor scale not yet used here.
        const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);
        const [surfaceWidth, surfaceHeight] = area.get_surface_size();
        const cr = area.get_context();
        const node = this._progressOverlayArea.get_theme_node();
        const iconSize = this._source.icon.iconSize * scaleFactor;

        let x = Math.floor((surfaceWidth - iconSize) / 2);
        let y = Math.floor((surfaceHeight - iconSize) / 2);

        const readThemeValue = element =>
            this._readThemeDoubleValue(node, `-progress-bar-${element}`);

        y = readThemeValue('top-offset') ?? y;

        const baseLineWidth = Math.floor(Number(scaleFactor));
        const horizontalPadding = iconSize *
            Utils.clampDouble(readThemeValue('horizontal-padding') ?? 0.05);
        const verticalPadding = iconSize *
            Utils.clampDouble(readThemeValue('vertical-padding') ?? 0.05);
        const heightFactor =
            Utils.clampDouble(readThemeValue('height-factor') ?? 0.20);

        let width = iconSize - 2.0 * horizontalPadding;
        let height = Math.floor(Math.min(18.0 * scaleFactor, heightFactor * iconSize));
        x += horizontalPadding;

        const valign = Utils.clampDouble(readThemeValue('valign') ?? 1);
        y += (iconSize - height - verticalPadding) * valign;

        const progressBarTrack = this._readElementData(node,
            '-progress-bar-track',
            UnityIndicator.defaultProgressBarTrack);

        const progressBar = this._readElementData(node,
            '-progress-bar',
            UnityIndicator.defaultProgressBar);

        // Draw the track
        let lineWidth = baseLineWidth * progressBarTrack.lineWidth;
        cr.setLineWidth(lineWidth);

        x += lineWidth;
        y += lineWidth;
        width -= 2.0 * lineWidth;
        height -= 2.0 * lineWidth;

        let fill = this._createGradient(progressBarTrack.background, 0, y, 0, y + height);
        let stroke = this._createGradient(progressBarTrack.border, 0, y, 0, y + height);
        Utils.drawRoundedLine(cr, x + lineWidth / 2.0,
            y + lineWidth / 2.0, width, height, true, true, stroke, fill);

        // Draw the finished bar
        lineWidth = baseLineWidth * progressBar.lineWidth;
        cr.setLineWidth(lineWidth);

        x += lineWidth;
        y += lineWidth;
        width -= 2.0 * lineWidth;
        height -= 2.0 * lineWidth;

        const finishedWidth = Math.ceil(this._progress * width);
        fill = this._createGradient(progressBar.background, 0, y, 0, y + height);
        stroke = this._createGradient(progressBar.border, 0, y, 0, y + height);

        if (Clutter.get_default_text_direction() === Clutter.TextDirection.RTL) {
            Utils.drawRoundedLine(cr,
                x + lineWidth / 2.0 + width - finishedWidth, y + lineWidth / 2.0,
                finishedWidth, height, true, true, stroke, fill);
        } else {
            Utils.drawRoundedLine(cr, x + lineWidth / 2.0, y + lineWidth / 2.0,
                finishedWidth, height, true, true, stroke, fill);
        }

        cr.$dispose();
    }

    _isArcStyle() {
        return Docking.DockManager.settings.progressIndicatorStyle === 'arc';
    }

    _showProgressArc() {
        if (this._progressArcArea) {
            this._progressArcArea.progress = this._progress;
            return;
        }

        this._progressArcArea = new ProgressArcDrawingArea();
        this._progressArcArea.progress = this._progress;
        this._source._iconContainer.add_child(this._progressArcArea);
    }

    _hideProgressArc() {
        this._progressArcArea?.destroy();
        this._progressArcArea = null;
    }

    _onProgressStyleChanged() {
        if (this._progress === undefined || this._progress < 0)
            return;

        // Switching styles: tear down the old one and show the new one
        if (this._isArcStyle()) {
            this._hideProgressOverlay();
            this._showProgressArc();
        } else {
            this._hideProgressArc();
            this._showProgressOverlay();
        }
    }

    setProgress(progress) {
        if (progress < 0) {
            this._hideProgressOverlay();
            this._hideProgressArc();
        } else {
            this._progress = Math.min(progress, 1.0);
            if (this._isArcStyle()) {
                this._hideProgressOverlay();
                this._showProgressArc();
            } else {
                this._hideProgressArc();
                this._showProgressOverlay();
            }
        }
    }

    setUrgent(urgent) {
        if (urgent || this._isUrgent !== undefined)
            this._source.urgent = urgent;

        if (urgent)
            this._isUrgent = urgent;
        else
            delete this._isUrgent;
    }

    setUpdating(updating) {
        this._source.updating = updating;
    }

    _updateIconStyle() {
        const opacity = this._readThemeDoubleValue(this._source.get_theme_node(),
            'opacity') ?? (this._source.updating ? 0.5 : 1);
        this._source.icon.set_opacity(255 * opacity);
    }
}
