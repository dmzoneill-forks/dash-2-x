// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: Contributors to Dash 2 X

import {
    Clutter,
    Gio,
    GLib,
    GObject,
    St,
} from './dependencies/gi.js';

import {
    Main,
} from './dependencies/shell/ui.js';

import {
    Utils,
} from './imports.js';

const {Gvc} = imports.gi;

const BRIGHTNESS_BUS_NAME = 'org.gnome.SettingsDaemon.Power';
const BRIGHTNESS_OBJECT_PATH = '/org/gnome/SettingsDaemon/Power';
const BRIGHTNESS_IFACE = `
<node>
  <interface name="org.gnome.SettingsDaemon.Power.Screen">
    <property name="Brightness" type="i" access="readwrite"/>
  </interface>
</node>`;

/**
 * A toggle-switch widget: a pill-shaped button that slides between
 * on and off states.
 */
const ToggleSwitch = GObject.registerClass({
    Properties: {
        'active': GObject.ParamSpec.boolean(
            'active', 'active', 'active',
            GObject.ParamFlags.READWRITE, false),
    },
    Signals: {
        'toggled': {},
    },
}, class QuickSettingsToggleSwitch extends St.Button {
    _init(active = false) {
        super._init({
            style_class: 'quick-settings-toggle',
            toggle_mode: true,
            can_focus: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
            checked: active,
        });

        this._handle = new St.Widget({
            style_class: 'quick-settings-toggle-handle',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.set_child(this._handle);

        this.connect('notify::checked', () => {
            this.active = this.checked;
            this._updateStyle();
            this.emit('toggled');
        });

        this.active = active;
        this._updateStyle();
    }

    _updateStyle() {
        if (this.checked)
            this.add_style_pseudo_class('checked');
        else
            this.remove_style_pseudo_class('checked');
    }
});

/**
 * A single toggle row: icon + label + toggle switch.
 */
const ToggleRow = GObject.registerClass(
class QuickSettingsToggleRow extends St.BoxLayout {
    _init(iconName, label, active = false) {
        super._init({
            style_class: 'quick-settings-row',
            reactive: true,
            track_hover: true,
            x_expand: true,
        });

        this._icon = new St.Icon({
            icon_name: iconName,
            style_class: 'quick-settings-icon',
        });
        this.add_child(this._icon);

        this._label = new St.Label({
            text: label,
            style_class: 'quick-settings-label',
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        this.add_child(this._label);

        this._toggle = new ToggleSwitch(active);
        this.add_child(this._toggle);

        // Clicking the whole row toggles the switch
        this.connect('button-release-event', () => {
            this._toggle.checked = !this._toggle.checked;
            return Clutter.EVENT_STOP;
        });
    }

    get toggle() {
        return this._toggle;
    }
});

/**
 * A slider row: icon + slider.
 */
const SliderRow = GObject.registerClass({
    Signals: {
        'value-changed': {param_types: [GObject.TYPE_DOUBLE]},
    },
}, class QuickSettingsSliderRow extends St.BoxLayout {
    _init(iconName, initialValue = 0.5) {
        super._init({
            style_class: 'quick-settings-row',
            x_expand: true,
        });

        this._icon = new St.Icon({
            icon_name: iconName,
            style_class: 'quick-settings-icon',
        });
        this.add_child(this._icon);

        this._slider = new St.Slider(initialValue);
        this._slider.add_style_class_name('quick-settings-slider');
        this._slider.x_expand = true;
        this._slider.y_align = Clutter.ActorAlign.CENTER;
        this.add_child(this._slider);

        this._slider.connect('notify::value', () => {
            this.emit('value-changed', this._slider.value);
        });
    }

    get value() {
        return this._slider.value;
    }

    set value(v) {
        this._slider.value = v;
    }
});

/**
 * The Quick Settings panel that pops out from the dock.
 */
export const QuickSettingsPanel = GObject.registerClass(
class QuickSettingsPanel extends St.BoxLayout {
    _init(sourceActor) {
        super._init({
            style_class: 'quick-settings-panel',
            vertical: true,
            reactive: true,
            track_hover: true,
            visible: false,
        });

        this._sourceActor = sourceActor;
        this._signalsHandler = new Utils.GlobalSignalsHandler(this);
        this._isOpen = false;

        // --- Dark Mode ---
        this._interfaceSettings = new Gio.Settings({
            schema_id: 'org.gnome.desktop.interface',
        });

        const isDarkMode = this._interfaceSettings.get_string('color-scheme') === 'prefer-dark';
        this._darkModeRow = new ToggleRow(
            'weather-clear-night-symbolic', 'Dark Mode', isDarkMode);
        this.add_child(this._darkModeRow);

        this._darkModeRow.toggle.connect('toggled', () => {
            const scheme = this._darkModeRow.toggle.active ? 'prefer-dark' : 'default';
            this._interfaceSettings.set_string('color-scheme', scheme);
        });

        this._signalsHandler.add(this._interfaceSettings, 'changed::color-scheme', () => {
            const active = this._interfaceSettings.get_string('color-scheme') === 'prefer-dark';
            if (this._darkModeRow.toggle.checked !== active)
                this._darkModeRow.toggle.checked = active;
        });

        // --- Night Light ---
        this._colorSettings = new Gio.Settings({
            schema_id: 'org.gnome.settings-daemon.plugins.color',
        });

        const isNightLight = this._colorSettings.get_boolean('night-light-enabled');
        this._nightLightRow = new ToggleRow(
            'night-light-symbolic', 'Night Light', isNightLight);
        this.add_child(this._nightLightRow);

        this._nightLightRow.toggle.connect('toggled', () => {
            this._colorSettings.set_boolean('night-light-enabled',
                this._nightLightRow.toggle.active);
        });

        this._signalsHandler.add(this._colorSettings, 'changed::night-light-enabled', () => {
            const active = this._colorSettings.get_boolean('night-light-enabled');
            if (this._nightLightRow.toggle.checked !== active)
                this._nightLightRow.toggle.checked = active;
        });

        // --- Do Not Disturb ---
        this._notifSettings = new Gio.Settings({
            schema_id: 'org.gnome.desktop.notifications',
        });

        // show-banners=false means DND is ON
        const isDnd = !this._notifSettings.get_boolean('show-banners');
        this._dndRow = new ToggleRow(
            'notifications-disabled-symbolic', 'Do Not Disturb', isDnd);
        this.add_child(this._dndRow);

        this._dndRow.toggle.connect('toggled', () => {
            this._notifSettings.set_boolean('show-banners',
                !this._dndRow.toggle.active);
        });

        this._signalsHandler.add(this._notifSettings, 'changed::show-banners', () => {
            const active = !this._notifSettings.get_boolean('show-banners');
            if (this._dndRow.toggle.checked !== active)
                this._dndRow.toggle.checked = active;
        });

        // --- Volume Slider ---
        this._volumeRow = new SliderRow('audio-volume-high-symbolic', 0.5);
        this.add_child(this._volumeRow);
        this._setupVolumeControl();

        // --- Brightness Slider ---
        this._brightnessRow = new SliderRow('display-brightness-symbolic', 0.5);
        this.add_child(this._brightnessRow);
        this._setupBrightnessControl();

        // --- Dismiss on Escape ---
        this.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                this.close();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this.connect('destroy', () => this._onDestroy());
    }

    _setupVolumeControl() {
        this._volumeUserChanging = false;

        try {
            this._mixerControl = new Gvc.MixerControl({name: 'Dash2X Quick Settings'});
            this._mixerControl.open();

            const updateVolume = () => {
                const sink = this._mixerControl.get_default_sink();
                if (!sink || this._volumeUserChanging)
                    return;
                const maxVol = this._mixerControl.get_vol_max_norm();
                const vol = sink.volume / maxVol;
                this._volumeRow.value = Math.min(vol, 1.0);

                // Update icon
                const icon = this._volumeRow._icon;
                if (sink.is_muted || vol === 0)
                    icon.icon_name = 'audio-volume-muted-symbolic';
                else if (vol < 0.33)
                    icon.icon_name = 'audio-volume-low-symbolic';
                else if (vol < 0.66)
                    icon.icon_name = 'audio-volume-medium-symbolic';
                else
                    icon.icon_name = 'audio-volume-high-symbolic';
            };

            this._mixerControl.connect('default-sink-changed', () => updateVolume());
            this._mixerControl.connect('stream-changed', () => updateVolume());
            this._mixerControl.connect('state-changed', () => {
                if (this._mixerControl.get_state() === Gvc.MixerControlState.READY)
                    updateVolume();
            });

            this._volumeRow.connect('value-changed', (_row, value) => {
                const sink = this._mixerControl.get_default_sink();
                if (!sink)
                    return;
                this._volumeUserChanging = true;
                const maxVol = this._mixerControl.get_vol_max_norm();
                sink.volume = value * maxVol;
                sink.push_volume();
                if (sink.is_muted && value > 0)
                    sink.change_is_muted(false);

                // Reset user-changing flag after a short delay
                if (this._volumeResetId)
                    GLib.source_remove(this._volumeResetId);
                this._volumeResetId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                    this._volumeUserChanging = false;
                    this._volumeResetId = 0;
                    return GLib.SOURCE_REMOVE;
                });
            });
        } catch (e) {
            // Gvc may not be available -- hide the row
            logError(e, 'Quick Settings: Failed to initialize volume control');
            this._volumeRow.visible = false;
        }
    }

    _setupBrightnessControl() {
        this._brightnessUserChanging = false;

        try {
            const proxyWrapper = Gio.DBusProxy.makeProxyWrapper(BRIGHTNESS_IFACE);
            this._brightnessProxy = new proxyWrapper(
                Gio.DBus.session,
                BRIGHTNESS_BUS_NAME,
                BRIGHTNESS_OBJECT_PATH,
                (proxy, error) => {
                    if (error) {
                        logError(error, 'Quick Settings: Brightness proxy failed');
                        this._brightnessRow.visible = false;
                        return;
                    }
                    this._updateBrightness();
                }
            );

            this._signalsHandler.add(this._brightnessProxy, 'g-properties-changed', () => {
                if (!this._brightnessUserChanging)
                    this._updateBrightness();
            });

            this._brightnessRow.connect('value-changed', (_row, value) => {
                if (!this._brightnessProxy)
                    return;
                this._brightnessUserChanging = true;
                const brightness = Math.round(value * 100);
                this._brightnessProxy.Brightness = brightness;

                if (this._brightnessResetId)
                    GLib.source_remove(this._brightnessResetId);
                this._brightnessResetId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                    this._brightnessUserChanging = false;
                    this._brightnessResetId = 0;
                    return GLib.SOURCE_REMOVE;
                });
            });
        } catch (e) {
            logError(e, 'Quick Settings: Failed to initialize brightness control');
            this._brightnessRow.visible = false;
        }
    }

    _updateBrightness() {
        if (!this._brightnessProxy)
            return;
        const brightness = this._brightnessProxy.Brightness;
        if (brightness >= 0)
            this._brightnessRow.value = brightness / 100;
        else
            this._brightnessRow.visible = false;
    }

    _onDestroy() {
        if (this._volumeResetId) {
            GLib.source_remove(this._volumeResetId);
            this._volumeResetId = 0;
        }
        if (this._brightnessResetId) {
            GLib.source_remove(this._brightnessResetId);
            this._brightnessResetId = 0;
        }
        if (this._clickOutsideId) {
            global.stage.disconnect(this._clickOutsideId);
            this._clickOutsideId = 0;
        }
        if (this._mixerControl) {
            this._mixerControl.close();
            this._mixerControl = null;
        }
        this._brightnessProxy = null;
    }

    toggle() {
        if (this._isOpen)
            this.close();
        else
            this.open();
    }

    open() {
        if (this._isOpen)
            return;
        this._isOpen = true;

        this._updatePosition();
        this.visible = true;
        this.opacity = 0;
        this.ease({
            opacity: 255,
            duration: 200,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        this.grab_key_focus();

        // Dismiss on click outside
        this._clickOutsideId = global.stage.connect('button-press-event',
            (_actor, event) => {
                const [x, y] = event.get_coords();
                const [panelX, panelY] = this.get_transformed_position();
                const [panelW, panelH] = this.get_transformed_size();

                // Check if the click is on the source button
                if (this._sourceActor) {
                    const [srcX, srcY] = this._sourceActor.get_transformed_position();
                    const [srcW, srcH] = this._sourceActor.get_transformed_size();
                    if (x >= srcX && x <= srcX + srcW && y >= srcY && y <= srcY + srcH)
                        return Clutter.EVENT_PROPAGATE;
                }

                if (x < panelX || x > panelX + panelW ||
                    y < panelY || y > panelY + panelH) {
                    this.close();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });
    }

    close() {
        if (!this._isOpen)
            return;
        this._isOpen = false;

        if (this._clickOutsideId) {
            global.stage.disconnect(this._clickOutsideId);
            this._clickOutsideId = 0;
        }

        this.ease({
            opacity: 0,
            duration: 150,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                this.visible = false;
            },
        });
    }

    _updatePosition() {
        if (!this._sourceActor)
            return;

        const position = Utils.getPosition();
        const [srcX, srcY] = this._sourceActor.get_transformed_position();
        const [srcW, srcH] = this._sourceActor.get_transformed_size();
        const monitor = Main.layoutManager.primaryMonitor;

        // Position panel adjacent to the dock
        switch (position) {
        case St.Side.BOTTOM:
            this.x = Math.max(monitor.x,
                Math.min(srcX + srcW / 2 - this.width / 2,
                    monitor.x + monitor.width - this.width));
            this.y = srcY - this.height - 8;
            break;
        case St.Side.TOP:
            this.x = Math.max(monitor.x,
                Math.min(srcX + srcW / 2 - this.width / 2,
                    monitor.x + monitor.width - this.width));
            this.y = srcY + srcH + 8;
            break;
        case St.Side.LEFT:
            this.x = srcX + srcW + 8;
            this.y = Math.max(monitor.y,
                Math.min(srcY + srcH / 2 - this.height / 2,
                    monitor.y + monitor.height - this.height));
            break;
        case St.Side.RIGHT:
            this.x = srcX - this.width - 8;
            this.y = Math.max(monitor.y,
                Math.min(srcY + srcH / 2 - this.height / 2,
                    monitor.y + monitor.height - this.height));
            break;
        }
    }
});

/**
 * The gear-icon button added to the dock.
 */
export const QuickSettingsButton = GObject.registerClass(
class QuickSettingsButton extends St.Button {
    _init() {
        super._init({
            style_class: 'quick-settings-button',
            can_focus: true,
            track_hover: true,
            reactive: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._icon = new St.Icon({
            icon_name: 'preferences-system-symbolic',
            style_class: 'quick-settings-button-icon',
        });
        this.set_child(this._icon);

        // Create the panel (initially hidden)
        this._panel = new QuickSettingsPanel(this);
        Main.layoutManager.addTopChrome(this._panel);

        this.connect('clicked', () => this._panel.toggle());
        this.connect('destroy', () => this._onDestroy());
    }

    _onDestroy() {
        if (this._panel) {
            this._panel.close();
            Main.layoutManager.removeChrome(this._panel);
            this._panel.destroy();
            this._panel = null;
        }
    }
});
