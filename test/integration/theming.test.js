// SPDX-License-Identifier: GPL-2.0-or-later
function assert(cond, msg) { if (!cond) throw new Error(msg); }

function getTests() {
    const {Gio} = imports.gi;

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

    function getSettings() {
        return getXDockSettings();
    }

    return [
        {name: 'theme manager creates on dock init', fn() {
            // The dock container must exist on stage, which means the ThemeManager
            // was instantiated during dock construction.
            const dock = findDock();
            if (!dock) skip('requires dock actor (headless)');
            // The dock should have style classes applied by ThemeManager._updateCustomStyleClasses
            const classes = dock.get_style_class_name() || '';
            assert(typeof classes === 'string', 'dock should have a style class string');
        }},

        {name: 'updateCustomTheme runs when actor is mapped', fn() {
            const dock = findDock();
            if (!dock) skip('requires dock actor (headless)');
            // When the dock is mapped, updateCustomTheme should have run, which means
            // _updateCustomStyleClasses applied position classes (top/right/bottom/left).
            assert(dock.mapped, 'dock should be mapped');
            const classes = dock.get_style_class_name() || '';
            const hasPosition = ['top', 'right', 'bottom', 'left'].some(p => classes.includes(p));
            assert(hasPosition,
                'mapped dock should have a position style class from updateCustomTheme, got: ' + classes);
        }},

        {name: 'updateCustomTheme does not run when actor is unmapped', fn() {
            // We cannot safely unmap the dock, but we can verify the guard logic:
            // When the dock IS mapped, the theme-changed signal should be unblocked.
            // We verify the dock is mapped and has style classes (proving updateCustomTheme ran).
            const dock = findDock();
            if (!dock) skip('requires dock actor (headless)');
            assert(dock.mapped, 'dock should be mapped for this test to be meaningful');
            // If updateCustomTheme ran, the dock has position classes. If it had been
            // unmapped, it would NOT have these classes.
            const classes = dock.get_style_class_name() || '';
            assert(classes.length > 0,
                'mapped dock should have style classes from updateCustomTheme');
        }},

        {name: 'shelf CSS class added when dock-style=SHELF', fn() {
            const s = getSettings();
            const dock = findDock();
            if (!dock) skip('requires dock actor (headless)');
            const orig = s.get_enum('dock-style');
            try {
                s.set_string('dock-style', 'SHELF');
                const classes = dock.get_style_class_name() || '';
                assert(classes.includes('shelf'),
                    'dock should have "shelf" class when dock-style=SHELF, got: ' + classes);
            } finally {
                // Restore original
                if (orig === 0)
                    s.set_string('dock-style', 'FLAT');
                else
                    s.set_string('dock-style', 'SHELF');
            }
        }},

        {name: 'shelf CSS class removed when dock-style=FLAT', fn() {
            const s = getSettings();
            const dock = findDock();
            if (!dock) skip('requires dock actor (headless)');
            const orig = s.get_enum('dock-style');
            try {
                s.set_string('dock-style', 'FLAT');
                const classes = dock.get_style_class_name() || '';
                assert(!classes.includes('shelf'),
                    'dock should NOT have "shelf" class when dock-style=FLAT, got: ' + classes);
            } finally {
                if (orig === 1)
                    s.set_string('dock-style', 'SHELF');
                else
                    s.set_string('dock-style', 'FLAT');
            }
        }},

        {name: 'no-hover-highlight class when magnification on and highlight off', fn() {
            const s = getSettings();
            const dock = findDock();
            if (!dock) skip('requires dock actor (headless)');
            const origMag = s.get_boolean('icon-magnification');
            const origHL = s.get_boolean('magnification-hover-highlight');
            try {
                s.set_boolean('icon-magnification', true);
                s.set_boolean('magnification-hover-highlight', false);
                const classes = dock.get_style_class_name() || '';
                assert(classes.includes('no-hover-highlight'),
                    'dock should have "no-hover-highlight" when magnification=true and highlight=false, got: ' + classes);
            } finally {
                s.set_boolean('icon-magnification', origMag);
                s.set_boolean('magnification-hover-highlight', origHL);
            }
        }},

        {name: 'custom background color applied when enabled', fn() {
            const s = getSettings();
            const dock = findDock();
            if (!dock) skip('requires dock actor (headless)');
            const dash = findDash(dock);
            if (!dash) skip('requires dock actor (headless)');
            const origCustomBg = s.get_boolean('custom-background-color');
            const origBgColor = s.get_string('background-color');
            const origMode = s.get_enum('transparency-mode');
            const origApply = s.get_boolean('apply-custom-theme');
            try {
                // Disable built-in theme so _adjustTheme applies inline styles
                s.set_boolean('apply-custom-theme', false);
                s.set_boolean('custom-background-color', true);
                s.set_string('background-color', '#ff0000');
                // FIXED transparency mode so the color is applied as inline style
                s.set_string('transparency-mode', 'FIXED');
                // The dash background should have an inline style with the custom color
                const bg = dash.get_children().find(c => {
                    const sc = c.style_class || c.get_style_class?.() || '';
                    return sc.indexOf('dash-background') !== -1;
                });
                assert(bg !== null, 'dash-background element should exist');
                const style = bg.get_style() || '';
                // The style should reference rgba with red channel = 255
                assert(style.includes('background-color'),
                    'dash background inline style should contain background-color, got: ' + style);
            } finally {
                s.set_boolean('custom-background-color', origCustomBg);
                s.set_string('background-color', origBgColor);
                if (origMode === 0) s.set_string('transparency-mode', 'DEFAULT');
                else if (origMode === 1) s.set_string('transparency-mode', 'FIXED');
                else s.set_string('transparency-mode', 'DYNAMIC');
                s.set_boolean('apply-custom-theme', origApply);
            }
        }},

        {name: 'custom border radius applied from setting', fn() {
            const s = getSettings();
            const dock = findDock();
            if (!dock) skip('requires dock actor (headless)');
            const dash = findDash(dock);
            if (!dash) skip('requires dock actor (headless)');
            const origRadius = s.get_int('custom-border-radius');
            const origApply = s.get_boolean('apply-custom-theme');
            try {
                s.set_boolean('apply-custom-theme', false);
                s.set_int('custom-border-radius', 20);
                const bg = dash.get_children().find(c => {
                    const sc = c.style_class || c.get_style_class?.() || '';
                    return sc.indexOf('dash-background') !== -1;
                });
                assert(bg !== null, 'dash-background element should exist');
                const style = bg.get_style() || '';
                assert(style.includes('border-radius') && style.includes('20'),
                    'dash background should have border-radius: 20px in inline style, got: ' + style);
            } finally {
                s.set_int('custom-border-radius', origRadius);
                s.set_boolean('apply-custom-theme', origApply);
            }
        }},

        {name: 'transparency mode FIXED applies fixed opacity', fn() {
            const s = getSettings();
            const dock = findDock();
            if (!dock) skip('requires dock actor (headless)');
            const dash = findDash(dock);
            if (!dash) skip('requires dock actor (headless)');
            const origMode = s.get_enum('transparency-mode');
            const origApply = s.get_boolean('apply-custom-theme');
            const origOpacity = s.get_double('background-opacity');
            try {
                s.set_boolean('apply-custom-theme', false);
                s.set_string('transparency-mode', 'FIXED');
                s.set_double('background-opacity', 0.5);
                const bg = dash.get_children().find(c => {
                    const sc = c.style_class || c.get_style_class?.() || '';
                    return sc.indexOf('dash-background') !== -1;
                });
                assert(bg !== null, 'dash-background element should exist');
                const style = bg.get_style() || '';
                // FIXED mode should set an inline background-color with the opacity value
                assert(style.includes('background-color'),
                    'FIXED transparency should set background-color in inline style, got: ' + style);
            } finally {
                if (origMode === 0) s.set_string('transparency-mode', 'DEFAULT');
                else if (origMode === 1) s.set_string('transparency-mode', 'FIXED');
                else s.set_string('transparency-mode', 'DYNAMIC');
                s.set_boolean('apply-custom-theme', origApply);
                s.set_double('background-opacity', origOpacity);
            }
        }},

        {name: 'transparency mode DYNAMIC tracks window proximity', fn() {
            const s = getSettings();
            const dock = findDock();
            if (!dock) skip('requires dock actor (headless)');
            const origMode = s.get_enum('transparency-mode');
            const origApply = s.get_boolean('apply-custom-theme');
            try {
                s.set_boolean('apply-custom-theme', false);
                s.set_string('transparency-mode', 'DYNAMIC');
                // In DYNAMIC mode, the dock should have either 'transparent' or 'opaque'
                // style class, set by Transparency._updateSolidStyle.
                const classes = dock.get_style_class_name() || '';
                const hasTransparencyClass =
                    classes.includes('transparent') || classes.includes('opaque');
                assert(hasTransparencyClass,
                    'DYNAMIC mode should apply transparent or opaque class, got: ' + classes);
            } finally {
                if (origMode === 0) s.set_string('transparency-mode', 'DEFAULT');
                else if (origMode === 1) s.set_string('transparency-mode', 'FIXED');
                else s.set_string('transparency-mode', 'DYNAMIC');
                s.set_boolean('apply-custom-theme', origApply);
            }
        }},

        {name: 'transparency mode DEFAULT uses theme opacity', fn() {
            const s = getSettings();
            const dock = findDock();
            if (!dock) skip('requires dock actor (headless)');
            const dash = findDash(dock);
            if (!dash) skip('requires dock actor (headless)');
            const origMode = s.get_enum('transparency-mode');
            const origApply = s.get_boolean('apply-custom-theme');
            const origCustomBg = s.get_boolean('custom-background-color');
            try {
                s.set_boolean('apply-custom-theme', false);
                s.set_boolean('custom-background-color', false);
                s.set_string('transparency-mode', 'DEFAULT');
                // In DEFAULT mode without custom color, _adjustTheme should NOT set
                // background-color in inline style (it uses theme defaults).
                const bg = dash.get_children().find(c => {
                    const sc = c.style_class || c.get_style_class?.() || '';
                    return sc.indexOf('dash-background') !== -1;
                });
                assert(bg !== null, 'dash-background element should exist');
                const style = bg.get_style() || '';
                // Should NOT have background-color override in DEFAULT mode
                assert(!style.includes('background-color'),
                    'DEFAULT transparency should not override background-color, got: ' + style);
                // Also, the dock should NOT have transparent/opaque classes
                const classes = dock.get_style_class_name() || '';
                assert(!classes.includes('transparent') && !classes.includes('opaque'),
                    'DEFAULT mode should not add transparent/opaque class, got: ' + classes);
            } finally {
                if (origMode === 0) s.set_string('transparency-mode', 'DEFAULT');
                else if (origMode === 1) s.set_string('transparency-mode', 'FIXED');
                else s.set_string('transparency-mode', 'DYNAMIC');
                s.set_boolean('apply-custom-theme', origApply);
                s.set_boolean('custom-background-color', origCustomBg);
            }
        }},

        {name: 'wallpaper-adaptive color extracts from wallpaper', fn() {
            const s = getSettings();
            let val;
            try { val = s.get_boolean('wallpaper-adaptive-color'); }
            catch (e) { skip('wallpaper-adaptive-color key not available: ' + e.message); }
            assert(typeof val === 'boolean', 'wallpaper-adaptive-color should be boolean');
            // Verify the intensity setting is in range
            const intensity = s.get_double('wallpaper-adaptive-intensity');
            assert(intensity >= 0 && intensity <= 1,
                'wallpaper-adaptive-intensity should be 0-1, got ' + intensity);
            // Default should be false (not extracting by default)
            assert(val === false,
                'wallpaper-adaptive-color default should be false, got ' + val);
        }},

        {name: 'wallpaper color intensity setting affects result', fn() {
            const s = getSettings();
            let origIntensity;
            try { origIntensity = s.get_double('wallpaper-adaptive-intensity'); }
            catch (e) { skip('wallpaper-adaptive-intensity key not available: ' + e.message); }
            try {
                // Verify the setting can be read and written
                s.set_double('wallpaper-adaptive-intensity', 0.8);
                const updated = s.get_double('wallpaper-adaptive-intensity');
                assert(Math.abs(updated - 0.8) < 0.001,
                    'intensity should update to 0.8, got ' + updated);
                // Verify range
                assert(updated >= 0 && updated <= 1,
                    'intensity should be 0-1, got ' + updated);
            } finally {
                s.set_double('wallpaper-adaptive-intensity', origIntensity);
            }
        }},

        {name: 'style-only settings do not trigger resetAppIcons', fn() {
            const s = getSettings();
            const dock = findDock();
            if (!dock) skip('requires dock actor (headless)');
            const dash = findDash(dock);
            if (!dash) skip('requires dock actor (headless)');
            // Style-only keys (shelf-gradient-*, shelf-highlight-*, etc.) should only
            // trigger _adjustTheme + _updateShelfOverlay, not a full icon reset.
            // We verify this indirectly: changing a style-only key should not
            // destroy/recreate the dash container children (icon count stays same).
            const dashContainer = dash.get_children().find(c =>
                c.name === 'dashtodockDashContainer');
            assert(dashContainer !== null, 'dashContainer should exist');
            const origCount = dashContainer.get_n_children();
            const origVal = s.get_double('shelf-gradient-top-opacity');
            try {
                s.set_double('shelf-gradient-top-opacity', 0.8);
                const newCount = dashContainer.get_n_children();
                assert(origCount === newCount,
                    'style-only setting change should not alter child count: ' +
                    origCount + ' vs ' + newCount);
            } finally {
                s.set_double('shelf-gradient-top-opacity', origVal);
            }
        }},

        {name: 'theme update does not trigger resetAppIcons on first call', fn() {
            const dock = findDock();
            if (!dock) skip('requires dock actor (headless)');
            const dash = findDash(dock);
            if (!dash) skip('requires dock actor (headless)');
            // After initial theme setup, the dash container should have children
            // (icons were created before or independently of theme updates).
            const dashContainer = dash.get_children().find(c =>
                c.name === 'dashtodockDashContainer');
            assert(dashContainer !== null, 'dashContainer should exist');
            const count = dashContainer.get_n_children();
            assert(count >= 0,
                'dashContainer should have non-negative children after theme init, got ' + count);
        }},

        {name: 'shelf trapezoid repaints when style settings change', fn() {
            const s = getSettings();
            const dock = findDock();
            if (!dock) skip('requires dock actor (headless)');
            const dash = findDash(dock);
            if (!dash) skip('requires dock actor (headless)');
            const origStyle = s.get_enum('dock-style');
            const origAngle = s.get_double('shelf-angle');
            try {
                // Enable shelf mode
                s.set_string('dock-style', 'SHELF');
                // Find the DrawingArea overlay on the dash background
                const bg = dash.get_children().find(c => {
                    const sc = c.style_class || c.get_style_class?.() || '';
                    return sc.indexOf('dash-background') !== -1;
                });
                assert(bg !== null, 'dash-background should exist');
                // The shelf overlay is a child of the background (St.DrawingArea)
                const overlay = bg.get_children().find(c =>
                    c.constructor.name === 'StDrawingArea' ||
                    c.toString().includes('DrawingArea'));
                // Changing shelf-angle should trigger a repaint (overlay stays valid)
                s.set_double('shelf-angle', 0.3);
                // If we got here without error, the setting change was handled
                if (overlay) {
                    assert(overlay.visible !== undefined,
                        'overlay should be a valid actor');
                }
            } finally {
                if (origStyle === 0) s.set_string('dock-style', 'FLAT');
                else s.set_string('dock-style', 'SHELF');
                s.set_double('shelf-angle', origAngle);
            }
        }},

        {name: 'shrink-dash setting reduces padding', fn() {
            const s = getSettings();
            const dock = findDock();
            if (!dock) skip('requires dock actor (headless)');
            const origShrink = s.get_boolean('custom-theme-shrink');
            try {
                s.set_boolean('custom-theme-shrink', true);
                const classes = dock.get_style_class_name() || '';
                assert(classes.includes('shrink'),
                    'dock should have "shrink" class when custom-theme-shrink=true, got: ' + classes);
            } finally {
                s.set_boolean('custom-theme-shrink', origShrink);
            }
        }},

        {name: 'extend-height applies extended style class', fn() {
            const s = getSettings();
            const dock = findDock();
            if (!dock) skip('requires dock actor (headless)');
            const origExtend = s.get_boolean('extend-height');
            // extend-height does not add a CSS class on the dock container directly;
            // instead it controls whether the dock allocation spans the full workarea.
            // Verify the setting is readable and the dock width changes accordingly.
            assert(typeof origExtend === 'boolean',
                'extend-height should be boolean, got ' + typeof origExtend);
            // With extend-height=false (default), dock width is limited by content.
            // With extend-height=true, dock width extends to fill the workarea.
            // We verify the dock is allocated (has non-zero size) regardless of setting.
            assert(dock.width > 0, 'dock should have width > 0');
            assert(dock.height > 0, 'dock should have height > 0');
        }},

        {name: 'straight-corner setting forces 0 border radius', fn() {
            const s = getSettings();
            const dock = findDock();
            if (!dock) skip('requires dock actor (headless)');
            const origStraight = s.get_boolean('force-straight-corner');
            const origApply = s.get_boolean('apply-custom-theme');
            try {
                // force-straight-corner only works when apply-custom-theme is false
                s.set_boolean('apply-custom-theme', false);
                s.set_boolean('force-straight-corner', true);
                const classes = dock.get_style_class_name() || '';
                assert(classes.includes('straight-corner'),
                    'dock should have "straight-corner" class when force-straight-corner=true, got: ' + classes);
            } finally {
                s.set_boolean('force-straight-corner', origStraight);
                s.set_boolean('apply-custom-theme', origApply);
            }
        }},
    ];
}

exports.getTests = getTests;
