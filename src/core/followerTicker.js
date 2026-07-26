import { StatStore } from './StatStore.js';

// Passive followers growth (spec §9's "被動累積"). Deliberately a slow
// ambient trickle — well under the cheapest sticker/superchat bump (phone
// sticker alone is +800, cheapest superchat tier is +60) — so idle growth
// never visually competes with player-driven input.
const TICK_INTERVAL_MS = 10_000;
const IDLE_GAIN = 10;

let timer = null;

// start()/stop() shape mirrors EffectDirector.js's own API.
export const followerTicker = {
  start() {
    if (timer) return;
    timer = setInterval(() => StatStore.apply({ followers: IDLE_GAIN }), TICK_INTERVAL_MS);
  },

  stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  },
};
