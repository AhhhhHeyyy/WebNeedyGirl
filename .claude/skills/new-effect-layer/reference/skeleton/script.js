/* ── Persistence ── delete this whole block (and the makeSlider/reset-btn
   code below) if this effect has no tunable panel; see UI/checkerboard for
   the "baked constants, no panel" pattern instead. */
const STORAGE_KEY = 'needygirl-__EFFECT_ID__-settings';
function loadSaved() {
  try { return JSON.parse(NeedyGirlState.get(STORAGE_KEY)) || {}; }
  catch { return {}; }
}
function saveState() {
  NeedyGirlState.set(STORAGE_KEY, JSON.stringify({ V }));
}
const saved = loadSaved();

/* ── State — replace with this effect's real tunable parameters ── */
const V = {
  example: 1.0,
  ...(saved.V || {}),
};

/* ── Slider builder (copy UI/holographic/script.js's makeSlider instead if
   you also want the per-slider "max" number input) ── */
function makeSlider({ id, label, min, max, step, def, key }) {
  const ct = document.getElementById(id);
  const top = document.createElement('div'); top.className = 'sg-top';
  const lbl = document.createElement('span'); lbl.className = 'sg-label'; lbl.textContent = label;
  const val = document.createElement('span'); val.className = 'sg-val'; val.textContent = def;
  top.appendChild(lbl); top.appendChild(val);
  const tr = document.createElement('div'); tr.className = 'sg-track';
  const sl = document.createElement('input'); sl.type = 'range';
  sl.min = min; sl.max = max; sl.step = step; sl.value = def;
  tr.appendChild(sl);
  ct.appendChild(top); ct.appendChild(tr);
  sl.addEventListener('input', () => {
    V[key] = parseFloat(sl.value);
    val.textContent = sl.value;
    saveState();
  });
}
makeSlider({ id: 'sg-example', label: 'Example', min: 0, max: 1, step: 0.01, def: V.example, key: 'example' });

/* ── Resize — only needed if rendering to a <canvas> ── */
const canvas = document.getElementById('gl');
function resize() {
  const dpr = window.getPerfResolutionCap ? window.getPerfResolutionCap() : Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(innerWidth * dpr);
  canvas.height = Math.floor(innerHeight * dpr);
}
addEventListener('resize', resize); resize();

/* ── Panel toggle ── */
const panel = document.getElementById('panel');
document.getElementById('panel-toggle').onclick = () => panel.classList.toggle('closed');

/* ── Reset (clear this effect's saved settings and reload its defaults) ── */
document.getElementById('reset-btn').onclick = () => {
  NeedyGirlState.remove(STORAGE_KEY);
  location.reload();
};

/* ── Render loop — replace the TODO with the actual effect, driven by V.* ── */
let rafId = null;
function frame(now) {
  // TODO: draw/animate using V.example etc.
  rafId = requestAnimationFrame(frame);
}
rafId = requestAnimationFrame(frame);

/* ── Pause/resume — MANDATORY regardless of panel/canvas choices above.
   BaseIframeLayer only sets this iframe's display:none while hidden/tab
   backgrounded; it does NOT stop this script's own rAF loop, so stop it
   explicitly on request instead of shading/animating for no visible result.
   If the effect's motion is CSS @keyframes-driven instead of rAF, toggle an
   'ng-paused' class on <html> instead (see UI/checkerboard/style.css:
   "html.ng-paused .drift-x, ... { animation-play-state: paused }"). ── */
addEventListener('message', (e) => {
  if (e.origin !== location.origin) return;
  const d = e.data;
  if (d?.type === 'ng-effect-pause') { if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; } }
  else if (d?.type === 'ng-effect-resume') { if (rafId === null) rafId = requestAnimationFrame(frame); }
});
