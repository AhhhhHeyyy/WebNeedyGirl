# NeedyGirl 圖層系統說明書

一個純前端（無建置工具、CDN 載入）的多圖層合成器：把背景特效、圖片、Lottie 動畫都當成
可以在網頁 UI 上自由顯示/隱藏、拖曳、縮放、排序的「圖層」，並具備跨螢幕尺寸的 RWD 適應。

## 目錄

1. [快速開始](#1-快速開始)
2. [整體架構](#2-整體架構)
3. [資料夾結構](#3-資料夾結構)
4. [圖層系統核心（src/core）](#4-圖層系統核心srccore)
5. [三種圖層類型（src/layers）](#5-三種圖層類型srclayers)
6. [新增/刪除素材：manifest 工作流程](#6-新增刪除素材manifest-工作流程)
7. [新增一個「自帶效果」的圖層](#7-新增一個自帶效果的圖層)
8. [幫某個素材加自訂邏輯](#8-幫某個素材加自訂邏輯)
9. [儲存 / 重置佈局](#9-儲存--重置佈局)
10. [效能（手機/平板）](#10-效能手機平板)
11. [已知限制](#11-已知限制)

---

## 1. 快速開始

這個專案沒有 build step，但因為用了 ES module（`import`）和 `fetch`，**不能用雙擊直接開檔案**
（`file://` 會被瀏覽器擋掉），必須透過本地伺服器用 `http://` 開，而且伺服器要從**專案根目錄**
（`WebNeedyGirl`）啟動：

```bash
cd WebNeedyGirl
node scripts/dev-server.js
```

**推薦用這個內建的小型 Node 伺服器**，因為它每次收到 `manifest.json` 的請求都會重新掃描
`UI/`（見第 6 節），等於「加減素材、重新整理頁面就好」，不用再手動跑 `scan-assets.js`。
如果不想用 Node，也可以用其他任何靜態伺服器（例如 `python -m http.server 8080` 或
`npx serve -l 8080`），但這樣每次改動 `UI/` 之後都要記得手動跑一次
`node scripts/scan-assets.js` 才會反映到網頁上。

然後瀏覽器打開：

```
http://localhost:8080/index.html
```

右側齒輪圖示可以開關「LAYERS」面板：勾選框控制顯示/隱藏、▲▼ 排序、點圖層名稱會跳出
X/Y/Scale/Rotate 滑桿，也可以直接在畫面上拖曳選取中的圖層。

- **🔓/🔒 鎖定圖層**：每一列旁邊的鎖頭按鈕可以鎖定該圖層——鎖定後這個圖層不會被滑鼠拖曳
  或縮放把手影響（連同滑桿跟方向鍵微調也一併停用），適合排好版位後防止手滑誤動。再點一次
  解鎖即可恢復可拖曳/可縮放。鎖定狀態會跟著版位一起存進「💾 Save Layout」。
- **方向鍵微調位置**：選取一個圖層（點面板上的列，或直接點畫面上的圖）之後，按 ← → ↑ ↓
  可以每次移動 1px，按住 Shift 再按方向鍵則是每次 10px，方便做像素級的微調。輸入框/滑桿
  正在輸入時方向鍵不會被搶走；圖層鎖定時方向鍵也不會生效。

## 2. 整體架構

```
z-index 0    #bg-effect-layer   ← 自帶效果的背景特效（iframe，例如 UI/holographic）
z-index 5/20 #lottie-layer      ← lottie-web 動畫（依排序疊在 Pixi 上或下）
z-index 10   #pixi-stage        ← Pixi.js 圖片圖層（所有靜態圖片）
z-index 20+  #panel             ← 圖層管理面板
```

每一種圖層都活在**自己獨立的渲染 context**（iframe / Pixi canvas / lottie-web canvas），
彼此不共用 GPU 狀態、不互相污染參數。這是刻意的設計，不是三種技術湊出來的意外。

`index.html` 只是一個「殼」：它掛載三個容器 + 面板 UI，實際的圖層邏輯全部由
`src/main.js` 在執行期讀取 `manifest.json` 動態建立——**`index.html`/`main.js` 裡完全沒有
任何一個素材的檔名**，這樣才能「加減圖片不用改程式碼」。

`manifest.json` 刻意放在**專案根目錄，不是 `UI/` 裡面**——它是整套流程中唯一一個「你不會手動
編輯，但長得跟其他檔案一樣」的檔案，放在 `UI/` 裡很容易在整理素材時被不小心一起拖進某個子
資料夾（真實發生過一次），manifest 一消失、整個網頁就變空白。放在 `UI/` 之外、你不會去動的
地方，就不會再被這樣誤傷。

## 3. 資料夾結構

```
WebNeedyGirl/
  index.html              ← 總控台頁面（容器殼 + 面板 UI，開這個檔案）
  manifest.json            ← 自動產生，main.js 唯一讀的清單，不要手動編輯、
                              也不要搬進 UI/ 裡
  shared/
    panel.css              ← 面板/滑桿/按鈕的共用樣式，被 index.html 跟每個效果資料夾共用
  UI/                       ← 所有素材放這裡（唯一需要手動維護的地方）
    SpineAngel.spine.gif    ← 純圖片（PNG/JPG/GIF/WEBP，動畫 GIF 見第 10 節）
    holographic/             ← 自帶效果的資料夾（有 index.html，見第 7 節）
      index.html
      style.css
      script.js
    heading/                 ← 分組資料夾（沒有 index.html，見第 5/6 節）：
      heading.png              裡面每張圖各自是圖層，但資料夾本身也是一個
      button.png                可以整組拖曳/縮放的圖層
      ...
  scripts/
    scan-assets.js          ← 掃描 UI/ 的核心邏輯，可單獨執行，也被 dev-server.js 呼叫
    dev-server.js           ← 推薦的本地伺服器，每次請求 manifest.json 都自動重新掃描
  src/
    main.js                 ← 進入點：讀 manifest.json、動態建立所有圖層
    core/
      Stage.js               ← Pixi renderer + 固定邏輯座標(1920×1080)的 RWD 縮放
      LayerManager.js         ← 圖層 registry（新增/移除/排序/存讀佈局快照）
      DragTransform.js         ← 拖曳移動 + 角落把手縮放，所有圖片圖層共用
    layers/
      BaseImageLayer.js        ← 通用引擎：靜態圖片圖層
      BaseLottieLayer.js        ← 通用引擎：Lottie 動畫圖層
      BaseIframeLayer.js        ← 通用引擎：自帶效果的 iframe 圖層
      GroupLayer.js            ← 通用引擎：資料夾分組圖層（內部用 BaseImageLayer 當子圖層）
      （之後若某素材需要自訂邏輯，寫在這裡，見第 8 節）
    ui/
      LayerPanel.js            ← 「LAYERS」面板：可見性/排序/滑桿 UI
```

## 4. 圖層系統核心（src/core）

- **`Stage.js`**：建立一個 Pixi.Application，內部用**固定邏輯座標** `LOGICAL_W=1920,
  LOGICAL_H=1080`。所有圖片圖層的 x/y/scale 都以這個座標系記錄；換螢幕尺寸時只縮放整個根容器
  （`Math.min(innerWidth/1920, innerHeight/1080)`），不必重算每個圖層的座標——這就是 RWD
  適應的核心公式。DPR（螢幕解析度）上限透過 `shared/device-perf.js` 依螢幕寬度動態決定
  （見第 10 節），避免高解析度手機/平板讓多個 GPU context 一起爆量。

- **`LayerManager.js`**：所有圖層（不管是圖片/Lottie/iframe）的統一 registry。提供
  `add/remove/reorder/setVisible/setTransform`，以及 `getSnapshot()/applySnapshot()`
  （整組佈局的存讀，給「儲存/重置佈局」按鈕用）。UI 面板只透過這個物件跟圖層溝通，不會直接碰
  個別圖層。

- **`DragTransform.js`**：滑鼠拖曳移動 + 四角把手縮放的共用邏輯，掛在任何 Pixi Sprite 上就能
  互動。所有圖片圖層都共用同一份實作，不必每個素材各自重寫拖曳程式碼。

## 5. 四種圖層類型（src/layers）

| 類型 | 引擎 | 用在哪 | 支援拖曳/縮放？ |
|---|---|---|---|
| `image` | `BaseImageLayer.js` | UI/ 裡的圖片檔（含動畫 GIF，見第 10 節） | 可以 |
| `lottie` | `BaseLottieLayer.js` | UI/ 裡的 Lottie JSON | 可以（用 CSS transform） |
| `effect` | `BaseIframeLayer.js` | UI/ 裡「自帶 index.html」的資料夾 | 不行，只有顯示/隱藏 |
| `group` | `GroupLayer.js` | UI/ 裡「沒有 index.html」的資料夾 | 整組可以，組內每張圖也各自可以 |

`effect` 類型刻意不支援拖曳縮放：它是一整個獨立網頁（自己的 shader、自己的控制面板），
定位是全螢幕背景特效,不是可以自由擺放的小圖。

`group` 類型是「資料夾內每張圖各自還是獨立圖層（可各自顯示/隱藏/拖曳/縮放/排序），但資料夾
本身也是一個圖層（拖曳/縮放資料夾會帶著裡面所有圖一起動，維持彼此的相對位置）」——面板上會看到
資料夾自己一列，底下縮排列出每張圖各自一列。如果資料夾裡還有 Lottie（`.json`），因為 Lottie
是獨立的 DOM 元件、沒辦法變成 Pixi 容器的子物件，會被拉出來變成一個獨立的頂層 `lottie` 圖層
（label 會顯示成「資料夾名 / 檔名」），不會跟著資料夾一起拖曳縮放。

## 6. 新增/刪除素材：manifest 工作流程

根目錄的 `manifest.json` 是 `main.js` 唯一讀取的清單，**不要手動編輯，也不要搬進 `UI/` 裡**。

**如果是用 `node scripts/dev-server.js` 開的（第 1 節推薦的方式）**：什麼都不用做。它每次收到
`manifest.json` 的請求都會重新掃描一次 `UI/`，加圖、刪圖、重新分組資料夾之後，重新整理頁面
就會反映最新狀態。

**如果是用別的靜態伺服器**（`python -m http.server`、`npx serve` 等）：這些伺服器不知道要重新
掃描，所以每次改動 `UI/` 之後要手動跑一次：

```bash
node scripts/scan-assets.js
```

（`scripts/dev-server.js` 內部其實也是呼叫 `scripts/scan-assets.js` 裡的同一套掃描邏輯，只是
自動幫你在每次請求前先跑一遍。）

不管哪種方式，掃描邏輯都一樣，它會：
- 把 `UI/` 裡每一張圖片（`.png/.jpg/.jpeg/.gif/.webp`）列進 `images`
- 把每個 `.json` 檔列進 `lottie`
- 把每個「裡面有 `index.html`」的子資料夾列進 `effects`（見第 7 節）
- 把每個「裡面沒有 `index.html`」的子資料夾列進 `groups`，並掃描該資料夾內的圖片/Lottie
  （見第 5 節的 `group` 類型）
- 檔名自動轉成 `id`（給程式用）跟 `label`（給面板顯示用），例如 `Group 14.png` → id
  `group14`、label `Group 14`；資料夾內的檔案 id 會加上資料夾名稱當前綴避免撞名
  （例如 `heading/button.png` → id `heading.button`）

**工作流程就是**：在 `UI/` 裡加圖、刪圖、丟一個新的效果或分組資料夾 → 跑一次上面這行指令 →
重新整理頁面,新素材就出現在面板裡了,完全不用碰 `main.js` 或任何程式碼。

> 如果想要某張圖有更好看的顯示名稱，把檔名取好一點就好（label 是直接從檔名轉出來的，
> 例如 `heading-1.png` 會變成 `Heading-1`）。

## 7. 新增一個「自帶效果」的圖層

像 `UI/holographic/` 這種有自己 shader、自己控制面板的完整效果，慣例是：

```
UI/我的新效果/
  index.html   ← 引用 ../../shared/panel.css（共用面板樣式）+ ./style.css
  style.css    ← 只屬於這個效果的樣式
  script.js    ← 只屬於這個效果的邏輯
```

做好之後一樣跑 `node scripts/scan-assets.js`，它會被自動偵測成 `effects` 類型的圖層。
這個資料夾也可以整個複製到別的專案重用，因為它完全自包含，不依賴專案其他地方的程式碼
（只吃 `shared/panel.css` 這一份共用樣式，換專案時把這個檔案也一起複製過去即可）。

## 8. 幫某個素材加自訂邏輯

大部分素材只是單純顯示（用第 5 節的通用引擎就夠），但如果某個素材要加自訂行為
（例如：遮罩、眨眼互動、跟著滑鼠動），做法是：

1. 在 `src/layers/` 建立 `<id>Layer.js`（`id` 要跟 manifest 裡那個素材的 `id` 一致，
   例如 `eye.png` 的 id 是 `eye`，檔名就要是 `eyeLayer.js`）
2. 裡面 export 一個 `create(opts)` 函式，`opts` 會拿到 `{ id, label, file/folder, stage,
   container }`，你可以在裡面呼叫 `BaseImageLayer.create(...)` 拿到基本圖層，再疊加自訂邏輯
   （例如用 `layer.setMask(maskSprite)` 掛遮罩），最後回傳這個圖層物件
3. 重新跑 `node scripts/scan-assets.js`——腳本會自動偵測到這個檔案存在，manifest 裡該素材
   的條目會多一個 `"module": "layers/eyeLayer.js"`，`main.js` 之後就會改用你這支自訂檔案，
   不會再用通用引擎

完全不用改 `main.js`。

## 9. 儲存 / 重置佈局

面板最下面的「💾 Save Layout」會把目前所有圖層的順序/顯示狀態/位置/縮放/旋轉存進瀏覽器的
`localStorage`；重新整理頁面會自動讀回上次存的佈局。「↺ Reset」清掉存檔，還原成程式預設的
初始安排。

## 10. 效能（手機/平板）

因為最終會在手機/平板上播放，系統內建幾個針對性的效能優化：

- **動畫 GIF 支援**：`.gif` 圖片透過 `@pixi/gif`（`index.html` 裡的 CDN script）解碼成
  `AnimatedGIF`，會在畫面上真的播放動畫，不是只顯示第一張畫格。`BaseImageLayer` 會自動判斷
  載入結果是靜態 `Texture` 還是 `AnimatedGIF`，兩種都用同一套拖曳/縮放邏輯。
- **隱藏的圖層會暫停，不會繼續耗電**：面板裡把某個 GIF/Lottie 圖層關掉顯示時，會連同呼叫
  它的 `pause()`（GIF 呼叫 `sprite.stop()`，Lottie 呼叫 `anim.pause()`），不是只有 CSS 蓋住，
  背景仍在解碼播放。重新打開顯示才會 `resume()`。
- **切到背景分頁/其他 App 時整組暫停**：`src/main.js` 監聽 `visibilitychange`，分頁不可見時
  停掉整個 Pixi ticker（`stage.app.ticker.stop()`）跟所有圖層的 `pause()`；回來時只恢復本來
  就是顯示狀態的圖層，不會把使用者手動關掉的圖層打開。
- **解析度依螢幕寬度動態調整**：`shared/device-perf.js` 提供 `window.getPerfResolutionCap()`，
  螢幕寬度 ≤1024px（手機/平板)時把解析度倍率壓到 1.5，比桌面版的 2 省一截 GPU 用量。
  Pixi stage 跟每個 `UI/<name>/` 自帶效果資料夾的自訂 resize() 都呼叫這個共用函式，新增效果資料夾時
  記得也套用同一支（參考 `UI/holographic/script.js` 的 `resize()` 怎麼用）。
- **除錯用**：瀏覽器 console 打 `window.__needyGirl` 可以拿到 `{ stage, manager }`，方便直接
  戳圖層狀態（例如 `__needyGirl.manager.layers` 列出所有圖層、`.sprite.playing` 看 GIF 是否在播放）。

## 11. 已知限制

- **localStorage 只在同一台電腦、同一個瀏覽器有效**——換瀏覽器/換電腦/清瀏覽器資料都會不見。
  如果之後需要「存成檔案帶著走」，可以再加匯出/匯入 JSON 的功能。
- **多張滿版不透明圖片疊在一起時，直接在畫面上拖曳只會抓到最上層那張**，不一定是面板裡選取
  的那層——這跟 Photoshop 沒鎖圖層時一樣。之後素材做了透明/遮罩處理後這個問題會自然緩解。
- **`effect` 類型的圖層（iframe）不支援拖曳縮放**，只有顯示/隱藏；如果它自己內部有滑鼠互動
  （例如 holographic 的滑鼠漣漪特效），被其他不透明圖層蓋住的區域滑鼠事件會進不去，這是
  iframe 隔離架構本身的限制，不是 bug。
- **`manifest.json` 是自動產生的檔案**，重新跑掃描腳本會整份覆蓋重寫——如果手動改過它，
  下次跑腳本會被蓋掉。
- **如果畫面正中間跳出一個深色訊息框說讀不到 `manifest.json`**：代表這個檔案不見了或路徑不對
  （最常見原因是整理 `UI/` 資料夾時不小心把它一起拖進某個子資料夾）。確認專案根目錄
  （跟 `index.html` 同一層）有沒有 `manifest.json`，沒有的話跑 `node scripts/scan-assets.js`
  重新產生就會恢復。
- **大張多畫格透明 GIF 很吃記憶體**（畫格數 × 解析度 × 4 bytes 全部要解碼進記憶體），目前
  兩隻 SpineAngel 動畫沒問題，但同時疊很多張這種大型動畫角色 GIF 時，記憶體/效能可能會有感。
  真的遇到的話可以考慮把來源 GIF 降解析度/減畫格數，或做懶載入（不在畫面上就不載入）。
- **`group` 資料夾裡每張圖的預設位置都是資料夾原點 (0,0)**，掃描腳本不知道圖片彼此該怎麼
  排版，所以尺寸差很多的圖（例如一張全版底圖配好幾個小圖示）第一次載入會全部疊在正中間——
  這是預期行為，用面板把每張圖拖到該在的位置，再對整個資料夾按 Save Layout 存起來即可，
  之後就會照存好的樣子還原。
