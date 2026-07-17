import { BaseImageLayer } from './BaseImageLayer.js';
import { attachDomOverlay } from './domSpriteOverlay.js';

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
        cursor: grab;
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
        border-radius: 999px; /* fixed, not --ng-u-scaled: always a full pill regardless of box size */
        background: #eee3f0;
        padding: 0 calc(var(--ng-u) * 8) 0 calc(var(--ng-u) * 20);
        font-family: inherit;
        font-size: calc(var(--ng-u) * 40);
        line-height: calc(var(--ng-u) * 60); /* == height, so text centers regardless of Silver.ttf's own ascent/descent metrics */
        color: #4b3d73;
        cursor: text;
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
      .ng-chat-toolbar span.send { background: #e08a9a; cursor: pointer; }
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
    thumb.style.cursor = 'grabbing';
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
    thumb.style.cursor = 'grab';
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
  inputbar.append(inputIcon, input);
  el.appendChild(inputbar);

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
    addRow(messages, text);
    input.value = '';
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
  }

  setVisible(visible) {
    super.setVisible(visible);
    this._overlay.setVisible(visible);
  }

  destroy() {
    this._overlay.destroy();
    super.destroy();
  }
}

export async function create(opts) {
  const loaded = await PIXI.Assets.load(opts.src);
  const sprite = loaded instanceof PIXI.Texture ? new PIXI.Sprite(loaded) : loaded;
  return new ChatBoardLayer({ ...opts, sprite });
}
