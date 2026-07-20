// Two intentionally lightweight, DOM-only prototypes driven imperatively by
// EffectDirector.js: an ambient heart-particle drift (yandere holographic
// mode) and an accumulating "I love you" text-spam overlay (affection >= 95,
// per system/NeedyGirl-簡化版-工程實作規格.md §5's loveSpam flag). Neither
// needs BaseIframeLayer's own-document/pause-resume/perf-tier machinery —
// spawning some absolutely-positioned nodes with a pure CSS keyframe
// animation is cheap enough to stay in the parent page's own JS, called
// directly instead of through another effect iframe. Kept as one file since
// both share the same "yandere-mode prototype" lifecycle and overlay root.

const Z_INDEX = 24; // between holographic's conditional front (15) and retroFilter's constant front (25)

let root = null;
let heartTimer = null;
let heartsOn = false;
let loveSpamTimer = null;
let loveSpamOn = false;

function ensureRoot() {
  if (root) return root;
  const stageArea = document.getElementById('stage-area');
  root = document.createElement('div');
  root.id = 'yandere-proto-overlay';
  Object.assign(root.style, {
    position: 'absolute', inset: '0', zIndex: String(Z_INDEX),
    pointerEvents: 'none', overflow: 'hidden',
  });
  stageArea.appendChild(root);
  injectStyle();
  return root;
}

function injectStyle() {
  if (document.getElementById('yandere-proto-style')) return;
  const style = document.createElement('style');
  style.id = 'yandere-proto-style';
  style.textContent = `
    #yandere-proto-overlay .ypo-heart {
      position: absolute; font-size: 22px; opacity: 0; will-change: transform, opacity;
      animation: ypo-heart-drift 3.2s ease-out forwards;
      filter: drop-shadow(0 0 6px rgba(255,120,180,0.65));
    }
    @keyframes ypo-heart-drift {
      0%   { opacity: 0; transform: translateY(0) scale(0.6); }
      12%  { opacity: 1; }
      100% { opacity: 0; transform: translateY(-160px) scale(1.15); }
    }
    #yandere-proto-overlay .ypo-love {
      position: absolute; font-family: 'Silver', -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif;
      font-size: 20px; font-weight: 700; color: #ff5c9a; white-space: nowrap; will-change: transform, opacity;
      text-shadow: 0 0 8px rgba(255,90,150,0.85), 0 0 2px #fff;
      opacity: 0; animation: ypo-love-pop 2.4s ease-out forwards;
    }
    @keyframes ypo-love-pop {
      0%   { opacity: 0; transform: scale(0.4) rotate(var(--ypo-rot, 0deg)); }
      15%  { opacity: 1; transform: scale(1.05) rotate(var(--ypo-rot, 0deg)); }
      80%  { opacity: 1; transform: scale(1) rotate(var(--ypo-rot, 0deg)); }
      100% { opacity: 0; transform: scale(1) rotate(var(--ypo-rot, 0deg)); }
    }
  `;
  document.head.appendChild(style);
}

function spawnHeart() {
  const stageArea = document.getElementById('stage-area');
  const w = stageArea.clientWidth, h = stageArea.clientHeight;
  const node = document.createElement('div');
  node.className = 'ypo-heart';
  node.textContent = Math.random() < 0.5 ? '\u{1F495}' : '\u{1F493}';
  node.style.left = `${Math.random() * w}px`;
  node.style.top = `${h * (0.55 + Math.random() * 0.35)}px`;
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

function spawnLoveText() {
  const stageArea = document.getElementById('stage-area');
  const w = stageArea.clientWidth, h = stageArea.clientHeight;
  const node = document.createElement('div');
  node.className = 'ypo-love';
  node.textContent = 'I love you';
  node.style.left = `${Math.random() * Math.max(0, w - 110)}px`;
  node.style.top = `${Math.random() * Math.max(0, h - 30)}px`;
  node.style.setProperty('--ypo-rot', `${(Math.random() * 30 - 15).toFixed(1)}deg`);
  ensureRoot().appendChild(node);
  node.addEventListener('animationend', () => node.remove());
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
