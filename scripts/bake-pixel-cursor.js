#!/usr/bin/env node
// Bakes UI/pixelCursor's arrow bitmap + rainbow-outline animation into a
// small, transparent, seamlessly-looping WebM (UI/pixelCursor/cursor.webm).
// Renders raw RGBA frames straight into ffmpeg's stdin — no browser, no
// canvas library needed, since the source art is just flat-filled cells.
//
// Baked at native COLS x ROWS resolution (one video pixel per bitmap cell);
// the page displays it scaled up via CSS `image-rendering: pixelated`, same
// as the live canvas sprite did, so this script never needs to know V.scale.
//
// Usage: node scripts/bake-pixel-cursor.js [path-to-ffmpeg.exe]
const { spawn } = require('child_process');
const path = require('path');

const FFMPEG = process.argv[2] || 'ffmpeg';
const OUT = path.join(__dirname, '..', 'UI', 'pixelCursor', 'cursor.webm');

// ── Mirrors UI/pixelCursor/script.js's CURSOR_BITMAP/depth/RAINBOW_BAND_DEG
// exactly — keep these two in sync by hand if the arrow shape ever changes. ──
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
const RAINBOW_BAND_DEG = 22;
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

// ── Baked to match the app's current defaults (V.rainbowSpeed=6,
// V.borderWidth=1, bodyHex='#ffffff') — rerun this script with different
// values below if those defaults ever change. ──
const RAINBOW_SPEED = 6;   // seconds per full palette cycle
const BORDER_WIDTH = 1;
const BODY_HEX = '#ffffff';
const FPS = 30;
const FRAME_COUNT = Math.round(FPS * RAINBOW_SPEED);

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Cyclic gradient stops for the outline (replaces a full 360° hue sweep) —
// just pink and blue. With 2 stops, paletteColor()'s wraparound naturally
// gives a symmetric pink→blue→pink "breathing" cycle, no extra logic needed.
const PALETTE = [
  hexToRgb('#ff69ad'), // pink
  hexToRgb('#52a8ff'), // blue
  hexToRgb('#fff4b7')
];
const STRIPE_STEP = 22 / 360; // phase step per diagonal cell — mirrors the old RAINBOW_BAND_DEG's stripe density

function paletteColor(t) {
  const n = PALETTE.length;
  const scaled = t * n;
  const i = Math.floor(scaled) % n;
  const frac = scaled - Math.floor(scaled);
  const a = PALETTE[i], b = PALETTE[(i + 1) % n];
  return [
    Math.round(a[0] + (b[0] - a[0]) * frac),
    Math.round(a[1] + (b[1] - a[1]) * frac),
    Math.round(a[2] + (b[2] - a[2]) * frac),
  ];
}

const bodyRgb = hexToRgb(BODY_HEX);

function renderFrame(cycleT) {
  const buf = Buffer.alloc(COLS * ROWS * 4); // transparent by default
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const d = depth[r][c];
      if (d === -1 || d > BORDER_WIDTH) continue;
      let rgb;
      if (d === 0) {
        rgb = bodyRgb;
      } else {
        const phase = cycleT + (c - r) * STRIPE_STEP;
        rgb = paletteColor(((phase % 1) + 1) % 1);
      }
      const i = (r * COLS + c) * 4;
      buf[i] = rgb[0]; buf[i + 1] = rgb[1]; buf[i + 2] = rgb[2]; buf[i + 3] = 255;
    }
  }
  return buf;
}

const ff = spawn(FFMPEG, [
  '-y',
  '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${COLS}x${ROWS}`, '-r', String(FPS),
  '-i', '-',
  '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0',
  '-b:v', '0', '-crf', '30',
  '-an',
  OUT,
], { stdio: ['pipe', 'inherit', 'inherit'] });

ff.on('close', (code) => {
  if (code === 0) console.log(`Wrote ${OUT} (${COLS}x${ROWS}px, ${FRAME_COUNT} frames @ ${FPS}fps)`);
  else { console.error(`ffmpeg exited with code ${code}`); process.exit(1); }
});

for (let i = 0; i < FRAME_COUNT; i++) {
  ff.stdin.write(renderFrame(i / FRAME_COUNT));
}
ff.stdin.end();
