/* ── Persistence ── */
const STORAGE_KEY = 'needygirl-man-settings';
function loadSaved() {
  try { return JSON.parse(NeedyGirlState.get(STORAGE_KEY)) || {}; }
  catch { return {}; }
}
function saveState() {
  NeedyGirlState.set(STORAGE_KEY, JSON.stringify({ V }));
}
const saved = loadSaved();

/* ── State ── */
const V = {
  showTime: 2,   // how long the image stays fully visible/full-size, seconds
  size: 18,      // image width as % of viewport width
  opacity: 1,    // peak opacity while visible
  ...(saved.V || {}),
};

/* Pop-in/pop-out edge speed — fixed, independent of the Show Time slider,
   so "Show Time" always means exactly that many seconds at 100%, not a
   fraction of some total that shrinks as the edges get slower. */
const EDGE_S = 0.25;

/* ── Slider builder ── */
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
    if (key === 'showTime') updateKeyframes();
  });
}
makeSlider({ id: 'sg-showtime', label: 'Show Time (s)', min: 0.8, max: 6, step: 0.1, def: V.showTime, key: 'showTime' });
/* Rebuilds the man-pop @keyframes with percentages derived from the fixed
   EDGE_S in/out time and the current hold (V.showTime), so the hold is
   always that many seconds of real time — a plain CSS % can't do this
   because it's relative to a --dur that changes with the slider. Same-named
   @keyframes fully replace each other (no merging), so this <style>, added
   after style.css's link tag, wins outright. */
let keyframesStyleEl = null;
function updateKeyframes() {
  const total = V.showTime + EDGE_S * 2;
  const inPct = (EDGE_S / total * 100).toFixed(3);
  const outPct = (100 - EDGE_S / total * 100).toFixed(3);
  if (!keyframesStyleEl) {
    keyframesStyleEl = document.createElement('style');
    document.head.appendChild(keyframesStyleEl);
  }
  keyframesStyleEl.textContent = `@keyframes man-pop {
    0%    { opacity: 0;           transform: scale(0.4); }
    ${inPct}%  { opacity: var(--op,1); transform: scale(1); }
    ${outPct}% { opacity: var(--op,1); transform: scale(1); }
    100%  { opacity: 0;           transform: scale(0.75); }
  }`;
  return total;
}
updateKeyframes();
makeSlider({ id: 'sg-size', label: 'Size (% width)', min: 6, max: 45, step: 1, def: V.size, key: 'size' });
makeSlider({ id: 'sg-opacity', label: 'Opacity', min: 0.2, max: 1, step: 0.05, def: V.opacity, key: 'opacity' });

/* ── Panel toggle ── */
const panel = document.getElementById('panel');
document.getElementById('panel-toggle').onclick = () => panel.classList.toggle('closed');

/* manLayer.js pins this iframe click-through and frontmost (so the popup
   never swallows clicks meant for the layers underneath it), which also
   makes the #panel-toggle button above unreachable from outside — it adds
   its own always-clickable proxy button in the parent document instead,
   which just messages this document to flip the exact same panel used
   when this effect runs standalone (mirrors UI/retroFilter/script.js). */
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin) return;
  if (e.data?.type === 'ng-man-toggle') panel.classList.toggle('closed');
});

/* ── Reset ── */
document.getElementById('reset-btn').onclick = () => {
  NeedyGirlState.remove(STORAGE_KEY);
  location.reload();
};

/* ── Pop in at a specific spot, triggered by the parent document ──
   The parent (src/main.js) listens for clicks anywhere on the stage that
   land outside Frame 1 and forwards the click position here via
   postMessage, so this popup no longer decides when/where to appear on its
   own — it just reacts. Positioning is done in px (not vw/vh) so the
   image's real aspect ratio is respected and it never gets clipped off the
   edge of the viewport, regardless of window size. */
const img = document.getElementById('man-img');

function showMan(clientX, clientY) {
  const vw = innerWidth, vh = innerHeight;
  const imgW = vw * (V.size / 100);
  const aspect = (img.naturalWidth && img.naturalHeight) ? (img.naturalHeight / img.naturalWidth) : 1;
  const imgH = imgW * aspect;
  const maxLeft = Math.max(0, vw - imgW);
  const maxTop = Math.max(0, vh - imgH);
  // Centered on the click point, clamped so it stays fully on-screen.
  const left = Math.min(maxLeft, Math.max(0, clientX - imgW / 2));
  const top = Math.min(maxTop, Math.max(0, clientY - imgH / 2));

  img.style.width = `${imgW}px`;
  img.style.left = `${left}px`;
  img.style.top = `${top}px`;
  img.style.setProperty('--dur', `${V.showTime + EDGE_S * 2}s`);
  img.style.setProperty('--op', V.opacity);

  // Restart the animation even if a previous run left the 'pop' class on.
  img.classList.remove('pop');
  void img.offsetWidth;
  img.classList.add('pop');
}

img.addEventListener('animationend', () => {
  img.classList.remove('pop');
});

addEventListener('message', (e) => {
  if (e.origin !== location.origin) return;
  if (e.data?.type === 'ng-man-show') showMan(e.data.x, e.data.y);
});

/* ── Pause/resume — MANDATORY. Motion here is CSS-keyframe-driven (not
   rAF), so pausing just means freezing the pop animation's timeline via the
   html.ng-paused rule in style.css if one is mid-flight; there's no
   scheduled timer to stop anymore since appearances are click-triggered. ── */
addEventListener('message', (e) => {
  if (e.origin !== location.origin) return;
  const d = e.data;
  if (d?.type === 'ng-effect-pause') {
    document.documentElement.classList.add('ng-paused');
  } else if (d?.type === 'ng-effect-resume') {
    document.documentElement.classList.remove('ng-paused');
  }
});
