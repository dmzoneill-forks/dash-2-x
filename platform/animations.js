import {Clutter, GLib} from '../dependencies/gi.js';

export function ease(actor, props) {
    actor.ease(props);
}
export function setEasingDuration(actor, ms) {
    actor.set_easing_duration(ms);
}
export function setEasingMode(actor, mode) {
    actor.set_easing_mode(mode);
}
export function createTimeline(params) {
    return new Clutter.Timeline(params);
}
export function addTimeout(priority, ms, callback) {
    return GLib.timeout_add(priority, ms, callback);
}
export function addTimeoutSeconds(priority, s, callback) {
    return GLib.timeout_add_seconds(priority, s, callback);
}
export function addIdle(priority, callback) {
    return GLib.idle_add(priority, callback);
}
export function removeSource(id) {
    if (id)
        GLib.source_remove(id);
}
export const {SOURCE_REMOVE} = GLib;
export const {SOURCE_CONTINUE} = GLib;
export const {PRIORITY_DEFAULT} = GLib;
