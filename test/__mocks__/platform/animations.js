const _timeouts = new Map();
let _nextId = 1;
const _easeLog = [];

export function ease(actor, props) { _easeLog.push({actor, props}); }
export function setEasingDuration(actor, ms) { actor.easingDuration = ms; }
export function setEasingMode(actor, mode) { actor.easingMode = mode; }
export function createTimeline(params) { return {params, running: false, start() { this.running = true; }, stop() { this.running = false; }}; }
export function addTimeout(priority, ms, callback) { const id = _nextId++; _timeouts.set(id, {priority, ms, callback, type: 'timeout'}); return id; }
export function addTimeoutSeconds(priority, s, callback) { return addTimeout(priority, s * 1000, callback); }
export function addIdle(priority, callback) { const id = _nextId++; _timeouts.set(id, {priority, ms: 0, callback, type: 'idle'}); return id; }
export function removeSource(id) { _timeouts.delete(id); }
export const SOURCE_REMOVE = false;
export const SOURCE_CONTINUE = true;
export const PRIORITY_DEFAULT = 0;
// Test helpers
export function _reset() { _timeouts.clear(); _nextId = 1; _easeLog.length = 0; }
export function _fireTimeout(id) { const t = _timeouts.get(id); if (t) { const r = t.callback(); if (r === SOURCE_REMOVE) _timeouts.delete(id); } }
export function _fireAllTimeouts() { for (const [id] of [..._timeouts]) _fireTimeout(id); }
export function _fireAllIdles() { for (const [id, t] of [..._timeouts]) { if (t.type === 'idle') _fireTimeout(id); } }
export function _getEaseLog() { return [..._easeLog]; }
export function _getPendingTimeouts() { return [..._timeouts.entries()]; }
