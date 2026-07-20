import { BaseIframeLayer } from './BaseIframeLayer.js';

// holographic is paired specifically with the "frame1" image layer, but only
// the SHADER needs to be clipped to Frame 1's on-screen box/silhouette — the
// effect's own control panel (Motion/Shape/Color/Mode Preset/Overlays...)
// does not. This used to resize+CSS-mask the whole outer <iframe> to Frame
// 1's box, which meant the panel was cropped/cramped to whatever small box
// Frame 1 happened to occupy (see UI/holographic/script.js's #panel — a
// fixed-position element is fixed relative to the iframe's OWN viewport, so
// there was no way to free the panel from that box without moving it out of
// this iframe entirely, or — the approach taken here — keeping the outer
// iframe at BaseIframeLayer's normal full-viewport default and instead
// forwarding Frame 1's live screen-space box into the iframe via
// postMessage, where UI/holographic/script.js applies it to an inner
// wrapper div (#holo-clip) that wraps just the canvas + its baked
// retro/colour overlays. The panel stays a direct sibling of that wrapper,
// so `position:fixed` inside the iframe now spans the whole stage like
// every other effect's panel.
// Stacks below man's 🧍/pixelCursor's 🕹 proxy buttons (top:102) — see their
// own files' comments for why each exists: an iframe's pointer-events is
// all-or-nothing from the parent's side, so a self-contained effect's own
// internal panel-toggle can't be "the one exception" once that iframe is
// click-through by default.
const TOGGLE_BTN_TOP = '146px';

// While the panel is open, the WHOLE iframe (shader + panel share one
// stacking context) needs to sit above the Pixi canvas (z-index 10) — same
// tier as man's popup — or the panel would still be visually behind/under
// opaque Pixi content and unclickable even with pointer-events flipped to
// 'auto'. Only applies while _panelOpen; otherwise setZIndex() below still
// tracks Frame 1's position as before.
const PANEL_OPEN_Z = 26;

export class HolographicLayer extends BaseIframeLayer {
  constructor(opts) {
    super(opts);
    this.manager = opts.manager;
    this.stage = opts.stage;

    // Now that this iframe is always full-viewport (see the top-of-file
    // comment), it would swallow every click/drag on the stage whenever
    // Frame 1 is promoted to frontmost (z-index 15, see setZIndex below) —
    // same problem retroFilter/man/pixelCursor already solved: click-through
    // by default, a small always-clickable proxy button (here in the
    // parent, not inside the iframe) flips it interactive only while its
    // own panel is open.
    this.el.style.pointerEvents = 'none';
    this._panelOpen = false;

    this.toggleBtn = document.createElement('button');
    this.toggleBtn.textContent = '🔮';
    this.toggleBtn.title = 'Holographic Controls';
    Object.assign(this.toggleBtn.style, {
      position: 'absolute', top: TOGGLE_BTN_TOP, right: '14px', zIndex: '29',
      width: '34px', height: '34px', borderRadius: '50%', border: 'none',
      background: 'rgba(255,255,255,0.72)', cursor: 'pointer', fontSize: '15px',
    });
    this.toggleBtn.onclick = () => {
      this._panelOpen = !this._panelOpen;
      this.el.style.pointerEvents = this._panelOpen ? 'auto' : 'none';
      this.setZIndex(); // re-evaluate now that _panelOpen changed (see PANEL_OPEN_Z above)
      this.el.contentWindow?.postMessage({ type: 'ng-holo-toggle' }, window.location.origin);
    };
    this.el.parentElement.appendChild(this.toggleBtn);

    this._offManagerChange = this.manager.onChange(() => this._reposition());
    this._offResize = this.stage.onResize(() => this._reposition());
    this._reposition();

    // The iframe isn't necessarily the topmost element over Frame 1's box
    // (z-order tracks Frame 1 — see setZIndex below), so it can't reliably
    // get real mousemove/touchmove events of its own. Forward pointer
    // position instead, normalized against Frame 1's current box (the same
    // box _reposition() computes), so the shader's mouse-ripple still works
    // regardless of stacking. Layer order itself is untouched by this —
    // purely a data channel, not a DOM change.
    this._onPointerMove = (e) => this._forwardPointer(e);
    window.addEventListener('pointermove', this._onPointerMove);
  }

  // Frame 1's live on-screen box, in the same CSS-px space as #stage-area's
  // own top-left (this iframe now fills #stage-area exactly per
  // BaseIframeLayer's default sizing, so these coordinates apply directly
  // to the iframe's own internal #holo-clip with no further transform).
  _frame1Box() {
    const frame1 = this.manager.get('frame1');
    if (!frame1 || !frame1.sprite) return null; // not loaded yet; keep waiting

    const sprite = frame1.sprite;
    const bounds = sprite.getLocalBounds();
    const w = bounds.width * sprite.scale.x;
    const h = bounds.height * sprite.scale.y;
    const scale = this.stage.scaleFactor;
    const screenW = w * scale;
    const screenH = h * scale;
    const centerX = this.stage.root.position.x + sprite.x * scale;
    const centerY = this.stage.root.position.y + sprite.y * scale;

    return {
      left: centerX - screenW / 2, top: centerY - screenH / 2,
      width: screenW, height: screenH, rotation: sprite.rotation,
    };
  }

  _forwardPointer(e) {
    if (!this.visible || !this.el.contentWindow) return;
    const box = this._frame1Box();
    if (!box || box.width === 0 || box.height === 0) return;
    // e.clientX/Y are viewport-relative; box.left/top are #stage-area-
    // relative (see _frame1Box) — same conversion clientToLogical() uses.
    const stageRect = this.stage.app.view.getBoundingClientRect();
    const localX = e.clientX - stageRect.left;
    const localY = e.clientY - stageRect.top;
    const tx = (localX - box.left) / box.width;
    const ty = 1 - (localY - box.top) / box.height;
    this.el.contentWindow.postMessage({ type: 'ng-holographic-pointer', tx, ty }, window.location.origin);
  }

  _reposition() {
    const box = this._frame1Box();
    if (!box) return;
    this.el.contentWindow?.postMessage({ type: 'ng-holo-frame1-box', ...box }, window.location.origin);
  }

  // BaseIframeLayer always pins z-index to 0 (always-at-the-back). Here it
  // instead mirrors main.js's reconcileZIndex trick already used for the
  // lottie DOM block: an iframe is its own stacking context, so it can only
  // sit as a whole block in front of or behind the single Pixi canvas, not
  // interleaved sprite-by-sprite — "front" means Frame 1 is the topmost
  // layer in the manager's order.
  setZIndex(_i) {
    if (this._panelOpen) { this.el.style.zIndex = String(PANEL_OPEN_Z); return; }
    const layers = this.manager.layers;
    const frame1Idx = layers.findIndex(l => l.id === 'frame1');
    const isFrame1Frontmost = frame1Idx !== -1 && frame1Idx === layers.length - 1;
    this.el.style.zIndex = isFrame1Frontmost ? '15' : '0';
  }

  setVisible(visible) {
    super.setVisible(visible);
    this.toggleBtn.style.display = visible ? 'block' : 'none';
    if (!visible) {
      this._panelOpen = false;
      this.el.style.pointerEvents = 'none';
    }
  }

  destroy() {
    this._offManagerChange();
    this._offResize();
    window.removeEventListener('pointermove', this._onPointerMove);
    this.toggleBtn.remove();
    super.destroy();
  }
}

export async function create(opts) {
  return new HolographicLayer({ ...opts, src: `${opts.folder}/index.html` });
}
