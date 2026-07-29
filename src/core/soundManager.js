// Central audio wiring — every consumer here only reacts to an
// already-computed signal (EffectDirector's tvGlitch/angelSwap toggles, a
// DOM click, a chat send) the same way every other effect in this codebase
// receives pre-computed inputs instead of re-deriving them (see
// EffectDirector.js's own header comment).

const BGM_NORMAL_SRC = 'sound/Needy Streamer Overload - Angel Falling (Extend).mp3';
const BGM_GLITCH_SRC = 'sound/Needy Streamer Overload - All Angels Break Down (Extend).mp3';
const CHANGE_SRC = 'sound/change.mp3';
const SELECT_SRC = 'sound/select.mp3';
const ENTER_SRC = 'sound/Enter.mp3';

const bgmNormal = new Audio(BGM_NORMAL_SRC);
const bgmGlitch = new Audio(BGM_GLITCH_SRC);
bgmNormal.loop = true;
bgmGlitch.loop = true;

let bgmWanted = false; // true once boot() asks the main-page loop to start
let glitchActive = false; // mirrors EffectDirector's own tvGlitchOn edge

function currentTrack() {
  return glitchActive ? bgmGlitch : bgmNormal;
}
function otherTrack() {
  return glitchActive ? bgmNormal : bgmGlitch;
}

// Autoplay can be refused until the page has seen a real user gesture — retried
// once on the first click/keydown rather than given up on, and re-checks
// `currentTrack()` at that point in case the glitch state flipped again while
// waiting (so a stale retry can't resume the wrong track).
function attemptPlay(audioEl) {
  audioEl.play().catch(() => {
    const retry = () => { if (currentTrack() === audioEl) attemptPlay(audioEl); };
    document.addEventListener('pointerdown', retry, { once: true });
    document.addEventListener('keydown', retry, { once: true });
  });
}

function syncBgmPlayback() {
  if (!bgmWanted) return;
  otherTrack().pause();
  attemptPlay(currentTrack());
}

// Fresh Audio() per call (not one shared/reused instance) so rapid or
// overlapping triggers (mashing a sticker, spamming clicks) each get their own
// full-length playback instead of cutting the previous one off.
function playOneShot(src) {
  const a = new Audio(src);
  a.play().catch(() => {});
}

// User-requested: change/select/enter boosted louder than their natural
// source level in two rounds (+50%, then another +50% on top of that) — an
// <audio> element's own `volume` caps at 1.0 (its source's natural level), so
// hitting an actually louder-than-source level needs a real Web Audio gain
// stage rather than that property. Buffers are decoded once and cached
// (module-scope AudioContext, same one reused for every boosted one-shot)
// since re-fetching/re-decoding on every single click would be wasteful for a
// sound this short and this frequent.
const BOOST_GAIN = 1.5 * 1.5;
let audioCtx = null;
const boostBufferCache = new Map(); // src -> Promise<AudioBuffer>

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function loadBoostBuffer(src) {
  if (!boostBufferCache.has(src)) {
    boostBufferCache.set(src, fetch(src)
      .then((res) => res.arrayBuffer())
      .then((data) => getAudioCtx().decodeAudioData(data)));
  }
  return boostBufferCache.get(src);
}

// Falls back to the plain (unboosted) <audio> path on any failure — a decode
// error or a browser with no Web Audio support should still play the cue,
// just at normal volume, rather than staying silent.
function playBoosted(src) {
  let ctx;
  try {
    ctx = getAudioCtx();
  } catch {
    playOneShot(src);
    return;
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  loadBoostBuffer(src).then((buffer) => {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = BOOST_GAIN;
    source.connect(gain).connect(ctx.destination);
    source.start(0);
  }).catch(() => playOneShot(src));
}

// Covers every plain interactive DOM control across the app (compose modal's
// buttons/stickers/tiers, phone-call accept/decline, the loading screen's
// lang picker, dialogue choice buttons, ...) — nearly everything clickable in
// this codebase is a real <button>, see the audit this was written against.
// The handful of clickable divs that aren't (`.ccm-close`/`.pco-close` window
// buttons, the dialogue bubble's tap-to-dismiss, chat's click-to-open input
// bar and send icon) are named explicitly. Canvas/iframe-driven interactions
// with no DOM node to hang a selector off (Frame 1/Angel clicks, the sticker
// board's 5 icons, the "man" pop-up trigger) call playSelect() directly from
// their own handlers instead — see main.js and stickerListLayer.js.
const SELECT_SELECTOR = 'button, .ng-chat-input, .ng-chat-toolbar .send, .ccm-close, .pco-close, .ng-dlg-bubble';

document.addEventListener('click', (e) => {
  if (e.target.closest(SELECT_SELECTOR)) playBoosted(SELECT_SRC);
}, true);

export const SoundManager = {
  // Called once, right as the loading screen hides — starts the looping main-
  // page ambience (or the glitch track, if TV glitch somehow already flagged
  // active at that exact instant).
  startBgm() {
    bgmWanted = true;
    syncBgmPlayback();
  },

  // Mirrors EffectDirector's own tvGlitchOn edge: swaps the looping bgm over
  // to the glitch track while active, and back while inactive — `pause()`/
  // `play()` preserve each track's own currentTime, so switching back reads as
  // the normal track continuing rather than restarting from the top.
  setTvGlitchActive(active) {
    if (active === glitchActive) return;
    glitchActive = active;
    syncBgmPlayback();
  },

  playChange() { playBoosted(CHANGE_SRC); },
  playSelect() { playBoosted(SELECT_SRC); },
  playEnter() { playBoosted(ENTER_SRC); },
};
