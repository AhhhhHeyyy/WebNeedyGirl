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
   adjustable max + on/off toggle), only the actual CSS formula differs. */
function wireOverlay({ key, el, btn, colorInp, opaInp, opaMaxInp, pctEl, apply }) {
  const st = S[key];
  colorInp.value = st.hex;
  opaInp.value = st.opa;
  if (st.off) el.classList.add('off');
  btn.classList.toggle('on', !st.off);

  function refresh() {
    apply(st.hex, st.opa);
    pctEl.textContent = Math.round(st.opa * 100) + '%';
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
}

wireOverlay({
  key: 'scanline', el: document.getElementById('scanline'), btn: document.getElementById('scanline-btn'),
  colorInp: document.getElementById('scanline-color'), opaInp: document.getElementById('scanline-opa'),
  opaMaxInp: document.getElementById('scanline-opa-max'), pctEl: document.getElementById('scanline-pct'),
  apply: (hex, opa) => {
    const t = hexToRgba(hex, 0), s = hexToRgba(hex, opa);
    document.getElementById('scanline').style.backgroundImage =
      `repeating-linear-gradient(0deg, ${t} 0px, ${t} 2px, ${s} 2px, ${s} 3px)`;
  },
});

wireOverlay({
  key: 'vignette', el: document.getElementById('vignette'), btn: document.getElementById('vignette-btn'),
  colorInp: document.getElementById('vignette-color'), opaInp: document.getElementById('vignette-opa'),
  opaMaxInp: document.getElementById('vignette-opa-max'), pctEl: document.getElementById('vignette-pct'),
  apply: (hex, opa) => {
    document.getElementById('vignette').style.background =
      `radial-gradient(ellipse at center, transparent 45%, ${hexToRgba(hex, opa)} 100%)`;
  },
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
  grainEl.style.opacity = S.grain.opa;
  grainPctEl.textContent = Math.round(S.grain.opa * 100) + '%';
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

/* When embedded via retroFilterLayer.js, this iframe is pointer-events:none
   by default (so stage drag / the main layer panel underneath keep working)
   and can only be reached through a small proxy button the parent page adds
   — clicking it messages this document to flip the exact same panel used
   when this effect runs standalone. */
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin) return;
  if (e.data?.type === 'ng-retrofilter-toggle') panel.classList.toggle('closed');
});
