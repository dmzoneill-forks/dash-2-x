function mockActor(props = {}) {
    return {
        name: props.name || null,
        width: props.width || 0, height: props.height || 0,
        visible: props.visible !== undefined ? props.visible : true,
        children: [], parent: null,
        scaleX: 1, scaleY: 1,
        translationX: 0, translationY: 0,
        zPosition: 0,
        clipToAllocation: true, clipToView: true,
        hasClip: true, pivotX: 0, pivotY: 0,
        easingDuration: 0, easingMode: null,
        onStage: true, styleClasses: '',
        get_children() { return this.children; },
        get_stage() { return this.onStage ? {} : null; },
        get_transformed_position() { return [0, 0]; },
        get_transformed_size() { return [this.width, this.height]; },
    };
}

export function createBoxLayout(p) { return mockActor(p); }
export function createBin(p) { return mockActor(p); }
export function createWidget(p) { return mockActor(p); }
export function createLabel(p) { return mockActor(p); }
export function createDrawingArea(p) { return mockActor(p); }
export function getChildren(a) { return a.children; }
export function findChildByName(a, name) { return a.children.find(c => c.name === name); }
export function addChild(parent, child) { parent.children.push(child); child.parent = parent; }
export function removeChild(parent, child) { parent.children = parent.children.filter(c => c !== child); child.parent = null; }
export function insertChildBelow(parent, child) { parent.children.unshift(child); child.parent = parent; }
export function setScale(a, x, y) { a.scaleX = x; a.scaleY = y; }
export function getScale(a) { return [a.scaleX, a.scaleY]; }
export function getTransformedPosition(a) { return [0, 0]; }
export function getTransformedSize(a) { return [a.width, a.height]; }
export function setClipToAllocation(a, c) { a.clipToAllocation = c; }
export function setClipToView(a, v) { a.clipToView = v; }
export function removeClip(a) { a.hasClip = false; }
export function setPivotPoint(a, x, y) { a.pivotX = x; a.pivotY = y; }
export function setZPosition(a, z) { a.zPosition = z; }
export function setEasing(a, dur, mode) { a.easingDuration = dur; a.easingMode = mode; }
export function isOnStage(a) { return a.onStage; }
export function isVisible(a) { return a.visible; }
export { mockActor as _mockActor };
