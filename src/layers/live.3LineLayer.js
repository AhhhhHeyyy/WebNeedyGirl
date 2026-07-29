import { BaseImageLayer } from './BaseImageLayer.js';

// BoardAnchoredLayer's per-axis stretch correction exists only to keep an
// overlay glued to heading.boarding's own deliberate non-uniform edge-to-edge
// stretch (see that class's comment) — the "live" group has no such stretched
// sibling, so applying it here just fabricated a spurious drift on every
// resize whose viewport aspect ratio wasn't exactly 16:9, pulling this away
// from Frame 1's left edge. A plain BaseImageLayer scales in lockstep with
// every other layer (including frame1) under Stage's single uniform root
// scale... EXCEPT Frame 1 itself isn't always scaled uniformly either:
// mobileWiden.js reclaims pillarbox margin on a wide/short viewport by
// stretching Frame 1's own width (scale.x) and pushing its OUTER (left) edge
// further left to do it (see that file's own top comment) — but it only ever
// touches frame1/frame1B and chat, never this "live" group, so this icon's
// plain, un-anchored position silently drifts out of alignment with Frame
// 1's real left edge the moment mobileWiden kicks in (user report: "讓 3
// line始終對齊frame1左側"). Tracks Frame 1's live getBounds() every resize
// instead, the same "read the other sprite's actual screen box, don't assume
// a fixed relationship" pattern holographicLayer.js/stickerListLayer.js
// already use for their own Frame-1-anchored overlays.

// Gap between this icon's own left edge and Frame 1's left edge, in logical
// (1920x1080-space) units — NOT re-derived at runtime (a "capture the gap
// once, live" approach would race the app's own boot order: this layer's
// constructor runs during main.js's initial Promise.all, well BEFORE
// applySnapshot() moves frame1 from its raw manifest default (x=0) to its
// real authored/saved position, and before initMobileWiden() settles
// anything — capturing "whatever the gap looks like right now" at
// construction time would almost always capture a bogus, pre-layout value).
// Computed once by hand instead, straight from the two sprites' own
// state.json-authored transforms + their real asset pixel dimensions
// (measured directly, same approach this session already used for
// BOTTOM_SAFE_U off boarding.png): frame1 (x=-263.856, scale=1, native width
// 1281px) has its left edge at logical x -904.356; live.3Line (group x
// 187.395 + local x -1062, scale 1.19, native width 42px) has its own left
// edge at logical x -899.595 — a difference of ~4.76. If the icon's own
// authored transform (or the "live" group's) is ever deliberately re-tuned
// via the layer panel, this constant should be re-derived the same way, not
// left stale.
const LEFT_GAP_LOGICAL = 4.76;

export class ThreeLineLayer extends BaseImageLayer {
  constructor(opts) {
    super(opts);
    this.manager = opts.manager;
    this._offManagerChange = this.manager.onChange(() => this._reposition());
    this._offResize = this.stage.onResize(() => this._reposition());
    this._reposition();
  }

  _reposition() {
    const frame1 = this.manager.get('frame1');
    if (!frame1 || !frame1.sprite) return;
    // frame1 is a top-level layer (not nested in any group), so frame1.stage
    // IS the real global Stage instance — its scaleFactor is the true
    // logical->screen ratio, unlike `this.stage` here (the "live" group's own
    // childStage proxy, see GroupLayer.js), which additionally folds in the
    // group's OWN scale. LEFT_GAP_LOGICAL is authored in the same
    // logical/1920x1080 space every sprite's x/y already live in, so it needs
    // the TRUE scale, not the group-composed one, to convert to screen px.
    const trueScale = frame1.stage.scaleFactor;
    const frame1LeftScreen = frame1.sprite.getBounds().x; // already reflects mobileWiden's live width-only stretch
    const targetScreenX = frame1LeftScreen + LEFT_GAP_LOGICAL * trueScale;
    // toLocal (not a hand-rolled inverse transform) converts that screen
    // point into THIS sprite's own parent space (the "live" group's
    // container) — walking the real transform chain instead of assuming a
    // plain, unrotated affine relationship keeps this correct even if the
    // group itself is ever dragged/rescaled as a whole (LayerPanel.js's
    // normal per-layer sliders, see GroupLayer.js's own getTransform/
    // setTransform). Y is irrelevant here (only .x is used below) as long as
    // the group carries no rotation, true of its current authored state.
    const targetLocal = this.sprite.parent.toLocal(new PIXI.Point(targetScreenX, 0));
    const halfWidthLocal = this.sprite.width / 2; // Sprite.width already folds in this sprite's OWN scale — same units sprite.x is in
    this.sprite.x = targetLocal.x + halfWidthLocal;
  }

  destroy() {
    this._offManagerChange();
    this._offResize();
    super.destroy();
  }
}

export async function create(opts) {
  const loaded = await PIXI.Assets.load(opts.src);
  const sprite = loaded instanceof PIXI.Texture ? new PIXI.Sprite(loaded) : loaded;
  return new ThreeLineLayer({ ...opts, sprite });
}
