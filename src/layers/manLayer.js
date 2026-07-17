import { BaseIframeLayer } from './BaseIframeLayer.js';

// The man popup is meant to read as a surprise sitting on top of the whole
// scene, not a full-viewport background sitting behind every Pixi/Lottie
// layer (BaseIframeLayer's default) — same "pin this iframe's z-index to a
// fixed constant, ignore the index the manager would otherwise assign"
// trick retroFilterLayer.js uses, just one step above it so the popup still
// reads through the retro filter's translucent scanline/vignette overlay
// instead of being hidden under it.
const FRONTMOST_Z = 26; // above retroFilter (25), lottie's frontmost promotion (20) and pixi (10)

export class ManLayer extends BaseIframeLayer {
  constructor(opts) {
    super(opts);

    // Full-viewport + frontmost would otherwise swallow every click meant
    // for the layers underneath it, even over the mostly-empty parts of the
    // popup's own iframe — so, like retroFilterLayer, it's click-through by
    // default and only becomes interactive while its own tuning panel is
    // open. An iframe's pointer-events is all-or-nothing from the parent's
    // side, so its internal panel-toggle button can't be "the one
    // exception" — a small always-clickable proxy button lives here in the
    // parent instead, and just tells the iframe to flip its panel via
    // postMessage.
    this.el.style.pointerEvents = 'none';
    this._panelOpen = false;

    this.toggleBtn = document.createElement('button');
    this.toggleBtn.textContent = '🧍';
    this.toggleBtn.title = 'Man Popup Controls';
    Object.assign(this.toggleBtn.style, {
      position: 'absolute', top: '102px', right: '14px', zIndex: String(FRONTMOST_Z + 1),
      width: '34px', height: '34px', borderRadius: '50%', border: 'none',
      background: 'rgba(255,255,255,0.72)', cursor: 'pointer', fontSize: '15px',
    });
    this.toggleBtn.onclick = () => {
      this._panelOpen = !this._panelOpen;
      this.el.style.pointerEvents = this._panelOpen ? 'auto' : 'none';
      this.el.contentWindow.postMessage({ type: 'ng-man-toggle' }, window.location.origin);
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
  return new ManLayer({ ...opts, src: `${opts.folder}/index.html` });
}
