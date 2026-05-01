// Standard Pokémon type colors. Keys are normalized lowercase so callers
// can pass any-case strings ('Grass', 'GRASS', 'grass').
const TYPE_COLOR_MAP = {
  normal:   { bg: '#A8A77A', fg: '#ffffff' },
  fire:     { bg: '#EE8130', fg: '#ffffff' },
  water:    { bg: '#6390F0', fg: '#ffffff' },
  electric: { bg: '#F7D02C', fg: '#1c1917' },
  grass:    { bg: '#7AC74C', fg: '#ffffff' },
  ice:      { bg: '#96D9D6', fg: '#1c1917' },
  fighting: { bg: '#C22E28', fg: '#ffffff' },
  poison:   { bg: '#A33EA1', fg: '#ffffff' },
  ground:   { bg: '#E2BF65', fg: '#1c1917' },
  flying:   { bg: '#A98FF3', fg: '#ffffff' },
  psychic:  { bg: '#F95587', fg: '#ffffff' },
  bug:      { bg: '#A6B91A', fg: '#ffffff' },
  rock:     { bg: '#B6A136', fg: '#ffffff' },
  ghost:    { bg: '#735797', fg: '#ffffff' },
  dragon:   { bg: '#6F35FC', fg: '#ffffff' },
  dark:     { bg: '#705746', fg: '#ffffff' },
  steel:    { bg: '#B7B7CE', fg: '#1c1917' },
  fairy:    { bg: '#D685AD', fg: '#ffffff' },
};

export function typeColor(type) {
  if (!type) return { bg: '#9ca3af', fg: '#ffffff' };
  return TYPE_COLOR_MAP[String(type).toLowerCase()] || { bg: '#9ca3af', fg: '#ffffff' };
}

export function normalizeType(type) {
  if (!type) return '';
  const s = String(type).toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const ALL_POKEMON_TYPES = [
  'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison',
  'Ground', 'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark',
  'Steel', 'Fairy',
];

// Rarity → Tailwind classes for badges.
export const RARITY_COLORS = {
  'Very Common': { bg: 'bg-emerald-500',  fg: 'text-white' },
  'Common':      { bg: 'bg-green-400',    fg: 'text-stone-900' },
  'Uncommon':    { bg: 'bg-yellow-400',   fg: 'text-stone-900' },
  'Rare':        { bg: 'bg-orange-500',   fg: 'text-white' },
  'Very Rare':   { bg: 'bg-red-500',      fg: 'text-white' },
  'Lure':        { bg: 'bg-blue-500',     fg: 'text-white' },
  'Horde':       { bg: 'bg-amber-500',    fg: 'text-white' },
  'Special':     { bg: 'bg-purple-500',   fg: 'text-white' },
};

export function rarityClasses(rarity) {
  return RARITY_COLORS[rarity] || { bg: 'bg-stone-400', fg: 'text-white' };
}
