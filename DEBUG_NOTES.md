# Debug 筆記

開發 `src/layers/nestedScene3PopupSpawner.js`（Nested Scene 3 彈窗 + Angel D 偷窺效果）
過程中踩到的幾個不直覺的坑，記下來避免以後重踩，也方便理解為什麼程式碼長成現在這樣。

## 1. pixi-spine 的動畫不會自己跑，要「被渲染」才會前進

**現象**：把一個 `PIXI.spine.Spine` 實體建立好、`autoUpdate` 保持預設的 `true`，但**不**把它
加進任何 Pixi 容器（`stage.root.addChild(...)`），它的 `state.tracks[0].trackTime` 完全不會
前進——就算等了好幾秒真實時間，讀出來還是 0。

**原本的假設（錯的）**：以為 pixi-spine 會像很多函式庫一樣，在建構時掛一個
`PIXI.Ticker.shared.add(...)` 監聽器，只要 `autoUpdate=true` 就會自己跑，跟有沒有被渲染、
有沒有父層都無關。

**實測驗證方式**：直接比較兩個 Spine 實體的 `state.tracks[0].trackTime`——一個是正常掛在畫面上
持續被渲染的（`spineAngelASpine`），一個是刻意不掛進場景、只靠假設中的「獨立 ticker」自動跑的
（`peekSpine`）。等 2 秒後前者正常前進了 ~2 秒，後者卻還停在 0。

**結論**：pixi-spine 的動畫推進似乎是綁在「被渲染」這件事上（不管是正常的場景渲染，還是手動呼叫
`renderer.render(spine, ...)`），而不是一個獨立於渲染之外、只看 `autoUpdate` 開關的計時器。
只要這個 Spine 物件會被「畫」到，它的動畫就會前進；完全不被渲染，就完全不會前進。

**影響到的設計**：這也是為什麼後來乾脆讓每個彈窗都有自己的 Spine 實體、每個 app tick 都呼叫一次
`miniRenderer.render(viewContainer)`——「定期渲染她」本身就是讓她動畫前進的必要條件，不是可有可無
的附加效果。

## 2. `renderable = false` 連你自己手動呼叫 `renderer.render()` 都會擋掉

**現象**：想要「這個 Spine 平常不要出現在正常畫面上，但我要能手動把她渲染進一張離屏材質」，直覺
做法是設 `renderable = false`（正常渲染流程會跳過它），然後自己呼叫
`renderer.render(spine, { renderTexture, transform })` 去手動渲染——結果材質裡什麼都沒有,
完全是空的。

**原因**：`renderable` 是物件自己 `render()`/`renderWebGL()` 方法裡檢查的旗標，只要是 `false`，
不管是「自動」的渲染流程觸發，還是你「手動」呼叫 `renderer.render(thisObject, ...)`，內部都是
同一段檢查邏輯，一樣會被跳過。這個旗標管的是「這個物件本身要不要畫」，不是「自動渲染流程要不要
畫它」。

**正確做法**：如果目的是「不要出現在主畫面，但要能手動渲染」，最簡單可靠的方式是**根本不要把它
加進任何會被自動渲染的容器**（不要 `stage.root.addChild(...)`），而不是加進去再用
`renderable=false` 蓋掉——因為手動渲染呼叫也會被同一個旗標擋住。

## 3. Lottie 的 `o`/`i` 關鍵影格緩動值 = CSS `cubic-bezier()` 的控制點，不是線性

**現象**：想根據 Lottie 動畫本身的關鍵影格時間點，用程式碼算出「現在開合到百分之幾」，一開始用
`(frame - startFrame) / (endFrame - startFrame)` 這種線性插值，結果算出來的進度跟畫面上
Lottie 實際播放的樣子對不上（看起來「差一點」，尤其在動畫開始/結束附近）。

**原因**：Lottie/After Effects 的關鍵影格格式裡，每個影格物件的 `"o"`（out 切線）跟 `"i"`
（in 切線）欄位，描述的是「這一段到下一個關鍵影格之間」的三次貝茲緩動曲線控制點——跟 CSS 的
`cubic-bezier(o.x, o.y, i.x, i.y)` 是同一套數學,不是線性漸變。`"o"`/`"i"` 都寫在**區間起點**
的那個關鍵影格物件上（同時描述這一段的出/入切線），最後一個關鍵影格因為沒有下一段,不需要這兩個
欄位。

**修法**：自己刻一個標準的 cubic-bezier 求解器（跟 CSS 引擎 / WebKit 的 `UnitBezier` 同一套
Newton-Raphson + 二分搜尋備援的技巧），輸入時間比例、輸出對應的貝茲曲線值，取代線性插值。

## 4. Lottie 的 `"s"`（scale）屬性兩個分量可以不同調——不一定是「整體放大」

**現象**：以為 Nested Scene 3 的視窗開合動畫是「從中心整個放大/縮小」，結果對照實際畫面才發現
是「維持滿高、只有寬度左右展開」的效果，跟做出來的「置中放大」對不上。

**原因**：Lottie 的 `ks.s`（scale）是 `[scaleX, scaleY]` 兩個分量，這個素材裡關鍵影格是
`[0, 100] → [100, 100]`——**只有第一個分量（X）在動，第二個（Y）全程都是 100**。也就是說原始
設計本來就是「高度一開始就滿，寬度從 0 展開到 100」的水平擦拭效果，不是均勻縮放。

**教訓**：讀 Lottie 的 scale 關鍵影格時，兩個分量要分開看，不要預設兩者一定同步變化。

## 5. 多個彈窗重疊時，Lottie 的透明挖空區會「穿幫」看到別的視窗

**現象**：兩個 Nested Scene 3 彈窗同時開啟、位置重疊時，較新視窗的透明內容區（本來要露出
Angel D）反而會看到**較舊視窗的邊框/標題列**穿幫過來。

**原因**：Nested Scene 3 的視窗內容區在 Lottie 素材裡本來就是**真的透明**（這樣才能露出底下的
Pixi 內容）。而所有彈窗的 Lottie `<canvas>` 都活在同一個共用 DOM 容器（`lottieContainer`）裡,
這個容器整體相對於共用的 Pixi 畫布只有一個「前/後」開關（見 `main.js` 的
`reconcileZIndex()`），沒辦法讓「這個彈窗的透明洞只透出屬於它自己的 Pixi 內容」——透明像素單純
就是讓瀏覽器去畫「疊放順序上真的在它後面」的東西,剛好是別的視窗,就會穿幫。

**修法**：不要指望 z-index 去解決疊圖時的透明挖空問題。把角色的畫面直接渲染進**這個彈窗自己的
一張 `<canvas>`**（一開始用 GPU 讀回擷取一張快照，後來乾脆讓每個彈窗有自己獨立的迷你渲染器直接
畫），變成一張普通、不透明的圖片，放進這個彈窗自己的 DOM 節點裡——這樣疊放順序完全交給瀏覽器
原生的 DOM stacking 處理，跟兩張普通重疊的圖片一樣正常，不會有透明穿幫的問題。

## 6. `renderer.extract.pixels()`/`.canvas()`（GPU 讀回）每幀呼叫很傷效能

**現象**：用「共用一個 Spine + 離屏材質渲染 + 讀回成一張圖」的做法解決了第 5 點的穿幫問題,但
彈窗開著的時候整體畫面掉幀變得很明顯。

**原因**：`renderer.extract.pixels()`/`.canvas()` 底層是 `gl.readPixels`，屬於**同步**的
GPU→CPU 資料搬移，會逼著整條 GPU pipeline 停下來等資料傳完,是 WebGL 裡出了名最貴的操作之一。
每個開著的彈窗、每一幀都做一次,疊加起來很容易感覺得到。

**修法**：如果做得到（畫面允許用普通 DOM 疊放順序處理遮擋，見第 5 點的解法），優先選擇「直接把
內容渲染到一個屬於自己的畫布上」而不是「渲染到材質 + 讀回」——前者的成本跟正常畫一個角色差不多,
後者多了一次讀回停頓。真的需要讀回時，至少把讀回頻率降到肉眼看不出差異的程度（例如跟 Lottie
本身的播放格率同步，而不是跟著螢幕更新率跑）。

## 7. `new PIXI.Renderer(...)` 建立新 WebGL context 很貴，不要每次點擊都重建

**現象**：解決第 6 點、改成「每個彈窗自己一個獨立渲染器直接畫」之後，掉幀確實改善了,但變成
「每次點擊、視窗真正打開之前，整個畫面會先卡頓一下」。

**原因**：`new PIXI.Renderer({...})` 會建立一個全新的 WebGL context——這牽涉到 GPU
驅動層的 context 初始化,以及**這個 context 專屬**的著色器程式編譯（WebGL context 之間不共用
已編譯的 shader program），是同步且相對昂貴的操作。剛好卡在「點擊→視窗打開」這條使用者最在意
的路徑上，特別容易被感覺到。

**修法**：維護一個小型的 renderer 池——彈窗需要畫布時先跟池子借，池子空的時候才真的
`new PIXI.Renderer(...)`；視窗關閉時把 renderer 還回池子（用 `resize()` 換尺寸即可重複使用，
不用重建 context），下次直接借用。這樣「建立新 WebGL context」這個較貴的一次性成本，只會在
整個 session 裡第一次真的需要、且池子是空的時候發生，之後每次點擊都是重複利用現成的 context。

---

**共通教訓**：這幾個坑都是「Pixi/pixi-spine/lottie-web 三套渲染系統疊在一起用」時才會冒出來的
交互作用，單獨看任何一套的官方文件都不會提到——遇到「照文件寫應該要動,但實際上沒動/慢很多」
的狀況時，先假設是跨系統邊界的行為差異，用實際數值量測（例如直接比較 `trackTime`）去驗證假設,
比純靠推理更可靠。

---

# `eye.eyeLayer.js` 的 `<video>` 眨眼播放坑

開發/除錯視窗疊圖的眨眼效果（`eye-screen.webm`，透明背景的睜眼→閉眼動畫）過程中踩到的坑。

## 8. `<video>` 從長時間 `playbackRate=0` 的暫停中恢復播放，偶爾會「重播」一小段才接上

**現象**：在睜眼格用 `playbackRate=0` 長時間定格（`HOLD_MS` 900ms）之後，呼叫 `playClose()`
把 rate 改回非 0 繼續往下播——螢幕上偶爾會看到「先從頭（或睜眼格之前）重播一小段，才真的接上
正常的閉眼動作」，不是每次都會發生，很難穩定重現。

**原因（兩層）**：
1. `tick()` 為了防止長時間定格時 `currentTime` 悄悄漂移，每個 tick 都會檢查一次，超出容許範圍
   就重新指定一次 `currentTime = holdTime`。這個修正用的 seek 是非同步的。如果 `playClose()`
   剛好在這次修正 seek 還沒真正完成（`videoEl.seeking === true`）的時候就把 `playbackRate`
   改成非 0，瀏覽器有時會把「seek 到某個畫格」跟「現在開始往前播」這兩個操作搞混，於是從最近的
   關鍵影格（很可能是第 0 幀）重新解碼追趕上來，追趕過程被畫出來，看起來就像「重播了一段」。
2. 就算把上面這個 race 修掉（`playOpen()`/`playClose()` 改成先確認 `videoEl.seeking` 為
   `false` 才去動 `playbackRate`），瀏覽器內部實際的 decode/paint 行為本來就不是 JS 端能完全
   掌握、100% 驗證消除的——用 CDP 對 `currentTime` 做高頻率數值追蹤，讀出來完全平滑遞增、找不到
   任何異常，但實際在瀏覽器裡看畫面還是會看到殘留的重播痕跡。`currentTime` 反映的是邏輯播放
   位置，不保證跟畫面實際畫出來的內容逐幀對應——數值 API「看起來正常」不等於畫面上真的沒問題。

**修法**：
- 第一層（`_waitIdle()`）：`playOpen()`/`playClose()` 開始播放前先確認沒有 seek 正在進行中，
  大幅降低發生機率，但不保證 100% 消除。
- 第二層（真正解決可見問題的關鍵）：與其繼續在 JS 端跟瀏覽器的內部解碼行為打賭，乾脆用一張
  「睜眼畫格的靜態截圖」蓋住閉眼動作開頭那一小段風險期（`MASK_MS`），過了這段再切回即時影片——
  把「消除某個底層行為」的問題，換成「視覺上蓋住它」的問題，更容易穩定驗證、也更好控制參數。

**教訓（踩了兩次才學到）**：用靜態截圖蓋住即時影片時，如果兩者都是**透明背景**（這裡截圖跟
影片本身都只有眼睛線條的地方不透明、其餘全透明），單純把靜態截圖疊在即時影片「上面」（一般的
alpha 合成）**不會真的擋住底下的畫面**——靜態截圖只在它自己有畫到的像素才會蓋住，兩張形狀不同、
不透明區域不重疊的圖疊在一起，底下該透的地方一樣會透出來（「重播的起始幾格漏餡」）。真正有效
的做法是蓋著的時候把底下那個 sprite 的 `visible` 直接設成 `false`（整個不畫），而不是只疊一張
圖上去合成——這是「切換顯示哪一個」，不是「合成兩層」。

---

# `UI/pixelCursor` 追滑鼠延遲坑

優化 8-bit 像素游標（跟手滑鼠移動、彩虹外框動畫）的延遲過程中踩到的坑，記下來避免以後重踩。

## 9. 為了降延遲把渲染改成「每個滑鼠事件都同步畫一次」，結果移動時反而更卡

**現象**：把 `setPointer()` 改成每次 pointer 事件都直接呼叫渲染邏輯（不等下一次 `requestAnimationFrame`），目的是把「事件到畫面」的延遲壓到最低。改完後使用者回報：滑鼠完全靜止不動時（彩虹外框持續變色的動畫仍在跑）畫面完全不卡，但滑鼠一移動就明顯變卡——延遲不減反增。

**原因**：渲染邏輯裡的 `drawCursor()`（後來改名 `buildCursorSprite()`）會迴圈跑過整個 `ROWS*COLS`（~230 格），每格都要組一個 HSL 顏色字串再 `fillRect`。這段運算量在「一秒鐘只需要跑 60 次（一次 rAF tick）」的前提下完全不是問題，但因為同時把它綁進了「每個 pointer 事件都執行一次」，又疊加了 `pointerrawupdate`（比 `pointermove` 頻率更高、直接來自輸入佇列、不受螢幕更新率節流），滑鼠快速甩動時這段 230 格重算邏輯一秒內可能被觸發到遠超過 60 次，白白吃掉主執行緒時間——而視覺上這段運算本來就只需要跟著顯示更新率跑一次就夠了。

**修法**：把「產生內容」跟「決定位置」拆成兩件不同更新頻率的事——顏色/HSL 運算只在 rAF tick（~60/sec）做一次，畫進一張小的 offscreen sprite；每個 pointer 事件只做「把已經算好的 sprite 貼到新座標」（一次 `drawImage`，不重算顏色）。最後進一步把「貼圖」也換成 DOM `<canvas>`/`<video>` + CSS `transform: translate3d()` 定位，讓移動完全變成合成器（compositor-only）操作，連 `drawImage` 這次重繪都省掉。

**教訓**：「讓某段程式碼跑得更頻繁」不等於「讓使用者感覺更即時」。如果那段程式碼本身有一個更低頻率就已經足夠的天然更新來源（這裡是動畫 hue cycle 只需要跟著螢幕更新率），卻把它跟「跟隨輸入事件」綁在一起執行，很容易在高頻輸入（快速甩滑鼠、高輪詢率滑鼠）下造成「事件越密集、反而越卡」的反效果。真正該做的是把「內容多久需要變一次」跟「位置多久需要更新一次」拆開來看，各自用各自需要的頻率跑。

## 10. 特效頁面獨立開啟時系統滑鼠箭頭沒被隱藏，一度以為是這輪改動造成的新 regression

**現象**：把游標從 canvas 即時運算換成 `<video>` + CSS transform 定位後，直接開 `UI/pixelCursor/index.html`（不透過根目錄的主合成器頁面）單獨測試，看到系統原生滑鼠箭頭跟自製像素游標同時疊在畫面上。

**原因**：隱藏系統游標用的 `cursor: none` 規則其實只寫在根目錄 `index.html` 的 `#stage-area`——這是「pixelCursor 效果被內嵌進主合成器頁面時，由外層頁面負責」的協調行為。`UI/pixelCursor/style.css` 自己從一開始就沒有這條規則，所以單獨開啟這個子頁面測試時，系統游標本來就會一直顯示——不是這輪改動造成的新問題，只是這次因為自製游標本身變流暢、雙游標疊在一起才變得明顯、被注意到。

**修法**：在 `UI/pixelCursor/style.css` 自己的 `html, body` 補上等效的 `cursor: none`，並把 `#panel`/`#panel-toggle` 明確排除回正常游標（跟主頁面對 `#stage-area` vs `#panel` 的處理邏輯一致），讓這個效果頁面單獨開啟時也是正確的。

**教訓**：「自我完備」（self-contained）的特效頁面如果實際上依賴外層頁面才會生效的協調行為（像這裡的 `cursor: none`），單獨開啟這個效果的資料夾測試時很容易誤判成新 bug。要嘛在自己的 CSS/JS 裡也補一份等效規則讓它獨立運作正確，要嘛至少在程式碼裡註明「這個行為依賴外部頁面才會生效」，避免下次又把「本來就沒做」錯認成「剛剛改壞的」。

---

# `UI/checkerboard` 效能坑

優化 `UI/checkerboard`（格紋背景漂移 + 色差 fringe + 故障/掃描線特效層）效能過程中踩到的坑。

## 11. JS/rAF 端明明已經節流過、看起來沒有熱點，但使用者實測「關掉這層就明顯變順」

**現象**：`script.js` 裡唯一還在跑的 JS（glitch 抖動）本身已經做了不少節流：`clip-path` 寫入頻率被限制在 ~30fps、有 `SETTLE_EPS` 門檻讓數值穩定後直接停寫、位移用 `transform` 而非強制重排的屬性。純看這段程式碼的運算量，判斷是「已經處理過、成本應該很低」——但使用者實際比較開/關這層的畫面流暢度，回報關掉之後明顯更順，兩者對不上。

**原因**：真正的成本不在 JS 執行時間，而在瀏覽器的合成（compositing）階段，量測 rAF callback 的運算量完全看不到。`style.css` 裡疊了 **6 個掛 `mix-blend-mode`（`screen`/`difference`）的全螢幕元素**（`#cb-shift-p`/`#cb-shift-c`、`#glitch-r`/`#glitch-g`/`#glitch-b`、`#glitch-scan`），且全部持續動畫中（CSS drift 或 keyframe）。瀏覽器沒辦法把有 `mix-blend-mode` 的元素獨立提升成一個可重複利用的 GPU 合成層——它的最終顏色取決於當下疊在它底下的內容，所以每個合成幀都要重新跟底層像素混合一次。這筆成本完全獨立於「JS 跑了多少行」，純粹分析 JS/rAF 熱點會系統性地漏掉它。

**驗證方式**：沒有用 profiler 量測合成成本，是先靠使用者實機主觀對照（開 vs 關這一層）確認「JS 看起來沒問題」跟「使用者說有差」這個矛盾真實存在，才回頭去翻 CSS 找到這 6 個 `mix-blend-mode` 元素這個結構性線索——重點是遇到這種矛盾時，下一步該往哪查：不是繼續在 JS 執行時間裡鑽，而是去查 CSS 合成屬性（`mix-blend-mode`、`filter`、`backdrop-filter` 等會讓瀏覽器沒辦法把元素獨立成一層的屬性）。

**修法**：其中 `#cb-shift-p`/`#cb-shift-c`（色差 fringe 的粉/青兩層）跟 base tile（`#cb-tile`）共用同一組 CSS drift 動畫時序（同一個 `Tx`/`Ty`、同時觸發），彼此的相對位移是初始化時算好的常數、永遠不變——也就是說牠們即時 blend 出來的結果其實是「靜態」的，只是被迫每個合成幀重算一次。把這兩個 DOM 元素砍掉，改成初始化時用一個 offscreen `<canvas>`（`ctx.globalCompositeOperation='screen'`）依照原本的 DOM 疊放順序把 base + pink + cyan 依序混合、一次性烘成一張圖，當作 `#cb-tile` 唯一的背景圖（見 `buildCompositeTile()`）。Canvas 2D 的合成公式（`screen`/`multiply`/`difference`...）跟 CSS `mix-blend-mode` 是同一套 W3C Compositing spec，數學上結果等價，只是從「每個合成幀在瀏覽器裡做」搬到「一次性在 JS 裡做」。真正隨機驅動、沒辦法預先烘焙的 `glitch-r`/`glitch-g`/`glitch-b`/`glitch-scan` 維持原樣不動。

**教訓**：「JS/rAF 端已經節流過、量不到熱點」不代表這一層真的便宜——`mix-blend-mode` 這類會擋掉瀏覽器把元素獨立提升成 GPU 層的 CSS 屬性，成本活在合成階段，不會反映在任何對 JS callback 計時的量測方式裡。另外，多個元素如果被綁在同一組共享時序的動畫上（這裡是共用的 `.drift-x`/`.drift-y` class 動畫），牠們之間「看起來在動」的相對關係，很可能其實是彼此鎖死的靜態常數關係——這種情況下即時運算/混合往往可以整批烘成一次性結果，不需要每幀重算。

---

# `chat.chatboardLayer.js` 的留言關鍵字提示跑版坑

修「屬性 bar 跟留言關鍵字提示在較窄螢幕會蓋過/超出 boarding 背景」這個 bug 過程中踩到的坑。

## 12. 幫 `_repositionHint` 加了 maxHeight + 字體自動縮小的 clamp，螢幕實測還是一樣溢出

**現象**：`ChatBoardLayer._repositionHint()` 原本只用 `bottom` 錨定留言關鍵字提示文字，換行變多時
上緣會無限往上長，超出 boarding 背景（`heading.boardingLayer.js`，永遠鋪滿整個 `#stage-area`）
的頂部。第一輪修法是加上 `maxHeight`（= 目前 `compBottom - marginY`）當硬上限，並在超出時把字體
逐步縮小（縮不下去才 `overflow:hidden` 兜底裁切）。但實際用 Playwright 在窄螢幕（例如 1000×320，
短寬、會觸發 `mobileWiden.js` 拉寬效果的長寬比）測試截圖，文字仍然跟修之前一樣蓋出 boarding 底邊。

**原本的假設（錯的）**：以為問題單純是「沒有上限」，只要補一個以 `compBottom`/`compRight` 為基準
的 clamp 就能解決——沒意識到 `compBottom`/`compRight` 這兩個基準值本身在某些情況下就是錯的。

**實測驗證方式**：把 `main.js` 暴露出來的 `window.__needyGirl.stage`（真正的全域 Stage 實例）跟
`_repositionHint()` 內部 `this.stage.scaleFactor` 這兩個數字直接印出來對照（在 `Stage.resize()`
跟 `_repositionHint` 兩處各加一行 `console.log`，附上呼叫計數器 + `performance.now()` 確認是
「同一次 resize 事件」觸發的）。結果在 1000×320 這個尺寸下：`window.__needyGirl.stage.scaleFactor`
正確算出 `0.2963`，但 `_repositionHint` 內部讀到的 `this.stage.scaleFactor` 卻是 `0.3854`——
兩者對不上，而且比值剛好 `0.3854 / 0.2963 ≈ 1.301`，跟 `mobileWiden.js` 在這個長寬比下算出來
給 `chat` 這個 GroupLayer 的橫向拉寬倍率（`growth`）數量級一致。

**根因**：`chat.chatboard`／`chat.chatB` 是 `chat` 這個 `GroupLayer` 底下的子圖層，所以它們拿到
的 `this.stage` 根本不是真正的全域 `Stage` 實例，而是 `GroupLayer.js`（`create()` 裡的
`childStage`）自己組出來的代理物件，其 `scaleFactor` getter 是
`stage.scaleFactor * group.container.scale.x`——`mobileWiden.js` 為了在短寬螢幕把聊天面板
往橫向拉寬，會把這個 `group.container.scale.x` 主動撥離 1（`scale.y` 不動）。`_repositionHint`
拿這個「已經被 group 自己的橫向拉伸複合過」的單一純量去同時算 `compW` 和 `compH`（用來推導留言
提示該貼齊在「整個畫面」的哪個角落），於是把 `compH`（決定 clamp 上限的依據）灌水成遠高於畫面
實際高度的假值（量到的是 416 邏輯 px 高，但當下畫面真實高度只有 320px），導致算出來的
「上限」本身就设在 boarding 真實底邊之下，不管字體縮多小都救不回來。

**修法**：把 `_repositionHint` 裡 `const scale = this.stage.scaleFactor;` 改成不透過這個代理
getter，直接用 `this.stage.width`/`this.stage.height`（這兩個 `childStage` 有原封不動轉發，
沒有被複合污染）重新算一次跟 `Stage.js` 的 `resize()` 完全同公式的「真實」等比縮放係數：
`Math.min(this.stage.width / LOGICAL_W, this.stage.height / LOGICAL_H)`。

**教訓**：任何被 `GroupLayer` 包住的子圖層，如果要算的是「相對於整個畫面/viewport」的東西（不是
「相對於這個 group 自己的框」），絕對不能直接用 `this.stage.scaleFactor`——這個值會被
`group.container.scale.x` 悄悄複合進去，而 `mobileWiden.js`/`DragTransform` 這類系統本來就會
主動把 group 自己的 scale 撥離 1。另外一個線索：同一輪修的「屬性 bar」（`frame1Layer.js` 的
`_repositionStatHud`）用完全類似的 clamp 手法就直接測試通過了，因為 `frame1` 是**頂層、沒有被
塞進任何 group** 的圖層，它的 `this.stage`本來就是貨真價實的全域 Stage——「兩個看起來一樣的
clamp 修法，一個測試通過、一個測試還是失敗」，就是該懷疑「是不是兩邊的 `this.stage` 根本不是
同一種東西」的訊號，而不是繼續在 clamp 數值本身打轉。

## 13. 兩邊都各自「不超出 boarding」了，實機（DevTools 裝置模擬）卻還是回報同樣的跑版

**現象**：上面第 12 點的修法上線、也用 Playwright 對多組視窗尺寸截圖+數值驗證過不會再超出
boarding 之後，使用者用 Chrome DevTools 的裝置模擬（iPad Mini 1024×768、iPhone SE 667×375
橫向）截圖回報「還是一樣會出現這些問題」。

**原本的假設（錯的）**：以為是同一個「超出 boarding」的 bug 沒修乾淨，準備回頭再查一次
`_repositionHint`/`_repositionStatHud` 的 clamp 算式。

**實測驗證方式**：直接用 Playwright 開到使用者截圖同樣的視窗尺寸（1024×768、667×375），量測
`.ng-stat-hud` 跟 `.ng-corner-hint` 兩個元素各自的 `getBoundingClientRect()`，發現兩者其實都
**沒有**超出 `#stage-area`（boarding）的範圍——但兩個矩形本身**互相重疊**（例如 1024×768 量到
overlapX≈151px、overlapY≈13px）。也就是說第 12 點修的「各自不超出 boarding」真的有效，使用者
截圖裡看到的「跑版」其實是另一個獨立問題：兩個元素各自守住了 boarding 的邊界，但沒有互相避讓，
在版面較扁（可用垂直空間被兩邊同時搶）的尺寸下會疊在一起變成無法閱讀的文字堆疊。

**根因**：`_repositionStatHud`（`frame1Layer.js`）當初補的 clamp 只讓 `top`/`left` 不超出
`this.stage.width`/`height`（boarding 的範圍），完全沒有讀取 `chat.chatboardLayer.js` 那邊
`.ng-corner-hint` 的即時位置——兩個 DOM 元素分屬不同圖層/檔案，各自的 reposition 函式互不知道
對方目前占了哪塊畫面，所以「各自合法」不等於「兩者不衝突」。

**修法**：`_repositionStatHud` 內，在既有的 boarding 邊界 clamp 之後，額外用
`document.querySelector('.ng-corner-hint').getBoundingClientRect()` 讀出提示文字目前的即時
上緣位置（換算成跟 `top`/`left` 同一個、以 `#stage-area` 左上角為原點的座標系），把它當成屬性
面板的「真實地板」，讓面板的 `top` 再多夾一次「不能低於 hint 上緣扣掉一點間距」；夾完再重新
`Math.max(0, ...)` 一次，確保「不能超出 boarding」這個較硬性的需求優先於「不要跟 hint 打架」。
`.ng-corner-hint` 是全域唯一的 DOM 節點、不掛在 LayerManager 上（`this.manager.get()` 只查得到
Pixi 側的圖層），所以用 `document.querySelector` 直接抓，而不是嘗試透過 manager 拿引用。

**教訓**：「兩個獨立元件各自都通過了自己的邊界檢查」不代表「合起來看畫面是對的」——尤其當兩者
共享同一塊有限空間、卻分別活在不同檔案/圖層的 reposition 邏輯裡時，一定要另外驗證「兩者的最終
矩形彼此是否重疊」，不能只驗證「各自沒有超出外層容器」。這也是為什麼一開始重新測試時該直接比對
使用者截圖裡標示的實際裝置尺寸（DevTools 裝置模擬用的 CSS px 尺寸就是普通的 viewport 尺寸，
Playwright 用一樣的 `setViewportSize` 就能精確重現），而不是自己隨便挑幾組「看起來很窄」的
尺寸去驗證——同一類「窄螢幕」bug，實際觸發的尺寸區間可能比想像中窄很多。

---

# `frame1Layer.js`/`stickerListLayer.js` 的屬性列 (stat HUD) + sticker 圖示自適應縮放坑

把 sticker 圖示列跟屬性 HUD 從兩個各自獨立、可能互相重疊的絕對定位盒子，改成共用一個真正的 CSS
flex row（`.ng-substat-row`，見 frame1Layer.js 的 `buildSubStatRow()`/`ensureStyles()`）之後，
陸續在不同裝置尺寸上踩到的坑——大多是「同一個量，被同時當成寬度依據又當成高度/間距依據」這一類
跨軸誤用，記下來避免下次改 RWD clamp 時又繞回同一個坑。

## 14. `HORIZONTAL_ROW_WIDTH_FRACTION` 沿用舊值（1），屬性表整個消失

**現象**：sticker 列跟屬性 HUD 改成 flex 關係後，屬性表完全從畫面上消失（使用者回報：「屬性表
沒看到 是跑到畫面外了嗎」）。

**原因**：兩者原本是「互相重疊也沒關係」的獨立絕對定位盒子，`HORIZONTAL_ROW_WIDTH_FRACTION=1`
（sticker 列占 Frame 1 全寬）在那個世界裡沒問題，因為 icon 只填自己左側一小段，屬性 HUD 疊在
同一段空間更右側的地方照樣看得到。改成 flex 之後兩者的寬度變成用「加」的（不是疊在一起），
sticker 列自己的圖示footprint（1% 起始留白 + 5×17% 圖示 + 4×2% 間距 ≈ 94% of screenW）幾乎吃光
了整條 row，屬性 HUD 能分到的寬度趨近於 0。

**修法**：把 `HORIZONTAL_ROW_WIDTH_FRACTION` 從 1 降到 0.55，幫屬性 HUD 留出足夠的寬度預算。

## 15. `u`（寬度推導的縮放比）被拿去乘垂直方向的安全間距，在 mobileWiden 拉寬的極端長寬比下算錯

**現象**：手機版極端寬扁的視窗尺寸（例如 741×313，長寬比遠大於 16:9）下，屬性列還是會覆蓋到人物
影片或 boarding 邊框，即使先前已經修過類似的重疊問題。

**原因**：`_repositionStatHud()` 裡 `TOP_OFFSET_U`/`BOTTOM_SAFE_U`/`HINT_GAP_U` 這三個「垂直」
安全間距常數，全部乘的是 `u = fb.width / FRAME_REF_W`——這個量是從 Frame 1 的「螢幕寬度」反推
出來的，本質上是水平方向的縮放比。`mobileWiden.js` 在長寬比 > 16:9 的短寬螢幕上，只拉伸 Frame 1
的 `scale.x`（絕不動 `scale.y`）去搶回多餘的 pillarbox 邊margin，這會讓 `u` 遠大於遊戲真正的
等比縮放係數，於是這三個垂直間距被算得比實際需要的還大，反過來吃掉 `availH`、把整個面板壓縮到
必須跟人物/boarding 重疊的地步。

**修法**：新增 `const vScale = this.stage.scaleFactor`（Pixi root 真正的等比縮放係數，
`min(w/1920, h/1080)`，不受 Frame 1 自己被拉寬與否影響），把 `TOP_OFFSET_U`/`BOTTOM_SAFE_U`/
`HINT_GAP_U` 全部 6 處相乘對象從 `u` 換成 `vScale`。`u` 本身在面板「自己的」內部排版（icon/字
/bar 大小、`naturalHeight` 等）還是正確的量，繼續留給那些用途。

**教訓**：一個「看似泛用」的縮放係數（這裡的 `u`），如果來源其實只綁定單一軸（Frame 1 的寬度），
一旦有其他系統（`mobileWiden.js`）專門只拉伸那一個軸，這個係數就不再等於「真正的等比縮放」——
任何要套用在「另一個軸」（這裡是垂直間距）上的地方，都得換一個不受那個單軸拉伸污染的量
（`stage.scaleFactor`），不能圖方便直接借用手邊已經有的那個。

## 16. 可讀性下限的「二選一」寫法，在門檻兩側的高度之間造成斷崖式跳變

**現象**：741×444 跟 741×447 只差 3px 高度，屬性列的視覺大小卻天差地遠——444 時字/圖幾乎細到
看不見，447 時完整清晰、跟聊天室對齊得很好（使用者回報並附兩張對照截圖）。

**原本的假設（錯的）**：以為又是同一類 `u`/`vScale` 混淆的 bug——但實際算過兩個尺寸下的
`stage.scaleFactor`（都是寬度綁定：`741/1920 < 444/1080` 和 `741/1920 < 447/1080` 同時成立），
兩者幾乎完全相同，代表這次的斷崖跟 vScale 無關，是另一個獨立成因。

**根因**：可讀性下限（`MIN_TITLE_FONT_PX`）的判斷式是一個**二選一**的硬切換：
`idealHudHeight <= availH ? idealHudU : u * fitScale`——如果「有下限保底的大小」剛好塞得下
`availH` 就整段採用，塞不下就整個退回「完全沒有下限」的原始 fit 值。`minHudU`（下限本身）幾乎是
固定常數、幾乎不隨 `availH` 變化，所以在門檻剛好兩側的高度，一邊還吃得下下限、另一邊吃不下，
就從「有下限保底的大小」直接摔到「原始 fit 值」（這個原始值本來就小到需要下限存在，所以摔下去
後幾乎看不見）——這正是 444/447 兩者判若兩物的原因。

**修法**：不再二選一，改成連續夾限：算出 `hudMaxU`（`availH` 內實際能塞下的最大尺寸），最終取
`Math.min(idealHudU, hudMaxU)`。因為 `hudMaxU` 必定 ≥ 舊的 fallback 值 `u*fitScale`（`fitScale`
本身的高度項就是 `availH/naturalHeight`，等於 `hudMaxU` 換算回 fitScale 的形式，再疊上
mobileScale/width/aspect 這些≤1 的天花板），這個改法保證只會更好、不會更差，且會隨 `availH`
平滑退讓，不再有斷崖。

**教訓**：「若 A 成立用理想值，否則用退回值」這種二選一 clamp，只要「理想值」本身不是連續隨約束
量縮放的（這裡 `minHudU` 是常數），门槛兩側必然會有跳變，就算兩個分支各自看起來都「合理」也一樣。
要做到真正連續的自適應縮放，永遠是「算出當下實際的硬性上限，理想值跟它取 min/max」，而不是「滿足
就整包用理想值，不滿足就整包換一套完全不同來源的值」。

## 17. Sticker 圖示的大小完全由「寬度」決定，沒人檢查過垂直方向塞不塞得下

**現象**：跟第 15 點同一類「寬度污染垂直方向」的 bug，只是這次發生在 sticker 圖示而不是屬性
HUD——使用者主動要求比照屬性 HUD 剛修好的邏輯，一併檢查 sticker 圖示的高度/位置縮放。

**原因**：`stickerListLayer.js` 裡圖示的實際像素大小完全由 `ICON_WIDTH_FRACTION * screenW`
決定（`screenW` 又是 `HORIZONTAL_ROW_WIDTH_FRACTION * frameScreenW`），從頭到尾沒有任何地方
檢查過這個由寬度算出來的尺寸，是否真的塞得進 Frame 1 底部到 boarding/hint 之間的垂直空間。
`style.css` 裡 `.sticker-item` 是 `width: 17%; aspect-ratio: 1/1`——圖示的寬跟高都是從容器
「寬度」的百分比算出來的，容器的 `height`（`pos.height`，經由 postMessage 傳給 iframe）在 CSS
裡完全沒有被圖示自己的尺寸讀取，只影響外層無形容器盒子的高度。在 `mobileWiden.js` 拉寬 Frame 1
寬度的極端長寬比下，`screenW`（進而圖示尺寸）會被連帶灌水，跟第 15 點屬性 HUD 曾經踩過的坑是
同一個成因，只是換了個地方發作。

**修法**：仿照屬性 HUD 剛修好的 `hudMaxU` 連續夾限手法——frame1Layer.js 新增
`getStatRowAvailH()`，把 `_repositionStatHud()` 內部算好的 `availH`（屬性 HUD 自己也在遵守的
垂直預算，兩者是同一個 flex row 裡、共用同一個 `top` 錨點的 flex-start 手足）快取起來給
`stickerListLayer.js` 讀取，不用自己重新導一份 `TOP_OFFSET_U`/`BOTTOM_SAFE_U`/`HINT_GAP_U`/
`vScale`（那樣兩邊常數值只要有一邊之後改動忘了同步，就會回到「各自合法、合起來卻沒對齊」的老
問題，見第 13 點）。圖示這邊算出 `idealIconSize = Math.max(naturalIconSize, MIN_ICON_PX)`
（一個沿用 `MIN_TITLE_FONT_PX` 邏輯、給觸控目標用的下限），再 `Math.min(idealIconSize, availH)`
夾出真正要用的 `iconSize`。因為圖示的寬高是綁在一起的正方形，光是夾住送給 iframe 的「height」
欄位並不會真的縮小圖示本身（CSS 只認寬度百分比）——所以還額外反推出達成這個 `iconSize` 所需要的
`effectiveScreenW = iconSize / ICON_WIDTH_FRACTION`，取代原本到處使用的 `screenW`，讓 sticker
slot 的保留寬度、送給 iframe 的寬度都跟著這個「真正會被套用」的尺寸走。

**教訓**：任何「這個尺寸看起來只跟一個軸有關」的假設（這裡：圖示尺寸看起來只跟寬度有關，因為
CSS 只用了 width 百分比），都該反過來想一次「這個軸的來源本身會不會被另一個系統額外拉伸/壓縮」
（`mobileWiden.js` 拉寬 Frame 1 寬度）——一旦會，這個「看似單軸」的尺寸其實間接受另一個維度
（垂直可用空間）污染，卻完全沒有機制去檢查它有沒有超出那個維度的預算。跟第 15 點一樣，解法都是
「找到不受污染的那個真值（這裡是 `availH`，一個獨立算好的垂直預算），把下游的量夾在它範圍內」，
而不是繼續在原本那個被污染的量上打轉調參數。

## 18. 屬性條寬度加了兩層「比例上限」，繞了兩次彎路才發現答案本來就在函式裡

**現象**：使用者回報「屬性條相對貼圖圖示列來說拉得太長」。第一次修法幫 `width` 加了一層上限：
不超過貼圖列自身（未被垂直壓縮時）的自然寬度 × 1.4。使用者用紅框標出 icon+標題欄的範圍，回報
「這個紅框範圍才是適合的間隔基準」，第二次修法把上限改成：不超過 icon+標題欄寬度 × (1+1)。兩次
修完，使用者都回報「太短了，而且要對齊 Frame 1 右側才對」。

**原因**：兩次「比例上限」都是額外疊加上去的新天花板，會把 `width`（屬性列的實際寬度）往下壓——
但 `_repositionStatHud()` 裡 `right` 的算式（`Math.min(fb.x + fb.width, cb.x - CHAT_CLAMP_PAD_U
* u)`）本來就已經保證了「絕對不超過 Frame 1 自己的右邊緣」。也就是說，在最常見的情況（Frame 1
右邊界比聊天板的安全間距更靠左）下，原始公式 `width = maxRowWidth - stickerWidth - gapPx` 就已經
讓整條 row 的右緣精確對齊 Frame 1 右邊緣，跟左緣對齊 Frame 1 左邊緣（`rowLeft`）是同一套邏輯，
不需要另外的比例上限。兩次新增的上限，反而把這個「本來就對齊」的結果往左拉近，製造出「太短、沒
對齊」的新症狀——「貼圖列縮小、屬性條顯得不成比例」是真的視覺落差，但用「削短屬性條」來解決，
正好跟「屬性條右緣要對齊 Frame 1」這個更早、也更明確的既有需求互相打架。

**修法**：兩層比例上限（`widthCeilingFromSticker`、`widthCeilingFromIconTitle`）都整個移除，讓
`width` 恢復成單純的 `Math.max(0, Math.min(WIDTH_FRACTION * fb.width, maxRowWidth - stickerWidth
- gapPx))`。「貼圖列縮小時屬性條顯得不成比例」這個原始困擾目前仍未真正解決，只是換了方向承認：
解法不該是「把屬性條往內縮」，而應該是「不要讓貼圖列本身縮得那麼小」——如果之後要再處理，該從
sticker 圖示那邊的下限著手，不是從屬性條這邊加天花板。

**教訓**：在幫一個已經由多層 `Math.min()`/`Math.max()` clamp 疊起來的版面公式加新的「上限」之前，
先確認清楚「現有的公式在最常見情況下到底解出什麼值」——這裡的 bug 不是「沒有上限」，而是「已經
有一個隱性但正確的上限（對齊 Frame 1 右緣），卻被誤判成問題，又疊加了兩層本來不需要的限制」。
遇到「兩個東西比例看起來不搭」的回報時，要先分辨這是「其中一個的絕對位置/尺寸算錯了」還是「兩個
各自獨立、都沒錯的東西單純看起來不搭配」——後者往往不該用「削掉其中一個」解決，因為它的絕對值
可能本來就是對的（這裡的 Frame 1 右緣對齊，就是先前很多輪才修好、也被使用者重申過的既有需求）。

## 19. JS template literal 裡的 CSS 註解用了 markdown 反引號標變數名，把整段字串提前截斷

**現象**：改完 `frame1Layer.js` 的 `.ng-substat-row` gap 數值、加上一段解釋用的註解後，使用者
回報整個遊戲畫面壞掉——Frame 1 的角色圖完全沒有渲染、貼圖圖示列和屬性 HUD 也都不見，連不相關的
`eye.eyeLayer.js` 眨眼特效影片都顯示異常（畫面上出現一個帶邊框的破圖 icon）。瀏覽器 console 印出
`SyntaxError: Unexpected identifier 'u' (at frame1Layer.js:171:66)`。

**原因**：`ensureStyles()` 裡整段 CSS 是用一個 JS template literal（反引號字串，`style.textContent
= \`...\`;`）包起來的。在其中一行新增註解，說明「16 個邏輯單位在小的 `u`（縮放係數）下只剩幾個
實際像素」時，習慣性地用 markdown 常見的單反引號 `` `u` `` 標記變數名稱——但這兩個反引號其實落在
**外層 template literal 的字串本體內**：第一個反引號直接把外層字串提前結束，緊接著的 `u` 變成一段
獨立、不合法的 JS token，第二個反引號則又重新開啟一段新字串（真正結束於原本 template literal 自己
的收尾反引號）。整個模組因此變成語法錯誤，`import` 這個模組直接失敗（`main.js` 的
`Failed to load layer "frame1"` catch 訊息），導致 Frame 1 這個圖層完全沒建立起來——而貼圖圖示列
/屬性 HUD 都是靠讀取 Frame 1 的 sprite bounds 才能定位，Frame 1 不存在，兩者自然也都不會顯示。

**實測驗證方式**：直接照瀏覽器給的行號/欄號（`frame1Layer.js:171:66`）去看那一行原始碼，比對前後
文發現字面上「看起來平衡」的一對反引號其實落在 `style.textContent = \`...\`` 這個大字串的中間；
用 `awk 'NR==108,NR==316' file | grep '`'` 抓出整個 template literal 範圍內所有反引號的行號，確認
除了開頭/結尾兩個之外，只多出這一組不該存在的反引號。

**修法**：把註解裡的 `` `u` `` 改成不帶反引號的一般文字。另外發現這個專案唯一在用的語法檢查工具
`node --check` 這次**沒有**抓到這個錯誤（原因不明，懷疑跟 Node 對 `.js` 檔案預設當成 CommonJS、
卻又有 ESM 語法自動偵測的某種邊界情況有關）——改用 `new Function(原始碼移除 import/export 那幾行)`
重新驗證，這樣才會真的用 V8 完整解析整個檔案本體（跟瀏覽器用的是同一套解析器），這次確實重現/
抓到了同一個錯誤。

**教訓**：這個專案的所有 CSS 都是寫在 JS template literal 裡（`ensureStyles()` 這類函式），幫這些
字串內部的內容加註解時，**絕對不能用反引號**——連 markdown 習慣用單反引號標記變數名這種寫法都不
例外，字串內部的反引號一律會被當成字面上的字串邊界，不會有「這是註解裡的反引號，不用管」的特例。
另外，`node --check` 在這個沒有 `package.json`/建置工具的專案裡，並不是 100% 可靠的語法檢查手段
——之後如果 `node --check` 顯示 OK 但實際行為異常，應該優先懷疑檢查方式本身不夠嚴謹，改用「讓 V8
完整解析整份檔案內容」的方式（例如 `new Function(...)`）重新驗證，而不是排除「語法錯誤」這個
可能性。

## 20. `.ng-substat-row` 的 `gap` 綁在 `--ng-u`（其實是 `hudU`），部分平板長寬比下把貼圖列跟屬性 HUD 的間隔撐到蓋過聊天視窗

**現象**：使用者在 iPad Pro（1366×1024，橫向）截圖回報「屬性條與貼圖列的間隔太寬，導致壓到右邊
聊天視窗」，並用紅框標出貼圖圖示與 `好感`/`壓力`/`黑化` 三行文字之間那段明顯偏寬的空白。其他常見
桌面/手機比例（16:9 附近）下這個間隔看起來是正常的，只有這種偏 4:3、非 16:9 的平板長寬比會出問題。

**原因**：`ensureStyles()` 裡 `.ng-substat-row` 的 `gap: calc(var(--ng-u) * 80)` 用的是 `--ng-u`
這個 CSS 變數，但 `_repositionStatHud()` 實際 set 給這個變數的值是 `hudU`——面板自己內部排版（icon
/文字/bar 大小）用的「fit-scale 過」的縮放係數，而不是同一個函式裡用來算「貼圖列+間隔+HUD 各自該
留多少寬度」的那個 `u`（純粹由 `fb.width / FRAME_REF_W` 算出的 Frame 1 寬度縮放比）。這兩個「看起來
都叫做縮放係數」的量其實不保證相等：`heightFitScale`（決定 `hudU` 的其中一項）被刻意設計成「只要
垂直方向有多的空間就可以長超過 1 倍」（見同一 section 第 15∼18 點的一連串教訓）。1366×1024 這種比
16:9 更接近方形的平板長寬比，遊戲主體（16:9）fit 進畫面後，Frame 1 底下會留下比一般 16:9 螢幕更多
的垂直空間，`heightFitScale` 因此明顯大於 1，`hudU` 跟著被撐大，連帶讓綁在同一個 `--ng-u` 上的
`gap` 也一起被撐大——但寬度預算的計算（`gapPx = GAP_U * u`，`width = maxRowWidth - stickerWidth -
gapPx` 等）從頭到尾都只用未被撐大的 `u`，於是「CSS 實際畫出來的間隔」比「JS 幫這個間隔預留的寬度
預算」還要寬，整條 row 的真實寬度超出 `maxRowWidth`（已經考慮過聊天版邊界的安全上限），視覺上就是
貼圖列右側多出一大段空白，把 HUD 往右推到跟聊天視窗重疊/貼近。

**修法**：讓 `.ng-substat-row` 的 `gap` 不再透過 CSS 變數套用，改成跟 `left`/`top`/`width` 一樣，
由 `_repositionStatHud()` 每次 tick 直接用 `` row.style.gap = `${gapPx}px` `` 內聯設定（`gapPx` 正是
寬度預算公式本來就在用的同一個值），CSS 規則本身改成 `gap: 0px` 純粹當作 fallback。這樣「實際畫出
來的間隔」跟「寬度預算算式假設的間隔」永遠是同一個數字，不會再因為 `hudU`/`u` 兩者分家而各自飄走。
同時把 `_statHudLastPos` 的提前 return guard 也加上 `gapPx` 這個欄位一起比對，避免 `gapPx` 單獨變動
但 `width` 剛好沒變時，改動被誤判成「跟上次一樣」而漏更新。

**教訓**：一個檔案裡如果有兩個「聽起來都是縮放係數」的量（這裡是 `u` 跟 `hudU`），**不能只看名字像
不像，要回頭確認每個地方實際 set/read 的是哪一個**——尤其當其中一個變數是透過 CSS custom property
（`--ng-u`）跨函式、跨用途共用的時候，很容易在增加一個新用途（這裡：把它也拿來當 flex `gap` 的依據）
時，忘記這個變數在別的地方已經被拿去做另一件事（面板內部縮放）並且兩者刻意設計成可以不同步（`hudU`
可以大於 1）。跟第 15/17 點是同一類「這個係數其實只綁定某個特定情境，另一個情境借用就會算錯」的坑，
只是這次分家的兩個值都叫 `--ng-u`，比之前的 `u` vs `vScale`（命名本來就不同）更容易被忽略。

另外，修這個 bug 的過程中，幫 CSS 註解加解釋文字時又差點犯了第 19 點記錄過的同一個錯——習慣性用單
反引號標記 `hudU`/`u`/`` `calc(var(--ng-u) * 80)` `` 這些變數名/程式碼片段，而這些文字其實寫在
`ensureStyles()` 那個 CSS template literal 內部。這次靠著第 19 點教訓留下的 `new Function(移除
import/export 後的原始碼)` 驗證流程，在送出前就抓到了 `SyntaxError: Unexpected identifier 'hudU'`，
而不是等實際載入才發現整個 Frame 1 圖層壞掉——證實了「這個專案的 CSS-in-JS 註解裡不能用反引號」這
條教訓即使已經寫進 DEBUG_NOTES，實際動筆時還是很容易在不注意的情況下再犯一次，值得每次改動
`ensureStyles()`/`style.textContent` 附近的註解時，都養成順手跑一次 `new Function` 驗證的習慣，
不能只靠「記得這條教訓」。
