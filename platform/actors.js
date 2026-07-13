import {Clutter, St} from './dependencies/gi.js';

export function createBoxLayout(props) { return new St.BoxLayout(props); }
export function createBin(props) { return new St.Bin(props); }
export function createWidget(props) { return new St.Widget(props); }
export function createLabel(props) { return new St.Label(props); }
export function createDrawingArea(props) { return new St.DrawingArea(props); }
export function getChildren(actor) { return actor.get_children(); }
export function findChildByName(actor, name) { return actor.get_children().find(c => c.name === name); }
export function addChild(parent, child) { parent.add_child(child); }
export function removeChild(parent, child) { parent.remove_child(child); }
export function insertChildBelow(parent, child, sibling) { parent.insert_child_below(child, sibling); }
export function setScale(actor, x, y) { actor.set_scale(x, y); }
export function getScale(actor) { return actor.get_scale(); }
export function getTransformedPosition(actor) { return actor.get_transformed_position(); }
export function getTransformedSize(actor) { return actor.get_transformed_size(); }
export function setClipToAllocation(actor, clip) { actor.set_clip_to_allocation(clip); }
export function setClipToView(actor, value) { actor.clip_to_view = value; }
export function removeClip(actor) { actor.remove_clip(); }
export function setPivotPoint(actor, x, y) { actor.set_pivot_point(x, y); }
export function setZPosition(actor, z) { actor.set_z_position(z); }
export function setEasing(actor, duration, mode) { actor.set_easing_duration(duration); actor.set_easing_mode(mode); }
export function isOnStage(actor) { return actor.get_stage() !== null; }
export function isVisible(actor) { return actor.visible; }
