// Mock for ./dependencies/shell/ui.js
// Comprehensive stubs so source files can be imported by Jest.

const _mockActor = () => ({
    add_child: () => {},
    remove_child: () => {},
    get_children: () => [],
    connect: () => 0,
    disconnect: () => {},
    connectObject: () => [],
    disconnectObject: () => {},
    show: () => {},
    hide: () => {},
    destroy: () => {},
    visible: true,
    reactive: false,
    add_style_class_name: () => {},
    remove_style_class_name: () => {},
    ease: (p) => { if (p?.onComplete) p.onComplete(); },
    set_size: () => {},
    set_height: () => {},
    set_width: () => {},
    get_parent: () => null,
    get_stage: () => null,
    queue_relayout: () => {},
    setMaxSize: () => {},
    allocate: () => {},
    get_preferred_height: () => [0, 0],
    get_preferred_width: () => [0, 0],
});

export const Main = {
    layoutManager: {
        _startingUp: false,
        monitors: [{x: 0, y: 0, width: 1920, height: 1080, index: 0, geometry_scale: 1}],
        primaryIndex: 0,
        primaryMonitor: {x: 0, y: 0, width: 1920, height: 1080, index: 0, geometry_scale: 1},
        addChrome: () => {},
        removeChrome: () => {},
        trackChrome: () => {},
        untrackChrome: () => {},
        connect: () => 0,
        disconnect: () => {},
        emit: () => {},
        findIndexForActor: () => 0,
        findMonitorForActor: () => ({x: 0, y: 0, width: 1920, height: 1080}),
        _chrome: {_trackActor: () => {}, _untrackActor: () => {}},
        _queueUpdateRegions: () => {},
        getWorkAreaForMonitor: () => ({x: 0, y: 0, width: 1920, height: 1080}),
        panelBox: _mockActor(),
        overviewGroup: _mockActor(),
        hotCorners: [],
    },
    overview: (() => {
        const signals = {};
        let nextId = 1;
        return {
            visible: false,
            visibleTarget: false,
            isDummy: false,
            dash: _mockActor(),
            hide: () => {},
            show: () => {},
            toggle: () => {},
            connect: (name, cb) => {
                signals[name] = signals[name] ?? [];
                const id = nextId++;
                signals[name].push({id, cb});
                return id;
            },
            disconnect: (id) => {
                for (const name of Object.keys(signals))
                    signals[name] = signals[name].filter(s => s.id !== id);
            },
            emit: (name, ...args) => {
                if (!signals[name]) return;
                for (const s of [...signals[name]])
                    s.cb(...args);
            },
            animationInProgress: false,
        };
    })(),
    panel: {
        height: 32,
        x: 0,
        y: 0,
        connect: () => 0,
        disconnect: () => {},
        statusArea: {},
        menuManager: {activeMenu: null},
    },
    uiGroup: _mockActor(),
    sessionMode: {
        hasOverview: true,
        currentMode: 'user',
        connect: () => 0,
        disconnect: () => {},
    },
    wm: {
        skipNextEffect: () => {},
        allowKeybinding: () => {},
        addKeybinding: () => {},
        removeKeybinding: () => {},
        actionMoveWorkspace: () => {},
        _workspaceSwitcherPopup: null,
        connect: () => 0,
        disconnect: () => {},
    },
    ctrlAltTabManager: {
        addGroup: () => {},
        removeGroup: () => {},
    },
    modalCount: 0,
    pushModal: () => true,
    popModal: () => {},
    activateWindow: () => {},
    initializeDeferredWork: () => 0,
    queueDeferredWork: () => {},
    notify: () => {},
    extensionManager: {
        lookup: () => null,
        connect: () => 0,
        disconnect: () => {},
    },
};

export const Dash = {
    Dash: class {
        constructor() { this._box = _mockActor(); }
        _init() {}
        _createAppItem() { return _mockActor(); }
        _hookUpLabel() {}
        _syncLabel() {}
        _queueRedisplay() {}
        _clearEmptyDropTarget() {}
        _onItemDragBegin() {}
        _onItemDragCancelled() {}
        _onItemDragEnd() {}
        _endItemDrag() {}
        _onItemDragMotion() {}
        _appIdListToHash() { return {}; }
        _onWindowDragBegin() {}
        _onWindowDragEnd() {}
        _itemMenuStateChanged() {}
    },
    DashItemContainer: class DashItemContainer {
        constructor() { this.child = null; this.label = null; }
        _init() {}
        showLabel() {}
        hideLabel() {}
        show() {}
        hide() {}
        setLabelText() {}
        setChild(child) { this.child = child; }
        animateOutAndDestroy() {}
        add_child() {}
        remove_child() {}
        get_children() { return []; }
        get_parent() { return null; }
        get_stage() { return null; }
        connect() { return 0; }
        disconnect() {}
        connectObject() { return []; }
        disconnectObject() {}
        emit() {}
        ease() {}
        set_hover() {}
        add_style_class_name() {}
        remove_style_class_name() {}
        set_easing_duration() {}
        set_easing_mode() {}
        set_scale() {}
        set_pivot_point() {}
        set_z_position() {}
        set translation_x(v) { this._tx = v; }
        get translation_x() { return this._tx ?? 0; }
        set translation_y(v) { this._ty = v; }
        get translation_y() { return this._ty ?? 0; }
    },
    DashIcon: class {
        _init(app) {
            this.app = app;
            this._stateChangedId = 0;
            this._menu = null;
            this._menuManager = {addMenu: () => {}, ignoreRelease: () => {}};
            this._dot = _mockActor();
            this._dot.get_theme_node = () => ({get_length: () => 0});
            this.icon = {
                _iconBin: _mockActor(),
                iconSize: 48,
                update: () => {},
                _createIconTexture: () => {},
            };
            this._iconContainer = _mockActor();
            this._iconContainer.get_preferred_width = () => [0, 48];
            this.label = _mockActor();
            this.label.set_text = () => {};
            this.label.set_width = () => {};
            this.label.get_width = () => 100;
            this.label.get_height = () => 20;
            this.label.clutter_text = {ellipsize: 0};
            this.label.add_style_class_name = () => {};
            this.label.remove_all_transitions = () => {};
            this.label.ease = () => {};
            this._labelText = '';
            this.allocation = {x1: 0, y1: 0, x2: 48, y2: 48};
            this.name = app?.get_name?.() ?? 'Test App';
            // Actor methods
            this._children = [];
            this._signals = {};
            this._styleClasses = new Set();
            this.add_child = function(c) { this._children.push(c); };
            this.remove_child = function(c) { this._children = this._children.filter(x => x !== c); };
            this.add_style_class_name = function(n) { this._styleClasses.add(n); };
            this.remove_style_class_name = function(n) { this._styleClasses.delete(n); };
            this.has_style_class_name = function(n) { return this._styleClasses.has(n); };
            this.get_stage = () => null;
            this.get_transformed_position = () => [0, 0];
            this.get_transformed_size = () => [48, 48];
            let _nextId = 1;
            this.connect = function(name, cb) {
                this._signals[name] = this._signals[name] ?? [];
                const id = _nextId++;
                this._signals[name].push({id, cb});
                return id;
            };
            this.disconnect = function(id) {
                for (const name of Object.keys(this._signals))
                    this._signals[name] = this._signals[name].filter(s => s.id !== id);
            };
            this.emit = function(name, ...args) {
                if (!this._signals?.[name]) return;
                for (const s of this._signals[name])
                    s.cb(this, ...args);
            };
            this.notify = function(prop) { this.emit(`notify::${prop}`); };
            this.set_hover = () => {};
            this.fake_release = () => {};
            this._draggable = null;
        }
        shouldShowTooltip() { return true; }
        _updateRunningStyle() {}
        _onMenuPoppedDown() {}
        activate() {}
        animateLaunch() {}
        getDragActor() { return null; }
        showLabel() {}
        hideLabel() {}
    },
    ShowAppsIcon: class {
        _init() {
            this.toggleButton = _mockActor();
            this.toggleButton.popupMenu = () => {};
            this.toggleButton._setPopupTimeout = () => {};
            this.toggleButton._removeMenuTimeout = () => {};
            this.label = _mockActor();
            this.label.add_style_class_name = () => {};
            this._children = [];
            this._signals = {};
            this._styleClasses = new Set();
            this.add_child = function(c) { this._children.push(c); };
            this.remove_child = function(c) { this._children = this._children.filter(x => x !== c); };
            this.add_style_class_name = function(n) { this._styleClasses.add(n); };
            this.remove_style_class_name = function(n) { this._styleClasses.delete(n); };
            this.has_style_class_name = function(n) { return this._styleClasses.has(n); };
            this.add_action = () => {};
            this.reactive = false;
            let _nextId = 1;
            this.connect = function(name, cb) {
                this._signals[name] = this._signals[name] ?? [];
                const id = _nextId++;
                this._signals[name].push({id, cb});
                return id;
            };
            this.disconnect = function(id) {
                for (const name of Object.keys(this._signals))
                    this._signals[name] = this._signals[name].filter(s => s.id !== id);
            };
            this.emit = function(name, ...args) {
                if (!this._signals?.[name]) return;
                for (const s of this._signals[name])
                    s.cb(this, ...args);
            };
            this.notify = function(prop) { this.emit(`notify::${prop}`); };
        }
        _createIcon() { return _mockActor(); }
    },
    DASH_ANIMATION_TIME: 200,
    DASH_ITEM_LABEL_SHOW_TIME: 150,
};

export const DND = {
    DragMotionResult: {NO_DROP: 0, COPY_DROP: 1, MOVE_DROP: 2, CONTINUE: 3},
    addDragMonitor: () => {},
    removeDragMonitor: () => {},
    makeDraggable: () => ({connect: () => 0, disconnect: () => {}}),
};

export const PopupMenu = {
    PopupMenu: class {
        constructor() { this.actor = _mockActor(); this.box = _mockActor(); this._signals = {}; }
        addMenuItem() {}
        removeAll() {}
        open() {}
        close() {}
        destroy() {}
        connect() { return 0; }
        disconnect() {}
    },
    PopupMenuManager: class {
        constructor() {}
        addMenu() {}
        ignoreRelease() {}
    },
    PopupMenuItem: class {
        constructor(text) { this.label = {set_text() {}, text: text ?? ''}; this._ornament = 0; }
        connect() { return 0; }
        disconnect() {}
        setOrnament(o) { this._ornament = o; }
        setSensitive() {}
    },
    PopupSeparatorMenuItem: class {
        constructor() {}
    },
    PopupSubMenuMenuItem: class {
        constructor() { this.menu = {actor: _mockActor(), addMenuItem() {}, open() {}, close() {}, removeAll() {}, _getMenuItems: () => []}; }
        hide() {}
        show() {}
        setSensitive() {}
    },
    PopupMenuSection: class {
        constructor() { this.actor = _mockActor(); this.box = _mockActor(); this._signals = {}; }
        addMenuItem() {}
        removeAll() {}
        destroy() {}
        connect() { return 0; }
        disconnect() {}
        _getMenuItems() { return []; }
    },
    PopupBaseMenuItem: class {
        constructor() { this.actor = _mockActor(); }
        connect() { return 0; }
        disconnect() {}
        activate() {}
    },
    Ornament: {NONE: 0, DOT: 1, CHECK: 2, HIDDEN: 3},
};

export const AppFavorites = {
    getAppFavorites: () => ({
        getFavoriteMap: () => ({}),
        getFavorites: () => [],
        addFavorite: () => {},
        addFavoriteAtPos: () => {},
        removeFavorite: () => {},
        moveFavoriteToPos: () => {},
        isFavorite: () => false,
        connect: () => 0,
        disconnect: () => {},
        emit: () => {},
    }),
};

export const BoxPointer = {
    PopupAnimation: {NONE: 0, SLIDE: 1, FADE: 2, FULL: 3},
};

export const Layout = {
    MonitorConstraint: class { constructor() {} },
    PressureBarrier: class {
        constructor() { this._isTriggered = false; }
        addBarrier() {}
        removeBarrier() {}
        _reset() {}
        connectObject() { return []; }
        disconnectObject() {}
        destroy() {}
    },
};

export const Overview = {ANIMATION_TIME: 250};

export const OverviewControls = {
    ControlsState: {HIDDEN: 0, WINDOW_PICKER: 1, APP_GRID: 2},
    OverviewAdjustment: class {
        constructor() { this.value = 0; }
    },
};

export const AppDisplay = {
    discreteGpuAvailable: false,
    BaseAppView: class {},
    AppIcon: {
        prototype: {
            vfunc_leave_event: null,
            vfunc_button_press_event: null,
            vfunc_touch_event: null,
            setForcedHighlight: () => {},
            _onMenuPoppedDown: () => {},
            _setPopupTimeout: () => {},
            _removeMenuTimeout: () => {},
            _onKeyboardPopupMenu: () => {},
        },
    },
};

export const AppMenu = {
    AppMenu: class {
        constructor() { this.actor = _mockActor(); }
        open() {}
        close() {}
    },
};

export const PointerWatcher = {
    getPointerWatcher: () => ({
        addWatch: () => ({remove: () => {}}),
        _removeWatch: () => {},
    }),
};

export const SwitcherPopup = {
    SwitcherPopup: class {},
};

export const Workspace = {
    Workspace: class {},
    WorkspaceBackground: class {},
};

export const WorkspacesView = {
    WorkspacesView: class {},
    SecondaryMonitorDisplay: class {},
};

export const WorkspaceSwitcherPopup = {
    WorkspaceSwitcherPopup: class {
        constructor() { this.reactive = true; }
        display() {}
        destroy() {}
        connect(name, cb) { return 0; }
        disconnect() {}
    },
};

export const SearchController = {};
export const ShellMountOperation = {};
export const WorkspaceThumbnail = {};
