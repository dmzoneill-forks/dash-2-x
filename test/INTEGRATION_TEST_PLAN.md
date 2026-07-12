# XDock Integration Test Plan

## Architecture

```
test/
├── __mocks__/           # Existing Jest GI mocks
├── smoke/
│   └── load-extension.js   # Existing: verify extension loads
├── integration/
│   ├── runner.js            # GJS test runner (discovers + runs test files)
│   ├── helpers.js           # Shared utilities (get dock, wait, assert)
│   ├── dock-position.test.js
│   ├── magnification.test.js
│   ├── shelf-style.test.js
│   ├── auto-hide.test.js
│   ├── window-previews.test.js
│   ├── settings-binding.test.js
│   ├── per-monitor.test.js
│   ├── spring-animation.test.js
│   ├── icon-indicators.test.js
│   └── preferences-ui.test.js
├── visual/
│   ├── capture.sh           # Screenshot via D-Bus
│   ├── compare.sh           # ImageMagick diff against baseline
│   └── baselines/           # Reference screenshots
├── container/               # Existing: Containerfile, helper scripts
├── dash-math.test.js        # Existing Jest tests
└── utils.test.js            # Existing Jest tests
```

## Execution

### Local
```bash
# Unit tests (existing)
make test

# Smoke test (existing)
make smoke-test

# Integration tests (new)
make integration-test
# → gnome-shell-test-tool --headless --extension . test/integration/runner.js

# Visual tests (new)
make visual-test
# → launches headless session, captures screenshots, compares to baselines
```

### CI (.github/workflows/test.yml)
Add integration-test job after smoke-test, using the same container infrastructure.

## Runner Design (test/integration/runner.js)

GJS script that:
1. Waits for extension to be fully loaded (`extensionManager.lookup()`)
2. Discovers test files matching `*.test.js` in the integration dir
3. For each test file: imports and calls `run(context)` function
4. Tracks pass/fail counts
5. Exits with code 0 (all pass) or 1 (any fail)

### Context object passed to each test:
```javascript
{
    ext,           // Extension object
    dockManager,   // DockManager instance
    dock,          // Primary DockedDash
    dash,          // DockDash
    settings,      // GSettings wrapper
    assert(condition, message),
    assertEqual(actual, expected, message),
    assertRange(value, min, max, message),
    waitMs(ms),    // GLib.timeout_add promise wrapper
    setSetting(key, value),   // Change + wait for propagation
    screenshot(name),         // D-Bus screenshot to /tmp/xdock-test-{name}.png
}
```

## Test Specifications

### 1. dock-position.test.js
```
- Default position: dock at BOTTOM edge
- Change dock-position to LEFT → dock moves to left edge
- Change dock-position to TOP → dock at top
- Verify dock width matches fraction * workArea.width (horizontal)
- Verify dock height matches fraction * workArea.height (vertical)
```

### 2. magnification.test.js
```
- With icon-magnification=true, magnification-factor=2.0:
  - Inject motion event at center icon → icon scale > 1.0
  - Neighbor icons scale < center but > 1.0
  - Icons beyond spread have scale == 1.0
  - Inject leave event → all scales return to 1.0
- magnification-spread setting: change from 3→5 → more icons affected
- magnification-easing-duration: verify easing duration on icon actors
- Verify background scale_x > 1.0 during magnification
- Verify clip_to_view=false on box ancestors during magnification
```

### 3. shelf-style.test.js
```
- dock-style=FLAT: no shelf overlay, standard background
- dock-style=SHELF: shelf DrawingArea overlay exists and is visible
- Shelf parameters (angle, height, corner radii):
  - Change shelf-angle → shelf overlay repaints
  - Change shelf-height → shelf overlay repaints
  - Change shelf-corner-radius-top/bottom → overlay repaints
- Gradient opacity sliders: change → background updates (no icon reset)
```

### 4. auto-hide.test.js
```
- autohide=true: dock hidden after timeout
- Inject pressure at screen edge → dock shows
- dock-edge-dwell-width: verify barrier position matches setting
- pressure-show-timeout: verify timing
- intellihide: dock hides when window overlaps, shows when clear
- intellihide-check-interval: verify polling rate
```

### 5. window-previews.test.js
```
- show-previews-hover=true: hover over running app icon →
  preview menu opens after preview-hover-enter-timeout
- Mouse leave → preview closes after preview-hover-leave-timeout
- preview-max-height: verify preview actor height ≤ setting
- preview-animation-duration: verify ease duration
- aero-peek-opacity/duration: verify window opacity during peek
```

### 6. settings-binding.test.js
```
- For each new preference key (27 total):
  - Change via GSettings → verify the corresponding code reads the new value
  - Verify default value matches schema
- Profile save/load: save profile → change settings → load profile → verify restored
```

### 7. per-monitor.test.js
```
- Single monitor: no position override, follows global
- Multi-monitor (if available): set monitor-positions → verify each dock position
- Verify changed::monitor-positions triggers dock rebuild
```

### 8. spring-animation.test.js
```
- spring-stiffness/damping: change → verify spring params in show/hide animation
- spring-overshoot-clamp: verify slideX never exceeds clamp value
- startup-animation-time: verify startup animation duration
```

### 9. icon-indicators.test.js
```
- progress-arc-width: launch app with progress → verify arc line width
- hotkey-label-scale: verify number overlay font size matches setting
- Running indicator styles: cycle through all 10 styles → verify CSS classes
```

### 10. preferences-ui.test.js
```
- For each widget ID referenced in prefs.js:
  - Verify it exists in Settings.ui
  - Verify GSettings key exists in schema
- For each GSettings key in schema:
  - Verify a binding or handler exists in prefs.js
- All new slider adjustments: verify lower/upper/default match schema
```

## Synthetic Event Injection

For hover/click testing, use Clutter's event synthesis:
```javascript
// Synthesize motion event
const event = Clutter.Event.new(Clutter.EventType.MOTION);
event.set_coords(x, y);
event.set_stage(global.stage);
actor.emit('motion-event', event);

// Or use the actor's allocation to compute center coordinates
const [ax, ay] = actor.get_transformed_position();
const [aw, ah] = actor.get_transformed_size();
const cx = ax + aw / 2;
const cy = ay + ah / 2;
```

## Visual Testing

### Capture
```bash
dbus-send --session --type=method_call --print-reply \
  --dest=org.gnome.Shell.Screenshot \
  /org/gnome/Shell/Screenshot \
  org.gnome.Shell.Screenshot.Screenshot \
  boolean:false boolean:true "string:/tmp/test-screenshot.png"
```

### Comparison
```bash
# Generate diff image and metric
compare -metric RMSE baseline.png actual.png diff.png 2>&1
# Threshold: RMSE < 5% = pass
```

### Baselines
Generated once on a known-good build, stored in `test/visual/baselines/`.
Updated when visual changes are intentional.

## Priority Order

1. **Runner + helpers** — foundational
2. **settings-binding** — catches the most regressions (all 27 new keys)
3. **magnification** — complex feature, most likely to regress
4. **dock-position** — basic functionality
5. **shelf-style** — new feature
6. **auto-hide** — existing feature, complex interactions
7. **window-previews** — timing-dependent
8. **visual tests** — screenshot baselines
