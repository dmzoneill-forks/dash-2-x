export function addClass(actor, className) {
    actor.add_style_class_name(className);
}
export function removeClass(actor, className) {
    actor.remove_style_class_name(className);
}
export function hasClass(actor, className) {
    return (actor.get_style_class_name() || '').includes(className);
}
export function getClasses(actor) {
    return (actor.get_style_class_name() || '').split(/\s+/).filter(Boolean);
}
export function setInlineStyle(actor, style) {
    actor.set_style(style);
}
export function getInlineStyle(actor) {
    return actor.get_style();
}
export function clearInlineStyle(actor) {
    actor.set_style(null);
}
export function addPseudoClass(actor, pseudo) {
    actor.add_style_pseudo_class(pseudo);
}
export function removePseudoClass(actor, pseudo) {
    actor.remove_style_pseudo_class(pseudo);
}
export function setOffscreenRedirect(actor, mode) {
    actor.offscreen_redirect = mode;
}
export function getOffscreenRedirect(actor) {
    return actor.offscreen_redirect;
}
