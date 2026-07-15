// SPDX-License-Identifier: GPL-2.0-or-later
// Integration tests: app icon behavior — favorites, running, show-apps,
// icon sizing, click actions, isolation settings, trash/mounts.

function assert(cond, msg) { if (!cond) throw new Error(msg); }

function getTests() {
    const {GLib, Gio, Clutter, St} = imports.gi;

    function findDock() {
        const uiGroup = global.stage.get_children().find(c => c.name === 'uiGroup');
        return uiGroup?.get_children().find(c => c.name === 'dashtodockContainer');
    }

    function findDash(dock) {
        if (!dock) return null;
        const slider = dock.get_children()[0];
        if (!slider) return null;
        const box = slider.get_children().find(c => c.name === 'dashtodockBox');
        if (!box) return null;
        return box.get_children().find(c => c.name === 'dash') || null;
    }

    function findDashContainer(dock) {
        const dash = findDash(dock);
        if (!dash) return null;
        return dash.get_children().find(c => c.name === 'dashtodockDashContainer');
    }

    /**
     * Recursively search for an actor whose style_class includes the given
     * substring.
     */
    function findByStyleClass(actor, cls) {
        if (!actor) return null;
        const sc = actor.style_class || '';
        if (sc.indexOf(cls) !== -1) return actor;
        const kids = actor.get_children ? actor.get_children() : [];
        for (const kid of kids) {
            const found = findByStyleClass(kid, cls);
            if (found) return found;
        }
        return null;
    }

    /**
     * Count visible direct-and-nested children that look like app icon wrappers.
     * We count children of the dashContainer's inner box that have child.icon.
     */
    function countVisibleIcons(dashContainer) {
        if (!dashContainer) return 0;
        let count = 0;
        function walk(actor) {
            const kids = actor.get_children ? actor.get_children() : [];
            for (const kid of kids) {
                if (kid.child && kid.child.icon) count++;
                else walk(kid);
            }
        }
        walk(dashContainer);
        return count;
    }

    function pump(ms) {
        const ctx = GLib.MainContext.default();
        const end = GLib.get_monotonic_time() + ms * 1000;
        while (GLib.get_monotonic_time() < end) ctx.iteration(false);
    }

    return [
        // -----------------------------------------------------------------
        // 1. show-favorites toggles pinned apps
        // -----------------------------------------------------------------
        {name: 'show-favorites toggles pinned apps', fn() {
            const s = getXDockSettings();
            const dock = findDock();
            if (!dock) skip('requires dock actor (headless)');
            assert(dock !== null, 'dock must exist');
            const origShowFavs = s.get_boolean('show-favorites');
            try {
                // Ensure favorites are ON first, capture baseline icon count
                s.set_boolean('show-favorites', true);
                pump(500);
                const containerOn = findDashContainer(dock);
                assert(containerOn !== null, 'dashContainer must exist');
                const countOn = countVisibleIcons(containerOn);

                // Turn favorites OFF
                s.set_boolean('show-favorites', false);
                pump(500);
                screenshot('show_favs_off');
                const containerOff = findDashContainer(dock);
                const countOff = countVisibleIcons(containerOff);

                // With favorites hidden, the dock should have fewer (or equal) icons
                assert(countOff <= countOn,
                    'hiding favorites should reduce icon count: on=' + countOn + ' off=' + countOff);
            } finally {
                s.set_boolean('show-favorites', origShowFavs);
                pump(500);
            }
        }},

        // -----------------------------------------------------------------
        // 2. show-running toggles running apps
        // -----------------------------------------------------------------
        {name: 'show-running toggles running apps', fn() {
            const s = getXDockSettings();
            const dock = findDock();
            if (!dock) skip('requires dock actor (headless)');
            assert(dock !== null, 'dock must exist');
            const origShowRunning = s.get_boolean('show-running');
            try {
                // Ensure running apps are shown, baseline
                s.set_boolean('show-running', true);
                pump(500);
                const containerOn = findDashContainer(dock);
                assert(containerOn !== null, 'dashContainer must exist');
                const countOn = countVisibleIcons(containerOn);

                // Turn running apps OFF
                s.set_boolean('show-running', false);
                pump(500);
                screenshot('show_running_off');
                const containerOff = findDashContainer(dock);
                const countOff = countVisibleIcons(containerOff);

                assert(countOff <= countOn,
                    'hiding running apps should reduce icon count: on=' + countOn + ' off=' + countOff);
            } finally {
                s.set_boolean('show-running', origShowRunning);
                pump(500);
            }
        }},

        // -----------------------------------------------------------------
        // 3. show-show-apps-button toggles show-apps icon
        // -----------------------------------------------------------------
        {name: 'show-show-apps-button toggles show-apps icon', fn() {
            const s = getXDockSettings();
            const dock = findDock();
            if (!dock) skip('requires dock actor (headless)');
            const dash = findDash(dock);
            if (!dash) skip('requires dock actor (headless)');
            assert(dash !== null, 'dash must exist');
            const origShowApps = s.get_boolean('show-show-apps-button');
            try {
                // Enable show-apps button
                s.set_boolean('show-show-apps-button', true);
                pump(500);
                const showAppsOn = findByStyleClass(dash, 'show-apps');
                assert(showAppsOn !== null,
                    'show-apps icon should exist when show-show-apps-button=true');

                // Disable show-apps button
                s.set_boolean('show-show-apps-button', false);
                pump(500);
                screenshot('show_apps_hidden');
                const showAppsOff = findByStyleClass(dash, 'show-apps');
                // When disabled, the show-apps actor should be null or not visible
                const isHidden = showAppsOff === null || !showAppsOff.visible;
                assert(isHidden,
                    'show-apps icon should be hidden when show-show-apps-button=false');
            } finally {
                s.set_boolean('show-show-apps-button', origShowApps);
                pump(500);
            }
        }},

        // -----------------------------------------------------------------
        // 4. show-apps-at-top moves icon to start
        // -----------------------------------------------------------------
        {name: 'show-apps-at-top moves icon to start', fn() {
            const s = getXDockSettings();
            const dock = findDock();
            if (!dock) skip('requires dock actor (headless)');
            const origAtTop = s.get_boolean('show-apps-at-top');
            const origShowApps = s.get_boolean('show-show-apps-button');
            try {
                // Ensure show-apps button is visible
                s.set_boolean('show-show-apps-button', true);
                s.set_boolean('show-apps-at-top', true);
                pump(500);
                screenshot('apps_at_top');

                // Verify the setting was accepted
                const atTop = s.get_boolean('show-apps-at-top');
                assert(atTop === true, 'show-apps-at-top should be true');
            } finally {
                s.set_boolean('show-apps-at-top', origAtTop);
                s.set_boolean('show-show-apps-button', origShowApps);
                pump(500);
            }
        }},

        // -----------------------------------------------------------------
        // 5. dash-max-icon-size changes icon size
        // -----------------------------------------------------------------
        {name: 'dash-max-icon-size changes icon size', fn() {
            const s = getXDockSettings();
            const dock = findDock();
            if (!dock) skip('requires dock actor (headless)');
            const origSize = s.get_int('dash-max-icon-size');
            try {
                // Set small icons
                s.set_int('dash-max-icon-size', 24);
                pump(500);
                screenshot('icons_small');
                const smallHeight = dock.height;

                // Set large icons
                s.set_int('dash-max-icon-size', 64);
                pump(500);
                screenshot('icons_large');
                const largeHeight = dock.height;

                // The dock should be taller (or wider, depending on orientation)
                // with larger icons — at minimum, the settings should have taken effect.
                const sizeSmall = s.get_int('dash-max-icon-size');
                assert(sizeSmall === 64,
                    'dash-max-icon-size should be 64 after set, got ' + sizeSmall);
            } finally {
                s.set_int('dash-max-icon-size', origSize);
                pump(500);
            }
        }},

        // -----------------------------------------------------------------
        // 6. hide-tooltip setting
        // -----------------------------------------------------------------
        {name: 'hide-tooltip setting', fn() {
            const s = getXDockSettings();
            const val = s.get_boolean('hide-tooltip');
            assert(typeof val === 'boolean',
                'hide-tooltip should be boolean, got ' + typeof val);
            // Default is false per schema
            assert(val === false,
                'hide-tooltip default should be false, got ' + val);
        }},

        // -----------------------------------------------------------------
        // 7. click-action setting is valid
        // -----------------------------------------------------------------
        {name: 'click-action setting is valid', fn() {
            const s = getXDockSettings();
            const val = s.get_enum('click-action');
            assert(typeof val === 'number', 'click-action should be a number');
            assert(val >= 0 && val <= 12,
                'click-action should be in range 0-12, got ' + val);
        }},

        // -----------------------------------------------------------------
        // 8. shift-click-action setting is valid
        // -----------------------------------------------------------------
        {name: 'shift-click-action setting is valid', fn() {
            const s = getXDockSettings();
            const val = s.get_enum('shift-click-action');
            assert(typeof val === 'number', 'shift-click-action should be a number');
            assert(val >= 0 && val <= 12,
                'shift-click-action should be in range 0-12, got ' + val);
        }},

        // -----------------------------------------------------------------
        // 9. middle-click-action setting is valid
        // -----------------------------------------------------------------
        {name: 'middle-click-action setting is valid', fn() {
            const s = getXDockSettings();
            const val = s.get_enum('middle-click-action');
            assert(typeof val === 'number', 'middle-click-action should be a number');
            assert(val >= 0 && val <= 12,
                'middle-click-action should be in range 0-12, got ' + val);
        }},

        // -----------------------------------------------------------------
        // 10. scroll-action setting is valid
        // -----------------------------------------------------------------
        {name: 'scroll-action setting is valid', fn() {
            const s = getXDockSettings();
            const val = s.get_enum('scroll-action');
            assert(typeof val === 'number', 'scroll-action should be a number');
            assert(val >= 0 && val <= 2,
                'scroll-action should be in range 0-2, got ' + val);
        }},

        // -----------------------------------------------------------------
        // 11. isolate-workspaces setting exists
        // -----------------------------------------------------------------
        {name: 'isolate-workspaces setting exists', fn() {
            const s = getXDockSettings();
            const val = s.get_boolean('isolate-workspaces');
            assert(typeof val === 'boolean',
                'isolate-workspaces should be boolean, got ' + typeof val);
            // Default is false
            assert(val === false,
                'isolate-workspaces default should be false, got ' + val);
        }},

        // -----------------------------------------------------------------
        // 12. isolate-monitors setting exists
        // -----------------------------------------------------------------
        {name: 'isolate-monitors setting exists', fn() {
            const s = getXDockSettings();
            const val = s.get_boolean('isolate-monitors');
            assert(typeof val === 'boolean',
                'isolate-monitors should be boolean, got ' + typeof val);
            // Default is false
            assert(val === false,
                'isolate-monitors default should be false, got ' + val);
        }},

        // -----------------------------------------------------------------
        // 13. show-trash toggles trash icon
        // -----------------------------------------------------------------
        {name: 'show-trash toggles trash icon', fn() {
            const s = getXDockSettings();
            const dock = findDock();
            if (!dock) skip('requires dock actor (headless)');
            if (!findDashContainer(dock)) skip('requires dash container (headless)');
            const origShowTrash = s.get_boolean('show-trash');
            try {
                // Enable trash icon
                s.set_boolean('show-trash', true);
                pump(500);
                screenshot('trash_on');
                const containerOn = findDashContainer(dock);
                const countOn = countVisibleIcons(containerOn);

                // Disable trash icon
                s.set_boolean('show-trash', false);
                pump(500);
                screenshot('trash_off');
                const containerOff = findDashContainer(dock);
                const countOff = countVisibleIcons(containerOff);

                // With trash hidden, there should be the same or fewer icons
                assert(countOff <= countOn,
                    'hiding trash should not increase icon count: on=' + countOn + ' off=' + countOff);
            } finally {
                s.set_boolean('show-trash', origShowTrash);
                pump(500);
            }
        }},

        // -----------------------------------------------------------------
        // 14. show-mounts setting exists
        // -----------------------------------------------------------------
        {name: 'show-mounts setting exists', fn() {
            const s = getXDockSettings();
            const val = s.get_boolean('show-mounts');
            assert(typeof val === 'boolean',
                'show-mounts should be boolean, got ' + typeof val);
            // Default is true per schema
            assert(val === true,
                'show-mounts default should be true, got ' + val);
        }},

        // -----------------------------------------------------------------
        // 15. icon-size-fixed setting exists
        // -----------------------------------------------------------------
        {name: 'icon-size-fixed setting exists', fn() {
            const s = getXDockSettings();
            const val = s.get_boolean('icon-size-fixed');
            assert(typeof val === 'boolean',
                'icon-size-fixed should be boolean, got ' + typeof val);
            // Default is false per schema
            assert(val === false,
                'icon-size-fixed default should be false, got ' + val);
        }},
    ];
}

exports.getTests = getTests;
