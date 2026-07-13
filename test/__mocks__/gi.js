// Mock for ./dependencies/gi.js
// Provides comprehensive stubs of GI modules so source files are importable by Jest.

// GJS globals
globalThis.logError = globalThis.logError ?? ((...args) => console.error(...args));
globalThis.log = globalThis.log ?? ((...args) => console.log(...args));

globalThis.imports = globalThis.imports ?? {
    cairo: {
        Operator: {CLEAR: 0, SOURCE: 1, OVER: 2},
        LinearGradient: class {
            constructor() {}
            addColorStopRGBA() {}
        },
    },
    signals: {
        addSignalMethods(proto) {
            proto.connect = function (name, cb) {
                this._signals = this._signals ?? {};
                this._signals[name] = this._signals[name] ?? [];
                const id = Math.random();
                this._signals[name].push({id, cb});
                return id;
            };
            proto.disconnect = function (id) {
                if (!this._signals) return;
                for (const name of Object.keys(this._signals))
                    this._signals[name] = this._signals[name].filter(s => s.id !== id);
            };
            proto.emit = function (name, ...args) {
                if (!this._signals?.[name]) return;
                for (const s of this._signals[name])
                    s.cb(...args);
            };
        },
    },
};

// --- GObject mock ---

const _hookUpVfuncSym = Symbol('__GObject__hook_up_vfunc');
const _gobjectProtoSym = Symbol('__GObject__prototype');

class _GObjectBase {
    constructor() {}
}
_GObjectBase.prototype[_hookUpVfuncSym] = function (name, func) {
    this[`vfunc_${name}`] = func;
};
_GObjectBase.$gtype = 'GObject';

// Track constructor nesting so intermediate super() calls don't re-invoke _init
let _gobjectConstructDepth = 0;

export const GObject = {
    Object: _GObjectBase,
    registerClass: (a, b) => {
        const klass = b ?? a;
        klass.prototype[_gobjectProtoSym] = klass.prototype;
        klass.$gtype = klass.name || 'GObject';
        const wrapped = class extends klass {
            constructor(...args) {
                _gobjectConstructDepth++;
                super();
                _gobjectConstructDepth--;
                // Only call _init at the outermost constructor level
                if (_gobjectConstructDepth === 0 && this._init)
                    this._init(...args);
            }
        };
        Object.defineProperty(wrapped, 'name', {value: klass.name});
        wrapped.$gtype = klass.$gtype;
        wrapped.prototype[_gobjectProtoSym] = wrapped.prototype;
        return wrapped;
    },
    NotImplementedError: class extends Error {},
    signal_lookup: () => 0,
    ParamSpec: {
        boolean: () => ({}),
        int: () => ({}),
        uint: () => ({}),
        double: () => ({}),
        float: () => ({}),
        string: () => ({}),
        enum: () => ({}),
        flags: () => ({}),
        object: () => ({}),
        jsobject: () => ({}),
        boxed: () => ({}),
        override: () => ({}),
    },
    ParamFlags: {READWRITE: 2, CONSTRUCT_ONLY: 4},
    BindingFlags: {SYNC_CREATE: 1},
    TypeFlags: {ABSTRACT: 1},
    TYPE_DOUBLE: 'gdouble',
    TYPE_STRING: 'gchararray',
    TYPE_INT: 'gint',
    TYPE_BOOLEAN: 'gboolean',
};

// --- Base actor mock ---
// Common methods shared by all Clutter actors and St widgets.

let _nextSignalId = 1;

class MockActor {
    constructor(params) {
        this._children = [];
        this._signals = {};
        this._styleClasses = new Set();
        this._style = '';
        this._visible = true;
        this._reactive = false;
        this._trackHover = false;
        this._opacity = 255;
        this._x = 0;
        this._y = 0;
        this._width = 0;
        this._height = 0;
        this._pivotPoint = null;
        this._constraints = [];
        this._actions = [];
        this._transitions = new Map();
        this._allocation = {x1: 0, y1: 0, x2: 0, y2: 0,
            get_width() { return this.x2 - this.x1; },
            get_height() { return this.y2 - this.y1; }};
        this._name = '';
        this.layout_manager = null;
        if (params)
            Object.assign(this, params);
    }

    _init(params) {
        if (params)
            Object.assign(this, params);
    }

    // Tree ops
    add_child(child) { this._children.push(child); if (child) child.get_parent = () => this; }
    remove_child(child) { this._children = this._children.filter(c => c !== child); }
    insert_child_below(child) { this._children.unshift(child); if (child) child.get_parent = () => this; }
    insert_child_above(child) { this._children.push(child); if (child) child.get_parent = () => this; }
    insert_child_at_index(child, idx) { this._children.splice(idx, 0, child); if (child) child.get_parent = () => this; }
    set_child_below_sibling(child) { this.remove_child(child); this._children.unshift(child); }
    set_child_above_sibling(child) { this.remove_child(child); this._children.push(child); }
    get_children() { return [...this._children]; }
    get_child_at_index(i) { return this._children[i] ?? null; }
    get_n_children() { return this._children.length; }
    get_parent() { return null; }
    get_stage() { return null; }
    contains(actor) { return this._children.includes(actor); }
    destroy_all_children() { this._children = []; }
    destroy() { this._children = []; }

    // Style
    set_style(v) { this._style = v; }
    get_style() { return this._style; }
    add_style_class_name(name) { this._styleClasses.add(name); }
    remove_style_class_name(name) { this._styleClasses.delete(name); }
    has_style_class_name(name) { return this._styleClasses.has(name); }
    add_style_pseudo_class(name) { this._styleClasses.add(`:${name}`); }
    remove_style_pseudo_class(name) { this._styleClasses.delete(`:${name}`); }
    has_style_pseudo_class(name) { return this._styleClasses.has(`:${name}`); }
    get_theme_node() { return _mockThemeNode; }
    set style(v) { this._style = v; }
    get style() { return this._style; }

    // Geometry
    set_size(w, h) { this._width = w; this._height = h; }
    get_size() { return [this._width, this._height]; }
    set_position(x, y) { this._x = x; this._y = y; }
    get_position() { return [this._x, this._y]; }
    get_transformed_position() { return [this._x, this._y]; }
    get_transformed_size() { return [this._width, this._height]; }
    get_preferred_width() { return [0, this._width]; }
    get_preferred_height() { return [0, this._height]; }
    get_preferred_size() { return [0, 0, this._width, this._height]; }
    vfunc_get_preferred_width(forWidth) { return [0, this._width]; }
    vfunc_get_preferred_height(forHeight) { return [0, this._height]; }
    vfunc_allocate(box) { this._allocation = box; }
    vfunc_get_paint_volume() { return true; }
    get_allocation() { return this._allocation; }
    set_allocation(a) { this._allocation = a; }
    allocate(box) { this._allocation = box; }
    allocate_preferred_size() {}
    queue_relayout() {}
    queue_redraw() {}

    // Properties (both GJS method-style and JS property-style)
    set visible(v) { this._visible = v; }
    get visible() { return this._visible; }
    set reactive(v) { this._reactive = v; }
    get reactive() { return this._reactive; }
    set_reactive(v) { this._reactive = v; }
    set track_hover(v) { this._trackHover = v; }
    get track_hover() { return this._trackHover; }
    set_track_hover(v) { this._trackHover = v; }
    set opacity(v) { this._opacity = v; }
    get opacity() { return this._opacity; }
    set_opacity(v) { this._opacity = v; }
    set x(v) { this._x = v; }
    get x() { return this._x; }
    set y(v) { this._y = v; }
    get y() { return this._y; }
    set width(v) { this._width = v; }
    get width() { return this._width; }
    set_width(v) { this._width = v; }
    get_width() { return this._width; }
    set height(v) { this._height = v; }
    get height() { return this._height; }
    set_height(v) { this._height = v; }
    get_height() { return this._height; }
    set_name(v) { this._name = v; }
    set name(v) { this._name = v; }
    get name() { return this._name; }
    set pivot_point(v) { this._pivotPoint = v; }
    get pivot_point() { return this._pivotPoint; }
    set offscreen_redirect(v) { this._offscreenRedirect = v; }
    get offscreen_redirect() { return this._offscreenRedirect; }
    set clip_to_allocation(v) { this._clipToAllocation = v; }
    get clip_to_allocation() { return this._clipToAllocation; }
    set_clip_to_allocation(v) { this._clipToAllocation = v; }
    set x_align(v) { this._xAlign = v; }
    get x_align() { return this._xAlign; }
    set y_align(v) { this._yAlign = v; }
    get y_align() { return this._yAlign; }
    set x_expand(v) { this._xExpand = v; }
    get x_expand() { return this._xExpand; }
    set y_expand(v) { this._yExpand = v; }
    get y_expand() { return this._yExpand; }

    // Signals
    connect(name, cb) {
        this._signals[name] = this._signals[name] ?? [];
        const id = _nextSignalId++;
        this._signals[name].push({id, cb});
        return id;
    }
    connectObject(...args) {
        const ids = [];
        for (let i = 0; i < args.length - 1; i += 2) {
            if (typeof args[i] === 'string' && typeof args[i + 1] === 'function')
                ids.push(this.connect(args[i], args[i + 1]));
        }
        return ids;
    }
    disconnect(id) {
        for (const name of Object.keys(this._signals))
            this._signals[name] = this._signals[name].filter(s => s.id !== id);
    }
    disconnectObject() {}
    emit(name, ...args) {
        if (!this._signals[name]) return;
        for (const s of this._signals[name])
            s.cb(this, ...args);
    }

    // Animations
    ease(params) {
        Object.assign(this, params);
        if (params.onComplete) params.onComplete();
    }
    ease_property(prop, target, params) {
        this[prop] = target;
        if (params?.onComplete) params.onComplete();
    }
    set_easing_duration() {}
    set_easing_mode() {}
    save_easing_state() {}
    restore_easing_state() {}
    remove_all_transitions() { this._transitions.clear(); }
    get_transition(name) { return this._transitions.get(name) ?? null; }

    // Constraints/actions
    add_constraint(c) { this._constraints.push(c); }
    remove_constraint(c) { this._constraints = this._constraints.filter(x => x !== c); }
    add_action(a) { this._actions.push(a); }
    remove_action(a) { this._actions = this._actions.filter(x => x !== a); }

    // Misc
    grab_key_focus() {}
    set_clip() {}
    remove_clip() {}
    show() { this._visible = true; }
    hide() { this._visible = false; }
    bind_property() { return {}; }
    notify(prop) { this.emit(`notify::${prop}`); }
}

const _mockThemeNode = {
    get_length: () => 0,
    get_padding: () => 0,
    get_margin: () => 0,
    get_border_width: () => 0,
    get_color: () => ({red: 0, green: 0, blue: 0, alpha: 255}),
    get_background_color: () => ({red: 0, green: 0, blue: 0, alpha: 255}),
    get_foreground_color: () => ({red: 255, green: 255, blue: 255, alpha: 255}),
    get_border_color: () => ({red: 0, green: 0, blue: 0, alpha: 128, to_string: () => 'rgba(0,0,0,0.5)'}),
    get_transition_duration: () => 0,
    lookup_color: () => [false, {red: 0, green: 0, blue: 0, alpha: 0}],
    adjust_for_height: h => h,
    adjust_preferred_width: (min, nat) => [min, nat],
    adjust_preferred_height: (min, nat) => [min, nat],
    get_max_width: () => -1,
    get_max_height: () => -1,
    get_content_box: () => ({x1: 0, y1: 0, x2: 100, y2: 100}),
};

// --- Clutter ---

class ClutterActor extends MockActor {}
ClutterActor.$gtype = 'ClutterActor';

class ClutterActorBox {
    constructor(x1 = 0, y1 = 0, x2 = 0, y2 = 0) {
        this.x1 = x1; this.y1 = y1; this.x2 = x2; this.y2 = y2;
    }
    get_width() { return this.x2 - this.x1; }
    get_height() { return this.y2 - this.y1; }
    init_rect(x, y, w, h) { this.x1 = x; this.y1 = y; this.x2 = x + w; this.y2 = y + h; }
    set_origin(x, y) { const w = this.x2 - this.x1; const h = this.y2 - this.y1; this.x1 = x; this.y1 = y; this.x2 = x + w; this.y2 = y + h; }
    set_size(w, h) { this.x2 = this.x1 + w; this.y2 = this.y1 + h; }
}

class ClutterTimeline extends MockActor {
    constructor(params) { super(params); this._progress = 0; this.duration = params?.duration ?? 0; }
    start() {}
    stop() {}
    get_progress() { return this._progress; }
    set_duration(d) { this.duration = d; }
    get_duration() { return this.duration; }
}

export const Clutter = {
    Actor: ClutterActor,
    ActorBox: ClutterActorBox,
    BoxLayout: class extends MockActor {},
    BinLayout: class extends MockActor {},
    BindConstraint: class { constructor() {} },
    ClickGesture: class extends MockActor {},
    Clone: class extends MockActor { constructor(p) { super(p); this.source = p?.source; } },
    LongPressGesture: class extends MockActor {},
    Timeline: ClutterTimeline,
    Canvas: class extends MockActor {},
    Point: {alloc: () => ({x: 0, y: 0})},
    TextDirection: {RTL: 1, LTR: 0},
    get_default_text_direction: () => Clutter.TextDirection.LTR,
    EVENT_PROPAGATE: 0,
    EVENT_STOP: 1,
    AnimationMode: {EASE_OUT_QUAD: 0, EASE_IN_QUAD: 1, EASE_IN_OUT_QUAD: 2, LINEAR: 3, EASE_OUT_CUBIC: 4},
    ActorAlign: {CENTER: 0, START: 1, END: 2, FILL: 3},
    Orientation: {HORIZONTAL: 0, VERTICAL: 1},
    OffscreenRedirect: {ALWAYS: 1, AUTOMATIC_FOR_OPACITY: 0},
    BindCoordinate: {X: 0, Y: 1, WIDTH: 2, HEIGHT: 3, POSITION: 4, SIZE: 5, ALL: 6},
    EventType: {BUTTON_PRESS: 4, BUTTON_RELEASE: 7, MOTION: 5, ENTER: 8, LEAVE: 9, SCROLL: 10, KEY_PRESS: 11, KEY_RELEASE: 12, TOUCH_BEGIN: 13, TOUCH_END: 15},
    ModifierType: {SHIFT_MASK: 1, CONTROL_MASK: 4, MOD1_MASK: 8, BUTTON1_MASK: 256, BUTTON2_MASK: 512, BUTTON3_MASK: 1024},
    ScalingFilter: {TRILINEAR: 0, NEAREST: 1},
    ScrollDirection: {UP: 0, DOWN: 1, LEFT: 2, RIGHT: 3, SMOOTH: 4},
};

// Tag constructors with $gtype for GObject.registerClass
Clutter.BoxLayout.$gtype = 'ClutterBoxLayout';
Clutter.BinLayout.$gtype = 'ClutterBinLayout';
Clutter.Actor.$gtype = 'ClutterActor';

// --- St ---

class StWidget extends MockActor {
    constructor(params) {
        super(params);
        if (params?.style_class)
            for (const cls of params.style_class.split(' '))
                this._styleClasses.add(cls);
    }
    get_theme_node() { return _mockThemeNode; }
}
StWidget.$gtype = 'StWidget';

class StBin extends StWidget {
    constructor(params) { super(params); this.child = params?.child ?? null; }
    set_child(c) { this.child = c; }
    get_child() { return this.child; }
}
StBin.$gtype = 'StBin';

class StBoxLayout extends StWidget {
    constructor(params) {
        super(params);
        this.vertical = params?.vertical ?? false;
        this.hover = false;
    }
    set_vertical(v) { this.vertical = v; }
    sync_hover() {}
    navigate_focus() {}
}
StBoxLayout.$gtype = 'StBoxLayout';

class StViewport extends StWidget {
    constructor(params) {
        super(params);
        this.clip_to_view = params?.clip_to_view ?? true;
    }
}
StViewport.$gtype = 'StViewport';

class StScrollView extends StWidget {
    constructor(params) {
        super(params);
        this.hscrollbar_policy = 0;
        this.vscrollbar_policy = 0;
    }
    get_hscroll_bar() { return new MockActor(); }
    get_vscroll_bar() { return new MockActor(); }
    get_effect(name) { return null; }
}
StScrollView.$gtype = 'StScrollView';

class StDrawingArea extends StWidget {
    constructor(params) { super(params); }
    queue_repaint() {}
    get_context() { return null; }
    get_surface_size() { return [0, 0]; }
}
StDrawingArea.$gtype = 'StDrawingArea';

export const St = {
    Widget: StWidget,
    BoxLayout: StBoxLayout,
    Bin: StBin,
    Button: class extends StWidget { constructor(p) { super(p); } },
    Label: class extends StWidget {
        constructor(p) {
            super(p);
            this.text = p?.text ?? '';
            this.clutter_text = {ellipsize: 0};
        }
        set_text(t) { this.text = t; }
        get_text() { return this.text; }
    },
    Icon: class extends StWidget { constructor(p) { super(p); this.icon_name = p?.icon_name; this.icon_size = p?.icon_size ?? 16; this.fallback_gicon = null; this.gicon = null; this.iconName = p?.icon_name; this.fallbackIconName = null; this.fallbackGicon = null; } },
    ScrollView: StScrollView,
    DrawingArea: StDrawingArea,
    Viewport: StViewport,
    IconTheme: class { constructor() {} get_default() { return this; } list_icons() { return []; } },
    Side: {LEFT: 3, RIGHT: 1, TOP: 0, BOTTOM: 2},
    DirectionType: {LEFT: 3, RIGHT: 1, UP: 0, DOWN: 2, TAB_FORWARD: 4, TAB_BACKWARD: 5},
    PolicyType: {NEVER: 0, ALWAYS: 1, AUTOMATIC: 2, EXTERNAL: 3},
    Align: {START: 0, MIDDLE: 1, END: 2},
    TextDirection: {NONE: 0, LTR: 1, RTL: 2},
    ThemeContext: {get_for_stage: () => ({scaleFactor: 1, scale_factor: 1, connect: () => 0, disconnect: () => {}})},
    Settings: {get: () => ({gtkIconTheme: '', connect: () => 0, disconnect: () => {}})},
};

// --- Shell ---

export const Shell = {
    AppState: {STOPPED: 0, STARTING: 1, RUNNING: 2},
    WindowTracker: (() => {
        class WT {
            get_window_app() { return null; }
            get_app_from_pid() { return null; }
            get focus_app() { return null; }
            connect() { return 0; }
            disconnect() {}
        }
        WT.get_default = () => new WT();
        return WT;
    })(),
    AppSystem: (() => {
        class AS {
            get_running() { return []; }
            lookup_app() { return null; }
            connect() { return 0; }
            disconnect() {}
        }
        AS.get_default = () => new AS();
        return AS;
    })(),
    App: class {
        activate() {}
        open_new_window() {}
        get_windows() { return []; }
        get_pids() { return []; }
    },
    ActionMode: {NORMAL: 1, OVERVIEW: 2, POPUP: 4},
    Global: class {},
    Screenshot: class { screenshot_stage_to_content() { return Promise.resolve(null); } },
    util_get_week_start: () => 0,
};

// --- GLib ---

export const GLib = {
    idle_add: (_priority, cb) => { if (cb) cb(); return 1; },
    timeout_add: (_priority, _ms, cb) => { const id = _nextSignalId++; try { if (cb) cb(); } catch(e) { /* ignore callback errors */ } return id; },
    timeout_add_seconds: (_priority, _s, cb) => { const id = _nextSignalId++; try { if (cb) cb(); } catch(e) { /* ignore callback errors */ } return id; },
    source_remove: () => {},
    get_monotonic_time: () => 0,
    PRIORITY_DEFAULT: 0,
    PRIORITY_LOW: 300,
    PRIORITY_HIGH: -100,
    PRIORITY_DEFAULT_IDLE: 200,
    SOURCE_REMOVE: false,
    SOURCE_CONTINUE: true,
    MAXINT32: 2147483647,
    MAXUINT32: 4294967295,
    Source: {set_name_by_id: () => {}},
    Variant: class { constructor(type, val) { this._type = type; this._val = val; } deep_unpack() { return this._val; } recursiveUnpack() { return this._val; } deepUnpack() { return [this._type, this._val]; } unpack() { return this._val; } },
    VariantType: class { constructor(t) { this._t = t; } },
};

// --- Gio ---

export const Gio = {
    Settings: class {
        constructor() { this._values = {}; }
        get_boolean() { return false; }
        get_int() { return 0; }
        get_double() { return 0.0; }
        get_string() { return ''; }
        get_strv() { return []; }
        get_value() { return new GLib.Variant('s', ''); }
        set_boolean() {}
        set_int() {}
        set_double() {}
        set_string() {}
        set_strv() {}
        set_value() {}
        bind() {}
        connect() { return _nextSignalId++; }
        disconnect() {}
    },
    Cancellable: class {
        constructor(params) {
            this._cancelled = false;
            this._handlers = new Map();
            this._nextId = 1;
            this.parent = params?.parent ?? null;
        }
        _init(params) {
            if (!this._handlers) {
                this._handlers = new Map();
                this._nextId = 1;
                this._cancelled = false;
            }
            if (params?.parent) this.parent = params.parent;
        }
        connect(cb) { const id = this._nextId++; this._handlers.set(id, cb); return id; }
        disconnect(id) { this._handlers.delete(id); }
        cancel() { this._cancelled = true; for (const cb of this._handlers.values()) cb(); }
        is_cancelled() { return this._cancelled; }
    },
    DBus: {get: () => ({}), session: {}, system: {}},
    DBusProxy: class extends MockActor {},
    BusType: {SESSION: 0, SYSTEM: 1},
    DBusProxyFlags: {NONE: 0, DO_NOT_AUTO_START: 2},
    DBusSignalFlags: {NONE: 0},
    File: {new_for_path: () => ({get_child: () => ({}), load_contents: () => [true, new Uint8Array()], query_exists: () => false})},
    FileMonitorFlags: {NONE: 0},
    icon_deserialize: () => null,
};
Gio.Cancellable.$gtype = 'GCancellable';

// --- Meta ---

export const Meta = {
    LaterType: {BEFORE_REDRAW: 0, IDLE: 1},
    Barrier: class { constructor(p) { Object.assign(this, p ?? {}); } destroy() {} },
    BarrierDirection: {POSITIVE_X: 1, POSITIVE_Y: 2, NEGATIVE_X: 4, NEGATIVE_Y: 8},
    BarrierFlags: {STICKY: 1},
    WindowType: {
        NORMAL: 0, DESKTOP: 1, DOCK: 2, DIALOG: 3, MODAL_DIALOG: 4,
        TOOLBAR: 5, MENU: 6, UTILITY: 7, SPLASHSCREEN: 8,
        DROPDOWN_MENU: 9, POPUP_MENU: 10, TOOLTIP: 11,
        NOTIFICATION: 12, COMBO: 13, DND: 14, OVERRIDE_OTHER: 15,
    },
    MaximizeFlags: {BOTH: 3, HORIZONTAL: 1, VERTICAL: 2},
    FrameType: {NORMAL: 0},
    KeyBindingFlags: {NONE: 0, IGNORE_AUTOREPEAT: 1},
    VirtualModifier: {SHIFT_MASK: 1},
    MotionDirection: {UP: 0, DOWN: 1, LEFT: 2, RIGHT: 3},
};

// --- Misc ---

export const Pango = {
    EllipsizeMode: {NONE: 0, START: 1, MIDDLE: 2, END: 3},
    WrapMode: {WORD: 0, CHAR: 1, WORD_CHAR: 2},
};

export const Mtk = {
    Rectangle: class { constructor(p) { Object.assign(this, {x: 0, y: 0, width: 0, height: 0}, p ?? {}); } },
};
export const Cogl = {
    Color: {
        from_string: (str) => {
            // Minimal parser for rgb(r,g,b) and #rrggbb
            const rgbMatch = str?.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
            if (rgbMatch) {
                return [true, {
                    red: parseInt(rgbMatch[1]),
                    green: parseInt(rgbMatch[2]),
                    blue: parseInt(rgbMatch[3]),
                    alpha: 255,
                }];
            }
            const hexMatch = str?.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
            if (hexMatch) {
                return [true, {
                    red: parseInt(hexMatch[1], 16),
                    green: parseInt(hexMatch[2], 16),
                    blue: parseInt(hexMatch[3], 16),
                    alpha: 255,
                }];
            }
            return [false, null];
        },
    },
};
export const Atk = {Role: {FRAME: 11}};
export const GdkPixbuf = {};
export const GioUnix = {};
