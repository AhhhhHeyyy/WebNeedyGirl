/* ── Persistence ── */
const STORAGE_KEY = 'needygirl-pixelCursor-settings';
function loadSaved() {
  try { return JSON.parse(NeedyGirlState.get(STORAGE_KEY)) || {}; }
  catch { return {}; }
}
function saveState() {
  NeedyGirlState.set(STORAGE_KEY, JSON.stringify({ V, trailHex }));
}
const saved = loadSaved();

/* ── State ── borderWidth has no UI control anymore (the live cursor's
   look is baked into cursor.webm — see scripts/bake-pixel-cursor.js — so
   there's nothing left to animate at runtime), but it stays here since
   isCursorCell() below still uses it to size the ghost trail's silhouette. */
const V = {
  scale: 1.5,          // pixel-art cell size multiplier
  borderWidth: 1,     // how many outline rings count toward the ghost trail's silhouette
  trailEnabled: false, // ghost afterimages off by default — they read as lag on the live cursor
  trailSpacing: 18,   // min CSS px moved before dropping a new ghost
  trailCount: 6,      // how many ghost copies trail behind (4-8)
  trailFadeMs: 700,   // how long the whole ghost trail takes to fade if the pointer stops
  ...(saved.V || {}),
};
let trailHex = saved.trailHex || '#ffffff';

/* ── 8-bit arrow bitmap ── 'X' = filled cell, hotspot is the top-left tip
   (row 0, col 0), matching a normal OS cursor's hotspot convention. */
const CURSOR_BITMAP = [
  'X...........',
  'XX..........',
  'XXX.........',
  'XXXX........',
  'XXXXX.......',
  'XXXXXX......',
  'XXXXXXX.....',
  'XXXXXXXX....',
  'XXXXXXXXX...',
  'XXXXXXXXXX..',
  'XXXXXXXXXXX.',
  'XXXXXXX.....',
  'XXXXXX......',
  'XX...XXX.....',
  'X.....XXX....',
  '......XXX...',
  '......XXX..',
  '.......XXX.',
  '........XX..',
];
const ROWS = CURSOR_BITMAP.length, COLS = CURSOR_BITMAP[0].length;

/* depth[r][c]: 0 = solid body, 1..MAX_RING_DEPTH = successive outline rings
   wrapping the body (how many of those actually get drawn/animated is
   V.borderWidth, applied at render time so the slider doesn't need this
   grid rebuilt). -1 = outside the cursor shape entirely (transparent).
   Precomputed once via a breadth-first dilation from the filled cells since
   the bitmap itself is static. */
const MAX_RING_DEPTH = 4;
const depth = Array.from({ length: ROWS }, () => new Array(COLS).fill(-1));
{
  let frontier = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (CURSOR_BITMAP[r][c] === 'X') { depth[r][c] = 0; frontier.push([r, c]); }
    }
  }
  for (let d = 1; d <= MAX_RING_DEPTH; d++) {
    const next = [];
    for (const [r, c] of frontier) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
          if (depth[nr][nc] !== -1) continue;
          depth[nr][nc] = d;
          next.push([nr, nc]);
        }
      }
    }
    frontier = next;
  }
}
function isCursorCell(r, c) { return depth[r][c] !== -1 && depth[r][c] <= V.borderWidth; }

/* ── Canvas ── */
const canvas = document.getElementById('gl');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

let dpr = 1;
function resize() {
  dpr = window.getPerfResolutionCap ? window.getPerfResolutionCap() : Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(innerWidth * dpr);
  canvas.height = Math.floor(innerHeight * dpr);
  // ghostSprite is rebuilt lazily in drawGhosts() whenever dpr (among other
  // things) no longer matches its cache key — nothing to do here.
}
addEventListener('resize', resize); resize();

/* ── Pointer ── driven either by local events (when this page is opened
   standalone) or by pixelCursorLayer.js forwarding real pointer position via
   postMessage (this iframe is click-through once embedded, so it can't
   reliably get its own mousemove — see holographicLayer.js for the same
   pattern). Coordinates are CSS px relative to this iframe's own box. */
const pointer = { x: -9999, y: -9999, has: false };
function setPointer(x, y) {
  pointer.x = x; pointer.y = y; pointer.has = true;
  maybeSampleGhost();
  // Position itself is NOT read into displayPos until the next rAF tick
  // (see updateDisplayPos below) — displayPos tracks it 1:1 there, with
  // anti-flicker handled at render time (positionCursorEl's pixel snap)
  // instead of via follow-lag smoothing here.
}
addEventListener('mousemove', (e) => setPointer(e.clientX, e.clientY));
addEventListener('touchmove', (e) => {
  const t = e.touches[0]; if (t) setPointer(t.clientX, t.clientY);
}, { passive: true });
// Exposed for pixelCursorLayer.js to call directly (same-origin, so this is
// legal) instead of postMessage — a direct call runs synchronously in the
// caller's own task, skipping the browser's cross-realm message-queue
// scheduling that postMessage is subject to. postMessage stays wired up too
// as a fallback for whenever direct access isn't available.
window.__ngSetPointer = setPointer;
addEventListener('message', (e) => {
  if (e.origin !== location.origin) return;
  const d = e.data;
  if (d?.type === 'ng-pixelCursor-pointer') setPointer(d.x, d.y);
  else if (d?.type === 'ng-effect-pause') { if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; } }
  else if (d?.type === 'ng-effect-resume') { if (rafId === null) rafId = requestAnimationFrame(frame); }
});

/* ── Ghost trail ── a short queue of past pointer positions (capped at
   V.trailCount, oldest evicted first), each rendered as a soft, rounded
   silhouette of the cursor itself — not the blocky 8-bit grid the live
   cursor uses. Samples are taken by distance (not every mousemove) so
   ghosts read as a handful of discrete afterimages spaced along the path,
   not a continuous smear. */
let ghosts = [];
let lastSample = null;
function maybeSampleGhost() {
  if (!V.trailEnabled || !pointer.has) return;
  if (lastSample) {
    const dx = pointer.x - lastSample.x, dy = pointer.y - lastSample.y;
    if (Math.hypot(dx, dy) < V.trailSpacing) return;
  }
  lastSample = { x: pointer.x, y: pointer.y };
  ghosts.push({ x: pointer.x, y: pointer.y, t: performance.now() });
  while (ghosts.length > V.trailCount) ghosts.shift();
}

const BASE_CELL_CSS = 2; // CSS px per bitmap cell at V.scale === 1

/* Offscreen sprite of the cursor's own silhouette (body + current outline
   rings), solid-filled — rebuilt only when size/outline-width settings
   change. Drawing it back with a canvas blur() filter is what turns the
   blocky per-cell mask into a soft, rounded afterimage cheaply, instead of
   hand-tracing a separate smooth vector outline that would have to be kept
   in sync with the bitmap by hand. */
let ghostSprite = null, ghostPad = 0, ghostBlurPx = 0, ghostBuiltFor = null;
function buildGhostSprite() {
  const cell = BASE_CELL_CSS * V.scale * dpr;
  ghostBlurPx = Math.max(2, cell * 0.55);
  ghostPad = Math.ceil(ghostBlurPx * 3);
  const w = COLS * cell, h = ROWS * cell;
  const cv = document.createElement('canvas');
  cv.width = w + ghostPad * 2; cv.height = h + ghostPad * 2;
  const c = cv.getContext('2d');
  c.fillStyle = trailHex;
  for (let r = 0; r < ROWS; r++) {
    for (let col = 0; col < COLS; col++) {
      if (!isCursorCell(r, col)) continue;
      c.fillRect(ghostPad + col * cell, ghostPad + r * cell, cell, cell);
    }
  }
  ghostSprite = cv;
  ghostBuiltFor = `${V.scale}:${V.borderWidth}:${dpr}:${trailHex}`;
}

function drawGhosts(now) {
  if (!V.trailEnabled) { if (ghosts.length) ghosts = []; return; }
  const cacheKey = `${V.scale}:${V.borderWidth}:${dpr}:${trailHex}`;
  if (!ghostSprite || ghostBuiltFor !== cacheKey) buildGhostSprite();
  ghosts = ghosts.filter(g => now - g.t < V.trailFadeMs);
  const n = ghosts.length;
  for (let i = 0; i < n; i++) {
    const g = ghosts[i];
    const age = now - g.t;
    const rank = (i + 1) / (n + 1);              // further back in the queue = fainter
    const timeFade = Math.max(0, 1 - age / V.trailFadeMs); // whole trail fades out if idle
    const alpha = rank * timeFade * 0.68;
    if (alpha <= 0.01) continue;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.filter = `blur(${ghostBlurPx}px)`;
    ctx.drawImage(ghostSprite, g.x * dpr - ghostPad, g.y * dpr - ghostPad);
    ctx.restore();
  }
}

/* ── Cursor sprite ── the live cursor's pixel content (arrow + animated
   rainbow outline) is pre-rendered into cursor.webm (see
   scripts/bake-pixel-cursor.js), a tiny COLSxROWS looping video with an
   alpha channel — so there's no per-cell HSL computation running in this
   page at all anymore, on any cadence. The video plays itself, entirely off
   this document's main thread; all this element does is sit there and get
   moved. Positioning is CSS `transform` only (see positionCursorEl below):
   moving a positioned element is compositor-only, no repaint of anything,
   so it stays cheap no matter how fast pointer events arrive — unlike
   drawImage-ing into a canvas, which forces a rasterize on every move. */
const cursorSprite = document.createElement('video');
cursorSprite.id = 'cursor-sprite';
cursorSprite.src = 'cursor.webm';
cursorSprite.muted = true;
cursorSprite.loop = true;
cursorSprite.playsInline = true;
cursorSprite.autoplay = true;
document.body.appendChild(cursorSprite);
cursorSprite.play().catch(() => {}); // autoplay can be deferred until the first user gesture on some browsers; harmless if so

function updateCursorSize() {
  cursorSprite.style.width = (COLS * BASE_CELL_CSS * V.scale) + 'px';
  cursorSprite.style.height = (ROWS * BASE_CELL_CSS * V.scale) + 'px';
}
updateCursorSize();

// The arrow's hotspot is its top-left tip (row 0, col 0), which is also
// this element's own (0,0) — so translating it straight to `displayPos`
// lands the tip exactly on the eased cursor position (see CURSOR_BITMAP
// comment above for the hotspot convention; see displayPos/frame() below
// for why this isn't just `pointer` directly).
//
// displayPos is snapped to the nearest *device* pixel before it goes into
// the transform. `image-rendering: pixelated` needs the sprite's source
// pixels to land on whole device-pixel boundaries to stay crisp — at a
// sub-pixel translate the compositor has to blend it across two device
// pixels' worth of positions, and doing that fresh every frame as
// displayPos drifts by fractional amounts is what reads as a faint
// flicker/stepping during otherwise-smooth motion. Rounding removes the
// sub-pixel remainder feeding that blend; any leftover "step" is a single
// device pixel, i.e. below what's perceptible.
function positionCursorEl() {
  cursorSprite.style.display = 'block';
  const px = Math.round(displayPos.x * dpr) / dpr;
  const py = Math.round(displayPos.y * dpr) / dpr;
  cursorSprite.style.transform = `translate3d(${px}px, ${py}px, 0)`;
}

// displayPos eases toward `pointer` via a One Euro Filter (Casiez et al.
// 2012) — same stylus-style idea as before (smoothing strength adapts to
// current speed: heavier near-stationary, near-raw once actually moving),
// but tuned much lighter than the first pass. positionCursorEl's
// device-pixel rounding now does most of the anti-flicker work by itself
// (any noise under half a device pixel just rounds away for free), so this
// filter only needs to mop up whatever noise is left *above* that
// threshold — it doesn't have to carry the whole job the way the first,
// heavier version tried to, which is what made that version's low-speed lag
// noticeable once rounding was added on top of it.
//   minCutoff: base cutoff (Hz) at zero speed — lower = more smoothing at
//              rest, higher = lighter touch (less lag settling in at rest).
//   beta:      how fast the cutoff opens up as speed increases (px/s) —
//              higher = faster-moving cursor sheds smoothing sooner.
const ONE_EURO_MIN_CUTOFF = 4.0;
const ONE_EURO_BETA = 0.015;
const ONE_EURO_D_CUTOFF = 1.0;

class LowPassFilter {
  constructor() { this.y = null; }
  filter(x, alpha) {
    this.y = this.y === null ? x : alpha * x + (1 - alpha) * this.y;
    return this.y;
  }
}
function oneEuroAlpha(cutoffHz, dtSec) {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSec);
}
class OneEuroFilter {
  constructor(minCutoff, beta, dCutoff) {
    this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff;
    this.xFilt = new LowPassFilter(); this.dxFilt = new LowPassFilter();
    this.lastX = null;
  }
  filter(x, dtSec) {
    if (this.lastX === null) { this.lastX = x; return this.xFilt.filter(x, 1); }
    const dx = (x - this.lastX) / dtSec;
    this.lastX = x;
    const edx = this.dxFilt.filter(dx, oneEuroAlpha(this.dCutoff, dtSec));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.xFilt.filter(x, oneEuroAlpha(cutoff, dtSec));
  }
}
const filterX = new OneEuroFilter(ONE_EURO_MIN_CUTOFF, ONE_EURO_BETA, ONE_EURO_D_CUTOFF);
const filterY = new OneEuroFilter(ONE_EURO_MIN_CUTOFF, ONE_EURO_BETA, ONE_EURO_D_CUTOFF);
const displayPos = { x: 0, y: 0, ready: false };
let lastFrameTime = null;
function updateDisplayPos(now) {
  if (!pointer.has) { displayPos.ready = false; return false; }
  const dtSec = Math.max((lastFrameTime === null ? 16 : now - lastFrameTime) / 1000, 1e-3);
  lastFrameTime = now;
  displayPos.x = filterX.filter(pointer.x, dtSec);
  displayPos.y = filterY.filter(pointer.y, dtSec);
  displayPos.ready = true;
  return true;
}

/* ── Slider builder ── */
function makeSlider({ id, label, min, max, step, def, key, onInput }) {
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
    if (onInput) onInput();
    saveState();
  });
}
const trailEnabledInput = document.getElementById('trail-enabled');
trailEnabledInput.checked = V.trailEnabled;
trailEnabledInput.addEventListener('change', e => {
  V.trailEnabled = e.target.checked;
  if (!V.trailEnabled) ctx.clearRect(0, 0, canvas.width, canvas.height); // wipe any leftover ghost pixels
  saveState();
});

makeSlider({ id: 'sg-scale', label: 'Cursor Size', min: 1, max: 6, step: 1, def: V.scale, key: 'scale', onInput: updateCursorSize });
makeSlider({ id: 'sg-spacing', label: 'Ghost Spacing', min: 6, max: 40, step: 1, def: V.trailSpacing, key: 'trailSpacing' });
makeSlider({ id: 'sg-count', label: 'Ghost Count', min: 4, max: 8, step: 1, def: V.trailCount, key: 'trailCount' });
makeSlider({ id: 'sg-fade', label: 'Ghost Fade (ms)', min: 200, max: 1500, step: 25, def: V.trailFadeMs, key: 'trailFadeMs' });

/* ── Color picker ── Ghost Trail only; the live cursor's colors are baked
   into cursor.webm now (see scripts/bake-pixel-cursor.js). */
const trailInput = document.getElementById('trail-color');
trailInput.value = trailHex;
trailInput.addEventListener('input', e => { trailHex = e.target.value; saveState(); });

/* ── Panel toggle ── parent page also drives this via postMessage when the
   effect is embedded frontmost/click-through (see pixelCursorLayer.js) —
   this local handler still lets the page work standalone too. */
const panel = document.getElementById('panel');
document.getElementById('panel-toggle').onclick = () => panel.classList.toggle('closed');
addEventListener('message', (e) => {
  if (e.origin !== location.origin) return;
  if (e.data?.type === 'ng-pixelCursor-toggle') panel.classList.toggle('closed');
});

/* ── Reset ── */
document.getElementById('reset-btn').onclick = () => {
  NeedyGirlState.remove(STORAGE_KEY);
  location.reload();
};

/* ── Render loop ── #gl (the big full-stage-area canvas) is only used for
   the ghost trail. The live cursor's *content* plays itself independently
   (it's a looping <video>); its *position* is synced from `pointer` and
   (re)placed every tick (see updateDisplayPos/positionCursorEl), so this
   loop is still doing real work even with the trail off. */
let rafId = null;
function frame(now) {
  if (updateDisplayPos(now)) positionCursorEl();
  else cursorSprite.style.display = 'none';
  if (V.trailEnabled) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawGhosts(now);
  }
  rafId = requestAnimationFrame(frame);
}
rafId = requestAnimationFrame(frame);
