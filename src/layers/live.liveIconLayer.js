import { BaseImageLayer } from './BaseImageLayer.js';

// See live.3LineLayer.js's comment: the "live" group has no heading.boarding-
// style non-uniformly-stretched sibling, so BoardAnchoredLayer's stretch
// correction is spurious here too. Plain BaseImageLayer keeps this in
// lockstep with live.3Line/live.searchBar since all three then scale
// identically under Stage's uniform root — that's what keeps this new
// triangle+"Live" badge height-aligned with them on every resize, with no
// extra positioning code needed.
export async function create(opts) {
  return BaseImageLayer.create(opts);
}
