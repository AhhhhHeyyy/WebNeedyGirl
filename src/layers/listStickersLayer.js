import { BoardAnchoredLayer } from './BoardAnchoredLayer.js';

// easeOutBack overshoots past its target before settling back to it — on the
// way up that reads as a springy "pop", on the way down (target 0, coming
// from a positive lift) the overshoot dips just past rest before returning,
// which is what gives the drop its little rebound. https://easings.net/#easeOutBack
function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

// Fraction of the board's own current height (sprite.height, which already
// bakes in sprite.scale.y) instead of a fixed logical-px amount — a board
// resized bigger/smaller via the panel's scale slider should lift by a
// proportional amount, not the same absolute distance regardless of size.
const LIFT_RATIO = 0.0997; // ~100px at this asset's native/authored scale
const LIFT_MS = 420;
const DROP_MS = 320;
// Real hover (pointerover/out) doesn't exist on a touchscreen — the browser
// synthesizes a pointerover right before a tap's pointerdown and a pointerout
// only once something else steals focus, so the plain hover handlers below
// would either never lift, or lift-and-never-drop. Touch instead gets its
// own gesture: hold past LONG_PRESS_MS to lift and pin it open, tap anywhere
// outside the sprite to close it again.
const LONG_PRESS_MS = 450;
// A finger drifting this many CSS px during the hold reads as a drag/scroll
// attempt, not a deliberate long-press, so the timer is cancelled.
const LONG_PRESS_MOVE_CANCEL_PX = 12;
// Icons don't need to wait for the lift to fully settle before starting
// their own entrance — firing partway through reads as more responsive and
// the lift's own overshoot/settle tail is barely noticeable by then anyway.
const OPEN_SIGNAL_PROGRESS = 0;

// Sibling of chat.chatboardLayer's custom-module pattern: the sticker list
// is otherwise a plain BoardAnchoredLayer (see that file — keeps this glued
// to heading.boarding's non-uniform stretch instead of drifting off it on
// resize), this just layers a hover lift+bounce on top of it.
export class ListStickersLayer extends BoardAnchoredLayer {
  constructor(opts) {
    super(opts);

    // Px currently subtracted from sprite.y by the in-flight animation —
    // tracked as a delta (not an absolute y) so it composes with whatever
    // DragTransform has done to sprite.y instead of fighting it.
    this._appliedLift = 0;
    this._animFrom = 0;
    this._animTo = 0;
    this._animStart = 0;
    this._animDuration = 0;
    this._animActive = false;
    this._openSignaled = false; // guards 'ng-board-opened' to once per lift, see _onTick

    this.ticker = opts.stage.app.ticker;
    this._tick = () => this._onTick();

    // Touch-only: true once a long-press has lifted the list and it's
    // holding itself open, waiting for an outside tap to close it again.
    this._pinned = false;
    this._pressTimer = null;
    this._pressCleanup = null;

    this.sprite.on('pointerover', (e) => {
      if (e.pointerType === 'mouse') this._animateTo(this._liftPx(), LIFT_MS);
    });
    this.sprite.on('pointerout', (e) => {
      if (e.pointerType === 'mouse') this._animateTo(0, DROP_MS);
    });
    // Grabbing it (to drag-reposition in the editor) shouldn't inherit
    // whatever hover-lift happened to be mid-flight or already settled —
    // DragTransform captures its drag-start y right after this fires, so a
    // stale lift baked into sprite.y here would offset the whole drag (and
    // whatever anchor gets saved from it). Just freezing the animation
    // (_stopAnim() alone) isn't enough: the *next* pointerout still
    // subtracts that stale lift back out of sprite.y well after the drag/
    // save, silently shifting the just-dragged position — which is exactly
    // what reads as "the position I saved reverted".
    this.sprite.on('pointerdown', (e) => {
      this._cancelLift();
      if (e.pointerType !== 'mouse') this._startLongPress(e);
    });

    // Capture phase + window (not the sprite) so it sees every tap on the
    // page, including ones that land outside Pixi's own hit-testing.
    this._onGlobalPointerDown = (e) => this._maybeUnpin(e);
    window.addEventListener('pointerdown', this._onGlobalPointerDown, true);
  }

  _startLongPress(e) {
    if (this._pinned) return; // already held open — a bare tap on it shouldn't restart the timer
    const startX = e.clientX;
    const startY = e.clientY;

    const onMove = (ev) => {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > LONG_PRESS_MOVE_CANCEL_PX) cleanup();
    };
    const cleanup = () => {
      clearTimeout(this._pressTimer);
      this._pressTimer = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);
      this._pressCleanup = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cleanup);
    this._pressCleanup = cleanup;

    this._pressTimer = setTimeout(() => {
      cleanup();
      this._pinned = true;
      this._animateTo(this._liftPx(), LIFT_MS);
    }, LONG_PRESS_MS);
  }

  // sprite.height already bakes in sprite.scale.y (Pixi's own getter), so
  // this tracks the board's live on-screen size — a scale-slider resize
  // changes the lift distance right along with it instead of leaving a
  // fixed-px lift looking too small on a bigger board or too big on a
  // smaller one.
  _liftPx() {
    return this.sprite.height * LIFT_RATIO;
  }

  // BoardAnchoredLayer's own _reposition() (wired to stage.onResize — fires
  // whenever the layer panel is toggled, not just on an actual window
  // resize) recomputes sprite.y from scratch from the board's resting
  // anchor, with no notion of an in-flight/settled hover lift on top of it.
  // Left alone, toggling the panel while lifted (hovered, or long-press
  // pinned) yanks the board back down to its resting position out from
  // under the pointer — which then also fires a spurious pointerout/close.
  // Reapplying the currently-applied lift after the base reposition keeps
  // it visually lifted through the resize instead of snapping shut.
  _reposition() {
    super._reposition();
    this.sprite.y -= this._appliedLift || 0;
  }

  // Undoes whatever lift is currently baked into sprite.y (in-flight or
  // fully settled) and zeroes the bookkeeping, instead of just freezing the
  // ticker in place — see the pointerdown handler above for why a frozen-
  // but-nonzero _appliedLift is the actual bug, not just a visual nicety.
  _cancelLift() {
    this._stopAnim();
    if (this._appliedLift) {
      this.sprite.y += this._appliedLift;
      this._appliedLift = 0;
      this.sprite.emit('ng-board-closing');
    }
    this._openSignaled = false;
  }

  // Any tap that lands outside the sprite's own bounds closes a long-press-
  // pinned list back down; a tap on the sprite itself is left alone.
  _maybeUnpin(e) {
    if (!this._pinned) return;
    const rect = this.stage.app.view.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    if (this.sprite.getBounds().contains(px, py)) return;
    this._pinned = false;
    this._animateTo(0, DROP_MS);
  }

  _animateTo(target, duration) {
    // Fired the instant a close starts (not once it finishes) — stickerListLayer.js
    // listens for this to hide its icons right away instead of leaving them
    // visible while the board sinks back down underneath them.
    if (target === 0) this.sprite.emit('ng-board-closing');
    // Reset so a fresh lift-open fires its own 'ng-board-opened' again —
    // without this, re-opening after a close (which never reset the flag)
    // would silently skip stickerListLayer.js's entrance reveal.
    if (target > 0) this._openSignaled = false;
    this._animFrom = this._appliedLift;
    this._animTo = target;
    this._animStart = performance.now();
    this._animDuration = duration;
    if (!this._animActive) {
      this._animActive = true;
      this.ticker.add(this._tick);
    }
  }

  _stopAnim() {
    if (!this._animActive) return;
    this._animActive = false;
    this.ticker.remove(this._tick);
  }

  _onTick() {
    const progress = Math.min((performance.now() - this._animStart) / this._animDuration, 1);
    const desired = this._animFrom + (this._animTo - this._animFrom) * easeOutBack(progress);
    this.sprite.y -= desired - this._appliedLift;
    this._appliedLift = desired;

    // Fired partway through the lift (OPEN_SIGNAL_PROGRESS), not once it
    // fully completes — stickerListLayer.js listens for this to start its
    // icons' entrance reveal, and waiting for 100% made that reveal feel
    // laggy relative to the gesture. _openSignaled guards it to once per
    // lift (progress keeps climbing past the threshold every tick until
    // it hits 1).
    if (this._animTo > 0 && !this._openSignaled && progress >= OPEN_SIGNAL_PROGRESS) {
      this._openSignaled = true;
      this.sprite.emit('ng-board-opened');
    }
    if (progress >= 1) this._stopAnim();
  }

  destroy() {
    this._stopAnim();
    this._pressCleanup?.();
    window.removeEventListener('pointerdown', this._onGlobalPointerDown, true);
    super.destroy();
  }
}

export async function create(opts) {
  const loaded = await PIXI.Assets.load(`UI/${opts.file}`);
  const sprite = loaded instanceof PIXI.Texture ? new PIXI.Sprite(loaded) : loaded;
  return new ListStickersLayer({ ...opts, sprite });
}
