import { Search, X } from 'lucide-react';

/**
 * Search input with a leading magnifier icon and a trailing clear-X, extracted
 * from the near-identical copies in Toolbar and TrackerMark. Controlled.
 *
 *   <DexSearchInput value={q} onChange={setQ} placeholder="Search…" />
 */
export default function DexSearchInput({
  value,
  onChange,
  placeholder = 'Search by name or dex number',
  className = '',
  autoFocus = false,
}) {
  return (
    <div className={`relative ${className}`}>
      <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 dark:text-stone-500" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="w-full pl-8 pr-8 py-1.5 rounded-md border border-[#d6c8a3] dark:border-stone-700
                   bg-[#fdf8e9] dark:bg-stone-900 text-stone-900 dark:text-stone-100
                   placeholder:text-stone-400 dark:placeholder:text-stone-500
                   focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
          title="Clear search"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
