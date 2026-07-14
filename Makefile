# Basic Makefile

UUID = xdock@github.com
BASE_MODULES = extension.js \
               metadata.json \
               COPYING \
               README.md \
               $(NULL)

EXTRA_MODULES = \
                dash.js \
                docking.js \
                appIcons.js \
                appIconIndicators.js \
                imports.js \
                intellihide.js \
                prefs.js \
                springAnimation.js \
                theming.js \
                utils.js \
                Settings.ui \
                $(NULL)

EXTRA_MEDIA = logo.svg \
              glossy.svg \
              highlight_stacked_bg.svg \
              highlight_stacked_bg_h.svg \
              $(NULL)

MSGSRC = $(wildcard po/*.po)
ifeq ($(strip $(DESTDIR)),)
	INSTALLTYPE = local
	INSTALLBASE = $(HOME)/.local/share/gnome-shell/extensions
else
	INSTALLTYPE = system
	SHARE_PREFIX = $(DESTDIR)/usr/share
	INSTALLBASE = $(SHARE_PREFIX)/gnome-shell/extensions
endif
INSTALLNAME = xdock@github.com

# The command line passed variable VERSION is used to set the version string
# in the metadata and in the generated zip-file. If no VERSION is passed, the
# current commit SHA1 is used as version number in the metadata while the
# generated zip file has no string attached.
ifdef VERSION
	VSTRING = _v$(VERSION)
else
	VERSION = $(shell git rev-parse HEAD)
	VSTRING =
endif

all: extension

# Development: symlink + nested test session
dev: ./schemas/gschemas.compiled Settings.ui
	@ln -sfn $(CURDIR) $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
	@echo "Symlinked $(UUID) → $(CURDIR)"
	@rm -f /run/user/$$(id -u)/gnome-shell-disable-extensions
	dbus-run-session -- bash -c '\
		rm -f /run/user/$$(id -u)/gnome-shell-disable-extensions; \
		gsettings set org.gnome.shell enabled-extensions "[\"$(UUID)\"]"; \
		exec gnome-shell --wayland --no-x11 --devkit'

dev-no-ext: ./schemas/gschemas.compiled
	@echo "Launching devkit without extensions (baseline test)"
	dbus-run-session -- bash -c '\
		gsettings set org.gnome.shell enabled-extensions "[]"; \
		exec gnome-shell --wayland --no-x11 --devkit'

clean:
	rm -f ./schemas/gschemas.compiled
	rm -f stylesheet.css Settings.ui
	rm -rf _build

# Generate Settings.ui from ui/ parts
Settings.ui: ui/Settings.ui.in ui/adjustments.xml ui/dialogs.xml $(wildcard ui/tab-*.xml)
	bash ui/build-settings-ui.sh > Settings.ui

extension: ./schemas/gschemas.compiled ./stylesheet.css Settings.ui $(MSGSRC:.po=.mo)

./schemas/gschemas.compiled: ./schemas/org.gnome.shell.extensions.xdock.gschema.xml
	glib-compile-schemas ./schemas/

potfile: ./po/xdock.pot

mergepo: potfile
	for l in $(MSGSRC); do \
		msgmerge -U $$l ./po/xdock.pot; \
	done;

./po/xdock.pot: ./po/POTFILES.in
	xgettext --keyword=__ --keyword=N__ --add-comments='Translators:' -o po/xdock.pot --package-name "XDock" --from-code=utf-8 --files-from=$<

./po/%.mo: ./po/%.po
	msgfmt -c $< -o $@

./stylesheet.css: ./_stylesheet.scss
ifeq ($(SASS), sassc)
	sassc --omit-map-comment _stylesheet.scss stylesheet.css
else
	sass --no-source-map _stylesheet.scss stylesheet.css
endif

install: install-local

install-local: _build
	rm -rf $(INSTALLBASE)/$(INSTALLNAME)
	mkdir -p $(INSTALLBASE)/$(INSTALLNAME)
	cp -r ./_build/* $(INSTALLBASE)/$(INSTALLNAME)/
ifeq ($(INSTALLTYPE),system)
	# system-wide settings and locale files
	rm -r $(INSTALLBASE)/$(INSTALLNAME)/schemas $(INSTALLBASE)/$(INSTALLNAME)/locale
	mkdir -p $(SHARE_PREFIX)/glib-2.0/schemas $(SHARE_PREFIX)/locale
	cp -r ./schemas/*.gschema.xml $(SHARE_PREFIX)/glib-2.0/schemas
	cp -r ./_build/locale/* $(SHARE_PREFIX)/locale
else
	cp schemas/gschemas.compiled $(INSTALLBASE)/$(INSTALLNAME)/schemas/
endif
	-rm -fR _build
	echo done

zip-file: _build check
	cd _build ; \
	zip -qr "$(UUID)$(VSTRING).zip" .
	mv _build/$(UUID)$(VSTRING).zip ./
	-rm -fR _build

_build: all
	-rm -fR ./_build
	mkdir -p _build
	cp $(BASE_MODULES) $(EXTRA_MODULES) _build
	cp -a dependencies _build
	cp -a indicators _build
	cp -a platform _build
	cp -a widgets _build
	cp -a services _build
	cp -a features _build
	cp stylesheet.css _build
	mkdir -p _build/media
	cd media ; cp $(EXTRA_MEDIA) ../_build/media/
	mkdir -p _build/schemas
	cp schemas/*.gschema.xml _build/schemas/
	cp schemas/gschemas.compiled _build/schemas/ 2>/dev/null || glib-compile-schemas _build/schemas/
	mkdir -p _build/locale
	for l in $(MSGSRC:.po=.mo) ; do \
		lf=_build/locale/`basename $$l .mo`; \
		mkdir -p $$lf; \
		mkdir -p $$lf/LC_MESSAGES; \
		cp $$l $$lf/LC_MESSAGES/xdock.mo; \
	done;
	sed -i 's/"version": -1/"version": "$(VERSION)"/'  _build/metadata.json;

ifeq ($(strip $(ESLINT)),)
    ESLINT = eslint
endif

ifneq ($(strip $(ESLINT_TAP)),)
    ESLINT_ARGS = -f tap
endif

check:
	$(ESLINT) $(ESLINT_ARGS) .

.PHONY: all extension clean install install-local potfile mergepo check \
        test smoke-test smoke-test-pod \
        integration-test integration-test-interactive integration-test-screenshots \
        visual-regression update-baselines \
        zip-file zip-file-nocheck dev dev-no-ext

# ── Testing ──────────────────────────────────────────────────────────

# Unit tests (Node.js + Jest)
test:
	NODE_OPTIONS='--experimental-vm-modules' npx jest --verbose

# Smoke test (local): load extension in devkit session
# Requires: sudo dnf install mutter-devkit
smoke-test: zip-file-nocheck
	@command -v gnome-shell-test-tool >/dev/null 2>&1 || \
		{ echo "gnome-shell-test-tool not found — install mutter-devkit"; exit 1; }
	dbus-run-session -- gnome-shell-test-tool --headless \
		--extension $(UUID).zip test/smoke/load-extension.js

# Integration tests (headless): run full test suite, no hold
integration-test: zip-file-nocheck
	XDOCK_TEST_HOLD=0 dbus-run-session -- gnome-shell-test-tool --headless \
		--extension $(UUID).zip "$$(pwd)/test/integration/runner.js"

# Integration tests (interactive): run in devkit window, hold 30s
integration-test-interactive: zip-file-nocheck
	dbus-run-session -- gnome-shell-test-tool --devkit \
		--extension $(UUID).zip "$$(pwd)/test/integration/runner.js"

# Integration tests with screenshot of every test (embossed test names)
integration-test-screenshots: zip-file-nocheck
	rm -f /tmp/xdock-test-*.png
	XDOCK_TEST_SCREENSHOTS=1 XDOCK_TEST_HOLD=0 dbus-run-session -- \
		gnome-shell-test-tool --headless \
		--extension $(UUID).zip "$$(pwd)/test/integration/runner.js"
	@echo "Screenshots saved to /tmp/xdock-test-*.png"
	@ls -1 /tmp/xdock-test-*.png 2>/dev/null | wc -l | xargs -I{} echo "{} screenshots captured"

# Visual regression: compare screenshots against baselines
visual-regression: integration-test-screenshots
	bash test/visual/scripts/compare.sh test/visual/baselines /tmp /tmp/xdock-test-diffs

# Update visual baselines from latest screenshots
update-baselines: integration-test-screenshots
	bash test/visual/scripts/update-baselines.sh /tmp

# Build zip without running lint (for testing)
zip-file-nocheck: _build
	mkdir -p _build/test/integration _build/test/smoke
	cp test/integration/*.js _build/test/integration/ 2>/dev/null || true
	cp test/smoke/*.js _build/test/smoke/ 2>/dev/null || true
	cd _build && zip -qr "../$(UUID).zip" .
	-rm -fR _build
	rm -f /run/user/$$(id -u)/gnome-shell-disable-extensions

# Smoke test (container): load extension in gnome-shell-pod
# Requires: podman
smoke-test-pod: ./schemas/gschemas.compiled
	@command -v podman >/dev/null 2>&1 || \
		{ echo "podman not found"; exit 1; }
	bash test/smoke/run-in-pod.sh rawhide
