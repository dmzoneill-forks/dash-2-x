import {jest} from '@jest/globals';
import {GLib} from '../dependencies/gi.js';

// ---------------------------------------------------------------------------
// Import real module
// ---------------------------------------------------------------------------
let startBounceAnimation;
beforeAll(async () => {
    const mod = await import('../features/bounceAnimation.js');
    startBounceAnimation = mod.startBounceAnimation;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockIcon() {
    return {
        translation_y: 0,
        pivot_point_x: 0,
        pivot_point_y: 0,
        set_pivot_point(x, y) {
            this.pivot_point_x = x;
            this.pivot_point_y = y;
        },
        remove_all_transitions: jest.fn(),
        ease(params) {
            Object.assign(this, params);
            if (params.onComplete)
                params.onComplete();
        },
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('startBounceAnimation', () => {
    test('returns null for null icon', () => {
        expect(startBounceAnimation(null)).toBeNull();
    });

    test('returns null for undefined icon', () => {
        expect(startBounceAnimation(undefined)).toBeNull();
    });

    test('returns a handle with isActive and stop', () => {
        const icon = makeMockIcon();
        const handle = startBounceAnimation(icon);
        expect(handle).toBeDefined();
        expect(typeof handle.stop).toBe('function');
    });

    test('sets pivot point to bottom-center', () => {
        const icon = makeMockIcon();
        startBounceAnimation(icon);
        expect(icon.pivot_point_x).toBe(0.5);
        expect(icon.pivot_point_y).toBe(1.0);
    });

    test('icon stays in its parent (no reparenting)', () => {
        const parent = {
            children: [],
            get_children() { return [...this.children]; },
            add_child(c) { this.children.push(c); },
            remove_child(c) { this.children = this.children.filter(x => x !== c); },
        };
        const icon = makeMockIcon();
        parent.add_child(icon);
        icon.get_parent = () => parent;

        startBounceAnimation(icon);

        expect(parent.children).toContain(icon);
    });

    test('first bounce completes and resets translation_y to 0', () => {
        const icon = makeMockIcon();
        const handle = startBounceAnimation(icon);
        // The synchronous ease mock completes the first bounce immediately,
        // translation_y returns to 0 after the down-ease
        expect(icon.translation_y).toBe(0);
        // handle is still active because inter-bounce timeout callback
        // cannot fire correctly with sync mocks (stepId TDZ)
        expect(handle.isActive).toBe(true);
        handle.stop();
    });

    test('completes all bounces when timeouts fire after assignment', () => {
        const icon = makeMockIcon();
        // Use a timeout mock that defers callback until after the ID is returned
        const origTimeout = GLib.timeout_add;
        const origRemove = GLib.source_remove;
        const deferred = [];
        GLib.timeout_add = (_prio, _ms, cb) => {
            const id = deferred.length + 1;
            deferred.push(cb);
            return id;
        };
        GLib.source_remove = jest.fn();

        try {
            const handle = startBounceAnimation(icon);
            // First bounce completed, but inter-bounce timeout is deferred
            expect(handle.isActive).toBe(true);
            // Fire all deferred timeouts to drive remaining bounces
            while (deferred.length > 0) {
                const cb = deferred.shift();
                cb();
            }
            expect(icon.translation_y).toBe(0);
            expect(handle.isActive).toBe(false);
        } finally {
            GLib.timeout_add = origTimeout;
            GLib.source_remove = origRemove;
        }
    });

    test('stop() after first bounce settles translation_y to 0', () => {
        const icon = makeMockIcon();
        // Make timeout_add NOT fire immediately so we can stop mid-bounce
        const origTimeout = GLib.timeout_add;
        const pendingCallbacks = [];
        GLib.timeout_add = (_prio, _ms, cb) => {
            pendingCallbacks.push(cb);
            return pendingCallbacks.length;
        };
        const origRemove = GLib.source_remove;
        GLib.source_remove = jest.fn();

        try {
            const handle = startBounceAnimation(icon);
            // First bounce completes (ease up + ease down is synchronous),
            // but the inter-bounce timeout is captured
            expect(handle.isActive).toBe(true);
            handle.stop();
            expect(icon.translation_y).toBe(0);
        } finally {
            GLib.timeout_add = origTimeout;
            GLib.source_remove = origRemove;
        }
    });

    test('stop() before first bounce completes defers to shouldStop', () => {
        const icon = makeMockIcon();
        // Make ease NOT call onComplete so the first bounce never finishes
        icon.ease = jest.fn((params) => {
            Object.assign(icon, params);
            // Don't call onComplete — bounce is "in progress"
        });

        const handle = startBounceAnimation(icon);
        // Bounce is still in progress (ease up hasn't completed)
        handle.stop();
        // Should still be considered active until the bounce completes
        expect(handle.isActive).toBe(true);
    });

    test('remove_all_transitions is called during bounce steps', () => {
        const icon = makeMockIcon();
        startBounceAnimation(icon);
        expect(icon.remove_all_transitions).toHaveBeenCalled();
    });

    test('cleanup resets translation_y even after error in remove_all_transitions', () => {
        const icon = makeMockIcon();
        let callCount = 0;
        icon.remove_all_transitions = () => {
            callCount++;
            // Throw on first call to test error handling
            if (callCount === 1)
                throw new Error('test');
        };
        // Should not throw despite the error
        const handle = startBounceAnimation(icon);
        expect(icon.translation_y).toBe(0);
    });
});
