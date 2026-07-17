import { BaseImageLayer } from './BaseImageLayer.js';

// BoardAnchoredLayer's per-axis stretch correction exists only to keep an
// overlay glued to heading.boarding's own deliberate non-uniform edge-to-edge
// stretch (see that class's comment) — the "live" group has no such stretched
// sibling, so applying it here just fabricated a spurious drift on every
// resize whose viewport aspect ratio wasn't exactly 16:9, pulling this away
// from Frame 1's left edge. A plain BaseImageLayer scales in lockstep with
// every other layer (including frame1) under Stage's single uniform root
// scale, so it stays visually pinned to Frame 1 with no extra tracking code.
export async function create(opts) {
  return BaseImageLayer.create(opts);
}
