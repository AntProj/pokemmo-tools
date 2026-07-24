import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Sun, Moon, MapPin, ChevronLeft } from 'lucide-react';
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

    const byId = new Map();
    for (const e of pool) {
      let card = byId.get(e.pokemon.id);
      if (!card) { card = { pokemon: e.pokemon, entries: [], _seen: new Set() }; byId.set(e.pokemon.id, card); }
      const stripKey = [
        e.method, e.rarity, e.min_level, e.max_level,
        [...e.times].sort().join('|'), [...e.seasons].sort().join('|'),
      ].join('::');
      if (card._seen.has(stripKey)) continue;
      card._seen.add(stripKey);
      card.entries.push(e);
    }
    const cards = [...byId.values()].map(({ _seen, ...rest }) => rest);
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

function EncounterStrip({ entry }) {
  const { method, rarity, min_level, max_level, times = [], seasons = [] } = entry;
  const lvl = min_level === max_level ? `Lv ${min_level}` : `Lv ${min_level}–${max_level}`;
  const hasWhen = times.length > 0 || seasons.length > 0;
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5 text-xs">
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#f1e9d2] dark:bg-stone-800/40 text-stone-700 dark:text-stone-300">
        <MethodIcon method={method} size={12} />{method}
      </span>
      <RarityBadge rarity={rarity} />
      <span className="font-mono tabular-nums text-stone-700 dark:text-stone-300">{lvl}</span>
      {hasWhen && (
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#f1e9d2] dark:bg-stone-800/40 text-stone-600 dark:text-stone-400"
          title={[times.join('/'), seasons.length ? `Seasons ${seasons.join(', ')}` : null].filter(Boolean).join(' · ')}
        >
          {times.includes('Day') && <Sun size={12} />}
          {times.includes('Night') && <Moon size={12} />}
          <span>
            {times.length > 0 && times.join(' · ')}
            {times.length > 0 && seasons.length > 0 && ' · '}
            {seasons.length > 0 && `S${seasons.join(',')}`}
          </span>
        </span>
      )}
    </div>
  );
}
