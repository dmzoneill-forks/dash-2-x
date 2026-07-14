# Architecture

This document describes the internal structure of XDock: source files, the Clutter actor hierarchy, the settings system, magnification, shelf rendering, and the theme manager.

## Source File Overview

### Core

| File | Purpose |
|---|---|
| `extension.js` | Entry point. Extends `Extension.Extension`, creates `DockManager` on `startup-complete` (with 10s timeout fallback). Patches `OverviewControls.runStartupAnimation` for devkit compatibility. |
| `docking.js` | **Central module.** Contains `DockManager` (singleton), `DockedDash` (per-monitor dock), `DashSlideContainer` (slide-in/out animation), and the settings mapper. |
| `dash.js` | `DockDash` -- fork of GNOME Shell's `Dash`. Manages the icon box, show-apps button, scroll view, separator, and magnification state. |
| `imports.js` | Re-exports all modules as a single namespace to simplify inter-module imports. |
| `utils.js` | `GlobalSignalsHandler`, `InjectionsHandler`, `PropertyInjectionsHandler`, color utilities, monitor helpers. |

### Features (root)

| File | Purpose |
|---|---|
| `appIcons.js` | `DockAppIcon` -- per-app icon with click/scroll/hover behavior. |
| `appIconIndicators.js` | Running/notification dot indicators below icons. |
| `springAnimation.js` | Damped-spring physics animation driver using `Clutter.Timeline`. |
| `intellihide.js` | Auto-hide the dock when windows overlap it. |
| `theming.js` | `ThemeManager` and `Transparency` -- custom themes, shelf rendering, dynamic transparency. |

### Features (`features/`)

| File | Purpose |
|---|---|
| `features/appIconsDecorator.js` | Decorates app icons with badges, counts, progress indicators. |
| `features/appSpread.js` | App window spread (expose all windows of an app). |
| `features/bounceAnimation.js` | Bounce animation on app launch. |
| `features/desktopIconsIntegration.js` | Desktop icons extension compatibility. |
| `features/dockProfiles.js` | Save/restore dock configuration profiles. |
| `features/dockTiling.js` | Window tiling via dock gestures. |
| `features/liveThumbnails.js` | Live window thumbnails in previews. |
| `features/locations.js` / `features/locationsWorker.js` | Trash, mounted volumes, removable devices in the dock. |
| `features/pinnedCommands.js` | Custom pinned command icons. |
| `features/recentFilesMenu.js` | Recent files submenu for app icons. |
| `features/windowPreview.js` | Aero Peek-style window previews on icon hover. |

### Services (`services/`)

| File | Purpose |
|---|---|
| `services/dbusmenuUtils.js` | DBusMenu protocol for app quicklists. |
| `services/fileManager1API.js` | `org.freedesktop.FileManager1` D-Bus integration. |
| `services/launcherAPI.js` | Unity Launcher API (progress bars, counts). |
| `services/mprisMonitor.js` | MPRIS D-Bus media player monitoring. |
| `services/notificationsMonitor.js` | Notification badge tracking. |
| `services/screencastMonitor.js` | Screencast state monitoring (async D-Bus). |
| `services/wallpaperColorExtractor.js` | Extract dominant color from wallpaper for dock tinting. |

### Widgets (`widgets/`)

| File | Purpose |
|---|---|
| `widgets/commandPalette.js` | Quick command launcher overlay. |
| `widgets/mediaControls.js` | Media playback controls in the dock. |
| `widgets/quickSettings.js` | Quick settings integration. |
| `widgets/volumeControl.js` / `widgets/volumeMenuItem.js` | Volume control in dock. |
| `widgets/workspaceMinimap.js` | Workspace minimap overlay. |

### Settings and Preferences

| File | Purpose |
|---|---|
| `prefs.js` | Preferences window (GTK4), binds `Settings.ui` widgets to GSettings. |
| `Settings.ui` | GTK4 Builder XML for the preferences dialog. |
| `schemas/org.gnome.shell.extensions.xdock.gschema.xml` | GSettings schema (27+ keys). |

## Actor Tree Hierarchy

The dock builds a nested Clutter actor tree. Here is the path from stage to icon:

```
global.stage
  uiGroup
    dashtodockContainer  (DockedDash — one per monitor)
      dashtodockBox  (St.BoxLayout — the slide wrapper)
        DashSlideContainer  (slide-x animation container)
          DockDash  (name='dash' — the main dash widget)
            dash-background  (St.Bin — themed background)
              [St.DrawingArea]  (shelf trapezoid overlay, when shelf mode)
            dash-reflection  (St.Bin — reflection widget, when shelf mode)
            dashtodockDashContainer  (St.BoxLayout — icon container)
              scrollView  (St.ScrollView)
                viewport
                  box  (St.BoxLayout — the icon box)
                    DockDashItemContainer  (per-icon wrapper)
                      DockAppIcon  (the actual app icon)
              separator  (between favorites and running apps)
              showAppsButton
```

Key actors:
- **`DockedDash`** (`dashtodockContainer`): top-level per-monitor dock. Manages position, intellihide, slide animation.
- **`DashSlideContainer`**: animates the dock in/out via the `slide-x` property (0 = hidden, 1 = shown).
- **`DockDash`**: fork of GNOME Shell's `Dash`. Owns the icon box, background, separators, show-apps button.

## Settings System

### Schema to property mapping

`DockManager._mapSettingsValues()` converts every GSettings key from `kebab-case` to `camelCase` and attaches it as a property on the `settings` object:

```javascript
// docking.js:3010
_mapSettingsValues() {
    this.settings.settingsSchema.list_keys().forEach(key => {
        const camelKey = key.replace(/-([a-z\d])/g, k => k[1].toUpperCase());
        const updateSetting = () => {
            const schemaKey = this.settings.settingsSchema.get_key(key);
            if (schemaKey.get_range().deepUnpack()[0] === 'enum')
                this.settings[camelKey] = this.settings.get_enum(key);
            else
                this.settings[camelKey] = this.settings.get_value(key).recursiveUnpack();
        };
        updateSetting();
        this._signalsHandler.addWithLabel(Labels.SETTINGS, this.settings,
            `changed::${key}`, updateSetting);
    });
}
```

This means:
- `dock-position` becomes `settings.dockPosition` (enum integer)
- `shelf-angle` becomes `settings.shelfAngle` (double)
- `icon-magnification` becomes `settings.iconMagnification` (boolean)

A `changed::key` signal handler keeps each camelCase property in sync. Aliased `kebab-case` getters are also defined so both forms work.

### Deferred module loading

Secondary modules (command palette, dock profiles, tiling, MPRIS, screencast, spring animation, pinned commands, volume control) are loaded lazily via `Promise.all()` in `_loadDeferredModules()` to reduce startup time.

## Magnification System

Icon magnification (macOS-style icon zoom on hover) requires careful Clutter actor management:

1. **Enable magnification**: `DockDash` sets `offscreen_redirect = Clutter.OffscreenRedirect.ALWAYS` on itself and disables `clip_to_view` on the icon box and dash container. This lets magnified icons paint beyond the dock bounds.

2. **Clip management**: `St.BoxLayout` extends `St.Viewport` which defaults `clip_to_view = true`. The dash explicitly sets `clip_to_view = false` on both `_box` and `_dashContainer` when magnification is enabled.

3. **Offscreen redirect**: the dash itself uses `offscreen_redirect = 0` (none) when magnification is active, while the individual icon containers handle their own painting.

4. **Continuous monitoring**: an `allocation-changed` handler on `_dashContainer` re-checks `clip_to_view` every allocation cycle to guard against GNOME Shell resetting it.

```javascript
// dash.js — magnification setup
this.offscreen_redirect = 0;
this._box.clip_to_view = false;
this._dashContainer.clip_to_view = false;
```

The `magnification-changed` signal is emitted on `DockDash` so other components (theming, shelf overlay) can respond.

## Shelf Rendering

The shelf-style dock uses a Cairo-drawn trapezoid instead of CSS for the background shape.

### How it works

1. `ThemeManager._updateShelfOverlay()` creates an `St.DrawingArea` and adds it as a child of `dash-background` with a `Clutter.BindConstraint` to match the background size.

2. The CSS background is set to `transparent` and `border-radius: 0` so no rectangular background shows through.

3. `_paintShelf(area)` draws the trapezoid path using Cairo:

```
    inset+rt ──────────── w-inset-rt    ← top (narrower)
   /                                  \
  /                                    \
 rb ──────────────────────────────── w-rb  ← bottom (full width)
```

4. The trapezoid is filled with a vertical `Cairo.LinearGradient` from `shelfGradientTopOpacity` to `shelfGradientBottomOpacity`.

5. A 1px highlight line is stroked along the top edge, and a shadow line along the bottom.

6. Configurable parameters:
   - `shelf-angle` -- how much the sides angle inward (0 = rectangle, 1 = extreme trapezoid)
   - `shelf-height` -- what fraction of the dock height the shelf occupies
   - `shelf-corner-radius-top` / `shelf-corner-radius-bottom` -- rounded corners
   - `shelf-gradient-top-opacity` / `shelf-gradient-bottom-opacity` -- gradient fill
   - `shelf-highlight-opacity` -- top edge highlight brightness
   - `shelf-border-opacity` -- border line opacity
   - `shelf-reflection` / `shelf-reflection-opacity` -- reflection effect below the dock

## Theme Manager Lifecycle

`ThemeManager` (in `theming.js`) manages custom styling for each dock instance:

1. **Construction**: creates a `Transparency` instance, connects to overview `showing`/`hiding` signals and `St.ThemeContext.changed`.

2. **Mapped state**: theme change signals are blocked while the dock actor is unmapped. On `notify::mapped`, signals are unblocked and `updateCustomTheme()` is called.

3. **Theme update**: reads all relevant settings (custom colors, transparency mode, dock style), builds inline CSS, and applies it to the dash background.

4. **Shelf overlay**: if `dock-style === SHELF`, creates/updates the `St.DrawingArea` overlay. If switched to `FLAT`, destroys it.

5. **Dynamic transparency**: the `Transparency` class monitors window positions and switches between opaque/transparent styles based on whether windows overlap the dock.

6. **Wallpaper color**: `WallpaperColorExtractor` is lazily loaded to tint the dock background to match the desktop wallpaper.

7. **Cleanup**: `ThemeManager.destroy()` disconnects all signals and destroys the shelf overlay.

## Related Docs

- [Development Guide](DEVELOPMENT.md) -- building, make targets, devkit
- [Testing Guide](TESTING.md) -- test tiers, writing tests, CI
- [Contributing](CONTRIBUTING.md) -- how to submit changes
