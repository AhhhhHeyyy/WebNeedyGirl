import { LOGICAL_W, LOGICAL_H } from '../core/Stage.js';

// Lottie plays in its own <div>/canvas (lottie-web's own renderer), kept as a
// separate DOM context stacked via CSS z-index rather than folded into the
// Pixi scene graph — same "isolate the heavy/self-contained subsystem"
// reasoning as the iframe pattern for GPU-heavy sub-renderers.
export class BaseLottieLayer {
  constructor({ id, label, src, container, stage, x, y, scale = 1, rotation = 0, width = 512, height = 512, loop = true }) {
    this.id = id;
    this.label = label;
    this.type = 'lottie';
    this.stage = stage;
    this.visible = true;
    this.locked = false;
    this.width = width;
    this.height = height;
    this.transform = { x: x ?? 0, y: y ?? 0, scaleX: scale, scaleY: scale, rotation };

    this.el = document.createElement('div');
    Object.assign(this.el.style, {
      position: 'absolute', top: '0', left: '0',
      width: `${width}px`, height: `${height}px`,
      pointerEvents: 'auto', cursor: 'grab',
    });
    container.appendChild(this.el);

    this.anim = lottie.loadAnimation({
      container: this.el, renderer: 'canvas', loop, autoplay: true, path: src,
    });

    this._applyCss();
    this._offResize = this.stage.onResize(() => this._applyCss());
    this._bindDrag();

    this.onChange = null; // wired by LayerManager.add()
  }

  _applyCss() {
    const s = this.stage.scaleFactor;
    const screenX = this.stage.width / 2 + this.transform.x * s;
    const screenY = this.stage.height / 2 + this.transform.y * s;
    this.el.style.transform =
      `translate(${screenX}px, ${screenY}px) translate(-50%, -50%) ` +
      `scale(${this.transform.scaleX * s}) rotate(${this.transform.rotation}rad)`;
  }

  _bindDrag() {
    this.el.addEventListener('pointerdown', (e) => {
      if (this.locked) return;
      const start = { x: e.clientX, y: e.clientY, tx: this.transform.x, ty: this.transform.y };
      const move = (ev) => {
        const s = this.stage.scaleFactor;
        this.transform.x = start.tx + (ev.clientX - start.x) / s;
        this.transform.y = start.ty + (ev.clientY - start.y) / s;
        this._applyCss();
        this.onChange && this.onChange();
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  static async create(opts) {
    return new BaseLottieLayer(opts);
  }

  setVisible(visible) {
    this.visible = visible;
    this.el.style.display = visible ? 'block' : 'none';
    // lottie-web keeps rendering frames on its own loop even while the div
    // is display:none, so pause it explicitly instead of just hiding it.
    if (visible) this.resume(); else this.pause();
  }

  pause() {
    this.anim.pause();
  }

  // Rewind-and-freeze at frame 0, distinct from pause() (which just freezes
  // wherever playback currently is) — for a layer parked idle right after
  // creation to wait for a one-off trigger, e.g. main.js's boot() pausing
  // Nested Scene 3 until the stage is clicked, so it opens from its actual
  // first frame instead of the few frames autoplay covered before boot()
  // got a chance to pause it.
  stop() {
    this.anim.goToAndStop(0, true);
  }

  resume() {
    if (this.visible) this.anim.play();
  }

  // Distinct from resume(): resume() is also called on every tab-refocus
  // (see main.js's visibilitychange handler) for every layer uniformly, so
  // a layer paused right after creation to wait for a one-off trigger (e.g.
  // "click the stage to open this window", see main.js's boot()) can't use
  // it — a background/refocus cycle before the trigger would fire it early.
  // play() is only ever called by that trigger itself.
  play() {
    this.anim.play();
  }

  // Lets another layer sync its own state to this Lottie's internal
  // keyframes (e.g. nestedScene3PopupSpawner.js showing/hiding its Angel D
  // instance in step with the window's own open/close animation) without
  // reaching into `.anim` directly.
  getCurrentFrame() {
    return this.anim.currentFrame;
  }

  onEnterFrame(cb) {
    this.anim.addEventListener('enterFrame', cb);
    return () => this.anim.removeEventListener('enterFrame', cb);
  }

  // Fires once when a loop:false animation reaches its last frame — used to
  // self-destruct throwaway instances (see nestedScene3PopupSpawner.js).
  onComplete(cb) {
    this.anim.addEventListener('complete', cb);
    return () => this.anim.removeEventListener('complete', cb);
  }

  getTransform() {
    return { ...this.transform };
  }

  setTransform(t) {
    Object.assign(this.transform, t);
    this._applyCss();
  }

  // DOM z-index across the Pixi<->Lottie boundary is coordinated by the
  // composition root (main.js), since Lottie is a whole separate context
  // that can only sit above or below the entire Pixi canvas, not interleaved
  // between individual sprites within it.
  setZIndex(i) {
    this._index = i;
  }

  setLocked(locked) {
    this.locked = !!locked;
    this.el.style.cursor = this.locked ? 'default' : 'grab';
  }

  select() {}
  deselect() {}

  destroy() {
    this._offResize();
    this.anim.destroy();
    this.el.remove();
  }
}
