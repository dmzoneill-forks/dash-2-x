// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: Contributors to XDock
// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

import {
    Clutter,
    GLib,
    GObject,
    Shell,
    St,
} from '../dependencies/gi.js';

import {
    Main,
} from '../dependencies/shell/ui.js';

import {
    Docking,
    Utils,
} from '../imports.js';

const MAX_RESULTS = 8;

/**
 * Fuzzy-match: check if all characters of the query appear in order
 * in the target string (case-insensitive).
 *
 * Returns a score (lower is better) or -1 if no match.
 *   - Exact prefix match gets score 0.
 *   - Otherwise, score = sum of gaps between matched character positions.
 *
 * @param {string} query - search query
 * @param {string} target - string to match against
 * @returns {number} match score, or -1 if no match
 */
function fuzzyMatch(query, target) {
    const q = query.toLowerCase();
    const t = target.toLowerCase();

    // Exact prefix match
    if (t.startsWith(q))
        return 0;

    let qi = 0;
    let lastMatchPos = -1;
    let score = 0;

    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
        if (t[ti] === q[qi]) {
            if (lastMatchPos >= 0)
                score += ti - lastMatchPos - 1;
            lastMatchPos = ti;
            qi++;
        }
    }

    // All query chars matched?
    if (qi === q.length)
        return score + 1; // +1 so prefix match (score 0) always wins

    return -1;
}

/**
 * A single result row in the command palette.
 */
const CommandPaletteResult = GObject.registerClass(
class CommandPaletteResult extends St.Button {
    _init(app) {
        super._init({
            style_class: 'command-palette-result',
            reactive: true,
            can_focus: true,
            track_hover: true,
            x_expand: true,
        });

        this._app = app;

        const box = new St.BoxLayout({
            vertical: false,
            x_expand: true,
        });

        // App icon
        const appIcon = app.create_icon_texture(24);
        appIcon.add_style_class_name('command-palette-result-icon');
        box.add_child(appIcon);

        // Text column
        const textBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const nameLabel = new St.Label({
            text: app.get_name(),
            style_class: 'command-palette-result-name',
            x_expand: true,
        });
        textBox.add_child(nameLabel);

        const description = app.get_description();
        if (description) {
            const descLabel = new St.Label({
                text: description,
                style_class: 'command-palette-result-desc',
                x_expand: true,
            });
            descLabel.clutter_text.set_ellipsize(3); // PANGO_ELLIPSIZE_END
            textBox.add_child(descLabel);
        }

        box.add_child(textBox);
        this.set_child(box);
    }

    get app() {
        return this._app;
    }
});

/**
 * CommandPalette: a fuzzy-search launcher overlay anchored to the dock.
 *
 * Shown via DockManager.toggleCommandPalette(), dismissed by Escape,
 * clicking outside, or launching an app.
 */
export const CommandPalette = GObject.registerClass({
    Signals: {
        'open-state-changed': {param_types: [GObject.TYPE_BOOLEAN]},
    },
}, class CommandPalette extends St.BoxLayout {
    _init() {
        super._init({
            style_class: 'command-palette',
            vertical: true,
            visible: false,
            reactive: true,
            can_focus: true,
        });

        this._isOpen = false;
        this._selectedIndex = -1;
        this._resultButtons = [];

        // Search entry
        this._entry = new St.Entry({
            style_class: 'command-palette-entry',
            hint_text: 'Search apps and actions...',
            can_focus: true,
            x_expand: true,
        });
        this.add_child(this._entry);

        // Results scroll view
        this._scrollView = new St.ScrollView({
            style_class: 'command-palette-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            x_expand: true,
            y_expand: true,
        });

        this._resultsBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
        });

        Utils.addActor(this._scrollView, this._resultsBox);
        this.add_child(this._scrollView);

        // Signals
        this._signalsHandler = new Utils.GlobalSignalsHandler(this);

        this._entry.clutter_text.connect('text-changed', () => {
            this._onSearchTextChanged();
        });

        this._entry.clutter_text.connect('key-press-event',
            (_actor, event) => this._onKeyPress(event));

        // Click-outside detection: capture stage events when open
        this._captureEventId = 0;
    }

    _onDestroy() {
        this._removeCapture();
        this._signalsHandler?.destroy();
    }

    get isOpen() {
        return this._isOpen;
    }

    toggle() {
        if (this._isOpen)
            this.close();
        else
            this.open();
    }

    open() {
        if (this._isOpen)
            return;

        this._isOpen = true;
        this.visible = true;

        // Position relative to the dock
        this._updatePosition();

        // Clear previous search
        this._entry.set_text('');
        this._clearResults();

        // Populate with all apps initially (top 8 by name)
        this._populateInitialResults();

        // Focus the entry
        this._entry.grab_key_focus();

        // Set up click-outside capture
        this._installCapture();

        this.emit('open-state-changed', true);
    }

    close() {
        if (!this._isOpen)
            return;

        this._isOpen = false;
        this.visible = false;

        this._removeCapture();
        this._clearResults();

        this.emit('open-state-changed', false);
    }

    _installCapture() {
        this._removeCapture();
        this._captureEventId = global.stage.connect(
            'captured-event', (_actor, event) => {
                if (event.type() === Clutter.EventType.BUTTON_PRESS ||
                    event.type() === Clutter.EventType.TOUCH_BEGIN) {
                    const [x, y] = event.get_coords();
                    const [actorX, actorY] = this.get_transformed_position();
                    const [actorW, actorH] = this.get_transformed_size();

                    if (x < actorX || x > actorX + actorW ||
                        y < actorY || y > actorY + actorH) {
                        this.close();
                        return Clutter.EVENT_STOP;
                    }
                }
                return Clutter.EVENT_PROPAGATE;
            });
    }

    _removeCapture() {
        if (this._captureEventId) {
            global.stage.disconnect(this._captureEventId);
            this._captureEventId = 0;
        }
    }

    _updatePosition() {
        const dockManager = Docking.DockManager.getDefault();
        if (!dockManager)
            return;

        const {mainDock} = dockManager;
        if (!mainDock)
            return;

        const position = Utils.getPosition();
        const monitor = Main.layoutManager.monitors[mainDock.monitorIndex];
        if (!monitor)
            return;

        // Get dock position info
        const [dockX, dockY] = mainDock.get_transformed_position();
        const [dockW, dockH] = mainDock.get_transformed_size();

        // The palette width is fixed via CSS (~320px). Get the natural size.
        const [, natW] = this.get_preferred_width(-1);
        const [, natH] = this.get_preferred_height(natW);

        const paletteW = Math.min(natW || 320, 320);
        const paletteH = Math.min(natH || 400, monitor.height * 0.6);

        let x, y;

        switch (position) {
        case St.Side.BOTTOM:
            // Above the dock, centered horizontally
            x = dockX + (dockW - paletteW) / 2;
            y = dockY - paletteH - 8;
            break;
        case St.Side.TOP:
            // Below the dock, centered horizontally
            x = dockX + (dockW - paletteW) / 2;
            y = dockY + dockH + 8;
            break;
        case St.Side.LEFT:
            // To the right of the dock, vertically centered
            x = dockX + dockW + 8;
            y = dockY + (dockH - paletteH) / 2;
            break;
        case St.Side.RIGHT:
            // To the left of the dock, vertically centered
            x = dockX - paletteW - 8;
            y = dockY + (dockH - paletteH) / 2;
            break;
        default:
            x = monitor.x + (monitor.width - paletteW) / 2;
            y = monitor.y + (monitor.height - paletteH) / 2;
        }

        // Clamp to monitor bounds
        x = Math.max(monitor.x, Math.min(x, monitor.x + monitor.width - paletteW));
        y = Math.max(monitor.y, Math.min(y, monitor.y + monitor.height - paletteH));

        this.set_position(Math.round(x), Math.round(y));
    }

    _getInstalledApps() {
        const appSystem = Shell.AppSystem.get_default();
        return appSystem.get_installed()
            .filter(appInfo => {
                if (!appInfo)
                    return false;
                if (appInfo.get_nodisplay())
                    return false;
                const app = appSystem.lookup_app(appInfo.get_id());
                return app !== null;
            })
            .map(appInfo => appSystem.lookup_app(appInfo.get_id()))
            .filter(app => app !== null);
    }

    _populateInitialResults() {
        const apps = this._getInstalledApps();
        // Sort alphabetically, show first MAX_RESULTS
        apps.sort((a, b) => a.get_name().localeCompare(b.get_name()));
        this._showResults(apps.slice(0, MAX_RESULTS));
    }

    _onSearchTextChanged() {
        const text = this._entry.get_text().trim();
        if (text.length === 0) {
            this._populateInitialResults();
            return;
        }

        const apps = this._getInstalledApps();
        const scored = [];

        for (const app of apps) {
            const nameScore = fuzzyMatch(text, app.get_name());
            const descScore = app.get_description()
                ? fuzzyMatch(text, app.get_description())
                : -1;

            // Take the better of name/description match
            let bestScore = -1;
            if (nameScore >= 0 && descScore >= 0)
                bestScore = Math.min(nameScore, descScore);
            else if (nameScore >= 0)
                bestScore = nameScore;
            else if (descScore >= 0)
                bestScore = descScore + 100; // Penalize description-only matches

            if (bestScore >= 0)
                scored.push({app, score: bestScore});
        }

        // Sort by score (lower is better)
        scored.sort((a, b) => a.score - b.score);

        this._showResults(scored.slice(0, MAX_RESULTS).map(s => s.app));
    }

    _clearResults() {
        this._resultsBox.destroy_all_children();
        this._resultButtons = [];
        this._selectedIndex = -1;
    }

    _showResults(apps) {
        this._clearResults();

        for (let i = 0; i < apps.length; i++) {
            const app = apps[i];
            const button = new CommandPaletteResult(app);

            button.connect('clicked', () => {
                this._activateApp(app);
            });

            this._resultsBox.add_child(button);
            this._resultButtons.push(button);
        }

        // Auto-select first result
        if (this._resultButtons.length > 0)
            this._selectIndex(0);
    }

    _selectIndex(index) {
        // Deselect old
        if (this._selectedIndex >= 0 && this._selectedIndex < this._resultButtons.length)
            this._resultButtons[this._selectedIndex].remove_style_class_name('selected');

        this._selectedIndex = index;

        // Select new
        if (this._selectedIndex >= 0 && this._selectedIndex < this._resultButtons.length)
            this._resultButtons[this._selectedIndex].add_style_class_name('selected');
    }

    _onKeyPress(event) {
        const symbol = event.get_key_symbol();

        switch (symbol) {
        case Clutter.KEY_Escape:
            this.close();
            return Clutter.EVENT_STOP;

        case Clutter.KEY_Down:
            if (this._resultButtons.length > 0) {
                const next = (this._selectedIndex + 1) % this._resultButtons.length;
                this._selectIndex(next);
            }
            return Clutter.EVENT_STOP;

        case Clutter.KEY_Up:
            if (this._resultButtons.length > 0) {
                const prev = this._selectedIndex <= 0
                    ? this._resultButtons.length - 1
                    : this._selectedIndex - 1;
                this._selectIndex(prev);
            }
            return Clutter.EVENT_STOP;

        case Clutter.KEY_Return:
        case Clutter.KEY_KP_Enter:
            if (this._selectedIndex >= 0 && this._selectedIndex < this._resultButtons.length) {
                const {app} = this._resultButtons[this._selectedIndex];
                this._activateApp(app);
            }
            return Clutter.EVENT_STOP;

        case Clutter.KEY_Tab:
            // Tab moves to next result, like Down
            if (this._resultButtons.length > 0) {
                const next = (this._selectedIndex + 1) % this._resultButtons.length;
                this._selectIndex(next);
            }
            return Clutter.EVENT_STOP;

        default:
            return Clutter.EVENT_PROPAGATE;
        }
    }

    _activateApp(app) {
        this.close();

        // Small delay so the palette closes visually before the app starts
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            app.activate();
            return GLib.SOURCE_REMOVE;
        });
    }

    destroy() {
        this._removeCapture();
        super.destroy();
    }
});
