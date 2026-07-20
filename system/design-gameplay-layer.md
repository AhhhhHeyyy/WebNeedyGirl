# NeedyGirl WebNeedyGirl — Design Doc（增補：玩法互動層）

> 本檔銜接現有 design.md 的 §1–§4。§1–§4 描述的是「多圖層即時合成引擎」；本檔新增的是把這些視覺圖層掛回**遊戲狀態**的一層。
> 核心原則：**不新增畫面資產、盡量重用既有圖層**。所有「劇情/恐怖/幕後」演出都由既有的 `spineAngelDSpine`(dark skin)、`checkerboard`、`retroFilter`、`nestedScene3`、`eye`、`man`、`holographic` 依狀態被驅動，而非新畫一套。

---

## 5. 玩法互動層（Gameplay / Stat System）

### 5.1 屬性核心 `StatStore`（`src/core/StatStore.js`，新增）

沿用原作三大數值 + 一個計分值，全部掛在一個中央 store，做法對齊你現有的 `NeedyGirlState` / localStorage 與 `perf-monitor` 的廣播模式：

| 屬性 | 範圍 | 語意 | 影響的圖層 |
|---|---|---|---|
| `affection` 好感度 | 0–100 | 她對「P君（玩家）」的愛 | holographic 色相、貼圖雨、Cucked 冷卻 |
| `stress` 壓力 | 0–120 | 直播焦慮；>80 觸發崩潰 | retroFilter 閃爍、checkerboard 震動 |
| `darkness` 陰暗度 | 0–100 | 決定畫面往恐怖/幕後偏移多少 | Spine skin 切換、eye 密度、nestedScene3 |
| `followers` 粉絲數 | 0–9,999,999 | 計分板 + 最終大特效門檻 | 全域 overload |

介面（與既有模組同調）：

```js
StatStore.get('darkness')            // 讀
StatStore.apply({ stress:-12, darkness:+6 })   // 增減（自動 clamp）
StatStore.on('change', fn)           // 訂閱（供 Pixi 圖層直接呼叫）
// 對 iframe 效果：沿用 postMessage 慣例，廣播 { type:'ng-stat', stats:{...} }
```

- **持久化**：`getSnapshot()/applySnapshot()` 併進你現有的 💾/↺ 版面存檔流程，多存一組 stats。
- **廣播**：跟 `ng-perf-tier` 一樣，每次 change 就 `postMessage({type:'ng-stat', stats})` 給每個效果 iframe；Pixi 圖層則直接 `StatStore.on('change')`。
- **門檻事件**：store 內建 threshold watcher，跨越 60/80/100 等關卡時額外發 `ng-stat-threshold`（供 5.7 極值特效與 5.8 彩蛋掛鉤）。

### 5.2 事件導演 `MoodDirector`（`src/core/MoodDirector.js`，新增）— 解決「對話框怎麼觸發」

你卡在「不知道用時間還是按鈕觸發」。建議**混合觸發 + 壓力加權**，比純計時器有生命感：

| 觸發源 | 規則 |
|---|---|
| **計時（壓力加權）** | 下一則對話間隔 `interval = clamp(35 − stress*0.2, 8, 40) 秒`。壓力越高 → 她越頻繁丟訊息、語氣越急 |
| **事件驅動** | 送完貼圖 / superchat / 屬性跨門檻後，插播一則對應反應對話（走同一佇列，避免重疊） |
| **待機驅動** | 玩家 > 45 秒沒任何互動 → 焦慮台詞（「P醬？你在嗎…是不是不理我了」），並緩慢 −affection |
| **直播節奏** | 進入「直播尾聲」階段時，強制觸發一次「唸 superchat」對話（對映原作機制） |

MoodDirector 只負責「**何時**該講、講哪一組」，實際 UI 交給 5.3 的對話圖層。它讀 `StatStore` 決定語氣分支（甜／普通／病嬌／崩潰四檔）。

### 5.3 對話選項框（`UI/dialogue/`，新增 effect iframe 圖層）

- **型態**：新增一個 `effect` 圖層，套 `BaseIframeLayer`（跟 `man`/`retroFilter` 同模式），z-index 介於聊天(11/12)與 retroFilter(25) 之間，點擊穿透預設關、僅在有對話時開。
- **外觀**：直接用 §1.1 的毛玻璃粉紫藍卡片 + `NGChatSilver` 字型，視覺零成本融入。
- **內容**：一句台詞 + 2～3 個選項膠囊。點選項 → `postMessage({type:'ng-choice', id})` 回父層 → `StatStore.apply(delta)` → 對話關閉。

選項效果範例（每個選項推屬性）：

| 情境 | 選項 | Δ 屬性 |
|---|---|---|
| 她說直播好緊張 | 安撫她 | +affection 5, −stress 8 |
| 同上 | 叫她撐住繼續衝 | +followers, +stress 6 |
| 同上 | 已讀不回 | −affection 6, +darkness 4 |
| 她說想吃藥 | 遞藥 | −stress 12, +darkness 6 |
| 同上 | 阻止她 | +affection 3, +stress 4 |

### 5.4 貼圖互動 → 屬性（擴充 `StickerListLayer`）

你 §3.6 的貼圖列已經有「點擊生成掉落分身」。只要在那個 click handler 尾端多呼叫 `StatStore.apply()`，並讓 MoodDirector 插播一句回應：

| 貼圖 | Δ 屬性 | 她的回應語氣 |
|---|---|---|
| ❤️ 愛心 | +affection 6 | 甜、撒嬌 |
| 💊 精神藥物 | −stress 12, +darkness 6 | 放鬆、放空 |
| 🍬 毒品糖果（最高階） | −stress 20, +darkness 14 | 亢奮、失焦 |
| 🐱 P君 | +affection 8, −stress 4 | 最愛 P君 |
| 📱 手機 | +followers（小）, 觸發一則推文 | 得意 |

**隱藏機制**（都掛在既有分身生成邏輯上，不新增資產）：
- **狂送同一張**（10 秒內 5 次）→ 效果遞減 + 反應改變（「別一直洗貼圖啦 lol」→ 再送轉黏人）。
- **組合技**：3 秒內連送 💊 + 🍬 → **OD 事件**：`stress→0, darkness +25`，並直接觸發 5.7 的陰暗演出。

### 5.5 Superchat 輸入 → 屬性（擴充 `UI/chat/` 輸入列）

你 §3.8 的聊天輸入已能送訊息。把它升級成「superchat 輸入」：**金額檔位 × 關鍵字內容**雙軸。

**金額決定強度**（輸入列旁加 4 顆金額鈕）：

| 檔位 | 好感 | 粉絲 | 她的反應 |
|---|---|---|---|
| ¥100 | +2 | 小 | 隨口道謝 |
| ¥1,000 | +5 | 中 | 開心唸名字 |
| ¥10,000 | +10 | 大 | 整個人亮起來 |
| ¥50,000（紅色醒目留言） | +18 | 特大 | 激動、對你告白 |

**內容/關鍵字決定特殊反應**（呼應原作 superchat 是「內容觸發」而非只有金額）：見 §5.6。

實作：`chat` 送出時先跑 `parseSuperchat(text)` → 回傳 `{amount, keywordHits[]}` → 套金額 Δ + 關鍵字 Δ + 交給 MoodDirector 產生她的唸稿。

### 5.6 關鍵字 / 彩蛋觸發表（`src/core/keywordTable.js`，新增）

| 輸入內容 | 效果 |
|---|---|
| 甜言蜜語（cute / love you / 你超棒 / 天使） | +affection 額外加成 |
| 惡意 / 酸民字眼 | 她唸出來被傷到：+stress, +darkness；且此留言**不可刪**（對映原作 superchat 不可刪） |
| `P-chan` / `中之人` / 她本名 | **破第四面牆**：holographic 漩渦脈衝一下 + retroFilter 短暫故障 |
| **暗黑關鍵字**：`OD` / `overdose` / `光` / `死` / `消える` | 觸發**陰暗模式**：darkness 大幅 +，並進入 5.7 的 dark 演出 |
| `raincandy` | 解鎖私密帳彩蛋（見 §5.8） |
| 空白 / 長時間不送 | 緩慢 −affection（她失落） |

### 5.7 極值超級特效 → **重用現有圖層**（重點）

每條屬性的頂/底綁一段大演出，全部由既有圖層依 `ng-stat-threshold` 被驅動，對映原作結局：

| 觸發條件 | 重用的既有圖層 | 演出（＝對映原作） |
|---|---|---|
| `darkness ≥ 80` | `spineAngelASpine → spineAngelDSpine`（skin 切 dark）、`checkerboard`(故障拉滿)、`retroFilter`(掃描線+閃爍 on)、`eye`(窗戶數量/頻率上調)、自動 spawn `nestedScene3` dark 彈窗 | 逐步「病んだ」化，畫面腐化 |
| `darkness = 100` | 上述全開並鎖定 | **全畫面陰暗模式**（Welcome To My Religion 氛圍） |
| `affection = 100` | `holographic`(色相鎖粉紅、愛心 bloom)、貼圖列自動下愛心雨、`retroFilter` 暖調 | 「Ground Control to Psychoelectric Angel」病嬌黏著 |
| `affection = 0` | `holographic` 關、`retroFilter` 去飽和轉冷灰、chat 變冷淡 | 「Cucked」她離開你 |
| `stress ≥ 80` | `retroFilter` 閃爍加劇 + `checkerboard` 震動尖峰變密 | 崩潰前兆 |
| `stress = 120` | 強制 `nestedScene3` + skin dark + `man` 彈窗連發 | 強制「Darkness 直播」 |
| `followers = 1,000,000` | 全效果同時拉滿（holographic+checkerboard+retroFilter）+ 貼圖分身暴噴 | 「Internet Overdose」網路暴走天使 |
| `followers = 9,999,999`（彩蛋） | 同上 + 特殊字卡 | 「Internet Runaway Angel: Be Invoked」 |

> 這一段是整個設計的價值所在：你**已經**做好 dark skin、故障、CRT、eye、nestedScene3，只要讓它們「訂閱屬性」，極值演出幾乎零新資產。

### 5.8 彩蛋路由 → 重用既有點擊路由

你 §3.1 已有兩條全域點擊路由，直接拿來當彩蛋鉤子：

| 彩蛋 | 掛在哪 | 觸發 → 效果 |
|---|---|---|
| **淺層：點鏡頭/藥/旗** | Frame1 內點擊（現有 `nestedScene3` 路由加判定區） | 命中特定 sprite 矩形 → 冒台詞（「別忘了微笑喔～」） |
| **雙帳號切換** | 新增小按鈕或點 `live.*` 裝飾區 | 切 `OMGkawaiiAngel`(甜) ↔ `raincandy`(厭世真心話) |
| **幕後/中之人視角** | 連點 raincandy 3 下 | 切 skin dark + 場景轉「卸妝房間」感（retroFilter 去飽和 + eye 上調） |
| **P君是幻想** | MoodDirector 偵測玩家久未回應 | 畫面 glitch 一下（holographic 脈衝），短暫暗示聊天室沒有對象 |
| **恐怖視角漸強** | `darkness` 訂閱（§5.7） | 立繪/背景/聊天室隨陰暗度連續惡化 |
| **日記碎片收集** | 特定行為計數（如 🍬 前 4 次） | 解鎖一頁背景故事，集滿 → 隱藏結局字卡 |

### 5.9 資料流

```
使用者互動 ─┬─ 貼圖點擊(StickerListLayer)
            ├─ superchat 輸入(chat + parseSuperchat + keywordTable)
            ├─ 對話選項(UI/dialogue → ng-choice)
            └─ 舞台點擊彩蛋(main.js 既有路由)
                       │  StatStore.apply(delta)
                       ▼
                 ┌── StatStore ──┐
     ng-stat ────┤ (broadcast)   ├──── on('change') ── Pixi 圖層(spine skin / 貼圖雨)
   (→iframe效果) │               │
                 └── threshold ──┘── ng-stat-threshold ── 5.7 極值特效編排
                       │
                       ▼
                 MoodDirector（讀 stats 決定語氣/頻率）→ UI/dialogue 對話框
```

---

## 6. 落地順序建議（最小可玩 → 完整）

1. **StatStore + Task Manager 面板**：先讓四條屬性能被讀寫、畫面右上顯示（原作那種工作管理員面板）。沒有這個，後面全部無感。
2. **貼圖 → 屬性**：最快見效，只在既有 click handler 尾端加 `StatStore.apply()`。
3. **§5.7 極值特效接線**：把既有 dark skin / checkerboard / retroFilter 訂閱 `darkness`/`stress`——用你已有的資產先做出「越黑越壞」的爽度。
4. **MoodDirector + UI/dialogue**：對話選項框上線，遊戲開始有節奏。
5. **superchat 輸入 + 關鍵字表**：文字互動與陰暗模式關鍵字。
6. **彩蛋路由 + 日記碎片 + 30 天結局判定**：收束整個體驗。

> 建議加一個 **30 天倒數**當節奏容器：撐到第 30 天用當下四屬性判定結局，讓所有互動最後都有收束（對映原作 30 天多結局結構）。

---

### 附：參考來源（原作機制/劇情）
- Stream（直播與 superchat 機制）— NEEDY STREAMER OVERLOAD Wiki: https://needystreameroverload.wiki.gg/wiki/Stream
- Stats / Medication / Magicals（三大屬性與藥物）— Fandom Wiki
- Endings（結局對映極值特效）— https://needy-streamer-overload.fandom.com/wiki/Endings
