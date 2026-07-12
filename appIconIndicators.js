// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: Contributors to XDock
//
// Re-export barrel — all indicator classes are split into indicators/
// but this file preserves backward compatibility for existing imports.

import {Docking} from './imports.js';

import {
    RunningIndicatorDefault,
    RunningIndicatorDots,
    RunningIndicatorCiliora,
    RunningIndicatorSegmented,
    RunningIndicatorSolid,
    RunningIndicatorSquares,
    RunningIndicatorDashes,
    RunningIndicatorMetro,
    RunningIndicatorBinary,
    RunningIndicatorDot,
    RunningIndicatorNone,
} from './indicators/running.js';

import {UnityIndicator, getBadgeOverride} from './indicators/unity.js';

import {RunningIndicatorBase} from './indicators/base.js';

export {
    IndicatorBase,
    RunningIndicatorBase,
    IndicatorDrawingArea,
    MAX_WINDOWS_CLASSES
} from './indicators/base.js';
export {
    RunningIndicatorDefault,
    RunningIndicatorDots,
    RunningIndicatorCiliora,
    RunningIndicatorSegmented,
    RunningIndicatorSolid,
    RunningIndicatorSquares,
    RunningIndicatorDashes,
    RunningIndicatorMetro,
    RunningIndicatorBinary,
    RunningIndicatorDot,
    RunningIndicatorNone
} from './indicators/running.js';
export {UnityIndicator, getBadgeOverride, setBadgeOverride} from './indicators/unity.js';
export {ProgressArcDrawingArea} from './indicators/progress.js';
export {DominantColorExtractor} from './indicators/colorExtractor.js';

const RunningIndicatorStyle = Object.freeze({
    DEFAULT: 0,
    DOTS: 1,
    SQUARES: 2,
    DASHES: 3,
    SEGMENTED: 4,
    SOLID: 5,
    CILIORA: 6,
    METRO: 7,
    BINARY: 8,
    DOT: 9,
    NONE: 10,
});

/*
 * This is the main indicator class to be used. The desired behavior is
 * obtained by composing the desired classes below based on the settings.
 *
 */
export class AppIconIndicator {
    constructor(source) {
        this._indicators = [];

        // Choose the style for the running indicators
        let runningIndicator = null;
        let runningIndicatorStyle;

        const {settings} = Docking.DockManager;
        if (settings.applyCustomTheme)
            runningIndicatorStyle = RunningIndicatorStyle.DOTS;
        else
            ({runningIndicatorStyle} = settings);

        // Check per-app badge override — if enabled is explicitly false
        // or source is 'none', skip creating the unity indicator entirely
        const appId = source.app?.id;
        const badgeOverride = appId ? getBadgeOverride(appId) : null;
        const badgeDisabled = badgeOverride &&
            (badgeOverride.enabled === false || badgeOverride.source === 'none');

        if (settings.showIconsEmblems &&
            !Docking.DockManager.getDefault()?.notificationsMonitor?.dndMode &&
            !badgeDisabled) {
            const unityIndicator = new UnityIndicator(source);
            this._indicators.push(unityIndicator);
        }

        switch (runningIndicatorStyle) {
        case RunningIndicatorStyle.DEFAULT:
            runningIndicator = new RunningIndicatorDefault(source);
            break;

        case RunningIndicatorStyle.DOTS:
            runningIndicator = new RunningIndicatorDots(source);
            break;

        case RunningIndicatorStyle.SQUARES:
            runningIndicator = new RunningIndicatorSquares(source);
            break;

        case RunningIndicatorStyle.DASHES:
            runningIndicator = new RunningIndicatorDashes(source);
            break;

        case RunningIndicatorStyle.SEGMENTED:
            runningIndicator = new RunningIndicatorSegmented(source);
            break;

        case RunningIndicatorStyle.SOLID:
            runningIndicator = new RunningIndicatorSolid(source);
            break;

        case RunningIndicatorStyle.CILIORA:
            runningIndicator = new RunningIndicatorCiliora(source);
            break;

        case RunningIndicatorStyle.METRO:
            runningIndicator = new RunningIndicatorMetro(source);
            break;

        case RunningIndicatorStyle.BINARY:
            runningIndicator = new RunningIndicatorBinary(source);
            break;

        case RunningIndicatorStyle.DOT:
            runningIndicator = new RunningIndicatorDot(source);
            break;

        case RunningIndicatorStyle.NONE:
            runningIndicator = new RunningIndicatorNone(source);
            break;

        default:
            runningIndicator = new RunningIndicatorBase(source);
        }

        this._indicators.push(runningIndicator);
    }

    update() {
        for (let i = 0; i < this._indicators.length; i++) {
            const indicator = this._indicators[i];
            indicator.update();
        }
    }

    destroy() {
        for (let i = 0; i < this._indicators.length; i++) {
            const indicator = this._indicators[i];
            indicator.destroy();
        }
    }
}
