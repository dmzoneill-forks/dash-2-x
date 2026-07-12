// SPDX-License-Identifier: GPL-2.0-or-later
// Integration test runner for xdock.
// Supports both sync and async tests with GLib main loop pumping.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const UUID = 'xdock@github.com';

function log(msg) {
    print(`[XDOCK-TEST] ${msg}`);
}

// ── Schema access ────────────────────────────────────────────────────

let _cachedSchemaSource = null;
function _getXDockSettings() {
    if (!_cachedSchemaSource) {
        const ext = Main.extensionManager.lookup(UUID);
        const schemaDir = ext.dir.get_child('schemas');
        _cachedSchemaSource = Gio.SettingsSchemaSource.new_from_directory(
            schemaDir.get_path(),
            Gio.SettingsSchemaSource.get_default(),
            false);
    }
    const schema = _cachedSchemaSource.lookup(
        'org.gnome.shell.extensions.xdock', true);
    return new Gio.Settings({settings_schema: schema});
}

// ── Screenshot helper ────────────────────────────────────────────────

function takeScreenshot(name) {
    try {
        const path = `/tmp/xdock-test-${name}.png`;
        const proxy = Gio.DBusProxy.new_for_bus_sync(
            Gio.BusType.SESSION,
            Gio.DBusProxyFlags.NONE,
            null,
            'org.gnome.Shell.Screenshot',
            '/org/gnome/Shell/Screenshot',
            'org.gnome.Shell.Screenshot',
            null);
        proxy.call_sync(
            'Screenshot',
            new GLib.Variant('(bbs)', [false, true, path]),
            Gio.DBusCallFlags.NONE,
            5000,
            null);
        log(`  screenshot: ${path}`);
        return path;
    } catch (e) {
        log(`  screenshot failed: ${e.message}`);
        return null;
    }
}

// ── Test file loading ────────────────────────────────────────────────

function discoverTests(dir) {
    const testFiles = [];
    const d = Gio.File.new_for_path(dir);
    try {
        const enumerator = d.enumerate_children(
            'standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            const name = info.get_name();
            if (name.endsWith('.test.js'))
                testFiles.push(name);
        }
    } catch (_e) {
        // ignore
    }
    return testFiles.sort();
}

function loadTestFile(dir, filename) {
    const path = GLib.build_filenamev([dir, filename]);
    try {
        const [, bytes] = GLib.file_get_contents(path);
        const source = new TextDecoder().decode(bytes);
        const exports = {};
        new Function('exports', 'getXDockSettings', 'screenshot', source)(
            exports, _getXDockSettings, takeScreenshot);
        if (typeof exports.getTests === 'function')
            return exports.getTests();
    } catch (e) {
        log(`ERROR loading ${filename}: ${e.message}`);
    }
    return [];
}

// ── Async runner with main loop pumping ──────────────────────────────

function waitMs(ms) {
    return new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

function pumpMainLoop(ms) {
    const ctx = GLib.MainContext.default();
    const end = GLib.get_monotonic_time() + ms * 1000;
    while (GLib.get_monotonic_time() < end)
        ctx.iteration(false);
}

async function runAllTests(testDir, testFiles) {
    let passed = 0, failed = 0;

    for (const file of testFiles) {
        log(`--- ${file} ---`);
        const tests = loadTestFile(testDir, file);
        for (const test of tests) {
            try {
                const result = test.fn();
                // Support async tests — if fn returns a Promise, await it
                // with main loop pumping so GLib timers/signals fire.
                if (result && typeof result.then === 'function') {
                    await result;
                }
                log(`  PASS: ${test.name}`);
                passed++;
            } catch (e) {
                log(`  FAIL: ${test.name} — ${e.message}`);
                failed++;
            }
            // Pump the main loop briefly between tests so the compositor
            // processes any pending layout/paint work.
            pumpMainLoop(10);
        }
    }

    log('');
    log(`Results: ${passed} passed, ${failed} failed`);
    log(failed === 0 ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
}

// ── Entry point ──────────────────────────────────────────────────────

/** @param {string[]} _argv */
export function run(_argv) {
    log('Runner starting...');

    const manager = Main.extensionManager;
    if (!manager) {
        log('FAIL: No extension manager');
        return;
    }

    const ext = manager.lookup(UUID);
    if (!ext || ext.state !== 1) {
        log(`FAIL: Extension state=${ext?.state}, expected 1`);
        return;
    }
    log('Extension loaded and enabled');

    // Make dock always visible during tests.
    try {
        const s = _getXDockSettings();
        s.set_boolean('dock-fixed', true);
        s.set_boolean('autohide', false);
        s.set_boolean('intellihide', false);
    } catch (_e) {
        log('Warning: could not set dock-fixed for testing');
    }

    // Let the dock settle after settings change.
    pumpMainLoop(500);

    // Find test directory.
    const extPath = ext.path || ext.dir?.get_path?.();
    const candidates = [
        extPath ? GLib.build_filenamev([extPath, 'test', 'integration']) : null,
        'test/integration',
        `${GLib.get_home_dir()}/src/xdock/test/integration`,
    ].filter(Boolean);

    let testDir = null;
    for (const dir of candidates) {
        if (GLib.file_test(dir, GLib.FileTest.IS_DIR)) {
            testDir = dir;
            break;
        }
    }
    if (!testDir) {
        log(`FAIL: Cannot find test directory`);
        return;
    }

    const testFiles = discoverTests(testDir);
    log(`Found ${testFiles.length} test files in ${testDir}`);

    // Run tests asynchronously with main loop support.
    // We use a nested main loop so the export run() blocks until done.
    const loop = new GLib.MainLoop(null, false);

    runAllTests(testDir, testFiles).then(() => {
        // Hold for interactive viewing.
        const holdSecs = parseInt(GLib.getenv('XDOCK_TEST_HOLD') ?? '30', 10);
        if (holdSecs > 0) {
            log(`Holding for ${holdSecs}s (set XDOCK_TEST_HOLD=0 to skip)...`);
            GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, holdSecs, () => {
                loop.quit();
                return GLib.SOURCE_REMOVE;
            });
        } else {
            loop.quit();
        }
    }).catch(e => {
        log(`ERROR: ${e.message}`);
        loop.quit();
    });

    loop.run();
}
