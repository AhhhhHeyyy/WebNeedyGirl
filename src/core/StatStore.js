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

const INITIAL_STATS = { affection: 50, stress: 20, darkness: 10, followers: 1_200 };

function clampStat(key, value) {
  const [lo, hi] = STAT_RANGE[key];
  return Math.max(lo, Math.min(hi, value));
}

class StatStoreImpl {
  constructor() {
    this._stats = { ...INITIAL_STATS };
    this._listeners = new Set();
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

  // Late subscribers get the current snapshot immediately (mirrors
  // window.onPerfTierChange) — callers that only ever react to the latest
  // value (EffectDirector, BaseIframeLayer's ng-stat broadcast) don't need a
  // separate initial-read call.
  on(event, cb) {
    if (event !== 'change') return () => {};
    this._listeners.add(cb);
    cb(this.getSnapshot());
    return () => this._listeners.delete(cb);
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
}

export const StatStore = new StatStoreImpl();
