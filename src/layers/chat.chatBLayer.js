import { BaseImageLayer } from './BaseImageLayer.js';
import { attachDomOverlay } from './domSpriteOverlay.js';

// chat.chatB (UI/chat/ChatB.png) is the frame's decorative border ONLY —
// an opaque border with a fully transparent middle, painted as a separate
// asset from chat.chatboard's lavender fill so the two can be layered with
// the message list in between.
//
// That has to happen as a DOM overlay, not by just leaving this a plain
// Pixi sprite drawn above chat.chatboard's in the canvas: chat.chatboard
// draws the actual message list as real DOM content sitting *above* the
// entire Pixi canvas (a DOM element can only stack as a whole block in
// front of or behind an entire <canvas>, never interleaved sprite-by-sprite
// with what's inside it — see main.js's top comment). So the only way for
// this border to still read as being drawn in front of those messages,
// matching the reference mockup, is for it to also be a DOM element, one
// z-index above the message overlay's own.
export class ChatBLayer extends BaseImageLayer {
  constructor(opts) {
    super(opts);

    const img = document.createElement('img');
    img.src = opts.src;
    img.alt = '';
    Object.assign(img.style, {
      width: '100%', height: '100%', pointerEvents: 'none', userSelect: 'none',
    });

    // z-index 12: one above chat.chatboardLayer.js's message overlay (11),
    // so the border reads in front of the messages instead of behind them.
    this._overlay = attachDomOverlay(this, img, { zIndex: 12 });
  }

  setVisible(visible) {
    super.setVisible(visible);
    this._overlay.setVisible(visible);
  }

  destroy() {
    this._overlay.destroy();
    super.destroy();
  }
}

export async function create(opts) {
  const loaded = await PIXI.Assets.load(opts.src);
  const sprite = loaded instanceof PIXI.Texture ? new PIXI.Sprite(loaded) : loaded;
  return new ChatBLayer({ ...opts, sprite });
}
