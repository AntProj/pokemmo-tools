import { LayoutGrid, List } from 'lucide-react';
import RegionPills from './RegionPills.jsx';
import DexSearchInput from './DexSearchInput.jsx';

const SORT_OPTIONS = [
  { value: 'dex',  label: 'Dex #' },
  { value: 'name', label: 'Name A→Z' },
  { value: 'bst',  label: 'BST high→low' },
];

// Page-scoped toolbar: search, region, sort, and the grid/list view toggle.
// App-wide settings (theme, sprite style) deliberately live in the navbar's
// global Settings menu, not here — a per-page copy of them was redundant.
export default function Toolbar({
  search, onSearch,
  region, onRegion,
  sort, onSort, sortOptions,
  view, onView,
  resultCount,
  searchPlaceholder,
}) {
  const sortOpts = sortOptions || SORT_OPTIONS;

  // The toolbar pins just below the sticky navbar (≈45px tall, z-30) so both
  // stay visible while scrolling, without overlapping.
  return (
    <div className="sticky top-[45px] z-20 bg-[#f6efdc]/95 dark:bg-stone-950/95 backdrop-blur border-b border-[#e6dabf] dark:border-stone-800">
      <div className="max-w-7xl mx-auto px-4 py-3 space-y-3">
        {/* Row 1: result count + view toggle */}
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
        </div>

        {/* Row 2: search + sort */}
        <div className="flex items-center gap-3 flex-wrap">
          <DexSearchInput
            className="flex-1 min-w-[200px]"
            value={search}
            onChange={onSearch}
            placeholder={searchPlaceholder || 'Search by name or dex number (e.g. char, #150, 25)'}
          />

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
          <RegionPills value={region} onChange={onRegion} />
        )}
      </div>
    </div>
  );
}
