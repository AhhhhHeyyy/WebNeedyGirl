// Central registry for the game-facing stats (affection/stress/darkness/
// followers) that drive the stat-reactive effects (holographic mode,
// darkness overlay, window-break, heart/love-spam prototypes — see
// EffectDirector.js). No sticker/superchat/keyword input wiring lives here
// yet (that's future work per system/NeedyGirl-簡化版-工程實作規格.md) — this
// round only needs somewhere for those future inputs (and, for now,
// StatDebugPanel's sliders) to write into, and something for
// BaseIframeLayer/EffectDirector to read from. API mirrors the
// get/on(change)-with-unsubscribe shape shared/perf-monitor.js and
// LayerManager.js already use.

export const STAT_RANGE = {
  affection: [0, 100],
  stress: [0, 120],
  darkness: [0, 100],
  followers: [0, 9_999_999],
};

const INITIAL_STATS = { affection: 30, stress: 0, darkness: 0, followers: 0 };

function clampStat(key, value) {
  const [lo, hi] = STAT_RANGE[key];
  return Math.max(lo, Math.min(hi, value));
}

class StatStoreImpl {
  constructor() {
    this._stats = { ...INITIAL_STATS };
    this._listeners = new Set();
    this._deltaListeners = new Set();
  }

  get(key) {
    return this._stats[key];
  }

  set(key, value) {
    if (!(key in STAT_RANGE) || typeof value !== 'number' || Number.isNaN(value)) return;
    this._stats[key] = clampStat(key, value);
    this._emit();
  }

  // Sums each delta into the current value and clamps — the shape every
  // future sticker-click/superchat/keyword input will call this with.
  apply(delta) {
    if (!delta) return;
    Object.entries(delta).forEach(([key, d]) => {
      if (!(key in STAT_RANGE) || typeof d !== 'number' || Number.isNaN(d)) return;
      this._stats[key] = clampStat(key, this._stats[key] + d);
    });
    this._emit();
  }

  // Same as apply(), but also broadcasts the raw delta on the ('delta')
  // channel — frame1Layer.js's bottom-right stat readout (system/NeedyGirl-
  // 互動設計-完整文件.md §A-3) reacts to that to flash e.g. "STRESS -8".
  // Deliberately a separate method rather than folding this into apply()
  // itself: continuous/ambient stat drivers (followerTicker's 10s idle
  // trickle) call plain apply() and stay silent by design (see that file's
  // own comment on not competing with player-driven input) — only call
  // sites representing a single player-caused event (dialogue choice,
  // sticker click, superchat/keyword chat message) should call announce().
  announce(delta) {
    this.apply(delta);
    this._emitDelta(delta);
  }

  // Late subscribers get the current snapshot immediately (mirrors
  // window.onPerfTierChange) — callers that only ever react to the latest
  // value (EffectDirector, BaseIframeLayer's ng-stat broadcast) don't need a
  // separate initial-read call. 'delta' is fire-and-forget (a transient
  // event, not persisted state — nothing meaningful to replay to a
  // subscriber that attaches after the fact).
  on(event, cb) {
    if (event === 'change') {
      this._listeners.add(cb);
      cb(this.getSnapshot());
      return () => this._listeners.delete(cb);
    }
    if (event === 'delta') {
      this._deltaListeners.add(cb);
      return () => this._deltaListeners.delete(cb);
    }
    return () => {};
  }

  getSnapshot() {
    return { ...this._stats };
  }

  applySnapshot(snapshot) {
    Object.keys(STAT_RANGE).forEach((key) => {
      if (snapshot && typeof snapshot[key] === 'number') this._stats[key] = clampStat(key, snapshot[key]);
    });
    this._emit();
  }

  reset() {
    this.applySnapshot(INITIAL_STATS);
  }

  _emit() {
    const snap = this.getSnapshot();
    this._listeners.forEach((fn) => {
      try { fn(snap); } catch (e) { console.error(e); }
    });
  }

  _emitDelta(delta) {
    this._deltaListeners.forEach((fn) => {
      try { fn(delta); } catch (e) { console.error(e); }
    });
  }
}

export const StatStore = new StatStoreImpl();
