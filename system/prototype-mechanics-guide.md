# NeedyGirl 原型 — 互動機制攻略（觸發條件對照表）

> 對象：`needygirl-gameplay-prototype.html` 目前實作的所有互動。
> 格式：**做 XXX → 觸發 XXX**。所有數值皆為原型現值，可直接當實作規格參照。

---

## 0. 屬性總覽

| 屬性 | 初始值 | 範圍 | 血條顯示上限 |
|---|---|---|---|
| ♡ 好感度 affection | 50 | 0–100 | 100 |
| ⚡ 壓力 stress | 20 | 0–120 | 120 |
| 🌑 陰暗度 darkness | 10 | 0–100 | 100 |
| 👥 粉絲 followers | 1,200 | 0–9,999,999 | 1,000,000 |

所有增減都會 clamp 在範圍內；每次變動即時重算血條、表情、極值狀態。

---

## 1. 表情變化（依當下屬性，由上往下第一個成立者生效）

| 條件 | 表情 |
|---|---|
| darkness ≥ 80 | 😵‍💫 |
| stress ≥ 90 | 😱 |
| affection ≥ 90 | 🥰 |
| stress ≥ 60 | 😣 |
| darkness ≥ 50 | 🫥 |
| affection ≤ 15 | 🥀 |
| 其餘 | 😇 |

---

## 2. 貼圖互動（點圖示 → 改屬性 ＋ 掉落分身 ＋ 回話）

| 貼圖 | 觸發效果（屬性） |
|---|---|
| ❤️ 愛心 | affection **+6** |
| 💊 精神藥物 | stress **−12**、darkness **+6** |
| 🍬 毒品糖果 | stress **−20**、darkness **+14** |
| 🐱 P君 | affection **+8**、stress **−4** |
| 📱 手機 | followers **+800** |

**附加規則**
- **每次點擊** → 生成一張同款掉落分身（重力物理，掉出畫面即銷毀）。
- **刷屏遞減**：同一張貼圖 10 秒內累積點擊，**第 5 次起**該次屬性增減全部 ×0.3（四捨五入）；剛好第 5 次時她說「別一直洗貼圖啦 lol」。最後一次點擊後 10 秒計數歸零。
- **OD 組合技**：💊 與 🍬 在 **3 秒內先後各點一次** → stress **直接歸零**、darkness **+25**、跳出「💊🍬 OVERDOSE」提示並說話。

---

## 3. Superchat（金額檔 × 關鍵字，兩者效果疊加）

### 3-1 金額檔（送出前先選金額鈕）

| 金額 | affection | followers | 附註 |
|---|---|---|---|
| ¥100 | +2 | +60 | — |
| ¥1,000 | +5 | +400 | — |
| ¥10,000 | +10 | +2,500 | — |
| ¥50,000 | +18 | +12,000 | 紅色醒目留言樣式 |

### 3-2 關鍵字（輸入文字含以下字詞 → 額外效果；由上往下**第一個命中**者生效）

| 類別 | 觸發字詞（不分大小寫） | 額外效果 |
|---|---|---|
| 甜言蜜語 | `cute` `love` `加油` `喜歡` `天使` `可愛` `最棒` `kawaii` | affection **+6** |
| 酸民 | `hate` `滾` `醜` `婊` `去死` `噁` `廢` | stress **+10**、darkness **+6**（留言不可刪） |
| 破第四面牆 | `p-chan` `p醬` `中之人` `本名` `裡面的人` | stress **+4** ＋ **畫面 glitch 脈衝**（反相/色相偏移 160ms） |
| 暗黑關鍵字 | `od` `overdose` `光` `死` `消える` `end` | darkness **+22**、stress **−6** ＋ 跳「🌑 陰暗模式」 |
| 彩蛋 | `raincandy` | 無屬性變動，跳「🐇 raincandy」私密帳彩蛋 |

- 空白輸入 → 不送出。
- 金額 Δ 與關鍵字 Δ **會相加**（例：¥10,000＋含 "cute" → affection +16）。

---

## 4. 自動對話（MoodDirector）

### 4-1 觸發時機
- **下一則對話間隔＝ `max(8, 35 − stress × 0.2)` 秒**。壓力越高 → 跳得越勤（最短 8 秒）。
- 對話出現後 **9 秒**自動收起。

### 4-2 依心情選對話（由上往下第一個成立）

| 條件 | 對話組 |
|---|---|
| darkness ≥ 60 | 「消失」主題（dark） |
| stress ≥ 55 | 「被黑想休息」主題（stress） |
| 其餘 | 「日常嗨」主題（calm） |

### 4-3 各對話的選項效果

| 對話組 | 選項 → 效果 |
|---|---|
| **calm** | 一起加油 → affection +5, stress −3 ／ 衝粉絲數 → followers +1,500, stress +6 ／ ……（不回）→ affection −6, darkness +4 |
| **stress** | 等你回來會更強 → affection +6, stress −10 ／ 遞藥給你 → stress −14, darkness +8 ／ 別理酸民啦 → stress −4 |
| **dark** | 我永遠記得你 → affection +8, darkness −8 ／ 別說傻話 → stress −2 ／ …… → darkness +10, affection −4 |

---

## 5. 待機懲罰

- 每 5 秒待機計數 +1；**任何點擊**歸零。
- 計數到 9（≈ 45 秒無互動）→ 她說焦慮台詞、affection **−3**、stress **+3**，計數歸零。

---

## 6. 極值超級特效（跨門檻自動觸發）

| 觸發條件 | 效果（畫面狀態） |
|---|---|
| darkness ≥ 80 | **陰暗模式**：全畫面色相偏移、場景轉暗、角色變暗（`body.dark`） |
| darkness = 100 | 上述再疊 **腐化抖動動畫**（`body.darkmax`） |
| stress = 120 | **崩潰震動**：舞台持續抖動（`body.shake`） |
| affection = 100 | **愛心 bloom**：每 120ms 從底部噴愛心 ＋ 跳「♡ Ground Control to Psychoelectric Angel ♡」；affection 掉回 <100 即停 |
| affection = 0 | **Cucked**：畫面去飽和轉灰（`body.cucked`） |
| followers ≥ 1,000,000 | **Internet Overdose**：全螢幕過載脈衝發光（`body.overload`） |

同時右下狀態列會顯示：`陰暗模式 ON`／`壓力爆表→崩潰`／`好感 MAX`／`Cucked`／`★ Internet Overdose`。

---

## 7. 隱藏 / 彩蛋速查

| 想觸發 | 怎麼做 |
|---|---|
| OD 事件 | 3 秒內連點 💊 ＋ 🍬 |
| 陰暗模式（畫面變黑） | 狂點 🍬 把 darkness 推到 80／或 superchat 打 `OD`、`光`、`死` |
| 畫面 glitch | superchat 打 `P-chan`／`中之人`／`本名` |
| 私密帳彩蛋 | superchat 打 `raincandy` |
| 好感 MAX 愛心雨 | 狂點 ❤️／🐱 把 affection 衝到 100 |
| Cucked 灰畫面 | 持續不回對話、待機掉好感，或選「……（不回）」把 affection 壓到 0 |
| 網路暴走（Overload） | 反覆送高額 superchat／點 📱 把 followers 推到 100 萬 |

---

## 8. 一頁速查：達成各結局狀態的最快路徑

| 目標狀態 | 最快操作 |
|---|---|
| 全好感結局（Ground Control） | 連點 ❤️（+6）＋🐱（+8），或高額 superchat 疊甜言蜜語，把 affection 拉到 100 |
| 全陰暗（Welcome To My Religion 氛圍） | 連點 🍬（darkness +14/次），或打暗黑關鍵字（+22/次）到 100 |
| 崩潰（Darkness 直播） | 選「衝粉絲數」狂加 stress、避免降壓，把 stress 推到 120 |
| Cucked（被甩） | 一直不理她＋選「不回」，affection 歸 0 |
| Internet Overdose | 拼命 📱＋高額 superchat 衝 followers 到 100 萬 |

> 註：以上為**原型**的簡化數值與判定，正式版建議加 30 天倒數作為節奏容器，並在第 30 天用四屬性判定跑哪個結局（見 `design-gameplay-layer.md` §5.7 對映原作結局）。
