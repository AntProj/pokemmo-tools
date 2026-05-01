import { useCallback, useEffect, useMemo, useState } from 'react';
import data from './data/pokemmo.json';
import Toolbar from './components/Toolbar.jsx';
import PokemonCard from './components/PokemonCard.jsx';
import PokemonRow from './components/PokemonRow.jsx';
import PokemonModal from './components/PokemonModal.jsx';
import { statTotal, regionKey } from './lib/format.js';

const LS = {
  view:  'pokemmo:view',
  theme: 'pokemmo:theme',
};

function initialView() {
  if (typeof window === 'undefined') return 'grid';
  const v = localStorage.getItem(LS.view);
  return v === 'list' ? 'list' : 'grid';
}

function initialTheme() {
  if (typeof window === 'undefined') return 'dark';
  const stored = localStorage.getItem(LS.theme);
  if (stored === 'dark' || stored === 'light') return stored;
  // Default to system preference on first visit.
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
}

export default function App() {
  const [view, setView]   = useState(initialView);
  const [theme, setTheme] = useState(initialTheme);
  const [search, setSearch] = useState('');
  const [region, setRegion] = useState('All');
  const [types, setTypes]   = useState([]);
  const [sort, setSort]     = useState('dex');
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => { localStorage.setItem(LS.view, view); }, [view]);
  useEffect(() => {
    localStorage.setItem(LS.theme, theme);
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark'); else root.classList.remove('dark');
  }, [theme]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    // Allow "#150", "150", "0150" → numeric dex match. Matches national id and,
    // if a region is active, the regional dex number too.
    let dexQuery = null;
    if (q) {
      const m = q.replace(/^#/, '').match(/^\d+$/);
      if (m) dexQuery = parseInt(m[0], 10);
    }
    const rkey = regionKey(region);

    const out = data.pokemon.filter((p) => {
      if (rkey) {
        if (!p.dex || !(p.dex[rkey] > 0)) return false;
      }
      if (types.length > 0) {
        for (const t of types) {
          if (!p.types.some((pt) => pt.toLowerCase() === t.toLowerCase())) return false;
        }
      }
      if (q) {
        const nameMatch = p.name.toLowerCase().includes(q);
        const nationalMatch = dexQuery != null && p.id === dexQuery;
        const regionalMatch = dexQuery != null && rkey && p.dex?.[rkey] === dexQuery;
        if (!nameMatch && !nationalMatch && !regionalMatch) return false;
      }
      return true;
    });

    if (sort === 'name') out.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'bst') out.sort((a, b) => statTotal(b.stats) - statTotal(a.stats));
    else if (rkey) out.sort((a, b) => (a.dex[rkey] || 0) - (b.dex[rkey] || 0));
    else out.sort((a, b) => a.id - b.id);

    return out;
  }, [search, region, types, sort]);

  const selected = useMemo(
    () => (selectedId != null ? data.pokemon.find((p) => p.id === selectedId) : null),
    [selectedId]
  );

  const handleSelect = useCallback((id) => setSelectedId(id), []);
  const handleClose  = useCallback(() => setSelectedId(null), []);

  return (
    <div className="min-h-screen bg-[#f6efdc] dark:bg-stone-950 text-stone-900 dark:text-stone-100">
      <Toolbar
        search={search} onSearch={setSearch}
        region={region} onRegion={setRegion}
        types={types}   onTypes={setTypes}
        sort={sort}     onSort={setSort}
        view={view}     onView={setView}
        theme={theme}   onTheme={setTheme}
        resultCount={filtered.length}
      />

      <main className="max-w-7xl mx-auto px-4 py-4">
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-stone-500 dark:text-stone-400">
            No Pokémon match these filters.
          </div>
        ) : view === 'grid' ? (
          <div className="grid gap-3
                          grid-cols-2 sm:grid-cols-3 md:grid-cols-4
                          lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
            {filtered.map((p) => (
              <PokemonCard key={p.id} pokemon={p} region={region} onSelect={handleSelect} />
            ))}
          </div>
        ) : (
          <div className="rounded-md overflow-hidden border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900">
            {filtered.map((p) => (
              <PokemonRow key={p.id} pokemon={p} region={region} onSelect={handleSelect} />
            ))}
          </div>
        )}
      </main>

      <PokemonModal
        pokemon={selected}
        data={data}
        onClose={handleClose}
        onSelect={handleSelect}
      />

      <footer className="max-w-7xl mx-auto px-4 py-6 text-xs text-stone-400 dark:text-stone-600 text-center">
        {data.meta.total_pokemon} Pokémon · {data.meta.total_moves} moves · built {new Date(data.meta.built_at).toLocaleDateString()}
      </footer>
    </div>
  );
}
