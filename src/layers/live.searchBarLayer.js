import { BaseImageLayer } from './BaseImageLayer.js';

// See live.3LineLayer.js's comment: the "live" group has no heading.boarding-
// style non-uniformly-stretched sibling, so BoardAnchoredLayer's stretch
// correction was spurious here too — and left uncorrected on this layer
// alone, it made this drift vertically apart from live.3Line (which got the
// same fix) on any non-16:9 resize. Plain BaseImageLayer keeps both in
// lockstep since they then scale identically under Stage's uniform root.
export async function create(opts) {
  return BaseImageLayer.create(opts);
}
