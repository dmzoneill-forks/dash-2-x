// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: Contributors to XDock
// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

import {
    Clutter,
    Gio,
    GLib,
    GObject,
    Shell,
    St,
} from './dependencies/gi.js';

import {
    AppFavorites,
    BoxPointer,
    Dash,
    DND,
    Main,
} from './dependencies/shell/ui.js';

import {
    Util,
} from './dependencies/shell/misc.js';

import {
    AppIcons,
    Docking,
    Theming,
    Utils,
} from './imports.js';

let QuickSettings = null;
let WorkspaceMinimap = null;

const {DASH_ANIMATION_TIME} = Dash;
const DASH_VISIBILITY_TIMEOUT = 3;
const DROP_TARGET_MARGIN = 0.25;

const Labels = Object.freeze({
    DASH_LEAVE: Symbol('dash-leave'),
    SHOW_MOUNTS: Symbol('show-mounts'),
    MAGNIFICATION: Symbol('magnification'),
});

// DragPlaceholderItem is not exported by GNOME Shell — define an equivalent locally.
const DragPlaceholderItem = GObject.registerClass(
class DragPlaceholderItem extends Dash.DashItemContainer {
    _init() {
        super._init();
        this.setChild(new St.Bin({style_class: 'placeholder'}));
    }
});

/**
 * Extend DashItemContainer
 *
 * - set label position based on dash orientation
 *
 */
const DockDashItemContainer = GObject.registerClass(
class DockDashItemContainer extends Dash.DashItemContainer {
    _init(position) {
        super._init();

        this.label?.add_style_class_name(Theming.PositionStyleClass[position]);
        if (Docking.DockManager.settings.customThemeShrink)
            this.label?.add_style_class_name('shrink');
    }

    showLabel() {
        return AppIcons.itemShowLabel.call(this);
    }

    // we override the method show taken from:
    // https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/dash.js
    // in order to apply a little modification at the end of the animation
    // which makes sure that the icon background is not blurry
    show(animate) {
        if (this.child === null || this.child === undefined)
            return;

        this.ease({
            scale_x: 1,
            scale_y: 1,
            opacity: 255,
            duration: animate ? DASH_ANIMATION_TIME : 0,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                // Force a re-render to unblur the icon background by
                // toggling hover on and immediately off.  Previously
                // only set_hover(true) was called, which left the icon
                // in hover state and caused neighbouring icons to shift
                // position, producing the visible shake/flicker (#104).
                this.set_hover(true);
                this.set_hover(false);
            },
        });
    }
});

const DockDashIconsVerticalLayout = GObject.registerClass(
    class DockDashIconsVerticalLayout extends Clutter.BoxLayout {
        _init() {
            super._init({
                orientation: Clutter.Orientation.VERTICAL,
            });
        }

        vfunc_get_preferred_height(container, forWidth) {
            const [natHeight] = super.vfunc_get_preferred_height(container, forWidth);
            return [natHeight, 0];
        }
    });


const baseIconSizes = [16, 22, 24, 32, 48, 64, 96, 128];

/**
 * This class is a fork of the upstream dash class (ui.dash.js)
 *
 * Summary of changes:
 * - disconnect global signals adding a destroy method;
 * - play animations even when not in overview mode
 * - set a maximum icon size
 * - show running and/or favorite applications
 * - hide showApps label when the custom menu is shown.
 * - add scrollview
 *   ensure actor is visible on keyfocus inseid the scrollview
 * - add 128px icon size, might be useful for hidpi display
 * - sync minimization application target position.
 * - keep running apps ordered.
 */
export const DockDash = GObject.registerClass({
    Properties: {
        'requires-visibility': GObject.ParamSpec.boolean(
            'requires-visibility', 'requires-visibility', 'requires-visibility',
            GObject.ParamFlags.READWRITE,
            false),
        'max-width': GObject.ParamSpec.int(
            'max-width', 'max-width', 'max-width',
            GObject.ParamFlags.READWRITE,
            -1, GLib.MAXINT32, -1),
        'max-height': GObject.ParamSpec.int(
            'max-height', 'max-height', 'max-height',
            GObject.ParamFlags.READWRITE,
            -1, GLib.MAXINT32, -1),
    },
    Signals: {
        'menu-opened': {},
        'menu-closed': {},
        'icon-size-changed': {},
        'magnification-changed': {param_types: [GObject.TYPE_BOOLEAN]},
    },
}, class DockDash extends St.Widget {
    _init(monitorIndex, isSecondary = false) {
        // Initialize icon variables and size
        super._init({
            name: 'dash',
            offscreen_redirect: Clutter.OffscreenRedirect.ALWAYS,
            layout_manager: new Clutter.BinLayout(),
        });

        this._isSecondary = isSecondary;
        this._maxWidth = -1;
        this._maxHeight = -1;
        this.iconSize = Docking.DockManager.settings.dashMaxIconSize;
        this._availableIconSizes = baseIconSizes;
        this._shownInitially = false;
        this._initializeIconSize(this.iconSize);
        this._signalsHandler = new Utils.GlobalSignalsHandler(this);

        this._separatorFavorites = null;
        this._separatorLocations = null;

        this._monitorIndex = monitorIndex;
        this._position = isSecondary ? Utils.getSecondaryPosition() : Utils.getPosition(this._monitorIndex);
        this._isHorizontal = (this._position === St.Side.TOP) ||
                               (this._position === St.Side.BOTTOM);

        this._dragPlaceholder = null;
        this._dragPlaceholderPos = -1;
        this._animatingPlaceholdersCount = 0;
        this._showLabelTimeoutId = 0;
        this._resetHoverTimeoutId = 0;
        this._labelShowing = false;

        // DnD freeze prevention: track when a drag operation is in progress
        // so we can defer expensive redisplay work until the drag completes.
        this._dragInProgress = false;
        this._redisplayQueuedDuringDrag = false;
        this._resetIconsQueuedDuringDrag = false;

        this._dashContainer = new St.BoxLayout({
            name: 'dashtodockDashContainer',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            vertical: !this._isHorizontal,
            y_expand: this._isHorizontal,
            x_expand: !this._isHorizontal,
        });

        this._scrollView = new St.ScrollView({
            name: 'dashtodockDashScrollview',
            hscrollbar_policy: this._isHorizontal ? St.PolicyType.EXTERNAL : St.PolicyType.NEVER,
            vscrollbar_policy: this._isHorizontal ?  St.PolicyType.NEVER : St.PolicyType.EXTERNAL,
            x_expand: this._isHorizontal,
            y_expand: !this._isHorizontal,
            enable_mouse_scrolling: false,
        });

        this._signalsHandler.add(this._scrollView, 'scroll-event',
            this._onScrollEvent.bind(this));

        this._boxContainer = new St.BoxLayout({
            name: 'dashtodockBoxContainer',
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
            vertical: !this._isHorizontal,
        });
        this._boxContainer.add_style_class_name(Theming.PositionStyleClass[this._position]);

        const rtl = Clutter.get_default_text_direction() === Clutter.TextDirection.RTL;
        this._box = new St.BoxLayout({
            vertical: !this._isHorizontal,
            clip_to_allocation: false,
            ...!this._isHorizontal ? {layout_manager: new DockDashIconsVerticalLayout()} : {},
            x_align: rtl ? Clutter.ActorAlign.END : Clutter.ActorAlign.START,
            y_align: this._isHorizontal ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.START,
            y_expand: !this._isHorizontal,
            x_expand: this._isHorizontal,
        });
        this._box._delegate = this;
        this._boxContainer.add_child(this._box);
        Utils.addActor(this._scrollView, this._boxContainer);
        this._dashContainer.add_child(this._scrollView);

        this._showAppsIcon = new AppIcons.DockShowAppsIcon(this._position);
        this._showAppsIcon.show(false);
        this._showAppsIcon.icon.setIconSize(this.iconSize);
        this._showAppsIcon.x_expand = false;
        this._showAppsIcon.y_expand = false;
        this._signalsHandler.add(this.showAppsButton, 'notify::hover', a => {
            if (this._showAppsIcon.get_parent() === this._boxContainer)
                this._ensureItemVisibility(a);
        });
        if (!this._isHorizontal)
            this._showAppsIcon.y_align = Clutter.ActorAlign.START;
        this._hookUpLabel(this._showAppsIcon);
        this._signalsHandler.add(this._showAppsIcon, 'menu-state-changed',
            (_icon, opened) => {
                this._itemMenuStateChanged(this._showAppsIcon, opened);
            });
        this.updateShowAppsButton();

        // Workspace minimap indicator — lazy-loaded to avoid circular import deadlock
        this._workspaceMinimap = null;
        this._workspaceMinimapContainer = null;
        if (!WorkspaceMinimap) {
            import('./workspaceMinimap.js').then(m => {
                WorkspaceMinimap = m;
                this._updateWorkspaceMinimap();
            }).catch(e => logError(e, 'XDock: Failed to load WorkspaceMinimap'));
        } else {
            this._updateWorkspaceMinimap();
        }
        // Quick Settings button — lazy-loaded to avoid circular import deadlock
        this._quickSettingsButton = null;
        import('./quickSettings.js').then(QS => {
            QuickSettings = QS;
            this._quickSettingsButton = new QuickSettings.QuickSettingsButton();
            this._quickSettingsButton._panel?.setDockPosition(Utils.getPosition(this._monitorIndex));
            this._quickSettingsButton.visible = Docking.DockManager.settings.showQuickSettings;
            this._updateQuickSettingsButton();
        }).catch(e => logError(e, 'XDock: Failed to load QuickSettings'));
        this._signalsHandler.add(Docking.DockManager.settings,
            'changed::show-quick-settings', () => {
                if (this._quickSettingsButton) {
                    this._quickSettingsButton.visible =
                        Docking.DockManager.settings.showQuickSettings;
                    this._updateQuickSettingsButton();
                }
            });

        this._background = new St.Widget({
            style_class: 'dash-background',
            y_expand: this._isHorizontal,
            x_expand: !this._isHorizontal,
        });

        const sizerBox = new Clutter.Actor();
        sizerBox.add_constraint(new Clutter.BindConstraint({
            source: this._isHorizontal ? this._showAppsIcon.icon : this._dashContainer,
            coordinate: Clutter.BindCoordinate.HEIGHT,
        }));
        sizerBox.add_constraint(new Clutter.BindConstraint({
            source: this._isHorizontal ? this._dashContainer : this._showAppsIcon.icon,
            coordinate: Clutter.BindCoordinate.WIDTH,
        }));
        this._background.add_child(sizerBox);

        this._reflection = new St.Widget({
            style_class: 'dash-reflection',
            y_expand: false,
            x_expand: false,
            visible: false,
        });
        if (this._isHorizontal) {
            this._reflection.add_constraint(new Clutter.BindConstraint({
                source: this._background,
                coordinate: Clutter.BindCoordinate.WIDTH,
            }));
            this._reflection.height = Docking.DockManager.settings.reflectionSize;
        } else {
            this._reflection.add_constraint(new Clutter.BindConstraint({
                source: this._background,
                coordinate: Clutter.BindCoordinate.HEIGHT,
            }));
            this._reflection.width = Docking.DockManager.settings.reflectionSize;
        }

        this.add_child(this._background);
        this.add_child(this._reflection);
        this.add_child(this._dashContainer);

        this._workId = Main.initializeDeferredWork(this._box, this._redisplay.bind(this));

        this._shellSettings = new Gio.Settings({
            schema_id: 'org.gnome.shell',
        });

        this._appSystem = Shell.AppSystem.get_default();

        this.iconAnimator = new Docking.IconAnimator(this);

        this._signalsHandler.add([
            this._appSystem,
            'installed-changed',
            () => {
                AppFavorites.getAppFavorites().reload();
                this._queueRedisplay();
            },
        ], [
            AppFavorites.getAppFavorites(),
            'changed',
            this._queueRedisplay.bind(this),
        ], [
            this._appSystem,
            'app-state-changed',
            this._queueRedisplay.bind(this),
        ], [
            Main.overview,
            'item-drag-begin',
            this._onItemDragBegin.bind(this),
        ], [
            Main.overview,
            'item-drag-end',
            this._onItemDragEnd.bind(this),
        ], [
            Main.overview,
            'item-drag-cancelled',
            this._onItemDragCancelled.bind(this),
        ], [
            Main.overview,
            'window-drag-begin',
            this._onWindowDragBegin.bind(this),
        ], [
            Main.overview,
            'window-drag-cancelled',
            this._onWindowDragEnd.bind(this),
        ], [
            Main.overview,
            'window-drag-end',
            this._onWindowDragEnd.bind(this),
        ], [
            Docking.DockManager.settings,
            'changed::show-previews-hover',
            this._togglePreviewHover.bind(this),
        ], [
            Docking.DockManager.settings,
            'changed::show-workspace-minimap',
            this._updateWorkspaceMinimap.bind(this),
        ], [
            Docking.DockManager.settings,
            'changed::workspace-minimap-position',
            this._updateWorkspaceMinimap.bind(this),
        ], [
            Docking.DockManager.settings,
            'changed::icon-magnification',
            this._toggleMagnification.bind(this),
        ], [
            Docking.DockManager.settings,
            'changed::icon-magnification-factor',
            this._toggleMagnification.bind(this),
        ], [
            Docking.DockManager.settings,
            'changed::icon-magnification-all',
            () => this._resetMagnification(true),
        ]);

        this._signalsHandler.add([
            Docking.DockManager.settings,
            'changed::dock-style',
            this._updateReflection.bind(this),
        ], [
            Docking.DockManager.settings,
            'changed::shelf-reflection',
            this._updateReflection.bind(this),
        ], [
            Docking.DockManager.settings,
            'changed::shelf-reflection-opacity',
            this._updateReflection.bind(this),
        ]);
        this._updateReflection();

        // Initialize magnification if enabled
        this._magnificationEnabled = false;
        this._toggleMagnification();

        this._signalsHandler.add(this, 'destroy', this._onDestroy.bind(this));

        // Wiggle mode: exit when user clicks empty dock area
        this._wiggleClickCaptureId = 0;
        const dockManager = Docking.DockManager.getDefault();
        if (dockManager) {
            this._signalsHandler.add(dockManager, 'wiggle-mode-changed',
                (_dm, active) => this._onWiggleModeChanged(active));
        }
    }

    _onWiggleModeChanged(active) {
        if (active) {
            // Listen for clicks on the background / empty areas of the dash
            this._wiggleClickCaptureId = this._background.connect(
                'button-release-event', () => {
                    Docking.DockManager.getDefault().exitWiggleMode();
                    return Clutter.EVENT_STOP;
                });
        } else if (this._wiggleClickCaptureId) {
            this._background.disconnect(this._wiggleClickCaptureId);
            this._wiggleClickCaptureId = 0;
        }
    }

    vfunc_get_preferred_height(forWidth) {
        const [minHeight, natHeight] = super.vfunc_get_preferred_height.call(this, forWidth);
        if (!this._isHorizontal && this._maxHeight !== -1 && natHeight > this._maxHeight)
            return [minHeight, this._maxHeight];
        else
            return [minHeight, natHeight];
    }

    vfunc_get_preferred_width(forHeight) {
        const [minWidth, natWidth] = super.vfunc_get_preferred_width.call(this, forHeight);
        if (this._isHorizontal && this._maxWidth !== -1 && natWidth > this._maxWidth)
            return [minWidth, this._maxWidth];
        else
            return [minWidth, natWidth];
    }

    get _container() {
        return this._dashContainer;
    }

    /**
     * Create, destroy, or reposition the workspace minimap based on
     * the current settings.
     */
    _updateReflection() {
        const {settings} = Docking.DockManager;
        const visible = settings.dockStyle === 1 && settings.shelfReflection;
        this._reflection.visible = visible;
        if (visible) {
            const op = settings.shelfReflectionOpacity;
            const dir = this._isHorizontal ? 'to bottom' : 'to right';
            this._reflection.set_style(
                `background-image: linear-gradient(${dir}, ` +
                `rgba(255,255,255,${op}) 0%, transparent 100%); ` +
                'border-radius: 0 0 12px 12px;');
        } else {
            this._reflection.set_style(null);
        }
    }

    _updateWorkspaceMinimap() {
        const {settings} = Docking.DockManager;
        const enabled = settings.showWorkspaceMinimap;

        // Tear down existing minimap
        if (this._workspaceMinimapContainer) {
            this._workspaceMinimapContainer.destroy();
            this._workspaceMinimapContainer = null;
            this._workspaceMinimap = null;
        }

        if (!enabled)
            return;

        // Create the minimap and wrap it in a DockDashItemContainer
        this._workspaceMinimap = new WorkspaceMinimap.WorkspaceMinimap();
        this._workspaceMinimapContainer = new DockDashItemContainer(this._position);
        this._workspaceMinimapContainer.setChild(this._workspaceMinimap);
        this._workspaceMinimapContainer.show(false);

        // Place at start or end of the box container
        const atStart = settings.workspaceMinimapPosition === 'start';
        if (atStart)
            this._boxContainer.insert_child_below(this._workspaceMinimapContainer, null);
        else
            this._boxContainer.insert_child_above(this._workspaceMinimapContainer, null);
    }

    _onDestroy() {
        // Clean up wiggle mode listener
        if (this._wiggleClickCaptureId) {
            this._background.disconnect(this._wiggleClickCaptureId);
            this._wiggleClickCaptureId = 0;
        }

        this.iconAnimator.destroy();
        this._disableMagnification();

        if (this._quickSettingsButton) {
            this._quickSettingsButton.destroy();
            this._quickSettingsButton = null;
        }

        if (this._redisplayDebounceId) {
            GLib.source_remove(this._redisplayDebounceId);
            this._redisplayDebounceId = 0;
        }

        if (this._resetIconsDebounceId) {
            GLib.source_remove(this._resetIconsDebounceId);
            this._resetIconsDebounceId = 0;
        }
        this._cancelDragToFocus();

        if (this._requiresVisibilityTimeout) {
            GLib.source_remove(this._requiresVisibilityTimeout);
            delete this._requiresVisibilityTimeout;
        }

        if (this._ensureActorVisibilityTimeoutId) {
            GLib.source_remove(this._ensureActorVisibilityTimeoutId);
            delete this._ensureActorVisibilityTimeoutId;
        }
    }


    _onItemDragBegin(...args) {
        this._dragInProgress = true;
        return Dash.Dash.prototype._onItemDragBegin.call(this, ...args);
    }

    _onItemDragCancelled(...args) {
        return Dash.Dash.prototype._onItemDragCancelled.call(this, ...args);
    }

    _onItemDragEnd(...args) {
        this._cancelDragToFocus();
        return Dash.Dash.prototype._onItemDragEnd.call(this, ...args);
    }

    _endItemDrag(...args) {
        this._cancelDragToFocus();
        const result = Dash.Dash.prototype._endItemDrag.call(this, ...args);
        this._dragInProgress = false;
        this._flushDeferredDragWork();
        return result;
    }

    /**
     * Flush any redisplay or icon-reset work that was deferred while a
     * drag-and-drop operation was in progress.  Called once the DnD
     * operation completes so the dock updates without blocking the
     * compositor during the drag.
     */
    _flushDeferredDragWork() {
        const dockManager = Docking.DockManager.getDefault();
        if (!dockManager)
            return;

        // Flush pending _ensureLocations (from user-categories changes)
        if (dockManager._ensureLocationsPending) {
            dockManager._ensureLocationsPending = false;
            dockManager._ensureLocations();
        }

        // Flush any pending dock-order sync that was deferred during drag
        if (dockManager._dockOrderSyncPending) {
            dockManager._dockOrderSyncPending = false;
            dockManager._syncDockOrderWithFavorites();
        }

        if (this._resetIconsQueuedDuringDrag) {
            this._resetIconsQueuedDuringDrag = false;
            this._redisplayQueuedDuringDrag = false;
            this.resetAppIcons();
        } else if (this._redisplayQueuedDuringDrag) {
            this._redisplayQueuedDuringDrag = false;
            this._queueRedisplay();
        }
    }

    _onItemDragMotion(...args) {
        return Dash.Dash.prototype._onItemDragMotion.call(this, ...args);
    }

    _appIdListToHash(...args) {
        return Dash.Dash.prototype._appIdListToHash.call(this, ...args);
    }

    _queueRedisplay(...args) {
        if (this._redisplayDebounceId)
            return;

        this._redisplayDebounceId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, 100, () => {
                this._redisplayDebounceId = 0;
                Dash.Dash.prototype._queueRedisplay.call(this, ...args);
                return GLib.SOURCE_REMOVE;
            });
        if (this._dragInProgress) {
            this._redisplayQueuedDuringDrag = true;
            return;
        }
        Dash.Dash.prototype._queueRedisplay.call(this, ...args);
    }

    _hookUpLabel(...args) {
        return Dash.Dash.prototype._hookUpLabel.call(this, ...args);
    }

    _syncLabel(...args) {
        return Dash.Dash.prototype._syncLabel.call(this, ...args);
    }

    _clearEmptyDropTarget(...args) {
        this._clearDropTarget();
        return Dash.Dash.prototype._clearEmptyDropTarget.call(this, ...args);
    }

    handleDragOver(source, actor, x, y, _time) {
        // Secondary docks don't support drag-and-drop reordering
        if (this._isSecondary)
            return DND.DragMotionResult.NO_DROP;

        const app = source?.app ?? source?._delegate?.app;
        if (!app) {
            // External drag (e.g. file from Nautilus) — check if hovering
            // over an app icon and focus its window after a short delay.
            this._handleExternalDragOver(x, y);
            return DND.DragMotionResult.NO_DROP;
        }

        // Cancel any pending drag-to-focus when handling a dock icon drag
        this._cancelDragToFocus();

        const isCustom = !!app.isCustom;
        // App from CategoryPanel (has _d2dInCategoryId set)
        const inCategoryId = source?._d2dInCategoryId ?? source?._delegate?._d2dInCategoryId;

        if (!isCustom && !inCategoryId) {
            if (app.is_window_backed())
                return DND.DragMotionResult.NO_DROP;
            // Only require writable favorite-apps for apps that would be
            // pinned.  Running (non-favorite) apps can always be reordered
            // visually via dock-order without touching favorites (#2475).
            const srcIsFav = app.get_id?.() in
                AppFavorites.getAppFavorites().getFavoriteMap();
            if (srcIsFav && !global.settings.is_writable('favorite-apps'))
                return DND.DragMotionResult.NO_DROP;
        }

        // Convert local coords to stage-space along the dock axis.
        const [dashX, dashY] = this.get_transformed_position();
        const cursor = this._isHorizontal ? dashX + x : dashY + y;

        // Build "clean" children with the current placeholder excluded so
        // midpoint calculations aren't distorted by it.
        // For favorites / categories / category-panel drops, stop at the
        // separator so that drops are constrained to the pinned section.
        // For running (non-favorite) apps, include children after the
        // separator so they can be reordered among other running apps (#2475).
        const srcIsDragRunning = !isCustom && !inCategoryId &&
            !(app.get_id?.() in AppFavorites.getAppFavorites().getFavoriteMap());

        const children = this._box.get_children();
        const rawSepIdx = this._separator ? children.indexOf(this._separator) : -1;
        const limit = rawSepIdx >= 0 && !srcIsDragRunning
            ? rawSepIdx : children.length;

        const clean = [];
        for (let i = 0; i < limit; i++) {
            if (children[i] !== this._dragPlaceholder &&
                children[i] !== this._separator)
                clean.push(children[i]);
        }

        // ── "Drop on Icon" detection ──────────────────────────────────────
        // If the cursor is in the middle 50% zone of an icon AND there is
        // a valid merge target, show a drop-target highlight.
        let dropTarget = null;
        for (let i = 0; i < clean.length; i++) {
            const [cx, cy] = clean[i].get_transformed_position();
            const [cw, ch] = clean[i].get_transformed_size();
            const start = this._isHorizontal ? cx : cy;
            const size = this._isHorizontal ? cw : ch;
            const margin = size * DROP_TARGET_MARGIN;

            if (cursor >= start + margin && cursor <= start + size - margin) {
                const childApp = clean[i].child?._delegate?.app;
                if (!childApp || childApp === app)
                    break;
                const childIsCustom = !!childApp.isCustom;

                // Valid targets:
                // Regular -> Regular: new category
                // Regular -> Category: add app to category
                // Category -> Category: merge categories
                const isMergeTarget = !inCategoryId && (!isCustom || childIsCustom);
                if (isMergeTarget)
                    dropTarget = clean[i];
                break;
            }
        }

        // Update drop-target highlight
        if (dropTarget !== this._dropTargetIcon) {
            if (this._dropTargetIcon)
                this._dropTargetIcon.child?.remove_style_class_name('drop-target');
            this._dropTargetIcon = dropTarget;
            if (this._dropTargetIcon)
                this._dropTargetIcon.child?.add_style_class_name('drop-target');
        }

        // If drop target is active -> no placeholder
        if (this._dropTargetIcon) {
            this._clearDragPlaceholder();
            return isCustom ? DND.DragMotionResult.MOVE_DROP : DND.DragMotionResult.COPY_DROP;
        }
        // ─────────────────────────────────────────────────────────────────

        // Determine insertion index using midpoints
        const rtl = Clutter.get_default_text_direction() === Clutter.TextDirection.RTL;
        let insertPos = clean.length;
        for (let i = 0; i < clean.length; i++) {
            const [cx, cy] = clean[i].get_transformed_position();
            const [cw, ch] = clean[i].get_transformed_size();
            const mid = this._isHorizontal ? cx + cw / 2 : cy + ch / 2;
            // In RTL horizontal mode, icons are laid out right-to-left,
            // so cursor > mid means "before this icon". In vertical mode
            // or LTR, cursor <= mid means "before this icon".
            const beforeIcon = rtl && this._isHorizontal
                ? cursor > mid
                : cursor <= mid;
            if (beforeIcon) {
                insertPos = i;
                break;
            }
        }

        // Suppress placeholder when the item would stay at its current dock-order position.
        if (!inCategoryId) {
            const dockManager = Docking.DockManager.getDefault();
            const itemId = isCustom ? app._categoryData?.id : app.get_id?.();
            if (dockManager && itemId) {
                const dockOrder = dockManager.getDockOrder();
                const currentOrderPos = dockOrder.indexOf(itemId);
                if (currentOrderPos >= 0) {
                    let itemsBefore = 0;
                    for (let i = 0; i < insertPos; i++) {
                        const ca = clean[i].child?._delegate?.app;
                        if (!ca || ca === app || ca._d2dIsTransient)
                            continue;
                        itemsBefore++;
                    }
                    if (itemsBefore === currentOrderPos) {
                        this._clearDragPlaceholder();
                        return isCustom
                            ? DND.DragMotionResult.MOVE_DROP
                            : DND.DragMotionResult.CONTINUE;
                    }
                }
            }
        }

        // Create placeholder on first drag event.
        let animate = false;
        if (!this._dragPlaceholder) {
            this._dragPlaceholder = new DragPlaceholderItem();
            this._dragPlaceholderPos = -1;
            animate = true;
        }

        // Placeholder dimensions match orientation.
        if (this._isHorizontal) {
            this._dragPlaceholder.child.set_width(this.iconSize / 2);
            this._dragPlaceholder.child.set_height(this.iconSize);
        } else {
            this._dragPlaceholder.child.set_width(this.iconSize);
            this._dragPlaceholder.child.set_height(this.iconSize / 2);
        }

        // Move placeholder only when position changed or it isn't in the box yet.
        if (insertPos !== this._dragPlaceholderPos || !this._box.contains(this._dragPlaceholder)) {
            this._dragPlaceholderPos = insertPos;
            if (this._box.contains(this._dragPlaceholder))
                this._box.remove_child(this._dragPlaceholder);

            // insertPos is relative to `clean` (which excludes the
            // placeholder and, for running-app drags, the separator).
            // Map it back to an absolute box index so the separator
            // isn't displaced (#2475).
            let boxIdx = insertPos;
            if (srcIsDragRunning && rawSepIdx >= 0) {
                // After removing the placeholder the separator sits at
                // its original index (or one less if the placeholder was
                // before it).  Count how many clean items sit before the
                // separator to find the split point.
                const boxChildren = this._box.get_children();
                const sepBoxIdx = boxChildren.indexOf(this._separator);
                if (sepBoxIdx >= 0) {
                    // cleanBefore = number of clean items before the separator
                    let cleanBefore = 0;
                    for (let i = 0; i < sepBoxIdx; i++) {
                        if (boxChildren[i] !== this._dragPlaceholder &&
                            boxChildren[i] !== this._separator)
                            cleanBefore++;
                    }
                    if (insertPos > cleanBefore)
                        boxIdx = insertPos + 1; // skip over the separator
                }
            }

            this._box.insert_child_at_index(this._dragPlaceholder, boxIdx);
            if (animate)
                this._dragPlaceholder.show(true);
        }

        // Keep the icons adjacent to the placeholder visible in the scroll view.
        const curr = this._box.get_children();
        const phIdx = curr.indexOf(this._dragPlaceholder);
        if (phIdx > 0)
            ensureActorVisibleInScrollView(this._scrollView, curr[phIdx - 1]);
        if (phIdx >= 0 && phIdx < curr.length - 1)
            ensureActorVisibleInScrollView(this._scrollView, curr[phIdx + 1]);

        if (isCustom)
            return DND.DragMotionResult.MOVE_DROP;

        const favorites = AppFavorites.getAppFavorites().getFavorites();
        // Running apps being reordered among themselves should show MOVE,
        // not COPY (which displays a "+" badge implying pinning) (#2475).
        return favorites.includes(app) || inCategoryId || srcIsDragRunning
            ? DND.DragMotionResult.MOVE_DROP
            : DND.DragMotionResult.COPY_DROP;
    }

    acceptDrop(source, _actor, _x, _y, _time) {
        this._cancelDragToFocus();

        const app = source?.app ?? source?._delegate?.app;
        if (!app)
            return false;

        const isCustom = !!app.isCustom;
        const inCategoryId = source?._d2dInCategoryId ?? source?._delegate?._d2dInCategoryId;
        const dockManager = Docking.DockManager.getDefault();
        if (!dockManager)
            return false;

        // Categorized running apps cannot be repositioned via D&D
        if (!isCustom && !inCategoryId) {
            const dragAppId = app.get_id?.();
            if (dragAppId && (dockManager.getCategorizedAppIds?.() ?? new Set()).has(dragAppId)) {
                this._clearDragPlaceholder();
                this._clearDropTarget();
                return false;
            }
        }

        // ── Drop on Icon (create / extend / merge category) ──
        if (this._dropTargetIcon) {
            const targetApp = this._dropTargetIcon.child?._delegate?.app;
            this._dropTargetIcon.child?.remove_style_class_name('drop-target');

            // dock-order insert index = visual position of the drop target
            const allChildren = this._box.get_children();
            let dockInsertIdx = 0;
            for (const child of allChildren) {
                if (child === this._dropTargetIcon)
                    break;
                const ca = child.child?._delegate?.app;
                if (ca && !ca._d2dIsTransient)
                    dockInsertIdx++;
            }
            this._dropTargetIcon = null;
            this._clearDragPlaceholder();

            if (!targetApp)
                return false;
            const targetIsCustom = !!targetApp.isCustom;
            const appId = app.get_id?.();

            if (!isCustom && !targetIsCustom && appId) {
                // Regular + Regular -> create new category
                const targetId = targetApp.get_id?.();
                if (!targetId)
                    return false;
                // Defer all GSettings writes to an idle callback to avoid
                // cascading signal storms that freeze the compositor (#37).
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    dockManager.createUserCategory(appId, targetId, dockInsertIdx);
                    const favs = AppFavorites.getAppFavorites();
                    if (appId in favs.getFavoriteMap())
                        favs.removeFavorite(appId);
                    if (targetId in favs.getFavoriteMap())
                        favs.removeFavorite(targetId);
                    return GLib.SOURCE_REMOVE;
                });
                return true;
            } else if (!isCustom && targetIsCustom && appId) {
                // Regular + Category -> add app to category
                const catId = targetApp._categoryData?.id;
                if (!catId)
                    return false;
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    dockManager.addAppToUserCategory(catId, appId);
                    const favs = AppFavorites.getAppFavorites();
                    if (appId in favs.getFavoriteMap())
                        favs.removeFavorite(appId);
                    return GLib.SOURCE_REMOVE;
                });
                return true;
            } else if (isCustom && targetIsCustom) {
                // Category + Category -> merge
                const srcId = app._categoryData?.id;
                const tgtId = targetApp._categoryData?.id;
                if (srcId && tgtId) {
                    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        dockManager.mergeUserCategories(srcId, tgtId);
                        return GLib.SOURCE_REMOVE;
                    });
                }
                return true;
            }

            return false;
        }

        if (!this._dragPlaceholder)
            return false;

        const children = this._box.get_children();
        if (children.indexOf(this._dragPlaceholder) === -1)
            return false;

        // ── Build new dock-order from visual order ────────────────────────
        // When reordering a running (non-favorite) app, include children
        // after the separator so the running section is part of the order
        // (#2475).  For favorites / categories, stop at the separator.
        const dragAppId = isCustom ? app._categoryData?.id : app.get_id?.();
        const dragSrcIsFav = !isCustom && !inCategoryId &&
            dragAppId && dragAppId in AppFavorites.getAppFavorites().getFavoriteMap();
        const includeRunning = !isCustom && !inCategoryId && !dragSrcIsFav;

        const catIdSet = new Set(dockManager.categoryIcons.map(ci => ci.config.id));
        const newDockOrder = [];
        for (const child of children) {
            if (child === this._separator) {
                if (!includeRunning)
                    break;
                continue; // skip the separator actor itself
            }
            if (child === this._dragPlaceholder) {
                if (dragAppId)
                    newDockOrder.push(dragAppId);
            } else {
                const childApp = child.child?._delegate?.app;
                if (!childApp || childApp === app || childApp._d2dIsTransient)
                    continue;
                const itemId = childApp.isCustom
                    ? childApp._categoryData?.id
                    : childApp.get_id?.();
                if (itemId)
                    newDockOrder.push(itemId);
            }
        }

        // ── Drop from CategoryPanel (pull app out) ─────────────────────
        if (inCategoryId) {
            const appId = app.get_id?.();
            if (!appId) {
                this._clearDragPlaceholder();
                return false;
            }

            // favPos = number of non-category entries before appId in new order
            let favPos = 0;
            for (const id of newDockOrder) {
                if (id === appId)
                    break;
                if (!catIdSet.has(id))
                    favPos++;
            }

            this._clearDragPlaceholder();

            // Defer GSettings writes to an idle callback (#37).
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                dockManager.setDockOrder(newDockOrder);
                dockManager.removeAppFromUserCategory(inCategoryId, appId);
                const favs = AppFavorites.getAppFavorites();
                if (!(appId in favs.getFavoriteMap()))
                    favs.addFavoriteAtPos(appId, favPos);
                return GLib.SOURCE_REMOVE;
            });
            return true;
        }

        if (isCustom) {
            // ── Category icon repositioning ─────────────────────────────
            this._clearDragPlaceholder();
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                dockManager.setDockOrder(newDockOrder);
                return GLib.SOURCE_REMOVE;
            });
            return true;
        }

        // ── Regular favorite move / add ─────────────────────────────────
        const id = app.get_id?.();
        if (!id || app.is_window_backed())
            return false;

        const favorites = AppFavorites.getAppFavorites();
        const favMap = favorites.getFavoriteMap();
        const srcIsFavorite = id in favMap;

        // If the app is not a favorite (just a running app), only reorder
        // visually via dock-order -- do NOT pin it as a favorite (#72).
        if (!srcIsFavorite) {
            this._clearDragPlaceholder();
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                dockManager.setDockOrder(newDockOrder);
                return GLib.SOURCE_REMOVE;
            });
            return true;
        }

        if (!global.settings.is_writable('favorite-apps'))
            return false;

        // favPos = number of non-category entries before id in new order
        let favPos = 0;
        for (const orderId of newDockOrder) {
            if (orderId === id)
                break;
            if (!catIdSet.has(orderId))
                favPos++;
        }

        this._clearDragPlaceholder();

        // Defer GSettings writes and favorites mutation to an idle
        // callback so the drop handler returns immediately and the
        // compositor can finish the DnD animation without blocking (#37).
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            dockManager.setDockOrder(newDockOrder);
            favorites.moveFavoriteToPos(id, favPos);
            return GLib.SOURCE_REMOVE;
        });
        return true;
    }

    /**
     * Handle external drag (e.g. file from Nautilus) hovering over app icons.
     * After a short delay, focus/raise the app's most recent window so the
     * user can drop the file into it.
     */
    _handleExternalDragOver(x, y) {
        if (!Docking.DockManager.settings.dragToFocus)
            return;

        // Convert local coords to stage-space along the dock axis
        const [dashX, dashY] = this.get_transformed_position();
        const cursorX = dashX + x;
        const cursorY = dashY + y;

        // Find which app icon the cursor is over
        const children = this._box.get_children();
        let hoveredAppIcon = null;
        for (const child of children) {
            if (!child.child?._delegate?.app)
                continue;
            const [cx, cy] = child.get_transformed_position();
            const [cw, ch] = child.get_transformed_size();
            if (cursorX >= cx && cursorX <= cx + cw &&
                cursorY >= cy && cursorY <= cy + ch) {
                hoveredAppIcon = child.child._delegate;
                break;
            }
        }

        // If cursor moved to a different icon or left all icons, reset timer
        if (hoveredAppIcon !== this._dragToFocusIcon) {
            this._cancelDragToFocus();
            this._dragToFocusIcon = hoveredAppIcon;

            if (hoveredAppIcon && hoveredAppIcon.running) {
                this._dragToFocusTimeoutId = GLib.timeout_add(
                    GLib.PRIORITY_DEFAULT, 500, () => {
                        this._dragToFocusTimeoutId = 0;
                        if (this._dragToFocusIcon === hoveredAppIcon) {
                            const windows = hoveredAppIcon.getInterestingWindows();
                            if (windows.length > 0) {
                                const window = windows[0];
                                window.activate(global.get_current_time());
                            }
                        }
                        return GLib.SOURCE_REMOVE;
                    });
            }
        }
    }

    /**
     * Cancel any pending drag-to-focus timer.
     */
    _cancelDragToFocus() {
        if (this._dragToFocusTimeoutId) {
            GLib.source_remove(this._dragToFocusTimeoutId);
            this._dragToFocusTimeoutId = 0;
        }
        this._dragToFocusIcon = null;
    }

    _clearDragPlaceholder() {
        if (this._dragPlaceholder) {
            this._dragPlaceholder.animateOutAndDestroy();
            this._dragPlaceholder = null;
        }
        this._dragPlaceholderPos = -1;
    }

    _clearDropTarget() {
        if (this._dropTargetIcon) {
            this._dropTargetIcon.child?.remove_style_class_name('drop-target');
            this._dropTargetIcon = null;
        }
    }

    _onWindowDragBegin(...args) {
        return Dash.Dash.prototype._onWindowDragBegin.call(this, ...args);
    }

    _onWindowDragEnd(...args) {
        this._cancelDragToFocus();
        return Dash.Dash.prototype._onWindowDragEnd.call(this, ...args);
    }

    _onScrollEvent(actor, event) {
        // If scroll is not used because the icon is resized, let the scroll event propagate.
        if (!Docking.DockManager.settings.iconSizeFixed)
            return Clutter.EVENT_PROPAGATE;

        // reset timeout to avid conflicts with the mousehover event
        this._ensureItemVisibility(null);

        // Skip to avoid double events mouse
        if (event.get_scroll_direction() !== Clutter.ScrollDirection.SMOOTH)
            return Clutter.EVENT_STOP;


        let adjustment, delta = 0;

        if (this._isHorizontal)
            adjustment = this._scrollView.get_hadjustment();
        else
            adjustment = this._scrollView.get_vadjustment();

        const increment = adjustment.step_increment;
        const [dx, dy] = event.get_scroll_delta();

        if (this._isHorizontal)
            delta = (Math.abs(dx) > Math.abs(dy) ? dx : dy) * increment;
        else
            delta = dy * increment;

        const value = adjustment.get_value();

        // TODO: Remove this if possible.
        if (Number.isNaN(value))
            adjustment.set_value(delta);
        else
            adjustment.set_value(value + delta);

        return Clutter.EVENT_STOP;
    }

    _ensureItemVisibility(actor) {
        if (actor?.hover) {
            const destroyId =
                actor.connect('destroy', () => this._ensureItemVisibility(null));
            this._ensureActorVisibilityTimeoutId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT, 100, () => {
                    actor.disconnect(destroyId);
                    ensureActorVisibleInScrollView(this._scrollView, actor);
                    this._ensureActorVisibilityTimeoutId = 0;
                    return GLib.SOURCE_REMOVE;
                });
        } else if (this._ensureActorVisibilityTimeoutId) {
            GLib.source_remove(this._ensureActorVisibilityTimeoutId);
            this._ensureActorVisibilityTimeoutId = 0;
        }
    }

    _createAppItem(app, window = null) {
        const appIcon = new AppIcons.makeAppIcon(app, this._monitorIndex, this.iconAnimator, window);
        // Mark: this icon comes from our dock (not from the Gnome Dash/Overview)
        appIcon._d2dFromOurDock = true;

        const DRAG_OPACITY = 50;
        const FULL_OPACITY = 255;
        if (appIcon._draggable) {
            appIcon._draggable.connect('drag-begin', () => {
                appIcon.opacity = DRAG_OPACITY;
                this._clearDropTarget();
            });
            appIcon._draggable.connect('drag-end', () => {
                appIcon.opacity = FULL_OPACITY;
                this._clearDropTarget();
            });
        }

        appIcon.connectObject('menu-state-changed', (_, opened) => {
            this._itemMenuStateChanged(item, opened);
        }, this);

        const item = new DockDashItemContainer(this._position);
        item.setChild(appIcon);

        appIcon.connectObject('notify::hover', a => this._ensureItemVisibility(a), this);
        appIcon.connectObject('clicked', actor => {
            ensureActorVisibleInScrollView(this._scrollView, actor);
        }, this);

        appIcon.connectObject('key-focus-in', actor => {
            const [xShift, yShift] = ensureActorVisibleInScrollView(this._scrollView, actor);

            // This signal is triggered also by mouse click. The popup menu is opened at the original
            // coordinates. Thus correct for the shift which is going to be applied to the scrollview.
            if (appIcon._menu) {
                appIcon._menu._boxPointer.xOffset = -xShift;
                appIcon._menu._boxPointer.yOffset = -yShift;
            }
        }, this);

        appIcon.connectObject('notify::focused', () => {
            const {settings} = Docking.DockManager;
            if (appIcon.focused && settings.scrollToFocusedApplication)
                ensureActorVisibleInScrollView(this._scrollView, item);
        }, this);

        appIcon.connectObject('notify::urgent', () => {
            if (appIcon.urgent) {
                ensureActorVisibleInScrollView(this._scrollView, item);
                if (Docking.DockManager.settings.showDockUrgentNotify)
                    this._requireVisibility();
            }
        }, this);

        // Override default AppIcon label_actor, now the
        // accessible_name is set at DashItemContainer.setLabelText
        appIcon.label_actor = null;
        item.setLabelText(window?.title || app.get_name());
        if (window) {
            const titleChangedId = window.connect('notify::title', () => {
                if (window.get_compositor_private())
                    item.setLabelText(window.title || app.get_name());
                else
                    item.setLabelText(app.get_name());

                appIcon.emit('sync-tooltip');
            });
            item.connect('destroy', () => {
                if (titleChangedId && window)
                    window.disconnect(titleChangedId);
            });
        }

        appIcon.icon.setIconSize(this.iconSize);
        this._hookUpLabel(item, appIcon);

        item.connectObject('notify::position', () => appIcon.updateIconGeometry(), appIcon);
        item.connectObject('notify::size', () => appIcon.updateIconGeometry(), appIcon);

        return item;
    }

    /**
     * Creates an app icon for the Category Panel - without ScrollView-dependent signals.
     * Public method so that locations.js can use it.
     */
    createPanelItem(app) {
        const appIcon = new AppIcons.makeAppIcon(app, this._monitorIndex, this.iconAnimator);

        const item = new DockDashItemContainer(this._position);
        item.setChild(appIcon);

        appIcon.label_actor = null;
        item.setLabelText(app.get_name());
        appIcon.icon.setIconSize(this.iconSize);
        this._hookUpLabel(item, appIcon);

        item.connectObject('notify::position', () => appIcon.updateIconGeometry(), appIcon);
        item.connectObject('notify::size', () => appIcon.updateIconGeometry(), appIcon);

        return item;
    }

    _requireVisibility() {
        this.requiresVisibility = true;

        if (this._requiresVisibilityTimeout)
            GLib.source_remove(this._requiresVisibilityTimeout);

        this._requiresVisibilityTimeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,
            DASH_VISIBILITY_TIMEOUT, () => {
                this._requiresVisibilityTimeout = 0;
                this.requiresVisibility = false;
            });
    }

    /**
     * Return an array with the "proper" appIcons currently in the dash
     */
    getAppIcons() {
        // Only consider children which are "proper"
        // icons (i.e. ignoring drag placeholders) and which are not
        // animating out (which means they will be destroyed at the end of
        // the animation)
        const iconChildren = this._box.get_children().filter(actor => {
            return actor.child &&
                   !!actor.child.icon &&
                   !actor.animatingOut;
        });

        const appIcons = iconChildren.map(actor => {
            return actor.child;
        });

        return appIcons;
    }

    _togglePreviewHover() {
        if (Docking.DockManager.settings.showPreviewsHover)
            this._enableHover();
        else
            this._disableHover();
    }

    _enableHover() {
        const appIcons = this.getAppIcons();
        appIcons.forEach(appIcon => {
            appIcon.enableHover(appIcons);
        });

        // Close all preview menus when mouse leaves the dash
        this._signalsHandler.addWithLabel(Labels.DASH_LEAVE,
            this, 'leave-event', () => {
                // Use a small timeout to allow moving from icon to menu
                if (this._dashLeaveTimeoutId)
                    GLib.source_remove(this._dashLeaveTimeoutId);

                this._dashLeaveTimeoutId = GLib.timeout_add(
                    GLib.PRIORITY_DEFAULT,
                    100,
                    () => {
                        const icons = this.getAppIcons();
                        icons.forEach(appIcon => {
                            if (appIcon._previewMenu?.isOpen) {
                                if (appIcon._previewMenu.fromHover) {
                                    const {_boxPointer} = appIcon._previewMenu;
                                    _boxPointer.close(BoxPointer.PopupAnimation.FADE, () => {
                                        appIcon._previewMenu.actor.hide();
                                        appIcon._previewMenu.isOpen = false;
                                    });
                                } else {
                                    appIcon._previewMenu.close(BoxPointer.PopupAnimation.FADE);
                                }
                            }
                        });
                        this._dashLeaveTimeoutId = null;
                        return GLib.SOURCE_REMOVE;
                    }
                );
            });
    }

    _disableHover() {
        this._signalsHandler.removeWithLabel(Labels.DASH_LEAVE);

        if (this._dashLeaveTimeoutId) {
            GLib.source_remove(this._dashLeaveTimeoutId);
            this._dashLeaveTimeoutId = null;
        }

        const appIcons = this.getAppIcons();
        appIcons.forEach(appIcon => {
            appIcon.disableHover();
        });
    }

    // ── Icon Magnification (parabolic zoom) ──────────────────────────────

    _toggleMagnification() {
        const {settings} = Docking.DockManager;
        if (settings.iconMagnification)
            this._enableMagnification();
        else
            this._disableMagnification();
    }

    _enableMagnification() {
        if (!this._magnificationEnabled) {
            this._magnificationEnabled = true;
            this._dashContainer.reactive = true;

            this._signalsHandler.addWithLabel(Labels.MAGNIFICATION,
                this._dashContainer, 'motion-event',
                this._onMagnificationMotion.bind(this));
            this._signalsHandler.addWithLabel(Labels.MAGNIFICATION,
                this._dashContainer, 'leave-event',
                this._onMagnificationLeave.bind(this));
        }

        this._box.set_clip_to_allocation(false);
        this._dashContainer.set_clip_to_allocation(false);
        this.set_clip_to_allocation(false);
        this.offscreen_redirect = 0;

        // St.BoxLayout extends St.Viewport which defaults clip_to_view
        // to true and re-applies it on every allocation cycle. Use
        // notify::allocation handlers to correct it, deferring the set
        // via idle_add to avoid re-triggering allocation mid-cycle.
        this._box.clip_to_view = false;
        this._dashContainer.clip_to_view = false;
        this._clipViewIdleId = 0;
        const deferClipToViewOff = () => {
            if (this._clipViewIdleId)
                return;
            this._clipViewIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._clipViewIdleId = 0;
                if (!this._magnificationEnabled)
                    return GLib.SOURCE_REMOVE;
                if (this._box.clip_to_view)
                    this._box.clip_to_view = false;
                if (this._dashContainer.clip_to_view)
                    this._dashContainer.clip_to_view = false;
                return GLib.SOURCE_REMOVE;
            });
        };
        this._signalsHandler.addWithLabel(Labels.MAGNIFICATION,
            this._box, 'notify::allocation', deferClipToViewOff);
        this._signalsHandler.addWithLabel(Labels.MAGNIFICATION,
            this._dashContainer, 'notify::allocation', deferClipToViewOff);

        // Reparent the icon box from inside the scrollView (which clips
        // via St.Viewport) to the dashContainer (outside scrollView).
        // This lets magnified icons paint beyond the dock bounds.
        if (this._box.get_parent() === this._boxContainer) {
            this._boxContainer.remove_child(this._box);
            this._dashContainer.insert_child_below(this._box, this._scrollView);
            this._scrollView.hide();

            // Align the box to the dock edge so icons scale away from
            // the edge (upward for bottom dock, etc.).
            if (this._isHorizontal) {
                this._box.y_align = this._position === St.Side.BOTTOM
                    ? Clutter.ActorAlign.END : Clutter.ActorAlign.START;
            } else {
                this._box.x_align = this._position === St.Side.RIGHT
                    ? Clutter.ActorAlign.END : Clutter.ActorAlign.START;
            }
        }

        this.emit('magnification-changed', true);
    }

    _disableMagnification() {
        if (!this._magnificationEnabled)
            return;
        this._magnificationEnabled = false;
        this._dashContainer.reactive = false;

        this._signalsHandler.removeWithLabel(Labels.MAGNIFICATION);
        if (this._clipViewIdleId) {
            GLib.source_remove(this._clipViewIdleId);
            this._clipViewIdleId = 0;
        }
        this._resetMagnification(false);

        this.set_clip_to_allocation(true);
        this.offscreen_redirect = Clutter.OffscreenRedirect.ALWAYS;
        this._box.clip_to_view = true;
        this._dashContainer.clip_to_view = true;

        // Reparent the icon box back into the scrollView.
        if (this._box.get_parent() === this._dashContainer) {
            this._dashContainer.remove_child(this._box);
            this._boxContainer.add_child(this._box);
            this._scrollView.show();

            // Restore original alignment.
            const rtl = Clutter.get_default_text_direction() === Clutter.TextDirection.RTL;
            this._box.x_align = rtl ? Clutter.ActorAlign.END : Clutter.ActorAlign.START;
            this._box.y_align = this._isHorizontal
                ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.START;
        }

        this.emit('magnification-changed', false);
    }

    _getMagnificationPivot() {
        switch (this._position) {
        case St.Side.BOTTOM:
            return [0.5, 1.0];
        case St.Side.TOP:
            return [0.5, 0.0];
        case St.Side.LEFT:
            return [0.0, 0.5];
        case St.Side.RIGHT:
            return [1.0, 0.5];
        default:
            return [0.5, 1.0];
        }
    }

    _getUtilityScalableActor(element) {
        if (!element)
            return null;
        return element.icon?._iconBin ??
               element.icon ??
               element.child ?? element;
    }

    _magnifyUtilityElement(element, cursor, spread, maxScale, pivotX, pivotY) {
        if (!element?.visible || !element.get_stage())
            return;

        const [elX, elY] = element.get_transformed_position();
        const [elW, elH] = element.get_transformed_size();
        const center = this._isHorizontal ? elX + elW / 2 : elY + elH / 2;
        const distance = Math.abs(cursor - center);
        const scale = Utils.magnificationScale(distance, spread, maxScale);

        const icon = this._getUtilityScalableActor(element);
        if (!icon)
            return;
        icon.set_pivot_point(pivotX, pivotY);
        icon.set_easing_duration(Docking.DockManager.settings.magnificationEasingDuration);
        icon.set_easing_mode(Clutter.AnimationMode.EASE_OUT_QUAD);
        icon.set_scale(scale, scale);
    }

    _resetUtilityElement(element, animate) {
        const icon = this._getUtilityScalableActor(element);
        if (!icon)
            return;
        const dur = animate ? 200 : 0;
        icon.set_easing_duration(dur);
        icon.set_easing_mode(Clutter.AnimationMode.EASE_OUT_QUAD);
        icon.set_scale(1.0, 1.0);
    }

    /**
     * Compute and apply parabolic magnification scales based on cursor
     * position along the dock's major axis.
     */
    _onMagnificationMotion(actor, event) {
        const {settings} = Docking.DockManager;
        const maxScale = Math.max(1.0, Math.min(3.0,
            settings.iconMagnificationFactor));

        if (maxScale <= 1.0)
            return Clutter.EVENT_PROPAGATE;

        const [cursorX, cursorY] = event.get_coords();
        const cursor = this._isHorizontal ? cursorX : cursorY;

        const spreadIcons = settings.magnificationSpread;
        const spread = this.iconSize * spreadIcons;
        const [pivotX, pivotY] = this._getMagnificationPivot();

        // Build a flat list of ALL visible dock elements in visual order:
        // show-apps, _box icon children, and utility widgets. This
        // ensures edge widgets translate with the magnification offsets.
        const allChildren = [];
        for (const dc of this._dashContainer.get_children()) {
            if (!dc.visible || !dc.get_stage() || dc === this._scrollView)
                continue;
            if (dc === this._box) {
                for (const bc of this._box.get_children()) {
                    if (!bc.animatingOut)
                        allChildren.push(bc);
                }
            } else {
                allChildren.push(dc);
            }
        }

        if (allChildren.length > 0) {
            const childData = allChildren.map(child => {
                const isAppIcon = !!(child.child && child.child.icon);
                const isInteractive = isAppIcon ||
                    child === this._showAppsIcon ||
                    child === this._workspaceMinimapContainer ||
                    child === this._quickSettingsButton;
                const [childX, childY] = child.get_transformed_position();
                const [childW, childH] = child.get_transformed_size();
                const center = this._isHorizontal
                    ? childX + childW / 2
                    : childY + childH / 2;
                const size = this._isHorizontal ? childW : childH;
                const distance = Math.abs(cursor - center);
                const scale = isInteractive
                    ? Utils.magnificationScale(distance, spread, maxScale)
                    : 1.0;
                const extra = size * (scale - 1.0);
                return {child, scale, extra, isIcon: isAppIcon};
            });

            const totalExtra = childData.reduce((sum, d) => sum + d.extra, 0);
            const centerShift = totalExtra / 2;

            // Compute raw offsets
            let accumulated = 0;
            const offsets = childData.map(d => {
                const o = accumulated - centerShift + d.extra / 2;
                accumulated += d.extra;
                return o;
            });

            // Visually expand the dock background to accommodate the
            // magnified icons by scaling it horizontally from center.
            if (totalExtra > 0 && this._background) {
                const bgW = this._background.width || 1;
                const scaleX = (bgW + totalExtra) / bgW;
                this._background.set_pivot_point(0.5, 0.5);
                this._background.set_easing_duration(settings.magnificationEasingDuration);
                this._background.set_easing_mode(Clutter.AnimationMode.EASE_OUT_QUAD);
                if (this._isHorizontal)
                    this._background.set_scale(scaleX, 1.0);
                else
                    this._background.set_scale(1.0, scaleX);
            }

            for (let i = 0; i < childData.length; i++) {
                const data = childData[i];
                const offset = offsets[i];

                // Scale the icon actor (only for icon children)
                if (data.isIcon) {
                    const icon = data.child.child?.icon?._iconBin ??
                                 data.child.child?.icon ?? data.child.child;
                    if (icon) {
                        icon.set_pivot_point(pivotX, pivotY);
                        icon.set_easing_duration(settings.magnificationEasingDuration);
                        icon.set_easing_mode(Clutter.AnimationMode.EASE_OUT_QUAD);
                        icon.set_scale(data.scale, data.scale);
                    }
                }

                // Z-order: zoomed icons paint on top of neighbours
                data.child.set_z_position(data.scale > 1.0 ? data.scale * 10 : 0);

                // Translate ALL children so separators stay in sync
                data.child.set_easing_duration(settings.magnificationEasingDuration);
                data.child.set_easing_mode(Clutter.AnimationMode.EASE_OUT_QUAD);
                if (this._isHorizontal)
                    data.child.translation_x = offset;
                else
                    data.child.translation_y = offset;
            }
        }

        // Magnify utility elements (workspace minimap, show-apps, quick settings)
        if (settings.iconMagnificationAll) {
            this._magnifyUtilityElement(
                this._workspaceMinimapContainer, cursor, spread, maxScale, pivotX, pivotY);
            this._magnifyUtilityElement(
                this._showAppsIcon, cursor, spread, maxScale, pivotX, pivotY);
            this._magnifyUtilityElement(
                this._quickSettingsButton, cursor, spread, maxScale, pivotX, pivotY);
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _onMagnificationLeave(_actor, _event) {
        this._resetMagnification(true);
        return Clutter.EVENT_PROPAGATE;
    }

    /**
     * Reset all icon scales and translations back to defaults.
     *
     * @param {boolean} animate - whether to animate the transition
     */
    _resetMagnification(animate) {
        const dur = animate ? 200 : 0;

        // Reset all _dashContainer children (app icons + edge widgets)
        for (const dc of this._dashContainer.get_children()) {
            if (dc === this._scrollView)
                continue;
            const children = dc === this._box ? dc.get_children() : [dc];
            for (const child of children) {
                child.set_easing_duration(dur);
                child.set_easing_mode(Clutter.AnimationMode.EASE_OUT_QUAD);
                child.translation_x = 0;
                child.translation_y = 0;
                child.set_z_position(0);

                if (child.child?.icon) {
                    const icon = child.child.icon._iconBin ??
                                 child.child.icon ?? child.child;
                    icon.set_easing_duration(dur);
                    icon.set_easing_mode(Clutter.AnimationMode.EASE_OUT_QUAD);
                    icon.set_scale(1.0, 1.0);
                }
            }
        }

        this._resetUtilityElement(this._workspaceMinimapContainer, animate);
        this._resetUtilityElement(this._showAppsIcon, animate);
        this._resetUtilityElement(this._quickSettingsButton, animate);

        // kept for backward compat with any external callers
        for (const actor of [this._showAppsIcon, this._workspaceMinimapContainer,
            this._quickSettingsButton]) {
            if (!actor?.visible)
                continue;
            actor.set_easing_duration(dur);
            actor.set_easing_mode(Clutter.AnimationMode.EASE_OUT_QUAD);
            actor.translation_x = 0;
            actor.translation_y = 0;
        }

        // Restore background to natural scale
        if (this._background) {
            this._background.set_easing_duration(dur);
            this._background.set_easing_mode(Clutter.AnimationMode.EASE_OUT_QUAD);
            this._background.set_scale(1.0, 1.0);
        }
    }

    _itemMenuStateChanged(item, opened) {
        Dash.Dash.prototype._itemMenuStateChanged.call(this, item, opened);

        if (opened) {
            this.emit('menu-opened');
        } else {
            // I want to listen from outside when a menu is closed. I used to
            // add a custom signal to the appIcon, since gnome 3.8 the signal
            // calling this callback was added upstream.
            this.emit('menu-closed');
        }
    }

    _adjustIconSize() {
        // For the icon size, we only consider children which are "proper"
        // icons (i.e. ignoring drag placeholders) and which are not
        // animating out (which means they will be destroyed at the end of
        // the animation)
        const iconChildren = this._box.get_children().filter(actor => {
            return actor.child &&
                   actor.child._delegate &&
                   actor.child._delegate.icon &&
                   !actor.animatingOut;
        });

        iconChildren.push(this._showAppsIcon);

        if (this._maxWidth === -1 && this._maxHeight === -1)
            return;

        // Check if the container is present in the stage. This avoids critical
        // errors when unlocking the screen
        if (!this._container.get_stage())
            return;

        const themeNode = this._dashContainer.get_theme_node();
        const maxAllocation = new Clutter.ActorBox({
            x1: 0,
            y1: 0,
            x2: this._isHorizontal ? this._maxWidth : 42 /* whatever */,
            y2: this._isHorizontal ? 42 : this._maxHeight,
        });
        const maxContent = themeNode.get_content_box(maxAllocation);
        let availSpace;
        if (this._isHorizontal)
            availSpace = maxContent.get_width();
        else
            availSpace = maxContent.get_height();

        const spacing = themeNode.get_length('spacing');

        const [{child: firstButton}] = iconChildren;
        const {child: firstIcon} = firstButton?.icon ?? {child: null};

        // if no icons there's nothing to adjust
        if (!firstIcon)
            return;

        // Enforce valid spacings during the size request
        firstIcon.ensure_style();
        const [, , iconWidth, iconHeight] = firstIcon.get_preferred_size();
        const [, , buttonWidth, buttonHeight] = firstButton.get_preferred_size();

        if (this._isHorizontal) {
            // Subtract icon padding and box spacing from the available width
            availSpace -= iconChildren.length * (buttonWidth - iconWidth) +
                           (iconChildren.length - 1) * spacing;

            if (this._separatorFavorites) {
                const [, , separatorWidth] = this._separatorFavorites.get_preferred_size();
                availSpace -= separatorWidth + spacing;
            }

            if (this._separatorLocations) {
                const [, , separatorWidth] = this._separatorLocations.get_preferred_size();
                availSpace -= separatorWidth + spacing;
            }
        } else {
            // Subtract icon padding and box spacing from the available height
            availSpace -= iconChildren.length * (buttonHeight - iconHeight) +
                           (iconChildren.length - 1) * spacing;

            if (this._separatorFavorites) {
                const [, , , separatorHeight] = this._separatorFavorites.get_preferred_size();
                availSpace -= separatorHeight + spacing;
            }

            if (this._separatorLocations) {
                const [, , , separatorHeight] = this._separatorLocations.get_preferred_size();
                availSpace -= separatorHeight + spacing;
            }
        }

        const maxIconSize = availSpace / iconChildren.length;
        // NOTE: global scaleFactor; per-monitor scale not yet used here.
        const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);
        const iconSizes = this._availableIconSizes.map(s => s * scaleFactor);

        let [newIconSize] = this._availableIconSizes;
        for (let i = 0; i < iconSizes.length; i++) {
            if (iconSizes[i] <= maxIconSize)
                newIconSize = this._availableIconSizes[i];
        }

        // Guard against oscillation: the available space depends on
        // the current icon's button padding, so switching icon sizes
        // changes available space, potentially flipping back. Verify
        // the new size is stable by recalculating with its padding.
        if (newIconSize !== this.iconSize) {
            const padDiff = this._isHorizontal
                ? buttonWidth - iconWidth
                : buttonHeight - iconHeight;
            const scaledPadDiff = padDiff * (newIconSize / this.iconSize);
            const adjustedAvail = availSpace +
                iconChildren.length * (padDiff - scaledPadDiff);
            const verifyMax = adjustedAvail / iconChildren.length;
            let verifySize = this._availableIconSizes[0];
            for (let i = 0; i < iconSizes.length; i++) {
                if (this._availableIconSizes[i] * scaleFactor <= verifyMax)
                    verifySize = this._availableIconSizes[i];
            }
            if (verifySize !== newIconSize)
                newIconSize = Math.min(newIconSize, verifySize);
        }

        if (newIconSize === this.iconSize)
            return;

        const oldIconSize = this.iconSize;
        this.iconSize = newIconSize;
        this.emit('icon-size-changed');

        const scale = oldIconSize / newIconSize;
        for (let i = 0; i < iconChildren.length; i++) {
            const delegate = iconChildren[i].child?._delegate;
            if (!delegate)
                continue;
            const {icon} = delegate;

            // Set the new size immediately, to keep the icons' sizes
            // in sync with this.iconSize
            icon.setIconSize(this.iconSize);

            // Don't animate the icon size change when the overview
            // is transitioning, not visible or when initially filling
            // the dash
            if (!Main.overview.visible || Main.overview.animationInProgress ||
                !this._shownInitially)
                continue;

            const [targetWidth, targetHeight] = icon.icon.get_size();

            // Scale the icon's texture to the previous size and
            // tween to the new size
            icon.icon.set_size(icon.icon.width * scale,
                icon.icon.height * scale);

            icon.icon.ease({
                width: targetWidth,
                height: targetHeight,
                duration: DASH_ANIMATION_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }

        if (this._separatorFavorites) {
            const animateProperties = this._isHorizontal
                ? {height: this.iconSize} : {width: this.iconSize};

            this._separatorFavorites.ease({
                ...animateProperties,
                duration: DASH_ANIMATION_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }

        if (this._separatorLocations) {
            const animateProperties = this._isHorizontal
                ? {height: this.iconSize} : {width: this.iconSize};

            this._separatorLocations.ease({
                ...animateProperties,
                duration: DASH_ANIMATION_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
    }

    _isLocationApp(app) {
        return app && (app.isTrash || app.isMountableVolume);
    }

    _isPinnedCommandApp(app) {
        return app && app.isPinnedCommand;
    }

    _ensureSeparator(separator, pos) {
        if (!separator) {
            separator = new St.Widget({
                style_class: 'dash-separator',
                x_align: this._isHorizontal
                    ? Clutter.ActorAlign.FILL : Clutter.ActorAlign.CENTER,
                y_align: this._isHorizontal
                    ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.FILL,
                width: this._isHorizontal ? -1 : this.iconSize,
                height: this._isHorizontal ? this.iconSize : -1,
                reactive: true,
                track_hover: true,
            });
            separator.connect('notify::hover', a => this._ensureItemVisibility(a));
        }
        this._box.insert_child_at_index(separator, pos);
        return separator;
    }

    _redisplay() {
        const dockManager = Docking.DockManager.getDefault();
        if (!dockManager)
            return;
        const {settings} = dockManager;

        // Secondary docks show only running (non-favorite) apps
        if (this._isSecondary) {
            this._redisplaySecondary();
            return;
        }

        // Apps that are in a user category are not shown as standalone icons
        const categorizedAppIds = dockManager.getCategorizedAppIds?.() ?? new Set();

        // Copy the favorites map to avoid mutating the internal AppFavorites
        // state. Without this copy, deleting categorized app IDs below would
        // permanently remove entries from the internal favorites, causing
        // running apps to vanish from the dock after unpin operations (#69).
        const favorites = {...AppFavorites.getAppFavorites().getFavoriteMap()};

        // Filter categorized apps out of standalone display
        for (const catId of categorizedAppIds)
            delete favorites[catId];

        let running = this._appSystem.get_running();

        this._scrollView.set({
            xAlign: Clutter.ActorAlign.FILL,
            yAlign: Clutter.ActorAlign.FILL,
        });
        if (dockManager.settings.dockExtended) {
            if (!this._isHorizontal) {
                this._scrollView.yAlign = dockManager.settings.alwaysCenterIcons
                    ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.START;
            } else {
                this._scrollView.xAlign = dockManager.settings.alwaysCenterIcons
                    ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.START;
            }
        }

        if (settings.isolateWorkspaces ||
            settings.isolateMonitors) {
            // When using isolation, we filter out apps that have no windows in
            // the current workspace
            const monitorIndex = this._monitorIndex;
            running = running.filter(app =>
                AppIcons.getInterestingWindows(app.get_windows(), monitorIndex).length);
        }

        const children = this._box.get_children().filter(actor => {
            return actor.child &&
                   actor.child._delegate &&
                   actor.child._delegate.app;
        });
        const oldItems = children.map(actor => actor.child._delegate);
        const oldApps = [];
        oldItems.forEach(({app}) => {
            if (!oldApps.includes(app))
                oldApps.push(app);
        });

        const newAppsSet = new Set();
        const newApps = [];
        const _pushApp = app => {
            newApps.push(app);
            newAppsSet.add(app);
        };
        const {showFavorites} = settings;

        // ── Phase 1+2: Favorites + Category Icons from dock-order ────────
        // dock-order is the single authoritative source for persistent ordering.
        const dockOrder = dockManager.getDockOrder();
        const catById = new Map(dockManager.categoryIcons.map(ci => [ci.config.id, ci]));
        const remainingFavs = new Map(Object.entries(favorites)); // id -> app

        for (const id of dockOrder) {
            if (catById.has(id)) {
                // Category icon
                const ci = catById.get(id);
                const ciApp = ci.getApp();
                if (showFavorites && !newAppsSet.has(ciApp)) {
                    _pushApp(ciApp);
                    newAppsSet.add(ciApp);
                } else if (!showFavorites) {
                    _pushApp(ciApp);
                    newAppsSet.add(ciApp);
                }
                catById.delete(id); // mark as placed
            } else if (remainingFavs.has(id)) {
                // Favorite app
                if (showFavorites)
                    _pushApp(remainingFavs.get(id));
                remainingFavs.delete(id); // mark as placed
            }
            // else: stale entry (app uninstalled / category deleted) -> skip
        }

        // Append favorites not yet in dock-order (newly pinned outside our dock)
        if (showFavorites) {
            for (const app of remainingFavs.values())
                _pushApp(app);
        }

        // Append category icons not yet in dock-order (newly created)
        for (const ci of catById.values()) {
            if (!newAppsSet.has(ci.getApp()))
                _pushApp(ci.getApp());
        }

        // ── Phase 3: Running non-categorized apps ───────────────────────
        // Use dock-order to persist user-defined running app positions
        // (#2475).  Apps not yet in dock-order are appended at the end.
        const runningCat = []; // categorized -> Phase 5

        if (settings.showRunning) {
            // Build a map of eligible running apps (non-categorized,
            // non-favorite) keyed by app ID for quick lookup.
            const runningById = new Map();
            for (const app of running) {
                const appId = app.get_id();
                if (categorizedAppIds.has(appId))
                    runningCat.push(app);
                else if (!showFavorites || !(appId in favorites))
                    runningById.set(appId, app);
            }

            // First pass: add running apps that appear in dock-order,
            // preserving their stored sequence.
            for (const id of dockOrder) {
                if (runningById.has(id)) {
                    _pushApp(runningById.get(id));
                    runningById.delete(id);
                }
            }

            // Second pass: append any remaining running apps not in
            // dock-order (newly launched since last reorder).
            for (const app of runningById.values())
                _pushApp(app);
        }

        // ── Phase 4: Removables / Trash ───────────────────────────────
        // Location apps are placed right after favorites/categories so
        // they maintain a stable position regardless of running app
        // changes (issue #2443).
        this._signalsHandler.removeWithLabel(Labels.SHOW_MOUNTS);
        if (dockManager.removables) {
            this._signalsHandler.addWithLabel(Labels.SHOW_MOUNTS,
                dockManager.removables, 'changed', this._queueRedisplay.bind(this));
            dockManager.removables.getApps().forEach(removable => {
                if (!newAppsSet.has(removable))
                    _pushApp(removable);
            });
        }

        if (dockManager.trash) {
            const trashApp = dockManager.trash.getApp();
            if (!newAppsSet.has(trashApp))
                _pushApp(trashApp);
        }

        // ── Phase 4b: Pinned Commands ────────────────────────────
        if (dockManager.pinnedCommandsManager) {
            this._signalsHandler.addWithLabel(Labels.SHOW_MOUNTS,
                dockManager.pinnedCommandsManager, 'changed',
                this._queueRedisplay.bind(this));
            dockManager.pinnedCommandsManager.getApps().forEach(cmdApp => {
                if (!newAppsSet.has(cmdApp))
                    _pushApp(cmdApp);
            });
        }

        // ── Phase 5: Running categorized apps — always at the end ────
        // Transient, no influence on the position of other icons.
        for (const app of runningCat) {
            if (!newAppsSet.has(app))
                newApps.push(app);
        }

        // Temporary remove the separators so that we don't compute to position icons
        if (this._separatorFavorites)
            this._box.remove_child(this._separatorFavorites);
        if (this._separatorLocations)
            this._box.remove_child(this._separatorLocations);

        // Build expected items with split-window support
        const expectedItems = [];
        const appendAppItems = (app, {isFavorite = false, canSplit = true} = {}) => {
            const windows = canSplit
                ? AppIcons.getInterestingWindows(app.get_windows(), this._monitorIndex)
                    .sort((a, b) => a.get_stable_sequence() - b.get_stable_sequence())
                : [];
            const shouldSplit = !settings.groupApps && canSplit && windows.length > 0;

            if (shouldSplit) {
                windows.forEach(window => {
                    expectedItems.push({app, window, isFavorite});
                });
            } else {
                expectedItems.push({app, window: null, isFavorite});
            }
        };

        for (const app of newApps) {
            const appId = app.get_id?.();
            const isFav = showFavorites && appId && appId in AppFavorites.getAppFavorites().getFavoriteMap();
            appendAppItems(app, {
                isFavorite: isFav,
                canSplit: settings.showRunning,
            });
        }

        // Figure out the actual changes to the list of items
        const addedItems = [];
        const removedActors = [];
        const removedActorsSet = new Set();
        const itemMatches = (delegate, expectedItem) =>
            delegate.app === expectedItem.app &&
            (delegate.window ?? null) === (expectedItem.window ?? null);

        const expectedUsed = new Array(expectedItems.length).fill(false);
        for (let i = children.length - 1; i >= 0; i--) {
            const delegate = children[i].child._delegate;
            const matchIndex = expectedItems.findIndex((expectedItem, idx) =>
                !expectedUsed[idx] && itemMatches(delegate, expectedItem));
            if (matchIndex < 0) {
                removedActors.push(children[i]);
                removedActorsSet.add(children[i]);
            } else {
                expectedUsed[matchIndex] = true;

                // If the matched item is currently animating out from a
                // previous workspace switch, cancel the destruction and
                // re-show it.  Without this, rapidly switching back to a
                // workspace before the disappear animation finishes leaves
                // icons invisible (#96).
                const actor = children[i];
                if (actor.animatingOut) {
                    actor.remove_all_transitions();
                    actor.animatingOut = false;
                    actor.set({
                        scale_x: 1,
                        scale_y: 1,
                        opacity: 255,
                    });
                }
            }
        }

        for (let i = 0; i < removedActors.length; i++) {
            const item = removedActors[i];

            // Don't animate item removal when the overview is transitioning
            // or hidden
            if (!Main.overview.animationInProgress)
                item.animateOutAndDestroy();
            else
                item.destroy();
        }

        // Disable drag and mark as transient for running-categorized app icons
        const runningCatSet = new Set(runningCat);
        for (const {app, item} of addedItems) {
            if (runningCatSet.has(app)) {
                const icon = item.child?._delegate;
                if (icon) {
                    icon._d2dIsTransient = true;
                    if (icon._draggable) {
                        icon._draggable.destroy?.();
                        icon._draggable = null;
                    }
                }
            }
        }

        const currentActors = this._box.get_children().filter(actor =>
            actor.child &&
            actor.child._delegate &&
            actor.child._delegate.app &&
            !actor.animatingOut);

        for (let i = 0; i < expectedItems.length; i++) {
            const expectedItem = expectedItems[i];
            const matchIndex = currentActors.findIndex((actor, idx) =>
                idx >= i && itemMatches(actor.child._delegate, expectedItem));

            if (matchIndex < 0) {
                const item = this._createAppItem(expectedItem.app, expectedItem.window);
                this._box.insert_child_at_index(item, i);
                currentActors.splice(i, 0, item);
                addedItems.push({app: expectedItem.app, item});
            } else if (matchIndex !== i) {
                const [item] = currentActors.splice(matchIndex, 1);
                this._box.remove_child(item);
                this._box.insert_child_at_index(item, i);
                currentActors.splice(i, 0, item);
            }
        }

        // Mark transient icons after item creation
        for (const {app, item} of addedItems) {
            if (runningCatSet.has(app)) {
                const icon = item.child?._delegate;
                if (icon) {
                    icon._d2dIsTransient = true;
                    if (icon._draggable) {
                        icon._draggable.destroy?.();
                        icon._draggable = null;
                    }
                }
            }
        }

        // Refresh window state on surviving (non-new) icons.  When the
        // favorites list changes the icon list is rebuilt, but surviving icons
        // keep their old windowsCount / running state because no
        // 'windows-changed' signal fires.  Calling _updateWindows() here
        // ensures the indicators stay in sync with reality (#2484).
        const addedItemSet = new Set(addedItems.map(({item}) => item));
        for (const actor of currentActors) {
            if (addedItemSet.has(actor))
                continue;
            const delegate = actor.child?._delegate;
            if (delegate && typeof delegate._updateWindows === 'function')
                delegate._updateWindows();
        }

        // Update separator
        const nFavorites = expectedItems.filter(item => item.isFavorite).length;
        const nIcons = currentActors.length;
        if (nFavorites > 0 && nFavorites < nIcons) {
            this._separatorFavorites =
                this._ensureSeparator(this._separatorFavorites, nFavorites);
        } else if (this._separatorFavorites) {
            this._separatorFavorites.destroy();
            this._separatorFavorites = null;
        }

        /* Update separator for locations — placed between location apps
         * and running apps. Location apps sit right after favorites so
         * they keep a stable position (issue #2443). */

        // Count location and pinned-command apps among expected items
        const nLocationApps = expectedItems.filter(item =>
            this._isLocationApp(item.app) || this._isPinnedCommandApp(item.app)).length;
        const nRunning = expectedItems.filter(item =>
            !item.isFavorite && !this._isLocationApp(item.app) &&
            !this._isPinnedCommandApp(item.app)).length;
        // Location apps are after favorites, so separator goes after both.
        // Account for the favorites separator already in the box.
        const posLocations = nFavorites + nLocationApps +
            (this._separatorFavorites ? 1 : 0);
        const isRedudantSeparator = nRunning <= 0;
        if (nLocationApps > 0 && nLocationApps < nIcons && !isRedudantSeparator) {
            this._separatorLocations =
                this._ensureSeparator(this._separatorLocations, posLocations);
        } else if (this._separatorLocations) {
            this._separatorLocations.destroy();
            this._separatorLocations = null;
        }

        this._adjustIconSize();

        // Skip animations on first run when adding the initial set
        // of items, to avoid all items zooming in at once
        const animate = this._shownInitially &&
            !Main.layoutManager._startingUp;

        if (!this._shownInitially)
            this._shownInitially = true;

        addedItems.forEach(({item}) => item.show(animate));

        // ── Category Icons: update sourceActor for panel positioning ──
        const boxChildren = this._box.get_children();
        for (const ci of dockManager.categoryIcons) {
            const categoryApp = ci.getApp();
            const categoryChild = boxChildren.find(actor =>
                !removedActorsSet.has(actor) &&
                actor.child?._delegate?.app === categoryApp);
            if (categoryChild)
                ci._sourceActor = categoryChild;
        }

        // Workaround for https://bugzilla.gnome.org/show_bug.cgi?id=692744
        // Without it, StBoxLayout may use a stale size cache
        this._box.queue_relayout();

        // This will update the size, and the corresponding number for each icon
        this._updateNumberOverlay();

        this.updateShowAppsButton();

        // Connect windows previews to hover events if enabled
        this._togglePreviewHover();
    }

    /**
     * Simplified _redisplay for secondary docks: shows only running apps
     * that are not in the favorites list. No favorites, no categories,
     * no locations, no pinned commands, no show-apps button.
     */
    _redisplaySecondary() {
        const dockManager = Docking.DockManager.getDefault();
        const {settings} = dockManager;

        const favorites = AppFavorites.getAppFavorites().getFavoriteMap();
        let running = this._appSystem.get_running();

        this._scrollView.set({
            xAlign: Clutter.ActorAlign.FILL,
            yAlign: Clutter.ActorAlign.FILL,
        });
        if (dockManager.settings.dockExtended) {
            if (!this._isHorizontal) {
                this._scrollView.yAlign = dockManager.settings.alwaysCenterIcons
                    ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.START;
            } else {
                this._scrollView.xAlign = dockManager.settings.alwaysCenterIcons
                    ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.START;
            }
        }

        if (settings.isolateWorkspaces ||
            settings.isolateMonitors) {
            const monitorIndex = this._monitorIndex;
            running = running.filter(app =>
                AppIcons.getInterestingWindows(app.get_windows(), monitorIndex).length);
        }

        const children = this._box.get_children().filter(actor => {
            return actor.child &&
                   actor.child._delegate &&
                   actor.child._delegate.app;
        });
        const oldItems = children.map(actor => actor.child._delegate);
        const oldApps = [];
        oldItems.forEach(({app}) => {
            if (!oldApps.includes(app))
                oldApps.push(app);
        });

        // Only running apps that are NOT favorites
        const newApps = [];
        const addedRunning = new Set();
        // Preserve order from oldApps for stability
        oldApps.forEach(oldApp => {
            const index = running.indexOf(oldApp);
            if (index > -1) {
                const [app] = running.splice(index, 1);
                const appId = app.get_id();
                if (!(appId in favorites) && !addedRunning.has(appId)) {
                    newApps.push(app);
                    addedRunning.add(appId);
                }
            }
        });
        running.forEach(app => {
            const appId = app.get_id();
            if (!(appId in favorites) && !addedRunning.has(appId)) {
                newApps.push(app);
                addedRunning.add(appId);
            }
        });

        // Remove separators if present
        if (this._separatorFavorites)
            this._box.remove_child(this._separatorFavorites);
        if (this._separatorLocations)
            this._box.remove_child(this._separatorLocations);

        // Build expected items (no split-window in secondary for simplicity)
        const expectedItems = [];
        for (const app of newApps) {
            const windows = !settings.groupApps
                ? AppIcons.getInterestingWindows(app.get_windows(), this._monitorIndex)
                    .sort((a, b) => a.get_stable_sequence() - b.get_stable_sequence())
                : [];
            const shouldSplit = !settings.groupApps && windows.length > 0;
            if (shouldSplit) {
                windows.forEach(window => {
                    expectedItems.push({app, window, isFavorite: false});
                });
            } else {
                expectedItems.push({app, window: null, isFavorite: false});
            }
        }

        // Figure out changes
        const addedItems = [];
        const removedActors = [];
        const itemMatches = (delegate, expectedItem) =>
            delegate.app === expectedItem.app &&
            (delegate.window ?? null) === (expectedItem.window ?? null);

        const expectedUsed = new Array(expectedItems.length).fill(false);
        for (let i = children.length - 1; i >= 0; i--) {
            const delegate = children[i].child._delegate;
            const matchIndex = expectedItems.findIndex((expectedItem, idx) =>
                !expectedUsed[idx] && itemMatches(delegate, expectedItem));
            if (matchIndex < 0) {
                removedActors.push(children[i]);
            } else {
                expectedUsed[matchIndex] = true;
                const actor = children[i];
                if (actor.animatingOut) {
                    actor.remove_all_transitions();
                    actor.animatingOut = false;
                    actor.set({scale_x: 1, scale_y: 1, opacity: 255});
                }
            }
        }

        for (let i = 0; i < removedActors.length; i++) {
            const item = removedActors[i];
            if (!Main.overview.animationInProgress)
                item.animateOutAndDestroy();
            else
                item.destroy();
        }

        const currentActors = this._box.get_children().filter(actor =>
            actor.child && actor.child._delegate && actor.child._delegate.app);

        for (let i = 0; i < expectedItems.length; i++) {
            const expectedItem = expectedItems[i];
            const matchIndex = currentActors.findIndex((actor, idx) =>
                idx >= i && itemMatches(actor.child._delegate, expectedItem));

            if (matchIndex < 0) {
                const item = this._createAppItem(expectedItem.app, expectedItem.window);
                this._box.insert_child_at_index(item, i);
                currentActors.splice(i, 0, item);
                addedItems.push({app: expectedItem.app, item});
            } else if (matchIndex !== i) {
                const [item] = currentActors.splice(matchIndex, 1);
                this._box.remove_child(item);
                this._box.insert_child_at_index(item, i);
                currentActors.splice(i, 0, item);
            }
        }

        // No separators on secondary dock
        if (this._separatorFavorites) {
            this._separatorFavorites.destroy();
            this._separatorFavorites = null;
        }
        if (this._separatorLocations) {
            this._separatorLocations.destroy();
            this._separatorLocations = null;
        }

        this._adjustIconSize();

        const animate = this._shownInitially && !Main.layoutManager._startingUp;
        if (!this._shownInitially)
            this._shownInitially = true;

        addedItems.forEach(({item}) => item.show(animate));
        this._box.queue_relayout();
        this._updateNumberOverlay();
        this._togglePreviewHover();
    }

    _updateNumberOverlay() {
        const appIcons = this.getAppIcons();
        let counter = 1;
        appIcons.forEach(icon => {
            if (counter < 10) {
                icon.setNumberOverlay(counter);
                counter++;
            } else if (counter === 10) {
                icon.setNumberOverlay(0);
                counter++;
            } else {
                // No overlay after 10
                icon.setNumberOverlay(-1);
            }
            icon.updateNumberOverlay();
        });
    }

    toggleNumberOverlay(activate) {
        const appIcons = this.getAppIcons();
        appIcons.forEach(icon => {
            icon.toggleNumberOverlay(activate);
        });
    }

    _initializeIconSize(maxSize) {
        const maxAllowed = baseIconSizes[baseIconSizes.length - 1];
        maxSize = Math.min(maxSize, maxAllowed);

        if (Docking.DockManager.settings.iconSizeFixed) {
            this._availableIconSizes = [maxSize];
        } else {
            this._availableIconSizes = baseIconSizes.filter(val => {
                return val < maxSize;
            });
            this._availableIconSizes.push(maxSize);
        }
    }

    setIconSize(maxSize, doNotAnimate) {
        this._initializeIconSize(maxSize);

        if (doNotAnimate)
            this._shownInitially = false;

        this._queueRedisplay();
    }

    /**
     * Reset the displayed apps icon to maintain the correct order when changing
     * show favorites/show running settings
     */
    resetAppIcons() {
        if (this._dragInProgress) {
            this._resetIconsQueuedDuringDrag = true;
            return;
        }

        const children = this._box.get_children().filter(actor => {
            return actor.child &&
                   !!actor.child.icon;
        });
        for (let i = 0; i < children.length; i++) {
            const item = children[i];
            item.destroy();
        }

        // to avoid ugly animations, just suppress them like when dash is first loaded.
        this._shownInitially = false;
        this._redisplay();
    }

    /**
     * Debounced version of resetAppIcons() for use by theme and icon-theme
     * change signals.  During package updates or extension reloads, these
     * signals can fire many times in rapid succession; coalescing them into
     * a single reset avoids visible icon flashing (#2485).
     */
    resetAppIconsDebounced() {
        if (this._resetIconsDebounceId)
            return;

        this._resetIconsDebounceId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, 200, () => {
                this._resetIconsDebounceId = 0;
                this.resetAppIcons();
                return GLib.SOURCE_REMOVE;
            });
    }

    get showAppsButton() {
        return this._showAppsIcon.toggleButton;
    }

    showShowAppsButton() {
        this._showAppsIcon.visible = true;
        this._showAppsIcon.show(true);
        this.updateShowAppsButton();
    }

    hideShowAppsButton() {
        this._showAppsIcon.visible = false;
    }

    get maxWidth() {
        return this._maxWidth;
    }

    get maxHeight() {
        return this._maxHeight;
    }

    set maxWidth(maxWidth) {
        this.setMaxSize(maxWidth, this._maxHeight);
    }

    set maxHeight(maxHeight) {
        this.setMaxSize(this._maxWidth, maxHeight);
    }

    setMaxSize(maxWidth, maxHeight) {
        if (this._maxWidth === maxWidth &&
            this._maxHeight === maxHeight)
            return;

        this._maxWidth = maxWidth;
        this._maxHeight = maxHeight;
        this._queueRedisplay();
    }

    updateShowAppsButton() {
        if (this._showAppsIcon.get_parent() && !this._showAppsIcon.visible)
            return;

        const {settings} = Docking.DockManager;
        const showAppsContainer = settings.showAppsAlwaysInTheEdge || !settings.dockExtended
            ? this._dashContainer : this._boxContainer;

        if (this._showAppsIcon.get_parent() !== showAppsContainer) {
            this._showAppsIcon.get_parent()?.remove_child(this._showAppsIcon);

            if (Docking.DockManager.settings.showAppsAtTop)
                showAppsContainer.insert_child_below(this._showAppsIcon, null);
            else
                showAppsContainer.insert_child_above(this._showAppsIcon, null);
        } else if (settings.showAppsAtTop) {
            showAppsContainer.set_child_below_sibling(this._showAppsIcon, null);
        } else {
            showAppsContainer.set_child_above_sibling(this._showAppsIcon, null);
        }
    }

    /**
     * Place the quick settings button at the end of the dock
     * (after the show-apps button).
     */
    _updateQuickSettingsButton() {
        if (!this._quickSettingsButton)
            return;

        const {settings} = Docking.DockManager;
        if (!settings.showQuickSettings) {
            if (this._quickSettingsButton.get_parent())
                this._quickSettingsButton.get_parent().remove_child(this._quickSettingsButton);
            return;
        }

        // Put the quick settings button in the same container as show-apps
        const container = settings.showAppsAlwaysInTheEdge || !settings.dockExtended
            ? this._dashContainer : this._boxContainer;

        if (this._quickSettingsButton.get_parent() !== container) {
            this._quickSettingsButton.get_parent()?.remove_child(this._quickSettingsButton);
            // Always place after the show-apps button (at the extreme end)
            if (settings.showAppsAtTop)
                container.insert_child_above(this._quickSettingsButton, null);
            else
                container.insert_child_above(this._quickSettingsButton, null);
        }
    }
});


/**
 * This is a copy of the same function in utils.js, but also adjust horizontal scrolling
 * and perform few further checks on the current value to avoid changing the values when
 * it would be clamp to the current one in any case.
 * Return the amount of shift applied
 *
 * @param scrollView
 * @param actor
 */
function ensureActorVisibleInScrollView(scrollView, actor) {
    const vAdjustment = scrollView.vadjustment;
    const hAdjustment = scrollView.hadjustment;
    const {value: vValue0, pageSize: vPageSize, upper: vUpper} = vAdjustment;
    const {value: hValue0, pageSize: hPageSize, upper: hUpper} = hAdjustment;
    let [hValue, vValue] = [hValue0, vValue0];
    let vOffset = 0;
    let hOffset = 0;

    const fade = scrollView.get_effect('fade');
    if (fade) {
        vOffset = fade.fade_margins.top;
        hOffset = fade.fade_margins.left;
    }

    const box = actor.get_allocation_box();
    let {y1} = box, {y2} = box, {x1} = box, {x2} = box;

    let parent = actor.get_parent();
    while (parent !== scrollView) {
        if (!parent)
            throw new Error('Actor not in scroll view');

        const parentBox = parent.get_allocation_box();
        y1 += parentBox.y1;
        y2 += parentBox.y1;
        x1 += parentBox.x1;
        x2 += parentBox.x1;
        parent = parent.get_parent();
    }

    if (y1 < vValue + vOffset)
        vValue = Math.max(0, y1 - vOffset);
    else if (vValue < vUpper - vPageSize && y2 > vValue + vPageSize - vOffset)
        vValue = Math.min(vUpper - vPageSize, y2 + vOffset - vPageSize);

    if (x1 < hValue + hOffset)
        hValue = Math.max(0, x1 - hOffset);
    else if (hValue < hUpper - hPageSize && x2 > hValue + hPageSize - hOffset)
        hValue = Math.min(hUpper - hPageSize, x2 + hOffset - hPageSize);

    if (vValue !== vValue0) {
        vAdjustment.ease(vValue, {
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            duration: Util.SCROLL_TIME,
        });
    }

    if (hValue !== hValue0) {
        hAdjustment.ease(hValue, {
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            duration: Util.SCROLL_TIME,
        });
    }

    return [hValue - hValue0, vValue - vValue0];
}
