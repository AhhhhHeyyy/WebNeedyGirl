import { StatStore, STAT_RANGE } from './StatStore.js';
import { spawnNestedScene3Popup, setAngelDCoverActive } from '../layers/nestedScene3PopupSpawner.js';
import { setHeartsActive, setLoveSpamActive, triggerHeartBurst, configure as configureYandereProto } from '../layers/yandereProtoOverlay.js';
import { triggerShake } from './screenShake.js';

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

// User-requested (not from the spec doc): stress AND darkness both pinned at
// their absolute caps turns the tvGlitch layer on — off again the moment
// either drops back below max, same edge-triggered on/off shape as
// windowBreak below.
function tvGlitchActive(s) {
  return s.stress >= STAT_RANGE.stress[1] && s.darkness >= STAT_RANGE.darkness[1];
}

// User-requested (not from the spec doc): any TWO of the three stats at/over
// 60 at once swaps which Angel spine is showing — Angel_A off, Angel_D on —
// reversing the moment fewer than two still clear the threshold.
const ANGEL_SWAP_THRESHOLD = 60;
function angelSwapActive(s) {
  const over = [s.affection, s.stress, s.darkness].filter((v) => v >= ANGEL_SWAP_THRESHOLD).length;
  return over >= 2;
}

// User-requested: each Angel spine re-skins itself off the exact same mode
// holoMode() already computed for the holographic overlay, so the character
// visually enters "Yami" (pink/yandere) or "Stress" (drug) the instant the
// backdrop does, rather than tracking its own separate thresholds. Angel_D's
// rig only ships a Yami variant (no separate Stress skin), so 'drug' there
// just falls back to the plain 'dark' skin.
function angelASkinFor(mode) {
  if (mode === 'yandere') return 'Angel_Yami';
  if (mode === 'drug') return 'Angel_Stress';
  return 'Angel';
}

function angelDSkinFor(mode) {
  return mode === 'yandere' ? 'dark2_yami' : 'dark';
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
let prevAffection = null;

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

let tvGlitchOn = false;

function setTvGlitch(active) {
  if (active === tvGlitchOn) return;
  tvGlitchOn = active;
  ctx.manager.setVisible('tvGlitch', active);
  if (active) triggerShake(); // user-requested: shake on the on-edge only, not when it turns back off
}

let angelSwapOn = false;

function setAngelSwap(active) {
  if (active === angelSwapOn) return;
  angelSwapOn = active;
  ctx.manager.setVisible('spineAngelASpine', !active);
  ctx.manager.setVisible('spineAngelDSpine', active);
  setAngelDCoverActive(active); // user-requested: cover the Nested Scene 3 window with opaque #000295 while Angel_D is showing
  if (active) triggerShake(); // user-requested: shake only on the Angel_A->D swap edge, not the reverse
}

function onStatChange(s) {
  const holo = ctx.manager.get('holographic');
  const mode = holoMode(s);
  const intensity = clamp01(Math.max(s.affection, s.darkness) / 100);
  holo?.el?.contentWindow?.postMessage({ type: 'ng-holo-mode', mode, intensity }, window.location.origin);

  ctx.manager.get('spineAngelASpine')?.setSkin?.(angelASkinFor(mode));
  ctx.manager.get('spineAngelDSpine')?.setSkin?.(angelDSkinFor(mode));

  const retro = ctx.manager.get('retroFilter');
  retro?.setDarknessIntensity?.(darknessOpacity(s));

  // User-requested: any affection increase (regardless of mode/threshold)
  // fires a one-shot ~2s heart-float burst, on top of the continuous yandere
  // ambience above. Skip the very first snapshot (prevAffection === null) so
  // start()'s initial emit doesn't fire a spurious burst.
  if (prevAffection !== null && s.affection > prevAffection) triggerHeartBurst();
  prevAffection = s.affection;

  setHeartsActive(mode === 'yandere');
  setLoveSpamActive(loveSpamActive(s));
  setWindowBreak(windowBreakActive(s));
  setTvGlitch(tvGlitchActive(s));
  setAngelSwap(angelSwapActive(s));
}

export const EffectDirector = {
  start(newCtx) {
    if (unsubscribe) return; // already running
    ctx = newCtx;
    // So the love-spam text can steer clear of Frame 1's box — see
    // yandereProtoOverlay.js's own comment on configure()/getFrame1Rect().
    configureYandereProto(newCtx.manager);
    unsubscribe = StatStore.on('change', onStatChange);
  },

  stop() {
    unsubscribe?.();
    unsubscribe = null;
    prevAffection = null;
    setWindowBreak(false);
    setTvGlitch(false);
    setAngelSwap(false);
    setAngelDCoverActive(false);
  },
};
