/* ── Persistence (mirrors UI/retroFilter & UI/holographic) ── */
const STORAGE_KEY = 'needygirl-tvGlitch-settings';
function loadSaved() {
  try { return JSON.parse(NeedyGirlState.get(STORAGE_KEY)) || {}; }
  catch { return {}; }
}
function saveState() {
  NeedyGirlState.set(STORAGE_KEY, JSON.stringify({ V }));
}
const saved = loadSaved();

// Forwards the current overall-opacity setting up to tvGlitchLayer.js, which
// applies it as CSS opacity on the <iframe> element itself — the actual
// knob controlling how strongly this layer's color-burn blend shows against
// the rest of the composited scene, which this canvas has no way to touch
// from inside its own document (mirrors how UI/stickerList posts its own
// measured rects up to StickerListLayer instead of the parent reaching in).
function sendOverallOpacity(v) {
  parent.postMessage({ type: 'ng-tvglitch-opacity', value: v }, location.origin);
}

/* ── State ── no flash: the reference this is styled after (deep purple/
   indigo/black interlace noise + an organic ink-splash burst) never
   whites-out the whole screen — brightness stays local to the splash's own
   core instead. The dark backdrop is also now painted every frame (see
   frame()/drawBase below), not just while a burst is active, so idle gaps
   between bursts never clear to transparent/white — that clear-to-nothing
   flicker was the actual "strong white flash" being reported. ── */
const V = {
  enabled: true,
  staticMode: false,      // freeze on one unchanging snapshot — no burst cycling, no per-frame shimmer (see armGlitch/frame/drawStaticFrame)
  continuous: true,       // chain bursts back-to-back (tiny random gap) instead of waiting out Avg Interval
  // Strength of the color-burn blend against the whole composited scene
  // behind this effect — a parent-side CSS property (mix-blend-mode's
  // intensity is just its element's opacity), not something this canvas can
  // reach on its own, so changes are forwarded to tvGlitchLayer.js via
  // postMessage (see sendOverallOpacity below) instead of read directly.
  overallOpacity: 1,
  intensity: 0.85,     // 0-1 overall opacity multiplier for every burst element
  interval: 7,          // average seconds idle between bursts — only used while continuous is OFF
  duration: 260,         // average ms a burst lasts (actual length jitters ±35%)
  shardDensity: 14,        // number of glass-crack lines radiating from the impact point (own layer, see drawShards)
  glassInnerHex: '#eef5ff', // glass facet radial-gradient center color (near the impact point)
  glassOuterHex: '#8fb8ff', // glass facet radial-gradient edge color (fades to transparent past this)
  glassOpacity: 0.22,       // facet pane fill opacity multiplier (see drawShards) — kept low by default so it doesn't reintroduce a flash
  splashDensity: 14,       // scales the ink-splash particle branch/drip count radiating from the impact point (own layer, see drawSplash)
  splashSize: 1,           // scales each individual ink particle's radius — NOT how far the spray spreads (see generateSplash)
  splashViscosity: 0.35,   // 0 = runny/spidery (long thin far-reaching tendrils), 1 = thick/clumped (short fat blobs that stay near the core)
  splashIrregularity: 0.6, // 0 = smooth near-straight radiating branches, 1 = chaotic jittery branches/scatter
  flickerRate: 0.5,        // 0 = burst intensity stays nearly steady, 1 = rapid/extremely frequent flicker (see stepFlicker)
  accentHex: '#e83fd1',
  baseHex: '#0c0620',       // deep indigo/black backdrop tint painted behind everything
  baseOpacity: 0.85,
  idleFloor: 0.3,           // backdrop level idle gaps decay toward instead of 0, so it never fully disappears (see stepBaseLevel)
  ...(saved.V || {}),
};

function rand(min, max) { return min + Math.random() * (max - min); }
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
// Blends two rgb triples — used so the glass facet tint and the ink's dark
// tone are derived from the user's Accent/Base color pickers (see
// drawShards/drawSplash) instead of being hardcoded, so both effects stay
// color-consistent whichever accent/base the user picks.
function mixRgb(a, b, t) {
  return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
}

// Dark indigo/violet/near-black bands for the scanline texture's base tone —
// fixed rather than derived from the user's accent color so the field reads
// as a consistent "damaged signal" backdrop regardless of what accent hue
// is picked.
const DARK_PALETTE = ['#150a2e', '#1c0f3d', '#0d0620', '#241145', '#0a0618'];
const CYAN_HEX = '#7dfaff';

/* ── Slider builder (mirrors reference/skeleton/script.js) ── */
function makeSlider({ id, label, min, max, step, def, key, fmt, regenOnStatic }) {
  const ct = document.getElementById(id);
  const top = document.createElement('div'); top.className = 'sg-top';
  const lbl = document.createElement('span'); lbl.className = 'sg-label'; lbl.textContent = label;
  const val = document.createElement('span'); val.className = 'sg-val'; val.textContent = fmt ? fmt(def) : def;
  top.appendChild(lbl); top.appendChild(val);
  const tr = document.createElement('div'); tr.className = 'sg-track';
  const sl = document.createElement('input'); sl.type = 'range';
  sl.min = min; sl.max = max; sl.step = step; sl.value = def;
  tr.appendChild(sl);
  ct.appendChild(top); ct.appendChild(tr);
  sl.addEventListener('input', () => {
    const v = parseFloat(sl.value);
    V[key] = v;
    val.textContent = fmt ? fmt(v) : v;
    saveState();
    if (key === 'interval') armGlitch(); // re-roll the pending wait against the new average (no-op while continuous)
    if (key === 'overallOpacity') sendOverallOpacity(v);
    // Static mode freezes on one pre-generated snapshot (see frame()), so
    // sliders that only affect GENERATION (density/size/viscosity/
    // irregularity — geometry baked once, not re-read every draw call)
    // would otherwise have no visible effect until the user hits "Trigger
    // Now" — unlike color/opacity/intensity sliders, which ARE read live
    // every frame and already update instantly. regenOnStatic names which
    // single layer to rebake ('shards' or 'splash') so only that layer's
    // geometry changes — NOT a full triggerBurst(), which would also
    // re-roll the impact point and regenerate the OTHER layer as a
    // confusing side effect (e.g. an ink slider visibly reshuffling glass).
    if (V.staticMode) {
      if (regenOnStatic === 'shards') regenShardsInPlace();
      else if (regenOnStatic === 'splash') regenSplashInPlace();
    }
  });
  return sl;
}

const sliderRefs = {
  overallOpacity: makeSlider({ id: 'sg-overall-opacity', label: 'Overall Opacity', min: 0, max: 1, step: 0.01, def: V.overallOpacity, key: 'overallOpacity', fmt: v => `${Math.round(parseFloat(v) * 100)}%` }),
  intensity: makeSlider({ id: 'sg-intensity', label: 'Intensity', min: 0, max: 1, step: 0.01, def: V.intensity, key: 'intensity' }),
  flickerRate: makeSlider({ id: 'sg-flicker-rate', label: 'Flicker Rate', min: 0, max: 1, step: 0.01, def: V.flickerRate, key: 'flickerRate' }),
  interval: makeSlider({ id: 'sg-interval', label: 'Avg Interval', min: 1.5, max: 30, step: 0.5, def: V.interval, key: 'interval', fmt: v => `${parseFloat(v).toFixed(1)}s` }),
  duration: makeSlider({ id: 'sg-duration', label: 'Burst Length', min: 80, max: 900, step: 10, def: V.duration, key: 'duration', fmt: v => `${v}ms` }),
  shardDensity: makeSlider({ id: 'sg-shards', label: 'Shard Density', min: 4, max: 28, step: 1, def: V.shardDensity, key: 'shardDensity', regenOnStatic: 'shards' }),
  glassOpacity: makeSlider({ id: 'sg-glass-opacity', label: 'Glass Opacity', min: 0, max: 1, step: 0.01, def: V.glassOpacity, key: 'glassOpacity' }),
  splashDensity: makeSlider({ id: 'sg-splash', label: 'Splash Density', min: 4, max: 28, step: 1, def: V.splashDensity, key: 'splashDensity', regenOnStatic: 'splash' }),
  splashSize: makeSlider({ id: 'sg-splash-size', label: 'Particle Size', min: 0.2, max: 3, step: 0.05, def: V.splashSize, key: 'splashSize', fmt: v => `${parseFloat(v).toFixed(2)}x`, regenOnStatic: 'splash' }),
  splashViscosity: makeSlider({ id: 'sg-splash-viscosity', label: 'Viscosity', min: 0, max: 1, step: 0.01, def: V.splashViscosity, key: 'splashViscosity', regenOnStatic: 'splash' }),
  splashIrregularity: makeSlider({ id: 'sg-splash-irregularity', label: 'Irregularity', min: 0, max: 1, step: 0.01, def: V.splashIrregularity, key: 'splashIrregularity', regenOnStatic: 'splash' }),
  baseOpacity: makeSlider({ id: 'sg-base-opacity', label: 'Base Opacity', min: 0, max: 1, step: 0.01, def: V.baseOpacity, key: 'baseOpacity' }),
  idleFloor: makeSlider({ id: 'sg-idle-floor', label: 'Idle Floor', min: 0, max: 1, step: 0.01, def: V.idleFloor, key: 'idleFloor' }),
};

// Sync a restored (localStorage) overallOpacity value up to the parent right
// away — otherwise the iframe's CSS opacity would sit at its default (1)
// until the user actually touches the slider again.
sendOverallOpacity(V.overallOpacity);

/* ── Accent / glass / base color ── */
const accentInp = document.getElementById('accent-color');
accentInp.value = V.accentHex;
accentInp.addEventListener('input', e => { V.accentHex = e.target.value; saveState(); });

const glassInnerInp = document.getElementById('glass-inner-color');
glassInnerInp.value = V.glassInnerHex;
glassInnerInp.addEventListener('input', e => { V.glassInnerHex = e.target.value; saveState(); });

const glassOuterInp = document.getElementById('glass-outer-color');
glassOuterInp.value = V.glassOuterHex;
glassOuterInp.addEventListener('input', e => { V.glassOuterHex = e.target.value; saveState(); });

const baseColorInp = document.getElementById('base-color');
baseColorInp.value = V.baseHex;
baseColorInp.addEventListener('input', e => { V.baseHex = e.target.value; saveState(); });

/* ── Enabled toggle ── turning this off stops scheduling new bursts and
   clears whatever's mid-flight, so the canvas goes fully inert instead of
   just dimming. ── */
const enabledBtn = document.getElementById('enabled-btn');
enabledBtn.classList.toggle('on', V.enabled);
enabledBtn.onclick = () => {
  V.enabled = !V.enabled;
  enabledBtn.classList.toggle('on', V.enabled);
  saveState();
  if (V.enabled) armGlitch();
  else { clearTimeout(scheduleTimer); glitch.active = false; }
};

/* ── Continuous toggle ── ON (the default): as soon as one burst ends the
   next one fires almost immediately (tiny random gap, see armGlitch/frame
   below), so the screen stays in a near-constant glitching state instead of
   only popping every V.interval seconds. OFF falls back to the original
   wall-clock-scheduled random-interval behaviour. ── */
const continuousBtn = document.getElementById('continuous-btn');
continuousBtn.classList.toggle('on', V.continuous);
continuousBtn.onclick = () => {
  V.continuous = !V.continuous;
  continuousBtn.classList.toggle('on', V.continuous);
  saveState();
  armGlitch();
};

/* ── Static toggle ── freezes on one unchanging snapshot instead of
   cycling bursts: no scheduling (armGlitch becomes a no-op while this is
   on, see below), and every per-frame "shimmer" random roll inside
   drawScanNoise/drawShards/drawSplash is short-circuited to a fixed value
   so the exact same pixels are redrawn every frame — a real freeze, not
   just a very slow animation. Turning it back off hands control back to
   armGlitch(). ── */
const staticBtn = document.getElementById('static-btn');
staticBtn.classList.toggle('on', V.staticMode);
staticBtn.onclick = () => {
  V.staticMode = !V.staticMode;
  staticBtn.classList.toggle('on', V.staticMode);
  saveState();
  clearTimeout(scheduleTimer);
  if (V.staticMode) triggerBurst(); // bake a fresh frozen snapshot right away
  else armGlitch();
};

/* ── Resize ── */
const canvas = document.getElementById('gl');
const ctx = canvas.getContext('2d');
let scaleFactor = 1;
function resize() {
  scaleFactor = window.getPerfResolutionCap ? window.getPerfResolutionCap() : Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(innerWidth * scaleFactor);
  canvas.height = Math.floor(innerHeight * scaleFactor);
}
addEventListener('resize', resize); resize();

/* ── Shard geometry ── the glass-crack layer, kept independent from the ink
   splash below (own density control, own generator, own draw pass) rather
   than merged into one shape — two distinct things visually shattering at
   the same impact point: cracked glass UNDER a separate ink splatter.
   Besides the crack polylines, this also builds `facets`: filled
   wedge-shaped polygons between each pair of adjacent radiating cracks —
   without a filled "pane" the shards only ever read as a wireframe of
   lines, never as actual broken glass (see drawShards). ── */
function generateShards(cx, cy, count, maxR) {
  const lines = [];
  const angleStep = (Math.PI * 2) / count;
  for (let i = 0; i < count; i++) {
    let angle = i * angleStep + rand(-angleStep * 0.35, angleStep * 0.35);
    let x = cx, y = cy;
    let len = rand(maxR * 0.16, maxR * 0.3);
    const segs = Math.round(rand(3, 6));
    const pts = [{ x, y }];
    for (let s = 0; s < segs; s++) {
      angle += rand(-0.4, 0.4);
      x += Math.cos(angle) * len;
      y += Math.sin(angle) * len;
      pts.push({ x, y });
      len *= rand(0.66, 0.88);
    }
    lines.push(pts);
  }
  // A couple of jagged concentric rings layered on top give the classic
  // spiderweb-fracture look instead of just spokes radiating outward.
  const rings = [];
  const ringCount = Math.max(1, Math.round(count / 6));
  for (let r = 0; r < ringCount; r++) {
    const radius = maxR * rand(0.22, 0.5) * ((r + 1) / ringCount);
    const steps = 20;
    const pts = [];
    for (let s = 0; s <= steps; s++) {
      const a = (s / steps) * Math.PI * 2;
      const jr = radius * (1 + rand(-0.09, 0.09));
      pts.push({ x: cx + Math.cos(a) * jr, y: cy + Math.sin(a) * jr });
    }
    rings.push(pts);
  }

  // Facets: wedge polygons between each pair of adjacent radiating lines,
  // banded by matching point index (i.e. matching radius step) on each
  // line, so a facet is bounded by two real crack segments rather than an
  // arbitrary triangle — reads as an actual broken pane of glass sitting
  // between two fissures. Random gaps (missing facets) keep it irregular
  // instead of a fully tiled fan.
  const facets = [];
  for (let i = 0; i < count; i++) {
    const a = lines[i];
    const b = lines[(i + 1) % count];
    const bands = Math.min(a.length, b.length) - 1;
    for (let k = 0; k < bands; k++) {
      if (Math.random() < 0.22) continue;
      facets.push({ pts: [a[k], a[k + 1], b[k + 1], b[k]], depth: bands <= 1 ? 0 : k / (bands - 1) });
    }
  }

  return { lines, rings, facets };
}

/* ── Splash geometry ── generated once per triggered burst (not
   regenerated every frame) so the splash's shape holds still like an actual
   ink/paint splatter while everything drawn ON it (per-particle flicker)
   keeps churning — see drawSplash() below. Layered ON TOP OF (not instead
   of) the glass-crack shards above.

   The splash body is now a `particles` field instead of a handful of
   polygon/blob shapes: many tiny dots deposited along several branching
   random walks from the impact point (each step drops a small jittered
   cluster, and branches occasionally fork), which is a cheap
   pre-generated stand-in for a diffusion-limited-aggregation growth — the
   same trick behind "petri dish" ink-spatter demos. That reads as an
   actual random spray of ink rather than a smooth geometric shape. Each
   particle also records `t` (0 = at the impact core, 1 = at the furthest
   reach of the cluster) so drawSplash can fade it from bright/near-white
   at the core to the accent hue at the fringes, instead of one flat color.
   Drips (thin tapering flung streaks) are kept separate for the longer
   radiating spikes the particle cluster alone doesn't reach.

   Three of V's sliders steer the branch generator directly:
   - splashSize scales each individual particle dot's RADIUS only — it does
     not touch how far the cluster spreads (that's fixed to the burst's
     maxR). Turning it up makes the same spray pattern out of bigger dots,
     not a bigger spray.
   - splashViscosity (0 runny → 1 thick) shortens the steps/branch count and
     fattens+densifies each deposit while suppressing forking — thick ink
     stays clumped near the core instead of spidering outward.
   - splashIrregularity (0 smooth → 1 chaotic) widens the per-step angle
     jitter and the cluster scatter radius — low values keep branches close
     to straight radiating spokes, high values make them jagged/scattered. ── */
function generateSplash(cx, cy, density, maxR) {
  const reach = maxR; // cluster spread — no longer tied to splashSize, see above
  const visc = clamp01(V.splashViscosity);
  const irregular = clamp01(V.splashIrregularity);
  const angleJitter = 0.12 + irregular * 0.85;
  const scatterMul = 0.5 + irregular * 1.6;

  const particles = [];
  const branchCount = Math.max(4, Math.min(10, Math.round(density * 0.5)));
  function growBranch(x, y, angle, depth) {
    let stepLen = rand(reach * (0.03 - visc * 0.02), reach * (0.045 - visc * 0.025));
    const maxSteps = Math.max(4, Math.round(rand(9, 16) * (1 - visc * 0.45)));
    for (let s = 0; s < maxSteps; s++) {
      angle += rand(-angleJitter, angleJitter);
      x += Math.cos(angle) * stepLen;
      y += Math.sin(angle) * stepLen;
      const clusterN = Math.round(rand(2, 4) * (1 + visc * 0.7));
      for (let c = 0; c < clusterN; c++) {
        const jr = rand(0, stepLen * scatterMul);
        const ja = rand(0, Math.PI * 2);
        const px = x + Math.cos(ja) * jr, py = y + Math.sin(ja) * jr;
        const r = rand(0.5, 2.2) * V.splashSize * (1 + visc * 2.2) * (1 - depth * 0.25);
        particles.push({ x: px, y: py, r, dist: Math.hypot(px - cx, py - cy) });
      }
      if (depth < 1 && Math.random() < 0.18 * (1 - visc * 0.75) && s > 3) {
        growBranch(x, y, angle + rand(-1.3, 1.3), depth + 1);
      }
      stepLen *= rand(0.93, 1.03);
    }
  }
  for (let b = 0; b < branchCount; b++) growBranch(cx, cy, rand(0, Math.PI * 2), 0);
  const maxDist = particles.reduce((m, p) => Math.max(m, p.dist), 1);
  particles.forEach(p => { p.t = clamp01(p.dist / maxDist); });

  // Drips: tapering curves flung outward from the impact point, pre-sampled
  // into points so the stroke can be drawn as a chain of shrinking segments
  // (thick root → thin tip) rather than one fixed-width stroke. Reach and
  // bend/wobble come from irregularity, thickness from viscosity (thick ink
  // flings fatter streaks) — unaffected by splashSize, which is
  // particle-radius-only (see above).
  const dripCount = Math.max(9, Math.round(density * 1.3));
  const drips = [];
  for (let i = 0; i < dripCount; i++) {
    const angle = rand(0, Math.PI * 2);
    const len = rand(reach * 0.22, reach * 0.9);
    const bend = angle + rand(-0.25, 0.25) * (0.6 + irregular);
    const ctrlX = cx + Math.cos(bend) * len * 0.5;
    const ctrlY = cy + Math.sin(bend) * len * 0.5;
    const endX = cx + Math.cos(angle) * len;
    const endY = cy + Math.sin(angle) * len;
    const steps = 9;
    const pts = [];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps, mt = 1 - t;
      pts.push({ x: mt * mt * cx + 2 * mt * t * ctrlX + t * t * endX, y: mt * mt * cy + 2 * mt * t * ctrlY + t * t * endY });
    }
    // Roughly a third are thin spiky capillary strays rather than full-body
    // drips — matches the reference's fine radiating spatter needles.
    const spiky = Math.random() < 0.35;
    const widthMul = 1 + visc * 1.4;
    drips.push({ pts, baseWidth: (spiky ? rand(0.6, 1.2) : rand(1.6, 3.6)) * widthMul });
  }

  return { particles, drips };
}

/* ── Burst state ── */
const glitch = { active: false, start: 0, duration: 0, power: 1, ex: 0, ey: 0, shards: null, splash: null };

function triggerBurst() {
  glitch.active = true;
  glitch.start = performance.now();
  glitch.duration = rand(V.duration * 0.65, V.duration * 1.35);
  glitch.power = rand(0.45, 1); // "隨機觸發強度" — every burst hits with a different violence
  // Biased toward the frame's inner ~70% rather than the very edges, so the
  // impact point (and the shard/splash clusters around it) usually lands
  // somewhere actually visible.
  glitch.ex = innerWidth * rand(0.15, 0.85) * scaleFactor;
  glitch.ey = innerHeight * rand(0.15, 0.85) * scaleFactor;
  const maxR = Math.hypot(canvas.width, canvas.height) * 0.55;
  glitch.shards = generateShards(glitch.ex, glitch.ey, Math.round(V.shardDensity), maxR);
  glitch.splash = generateSplash(glitch.ex, glitch.ey, Math.round(V.splashDensity), maxR);
  frozenNoiseCols = null; // force drawScanNoise to bake a fresh frozen pattern for this burst (only matters in static mode)
}

// Targeted regeneration for static mode's per-slider live preview (see
// makeSlider's regenOnStatic). Re-rolling via a full triggerBurst() would
// also pick a brand new random impact point and regenerate the OTHER
// layer too — e.g. dragging a Splash slider would visibly reshuffle the
// glass shards as a side effect, which reads as "the glass changed" even
// though only ink settings were touched. These reuse the current
// glitch.ex/ey and only touch their own layer.
function regenShardsInPlace() {
  if (!glitch.active) return; // frame() will run a full triggerBurst() on the next tick anyway
  const maxR = Math.hypot(canvas.width, canvas.height) * 0.55;
  glitch.shards = generateShards(glitch.ex, glitch.ey, Math.round(V.shardDensity), maxR);
}
function regenSplashInPlace() {
  if (!glitch.active) return;
  const maxR = Math.hypot(canvas.width, canvas.height) * 0.55;
  glitch.splash = generateSplash(glitch.ex, glitch.ey, Math.round(V.splashDensity), maxR);
}

/* ── Scheduling ── wall-clock timer independent of the draw loop.
   Two modes:
   - continuous (default): no wait between bursts at all — frame() below
     chains straight into the next triggerBurst() (via a tiny 0-120ms gap)
     the moment one ends, so this function only needs to throw the very
     first burst.
   - non-continuous: jittered ±50% around V.interval so bursts never fall
     into a predictable beat, same as the original design. ── */
let scheduleTimer = null;
function armGlitch() {
  clearTimeout(scheduleTimer);
  if (!V.enabled) { glitch.active = false; return; }
  if (V.staticMode) return; // static mode owns its own snapshot lifecycle (see static-btn handler / frame())
  if (V.continuous) {
    if (!glitch.active) triggerBurst();
    return;
  }
  const delay = rand(V.interval * 0.5, V.interval * 1.5) * 1000;
  scheduleTimer = setTimeout(() => { triggerBurst(); armGlitch(); }, delay);
}

document.getElementById('trigger-btn').onclick = () => triggerBurst();

/* ── Drawing ── */

// Dense edge-to-edge vertical interlace/scanline field — mostly dark
// indigo/violet/near-black bands with only occasional bright cyan/accent/
// pale highlight columns, matching the reference's "damaged signal" texture
// (a packed field of tone, not sparse floating bars). Normally re-rolled
// from scratch every single call (that's what makes it read as live TV
// static); in static mode the exact same column layout must survive every
// frame, so buildNoiseCol()'s output gets cached in `frozenNoiseCols`
// instead of being regenerated (see drawScanNoise / triggerBurst, which
// invalidates the cache on every new snapshot).
// col is mutated in place (reused across frames, see ensureNoiseCols) instead
// of returning a fresh object — this runs on every column every frame
// (hundreds of them), so avoiding per-column allocation matters. ar/ag/ab
// (accent color, already split out of the hex string) are passed in rather
// than re-parsed here — hexToRgb only needs to run once per frame, not once
// per column.
function fillNoiseCol(col, i, colW, ar, ag, ab) {
  const roll = Math.random();
  let color, aFactor;
  if (roll < 0.55) { // dark base texture band
    color = DARK_PALETTE[Math.floor(Math.random() * DARK_PALETTE.length)];
    aFactor = rand(0.35, 0.7);
  } else if (roll < 0.82) { // desaturated accent band
    color = `rgb(${Math.round(ar * 0.55)},${Math.round(ag * 0.55)},${Math.round(ab * 0.55)})`;
    aFactor = rand(0.4, 0.8);
  } else if (roll < 0.94) { // bright cyan highlight line
    color = CYAN_HEX;
    aFactor = rand(0.5, 0.95);
  } else { // rare bright accent sparkle line
    color = `rgb(${ar},${ag},${ab})`;
    aFactor = rand(0.6, 1);
  }
  const full = Math.random() < 0.75;
  const h = full ? canvas.height : canvas.height * rand(0.15, 0.6);
  const y = full ? 0 : Math.random() * (canvas.height - h);
  const w = Math.max(1, colW * rand(0.4, 1)); // leave gaps between columns for texture, not a solid block
  col.x = i * colW; col.y = y; col.w = w; col.h = h;
  col.color = color; col.aFactor = aFactor;
}

function makeNoiseCol() { return { x: 0, y: 0, w: 0, h: 0, color: '', aFactor: 0 }; }

let noiseCols = []; // persistent, reused buffer for the non-static (live) path
function ensureNoiseCols(cols) {
  if (noiseCols.length !== cols) {
    noiseCols = new Array(cols);
    for (let i = 0; i < cols; i++) noiseCols[i] = makeNoiseCol();
  }
  return noiseCols;
}

let frozenNoiseCols = null;
function drawScanNoise(alpha) {
  ctx.save();
  const cols = Math.max(60, Math.round(canvas.width / (5.5 * scaleFactor)));
  const colW = canvas.width / cols;
  const [ar, ag, ab] = hexToRgb(V.accentHex); // parsed once per frame, not once per column
  let list;
  if (V.staticMode) {
    if (!frozenNoiseCols || frozenNoiseCols.length !== cols) {
      frozenNoiseCols = [];
      for (let i = 0; i < cols; i++) {
        const col = makeNoiseCol();
        fillNoiseCol(col, i, colW, ar, ag, ab);
        frozenNoiseCols.push(col);
      }
    }
    list = frozenNoiseCols;
  } else {
    list = ensureNoiseCols(cols);
    for (let i = 0; i < cols; i++) fillNoiseCol(list[i], i, colW, ar, ag, ab);
  }
  for (let i = 0; i < list.length; i++) {
    const col = list[i];
    ctx.fillStyle = col.color;
    ctx.globalAlpha = clamp01(alpha * col.aFactor);
    ctx.fillRect(col.x, col.y, col.w, col.h);
  }
  ctx.restore();
}

// No shadowBlur here (dropped along with drawScanNoise's glow columns) —
// ctx.shadowBlur is one of Canvas2D's most expensive primitives, and once
// this whole canvas gets cross-page composited via mix-blend-mode
// (tvGlitchLayer.js), that cost is paid again on every pixel it touches
// across the full viewport every frame, not just once locally. The
// chromatic-aberration fringe lines still read fine from color/offset alone
// without the soft halo.
function strokePoly(pts, color, width, alpha) {
  if (alpha <= 0.005) return;
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.globalAlpha = alpha;
  ctx.stroke();
}

// Glass-crack layer — independent from the ink splash (own geometry, own
// density slider). Two passes now instead of one: filled facet PANES first
// (a radial gradient centered on the impact point + a thin specular rim on
// their impact-facing edge, simulating a lit/reflective broken pane), then
// the crack lines on top as a chromatic-aberration fringe (cyan + accent,
// nudged sideways) around a WHITE center line. Facets are what actually
// reads as "glass" — the crack lines alone are just a wireframe.
//
// The facet fill is ONE shared radial gradient (glassInnerHex at the
// impact point fading out to glassOuterHex, user-set colors, not derived
// from Accent) rather than a separate small gradient per facet — that's
// what makes the whole shatter read as one coherent "光從裂點放射出去"
// radiating gradient instead of each shard glinting its own random color.
// Facet fill alpha is scaled by V.glassOpacity ("Glass Opacity" slider,
// default 0.22 — low, so it reads as translucent glass rather than a
// bright flash) so the user can dial the shard panes anywhere from barely
// visible up to fully opaque.
// The facet radial gradient only actually changes when the impact point, the
// canvas size, or the glass colors change — none of which happen mid-frame
// during a burst — so it's keyed and cached on `glitch` instead of being
// rebuilt with createRadialGradient/addColorStop on every single draw call
// (creating a gradient is relatively expensive, and this used to run once
// per frame for the whole duration of every burst).
function getGlassGradient() {
  const key = `${glitch.ex},${glitch.ey},${canvas.width},${canvas.height},${V.glassInnerHex},${V.glassOuterHex}`;
  if (glitch._glassGradKey !== key) {
    const [gir, gig, gib] = hexToRgb(V.glassInnerHex);
    const [gor, gog, gob] = hexToRgb(V.glassOuterHex);
    const glassR = Math.hypot(canvas.width, canvas.height) * 0.55;
    const grad = ctx.createRadialGradient(glitch.ex, glitch.ey, 0, glitch.ex, glitch.ey, glassR);
    grad.addColorStop(0, `rgba(${gir},${gig},${gib},1)`);
    grad.addColorStop(1, `rgba(${gor},${gog},${gob},0)`);
    glitch._glassGrad = grad;
    glitch._glassGradKey = key;
  }
  return glitch._glassGrad;
}

function drawShards(alpha) {
  const { lines, rings, facets } = glitch.shards;
  const [ar, ag, ab] = hexToRgb(V.accentHex);
  const [gir, gig, gib] = hexToRgb(V.glassInnerHex);
  const glassRim = mixRgb([255, 255, 255], [gir, gig, gib], 0.15);
  const offset = 2.4 * scaleFactor * glitch.power;

  const glassGrad = getGlassGradient();

  ctx.save();

  // Facet panes. flick/rim are frozen to a fixed value in static mode so
  // the exact same pixels are redrawn every frame instead of shimmering.
  ctx.lineJoin = 'round';
  facets.forEach(f => {
    const flick = V.staticMode ? 0.85 : 0.5 + Math.random() * 0.5;
    const a = clamp01(alpha * flick * (1 - f.depth * 0.55));
    if (a <= 0.01) return;
    const pts = f.pts;
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = glassGrad;
    ctx.globalAlpha = clamp01(a * V.glassOpacity);
    ctx.fill();
    // Thin specular rim on one edge only (not the whole outline) — a full
    // outline reads as a sticker border, one lit edge reads as a reflective
    // glass facet catching light.
    if (V.staticMode || Math.random() < 0.5) {
      strokePoly([pts[0], pts[1]], `rgba(${glassRim[0]},${glassRim[1]},${glassRim[2]},${a * 0.55})`, 1 * scaleFactor, a * 0.55);
    }
  });

  // Crack lines (fissures) on top of the panes — the cyan/accent copies on
  // either side stay as a chromatic-aberration fringe, but the main center
  // line is white (a bright fissure catching light) instead of the black
  // "shadowed crack" it used to be.
  ctx.lineCap = 'round';
  [...lines, ...rings].forEach(pts => {
    const flick = V.staticMode ? 0.9 : 0.6 + Math.random() * 0.4; // per-line per-frame shimmer, geometry itself stays fixed
    const a = clamp01(alpha * flick);
    ctx.save(); ctx.translate(-offset, 0);
    strokePoly(pts, `rgba(125,250,255,${a * 0.6})`, 1.3 * scaleFactor, a * 0.6);
    ctx.restore();
    ctx.save(); ctx.translate(offset, 0);
    strokePoly(pts, `rgba(${ar},${ag},${ab},${a * 0.7})`, 1.5 * scaleFactor, a * 0.7);
    ctx.restore();
    strokePoly(pts, `rgba(255,255,255,${a})`, 1.4 * scaleFactor, a);
  });

  ctx.restore();
}

// Ink-splash layer — separate from the glass-crack layer above (own
// geometry, own density slider).
//
// The particle field is colored bright/near-white near the impact core
// fading to the Accent hue at the fringes (mixRgb, driven by `p.t` from
// generateSplash) instead of a flat fill — that's what reads as a
// glowing spatter of ink rather than a solid-colored shape, and it stays
// adaptive to whatever accent the user picks. The core blot / drips are
// kept dark, but "dark" is now a near-black shade mixed from the Base
// color (mixRgb toward black) instead of a hardcoded universal near-black
// — still dark enough to avoid reintroducing a flash, but tied to the
// user's palette instead of being fixed.
// Same caching trick as getGlassGradient(): the core's color stops are baked
// at full strength (1 / 0.65 / 0) and the actual per-frame alpha is applied
// via ctx.globalAlpha at draw time instead of being baked into the stops —
// that's what makes the gradient itself constant for the whole burst (same
// ex/ey/color/radius) and therefore cacheable, instead of needing a fresh
// createRadialGradient every single frame just because alpha flickers.
function getInkGradient(inkStr, r) {
  const key = `${glitch.ex},${glitch.ey},${inkStr},${r}`;
  if (glitch._inkGradKey !== key) {
    const g = ctx.createRadialGradient(glitch.ex, glitch.ey, 0, glitch.ex, glitch.ey, r);
    g.addColorStop(0, `rgba(${inkStr},1)`);
    g.addColorStop(0.55, `rgba(${inkStr},0.65)`);
    g.addColorStop(1, `rgba(${inkStr},0)`);
    glitch._inkGrad = g;
    glitch._inkGradKey = key;
  }
  return glitch._inkGrad;
}

function drawSplash(alpha) {
  const { particles, drips } = glitch.splash;
  const [ar, ag, ab] = hexToRgb(V.accentHex);
  const [br, bg, bb] = hexToRgb(V.baseHex);
  const inkRgb = mixRgb([br, bg, bb], [0, 0, 0], 0.82);
  const inkStr = `${inkRgb[0]},${inkRgb[1]},${inkRgb[2]}`;

  ctx.save();

  // Particle field — many tiny dots (see generateSplash's branching
  // random-walk generator) instead of blob/polygon shapes, so the splash
  // reads as an actual random spray rather than a smooth geometric fill.
  // Only a shifting subset is drawn each frame for a still-settling
  // shimmer, same trick as the scanline/shard flicker elsewhere — except in
  // static mode, where every particle is drawn every frame at a fixed
  // alpha so nothing appears/disappears between frames.
  particles.forEach(p => {
    if (!V.staticMode && Math.random() < 0.35) return;
    const flick = V.staticMode ? 1 : rand(0.4, 1);
    const a = clamp01(alpha * flick * (1 - p.t * 0.3));
    if (a <= 0.02) return;
    const rgb = mixRgb([255, 255, 255], [ar, ag, ab], Math.min(1, p.t * 1.3));
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * scaleFactor, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
    ctx.fill();
  });

  // Dark ink core at the impact point instead of a bright white/cream
  // bloom.
  const coreA = clamp01(alpha * 1.05);
  if (coreA > 0.02) {
    const r = 40 * scaleFactor * glitch.power;
    ctx.fillStyle = getInkGradient(inkStr, r);
    ctx.globalAlpha = coreA;
    ctx.beginPath(); ctx.arc(glitch.ex, glitch.ey, r, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Drips: pre-sampled curves flung outward from the core, drawn as a chain
  // of shrinking segments (thick root → near-zero tip) instead of one
  // fixed-width stroke — that taper is what reads as flung ink rather than
  // a drawn line.
  ctx.lineCap = 'round';
  drips.forEach(d => {
    const flick = V.staticMode ? 0.85 : 0.5 + Math.random() * 0.5;
    const a = clamp01(alpha * flick);
    if (a <= 0.01) return;
    ctx.strokeStyle = `rgba(${inkStr},${a})`;
    const segs = d.pts.length - 1;
    for (let i = 0; i < segs; i++) {
      const t = i / segs;
      ctx.lineWidth = Math.max(0.4, d.baseWidth * (1 - t) * scaleFactor);
      ctx.beginPath();
      ctx.moveTo(d.pts[i].x, d.pts[i].y);
      ctx.lineTo(d.pts[i + 1].x, d.pts[i + 1].y);
      ctx.stroke();
    }
  });

  ctx.restore();
}

function drawBase(baseAlpha) {
  if (V.baseOpacity <= 0.005 || baseAlpha <= 0.005) return;
  ctx.save();
  ctx.fillStyle = V.baseHex;
  ctx.globalAlpha = clamp01(V.baseOpacity * baseAlpha);
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

// Backdrop level — eased every frame (see frame() below) instead of being
// gated to "only while a burst is active". Previously drawBase() only ran
// inside drawBurst(), so the instant a burst ended the canvas cut straight
// to fully transparent until the next one fired; standalone that shows
// through as the page's white background, and even composited it's a hard
// single-frame cut to nothing. That instant on/off — not any single bright
// color — was the "strong white flash" being reported, and it repeats
// every burst cycle in continuous mode (multiple times a second).
//
// The fix is a fast-attack/slow-decay ease: with a slow decay (~0.4s to
// fade to the floor below), continuous mode's rapid chaining (0–120ms
// gaps) never lets the level fully decay before the next burst ramps it
// back up, so it reads as one sustained glitch instead of a strobe.
//
// V.idleFloor ("Idle Floor" slider) is the level idle gaps decay TOWARD
// rather than decaying all the way to 0 — per user feedback, easing down
// to literal 0 still read as "the whole thing suddenly goes transparent"
// once it got there, even smoothed. Default 0.3 keeps a dim resting tint
// always present so nothing ever fully vanishes; set it to 0 to go back to
// fully invisible between bursts.
let baseLevel = 0;
function stepBaseLevel(target) {
  baseLevel += (target - baseLevel) * (target > baseLevel ? 0.5 : 0.06);
  return baseLevel;
}

// Smooth flicker — replaces the old per-frame binary strobe (full alpha vs
// 25%, re-rolled every single frame) that was flashing On/OFF up to a dozen
// times within one ~260ms burst. This eases toward a new random target each
// frame instead of snapping, so intensity wavers rather than strobes.
//
// V.flickerRate (0–1, "Flicker Rate" slider) drives both how fast the ease
// chases its target (higher = snappier, more frequent-looking changes) and
// how low the target is allowed to dip (higher = deeper dips, more
// noticeable). At 0 the ease is slow and the target stays in [0.95,1] —
// intensity barely wavers ("幾乎不閃"). At 1 the ease nearly snaps every
// frame and the target can dip to 0.4 — reads as rapid, aggressive
// flickering ("極為頻繁").
let flickerCurrent = 1, flickerTarget = 1;
function stepFlicker() {
  const rate = clamp01(V.flickerRate);
  const ease = 0.06 + rate * 0.55;
  flickerCurrent += (flickerTarget - flickerCurrent) * ease;
  if (Math.abs(flickerTarget - flickerCurrent) < 0.03) flickerTarget = rand(0.95 - rate * 0.55, 1);
  return flickerCurrent;
}

function drawBurst(t) {
  const envelope = Math.pow(1 - t, 0.55); // fast attack, tapering decay
  const alpha = V.intensity * glitch.power * envelope * stepFlicker();

  // The backdrop tint stays near full strength for the whole burst (only a
  // light taper right at the very end) instead of scaling with the same
  // envelope/power/flicker as the noise field and splash — diluting it by
  // those made the "deep dark" backdrop read as a pale wash instead of the
  // consistently dark tone the reference image has. This is the one layer
  // that's meant to hold steady while everything drawn ON TOP of it flickers.
  drawBase(stepBaseLevel(clamp01(0.55 + envelope * 0.45)));
  drawScanNoise(alpha);
  drawShards(alpha);
  drawSplash(alpha);
}

// Static-mode frame — no envelope/timing, no per-frame reroll of anything
// that draw* already guards with V.staticMode, so this paints the exact
// same pixels every call. glitch.power/shards/splash were all baked once
// by the triggerBurst() that turned static mode on (or by the last
// "Trigger Now" click), not regenerated here.
function drawStaticFrame() {
  const alpha = V.intensity * glitch.power;
  drawBase(1);
  drawScanNoise(alpha);
  drawShards(alpha);
  drawSplash(alpha);
}

/* ── Render loop ── */
let rafId = null;
// Cap actual drawing to ~20fps regardless of display refresh rate (mirrors
// UI/holographic/script.js's 30fps cap, tuned down further here) — rAF still
// fires every vsync so timing (glitch duration, scheduling) stays accurate,
// but the expensive part (noise field rebuild + shard/splash redraw) only
// runs every 3rd tick on a 60Hz screen, or every 6th on 120Hz+. This canvas
// is also cross-page composited via mix-blend-mode (see tvGlitchLayer.js),
// which pays a full-viewport recomposite cost on top of the draw itself
// every time this fires — real analog TV damage isn't a buttery-smooth
// animation either, so a lower, choppier update rate costs less overall
// without reading as "wrong" for this particular effect.
const FRAME_INTERVAL = 1000 / 20;
let lastDraw = 0;
function frame(now) {
  rafId = requestAnimationFrame(frame);
  if (now - lastDraw < FRAME_INTERVAL) return;
  lastDraw = now;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!V.enabled) return;
  if (V.staticMode) {
    if (!glitch.active) triggerBurst();
    drawStaticFrame();
    return;
  }
  if (!glitch.active) { drawBase(stepBaseLevel(V.idleFloor)); return; }
  const t = (now - glitch.start) / glitch.duration;
  if (t >= 1) {
    glitch.active = false;
    drawBase(stepBaseLevel(V.idleFloor));
    // Continuous mode: chain straight into the next burst instead of
    // waiting on V.interval — a tiny random gap (rather than 0ms flat)
    // keeps the chaining from reading as a perfectly uniform loop.
    if (V.enabled && V.continuous) {
      scheduleTimer = setTimeout(() => { if (V.enabled && V.continuous) triggerBurst(); }, rand(0, 120));
    }
    return;
  }
  drawBurst(t);
}
rafId = requestAnimationFrame(frame);
armGlitch();

/* ── Panel toggle ── standalone click; embedded, tvGlitchLayer.js's proxy
   button messages ng-tvglitch-toggle instead (mirrors ng-retrofilter-toggle
   in UI/retroFilter/script.js), since the iframe is pointer-events:none by
   default when composited in front of everything. ── */
const panel = document.getElementById('panel');
document.getElementById('panel-toggle').onclick = () => panel.classList.toggle('closed');

/* ── Reset ── */
document.getElementById('reset-btn').onclick = () => {
  NeedyGirlState.remove(STORAGE_KEY);
  location.reload();
};

/* ── Pause/resume — MANDATORY (see reference/skeleton/script.js): stop both
   the rAF draw loop AND the wall-clock burst scheduler while backgrounded,
   so a hidden/paused instance doesn't keep rolling dice on a timer nobody
   can see. ── */
addEventListener('message', (e) => {
  if (e.origin !== location.origin) return;
  const d = e.data;
  if (d?.type === 'ng-tvglitch-toggle') panel.classList.toggle('closed');
  else if (d?.type === 'ng-effect-pause') {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    clearTimeout(scheduleTimer);
  } else if (d?.type === 'ng-effect-resume') {
    if (rafId === null) rafId = requestAnimationFrame(frame);
    armGlitch();
  }
});
