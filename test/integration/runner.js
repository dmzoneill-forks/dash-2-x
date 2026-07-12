// SPDX-License-Identifier: GPL-2.0-or-later
// Integration test runner for xdock.
// Run: make integration-test

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const UUID = 'xdock@github.com';

function log(msg) {
    print(`[XDOCK-TEST] ${msg}`);
}

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

function loadTestFile(dir, filename) {
    const path = GLib.build_filenamev([dir, filename]);
    try {
        const [, bytes] = GLib.file_get_contents(path);
        const source = new TextDecoder().decode(bytes);
        const exports = {};
        new Function('exports', 'getXDockSettings', source)(exports, _getXDockSettings);
        if (typeof exports.getTests === 'function')
            return exports.getTests();
    } catch (e) {
        log(`ERROR loading ${filename}: ${e.message}`);
    }
    return [];
}

function _runTests() {
    const manager = Main.extensionManager;
    if (!manager) {
        log('FAIL: No extension manager');
        return;
    }

    // Make the dock always visible during tests so it's
    // visible in the devkit window and testable.
    try {
        const s = _getXDockSettings();
        s.set_boolean('dock-fixed', true);
        s.set_boolean('autohide', false);
        s.set_boolean('intellihide', false);
    } catch (_e) {
        log('Warning: could not set dock-fixed for testing');
    }

    const ext = manager.lookup(UUID);
    if (!ext || ext.state !== 1) {
        log(`FAIL: Extension state=${ext?.state}, expected ENABLED (1)`);
        return;
    }
    log('Extension loaded and enabled');

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
        log(`FAIL: Cannot find test directory (tried: ${candidates.join(', ')})`);
        return;
    }

    const testFiles = discoverTests(testDir);
    log(`Found ${testFiles.length} test files in ${testDir}`);

    let passed = 0, failed = 0;

    for (const file of testFiles) {
        log(`--- ${file} ---`);
        const tests = loadTestFile(testDir, file);
        for (const test of tests) {
            try {
                test.fn();
                log(`  PASS: ${test.name}`);
                passed++;
            } catch (e) {
                log(`  FAIL: ${test.name} — ${e.message}`);
                failed++;
            }
        }
    }

    log('');
    log(`Results: ${passed} passed, ${failed} failed`);
    log(failed === 0 ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
}

/** @param {string[]} _argv */
export function run(_argv) {
    log('Runner starting, waiting for extension...');
    _runTests();

    // Hold the shell open so the devkit window stays visible.
    // Set XDOCK_TEST_HOLD=0 to skip (e.g., in CI).
    const holdSecs = parseInt(GLib.getenv('XDOCK_TEST_HOLD') ?? '30', 10);
    if (holdSecs > 0) {
        log(`Holding for ${holdSecs}s (set XDOCK_TEST_HOLD=0 to skip)...`);
        const loop = new GLib.MainLoop(null, false);
        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, holdSecs, () => {
            loop.quit();
            return GLib.SOURCE_REMOVE;
        });
        loop.run();
    }
}
