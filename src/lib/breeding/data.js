// Reference data for the Breeding Planner. Static, hand-curated where the
// in-game logic isn't expressible from pokemmo.json alone.

// Mons that cannot breed at all (legendaries, mythicals, babies, Ditto×Ditto
// is excluded separately, plus a handful of one-off un-breedables).
//
// Babies (Pichu, Cleffa, etc.) are listed here so they can never appear as a
// parent slot — a Pichu must evolve into Pikachu first to breed. The user
// targets the BABY when planning Volt Tackle / Incense lines, but the parent
// is always the evolved form.
export const BABY_IDS = new Set([
  172, // Pichu
  173, // Cleffa
  174, // Igglybuff
  175, // Togepi
  236, // Tyrogue
  238, // Smoochum
  239, // Elekid
  240, // Magby
  298, // Azurill
  360, // Wynaut
  406, // Budew
  433, // Chingling
  438, // Bonsly
  439, // Mime Jr.
  440, // Happiny
  446, // Munchlax
  447, // Riolu
  458, // Mantyke
]);

// Legendaries / mythicals / one-offs that can't breed.
export const UNBREEDABLE_IDS = new Set([
  132,                                // Ditto
  144, 145, 146, 150, 151,            // Articuno, Zapdos, Moltres, Mewtwo, Mew
  201,                                // Unown
  243, 244, 245, 249, 250, 251,       // Raikou/Entei/Suicune, Lugia/Ho-Oh, Celebi
  292,                                // Shedinja
  377, 378, 379, 380, 381, 382, 383, 384, 385, 386, // Regis + Hoenn legendaries
  480, 481, 482, 483, 484, 485, 486, 487, 488, 489, 490, 491, 492, 493, // Sinnoh legendaries
  494,                                // Victini
  638, 639, 640, 641, 642, 643, 644, 645, 646, 647, // Unova legendaries
]);

// Genderless evolution lines. A genderless Pokémon can only breed within its
// own line (with the same line's mons) or with Ditto.
export const GENDERLESS_LINES = [
  [81, 82, 462],                  // Magnemite, Magneton, Magnezone
  [100, 101],                     // Voltorb, Electrode
  [120, 121],                     // Staryu, Starmie
  [137, 233, 474],                // Porygon line
  [201],                          // Unown (unbreedable anyway, included for completeness)
  [337, 338],                     // Lunatone, Solrock
  [343, 344],                     // Baltoy, Claydol
  [374, 375, 376],                // Beldum, Metang, Metagross
  [436, 437],                     // Bronzor, Bronzong
  [479],                          // Rotom (forms — treat as one)
  [599, 600, 601],                // Klink, Klang, Klinklang
  [615],                          // Cryogonal
  [622, 623],                     // Golett, Golurk
];
const _genderlessSet = new Set();
for (const line of GENDERLESS_LINES) for (const id of line) _genderlessSet.add(id);
export function isGenderless(pokemon) {
  if (!pokemon) return false;
  if (pokemon.gender_ratio === -1) return true;
  return _genderlessSet.has(pokemon.id);
}
export function genderlessLineOf(pokemonId) {
  return GENDERLESS_LINES.find((line) => line.includes(pokemonId)) || null;
}

export function genderRatioCategory(pokemon) {
  if (isGenderless(pokemon)) return 'genderless';
  const r = pokemon?.gender_ratio;
  if (r === 0)   return 'male-only';
  if (r === 254) return 'female-only';
  return 'mixed';
}

// All 25 natures.
export const NATURE_NAMES = [
  'Hardy', 'Lonely', 'Brave', 'Adamant', 'Naughty',
  'Bold',  'Docile', 'Relaxed', 'Impish', 'Lax',
  'Timid', 'Hasty', 'Serious', 'Jolly',  'Naive',
  'Modest', 'Mild', 'Quiet', 'Bashful', 'Rash',
  'Calm',  'Gentle', 'Sassy', 'Careful', 'Quirky',
];

// IV stat keys in canonical display order.
export const IV_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
export const IV_LABELS = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };

export const POWER_ITEM_FOR = {
  hp:  'Power Weight',
  atk: 'Power Bracer',
  def: 'Power Belt',
  spa: 'Power Lens',
  spd: 'Power Band',
  spe: 'Power Anklet',
};

// Per-stat 1×31 carrier prices. Each stat row holds a price per role tier:
//   targetM — male of the target species at 1×31 in this stat
//   targetF — female of the target species at 1×31 in this stat
//   target  — genderless target species at 1×31 in this stat (== a member of
//             the same evolution line for genderless families)
//   groupM  — cheapest male of the same egg group at 1×31 in this stat
//   groupF  — cheapest female of the same egg group at 1×31 in this stat.
//             Off-meta females are often cheaper than males in PokeMMO since
//             players don't team-build with them but breeders still want them.
//   ditto   — Ditto at 1×31 in this stat
//
// Defaults reflect rough PokeMMO market reality. Atk / SpA / Spe stats tend
// to cost more than HP / Def / SpD because they're in higher demand.
export const DEFAULT_PER_STAT_PRICES = {
  hp:  { targetM: 30000, targetF: 80000,  target: 30000, groupM: 5000, groupF: 4000, ditto: 10000 },
  atk: { targetM: 50000, targetF: 150000, target: 50000, groupM: 8000, groupF: 6000, ditto: 20000 },
  def: { targetM: 30000, targetF: 80000,  target: 30000, groupM: 5000, groupF: 4000, ditto: 10000 },
  spa: { targetM: 50000, targetF: 150000, target: 50000, groupM: 8000, groupF: 6000, ditto: 20000 },
  spd: { targetM: 30000, targetF: 80000,  target: 30000, groupM: 5000, groupF: 4000, ditto: 10000 },
  spe: { targetM: 50000, targetF: 150000, target: 50000, groupM: 8000, groupF: 6000, ditto: 20000 },
};

// Default consumable prices (per piece, all consumable per breed).
export const DEFAULT_CONSUMABLE_PRICES = {
  powerItem: 10000,
  everstone: 5000,
};

// 0×31 base prices per role tier. A 0×31 mon has no perfect IVs — it's a
// species placeholder used in breed-up steps to force a 1×31 from a foreign
// species via Power Item. Cheaper than per-stat 1×31 prices because off-meta
// species with no IV value flood the market.
export const DEFAULT_BASE_PRICES = {
  targetM: 2000,
  targetF: 5000,
  target:  2000, // genderless line member 0×31
  groupM:  1000,
  groupF:  1000,
  ditto:   5000,
};

// Egg fee — uses the species gender ratio bracket and the requested child gender.
//
// Brackets:
//   r=31  → 1F:7M (female rare)  → male $5k, female $21k
//   r=63  → 1F:3M (female rare)  → male $5k, female $9k
//   r=127 → 1F:1M (balanced)     → either $5k
//   r=191 → 3F:1M (male rare)    → male $9k,  female $5k
//   r=223 → 7F:1M (male rare)    → male $21k, female $5k
//
// Genderless species have no fee. 100%-male/female species can't produce the
// opposite gender at any price (Infinity).
export function eggFee(speciesGenderRatio, childGender) {
  if (speciesGenderRatio === -1) return 0;
  if (speciesGenderRatio === 0   && childGender === 'F') return Infinity;
  if (speciesGenderRatio === 254 && childGender === 'M') return Infinity;
  if (speciesGenderRatio === 0   && childGender === 'M') return 0;
  if (speciesGenderRatio === 254 && childGender === 'F') return 0;
  if (speciesGenderRatio === 127) return 5000;

  const isFRare = speciesGenderRatio < 127;
  const isMRare = speciesGenderRatio > 127;
  const requestingRare =
    (childGender === 'F' && isFRare) ||
    (childGender === 'M' && isMRare);

  let bucket;
  if (speciesGenderRatio === 31  || speciesGenderRatio === 223) bucket = '1:7';
  else if (speciesGenderRatio === 63 || speciesGenderRatio === 191) bucket = '1:3';
  else bucket = '1:1';

  if (bucket === '1:7') return requestingRare ? 21000 : 5000;
  if (bucket === '1:3') return requestingRare ? 9000  : 5000;
  return 5000;
}

// Heuristic "is this mon breedable in PokeMMO planning context"?
export function canBreed(pokemon) {
  if (!pokemon) return false;
  if (BABY_IDS.has(pokemon.id))      return false;
  if (UNBREEDABLE_IDS.has(pokemon.id)) return false;
  const groups = pokemon.egg_groups || [];
  if (groups.length === 0) return false;
  const lc = groups.map((g) => String(g).toLowerCase());
  if (lc.every((g) => /no[ _]eggs|undiscovered|cannot[ _]breed/.test(g))) return false;
  return true;
}
