import { BaseImageLayer } from './BaseImageLayer.js';

// heading.boarding is the message-board backdrop for the "heading" group;
// unlike its siblings (button/heading1-3, which stay in the group's shared
// logical space) it must always cover the stage's own box edge-to-edge with
// no letterboxing, stretched non-uniformly to match, independent of the
// root/group scale or any saved drag transform. "The stage's own box", not
// window.innerWidth/innerHeight, because the layer panel docks as a sidebar
// that shrinks that box (see Stage.js) — toggling the panel resizes the
// stage without the window itself resizing.
export class BoardingLayer extends BaseImageLayer {
  constructor(opts) {
    super(opts);
    this._naturalWidth = this.sprite.width;
    this._naturalHeight = this.sprite.height;

    // A background, not a draggable element: dragging it would just get
    // silently undone on the next resize, which reads as a bug.
    this.sprite.eventMode = 'none';
    this.sprite.cursor = 'default';

    this._offResize = this.stage.onResize(() => this._fillViewport());
    this._fillViewport();
  }

  _fillViewport() {
    const parent = this.sprite.parent; // group.container
    const combinedScale = this.stage.scaleFactor; // root.scale * group.scale, both uniform
    this.sprite.scale.set(
      this.stage.width / (combinedScale * this._naturalWidth),
      this.stage.height / (combinedScale * this._naturalHeight),
    );
    this.sprite.x = -parent.position.x / parent.scale.x;
    this.sprite.y = -parent.position.y / parent.scale.y;
  }

  // Ignore whatever transform a saved layout/panel drag asks for — this
  // layer's position/scale is always viewport-derived, never user-set.
  setTransform() {
    this._fillViewport();
  }

  destroy() {
    this._offResize();
    super.destroy();
  }
}

export async function create(opts) {
  const loaded = await PIXI.Assets.load(opts.src);
  const sprite = loaded instanceof PIXI.Texture ? new PIXI.Sprite(loaded) : loaded;
  return new BoardingLayer({ ...opts, sprite });
}
