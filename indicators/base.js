// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: Contributors to XDock
import {
    GObject,
    St,
} from '../dependencies/gi.js';

import {
    Docking,
    Utils,
} from '../imports.js';

import {DominantColorExtractor} from './colorExtractor.js';

export const MAX_WINDOWS_CLASSES = 4;

/*
 * Base class to be inherited by all indicators of any kind
*/
export class IndicatorBase {
    constructor(source) {
        this._source = source;
        this._signalsHandler = new Utils.GlobalSignalsHandler(this._source);
    }

    update() {
    }

    destroy() {
        this._source = null;
        this._signalsHandler.destroy();
        this._signalsHandler = null;
    }
}

/*
 * A base indicator class for running style, from which all other RunningIndicators should derive,
 * providing some basic methods, variables definitions and their update,  css style classes handling.
 *
 */
export class RunningIndicatorBase extends IndicatorBase {
    constructor(source) {
        super(source);

        this._side = Utils.getPosition(this._source.monitorIndex);
        this._dominantColorExtractor = new DominantColorExtractor(this._source.app);
        this._signalsHandler.add(this._source, 'notify::running', () => this.update());
        this._signalsHandler.add(this._source, 'notify::focused', () => this.update());
        this._signalsHandler.add(this._source, 'notify::windows-count', () => this._updateCounterClass());
        this.update();
    }

    get _number() {
        return Math.min(this._source.windowsCount, MAX_WINDOWS_CLASSES);
    }

    update() {
        this._updateCounterClass();
        this._updateDefaultDot();
    }

    _updateCounterClass() {
        for (let i = 1; i <= MAX_WINDOWS_CLASSES; i++) {
            const className = `running${i}`;
            if (i !== this._number)
                this._source.remove_style_class_name(className);
            else
                this._source.add_style_class_name(className);
        }
    }

    _updateDefaultDot() {
        if (this._source.running)
            this._source._dot.show();
        else
            this._source._dot.hide();
    }

    _hideDefaultDot() {
        // I use opacity to hide the default dot because the show/hide function
        // are used by the parent class.
        this._source._dot.opacity = 0;
    }

    _restoreDefaultDot() {
        this._source._dot.opacity = 255;
    }

    _enableBacklight() {
        this._source._iconContainer.add_style_class_name('app-icon-backlit');

        const colorPalette = this._dominantColorExtractor._getColorPalette();

        // When a dominant color is available, override the CSS fallback
        // with per-app colors via inline style
        if (colorPalette) {
            this._source._iconContainer.set_style(
                `background-gradient-start: ${colorPalette.original};` +
                `background-gradient-end: ${colorPalette.darker};`
            );
        } else {
            this._source._iconContainer.set_style(null);
        }
    }

    _disableBacklight() {
        this._source._iconContainer.remove_style_class_name('app-icon-backlit');
        this._source._iconContainer.set_style(null);
    }

    destroy() {
        this._disableBacklight();
        this._disableGlossy();
        this._restoreDefaultDot();

        super.destroy();
    }

    _enableGlossy() {
        const [icon] = this._source._iconContainer.get_children();
        if (icon) {
            icon.add_style_class_name('app-icon-glossy');
            const {extension} = Docking.DockManager;
            icon.set_style(
                `background-image: url('${extension.path}/media/glossy.svg');`
            );
        }
    }

    _disableGlossy() {
        const children = this._source._iconContainer.get_children();
        if (children.length > 0) {
            const [icon] = children;
            icon.remove_style_class_name('app-icon-glossy');
            icon.set_style(null);
        }
    }
}

export const IndicatorDrawingArea = GObject.registerClass(
class IndicatorDrawingArea extends St.DrawingArea {
    vfunc_allocate(box) {
        if (box.x1 !== 0 || box.y1 !== 0)
            return super.vfunc_allocate(box);

        // We assume that the are is a rectangle in the operations below:
        const size = Math.min(box.get_width(), box.get_height());
        box.x2 = size;
        box.y2 = size;
        this.set_allocation(box);

        return super.vfunc_allocate(box);
    }
});
