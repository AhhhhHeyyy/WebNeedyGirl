import { BaseImageLayer } from './BaseImageLayer.js';

// Shared behaviour for any layer "mounted inside" Frame 1: clipped to
// Frame 1's box, plus zIndex pinned just behind Frame 1, both live-tracked.
// Unlike holographic (a separate iframe context that can only approximate
// front/back order — see holographicLayer.js), these are already Pixi
// display objects in the same root container, so the order can be exact.
//
// Frame 1 is visually a plain rectangle, so this clips with a PIXI.Graphics
// rectangle that tracks Frame 1's live bounds, rather than using Frame 1's
// own sprite directly as an alpha mask: a live repro showed PixiJS's sprite
// mask (SpriteMaskFilter) drifting tens of px past the mask's edge once
// Frame 1 was dragged off its initial position — only the mask object's own
// transform had changed, not the masked object's. A Graphics rect mask uses
// the stencil-buffer masking path instead, which clips exactly with no drift.
//
// Position/scale of the masked layer stay fully user-draggable on purpose:
// this only clips whatever falls outside Frame 1's box, it doesn't force-fit
// the layer to Frame 1's box the way holographic does.
//
// Takes any already-constructed layer whose `.sprite` is a Pixi display
// object (BaseImageLayer, BaseSpineLayer, ...) — the masking/z-pin logic
// itself doesn't care what kind of content is inside that box.
export function attachFrame1Mask(layer, { manager, stage }) {
  const maskGfx = new PIXI.Graphics();
  stage.root.addChild(maskGfx);
  layer.sprite.mask = maskGfx;

  function sync() {
    const frame1 = manager.get('frame1');
    if (!frame1) return;
    const sprite = frame1.sprite;
    const bounds = sprite.getLocalBounds();
    const w = bounds.width * sprite.scale.x;
    const h = bounds.height * sprite.scale.y;
    maskGfx.clear().beginFill(0xffffff).drawRect(-w / 2, -h / 2, w, h).endFill();
    maskGfx.position.set(sprite.x, sprite.y);
    maskGfx.rotation = sprite.rotation;
    layer.sprite.zIndex = sprite.zIndex - 0.5;
  }

  const offChange = manager.onChange(sync);
  sync();

  // LayerManager._applyOrder() calls setZIndex(i) with this layer's own
  // array position — ignore that and stay pinned to Frame 1 instead.
  layer.setZIndex = sync;

  const baseDestroy = layer.destroy.bind(layer);
  layer.destroy = () => { offChange(); maskGfx.destroy(); baseDestroy(); };

  return layer;
}

export async function createFrame1ClippedLayer(opts) {
  const layer = await BaseImageLayer.create({
    id: opts.id, label: opts.label, src: `UI/${opts.file}`, stage: opts.stage, x: 0, y: 0, scale: 1,
  });
  return attachFrame1Mask(layer, { manager: opts.manager, stage: opts.stage });
}
