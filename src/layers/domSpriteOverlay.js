// Keeps a plain DOM element's screen box glued to a Pixi sprite's on-screen
// bounds, every tick. Shared by chat.chatboardLayer.js (the message list —
// needs real DOM for a custom font + scrollbar) and chat.chatBLayer.js (the
// border frame — needs to be DOM too just to be able to stack *above* that
// message DOM content; see chat.chatBLayer.js's own comment for why).
//
// #stage-area is the same coordinate box #pixi-stage fills (see index.html),
// so a sprite's getBounds() — already in that canvas's own screen-pixel
// space — can be applied to left/top/width/height directly, no further
// conversion needed.
export function attachDomOverlay(layer, el, { zIndex, display = 'block', onReposition } = {}) {
  el.style.position = 'absolute';
  el.style.zIndex = String(zIndex);
  document.getElementById('stage-area').appendChild(el);

  const ticker = layer.stage.app.ticker;
  const reposition = () => {
    const b = layer.sprite.getBounds();
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
