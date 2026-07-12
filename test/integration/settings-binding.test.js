// SPDX-License-Identifier: GPL-2.0-or-later
function assert(cond, msg) { if (!cond) throw new Error(msg); }

function getTests() {
    const {Gio} = imports.gi;

    function getSettings() {
        return getXDockSettings();
    }

    function assertDefault(key, expected, type) {
        return {
            name: key + ' default is ' + expected,
            fn() {
                const s = getSettings();
                let val;
                if (type === 'd') val = s.get_double(key);
                else if (type === 'i') val = s.get_int(key);
                else if (type === 'b') val = s.get_boolean(key);
                else if (type === 's') val = s.get_string(key);
                else val = s.get_value(key).deep_unpack();

                if (typeof expected === 'number')
                    assert(Math.abs(val - expected) < 0.01, key + ': expected ' + expected + ', got ' + val);
                else
                    assert(val === expected, key + ': expected ' + expected + ', got ' + val);
            }
        };
    }

    return [
        assertDefault('spring-stiffness', 200, 'd'),
        assertDefault('spring-damping', 20, 'd'),
        assertDefault('magnification-spread', 3, 'i'),
        assertDefault('magnification-easing-duration', 100, 'i'),
        assertDefault('startup-animation-time', 500, 'i'),
        assertDefault('icon-animator-duration', 3000, 'i'),
        assertDefault('preview-max-height', 150, 'i'),
        assertDefault('preview-animation-duration', 250, 'i'),
        assertDefault('preview-hover-enter-timeout', 300, 'i'),
        assertDefault('preview-hover-leave-timeout', 300, 'i'),
        assertDefault('aero-peek-opacity', 3, 'i'),
        assertDefault('aero-peek-duration', 200, 'i'),
        assertDefault('intellihide-check-interval', 100, 'i'),
        assertDefault('scroll-cycle-debounce', 250, 'i'),
        assertDefault('scroll-workspace-deadtime', 250, 'i'),
        assertDefault('wiggle-long-press-timeout', 500, 'i'),
        assertDefault('window-cycle-memory-time', 3000, 'i'),
        assertDefault('dock-edge-dwell-width', 2, 'i'),
        assertDefault('dock-dwell-check-interval', 100, 'i'),
        assertDefault('shelf-corner-radius-top', 6, 'i'),
        assertDefault('shelf-corner-radius-bottom', 12, 'i'),
        assertDefault('reflection-size', 20, 'i'),
        assertDefault('progress-arc-width', 3, 'i'),
        assertDefault('hotkey-label-scale', 0.3, 'd'),
        assertDefault('tooltip-max-width-px', 700, 'i'),
        assertDefault('spring-overshoot-clamp', 1.15, 'd'),
        assertDefault('pressure-show-timeout', 250, 'i'),
        assertDefault('shelf-angle', 0.2, 'd'),
        assertDefault('shelf-height', 0.45, 'd'),
        {name: 'monitor-positions default is empty object', fn() {
            const s = getSettings();
            const val = s.get_value('monitor-positions').deep_unpack();
            assert(typeof val === 'object', 'should be object');
            assert(Object.keys(val).length === 0, 'should be empty');
        }},
        {name: 'changing a setting propagates', fn() {
            const s = getSettings();
            const orig = s.get_int('magnification-spread');
            s.set_int('magnification-spread', 5);
            const changed = s.get_int('magnification-spread');
            s.set_int('magnification-spread', orig);
            assert(changed === 5, 'setting should change to 5, got ' + changed);
        }},
    ];
}

exports.getTests = getTests;
