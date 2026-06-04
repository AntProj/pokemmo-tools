// src/lib/walkability-overrides.js
//
// Supplementary / corrective type-byte → semantic-name labels, merged over
// the exporter's `typeByteMap` from the walkability JSON at load time.
// Use this when:
//   - the exporter hasn't classified a byte yet (the byte is missing from
//     `typeByteMap` and currently treated as walkable by A*), OR
//   - the exporter's label is wrong and needs correcting.
//
// User-side overrides WIN over the JSON's labels. Keep the JSON canonical
// for everyone else — promote findings upstream when convenient, then
// delete the entry here.
//
// The semantic names you use must match the canonical strings in
// REACT_WALKABILITY.md §4 (e.g. `walkable`, `bridge`, `water_surf`,
// `ledge_south`, etc.). A* branches on these names, so misspellings will
// silently fall through to "default walkable cost".
//
// ──── HISTORY ──────────────────────────────────────────────────────────
// 2026-05: Exporter now ships canonical labels for 0x4B (rock_climb),
//   0x70/0x72 (bridge_cave), and ~70 other previously-unclassified bytes
//   identified by its validation pass (snow / marsh / distortion-world /
//   ironworks / mountain / cave variants etc.). All the entries that lived
//   here as workarounds are now in DSPRE's TypeTable. Delete entries here
//   only after confirming the bytes appear in the latest walkability JSON
//   sidecars — re-export from DSPRE first.
//
// Keeping this file with an EMPTY override map is intentional: it leaves
// the merge plumbing in place for the next time we discover an unclassified
// byte before the exporter catches up.

export const TYPE_BYTE_OVERRIDES = {
  // ──── Waterfall / surf-water label swap (exporter bug 2026-05) ─────────
  // The exporter's TypeTable currently labels 0x13 → `water_deep` and
  // 0x15 → `waterfall`. Empirical analysis across all 577 zones strongly
  // suggests these are swapped:
  //
  // Byte 0x13 only appears in zones with actual waterfalls in-game, in
  // small counts that match in-game waterfall sprite counts exactly:
  //   • 0246 Victory Road: 6 tiles → 6 visible waterfalls (user confirmed)
  //   • 0212 Mt. Coronet:  7 tiles → Mt. Coronet waterfalls
  //   • 0363 Route 210:    9 tiles → foggy-area waterfalls
  //   • 0354 Route 208:    3 tiles → river waterfall
  //
  // Byte 0x15 appears in massive counts in every Surf-required zone:
  //   • 0472 Seabreak Path: 6912 tiles (open ocean)
  //   • 0468 Route 223:     2723 tiles (ocean route)
  //   • 0312/0315/0318 lakes: 1017 each (lake surfaces)
  //
  // Until the exporter's TypeTable is corrected (DSPRE's
  // WalkableExporter.cs), this override flips them so React A* gates the
  // right HM on the right tile.
  0x13: 'waterfall',
  0x15: 'water_surf',

  // ──── Outdoor bridge deck + steps (exporter mislabel 2026-05) ──────────
  // The exporter labels `0x71` / `0x73` as `walkable_dock` / `walkable_dock_steps`
  // (accurate for coastal piers in Canalave / Resort Area) — but the same
  // bytes are also used for OUTDOOR BRIDGE DECKS that connect to `bridge_cave`
  // (0x70) endpoints. Evidence from cross-zone audit:
  //
  //   • 0353 Route 207: 4 tiles of 0x70 (cave_bridge endpoints) + 12 tiles
  //     of 0x71 in between, forming one connected 2×8 vertical bridge.
  //     With the exporter's labels, flood-fill saw the endpoints as two
  //     separate 2×1 horizontal bridges and the deck as plain walkable →
  //     the whole structure wasn't axis-gated.
  //   • 0350 Route 206 (Cycling Road): 619 tiles of 0x71 forming an 8×86
  //     elevated N-S bridge — the entire cycling road. Plus 8 tiles of
  //     0x73 at endpoints.
  //   • 0150 Sunyshore City: 182 tiles of 0x71 + 136 tiles of 0x73 = the
  //     elevated walkways between the solar pillars.
  //
  // Relabeling to `bridge_*` puts them in the directional-bridge set and
  // lets flood-fill connect them with adjacent bridge_cave endpoints.
  // For genuine coastal docks (Canalave, Resort Area — narrow piers
  // surrounded by water), axis-gating doesn't hurt since the surrounding
  // water already blocks side entry; if it ever does cause problems we
  // can split into `dock_*` (non-gated) and `bridge_*` (gated) at the
  // exporter level.
  0x71: 'bridge_deck',
  0x73: 'bridge_steps',

  // ──── Wayward Cave wooden beams (bike-only bridges) ────────────────────
  // 0x7A / 0x7B together form horizontal wooden-beam strips spanning a
  // chasm — only traversable on a bike. Positionally confirmed in
  // 0285 Wayward Cave: beam segments at rows 6 and 13, columns 16-24,
  // with 0x7A at the ends and 0x7B in the middle.
  //
  // Labeling them `bridge_*` puts them in the directional-bridge family
  // (axis-gated like a regular bridge); the additional bike requirement
  // is enforced separately in pathfinding.js's stepCost via the
  // `bikeAvailable` opt.
  0x7A: 'bridge_bike_beam',
  0x7B: 'bridge_bike_beam',

  // ──── Wayward Cave bike-jump ledges (jutted rocks) ─────────────────────
  // 0xD7 / 0xD8 are jutted rocks that fire a directional bike jump when
  // the player rides at them in the rock's direction. Slow bike → land
  // 2 tiles away; fast bike → land 4 tiles away. Collision 0x80 matches
  // the regular ledge byte pattern (the ledge "wall" with directional
  // jump exception). Direction guess based on byte order:
  //   0xD7 → east (most common at 7 tiles)
  //   0xD8 → west
  //
  // If the in-game direction doesn't match (paths fail in Wayward Cave),
  // flip these two labels.
  0xD7: 'bike_jump_east',
  0xD8: 'bike_jump_west',

  //
  // To add a new override:
  //   0xNN: 'semantic_name',   // brief note: zone, why
  //
  // Reminders on conventions:
  //   - Directional bridges: name must contain "bridge" AND NOT "walkable".
  //     `bridge_cave`, `bridge_wood`, etc. → axis-gated. `bridge_walkable`
  //     → plain walkable (the exporter's name for 0x16 outside-world).
  //   - HM-gated terrain: use `rock_climb`, `water_surf`, `water_deep`,
  //     `waterfall`. These names are special-cased in pathfinding.js's
  //     stepCost — branching on the name, not the byte value.
  //   - Anything else: use the canonical names in REACT_WALKABILITY.md §4.
  //     Unrecognized names fall through to "walkable cost 1" silently.
};
