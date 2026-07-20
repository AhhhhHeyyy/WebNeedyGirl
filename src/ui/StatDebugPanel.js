import { StatStore, STAT_RANGE } from '../core/StatStore.js';

// Always-on runtime sliders for StatStore — the "something to turn the
// dial" every stat-reactive effect (EffectDirector.js) needs before real
// sticker/superchat/keyword inputs exist. Mirrors PopupTuningPanel.js's
// slider markup (reuses shared/panel.css's .sg/.sg-top/.sg-label/.sg-val/
// .sg-track classes directly, no extra styling needed) and stays mounted
// permanently rather than behind a dev-only flag, matching this project's
// existing "editing UI lives in the live runtime" panels.
const LABELS = { affection: 'Affection', stress: 'Stress', darkness: 'Darkness', followers: 'Followers' };

export class StatDebugPanel {
  constructor({ mountEl }) {
    this._sliders = {};
    Object.keys(STAT_RANGE).forEach((key) => mountEl.appendChild(this._slider(key)));
    this._offChange = StatStore.on('change', (s) => this._sync(s));
  }

  _slider(key) {
    const [min, max] = STAT_RANGE[key];
    const value = StatStore.get(key);
    const step = key === 'followers' ? 100 : 1;

    const top = document.createElement('div'); top.className = 'sg-top';
    const lbl = document.createElement('span'); lbl.className = 'sg-label'; lbl.textContent = LABELS[key];
    const val = document.createElement('span'); val.className = 'sg-val'; val.textContent = Math.round(value);
    top.append(lbl, val);

    const track = document.createElement('div'); track.className = 'sg-track';
    const input = document.createElement('input');
    input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = value;
    track.appendChild(input);

    input.addEventListener('input', () => StatStore.set(key, parseFloat(input.value)));

    this._sliders[key] = { input, val };

    const box = document.createElement('div'); box.className = 'sg';
    box.append(top, track);
    return box;
  }

  // Keeps sliders in sync with StatStore even when a value changes from
  // elsewhere (e.g. a future sticker click, or 💾/↺ restoring a saved
  // snapshot) — skips whichever slider the user is actively dragging so a
  // change event this same input just fired doesn't fight the drag.
  _sync(stats) {
    Object.entries(this._sliders).forEach(([key, { input, val }]) => {
      const v = stats[key];
      if (document.activeElement !== input) input.value = v;
      val.textContent = Math.round(v);
    });
  }

  destroy() {
    this._offChange?.();
  }
}
