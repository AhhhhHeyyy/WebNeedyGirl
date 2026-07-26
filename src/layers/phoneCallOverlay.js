// Full-viewport "incoming call" modal, shown when the user long-presses the
// phone sticker (see stickerListLayer.js's PHONE_INDEX long-press timer).
// Self-contained DOM overlay in the same spirit as yandereProtoOverlay.js —
// no Pixi/manager dependency, so stickerListLayer.js can import and call
// triggerPhoneCall() directly with no boot()-time wiring needed anywhere else.
//
// Accepting navigates to call.html (a separate, standalone page — the
// "answered call" screen with its own live front-camera preview, which needs
// its own getUserMedia prompt and doesn't belong inside this SPA's Pixi/
// layer stack). Declining just closes the modal and leaves the caller right
// back where they were.

import { DialogueStore, VALID_LANGS } from '../core/DialogueStore.js';

const AVATAR_URL = 'Icon_jine_ame.png';
const ANSWERED_PAGE_URL = 'call.html';
const Z_INDEX = 5000; // above every in-game layer/effect, below #rotate-prompt (9999) and #loading-screen (10000)

// Fixed "design" width the modal is authored at (was the 760px cap inside the
// old `min(94vw, 760px)` CSS). --pco-scale below is computed the same way
// Stage.js's resize() fits the Pixi canvas — Math.min(w/W, h/H) — so the
// modal shrinks to fit BOTH viewport axes instead of only ever reacting to
// width and silently overflowing/clipping on short (e.g. landscape phone)
// viewports.
const DESIGN_W = 760;
const FIT_MARGIN_W = 0.94; // was `94vw`
const FIT_MARGIN_H = 0.92; // headroom so the popup never touches the top/bottom edge

// Same lang set (and the same saved/detected choice — see DialogueStore's
// own loadLang) the loading screen's picker and Frame 1's dialogue bubbles
// already use, so the call modal always agrees with the rest of the app
// instead of running its own separate language state.
const STRINGS = {
  zh: { name: 'Ame-chan 來電中', accept: '接', decline: '不接' },
  en: { name: 'Ame-chan Calling', accept: 'Answer', decline: 'Decline' },
  ja: { name: 'あめちゃんからの着信', accept: '応答', decline: '拒否' },
  ko: { name: '아메짱에게서 전화가 왔어요', accept: '받기', decline: '거절' },
};

let root = null;
let panelEl = null;
let nameEl = null;
let acceptLabelEl = null;
let declineLabelEl = null;
let visible = false;
let offLangChange = null;

// Generic "call" glyph (a phone handset silhouette) — reused unrotated for
// the accept button and rotated 135deg + recolored red for decline, the same
// visual idiom most real call UIs (Android/iOS/WhatsApp) use to tell the two
// apart without needing two different icon assets.
const PHONE_ICON_PATH = 'M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z';

function phoneIconSvg() {
  return `<svg viewBox="0 0 24 24" width="34" height="34"><path fill="currentColor" d="${PHONE_ICON_PATH}"/></svg>`;
}

function injectStyle() {
  if (document.getElementById('phone-call-overlay-style')) return;
  const style = document.createElement('style');
  style.id = 'phone-call-overlay-style';
  style.textContent = `
    #phone-call-overlay {
      position: fixed; left: 50%; top: 50%;
      transform: translate(-50%, -50%) scale(calc(var(--pco-scale, 1) * 0.85));
      width: ${DESIGN_W}px;
      z-index: ${Z_INDEX};
      font-family: 'Silver', -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif;
      opacity: 0;
      transition: transform .42s cubic-bezier(.22,1.15,.4,1), opacity .3s ease;
      pointer-events: none;
    }
    #phone-call-overlay.open {
      transform: translate(-50%, -50%) scale(var(--pco-scale, 1));
      opacity: 1;
      pointer-events: auto;
    }
    #phone-call-overlay .pco-window {
      border: 3px solid #8fd0f2;
      overflow: hidden;
      box-shadow: 0 18px 50px rgba(20, 10, 40, 0.45);
      background: #f0c9e6;
    }
    #phone-call-overlay .pco-titlebar {
      height: 30px;
      display: flex; align-items: center; justify-content: space-between;
      padding: 0 8px;
      background: linear-gradient(90deg, #d8f0ff 0%, #f6cdf0 50%, #d8f0ff 100%);
      border-bottom: 2px solid #8fd0f2;
    }
    #phone-call-overlay .pco-titleicon {
      width: 13px; height: 13px; border-radius: 2px; background: #4a3f95;
    }
    #phone-call-overlay .pco-winbtns { display: flex; gap: 5px; }
    #phone-call-overlay .pco-winbtn {
      width: 16px; height: 16px; border-radius: 2px;
      background: rgba(255,255,255,0.65); border: 1px solid #6a5fae;
      display: flex; align-items: center; justify-content: center;
      position: relative; cursor: default;
    }
    #phone-call-overlay .pco-winbtn.pco-close { cursor: pointer; }
    #phone-call-overlay .pco-winbtn.pco-close:hover { background: #f2a5ae; }
    #phone-call-overlay .pco-sq { width: 7px; height: 7px; border: 1.3px solid #5a4a9e; }
    #phone-call-overlay .pco-sq2 { width: 6px; height: 6px; border: 1.3px solid #5a4a9e; position: absolute; top: 3px; left: 3px; background: #f6cdf0; }
    #phone-call-overlay .pco-x::before, #phone-call-overlay .pco-x::after {
      content: ''; position: absolute; width: 9px; height: 1.4px; background: #5a4a9e; top: 50%; left: 50%;
    }
    #phone-call-overlay .pco-x::before { transform: translate(-50%, -50%) rotate(45deg); }
    #phone-call-overlay .pco-x::after { transform: translate(-50%, -50%) rotate(-45deg); }

    #phone-call-overlay .pco-content {
      background: linear-gradient(180deg, #f6d7ee 0%, #eec2e4 100%);
      display: flex; flex-direction: column; align-items: center;
      padding: 26px 24px 14px;
    }
    #phone-call-overlay .pco-avatar {
      width: 96px; height: 96px; border-radius: 50%;
      background: #c9bcd6; border: 3px solid #fff;
      box-shadow: 0 4px 14px rgba(90, 40, 90, 0.28);
      overflow: hidden; display: flex; align-items: center; justify-content: center;
    }
    #phone-call-overlay .pco-avatar img {
      width: 100%; height: 100%; object-fit: cover; image-rendering: pixelated;
    }
    #phone-call-overlay .pco-name {
      margin-top: 12px; font-weight: 700; letter-spacing: .03em;
      font-size: clamp(15px, 2.1vw, 21px); color: #6a3f7a;
      text-shadow: 0 1px 0 rgba(255,255,255,0.5);
    }
    #phone-call-overlay .pco-actions {
      width: 100%; margin-top: 26px;
      display: flex; justify-content: space-between; align-items: flex-start;
      padding: 0 8% 6px;
    }
    #phone-call-overlay .pco-action { display: flex; flex-direction: column; align-items: center; gap: 10px; }
    #phone-call-overlay .pco-action-label { font-size: clamp(13px, 1.6vw, 17px); font-weight: 700; color: #6a3f7a; }
    #phone-call-overlay .pco-btn {
      width: clamp(58px, 11vw, 84px); height: clamp(58px, 11vw, 84px);
      border-radius: 50%; border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center; color: #fff;
      box-shadow: 0 6px 16px rgba(40, 10, 30, 0.3);
      transition: transform .15s ease, box-shadow .15s ease;
    }
    #phone-call-overlay .pco-btn:hover { transform: scale(1.06); }
    #phone-call-overlay .pco-btn:active { transform: scale(0.94); }
    #phone-call-overlay .pco-btn.pco-accept { background: radial-gradient(circle at 35% 30%, #8fd3a1, #5da472); }
    #phone-call-overlay .pco-btn.pco-decline { background: radial-gradient(circle at 35% 30%, #e29d95, #c26b62); }
    #phone-call-overlay .pco-btn.pco-decline svg { transform: rotate(135deg); }

    #phone-call-overlay .pco-statusbar {
      height: 13px;
      background: linear-gradient(90deg, #d8f0ff 0%, #f6cdf0 50%, #d8f0ff 100%);
      border-top: 2px solid #8fd0f2;
      display: flex; align-items: center; gap: 3px; padding: 0 8px;
    }
    #phone-call-overlay .pco-statusbar span {
      width: 6px; height: 6px; background: #7a5fae; opacity: .6;
    }
  `;
  document.head.appendChild(style);
}

function buildDom() {
  root = document.createElement('div');
  root.id = 'phone-call-overlay';
  root.innerHTML = `
    <div class="pco-window">
      <div class="pco-titlebar">
        <div class="pco-titleicon"></div>
        <div class="pco-winbtns">
          <div class="pco-winbtn"><div class="pco-sq"></div></div>
          <div class="pco-winbtn"><div class="pco-sq2"></div></div>
          <div class="pco-winbtn pco-close pco-x"></div>
        </div>
      </div>
      <div class="pco-content">
        <div class="pco-avatar"><img src="${AVATAR_URL}" alt=""></div>
        <div class="pco-name"></div>
        <div class="pco-actions">
          <div class="pco-action">
            <div class="pco-action-label"></div>
            <button type="button" class="pco-btn pco-accept">${phoneIconSvg()}</button>
          </div>
          <div class="pco-action">
            <div class="pco-action-label"></div>
            <button type="button" class="pco-btn pco-decline">${phoneIconSvg()}</button>
          </div>
        </div>
      </div>
      <div class="pco-statusbar"><span></span><span></span><span></span></div>
    </div>
  `;
  document.body.appendChild(root);

  root.querySelector('.pco-accept').addEventListener('click', onAccept);
  root.querySelector('.pco-decline').addEventListener('click', onDecline);
  root.querySelector('.pco-close').addEventListener('click', onDecline);
  panelEl = root;
  nameEl = root.querySelector('.pco-name');
  acceptLabelEl = root.querySelector('.pco-action-label');
  declineLabelEl = root.querySelectorAll('.pco-action-label')[1];

  offLangChange = DialogueStore.on('change', (snap) => applyLang(snap.lang));
}

// DialogueStore.getLang() may be a saved/detected lang from before this
// module's own STRINGS table existed (or, in principle, any string at all,
// since NeedyGirlState.get() round-trips whatever was last saved) — fall
// back to the same DEFAULT_LANG family (zh) DialogueStore itself defaults to
// rather than rendering blank labels for an unrecognized code.
function applyLang(lang) {
  const t = STRINGS[lang] || STRINGS[VALID_LANGS[0]];
  if (nameEl) nameEl.textContent = t.name;
  if (acceptLabelEl) acceptLabelEl.textContent = t.accept;
  if (declineLabelEl) declineLabelEl.textContent = t.decline;
}

// root.offsetHeight is the element's unscaled layout box (CSS transforms
// don't affect layout), so this is safe to read regardless of the scale
// already applied from a previous resize.
function applyFitScale() {
  if (!root) return;
  const naturalH = root.offsetHeight;
  if (!naturalH) return; // e.g. mid-transition while display is toggling
  const scaleW = (window.innerWidth * FIT_MARGIN_W) / DESIGN_W;
  const scaleH = (window.innerHeight * FIT_MARGIN_H) / naturalH;
  const scale = Math.min(1, scaleW, scaleH);
  root.style.setProperty('--pco-scale', scale);
}

function ensureRoot() {
  if (root) return root;
  injectStyle();
  buildDom();
  window.addEventListener('resize', applyFitScale);
  window.addEventListener('orientationchange', applyFitScale);
  applyFitScale();
  return root;
}

function hide() {
  visible = false;
  panelEl?.classList.remove('open');
}

function onAccept() {
  hide();
  window.location.href = ANSWERED_PAGE_URL;
}

function onDecline() {
  hide();
}

// Called from stickerListLayer.js once a phone-sticker long-press clears
// CALL_LONG_PRESS_MS. Repeat triggers while already open are ignored — a
// stray second long-press shouldn't restart/duplicate the modal.
export function triggerPhoneCall() {
  if (visible) return;
  ensureRoot();
  applyFitScale(); // re-measure — lang text length affects naturalH
  visible = true;
  // Next frame, so the initial transform/opacity above actually applies
  // first and the .open transition has something to animate from.
  requestAnimationFrame(() => panelEl.classList.add('open'));
}
