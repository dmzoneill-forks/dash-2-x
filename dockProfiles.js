// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: Contributors to Dash 2 X

import {GLib} from './dependencies/gi.js';

const {signals: Signals} = imports;

/**
 * Settings keys that are captured in a dock profile.
 * These represent the main user-visible configuration options.
 */
const PROFILE_SETTINGS_KEYS = [
    // Position & size
    'dock-position',
    'dash-max-icon-size',
    'dock-fixed',
    'autohide',
    'intellihide',
    'extend-height',
    'height-fraction',
    'icon-size-fixed',
    'multi-monitor',
    'dock-margin-size',

    // Launchers
    'show-favorites',
    'show-running',
    'show-trash',
    'show-mounts',

    // Behavior
    'click-action',
    'scroll-action',

    // Appearance
    'transparency-mode',
    'background-opacity',
    'custom-background-color',
    'background-color',

    // Visibility
    'autohide-in-fullscreen',
    'intellihide-mode',
    'require-pressure-to-show',

    // Icons & indicators
    'show-show-apps-button',
    'show-apps-at-top',
    'apply-custom-theme',
    'custom-theme-shrink',
    'running-indicator-style',
    'unity-backlit-items',
    'force-straight-corner',
    'custom-border-radius',

    // Misc behavior
    'isolate-workspaces',
    'isolate-monitors',
    'group-apps',
    'show-windows-preview',
    'dance-urgent-applications',
    'bounce-icons',
    'show-icons-emblems',
    'show-icons-notifications-counter',
    'hot-keys',
    'disable-overview-on-startup',
    'always-center-icons',
    'show-apps-always-in-the-edge',
    'hide-tooltip',
    'show-previews-hover',
    'scroll-to-focused-application',
    'isolate-locations',
    'show-mounts-only-mounted',
    'show-mounts-network',
    'bolt-support',
];

export class DockProfiles {
    /**
     * @param {Gio.Settings} settings - The extension GSettings object
     */
    constructor(settings) {
        this._settings = settings;
    }

    /**
     * Read profiles from GSettings.
     *
     * @returns {Array} Array of profile objects {name, settings}
     */
    _readProfiles() {
        try {
            const raw = this._settings.get_string('dock-profiles');
            if (!raw)
                return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    /**
     * Write profiles to GSettings.
     *
     * @param {Array} profiles - Array of profile objects
     */
    _writeProfiles(profiles) {
        this._settings.set_string('dock-profiles', JSON.stringify(profiles));
        this.emit('profiles-changed');
    }

    /**
     * Snapshot current settings into a named profile.
     * If a profile with the same name exists, it is overwritten.
     *
     * @param {string} name - Profile name
     */
    saveProfile(name) {
        if (!name)
            return;

        const snapshot = {};
        for (const key of PROFILE_SETTINGS_KEYS) {
            const schemaKey = this._settings.settingsSchema.get_key(key);
            if (!schemaKey)
                continue;

            const range = schemaKey.get_range().deepUnpack();
            if (range[0] === 'enum')
                snapshot[key] = this._settings.get_enum(key);
            else
                snapshot[key] = this._settings.get_value(key).recursiveUnpack();
        }

        const profiles = this._readProfiles();
        const idx = profiles.findIndex(p => p.name === name);
        const entry = {name, settings: snapshot};

        if (idx >= 0)
            profiles[idx] = entry;
        else
            profiles.push(entry);

        this._writeProfiles(profiles);
        this._settings.set_string('active-profile', name);
    }

    /**
     * Apply all settings from a named profile.
     *
     * @param {string} name - Profile name
     * @returns {boolean} true if the profile was found and applied
     */
    loadProfile(name) {
        const profiles = this._readProfiles();
        const profile = profiles.find(p => p.name === name);
        if (!profile)
            return false;

        const {settings: snapshot} = profile;
        for (const key of PROFILE_SETTINGS_KEYS) {
            if (!(key in snapshot))
                continue;

            const schemaKey = this._settings.settingsSchema.get_key(key);
            if (!schemaKey)
                continue;

            try {
                const range = schemaKey.get_range().deepUnpack();
                if (range[0] === 'enum') {
                    this._settings.set_enum(key, snapshot[key]);
                } else {
                    const variant = schemaKey.get_default_value();
                    const type = variant.get_type_string();
                    this._setTypedValue(key, type, snapshot[key]);
                }
            } catch (e) {
                logError(e, `DockProfiles: failed to set key '${key}'`);
            }
        }

        this._settings.set_string('active-profile', name);
        return true;
    }

    /**
     * Set a GSettings value using the correct GLib.Variant type.
     *
     * @param {string} key
     * @param {string} type - GVariant type string
     * @param {*} value
     */
    _setTypedValue(key, type, value) {
        switch (type) {
        case 'b':
            this._settings.set_boolean(key, value);
            break;
        case 'i':
            this._settings.set_int(key, value);
            break;
        case 'd':
            this._settings.set_double(key, value);
            break;
        case 's':
            this._settings.set_string(key, value);
            break;
        case 'as':
            this._settings.set_strv(key, value);
            break;
        default:
            // Fallback: try set_value with a new variant
            this._settings.set_value(key,
                new GLib.Variant(type, value));
        }
    }

    /**
     * Remove a profile by name.
     *
     * @param {string} name - Profile name
     */
    deleteProfile(name) {
        const profiles = this._readProfiles();
        const filtered = profiles.filter(p => p.name !== name);
        if (filtered.length !== profiles.length) {
            this._writeProfiles(filtered);
            if (this._settings.get_string('active-profile') === name)
                this._settings.set_string('active-profile', '');
        }
    }

    /**
     * Return list of profile names.
     *
     * @returns {string[]}
     */
    getProfiles() {
        return this._readProfiles().map(p => p.name);
    }

    /**
     * Export a profile as a JSON string for sharing.
     *
     * @param {string} name - Profile name
     * @returns {string|null} JSON string or null if not found
     */
    exportProfile(name) {
        const profiles = this._readProfiles();
        const profile = profiles.find(p => p.name === name);
        if (!profile)
            return null;
        return JSON.stringify(profile, null, 2);
    }

    /**
     * Import a profile from a JSON string.
     *
     * @param {string} jsonString - JSON profile data
     * @returns {boolean} true if import succeeded
     */
    importProfile(jsonString) {
        try {
            const profile = JSON.parse(jsonString);
            if (!profile || !profile.name || !profile.settings)
                return false;

            const profiles = this._readProfiles();
            const idx = profiles.findIndex(p => p.name === profile.name);
            if (idx >= 0)
                profiles[idx] = profile;
            else
                profiles.push(profile);

            this._writeProfiles(profiles);
            return true;
        } catch {
            return false;
        }
    }

    destroy() {
        this._settings = null;
    }
}
Signals.addSignalMethods(DockProfiles.prototype);
