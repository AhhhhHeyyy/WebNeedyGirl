/* ── Persistence ── mirrors UI/holographic & UI/checkerboard: state is
   scoped to this effect's own overlay settings, saved via
   shared/state-sync.js so it survives reloads without the parent page's
   LayerManager needing to know about it. */
const STORAGE_KEY = 'needygirl-retroFilter-settings';
function loadSaved() {
  try { return JSON.parse(NeedyGirlState.get(STORAGE_KEY)) || {}; }
  catch { return {}; }
}
function saveState() {
  NeedyGirlState.set(STORAGE_KEY, JSON.stringify(S));
}
const saved = loadSaved();

const S = {
  scanline: { hex: saved.scanline?.hex ?? '#000000', opa: saved.scanline?.opa ?? 0.18, off: !!saved.scanline?.off },
  vignette: { hex: saved.vignette?.hex ?? '#140a05', opa: saved.vignette?.opa ?? 0.55, off: !!saved.vignette?.off },
  grade:    { hex: saved.grade?.hex ?? '#ff8c46',    opa: saved.grade?.opa ?? 0.07,    off: !!saved.grade?.off },
  grain:    { opa: saved.grain?.opa ?? 0.05, off: !!saved.grain?.off },
  flicker:  { opa: saved.flicker?.opa ?? 0.03, off: !!saved.flicker?.off },
};

function hexToRgba(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/* ── Generic wiring for a color+opacity overlay block ── scanline/vignette/
   grade all share the same shape (color picker + opacity slider with an
   adjustable max + on/off toggle), only the actual CSS formula differs.
   getEffectiveOpa lets a caller (the darkness-intensity blend below, for
   vignette only) substitute a computed value in place of the raw slider
   value for both the applied CSS and the displayed %, without the slider's
   own stored st.opa ever being overwritten — that stays the user's base. */
function wireOverlay({ key, el, btn, colorInp, opaInp, opaMaxInp, pctEl, apply, getEffectiveOpa }) {
  const st = S[key];
  colorInp.value = st.hex;
  opaInp.value = st.opa;
  if (st.off) el.classList.add('off');
  btn.classList.toggle('on', !st.off);

  function refresh() {
    const opa = getEffectiveOpa ? getEffectiveOpa() : st.opa;
    apply(st.hex, opa);
    pctEl.textContent = Math.round(opa * 100) + '%';
  }
  colorInp.addEventListener('input', e => { st.hex = e.target.value; refresh(); saveState(); });
  opaInp.addEventListener('input', e => { st.opa = parseFloat(e.target.value); refresh(); saveState(); });
  opaMaxInp.addEventListener('change', e => {
    const nm = parseFloat(e.target.value);
    if (!isNaN(nm) && nm > 0) { opaInp.max = nm; if (st.opa > nm) { st.opa = nm; opaInp.value = nm; refresh(); saveState(); } }
    else e.target.value = opaInp.max;
  });
  btn.onclick = () => {
    st.off = el.classList.toggle('off');
    btn.classList.toggle('on', !st.off);
    saveState();
  };
  refresh();
  return refresh;
}

/* ── Continuous darkness intensity (EffectDirector -> ng-retrofilter-intensity)
   ── blended on top of vignette/grain as `max(userBaseOpa, darkCurrent*capacity)`
   rather than replacing them, so a user's own manual overlay settings are
   never destructively overwritten by the stat-driven signal. darkCurrent
   lerps toward darkTarget every frame (see the rAF loop below) instead of
   snapping straight to the incoming value, per the spec's flicker-avoidance
   requirement for this effect ("再對輸出做時間平滑避免跳動"). */
const DARK_VIGNETTE_CAPACITY = 0.85; // headroom under vignette's own 0-1 slider range
const DARK_GRAIN_CAPACITY = 0.22;    // headroom under grain's own 0-0.3 slider range
let darkTarget = 0, darkCurrent = 0, darkRafId = null;

/* Line thickness + gap both scale with viewport height (reference: 800px
   tall == the original fixed 1px line / 2px gap), so the pattern reads as
   the same relative density on a phone as on a big monitor instead of
   looking coarse when the window shrinks or the window grows. */
function scanlineMetrics() {
  const scale = window.innerHeight / 800;
  const line = Math.max(1, Math.round(scale));
  const gap = Math.max(1, Math.round(scale * 2));
  return { line, gap };
}

function applyScanline(hex, opa) {
  const { line, gap } = scanlineMetrics();
  const t = hexToRgba(hex, 0), s = hexToRgba(hex, opa);
  document.getElementById('scanline').style.backgroundImage =
    `repeating-linear-gradient(0deg, ${t} 0px, ${t} ${gap}px, ${s} ${gap}px, ${s} ${gap + line}px)`;
}

wireOverlay({
  key: 'scanline', el: document.getElementById('scanline'), btn: document.getElementById('scanline-btn'),
  colorInp: document.getElementById('scanline-color'), opaInp: document.getElementById('scanline-opa'),
  opaMaxInp: document.getElementById('scanline-opa-max'), pctEl: document.getElementById('scanline-pct'),
  apply: applyScanline,
});

addEventListener('resize', () => applyScanline(S.scanline.hex, S.scanline.opa));

const refreshVignette = wireOverlay({
  key: 'vignette', el: document.getElementById('vignette'), btn: document.getElementById('vignette-btn'),
  colorInp: document.getElementById('vignette-color'), opaInp: document.getElementById('vignette-opa'),
  opaMaxInp: document.getElementById('vignette-opa-max'), pctEl: document.getElementById('vignette-pct'),
  apply: (hex, opa) => {
    document.getElementById('vignette').style.background =
      `radial-gradient(ellipse at center, transparent 45%, ${hexToRgba(hex, opa)} 100%)`;
  },
  getEffectiveOpa: () => Math.max(S.vignette.opa, darkCurrent * DARK_VIGNETTE_CAPACITY),
});

wireOverlay({
  key: 'grade', el: document.getElementById('grade'), btn: document.getElementById('grade-btn'),
  colorInp: document.getElementById('grade-color'), opaInp: document.getElementById('grade-opa'),
  opaMaxInp: document.getElementById('grade-opa-max'), pctEl: document.getElementById('grade-pct'),
  apply: (hex, opa) => {
    document.getElementById('grade').style.background = hexToRgba(hex, opa);
  },
});

/* ── Grain (opacity-only; the texture drift itself is a CSS keyframe, only
   its opacity is user-tunable) ── */
const grainEl = document.getElementById('grain');
const grainBtn = document.getElementById('grain-btn');
const grainOpaInp = document.getElementById('grain-opa');
const grainOpaMaxInp = document.getElementById('grain-opa-max');
const grainPctEl = document.getElementById('grain-pct');
grainOpaInp.value = S.grain.opa;
if (S.grain.off) grainEl.classList.add('off');
grainBtn.classList.toggle('on', !S.grain.off);
function refreshGrain() {
  const opa = Math.max(S.grain.opa, darkCurrent * DARK_GRAIN_CAPACITY);
  grainEl.style.opacity = opa;
  grainPctEl.textContent = Math.round(opa * 100) + '%';
}
grainOpaInp.addEventListener('input', e => { S.grain.opa = parseFloat(e.target.value); refreshGrain(); saveState(); });
grainOpaMaxInp.addEventListener('change', e => {
  const nm = parseFloat(e.target.value);
  if (!isNaN(nm) && nm > 0) { grainOpaInp.max = nm; if (S.grain.opa > nm) { S.grain.opa = nm; grainOpaInp.value = nm; refreshGrain(); saveState(); } }
  else e.target.value = grainOpaInp.max;
});
grainBtn.onclick = () => { S.grain.off = grainEl.classList.toggle('off'); grainBtn.classList.toggle('on', !S.grain.off); saveState(); };
refreshGrain();

/* ── Flicker (opacity-only; amplitude feeds the CSS keyframe via --amt so
   the pulse itself stays a zero-JS animation) ── */
const flickerEl = document.getElementById('flicker');
const flickerBtn = document.getElementById('flicker-btn');
const flickerOpaInp = document.getElementById('flicker-opa');
const flickerOpaMaxInp = document.getElementById('flicker-opa-max');
const flickerPctEl = document.getElementById('flicker-pct');
flickerOpaInp.value = S.flicker.opa;
if (S.flicker.off) flickerEl.classList.add('off');
flickerBtn.classList.toggle('on', !S.flicker.off);
function refreshFlicker() {
  flickerEl.style.setProperty('--amt', S.flicker.opa);
  flickerPctEl.textContent = Math.round(S.flicker.opa * 100) + '%';
}
flickerOpaInp.addEventListener('input', e => { S.flicker.opa = parseFloat(e.target.value); refreshFlicker(); saveState(); });
flickerOpaMaxInp.addEventListener('change', e => {
  const nm = parseFloat(e.target.value);
  if (!isNaN(nm) && nm > 0) { flickerOpaInp.max = nm; if (S.flicker.opa > nm) { S.flicker.opa = nm; flickerOpaInp.value = nm; refreshFlicker(); saveState(); } }
  else e.target.value = flickerOpaInp.max;
});
flickerBtn.onclick = () => { S.flicker.off = flickerEl.classList.toggle('off'); flickerBtn.classList.toggle('on', !S.flicker.off); saveState(); };
refreshFlicker();

/* ── Reset (clear this effect's saved settings and reload its defaults) ── */
document.getElementById('reset-btn').onclick = () => {
  NeedyGirlState.remove(STORAGE_KEY);
  location.reload();
};

/* ── Panel toggle ── */
const panel = document.getElementById('panel');
document.getElementById('panel-toggle').onclick = () => panel.classList.toggle('closed');

/* ── Darkness-intensity lerp loop ── this effect had no rAF loop at all
   before (pure CSS + slider-driven opacity, nothing to animate on its own),
   so this is the first one: eases darkCurrent toward whatever
   ng-retrofilter-intensity last set as darkTarget, then re-applies
   vignette/grain through their effective-opacity blend every tick. Because
   this is a real animation loop now, it also needs to actually stop while
   backgrounded/hidden (see ng-effect-pause below) — every other effect that
   owns a loop already does this; before this change retroFilter simply had
   nothing that needed pausing. */
function darkFrame() {
  darkRafId = requestAnimationFrame(darkFrame);
  darkCurrent += (darkTarget - darkCurrent) * 0.08;
  refreshVignette();
  refreshGrain();
}
darkRafId = requestAnimationFrame(darkFrame);

/* When embedded via retroFilterLayer.js, this iframe is pointer-events:none
   by default (so stage drag / the main layer panel underneath keep working)
   and can only be reached through a small proxy button the parent page adds
   — clicking it messages this document to flip the exact same panel used
   when this effect runs standalone. Also handles EffectDirector's darkness
   signal (ng-retrofilter-intensity) and, now that darkFrame() above is a
   real rAF loop, the pause/resume messages every other effect iframe
   already reacts to. */
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin) return;
  const d = e.data;
  if (d?.type === 'ng-retrofilter-toggle') panel.classList.toggle('closed');
  else if (d?.type === 'ng-retrofilter-intensity') darkTarget = Math.max(0, Math.min(1, d.value ?? 0));
  else if (d?.type === 'ng-effect-pause') { if (darkRafId !== null) { cancelAnimationFrame(darkRafId); darkRafId = null; } }
  else if (d?.type === 'ng-effect-resume') { if (darkRafId === null) darkRafId = requestAnimationFrame(darkFrame); }
});
