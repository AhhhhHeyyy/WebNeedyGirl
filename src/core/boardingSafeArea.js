// heading.boarding (see src/layers/heading.boardingLayer.js) always stretches
// to fill the stage's own box edge-to-edge with no letterboxing, so for every
// boarding-relative overlay "don't overlap boarding" is the same thing as
// "stay inset from the stage's own edges". The sticker list row
// (stickerListLayer.js, full-viewport iframe) and the permanent stat meter
// (frame1Layer.js's buildStatHud, a plain DOM element) live in two different
// rendering contexts and can't literally share one parent DOM node — this is
// the shared inset both clamp themselves into instead, so one padding tweak
// here moves both consistently rather than each carrying its own hand-picked
// edge margin.
export const BOARDING_SAFE_PADDING_U = 24; // logical (1920x1080-space) px

// Clamps a screen-px box {left, top, width, height} so it stays fully inside
// the boarding's own box minus BOARDING_SAFE_PADDING_U on every side (scaled
// to screen px via stage.scaleFactor, the same "u" convention every other
// boarding-relative layer already uses). Mirrors the plain
// `Math.max(0, Math.min(x, max))` clamp pattern already used throughout
// stickerListLayer.js/frame1Layer.js, just with the padding baked in instead
// of a bare 0/stageW/stageH edge.
// `opts.minLeft`/`opts.minTop` override the usual `pad` floor on their axis —
// for a box that's deliberately anchored flush to another sprite's own edge
// (e.g. stickerListLayer.js's horizontal row against Frame 1), that sprite's
// edge is already whatever the boarding considers safe; re-flooring at the
// generic `pad` on top of that can push the box away from its anchor on a
// viewport where the anchor itself sits closer to the real edge than `pad`
// (mobileWiden.js widens Frame 1 using its own, differently-scaled edge
// margin, so the two don't always agree). Passing `Math.min(pad, anchorLeft)`
// as `minLeft` keeps the normal safety floor everywhere it doesn't conflict
// with the anchor, and only relaxes it exactly where the anchor is already
// the tighter (so still-safe) constraint.
export function clampIntoBoardingSafeArea(stage, box, opts = {}) {
  const pad = BOARDING_SAFE_PADDING_U * stage.scaleFactor;
  const minLeft = opts.minLeft ?? pad;
  const minTop = opts.minTop ?? pad;
  return {
    left: Math.max(minLeft, Math.min(box.left, stage.width - pad - box.width)),
    top: Math.max(minTop, Math.min(box.top, stage.height - pad - box.height)),
  };
}
