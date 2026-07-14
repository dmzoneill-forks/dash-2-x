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

import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';

function takeScreenshot(name, label) {
    const path = `/tmp/xdock-test-${name}.png`;
    try {
        const file = Gio.File.new_for_path(path);
        const stream = file.replace(null, false,
            Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        const screenshot = new Shell.Screenshot();
        let done = false;
        screenshot.screenshot(false, stream, (_obj, res) => {
            try {
                screenshot.screenshot_finish(res);
            } catch (_e) {
                // ignore
            }
            stream.close(null);
            done = true;
        });
        const end = GLib.get_monotonic_time() + 3000000;
        const ctx = GLib.MainContext.default();
        while (!done && GLib.get_monotonic_time() < end)
            ctx.iteration(false);
        if (done && GLib.file_test(path, GLib.FileTest.EXISTS)) {
            // Overlay the test name as embossed text centered on the screenshot
            try {
                label = (label || name).replace(/['"\\]/g, '');
                GLib.spawn_command_line_sync(
                    `convert "${path}" ` +
                    `\\( -size 1920x1080 xc:none ` +
                    `-font Helvetica-Bold -pointsize 36 -gravity Center ` +
                    `-fill "rgba(0,0,0,0.4)" -annotate +2+2 "${label}" ` +
                    `-fill "rgba(255,255,255,0.6)" -annotate +0+0 "${label}" ` +
                    `\\) -composite "${path}"`);
            } catch (_e) {
                // ImageMagick not available — skip overlay
            }
            log(`  screenshot: ${path}`);
        } else {
            log(`  screenshot: failed`);
        }
        return done ? path : null;
    } catch (e) {
        log(`  screenshot: skipped (${e.message})`);
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
        let testIdx = 0;
        let filePassed = 0, fileFailed = 0;
        for (const test of tests) {
            try {
                const result = test.fn();
                if (result && typeof result.then === 'function')
                    await result;
                log(`  PASS: ${test.name}`);
                passed++;
                filePassed++;
            } catch (e) {
                log(`  FAIL: ${test.name} — ${e.message}`);
                failed++;
                fileFailed++;
            }
            // Pump the main loop so the compositor processes pending
            // layout/paint work before the screenshot.
            pumpMainLoop(50);

            // Auto-screenshot every test when enabled.
            if (GLib.getenv('XDOCK_TEST_SCREENSHOTS') === '1') {
                const slug = `${file.replace('.test.js', '')}_${String(testIdx).padStart(2, '0')}`
                    .replace(/[^a-zA-Z0-9_-]/g, '_');
                takeScreenshot(slug, test.name);
            }
            testIdx++;
        }
        log(`  --- ${file}: ${filePassed}/${filePassed + fileFailed} passed ---`);
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

    // Wait for the extension to be loaded and enabled (up to 30s).
    // gnome-shell-test-tool calls run() early — extensions may still be loading.
    let ext = manager.lookup(UUID);
    if (!ext || ext.state !== 1) {
        log(`Extension not ready (state=${ext?.state}), waiting...`);
        const ctx = GLib.MainContext.default();
        const deadline = GLib.get_monotonic_time() + 30 * 1000000;
        while (GLib.get_monotonic_time() < deadline) {
            ctx.iteration(false);
            ext = manager.lookup(UUID);
            if (ext && ext.state === 1)
                break;
        }
        if (!ext || ext.state !== 1) {
            log(`FAIL: Extension state=${ext?.state} after 30s wait, expected 1 (ENABLED)`);
            log(`Available extensions: ${manager.getUuids?.()?.join(', ') ?? 'unknown'}`);
            return;
        }
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
