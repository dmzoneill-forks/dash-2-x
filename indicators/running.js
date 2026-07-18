// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: Contributors to XDock
import {
    Cogl,
    St,
} from '../dependencies/gi.js';

import {
    Docking,
    Utils,
} from '../imports.js';

import {
    IndicatorDrawingArea,
    RunningIndicatorBase,
} from './base.js';

// We add a css class so third parties themes can limit their indicator customization
// to the case we do nothing
export class RunningIndicatorDefault extends RunningIndicatorBase {
    constructor(source) {
        super(source);
        this._source.add_style_class_name('default');
    }

    destroy() {
        this._source.remove_style_class_name('default');
        super.destroy();
    }
}

export class RunningIndicatorDots extends RunningIndicatorBase {
    constructor(source) {
        super(source);

        this._hideDefaultDot();

        this._area = new IndicatorDrawingArea({
            x_expand: true,
            y_expand: true,
        });

        // We draw for the bottom case and rotate the canvas for other placements
        // set center of rotations to the center
        this._area.set_pivot_point(0.5, 0.5);

        switch (this._side) {
        case St.Side.TOP:
            this._area.rotation_angle_z = 180;
            break;

        case St.Side.BOTTOM:
            // nothing
            break;

        case St.Side.LEFT:
            this._area.rotation_angle_z = 90;
            break;

        case St.Side.RIGHT:
            this._area.rotation_angle_z = -90;
            break;
        }

        this._area.connectObject('repaint', this._updateIndicator.bind(this), this);
        this._source._iconContainer.add_child(this._area);

        const keys = ['custom-theme-running-dots-color',
            'custom-theme-running-dots-border-color',
            'custom-theme-running-dots-border-width',
            'custom-theme-customize-running-dots',
            'unity-backlit-items',
            'apply-glossy-effect',
            'running-indicator-dominant-color'];

        this._styleDirty = true;
        keys.forEach(function (key) {
            this._signalsHandler.add(
                Docking.DockManager.settings,
                `changed::${key}`,
                () => {
                    this._styleDirty = true;
                    this.update();
                }
            );
        }, this);
    }

    update() {
        super.update();

        // Enable / Disable the backlight and glossy effects for running apps
        if (!Docking.DockManager.settings.applyCustomTheme &&
            Docking.DockManager.settings.unityBacklitItems &&
            this._source.running) {
            this._enableBacklight();
            if (Docking.DockManager.settings.applyGlossyEffect)
                this._enableGlossy();
            else
                this._disableGlossy();
        } else {
            this._disableBacklight();
            this._disableGlossy();
        }

        if (this._area)
            this._area.queue_repaint();
    }

    _computeStyle() {
        if (!this._styleDirty)
            return;
        this._styleDirty = false;
        const [width, height] = this._area.get_surface_size();
        this._width = width;
        this._height = height;

        // By default re-use the style - background color, and border width and color -
        // of the default dot
        const themeNode = this._source._dot.get_theme_node();
        this._borderColor = themeNode.get_border_color(this._side);
        this._borderWidth = themeNode.get_border_width(this._side);
        this._bodyColor = themeNode.get_background_color();

        const {settings} = Docking.DockManager;
        if (!settings.applyCustomTheme) {
            // Adjust for the backlit case
            const {Color} = Cogl;

            if (settings.unityBacklitItems) {
                // Use dominant color for dots too if the backlit is enables
                const colorPalette = this._dominantColorExtractor._getColorPalette();

                // Slightly adjust the styling
                this._borderWidth = 2;

                if (colorPalette) {
                    [, this._borderColor] = Color.from_string(colorPalette.lighter);
                    [, this._bodyColor] = Color.from_string(colorPalette.darker);
                } else {
                    // Fallback
                    [, this._borderColor] = Color.from_string('white');
                    [, this._bodyColor] = Color.from_string('gray');
                }
            }

            // Apply dominant color if requested
            if (settings.runningIndicatorDominantColor) {
                const colorPalette = this._dominantColorExtractor._getColorPalette();
                if (colorPalette)
                    [, this._bodyColor] = Color.from_string(colorPalette.original);
                else
                    // Fallback
                    [, this._bodyColor] = Color.from_string(settings.customThemeRunningDotsColor);
            }

            // Finally, use customize style if requested
            if (settings.customThemeCustomizeRunningDots) {
                [, this._borderColor] = Color.from_string(settings.customThemeRunningDotsBorderColor);
                this._borderWidth = settings.customThemeRunningDotsBorderWidth;
                [, this._bodyColor] =  Color.from_string(settings.customThemeRunningDotsColor);
            }
        }

        // Define the radius as an arbitrary size, but keep large enough to account
        // for the drawing of the border.
        this._radius = Math.max(this._width / 22, this._borderWidth / 2);
        this._padding = 0; // distance from the margin
        this._spacing = this._radius + this._borderWidth; // separation between the dots
    }

    _updateIndicator() {
        const cr = this._area.get_context();

        this._computeStyle();
        this._drawIndicator(cr);
        cr.$dispose();
    }

    _drawIndicator(cr) {
        // Draw the required numbers of dots
        const n = this._number;

        cr.setLineWidth(this._borderWidth);
        Utils.cairoSetSourceColor(cr, this._borderColor);

        // draw for the bottom case:
        cr.translate(
            (this._width - (2 * n) * this._radius - (n - 1) * this._spacing) / 2,
            this._height - this._padding);

        for (let i = 0; i < n; i++) {
            cr.newSubPath();
            cr.arc((2 * i + 1) * this._radius + i * this._spacing,
                -this._radius - this._borderWidth / 2,
                this._radius, 0, 2 * Math.PI);
        }

        cr.strokePreserve();
        Utils.cairoSetSourceColor(cr, this._bodyColor);
        cr.fill();
    }

    destroy() {
        this._area.destroy();
        delete this._area;
        super.destroy();
    }
}

// Adapted from dash-to-panel by Jason DeRose
// https://github.com/jderose9/dash-to-panel
export class RunningIndicatorCiliora extends RunningIndicatorDots {
    _drawIndicator(cr) {
        if (this._source.running) {
            const size =  Math.max(this._width / 20, this._borderWidth);
            const spacing = size; // separation between the dots
            const lineLength = this._width - (size * (this._number - 1)) - (spacing * (this._number - 1));
            let padding = this._borderWidth;
            // For the backlit case here we don't want the outer border visible
            if (Docking.DockManager.settings.unityBacklitItems &&
                !Docking.DockManager.settings.customThemeCustomizeRunningDots)
                padding = 0;
            const yOffset = this._height - padding - size;

            cr.setLineWidth(this._borderWidth);
            Utils.cairoSetSourceColor(cr, this._borderColor);

            cr.translate(0, yOffset);
            cr.newSubPath();
            cr.rectangle(0, 0, lineLength, size);
            for (let i = 1; i < this._number; i++) {
                cr.newSubPath();
                cr.rectangle(lineLength + (i * spacing) + ((i - 1) * size), 0, size, size);
            }

            cr.strokePreserve();
            Utils.cairoSetSourceColor(cr, this._bodyColor);
            cr.fill();
        }
    }
}

// Adapted from dash-to-panel by Jason DeRose
// https://github.com/jderose9/dash-to-panel
export class RunningIndicatorSegmented extends RunningIndicatorDots {
    _drawIndicator(cr) {
        if (this._source.running) {
            const size =  Math.max(this._width / 20, this._borderWidth);
            const spacing = Math.ceil(this._width / 18); // separation between the dots
            const dashLength = Math.ceil((this._width - ((this._number - 1) * spacing)) / this._number);
            let padding = this._borderWidth;
            // For the backlit case here we don't want the outer border visible
            if (Docking.DockManager.settings.unityBacklitItems &&
                !Docking.DockManager.settings.customThemeCustomizeRunningDots)
                padding = 0;
            const yOffset = this._height - padding - size;

            cr.setLineWidth(this._borderWidth);
            Utils.cairoSetSourceColor(cr, this._borderColor);

            cr.translate(0, yOffset);
            for (let i = 0; i < this._number; i++) {
                cr.newSubPath();
                cr.rectangle(i * dashLength + i * spacing, 0, dashLength, size);
            }

            cr.strokePreserve();
            Utils.cairoSetSourceColor(cr, this._bodyColor);
            cr.fill();
        }
    }
}

// Adapted from dash-to-panel by Jason DeRose
// https://github.com/jderose9/dash-to-panel
export class RunningIndicatorSolid extends RunningIndicatorDots {
    _drawIndicator(cr) {
        if (this._source.running) {
            const size =  Math.max(this._width / 20, this._borderWidth);
            let padding = this._borderWidth;
            // For the backlit case here we don't want the outer border visible
            if (Docking.DockManager.settings.unityBacklitItems &&
                !Docking.DockManager.settings.customThemeCustomizeRunningDots)
                padding = 0;
            const yOffset = this._height - padding - size;

            cr.setLineWidth(this._borderWidth);
            Utils.cairoSetSourceColor(cr, this._borderColor);

            cr.translate(0, yOffset);
            cr.newSubPath();
            cr.rectangle(0, 0, this._width, size);

            cr.strokePreserve();
            Utils.cairoSetSourceColor(cr, this._bodyColor);
            cr.fill();
        }
    }
}

// Adapted from dash-to-panel by Jason DeRose
// https://github.com/jderose9/dash-to-panel
export class RunningIndicatorSquares extends RunningIndicatorDots {
    _drawIndicator(cr) {
        if (this._source.running) {
            const size =  Math.max(this._width / 11, this._borderWidth);
            const padding = this._borderWidth;
            const spacing = Math.ceil(this._width / 18); // separation between the dots
            const yOffset = this._height - padding - size;

            cr.setLineWidth(this._borderWidth);
            Utils.cairoSetSourceColor(cr, this._borderColor);

            cr.translate(
                Math.floor((this._width - this._number * size - (this._number - 1) * spacing) / 2),
                yOffset);

            for (let i = 0; i < this._number; i++) {
                cr.newSubPath();
                cr.rectangle(i * size + i * spacing, 0, size, size);
            }
            cr.strokePreserve();
            Utils.cairoSetSourceColor(cr, this._bodyColor);
            cr.fill();
        }
    }
}

// Adapted from dash-to-panel by Jason DeRose
// https://github.com/jderose9/dash-to-panel
export class RunningIndicatorDashes extends RunningIndicatorDots {
    _drawIndicator(cr) {
        if (this._source.running) {
            const size =  Math.max(this._width / 20, this._borderWidth);
            const padding = this._borderWidth;
            const spacing = Math.ceil(this._width / 18); // separation between the dots
            const dashLength = Math.floor(this._width / 4) - spacing;
            const yOffset = this._height - padding - size;

            cr.setLineWidth(this._borderWidth);
            Utils.cairoSetSourceColor(cr, this._borderColor);

            cr.translate(
                Math.floor((this._width - this._number * dashLength - (this._number - 1) * spacing) / 2),
                yOffset);

            for (let i = 0; i < this._number; i++) {
                cr.newSubPath();
                cr.rectangle(i * dashLength + i * spacing, 0, dashLength, size);
            }

            cr.strokePreserve();
            Utils.cairoSetSourceColor(cr, this._bodyColor);
            cr.fill();
        }
    }
}

// Adapted from dash-to-panel by Jason DeRose
// https://github.com/jderose9/dash-to-panel
export class RunningIndicatorMetro extends RunningIndicatorDots {
    constructor(source) {
        super(source);
        this._source.add_style_class_name('metro');
    }

    destroy() {
        this._source.remove_style_class_name('metro');
        super.destroy();
    }

    _drawIndicator(cr) {
        if (this._source.running) {
            const size =  Math.max(this._width / 20, this._borderWidth);
            let padding = 0;
            // For the backlit case here we don't want the outer border visible
            if (Docking.DockManager.settings.unityBacklitItems &&
                !Docking.DockManager.settings.customThemeCustomizeRunningDots)
                padding = 0;
            const yOffset = this._height - padding - size;

            const n = this._number;
            if (n <= 1) {
                cr.translate(0, yOffset);
                Utils.cairoSetSourceColor(cr, this._bodyColor);
                cr.newSubPath();
                cr.rectangle(0, 0, this._width, size);
                cr.fill();
            } else {
                // need to scale with the SVG for the stacked highlight
                const blackenedLength = (1 / 48) * this._width;
                const darkenedLength = this._source.focused
                    ? (2 / 48) * this._width : (10 / 48) * this._width;
                const [h, s, l] = this._bodyColor.to_hsl();
                const blackenedColor = Cogl.Color.init_from_hsl(h, s * 0.3, l * 0.3);
                const darkenedColor = Cogl.Color.init_from_hsl(h, s * 0.7, l * 0.7);


                cr.translate(0, yOffset);

                Utils.cairoSetSourceColor(cr, this._bodyColor);
                cr.newSubPath();
                cr.rectangle(0, 0, this._width - darkenedLength - blackenedLength, size);
                cr.fill();
                Utils.cairoSetSourceColor(cr, blackenedColor);
                cr.newSubPath();
                cr.rectangle(this._width - darkenedLength - blackenedLength, 0, 1, size);
                cr.fill();
                Utils.cairoSetSourceColor(cr, darkenedColor);
                cr.newSubPath();
                cr.rectangle(this._width - darkenedLength, 0, darkenedLength, size);
                cr.fill();
            }
        }
    }
}

export class RunningIndicatorBinary extends RunningIndicatorDots {
    _drawIndicator(cr) {
        // Draw the required numbers of dots
        const n = Math.min(15, this._source.windowsCount);

        if (this._source.running) {
            const size =  Math.max(this._width / 11, this._borderWidth);
            const spacing = Math.ceil(this._width / 18);
            const yOffset = this._height - size;
            const binaryValue = String(`0000${(n >>> 0).toString(2)}`).slice(-4);

            cr.setLineWidth(this._borderWidth);
            Utils.cairoSetSourceColor(cr, this._borderColor);

            cr.translate(Math.floor((this._width - 4 * size - (4 - 1) * spacing) / 2), yOffset);
            for (let i = 0; i < binaryValue.length; i++) {
                if (binaryValue[i] === '1') {
                    cr.newSubPath();
                    cr.arc((2 * i + 1) * this._radius + i * spacing,
                        -this._radius - this._borderWidth / 2,
                        this._radius, 0, 2 * Math.PI);
                } else {
                    cr.newSubPath();
                    cr.rectangle(i * size + i * spacing,
                        -this._radius - this._borderWidth / 2 - size / 5,
                        size, size / 3);
                }
            }
            cr.strokePreserve();
            Utils.cairoSetSourceColor(cr, this._bodyColor);
            cr.fill();
        }
    }
}

export class RunningIndicatorDot extends RunningIndicatorDots {
    _computeStyle() {
        super._computeStyle();

        this._radius = Math.max(this._width / 26, this._borderWidth / 2);
    }

    _drawIndicator(cr) {
        if (!this._source.running)
            return;

        cr.setLineWidth(this._borderWidth);
        Utils.cairoSetSourceColor(cr, this._borderColor);

        // draw from the bottom case:
        cr.translate(
            (this._width - 2 * this._radius) / 2,
            this._height - this._padding);
        cr.newSubPath();
        cr.arc(this._radius,
            -this._radius - this._borderWidth / 2,
            this._radius, 0, 2 * Math.PI);

        cr.strokePreserve();
        Utils.cairoSetSourceColor(cr, this._bodyColor);
        cr.fill();
    }
}

// Hide all running indicators entirely
export class RunningIndicatorNone extends RunningIndicatorBase {
    constructor(source) {
        super(source);
        this._hideDefaultDot();
    }

    update() {
        // Do not call super.update() to avoid showing the default dot
        this._updateCounterClass();
    }

    destroy() {
        this._restoreDefaultDot();
        super.destroy();
    }
}
