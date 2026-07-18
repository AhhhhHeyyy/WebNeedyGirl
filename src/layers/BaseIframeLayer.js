// Wraps a fully self-contained effect folder (its own HTML/CSS/JS and, in
// effects/holographic's case, its own internal control panel) in an
// <iframe> — a totally separate browsing context, per the "isolate the
// GPU-heavy self-contained subsystem" pattern. Only visibility is managed
// from the outside; these are full-bleed background effects with their
// own internal RWD, not sprites meant to be dragged/scaled like the image
// layers, so there's no getTransform/setTransform/select here.
export class BaseIframeLayer {
  constructor({ id, label, src, container }) {
    this.id = id;
    this.label = label;
    this.type = 'iframe';
    this.visible = true;

    this.el = document.createElement('iframe');
    this.el.src = src;
    this.el.title = label;
    Object.assign(this.el.style, {
      position: 'absolute', top: '0', left: '0', width: '100%', height: '100%', border: 'none',
    });
    container.appendChild(this.el);

    // Effects with their own rAF/WebGL loop (holographic, checkerboard) keep
    // running that loop even once this iframe is display:none — display:none
    // stops rendering, not script execution — so tell the document inside
    // to actually stop via postMessage (mirrors BaseLottieLayer's pause()).
    // Sent on 'load' too in case pause()/resume() lands before the iframe
    // has finished its own boot and wired up the listener.
    this._paused = false;
    this.el.addEventListener('load', () => { this._postPauseState(); this._postTierState(); });

    // shared/perf-monitor.js (loaded by the root index.html only — same-origin
    // iframes don't share window scope, so this can't just be read directly
    // from inside the effect's own document) broadcasts a measured-FPS
    // quality tier; forward it the same way pause/resume already works.
    // Effects opt in by listening for {type:'ng-perf-tier', tier} — not all
    // of them do yet, unhandled messages are simply ignored.
    this._tier = window.getPerfTier ? window.getPerfTier() : 'high';
    this._offTierChange = window.onPerfTierChange
      ? window.onPerfTierChange((t) => { this._tier = t; this._postTierState(); })
      : null;

    this.onChange = null; // wired by LayerManager.add()
  }

  static async create(opts) {
    return new BaseIframeLayer(opts);
  }

  setVisible(visible) {
    this.visible = visible;
    this.el.style.display = visible ? 'block' : 'none';
    if (visible) this.resume(); else this.pause();
  }

  pause() {
    this._paused = true;
    this._postPauseState();
  }

  resume() {
    this._paused = false;
    this._postPauseState();
  }

  _postPauseState() {
    this.el.contentWindow?.postMessage(
      { type: this._paused ? 'ng-effect-pause' : 'ng-effect-resume' },
      window.location.origin
    );
  }

  _postTierState() {
    this.el.contentWindow?.postMessage({ type: 'ng-perf-tier', tier: this._tier }, window.location.origin);
  }

  // Always stays behind every Pixi/Lottie layer — it's the background,
  // not a slot in the interleaved z-stack (see main.js for why Pixi/Lottie
  // can't fully interleave with a separate DOM context either).
  setZIndex(_i) {
    this.el.style.zIndex = '0';
  }

  destroy() {
    this._offTierChange?.();
    this.el.remove();
  }
}
