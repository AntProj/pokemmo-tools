#!/usr/bin/env node
/**
 * build-map-data.mjs
 *
 * Generates the Unova map feature's static data from three raw sources:
 *
 *   PICTURES_DIR — rendered PNG maps + per-zone bounds JSON sidecars. The
 *                  Blender script renders every zone folder, so this is the
 *                  source of truth for "which detail maps exist". Naming:
 *                  0006_Striaton_City.png + 0006_Striaton_City.json. Plus the
 *                  world overview: unova_world.png + unova_world.json.
 *   ZONES_DIR    — one folder per zone, each containing a <Name>.json with
 *                  the zone's event lists (warps, trainers, items, signs, npcs).
 *                  Also holds unova_world.txt — newline-separated zone IDs
 *                  that participate in the assembled world overview render.
 *                  We use it ONLY to decide which zones get a clickable region
 *                  marker on the overview map. Detail maps come from Pictures.
 *   TRAINERS_DIR — trainers.json (master catalog) + sprites/0042.png style files
 *
 * Outputs (deterministic, idempotent):
 *   public/data/maps/maps-index.json        — master registry
 *   public/data/maps/world-regions.json     — clickable world overview regions
 *   public/data/maps/events/<id>_<name>.events.json — per-zone events
 *   public/data/maps/images/*.png           — copied verbatim
 *   public/data/maps/bounds/*.json          — copied verbatim
 *   public/data/trainers/trainers-catalog.json
 *   public/data/trainers/sprites/*.png      — copied verbatim
 *
 * Coordinate conversion (per the sidecar `note` field, with the Y sign flip
 * documented in the prompt — raw zone events use Pokemon's worldZ for the
 * ground plane, which becomes -Y after Blender's OBJ import):
 *
 *   pixelX = (worldX  - bounds.minX) / (bounds.maxX - bounds.minX) * imageWidth
 *   pixelY = imageHeight - ((-worldZ) - bounds.minY) / (bounds.maxY - bounds.minY) * imageHeight
 *
 * Run:  npm run build:map-data
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---------- Raw input paths (Windows absolute) ----------
const PICTURES_DIR = 'C:/Users/anten/Documents/test/Pictures';
const ZONES_DIR    = 'C:/Users/anten/Documents/test/zones';
const TRAINERS_DIR = 'C:/Users/anten/Documents/test/trainers';

// ---------- Output paths (relative to repo root) ----------
const PUBLIC_MAPS_DIR     = path.join(ROOT, 'public', 'data', 'maps');
const PUBLIC_IMAGES_DIR   = path.join(PUBLIC_MAPS_DIR, 'images');
const PUBLIC_BOUNDS_DIR   = path.join(PUBLIC_MAPS_DIR, 'bounds');
const PUBLIC_EVENTS_DIR   = path.join(PUBLIC_MAPS_DIR, 'events');
const PUBLIC_TRAINERS_DIR = path.join(ROOT, 'public', 'data', 'trainers');
const PUBLIC_TRAINER_SPRITES_DIR = path.join(PUBLIC_TRAINERS_DIR, 'sprites');

// ---------- URL prefix the deployed app uses to reach public assets ----------
// vite.config.js sets `base: '/pokemmo-tools/'`. The dev server respects it too,
// and the components fetch via `import.meta.env.BASE_URL` so we don't bake it
// into the JSON. URLs in generated files are root-relative to `public/`, i.e.
// they start with `data/maps/...` without a leading slash. The runtime
// prepends `import.meta.env.BASE_URL` (yields `/pokemmo-tools/` in prod and
// `/` in dev).
const URL_PREFIX = 'data/';

// ---------- Helpers ----------
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function writeJson(p, value) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(value, null, 2) + '\n');
}

// Copy file only if changed. Keeps the build idempotent and lets the user
// inspect modification times to see what actually moved.
function copyIfDifferent(src, dst) {
  ensureDir(path.dirname(dst));
  if (fs.existsSync(dst)) {
    const a = fs.statSync(src), b = fs.statSync(dst);
    if (a.size === b.size && a.mtimeMs <= b.mtimeMs) return false;
  }
  fs.copyFileSync(src, dst);
  return true;
}

// Pictures filenames: 0006_Striaton_City.png + .json or unova_world.png/.json
function parseStem(filename) {
  const m = filename.match(/^(\d{4})_(.+)\.(png|json)$/);
  if (m) return { kind: 'zone', id: Number(m[1]), idStr: m[1], name: m[2], stem: `${m[1]}_${m[2]}` };
  if (filename.startsWith('unova_world.')) return { kind: 'world', id: 'world', stem: 'unova_world' };
  return null;
}

// Convert world (X, worldZ) → pixel (px, py) using the zone's bounds sidecar.
// See the file-level comment for the formula derivation.
//
// IMPORTANT: rail-system warps and a handful of other entities in the raw data
// carry null world coords (the entity lives on the train graph or on an
// off-grid actor system, not a map tile). For those we return null pixels so
// the consumer can skip them as markers and surface them in a separate list.
function worldToPixel({ worldX, worldZ }, bounds) {
  if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) {
    return { pixelX: null, pixelY: null, offMap: true };
  }
  const { minX, maxX, minY, maxY } = bounds.worldBounds;
  const flippedY = -worldZ;
  const px = (worldX  - minX) / (maxX - minX) * bounds.imageWidth;
  const py = bounds.imageHeight - (flippedY - minY) / (maxY - minY) * bounds.imageHeight;
  return { pixelX: Math.round(px * 100) / 100, pixelY: Math.round(py * 100) / 100, offMap: false };
}

// ---------- Index raw inputs ----------
console.log('► Scanning raw inputs...');

const pictureFiles = fs.readdirSync(PICTURES_DIR);
const boundsByStem = {};    // stem → bounds JSON content
const pngByStem    = {};    // stem → png filename
for (const f of pictureFiles) {
  const parsed = parseStem(f);
  if (!parsed) continue;
  if (f.endsWith('.png'))  pngByStem[parsed.stem] = f;
  if (f.endsWith('.json')) boundsByStem[parsed.stem] = readJson(path.join(PICTURES_DIR, f));
}

// Zone event files: one per zone folder. Folder name is the canonical stem.
const zoneFolders = fs.readdirSync(ZONES_DIR).filter(d => {
  const full = path.join(ZONES_DIR, d);
  try { return fs.statSync(full).isDirectory(); } catch { return false; }
});
const eventsByStem = {};
for (const folder of zoneFolders) {
  const stemMatch = folder.match(/^(\d{4})_(.+)$/);
  if (!stemMatch) continue;
  const stem = `${stemMatch[1]}_${stemMatch[2]}`;
  const dir = path.join(ZONES_DIR, folder);
  // The event JSON inside is named <Name>.json (no zone-id prefix) — match
  // either the prefixed or the un-prefixed variant; whichever exists.
  const jsonName = fs.readdirSync(dir).find(f => f.endsWith('.json'));
  if (!jsonName) continue;
  try {
    eventsByStem[stem] = readJson(path.join(dir, jsonName));
  } catch (e) {
    console.warn(`  ✗ failed to parse ${folder}/${jsonName}: ${e.message}`);
  }
}

// Hand-curated warp position overrides. Used for rail-system warps whose raw
// data has null world coords (Victory Road, etc.) AND for synthesizing warps
// that don't exist in the raw event data due to asymmetric warp recording
// in the ROM (e.g. zone 136→214 exists but zone 214→136 is missing). Shape:
//
//   {
//     "<zoneId>": {
//       "<eventIndex>": [pixelX, pixelY],     // reposition an existing warp
//       ...
//       "_extraWarps": [                       // inject synthetic warps
//         { "destinationMapId": "136", "pixelX": 1195, "pixelY": 480,
//           "label": "To Pokémon League", "faceDirection": "NORTH" },
//         ...
//       ]
//     }
//   }
//
// Synthetic warps get ids `wEx0`, `wEx1`, ... and `synthetic: true` so the UI
// can label/style them differently if desired. Optional file — generator
// works without it.
const OVERRIDES_PATH = path.join(ROOT, 'data', 'raw', 'maps', 'warp-position-overrides.json');
let warpOverrides = {};
if (fs.existsSync(OVERRIDES_PATH)) {
  warpOverrides = readJson(OVERRIDES_PATH);
}

// unova_world.txt is a newline-separated list of zone IDs that participate
// in the assembled world overview render. Optional — if missing, every detail
// map gets a clickable region (legacy behaviour).
const worldListPath = path.join(ZONES_DIR, 'unova_world.txt');
let worldZoneIdSet = null;
if (fs.existsSync(worldListPath)) {
  const lines = fs.readFileSync(worldListPath, 'utf-8').split(/\r?\n/);
  worldZoneIdSet = new Set();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const id = Number(trimmed);
    if (Number.isFinite(id)) worldZoneIdSet.add(id);
  }
}

console.log(`  found ${Object.keys(pngByStem).length} rendered PNGs`);
console.log(`  found ${Object.keys(boundsByStem).length} bounds JSONs`);
console.log(`  found ${Object.keys(eventsByStem).length} zone event JSONs`);
console.log(`  unova_world.txt:    ${worldZoneIdSet ? `${worldZoneIdSet.size} zones in world overview` : 'missing — every detail map gets a region'}`);

// ---------- Build outputs ----------
ensureDir(PUBLIC_IMAGES_DIR);
ensureDir(PUBLIC_BOUNDS_DIR);
ensureDir(PUBLIC_EVENTS_DIR);
ensureDir(PUBLIC_TRAINER_SPRITES_DIR);

const mapsIndex = {};
const worldRegions = [];
const skipped = { noBounds: [], noPng: [], noEvents: [] };

let copiedImages = 0, copiedBounds = 0, writtenEvents = 0;

// World overview
if (boundsByStem['unova_world'] && pngByStem['unova_world']) {
  const stem = 'unova_world';
  if (copyIfDifferent(path.join(PICTURES_DIR, pngByStem[stem]), path.join(PUBLIC_IMAGES_DIR, pngByStem[stem]))) copiedImages++;
  const boundsName = `${stem}.json`;
  writeJson(path.join(PUBLIC_BOUNDS_DIR, boundsName), boundsByStem[stem]);
  copiedBounds++;
  mapsIndex.world = {
    displayName: 'Unova Region',
    imageUrl:  `${URL_PREFIX}maps/images/${pngByStem[stem]}`,
    boundsUrl: `${URL_PREFIX}maps/bounds/${boundsName}`,
    type: 'overview',
  };
}

// Iterate every stem that has a bounds JSON (the source of truth for which
// zones "exist" in the rendered set). A zone with bounds but no PNG is
// reported as a skip; same for no events.
const detailStems = Object.keys(boundsByStem)
  .filter(s => s !== 'unova_world')
  .sort();

for (const stem of detailStems) {
  const bounds = boundsByStem[stem];
  const png    = pngByStem[stem];
  const events = eventsByStem[stem];
  const stemMatch = stem.match(/^(\d{4})_(.+)$/);
  if (!stemMatch) continue;
  const zoneId = Number(stemMatch[1]);
  const displayName = stemMatch[2].replace(/_/g, ' ');

  if (!png) { skipped.noPng.push(stem); continue; }

  // Copy image + bounds
  if (copyIfDifferent(path.join(PICTURES_DIR, png), path.join(PUBLIC_IMAGES_DIR, png))) copiedImages++;
  const boundsName = `${stem}.json`;
  writeJson(path.join(PUBLIC_BOUNDS_DIR, boundsName), bounds);
  copiedBounds++;

  // Build map index entry
  const entry = {
    displayName: events?.displayName || displayName,
    imageUrl:  `${URL_PREFIX}maps/images/${png}`,
    boundsUrl: `${URL_PREFIX}maps/bounds/${boundsName}`,
    type: 'detail',
    zoneId,
  };

  // Build per-zone events file (if zone JSON exists)
  if (events) {
    // Pull this zone's override block once. Each entry maps eventIndex → [px, py].
    const zoneOverrides = warpOverrides[String(zoneId)] || {};

    const xform = (raw, idPrefix) => ({
      id: `${idPrefix}${raw.eventIndex ?? raw.uid ?? 0}`,
      worldX: raw.worldX,
      worldZ: raw.worldZ,
      ...worldToPixel({ worldX: raw.worldX, worldZ: raw.worldZ }, bounds),
    });

    // Apply hand-curated overrides to warps. Other entity types could be
    // overridden too, but rail-system entities are warp-only in the current
    // dataset — keep the scope tight until that changes.
    const applyOverride = (entity, raw) => {
      const key = String(raw.eventIndex);
      if (Object.prototype.hasOwnProperty.call(zoneOverrides, key)) {
        const [px, py] = zoneOverrides[key];
        return { ...entity, pixelX: px, pixelY: py, offMap: false, overridden: true };
      }
      return entity;
    };

    const warps = (events.warps || []).map(w => ({
      ...applyOverride(xform(w, 'w'), w),
      destinationMapId: w.destinationZoneId != null ? String(w.destinationZoneId) : null,
      destinationLabel: w.destinationZoneId != null ? `Zone ${w.destinationZoneId}` : null,
      faceDirection: w.faceDirection || null,
      transitionType: w.transitionType ?? null,
    }));

    // Synthetic warps: inject any "_extraWarps" entries from the override file.
    // Used to patch asymmetric warp gaps in the raw event data (e.g. zone
    // 214 → 136 is missing from the ROM extract even though 136 → 214 exists).
    const extraWarps = Array.isArray(zoneOverrides._extraWarps) ? zoneOverrides._extraWarps : [];
    extraWarps.forEach((extra, i) => {
      warps.push({
        id: `wEx${i}`,
        worldX: null,
        worldZ: null,
        pixelX: extra.pixelX,
        pixelY: extra.pixelY,
        offMap: false,
        synthetic: true,
        destinationMapId: extra.destinationMapId != null ? String(extra.destinationMapId) : null,
        destinationLabel: extra.label || (extra.destinationMapId != null ? `Zone ${extra.destinationMapId}` : null),
        faceDirection: extra.faceDirection || null,
        transitionType: extra.transitionType ?? null,
      });
    });

    const trainers = (events.trainers || []).map(t => ({
      ...xform(t, 't'),
      spriteId: t.spriteId ?? null,
      spritePath: t.spriteId != null ? `${URL_PREFIX}trainers/sprites/${String(t.spriteId).padStart(4, '0')}.png` : null,
      trainerId: t.trainerId ?? null,
      visionRange: t.visionRange ?? null,
      faceDirection: t.rotationY != null ? rotationToFace(t.rotationY) : null,
    }));

    const items = (events.items || []).map(i => ({
      ...xform(i, 'i'),
      spriteId: i.spriteId ?? null,
      itemId: i.itemId ?? null,
      isHidden: !!i.isHidden,
    }));

    const signs = (events.signs || []).map(s => ({
      ...xform(s, 's'),
      signType: s.signType ?? null,
      textContent: s.textContent ?? null,
    }));

    const npcs = (events.npcs || []).map(n => ({
      ...xform(n, 'n'),
      spriteId: n.spriteId ?? null,
      spritePath: n.spriteId != null ? `${URL_PREFIX}trainers/sprites/${String(n.spriteId).padStart(4, '0')}.png` : null,
      faceDirection: n.rotationY != null ? rotationToFace(n.rotationY) : null,
    }));

    const eventsOut = {
      mapId: String(zoneId),
      displayName: entry.displayName,
      warps, trainers, items, signs, npcs,
    };
    const eventsName = `${stem}.events.json`;
    writeJson(path.join(PUBLIC_EVENTS_DIR, eventsName), eventsOut);
    entry.eventsUrl = `${URL_PREFIX}maps/events/${eventsName}`;
    writtenEvents++;
  } else {
    skipped.noEvents.push(stem);
  }

  mapsIndex[String(zoneId)] = entry;

  // World region marker — only emit for zones the world overview actually
  // assembled (per unova_world.txt). Detail maps not in that list are still
  // reachable via warps from other maps, just not clickable on the overview.
  if (!worldZoneIdSet || worldZoneIdSet.has(zoneId)) {
    const { minX, maxX, minY, maxY } = bounds.worldBounds;
    const centerWorldX = (minX + maxX) / 2;
    const centerWorldY = (minY + maxY) / 2;
    const worldRadius  = Math.max(maxX - minX, maxY - minY) / 2;
    worldRegions.push({
      mapId: String(zoneId),
      displayName: entry.displayName,
      centerWorldX,
      centerWorldY,
      worldRadius,
    });
  }
}

// ---------- Trainer catalog + sprite copy ----------
console.log('► Copying trainer sprites...');

const trainersRaw = readJson(path.join(TRAINERS_DIR, 'trainers.json'));
const trainerEntries = Array.isArray(trainersRaw.trainers) ? trainersRaw.trainers : [];

const trainersCatalog = {
  trainers: trainerEntries.map(t => ({
    spriteId: t.spriteId,
    spritePath: t.spritePath
      ? `${URL_PREFIX}trainers/sprites/${String(t.spriteId).padStart(4, '0')}.png`
      : null,
    trainerId: t.trainerId,
    displayName: t.displayName,
    trainerClass: t.trainerClass,
    trainerClassId: t.trainerClassId,
    team: t.team,
    appearsInZones: t.appearsInZones || [],
    firstSeenZoneId: t.firstSeenZoneId,
    totalAppearances: t.totalAppearances || 0,
    commonMovementType: t.commonMovementType,
  })),
};
writeJson(path.join(PUBLIC_TRAINERS_DIR, 'trainers-catalog.json'), trainersCatalog);

let copiedSprites = 0;
const trainerSpritesIn = path.join(TRAINERS_DIR, 'sprites');
if (fs.existsSync(trainerSpritesIn)) {
  for (const f of fs.readdirSync(trainerSpritesIn)) {
    if (!f.endsWith('.png')) continue;
    if (copyIfDifferent(path.join(trainerSpritesIn, f), path.join(PUBLIC_TRAINER_SPRITES_DIR, f))) copiedSprites++;
  }
}

// ---------- Write index + regions ----------
writeJson(path.join(PUBLIC_MAPS_DIR, 'maps-index.json'), mapsIndex);
writeJson(path.join(PUBLIC_MAPS_DIR, 'world-regions.json'), { regions: worldRegions });

// ---------- Summary ----------
console.log('► Done.');
console.log(`  maps in index:     ${Object.keys(mapsIndex).length}`);
console.log(`  world regions:     ${worldRegions.length}`);
console.log(`  per-zone events:   ${writtenEvents}`);
console.log(`  images copied:     ${copiedImages}`);
console.log(`  bounds copied:     ${copiedBounds}`);
console.log(`  trainer sprites:   ${copiedSprites}`);
console.log(`  catalog trainers:  ${trainersCatalog.trainers.length}`);
if (skipped.noPng.length)    console.log(`  skipped (no PNG):    ${skipped.noPng.length}`);
if (skipped.noEvents.length) console.log(`  skipped (no events): ${skipped.noEvents.length}`);

// ---------- Helpers ----------
function rotationToFace(deg) {
  // Pokémon facing: 0=south, 90=east, 180=west, 270=north (Y-axis Euler).
  // Convention varies; we expose it raw + a labelled hint.
  const r = ((deg % 360) + 360) % 360;
  if (r < 45 || r >= 315) return 'SOUTH';
  if (r < 135) return 'WEST';
  if (r < 225) return 'NORTH';
  return 'EAST';
}
