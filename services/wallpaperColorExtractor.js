// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: Contributors to XDock
// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

import {
    GdkPixbuf,
    Gio,
    GLib,
} from '../dependencies/gi.js';

import {
    Docking,
    Utils,
} from '../imports.js';

const {signals: Signals} = imports;

const Labels = Object.freeze({
    WALLPAPER: Symbol('wallpaper'),
    SETTINGS: Symbol('settings'),
});

// Scale wallpaper down to this size for fast pixel sampling
const SAMPLE_SIZE = 32;

/**
 * Extracts the dominant color from the desktop wallpaper and emits
 * 'color-changed' when the wallpaper (or the adaptive-color settings) change.
 *
 * The extracted color is adjusted for readability: desaturated by 40% and
 * darkened by 30%, then blended with the intensity preference.
 */
export class WallpaperColorExtractor {
    constructor() {
        this._signalsHandler = new Utils.GlobalSignalsHandler(this);
        this._bgSettings = new Gio.Settings({
            schema_id: 'org.gnome.desktop.background',
        });
        this._color = null;
        this._extractTimeoutId = 0;

        // Watch wallpaper URI changes (light and dark variants)
        this._signalsHandler.addWithLabel(Labels.WALLPAPER,
            [this._bgSettings, 'changed::picture-uri',
                () => this._scheduleExtraction()],
            [this._bgSettings, 'changed::picture-uri-dark',
                () => this._scheduleExtraction()]);

        // Watch our own settings
        this._signalsHandler.addWithLabel(Labels.SETTINGS,
            [Docking.DockManager.settings,
                'changed::wallpaper-adaptive-intensity',
                () => this._scheduleExtraction()]);

        // Do the initial extraction
        this._scheduleExtraction();
    }

    destroy() {
        this.emit('destroy');
        if (this._extractTimeoutId) {
            GLib.source_remove(this._extractTimeoutId);
            this._extractTimeoutId = 0;
        }
        this._signalsHandler?.destroy();
        this._signalsHandler = null;
        this._bgSettings = null;
        this._color = null;
    }

    /**
     * @returns {string|null} The most recently extracted color as '#rrggbb',
     *   or null if no extraction has completed yet.
     */
    get color() {
        return this._color;
    }

    /**
     * Debounce extraction so that rapid wallpaper changes (e.g. slideshow
     * transitions) do not hammer the pixbuf loader.
     */
    _scheduleExtraction() {
        if (this._extractTimeoutId)
            return;

        this._extractTimeoutId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._extractTimeoutId = 0;
            this._doExtraction();
            return GLib.SOURCE_REMOVE;
        });
    }

    _doExtraction() {
        const uri = this._getWallpaperUri();
        if (!uri) {
            this._setColor(null);
            return;
        }

        let path;
        try {
            [path] = GLib.filename_from_uri(uri);
        } catch {
            this._setColor(null);
            return;
        }

        let pixbuf;
        try {
            pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(
                path, SAMPLE_SIZE, SAMPLE_SIZE, false);
        } catch {
            // Image could not be loaded (unsupported format, missing file, etc.)
            this._setColor(null);
            return;
        }

        const color = this._dominantColor(pixbuf);
        this._setColor(color);
    }

    /**
     * Pick the appropriate wallpaper URI.  Prefer the dark variant when the
     * GNOME color-scheme is set to 'prefer-dark'.
     */
    _getWallpaperUri() {
        let uri = null;
        try {
            const ifaceSettings = new Gio.Settings({
                schema_id: 'org.gnome.desktop.interface',
            });
            const colorScheme = ifaceSettings.get_string('color-scheme');
            if (colorScheme === 'prefer-dark')
                uri = this._bgSettings.get_string('picture-uri-dark');
        } catch {
            // color-scheme key may not exist on older GNOME
        }

        if (!uri)
            uri = this._bgSettings.get_string('picture-uri');

        return uri || null;
    }

    /**
     * Compute a single dominant colour from a small pixbuf, weighted toward
     * the centre (where the dock typically sits).
     *
     * @param {GdkPixbuf.Pixbuf} pixbuf  A small, pre-scaled pixbuf.
     * @returns {string} Hex colour string '#rrggbb'.
     */
    _dominantColor(pixbuf) {
        const pixels = pixbuf.get_pixels();
        const nChannels = pixbuf.get_n_channels();
        const rowstride = pixbuf.get_rowstride();
        const width = pixbuf.get_width();
        const height = pixbuf.get_height();

        let totalR = 0, totalG = 0, totalB = 0, totalWeight = 0;

        const cx = width / 2;
        const cy = height / 2;
        // Maximum possible distance (corner to centre)
        const maxDist = Math.sqrt(cx * cx + cy * cy);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const offset = y * rowstride + x * nChannels;
                const r = pixels[offset];
                const g = pixels[offset + 1];
                const b = pixels[offset + 2];

                // Weight pixels closer to the centre more heavily
                const dx = x - cx;
                const dy = y - cy;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const weight = 1.0 - 0.6 * (dist / maxDist);

                totalR += r * weight;
                totalG += g * weight;
                totalB += b * weight;
                totalWeight += weight;
            }
        }

        const avgR = totalR / totalWeight;
        const avgG = totalG / totalWeight;
        const avgB = totalB / totalWeight;

        // Convert to HSV, desaturate and darken for readability
        const hsv = Utils.ColorUtils.RGBtoHSV(
            Math.round(avgR), Math.round(avgG), Math.round(avgB));

        // Desaturate by 40%
        hsv.s *= 0.6;
        // Darken by 30%
        hsv.v *= 0.7;

        // Apply intensity setting as a blend factor
        const intensity = Docking.DockManager.settings.wallpaperAdaptiveIntensity ?? 0.6;
        hsv.s *= intensity;
        hsv.v = hsv.v * intensity + (1.0 - intensity) * 0.2; // blend toward dark grey

        const rgb = Utils.ColorUtils.HSVtoRGB(hsv);

        return this._rgbToHex(rgb.r, rgb.g, rgb.b);
    }

    _rgbToHex(r, g, b) {
        const toHex = v => {
            const hex = Math.round(Math.min(Math.max(v, 0), 255)).toString(16);
            return hex.length < 2 ? `0${hex}` : hex;
        };
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }

    _setColor(color) {
        if (color === this._color)
            return;
        this._color = color;
        this.emit('color-changed', color);
    }
}

Signals.addSignalMethods(WallpaperColorExtractor.prototype);
