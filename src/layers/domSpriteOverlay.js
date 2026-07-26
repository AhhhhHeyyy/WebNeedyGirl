// Keeps a plain DOM element's screen box glued to a Pixi sprite's on-screen
// bounds, every tick. Shared by chat.chatboardLayer.js (the message list —
// needs real DOM for a custom font + scrollbar) and chat.chatBLayer.js (the
// border frame — needs to be DOM too just to be able to stack *above* that
// message DOM content; see chat.chatBLayer.js's own comment for why).
//
// #stage-world is the same coordinate box #pixi-stage fills (see
// index.html), so a sprite's getBounds() — already in that canvas's own
// screen-pixel space — can be applied to left/top/width/height directly, no
// further conversion needed. Appended into #stage-world specifically (not
// #stage-area) so this overlay shakes in step with the sprite it's tracking
// (see screenShake.js) instead of staying visually pinned while the sprite
// underneath it moves.
export function attachDomOverlay(layer, el, { zIndex, display = 'block', onReposition } = {}) {
  el.style.position = 'absolute';
  el.style.zIndex = String(zIndex);
  document.getElementById('stage-world').appendChild(el);

  const ticker = layer.stage.app.ticker;
  // Bounds rarely actually change frame-to-frame (only on resize/reposition of
  // the tracked sprite), but this runs on every Pixi tick — writing identical
  // style values 60x/sec still forces a style recalc and, worse, retriggers
  // any backdrop-filter/blur on this element or its children every frame (see
  // frame1Layer.js). Skip the write entirely when nothing moved.
  let lastX, lastY, lastW, lastH;
  const reposition = () => {
    const b = layer.sprite.getBounds();
    if (b.x === lastX && b.y === lastY && b.width === lastW && b.height === lastH) return;
    lastX = b.x; lastY = b.y; lastW = b.width; lastH = b.height;
    Object.assign(el.style, {
      left: `${b.x}px`, top: `${b.y}px`, width: `${b.width}px`, height: `${b.height}px`,
    });
    if (onReposition) onReposition(b);
  };
  ticker.add(reposition);
  reposition();
  el.style.display = layer.visible ? display : 'none';

  return {
    setVisible(visible) { el.style.display = visible ? display : 'none'; },
    destroy() { ticker.remove(reposition); el.remove(); },
  };
}
