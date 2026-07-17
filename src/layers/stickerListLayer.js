import { BaseIframeLayer } from './BaseIframeLayer.js';

// Renders the 5 clickable sticker icons on top of the "listStickers" board
// (UI/list-stickers.png, see listStickersLayer.js) plus their click-to-spawn
// falling-clone physics. Positioning is glued to that board's live screen
// box the same way holographicLayer.js glues itself to Frame 1 — but unlike
// holographic, the iframe itself can't be shrunk down to the board's own
// box (a clone has to be able to fall all the way off the bottom of the
// actual viewport, not just off the board), so this always stays a
// full-viewport, pointer-events:none iframe (retroFilterLayer.js's
// approach): pointer-events on an <iframe> element is a hard boundary from
// the parent document's side, all-or-nothing for the whole rectangle, so a
// full-viewport iframe can never selectively opt individual regions back in
// from the outside.
//
// Real hover/click is instead done exactly like holographicLayer.js already
// does for its shader's mouse-ripple: a window-level pointermove/click
// listener in the PARENT document, hit-tested in plain JS against each
// icon's last-known on-screen rect (reported back by the iframe via
// postMessage so this doesn't have to hand-duplicate the flex/padding
// layout math from style.css). This also sidesteps a real bug an earlier
// version of this file hit — putting a real DOM hit-target element on top
// of each icon and repositioning it every frame (to track the board's
// hover-lift tween) made Chromium spuriously re-fire pointerleave on every
// sub-pixel shift, flickering the hover state off almost immediately.
// Driving hover off manual math against a stationary mouse position instead
// of native boundary events on a moving target sidesteps that entirely.
//
const Z = 22; // below RETRO_FRONTMOST_Z (25) so retroFilter's camera-lens overlay still reads as the true topmost post-process

export class StickerListLayer extends BaseIframeLayer {
  constructor(opts) {
    super(opts);
    this.manager = opts.manager;
    this.stage = opts.stage;
    this.el.style.pointerEvents = 'none';

    // User-adjustable on top of the board-tracked base box computed in
    // _reposition() — x/y is a logical-px offset from the board's own
    // center, scaleX/scaleY/rotation apply as a CSS transform around that
    // (shifted) box's center. Lets the panel's normal x/y/scale/rotate
    // sliders (see LayerPanel.js) work here exactly like any other layer,
    // without touching how the box is actually glued to the board.
    this._transform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };

    this._itemRects = null; // page-coordinate rects for the 5 icons, refreshed from the iframe's own measurements
    this._hoveredIndex = -1;

    this._wired = false;

    this._onWindowPointerMove = (e) => {
      if (e.pointerType !== 'mouse' || !this.visible) return;
      this._setHovered(this._indexAt(e.clientX, e.clientY));
    };
    this._onWindowClick = (e) => {
      if (!this.visible) return;
      const i = this._indexAt(e.clientX, e.clientY);
      if (i !== -1) this._postClick(i);
    };
    window.addEventListener('pointermove', this._onWindowPointerMove);
    window.addEventListener('click', this._onWindowClick);

    this._onMessage = (e) => {
      if (e.origin !== window.location.origin || e.source !== this.el.contentWindow) return;
      if (e.data?.type === 'ng-stickerlist-rects') this._storeRects(e.data.rects);
    };
    window.addEventListener('message', this._onMessage);

    this._offManagerChange = this.manager.onChange(() => this._wireBoardHoverOpen());
    this._offResize = this.stage.onResize(() => this._reposition());
    this._wireBoardHoverOpen();

    // listStickersLayer's own hover-lift/drop is a per-frame Pixi tween
    // (its _onTick directly mutates sprite.y every frame without ever
    // calling onChange — see that file) rather than a one-off transform
    // change, so the only way to keep the icon row glued to the board while
    // it's mid-lift is to re-measure every frame too, not just on
    // manager.onChange/stage.onResize. _reposition() itself no-ops the
    // postMessage when nothing actually moved, so this costs near nothing
    // while the board is sitting still.
    this._lastPos = null;
    this._tick = () => this._reposition();
    this.stage.app.ticker.add(this._tick);
  }

  // The board (listStickers) may finish loading after this layer does —
  // both load concurrently in main.js's boot() with no ordering guarantee —
  // so this re-tries on every manager change until the sprite actually
  // exists, then wires once.
  _wireBoardHoverOpen() {
    if (this._wired) return;
    const board = this.manager.get('listStickers');
    if (!board || !board.sprite) return;
    this._wired = true;

    // Fired by listStickersLayer.js once the board's own lift/pop animation
    // has actually finished rising (mouse hover-lift or touch long-press
    // pin alike) — the icons' entrance pulse waits for that instead of
    // firing the instant the gesture starts, so it visibly lands only once
    // the board has settled at the top of its pop.
    board.sprite.on('ng-board-opened', () => this._postOpen());
    // Fired the instant the board starts closing (not once it finishes) —
    // hides the icons right away instead of leaving them visible while the
    // board sinks back down underneath them.
    board.sprite.on('ng-board-closing', () => this._postClose());
  }

  _postOpen() {
    this.el.contentWindow?.postMessage({ type: 'ng-stickerlist-open' }, window.location.origin);
  }

  _postClose() {
    this.el.contentWindow?.postMessage({ type: 'ng-stickerlist-close' }, window.location.origin);
  }

  _postHover(index, hover) {
    this.el.contentWindow?.postMessage({ type: 'ng-stickerlist-hover', index, hover }, window.location.origin);
  }

  _postClick(index) {
    this.el.contentWindow?.postMessage({ type: 'ng-stickerlist-click', index }, window.location.origin);
  }

  _setHovered(index) {
    if (index === this._hoveredIndex) return;
    if (this._hoveredIndex !== -1) this._postHover(this._hoveredIndex, false);
    this._hoveredIndex = index;
    if (index !== -1) this._postHover(index, true);
  }

  _indexAt(clientX, clientY) {
    if (!this._itemRects) return -1;
    for (let i = 0; i < this._itemRects.length; i++) {
      const r = this._itemRects[i];
      if (clientX >= r.left && clientX <= r.left + r.width && clientY >= r.top && clientY <= r.top + r.height) return i;
    }
    return -1;
  }

  // Converts the iframe-local rects the iframe measured for its own 5
  // .sticker-item elements into page coordinates (the iframe always covers
  // the full stage box at (0,0), but read its live rect rather than assume
  // that).
  _storeRects(rects) {
    if (!rects) return;
    const frameBox = this.el.getBoundingClientRect();
    this._itemRects = rects.map(r => (r && {
      left: frameBox.left + r.left, top: frameBox.top + r.top, width: r.width, height: r.height,
    }));
  }

  _reposition() {
    const board = this.manager.get('listStickers');
    if (!board || !board.sprite) return;

    const sprite = board.sprite;
    const bounds = sprite.getLocalBounds();
    const w = bounds.width * sprite.scale.x;
    const h = bounds.height * sprite.scale.y;
    const scale = this.stage.scaleFactor;
    const screenW = w * scale;
    const screenH = h * scale;
    const t = this._transform;
    const centerX = this.stage.root.position.x + (sprite.x + t.x) * scale;
    const centerY = this.stage.root.position.y + (sprite.y + t.y) * scale;

    const pos = {
      left: centerX - screenW / 2,
      top: centerY - screenH / 2,
      width: screenW,
      height: screenH,
      scaleX: t.scaleX,
      scaleY: t.scaleY,
      rotation: t.rotation,
    };
    const prev = this._lastPos;
    if (prev && Math.abs(prev.left - pos.left) < 0.05 && Math.abs(prev.top - pos.top) < 0.05 &&
        Math.abs(prev.width - pos.width) < 0.05 && Math.abs(prev.height - pos.height) < 0.05 &&
        prev.scaleX === pos.scaleX && prev.scaleY === pos.scaleY && prev.rotation === pos.rotation) return;
    this._lastPos = pos;

    this.el.contentWindow?.postMessage({ type: 'ng-stickerlist-position', ...pos }, window.location.origin);
  }

  getTransform() {
    return { ...this._transform };
  }

  // Driven by the panel's normal x/y/scale/rotate sliders (LayerPanel.js
  // renders these for any layer that has getTransform/setTransform) — the
  // next ticker-driven _reposition() picks the new values up and forwards
  // them to the iframe, same as a board move/resize would.
  setTransform(t) {
    Object.assign(this._transform, t);
  }

  // An iframe is one DOM block — it can only sit in front of or behind the
  // whole Pixi canvas, never interleaved sprite-by-sprite with whatever's
  // dragged in front of/behind the board (same constraint documented in
  // holographicLayer.js/main.js's reconcileZIndex). So "layer order" here
  // is a front/back toggle: this stays above Pixi (and the board) only
  // while it's the topmost layer in the panel's own order, otherwise it
  // drops behind the canvas. Note this only changes what's drawn on top —
  // clicks/hover still hit-test against the icons' own on-screen rects
  // (see _indexAt) regardless of what's visually covering them.
  setZIndex(_i) {
    const layers = this.manager.layers;
    const isFrontmost = layers.length > 0 && layers[layers.length - 1] === this;
    this.el.style.zIndex = isFrontmost ? String(Z) : '5';
  }

  setVisible(visible) {
    super.setVisible(visible);
    if (!visible) this._setHovered(-1);
  }

  destroy() {
    this._offManagerChange();
    this._offResize();
    this.stage.app.ticker.remove(this._tick);
    window.removeEventListener('pointermove', this._onWindowPointerMove);
    window.removeEventListener('click', this._onWindowClick);
    window.removeEventListener('message', this._onMessage);
    super.destroy();
  }
}

export async function create(opts) {
  return new StickerListLayer({ ...opts, src: `${opts.folder}/index.html` });
}
