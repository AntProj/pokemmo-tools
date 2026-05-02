import { useMemo } from 'react';
import Toolbar from '../components/Toolbar.jsx';
import PokemonCard from '../components/PokemonCard.jsx';
import PokemonRow from '../components/PokemonRow.jsx';
import { statTotal, regionKey } from '../lib/format.js';

export default function Pokedex({ data, state, setState, view, onView, theme, onTheme, onSelect }) {
  const { search, region, types, sort } = state;

  // Slice setters bound to single keys so the page reads naturally.
  const setSearch = (v) => setState((s) => ({ ...s, search: v }));
  const setRegion = (v) => setState((s) => ({ ...s, region: v }));
  const setTypes  = (v) => setState((s) => ({ ...s, types: v }));
  const setSort   = (v) => setState((s) => ({ ...s, sort: v }));

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
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
  }, [data.pokemon, search, region, types, sort]);

  return (
    <>
      <Toolbar
        search={search} onSearch={setSearch}
        region={region} onRegion={setRegion}
        types={types}   onTypes={setTypes}
        sort={sort}     onSort={setSort}
        view={view}     onView={onView}
        theme={theme}   onTheme={onTheme}
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
              <PokemonCard key={p.id} pokemon={p} region={region} onSelect={onSelect} />
            ))}
          </div>
        ) : (
          <div className="rounded-md overflow-hidden border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900">
            {filtered.map((p) => (
              <PokemonRow key={p.id} pokemon={p} region={region} onSelect={onSelect} />
            ))}
          </div>
        )}
      </main>
    </>
  );
}
