// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: Contributors to XDock
// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

import {
    Gio,
    GioUnix,
    GLib,
    GObject,
    Shell,
    St,
} from '../dependencies/gi.js';

import {
    Docking,
    Locations,
    Utils,
} from '../imports.js';

const {signals: Signals} = imports;

const DesktopAppInfoBase = GioUnix.DesktopAppInfo;

const FALLBACK_COMMAND_ICON = 'utilities-terminal-symbolic';
const DEFAULT_TERMINAL_SCHEMA = 'org.gnome.desktop.default-applications.terminal';

/**
 * CommandAppInfo — implements enough of Gio.AppInfo for dock usage.
 *
 * Follows the same pattern as LocationAppInfo in locations.js:
 * extends DesktopAppInfoBase (GioUnix.DesktopAppInfo on newer GLib,
 * Gio.DesktopAppInfo on older systems), implements Gio.AppInfo.
 */
export const CommandAppInfo = GObject.registerClass({
    Implements: [Gio.AppInfo],
    Properties: {
        'command-id': GObject.ParamSpec.string(
            'command-id', 'command-id', 'command-id',
            GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT_ONLY,
            null),
        'label': GObject.ParamSpec.string(
            'label', 'label', 'label',
            GObject.ParamFlags.READWRITE,
            null),
        'command': GObject.ParamSpec.string(
            'command', 'command', 'command',
            GObject.ParamFlags.READWRITE,
            null),
        'icon-name': GObject.ParamSpec.string(
            'icon-name', 'icon-name', 'icon-name',
            GObject.ParamFlags.READWRITE,
            null),
        'run-in-terminal': GObject.ParamSpec.boolean(
            'run-in-terminal', 'run-in-terminal', 'run-in-terminal',
            GObject.ParamFlags.READWRITE,
            false),
        'working-dir': GObject.ParamSpec.string(
            'working-dir', 'working-dir', 'working-dir',
            GObject.ParamFlags.READWRITE,
            null),
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
}, class CommandAppInfo extends DesktopAppInfoBase {
    _init(params) {
        const iconName = params.iconName ?? FALLBACK_COMMAND_ICON;
        super._init({
            commandId: params.commandId,
            label: params.label ?? 'Command',
            command: params.command ?? '',
            iconName,
            runInTerminal: params.runInTerminal ?? false,
            workingDir: params.workingDir ?? null,
            name: params.label ?? 'Command',
            icon: Gio.ThemedIcon.new(iconName),
            cancellable: params.cancellable ?? new Gio.Cancellable(),
        });
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
        return new CommandAppInfo({
            commandId: this.commandId,
            label: this.label,
            command: this.command,
            iconName: this.iconName,
            runInTerminal: this.runInTerminal,
            workingDir: this.workingDir,
            cancellable: this.cancellable,
        });
    }

    vfunc_equal(other) {
        return this.commandId === other?.commandId;
    }

    vfunc_get_id() {
        return `pinned-command:${this.commandId}`;
    }

    vfunc_get_name() {
        return this.name;
    }

    vfunc_get_description() {
        return this.command;
    }

    vfunc_get_executable() {
        return null;
    }

    vfunc_get_icon() {
        return this.icon;
    }

    vfunc_launch(_files, _context) {
        this._executeCommand();
        return true;
    }

    vfunc_supports_uris() {
        return false;
    }

    vfunc_supports_files() {
        return false;
    }

    vfunc_launch_uris(_uris, context) {
        return this.vfunc_launch(null, context);
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
        return this.command;
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

    /**
     * Returns the default terminal emulator command prefix.
     */
    _getTerminalCommand() {
        try {
            const termSettings = new Gio.Settings({schema_id: DEFAULT_TERMINAL_SCHEMA});
            const exec = termSettings.get_string('exec');
            const execArg = termSettings.get_string('exec-arg');
            if (exec)
                return execArg ? `${exec} ${execArg}` : `${exec} -e`;
        } catch {
            // Schema not available
        }
        // Fallback chain
        for (const term of ['gnome-terminal --', 'xterm -e', 'konsole -e']) {
            const [bin] = term.split(' ');
            if (GLib.find_program_in_path(bin))
                return term;
        }
        return 'xterm -e';
    }

    /**
     * Execute the configured command.
     */
    _executeCommand() {
        if (!this.command)
            return;

        try {
            let cmdLine = this.command;

            if (this.runInTerminal) {
                const termCmd = this._getTerminalCommand();
                cmdLine = `${termCmd} ${cmdLine}`;
            }

            const flags = Gio.SubprocessFlags.NONE;
            const [success, argv] = GLib.shell_parse_argv(cmdLine);
            if (!success || !argv.length)
                return;

            const launcher = new Gio.SubprocessLauncher({flags});

            if (this.workingDir) {
                const expandedDir = this.workingDir.replace(/^~/, GLib.get_home_dir());
                launcher.set_cwd(expandedDir);
            }

            launcher.spawnv(argv);
        } catch (e) {
            logError(e, `Failed to execute pinned command: ${this.command}`);
        }
    }

    destroy() {
        this.cancellable?.cancel();
    }
});

/**
 * Creates a Shell.App-like wrapper for a CommandAppInfo,
 * following the same pattern as makeLocationApp() in locations.js.
 */
function makeCommandApp(params) {
    if (!(params?.appInfo instanceof CommandAppInfo))
        throw new TypeError('Invalid command app info');

    const {fallbackIconName} = params;
    delete params.fallbackIconName;

    const shellApp = new Shell.App(params);
    Locations.wrapWindowsBackedApp(shellApp);

    shellApp._setDtdData({
        isPinnedCommand: true,
    }, {getter: true, enumerable: true});

    shellApp._mi('toString', defaultToString =>
        '[CommandApp "%s" - %s]'.format(shellApp.get_id(),
            defaultToString.call(shellApp)));

    shellApp._mi('launch', (_om, timestamp, workspace, _gpuPref) =>
        shellApp.appInfo.launch([],
            global.create_app_launch_context(timestamp, workspace)));

    shellApp._mi('create_icon_texture', (_om, iconSize) =>
        new St.Icon({
            iconSize,
            gicon: shellApp.icon,
            fallbackIconName,
        }));

    shellApp._mi('can_open_new_window', () => false);
    shellApp._mi('open_new_window', () => {});

    shellApp._mi('activate', () => {
        shellApp.appInfo._executeCommand();
    });

    shellApp._setDtdData({
        _updateWindows() {
            // Pinned commands have no windows
            this._setWindows([]);
        },
    }, {readOnly: false});

    return shellApp;
}

/**
 * PinnedCommandsManager — manages the list of pinned commands.
 *
 * Reads/writes from GSettings key 'pinned-commands' (JSON string).
 * Each command: {id, label, command, icon, runInTerminal, workingDir}
 */
export class PinnedCommandsManager {
    constructor() {
        this._commandApps = [];
        this._signalsHandler = new Utils.GlobalSignalsHandler();

        this._signalsHandler.add(
            Docking.DockManager.settings,
            'changed::pinned-commands',
            () => this._reload()
        );

        this._reload();
    }

    destroy() {
        this._commandApps.forEach(app => app.destroy());
        this._commandApps = [];
        this._signalsHandler.destroy();
    }

    /**
     * Returns the current list of commands from settings.
     */
    getCommands() {
        try {
            const json = Docking.DockManager.settings.pinnedCommands;
            const parsed = JSON.parse(json);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    /**
     * Writes the command list back to settings.
     */
    _writeCommands(commands) {
        const settings = Docking.DockManager.getDefault()._settings;
        settings.set_string('pinned-commands', JSON.stringify(commands));
    }

    /**
     * Add a new pinned command.
     */
    addCommand(config) {
        const commands = this.getCommands();
        const id = config.id ?? `cmd_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
        commands.push({
            id,
            label: config.label ?? 'Command',
            command: config.command ?? '',
            icon: config.icon ?? FALLBACK_COMMAND_ICON,
            runInTerminal: config.runInTerminal ?? false,
            workingDir: config.workingDir ?? '',
        });
        this._writeCommands(commands);
        return id;
    }

    /**
     * Remove a pinned command by id.
     */
    removeCommand(id) {
        const commands = this.getCommands();
        const filtered = commands.filter(c => c.id !== id);
        if (filtered.length !== commands.length)
            this._writeCommands(filtered);
    }

    /**
     * Returns Shell.App wrappers for all pinned commands.
     */
    getApps() {
        return this._commandApps;
    }

    /**
     * Reload command apps from settings.
     */
    _reload() {
        const oldApps = this._commandApps;
        this._commandApps = [];

        const commands = this.getCommands();

        for (const cmd of commands) {
            if (!cmd.id || !cmd.command)
                continue;

            // Try to reuse existing app if config matches
            const existingIdx = oldApps.findIndex(app =>
                app.appInfo?.commandId === cmd.id);

            if (existingIdx >= 0) {
                const [existing] = oldApps.splice(existingIdx, 1);
                // Update mutable properties
                existing.appInfo.label = cmd.label ?? 'Command';
                existing.appInfo.name = cmd.label ?? 'Command';
                existing.appInfo.command = cmd.command;
                existing.appInfo.runInTerminal = cmd.runInTerminal ?? false;
                existing.appInfo.workingDir = cmd.workingDir ?? '';
                const newIconName = cmd.icon ?? FALLBACK_COMMAND_ICON;
                if (existing.appInfo.iconName !== newIconName) {
                    existing.appInfo.iconName = newIconName;
                    existing.appInfo.icon = Gio.ThemedIcon.new(newIconName);
                }
                this._commandApps.push(existing);
            } else {
                const appInfo = new CommandAppInfo({
                    commandId: cmd.id,
                    label: cmd.label,
                    command: cmd.command,
                    iconName: cmd.icon,
                    runInTerminal: cmd.runInTerminal,
                    workingDir: cmd.workingDir,
                    cancellable: new Gio.Cancellable(),
                });
                const app = makeCommandApp({
                    appInfo,
                    fallbackIconName: FALLBACK_COMMAND_ICON,
                });
                this._commandApps.push(app);
            }
        }

        // Destroy removed apps
        oldApps.forEach(app => app.destroy());

        this.emit('changed');
    }
}
Signals.addSignalMethods(PinnedCommandsManager.prototype);
