// Wrapper around the vendored PokéMMO damage engine (a CommonJS @smogon/calc
// fork from github.com/c4vv/pokemmo-damage-calc with PokéMMO mechanics + data
// baked in). The React UI drives plain spec objects through here.

import * as calcNS from 'pokemmo-calc';

// The engine is CommonJS (with __esModule), so named exports aren't statically
// resolvable by Rollup. Import the namespace and pick whichever interop shape
// (dev/esbuild vs build/rollup) actually carries the API.
const Calc = calcNS && calcNS.calculate ? calcNS : (calcNS.default || calcNS);
const { Generations, Pokemon, Move, Field, calculate } = Calc;

// PokéMMO is a Gen 5/6 blend; the engine patches the deltas (1.5x crit,
// Snowscape, Sharpness/Neutralizing Gas, stat/move adjustments, …).
export const GEN = Generations.get(5);

export { Pokemon, Move, Field, calculate, Generations };

export const STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
export const STAT_LABELS = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };

function names(iterable) {
  const out = [];
  for (const x of iterable) if (x && x.name && x.exists !== false) out.push(x.name);
  return [...new Set(out)].sort((a, b) => a.localeCompare(b));
}
export const SPECIES_NAMES = names(GEN.species);
export const MOVE_NAMES    = names(GEN.moves);
export const ITEM_NAMES    = names(GEN.items);
export const ABILITY_NAMES = names(GEN.abilities);
export const NATURE_NAMES  = names(GEN.natures);
export const TYPE_NAMES    = names(GEN.types).filter((t) => t !== '???');

export const STATUSES = [
  ['', 'Healthy'], ['brn', 'Burned'], ['par', 'Paralyzed'], ['psn', 'Poisoned'],
  ['tox', 'Badly Poisoned'], ['slp', 'Asleep'], ['frz', 'Frozen'],
];
export const WEATHERS = ['', 'Sun', 'Rain', 'Sand', 'Hail', 'Snow'];
export const TERRAINS = ['', 'Electric', 'Grassy', 'Psychic', 'Misty'];

export function buildPokemon(spec) {
  if (!spec || !spec.name) return null;
  try {
    return new Pokemon(GEN, spec.name, {
      level: clampLevel(spec.level),
      nature: spec.nature || 'Hardy',
      ability: spec.ability || undefined,
      item: spec.item || undefined,
      evs: spec.evs || {},
      ivs: spec.ivs || {},
      boosts: spec.boosts || {},
      status: spec.status || '',
    });
  } catch {
    return null;
  }
}

export function buildField(spec) {
  spec = spec || {};
  try {
    return new Field({
      gameType: 'Singles',
      weather: spec.weather || undefined,
      terrain: spec.terrain || undefined,
      isGravity: !!spec.gravity,
      attackerSide: { isHelpingHand: !!spec.helpingHand },
      defenderSide: {
        isReflect: !!spec.reflect,
        isLightScreen: !!spec.lightScreen,
        isAuroraVeil: !!spec.auroraVeil,
      },
    });
  } catch {
    return new Field();
  }
}

// Compute one move's damage. Returns null on invalid input.
export function damage(attackerSpec, defenderSpec, moveName, fieldSpec, opts = {}) {
  const attacker = buildPokemon(attackerSpec);
  const defender = buildPokemon(defenderSpec);
  if (!attacker || !defender || !moveName) return null;
  let move;
  try { move = new Move(GEN, moveName, { isCrit: !!opts.crit }); } catch { return null; }
  let res;
  try { res = calculate(GEN, attacker, defender, move, buildField(fieldSpec)); } catch { return null; }

  const range = typeof res.range === 'function' ? res.range() : null;
  const maxHP = typeof defender.maxHP === 'function' ? defender.maxHP() : (defender.stats?.hp || 0);
  let desc = '';
  try { desc = res.desc(); } catch { /* some status moves have no desc */ }
  let ko = null;
  try { ko = res.kochance(); } catch { /* ignore */ }

  return {
    desc,
    range,
    pct: range && maxHP ? [round1((range[0] / maxHP) * 100), round1((range[1] / maxHP) * 100)] : null,
    ko,
    move: { name: moveName, category: move.category, type: move.type, bp: move.bp },
    maxHP,
  };
}

export function computedStats(spec) {
  const p = buildPokemon(spec);
  if (!p) return null;
  const s = p.stats || {};
  return { ...s, hp: typeof p.maxHP === 'function' ? p.maxHP() : s.hp };
}

function clampLevel(l) {
  const n = Math.round(Number(l));
  if (!Number.isFinite(n)) return 100;
  return Math.min(100, Math.max(1, n));
}
function round1(n) { return Math.round(n * 10) / 10; }
