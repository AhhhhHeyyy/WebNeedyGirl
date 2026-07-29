// Gates the "LAYERS" settings panel (gear icon) and on-canvas drag/resize —
// dev-only editing tools, not something a public visitor should be able to
// stumble into and rearrange (see README.md's "開發者模式" section for the
// user-facing how-to). Off by default; visiting once with ?edit=1 flips it
// on and persists via localStorage so it survives reloads without needing
// the query string every time. ?edit=0 turns it back off explicitly.
const EDIT_MODE_KEY = 'needygirl-edit-mode';

const param = new URLSearchParams(window.location.search).get('edit');
if (param === '1') localStorage.setItem(EDIT_MODE_KEY, '1');
else if (param === '0') localStorage.removeItem(EDIT_MODE_KEY);

export const EDIT_MODE = localStorage.getItem(EDIT_MODE_KEY) === '1';
