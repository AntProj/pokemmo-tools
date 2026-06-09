// Team analysis: type-effectiveness chart, nature table, and the defensive
// weakness matrix / offensive coverage / speed-tier computations. Standalone
// (works off pokemmo.json) so the Team Builder doesn't pull in the damage engine.

export const TYPES = [
  'normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison',
  'ground', 'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy',
];

// Standard Gen-6+ chart (PokéMMO uses it). Only non-1.0 matchups listed;
// CHART[attacker][defender].
const CHART = {
  normal:   { rock: 0.5, ghost: 0, steel: 0.5 },
  fire:     { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
  water:    { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
  electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
  grass:    { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5 },
  ice:      { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5 },
  fighting: { normal: 2, ice: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, rock: 2, ghost: 0, dark: 2, steel: 2, fairy: 0.5 },
  poison:   { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0, fairy: 2 },
  ground:   { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
  flying:   { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
  psychic:  { fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5 },
  bug:      { fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5, psychic: 2, ghost: 0.5, dark: 2, steel: 0.5, fairy: 0.5 },
  rock:     { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
  ghost:    { normal: 0, psychic: 2, ghost: 2, dark: 0.5 },
  dragon:   { dragon: 2, steel: 0.5, fairy: 0 },
  dark:     { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5 },
  steel:    { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, steel: 0.5, fairy: 2 },
  fairy:    { fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5 },
};

const norm = (t) => String(t || '').toLowerCase();

// Multiplier of `attackType` against a defender with `defTypes` (1–2 types).
export function effectiveness(attackType, defTypes) {
  const a = norm(attackType);
  const row = CHART[a];
  if (!row) return 1;
  let m = 1;
  for (const d of defTypes) {
    const k = norm(d);
    if (k in row) m *= row[k];
  }
  return m;
}

// Nature → which stat it raises / lowers (hp never affected).
export const NATURES = {
  Hardy: {}, Docile: {}, Serious: {}, Bashful: {}, Quirky: {},
  Lonely: { plus: 'atk', minus: 'def' }, Brave: { plus: 'atk', minus: 'spe' }, Adamant: { plus: 'atk', minus: 'spa' }, Naughty: { plus: 'atk', minus: 'spd' },
  Bold: { plus: 'def', minus: 'atk' }, Relaxed: { plus: 'def', minus: 'spe' }, Impish: { plus: 'def', minus: 'spa' }, Lax: { plus: 'def', minus: 'spd' },
  Timid: { plus: 'spe', minus: 'atk' }, Hasty: { plus: 'spe', minus: 'def' }, Jolly: { plus: 'spe', minus: 'spa' }, Naive: { plus: 'spe', minus: 'spd' },
  Modest: { plus: 'spa', minus: 'atk' }, Mild: { plus: 'spa', minus: 'def' }, Quiet: { plus: 'spa', minus: 'spe' }, Rash: { plus: 'spa', minus: 'spd' },
  Calm: { plus: 'spd', minus: 'atk' }, Gentle: { plus: 'spd', minus: 'def' }, Sassy: { plus: 'spd', minus: 'spe' }, Careful: { plus: 'spd', minus: 'spa' },
};
export const NATURE_NAMES = Object.keys(NATURES);

// pokemmo.json base-stat key per short key.
export const BASE_KEY = { hp: 'hp', atk: 'attack', def: 'defense', spa: 'sp_attack', spd: 'sp_defense', spe: 'speed' };

export function calcStat(stat, base, iv, ev, level, nature) {
  if (stat === 'hp') {
    if (base === 1) return 1; // Shedinja
    return Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + level + 10;
  }
  let n = 1;
  const nat = NATURES[nature] || {};
  if (nat.plus === stat) n = 1.1;
  else if (nat.minus === stat) n = 0.9;
  return Math.floor((Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + 5) * n);
}

/* ── analyses ──────────────────────────────────────────────────────────── */

// Defensive matrix: for each attacking type, how each member fares.
// Returns [{ type, members:[{name, mult}], weak, resist, immune, neutral }].
export function weaknessMatrix(members) {
  return TYPES.map((type) => {
    const cells = members.map((m) => ({ name: m.name, mult: effectiveness(type, m.types) }));
    return {
      type,
      members: cells,
      weak: cells.filter((c) => c.mult > 1).length,
      resist: cells.filter((c) => c.mult < 1 && c.mult > 0).length,
      immune: cells.filter((c) => c.mult === 0).length,
      neutral: cells.filter((c) => c.mult === 1).length,
    };
  });
}

// Offensive coverage: for each defending type, the best multiplier any of the
// team's attacking-move types achieves. `members` carry `attackTypes:string[]`.
export function offensiveCoverage(members) {
  const moveTypes = new Set();
  for (const m of members) for (const t of m.attackTypes || []) moveTypes.add(norm(t));
  const types = [...moveTypes];
  return TYPES.map((def) => {
    let best = 0;
    let hitter = null;
    for (const at of types) {
      const e = effectiveness(at, [def]);
      if (e > best) { best = e; hitter = at; }
    }
    return { type: def, best: types.length ? best : 1, hitter };
  });
}

// Speed tiers — members sorted by computed Speed (desc), with +1 and Scarf
// variants for quick comparison.
export function speedTiers(members) {
  return members
    .map((m) => {
      const base = m.spe;
      return {
        name: m.name, base,
        plus1: Math.floor(base * 1.5),
        scarf: Math.floor(base * 1.5),
      };
    })
    .sort((a, b) => b.base - a.base);
}
