import { BaseImageLayer } from './BaseImageLayer.js';
import { attachDomOverlay } from './domSpriteOverlay.js';
import { DialogueStore } from '../core/DialogueStore.js';
import { StatStore, STAT_RANGE } from '../core/StatStore.js';

// Custom module for the "frame1" image entry (see scripts/scan-assets.js's
// customModuleFor — an id of "frame1" auto-wires to this file's default
// export, no manifest.json hand-edit needed) — adds the dialogue system UI
// on top of the plain BaseImageLayer behaviour every other manifest image
// gets for free.
//
// frame1's own sprite is intentionally invisible in the saved layout
// (state.json — frame1B is the visible skin drawn over frame1's box, see
// mobileWiden.js's comment on that split); frame1 itself only exists as the
// stable geometry every other frame1-anchored system (holographicLayer,
// stickerListLayer, EffectDirector's window-break) already reads position/
// size off. The dialogue UI follows that same convention: its bubble tracks
// frame1's live sprite bounds via attachDomOverlay, but its own visibility is
// driven purely by DialogueStore state, never by frame1.sprite.visible — if
// this instead hid alongside frame1's own (permanently-off) render flag the
// whole feature would just never appear.
//
// Two independent pieces of UI, per system/NeedyGirl-互動設計-完整文件.md §A-3:
//  - a monologue "bubble" (self-talk) — docked to the BOTTOM of Frame 1's own
//    box, full-width, square corners, chunky white border: a subtitle/
//    caption-log strip (matches the streaming-window reference screenshot),
//    not a floating speech bubble with a tail
//  - a full-viewport-width choice bar, deliberately NOT confined to Frame 1
//    (§A-3: "選項是滿版的") — appended straight into #stage-world instead of
//    tracked against any sprite, since #stage-world already fills the same
//    box #stage-area does (see index.html), no per-frame reposition needed.
// Both read multi-language content from dialogueScript.js through
// DialogueStore, and both are pure renderers — DialogueDirector.js is what
// actually decides when Angel has something to say. Every panel (bubble,
// choice prompt/buttons, the permanent stat meter) shares the same
// square-cornered, thick white "8-bit" border treatment for a consistent
// retro-UI read. The stat meter (see buildStatHud()/_repositionStatHud())
// is the one exception to "everything here tracks Frame 1's own box" — it
// deliberately sits outside Frame 1 entirely, in the gap between the
// sticker row and the chat panel (user-provided reference screenshot).

const FRAME_REF_W = 1281; // UI/Frame 1.png's native px width — see chat.chatboardLayer.js's CHAT_REF_W for the same "--ng-u" scaling pattern
const BUBBLE_Z = 13; // above chat's message (11) / border (12) DOM overlays
const CHOICE_Z = 23; // above stickerList's icons (22), below yandereProto hearts (24) and retroFilter's constant front (25)

// --ng-u/--ng-cu (below) are both derived from the overall game viewport's
// own fit-scale (Stage.js's Math.min(w/1920, h/1080), directly for --ng-cu,
// indirectly via frame1's on-screen width for --ng-u) — on a small mobile
// screen that scale is small, so every text-bearing panel using them (the
// dialogue bubble, the choice bar/buttons, the stat meter) shrinks in lock-
// step with the whole game's zoom-out and reads as too small to read
// (user-requested "對話跟選項 通話視窗 屬性等有包含文字的內容都要是mobile
// 模式的視窗大小而自適應放大 不然會太小"). --ng-tu/--ng-tcu are a second,
// boosted copy of those same units — used only for the parts of each panel
// that need to stay legible (text, icons, bar/border thickness) — so mobile
// gets those visibly bigger without changing the panels' own anchor
// positioning (which still keys off the true, unboosted unit).
const MOBILE_BREAKPOINT_PX = 1024; // same phone/tablet proxy as shared/device-perf.js
const MOBILE_TEXT_BOOST = 1.6;
function textBoost() {
  return window.innerWidth <= MOBILE_BREAKPOINT_PX ? MOBILE_TEXT_BOOST : 1;
}

const STYLE_ID = 'ng-dialogue-style';

// Builds a `clip-path: polygon(...)` that cuts one square notch (size s, in
// multiples of the given CSS unit var) out of each corner — border-radius
// reads as a hi-res anti-aliased curve, which doesn't match the blocky
// single-square corner of the 8-bit reference UI this needs to look like.
// Border/background naturally follow the clipped shape since clip-path clips
// the whole painted box; box-shadow does NOT (it's computed off the
// unclipped border box), so anything shadowing a clipped panel must use
// `filter: drop-shadow()` instead, which shadows the post-clip silhouette.
function pixelCornerClip(unitVar, s) {
  const u = `var(${unitVar}) * ${s}`;
  return (
    `polygon(` +
    `0 calc(${u}), calc(${u}) calc(${u}), calc(${u}) 0, ` +
    `calc(100% - ${u}) 0, calc(100% - ${u}) calc(${u}), 100% calc(${u}), ` +
    `100% calc(100% - ${u}), calc(100% - ${u}) calc(100% - ${u}), calc(100% - ${u}) 100%, ` +
    `calc(${u}) 100%, calc(${u}) calc(100% - ${u}), 0 calc(100% - ${u})` +
    `)`
  );
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  // Font: reuses the 'Silver' @font-face already declared globally in
  // index.html (font/Silver.ttf) — no need for a second @font-face block
  // the way chat.chatboardLayer.js's scoped 'NGChatSilver' does, since this
  // overlay lives in the same top-level document that face was declared in.
  style.textContent = `
    .ng-dlg-wrap {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      justify-content: flex-end;
      box-sizing: border-box;
      pointer-events: none;
      padding: 0 calc(var(--ng-u) * 16) calc(var(--ng-u) * 16);
    }
    .ng-dlg-bubble {
      display: none;
      position: relative;
      pointer-events: auto;
      box-sizing: border-box;
      background: linear-gradient(160deg, rgba(180, 124, 240, 0.75), rgba(140, 76, 212, 0.82));
      border: calc(var(--ng-tu) * 4) solid #fff;
      clip-path: ${pixelCornerClip('--ng-tu', 8)};
      padding: calc(var(--ng-tu) * 18) calc(var(--ng-tu) * 24);
      filter: drop-shadow(calc(var(--ng-tu) * 4) calc(var(--ng-tu) * 4) 0 rgba(20, 8, 40, 0.55));
      backdrop-filter: blur(9px);
      -webkit-backdrop-filter: blur(9px);
      color: #fff;
      font-family: 'Silver', -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif;
      font-size: calc(var(--ng-tu) * 32);
      line-height: 1.5;
      text-align: center;
      white-space: pre-line;
      cursor: none; /* stage-area's decorative pixel-cursor is the only cursor meant to show — see DragTransform.js's sprite.cursor comment */
      opacity: 0;
      transform: translateY(10px);
      transition: opacity .2s ease, transform .2s ease;
    }
    .ng-dlg-bubble.show { opacity: 1; transform: translateY(0); }
    .ng-dlg-hint {
      margin-top: calc(var(--ng-tu) * 8);
      font-size: calc(var(--ng-tu) * 14);
      opacity: .6;
      text-align: right;
    }
    .ng-stat-hud {
      position: absolute;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: calc(var(--ng-u) * 6);
      pointer-events: none;
    }
    .ng-stat-row {
      display: flex;
      align-items: center;
      gap: calc(var(--ng-u) * 4);
    }
    .ng-stat-icon {
      flex: 0 0 auto;
      height: calc(var(--ng-tu) * 32);
      width: auto;
      image-rendering: pixelated; /* small hand-drawn sprite, scaled up — see pixelCursor/style.css for the same convention */
      filter: drop-shadow(0 0 calc(var(--ng-tu) * 2) rgba(255, 255, 255, 0.7));
    }
    .ng-stat-title {
      flex: 0 0 auto;
      /* Fixed floor wide enough for the longest label ("Affection") in any
         supported language — .ng-stat-row's title column used to be
         content-sized, so each row's fixed hud width got split between
         title/.ng-stat-bar (flex:1) differently per label length, leaving
         rows with visibly mismatched bar lengths (e.g. "Stress"'s bar
         shorter than "Affection"/"Darkness"'s). Pinning the title column to
         one shared width makes every row's bar start (and end) at the same
         x regardless of label. */
      min-width: calc(var(--ng-tu) * 100);
      font-family: 'Silver', -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif;
      font-weight: 600;
      font-size: calc(var(--ng-tu) * 21);
      letter-spacing: .03em;
      color: #4b3d73;
      /* Silver.ttf ships one static weight, so plain font-weight alone only
         gets a browser's (inconsistent) synthetic-bold pass — a hairline
         stroke reinforces it just enough to read as weighted without going
         heavy. */
      -webkit-text-stroke: calc(var(--ng-tu) * 0.25) #4b3d73;
      text-shadow: 0 0 calc(var(--ng-tu) * 3) rgba(255, 255, 255, 0.8);
      white-space: nowrap;
    }
    .ng-stat-bar {
      flex: 1 1 auto;
      position: relative;
      height: calc(var(--ng-tu) * 26);
      box-sizing: border-box;
      overflow: hidden;
      border: calc(var(--ng-tu) * 3) solid #fff;
      background: linear-gradient(90deg, #ffbfe0 0%, #ffe3d6 55%, #fffaf4 100%);
      box-shadow: 0 0 0 calc(var(--ng-tu) * 1) rgba(40, 15, 70, 0.55);
    }
    .ng-stat-bar-fill {
      position: absolute;
      inset: 0 auto 0 0;
      width: 0%;
      background: #35c3f0;
      transition: width .45s ease;
    }
    .ng-dlg-choicebar {
      display: none;
      position: absolute;
      left: 0; right: 0; bottom: calc(var(--ng-cu) * 50);
      flex-direction: column;
      align-items: center;
      gap: calc(var(--ng-cu) * 16);
      padding: 0 calc(var(--ng-cu) * 64);
      box-sizing: border-box;
      pointer-events: none;
      opacity: 0;
      transform: translateY(14px);
      transition: opacity .22s ease, transform .22s ease;
    }
    .ng-dlg-choicebar.show { opacity: 1; transform: translateY(0); pointer-events: auto; }
    .ng-dlg-choice-prompt {
      font-family: 'Silver', -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif;
      color: #fff;
      font-size: calc(var(--ng-tcu) * 36);
      text-align: center;
      background: rgba(124, 66, 196, 0.72);
      border: calc(var(--ng-tcu) * 4) solid #fff;
      clip-path: ${pixelCornerClip('--ng-tcu', 8)};
      filter: drop-shadow(calc(var(--ng-tcu) * 4) calc(var(--ng-tcu) * 4) 0 rgba(20, 8, 40, 0.55));
      padding: calc(var(--ng-tcu) * 14) calc(var(--ng-tcu) * 26);
      backdrop-filter: blur(9px);
      -webkit-backdrop-filter: blur(9px);
      max-width: 100%;
      box-sizing: border-box;
    }
    .ng-dlg-choice-row {
      display: flex;
      flex-direction: column;
      gap: calc(var(--ng-tcu) * 12);
      width: 100%;
    }
    .ng-dlg-choice-btn {
      width: 100%;
      box-sizing: border-box;
      font-family: 'Silver', -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif;
      font-size: calc(var(--ng-tcu) * 30);
      color: #fff;
      background: linear-gradient(160deg, rgba(180, 124, 240, 0.68), rgba(140, 76, 212, 0.76));
      border: calc(var(--ng-tcu) * 4) solid #fff;
      clip-path: ${pixelCornerClip('--ng-tcu', 8)};
      filter: drop-shadow(calc(var(--ng-tcu) * 4) calc(var(--ng-tcu) * 4) 0 rgba(20, 8, 40, 0.55));
      padding: calc(var(--ng-tcu) * 15) calc(var(--ng-tcu) * 22);
      cursor: none; /* see .ng-dlg-bubble's cursor:none above */
      backdrop-filter: blur(9px);
      -webkit-backdrop-filter: blur(9px);
      transition: background .15s ease, transform .1s ease, filter .1s ease;
    }
    .ng-dlg-choice-btn:hover {
      background: linear-gradient(160deg, rgba(206, 156, 255, 0.8), rgba(166, 108, 236, 0.84));
      transform: translate(calc(var(--ng-tcu) * -1), calc(var(--ng-tcu) * -1));
      filter: drop-shadow(calc(var(--ng-tcu) * 5) calc(var(--ng-tcu) * 5) 0 rgba(20, 8, 40, 0.55));
    }
    .ng-dlg-choice-btn:active {
      transform: translate(calc(var(--ng-tcu) * 4), calc(var(--ng-tcu) * 4));
      filter: none;
    }
  `;
  document.head.appendChild(style);
}

// Base CSS for .ng-dlg-bubble/.ng-dlg-stat-toast/.ng-dlg-choicebar defaults to
// display:none — all three carry backdrop-filter blur, which is expensive
// enough (samples everything rendered behind it: Pixi canvas + every other
// DOM effect overlay) that leaving them merely opacity:0 but still
// display:flex/block permanently kept that blur compositing alive even while
// no dialogue was showing, on top of getting re-triggered every animation
// frame by attachDomOverlay's per-tick reposition. This toggles real display
// in lockstep with the .show opacity/transform transition — display:none is
// deferred until the fade-out transition finishes (so it still animates out),
// and display is restored before the fade-in class is added (forcing a
// reflow first so the transition actually replays from a clean state).
function setPanelActive(el, active, showDisplay) {
  clearTimeout(el._ngHideTimer);
  if (active) {
    el.style.display = showDisplay;
    void el.offsetWidth;
    el.classList.add('show');
  } else {
    el.classList.remove('show');
    const ms = parseFloat(getComputedStyle(el).transitionDuration.split(',')[0]) * 1000 || 250;
    el._ngHideTimer = setTimeout(() => { el.style.display = 'none'; }, ms);
  }
}

function buildBubbleWrap() {
  const wrap = document.createElement('div');
  wrap.className = 'ng-dlg-wrap';

  const bubble = document.createElement('div');
  bubble.className = 'ng-dlg-bubble';
  const bubbleText = document.createElement('div');
  bubble.appendChild(bubbleText);
  const hint = document.createElement('div');
  hint.className = 'ng-dlg-hint';
  bubble.appendChild(hint);
  bubble.addEventListener('click', () => DialogueStore.dismiss());
  wrap.appendChild(bubble);

  // #stage-area's own click handler (main.js) would otherwise spawn a Nested
  // Scene 3 pop-up on top of the dialogue every time it's tapped — the
  // wrap's own DOM node still sits inside #stage-world (an ancestor of
  // #stage-area), so a click on the bubble (the wrap's only pointer-events:
  // auto child) bubbles all the way up unless stopped here, same reasoning
  // chat.chatboardLayer.js's own click/mousedown guards give.
  wrap.addEventListener('click', (e) => e.stopPropagation());

  return { wrap, bubble, bubbleText, hint };
}

// index -> StatStore key, top-to-bottom row order. followers row is
// temporarily dropped per user request (StatStore itself still tracks it
// same as ever, e.g. followerTicker's idle gain — just not shown here); a
// matching Icon_status_follower.png already sits at the project root
// alongside these three, so re-adding it later is just one more entry in
// each of STAT_HUD_KEYS/STAT_ICONS below.
const STAT_HUD_KEYS = ['affection', 'stress', 'darkness'];
// Root-relative like yandereProtoOverlay.js's own HEART_IMAGE_URL — these
// are plain hand-drawn PNGs, not manifest.json/PIXI.Assets-managed sprites,
// so a bare filename (resolved against index.html) is enough; no need to
// route them through the Pixi loader for a handful of static <img>s.
const STAT_ICONS = {
  affection: 'Icon_status_love.png',
  stress: 'Icon_status_stress.png',
  darkness: 'Icon_status_yami.png',
};
// Bold title next to the icon — same wording as chat.chatboardLayer.js's own
// STAT_LABELS (that file can't export a shared constant without becoming a
// cross-import for three strings, so this stays a local duplicate).
const STAT_LABELS = {
  zh: { affection: '好感', stress: '壓力', darkness: '黑化' },
  en: { affection: 'Affection', stress: 'Stress', darkness: 'Darkness' },
  ja: { affection: '好感度', stress: 'ストレス', darkness: 'ダークネス' },
  ko: { affection: '호감도', stress: '스트레스', darkness: '흑화' },
};

// Permanent (not event-triggered) meter — one bar per STAT_HUD_KEYS entry,
// filled to its current value/range ratio, no numbers (user-provided
// reference: a plain blue-fill-on-pink-cream-gradient slider, same look the
// old transient per-delta toast used, just always on now). Lives in its own
// independent element (see Frame1Layer's _repositionStatHud), not nested in
// buildBubbleWrap()'s `wrap` — this sits in the gap between the sticker row
// and the chat panel, outside Frame 1's own box entirely.
function buildStatHud() {
  const hud = document.createElement('div');
  hud.className = 'ng-stat-hud';
  hud.addEventListener('click', (e) => e.stopPropagation()); // see buildBubbleWrap()'s comment

  const rows = {};
  STAT_HUD_KEYS.forEach((key) => {
    const row = document.createElement('div');
    row.className = 'ng-stat-row';
    const icon = document.createElement('img');
    icon.className = 'ng-stat-icon';
    icon.src = STAT_ICONS[key];
    icon.alt = key;
    const title = document.createElement('div');
    title.className = 'ng-stat-title';
    const bar = document.createElement('div');
    bar.className = 'ng-stat-bar';
    const fill = document.createElement('div');
    fill.className = 'ng-stat-bar-fill';
    bar.appendChild(fill);
    row.append(icon, title, bar);
    hud.appendChild(row);
    rows[key] = { title, fill };
  });

  return { hud, rows };
}

function buildChoiceBar() {
  const bar = document.createElement('div');
  bar.className = 'ng-dlg-choicebar';
  bar.style.zIndex = String(CHOICE_Z);

  const prompt = document.createElement('div');
  prompt.className = 'ng-dlg-choice-prompt';
  bar.appendChild(prompt);

  const row = document.createElement('div');
  row.className = 'ng-dlg-choice-row';
  bar.appendChild(row);

  bar.addEventListener('click', (e) => e.stopPropagation()); // see buildBubbleWrap()'s comment

  return { bar, prompt, row };
}

export class Frame1Layer extends BaseImageLayer {
  constructor(opts) {
    super(opts);
    ensureStyles();
    this.manager = opts.manager; // needed to read the chat board's own box for _repositionStatHud()

    const { wrap, bubble, bubbleText, hint } = buildBubbleWrap();
    this._bubbleParts = { bubble, bubbleText, hint };
    // zIndex 13: above chat's message (11) / border (12) DOM overlays, well
    // below every stat-reactive effect (yandereProto 24, retroFilter 25, ...)
    // so a full-screen effect still reads as the true topmost layer.
    this._bubbleOverlay = attachDomOverlay(this, wrap, {
      zIndex: BUBBLE_Z,
      display: 'flex',
      onReposition: (b) => {
        const u = b.width / FRAME_REF_W;
        wrap.style.setProperty('--ng-u', `${u}px`);
        wrap.style.setProperty('--ng-tu', `${u * textBoost()}px`);
      },
    });
    // Always shown regardless of frame1.sprite.visible — see this file's top
    // comment on why frame1's own render flag can't gate the dialogue UI.
    wrap.style.display = 'flex';

    const { bar, prompt, row } = buildChoiceBar();
    this._choiceParts = { bar, prompt, row };
    document.getElementById('stage-world').appendChild(bar);
    this._offResize = this.stage.onResize(() => this._syncChoiceUnit());
    this._syncChoiceUnit();

    // Permanent stat meter — lives in the gap between the sticker row and
    // the chat panel (per user-provided reference screenshot), so it's its
    // own element positioned off frame1's + chat's own sprite bounds every
    // tick (two independent sprites to track, hence a dedicated ticker
    // callback rather than a single attachDomOverlay, which only tracks one).
    const { hud, rows } = buildStatHud();
    this._statHud = hud;
    this._statHudRows = rows;
    hud.style.zIndex = String(BUBBLE_Z);
    document.getElementById('stage-world').appendChild(hud);
    this._statHudLastPos = null;
    this._tickStatHud = () => this._repositionStatHud();
    this.stage.app.ticker.add(this._tickStatHud);
    this._updateStatHud();

    this._offDialogue = DialogueStore.on('change', (snap) => { this._render(snap); this._updateStatHud(); });
    this._offStat = StatStore.on('change', () => this._updateStatHud());
  }

  _syncChoiceUnit() {
    // Full-viewport-width choice bar isn't tied to any one sprite's box, so
    // its own "--ng-cu" unit is derived from the Stage's logical->screen
    // scale factor instead of a ratio-of-box-width like the bubble's --ng-u —
    // 1 unit == 1 logical (1920x1080-space) px, same space every Pixi sprite
    // on stage is already authored in.
    const cu = this.stage.scaleFactor;
    this._choiceParts.bar.style.setProperty('--ng-cu', `${cu}px`);
    this._choiceParts.bar.style.setProperty('--ng-tcu', `${cu * textBoost()}px`);
  }

  _render(snap) {
    const { bubble, bubbleText, hint } = this._bubbleParts;
    const { bar, prompt, row } = this._choiceParts;
    const lang = snap.lang;

    const isSay = snap.mode === 'say' && snap.entry;
    if (isSay) {
      bubbleText.textContent = snap.entry.text[lang] ?? snap.entry.text.en ?? '';
      hint.textContent = lang === 'zh' ? '（點一下略過）' : lang === 'ja' ? '（タップでスキップ）' : lang === 'ko' ? '(탭하면 넘기기)' : '(tap to skip)';
    }
    setPanelActive(bubble, !!isSay, 'block');

    const isChoice = snap.mode === 'choice' && snap.entry;
    if (isChoice) {
      prompt.textContent = snap.entry.prompt[lang] ?? snap.entry.prompt.en ?? '';
      row.innerHTML = '';
      snap.entry.choices.forEach((choice, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ng-dlg-choice-btn';
        btn.textContent = choice.label[lang] ?? choice.label.en ?? '';
        btn.addEventListener('click', () => DialogueStore.choose(i));
        row.appendChild(btn);
      });
    }
    setPanelActive(bar, !!isChoice, 'flex');
  }

  // Permanent meter (per spec: "在對話觸發屬性變化的時候在Frame1右下角說明
  // 屬性變化", extended per user request into an always-on readout of every
  // shown stat's current value, not just a pop-in-on-change toast) — one row
  // per STAT_HUD_KEYS entry: icon (static, set once in buildStatHud()), bold
  // title (follows DialogueStore's language), bar fill (follows StatStore's
  // current value/range ratio, no numbers). Re-run on every StatStore
  // 'change' (not just 'delta'/announce()) since this is a live readout now,
  // not a "something just happened" flash — the followerTicker's ambient
  // idle gain (silent on purpose for the old transient toast) is exactly the
  // kind of change this permanent meter exists to show creeping up. Also
  // re-run on DialogueStore 'change' so a language switch updates the titles.
  _updateStatHud() {
    const lang = DialogueStore.getLang();
    const labels = STAT_LABELS[lang] ?? STAT_LABELS.en;
    STAT_HUD_KEYS.forEach((key) => {
      const { title, fill } = this._statHudRows[key];
      title.textContent = labels[key] ?? key;
      const [lo, hi] = STAT_RANGE[key] ?? [0, 100];
      const pct = hi > lo ? Math.max(0, Math.min(100, ((StatStore.get(key) - lo) / (hi - lo)) * 100)) : 0;
      fill.style.width = `${pct}%`;
    });
  }

  // Tracks two independent sprites (frame1's own + the chat board's) every
  // tick, so a single attachDomOverlay (which only ever tracks one) doesn't
  // fit — same reasoning stickerListLayer.js's own per-tick _reposition()
  // gives for tracking its board. Anchored to sit in the gap between the
  // sticker row and the chat panel: right edge a fixed padding before the
  // chat board's own left edge, vertically starting just below frame1's own
  // bottom edge (the sticker row's own band, one board over).
  _repositionStatHud() {
    const chat = this.manager.get('chat.chatB') ?? this.manager.get('chat.chatboard');
    if (!this.sprite || !chat?.sprite) return;
    const fb = this.sprite.getBounds();
    const cb = chat.sprite.getBounds();
    if (!fb.width || !cb.width) return;
    const u = fb.width / FRAME_REF_W; // same ratio as the bubble wrap's own --ng-u
    // Negative: the panel's right edge tucks back UNDER frame1's own right
    // edge (per user request to keep shifting the whole thing further left),
    // rather than sitting just past it.
    const FRAME_PAD_U = -30;
    const CHAT_CLAMP_PAD_U = 20; // never let the panel cross into the chat board's own box
    const WIDTH_U = 380; // wider panel = more room for .ng-stat-bar (flex:1) since icon/title columns stay a fixed u-width — widened per user request for longer bars; right edge anchor unchanged, so this extends the panel further left
    // The available band between frame1's bottom edge and chat.chatboardLayer.js's
    // own viewport-pinned .ng-corner-hint text (bottom:14px, unscaled by any
    // --ng-u) measures out to a fairly stable ~155u across tested aspect
    // ratios — TOP_OFFSET_U (clearance from frame1's own border) plus the
    // hud's own content height (3 rows * 32u icon + 2 * 6u gap = 108u) needs
    // to leave enough of that budget for BOTTOM_MARGIN_U before the hint text.
    const TOP_OFFSET_U = 18;

    // Right edge anchored off frame1's own right edge (not the chat board's
    // left edge) per user request — panel then extends leftward from there,
    // under frame1's own right portion, instead of being pushed all the way
    // over against the chat panel. Still clamped to never cross into the
    // chat board's own box — at some aspect ratios the frame1-to-chat gap
    // pinches down to under 100px, well inside frame1RightX+FRAME_PAD_U*u.
    const right = Math.min(fb.x + fb.width + FRAME_PAD_U * u, cb.x - CHAT_CLAMP_PAD_U * u);
    const left = right - WIDTH_U * u;
    const top = fb.y + fb.height + TOP_OFFSET_U * u;

    const boost = textBoost();
    const prev = this._statHudLastPos;
    if (prev && Math.abs(prev.left - left) < 0.5 && Math.abs(prev.top - top) < 0.5 && Math.abs(prev.u - u) < 0.0001 && prev.boost === boost) return;
    this._statHudLastPos = { left, top, u, boost };

    Object.assign(this._statHud.style, { left: `${left}px`, top: `${top}px`, width: `${WIDTH_U * u}px` });
    this._statHud.style.setProperty('--ng-u', `${u}px`);
    this._statHud.style.setProperty('--ng-tu', `${u * boost}px`);
  }

  destroy() {
    this._offDialogue?.();
    this._offStat?.();
    this._offResize?.();
    this.stage.app.ticker.remove(this._tickStatHud);
    this._statHud.remove();
    this._bubbleOverlay.destroy();
    this._choiceParts.bar.remove();
    super.destroy();
  }
}

export async function create(opts) {
  // Unlike a plain manifest.json image entry (BaseImageLayer.create()'s own
  // `src: UI/${entry.file}` in main.js), a top-level entry with a custom
  // module skips that generic branch entirely — main.js just spreads the raw
  // manifest entry (only `file`, no `src`) at this module. See
  // spineAngelASpineLayer.js for the same fix-up.
  const src = `UI/${opts.file}`;
  const loaded = await PIXI.Assets.load(src);
  const sprite = loaded instanceof PIXI.Texture ? new PIXI.Sprite(loaded) : loaded;
  return new Frame1Layer({ ...opts, src, sprite });
}
