// Pixi renderer + fixed logical-coordinate RWD scaling.
// Sprites are positioned/scaled in LOGICAL_W x LOGICAL_H space; resize() only
// rescales the single root container, so per-layer transforms never need
// to know about the viewport. Mirrors the resize() pattern already used
// for the #gl shader canvas in effects/holographic/script.js.
//
// Sized off the container element's own box (via ResizeObserver), not
// window.innerWidth/innerHeight — the composition root now docks the layer
// panel as a real sidebar next to the stage (see index.html), so the
// canvas's box shrinks/grows independently of the window itself (e.g. when
// the panel is toggled open/closed), and this needs to track that directly.

export const LOGICAL_W = 1920;
export const LOGICAL_H = 1080;

export class Stage {
  constructor(containerEl) {
    this.containerEl = containerEl;
    this._resizeListeners = new Set();

    this.app = new PIXI.Application({
      backgroundAlpha: 0,
      // Was `true`. MSAA cost scales with edge count/overdraw, and
      // spineAngel's rig draws far more (and far smaller) triangle edges
      // than any other layer on stage — if the GPU is right at its frame
      // budget, that's the one place antialiasing tax is most likely to
      // push a frame past vsync. Toggle back to `true` if the slightly
      // softer edges aren't worth it once we know whether this helped.
      antialias: false,
      // On hybrid-GPU laptops, a WebGL context with no explicit preference can
      // silently land on the integrated GPU — fine for static sprites, but it
      // shows up as stutter on the one continuously-animating thing on stage
      // (currently spineAngel's idle loop) once its per-frame skinning/masking
      // cost is enough to miss vsync on the weaker chip.
      powerPreference: 'high-performance',
      resolution: window.getPerfResolutionCap ? window.getPerfResolutionCap() : Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    });
    containerEl.appendChild(this.app.view);

    // Root container: all layer sprites are children of this, in logical
    // coordinates. Its own scale/position is the only thing resize() touches.
    this.root = new PIXI.Container();
    this.root.sortableChildren = true;
    this.app.stage.addChild(this.root);

    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(containerEl);
    this.resize();
  }

  resize() {
    const w = this.containerEl.clientWidth;
    const h = this.containerEl.clientHeight;
    if (w === 0 || h === 0) return; // e.g. mid-transition while display:none is toggling off
    this.app.renderer.resize(w, h);
    const scale = Math.min(w / LOGICAL_W, h / LOGICAL_H);
    this.root.scale.set(scale);
    this.root.position.set(w / 2, h / 2);
    this._resizeListeners.forEach(fn => fn());
  }

  // Current logical-to-screen scale factor; layers/drag handles need this
  // to convert pointer deltas (screen px) back into logical units.
  get scaleFactor() {
    return this.root.scale.x;
  }

  // Current stage box in CSS px — layers outside the Pixi scene graph (e.g.
  // BaseLottieLayer's own DOM element) need this to center themselves the
  // same way the Pixi root container does.
  get width() { return this.containerEl.clientWidth; }
  get height() { return this.containerEl.clientHeight; }

  // Fires after every resize (window resize, panel toggle, orientation
  // change — anything that changes the container's box), so DOM-based
  // layers can re-run their own positioning logic in step with the Pixi side.
  onResize(fn) {
    this._resizeListeners.add(fn);
    return () => this._resizeListeners.delete(fn);
  }

  destroy() {
    this._ro.disconnect();
    this.app.destroy(true, { children: true, texture: true, baseTexture: true });
  }
}
