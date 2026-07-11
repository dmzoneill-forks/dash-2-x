// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: Contributors to XDock
// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

import {
    Clutter,
    GLib,
} from './dependencies/gi.js';

/**
 * A reusable spring-physics animation driver.
 *
 * Uses a Clutter.Timeline with per-frame updates to simulate a damped spring.
 * The spring equation per frame:
 *   acceleration = (-stiffness * displacement - damping * velocity) / mass
 *
 * Euler integration advances the state each frame. The animation stops
 * automatically when both velocity and displacement fall below threshold.
 */
export class SpringAnimation {
    /**
     * @param {object} params
     * @param {number} [params.stiffness=200] - Spring stiffness constant
     * @param {number} [params.damping=20] - Damping coefficient
     * @param {number} [params.mass=1] - Mass of the simulated object
     * @param {number} [params.target=0] - Target (rest) value
     * @param {number} [params.initial=0] - Initial value
     * @param {Clutter.Actor} [params.actor] - Actor for the timeline's frame clock
     * @param {Function} [params.onUpdate] - Called each frame with the current value
     * @param {Function} [params.onComplete] - Called when the spring settles
     */
    constructor({
        stiffness = 200,
        damping = 20,
        mass = 1,
        target = 0,
        initial = 0,
        actor,
        onUpdate,
        onComplete,
    }) {
        this._stiffness = stiffness;
        this._damping = damping;
        this._mass = mass;
        this._target = target;
        this._position = initial;
        this._velocity = 0;
        this._actor = actor ?? null;
        this._onUpdate = onUpdate;
        this._onComplete = onComplete;
        this._timeline = null;
        this._lastFrameTime = -1;
        this._running = false;

        // Thresholds for considering the spring settled
        this._positionThreshold = 0.5 / 1000; // 0.5px in 0-1 range => 0.0005
        this._velocityThreshold = 0.5 / 1000; // 0.5px/s in 0-1 range => 0.0005
    }

    /**
     * Start the spring animation.
     */
    start() {
        if (this._running)
            return;

        if (this._actor && !this._actor.get_stage()) {
            this._onComplete?.();
            return;
        }

        this._running = true;
        this._lastFrameTime = -1;

        const timelineParams = {duration: 5000, repeat_count: 0};
        if (this._actor)
            timelineParams.actor = this._actor;
        this._timeline = new Clutter.Timeline(timelineParams);

        this._newFrameId = this._timeline.connect('new-frame', (_timeline, _elapsed) => {
            this._step();
        });

        this._completedId = this._timeline.connect('completed', () => {
            // Timeline reached max duration without settling — force complete
            this._settle();
        });

        this._timeline.start();
    }

    /**
     * Update the target value while the animation is running.
     *
     * @param {number} newTarget - The new target value
     */
    setTarget(newTarget) {
        this._target = newTarget;
    }

    /**
     * Per-frame physics step using Euler integration.
     */
    _step() {
        if (!this._running)
            return;

        const now = GLib.get_monotonic_time();

        // On first frame, just record the time and emit the initial value
        if (this._lastFrameTime < 0) {
            this._lastFrameTime = now;
            if (this._onUpdate)
                this._onUpdate(this._position);
            return;
        }

        // Compute dt in seconds from microsecond timestamps
        let dt = (now - this._lastFrameTime) / 1000000;
        this._lastFrameTime = now;

        // Clamp dt to avoid instability from large time gaps
        // (e.g., when the compositor was blocked)
        if (dt > 0.05)
            dt = 0.05;
        if (dt <= 0)
            return;

        const displacement = this._position - this._target;
        const acceleration = (-this._stiffness * displacement - this._damping * this._velocity) / this._mass;

        this._velocity += acceleration * dt;
        this._position += this._velocity * dt;

        // Check if the spring has settled
        if (Math.abs(displacement) < this._positionThreshold &&
            Math.abs(this._velocity) < this._velocityThreshold) {
            this._settle();
            return;
        }

        if (this._onUpdate)
            this._onUpdate(this._position);
    }

    /**
     * Snap to target and complete.
     */
    _settle() {
        this._position = this._target;
        this._velocity = 0;
        this._running = false;

        if (this._onUpdate)
            this._onUpdate(this._position);

        this._cleanupTimeline();

        if (this._onComplete)
            this._onComplete();
    }

    /**
     * Stop the animation immediately without calling onComplete.
     */
    stop() {
        this._running = false;
        this._cleanupTimeline();
    }

    /**
     * Clean up the Clutter.Timeline.
     */
    _cleanupTimeline() {
        if (this._timeline) {
            if (this._newFrameId) {
                this._timeline.disconnect(this._newFrameId);
                this._newFrameId = 0;
            }
            if (this._completedId) {
                this._timeline.disconnect(this._completedId);
                this._completedId = 0;
            }
            this._timeline.stop();
            this._timeline = null;
        }
    }

    /**
     * Clean up all resources. Call when the animation is no longer needed.
     */
    destroy() {
        this.stop();
        this._onUpdate = null;
        this._onComplete = null;
    }

    /**
     * @returns {boolean} Whether the animation is currently running
     */
    get running() {
        return this._running;
    }

    /**
     * @returns {number} The current position value
     */
    get position() {
        return this._position;
    }
}
