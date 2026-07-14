export function connect(target, signal, callback) {
    return target.connect(signal, callback);
}
export function disconnect(target, id) {
    target.disconnect(id);
}
export function emit(target, signal, ...args) {
    target.emit(signal, ...args);
}
export function connectNotify(target, property, callback) {
    return target.connect(`notify::${property}`, callback);
}
