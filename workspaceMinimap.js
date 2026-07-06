// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: Contributors to Dash 2 X

import {
    Clutter,
    GObject,
    St,
} from './dependencies/gi.js';

import {
    Docking,
    Utils,
} from './imports.js';

/**
 * A compact workspace indicator strip for the dock.
 *
 * Shows one small rectangle per workspace; the active workspace is
 * highlighted.  Clicking a rectangle switches to that workspace,
 * scrolling over the widget cycles workspaces.
 */
export const WorkspaceMinimap = GObject.registerClass(
class WorkspaceMinimap extends St.BoxLayout {
    _init() {
        const position = Utils.getPosition();
        const isHorizontal = position === St.Side.TOP ||
                             position === St.Side.BOTTOM;

        super._init({
            style_class: 'workspace-minimap',
            vertical: !isHorizontal,
            reactive: true,
            track_hover: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._isHorizontal = isHorizontal;
        this._indicators = [];
        this._signalsHandler = new Utils.GlobalSignalsHandler(this);

        const wsManager = global.workspace_manager;

        this._signalsHandler.add(
            [wsManager, 'workspace-added', () => this._rebuildIndicators()],
            [wsManager, 'workspace-removed', () => this._rebuildIndicators()],
            [wsManager, 'active-workspace-changed', () => this._updateActiveIndicator()],
            [wsManager, 'notify::n-workspaces', () => this._rebuildIndicators()]
        );

        this._rebuildIndicators();
    }

    /**
     * Rebuild the set of workspace indicator buttons from scratch.
     */
    _rebuildIndicators() {
        this.destroy_all_children();
        this._indicators = [];

        const wsManager = global.workspace_manager;
        const nWorkspaces = wsManager.get_n_workspaces();
        const activeIndex = wsManager.get_active_workspace().index();

        for (let i = 0; i < nWorkspaces; i++) {
            const btn = new St.Button({
                style_class: 'workspace-minimap-indicator',
                can_focus: true,
                track_hover: true,
                x_expand: false,
                y_expand: false,
            });

            if (i === activeIndex)
                btn.add_style_class_name('active');

            const wsIndex = i;
            btn.connect('clicked', () => {
                const ws = global.workspace_manager.get_workspace_by_index(wsIndex);
                if (ws)
                    ws.activate(global.get_current_time());
            });

            this.add_child(btn);
            this._indicators.push(btn);
        }
    }

    /**
     * Update which indicator carries the 'active' style class.
     */
    _updateActiveIndicator() {
        const wsManager = global.workspace_manager;
        const activeIndex = wsManager.get_active_workspace().index();

        for (let i = 0; i < this._indicators.length; i++) {
            if (i === activeIndex)
                this._indicators[i].add_style_class_name('active');
            else
                this._indicators[i].remove_style_class_name('active');
        }
    }

    /**
     * Handle scroll events to cycle workspaces.
     */
    vfunc_scroll_event(event) {
        const wsManager = global.workspace_manager;
        const activeIndex = wsManager.get_active_workspace().index();
        const nWorkspaces = wsManager.get_n_workspaces();

        let direction = event.get_scroll_direction();
        let newIndex = activeIndex;

        if (direction === Clutter.ScrollDirection.SMOOTH) {
            const [dx, dy] = event.get_scroll_delta();
            const delta = this._isHorizontal
                ? (Math.abs(dx) > Math.abs(dy) ? dx : dy)
                : dy;
            if (Math.abs(delta) < 0.5)
                return Clutter.EVENT_STOP;
            direction = delta > 0
                ? Clutter.ScrollDirection.DOWN
                : Clutter.ScrollDirection.UP;
        }

        if (direction === Clutter.ScrollDirection.UP ||
            direction === Clutter.ScrollDirection.LEFT)
            newIndex = Math.max(0, activeIndex - 1);
        else if (direction === Clutter.ScrollDirection.DOWN ||
                 direction === Clutter.ScrollDirection.RIGHT)
            newIndex = Math.min(nWorkspaces - 1, activeIndex + 1);

        if (newIndex !== activeIndex) {
            const ws = wsManager.get_workspace_by_index(newIndex);
            if (ws)
                ws.activate(global.get_current_time());
        }

        return Clutter.EVENT_STOP;
    }
});
