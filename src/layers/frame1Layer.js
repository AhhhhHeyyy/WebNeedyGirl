import { BaseImageLayer } from './BaseImageLayer.js';
import { attachDomOverlay } from './domSpriteOverlay.js';
import { DialogueStore } from '../core/DialogueStore.js';
import { StatStore, STAT_RANGE } from '../core/StatStore.js';
import { BOARDING_SAFE_PADDING_U } from '../core/boardingSafeArea.js';

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

// Stat HUD only (not the dialogue bubble/choice bar textBoost() also feeds) —
// user-requested: even after the width/height fit-scale caps (see
// _repositionStatHud()) stopped the panel from outgrowing its own box on a
// tablet, it still read as too large there relative to the rest of the UI. A
// flat cut on top of whatever fitScale the geometry caps already settled on,
// tablet/phone only (same breakpoint as textBoost() above) — desktop is
// untouched. First tried 0.7 (a 30% cut) — still read as too large on an
// iPad-size viewport (user report), so this is a second, larger cut.
const MOBILE_STAT_HUD_SCALE = 0.45;
function statHudMobileScale() {
  return window.innerWidth <= MOBILE_BREAKPOINT_PX ? MOBILE_STAT_HUD_SCALE : 1;
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
    /* Bridges the sticker row (rendered inside stickerListLayer.js's own
       full-viewport iframe) and .ng-stat-hud (a plain element in THIS
       document) into one real CSS flex relationship, with a guaranteed gap
       between them (user-requested) — the two used to be positioned by two
       completely independent JS anchor computations that could drift apart
       or overlap (the bugs this session has been fixing one at a time). An
       iframe's content can't literally be a flex sibling of a parent-
       document element, so .ng-sticker-slot below is a plain, never-painted
       placeholder that reserves the sticker row's own footprint as a normal
       flex item — the actual icons still render inside the iframe, on top
       of wherever this slot's live rect ends up (see stickerListLayer.js's
       _reposition(), which reads that rect back out every tick). */
    .ng-substat-row {
      position: absolute;
      display: flex;
      align-items: flex-start;
      box-sizing: border-box;
      /* Gap is set inline (see _repositionStatHud()'s row.style.gap), NOT
         driven by --ng-u here — user-requested "屬性條跟貼圖列的間隔太寬 導致
         壓到右邊聊天視窗" on some tablet viewports (e.g. 1366x1024): --ng-u on
         this row is set to hudU, the FIT-SCALED size used for the hud's own
         internal rendering (icon/text/bar sizes — see .ng-stat-hud's comment),
         which _repositionStatHud()'s heightFitScale intentionally grows past
         1x whenever there's spare vertical room below Frame 1. A non-16:9
         tablet aspect leaves exactly that kind of spare room, so hudU can end
         up well above the row's own u (Frame 1-width-derived scale) — a gap
         tied to hudU then rendered wider than GAP_U * u, the width-budget
         math below actually reserved for it, overflowing the row's real
         footprint into the chat board next to it. Setting gap inline from
         that same GAP_U * u value every tick keeps the rendered gap and the
         reserved-width math permanently in sync, instead of two independent
         "80" constants that only matched by coincidence whenever fitScale
         happened to sit near 1. */
      gap: 0px;
      pointer-events: none;
    }
    .ng-sticker-slot {
      flex: 0 0 auto;
      visibility: hidden;
    }
    .ng-stat-hud {
      flex: 0 0 auto;
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
      /* Fixed floor wide enough for the widest label among the CURRENTLY
         ACTIVE language's own three rows — .ng-stat-row's title column used
         to be content-sized, so each row's fixed hud width got split between
         title/.ng-stat-bar (flex:1) differently per label length, leaving
         rows with visibly mismatched bar lengths (e.g. "Stress"'s bar
         shorter than "Affection"/"Darkness"'s). Pinning the title column to
         one shared width makes every row's bar start (and end) at the same
         x regardless of label. --ng-stat-title-u itself is set (not a flat
         100 for every language) in _updateStatHud() below — a floor sized
         for English's "Affection" left a large dead gap in front of much
         shorter zh/ja/ko labels (好感/壓力/黑化 etc.), invisible at the panel's
         normal size but very visible once fitScale (see
         _repositionStatHud()) grows the whole panel past 1x on a tall/roomy
         viewport. 100 is just the fallback before the first _updateStatHud()
         run has measured anything. */
      min-width: calc(var(--ng-tu) * var(--ng-stat-title-u, 100));
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
      height: calc(var(--ng-tu) * 18.2); /* 26 shortened 30% per user request */
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
      cursor: none !important; /* see .ng-dlg-bubble's cursor:none above — !important plus the
        :hover/:active redeclarations below are belt-and-suspenders against the native arrow
        flashing back in on hover once this element's transform/filter start animating (only
        showed up in production, never on a local dev-server run, so it reads as a repaint-timing
        edge case rather than something a plain unqualified rule failed to cover) */
      backdrop-filter: blur(9px);
      -webkit-backdrop-filter: blur(9px);
      transition: background .15s ease, transform .1s ease, filter .1s ease;
    }
    .ng-dlg-choice-btn:hover {
      background: linear-gradient(160deg, rgba(206, 156, 255, 0.8), rgba(166, 108, 236, 0.84));
      transform: translate(calc(var(--ng-tcu) * -1), calc(var(--ng-tcu) * -1));
      filter: drop-shadow(calc(var(--ng-tcu) * 5) calc(var(--ng-tcu) * 5) 0 rgba(20, 8, 40, 0.55));
      cursor: none !important;
    }
    .ng-dlg-choice-btn:active {
      transform: translate(calc(var(--ng-tcu) * 4), calc(var(--ng-tcu) * 4));
      filter: none;
      cursor: none !important;
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

// See .ng-substat-row's own CSS comment (ensureStyles()) for why the sticker
// row and the stat HUD need a bridging placeholder rather than literally
// sharing a flex container across the iframe/parent-document boundary.
function buildSubStatRow() {
  const row = document.createElement('div');
  row.className = 'ng-substat-row';
  row.addEventListener('click', (e) => e.stopPropagation()); // see buildBubbleWrap()'s comment

  const stickerSlot = document.createElement('div');
  stickerSlot.className = 'ng-sticker-slot';
  row.appendChild(stickerSlot);

  const { hud, rows } = buildStatHud();
  row.appendChild(hud);

  return { row, stickerSlot, hud, rows };
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
    const { row: subStatRow, stickerSlot, hud, rows } = buildSubStatRow();
    this._subStatRow = subStatRow;
    this._stickerSlot = stickerSlot;
    this._statHud = hud;
    this._statHudRows = rows;
    subStatRow.style.zIndex = String(BUBBLE_Z);
    document.getElementById('stage-world').appendChild(subStatRow);
    this._statHudLastPos = null;
    this._lastAvailH = null; // see getStatRowAvailH()
    this._statTitleLangMeasured = null; // see _syncStatTitleWidth()
    this._statTitleUnits = 100; // matches ensureStyles()'s --ng-stat-title-u CSS fallback until the first measurement lands
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
    this._syncStatTitleWidth(lang);
  }

  // --ng-stat-title-u (read by .ng-stat-title's min-width, see ensureStyles())
  // is sized to the widest label among the CURRENT language's own three rows,
  // not a single constant shared across every language — a floor wide enough
  // for English's "Affection" left a big dead gap in front of much shorter
  // zh/ja/ko labels, invisible at the panel's normal size but very visible
  // once _repositionStatHud()'s fitScale grows the whole panel past 1x on a
  // tall/roomy viewport (user report). Measured via scrollWidth (temporarily
  // zeroing min-width so it doesn't measure its own floor) rather than derived
  // from character count, since Silver.ttf's Latin glyphs and the CJK
  // fallback fonts (PingFang TC/Microsoft JhengHei) don't share consistent
  // per-character metrics. Stored as a plain --ng-tu-relative ratio (width /
  // current tu), not a raw px value, so it stays correct as _repositionStatHud
  // grows/shrinks tu on every subsequent tick without re-measuring — only a
  // language switch (this method's only caller) can change which strings are
  // shown, so re-measuring on every StatStore-only 'change' (bar-fill updates,
  // no text change) would just waste a reflow for the same answer.
  _syncStatTitleWidth(lang) {
    if (this._statTitleLangMeasured === lang) return;
    const pos = this._statHudLastPos;
    const tu = pos && pos.u * pos.boost;
    if (!tu) return; // no geometry yet — _repositionStatHud()'s first tick re-invokes this once it has one (see below)
    this._statTitleLangMeasured = lang;
    let maxWidth = 0;
    STAT_HUD_KEYS.forEach((key) => {
      const { title } = this._statHudRows[key];
      const prevMinWidth = title.style.minWidth;
      title.style.minWidth = '0';
      maxWidth = Math.max(maxWidth, title.scrollWidth);
      title.style.minWidth = prevMinWidth;
    });
    const PADDING_U = 6; // breathing room so the bar never starts flush against the label's last glyph
    this._statTitleUnits = maxWidth / tu + PADDING_U;
    this._statHud.style.setProperty('--ng-stat-title-u', String(this._statTitleUnits));
  }

  // Tracks two independent sprites (frame1's own + the chat board's) every
  // tick, so a single attachDomOverlay (which only ever tracks one) doesn't
  // fit — same reasoning stickerListLayer.js's own per-tick _reposition()
  // gives for tracking its board. Positions .ng-substat-row (the shared flex
  // row — see ensureStyles()/buildSubStatRow()) to sit in the gap between
  // Frame 1 and the chat panel: left flush with Frame 1's own left edge,
  // right edge a fixed padding before the chat board's own left edge,
  // vertically starting just below frame1's own bottom edge. .ng-stat-hud's
  // own WIDTH is still computed here (capped by both WIDTH_FRACTION and
  // whatever room the sticker slot + gap leave it — see `width` below); its
  // horizontal POSITION next to the sticker slot is left entirely to the
  // row's own CSS flex layout.
  _repositionStatHud() {
    const chat = this.manager.get('chat.chatB') ?? this.manager.get('chat.chatboard');
    if (!this.sprite || !chat?.sprite) return;
    const fb = this.sprite.getBounds();
    const cb = chat.sprite.getBounds();
    if (!fb.width || !cb.width) return;
    const u = fb.width / FRAME_REF_W; // same ratio as the bubble wrap's own --ng-u
    // TOP_OFFSET_U/BOTTOM_SAFE_U/HINT_GAP_U are VERTICAL clearances, so they
    // need the game's true, uniform scale — NOT `u`, which is derived from
    // Frame 1's own on-screen WIDTH and can be inflated well past the real
    // scale by mobileWiden.js's width-only stretch on a wide/short viewport
    // (aspect > 16:9). On an extreme case like 741x313, mobileWiden stretches
    // Frame 1 hard to reclaim the wide pillarbox margin, so `u` overstates
    // the vertical scale substantially — multiplying these clearances by `u`
    // then overestimates how many real px they need, eating unnecessarily
    // into availH and crushing the whole panel (user report: the same
    // "shrinks for no real reason" symptom as the WIDTH_FRACTION bug, just
    // hitting a height rather than a width cap this time — same class of
    // "using the wrong unit for the wrong axis" bug).
    const vScale = this.stage.scaleFactor;
    const CHAT_CLAMP_PAD_U = 20; // never let the panel cross into the chat board's own box
    // Outer safety ceiling only — the REAL width cap in practice is the
    // leftover-space-after-sticker-and-gap calc further down (`maxRowWidth -
    // stickerWidth - gapPx`), which already reflects genuinely available
    // room up to the chat board's own edge. This constant used to be the
    // real, binding cap (0.4, from back when the sticker row and stat hud
    // were two independently-overlapping absolute boxes rather than flex
    // siblings sharing one row's worth of width) — left that low, it could
    // cap `width` well below what the leftover-space calc would actually
    // allow, which then made aspectFitScale (width/naturalHeight, see below)
    // needlessly crush the whole panel's height even when there was plenty
    // of vertical room to grow into (user report: "屬性條高度又太細了... 其實
    // 可以放大字跟圖 跟聊天室對其的" — the panel was shrinking for lack of
    // WIDTH room that, in reality, existed all the way out to the chat
    // panel). 1 (Frame 1's own full live width) is high enough to never
    // actually bind — the leftover-space calc is always tighter than that
    // in any layout where the sticker row exists at all.
    const WIDTH_FRACTION = 1;
    // Clearance from frame1's own bottom border before the hud starts — the
    // band between there and the boarding's own bottom edge isn't a fixed
    // budget (it shrinks on narrower viewports faster than this offset does),
    // so the actual "don't overflow" guarantee is the stageH clamp further
    // down, not a fixed constant here.
    const TOP_OFFSET_U = 18;

    const boost = textBoost();
    const rows = STAT_HUD_KEYS.length;
    const stageH = this.stage.height;

    // ---- Width: purely geometric, independent of the vertical fit below —
    // right edge flush with Frame 1's own right edge, EXCEPT when Frame 1's
    // box actually reaches (or nearly reaches) the chat board's own left
    // edge, in which case the chat clamp wins instead — a `min()` of the two
    // candidate right edges, not a width subtraction: at the usual aspect
    // ratio Frame 1's right edge already sits well clear of the chat board
    // (see the current viewport gap), so this ordinarily just resolves to
    // Frame 1's own edge with the chat clamp never binding.
    // rowLeft/right bound the WHOLE flex row (sticker slot + gap + stat
    // hud), not just the hud on its own — the row itself is what's
    // positioned via .ng-substat-row's inline left/top (see the bottom of
    // this method); the browser's own flex algorithm decides where the
    // sticker slot ends and the gap/hud begin, not two independently
    // hand-rolled anchor computations (see .ng-substat-row's own CSS
    // comment in ensureStyles() for why that used to be two separate boxes
    // that could drift apart or overlap).
    const right = Math.min(fb.x + fb.width, cb.x - CHAT_CLAMP_PAD_U * u);
    // Same "never let the generic safe-area pad silently override an anchor
    // that's flush with Frame 1's own edge" invariant stickerListLayer.js's
    // own former horizontal-branch clamp enforced (see boardingSafeArea.js's
    // minLeft option) — Frame 1's own edge is already whatever the boarding
    // considers safe, so this row (now anchored directly off it, rather than
    // stickerListLayer.js separately picking its own anchor) must never sit
    // further from the real edge than Frame 1 itself already does.
    const rowLeft = Math.max(Math.min(BOARDING_SAFE_PADDING_U * u, fb.x), fb.x);
    const maxRowWidth = Math.max(0, right - rowLeft);

    // GAP_U * u below is ALSO the value applied as the row's real inline
    // `gap` (see the Object.assign near the end of this method) — a single
    // source of truth now, instead of this constant only feeding the width
    // math while the CSS applied a second, independently-scaled copy (see
    // .ng-substat-row's own comment in ensureStyles() for the overflow bug
    // that mismatch caused).
    const GAP_U = 80;
    // Sticker slot's width, as last set by stickerListLayer.js's own icon-row
    // sizing math — read as a plain inline-style string parse (not
    // getBoundingClientRect()), so this never forces a layout read on its
    // own. 0 whenever stickerListLayer.js hasn't sized the slot yet (first
    // frame) or has deactivated it (its "narrow"/side-column mode floats
    // independently of this row entirely — see its own _reposition()) — in
    // either case the hud should just claim the row's full width alone, with
    // no dead gap reserved for a slot that isn't actually showing anything.
    const stickerActive = this._stickerSlot.style.display !== 'none';
    const stickerWidth = stickerActive ? (parseFloat(this._stickerSlot.style.width) || 0) : 0;
    const gapPx = stickerWidth > 0 ? GAP_U * u : 0;

    // Tried two different proportion-based ceilings here (against the
    // sticker row's own natural width, then against the hud's own icon+title
    // column width) chasing a "屬性條相對貼圖列來說拉得太長" report — both
    // ended up UNDER-shooting on other viewports (user follow-up on a
    // 983x513 case: "太短了 而且要對齊frame1右側才對"). The actually-wanted
    // reference was simpler and was already sitting right here: `right`
    // (above) is already `Math.min(fb.x + fb.width, ...)`, i.e. already never
    // further right than Frame 1's own right edge — so the ORIGINAL "hud
    // claims whatever's left of the row" formula already means the row's
    // total footprint (sticker + gap + hud) reaches exactly Frame 1's right
    // edge whenever that's the binding term (the common case), the same way
    // rowLeft already sits flush with Frame 1's LEFT edge. No extra ceiling
    // needed — the two proportion attempts above were solving the wrong
    // problem (icons reading small vs. the bar reading long is a real
    // mismatch, but shrinking the bar AWAY from Frame 1's own edge to fix it
    // just traded one visual complaint for another).
    const width = Math.max(0, Math.min(WIDTH_FRACTION * fb.width, maxRowWidth - stickerWidth - gapPx));

    // ---- Height: icon/text/bar-height scale (hudU) — shrinks the panel as
    // a whole (icons/text/bars/gaps all move together, since every one of
    // them is a multiple of --ng-u/--ng-tu) when the viewport is cramped,
    // but also grows it past the design size when there's spare vertical
    // room before the boarding/hint floor (user-requested: the bars used to
    // stay pinned at natural size even with plenty of clearance below Frame
    // 1) — via a single `fitScale` applied to `u` before any of the geometry
    // below is computed from it. This replaces the old approach of merely
    // clamping top into range, which kept the panel's origin inside the
    // boarding but did nothing about its far edge — on a short viewport
    // (mobileWiden's width stretch + textBoost's mobile font bump) the
    // panel's fixed row-height footprint could still be taller than the
    // space between the anchor and the boarding's own edge, so it spilled
    // out the bottom regardless of where its origin got clamped to.
    // fitScale sizing the panel to exactly fill whatever room is left (see
    // below) put its bottom edge flush against the boarding's own bottom
    // border with zero clearance — mathematically "not overflowing", but
    // visually indistinguishable from covering it (user report: the panel
    // still read as full-size and its bottom row still touched the pink/blue
    // decorative strip baked into the boarding art's bottom edge, at exactly
    // the aspect ratios where availH was only slightly less than
    // naturalHeight, so fitScale landed close to 1 with no visible shrink).
    // Reserving this margin out of availH up front forces a visibly smaller
    // fitScale — and therefore visibly thinner bars/icons/text, not just a
    // repositioned same-size panel — any time the fit is close, not only
    // when it's impossibly tight.
    // boarding.png's own decorative light-blue/purple bottom border starts at
    // y=1034 of its 1080-tall canvas (measured directly off the asset) — a
    // 46px-tall strip in the same native/1920x1080 space `vScale` (not `u` —
    // see vScale's own comment above) already tracks 1:1 with. The previous
    // 28.8 (a user-requested "20% bigger than 24" bump, tuned before this
    // measurement existed) was still short of that by a wide margin, so the
    // panel's bottom row could still land inside the border itself (user
    // report: "覆蓋到了boarding的淺藍色邊緣"). 56 clears the full 46px border
    // with a ~20% buffer, matching the sizing spirit of that earlier bump.
    const BOTTOM_SAFE_U = 56;
    const hintEl = document.querySelector('.ng-corner-hint');
    const stageAreaEl = hintEl && document.getElementById('stage-area');
    const topNatural = fb.y + fb.height + TOP_OFFSET_U * vScale;
    let floorNatural = stageH - BOTTOM_SAFE_U * vScale;
    if (hintEl && stageAreaEl) {
      const HINT_GAP_U = 6;
      const hintTop = hintEl.getBoundingClientRect().top - stageAreaEl.getBoundingClientRect().top;
      floorNatural = Math.min(floorNatural, hintTop - HINT_GAP_U * vScale);
    }
    const availH = Math.max(0, floorNatural - topNatural); // space between the panel's top anchor and its real floor
    // Cached so stickerListLayer.js's own icon sizing (getStatRowAvailH()
    // below) can respect the exact same vertical budget the hud itself is
    // capped to, instead of re-deriving its own copy of TOP_OFFSET_U/
    // BOTTOM_SAFE_U/HINT_GAP_U/vScale — see getStatRowAvailH()'s own comment.
    this._lastAvailH = availH;
    // Row stack height, mirroring the CSS math (see .ng-stat-hud/.ng-stat-icon
    // in ensureStyles()): each row's height is set by its tallest child (the
    // 32*--ng-tu icon) plus a --ng-u gap between rows, plus the hud
    // container's own top+bottom padding (user-requested: +10% — VPAD_TU is
    // 10% of one icon row's own height, applied on both the top and bottom).
    const VPAD_TU = 3.2;
    const rowsContentU = rows * 32 * boost + (rows - 1) * 6;
    const naturalHeight = u * (rowsContentU + 2 * VPAD_TU * boost);
    // No ceiling at 1 from the vertical fit alone (user-requested) — this
    // used to only ever shrink the panel to fit a cramped viewport, never
    // grow it back on a roomy one, so the bars stayed permanently thin even
    // with plenty of clearance above the boarding's own edge. availH already
    // has the boarding/hint floor baked in, so growing fitScale past 1 still
    // can't push the panel past either — it just claims whatever real
    // vertical slack is left.
    const heightFitScale = naturalHeight > 0 ? availH / naturalHeight : 1;

    // ---- Width ceiling: `width` above is a flat WIDTH_FRACTION of Frame 1's
    // own box, entirely independent of hudU — but .ng-stat-icon and
    // .ng-stat-title are both `flex: 0 0 auto` (never shrink), so as hudU
    // (driven by heightFitScale above) grows on a tall/roomy viewport, their
    // combined footprint eventually exceeds that fixed `width` outright.
    // .ng-stat-bar (the only flexible child, `flex: 1 1 auto`) absorbs that
    // first — its own width gets crushed toward 0 while its --ng-tu-driven
    // HEIGHT keeps growing, rendering as a tall useless sliver instead of a
    // bar — and past that point the row simply overflows its own box to the
    // right, bleeding into whatever sits next to it (the chat panel, then
    // the boarding art's own border — user report: "屬性bar整體太大 文字圖片跟
    // bar比例跑掉", "貼到boarding圖片"). Reusing the same per-hudU reserve math
    // CSS itself uses (icon height≈width + 2 row gaps + the title's own
    // measured floor, see _syncStatTitleWidth()) to solve for the largest
    // hudU that still leaves MIN_BAR_FRACTION of `width` for the bar, then
    // capping heightFitScale at whatever fitScale that hudU corresponds to —
    // so the panel now grows only as far as BOTH its vertical room and its
    // fixed-width row layout actually allow, instead of just the former.
    const MIN_BAR_FRACTION = 0.35;
    const ICON_U = 32; // .ng-stat-icon's own height (and, approximately, width — square source art)
    const ROW_GAP_U = 4; // .ng-stat-row's `gap`, in --ng-u (not --ng-tu) units; 2 gaps per row (icon-title, title-bar)
    const nonBarReservePerHudU = boost * (ICON_U + this._statTitleUnits) + 2 * ROW_GAP_U;
    const widthFitScale = nonBarReservePerHudU > 0 && u > 0
      ? ((1 - MIN_BAR_FRACTION) * width) / (nonBarReservePerHudU * u)
      : Infinity;

    // ---- Aspect-ratio ceiling: `width` is fixed (see above) but the panel's
    // rendered HEIGHT (naturalHeight * fitScale) still grows uncapped with
    // heightFitScale — on a narrow-but-tall viewport, widthFitScale alone
    // (which only guards a single ROW's width against its own icon+title)
    // doesn't stop the three stacked rows from ending up taller than the
    // panel is wide overall (user-requested: the panel must read as a
    // landscape rectangle, never taller than it is wide). Requiring
    // naturalHeight * fitScale <= width reduces to this — the same
    // solve-for-hudU shape as widthFitScale above, just against the whole
    // row-stack's height instead of one row's width reserve.
    const aspectFitScale = naturalHeight > 0 ? width / naturalHeight : Infinity;

    // fitScale combines all three geometry ceilings with the purely COSMETIC
    // tablet/phone shrink (user-requested: it read as too large on a tablet
    // even after the geometry caps above) — this drives ONLY the panel's own
    // internal rendering (hudU, via --ng-u/--ng-tu: icon/text/bar/gap sizes).
    // It must NOT also drive TOP_OFFSET_U/BOTTOM_SAFE_U/HINT_GAP_U below —
    // those are CLEARANCE from other content (Frame 1's own bottom edge, the
    // boarding's own edge, the corner hint), not part of how visually large
    // the panel itself reads. Using hudU for those gaps too meant that on
    // any viewport cramped enough to genuinely shrink heightFitScale (a
    // narrower-than-16:9 tablet aspect, not just mobile-breakpoint phones —
    // user report: it started overlapping Frame 1's own video on iPad-size
    // viewports well above the mobile breakpoint), the clearance gaps shrank
    // right along with the panel, eventually down to a visually
    // imperceptible sliver — the exact opposite of what a minimum clearance
    // is supposed to guarantee. TOP_OFFSET_U/BOTTOM_SAFE_U/HINT_GAP_U now use
    // `vScale` (see its own comment near `u`'s definition above — the game's
    // true uniform scale, never scaled down by the geometry ceilings or the
    // cosmetic mobile factor, and not inflated by mobileWiden's width-only
    // stretch the way `u` can be) instead — exactly the same unit topNatural
    // /floorNatural above already use, so the applied gaps now actually
    // match what they were computed against, instead of silently drifting
    // smaller (or, on a mobileWiden-stretched aspect, larger than intended).
    const fitScale = Math.min(heightFitScale, widthFitScale, aspectFitScale) * statHudMobileScale();

    // Readability PREFERENCE (user-requested: "確保一切都可讀" — on a short
    // viewport, in particular a landscape phone where Frame 1's own video
    // already claims most of the vertical space, heightFitScale can
    // legitimately compute to a tiny fraction since there's genuinely very
    // little room left below Frame 1 — but a panel merely "sized to fit
    // whatever's left" can shrink well past the point of being readable at
    // all). Prefers a stat title no smaller than MIN_TITLE_FONT_PX whenever
    // there's still room to fit that WITHOUT breaking the hard top/bottom
    // floors below — this used to apply unconditionally (a bare Math.max,
    // no fallback), which meant on any viewport short enough that the
    // boosted height genuinely didn't fit, it forced an overlap with Frame 1
    // /the boarding instead of giving way (user report: "450 高度以下的屬性
    // 條就已經會開始覆蓋人物跟boarding" — an abrupt overlap kicking in below a
    // threshold, not a smooth/adaptive shrink as height decreases).
    // First fix picked between two FIXED values — idealHudU (the floor-
    // preferring size) OR the raw unfloored u*fitScale — via a single
    // `idealHudHeight <= availH ? idealHudU : u*fitScale` branch. That still
    // had a cliff, just moved to a different height: idealHudU barely
    // depends on availH (minHudU is a flat constant), so right where it
    // stops fitting, hudU didn't ease down towards the floor — it fell
    // straight through it, all the way to u*fitScale (by construction
    // smaller than minHudU, that's why the floor exists in the first place)
    // — a visible jump between two adjacent heights (user report: two
    // screenshots only 3px of height apart, 444 vs 447, one reading as a
    // barely-visible sliver and the other fully legible, "還是有一樣的問題" —
    // this file's earlier vScale fix doesn't apply here, since both heights
    // land in the same width-bound regime of Stage.resize()'s
    // min(w/1920,h/1080), so u/vScale were nearly identical between them;
    // this cliff has a different cause). Clamping to hudMaxU — the largest
    // hudU that actually fits inside availH — instead of falling back to
    // u*fitScale makes the degradation continuous: hudMaxU shrinks smoothly
    // as availH shrinks and always sits >= u*fitScale (fitScale's own height
    // term IS availH/naturalHeight*u, i.e. hudMaxU with the mobileScale/
    // width/aspect ceilings folded in on top, so u*fitScale <= hudMaxU
    // always) — this can only ever match or beat the old fallback, never do
    // worse.
    const MIN_TITLE_FONT_PX = 11;
    const minHudU = MIN_TITLE_FONT_PX / (21 * boost); // 21 = .ng-stat-title's own font-size multiplier (ensureStyles())
    const rowsTotalU = rowsContentU + 2 * VPAD_TU * boost; // shared denominator — also used by hudHeight below
    const idealHudU = Math.max(u * fitScale, minHudU);
    const hudMaxU = rowsTotalU > 0 ? availH / rowsTotalU : idealHudU;
    const hudU = Math.min(idealHudU, hudMaxU);

    // Computed analytically (not measured via getBoundingClientRect) because
    // this runs every ticker frame — forcing a layout read here would cost a
    // reflow on every tick even when nothing moved, defeating the early-
    // return guard just below.
    const hudHeight = hudU * rowsTotalU;
    // Hard floor — Frame 1's own bottom edge (plus the fixed TOP_OFFSET_U
    // clearance) is the ONE thing `top` must never cross above, no matter
    // what. The readability floor (minHudU above) can make hudHeight taller
    // than availH ever assumed on an extremely short viewport, and the
    // "belt-and-suspenders" bottom/hint clamps below used to floor `top` at
    // a flat 0 instead of this anchor — meaning on a viewport short enough
    // that hudHeight didn't fit before either the boarding's bottom edge or
    // the corner hint, those clamps would happily pull `top` up ABOVE this
    // anchor, right back into Frame 1's own video (user report: "還是會有覆蓋
    // 到人物的狀況" on an even narrower/shorter screen than the tablet sizes
    // this was first fixed for). Between "slightly overlap the boarding's
    // own thin decorative edge" and "overlap the character art," the former
    // is the acceptable last resort — never the latter.
    const minTop = fb.y + fb.height + TOP_OFFSET_U * vScale;
    let top = minTop;

    // Belt-and-suspenders: fitScale already sizes the panel to fit inside
    // the natural-scale availH, but still re-clamp the origin against the
    // real viewport box (minus the same BOTTOM_SAFE_U clearance used to
    // derive fitScale, so this can't re-introduce the flush-against-the-edge
    // case fitScale was just sized to avoid) in case any offset shifted
    // between the natural-scale estimate above and this hudU-scaled geometry.
    top = Math.max(minTop, Math.min(top, stageH - BOTTOM_SAFE_U * vScale - hudHeight));

    // Independently clamping this panel and chat.chatboardLayer.js's own
    // corner hint each to their own slice of the boarding box (above) stops
    // either from spilling PAST the boarding, but says nothing about the two
    // spilling into EACH OTHER — on a short/cramped viewport (narrow phone/
    // tablet landscape) the gap this panel's TOP_OFFSET_U anchors into and
    // the hint's own bottom-right corner can end up being the same patch of
    // screen. The hint element is a plain DOM singleton (not reachable via
    // `this.manager`, which only indexes Pixi-side layers), so read its live
    // box directly and treat its top edge as this panel's real floor,
    // overriding the plain boarding clamp whenever it's the tighter limit.
    if (hintEl && stageAreaEl) {
      const HINT_GAP_U = 6;
      const hintTop = hintEl.getBoundingClientRect().top - stageAreaEl.getBoundingClientRect().top;
      // Re-floor at minTop (not 0) after this — see minTop's own comment:
      // staying clear of Frame 1's own video is the one non-negotiable
      // requirement here, ranked above fully clearing the hint too.
      top = Math.max(minTop, Math.min(top, hintTop - HINT_GAP_U * vScale - hudHeight));
    }

    const prev = this._statHudLastPos;
    if (prev && Math.abs(prev.left - rowLeft) < 0.5 && Math.abs(prev.top - top) < 0.5 &&
        Math.abs(prev.width - width) < 0.5 && Math.abs(prev.u - hudU) < 0.0001 && prev.boost === boost &&
        Math.abs(prev.gapPx - gapPx) < 0.5) return;
    this._statHudLastPos = { left: rowLeft, top, width, u: hudU, boost, gapPx };

    // --ng-u/--ng-tu are set on the ROW now (not directly on .ng-stat-hud) —
    // custom properties only inherit downward, and .ng-stat-hud is a CHILD
    // of .ng-substat-row now (see buildSubStatRow()), so it still picks up
    // the exact same inherited values its own CSS (ensureStyles()) expects.
    // `gap` is set here (not via --ng-u in CSS) so it always matches gapPx —
    // see .ng-substat-row's own comment in ensureStyles() for why tying it to
    // hudU instead caused an overflow into the chat board on some tablets.
    Object.assign(this._subStatRow.style, { left: `${rowLeft}px`, top: `${top}px`, gap: `${gapPx}px` });
    this._subStatRow.style.setProperty('--ng-u', `${hudU}px`);
    this._subStatRow.style.setProperty('--ng-tu', `${hudU * boost}px`);
    this._statHud.style.width = `${width}px`;
    // _syncStatTitleWidth() no-ops once already measured for the current
    // language — this only actually does anything the first time real
    // geometry (a nonzero tu) becomes available, since the constructor's own
    // initial _updateStatHud() call runs before this ticker callback has ever
    // fired once.
    this._syncStatTitleWidth(DialogueStore.getLang());
  }

  // Vertical budget between the stat row's own top anchor (flush below Frame
  // 1, see minTop above) and its real floor (the boarding's bottom edge or
  // chat's corner hint, whichever binds tighter) — shared with
  // stickerListLayer.js so the sticker icons (a flex SIBLING of the hud in
  // this exact same row, see .ng-substat-row's own CSS comment) can respect
  // the identical vertical ceiling instead of re-deriving their own copy of
  // TOP_OFFSET_U/BOTTOM_SAFE_U/HINT_GAP_U/vScale from scratch — two
  // independent copies of the same three constants is exactly how the hud's
  // own width/position used to silently drift from the sticker row before
  // the flex refactor (see this file's top comment). Null until the first
  // _repositionStatHud() tick has run (constructor's own initial
  // _updateStatHud() call doesn't reposition anything) — callers should
  // treat that as "no constraint yet", not zero.
  getStatRowAvailH() {
    return this._lastAvailH;
  }

  destroy() {
    this._offDialogue?.();
    this._offStat?.();
    this._offResize?.();
    this.stage.app.ticker.remove(this._tickStatHud);
    this._subStatRow.remove(); // takes .ng-sticker-slot and .ng-stat-hud with it, both its children
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
