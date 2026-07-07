#!/bin/bash
# Take a screenshot via GNOME Shell D-Bus API.
# Works on both X11 and headless Wayland sessions.
#
# Usage: take-screenshot.sh [OUTPUT_PATH]

OUTPUT="${1:-/tmp/screenshot.png}"

# Source the headless session D-Bus address if available
if [ -f /tmp/gnome-headless-env ]; then
    . /tmp/gnome-headless-env
    export DBUS_SESSION_BUS_ADDRESS="${HEADLESS_DBUS}"
fi

# If DBUS_SESSION_BUS_ADDRESS not set, try the default user bus
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}"

# Try GNOME Shell Screenshot D-Bus API
if dbus-send --session --type=method_call --print-reply \
    --dest=org.gnome.Shell.Screenshot \
    /org/gnome/Shell/Screenshot \
    org.gnome.Shell.Screenshot.Screenshot \
    boolean:false boolean:true "string:${OUTPUT}" 2>/dev/null; then
    if [ -f "${OUTPUT}" ] && [ "$(stat -c%s "${OUTPUT}")" -gt 1000 ]; then
        echo "Screenshot saved to ${OUTPUT} ($(stat -c%s "${OUTPUT}") bytes)"
        exit 0
    fi
fi

echo "Screenshot capture failed"
exit 1
