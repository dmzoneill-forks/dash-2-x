// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: Contributors to XDock
// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

import {GObject, St} from './dependencies/gi.js';
import * as OverviewControls from 'resource:///org/gnome/shell/ui/overviewControls.js';
import {DockManager} from './docking.js';
import {Extension} from './dependencies/shell/extensions/extension.js';

// Guard runStartupAnimation against missing showAppsButton.
// In devkit/headless sessions, monitors arrive after extensions load,
// so xdock can't replace the dash before the startup animation runs.
const _origRunStartupAnimation =
    OverviewControls.ControlsManager.prototype.runStartupAnimation;
OverviewControls.ControlsManager.prototype.runStartupAnimation =
    function (...args) {
        if (!this.dash?.showAppsButton) {
            const btn = new St.Button({checked: false});
            if (this.dash)
                this.dash.showAppsButton = btn;
        }
        return _origRunStartupAnimation.call(this, ...args);
    };

// We export this so it can be accessed by other extensions
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
