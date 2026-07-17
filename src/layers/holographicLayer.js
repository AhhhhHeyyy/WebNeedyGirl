import { BaseIframeLayer } from './BaseIframeLayer.js';

// holographic is paired specifically with the "frame1" image layer: instead
// of BaseIframeLayer's normal full-viewport background, this resizes/moves
// the iframe to Frame 1's own on-screen box (re-run on every Frame 1
// drag/scale, panel reorder, and stage resize) and CSS-masks it to Frame 1's
// painted silhouette, so the shader only shows through Frame 1's actual
// (non-transparent) pixels — the web equivalent of clipping one layer to
// another. Hardcoded to Frame 1.png on purpose: this is a bespoke pairing,
// not a generic "mask effect to any layer" mechanism.
const FRAME1_MASK_SRC = 'UI/Frame 1.png';

export class HolographicLayer extends BaseIframeLayer {
  constructor(opts) {
    super(opts);
    this.manager = opts.manager;
    this.stage = opts.stage;

    // Hidden until the first successful _reposition() so it never flashes
    // full-viewport while Frame 1 is still loading (effects/images load
    // concurrently in boot(), so there's no ordering guarantee between them).
    this.el.style.visibility = 'hidden';
    Object.assign(this.el.style, {
      maskImage: `url("${FRAME1_MASK_SRC}")`,
      WebkitMaskImage: `url("${FRAME1_MASK_SRC}")`,
      maskSize: '100% 100%',
      WebkitMaskSize: '100% 100%',
      maskRepeat: 'no-repeat',
      WebkitMaskRepeat: 'no-repeat',
      maskPosition: 'center',
      WebkitMaskPosition: 'center',
    });

    this._offManagerChange = this.manager.onChange(() => this._reposition());
    this._offResize = this.stage.onResize(() => this._reposition());
    this._reposition();

    // The iframe isn't necessarily the topmost element over Frame 1's box
    // (z-order tracks Frame 1 — see setZIndex below), so it can't reliably
    // get real mousemove/touchmove events of its own. Forward pointer
    // position instead, normalized against the iframe's current box, so the
    // shader's mouse-ripple still works regardless of stacking. Layer order
    // itself is untouched by this — purely a data channel, not a DOM change.
    this._onPointerMove = (e) => this._forwardPointer(e);
    window.addEventListener('pointermove', this._onPointerMove);
  }

  _forwardPointer(e) {
    if (!this.visible || !this.el.contentWindow) return;
    const rect = this.el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const tx = (e.clientX - rect.left) / rect.width;
    const ty = 1 - (e.clientY - rect.top) / rect.height;
    this.el.contentWindow.postMessage({ type: 'ng-holographic-pointer', tx, ty }, window.location.origin);
  }

  _reposition() {
    const frame1 = this.manager.get('frame1');
    if (!frame1 || !frame1.sprite) return; // not loaded yet; keep waiting

    const sprite = frame1.sprite;
    const bounds = sprite.getLocalBounds();
    const w = bounds.width * sprite.scale.x;
    const h = bounds.height * sprite.scale.y;
    const scale = this.stage.scaleFactor;
    const screenW = w * scale;
    const screenH = h * scale;
    const centerX = this.stage.root.position.x + sprite.x * scale;
    const centerY = this.stage.root.position.y + sprite.y * scale;

    Object.assign(this.el.style, {
      left: `${centerX - screenW / 2}px`,
      top: `${centerY - screenH / 2}px`,
      width: `${screenW}px`,
      height: `${screenH}px`,
      transform: sprite.rotation ? `rotate(${sprite.rotation}rad)` : 'none',
      visibility: 'visible',
    });
  }

  // BaseIframeLayer always pins z-index to 0 (always-at-the-back). Here it
  // instead mirrors main.js's reconcileZIndex trick already used for the
  // lottie DOM block: an iframe is its own stacking context, so it can only
  // sit as a whole block in front of or behind the single Pixi canvas, not
  // interleaved sprite-by-sprite — "front" means Frame 1 is the topmost
  // layer in the manager's order.
  setZIndex(_i) {
    const layers = this.manager.layers;
    const frame1Idx = layers.findIndex(l => l.id === 'frame1');
    const isFrame1Frontmost = frame1Idx !== -1 && frame1Idx === layers.length - 1;
    this.el.style.zIndex = isFrame1Frontmost ? '15' : '0';
  }

  destroy() {
    this._offManagerChange();
    this._offResize();
    window.removeEventListener('pointermove', this._onPointerMove);
    super.destroy();
  }
}

export async function create(opts) {
  return new HolographicLayer({ ...opts, src: `${opts.folder}/index.html` });
}
