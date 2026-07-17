import { DragTransform } from '../core/DragTransform.js';

// Shared implementation for every plain-image layer declared in
// UI/manifest.json (static PNG/JPG/WEBP or animated GIF). Per-asset custom
// behaviour (masks, interaction) belongs in a src/layers/<id>Layer.js that
// calls BaseImageLayer.create() and extends the result, not in here.
export class BaseImageLayer {
  constructor({ id, label, sprite, stage, x, y, scale = 1, rotation = 0 }) {
    this.id = id;
    this.label = label;
    this.type = 'image';
    this.stage = stage;
    this.visible = true;
    this.locked = false;

    this.sprite = sprite;
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

  static async create(opts) {
    const loaded = await PIXI.Assets.load(opts.src);
    // A .gif loads as an AnimatedGIF (via the @pixi/gif extension), which is
    // already a Sprite-like display object with its own frame ticker — use
    // it directly instead of wrapping it in a second PIXI.Sprite. A plain
    // image loads as a Texture, which does need wrapping.
    const sprite = loaded instanceof PIXI.Texture ? new PIXI.Sprite(loaded) : loaded;
    return new BaseImageLayer({ ...opts, sprite });
  }

  setVisible(visible) {
    this.visible = visible;
    this.sprite.visible = visible;
    // An AnimatedGIF keeps decoding/advancing frames on its own ticker even
    // while invisible unless told to stop — plain static sprites have no
    // stop/play, so this is a no-op for them.
    if (visible) this.resume(); else this.pause();
  }

  pause() {
    if (typeof this.sprite.stop === 'function') this.sprite.stop();
  }

  resume() {
    if (this.visible && typeof this.sprite.play === 'function') this.sprite.play();
  }

  // An AnimatedGIF autoplays the instant its own PIXI.Assets.load() resolves,
  // independent of every other asset — two GIFs that finish decoding at
  // slightly different times end up permanently out of phase even with
  // identical frame data. Call this once every layer has loaded to snap them
  // all back to frame 0 together.
  resetAnimation() {
    if (typeof this.sprite.currentFrame === 'number') this.sprite.currentFrame = 0;
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

  // Reserved hook: once a per-asset mask/dynamic-UI pass exists, the
  // subclass in e.g. eyeLayer.js calls this with a loaded mask Sprite.
  setMask(maskSprite) {
    this.sprite.mask = maskSprite;
    if (maskSprite && !maskSprite.parent) this.stage.root.addChild(maskSprite);
  }

  destroy() {
    this.drag.destroy();
    this.sprite.destroy();
  }
}
