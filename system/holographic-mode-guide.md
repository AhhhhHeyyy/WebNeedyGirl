# Holographic 病嬌/毒品 Mode 系統 — 操作說明與檔案索引

> 涵蓋範圍：holographic 效果的 Normal / Yandere（病嬌）/ Drug（毒品）三個獨立畫面設定、StatStore 屬性驅動、面板手動預覽與調整。
> 版本：2026-07-21

---

## 1. 這是什麼

Holographic（`UI/holographic/`）原本只有一份滑桿設定。現在拆成 **三份完全獨立的畫面設定**（下稱「profile」）：

- `normal` — 沒有任何屬性門檻觸發時的預設樣子
- `yandere` — 病嬌（affection 高）
- `drug` — 毒品沉淪（darkness 高）

每份 profile 各自擁有 Motion（速度/銳利度/環密度）、Shape（漩渦數/扭曲/飄移）、Color（底色/色相/暗角）、Sparkle（閃光網格/頻率/開關）、Overlays（掃描線 Scanline、色彩濾鏡 Colour Filter）——**互不共用**，改 Yandere 的任何一個數值都不會動到 Drug 或 Normal。

畫面實際呈現的樣子，是 `normal` 與「目前該啟用的 mode」之間用 `intensity`（0~1）做**逐項數值 lerp** 混合出來的結果，而不是切換到某個 mode 就 100% 瞬間變成那份 profile——這樣屬性從 50 慢慢爬到 90 時，畫面才會跟著漸變，而不是卡一下瞬間跳掉。

---

## 2. 兩種運作模式

### 2.1 Auto（正式運作，遊戲跑起來時的預設狀態）

由 `src/core/EffectDirector.js` 訂閱 `StatStore` 的屬性變化，每次變化都會：

```js
mode = holoMode(stats)          // 見下方公式
intensity = max(affection, darkness) / 100
```

再用 `postMessage({type:'ng-holo-mode', mode, intensity})` 送進 holographic 的 iframe。這是**正式流程**，不需要打開面板、不需要手動做任何事——StatStore 的數字（目前是靠 LAYERS 側欄最下面的「Stat Debug」滑桿手動測試，之後接上貼圖/superchat 就會是真的輸入來源）一變，畫面自動跟著變。

**Mode 判定公式**（`EffectDirector.js` 內的 `holoMode(s)`）：

```js
if (s.affection >= 60 && s.affection >= s.darkness) return 'yandere';
if (s.darkness  >= 60)                              return 'drug';
return 'normal';
```

判定順序即優先序：病嬌條件先檢查，兩者都達標時病嬌優先。

### 2.2 手動預覽／編輯（開發、調效果用）

面板裡選了 Normal / Yandere / Drug 其中一個，就是**強制**畫面顯示那個 mode（蓋掉 Auto 訊號），同時面板下方所有滑桿都會切換去讀寫「那個 mode 自己的」資料——這是給你調效果用的模式，跟正式的 Auto 流程完全分開，互不干擾（面板關掉、Mode 選回 Auto，馬上恢復吃真實屬性）。

---

## 3. 面板操作步驟

1. **開啟面板**：畫面右上角固定有個 🔮 按鈕（在 📼 RetroFilter、🧍 Man、🕹 PixelCursor 那排下面），不管圖層順序如何，點一下就能開/關 holographic 的完整控制面板。
   - 這個 iframe 平常是點擊穿透的（不擋貼圖/聊天室的點擊），面板打開時才會暫時變成可互動，同時會把自己拉到最前面（z-index 26）蓋過 Pixi 畫布，不然就算能點也會被畫面擋住點不到。
   - ⚠️ 已知小狀況：點這顆按鈕（以及 📼/🧍/🕹）都會**順便**跳出裝飾用的「man」小人彈窗——這是專案本來就有的行為（這些按鈕是 `#stage-area` 底下的真實 DOM 元素，點擊會被判定成「點在 Frame 1 外面」），不是這個功能特有的問題。

2. **選擇要編輯的 Mode**：面板最上面「Mode → Editing」下拉選單：
   - **Auto (StatStore)**：不強制、不顯示任何滑桿（因為畫面此刻是即時混合兩個 mode，沒有單一固定值可以顯示）。
   - **Normal / Yandere / Drug**：選了哪個，畫面立刻強制切過去預覽，下方 Motion/Shape/Color/Sparkle/Overlays 所有滑桿也立刻切換成讀寫「那個 mode」的資料，並用它目前存的值刷新顯示。

3. **Preview Intensity 滑桿**（選了非 Auto 才會出現）：0~1，決定「從 Normal 混合到你選的這個 mode」的混合係數，1 = 完全變成那個 mode 的樣子，0 = 跟 Normal 一樣。純粹方便你預覽/調效果用，**不會被存檔**。

4. **調整滑桿**：Motion / Shape / Color / Sparkle / Overlays 底下每個欄位都是**當下編輯中的那個 mode 專屬**，改了立刻反映在畫面上（因為此時該 mode 正被強制預覽），也會自動存檔（debounce ~200ms 後寫入 `state.json`／localStorage）。
   - 大部分滑桿右邊都有個可調整的 `max` 數字輸入框，如果覺得上限不夠用可以自己拉高。
   - Vortex Count 沒有 max 輸入框（固定 1~8）。

5. **Save / Reset 按鈕**（面板最下面，不受 Mode 選單影響，一直都在）：
   - **↓ Save**：把目前畫面截圖存成 PNG（跟 profile 資料無關，永遠抓「現在畫面實際渲染的樣子」）。
   - **↺ Reset**：清掉三個 mode 全部存檔資料，重新載入這個 iframe，回到程式碼內建的預設值。**沒有「只重置這個 mode」的選項**，Reset 是全部一起重來。

---

## 4. 資料結構與存檔

存在 `NeedyGirlState`（`state.json` / localStorage）的 key：`needygirl-holographic-settings`，格式：

```js
{
  profiles: {
    normal:  { speed, steps, ring_density, warp, drift_amp, drift_speed,
               hue, vignette, sparkle_size, sparkle_rate, sparkle, num_centers,
               vortexHex, retro:{hex,opa,off}, cf:{hex,opa,off} },
    yandere: { ...同上欄位，數值各自獨立... },
    drug:    { ...同上欄位，數值各自獨立... },
  }
}
```

程式碼內建預設值在 `UI/holographic/script.js` 的 `PROFILE_DEFAULTS`；讀檔時會用 `saved.profiles[mode]` 蓋掉對應欄位（沒存過的欄位就用內建預設）。

---

## 5. postMessage 一覽（跟 Mode 系統直接相關的）

| 訊息 | 方向 | 內容 | 用途 |
|---|---|---|---|
| `ng-holo-mode` | EffectDirector → holographic iframe | `{mode, intensity}` | Auto 正式驅動訊號 |
| `ng-holo-frame1-box` | `holographicLayer.js` → iframe | `{left,top,width,height,rotation}` | 告訴 iframe 內的 `#holo-clip` 該定位到 Frame 1 的哪個位置/大小/角度 |
| `ng-holo-toggle` | 🔮 proxy button → iframe | 無 payload | 開關面板 `#panel` 的 `.closed` class |
| `ng-holographic-pointer` | `holographicLayer.js` → iframe | `{tx,ty}` | 滑鼠/觸控位置（正規化到 Frame 1 的框），驅動 shader 漣漪效果 |
| `ng-stat` | `BaseIframeLayer.js` → 所有效果 iframe | `{stats}` | StatStore 的全部屬性快照（holographic 目前沒有直接用這個，靠 EffectDirector 算好的 `ng-holo-mode` 就夠了） |
| `ng-effect-pause` / `ng-effect-resume` | 通用 | 無 payload | 分頁背景化時停止/恢復 rAF 迴圈 |

---

## 6. 檔案索引

| 檔案 | 角色 |
|---|---|
| `UI/holographic/script.js` | WebGL shader、`PROFILE_DEFAULTS`/`PROFILES` 資料模型、Mode 下拉/滑桿的建置與讀寫邏輯、render loop 裡的逐幀 lerp 混合、Scanline/Colour Filter 疊層的即時混合渲染 |
| `UI/holographic/index.html` | 面板 DOM 結構：Mode 下拉＋Preview Intensity、`#mode-fields`（Motion/Shape/Color/Sparkle/Overlays，整包用 `mp-hidden` 一起顯示/隱藏）、Save/Reset 按鈕 |
| `UI/holographic/style.css` | `#holo-clip`（遮罩＋定位到 Frame 1 的容器）、`.mp-select`/`.mp-hidden` 樣式 |
| `src/layers/holographicLayer.js` | Parent 端：算 Frame 1 的即時螢幕座標框並用 `ng-holo-frame1-box` 傳給 iframe、滑鼠轉發、🔮 proxy button（含面板開/關時的 pointer-events 與 z-index 切換）、`setZIndex()`（frame1 是否最上層 vs 面板是否開啟兩種情況） |
| `src/core/EffectDirector.js` | Auto 模式的唯一大腦：`holoMode(stats)`／`intensity` 公式、送出 `ng-holo-mode`；同時也負責陰暗濾鏡強度、愛心粒子/I love you 疊字、破窗角色的觸發（跟 Mode 系統共用同一份 StatStore 訂閱） |
| `src/core/StatStore.js` | `affection`/`stress`/`darkness`/`followers` 屬性中央倉庫，`holoMode`/`intensity` 公式的資料來源 |
| `src/ui/StatDebugPanel.js` | LAYERS 側欄常駐的屬性測試滑桿（目前測試 Mode 系統最快的方法：拉 Affection/Darkness 看 Auto 模式自動切換） |
| `src/layers/BaseIframeLayer.js` | 廣播 `ng-stat`／`ng-effect-pause`/`ng-effect-resume`／`ng-perf-tier` 給所有效果 iframe（holographic 也是其中之一） |

---

## 7. 快速測試路徑

1. 開 LAYERS 側欄，把 Affection 拉到 ≥60 且 ≥ Darkness → 畫面應自動變成慢速柔和的粉紫漩渦（Yandere），同時愛心粒子開始出現。
2. 把 Darkness 拉到 ≥60 且 > Affection → 畫面應自動變成快速的高對比迷幻漩渦（Drug）。
3. 點 🔮 開面板 → Mode 選 Yandere → 拉 Flow Speed / Ring Density 等滑桿，畫面即時反應。
4. Mode 切到 Drug → 確認剛剛在 Yandere 改的數值完全沒有影響到 Drug 的滑桿顯示（兩邊互相獨立）。
5. 重新整理頁面 → 面板打開，Mode 分別切到 Yandere/Drug，確認剛剛調的值都還在（已存檔）。
