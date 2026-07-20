# NeedyGirl 玩法互動層 — 簡化版工程實作規格

> 給工程師參考的實作規格（MVP 範圍）。銜接現有 `design.md` §1–§4 的多圖層合成引擎。
> 設計原則：**只有 1 個連續計算層；2 個濾鏡共用同一個 holographic；其餘皆為門檻旗標。** 盡量重用既有圖層，不新增畫面資產。
> 版本：2026-07-20

---

## 0. 範圍（本期要做的）

- 屬性系統 `StatStore`（3 條主屬性 + 1 條計分）
- 貼圖點擊 → 屬性增減
- Superchat（金額檔 × 關鍵字）→ 屬性增減 + 觸發對話
- 連續陰暗濾鏡（隨 stress/darkness 平滑加深）
- holographic 雙 mode（病嬌 / 毒品，由屬性自動切）
- 門檻特效：I love you 疊字、四次元破窗角色、粉絲 overload
- 條件組合 → 結局判定
- 自動對話 / 屬性觸發對話 / 關鍵字觸發

**不在本期**：日記碎片收集、雙帳號完整彩蛋、音效。

---

## 1. 屬性模型 `StatStore`（新增 `src/core/StatStore.js`）

```ts
type StatKey = 'affection' | 'stress' | 'darkness' | 'followers';

const RANGE = {
  affection: [0, 100],
  stress:    [0, 120],
  darkness:  [0, 100],
  followers: [0, 9_999_999],
};

const INITIAL = { affection: 50, stress: 20, darkness: 10, followers: 1_200 };
```

API（對齊既有 `NeedyGirlState` / `perf-monitor` 慣例）：

```ts
StatStore.get(key): number
StatStore.apply(delta: Partial<Record<StatKey, number>>): void   // 相加後自動 clamp 到 RANGE
StatStore.set(key, value): void
StatStore.on('change', (stats) => void): unsubscribe             // Pixi 圖層直接訂閱
StatStore.getSnapshot() / applySnapshot(s)                       // 併進 💾/↺ 存檔流程
```

**廣播**：每次變動後
- 對 iframe 效果：`iframe.postMessage({ type:'ng-stat', stats }, '*')`（沿用 `ng-perf-tier` 模式）。
- 對 Pixi 圖層：`emit('change', stats)`。
- 跨門檻（60 / 70 / 80 / 100 / 120 / followers 里程碑）時另發 `{ type:'ng-stat-threshold', key, level }`。

**粉絲被動累積**：主 ticker 每 N 秒 `apply({ followers: idleGain })`；貼圖/superchat 另給即時增量。followers **不參與濾鏡**，只當分數與結局門檻。

---

## 2. 效果清單：連續 vs 門檻

| # | 效果 | 型態 | 驅動 | 承載圖層 |
|---|---|---|---|---|
| ① | 陰暗濾鏡 | **連續** | `D = (stress*0.4 + darkness*0.6)/100` | 既有 `retroFilter` 或新增 overlay iframe |
| ② | 毒品魔幻濾鏡 | mode | darkness 主導 | 既有 `holographic`（改 uniform） |
| ③ | 病嬌濾鏡 | mode | affection 主導 | 既有 `holographic`（改 uniform）+ 愛心粒子 |
| ④ | I love you 疊字 | 門檻旗標 | affection 極值 | 新增輕量 DOM/iframe overlay |
| ⑤ | 四次元破窗角色 | 門檻旗標 | affection 高 且 darkness 高 | 既有 `nestedScene3` + `spineAngelDSpine` |
| ⑥ | 粉絲 overload | 門檻旗標 | followers | 全效果拉滿 |

---

## 3. ① 連續陰暗濾鏡

```js
// 每次 StatStore change 重算；建議再對輸出做時間平滑避免跳動
function darknessOverlayOpacity(s){
  const D = (s.stress*0.4 + s.darkness*0.6) / 100;   // 0..1（stress 以 100 為分母即可，>100 讓它自然超過再 clamp）
  return clamp(D, 0, 1);
}
```

- 表現：暗角 + 去飽和 + 輕微雜訊的全螢幕 overlay，`opacity = darknessOverlayOpacity()`。
- 承載：優先掛在既有 `retroFilter`（它本來就是恆定最前的鏡頭後製層），把它的暗角/顆粒強度綁到這個值；或新增一個 `pointer-events:none` 的 overlay iframe。
- 平滑：用 lerp 每幀逼近目標 opacity（例如 `cur += (target-cur)*0.08`），避免屬性跳動造成閃爍。

---

## 4. ②③ holographic 雙 mode（同一層兩用）

**mode 選擇（純函式，輸入屬性 → 輸出 mode）**：

```js
function holoMode(s){
  if (s.affection >= 60 && s.affection >= s.darkness) return 'yandere'; // 病嬌
  if (s.darkness  >= 60)                              return 'drug';    // 毒品
  return 'normal';
}
```

**各 mode 的 holographic uniform**（父層透過 postMessage 傳給 holographic iframe；沿用它現有的 shader 參數）：

| mode | 色相 hue | 飽和/亮度 | 漩渦速度 | 額外 |
|---|---|---|---|---|
| normal | 自由循環（現狀） | 中 | 中 | — |
| `yandere` 病嬌 | 鎖粉紅/洋紅（hue ≈ 320–340） | 高亮、柔 | 慢、柔 | 疊愛心粒子（可用既有閃光粒子換貼圖） |
| `drug` 毒品 | 快速全色相循環 | 高飽和、對比高 | 快、加 warp | 色差/扭曲加強 |

實作建議：holographic iframe 收 `{ type:'ng-holo-mode', mode, intensity }`，`intensity` 可再吃 `max(affection,darkness)` 做強度連續變化，讓 mode 內部也會「越極端越誇張」。

```js
StatStore.on('change', s => {
  holoIframe.postMessage({ type:'ng-holo-mode', mode: holoMode(s),
    intensity: clamp(Math.max(s.affection, s.darkness)/100, 0, 1) }, '*');
});
```

---

## 5. ④⑤⑥ 門檻旗標

```js
function evalFlags(s){
  return {
    loveSpam:   s.affection >= 95,                       // ④ I love you 疊字
    windowBreak: s.affection >= 70 && s.darkness >= 70,  // ⑤ 四次元破窗角色
    overload:   s.followers >= 1_000_000,                // ⑥ 粉絲暴走
    breakdown:  s.stress >= 120,                         // 崩潰
  };
}
```

- **④ loveSpam**：開啟後以固定間隔（如 120ms）在畫面隨機位置生成 "I love you" 文字節點，累積覆蓋；affection 掉回 <95 即停止並清除。用輕量 DOM overlay 即可（`pointer-events:none`、最上層但低於游標）。
- **⑤ windowBreak**：觸發即以既有 `nestedScene3` 生成器 spawn 破窗彈窗，內容鏡射 `spineAngelDSpine`（dark skin）。可持續/週期 spawn 直到條件解除。
- **⑥ overload**：holographic + retroFilter + 陰暗濾鏡全部拉到上限，貼圖分身暴噴。
- 旗標為 edge-trigger（false→true 才觸發演出），避免每幀重複 spawn。

---

## 6. 條件組合 → 結局判定

**即時硬門檻**（達到即演，不可逆的走對應結局演出）＋ **第 30 天軟結算**（都沒硬觸發時，用當下屬性查表）。

```js
function resolveEnding(s){
  if (s.stress >= 120)                          return 'BREAKDOWN';       // 崩潰
  if (s.affection >= 70 && s.darkness >= 70)    return 'WINDOW_BREAK';    // 病嬌+陰暗（最恐怖）
  if (s.darkness >= 80 && s.affection < 60)     return 'DRUG';           // 毒品沉淪
  if (s.affection >= 80 && s.darkness < 60)     return 'YANDERE';        // 病嬌（Ground Control）
  if (s.followers >= 1_000_000)                 return 'OVERLOAD';       // 網路暴走
  return 'NEUTRAL';                                                       // 平穩
}
```

| 結局 | 條件 | 疊加效果 |
|---|---|---|
| `YANDERE` 病嬌 | affection ≥ 80 且 darkness < 60 | ③病嬌濾鏡 + ④I love you 疊字 |
| `DRUG` 毒品沉淪 | darkness ≥ 80 且 affection < 60 | ②毒品濾鏡 + ①陰暗加深 |
| `WINDOW_BREAK` 破窗 | affection ≥ 70 且 darkness ≥ 70 | ⑤破窗角色 + ①+③混色 |
| `BREAKDOWN` 崩潰 | stress = 120 | ①拉滿 + 畫面震動 |
| `OVERLOAD` 網路暴走 | followers ≥ 100 萬 | ⑥全開 |
| `NEUTRAL` 平穩 | 皆未達 | 僅①連續濾鏡浮動 |

> 判定順序即優先序（上到下）。`WINDOW_BREAK` 排在 DRUG/YANDERE 之前，確保雙高時走破窗。

---

## 7. 對話系統

三種觸發共用同一個對話 UI（`UI/dialogue/`，`effect` iframe，套 `BaseIframeLayer`）。

### 7-1 自動對話（`MoodDirector`，新增 `src/core/MoodDirector.js`）
```js
nextInterval = clamp(35 - stress*0.2, 8, 40) * 1000;  // 壓力越高越頻繁
// 選對話組：
mood = darkness >= 60 ? 'dark' : (stress >= 55 ? 'stress' : 'calm');
```
對話出現後 9 秒自動收起。

### 7-2 屬性觸發對話
`ng-stat-threshold` 事件（某屬性首次跨 60/80…）→ 插播該情境專屬對話（走同一佇列，不與自動對話重疊）。

### 7-3 對話選項 → 屬性
```
選項物件: { text: string, delta: Partial<Stats> }
點擊 → postMessage({type:'ng-choice', delta}) → StatStore.apply(delta) → 關閉對話
```

範例對話組（可外部化成 JSON 給企劃調）：

| 組 | 選項 → delta |
|---|---|
| calm | 一起加油 `{aff+5,str-3}` / 衝粉絲 `{fol+1500,str+6}` / 不回 `{aff-6,dark+4}` |
| stress | 撐住你會更強 `{aff+6,str-10}` / 遞藥 `{str-14,dark+8}` / 別理酸民 `{str-4}` |
| dark | 我永遠記得你 `{aff+8,dark-8}` / 別說傻話 `{str-2}` / …… `{dark+10,aff-4}` |

---

## 8. 輸入來源 → 屬性

### 8-1 貼圖點擊（擴充既有 `StickerListLayer` 的 click handler）
| 貼圖 | delta |
|---|---|
| 愛心 | `{affection:+6}` |
| 精神藥物 | `{stress:-12, darkness:+6}` |
| 毒品糖果 | `{stress:-20, darkness:+14}` |
| P君 | `{affection:+8, stress:-4}` |
| 手機 | `{followers:+800}` |

- 刷屏遞減：同一張 10 秒內第 5 次起 delta ×0.3。
- OD 組合：💊 與 🍬 3 秒內先後各一 → `{stress: -current, darkness:+25}`。

### 8-2 Superchat（擴充 `UI/chat/` 輸入列）
金額 delta：
| 金額 | delta |
|---|---|
| ¥100 | `{aff+2, fol+60}` |
| ¥1,000 | `{aff+5, fol+400}` |
| ¥10,000 | `{aff+10, fol+2500}` |
| ¥50,000 | `{aff+18, fol+12000}` |

送出流程：`parse(text)` → 套金額 delta + 關鍵字 delta（相加）→ 觸發她的唸稿對話。

---

## 9. 關鍵字表（`src/core/keywordTable.js`，第一個命中者生效）

| 類別 | 觸發字（不分大小寫） | 效果 |
|---|---|---|
| 甜言蜜語 | `cute` `love` `加油` `喜歡` `天使` `可愛` `kawaii` | `{affection:+6}`（推向病嬌） |
| 酸民 | `hate` `滾` `醜` `去死` `噁` `廢` | `{stress:+10, darkness:+6}`，留言不可刪 |
| 破第四面牆 | `p-chan` `p醬` `中之人` `本名` | `{stress:+4}` + holographic glitch 脈衝 |
| 暗黑 | `od` `overdose` `光` `死` `消える` | `{darkness:+22, stress:-6}`（推向毒品/破窗） |
| 彩蛋 | `raincandy` | 無屬性，私密帳彩蛋 |

---

## 10. 整合點總表

| 新增/擴充 | 檔案 | 說明 |
|---|---|---|
| StatStore | `src/core/StatStore.js`（新） | 屬性中央 store + 廣播 + 存檔 |
| MoodDirector | `src/core/MoodDirector.js`（新） | 自動/屬性觸發對話排程 |
| keywordTable | `src/core/keywordTable.js`（新） | superchat 關鍵字解析 |
| 對話圖層 | `UI/dialogue/`（新 effect iframe） | 對話 UI，收 `ng-choice` |
| I love you 疊字 | 輕量 overlay（新） | loveSpam 旗標驅動 |
| 陰暗濾鏡 | 綁 `retroFilter`（既有） | opacity = `darknessOverlayOpacity()` |
| holographic mode | `UI/holographic/`（既有，加訊息） | 收 `ng-holo-mode` |
| 破窗角色 | `nestedScene3` + `spineAngelDSpine`（既有） | windowBreak 旗標驅動 |
| 貼圖 → 屬性 | `StickerListLayer`（既有，加 apply） | click handler 尾端 |
| superchat → 屬性 | `UI/chat/`（既有，升級輸入列） | 金額鈕 + parse |

**新增的 postMessage 訊息**：`ng-stat`、`ng-stat-threshold`、`ng-holo-mode`、`ng-choice`。與既有 `ng-perf-tier`、`ng-effect-pause/resume` 並存。

---

## 11. 實作順序（建議）與驗收

1. **StatStore + Task Manager 顯示** — 四屬性可讀寫、畫面右上即時顯示。（驗收：貼圖點擊數字會動）
2. **貼圖 / superchat → 屬性** — 8-1、8-2、關鍵字表。
3. **① 連續陰暗濾鏡** — 綁 retroFilter，opacity 隨 stress/darkness 平滑變化。
4. **②③ holographic 雙 mode** — `holoMode()` + `ng-holo-mode`，切病嬌/毒品配色。
5. **④⑤⑥ 門檻旗標 + 結局判定** — `evalFlags()`、`resolveEnding()`（edge-trigger）。
6. **對話系統** — MoodDirector + UI/dialogue + 屬性觸發。

**整體驗收清單**
- [ ] 狂點愛心 → affection→100 → 病嬌濾鏡 + I love you 疊字
- [ ] 狂點糖果 → darkness→80 → 毒品濾鏡 + 陰暗濾鏡明顯加深
- [ ] affection、darkness 同時 ≥70 → 四次元破窗角色出現
- [ ] stress 衝到 120 → 崩潰演出
- [ ] followers 累積到 100 萬 → overload
- [ ] 壓力高時自動對話變頻繁；選項確實改屬性
- [ ] superchat 打 `OD`/`P-chan`/`raincandy` 有對應特殊效果

---

## 附錄：主迴圈參考骨架

```js
// 每次屬性變動
StatStore.on('change', s => {
  updateDarknessOverlay(darknessOverlayOpacity(s));           // ①
  holoIframe.postMessage({type:'ng-holo-mode',
    mode:holoMode(s), intensity:Math.max(s.affection,s.darkness)/100},'*'); // ②③
  applyFlags(evalFlags(s));                                    // ④⑤⑥ edge-trigger
  const end = resolveEnding(s);
  if (end !== 'NEUTRAL') triggerEnding(end);                   // 硬門檻即時結局
});

// 被動：粉絲累積 + 自動對話
tickerEverySeconds(() => StatStore.apply({ followers: idleGain }));
MoodDirector.start();
```

> 參考來源（原作機制對映）：Stream / Endings — NEEDY STREAMER OVERLOAD Wiki (needystreameroverload.wiki.gg)。台詞另見 `kangel-quotes-sourced.md`。
