// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: Contributors to Dash 2 X
// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

import {
    Clutter,
    Cogl,
    GLib,
    GObject,
    Meta,
    St,
} from './dependencies/gi.js';

import {Main} from './dependencies/shell/ui.js';

import {
    Docking,
    Utils,
    WallpaperColorExtractor,
} from './imports.js';

const {signals: Signals} = imports;

/*
 * DEFAULT:  transparency given by theme
 * FIXED:    constant transparency chosen by user
 * DYNAMIC:  apply 'transparent' style when no windows are close to the dock
 * */
const TransparencyMode = {
    DEFAULT:  0,
    FIXED:    1,
    DYNAMIC:  3,
};

const Labels = Object.freeze({
    TRANSPARENCY: Symbol('transparency'),
    THEME_CHANGED: Symbol('theme-changed'),
    WALLPAPER_COLOR: Symbol('wallpaper-color'),
});

export const PositionStyleClass = Object.freeze([
    'top',
    'right',
    'bottom',
    'left',
]);

/**
 * Manage theme customization and custom theme support
 */
export class ThemeManager {
    constructor(dock) {
        this._signalsHandler = new Utils.GlobalSignalsHandler(this);
        this._bindSettingsChanges();
        this._actor = dock;
        this._dash = dock.dash;

        // initialize colors with generic values
        this._customizedBackground = {red: 0, green: 0, blue: 0, alpha: 0};
        this._customizedBorder = {red: 0, green: 0, blue: 0, alpha: 0};
        this._transparency = new Transparency(dock);

        this._signalsHandler.add([
            // update :overview pseudoclass
            Main.overview,
            'showing',
            this._onOverviewShowing.bind(this),
        ], [
            Main.overview,
            'hiding',
            this._onOverviewHiding.bind(this),
        ]);

        this._signalsHandler.addWithLabel(Labels.THEME_CHANGED,
            St.ThemeContext.get_for_stage(global.stage), 'changed',
            () => this._queueUpdateCustomTheme());

        const maybeUpdateCustomTheme = () => {
            if (this._actor.mapped) {
                this._signalsHandler.unblockWithLabel(Labels.THEME_CHANGED);
                this.updateCustomTheme();
            } else {
                this._signalsHandler.blockWithLabel(Labels.THEME_CHANGED);
            }
        };

        this._signalsHandler.add(this._actor, 'notify::mapped',
            () => maybeUpdateCustomTheme());

        maybeUpdateCustomTheme();

        // Set the initial overview pseudo-class state.
        if (Main.overview.visible)
            this._onOverviewShowing();
        else
            this._onOverviewHiding();

        // Set up wallpaper-adaptive color if enabled
        this._wallpaperExtractor = null;
        this._wallpaperColor = null;
        this._ensureWallpaperExtractor();

        // destroy themeManager when the managed actor is destroyed (e.g. extension unload)
        // in order to disconnect signals
        this._signalsHandler.add(this._actor, 'destroy', () => this.destroy());
    }

    destroy() {
        if (this._updateThemeDebounceId) {
            GLib.source_remove(this._updateThemeDebounceId);
            this._updateThemeDebounceId = 0;
        }
        this.emit('destroy');
        this._destroyWallpaperExtractor();
        this._transparency.destroy();
        this._destroyed = true;
    }

    /**
     * Debounce updateCustomTheme() calls from St.ThemeContext 'changed'.
     * During extension reloads or package updates the theme context can
     * fire 'changed' several times in quick succession; coalescing avoids
     * redundant style recalculations and the resulting visual flash (#2485).
     */
    _queueUpdateCustomTheme() {
        if (this._updateThemeDebounceId)
            return;

        this._updateThemeDebounceId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, 100, () => {
                this._updateThemeDebounceId = 0;
                if (!this._destroyed)
                    this.updateCustomTheme();
                return GLib.SOURCE_REMOVE;
            });
    }

    _onOverviewShowing() {
        this._actor.add_style_pseudo_class('overview');
    }

    _onOverviewHiding() {
        this._actor.remove_style_pseudo_class('overview');
    }

    _updateDashOpacity() {
        const newAlpha = Docking.DockManager.settings.backgroundOpacity;

        const [backgroundColor, borderColor] = this._getDefaultColors();

        if (!backgroundColor)
            return;

        // Get the background and border alphas. We check the background alpha
        // for a minimum of .001 to prevent division by 0 errors
        const backgroundAlpha = Math.max(Math.round(backgroundColor.alpha / 2.55) / 100, .001);
        let borderAlpha = Math.round(borderColor.alpha / 2.55) / 100;

        // The border and background alphas should remain in sync
        // We also limit the borderAlpha to a maximum of 1 (full opacity)
        borderAlpha = Math.min((borderAlpha / backgroundAlpha) * newAlpha, 1);

        this._customizedBackground = `rgba(${
            backgroundColor.red},${
            backgroundColor.green},${
            backgroundColor.blue},${
            newAlpha})`;

        this._customizedBorder = `rgba(${
            borderColor.red},${
            borderColor.green},${
            borderColor.blue},${
            borderAlpha})`;
    }

    _getDefaultColors() {
        // Remove custom style
        const oldStyle = this._dash._background.get_style();
        this._dash._background.set_style(null);

        const themeNode = this._dash._background.get_theme_node();
        this._dash._background.set_style(oldStyle);

        const backgroundColor = themeNode.get_background_color();

        // Just in case the theme has different border colors ..
        // We want to find the inside border-color of the dock because it is
        // the side most visible to the user. We do this by finding the side
        // opposite the position
        const position = Utils.getPosition();
        let side = position + 2;
        if (side > 3)
            side = Math.abs(side - 4);

        const borderColor = themeNode.get_border_color(side);

        return [backgroundColor, borderColor];
    }

    _updateDashColor() {
        // Retrieve the color. If needed we will adjust it before passing it to
        // this._transparency.
        const [backgroundColor] = this._getDefaultColors();

        if (!backgroundColor)
            return;

        const {settings} = Docking.DockManager;

        // Wallpaper-adaptive color takes priority over manual custom color
        const useWallpaperColor = settings.wallpaperAdaptiveColor && this._wallpaperColor;

        if (useWallpaperColor || settings.customBackgroundColor) {
            // When applying a custom color, we need to check the alpha value,
            // if not the opacity will always be overridden by the color below.
            // Note that if using 'dynamic' transparency modes,
            // the opacity will be set by the opaque/transparent styles anyway.
            let newAlpha = Math.round(backgroundColor.alpha / 2.55) / 100;

            let colorString;
            if (useWallpaperColor)
                colorString = this._wallpaperColor;
            else
                ({backgroundColor: colorString} = settings);

            // colorString is a string like rgb(0,0,0) or #rrggbb
            const Color = Clutter.Color ?? Cogl.Color;
            const [ret, color] = Color.from_string(colorString);
            if (!ret) {
                logError(new Error(`${colorString} is not a valid color string`));
                return;
            }

            if (settings.transparencyMode === TransparencyMode.FIXED) {
                newAlpha = settings.backgroundOpacity;
                this._customizedBackground =
                    `rgba(${color.red}, ${color.green}, ${color.blue}, ${newAlpha})`;
            } else {
                this._customizedBackground = colorString;
            }

            this._customizedBorder = this._customizedBackground;

            color.alpha = newAlpha * 255;
            this._transparency.setColor(color);
        } else {
            // backgroundColor is a {Clutter,Cogl}.Color object
            this._transparency.setColor(backgroundColor);
        }
    }

    _updateCustomStyleClasses() {
        const {settings} = Docking.DockManager;

        if (settings.applyCustomTheme)
            this._actor.add_style_class_name('dashtodock');
        else
            this._actor.remove_style_class_name('dashtodock');

        if (settings.customThemeShrink)
            this._actor.add_style_class_name('shrink');
        else
            this._actor.remove_style_class_name('shrink');

        if (settings.runningIndicatorStyle !== 0)
            this._actor.add_style_class_name('running-dots');
        else
            this._actor.remove_style_class_name('running-dots');

        // If not the built-in theme option is not selected
        if (!settings.applyCustomTheme) {
            if (settings.forceStraightCorner)
                this._actor.add_style_class_name('straight-corner');
            else
                this._actor.remove_style_class_name('straight-corner');
        } else {
            this._actor.remove_style_class_name('straight-corner');
        }
    }

    updateCustomTheme() {
        if (this._destroyed)
            throw new Error(`Impossible to update a destroyed ${this.constructor.name}`);
        this._updateCustomStyleClasses();
        this._updateDashOpacity();
        this._updateDashColor();
        this._adjustTheme();
        this.emit('updated');
    }

    /**
     * Reimported back and adapted from atomdock
     */
    _adjustTheme() {
        const {settings} = Docking.DockManager;

        this._transparency.disable();

        // If built-in theme is enabled, just clear any leftover inline style
        if (settings.applyCustomTheme) {
            this._dash._background.set_style(null);
            return;
        }

        // Compute the full new inline style *before* touching the live actor,
        // so there is never a frame where the background has no inline style
        // (which would flash the raw theme default — often white).  (#2485)

        // Read theme-default border properties by temporarily clearing the
        // inline style, querying the theme node, then immediately restoring it.
        const prevStyle = this._dash._background.get_style();
        this._dash._background.set_style(null);
        const themeNode = this._dash._background.get_theme_node();
        const borderColor = themeNode.get_border_color(St.Side.TOP);
        const borderWidth = themeNode.get_border_width(St.Side.TOP);
        // Restore previous style immediately so no unstyled frame is painted.
        this._dash._background.set_style(prevStyle);

        const position = Utils.getPosition(settings);

        // We're copying border and corner styles to left border and top-left
        // corner, also removing bottom border and bottom-right corner styles
        let newStyle = '';

        if (this._rtl && (position !== St.Side.RIGHT)) {
            newStyle = `border-right: ${borderWidth}px solid ${
                borderColor.to_string()};`;
        } else if (!this._rtl && (position !== St.Side.LEFT)) {
            newStyle = `border-left: ${borderWidth}px solid ${
                borderColor.to_string()};`;
        }

        // Apply custom border radius if configured
        const {customBorderRadius} = settings;
        if (customBorderRadius >= 0)
            newStyle = `${newStyle}border-radius: ${customBorderRadius}px; `;

        // Customize background
        const fixedTransparency = settings.transparencyMode === TransparencyMode.FIXED;
        const defaultTransparency = settings.transparencyMode === TransparencyMode.DEFAULT;
        if (!defaultTransparency && !fixedTransparency) {
            // Apply structural style (border, radius) first, then enable
            // dynamic transparency which will set its own background style.
            this._dash._background.set_style(newStyle || null);
            this._transparency.enable();
        } else if (!defaultTransparency || settings.customBackgroundColor) {
            newStyle = `${newStyle}background-color:${this._customizedBackground}; ` +
                       `border-color:${this._customizedBorder}; ` +
                       'transition-delay: 0s; transition-duration: 0.250s;';
            this._dash._background.set_style(newStyle);
        } else {
            // Default transparency, no custom color — apply structural style only.
            this._dash._background.set_style(newStyle || null);
        }
    }

    _bindSettingsChanges() {
        const keys = ['transparency-mode',
            'customize-alphas',
            'min-alpha',
            'max-alpha',
            'background-opacity',
            'custom-background-color',
            'background-color',
            'apply-custom-theme',
            'custom-theme-shrink',
            'custom-theme-running-dots',
            'extend-height',
            'force-straight-corner',
            'custom-border-radius',
            'wallpaper-adaptive-intensity'];

        this._signalsHandler.addWithLabel(Labels.THEME_CHANGED, ...keys.map(key => [
            Docking.DockManager.settings,
            `changed::${key}`,
            () => this.updateCustomTheme(),
        ]));

        // Toggling wallpaper-adaptive-color needs to create/destroy the extractor
        this._signalsHandler.addWithLabel(Labels.THEME_CHANGED,
            Docking.DockManager.settings,
            'changed::wallpaper-adaptive-color',
            () => {
                this._ensureWallpaperExtractor();
                this.updateCustomTheme();
            });
    }

    /**
     * Create or destroy the WallpaperColorExtractor based on the setting.
     */
    _ensureWallpaperExtractor() {
        const {settings} = Docking.DockManager;
        if (settings.wallpaperAdaptiveColor) {
            if (!this._wallpaperExtractor) {
                this._wallpaperExtractor =
                    new WallpaperColorExtractor.WallpaperColorExtractor();
                this._signalsHandler.addWithLabel(Labels.WALLPAPER_COLOR,
                    this._wallpaperExtractor, 'color-changed',
                    (_extractor, color) => {
                        this._wallpaperColor = color;
                        this.updateCustomTheme();
                    });
                // Pick up whatever color the extractor already has
                this._wallpaperColor = this._wallpaperExtractor.color;
            }
        } else {
            this._destroyWallpaperExtractor();
            this._wallpaperColor = null;
        }
    }

    _destroyWallpaperExtractor() {
        if (this._wallpaperExtractor) {
            this._signalsHandler.removeWithLabel(Labels.WALLPAPER_COLOR);
            this._wallpaperExtractor.destroy();
            this._wallpaperExtractor = null;
        }
    }
}
Signals.addSignalMethods(ThemeManager.prototype);

/**
 * The following class is based on the following upstream commit:
 * https://git.gnome.org/browse/gnome-shell/commit/?id=447bf55e45b00426ed908b1b1035f472c2466956
 * Transparency when free-floating
 */
class Transparency {
    constructor(dock) {
        this._dash = dock.dash;
        this._actor = this._dash._container;
        this._backgroundActor = this._dash._background;
        this._dockActor = dock;
        this._dock = dock;
        this._panel = Main.panel;
        this._position = Utils.getPosition();

        // All these properties are replaced with the ones in the .dummy-opaque
        // and .dummy-transparent css classes
        this._backgroundColor = '0,0,0';
        this._transparentAlpha = '0.2';
        this._opaqueAlpha = '1';
        this._transparentAlphaBorder = '0.1';
        this._opaqueAlphaBorder = '0.5';
        this._transparentTransition = '0ms';
        this._opaqueTransition = '0ms';
        this._base_actor_style = '';

        this._signalsHandler = new Utils.GlobalSignalsHandler();
        this._trackedWindows = new Map();
    }

    enable() {
        // ensure I never double-register/inject
        // although it should never happen
        this.disable();

        this._base_actor_style = this._actor.get_style();
        if (!this._base_actor_style)
            this._base_actor_style = '';


        let addedSignal = 'child-added';
        let removedSignal = 'child-removed';

        // for compatibility with Gnome Shell 45
        if (GObject.signal_lookup('actor-added', global.window_group)) {
            addedSignal = 'actor-added';
            removedSignal = 'actor-removed';
        }

        this._signalsHandler.addWithLabel(Labels.TRANSPARENCY, [
            global.window_group,
            addedSignal,
            this._onWindowActorAdded.bind(this),
        ], [
            global.window_group,
            removedSignal,
            this._onWindowActorRemoved.bind(this),
        ], [
            global.window_manager,
            'switch-workspace',
            this._updateSolidStyle.bind(this),
        ], [
            Main.overview,
            'hiding',
            this._updateSolidStyle.bind(this),
        ], [
            Main.overview,
            'showing',
            this._updateSolidStyle.bind(this),
        ]);

        // Window signals
        global.window_group.get_children().filter(child => {
            // An irrelevant window actor ('Gnome-shell') produces an error when the signals are
            // disconnected, therefore do not add signals to it.
            return child instanceof Meta.WindowActor &&
                   child.get_meta_window().get_wm_class() !== 'Gnome-shell';
        }).forEach(function (win) {
            this._onWindowActorAdded(null, win);
        }, this);

        if (this._actor.get_stage())
            this._updateSolidStyle();

        this._updateStyles();
        this._updateSolidStyle();

        this.emit('transparency-enabled');
    }

    disable() {
        // ensure I never double-register/inject
        // although it should never happen
        this._signalsHandler.removeWithLabel(Labels.TRANSPARENCY);

        for (const key of this._trackedWindows.keys()) {
            this._trackedWindows.get(key).forEach(id => {
                key.disconnect(id);
            });
        }
        this._trackedWindows.clear();

        this.emit('transparency-disabled');
    }

    destroy() {
        this.disable();
        if (this._solidStyleUpdateId) {
            GLib.source_remove(this._solidStyleUpdateId);
            this._solidStyleUpdateId = 0;
        }
        this._signalsHandler.destroy();
    }

    _onWindowActorAdded(container, metaWindowActor) {
        const signalIds = [];
        ['notify::allocation', 'notify::visible'].forEach(s => {
            signalIds.push(metaWindowActor.connect(s, this._updateSolidStyle.bind(this)));
        });
        this._trackedWindows.set(metaWindowActor, signalIds);
    }

    _onWindowActorRemoved(container, metaWindowActor) {
        if (!this._trackedWindows.get(metaWindowActor))
            return;

        this._trackedWindows.get(metaWindowActor).forEach(id => {
            metaWindowActor.disconnect(id);
        });
        this._trackedWindows.delete(metaWindowActor);
        this._updateSolidStyle();
    }

    _updateSolidStyle() {
        // Debounce: rapid window allocation changes (e.g. from wallpaper
        // changers like Variety) can fire hundreds of notify::allocation
        // signals per second.  Coalesce them into a single idle callback
        // to avoid overwhelming the compositor's style/layout pipeline,
        // which could freeze or crash the GUI (#111).
        if (this._solidStyleUpdateId)
            return;

        this._solidStyleUpdateId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._solidStyleUpdateId = 0;

            if (!this._dockActor?.get_stage())
                return GLib.SOURCE_REMOVE;

            const isNear = this._dockIsNear();
            if (isNear) {
                this._backgroundActor.set_style(this._opaque_style);
                this._dockActor.remove_style_class_name('transparent');
                this._dockActor.add_style_class_name('opaque');
            } else {
                this._backgroundActor.set_style(this._transparent_style);
                this._dockActor.remove_style_class_name('opaque');
                this._dockActor.add_style_class_name('transparent');
            }

            this.emit('solid-style-updated', isNear);
            return GLib.SOURCE_REMOVE;
        });
    }

    _dockIsNear() {
        if (this._dockActor.has_style_pseudo_class('overview'))
            return false;
        /* Get all the windows in the active workspace that are in the primary monitor and visible */
        const activeWorkspace = global.workspace_manager.get_active_workspace();
        const dash = this._dash;
        const windows = activeWorkspace.list_windows().filter(metaWindow => {
            return metaWindow.get_monitor() === dash._monitorIndex &&
                   metaWindow.showing_on_its_workspace() &&
                   metaWindow.get_window_type() !== Meta.WindowType.DESKTOP &&
                   !metaWindow.skip_taskbar;
        });

        /* Check if at least one window is near enough to the panel.
         * If the dock is hidden, we need to account for the space it would take
         * up when it slides out. This is avoid an ugly transition.
         * */
        let factor = 0;
        if (!Docking.DockManager.settings.dockFixed &&
            this._dock.getDockState() === Docking.State.HIDDEN)
            factor = 1;
        const [leftCoord, topCoord] = this._actor.get_transformed_position();
        let threshold;
        if (this._position === St.Side.LEFT)
            threshold = leftCoord + this._actor.get_width() * (factor + 1);
        else if (this._position === St.Side.RIGHT)
            threshold = leftCoord - this._actor.get_width() * factor;
        else if (this._position === St.Side.TOP)
            threshold = topCoord + this._actor.get_height() * (factor + 1);
        else
            threshold = topCoord - this._actor.get_height() * factor;

        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const isNearEnough = windows.some(metaWindow => {
            let coord;
            if (this._position === St.Side.LEFT) {
                coord = metaWindow.get_frame_rect().x;
                return coord < threshold + 5 * scale;
            } else if (this._position === St.Side.RIGHT) {
                coord = metaWindow.get_frame_rect().x + metaWindow.get_frame_rect().width;
                return coord > threshold - 5 * scale;
            } else if (this._position === St.Side.TOP) {
                coord = metaWindow.get_frame_rect().y;
                return coord < threshold + 5 * scale;
            } else {
                coord = metaWindow.get_frame_rect().y + metaWindow.get_frame_rect().height;
                return coord > threshold - 5 * scale;
            }
        });

        return isNearEnough;
    }

    _updateStyles() {
        this._getAlphas();

        this._transparent_style = `${this._base_actor_style
        }background-color: rgba(${
            this._backgroundColor}, ${this._transparentAlpha});` +
            `border-color: rgba(${
                this._backgroundColor}, ${this._transparentAlphaBorder});` +
            `transition-duration: ${this._transparentTransition}ms;`;

        this._opaque_style = `${this._base_actor_style
        }background-color: rgba(${
            this._backgroundColor}, ${this._opaqueAlpha});` +
            `border-color: rgba(${
                this._backgroundColor},${this._opaqueAlphaBorder});` +
            `transition-duration: ${this._opaqueTransition}ms;`;

        this.emit('styles-updated');
    }

    setColor(color) {
        this._backgroundColor = `${color.red},${color.green},${color.blue}`;
        this._updateStyles();
    }

    _getAlphas() {
        // Create dummy object and add to the uiGroup to get it to the stage
        const dummyObject = new St.Bin({
            name: 'dashtodockContainer',
        });
        Main.uiGroup.add_child(dummyObject);

        dummyObject.add_style_class_name('dummy-opaque');
        let themeNode = dummyObject.get_theme_node();
        this._opaqueAlpha = themeNode.get_background_color().alpha / 255;
        this._opaqueAlphaBorder = themeNode.get_border_color(0).alpha / 255;
        this._opaqueTransition = themeNode.get_transition_duration();

        dummyObject.add_style_class_name('dummy-transparent');
        themeNode = dummyObject.get_theme_node();
        this._transparentAlpha = themeNode.get_background_color().alpha / 255;
        this._transparentAlphaBorder = themeNode.get_border_color(0).alpha / 255;
        this._transparentTransition = themeNode.get_transition_duration();

        Main.uiGroup.remove_child(dummyObject);

        const {settings} = Docking.DockManager;

        if (settings.customizeAlphas) {
            this._opaqueAlpha = settings.maxAlpha;
            this._opaqueAlphaBorder = this._opaqueAlpha / 2;
            this._transparentAlpha = settings.minAlpha;
            this._transparentAlphaBorder = this._transparentAlpha / 2;
        }
    }
}
Signals.addSignalMethods(Transparency.prototype);
