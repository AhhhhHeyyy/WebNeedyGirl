// Lightweight, DOM-only prototypes: two driven imperatively by
// EffectDirector.js off live stats — an ambient heart-particle drift (yandere
// holographic mode, plus a one-shot burst on any affection increase) and an
// accumulating "I love you" text-spam overlay (affection >= 95, per
// system/NeedyGirl-簡化版-工程實作規格.md §5's loveSpam flag) — plus a third
// driven from chat.chatboardLayer.js's submit() instead: a one-shot kaomoji
// danmaku flood for the `升天` chat keyword. None of the three need
// BaseIframeLayer's own-document/pause-resume/perf-tier machinery — spawning
// some absolutely-positioned nodes with a pure CSS keyframe animation is
// cheap enough to stay in the parent page's own JS, called directly instead
// of through another effect iframe. Kept as one file since all three share
// the same overlay root and spawn/self-remove lifecycle shape.

import { ASCENSION_POSITIVE, ASCENSION_NEGATIVE } from '../core/ascensionKaomoji.js';

const HEART_IMAGE_URL = 'basic-heart-flat-vector.png';
const HEART_SIZE_PX = 96;
const HEART_ANIM_MS = 2000; // ~2s per heart, per-heart tinted via a macaron palette color
const BURST_HEART_COUNT = 8;
const BURST_SPREAD_MS = 400; // hearts in a burst are staggered across this window

// Chat `升天` keyword flood (keywordTable.js's `ascension` category) — a
// one-shot danmaku-style "彈幕洗版" burst, same staggered-spawn shape as
// triggerHeartBurst() above but flying rows instead of drifting hearts.
const ASCENSION_ROW_COUNT = 40; // "大量" — deliberately much denser than BURST_HEART_COUNT
const ASCENSION_SPREAD_MS = 1600;
const ASCENSION_FLIGHT_MS = 2400;

// Soft pastel "macaron" palette — picked per-heart instead of a random hue
// sweep so colors stay in the same dessert-case pastel family rather than
// hitting muddy/neon hues.
const MACARON_COLORS = [
  '#FFB7C5', // strawberry pink
  '#FFDAB9', // peach
  '#FFF3B0', // butter yellow
  '#C9E4C5', // pistachio
  '#B5EAD7', // mint
  '#AEC6FF', // periwinkle
  '#D7BCE8', // lavender
  '#F6C6EA', // lilac
];

const Z_INDEX = 24; // between holographic's conditional front (15) and retroFilter's constant front (25)

let root = null;
let heartTimer = null;
let heartsOn = false;
let loveSpamTimer = null;
let loveSpamOn = false;

// Set once by EffectDirector.start() (see its own configureYandereProto()
// call) so spawnLoveText() below can steer clear of Frame 1's box —
// user-requested: the "I love you" spam should only ever land in the desktop
// chrome around the stream window, never on top of it. Not needed for the
// ambient heart-drift (setHeartsActive) — only the love-spam text was called
// out, so that one is left spawning across the full stage as before.
let managerRef = null;

export function configure(manager) {
  managerRef = manager;
}

// Frame 1's live on-screen box, in the same canvas-local CSS-px coordinate
// space main.js's own stage-area click handler already uses (frame1.sprite.
// getBounds(), compared directly against a canvas-rect-relative point) — and
// since #pixi-stage/#stage-world/#stage-area all share the same top-left
// origin and size (see index.html), that space lines up 1:1 with the plain
// CSS left/top this file already positions its DOM nodes with, no further
// conversion needed.
function getFrame1Rect() {
  const frame1 = managerRef?.get('frame1');
  if (!frame1?.sprite) return null;
  const b = frame1.sprite.getBounds();
  return { left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height };
}

// Approximate on-screen size of a spawned "I love you" node — mirrors the
// (w-110)/(h-30) margin spawnLoveText() already subtracted before this
// existed, just reused here so the exclusion math and the on-screen result
// agree with each other.
const LOVE_TEXT_W = 110;
const LOVE_TEXT_H = 30;

// Picks a spot for a `w`x`h`-sized node somewhere in the `w`x`h` stage area
// but OUTSIDE `rect` (Frame 1's box) — done by treating the four strips
// surrounding the rect (left/right full-height, top/bottom full-width; they
// overlap a little at the corners, which just slightly over-weights corner
// spawns, harmless for a decorative effect) as weighted regions, sized by
// their own area so a wide short rect doesn't get spawns crammed into a
// disproportionately thin strip. Falls back to the full area if `rect` is
// missing (frame1 not ready yet) or somehow covers the whole stage (no strip
// has positive area) — better to occasionally overlap than to spawn nothing.
function randomOutsideRect(w, h, rect) {
  const maxX = Math.max(0, w - LOVE_TEXT_W);
  const maxY = Math.max(0, h - LOVE_TEXT_H);
  if (!rect) return { x: Math.random() * maxX, y: Math.random() * maxY };

  const left = Math.max(0, Math.min(maxX, rect.left));
  const right = Math.max(0, Math.min(maxX, rect.right));
  const top = Math.max(0, Math.min(maxY, rect.top));
  const bottom = Math.max(0, Math.min(maxY, rect.bottom));

  const strips = [
    { area: left * maxY, pick: () => ({ x: Math.random() * left, y: Math.random() * maxY }) },
    { area: (maxX - right) * maxY, pick: () => ({ x: right + Math.random() * (maxX - right), y: Math.random() * maxY }) },
    { area: maxX * top, pick: () => ({ x: Math.random() * maxX, y: Math.random() * top }) },
    { area: maxX * (maxY - bottom), pick: () => ({ x: Math.random() * maxX, y: bottom + Math.random() * (maxY - bottom) }) },
  ].filter((s) => s.area > 0);
  if (!strips.length) return { x: Math.random() * maxX, y: Math.random() * maxY };

  let r = Math.random() * strips.reduce((sum, s) => sum + s.area, 0);
  for (const s of strips) {
    if (r < s.area) return s.pick();
    r -= s.area;
  }
  return strips[strips.length - 1].pick();
}

function ensureRoot() {
  if (root) return root;
  // Appended into #stage-world (not #stage-area) so these hearts/love-spam
  // shake in step with the rest of the scene (see screenShake.js) instead of
  // staying visually pinned while everything behind them moves.
  const stageWorld = document.getElementById('stage-world');
  root = document.createElement('div');
  root.id = 'yandere-proto-overlay';
  Object.assign(root.style, {
    position: 'absolute', inset: '0', zIndex: String(Z_INDEX),
    pointerEvents: 'none', overflow: 'hidden',
  });
  stageWorld.appendChild(root);
  injectStyle();
  return root;
}

function injectStyle() {
  if (document.getElementById('yandere-proto-style')) return;
  const style = document.createElement('style');
  style.id = 'yandere-proto-style';
  style.textContent = `
    #yandere-proto-overlay .ypo-heart {
      position: absolute; width: ${HEART_SIZE_PX}px; height: ${HEART_SIZE_PX}px;
      margin: ${-HEART_SIZE_PX / 2}px 0 0 ${-HEART_SIZE_PX / 2}px;
      background-color: var(--ypo-color, #FFB7C5);
      -webkit-mask-image: url('${HEART_IMAGE_URL}'); mask-image: url('${HEART_IMAGE_URL}');
      -webkit-mask-size: contain; mask-size: contain;
      -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
      -webkit-mask-position: center; mask-position: center;
      opacity: 0; will-change: transform, opacity;
      animation: ypo-heart-drift ${HEART_ANIM_MS}ms ease-out forwards;
      filter: drop-shadow(0 0 8px var(--ypo-color, #FFB7C5));
    }
    @keyframes ypo-heart-drift {
      0%   { opacity: 0; transform: translate(0, 0) scale(0.5); }
      12%  { opacity: 1; }
      100% { opacity: 0; transform: translate(var(--ypo-dx, 0px), var(--ypo-dy, 0px)) scale(1.15); }
    }
    #yandere-proto-overlay .ypo-love {
      position: absolute; font-family: 'Silver', -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif;
      font-size: 20px; font-weight: 700; color: #ff5c9a; white-space: nowrap;
      text-shadow: 0 0 8px rgba(255,90,150,0.85), 0 0 2px #fff;
    }
    #yandere-proto-overlay .ypo-ascension {
      position: absolute; right: 0; white-space: nowrap;
      font-family: 'Silver', -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif;
      font-size: 22px; font-weight: 700; color: #ff8fc7;
      text-shadow: 0 0 8px rgba(255,140,200,0.85), 0 0 2px #fff;
      animation: ypo-ascension-fly ${ASCENSION_FLIGHT_MS}ms linear forwards;
    }
    /* Negative pool (stress/darkness > 50) swaps the glow to a sickly
       violet instead of the celebratory pink — same rows, same motion. */
    #yandere-proto-overlay .ypo-ascension.negative {
      color: #caa6ff;
      text-shadow: 0 0 8px rgba(120,40,160,0.9), 0 0 2px #1a0a2a;
    }
    @keyframes ypo-ascension-fly {
      0%   { transform: translateX(var(--ypa-start, 100%)); opacity: 1; }
      100% { transform: translateX(calc(-100% - var(--ypa-start, 100%))); opacity: 1; }
    }
  `;
  document.head.appendChild(style);
}

// Radiates outward from the stage's center point in a random direction, each
// heart tinted to a random macaron-palette color via a mask (the source PNG
// is a flat single-color vector, so masking it with a background-color
// yields a clean solid recolor instead of needing per-color image assets).
// Distance is scaled per-axis off the stage's own half-width/half-height (not
// a fixed px range) so the spread reaches out toward the edges of whatever
// size the stage actually is, full-bleed rather than a small central cluster.
function spawnHeart() {
  const stageArea = document.getElementById('stage-area');
  const w = stageArea.clientWidth, h = stageArea.clientHeight;
  const cx = w / 2, cy = h / 2;
  const angle = Math.random() * Math.PI * 2;
  const reach = 0.35 + Math.random() * 0.55; // fraction of the half-extent this heart travels
  const dx = Math.cos(angle) * (w / 2) * reach;
  const dy = Math.sin(angle) * (h / 2) * reach;
  const node = document.createElement('div');
  node.className = 'ypo-heart';
  node.style.left = `${cx}px`;
  node.style.top = `${cy}px`;
  node.style.setProperty('--ypo-dx', `${dx.toFixed(1)}px`);
  node.style.setProperty('--ypo-dy', `${dy.toFixed(1)}px`);
  node.style.setProperty('--ypo-color', MACARON_COLORS[Math.floor(Math.random() * MACARON_COLORS.length)]);
  ensureRoot().appendChild(node);
  node.addEventListener('animationend', () => node.remove());
}

// mode === 'yandere' ambient accompaniment — purely decorative, no rAF loop
// (each heart is a single CSS-keyframe run that removes its own node).
export function setHeartsActive(active) {
  if (active === heartsOn) return;
  heartsOn = active;
  if (active) {
    ensureRoot();
    spawnHeart();
    heartTimer = setInterval(spawnHeart, 550);
  } else if (heartTimer) {
    clearInterval(heartTimer);
    heartTimer = null;
  }
}

// One-shot burst for any affection increase (EffectDirector calls this on
// every upward edge, independent of the continuous yandere-mode ambience
// above) — a handful of hearts staggered across BURST_SPREAD_MS so the whole
// burst reads as a single ~2s "float" beat rather than one heart popping.
export function triggerHeartBurst() {
  ensureRoot();
  for (let i = 0; i < BURST_HEART_COUNT; i += 1) {
    const delay = (i / BURST_HEART_COUNT) * BURST_SPREAD_MS + Math.random() * 60;
    setTimeout(spawnHeart, delay);
  }
}

// User-requested: no fade/scale/rotate animation and no random tilt — each
// line just appears flat and upright immediately, and (per the "accumulating
// overlay" behaviour setLoveSpamActive() itself describes) stays on screen
// rather than auto-removing itself, until the whole batch is cleared at once
// when affection drops back below 95.
function spawnLoveText() {
  const stageArea = document.getElementById('stage-area');
  const w = stageArea.clientWidth, h = stageArea.clientHeight;
  const { x, y } = randomOutsideRect(w, h, getFrame1Rect());
  const node = document.createElement('div');
  node.className = 'ypo-love';
  node.textContent = 'I love you';
  node.style.left = `${x}px`;
  node.style.top = `${y}px`;
  ensureRoot().appendChild(node);
}

// affection >= 95 — spawns at a fixed interval, accumulating on screen
// (spec: ~120ms) until affection drops back below 95, at which point
// everything still on screen is cleared immediately rather than left to
// finish its own fade — matches the spec's "affection 掉回 <95 即停止並清除".
export function setLoveSpamActive(active) {
  if (active === loveSpamOn) return;
  loveSpamOn = active;
  if (active) {
    ensureRoot();
    spawnLoveText();
    loveSpamTimer = setInterval(spawnLoveText, 120);
  } else {
    if (loveSpamTimer) { clearInterval(loveSpamTimer); loveSpamTimer = null; }
    root?.querySelectorAll('.ypo-love').forEach((n) => n.remove());
  }
}

// One row of the ascension flood — spawns already off the right edge (--ypa-
// start is set to the stage's own live width, so the flight always clears it
// regardless of viewport size) and flies to fully off the left edge, then
// self-removes on animationend the same way spawnHeart() does. Vertical spot
// is random full-height, unlike spawnLoveText() there's no "avoid Frame 1"
// exclusion here — the flood is meant to wash over the whole stage.
function spawnAscensionRow(text, negative) {
  const stageArea = document.getElementById('stage-area');
  const w = stageArea.clientWidth, h = stageArea.clientHeight;
  const node = document.createElement('div');
  node.className = `ypo-ascension${negative ? ' negative' : ''}`;
  node.textContent = text;
  node.style.top = `${Math.random() * Math.max(0, h - 30)}px`;
  node.style.setProperty('--ypa-start', `${w}px`);
  ensureRoot().appendChild(node);
  node.addEventListener('animationend', () => node.remove());
}

// Chat `升天` keyword (keywordTable.js's `ascension` category), called from
// chat.chatboardLayer.js's submit(). `negative` is decided by the caller off
// live stress/darkness (>50 on either flips the pool) — this function only
// cares about which of the two kaomoji pools to draw from. Unlike
// setLoveSpamActive() above this is a one-shot burst, not a persistent
// stat-gated state: nothing here tracks on/off, each call just fires another
// wave of rows that clean themselves up as they finish flying.
export function triggerAscensionFlood(negative) {
  ensureRoot();
  const pool = negative ? ASCENSION_NEGATIVE : ASCENSION_POSITIVE;
  for (let i = 0; i < ASCENSION_ROW_COUNT; i += 1) {
    const delay = (i / ASCENSION_ROW_COUNT) * ASCENSION_SPREAD_MS + Math.random() * 80;
    setTimeout(() => spawnAscensionRow(pool[Math.floor(Math.random() * pool.length)], negative), delay);
  }
}
