# StatStore 系統文件

本文件記錄 `affection`/`stress`/`darkness`/`followers` 這套中央狀態機的完整架構：資料從哪裡進來、`StatStore` 本身長什麼樣、又是怎麼驅動各種視覺效果。原始企劃在 [`NeedyGirl-簡化版-工程實作規格.md`](NeedyGirl-簡化版-工程實作規格.md) §7-10，但目前程式碼的實際行為已經有多處偏離/擴充原規格（詳見下方各節標註），本文件才是目前的 SSOT（唯一事實來源）。

## 1. 整體資料流

```
輸入來源                          StatStore                    輸出效果 (EffectDirector 訂閱)
─────────────────                ──────────                    ─────────────────────────────
StatDebugPanel 滑桿  ──┐                                    ┌─▶ holographic mode + crossfade
貼圖點擊 (stickerList) ─┼─▶ StatStore.apply(delta) ──change──┼─▶ darkness overlay (retroFilter)
聊天室關鍵字/Superchat ─┤        .set() / .get()             ├─▶ windowBreak (nestedScene3 spawn)
followerTicker (被動)  ─┘        .getSnapshot()              ├─▶ loveSpam / hearts overlay
                                 .applySnapshot()            ├─▶ tvGlitch 開關 (edge-triggered)
                                                              └─▶ Angel_A/D 換裝 (edge-triggered)
                                                                  （這兩個開啟的瞬間 ─▶ screenShake）

                                                 輸出效果 (DialogueDirector 自己讀，不經過 EffectDirector)
                                                 ─────────────────────────────────────────────────
                                             └─▶ pickMood(stats) → 對話/選項語氣（見 5-3）
```

`StatStore` 是唯一的資料中樞：所有輸入都只是呼叫 `apply(delta)`／`set(key, value)`；所有輸出都只訂閱 `on('change', cb)`。輸入和輸出彼此不知道對方存在。

`DialogueDirector.js` 是這條規則的**唯一例外**：它自己直接呼叫 `StatStore.getSnapshot()` 拿 raw 值，不透過 `EffectDirector.js` 中轉（見下方 2、5-3）。

## 2. 檔案地圖

| 檔案 | 角色 |
|---|---|
| [`src/core/StatStore.js`](../src/core/StatStore.js) | 資料本體。四個數值 + 範圍 clamp + pub/sub。**故意維持很笨**，不含任何遊戲邏輯。 |
| [`src/core/EffectDirector.js`](../src/core/EffectDirector.js) | 視覺特效這條線上**唯一**讀取 raw stats 的地方（`DialogueDirector.js` 是另一條獨立讀 raw stats 的線，見下方）。訂閱一次 `change`，把數值換算成每個效果要的 mode/intensity/布林旗標。 |
| [`src/core/keywordTable.js`](../src/core/keywordTable.js) | 聊天室關鍵字 → delta 對照表，第一個命中者生效。 |
| [`src/core/followerTicker.js`](../src/core/followerTicker.js) | followers 被動累積的 `setInterval`。 |
| [`src/core/screenShake.js`](../src/core/screenShake.js) | `#stage-world` 整體震動特效（見 index.html 的 mask/camera 設計），被 EffectDirector 兩處呼叫（tvGlitch 開啟／Angel_D 換裝）。 |
| [`src/core/DialogueStore.js`](../src/core/DialogueStore.js) | Frame 1 對話 UI（獨白泡泡／選項 bar）的執行期狀態＋語言選擇，API 形狀比照 StatStore（`get`/`on('change')`-with-unsubscribe）。**不含**劇本內容、**不含**自動觸發計時。 |
| [`src/core/DialogueDirector.js`](../src/core/DialogueDirector.js) | 決定「何時」該讓 Angel 講話、以及該挑哪個 mood 的獨白/選項餵給 `DialogueStore`。自己直接呼叫 `StatStore.getSnapshot()`，見 5-3。 |
| [`src/core/dialogueScript.js`](../src/core/dialogueScript.js) | 多語言（zh/en/ja/ko）台詞內容本體：`MONOLOGUES`、`CHOICE_SETS`、`pickMood(stats)`。台詞改編自 [`kangel-quotes-sourced.md`](kangel-quotes-sourced.md)。 |
| [`src/layers/stickerListLayer.js`](../src/layers/stickerListLayer.js) | 貼圖點擊 → delta（含刷屏遞減、OD 組合）。 |
| [`src/layers/chat.chatboardLayer.js`](../src/layers/chat.chatboardLayer.js) | 聊天輸入框：金額按鈕 + 關鍵字解析 → `StatStore.apply()`。 |
| [`src/ui/StatDebugPanel.js`](../src/ui/StatDebugPanel.js) | 四條滑桿，直接呼叫 `StatStore.set()`，用來手動測試。 |
| [`src/main.js`](../src/main.js) | 開機時 `EffectDirector.start()` + `followerTicker.start()`；存檔/重置按鈕呼叫 `StatStore.getSnapshot()`/`applySnapshot()`/`reset()`。 |

## 3. StatStore 核心

```js
STAT_RANGE = {
  affection: [0, 100],
  stress:    [0, 120],
  darkness:  [0, 100],
  followers: [0, 9_999_999],
}
INITIAL_STATS = { affection: 0, stress: 0, darkness: 0, followers: 0 }  // 也是 ↺ 重置按鈕的目標值
```

API：
- `get(key)` / `set(key, value)`（直接設值，clamp）
- `apply(delta)`（把 `{key: 加減量}` 疊加到目前值，clamp——所有輸入來源都用這個）
- `on('change', cb)`（訂閱時立刻補推一次目前快照；回傳 unsubscribe）
- `getSnapshot()` / `applySnapshot(obj)` / `reset()`（存檔/讀檔/重置用）

## 4. 輸入來源

### 4-1 貼圖點擊（`stickerListLayer.js`）

貼圖素材是純位置對應（`UI/stickerList/sticker1..5.png`，程式碼裡沒有名字），下表的圖案辨識是肉眼比對出來的：

| index | 圖案 | delta | 備註 |
|---|---|---|---|
| 0 | 藥丸包（精神藥物） | `{stress:-12, darkness:+6}` | 規格原值 |
| 1 | 愛心 | `{affection:-6, stress:-6, darkness:-6}` | **使用者要求改過**：規格原本是 `{affection:+6}`，先改成只減 stress，後來又改成三項均減 -6 |
| 2 | 粉紅貓（P君） | `{affection:+8, stress:-4}` | 規格原值 |
| 3 | 紅色對講機（手機） | `{followers:+800, stress:+10}` | **使用者要求疊加**：規格原本只有 `{followers:+800}`，追加 stress+10 |
| 4 | 糖果（毒品糖果） | `{stress:-20, darkness:+14}` | 規格原值 |

額外機制（都定義在 `registerStickerClick()`，模組層級的暫存狀態，不寫進 StatStore）：
- **刷屏遞減**：同一顆貼圖 10 秒內第 5 次起 delta ×0.3（`CLICK_DECAY_WINDOW_MS`/`CLICK_DECAY_THRESHOLD`/`CLICK_DECAY_MULTIPLIER`）。
- **OD 組合**：藥丸(0)和糖果(4) 3 秒內先後各點一次（任一順序）→ 觸發 `{stress: -目前stress值, darkness:+25}`，取代那一擊原本的 delta（不會兩個都套用）；遞減計數仍會記錄這次點擊，但組合本身不受遞減影響。

### 4-2 聊天室（`chat.chatboardLayer.js` + `keywordTable.js`）

**目前是純本地模擬**，沒有接任何真實直播平台（YouTube/Twitch）——使用者已明確表示這輪只要本地輸入，真的平台之後有後端再說。

送出流程（`submit()`）：`金額 delta`（若有選 ¥ 按鈕）+ `關鍵字 delta`（`matchMessage(text)`）相加後一次 `StatStore.apply()`。

金額按鈕（`SUPERCHAT_TIERS`，輸入框和工具列中間新增的一排）——`color` 對應彩底留言的分級色（`.ng-chat-row.sc-*`），由低到高參考主播女孩重度依賴（NEEDY GIRL OVERDOSE）直播 UI 的 SC 配色慣例（藍→綠→黃→橘→紅）：

| 金額 | 顏色 | delta |
|---|---|---|
| ¥100 | 藍 | `{affection:+2, followers:+60}` |
| ¥1,000 | 綠 | `{affection:+5, followers:+400}` |
| ¥5,000 | 黃 | `{affection:+8, followers:+1800}` |
| ¥10,000 | 橘 | `{affection:+10, followers:+2500}` |
| ¥50,000 | 紅 | `{affection:+18, followers:+12000}` |

彩底 SC 留言會標上 `row.dataset.locked`（與下面 `hater` 關鍵字同一個「不可刪」旗標），因為賽制上它應該像 SC 打賞一樣持續釘在畫面上，不會被互動清掉——目前還沒有刪除/清理 UI，所以這仍只是個標記。

關鍵字表（`KEYWORD_CATEGORIES`，**順序即優先權**，第一個命中的類別生效，不會多重命中）：

| 類別 id | 觸發字 | delta | 備註 |
|---|---|---|---|
| `sweet` | cute/love/加油/喜歡/天使/可愛/kawaii | `{affection:+6}` | |
| `hater` | hate/滾/醜/去死/噁/廢 | `{stress:+10, darkness:+6}` | `locked:true`（留言不可刪的旗標，還沒有刪除功能可以測） |
| `fourthwall` | p-chan/p醬/中之人/本名 | `{stress:+4}` | 規格要求的 glitch 視覺**沒有接**（沒有任何效果圖層有「外部觸發單次脈衝」的介面），只套用數值 |
| `dark` | od/overdose/光/死/消える | `{darkness:+22, stress:-6}` | |
| `easter` | raincandy | 無 | 彩蛋，不影響任何 stat |

`row.dataset.locked` 只是個資料標記，目前沒有刪除 UI 可以驗證它的效果。

留言板最底部（toolbar 下方）有一列 `.ng-chat-hint` 提示文字，內容是從 `KEYWORD_CATEGORIES` 動態組出來的「關鍵字 → 數值影響」對照（純顯示，`pointer-events:none`，不吃輸入）。`easter`（`raincandy`）因為 delta 是空物件 `{}` 被自動濾掉，不會出現在提示裡——彩蛋本來就不該被提示破梗，過濾條件用 `delta` 是否非空，不是寫死排除 id，所以之後新增/調整分類不用記得同步改提示。

### 4-3 Followers 被動累積（`followerTicker.js`）

每 10 秒（`TICK_INTERVAL_MS`）`StatStore.apply({followers: 10})`（`IDLE_GAIN`）。數值刻意選得比任何一次點擊/superchat 小很多，避免視覺上跟主動操作搶戲。

## 5. 輸出效果（全部在 `EffectDirector.js`，`onStatChange(s)` 每次 `change` 都會整包重算一次）

| 效果 | 判斷式 | 動作 | 觸發方式 |
|---|---|---|---|
| holographic mode | `holoMode(s)`：affection≥60 且 ≥darkness → yandere；darkness≥60 → drug；否則 normal | postMessage `ng-holo-mode` 給 holographic iframe | 連續（每次 change 都送，intensity 也連續） |
| holographic 模式切換動畫 | 同上，mode 字串改變時 | `UI/holographic/script.js` 內部用 700ms ease-in-out crossfade，從「上一幀實際畫面」淡入到新目標，取代原本整包瞬間切換 | 見下方「holographic crossfade」小節 |
| 陰暗濾鏡透明度 | `darknessOpacity(s) = (stress*0.4 + darkness*0.6)/100` | `retroFilter.setDarknessIntensity()` | 連續 |
| 破窗角色 (windowBreak) | `affection≥70 && darkness≥70` | 立刻 spawn 一次 + 每 6 秒 (`WINDOW_BREAK_INTERVAL_MS`) 持續 spawn，條件解除才停 | edge-triggered（`windowBreakOn`） |
| Love-spam / 愛心疊字 | `affection≥95` | `setLoveSpamActive()` / `setHeartsActive(mode==='yandere')` | 布林旗標 |
| **TV Glitch 開關**（使用者要求，非規格） | `stress≥120 && darkness≥100`（兩者都頂到範圍上限） | `manager.setVisible('tvGlitch', active)` | edge-triggered（`tvGlitchOn`），**只有開啟那一刻**額外 `triggerShake()` |
| **Angel_A/D 換裝**（使用者要求，非規格） | affection/stress/darkness 三項中「任兩項」≥60 (`ANGEL_SWAP_THRESHOLD`) | `manager.setVisible('spineAngelASpine', !active)` + `setVisible('spineAngelDSpine', active)` + `nestedScene3PopupSpawner.setAngelDCoverActive(active)`（每個開著的 Nested Scene 3 視窗，蓋一層不透明 `#000295` 遮罩，蓋掉原本從視窗看到的 Angel 內容；遮罩套用跟視窗本體一樣的左右 wipe 開合動畫曲線 `applyCoverClip()`，不是直接瞬間顯示/隱藏；新開的視窗、或旗標切換當下已經開著的視窗，都會立刻套用正確的目前進度） | edge-triggered（`angelSwapOn`），**只有換成 Angel_D 那一刻**額外 `triggerShake()` |
| **整體震動**（使用者要求，非規格） | 只掛在上面兩個 edge 上，不是獨立判斷式 | `screenShake.triggerShake()` | 見下方 |

### 5-1 holographic crossfade（`UI/holographic/script.js`）

原本 `activeMode` 一變就整包 uniform 瞬間套用新 mode 的 blend 值。現在 `frame()` 裡：
1. 每幀算出「目標值」`target`（跟以前一樣，base/mode 依 intensity 連續 blend 出來的完整 uniform 組）。
2. 偵測到 `activeMode` 改變，把「上一幀實際畫出來的值」存成 `transitionFrom` 快照。
3. 接下來 `MODE_TRANSITION_MS`（700ms）內，用 `easeInOutCubic` 從快照過渡到目標值（目標值本身仍會隨 intensity/stats 繼續變動，是追一個會動的目標）。
4. 轉場結束後 `transitionFrom=null`，直接套用目標值，跟原本行為一致。

### 5-2 screenShake（`src/core/screenShake.js`）—「攝影機」式震動

跟第一版不同：**不是**直接震動 `#stage-area`（那個會讓整個視窗方框本身跟著晃，對外露出邊緣接縫）。改成兩層結構（見 `index.html`）：

- `#stage-area`：固定不動的「遮罩／觀景窗」，`overflow:hidden`，永遠不會被 transform。
- `#stage-world`：`#stage-area` 裡面新加的一層包裝，裝著實際內容——Pixi 畫布、所有 DOM 特效 iframe（holographic/retroFilter/tvGlitch/…）、chat 的 DOM overlay、yandere-proto 的愛心/洗版疊字。`screenShake.triggerShake()` 動的是**這一層**。

效果上就像攝影機在晃、場景本身沒動：畫面邊框（跟旁邊 `#panel` 的接縫、瀏覽器邊緣）全程完全靜止，只有「窗框後面」的內容在偏移/旋轉。`#panel-toggle`（⚙）刻意留在 `#stage-world` 外面，跟 `#panel` 一樣是 dev UI，不參與震動。

參數（都是常數，方便之後再調）：
```js
DURATION_MS = 300       // 震動總長
MAX_OFFSET_PX = 4       // 位移振幅上限
MAX_ROTATION_DEG = 0.15 // 旋轉振幅上限
FREQUENCY_HZ = 1000 / DURATION_MS  // 300ms 內剛好 1 個來回
```
用連續正弦波（每次觸發只隨機一次相位，之後逐幀平滑內插）而不是「每幀重新亂數目標值」——後者才是最早「卡卡的」的原因之一。振幅用 ease-out 平方衰減，收尾比線性衰減更柔和。

**觸發點只剩兩個**（原本還有 holoMode 改變，任何方向都會震——已拿掉，現在 holoMode 改變本身不再叫 `triggerShake()`）：
- tvGlitch **開啟**那一刻（關閉不震）
- Angel_A→D **換過去**那一刻（換回 Angel_A 不震）

**Retrigger 平滑銜接（`RETRIGGER_BLEND_MS`）**：這兩個觸發點的門檻很接近（都繞著 60/100 附近），一次數值變化仍可能同時跨過兩個，或短時間內連續跨好幾次（尤其是用 StatDebugPanel 拖滑桿測試時）——這會在還沒衰減完就再次呼叫 `triggerShake()`。全新觸發（目前沒有震動在跑）維持原本「瞬間 snap 到滿振幅」的設計（fast attack，感覺像被打了一下）；但 re-trigger 時如果一樣硬 snap，會從「上一次已經衰減到一半的偏移」直接跳到「新一輪滿振幅、新相位」的位置，這個跳變本身沒有卡幀，但看起來就是「卡了一下」。現在 re-trigger 會記住上一幀實際套用的 `lastDx/lastDy/lastRot`，用 60ms 從那個值平滑內插到新震動自己的曲線，而不是硬切。

`will-change: transform` 是在 `index.html` 的 CSS 裡對 `#stage-world` **永久**設定，不是在 `screenShake.js` 裡每次觸發才加、動畫結束再拿掉。曾經試過「每次觸發才設、結束就清掉」——想省一點沒在用時的 GPU 記憶體——但這個子樹很重（Pixi 的 WebGL 畫布 + 好幾個各自跑 rAF 的 WebGL iframe），每次臨時 promote/demote 合成層的開銷，剛好卡在動畫最需要流暢的頭尾幾幀，反而是那陣子卡頓感的主因。現在固定付一點點常駐 GPU 記憶體，換來每次震動都不用重新建立合成層。

因為 `#pixi-stage` 現在在 `#stage-world` 裡面（不是直接在 `#stage-area` 下面），`src/main.js` 的 stage-area 點擊處理已經改成用 `stage.app.view.getBoundingClientRect()`（畫布自己當下的即時螢幕座標）換算點擊座標，而不是 `#stage-area` 自己的 rect——震動進行中兩者的座標可能有幾 px 落差，用畫布自己的 rect 才會跟畫面上實際看到的位置一致。

### 5-3 對話情緒（`DialogueDirector.js` / `dialogueScript.js`）—— 使用者要求，非規格原始範圍

跟前面幾個效果不同，這條路徑**不經過 EffectDirector**：`DialogueDirector.js` 自己直接呼叫 `StatStore.getSnapshot()` 拿 raw 值，交給 `dialogueScript.js` 的 `pickMood(stats)` 算出一個「情緒」字串，決定自動彈出的獨白／選項要挑哪個語氣。這是目前程式碼裡**唯一**繞過 EffectDirector、自己讀 raw stats 的地方。

`pickMood()` 的判斷順序、門檻刻意跟 `EffectDirector.js` 的 `holoMode()` 對齊，讓「畫面在演什麼」跟「台詞在講什麼」同一瞬間切換，不會各吹各的調：

| 優先權 | 條件 | mood | 對應的 `holoMode()` |
|---|---|---|---|
| 1 | `affection ≥ 60` 且 `affection ≥ darkness` | `yandere` | `'yandere'`（同一條件） |
| 2 | `darkness ≥ 60` | `dark` | `'drug'`（同一條件） |
| 3 | `stress ≥ 55` | `stress` | 無對應——`holoMode()` 落在 `'normal'`，靠 stress 在對話端再細分語氣 |
| 4 | 其餘 | `calm` | 無對應（同上） |

四個 mood 各自只從 `kangel-quotes-sourced.md`（[出處說明](kangel-quotes-sourced.md)）裡固定一種語氣改編，故意不混用，避免同一個 mood 忽然講出不像自己的話：

| mood | 語氣來源 | 內容量（獨白／選項組） |
|---|---|---|
| `calm` | KAngel 公開人設台詞（§1/§5，開朗直播腔） | 6 / 2 |
| `stress` | Ame 私下真心話——沒準備好／自我懷疑／自嘲吐槽（§1/§5） | 5 / 2 |
| `dark` | §2「神格化／消失」名句 ＋ Ame 最重的私下台詞（吃藥、罵酸民、「碎掉之前」） | 6 / 2 |
| `yandere`（規格文件 §B-4 原本沒有這個 bucket，使用者要求新增；門檻對齊 `holoMode()`） | Ame 佔有慾／忌妒台詞（§1/§3） | 4 / 2 |

`DialogueDirector.js` 本身只管兩件事：什麼時候講（壓力加權的隨機間隔，公式沿用 §B-4：`clamp(35 − stress×0.2, 8, 40)` 秒）、以及講哪個 mood；實際 UI 渲染是 `frame1Layer.js` 訂閱 `DialogueStore` 的事，跟這裡的 stat 判斷完全解耦。

## 6. 如何擴充

- **新增一個貼圖效果**：改 `stickerListLayer.js` 的 `STICKER_DELTAS[index]`，格式就是 `{statKey: 加減量}`。
- **新增一個關鍵字類別**：在 `keywordTable.js` 的 `KEYWORD_CATEGORIES` 陣列裡插入新物件，注意陣列順序就是優先權。
- **新增一個 stat 驅動的效果**：在 `EffectDirector.js` 寫一個判斷式（純函式，輸入 `s` 輸出布林/字串/數值），如果是開關型效果就照 `setTvGlitch`/`setAngelSwap` 的樣子做 edge-triggered（存一個模組層級布林，值改變才動作），在 `onStatChange(s)` 尾端呼叫。**不要**去改 `StatStore.js`——它應該永遠只是純數值容器。
- **要另外接震動**：直接 `import { triggerShake } from './screenShake.js'` 在想要的地方呼叫即可，不需要碰 EffectDirector。**要在場景裡新加會被震動影響的 DOM 元素**：append 到 `document.getElementById('stage-world')`，不是 `'stage-area'`（後者是固定不動的遮罩）。
- **新增一句對話獨白／選項組**：在 `dialogueScript.js` 的 `MONOLOGUES`/`CHOICE_SETS` 陣列裡加物件，`mood` 填 `calm`/`stress`/`dark`/`yandere` 四選一即可；不用碰 `DialogueDirector.js`——它已經是照 `pickMood()` 泛用挑句子，新 mood 的內容一加進去就會被撿到。
- **新增一個對話 mood bucket**：改 `dialogueScript.js` 的 `pickMood(stats)`，注意判斷順序就是優先權（跟 `EffectDirector.js` 的 `holoMode()` 同一套邏輯，新增/調整門檻時兩邊要一起看，避免「畫面在演 A、台詞卻講 B」）。

## 7. 目前明確沒做的事

- 真實聊天/Superchat 平台（YouTube Live Chat API、Twitch IRC）完全沒接，聊天室是純本地文字模擬。使用者說之後會另外加後端再處理。
- 「破第四面牆」關鍵字的 holographic glitch 視覺沒做（只套用 `{stress:+4}` 數值）——因為目前沒有任何效果圖層有「外部觸發單次脈衝」的介面，之後要做的話兩個候選是 `tvGlitchLayer` 的 `triggerBurst()`（改動小）或 holographic shader 自己做一次性 warp/hue 尖峰（改動大但效果一定看得到）。
- 規格文件 §5 的「⑥ 粉絲 overload」（followers 破百萬）沒有實作。
