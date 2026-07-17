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
  scale: 2,          // pixel-art cell size multiplier
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
  // Position itself is NOT updated here — it eases toward `pointer` every
  // rAF tick instead (see displayPos/CURSOR_SMOOTH_MS below). Snapping
  // straight to raw pointer coordinates on every event is more immediate,
  // but reads as jumpy/rigid at fast direction changes; a light follow lag
  // reads as smoother even though it's a few ms less instantaneous.
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
function positionCursorEl() {
  cursorSprite.style.display = 'block';
  cursorSprite.style.transform = `translate3d(${displayPos.x}px, ${displayPos.y}px, 0)`;
}

// The cursor eases toward `pointer` (the real, immediately-updated target)
// instead of snapping straight to it — a tiny bit of follow lag reads as a
// smooth glide, whereas 1:1 snapping reads as jumpy/rigid on fast direction
// changes. Exponential decay (not a flat per-frame lerp factor) so the feel
// stays the same regardless of display refresh rate: smaller
// CURSOR_SMOOTH_MS = snappier/tighter follow, larger = more trailing lag.
const CURSOR_SMOOTH_MS = 55;
const displayPos = { x: 0, y: 0, ready: false };
let lastFrameTime = null;
function updateDisplayPos(now) {
  if (!pointer.has) { displayPos.ready = false; return false; }
  if (!displayPos.ready) {
    displayPos.x = pointer.x; displayPos.y = pointer.y; displayPos.ready = true;
    lastFrameTime = now;
    return true;
  }
  const dt = lastFrameTime === null ? 16 : now - lastFrameTime;
  lastFrameTime = now;
  const dx = pointer.x - displayPos.x, dy = pointer.y - displayPos.y;
  if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) {
    displayPos.x = pointer.x; displayPos.y = pointer.y;
  } else {
    const factor = 1 - Math.exp(-dt / CURSOR_SMOOTH_MS);
    displayPos.x += dx * factor;
    displayPos.y += dy * factor;
  }
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
   (it's a looping <video>), but its *position* now eases toward the
   pointer every tick (see updateDisplayPos), so — unlike before the easing
   was added — this loop is no longer just idling with the trail off. */
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
