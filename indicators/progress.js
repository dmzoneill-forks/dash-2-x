// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: Contributors to XDock
import {
    GObject,
    St,
} from '../dependencies/gi.js';

import {
    Docking,
} from '../imports.js';

/*
 * A circular arc progress indicator overlaid on the icon.
 * Draws a background ring and a colored arc proportional to `progress`.
 */
export const ProgressArcDrawingArea = GObject.registerClass(
class ProgressArcDrawingArea extends St.DrawingArea {
    _init(params) {
        super._init({x_expand: true, y_expand: true, ...params});
        this._progress = 0;
    }

    set progress(value) {
        if (this._progress === value)
            return;
        this._progress = value;
        this.queue_repaint();
    }

    get progress() {
        return this._progress;
    }

    vfunc_repaint() {
        const cr = this.get_context();
        const [width, height] = this.get_surface_size();
        const centerX = width / 2;
        const centerY = height / 2;
        const lineWidth = Docking.DockManager.settings.progressArcWidth;
        const radius = Math.min(width, height) / 2 - lineWidth;

        cr.setLineWidth(lineWidth);

        // Background circle (dim)
        cr.setSourceRGBA(1, 1, 1, 0.2);
        cr.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        cr.stroke();

        // Progress arc (bright blue)
        cr.setSourceRGBA(0.3, 0.6, 1, 0.9);
        const startAngle = -Math.PI / 2; // 12 o'clock
        const endAngle = startAngle + (2 * Math.PI * this._progress);
        cr.arc(centerX, centerY, radius, startAngle, endAngle);
        cr.stroke();

        cr.$dispose();
    }
});
