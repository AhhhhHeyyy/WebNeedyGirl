import { StatStore } from './StatStore.js';

// Central runtime state for the Frame 1 dialogue system (bubble monologue +
// full-width choice prompt — see src/layers/frame1Layer.js) and the player's
// language pick. API shape mirrors StatStore.js: get/on('change')-with-
// unsubscribe, an always-current snapshot handed to late subscribers.
//
// Deliberately holds no script data itself (see dialogueScript.js for that)
// and no auto-trigger timing (see DialogueDirector.js) — this is purely the
// "what's on screen right now" state both of those read/write, the same
// split StatStore (data) / EffectDirector (triggers) already uses elsewhere
// in this codebase.

const LANG_STORAGE_KEY = 'needygirl-dialogue-lang';
export const VALID_LANGS = ['zh', 'en', 'ja', 'ko'];
const DEFAULT_LANG = 'en';
const DEFAULT_HOLD_MS = 6000;

// "選好，否則自動套用" — the loading screen's language picker (see main.js's
// wireLoadingLangPicker) is the one deliberate choice point; anyone who
// doesn't touch it while it's up gets the browser's own reported language
// instead of a hardcoded default, so a ZH/JP/KO visitor who never clicks
// anything still lands on their own language rather than English. DEFAULT_LANG
// itself only fires for visitors whose browser languages match none of the
// four (e.g. French, German) — English as the international fallback.
function detectBrowserLang() {
  const candidates = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of candidates) {
    const lower = (tag || '').toLowerCase();
    const hit = VALID_LANGS.find((code) => lower.startsWith(code));
    if (hit) return hit;
  }
  return DEFAULT_LANG;
}

function loadLang() {
  const saved = window.NeedyGirlState?.get(LANG_STORAGE_KEY);
  return VALID_LANGS.includes(saved) ? saved : detectBrowserLang();
}

class DialogueStoreImpl {
  constructor() {
    this._lang = loadLang();
    this._mode = null; // null | 'say' | 'choice'
    this._entry = null; // the monologue or choice-set entry currently shown
    this._listeners = new Set();
    this._autoTimer = null;
  }

  getLang() {
    return this._lang;
  }

  setLang(lang) {
    if (!VALID_LANGS.includes(lang) || lang === this._lang) return;
    this._lang = lang;
    window.NeedyGirlState?.set(LANG_STORAGE_KEY, lang);
    this._emit();
  }

  // Shows a monologue entry ({ id, mood, text:{zh,en,ja,ko} }); auto-dismisses
  // after holdMs unless the player taps it away first (see frame1Layer.js).
  say(entry, { holdMs = DEFAULT_HOLD_MS } = {}) {
    if (!entry) return;
    this._clearAutoTimer();
    this._mode = 'say';
    this._entry = entry;
    this._emit();
    this._autoTimer = setTimeout(() => this.dismiss(), holdMs);
  }

  // Shows a choice-set entry ({ id, mood, prompt:{...}, choices:[{label,delta}] });
  // stays open until choose()/dismiss() — no auto-timeout, a choice needs an
  // actual answer.
  ask(entry) {
    if (!entry) return;
    this._clearAutoTimer();
    this._mode = 'choice';
    this._entry = entry;
    this._emit();
  }

  // Applies the picked choice's stat delta (if any) then closes the prompt.
  // StatStore.announce() (not plain apply()) both applies it and broadcasts
  // it on StatStore's own ('delta') channel — frame1Layer.js's bottom-right
  // stat toast subscribes there directly now, so it reacts to any
  // player-caused delta (dialogue choice, sticker click, superchat/keyword
  // chat), not just this store's own.
  choose(index) {
    if (this._mode !== 'choice' || !this._entry) return;
    const choice = this._entry.choices?.[index];
    if (choice?.delta) {
      StatStore.announce(choice.delta);
    }
    this.dismiss();
  }

  dismiss() {
    this._clearAutoTimer();
    if (!this._mode) return;
    this._mode = null;
    this._entry = null;
    this._emit();
  }

  isActive() {
    return this._mode !== null;
  }

  _clearAutoTimer() {
    if (this._autoTimer) {
      clearTimeout(this._autoTimer);
      this._autoTimer = null;
    }
  }

  // Late subscribers get the current snapshot immediately (see StatStore.js's
  // own on()). Stat deltas are broadcast through StatStore.announce() itself
  // now (see choose() above), not a second channel here.
  on(event, cb) {
    if (event !== 'change') return () => {};
    this._listeners.add(cb);
    cb(this.getSnapshot());
    return () => this._listeners.delete(cb);
  }

  getSnapshot() {
    return { lang: this._lang, mode: this._mode, entry: this._entry };
  }

  _emit() {
    const snap = this.getSnapshot();
    this._listeners.forEach((fn) => {
      try { fn(snap); } catch (e) { console.error(e); }
    });
  }
}

export const DialogueStore = new DialogueStoreImpl();
