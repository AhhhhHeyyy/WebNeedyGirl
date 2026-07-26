import { BaseImageLayer } from './BaseImageLayer.js';
import { attachDomOverlay } from './domSpriteOverlay.js';
import { StatStore } from '../core/StatStore.js';
import { DialogueStore } from '../core/DialogueStore.js';
import { matchMessage, KEYWORD_CATEGORIES } from '../core/keywordTable.js';
import { triggerAscensionFlood } from './yandereProtoOverlay.js';
import { LOGICAL_W, LOGICAL_H } from '../core/Stage.js';

// chat.chatboard (UI/chat/Chatboard.png) is the frame's lavender FILL —
// the actual message list + input bar seen in the reference mockup is real
// DOM content laid on top of it, not baked into the PNG, so it can use a
// real font (Silver.ttf) and a real scrollbar instead of a static
// screenshot. It's positioned as a plain sibling <div> inside #stage-area
// (the same coordinate box #pixi-stage itself fills) rather than routed
// through BaseIframeLayer: an iframe buys isolation this content doesn't
// need, at the cost of the postMessage plumbing every other DOM-overlay
// layer in this codebase (holographic/man/retroFilter) has to pay for it.
//
// The border frame is a SEPARATE asset (chat.chatB / ChatB.png, opaque
// border with a fully transparent middle) rendered by chat.chatBLayer.js
// one z-index above this file's own message overlay — see that file's
// comment for why the frame has to be its own DOM element too, instead of
// just staying a plain Pixi sprite. That's what sandwiches this message
// list between the two: fill (Pixi, bottom) -> messages (DOM) -> border
// frame (DOM, top).
//
// Chatboard.png is authored at 462x803 — CHAT_REF_W is that native width,
// used to scale fonts/paddings proportionally to however big the board
// sprite is actually dragged/scaled to (see the onReposition callback
// below), the same "measure once off the source art, scale by a ratio"
// approach eye.eyeLayer uses for its own window-cascade spacing.
const CHAT_REF_W = 462;

const MESSAGES = [
  { text: 'there there\n`(・ω・´)' },
  { text: 'i spat out my drink\nlmfao' },
  { text: 'Nooo not the copypasta' },
  { text: 'legend' },
  { text: 'Oh my god do we know\nthe copypastas?' },
  { text: '(´・ω・`) rip', kind: 'red' },
  { text: '(´・ω・`)' },
  { text: 'What did you write?', kind: 'yellow' },
];

// Superchat amount tiers (spec §8-2). Local simulator only for now — no real
// superchat platform is wired up (see keywordTable.js's own header); picking
// a tier button below just pre-loads this tier's delta for the next send.
//
// `color` follows 主播女孩重度依賴 (NEEDY GIRL OVERDOSE)'s streaming-UI
// convention of grading SC amount by hue — blue (cheapest) through green,
// yellow, orange, up to red (priciest) — reused here as the row highlight
// (see `.ng-chat-row.sc-*` below) so the amount tier is readable at a
// glance without reading the yen figure.
const SUPERCHAT_TIERS = [
  { amount: 100, color: 'blue', delta: { affection: 2, followers: 60 } },
  { amount: 1000, color: 'green', delta: { affection: 5, followers: 400 } },
  { amount: 5000, color: 'yellow', delta: { affection: 8, followers: 1800 } },
  { amount: 10000, color: 'orange', delta: { affection: 10, followers: 2500 } },
  { amount: 50000, color: 'red', delta: { affection: 18, followers: 12000 } },
];

// User-requested (not from the spec doc): the `升天` keyword's kaomoji flood
// (keywordTable.js's `ascension` category) normally plays its celebratory
// pool, but flips to the breakdown pool the moment either stress or darkness
// is over this line — read live at send time, not latched, so the same
// keyword can swing between moods across a session as those stats change.
const ASCENSION_NEGATIVE_THRESHOLD = 50;

// Null-safe key-wise add across up to two partial delta objects — only
// needed here since a superchat send can carry both a tier delta AND a
// keyword delta at once (sticker clicks never combine two sources).
function sumDeltas(a, b) {
  if (!a && !b) return null;
  const out = {};
  [a, b].forEach((d) => {
    if (!d) return;
    Object.entries(d).forEach(([key, v]) => { out[key] = (out[key] || 0) + v; });
  });
  return out;
}

// Only the stat labels/locked marker follow DialogueStore's language pick —
// the keyword lists themselves (cute/加油/kawaii/...) stay as-is regardless
// of language, since those are the literal strings matchMessage() looks for
// in whatever the player actually typed, not display text to translate.
const STAT_LABELS = {
  zh: { affection: '好感', stress: '壓力', darkness: '黑化' },
  en: { affection: 'Affection', stress: 'Stress', darkness: 'Darkness' },
  ja: { affection: '好感度', stress: 'ストレス', darkness: 'ダークネス' },
  ko: { affection: '호감도', stress: '스트레스', darkness: '흑화' },
};
const LOCKED_LABEL = { zh: '(不可刪)', en: '(locked)', ja: '（削除不可）', ko: '(삭제불가)' };
// Logical (1920x1080-space) values — scaled by Stage's own scaleFactor at
// resize time (see ChatBoardLayer's _repositionHint) so the hint's size and
// clearance from the frame's border grow/shrink in lockstep with everything
// else on stage instead of drifting at odd viewport sizes.
const HINT_MARGIN_X_LOGICAL = 2;
const HINT_MARGIN_Y_LOGICAL = 8;
const HINT_FONT_LOGICAL = 20;
const HINT_TITLE = {
  zh: '留言關鍵字提示:',
  en: 'Chat Keyword Hints:',
  ja: 'コメントキーワードヒント:',
  ko: '댓글 키워드 힌트:',
};
// The composer's own input placeholder — separate dict from HINT_TITLE
// above since it's set once per language switch (via input.placeholder),
// not rebuilt into a text node on every DialogueStore change.
const INPUT_PLACEHOLDER = {
  zh: '輸入留言…',
  en: 'Type a message…',
  ja: 'コメントを入力…',
  ko: '댓글을 입력하세요…',
};

function formatDelta(delta, lang) {
  const labels = STAT_LABELS[lang] ?? STAT_LABELS.en;
  return Object.entries(delta)
    .map(([key, v]) => `${labels[key] ?? key}${v > 0 ? '↑' : '↓'}`)
    .join('');
}

// keywordTable.js's own lists are deliberately unsplit by language (see its
// header — matchMessage() has to recognize a keyword no matter what script
// the player actually types), so the hint can't just read a per-language
// field off each category. Instead each keyword's script is detected on the
// fly: CJK-range keywords are shown only under their own UI language, while
// anything with no CJK/Hangul/Kana in it (cute, kawaii, p-chan, od, …) is
// script-neutral and shown under every language. That's what keeps zh-only
// terms like 加油/喜歡 out of the hint once the player switches to en/ja/ko.
function keywordScript(kw) {
  if (/[가-힣]/.test(kw)) return 'ko';
  if (/[぀-ヿ]/.test(kw)) return 'ja'; // hiragana/katakana
  if (/[一-鿿]/.test(kw)) return 'zh'; // bare Han (no kana) defaults to zh
  return null; // Latin/romanized — not any one language's script
}

function keywordsForLang(keywords, lang) {
  return keywords.filter((kw) => {
    const script = keywordScript(kw);
    return script === null || script === lang;
  });
}

// Built straight off KEYWORD_CATEGORIES so the hint can never drift out of
// sync with the actual table. Categories with an empty delta (currently only
// `easter`/raincandy) are skipped on purpose — it's meant to stay a secret,
// not get spoiled in a visible hint.
function buildKeywordHint(lang) {
  const locked = LOCKED_LABEL[lang] ?? LOCKED_LABEL.en;
  const title = HINT_TITLE[lang] ?? HINT_TITLE.en;
  const body = KEYWORD_CATEGORIES
    .filter((c) => Object.keys(c.delta).length > 0)
    .map((c) => {
      const kws = keywordsForLang(c.keywords, lang);
      return kws.length ? `${kws.join('/')} → ${formatDelta(c.delta, lang)}${c.locked ? locked : ''}` : null;
    })
    .filter(Boolean)
    .join('　｜　');
  return `${title}　${body}`;
}

const FONT_CSS_ID = 'ng-chat-font-face';
const STYLE_CSS_ID = 'ng-chat-overlay-style';
const CORNER_HINT_STYLE_ID = 'ng-corner-hint-style';

function ensureStyles() {
  if (!document.getElementById(FONT_CSS_ID)) {
    const fontStyle = document.createElement('style');
    fontStyle.id = FONT_CSS_ID;
    fontStyle.textContent = `
      @font-face {
        font-family: 'NGChatSilver';
        src: url('font/Silver.ttf') format('truetype');
        font-display: swap;
      }
    `;
    document.head.appendChild(fontStyle);
  }
  if (!document.getElementById(STYLE_CSS_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_CSS_ID;
    style.textContent = `
      .ng-chat-overlay {
        position: absolute;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        font-family: 'NGChatSilver', monospace;
        color: #4b3d73;
        pointer-events: none;
        user-select: none;
        /* Single source of truth for the superchat tier ladder's hues,
           consumed by the shared .sc-* classes below (applied to both the
           tier buttons and the SC message rows they produce). */
        --ng-sc-blue: #8ecae6;
        --ng-sc-green: #8fd19e;
        --ng-sc-yellow: #f2c94c;
        --ng-sc-orange: #f2994a;
        --ng-sc-red: #e5484d;
      }
      .ng-chat-messages-wrap {
        flex: 1 1 auto;
        min-height: 0;
        position: relative;
        display: flex;
      }
      .ng-chat-messages {
        flex: 1 1 auto;
        min-height: 0;
        min-width: 0;
        position: relative;
        z-index: 1;
        overflow-y: auto;
        overflow-x: hidden;
        pointer-events: auto;
        /* The native scrollbar is hidden in favor of a custom track+thumb
           (see .ng-chat-scrollbar-*  below) — native scrollbars only paint
           once content actually overflows (or, with overlay-style
           scrollbars, not reliably at all across platforms), but the
           reference mockup shows a gradient bar always present on the
           right edge, so it's drawn by hand instead and kept in sync with
           real scroll position via JS (see updateScrollbar in
           buildOverlay()). */
        scrollbar-width: none;
        -ms-overflow-style: none;
        /* Snap one message at a time instead of free-scrolling smoothly —
           the clunky "jump to the next row" feel of an old-school webpage,
           not a modern momentum scroll. scroll-snap-stop:always on each
           row (below) is what stops a fast swipe from skipping past
           several rows in one go. scroll-behavior stays 'auto' (not
           'smooth') on purpose: no eased animation, just an instant jump. */
        scroll-snap-type: y mandatory;
        scroll-behavior: auto;
      }
      .ng-chat-messages::-webkit-scrollbar { display: none; width: 0; height: 0; }
      .ng-chat-scrollbar-track {
        position: absolute;
        z-index: 2; /* explicitly above .ng-chat-messages (1) — a scrolling
                       overflow container otherwise seems to paint its
                       contents above a later, non-scrolling absolute
                       sibling despite DOM order, at least in Chromium */
        top: 0; bottom: 0;
        /* ChatB.png's opaque border is ~4-5px thick (measured off the
           462-wide source art) — inset past it so the bar sits inside the
           frame's transparent interior instead of being painted over by
           that border (chat.chatBLayer.js's overlay sits one z-index
           above this one). */
        right: calc(var(--ng-u) * 6);
        width: calc(var(--ng-u) * 7);
        background: rgba(120, 90, 160, 0.12);
        border-radius: calc(var(--ng-u) * 4);
        pointer-events: none;
      }
      .ng-chat-scrollbar-thumb {
        position: absolute;
        left: 0; right: 0;
        border-radius: calc(var(--ng-u) * 4);
        background: linear-gradient(180deg, #8fd3c7 0%, #e2a0d8 55%, #9b7fd4 100%);
        /* Draggable by mouse or finger — the track stays pointer-events:none
           (it's just decorative background), only the thumb itself is
           interactive. touch-action:none stops the browser from also
           trying to pan the page/scroll natively during a drag gesture. */
        pointer-events: auto;
        touch-action: none;
        cursor: none; /* the decorative pixel-cursor effect is the only cursor meant to show, not this native grab hand */
      }
      .ng-chat-row {
        display: flex;
        align-items: flex-start;
        gap: calc(var(--ng-u) * 5);
        padding: calc(var(--ng-u) * 6) calc(var(--ng-u) * 8);
        line-height: 1.3;
        white-space: pre-line;
        font-size: calc(var(--ng-u) * 40);
        scroll-snap-align: start;
        scroll-snap-stop: always;
      }
      .ng-chat-row.red { background: #c9534d; color: #2f2540; }
      .ng-chat-row.yellow { background: #f2e878; color: #2f2540; }
      .ng-chat-icon {
        flex: 0 0 auto;
        width: calc(var(--ng-u) * 12);
        height: calc(var(--ng-u) * 12);
        margin-top: calc(var(--ng-u) * 6);
        background: #5b67c7;
        border-radius: calc(var(--ng-u) * 2);
      }
      .ng-chat-inputbar {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        gap: calc(var(--ng-u) * 6);
        background: #fbf7fc;
        padding: calc(var(--ng-u) * 20) calc(var(--ng-u) * 10);
        border-top: calc(var(--ng-u) * 1.5) solid rgba(150, 120, 180, 0.25);
        pointer-events: auto;
      }
      .ng-chat-input {
        flex: 1 1 auto;
        height: calc(var(--ng-u) * 60);
        border: none;
        outline: none;
        /* Without this, some browsers' native text-input chrome (a faint
           inset shadow/gradient) shows through a plain background-color,
           keeping it from reading as the same flat fill as the (already
           appearance-less <button>) tier pills below it. */
        appearance: none;
        -webkit-appearance: none;
        border-radius: 999px; /* fixed, not --ng-u-scaled: always a full pill regardless of box size */
        background: #eee3f0;
        padding: 0 calc(var(--ng-u) * 8) 0 calc(var(--ng-u) * 20);
        font-family: inherit;
        font-size: calc(var(--ng-u) * 40);
        line-height: calc(var(--ng-u) * 60); /* == height, so text centers regardless of Silver.ttf's own ascent/descent metrics */
        color: #4b3d73;
        cursor: none; /* see the scrollbar thumb's cursor:none above — the decorative pixel-cursor is the only cursor meant to show, not a native text I-beam */
      }
      .ng-chat-input::placeholder { color: rgba(75, 61, 115, 0.4); }
      .ng-chat-toolbar {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: calc(var(--ng-u) * 6) calc(var(--ng-u) * 14) calc(var(--ng-u) * 10);
        background: #fbf7fc;
        pointer-events: auto;
      }
      .ng-chat-toolbar span {
        width: calc(var(--ng-u) * 14);
        height: calc(var(--ng-u) * 14);
        border-radius: 50%;
        background: #d8cbe0;
      }
      .ng-chat-toolbar span.send { background: #e08a9a; cursor: none; }
      .ng-chat-tierbar {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        gap: calc(var(--ng-u) * 6);
        padding: 0 calc(var(--ng-u) * 10) calc(var(--ng-u) * 8);
        background: #fbf7fc;
        pointer-events: auto;
      }
      .ng-chat-tier-btn {
        flex: 1 1 0;
        height: calc(var(--ng-u) * 34);
        border: none;
        border-radius: 999px;
        background: #eee3f0;
        color: #4b3d73;
        font-family: inherit;
        font-size: calc(var(--ng-u) * 24);
        cursor: none;
      }
      /* Selection state is a ring, not a fill swap — the button's own fill
         already carries its tier color (via the shared .sc-* classes below),
         so overriding background on .active would blow away the exact color
         cue the button exists to show. */
      .ng-chat-tier-btn.active { box-shadow: 0 0 0 calc(var(--ng-u) * 3) rgba(255, 255, 255, 0.85) inset; }
      /* Superchat tier colors (spec §8-2), graded low → high amount the same
         way 主播女孩重度依賴 (NEEDY GIRL OVERDOSE)'s stream UI grades SC:
         blue/green/yellow/orange/red, red = priciest tier. Shared (no
         .ng-chat-row prefix) between the tier buttons themselves — solid
         fill, matching the reference mockup's colored-pill amount buttons —
         and the SC message rows they produce, so both use one color per
         tier instead of drifting. Kept as its own sc-* namespace (as
         opposed to the bare .red/.yellow above, which belong to unrelated
         seed demo rows) so tier colors can't collide with keyword-row
         colors or each other. */
      .sc-blue { background: var(--ng-sc-blue); color: #1c3a4a; }
      .sc-green { background: var(--ng-sc-green); color: #1f3d2b; }
      .sc-yellow { background: var(--ng-sc-yellow); color: #4a3b12; }
      .sc-orange { background: var(--ng-sc-orange); color: #4a2a12; }
      .sc-red { background: var(--ng-sc-red); color: #fff; }
      /* The input pill's own tint rides on top of the plain .sc-* fill
         above (same class, so same var(--ng-sc-*) source of truth) but
         lightened toward white — two classes on one element beats the bar's
         single-class rule on CSS specificity, so this wins without !important.
         Text stays dark on every tier here (unlike .sc-red's white above)
         since a 35%-strength tint never gets dark enough to need light text. */
      .ng-chat-input.sc-blue { background: color-mix(in srgb, var(--ng-sc-blue) 35%, #fff); color: #1c3a4a; }
      .ng-chat-input.sc-green { background: color-mix(in srgb, var(--ng-sc-green) 35%, #fff); color: #1f3d2b; }
      .ng-chat-input.sc-yellow { background: color-mix(in srgb, var(--ng-sc-yellow) 35%, #fff); color: #4a3b12; }
      .ng-chat-input.sc-orange { background: color-mix(in srgb, var(--ng-sc-orange) 35%, #fff); color: #4a2a12; }
      .ng-chat-input.sc-red { background: color-mix(in srgb, var(--ng-sc-red) 35%, #fff); color: #4a1418; }
      .ng-chat-row.kw-sweet { background: #f3c6e0; color: #2f2540; }
      .ng-chat-row.kw-hater { background: #c9534d; color: #2f2540; }
      .ng-chat-row.kw-fourthwall { background: #9ad1e0; color: #2f2540; }
      .ng-chat-row.kw-dark { background: #6a4b8a; color: #f2e8ff; }
    `;
    document.head.appendChild(style);
  }
  if (!document.getElementById(CORNER_HINT_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = CORNER_HINT_STYLE_ID;
    style.textContent = `
      .ng-corner-hint {
        position: absolute;
        font-family: 'NGChatSilver', monospace;
        line-height: 1.2;
        color: #1b2a6b;
        text-align: right;
        white-space: normal;
        overflow-wrap: break-word;
        pointer-events: none;
        user-select: none;
      }
    `;
    document.head.appendChild(style);
  }
}

function addRow(messages, text, kind) {
  const row = document.createElement('div');
  row.className = `ng-chat-row${kind ? ` ${kind}` : ''}`;
  const icon = document.createElement('span');
  icon.className = 'ng-chat-icon';
  const textEl = document.createElement('span');
  textEl.textContent = text;
  row.append(icon, textEl);
  messages.appendChild(row);
  // New message is only useful to the person typing it if the list actually
  // scrolls down to show it — otherwise it lands silently below the fold.
  messages.scrollTop = messages.scrollHeight;
  return row;
}

// Thumb height tracks clientHeight/scrollHeight, same ratio a native
// scrollbar uses — when there's nothing to scroll yet that ratio is 1, so
// the thumb just fills the whole track (reads as the mockup's solid
// gradient bar) instead of only appearing once content overflows.
function updateScrollbar(messages, thumb) {
  const trackH = messages.clientHeight;
  const scrollH = messages.scrollHeight;
  if (trackH <= 0 || scrollH <= 0) return;
  const thumbH = Math.min(trackH, (trackH / scrollH) * trackH);
  const maxScroll = scrollH - trackH;
  const scrollRatio = maxScroll > 0 ? messages.scrollTop / maxScroll : 0;
  thumb.style.height = `${thumbH}px`;
  thumb.style.top = `${(trackH - thumbH) * scrollRatio}px`;
}

// Finds whichever row is currently closest to the top of the visible area
// and returns the one `dir` steps away (dir 0 = snap to that same closest
// row — used after thumb-dragging, since setting scrollTop directly
// doesn't trigger CSS scroll-snap the way a real scroll gesture would;
// dir ±1 = its next/previous neighbor — one wheel notch, one row).
function neighborRow(messages, dir) {
  const rows = Array.from(messages.children);
  let idx = 0, bestDist = Infinity;
  rows.forEach((row, i) => {
    const dist = Math.abs(row.offsetTop - messages.scrollTop);
    if (dist < bestDist) { bestDist = dist; idx = i; }
  });
  idx = Math.max(0, Math.min(rows.length - 1, idx + dir));
  return rows[idx];
}

// CSS scroll-snap (see .ng-chat-messages) covers touch/swipe well enough —
// browsers settle a swipe's momentum onto the nearest snap point on their
// own. Mouse-wheel input is the weak spot: browsers apply wheel deltas
// incrementally and only "settle" onto a snap point once the whole gesture
// stops, which just reads as ordinary smooth scrolling, not the hard
// one-row-at-a-time jump an old webpage would have. So wheel input is
// hijacked entirely here: every wheel event is fully prevented and
// replaced with an instant jump to exactly the next/previous row.
function makeWheelSnap(messages) {
  messages.addEventListener('wheel', (e) => {
    e.preventDefault();
    const row = neighborRow(messages, e.deltaY > 0 ? 1 : -1);
    if (row) messages.scrollTop = row.offsetTop;
  }, { passive: false });
}

// Pointer Events cover mouse AND touch/pen through one API, so the same
// handful of listeners give the thumb both mouse-drag (desktop) and
// finger-drag (mobile) support.
function makeThumbDraggable(messages, thumb) {
  let startClientY = 0;
  let startScrollTop = 0;
  let dragging = false;

  thumb.addEventListener('pointerdown', (e) => {
    dragging = true;
    startClientY = e.clientY;
    startScrollTop = messages.scrollTop;
    thumb.setPointerCapture(e.pointerId);
    e.preventDefault(); // no text-selection / native touch-scroll fighting the drag
  });

  thumb.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const track = thumb.parentElement;
    const maxThumbTravel = track.clientHeight - thumb.clientHeight;
    const maxScroll = messages.scrollHeight - messages.clientHeight;
    if (maxThumbTravel <= 0 || maxScroll <= 0) return;
    const scrollDelta = ((e.clientY - startClientY) / maxThumbTravel) * maxScroll;
    messages.scrollTop = startScrollTop + scrollDelta;
  });

  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    thumb.releasePointerCapture(e.pointerId);
    const row = neighborRow(messages, 0);
    if (row) messages.scrollTop = row.offsetTop;
  };
  thumb.addEventListener('pointerup', endDrag);
  thumb.addEventListener('pointercancel', endDrag);
}

function buildOverlay() {
  ensureStyles();

  const el = document.createElement('div');
  el.className = 'ng-chat-overlay';

  const messagesWrap = document.createElement('div');
  messagesWrap.className = 'ng-chat-messages-wrap';

  const messages = document.createElement('div');
  messages.className = 'ng-chat-messages';
  for (const msg of MESSAGES) addRow(messages, msg.text, msg.kind);
  messagesWrap.appendChild(messages);

  const track = document.createElement('div');
  track.className = 'ng-chat-scrollbar-track';
  const thumb = document.createElement('div');
  thumb.className = 'ng-chat-scrollbar-thumb';
  track.appendChild(thumb);
  messagesWrap.appendChild(track);

  el.appendChild(messagesWrap);
  messages.addEventListener('scroll', () => updateScrollbar(messages, thumb));
  makeThumbDraggable(messages, thumb);
  makeWheelSnap(messages);
  // Exposed so the layer's per-tick reposition (which already knows
  // whenever the board is resized/rescaled) can keep the thumb's size/
  // position current without a separate ResizeObserver.
  el._updateChatScrollbar = () => updateScrollbar(messages, thumb);

  const inputbar = document.createElement('div');
  inputbar.className = 'ng-chat-inputbar';
  const inputIcon = document.createElement('span');
  inputIcon.className = 'ng-chat-icon';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'ng-chat-input';
  input.maxLength = 200;
  input.placeholder = INPUT_PLACEHOLDER[DialogueStore.getLang()] ?? INPUT_PLACEHOLDER.en;
  inputbar.append(inputIcon, input);
  el.appendChild(inputbar);
  // Exposed so the layer's DialogueStore language-change listener can
  // re-apply the placeholder without buildOverlay() needing to return
  // anything beyond the single overlay root element.
  el._input = input;

  // Local superchat-tier simulator (spec §8-2) — no real payment platform is
  // wired up, this just pre-loads a tier's delta for the next send. See
  // keywordTable.js's header for why this stays local for now.
  const tierbar = document.createElement('div');
  tierbar.className = 'ng-chat-tierbar';
  let selectedTier = null;
  const tierButtons = SUPERCHAT_TIERS.map((tier) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `ng-chat-tier-btn sc-${tier.color}`;
    btn.textContent = `¥${tier.amount.toLocaleString()}`;
    btn.addEventListener('click', () => setSelectedTier(selectedTier === tier ? null : tier));
    tierbar.appendChild(btn);
    return btn;
  });
  el.appendChild(tierbar);

  // Recolors every bar in the composer (input row, tier row, toolbar row)
  // to match whichever tier is armed for the next send, or back to their
  // plain defaults once cleared/sent. The round input pill gets tinted too,
  // but with a paler wash of the same hue (see the .ng-chat-input.sc-*
  // overrides, which win on specificity over the plain .sc-* bar fill) —
  // full-strength would read as one blended-together blob with the solid
  // bar sitting right behind it; a lighter tint keeps the pill legible as
  // its own shape while still carrying the tier color.
  function setSelectedTier(tier) {
    selectedTier = tier;
    tierButtons.forEach((b, i) => b.classList.toggle('active', SUPERCHAT_TIERS[i] === tier));
    const suffix = tier ? ` sc-${tier.color}` : '';
    input.className = `ng-chat-input${suffix}`;
    inputbar.className = `ng-chat-inputbar${suffix}`;
    tierbar.className = `ng-chat-tierbar${suffix}`;
    toolbar.className = `ng-chat-toolbar${suffix}`;
  }

  const toolbar = document.createElement('div');
  toolbar.className = 'ng-chat-toolbar';
  const mic = document.createElement('span');
  const send = document.createElement('span');
  send.className = 'send';
  toolbar.append(mic, send);
  el.appendChild(toolbar);

  const submit = () => {
    const text = input.value.trim();
    if (!text) return;

    const kw = matchMessage(text);
    const delta = sumDeltas(selectedTier?.delta, kw?.delta);
    if (delta) StatStore.announce(delta);

    if (kw?.id === 'ascension') {
      const negative = StatStore.get('stress') > ASCENSION_NEGATIVE_THRESHOLD
        || StatStore.get('darkness') > ASCENSION_NEGATIVE_THRESHOLD;
      triggerAscensionFlood(negative);
    }

    // Tier wins if a message happens to also match a keyword — simplest
    // default given a single `kind` can only carry one highlight.
    const kind = selectedTier ? `sc-${selectedTier.color}` : kw ? `kw-${kw.id}` : undefined;
    const row = addRow(messages, text, kind);
    // A colored SC row is a paid highlight, not a regular chat line — like
    // 主播女孩重度依賴 (NEEDY GIRL OVERDOSE)'s stream UI, it's meant to stay
    // pinned on screen for the rest of the broadcast rather than get
    // scrolled/moderated away. `locked` mirrors keywordTable's 留言不可刪
    // flag (see its header) — no delete UI exists yet either, this is just
    // the marker future delete/moderation code should respect.
    if (selectedTier || kw?.locked) row.dataset.locked = 'true';

    input.value = '';
    setSelectedTier(null);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
  send.addEventListener('click', submit);

  // #stage-area has its own click handler (spawns a decorative popup
  // wherever the stage is clicked, see main.js) — without this, clicking
  // into the input to type would bubble up and spawn one of those on top
  // of the chat UI on every single click.
  el.addEventListener('mousedown', (e) => e.stopPropagation());
  el.addEventListener('click', (e) => e.stopPropagation());

  return el;
}

export class ChatBoardLayer extends BaseImageLayer {
  constructor(opts) {
    super(opts);

    this.el = buildOverlay();
    // z-index 11: one above the Pixi canvas itself (z-index 10, see
    // main.js) — chat.chatBLayer.js's border-frame overlay sits at 12, one
    // above this, so it draws in front of these messages.
    this._overlay = attachDomOverlay(this, this.el, {
      zIndex: 11,
      display: 'flex',
      onReposition: (b) => {
        // Custom properties can't be set via plain style-object assignment
        // (CSSStyleDeclaration only special-cases known longhands) — needs
        // the real setProperty() call.
        this.el.style.setProperty('--ng-u', `${b.width / CHAT_REF_W}px`);
        this.el._updateChatScrollbar();
      },
    });

    // Pinned to the whole compositor viewport's corner, not the chatboard
    // sprite's own box — appended straight into #stage-area (not
    // #stage-world) as a plain sibling after it, same trick #panel-toggle
    // uses in index.html to sit above the scene and stay excluded from
    // screenShake.js's shake without needing an explicit z-index.
    this._hintEl = document.createElement('div');
    this._hintEl.className = 'ng-corner-hint';
    document.getElementById('stage-area').appendChild(this._hintEl);
    // Rebuilds the hint's text on every DialogueStore change, not just
    // language switches — cheap enough (short string concat) that filtering
    // to lang-only changes isn't worth the extra bookkeeping.
    this._offLang = DialogueStore.on('change', (snap) => {
      this._hintEl.textContent = buildKeywordHint(snap.lang);
      this.el._input.placeholder = INPUT_PLACEHOLDER[snap.lang] ?? INPUT_PLACEHOLDER.en;
    });
    // this.stage.root sits centered in the container and scaled to fit
    // LOGICAL_W x LOGICAL_H (see Stage.js's resize()) — #stage-area itself
    // can be a different aspect ratio than 16:9 (panel open/closed, odd
    // window sizes), which leaves letterbox margins the fixed-pixel corner
    // position used to ignore entirely. Recomputing the frame's actual
    // on-screen rect here instead of guessing a flat px offset keeps the
    // hint anchored to the frame's real corner (not the browser window's)
    // at any scale, and keeps its font size/margin proportional to the
    // same scale factor everything else on stage already uses.
    this._repositionHint = () => {
      const scale = this.stage.scaleFactor;
      const compW = LOGICAL_W * scale;
      const compH = LOGICAL_H * scale;
      const compRight = this.stage.width / 2 + compW / 2;
      const compBottom = this.stage.height / 2 + compH / 2;
      const marginX = HINT_MARGIN_X_LOGICAL * scale;
      const marginY = HINT_MARGIN_Y_LOGICAL * scale;
      Object.assign(this._hintEl.style, {
        right: `${this.stage.width - compRight + marginX}px`,
        bottom: `${this.stage.height - compBottom + marginY}px`,
        maxWidth: `${compW - marginX * 2}px`,
        fontSize: `${HINT_FONT_LOGICAL * scale}px`,
      });
    };
    this._offResize = this.stage.onResize(this._repositionHint);
    this._repositionHint();
  }

  setVisible(visible) {
    super.setVisible(visible);
    this._overlay.setVisible(visible);
    this._hintEl.style.display = visible ? 'block' : 'none';
  }

  destroy() {
    this._overlay.destroy();
    this._offLang();
    this._offResize();
    this._hintEl.remove();
    super.destroy();
  }
}

export async function create(opts) {
  const loaded = await PIXI.Assets.load(opts.src);
  const sprite = loaded instanceof PIXI.Texture ? new PIXI.Sprite(loaded) : loaded;
  return new ChatBoardLayer({ ...opts, sprite });
}
