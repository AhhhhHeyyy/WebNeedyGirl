import { BoardAnchoredLayer } from './BoardAnchoredLayer.js';

export async function create(opts) {
  const loaded = await PIXI.Assets.load(opts.src);
  const sprite = loaded instanceof PIXI.Texture ? new PIXI.Sprite(loaded) : loaded;
  return new BoardAnchoredLayer({ ...opts, sprite });
}
