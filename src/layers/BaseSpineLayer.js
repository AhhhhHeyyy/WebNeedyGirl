import { DragTransform } from '../core/DragTransform.js';

// Shared implementation for a Spine skeleton layer (pixi-spine's `Spine`
// display object), analogous to BaseImageLayer for plain sprites/GIFs.
// One skeleton+atlas can back multiple layers that each select a different
// skin at creation time (see spineAngelASpineLayer.js / spineAngelDSpineLayer.js,
// both loading UI/spineAngel/skeleton.json but picking "Angel" vs "dark") —
// the skin never changes after creation, so there's no setSkinByName wiring
// exposed here.
export class BaseSpineLayer {
  constructor({ id, label, spine, stage, x, y, scale = 1, rotation = 0 }) {
    this.id = id;
    this.label = label;
    this.type = 'spine';
    this.stage = stage;
    this.visible = true;
    this.locked = false;
    this._paused = false;

    // Kept as `sprite` (not `spine`) so DragTransform and the Frame1-clip
    // mask helper — both written against BaseImageLayer's sprite-shaped
    // interface — work here unmodified; PIXI.spine.Spine is a Container
    // with the same x/y/scale/rotation/getLocalBounds/mask surface.
    this.sprite = spine;
    this.sprite.x = x ?? 0;
    this.sprite.y = y ?? 0;
    this.sprite.scale.set(scale);
    this.sprite.rotation = rotation;
    stage.root.addChild(this.sprite);

    this.drag = new DragTransform(this.sprite, stage, {
      onChange: () => this.onChange && this.onChange(),
    });

    this.onChange = null; // wired by LayerManager.add()
  }

  static async create({ id, label, src, skin, animation = 'idle', stage, x, y, scale, rotation }) {
    const { spineData } = await PIXI.Assets.load(src);
    const spine = new PIXI.spine.Spine(spineData);
    if (skin) spine.skeleton.setSkinByName(skin);
    spine.skeleton.setSlotsToSetupPose();
    if (spine.state.data.skeletonData.findAnimation(animation)) {
      spine.state.setAnimation(0, animation, true);
    }
    return new BaseSpineLayer({ id, label, spine, stage, x, y, scale, rotation });
  }

  setVisible(visible) {
    this.visible = visible;
    this.sprite.visible = visible;
    if (visible) this.resume(); else this.pause();
  }

  // Spine advances its animation state through Pixi's own ticker
  // (autoUpdate) the same way any other display object would — flipping
  // that off is enough to freeze it in place while hidden, mirroring
  // BaseImageLayer's AnimatedGIF stop()/play().
  pause() {
    this.sprite.autoUpdate = false;
  }

  resume() {
    if (this.visible) this.sprite.autoUpdate = true;
  }

  getTransform() {
    return this.drag.getTransform();
  }

  setTransform(t) {
    this.drag.setTransform(t);
  }

  setZIndex(i) {
    this.sprite.zIndex = i;
  }

  setLocked(locked) {
    this.locked = !!locked;
    this.drag.setLocked(this.locked);
  }

  select() { this.drag.select(); }
  deselect() { this.drag.deselect(); }

  destroy() {
    this.drag.destroy();
    this.sprite.destroy();
  }
}
