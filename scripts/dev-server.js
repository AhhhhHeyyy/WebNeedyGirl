#!/usr/bin/env node
// Static file server for local development — use this instead of
// `python -m http.server`. The one thing it does differently: every request
// for /manifest.json re-scans UI/ first (see scripts/scan-assets.js) and
// serves the fresh result, so adding/removing/renaming/regrouping something
// in UI/ shows up on the very next page reload — no separate "run the
// scanner" step to remember.
//
// Usage: node scripts/dev-server.js [port]   (default port 8080)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { buildManifest, writeManifest, ROOT } = require('./scan-assets');

const PORT = Number(process.argv[2]) || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webm': 'video/webm',
};

// Shared layer/effect-settings store, backed by a file on disk instead of
// localStorage. localStorage is scoped per origin (protocol+host+port), so
// two dev-server instances on different ports for this same project folder
// never see each other's saved state — reading/writing the same state.json
// on disk is what actually makes them share it. See shared/state-sync.js
// for the client side of this.
const STATE_FILE = path.join(ROOT, 'state.json');
function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return {}; }
}
function writeState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);

  if (urlPath === '/api/state' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(readState()));
    return;
  }

  if (urlPath === '/api/state' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { key, value } = JSON.parse(body);
        const state = readState();
        if (value === null) delete state[key]; else state[key] = value;
        writeState(state);
        res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end(`Bad request: ${err.message}`);
      }
    });
    return;
  }

  if (urlPath === '/manifest.json') {
    try {
      const manifest = buildManifest();
      writeManifest(manifest); // keep the on-disk copy in sync too, for anyone poking at it directly
      res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(manifest, null, 2));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Failed to scan UI/: ${err.message}`);
    }
    return;
  }

  const filePath = path.join(ROOT, urlPath === '/' ? '/index.html' : urlPath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Not found: ${urlPath}`);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`NeedyGirl dev server running: http://localhost:${PORT}/index.html`);
  console.log('manifest.json auto-refreshes on every request — add/remove files in UI/, then just reload the page.');
});
