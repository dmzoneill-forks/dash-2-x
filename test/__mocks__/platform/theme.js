export function addClass(actor, cls) { const set = new Set(getClasses(actor)); set.add(cls); actor._classes = [...set].join(' '); }
export function removeClass(actor, cls) { const set = new Set(getClasses(actor)); set.delete(cls); actor._classes = [...set].join(' '); }
export function hasClass(actor, cls) { return getClasses(actor).includes(cls); }
export function getClasses(actor) { return (actor._classes || '').split(/\s+/).filter(Boolean); }
export function setInlineStyle(actor, style) { actor._inlineStyle = style; }
export function getInlineStyle(actor) { return actor._inlineStyle || null; }
export function clearInlineStyle(actor) { actor._inlineStyle = null; }
export function addPseudoClass(actor, pseudo) { const set = new Set(getPseudoClasses(actor)); set.add(pseudo); actor._pseudoClasses = [...set].join(' '); }
export function removePseudoClass(actor, pseudo) { const set = new Set(getPseudoClasses(actor)); set.delete(pseudo); actor._pseudoClasses = [...set].join(' '); }
function getPseudoClasses(actor) { return (actor._pseudoClasses || '').split(/\s+/).filter(Boolean); }
export function setOffscreenRedirect(actor, mode) { actor._offscreenRedirect = mode; }
export function getOffscreenRedirect(actor) { return actor._offscreenRedirect ?? 0; }
