// Registry of all interactive layers (Pixi sprite layers + Lottie layers +
// group layers). UI panels and drag handles read/write through this instead
// of touching individual layer objects directly, so anything can observe
// layer changes. A "group" layer (see GroupLayer.js) owns its own `children`
// array of image layers nested inside it — get/reorder transparently look
// one level into any group's children so callers never need to know whether
// an id is top-level or nested.

export class LayerManager {
  constructor() {
    this.layers = [];      // ordered back-to-front
    this.listeners = new Set();
  }

  add(layer) {
    this.layers.push(layer);
    layer.onChange = () => this._emit();
    this._applyOrder();
    this._emit();
    return layer;
  }

  remove(id) {
    const layer = this.get(id);
    if (!layer) return;
    layer.destroy();
    this.layers = this.layers.filter(l => l.id !== id);
    this._applyOrder();
    this._emit();
  }

  get(id) {
    const top = this.layers.find(l => l.id === id);
    if (top) return top;
    for (const l of this.layers) {
      if (l.type === 'group') {
        const child = l.getChild(id);
        if (child) return child;
      }
    }
    return undefined;
  }

  // Move a layer (or a group's child) to a new index within whichever list
  // it actually lives in, and re-apply z-order.
  reorder(id, newIndex) {
    const topFrom = this.layers.findIndex(l => l.id === id);
    if (topFrom !== -1) {
      const [layer] = this.layers.splice(topFrom, 1);
      this.layers.splice(Math.max(0, Math.min(newIndex, this.layers.length)), 0, layer);
      this._applyOrder();
      this._emit();
      return;
    }
    for (const l of this.layers) {
      if (l.type !== 'group') continue;
      const childFrom = l.children.findIndex(c => c.id === id);
      if (childFrom !== -1) {
        const [child] = l.children.splice(childFrom, 1);
        l.children.splice(Math.max(0, Math.min(newIndex, l.children.length)), 0, child);
        l.children.forEach((c, i) => c.setZIndex(i));
        this._emit();
        return;
      }
    }
  }

  setVisible(id, visible) {
    const layer = this.get(id);
    if (!layer) return;
    layer.setVisible(visible);
    this._emit();
  }

  setTransform(id, transform) {
    const layer = this.get(id);
    if (!layer) return;
    layer.setTransform(transform);
    this._emit();
  }

  setLocked(id, locked) {
    const layer = this.get(id);
    if (!layer || !layer.setLocked) return;
    layer.setLocked(locked);
    this._emit();
  }

  // Full arrangement (order, visibility, transform, and for groups the
  // child order/visibility/transform too) as one plain object — callers
  // persist this however they like (localStorage, a JSON file, ...).
  getSnapshot() {
    const layers = {};
    this.layers.forEach(l => {
      const entry = { visible: l.visible, locked: !!l.locked, transform: l.getTransform ? l.getTransform() : null };
      if (l.type === 'group') {
        entry.childOrder = l.children.map(c => c.id);
        entry.children = {};
        l.children.forEach(c => { entry.children[c.id] = { visible: c.visible, locked: !!c.locked, transform: c.getTransform() }; });
      }
      layers[l.id] = entry;
    });
    return { order: this.layers.map(l => l.id), layers };
  }

  applySnapshot(snapshot) {
    if (snapshot.order) {
      const byId = new Map(this.layers.map(l => [l.id, l]));
      const ordered = snapshot.order.map(id => byId.get(id)).filter(Boolean);
      const missing = this.layers.filter(l => !snapshot.order.includes(l.id));
      this.layers = [...ordered, ...missing];
      this._applyOrder();
    }
    Object.entries(snapshot.layers || {}).forEach(([id, state]) => {
      const layer = this.layers.find(l => l.id === id);
      if (!layer) return;
      if (state.transform && layer.setTransform) layer.setTransform(state.transform);
      if (state.visible !== undefined) layer.setVisible(state.visible);
      if (state.locked !== undefined && layer.setLocked) layer.setLocked(state.locked);

      if (layer.type === 'group' && state.children) {
        if (state.childOrder) {
          const byId = new Map(layer.children.map(c => [c.id, c]));
          const ordered = state.childOrder.map(cid => byId.get(cid)).filter(Boolean);
          const missing = layer.children.filter(c => !state.childOrder.includes(c.id));
          layer.children = [...ordered, ...missing];
          layer.children.forEach((c, i) => c.setZIndex(i));
        }
        Object.entries(state.children).forEach(([cid, cstate]) => {
          const child = layer.getChild(cid);
          if (!child) return;
          if (cstate.transform) child.setTransform(cstate.transform);
          if (cstate.visible !== undefined) child.setVisible(cstate.visible);
          if (cstate.locked !== undefined && child.setLocked) child.setLocked(cstate.locked);
        });
      }
    });
    this._emit();
  }

  // zIndex is just array position; layers implement setZIndex(i) to move
  // themselves within their own render context (Pixi container or DOM z-index).
  _applyOrder() {
    this.layers.forEach((layer, i) => layer.setZIndex(i));
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit() {
    this.listeners.forEach(fn => fn(this.layers));
  }
}
