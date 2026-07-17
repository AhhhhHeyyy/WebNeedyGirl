// FX-mixer-style layer list: visibility toggle, forward/backward reorder,
// and (for the selected layer) x/y/scale/rotation sliders that stay in sync
// with on-canvas dragging. Row list and slider values are updated separately
// (see _onManagerChange) so that continuous drag updates never rebuild the
// DOM node the user's pointer is currently holding.
//
// A "group" layer (see GroupLayer.js) renders its own row plus one indented
// row per child image right underneath — the group's row drags/scales the
// whole bundle, each child row still drags/scales just that one image.
export class LayerPanel {
  constructor({ mountEl, layerManager }) {
    this.mountEl = mountEl;
    this.manager = layerManager;
    this.selectedId = null;
    this._sliderRefs = null;

    this.rowsEl = document.createElement('div');
    this.transformEl = document.createElement('div');
    this.transformEl.className = 'layer-transform';
    this.mountEl.appendChild(this.rowsEl);
    this.mountEl.appendChild(this.transformEl);

    this._injectStyle();
    this.manager.onChange(() => this._onManagerChange());
    this._renderRows();

    // Arrow keys nudge the currently selected layer's position — skipped
    // while typing in a slider/number input, and while the layer is locked.
    this._onKeyDown = (e) => this._handleKeyDown(e);
    window.addEventListener('keydown', this._onKeyDown);
  }

  _injectStyle() {
    if (document.getElementById('layer-panel-style')) return;
    const style = document.createElement('style');
    style.id = 'layer-panel-style';
    style.textContent = `
      .layer-row { display:flex; align-items:center; gap:5px; padding:5px 6px; border-radius:8px; cursor:pointer; }
      .layer-row:hover { background: rgba(255,255,255,0.35); }
      .layer-row.selected { background: rgba(255,255,255,0.65); }
      .layer-row .lbl { flex:1; font-size:11.5px; font-weight:600; color:#7862a8; }
      .layer-row button { border:none; background:none; cursor:pointer; font-size:10px; color:#9878b8; padding:2px 4px; }
      .layer-row-child { padding-left: 22px; }
      .layer-row-child .lbl { font-weight:500; color:#9583b8; }
      .layer-row.locked .lbl { opacity: .55; }
      .layer-transform { padding: 2px 4px 10px 4px; }
      .locked-note { font-size:11px; color:#9878b8; padding: 2px 4px 10px 4px; }
    `;
    document.head.appendChild(style);
  }

  _onManagerChange() {
    this._renderRows();
    this._syncTransformValues();
  }

  _renderRows() {
    this.rowsEl.innerHTML = '';
    const layers = [...this.manager.layers].reverse(); // topmost (frontmost) first, Photoshop-style

    layers.forEach((layer) => {
      this.rowsEl.appendChild(this._buildRow(layer, false));
      if (layer.type === 'group') {
        [...layer.children].reverse().forEach(child => {
          this.rowsEl.appendChild(this._buildRow(child, true));
        });
      }
    });
  }

  _buildRow(layer, isChild) {
    const row = document.createElement('div');
    row.className = 'layer-row' + (isChild ? ' layer-row-child' : '') +
      (layer.id === this.selectedId ? ' selected' : '') +
      (layer.locked ? ' locked' : '');

    const vis = document.createElement('input');
    vis.type = 'checkbox';
    vis.checked = layer.visible;
    vis.addEventListener('click', (e) => e.stopPropagation());
    vis.addEventListener('change', () => this.manager.setVisible(layer.id, vis.checked));

    const lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = layer.label;

    const up = document.createElement('button');
    up.textContent = '▲'; up.title = 'Bring forward';
    up.addEventListener('click', (e) => { e.stopPropagation(); this._move(layer.id, +1); });

    const down = document.createElement('button');
    down.textContent = '▼'; down.title = 'Send backward';
    down.addEventListener('click', (e) => { e.stopPropagation(); this._move(layer.id, -1); });

    row.append(vis, lbl);
    if (layer.setLocked) {
      const lock = document.createElement('button');
      lock.textContent = layer.locked ? '🔒' : '🔓';
      lock.title = layer.locked ? '解鎖圖層（允許拖曳/縮放）' : '鎖定圖層（防止拖曳/縮放）';
      lock.addEventListener('click', (e) => { e.stopPropagation(); this.manager.setLocked(layer.id, !layer.locked); });
      row.append(lock);
    }
    row.append(up, down);
    row.addEventListener('click', () => this._select(layer.id));
    return row;
  }

  // Finds whichever list (top-level layers, or some group's children) the
  // id currently lives in and nudges it there — mirrors the two-list lookup
  // LayerManager.reorder() does internally, since the *current* index has
  // to come from the right list before reorder() can move it.
  _move(id, dir) {
    const topIdx = this.manager.layers.findIndex(l => l.id === id);
    if (topIdx !== -1) {
      this.manager.reorder(id, topIdx + dir);
      return;
    }
    for (const l of this.manager.layers) {
      if (l.type !== 'group') continue;
      const childIdx = l.children.findIndex(c => c.id === id);
      if (childIdx !== -1) {
        this.manager.reorder(id, childIdx + dir);
        return;
      }
    }
  }

  _select(id) {
    this.manager.layers.forEach(l => {
      l.deselect && l.deselect();
      if (l.type === 'group') l.children.forEach(c => c.deselect && c.deselect());
    });
    this.selectedId = this.selectedId === id ? null : id;
    const layer = this.manager.get(this.selectedId);
    if (layer) layer.select && layer.select();
    this._renderRows();
    this._buildTransformControls(layer || null);
  }

  _buildTransformControls(layer) {
    this.transformEl.innerHTML = '';
    this._sliderRefs = null;
    if (!layer || !layer.getTransform) return; // e.g. the background iframe layer has no transform

    if (layer.locked) {
      const note = document.createElement('div');
      note.className = 'locked-note';
      note.textContent = '🔒 已鎖定，解鎖後才能拖曳/縮放/微調';
      this.transformEl.appendChild(note);
      return;
    }

    const t = layer.getTransform();
    const specs = [
      { key: 'x', label: 'X', min: -1500, max: 1500, step: 1 },
      { key: 'y', label: 'Y', min: -1500, max: 1500, step: 1 },
      { key: 'scaleX', label: 'Scale', min: 0.05, max: 4, step: 0.01, linkScaleY: true },
      { key: 'rotation', label: 'Rotate', min: -3.14159, max: 3.14159, step: 0.01 },
    ];

    const refs = {};
    specs.forEach(spec => {
      const { box, input, val } = this._slider(layer, spec, t[spec.key]);
      refs[spec.key] = { input, val, step: spec.step };
      this.transformEl.appendChild(box);
    });
    this._sliderRefs = refs;
  }

  _slider(layer, { key, label, min, max, step, linkScaleY }, value) {
    const top = document.createElement('div'); top.className = 'sg-top';
    const lbl = document.createElement('span'); lbl.className = 'sg-label'; lbl.textContent = label;
    const val = document.createElement('span'); val.className = 'sg-val'; val.textContent = value.toFixed(2);
    top.append(lbl, val);

    const track = document.createElement('div'); track.className = 'sg-track';
    const input = document.createElement('input');
    input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = value;
    track.appendChild(input);

    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      val.textContent = v.toFixed(2);
      const patch = { [key]: v };
      if (linkScaleY) patch.scaleY = v;
      this.manager.setTransform(layer.id, patch);
    });

    const box = document.createElement('div'); box.className = 'sg';
    box.append(top, track);
    return { box, input, val };
  }

  // Arrow keys nudge the selected layer by 1 logical px (10px with Shift):
  // Left/Right always move X, Up/Down always move Y. Ignored while locked
  // or while nothing is selected.
  static NUDGE_KEYS = {
    ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
  };

  _handleKeyDown(e) {
    const delta = LayerPanel.NUDGE_KEYS[e.key];
    if (!delta || !this.selectedId) return;

    // Only bail for genuine typing fields (text/number/color pickers etc.) —
    // NOT for our own range sliders. A range input keeps keyboard focus after
    // the user last dragged it, and left unguarded, the browser's native
    // arrow-key handling on THAT one slider would hijack every arrow press
    // (e.g. Up/Down would nudge Rotation instead of Y, whichever slider last
    // had focus) instead of Left/Right always meaning X and Up/Down meaning Y.
    const active = document.activeElement;
    const isTypingField = active && (active.tagName === 'TEXTAREA' ||
      (active.tagName === 'INPUT' && active.type !== 'range' && active.type !== 'checkbox'));
    if (isTypingField) return;

    const layer = this.manager.get(this.selectedId);
    if (!layer || !layer.getTransform || layer.locked) return;

    e.preventDefault(); // also suppresses the focused slider's own native arrow-key handling
    if (active && active.tagName === 'INPUT' && active.type === 'range') active.blur();

    const step = e.shiftKey ? 10 : 1;
    const t = layer.getTransform();
    this.manager.setTransform(this.selectedId, {
      x: t.x + delta[0] * step,
      y: t.y + delta[1] * step,
    });
  }

  // Keeps slider values live during on-canvas drag without touching the
  // row list or recreating any slider DOM node.
  _syncTransformValues() {
    if (!this._sliderRefs || !this.selectedId) return;
    const layer = this.manager.get(this.selectedId);
    if (!layer) return;
    const t = layer.getTransform();
    Object.entries(this._sliderRefs).forEach(([key, ref]) => {
      const v = t[key];
      if (v === undefined) return;
      if (document.activeElement !== ref.input) ref.input.value = v;
      ref.val.textContent = v.toFixed(2);
    });
  }
}
