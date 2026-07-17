import { BaseSpineLayer } from './BaseSpineLayer.js';
import { attachFrame1Mask } from './frame1ClippedImageLayer.js';

// "Angel" skin of the shared UI/spineAngel/skeleton.json rig — replaces the
// old baked SpineAngel_A.spine.gif (see spineAngelDSpineLayer.js for the
// "dark" skin sharing the same skeleton+atlas).
export async function create(opts) {
  const layer = await BaseSpineLayer.create({
    id: opts.id, label: opts.label, src: `UI/${opts.file}`, skin: opts.skin,
    stage: opts.stage, x: 0, y: 0, scale: 1,
  });
  return attachFrame1Mask(layer, { manager: opts.manager, stage: opts.stage });
}
