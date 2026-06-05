#!/usr/bin/env node
/**
 * prune-dist-for-gh-pages.mjs — strip R2-hosted assets out of dist/
 *
 * Runs after `vite build` and before `gh-pages -d dist`. Vite copies the
 * entire `public/` tree to `dist/` verbatim, which includes:
 *   - `public/data/maps/<region>/images/`  (the per-zone WebPs)
 *   - `public/data/maps/<region>/tiles/`   (the overworld tile pyramid)
 *
 * Both of those are hosted on Cloudflare R2 — `maps-index.json` carries
 * absolute R2 URLs for every image and tile, so the React app never asks
 * GitHub Pages for any of them. Including them in the deploy would mean:
 *   1. Pushing hundreds of MB of dead bytes to the gh-pages branch.
 *   2. Crossing Windows' ~32 KB CreateProcess command-line cap inside
 *      gh-pages' internal `git rm`, which throws ENAMETOOLONG once the
 *      pyramid added ~5000 tiles to the file list. That's the bug this
 *      script fixes.
 *
 * We do NOT touch:
 *   - `data/maps/<region>/{maps-index,zone-graph,overworld-locations,
 *      trainer-instances}.json` — the React app fetches these at runtime.
 *   - `data/maps/<region>/events/*.json` — per-zone event JSONs are small
 *      and used by the pathfinder.
 *   - `data/maps/<region>/walkable/*` — small pathfinding sidecars.
 *   - `data/maps/<region>/event-manifests/*.json` — required by the
 *      pathfinder to block tiles.
 *
 * Idempotent: missing dirs are silently skipped, so it's safe to run on
 * a build that didn't include images/tiles in the first place.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST_MAPS = path.join(ROOT, 'dist', 'data', 'maps');

if (!fs.existsSync(DIST_MAPS)) {
  // No map data in dist/ — nothing to prune.
  console.log('► prune-dist: no dist/data/maps/ — nothing to do');
  process.exit(0);
}

const PRUNE_SUBDIRS = ['images', 'tiles'];
let totalRemoved = 0;
let totalBytes = 0;

function dirSize(dir) {
  let bytes = 0;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const sub = path.join(dir, ent.name);
    if (ent.isDirectory()) bytes += dirSize(sub);
    else { try { bytes += fs.statSync(sub).size; } catch {} }
  }
  return bytes;
}

for (const region of fs.readdirSync(DIST_MAPS)) {
  const regionDir = path.join(DIST_MAPS, region);
  if (!fs.statSync(regionDir).isDirectory()) continue;
  for (const sub of PRUNE_SUBDIRS) {
    const target = path.join(regionDir, sub);
    if (!fs.existsSync(target)) continue;
    const bytes = dirSize(target);
    fs.rmSync(target, { recursive: true, force: true });
    totalRemoved++;
    totalBytes += bytes;
    console.log(`  pruned dist/data/maps/${region}/${sub}/ (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
  }
}

if (totalRemoved === 0) {
  console.log('► prune-dist: nothing to prune (already clean)');
} else {
  console.log(`► prune-dist: removed ${totalRemoved} dir(s) · ${(totalBytes / 1024 / 1024).toFixed(1)} MB total`);
}
