import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sun, Moon, MapPin } from 'lucide-react';
import Modal from '../components/Modal.jsx';
import TypeBadge from '../components/TypeBadge.jsx';
import RarityBadge from '../components/RarityBadge.jsx';
import PokemonSprite from '../components/PokemonSprite.jsx';
import { typeColor } from '../lib/types.js';
import { dexNum } from '../lib/format.js';
import { methodIcon, rarityRank, parseLocation } from '../lib/locations.js';

const SORT_OPTIONS = [
  { value: 'rarity-asc',  label: 'Rarity (easiest first)' },
  { value: 'rarity-desc', label: 'Rarity (hardest first)' },
  { value: 'name',        label: 'Name A→Z' },
  { value: 'dex',         label: 'Dex #' },
];

/**
 * A location's encounter list, shown as a MODAL popped from the Locations grid
 * (matching the Tracker Plan interaction — you stay on the list, the mons pop
 * over it). Replaces the old full-page LocationDetail. Clicking a mon opens the
 * shared Pokémon detail modal on top via `onSelect`.
 */
export function LocationModal({ data, region, locName, onSelect, onClose }) {
  // Only Sinnoh + Johto have interactive maps. When this location is in one of
  // them, offer a jump to that region's map overworld (lands on the overworld;
  // location names don't map 1:1 to map zone ids).
  const mapRegion = ['sinnoh', 'johto'].includes(region.toLowerCase())
    ? region.toLowerCase()
    : null;

  // Cross-reference each pokemon's own locations array to get level ranges.
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

  const { allMethods, allRarities } = useMemo(() => {
    const ms = new Set(), rs = new Set();
    for (const e of encounters) { ms.add(e.method); rs.add(e.rarity); }
    return {
      allMethods: [...ms],
      allRarities: [...rs].sort((a, b) => rarityRank(a) - rarityRank(b)),
    };
  }, [encounters]);

  const [methodFilter, setMethodFilter] = useState(null);
  const [rarityFilter, setRarityFilter] = useState(null);
  const [timeFilter, setTimeFilter] = useState(null);
  const [sort, setSort] = useState('rarity-asc');

  const allTimes = useMemo(() => {
    const s = new Set();
    for (const e of encounters) for (const t of e.times) s.add(t);
    return ['Day', 'Night', 'Morning'].filter((t) => s.has(t));
  }, [encounters]);

  const groupedCards = useMemo(() => {
    let pool = encounters;
    if (methodFilter && methodFilter.length > 0) pool = pool.filter((e) => methodFilter.includes(e.method));
    if (rarityFilter && rarityFilter.length > 0) pool = pool.filter((e) => rarityFilter.includes(e.rarity));
    if (timeFilter)  pool = pool.filter((e) => e.times.length === 0 || e.times.includes(timeFilter));

    const byId = new Map();
    for (const e of pool) {
      let card = byId.get(e.pokemon.id);
      if (!card) {
        card = { pokemon: e.pokemon, entries: [], _seen: new Set() };
        byId.set(e.pokemon.id, card);
      }
      const stripKey = [
        e.method, e.rarity, e.min_level, e.max_level,
        [...e.times].sort().join('|'),
        [...e.seasons].sort().join('|'),
      ].join('::');
      if (card._seen.has(stripKey)) continue;
      card._seen.add(stripKey);
      card.entries.push(e);
    }
    const cards = [...byId.values()].map(({ _seen, ...rest }) => rest);

    for (const c of cards) {
      c.entries.sort((a, b) => rarityRank(a.rarity) - rarityRank(b.rarity)
                           || a.method.localeCompare(b.method));
    }
    function bestRarity(c) { return Math.min(...c.entries.map((e) => rarityRank(e.rarity))); }
    function worstRarity(c) { return Math.max(...c.entries.map((e) => rarityRank(e.rarity))); }

    if (sort === 'rarity-asc')       cards.sort((a, b) => bestRarity(a) - bestRarity(b)   || a.pokemon.name.localeCompare(b.pokemon.name));
    else if (sort === 'rarity-desc') cards.sort((a, b) => worstRarity(b) - worstRarity(a) || a.pokemon.name.localeCompare(b.pokemon.name));
    else if (sort === 'name')        cards.sort((a, b) => a.pokemon.name.localeCompare(b.pokemon.name));
    else                             cards.sort((a, b) => a.pokemon.id - b.pokemon.id);
    return cards;
  }, [encounters, methodFilter, rarityFilter, timeFilter, sort]);

  const totalDistinctMons = useMemo(() => new Set(encounters.map((e) => e.pokemon.id)).size, [encounters]);

  const title = (
    <span className="flex items-baseline gap-2 min-w-0">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400 shrink-0">{region}</span>
      <span className="truncate">{locName}</span>
    </span>
  );

  const headerExtra = (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        {mapRegion && (
          <Link
            to={`/map/${mapRegion}`}
            className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
            title={`Open the ${region} interactive map`}
          >
            <MapPin size={12} /> View on map
          </Link>
        )}
        <label className="text-xs text-stone-500 dark:text-stone-400 ml-auto">Sort</label>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="px-2 py-1 rounded-md border border-[#d6c8a3] dark:border-stone-700
                     bg-[#fdf8e9] dark:bg-stone-900 text-stone-900 dark:text-stone-100 text-xs
                     focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <span className="text-xs text-stone-500 dark:text-stone-400 tabular-nums">
          {groupedCards.length} of {totalDistinctMons}
        </span>
      </div>

      <ChipRow
        label="Method"
        options={allMethods}
        value={methodFilter}
        onChange={setMethodFilter}
        renderLabel={(m) => <><span aria-hidden className="mr-1">{methodIcon(m)}</span>{m}</>}
      />
      {allTimes.length > 0 && (
        <SingleChipRow
          label="Time"
          options={allTimes}
          value={timeFilter}
          onChange={setTimeFilter}
          renderLabel={(t) => (
            <span className="inline-flex items-center gap-1">
              {t === 'Day' ? <Sun size={12} /> : t === 'Night' ? <Moon size={12} /> : null}
              {t}
            </span>
          )}
        />
      )}
      <ChipRow
        label="Rarity"
        options={allRarities}
        value={rarityFilter}
        onChange={setRarityFilter}
        renderChip={(r) => <RarityBadge rarity={r} size="chip" />}
      />
    </>
  );

  return (
    <Modal
      title={title}
      headerExtra={headerExtra}
      onClose={onClose}
      maxWidth="max-w-3xl"
      maxHeight="min(820px, calc(100vh - 3rem))"
      ariaLabel={`${locName} encounters`}
    >
      <div className="p-3 space-y-2">
        {groupedCards.length === 0 ? (
          <div className="py-12 text-center text-stone-500 dark:text-stone-400 text-sm">
            No encounters match these filters.
          </div>
        ) : (
          groupedCards.map((card) => (
            <PokemonEncounterCard
              key={card.pokemon.id}
              pokemon={card.pokemon}
              entries={card.entries}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </Modal>
  );
}

/* ─────────────── Chip row (method + rarity) ─────────────── */

function ChipRow({ label, options, value, onChange, renderChip, renderLabel }) {
  const selected = value || [];
  function toggle(o) {
    if (selected.includes(o)) onChange(selected.filter((x) => x !== o));
    else onChange([...selected, o]);
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-stone-500 dark:text-stone-400 mr-1">{label}</span>
      <button
        type="button"
        onClick={() => onChange(null)}
        aria-pressed={!value || value.length === 0}
        className={`px-2 py-0.5 rounded text-xs border transition-colors ${
          (!value || value.length === 0)
            ? 'bg-stone-900 text-white border-stone-900 dark:bg-stone-100 dark:text-stone-900 dark:border-stone-100'
            : 'bg-[#fdf8e9] dark:bg-stone-900 text-stone-600 dark:text-stone-400 border-[#d6c8a3] dark:border-stone-700 hover:bg-[#ece2c4] dark:hover:bg-stone-800'
        }`}
      >
        All
      </button>
      {options.map((o) => {
        const isSel = selected.includes(o);
        if (renderChip) {
          return (
            <button
              key={o}
              type="button"
              onClick={() => toggle(o)}
              aria-pressed={isSel}
              className={`inline-flex rounded transition-opacity
                          focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
                          ${isSel ? '' : 'opacity-45 hover:opacity-80'}`}
              title={o}
            >
              {renderChip(o, isSel)}
            </button>
          );
        }
        return (
          <button
            key={o}
            type="button"
            onClick={() => toggle(o)}
            aria-pressed={isSel}
            className={`px-2 py-0.5 rounded text-xs border transition-colors ${
              isSel
                ? 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-900'
                : 'bg-[#fdf8e9] dark:bg-stone-900 text-stone-700 dark:text-stone-300 border-[#d6c8a3] dark:border-stone-700 hover:bg-[#ece2c4] dark:hover:bg-stone-800'
            }`}
          >
            {renderLabel ? renderLabel(o) : o}
          </button>
        );
      })}
    </div>
  );
}

/* ─────────────── Single-select chip row (used by time filter) ─────────────── */

function SingleChipRow({ label, options, value, onChange, renderLabel }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-stone-500 dark:text-stone-400 mr-1">{label}</span>
      <button
        type="button"
        onClick={() => onChange(null)}
        aria-pressed={value == null}
        className={`px-2 py-0.5 rounded text-xs border transition-colors ${
          value == null
            ? 'bg-stone-900 text-white border-stone-900 dark:bg-stone-100 dark:text-stone-900 dark:border-stone-100'
            : 'bg-[#fdf8e9] dark:bg-stone-900 text-stone-600 dark:text-stone-400 border-[#d6c8a3] dark:border-stone-700 hover:bg-[#ece2c4] dark:hover:bg-stone-800'
        }`}
      >
        All
      </button>
      {options.map((o) => {
        const isSel = value === o;
        return (
          <button
            key={o}
            type="button"
            onClick={() => onChange(isSel ? null : o)}
            aria-pressed={isSel}
            className={`px-2 py-0.5 rounded text-xs border transition-colors ${
              isSel
                ? 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-900'
                : 'bg-[#fdf8e9] dark:bg-stone-900 text-stone-700 dark:text-stone-300 border-[#d6c8a3] dark:border-stone-700 hover:bg-[#ece2c4] dark:hover:bg-stone-800'
            }`}
          >
            {renderLabel ? renderLabel(o) : o}
          </button>
        );
      })}
    </div>
  );
}

/* ─────────────── Encounter row ─────────────── */

const PokemonEncounterCard = ({ pokemon: p, entries, onSelect }) => {
  const primaryColor = typeColor(p.types[0]).bg;
  return (
    <button
      type="button"
      onClick={() => onSelect(p.id)}
      className="w-full flex items-start gap-3 p-2 sm:p-3 rounded-lg
                 bg-[#fdf8e9] border border-[#e6dabf] hover:border-[#c4b486] hover:shadow-md
                 dark:bg-stone-900 dark:border-stone-800 dark:hover:border-stone-600
                 transition-all duration-150 text-left
                 focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      <div
        className="relative shrink-0 w-14 h-14 rounded-md overflow-hidden flex items-center justify-center"
        style={{ background: `radial-gradient(circle at 50% 50%, ${primaryColor}26 0%, ${primaryColor}14 70%, ${primaryColor}0a 100%)` }}
      >
        <div
          className="absolute inset-0 hidden dark:block pointer-events-none"
          style={{ background: `radial-gradient(circle at 50% 50%, ${primaryColor}3d 0%, ${primaryColor}1f 70%, ${primaryColor}0f 100%)` }}
        />
        <PokemonSprite pokemon={p} loading="lazy" className="w-12 h-12 object-contain relative" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-mono text-xs text-stone-500 dark:text-stone-500">{dexNum(p.id)}</span>
          <span className="font-semibold text-stone-900 dark:text-stone-100 truncate">{p.name}</span>
          <div className="flex gap-1">
            {[...new Set(p.types)].map((t) => <TypeBadge key={t} type={t} />)}
          </div>
        </div>
        <div className="mt-1.5 space-y-1">
          {entries.map((e, i) => <EncounterStrip key={i} entry={e} />)}
        </div>
      </div>
    </button>
  );
};

function EncounterStrip({ entry }) {
  const { method, rarity, min_level, max_level, times = [], seasons = [] } = entry;
  const lvl = min_level === max_level ? `Lv ${min_level}` : `Lv ${min_level}–${max_level}`;
  const hasWhen = times.length > 0 || seasons.length > 0;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#f1e9d2] dark:bg-stone-800/40 text-stone-700 dark:text-stone-300">
        <span aria-hidden>{methodIcon(method)}</span>{method}
      </span>
      <RarityBadge rarity={rarity} />
      <span className="font-mono tabular-nums text-stone-700 dark:text-stone-300">{lvl}</span>
      {hasWhen && (
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#f1e9d2] dark:bg-stone-800/40 text-stone-600 dark:text-stone-400"
          title={[times.join('/'), seasons.length ? `Seasons ${seasons.join(', ')}` : null].filter(Boolean).join(' · ')}
        >
          {times.includes('Day')   && <Sun  size={12} />}
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
