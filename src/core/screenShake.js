// Whole-scene "camera" shake — user-requested punctuation for two
// EffectDirector edge-triggers (Angel_A->D swap, tvGlitch turning on).
//
// Moves #stage-world, NOT #stage-area. #stage-area (see index.html) is a
// fixed mask/viewport — overflow:hidden, never transformed — that everything
// else in the composition sits inside; #stage-world is the inner wrapper
// holding the actual content (Pixi canvas + every DOM effect overlay —
// holographic/retroFilter/tvGlitch/chat/stickerList/yandere-proto all live
// inside it). Shaking the world instead of the mask is what makes this read
// as a camera shake: the on-screen window stays perfectly still (no seam
// opens against #panel or the browser edge), only the content behind that
// window appears to move — instead of the mask box itself physically
// wobbling relative to its surroundings.
// #panel-toggle/#panel (LayerPanel/StatDebugPanel/etc.) are outside
// #stage-world entirely — dev UI, deliberately excluded from shaking.
//
// #stage-world's `will-change: transform` is set once in index.html's CSS,
// not toggled here per-shake — see that file's comment for why (promoting/
// demoting a layer this heavy just-in-time was itself a source of stutter).
const DURATION_MS = 300;
const MAX_OFFSET_PX = 4;
const MAX_ROTATION_DEG = 0.15;
const FREQUENCY_HZ = 1000 / DURATION_MS; // exactly 1 full back-and-forth cycle across DURATION_MS

// EffectDirector's two edges (tvGlitch / Angel swap) can share thresholds
// close enough together that one stat change trips both at once, or a burst
// of changes trips them in quick succession —
// re-triggering while a shake is still mid-decay. A fresh trigger snapping
// straight to this shake's own curve is the intended "hit" (fast attack,
// tapering decay), but a RE-trigger doing the same snapped from wherever the
// previous shake had already decayed to, not from 0 — a visible pop/jump,
// not a smooth hand-off. Only re-triggers blend away from the last applied
// offset over RETRIGGER_BLEND_MS; a fresh trigger (nothing was playing) skips
// the blend and keeps the original instant-attack feel.
const RETRIGGER_BLEND_MS = 60;

let rafId = null;
let lastDx = 0, lastDy = 0, lastRot = 0; // last transform actually applied, for retrigger hand-off

export function triggerShake() {
  const el = document.getElementById('stage-world');
  if (!el) return;

  const wasActive = rafId !== null;
  if (wasActive) cancelAnimationFrame(rafId);
  const blendFromDx = wasActive ? lastDx : 0;
  const blendFromDy = wasActive ? lastDy : 0;
  const blendFromRot = wasActive ? lastRot : 0;
  const blendMs = wasActive ? RETRIGGER_BLEND_MS : 0;

  const startTs = performance.now();
  // Randomized once per trigger (not re-rolled every frame) — a fresh random
  // *target* every single frame is what read as stuttery/janky rather than a
  // fluid shake; a continuous sine wave with a random phase/axis-offset still
  // varies trigger to trigger but interpolates smoothly frame to frame.
  const phaseX = Math.random() * Math.PI * 2;
  const phaseY = Math.random() * Math.PI * 2;
  const phaseRot = Math.random() * Math.PI * 2;

  function frame(now) {
    const elapsed = now - startTs;
    if (elapsed >= DURATION_MS) {
      el.style.transform = '';
      lastDx = lastDy = lastRot = 0;
      rafId = null;
      return;
    }
    // Ease-out (squared) decay reads as a smoother settle than a straight
    // linear falloff, on top of already being a much gentler max amplitude.
    const remaining = 1 - elapsed / DURATION_MS;
    const amp = MAX_OFFSET_PX * remaining * remaining;
    const ampRot = MAX_ROTATION_DEG * remaining * remaining;
    const t = elapsed / 1000;
    let dx = amp * Math.sin(2 * Math.PI * FREQUENCY_HZ * t + phaseX);
    let dy = amp * Math.sin(2 * Math.PI * FREQUENCY_HZ * t * 1.3 + phaseY);
    let rot = ampRot * Math.sin(2 * Math.PI * FREQUENCY_HZ * t * 0.8 + phaseRot);

    if (blendMs > 0 && elapsed < blendMs) {
      const bt = elapsed / blendMs;
      dx = blendFromDx + (dx - blendFromDx) * bt;
      dy = blendFromDy + (dy - blendFromDy) * bt;
      rot = blendFromRot + (rot - blendFromRot) * bt;
    }

    lastDx = dx; lastDy = dy; lastRot = rot;
    el.style.transform = `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) rotate(${rot.toFixed(3)}deg)`;
    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);
}
