import { StatStore } from './StatStore.js';
import { spawnNestedScene3Popup } from '../layers/nestedScene3PopupSpawner.js';
import { setHeartsActive, setLoveSpamActive } from '../layers/yandereProtoOverlay.js';

// The only module that ever reads raw StatStore values — every visual
// consumer below (holographic's script.js, retroFilterLayer, the two
// yandere prototypes, the window-break spawner) only ever receives an
// already-computed mode name / intensity float / boolean flag, the same way
// shared/perf-monitor.js computes a tier once centrally instead of letting
// every effect reimplement FPS bucketing. That means wiring real
// sticker/superchat/keyword inputs later only means adding more
// StatStore.apply() call sites elsewhere — nothing in this file, or in any
// effect it drives, needs to change.
//
// Formulas ported from system/NeedyGirl-簡化版-工程實作規格.md §4/§5 (this
// round only implements ①②③⑤ — darkness overlay, holographic dual-mode,
// window-break; ⑥ fan-overload is intentionally not wired up yet, see the
// plan doc's "這輪明確不做" section).
function holoMode(s) {
  if (s.affection >= 60 && s.affection >= s.darkness) return 'yandere';
  if (s.darkness >= 60) return 'drug';
  return 'normal';
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function darknessOpacity(s) {
  return clamp01((s.stress * 0.4 + s.darkness * 0.6) / 100);
}

function windowBreakActive(s) {
  return s.affection >= 70 && s.darkness >= 70;
}

function loveSpamActive(s) {
  return s.affection >= 95;
}

// Re-spawns a window-break pop-up on this interval for as long as the
// affection+darkness threshold holds, rather than firing once per
// false->true edge — the spec frames this as a persistent/periodic
// occurrence ("可持續/週期 spawn 直到條件解除"), not a one-shot sting.
const WINDOW_BREAK_INTERVAL_MS = 6000;

let ctx = null; // { manager, stage, lottieContainer }
let unsubscribe = null;
let windowBreakTimer = null;
let windowBreakOn = false;

function spawnWindowBreakOnce() {
  const frame1 = ctx.manager.get('frame1');
  if (!frame1?.sprite) return;
  // Random point inside Frame 1's own logical-space box — same coordinate
  // space main.js's stage-area click handler already feeds
  // spawnNestedScene3Popup() (see clientToLogical() / holographicLayer.js's
  // _reposition() for the same bounds*scale pattern), just picked
  // programmatically instead of read off a pointer event. Kept inside the
  // middle 60% of the box so pop-ups don't spawn clipped at Frame 1's edge.
  const bounds = frame1.sprite.getLocalBounds();
  const w = bounds.width * frame1.sprite.scale.x;
  const h = bounds.height * frame1.sprite.scale.y;
  const x = frame1.sprite.x + (Math.random() - 0.5) * w * 0.6;
  const y = frame1.sprite.y + (Math.random() - 0.5) * h * 0.6;
  spawnNestedScene3Popup(x, y, ctx).catch((err) => console.error('EffectDirector: window-break spawn failed:', err));
}

function setWindowBreak(active) {
  if (active === windowBreakOn) return;
  windowBreakOn = active;
  if (active) {
    spawnWindowBreakOnce();
    windowBreakTimer = setInterval(spawnWindowBreakOnce, WINDOW_BREAK_INTERVAL_MS);
  } else if (windowBreakTimer) {
    clearInterval(windowBreakTimer);
    windowBreakTimer = null;
  }
}

function onStatChange(s) {
  const holo = ctx.manager.get('holographic');
  const mode = holoMode(s);
  const intensity = clamp01(Math.max(s.affection, s.darkness) / 100);
  holo?.el?.contentWindow?.postMessage({ type: 'ng-holo-mode', mode, intensity }, window.location.origin);

  const retro = ctx.manager.get('retroFilter');
  retro?.setDarknessIntensity?.(darknessOpacity(s));

  setHeartsActive(mode === 'yandere');
  setLoveSpamActive(loveSpamActive(s));
  setWindowBreak(windowBreakActive(s));
}

export const EffectDirector = {
  start(newCtx) {
    if (unsubscribe) return; // already running
    ctx = newCtx;
    unsubscribe = StatStore.on('change', onStatChange);
  },

  stop() {
    unsubscribe?.();
    unsubscribe = null;
    setWindowBreak(false);
  },
};
