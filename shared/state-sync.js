/* Shared server-backed key/value store, standing in for localStorage.
   localStorage is scoped per origin (protocol+host+port), so two
   dev-server instances on different ports for this same project folder
   never see each other's saved layer/effect settings. This reads/writes
   state.json on disk instead (via scripts/dev-server.js's /api/state),
   which any such instance shares regardless of port — no manual
   copy-paste between them needed.

   Falls back to fetching the committed state.json directly (read-only) if
   /api/state isn't there — e.g. deployed to a static host like Netlify —
   so the last locally-saved layout still ships as everyone else's default.
   Writes (set/remove) still always mirror into this visitor's own
   localStorage regardless of which fallback applies, since that's the one
   persistence path that works everywhere. */
window.NeedyGirlState = (function () {
  let cache = {};
  let haveServerBackend = false;
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/state', false); // sync — tiny local JSON, once per page load
    xhr.send(null);
    if (xhr.status === 200) { cache = JSON.parse(xhr.responseText); haveServerBackend = true; }
  } catch (e) { /* no /api/state support */ }

  // Static hosts (Netlify, etc.) have no /api/state endpoint to hit — the
  // request above just 404s and haveServerBackend stays false. Falling back
  // to fetching the committed state.json itself (shipped as an ordinary
  // static file at the project root) is what makes the last locally-saved
  // layout the DEFAULT visitors see there too, instead of every layer
  // silently reverting to its raw as-loaded position. Writes (Save
  // Layout/effect settings) still only land in that visitor's own
  // localStorage on a static host — there's no server left to persist a
  // POST to — but the shipped starting layout is what matters here.
  if (!haveServerBackend) {
    try {
      const xhr2 = new XMLHttpRequest();
      // Root-absolute, NOT a bare relative path: this same script is loaded
      // by effect pages nested arbitrarily deep (e.g. UI/retroFilter/), where
      // a relative 'state.json' would resolve against THAT page's own folder
      // instead of the site root and just 404 — which is exactly why
      // retroFilter's (and every other effect's) saved settings weren't
      // applying on a static deploy even after this fallback was added.
      xhr2.open('GET', '/state.json', false);
      xhr2.send(null);
      if (xhr2.status === 200) cache = JSON.parse(xhr2.responseText);
    } catch (e) { /* state.json not reachable either */ }
  }

  // Slider drags fire many 'input' events per second; debounce the actual
  // network write so dragging doesn't hammer the server with a POST (and a
  // disk write) on every tick. The in-memory cache and localStorage mirror
  // still update immediately, so nothing here delays what get() returns.
  const pending = {};
  function flush(key, value) {
    navigator.sendBeacon('/api/state', new Blob([JSON.stringify({ key, value })], { type: 'application/json' }));
  }

  function get(key) {
    return key in cache ? cache[key] : localStorage.getItem(key);
  }
  function set(key, value) {
    cache[key] = value;
    localStorage.setItem(key, value);
    clearTimeout(pending[key]);
    pending[key] = setTimeout(() => { flush(key, value); delete pending[key]; }, 200);
  }
  function remove(key) {
    delete cache[key];
    localStorage.removeItem(key);
    clearTimeout(pending[key]);
    delete pending[key];
    flush(key, null);
  }

  // sendBeacon (not fetch) specifically so a reset-then-reload or a
  // navigation right after a drag still delivers the write instead of
  // being cancelled mid-flight.
  addEventListener('pagehide', () => {
    Object.keys(pending).forEach(key => { clearTimeout(pending[key]); flush(key, cache[key]); });
  });

  return { get, set, remove };
})();
