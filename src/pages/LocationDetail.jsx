import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Sun, Moon, Sunrise, MapPin, ChevronLeft } from 'lucide-react';
import RarityBadge from '../components/RarityBadge.jsx';
import MethodIcon from '../components/MethodIcon.jsx';
import { PokemonCardBody } from '../components/PokemonCard.jsx';
import { rarityRank, parseLocation } from '../lib/locations.js';

/**
 * A location's encounter list, rendered INLINE in the Locations page's right
 * pane (not a modal). Shows the Pokémon found here as Pokédex-style cards, each
 * with its method / level range / rarity / time. Respects the page's global
 * method + rarity filters. Clicking a card opens the shared Pokémon detail modal
 * via `onSelect`.
 */
export function LocationDetailPane({ data, region, locName, methods = [], rarities = [], onSelect, onBack }) {
  // Only Sinnoh + Johto have interactive maps; offer a jump when relevant.
  const mapRegion = ['sinnoh', 'johto'].includes(region.toLowerCase()) ? region.toLowerCase() : null;

  // Cross-reference each Pokémon's own locations array for level ranges (the
  // reverse index doesn't carry levels).
  const encounters = useMemo(() => {
    const out = [];
    const lcLoc = locName.toLowerCase();
    for (const p of data.pokemon) {
      for (const loc of (p.locations || [])) {
        if (loc.region !== region) continue;
        const parsed = parseLocation(loc.location);
        if (parsed.base.toLowerCase() !== lcLoc) continue;
        out.push({ ...loc, pokemon: p, times: parsed.times, seasons: parsed.seasons });
      }
    }
    return out;
  }, [data.pokemon, region, locName]);

  const groupedCards = useMemo(() => {
    let pool = encounters;
    if (methods.length) pool = pool.filter((e) => methods.includes(e.method));
    if (rarities.length) pool = pool.filter((e) => rarities.includes(e.rarity));

    // Group by mon, then collapse encounters that are identical in
    // method/rarity/level and differ only by season or time into a single
    // entry (unioning the times/seasons) so a mon found in grass all year
    // shows one line, not four near-identical ones.
    const byId = new Map();
    for (const e of pool) {
      let card = byId.get(e.pokemon.id);
      if (!card) { card = { pokemon: e.pokemon, _byKey: new Map() }; byId.set(e.pokemon.id, card); }
      const key = [e.method, e.rarity, e.min_level, e.max_level].join('::');
      let entry = card._byKey.get(key);
      if (!entry) {
        entry = { method: e.method, rarity: e.rarity, min_level: e.min_level, max_level: e.max_level, times: new Set(), seasons: new Set() };
        card._byKey.set(key, entry);
      }
      for (const t of e.times) entry.times.add(t);
      for (const s of e.seasons) entry.seasons.add(s);
    }
    const cards = [...byId.values()].map(({ pokemon, _byKey }) => ({
      pokemon,
      entries: [..._byKey.values()].map((en) => ({
        ...en,
        times: [...en.times].sort(),
        seasons: [...en.seasons].sort((a, b) => a - b),
      })),
    }));
    for (const c of cards) {
      c.entries.sort((a, b) => rarityRank(a.rarity) - rarityRank(b.rarity) || a.method.localeCompare(b.method));
    }
    const bestRarity = (c) => Math.min(...c.entries.map((e) => rarityRank(e.rarity)));
    cards.sort((a, b) => bestRarity(a) - bestRarity(b) || a.pokemon.name.localeCompare(b.pokemon.name));
    return cards;
  }, [encounters, methods, rarities]);

  const totalDistinct = useMemo(() => new Set(encounters.map((e) => e.pokemon.id)).size, [encounters]);
  const filtered = methods.length > 0 || rarities.length > 0;

  return (
    <div>
      {/* Header: back to the list + location name + map link + count */}
      <div className="mb-3 flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-sm text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100"
        >
          <ChevronLeft size={16} /> Locations
        </button>
        <span className="text-stone-300 dark:text-stone-600" aria-hidden>/</span>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">{region}</span>
        <h2 className="font-bold text-lg text-stone-900 dark:text-stone-100 truncate min-w-0">{locName}</h2>
        {mapRegion && (
          <Link
            to={`/map/${mapRegion}`}
            className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
            title={`Open the ${region} interactive map`}
          >
            <MapPin size={12} /> View on map
          </Link>
        )}
        <span className="ml-auto text-xs text-stone-500 dark:text-stone-400 tabular-nums">
          {filtered ? `${groupedCards.length} of ${totalDistinct}` : totalDistinct} Pokémon
        </span>
      </div>

      {groupedCards.length === 0 ? (
        <div className="py-12 text-center text-stone-500 dark:text-stone-400 text-sm">
          {totalDistinct === 0
            ? 'No encounter data for this location.'
            : 'No Pokémon here match the current method / rarity filters.'}
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4">
          {groupedCards.map((card) => (
            <LocationMonCard
              key={card.pokemon.id}
              pokemon={card.pokemon}
              entries={card.entries}
              region={region}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────── Pokédex-style card for a mon at this location ─────────────── */

function LocationMonCard({ pokemon, entries, region, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(pokemon.id)}
      className="group flex flex-col items-center text-center p-3 rounded-lg
                 bg-[#fdf8e9] border border-[#e6dabf] hover:border-[#c4b486] hover:shadow-md
                 dark:bg-stone-900 dark:border-stone-800 dark:hover:border-stone-600
                 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      <PokemonCardBody pokemon={pokemon} region={region} spriteClass="w-20 h-20 group-hover:scale-110 transition-transform" />
      <div className="mt-2 w-full space-y-1">
        {entries.map((e, i) => <EncounterStrip key={i} entry={e} />)}
      </div>
    </button>
  );
}

// One encounter shown as a compact, consistent block: method (+ time) on the
// first line, and the rarity badge + level range always together on the second,
// so nothing wraps onto a stray line the way a single flex-wrap row did.
function EncounterStrip({ entry }) {
  const { method, rarity, min_level, max_level, times = [], seasons = [] } = entry;
  const lvl = min_level === max_level ? `Lv ${min_level}` : `Lv ${min_level}–${max_level}`;
  // All four seasons = always available, so the label carries no signal — hide it.
  const seasonLabel = seasons.length > 0 && seasons.length < 4 ? `S${seasons.join(',')}` : null;
  const hasWhen = times.length > 0 || !!seasonLabel;
  const whenTitle = [times.join(' / '), seasons.length ? `Season ${seasons.join(', ')}` : null]
    .filter(Boolean).join(' · ');
  return (
    <div className="rounded-md border border-[#e6dabf] dark:border-stone-800/70 bg-[#f1e9d2]/50 dark:bg-stone-800/25 px-1.5 py-1 text-xs">
      <div className="flex items-center justify-center gap-1 leading-tight font-medium text-stone-700 dark:text-stone-300">
        <MethodIcon method={method} size={12} />
        <span className="truncate">{method}</span>
        {hasWhen && (
          <span className="inline-flex items-center gap-0.5 text-stone-500 dark:text-stone-400" title={whenTitle}>
            <span aria-hidden className="text-stone-300 dark:text-stone-600">·</span>
            {times.includes('Morning') && <Sunrise size={11} />}
            {times.includes('Day') && <Sun size={11} />}
            {times.includes('Night') && <Moon size={11} />}
            {seasonLabel && <span>{seasonLabel}</span>}
          </span>
        )}
      </div>
      <div className="mt-1 flex items-center justify-center gap-2 leading-tight">
        <RarityBadge rarity={rarity} />
        <span className="font-mono tabular-nums text-stone-600 dark:text-stone-400">{lvl}</span>
      </div>
    </div>
  );
}
