// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: Contributors to Dash 2 X

import {
    Clutter,
    Gio,
    GLib,
    GObject,
    St,
} from './dependencies/gi.js';

import {
    BoxPointer,
    Main,
    PopupMenu,
} from './dependencies/shell/ui.js';

import {
    Utils,
} from './imports.js';

import {Extension} from './dependencies/shell/extensions/extension.js';

const {gettext: __} = Extension;

const MAX_RECENT_FILES = 10;
const XBEL_PATH = GLib.build_filenamev([
    GLib.get_home_dir(), '.local', 'share', 'recently-used.xbel',
]);

const HOVER_ENTER_TIMEOUT = 400;
const HOVER_LEAVE_TIMEOUT = 300;

/**
 * Parse the recently-used.xbel file and return bookmark entries.
 * Each entry has: { href, name, mimeType, appExecs, modified }
 */
function _parseRecentlyUsed() {
    const file = Gio.File.new_for_path(XBEL_PATH);
    if (!file.query_exists(null))
        return [];

    let contents;
    try {
        const [ok, data] = file.load_contents(null);
        if (!ok)
            return [];
        contents = new TextDecoder().decode(data);
    } catch (e) {
        logError(e, 'Failed to read recently-used.xbel');
        return [];
    }

    const entries = [];
    // Match each <bookmark> element (non-greedy across newlines)
    const bookmarkRegex = /<bookmark\s+href="([^"]*)"[^>]*modified="([^"]*)"[^>]*>[\s\S]*?<\/bookmark>/g;
    const mimeRegex = /<mime:mime-type\s+type="([^"]*)"/;
    const appRegex = /<bookmark:application\s+[^>]*exec="([^"]*)"/g;

    let match;
    while ((match = bookmarkRegex.exec(contents)) !== null) {
        const [block, href, modified] = match;

        // Decode XML entities in the URI
        const decodedHref = href
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'");

        const mimeMatch = mimeRegex.exec(block);
        const [, mimeType = ''] = mimeMatch || [];

        const appExecs = [];
        let appMatch;
        while ((appMatch = appRegex.exec(block)) !== null) {
            // The exec field often has the form: 'appname %u' or similar
            // Decode XML entities here too
            const [, rawExec] = appMatch;
            const exec = rawExec
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&apos;/g, "'");
            appExecs.push(exec);
        }
        // Reset lastIndex for appRegex since it's reused
        appRegex.lastIndex = 0;

        // Extract display name from URI
        let name;
        try {
            const uri = GLib.uri_parse(decodedHref, GLib.UriFlags.NONE);
            const path = uri.get_path();
            name = GLib.path_get_basename(path);
            // Decode percent-encoded characters
            name = decodeURIComponent(name);
        } catch {
            // Fallback: extract filename from end of URI
            const parts = decodedHref.split('/');
            name = parts[parts.length - 1] || decodedHref;
            try {
                name = decodeURIComponent(name);
            } catch {
                // keep as-is
            }
        }

        entries.push({
            href: decodedHref,
            name,
            mimeType,
            appExecs,
            modified,
        });
    }

    // Sort by modified date, most recent first
    entries.sort((a, b) => {
        if (a.modified > b.modified)
            return -1;
        if (a.modified < b.modified)
            return 1;
        return 0;
    });

    return entries;
}

/**
 * Check if a recent file entry was opened by a given app.
 * Matches by comparing the app's executable name against the exec fields
 * in the XBEL bookmark.
 */
function _entryMatchesApp(entry, app) {
    const appInfo = app.get_app_info();
    if (!appInfo)
        return false;

    // Get the app's executable basename
    const appExec = appInfo.get_executable();
    if (!appExec)
        return false;
    const appExecBasename = GLib.path_get_basename(appExec);

    // Also check the commandline for flatpak/snap apps
    const commandline = appInfo.get_commandline() || '';

    for (const exec of entry.appExecs) {
        // The exec in XBEL is like "'gedit %u'" or "'flatpak run org.gnome.gedit %u'"
        // Strip surrounding quotes and field codes
        const cleanExec = exec.replace(/^'|'$/g, '').replace(/%[a-zA-Z]/g, '').trim();
        const execBasename = GLib.path_get_basename(cleanExec.split(/\s+/)[0]);

        if (execBasename === appExecBasename)
            return true;

        // For flatpak/snap: check if the command contains the app id
        const appId = appInfo.get_id();
        if (appId) {
            const appIdBase = appId.replace(/\.desktop$/, '');
            if (cleanExec.includes(appIdBase))
                return true;
        }

        // Also match commandline for complex app launchers
        if (commandline && cleanExec.includes(commandline.split(/\s+/)[0]))
            return true;
    }

    // Fallback: match by MIME type
    const supportedTypes = appInfo.get_supported_types() || [];
    if (entry.mimeType && supportedTypes.includes(entry.mimeType))
        return true;

    return false;
}

/**
 * Get recent files for a specific app, limited to MAX_RECENT_FILES.
 */
export function getRecentFilesForApp(app) {
    const allEntries = _parseRecentlyUsed();
    const matched = [];

    for (const entry of allEntries) {
        if (_entryMatchesApp(entry, app)) {
            matched.push(entry);
            if (matched.length >= MAX_RECENT_FILES)
                break;
        }
    }

    return matched;
}


/**
 * A menu item representing a single recent file.
 */
const RecentFileMenuItem = GObject.registerClass(
class RecentFileMenuItem extends PopupMenu.PopupBaseMenuItem {
    _init(entry, app, params) {
        super._init(params);

        this._entry = entry;
        this._app = app;

        this.add_style_class_name('recent-file-item');

        // Remove default ornament
        this.remove_child(this._ornamentIcon);

        const box = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            style_class: 'recent-file-item-box',
        });

        // File icon
        let gicon;
        try {
            if (entry.mimeType) {
                const contentType = Gio.content_type_from_mime_type(entry.mimeType);
                if (contentType)
                    gicon = Gio.content_type_get_icon(contentType);
            }
        } catch {
            // ignore
        }
        if (!gicon)
            gicon = Gio.icon_new_for_string('text-x-generic-symbolic');

        const icon = new St.Icon({
            gicon,
            style_class: 'recent-file-icon',
            icon_size: 16,
        });
        box.add_child(icon);

        // File name label
        const label = new St.Label({
            text: entry.name,
            style_class: 'recent-file-name',
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        label.clutter_text.set_ellipsize(3); // Pango.EllipsizeMode.END
        box.add_child(label);

        this.add_child(box);
    }

    activate(_event) {
        // Open the file with the associated app
        const uri = this._entry.href;
        try {
            const appInfo = this._app.get_app_info();
            if (appInfo) {
                const file = Gio.File.new_for_uri(uri);
                appInfo.launch([file], null);
            } else {
                Gio.AppInfo.launch_default_for_uri(uri, null);
            }
        } catch (e) {
            logError(e, `Failed to open recent file: ${uri}`);
            // Fallback: try default handler
            try {
                Gio.AppInfo.launch_default_for_uri(uri, null);
            } catch (e2) {
                logError(e2, `Fallback also failed for: ${uri}`);
            }
        }

        this._getTopMenu().close();
    }
});


/**
 * RecentFilesMenu - A popup menu showing recently opened files for an app.
 * Follows the same popup-anchored-to-icon pattern as WindowPreviewMenu.
 */
export class RecentFilesMenu extends PopupMenu.PopupMenu {
    constructor(source) {
        super(source, 0.5, Utils.getPosition());

        this._source = source;
        this._app = source.app;

        this.actor.add_style_class_name('recent-files-menu');

        this.actor.hide();

        // Chain visibility and lifecycle to the source
        this._mappedId = this._source.connect('notify::mapped', () => {
            if (!this._source.mapped)
                this.close();
        });
        this._destroyId = this._source.connect('destroy', this.destroy.bind(this));

        Utils.addActor(Main.uiGroup, this.actor);

        this._enterSourceId = 0;
        this._leaveSourceId = 0;
        this._enterMenuId = 0;
        this._leaveMenuId = 0;
        this._hoverOpenTimeoutId = null;
        this._hoverCloseTimeoutId = null;
        this.fromHover = false;

        this.connect('destroy', this._onDestroy.bind(this));
    }

    _redisplay() {
        this.removeAll();

        const recentFiles = getRecentFilesForApp(this._app);

        if (recentFiles.length === 0)
            return false;

        // Header
        this.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(__('Recent Files')));

        for (const entry of recentFiles)
            this.addMenuItem(new RecentFileMenuItem(entry, this._app));

        return true;
    }

    popup() {
        if (!this._redisplay())
            return;

        const workArea = Main.layoutManager.getWorkAreaForMonitor(
            this._source.monitorIndex);
        const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);
        const maxWidth = Math.round((workArea.width * 0.4) / scaleFactor);
        const maxHeight = Math.round((workArea.height * 0.6) / scaleFactor);

        this.actor.set_style(
            `max-width: ${maxWidth}px; max-height: ${maxHeight}px;`);

        if (!this.isOpen) {
            this.open(BoxPointer.PopupAnimation.FULL);
            this._source.emit('sync-tooltip');
        }
    }

    enableHover(menuManager) {
        this.blockSourceEvents = false;

        if (menuManager) {
            menuManager.removeMenu(this);
            this._menuManager = menuManager;
        }

        this._boxPointer.set_reactive(false);
        this._boxPointer.set_track_hover(false);

        if (this._boxPointer.actor) {
            this._boxPointer.actor.set_reactive(false);
            this._boxPointer.actor.set_track_hover(false);
        }

        this._boxPointer.bin.set_reactive(true);
        this._boxPointer.bin.set_track_hover(true);

        this._enterSourceId = this._source.connect('enter-event',
            () => this._onEnter());
        this._leaveSourceId = this._source.connect('leave-event',
            () => this._onLeave());

        this._enterMenuId = this._boxPointer.bin.connect('enter-event',
            () => this._onMenuEnter());
        this._leaveMenuId = this._boxPointer.bin.connect('leave-event',
            () => this._onMenuLeave());
    }

    disableHover() {
        this.blockSourceEvents = true;

        if (this._menuManager) {
            this._menuManager.addMenu(this);
            this._menuManager = null;
        }

        this.cancelOpen();
        this.cancelClose();

        if (this._enterSourceId) {
            this._source.disconnect(this._enterSourceId);
            this._enterSourceId = 0;
        }
        if (this._leaveSourceId) {
            this._source.disconnect(this._leaveSourceId);
            this._leaveSourceId = 0;
        }
        if (this._enterMenuId) {
            this._boxPointer.bin.disconnect(this._enterMenuId);
            this._enterMenuId = 0;
        }
        if (this._leaveMenuId) {
            this._boxPointer.bin.disconnect(this._leaveMenuId);
            this._leaveMenuId = 0;
        }
    }

    _onEnter() {
        this.cancelOpen();
        this.cancelClose();

        this._hoverOpenTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            HOVER_ENTER_TIMEOUT,
            () => {
                this.hoverOpen();
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _onLeave() {
        this.cancelOpen();

        if (this._boxPointer?.bin?.has_pointer)
            return;
        if (this._source.has_pointer)
            return;

        this._hoverCloseTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            HOVER_LEAVE_TIMEOUT,
            () => {
                this.hoverClose();
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    cancelOpen() {
        if (this._hoverOpenTimeoutId) {
            GLib.source_remove(this._hoverOpenTimeoutId);
            this._hoverOpenTimeoutId = null;
        }
    }

    cancelClose() {
        if (this._hoverCloseTimeoutId) {
            GLib.source_remove(this._hoverCloseTimeoutId);
            this._hoverCloseTimeoutId = null;
        }
    }

    hoverOpen() {
        this._hoverOpenTimeoutId = null;
        this.fromHover = true;
        if (!this.isOpen)
            this.popup();
    }

    hoverClose() {
        this._hoverCloseTimeoutId = null;

        if (this._boxPointer?.bin?.has_pointer || this._source.has_pointer)
            return;

        if (this.isOpen) {
            this._boxPointer.close(BoxPointer.PopupAnimation.FADE, () => {
                this.actor.hide();
                this.isOpen = false;
                this.emit('menu-closed');
            });
        }
    }

    _onMenuEnter() {
        this.cancelClose();
    }

    _onMenuLeave() {
        this.cancelOpen();

        if (this._hoverCloseTimeoutId)
            return;

        this._hoverCloseTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            HOVER_LEAVE_TIMEOUT,
            () => {
                this.hoverClose();
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _onDestroy() {
        this.disableHover();

        if (this._mappedId) {
            this._source.disconnect(this._mappedId);
            this._mappedId = 0;
        }

        if (this._destroyId) {
            this._source.disconnect(this._destroyId);
            this._destroyId = 0;
        }
    }
}
