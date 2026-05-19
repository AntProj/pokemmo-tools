import { memo, useCallback, useDeferredValue, useMemo, useRef, useState } from 'react';
import { Search, Check, Slash, Star, X } from 'lucide-react';
import TypeBadge from '../components/TypeBadge.jsx';
import PokemonSprite from '../components/PokemonSprite.jsx';
import { ALL_POKEMON_TYPES, typeColor } from '../lib/types.js';
import { displayDex, regionKey, statTotal } from '../lib/format.js';
import { stateOf, cycleClick, STATES } from '../lib/tracker.js';

const REGIONS = ['All', 'Kanto', 'Johto', 'Hoenn', 'Sinnoh', 'Unova'];
const SORTS = [
  { value: 'dex',  label: 'Dex #' },
  { value: 'name', label: 'Name A→Z' },
  { value: 'bst',  label: 'BST high→low' },
];
const STATE_FILTERS = [
  { key: 'uncaught', label: 'Uncaught' },
  { key: 'caught',   label: 'Caught'   },
  { key: 'priority', label: 'Priority' },
  { key: 'skipped',  label: 'Skipped'  },
];

export default function TrackerMark({
  data,
  trackerState, setMonState, setManyMonStates,
  view, updateView,
  openPanel,
}) {
  const { markSearch, markRegion, markTypes, markStates, markSort } = view;
  const deferredSearch = useDeferredValue(markSearch);

  const setSearch = useCallback((v) => updateView({ markSearch: v }),  [updateView]);
  const setRegion = useCallback((v) => updateView({ markRegion: v }),  [updateView]);
  const setSort   = useCallback((v) => updateView({ markSort:   v }),  [updateView]);
  const toggleType = useCallback((t) => {
    const next = markTypes.includes(t)
      ? markTypes.filter((x) => x !== t)
      : (markTypes.length < 2 ? [...markTypes, t] : [markTypes[1], t]);
    updateView({ markTypes: next });
  }, [markTypes, updateView]);
  const toggleStateFilter = useCallback((s) => {
    updateView({ markStates: markStates.includes(s) ? markStates.filter((x) => x !== s) : [...markStates, s] });
  }, [markStates, updateView]);

  // ─────── Filter pipeline ───────
  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    let dexQuery = null;
    if (q) {
      const m = q.replace(/^#/, '').match(/^\d+$/);
      if (m) dexQuery = parseInt(m[0], 10);
    }
    const rkey = regionKey(markRegion);
    const stateSet = markStates.length > 0 ? new Set(markStates) : null;

    const out = data.pokemon.filter((p) => {
      if (rkey) {
        if (!p.dex || !(p.dex[rkey] > 0)) return false;
      }
      if (markTypes.length > 0) {
        for (const t of markTypes) {
          if (!p.types.some((pt) => pt.toLowerCase() === t.toLowerCase())) return false;
        }
      }
      if (q) {
        const nameMatch = p.name.toLowerCase().includes(q);
        const nationalMatch = dexQuery != null && p.id === dexQuery;
        const regionalMatch = dexQuery != null && rkey && p.dex?.[rkey] === dexQuery;
        if (!nameMatch && !nationalMatch && !regionalMatch) return false;
      }
      if (stateSet) {
        const s = stateOf(trackerState, p.id);
        if (!stateSet.has(s)) return false;
      }
      return true;
    });

    if (markSort === 'name')    out.sort((a, b) => a.name.localeCompare(b.name));
    else if (markSort === 'bst') out.sort((a, b) => statTotal(b.stats) - statTotal(a.stats));
    else if (rkey)              out.sort((a, b) => (a.dex[rkey] || 0) - (b.dex[rkey] || 0));
    else                        out.sort((a, b) => a.id - b.id);
    return out;
  }, [data.pokemon, deferredSearch, markRegion, markTypes, markStates, markSort, trackerState]);

  // ─────── Selection (for bulk actions) ───────
  // Set<pokemonId>. Lives locally — selection is ephemeral and tab-scoped.
  const [selected, setSelected] = useState(() => new Set());
  const lastClickedId = useRef(null);

  const handleClick = useCallback((id, e) => {
    if (e.shiftKey) {
      // Shift-click toggles selection. Doesn't change state.
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
      lastClickedId.current = id;
      return;
    }
    // Plain click cycles state.
    setMonState(id, cycleClick(stateOf(trackerState, id)));
    lastClickedId.current = id;
  }, [setMonState, trackerState]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);
  const applyBulk = useCallback((state) => {
    setManyMonStates([...selected], state);
    setSelected(new Set());
  }, [selected, setManyMonStates]);

  return (
    <main className="max-w-7xl mx-auto px-4 py-4 space-y-4">
      {/* Filters */}
      <section className="rounded-md border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900 p-3 space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 dark:text-stone-500" />
            <input
              type="search"
              value={markSearch}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or dex number"
              className="w-full pl-8 pr-3 py-1.5 rounded-md border border-[#d6c8a3] dark:border-stone-700
                         bg-[#fdf8e9] dark:bg-stone-900 text-stone-900 dark:text-stone-100
                         placeholder:text-stone-400 dark:placeholder:text-stone-500
                         focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-stone-500 dark:text-stone-400">Sort</label>
            <select
              value={markSort}
              onChange={(e) => setSort(e.target.value)}
              className="px-2 py-1.5 rounded-md border border-[#d6c8a3] dark:border-stone-700
                         bg-[#fdf8e9] dark:bg-stone-900 text-stone-900 dark:text-stone-100 text-sm
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {SORTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <span className="text-xs text-stone-500 dark:text-stone-400 tabular-nums">
            {filtered.length} mon{filtered.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-stone-500 dark:text-stone-400 mr-1">Region</span>
          {REGIONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRegion(r)}
              aria-pressed={markRegion === r}
              className={`px-2.5 py-1 rounded-md text-sm border transition-colors ${
                markRegion === r
                  ? 'bg-stone-900 text-white border-stone-900 dark:bg-stone-100 dark:text-stone-900 dark:border-stone-100'
                  : 'bg-[#fdf8e9] text-stone-700 border-[#d6c8a3] hover:bg-[#ece2c4] dark:bg-stone-900 dark:text-stone-300 dark:border-stone-700 dark:hover:bg-stone-800'
              }`}
            >
              {r}
            </button>
          ))}
        </div>

        <div className="flex items-start gap-2 flex-wrap">
          <span className="text-xs text-stone-500 dark:text-stone-400 mr-1 mt-1">Types</span>
          <div className="flex flex-wrap gap-1.5">
            {ALL_POKEMON_TYPES.map((t) => {
              const sel = markTypes.includes(t);
              const c = typeColor(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleType(t)}
                  aria-pressed={sel}
                  className={`px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wide border transition-all ${
                    sel
                      ? 'border-stone-900 dark:border-stone-100 ring-1 ring-blue-500'
                      : 'border-[#d6c8a3] dark:border-stone-700 opacity-70 hover:opacity-100'
                  }`}
                  style={sel ? { backgroundColor: c.bg, color: c.fg, borderColor: c.bg } : undefined}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-stone-500 dark:text-stone-400 mr-1">State</span>
          {STATE_FILTERS.map(({ key, label }) => {
            const sel = markStates.includes(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleStateFilter(key)}
                aria-pressed={sel}
                className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                  sel
                    ? 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-900'
                    : 'bg-[#fdf8e9] dark:bg-stone-900 text-stone-700 dark:text-stone-300 border-[#d6c8a3] dark:border-stone-700 hover:bg-[#ece2c4] dark:hover:bg-stone-800'
                }`}
              >
                {label}
              </button>
            );
          })}
          {markStates.length > 0 && (
            <button
              type="button"
              onClick={() => updateView({ markStates: [] })}
              className="text-xs text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 underline underline-offset-2"
            >
              Clear
            </button>
          )}
        </div>
      </section>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <BulkBar count={selected.size} onApply={applyBulk} onClear={clearSelection} />
      )}

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="py-16 text-center text-stone-500 dark:text-stone-400">No Pokémon match.</div>
      ) : (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
          {filtered.map((p) => (
            <TrackerCard
              key={p.id}
              pokemon={p}
              region={markRegion}
              state={stateOf(trackerState, p.id)}
              isSelected={selected.has(p.id)}
              onClick={handleClick}
              openPanel={openPanel}
            />
          ))}
        </div>
      )}
    </main>
  );
}

/* ─────────────── Bulk action bar ─────────────── */

function BulkBar({ count, onApply, onClear }) {
  return (
    <div className="sticky top-[60px] z-10 flex items-center gap-2 flex-wrap rounded-md border border-blue-300 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 px-3 py-2 text-sm">
      <span className="font-semibold text-blue-900 dark:text-blue-200">{count} selected</span>
      <span className="text-stone-400">·</span>
      <BulkBtn onClick={() => onApply('caught')}>Caught</BulkBtn>
      <BulkBtn onClick={() => onApply('uncaught')}>Uncaught</BulkBtn>
      <BulkBtn onClick={() => onApply('priority')}>Priority</BulkBtn>
      <BulkBtn onClick={() => onApply('skipped')}>Skipped</BulkBtn>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto inline-flex items-center gap-1 text-xs text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100"
      >
        <X size={12} /> Clear selection
      </button>
    </div>
  );
}

function BulkBtn({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-2.5 py-1 rounded-md text-xs font-medium border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 hover:bg-[#ece2c4] dark:hover:bg-stone-800 text-stone-700 dark:text-stone-200"
    >
      Mark {children}
    </button>
  );
}

/* ─────────────── Tracker card ─────────────── */

const TrackerCard = memo(function TrackerCard({ pokemon: p, region, state, isSelected, onClick, openPanel }) {
  const primary = typeColor(p.types[0]).bg;
  const longPress = useLongPress(useCallback(() => openPanel(p.id), [openPanel, p.id]));

  const onCardClick   = useCallback((e) => onClick(p.id, e), [onClick, p.id]);
  const onContextMenu = useCallback((e) => { e.preventDefault(); openPanel(p.id); }, [openPanel, p.id]);

  const dimmed   = state === 'caught' || state === 'skipped';
  const priority = state === 'priority';
  const caught   = state === 'caught';
  const skipped  = state === 'skipped';

  return (
    <button
      type="button"
      onClick={onCardClick}
      onContextMenu={onContextMenu}
      {...longPress}
      aria-pressed={isSelected}
      className={`group relative flex flex-col items-center text-center p-3 rounded-lg
                  bg-[#fdf8e9] border hover:shadow-md dark:bg-stone-900
                  ${isSelected
                    ? 'border-blue-500 ring-2 ring-blue-300 dark:ring-blue-900'
                    : priority
                      ? 'border-amber-400 dark:border-amber-700'
                      : 'border-[#e6dabf] dark:border-stone-800 hover:border-[#c4b486] dark:hover:border-stone-600'}
                  transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500`}
    >
      <div
        className="relative w-full aspect-square flex items-center justify-center rounded-lg overflow-hidden"
        style={{ background: `radial-gradient(circle at 50% 50%, ${primary}26 0%, ${primary}14 70%, ${primary}0a 100%)` }}
      >
        <div
          className="absolute inset-0 hidden dark:block pointer-events-none"
          style={{ background: `radial-gradient(circle at 50% 50%, ${primary}3d 0%, ${primary}1f 70%, ${primary}0f 100%)` }}
        />
        <PokemonSprite
          pokemon={p}
          variant="animated"
          loading="lazy"
          className={`w-20 h-20 object-contain relative transition ${dimmed ? 'grayscale opacity-40' : ''}`}
        />
        {/* State badge overlays */}
        {caught && (
          <span className="absolute top-1 right-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500 text-white shadow">
            <Check size={12} strokeWidth={3} />
          </span>
        )}
        {priority && (
          <span className="absolute top-1 right-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-400 text-stone-900 shadow">
            <Star size={12} fill="currentColor" />
          </span>
        )}
        {skipped && (
          <span className="absolute top-1 right-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-stone-500 text-white shadow">
            <Slash size={12} strokeWidth={3} />
          </span>
        )}
      </div>
      <div className={`mt-2 font-mono text-xs text-stone-500 dark:text-stone-500 ${dimmed ? 'opacity-60' : ''}`}>
        {displayDex(p, region)}
      </div>
      <div className={`font-semibold text-sm text-stone-900 dark:text-stone-100 truncate w-full ${dimmed ? 'opacity-60' : ''}`}>
        {p.name}
      </div>
      <div className="mt-1 flex flex-wrap gap-1 justify-center">
        {[...new Set(p.types)].map((t) => <TypeBadge key={t} type={t} />)}
      </div>
    </button>
  );
});

function useLongPress(onLongPress, ms = 500) {
  const timer = useRef(null);
  const start = useCallback((e) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onLongPress(e), ms);
  }, [onLongPress, ms]);
  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  return { onTouchStart: start, onTouchEnd: cancel, onTouchMove: cancel, onTouchCancel: cancel };
}
