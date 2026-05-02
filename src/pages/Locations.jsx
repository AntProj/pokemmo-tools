import { memo, useCallback, useDeferredValue, useMemo } from 'react';
import { Link } from 'react-router-dom';
import Toolbar from '../components/Toolbar.jsx';
import { methodIcon, regionRank, parseLocation } from '../lib/locations.js';

const SORT_OPTIONS = [
  { value: 'region', label: 'Region' },
  { value: 'name',   label: 'Name A→Z' },
  { value: 'count',  label: 'Encounters' },
];

// Canonical-name selection helpers used during grouping.
function isAllUpper(s) { return s.length > 0 && s === s.toUpperCase() && s !== s.toLowerCase(); }
const NAME_RANK = { upper: 0, mixed: 1, unsuffixed: 2 };
function rank(source) { return NAME_RANK[source] ?? 0; }

export default function Locations({ data, state, setState, theme, onTheme }) {
  const { search, region, sort } = state;
  const deferredSearch = useDeferredValue(search);

  const setField = useCallback((field) => (val) => setState((s) => ({ ...s, [field]: val })), [setState]);
  const setSearch = useMemo(() => setField('search'), [setField]);
  const setRegion = useMemo(() => setField('region'), [setField]);
  const setSort   = useMemo(() => setField('sort'),   [setField]);

  // Build the location summary array once per dataset. Multiple raw keys may
  // share a base name (e.g. "Route 30", "Route 30 (Night)", "ROUTE 30 (Day/
  // Morning/SEASON1)") — collapse those into a single entry so the user sees
  // one card per route. Grouping is case-insensitive because the dataset
  // sometimes uppercases suffixed variants (e.g. "ROUTE 1 (Night)" alongside
  // "Route 1"). Encounters are unioned into mons.
  const locations = useMemo(() => {
    const groups = new Map(); // `${region}::${base.toLowerCase()}` → entry
    for (const [key, mons] of Object.entries(data.locations)) {
      const [region, rawName] = key.split('::');
      const { base } = parseLocation(rawName);
      const isUnsuffixed = base === rawName;
      const groupKey = `${region}::${base.toLowerCase()}`;
      let entry = groups.get(groupKey);
      if (!entry) {
        entry = {
          key: groupKey, region, name: base,
          // Track how the canonical name was chosen so a later, better
          // candidate can replace it.
          _nameSource: isUnsuffixed ? 'unsuffixed' : (isAllUpper(base) ? 'upper' : 'mixed'),
          mons: [], methods: [], count: 0, variantCount: 0, _seenMethods: new Set(),
        };
        groups.set(groupKey, entry);
      } else {
        // Replace the display name if this variant gives us a better one:
        // unsuffixed > mixed-case suffixed > all-uppercase suffixed.
        const candidate = isUnsuffixed ? 'unsuffixed' : (isAllUpper(base) ? 'upper' : 'mixed');
        if (rank(candidate) > rank(entry._nameSource)) {
          entry.name = base;
          entry._nameSource = candidate;
        }
      }
      entry.mons.push(...mons);
      entry.count += mons.length;
      entry.variantCount += 1;
      for (const m of mons) {
        if (!entry._seenMethods.has(m.method)) {
          entry._seenMethods.add(m.method);
          entry.methods.push(m.method);
        }
      }
    }
    // Strip temporary fields.
    return [...groups.values()].map(({ _seenMethods, _nameSource, ...rest }) => rest);
  }, [data.locations]);

  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    let out = locations;
    if (region !== 'All') out = out.filter((l) => l.region === region);
    if (q) out = out.filter((l) => l.name.toLowerCase().includes(q));
    // Natural sort so "Route 2" precedes "Route 10".
    const cmpName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    out = out.slice();
    if (sort === 'name') out.sort(cmpName);
    else if (sort === 'count') out.sort((a, b) => b.count - a.count);
    else out.sort((a, b) => regionRank(a.region) - regionRank(b.region) || cmpName(a, b));
    return out;
  }, [locations, region, deferredSearch, sort]);

  return (
    <>
      <Toolbar
        search={search} onSearch={setSearch}
        region={region} onRegion={setRegion}
        sort={sort} onSort={setSort} sortOptions={SORT_OPTIONS}
        theme={theme} onTheme={onTheme}
        resultCount={filtered.length}
        searchPlaceholder="Search locations (e.g. route, mt, cave)…"
      />

      <main className="max-w-7xl mx-auto px-4 py-4">
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-stone-500 dark:text-stone-400">No locations match.</div>
        ) : (
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((loc) => <LocationCard key={loc.key} loc={loc} />)}
          </div>
        )}
      </main>
    </>
  );
}

const LocationCard = memo(function LocationCard({ loc }) {
  return (
    <Link
      to={`/locations/${encodeURIComponent(loc.region)}/${encodeURIComponent(loc.name)}`}
      className="group block p-3 rounded-lg
                 bg-[#fdf8e9] border border-[#e6dabf] hover:border-[#c4b486] hover:shadow-md
                 dark:bg-stone-900 dark:border-stone-800 dark:hover:border-stone-600
                 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
        {loc.region}
      </div>
      <div className="mt-0.5 font-semibold text-stone-900 dark:text-stone-100 truncate">{loc.name}</div>
      <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">
        {loc.count} encounter{loc.count === 1 ? '' : 's'}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-stone-600 dark:text-stone-400">
        {loc.methods.map((m) => (
          <span key={m} className="inline-flex items-center gap-1">
            <span aria-hidden>{methodIcon(m)}</span>{m}
          </span>
        ))}
      </div>
    </Link>
  );
});
