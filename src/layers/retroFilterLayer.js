import { BaseIframeLayer } from './BaseIframeLayer.js';

// A camera-lens-style screen filter (scanlines/vignette/grain/flicker) is
// the opposite of what BaseIframeLayer assumes for "effect" layers: instead
// of a full-viewport BACKGROUND sitting behind every Pixi/Lottie layer, this
// one has to stay in FRONT of all of them regardless of where the user drags
// it in the panel's layer order. Same "pin this iframe's z-index to a fixed
// constant, ignore the index the manager would otherwise assign" trick
// BaseIframeLayer itself already uses for the back — just pointed at the
// front instead (mirrors holographicLayer.js's conditional front promotion,
// minus the condition: this one is unconditionally frontmost).
const FRONTMOST_Z = 25; // above lottie's frontmost promotion (20) and pixi (10)

export class RetroFilterLayer extends BaseIframeLayer {
  constructor(opts) {
    super(opts);

    // Sitting in front of EVERYTHING at full viewport size means this
    // iframe would otherwise swallow every click on the stage — dragging
    // any Pixi layer lands on this iframe instead of the canvas underneath.
    // So unlike every other effect, this one is click-through by default and
    // only becomes interactive while its own tuning panel is open. Since an
    // iframe's pointer-events is all-or-nothing from the parent's side (its
    // own internal panel-toggle button can't be "the one exception"), a
    // small always-clickable proxy button lives here in the parent instead,
    // and just tells the iframe to flip its panel via postMessage — mirrors
    // holographicLayer.js's postMessage bridge for crossing that same
    // boundary, just one-directional (parent decides the open/closed state,
    // iframe just mirrors it).
    this.el.style.pointerEvents = 'none';
    this._panelOpen = false;

    this.toggleBtn = document.createElement('button');
    this.toggleBtn.textContent = '📼';
    this.toggleBtn.title = 'Retro Filter Controls';
    Object.assign(this.toggleBtn.style, {
      position: 'absolute', top: '58px', right: '14px', zIndex: String(FRONTMOST_Z + 1),
      width: '34px', height: '34px', borderRadius: '50%', border: 'none',
      background: 'rgba(255,255,255,0.72)', cursor: 'pointer', fontSize: '15px',
    });
    this.toggleBtn.onclick = () => {
      this._panelOpen = !this._panelOpen;
      this.el.style.pointerEvents = this._panelOpen ? 'auto' : 'none';
      this.el.contentWindow.postMessage({ type: 'ng-retrofilter-toggle' }, window.location.origin);
    };
    this.el.parentElement.appendChild(this.toggleBtn);
  }

  setVisible(visible) {
    super.setVisible(visible);
    this.toggleBtn.style.display = visible ? 'block' : 'none';
    if (!visible) {
      this._panelOpen = false;
      this.el.style.pointerEvents = 'none';
    }
  }

  setZIndex(_i) {
    this.el.style.zIndex = String(FRONTMOST_Z);
  }

  destroy() {
    this.toggleBtn.remove();
    super.destroy();
  }
}

export async function create(opts) {
  return new RetroFilterLayer({ ...opts, src: `${opts.folder}/index.html` });
}
