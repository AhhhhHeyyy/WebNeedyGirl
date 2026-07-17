#!/usr/bin/env node
// Scans UI/ for images, Lottie JSON files, self-contained effect subfolders
// (anything with its own index.html), and plain group subfolders (anything
// WITHOUT an index.html — its images get bundled into one group layer), and
// builds the manifest object main.js reads at runtime instead of hardcoding
// a per-asset import for every file.
//
// Exports buildManifest() so scripts/dev-server.js can regenerate it on
// every request (see that file) — this file's own CLI behaviour (write
// manifest.json to the project root and log a summary) is unchanged and
// still works standalone: `node scripts/scan-assets.js`.
//
// manifest.json lives at the PROJECT ROOT, deliberately not inside UI/ —
// it's the one file in this whole workflow you never touch by hand, and
// living outside the folder you're actively reorganizing means an innocent
// drag-and-drop in UI/ can't sweep it into a subfolder by accident and
// silently break loading.
//
// If src/layers/<id>Layer.js exists for a given asset (id derived from its
// filename, or `<groupId>.<fileId>` for something inside a group folder),
// the manifest points at it so main.js loads that custom module instead of
// the generic loader — the extension point for per-asset masks/interactions
// added later.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const UI_DIR = path.join(ROOT, 'UI');
const LAYERS_DIR = path.join(ROOT, 'src', 'layers');
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

function toId(name) {
  const base = name.replace(/\.[^/.]+$/, '').trim();
  const camel = base.replace(/[^a-zA-Z0-9]+(.)/g, (_, c) => c.toUpperCase());
  return camel.charAt(0).toLowerCase() + camel.slice(1);
}

function toLabel(name) {
  const base = name.replace(/\.[^/.]+$/, '').trim();
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function customModuleFor(id) {
  const file = `${id}Layer.js`;
  return fs.existsSync(path.join(LAYERS_DIR, file)) ? `layers/${file}` : undefined;
}

function withOptionalModule(entry, module) {
  return module ? { ...entry, module } : entry;
}

// Flat (non-recursive) image/lottie scan, used for both UI/ itself and the
// inside of each group folder. `idPrefix` namespaces child ids so e.g.
// heading/heading.png (id "heading") can't collide with the group's own id.
function scanFlatAssets(dir, idPrefix) {
  const images = [];
  const lottie = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() || entry.name === 'manifest.json') continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!IMAGE_EXT.has(ext) && ext !== '.json') continue;

    const id = idPrefix ? `${idPrefix}.${toId(entry.name)}` : toId(entry.name);
    const label = toLabel(entry.name);
    const item = withOptionalModule({ id, label, file: entry.name }, customModuleFor(id));
    (ext === '.json' ? lottie : images).push(item);
  }
  return { images, lottie };
}

function buildManifest() {
  const manifest = { images: [], lottie: [], effects: [], groups: [] };

  for (const entry of fs.readdirSync(UI_DIR, { withFileTypes: true })) {
    if (entry.name === 'manifest.json') continue;
    const id = toId(entry.name);
    const label = toLabel(entry.name);

    if (entry.isDirectory()) {
      const dirPath = path.join(UI_DIR, entry.name);
      if (fs.existsSync(path.join(dirPath, 'index.html'))) {
        manifest.effects.push(withOptionalModule(
          { id, label, folder: `UI/${entry.name}` }, customModuleFor(id),
        ));
      } else if (fs.readdirSync(dirPath).some(f => f.endsWith('.atlas'))) {
        // A Spine skeleton+atlas export (see UI/spineAngel/) — its .json is
        // skeleton data, not a Lottie animation, and its .png pages are atlas
        // texture sheets, not standalone sprites, so the generic flat-asset
        // scan below would misfile all three. Handled explicitly instead,
        // after this loop.
      } else {
        const { images, lottie } = scanFlatAssets(dirPath, id);
        if (images.length || lottie.length) {
          manifest.groups.push(withOptionalModule(
            { id, label, folder: `UI/${entry.name}`, images, lottie }, customModuleFor(id),
          ));
        }
      }
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (IMAGE_EXT.has(ext)) {
      manifest.images.push(withOptionalModule({ id, label, file: entry.name }, customModuleFor(id)));
    } else if (ext === '.json') {
      manifest.lottie.push(withOptionalModule({ id, label, file: entry.name }, customModuleFor(id)));
    }
  }

  // UI/spineAngel/skeleton.json + skeleton.atlas is one shared Spine rig
  // exporting two skins ("Angel", "dark") off the same skeleton — which id
  // gets which skin can't be derived from the folder listing the way a
  // plain image/group can, so it's spelled out here instead of guessed.
  // See src/layers/spineAngelASpineLayer.js / spineAngelDSpineLayer.js.
  const spineDir = path.join(UI_DIR, 'spineAngel');
  if (fs.existsSync(path.join(spineDir, 'skeleton.atlas'))) {
    for (const [entryId, label, skin] of [
      ['spineAngelASpine', 'SpineAngel_A.spine', 'Angel'],
      ['spineAngelDSpine', 'SpineAngel_D.spine', 'dark'],
    ]) {
      manifest.images.push(withOptionalModule(
        { id: entryId, label, file: 'spineAngel/skeleton.json', skin }, customModuleFor(entryId),
      ));
    }
  }

  return manifest;
}

function writeManifest(manifest) {
  fs.writeFileSync(path.join(ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}

module.exports = { buildManifest, writeManifest, ROOT };

if (require.main === module) {
  const manifest = buildManifest();
  writeManifest(manifest);
  console.log(
    `Wrote manifest.json: ${manifest.images.length} image(s), ${manifest.lottie.length} lottie, ` +
    `${manifest.effects.length} effect folder(s), ${manifest.groups.length} group folder(s).`
  );
}
