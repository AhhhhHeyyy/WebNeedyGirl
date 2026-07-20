import { BaseIframeLayer } from './BaseIframeLayer.js';

// Same "pin z-index to a fixed constant, ignore the layer-order index the
// manager would otherwise assign" trick as retroFilterLayer.js — this is a
// screen-damage overlay meant to flash/shatter in FRONT of the whole
// composited scene regardless of where the user drags it in the panel's
// layer order. Placed one above retroFilter's own FRONTMOST_Z (25) so the
// glitch burst reads on top of the lens filter (scanlines/vignette/grain)
// too, not underneath it.
const FRONTMOST_Z = 26;

export class TvGlitchLayer extends BaseIframeLayer {
  constructor(opts) {
    super(opts);

    // Full-viewport and frontmost would otherwise swallow every click/drag
    // on the stage — click-through by default, only interactive while this
    // effect's own tuning panel is open (mirrors retroFilterLayer.js's proxy
    // button: an iframe's pointer-events is all-or-nothing from the parent's
    // side, so its internal panel-toggle button can't be "the one
    // exception" once this is embedded).
    this.el.style.pointerEvents = 'none';
    this._panelOpen = false;

    // Blend the glitch's own pixels into whatever's stacked behind it in the
    // composited scene, rather than plain alpha-overlay it on top — a color
    // burn is what makes the shards/ink read as "damage" cut into the scene
    // itself. Set on the <iframe> element here (parent side), not inside the
    // effect's own canvas: a canvas-level globalCompositeOperation would only
    // blend the effect's own draw calls against each other (they share one
    // otherwise-empty document), it can't reach the content stacked BEHIND
    // this whole iframe in the parent page — mix-blend-mode on the iframe
    // itself is the only thing that can do that (an iframe is a replaced
    // element for blending purposes, same as <img>/<canvas>).
    //
    // BUT that also means the effect's own control panel (index.html's
    // #panel, rendered inside this same iframe/document) gets color-burned
    // right along with the canvas — there's no way to blend only PART of an
    // iframe's content from the parent side, mix-blend-mode applies to the
    // iframe's whole rasterized output as one unit. So this is switched off
    // while the panel is open (_panelOpen, toggled below) so the sliders
    // stay flat/legible while tuning, and switched back on the moment the
    // panel closes — normal use (panel closed) is the only state where the
    // burn is actually wanted anyway.
    this._applyBlend();

    // Overall opacity is exposed as a slider inside the effect's own panel
    // (script.js), but CSS opacity on THIS element is the only thing that
    // actually controls how strongly the color-burn blend shows — the
    // effect's internal V.intensity/baseOpacity sliders only shape the
    // burst's own alpha, they can't reach mix-blend-mode's strength from
    // inside the iframe. So the panel forwards slider changes up via
    // postMessage (mirrors StickerListLayer's ng-stickerlist-rects pattern)
    // instead of the parent trying to read the iframe's own state directly.
    this._onMessage = (e) => {
      if (e.origin !== window.location.origin || e.source !== this.el.contentWindow) return;
      if (e.data?.type === 'ng-tvglitch-opacity') {
        this.el.style.opacity = String(Math.max(0, Math.min(1, e.data.value)));
      }
    };
    window.addEventListener('message', this._onMessage);

    this.toggleBtn = document.createElement('button');
    this.toggleBtn.textContent = '📺';
    this.toggleBtn.title = 'TV Glitch Controls';
    Object.assign(this.toggleBtn.style, {
      position: 'absolute', top: '58px', right: '14px', zIndex: String(FRONTMOST_Z + 1),
      width: '34px', height: '34px', borderRadius: '50%', border: 'none',
      background: 'rgba(255,255,255,0.72)', cursor: 'pointer', fontSize: '15px',
    });
    this.toggleBtn.onclick = () => {
      this._panelOpen = !this._panelOpen;
      this.el.style.pointerEvents = this._panelOpen ? 'auto' : 'none';
      this._applyBlend();
      this.el.contentWindow.postMessage({ type: 'ng-tvglitch-toggle' }, window.location.origin);
    };
    this.el.parentElement.appendChild(this.toggleBtn);
  }

  _applyBlend() {
    this.el.style.mixBlendMode = this._panelOpen ? 'normal' : 'color-burn';
  }

  setVisible(visible) {
    super.setVisible(visible);
    this.toggleBtn.style.display = visible ? 'block' : 'none';
    if (!visible) {
      this._panelOpen = false;
      this.el.style.pointerEvents = 'none';
      this._applyBlend();
    }
  }

  setZIndex(_i) {
    this.el.style.zIndex = String(FRONTMOST_Z);
  }

  destroy() {
    window.removeEventListener('message', this._onMessage);
    this.toggleBtn.remove();
    super.destroy();
  }
}

export async function create(opts) {
  return new TvGlitchLayer({ ...opts, src: `${opts.folder}/index.html` });
}
