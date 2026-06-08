// Shared mon-attribute filter logic for the Tracker's two views.
//
// The Mark grid (mon-centric) and the Plan location list (location-centric,
// filtering the catchable mons inside each location) apply the SAME per-mon
// predicates — types, baby status, evolution method, hunt tier. Keeping the
// constants + predicates here means the two views can't drift apart.

// Babies — three-way single-select (Any / Babies only / Hide babies).
export const BABY_FILTERS = [
  { key: 'any',     label: 'Any' },
  { key: 'only',    label: 'Babies only' },
  { key: 'exclude', label: 'Hide babies' },
];

// Evolution-method buckets over the 27 raw evolution `type` strings emitted by
// build-data.mjs. The raw types are too granular to expose directly (the three
// HAPPINESS_* variants all read as "Friendship"; the LEVEL_LOCATION_* slots
// are all "near a special rock"; etc.), so we coarsen to 8 user-meaningful
// groups. Keys double as persisted filter values + React keys — keep stable.
export const EVOLUTION_CATEGORIES = [
  { key: 'stone',      label: 'Stone',      types: ['ITEM', 'ITEM_MALE', 'ITEM_FEMALE'] },
  { key: 'level',      label: 'Level',      types: ['LEVEL', 'LEVEL_FEMALE', 'LEVEL_MALE',
                                                    'ATK_LESS_THAN_DEF', 'ATK_GREATER_THAN_DEF', 'ATK_EQUAL_TO_DEF',
                                                    'PERSONALITY_HIGH', 'PERSONALITY_LOW'] },
  { key: 'friendship', label: 'Friendship', types: ['HAPPINESS', 'HAPPINESS_DAY', 'HAPPINESS_NIGHT'] },
  { key: 'trade',      label: 'Trade',      types: ['TRADE', 'TRADE_WITH_ITEM', 'TRADE_FOR_OPPOSITE'] },
  { key: 'held',       label: 'Held item',  types: ['LEVEL_ITEM_DAY', 'LEVEL_ITEM_NIGHT'] },
  { key: 'move',       label: 'Knows move', types: ['LEVEL_WITH_SKILL'] },
  { key: 'location',   label: 'Location',   types: ['LEVEL_LOCATION_1', 'LEVEL_LOCATION_2', 'LEVEL_LOCATION_3'] },
  { key: 'special',    label: 'Special',    types: ['MAX_BEAUTY', 'LEVEL_WITH_MONSTER',
                                                    'ALLOW_MONSTER_CREATION', 'CREATE_EXTRA_MONSTER'] },
];

// Reverse lookup: raw evolution type → category key. O(#evolutions) matching.
export const EVOLUTION_TYPE_TO_CATEGORY = (() => {
  const m = new Map();
  for (const cat of EVOLUTION_CATEGORIES) for (const t of cat.types) m.set(t, cat.key);
  return m;
})();

// Unassigned hunt_tier (null) is treated as tier 3, the default "Normal Horde"
// bucket — so picking T3 surfaces both explicit T3 mons and every unlisted one.
export const DEFAULT_HUNT_TIER = 3;

// AND semantics: the mon must have EVERY selected type (up to the picker's max
// of 2). Empty selection = no filter.
export function matchesTypes(p, types) {
  if (!types || types.length === 0) return true;
  for (const t of types) {
    if (!p.types.some((pt) => pt.toLowerCase() === t.toLowerCase())) return false;
  }
  return true;
}

export function matchesBaby(p, baby) {
  if (baby === 'only') return !!p.is_baby;
  if (baby === 'exclude') return !p.is_baby;
  return true; // 'any' / undefined
}

// OR semantics across selected categories, matched two-way (the mon's incoming
// pre_evolution OR any outgoing evolution) so the whole family surfaces for a
// pick. `evoSet` is a Set of category keys, or null to disable.
export function matchesEvolution(p, evoSet) {
  if (!evoSet) return true;
  const pre = p.pre_evolution?.type;
  if (pre && evoSet.has(EVOLUTION_TYPE_TO_CATEGORY.get(pre))) return true;
  for (const ev of (p.evolutions || [])) {
    const cat = EVOLUTION_TYPE_TO_CATEGORY.get(ev?.type);
    if (cat && evoSet.has(cat)) return true;
  }
  return false;
}

// `tierSet` is a Set of tier numbers, or null to disable.
export function matchesTier(p, tierSet) {
  if (!tierSet) return true;
  return tierSet.has(p.hunt_tier ?? DEFAULT_HUNT_TIER);
}
