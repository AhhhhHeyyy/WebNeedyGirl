import { BaseImageLayer } from './BaseImageLayer.js';
import { attachDomOverlay } from './domSpriteOverlay.js';
import { StatStore } from '../core/StatStore.js';
import { DialogueStore } from '../core/DialogueStore.js';
import { matchMessage, KEYWORD_CATEGORIES } from '../core/keywordTable.js';
import { triggerAscensionFlood } from './yandereProtoOverlay.js';
import { saveComment, loadComments } from '../../shared/firebase.js';

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
// Shown inline inside the compose modal's message field (see buildComposeModal's
// .ccm-msg-hint), not as a separate corner overlay — user-requested move so the
// hint sits right where the player is actually typing.
const HINT_TITLE = {
  zh: '留言關鍵字提示:',
  en: 'Chat Keyword Hints:',
  ja: 'コメントキーワードヒント:',
  ko: '댓글 키워드 힌트:',
};
// The bottom composer bar is a click-to-open TRIGGER, not a live text field
// (user-requested: clicking it opens the compose modal below, where the
// actual name/message/sticker/SC fields live) — its placeholder wording
// reflects that ("tap to comment", not "type a message").
const INPUT_PLACEHOLDER = {
  zh: '點擊輸入留言…',
  en: 'Tap to comment…',
  ja: 'タップしてコメント…',
  ko: '탭하여 댓글 작성…',
};
// The modal's own message field placeholder — the actual typing happens
// here now, INPUT_PLACEHOLDER above is just the bottom-bar trigger's text.
const MODAL_MSG_PLACEHOLDER = {
  zh: '輸入留言…',
  en: 'Type a message…',
  ja: 'コメントを入力…',
  ko: '댓글을 입력하세요…',
};
// The optional nickname field in the compose modal — left empty on send,
// the row/Firestore doc falls back to ANONYMOUS_LABEL below instead of
// blocking the send or forcing a name.
const NAME_PLACEHOLDER = {
  zh: '暱稱（留空＝匿名）',
  en: 'Name (blank = anonymous)',
  ja: 'ニックネーム（空欄＝匿名）',
  ko: '닉네임 (비워두면 익명)',
};
const ANONYMOUS_LABEL = {
  zh: '匿名', en: 'Anonymous', ja: '匿名', ko: '익명',
};

// The 5 stand-alone sticker PNGs at project-root `stickers/` (distinct from
// UI/list-stickers.png's separate 5-icon stat-effect board — these are
// purely decorative chat attachments, no StatStore delta attached). Kept as
// literal filenames (not URL-encoded) — browsers auto-encode spaces in an
// <img>.src assignment, and the inconsistent "sticker"/"stickers" naming is
// just how the source files happen to be named.
const STICKERS = [
  { id: 'sticker1', file: 'stickers/sticker (1).png' },
  { id: 'sticker2', file: 'stickers/stickers (2).png' },
  { id: 'sticker3', file: 'stickers/stickers (3).png' },
  { id: 'sticker4', file: 'stickers/stickers (4).png' },
  { id: 'sticker5', file: 'stickers/stickers (5).png' },
];

// Compose modal strings (user-requested: clicking the chat's inputbar opens
// a centered modal — name/message/sticker/SC all entered there instead of
// inline).
const MODAL_TITLE = {
  zh: '留言', en: 'Leave a Comment', ja: 'コメントする', ko: '댓글 남기기',
};
const MODAL_NAME_LABEL = { zh: '暱稱', en: 'Name', ja: 'ニックネーム', ko: '닉네임' };
const MODAL_MSG_LABEL = { zh: '留言內容', en: 'Message', ja: 'メッセージ', ko: '메시지' };
const MODAL_STICKER_LABEL = { zh: '貼圖', en: 'Sticker', ja: 'スタンプ', ko: '스티커' };
const MODAL_SC_LABEL = { zh: '超級留言', en: 'Superchat', ja: 'スーパーチャット', ko: '슈퍼챗' };
const MODAL_SEND_LABEL = { zh: '送出', en: 'Send', ja: '送信', ko: '보내기' };
const MODAL_CANCEL_LABEL = { zh: '取消', en: 'Cancel', ja: 'キャンセル', ko: '취소' };

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
      /* Sender name shown above a row's message text — only rendered when a
         name (or the anonymous fallback) is actually known, i.e. for rows
         sent through this session's own composer; the seed MESSAGES array
         has none, so those rows stay exactly as before. */
      .ng-chat-name-label {
        display: block;
        font-size: calc(var(--ng-u) * 32);
        font-weight: 700;
        opacity: 0.85;
        margin-bottom: calc(var(--ng-u) * 2);
      }
      .ng-chat-row-sticker {
        display: block;
        width: calc(var(--ng-u) * 70);
        height: calc(var(--ng-u) * 70);
        object-fit: contain;
        image-rendering: pixelated;
      }
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
      /* Superchat tier colors (spec §8-2), graded low → high amount the same
         way 主播女孩重度依賴 (NEEDY GIRL OVERDOSE)'s stream UI grades SC:
         blue/green/yellow/orange/red, red = priciest tier. The tier PICKER
         buttons themselves now live in the compose modal's own stylesheet
         (see ensureComposeModalStyle's .ccm-tier-btn.sc-* rules, outside
         this element's subtree) — these bare .sc-* rules only style the SC
         message ROWS the picker produces, one color per tier so both stay in
         sync. Kept as its own sc-* namespace (as opposed to the bare
         .red/.yellow above, which belong to unrelated seed demo rows) so
         tier colors can't collide with keyword-row colors or each other. */
      .sc-blue { background: var(--ng-sc-blue); color: #1c3a4a; }
      .sc-green { background: var(--ng-sc-green); color: #1f3d2b; }
      .sc-yellow { background: var(--ng-sc-yellow); color: #4a3b12; }
      .sc-orange { background: var(--ng-sc-orange); color: #4a2a12; }
      .sc-red { background: var(--ng-sc-red); color: #fff; }
      .ng-chat-row.kw-sweet { background: #f3c6e0; color: #2f2540; }
      .ng-chat-row.kw-hater { background: #c9534d; color: #2f2540; }
      .ng-chat-row.kw-fourthwall { background: #9ad1e0; color: #2f2540; }
      .ng-chat-row.kw-dark { background: #6a4b8a; color: #f2e8ff; }
    `;
    document.head.appendChild(style);
  }
  ensureComposeModalStyle();
}

function addRow(messages, text, kind, name, stickerFile) {
  const row = document.createElement('div');
  row.className = `ng-chat-row${kind ? ` ${kind}` : ''}`;
  const icon = document.createElement('span');
  icon.className = 'ng-chat-icon';
  const textEl = document.createElement('span');
  // `name` is only ever passed for rows sent through this session's own
  // composer (see performSend() below) — the seed MESSAGES array never
  // passes one, so those rows render exactly as before with no label.
  if (name) {
    const nameEl = document.createElement('span');
    nameEl.className = 'ng-chat-name-label';
    nameEl.textContent = name;
    textEl.appendChild(nameEl);
  }
  // A sticker can be sent with or without accompanying text (see the compose
  // modal's send-enabled check) — the text node is only appended when
  // there's actually text to show, so a sticker-only row doesn't render a
  // dangling empty line under the image.
  if (stickerFile) {
    const stickerImg = document.createElement('img');
    stickerImg.className = 'ng-chat-row-sticker';
    stickerImg.src = stickerFile;
    stickerImg.alt = '';
    textEl.appendChild(stickerImg);
  }
  if (text) textEl.appendChild(document.createTextNode(text));
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

// Compose modal (user-requested: clicking the chat's bottom inputbar opens a
// centered modal — name/message/sticker/SC all entered there instead of
// inline) — sized/positioned the same way phoneCallOverlay.js's incoming-call
// modal is: a fixed-px "design" box, scaled uniformly via a single CSS
// transform to fit both viewport axes (Math.min(w/W, h/H), same formula
// Stage.js's own resize() uses), rather than chat.chatboardLayer's own
// --ng-u per-unit calc() scaling — this modal lives on document.body, not
// inside the chatboard's own DOM-overlay subtree, so it has no board-relative
// "reference width" to scale off of the way the rest of this file does.
const CCM_Z_INDEX = 4500; // above every in-game layer/effect, clear of phoneCallOverlay's 5000 (the two are never expected to be open at once, but keep them non-overlapping regardless)
const CCM_DESIGN_W = 760;
const CCM_MOBILE_BREAKPOINT_PX = 1024;
const CCM_MOBILE_DESIGN_W = 460;
const CCM_FIT_MARGIN_W = 0.94;
const CCM_FIT_MARGIN_H = 0.92;
const CCM_MODAL_STYLE_ID = 'ng-chat-compose-modal-style';

function ensureComposeModalStyle() {
  if (document.getElementById(CCM_MODAL_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = CCM_MODAL_STYLE_ID;
  style.textContent = `
    #ng-ccm-backdrop {
      position: fixed; inset: 0;
      background: rgba(20, 10, 35, 0.45);
      z-index: ${CCM_Z_INDEX - 1};
      opacity: 0; pointer-events: none;
      transition: opacity .25s ease;
    }
    #ng-ccm-backdrop.open { opacity: 1; pointer-events: auto; }

    #ng-ccm-modal {
      position: fixed; left: 50%; top: 50%;
      /* --ccm-drag-x/y are raw px, added by the drag handler below (see
         onWindowPointerDown) — they compose with the %-based centering
         translate in the same function untouched by --ccm-scale, since
         scale() sits to the right and only affects what's already been
         translated, not the translate distance itself. */
      transform: translate(calc(-50% + var(--ccm-drag-x, 0px)), calc(-50% + var(--ccm-drag-y, 0px))) scale(calc(var(--ccm-scale, 1) * 0.85));
      width: ${CCM_DESIGN_W}px;
      z-index: ${CCM_Z_INDEX};
      font-family: 'NGChatSilver', 'Silver', -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif;
      opacity: 0;
      transition: transform .32s cubic-bezier(.22,1.15,.4,1), opacity .25s ease;
      pointer-events: none;
    }
    #ng-ccm-modal.open {
      transform: translate(calc(-50% + var(--ccm-drag-x, 0px)), calc(-50% + var(--ccm-drag-y, 0px))) scale(var(--ccm-scale, 1));
      opacity: 1;
      pointer-events: auto;
    }
    /* Dragging (see onWindowPointerDown) skips the opening scale/opacity
       transition above via .dragging — otherwise every pointermove fights a
       .32s eased transform transition and the window visibly lags the
       cursor instead of tracking it 1:1. */
    #ng-ccm-modal.dragging { transition: none; }
    @media (max-width: ${CCM_MOBILE_BREAKPOINT_PX}px) {
      #ng-ccm-modal { width: ${CCM_MOBILE_DESIGN_W}px; }
    }

    #ng-ccm-modal .ccm-window {
      border: 3px solid #8fd0f2;
      overflow: hidden;
      box-shadow: 0 18px 50px rgba(20, 10, 40, 0.45);
      background: #f3e9fb;
      color: #4b3d73;
    }
    /* Same "retro OS window" chrome idiom phoneCallOverlay.js's own modal
       uses (titlebar + fake min/close buttons) — reused here so the app's
       handful of centered popups read as one family, not three unrelated
       designs. */
    #ng-ccm-modal .ccm-titlebar {
      height: 30px;
      display: flex; align-items: center; justify-content: space-between;
      padding: 0 8px;
      background: linear-gradient(90deg, #d8f0ff 0%, #f6cdf0 50%, #d8f0ff 100%);
      border-bottom: 2px solid #8fd0f2;
      cursor: grab; /* the whole top 40% of .ccm-window drags — see onWindowPointerDown */
    }
    #ng-ccm-modal.dragging .ccm-titlebar { cursor: grabbing; }
    #ng-ccm-modal .ccm-titleicon { width: 13px; height: 13px; border-radius: 2px; background: #5b67c7; }
    #ng-ccm-modal .ccm-title { font-size: 14px; font-weight: 700; letter-spacing: .03em; }
    #ng-ccm-modal .ccm-winbtn {
      width: 16px; height: 16px; border-radius: 2px;
      background: rgba(255,255,255,0.65); border: 1px solid #6a5fae;
      display: flex; align-items: center; justify-content: center;
      position: relative; cursor: pointer;
    }
    #ng-ccm-modal .ccm-winbtn:hover { background: #f2a5ae; }
    #ng-ccm-modal .ccm-x::before, #ng-ccm-modal .ccm-x::after {
      content: ''; position: absolute; width: 9px; height: 1.4px; background: #5a4a9e; top: 50%; left: 50%;
    }
    #ng-ccm-modal .ccm-x::before { transform: translate(-50%, -50%) rotate(45deg); }
    #ng-ccm-modal .ccm-x::after { transform: translate(-50%, -50%) rotate(-45deg); }

    #ng-ccm-modal .ccm-body {
      display: flex; flex-direction: column; gap: 10px;
      padding: 18px 22px 6px;
    }
    #ng-ccm-modal .ccm-label { font-size: 14px; font-weight: 700; opacity: .75; }
    #ng-ccm-modal .ccm-name-input, #ng-ccm-modal .ccm-msg-input {
      height: 38px; border: none; outline: none;
      appearance: none; -webkit-appearance: none;
      border-radius: 999px; background: #fff;
      padding: 0 16px; font-family: inherit; font-size: 15px; color: #4b3d73;
    }
    #ng-ccm-modal .ccm-name-input::placeholder, #ng-ccm-modal .ccm-msg-input::placeholder {
      color: rgba(75, 61, 115, 0.4);
    }
    /* Keyword hint, moved here (user-requested) from a standalone corner
       overlay on the game stage — now sits right under the field the
       player is actually typing into. */
    #ng-ccm-modal .ccm-msg-hint {
      font-size: 11px;
      line-height: 1.4;
      color: rgba(75, 61, 115, 0.65);
      max-height: 4.2em;
      overflow-y: auto;
    }
    #ng-ccm-modal .ccm-sticker-row { display: flex; gap: 8px; }
    #ng-ccm-modal .ccm-sticker-btn {
      flex: 1 1 0; aspect-ratio: 1; padding: 4px;
      border: none; border-radius: 10px; background: #fff;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer;
    }
    #ng-ccm-modal .ccm-sticker-btn img { width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; }
    /* Selection ring, not a fill swap — same reasoning as chat's own
       .ng-chat-tier-btn.active, just re-declared here since this modal's
       markup lives outside .ng-chat-overlay's own stylesheet scope. */
    #ng-ccm-modal .ccm-sticker-btn.active { box-shadow: 0 0 0 3px #b076c8 inset; background: #eee3f0; }
    #ng-ccm-modal .ccm-tier-row { display: flex; gap: 6px; }
    #ng-ccm-modal .ccm-tier-btn {
      flex: 1 1 0; height: 32px; border: none; border-radius: 999px;
      background: #eee3f0; color: #4b3d73; font-family: inherit; font-size: 13px; cursor: pointer;
    }
    #ng-ccm-modal .ccm-tier-btn.active { box-shadow: 0 0 0 2px rgba(255,255,255,0.85) inset; }
    /* Same 5 superchat hues as .ng-chat-overlay's --ng-sc-* ladder — hardcoded
       here rather than shared via CSS custom property since this modal's DOM
       lives outside that element's subtree (no --ng-sc-* to inherit). */
    #ng-ccm-modal .ccm-tier-btn.sc-blue { background: #8ecae6; color: #1c3a4a; }
    #ng-ccm-modal .ccm-tier-btn.sc-green { background: #8fd19e; color: #1f3d2b; }
    #ng-ccm-modal .ccm-tier-btn.sc-yellow { background: #f2c94c; color: #4a3b12; }
    #ng-ccm-modal .ccm-tier-btn.sc-orange { background: #f2994a; color: #4a2a12; }
    #ng-ccm-modal .ccm-tier-btn.sc-red { background: #e5484d; color: #fff; }

    #ng-ccm-modal .ccm-actions {
      display: flex; gap: 10px; justify-content: flex-end;
      padding: 14px 22px 18px;
    }
    #ng-ccm-modal .ccm-btn {
      border: none; border-radius: 999px; padding: 9px 22px;
      font-family: inherit; font-size: 14px; font-weight: 700; cursor: pointer;
      transition: transform .12s ease;
    }
    #ng-ccm-modal .ccm-btn:active { transform: scale(0.95); }
    #ng-ccm-modal .ccm-cancel { background: #eee3f0; color: #4b3d73; }
    #ng-ccm-modal .ccm-send { background: #e08a9a; color: #fff; }
    #ng-ccm-modal .ccm-send:disabled { opacity: .5; cursor: default; }
  `;
  document.head.appendChild(style);
}

// Built once per ChatBoardLayer instance (see buildOverlay() below) and
// appended straight to document.body — same reason as phoneCallOverlay.js's
// own modal: it needs to sit centered over the WHOLE viewport, not inside
// the chatboard sprite's own DOM-overlay box (which is wherever the board
// has been dragged/scaled to, see attachDomOverlay's onReposition).
// `onSend` receives the fully-resolved payload once the user hits Send;
// buildOverlay() below wires that to the same StatStore/keyword/Firestore
// logic the old inline composer's submit() used to run directly.
function buildComposeModal({ onSend }) {
  ensureComposeModalStyle();

  const backdrop = document.createElement('div');
  backdrop.id = 'ng-ccm-backdrop';

  const root = document.createElement('div');
  root.id = 'ng-ccm-modal';
  root.innerHTML = `
    <div class="ccm-window">
      <div class="ccm-titlebar">
        <div class="ccm-titleicon"></div>
        <div class="ccm-title"></div>
        <div class="ccm-winbtn ccm-close ccm-x"></div>
      </div>
      <div class="ccm-body">
        <div class="ccm-label ccm-name-label"></div>
        <input type="text" class="ccm-name-input" maxlength="24">
        <div class="ccm-label ccm-msg-label"></div>
        <input type="text" class="ccm-msg-input" maxlength="200">
        <div class="ccm-msg-hint"></div>
        <div class="ccm-label ccm-sticker-label"></div>
        <div class="ccm-sticker-row"></div>
        <div class="ccm-label ccm-sc-label"></div>
        <div class="ccm-tier-row"></div>
      </div>
      <div class="ccm-actions">
        <button type="button" class="ccm-btn ccm-cancel"></button>
        <button type="button" class="ccm-btn ccm-send"></button>
      </div>
    </div>
  `;
  document.body.append(backdrop, root);

  const titleEl = root.querySelector('.ccm-title');
  const nameLabelEl = root.querySelector('.ccm-name-label');
  const nameInput = root.querySelector('.ccm-name-input');
  const msgLabelEl = root.querySelector('.ccm-msg-label');
  const msgInput = root.querySelector('.ccm-msg-input');
  const msgHintEl = root.querySelector('.ccm-msg-hint');
  const stickerLabelEl = root.querySelector('.ccm-sticker-label');
  const stickerRow = root.querySelector('.ccm-sticker-row');
  const scLabelEl = root.querySelector('.ccm-sc-label');
  const tierRow = root.querySelector('.ccm-tier-row');
  const cancelBtn = root.querySelector('.ccm-cancel');
  const sendBtn = root.querySelector('.ccm-send');
  const closeBtn = root.querySelector('.ccm-close');
  const windowEl = root.querySelector('.ccm-window');

  let selectedTier = null;
  let selectedSticker = null;

  // Drag-to-reposition (user-requested) — only the top 40% of .ccm-window
  // (titlebar + the name label/input row right under it) starts a drag, so
  // the rest of the form (message input, stickers, superchat tiers, actions)
  // stays purely clickable. Targets that are themselves interactive (the
  // name input, the titlebar's close button) opt out via the closest()
  // check below so focusing/clicking them still works normally even though
  // they fall inside that top 40%.
  const CCM_DRAG_ZONE_RATIO = 0.4;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let dragState = null;

  function setDragOffset(x, y) {
    dragOffsetX = x;
    dragOffsetY = y;
    root.style.setProperty('--ccm-drag-x', `${x}px`);
    root.style.setProperty('--ccm-drag-y', `${y}px`);
  }

  function onDragMove(e) {
    if (!dragState) return;
    setDragOffset(dragState.baseX + (e.clientX - dragState.startX), dragState.baseY + (e.clientY - dragState.startY));
  }
  function onDragEnd() {
    dragState = null;
    root.classList.remove('dragging');
    window.removeEventListener('pointermove', onDragMove);
  }
  function onWindowPointerDown(e) {
    if (e.target.closest('input, button')) return; // form controls/close button behave normally
    const rect = windowEl.getBoundingClientRect();
    if (!rect.height || (e.clientY - rect.top) / rect.height > CCM_DRAG_ZONE_RATIO) return;
    e.preventDefault(); // suppresses touch-scroll/selection while dragging
    dragState = { startX: e.clientX, startY: e.clientY, baseX: dragOffsetX, baseY: dragOffsetY };
    root.classList.add('dragging');
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd, { once: true });
  }
  windowEl.addEventListener('pointerdown', onWindowPointerDown);

  function updateSendEnabled() {
    sendBtn.disabled = !msgInput.value.trim() && !selectedSticker;
  }

  const stickerButtons = STICKERS.map((sticker) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ccm-sticker-btn';
    const img = document.createElement('img');
    img.src = sticker.file;
    img.alt = '';
    btn.appendChild(img);
    btn.addEventListener('click', () => setSelectedSticker(selectedSticker === sticker ? null : sticker));
    stickerRow.appendChild(btn);
    return btn;
  });

  const tierButtons = SUPERCHAT_TIERS.map((tier) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `ccm-tier-btn sc-${tier.color}`;
    btn.textContent = `¥${tier.amount.toLocaleString()}`;
    btn.addEventListener('click', () => setSelectedTier(selectedTier === tier ? null : tier));
    tierRow.appendChild(btn);
    return btn;
  });

  function setSelectedSticker(sticker) {
    selectedSticker = sticker;
    stickerButtons.forEach((b, i) => b.classList.toggle('active', STICKERS[i] === sticker));
    updateSendEnabled();
  }
  function setSelectedTier(tier) {
    selectedTier = tier;
    tierButtons.forEach((b, i) => b.classList.toggle('active', SUPERCHAT_TIERS[i] === tier));
  }

  let isOpen = false;

  function close() {
    if (!isOpen) return;
    isOpen = false;
    root.classList.remove('open');
    backdrop.classList.remove('open');
  }

  // Message text OR a sticker is required (either alone is a valid send —
  // see updateSendEnabled above), but neither is forced; name is always
  // optional (see NAME_PLACEHOLDER's header). Draft text/sticker/tier only
  // clear on an actual send, not on cancel/close, so an accidental dismiss
  // doesn't lose what the user already typed.
  function doSend() {
    const text = msgInput.value.trim();
    if (!text && !selectedSticker) return;
    onSend({
      text, rawName: nameInput.value.trim(), tier: selectedTier, sticker: selectedSticker,
    });
    msgInput.value = '';
    setSelectedSticker(null);
    setSelectedTier(null);
    updateSendEnabled();
    close();
  }

  sendBtn.addEventListener('click', doSend);
  cancelBtn.addEventListener('click', close);
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', close);
  msgInput.addEventListener('input', updateSendEnabled);
  msgInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSend(); });
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSend(); });
  const onWindowKeydown = (e) => { if (e.key === 'Escape' && isOpen) close(); };
  window.addEventListener('keydown', onWindowKeydown);

  // Root lives on document.body, outside #stage-area entirely, so nothing
  // here would naturally reach main.js's stage-area click handler (spawns a
  // decorative popup wherever the stage is clicked) — but stopping
  // propagation here too costs nothing and keeps this modal consistent with
  // every other DOM-overlay composer in this file.
  root.addEventListener('mousedown', (e) => e.stopPropagation());
  root.addEventListener('click', (e) => e.stopPropagation());

  function applyLang(lang) {
    titleEl.textContent = MODAL_TITLE[lang] ?? MODAL_TITLE.en;
    nameLabelEl.textContent = MODAL_NAME_LABEL[lang] ?? MODAL_NAME_LABEL.en;
    nameInput.placeholder = NAME_PLACEHOLDER[lang] ?? NAME_PLACEHOLDER.en;
    msgLabelEl.textContent = MODAL_MSG_LABEL[lang] ?? MODAL_MSG_LABEL.en;
    msgInput.placeholder = MODAL_MSG_PLACEHOLDER[lang] ?? MODAL_MSG_PLACEHOLDER.en;
    msgHintEl.textContent = buildKeywordHint(lang);
    stickerLabelEl.textContent = MODAL_STICKER_LABEL[lang] ?? MODAL_STICKER_LABEL.en;
    scLabelEl.textContent = MODAL_SC_LABEL[lang] ?? MODAL_SC_LABEL.en;
    cancelBtn.textContent = MODAL_CANCEL_LABEL[lang] ?? MODAL_CANCEL_LABEL.en;
    sendBtn.textContent = MODAL_SEND_LABEL[lang] ?? MODAL_SEND_LABEL.en;
  }
  applyLang(DialogueStore.getLang());
  const offLang = DialogueStore.on('change', (snap) => applyLang(snap.lang));

  // Fit-scale against BOTH viewport axes, same Math.min(w/W, h/H) formula
  // phoneCallOverlay.js's own modal uses — but unlike that one, this is NOT
  // additionally capped at 1. phoneCallOverlay's short single-screen content
  // reads fine pinned to its authored 760px size on any normal-or-larger
  // display; this modal stacks name/message/sticker/SC fields tall enough
  // that pinning it to 1x left it reading small on any viewport roomier than
  // its own design box (user-reported: "字太小了看不到"). Letting it grow
  // past 1x up to CCM_MAX_SCALE instead means it actually fills a consistent,
  // comfortable fraction of whatever screen it's opened on — the same "scale
  // to fit" logic Stage.js's own resize() uses for the composited scene
  // itself, just with an upper bound so it doesn't balloon absurdly large on
  // an ultra-wide/4K monitor.
  const CCM_MAX_SCALE = 1.8;
  function applyFitScale() {
    const naturalH = root.offsetHeight;
    if (!naturalH) return;
    const isMobile = window.innerWidth <= CCM_MOBILE_BREAKPOINT_PX;
    const designW = isMobile ? CCM_MOBILE_DESIGN_W : CCM_DESIGN_W;
    const scaleW = (window.innerWidth * CCM_FIT_MARGIN_W) / designW;
    const scaleH = (window.innerHeight * CCM_FIT_MARGIN_H) / naturalH;
    root.style.setProperty('--ccm-scale', Math.min(CCM_MAX_SCALE, scaleW, scaleH));
  }
  window.addEventListener('resize', applyFitScale);
  window.addEventListener('orientationchange', applyFitScale);
  applyFitScale();

  function open() {
    if (isOpen) return;
    isOpen = true;
    setDragOffset(0, 0); // re-center — a drag left over from the last time this modal was open shouldn't carry forward
    applyFitScale(); // re-measure — draft content length affects naturalH
    backdrop.classList.add('open');
    requestAnimationFrame(() => {
      root.classList.add('open');
      msgInput.focus();
    });
  }

  function destroy() {
    offLang();
    window.removeEventListener('keydown', onWindowKeydown);
    window.removeEventListener('resize', applyFitScale);
    window.removeEventListener('orientationchange', applyFitScale);
    window.removeEventListener('pointermove', onDragMove); // in case destroy() lands mid-drag
    root.remove();
    backdrop.remove();
  }

  return { open, destroy };
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

  // Restore past comments (shared/firebase.js) after the local seed lines —
  // async by nature, so these rows pop in a beat after the seed messages
  // rather than blocking first paint on a network round-trip. Reconstructs
  // the same `kind`/name-fallback/sticker-file mapping performSend() below
  // applies to a live send, so a restored row renders identically to how it
  // looked the moment it was originally sent.
  loadComments().then((comments) => {
    for (const c of comments) {
      const displayName = c.name || (ANONYMOUS_LABEL[DialogueStore.getLang()] ?? ANONYMOUS_LABEL.en);
      const kind = c.scColor ? `sc-${c.scColor}` : undefined;
      const stickerFile = c.sticker ? STICKERS.find((s) => s.id === c.sticker)?.file : undefined;
      addRow(messages, c.text, kind, displayName, stickerFile);
    }
    updateScrollbar(messages, thumb);
  });

  el.appendChild(messagesWrap);
  messages.addEventListener('scroll', () => updateScrollbar(messages, thumb));
  makeThumbDraggable(messages, thumb);
  makeWheelSnap(messages);
  // Exposed so the layer's per-tick reposition (which already knows
  // whenever the board is resized/rescaled) can keep the thumb's size/
  // position current without a separate ResizeObserver.
  el._updateChatScrollbar = () => updateScrollbar(messages, thumb);

  // Bottom composer bar is now a click-to-open TRIGGER, not a live text
  // field (user-requested: clicking it opens the compose modal below, where
  // name/message/sticker/SC are actually entered) — readOnly so it can still
  // be focused/clicked but never shows a caret or pops a mobile keyboard.
  const inputbar = document.createElement('div');
  inputbar.className = 'ng-chat-inputbar';
  const inputIcon = document.createElement('span');
  inputIcon.className = 'ng-chat-icon';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'ng-chat-input';
  input.readOnly = true;
  input.placeholder = INPUT_PLACEHOLDER[DialogueStore.getLang()] ?? INPUT_PLACEHOLDER.en;
  input.addEventListener('click', () => composeModal.open());
  inputbar.append(inputIcon, input);
  el.appendChild(inputbar);
  // Exposed so the layer's DialogueStore language-change listener can
  // re-apply the placeholder without buildOverlay() needing to return
  // anything beyond the single overlay root element.
  el._input = input;

  const toolbar = document.createElement('div');
  toolbar.className = 'ng-chat-toolbar';
  const mic = document.createElement('span');
  const send = document.createElement('span');
  send.className = 'send';
  send.addEventListener('click', () => composeModal.open());
  toolbar.append(mic, send);
  el.appendChild(toolbar);

  // #stage-area has its own click handler (spawns a decorative popup
  // wherever the stage is clicked, see main.js) — without this, clicking
  // into the trigger input would bubble up and spawn one of those right
  // before/behind the compose modal opening.
  el.addEventListener('mousedown', (e) => e.stopPropagation());
  el.addEventListener('click', (e) => e.stopPropagation());

  // Everything the old inline composer's submit() used to do directly now
  // runs here instead, as the compose modal's onSend callback — same
  // StatStore/keyword-match/ascension/Firestore logic, just triggered from
  // the modal's Send button instead of the bottom bar's Enter/send icon.
  const composeModal = buildComposeModal({
    onSend: ({
      text, rawName, tier, sticker,
    }) => {
      // Blank name = the commenter chose not to leave one — falls back to
      // the localized "Anonymous" label for display, but stays `null` (not
      // that label) in the Firestore doc so the backend can tell "no name
      // given" apart from someone literally typing the word "Anonymous".
      const displayName = rawName || (ANONYMOUS_LABEL[DialogueStore.getLang()] ?? ANONYMOUS_LABEL.en);

      const kw = text ? matchMessage(text) : null;
      const delta = sumDeltas(tier?.delta, kw?.delta);
      if (delta) StatStore.announce(delta);

      if (kw?.id === 'ascension') {
        const negative = StatStore.get('stress') > ASCENSION_NEGATIVE_THRESHOLD
          || StatStore.get('darkness') > ASCENSION_NEGATIVE_THRESHOLD;
        triggerAscensionFlood(negative);
      }

      // Tier wins if a message happens to also match a keyword — simplest
      // default given a single `kind` can only carry one highlight.
      const kind = tier ? `sc-${tier.color}` : kw ? `kw-${kw.id}` : undefined;
      const row = addRow(messages, text, kind, displayName, sticker?.file);
      // A colored SC row is a paid highlight, not a regular chat line — like
      // 主播女孩重度依賴 (NEEDY GIRL OVERDOSE)'s stream UI, it's meant to stay
      // pinned on screen for the rest of the broadcast rather than get
      // scrolled/moderated away. `locked` mirrors keywordTable's 留言不可刪
      // flag (see its header) — no delete UI exists yet either, this is just
      // the marker future delete/moderation code should respect.
      if (tier || kw?.locked) row.dataset.locked = 'true';

      // Firestore backend (shared/firebase.js) — fire-and-forget: a
      // misconfigured/offline backend must never block the local chat UI,
      // saveComment() itself swallows all errors for that reason.
      saveComment({
        text,
        name: rawName || null,
        scAmount: tier?.amount ?? null,
        scColor: tier?.color ?? null,
        sticker: sticker?.id ?? null,
      });
    },
  });
  // Exposed so ChatBoardLayer.destroy() can tear the modal's own DOM/
  // listeners down without buildOverlay() needing to return anything beyond
  // the single overlay root element.
  el._composeModal = composeModal;

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

    // The keyword hint itself now lives inside the compose modal (see
    // buildComposeModal's .ccm-msg-hint) — only the trigger bar's own
    // placeholder needs following here.
    this._offLang = DialogueStore.on('change', (snap) => {
      this.el._input.placeholder = INPUT_PLACEHOLDER[snap.lang] ?? INPUT_PLACEHOLDER.en;
      // The compose modal's own name/message placeholders, labels, and
      // keyword hint are handled by its own internal DialogueStore
      // subscription (see buildComposeModal's applyLang) — nothing to
      // re-apply here.
    });
  }

  setVisible(visible) {
    super.setVisible(visible);
    this._overlay.setVisible(visible);
  }

  destroy() {
    this._overlay.destroy();
    this._offLang();
    this.el._composeModal.destroy();
    super.destroy();
  }
}

export async function create(opts) {
  const loaded = await PIXI.Assets.load(opts.src);
  const sprite = loaded instanceof PIXI.Texture ? new PIXI.Sprite(loaded) : loaded;
  return new ChatBoardLayer({ ...opts, sprite });
}
