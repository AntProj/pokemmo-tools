// Wrapper around the vendored PokéMMO damage engine (a CommonJS @smogon/calc
// fork from github.com/c4vv/pokemmo-damage-calc with PokéMMO mechanics + data
// baked in). The React UI drives plain spec objects through here.

import * as calcNS from 'pokemmo-calc';

// The engine is CommonJS (with __esModule); its named exports aren't statically
// resolvable by Rollup. Resolve the API shape through a function so we don't
// reference members on the namespace binding directly — that both keeps the
// dev (esbuild) / build (rollup) interop working AND avoids Rollup's harmless
// "X is not exported" warnings.
function resolveCalc(ns) {
  if (ns && typeof ns.calculate === 'function') return ns;
  if (ns && ns.default) return ns.default;
  return ns;
}
const Calc = resolveCalc(calcNS);
const { Generations, Pokemon, Move, Field, calculate } = Calc;

// PokéMMO is a Gen 5/6 blend; the engine patches the deltas (1.5x crit,
// Snowscape, Sharpness/Neutralizing Gas, stat/move adjustments, …).
export const GEN = Generations.get(5);

export { Pokemon, Move, Field, calculate, Generations };

export const STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
export const STAT_LABELS = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };
export const CATEGORIES = ['Physical', 'Special', 'Status'];

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
export const GENDERS = ['', 'M', 'F'];

export function buildPokemon(spec) {
  if (!spec || !spec.name) return null;
  const overrides = {};
  const types = (spec.types || []).filter(Boolean);
  if (types.length) overrides.types = types;
  try {
    return new Pokemon(GEN, spec.name, {
      level: clampLevel(spec.level),
      nature: spec.nature || 'Hardy',
      ability: spec.ability || undefined,
      item: spec.item || undefined,
      gender: spec.gender || undefined,
      evs: spec.evs || {},
      ivs: spec.ivs || {},
      boosts: spec.boosts || {},
      status: spec.status || '',
      curHP: Number.isFinite(spec.curHP) ? spec.curHP : undefined,
      overrides: Object.keys(overrides).length ? overrides : undefined,
    });
  } catch {
    return null;
  }
}

// moveSpec: { name, bp, type, category, crit }
export function buildMove(spec) {
  if (!spec || !spec.name) return null;
  const overrides = {};
  if (spec.bp !== '' && spec.bp != null && Number.isFinite(Number(spec.bp))) overrides.basePower = Number(spec.bp);
  if (spec.type) overrides.type = spec.type;
  if (spec.category) overrides.category = spec.category;
  try {
    return new Move(GEN, spec.name, {
      isCrit: !!spec.crit,
      overrides: Object.keys(overrides).length ? overrides : undefined,
    });
  } catch {
    return null;
  }
}

// The engine's default BP / type / category for a move name (to seed the
// editable per-move fields).
export function moveDefaults(name) {
  try {
    const m = new Move(GEN, name);
    return { bp: m.bp || 0, type: m.type, category: m.category };
  } catch {
    return null;
  }
}

// The engine's species typing (to seed the editable type dropdowns).
export function speciesTypes(name) {
  try {
    return new Pokemon(GEN, name).types || [];
  } catch {
    return [];
  }
}

function side(s) {
  s = s || {};
  return {
    spikes: Number(s.spikes) || 0,
    isSR: !!s.sr,
    isReflect: !!s.reflect,
    isLightScreen: !!s.lightScreen,
    isAuroraVeil: !!s.auroraVeil,
    isProtected: !!s.protect,
    isSeeded: !!s.leechSeed,
    isForesight: !!s.foresight,
    isHelpingHand: !!s.helpingHand,
    isTailwind: !!s.tailwind,
    isFriendGuard: !!s.friendGuard,
    isFlowerGift: !!s.flowerGift,
    isSwitching: s.switching ? 'out' : undefined,
  };
}

export function buildField(g, atkSide, defSide) {
  g = g || {};
  try {
    return new Field({
      gameType: g.gameType || 'Singles',
      weather: g.weather || undefined,
      terrain: g.terrain || undefined,
      isGravity: !!g.gravity,
      isMagicRoom: !!g.magicRoom,
      isWonderRoom: !!g.wonderRoom,
      attackerSide: side(atkSide),
      defenderSide: side(defSide),
    });
  } catch {
    return new Field();
  }
}

// Compute one move. `field` is a prebuilt Field (so the caller can orient the
// attacker/defender sides per direction). Returns null on invalid input.
export function damage(attackerSpec, defenderSpec, moveSpec, field) {
  const attacker = buildPokemon(attackerSpec);
  const defender = buildPokemon(defenderSpec);
  const move = buildMove(moveSpec);
  if (!attacker || !defender || !move) return null;
  let res;
  try { res = calculate(GEN, attacker, defender, move, field); } catch { return null; }

  const range = typeof res.range === 'function' ? res.range() : null;
  const maxHP = typeof defender.maxHP === 'function' ? defender.maxHP() : (defender.stats?.hp || 0);
  let desc = '';
  try { desc = res.desc(); } catch { /* status moves */ }
  let ko = null;
  try { ko = res.kochance(); } catch { /* ignore */ }
  let rolls = null;
  const d = res.damage;
  if (Array.isArray(d) && typeof d[0] === 'number') rolls = d;
  else if (typeof d === 'number') rolls = [d];
  let recoil = null, recovery = null;
  try { const r = res.recoil(); if (r && r.text) recoil = r.text; } catch { /* ignore */ }
  try { const r = res.recovery(); if (r && r.text) recovery = r.text; } catch { /* ignore */ }

  return {
    desc,
    range,
    pct: range && maxHP ? [round1((range[0] / maxHP) * 100), round1((range[1] / maxHP) * 100)] : null,
    ko, rolls, recoil, recovery, maxHP,
    move: { name: moveSpec.name, category: move.category, type: move.type, bp: move.bp },
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
