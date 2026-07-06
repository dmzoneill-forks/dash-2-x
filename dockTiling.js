// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: Contributors to Dash 2 X
// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

import {
    Clutter,
    Meta,
    St,
} from './dependencies/gi.js';

import {
    Main,
    PointerWatcher,
} from './dependencies/shell/ui.js';

import {
    Utils,
} from './imports.js';

const EDGE_THRESHOLD_PX = 50;
const OVERLAY_TRANSITION_MS = 200;

/**
 * DockTiling - enables window tiling by dragging dock icons to screen edges.
 *
 * When a dock icon is dragged and the cursor approaches the left or right edge
 * of a monitor, a semi-transparent overlay highlights the target tile zone.
 * Dropping the icon in that zone tiles the application's most recent window
 * to the corresponding half of the screen.
 */
export class DockTiling {
    constructor() {
        this._signalsHandler = new Utils.GlobalSignalsHandler();
        this._overlay = null;
        this._tileSide = null; // 'left' or 'right'
        this._dragMonitorIndex = -1;
        this._dragApp = null;
        this._isDragging = false;
        this._pointerWatch = null;

        this._signalsHandler.add(
            Main.overview, 'item-drag-begin', (_ov, source) => this._onDragBegin(source),
            Main.overview, 'item-drag-end', () => this._onDragEnd(),
            Main.overview, 'item-drag-cancelled', () => this._onDragEnd()
        );
    }

    destroy() {
        this._onDragEnd();
        this._signalsHandler.destroy();
    }

    _onDragBegin(source) {
        const app = source?.app ?? source?._delegate?.app;
        if (!app)
            return;

        this._dragApp = app;
        this._isDragging = true;

        // Poll pointer position during drag
        this._pointerWatch = PointerWatcher.getPointerWatcher().addWatch(50,
            (x, y) => this._onPointerMoved(x, y));
    }

    _onDragEnd() {
        if (!this._isDragging)
            return;

        if (this._tileSide && this._dragApp)
            this._tileApp(this._dragApp, this._tileSide, this._dragMonitorIndex);

        this._isDragging = false;
        this._dragApp = null;
        this._tileSide = null;
        this._dragMonitorIndex = -1;

        this._hideOverlay();

        if (this._pointerWatch) {
            PointerWatcher.getPointerWatcher()._removeWatch(this._pointerWatch);
            this._pointerWatch = null;
        }
    }

    _onPointerMoved(x, _y) {
        if (!this._isDragging)
            return;

        const monitorIndex = global.display.get_current_monitor();
        const monitor = Main.layoutManager.monitors[monitorIndex];
        if (!monitor)
            return;

        const localX = x - monitor.x;
        let newSide = null;

        if (localX < EDGE_THRESHOLD_PX)
            newSide = 'left';
        else if (localX > monitor.width - EDGE_THRESHOLD_PX)
            newSide = 'right';

        if (newSide !== this._tileSide || monitorIndex !== this._dragMonitorIndex) {
            this._tileSide = newSide;
            this._dragMonitorIndex = monitorIndex;

            if (newSide)
                this._showOverlay(monitor, newSide);
            else
                this._hideOverlay();
        }
    }

    _showOverlay(monitor, side) {
        this._hideOverlay();

        const halfWidth = Math.floor(monitor.width / 2);
        const overlayX = side === 'left' ? monitor.x : monitor.x + halfWidth;
        const margin = 8;

        this._overlay = new St.Bin({
            style_class: 'dock-tiling-overlay',
            x: overlayX + margin,
            y: monitor.y + margin,
            width: halfWidth - margin * 2,
            height: monitor.height - margin * 2,
            opacity: 0,
            reactive: false,
        });

        Main.uiGroup.add_child(this._overlay);

        this._overlay.ease({
            opacity: 255,
            duration: OVERLAY_TRANSITION_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _hideOverlay() {
        if (!this._overlay)
            return;

        const overlay = this._overlay;
        this._overlay = null;

        overlay.ease({
            opacity: 0,
            duration: OVERLAY_TRANSITION_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                overlay.destroy();
            },
        });
    }

    _tileApp(app, side, monitorIndex) {
        const windows = app.get_windows().filter(w => !w.skipTaskbar);
        if (windows.length === 0) {
            // App is not running; launch it.  We cannot tile until the
            // window appears, so just launch for now.
            app.activate();
            return;
        }

        // Use the most recently focused window
        windows.sort((a, b) => b.get_user_time() - a.get_user_time());
        const [window] = windows;

        this._tileWindow(window, side, monitorIndex);
    }

    _tileWindow(window, side, monitorIndex) {
        const monitor = Main.layoutManager.monitors[monitorIndex];
        if (!monitor)
            return;

        const workArea = Main.layoutManager.getWorkAreaForMonitor(monitorIndex);

        // Unmaximize first so move_resize_frame works correctly
        if (window.get_maximized())
            window.unmaximize(Meta.MaximizeFlags.BOTH);

        // Activate the window first to bring it to front
        Main.activateWindow(window);

        const halfWidth = Math.floor(workArea.width / 2);
        const tileX = side === 'left' ? workArea.x : workArea.x + halfWidth;

        // Use move_resize_frame to position the window
        window.move_resize_frame(
            true, // user_op
            tileX,
            workArea.y,
            halfWidth,
            workArea.height
        );
    }
}
