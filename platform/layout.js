import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export function getMonitors() { return Main.layoutManager.monitors; }
export function getPrimaryMonitor() { return Main.layoutManager.primaryMonitor; }
export function getPrimaryIndex() { return Main.layoutManager.primaryIndex; }
export function getWorkArea(monitorIndex) { return Main.layoutManager.getWorkAreaForMonitor(monitorIndex); }
export function findMonitorForActor(actor) { return Main.layoutManager.findIndexForActor(actor); }
export function isOverviewVisible() { return Main.overview.visible; }
export function isOverviewAnimating() { return Main.overview.animationInProgress; }
export function isStartingUp() { return Main.layoutManager._startingUp; }
export function hideOverview() { Main.overview.hide(); }
export function addChrome(actor, params) { Main.layoutManager.addChrome(actor, params); }
export function removeChrome(actor) { Main.layoutManager.removeChrome(actor); }
export function untrackChrome(actor) { Main.layoutManager.untrackChrome(actor); }
export function getStage() { return global.stage; }
export function getScreenWidth() { return global.stage.width; }
export function getScreenHeight() { return global.stage.height; }
export function activateWindow(window) { Main.activateWindow(window); }
