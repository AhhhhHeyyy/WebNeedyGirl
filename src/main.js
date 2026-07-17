import { Stage } from './core/Stage.js';
import { LayerManager } from './core/LayerManager.js';
import { LayerPanel } from './ui/LayerPanel.js';
import { PopupTuningPanel } from './ui/PopupTuningPanel.js';
import { BaseImageLayer } from './layers/BaseImageLayer.js';
import { BaseLottieLayer } from './layers/BaseLottieLayer.js';
import { BaseIframeLayer } from './layers/BaseIframeLayer.js';
import { GroupLayer } from './layers/GroupLayer.js';
import { spawnNestedScene3Popup, clientToLogical, popupTuning } from './layers/nestedScene3PopupSpawner.js';

const STORAGE_KEY = 'needygirl-layer-layout';

const bgContainer = document.getElementById('bg-effect-layer');
const pixiContainer = document.getElementById('pixi-stage');
const lottieContainer = document.getElementById('lottie-layer');
const panelMount = document.getElementById('layer-panel-mount');
const popupTuningMount = document.getElementById('popup-tuning-mount');
const saveBtn = document.getElementById('layer-save-btn');
const resetBtn = document.getElementById('layer-reset-btn');

const stage = new Stage(pixiContainer);
const manager = new LayerManager();
window.__needyGirl = { stage, manager }; // dev-console debugging aid only

// Every layer type owns a separate DOM/rendering context (iframe, Pixi
// canvas, lottie-web canvas), so they can only stack as whole blocks, not
// interleave sprite-by-sprite across contexts. Reconciling that is the
// composition root's job, not LayerManager's or any individual layer's.
pixiContainer.querySelector('canvas').style.zIndex = '10';
function reconcileZIndex() {
  const lottieLayer = manager.layers.find(l => l.type === 'lottie');
  if (!lottieLayer) return;
  const isFrontmost = manager.layers[manager.layers.length - 1] === lottieLayer;
  lottieContainer.style.zIndex = isFrontmost ? '20' : '5';
}
manager.onChange(reconcileZIndex);

// Backgrounding the tab (switching apps on mobile, locking the screen) is
// the biggest easy win: pause every layer's own animation loop and the
// whole Pixi ticker, then only resume layers the user actually had visible.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stage.app.ticker.stop();
    manager.layers.forEach(l => l.pause && l.pause());
  } else {
    stage.app.ticker.start();
    manager.layers.forEach(l => l.resume && l.resume());
  }
});

// manifest.json (see scripts/scan-assets.js) is the single source of truth
// for what's in UI/ — adding/removing/renaming an asset means re-running
// that scanner, not touching this file. It lives at the project root
// (NOT inside UI/) specifically so reorganizing UI/ by hand can never
// sweep it into a subfolder by accident.
//
// Returns an array of layers (usually just one) — a "group" entry can also
// carry its own Lottie files, and those get promoted to independent
// top-level lottie layers instead of nesting (Lottie is a separate DOM
// context, it can't be a child of the group's Pixi container).
async function createLayer(kind, entry) {
  if (entry.module) {
    const mod = await import(`./${entry.module}`);
    const container = kind === 'lottie' ? lottieContainer : kind === 'effect' ? bgContainer : undefined;
    return [await mod.create({ ...entry, stage, container, manager })];
  }
  switch (kind) {
    case 'effect':
      return [await BaseIframeLayer.create({
        id: entry.id, label: entry.label, src: `${entry.folder}/index.html`, container: bgContainer,
      })];
    case 'image':
      return [await BaseImageLayer.create({
        id: entry.id, label: entry.label, src: `UI/${entry.file}`, stage, x: 0, y: 0, scale: 1,
      })];
    case 'lottie':
      return [await BaseLottieLayer.create({
        id: entry.id, label: entry.label, src: `UI/${entry.file}`, container: lottieContainer,
        stage, x: 0, y: 0, scale: 1, width: 512, height: 512,
      })];
    case 'group': {
      const group = await GroupLayer.create({
        id: entry.id, label: entry.label, stage, folder: entry.folder, images: entry.images,
      });
      const promotedLottie = await Promise.all((entry.lottie || []).map(le => BaseLottieLayer.create({
        id: le.id, label: `${entry.label} / ${le.label}`, src: `${entry.folder}/${le.file}`,
        container: lottieContainer, stage, x: 0, y: 0, scale: 1, width: 512, height: 512,
        // Nested Scene 3 plays once per click (see boot()'s stage-area click
        // handler below), not on a loop — hardcoded by id since it's the
        // only Lottie asset in the project right now; manifest.json can't
        // carry this itself, see the comment on the click handler.
        loop: le.id !== 'dark.nestedScene3',
      })));
      return [group, ...promotedLottie];
    }
  }
}

let defaults = null; // captured once every layer has loaded; see boot()

// A blank page with no clue why is exactly what happens if manifest.json
// goes missing (moved, renamed, stale) — put the reason on screen instead
// of only in devtools console, since that's the failure mode most likely
// to actually happen (reorganizing UI/ by hand) and least likely to get
// noticed otherwise.
function showBootError(message) {
  const el = document.createElement('div');
  el.id = 'boot-error';
  Object.assign(el.style, {
    position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
    background: 'rgba(20, 10, 30, 0.92)', color: '#ffdce8', padding: '20px 28px',
    borderRadius: '12px', fontFamily: 'monospace', fontSize: '13px', whiteSpace: 'pre-wrap',
    maxWidth: '80vw', lineHeight: '1.6', textAlign: 'center', zIndex: '9999',
  });
  el.textContent = message;
  document.body.appendChild(el);
}

async function boot() {
  let manifest;
  try {
    const res = await fetch('manifest.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    manifest = await res.json();
  } catch (err) {
    showBootError(
      `找不到或讀不到 manifest.json（${err.message}）\n\n` +
      `檢查專案根目錄下是否有 manifest.json，\n` +
      `或執行 node scripts/scan-assets.js 重新產生。`
    );
    throw err;
  }

  // Show the panel immediately and let rows pop in as each asset finishes
  // loading, rather than blocking on the slowest one — a large animated GIF
  // can take several seconds to decode, and shouldn't freeze the whole page.
  new LayerPanel({ mountEl: panelMount, layerManager: manager });
  new PopupTuningPanel({
    mountEl: popupTuningMount, popupTuning,
    onTestSpawn: () => spawnNestedScene3Popup(0, 0, { stage, manager, lottieContainer })
      .catch(err => console.error('Failed to spawn Nested Scene 3 pop-up:', err)),
  });
  saveBtn.onclick = () => {
    NeedyGirlState.set(STORAGE_KEY, JSON.stringify(manager.getSnapshot()));
    saveBtn.classList.add('on');
    setTimeout(() => saveBtn.classList.remove('on'), 500);
  };
  resetBtn.onclick = () => {
    if (!defaults) return; // still loading; nothing to reset to yet
    NeedyGirlState.remove(STORAGE_KEY);
    manager.applySnapshot(defaults);
  };

  const requests = [
    ...manifest.effects.map(entry => ({ kind: 'effect', entry })),
    ...manifest.images.map(entry => ({ kind: 'image', entry })),
    ...manifest.lottie.map(entry => ({ kind: 'lottie', entry })),
    ...(manifest.groups || []).map(entry => ({ kind: 'group', entry })),
  ];

  await Promise.all(requests.map(({ kind, entry }) =>
    createLayer(kind, entry)
      .then(layers => layers.forEach(l => manager.add(l)))
      .catch(err => console.error(`Failed to load layer "${entry.id}":`, err))
  ));

  // Every animated GIF starts playing the moment its own load resolves, so
  // GIFs that finish decoding at slightly different times drift out of phase
  // forever even with identical frame timing. Now that all layers are in,
  // snap them back to frame 0 together so they start in sync.
  manager.layers.forEach(l => l.resetAnimation && l.resetAnimation());

  // Everything has loaded (or logged its own failure) — safe to snapshot
  // defaults and restore a saved layout now that every id actually exists.
  defaults = manager.getSnapshot();
  const saved = NeedyGirlState.get(STORAGE_KEY);
  if (saved) {
    try { manager.applySnapshot(JSON.parse(saved)); }
    catch (err) { console.error('Ignoring corrupt saved layout:', err); }
  }

  // The panel's own "dark.nestedScene3" never plays itself — it's just the
  // size/rotation template for pop-ups (see nestedScene3PopupSpawner.js), so
  // it's parked at frame 0 instead of running its autoplay:true default.
  // Paused here in code rather than via manifest config — manifest.json is
  // scanned fresh from UI/ on every request (scripts/scan-assets.js) and
  // can't carry hand-authored per-asset flags, unlike a spine skin baked
  // into a custom layer module.
  manager.get('dark.nestedScene3')?.stop();

  // A window pop-up (with its own clipped Angel D) spawns at wherever the
  // stage was clicked, but only for clicks that land inside Frame 1's box —
  // outside of it there's no Angel D to peek out from, so it wouldn't mean
  // anything. Each click spawns an independent, throwaway instance that
  // plays once and destroys itself — clicking again before one finishes
  // doesn't wait or queue, it just opens another on top.
  const stageArea = document.getElementById('stage-area');
  stageArea.addEventListener('click', (e) => {
    const rect = stageArea.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    // Clicking the sticker list is how it gets pinned open on mobile (see
    // listStickersLayer.js's long-press handling), and it also sits inside
    // Frame 1's own box — checked first, before either pop-up below, so a
    // click there never spawns Nested Scene 3 (it used to, since that check
    // ran first and returned early) or the man pop-up on top of the widget.
    const listStickers = manager.get('listStickers');
    if (listStickers && listStickers.sprite.getBounds().contains(px, py)) return;

    // Frame 1's hit box is its live Pixi screen bounds (same coordinate
    // space stageArea's own rect uses, since #pixi-stage sits absolute/100%
    // inside #stage-area with no extra offset), a plain axis-aligned rect
    // check even though frame1 can be rotated/scaled — good enough for "did
    // this click clearly hit the frame".
    const frame1 = manager.get('frame1');
    const insideFrame1 = frame1 && frame1.sprite.getBounds().contains(px, py);

    if (insideFrame1) {
      const { x, y } = clientToLogical(e.clientX, e.clientY, stage);
      spawnNestedScene3Popup(x, y, { stage, manager, lottieContainer })
        .catch(err => console.error('Failed to spawn Nested Scene 3 pop-up:', err));
      return;
    }

    // The "man" popup (UI/man) used to appear on its own random timer; it's
    // now a reaction to clicks that land outside Frame 1's box instead — it
    // runs in a click-through, full-viewport frontmost iframe (see
    // manLayer.js) so it can never see the click itself, hence forwarding
    // the position in via postMessage rather than the iframe listening on
    // its own.
    const manLayer = manager.get('man');
    if (manLayer && manLayer.visible) {
      manLayer.el.contentWindow?.postMessage({ type: 'ng-man-show', x: px, y: py }, window.location.origin);
    }
  });
}

boot().catch(err => console.error('Layer init failed:', err));
