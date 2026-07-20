# NeedyGirl WebNeedyGirl — 互動設計完整文件

> 一份彙整：把 NEEDY GIRL OVERDOSE 玩法對映進你的多圖層合成引擎。包含 (A) 玩法互動層設計、(B) 原型機制攻略、(C) 可考證雙語台詞庫。
> 版本日期：2026-07-20

## 目錄
- **Part A — 玩法互動層設計**（要蓋什麼、怎麼接進現有架構）
- **Part B — 原型機制攻略**（`needygirl-gameplay-prototype.html` 目前實作的觸發條件對照）
- **Part C — 台詞庫**（英文原句 ＋ 中文對照 ＋ 出處）
- **參考來源**

---

# Part A — 玩法互動層設計

> 銜接現有 design.md 的 §1–§4（多圖層即時合成引擎）。本部分新增把視覺圖層掛回**遊戲狀態**的一層。
> 核心原則：**不新增畫面資產、盡量重用既有圖層**。所有「劇情/恐怖/幕後」演出都由既有的 `spineAngelDSpine`(dark skin)、`checkerboard`、`retroFilter`、`nestedScene3`、`eye`、`man`、`holographic` 依狀態被驅動。

## A-1. 屬性核心 `StatStore`（`src/core/StatStore.js`，新增）

沿用原作三大數值 + 一個計分值，掛在中央 store，對齊你現有的 `NeedyGirlState` / localStorage 與 `perf-monitor` 廣播模式：

| 屬性 | 範圍 | 語意 | 影響的圖層 |
|---|---|---|---|
| `affection` 好感度 | 0–100 | 她對「P君（玩家）」的愛 | holographic 色相、貼圖雨、Cucked 冷卻 |
| `stress` 壓力 | 0–120 | 直播焦慮；>80 觸發崩潰 | retroFilter 閃爍、checkerboard 震動 |
| `darkness` 陰暗度 | 0–100 | 決定畫面往恐怖/幕後偏移多少 | Spine skin 切換、eye 密度、nestedScene3 |
| `followers` 粉絲數 | 0–9,999,999 | 計分板 + 最終大特效門檻 | 全域 overload |

介面：

```js
StatStore.get('darkness')
StatStore.apply({ stress:-12, darkness:+6 })   // 自動 clamp
StatStore.on('change', fn)                      // Pixi 圖層直接訂閱
// iframe 效果：廣播 { type:'ng-stat', stats:{...} }
```

- **持久化**：`getSnapshot()/applySnapshot()` 併進 💾/↺ 版面存檔流程。
- **廣播**：跟 `ng-perf-tier` 一樣 postMessage 給每個效果 iframe；Pixi 圖層直接 `on('change')`。
- **門檻事件**：跨越 60/80/100 時額外發 `ng-stat-threshold`（供 A-7 極值特效與 A-8 彩蛋掛鉤）。

## A-2. 事件導演 `MoodDirector`（`src/core/MoodDirector.js`，新增）— 解決「對話框怎麼觸發」

建議**混合觸發 + 壓力加權**：

| 觸發源 | 規則 |
|---|---|
| **計時（壓力加權）** | 間隔 `clamp(35 − stress*0.2, 8, 40) 秒`。壓力越高越頻繁、語氣越急 |
| **事件驅動** | 送完貼圖 / superchat / 屬性跨門檻後，插播一則反應對話 |
| **待機驅動** | 玩家 > 45 秒沒互動 → 焦慮台詞，並緩慢 −affection |
| **直播節奏** | 進入「直播尾聲」時強制觸發一次「唸 superchat」 |

MoodDirector 只負責「何時講、講哪組」，UI 交給 A-3 圖層；讀 `StatStore` 決定語氣（甜／普通／病嬌／崩潰）。

## A-3. 對話選項框（`UI/dialogue/`，新增 effect iframe 圖層）

- **型態**：`effect` 圖層套 `BaseIframeLayer`（同 `man`/`retroFilter`），z-index 介於聊天(11/12)與 retroFilter(25)，點擊穿透預設關、有對話時開。
- **外觀**：毛玻璃粉紫藍卡片 + `NGChatSilver` 字型，零成本融入。
- **內容**：一句台詞 + 2～3 選項膠囊。點選項 → `postMessage({type:'ng-choice', id})` → `StatStore.apply(delta)` → 關閉。

選項效果範例：

| 情境 | 選項 | Δ 屬性 |
|---|---|---|
| 她說直播好緊張 | 安撫她 | +affection 5, −stress 8 |
| 同上 | 叫她撐住繼續衝 | +followers, +stress 6 |
| 同上 | 已讀不回 | −affection 6, +darkness 4 |
| 她說想吃藥 | 遞藥 | −stress 12, +darkness 6 |
| 同上 | 阻止她 | +affection 3, +stress 4 |

## A-4. 貼圖互動 → 屬性（擴充 `StickerListLayer`）

在 §3.6 既有「點擊生成掉落分身」的 handler 尾端加 `StatStore.apply()`：

| 貼圖 | Δ 屬性 | 回應語氣 |
|---|---|---|
| ❤️ 愛心 | +affection 6 | 甜、撒嬌 |
| 💊 精神藥物 | −stress 12, +darkness 6 | 放鬆、放空 |
| 🍬 毒品糖果（最高階） | −stress 20, +darkness 14 | 亢奮、失焦 |
| 🐱 P君 | +affection 8, −stress 4 | 最愛 P君 |
| 📱 手機 | +followers（小）, 觸發推文 | 得意 |

**隱藏機制**：狂送同一張（10 秒內 5 次）→ 效果遞減 + 反應改變；3 秒內連送 💊 + 🍬 → **OD 事件**（`stress→0, darkness +25`）。

## A-5. Superchat 輸入 → 屬性（擴充 `UI/chat/` 輸入列）

**金額 × 關鍵字**雙軸。金額決定強度：

| 檔位 | 好感 | 粉絲 | 反應 |
|---|---|---|---|
| ¥100 | +2 | 小 | 隨口道謝 |
| ¥1,000 | +5 | 中 | 開心唸名字 |
| ¥10,000 | +10 | 大 | 整個人亮起來 |
| ¥50,000（紅） | +18 | 特大 | 激動告白 |

實作：送出時 `parseSuperchat(text)` → `{amount, keywordHits[]}` → 套金額 Δ + 關鍵字 Δ + MoodDirector 產生唸稿。

## A-6. 關鍵字 / 彩蛋觸發表（`src/core/keywordTable.js`，新增）

| 輸入內容 | 效果 |
|---|---|
| 甜言蜜語（cute / love / 加油 / 天使） | +affection 額外加成 |
| 惡意 / 酸民字眼 | +stress, +darkness；留言**不可刪** |
| `P-chan` / `中之人` / 本名 | **破第四面牆**：holographic 脈衝 + retroFilter 故障 |
| **暗黑關鍵字** `OD`/`overdose`/`光`/`死`/`消える` | **陰暗模式**：darkness 大幅 + |
| `raincandy` | 私密帳彩蛋（見 A-8） |
| 空白 / 長時間不送 | 緩慢 −affection |

## A-7. 極值超級特效 → 重用現有圖層（重點）

| 觸發條件 | 重用的既有圖層 | 演出（對映原作） |
|---|---|---|
| `darkness ≥ 80` | Spine 切 `spineAngelDSpine` dark skin、`checkerboard` 故障拉滿、`retroFilter` on、`eye` 加密、自動 spawn `nestedScene3` | 逐步「病んだ」化 |
| `darkness = 100` | 上述全開並鎖定 | **全畫面陰暗模式**（Welcome To My Religion） |
| `affection = 100` | `holographic` 鎖粉紅 + 愛心雨、`retroFilter` 暖調 | Ground Control to Psychoelectric Angel |
| `affection = 0` | `holographic` 關、`retroFilter` 去飽和 | Cucked |
| `stress ≥ 80` | `retroFilter` 閃爍加劇 + `checkerboard` 震動變密 | 崩潰前兆 |
| `stress = 120` | 強制 `nestedScene3` + skin dark + `man` 連發 | 強制 Darkness 直播 |
| `followers = 1,000,000` | 全效果拉滿 + 貼圖分身暴噴 | Internet Overdose |
| `followers = 9,999,999`（彩蛋） | 同上 + 特殊字卡 | Internet Runaway Angel |

> 價值所在：dark skin、故障、CRT、eye、nestedScene3 你**已經做好**，只要讓它們「訂閱屬性」，極值演出幾乎零新資產。

## A-8. 彩蛋路由 → 重用既有點擊路由

| 彩蛋 | 掛在哪 | 觸發 → 效果 |
|---|---|---|
| 淺層：點鏡頭/藥/旗 | Frame1 內點擊加判定區 | 命中特定 sprite → 冒台詞 |
| 雙帳號切換 | 小按鈕或 `live.*` 裝飾區 | `OMGkawaiiAngel`(甜) ↔ `raincandy`(厭世) |
| 幕後/中之人視角 | 連點 raincandy 3 下 | 切 skin dark + 場景轉「卸妝房間」感 |
| P君是幻想 | MoodDirector 偵測久未回應 | 畫面 glitch，暗示聊天室沒有對象 |
| 恐怖視角漸強 | `darkness` 訂閱（A-7） | 立繪/背景/聊天室隨陰暗度惡化 |
| 日記碎片收集 | 特定行為計數（如 🍬 前 4 次） | 解鎖背景故事頁，集滿 → 隱藏結局 |

## A-9. 資料流

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
                 └── threshold ──┘── ng-stat-threshold ── A-7 極值特效編排
                       │
                       ▼
                 MoodDirector → UI/dialogue 對話框
```

## A-10. 落地順序建議（最小可玩 → 完整）

1. **StatStore + Task Manager 面板**：四屬性可讀寫、右上顯示。
2. **貼圖 → 屬性**：最快見效。
3. **極值特效接線**：既有 dark skin / checkerboard / retroFilter 訂閱 `darkness`/`stress`。
4. **MoodDirector + UI/dialogue**：對話上線。
5. **superchat 輸入 + 關鍵字表**。
6. **彩蛋路由 + 日記碎片 + 30 天結局判定**。

> 建議加 **30 天倒數**當節奏容器：第 30 天用四屬性判定結局（對映原作 30 天多結局）。

---

# Part B — 原型機制攻略（觸發條件對照）

> 對象：`needygirl-gameplay-prototype.html` 目前實作的所有互動。數值為原型現值。

## B-0. 屬性總覽

| 屬性 | 初始值 | 範圍 | 血條顯示上限 |
|---|---|---|---|
| ♡ 好感度 affection | 50 | 0–100 | 100 |
| ⚡ 壓力 stress | 20 | 0–120 | 120 |
| 🌑 陰暗度 darkness | 10 | 0–100 | 100 |
| 👥 粉絲 followers | 1,200 | 0–9,999,999 | 1,000,000 |

## B-1. 表情變化（由上往下第一個成立者生效）

| 條件 | 表情 |
|---|---|
| darkness ≥ 80 | 😵‍💫 |
| stress ≥ 90 | 😱 |
| affection ≥ 90 | 🥰 |
| stress ≥ 60 | 😣 |
| darkness ≥ 50 | 🫥 |
| affection ≤ 15 | 🥀 |
| 其餘 | 😇 |

## B-2. 貼圖互動（點圖示 → 改屬性 ＋ 掉落分身 ＋ 回話）

| 貼圖 | 觸發效果 |
|---|---|
| ❤️ 愛心 | affection **+6** |
| 💊 精神藥物 | stress **−12**、darkness **+6** |
| 🍬 毒品糖果 | stress **−20**、darkness **+14** |
| 🐱 P君 | affection **+8**、stress **−4** |
| 📱 手機 | followers **+800** |

- **每次點擊** → 生成同款掉落分身（重力物理）。
- **刷屏遞減**：同一張 10 秒內第 5 次起該次增減 ×0.3；第 5 次時說「別一直洗貼圖啦 lol」；最後點擊後 10 秒歸零。
- **OD 組合**：💊 與 🍬 於 3 秒內先後各一次 → stress **歸零**、darkness **+25** ＋「OVERDOSE」提示。

## B-3. Superchat（金額 × 關鍵字，效果疊加）

### 金額檔

| 金額 | affection | followers | 附註 |
|---|---|---|---|
| ¥100 | +2 | +60 | — |
| ¥1,000 | +5 | +400 | — |
| ¥10,000 | +10 | +2,500 | — |
| ¥50,000 | +18 | +12,000 | 紅色醒目留言 |

### 關鍵字（第一個命中者生效）

| 類別 | 觸發字詞（不分大小寫） | 額外效果 |
|---|---|---|
| 甜言蜜語 | `cute` `love` `加油` `喜歡` `天使` `可愛` `最棒` `kawaii` | affection **+6** |
| 酸民 | `hate` `滾` `醜` `婊` `去死` `噁` `廢` | stress **+10**、darkness **+6** |
| 破第四面牆 | `p-chan` `p醬` `中之人` `本名` `裡面的人` | stress **+4** ＋ glitch 脈衝(160ms) |
| 暗黑 | `od` `overdose` `光` `死` `消える` `end` | darkness **+22**、stress **−6** ＋「陰暗模式」 |
| 彩蛋 | `raincandy` | 無屬性，私密帳彩蛋 |

- 空白輸入不送出；金額 Δ 與關鍵字 Δ 相加。

## B-4. 自動對話（MoodDirector）

- 間隔 = `max(8, 35 − stress × 0.2)` 秒（壓力越高越勤）；出現 9 秒後收起。

| 選擇條件 | 對話組 |
|---|---|
| darkness ≥ 60 | 消失主題 (dark) |
| stress ≥ 55 | 被黑想休息 (stress) |
| 其餘 | 日常嗨 (calm) |

| 對話組 | 選項 → 效果 |
|---|---|
| calm | 一起加油 → aff +5, str −3 ／ 衝粉絲數 → fol +1,500, str +6 ／ 不回 → aff −6, dark +4 |
| stress | 等你回來會更強 → aff +6, str −10 ／ 遞藥 → str −14, dark +8 ／ 別理酸民 → str −4 |
| dark | 我永遠記得你 → aff +8, dark −8 ／ 別說傻話 → str −2 ／ …… → dark +10, aff −4 |

## B-5. 待機懲罰

- 每 5 秒待機 +1；任何點擊歸零。計數到 9（≈45 秒）→ 焦慮台詞、affection **−3**、stress **+3**、歸零。

## B-6. 極值超級特效

| 觸發條件 | 效果 |
|---|---|
| darkness ≥ 80 | 陰暗模式：色相偏移、場景轉暗 |
| darkness = 100 | 疊腐化抖動動畫 |
| stress = 120 | 崩潰震動 |
| affection = 100 | 愛心 bloom（每 120ms 噴愛心）＋「Ground Control」提示；<100 停 |
| affection = 0 | Cucked：去飽和轉灰 |
| followers ≥ 1,000,000 | Internet Overdose：全螢幕過載脈衝 |

## B-7. 隱藏/彩蛋速查

| 想觸發 | 怎麼做 |
|---|---|
| OD 事件 | 3 秒內連點 💊 ＋ 🍬 |
| 陰暗模式 | 狂點 🍬 或 superchat 打 `OD`/`光`/`死` |
| 畫面 glitch | superchat 打 `P-chan`/`中之人`/`本名` |
| 私密帳彩蛋 | superchat 打 `raincandy` |
| 好感 MAX 愛心雨 | 狂點 ❤️/🐱 到 affection 100 |
| Cucked 灰畫面 | 持續不回、待機掉好感到 affection 0 |
| 網路暴走 | 反覆高額 superchat／點 📱 到 followers 100 萬 |

## B-8. 各結局狀態最快路徑

| 目標 | 最快操作 |
|---|---|
| Ground Control（全好感） | 連點 ❤️＋🐱／高額 superchat＋甜言蜜語 → affection 100 |
| 全陰暗 | 連點 🍬／打暗黑關鍵字 → darkness 100 |
| 崩潰（Darkness 直播） | 選「衝粉絲數」狂加壓、不降壓 → stress 120 |
| Cucked | 一直不理＋選「不回」→ affection 0 |
| Internet Overdose | 拼 📱＋高額 superchat → followers 100 萬 |

---

# Part C — 台詞庫（英文原句 ＋ 中文對照 ＋ 出處）

> 角色：**KAngel**＝直播人設；**Ame（あめちゃん）**＝本人/中之人。遊戲魅力在於同一則貼文「人設 vs 真心話」的落差。
> **分級**：**A 級**＝直接取自 wiki 逐字收錄的遊戲內文（官方英文在地化）；**B 級**＝二手彙整引用，使用前建議再核。
> Ame 英文原句刻意保留全小寫、無標點的厭世口吻，是官方在地化風格。

## C-1. 人設 vs 中之人：同一時刻的兩面（A 級，最推薦）

| KAngel（公開） | Ame（真心話） |
|---|---|
| "Hiii it's your internet angel and savior KAngel!! Let's get this bread!! And don't forget to smile!!!"<br>嗨嗨～是你們的網路天使兼救世主 KAngel！衝一波啦！別忘了微笑喔！！！ | "i took a whole bunch of sleeping pills last night coz i couldnt sleep but now im super sleepy and my head hurts… i feel like absolute shit…"<br>昨晚睡不著吞了一大把安眠藥…現在超睏又頭痛…整個人爛透了… |
| "Hey, can I ask you guys something? Am I cute today? Like always?"<br>欸，可以問你們一件事嗎？我今天可愛嗎？跟平常一樣？ | "im gonna kill anyone who doesnt say im cute"<br>誰敢說我不可愛我就殺了他 |
| "To all my followers: I love you"<br>給我所有的追隨者：我愛你們 | "i love my fans… as long as they give me money and validation…"<br>我愛我的粉絲…只要他們給我錢跟認同… |
| "I've been getting a lot of hate recently… I might need to take a bit of a break… When I'm back, I'll be better and stronger!"<br>最近收到好多惡意…可能得暫停一下…等我回來會變得更好更強！ | "i hope all the haters fucking die…"<br>希望酸民全都去死… |
| "Good morning! And good luck to everyone who has work or school! I'll be watching over you all~"<br>早安！祝每個上班上學的人順利！我會守護你們～ | "work and school are both so useless, just quit everything and dedicate all your time to me"<br>上班上學都超沒用，全部辭掉，把時間全獻給我 |

## C-2. 神格化／消失名句（A 級，適合陰暗/結局演出）

- "Even if i disappear one day, please never forget that I existed… that the internet angel existed in this moment."<br>就算有一天我消失了，也請永遠別忘記我曾經存在過…別忘記這位網路天使曾在這一刻存在過。
- "Within me is a small galaxy, and millions of beautiful, twinkling stars… but my galaxy may fall apart one day, so I hope you'll gaze upon the stars while you still can."<br>我體內有一個小小的銀河，還有數百萬顆閃爍的星星…但它也許有一天會崩解，趁還能看的時候好好凝望吧。
- "If I ever leave the internet, I'll just go from an internet angel to a regular angel… a real angel that has left cyberspace and ascended to Heaven."<br>如果我離開網路，就會從網路天使變成一般的天使…離開網路空間、升上天堂的真正天使。
- **Ame 對照**："…i want to shine as brightly as i can through her before i eventually fall to pieces."<br>在我最終碎掉之前，我想透過她盡可能發光。

## C-3. 關於 P君

| 級 | EN | 中文 |
|---|---|---|
| A | "…if i really had to pick one, id probably pick you" | 真要我選一個的話，我大概會選你 |
| B | "P-chan, you're my producer, my boyfriend, and my god." | P醬，你是我的製作人、我的男朋友、也是我的神。 |
| B | "You're the only one I really need." | 你是我唯一真正需要的人。 |

## C-4. 觀眾 Super Chat 留言（A 級，逐字）

- "Gave you 200k yen in super chats, you gave me 1085278634 courage" — 我給了 20 萬日圓 super chat，你給了我 1085278634 份勇氣
- "KAngel, I'm going to be a father next month so I'm going to start saving all my Super Chats for my daughter…" — KAngel，我下個月要當爸爸了，要把 super chat 存給女兒…
- "my mom got really angry at me after i used her card to give you superchats pay me back >:(" — 我用我媽的卡給你 super chat，她氣炸了，賠我 >:(
- "…I have been giving you Super Chats every day… I cannot help but feel that you are perhaps avoiding me?" — 我每天給你 super chat…你是不是在躲我？
- "what do you spend our superchats on? stuff for your boyfriend?" — 你把我們的 super chat 花去哪？買東西給男朋友喔？

---

## 參考來源

- **A 級（逐字）**：Internet / Tweeter 貼文與留言 — NEEDY STREAMER OVERLOAD Wiki：https://needystreameroverload.wiki.gg/wiki/Internet
- 直播與 Superchat 機制 — https://needystreameroverload.wiki.gg/wiki/Stream
- 三大屬性 / 藥物（Medication / Magicals）— NEEDY STREAMER OVERLOAD Fandom Wiki
- 結局（對映極值特效）— https://needy-streamer-overload.fandom.com/wiki/Endings
- B 級（關係名句）— Characters / Quotes, TV Tropes 及 quote 聚合站（使用前建議再核逐字稿）
