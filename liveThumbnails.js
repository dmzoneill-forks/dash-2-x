// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: Contributors to XDock

import {
    Clutter,
    GLib,
    St,
} from './dependencies/gi.js';

import {
    Docking,
    Utils,
} from './imports.js';

const Labels = Object.freeze({
    LIVE_THUMBNAIL: Symbol('live-thumbnail'),
});

/**
 * LiveThumbnailManager
 *
 * Manages a live Clutter.Clone of a running app's most-recent window,
 * scaled to the dock icon size and displayed in place of the static icon.
 *
 * Clutter.Clone automatically mirrors its source texture in real time,
 * so no polling or periodic updates are needed.
 */
export class LiveThumbnailManager {
    constructor(appIcon) {
        this._appIcon = appIcon;
        this._clone = null;
        this._mutterWindow = null;
        this._destroyId = 0;
        this._signalsHandler = new Utils.GlobalSignalsHandler(this._appIcon);
        this._enabled = false;
        this._currentWindow = null;

        // Listen for running-state and focus changes to keep the thumbnail
        // in sync with the most-recently-used window.
        this._signalsHandler.addWithLabel(Labels.LIVE_THUMBNAIL,
            this._appIcon, 'notify::running', () => this._sync());
        this._signalsHandler.addWithLabel(Labels.LIVE_THUMBNAIL,
            this._appIcon, 'notify::focused', () => this._sync());
        this._signalsHandler.addWithLabel(Labels.LIVE_THUMBNAIL,
            this._appIcon.app, 'windows-changed', () => this._sync());

        // Listen for icon-size changes so we can rescale the clone.
        this._signalsHandler.addWithLabel(Labels.LIVE_THUMBNAIL,
            this._appIcon._iconContainer, 'notify::size', () => this._updateCloneSize());

        // When the setting is toggled, resync.
        this._signalsHandler.addWithLabel(Labels.LIVE_THUMBNAIL,
            Docking.DockManager.settings,
            'changed::live-window-thumbnails', () => this._sync());
    }

    /**
     * Enable the manager; call once after construction when the setting is on.
     */
    enable() {
        this._enabled = true;
        this._sync();
    }

    /**
     * Disable and clean up the live thumbnail.
     */
    disable() {
        this._enabled = false;
        this._removeClone();
        this._showStaticIcon();
    }

    /**
     * Main synchronization point.  Decides whether to show a live clone
     * or fall back to the static icon.
     */
    _sync() {
        if (!this._enabled && !Docking.DockManager.settings.liveWindowThumbnails) {
            this._removeClone();
            this._showStaticIcon();
            return;
        }

        if (!this._enabled)
            this._enabled = true;

        if (!this._appIcon.running) {
            // App not running: revert to static icon.
            this._removeClone();
            this._showStaticIcon();
            return;
        }

        const window = this._pickWindow();
        if (!window) {
            this._removeClone();
            this._showStaticIcon();
            return;
        }

        // If we already have a clone for this window, nothing to do.
        if (this._currentWindow === window && this._clone && !this._clone.is_destroyed?.())
            return;

        // Build a new clone for the chosen window.
        this._removeClone();
        this._createClone(window);
    }

    /**
     * Pick the best window to display.  Prefers the focused window if
     * it belongs to this app; otherwise the most-recently-used window.
     */
    _pickWindow() {
        const windows = this._appIcon.getInterestingWindows();
        if (!windows.length)
            return null;

        // Prefer the focused window.
        const focusWin = global.display.focus_window;
        if (focusWin && windows.includes(focusWin))
            return focusWin;

        // Fall back to the first (most-recently-used) window.
        return windows[0];
    }

    /**
     * Create a Clutter.Clone of the chosen window's compositor texture
     * and insert it into the icon container, hiding the static icon.
     */
    _createClone(window) {
        const windowActor = window.get_compositor_private();
        if (!windowActor)
            return;

        const texture = windowActor.get_texture?.() ?? windowActor;

        this._clone = new Clutter.Clone({
            source: texture,
            reactive: false,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true,
            minification_filter: Clutter.ScalingFilter.TRILINEAR,
            magnification_filter: Clutter.ScalingFilter.TRILINEAR,
        });

        // Wrap in a rounded-corner bin so it looks polished in the dock.
        this._cloneBin = new St.Bin({
            style_class: 'live-thumbnail-bin',
            child: this._clone,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true,
        });

        this._mutterWindow = windowActor;
        this._currentWindow = window;

        // When the window actor is destroyed, remove the clone.
        this._destroyId = windowActor.connect('destroy', () => {
            this._destroyId = 0;
            this._mutterWindow = null;
            this._currentWindow = null;
            this._removeClone();
            this._showStaticIcon();
            // Try to pick another window.
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._sync();
                return GLib.SOURCE_REMOVE;
            });
        });

        this._updateCloneSize();
        this._hideStaticIcon();

        // Insert the clone bin into the icon container at position 0 so it
        // sits behind the number-overlay and other decorations.
        const iconContainer = this._appIcon._iconContainer;
        if (iconContainer)
            iconContainer.insert_child_at_index(this._cloneBin, 0);
    }

    /**
     * Compute the correct clone dimensions to fit within the icon size,
     * preserving the window's aspect ratio.
     */
    _updateCloneSize() {
        if (!this._clone || !this._mutterWindow)
            return;

        const iconSize = this._appIcon.icon?.iconSize;
        if (!iconSize)
            return;

        // Scale factor for HiDPI.
        const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);
        const targetSize = iconSize * scaleFactor;

        const [winWidth, winHeight] = this._mutterWindow.get_size();
        if (!winWidth || !winHeight)
            return;

        const scale = Math.min(targetSize / winWidth, targetSize / winHeight);
        const cloneW = Math.round(winWidth * scale);
        const cloneH = Math.round(winHeight * scale);

        this._clone.set_size(cloneW, cloneH);

        if (this._cloneBin)
            this._cloneBin.set_size(targetSize, targetSize);
    }

    /**
     * Remove the current clone and release related resources.
     */
    _removeClone() {
        if (this._destroyId && this._mutterWindow) {
            try {
                this._mutterWindow.disconnect(this._destroyId);
            } catch {
                // Already destroyed.
            }
            this._destroyId = 0;
        }

        if (this._cloneBin) {
            if (this._cloneBin.get_parent())
                this._cloneBin.get_parent().remove_child(this._cloneBin);
            this._cloneBin.destroy();
            this._cloneBin = null;
        }

        this._clone = null;
        this._mutterWindow = null;
        this._currentWindow = null;
    }

    /**
     * Hide the static app icon (the BaseIcon texture).
     */
    _hideStaticIcon() {
        const iconBin = this._appIcon.icon?._iconBin;
        if (iconBin)
            iconBin.opacity = 0;
    }

    /**
     * Restore the static app icon.
     */
    _showStaticIcon() {
        const iconBin = this._appIcon.icon?._iconBin;
        if (iconBin)
            iconBin.opacity = 255;
    }

    /**
     * Full cleanup.
     */
    destroy() {
        this._removeClone();
        this._showStaticIcon();
        this._signalsHandler.removeWithLabel(Labels.LIVE_THUMBNAIL);
        this._signalsHandler = null;
        this._appIcon = null;
    }
}
