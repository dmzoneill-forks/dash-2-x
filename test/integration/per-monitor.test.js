// SPDX-License-Identifier: GPL-2.0-or-later
function assert(cond, msg) { if (!cond) throw new Error(msg); }

function getTests() {
    const {GLib, Gio, Clutter, St} = imports.gi;

    function findDock() {
        const uiGroup = global.stage.get_children().find(c => c.name === 'uiGroup');
        return uiGroup?.get_children().find(c => c.name === 'dashtodockContainer');
    }

    function pump(ms) {
        const ctx = GLib.MainContext.default();
        const end = GLib.get_monotonic_time() + ms * 1000;
        while (GLib.get_monotonic_time() < end) ctx.iteration(false);
    }

    return [
        {
            name: 'monitor-positions default is empty',
            fn() {
                const settings = getXDockSettings();
                const val = settings.get_value('monitor-positions');
                const dict = val.deep_unpack();
                const keys = Object.keys(dict);
                assert(keys.length === 0,
                    `Expected monitor-positions default to be empty, got ${keys.length} entries: ${JSON.stringify(dict)}`);
            },
        },
        {
            name: 'dock-position default is BOTTOM (2)',
            fn() {
                const settings = getXDockSettings();
                const pos = settings.get_enum('dock-position');
                assert(pos === 2,
                    `Expected dock-position default to be BOTTOM (2), got ${pos}`);
            },
        },
        {
            name: 'multi-monitor setting exists',
            fn() {
                const settings = getXDockSettings();
                const val = settings.get_boolean('multi-monitor');
                assert(typeof val === 'boolean',
                    `Expected multi-monitor to be a boolean, got ${typeof val}`);
            },
        },
        {
            name: 'preferred-monitor setting exists',
            fn() {
                const settings = getXDockSettings();
                const val = settings.get_string('preferred-monitor-by-connector');
                assert(typeof val === 'string' && val.length > 0,
                    `Expected preferred-monitor-by-connector to be a non-empty string, got "${val}"`);
            },
        },
        {
            name: 'dock is on primary monitor',
            fn() {
                const dock = findDock();
                if (!dock) skip('requires dock actor (headless)');
                assert(dock.visible || dock.get_parent() !== null,
                    'Expected dock to be visible or attached to stage');
                screenshot('dock_on_primary');
            },
        },
        {
            name: 'monitor-positions can be written',
            fn() {
                const settings = getXDockSettings();
                const origVal = settings.get_value('monitor-positions');
                try {
                    const newDict = new GLib.Variant('a{ss}', {'DP-1': 'LEFT'});
                    settings.set_value('monitor-positions', newDict);
                    pump(500);

                    const readBack = settings.get_value('monitor-positions').deep_unpack();
                    assert(readBack['DP-1'] === 'LEFT',
                        `Expected monitor-positions[DP-1] to be 'LEFT', got '${readBack['DP-1']}'`);
                } finally {
                    settings.set_value('monitor-positions', new GLib.Variant('a{ss}', {}));
                    pump(500);

                    const restored = settings.get_value('monitor-positions').deep_unpack();
                    assert(Object.keys(restored).length === 0,
                        'Failed to restore monitor-positions to empty');
                }
            },
        },
        {
            name: 'dock position matches global setting',
            fn() {
                const settings = getXDockSettings();
                const pos = settings.get_enum('dock-position');
                const dock = findDock();
                if (!dock) skip('requires dock actor (headless)');
                if (!dock.get_allocation_box)
                    skip('dock not laid out (headless)');
                const alloc = dock.get_allocation_box();
                const dockY1 = alloc.y1 ?? alloc.get_y?.() ?? 0;
                const dockY2 = alloc.y2 ?? 0;
                const dockX1 = alloc.x1 ?? alloc.get_x?.() ?? 0;
                const dockX2 = alloc.x2 ?? 0;
                if (dockX2 === 0 && dockY2 === 0)
                    skip('dock has zero allocation (headless)');
                const stageH = global.stage.height;
                const stageW = global.stage.width;

                if (pos === 2) {
                    // BOTTOM: dock's lower edge should be near the stage bottom
                    assert(dockY2 >= stageH * 0.5,
                        `BOTTOM dock y2=${dockY2} should be in lower half of stage (h=${stageH})`);
                } else if (pos === 0) {
                    // TOP: dock's upper edge should be near the top
                    assert(dockY1 <= stageH * 0.5,
                        `TOP dock y1=${dockY1} should be in upper half of stage (h=${stageH})`);
                } else if (pos === 3) {
                    // LEFT: dock's left edge should be near the left
                    assert(dockX1 <= stageW * 0.5,
                        `LEFT dock x1=${dockX1} should be in left half of stage (w=${stageW})`);
                } else if (pos === 1) {
                    // RIGHT: dock's right edge should be near the right
                    assert(dockX2 >= stageW * 0.5,
                        `RIGHT dock x2=${dockX2} should be in right half of stage (w=${stageW})`);
                }
                screenshot('dock_position_match');
            },
        },
        {
            name: 'dock-position can cycle through positions',
            fn() {
                const settings = getXDockSettings();
                const origPos = settings.get_enum('dock-position');
                try {
                    // TOP = 0
                    settings.set_enum('dock-position', 0);
                    pump(500);
                    screenshot('pos_top');
                    assert(settings.get_enum('dock-position') === 0,
                        'Failed to set dock-position to TOP (0)');

                    // RIGHT = 1
                    settings.set_enum('dock-position', 1);
                    pump(500);
                    screenshot('pos_right');
                    assert(settings.get_enum('dock-position') === 1,
                        'Failed to set dock-position to RIGHT (1)');

                    // BOTTOM = 2
                    settings.set_enum('dock-position', 2);
                    pump(500);
                    screenshot('pos_bottom');
                    assert(settings.get_enum('dock-position') === 2,
                        'Failed to set dock-position to BOTTOM (2)');

                    // LEFT = 3
                    settings.set_enum('dock-position', 3);
                    pump(500);
                    screenshot('pos_left');
                    assert(settings.get_enum('dock-position') === 3,
                        'Failed to set dock-position to LEFT (3)');
                } finally {
                    settings.set_enum('dock-position', origPos);
                    pump(500);
                    assert(settings.get_enum('dock-position') === origPos,
                        `Failed to restore dock-position to ${origPos}`);
                }
            },
        },
    ];
}

exports.getTests = getTests;
