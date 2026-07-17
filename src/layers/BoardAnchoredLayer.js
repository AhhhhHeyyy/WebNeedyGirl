import { BaseImageLayer } from './BaseImageLayer.js';
import { LOGICAL_W, LOGICAL_H } from '../core/Stage.js';

// heading.boarding (see heading.boardingLayer.js) always stretches
// non-uniformly to cover the stage's box edge-to-edge, breaking aspect ratio
// on purpose so there's never a letterboxed gap around it. Everything else
// in the "heading" group (Heading, Heading-3, ...) instead uses the normal
// uniform group scale — fine on its own, except it means that as soon as
// the viewport's aspect ratio drifts from 16:9, boarding's non-uniform
// stretch and these overlay elements' uniform scale disagree, and the
// overlays visually detach from wherever they're supposed to sit on the
// board graphic.
//
// This keeps an overlay's POSITION glued to the same relative spot on the
// stretched board (reusing boarding's own per-axis stretch ratio + its
// "ignore the group's own drag" cancellation), while leaving the sprite's
// own scale alone — unlike boarding, these shouldn't be squashed/stretched
// out of their own proportions, just relocated.
export class BoardAnchoredLayer extends BaseImageLayer {
  constructor(opts) {
    super(opts);
    // Wherever this was authored/dragged to (assuming a "fit" 16:9-ish
    // canvas) is the anchor to reproduce on the actual, possibly-stretched
    // board — captured now, and resynced after every live drag so a later
    // resize can't undo the user's own repositioning.
    this._anchorX = this.sprite.x;
    this._anchorY = this.sprite.y;

    // BaseImageLayer's constructor already wired drag.onChange to just
    // re-emit a manager change event; wrap it so every live pointer-drag
    // also updates the anchor before that happens.
    const notify = this.drag.onChange;
    this.drag.onChange = (...args) => {
      this._syncAnchorFromSprite();
      notify(...args);
    };

    this._offResize = this.stage.onResize(() => this._reposition());
    this._reposition();
  }

  _stretchFactors(parent) {
    const combinedScale = this.stage.scaleFactor; // root.scale * group.scale, both uniform
    return {
      stretchX: this.stage.width / (combinedScale * LOGICAL_W),
      stretchY: this.stage.height / (combinedScale * LOGICAL_H),
    };
  }

  _reposition() {
    const parent = this.sprite.parent; // group.container
    const { stretchX, stretchY } = this._stretchFactors(parent);
    this.sprite.x = -parent.position.x / parent.scale.x + this._anchorX * stretchX;
    this.sprite.y = -parent.position.y / parent.scale.y + this._anchorY * stretchY;
    this.drag._layoutHandles();
  }

  _syncAnchorFromSprite() {
    const parent = this.sprite.parent;
    const { stretchX, stretchY } = this._stretchFactors(parent);
    this._anchorX = (this.sprite.x + parent.position.x / parent.scale.x) / stretchX;
    this._anchorY = (this.sprite.y + parent.position.y / parent.scale.y) / stretchY;
  }

  getTransform() {
    return { ...this.drag.getTransform(), x: this._anchorX, y: this._anchorY };
  }

  setTransform(t) {
    if (t.x !== undefined) this._anchorX = t.x;
    if (t.y !== undefined) this._anchorY = t.y;
    const { x, y, ...rest } = t;
    if (Object.keys(rest).length) this.drag.setTransform(rest);
    this._reposition();
  }

  destroy() {
    this._offResize();
    super.destroy();
  }
}
