/* ── Baked settings ── this used to be a live-tunable panel (sliders +
   color pickers + state-sync persistence); that's been stripped out and
   the last tuned values are hardcoded below instead, so there's no panel
   DOM/JS/state-sync XHR at all and the deterministic motion can run as
   plain CSS (see style.css's .drift-x/.drift-y) instead of a per-frame JS
   loop. Only Glitch still needs JS, since its jitter is genuinely random. */
const CELL = 67, COUNT = 7, SPEED = 19.2, ANGLE = 44;
const COLORS = ['#ffadd9', '#e0fdff', '#cea8ff', '#f9fef1'];
const GRID = [
  [2, 0, 0, 3, 2, 2, 1],
  [0, 1, 1, 3, 0, 0, 3],
  [3, 2, 2, 0, 0, 2, 3],
  [3, 1, 2, 1, 2, 1, 2],
  [1, 2, 3, 0, 3, 0, 3],
  [1, 1, 0, 0, 1, 2, 2],
  [2, 2, 3, 2, 3, 1, 1],
];

const G = {
  intensity: 0.27, frequency: 1, bandCount: 2, bandSize: 0.2, bandRate: 0.2,
  distance: 14, skew: 0, scanOpacity: 0.215,
};
const CHAN_COLORS = ['#ff00ff', '#febefe', '#ecfefc'];

const CS = { intensity: 0.29, density: 0.44, angle: 200 };
const SHIFT_COLORS = ['#61e5ff', '#ff3de5'];
const ABERR = [
  [{ on: true, mag: 0.6212156176718029 }, { on: false, mag: 0.7850502208241159 }, { on: false, mag: 0.7167799375568487 }, { on: false, mag: 0.6698463107251054 }, { on: false, mag: 0.793445525178603 }, { on: true, mag: 0.9772566780038168 }, { on: false, mag: 0.6175313129386703 }],
  [{ on: true, mag: 0.9152296068059076 }, { on: false, mag: 0.4734094526359475 }, { on: false, mag: 0.5296075209658738 }, { on: false, mag: 0.5224466666420076 }, { on: true, mag: 0.6157223677459319 }, { on: false, mag: 0.4937490299787768 }, { on: false, mag: 0.5987172818350203 }],
  [{ on: true, mag: 0.9567934048543986 }, { on: true, mag: 0.5085663778287085 }, { on: false, mag: 0.651600881274601 }, { on: false, mag: 0.932021483380037 }, { on: true, mag: 0.49371688601768826 }, { on: false, mag: 0.54051648405913 }, { on: false, mag: 0.5940535894485518 }],
  [{ on: true, mag: 0.5185210141896675 }, { on: false, mag: 0.6207092345161862 }, { on: true, mag: 0.5802480666962502 }, { on: false, mag: 0.4408843649330064 }, { on: true, mag: 0.8073305978389688 }, { on: false, mag: 0.9015240946374656 }, { on: false, mag: 0.6642583441424494 }],
  [{ on: false, mag: 0.45970218082856823 }, { on: true, mag: 0.4786462144442165 }, { on: true, mag: 0.7339564118791753 }, { on: false, mag: 0.8572897706584086 }, { on: false, mag: 0.6688060634402719 }, { on: true, mag: 0.7033060418955552 }, { on: true, mag: 0.6206650115549114 }],
  [{ on: true, mag: 0.5980977662448776 }, { on: true, mag: 0.4661530012006999 }, { on: true, mag: 0.7362485595474951 }, { on: false, mag: 0.9416864071008711 }, { on: false, mag: 0.7384978918663965 }, { on: false, mag: 0.8743272107731896 }, { on: false, mag: 0.769544631224178 }],
  [{ on: true, mag: 0.4187201962459908 }, { on: false, mag: 0.4530908652251492 }, { on: true, mag: 0.4976816154103533 }, { on: true, mag: 0.6230254296934618 }, { on: false, mag: 0.8632402571381952 }, { on: false, mag: 0.8260768081114518 }, { on: false, mag: 0.45018421860461877 }],
];

const cbTileEl = document.getElementById('cb-tile');
const glitchEl = document.getElementById('glitch');
const bandEls = [document.getElementById('glitch-slice'), document.getElementById('glitch-slice2'), document.getElementById('glitch-slice3'), document.getElementById('glitch-slice4')];
const chanEls = [document.getElementById('glitch-r'), document.getElementById('glitch-g'), document.getElementById('glitch-b')];

chanEls.forEach((el, i) => { el.style.background = CHAN_COLORS[i]; });
document.documentElement.style.setProperty('--scan-op', G.scanOpacity);

/* ── Build the (static) tile backgrounds, once ── */
function buildSvg() {
  const size = COUNT * CELL;
  let rects = '';
  for (let r = 0; r < COUNT; r++) {
    for (let c = 0; c < COUNT; c++) {
      rects += `<rect x='${c * CELL}' y='${r * CELL}' width='${CELL}' height='${CELL}' fill='${COLORS[GRID[r][c]]}'/>`;
    }
  }
  return { size, svg: `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'>${rects}</svg>` };
}

const { size: tileSize, svg } = buildSvg();
const bg = `url("data:image/svg+xml,${svg.replace(/#/g, '%23')}")`;
// +40/+200 clear the color-shift fringe's own max nudge / the glitch jolt
// shove + skew fringe respectively (see PAD_MOD/BAND_PAD_MOD below) with
// room to spare — same margins the old JS-driven version used.
const pad = tileSize + 40;
const bandPad = tileSize + 200;
// wrap(pad + dx, tileSize) reduces to wrap(dx, tileSize) + PAD_MOD for any
// dx, since pad is exactly tileSize + a remainder smaller than tileSize —
// and wrap(dx, tileSize) is now what the CSS drift keyframes already
// provide by themselves (0 -> tileSize, then a seamless jump back to 0 on
// a background that tiles). So each drifting element only needs this
// constant added on top as a static transform, instead of a per-frame
// modulo recomputed in JS.
const PAD_MOD = pad % tileSize;
const BAND_PAD_MOD = bandPad % tileSize;

/* ── Color-shift fringe ── used to be two extra always-on elements
   (#cb-shift-p/#cb-shift-c) screen-blended live over #cb-tile. Both drifted
   under the exact same shared .drift-x/.drift-y timing as #cb-tile, only
   offset from it by a constant per-channel nudge (sx/sy below) that's fixed
   at init and never changes — so the live blend was recomputing, every
   compositor frame, a result that's actually static relative to the tile.
   `mix-blend-mode` also blocks the browser from promoting a moving element
   into its own cached GPU layer (it has to know what's underneath on every
   frame), so two always-on full-viewport blended layers were a real,
   continuous compositing cost for a fixed-looking fringe.
   Baked once instead: draw base + pink(screen) + cyan(screen) onto an
   offscreen canvas via the same 'screen' composite op the browser would've
   used, and ship the result as #cb-tile's one background image. The 3x3
   offset loop below reproduces the tiling wraparound a shifted, repeating
   background would show at the tile's edges. */
function buildCompositeTile() {
  const cvs = document.createElement('canvas');
  cvs.width = tileSize; cvs.height = tileSize;
  const ctx = cvs.getContext('2d');
  for (let r = 0; r < COUNT; r++) {
    for (let c = 0; c < COUNT; c++) {
      ctx.fillStyle = COLORS[GRID[r][c]];
      ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
    }
  }
  const shiftPx = 2 + CS.intensity * (CELL * 0.16);
  const sRad = CS.angle * Math.PI / 180;
  const sx = Math.cos(sRad) * shiftPx, sy = Math.sin(sRad) * shiftPx;
  ctx.globalCompositeOperation = 'screen';
  const drawFringe = (color, dx, dy) => {
    ctx.fillStyle = color;
    for (let ox = -tileSize; ox <= tileSize; ox += tileSize) {
      for (let oy = -tileSize; oy <= tileSize; oy += tileSize) {
        for (let r = 0; r < COUNT; r++) {
          for (let c = 0; c < COUNT; c++) {
            const a = ABERR[r][c];
            if (!a.on) continue;
            const op = a.mag * CS.intensity;
            if (op <= 0) continue;
            ctx.globalAlpha = op;
            ctx.fillRect(c * CELL + dx + ox, r * CELL + dy + oy, CELL, CELL);
          }
        }
      }
    }
  };
  drawFringe(SHIFT_COLORS[0], -sx, -sy);
  drawFringe(SHIFT_COLORS[1], sx, sy);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  return cvs.toDataURL();
}
const compositeBg = `url("${buildCompositeTile()}")`;

Object.assign(cbTileEl.style, {
  left: `-${pad}px`, top: `-${pad}px`,
  width: `calc(100% + ${pad * 2}px)`, height: `calc(100% + ${pad * 2}px)`,
  backgroundImage: compositeBg, backgroundSize: `${tileSize}px ${tileSize}px`,
});
cbTileEl.style.transform = `translate(${PAD_MOD}px, ${PAD_MOD}px)`;

bandEls.forEach(el => {
  Object.assign(el.style, {
    left: `-${bandPad}px`, top: `-${bandPad}px`,
    width: `calc(100% + ${bandPad * 2}px)`, height: `calc(100% + ${bandPad * 2}px)`,
    backgroundImage: bg, backgroundSize: `${tileSize}px ${tileSize}px`,
  });
});

/* ── Drift ── handed to CSS @keyframes (see style.css .drift-x/.drift-y);
   duration + travel distance are derived once from CELL/COUNT/SPEED/ANGLE
   and written as inline animation-duration/--dx/--dy so the compositor
   runs the endless pan with zero per-frame JS. */
{
  const rad = ANGLE * Math.PI / 180;
  const vx = SPEED * Math.cos(rad), vy = SPEED * Math.sin(rad);
  const Tx = Math.abs(tileSize / vx), Ty = Math.abs(tileSize / vy);
  const dx = (vx >= 0 ? 1 : -1) * tileSize, dy = (vy >= 0 ? 1 : -1) * tileSize;
  document.querySelectorAll('.drift-x').forEach(el => {
    el.style.animationDuration = `${Tx}s`;
    el.style.setProperty('--dx', `${dx}px`);
  });
  document.querySelectorAll('.drift-y').forEach(el => {
    el.style.animationDuration = `${Ty}s`;
    el.style.setProperty('--dy', `${dy}px`);
  });
}

/* ── Glitch driver ── the only part still driven from JS (rAF), since its
   jitter needs genuine randomness. Two layers of motion, always both
   running:
   - continuous micro-noise: re-randomizes the slice band + RGB-fringe
     offsets every ~45-100ms, scaled by Intensity.
   - periodic jolt: every few seconds, a short (~70-160ms) skew/rotate kick
     stacks on top of the noise for a bigger "glitch spike" moment, scaled
     by both Intensity (strength) and Frequency (how often). */
const bandCur = bandEls.map(() => ({ top: 0, h: 0, tx: 0 }));
const bandTgt = bandEls.map(() => ({ top: 0, h: 0, tx: 0 }));
// Tracks each band's clip-path write state — 'hidden' (not one of the
// active G.bandCount bands, matches the CSS default), 'moving' (still
// easing toward bandTgt), or 'settled' (close enough that further writes
// would repaint for a sub-pixel, invisible change). See updateBandMotion().
const bandState = bandEls.map(() => 'hidden');
let bandJoltStr = '';

let nextNoiseAt = 0;
let nextJoltAt = performance.now() + 1200;
let joltUntil = 0;

function scheduleNextJolt(now) {
  // frequency 0..1 → average gap ~6000ms..1000ms, jittered ±40%
  const baseGap = 6000 - G.frequency * 5000;
  nextJoltAt = now + baseGap * (0.6 + Math.random() * 0.8);
}

function glitchNoiseStep(jolting) {
  const boost = jolting ? 2.2 : 1;
  const amt = G.intensity * G.distance * boost; // px of max lateral shove
  const jolt = jolting
    ? ` skewX(${(Math.random() - 0.5) * G.skew * G.intensity}deg) rotate(${(Math.random() - 0.5) * G.skew * 0.156 * G.intensity}deg)`
    : '';
  bandJoltStr = jolt;

  bandEls.forEach((el, i) => {
    if (i >= TIER_CLAMP[perfTier].bandCount) {
      bandTgt[i].h = 0;
      return;
    }
    // top/h re-roll toward a fresh random target every step, but only blend
    // toward it by G.intensity instead of jumping straight there.
    bandTgt[i].top += (Math.random() * 96 - bandTgt[i].top) * G.intensity;
    bandTgt[i].h += ((1 + Math.random() * (jolting ? 20 : 6)) * G.bandSize - bandTgt[i].h) * G.intensity;
    bandTgt[i].tx = (Math.random() - 0.5) * 2 * amt;
  });

  chanEls.forEach(el => {
    el.style.opacity = G.intensity * (0.14 + Math.random() * 0.16 * boost);
    el.style.transform = `translate(${(Math.random() - 0.5) * 2 * amt}px, ${(Math.random() - 0.5) * amt * 0.3}px)${jolt}`;
  });
}

// Glides each band's current clip/offset a fraction of the way toward its
// latest random target every rAF frame, instead of the band jumping
// straight there the instant glitchNoiseStep() re-randomizes it.
const BAND_EASE = 0.28;
// The lerp below asymptotically approaches its target forever without ever
// exactly reaching it, so left unchecked it'd rewrite clip-path — which
// forces a repaint, unlike transform — every frame indefinitely. SETTLE_EPS
// lets it stop once the change is too small to see, so steady-state (no
// active jolt) costs zero paint instead of 60 no-op-looking repaints/sec.
const SETTLE_EPS = 0.05;
// clip-path forces a repaint (unlike transform), and noise re-rolls a fresh
// target every 45-100ms — faster than BAND_EASE converges — so without this
// throttle the SETTLE_EPS check above almost never gets a chance to fire and
// every band repaints on every rAF tick (~60/s). Capping the actual
// clip-path write to ~30/s halves that repaint cost; the lerp itself still
// runs every frame so motion stays smooth, and a pending write is never
// dropped, just delayed up to one interval.
let lastClipWriteAt = 0;
function updateBandMotion(now) {
  const doClipWrite = now - lastClipWriteAt >= TIER_CLAMP[perfTier].clipInterval;
  bandEls.forEach((el, i) => {
    if (i >= TIER_CLAMP[perfTier].bandCount) {
      if (bandState[i] !== 'hidden') { el.style.clipPath = 'inset(0 0 100% 0)'; bandState[i] = 'hidden'; }
      return;
    }
    const c = bandCur[i], t = bandTgt[i];
    c.top += (t.top - c.top) * BAND_EASE;
    c.h += (t.h - c.h) * BAND_EASE;
    c.tx += (t.tx - c.tx) * BAND_EASE;
    const settled = Math.abs(t.top - c.top) < SETTLE_EPS && Math.abs(t.h - c.h) < SETTLE_EPS;
    const needsWrite = bandState[i] !== 'settled' || !settled;
    if (needsWrite && doClipWrite) {
      el.style.clipPath = `inset(${c.top}% 0 ${Math.max(0, 100 - c.top - c.h)}% 0)`;
      bandState[i] = settled ? 'settled' : 'moving';
    } else if (!settled) {
      bandState[i] = 'moving';
    }
    // Transform still updates every frame (lateral shove + jolt) — cheap,
    // compositor-only, unlike clip-path. The drift itself now rides on the
    // ancestor .drift-x/.drift-y CSS animation, not this write.
    el.style.transform = `translate(${BAND_PAD_MOD + c.tx}px, ${BAND_PAD_MOD}px)${bandJoltStr}`;
  });
  if (doClipWrite) lastClipWriteAt = now;
}

function stepGlitch(now) {
  if (now >= nextJoltAt && !joltUntil) {
    joltUntil = now + 70 + Math.random() * 90;
  }
  if (joltUntil && now >= joltUntil) {
    joltUntil = 0;
    scheduleNextJolt(now);
    bandJoltStr = '';
  }
  if (now >= nextNoiseAt) {
    glitchNoiseStep(joltUntil > now);
    nextNoiseAt = now + (45 + Math.random() * 55) / G.bandRate;
  }
  updateBandMotion(now);
}

// ── Perf tier ── clamps glitch cost on top of G rather than overwriting it
// (G is already "baked defaults", not user-tunable right now, but this keeps
// the same "ceiling over source-of-truth" shape in case a panel ever comes
// back). 'off' is the actual floor: glitch's JS entirely stops (see
// shouldRun()) and only the zero-JS CSS drift keeps running, so a device
// that's still struggling at 'low' has somewhere further to go.
let perfTier = 'high';
const TIER_CLAMP = {
  high:   { bandCount: G.bandCount,               clipInterval: 1000 / 30 },
  medium: { bandCount: Math.min(G.bandCount, 1),  clipInterval: 1000 / 20 },
  low:    { bandCount: 0,                         clipInterval: 1000 / 12 },
  off:    { bandCount: 0,                         clipInterval: 1000 / 12 }, // unused — loop doesn't run
};

let paused = false;
let rafId = null;
function frame(now) {
  stepGlitch(now);
  rafId = requestAnimationFrame(frame);
}
function shouldRun() { return !paused && perfTier !== 'off'; }
function ensureLoop() { if (rafId === null && shouldRun()) rafId = requestAnimationFrame(frame); }
function stopLoop() { if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; } }
rafId = requestAnimationFrame(frame);

// See BaseIframeLayer.js: display:none stops rendering but not this rAF
// loop's JS, so stop it explicitly when hidden/backgrounded instead of
// wasting CPU on glitch noise nobody sees. Also pauses the CSS drift
// timelines (html.ng-paused rule in style.css) for the same reason.
// ng-perf-tier (from shared/perf-monitor.js, broadcast via BaseIframeLayer)
// only stops the glitch JS itself at the 'off' floor — CSS drift keeps
// running either way, since that's compositor-only and not the actual cost.
addEventListener('message', (e) => {
  if (e.origin !== location.origin) return;
  const d = e.data;
  if (d?.type === 'ng-effect-pause') {
    paused = true;
    stopLoop();
    document.documentElement.classList.add('ng-paused');
  } else if (d?.type === 'ng-effect-resume') {
    paused = false;
    document.documentElement.classList.remove('ng-paused');
    ensureLoop();
  } else if (d?.type === 'ng-perf-tier') {
    perfTier = d.tier;
    if (perfTier === 'off') stopLoop(); else ensureLoop();
  }
});
