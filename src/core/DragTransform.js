// Shared drag-to-move + drag-corner-to-scale interaction for Pixi sprites.
// One implementation, reused by every layer, so BaseImageLayer/BaseLottieLayer
// don't each reimplement pointer math.

const HANDLE_SIZE = 14;

export class DragTransform {
  constructor(sprite, stage, { onChange } = {}) {
    this.sprite = sprite;
    this.stage = stage;
    this.onChange = onChange || (() => {});
    this.selected = false;
    this.locked = false;

    sprite.eventMode = 'static';
    sprite.cursor = 'grab';
    sprite.anchor?.set?.(0.5);

    this._dragState = null;
    sprite.on('pointerdown', (e) => this._startDrag(e));

    this.handles = new PIXI.Container();
    this.handles.visible = false;
    this.handles.zIndex = 9999; // selection overlay must always draw above every layer sprite
    this._buildHandles();
    sprite.parent?.addChild?.(this.handles);
  }

  attachToParent(parent) {
    parent.addChild(this.handles);
  }

  _buildHandles() {
    this.border = new PIXI.Graphics();
    this.handles.addChild(this.border);

    this.corner = new PIXI.Graphics()
      .beginFill(0xffffff)
      .lineStyle(2, 0x8060a8)
      .drawRect(-HANDLE_SIZE / 2, -HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE)
      .endFill();
    this.corner.eventMode = 'static';
    this.corner.cursor = 'nwse-resize';
    this.corner.on('pointerdown', (e) => this._startScale(e));
    this.handles.addChild(this.corner);
  }

  select() {
    this.selected = true;
    this.handles.visible = true;
    this.corner.visible = !this.locked;
    this._layoutHandles();
  }

  deselect() {
    this.selected = false;
    this.handles.visible = false;
  }

  // Locked layers keep their current position/scale even if the user's
  // pointer lands on them — used so an in-progress arrangement can't be
  // nudged out of place by an accidental drag on a nearby sprite.
  setLocked(locked) {
    this.locked = !!locked;
    this.sprite.cursor = this.locked ? 'default' : 'grab';
    this.corner.eventMode = this.locked ? 'none' : 'static';
    if (this.selected) this.corner.visible = !this.locked;
  }

  _layoutHandles() {
    const b = this.sprite.getLocalBounds();
    const w = b.width * this.sprite.scale.x;
    const h = b.height * this.sprite.scale.y;
    this.border.clear().lineStyle(1.5, 0x8060a8, 0.9)
      .drawRect(this.sprite.x - w / 2, this.sprite.y - h / 2, w, h);
    this.corner.position.set(this.sprite.x + w / 2, this.sprite.y + h / 2);
  }

  _startDrag(e) {
    if (this.locked) return;
    const scale = this.stage.scaleFactor;
    this._dragState = {
      mode: 'move',
      startGlobal: e.global.clone(),
      startX: this.sprite.x,
      startY: this.sprite.y,
      scale,
    };
    window.addEventListener('pointermove', this._onMove = (ev) => this._move(ev));
    window.addEventListener('pointerup', this._onUp = () => this._end(), { once: true });
  }

  _startScale(e) {
    if (this.locked) return;
    e.stopPropagation();
    const scale = this.stage.scaleFactor;
    const dx = this.corner.x - this.sprite.x;
    const dy = this.corner.y - this.sprite.y;
    this._dragState = {
      mode: 'scale',
      startGlobal: e.global.clone(),
      startDist: Math.hypot(dx, dy),
      startScaleX: this.sprite.scale.x,
      startScaleY: this.sprite.scale.y,
      scale,
    };
    window.addEventListener('pointermove', this._onMove = (ev) => this._move(ev));
    window.addEventListener('pointerup', this._onUp = () => this._end(), { once: true });
  }

  _move(ev) {
    if (!this._dragState) return;
    const rect = this.stage.app.view.getBoundingClientRect();
    const gx = ev.clientX - rect.left;
    const gy = ev.clientY - rect.top;

    if (this._dragState.mode === 'move') {
      const dx = (gx - this._dragState.startGlobal.x) / this._dragState.scale;
      const dy = (gy - this._dragState.startGlobal.y) / this._dragState.scale;
      this.sprite.x = this._dragState.startX + dx;
      this.sprite.y = this._dragState.startY + dy;
    } else {
      const dx = (gx - this._dragState.startGlobal.x) / this._dragState.scale;
      const dy = (gy - this._dragState.startGlobal.y) / this._dragState.scale;
      const newDist = this._dragState.startDist + (dx + dy) / 2;
      const ratio = Math.max(0.02, newDist / this._dragState.startDist);
      this.sprite.scale.set(this._dragState.startScaleX * ratio, this._dragState.startScaleY * ratio);
    }
    this._layoutHandles();
    this.onChange(this.getTransform());
  }

  _end() {
    window.removeEventListener('pointermove', this._onMove);
    this._dragState = null;
  }

  getTransform() {
    return {
      x: this.sprite.x,
      y: this.sprite.y,
      scaleX: this.sprite.scale.x,
      scaleY: this.sprite.scale.y,
      rotation: this.sprite.rotation,
    };
  }

  setTransform({ x, y, scaleX, scaleY, rotation }) {
    if (x !== undefined) this.sprite.x = x;
    if (y !== undefined) this.sprite.y = y;
    if (scaleX !== undefined) this.sprite.scale.x = scaleX;
    if (scaleY !== undefined) this.sprite.scale.y = scaleY;
    if (rotation !== undefined) this.sprite.rotation = rotation;
    this._layoutHandles();
  }

  destroy() {
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerup', this._onUp);
    this.handles.destroy({ children: true });
  }
}
