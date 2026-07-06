// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: Contributors to Dash 2 X
// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

import {
    Clutter,
    Gio,
    GioUnix,
    GLib,
    GObject,
    Shell,
    St,
} from './dependencies/gi.js';

import {
    Main,
    ShellMountOperation,
} from './dependencies/shell/ui.js';

import {
    Docking,
    Theming,
    Utils,
} from './imports.js';

import {Extension} from './dependencies/shell/extensions/extension.js';

// Use __ () and N__() for the extension gettext domain, and reuse
// the shell domain with the default _() and N_()
const {gettext: __} = Extension;

const {signals: Signals} = imports;

const FALLBACK_REMOVABLE_MEDIA_ICON = 'drive-removable-media';
const FALLBACK_TRASH_ICON = 'user-trash';
const FILE_MANAGER_DESKTOP_APP_ID = 'org.gnome.Nautilus.desktop';
const ATTRIBUTE_METADATA_CUSTOM_ICON = 'metadata::custom-icon';
const TRASH_URI = 'trash://';
const UPDATE_TRASH_DELAY = 1000;
const LAUNCH_HANDLER_MAX_WAIT = 200;

const NautilusFileOperations2Interface = '<node>\
    <interface name="org.gnome.Nautilus.FileOperations2">\
        <method name="EmptyTrash">\
            <arg type="b" name="ask_confirmation" direction="in"/>\
            <arg type="a{sv}" name="platform_data" direction="in"/>\
        </method>\
    </interface>\
</node>';

const NautilusFileOperations2ProxyInterface =
    Gio.DBusProxy.makeProxyWrapper(NautilusFileOperations2Interface);

const Labels = Object.freeze({
    LOCATION_WINDOWS: Symbol('location-windows'),
    WINDOWS_CHANGED: Symbol('windows-changed'),
});

const GJS_SUPPORTS_FILE_IFACE_PROMISES = imports.system.version >= 17101;

if (GJS_SUPPORTS_FILE_IFACE_PROMISES) {
    Gio._promisify(Gio.File.prototype, 'query_info_async');
    Gio._promisify(Gio.File.prototype, 'query_default_handler_async');
}


/**
 *
 */
function makeNautilusFileOperationsProxy() {
    const proxy = new NautilusFileOperations2ProxyInterface(
        Gio.DBus.session,
        'org.gnome.Nautilus',
        '/org/gnome/Nautilus/FileOperations2', (_p, error) => {
            if (error)
                logError(error, 'Error connecting to Nautilus');
        }
    );

    proxy.platformData = params => {
        const defaultParams = {
            parentHandle: '',
            timestamp: global.get_current_time(),
            windowPosition: 'center',
        };
        const {parentHandle, timestamp, windowPosition} = {
            ...defaultParams,
            ...params,
        };

        return {
            'parent-handle': new GLib.Variant('s', parentHandle),
            'timestamp': new GLib.Variant('u', timestamp),
            'window-position': new GLib.Variant('s', windowPosition),
        };
    };

    return proxy;
}

export const LocationAppInfo = GObject.registerClass({
    Implements: [Gio.AppInfo],
    Properties: {
        'location': GObject.ParamSpec.object(
            'location', 'location', 'location',
            GObject.ParamFlags.READWRITE,
            Gio.File.$gtype),
        'name': GObject.ParamSpec.string(
            'name', 'name', 'name',
            GObject.ParamFlags.READWRITE,
            null),
        'icon': GObject.ParamSpec.object(
            'icon', 'icon', 'icon',
            GObject.ParamFlags.READWRITE,
            Gio.Icon.$gtype),
        'cancellable': GObject.ParamSpec.object(
            'cancellable', 'cancellable', 'cancellable',
            GObject.ParamFlags.READWRITE,
            Gio.Cancellable.$gtype),
    },
}, class LocationAppInfo extends GioUnix.DesktopAppInfo {
    static get GJS_BINARY_PATH() {
        if (!this._gjsBinaryPath)
            this._gjsBinaryPath = GLib.find_program_in_path('gjs');

        return this._gjsBinaryPath;
    }

    list_actions() {
        return [];
    }

    get_action_name() {
        return null;
    }

    get_boolean() {
        return false;
    }

    vfunc_dup() {
        return new LocationAppInfo({
            location: this.location,
            name: this.name,
            icon: this.icon,
            cancellable: this.cancellable,
        });
    }

    vfunc_equal(other) {
        if (this.location)
            return this.location.equal(other?.location);

        return this.name === other.name &&
            (this.icon ? this.icon.equal(other?.icon) : !other?.icon);
    }

    vfunc_get_id() {
        return 'location:%s'.format(this.location?.get_uri());
    }

    vfunc_get_name() {
        return this.name;
    }

    vfunc_get_description() {
        return null;
    }

    vfunc_get_executable() {
        return null;
    }

    vfunc_get_icon() {
        return this.icon;
    }

    vfunc_launch(files, context) {
        if (files?.length) {
            throw new GLib.Error(Gio.IOErrorEnum,
                Gio.IOErrorEnum.NOT_SUPPORTED, 'Launching with files not supported');
        }

        return this.getHandlerApp().launch_uris([this.location.get_uri()], context);
    }

    vfunc_supports_uris() {
        return false;
    }

    vfunc_supports_files() {
        return false;
    }

    vfunc_launch_uris(uris, context) {
        return this.launch(uris, context);
    }

    vfunc_should_show() {
        return true;
    }

    vfunc_set_as_default_for_type() {
        throw new GLib.Error(Gio.IOErrorEnum,
            Gio.IOErrorEnum.NOT_SUPPORTED, 'Not supported');
    }

    vfunc_set_as_default_for_extension() {
        throw new GLib.Error(Gio.IOErrorEnum,
            Gio.IOErrorEnum.NOT_SUPPORTED, 'Not supported');
    }

    vfunc_add_supports_type() {
        throw new GLib.Error(Gio.IOErrorEnum,
            Gio.IOErrorEnum.NOT_SUPPORTED, 'Not supported');
    }

    vfunc_can_remove_supports_type() {
        return false;
    }

    vfunc_remove_supports_type() {
        return false;
    }

    vfunc_can_delete() {
        return false;
    }

    vfunc_do_delete() {
        return false;
    }

    vfunc_get_commandline() {
        try {
            return this.getHandlerApp().get_commandline();
        } catch {
            return this._getFallbackCommandLine();
        }
    }

    vfunc_get_display_name() {
        return this.name;
    }

    vfunc_set_as_last_used_for_type() {
        throw new GLib.Error(Gio.IOErrorEnum,
            Gio.IOErrorEnum.NOT_SUPPORTED, 'Not supported');
    }

    vfunc_get_supported_types() {
        return [];
    }

    _getFallbackCommandLine() {
        return `gio open ${this.location?.get_uri()}`;
    }

    async _queryLocationIcons(params) {
        const icons = {standard: null, custom: null};
        if (!this.location)
            return icons;

        const cancellable = params.cancellable ?? this.cancellable;
        const iconsQuery = [];
        if (params?.standard)
            iconsQuery.push(Gio.FILE_ATTRIBUTE_STANDARD_ICON);

        if (params?.custom)
            iconsQuery.push(ATTRIBUTE_METADATA_CUSTOM_ICON);

        if (!iconsQuery.length)
            throw new Error('Invalid Query Location Icons parameters');

        let info;
        try {
            if (!GJS_SUPPORTS_FILE_IFACE_PROMISES) {
                Gio._promisify(this.location.constructor.prototype,
                    'query_info_async', 'query_info_finish');
            }
            info = await this.location.query_info_async(
                iconsQuery.join(','),
                Gio.FileQueryInfoFlags.NONE,
                GLib.PRIORITY_LOW, cancellable);
            if (info.has_attribute(Gio.FILE_ATTRIBUTE_STANDARD_ICON))
                icons.standard = info.get_icon();
        } catch (e) {
            if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND) ||
                e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_MOUNTED))
                return icons;
            throw e;
        }

        const customIcon = info.get_attribute_string(ATTRIBUTE_METADATA_CUSTOM_ICON);
        if (customIcon) {
            const customIconFile = GLib.uri_parse_scheme(customIcon)
                ? Gio.File.new_for_uri(customIcon) : Gio.File.new_for_path(customIcon);
            const iconFileInfo = await customIconFile.query_info_async(
                Gio.FILE_ATTRIBUTE_STANDARD_TYPE,
                Gio.FileQueryInfoFlags.NONE,
                GLib.PRIORITY_LOW, cancellable);

            if (iconFileInfo.get_file_type() === Gio.FileType.REGULAR)
                icons.custom = Gio.FileIcon.new(customIconFile);
        }

        return icons;
    }

    async _updateLocationIcon(params = {standard: true, custom: true}) {
        const cancellable = new Utils.CancellableChild(this.cancellable);

        try {
            this._updateIconCancellable?.cancel();
            this._updateIconCancellable = cancellable;

            const icons = await this._queryLocationIcons({cancellable, ...params});
            const icon = icons.custom ?? icons.standard;

            if (icon && !icon.equal(this.icon))
                this.icon = icon;
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                logError(e, 'Impossible to update icon for %s'.format(this.get_id()));
        } finally {
            cancellable.cancel();
            if (this._updateIconCancellable === cancellable)
                delete this._updateIconCancellable;
        }
    }

    async _getHandlerAppAsync(cancellable) {
        if (!this.location)
            return null;

        try {
            if (!GJS_SUPPORTS_FILE_IFACE_PROMISES) {
                Gio._promisify(this.location.constructor.prototype,
                    'query_default_handler_async',
                    'query_default_handler_finish');
            }

            return await this.location.query_default_handler_async(
                GLib.PRIORITY_DEFAULT, cancellable);
        } catch (e) {
            if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_MOUNTED))
                return getFileManagerApp()?.appInfo;

            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                logError(e, 'Impossible to find an URI handler for %s'.format(
                    this.get_id()));
            }

            throw e;
        }
    }

    _getHandlerAppFromWorker(cancellable) {
        const locationsWorker = GLib.build_filenamev([
            Docking.DockManager.extension.path,
            'locationsWorker.js',
        ]);
        const locationsWorkerArgs = [LocationAppInfo.GJS_BINARY_PATH, '-m',
            locationsWorker, 'handler', this.location.get_uri(),
            '--timeout', `${LAUNCH_HANDLER_MAX_WAIT}`];
        const subProcess = Gio.Subprocess.new(locationsWorkerArgs,
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);

        try {
            const [, stdOut, stdErr] = subProcess.communicate(null, cancellable);
            subProcess.wait(cancellable);
            const errorCode = subProcess.get_exit_status();
            const textDecoder = new TextDecoder();

            if (errorCode) {
                const errorLines = textDecoder.decode(stdErr.toArray()).split('\n');
                const error = new GLib.Error(Gio.IOErrorEnum,
                    errorCode === GLib.MAXUINT8 ? 0 : errorCode, errorLines[0]);
                error.stack = `${errorLines.slice(3).join('\n')}${error.stack}`;
                throw error;
            }

            const desktopId = textDecoder.decode(stdOut.toArray()).trim();
            const handlerApp = Shell.AppSystem.get_default().lookup_app(desktopId)?.appInfo;
            return handlerApp;
        } finally {
            subProcess.force_exit();
        }
    }

    getHandlerApp() {
        if (this._handlerApp)
            return this._handlerApp;

        if (!this.location)
            return null;

        const cancellable = new Utils.CancellableChild(this.cancellable);

        try {
            if (LocationAppInfo.GJS_BINARY_PATH)
                this._handlerApp = this._getHandlerAppFromWorker(cancellable);
            else
                this._handlerApp = this.location.query_default_handler(cancellable);

            if (!this._handlerApp) {
                throw new GLib.Error(Gio.IOErrorEnum,
                    Gio.IOErrorEnum.NOT_FOUND, `Handler for ${this.location} not found`);
            }
        } catch (e) {
            if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_MOUNTED))
                return getFileManagerApp()?.appInfo;

            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                logError(e, 'Impossible to find an URI handler for %s'.format(
                    this.get_id()));
            }

            throw e;
        }

        return this._handlerApp;
    }

    destroy() {
        this.location = null;
        this.icon = null;
        this.name = null;
        this._handlerApp = null;
        this.cancellable?.cancel();
    }
});

const RemovableAction = Object.freeze({
    MOUNT: 'mount',
    UNMOUNT: 'unmount',
    EJECT: 'eject',
});

const MountableVolumeAppInfo = GObject.registerClass({
    Implements: [Gio.AppInfo],
    Properties: {
        'volume': GObject.ParamSpec.object(
            'volume', 'volume', 'volume',
            GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT_ONLY,
            Gio.Volume.$gtype),
        'mount': GObject.ParamSpec.object(
            'mount', 'mount', 'mount',
            GObject.ParamFlags.READWRITE,
            Gio.Mount.$gtype),
        'busy': GObject.ParamSpec.boolean(
            'busy', 'busy', 'busy',
            GObject.ParamFlags.READWRITE,
            false),
    },
},
class MountableVolumeAppInfo extends LocationAppInfo {
    _init(volume, cancellable = null) {
        super._init({
            volume,
            cancellable,
        });

        this._signalsHandler = new Utils.GlobalSignalsHandler();

        const updateAndMonitor = () => {
            this._update();
            this._monitorChanges();
        };
        updateAndMonitor();
        this._mountChanged = this.connect('notify::mount', updateAndMonitor);

        if (!this.mount && this.volume.get_identifier('class') === 'network') {
            // For some devices the mount point isn't advertised promptly
            // even if it's already existing, and there's no signaling about
            this._lazyUpdater = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
                this._update();
                delete this._lazyUpdater;
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    get busy() {
        return !!this._currentAction;
    }

    get currentAction() {
        return this._currentAction;
    }

    destroy() {
        if (this._lazyUpdater) {
            GLib.source_remove(this._lazyUpdater);
            delete this._lazyUpdater;
        }
        this.disconnect(this._mountChanged);
        this.mount = null;
        this._signalsHandler.destroy();

        super.destroy();
    }

    vfunc_dup() {
        return new MountableVolumeAppInfo({
            volume: this.volume,
            cancellable: this.cancellable,
        });
    }

    vfunc_get_id() {
        const uuid = this.mount?.get_uuid() ?? this.volume.get_uuid();
        return uuid ? 'mountable-volume:%s'.format(uuid) : super.vfunc_get_id();
    }

    vfunc_equal(other) {
        if (this.volume === other?.volume && this.mount === other?.mount)
            return true;

        return this.get_id() === other?.get_id();
    }

    list_actions() {
        const actions = [];
        const {mount} = this;

        if (mount) {
            if (this.mount.can_unmount())
                actions.push(RemovableAction.UNMOUNT);
            if (this.mount.can_eject())
                actions.push(RemovableAction.EJECT);

            return actions;
        }

        if (this.volume.can_mount())
            actions.push(RemovableAction.MOUNT);
        if (this.volume.can_eject())
            actions.push(RemovableAction.EJECT);

        return actions;
    }

    get_action_name(action) {
        switch (action) {
        case RemovableAction.MOUNT:
            return __('Mount');
        case RemovableAction.UNMOUNT:
            return __('Unmount');
        case RemovableAction.EJECT:
            return __('Eject');
        default:
            return null;
        }
    }

    vfunc_launch(files, context) {
        if (this.mount || files?.length)
            return super.vfunc_launch(files, context);

        this.mountAndLaunch(files, context);
        return true;
    }

    _update() {
        this.mount = this.volume.get_mount();

        const removable = this.mount ?? this.volume;
        this.name = removable.get_name();
        this.icon = removable.get_icon();

        this.location = this.mount?.get_default_location() ??
            this.volume.get_activation_root();

        // Clear cached handler app so it's re-resolved with the updated
        // location URI. Without this, a handler resolved before mounting
        // (e.g. Disk Utility for an activation root URI) would persist
        // after mounting, preventing the file browser from opening (#123).
        this._handlerApp = null;

        this._updateLocationIcon({custom: true});
    }

    _monitorChanges() {
        this._signalsHandler.destroy();

        const removable = this.mount ?? this.volume;
        this._signalsHandler.add(removable, 'changed', () => this._update());

        if (this.mount) {
            this._signalsHandler.add(this.mount, 'pre-unmount', () => this._update());
            this._signalsHandler.add(this.mount, 'unmounted', () => this._update());
        }
    }

    async mountAndLaunch(files, context) {
        if (this.mount)
            return super.vfunc_launch(files, context);

        try {
            await this.launchAction(RemovableAction.MOUNT);
            if (!this.mount) {
                throw new Error('No mounted location to open for %s'.format(
                    this.get_id()));
            }

            return super.vfunc_launch(files, context);
        } catch (e) {
            logError(e, 'Mount and launch %s'.format(this.get_id()));
            return false;
        }
    }

    _notifyActionError(action, message) {
        switch (action) {
        case RemovableAction.MOUNT:
            global.notify_error(__('Failed to mount “%s”'.format(
                this.get_name())), message);
            break;

        case RemovableAction.UNMOUNT:
            global.notify_error(__('Failed to unmount “%s”'.format(
                this.get_name())), message);
            break;

        case RemovableAction.EJECT:
            global.notify_error(__('Failed to eject “%s”'.format(
                this.get_name())), message);
            break;
        }
    }

    async launchAction(action) {
        if (!this.list_actions().includes(action))
            throw new Error('Action %s is not supported by %s', action, this);

        switch (this._currentAction) {
        case RemovableAction.MOUNT:
            this._notifyActionError(action,
                __('Mount operation already in progress'));
            break;

        case RemovableAction.UNMOUNT:
            this._notifyActionError(action,
                __('Unmount operation already in progress'));
            break;

        case RemovableAction.EJECT:
            this._notifyActionError(action,
                __('Eject operation already in progress'));
            break;

        default:
            if (this._currentAction) {
                throw new Error('Another action %s is being performed in %s'.format(
                    this._currentAction, this));
            }
        }

        this._currentAction = action;
        this.notify('busy');
        const removable = this.mount ?? this.volume;
        const operation = new ShellMountOperation.ShellMountOperation(removable);
        try {
            switch (action) {
            case RemovableAction.MOUNT:
                await this.volume.mount(Gio.MountMountFlags.NONE, operation.mountOp,
                    this.cancellable);
                return true;

            case RemovableAction.UNMOUNT:
                await this.mount.unmount_with_operation(Gio.MountUnmountFlags.FORCE,
                    operation.mountOp, this.cancellable);
                return true;

            case RemovableAction.EJECT:
                await removable.eject_with_operation(Gio.MountUnmountFlags.FORCE,
                    operation.mountOp, this.cancellable);
                return true;

            default:
                logError(new Error(), 'No action %s on removable %s'.format(action,
                    removable.get_name()));
                return false;
            }
        } catch (e) {
            if (action === RemovableAction.MOUNT &&
                e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.ALREADY_MOUNTED))
                return true;
            else if (action === RemovableAction.UNMOUNT &&
                     e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_MOUNTED))
                return true;

            if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.FAILED))
                this._notifyActionError(action, e.message);

            if (action === RemovableAction.MOUNT && this._isEncryptedMountError(e)) {
                delete this._currentAction;
                operation.close();
                return this.launchAction(action);
            }

            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                logError(e, 'Impossible to %s removable %s'.format(action,
                    removable.get_name()));
            }

            return false;
        } finally {
            delete this._currentAction;
            this.notify('busy');
            this._update();
            operation.close();
        }
    }

    _isEncryptedMountError(error) {
        // FIXME: we will always get G_IO_ERROR_FAILED from the gvfs udisks
        // backend, see https://bugs.freedesktop.org/show_bug.cgi?id=51271

        if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.FAILED))
            return false;

        // cryptsetup
        if (error.message.includes('No key available with this passphrase'))
            return true;

        // udisks (no password)
        if (error.message.includes('No key available to unlock device'))
            return true;

        // libblockdev wrong password opening LUKS device
        if (error.message.includes('Failed to activate device: Incorrect passphrase'))
            return true;

        // cryptsetup returns EINVAL in many cases, including wrong TCRYPT password/parameters
        if (error.message.includes('Failed to load device\'s parameters: Invalid argument') ||
            error.message.includes(`Failed to load device's parameters: ${GLib.strerror(22 /* EINVAL */)}`))
            return true;

        // cryptsetup returns EPERM when the TCRYPT header can't be decrypted
        // with the provided password/parameters.
        if (error.message.includes('Failed to load device\'s parameters: Operation not permitted') ||
            error.message.includes(`Failed to load device's parameters: ${GLib.strerror(1 /* EPERM */)}`))
            return true;

        return false;
    }
});

const TrashAppInfo = GObject.registerClass({
    Implements: [Gio.AppInfo],
    Properties: {
        'empty': GObject.ParamSpec.boolean(
            'empty', 'empty', 'empty',
            GObject.ParamFlags.READWRITE,
            true),
    },
},
class TrashAppInfo extends LocationAppInfo {
    static initPromises(file) {
        if (TrashAppInfo._promisified)
            return;

        const trashProto = file.constructor.prototype;
        Gio._promisify(Gio.FileEnumerator.prototype, 'close_async', 'close_finish');
        Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async', 'next_files_finish');
        Gio._promisify(trashProto, 'enumerate_children_async', 'enumerate_children_finish');
        Gio._promisify(trashProto, 'query_info_async', 'query_info_finish');
        TrashAppInfo._promisified = true;
    }

    _init(cancellable = null) {
        const trashLocation = Gio.file_new_for_uri(TRASH_URI);
        let trashName = __('Trash');
        try {
            const info = trashLocation.query_info(
                Gio.FILE_ATTRIBUTE_STANDARD_DISPLAY_NAME,
                Gio.FileQueryInfoFlags.NONE, null);
            const displayName = info.get_display_name();
            if (displayName)
                trashName = displayName;
        } catch {
            // Fall back to translated name
        }
        super._init({
            location: trashLocation,
            name: trashName,
            icon: Gio.ThemedIcon.new(FALLBACK_TRASH_ICON),
            cancellable,
        });
        TrashAppInfo.initPromises(this.location);

        try {
            this._monitor = this.location.monitor_directory(0, this.cancellable);
            this._schedUpdateId = 0;
            this._monitorChangedId = this._monitor.connect('changed', () =>
                this._onTrashChange());
        } catch (e) {
            if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;
            logError(e, 'Impossible to monitor trash');
        }
        this._updateTrash();

        this.connect('notify::empty', () => this._updateLocationIcon());
        this.notify('empty');
    }

    destroy() {
        if (this._schedUpdateId) {
            GLib.source_remove(this._schedUpdateId);
            this._schedUpdateId = 0;
        }
        this._updateTrashCancellable?.cancel();
        this._monitor?.disconnect(this._monitorChangedId);
        this._monitor = null;

        super.destroy();
    }

    list_actions() {
        return this.empty ? [] : ['empty-trash'];
    }

    get_action_name(action) {
        switch (action) {
        case 'empty-trash':
            return __('Empty Trash');
        default:
            return null;
        }
    }

    _onTrashChange() {
        if (this._schedUpdateId) {
            GLib.source_remove(this._schedUpdateId);
            this._schedUpdateId = 0;
        }

        if (this._monitor.is_cancelled())
            return;

        this._schedUpdateId = GLib.timeout_add(GLib.PRIORITY_LOW,
            UPDATE_TRASH_DELAY, () => {
                this._schedUpdateId = 0;
                this._updateTrash();
                return GLib.SOURCE_REMOVE;
            });
    }

    async _updateTrash() {
        const priority = GLib.PRIORITY_LOW;
        this._updateTrashCancellable?.cancel();
        const cancellable = new Utils.CancellableChild(this.cancellable);
        this._updateTrashCancellable = cancellable;

        try {
            const trashInfo = await this.location.query_info_async(
                Gio.FILE_ATTRIBUTE_TRASH_ITEM_COUNT,
                Gio.FileQueryInfoFlags.NONE,
                priority, cancellable);
            this.empty = !trashInfo.get_attribute_uint32(
                Gio.FILE_ATTRIBUTE_TRASH_ITEM_COUNT);
            return;
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                logError(e, 'Impossible to get trash children from infos');
        } finally {
            cancellable.cancel();
            if (this._updateIconCancellable === cancellable)
                delete this._updateTrashCancellable;
        }

        try {
            const childrenEnumerator = await this.location.enumerate_children_async(
                Gio.FILE_ATTRIBUTE_STANDARD_TYPE, Gio.FileQueryInfoFlags.NONE,
                priority, cancellable);
            const children = await childrenEnumerator.next_files_async(1,
                priority, cancellable);
            this.empty = !children.length;

            await childrenEnumerator.close_async(priority, null);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                logError(e, 'Impossible to enumerate trash children');
        } finally {
            cancellable.cancel();
            if (this._updateIconCancellable === cancellable)
                delete this._updateTrashCancellable;
        }
    }

    launchAction(action, timestamp) {
        if (!this.list_actions().includes(action))
            throw new Error('Action %s is not supported by %s', action, this);

        const nautilus = makeNautilusFileOperationsProxy();
        const askConfirmation = true;
        nautilus.EmptyTrashRemote(askConfirmation,
            nautilus.platformData({timestamp}), (_p, error) => {
                if (error)
                    logError(error, 'Empty trash failed');
            }, this.cancellable);
    }
});

/**
 * @param shellApp
 */
function wrapWindowsBackedApp(shellApp) {
    if (shellApp._dtdData)
        throw new Error('%s has been already wrapped'.format(shellApp));

    shellApp._dtdData = {
        windows: [],
        state: undefined,
        startingWorkspace: 0,
        isFocused: false,
        proxyProperties: [],
        sources: new Set(),
        signalConnections: new Utils.GlobalSignalsHandler(),
        methodInjections: new Utils.InjectionsHandler(),
        propertyInjections: new Utils.PropertyInjectionsHandler(),
        addProxyProperties(parent, proxyProperties) {
            Object.entries(proxyProperties).forEach(([p, o]) => {
                const publicProp = o.public ? p : `_${p}`;
                const get = o.getter && o.value instanceof Function
                    ? () => this[p]() : () => this[p];
                Object.defineProperty(parent, publicProp, Object.assign({
                    get,
                    set: v => (this[p] = v),
                    configurable: true,
                    enumerable: !!o.enumerable,
                }, o.readOnly ? {set: undefined} : {}));
                if (o.value)
                    this[p] = o.value;
                this.proxyProperties.push(publicProp);
            });
        },
        destroy() {
            this.windows = [];
            this.proxyProperties = [];
            this.sources.forEach(s => GLib.source_remove(s));
            this.sources.clear();
            this.signalConnections.destroy();
            this.methodInjections.destroy();
            this.propertyInjections.destroy();
        },
    };

    shellApp._dtdData.addProxyProperties(shellApp, {
        windows: {},
        state: {},
        startingWorkspace: {},
        isFocused: {public: true},
        signalConnections: {readOnly: true},
        sources: {readOnly: true},
        checkFocused: {},
        setDtdData: {},
    });

    shellApp._setDtdData = function (data, params = {}) {
        for (const [name, value] of Object.entries(data)) {
            if (params.readOnly && name in this._dtdData)
                throw new Error('Property %s is already defined'.format(name));
            const defaultParams = {public: true, readOnly: true};
            this._dtdData.addProxyProperties(this, {
                [name]: {...defaultParams, ...params, value},
            });
        }
    };

    const m = (...args) => shellApp._dtdData.methodInjections.add(shellApp, ...args);
    const p = (...args) => shellApp._dtdData.propertyInjections.add(shellApp, ...args);

    // mi is Method injector, pi is Property injector
    shellApp._setDtdData({mi: m, pi: p}, {public: false});

    m('get_state', () => shellApp._state ?? shellApp._getStateByWindows());
    p('state', {get: () => shellApp.get_state()});

    m('get_windows', () => shellApp._windows);
    m('get_n_windows', () => shellApp._windows.length);
    m('get_pids', () => shellApp._windows.reduce((pids, w) => {
        if (w.get_pid() > 0 && !pids.includes(w.get_pid()))
            pids.push(w.get_pid());
        return pids;
    }, []));
    m('is_on_workspace', (_om, workspace) => shellApp._windows.some(w =>
        w.get_workspace() === workspace) ||
        (shellApp.state === Shell.AppState.STARTING &&
         [-1, workspace.index()].includes(shellApp._startingWorkspace)));
    m('request_quit', () => shellApp._windows.filter(w =>
        w.can_close()).forEach(w => w.delete(global.get_current_time())));

    shellApp._setDtdData({
        _getStateByWindows() {
            return this.get_n_windows() ? Shell.AppState.RUNNING : Shell.AppState.STOPPED;
        },

        _updateWindows() {
            throw new GObject.NotImplementedError(`_updateWindows in ${this.constructor.name}`);
        },

        _notifyStateChanged() {
            Shell.AppSystem.get_default().emit('app-state-changed', this);
            this.notify('state');
        },

        _setState(state) {
            const oldState = this.state;
            this._state = state;

            if (this.state !== oldState)
                this._notifyStateChanged();
        },

        _setWindows(windows) {
            const oldState = this.state;
            const oldWindows = this._windows.slice();
            const result = {windowsChanged: false, stateChanged: false};
            this._state = undefined;

            if (windows.length !== oldWindows.length ||
                windows.some((win, index) => win !== oldWindows[index])) {
                this._windows = windows.filter(w => !w.is_override_redirect());
                this.emit('windows-changed');
                result.windowsChanged = true;
            }

            if (this.state !== oldState) {
                this._notifyStateChanged();
                this._checkFocused();
                result.stateChanged = true;
            }

            return result;
        },
    }, {readOnly: false});

    shellApp._sources.add(GLib.idle_add(GLib.DEFAULT_PRIORITY, () => {
        shellApp._updateWindows();
        shellApp._sources.delete(GLib.main_current_source().source_id);
        return GLib.SOURCE_REMOVE;
    }));

    const windowTracker = Shell.WindowTracker.get_default();
    shellApp._checkFocused = function () {
        if (this._windows.some(w => w.has_focus())) {
            this.isFocused = true;
            windowTracker.notify('focus-app');
        } else if (this.isFocused) {
            this.isFocused = false;
            windowTracker.notify('focus-app');
        }
    };

    shellApp._checkFocused();
    shellApp._signalConnections.add(global.display, 'notify::focus-window', () =>
        shellApp._checkFocused());

    // Re-implements shell_app_activate_window for generic activation and alt-tab support
    m('activate_window', function (_om, window, timestamp) {
        /* eslint-disable no-invalid-this */
        if (!window)
            [window] = this.get_windows();
        else if (!this._windows.includes(window))
            return;

        const currentWorkspace = global.workspace_manager.get_active_workspace();
        const workspace = window.get_workspace();
        const sameWorkspaceWindows = this.get_windows().filter(w =>
            w.get_workspace() === workspace);
        sameWorkspaceWindows.forEach(w => w.raise());

        if (workspace !== currentWorkspace)
            workspace.activate_with_focus(window, timestamp);
        else
            window.activate(timestamp);
        /* eslint-enable no-invalid-this */
    });

    // Re-implements shell_app_activate_full for generic activation and dash support
    m('activate_full', function (_om, workspace, timestamp) {
        /* eslint-disable no-invalid-this */
        if (!timestamp)
            timestamp = global.get_current_time();

        switch (this.state) {
        case Shell.AppState.STOPPED:
            try {
                this._startingWorkspace = workspace;
                this._setState(Shell.AppState.STARTING);
                this.launch(timestamp, workspace, Shell.AppLaunchGpu.APP_PREF);
            } catch (e) {
                logError(e);
                this._setState(Shell.AppState.STOPPED);
                global.notify_error(_('Failed to launch “%s”'.format(
                    this.get_name())), e.message);
            }
            break;
        case Shell.AppState.RUNNING:
            this.activate_window(null, timestamp);
            break;
        }
        /* eslint-enable no-invalid-this */
    });

    m('activate', () => shellApp.activate_full(-1, 0));

    m('compare', (_om, other) => Utils.shellAppCompare(shellApp, other));

    const {destroy: defaultDestroy} = shellApp;
    shellApp.destroy = function () {
        /* eslint-disable no-invalid-this */
        this._dtdData.proxyProperties.forEach(prop => delete this[prop]);
        this._dtdData.destroy();
        this._dtdData = undefined;
        this.appInfo.destroy?.();
        this.destroy = defaultDestroy;
        defaultDestroy?.call(this);
        /* eslint-enable no-invalid-this */
    };

    return shellApp;
}

/**
 * We can't inherit from Shell.App as it's a final type, so let's patch it
 *
 * @param params
 */
function makeLocationApp(params) {
    if (!(params?.appInfo instanceof LocationAppInfo))
        throw new TypeError('Invalid location');

    const {fallbackIconName} = params;
    delete params.fallbackIconName;

    const shellApp = new Shell.App(params);
    wrapWindowsBackedApp(shellApp);

    shellApp._setDtdData({
        location: () => shellApp.appInfo.location,
        isTrash: shellApp.appInfo instanceof TrashAppInfo,
        isMountableVolume: shellApp.appInfo instanceof MountableVolumeAppInfo,
    }, {getter: true, enumerable: true});

    shellApp._mi('toString', defaultToString =>
        '[LocationApp "%s" - %s]'.format(shellApp.get_id(),
            defaultToString.call(shellApp)));

    shellApp._mi('launch', (_om, timestamp, workspace, _gpuPref) =>
        shellApp.appInfo.launch([],
            global.create_app_launch_context(timestamp, workspace)));

    shellApp._mi('launch_action', (_om, actionName, ...args) =>
        shellApp.appInfo.launchAction(actionName, ...args));

    shellApp._mi('create_icon_texture', (_om, iconSize) => new St.Icon({
        iconSize,
        gicon: shellApp.icon,
        fallbackIconName,
    }));

    shellApp._mi('can_open_new_window', () => {
        try {
            if (!shellApp.get_n_windows())
                return true;

            const handlerApp = shellApp.appInfo.getHandlerApp();

            if (handlerApp.has_key('SingleMainWindow'))
                return !handlerApp.get_boolean('SingleMainWindow');

            if (handlerApp.has_key('X-GNOME-SingleWindow'))
                return !handlerApp.get_boolean('X-GNOME-SingleWindow');

            // We can always open a new window via --new-window or gio open
            return true;
        } catch {
            return false;
        }
    });

    shellApp._mi('open_new_window', function (_om, workspace) {
        /* eslint-disable no-invalid-this */
        const context = global.create_app_launch_context(0, workspace);
        const uri = this.appInfo.location?.get_uri();
        if (!this.get_n_windows()) {
            this.appInfo.launch([], context);
            return;
        }

        // Try the handler app's executable with --new-window first,
        // falling back to gio open for any handler that doesn't support it
        try {
            const handlerApp = this.appInfo.getHandlerApp();
            const commandline = handlerApp?.get_commandline();
            if (commandline) {
                const [executable] = commandline.split(/\s+/).filter(a => a);
                const subprocess = new Gio.Subprocess({
                    argv: [executable, '--new-window', uri],
                    flags: Gio.SubprocessFlags.NONE,
                });
                subprocess.init(null);
                return;
            }
        } catch {
            // Handler app not available or launch failed
        }

        // Fallback: use gio open which delegates to the default handler
        try {
            const subprocess = new Gio.Subprocess({
                argv: ['gio', 'open', uri],
                flags: Gio.SubprocessFlags.NONE,
            });
            subprocess.init(null);
        } catch (e) {
            logError(e, 'Failed to open new window for %s'.format(uri));
        }
        /* eslint-enable no-invalid-this */
    });

    if (shellApp.appInfo instanceof MountableVolumeAppInfo) {
        shellApp._mi('get_busy', function (parentGetBusy) {
            /* eslint-disable no-invalid-this */
            if (this.appInfo.busy)
                return true;
            return parentGetBusy.call(this);
            /* eslint-enable no-invalid-this */
        });
        shellApp._pi('busy', {get: () => shellApp.get_busy()});
        shellApp._signalConnections.add(shellApp.appInfo, 'notify::busy', _ =>
            shellApp.notify('busy'));
    }

    shellApp._mi('get_windows', function () {
        /* eslint-disable no-invalid-this */
        if (this._needsResort)
            this._sortWindows();
        return this._windows;
        /* eslint-enable no-invalid-this */
    });

    const {fm1Client} = Docking.DockManager.getDefault();
    shellApp._setDtdData({
        _needsResort: true,

        _windowsOrderChanged() {
            this._needsResort = true;
            this.emit('windows-changed');
        },

        _sortWindows() {
            this._windows.sort(Utils.shellWindowsCompare);
            this._needsResort = false;
        },

        _updateWindows() {
            if (!fm1Client)
                return;
            const windows = fm1Client.getWindows(this.location?.get_uri()).sort(
                Utils.shellWindowsCompare);
            const {windowsChanged} = this._setWindows(windows);

            if (!windowsChanged)
                return;

            this._signalConnections.removeWithLabel(Labels.LOCATION_WINDOWS);
            windows.forEach(w =>
                this._signalConnections.addWithLabel(Labels.LOCATION_WINDOWS, w,
                    'notify::user-time', () => {
                        if (w !== this._windows[0])
                            this._windowsOrderChanged();
                    }));
        },
    }, {readOnly: false});

    if (fm1Client) {
        shellApp._signalConnections.add(fm1Client, 'windows-changed', () =>
            shellApp._updateWindows());
    }
    shellApp._signalConnections.add(shellApp.appInfo, 'notify::icon', () =>
        shellApp.notify('icon'));
    shellApp._signalConnections.add(global.workspaceManager,
        'workspace-switched', () => shellApp._windowsOrderChanged());

    return shellApp;
}

/**
 *
 */
function getFileManagerApp() {
    return Shell.AppSystem.get_default().lookup_app(FILE_MANAGER_DESKTOP_APP_ID);
}

/**
 *
 */
export function wrapFileManagerApp() {
    const fileManagerApp = getFileManagerApp();
    if (!fileManagerApp)
        return null;

    if (fileManagerApp._dtdData)
        return fileManagerApp;

    const originalGetWindows = fileManagerApp.get_windows;
    wrapWindowsBackedApp(fileManagerApp);

    const {removables, trash} = Docking.DockManager.getDefault();
    fileManagerApp._signalConnections.addWithLabel(Labels.WINDOWS_CHANGED,
        fileManagerApp, 'windows-changed', () => {
            fileManagerApp.stop_emission_by_name('windows-changed');
            // Let's wait for the location app to take control before of us
            const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                fileManagerApp._sources.delete(id);
                fileManagerApp._updateWindows();
                return GLib.SOURCE_REMOVE;
            });
            fileManagerApp._sources.add(id);
        });

    fileManagerApp._signalConnections.add(global.workspaceManager,
        'workspace-switched', () => {
            fileManagerApp._signalConnections.blockWithLabel(Labels.WINDOWS_CHANGED);
            fileManagerApp.emit('windows-changed');
            fileManagerApp._signalConnections.unblockWithLabel(Labels.WINDOWS_CHANGED);
        });

    if (removables) {
        fileManagerApp._signalConnections.add(removables, 'changed', () =>
            fileManagerApp._updateWindows());
        fileManagerApp._signalConnections.add(removables, 'windows-changed', () =>
            fileManagerApp._updateWindows());
    }

    if (trash?.getApp()) {
        fileManagerApp._signalConnections.add(trash.getApp(), 'windows-changed', () =>
            fileManagerApp._updateWindows());
    }

    fileManagerApp._updateWindows = function () {
        const locationWindows = [];
        getRunningApps().forEach(a => locationWindows.push(...a.get_windows()));
        const windows = originalGetWindows.call(this).filter(w =>
            !locationWindows.includes(w));

        this._signalConnections.blockWithLabel(Labels.WINDOWS_CHANGED);
        this._setWindows(windows);
        this._signalConnections.unblockWithLabel(Labels.WINDOWS_CHANGED);
    };

    fileManagerApp._mi('toString', defaultToString =>
        '[FileManagerApp - %s]'.format(defaultToString.call(fileManagerApp)));

    return fileManagerApp;
}

/**
 *
 */
export function unWrapFileManagerApp() {
    const fileManagerApp = getFileManagerApp();
    if (!fileManagerApp || !fileManagerApp._dtdData)
        return;

    fileManagerApp.destroy();
}

/**
 * This class maintains a Shell.App representing the Trash and keeps it
 * up-to-date as the trash fills and is emptied over time.
 */
export class Trash {
    destroy() {
        this._trashApp?.destroy();
    }

    _ensureApp() {
        if (this._trashApp)
            return;

        this._trashApp = makeLocationApp({
            appInfo: new TrashAppInfo(new Gio.Cancellable()),
            fallbackIconName: FALLBACK_TRASH_ICON,
        });
    }

    getApp() {
        this._ensureApp();
        return this._trashApp;
    }
}

// ── Category Icon ─────────────────────────────────────────────────────────────

/**
 * Generates a unique ID for a new user category.
 */
export function generateCategoryId() {
    return `cat_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

/**
 * Computes the category label from the first four app names (comma-separated).
 */
export function getCategoryLabel(appIds) {
    const appSystem = Shell.AppSystem.get_default();
    return appIds
        .map(id => appSystem.lookup_app(id))
        .filter(a => a !== null)
        .sort((a, b) => a.get_name().localeCompare(b.get_name()))
        .slice(0, 4)
        .map(a => a.get_name())
        .join(', ');
}

/**
 * 2x2 Composite-Icon Widget that shows up to four App-Icons at reduced size.
 */
const CategoryCompositeIcon = GObject.registerClass(
class CategoryCompositeIcon extends St.Widget {
    constructor(appIds, iconSize) {
        super({layout_manager: new Clutter.BinLayout()});
        this._appIds = appIds ?? [];
        this._iconSize = iconSize ?? 48;
        this._build();
    }

    update(appIds, iconSize) {
        if (appIds !== undefined)
            this._appIds = appIds;
        if (iconSize !== undefined)
            this._iconSize = iconSize;
        this._build();
    }

    _build() {
        this.destroy_all_children();
        const appSystem = Shell.AppSystem.get_default();
        const apps = this._appIds
            .map(id => appSystem.lookup_app(id))
            .filter(a => a !== null)
            .sort((a, b) => a.get_name().localeCompare(b.get_name()))
            .slice(0, 4);

        if (apps.length === 0)
            return;

        const size = this._iconSize;
        this.set_size(size, size);

        if (apps.length === 1) {
            this.add_child(apps[0].create_icon_texture(size));
            return;
        }

        const subSize = Math.floor((size - 2) / 2);
        const rows = apps.length <= 2 ? 1 : 2;
        const grid = new St.BoxLayout({vertical: true});
        grid.style = 'spacing: 2px;';

        for (let r = 0; r < rows; r++) {
            const row = new St.BoxLayout({vertical: false});
            row.style = 'spacing: 2px;';
            for (let i = r * 2; i < Math.min(r * 2 + 2, apps.length); i++)
                row.add_child(apps[i].create_icon_texture(subSize));
            grid.add_child(row);
        }
        this.add_child(grid);
    }
});

/**
 * An Icon-Grid-Panel that appears above the dock when
 * a Category Icon is clicked.
 * Shows apps from the user category (explicit app list), alphabetically sorted.
 */
class CategoryPanel {
    constructor(sourceActor, categoryData, onClose) {
        this._sourceActor = sourceActor;
        this._categoryData = categoryData;
        this._onClose = onClose;

        const {mainDock} = Docking.DockManager.getDefault();
        this._iconSize = mainDock?.dash?.iconSize ?? 48;
        this._position = Utils.getPosition();

        // Outermost container — mirrors #dashtodockContainer so that
        // all CSS selectors from _stylesheet.scss apply.
        this.actor = new St.Widget({
            name: 'dashtodockContainer',
            style_class: Theming.PositionStyleClass[this._position],
            offscreen_redirect: Clutter.OffscreenRedirect.ALWAYS,
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            visible: false,
        });

        // Inner #dash-Actor — corresponds to the DockDash widget
        this._dashActor = new St.Widget({
            name: 'dash',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
        });

        // dashtodockDashContainer — as in DockDash
        this._dashContainer = new St.BoxLayout({
            name: 'dashtodockDashContainer',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            vertical: true,
            x_expand: true,
            y_expand: true,
        });

        // dashtodockBoxContainer — as in DockDash, with position class
        this._boxContainer = new St.BoxLayout({
            name: 'dashtodockBoxContainer',
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
            vertical: true,
        });
        this._boxContainer.add_style_class_name(Theming.PositionStyleClass[this._position]);

        // dash-background — as in DockDash
        this._background = new St.Widget({
            style_class: 'dash-background',
            x_expand: true,
            y_expand: true,
        });

        const sizerBox = new Clutter.Actor();
        sizerBox.add_constraint(new Clutter.BindConstraint({
            source: this._dashContainer,
            coordinate: Clutter.BindCoordinate.HEIGHT,
        }));
        sizerBox.add_constraint(new Clutter.BindConstraint({
            source: this._dashContainer,
            coordinate: Clutter.BindCoordinate.WIDTH,
        }));
        this._background.add_child(sizerBox);

        this._buildGrid(mainDock);

        this._dashContainer.add_child(this._boxContainer);
        this._dashActor.add_child(this._background);
        this._dashActor.add_child(this._dashContainer);
        this.actor.add_child(this._dashActor);

        Main.uiGroup.add_child(this.actor);
    }

    _buildGrid(mainDock) {
        const categoryId = this._categoryData?.id;
        const appSystem = Shell.AppSystem.get_default();
        const apps = (this._categoryData?.apps ?? [])
            .map(id => appSystem.lookup_app(id))
            .filter(a => a !== null)
            .sort((a, b) => a.get_name().localeCompare(b.get_name()));

        const appCount = apps.length;
        if (appCount === 0)
            return;

        const columns = Math.ceil(Math.sqrt(appCount));
        const rows = Math.ceil(appCount / columns);
        const {dash} = mainDock;

        for (let r = 0; r < rows; r++) {
            const rowBox = new St.BoxLayout({
                vertical: false,
                style_class: 'app-grid-row',
            });

            for (let c = 0; c < columns; c++) {
                const index = r * columns + c;
                const app = apps[index];

                if (app) {
                    const item = dash.createPanelItem(app);
                    // Panel items are drag-capable — drag-begin closes the panel
                    // so the dock can receive the drop.
                    if (item.child?._draggable) {
                        item.child._d2dInCategoryId = categoryId;
                        item.child._draggable.connect('drag-begin', () => {
                            // Visually hide panel, but keep isOpen=true so that
                            // requiresVisibility=true remains and the dock stays visible
                            this.actor.hide();
                            if (this._overlay)
                                this._overlay.hide();
                        });
                        item.child._draggable.connect('drag-end', () => {
                            // Now actually close (releases requiresVisibility)
                            this.actor.show();
                            this.close();
                        });
                    }
                    item.show(false);
                    // Disable CSS transitions (prevents squish effect on open)
                    item.set_style('transition-duration: 0ms;');
                    if (item.child)
                        item.child.set_style('transition-duration: 0ms;');
                    item.child?.connectObject('clicked', () => this.close(), this.actor);
                    rowBox.add_child(item);
                } else {
                    rowBox.add_child(new St.Bin({
                        width: this._iconSize + 16,
                        height: this._iconSize + 16,
                    }));
                }
            }
            this._boxContainer.add_child(rowBox);
        }
    }

    _syncTheme() {
        const {mainDock} = Docking.DockManager.getDefault();
        if (!mainDock)
            return;

        // Copy style classes from the dock container onto our outer actor
        // so that CSS selectors like .dashtodock, .shrink, .straight-corner apply.
        const positionClasses = new Set(Theming.PositionStyleClass);
        const dockClasses = (mainDock.style_class ?? '').split(/\s+/).filter(Boolean);

        // Remove old synced classes
        if (this._syncedClasses)
            this._syncedClasses.forEach(c => this.actor.remove_style_class_name(c));

        // Apply new classes (except position classes which we set ourselves)
        this._syncedClasses = dockClasses.filter(c => !positionClasses.has(c));
        this._syncedClasses.forEach(c => this.actor.add_style_class_name(c));

        // Copy inline style from dock background (contains color, transparency, border)
        const bgStyle = mainDock.dash._background.get_style();
        this._background.set_style(bgStyle ?? null);
    }

    open() {
        this.isOpen = true;

        // Keep dock visible while panel is open
        this._dash = Docking.DockManager.getDefault().mainDock?.dash;
        if (this._dash)
            this._dash.requiresVisibility = true;

        this._syncTheme();

        // Pivot-Point towards dock so the panel grows out of the icon
        switch (this._position) {
        case St.Side.BOTTOM:
            this.actor.set_pivot_point(0.5, 1.0);
            break;
        case St.Side.TOP:
            this.actor.set_pivot_point(0.5, 0.0);
            break;
        case St.Side.LEFT:
            this.actor.set_pivot_point(0.0, 0.5);
            break;
        case St.Side.RIGHT:
            this.actor.set_pivot_point(1.0, 0.5);
            break;
        default:
            this.actor.set_pivot_point(0.5, 1.0);
        }
        // scale=0 is CSS-immune: at scale=0 the actor is invisible
        this.actor.set({scale_x: 0, scale_y: 0});
        this.actor.set_position(-10000, -10000);
        this.actor.show();

        // notify::allocation: first layout pass of our actor.
        // The sizerBox BindConstraint triggers a second layout pass.
        // Wait for after-paint so get_preferred_size() returns stable values.
        const allocationId = this.actor.connect('notify::allocation', () => {
            this.actor.disconnect(allocationId);
            if (!this.isOpen)
                return;
            this._reposition();

            const paintId = global.stage.connect('after-paint', () => {
                global.stage.disconnect(paintId);
                if (!this.isOpen)
                    return;
                this._reposition();
                // Freeze size to prevent external relayouts from resizing the panel
                const [, , w, h] = this.actor.get_preferred_size();
                this.actor.set_size(w, h);
                this.actor.ease({
                    scale_x: 1.0,
                    scale_y: 1.0,
                    duration: 220,
                    mode: Clutter.AnimationMode.EASE_OUT_EXPO,
                    onComplete: () => this._reposition(),
                });
            });
        });

        // Raise dock-icon labels above our panel (z-order fix)
        Main.uiGroup.get_children().forEach(child => {
            if (child.style_class?.includes('dash-label'))
                Main.uiGroup.set_child_above_sibling(child, this.actor);
        });

        // Close panel when dock hides — connect with delay
        const {mainDock} = Docking.DockManager.getDefault();
        if (mainDock) {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {
                if (!this.isOpen)
                    return GLib.SOURCE_REMOVE;
                this._dockHidingId = mainDock.connect('hiding', () => this.close());
                return GLib.SOURCE_REMOVE;
            });
        }

        // Transparent overlay over the entire screen — catches all clicks
        // outside the panel (same technique as PopupMenuManager)
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            if (!this.isOpen)
                return GLib.SOURCE_REMOVE;

            const monitor = Main.layoutManager.primaryMonitor;
            this._overlay = new Clutter.Actor({
                reactive: true,
                x: monitor.x,
                y: monitor.y,
                width: monitor.width,
                height: monitor.height,
                opacity: 0,
            });
            this._overlay.connect('button-press-event', (_actor, event) => {
                const [ex, ey] = event.get_coords();
                const [ax, ay] = this.actor.get_transformed_position();
                const aw = this.actor.get_width();
                const ah = this.actor.get_height();
                // Inside the panel -> pass event through
                if (ex >= ax && ex <= ax + aw && ey >= ay && ey <= ay + ah) {
                    this._overlay.reactive = false;
                    return Clutter.EVENT_PROPAGATE;
                }
                this.close();
                return Clutter.EVENT_STOP;
            });
            // Insert overlay below the panel
            Main.uiGroup.insert_child_below(this._overlay, this.actor);
            return GLib.SOURCE_REMOVE;
        });
    }

    _reposition() {
        if (!this.actor || !this._sourceActor)
            return;

        const [stageX, stageY] = this._sourceActor.get_transformed_position();
        const iconW = this._sourceActor.get_width();
        const iconH = this._sourceActor.get_height();
        const monitor = Main.layoutManager.findMonitorForActor(this._sourceActor);
        const [, , panelW, panelH] = this.actor.get_preferred_size();

        const gap = 6;
        let panelX, panelY;

        switch (this._position) {
        case St.Side.BOTTOM:
            panelX = Math.round(stageX + (iconW / 2) - (panelW / 2));
            panelY = Math.round(stageY - panelH - gap);
            panelX = Math.max(monitor.x + gap,
                Math.min(panelX, monitor.x + monitor.width - panelW - gap));
            break;
        case St.Side.TOP:
            panelX = Math.round(stageX + (iconW / 2) - (panelW / 2));
            panelY = Math.round(stageY + iconH + gap);
            panelX = Math.max(monitor.x + gap,
                Math.min(panelX, monitor.x + monitor.width - panelW - gap));
            break;
        case St.Side.LEFT:
            panelX = Math.round(stageX + iconW + gap);
            panelY = Math.round(stageY + (iconH / 2) - (panelH / 2));
            panelY = Math.max(monitor.y + gap,
                Math.min(panelY, monitor.y + monitor.height - panelH - gap));
            break;
        case St.Side.RIGHT:
            panelX = Math.round(stageX - panelW - gap);
            panelY = Math.round(stageY + (iconH / 2) - (panelH / 2));
            panelY = Math.max(monitor.y + gap,
                Math.min(panelY, monitor.y + monitor.height - panelH - gap));
            break;
        default:
            panelX = Math.round(stageX + (iconW / 2) - (panelW / 2));
            panelY = Math.round(stageY - panelH - gap);
        }

        this.actor.set_position(panelX, panelY);
    }

    close() {
        if (!this.isOpen)
            return;
        this.isOpen = false;

        // Allow dock to hide normally again
        if (this._dash) {
            this._dash.requiresVisibility = false;
            this._dash = null;
        }

        if (this._dockHidingId) {
            Docking.DockManager.getDefault().mainDock?.disconnect(this._dockHidingId);
            this._dockHidingId = null;
        }
        if (this._overlay) {
            this._overlay.destroy();
            this._overlay = null;
        }
        this._onClose?.();
        this.actor?.ease({
            scale_x: 0,
            scale_y: 0,
            duration: 150,
            mode: Clutter.AnimationMode.EASE_IN_BACK,
            onComplete: () => this.destroy(),
        });
    }

    destroy() {
        if (this._dockHidingId) {
            Docking.DockManager.getDefault().mainDock?.disconnect(this._dockHidingId);
            this._dockHidingId = null;
        }
        if (this._overlay) {
            this._overlay.destroy();
            this._overlay = null;
        }
        this.actor?.destroy();
        this.actor = null;
    }
}

/**
 * Holds a Shell.App object for a user-category icon,
 * analogous to the Trash class but without its own AppInfo subclass.
 * config: {id, apps: [appId, ...]}
 *
 * The icon shows a 2x2 composite of the first four app icons.
 * The label is auto-composed from the names of the first four apps.
 */
export class CategoryIcon {
    constructor(config) {
        this._config = config ?? {id: generateCategoryId(), apps: []};
    }

    get position() {
        return this._config.position ?? -1;
    }

    get config() {
        return this._config;
    }

    updateConfig(config) {
        const appsChanged = JSON.stringify(config.apps) !== JSON.stringify(this._config.apps);
        this._config = config;
        if (appsChanged) {
            // Re-render composite icon
            if (this._baseIcon)
                this._baseIcon._createIconTexture(this._baseIcon.iconSize);
            // Update app label
            if (this._app) {
                const newLabel = getCategoryLabel(config.apps);
                this._app.appInfo._name = newLabel;
                // Update category data on the app object
                if (this._app._categoryData)
                    this._app._categoryData.apps = [...config.apps];
            }
        }
    }

    destroy() {
        this._panel?.destroy();
        this._panel = null;
        this._baseIcon = null;
        this._app?.destroy();
        this._app = null;
    }

    _ensureApp() {
        if (this._app)
            return;

        const label = getCategoryLabel(this._config.apps);
        const appInfo = new LocationAppInfo({
            name: label || 'Category',
            icon: Gio.ThemedIcon.new('view-grid-symbolic'),
            cancellable: new Gio.Cancellable(),
        });

        this._app = makeLocationApp({
            appInfo,
            fallbackIconName: 'view-grid-symbolic',
        });

        this._app._setDtdData({isCustom: true}, {getter: true, enumerable: true});
        // Category data accessible for drag & drop handlers
        this._app._setDtdData({
            _categoryData: {id: this._config.id, apps: [...this._config.apps]},
        }, {getter: true, enumerable: true});
        // Back-reference to the CategoryIcon object (for composite icon rendering)
        this._app._categoryIconInstance = this;

        this._app._mi('can_open_new_window', () => false);
        this._app._mi('open_new_window', () => {});

        // activate() -> toggle panel
        const self = this;
        this._app._mi('activate', () => {
            if (self._sourceActor)
                self.togglePanel(self._sourceActor);
        });
    }

    getApp() {
        this._ensureApp();
        return this._app;
    }

    /**
     * Creates a fresh CategoryCompositeIcon (no caching,
     * since BaseIcon destroys the previous one via destroy()).
     */
    createCompositeIcon(iconSize) {
        return new CategoryCompositeIcon(this._config.apps, iconSize);
    }

    /**
     * Called by the AppIcon when the icon is clicked.
     * Opens/closes the panel above the dock.
     */
    togglePanel(sourceActor) {
        if (this._panel) {
            this._panel.close();
            this._panel = null;
            return;
        }

        this._panel = new CategoryPanel(sourceActor, this._config, () => {
            this._panel = null;
        });
        this._panel.open();
    }
}

/**
 * This class maintains Shell.App representations for removable devices
 * plugged into the system, and keeps the list of Apps up-to-date as
 * devices come and go and are mounted and unmounted.
 */
export class Removables {
    static initVolumePromises(object) {
        // TODO: This can be simplified using actual interface type when we
        // can depend on gjs 1.72
        if (!(object instanceof Gio.Volume) || object.constructor.prototype._d2dPromisified)
            return;

        Gio._promisify(object.constructor.prototype, 'mount', 'mount_finish');
        Gio._promisify(object.constructor.prototype, 'eject_with_operation',
            'eject_with_operation_finish');
        object.constructor.prototype._d2dPromisified = true;
    }

    static initMountPromises(object) {
        // TODO: This can be simplified using actual interface type when we
        // can depend on gjs 1.72
        if (!(object instanceof Gio.Mount) || object.constructor.prototype._d2dPromisified)
            return;

        Gio._promisify(object.constructor.prototype, 'eject_with_operation',
            'eject_with_operation_finish');
        Gio._promisify(object.constructor.prototype, 'unmount_with_operation',
            'unmount_with_operation_finish');
        object.constructor.prototype._d2dPromisified = true;
    }

    constructor() {
        this._signalsHandler = new Utils.GlobalSignalsHandler();

        this._monitor = Gio.VolumeMonitor.get();
        this._cancellable = new Gio.Cancellable();

        this._monitor.get_mounts().forEach(m => Removables.initMountPromises(m));
        this._updateVolumes();

        this._signalsHandler.add([
            this._monitor,
            'volume-added',
            (_, volume) => this._onVolumeAdded(volume),
        ], [
            this._monitor,
            'volume-removed',
            (_, volume) => this._onVolumeRemoved(volume),
        ], [
            this._monitor,
            'mount-added',
            (_, mount) => this._onMountAdded(mount),
        ], [
            this._monitor,
            'mount-removed',
            (_, mount) => this._onMountRemoved(mount),
        ], [
            Docking.DockManager.settings,
            'changed::show-mounts-only-mounted',
            () => this._updateVolumes(),
        ], [
            Docking.DockManager.settings,
            'changed::show-mounts-network',
            () => this._updateVolumes(),
        ]);
    }

    destroy() {
        this._volumeApps.forEach(a => a.destroy());
        this._volumeApps = [];
        this._cancellable.cancel();
        this._cancellable = null;
        this._signalsHandler.destroy();
        this._monitor = null;
    }

    _updateVolumes() {
        this._volumeApps?.forEach(a => a.destroy());
        this._volumeApps = [];
        this.emit('changed');

        this._monitor.get_volumes().forEach(v => this._onVolumeAdded(v));

        // Also pick up mounts that have no associated GVolume (e.g. systemd
        // .mount/.automount units, or fstab entries managed outside udisks).
        // These mounts are visible in Nautilus but have no GVolume object.
        this._monitor.get_mounts().forEach(m => {
            if (!m.get_volume())
                this._onVolumelessMountAdded(m);
        });
    }

    _onVolumeAdded(volume) {
        Removables.initVolumePromises(volume);

        if (!Docking.DockManager.settings.showMountsNetwork &&
            volume.get_identifier('class') === 'network')
            return;


        const mount = volume.get_mount();
        if (mount) {
            if (mount.is_shadowed())
                return;
            if (!mount.can_eject() && !mount.can_unmount())
                return;
        } else {
            if (Docking.DockManager.settings.showMountsOnlyMounted)
                return;
            if (!volume.can_mount() && !volume.can_eject())
                return;
        }

        const appInfo = new MountableVolumeAppInfo(volume,
            new Utils.CancellableChild(this._cancellable));
        const volumeApp = makeLocationApp({
            appInfo,
            fallbackIconName: FALLBACK_REMOVABLE_MEDIA_ICON,
        });

        volumeApp._signalConnections.add(volumeApp, 'windows-changed',
            () => this.emit('windows-changed', volumeApp));

        if (Docking.DockManager.settings.showMountsOnlyMounted) {
            volumeApp._signalConnections.add(appInfo, 'notify::mount',
                () => !appInfo.mount && this._onVolumeRemoved(appInfo.volume));
        }

        this._volumeApps.push(volumeApp);
        this.emit('changed');
    }

    _onVolumeRemoved(volume) {
        const volumeIndex = this._volumeApps.findIndex(({appInfo}) =>
            appInfo.volume === volume);
        if (volumeIndex !== -1) {
            const [volumeApp] = this._volumeApps.splice(volumeIndex, 1);
            // We don't care about cancelling the ongoing operations from now on.
            volumeApp.appInfo.cancellable = null;
            volumeApp.destroy();
            this.emit('changed');
        }
    }

    _onMountRemoved(mount) {
        // Clean up volume-less mount apps (systemd mounts, etc.)
        const mountIndex = this._volumeApps.findIndex(app =>
            app._volumelessMount === mount);
        if (mountIndex !== -1) {
            const [mountApp] = this._volumeApps.splice(mountIndex, 1);
            mountApp.appInfo.cancellable = null;
            mountApp.destroy();
            this.emit('changed');
        }
    }

    _onVolumelessMountAdded(mount) {
        Removables.initMountPromises(mount);

        if (mount.is_shadowed())
            return;
        if (!mount.can_eject() && !mount.can_unmount())
            return;

        // Check for duplicate
        if (this._volumeApps.find(({appInfo}) => appInfo.mount === mount))
            return;

        const location = mount.get_default_location();
        const appInfo = new LocationAppInfo({
            location,
            name: mount.get_name(),
            icon: mount.get_icon(),
            cancellable: new Utils.CancellableChild(this._cancellable),
        });

        const mountApp = makeLocationApp({
            appInfo,
            fallbackIconName: FALLBACK_REMOVABLE_MEDIA_ICON,
        });

        // Tag for removal tracking
        mountApp._volumelessMount = mount;

        mountApp._signalConnections.add(mountApp, 'windows-changed',
            () => this.emit('windows-changed', mountApp));

        this._volumeApps.push(mountApp);
        this.emit('changed');
    }

    _onMountAdded(mount) {
        Removables.initMountPromises(mount);

        const volume = mount.get_volume();
        if (volume) {
            if (!Docking.DockManager.settings.showMountsOnlyMounted)
                return;

            if (!this._volumeApps.find(({appInfo}) => appInfo.mount === mount))
                this._onVolumeAdded(volume);
        } else {
            // Volume-less mount (systemd, fstab, etc.)
            this._onVolumelessMountAdded(mount);
        }
    }

    getApps() {
        return this._volumeApps;
    }
}
Signals.addSignalMethods(Removables.prototype);

/**
 *
 */
function getApps() {
    const dockManager = Docking.DockManager.getDefault();
    const locationApps = [];

    if (dockManager.removables)
        locationApps.push(...dockManager.removables.getApps());

    if (dockManager.trash)
        locationApps.push(dockManager.trash.getApp());

    return locationApps;
}

/**
 *
 */
export function getRunningApps() {
    return getApps().filter(a => a.state === Shell.AppState.RUNNING);
}

/**
 *
 */
export function getStartingApps() {
    return getApps().filter(a => a.state === Shell.AppState.STARTING);
}
