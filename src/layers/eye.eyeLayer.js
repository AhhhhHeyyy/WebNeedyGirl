import { BaseImageLayer } from './BaseImageLayer.js';

// eye.eye (UI/eye/eye.png, a full "window" mock-up graphic) renders as a
// stack of several copies of the same texture cascading diagonally, each
// one popping open in sequence, holding fully open for a beat, then closing
// again before the next cycle re-rolls a fresh count and repeats forever —
// i.e. "windows keep spawning on top of each other". Per the reference
// mock-ups this was built from: more windows in a cycle -> tighter spacing
// between them, no rotation, pure diagonal offset.
//
// The whole stack still drags/scales as a single unit (this class extends
// BaseImageLayer exactly like any other image layer) — only the CONTAINER
// holding the individual window sprites is the drag/scale handle; the child
// sprites themselves are decorative and non-interactive.
const MIN_COUNT = 2;
const MAX_COUNT = 5;
// Per-step diagonal offset, as a fraction of the texture's own width, so the
// cascade scales sensibly no matter how the user resizes this layer in the
// panel: offset = (SPACING_RATIO_K / count) * texture.width.
const SPACING_RATIO_K = 0.24;
// Each cycle roams to a random spot around the layer's own dragged/anchored
// position, and the cascade direction (which side the stack builds toward)
// is re-rolled too — both as fractions of the texture's own size, same
// scale-independence rationale as SPACING_RATIO_K above.
const ROAM_RATIO_X = 0.5;
const ROAM_RATIO_Y = 0.5;

const POP_MS = 320;          // per-window scale+fade "open" duration
const STAGGER_MS = 200;      // delay before the next window starts opening
const HOLD_MS = 300;         // fully-open pause before the stack closes
const CLOSE_MS = 200;        // per-window shrink/fade "close" duration, once the eye has finished blinking shut
const CLOSE_STAGGER_MS = 20; // delay between each window closing (front-to-back)
const GAP_MS = 500;          // pause after a cycle fully closes before the next one opens

// eye.png's own "screen" area (the dark-red gradient rect inside the window
// chrome), as a fraction of the full eye.png texture — measured directly off
// the artwork (1900x1080 source: x=32 y=138 w=1836 h=880) so it still lines
// up correctly no matter what scale this layer is dragged/resized to.
const SCREEN_RECT = { x: 32 / 1900, y: 138 / 1080, w: 1836 / 1900, h: 880 / 1080 };
// eye-screen.webm (a transparent-background clip) plays inside that rect.
// Each window in the stack gets its own independent <video>/PIXI.Texture
// (see EyeBlinkClip) rather than all of them reading one shared decoder's
// current frame — so every window's eye opens/closes on its own, instead of
// them all being locked to a single shared timeline. Pooled at MAX_COUNT
// clips per layer (the most a cycle ever needs) and reused cycle to cycle,
// rather than spun up and torn down per popup.
const VIDEO_FILE = 'eye-screen.webm';
// eye-screen.webm is authored at 30fps: a blink — closed, opens, holds open,
// closes, holds closed — over ~45 frames. currentTime marks below are on
// that source timeline (seconds), independent of playbackRate (playbackRate
// only changes how fast currentTime advances, not what a given time means).
// The eye actually plays open and closed (see EyeBlinkClip.playOpen/
// playClose) rather than jump-cutting between frames, so the window's own
// pop-in/collapse tweens have a real blink to sync against instead of an
// instant swap. That does mean resuming sustained playback from a long
// rate=0 hold, on both open and close, and pushing that resume rate well
// past real-time is what visibly replayed part of the clip from an earlier
// point before settling, in earlier testing of this same pattern. OPEN_RATE
// stays under 1x; CLOSE_RATE lands just over it to hit CLOSE_PLAY_MS's ~0.5s
// target. If the glitch resurfaces on the close side, raising CLOSE_PLAY_MS
// (which lowers CLOSE_RATE) is the fix, not reverting to jump-cuts.
const VIDEO_FPS = 30;
const VIDEO_OPEN_TIME = 14 / VIDEO_FPS;  // measured: eye reads as fully open by here
const VIDEO_CLOSE_TIME = 33 / VIDEO_FPS; // measured: eye reads as fully closed by here
const OPEN_PLAY_MS = 500;  // how long the eye takes to open, once the window pops in
const CLOSE_PLAY_MS = 500; // how long the eye takes to close, right before the window collapses
const OPEN_RATE = VIDEO_OPEN_TIME / (OPEN_PLAY_MS / 1000);
const CLOSE_RATE = (VIDEO_CLOSE_TIME - VIDEO_OPEN_TIME) / (CLOSE_PLAY_MS / 1000);
// _waitIdle() cuts down the resume-from-hold decoder glitch (see its
// comment) but doesn't provably eliminate it. As a second line of defense,
// EyeStackLayer covers the live video with a still of the open frame for the
// first MASK_MS of every playClose(), only uncovering it once that risky
// window has passed — so even if a stray replay-frame flash still happens,
// it happens underneath the mask instead of on screen. Keep this comfortably
// under CLOSE_PLAY_MS so real closing motion is still visible once revealed.
const MASK_MS = 360;
// Tolerance for the "am I still holding the target frame" check in
// EyeBlinkClip.tick(): currentTime read back from a <video> rarely equals
// exactly what was last assigned (browsers quantize to their own internal
// frame boundaries), so comparing for exact equality re-triggers a
// `currentTime =` seek on effectively every tick. Only correct real drift
// past half a source frame.
const FREEZE_EPSILON = 1 / (VIDEO_FPS * 2);

function easeOutBack(t) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function easeOutQuad(t) {
  return 1 - (1 - t) * (1 - t);
}

// A cancellable sleep: pause() calls cancel(token) on whatever's currently
// pending so the loop unwinds immediately instead of waiting out its timer.
function sleep(ms, token) {
  return new Promise((resolve) => {
    if (token.cancelled) { resolve(); return; }
    const entry = { resolve };
    entry.id = setTimeout(() => { token.pending.delete(entry); resolve(); }, ms);
    token.pending.add(entry);
  });
}

function cancelToken(token) {
  token.cancelled = true;
  token.pending.forEach(({ id, resolve }) => { clearTimeout(id); resolve(); });
  token.pending.clear();
}

// Wraps one independent eye-screen.webm <video> + PIXI.Texture, playing the
// open and close segments for real (see the VIDEO_FILE comment) and holding
// on whichever frame it last landed on in between. One of these exists per
// stack slot (see EyeStackLayer.create), so each window in the cascade
// blinks on its own decoder instead of every sprite sharing one current
// frame.
class EyeBlinkClip {
  constructor(videoEl, videoTexture) {
    this.videoEl = videoEl;
    this.videoTexture = videoTexture;
    this._targetTime = null; // set while actively playing toward a target frame
    this._holdTime = null;   // set while frozen, holding a given frame
    this._onReachTarget = null; // resolves playClose()'s promise once tick() confirms arrival
    this.openSnapshot = null; // still image of the open frame — see _captureOpenSnapshot()
  }

  // Captures a still image of whatever the element is currently showing, as
  // its own PIXI.Texture wrapping an offscreen canvas — captured once, the
  // first time playOpen() actually lands on VIDEO_OPEN_TIME, and reused for
  // every cycle after. EyeStackLayer briefly shows this in place of the live
  // video at the start of every playClose(), to mask the decoder-catch-up
  // glitch _waitIdle() reduces but can't fully rule out — see the comment on
  // MASK_MS. Same-origin video source, so drawImage() here doesn't taint the
  // canvas.
  _captureOpenSnapshot() {
    if (this.openSnapshot || !this.videoEl) return;
    const w = this.videoEl.videoWidth, h = this.videoEl.videoHeight;
    if (!w || !h) return;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(this.videoEl, 0, 0, w, h);
    this.openSnapshot = PIXI.Texture.from(canvas);
  }

  // Loads eye-screen.webm into a muted <video> and starts it playing at rate
  // 0 (frozen on frame 0), wrapped as a PIXI texture. The element is never
  // actually paused again after this — see the comment on tick() for why —
  // only currentTime and playbackRate are ever touched, via
  // playOpen()/playClose()/reset() below. Resolves to a clip with
  // videoEl/videoTexture both null on failure, so a missing file degrades to
  // the plain window look instead of failing the layer.
  static load(videoSrc) {
    return new Promise((resolve) => {
      const videoEl = document.createElement('video');
      videoEl.src = videoSrc;
      videoEl.loop = false;
      videoEl.muted = true;
      videoEl.playsInline = true;
      const fail = () => resolve(new EyeBlinkClip(null, null));
      videoEl.addEventListener('canplaythrough', () => {
        videoEl.playbackRate = 0;
        videoEl.play().catch(() => {});
        resolve(new EyeBlinkClip(videoEl, PIXI.Texture.from(videoEl)));
      }, { once: true });
      videoEl.addEventListener('error', fail, { once: true });
      videoEl.load();
    });
  }

  // Called once per tick by the layer's shared ticker (see EyeStackLayer).
  // While holding, actively re-pins the held frame every tick rather than
  // trusting playbackRate=0 to hold indefinitely on its own — over a long
  // hold some Chromium builds let currentTime creep forward anyway (or reset
  // the rate). Only corrects past FREEZE_EPSILON (see its comment), and only
  // if nothing's already seeking — see _waitIdle() for why stacking a second
  // seek on top of one still resolving is exactly what to avoid. While
  // actively playing toward _targetTime, just watches for arrival and
  // freezes there — no reason to touch currentTime/rate mid-flight.
  tick() {
    if (!this.videoEl) return;
    if (this._holdTime !== null) {
      if (!this.videoEl.seeking && Math.abs(this.videoEl.currentTime - this._holdTime) > FREEZE_EPSILON) {
        this.videoEl.currentTime = this._holdTime;
      }
      if (this.videoEl.playbackRate !== 0) this.videoEl.playbackRate = 0;
    } else if (this._targetTime !== null && this.videoEl.currentTime >= this._targetTime) {
      this.videoEl.currentTime = this._targetTime;
      this.videoEl.playbackRate = 0;
      if (this._targetTime === VIDEO_OPEN_TIME) this._captureOpenSnapshot();
      this._holdTime = this._targetTime;
      this._targetTime = null;
      if (this._onReachTarget) { const cb = this._onReachTarget; this._onReachTarget = null; cb(); }
    }
  }

  // Resolves once the element isn't in the middle of a seek. tick()'s hold
  // correction above can leave one in flight, and changing playbackRate
  // while a seek is still resolving is what caused a visible "replays an
  // earlier stretch of the clip before catching up" glitch (observed in
  // testing): asking the element to seek and to play forward at the same
  // time makes some Chromium builds resolve the seek by decoding forward
  // from the nearest keyframe rather than landing cleanly on the target, and
  // that decode-forward is what gets painted. A 250ms fallback guards
  // against 'seeked' never firing.
  _waitIdle() {
    if (!this.videoEl.seeking) return Promise.resolve();
    return new Promise((resolve) => {
      const finish = () => {
        this.videoEl.removeEventListener('seeked', finish);
        clearTimeout(timeoutId);
        resolve();
      };
      const timeoutId = setTimeout(finish, 250);
      this.videoEl.addEventListener('seeked', finish);
    });
  }

  // Rewinds to frame 0 and plays forward at OPEN_RATE; tick() drops the rate
  // back to 0 the instant it reaches VIDEO_OPEN_TIME, where it holds until
  // playClose() is called — i.e. "play to the eye-open frame and freeze
  // there", timed to the window's own pop-in.
  async playOpen() {
    if (!this.videoEl) return;
    await this._waitIdle();
    this.videoEl.currentTime = 0;
    this._holdTime = null;
    this._targetTime = VIDEO_OPEN_TIME;
    this.videoEl.playbackRate = OPEN_RATE;
  }

  // Resumes from the held-open frame and plays to VIDEO_CLOSE_TIME at
  // CLOSE_RATE, resolving once tick() actually confirms it landed there —
  // not just that playClose() was called — so _runCycle can await this
  // before starting the window's own collapse tween, and the window never
  // shrinks out from under a still-blinking eye.
  async playClose() {
    if (!this.videoEl) return;
    await this._waitIdle();
    return new Promise((resolve) => {
      this._holdTime = null;
      this._targetTime = VIDEO_CLOSE_TIME;
      this._onReachTarget = resolve;
      this.videoEl.playbackRate = CLOSE_RATE;
    });
  }

  // Jumps straight back to frame 0, held — used only for EyeStackLayer.pause()
  // (the whole layer going invisible), where there's no blink to be seen.
  // Also resolves any playClose() still awaiting arrival — pause() can land
  // mid-blink, and clearing _targetTime here without waking that await would
  // leave _runCycle's close loop hanging on it forever.
  reset() {
    if (!this.videoEl) return;
    this.videoEl.currentTime = 0;
    this.videoEl.playbackRate = 0;
    this._targetTime = null;
    this._holdTime = 0;
    if (this._onReachTarget) { const cb = this._onReachTarget; this._onReachTarget = null; cb(); }
  }

  destroy() {
    if (this.videoEl) { this.videoEl.pause(); this.videoEl.src = ''; }
  }
}

class EyeStackLayer extends BaseImageLayer {
  constructor(opts) {
    super(opts);
    this.texture = opts.texture;
    this.videoClips = opts.videoClips; // one independent EyeBlinkClip per stack slot
    this.ticker = opts.stage.app.ticker;
    this._tweens = new Set();
    this._tickHandler = () => {
      this._tweens.forEach((fn) => fn());
      this.videoClips.forEach((clip) => clip.tick());
    };
    this.ticker.add(this._tickHandler);
    this._token = null;

    // "Home" position — wherever the user last dragged this layer to in the
    // panel. Each cycle roams away from this to a random nearby spot and
    // returns here between cycles, so dragging/saving layout still behaves
    // like any other image layer instead of fighting the roam animation.
    this._anchorX = this.sprite.x;
    this._anchorY = this.sprite.y;
    const notify = this.drag.onChange;
    this.drag.onChange = (...args) => {
      this._anchorX = this.sprite.x;
      this._anchorY = this.sprite.y;
      notify(...args);
    };

    this.resume();
  }

  getTransform() {
    return { ...this.drag.getTransform(), x: this._anchorX, y: this._anchorY };
  }

  setTransform(t) {
    if (t.x !== undefined) { this._anchorX = t.x; this.sprite.x = t.x; }
    if (t.y !== undefined) { this._anchorY = t.y; this.sprite.y = t.y; }
    const { x, y, ...rest } = t;
    if (Object.keys(rest).length) this.drag.setTransform(rest);
    else this.drag._layoutHandles();
  }

  static async create(opts) {
    const texture = await PIXI.Assets.load(opts.src);
    const container = new PIXI.Container();
    const videoSrc = opts.src.replace(/[^/]+$/, VIDEO_FILE);
    const videoClips = await Promise.all(
      Array.from({ length: MAX_COUNT }, () => EyeBlinkClip.load(videoSrc))
    );
    return new EyeStackLayer({ ...opts, sprite: container, texture, videoClips });
  }

  // Returns { container, screen } — screen (the live video sprite, absent if
  // this clip's video failed to load) is handed back separately so the close
  // loop in _runCycle can lay a same-sized mask sprite over it; see MASK_MS.
  _makeWindowSprite(clip) {
    const container = new PIXI.Container();
    container.eventMode = 'none'; // only the outer stack container is draggable/selectable

    const frame = new PIXI.Sprite(this.texture);
    frame.anchor.set(0.5);
    container.addChild(frame);

    let screen = null;
    if (clip.videoTexture) {
      const tw = this.texture.width, th = this.texture.height;
      const rectW = SCREEN_RECT.w * tw, rectH = SCREEN_RECT.h * th;
      const vw = clip.videoEl.videoWidth || rectW;
      const vh = clip.videoEl.videoHeight || rectH;
      const fit = Math.min(rectW / vw, rectH / vh); // contain-fit, never crops the clip

      screen = new PIXI.Sprite(clip.videoTexture);
      screen.anchor.set(0.5);
      screen.width = vw * fit;
      screen.height = vh * fit;
      // Rect origin is top-left of the texture; sprites are anchored at
      // their own center, which is also the texture's center — so an
      // offset from texture-center is rect-center minus texture-center.
      screen.x = (SCREEN_RECT.x * tw + rectW / 2) - tw / 2;
      screen.y = (SCREEN_RECT.y * th + rectH / 2) - th / 2;
      container.addChild(screen);
    }

    return { container, screen };
  }

  // Animates one sprite's scale/alpha over `duration` ms, driven by the
  // shared Pixi ticker (same pattern as the rest of this project's per-frame
  // work, e.g. nestedScene3PopupSpawner's tick()) rather than a second timer
  // system. Resolves once the tween reaches t=1 (or is cut short by cancel()).
  _tween(spr, duration, { fromScale, toScale, fromAlpha, toAlpha }, token) {
    return new Promise((resolve) => {
      let elapsed = 0;
      const step = () => {
        if (token.cancelled) { this._tweens.delete(step); resolve(); return; }
        elapsed += this.ticker.deltaMS;
        const t = Math.min(1, elapsed / duration);
        spr.scale.set(fromScale + (toScale - fromScale) * easeOutBack(t));
        spr.alpha = fromAlpha + (toAlpha - fromAlpha) * easeOutQuad(t);
        if (t >= 1) { this._tweens.delete(step); resolve(); }
      };
      this._tweens.add(step);
    });
  }

  async _runCycle(token) {
    const count = MIN_COUNT + Math.floor(Math.random() * (MAX_COUNT - MIN_COUNT + 1));
    const spacing = (SPACING_RATIO_K / count) * this.texture.width;
    // dirX flips whether the stack builds left-to-right (+1) or right-to-left
    // (-1); a fresh random spot each cycle, roamed from (not replacing) the
    // user's own dragged/anchored home position.
    const dirX = Math.random() < 0.5 ? 1 : -1;
    const roamX = (Math.random() * 2 - 1) * ROAM_RATIO_X * this.texture.width;
    const roamY = (Math.random() * 2 - 1) * ROAM_RATIO_Y * this.texture.height;
    this.sprite.x = this._anchorX + roamX;
    this.sprite.y = this._anchorY + roamY;

    const sprites = [];
    const screens = [];
    for (let i = 0; i < count && !token.cancelled; i++) {
      const offset = (i - (count - 1) / 2) * spacing;
      const clip = this.videoClips[i];
      clip.playOpen(); // plays open over OPEN_PLAY_MS as this window pops in
      const { container: spr, screen } = this._makeWindowSprite(clip);
      spr.x = offset * dirX;
      spr.y = offset;
      spr.alpha = 0;
      spr.scale.set(0.001);
      this.sprite.addChild(spr);
      sprites.push(spr);
      screens.push(screen);
      this._tween(spr, POP_MS, { fromScale: 0.001, toScale: 1, fromAlpha: 0, toAlpha: 1 }, token);
      await sleep(STAGGER_MS, token);
    }

    if (!token.cancelled) await sleep(HOLD_MS, token);

    // Close front-to-back (most-recently-opened first), mirroring open
    // order, fully sequential — one window's entire close (eye blinks shut
    // over CLOSE_PLAY_MS, then it shrinks/fades away) finishes before the
    // next one's even starts. playClose() is awaited before the collapse
    // tween starts, so the eye is always fully closed — never mid-blink —
    // by the moment its window begins shrinking.
    for (let i = sprites.length - 1; i >= 0 && !token.cancelled; i--) {
      const clip = this.videoClips[i];
      const screen = screens[i];
      // Show a still of the open frame in place of the live video for the
      // first MASK_MS of the close — see MASK_MS's comment — then swap back.
      // Both the still and the live video are mostly-transparent (see the
      // VIDEO_FILE comment), so layering the still on top with the live
      // video still visible underneath doesn't actually hide anything: each
      // frame only opaquely covers its own eye-shaped sliver, not the other's.
      // Hiding `screen` outright while the still is up is what actually
      // blocks it.
      let mask = null;
      if (screen && clip.openSnapshot) {
        mask = new PIXI.Sprite(clip.openSnapshot);
        mask.anchor.set(0.5);
        mask.width = screen.width;
        mask.height = screen.height;
        mask.x = screen.x;
        mask.y = screen.y;
        sprites[i].addChild(mask);
        screen.visible = false;
      }
      const closing = clip.playClose();
      if (mask) {
        await sleep(MASK_MS, token);
        mask.visible = false;
        screen.visible = true;
      }
      await closing;
      if (token.cancelled) break;
      await this._tween(sprites[i], CLOSE_MS, { fromScale: 1, toScale: 0.001, fromAlpha: 1, toAlpha: 0 }, token);
      await sleep(CLOSE_STAGGER_MS, token);
    }

    sprites.forEach((spr) => {
      this.sprite.removeChild(spr);
      // { children: true } so the frame/screen child sprites inside this
      // per-cycle container get cleaned up too, but never `texture: true` —
      // each clip's videoTexture is pooled and reused across cycles.
      spr.destroy({ children: true });
    });
    this.sprite.x = this._anchorX; // back to the dragged/saved home position
    this.sprite.y = this._anchorY; // between cycles (nothing visible to roam anyway)

    if (!token.cancelled) await sleep(GAP_MS, token);
  }

  async _run(token) {
    while (!token.cancelled) {
      await this._runCycle(token);
    }
  }

  resume() {
    if (!this.visible || this._token) return; // hidden, or already looping
    this._token = { cancelled: false, pending: new Set() };
    this._run(this._token).catch((err) => console.error('eye stack animation failed:', err));
  }

  pause() {
    if (this._token) {
      cancelToken(this._token);
      this._token = null;
    }
    this._tweens.clear();
    this.sprite.removeChildren().forEach((spr) => spr.destroy({ children: true }));
    this.sprite.x = this._anchorX;
    this.sprite.y = this._anchorY;
    this.videoClips.forEach((clip) => clip.reset());
  }

  destroy() {
    this.pause();
    this.ticker.remove(this._tickHandler);
    this.videoClips.forEach((clip) => clip.destroy());
    super.destroy();
  }
}

export async function create(opts) {
  return EyeStackLayer.create(opts);
}
