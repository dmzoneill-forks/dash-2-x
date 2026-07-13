// Mock for ./imports.js
// Provides controllable settings for position-dependent tests.

let _nextSigId = 1;

const _mockDockManagerInstance = {
    notificationsMonitor: {
        enabled: false,
        connect: () => _nextSigId++,
        disconnect: () => {},
        emit: () => {},
        acknowledgeAppNotifications: () => {},
    },
    mprisMonitor: null,
    appSpread: null,
    wiggleMode: false,
    enterWiggleMode: () => {},
    exitWiggleMode: () => {},
    pinnedCommandsManager: null,
    volumeControl: null,
    remoteModel: null,
    discreteGpuAvailable: false,
};

const _dockManagerSettings = {
    dockPosition: 2,            // St.Side.BOTTOM
    secondaryDockPosition: 3,   // St.Side.LEFT
    connect: () => _nextSigId++,
    disconnect: () => {},
};

export const Docking = {
    DockManager: {
        settings: _dockManagerSettings,
        getDefault: () => _mockDockManagerInstance,
        extension: {
            uuid: 'xdock@test',
            metadata: {name: 'XDock'},
            openPreferences: () => {},
        },
    },
    State: Object.freeze({
        HIDDEN:  0,
        SHOWING: 1,
        SHOWN:   2,
        HIDING:  3,
    }),
    IconAnimator: class {
        constructor() {}
        start() {}
        pause() {}
        destroy() {}
    },
};

export const AppIconIndicators = {
    AppIconIndicator: class {
        constructor() {}
        destroy() {}
    },
    getBadgeOverride: () => null,
    setBadgeOverride: () => {},
};
export const AppIcons = {
    DockShowAppsIcon: class {
        constructor() {
            this.icon = {setIconSize: () => {}, _iconBin: null};
            this.toggleButton = {connect: () => 0, disconnect: () => {}};
            this.visible = true;
            this._visible = true;
            this._children = [];
            this._signals = {};
            this._styleClasses = new Set();
        }

        show() {}
        hide() {}

        connect(name, cb) {
            this._signals[name] = this._signals[name] ?? [];
            const id = _nextSigId++;
            this._signals[name].push({id, cb});
            return id;
        }

        connectObject() { return []; }
        disconnect() {}
        disconnectObject() {}
        emit() {}
        get_parent() { return null; }
        get_stage() { return null; }
        get_children() { return []; }
        set_hover() {}
        add_style_class_name() {}
        remove_style_class_name() {}

        set x_expand(v) { this._xExpand = v; }
        get x_expand() { return this._xExpand ?? false; }

        set y_expand(v) { this._yExpand = v; }
        get y_expand() { return this._yExpand ?? false; }

        set y_align(v) { this._yAlign = v; }
        get y_align() { return this._yAlign ?? 0; }
    },
    itemShowLabel() {},
    makeAppIcon() {
        return {
            icon: {setIconSize: () => {}},
            label_actor: null,
            connectObject: () => [],
            updateIconGeometry: () => {},
        };
    },
    getInterestingWindows: () => [],
};
export const AppIconsDecorator = {
    AppIconsDecorator: class {
        constructor() {}
        destroy() {}
    },
};
export const AppSpread = {
    AppSpread: class {
        constructor() {}
        destroy() {}
    },
};
export const BounceAnimation = {
    startBounceAnimation: () => ({isActive: false, stop: () => {}}),
};
export const DockDash = {
    DockDash: class {
        constructor() {
            this._dashSignals = {};
            this._box = {
                get_children: () => [],
                add_child: () => {},
                remove_child: () => {},
                connect: () => _nextSigId++,
                disconnect: () => {},
            };
            this._container = {
                set_width: () => {},
                set_height: () => {},
                get_children: () => [],
                connect: () => _nextSigId++,
                disconnect: () => {},
            };
            this.showAppsButton = {
                connect: () => _nextSigId++,
                connectObject: () => [],
                disconnect: () => {},
                checked: false,
            };
            this._magnificationEnabled = false;
            this.iconSize = 48;
            this.requiresVisibility = false;
            this.iconAnimator = {start: () => {}, pause: () => {}, destroy: () => {}};
            this._visible = true;
            this._dragInProgress = false;
            this._resetIconsQueuedDuringDrag = false;
        }
        resetAppIcons() {}
        resetAppIconsDebounced() {}
        hideShowAppsButton() {}
        showShowAppsButton() {}
        updateShowAppsButton() {}
        setIconSize() {}
        _queueRedisplay() {}
        getAppIcons() { return []; }
        destroy() {}
        connect(name, cb) {
            this._dashSignals[name] = this._dashSignals[name] ?? [];
            const id = _nextSigId++;
            this._dashSignals[name].push({id, cb});
            return id;
        }
        disconnect() {}
        show() { this._visible = true; }
        hide() { this._visible = false; }
        toggleNumberOverlay() {}
        set visible(v) { this._visible = v; }
        get visible() { return this._visible; }
        set opacity(v) { this._opacity = v; }
        emit(name, ...args) {
            if (!this._dashSignals?.[name]) return;
            for (const s of [...this._dashSignals[name]])
                s.cb(this, ...args);
        }
        get opacity() { return this._opacity ?? 255; }
        set translation_x(v) { this._tx = v; }
        get translation_x() { return this._tx ?? 0; }
        set translation_y(v) { this._ty = v; }
        get translation_y() { return this._ty ?? 0; }
        set width(v) { this._w = v; }
        get width() { return this._w ?? 0; }
        set height(v) { this._h = v; }
        get height() { return this._h ?? 0; }
        set(params) { Object.assign(this, params); }
        ease(params) { Object.assign(this, params); if (params?.onComplete) params.onComplete(); }
        get_parent() { return null; }
        add_child() {}
        remove_child() {}
        emit() {}
        set_clip_to_allocation() {}
        remove_clip() {}
        set_clip() {}
        remove_all_transitions() {}
        set_style() {}
        add_style_class_name() {}
        remove_style_class_name() {}
        has_style_class_name() { return false; }
        get_stage() { return null; }
        get_transformed_position() { return [0, 0]; }
    },
};
export const DBusMenuUtils = {haveDBusMenu: async () => null};
export const DesktopIconsIntegration = {
    DesktopIconsUsableAreaClass: class {
        constructor() {}
        setMargins() {}
        resetMargins() {}
        destroy() {}
    },
};
export const Extension = {};
export const FileManager1API = {
    FileManager1Client: class {
        constructor() {}
        destroy() {}
    },
};
export const Intellihide = {
    Intellihide: class {
        constructor() {
            this._signals = {};
        }
        enable() {}
        disable() {}
        destroy() {}
        forceUpdate() {}
        getOverlapStatus() { return false; }
        updateTargetBox() {}
        connect(name, cb) {
            this._signals[name] = this._signals[name] ?? [];
            const id = _nextSigId++;
            this._signals[name].push({id, cb});
            return id;
        }
        disconnect() {}
        emit(name, ...args) {
            if (!this._signals?.[name]) return;
            for (const s of [...this._signals[name]])
                s.cb(this, ...args);
        }
    },
};
export const LauncherAPI = {
    LauncherEntryRemoteModel: class {
        constructor() {}
        destroy() {}
    },
};
export const Locations = {
    LocationAppInfo: class {},
    Removables: class { constructor() {} destroy() {} },
    Trash: class { constructor() {} destroy() {} },
    CategoryIcon: class { constructor() {} destroy() {} updateConfig() {} },
    generateCategoryId: () => `cat-${_nextSigId++}`,
    getRunningApps: () => [],
    unWrapFileManagerApp: () => {},
    wrapFileManagerApp: () => ({}),
};
export const NotificationsMonitor = {
    NotificationsMonitor: class {
        constructor() { this.dndMode = false; }
        destroy() {}
        connect() { return _nextSigId++; }
        disconnect() {}
        emit() {}
    },
};
export const Theming = {
    PositionStyleClass: {0: 'top', 1: 'right', 2: 'bottom', 3: 'left'},
    ThemeManager: class {
        constructor() {}
        destroy() {}
        connect() { return _nextSigId++; }
        disconnect() {}
    },
};
export const Utils = {
    GlobalSignalsHandler: class {
        constructor(parent) {
            this._parent = parent;
            this._handlers = [];
            this._labels = new Map();
        }
        add(...args) {
            // Handle: add(obj, signal, cb) or add([o,s,c]) or add([o,s,c], [o,s,c], ...)
            const items = [];
            if (args.length >= 3 && !Array.isArray(args[0])) {
                items.push(args);
            } else {
                for (const arg of args) {
                    if (Array.isArray(arg))
                        items.push(arg);
                }
            }
            for (const item of items) {
                if (item.length >= 3) {
                    const obj = item[0];
                    const signal = item[1];
                    const cb = item[2];
                    if (obj && typeof obj.connect === 'function') {
                        const id = obj.connect(signal, cb);
                        this._handlers.push({obj, id, signal});
                    }
                }
            }
        }
        addWithLabel(label, ...args) {
            // Handle multiple array args: addWithLabel(label, [o,s,c], [o,s,c], ...)
            // or single: addWithLabel(label, obj, signal, cb)
            const items = [];
            if (args.length >= 3 && !Array.isArray(args[0])) {
                items.push(args);
            } else {
                for (const arg of args) {
                    if (Array.isArray(arg))
                        items.push(arg);
                }
            }
            for (const item of items) {
                if (item.length >= 3) {
                    const obj = item[0];
                    const signal = item[1];
                    const cb = item[2];
                    if (obj && typeof obj.connect === 'function') {
                        const id = obj.connect(signal, cb);
                        if (!this._labels.has(label))
                            this._labels.set(label, []);
                        this._labels.get(label).push({obj, id, signal});
                        this._handlers.push({obj, id, signal, label});
                    }
                }
            }
        }
        removeWithLabel(label) {
            const items = this._labels.get(label) ?? [];
            for (const {obj, id} of items) {
                if (obj && typeof obj.disconnect === 'function')
                    obj.disconnect(id);
            }
            this._labels.delete(label);
            this._handlers = this._handlers.filter(h => h.label !== label);
        }
        blockWithLabel(_label) {}
        unblockWithLabel(_label) {}
        destroy() {
            for (const {obj, id} of this._handlers) {
                if (obj && typeof obj.disconnect === 'function')
                    obj.disconnect(id);
            }
            this._handlers = [];
            this._labels.clear();
        }
    },
    addActor: (parent, child) => { if (parent?.add_child) parent.add_child(child); },
    getPosition: () => 2, // St.Side.BOTTOM
    getSecondaryPosition: () => 3, // St.Side.TOP
    magnificationFalloff: (distance, spread) => {
        if (spread <= 0)
            return 0.0;
        const normalized = distance / spread;
        return Math.max(0.0, 1.0 - normalized * normalized);
    },
    magnificationScale: (distance, spread, maxScale) => {
        if (spread <= 0)
            return 1.0;
        const normalized = distance / spread;
        const falloff = Math.max(0.0, 1.0 - normalized * normalized);
        return 1.0 + (maxScale - 1.0) * falloff;
    },
    splitHandler: (...fns) => fns,
    supportsExtendedBarriers: () => false,
    laterAdd: (_type, cb) => { if (cb) cb(); return 1; },
    laterRemove: () => {},
    getMonitorManager: () => ({
        get_monitor_for_connector: () => 0,
        connect: () => _nextSigId++,
        disconnect: () => {},
    }),
    shellAppCompare: (a, b) => 0,
    SignalsHandlerFlags: {CONNECT_AFTER: 1},
    InjectionsHandler: class {
        constructor() { this._handlers = []; this._labels = new Map(); }
        add() {}
        addWithLabel() {}
        removeWithLabel() {}
        destroy() {}
    },
    VFuncInjectionsHandler: class {
        constructor() { this._handlers = []; this._labels = new Map(); }
        add() {}
        addWithLabel() {}
        removeWithLabel() {}
        destroy() {}
    },
    PropertyInjectionsHandler: class {
        constructor() { this._handlers = []; this._labels = new Map(); }
        add() {}
        addWithLabel() {}
        removeWithLabel() {}
        destroy() {}
    },
};
export const WindowPreview = {
    WindowPreviewMenu: class {
        constructor() { this.isOpen = false; this.actor = {connect: () => 0, disconnect: () => {}}; }
        popup() {}
        close() {}
        cancelOpen() {}
        enableHover() {}
        disableHover() {}
    },
    WindowPreviewMenuItem: class {
        constructor() {}
        connect() { return 0; }
    },
};
