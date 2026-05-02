import { Search, LayoutGrid, List, Sun, Moon, X } from 'lucide-react';
import { ALL_POKEMON_TYPES, typeColor } from '../lib/types.js';

const REGIONS = ['All', 'Kanto', 'Johto', 'Hoenn', 'Sinnoh', 'Unova'];
const SORT_OPTIONS = [
  { value: 'dex',  label: 'Dex #' },
  { value: 'name', label: 'Name A→Z' },
  { value: 'bst',  label: 'BST high→low' },
];

export default function Toolbar({
  search, onSearch,
  region, onRegion,
  types, onTypes,
  sort, onSort, sortOptions,
  view, onView,
  theme, onTheme,
  resultCount,
  searchPlaceholder,
}) {
  const sortOpts = sortOptions || SORT_OPTIONS;
  function toggleType(t) {
    if (types.includes(t)) {
      onTypes(types.filter((x) => x !== t));
    } else if (types.length < 2) {
      onTypes([...types, t]);
    } else {
      // Replace the oldest selection so picking a 3rd type swaps in.
      onTypes([types[1], t]);
    }
  }

  return (
    <div className="sticky top-0 z-20 bg-[#f6efdc]/95 dark:bg-stone-950/95 backdrop-blur border-b border-[#e6dabf] dark:border-stone-800">
      <div className="max-w-7xl mx-auto px-4 py-3 space-y-3">
        {/* Row 1: title, view toggle, theme toggle */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-xs text-stone-500 dark:text-stone-400 tabular-nums mr-auto">
            {resultCount} result{resultCount === 1 ? '' : 's'}
          </div>

          {/* View toggle (only on pages that support multiple views) */}
          {view !== undefined && onView && (
            <div className="inline-flex rounded-md border border-[#d6c8a3] dark:border-stone-700 overflow-hidden">
              <button
                type="button"
                onClick={() => onView('grid')}
                aria-pressed={view === 'grid'}
                className={`px-2 py-1.5 ${view === 'grid'
                  ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                  : 'bg-[#fdf8e9] text-stone-700 hover:bg-[#ece2c4] dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800'}`}
                title="Grid view"
              >
                <LayoutGrid size={16} />
              </button>
              <button
                type="button"
                onClick={() => onView('list')}
                aria-pressed={view === 'list'}
                className={`px-2 py-1.5 ${view === 'list'
                  ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                  : 'bg-[#fdf8e9] text-stone-700 hover:bg-[#ece2c4] dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800'}`}
                title="List view"
              >
                <List size={16} />
              </button>
            </div>
          )}

          {/* Theme toggle */}
          <button
            type="button"
            onClick={() => onTheme(theme === 'dark' ? 'light' : 'dark')}
            className="p-1.5 rounded-md border border-[#d6c8a3] dark:border-stone-700
                       bg-[#fdf8e9] dark:bg-stone-900 hover:bg-[#ece2c4] dark:hover:bg-stone-800
                       text-stone-700 dark:text-stone-300"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>

        {/* Row 2: search + sort */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 dark:text-stone-500" />
            <input
              type="search"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder={searchPlaceholder || 'Search by name or dex number (e.g. char, #150, 25)'}
              className="w-full pl-8 pr-8 py-1.5 rounded-md border border-[#d6c8a3] dark:border-stone-700
                         bg-[#fdf8e9] dark:bg-stone-900 text-stone-900 dark:text-stone-100
                         placeholder:text-stone-400 dark:placeholder:text-stone-500
                         focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            {search && (
              <button
                type="button"
                onClick={() => onSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
                title="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-stone-500 dark:text-stone-400">Sort</label>
            <select
              value={sort}
              onChange={(e) => onSort(e.target.value)}
              className="px-2 py-1.5 rounded-md border border-[#d6c8a3] dark:border-stone-700
                         bg-[#fdf8e9] dark:bg-stone-900 text-stone-900 dark:text-stone-100 text-sm
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {sortOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        {/* Row 3: region toggles (only when caller provides region/onRegion) */}
        {region !== undefined && onRegion && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-stone-500 dark:text-stone-400 mr-1">Region</span>
            {REGIONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => onRegion(r)}
                aria-pressed={region === r}
                className={`px-2.5 py-1 rounded-md text-sm border transition-colors ${
                  region === r
                    ? 'bg-stone-900 text-white border-stone-900 dark:bg-stone-100 dark:text-stone-900 dark:border-stone-100'
                    : 'bg-[#fdf8e9] text-stone-700 border-[#d6c8a3] hover:bg-[#ece2c4] dark:bg-stone-900 dark:text-stone-300 dark:border-stone-700 dark:hover:bg-stone-800'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        )}

        {/* Row 4: simple type chips (only when caller provides types/onTypes) */}
        {types !== undefined && onTypes && (
        <div className="flex items-start gap-2 flex-wrap">
          <span className="text-xs text-stone-500 dark:text-stone-400 mr-1 mt-1.5">
            Types <span className="text-stone-400 dark:text-stone-500">(pick up to 2)</span>
          </span>
          <div className="flex flex-wrap gap-1.5">
            {ALL_POKEMON_TYPES.map((t) => {
              const selected = types.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleType(t)}
                  aria-pressed={selected}
                  className={`px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wide border transition-all ${
                    selected
                      ? 'border-stone-900 dark:border-stone-100 ring-2 ring-blue-500'
                      : 'border-stone-300 dark:border-stone-700 opacity-70 hover:opacity-100'
                  }`}
                  style={selected ? typeStyle(t) : { color: 'inherit' }}
                >
                  {t}
                </button>
              );
            })}
            {types.length > 0 && (
              <button
                type="button"
                onClick={() => onTypes([])}
                className="px-2 py-0.5 rounded text-xs text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 underline underline-offset-2"
              >
                Clear
              </button>
            )}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

function typeStyle(t) {
  const { bg, fg } = typeColor(t);
  return { backgroundColor: bg, color: fg, borderColor: bg };
}
