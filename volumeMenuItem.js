// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: Contributors to Dash 2 X

import {
    Clutter,
    GObject,
    St,
} from './dependencies/gi.js';

import {
    PopupMenu,
} from './dependencies/shell/ui.js';

import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';

import {
    Utils,
} from './imports.js';

import {Extension} from './dependencies/shell/extensions/extension.js';

const {gettext: __} = Extension;

/**
 * VolumeMenuItem - A popup menu item containing a volume slider for per-app
 * volume control.
 *
 * Layout: [mute-icon] [=====slider=====] [percentage]
 *
 * The slider maps the app's audio stream volume from 0 to 100% (with the
 * ability to boost up to 150%).
 */
export const VolumeMenuItem = GObject.registerClass({
    Signals: {
        'volume-changed': {param_types: [GObject.TYPE_DOUBLE]},
        'mute-toggled': {param_types: [GObject.TYPE_BOOLEAN]},
    },
}, class VolumeMenuItem extends PopupMenu.PopupBaseMenuItem {
    _init(stream, volumeControl) {
        super._init({
            activate: false,
            reactive: true,
            can_focus: true,
            style_class: 'dock-volume-menu-item',
        });

        this._stream = stream;
        this._volumeControl = volumeControl;
        this._signalsHandler = new Utils.GlobalSignalsHandler(this);
        this._dragging = false;

        // Build the layout
        const box = new St.BoxLayout({
            style_class: 'dock-volume-box',
            x_expand: true,
            vertical: false,
            x_align: Clutter.ActorAlign.FILL,
        });
        this.add_child(box);

        // Section label
        this._label = new St.Label({
            text: __('Volume'),
            style_class: 'dock-volume-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._label);

        // Mute button
        this._muteButton = new St.Button({
            style_class: 'dock-volume-mute-button',
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({
                icon_name: 'audio-volume-high-symbolic',
                style_class: 'popup-menu-icon dock-volume-icon',
            }),
        });
        this._muteButton.connect('clicked', () => this._toggleMute());
        box.add_child(this._muteButton);

        // Slider
        this._slider = new Slider.Slider(0);
        this._slider.x_expand = true;
        this._slider.y_align = Clutter.ActorAlign.CENTER;
        box.add_child(this._slider);

        // Percentage label
        this._percentLabel = new St.Label({
            text: '100%',
            style_class: 'dock-volume-percent',
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.END,
        });
        // Set a minimum width so the label does not jump around
        this._percentLabel.set_width(45);
        box.add_child(this._percentLabel);

        // Connect slider change
        this._slider.connect('notify::value', () => {
            if (!this._updatingFromStream)
                this._onSliderChanged();
        });

        // Connect to stream changes for real-time updates
        if (this._stream) {
            this._streamNotifyVolumeId = this._stream.connect(
                'notify::volume', () => this._syncFromStream());
            this._streamNotifyMuteId = this._stream.connect(
                'notify::is-muted', () => this._syncFromStream());
        }

        // Initial sync
        this._syncFromStream();

        this.connect('destroy', () => this._onDestroy());
    }

    _onDestroy() {
        if (this._stream) {
            if (this._streamNotifyVolumeId) {
                this._stream.disconnect(this._streamNotifyVolumeId);
                this._streamNotifyVolumeId = 0;
            }
            if (this._streamNotifyMuteId) {
                this._stream.disconnect(this._streamNotifyMuteId);
                this._streamNotifyMuteId = 0;
            }
        }
        this._stream = null;
        this._volumeControl = null;
    }

    /**
     * Update the slider and icons from the stream state.
     */
    _syncFromStream() {
        if (!this._stream || !this._volumeControl)
            return;

        this._updatingFromStream = true;

        const volume = this._volumeControl.getStreamVolume(this._stream);
        const isMuted = this._volumeControl.getStreamMuted(this._stream);

        this._slider.value = Math.min(volume, 1.0);
        this._updatePercentLabel(volume);
        this._updateMuteIcon(isMuted, volume);

        this._updatingFromStream = false;
    }

    /**
     * Handle slider value change from user interaction.
     */
    _onSliderChanged() {
        if (!this._stream || !this._volumeControl)
            return;

        const volume = this._slider.value;
        this._volumeControl.setStreamVolume(this._stream, volume);
        this._updatePercentLabel(volume);
        this._updateMuteIcon(
            this._volumeControl.getStreamMuted(this._stream), volume);

        this.emit('volume-changed', volume);
    }

    /**
     * Toggle mute state.
     */
    _toggleMute() {
        if (!this._stream || !this._volumeControl)
            return;

        const isMuted = this._volumeControl.getStreamMuted(this._stream);
        this._volumeControl.setStreamMuted(this._stream, !isMuted);
        this._updateMuteIcon(!isMuted,
            this._volumeControl.getStreamVolume(this._stream));

        this.emit('mute-toggled', !isMuted);
    }

    /**
     * Update the mute button icon based on volume and mute state.
     *
     * @param {boolean} isMuted
     * @param {number} volume
     */
    _updateMuteIcon(isMuted, volume) {
        const icon = this._muteButton.child;
        if (!icon)
            return;

        let iconName;
        if (isMuted || volume === 0)
            iconName = 'audio-volume-muted-symbolic';
        else if (volume < 0.33)
            iconName = 'audio-volume-low-symbolic';
        else if (volume < 0.67)
            iconName = 'audio-volume-medium-symbolic';
        else
            iconName = 'audio-volume-high-symbolic';

        icon.icon_name = iconName;
    }

    /**
     * Update the percentage label.
     *
     * @param {number} volume - Normalized volume 0.0 - 1.5
     */
    _updatePercentLabel(volume) {
        const percent = Math.round(volume * 100);
        this._percentLabel.text = `${percent}%`;
    }

    /**
     * Update the stream reference (e.g. when the stream changes).
     *
     * @param {Gvc.MixerStream} stream
     */
    updateStream(stream) {
        // Disconnect old stream signals
        if (this._stream) {
            if (this._streamNotifyVolumeId) {
                this._stream.disconnect(this._streamNotifyVolumeId);
                this._streamNotifyVolumeId = 0;
            }
            if (this._streamNotifyMuteId) {
                this._stream.disconnect(this._streamNotifyMuteId);
                this._streamNotifyMuteId = 0;
            }
        }

        this._stream = stream;

        // Connect new stream signals
        if (this._stream) {
            this._streamNotifyVolumeId = this._stream.connect(
                'notify::volume', () => this._syncFromStream());
            this._streamNotifyMuteId = this._stream.connect(
                'notify::is-muted', () => this._syncFromStream());
        }

        this._syncFromStream();
    }
});
