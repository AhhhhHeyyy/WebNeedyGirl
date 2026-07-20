const STICKERS = ['sticker1.png', 'sticker2.png', 'sticker3.png', 'sticker4.png', 'sticker5.png'];

const listEl = document.getElementById('sticker-list');
const rowEl = document.getElementById('sticker-row');
const clonesLayer = document.getElementById('clones-layer');

// Each item gets its own fixed hover tilt (picked once, at build time) so
// "單獨旋轉放大" reads as every sticker having its own distinct lean instead
// of all five rotating the same way.
const items = STICKERS.map((file) => {
  const item = document.createElement('div');
  item.className = 'sticker-item';
  item.style.setProperty('--hover-rot', `${(Math.random() * 16 - 8).toFixed(1)}deg`);

  const img = document.createElement('img');
  img.className = 'sticker-img';
  img.src = file;
  img.draggable = false;
  item.appendChild(img);

  const rainbow = document.createElement('div');
  rainbow.className = 'sticker-rainbow';
  rainbow.style.maskImage = `url("${file}")`;
  rainbow.style.webkitMaskImage = `url("${file}")`;
  item.appendChild(rainbow);

  rowEl.appendChild(item);
  return item;
});

// Real hover/click is detected in the parent document (a window-level
// pointermove/click listener hit-tested against each icon's rect, see
// stickerListLayer.js) — an iframe's pointer-events is all-or-nothing at
// the parent's hit-testing boundary, so nothing in here can be a real
// interactive target itself. This reports each icon's current on-screen box
// back so the parent can hit-test without having to duplicate the
// flex/padding layout math from style.css.
function postRects() {
  const rects = items.map((item) => {
    const r = item.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
  parent.postMessage({ type: 'ng-stickerlist-rects', rects }, location.origin);
}

// ── Entrance/exit reveal ── DISABLED: icons are now always visible (see
// .sticker-item's base opacity/scale in style.css, set to shown by default)
// instead of only appearing once the listStickers board finishes its
// hover-lift/long-press pop. pulseOpen()/pulseClose() are kept but unused —
// left commented out below in case the staggered reveal is wanted again.
// const STAGGER_MS = 90;
// let pulseTimers = [];
//
// function clearPulseTimers() {
//   pulseTimers.forEach(clearTimeout);
//   pulseTimers = [];
// }
//
// function pulseOpen() {
//   clearPulseTimers();
//   items.forEach((item, i) => {
//     pulseTimers.push(setTimeout(() => item.classList.add('entered'), i * STAGGER_MS));
//   });
// }
//
// function pulseClose() {
//   clearPulseTimers();
//   const last = items.length - 1;
//   items.forEach((item, i) => {
//     pulseTimers.push(setTimeout(() => item.classList.remove('entered'), (last - i) * STAGGER_MS));
//   });
// }

// ── Falling clones ──────────────────────────────────────────────────────
// Unlimited concurrent clones; a single shared rAF loop drives all of them
// (cheaper than one loop per clone) and only runs while at least one is
// still on screen. Each clone gets a small random upward "toss" velocity
// that gravity then overpowers, rather than dropping dead-straight, so it
// reads as being physically flung rather than just falling.
const GRAVITY = 1400; // px/s^2
let activeClones = [];
let rafId = null;
let paused = false;
let lastTs = 0;

// Forwarded on every 'ng-stickerlist-position' message (see
// stickerListLayer.js) — the fixed CSS-px size below was tuned against a
// ~1920x1080 desktop viewport, so it's scaled down by this ratio on a
// smaller mobile one instead of reading as oversized there.
let cloneScale = 1;

function spawnClone(file) {
  const size = (96 + Math.random() * 64) * cloneScale;
  const x = Math.random() * Math.max(0, innerWidth - size);
  const y = Math.random() * innerHeight * 0.6;
  const rot = (Math.random() - 0.5) * 60;

  const el = document.createElement('img');
  el.src = file;
  el.className = 'sticker-clone';
  el.draggable = false;
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.transform = `translate(${x}px, ${y}px) rotate(${rot}deg)`;
  clonesLayer.appendChild(el);

  activeClones.push({
    el, x, y, size, rot,
    vx: (Math.random() - 0.5) * 160,
    vy: -80 - Math.random() * 120,
    vrot: (Math.random() - 0.5) * 240,
  });

  ensureLoop();
}

function ensureLoop() {
  if (rafId !== null || paused || !activeClones.length) return;
  lastTs = performance.now();
  rafId = requestAnimationFrame(tick);
}

function tick(ts) {
  rafId = null;
  // Clamped generously (not tightly) — a throttled/backgrounded tab can
  // easily go well over 50ms between rAF callbacks (Chrome throttles
  // backgrounded/occluded rAF hard), and a tight clamp there just makes the
  // fall track wall-clock time in slow motion instead of catching up. There
  // are no collisions to destabilize with a big dt, just monotonic falling,
  // so the only reason for a cap at all is to stop a multi-minute-sleep tab
  // from computing an ugly one-frame teleport through absurd velocity.
  const dt = Math.min((ts - lastTs) / 1000, 0.25);
  lastTs = ts;

  for (let i = activeClones.length - 1; i >= 0; i--) {
    const c = activeClones[i];
    c.vy += GRAVITY * dt;
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    c.rot += c.vrot * dt;
    c.el.style.transform = `translate(${c.x}px, ${c.y}px) rotate(${c.rot}deg)`;

    if (c.y - c.size > innerHeight) {
      c.el.remove();
      activeClones.splice(i, 1);
    }
  }

  if (activeClones.length && !paused) rafId = requestAnimationFrame(tick);
}

// ── Bridges to the parent frame ─────────────────────────────────────────
addEventListener('resize', postRects);
addEventListener('message', (e) => {
  if (e.origin !== location.origin) return;
  const d = e.data;
  if (d?.type === 'ng-stickerlist-position') {
    if (typeof d.cloneScale === 'number') cloneScale = d.cloneScale;
    Object.assign(listEl.style, {
      left: `${d.left}px`, top: `${d.top}px`, width: `${d.width}px`, height: `${d.height}px`,
      // scale/rotate are the panel's own layer adjustments (see
      // stickerListLayer.js's getTransform/setTransform) — applied here as a
      // transform around the box's own center, on top of the board-tracked
      // left/top/width/height above.
      transform: `scale(${d.scaleX}, ${d.scaleY}) rotate(${d.rotation}rad)`,
    });
    // 'vertical' on a too-short/wide viewport (stickerListLayer.js's narrow
    // mode) stacks the 5 icons into a column instead of a row — see
    // style.css's #sticker-row.vertical rule.
    rowEl.classList.toggle('vertical', d.orientation === 'vertical');
    listEl.classList.add('positioned');
    postRects();
  } else if (d?.type === 'ng-stickerlist-open') {
    // pulseOpen(); // entrance animation disabled — icons stay visible always
  } else if (d?.type === 'ng-stickerlist-close') {
    // pulseClose(); // exit animation disabled — icons stay visible always
  } else if (d?.type === 'ng-stickerlist-hover') {
    items[d.index]?.classList.toggle('hovering', !!d.hover);
  } else if (d?.type === 'ng-stickerlist-click') {
    const file = STICKERS[d.index];
    if (file) spawnClone(file);
  } else if (d?.type === 'ng-effect-pause') {
    paused = true;
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    document.documentElement.classList.add('ng-paused');
  } else if (d?.type === 'ng-effect-resume') {
    paused = false;
    document.documentElement.classList.remove('ng-paused');
    ensureLoop();
  }
});
