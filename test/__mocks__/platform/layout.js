let _monitors = [{x: 0, y: 0, width: 1920, height: 1080, index: 0}];
let _primaryIndex = 0;
let _overviewVisible = false;
let _startingUp = false;
let _stageWidth = 1920;
let _stageHeight = 1080;

export function getMonitors() { return _monitors; }
export function getPrimaryMonitor() { return _monitors[_primaryIndex]; }
export function getPrimaryIndex() { return _primaryIndex; }
export function getWorkArea(monitorIndex) {
    const m = _monitors[monitorIndex] || _monitors[0];
    return {x: m.x, y: m.y, width: m.width, height: m.height - 28};
}
export function findMonitorForActor() { return 0; }
export function isOverviewVisible() { return _overviewVisible; }
export function isOverviewAnimating() { return false; }
export function isStartingUp() { return _startingUp; }
export function hideOverview() { _overviewVisible = false; }
export function addChrome() {}
export function removeChrome() {}
export function untrackChrome() {}
export function getStage() { return {width: _stageWidth, height: _stageHeight, get_children: () => []}; }
export function getScreenWidth() { return _stageWidth; }
export function getScreenHeight() { return _stageHeight; }
export function activateWindow() {}

// Test helpers
export function _reset() { _monitors = [{x:0,y:0,width:1920,height:1080,index:0}]; _primaryIndex = 0; _overviewVisible = false; _startingUp = false; _stageWidth = 1920; _stageHeight = 1080; }
export function _setMonitors(m) { _monitors = m; }
export function _setPrimaryIndex(i) { _primaryIndex = i; }
export function _setOverviewVisible(v) { _overviewVisible = v; }
export function _setStartingUp(v) { _startingUp = v; }
export function _setScreenSize(w, h) { _stageWidth = w; _stageHeight = h; }
