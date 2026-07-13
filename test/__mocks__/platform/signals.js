const _connections = new Map();
let _nextId = 1;
const _emitted = [];

export function connect(target, signal, callback) {
    const id = _nextId++;
    const key = target._signalKey || (target._signalKey = Symbol());
    if (!_connections.has(key)) _connections.set(key, []);
    _connections.get(key).push({id, signal, callback});
    return id;
}
export function disconnect(target, id) {
    const key = target._signalKey;
    if (!key || !_connections.has(key)) return;
    const conns = _connections.get(key);
    const idx = conns.findIndex(c => c.id === id);
    if (idx >= 0) conns.splice(idx, 1);
}
export function emit(target, signal, ...args) {
    _emitted.push({target, signal, args});
    const key = target._signalKey;
    if (!key || !_connections.has(key)) return;
    for (const c of _connections.get(key)) {
        if (c.signal === signal) c.callback(target, ...args);
    }
}
export function connectNotify(target, property, callback) {
    return connect(target, 'notify::' + property, callback);
}
// Test helpers
export function _reset() { _connections.clear(); _nextId = 1; _emitted.length = 0; }
export function _getEmitted() { return [..._emitted]; }
export function _getConnections(target) { const k = target._signalKey; return k ? (_connections.get(k) || []) : []; }
