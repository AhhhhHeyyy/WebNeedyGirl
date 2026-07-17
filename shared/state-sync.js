/* Shared server-backed key/value store, standing in for localStorage.
   localStorage is scoped per origin (protocol+host+port), so two
   dev-server instances on different ports for this same project folder
   never see each other's saved layer/effect settings. This reads/writes
   state.json on disk instead (via scripts/dev-server.js's /api/state),
   which any such instance shares regardless of port — no manual
   copy-paste between them needed.

   Falls back to localStorage alone if the server doesn't expose
   /api/state (opened via file://, or served by a plain static-file tool
   with no way to persist writes) — the try/catch below just leaves
   `cache` empty in that case, and get() already falls through to
   localStorage per key. */
window.NeedyGirlState = (function () {
  let cache = {};
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/state', false); // sync — tiny local JSON, once per page load
    xhr.send(null);
    if (xhr.status === 200) cache = JSON.parse(xhr.responseText);
  } catch (e) { /* no /api/state support */ }

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
