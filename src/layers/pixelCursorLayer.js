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

export class PixelCursorLayer extends BaseIframeLayer {
  constructor(opts) {
    super(opts);

    // Full-viewport + frontmost would otherwise swallow every click/drag on
    // the stage, so — like retroFilterLayer.js — this iframe is click-through
    // by default. That also means it can't rely on its own mousemove to
    // track the pointer, so the real position is sampled here in the parent
    // and forwarded in (mirrors holographicLayer.js's _forwardPointer).
    this.el.style.pointerEvents = 'none';
    this._panelOpen = false;
    this._isMobile = window.innerWidth <= MOBILE_MAX_WIDTH;

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
    // than only once at construction.
    this._onResize = () => this._applyMobileState();
    window.addEventListener('resize', this._onResize);
    this._applyMobileState();
  }

  // `this.visible` (set via setVisible, e.g. the layer panel's checkbox)
  // stays the user's own on/off intent regardless of viewport size — mobile
  // just forces the on-screen result to hidden without touching that intent,
  // so resizing back to desktop restores whatever the user had chosen.
  _applyMobileState() {
    this._isMobile = window.innerWidth <= MOBILE_MAX_WIDTH;
    const shouldShow = this.visible && !this._isMobile;
    this.el.style.display = shouldShow ? 'block' : 'none';
    this.toggleBtn.style.display = shouldShow ? 'block' : 'none';
  }

  _forwardPointer(e) {
    if (!this.visible || this._isMobile || !this.el.contentWindow) return;
    const rect = this.el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    // Prefer the browser's own short-horizon motion prediction over the
    // event's raw (already-stale-by-the-time-we-render) coordinates — this
    // is the same trick drawing apps use to hide input-to-paint latency.
    // Falls back to e.clientX/Y wherever getPredictedEvents isn't supported.
    let clientX = e.clientX, clientY = e.clientY;
    if (typeof e.getPredictedEvents === 'function') {
      const predicted = e.getPredictedEvents();
      if (predicted.length) {
        const p = predicted[predicted.length - 1];
        clientX = p.clientX; clientY = p.clientY;
      }
    }

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
    this.toggleBtn.remove();
    super.destroy();
  }
}

export async function create(opts) {
  return new PixelCursorLayer({ ...opts, src: `${opts.folder}/index.html` });
}
