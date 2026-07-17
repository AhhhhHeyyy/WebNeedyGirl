import { BaseSpineLayer } from './BaseSpineLayer.js';
import { attachFrame1Mask } from './frame1ClippedImageLayer.js';

// "dark" skin of the shared UI/spineAngel/skeleton.json rig — replaces the
// old baked SpineAngel_D.spine.gif (see spineAngelASpineLayer.js for the
// "Angel" skin sharing the same skeleton+atlas).
//
// This is the panel-editable, single persistent instance, clipped to Frame 1
// like Angel A. The "peek through Nested Scene 3's window" effect is a
// separate, throwaway Angel D instance spawned fresh per click — as many as
// are clicked into existence at once — see nestedScene3PopupSpawner.js.
export async function create(opts) {
  const layer = await BaseSpineLayer.create({
    id: opts.id, label: opts.label, src: `UI/${opts.file}`, skin: opts.skin,
    stage: opts.stage, x: 0, y: 0, scale: 1,
  });
  return attachFrame1Mask(layer, { manager: opts.manager, stage: opts.stage });
}
