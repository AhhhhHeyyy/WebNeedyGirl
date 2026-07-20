# NeedyGirl WebNeedyGirl — Design Doc

前端純靜態、無建置工具的多圖層即時合成系統（虛擬桌寵/角色場景）。所有視覺效果（shader 背景、靜態圖、GIF、Lottie、Spine 骨骼動畫）都被抽象成統一的「圖層（Layer）」，可即時顯示/隱藏、拖曳、縮放、旋轉、排序——像是把 Photoshop 圖層堆疊做成一個即時渲染的網頁，且編輯功能就內建在正式運行環境中，不是獨立的編輯器。

---

## 1. 視覺設計風格

存在兩種明顯不同的視覺語彙：

### 1.1 控制面板 UI（chrome）
- 位置：`shared/panel.css`，套用在 LAYERS 側欄、各效果自己的調整面板上。
- 風格：毛玻璃霧面卡片（`backdrop-filter: blur(24px) saturate(175%)`）。
- 主色：粉紫藍漸層 `linear-gradient(168deg, #ffd8ea → #e8deff → #d4e8ff)`（粉紅→薰衣草紫→天空藍），滑桿把手同色系漸層（`#f4b8d8 → #c8b8f2 → #b8d8f4`）。
- 文字：紫色系 `#7862a8` / `#7060a0`。
- 按鈕：圓角膠囊形。
- 字型：系統 UI 字型堆疊 + CJK 用 `"PingFang TC"` / `"Microsoft JhengHei"`；另有自訂像素/復古顯示字型 `font/Silver.ttf`（`@font-face 'Silver'` / `'NGChatSilver'`），用於載入畫面與聊天室 UI。
- 沒有全域 design-token / 主題系統，顏色多半直接寫死在各檔案裡（典型的無建置工具專案）；但載入畫面與旋轉提示都重用同一組粉→紫→藍漸層，形成實質上的品牌色。

### 1.2 場景效果內容（content）
- 復古 / CRT / 故障藝術 / 全息風格：掃描線、暗角、色差、VHS 顆粒與閃爍、8-bit 像素滑鼠游標、動態棋盤格故障背景、WebGL 漩渦全息 shader 加閃光粒子。

---

## 2. 架構

### 2.1 三層獨立渲染上下文（CSS z-index 疊合，由 `src/main.js` 協調）

```
z-index 0     #bg-effect-layer   — 全螢幕背景效果 <iframe>（holographic、checkerboard 等基底）
z-index 5/20  #lottie-layer      — lottie-web canvas（若為最上層時會被拉到前面）
z-index 10    #pixi-stage        — PixiJS canvas（所有靜態圖 / GIF / Spine 圖層）
z-index 11/12 DOM overlay        — 聊天訊息列表(11) / 聊天邊框(12)，真實 DOM，掛在 #stage-area 內
z-index 15    holographic(條件)  — 當 "frame1" 為目前最上層圖層時被拉到前面
z-index 20+   #panel             — 圖層管理側欄
z-index 22    stickerList        — 貼圖列/欄 overlay，僅在為最上層圖層時被拉到前面
z-index 25    retroFilter        — 恆定最前的後製濾鏡（鏡頭疊層）
z-index 26    man popup          — 恆定高於 retroFilter
z-index 27    pixelCursor        — 恆定絕對最前（不可被任何東西遮住）
```

三種基礎渲染型態（iframe / Pixi canvas / lottie-web canvas）刻意互相隔離，不共享 GPU 狀態、不跨 context 混排 sprite。若某圖層需要視覺上「夾」在兩個 context 之間（例如聊天訊息要夾在聊天板 Pixi 填色與聊天邊框之間），做法是用真實 DOM 元素貼齊 Pixi sprite 的即時螢幕座標（`src/layers/domSpriteOverlay.js`），而不是混合渲染技術。

### 2.2 啟動流程（`src/main.js`）
1. 建立 `Stage`（Pixi app）與 `LayerManager`。
2. `prewarmRendererPool()`：預先建立 2 個備用 `PIXI.Renderer`，供 Nested-Scene-3 彈窗使用（在載入畫面還擋著輸入時就先做）。
3. 抓取 `manifest.json`；失敗時顯示 `#boot-error`。
4. 建立 `LayerPanel` 與 `PopupTuningPanel`。
5. 對每個 manifest 項目呼叫 `createLayer(kind, entry)`：若 manifest 宣告 `"module"` 則動態 `import()` 對應的 `src/layers/<id>Layer.js`；否則 fallback 到四種通用引擎之一（`BaseImageLayer` / `BaseLottieLayer` / `BaseIframeLayer` / `GroupLayer`）。
6. `Promise.all` 併發載入全部圖層，更新載入 `%`。
7. 所有 GIF/動畫幀同步重置到第 0 幀，避免載入過程產生的錯位。
8. 擷取 `defaults = manager.getSnapshot()`，再套用已儲存的版面（若有）。
9. `initMobileWiden()` 在窄螢幕上水平拉伸 Frame1 + 聊天。
10. 綁定全域 `#stage-area` 點擊事件（生成 Nested-Scene-3 彈窗 / 觸發 "man" 彈窗）。
11. 固定 600ms 緩衝停留後，載入畫面淡出。
12. `visibilitychange`：分頁切到背景時暫停/恢復整個 Pixi ticker 與每個圖層。

### 2.3 核心模組（`src/core/`）

| 檔案 | 職責 |
|---|---|
| `Stage.js` | PixiJS `Application` 包裝；固定邏輯座標系 `1920×1080`；`resize()` 只縮放根容器（`Math.min(w/1920, h/1080)`），讓各圖層變換不需感知視窗尺寸；解析度上限透過 `shared/device-perf.js` 控管 |
| `LayerManager.js` | 所有圖層（image/lottie/iframe/group/spine）的中央註冊表；`add/remove/reorder/setVisible/setTransform/setLocked`；`getSnapshot()/applySnapshot()` 供存檔/重置；group 的子項可透過 `get(id)` 直接取得 |
| `DragTransform.js` | 所有可拖曳 Pixi sprite/container 共用的「拖曳移動 + 角落把手縮放」邏輯；繪製選取框與縮放把手；支援 per-layer 鎖定狀態 |
| `mobileWiden.js` | 在矮寬（窄）視窗上，非等比水平拉伸 Frame1 與聊天群組（絕不垂直拉伸）以填補左右留白，兩者間距保持固定 |

### 2.4 圖層引擎（`src/layers/`）

| 類型 | 引擎檔 | 說明 |
|---|---|---|
| `image` | `BaseImageLayer.js` | 靜態 PNG/JPG/WEBP 或動態 GIF（透過 `@pixi/gif`）；內含 `DragTransform` |
| `lottie` | `BaseLottieLayer.js` | lottie-web canvas，獨立 `<div>`，用 CSS transform 定位/縮放；自帶拖曳邏輯（非 Pixi，故不用 `DragTransform`） |
| `effect` | `BaseIframeLayer.js` | 把獨立的 `UI/<name>/index.html` 資料夾包成同源 `<iframe>`；透過 `postMessage` 廣播 `ng-effect-pause/resume` 與 `ng-perf-tier`；不可拖曳/縮放，僅能切換顯示 |
| `group` | `GroupLayer.js` | 把沒有 `index.html` 的 `UI/<folder>/` 包成單一可拖曳/縮放的 `PIXI.Container`，內含多個子 `BaseImageLayer`（巢狀 sprite）；group 內的 Lottie 檔會被升級為獨立頂層 lottie 圖層 |
| `spine` | `BaseSpineLayer.js` | pixi-spine `Spine` 顯示物件包裝（與 `BaseImageLayer` 對等）；用於兩個 SpineAngel skin |

每個 manifest 項目若需要特製行為，會有對應的自訂模組（`src/layers/*Layer.js`，繼承上述引擎之一）——這是官方文件化的擴充點（見 README §8），也是 `new-effect-layer` skill 的 scaffold 模式所依循的架構。

### 2.5 manifest.json 目前的場景圖
- **images**：`frame1`、`frame1B`、`listStickers`（自訂模組）、`spineAngelASpine` / `spineAngelDSpine`（Spine，skin 分別為 "Angel" / "dark"）
- **effects (iframe)**：`checkerboard`、`holographic`、`man`、`pixelCursor`、`retroFilter`、`stickerList`
- **groups**：`chat`（chatB 邊框 + chatboard 填色）、`dark`（dark.png + Nested Scene 3 Lottie）、`eye`（窗戶連續開闔）、`heading`（boarding/button/heading/heading3）、`live`（3-line + 搜尋列）
- **lottie**：頂層無獨立項目（Nested Scene 3 位於 `dark` group 內部，會被自動升級）

---

## 3. 目前已實作的互動方式

### 3.1 全域舞台互動（`src/main.js`）
- **點擊 Frame1 內部 → 生成 Nested Scene 3 彈窗**：在 Frame 1 範圍內（且不在貼圖列上）點擊，會在點擊位置生成一個獨立、用完即丟的 Lottie「視窗」彈窗（`spawnNestedScene3Popup`，`src/layers/nestedScene3PopupSpawner.js`），每個彈窗都有自己的池化 mini `PIXI.Renderer`，透過視窗內容區即時鏡射顯示 SpineAngel "dark" skin 的動畫裁切畫面。播放一次後自我銷毀；重複點擊會疊加多個獨立實例。用真正的三次貝茲曲線緩動求解（`bezierEase()`）去對齊 Lottie 本身開闔擦拭動畫的時間曲線。
- **點擊 Frame1 外部 → "man" 彈出圖**：任何落在 Frame 1 外（且非貼圖列）的點擊會透過 `postMessage` 轉發給恆定最前、點擊穿透的 `man` iframe（`src/layers/manLayer.js`），在點擊位置以 CSS 關鍵影格動畫彈入一張裝飾圖。
- **分頁可見性暫停/恢復**：`visibilitychange` 會真正停止/啟動整個 Pixi ticker，並呼叫每個圖層的 `pause()/resume()`——是真的省 CPU/GPU，不只是 CSS 隱藏。
- **面板驅動的圖層編輯**：顯示勾選框、▲/▼ 排序、🔒/🔓 鎖定切換、點擊選取後出現 X/Y/縮放/旋轉滑桿，與畫布上的拖曳即時雙向同步（`src/ui/LayerPanel.js`）。
- **方向鍵微調**：選取（且未鎖定）的圖層每按一次方向鍵移動 1 邏輯像素，按住 Shift 為 10 像素；輸入框打字時自動抑制，並遵守鎖定狀態。
- **拖曳移動 + 角落把手縮放**：所有 Pixi 的 image/group/spine 圖層皆支援（`src/core/DragTransform.js`）；Lottie 圖層有自己對等的拖曳實作。
- **儲存/重置版面**：💾 按鈕會將完整排列（順序、顯示、變換、鎖定、group 子項）快照存入 `NeedyGirlState`/localStorage；↺ 還原為開機時的預設值。
- **載入畫面**：在所有圖層載入完成、GIF 幀同步、已存版面套用完畢、並經過固定 600ms 緩衝之前，會阻擋所有指標輸入——避免第一次點擊落在還沒暖機完成的場景上。
- **手機直向旋轉提示**：CSS media query（`orientation: portrait` + `max-width:1024px`）顯示「請旋轉」疊層，而非用 CSS transform 假造橫向（那樣會讓 Pixi 的 hit-testing 失準）。
- **手機版面**：圖層編輯側欄在 `max-width:1024px` 下完全隱藏——手機上面板控制僅供檢視，但畫布內互動（貼圖列、man 彈窗、游標）仍依各自的行動裝置邏輯繼續運作。

### 3.2 像素游標（`UI/pixelCursor/`）
- 自訂 8-bit 點陣箭頭游標取代作業系統游標，作用範圍為 `#stage-area`（全域 `cursor: none`）。
- 游標視覺**預先烘焙成 `cursor.webm`**（透過 `scripts/bake-pixel-cursor.js`）——一段循環播放的帶 alpha 通道影片——因此即時游標完全不需要逐幀 canvas 重繪，每幀只更新 CSS `transform: translate3d(...)` 位置（純合成層開銷，非常便宜）。
- **位置平滑**：使用 One-Euro Filter（Casiez et al. 2012），移動時貼近原始指標、靜止附近才平滑，並將最終位置吸附到最近的裝置像素，避免搭配 `image-rendering: pixelated` 時出現次像素閃爍。
- **殘影拖尾**（預設關閉，可切換）：依距離取樣過去位置佇列，渲染成模糊、透明漸淡的游標剪影（在離屏 sprite 上套用 canvas `blur()` 濾鏡），數量/間距/淡出時間/顏色皆可調。
- **磁吸貼圖列圖示**：當真實指標接近貼圖列圖示時，繪製出的游標位置會吸附到該圖示上（`StickerListLayer.getSnapPoint`），確保游標視覺上「停在」某圖示時，該處點擊必定會命中。
- **行動裝置自動隱藏**：視窗寬度 ≤1024px，或主要輸入裝置不是精準滑鼠（`(pointer: fine) and (hover: hover)`）時隱藏——這個條件涵蓋了單靠寬度判斷會漏掉的觸控平板（如 iPad Pro）。
- 使用 `pointerrawupdate`（Chromium）搭配 `pointermove` 取得更低延遲的取樣；透過同源直接函式呼叫（`window.__ngSetPointer`）將位置轉發進點擊穿透的 iframe，`postMessage` 作為 fallback。

### 3.3 全息效果（`UI/holographic/`）
- 完整 WebGL fragment shader 漩渦/放射效果（fbm 雜訊、多中心漩渦、色相循環、星形閃光），以 CSS mask 精準裁切成 Frame 1 的畫面輪廓，並每幀跟隨 Frame 1 的即時拖曳/縮放/旋轉重新定位。
- **滑鼠/觸控漣漪**：由於此 iframe 不一定在最上層，指標位置由父層轉發進來，驅動 shader 的 `u_mouse` uniform（漩渦以 lerp 平滑追蹤指標）。
- 前/後排序會根據 "frame1" 目前是否為最上層圖層動態切換。

### 3.4 棋盤格效果（`UI/checkerboard/`）
- 靜態 SVG 棋盤格底圖（固定 7×7 網格），純 CSS `@keyframes` 持續斜向漂移（零 JS 開銷）。
- **故障效果**：JS 驅動的 rAF 迴圈，每約 45–100ms 重新隨機化 RGB 通道位移「切片帶」偏移（持續微雜訊），並每隔數秒疊加較大幅度的扭曲/旋轉「震動」尖峰——是此效果中唯一仍由 JS 驅動的部分（刻意保留，因為需要真正的隨機性）。
- **FPS 自適應效能分級**：透過 `BaseIframeLayer` 監聽 `shared/perf-monitor.js` 廣播的 `{type:'ng-perf-tier', tier}`，據此限制自身的帶狀數量/剪裁寫入頻率；在 `off` 分級時 JS 故障迴圈完全停止，只留下零成本的 CSS 漂移。這是目前**唯一**接上效能分級系統的效果。

### 3.5 復古濾鏡（`UI/retroFilter/`）
- 恆定最前、預設點擊穿透的全螢幕「相機鏡頭」後製效果：掃描線、暗角、色調、顆粒、閃爍——五種效果各自可獨立切換，並附色彩選取器與透明度滑桿。
- **掃描線粗細/間距隨視窗高度縮放**（`scanlineMetrics()`，以 800px 為參考 → 1px 線寬/2px 間距），在手機與桌面上維持一致的相對密度觀感；視窗縮放時重新套用。
- 顆粒與閃爍動態使用純 CSS keyframes；只有透明度由 JS 驅動。
- 父層頁面上有一個恆定可點擊的「📼」代理按鈕，用來切換 iframe 內部面板（因為此 iframe 預設 `pointer-events:none`，避免吞掉舞台的點擊/拖曳）。

### 3.6 貼圖列（`UI/stickerList/`）
互動密度最高的子系統：
- **看板 hover 抬升彈出**（`ListStickersLayer` 繼承 `BoardAnchoredLayer`）：滑鼠懸停時，「listStickers」看板 sprite 以 `easeOutBack` 彈簧動畫向上抬升（開啟約 420ms / 關閉約 320ms），滑出後落回。
- **觸控長按釘選**：觸控裝置沒有真正的 hover，改用約 450ms 長按（手指移動超過 12px 即取消）抬升並「釘住」看板開啟；點擊看板範圍外任何位置即關閉。
- **貼圖圖示列**（渲染在獨立的全螢幕點擊穿透 iframe 內，`UI/stickerList/script.js`）：5 個可點擊圖示，各自有隨機固定的 hover 傾斜角（`--hover-rot`）、遮罩至貼圖本身 alpha 的彩虹漸層 hover 色調，以及點擊時的「果凍」擠壓/拉伸彈跳動畫（`sl-jelly-bounce` keyframes）。
- **命中測試完全在父文件中進行**（非 iframe 內）：window 層級的 `pointermove`/`click` 監聽器根據每個圖示回報的最新螢幕矩形做命中測試（iframe 透過 `postMessage` 回報矩形），因為從父層角度看 `<iframe>` 的 `pointer-events` 只能整體開/關。
- **單一圖示的觸控長按 hover**：約 450ms 長按顯示與桌面 mouseover 相同的 `.hovering` 姿態；手指放開立即恢復。
- **磁吸命中半徑**（`SNAP_RADIUS_PX = 30`）：允許指標較寬鬆地接近圖示而不需像素級精準；由點擊命中測試與像素游標的視覺吸附（`getSnapPoint`）共用，確保游標「停在」圖示上時點擊必定會命中。
- **手機死區**（`DEAD_ZONE_PADDING_PX = 28`）：擴大 5 個圖示聯集命中框，避免手指誤差導致點擊穿透到背後的東西（例如 "man" 彈窗）。
- **窄螢幕/行動裝置版面**：當視窗兩側留白寬度超過圖示欄自身寬度時，圖示列會從 Frame 1 下方的水平列切換成浮動在該留白處的垂直欄（圖示放大、更適合觸控，`MOBILE_ICON_SCALE = 1.5`）。
- **點擊生成掉落貼圖分身**：點擊貼圖圖示會生成一張全尺寸分身圖，先以彈簧式「彈入」（`easeOutBack`），接著套用真實拋體物理（重力 1400 px/s²、隨機向上拋出初速、隨機旋轉）直到掉出畫面底部；可同時存在無限多個分身，共用同一個 rAF 迴圈（只在至少一個分身存活時運作）。
- 分身大小會依較小/行動裝置視窗等比縮小（`cloneScale`，上限為 1），避免看起來過大。

### 3.7 眼睛窗戶連續開闔（`UI/eye/`）
- 純自主動畫迴圈（不需任何使用者輸入）：2–5 份 `eye.png` 依序斜向連續開啟，每份都有各自獨立的 `eye-screen.webm` 眨眼影片透過遮罩螢幕區播放，停留後再依相反順序關閉，接着移動到新的隨機鄰近位置並無限重複。每個循環會重新隨機決定窗戶數量、連續開闔方向、與移動偏移量。

### 3.8 聊天面板（`UI/chat/`）
- 真實 DOM（非烘焙進 PNG）訊息列表 + 輸入列，被夾在聊天板的 Pixi 填色與另一張獨立的 Pixi 邊框素材之間（兩者都透過 `attachDomOverlay` 升級為 DOM overlay，才能與畫布無法直接混排的 DOM 訊息內容互相疊層）。
- **老式網頁捲動吸附**：一次一列（`scroll-snap-type: y mandatory`），隱藏原生捲軸，改用自繪捲軸滑塊並與實際捲動位置同步。
- **滑鼠滾輪劫持**：所有 wheel 事件都會 `preventDefault()`，改為瞬間跳到上/下一列（無平滑慣性捲動），保留「老式網頁」的吸附手感。
- **可拖曳捲軸滑塊**：使用 Pointer Events（滑鼠+觸控統一處理）支援拖曳，放開時吸附到最近一列。
- **聊天輸入**：輸入文字後按 Enter 或點擊送出圖示，會新增一筆訊息列並自動捲動到該處。
- 所有字型/內距會依聊天板實際拖曳/縮放後的尺寸，透過 CSS 自訂屬性 `--ng-u`（sprite 即時寬度 ÷ 原生參考寬度）等比縮放。
- 聊天 overlay 內的 `mousedown`/`click` 會阻止冒泡，避免打字時同時觸發全域舞台點擊而誤生成 Nested-Scene-3 彈窗。

### 3.9 跨切面的效能驅動行為（仍是使用者可感知的行為）
- **FPS 自適應效能分級**（`shared/perf-monitor.js`）：在頂層文件量測真實幀率（EMA 平滑），推導出 `off/low/medium/high` 其中一級，廣播給每個效果 iframe；效能變差時快速降級（持續 1.5 秒）、變好時緩慢升級（持續 4–8 秒），並有滯後死區（45–55fps）與全域 2 秒變更冷卻，避免頻繁抖動。目前只有 `checkerboard` 真正對此做出反應。
- **解析度/DPR 上限**（`shared/device-perf.js`）：`Stage.js`、`pixelCursor`、`holographic` 共用；視窗寬度 ≤1024px 時裝置像素比上限為 1.75，並另外將 canvas 最長邊限制在 ≤2600px（同時保護高密度桌面顯示器如 4K/5K）。
- **背景分頁暫停**：每個效果 iframe 會監聽 `ng-effect-pause`/`ng-effect-resume` postMessage（在 `visibilitychange` 與圖層顯示切換時發送），並真正停止自己的 rAF/解碼迴圈，而非只是 CSS 隱藏。

---

## 4. 效果圖層總覽

| 圖層（manifest id） | 資料夾 | 類型 | 視覺說明 | 觸發/切換方式 |
|---|---|---|---|---|
| **PixelCursor** | `UI/pixelCursor/` | `effect`（恆定最前、點擊穿透、轉發指標） | 以預烘焙 8-bit 像素箭頭（彩虹動畫外框烘焙進 `cursor.webm`）取代作業系統游標，可選加上模糊殘影拖尾 | 桌面/精準指標裝置預設開啟（行動裝置/觸控自動隱藏）；🕹 按鈕開啟自身調整面板；顯示狀態也受 LAYERS 面板控制 |
| **Holographic** | `UI/holographic/` | `effect`（裁切至 Frame 1 形狀，條件式最前） | WebGL fbm 雜訊漩渦/放射 shader，色相循環、星形閃光、暗角，可選掃描線與色彩濾鏡疊層；滑鼠/觸控移動漩渦中心（漣漪效果） | 由 LAYERS 面板顯示切換；效果內 ⚙ 按鈕開啟自身控制面板（動態/形狀/色彩/閃光滑桿） |
| **Checkerboard** | `UI/checkerboard/` | `effect`（背景，z-index 0） | 靜態 7×7 粉彩棋盤格 SVG 貼圖，持續斜向漂移（純 CSS），加上 JS 驅動的 RGB 切片「數位故障」帶狀效果與週期性震動尖峰、烘焙色差邊緣 | LAYERS 面板顯示時恆定開啟；故障強度會依 `shared/perf-monitor.js` 的 FPS 分級自動限縮（唯一接上此系統的效果） |
| **RetroFilter** | `UI/retroFilter/` | `effect`（恆定最前後製，z-index 25） | 相機/CRT 鏡頭觀感：掃描線（隨高度縮放）、暗角、色調、顆粒、螢幕閃爍——5 種疊層各自可切換，附色彩+透明度控制 | LAYERS 面板切換；📼 代理按鈕開啟自身面板（iframe 預設點擊穿透） |
| **Man** | `UI/man/` | `effect`（恆定最前，z-index 26，點擊穿透） | 裝飾圖以縮放+淡入 CSS 關鍵影格動畫在點擊位置彈入，停留片刻後彈出消失 | 點擊舞台上 Frame 1 範圍外、且非貼圖列的位置時觸發；大小/透明度/停留時間可透過 🧍 代理按鈕面板調整 |
| **StickerList** | `UI/stickerList/` | `effect`（全螢幕 overlay，為最上層時 z-index 22） | 5 個可點擊貼圖排成一列（窄螢幕時為欄），貼附於 "listStickers" 看板；具 hover 果凍傾斜、點擊彈跳、彩虹色調、點擊生成帶重力物理的掉落分身 | 看板本身由滑鼠 hover 抬升或觸控長按釘選開啟（`listStickersLayer.js`）；定位完成後圖示恆定可見；點擊圖示生成分身 |
| **Eye**（`eye.eye`） | `UI/eye/` | 自訂圖片圖層（`eyeLayer.js`），非 iframe 效果 | 一疊「窗戶」圖形依序開啟（每扇窗內嵌一段眨眼影片）、停留、關閉，再移動到新位置——無限自主循環 | 圖層顯示時全自主運作；無使用者輸入；圖層隱藏或分頁背景化時暫停 |
| **Chat**（`chat.chatboard`/`chat.chatB`） | `UI/chat/` | 自訂 DOM overlay 圖片圖層 | 訊息列表聊天面板（老式網頁捲動吸附、自繪捲軸、文字輸入），夾在 Pixi 填色與 Pixi 邊框之間，兩者皆升級為 DOM 以便與 DOM 訊息內容交錯疊層 | 圖層開啟時恆定可見；捲動/滾輪/拖曳/打字即為互動方式 |
| **Nested Scene 3 彈窗**（生成器，非常駐圖層） | `UI/Dark/` Lottie + `src/layers/nestedScene3PopupSpawner.js` | 用完即丟的 Lottie + mini Spine 渲染彈窗 | 「視窗」以緩動水平擦拭方式開啟，顯示 SpineAngel "dark" skin 動畫的即時鏡射裁切畫面，接著關閉並自我銷毀 | 每次點擊 Frame 1 範圍內即生成；多個實例可獨立疊加 |

其餘與整體外觀相關的非效果（一般/自訂圖片）圖層：`frame1`/`frame1B`（主要畫框素材，全息效果的遮罩目標）、`heading.*`（boarding/button/heading/heading3——訊息板風格群組，`boarding` 邊到邊延展作為背景填充）、`live.*`（3-line/搜尋列裝飾性 UI 模擬元件）、`spineAngelASpine`/`spineAngelDSpine`（同一 Spine 骨架的兩種 skin，皆透過 `attachFrame1Mask` 裁切至 Frame 1 範圍內）。
