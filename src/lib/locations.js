// Encounter-method icons live in `components/MethodIcon.jsx` now — lucide line
// icons (replacing the old emoji) so the Locations / encounter UI matches the
// rest of the app in both themes.

// Display order for the regions, used by the Region sort and by region grouping.
export const REGION_ORDER = ['Kanto', 'Johto', 'Hoenn', 'Sinnoh', 'Unova'];

// Easiest → hardest order so "Rarity easiest first" puts Very Common at top.
export const RARITY_ORDER = [
  'Very Common', 'Common', 'Uncommon', 'Rare', 'Very Rare',
  'Lure', 'Horde', 'Special',
];

export function rarityRank(r) {
  const i = RARITY_ORDER.indexOf(r);
  return i === -1 ? RARITY_ORDER.length : i;
}

export function regionRank(r) {
  const i = REGION_ORDER.indexOf(r);
  return i === -1 ? REGION_ORDER.length : i;
}

// Locations like "Route 30 (Day/Morning/SEASON1)" carry their availability info
// only as a suffix on the name. Parse it into a base name plus structured
// times/seasons so we can group variants and tag rows.
const TIME_TOKENS = new Set(['day', 'night', 'morning']);

export function parseLocation(name) {
  if (!name) return { base: '', times: [], seasons: [] };
  const m = String(name).match(/^\s*(.*?)\s*\(([^)]+)\)\s*$/);
  if (!m) return { base: name.trim(), times: [], seasons: [] };
  const base = m[1].trim();
  const tokens = m[2].split('/').map((t) => t.trim());
  const times = [];
  const seasons = [];
  for (const tok of tokens) {
    const lo = tok.toLowerCase();
    if (TIME_TOKENS.has(lo)) {
      const cap = lo.charAt(0).toUpperCase() + lo.slice(1);
      if (!times.includes(cap)) times.push(cap);
    } else {
      const sm = lo.match(/^season(\d+)$/);
      if (sm) {
        const n = Number(sm[1]);
        if (!seasons.includes(n)) seasons.push(n);
      }
    }
  }
  seasons.sort((a, b) => a - b);
  return { base, times, seasons };
}

export function baseLocation(name) {
  return parseLocation(name).base;
}
