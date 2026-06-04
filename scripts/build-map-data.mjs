#!/usr/bin/env node
/**
 * build-map-data.mjs — Sinnoh interactive-map data pipeline
 *
 * Reads the Pokémon Maps dump (REACT_INTEGRATION.md §4) and emits the
 * trimmed JSON files the React app consumes.
 *
 * Output layout:
 *   public/data/maps/sinnoh/maps-index.json           master zone registry
 *   public/data/maps/sinnoh/overworld-locations.json  clickable overworld regions
 *   public/data/maps/sinnoh/events/<id>_<name>.json   per-zone warps + trainers
 *                                                     (pixel coords baked in)
 *   public/data/maps/sinnoh/images/*.png              local PNG copies
 *                                                     (gitignored, uploaded to R2)
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
 * Required env vars:
 *   POKEMMO_MAPS_DIR   — root of the Pokémon Maps dump
 *   MAPS_IMAGE_HOST    — optional; base URL for image fetches (defaults to R2)
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

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
const PUBLIC_REGION_DIR    = path.join(ROOT, 'public', 'data', 'maps', 'sinnoh');
const PUBLIC_IMAGES_DIR    = path.join(PUBLIC_REGION_DIR, 'images');
const PUBLIC_EVENTS_DIR    = path.join(PUBLIC_REGION_DIR, 'events');
const PUBLIC_WALKABLE_DIR  = path.join(PUBLIC_REGION_DIR, 'walkable');
const PUBLIC_EVENT_MANIFESTS_DIR = path.join(PUBLIC_REGION_DIR, 'event-manifests');

const IMAGE_HOST = process.env.MAPS_IMAGE_HOST ?? 'https://pub-5fa7446d73c34538ae0c670b480e58a2.r2.dev';
const IMAGE_PREFIX = IMAGE_HOST
  ? `${IMAGE_HOST.replace(/\/+$/, '')}/sinnoh/images/`
  : 'data/maps/sinnoh/images/';

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

// "0003 - Jubilife City.png" → { id: 3, name: "Jubilife City" }
function parseZoneFilename(name) {
  const m = name.match(/^(\d+)\s*-\s*(.+?)\.(png|json)$/i);
  if (m) return { id: Number(m[1]), name: m[2].trim(), stem: name.replace(/\.(png|json)$/i, '') };
  if (/^overworld\.(png|json)$/i.test(name)) return { id: 'world', name: 'Sinnoh Overworld', stem: 'overworld' };
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
    mapsIndex.world = {
      displayName: 'Sinnoh Overworld',
      imageUrl: `${IMAGE_PREFIX}${webpName}`,
      imageWidth: sidecar.imageWidth,
      imageHeight: sidecar.imageHeight,
      type: 'overview',
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
    walkableJsonUrl = `data/maps/sinnoh/walkable/${walkBase}.json`;
    walkableRawUrl  = `data/maps/sinnoh/walkable/${walkBase}.raw.bin`;
    if (fs.existsSync(walkPngSrc)) {
      copyIfDifferent(walkPngSrc, path.join(PUBLIC_WALKABLE_DIR, `${walkBase}.png`));
      walkableUrl = `data/maps/sinnoh/walkable/${walkBase}.png`;
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
    eventsManifestUrl = `data/maps/sinnoh/event-manifests/${walkBase}.json`;
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
    eventsUrl: `data/maps/sinnoh/events/${eventsFile}`,
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
