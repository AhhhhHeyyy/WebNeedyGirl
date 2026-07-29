import { BaseIframeLayer } from './BaseIframeLayer.js';
import { StatStore } from '../core/StatStore.js';
import { triggerPhoneCall } from './phoneCallOverlay.js';
import { clampIntoBoardingSafeArea, BOARDING_SAFE_PADDING_U } from '../core/boardingSafeArea.js';

// Renders the 5 clickable sticker icons on top of the "listStickers" board
// (UI/list-stickers.png, see listStickersLayer.js) plus their click-to-spawn
// falling-clone physics. Positioning is glued to that board's live screen
// box the same way holographicLayer.js glues itself to Frame 1 — but unlike
// holographic, the iframe itself can't be shrunk down to the board's own
// box (a clone has to be able to fall all the way off the bottom of the
// actual viewport, not just off the board), so this always stays a
// full-viewport, pointer-events:none iframe (retroFilterLayer.js's
// approach): pointer-events on an <iframe> element is a hard boundary from
// the parent document's side, all-or-nothing for the whole rectangle, so a
// full-viewport iframe can never selectively opt individual regions back in
// from the outside.
//
// Real hover/click is instead done exactly like holographicLayer.js already
// does for its shader's mouse-ripple: a window-level pointermove/click
// listener in the PARENT document, hit-tested in plain JS against each
// icon's last-known on-screen rect (reported back by the iframe via
// postMessage so this doesn't have to hand-duplicate the flex/padding
// layout math from style.css). This also sidesteps a real bug an earlier
// version of this file hit — putting a real DOM hit-target element on top
// of each icon and repositioning it every frame (to track the board's
// hover-lift tween) made Chromium spuriously re-fire pointerleave on every
// sub-pixel shift, flickering the hover state off almost immediately.
// Driving hover off manual math against a stationary mouse position instead
// of native boundary events on a moving target sidesteps that entirely.
//
const Z = 22; // below RETRO_FRONTMOST_Z (25) so retroFilter's camera-lens overlay still reads as the true topmost post-process

// retroFilter/man/pixelCursor/tvGlitch all pin themselves to their own fixed
// always-on-top z-index (see each file's own FRONTMOST_Z) regardless of
// where they sit in the panel's order — they never actually compete for
// "topmost in the Pixi/chat stack" position, so one of them landing after
// this layer in manager.layers (e.g. tvGlitch, added after stickerList) must
// not count as "something is in front of me" below. Without this, the plain
// "am I literally the last layer" check that used to work here breaks the
// instant any of these fixed-z layers is appended afterward, wrongly
// dropping this behind the canvas (and chat.chatboard's DOM overlay above
// it) even though none of those fixed-z layers actually needed it to.
const ALWAYS_FRONTMOST_IDS = new Set(['retroFilter', 'man', 'pixelCursor', 'tvGlitch']);

// Extra CSS-px padding around the icons' own union box that still counts as
// "the sticker list" for main.js's stage-area click handler (see
// containsPointWithDeadZone()) — a fat-finger tap that lands just outside a
// small icon on mobile would otherwise fall through to whatever's behind it
// (the "man" pop-up), since on a touchscreen there's no hover to narrow the
// tap down first the way a mouse cursor does.
const DEAD_ZONE_PADDING_PX = 28;

// Magnetic radius (CSS px) around each icon's own rect that still counts as
// "on" that icon for hover/click AND for the pixel-cursor's own visual snap
// (see getSnapPoint(), called from pixelCursorLayer.js) — lets the user
// approach an icon loosely instead of having to land exactly inside its
// (fairly small, 17%-of-board-width) hit box. Deliberately smaller than
// DEAD_ZONE_PADDING_PX: that one only has to keep a miss from falling through
// to whatever's behind the whole row, this one has to disambiguate between 5
// icons sitting fairly close together, so too generous a radius would start
// snapping to the wrong neighbor.
const SNAP_RADIUS_PX = 30;

// User-requested: the horizontal row's own SIZE, not just its position, has
// to be derived from Frame 1's live box too — the previous fix only moved
// the row's anchor point to Frame 1 but still sized it off the listStickers
// board sprite's own getBounds(). mobileWiden.js stretches Frame 1's width
// (scale.x) on narrow/short viewports but never touches the listStickers
// board at all, so the row's left edge tracked Frame 1 correctly while its
// WIDTH stayed frozen at the board's own unstretched size — the two visibly
// drifted apart instead of resizing together the way the stat HUD (which
// sizes itself off frame1Layer.js's own `fb.width`, see _repositionStatHud)
// already does.
// 0.55, not 1 (same width as Frame 1's own live box) — this used to be 1
// back when the sticker row and the stat HUD were two independently
// positioned, freely OVERLAPPING absolute boxes (icons only ever filled
// their own left-anchored slice of that box, so a box spanning the entire
// frame width never visually collided with the hud sitting further right
// within that same span). Now that the two are real flex siblings (user-
// requested — see frame1Layer.js's .ng-substat-row), their widths ADD
// instead of overlapping: at 1, the icon row's own footprint alone (~94% of
// this fraction, see the padding/gap math in _reposition()) left the stat
// hud with ~0 width to claim, and it visually vanished entirely (user
// report: "屬性表沒看到"). 0.55 leaves comfortable room for the hud's own
// WIDTH_FRACTION (0.4 of Frame 1's width, see frame1Layer.js) plus the gap
// between them.
const HORIZONTAL_ROW_WIDTH_FRACTION = 0.55;

// Fraction of the horizontal row's own width an icon occupies (mirrors
// UI/stickerList/style.css's `.sticker-item { width: 17% }` — the two can't
// literally share a constant across files, so keep them in sync by hand).
const ICON_WIDTH_FRACTION = 0.17;

// Fraction of the vertical column's own width an icon occupies in narrow
// mode (mirrored in UI/stickerList/style.css's `#sticker-row.vertical
// .sticker-item` rule — the two can't literally share a constant across
// files, so keep them in sync by hand). Only one icon sits per "row" of the
// stacked column, unlike the horizontal layout's 17% (sized for 5 abreast).
const VERT_ICON_WIDTH_FRACTION = 0.55;

// How much bigger the empty left/right pillarbox margin (see _reposition())
// needs to be than the narrow column's own width before it's considered
// roomy enough to actually host it — a bare "margin > colWidth" would let
// the column touch both the screen edge and Frame 1 with ~0 to spare.
const NARROW_MARGIN_FACTOR = 1.15;

// Narrow/mobile mode trades a hover-precise mouse for an imprecise finger,
// so the column's icons are sized up beyond what the horizontal row uses
// (see colWidth below) — easier to land a tap on, at the cost of fitting
// fewer of the margin's other uses. Purely a mobile affordance; the
// horizontal row (desktop/wide viewports) is untouched.
const MOBILE_ICON_SCALE = 1.5;

// Floor for the icons' own rendered pixel size (width AND height together —
// style.css's `.sticker-item` is `aspect-ratio: 1/1` sized purely off a %
// of the row's own box WIDTH, see _reposition()'s horizontal branch) once
// getStatRowAvailH() (frame1Layer.js) caps them down on a vertically cramped
// viewport. Same "prefer legible/tappable over merely non-overlapping" idea
// as frame1Layer.js's own MIN_TITLE_FONT_PX, just for a tap target instead
// of a font — picked a bit under DEAD_ZONE_PADDING_PX's own 28 (the
// fat-finger forgiveness margin already padded around the icons' union box),
// so the real target and its own forgiveness margin stay in the same
// ballpark instead of one dwarfing the other.
const MIN_ICON_PX = 30;

// Touch has no native hover, so a held finger gets its own gesture instead:
// hold past this on an icon to enter the same '.hovering' pose a desktop
// mouseover gets (see _startTouchHoldHover). Mirrors listStickersLayer.js's
// own LONG_PRESS_MS/MOVE_CANCEL_PX for the board's long-press-to-lift, kept
// as separate local constants (that file's board pin and this file's icon
// hover are independent gestures on different elements — nothing to share).
const LONG_PRESS_MS = 450;
const LONG_PRESS_MOVE_CANCEL_PX = 12;

// Sitting in the phone icon's (index 3, see STICKER_DELTAS below) '.hovering'
// pose — a real mouse hover, or touch's own hold-to-hover above — for this
// long opens phoneCallOverlay.js's incoming-call modal instead of requiring
// any click. Started/stopped from _setHovered() itself, so it always tracks
// the exact same hover state the '.hovering' CSS pose does: mousing off the
// icon (or a touch hold letting go before _startTouchHoldHover even applies
// the pose) cancels it, no separate drift-tracking needed here.
const CALL_HOVER_MS = 3000;
const PHONE_INDEX = 3;

// index -> StatStore delta (system/NeedyGirl-簡化版-工程實作規格.md §8-1).
// UI/stickerList/script.js's STICKERS array is purely positional (sticker1..5
// .png, no named identity anywhere in code) — this mapping was resolved by
// visually matching each PNG to the spec's named rows: 0 pill blister pack
// (精神藥物), 1 heart (愛心), 2 pink cat mascot (P君), 3 phone (手機), 4
// wrapped candy (毒品糖果). Phone's stress:+10 is a user-requested change,
// not from the spec doc. Heart no longer touches affection at all
// (user-requested — it used to carry affection:-6 in place of the spec's own
// affection:+6).
const STICKER_DELTAS = [
  { stress: -12, darkness: 6 },
  { stress: -6, darkness: -6 },
  { affection: 8, stress: -4 },
  { followers: 800, stress: 10 },
  { stress: -20, darkness: 14 },
];
const PILL_INDEX = 0;
const CANDY_INDEX = 4;

// 刷屏遞減 (§8-1): same icon's 5th+ click within a rolling 10s window gets
// its delta scaled down, so mashing one icon can't spam a stat to its cap.
const CLICK_DECAY_WINDOW_MS = 10_000;
const CLICK_DECAY_THRESHOLD = 5;
const CLICK_DECAY_MULTIPLIER = 0.3;

// OD 組合 (§8-1): pill then candy (or reverse) within 3s fires a combo
// delta instead of the second click's own base delta. Module-scope state
// (mirrors EffectDirector.js's windowBreakOn precedent for "one small
// persistent value bag" — there's only ever one StickerListLayer instance).
const OD_COMBO_WINDOW_MS = 3_000;
const clickTimestamps = [[], [], [], [], []]; // per-index rolling window, performance.now()
let lastPillClickTs = -Infinity;
let lastCandyClickTs = -Infinity;

function registerStickerClick(index) {
  const now = performance.now();
  const bucket = clickTimestamps[index];
  while (bucket.length && now - bucket[0] > CLICK_DECAY_WINDOW_MS) bucket.shift();
  bucket.push(now);

  // Combo check first — short-circuits the base delta below entirely.
  if (index === PILL_INDEX && now - lastCandyClickTs <= OD_COMBO_WINDOW_MS) {
    lastCandyClickTs = -Infinity; // consumed, so a third click can't re-pair with it
    lastPillClickTs = now;
    StatStore.announce({ stress: -StatStore.get('stress'), darkness: 25 });
    return;
  }
  if (index === CANDY_INDEX && now - lastPillClickTs <= OD_COMBO_WINDOW_MS) {
    lastPillClickTs = -Infinity;
    lastCandyClickTs = now;
    StatStore.announce({ stress: -StatStore.get('stress'), darkness: 25 });
    return;
  }
  if (index === PILL_INDEX) lastPillClickTs = now;
  if (index === CANDY_INDEX) lastCandyClickTs = now;

  const base = STICKER_DELTAS[index];
  if (!base) return;
  const scale = bucket.length >= CLICK_DECAY_THRESHOLD ? CLICK_DECAY_MULTIPLIER : 1;
  const delta = {};
  Object.entries(base).forEach(([key, v]) => { delta[key] = v * scale; });
  StatStore.announce(delta);
}

export class StickerListLayer extends BaseIframeLayer {
  constructor(opts) {
    super(opts);
    this.manager = opts.manager;
    this.stage = opts.stage;
    this.el.style.pointerEvents = 'none';

    // User-adjustable on top of the container's own fixed base anchor — in
    // horizontal mode that anchor is now frame1Layer.js's shared flex row
    // (see .ng-substat-row/.ng-sticker-slot in its ensureStyles()), which
    // owns the row's actual position; x/y here applies as a plain offset on
    // top of wherever the flex layout places the sticker slot (see
    // _reposition()'s horizontal branch), scaleX/scaleY/rotation apply as a
    // CSS transform around the (shifted) box's center. Lets the panel's
    // normal x/y/scale/rotate sliders (see LayerPanel.js) keep working here
    // like any other layer without fighting the flex-derived anchor.
    this._transform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };

    this._itemRects = null; // page-coordinate rects for the 5 icons, refreshed from the iframe's own measurements
    this._hoveredIndex = -1;

    this._wired = false;

    this._onWindowPointerMove = (e) => {
      if (e.pointerType !== 'mouse' || !this.visible) return;
      this._setHovered(this._indexAt(e.clientX, e.clientY));
    };
    this._onWindowClick = (e) => {
      if (!this.visible) return;
      const i = this._indexAt(e.clientX, e.clientY);
      if (i === -1) return;
      // A completed call-long-press still ends in a normal 'click' once the
      // pointer lifts (the browser fires one regardless of hold duration, as
      // long as it didn't drift) — swallow just that one so the phone icon
      // doesn't also spawn its falling clone / apply its stat delta right on
      // top of the call modal opening.
      if (this._suppressNextClickIndex === i) { this._suppressNextClickIndex = -1; return; }
      this._postClick(i);
    };
    // Capture phase, on window (ahead of the canvas in the propagation
    // path) — a mousedown/tap on a sticker icon still lands on the Pixi
    // board sprite underneath (same all-or-nothing iframe pointer-events
    // reason as above), which would otherwise fire the board's own
    // pointerdown handling (listStickersLayer.js's drag-start and its
    // hover-lift cancel/close). Stopping it here before it ever reaches the
    // canvas keeps the board lifted and undragged for what's actually just
    // a click-to-spawn — the separate, later 'click' event below is
    // untouched by this and still fires normally.
    this._onWindowPointerDown = (e) => {
      if (!this.visible) return;
      const i = this._indexAt(e.clientX, e.clientY);
      if (i !== -1) e.stopPropagation();
      if (e.pointerType !== 'mouse') this._startTouchHoldHover(i, e);
      // User-requested: clicking the phone icon shouldn't itself count toward
      // the call-hover seconds — only touch-free hovering does. Mouse-only:
      // touch has no independent hover state to protect (its own hold-to-
      // hover gesture IS the press, see _startTouchHoldHover), so pausing on
      // every touch pointerdown would make the timer unreachable there.
      if (i === PHONE_INDEX && e.pointerType === 'mouse') this._pauseCallHoverTimer();
    };
    this._onWindowPointerUp = () => {
      if (this._hoveredIndex === PHONE_INDEX) this._resumeCallHoverTimer();
    };
    // Touch-only long-press-to-hover bookkeeping (see _startTouchHoldHover).
    this._pressTimer = null;
    this._pressCleanup = null;
    this._touchHoverActive = false;
    this._onTouchHoldRelease = () => this._cancelTouchHoldHover();
    // Phone-icon call-hover bookkeeping (see _startCallHoverTimer, driven
    // from _setHovered()).
    this._callHoverTimer = null;
    this._suppressNextClickIndex = -1;
    window.addEventListener('pointermove', this._onWindowPointerMove);
    window.addEventListener('click', this._onWindowClick);
    window.addEventListener('pointerdown', this._onWindowPointerDown, true);
    window.addEventListener('pointerup', this._onWindowPointerUp);

    this._onMessage = (e) => {
      if (e.origin !== window.location.origin || e.source !== this.el.contentWindow) return;
      if (e.data?.type === 'ng-stickerlist-rects') this._storeRects(e.data.rects);
    };
    window.addEventListener('message', this._onMessage);

    this._offManagerChange = this.manager.onChange(() => this._wireBoardHoverOpen());
    this._offResize = this.stage.onResize(() => this._reposition());
    this._wireBoardHoverOpen();

    // listStickersLayer's own hover-lift/drop is a per-frame Pixi tween
    // (its _onTick directly mutates sprite.y every frame without ever
    // calling onChange — see that file) rather than a one-off transform
    // change, so the only way to keep the icon row glued to the board while
    // it's mid-lift is to re-measure every frame too, not just on
    // manager.onChange/stage.onResize. _reposition() itself no-ops the
    // postMessage when nothing actually moved, so this costs near nothing
    // while the board is sitting still.
    this._lastPos = null;
    this._tick = () => this._reposition();
    this.stage.app.ticker.add(this._tick);
  }

  // The board (listStickers) may finish loading after this layer does —
  // both load concurrently in main.js's boot() with no ordering guarantee —
  // so this re-tries on every manager change until the sprite actually
  // exists, then wires once.
  _wireBoardHoverOpen() {
    if (this._wired) return;
    const board = this.manager.get('listStickers');
    if (!board || !board.sprite) return;
    this._wired = true;

    // Fired by listStickersLayer.js once the board's own lift/pop animation
    // has actually finished rising (mouse hover-lift or touch long-press
    // pin alike) — the icons' entrance pulse waits for that instead of
    // firing the instant the gesture starts, so it visibly lands only once
    // the board has settled at the top of its pop.
    board.sprite.on('ng-board-opened', () => this._postOpen());
    // Fired the instant the board starts closing (not once it finishes) —
    // hides the icons right away instead of leaving them visible while the
    // board sinks back down underneath them.
    board.sprite.on('ng-board-closing', () => this._postClose());
  }

  _postOpen() {
    this.el.contentWindow?.postMessage({ type: 'ng-stickerlist-open' }, window.location.origin);
  }

  _postClose() {
    this.el.contentWindow?.postMessage({ type: 'ng-stickerlist-close' }, window.location.origin);
  }

  _postHover(index, hover) {
    this.el.contentWindow?.postMessage({ type: 'ng-stickerlist-hover', index, hover }, window.location.origin);
  }

  _postClick(index) {
    registerStickerClick(index);
    this.el.contentWindow?.postMessage({ type: 'ng-stickerlist-click', index }, window.location.origin);
  }

  _setHovered(index) {
    if (index === this._hoveredIndex) return;
    if (this._hoveredIndex !== -1) this._postHover(this._hoveredIndex, false);
    this._cancelCallHoverTimer();
    this._hoveredIndex = index;
    if (index !== -1) {
      this._postHover(index, true);
      if (index === PHONE_INDEX) this._startCallHoverTimer(index);
    }
  }

  // Runs while the phone icon sits in its '.hovering' pose (real mouse hover,
  // or touch's own hold-to-hover) — fires phoneCallOverlay.js's incoming-call
  // modal once that pose has held continuously, with no click at all (see
  // _pauseCallHoverTimer), for a full CALL_HOVER_MS. Always started/stopped
  // in lockstep with _setHovered() itself, so there's nothing separate to
  // cancel on mouse-out/touch-release/layer-hide — whatever un-hovers the
  // icon already routes back through _setHovered.
  _startCallHoverTimer(index) {
    this._callHoverTimer = setTimeout(() => this._fireCallHover(index), CALL_HOVER_MS);
  }

  // Un-hovering entirely (moved off the icon, touch released, layer hidden)
  // drops all progress — only a single unbroken, click-free hover run
  // counts, resuming later starts the CALL_HOVER_MS count over from zero.
  _cancelCallHoverTimer() {
    if (this._callHoverTimer) { clearTimeout(this._callHoverTimer); this._callHoverTimer = null; }
  }

  // User-requested: "只要複製體有出來(有點擊sticker) 就要停止計算hover" — a
  // mouse-button-down on the phone icon must fully restart the count, not
  // just bank-and-pause it. An earlier version banked the elapsed time so
  // far and resumed from there on release — but that let a rapid run of
  // repeated clicks still creep past CALL_HOVER_MS via the small hover gaps
  // between each release and the next press, quietly summing to 3s and
  // firing the call despite the user visibly just mashing the icon. Fully
  // restarting on every click closes that: only one truly unbroken,
  // click-free CALL_HOVER_MS hover can ever fire it.
  _pauseCallHoverTimer() {
    this._cancelCallHoverTimer();
  }

  _resumeCallHoverTimer() {
    if (this._callHoverTimer || this._hoveredIndex !== PHONE_INDEX) return;
    this._startCallHoverTimer(PHONE_INDEX);
  }

  _fireCallHover(index) {
    this._callHoverTimer = null;
    this._suppressNextClickIndex = index;
    triggerPhoneCall();
  }

  // Fired from _onWindowPointerDown for any non-mouse pointer landing on an
  // icon — starts a LONG_PRESS_MS hold timer that, if not cancelled by too
  // much finger drift or an early release, flips the icon into the same
  // '.hovering' pose _onWindowPointerMove drives for a real mouse-over.
  // Released/cancelled the moment the hold ends (no listStickersLayer-style
  // "pin until an outside tap" — this is just "show the hover pose while
  // held"), so the finger lifting off is what puts it back to idle.
  _startTouchHoldHover(index, e) {
    this._cancelTouchHoldHover();
    if (index === -1) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const onMove = (ev) => {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > LONG_PRESS_MOVE_CANCEL_PX) this._cancelTouchHoldHover();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', this._onTouchHoldRelease);
    window.addEventListener('pointercancel', this._onTouchHoldRelease);
    this._pressCleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', this._onTouchHoldRelease);
      window.removeEventListener('pointercancel', this._onTouchHoldRelease);
    };
    this._pressTimer = setTimeout(() => {
      this._pressTimer = null;
      this._touchHoverActive = true;
      this._setHovered(index);
    }, LONG_PRESS_MS);
  }

  // Ends the hold (timer not yet fired, or the hover pose already applied)
  // and drops the icon back to idle if the pose was actually showing —
  // called on early release/cancel/drift-cancel, and unconditionally at the
  // start of every new touch so a stray leftover timer/listener from a prior
  // gesture can't fire late.
  _cancelTouchHoldHover() {
    if (this._pressTimer) { clearTimeout(this._pressTimer); this._pressTimer = null; }
    this._pressCleanup?.();
    this._pressCleanup = null;
    if (this._touchHoverActive) {
      this._touchHoverActive = false;
      this._setHovered(-1);
    }
  }

  // Union of the 5 icons' last-known on-screen boxes, padded by
  // DEAD_ZONE_PADDING_PX. Used instead of the underlying listStickers board
  // sprite's own Pixi bounds — in narrow/mobile layout the icon column
  // floats independently in the side margin (see _reposition()'s "narrow"
  // branch) and no longer overlaps the board sprite's hit box at all, so a
  // tap that just misses an icon there would otherwise fall all the way
  // through main.js's click handler to the "man" pop-up behind it.
  containsPointWithDeadZone(clientX, clientY) {
    if (!this.visible || !this._itemRects || !this._itemRects.length) return false;
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const r of this._itemRects) {
      if (!r) continue;
      left = Math.min(left, r.left);
      top = Math.min(top, r.top);
      right = Math.max(right, r.left + r.width);
      bottom = Math.max(bottom, r.top + r.height);
    }
    if (left > right) return false;
    return clientX >= left - DEAD_ZONE_PADDING_PX && clientX <= right + DEAD_ZONE_PADDING_PX &&
      clientY >= top - DEAD_ZONE_PADDING_PX && clientY <= bottom + DEAD_ZONE_PADDING_PX;
  }

  // Nearest icon to (clientX, clientY) — 0 distance if the point is already
  // inside that icon's rect, otherwise the distance to its closest edge/
  // corner. Single source of truth for both the magnetic hit-test
  // (_indexAt) and the pixel-cursor's visual snap target (getSnapPoint),
  // so a click only ever counts as landing on the icon the cursor is shown
  // magnetized to, never a different one.
  _nearestSnap(clientX, clientY) {
    if (!this._itemRects) return null;
    let bestIndex = -1, bestDist = Infinity, bestPoint = null;
    for (let i = 0; i < this._itemRects.length; i++) {
      const r = this._itemRects[i];
      if (!r) continue;
      const px = Math.max(r.left, Math.min(clientX, r.left + r.width));
      const py = Math.max(r.top, Math.min(clientY, r.top + r.height));
      const dist = Math.hypot(clientX - px, clientY - py);
      if (dist < bestDist) { bestDist = dist; bestIndex = i; bestPoint = { x: px, y: py }; }
    }
    if (bestIndex === -1 || bestDist > SNAP_RADIUS_PX) return null;
    return { index: bestIndex, point: bestPoint };
  }

  _indexAt(clientX, clientY) {
    const snap = this._nearestSnap(clientX, clientY);
    return snap ? snap.index : -1;
  }

  // Called by pixelCursorLayer.js on every real pointermove — the point the
  // custom cursor sprite should actually be drawn at when the real pointer
  // is within SNAP_RADIUS_PX of an icon (null when it isn't, i.e. render at
  // the real pointer position as usual). Sharing _nearestSnap with the
  // hover/click hit-test above guarantees the cursor is never shown sitting
  // on an icon that a click at the same real position wouldn't register on.
  getSnapPoint(clientX, clientY) {
    if (!this.visible) return null;
    const snap = this._nearestSnap(clientX, clientY);
    return snap ? snap.point : null;
  }

  // Converts the iframe-local rects the iframe measured for its own 5
  // .sticker-item elements into page coordinates (the iframe always covers
  // the full stage box at (0,0), but read its live rect rather than assume
  // that).
  _storeRects(rects) {
    if (!rects) return;
    const frameBox = this.el.getBoundingClientRect();
    this._itemRects = rects.map(r => (r && {
      left: frameBox.left + r.left, top: frameBox.top + r.top, width: r.width, height: r.height,
    }));
  }

  _reposition() {
    const board = this.manager.get('listStickers');
    const frame1 = this.manager.get('frame1');
    if (!board || !board.sprite || !frame1 || !frame1.sprite) return;

    const scale = this.stage.scaleFactor;
    const t = this._transform;

    // Frame 1's own box — sprite.getBounds() is the same PIXI global-space
    // AABB frame1Layer.js's own _repositionStatHud() reads off frame1/chat's
    // sprites, already in the #stage-world/iframe's own screen-pixel space
    // (see domSpriteOverlay.js's header comment) with every parent transform
    // (position, scale, rotation, mobileWiden.js's own width-only stretch)
    // baked in, unlike a hand-rolled `stage.root.position + sprite.x * scale`
    // recompute that assumes a centered anchor and no extra parent
    // transforms. Re-read every tick (same pattern holographicLayer.js uses
    // to track Frame 1) so both the normal horizontal anchor and the
    // narrow-mode vertical one below stay flush with the frame at any window
    // size/aspect ratio, not just the one they were tuned at.
    const frameBounds = frame1.sprite.getBounds();
    const frameScreenW = frameBounds.width;
    const frameScreenH = frameBounds.height;
    const frameLeftX = frameBounds.x;
    const frameTopY = frameBounds.y;

    // t.x/t.y (the panel's own x/y nudge sliders, see setTransform()) are
    // flat logical-px offsets — converting them to screen px needs whatever
    // per-axis stretch the thing they're anchored to is under: Frame 1's own
    // sprite scale (its authored y-scale, since mobileWiden never touches
    // scale.y; on the x-axis, that same authored scale further stretched by
    // mobileWiden.js on narrow/short viewports, scale.x only).
    const stretchX = frame1.sprite.scale.x;
    const stretchY = frame1.sprite.scale.y;

    // Empty margin to the left of Frame 1's own live box — nonzero whenever
    // the viewport is wider-relative-to-height than 16:9 (Stage.resize()'s
    // scale is then height-bound, leaving spare width on both sides), which
    // is exactly the "screen height too short in landscape" case a user hits
    // on short/wide displays. Below that threshold there's nowhere to put a
    // side column, so this keeps falling back to the normal below-frame row.
    // Deliberately Frame 1's actual left edge (frameLeftX), not the
    // theoretical edge of the un-widened 1920x1080 composition — mobileWiden.js
    // may have already pushed Frame 1 outward to reclaim part of that margin
    // for itself, and this has to treat whatever's left of Frame 1's real
    // edge as the only space actually free, or the column ends up floating
    // on top of Frame 1 instead of beside it.
    const marginPx = frameLeftX;

    // Row's own box (both branches below) — sized as a fraction of Frame 1's
    // own live width, not the listStickers board sprite's own getBounds().
    // mobileWiden.js stretches Frame 1's width (scale.x) on narrow/short
    // viewports but never touches the listStickers board at all, so sizing
    // off the board's own box left the row's SIZE frozen while its anchor
    // point (frameLeftX/frameTopY, already Frame-1-derived) kept tracking
    // Frame 1's widening box — the two drifted apart instead of resizing
    // together, same complaint the earlier position-only fix didn't cover.
    const screenW = frameScreenW * HORIZONTAL_ROW_WIDTH_FRACTION;
    // Icon size is scaled up from what the horizontal row uses (17% of
    // screenW, style.css's .sticker-item) by MOBILE_ICON_SCALE — backed out
    // into the column width that yields it again once the CSS shrinks it to
    // VERT_ICON_WIDTH_FRACTION.
    const colWidth = (ICON_WIDTH_FRACTION * screenW * MOBILE_ICON_SCALE) / VERT_ICON_WIDTH_FRACTION;
    const narrow = marginPx > colWidth * NARROW_MARGIN_FACTOR;

    // Falling-clone size (script.js's spawnClone) is authored in fixed CSS
    // px against a ~1920x1080 desktop viewport (where `scale` is ~1) — on a
    // much smaller mobile viewport that same fixed size would read as
    // oversized, so it's scaled down by the same logical-to-screen ratio
    // everything else on stage uses. Capped at 1 so it never grows past its
    // authored size on a desktop viewport bigger than 1920x1080.
    const cloneScale = Math.min(1, scale);

    // User-requested: the sticker row and frame1Layer.js's stat HUD are now a
    // real CSS flex relationship (row + fixed gap), not two independently
    // hand-rolled anchors — see .ng-substat-row/.ng-sticker-slot's own CSS
    // comment in frame1Layer.js's ensureStyles() for why an iframe's content
    // needs this plain placeholder element as a bridge. Only meaningful in
    // "horizontal" (non-narrow) mode below — "narrow" mode floats
    // independently in the side margin and doesn't participate in that row
    // at all, same as before this change.
    const stickerSlot = document.querySelector('.ng-sticker-slot');

    let pos;
    if (narrow) {
      // Floats independently in the side margin instead of tracking the
      // listStickers board underneath — there's no board art out there to
      // stay glued to.
      if (stickerSlot) stickerSlot.style.display = 'none'; // opt out of frame1Layer.js's flex row entirely — let the stat hud have the row to itself
      pos = {
        left: (marginPx - colWidth) / 2,
        top: frameTopY,
        width: colWidth,
        height: frameScreenH * 0.85,
        scaleX: t.scaleX,
        scaleY: t.scaleY,
        rotation: t.rotation,
        orientation: 'vertical',
        cloneScale,
      };
    } else {
      // frame1Layer.js hasn't built its flex row yet — both layers load
      // concurrently in main.js's boot() with no ordering guarantee (same
      // caveat this file's own _wireBoardHoverOpen() already documents for
      // the listStickers board). Try again next tick once it exists.
      if (!stickerSlot) return;

      // ---- Icon size: same class of bug frame1Layer.js's stat hud had
      // (see its own vScale/hudMaxU comments in _repositionStatHud) — the
      // icons' size has only ever been derived from WIDTH (ICON_WIDTH_
      // FRACTION of screenW, itself HORIZONTAL_ROW_WIDTH_FRACTION of Frame
      // 1's own on-screen width), with nothing checking whether that size
      // actually fits the vertical gap below Frame 1. On a mobileWiden-
      // stretched (wide/short) viewport, Frame 1's own width gets pushed
      // well past its "real" scale to reclaim the pillarbox margin,
      // inflating screenW — and therefore icon size — right along with it
      // (user-requested: "請按照差不多的RWD邏輯 修正Sticker的高度位置縮放",
      // after frame1Layer.js's stat hud got this same class of fix).
      // getStatRowAvailH() returns the exact vertical budget the hud itself
      // is capped to — both are flex-start-aligned siblings sharing this
      // row's one top anchor (see .ng-substat-row's own CSS comment in
      // frame1Layer.js), so "never taller than that same ceiling" is
      // exactly "never overlaps Frame 1 or the boarding" here too, with no
      // separate copy of TOP_OFFSET_U/BOTTOM_SAFE_U/HINT_GAP_U/vScale to
      // keep in sync by hand. Falls back to Infinity (no ceiling) before
      // frame1Layer.js's own first tick has ever run.
      const availH = frame1.getStatRowAvailH ? frame1.getStatRowAvailH() : null;
      const naturalIconSize = ICON_WIDTH_FRACTION * screenW;
      // Prefer a legible/tappable floor (MIN_ICON_PX) the same way
      // frame1Layer.js's idealHudU prefers MIN_TITLE_FONT_PX — but clamp
      // continuously to whatever vertical room actually exists (hudMaxU's
      // exact pattern: `Math.min(ideal, ceiling)`) rather than a binary
      // switch, so the icons ease down smoothly on a cramped viewport
      // instead of jumping straight past the floor.
      const idealIconSize = Math.max(naturalIconSize, MIN_ICON_PX);
      const iconSize = availH == null ? idealIconSize : Math.min(idealIconSize, Math.max(0, availH));
      // Icons are square and sized purely off a % of the row's own box
      // WIDTH (style.css's `.sticker-item { width: 17%; aspect-ratio: 1/1 }`)
      // — capping only the "height" field posted to the iframe would shrink
      // the invisible container box but leave the actual on-screen icons
      // (which never read that height at all) untouched. Solving back for
      // the WIDTH that produces the clamped `iconSize` is what actually
      // shrinks/grows the icons themselves, so this replaces `screenW`
      // wherever it drove sizing below (the reserved flex-slot footprint,
      // and the box width posted to the iframe).
      const effectiveScreenW = iconSize / ICON_WIDTH_FRACTION;

      // Reserve this row's own footprint as a flex item in frame1Layer.js's
      // shared row — its LEFT/TOP then falls out of the browser's own flex
      // layout (row anchor + fixed gap + however much width the stat hud
      // claims), not anything hand-computed here, so it can no longer drift
      // from the stat hud's own anchor the way two independent computations
      // used to (the exact bug this replaces — see git history/PR notes).
      // Reserved in frame1Layer.js's flex row as the icons' own TIGHT
      // footprint (mirrors #sticker-row's CSS: 1% left padding + 5 icons at
      // 17% + 4 gaps at 2% = 94% of effectiveScreenW) — NOT the full
      // effectiveScreenW sent to the iframe below (see `pos.width` further
      // down), which still includes #sticker-row's own ~6% of unused
      // right-side padding past the last icon. Reserving that unused
      // padding as if it were occupied would just steal that much extra
      // width from the stat hud for nothing actually visible there — the
      // exact bug that made the whole hud vanish when this used the full
      // screenW as the slot's width (user report: "屬性表沒看到").
      const ICON_ROW_FOOTPRINT_FRACTION = 0.01 + 5 * ICON_WIDTH_FRACTION + 4 * 0.02;
      stickerSlot.style.display = '';
      stickerSlot.style.width = `${effectiveScreenW * ICON_ROW_FOOTPRINT_FRACTION}px`;
      stickerSlot.style.height = `${iconSize}px`;

      // Forces a layout read — same tradeoff frame1Layer.js's own per-tick
      // .ng-corner-hint read already accepts — needed because the slot's
      // real on-screen position now depends on live flex layout this file
      // can't precompute standalone anymore.
      const slotRect = stickerSlot.getBoundingClientRect();
      // Iframe-local coordinates: this.el is the full-viewport iframe (see
      // this file's own header comment) script.js's postMessage handler
      // expects positions relative to — the same left/top conversion
      // _storeRects() already does in the opposite direction (iframe-local
      // -> page).
      const frameBox = this.el.getBoundingClientRect();

      pos = {
        // t.x/t.y (the panel's own nudge sliders) apply as an offset on top
        // of the flex-computed base position, same per-axis stretch
        // conversion as before this change. slotRect's LEFT/TOP (not its
        // width/height) is what actually matters here — the tight slot and
        // the full effectiveScreenW box below share the same starting edge
        // (#sticker-row's own 1% left padding), they just extend different
        // amounts further right.
        left: slotRect.left - frameBox.left + t.x * stretchX * scale,
        top: slotRect.top - frameBox.top + t.y * stretchY * scale,
        // effectiveScreenW/iconSize (the FULL, height-clamped box, not the
        // tightened slot) — #sticker-row's own percentage-based icon sizing
        // (17% of this width) renders icons at exactly the pixel size the
        // availH clamp above resolved to, regardless of how tightly
        // frame1Layer.js's flex row reserves space for them.
        width: effectiveScreenW,
        height: iconSize,
        scaleX: t.scaleX,
        scaleY: t.scaleY,
        rotation: t.rotation,
        orientation: 'horizontal',
        cloneScale,
      };
    }

    if (narrow) {
      // Guard against the column's own box pushing past the visible stage
      // box entirely on an extreme aspect ratio — the primary mechanism for
      // this branch, which (unlike the horizontal row above) has no
      // inflated invisible-box quirk to work around: its own box height
      // (frameScreenH * 0.85) already is its real visible footprint. Padded,
      // not flush against 0/stageW/stageH — see boardingSafeArea.js: this
      // and frame1Layer.js's stat HUD share the same boarding-edge inset so
      // neither ever sits flush against the boarding art's own border.
      const clamped = clampIntoBoardingSafeArea(this.stage, pos);
      pos.left = clamped.left;
      pos.top = clamped.top;
    }

    const prev = this._lastPos;
    if (prev && Math.abs(prev.left - pos.left) < 0.05 && Math.abs(prev.top - pos.top) < 0.05 &&
        Math.abs(prev.width - pos.width) < 0.05 && Math.abs(prev.height - pos.height) < 0.05 &&
        prev.scaleX === pos.scaleX && prev.scaleY === pos.scaleY && prev.rotation === pos.rotation &&
        prev.orientation === pos.orientation && prev.cloneScale === pos.cloneScale) return;
    this._lastPos = pos;

    this.el.contentWindow?.postMessage({ type: 'ng-stickerlist-position', ...pos }, window.location.origin);
  }

  getTransform() {
    return { ...this._transform };
  }

  // Driven by the panel's normal x/y/scale/rotate sliders (LayerPanel.js
  // renders these for any layer that has getTransform/setTransform) — the
  // next ticker-driven _reposition() picks the new values up and forwards
  // them to the iframe, same as a board move/resize would.
  setTransform(t) {
    Object.assign(this._transform, t);
  }

  // An iframe is one DOM block — it can only sit in front of or behind the
  // whole Pixi canvas, never interleaved sprite-by-sprite with whatever's
  // dragged in front of/behind the board (same constraint documented in
  // holographicLayer.js/main.js's reconcileZIndex). So "layer order" here
  // is a front/back toggle: this stays above Pixi (and the board) only
  // while it's the topmost layer in the panel's own order, otherwise it
  // drops behind the canvas. Note this only changes what's drawn on top —
  // clicks/hover still hit-test against the icons' own on-screen rects
  // (see _indexAt) regardless of what's visually covering them.
  setZIndex(_i) {
    const layers = this.manager.layers;
    const selfIndex = layers.indexOf(this);
    const isFrontmost = selfIndex !== -1 &&
      layers.slice(selfIndex + 1).every(l => ALWAYS_FRONTMOST_IDS.has(l.id));
    this.el.style.zIndex = isFrontmost ? String(Z) : '5';
  }

  setVisible(visible) {
    super.setVisible(visible);
    if (!visible) {
      this._cancelTouchHoldHover();
      this._setHovered(-1);
    }
  }

  destroy() {
    this._cancelTouchHoldHover();
    this._cancelCallHoverTimer();
    this._offManagerChange();
    this._offResize();
    this.stage.app.ticker.remove(this._tick);
    window.removeEventListener('pointermove', this._onWindowPointerMove);
    window.removeEventListener('click', this._onWindowClick);
    window.removeEventListener('pointerdown', this._onWindowPointerDown, true);
    window.removeEventListener('pointerup', this._onWindowPointerUp);
    window.removeEventListener('message', this._onMessage);
    super.destroy();
  }
}

export async function create(opts) {
  return new StickerListLayer({ ...opts, src: `${opts.folder}/index.html` });
}
