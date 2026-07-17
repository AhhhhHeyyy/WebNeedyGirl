import { BaseLottieLayer } from './BaseLottieLayer.js';

// Spawns an independent, throwaway "window pop-up" (Nested Scene 3, showing
// its own directly-rendered slice of Angel D through its window content
// area) at an arbitrary logical-space point — used by the stage-area click
// handler in main.js so a window opens wherever the user actually clicks,
// and clicking again before one finishes just spawns another instead of
// waiting or queuing. These aren't LayerManager-tracked layers (no panel
// entry, no drag handles, no persistence): each one plays through once and
// destroys itself on completion, and any number can be alive at once.
//
// Each pop-up gets its OWN Spine instance and its OWN small dedicated
// PIXI.Renderer/<canvas> (see spawnNestedScene3Popup below) rather than
// sharing one instance captured via a GPU readback — see that function's
// own comment for why: a synchronous readback (renderer.extract.pixels(),
// what an earlier version of this file used) stalls the whole GPU pipeline,
// and doing that every frame for every open pop-up was the single biggest
// cost this feature added. Rendering straight to each pop-up's own on-screen
// canvas costs about the same as any other visible Spine character and
// skips the stall entirely.
//
// Content-area geometry read off the authored shape geometry in UI/Dark/
// Nested Scene 3.json (Nested Scene 9's "Rectangle 10"/"Rectangle 11", the
// plain-fill backdrop behind the title bar / border chrome): centered at
// (256, 254), 440x184, inside the Lottie's own 512x512 canvas. This composes
// with each spawned window's own x/y/scale/rotation using the same
// center-based mapping BaseLottieLayer's own _applyCss() uses to place the
// Lottie div — stage.scaleFactor cancels out of both sides of that mapping,
// which is why plain Lottie-canvas pixels line up 1:1 with Pixi logical
// units here.
//
// Exported as a mutable object (not plain consts) so PopupTuningPanel.js can
// live-tune these with sliders while the app is running — every field here
// is re-read fresh on each spawnNestedScene3Popup() call, never cached, so a
// slider drag takes effect on the very next click. bgColor is a CSS-style
// "#rrggbb" string (matches <input type="color">'s own value format) rather
// than a Pixi hex number, converted only where it's actually drawn.
export const popupTuning = { cx: 256, cy: 254, w: 440, h: 184, bgColor: '#3a0a0a' };
const CANVAS_CENTER = 256; // BaseLottieLayer scales/rotates the div about its own center

// Nested Scene 9's own scale keyframes (see UI/Dark/Nested Scene 3.json —
// Nested Scene 9's "s" property: t=5 s=[0,100] o={.55,.06} i={.36,1}, t=16
// s=[100,100], t=66 s=[100,100] o={.65,0} i={1,1}, t=82 s=[0,100]), over a
// 90-frame/30fps (3s) comp — note only the FIRST component (X) animates
// 0→100; the second (Y) sits at 100 the whole time. So this isn't a uniform
// scale-from-center, it's a horizontal wipe: the window opens left/right
// while already at full height. The "o"/"i" pairs are standard After
// Effects/Lottie Bezier-easing tangents (equivalent to CSS's
// cubic-bezier(o.x, o.y, i.x, i.y)), NOT a linear ramp — using a plain
// linear interpolation here visibly drifts out of sync with the real
// (eased) window animation, so bezierEase() below reproduces the exact same
// curve lottie-web itself uses. The peephole's own reveal follows this
// ramp applied to width only — height stays fixed — so it opens the same
// way the window itself does instead of scaling in from the center.
const OPEN_RAMP = { t: [5, 16], o: { x: 0.55, y: 0.06 }, i: { x: 0.36, y: 1 } };
const CLOSE_RAMP = { t: [66, 82], o: { x: 0.65, y: 0 }, i: { x: 1, y: 1 } };

// Standard cubic-bezier easing solve (same technique as CSS's
// cubic-bezier() timing function / WebKit's UnitBezier): given control
// points (x1,y1)/(x2,y2) between the implicit endpoints (0,0) and (1,1),
// find the curve parameter u whose X coordinate equals `t`, then return
// its Y coordinate — i.e. map a linear time fraction to the eased value
// fraction.
function bezierEase(x1, y1, x2, y2, t) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sampleX = u => ((ax * u + bx) * u + cx) * u;
  const sampleY = u => ((ay * u + by) * u + cy) * u;
  const sampleDX = u => (3 * ax * u + 2 * bx) * u + cx;

  let u = t;
  for (let i = 0; i < 8; i++) {
    const dx = sampleDX(u);
    if (Math.abs(dx) < 1e-6) break;
    u -= (sampleX(u) - t) / dx;
  }
  if (Math.abs(sampleX(u) - t) > 1e-4) { // Newton didn't converge — bisection fallback
    let lo = 0, hi = 1;
    u = t;
    for (let i = 0; i < 20; i++) {
      u = (lo + hi) / 2;
      if (sampleX(u) > t) hi = u; else lo = u;
    }
  }
  return sampleY(u);
}

function popupOpenProgress(frame) {
  const [openStart, openEnd] = OPEN_RAMP.t;
  const [closeStart, closeEnd] = CLOSE_RAMP.t;
  if (frame < openStart) return 0;
  if (frame < openEnd) {
    const tNorm = (frame - openStart) / (openEnd - openStart);
    return bezierEase(OPEN_RAMP.o.x, OPEN_RAMP.o.y, OPEN_RAMP.i.x, OPEN_RAMP.i.y, tNorm);
  }
  if (frame < closeStart) return 1;
  if (frame < closeEnd) {
    const tNorm = (frame - closeStart) / (closeEnd - closeStart);
    return 1 - bezierEase(CLOSE_RAMP.o.x, CLOSE_RAMP.o.y, CLOSE_RAMP.i.x, CLOSE_RAMP.i.y, tNorm);
  }
  return 0;
}

// A pool of small dedicated PIXI.Renderer instances, reused across pop-ups
// instead of constructing (and destroying) a fresh one per click. Spinning
// up a new WebGL context is a synchronous, comparatively heavy operation —
// driver-level context setup plus shader program compilation for that
// context — and doing it on the critical "click -> window opens" path was
// visible as the whole page hitching for a moment right before every
// pop-up appeared. Borrowing an idle renderer (just resizing it, cheap) and
// returning it when the pop-up closes moves that one-time cost to the
// first-ever pop-up of the session instead of paying it on every single one.
const rendererPool = [];

function acquireRenderer(pxW, pxH) {
  const renderer = rendererPool.pop() ?? new PIXI.Renderer({ antialias: true, backgroundAlpha: 1 });
  renderer.resize(pxW, pxH);
  return renderer;
}

function releaseRenderer(renderer) {
  rendererPool.push(renderer);
}

// Converts a browser pointer event's clientX/clientY into Pixi logical-space
// coordinates — the inverse of Stage.resize()'s root.position/scale mapping
// (same math DragTransform._move() uses for drag deltas).
export function clientToLogical(clientX, clientY, stage) {
  const rect = stage.app.view.getBoundingClientRect();
  const gx = clientX - rect.left;
  const gy = clientY - rect.top;
  return {
    x: (gx - stage.width / 2) / stage.scaleFactor,
    y: (gy - stage.height / 2) / stage.scaleFactor,
  };
}

export async function spawnNestedScene3Popup(x, y, { stage, manager, lottieContainer }) {
  // The panel-editable "dark.nestedScene3" layer never plays itself anymore
  // (see main.js's boot()) — it just supplies the default scale/rotation so
  // resizing it once in the panel resizes every future pop-up.
  const template = manager.get('dark.nestedScene3');
  const templateTransform = template ? template.getTransform() : { scaleX: 1, scaleY: 1, rotation: 0 };

  const win = await BaseLottieLayer.create({
    id: `nestedScene3-popup-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    label: 'Nested Scene 3 (popup)',
    src: 'UI/Dark/Nested Scene 3.json',
    container: lottieContainer, stage, x, y,
    scale: templateTransform.scaleX, rotation: templateTransform.rotation,
    width: 512, height: 512, loop: false,
  });

  // Pop-ups aren't draggable, so the window's transform never changes after
  // spawning — this only needs to run once, unlike the live-tracking sync()
  // the panel-layer version needed.
  const t = win.getTransform();
  const offX = (popupTuning.cx - CANVAS_CENTER) * t.scaleX;
  const offY = (popupTuning.cy - CANVAS_CENTER) * t.scaleY;
  const cos = Math.cos(t.rotation), sin = Math.sin(t.rotation);
  const contentCx = t.x + offX * cos - offY * sin;
  const contentCy = t.y + offX * sin + offY * cos;
  const w = popupTuning.w * t.scaleX;
  const h = popupTuning.h * t.scaleY;

  // Rendered at the pop-up's actual on-screen resolution (world size ×
  // current DPI/zoom factor), not the raw 440x184 Lottie-local numbers, so
  // the peek image stays crisp instead of getting stretched blurry by CSS.
  const pxW = Math.max(1, Math.round(w * stage.scaleFactor));
  const pxH = Math.max(1, Math.round(h * stage.scaleFactor));

  // A fresh Spine instance for THIS pop-up (loading UI/spineAngel/skeleton.json
  // is cheap here — PIXI.Assets caches the parsed SpineData after whichever
  // layer loaded it first, usually spineAngelASpineLayer/spineAngelDSpineLayer
  // at boot, so this just constructs a new skeleton from already-parsed data).
  const { spineData } = await PIXI.Assets.load('UI/spineAngel/skeleton.json');
  const spine = new PIXI.spine.Spine(spineData);
  spine.skeleton.setSkinByName('dark');
  spine.skeleton.setSlotsToSetupPose();
  if (spine.state.data.skeletonData.findAnimation('idle')) {
    spine.state.setAnimation(0, 'idle', true);
  }

  // The panel's own "spineAngelDSpine" transform is the single source of
  // truth for where/how big Angel D is — copied here once (pop-ups aren't
  // draggable, so no live-tracking needed, same as `t` above).
  const angelDT = manager.get('spineAngelDSpine')?.getTransform() ?? { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
  spine.x = angelDT.x;
  spine.y = angelDT.y;
  spine.scale.set(angelDT.scaleX, angelDT.scaleY);
  spine.rotation = angelDT.rotation;

  // Mirror whichever panel Angel layer is already running, every tick, for
  // the rest of this pop-up's life — NOT a one-time trackTime copy at spawn.
  // An earlier version only copied refTrack.trackTime once here, then left
  // this instance's own autoUpdate (pixi-spine's default: each Spine keeps
  // its own `lastTime`/Date.now() clock and advances trackTime by its own
  // measured real-time delta each render call — see pixi-spine's
  // autoUpdateTransform) to run independently afterwards. Both clocks
  // measure the same wall-clock time, so in principle they track — but that
  // makes two *independent* timers that merely started in phase, not one
  // shared timeline, and relies on both instances' render calls landing at
  // exactly the same point in the frame; that's what surfaced as "plays at
  // a different speed every time you click," since which clock got read
  // first each frame wasn't guaranteed and any slip compounds for as long
  // as the pop-up stays open. Disabling this instance's own autoUpdate and
  // instead copying the reference's trackTime fresh every tick (in tick()
  // below, right before rendering) makes this a pure mirror with no clock
  // of its own — nothing to drift, ever, no matter how long it plays.
  const refAnim = manager.get('spineAngelASpine') || manager.get('spineAngelDSpine');
  const refTrack = refAnim && refAnim.sprite.state.tracks[0];
  if (refTrack && spine.state.tracks[0]) {
    spine.autoUpdate = false;
  }

  // World-space content rect -> this pop-up's own small canvas' pixel space:
  // shift the rect's center to the origin, un-rotate so it's axis-aligned,
  // scale world units to capture pixels, then re-center into (0,0)-(pxW,pxH).
  const scale = pxW / w;
  const cosT = Math.cos(t.rotation), sinT = Math.sin(t.rotation);
  const a = cosT * scale, b = -sinT * scale, c = sinT * scale, d = cosT * scale;
  const mtx = new PIXI.Matrix(
    a, b, c, d,
    -contentCx * a - contentCy * c + pxW / 2,
    -contentCx * b - contentCy * d + pxH / 2,
  );
  const viewContainer = new PIXI.Container();
  viewContainer.transform.setFromMatrix(mtx);
  viewContainer.addChild(spine);

  // This pop-up's own dedicated small renderer/<canvas> (borrowed from the
  // pool, see acquireRenderer()) — see the top-of-file comment for why this
  // replaces an earlier shared-instance-plus-readback design. Its background
  // IS the dark backdrop (no separate fill pass needed): the renderer's own
  // clear color, updated live below each tick so the color picker in
  // PopupTuningPanel.js still applies immediately.
  const miniRenderer = acquireRenderer(pxW, pxH);

  // A plain <canvas> child of the pop-up's own Lottie div — inherits that
  // div's CSS transform (position/scale/rotation) for free, positioned here
  // in the SAME local (512x512) coordinate space popupTuning.cx/cy/w/h are
  // already defined in. The open/close wipe is a pure CSS clip-path driven
  // by progress below; the rendered content itself is always the fully-open
  // crop, so narrowing the reveal never stretches/distorts it.
  const cropCanvas = miniRenderer.view;
  Object.assign(cropCanvas.style, {
    position: 'absolute',
    left: `${popupTuning.cx - popupTuning.w / 2}px`,
    top: `${popupTuning.cy - popupTuning.h / 2}px`,
    width: `${popupTuning.w}px`,
    height: `${popupTuning.h}px`,
  });
  win.el.appendChild(cropCanvas);

  const tick = () => {
    miniRenderer.background.color = parseInt(popupTuning.bgColor.slice(1), 16);
    if (refTrack && spine.state.tracks[0]) {
      // spine.update(dt) does much more than pose the skeleton: it also
      // walks every slot to flip each attachment mesh/sprite's `.visible`
      // and fix up draw order (see pixi-spine's Spine.update()) — logic
      // `state.apply()` + `skeleton.updateWorldTransform()` alone don't
      // include. Skipping it (an earlier version of this code called only
      // those two) left every slot's display object stuck invisible, since
      // nothing had ever run that visibility pass. Calling the real
      // update() with dt=0 runs that full pipeline while leaving trackTime
      // exactly as just set above (0 delta advances nothing further).
      spine.state.tracks[0].trackTime = refTrack.trackTime;
      spine.update(0);
    }
    miniRenderer.render(viewContainer);
  };
  // Registered at UTILS (pixi-spine's lowest built-in priority) so this runs
  // AFTER the main scene's own render — Stage's PIXI.Application auto-adds
  // its render call at LOW priority, which is what actually advances
  // refAnim's trackTime for this frame (see the comment above). Reading
  // refTrack.trackTime before that would mirror last frame's value instead
  // of this one — still synced, just one frame later than it needs to be.
  stage.app.ticker.add(tick, null, PIXI.UPDATE_PRIORITY.UTILS);

  const offFrame = win.onEnterFrame(() => {
    const progress = popupOpenProgress(win.getCurrentFrame());
    if (progress > 0) {
      cropCanvas.style.display = 'block';
      cropCanvas.style.clipPath = `inset(0 ${(1 - progress) * 50}% 0 ${(1 - progress) * 50}%)`;
    } else {
      cropCanvas.style.display = 'none';
    }
  });

  const offComplete = win.onComplete(() => {
    offFrame();
    offComplete();
    stage.app.ticker.remove(tick);
    win.destroy(); // also removes cropCanvas, since it's a child of win.el
    releaseRenderer(miniRenderer); // back to the pool, not destroyed — see acquireRenderer()
    viewContainer.destroy({ children: true }); // also destroys `spine`
  });

  win.play();
}
