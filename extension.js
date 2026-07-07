// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: Contributors to XDock
// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

import {Main} from './dependencies/shell/ui.js';
import * as OverviewControls from 'resource:///org/gnome/shell/ui/overviewControls.js';
import {DockManager} from './docking.js';
import {Extension} from './dependencies/shell/extensions/extension.js';

const _origRunStartupAnimation =
    OverviewControls.ControlsManager.prototype.runStartupAnimation;
OverviewControls.ControlsManager.prototype.runStartupAnimation =
    async function (...args) {
        if (!Main.layoutManager._startingUp)
            return;
        try {
            await _origRunStartupAnimation.call(this, ...args);
        } catch {
            // Animation failed — non-fatal in devkit sessions
        }
    };

export let dockManager;

export default class DashToDockExtension extends Extension.Extension {
    enable() {
        try {
            dockManager = new DockManager(this);
        } catch (e) {
            logError(e, 'XDock: Failed to initialize DockManager');
            dockManager = null;
        }
    }

    disable() {
        try {
            dockManager?.destroy();
        } catch (e) {
            logError(e, 'XDock: Failed to destroy DockManager');
        }
        dockManager = null;
        OverviewControls.ControlsManager.prototype.runStartupAnimation =
            _origRunStartupAnimation;
    }
}
