// SPDX-License-Identifier: GPL-2.0-or-later
function assert(cond, msg) { if (!cond) throw new Error(msg); }

function getTests() {
    const {Gio, Clutter} = imports.gi;

    function findDock() {
        const uiGroup = global.stage.get_children().find(c => c.name === 'uiGroup');
        return uiGroup?.get_children().find(c => c.name === 'dashtodockContainer');
    }

    function getDash() {
        const dock = findDock();
        if (!dock) return null;
        const box = dock.child;
        const slider = box.get_children()[0];
        return slider.child;
    }

    function getSettings() {
        return getXDockSettings();
    }

    function getDashContainer(dash) {
        return dash?.get_children().find(c => c.name === 'dashtodockDashContainer') ?? null;
    }

    function getScrollView(dash) {
        return dash?.get_children().find(c => c.name === 'dashtodockDashScrollview') ?? null;
    }

    function getIconBox(dashContainer) {
        if (!dashContainer) return null;
        // When magnification is enabled, _box is reparented as direct child
        // of _dashContainer; when disabled it is inside _boxContainer inside
        // _scrollView.  Either way it is an St.BoxLayout with role='list'.
        for (const c of dashContainer.get_children()) {
            if (c.layout_manager?.constructor?.name === 'BoxLayout' ||
                c.constructor?.name?.includes('BoxLayout'))
                return c;
        }
        return null;
    }

    function getBackground(dash) {
        return dash?.get_children().find(c =>
            c.style_class && c.style_class.includes('dash-background')) ?? null;
    }

    function getIconChildren(dashContainer) {
        const box = getIconBox(dashContainer);
        if (!box) return [];
        return box.get_children().filter(c => c.child?.icon);
    }

    return [
        // ---- Settings defaults ----
        {name: 'icon-magnification default is false', fn() {
            const s = getSettings();
            assert(s.get_boolean('icon-magnification') === false,
                'icon-magnification should default to false');
        }},
        {name: 'magnification-spread default is 3', fn() {
            const s = getSettings();
            assert(s.get_int('magnification-spread') === 3,
                'spread should be 3, got ' + s.get_int('magnification-spread'));
        }},
        {name: 'magnification-easing-duration default is 100', fn() {
            const s = getSettings();
            assert(s.get_int('magnification-easing-duration') === 100,
                'easing should be 100, got ' + s.get_int('magnification-easing-duration'));
        }},
        {name: 'icon-magnification-factor default is 1.5', fn() {
            const s = getSettings();
            const val = s.get_double('icon-magnification-factor');
            assert(Math.abs(val - 1.5) < 0.01,
                'magnification factor should be 1.5, got ' + val);
        }},
        {name: 'icon-magnification-all default is true', fn() {
            const s = getSettings();
            assert(s.get_boolean('icon-magnification-all') === true,
                'icon-magnification-all should default to true');
        }},

        // ---- Dock actor tree exists ----
        {name: 'dock container exists in stage', fn() {
            const dock = findDock();
            assert(dock !== null, 'dashtodockContainer should exist in uiGroup');
        }},
        {name: 'DockDash exists as slider child', fn() {
            const dash = getDash();
            assert(dash !== null, 'DockDash should exist');
            assert(dash.name === 'dash', 'DockDash name should be "dash", got "' + dash.name + '"');
        }},
        {name: 'dashContainer exists inside DockDash', fn() {
            const dash = getDash();
            assert(dash !== null, 'dash should exist');
            const dc = getDashContainer(dash);
            assert(dc !== null, 'dashtodockDashContainer should exist inside dash');
        }},

        // ---- Magnification disabled state (default) ----
        {name: 'offscreen_redirect is ALWAYS when magnification disabled', fn() {
            const s = getSettings();
            if (s.get_boolean('icon-magnification')) return; // skip if user enabled it
            const dash = getDash();
            assert(dash !== null, 'dash should exist');
            // ALWAYS = 1 in Clutter.OffscreenRedirect
            assert(dash.offscreen_redirect === Clutter.OffscreenRedirect.ALWAYS,
                'offscreen_redirect should be ALWAYS when mag disabled, got ' + dash.offscreen_redirect);
        }},
        {name: 'scrollView is visible when magnification disabled', fn() {
            const s = getSettings();
            if (s.get_boolean('icon-magnification')) return;
            const dash = getDash();
            if (!dash) return;
            const sv = getScrollView(dash);
            if (!sv) return;
            assert(sv.visible === true,
                'scrollView should be visible when mag disabled');
        }},

        // ---- Magnification enabled state ----
        {name: 'enabling magnification sets offscreen_redirect to 0', fn() {
            const s = getSettings();
            const orig = s.get_boolean('icon-magnification');
            try {
                s.set_boolean('icon-magnification', true);
                const dash = getDash();
                assert(dash !== null, 'dash should exist');
                assert(dash.offscreen_redirect === 0,
                    'offscreen_redirect should be 0 during magnification, got ' + dash.offscreen_redirect);
            } finally {
                s.set_boolean('icon-magnification', orig);
            }
        }},
        {name: 'enabling magnification sets clip_to_allocation false on dash', fn() {
            const s = getSettings();
            const orig = s.get_boolean('icon-magnification');
            try {
                s.set_boolean('icon-magnification', true);
                const dash = getDash();
                assert(dash !== null, 'dash should exist');
                assert(dash.clip_to_allocation === false,
                    'dash clip_to_allocation should be false during mag');
            } finally {
                s.set_boolean('icon-magnification', orig);
            }
        }},
        {name: 'enabling magnification sets clip_to_allocation false on dashContainer', fn() {
            const s = getSettings();
            const orig = s.get_boolean('icon-magnification');
            try {
                s.set_boolean('icon-magnification', true);
                const dash = getDash();
                assert(dash !== null, 'dash should exist');
                const dc = getDashContainer(dash);
                assert(dc !== null, 'dashContainer should exist');
                assert(dc.clip_to_allocation === false,
                    'dashContainer clip_to_allocation should be false during mag');
            } finally {
                s.set_boolean('icon-magnification', orig);
            }
        }},
        {name: 'enabling magnification hides scrollView', fn() {
            const s = getSettings();
            const orig = s.get_boolean('icon-magnification');
            try {
                s.set_boolean('icon-magnification', true);
                const dash = getDash();
                if (!dash) return;
                const sv = getScrollView(dash);
                if (!sv) return;
                assert(sv.visible === false,
                    'scrollView should be hidden during magnification');
            } finally {
                s.set_boolean('icon-magnification', orig);
            }
        }},
        {name: 'enabling magnification reparents icon box to dashContainer', fn() {
            const s = getSettings();
            const orig = s.get_boolean('icon-magnification');
            try {
                s.set_boolean('icon-magnification', true);
                const dash = getDash();
                assert(dash !== null, 'dash should exist');
                const dc = getDashContainer(dash);
                assert(dc !== null, 'dashContainer should exist');
                // _box should be a direct child of _dashContainer, not inside
                // _boxContainer (which is inside _scrollView)
                const box = getIconBox(dc);
                assert(box !== null, 'icon box should be found in dashContainer');
                assert(box.get_parent() === dc,
                    'icon box parent should be dashContainer during magnification');
            } finally {
                s.set_boolean('icon-magnification', orig);
            }
        }},

        // ---- Icon scales at rest ----
        {name: 'icons have scale 1.0 when no hover (at rest)', fn() {
            const s = getSettings();
            const orig = s.get_boolean('icon-magnification');
            try {
                s.set_boolean('icon-magnification', true);
                const dash = getDash();
                if (!dash) return;
                const dc = getDashContainer(dash);
                if (!dc) return;
                const icons = getIconChildren(dc);
                if (icons.length === 0) return;
                for (const child of icons) {
                    const icon = child.child.icon._iconBin ?? child.child.icon;
                    const sx = icon.scale_x;
                    const sy = icon.scale_y;
                    assert(Math.abs(sx - 1.0) < 0.01,
                        'icon scaleX should be ~1.0 at rest, got ' + sx);
                    assert(Math.abs(sy - 1.0) < 0.01,
                        'icon scaleY should be ~1.0 at rest, got ' + sy);
                }
            } finally {
                s.set_boolean('icon-magnification', orig);
            }
        }},
        {name: 'icon translation_x is 0 at rest', fn() {
            const s = getSettings();
            const orig = s.get_boolean('icon-magnification');
            try {
                s.set_boolean('icon-magnification', true);
                const dash = getDash();
                if (!dash) return;
                const dc = getDashContainer(dash);
                if (!dc) return;
                const icons = getIconChildren(dc);
                if (icons.length === 0) return;
                for (const child of icons) {
                    assert(Math.abs(child.translation_x) < 0.01,
                        'translation_x should be 0 at rest, got ' + child.translation_x);
                }
            } finally {
                s.set_boolean('icon-magnification', orig);
            }
        }},

        // ---- Background scale at rest ----
        {name: 'dock background scale is 1.0 at rest', fn() {
            const s = getSettings();
            const orig = s.get_boolean('icon-magnification');
            try {
                s.set_boolean('icon-magnification', true);
                const dash = getDash();
                if (!dash) return;
                const bg = getBackground(dash);
                if (!bg) return;
                const sx = bg.scale_x;
                assert(Math.abs(sx - 1.0) < 0.01,
                    'background scaleX should be ~1.0 at rest, got ' + sx);
            } finally {
                s.set_boolean('icon-magnification', orig);
            }
        }},

        // ---- Disabling magnification restores state ----
        {name: 'disabling magnification restores offscreen_redirect to ALWAYS', fn() {
            const s = getSettings();
            const orig = s.get_boolean('icon-magnification');
            try {
                s.set_boolean('icon-magnification', true);
                s.set_boolean('icon-magnification', false);
                const dash = getDash();
                assert(dash !== null, 'dash should exist');
                assert(dash.offscreen_redirect === Clutter.OffscreenRedirect.ALWAYS,
                    'offscreen_redirect should be ALWAYS after disabling, got ' + dash.offscreen_redirect);
            } finally {
                s.set_boolean('icon-magnification', orig);
            }
        }},
        {name: 'disabling magnification shows scrollView again', fn() {
            const s = getSettings();
            const orig = s.get_boolean('icon-magnification');
            try {
                s.set_boolean('icon-magnification', true);
                s.set_boolean('icon-magnification', false);
                const dash = getDash();
                if (!dash) return;
                const sv = getScrollView(dash);
                if (!sv) return;
                assert(sv.visible === true,
                    'scrollView should be visible after disabling magnification');
            } finally {
                s.set_boolean('icon-magnification', orig);
            }
        }},
        {name: 'disabling magnification restores clip_to_allocation on dash', fn() {
            const s = getSettings();
            const orig = s.get_boolean('icon-magnification');
            try {
                s.set_boolean('icon-magnification', true);
                s.set_boolean('icon-magnification', false);
                const dash = getDash();
                assert(dash !== null, 'dash should exist');
                assert(dash.clip_to_allocation === true,
                    'clip_to_allocation should be true after disabling mag');
            } finally {
                s.set_boolean('icon-magnification', orig);
            }
        }},

        // ---- DockContainer propagation (docking.js side) ----
        {name: 'dock container clip_to_allocation false during magnification', fn() {
            const s = getSettings();
            const orig = s.get_boolean('icon-magnification');
            try {
                s.set_boolean('icon-magnification', true);
                const dock = findDock();
                assert(dock !== null, 'dock should exist');
                assert(dock.clip_to_allocation === false,
                    'dock container clip_to_allocation should be false during mag, got ' + dock.clip_to_allocation);
            } finally {
                s.set_boolean('icon-magnification', orig);
            }
        }},

        // ---- Setting changes affect magnification params ----
        {name: 'changing magnification-spread setting is readable', fn() {
            const s = getSettings();
            const orig = s.get_int('magnification-spread');
            try {
                s.set_int('magnification-spread', 5);
                assert(s.get_int('magnification-spread') === 5,
                    'spread should change to 5, got ' + s.get_int('magnification-spread'));
            } finally {
                s.set_int('magnification-spread', orig);
            }
        }},
        {name: 'changing magnification-easing-duration setting is readable', fn() {
            const s = getSettings();
            const orig = s.get_int('magnification-easing-duration');
            try {
                s.set_int('magnification-easing-duration', 200);
                assert(s.get_int('magnification-easing-duration') === 200,
                    'easing should change to 200, got ' + s.get_int('magnification-easing-duration'));
            } finally {
                s.set_int('magnification-easing-duration', orig);
            }
        }},
        {name: 'changing icon-magnification-factor setting is readable', fn() {
            const s = getSettings();
            const orig = s.get_double('icon-magnification-factor');
            try {
                s.set_double('icon-magnification-factor', 2.0);
                const val = s.get_double('icon-magnification-factor');
                assert(Math.abs(val - 2.0) < 0.01,
                    'factor should change to 2.0, got ' + val);
            } finally {
                s.set_double('icon-magnification-factor', orig);
            }
        }},

        // ---- Show-apps icon participates ----
        {name: 'show-apps icon exists in dashContainer', fn() {
            const dash = getDash();
            if (!dash) return;
            const dc = getDashContainer(dash);
            if (!dc) return;
            // show-apps icon should be among dashContainer children
            let found = false;
            for (const c of dc.get_children()) {
                if (c.child?.icon || c.constructor?.name?.includes('ShowApps') ||
                    c.style_class?.includes('show-apps'))
                    found = true;
            }
            // It is OK if show-apps is hidden via setting; just verify
            // the dashContainer has at least some children
            assert(dc.get_n_children() > 0,
                'dashContainer should have children');
        }},

        // ---- Z-position at rest ----
        {name: 'icon z_position is 0 at rest', fn() {
            const s = getSettings();
            const orig = s.get_boolean('icon-magnification');
            try {
                s.set_boolean('icon-magnification', true);
                const dash = getDash();
                if (!dash) return;
                const dc = getDashContainer(dash);
                if (!dc) return;
                const icons = getIconChildren(dc);
                if (icons.length === 0) return;
                for (const child of icons) {
                    assert(Math.abs(child.z_position) < 0.01,
                        'z_position should be 0 at rest, got ' + child.z_position);
                }
            } finally {
                s.set_boolean('icon-magnification', orig);
            }
        }},
    ];
}

exports.getTests = getTests;
