// Per-Pokémon state machine. uncaught is the implicit default — unlisted ids
// in tracker:state are treated as uncaught.
export const STATES = ['uncaught', 'caught', 'priority', 'skipped'];

export function stateOf(trackerState, id) {
  return trackerState[id] || 'uncaught';
}

// Single-click cycles only between uncaught and caught. The other two states
// (priority, skipped) require the right-click panel.
export function cycleClick(state) {
  return state === 'caught' ? 'uncaught' : 'caught';
}

// Rarity → base point value used in the planning algorithm. Rarer encounters
// score lower because they take longer to find; lures and hordes are easy.
// Score the difficulty of getting *one* of this species for dex completion.
// Lure encounters need a consumable item (and the right method/tile), so
// they rank below hordes for "where should I farm next" — score at 0 so a
// lure-only location doesn't push itself up the rankings.
const RARITY_POINTS = {
  'Very Common': 4,
  Common:        3,
  Uncommon:      2,
  Rare:          1,
  'Very Rare':   1,
  Special:       1,
  Horde:         1,   // KO 4 to catch 1 — tedious
  Lure:          0,   // requires consumable, worst dex-grind option
};

export function scorePoints(rarity, state) {
  // Priority no longer doubles the score — that role is handled at the
  // location level by sorting priority-bearing locations to the top.
  if (state === 'caught' || state === 'skipped') return 0;
  return RARITY_POINTS[rarity] ?? 1;
}

// Pick the easiest catchable encounter for a Pokémon. The pipeline already
// sorts pokemon.locations easiest-first, so locations[0] is the best — but we
// guard for missing data.
export function bestCatchEntry(pokemon) {
  const list = pokemon?.locations || [];
  if (list.length === 0) return null;
  // The list is sorted by tier weight desc — first entry is the best one. Still
  // do a min-rarity-rank fallback in case ordering ever drifts.
  return list[0];
}

// Status / catch-rate tip shown in the catch info panel.
export function statusTip(catchRate) {
  if (catchRate == null)   return 'Use Quick Ball turn 1 — usually does it.';
  if (catchRate <= 30)     return 'Tough catch — False Swipe + Sleep is essential.';
  if (catchRate <= 75)     return 'Medium catch — False Swipe + any status helps.';
  return 'Easy catch — Quick Ball turn 1 usually does it.';
}

// Ball recommendations. Returns top items in priority order. Each entry is
// { name, mult, why }. Conditional balls only render when applicable.
export function recommendBalls(pokemon, bestEntry, state) {
  const recs = [];
  recs.push({ name: 'Quick Ball', mult: 5,   why: 'Used on turn 1 only' });

  const method = bestEntry?.method;
  if (method === 'Cave' || method === 'Inside') {
    recs.push({ name: 'Dusk Ball',  mult: 3.5, why: 'Caves count as dark areas' });
  }
  // Net Ball — Bug or Water targets.
  const types = (pokemon?.types || []).map((t) => t.toLowerCase());
  if (types.includes('water') || types.includes('bug')) {
    recs.push({ name: 'Net Ball',   mult: 3.5, why: 'Boosts vs Water/Bug types' });
  }
  if (state === 'caught') {
    recs.push({ name: 'Repeat Ball', mult: 3.5, why: 'You already have this species' });
  }
  recs.push({ name: 'Timer Ball', mult: 4,   why: 'Stronger after turn 30' });
  recs.push({ name: 'Ultra Ball', mult: 2,   why: 'Reliable fallback' });

  // Cap to 4 most relevant. Order is already priority-driven; just slice.
  return recs.slice(0, 4);
}

// Method labels shown alongside method icons in the planning rows. Same
// canonical list used by the Locations tab.
export const METHOD_OPTIONS = [
  'Grass', 'Dark Grass', 'Cave', 'Inside', 'Water', 'Surf',
  'Old Rod', 'Good Rod', 'Super Rod', 'Fishing',
  'Headbutt', 'Honey Tree', 'Rocks', 'Dust Cloud', 'Shadow',
];

// Tracker-specific rarity order. Lure sits dead last because it requires a
// consumable item and a specific method/tile — the worst dex-grind option.
// Horde comes before it (still tedious — KO 4 to catch 1).
const TRACKER_RARITY_ORDER = [
  'Very Common', 'Common', 'Uncommon',
  'Rare', 'Very Rare',
  'Special',
  'Horde',
  'Lure',  // last
];
export function trackerRarityRank(rarity) {
  const i = TRACKER_RARITY_ORDER.indexOf(rarity);
  return i === -1 ? TRACKER_RARITY_ORDER.length : i;
}

// Locations that exist in-game but are gated behind dex completion. Showing
// them in the Tracker is circular — the Tracker is meant to *get you to* dex
// completion, so a "go grind there" suggestion that requires a complete dex
// is useless. Compared case-insensitively against the location's base name.
export const TRACKER_EXCLUDED_LOCATIONS = [
  'mt. silver cave',
];

export function isExcludedFromTracker(locationName) {
  if (!locationName) return false;
  return TRACKER_EXCLUDED_LOCATIONS.includes(String(locationName).toLowerCase());
}

/* ─────────── Export / Import ─────────── */

const VALID_STATES = new Set(['caught', 'priority', 'skipped']);

// Returns { filename, blob } that the caller hands to a temporary <a download>.
export function exportTrackerState(trackerState) {
  const payload = {
    version: 1,
    exported_at: new Date().toISOString(),
    state: { ...trackerState },
  };
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  return { filename: `pokemmo-tracker-${yyyy}-${mm}-${dd}.json`, blob };
}

// Parse + validate. Throws on malformed input. Drops unknown state values
// silently rather than rejecting the whole file.
export function parseImport(text) {
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { throw new Error('Not valid JSON'); }
  const stateObj = parsed?.state ?? parsed;
  if (!stateObj || typeof stateObj !== 'object' || Array.isArray(stateObj)) {
    throw new Error('Missing state object');
  }
  const out = {};
  let count = 0;
  for (const [k, v] of Object.entries(stateObj)) {
    const id = Number(k);
    if (!Number.isInteger(id) || id <= 0) continue;
    if (typeof v !== 'string' || !VALID_STATES.has(v)) continue;
    out[id] = v;
    count++;
  }
  if (count === 0) throw new Error('No valid entries found');
  return { state: out, count };
}
