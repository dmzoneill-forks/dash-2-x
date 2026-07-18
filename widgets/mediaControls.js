// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: Contributors to XDock
// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

import {
    Clutter,
    GLib,
    GObject,
    Pango,
    St,
} from '../dependencies/gi.js';

import {
    Main,
} from '../dependencies/shell/ui.js';

import {
    Docking,
    Utils,
} from '../imports.js';

const HOVER_SHOW_DELAY = 300;
const HOVER_HIDE_DELAY = 300;

/**
 * A lightweight overlay that shows media transport controls (previous,
 * play/pause, next) and a track title, anchored to a dock icon.
 */
export const MediaControlsOverlay = GObject.registerClass(
class MediaControlsOverlay extends St.BoxLayout {
    _init(sourceIcon) {
        super._init({
            style_class: 'media-controls-popup',
            vertical: false,
            reactive: true,
            track_hover: true,
            visible: false,
            opacity: 0,
        });

        this._source = sourceIcon;
        this._signalsHandler = new Utils.GlobalSignalsHandler(this);
        this._showTimeoutId = 0;
        this._hideTimeoutId = 0;

        // Previous button
        this._prevButton = new St.Button({
            style_class: 'media-controls-button',
            child: new St.Icon({
                icon_name: 'media-skip-backward-symbolic',
                icon_size: 16,
            }),
        });
        this._prevButton.connect('clicked', () => {
            const appId = this._source.app?.id;
            if (appId)
                Docking.DockManager.getDefault().mprisMonitor?.previous(appId);
        });

        // Play/Pause button
        this._playPauseButton = new St.Button({
            style_class: 'media-controls-button',
            child: new St.Icon({
                icon_name: 'media-playback-start-symbolic',
                icon_size: 16,
            }),
        });
        this._playPauseButton.connect('clicked', () => {
            const appId = this._source.app?.id;
            if (appId)
                Docking.DockManager.getDefault().mprisMonitor?.playPause(appId);
        });

        // Next button
        this._nextButton = new St.Button({
            style_class: 'media-controls-button',
            child: new St.Icon({
                icon_name: 'media-skip-forward-symbolic',
                icon_size: 16,
            }),
        });
        this._nextButton.connect('clicked', () => {
            const appId = this._source.app?.id;
            if (appId)
                Docking.DockManager.getDefault().mprisMonitor?.next(appId);
        });

        // Track title label
        this._titleLabel = new St.Label({
            style_class: 'media-controls-title',
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;

        this.add_child(this._prevButton);
        this.add_child(this._playPauseButton);
        this.add_child(this._nextButton);
        this.add_child(this._titleLabel);

        Main.uiGroup.add_child(this);

        // Hover management on the overlay itself
        this._signalsHandler.add(this, 'enter-event', () => this._onOverlayEnter());
        this._signalsHandler.add(this, 'leave-event', () => this._onOverlayLeave());

        this.connect('destroy', () => this._onDestroy());
    }

    /**
     * Update the overlay content to reflect current player state.
     *
     * @param {object|null} playerInfo - from MprisMonitor.getPlayerForApp()
     */
    updateState(playerInfo) {
        if (!playerInfo) {
            this.scheduleHide();
            return;
        }

        // Update play/pause icon
        const iconName = playerInfo.status === 'Playing'
            ? 'media-playback-pause-symbolic'
            : 'media-playback-start-symbolic';
        this._playPauseButton.child.icon_name = iconName;

        // Update button sensitivity
        this._prevButton.reactive = playerInfo.canGoPrevious;
        this._prevButton.opacity = playerInfo.canGoPrevious ? 255 : 128;
        this._nextButton.reactive = playerInfo.canGoNext;
        this._nextButton.opacity = playerInfo.canGoNext ? 255 : 128;

        // Update track title
        let titleText = playerInfo.title || '';
        if (playerInfo.artist)
            titleText = `${playerInfo.artist} - ${titleText}`;
        this._titleLabel.text = titleText;
        this._titleLabel.visible = !!titleText;
    }

    /**
     * Schedule showing the overlay after a short delay.
     */
    scheduleShow() {
        this._cancelHide();
        if (this.visible)
            return;

        if (this._showTimeoutId)
            return;

        this._showTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, HOVER_SHOW_DELAY, () => {
                this._showTimeoutId = 0;
                this._showOverlay();
                return GLib.SOURCE_REMOVE;
            });
    }

    /**
     * Schedule hiding the overlay after a short delay.
     */
    scheduleHide() {
        this._cancelShow();
        if (!this.visible)
            return;

        if (this._hideTimeoutId)
            return;

        this._hideTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, HOVER_HIDE_DELAY, () => {
                this._hideTimeoutId = 0;
                this._hideOverlay();
                return GLib.SOURCE_REMOVE;
            });
    }

    /**
     * Force immediate hide without delay.
     */
    forceHide() {
        this._cancelShow();
        this._cancelHide();
        this._hideOverlay();
    }

    _showOverlay() {
        if (!this._source.get_stage())
            return;

        this._updatePosition();
        this.show();
        this.remove_all_transitions();
        this.ease({
            opacity: 255,
            duration: 150,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _hideOverlay() {
        this.remove_all_transitions();
        this.ease({
            opacity: 0,
            duration: 150,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => this.hide(),
        });
    }

    _updatePosition() {
        if (!this._source.get_stage())
            return;

        const [stageX, stageY] = this._source.get_transformed_position();
        const [sourceW, sourceH] = this._source.get_transformed_size();
        const [overlayW, overlayH] = this.get_preferred_size().slice(2);

        const position = Utils.getPosition();
        const monitor = Main.layoutManager.findMonitorForActor(this._source);
        if (!monitor)
            return;

        let x, y;

        switch (position) {
        case St.Side.BOTTOM:
            // Show above the icon
            x = stageX + (sourceW - overlayW) / 2;
            y = stageY - overlayH - 4;
            break;
        case St.Side.TOP:
            // Show below the icon
            x = stageX + (sourceW - overlayW) / 2;
            y = stageY + sourceH + 4;
            break;
        case St.Side.LEFT:
            // Show to the right of the icon
            x = stageX + sourceW + 4;
            y = stageY + (sourceH - overlayH) / 2;
            break;
        case St.Side.RIGHT:
            // Show to the left of the icon
            x = stageX - overlayW - 4;
            y = stageY + (sourceH - overlayH) / 2;
            break;
        default:
            x = stageX + (sourceW - overlayW) / 2;
            y = stageY - overlayH - 4;
        }

        // Clamp to monitor bounds
        x = Math.max(monitor.x + 2, Math.min(x, monitor.x + monitor.width - overlayW - 2));
        y = Math.max(monitor.y + 2, Math.min(y, monitor.y + monitor.height - overlayH - 2));

        this.set_position(Math.round(x), Math.round(y));
    }

    _onOverlayEnter() {
        this._cancelHide();
    }

    _onOverlayLeave() {
        // Check if we moved back to the source icon
        if (this._source.has_pointer)
            return;

        this.scheduleHide();
    }

    _cancelShow() {
        if (this._showTimeoutId) {
            GLib.source_remove(this._showTimeoutId);
            this._showTimeoutId = 0;
        }
    }

    _cancelHide() {
        if (this._hideTimeoutId) {
            GLib.source_remove(this._hideTimeoutId);
            this._hideTimeoutId = 0;
        }
    }

    _onDestroy() {
        this._signalsHandler?.destroy();
        this._cancelShow();
        this._cancelHide();
    }
});
