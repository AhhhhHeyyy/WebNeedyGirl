import { BaseIframeLayer } from './BaseIframeLayer.js';

// A custom cursor has to sit in front of literally everything (Pixi sprites,
// lottie, even the retro filter) or it'd be occluded by the very thing it's
// supposed to be drawn on top of — same unconditional frontmost trick
// retroFilterLayer.js uses, just pointed one notch further front so it wins
// over that filter too.
const FRONTMOST_Z = 27; // above retroFilterLayer's 25, lottie's 20, pixi's 10

// Same <=1024 "mobile/tablet" cutoff used for the layer panel (index.html)
// and the render-resolution cap (shared/device-perf.js). The custom pixel
// cursor is a stand-in for a real OS mouse pointer — there's no mouse to
// stand in for on a touchscreen, and forwarding touchmove into it just makes
// it visibly chase the finger during drags, so it stays hidden there.
const MOBILE_MAX_WIDTH = 1024;

// Width alone misses large touch tablets — an iPad Pro's landscape width
// (1366) is well past MOBILE_MAX_WIDTH, so on real hardware it was treated
// as "desktop" and left the custom cursor on even though there's no real
// mouse driving it: touch only fires pointermove mid-drag, so the sprite got
// stranded at the last drag position once the finger lifted instead of
// hiding like a real pointer leaving the screen (read as the cursor "running
// out" to a random spot and staying there). `(pointer: fine) and
// (hover: hover)` reflects whether the PRIMARY input is actually a
// mouse/trackpad regardless of viewport width, so it catches those tablets
// too while still sparing touchscreen laptops that are genuinely mouse-driven.
const FINE_POINTER_QUERY = '(pointer: fine) and (hover: hover)';

export class PixelCursorLayer extends BaseIframeLayer {
  constructor(opts) {
    super(opts);

    // Full-viewport + frontmost would otherwise swallow every click/drag on
    // the stage, so — like retroFilterLayer.js — this iframe is click-through
    // by default. That also means it can't rely on its own mousemove to
    // track the pointer, so the real position is sampled here in the parent
    // and forwarded in (mirrors holographicLayer.js's _forwardPointer).
    this.el.style.pointerEvents = 'none';
    this.manager = opts.manager;
    this._panelOpen = false;
    this._finePointerMedia = window.matchMedia ? window.matchMedia(FINE_POINTER_QUERY) : null;
    this._isMobile = this._computeIsMobile();

    this._onPointerMove = (e) => this._forwardPointer(e);
    window.addEventListener('pointermove', this._onPointerMove);
    // 'pointerrawupdate' (Chromium-only, i.e. this Electron shell) delivers
    // samples straight from the input queue instead of batched/throttled to
    // the display's vsync like 'pointermove' — strictly more/fresher points,
    // so wiring it up alongside (not instead of) pointermove only ever
    // lowers the effective latency of pointer.x/y in the iframe.
    if ('onpointerrawupdate' in window) {
      window.addEventListener('pointerrawupdate', this._onPointerMove);
    }

    this.toggleBtn = document.createElement('button');
    this.toggleBtn.textContent = '🕹';
    this.toggleBtn.title = 'Pixel Cursor Controls';
    Object.assign(this.toggleBtn.style, {
      position: 'absolute', top: '102px', right: '14px', zIndex: String(FRONTMOST_Z + 1),
      width: '34px', height: '34px', borderRadius: '50%', border: 'none',
      background: 'rgba(255,255,255,0.72)', cursor: 'pointer', fontSize: '15px',
    });
    this.toggleBtn.onclick = () => {
      this._panelOpen = !this._panelOpen;
      this.el.style.pointerEvents = this._panelOpen ? 'auto' : 'none';
      this.el.contentWindow.postMessage({ type: 'ng-pixelCursor-toggle' }, window.location.origin);
    };
    this.el.parentElement.appendChild(this.toggleBtn);

    // Viewport width can change (window resize, or a tablet flipping
    // orientation) without a page reload, so this is re-checked live rather
    // than only once at construction. The pointer/hover media query has its
    // own 'change' event too (e.g. a Bluetooth mouse pairing/unpairing with
    // a tablet), separate from any resize.
    this._onResize = () => this._applyMobileState();
    window.addEventListener('resize', this._onResize);
    this._onPointerCapabilityChange = () => this._applyMobileState();
    this._finePointerMedia?.addEventListener('change', this._onPointerCapabilityChange);
    this._applyMobileState();
  }

  _computeIsMobile() {
    if (window.innerWidth <= MOBILE_MAX_WIDTH) return true;
    return this._finePointerMedia ? !this._finePointerMedia.matches : false;
  }

  // `this.visible` (set via setVisible, e.g. the layer panel's checkbox)
  // stays the user's own on/off intent regardless of viewport size — mobile
  // just forces the on-screen result to hidden without touching that intent,
  // so resizing back to desktop restores whatever the user had chosen.
  _applyMobileState() {
    this._isMobile = this._computeIsMobile();
    const shouldShow = this.visible && !this._isMobile;
    this.el.style.display = shouldShow ? 'block' : 'none';
    this.toggleBtn.style.display = shouldShow ? 'block' : 'none';
  }

  _forwardPointer(e) {
    if (!this.visible || this._isMobile || !this.el.contentWindow) return;
    const rect = this.el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    // getPredictedEvents() (browser short-horizon motion extrapolation) used
    // to be preferred here to hide input-to-paint latency, but with two
    // separate listeners feeding this handler (pointermove + pointerrawupdate
    // — see the constructor) each firing its own not-vsync-aligned
    // prediction, the two extrapolated points routinely disagreed, which
    // read as jitter. Raw e.clientX/Y is a hair less "ahead" but is a single
    // ground-truth value both listeners agree on.
    // Magnetically snap onto a sticker-list icon (StickerListLayer.
    // getSnapPoint()) when the real pointer is close enough — the same
    // rect/radius check that layer uses for its own hover/click hit-test,
    // so the cursor is never shown magnetized to an icon that a click at
    // this same real position wouldn't actually land on.
    const stickerList = this.manager?.get('stickerList');
    const snap = stickerList?.getSnapPoint?.(e.clientX, e.clientY);
    const clientX = snap ? snap.x : e.clientX;
    const clientY = snap ? snap.y : e.clientY;

    const x = clientX - rect.left;
    const y = clientY - rect.top;

    // Same-origin, so a direct call is legal — and unlike postMessage (an
    // async task the browser schedules onto the target realm's queue,
    // potentially behind other pending work) it runs synchronously in this
    // handler's own call stack, right now. Falls back to postMessage for the
    // brief window before the iframe's script has finished loading/wiring
    // window.__ngSetPointer up, or if a same-origin access ever fails.
    try {
      const setPointer = this.el.contentWindow.__ngSetPointer;
      if (typeof setPointer === 'function') { setPointer(x, y); return; }
    } catch { /* cross-origin or not-yet-loaded — fall through to postMessage */ }
    this.el.contentWindow.postMessage({ type: 'ng-pixelCursor-pointer', x, y }, window.location.origin);
  }

  setVisible(visible) {
    super.setVisible(visible);
    this._applyMobileState(); // re-asserts display:none on mobile even though the base class just set 'block'
    if (!visible) {
      this._panelOpen = false;
      this.el.style.pointerEvents = 'none';
    }
  }

  setZIndex(_i) {
    this.el.style.zIndex = String(FRONTMOST_Z);
  }

  destroy() {
    window.removeEventListener('pointermove', this._onPointerMove);
    if ('onpointerrawupdate' in window) {
      window.removeEventListener('pointerrawupdate', this._onPointerMove);
    }
    window.removeEventListener('resize', this._onResize);
    this._finePointerMedia?.removeEventListener('change', this._onPointerCapabilityChange);
    this.toggleBtn.remove();
    super.destroy();
  }
}

export async function create(opts) {
  return new PixelCursorLayer({ ...opts, src: `${opts.folder}/index.html` });
}
