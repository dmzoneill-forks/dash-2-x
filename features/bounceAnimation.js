// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: Contributors to XDock
// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

import {
    Clutter,
    GLib,
} from '../dependencies/gi.js';

/**
 * Performs a bouncing animation on an icon in-place
 * @param {Clutter.Actor} icon - The icon to animate
 */
export function startBounceAnimation(icon) {
    if (!icon)
        return null;

    const BOUNCE_HEIGHT = 18;
    const BOUNCE_DURATION = 260;
    let running = true;
    let bounceCount = 0;
    const MAX_BOUNCES = 5;
    let hasCompletedOneBounce = false;
    let shouldStop = false;
    const pendingTimers = new Set();

    icon.set_pivot_point(0.5, 1.0);

    const handle = {
        isActive: true,
        stop() {
            if (!hasCompletedOneBounce) {
                shouldStop = true;
                return;
            }
            running = false;
            handle.isActive = false;
            pendingTimers.forEach(id => GLib.source_remove(id));
            pendingTimers.clear();
            try {
                icon.remove_all_transitions();
            } catch { /* ignore */ }
            try {
                icon.ease({
                    translation_y: 0,
                    duration: 120,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => {
                        cleanup();
                    },
                });
            } catch {
                cleanup();
            }
        },
    };

    function step() {
        if (!running)
            return;
        bounceCount++;
        try {
            icon.remove_all_transitions();
        } catch { /* ignore */ }
        icon.ease({
            translation_y: -BOUNCE_HEIGHT,
            duration: Math.floor(BOUNCE_DURATION / 2),
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (!running)
                    return;
                icon.ease({
                    translation_y: 0,
                    duration: Math.floor(BOUNCE_DURATION / 2),
                    mode: Clutter.AnimationMode.EASE_IN_QUAD,
                    onComplete: () => {
                        if (!running)
                            return;
                        hasCompletedOneBounce = true;

                        if (shouldStop) {
                            running = false;
                            handle.isActive = false;
                            cleanup();
                            return;
                        }

                        if (bounceCount >= MAX_BOUNCES) {
                            running = false;
                            handle.isActive = false;
                            cleanup();
                            return;
                        }
                        const stepId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {
                            pendingTimers.delete(stepId);
                            step();
                            return GLib.SOURCE_REMOVE;
                        });
                        pendingTimers.add(stepId);
                    },
                });
            },
        });
    }

    function cleanup() {
        running = false;
        pendingTimers.forEach(id => GLib.source_remove(id));
        pendingTimers.clear();
        try {
            icon.remove_all_transitions();
            icon.translation_y = 0;
            icon.set_pivot_point(0, 0);
        } catch { /* ignore */ }
    }

    step();

    return handle;
}
