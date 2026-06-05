#!/usr/bin/env node
/**
 * build-map-data.mjs — region-parameterized interactive-map data pipeline
 *
 * Reads the Pokémon Maps dump (REACT_INTEGRATION.md §4) and emits the
 * trimmed JSON files the React app consumes for ONE region per invocation.
 *
 * Usage:
 *   node scripts/build-map-data.mjs           → defaults to "sinnoh"
 *   node scripts/build-map-data.mjs sinnoh    → Sinnoh (Platinum)
 *   node scripts/build-map-data.mjs johto     → Johto (HeartGold/SoulSilver)
 *   REGION=johto node scripts/build-map-data.mjs   → same, via env var
 *
 * Output layout (per-region subdirs keep regions isolated):
 *   public/data/maps/<region>/maps-index.json           master zone registry
 *   public/data/maps/<region>/overworld-locations.json  clickable overworld regions
 *   public/data/maps/<region>/events/<id>_<name>.json   per-zone warps + trainers
 *                                                       (pixel coords baked in)
 *   public/data/maps/<region>/images/*.webp             content-hashed image copies
 *                                                       (gitignored, uploaded to R2)
 *   public/data/maps/<region>/walkable/*.{json,raw.bin,png}  pathfinding sidecars
 *   public/data/maps/<region>/event-manifests/*.json    full per-header event lists
 *
 * Coordinate model (REACT_INTEGRATION.md §5): every entity carries a
 * pre-computed `pixelCoord {x, y, targetPng}` that's directly drawable on
 * the named PNG — no client-side derivation needed. Trainer sprites are
 * already composited into the PNG by `build_world.py`, so React only adds
 * invisible click zones at the documented hit-zone sizes (§3.2).
 *
 * Trainer JSONs are scoped to battle trainers only (`Overworld.type == 1`)
 * — items / NPCs / signs are baked into the PNG but not clickable.
 *
 * The in-place-swap workflow: POKEMMO_MAPS_DIR points at a single working
 * dump that gets overwritten when you re-export DSPRE for a different
 * region. Run this script with the matching REGION arg and the per-region
 * output dir gets refreshed; the OTHER region's output sits untouched in
 * its own subdir until you re-export and run with that REGION.
 *
 * Required env vars:
 *   POKEMMO_MAPS_DIR   — root of the Pokémon Maps dump
 *   MAPS_IMAGE_HOST    — optional; base URL for image fetches (defaults to R2)
 *
 * Optional positional arg / env var:
 *   REGION             — sinnoh | johto (default: sinnoh)
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---------- region ----------
// Positional CLI arg first, then env var, then default. Positional is preferred
// because npm scripts on Windows can't easily set env vars without cross-env, and
// adding cross-env would be one more dep — `node script.mjs johto` is the cleanest
// cross-platform pattern.
const REGION = (process.argv[2] || process.env.REGION || 'sinnoh').toLowerCase();
const REGION_DISPLAY = ({
  sinnoh: 'Sinnoh',
  johto:  'Johto',
})[REGION] || (REGION.charAt(0).toUpperCase() + REGION.slice(1));
const VALID_REGIONS = ['sinnoh', 'johto'];
if (!VALID_REGIONS.includes(REGION)) {
  console.error(`\n  Unknown region "${REGION}". Valid: ${VALID_REGIONS.join(', ')}.\n`);
  process.exit(1);
}
console.log(`► Region: ${REGION_DISPLAY} (${REGION})`);

// ---------- input ----------
const SOURCE_ROOT = process.env.POKEMMO_MAPS_DIR;
if (!SOURCE_ROOT) {
  console.error('\n  POKEMMO_MAPS_DIR is not set.');
  console.error('  Point it at the Pokémon Maps dump root.\n');
  console.error('  See .env.example for a template.\n');
  process.exit(1);
}
const MAPS_IMG_DIR    = path.join(SOURCE_ROOT, 'map_data', 'map');
const MAPS_DATA_DIR   = path.join(SOURCE_ROOT, 'map_data', 'data');
const WALKABLE_DIR    = path.join(SOURCE_ROOT, 'map_data', 'walkable');
const WARPS_DIR       = path.join(SOURCE_ROOT, 'warps');
const TRAINERS_DIR    = path.join(SOURCE_ROOT, 'trainer_data', 'data');
// Full events manifest per header — includes EVERY overworld event (NPCs,
// trainers, items, signs, Pokémon). Superset of the per-trainer JSONs in
// TRAINERS_DIR. Used by the React pathfinder to block every tile occupied
// by an event (REACT_UPDATE_pathfinding.md §1).
const EVENTS_MANIFEST_DIR = path.join(SOURCE_ROOT, 'trainer_data', 'events');

// ---------- output ----------
const PUBLIC_REGION_DIR    = path.join(ROOT, 'public', 'data', 'maps', REGION);
const PUBLIC_IMAGES_DIR    = path.join(PUBLIC_REGION_DIR, 'images');
const PUBLIC_EVENTS_DIR    = path.join(PUBLIC_REGION_DIR, 'events');
const PUBLIC_WALKABLE_DIR  = path.join(PUBLIC_REGION_DIR, 'walkable');
const PUBLIC_EVENT_MANIFESTS_DIR = path.join(PUBLIC_REGION_DIR, 'event-manifests');

const IMAGE_HOST = process.env.MAPS_IMAGE_HOST ?? 'https://pub-5fa7446d73c34538ae0c670b480e58a2.r2.dev';
const IMAGE_PREFIX = IMAGE_HOST
  ? `${IMAGE_HOST.replace(/\/+$/, '')}/${REGION}/images/`
  : `data/maps/${REGION}/images/`;
// Tile pyramid URLs sit next to images on the same host. Leaflet's TileLayer
// uses `{z}/{x}/{y}` placeholders that R2 keys exactly map to once we encode
// the directory layout that way (see buildOverworldTilePyramid below).
const TILES_PREFIX = IMAGE_HOST
  ? `${IMAGE_HOST.replace(/\/+$/, '')}/${REGION}/tiles/`
  : `data/maps/${REGION}/tiles/`;

// ---------- helpers ----------
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function readJson(p)  { return JSON.parse(fs.readFileSync(p, 'utf-8')); }
function writeJson(p, value) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(value, null, 2) + '\n');
}
function copyIfDifferent(src, dst) {
  ensureDir(path.dirname(dst));
  if (fs.existsSync(dst)) {
    const a = fs.statSync(src), b = fs.statSync(dst);
    if (a.size === b.size && a.mtimeMs <= b.mtimeMs) return false;
  }
  fs.copyFileSync(src, dst);
  return true;
}

// Convert a source PNG to a WebP whose filename includes a content hash.
// Returns the hashed filename (e.g. "0003 - Jubilife City.a1b2c3d4e5.webp")
// so the caller can plumb it into maps-index URLs.
//
// Content-hashed filenames are the production pattern for assets behind a
// long-cache CDN: any byte change in the content changes the hash → URL →
// browser fetches fresh. Pair with `Cache-Control: immutable, max-age=1yr`
// on R2 to eliminate revalidation traffic entirely.
//
// WebP encoding choices:
//   lossless: true    Pokémon maps are pixel art. Lossy WebP at q=90 would
//                     compress further but can introduce subtle blurring of
//                     sharp tile edges. Lossless gives pixel-perfect output
//                     at typically 25–50% the size of the source PNG.
//   effort:   4       0–6 trade-off between encode speed and ratio. 4 ≈ 1
//                     s/megapixel on modern hardware; 6 is ~3× slower for
//                     ~5% smaller files. Not worth it for a regen pipeline.
//   alphaQuality:100  Preserve full alpha (matters for interiors where the
//                     geometry doesn't fill the cell).
//
// mtime cache: if a webp matching `<baseName>.*.webp` exists newer than the
// source, we reuse its filename — same content, same hash, no work to do.
async function convertWithHashIfDifferent(src, baseName, outDir) {
  ensureDir(outDir);
  const existing = findCurrentHashedWebp(baseName, outDir);
  if (existing) {
    const srcStat = fs.statSync(src);
    const dstStat = fs.statSync(path.join(outDir, existing));
    if (srcStat.mtimeMs <= dstStat.mtimeMs) {
      return { file: existing, converted: false };
    }
  }

  const buf = await sharp(src)
    .webp({ lossless: true, effort: 4, alphaQuality: 100 })
    .toBuffer();
  const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 10);
  const fileName = `${baseName}.${hash}.webp`;
  fs.writeFileSync(path.join(outDir, fileName), buf);
  return { file: fileName, converted: true };
}

// Return the newest existing hashed-webp filename for a given base, or null.
function findCurrentHashedWebp(baseName, outDir) {
  if (!fs.existsSync(outDir)) return null;
  // Files we wrote follow `<baseName>.<10-hex>.webp`. Anchor on that shape
  // so we don't accidentally collide with similarly-prefixed names.
  const re = new RegExp(`^${baseName.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\.[0-9a-f]{10}\\.webp$`);
  const matches = fs.readdirSync(outDir).filter(f => re.test(f));
  if (matches.length === 0) return null;
  // If multiple exist (a stale one + a fresh one), pick the newest.
  return matches
    .map(f => ({ f, mtime: fs.statSync(path.join(outDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0].f;
}

// Extract the 10-hex content hash baked into a webp filename produced by
// convertWithHashIfDifferent. Returns null if the name doesn't match.
function extractWebpHash(webpName) {
  const m = webpName.match(/\.([0-9a-f]{10})\.webp$/);
  return m ? m[1] : null;
}

// Build a Leaflet tile pyramid for the overworld image. WHY: the overworld is
// 90–240 megapixels per region; rendering it through <ImageOverlay> means the
// browser holds the entire decoded bitmap as one texture (≈1 GB raw for
// Sinnoh) and recomposites the lot every pan frame. A tile pyramid means each
// frame only composites the ~12–30 tiles currently in view.
//
// Pyramid layout — `<region>/tiles/overworld.<hash>/{z}/{x}/{y}.webp`:
//   z= 0          native resolution. ceil(W/256) × ceil(H/256) tiles, no
//                 downscale. Each tile is a 256-px patch of the source image.
//   z=-1          half-res. ceil(W/512) × ceil(H/512) tiles.
//   z=-N          one 256-px overview tile (downscaled 2^N×).
// where N = ceil(log2(max(W, H) / 256)). Both Sinnoh and Johto come out to
// N=6 at current dimensions, so the URL z range is 0 (native) down to -6
// (overview).
//
// Why URL z=0 = native (and negative z = increasingly downsampled)?
// Because <MapContainer crs={L.CRS.Simple}> uses 1 projected unit = 1 pixel
// at MAP zoom 0, and Leaflet's TileLayer derives tile geometry from the URL z
// value: `tile_size_in_projected_units = 256 / 2^URL_z`. So:
//   URL z=0  → 256 units per tile (= 256 pixels, native 1:1)        ✓
//   URL z=-1 → 512 units per tile (we generate by resizing to W/2)  ✓
//   URL z=-K → 256·2^K units per tile (we generate by resizing 1/2^K)
// The math lines up with no zoomOffset, no custom CRS, and no changes to the
// existing pixel-aligned coord conventions used by the rest of RegionMap.jsx
// (pathfinding code etc.). Negative URL z values are valid as file paths
// (e.g. `tiles/HASH/-3/0/0.webp`) and as URL substitutions — Leaflet just
// templates `{z}` to the integer string verbatim.
//
// Encoder choice:
//   level 0 (native)  lossless. Pixel-perfect tiles for the original sprite
//                     art at full resolution.
//   level >0          lossy q=85. The downscaled levels are no longer pixel
//                     art (lanczos3 smoothed them); lossy webp compresses
//                     these 3–5× better with no visible difference.
//
// Hash naming: tile dir is `overworld.<hash>` where <hash> is the same
// 10-hex content hash already baked into the overworld webp filename. Same
// source → same hash → same dir → no work. Source change → new dir → old dir
// becomes an orphan that gets pruned alongside the orphan webps below.
//
// Cache: if a dir matching the current hash already exists and has the
// expected number of native-level tiles, we trust it and skip regeneration.
// (Generating ~5000 tiles for Sinnoh takes ~3-5 minutes; cache hits are
// instant.)
async function buildOverworldTilePyramid({ srcPath, hash, regionOutDir }) {
  const TILE_SIZE = 256;
  const tileDirName = `overworld.${hash}`;
  const tilesRootOut = path.join(regionOutDir, 'tiles', tileDirName);

  const meta = await sharp(srcPath).metadata();
  const W = meta.width;
  const H = meta.height;
  if (!W || !H) throw new Error(`Could not read dimensions of ${srcPath}`);
  const N = Math.ceil(Math.log2(Math.max(W, H) / TILE_SIZE));

  const result = {
    tileUrlTemplate: `${TILES_PREFIX}${tileDirName}/{z}/{x}/{y}.webp`,
    tileSize: TILE_SIZE,
    tilePyramidDepth: N,
  };

  // Cache check — count native-level tiles vs expected. Native level lives
  // at the `0/` subdir under this naming scheme.
  if (fs.existsSync(tilesRootOut)) {
    const expectedNative = Math.ceil(W / TILE_SIZE) * Math.ceil(H / TILE_SIZE);
    let actualNative = 0;
    const nativeDir = path.join(tilesRootOut, '0');
    if (fs.existsSync(nativeDir)) {
      for (const xName of fs.readdirSync(nativeDir)) {
        const xPath = path.join(nativeDir, xName);
        try {
          if (fs.statSync(xPath).isDirectory()) {
            actualNative += fs.readdirSync(xPath).filter(f => f.endsWith('.webp')).length;
          }
        } catch {}
      }
    }
    if (actualNative >= expectedNative) {
      console.log(`    tile pyramid cached (${tileDirName}, ${actualNative} native tiles)`);
      return result;
    }
    console.log(`    tile pyramid present but incomplete (${actualNative}/${expectedNative}); rebuilding`);
  }

  ensureDir(tilesRootOut);
  console.log(`    building tile pyramid ${W}×${H} → depth ${N} (URL z=0 native to z=-${N} overview)`);

  let total = 0;
  const tStart = Date.now();

  // `level` 0 = native (URL z=0), level N = max downsample (URL z=-N).
  for (let level = 0; level <= N; level++) {
    const urlZ = -level;
    const scale = Math.pow(2, -level);  // 1, 1/2, 1/4, ..., 1/2^N
    const lvlW = level === 0 ? W : Math.max(1, Math.round(W * scale));
    const lvlH = level === 0 ? H : Math.max(1, Math.round(H * scale));
    const tilesX = Math.ceil(lvlW / TILE_SIZE);
    const tilesY = Math.ceil(lvlH / TILE_SIZE);

    // Decode the PNG ONCE per level into a raw RGBA buffer; every tile then
    // `.extract()`s from the same in-memory pixel array via the `raw` input
    // hint, skipping PNG decode entirely. The naive `.toBuffer()` path
    // produces a PNG buffer, which every tile pipeline would then re-decode
    // (≈200 ms × 4000 tiles ≈ 12 min wasted on Sinnoh's native level).
    //
    // Memory: a raw RGBA frame at native is ~944 MB for Sinnoh / ~372 MB for
    // Johto. Each downscaled level uses 1/4 the bytes of the one above, and
    // we only hold one level's buffer at a time, so peak ≈ native size.
    // On a 16 GB machine this is fine; on lower-RAM CI we'd need to chunk
    // the native level by row band, but that's a future optimization.
    const lvlPipe = level === 0
      ? sharp(srcPath)
      : sharp(srcPath).resize(lvlW, lvlH, { fit: 'fill', kernel: 'lanczos3' });
    const { data: levelBuf, info: levelInfo } = await lvlPipe
      .ensureAlpha()           // guarantees 4 channels for the `raw` input below
      .raw()
      .toBuffer({ resolveWithObject: true });
    const rawInput = { raw: { width: levelInfo.width, height: levelInfo.height, channels: levelInfo.channels } };

    const webpOpts = level === 0
      ? { lossless: true, effort: 4, alphaQuality: 100 }
      : { quality: 85, effort: 4, alphaQuality: 90 };

    // Collect tile descriptors so we can pre-create directories in a batch
    // (mkdir-per-file is the bottleneck at scale on Windows NTFS).
    const tasks = [];
    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const left = tx * TILE_SIZE;
        const top  = ty * TILE_SIZE;
        const tileW = Math.min(TILE_SIZE, lvlW - left);
        const tileH = Math.min(TILE_SIZE, lvlH - top);
        if (tileW <= 0 || tileH <= 0) continue;
        tasks.push({
          left, top, tileW, tileH,
          outPath: path.join(tilesRootOut, String(urlZ), String(tx), `${ty}.webp`),
          needsPad: tileW < TILE_SIZE || tileH < TILE_SIZE,
        });
      }
    }
    for (const d of new Set(tasks.map(t => path.dirname(t.outPath)))) ensureDir(d);

    // Bounded concurrency. sharp is itself threaded via libvips so 8 in-flight
    // JS pipelines is enough to saturate CPU without thrashing the GC. The
    // 4096-tile native level on Sinnoh runs in ~90 s on a typical laptop.
    const CONC = 8;
    let cursor = 0;
    await Promise.all(Array.from({ length: CONC }, async () => {
      while (cursor < tasks.length) {
        const idx = cursor++;
        const { left, top, tileW, tileH, outPath, needsPad } = tasks[idx];
        let pipe = sharp(levelBuf, rawInput).extract({ left, top, width: tileW, height: tileH });
        if (needsPad) {
          // Pad edge tiles to full TILE_SIZE with transparency so Leaflet
          // doesn't stretch a smaller image to fit the tile slot. Leaflet's
          // `bounds` keeps tiles fully outside the image from ever being
          // requested in the first place.
          pipe = pipe.extend({
            top: 0, left: 0,
            bottom: TILE_SIZE - tileH,
            right:  TILE_SIZE - tileW,
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          });
        }
        await pipe.webp(webpOpts).toFile(outPath);
      }
    }));

    total += tasks.length;
    console.log(`      z=${urlZ} (${lvlW}×${lvlH}): ${tasks.length} tiles`);
  }

  const dt = ((Date.now() - tStart) / 1000).toFixed(1);
  console.log(`    tile pyramid done: ${total} tiles in ${dt}s`);
  return result;
}

// "0003 - Jubilife City.png" → { id: 3, name: "Jubilife City" }
function parseZoneFilename(name) {
  const m = name.match(/^(\d+)\s*-\s*(.+?)\.(png|json)$/i);
  if (m) return { id: Number(m[1]), name: m[2].trim(), stem: name.replace(/\.(png|json)$/i, '') };
  if (/^overworld\.(png|json)$/i.test(name)) return { id: 'world', name: `${REGION_DISPLAY} Overworld`, stem: 'overworld' };
  return null;
}

function sanitizeForFile(name) {
  return name.normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

// Find this zone's warps file. Filenames are stable across folders via the
// 4-digit prefix; we match on prefix to tolerate trailing-period quirks.
const _warpFileCache = new Map();
function findWarpFile(zoneId) {
  if (_warpFileCache.has(zoneId)) return _warpFileCache.get(zoneId);
  const padded = String(zoneId).padStart(4, '0');
  const files = fs.readdirSync(WARPS_DIR).filter(f => f.startsWith(padded + ' '));
  const file = files[0] || null;
  _warpFileCache.set(zoneId, file);
  return file;
}

// ---------- scan ----------
console.log('► Scanning Pokémon Maps dump...');

if (!fs.existsSync(MAPS_IMG_DIR) || !fs.existsSync(MAPS_DATA_DIR)) {
  console.error(`  Missing required dirs under POKEMMO_MAPS_DIR (${SOURCE_ROOT}).`);
  process.exit(1);
}

const pngFiles  = fs.readdirSync(MAPS_IMG_DIR).filter(f => f.endsWith('.png'));
const dataFiles = fs.readdirSync(MAPS_DATA_DIR).filter(f => f.endsWith('.json'));
const dataByStem = new Map();
for (const f of dataFiles) {
  const parsed = parseZoneFilename(f);
  if (parsed) dataByStem.set(parsed.stem, f);
}

console.log(`  ${pngFiles.length} PNGs · ${dataFiles.length} sidecars · ${fs.readdirSync(WARPS_DIR).filter(f => f.endsWith('.json')).length} warp files · ${fs.readdirSync(TRAINERS_DIR).filter(f => f.endsWith('.json')).length} trainer files`);

// ---------- index trainers by zone id ----------
// Per the new exporter schema (REACT_INTEGRATION.md §10, 2026-05), trainer
// JSONs are scoped to `Overworld.type == 1` only — actual battle trainers,
// not items / NPCs / Pokémon / signs. Those other event kinds are baked
// into the map PNG (composited by `build_world.py`) but aren't clickable.
console.log('► Indexing trainers...');
const trainersByZoneId = new Map();
for (const f of fs.readdirSync(TRAINERS_DIR)) {
  if (!f.endsWith('.json')) continue;
  const t = readJson(path.join(TRAINERS_DIR, f));
  const zid = t.header?.id;
  if (zid == null) continue;
  if (!trainersByZoneId.has(zid)) trainersByZoneId.set(zid, []);
  trainersByZoneId.get(zid).push(t);
}
console.log(`  ${trainersByZoneId.size} zones have battle trainers`);

// ---------- per-zone build ----------
ensureDir(PUBLIC_IMAGES_DIR);
ensureDir(PUBLIC_EVENTS_DIR);

// Migration: prune any stale `.png` files left over from a previous build
// that wrote PNGs directly. We now emit `.webp` only, so the PNGs would just
// be orphaned bytes taking up disk space.
let prunedStalePngs = 0;
for (const f of fs.readdirSync(PUBLIC_IMAGES_DIR)) {
  if (f.endsWith('.png')) {
    fs.unlinkSync(path.join(PUBLIC_IMAGES_DIR, f));
    prunedStalePngs++;
  }
}
if (prunedStalePngs) console.log(`  pruned ${prunedStalePngs} stale .png files (now WebP-only)`);

const mapsIndex = {};
let writtenEvents = 0;
let nextTrainerInstanceId = 1;
const allTrainerInstances = {};
let skippedNullPixel = { warps: 0, trainers: 0 };

// Zone connectivity graph (output: zone-graph.json). Aggregates every
// warp's (sourceZone, sourceTile, destZone, destTile) tuple so the React
// side can run hierarchical A* — zone-level routing across the region,
// per-zone tile A* within each segment. Built incrementally during the
// per-zone loop below; written once at the end.
//
// Schema:
//   {
//     "<zoneId>": {
//        "warps": [
//          { "warpId": "w0", "fromTile": {tx, ty}, "toZone": N, "toTile": {tx, ty} },
//          ...
//        ]
//     },
//     ...
//   }
//
// Tile coords assume tilePxOnVisibleMap = 16 (DPPt at 1.0 ppu). Warps
// have pixelCoord at tile center (per REACT_WALKABILITY.md §5), so
// floor-divide returns the tile directly without offset.
const zoneGraph = {};
let totalEdges = 0;
// Cross-zone routing is scoped to CAVE-LIKE WARP CONNECTIVITY only — the
// useful application is multi-floor cave traversal (Mt. Coronet, Wayward
// Cave, Iron Island etc.) where floors connect through stair warps.
// Overworld zones connect to each other via matrix-cell adjacency rather
// than explicit warps, but supporting that in cross-zone routing isn't
// in scope. Routes between overworld zones can be planned by the human
// using the existing per-zone pathfinder + zone jump dropdown.

// ---------- pass 1: convert all PNGs to content-hashed WebPs in parallel ----------
console.log(`► Converting ${pngFiles.length} PNGs to content-hashed WebP (parallel)...`);
const hashedNameBySrc = new Map();
let converted = 0;
const conversionResults = await Promise.all(
  pngFiles.map(async (png) => {
    const baseName = png.replace(/\.png$/i, '');
    try {
      const r = await convertWithHashIfDifferent(
        path.join(MAPS_IMG_DIR, png),
        baseName,
        PUBLIC_IMAGES_DIR,
      );
      return { png, hashedName: r.file, converted: r.converted };
    } catch (e) {
      console.warn(`  ✗ ${png}: ${e.message}`);
      return { png, hashedName: null, converted: false };
    }
  })
);
for (const r of conversionResults) {
  if (r.hashedName) hashedNameBySrc.set(r.png, r.hashedName);
  if (r.converted) converted++;
}
console.log(`  ${converted} converted, ${conversionResults.length - converted} cached (mtime match)`);

for (const png of pngFiles.sort()) {
  const parsed = parseZoneFilename(png);
  if (!parsed) continue;
  const stem = parsed.stem;
  const sidecarFile = dataByStem.get(stem);
  if (!sidecarFile) { console.log(`  ✗ skip ${stem} — no sidecar JSON`); continue; }
  const sidecar = readJson(path.join(MAPS_DATA_DIR, sidecarFile));

  const webpName = hashedNameBySrc.get(png);
  if (!webpName) {
    console.log(`  ✗ skip ${stem} — conversion failed in pass 1`);
    continue;
  }

  // World overview gets a special entry.
  if (parsed.id === 'world') {
    // Build a Leaflet-compatible tile pyramid for the overworld image. The
    // pyramid is what lets pan/zoom be smooth: <ImageOverlay> holds the
    // whole decoded bitmap as one GPU texture (≈944 MB raw for Sinnoh,
    // ≈372 MB for Johto), and recomposites it every frame; <TileLayer> only
    // composites the ~12-30 tiles in view. See buildOverworldTilePyramid for
    // the layout + coordinate calibration.
    const overworldHash = extractWebpHash(webpName);
    let pyramidMeta = {};
    if (overworldHash) {
      try {
        pyramidMeta = await buildOverworldTilePyramid({
          srcPath: path.join(MAPS_IMG_DIR, png),
          hash: overworldHash,
          regionOutDir: PUBLIC_REGION_DIR,
        });
      } catch (err) {
        // If pyramid build fails for any reason, the React side falls back to
        // <ImageOverlay> via the imageUrl field. That keeps the build
        // resilient — we'd rather ship the slower-but-working overview than
        // block the regen.
        console.warn(`    ✗ tile pyramid failed for overworld: ${err.message}`);
      }
    } else {
      console.warn(`    ✗ could not extract content hash from "${webpName}" — skipping tile pyramid`);
    }
    mapsIndex.world = {
      displayName: `${REGION_DISPLAY} Overworld`,
      imageUrl: `${IMAGE_PREFIX}${webpName}`,
      imageWidth: sidecar.imageWidth,
      imageHeight: sidecar.imageHeight,
      type: 'overview',
      // Tile pyramid metadata, when generation succeeded. Consumer:
      // src/pages/RegionMap.jsx — falls back to ImageOverlay if absent.
      ...pyramidMeta,
    };
    continue;
  }

  const warpFile = findWarpFile(parsed.id);
  const warpsRaw = warpFile ? readJson(path.join(WARPS_DIR, warpFile)).warps || [] : [];
  const trainersRaw = trainersByZoneId.get(parsed.id) || [];

  // Build per-zone events. We just pass through pre-computed pixelCoords;
  // the exporter has already applied every coordinate transformation
  // (REACT_INTEGRATION.md §10, May 2026 fixes).
  const warpsOut = [];
  const zoneEdges = [];
  for (const w of warpsRaw) {
    if (!w.pixelCoord) { skippedNullPixel.warps++; continue; }
    const id = `w${w.warpIndex ?? warpsOut.length}`;
    warpsOut.push({
      id,
      pixelX: w.pixelCoord.x,
      pixelY: w.pixelCoord.y,
      worldX: w.worldCoord?.x ?? null,
      worldZ: w.worldCoord?.z ?? null,
      destinationZoneId: w.destination?.destinationHeader?.id ?? null,
      destinationName:   w.destination?.destinationHeader?.name ?? null,
      destinationPixelX: w.destination?.destinationPixelCoord?.x ?? null,
      destinationPixelY: w.destination?.destinationPixelCoord?.y ?? null,
      anchor:            w.destination?.anchor ?? null,
    });

    // Record into the zone-graph if this warp has a usable destination.
    // Skip warps that lead to Mystery Zone placeholders or have null dest
    // pixels — they're unreachable for pathfinding purposes.
    const destZone = w.destination?.destinationHeader?.id;
    const destPixel = w.destination?.destinationPixelCoord;
    const destName = w.destination?.destinationHeader?.name;
    if (destZone != null && destPixel?.x != null && destPixel?.y != null && destName !== 'Mystery Zone') {
      zoneEdges.push({
        warpId: id,
        fromTile: { tx: Math.floor(w.pixelCoord.x / 16), ty: Math.floor(w.pixelCoord.y / 16) },
        toZone: destZone,
        toTile: { tx: Math.floor(destPixel.x / 16), ty: Math.floor(destPixel.y / 16) },
      });
      totalEdges++;
    }
  }
  if (zoneEdges.length > 0) {
    zoneGraph[String(parsed.id)] = { warps: zoneEdges };
  }

  const trainersOut = [];
  for (const t of trainersRaw) {
    if (!t.pixelCoord) { skippedNullPixel.trainers++; continue; }
    const trainerInstanceId = nextTrainerInstanceId++;
    const entry = {
      id: `t${t.npcIndex ?? trainersOut.length}`,
      trainerInstanceId,
      // Position — feet-anchor on the tile at pixelCoord. React draws an
      // invisible 16×32 hit zone with bottom-center at (pixelX, pixelY).
      pixelX: t.pixelCoord.x,
      pixelY: t.pixelCoord.y,
      // Identity (REACT_INTEGRATION.md §4.2)
      trainerId:   t.trainerId ?? null,
      trainerName: t.trainerName || null,
      orientation: t.orientation || null,
      isDoubleBattlePartner: !!t.isDoubleBattlePartner,
      scriptNumber: t.scriptNumber ?? null,
      // User-editable: filled in manually for now (exporter leaves empty).
      rewardAmount: t.rewardAmount ?? null,
      team:         Array.isArray(t.team) ? t.team : [],
    };
    trainersOut.push(entry);
    allTrainerInstances[trainerInstanceId] = {
      ...entry,
      zoneId: parsed.id,
      zoneName: parsed.name,
    };
  }

  // Tag type. matrixId 0 = part of the overworld matrix (city/route);
  // anything else is an interior. Used for the dropdown grouping.
  const matrixId = trainersRaw[0]?.header?.matrixId
                ?? warpsRaw[0]?.header?.matrixId
                ?? null;
  const isOverworld = matrixId === 0;

  const eventsOut = {
    zoneId: parsed.id,
    displayName: parsed.name,
    warps: warpsOut,
    trainers: trainersOut,
  };
  const eventsFile = `${String(parsed.id).padStart(4, '0')}_${sanitizeForFile(parsed.name)}.json`;
  writeJson(path.join(PUBLIC_EVENTS_DIR, eventsFile), eventsOut);
  writtenEvents++;

  // Walkability sidecars (REACT_WALKABILITY.md §3, 2026-05).
  //
  // PRIMARY data contract is the raw bin + JSON byte maps; the PNG is now an
  // optional debug visualization. React's A* reads:
  //   - `<base>.raw.bin`  bit-for-bit ROM type+collision bytes (2 per tile)
  //   - `<base>.json`     metadata + typeByteMap + collisionByteMap
  // The `<base>.png` is still copied for debug overlays / visual diffing
  // but isn't required for pathfinding to work.
  //
  // All three files are small (raw.bin ≲ 50 KB worst case, JSON ≲ 4 KB,
  // PNG ≲ 2 KB) so we don't content-hash or push them through R2. Relative
  // URL only; React resolves via BASE_URL. Generator silently skips zones
  // that have no walkability data (some headers were skipped by the DSPRE
  // export — placeholders / dungeons / matrix-load failures).
  const walkBase   = png.replace(/\.png$/i, '');
  const walkPngSrc  = path.join(WALKABLE_DIR, `${walkBase}.png`);
  const walkJsonSrc = path.join(WALKABLE_DIR, `${walkBase}.json`);
  const walkRawSrc  = path.join(WALKABLE_DIR, `${walkBase}.raw.bin`);
  let walkableUrl = null, walkableJsonUrl = null, walkableRawUrl = null;
  // Need at least the JSON + raw bin to enable pathfinding on this zone.
  // The PNG is optional (debug viz only).
  if (fs.existsSync(walkJsonSrc) && fs.existsSync(walkRawSrc)) {
    ensureDir(PUBLIC_WALKABLE_DIR);
    copyIfDifferent(walkJsonSrc, path.join(PUBLIC_WALKABLE_DIR, `${walkBase}.json`));
    copyIfDifferent(walkRawSrc,  path.join(PUBLIC_WALKABLE_DIR, `${walkBase}.raw.bin`));
    walkableJsonUrl = `data/maps/${REGION}/walkable/${walkBase}.json`;
    walkableRawUrl  = `data/maps/${REGION}/walkable/${walkBase}.raw.bin`;
    if (fs.existsSync(walkPngSrc)) {
      copyIfDifferent(walkPngSrc, path.join(PUBLIC_WALKABLE_DIR, `${walkBase}.png`));
      walkableUrl = `data/maps/${REGION}/walkable/${walkBase}.png`;
    }

  }

  // Events manifest copy. The full per-header events list (NPCs + trainers
  // + items + signs + Pokémon) lives in trainer_data/events/<header>.json
  // in the dump. We surface it to the React side so the pathfinder can
  // block every tile occupied by an overworld event. Filename mirrors the
  // visible map's stem so the React side joins on the 4-digit prefix.
  const manifestSrc = path.join(EVENTS_MANIFEST_DIR, `${walkBase}.json`);
  let eventsManifestUrl = null;
  if (fs.existsSync(manifestSrc)) {
    ensureDir(PUBLIC_EVENT_MANIFESTS_DIR);
    copyIfDifferent(manifestSrc, path.join(PUBLIC_EVENT_MANIFESTS_DIR, `${walkBase}.json`));
    eventsManifestUrl = `data/maps/${REGION}/event-manifests/${walkBase}.json`;
  }

  mapsIndex[String(parsed.id)] = {
    displayName: parsed.name,
    imageUrl: `${IMAGE_PREFIX}${webpName}`,
    imageWidth: sidecar.imageWidth,
    imageHeight: sidecar.imageHeight,
    // worldBounds: passthrough of the visible-map sidecar's Blender-world
    // bounding box. Not used by the React side anymore (the walkability
    // grid is now coord-aligned to the visible map — see REACT_WALKABILITY.md
    // §10), but kept around because it's tiny and may help future features
    // (e.g. cross-zone routing where you need to know absolute world coords).
    worldBounds: {
      minX: sidecar.worldBounds?.minX ?? 0,
      maxX: sidecar.worldBounds?.maxX ?? sidecar.imageWidth,
      minY: sidecar.worldBounds?.minY ?? 0,
      maxY: sidecar.worldBounds?.maxY ?? sidecar.imageHeight,
    },
    type: isOverworld ? 'overworld' : 'interior',
    eventsUrl: `data/maps/${REGION}/events/${eventsFile}`,
    // walkableRawUrl + walkableJsonUrl are the PRIMARY data path for the
    // React A* (REACT_WALKABILITY.md §3, 2026-05). walkableUrl is the
    // optional debug PNG and may be null even when raw + json are present.
    walkableUrl,
    walkableJsonUrl,
    walkableRawUrl,
    eventsManifestUrl,
  };
}

// ---------- orphan cleanup ----------
// Delete any .webp file in PUBLIC_IMAGES_DIR not referenced by the new
// maps-index. These are old hashes left over from previous content versions —
// safe to remove since their URLs are no longer in maps-index.
const referenced = new Set();
for (const entry of Object.values(mapsIndex)) {
  if (!entry.imageUrl) continue;
  referenced.add(decodeURIComponent(entry.imageUrl.split('/').pop()));
}
let orphans = 0;
for (const f of fs.readdirSync(PUBLIC_IMAGES_DIR)) {
  if (f.endsWith('.webp') && !referenced.has(f)) {
    fs.unlinkSync(path.join(PUBLIC_IMAGES_DIR, f));
    orphans++;
  }
}
if (orphans) console.log(`  pruned ${orphans} orphan WebPs (stale content hashes)`);

// Stale tile-pyramid directories. The tile dir is named `overworld.<hash>`
// where <hash> matches the current overworld webp filename. Anything else
// under public/data/maps/<region>/tiles/ is from a previous content version.
const tilesRootDir = path.join(PUBLIC_REGION_DIR, 'tiles');
if (fs.existsSync(tilesRootDir)) {
  // Derive the keeper dir name from the current world entry. If pyramid
  // generation failed for some reason (no tileUrlTemplate), keep all dirs
  // around — better to leak some bytes than nuke a working overview.
  let keepDirName = null;
  const tpl = mapsIndex.world?.tileUrlTemplate;
  if (tpl) {
    // tpl looks like `…/tiles/overworld.<hash>/{z}/{x}/{y}.webp` — the
    // segment between `/tiles/` and the next `/` is the dir name.
    const m = tpl.match(/\/tiles\/([^/]+)\//);
    keepDirName = m ? m[1] : null;
  }
  let orphanTileDirs = 0;
  for (const sub of fs.readdirSync(tilesRootDir)) {
    if (keepDirName && sub === keepDirName) continue;
    const p = path.join(tilesRootDir, sub);
    try {
      if (fs.statSync(p).isDirectory()) {
        fs.rmSync(p, { recursive: true, force: true });
        orphanTileDirs++;
      }
    } catch {}
  }
  if (orphanTileDirs) console.log(`  pruned ${orphanTileDirs} stale tile-pyramid dir(s)`);
}

// ---------- overworld locations from warps/overworld.json ----------
console.log('► Building overworld locations...');
const overworldWarpsPath = path.join(WARPS_DIR, 'overworld.json');
const overworldLocations = [];
if (fs.existsSync(overworldWarpsPath)) {
  const ow = readJson(overworldWarpsPath);
  for (const lw of ow.locationWarps || []) {
    const dh = lw.destinationHeader;
    if (!dh || dh.name === 'Mystery Zone') continue;
    const pb = lw.pixelBounds;
    if (!pb) continue;
    overworldLocations.push({
      name: dh.name,
      zoneId: dh.id,
      pixelX: pb.centerX,
      pixelY: pb.centerY,
      pixelBounds: { minX: pb.minX, maxX: pb.maxX, minY: pb.minY, maxY: pb.maxY },
      cellsInMatrix0: lw.cellsInMatrix0 || [],
    });
  }
}
overworldLocations.sort((a, b) => a.name.localeCompare(b.name) || a.zoneId - b.zoneId);
console.log(`  ${overworldLocations.length} overworld markers (filtered Mystery Zone)`);

// ---------- write top-level files ----------
writeJson(path.join(PUBLIC_REGION_DIR, 'maps-index.json'), mapsIndex);
writeJson(path.join(PUBLIC_REGION_DIR, 'overworld-locations.json'), { locations: overworldLocations });
writeJson(path.join(PUBLIC_REGION_DIR, 'trainer-instances.json'), {
  _comment: 'Master catalog of every battle trainer placement, keyed by stable numeric trainerInstanceId. Per-zone events JSON references the same IDs. Item / NPC / Pokémon / sign events are baked into the map PNGs (composited by build_world.py) and are not in this catalog.',
  totalInstances: Object.keys(allTrainerInstances).length,
  trainerInstances: allTrainerInstances,
});
writeJson(path.join(PUBLIC_REGION_DIR, 'zone-graph.json'), {
  _comment: 'Zone connectivity graph for cross-map hierarchical A*. Each entry lists outgoing warps with source/destination tile coordinates. Consumed by src/lib/crossMapPathfinding.js (forthcoming).',
  totalZones: Object.keys(zoneGraph).length,
  totalEdges,
  zones: zoneGraph,
});

// ---------- summary ----------
console.log('► Done.');
console.log(`  maps in index:     ${Object.keys(mapsIndex).length}`);
console.log(`  overworld markers: ${overworldLocations.length}`);
console.log(`  per-zone events:   ${writtenEvents}`);
console.log(`  trainer instances: ${Object.keys(allTrainerInstances).length}`);
console.log(`  zone-graph:        ${Object.keys(zoneGraph).length} zones · ${totalEdges} warp edges`);
console.log(`  PNGs→WebP converted: ${converted} (of ${pngFiles.length}; rest cached)`);
if (skippedNullPixel.warps || skippedNullPixel.trainers) {
  console.log(`  skipped (null pixelCoord): ${skippedNullPixel.warps} warps, ${skippedNullPixel.trainers} trainers`);
}
console.log(`  image URLs:        ${IMAGE_PREFIX}*`);
