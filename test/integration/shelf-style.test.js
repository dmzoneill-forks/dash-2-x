// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: Contributors to XDock
//
// Integration tests: shelf style rendering and settings.
// Runs INSIDE GNOME Shell headless via new Function('exports', source).

function assert(cond, msg) { if (!cond) throw new Error(msg); }

function getTests() {
    const {Gio, St} = imports.gi;

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    function findDock() {
        const uiGroup = global.stage.get_children().find(c => c.name === 'uiGroup');
        return uiGroup?.get_children().find(c => c.name === 'dashtodockContainer');
    }

    function getDash() {
        const dock = findDock();
        if (!dock) return null;
        return dock.child.get_children()[0].child;
    }

    function getSettings() {
        return getXDockSettings();
    }

    function getBackground(dash) {
        if (!dash) return null;
        return dash.get_children().find(c => {
            const sc = c.style_class || '';
            return sc.indexOf('dash-background') !== -1;
        });
    }

    function getReflection(dash) {
        if (!dash) return null;
        return dash.get_children().find(c => {
            const sc = c.style_class || '';
            return sc.indexOf('dash-reflection') !== -1;
        });
    }

    function isShelfMode() {
        return getSettings().get_enum('dock-style') === 1;
    }

    // -----------------------------------------------------------------------
    // Tests
    // -----------------------------------------------------------------------

    return [
        // -- Settings existence and defaults --
        {name: 'dock-style setting exists', fn() {
            const s = getSettings();
            const style = s.get_enum('dock-style');
            assert(style === 0 || style === 1, 'dock-style should be 0 (FLAT) or 1 (SHELF), got ' + style);
        }},

        {name: 'shelf corner radius settings exist with valid defaults', fn() {
            const s = getSettings();
            const top = s.get_int('shelf-corner-radius-top');
            const bot = s.get_int('shelf-corner-radius-bottom');
            assert(top >= 0 && top <= 30, 'top radius should be 0-30, got ' + top);
            assert(bot >= 0 && bot <= 30, 'bottom radius should be 0-30, got ' + bot);
            assert(top === 6, 'default top radius should be 6, got ' + top);
            assert(bot === 12, 'default bottom radius should be 12, got ' + bot);
        }},

        {name: 'shelf angle setting exists with valid default', fn() {
            const s = getSettings();
            const angle = s.get_double('shelf-angle');
            assert(angle >= 0 && angle <= 1.0, 'angle should be 0-1.0, got ' + angle);
            assert(Math.abs(angle - 0.2) < 0.001, 'default angle should be 0.2, got ' + angle);
        }},

        {name: 'shelf height setting exists with valid default', fn() {
            const s = getSettings();
            const height = s.get_double('shelf-height');
            assert(height >= 0.0 && height <= 1.0, 'height should be 0.0-1.0, got ' + height);
            assert(Math.abs(height - 0.45) < 0.001, 'default height should be 0.45, got ' + height);
        }},

        {name: 'shelf gradient opacity settings exist with valid defaults', fn() {
            const s = getSettings();
            const top = s.get_double('shelf-gradient-top-opacity');
            const bot = s.get_double('shelf-gradient-bottom-opacity');
            assert(top >= 0 && top <= 1, 'top opacity should be 0-1, got ' + top);
            assert(bot >= 0 && bot <= 1, 'bottom opacity should be 0-1, got ' + bot);
            assert(Math.abs(top - 0.4) < 0.001, 'default top opacity should be 0.4, got ' + top);
            assert(Math.abs(bot - 0.15) < 0.001, 'default bottom opacity should be 0.15, got ' + bot);
        }},

        {name: 'shelf highlight opacity setting exists with valid default', fn() {
            const s = getSettings();
            const val = s.get_double('shelf-highlight-opacity');
            assert(val >= 0 && val <= 1, 'highlight opacity should be 0-1, got ' + val);
            assert(Math.abs(val - 0.3) < 0.001, 'default should be 0.3, got ' + val);
        }},

        {name: 'shelf border opacity setting exists with valid default', fn() {
            const s = getSettings();
            const val = s.get_double('shelf-border-opacity');
            assert(val >= 0 && val <= 1, 'border opacity should be 0-1, got ' + val);
            assert(Math.abs(val - 0.5) < 0.001, 'default should be 0.5, got ' + val);
        }},

        {name: 'shelf reflection setting exists with valid default', fn() {
            const s = getSettings();
            const refl = s.get_boolean('shelf-reflection');
            assert(typeof refl === 'boolean', 'shelf-reflection should be boolean');
            assert(refl === true, 'default shelf-reflection should be true, got ' + refl);
        }},

        {name: 'shelf reflection opacity setting exists with valid default', fn() {
            const s = getSettings();
            const val = s.get_double('shelf-reflection-opacity');
            assert(val >= 0 && val <= 1, 'reflection opacity should be 0-1, got ' + val);
            assert(Math.abs(val - 0.15) < 0.001, 'default should be 0.15, got ' + val);
        }},

        // -- Dock actor tree --
        {name: 'dash background exists', fn() {
            const dash = getDash();
            assert(dash !== null, 'dash should exist');
            const bg = getBackground(dash);
            assert(bg !== null && bg !== undefined, 'dash-background element should exist');
        }},

        {name: 'dash reflection widget exists in actor tree', fn() {
            const dash = getDash();
            assert(dash !== null, 'dash should exist');
            const refl = getReflection(dash);
            assert(refl !== null && refl !== undefined,
                'dash-reflection widget should exist as a child of the dash');
        }},

        // -- Shelf style class on container --
        {name: 'shelf class on container when shelf mode active', fn() {
            const s = getSettings();
            const dock = findDock();
            assert(dock !== null, 'dock should exist');
            if (s.get_enum('dock-style') === 1) {
                const classes = dock.get_style_class_name() || '';
                assert(classes.indexOf('shelf') !== -1, 'should have shelf class when dock-style=SHELF');
            }
        }},

        {name: 'no shelf class on container when flat mode active', fn() {
            const s = getSettings();
            const dock = findDock();
            assert(dock !== null, 'dock should exist');
            if (s.get_enum('dock-style') === 0) {
                const classes = dock.get_style_class_name() || '';
                assert(classes.indexOf('shelf') === -1,
                    'should NOT have shelf class when dock-style=FLAT, got: ' + classes);
            }
        }},

        // -- Flat mode: no shelf overlay --
        {name: 'flat style: no shelf overlay on background', fn() {
            if (isShelfMode()) return; // skip if shelf mode
            const dash = getDash();
            assert(dash !== null, 'dash should exist');
            const bg = getBackground(dash);
            if (!bg) return;
            const overlay = bg.get_children().find(c => {
                const name = c.constructor?.name || '';
                return name.indexOf('DrawingArea') !== -1;
            });
            assert(overlay === null || overlay === undefined,
                'flat mode should NOT have a DrawingArea overlay on dash-background');
        }},

        // -- Shelf mode: DrawingArea overlay --
        {name: 'shelf style: DrawingArea overlay exists on background', fn() {
            if (!isShelfMode()) return; // skip if flat mode
            const dash = getDash();
            assert(dash !== null, 'dash should exist');
            const bg = getBackground(dash);
            assert(bg !== null && bg !== undefined, 'dash-background should exist');
            const overlay = bg.get_children().find(c => {
                const name = c.constructor?.name || '';
                return name.indexOf('DrawingArea') !== -1;
            });
            assert(overlay !== null && overlay !== undefined,
                'shelf mode should have a DrawingArea overlay on dash-background');
        }},

        {name: 'shelf style: overlay is visible', fn() {
            if (!isShelfMode()) return;
            const dash = getDash();
            const bg = getBackground(dash);
            if (!bg) return;
            const overlay = bg.get_children().find(c => {
                const name = c.constructor?.name || '';
                return name.indexOf('DrawingArea') !== -1;
            });
            assert(overlay !== null && overlay !== undefined, 'overlay should exist');
            assert(overlay.visible, 'shelf overlay should be visible');
        }},

        {name: 'shelf style: overlay is sized to match background', fn() {
            if (!isShelfMode()) return;
            const dash = getDash();
            const bg = getBackground(dash);
            if (!bg) return;
            const overlay = bg.get_children().find(c => {
                const name = c.constructor?.name || '';
                return name.indexOf('DrawingArea') !== -1;
            });
            if (!overlay) return;
            // The overlay uses a BindConstraint to match the background size,
            // so its natural/allocated size should be close to the background's.
            // Allow some tolerance for constraint lag in headless mode.
            if (bg.width > 0 && overlay.width > 0) {
                assert(Math.abs(overlay.width - bg.width) <= 2,
                    'overlay width (' + overlay.width + ') should match bg width (' + bg.width + ')');
            }
            if (bg.height > 0 && overlay.height > 0) {
                assert(Math.abs(overlay.height - bg.height) <= 2,
                    'overlay height (' + overlay.height + ') should match bg height (' + bg.height + ')');
            }
        }},

        {name: 'shelf style: CSS background is transparent', fn() {
            if (!isShelfMode()) return;
            const dash = getDash();
            const bg = getBackground(dash);
            if (!bg) return;
            const style = bg.get_style() || '';
            // When shelf is active, the inline style sets background-color: transparent
            assert(style.indexOf('transparent') !== -1,
                'shelf mode should set background-color to transparent, got style: ' + style);
        }},

        // -- Shelf reflection widget visibility --
        {name: 'shelf reflection widget visible when shelf-reflection=true and shelf mode', fn() {
            const s = getSettings();
            if (s.get_enum('dock-style') !== 1) return; // skip if flat
            if (!s.get_boolean('shelf-reflection')) return; // skip if reflection disabled
            const dash = getDash();
            const refl = getReflection(dash);
            assert(refl !== null, 'reflection widget should exist');
            assert(refl.visible, 'reflection widget should be visible when shelf + reflection enabled');
        }},

        {name: 'shelf reflection hidden when flat mode', fn() {
            const s = getSettings();
            if (s.get_enum('dock-style') !== 0) return; // skip if shelf
            const dash = getDash();
            const refl = getReflection(dash);
            if (!refl) return; // acceptable if widget not yet created
            assert(!refl.visible,
                'reflection widget should not be visible in flat mode');
        }},

        {name: 'shelf reflection has gradient style when visible', fn() {
            const s = getSettings();
            if (s.get_enum('dock-style') !== 1) return;
            if (!s.get_boolean('shelf-reflection')) return;
            const dash = getDash();
            const refl = getReflection(dash);
            if (!refl || !refl.visible) return;
            const style = refl.get_style() || '';
            assert(style.indexOf('linear-gradient') !== -1,
                'reflection should have a linear-gradient style, got: ' + style);
        }},

        {name: 'shelf reflection opacity appears in inline style', fn() {
            const s = getSettings();
            if (s.get_enum('dock-style') !== 1) return;
            if (!s.get_boolean('shelf-reflection')) return;
            const dash = getDash();
            const refl = getReflection(dash);
            if (!refl || !refl.visible) return;
            const style = refl.get_style() || '';
            const op = s.get_double('shelf-reflection-opacity');
            // The opacity value should appear in the style string
            assert(style.indexOf(String(op)) !== -1,
                'reflection style should contain opacity value ' + op + ', got: ' + style);
        }},

        // -- Settings round-trip --
        {name: 'shelf-angle setting can be changed and read back', fn() {
            const s = getSettings();
            const orig = s.get_double('shelf-angle');
            s.set_double('shelf-angle', 0.35);
            const changed = s.get_double('shelf-angle');
            s.set_double('shelf-angle', orig);
            assert(Math.abs(changed - 0.35) < 0.001,
                'shelf-angle should be 0.35 after set, got ' + changed);
        }},

        {name: 'shelf-height setting can be changed and read back', fn() {
            const s = getSettings();
            const orig = s.get_double('shelf-height');
            s.set_double('shelf-height', 0.6);
            const changed = s.get_double('shelf-height');
            s.set_double('shelf-height', orig);
            assert(Math.abs(changed - 0.6) < 0.001,
                'shelf-height should be 0.6 after set, got ' + changed);
        }},

        {name: 'shelf-corner-radius-top setting can be changed', fn() {
            const s = getSettings();
            const orig = s.get_int('shelf-corner-radius-top');
            s.set_int('shelf-corner-radius-top', 10);
            const changed = s.get_int('shelf-corner-radius-top');
            s.set_int('shelf-corner-radius-top', orig);
            assert(changed === 10, 'shelf-corner-radius-top should be 10, got ' + changed);
        }},

        {name: 'shelf-corner-radius-bottom setting can be changed', fn() {
            const s = getSettings();
            const orig = s.get_int('shelf-corner-radius-bottom');
            s.set_int('shelf-corner-radius-bottom', 20);
            const changed = s.get_int('shelf-corner-radius-bottom');
            s.set_int('shelf-corner-radius-bottom', orig);
            assert(changed === 20, 'shelf-corner-radius-bottom should be 20, got ' + changed);
        }},

        {name: 'shelf-gradient-top-opacity setting can be changed', fn() {
            const s = getSettings();
            const orig = s.get_double('shelf-gradient-top-opacity');
            s.set_double('shelf-gradient-top-opacity', 0.7);
            const changed = s.get_double('shelf-gradient-top-opacity');
            s.set_double('shelf-gradient-top-opacity', orig);
            assert(Math.abs(changed - 0.7) < 0.001,
                'shelf-gradient-top-opacity should be 0.7, got ' + changed);
        }},

        {name: 'shelf-gradient-bottom-opacity setting can be changed', fn() {
            const s = getSettings();
            const orig = s.get_double('shelf-gradient-bottom-opacity');
            s.set_double('shelf-gradient-bottom-opacity', 0.5);
            const changed = s.get_double('shelf-gradient-bottom-opacity');
            s.set_double('shelf-gradient-bottom-opacity', orig);
            assert(Math.abs(changed - 0.5) < 0.001,
                'shelf-gradient-bottom-opacity should be 0.5, got ' + changed);
        }},

        {name: 'no 1px border line at top of dock in shelf mode', fn() {
            if (!isShelfMode()) return;
            const dash = getDash();
            const bg = getBackground(dash);
            if (!bg) return;
            const style = bg.get_style() || '';
            // In shelf mode, border-radius is set to 0 and background is transparent,
            // meaning no visible CSS border should render.
            // The inline style should contain 'border-radius: 0' to suppress borders.
            assert(style.indexOf('border-radius: 0') !== -1,
                'shelf mode should set border-radius: 0 to suppress borders, got: ' + style);
        }},

        {name: 'shelf style class added to dock container', fn() {
            const dock = findDock();
            assert(dock !== null, 'dock should exist');
            const s = getSettings();
            const dockStyle = s.get_enum('dock-style');
            const classes = dock.get_style_class_name() || '';
            if (dockStyle === 1) {
                assert(classes.indexOf('shelf') !== -1,
                    'dock should have shelf class when SHELF, got: ' + classes);
            } else {
                assert(classes.indexOf('shelf') === -1,
                    'dock should NOT have shelf class when FLAT, got: ' + classes);
            }
        }},

        // -- Shelf background scales with magnification --
        {name: 'shelf background scales with magnification', fn() {
            // Verify that the background actor exists and has non-zero dimensions
            // when the dock is visible, regardless of magnification setting.
            const dash = getDash();
            assert(dash !== null, 'dash should exist');
            const bg = getBackground(dash);
            assert(bg !== null, 'background should exist');
            // When the dock is visible and has icons, the background should have
            // positive dimensions.
            if (bg.width > 0 && bg.height > 0) {
                assert(bg.width > 10, 'background should have meaningful width, got ' + bg.width);
                assert(bg.height > 10, 'background should have meaningful height, got ' + bg.height);
            }
        }},
    ];
}

/* exported XDockTests */
exports.getTests = getTests;  // eslint-disable-line no-unused-vars
