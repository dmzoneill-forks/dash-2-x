# Dash 2 X

## A dock for the GNOME Shell

This extension enhances the dash, moving it out of the overview and transforming it into a dock for easier launching of applications and faster switching between windows and desktops without having to leave the desktop view.

**Forked from [Dash to Dock](https://github.com/micheleg/dash-to-dock) by Michele (micxgx@gmail.com).**

## Installation from source

### Build Dependencies

To compile the stylesheet you'll need an implementation of SASS. Dash 2 X supports `dart-sass` (`sass`), `sassc`, and `ruby-sass`. Every distro should have at least one of these implementations, we recommend using `dart-sass` (`sass`) or `sassc` over `ruby-sass` as `ruby-sass` is deprecated.

By default, Dash 2 X will attempt to build with `sassc`. To change this behavior set the `SASS` environment variable to either `dart` or `ruby`.

```bash
export SASS=dart
# or...
export SASS=ruby
```

### Building

Clone the repository or download the branch from github. A simple Makefile is included.

Next use `make` to install the extension into your home directory. A Shell reload is required <kbd>Alt</kbd> + <kbd>F2</kbd> <kbd>r</kbd> <kbd>Enter</kbd> under Xorg or under Wayland you may have to logout and login. The extension has to be enabled  with *gnome-extensions-app* (GNOME Extensions) or with *dconf*.

```bash
git clone https://github.com/daoneill/dash-2-x.git
make -C dash-2-x install
```

If `msgfmt` is not available on your system, you will see an error message like the following:

```bash
make: msgfmt: No such file or directory
```

In this case install the `gettext` package from your distribution's repository.

## Bug Reporting

Bugs should be reported to the Github bug tracker [https://github.com/daoneill/dash-2-x/issues](https://github.com/daoneill/dash-2-x/issues).

## License
Dash 2 X Gnome Shell extension is distributed under the terms of the GNU General Public License,
version 2 or later. See the COPYING file for details.
