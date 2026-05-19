export function dexNum(id) {
  return '#' + String(id).padStart(3, '0');
}

// Region keys used in pokemon.dex and as filter values.
const REGION_PREFIX = { kanto: 'K', johto: 'J', hoenn: 'H', sinnoh: 'S', unova: 'U' };

// Lower-case region key from a UI label like "Sinnoh" or "All". Returns null
// for "All" or anything not a known regional dex.
export function regionKey(region) {
  if (!region || region === 'All') return null;
  const k = region.toLowerCase();
  return k in REGION_PREFIX ? k : null;
}

// Display the dex number for a Pokémon in the current region context. With a
// regional key we show e.g. "S001"; otherwise the national "#001".
export function displayDex(pokemon, region) {
  const k = regionKey(region);
  if (k && pokemon.dex && pokemon.dex[k] > 0) {
    return REGION_PREFIX[k] + String(pokemon.dex[k]).padStart(3, '0');
  }
  return dexNum(pokemon.id);
}

// height is in decimeters (1 dm = 0.1 m).
export function formatHeight(decimeters) {
  if (decimeters == null) return '—';
  const meters = decimeters / 10;
  const totalInches = meters * 39.3701;
  const ft = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches - ft * 12);
  return `${meters.toFixed(1)} m (${ft}′${inches}″)`;
}

// weight is in hectograms (1 hg = 0.1 kg).
export function formatWeight(hectograms) {
  if (hectograms == null) return '—';
  const kg = hectograms / 10;
  const lb = kg * 2.20462;
  return `${kg.toFixed(1)} kg (${lb.toFixed(1)} lb)`;
}

// gender_ratio convention: -1 = genderless, 0 = 100% male, 254 = 100% female,
// otherwise value is the female chance out of 254 (e.g. 31 ≈ 12.5% female).
export function formatGenderRatio(ratio) {
  if (ratio == null || ratio === -1) return 'Genderless';
  if (ratio === 0) return '100% ♂';
  if (ratio === 254) return '100% ♀';
  const female = (ratio / 254) * 100;
  const male = 100 - female;
  return `${male.toFixed(1)}% ♂ / ${female.toFixed(1)}% ♀`;
}

export function genderSplit(ratio) {
  if (ratio == null || ratio === -1) return null;
  const female = (ratio / 254) * 100;
  return { male: 100 - female, female };
}

const STAT_LABELS = {
  hp: 'HP',
  attack: 'Atk',
  defense: 'Def',
  sp_attack: 'SpA',
  sp_defense: 'SpD',
  speed: 'Spe',
};

export const STAT_ORDER = ['hp', 'attack', 'defense', 'sp_attack', 'sp_defense', 'speed'];

export function statLabel(key) {
  return STAT_LABELS[key] || key;
}

export function statTotal(stats) {
  if (!stats) return 0;
  return STAT_ORDER.reduce((sum, k) => sum + (stats[k] || 0), 0);
}

// Bar fill clamps so 255 maxes out a bar; typical max base stat is ~180 but
// using 255 keeps the visual scale intuitive.
export function statBarPct(value) {
  return Math.max(0, Math.min(100, (value / 200) * 100));
}

// Color for stat bars based on value, low → red, high → green.
export function statBarColor(value) {
  if (value < 50) return '#ef4444';
  if (value < 80) return '#f59e0b';
  if (value < 110) return '#84cc16';
  if (value < 140) return '#10b981';
  return '#06b6d4';
}

const GROWTH_RATE_LABELS = {
  slow:                  'Slow',
  medium:                'Medium-Fast',
  medium_fast:           'Medium-Fast',
  medium_slow:           'Medium-Slow',
  fast:                  'Fast',
  fluctuating:           'Fluctuating',
  fast_then_very_slow:   'Fluctuating',
  erratic:               'Erratic',
  slow_then_very_fast:   'Erratic',
};

export function formatGrowthRate(rate) {
  if (!rate) return '—';
  const key = String(rate).toLowerCase().replace(/-/g, '_');
  return GROWTH_RATE_LABELS[key] || rate;
}

// Catch rate goes 3 (hardest) to 255 (easiest).
export function formatCatchRate(rate) {
  if (rate == null) return '—';
  return `${rate} / 255`;
}

// Evolution method → human-readable description.
// `val` semantics: LEVEL → minimum level; ITEM → item id (use item_name from data); HAPPINESS variants → ignore val.
export function formatEvolutionMethod(evo) {
  const t = evo.type;
  const v = evo.val;
  switch (t) {
    case 'LEVEL':                return v ? `Lv ${v}` : 'Level up';
    case 'ITEM':                 return evo.item_name ? `Use ${evo.item_name}` : 'Use item';
    case 'TRADE':                return 'Trade';
    case 'TRADE_WITH_ITEM':      return evo.item_name ? `Trade w/ ${evo.item_name}` : 'Trade w/ item';
    case 'HAPPINESS':            return 'High friendship';
    case 'HAPPINESS_DAY':        return 'Friendship (Day)';
    case 'HAPPINESS_NIGHT':      return 'Friendship (Night)';
    case 'LEVEL_LOCATION_1':     return v ? `Lv ${v} in Moss Rock area` : 'Moss Rock area';
    case 'LEVEL_LOCATION_2':     return v ? `Lv ${v} near Moss Rock` : 'Near Moss Rock';
    case 'LEVEL_LOCATION_3':     return v ? `Lv ${v} near Ice Rock` : 'Near Ice Rock';
    case 'LEVEL_WITH_SKILL':     return v ? `Lv ${v} w/ move learned` : 'Level up w/ move';
    case 'LEVEL_ITEM_DAY':       return evo.item_name ? `Hold ${evo.item_name} (Day)` : 'Hold item (Day)';
    case 'LEVEL_ITEM_NIGHT':     return evo.item_name ? `Hold ${evo.item_name} (Night)` : 'Hold item (Night)';
    case 'ATK_LESS_THAN_DEF':    return v ? `Lv ${v} (Atk < Def)` : 'Atk < Def';
    case 'ATK_GREATER_THAN_DEF': return v ? `Lv ${v} (Atk > Def)` : 'Atk > Def';
    case 'ATK_EQUAL_TO_DEF':     return v ? `Lv ${v} (Atk = Def)` : 'Atk = Def';
    case 'PERSONALITY_HIGH':     return v ? `Lv ${v} (high personality)` : 'High personality';
    case 'PERSONALITY_LOW':      return v ? `Lv ${v} (low personality)` : 'Low personality';
    case 'ITEM_MALE':            return evo.item_name ? `Use ${evo.item_name} (♂)` : 'Use item (♂)';
    case 'ITEM_FEMALE':          return evo.item_name ? `Use ${evo.item_name} (♀)` : 'Use item (♀)';
    case 'LEVEL_FEMALE':         return v ? `Lv ${v} (♀)` : 'Level up (♀)';
    case 'LEVEL_MALE':           return v ? `Lv ${v} (♂)` : 'Level up (♂)';
    case 'LEVEL_WITH_MONSTER':   return v ? `Lv ${v} w/ partner` : 'Level w/ partner';
    case 'MAX_BEAUTY':           return 'Max Beauty';
    case 'TRADE_FOR_OPPOSITE':   return 'Trade for opposite';
    case 'ALLOW_MONSTER_CREATION': return 'Triggers split evolution';
    case 'CREATE_EXTRA_MONSTER':   return 'Split-evo branch';
    default: return t.replace(/_/g, ' ').toLowerCase();
  }
}

export function damageClassIcon(cls) {
  switch (cls) {
    case 'PHYSICAL': return '⚔';
    case 'SPECIAL':  return '✦';
    case 'STATUS':   return '◇';
    default:         return '·';
  }
}

export function damageClassLabel(cls) {
  switch (cls) {
    case 'PHYSICAL': return 'Physical';
    case 'SPECIAL':  return 'Special';
    case 'STATUS':   return 'Status';
    default:         return cls || '—';
  }
}
