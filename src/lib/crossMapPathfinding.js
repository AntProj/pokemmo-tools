// src/lib/crossMapPathfinding.js
//
// Hierarchical A* for cross-zone routing in Sinnoh.
//
// Two-level search:
//   Level 1 — zone-graph A*: states are `(zoneId, tile)`. Transitions are
//     either (a) take a warp from the current zone (cost = Manhattan
//     distance from current tile to the warp's exit tile + 1), or (b)
//     walk to the goal tile if we're already in the goal zone (cost =
//     Manhattan distance). Heuristic is the Manhattan distance to the
//     goal tile when in the goal zone, otherwise 0 (we'd need a global
//     coordinate system to do better; the zone-graph hop count is
//     implicit in the per-warp +1).
//
//   Level 2 — per-zone tile A*: for each segment produced by level 1
//     (a zone, an entry tile, and an exit tile or goal), run the standard
//     `aStar()` from `./pathfinding.js` to get the actual tile-by-tile
//     path inside that zone. Walkability data is fetched lazily and
//     cached for the duration of the cross-zone query.
//
// The zone graph itself is the static `zone-graph.json` emitted by
// `scripts/build-map-data.mjs` (492 zones, 1189 warp edges in Sinnoh).
// A* runs over ~50 KB of in-memory data per query; per-zone walkability
// fetches are ~5-10 KB each, lazy-loaded.

import { loadWalkability, computeBridgeAxes, aStar } from './pathfinding.js';

const manhattan = (a, b) => Math.abs(a.tx - b.tx) + Math.abs(a.ty - b.ty);
const stateKey = (zoneId, tile) => `${zoneId}|${tile.tx},${tile.ty}`;

// HM-clearable obstacles are sprite events (REACT_WALKABILITY.md §4).
// Same OW filename → semantic mapping as SinnohMap.jsx's eventHmSemantic.
function eventHmSemantic(spriteFile) {
  if (typeof spriteFile !== 'string') return null;
  const m = spriteFile.match(/^ow_(\d{4})/);
  if (!m) return null;
  switch (m[1]) {
    case '0082': return 'strength_boulder';
    case '0083': return 'rock_smashable';
    case '0084': return 'cut_tree';
    default:     return null;
  }
}

// Build the per-zone blocked-tile set + Strength boulder list from a
// loaded events manifest. Mirrors the logic in SinnohMap.jsx's
// `blockedTileSet` + `eventBoulders` useMemos, kept identical so
// cross-zone segments respect the same HM toggles + event-blocking
// behavior as single-zone pathfinding.
function buildBlockingFromManifest(manifest, walkMeta, entryType, opts) {
  const blocked = new Set();
  const boulders = [];
  if (!manifest || !walkMeta) return { blocked, boulders };
  const stride = walkMeta.tilePxOnVisibleMap ?? 16;
  const isOverworld = entryType === 'overworld';
  const footOffsetY = isOverworld ? 17 : 1;
  const W = walkMeta.tilesWidth;
  const H = walkMeta.tilesHeight;
  for (const ev of (manifest.events || [])) {
    if (!ev.pixelCoord) continue;
    const hm = eventHmSemantic(ev.spriteFile);
    if (hm === 'strength_boulder') {
      const yOffset = ev.anchor === 'foot' ? footOffsetY : 0;
      const tx = Math.floor(ev.pixelCoord.x / stride);
      const ty = Math.floor((ev.pixelCoord.y - yOffset) / stride);
      if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
      boulders.push({ tx, ty });
      continue;
    }
    if (hm === 'rock_smashable' && opts.rockSmashAvailable) continue;
    if (hm === 'cut_tree'       && opts.cutAvailable)       continue;
    const yOffset = ev.anchor === 'foot' ? footOffsetY : 0;
    const tx = Math.floor(ev.pixelCoord.x / stride);
    const ty = Math.floor((ev.pixelCoord.y - yOffset) / stride);
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
    blocked.add(ty * W + tx);
  }
  return { blocked, boulders };
}

/**
 * Find a sequence of zone segments connecting (startZone, startTile) to
 * (goalZone, goalTile). Uses Manhattan distance for in-zone segment cost
 * estimates and per-warp +1 for transitions. The result is a high-level
 * route — each segment needs `computeSegmentPaths` to flesh out tile-by-tile.
 *
 * @param {object} graph         loaded `zone-graph.json`
 * @param {number|string} startZone
 * @param {{tx, ty}} startTile
 * @param {number|string} goalZone
 * @param {{tx, ty}} goalTile
 * @returns {Array<Segment> | null}
 *   Segment shape: {
 *     zoneId, fromTile, toTile,
 *     exitsViaWarp?: { warpId, fromTile, toZone, toTile },   // present except for the last segment
 *     isFinal?: boolean,                                      // present on the last segment only
 *   }
 *   null if no route exists.
 */
export function findCrossZoneRoute(graph, startZone, startTile, goalZone, goalTile) {
  const startZ = String(startZone), goalZ = String(goalZone);

  if (startZ === goalZ && startTile.tx === goalTile.tx && startTile.ty === goalTile.ty) {
    return [];
  }

  const startKey = stateKey(startZ, startTile);
  const gScore = new Map();
  const cameFrom = new Map();          // stateKey → { prev: stateKey, edge: 'warp' | 'final', warp? }
  const stateInfo = new Map();         // stateKey → { zone, tile }

  gScore.set(startKey, 0);
  stateInfo.set(startKey, { zone: startZ, tile: startTile });

  // Min-heap on fScore. Entries: [fScore, stateKey].
  const heap = [[manhattan(startTile, goalTile), startKey]];
  const heapPush = (entry) => {
    heap.push(entry);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const heapPop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0, n = heap.length;
      while (true) {
        const l = 2 * i + 1, r = 2 * i + 2;
        let s = i;
        if (l < n && heap[l][0] < heap[s][0]) s = l;
        if (r < n && heap[r][0] < heap[s][0]) s = r;
        if (s === i) break;
        [heap[i], heap[s]] = [heap[s], heap[i]];
        i = s;
      }
    }
    return top;
  };

  let expansions = 0;
  const MAX_EXPANSIONS = 10000;        // ~20× larger than typical Sinnoh routes

  while (heap.length > 0) {
    if (expansions++ > MAX_EXPANSIONS) {
      console.warn('[crossZone] hit MAX_EXPANSIONS — abandoning');
      return null;
    }
    const [, key] = heapPop();
    const state = stateInfo.get(key);
    const { zone: Z, tile: T } = state;
    const curG = gScore.get(key);

    // Goal check.
    if (Z === goalZ && T.tx === goalTile.tx && T.ty === goalTile.ty) {
      return reconstruct(cameFrom, stateInfo, key);
    }

    // Successor 1: if we're in the goal zone, "walk to goal" as a direct
    // edge. Cost = Manhattan(current tile, goal tile).
    if (Z === goalZ) {
      const goalKey = stateKey(Z, goalTile);
      const newG = curG + manhattan(T, goalTile);
      if (!gScore.has(goalKey) || newG < gScore.get(goalKey)) {
        gScore.set(goalKey, newG);
        cameFrom.set(goalKey, { prev: key, edge: 'final' });
        stateInfo.set(goalKey, { zone: Z, tile: goalTile });
        heapPush([newG, goalKey]);
      }
    }

    // Successor 2: take each outgoing warp.
    const warps = graph.zones?.[Z]?.warps || [];
    for (const w of warps) {
      const newKey = stateKey(String(w.toZone), w.toTile);
      // Cost = walk to warp + 1 per warp (a fixed cost so the search
      // prefers fewer warp transitions when paths have similar total
      // distance).
      const newG = curG + manhattan(T, w.fromTile) + 1;
      if (gScore.has(newKey) && newG >= gScore.get(newKey)) continue;
      gScore.set(newKey, newG);
      cameFrom.set(newKey, { prev: key, edge: 'warp', warp: w });
      stateInfo.set(newKey, { zone: String(w.toZone), tile: w.toTile });
      const h = String(w.toZone) === goalZ ? manhattan(w.toTile, goalTile) : 0;
      heapPush([newG + h, newKey]);
    }
  }

  return null;       // unreachable
}

function reconstruct(cameFrom, stateInfo, finalKey) {
  const segments = [];
  let key = finalKey;
  while (true) {
    const edge = cameFrom.get(key);
    if (!edge) break;
    const prev = stateInfo.get(edge.prev);
    const curr = stateInfo.get(key);
    if (edge.edge === 'warp') {
      segments.unshift({
        zoneId: prev.zone,
        fromTile: prev.tile,
        toTile: edge.warp.fromTile,
        exitsViaWarp: {
          warpId: edge.warp.warpId,
          fromTile: edge.warp.fromTile,
          toZone: String(edge.warp.toZone),
          toTile: edge.warp.toTile,
        },
      });
    } else if (edge.edge === 'final') {
      segments.unshift({
        zoneId: prev.zone,
        fromTile: prev.tile,
        toTile: curr.tile,
        isFinal: true,
      });
    }
    key = edge.prev;
  }
  return segments;
}

/**
 * For each segment from `findCrossZoneRoute`, run per-zone tile A* to
 * compute the actual tile-by-tile path. Walkability data is fetched
 * lazily and cached for the duration of this call.
 *
 * @param {Array<Segment>} segments
 * @param {object} mapsIndex                    loaded maps-index.json
 * @param {(p: string) => string} asset         URL resolver (prepends Vite BASE_URL)
 * @param {object} aStarOpts                    HM toggles, blocked tiles, etc.
 * @returns {Promise<Array<DetailedSegment>>}
 *   DetailedSegment extends Segment with:
 *     path:     Array<{tx,ty}> | null
 *     pushes:   Array<{...}>
 *     walk?:    loaded walkability object (cached, kept on the segment
 *               so the UI can use it for tile→pixel conversion)
 *     error?:   string (e.g. 'no walkability data')
 */
export async function computeSegmentPaths(segments, mapsIndex, asset, aStarOpts = {}) {
  // Walkability + manifest caches shared across segments in this query.
  // Cross-zone routes often revisit the same hub zone (e.g., Jubilife as
  // a pass-through to Route 218 and Route 202), and Sinnoh's overworld
  // zones are commonly revisited within a single planning session.
  const walkCache = new Map();
  const manifestCache = new Map();

  async function getZoneData(zoneId) {
    if (walkCache.has(zoneId)) return walkCache.get(zoneId);
    const entry = mapsIndex[zoneId];
    if (!entry?.walkableRawUrl || !entry?.walkableJsonUrl) {
      walkCache.set(zoneId, null);
      return null;
    }
    try {
      const walk = await loadWalkability(asset(entry.walkableRawUrl), asset(entry.walkableJsonUrl));
      const bridge = computeBridgeAxes(walk);
      const data = { walk, bridge, entry };
      walkCache.set(zoneId, data);
      return data;
    } catch (e) {
      console.warn('[crossZone] failed to load walkability for zone', zoneId, e);
      walkCache.set(zoneId, null);
      return null;
    }
  }

  async function getManifest(zoneId) {
    if (manifestCache.has(zoneId)) return manifestCache.get(zoneId);
    const entry = mapsIndex[zoneId];
    if (!entry?.eventsManifestUrl) {
      manifestCache.set(zoneId, null);
      return null;
    }
    try {
      const m = await fetch(asset(entry.eventsManifestUrl)).then(r => r.json());
      manifestCache.set(zoneId, m);
      return m;
    } catch (e) {
      console.warn('[crossZone] failed to load events manifest for zone', zoneId, e);
      manifestCache.set(zoneId, null);
      return null;
    }
  }

  // `blockEvents` toggle from the caller (default ON — match single-zone
  // pathfinding default). When ON, fetch the events manifest for each
  // zone in the route, build the blocked-tile set + Strength boulder
  // list, and pass them to per-segment aStar.
  const blockEvents = aStarOpts.blockEvents !== false;

  const out = [];
  for (const seg of segments) {
    const data = await getZoneData(seg.zoneId);
    if (!data) {
      out.push({ ...seg, path: null, pushes: [], error: 'no walkability data' });
      continue;
    }

    let segBlocked = null;
    let segBoulders = [];
    if (blockEvents) {
      const manifest = await getManifest(seg.zoneId);
      const { blocked, boulders } = buildBlockingFromManifest(
        manifest, data.walk.meta, data.entry.type, aStarOpts
      );
      segBlocked = blocked;
      segBoulders = boulders;
    }

    const result = aStar(data.walk, data.bridge, seg.fromTile, seg.toTile, {
      ...aStarOpts,
      blocked: segBlocked,
      boulders: segBoulders,
    });
    out.push({
      ...seg,
      walk: data.walk,
      bridge: data.bridge,
      path: result?.path || null,
      pushes: result?.pushes || [],
    });
  }
  return out;
}
