// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: Contributors to XDock
import {
    GdkPixbuf,
    Gio,
    St,
} from '../dependencies/gi.js';

import {
    Docking,
    Utils,
} from '../imports.js';

// Global icon cache. Used for Unity7 styling.
const iconCacheMap = new Map();
// Max number of items to store
// We don't expect to ever reach this number, but let's put an hard limit to avoid
// even the remote possibility of the cached items to grow indefinitely.
const MAX_CACHED_ITEMS = 1000;
// When the size exceed it, the oldest 'n' ones are deleted
const  BATCH_SIZE_TO_DELETE = 50;
// The icon size used to extract the dominant color
const DOMINANT_COLOR_ICON_SIZE = 64;

// Compute dominant color from the app icon.
// The color is cached for efficiency.
export class DominantColorExtractor {
    constructor(app) {
        this._app = app;
    }

    /**
     * Try to get the pixel buffer for the current icon, if not fail gracefully
     */
    _getIconPixBuf() {
        let iconTexture = this._app.create_icon_texture(16);
        const themeLoader = Docking.DockManager.iconTheme;

        // Unable to load the icon texture, use fallback
        if (iconTexture instanceof St.Icon === false)
            return null;


        iconTexture = iconTexture.get_gicon();

        // Unable to load the icon texture, use fallback
        if (!iconTexture)
            return null;

        if (iconTexture instanceof Gio.FileIcon) {
            // Use GdkPixBuf to load the pixel buffer from the provided file path
            return GdkPixbuf.Pixbuf.new_from_file(iconTexture.get_file().get_path());
        } else if (iconTexture instanceof Gio.ThemedIcon) {
            // Get the first pixel buffer available in the icon theme
            const iconNames = iconTexture.get_names();
            const iconInfo = themeLoader.choose_icon(iconNames, DOMINANT_COLOR_ICON_SIZE, 0);

            if (iconInfo)
                return iconInfo.load_icon();
            else
                return null;
        }

        // Use GdkPixBuf to load the pixel buffer from memory
        // iconTexture.load is available unless iconTexture is not an instance of Gio.LoadableIcon
        // this means that iconTexture is an instance of Gio.EmblemedIcon,
        // which may be converted to a normal icon via iconTexture.get_icon?
        const [iconBuffer] = iconTexture.load(DOMINANT_COLOR_ICON_SIZE, null);
        return GdkPixbuf.Pixbuf.new_from_stream(iconBuffer, null);
    }

    /**
     * The backlight color choosing algorithm was mostly ported to javascript from the
     * Unity7 C++ source of Canonicals:
     * https://bazaar.launchpad.net/~unity-team/unity/trunk/view/head:/launcher/LauncherIcon.cpp
     * so it more or less works the same way.
     */
    _getColorPalette() {
        if (iconCacheMap.get(this._app.get_id())) {
            // We already know the answer
            return iconCacheMap.get(this._app.get_id());
        }

        const pixBuf = this._getIconPixBuf();
        if (!pixBuf)
            return null;

        let pixels = pixBuf.get_pixels();

        let total  = 0,
            rTotal = 0,
            gTotal = 0,
            bTotal = 0;

        let resampleX = 1;
        let resampleY = 1;

        // Resampling of large icons
        // We resample icons larger than twice the desired size, as the resampling
        // to a size s
        // DOMINANT_COLOR_ICON_SIZE < s < 2*DOMINANT_COLOR_ICON_SIZE,
        // most of the case exactly DOMINANT_COLOR_ICON_SIZE as the icon size is
        // typically a multiple of it.
        const width = pixBuf.get_width();
        const height = pixBuf.get_height();

        // Resample
        if (height >= 2 * DOMINANT_COLOR_ICON_SIZE)
            resampleY = Math.floor(height / DOMINANT_COLOR_ICON_SIZE);

        if (width >= 2 * DOMINANT_COLOR_ICON_SIZE)
            resampleX = Math.floor(width / DOMINANT_COLOR_ICON_SIZE);

        const nChannels = 4;
        if (resampleX !== 1 || resampleY !== 1)
            pixels = this._resamplePixels(pixels, width, height, nChannels, resampleX, resampleY);

        // computing the limit outside the for (where it would be repeated at each iteration)
        // for performance reasons
        const limit = pixels.length;
        for (let offset = 0; offset < limit; offset += 4) {
            const r = pixels[offset],
                g = pixels[offset + 1],
                b = pixels[offset + 2],
                a = pixels[offset + 3];

            const saturation = Math.max(r, g, b) - Math.min(r, g, b);
            const relevance  = 0.1 * 255 * 255 + 0.9 * a * saturation;

            rTotal += r * relevance;
            gTotal += g * relevance;
            bTotal += b * relevance;

            total += relevance;
        }

        total *= 255;

        const r = rTotal / total,
            g = gTotal / total,
            b = bTotal / total;

        const hsv = Utils.ColorUtils.RGBtoHSV(r * 255, g * 255, b * 255);

        if (hsv.s > 0.15)
            hsv.s = 0.65;
        hsv.v = 0.90;

        const rgb = Utils.ColorUtils.HSVtoRGB(hsv.h, hsv.s, hsv.v);

        // Cache the result.
        const backgroundColor = {
            lighter:  Utils.ColorUtils.ColorLuminance(rgb.r, rgb.g, rgb.b, 0.2),
            original: Utils.ColorUtils.ColorLuminance(rgb.r, rgb.g, rgb.b, 0),
            darker:   Utils.ColorUtils.ColorLuminance(rgb.r, rgb.g, rgb.b, -0.5),
        };

        if (iconCacheMap.size >= MAX_CACHED_ITEMS) {
            // delete oldest cached values (which are in order of insertions)
            let ctr = 0;
            for (const key of iconCacheMap.keys()) {
                if (++ctr > BATCH_SIZE_TO_DELETE)
                    break;
                iconCacheMap.delete(key);
            }
        }

        iconCacheMap.set(this._app.get_id(), backgroundColor);

        return backgroundColor;
    }

    /**
     * Downscale large icons before scanning for the backlight color to
     * improve performance.
     *
     * @param pixels
     * @param width
     * @param height
     * @param nChannels
     * @param resampleX
     * @param resampleY
     *
     * @returns [];
     */
    _resamplePixels(pixels, width, height, nChannels, resampleX, resampleY) {
        const resampledPixels = [];
        for (let y = 0; y < height; y += resampleY) {
            for (let x = 0; x < width; x += resampleX) {
                const offset = (y * width + x) * nChannels;
                for (let c = 0; c < nChannels; c++)
                    resampledPixels.push(pixels[offset + c]);
            }
        }
        return resampledPixels;
    }
}
