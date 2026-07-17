# 合成行為模式（`src/layers/<effectId>Layer.js`）

只有效果需要「不是全螢幕背景、永遠置底」以外的合成行為時才需要這個檔案。三種已知模式如下，都是 `extends BaseIframeLayer`（[BaseIframeLayer.js](../../../../src/layers/BaseIframeLayer.js)）。檔名必須是 `src/layers/<effectId>Layer.js`，`effectId` 跟 `UI/<effectId>/` 資料夾名完全一致 — `scripts/scan-assets.js` 的 `customModuleFor()` 就是直接拿這個 id 去找檔案存不存在。

每個模式都要 export 一個工廠函式，main.js 的 `createLayer()` 會呼叫它並帶入 `{ ...manifestEntry, stage, container, manager }`：

```js
export async function create(opts) {
  return new XLayer({ ...opts, src: `${opts.folder}/index.html` });
}
```

## 模式 A — 預設（全螢幕背景，永遠置底）

**不用寫這個檔案。** `scan-assets.js` 找不到對應的 `<effectId>Layer.js` 時，manifest 就不會帶 `module` 欄位，main.js 會自動退回泛用的 `BaseIframeLayer.create()`（全螢幕、`setZIndex` 固定回 `0`，永遠疊在所有 Pixi/Lottie 圖層底下）。大部分「氛圍/背景特效」用這個就好。

## 模式 B — 貼合遮罩到某個既有圖片圖層

範例：[holographicLayer.js](../../../../src/layers/holographicLayer.js)（貼合 Frame 1 的輪廓）。

核心結構：
```js
import { BaseIframeLayer } from './BaseIframeLayer.js';

const MASK_SRC = 'UI/<目標圖層的 png>'; // 硬編碼，這是跟特定圖層綁定的專屬配對，不是通用機制

export class XLayer extends BaseIframeLayer {
  constructor(opts) {
    super(opts);
    this.manager = opts.manager;
    this.stage = opts.stage;

    this.el.style.visibility = 'hidden'; // 等第一次 _reposition() 成功才顯示，避免目標圖層還沒載入時先閃過一次全螢幕
    Object.assign(this.el.style, {
      maskImage: `url("${MASK_SRC}")`, WebkitMaskImage: `url("${MASK_SRC}")`,
      maskSize: '100% 100%', WebkitMaskSize: '100% 100%',
      maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat',
      maskPosition: 'center', WebkitMaskPosition: 'center',
    });

    this._offManagerChange = this.manager.onChange(() => this._reposition());
    this._offResize = this.stage.onResize(() => this._reposition());
    this._reposition();
  }

  _reposition() {
    const target = this.manager.get('<目標圖層 id>');
    if (!target || !target.sprite) return; // 還沒載入，繼續等下一次 onChange/onResize

    const sprite = target.sprite;
    const bounds = sprite.getLocalBounds();
    const w = bounds.width * sprite.scale.x, h = bounds.height * sprite.scale.y;
    const scale = this.stage.scaleFactor;
    const screenW = w * scale, screenH = h * scale;
    const centerX = this.stage.root.position.x + sprite.x * scale;
    const centerY = this.stage.root.position.y + sprite.y * scale;

    Object.assign(this.el.style, {
      left: `${centerX - screenW / 2}px`, top: `${centerY - screenH / 2}px`,
      width: `${screenW}px`, height: `${screenH}px`,
      transform: sprite.rotation ? `rotate(${sprite.rotation}rad)` : 'none',
      visibility: 'visible',
    });
  }

  // 疊圖層是整塊 DOM stacking context，只能整塊在 Pixi 畫布前面或後面，
  // 不能跟裡面的 sprite 逐一交錯 — 這裡示範「目標圖層排到最前面時，跟著提到前面」
  setZIndex(_i) {
    const layers = this.manager.layers;
    const idx = layers.findIndex(l => l.id === '<目標圖層 id>');
    const isFrontmost = idx !== -1 && idx === layers.length - 1;
    this.el.style.zIndex = isFrontmost ? '15' : '0';
  }

  destroy() {
    this._offManagerChange();
    this._offResize();
    super.destroy();
  }
}

export async function create(opts) {
  return new XLayer({ ...opts, src: `${opts.folder}/index.html` });
}
```

如果效果內部需要即時滑鼠位置（iframe 不一定是最上層,收不到自己的 `mousemove`），額外在 constructor 掛 `window.addEventListener('pointermove', ...)`，算出相對 iframe 的 normalized 座標後用 `this.el.contentWindow.postMessage({ type: 'ng-<effectId>-pointer', tx, ty }, window.location.origin)` 轉發進去，iframe 內部的 script.js 對應監聽 `message` 事件（同源檢查 `e.origin === location.origin`）。完整範例見 holographicLayer.js 的 `_forwardPointer` 和 holographic/script.js 監聽 `ng-holographic-pointer` 的地方。

## 模式 C — 強制置頂、蓋住整個畫面的濾鏡

範例：[retroFilterLayer.js](../../../../src/layers/retroFilterLayer.js)（鏡頭濾鏡：掃描線/暈影/色偏，蓋在所有東西最上面）。

核心結構：
```js
import { BaseIframeLayer } from './BaseIframeLayer.js';

const FRONTMOST_Z = 25; // 比 lottie 置頂時的 20、pixi 的 10 都高

export class XLayer extends BaseIframeLayer {
  constructor(opts) {
    super(opts);

    // 全螢幕蓋在最上面會吃掉所有點擊/拖曳 —— 預設 click-through，
    // 只有使用者主動開自己的調整面板時才恢復可互動。
    this.el.style.pointerEvents = 'none';
    this._panelOpen = false;

    // iframe 的 pointer-events 對 parent 來說是全有全無，內部自己的
    // panel-toggle 按鈕沒辦法「唯一例外」地保持可點 —— 所以在 parent
    // 這邊另外掛一顆永遠可點的小按鈕，用 postMessage 通知 iframe 開合面板。
    this.toggleBtn = document.createElement('button');
    this.toggleBtn.textContent = '📼';
    Object.assign(this.toggleBtn.style, {
      position: 'absolute', top: '58px', right: '14px', zIndex: String(FRONTMOST_Z + 1),
      width: '34px', height: '34px', borderRadius: '50%', border: 'none', cursor: 'pointer',
    });
    this.toggleBtn.onclick = () => {
      this._panelOpen = !this._panelOpen;
      this.el.style.pointerEvents = this._panelOpen ? 'auto' : 'none';
      this.el.contentWindow.postMessage({ type: 'ng-<effectId>-toggle' }, window.location.origin);
    };
    this.el.parentElement.appendChild(this.toggleBtn);
  }

  setVisible(visible) {
    super.setVisible(visible);
    this.toggleBtn.style.display = visible ? 'block' : 'none';
    if (!visible) { this._panelOpen = false; this.el.style.pointerEvents = 'none'; }
  }

  setZIndex(_i) { this.el.style.zIndex = String(FRONTMOST_Z); }

  destroy() { this.toggleBtn.remove(); super.destroy(); }
}

export async function create(opts) {
  return new XLayer({ ...opts, src: `${opts.folder}/index.html` });
}
```

iframe 內部（script.js）要監聽 `ng-<effectId>-toggle` 訊息，自己切換 `#panel.closed`（不要再用內部的 `#panel-toggle` 按鈕當唯一入口，因為 parent 端已經用 pointer-events:none 擋掉了平常的點擊）。

## 怎麼選

| 這個效果應該… | 用哪個模式 |
|---|---|
| 蓋滿全螢幕，當背景氛圍，圖層順序不重要 | A（預設，不用寫檔案）|
| 貼合、遮罩到某個特定的既有圖片圖層形狀 | B |
| 蓋在所有東西最上面，像鏡頭濾鏡/後製 | C |

拿不準就用 `AskUserQuestion` 問使用者一句：「這個效果應該永遠在背景、永遠在最前面、還是要貼著某個特定圖層？」
