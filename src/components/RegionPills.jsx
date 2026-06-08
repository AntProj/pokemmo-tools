import { REGIONS } from '../lib/format.js';

/**
 * The All/Kanto/Johto/Hoenn/Sinnoh/Unova selector, extracted from the byte-
 * identical copies that lived in Toolbar, TrackerMark, and TrackerPlan (which
 * had already drifted on the focus-ring width). Single-select.
 *
 *   <RegionPills value={region} onChange={setRegion} />
 */
export default function RegionPills({
  value,
  onChange,
  regions = REGIONS,
  label = 'Region',
  className = '',
}) {
  return (
    <div className={`flex items-center gap-2 flex-wrap ${className}`}>
      {label && <span className="text-xs text-stone-500 dark:text-stone-400 mr-1">{label}</span>}
      {regions.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onChange(r)}
          aria-pressed={value === r}
          className={`px-2.5 py-1 rounded-md text-sm border transition-colors ${
            value === r
              ? 'bg-stone-900 text-white border-stone-900 dark:bg-stone-100 dark:text-stone-900 dark:border-stone-100'
              : 'bg-[#fdf8e9] text-stone-700 border-[#d6c8a3] hover:bg-[#ece2c4] dark:bg-stone-900 dark:text-stone-300 dark:border-stone-700 dark:hover:bg-stone-800'
          }`}
        >
          {r}
        </button>
      ))}
    </div>
  );
}
