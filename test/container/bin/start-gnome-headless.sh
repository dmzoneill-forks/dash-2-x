#!/bin/bash
# Start GNOME Shell in headless mode with a virtual monitor.
# Used in CI containers where X11/Xvfb is not available (Fedora 42+).
#
# Usage: start-gnome-headless.sh [WIDTHxHEIGHT]

RESOLUTION="${1:-1920x1080}"

export LIBGL_ALWAYS_SOFTWARE=1
export MUTTER_DEBUG_DUMMY_MODE_SPECS="${RESOLUTION}"

# Launch gnome-shell with its own D-Bus session
dbus-run-session -- bash -c '
    echo "HEADLESS_DBUS=${DBUS_SESSION_BUS_ADDRESS}" > /tmp/gnome-headless-env
    gnome-shell --headless --no-x11 --virtual-monitor "'"${RESOLUTION}"'" &
    SHELL_PID=$!
    echo "gnome-shell headless started (PID ${SHELL_PID}, '"${RESOLUTION}"')"
    echo "${SHELL_PID}" > /tmp/gnome-shell-headless.pid

    # Wait for shell to register on D-Bus
    for i in $(seq 1 30); do
        if dbus-send --session --print-reply \
            --dest=org.gnome.Shell \
            /org/gnome/Shell \
            org.freedesktop.DBus.Properties.Get \
            string:org.gnome.Shell string:ShellVersion 2>/dev/null | grep -q "string"; then
            echo "gnome-shell ready after ${i}s"
            break
        fi
        sleep 1
    done

    # Keep the session alive
    wait $SHELL_PID
' &

# Wait for the env file to appear
for i in $(seq 1 15); do
    if [ -f /tmp/gnome-headless-env ]; then
        cat /tmp/gnome-headless-env
        exit 0
    fi
    sleep 1
done

echo "Warning: gnome-shell headless may not have started"
