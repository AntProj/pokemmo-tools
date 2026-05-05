// Catch chance formula + Poké Ball multipliers, ported verbatim from c4vv's
// PokeMMO CatchCalc (https://github.com/c4vv/CatchCalc — pokeballs.js +
// listeners.js). Pure functions — no React, no state.

/* ─────────────── Status conditions ─────────────── */

export const STATUS_OPTIONS = [
  { key: 'none',         label: 'None',           mult: 1.0 },
  { key: 'paralyzed',    label: 'Paralyzed',      mult: 1.5 },
  { key: 'burned',       label: 'Burned',         mult: 1.5 },
  { key: 'poisoned',     label: 'Poisoned',       mult: 1.5 },
  { key: 'badpoisoned',  label: 'Badly Poisoned', mult: 1.5 },
  { key: 'frozen',       label: 'Frozen',         mult: 2.0 },
  { key: 'asleep',       label: 'Asleep',         mult: 2.0 },
];
export function statusMultOf(key) {
  return STATUS_OPTIONS.find((s) => s.key === key)?.mult ?? 1.0;
}

/* ─────────────── PokeMMO catch-rate overrides ─────────────── */

const POKEMMO_OVERRIDES = (() => {
  const m = new Map();
  m.set(374, { value: 25, base: 3, source: 'beldum' });
  m.set(375, { value: 20, base: 3, source: 'beldum' });
  m.set(376, { value: 15, base: 3, source: 'beldum' });
  for (const id of [2, 5, 8, 153, 156, 159, 253, 256, 259, 388, 391, 394, 496, 499, 502]) {
    m.set(id, { value: 30, base: 45, source: 'starter2' });
  }
  for (const id of [3, 6, 9, 154, 157, 160, 254, 257, 260, 389, 392, 395, 497, 500, 503]) {
    m.set(id, { value: 15, base: 45, source: 'starter3' });
  }
  return m;
})();

export function effectiveCatchRate(pokemon, { alpha = false, manual = null } = {}) {
  const dataRate = pokemon?.catch_rate ?? null;
  const ovr = pokemon ? POKEMMO_OVERRIDES.get(pokemon.id) : null;
  const canonicalBase = ovr ? ovr.base : dataRate;
  if (manual != null && Number.isFinite(manual)) {
    return { value: manual, base: canonicalBase, source: 'manual' };
  }
  if (alpha) return { value: 10, base: canonicalBase, source: 'alpha' };
  if (!pokemon) return { value: dataRate, base: canonicalBase, source: 'base' };
  if (ovr) return { value: ovr.value, base: ovr.base, source: ovr.source };
  return { value: dataRate, base: canonicalBase, source: 'base' };
}

/* ─────────────── Friend / Moon evolution lookups (from c4vv) ─────────────── */

const FRIEND_EVO_IDS = new Set([
  42,   // Golbat
  52,   // Meowth
  113,  // Chansey
  169,  // Crobat
  172,  // Pichu
  173,  // Cleffa
  174,  // Igglybuff
  175,  // Togepi
  298,  // Azurill
]);
const MOON_EVO_IDS = new Set([
  30,   // Nidorina
  33,   // Nidorino
  35,   // Clefairy
  39,   // Jigglypuff
  300,  // Skitty
]);

/* ─────────────── Catch formula (verbatim port of listeners.js) ─────────────── */

// hp is a percentage (1..100). Status mult comes pre-multiplied; ball mult too.
// c4vv's formula: no floor, no 255 cap, just `Math.max(1, ...)` floor on x.
export function catchChance({ catchRate, hp, ballMult, statusMult }) {
  if (!catchRate || catchRate <= 0) return 0;
  const x = Math.max(
    1,
    (3 * 100 - 2 * hp) * (catchRate * ballMult) / (3 * 100) * statusMult
  );
  const y = 1048560 / Math.sqrt(Math.sqrt(16711680 / x));
  const chance = y / 65536;
  return Math.min(1, Math.pow(chance, 4));
}

/* ─────────────── Ball multipliers (c4vv values) ─────────────── */

// Each ball has `effect(ctx) → { mult, note, condMet }`.
// ctx fields:
//   pokemon, types[], weight (hg), speed (base), hp, turn, chain, level,
//   night, cave, water, catchRate
//
// Where c4vv's reference implementation hardcodes a multiplier (assuming ideal
// use), we still expose conditional inputs and only apply the bonus when the
// matching condition is true. That keeps the per-throw numbers honest in
// situations the user actually faces.
// Notes pulled from the PokeMMO Wiki ball table — same wording the in-game
// reference uses, slightly trimmed to fit the column. The note is constant
// per ball; condMet drives the dim-when-inactive styling.
export const BALLS = [
  {
    key: 'master', name: 'Master Ball',
    effect: () => ({ mult: 255, note: '100% guaranteed catch', condMet: true, guaranteed: true }),
  },
  {
    key: 'ultra', name: 'Ultra Ball',
    effect: () => ({ mult: 2.0, note: '2×', condMet: true }),
  },
  {
    key: 'great', name: 'Great Ball',
    effect: () => ({ mult: 1.5, note: '1.5×', condMet: true }),
  },
  {
    key: 'poke', name: 'Poké Ball',
    effect: () => ({ mult: 1.0, note: '1×', condMet: true }),
  },
  {
    key: 'premier', name: 'Premier Ball',
    effect: () => ({ mult: 1.5, note: '1.5×', condMet: true }),
  },
  {
    key: 'safari', name: 'Safari Ball',
    effect: () => ({ mult: 1.5, note: '1.5× — Safari Zones only', condMet: true }),
  },
  {
    key: 'cherish', name: 'Cherish Ball',
    effect: () => ({ mult: 2.0, note: '2×', condMet: true }),
  },
  {
    key: 'luxury', name: 'Luxury Ball',
    effect: () => ({ mult: 1.0, note: '1× — doubles friendship gain after capture', condMet: true }),
  },
  {
    key: 'heal', name: 'Heal Ball',
    effect: () => ({ mult: 1.25, note: '1.25× — fully restores HP, PP, and status', condMet: true }),
  },
  {
    key: 'net', name: 'Net Ball',
    effect: ({ types }) => {
      const t = (types || []).map((x) => x.toLowerCase());
      const ok = t.includes('water') || t.includes('bug');
      const note = '3.5× on Water- or Bug-type Pokémon; 1× otherwise';
      return ok
        ? { mult: 3.5, note, condMet: true }
        : { mult: 1.0, note, condMet: false };
    },
  },
  {
    key: 'dive', name: 'Dive Ball',
    effect: ({ water }) => {
      const note = '3.5× on water-dwelling Pokémon; 1× otherwise';
      return water
        ? { mult: 3.5, note, condMet: true }
        : { mult: 1.0, note, condMet: false };
    },
  },
  {
    key: 'lure', name: 'Lure Ball',
    effect: ({ water }) => {
      const note = '4× on a Pokémon hooked by a fishing rod; 1× otherwise';
      return water
        ? { mult: 4.0, note, condMet: true }
        : { mult: 1.0, note, condMet: false };
    },
  },
  {
    key: 'nest', name: 'Nest Ball',
    effect: ({ level }) => {
      // c4vv: min(max(7 - 0.2*(level-1), 1.0), 4.0)
      const note = '(7 − 0.2×(level−1))×, between 1× and 4×';
      if (!Number.isFinite(level)) return { mult: 1.0, note, condMet: false };
      const m = Math.min(Math.max(7 - 0.2 * (level - 1), 1.0), 4.0);
      return { mult: m, note, condMet: m > 1.001 };
    },
  },
  {
    key: 'repeat', name: 'Repeat Ball',
    effect: ({ chain }) => {
      // c4vv: min(2.5, 1 + chainCount/10) — increases per successive catch
      const note = 'Up to 2.5× per successive catch of same species; resets on a different one';
      const n = Number.isFinite(chain) && chain > 0 ? chain : 0;
      const m = Math.min(2.5, 1 + n / 10);
      return { mult: m, note, condMet: n > 0 };
    },
  },
  {
    key: 'timer', name: 'Timer Ball',
    effect: ({ turn }) => {
      // c4vv: 1 + min(3, turnsCompleted*0.3); max 4× at turn 11, min 1× turn 1
      const note = '(1 + turn × 0.30)×, max 4× at 11 turns, min 1× on turn 1';
      const t = Number.isFinite(turn) && turn > 0 ? turn : 1;
      const turnsCompleted = Math.max(0, t - 1);
      const m = 1 + Math.min(3, turnsCompleted * 0.3);
      return { mult: m, note, condMet: m > 1.001 };
    },
  },
  {
    key: 'quick', name: 'Quick Ball',
    effect: ({ turn }) => {
      const note = '5× on the first turn of a battle; 1× otherwise';
      return turn === 1
        ? { mult: 5.0, note, condMet: true }
        : { mult: 1.0, note, condMet: false };
    },
  },
  {
    key: 'dusk', name: 'Dusk Ball',
    effect: ({ night, cave }) => {
      const note = '2.5× in a cave or at night; 1× otherwise';
      return (night || cave)
        ? { mult: 2.5, note, condMet: true }
        : { mult: 1.0, note, condMet: false };
    },
  },
  {
    key: 'heavy', name: 'Heavy Ball',
    effect: ({ weight }) => {
      // c4vv weight thresholds in hectograms.
      const note = 'Higher rate on heavier Pokémon, up to 4×';
      if (weight >= 3000) return { mult: 4.0, note, condMet: true };
      if (weight >= 2000) return { mult: 3.0, note, condMet: true };
      if (weight >= 1000) return { mult: 2.0, note, condMet: true };
      return { mult: 1.0, note, condMet: false };
    },
  },
  {
    key: 'fast', name: 'Fast Ball',
    effect: ({ pokemon }) => {
      const note = '4× on Pokémon with base Speed ≥ 100; 1× otherwise';
      const spd = pokemon?.stats?.speed ?? 0;
      return spd >= 100
        ? { mult: 4.0, note, condMet: true }
        : { mult: 1.0, note, condMet: false };
    },
  },
  {
    key: 'friend', name: 'Friend Ball',
    effect: ({ pokemon }) => {
      const note = '2.5× on Pokémon that evolve via friendship; 1× otherwise';
      return FRIEND_EVO_IDS.has(pokemon?.id)
        ? { mult: 2.5, note, condMet: true }
        : { mult: 1.0, note, condMet: false };
    },
  },
  {
    key: 'moon', name: 'Moon Ball',
    effect: ({ pokemon }) => {
      const note = '4× on Pokémon that evolve via Moon Stone; 1× otherwise';
      return MOON_EVO_IDS.has(pokemon?.id)
        ? { mult: 4.0, note, condMet: true }
        : { mult: 1.0, note, condMet: false };
    },
  },
  {
    key: 'level', name: 'Level Ball',
    // c4vv: 4× unconditionally (assumes you match the target's level). The
    // calc has no "your level" input so we hardcode the c4vv ideal.
    effect: () => ({ mult: 4.0, note: '4× when matching opponent’s level', condMet: true }),
  },
  {
    key: 'love', name: 'Love Ball',
    // c4vv: 8× assuming same species, opposite gender.
    effect: () => ({ mult: 8.0, note: '8× on same-line, opposite-gender; 1× on genderless or otherwise', condMet: true }),
  },
];

/* ─────────────── Aggregate compute ─────────────── */

export function computeAllBalls(ctx) {
  const { hp, statusMult, catchRate } = ctx;
  return BALLS.map((b) => {
    const eff = b.effect(ctx);
    const guaranteed = eff.guaranteed === true;
    const chance = guaranteed
      ? 1.0
      : catchChance({ catchRate, hp, ballMult: eff.mult, statusMult });
    return {
      key: b.key,
      name: b.name,
      mult: eff.mult,
      note: eff.note,
      condMet: eff.condMet,
      chance,
      guaranteed,
    };
  });
}
