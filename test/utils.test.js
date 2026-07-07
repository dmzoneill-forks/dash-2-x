import {jest} from '@jest/globals';
import {
    ColorUtils, clamp, clampDouble, getPosition, getSecondaryPosition,
    GlobalSignalsHandler, SignalsHandlerFlags, splitHandler,
    shellAppCompare, shellWindowsCompare,
    InjectionsHandler, PropertyInjectionsHandler, drawRoundedLine,
    cairoSetSourceColor, addActor,
    getMonitorManager, laterAdd, laterRemove, supportsExtendedBarriers,
    getWindowsByObjectPath,
} from '../utils.js';
import {Clutter, GObject, Meta, Shell, St} from '../dependencies/gi.js';
import {Docking} from '../imports.js';

// ---------------------------------------------------------------------------
// clamp / clampDouble
// ---------------------------------------------------------------------------
describe('clamp', () => {
    test('value within range is unchanged', () => {
        expect(clamp(5, 0, 10)).toBe(5);
    });
    test('value below min is clamped', () => {
        expect(clamp(-3, 0, 10)).toBe(0);
    });
    test('value above max is clamped', () => {
        expect(clamp(15, 0, 10)).toBe(10);
    });
    test('boundary values', () => {
        expect(clamp(0, 0, 10)).toBe(0);
        expect(clamp(10, 0, 10)).toBe(10);
    });
});

describe('clampDouble', () => {
    test('clamps to 0-1 range', () => {
        expect(clampDouble(-0.5)).toBe(0);
        expect(clampDouble(1.5)).toBe(1);
        expect(clampDouble(0.5)).toBe(0.5);
    });
});

// ---------------------------------------------------------------------------
// ColorUtils._decimalToHex
// ---------------------------------------------------------------------------
describe('ColorUtils._decimalToHex', () => {
    test('converts with padding', () => {
        expect(ColorUtils._decimalToHex(255, 2)).toBe('ff');
        expect(ColorUtils._decimalToHex(0, 2)).toBe('00');
        expect(ColorUtils._decimalToHex(15, 2)).toBe('0f');
    });
    test('single digit with larger padding', () => {
        expect(ColorUtils._decimalToHex(1, 4)).toBe('0001');
    });
    test('value already exceeds padding', () => {
        expect(ColorUtils._decimalToHex(256, 2)).toBe('100');
    });
});

// ---------------------------------------------------------------------------
// ColorUtils.ColorLuminance
// ---------------------------------------------------------------------------
describe('ColorUtils.ColorLuminance', () => {
    test('zero dlum returns same color', () => {
        expect(ColorUtils.ColorLuminance(128, 128, 128, 0)).toBe('#808080');
    });
    test('positive dlum brightens', () => {
        const result = ColorUtils.ColorLuminance(100, 100, 100, 0.5);
        expect(result).toBe('#969696');
    });
    test('negative dlum darkens', () => {
        const result = ColorUtils.ColorLuminance(200, 200, 200, -0.5);
        expect(result).toBe('#646464');
    });
    test('clamps to 255 when brightening past maximum', () => {
        const result = ColorUtils.ColorLuminance(200, 200, 200, 1.0);
        expect(result).toBe('#ffffff');
    });
    test('clamps to 0 when darkening past minimum', () => {
        const result = ColorUtils.ColorLuminance(100, 100, 100, -2.0);
        expect(result).toBe('#000000');
    });
    test('dlum = -1 produces black', () => {
        expect(ColorUtils.ColorLuminance(128, 64, 255, -1)).toBe('#000000');
    });
    test('works with mixed channel values', () => {
        const result = ColorUtils.ColorLuminance(255, 0, 128, 0);
        expect(result).toBe('#ff0080');
    });
});

// ---------------------------------------------------------------------------
// ColorUtils.HSVtoRGB
// ---------------------------------------------------------------------------
describe('ColorUtils.HSVtoRGB', () => {
    test('red (h=0, s=1, v=1)', () => {
        expect(ColorUtils.HSVtoRGB(0, 1, 1)).toEqual({r: 255, g: 0, b: 0});
    });
    test('black (v=0)', () => {
        expect(ColorUtils.HSVtoRGB(0, 0, 0)).toEqual({r: 0, g: 0, b: 0});
    });
    test('white (s=0, v=1)', () => {
        expect(ColorUtils.HSVtoRGB(0, 0, 1)).toEqual({r: 255, g: 255, b: 255});
    });
    test('green (h=1/3, s=1, v=1)', () => {
        expect(ColorUtils.HSVtoRGB(1 / 3, 1, 1)).toEqual({r: 0, g: 255, b: 0});
    });
    test('blue (h=2/3, s=1, v=1)', () => {
        expect(ColorUtils.HSVtoRGB(2 / 3, 1, 1)).toEqual({r: 0, g: 0, b: 255});
    });
    test('yellow (h=1/6, s=1, v=1)', () => {
        expect(ColorUtils.HSVtoRGB(1 / 6, 1, 1)).toEqual({r: 255, g: 255, b: 0});
    });
    test('cyan (h=0.5, s=1, v=1)', () => {
        expect(ColorUtils.HSVtoRGB(0.5, 1, 1)).toEqual({r: 0, g: 255, b: 255});
    });
    test('magenta (h=5/6, s=1, v=1)', () => {
        expect(ColorUtils.HSVtoRGB(5 / 6, 1, 1)).toEqual({r: 255, g: 0, b: 255});
    });
    test('half saturation red', () => {
        const result = ColorUtils.HSVtoRGB(0, 0.5, 1);
        expect(result).toEqual({r: 255, g: 128, b: 128});
    });
    test('half value red', () => {
        const result = ColorUtils.HSVtoRGB(0, 1, 0.5);
        expect(result).toEqual({r: 128, g: 0, b: 0});
    });
    test('accepts object form {h, s, v}', () => {
        const result = ColorUtils.HSVtoRGB({h: 0, s: 1, v: 1});
        expect(result).toEqual({r: 255, g: 0, b: 0});
    });
    test('object form green', () => {
        const result = ColorUtils.HSVtoRGB({h: 1 / 3, s: 1, v: 1});
        expect(result).toEqual({r: 0, g: 255, b: 0});
    });
    test('h1 in range (4,5] -- purple region', () => {
        // h = 0.75 -> h1 = 4.5, c=1, x=0.5, m=0 => r=x=128, g=0, b=c=255
        const result = ColorUtils.HSVtoRGB(0.75, 1, 1);
        expect(result.r).toBe(128);
        expect(result.g).toBe(0);
        expect(result.b).toBe(255);
    });
    test('h1 in range (5,6] -- rose region', () => {
        // h = 11/12 -> h1 = 5.5, c=1, x=0.5, m=0 => r=c=255, g=0, b=x=128
        const result = ColorUtils.HSVtoRGB(11 / 12, 1, 1);
        expect(result.r).toBe(255);
        expect(result.g).toBe(0);
        expect(result.b).toBe(128);
    });
});

// ---------------------------------------------------------------------------
// ColorUtils.RGBtoHSV
// ---------------------------------------------------------------------------
describe('ColorUtils.RGBtoHSV', () => {
    test('pure red', () => {
        const result = ColorUtils.RGBtoHSV(255, 0, 0);
        expect(result.h).toBeCloseTo(0);
        expect(result.s).toBeCloseTo(1);
        expect(result.v).toBeCloseTo(1);
    });
    test('pure green', () => {
        const result = ColorUtils.RGBtoHSV(0, 255, 0);
        expect(result.h).toBeCloseTo(1 / 3);
        expect(result.s).toBeCloseTo(1);
        expect(result.v).toBeCloseTo(1);
    });
    test('pure blue', () => {
        const result = ColorUtils.RGBtoHSV(0, 0, 255);
        expect(result.h).toBeCloseTo(2 / 3);
        expect(result.s).toBeCloseTo(1);
        expect(result.v).toBeCloseTo(1);
    });
    test('black', () => {
        const result = ColorUtils.RGBtoHSV(0, 0, 0);
        expect(result.s).toBe(0);
        expect(result.v).toBe(0);
    });
    test('white', () => {
        const result = ColorUtils.RGBtoHSV(255, 255, 255);
        expect(result.h).toBe(0);
        expect(result.s).toBe(0);
        expect(result.v).toBeCloseTo(1);
    });
    test('grey (r=g=b) has s=0', () => {
        const result = ColorUtils.RGBtoHSV(128, 128, 128);
        expect(result.h).toBe(0);
        expect(result.s).toBe(0);
        expect(result.v).toBeCloseTo(128 / 255);
    });
    test('accepts object form {r, g, b}', () => {
        const result = ColorUtils.RGBtoHSV({r: 255, g: 0, b: 0});
        expect(result.h).toBeCloseTo(0);
        expect(result.s).toBeCloseTo(1);
    });
    test('round-trip fidelity', () => {
        const hsv = ColorUtils.RGBtoHSV(120, 80, 200);
        const rgb = ColorUtils.HSVtoRGB(hsv);
        expect(rgb.r).toBeCloseTo(120, 0);
        expect(rgb.g).toBeCloseTo(80, 0);
        expect(rgb.b).toBeCloseTo(200, 0);
    });
    test('round-trip fidelity for green', () => {
        const hsv = ColorUtils.RGBtoHSV(0, 255, 0);
        const rgb = ColorUtils.HSVtoRGB(hsv);
        expect(rgb.r).toBe(0);
        expect(rgb.g).toBe(255);
        expect(rgb.b).toBe(0);
    });
    test('round-trip fidelity for blue', () => {
        const hsv = ColorUtils.RGBtoHSV(0, 0, 255);
        const rgb = ColorUtils.HSVtoRGB(hsv);
        expect(rgb.r).toBe(0);
        expect(rgb.g).toBe(0);
        expect(rgb.b).toBe(255);
    });
});

// ---------------------------------------------------------------------------
// getPosition
// ---------------------------------------------------------------------------
describe('getPosition', () => {
    test('returns dock position in LTR mode', () => {
        Docking.DockManager.settings.dockPosition = St.Side.BOTTOM;
        Clutter.get_default_text_direction = () => Clutter.TextDirection.LTR;
        expect(getPosition()).toBe(St.Side.BOTTOM);
    });

    test('swaps LEFT to RIGHT in RTL mode', () => {
        Docking.DockManager.settings.dockPosition = St.Side.LEFT;
        Clutter.get_default_text_direction = () => Clutter.TextDirection.RTL;
        expect(getPosition()).toBe(St.Side.RIGHT);
    });

    test('swaps RIGHT to LEFT in RTL mode', () => {
        Docking.DockManager.settings.dockPosition = St.Side.RIGHT;
        Clutter.get_default_text_direction = () => Clutter.TextDirection.RTL;
        expect(getPosition()).toBe(St.Side.LEFT);
    });

    test('TOP is not swapped in RTL mode', () => {
        Docking.DockManager.settings.dockPosition = St.Side.TOP;
        Clutter.get_default_text_direction = () => Clutter.TextDirection.RTL;
        expect(getPosition()).toBe(St.Side.TOP);
    });

    test('BOTTOM is not swapped in RTL mode', () => {
        Docking.DockManager.settings.dockPosition = St.Side.BOTTOM;
        Clutter.get_default_text_direction = () => Clutter.TextDirection.RTL;
        expect(getPosition()).toBe(St.Side.BOTTOM);
    });

    test('returns TOP in LTR mode', () => {
        Docking.DockManager.settings.dockPosition = St.Side.TOP;
        Clutter.get_default_text_direction = () => Clutter.TextDirection.LTR;
        expect(getPosition()).toBe(St.Side.TOP);
    });

    test('returns RIGHT in LTR mode', () => {
        Docking.DockManager.settings.dockPosition = St.Side.RIGHT;
        Clutter.get_default_text_direction = () => Clutter.TextDirection.LTR;
        expect(getPosition()).toBe(St.Side.RIGHT);
    });
});

// ---------------------------------------------------------------------------
// getSecondaryPosition
// ---------------------------------------------------------------------------
describe('getSecondaryPosition', () => {
    test('returns secondary dock position in LTR mode', () => {
        Docking.DockManager.settings.secondaryDockPosition = St.Side.BOTTOM;
        Clutter.get_default_text_direction = () => Clutter.TextDirection.LTR;
        expect(getSecondaryPosition()).toBe(St.Side.BOTTOM);
    });

    test('swaps LEFT to RIGHT in RTL mode', () => {
        Docking.DockManager.settings.secondaryDockPosition = St.Side.LEFT;
        Clutter.get_default_text_direction = () => Clutter.TextDirection.RTL;
        expect(getSecondaryPosition()).toBe(St.Side.RIGHT);
    });

    test('swaps RIGHT to LEFT in RTL mode', () => {
        Docking.DockManager.settings.secondaryDockPosition = St.Side.RIGHT;
        Clutter.get_default_text_direction = () => Clutter.TextDirection.RTL;
        expect(getSecondaryPosition()).toBe(St.Side.LEFT);
    });

    test('TOP is not swapped in RTL mode', () => {
        Docking.DockManager.settings.secondaryDockPosition = St.Side.TOP;
        Clutter.get_default_text_direction = () => Clutter.TextDirection.RTL;
        expect(getSecondaryPosition()).toBe(St.Side.TOP);
    });

    test('BOTTOM is not swapped in RTL mode', () => {
        Docking.DockManager.settings.secondaryDockPosition = St.Side.BOTTOM;
        Clutter.get_default_text_direction = () => Clutter.TextDirection.RTL;
        expect(getSecondaryPosition()).toBe(St.Side.BOTTOM);
    });
});

// ---------------------------------------------------------------------------
// splitHandler
// ---------------------------------------------------------------------------
describe('splitHandler', () => {
    test('single-value handler returns array of one handler', () => {
        const handler = jest.fn((_obj, _a) => {});
        const [h0] = splitHandler(handler);
        const obj = {};
        h0(obj, 42);
        expect(handler).toHaveBeenCalledWith(obj, 42);
    });

    test('two-value handler fires only after both values received', () => {
        const handler = jest.fn((_obj, _a, _b) => {});
        const [h0, h1] = splitHandler(handler);
        const obj = {};
        h0(obj, 'first');
        expect(handler).not.toHaveBeenCalled();
        h1(obj, 'second');
        expect(handler).toHaveBeenCalledWith(obj, 'first', 'second');
    });

    test('three-value handler needs all three before firing', () => {
        const handler = jest.fn((_obj, _a, _b, _c) => {});
        const [h0, h1, h2] = splitHandler(handler);
        const obj = {};
        h0(obj, 'A');
        h1(obj, 'B');
        expect(handler).not.toHaveBeenCalled();
        h2(obj, 'C');
        expect(handler).toHaveBeenCalledWith(obj, 'A', 'B', 'C');
    });

    test('subsequent calls always fire (values already populated)', () => {
        const handler = jest.fn((_obj, _a, _b) => {});
        const [h0, h1] = splitHandler(handler);
        const obj = {};
        h0(obj, 10);
        h1(obj, 20);
        expect(handler).toHaveBeenCalledTimes(1);
        // Now both bits are cleared; future calls fire immediately
        h0(obj, 30);
        expect(handler).toHaveBeenCalledTimes(2);
        expect(handler).toHaveBeenLastCalledWith(obj, 30, 20);
    });

    test('updates values on repeated calls', () => {
        const handler = jest.fn((_obj, _a, _b) => {});
        const [h0, h1] = splitHandler(handler);
        const obj = {};
        h0(obj, 1);
        h1(obj, 2);
        handler.mockClear();
        h1(obj, 99);
        expect(handler).toHaveBeenCalledWith(obj, 1, 99);
    });

    test('returns correct number of handlers', () => {
        const handler = (_obj, _a, _b, _c, _d) => {};
        const handlers = splitHandler(handler);
        expect(handlers).toHaveLength(4);
    });

    test('throws for handler with > 30 parameters', () => {
        const params = Array.from({length: 32}, (_, i) => `a${i}`).join(',');
        // eslint-disable-next-line no-new-func
        const bigHandler = new Function(params, '');
        expect(() => splitHandler(bigHandler)).toThrow('too many parameters');
    });

    test('handler with zero value params (only obj param)', () => {
        const handler = jest.fn((_obj) => {});
        const handlers = splitHandler(handler);
        expect(handlers).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// shellAppCompare
// ---------------------------------------------------------------------------
describe('shellAppCompare', () => {
    const RUNNING = Shell.AppState.RUNNING;
    const STOPPED = Shell.AppState.STOPPED;

    const mockWindow = (showing, userTime) => ({
        showing_on_its_workspace: () => showing,
        get_user_time: () => userTime,
    });

    const mockApp = (state, windows = []) => ({
        state,
        get_windows: () => windows,
    });

    test('running app sorts before stopped app', () => {
        const a = mockApp(RUNNING, [mockWindow(true, 100)]);
        const b = mockApp(STOPPED);
        expect(shellAppCompare(a, b)).toBe(-1);
    });

    test('stopped app sorts after running app', () => {
        const a = mockApp(STOPPED);
        const b = mockApp(RUNNING, [mockWindow(true, 100)]);
        expect(shellAppCompare(a, b)).toBe(1);
    });

    test('both stopped returns 0', () => {
        const a = mockApp(STOPPED);
        const b = mockApp(STOPPED);
        expect(shellAppCompare(a, b)).toBe(0);
    });

    test('both running -- non-minimized sorts before minimized', () => {
        const a = mockApp(RUNNING, [mockWindow(true, 100)]);
        const b = mockApp(RUNNING, [mockWindow(false, 200)]);
        expect(shellAppCompare(a, b)).toBe(-1);
    });

    test('both running -- minimized sorts after non-minimized', () => {
        const a = mockApp(RUNNING, [mockWindow(false, 200)]);
        const b = mockApp(RUNNING, [mockWindow(true, 100)]);
        expect(shellAppCompare(a, b)).toBe(1);
    });

    test('both running, both visible -- more recently used first', () => {
        const a = mockApp(RUNNING, [mockWindow(true, 100)]);
        const b = mockApp(RUNNING, [mockWindow(true, 200)]);
        // lastUserTime(b) - lastUserTime(a) = 200 - 100 = 100 > 0
        expect(shellAppCompare(a, b)).toBeGreaterThan(0);
    });

    test('both running, both visible -- earlier used time sorts after', () => {
        const a = mockApp(RUNNING, [mockWindow(true, 300)]);
        const b = mockApp(RUNNING, [mockWindow(true, 100)]);
        // lastUserTime(b) - lastUserTime(a) = 100 - 300 = -200 < 0
        expect(shellAppCompare(a, b)).toBeLessThan(0);
    });

    test('both running, same user time returns 0', () => {
        const a = mockApp(RUNNING, [mockWindow(true, 100)]);
        const b = mockApp(RUNNING, [mockWindow(true, 100)]);
        expect(shellAppCompare(a, b)).toBe(0);
    });

    test('both running -- app with windows sorts before app without', () => {
        const a = mockApp(RUNNING, [mockWindow(true, 100)]);
        const b = mockApp(RUNNING, []);
        expect(shellAppCompare(a, b)).toBe(-1);
    });

    test('both running -- app without windows sorts after app with', () => {
        const a = mockApp(RUNNING, []);
        const b = mockApp(RUNNING, [mockWindow(true, 100)]);
        expect(shellAppCompare(a, b)).toBe(1);
    });

    test('both running, both no windows returns NaN (Math.max of empty)', () => {
        const a = mockApp(RUNNING, []);
        const b = mockApp(RUNNING, []);
        // Math.max(...[]) = -Infinity; -Infinity - -Infinity = NaN
        expect(shellAppCompare(a, b)).toBeNaN();
    });

    test('both running, multiple windows -- uses max user time', () => {
        const a = mockApp(RUNNING, [
            mockWindow(true, 50),
            mockWindow(true, 300),
        ]);
        const b = mockApp(RUNNING, [
            mockWindow(true, 200),
            mockWindow(true, 250),
        ]);
        // max(a) = 300, max(b) = 250 => 250 - 300 = -50 < 0 => a first
        expect(shellAppCompare(a, b)).toBeLessThan(0);
    });

    test('both minimized, both running -- sorts by user time', () => {
        const a = mockApp(RUNNING, [mockWindow(false, 100)]);
        const b = mockApp(RUNNING, [mockWindow(false, 200)]);
        // both minimized so equal on that dimension, then user time: 200-100=100
        expect(shellAppCompare(a, b)).toBeGreaterThan(0);
    });

    test('both running, both minimized -- hidden windows vs no windows', () => {
        // A has hidden windows, B has none. Both are "minimized" (same state).
        // This reaches the windowsA.length vs windowsB.length check (line 610).
        const a = mockApp(RUNNING, [mockWindow(false, 100)]);
        const b = mockApp(RUNNING, []);
        expect(shellAppCompare(a, b)).toBe(-1);
    });

    test('both running, both minimized -- no windows vs hidden windows', () => {
        // A has no windows, B has hidden windows. Reaches line 613.
        const a = mockApp(RUNNING, []);
        const b = mockApp(RUNNING, [mockWindow(false, 200)]);
        expect(shellAppCompare(a, b)).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// shellWindowsCompare
// ---------------------------------------------------------------------------
describe('shellWindowsCompare', () => {
    const mockActiveWorkspace = {index: () => 0};
    const otherWorkspace = {index: () => 1};
    let savedWorkspaceManager;

    beforeEach(() => {
        savedWorkspaceManager = global.workspaceManager;
        global.workspaceManager = {
            get_active_workspace: () => mockActiveWorkspace,
        };
    });

    afterEach(() => {
        if (savedWorkspaceManager === undefined)
            delete global.workspaceManager;
        else
            global.workspaceManager = savedWorkspaceManager;
    });

    const mockWin = (workspace, showing, userTime) => ({
        get_workspace: () => workspace,
        showing_on_its_workspace: () => showing,
        get_user_time: () => userTime,
    });

    test('window on active workspace sorts before other workspace', () => {
        const a = mockWin(mockActiveWorkspace, true, 100);
        const b = mockWin(otherWorkspace, true, 200);
        expect(shellWindowsCompare(a, b)).toBe(-1);
    });

    test('window on other workspace sorts after active workspace', () => {
        const a = mockWin(otherWorkspace, true, 200);
        const b = mockWin(mockActiveWorkspace, true, 100);
        expect(shellWindowsCompare(a, b)).toBe(1);
    });

    test('both on active workspace -- visible sorts before hidden', () => {
        const a = mockWin(mockActiveWorkspace, true, 100);
        const b = mockWin(mockActiveWorkspace, false, 200);
        expect(shellWindowsCompare(a, b)).toBe(-1);
    });

    test('both on active workspace -- hidden sorts after visible', () => {
        const a = mockWin(mockActiveWorkspace, false, 200);
        const b = mockWin(mockActiveWorkspace, true, 100);
        expect(shellWindowsCompare(a, b)).toBe(1);
    });

    test('both on active workspace, both visible -- more recent first', () => {
        const a = mockWin(mockActiveWorkspace, true, 100);
        const b = mockWin(mockActiveWorkspace, true, 200);
        expect(shellWindowsCompare(a, b)).toBeGreaterThan(0);
    });

    test('both on active workspace, both visible -- earlier time first', () => {
        const a = mockWin(mockActiveWorkspace, true, 300);
        const b = mockWin(mockActiveWorkspace, true, 100);
        expect(shellWindowsCompare(a, b)).toBeLessThan(0);
    });

    test('both on active workspace, both visible, same time = 0', () => {
        const a = mockWin(mockActiveWorkspace, true, 100);
        const b = mockWin(mockActiveWorkspace, true, 100);
        expect(shellWindowsCompare(a, b)).toBe(0);
    });

    test('both on other workspace -- visible before hidden', () => {
        const a = mockWin(otherWorkspace, true, 100);
        const b = mockWin(otherWorkspace, false, 200);
        expect(shellWindowsCompare(a, b)).toBe(-1);
    });

    test('both on other workspace, both hidden -- sorts by user time', () => {
        const a = mockWin(otherWorkspace, false, 100);
        const b = mockWin(otherWorkspace, false, 200);
        expect(shellWindowsCompare(a, b)).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// GlobalSignalsHandler
// ---------------------------------------------------------------------------
describe('GlobalSignalsHandler', () => {
    // Build a connectable mock. Note: jest.fn() objects fail
    // `instanceof Function` across VM module realms, so connect/disconnect
    // must be plain functions. We track calls manually.
    const makeMockObject = () => {
        const handlers = new Map();
        let nextId = 1;
        const connectCalls = [];
        const disconnectCalls = [];
        const obj = {
            connect(signal, cb) {
                const id = nextId++;
                handlers.set(id, {signal, cb});
                connectCalls.push({signal, cb, id});
                return id;
            },
            disconnect(id) {
                handlers.delete(id);
                disconnectCalls.push(id);
            },
            _handlers: handlers,
            _connectCalls: connectCalls,
            _disconnectCalls: disconnectCalls,
        };
        return obj;
    };

    beforeAll(() => {
        globalThis.logError = jest.fn();
    });
    afterEach(() => {
        globalThis.logError?.mockClear();
    });
    afterAll(() => {
        delete globalThis.logError;
    });

    describe('add / addWithLabel', () => {
        test('add() connects a signal and stores the handler', () => {
            const handler = new GlobalSignalsHandler();
            const obj = makeMockObject();
            const cb = () => {};
            handler.add([obj, 'notify', cb]);
            expect(obj._connectCalls).toHaveLength(1);
            expect(obj._connectCalls[0].signal).toBe('notify');
            expect(obj._connectCalls[0].cb).toBe(cb);
            handler.destroy();
        });

        test('add() with flat args (not nested array) also works', () => {
            const handler = new GlobalSignalsHandler();
            const obj = makeMockObject();
            const cb = () => {};
            handler.add(obj, 'clicked', cb);
            expect(obj._connectCalls).toHaveLength(1);
            expect(obj._connectCalls[0].signal).toBe('clicked');
            handler.destroy();
        });

        test('add() with multiple signal arrays', () => {
            const handler = new GlobalSignalsHandler();
            const obj = makeMockObject();
            handler.add([obj, 'notify', () => {}], [obj, 'clicked', () => {}]);
            expect(obj._connectCalls).toHaveLength(2);
            handler.destroy();
        });

        test('addWithLabel stores under the given label', () => {
            const handler = new GlobalSignalsHandler();
            const obj = makeMockObject();
            const cb = () => {};
            const label = Symbol('test-label');
            handler.addWithLabel(label, [obj, 'notify', cb]);
            expect(obj._connectCalls).toHaveLength(1);
            expect(obj._connectCalls[0].signal).toBe('notify');
            handler.destroy();
        });

        test('addWithLabel throws for non-symbol labels', () => {
            const handler = new GlobalSignalsHandler();
            expect(() => handler.addWithLabel('string-label', ['a', 'b', 'c'])).toThrow(
                'Invalid label'
            );
            handler.destroy();
        });

        test('addWithLabel throws for too few arguments', () => {
            const handler = new GlobalSignalsHandler();
            const label = Symbol('test');
            expect(() => handler.addWithLabel(label, [makeMockObject(), 'notify'])).toThrow(
                'Unexpected number of arguments'
            );
            handler.destroy();
        });

        test('add() logs error when object is null', () => {
            const handler = new GlobalSignalsHandler();
            handler.add(null, 'notify', () => {});
            expect(globalThis.logError).toHaveBeenCalled();
            handler.destroy();
        });

        test('add() logs error when object has no connect method', () => {
            const handler = new GlobalSignalsHandler();
            handler.add({}, 'notify', () => {});
            expect(globalThis.logError).toHaveBeenCalled();
            handler.destroy();
        });
    });

    describe('removeWithLabel', () => {
        test('disconnects all signals under a label', () => {
            const handler = new GlobalSignalsHandler();
            const obj = makeMockObject();
            const label = Symbol('remove-test');
            handler.addWithLabel(label, [obj, 'notify', () => {}]);
            handler.addWithLabel(label, [obj, 'clicked', () => {}]);
            expect(obj._connectCalls).toHaveLength(2);

            handler.removeWithLabel(label);
            expect(obj._disconnectCalls).toHaveLength(2);
            handler.destroy();
        });

        test('removing a non-existent label is a no-op', () => {
            const handler = new GlobalSignalsHandler();
            expect(() => handler.removeWithLabel(Symbol('no-such-label'))).not.toThrow();
            handler.destroy();
        });

        test('removing a label twice is safe', () => {
            const handler = new GlobalSignalsHandler();
            const obj = makeMockObject();
            const label = Symbol('double-remove');
            handler.addWithLabel(label, [obj, 'notify', () => {}]);
            handler.removeWithLabel(label);
            handler.removeWithLabel(label);
            expect(obj._disconnectCalls).toHaveLength(1);
            handler.destroy();
        });
    });

    describe('destroy', () => {
        test('disconnects all signals on destroy', () => {
            const handler = new GlobalSignalsHandler();
            const obj = makeMockObject();
            handler.add([obj, 'notify', () => {}]);
            handler.add([obj, 'clicked', () => {}]);
            handler.destroy();
            expect(obj._disconnectCalls).toHaveLength(2);
        });

        test('clears all labels on destroy', () => {
            const handler = new GlobalSignalsHandler();
            const obj = makeMockObject();
            const label1 = Symbol('a');
            const label2 = Symbol('b');
            handler.addWithLabel(label1, [obj, 'ev1', () => {}]);
            handler.addWithLabel(label2, [obj, 'ev2', () => {}]);
            handler.destroy();
            handler.removeWithLabel(label1);
            handler.removeWithLabel(label2);
            expect(obj._disconnectCalls).toHaveLength(2);
        });

        test('destroy with parentObject disconnects parent destroy handler', () => {
            const parent = makeMockObject();
            const handler = new GlobalSignalsHandler(parent);
            // Constructor connects 'destroy' on the parent
            expect(parent._connectCalls).toHaveLength(1);
            expect(parent._connectCalls[0].signal).toBe('destroy');

            handler.destroy();
            expect(parent._disconnectCalls).toHaveLength(1);
        });

        test('destroy is safe to call twice', () => {
            const handler = new GlobalSignalsHandler();
            const obj = makeMockObject();
            handler.add([obj, 'notify', () => {}]);
            handler.destroy();
            handler.destroy();
            expect(obj._disconnectCalls).toHaveLength(1);
        });
    });

    describe('clear', () => {
        test('removes all labels but handler remains usable', () => {
            const handler = new GlobalSignalsHandler();
            const obj = makeMockObject();
            handler.add([obj, 'notify', () => {}]);
            handler.clear();
            expect(obj._disconnectCalls).toHaveLength(1);

            handler.add([obj, 'clicked', () => {}]);
            expect(obj._connectCalls).toHaveLength(2);
            handler.destroy();
        });
    });

    describe('block / unblock', () => {
        test('block and unblock are no-ops for non-GObject objects', () => {
            const handler = new GlobalSignalsHandler();
            const obj = makeMockObject();
            handler.add([obj, 'notify', () => {}]);
            expect(() => handler.block()).not.toThrow();
            expect(() => handler.unblock()).not.toThrow();
            handler.destroy();
        });

        test('blockWithLabel and unblockWithLabel on non-existent label are no-ops', () => {
            const handler = new GlobalSignalsHandler();
            expect(() => handler.blockWithLabel(Symbol('nope'))).not.toThrow();
            expect(() => handler.unblockWithLabel(Symbol('nope'))).not.toThrow();
            handler.destroy();
        });

        test('block/unblock calls GObject signal methods for GObject instances', () => {
            // Add block_signal_handler / unblock_signal_handler to the mock
            const blockedIds = [];
            const unblockedIds = [];
            GObject.Object.prototype.block_signal_handler = function (id) {
                blockedIds.push(id);
            };
            GObject.Object.prototype.unblock_signal_handler = function (id) {
                unblockedIds.push(id);
            };

            try {
                // Create a mock that is instanceof GObject.Object
                class GObj extends GObject.Object {
                    constructor() {
                        super();
                        this._handlers = new Map();
                        this._nextId = 1;
                        this._connectCalls = [];
                        this._disconnectCalls = [];
                    }
                    connect(signal, cb) {
                        const id = this._nextId++;
                        this._handlers.set(id, {signal, cb});
                        this._connectCalls.push({signal, cb, id});
                        return id;
                    }
                    disconnect(id) {
                        this._handlers.delete(id);
                        this._disconnectCalls.push(id);
                    }
                }
                const gobj = new GObj();
                const handler = new GlobalSignalsHandler();
                handler.add([gobj, 'notify', () => {}]);

                handler.block();
                expect(blockedIds).toHaveLength(1);

                handler.unblock();
                expect(unblockedIds).toHaveLength(1);

                handler.destroy();
            } finally {
                delete GObject.Object.prototype.block_signal_handler;
                delete GObject.Object.prototype.unblock_signal_handler;
            }
        });
    });

    describe('connect_after flag', () => {
        test('uses connect_after when CONNECT_AFTER flag is passed', () => {
            const handler = new GlobalSignalsHandler();
            const obj = makeMockObject();
            const connectAfterCalls = [];
            obj.connect_after = function (signal, cb) {
                connectAfterCalls.push({signal, cb});
                return 99;
            };
            const cb = () => {};
            handler.add([obj, 'notify', cb, SignalsHandlerFlags.CONNECT_AFTER]);
            expect(connectAfterCalls).toHaveLength(1);
            expect(connectAfterCalls[0].signal).toBe('notify');
            expect(connectAfterCalls[0].cb).toBe(cb);
            expect(obj._connectCalls).toHaveLength(0);
            handler.destroy();
        });
    });

    describe('destroy signal on connected object', () => {
        test('connecting destroy on a non-parent object wraps callback to auto-remove', () => {
            const handler = new GlobalSignalsHandler();
            const obj = makeMockObject();
            const userCb = () => {};
            handler.add([obj, 'destroy', userCb]);
            expect(obj._connectCalls).toHaveLength(1);
            expect(obj._connectCalls[0].signal).toBe('destroy');
            // The stored callback is wrapped (not the original userCb)
            expect(obj._connectCalls[0].cb).not.toBe(userCb);
            handler.destroy();
        });

        test('firing destroy on non-parent object auto-removes its signals', () => {
            const handler = new GlobalSignalsHandler();
            const obj = makeMockObject();
            let userCbCalled = false;
            handler.add([obj, 'notify', () => {}]);
            handler.add([obj, 'destroy', () => { userCbCalled = true; }]);
            // Simulate the destroy event firing on obj
            const wrappedDestroyCb = obj._connectCalls[1].cb;
            wrappedDestroyCb(obj);
            // The user callback should have been called
            expect(userCbCalled).toBe(true);
            // All signals for obj should have been disconnected via _removeForObject
            // (notify + destroy = 2 disconnects)
            expect(obj._disconnectCalls).toHaveLength(2);
            handler.destroy();
        });

        test('connecting destroy on parent object re-wires the internal handler', () => {
            const parent = makeMockObject();
            const handler = new GlobalSignalsHandler(parent);
            // Constructor connected 'destroy' on parent (call #1)
            expect(parent._connectCalls).toHaveLength(1);
            const firstDestroyId = parent._connectCalls[0].id;

            // Now add a user-level 'destroy' handler on the parent
            handler.add([parent, 'destroy', () => {}]);
            // Constructor's destroy handler was disconnected and re-connected
            // So we should see: disconnect of firstDestroyId, then 2 new connects
            // (one for user destroy, one for re-wired internal destroy)
            expect(parent._disconnectCalls).toContain(firstDestroyId);
            // Total connects: 1 (constructor) + 1 (user destroy) + 1 (re-wired) = 3
            expect(parent._connectCalls).toHaveLength(3);
            handler.destroy();
        });

        test('re-wired parent destroy callback triggers full destroy', () => {
            const parent = makeMockObject();
            const handler = new GlobalSignalsHandler(parent);
            const obj = makeMockObject();
            handler.add([obj, 'notify', () => {}]);

            // Add a destroy handler on the parent to trigger re-wire (line 217-220)
            handler.add([parent, 'destroy', () => {}]);

            // The last connect call on parent is the re-wired internal destroy
            const rewiredCb = parent._connectCalls[parent._connectCalls.length - 1].cb;
            // Fire the re-wired destroy callback
            rewiredCb();
            // This should have called handler.destroy(), disconnecting all signals
            expect(obj._disconnectCalls).toHaveLength(1);
        });

        test('destroy on non-parent object only removes that objects signals', () => {
            const handler = new GlobalSignalsHandler();
            const objA = makeMockObject();
            const objB = makeMockObject();

            handler.add([objA, 'notify', () => {}]);
            handler.add([objB, 'notify', () => {}]);
            handler.add([objA, 'destroy', () => {}]);

            // Simulate destroy firing on objA
            const destroyCb = objA._connectCalls.find(c => c.signal === 'destroy').cb;
            destroyCb(objA);

            // objA should have all its signals disconnected (notify + destroy)
            expect(objA._disconnectCalls).toHaveLength(2);
            // objB should still have its signal intact (not disconnected yet)
            expect(objB._disconnectCalls).toHaveLength(0);

            handler.destroy();
            // Now objB's signal should be disconnected too
            expect(objB._disconnectCalls).toHaveLength(1);
        });
    });

    describe('constructor validation', () => {
        test('throws TypeError when parent has no connect method', () => {
            expect(() => new GlobalSignalsHandler({})).toThrow(TypeError);
        });

        test('accepts parent with connect method', () => {
            const parent = makeMockObject();
            const handler = new GlobalSignalsHandler(parent);
            handler.destroy();
        });

        test('no parent is allowed', () => {
            const handler = new GlobalSignalsHandler();
            handler.destroy();
        });
    });
});

// ---------------------------------------------------------------------------
// InjectionsHandler
// ---------------------------------------------------------------------------
describe('InjectionsHandler', () => {
    beforeAll(() => {
        globalThis.logError = jest.fn();
    });
    afterEach(() => {
        globalThis.logError?.mockClear();
    });
    afterAll(() => {
        delete globalThis.logError;
    });

    test('replaces a function and passes original as first arg', () => {
        const target = {
            greet: name => `hello ${name}`,
        };
        const handler = new InjectionsHandler();
        handler.add(target, 'greet', (original, name) => {
            return `${original(name)}!`;
        });
        expect(target.greet('world')).toBe('hello world!');
        handler.destroy();
    });

    test('removing injection restores original function', () => {
        const original = name => `hello ${name}`;
        const target = {greet: original};
        const handler = new InjectionsHandler();
        handler.add(target, 'greet', (orig, name) => `${orig(name)}!`);
        expect(target.greet).not.toBe(original);

        handler.destroy();
        expect(target.greet).toBe(original);
    });

    test('logs error when target property is not a function', () => {
        const target = {value: 42};
        const handler = new InjectionsHandler();
        handler.add(target, 'value', () => {});
        expect(globalThis.logError).toHaveBeenCalled();
        handler.destroy();
    });
});

// ---------------------------------------------------------------------------
// PropertyInjectionsHandler
// ---------------------------------------------------------------------------
describe('PropertyInjectionsHandler', () => {
    beforeAll(() => {
        globalThis.logError = jest.fn();
    });
    afterEach(() => {
        globalThis.logError?.mockClear();
    });
    afterAll(() => {
        delete globalThis.logError;
    });

    test('overrides a property and restores on destroy', () => {
        class Target {
            get name() {
                return 'original';
            }
        }
        const target = new Target();
        const handler = new PropertyInjectionsHandler();
        handler.add(target, 'name', {get: () => 'injected'});
        expect(target.name).toBe('injected');

        handler.destroy();
        expect(target.name).toBe('original');
    });

    test('logs error when property does not exist and allowNewProperty is false', () => {
        const target = {existing: 1};
        const handler = new PropertyInjectionsHandler();
        handler.add(target, 'nonexistent', {value: 2});
        expect(globalThis.logError).toHaveBeenCalled();
        handler.destroy();
    });

    test('allows new property when allowNewProperty is true', () => {
        const target = Object.create({constructor: Object});
        const handler = new PropertyInjectionsHandler(null, {allowNewProperty: true});
        handler.add(target, 'brandNew', {value: 42, configurable: true});
        expect(target.brandNew).toBe(42);
        handler.destroy();
    });
});

// ---------------------------------------------------------------------------
// drawRoundedLine
// ---------------------------------------------------------------------------
describe('drawRoundedLine', () => {
    const makeMockCr = () => ({
        moveTo: jest.fn(),
        lineTo: jest.fn(),
        arcNegative: jest.fn(),
        closePath: jest.fn(),
        setSource: jest.fn(),
        fillPreserve: jest.fn(),
        stroke: jest.fn(),
    });

    test('calls stroke with no fill or stroke source', () => {
        const cr = makeMockCr();
        drawRoundedLine(cr, 0, 0, 100, 10, false, false, null, null);
        expect(cr.stroke).toHaveBeenCalled();
        expect(cr.fillPreserve).not.toHaveBeenCalled();
    });

    test('calls fillPreserve when fill is provided', () => {
        const cr = makeMockCr();
        const fill = {};
        drawRoundedLine(cr, 0, 0, 100, 10, false, false, null, fill);
        expect(cr.setSource).toHaveBeenCalledWith(fill);
        expect(cr.fillPreserve).toHaveBeenCalled();
    });

    test('calls setSource with stroke when provided', () => {
        const cr = makeMockCr();
        const stroke = {};
        drawRoundedLine(cr, 0, 0, 100, 10, false, false, stroke, null);
        expect(cr.setSource).toHaveBeenCalledWith(stroke);
    });

    test('uses arcNegative for rounded left', () => {
        const cr = makeMockCr();
        drawRoundedLine(cr, 0, 0, 100, 10, true, false, null, null);
        expect(cr.arcNegative).toHaveBeenCalledTimes(1);
    });

    test('uses arcNegative for rounded right', () => {
        const cr = makeMockCr();
        drawRoundedLine(cr, 0, 0, 100, 10, false, true, null, null);
        expect(cr.arcNegative).toHaveBeenCalledTimes(1);
    });

    test('uses arcNegative twice for both rounded', () => {
        const cr = makeMockCr();
        drawRoundedLine(cr, 0, 0, 100, 10, true, true, null, null);
        expect(cr.arcNegative).toHaveBeenCalledTimes(2);
    });

    test('no arcNegative when neither side is rounded', () => {
        const cr = makeMockCr();
        drawRoundedLine(cr, 0, 0, 100, 10, false, false, null, null);
        expect(cr.arcNegative).not.toHaveBeenCalled();
    });

    test('adjusts y when height > width', () => {
        const cr = makeMockCr();
        drawRoundedLine(cr, 10, 10, 20, 50, false, false, null, null);
        // y += floor((50-20)/2) = 15, so y = 25; height becomes width = 20
        // moveTo(x + width - rightRadius, y) = (10+20-0, 25) = (30, 25)
        expect(cr.moveTo).toHaveBeenCalledWith(30, 25);
    });

    test('closePath is always called', () => {
        const cr = makeMockCr();
        drawRoundedLine(cr, 0, 0, 100, 10, true, true, {}, {});
        expect(cr.closePath).toHaveBeenCalledTimes(1);
    });

    test('both stroke and fill provided', () => {
        const cr = makeMockCr();
        const stroke = {id: 'stroke'};
        const fill = {id: 'fill'};
        drawRoundedLine(cr, 0, 0, 100, 10, false, false, stroke, fill);
        expect(cr.fillPreserve).toHaveBeenCalled();
        expect(cr.stroke).toHaveBeenCalled();
        expect(cr.setSource).toHaveBeenCalledTimes(2);
        expect(cr.setSource).toHaveBeenCalledWith(fill);
        expect(cr.setSource).toHaveBeenCalledWith(stroke);
    });
});

// ---------------------------------------------------------------------------
// cairoSetSourceColor
// ---------------------------------------------------------------------------
describe('cairoSetSourceColor', () => {
    test('uses Clutter.cairo_set_source_color when available', () => {
        const origFn = Clutter.cairo_set_source_color;
        const calls = [];
        Clutter.cairo_set_source_color = function (cr, color) {
            calls.push({cr, color});
        };
        const cr = {};
        const color = {red: 255};
        cairoSetSourceColor(cr, color);
        expect(calls).toHaveLength(1);
        expect(calls[0].cr).toBe(cr);
        expect(calls[0].color).toBe(color);
        Clutter.cairo_set_source_color = origFn;
    });

    test('falls back to cr.setSourceColor when Clutter helper missing', () => {
        const origFn = Clutter.cairo_set_source_color;
        Clutter.cairo_set_source_color = undefined;
        const calls = [];
        const cr = {
            setSourceColor(color) {
                calls.push(color);
            },
        };
        const color = {red: 128};
        cairoSetSourceColor(cr, color);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toBe(color);
        Clutter.cairo_set_source_color = origFn;
    });
});

// ---------------------------------------------------------------------------
// addActor
// ---------------------------------------------------------------------------
describe('addActor', () => {
    test('uses add_actor when available', () => {
        const added = [];
        const element = {
            add_actor(actor) { added.push(actor); },
            add_child(actor) { added.push(`child:${actor}`); },
        };
        addActor(element, 'myActor');
        expect(added).toEqual(['myActor']);
    });

    test('falls back to add_child when add_actor is missing', () => {
        const added = [];
        const element = {
            add_child(actor) { added.push(actor); },
        };
        addActor(element, 'myActor');
        expect(added).toEqual(['myActor']);
    });
});

// ---------------------------------------------------------------------------
// getMonitorManager
// ---------------------------------------------------------------------------
describe('getMonitorManager', () => {
    let savedBackend;

    beforeEach(() => {
        savedBackend = global.backend;
    });
    afterEach(() => {
        if (savedBackend === undefined)
            delete global.backend;
        else
            global.backend = savedBackend;
    });

    test('uses global.backend.get_monitor_manager when available', () => {
        const mgr = {name: 'monitor-manager'};
        global.backend = {get_monitor_manager: () => mgr};
        expect(getMonitorManager()).toBe(mgr);
    });

    test('falls back to Meta.MonitorManager.get when backend method missing', () => {
        const mgr = {name: 'fallback-mgr'};
        global.backend = {};
        Meta.MonitorManager = {get: () => mgr};
        expect(getMonitorManager()).toBe(mgr);
    });
});

// ---------------------------------------------------------------------------
// laterAdd / laterRemove
// ---------------------------------------------------------------------------
describe('laterAdd', () => {
    let savedCompositor;

    beforeEach(() => {
        savedCompositor = global.compositor;
    });
    afterEach(() => {
        if (savedCompositor === undefined)
            delete global.compositor;
        else
            global.compositor = savedCompositor;
    });

    test('uses global.compositor.get_laters().add when available', () => {
        const cb = () => {};
        global.compositor = {
            get_laters: () => ({
                add(type, callback) { return 42; },
            }),
        };
        expect(laterAdd(0, cb)).toBe(42);
    });

    test('falls back to Meta.later_add when compositor method missing', () => {
        global.compositor = undefined;
        const cb = () => {};
        Meta.later_add = (type, callback) => 99;
        expect(laterAdd(0, cb)).toBe(99);
    });
});

describe('laterRemove', () => {
    let savedCompositor;

    beforeEach(() => {
        savedCompositor = global.compositor;
    });
    afterEach(() => {
        if (savedCompositor === undefined)
            delete global.compositor;
        else
            global.compositor = savedCompositor;
    });

    test('uses global.compositor.get_laters().remove when available', () => {
        const removed = [];
        global.compositor = {
            get_laters: () => ({
                remove(id) { removed.push(id); },
            }),
        };
        laterRemove(42);
        expect(removed).toEqual([42]);
    });

    test('falls back to Meta.later_remove when compositor method missing', () => {
        global.compositor = undefined;
        const removed = [];
        Meta.later_remove = id => { removed.push(id); };
        laterRemove(99);
        expect(removed).toEqual([99]);
    });
});

// ---------------------------------------------------------------------------
// supportsExtendedBarriers
// ---------------------------------------------------------------------------
describe('supportsExtendedBarriers', () => {
    let savedDisplay, savedBackend;

    beforeEach(() => {
        savedDisplay = global.display;
        savedBackend = global.backend;
    });
    afterEach(() => {
        if (savedDisplay === undefined)
            delete global.display;
        else
            global.display = savedDisplay;
        if (savedBackend === undefined)
            delete global.backend;
        else
            global.backend = savedBackend;
    });

    test('uses global.display.supports_extended_barriers when available', () => {
        global.display = {supports_extended_barriers: () => true};
        global.backend = {};
        expect(supportsExtendedBarriers()).toBe(true);
    });

    test('falls back to global.backend.capabilities check', () => {
        Meta.BackendCapabilities = {BARRIERS: 2};
        global.display = {};
        global.backend = {capabilities: 2};
        expect(supportsExtendedBarriers()).toBe(true);
    });

    test('returns false when backend lacks barriers capability', () => {
        Meta.BackendCapabilities = {BARRIERS: 2};
        global.display = {};
        global.backend = {capabilities: 0};
        expect(supportsExtendedBarriers()).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// getWindowsByObjectPath
// ---------------------------------------------------------------------------
describe('getWindowsByObjectPath', () => {
    let savedWorkspaceManager;

    beforeEach(() => {
        savedWorkspaceManager = global.workspaceManager;
    });
    afterEach(() => {
        if (savedWorkspaceManager === undefined)
            delete global.workspaceManager;
        else
            global.workspaceManager = savedWorkspaceManager;
    });

    test('maps window object paths to MetaWindows', () => {
        const win1 = {get_gtk_window_object_path: () => '/org/app/window/1'};
        const win2 = {get_gtk_window_object_path: () => '/org/app/window/2'};
        const win3 = {get_gtk_window_object_path: () => null};

        const ws0 = {list_windows: () => [win1, win3]};
        const ws1 = {list_windows: () => [win2]};

        global.workspaceManager = {
            nWorkspaces: 2,
            get_workspace_by_index: i => [ws0, ws1][i],
        };

        const result = getWindowsByObjectPath();
        expect(result).toBeInstanceOf(Map);
        expect(result.size).toBe(2);
        expect(result.get('/org/app/window/1')).toBe(win1);
        expect(result.get('/org/app/window/2')).toBe(win2);
    });

    test('returns empty map when no windows have object paths', () => {
        const win = {get_gtk_window_object_path: () => null};
        const ws = {list_windows: () => [win]};

        global.workspaceManager = {
            nWorkspaces: 1,
            get_workspace_by_index: () => ws,
        };

        const result = getWindowsByObjectPath();
        expect(result.size).toBe(0);
    });

    test('returns empty map with no workspaces', () => {
        global.workspaceManager = {
            nWorkspaces: 0,
            get_workspace_by_index: () => null,
        };

        const result = getWindowsByObjectPath();
        expect(result.size).toBe(0);
    });
});
