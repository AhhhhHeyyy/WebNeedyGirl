// Measures real frame rate on the top-level document (same-origin iframes in
// this tab share one compositor/vsync schedule, so a stutter inside e.g.
// UI/checkerboard's own rAF loop shows up here too — no need to measure
// separately inside every effect iframe) and derives a coarse quality tier
// that BaseIframeLayer.js broadcasts to every effect iframe via postMessage
// (see its _postTierState()). Effects opt in by listening for
// {type:'ng-perf-tier', tier} and clamping their own per-frame cost —
// currently only UI/checkerboard does.
(function () {
  const TIERS = ['off', 'low', 'medium', 'high'];
  const DOWNGRADE_FPS = 45, DOWNGRADE_SUSTAIN_MS = 1500;
  const UPGRADE_FPS = 55;
  const UPGRADE_SUSTAIN_MS = { off: 4000, low: 5000, medium: 8000 }; // no entry for 'high' — already max
  // Asymmetric on purpose: react to real stutter fast, but only trust
  // "it's fine now" after a much longer sustained window, and only ever
  // move one tier per event — avoids flapping between tiers on borderline
  // hardware.
  const CHANGE_COOLDOWN_MS = 2000;
  const EMA_ALPHA = 0.15;

  // Seed from the same viewport-width proxy shared/device-perf.js already
  // uses, so a phone doesn't spend its first ~1.5s guessing 'high' before
  // correcting down.
  let tier = window.innerWidth <= 1024 ? 'medium' : 'high';

  const listeners = new Set();
  function setTier(next) {
    if (next === tier) return;
    tier = next;
    listeners.forEach((fn) => { try { fn(tier); } catch (e) { console.error(e); } });
  }
  window.getPerfTier = () => tier;
  window.onPerfTierChange = (fn) => {
    listeners.add(fn);
    fn(tier); // late subscribers get the current tier immediately
    return () => listeners.delete(fn);
  };

  let emaFps = 60, lastTime = null, badSince = null, goodSince = null, lastChangeAt = 0, rafId = null;

  function onFrame(now) {
    rafId = requestAnimationFrame(onFrame);
    if (lastTime === null) { lastTime = now; return; } // discard first sample after a (re)start
    const dt = Math.min(Math.max(now - lastTime, 1), 250);
    lastTime = now;
    emaFps += (1000 / dt - emaFps) * EMA_ALPHA;

    if (now - lastChangeAt < CHANGE_COOLDOWN_MS) { badSince = goodSince = null; return; }

    const i = TIERS.indexOf(tier);
    if (emaFps < DOWNGRADE_FPS) {
      goodSince = null;
      if (badSince === null) badSince = now;
      else if (now - badSince >= DOWNGRADE_SUSTAIN_MS && i > 0) {
        setTier(TIERS[i - 1]); lastChangeAt = now; badSince = null;
      }
    } else if (emaFps > UPGRADE_FPS) {
      badSince = null;
      const need = UPGRADE_SUSTAIN_MS[tier];
      if (!need) { goodSince = null; return; } // already 'high'
      if (goodSince === null) goodSince = now;
      else if (now - goodSince >= need) {
        setTier(TIERS[i + 1]); lastChangeAt = now; goodSince = null;
      }
    } else {
      badSince = null; goodSince = null; // 45-55fps dead zone: this *is* the hysteresis
    }
  }

  function start() { if (rafId === null) { lastTime = null; rafId = requestAnimationFrame(onFrame); } }
  function stop() { if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; } }
  // Own visibilitychange handling (independent of src/main.js's) — a
  // backgrounded tab's throttled rAF would otherwise register as a
  // catastrophic dt and trigger a false downgrade.
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });
  start();
})();
