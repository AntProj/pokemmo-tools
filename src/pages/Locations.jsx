import { useMemo, useDeferredValue } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import Toolbar from '../components/Toolbar.jsx';
import RarityBadge from '../components/RarityBadge.jsx';
import MethodIcon from '../components/MethodIcon.jsx';
import { LocationDetailPane } from './LocationDetail.jsx';
import { useFieldSetters } from '../hooks/useFieldSetters.js';
import { regionRank, rarityRank, parseLocation } from '../lib/locations.js';
import { locationOrderIndex } from '../lib/locationOrder.js';

// Locations always show a single region (no "All"), so the region selector lists
// just the five regions.
const REGIONS_NO_ALL = ['Kanto', 'Johto', 'Hoenn', 'Sinnoh', 'Unova'];

const SORT_OPTIONS = [
  { value: 'game',  label: 'In-game order' },
  { value: 'name',  label: 'Name A→Z' },
  { value: 'count', label: 'Encounters (most)' },
];

// Canonical-name selection helpers used during grouping.
function isAllUpper(s) { return s.length > 0 && s === s.toUpperCase() && s !== s.toLowerCase(); }
const NAME_RANK = { upper: 0, mixed: 1, unsuffixed: 2 };
function rank(source) { return NAME_RANK[source] ?? 0; }

/*
 * Locations — a Pokédex-style page:
 *   - top: shared Toolbar (search, region, sort) — matching the rest of the app.
 *   - left: Methods + Rarity filters (always visible, own scroll on lg+).
 *   - right: the region's locations as a LIST, or (when a location is opened via
 *     the route) that location's Pokémon inline as a detail PAGE — not a modal.
 * The method/rarity filters are global: they narrow the location list AND the
 * mons shown inside a location. Search matches a location's name OR any Pokémon
 * found there. The default sort is in-game encounter order (lib/locationOrder).
 */
export default function Locations({ data, state, setState, onSelect }) {
  const { search, methods = [], rarities = [] } = state;
  // Guard against stale values (e.g. an old 'All' region or 'region' sort) so a
  // pre-existing state object can't leave the list empty.
  const region = REGIONS_NO_ALL.includes(state.region) ? state.region : 'Kanto';
  const sort = SORT_OPTIONS.some((o) => o.value === state.sort) ? state.sort : 'game';
  const deferredSearch = useDeferredValue(search);

  const navigate = useNavigate();
  const { region: openRegionRaw, location: openLocRaw } = useParams();
  const openRegion = openRegionRaw ? decodeURIComponent(openRegionRaw) : null;
  const openLoc    = openLocRaw ? decodeURIComponent(openLocRaw) : null;
  const detailOpen = !!(openRegion && openLoc);

  const set = useFieldSetters(setState, ['search', 'region', 'sort', 'methods', 'rarities']);

  // Group raw location keys (variants like "Route 30 (Night)") into one entry
  // per base name, unioning their encounters. Track methods + rarities present
  // and a search blob (location name + every Pokémon name found there).
  const locations = useMemo(() => {
    const groups = new Map();
    for (const [key, mons] of Object.entries(data.locations)) {
      const [reg, rawName] = key.split('::');
      const { base } = parseLocation(rawName);
      const isUnsuffixed = base === rawName;
      const groupKey = `${reg}::${base.toLowerCase()}`;
      let entry = groups.get(groupKey);
      if (!entry) {
        entry = {
          key: groupKey, region: reg, name: base,
          _nameSource: isUnsuffixed ? 'unsuffixed' : (isAllUpper(base) ? 'upper' : 'mixed'),
          count: 0, methods: [], rarities: [], _mons: [], _sm: new Set(), _sr: new Set(),
        };
        groups.set(groupKey, entry);
      } else {
        const candidate = isUnsuffixed ? 'unsuffixed' : (isAllUpper(base) ? 'upper' : 'mixed');
        if (rank(candidate) > rank(entry._nameSource)) { entry.name = base; entry._nameSource = candidate; }
      }
      entry.count += mons.length;
      for (const m of mons) {
        entry._mons.push(m.name);
        if (!entry._sm.has(m.method)) { entry._sm.add(m.method); entry.methods.push(m.method); }
        if (!entry._sr.has(m.rarity)) { entry._sr.add(m.rarity); entry.rarities.push(m.rarity); }
      }
    }
    return [...groups.values()].map(({ _sm, _sr, _nameSource, _mons, ...rest }) => ({
      ...rest,
      searchBlob: (rest.name + ' ' + _mons.join(' ')).toLowerCase(),
    }));
  }, [data.locations]);

  // Options for the filter chips, restricted to the current region's locations.
  const { allMethods, allRarities } = useMemo(() => {
    const ms = new Set(), rs = new Set();
    for (const l of locations) {
      if (l.region !== region) continue;
      for (const m of l.methods) ms.add(m);
      for (const r of l.rarities) rs.add(r);
    }
    return {
      allMethods: [...ms].sort((a, b) => a.localeCompare(b)),
      allRarities: [...rs].sort((a, b) => rarityRank(a) - rarityRank(b)),
    };
  }, [locations, region]);

  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    let out = locations.filter((l) => l.region === region);
    if (q) out = out.filter((l) => l.searchBlob.includes(q));
    if (methods.length) out = out.filter((l) => methods.some((m) => l.methods.includes(m)));
    if (rarities.length) out = out.filter((l) => rarities.some((r) => l.rarities.includes(r)));
    out = out.slice();
    const cmpName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    if (sort === 'name') out.sort(cmpName);
    else if (sort === 'count') out.sort((a, b) => b.count - a.count || cmpName(a, b));
    else out.sort((a, b) => (locationOrderIndex(a.region, a.name) - locationOrderIndex(b.region, b.name)) || cmpName(a, b));
    return out;
  }, [locations, region, deferredSearch, methods, rarities, sort]);

  return (
    <>
      <Toolbar
        search={search} onSearch={set.search}
        region={region} onRegion={set.region} regions={REGIONS_NO_ALL}
        sort={sort} onSort={set.sort} sortOptions={SORT_OPTIONS}
        resultCount={filtered.length}
        searchPlaceholder="Search location or Pokémon…"
      />

      <main className="max-w-7xl mx-auto px-4 py-4">
        <div className="grid lg:grid-cols-[260px_1fr] gap-4 items-start">
          {/* Methods + Rarity filters — always visible; on lg+ they stick below
              the navbar/toolbar and scroll on their own. */}
          <aside className="lg:sticky lg:top-[200px] self-start space-y-2 lg:max-h-[calc(100vh-216px)] lg:overflow-y-auto lg:pr-1">
            <Section title="Methods" defaultOpen>
              <ChipMulti
                options={allMethods}
                value={methods}
                onChange={set.methods}
                renderLabel={(m) => <span className="inline-flex items-center gap-1"><MethodIcon method={m} size={12} />{m}</span>}
              />
            </Section>
            <Section title="Rarity" defaultOpen>
              <ChipMulti
                options={allRarities}
                value={rarities}
                onChange={set.rarities}
                renderChip={(r) => <RarityBadge rarity={r} size="chip" />}
              />
            </Section>
          </aside>

          {/* Right pane: the location list, or a location's detail page. */}
          <div className="min-w-0">
            {detailOpen ? (
              <LocationDetailPane
                data={data}
                region={openRegion}
                locName={openLoc}
                methods={methods}
                rarities={rarities}
                onSelect={onSelect}
                onBack={() => navigate('/locations')}
              />
            ) : filtered.length === 0 ? (
              <div className="py-16 text-center text-stone-500 dark:text-stone-400 text-sm">No locations match these filters.</div>
            ) : (
              <div className="rounded-md overflow-hidden border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900 divide-y divide-[#ece2c4] dark:divide-stone-800/60">
                {filtered.map((loc) => <LocationRow key={loc.key} loc={loc} />)}
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}

/* ─────────────── Location list row ─────────────── */

function LocationRow({ loc }) {
  return (
    <Link
      to={`/locations/${encodeURIComponent(loc.region)}/${encodeURIComponent(loc.name)}`}
      className="group flex items-center gap-3 px-3 py-2.5 hover:bg-[#f1e9d2] dark:hover:bg-stone-800/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400 shrink-0">{loc.region}</span>
          <span className="font-semibold text-stone-900 dark:text-stone-100 truncate">{loc.name}</span>
        </div>
        <div className="text-xs text-stone-500 dark:text-stone-400">
          {loc.count} encounter{loc.count === 1 ? '' : 's'}
        </div>
      </div>
      <div className="hidden sm:flex flex-wrap justify-end gap-x-2 gap-y-0.5 max-w-[45%] text-[11px] text-stone-600 dark:text-stone-400">
        {loc.methods.map((m) => (
          <span key={m} className="inline-flex items-center gap-1"><MethodIcon method={m} size={12} />{m}</span>
        ))}
      </div>
      <ChevronRight size={16} className="shrink-0 text-stone-400 group-hover:text-stone-600 dark:group-hover:text-stone-300" />
    </Link>
  );
}

/* ─────────────── Sidebar helpers ─────────────── */

function Section({ title, defaultOpen = false, children }) {
  return (
    <details open={defaultOpen} className="group rounded-md border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-bold uppercase tracking-wider text-stone-700 dark:text-stone-300 flex items-center gap-2">
        <ChevronDown size={14} className="transition-transform group-open:rotate-0 -rotate-90 text-stone-400" />
        {title}
      </summary>
      <div className="px-3 pb-3 pt-1">{children}</div>
    </details>
  );
}

// Multi-select chips. `renderChip(o, selected)` for a self-styled chip (rarity
// badges), else `renderLabel(o)` inside a standard pill.
function ChipMulti({ options, value, onChange, renderLabel, renderChip }) {
  const toggle = (o) => (value.includes(o) ? onChange(value.filter((x) => x !== o)) : onChange([...value, o]));
  if (options.length === 0) return <div className="text-xs text-stone-400 dark:text-stone-500">None</div>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const sel = value.includes(o);
        if (renderChip) {
          return (
            <button key={o} type="button" onClick={() => toggle(o)} aria-pressed={sel} title={o}
              className={`rounded transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${sel ? '' : 'opacity-45 hover:opacity-80'}`}>
              {renderChip(o, sel)}
            </button>
          );
        }
        return (
          <button
            key={o}
            type="button"
            onClick={() => toggle(o)}
            aria-pressed={sel}
            className={`px-2 py-0.5 rounded text-xs border transition-colors ${
              sel
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
