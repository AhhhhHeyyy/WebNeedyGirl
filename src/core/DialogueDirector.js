import { StatStore } from './StatStore.js';
import { DialogueStore } from './DialogueStore.js';
import { MONOLOGUES, CHOICE_SETS, pickMood } from './dialogueScript.js';

// Decides WHEN Angel talks and WHICH line/choice-set fits the current mood —
// UI rendering is entirely frame1Layer.js's job (it just subscribes to
// DialogueStore). Timing formula and mood buckets are ported from
// system/NeedyGirl-互動設計-完整文件.md §A-2/§B-4: interval shrinks as stress
// rises (more anxious chatter under pressure), mood is picked off the same
// darkness/stress thresholds dialogueScript.pickMood() uses.
const MIN_INTERVAL_S = 8;
const MAX_INTERVAL_S = 40;
const STRESS_INTERVAL_FACTOR = 0.2; // seconds shaved off per stress point

// A minority of auto-triggers open a choice prompt instead of a monologue —
// keeps the choice UI from feeling like it's constantly interrupting, while
// still surfacing it regularly enough to actually move the stats.
const CHOICE_CHANCE = 0.3;

function intervalMs(stats) {
  const seconds = Math.max(MIN_INTERVAL_S, Math.min(MAX_INTERVAL_S, 35 - stats.stress * STRESS_INTERVAL_FACTOR));
  return seconds * 1000;
}

// Prefers a mood-matching line, but falls back to the full list rather than
// silently doing nothing if a mood ever has no entries (e.g. content gets
// trimmed later).
function pickFrom(list, mood) {
  const pool = list.filter((e) => e.mood === mood);
  const source = pool.length ? pool : list;
  return source[Math.floor(Math.random() * source.length)];
}

let timer = null;

function scheduleNext() {
  clearTimeout(timer);
  timer = setTimeout(tick, intervalMs(StatStore.getSnapshot()));
}

// Shared by the idle timer (tick) and a manual trigger (triggerNow) — picks
// a mood-appropriate monologue or choice-set and hands it to DialogueStore.
function pickAndShow() {
  const stats = StatStore.getSnapshot();
  const mood = pickMood(stats);
  if (Math.random() < CHOICE_CHANCE) {
    DialogueStore.ask(pickFrom(CHOICE_SETS, mood));
  } else {
    DialogueStore.say(pickFrom(MONOLOGUES, mood));
  }
}

function tick() {
  // Never interrupts a line/choice that's still on screen — the next tick
  // just re-rolls the (now shorter/longer) interval and tries again later.
  if (!DialogueStore.isActive()) pickAndShow();
  scheduleNext();
}

// start()/stop() shape mirrors EffectDirector.js/followerTicker.js.
export const DialogueDirector = {
  start() {
    if (timer) return;
    scheduleNext();
  },

  stop() {
    clearTimeout(timer);
    timer = null;
  },

  // Manual trigger for a direct player action (clicking Angel — see
  // main.js's stage-area click handler) — unlike tick() above, this always
  // shows something even if a line/choice is already up (a click is a
  // deliberate poke, it should always get a fresh reaction), and restarts
  // the idle countdown so the auto-timer doesn't immediately stack another
  // one right on top of it.
  triggerNow() {
    pickAndShow();
    if (timer) scheduleNext();
  },
};
