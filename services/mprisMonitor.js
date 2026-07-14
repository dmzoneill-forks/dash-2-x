// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: Contributors to XDock
// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

import {
    Gio,
    GLib,
} from '../dependencies/gi.js';

import {
    Docking,
    Utils,
} from '../imports.js';

const {signals: Signals} = imports;

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';
const MPRIS_PATH = '/org/mpris/MediaPlayer2';
const MPRIS_IFACE = 'org.mpris.MediaPlayer2';
const MPRIS_PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';
const DBUS_PROPERTIES_IFACE = 'org.freedesktop.DBus.Properties';

const Labels = Object.freeze({
    SETTINGS: Symbol('settings'),
});

/**
 * Monitors MPRIS media players on the D-Bus session bus and provides
 * playback state and transport controls keyed by desktop app ID.
 */
export class MprisMonitor {
    constructor() {
        this._players = new Map(); // busName -> { proxy, appId, signalId }
        this._appPlayers = new Map(); // appId -> busName
        this._watchIds = [];
        this._signalsHandler = new Utils.GlobalSignalsHandler();

        const getIsEnabled = () =>
            Docking.DockManager.settings.showMediaControls;

        this._isEnabled = getIsEnabled();
        this._signalsHandler.addWithLabel(Labels.SETTINGS,
            Docking.DockManager.settings, 'changed::show-media-controls', () => {
                const isEnabled = getIsEnabled();
                if (isEnabled !== this._isEnabled) {
                    this._isEnabled = isEnabled;
                    if (isEnabled)
                        this._startWatching();
                    else
                        this._stopWatching();
                    this.emit('player-changed');
                }
            });

        if (this._isEnabled)
            this._startWatching();
    }

    destroy() {
        this._destroyed = true;
        this.emit('destroy');
        this._stopWatching();
        this._signalsHandler?.destroy();
        this._signalsHandler = null;
    }

    get enabled() {
        return this._isEnabled;
    }

    /**
     * Returns playback information for the given app ID, or null if
     * no active MPRIS player is associated with the app.
     *
     * @param {string} appId - the .desktop file ID (e.g. 'spotify.desktop')
     * @returns {object|null} player state
     */
    getPlayerForApp(appId) {
        if (!this._isEnabled)
            return null;

        const busName = this._appPlayers.get(appId);
        if (!busName)
            return null;

        const player = this._players.get(busName);
        if (!player?.proxy)
            return null;

        const status = player.proxy.PlaybackStatus;
        if (!status || status === 'Stopped')
            return null;

        const metadata = player.proxy.Metadata;
        let title = '';
        let artist = '';

        if (metadata) {
            const titleVariant = metadata['xesam:title'];
            if (titleVariant)
                title = titleVariant.deepUnpack?.() ?? titleVariant;

            const artistVariant = metadata['xesam:artist'];
            if (artistVariant) {
                const artists = artistVariant.deepUnpack?.() ?? artistVariant;
                artist = Array.isArray(artists) ? artists.join(', ') : String(artists);
            }
        }

        return {
            status,
            title: String(title || ''),
            artist: String(artist || ''),
            canGoNext: !!player.proxy.CanGoNext,
            canGoPrevious: !!player.proxy.CanGoPrevious,
            canPlay: !!player.proxy.CanPlay,
            canPause: !!player.proxy.CanPause,
        };
    }

    /**
     * Checks if an app has an active (Playing or Paused) MPRIS player.
     *
     * @param {string} appId
     * @returns {boolean}
     */
    hasPlayer(appId) {
        return this.getPlayerForApp(appId) !== null;
    }

    /**
     * Send PlayPause to the MPRIS player associated with the given app.
     *
     * @param {string} appId
     */
    playPause(appId) {
        this._callPlayerMethod(appId, 'PlayPause');
    }

    /**
     * Send Play to the MPRIS player.
     *
     * @param {string} appId
     */
    play(appId) {
        this._callPlayerMethod(appId, 'Play');
    }

    /**
     * Send Pause to the MPRIS player.
     *
     * @param {string} appId
     */
    pause(appId) {
        this._callPlayerMethod(appId, 'Pause');
    }

    /**
     * Send Next to the MPRIS player.
     *
     * @param {string} appId
     */
    next(appId) {
        this._callPlayerMethod(appId, 'Next');
    }

    /**
     * Send Previous to the MPRIS player.
     *
     * @param {string} appId
     */
    previous(appId) {
        this._callPlayerMethod(appId, 'Previous');
    }

    _callPlayerMethod(appId, method) {
        const busName = this._appPlayers.get(appId);
        if (!busName)
            return;

        const player = this._players.get(busName);
        if (!player?.proxy)
            return;

        player.proxy.call(
            method, null,
            Gio.DBusCallFlags.NONE, -1, null, null);
    }

    _startWatching() {
        // List existing MPRIS bus names
        Gio.DBus.session.call(
            'org.freedesktop.DBus',
            '/org/freedesktop/DBus',
            'org.freedesktop.DBus',
            'ListNames',
            null,
            new GLib.VariantType('(as)'),
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (connection, result) => {
                if (this._destroyed)
                    return;
                try {
                    const reply = connection.call_finish(result);
                    const [names] = reply.deepUnpack();
                    for (const name of names) {
                        if (name.startsWith(MPRIS_PREFIX))
                            this._onPlayerAppeared(name);
                    }
                } catch (e) {
                    logError(e, 'MprisMonitor: failed to list bus names');
                }
            }
        );

        // Watch for new MPRIS players appearing / disappearing
        const watchId = Gio.DBus.session.signal_subscribe(
            'org.freedesktop.DBus',
            'org.freedesktop.DBus',
            'NameOwnerChanged',
            '/org/freedesktop/DBus',
            null,
            Gio.DBusSignalFlags.NONE,
            (_conn, _sender, _path, _iface, _signal, params) => {
                if (this._destroyed)
                    return;
                const [name, oldOwner, newOwner] = params.deepUnpack();
                if (!name.startsWith(MPRIS_PREFIX))
                    return;

                if (newOwner && !oldOwner)
                    this._onPlayerAppeared(name);
                else if (oldOwner && !newOwner)
                    this._onPlayerVanished(name);
            }
        );
        this._watchIds.push(watchId);
    }

    _stopWatching() {
        for (const watchId of this._watchIds)
            Gio.DBus.session.signal_unsubscribe(watchId);
        this._watchIds = [];

        for (const [busName] of this._players)
            this._destroyPlayer(busName);
        this._players.clear();
        this._appPlayers.clear();
    }

    _onPlayerAppeared(busName) {
        if (this._players.has(busName))
            return;

        const entry = {proxy: null, appId: null, signalId: 0};
        this._players.set(busName, entry);

        // Fetch DesktopEntry from the org.mpris.MediaPlayer2 interface
        this._fetchDesktopEntry(busName, entry);
    }

    _fetchDesktopEntry(busName, entry) {
        Gio.DBus.session.call(
            busName,
            MPRIS_PATH,
            DBUS_PROPERTIES_IFACE,
            'Get',
            new GLib.Variant('(ss)', [MPRIS_IFACE, 'DesktopEntry']),
            new GLib.VariantType('(v)'),
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (connection, result) => {
                if (this._destroyed)
                    return;
                let desktopEntry = null;
                try {
                    const reply = connection.call_finish(result);
                    const [variant] = reply.deepUnpack();
                    desktopEntry = variant.deepUnpack();
                } catch {
                    // Some players don't export DesktopEntry;
                    // try to guess from the bus name
                    desktopEntry = this._guessDesktopEntry(busName);
                }

                if (desktopEntry) {
                    // Normalize: ensure it ends with .desktop
                    const appId = desktopEntry.endsWith('.desktop')
                        ? desktopEntry : `${desktopEntry}.desktop`;
                    entry.appId = appId;
                    this._appPlayers.set(appId, busName);
                }

                this._createPlayerProxy(busName, entry);
            }
        );
    }

    _createPlayerProxy(busName, entry) {
        Gio.DBusProxy.new(
            Gio.DBus.session,
            Gio.DBusProxyFlags.GET_INVALIDATED_PROPERTIES,
            null,
            busName,
            MPRIS_PATH,
            MPRIS_PLAYER_IFACE,
            null,
            (source, result) => {
                try {
                    const proxy = Gio.DBusProxy.new_finish(result);
                    entry.proxy = proxy;

                    entry.signalId = proxy.connect('g-properties-changed',
                        () => this.emit('player-changed'));

                    this.emit('player-changed');
                } catch (e) {
                    logError(e, `MprisMonitor: failed to create proxy for ${busName}`);
                }
            }
        );
    }

    _onPlayerVanished(busName) {
        this._destroyPlayer(busName);
        this._players.delete(busName);
        this.emit('player-changed');
    }

    _destroyPlayer(busName) {
        const entry = this._players.get(busName);
        if (!entry)
            return;

        if (entry.proxy && entry.signalId) {
            entry.proxy.disconnect(entry.signalId);
            entry.signalId = 0;
        }
        entry.proxy = null;

        if (entry.appId) {
            // Only remove from appPlayers if this busName is still the current one
            if (this._appPlayers.get(entry.appId) === busName)
                this._appPlayers.delete(entry.appId);
        }
    }

    /**
     * Attempt to guess the desktop file name from the MPRIS bus name.
     * E.g., org.mpris.MediaPlayer2.spotify -> spotify
     *       org.mpris.MediaPlayer2.firefox.instance_12345 -> firefox
     *
     * @param {string} busName
     * @returns {string|null}
     */
    _guessDesktopEntry(busName) {
        const suffix = busName.slice(MPRIS_PREFIX.length);
        if (!suffix)
            return null;

        // Take only the first segment (before any dot that looks like an instance suffix)
        const match = suffix.match(/^([^.]+)/);
        return match ? match[1] : suffix;
    }
}

Signals.addSignalMethods(MprisMonitor.prototype);
