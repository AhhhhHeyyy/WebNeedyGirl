// Live sliders for popupTuning (see nestedScene3PopupSpawner.js) — lets the
// content author drag Angel D's masked face-crop into place inside a spawned
// Nested Scene 3 pop-up window without editing numbers by hand. Every slider
// writes straight into the shared popupTuning object, which the spawner
// re-reads fresh on each click, so the "Test spawn" button (or any real
// stage-area click) always reflects the sliders' current values immediately.
export class PopupTuningPanel {
  constructor({ mountEl, popupTuning, onTestSpawn }) {
    this.tuning = popupTuning;
    this.onTestSpawn = onTestSpawn;

    this._injectStyle();

    const specs = [
      { key: 'cx', label: 'Crop X', min: 0, max: 512, step: 1 },
      { key: 'cy', label: 'Crop Y', min: 0, max: 512, step: 1 },
      { key: 'w', label: 'Crop W', min: 10, max: 512, step: 1 },
      { key: 'h', label: 'Crop H', min: 10, max: 512, step: 1 },
    ];

    specs.forEach(spec => mountEl.appendChild(this._slider(spec)));
    mountEl.appendChild(this._colorRow('bgColor', 'BG Color'));

    const testBtn = document.createElement('button');
    testBtn.className = 'pbtn';
    testBtn.textContent = '🪟 Test Popup (center)';
    testBtn.style.marginTop = '4px';
    testBtn.addEventListener('click', () => this.onTestSpawn && this.onTestSpawn());
    mountEl.appendChild(testBtn);
  }

  _slider({ key, label, min, max, step }) {
    const value = this.tuning[key];

    const top = document.createElement('div'); top.className = 'sg-top';
    const lbl = document.createElement('span'); lbl.className = 'sg-label'; lbl.textContent = label;
    const val = document.createElement('span'); val.className = 'sg-val'; val.textContent = value.toFixed(2);
    top.append(lbl, val);

    const track = document.createElement('div'); track.className = 'sg-track';
    const input = document.createElement('input');
    input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = value;
    track.appendChild(input);

    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      val.textContent = v.toFixed(2);
      this.tuning[key] = v;
    });

    const box = document.createElement('div'); box.className = 'sg';
    box.append(top, track);
    return box;
  }

  _colorRow(key, label) {
    const row = document.createElement('div'); row.className = 'color-row';
    const lbl = document.createElement('span'); lbl.className = 'sg-label'; lbl.textContent = label;

    const wrap = document.createElement('label'); wrap.className = 'cpick-wrap';
    const input = document.createElement('input');
    input.type = 'color'; input.value = this.tuning[key];
    input.addEventListener('input', () => { this.tuning[key] = input.value; });
    wrap.appendChild(input);

    row.append(lbl, wrap);
    return row;
  }

  // shared/panel.css has .sg/.sg-top/.sg-track/.pbtn but not the color-picker
  // rules (those live in each effect's own style.css, e.g. UI/holographic/
  // style.css) — copied verbatim here since this panel isn't one of those
  // self-contained iframe pages.
  _injectStyle() {
    if (document.getElementById('popup-tuning-style')) return;
    const style = document.createElement('style');
    style.id = 'popup-tuning-style';
    style.textContent = `
      .color-row { display:flex; align-items:center; justify-content:space-between; margin-bottom:13px; }
      .cpick-wrap {
        flex-shrink:0; width:30px; height:22px; border-radius:7px; overflow:hidden;
        box-shadow: 0 2px 8px rgba(160,128,205,0.32), inset 0 0 0 1px rgba(255,255,255,0.75);
        cursor:pointer; display:block;
      }
      .cpick-wrap input[type=color] {
        -webkit-appearance:none; appearance:none;
        width:100%; height:100%; border:none; cursor:pointer; padding:0; background:none;
      }
      .cpick-wrap input[type=color]::-webkit-color-swatch-wrapper { padding:0; }
      .cpick-wrap input[type=color]::-webkit-color-swatch { border:none; }
    `;
    document.head.appendChild(style);
  }
}
