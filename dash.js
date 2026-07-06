// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: Contributors to Dash 2 X
// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

import {
    Clutter,
    Gio,
    GLib,
    GObject,
    Meta,
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
    Config,
    Util,
} from './dependencies/shell/misc.js';

import {
    AppIcons,
    Docking,
    QuickSettings,
    Theming,
    Utils,
} from './imports.js';

// module "Dash" did not export DASH_ANIMATION_TIME in old versions
// so we just define it like it is defined in Dash;
// taken from https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/dash.js
const DASH_ANIMATION_TIME = Dash.DASH_ANIMATION_TIME ?? 200;
const DASH_VISIBILITY_TIMEOUT = 3;

const Labels = Object.freeze({
    DASH_LEAVE: Symbol('dash-leave'),
    SHOW_MOUNTS: Symbol('show-mounts'),
    FIRST_LAST_CHILD_WORKAROUND: Symbol('first-last-child-workaround'),
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
        if (this.child == null)
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
    },
}, class DockDash extends St.Widget {
    _init(monitorIndex) {
        // Initialize icon variables and size
        super._init({
            name: 'dash',
            offscreen_redirect: Clutter.OffscreenRedirect.ALWAYS,
            layout_manager: new Clutter.BinLayout(),
        });

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
        this._position = Utils.getPosition();
        this._isHorizontal = (this._position === St.Side.TOP) ||
                               (this._position === St.Side.BOTTOM);

        this._dragPlaceholder = null;
        this._dragPlaceholderPos = -1;
        this._animatingPlaceholdersCount = 0;
        this._showLabelTimeoutId = 0;
        this._resetHoverTimeoutId = 0;
        this._labelShowing = false;

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

        // Quick Settings button
        this._quickSettingsButton = new QuickSettings.QuickSettingsButton();
        this._quickSettingsButton.visible = Docking.DockManager.settings.showQuickSettings;
        this._signalsHandler.add(Docking.DockManager.settings,
            'changed::show-quick-settings', () => {
                this._quickSettingsButton.visible =
                    Docking.DockManager.settings.showQuickSettings;
                this._updateQuickSettingsButton();
            });
        this._updateQuickSettingsButton();

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

        this.add_child(this._background);
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
        ]);

        this._signalsHandler.add(this, 'destroy', this._onDestroy.bind(this));
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

    _onDestroy() {
        this.iconAnimator.destroy();

        if (this._quickSettingsButton) {
            this._quickSettingsButton.destroy();
            this._quickSettingsButton = null;
        }

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
        return Dash.Dash.prototype._onItemDragBegin.call(this, ...args);
    }

    _onItemDragCancelled(...args) {
        return Dash.Dash.prototype._onItemDragCancelled.call(this, ...args);
    }

    _onItemDragEnd(...args) {
        return Dash.Dash.prototype._onItemDragEnd.call(this, ...args);
    }

    _endItemDrag(...args) {
        return Dash.Dash.prototype._endItemDrag.call(this, ...args);
    }

    _onItemDragMotion(...args) {
        return Dash.Dash.prototype._onItemDragMotion.call(this, ...args);
    }

    _appIdListToHash(...args) {
        return Dash.Dash.prototype._appIdListToHash.call(this, ...args);
    }

    _queueRedisplay(...args) {
        return Dash.Dash.prototype._queueRedisplay.call(this, ...args);
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
        const app = source?.app ?? source?._delegate?.app;
        if (!app)
            return DND.DragMotionResult.NO_DROP;

        const isCustom = !!app.isCustom;
        // App from CategoryPanel (has _d2dInCategoryId set)
        const inCategoryId = source?._d2dInCategoryId ?? source?._delegate?._d2dInCategoryId;

        if (!isCustom && !inCategoryId) {
            if (app.is_window_backed())
                return DND.DragMotionResult.NO_DROP;
            if (!global.settings.is_writable('favorite-apps'))
                return DND.DragMotionResult.NO_DROP;
        }

        // Convert local coords to stage-space along the dock axis.
        const [dashX, dashY] = this.get_transformed_position();
        const cursor = this._isHorizontal ? dashX + x : dashY + y;

        // Build "clean" children: box contents up to (not including) the
        // separator, with the current placeholder excluded so midpoint
        // calculations aren't distorted by it.
        const children = this._box.get_children();
        const rawSepIdx = this._separator ? children.indexOf(this._separator) : -1;
        const limit = rawSepIdx >= 0 ? rawSepIdx : children.length;

        const clean = [];
        for (let i = 0; i < limit; i++) {
            if (children[i] !== this._dragPlaceholder)
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
            const margin = size * 0.25;

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
            if (itemId) {
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
            this._box.insert_child_at_index(this._dragPlaceholder, insertPos);
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
        return favorites.includes(app) || inCategoryId
            ? DND.DragMotionResult.MOVE_DROP
            : DND.DragMotionResult.COPY_DROP;
    }

    acceptDrop(source, _actor, _x, _y, _time) {
        const app = source?.app ?? source?._delegate?.app;
        if (!app)
            return false;

        const isCustom = !!app.isCustom;
        const inCategoryId = source?._d2dInCategoryId ?? source?._delegate?._d2dInCategoryId;
        const dockManager = Docking.DockManager.getDefault();

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
                dockManager.createUserCategory(appId, targetId, dockInsertIdx);
                const laters = global.compositor.get_laters();
                laters.add(Meta.LaterType.BEFORE_REDRAW, () => {
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
                dockManager.addAppToUserCategory(catId, appId);
                const laters = global.compositor.get_laters();
                laters.add(Meta.LaterType.BEFORE_REDRAW, () => {
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
                if (srcId && tgtId)
                    dockManager.mergeUserCategories(srcId, tgtId);
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
        const catIdSet = new Set(dockManager.categoryIcons.map(ci => ci.config.id));
        const newDockOrder = [];
        for (const child of children) {
            if (child === this._separator)
                break;
            if (child === this._dragPlaceholder) {
                const itemId = isCustom ? app._categoryData?.id : app.get_id?.();
                if (itemId)
                    newDockOrder.push(itemId);
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

            dockManager.setDockOrder(newDockOrder);
            this._clearDragPlaceholder();

            const laters = global.compositor.get_laters();
            laters.add(Meta.LaterType.BEFORE_REDRAW, () => {
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
            dockManager.setDockOrder(newDockOrder);
            this._clearDragPlaceholder();
            this._queueRedisplay();
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
            dockManager.setDockOrder(newDockOrder);
            this._clearDragPlaceholder();
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

        dockManager.setDockOrder(newDockOrder);
        this._clearDragPlaceholder();

        const laters = global.compositor.get_laters();
        laters.add(Meta.LaterType.BEFORE_REDRAW, () => {
            favorites.moveFavoriteToPos(id, favPos);
            return GLib.SOURCE_REMOVE;
        });
        return true;
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

        if (this._isHorizontal) {
            adjustment = this._scrollView.get_hadjustment
                ? this._scrollView.get_hadjustment()
                : this._scrollView.get_hscroll_bar().get_adjustment();
        } else {
            adjustment = this._scrollView.get_vadjustment
                ? this._scrollView.get_vadjustment()
                : this._scrollView.get_vscroll_bar().get_adjustment();
        }

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

        if (appIcon._draggable) {
            appIcon._draggable.connect('drag-begin', () => {
                appIcon.opacity = 50;
                this._clearDropTarget();
            });
            appIcon._draggable.connect('drag-end', () => {
                appIcon.opacity = 255;
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

        if (newIconSize === this.iconSize)
            return;

        const oldIconSize = this.iconSize;
        this.iconSize = newIconSize;
        this.emit('icon-size-changed');

        const scale = oldIconSize / newIconSize;
        for (let i = 0; i < iconChildren.length; i++) {
            const {icon} = iconChildren[i].child._delegate;

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
        const {settings} = dockManager;

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
        let oldApps = [];
        oldItems.forEach(({app}) => {
            if (!oldApps.includes(app))
                oldApps.push(app);
        });

        const newApps = [];
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
                if (showFavorites && !newApps.includes(ciApp))
                    newApps.push(ciApp);
                else if (!showFavorites)
                    newApps.push(ciApp);
                catById.delete(id); // mark as placed
            } else if (remainingFavs.has(id)) {
                // Favorite app
                if (showFavorites)
                    newApps.push(remainingFavs.get(id));
                remainingFavs.delete(id); // mark as placed
            }
            // else: stale entry (app uninstalled / category deleted) -> skip
        }

        // Append favorites not yet in dock-order (newly pinned outside our dock)
        if (showFavorites) {
            for (const app of remainingFavs.values())
                newApps.push(app);
        }

        // Append category icons not yet in dock-order (newly created)
        for (const ci of catById.values()) {
            if (!newApps.includes(ci.getApp()))
                newApps.push(ci.getApp());
        }

        // ── Phase 3: Running non-categorized apps ───────────────────────
        // Preserve order from oldApps, append new ones.
        const runningCat = []; // categorized -> Phase 5

        if (settings.showRunning) {
            oldApps.forEach(oldApp => {
                const index = running.indexOf(oldApp);
                if (index > -1) {
                    const [app] = running.splice(index, 1);
                    const appId = app.get_id();
                    if (categorizedAppIds.has(appId))
                        runningCat.push(app);
                    else if (!showFavorites || !(appId in favorites))
                        newApps.push(app);
                }
            });
            running.forEach(app => {
                const appId = app.get_id();
                if (categorizedAppIds.has(appId))
                    runningCat.push(app);
                else if (!showFavorites || !(appId in favorites))
                    newApps.push(app);
            });
        }

        // ── Phase 4: Removables / Trash ───────────────────────────────
        this._signalsHandler.removeWithLabel(Labels.SHOW_MOUNTS);
        if (dockManager.removables) {
            this._signalsHandler.addWithLabel(Labels.SHOW_MOUNTS,
                dockManager.removables, 'changed', this._queueRedisplay.bind(this));
            dockManager.removables.getApps().forEach(removable => {
                if (!newApps.includes(removable))
                    newApps.push(removable);
            });
        }

        if (dockManager.trash) {
            const trashApp = dockManager.trash.getApp();
            if (!newApps.includes(trashApp))
                newApps.push(trashApp);
        }

        // Filter trash from oldApps to avoid errors if it was removed
        if (dockManager.trash) {
            const trashApp = dockManager.trash.getApp();
            oldApps = oldApps.filter(app => !app.isTrash || app === trashApp);
        } else {
            oldApps = oldApps.filter(app => !app.isTrash);
        }

        // ── Phase 5: Running categorized apps — always at the end ────
        // Transient, no influence on the position of other icons.
        for (const app of runningCat) {
            if (!newApps.includes(app))
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
            actor.child._delegate.app);

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

        /* Update separator for locations */

        // Count location apps among expected items
        const nLocationApps = expectedItems.filter(item =>
            this._isLocationApp(item.app)).length;
        const nRunning = expectedItems.filter(item =>
            !item.isFavorite && !this._isLocationApp(item.app)).length;
        const posLocations = this._box.get_n_children() - nLocationApps;
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
        for (const ci of dockManager.categoryIcons) {
            const categoryApp = ci.getApp();
            const categoryChild = this._box.get_children().find(actor =>
                !removedActors.includes(actor) &&
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
        const notifiedProperties = [];
        const showAppsContainer = settings.showAppsAlwaysInTheEdge || !settings.dockExtended
            ? this._dashContainer : this._boxContainer;
        const needsFirstLastChildWorkaround = Config.PACKAGE_VERSION.split('.')[0] < 49;

        if (needsFirstLastChildWorkaround) {
            this._signalsHandler.addWithLabel(Labels.FIRST_LAST_CHILD_WORKAROUND,
                showAppsContainer, 'notify',
                (_obj, pspec) => notifiedProperties.push(pspec.name));
        }

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

        if (needsFirstLastChildWorkaround) {
            this._signalsHandler.removeWithLabel(Labels.FIRST_LAST_CHILD_WORKAROUND);

            // This is indeed ugly, but we need to ensure that the last and first
            // visible widgets are re-computed by St, that is buggy because of a
            // mutter issue that is being fixed:
            // https://gitlab.gnome.org/GNOME/mutter/-/merge_requests/2047
            if (!notifiedProperties.includes('first-child'))
                showAppsContainer.notify('first-child');
            if (!notifiedProperties.includes('last-child'))
                showAppsContainer.notify('last-child');
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
    // access to scrollView.[hv]scroll was deprecated in gnome 46
    // instead, adjustment can be accessed directly
    // keep old way for backwards compatibility (gnome <= 45)
    const vAdjustment = scrollView.vadjustment ?? scrollView.vscroll.adjustment;
    const hAdjustment = scrollView.hadjustment ?? scrollView.hscroll.adjustment;
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
