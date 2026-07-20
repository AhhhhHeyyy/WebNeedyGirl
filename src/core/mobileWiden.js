// On a "narrow" viewport (short/wide landscape — a phone rotated sideways,
// or just a squat browser window; see UI/stickerList/stickerListLayer.js's
// own narrow-mode column for the same underlying signal), the whole
// 1920x1080 composition is height-bound (Stage.js's `Math.min(w/1920,
// h/1080)`), which pillarboxes it with blank margin on both sides. Frame 1's
// box and the chat panel would otherwise just shrink uniformly along with
// everything else and leave that reclaimed margin as dead space, so this
// stretches each of them horizontally ONLY (never vertically — a plain
// non-uniform scale.x bump, the same trick heading.boardingLayer.js uses to
// fill the viewport edge-to-edge) growing outward from whichever edge faces
// the OTHER box, so the gap between them never changes, until their combined
// on-screen width reaches MIN_COMBINED_FRACTION of the actual viewport (or
// there's no more margin left to give).
//
// Both boxes are assumed authored with Frame 1 on the left and the chat
// group on the right (true in state.json/manifest today) — this doesn't
// re-derive which is which every resize.
//
// Everything here is computed from each box's ORIGINAL (pre-widen) anchor,
// captured once at init, not from its current live transform — recomputing
// from a moving target would compound the stretch a little further on every
// subsequent resize instead of settling on a fixed answer for a given
// viewport size.
const MIN_COMBINED_FRACTION = 0.75;
const EDGE_PADDING_PX = 16; // keep a box's outer edge from ever touching the real viewport edge

function captureHome(obj) {
  const b = obj.getLocalBounds();
  return {
    x: obj.x, y: obj.y, scaleX: obj.scale.x, scaleY: obj.scale.y,
    // Center of the object's own content in its OWN local (unscaled) space —
    // 0 for a plain anchor-0.5 sprite (frame1), but chat's GroupLayer
    // container isn't itself anchor-centered (its children sit at whatever
    // x/y they were authored at inside the group), so this can't just assume
    // obj.x/y IS the box's visual center.
    localCenterX: b.x + b.width / 2,
    localCenterY: b.y + b.height / 2,
    nativeW: b.width,
    nativeH: b.height,
  };
}

export function initMobileWiden({ stage, manager }) {
  const frame1 = manager.get('frame1');
  const frame1B = manager.get('frame1B');
  const chat = manager.get('chat');
  if (!frame1 || !frame1B || !chat) return;

  const frame1Home = captureHome(frame1.sprite);
  const chatHome = captureHome(chat.container);

  function naturalBox(home, scale) {
    const logicalCenterX = home.x + home.localCenterX * home.scaleX;
    return {
      w: home.nativeW * home.scaleX * scale,
      centerX: stage.root.position.x + logicalCenterX * scale,
    };
  }

  // Moves+widens `obj` (frame1's sprite, or chat's group container) so its
  // new width is `box.w * growth`, keeping whichever edge faces the other
  // box (the "inner" edge) fixed in place. Only x/scale.x change — y and
  // scale.y are left exactly as authored.
  function applyBox(obj, home, box, scale, growth, side) {
    const newW = box.w * growth;
    const newScaleX = home.scaleX * growth;
    const innerEdge = side === 'left' ? box.centerX + box.w / 2 : box.centerX - box.w / 2;
    const newCenter = side === 'left' ? innerEdge - newW / 2 : innerEdge + newW / 2;
    const newLogicalCenterX = (newCenter - stage.root.position.x) / scale;
    obj.x = newLogicalCenterX - home.localCenterX * newScaleX;
    obj.scale.x = newScaleX;
  }

  function apply() {
    const scale = stage.scaleFactor;
    const viewportW = stage.width;

    const f1 = naturalBox(frame1Home, scale);
    const ch = naturalBox(chatHome, scale);
    const combined = f1.w + ch.w;
    if (combined <= 0) return;

    // Never shrinks below the authored (growth < 1) size, and never grows
    // past what still leaves EDGE_PADDING_PX of breathing room at the real
    // viewport edge.
    const maxAllowed = Math.max(combined, viewportW - 2 * EDGE_PADDING_PX);
    const target = Math.min(Math.max(combined, viewportW * MIN_COMBINED_FRACTION), maxAllowed);
    const growth = target / combined;

    applyBox(frame1.sprite, frame1Home, f1, scale, growth, 'left');
    applyBox(chat.container, chatHome, ch, scale, growth, 'right');

    // Frame 1_B is purely a visible skin over Frame 1's own (invisible) box —
    // see frame1ClippedImageLayer.js's comment on why Frame 1 alone is the
    // positional/size authority here — so it just mirrors Frame 1's resulting
    // transform outright instead of keeping a second anchor in lockstep.
    frame1B.sprite.x = frame1.sprite.x;
    frame1B.sprite.y = frame1.sprite.y;
    frame1B.sprite.scale.x = frame1.sprite.scale.x;
    frame1B.sprite.scale.y = frame1.sprite.scale.y;
    frame1B.sprite.rotation = frame1.sprite.rotation;

    // Neither sprite's mutation above goes through DragTransform/LayerManager,
    // so nothing has fired the manager-change event these depend on:
    // frame1ClippedImageLayer.js's mask (used by both spineAngelASpine and
    // spineAngelDSpine) only re-syncs to Frame 1's bounds on manager.onChange,
    // and main.js's click-to-spawn hit test just reads live bounds directly
    // (already fine either way). `onChange` is the exact same callback
    // DragTransform itself calls after a live drag (see DragTransform.js's
    // _move()), so this is just triggering that same path by hand.
    frame1.onChange();
  }

  stage.onResize(apply);
  apply();
}
