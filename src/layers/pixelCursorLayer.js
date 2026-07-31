import { BaseIframeLayer } from './BaseIframeLayer.js';
import { EDIT_MODE } from '../core/editMode.js';

// A custom cursor has to sit in front of literally everything (Pixi sprites,
// lottie, even the retro filter) or it'd be occluded by the very thing it's
// supposed to be drawn on top of — same unconditional frontmost trick
// retroFilterLayer.js uses, just pointed one notch further front so it wins
// over that filter too.
//
// This iframe lives inside #stage-area, which (like every ancestor up to
// #stage-world) has no z-index of its own — so it never gains its own
// stacking context, and this element's z-index actually competes directly
// within #viewport-root's stacking context (the nearest ancestor that
// forks one, being `position: fixed`), not just against its retroFilter/
// tvGlitch/man siblings. That's why this has to clear phoneCallOverlay.js's
// 5000, chat.chatboardLayer.js's compose-modal 4500, AND #loading-screen's
// 10000 too, not just the in-stage layers' 25/26: all three live inside
// #viewport-root now (see index.html/phoneCallOverlay.js/
// chat.chatboardLayer.js for why each was moved there) specifically so
// their z-index is comparable against this one at all — a body-level
// sibling of #viewport-root has its z-index compared against the WHOLE of
// #viewport-root as one unit, never against anything nested inside it, no
// matter how high this constant is set (confirmed empirically before this
// fix). User-requested: 來電視窗跟留言視窗也要使用客製化滑鼠, then 加載頁面
// 也都要用客製化滑鼠(mobile模式就不需要) — mobile already stays hidden via
// _applyMobileState() below regardless. Stays below #rotate-prompt (9999,
// left outside #viewport-root — mobile/portrait-only, and the cursor is
// already hidden on mobile anyway).
const FRONTMOST_Z = 10500; // above #loading-screen's 10000, phoneCallOverlay's 5000, chat compose modal's 4500, retroFilter/tvGlitch/man's 25-26, lottie's 20, pixi's 10

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

    // super() appended this.el into #bg-effect-layer, same as every other
    // effect layer — but that div lives inside #stage-world, which has its
    // own `will-change: transform` (see index.html, for screenShake.js) and
    // that alone forks a NEW stacking context there (per spec, a will-change
    // value that would itself trigger one — transform does — forces the
    // fork regardless of whether a transform is actually applied right now).
    // Nested inside that fork, this iframe's z-index (however high
    // FRONTMOST_Z is set below) only ever ranks against its retroFilter/
    // tvGlitch/man siblings — it can never win against phoneCallOverlay.js's
    // or chat.chatboardLayer.js's compose-modal overlays, which are appended
    // into #viewport-root (a stacking context of its own, since it's
    // `position: fixed`) as a SEPARATE branch from #stage-world entirely:
    // #stage-world's whole fork just sits at #viewport-root's implicit
    // z-index:auto tier as one unit, always behind anything in that same
    // context with an explicit positive z-index (confirmed empirically — a
    // 5500 nested in #stage-world's fork still lost to a 5000 living
    // directly in #viewport-root). Moving up to a direct child of
    // #stage-area sidesteps the fork: #stage-area has no transform/filter/
    // will-change of its own, so this iframe's z-index now competes
    // directly inside #viewport-root's context, same level as those
    // overlays. Same-size box either way (#stage-area is exactly what
    // #bg-effect-layer/#stage-world were already both 100%-of anyway).
    // Bonus: this also un-shakes the cursor from screenShake.js's camera
    // shake (#stage-world is what that actually moves) — which reads as
    // more correct anyway, since a real mouse pointer shouldn't jiggle with
    // the scene it's laid over.
    document.getElementById('stage-area').appendChild(this.el);

    // Full-viewport + frontmost would otherwise swallow every click/drag on
    // the stage, so — like retroFilterLayer.js — this iframe is click-through
    // by default. That also means it can't rely on its own mousemove to
    // track the pointer, so the real position is sampled here in the parent
    // and forwarded in (mirrors holographicLayer.js's _forwardPointer).
    this.el.style.pointerEvents = 'none';

    // Tells #loading-screen (index.html) it's now safe to blank the real OS
    // cursor in favor of this decorative one — before this fires, the real
    // arrow stays visible there instead of vanishing into nothing (see that
    // rule's own comment for the bug this fixes). 'load' covers this
    // iframe's own html/css/js; that's the earliest point script.js is even
    // running to start loading cursor.webm and forwarding pointer positions,
    // so it's the best signal available from out here without a dedicated
    // postMessage handshake for "first frame actually painted".
    this.el.addEventListener('load', () => { document.body.classList.add('ng-cursor-ready'); });

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
      background: 'rgba(255,255,255,0.72)', cursor: 'none', fontSize: '15px', // decorative pixel-cursor is the only cursor meant to show over #stage-area — see DragTransform.js
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
    this.toggleBtn.style.display = (shouldShow && EDIT_MODE) ? 'block' : 'none'; // dev-only control, see src/core/editMode.js
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
