# Testing Guide

XDock uses a three-tier testing strategy: Jest unit tests with a platform abstraction layer, GJS integration tests, and visual regression checks.

## Test Architecture

```
Tier 1: Jest Unit Tests (Node.js)
  2167 tests across 10 suites, 90% statement coverage
  Tests real source modules through comprehensive GI mock layer
  Platform abstraction layer decouples source code from GNOME introspection

Tier 2: GJS Integration Tests (gnome-shell-test-tool)
  Full GNOME Shell session running headless or in devkit
  14 test files, ~245 tests against live Clutter actors + GSettings
  Runs inside the compositor with access to the live actor tree

Tier 3: Visual Regression (screenshot diff)
  Screenshots from Tier 2 compared pixel-by-pixel against baselines
  ~299 baseline images in test/visual/baselines/
  Uses ImageMagick `compare` with RMSE threshold (1%)
```

## Platform Abstraction Layer

The key to achieving 90% unit test coverage on a GNOME Shell extension is the **platform abstraction layer** — a set of modules that sit between the extension's business logic and the GI (GObject Introspection) runtime.

### Problem

GNOME Shell extensions depend on GI types (`gi://St`, `gi://Clutter`, `gi://GObject`, etc.) that only exist inside the GNOME Shell process. Jest runs in Node.js, so these imports fail. Without a solution, unit tests are limited to pure functions with no GI dependencies — typically under 5% of the codebase.

### Solution

```
Production (GNOME Shell)             Test (Jest/Node.js)
┌──────────────┐                    ┌──────────────┐
│  docking.js  │                    │  docking.js  │
│  dash.js     │                    │  dash.js     │
│  appIcons.js │                    │  appIcons.js │
│  ...         │                    │  ...         │
└──────┬───────┘                    └──────┬───────┘
       │ imports                           │ imports (same paths)
       ▼                                   ▼
┌──────────────────┐               ┌──────────────────┐
│ dependencies/    │               │ test/__mocks__/   │
│   gi.js          │──real GI──►   │   gi.js           │──MockActor, enums
│   shell/ui.js    │               │   shell-ui.js     │──Main, Dash, PopupMenu
│   shell/misc.js  │               │   shell-misc.js   │──Util stubs
│                  │               │                   │
│ platform/        │               │ platform/         │
│   settings.js    │──Gio.Settings │   settings.js     │──in-memory store
└──────────────────┘               └──────────────────┘
```

### How it works

1. **`dependencies/gi.js`** re-exports all GI modules (`gi://St`, `gi://Clutter`, etc.). In Jest, `jest.config.mjs` maps this path to `test/__mocks__/gi.js` which provides comprehensive stubs.

2. **`platform/settings.js`** wraps `Gio.Settings` access. Source files call `Settings.get('dock-position')` instead of `DockManager.settings.dockPosition`. In Jest, the mock provides an in-memory settings store with `_reset()`, `_setMany()`, and change listeners.

3. **`test/__mocks__/gi.js`** provides:
   - **`MockActor`** base class with `add_child()`, `connect()`, `emit()`, `ease()`, style management, geometry, and all common Clutter/St widget methods
   - **`GObject.registerClass()`** that wraps classes so `new Klass(params)` calls `_init(params)`, matching GJS behavior
   - **Enums and constants** for `St.Side`, `Clutter.AnimationMode`, `Meta.WindowType`, etc.
   - **`St.Widget`**, **`St.BoxLayout`**, **`St.Bin`**, **`St.ScrollView`** — real extendable classes with full mock API

4. **`test/__mocks__/shell-ui.js`** provides stubs for `Main.layoutManager`, `Main.overview`, `Main.panel`, `Dash`, `PopupMenu`, `DND`, `AppFavorites`, and other GNOME Shell UI modules.

### Platform modules

| Module | Production | Mock |
|--------|-----------|------|
| `platform/settings.js` | Wraps `Gio.Settings` via `DockManager.settings` | In-memory key-value store with `_reset()`, `_setMany()` |
| `platform/layout.js` | Wraps `Main.layoutManager`, `Main.overview` | Monitor geometry stubs |
| `platform/actors.js` | Wraps `St`/`Clutter` widget creation | Factory for `MockActor` instances |
| `platform/signals.js` | Wraps `GObject` `connect`/`disconnect`/`emit` | Pass-through to mock signals |
| `platform/animations.js` | Wraps `Clutter.Timeline`, `GLib` timeouts | Immediate execution or no-op |
| `platform/theme.js` | Wraps CSS class management, inline styles | Set/get on mock style state |

### Writing a unit test

```javascript
import { jest } from '@jest/globals';
import * as Settings from '../platform/settings.js';
import { Intellihide, rectsOverlap, OverlapStatus } from '../intellihide.js';

describe('rectsOverlap', () => {
    test('returns true for overlapping rectangles', () => {
        const rect = { x: 0, y: 0, width: 100, height: 100 };
        const target = { x1: 50, y1: 50, x2: 150, y2: 150 };
        expect(rectsOverlap(rect, target)).toBe(true);
    });
});

describe('Intellihide', () => {
    beforeEach(() => {
        Settings._reset();
    });

    test('creates instance with default settings', () => {
        const ih = new Intellihide(0);
        expect(ih).toBeDefined();
    });

    test('responds to intellihide mode setting', () => {
        Settings._setMany({ 'intellihide-mode': 2 });
        const ih = new Intellihide(0);
        // Exercise the method that reads intellihide-mode
        ih._updateDockVisibility();
    });
});
```

### Key patterns

- **`Settings._reset()`** in `beforeEach` — clears the mock store to default values
- **`Settings._setMany({...})`** — configure multiple settings before constructing objects
- **`new GObjectClass(params)`** — the `GObject.registerClass` mock wraps the class so `new` calls `_init(params)` like GJS
- **`jest.spyOn(obj, 'method')`** — mock internal methods that call external APIs
- **Prototype method testing** — `SomeClass.prototype.someMethod.call(mockContext)` for testing methods in isolation

## Running Tests Locally

### Unit tests (Tier 1)

```bash
make test
# or
npm test
# or with coverage
NODE_OPTIONS='--experimental-vm-modules' npx jest --coverage
```

### Integration tests (Tier 2)

Requires `mutter-devkit` (`sudo dnf install mutter-devkit`).

```bash
# Headless (CI-style, no hold)
make integration-test

# Interactive (visible devkit window, holds 30s for inspection)
make integration-test-interactive

# With per-test screenshots saved to /tmp/
make integration-test-screenshots
```

### Visual regression (Tier 3)

Requires `ImageMagick` and `bc`.

```bash
# Run screenshots then compare against baselines
make visual-regression

# Update baselines after intentional visual changes
make update-baselines
```

### Smoke tests

```bash
# Local (requires mutter-devkit)
make smoke-test

# Container (requires podman)
make smoke-test-pod
```

## Test File Structure

```
test/
  __mocks__/
    gi.js              # GI module stubs: MockActor, GObject, St, Clutter, etc.
    shell-ui.js        # GNOME Shell UI stubs: Main, Dash, PopupMenu, DND
    shell-misc.js      # Shell misc stubs: Config, Util
    shell-extension.js # Extension class stub
    imports.js         # Cross-module import stubs (Docking, Utils, etc.)
    platform/
      settings.js      # In-memory settings mock with _reset(), _setMany()
      layout.js        # Layout manager mock
      actors.js        # Actor factory mock
      signals.js       # Signal connection mock
      animations.js    # Animation/timeout mock
      theme.js         # CSS class management mock
  setup.js             # Jest global setup (globals, GJS compat)
  globalSetup.js       # Jest global setup hook

  # Unit test suites (10 files, 2167 tests)
  appIcons.test.js     # Click actions, urgency, window filtering, icon class
  dash.test.js         # Dash construction, icon sizing, magnification, redisplay
  docking.test.js      # DashSlideContainer, DockedDash, DockManager, IconAnimator
  intellihide.test.js  # Overlap detection, window type handling, mode switching
  theming.test.js      # Shelf styles, Cairo drawing, theme class management
  windowPreview.test.js # Preview scaling, menu construction, hover behavior
  springAnimation.test.js # Spring physics parameter computation
  utils.test.js        # Position math, color parsing, settings mapping
  dash-math.test.js    # Magnification falloff/scale math
  platform-settings.test.js # Platform settings mock verification

  integration/
    runner.js           # Entry point: discovers .test.js files, runs in GJS
    helpers.js          # Shared utilities (assertions, screenshots, settings)
    dock-basics.test.js        # Extension loading, dock presence, position
    dock-features.test.js      # Feature-specific dock behavior
    shelf-style.test.js        # Shelf/trapezoid rendering and settings
    magnification.test.js      # Icon magnification and clip behavior
    app-icons.test.js          # App icon presence and interaction
    icon-indicators.test.js    # Running/notification indicators
    auto-hide.test.js          # Autohide and intellihide behavior
    per-monitor.test.js        # Multi-monitor dock placement
    preferences-ui.test.js     # Preferences dialog validation
    settings-binding.test.js   # GSettings round-trip verification
    spring-animation.test.js   # Spring physics animation
    theming.test.js            # Theme manager and transparency
    visual-changes.test.js     # Visual state change detection
    window-previews.test.js    # Window preview (Aero Peek) behavior
  smoke/
    load-extension.js   # Minimal smoke test: extension loads without crash
    run-in-pod.sh       # Podman container smoke test runner
  visual/
    baselines/          # ~299 reference screenshots (PNG)
    scripts/
      compare.sh        # Diff screenshots against baselines (RMSE)
      update-baselines.sh  # Copy latest screenshots to baselines/
```

## Coverage Breakdown

| File | Statements | Branches | Functions |
|------|-----------|----------|-----------|
| springAnimation.js | 100% | 100% | 100% |
| intellihide.js | 100% | 90% | 100% |
| windowPreview.js | 100% | 100% | 100% |
| theming.js | 97% | 95% | 84% |
| dash.js | 91% | 84% | 84% |
| docking.js | 88% | 80% | 82% |
| utils.js | 86% | 84% | 82% |
| appIcons.js | 85% | 82% | 73% |
| **Overall** | **90%** | **84%** | **83%** |

## Writing New Integration Tests

Integration tests run inside GNOME Shell via `gnome-shell-test-tool`. They are plain GJS scripts (not ESM modules) loaded by the runner with `new Function()`.

### Test file template

Each test file exports a `getTests()` function that returns an array of `{name, fn}` objects:

```javascript
// test/integration/my-feature.test.js

function assert(cond, msg) { if (!cond) throw new Error(msg); }

function getTests() {
    const {Gio, St} = imports.gi;

    function findDock() {
        const uiGroup = global.stage.get_children().find(c => c.name === 'uiGroup');
        return uiGroup?.get_children().find(c => c.name === 'dashtodockContainer');
    }

    return [
        {name: 'my feature works', fn() {
            const dock = findDock();
            assert(dock !== null, 'dock should exist');
        }},

        {name: 'setting round-trips correctly', fn() {
            const s = getXDockSettings();  // injected by runner
            const orig = s.get_boolean('my-setting');
            s.set_boolean('my-setting', !orig);
            const changed = s.get_boolean('my-setting');
            s.set_boolean('my-setting', orig);
            assert(changed === !orig, 'setting should toggle');
        }},
    ];
}

exports.getTests = getTests;
```

### Key patterns

- **`getXDockSettings()`** -- injected by the runner, returns a `Gio.Settings` for the extension schema
- **`screenshot(name)`** -- injected by the runner, captures the current frame to `/tmp/xdock-test-{name}.png`
- **Actor tree walking** -- start from `global.stage`, find `uiGroup`, then `dashtodockContainer`
- **Async tests** -- return a Promise from `fn()` and the runner will await it

## CI Pipeline

GitHub Actions runs on every push and PR (`.github/workflows/test.yml`):

| Job | What it does |
|---|---|
| **Jest Unit Tests** | 2167 tests with 90% coverage via platform layer mocks |
| **Smoke Test** | Extension loads without crash errors in Podman containers (Fedora 44-45) |
| **Integration Tests** | Full test suite headless in Podman container with `gnome-shell-test-tool` |
| **Visual Regression** | Compare screenshots against baselines using ImageMagick RMSE (1% threshold) |

Dynamic badges on the README show live test counts and coverage from the latest CI run.

### Updating baselines

After intentional visual changes:

```bash
make update-baselines
git add test/visual/baselines/
git commit -m "Update visual baselines"
```

## Related Docs

- [Development Guide](DEVELOPMENT.md) -- building, make targets, devkit
- [Architecture](ARCHITECTURE.md) -- source file overview, actor tree
- [Contributing](CONTRIBUTING.md) -- PR requirements, code style
