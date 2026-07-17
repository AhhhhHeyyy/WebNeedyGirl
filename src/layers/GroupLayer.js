import { BaseImageLayer } from './BaseImageLayer.js';
import { DragTransform } from '../core/DragTransform.js';

// Bundles every image in a UI/<folder>/ group into one Pixi Container that
// can be dragged/scaled as a whole (the "nested sprite" pattern — move the
// parent, children keep their relative offsets) while each child image still
// keeps its own independent visibility/position/scale/rotation, managed the
// exact same way a top-level image layer is (children ARE BaseImageLayer
// instances, just parented to this group's container instead of stage.root).
export class GroupLayer {
  constructor({ id, label, stage }) {
    this.id = id;
    this.label = label;
    this.type = 'group';
    this.stage = stage;
    this.visible = true;
    this.locked = false;
    this.children = [];

    this.container = new PIXI.Container();
    this.container.sortableChildren = true;
    stage.root.addChild(this.container);

    this.drag = new DragTransform(this.container, stage, {
      onChange: () => this.onChange && this.onChange(),
    });

    this.onChange = null; // wired by LayerManager.add()
  }

  static async create({ id, label, stage, folder, images }) {
    const group = new GroupLayer({ id, label, stage });

    // Children live one level deeper than the real stage: their effective
    // on-screen scale is stage.scaleFactor * this container's own scale.
    // This tiny proxy reproduces the { root, scaleFactor } shape Base
    // ImageLayer/DragTransform expect, so that code runs unmodified for
    // sprites nested inside a group instead of directly under stage.root.
    const childStage = {
      app: stage.app,
      root: group.container,
      get scaleFactor() { return stage.scaleFactor * group.container.scale.x; },
      get width() { return stage.width; },
      get height() { return stage.height; },
      onResize: (fn) => stage.onResize(fn),
    };

    group.children = await Promise.all((images || []).map(async (entry) => {
      const opts = {
        id: entry.id, label: entry.label, src: `${folder}/${entry.file}`, stage: childStage, x: 0, y: 0, scale: 1,
      };
      if (entry.module) {
        // entry.module is "layers/<id>Layer.js" (relative to src/, see
        // scripts/scan-assets.js) — this file already lives in src/layers/.
        const mod = await import(`./${entry.module.replace(/^layers\//, '')}`);
        return mod.create(opts);
      }
      return BaseImageLayer.create(opts);
    }));
    group.children.forEach((child, i) => child.setZIndex(i));

    return group;
  }

  getChild(childId) {
    return this.children.find(c => c.id === childId);
  }

  getTransform() {
    return this.drag.getTransform();
  }

  setTransform(t) {
    this.drag.setTransform(t);
  }

  setVisible(visible) {
    this.visible = visible;
    this.container.visible = visible;
    if (visible) this.resume(); else this.pause();
  }

  setZIndex(i) {
    this.container.zIndex = i;
  }

  setLocked(locked) {
    this.locked = !!locked;
    this.drag.setLocked(this.locked);
  }

  select() { this.drag.select(); }
  deselect() { this.drag.deselect(); }

  pause() { this.children.forEach(c => c.pause && c.pause()); }
  resume() { if (this.visible) this.children.forEach(c => c.resume && c.resume()); }
  resetAnimation() { this.children.forEach(c => c.resetAnimation && c.resetAnimation()); }

  destroy() {
    this.drag.destroy();
    this.children.forEach(c => c.destroy());
    this.container.destroy({ children: true });
  }
}
