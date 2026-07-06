// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: Contributors to Dash 2 X

import Gvc from 'gi://Gvc';

import {Utils} from './imports.js';

/**
 * VolumeControl - Manages per-app audio stream lookups using Gvc.MixerControl.
 *
 * Uses GNOME Shell's PulseAudio/PipeWire GVC library to find audio sink
 * inputs (playback streams) belonging to a specific application, matched
 * by PID and application name.
 */
export class VolumeControl {
    constructor() {
        this._signalsHandler = new Utils.GlobalSignalsHandler();
        this._mixerControl = new Gvc.MixerControl({name: 'Dash 2 X Volume'});

        // Cache of stream-id -> Shell.App mappings for quick lookups
        this._streamAppCache = new Map();

        this._mixerControl.connect('stream-added', (_ctrl, id) => {
            this._onStreamAdded(id);
        });
        this._mixerControl.connect('stream-removed', (_ctrl, id) => {
            this._onStreamRemoved(id);
        });
        this._mixerControl.connect('stream-changed', (_ctrl, id) => {
            this._onStreamChanged(id);
        });

        this._mixerControl.open();
    }

    destroy() {
        this._signalsHandler?.destroy();
        this._signalsHandler = null;
        this._streamAppCache.clear();

        if (this._mixerControl) {
            this._mixerControl.close();
            this._mixerControl = null;
        }
    }

    /**
     * Get the Gvc.MixerStream for a given Shell.App, if it has an active
     * audio playback stream.
     *
     * @param {Shell.App} app - The application to look up
     * @returns {Gvc.MixerStream|null} The audio stream, or null
     */
    getStreamForApp(app) {
        if (!this._mixerControl || !app)
            return null;

        // Get the app's PIDs from its windows
        const appPids = this._getAppPids(app);
        const appName = this._getAppName(app);

        // Search through all sink inputs (application audio streams)
        const sinkInputs = this._mixerControl.get_sink_inputs();
        if (!sinkInputs)
            return null;

        for (const stream of sinkInputs) {
            if (!stream)
                continue;

            // Match by PID first (most reliable)
            const streamPid = this._getStreamPid(stream);
            if (streamPid > 0 && appPids.has(streamPid))
                return stream;

            // Fallback: match by application name
            const streamAppName = stream.get_application_id?.() ||
                stream.get_name?.() || '';
            if (appName && streamAppName &&
                this._namesMatch(appName, streamAppName))
                return stream;
        }

        return null;
    }

    /**
     * Get all Gvc.MixerStreams for a given Shell.App.
     * Some apps may have multiple streams (e.g. browser tabs).
     *
     * @param {Shell.App} app - The application to look up
     * @returns {Gvc.MixerStream[]} Array of audio streams
     */
    getStreamsForApp(app) {
        if (!this._mixerControl || !app)
            return [];

        const appPids = this._getAppPids(app);
        const appName = this._getAppName(app);
        const streams = [];

        const sinkInputs = this._mixerControl.get_sink_inputs();
        if (!sinkInputs)
            return streams;

        for (const stream of sinkInputs) {
            if (!stream)
                continue;

            const streamPid = this._getStreamPid(stream);
            if (streamPid > 0 && appPids.has(streamPid)) {
                streams.push(stream);
                continue;
            }

            const streamAppName = stream.get_application_id?.() ||
                stream.get_name?.() || '';
            if (appName && streamAppName &&
                this._namesMatch(appName, streamAppName))
                streams.push(stream);
        }

        return streams;
    }

    /**
     * Check whether an app has any active audio stream.
     *
     * @param {Shell.App} app
     * @returns {boolean}
     */
    hasStreamForApp(app) {
        return this.getStreamForApp(app) !== null;
    }

    /**
     * Get the normalized volume (0.0 - 1.0) for a stream.
     *
     * @param {Gvc.MixerStream} stream
     * @returns {number}
     */
    getStreamVolume(stream) {
        if (!stream || !this._mixerControl)
            return 0;

        const maxVolume = this._mixerControl.get_vol_max_norm();
        if (maxVolume === 0)
            return 0;

        return stream.get_volume() / maxVolume;
    }

    /**
     * Set the normalized volume (0.0 - 1.0) for a stream.
     * Values above 1.0 are allowed (amplification) up to 1.5.
     *
     * @param {Gvc.MixerStream} stream
     * @param {number} volume - Normalized volume (0.0 to 1.5)
     */
    setStreamVolume(stream, volume) {
        if (!stream || !this._mixerControl)
            return;

        const maxVolume = this._mixerControl.get_vol_max_norm();
        const maxAmplified = this._mixerControl.get_vol_max_amplified();
        const maxAllowed = Math.min(maxAmplified, maxVolume * 1.5);

        const rawVolume = Math.round(Math.min(volume * maxVolume, maxAllowed));
        stream.set_volume(rawVolume);
        stream.push_volume();
    }

    /**
     * Get whether a stream is muted.
     *
     * @param {Gvc.MixerStream} stream
     * @returns {boolean}
     */
    getStreamMuted(stream) {
        if (!stream)
            return false;
        return stream.get_is_muted();
    }

    /**
     * Set the muted state for a stream.
     *
     * @param {Gvc.MixerStream} stream
     * @param {boolean} muted
     */
    setStreamMuted(stream, muted) {
        if (!stream)
            return;
        stream.change_is_muted(muted);
    }

    _getAppPids(app) {
        const pids = new Set();
        const windows = app.get_windows();
        if (windows) {
            for (const w of windows) {
                const pid = w.get_pid();
                if (pid > 0)
                    pids.add(pid);
            }
        }
        return pids;
    }

    _getAppName(app) {
        // Try multiple sources for the app name
        const appInfo = app.get_app_info?.();
        if (appInfo) {
            const wmClass = appInfo.get_startup_wm_class?.();
            if (wmClass)
                return wmClass.toLowerCase();
        }

        const appId = app.get_id?.();
        if (appId) {
            // Strip the .desktop suffix and path components
            return appId.replace(/\.desktop$/, '')
                .split('.').pop()
                .toLowerCase();
        }

        return app.get_name?.()?.toLowerCase() ?? '';
    }

    _getStreamPid(stream) {
        // GVC streams expose the PID through the property bag
        // or directly via the API
        if (stream.get_application_id) {
            // Try to get PID from the stream properties
            const props = stream.get_property?.('application.process.id');
            if (props) {
                const pid = parseInt(props, 10);
                if (!isNaN(pid))
                    return pid;
            }
        }

        // Fallback: try get_application_pid if available
        // This property is not always available on all GVC versions
        return 0;
    }

    _namesMatch(appName, streamName) {
        const normalizedStream = streamName.toLowerCase()
            .replace(/[^a-z0-9]/g, '');
        const normalizedApp = appName.toLowerCase()
            .replace(/[^a-z0-9]/g, '');

        return normalizedStream.includes(normalizedApp) ||
            normalizedApp.includes(normalizedStream);
    }

    _onStreamAdded(_id) {
        // Signal to any listeners that streams changed
    }

    _onStreamRemoved(id) {
        this._streamAppCache.delete(id);
    }

    _onStreamChanged(_id) {
        // Signal to any listeners that a stream changed
    }
}
