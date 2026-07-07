# XDock

[![Test](https://github.com/dmzoneill-forks/xdock/actions/workflows/test.yml/badge.svg)](https://github.com/dmzoneill-forks/xdock/actions/workflows/test.yml)
[![Make](https://github.com/dmzoneill-forks/xdock/actions/workflows/make.yml/badge.svg)](https://github.com/dmzoneill-forks/xdock/actions/workflows/make.yml)
[![shexli](https://github.com/dmzoneill-forks/xdock/actions/workflows/shexli.yml/badge.svg)](https://github.com/dmzoneill-forks/xdock/actions/workflows/shexli.yml)
[![CodeQL](https://github.com/dmzoneill-forks/xdock/actions/workflows/security-codeql.yml/badge.svg)](https://github.com/dmzoneill-forks/xdock/actions/workflows/security-codeql.yml)
[![Dependency Scan](https://github.com/dmzoneill-forks/xdock/actions/workflows/security-dependencies.yml/badge.svg)](https://github.com/dmzoneill-forks/xdock/actions/workflows/security-dependencies.yml)
[![SAST](https://github.com/dmzoneill-forks/xdock/actions/workflows/security-sast.yml/badge.svg)](https://github.com/dmzoneill-forks/xdock/actions/workflows/security-sast.yml)
[![Secret Scan](https://github.com/dmzoneill-forks/xdock/actions/workflows/security-secrets.yml/badge.svg)](https://github.com/dmzoneill-forks/xdock/actions/workflows/security-secrets.yml)

A community-driven dock for the GNOME Shell.

**Forked from [Dash to Dock](https://github.com/micheleg/dash-to-dock) by Michele (micxgx@gmail.com).**

XDock is a community fork focused on timely updates, inclusive contribution, and user-centric development. We actively review and merge pull requests, welcome new contributors, and prioritize the features and fixes that users care about.

## Why this fork?

The original Dash to Dock is a great project, but development and PR reviews have slowed significantly. XDock exists to keep the extension moving forward:

- **Timely updates** — PRs are reviewed and merged promptly, not left open for years
- **Community driven** — decisions are made in the open with input from users and contributors
- **Inclusive contribution** — all skill levels welcome, clear guidelines, responsive maintainers
- **User centric** — features and fixes are prioritized based on what users actually need

## Want to help maintain?

We're actively looking for co-maintainers. If you're interested, [open an issue](https://github.com/dmzoneill-forks/xdock/issues/new?title=Maintainer+Interest&labels=maintainer) and tell us a bit about yourself and what areas you'd like to help with.

## Features

In addition to all the original Dash to Dock functionality, XDock includes:

- Window preview on hover (Aero Peek style)
- App icon categories with drag-and-drop grouping
- Ungroup applications (per-window dock icons)
- Dock margin size customization
- Bounce animation for launching icons
- Cycle or minimize window behavior
- Location apps in separate dock section
- Improved intellihide and autohide fixes

## Installation from source

### Build Dependencies

To compile the stylesheet you'll need an implementation of SASS. The default is `dart-sass` (the `sass` command). You can also use `sassc` or `ruby-sass` by setting the `SASS` variable.

```bash
# Install dart-sass (default, recommended)
npm install -g sass

# To use sassc instead:
export SASS=sassc

# To use ruby-sass instead:
export SASS=ruby
```

### Building

```bash
git clone https://github.com/dmzoneill-forks/xdock.git
make -C xdock install
```

A Shell reload is required: <kbd>Alt</kbd>+<kbd>F2</kbd> then type `r` under Xorg, or log out and back in on Wayland. Enable the extension with *GNOME Extensions* app or *dconf*.

If `msgfmt` is not available:

```bash
# Install gettext from your distribution's repository
# Fedora: sudo dnf install gettext
# Ubuntu: sudo apt install gettext
```

## Development

### Nested test session (Mutter Development Kit)

You can test XDock in a nested GNOME Shell session without logging out. This runs a full GNOME Shell inside a window on your current desktop.

**Prerequisites:**

```bash
# Fedora 44+ / GNOME 50+
sudo dnf install mutter-devkit
```

**Launch a test session:**

```bash
# Remove the disable-extensions lockfile (created by the main GNOME session)
rm -f /run/user/$(id -u)/gnome-shell-disable-extensions

# Launch nested GNOME Shell with XDock enabled
dbus-run-session -- bash -c '
  rm -f /run/user/$(id -u)/gnome-shell-disable-extensions
  gsettings set org.gnome.shell enabled-extensions "[\"xdock@github.com\"]"
  exec gnome-shell --wayland --no-x11 --devkit
'
```

The `gnome-shell-disable-extensions` file is recreated by the main GNOME session periodically. If the nested session doesn't load extensions, delete it again and restart.

**Development symlink:**

For development, symlink the source directory instead of copying files:

```bash
ln -sf $(pwd) ~/.local/share/gnome-shell/extensions/xdock@github.com
```

Changes to JS files take effect on the next nested session launch — no build step needed. Changes to `Settings.ui` or schemas require recompiling:

```bash
glib-compile-schemas schemas/
```

**Notes:**

- The nested session runs at higher CPU than normal — this is expected for the devkit compositor
- If you see "Not Responding", click **Wait** — the session needs a few seconds to initialize
- The session uses a virtual monitor added after startup, so extensions that depend on monitors will initialize via the `monitors-changed` signal
- For GNOME Shell versions before 49, use `--nested` instead of `--devkit`

### Viewing logs

```bash
# Watch extension logs in real time
journalctl -f -o cat /usr/bin/gnome-shell | grep -i xdock

# Or filter the test session's stderr output
dbus-run-session -- bash -c '...' 2>&1 | grep -E 'xdock|error|Error'
```

### Testing

XDock uses a two-tier testing strategy that runs automatically on every push and pull request via GitHub Actions.

#### Unit tests (Jest)

Pure logic functions (color math, magnification falloff, icon sizing, dock position calculations) are tested in Node.js with mocked GI modules. 184 tests at 90% code coverage.

```bash
# Run unit tests
make test
# or
npm test

# Run with coverage report
NODE_OPTIONS='--experimental-vm-modules' npx jest --coverage
```

The GI module mocks are in `test/__mocks__/` — they provide minimal stubs of `St`, `Clutter`, `GObject`, `Gio`, etc. so that `utils.js` can be imported and tested without a GNOME Shell runtime.

#### Smoke tests (containerized GNOME Shell)

The extension is installed and enabled inside a real GNOME Shell session running in a [gnome-shell-pod](https://github.com/Schneegans/gnome-shell-pod) container (Fedora 41 / GNOME 47 and Fedora rawhide). This verifies the extension loads without `TypeError`, `SyntaxError`, or other crash errors. Screenshots are uploaded as CI artifacts.

```bash
# Run locally with podman (requires podman)
make smoke-test-pod

# Or manually
bash test/smoke/run-in-pod.sh rawhide
bash test/smoke/run-in-pod.sh 41
```

#### Local devkit smoke test

If you have `mutter-devkit` installed, you can run a smoke test in a local nested session:

```bash
make smoke-test
```

#### Writing new tests

To add unit tests for a new utility function:

1. If the function uses GI modules, ensure the needed symbols are in `test/__mocks__/gi.js`
2. Add tests to `test/utils.test.js` or create a new `test/*.test.js` file
3. Run `make test` to verify

Functions that depend on the GNOME Shell runtime (VFunc injection, Clutter actors, St widgets) cannot be unit-tested in Node.js — use the smoke test tier instead.

### Validating UI files

```bash
# Check XML validity
xmllint --noout Settings.ui

# Preview a UI file
gtk4-builder-tool preview Settings.ui

# Compile and validate schemas
glib-compile-schemas --strict schemas/
```

## Contributing

We welcome contributions of all kinds — bug fixes, new features, translations, documentation, and testing.

1. Fork the repo and create a feature branch
2. Make your changes
3. Run `make test` to verify unit tests pass
4. Test in a [nested session](#nested-test-session-mutter-development-kit)
5. Submit a pull request — CI will run unit tests and smoke tests automatically

PRs are reviewed promptly. If you're unsure about an approach, open an issue first to discuss.

## Bug Reporting

Report bugs at [https://github.com/dmzoneill-forks/xdock/issues](https://github.com/dmzoneill-forks/xdock/issues).

## License

XDock is distributed under the terms of the GNU General Public License, version 2 or later. See the COPYING file for details.
