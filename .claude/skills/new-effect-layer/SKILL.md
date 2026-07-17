---
name: new-effect-layer
description: Scaffold a new self-contained visual effect (like UI/holographic, UI/checkerboard, UI/retroFilter) for this NeedyGirl compositor project, and wire it into the layer system. Use when the user describes a new visual effect they want added to the composited scene, or asks to create/add a new "effect layer" / "特效圖層" / "新效果".
---

# New Effect Layer

這個 skill 把「做一個新的自成一體特效、掛進圖層系統」的流程自動化。目標：使用者只要描述想要的效果長什麼樣子，跑完這個 skill 之後，新效果就會自動出現在 [index.html](../../../index.html) 的 Layers 面板裡 — **不需要手動編輯 index.html 或 manifest.json**。

## 核心心智模型（先懂這個，再動手）

1. **每個效果是 `UI/<effectId>/` 底下完全獨立的一組 `index.html` + `style.css` + `script.js`。** 它有自己的渲染迴圈（Canvas 2D / WebGL rAF，或純 CSS keyframes）、可能有自己的可調面板、自己的持久化 key。它被包在一個 `<iframe>` 裡跑，跟主頁面是不同的瀏覽情境。
2. **`manifest.json` 是唯一真相來源，而且是自動產生的。** [scripts/scan-assets.js](../../../scripts/scan-assets.js) 掃描整個 `UI/`：任何資料夾底下有 `index.html` 就會被登記成一個 effect。**新增/修改效果永遠不用手動改 `manifest.json` 或根目錄 `index.html`** —— 跑一次 scanner（或直接用 dev-server，它每次請求 `/manifest.json` 都會重掃並回傳最新版）就自動生效，見 [src/main.js](../../../src/main.js) 的 `boot()`。
3. **合成行為（永遠置底 / 永遠置頂 / 貼合到某個既有圖層）也是自動掛載的擴充點，不是要去改 main.js。** 如果 `src/layers/<effectId>Layer.js` 存在，scanner 會自動把它填進 manifest 的 `module` 欄位，main.js 的 `createLayer()` 就會 `import` 它並呼叫 `create()`，取代預設的 `BaseIframeLayer`（全螢幕背景、永遠疊在最底層）。這是 holographic（遮罩貼合 Frame1）、retroFilter（強制置頂、預設 click-through）在做的事 — 兩者都完全沒有碰 `index.html` 或 `main.js`。
4. **`src/main.js`／根目錄 `index.html` 幾乎永遠不用碰。** 唯一例外是新效果需要「跨渲染情境的全域協調」（目前唯一案例是 lottie 相對 Pixi 的 z-index 協調，`reconcileZIndex()`）—— 這種狀況非常少見，遇到才問使用者，預設假設不需要。

## 工作流程

### 0. 取得效果描述
如果呼叫時已經帶了描述（`args`），直接用。沒有的話就問使用者：這個效果看起來/動起來像什麼？（顏色、動態、互動方式、疊在畫面的哪裡）。不用追問到鉅細靡遺 — 合理的視覺判斷自己補，抓不準的只有下面第 3、4 步提到的「合成行為」和「要不要面板」兩件事才需要問。

### 1. 決定 `effectId`（資料夾名）
- 用小寫開頭的 camelCase（跟現有的 `holographic`、`checkerboard`、`retroFilter` 一致），不要用連字號或底線 —— `scan-assets.js` 的 `toId()` 不會幫你把連字號轉乾淨，資料夾名稱就直接等於 id。
- 建立 `UI/<effectId>/` 資料夾。

### 2. 決定效果的技術形態
- **渲染方式**：純 CSS/DOM 動畫（像 checkerboard 的 drift + clip-path glitch）？Canvas 2D？WebGL fragment shader（像 holographic）？依描述的視覺複雜度挑最省力的一種 — 簡單的漸層/粒子用 CSS 或 Canvas2D 就夠，需要 per-pixel noise/warp 才上 WebGL。
- **要不要可調面板**：預設要（sliders + color pickers，跟 holographic/retroFilter 一樣），因為使用者事後通常會想微調。只有使用者明講「不用面板，就這樣定案」才比照 checkerboard 做法：把參數烤成常數、不掛 `shared/state-sync.js`/`shared/panel.css`、HTML 裡不放 `#panel`/`#panel-toggle`。
- 参考骨架：[reference/skeleton/index.html](reference/skeleton/index.html)、[style.css](reference/skeleton/style.css)、[script.js](reference/skeleton/script.js)。複製到 `UI/<effectId>/` 後：
  - 把 `__EFFECT_TITLE__`/`__EFFECT_ID__` 之類的佔位字串換掉。
  - 沒有 canvas/WebGL 就整段刪掉 `shared/device-perf.js` 那行 script 和 `resize()`。
  - 不需要面板就整段刪掉 `shared/state-sync.js`/`shared/panel.css` 兩行、`#panel`/`#panel-toggle` 兩個元素、`makeSlider`/`saveState`/`loadSaved`/reset 按鈕那些程式碼。
  - 把 `frame()` 裡的 TODO 換成真正的視覺效果本體（shader / canvas 畫圖 / CSS class 切換）。
  - **這兩件事不管有沒有面板都一定要保留**：
    1. `addEventListener('message', ...)` 監聽 `ng-effect-pause`/`ng-effect-resume`，取消/重啟 rAF（`BaseIframeLayer` 只會把 iframe `display:none`，不會停掉裡面的 JS，見 [BaseIframeLayer.js](../../../src/layers/BaseIframeLayer.js)）。如果動態是 CSS `@keyframes` 驅動（不是 rAF），改成切換一個 `html.ng-paused { animation-play-state: paused }` 的 class（参考 [checkerboard/style.css](../../../UI/checkerboard/style.css) 的做法）。
    2. `viewport` meta tag 跟現有效果一致（`user-scalable=no`），避免手機上被使用者不小心縮放。

### 3. 決定合成行為 —— 需不需要自訂 layer 模組？
問自己（拿不準才用 `AskUserQuestion` 問使用者一句話）：這個效果應該
- **永遠在背景、疊在所有東西最下面** → 不用做任何事，讓 scanner 找不到 `src/layers/<effectId>Layer.js` 就會自動退回預設的 `BaseIframeLayer`。大多數「全螢幕氛圍特效」都是這種。
- **要貼合/遮罩到某個既有的圖片圖層**（像 holographic 貼 Frame 1 的輪廓）→ 寫 `src/layers/<effectId>Layer.js`，参考 [holographicLayer.js](../../../src/layers/holographicLayer.js) 的模式：`extends BaseIframeLayer`，用 CSS `mask-image` 貼目標圖層的 PNG，`manager.onChange`/`stage.onResize` 觸發 `_reposition()` 重新量目標 sprite 的螢幕座標，`export async function create(opts) { return new XLayer({ ...opts, src: `${opts.folder}/index.html` }); }`。
- **要蓋在所有東西最前面**（像 retroFilter 的鏡頭濾鏡）→ 参考 [retroFilterLayer.js](../../../src/layers/retroFilterLayer.js) 的模式：覆寫 `setZIndex()` 固定成一個比 lottie/pixi 都高的常數、預設 `pointer-events:none` 避免蓋住底下圖層的拖曳點擊、在 parent 端另外掛一顆永遠可點的小按鈕，用 `postMessage` 通知 iframe 內部切換自己的面板。
- 更完整的三種模式程式碼骨架看 [reference/custom-layer-patterns.md](reference/custom-layer-patterns.md)。

檔名務必是 `src/layers/<effectId>Layer.js`（`effectId` 要跟資料夾名完全一致，因為 `scan-assets.js` 的 `customModuleFor()` 是直接用資料夾轉出來的 id 去對檔名，見 [scan-assets.js:43-46](../../../scripts/scan-assets.js#L43-L46)）。

### 4. 讓 manifest.json 自動更新
跑：
```
node scripts/scan-assets.js
```
然後打開 `manifest.json` 確認 `effects` 陣列多了 `{ "id": "<effectId>", "label": "...", "folder": "UI/<effectId>" }`，如果第 3 步寫了自訂模組，這筆還要多一個 `"module": "layers/<effectId>Layer.js"`。

如果使用者本來就開著 `node scripts/dev-server.js` 在跑，這步可以跳過 —— dev-server 每次收到 `/manifest.json` 請求都會重新掃描並覆寫檔案（見 [dev-server.js:75-86](../../../scripts/dev-server.js#L75-L86)），使用者只要重新整理頁面就會看到新效果。

**不要手動編輯 `manifest.json` 或根目錄 `index.html` 的內容** — 這違反這個系統的設計前提，下一次 scanner 跑起來時手動改的東西也不會被保留。

### 5. 驗證
啟動（或確認已在跑）`node scripts/dev-server.js`，瀏覽器開 `http://localhost:8080/index.html`，確認：
- 右側 Layers 面板出現新效果，勾掉/打開 visibility 有作用。
- 拖曳圖層順序不會讓其他圖層跑版（背景特效本來就應該忽略順序，除非第 3 步刻意選了「貼合/置頂」）。
- 效果本身的小齒輪面板（如果有做）能開合、拉 slider 有即時反應、reload 後設定有記住（`state-sync` 有正常運作）。
- 切到背景分頁再切回來，特效的動畫沒有偷跑（pause/resume 有正常運作 — 可以在 devtools 開著 Performance/更簡單直接看 CPU 有沒有在分頁背景時繼續飆高）。

## 檔案總覽
- [reference/skeleton/](reference/skeleton/) — 新效果資料夾的起手骨架（index.html / style.css / script.js）。
- [reference/custom-layer-patterns.md](reference/custom-layer-patterns.md) — 三種合成行為（預設背景 / 貼合遮罩 / 強制置頂）的 `src/layers/*.js` 程式碼範例。
