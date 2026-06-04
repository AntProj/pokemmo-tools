// src/lib/pathfinding.js
//
// Walkability decoder + A* pathfinder for the Sinnoh interactive map.
//
// PRIMARY data contract (REACT_WALKABILITY.md §3, 2026-05):
//   .raw.bin  — bit-for-bit dump of the ROM's (type, collision) byte pairs,
//               row-major, two bytes per tile.
//   .json     — metadata + `typeByteMap` and `collisionByteMap` lookup
//               tables (byte → semantic name).
//
// We read the raw bytes directly and translate to semantic names via the
// JSON tables — no PNG decode in the A* path, no palette colour round trip.
// The walkability PNG is still emitted by DSPRE as a debug visualization,
// but it's no longer authoritative; if the PNG and the raw bin disagree the
// raw bin wins.
//
// Pipeline:
//   1. `loadWalkability(rawUrl, jsonUrl)` fetches both files in parallel and
//      returns `{ meta, raw, W, H }` — no decoding, no canvas.
//   2. `computeBridgeAxes(walk)` runs neighbor analysis on the bridge tiles
//      (typeByte == 0x16) at load time to pre-classify each bridge tile as
//      horizontal / vertical / ambiguous. (The ROM doesn't store axis;
//      neighbor count is the way.)
//   3. `aStar(walk, bridgeAxes, start, goal, opts)` runs 4-connected A* on
//      the grid, calling per-tile semantic lookups inline.
//   4. Caller converts the returned (tx, ty) tile sequence to Leaflet
//      lat/lng via `tileToPixelCenter` for rendering as a polyline.

import { TYPE_BYTE_OVERRIDES } from './walkability-overrides.js';

// ----- semantic-name helpers -----

// Canonical key shape for the JSON byte maps: "0xHH" uppercase, zero padded.
export function hexKey(b) {
  return `0x${b.toString(16).toUpperCase().padStart(2, '0')}`;
}

// Ledge type bytes — three groups, all sharing the same 4-direction layout
// (REACT_WALKABILITY.md §4). IMPORTANT: ledges are stored with
// `collisionByte == 0x80` in the ROM (logically "impassable except via
// directional jump"). Branch on the type byte first; the collision byte
// alone would mislabel every ledge as a wall.
export const LEDGE_TYPE_BYTES = new Set([
  0x30, 0x31, 0x32, 0x33,   // DP-era
  0x38, 0x39, 0x3A, 0x3B,   // Platinum-era (most common)
  0x3C, 0x3D, 0x3E,         // variant / tall ledges (direction TBD)
]);

/**
 * Set of type bytes that act as DIRECTIONAL bridges in this zone — i.e.
 * tiles where A* must gate entry by axis (can't step on from a perpendicular
 * direction). Built by scanning the (override-merged) typeByteMap for any
 * label whose name contains "bridge" but NOT "walkable".
 *
 * The distinction matters: the canonical byte `0x16` is typically labeled
 * `bridge_walkable` and represents OUTSIDE-WORLD bridges, which behave like
 * plain walkable terrain — no axis constraint, no surfing underneath, no
 * differentiation from regular floor. Only CAVE bridges (encoded in Victory
 * Road with bytes 0x70/0x72, label `bridge_cave`) are directional.
 *
 * Naming convention enforced here:
 *   - `bridge`, `bridge_cave`, `bridge_horizontal`, etc. → directional
 *   - `bridge_walkable` (or anything with "walkable" in the name) → plain
 *     walkable, NOT in this set, no axis gating.
 *
 * Returns a Set<number> for O(1) lookups inside hot A* loops.
 */
export function bridgeTypeBytes(meta) {
  const set = new Set();
  for (const [k, name] of Object.entries(meta?.typeByteMap || {})) {
    if (typeof name !== 'string') continue;
    if (/bridge/i.test(name) && !/walkable/i.test(name)) {
      set.add(parseInt(k, 16));
    }
  }
  return set;
}

// Collision byte for "impassable". The only blocking value in DPPt vanilla.
export const COLLISION_BLOCKED = 0x80;

/** Raw bytes at (tx, ty). No semantic translation. */
export function tileBytes(walk, tx, ty) {
  const i = (ty * walk.W + tx) * 2;
  return { typeByte: walk.raw[i], collisionByte: walk.raw[i + 1] };
}

/** Bytes + their semantic names from the sidecar's byte maps. */
export function tileSemantic(walk, tx, ty) {
  const { typeByte, collisionByte } = tileBytes(walk, tx, ty);
  return {
    typeByte,
    collisionByte,
    typeName:      walk.meta.typeByteMap?.[hexKey(typeByte)],
    collisionName: walk.meta.collisionByteMap?.[hexKey(collisionByte)],
  };
}

/**
 * "Is this tile an effective wall for A*?" — true iff the ROM marks it
 * blocked AND the type byte isn't a ledge (ledges always carry collision
 * 0x80 even though they're traversable in a single direction).
 */
export function effectiveBlocked(typeByte, collisionByte) {
  if (LEDGE_TYPE_BYTES.has(typeByte)) return false;
  return collisionByte === COLLISION_BLOCKED;
}

// ----- loader -----

/**
 * Fetches a walkability sidecar (.raw.bin + .json). The raw bytes are the
 * source of truth; semantics come from `meta.typeByteMap` and
 * `meta.collisionByteMap`.
 *
 * @param {string} rawUrl   URL of the .raw.bin file
 * @param {string} jsonUrl  URL of the metadata JSON
 * @returns {Promise<{meta: object, raw: Uint8Array, W: number, H: number}>}
 */
export async function loadWalkability(rawUrl, jsonUrl) {
  const [rawRes, metaRes] = await Promise.all([
    fetch(rawUrl),
    fetch(jsonUrl),
  ]);
  if (!rawRes.ok)  throw new Error(`walkability raw.bin fetch failed: ${rawUrl} → ${rawRes.status}`);
  if (!metaRes.ok) throw new Error(`walkability JSON fetch failed:    ${jsonUrl} → ${metaRes.status}`);

  const [rawBuf, meta] = await Promise.all([rawRes.arrayBuffer(), metaRes.json()]);
  const raw = new Uint8Array(rawBuf);

  // Apply local user overrides on top of the JSON's typeByteMap (see
  // walkability-overrides.js). User entries WIN — handy when the exporter
  // hasn't classified a byte yet (e.g. cave-bridge bytes 0x70/0x72 in
  // Victory Road) or has the wrong label. We non-destructively mutate a
  // shallow clone so we don't pollute the original JSON in memory.
  const mergedTypeByteMap = { ...(meta.typeByteMap || {}) };
  let overrideHits = 0;
  for (const [byteStr, name] of Object.entries(TYPE_BYTE_OVERRIDES)) {
    const k = hexKey(Number(byteStr));
    if (mergedTypeByteMap[k] !== name) overrideHits++;
    mergedTypeByteMap[k] = name;
  }
  if (overrideHits) {
    console.debug('[walkability] applied', overrideHits, 'override(s) over typeByteMap');
  }
  meta.typeByteMap = mergedTypeByteMap;

  const W = meta.tilesWidth | 0;
  const H = meta.tilesHeight | 0;
  const expected = W * H * 2;
  if (raw.length !== expected) {
    console.warn('[walkability] raw.bin size mismatch', {
      header: meta.header?.mapName, expected, actual: raw.length, W, H,
    });
  }

  // Sanity check: typeByteMap / collisionByteMap should be present. Sidecars
  // from before the 2026-05 refactor don't include them — those need to be
  // re-exported. Log loudly so we notice in dev.
  if (!meta.typeByteMap || !meta.collisionByteMap) {
    console.warn('[walkability] sidecar is missing typeByteMap / collisionByteMap', {
      header: meta.header?.mapName,
      hasTypeByteMap:      !!meta.typeByteMap,
      hasCollisionByteMap: !!meta.collisionByteMap,
    });
  }

  // Type-byte histogram by semantic name. Surfaces "no bridges detected" /
  // "0 ledges in zone" etc. before A* runs, so we can distinguish exporter
  // output issues from A*-side rule bugs.
  if (typeof console !== 'undefined') {
    const counts = {};
    const typeMap = meta.typeByteMap || {};
    for (let i = 0; i < raw.length; i += 2) {
      const key  = hexKey(raw[i]);
      const name = typeMap[key] || `unmapped_${key}`;
      counts[name] = (counts[name] || 0) + 1;
    }
    console.debug('[walkability] type-byte histogram:', counts);
  }

  return { meta, raw, W, H };
}

// ----- bridge axis derivation (REACT_WALKABILITY.md §4 / §6) -----

/**
 * For each bridge tile in the zone, classify the axis by flood-filling
 * connected bridge regions and assigning each region's axis from its
 * bounding-box aspect ratio (wider → horizontal, taller → vertical,
 * square → ambiguous). Non-bridge tiles get `null`.
 *
 * Why flood-fill + bounding box instead of per-tile neighbor counts:
 *   For a bridge wider than 2 tiles, *interior* tiles have bridge neighbors
 *   on all 4 sides, so a 4-neighbor count produces equal h/v and the tile
 *   is classified `'ambiguous'` — A* would then treat it as unconstrained
 *   floor and the bridge's perpendicular gating would silently fail. By
 *   measuring the region's overall extent we get the right axis for every
 *   tile in a 3+, 4+, N-wide bridge.
 *
 * "Bridge tile" is any tile whose type byte is in the zone's bridge byte
 * set — built from typeByteMap labels containing "bridge" but not
 * "walkable" (see `bridgeTypeBytes`).
 *
 * Pre-computed once per zone — A* indexes O(1).
 *
 * @param {{meta, raw, W, H}} walk
 * @returns {{
 *   axes:  (null | 'horizontal' | 'vertical' | 'ambiguous')[],   // length W*H
 *   bytes: Set<number>,                                          // zone bridge bytes
 * }}
 */
export function computeBridgeAxes(walk) {
  const { W, H, raw, meta } = walk;
  const bytes = bridgeTypeBytes(meta);
  const axes = new Array(W * H).fill(null);
  // Tiles where a non-bridge tile may transition INTO the bridge (and
  // vice versa). Anything not in this set is a bridge-interior tile —
  // can only be entered from another bridge tile in the same component.
  // Populated alongside axes during the flood-fill pass. See "entry/exit
  // gating" in aStar below.
  const entryTiles = new Set();
  // STAIR TILES — non-bridge tiles that the walkability data marks as
  // walls (collisionByte 0x80 + typeByte_walkable) but which are
  // physically walkable in-game because they're staircases adjacent to
  // bridge_steps tiles. Sunyshore's elevated walkways are accessed this
  // way: the actual ramp surface is data-flagged as a wall, but the game
  // lets the player walk up it. We treat such tiles as walkable wherever
  // they're adjacent to a `bridge_steps` (0x73) tile. This is an
  // exporter-bug workaround scoped to a very specific data pattern.
  const stairTiles = new Set();
  const visited = new Uint8Array(W * H);

  // Pre-pass: find all bridge_steps tiles in the zone, then mark any
  // wall-labeled-walkable tile adjacent to one as a stair tile.
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      const i = (ty * W + tx) * 2;
      const tb = raw[i];
      const name = meta?.typeByteMap?.[hexKey(tb)];
      if (typeof name !== 'string' || !name.includes('step')) continue;
      // Found a bridge_steps tile. Scan neighbors for stair candidates.
      for (const [ndx, ndy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nnx = tx + ndx, nny = ty + ndy;
        if (nnx < 0 || nny < 0 || nnx >= W || nny >= H) continue;
        const ni = (nny * W + nnx) * 2;
        const ntb = raw[ni], ncb = raw[ni + 1];
        if (bytes.has(ntb)) continue;          // bridge neighbor, skip
        if (ncb !== 0x80) continue;            // not a "wall" collision
        const nname = meta?.typeByteMap?.[hexKey(ntb)];
        if (nname !== 'walkable') continue;    // only walkable-typed walls
        stairTiles.add(nny * W + nnx);
      }
    }
  }

  let totalBridges = 0, horiz = 0, vert = 0, ambig = 0, regions = 0;

  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      const sIdx = ty * W + tx;
      if (visited[sIdx]) continue;
      if (!bytes.has(raw[sIdx * 2])) continue;

      // 4-connected flood fill to collect all tiles in this bridge region.
      // BFS with a head-only queue (cheap on small grids; the largest
      // walkability is well under 10k tiles).
      const regionTiles = [];
      let minX = tx, maxX = tx, minY = ty, maxY = ty;
      const queue = [sIdx];
      visited[sIdx] = 1;
      while (queue.length) {
        const idx = queue.pop();
        const cx = idx % W;
        const cy = (idx - cx) / W;
        regionTiles.push(idx);
        if (cx < minX) minX = cx; else if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy; else if (cy > maxY) maxY = cy;
        // Expand to 4 orthogonal neighbors if they're also bridge tiles.
        const tryPush = (nx, ny) => {
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) return;
          const ni = ny * W + nx;
          if (visited[ni]) return;
          if (!bytes.has(raw[ni * 2])) return;
          visited[ni] = 1;
          queue.push(ni);
        };
        tryPush(cx + 1, cy);
        tryPush(cx - 1, cy);
        tryPush(cx, cy + 1);
        tryPush(cx, cy - 1);
      }

      const regionW = maxX - minX + 1;
      const regionH = maxY - minY + 1;
      const longSide  = Math.max(regionW, regionH);
      const shortSide = Math.min(regionW, regionH);
      const ratio = shortSide === 0 ? 1 : longSide / shortSide;

      // Only assign a directional axis when the connected component is
      // clearly anisotropic (long-thin shape). Roughly-square networks —
      // Sunyshore solar-panel walkways (40×47), branched bridge platforms,
      // square boardwalks — get `'ambiguous'`, meaning A* can traverse
      // them freely without axis gating. This avoids the failure mode
      // where a complex network's bounding box mis-implies a single axis
      // for the whole shape, making lateral movement across the network
      // detour to the network's edge.
      //
      // Threshold 1.5: 4×2 (ratio 2) → axis-gated, 3×2 (ratio 1.5) →
      // ambiguous, 8×2 (ratio 4) → axis-gated. Long thin spans (Cycling
      // Road 8×86 ratio 10.75, Route 207 2×8 ratio 4, single-tile-wide
      // bridges with ratio N) all stay correctly axis-gated.
      const AXIS_RATIO_THRESHOLD = 1.5;
      let axis;
      if (ratio <= AXIS_RATIO_THRESHOLD) {
        axis = 'ambiguous';
      } else {
        axis = regionW > regionH ? 'horizontal' : 'vertical';
      }

      // Mark entry tiles using a hybrid rule per component shape:
      //
      // ANISOTROPIC components (long-thin shapes — Route 207's 2×8 cave
      // bridge, Cycling Road's 8×88 vertical span): entry tiles are the
      // bridge tiles at the EXTREMES of the long axis (top/bottom row for
      // vertical, left/right column for horizontal). The bridge's natural
      // "ends" where it meets land. Anywhere else on the long sides is
      // pass-under territory.
      //
      // AMBIGUOUS components (Sunyshore solar-panel network, branched
      // bridge platforms): entry requires BOTH a `bridge_steps` (0x73)
      // tile nearby AND adjacency to walkable ground. The `bridge_steps`
      // designation is the exporter's marker for "this is the actual
      // stairs/ramp access." Just being on the perimeter isn't enough —
      // many bridge_deck / bridge_cave tiles touch ground simply because
      // the elevated bridge runs alongside it. Without a step marker,
      // those "edges" are pass-under-only (you can walk underneath but
      // can't climb up).
      //
      // If an ambiguous component has no `bridge_steps` tiles at all, it
      // becomes pass-under-only — A* can route across it but can't path
      // onto it. That's acceptable for typical Sinnoh networks where
      // bridge access is via warps to elevated-walkway sub-zones.

      // First pass — collect the bridge_steps tiles in this component.
      const stepTilesInComponent = new Set();
      for (const idx of regionTiles) {
        const typeByte = raw[idx * 2];
        const typeName = meta.typeByteMap?.[hexKey(typeByte)];
        if (typeof typeName === 'string' && typeName.includes('step')) {
          stepTilesInComponent.add(idx);
        }
      }

      // Second pass — apply axis + assign entry status.
      for (const idx of regionTiles) {
        axes[idx] = axis;
        const cx = idx % W, cy = (idx - cx) / W;

        // Geometric prerequisite: must have a walkable non-bridge neighbor
        // (regular ground OR a stair tile — both passable to the player).
        let hasGroundNeighbor = false;
        for (const [ndx, ndy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nnx = cx + ndx, nny = cy + ndy;
          if (nnx < 0 || nny < 0 || nnx >= W || nny >= H) continue;
          const ni = (nny * W + nnx) * 2;
          if (bytes.has(raw[ni])) continue;
          const neighborIdx = nny * W + nnx;
          if (effectiveBlocked(raw[ni], raw[ni + 1]) && !stairTiles.has(neighborIdx)) continue;
          hasGroundNeighbor = true;
          break;
        }
        if (!hasGroundNeighbor) continue;

        if (axis === 'ambiguous') {
          // Must be a bridge_steps tile or directly adjacent to one.
          let isStepOrNearStep = stepTilesInComponent.has(idx);
          if (!isStepOrNearStep) {
            for (const [ndx, ndy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nnx = cx + ndx, nny = cy + ndy;
              if (nnx < 0 || nny < 0 || nnx >= W || nny >= H) continue;
              if (stepTilesInComponent.has(nny * W + nnx)) {
                isStepOrNearStep = true;
                break;
              }
            }
          }
          if (isStepOrNearStep) entryTiles.add(idx);
        } else {
          // Anisotropic — entry at the long-axis extremes.
          if (axis === 'vertical'   && (cy === minY || cy === maxY)) entryTiles.add(idx);
          if (axis === 'horizontal' && (cx === minX || cx === maxX)) entryTiles.add(idx);
        }
      }

      regions++;
      totalBridges += regionTiles.length;
      if (axis === 'horizontal') horiz += regionTiles.length;
      else if (axis === 'vertical') vert += regionTiles.length;
      else ambig += regionTiles.length;
    }
  }

  if (totalBridges) {
    console.debug('[walkability] bridge axes (flood-fill):', {
      regions, totalBridges, horiz, vert, ambig,
      entryTiles: entryTiles.size,
      stairTiles: stairTiles.size,
      bridgeBytes: [...bytes].map(hexKey),
    });
  }
  return { axes, bytes, entryTiles, stairTiles };
}

// ----- A* -----

/**
 * Cost of entering tile (tx, ty) from direction (dx, dy). dx, dy ∈ {-1,0,1};
 * exactly one is non-zero (4-connected).
 *
 * Branches on the SEMANTIC NAME (from typeByteMap) rather than raw byte
 * values — the exporter can extend typeByteMap with new bytes mapped to
 * existing semantic names ("ledge_south" etc.) without any code change here.
 *
 * Returns Infinity to disallow entry; finite cost otherwise.
 */
function stepCost(walk, bridge, tx, ty, dx, dy, opts) {
  const i = (ty * walk.W + tx) * 2;
  const typeByte      = walk.raw[i];
  const collisionByte = walk.raw[i + 1];
  const typeName      = walk.meta.typeByteMap?.[hexKey(typeByte)];

  // HM-gated terrain — special-case BEFORE the wall check. These tiles
  // are stored with `collisionByte == 0x80` in the ROM (logically
  // "impassable without the right HM"), so `effectiveBlocked` below would
  // otherwise mark them as walls. Same short-circuit pattern as ledges
  // (handled via LEDGE_TYPE_BYTES in `effectiveBlocked`).
  //
  // Tile is gated by the matching HM option. Each branch resolves a single
  // semantic name to a single HM toggle:
  //   ledge_*    → handled in `effectiveBlocked` + directional gating below
  //   waterfall  → opts.waterfallAvailable
  //   rock_climb → opts.rockClimbAvailable
  //   cut_tree   → opts.cutAvailable
  //   strength_* → opts.strengthAvailable    (see note on Strength below)
  //   rock_smash*→ opts.rockSmashAvailable
  //   water_*    → opts.surfAvailable        (handled lower; collision is 0x00)
  //
  // Strength is conceptually different from the other HMs: the obstacle is
  // a movable BOULDER, not a fixed terrain tile. The boulder is a wall
  // when in place, a walkable tile after the player pushes it elsewhere,
  // and the new tile becomes a wall.
  //
  // Tile-only A* can't simulate boulder positions — when boulders are
  // present we dispatch from `aStar()` to `aStarWithBoulders()` (below)
  // which runs a state-space search where each node is
  // `(player position, set of all boulder positions)`. The Strength HM
  // gate in this branch only fires if `opts.boulders` is empty/absent —
  // i.e. the tile is statically labeled as a boulder (via a future
  // buildings sidecar) but no per-position data is being tracked. That
  // case degrades to "treat as walkable when Strength is on" — the same
  // simplification we used before the puzzle solver existed.
  //
  // Cut / Rock Smash gate by HM availability and treat as walkable when
  // available. These obstacles are NSBMD building objects in the ROM, not
  // walkability bytes — they will only fire once the exporter ships a
  // buildings sidecar (see upstream report). The gates are wired up now
  // so the moment the exporter starts emitting `cut_tree`,
  // `strength_boulder`, `rock_smashable` etc. in typeByteMap or via a
  // buildings overlay, they Just Work.
  if (typeName === 'rock_climb')                                 return opts.rockClimbAvailable ? 1 : Infinity;
  if (typeName === 'waterfall')                                  return opts.waterfallAvailable ? 1 : Infinity;
  if (typeName === 'cut_tree')                                   return opts.cutAvailable       ? 1 : Infinity;
  if (typeName && typeName.startsWith('strength'))               return opts.strengthAvailable  ? 1 : Infinity;
  if (typeName && (typeName.startsWith('rock_smash') ||
                   typeName === 'smashable_rock'))               return opts.rockSmashAvailable ? 1 : Infinity;
  // Bike-jump ledges (Wayward Cave's jutted rocks) are ALWAYS walls in
  // stepCost — the player never stops on them. Their collision byte is
  // 0x80, so the wall check below catches them naturally. The actual
  // "ride the bike onto the rock from the matching direction and fly
  // over" behavior is a compound move in aStar's neighbor loop: from
  // the approach tile, A* can skip-jump 2 or 4 tiles in the rock's
  // direction. Entry from any other direction is blocked (the rock
  // acts as a wall) — matches the in-game mechanic where you can't
  // walk onto a jutted rock from the side.
  // Wooden bike-beam bridges (Wayward Cave's `bridge_bike_beam`). The
  // tile is bridge-classified so axis-gating is handled at the aStar
  // boundary; here we just enforce the bike requirement.
  if (typeName === 'bridge_bike_beam'    && !opts.bikeAvailable) return Infinity;

  // Wall check — collision 0x80 means blocked except for ledges (see
  // effectiveBlocked for the rationale). Stair tiles (wall-labeled-walkable
  // adjacent to a bridge_steps) are also passable; they're scripted
  // staircases that the walkability data mis-flags as walls.
  const tileIdx = ty * walk.W + tx;
  const isStair = bridge?.stairTiles?.has(tileIdx);
  if (!isStair && effectiveBlocked(typeByte, collisionByte)) return Infinity;

  // Ledge directional gating. Direction names map to dx/dy as follows:
  //   south  →  dy = +1   (increasing y in PNG / map-pixel space)
  //   north  →  dy = -1
  //   east   →  dx = +1
  //   west   →  dx = -1
  switch (typeName) {
    case 'ledge_south': if (dy !==  1) return Infinity; break;
    case 'ledge_north': if (dy !== -1) return Infinity; break;
    case 'ledge_east':  if (dx !==  1) return Infinity; break;
    case 'ledge_west':  if (dx !== -1) return Infinity; break;
    // ledge_jump_3c / 3d / 3e — direction not authoritatively documented;
    // permit and let neighbor context decide. Refine here if/when we get
    // empirical zone-by-zone data.
    default: /* not a ledge */ break;
  }

  // (Bridge axis gating is no longer a stepCost concern — boundary
  // crossings between non-bridge and bridge tiles are gated at the aStar
  // level via `bridge.entryTiles` + approach-direction constraints, which
  // handle both entry and exit symmetrically. Within a bridge component,
  // tile-to-tile moves are unconstrained — a 2-wide bridge supports
  // lane-to-lane movement, junctions in a network are freely traversable.
  // Pass-under semantics fire when entry is blocked, see aStar.)

  // Water / waterfall gating. Surf covers any `water_*` semantic (e.g.
  // `water_surf`, `water_deep`, `water_a9` for Lake Verity / Twinleaf, plus
  // any future water variants the exporter labels) — branching on the
  // prefix means new variants Just Work without code changes. `waterfall`
  // doesn't match `water_*` (no underscore at position 5) so its own HM
  // gate stays separate.
  if (typeName && typeName.startsWith('water_') && !opts.surfAvailable) return Infinity;
  // (waterfall HM gate handled above, before the wall check, because
  // waterfall tiles ship with collisionByte 0x80.)

  // Encounter penalty (encourage routing around grass and marsh — both are
  // wild-encounter terrain). Branch on name prefix so future variants the
  // exporter ships (`marsh_deep`, `grass_dark`, etc.) auto-classify.
  let c = 1;
  if (typeName === 'grass_encounter')                     c = 2;
  else if (typeName && typeName.startsWith('marsh'))      c = 2;  // Great Marsh, Route 212
  else if (typeName === 'long_grass_encounter')           c = 3;
  else if (typeName === 'tall_grass_dark')                c = 3;
  if (opts.avoidGrass && c > 1) c += 6;

  // ──── Watch items (2026-05) — flag here in case behavior misbehaves ───
  // - Pastoria boardwalks (`boardwalk_*`, bytes 0x56-0x58/0x59) are
  //   currently labeled as plain walkable by the exporter, NOT directional
  //   bridges. If A* paths through them sideways and it looks wrong in
  //   game, promote them to `bridge_boardwalk` in walkability-overrides.js
  //   — the name-prefix bridge predicate will pick them up automatically.
  // - Snow variants (`snow`, `snow_deep`, `snow_path`, `ice_thick`) and
  //   ice (`ice_slip`) are walkable cost 1. If you want snow to be slower
  //   or ice to have special pathing, branch on the name here.
  // - Coastal docks (`walkable_dock`, `walkable_dock_steps`, bytes 0x71 /
  //   0x73) — now relabeled as `bridge_deck` / `bridge_steps` via the
  //   overrides since the same bytes are used for outdoor bridge decks
  //   (Cycling Road, Route 207, Sunyshore walkways). Genuine coastal docks
  //   still work because flood-fill classifies their shape; surrounding
  //   water provides natural side-entry barrier.

  return c;
}

/**
 * 4-connected A* on the walkability grid.
 *
 * @param {{meta, raw, W, H}} walk           output of loadWalkability
 * @param {{axes, bytes}} bridge              output of computeBridgeAxes
 *                                            (axes: per-tile axis; bytes: set
 *                                            of type bytes that act as bridges
 *                                            in this zone)
 * @param {{tx,ty}} start, goal
 * @param {object} opts                       {
 *   surfAvailable, waterfallAvailable, rockClimbAvailable,
 *   cutAvailable, strengthAvailable, rockSmashAvailable,
 *   avoidGrass,
 *   blocked? Set<number>   flat-index set of tiles A* must avoid (NPCs etc.),
 *   boulders? Array<{tx,ty}>  Strength boulder positions — see aStarWithBoulders
 * }
 * @returns {{ path: Array<{tx,ty}>, pushes: Array<{playerTile, boulderFrom, boulderTo}> } | null}
 *   path inclusive of start + goal. `pushes` is empty unless Strength
 *   solver ran (boulders present + Strength HM on). null if unreachable.
 */
export function aStar(walk, bridge, start, goal, opts = {}) {
  // Dispatch to the Sokoban-style solver when Strength is on AND we have
  // boulder positions to track. Without per-position data, boulders fall
  // through to the static "Strength HM gates `strength_*` tiles" branch
  // in stepCost, the same simplification we used before this solver
  // existed. See aStarWithBoulders for the state-space search rationale.
  if (Array.isArray(opts.boulders) && opts.boulders.length > 0 && opts.strengthAvailable) {
    return aStarWithBoulders(walk, bridge, start, goal, opts);
  }

  const { W, H } = walk;
  const sx = start.tx | 0, sy = start.ty | 0;
  const gx = goal.tx  | 0, gy = goal.ty  | 0;

  if (sx < 0 || sy < 0 || sx >= W || sy >= H) return null;
  if (gx < 0 || gy < 0 || gx >= W || gy >= H) return null;
  if (sx === gx && sy === gy) return { path: [{ tx: sx, ty: sy }], pushes: [] };

  // Start tile must itself not be an effective wall (the goal is checked
  // implicitly by stepCost when we try to enter it). Stair tiles count
  // as walkable here too.
  {
    const i = (sy * W + sx) * 2;
    const isStair = bridge?.stairTiles?.has(sy * W + sx);
    if (!isStair && effectiveBlocked(walk.raw[i], walk.raw[i + 1])) return null;
  }

  // If boulders were provided but Strength is off, treat them as static
  // walls — merge their tile indices into the blocked set so A* avoids
  // them entirely.
  let blocked = opts.blocked || null;
  if (Array.isArray(opts.boulders) && opts.boulders.length > 0) {
    const merged = new Set(blocked || []);
    for (const b of opts.boulders) merged.add(b.ty * W + b.tx);
    blocked = merged;
  }

  // Manhattan heuristic — admissible for a 4-connected grid with positive
  // edge weights ≥ 1.
  const h = (x, y) => Math.abs(x - gx) + Math.abs(y - gy);

  const gScore = new Float64Array(W * H);
  gScore.fill(Infinity);
  const cameFrom = new Int32Array(W * H);
  cameFrom.fill(-1);

  // Binary min-heap on fScore. Entries: [fScore, idx, x, y].
  const heap = [];
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
        let smallest = i;
        if (l < n && heap[l][0] < heap[smallest][0]) smallest = l;
        if (r < n && heap[r][0] < heap[smallest][0]) smallest = r;
        if (smallest === i) break;
        [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
        i = smallest;
      }
    }
    return top;
  };

  const sIdx = sy * W + sx;
  gScore[sIdx] = 0;
  heapPush([h(sx, sy), sIdx, sx, sy]);

  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  while (heap.length > 0) {
    const [, idx, x, y] = heapPop();
    if (x === gx && y === gy) {
      // Reconstruct path. Plain A* has no push events, so pushes is empty.
      const path = [];
      let cur = idx;
      while (cur !== -1) {
        path.push({ tx: cur % W, ty: (cur - (cur % W)) / W });
        cur = cameFrom[cur];
      }
      return { path: path.reverse(), pushes: [] };
    }
    const curG = gScore[idx];

    // Source-bridge flag — used to gate pass-under (only valid from a
    // non-bridge tile; you don't go "under" a bridge while standing on it).
    const fromBridge = bridge.bytes.has(walk.raw[(y * W + x) * 2]);

    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const nIdx = ny * W + nx;
      if (blocked && blocked.has(nIdx)) continue;

      // ── Bike-jump compound move ─────────────────────────────────────
      // If the immediate neighbor is a `bike_jump_<dir>` ledge AND we're
      // approaching from the matching direction AND the bike is on, the
      // player skip-jumps over the rock to land 2 tiles past us (slow)
      // or 4 tiles past us (fast). The rock tile itself is never stopped
      // on — A* registers the compound move directly to the landing
      // tile, cameFrom points back to the current tile (intermediate
      // tiles, including the rock, vanish from the path).
      //
      // Entry from any other direction falls through to the wall check
      // below — the rock acts as a wall (matches the in-game mechanic
      // where a jutted rock can't be walked onto from the side).
      {
        const nByte = walk.raw[nIdx * 2];
        const nName = walk.meta.typeByteMap?.[hexKey(nByte)];
        if (opts.bikeAvailable && nName && nName.startsWith('bike_jump_')) {
          const dir = nName.slice('bike_jump_'.length);
          const expectedDx = dir === 'east' ? 1 : dir === 'west' ? -1 : 0;
          const expectedDy = dir === 'south' ? 1 : dir === 'north' ? -1 : 0;
          if (dx === expectedDx && dy === expectedDy) {
            // Slow jump → land at +2 from current; fast jump → +4.
            for (const dist of [2, 4]) {
              const fx = x + dx * dist, fy = y + dy * dist;
              if (fx < 0 || fy < 0 || fx >= W || fy >= H) continue;
              const fIdx = fy * W + fx;
              if (blocked && blocked.has(fIdx)) continue;
              const fCost = stepCost(walk, bridge, fx, fy, dx, dy, opts);
              if (!isFinite(fCost)) continue;
              const tentativeG = curG + dist;
              if (tentativeG < gScore[fIdx]) {
                gScore[fIdx] = tentativeG;
                cameFrom[fIdx] = idx;
                heapPush([tentativeG + h(fx, fy), fIdx, fx, fy]);
              }
            }
            // Don't fall through to the standard step / pass-under —
            // the bike-jump is the only way to interact with a jutted
            // rock in this direction.
            continue;
          }
        }
      }

      // ── Bridge boundary gate ────────────────────────────────────────
      // Two-tier check on bridge ↔ non-bridge transitions:
      //   1. The bridge-side tile must be in `bridge.entryTiles` (a ramp
      //      or the extreme of an axis-anisotropic bridge's long side).
      //   2. For non-ramp endpoint entries on anisotropic bridges, the
      //      approach direction must be ALONG the bridge's long axis
      //      (vertical bridge → N-S approach, horizontal → E-W). This
      //      prevents stepping onto / off the endpoint row from the side.
      // Ramps (`bridge_steps`) allow any approach direction (you climb
      // up via the ramp from whichever direction).
      // If the boundary gate blocks but the destination is a bridge,
      // fall through to pass-under below — the player can still walk
      // UNDER the bridge without stepping on it.
      const toBridge = bridge.bytes.has(walk.raw[nIdx * 2]);
      let entryBlocks = false;
      if (fromBridge !== toBridge) {
        const boundaryIdx = fromBridge ? (y * W + x) : nIdx;
        if (!bridge.entryTiles.has(boundaryIdx)) {
          entryBlocks = true;
        } else {
          // Approach-direction constraint for non-ramp entries.
          const bByteAtBoundary = walk.raw[boundaryIdx * 2];
          const nameAtBoundary = walk.meta.typeByteMap?.[hexKey(bByteAtBoundary)];
          const isRamp = typeof nameAtBoundary === 'string' && nameAtBoundary.includes('step');
          if (!isRamp) {
            const axisAtBoundary = bridge.axes[boundaryIdx];
            if (axisAtBoundary === 'vertical'   && dx !== 0) entryBlocks = true;
            if (axisAtBoundary === 'horizontal' && dy !== 0) entryBlocks = true;
            // 'ambiguous' axis with non-ramp entry tile shouldn't happen
            // (ambiguous components only get ramps as entries), but if
            // it does, allow any direction — be permissive.
          }
        }
      }

      // ── Standard step ───────────────────────────────────────────────
      const cost = stepCost(walk, bridge, nx, ny, dx, dy, opts);
      if (isFinite(cost) && !entryBlocks) {
        const tentativeG = curG + cost;
        if (tentativeG < gScore[nIdx]) {
          gScore[nIdx] = tentativeG;
          cameFrom[nIdx] = idx;
          heapPush([tentativeG + h(nx, ny), nIdx, nx, ny]);
        }
        continue;
      }

      // ── Pass-under fallback ─────────────────────────────────────────
      // Triggered when the standard step is blocked AND we'd be entering
      // a bridge tile. Player walks UNDER the bridge from one side to
      // the other in a single A* move, skipping the bridge tiles in
      // path reconstruction (cameFrom jumps from source directly to
      // landing — polyline draws straight through the bridge area).
      //
      // Constraints:
      //   - Source MUST be a non-bridge tile (you don't pass-under from
      //     on the bridge — you're not below it).
      //   - The bridge byte set must include the immediate neighbor.
      //   - For axis-anisotropic bridges: direction perpendicular to axis
      //     (vertical bridge → E-W pass, horizontal → N-S pass).
      //   - For ambiguous bridges (Sunyshore-style networks): any
      //     direction — the network is "above" the ground in all
      //     orientations, so traffic can go under it any way.
      //   - The bridge run continues forward in (dx, dy) until a
      //     non-bridge tile is reached; that landing tile must itself
      //     be enterable (no walls, no NPCs, ledges allow the direction).
      if (fromBridge) continue;                        // not below the bridge
      if (!toBridge) continue;                         // not entering a bridge
      const bAxis = bridge.axes[nIdx];
      const isPassUnder = bAxis === 'ambiguous'
                       || (bAxis === 'horizontal' && dx === 0)
                       || (bAxis === 'vertical'   && dy === 0);
      if (!isPassUnder) continue;

      let cx = nx + dx, cy = ny + dy;
      let bridgeSteps = 1;            // already crossed 1 bridge tile (the immediate neighbor)
      let aborted = false;
      while (cx >= 0 && cy >= 0 && cx < W && cy < H) {
        const ci = (cy * W + cx) * 2;
        const cByte = walk.raw[ci];
        if (!bridge.bytes.has(cByte)) break;           // exited the bridge run
        const cAxis = bridge.axes[cy * W + cx];
        const cPerp = cAxis === 'ambiguous'
                   || (cAxis === 'horizontal' && dx === 0)
                   || (cAxis === 'vertical'   && dy === 0);
        if (!cPerp) { aborted = true; break; }         // bridge with wrong axis — abort
        bridgeSteps++;
        cx += dx; cy += dy;
      }
      if (aborted) continue;
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
      const landingIdx = cy * W + cx;
      if (blocked && blocked.has(landingIdx)) continue;

      const landingCost = stepCost(walk, bridge, cx, cy, dx, dy, opts);
      if (!isFinite(landingCost)) continue;

      // 1 cost per bridge tile traversed + landing tile's normal entry
      // cost. A 1-tile pass-under costs 2 (same as walking 2 plain tiles).
      const tentativeG = curG + bridgeSteps + landingCost;
      if (tentativeG < gScore[landingIdx]) {
        gScore[landingIdx] = tentativeG;
        cameFrom[landingIdx] = idx;
        heapPush([tentativeG + h(cx, cy), landingIdx, cx, cy]);
      }
    }
  }

  return null;
}

// ----- Strength puzzle solver (Sokoban-style state-space A*) -----
//
// When boulders are present and Strength is available, the player can push
// each boulder one tile in the direction of movement (provided the boulder's
// destination is walkable and unoccupied). Pushing changes the world — the
// boulder's old tile becomes walkable, the new tile becomes blocked.
//
// Tile-only A* doesn't model this; we need a state-space search where each
// node is (player position, sorted tuple of boulder positions). State count
// explodes combinatorially with boulder count, but typical Sinnoh puzzles
// have ≤ 4 boulders, well within budget for a single-zone search.
//
// Returned path shape matches plain `aStar` for backward compatibility:
// `Array<{tx, ty}>` of player tile positions. To inspect push events,
// caller can additionally look at the path's annotations via the second
// return value once we add a richer API. For now the path is just tile
// coords — sufficient to render a polyline.

const DIR_LIST = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Sokoban-style A* on (player, boulders) state space. Called by `aStar`
 * when `opts.boulders` is a non-empty array AND `opts.strengthAvailable`.
 *
 * @param {{meta, raw, W, H}} walk
 * @param {{axes, bytes}} bridge
 * @param {{tx,ty}} start, goal
 * @param {object} opts                       same as aStar, plus:
 *   boulders: Array<{tx, ty}>                initial boulder positions
 * @returns {Array<{tx,ty}> | null}           player path inclusive of start + goal
 */
export function aStarWithBoulders(walk, bridge, start, goal, opts = {}) {
  const { W, H } = walk;
  const sx = start.tx | 0, sy = start.ty | 0;
  const gx = goal.tx  | 0, gy = goal.ty  | 0;

  if (sx < 0 || sy < 0 || sx >= W || sy >= H) return null;
  if (gx < 0 || gy < 0 || gx >= W || gy >= H) return null;

  // Start tile is walkable (boulders can't start on the player). Stair
  // tiles count as walkable here too — same exception as plain aStar.
  {
    const i = (sy * W + sx) * 2;
    const isStair = bridge?.stairTiles?.has(sy * W + sx);
    if (!isStair && effectiveBlocked(walk.raw[i], walk.raw[i + 1])) return null;
  }

  const blocked = opts.blocked || null;

  // Encode boulder set as a sorted comma-separated list of flat indices.
  // Sorting gives canonical form so equivalent worlds hash identically.
  const encodeBoulders = (arr) => {
    const idxs = new Array(arr.length);
    for (let i = 0; i < arr.length; i++) idxs[i] = arr[i].ty * W + arr[i].tx;
    idxs.sort((a, b) => a - b);
    return idxs.join(',');
  };
  const decodeBoulders = (s) => {
    if (!s) return [];
    return s.split(',').map(Number).map(n => ({ tx: n % W, ty: (n - (n % W)) / W }));
  };
  const stateKey = (px, py, boulderEncoded) => `${py * W + px}|${boulderEncoded}`;

  // Manhattan heuristic — admissible since pushing a boulder costs at least
  // as much as moving to its tile (lower bound = direct walk to goal).
  const h = (x, y) => Math.abs(x - gx) + Math.abs(y - gy);

  // gScore / cameFrom keyed by state string. Map is fine — state count
  // won't approach the millions for typical puzzles.
  const gScore = new Map();
  const cameFrom = new Map();   // stateKey → previousStateKey
  const stateInfo = new Map();  // stateKey → { px, py, boulders } for path reconstruction

  const initialBoulders = encodeBoulders(opts.boulders);
  const initialKey = stateKey(sx, sy, initialBoulders);
  gScore.set(initialKey, 0);
  stateInfo.set(initialKey, { px: sx, py: sy, boulders: initialBoulders });

  // Binary min-heap on fScore. Entries: [fScore, stateKey].
  const heap = [];
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
        let smallest = i;
        if (l < n && heap[l][0] < heap[smallest][0]) smallest = l;
        if (r < n && heap[r][0] < heap[smallest][0]) smallest = r;
        if (smallest === i) break;
        [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
        i = smallest;
      }
    }
    return top;
  };

  heapPush([h(sx, sy), initialKey]);

  let expansions = 0;
  const MAX_EXPANSIONS = 50000;   // safety cap to avoid pathological blowups

  while (heap.length > 0) {
    const [, key] = heapPop();
    if (expansions++ > MAX_EXPANSIONS) {
      console.warn('[pathfinding] strength solver hit MAX_EXPANSIONS — abandoning');
      return null;
    }
    const cur = stateInfo.get(key);
    if (!cur) continue;
    const { px, py, boulders: boulderEncoded } = cur;

    if (px === gx && py === gy) {
      // Reconstruct player tile path AND push events. Each state knows the
      // action that produced it (move vs push) plus, for pushes, where the
      // boulder went. Walking back through cameFrom collects both.
      const path = [];
      const pushes = [];
      let k = key;
      while (k !== undefined) {
        const info = stateInfo.get(k);
        if (!info) break;
        path.push({ tx: info.px, ty: info.py });
        if (info.action === 'push') {
          pushes.push({
            playerTile: { tx: info.px, ty: info.py },
            boulderFrom: info.pushedFrom,
            boulderTo: info.pushedTo,
          });
        }
        k = cameFrom.get(k);
      }
      return { path: path.reverse(), pushes: pushes.reverse() };
    }

    // Boulder set as a fast-lookup Set<number> for this expansion.
    const boulderSet = new Set(
      boulderEncoded ? boulderEncoded.split(',').map(Number) : []
    );
    const curG = gScore.get(key);

    for (const [dx, dy] of DIR_LIST) {
      const nx = px + dx, ny = py + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const nIdx = ny * W + nx;
      if (blocked && blocked.has(nIdx)) continue;

      // Bridge entry/exit gating — same two-tier rule as main A*.
      // Pass-under isn't implemented in the Sokoban loop; if a Strength
      // puzzle requires pass-under to reach, that's a known gap (the
      // typical case is a boulder corridor without bridges). Fall back
      // to plain blocking here — if you hit this in practice, ping me.
      const fromBridge = bridge.bytes.has(walk.raw[(py * W + px) * 2]);
      const toBridge   = bridge.bytes.has(walk.raw[nIdx * 2]);
      if (fromBridge !== toBridge) {
        const boundaryIdx = fromBridge ? (py * W + px) : nIdx;
        if (!bridge.entryTiles.has(boundaryIdx)) continue;
        const bByteAtBoundary = walk.raw[boundaryIdx * 2];
        const nameAtBoundary = walk.meta.typeByteMap?.[hexKey(bByteAtBoundary)];
        const isRamp = typeof nameAtBoundary === 'string' && nameAtBoundary.includes('step');
        if (!isRamp) {
          const axisAtBoundary = bridge.axes[boundaryIdx];
          if (axisAtBoundary === 'vertical'   && dx !== 0) continue;
          if (axisAtBoundary === 'horizontal' && dy !== 0) continue;
        }
      }

      if (boulderSet.has(nIdx)) {
        // Trying to step onto a boulder → push it.
        const px2 = nx + dx, py2 = ny + dy;
        if (px2 < 0 || py2 < 0 || px2 >= W || py2 >= H) continue;
        const pIdx = py2 * W + px2;
        if (boulderSet.has(pIdx)) continue;                   // can't push into another boulder
        if (blocked && blocked.has(pIdx)) continue;           // can't push onto an NPC

        // Boulder destination must be enterable terrain. Use the same
        // stepCost predicate the player would face — if a player couldn't
        // walk there, a boulder can't go there either (water, ledges going
        // the wrong way, perpendicular bridge entries, etc.).
        const destCost = stepCost(walk, bridge, px2, py2, dx, dy, opts);
        if (!isFinite(destCost)) continue;

        // Boulder also has to obey bridge entry/exit gating along its push
        // — same approach-direction constraints as the player.
        const boulderFromBridge = bridge.bytes.has(walk.raw[nIdx * 2]);
        const boulderToBridge   = bridge.bytes.has(walk.raw[pIdx * 2]);
        if (boulderFromBridge !== boulderToBridge) {
          const boundaryIdx = boulderFromBridge ? nIdx : pIdx;
          if (!bridge.entryTiles.has(boundaryIdx)) continue;
          const bByteAtBoundary = walk.raw[boundaryIdx * 2];
          const nameAtBoundary = walk.meta.typeByteMap?.[hexKey(bByteAtBoundary)];
          const isRamp = typeof nameAtBoundary === 'string' && nameAtBoundary.includes('step');
          if (!isRamp) {
            const axisAtBoundary = bridge.axes[boundaryIdx];
            if (axisAtBoundary === 'vertical'   && dx !== 0) continue;
            if (axisAtBoundary === 'horizontal' && dy !== 0) continue;
          }
        }

        const newBoulders = encodeBoulders(
          decodeBoulders(boulderEncoded).map(b =>
            (b.tx === nx && b.ty === ny) ? { tx: px2, ty: py2 } : b
          )
        );
        const newKey = stateKey(nx, ny, newBoulders);

        // Push cost: 2 (player move + boulder shove). Tweak if push should
        // be more expensive than plain movement to discourage unnecessary
        // boulder shuffling.
        const tentativeG = curG + 2;
        const prevG = gScore.get(newKey);
        if (prevG === undefined || tentativeG < prevG) {
          gScore.set(newKey, tentativeG);
          cameFrom.set(newKey, key);
          stateInfo.set(newKey, {
            px: nx, py: ny, boulders: newBoulders,
            action: 'push',
            pushedFrom: { tx: nx, ty: ny },
            pushedTo:   { tx: px2, ty: py2 },
          });
          heapPush([tentativeG + h(nx, ny), newKey]);
        }
      } else {
        // Regular move — no boulder at the destination.
        const cost = stepCost(walk, bridge, nx, ny, dx, dy, opts);
        if (!isFinite(cost)) continue;
        const newKey = stateKey(nx, ny, boulderEncoded);
        const tentativeG = curG + cost;
        const prevG = gScore.get(newKey);
        if (prevG === undefined || tentativeG < prevG) {
          gScore.set(newKey, tentativeG);
          cameFrom.set(newKey, key);
          stateInfo.set(newKey, {
            px: nx, py: ny, boulders: boulderEncoded, action: 'move',
          });
          heapPush([tentativeG + h(nx, ny), newKey]);
        }
      }
    }
  }

  return null;
}

// ----- pixel ↔ tile helpers -----
//
// As of the visible-map-aligned walkability export (REACT_WALKABILITY.md
// §5, alignment: "visible-map"), the walkability grid shares an origin
// with the visible map PNG. Pixel ↔ tile is a single divide by
// `meta.tilePxOnVisibleMap` (= 16 for DPPt at 1.0 ppu). No offsets, no
// bounds checks, no inverse-pipeline math.

export function pixelToTile(pixelX, pixelY, meta) {
  const s = meta?.tilePxOnVisibleMap ?? 16;
  return {
    tx: Math.floor(pixelX / s),
    ty: Math.floor(pixelY / s),
  };
}

export function tileToPixelCenter(tx, ty, meta) {
  const s = meta?.tilePxOnVisibleMap ?? 16;
  return {
    px: tx * s + s / 2,
    py: ty * s + s / 2,
  };
}
