import { ALL_POKEMON_TYPES, typeColor } from '../lib/types.js';

/**
 * Type-swatch multi-select (max N, default 2), extracted from the inline copy
 * in TrackerMark so the Tracker's Mark and Plan views share one picker. When
 * the selection is full, picking another swaps out the oldest. Selected pills
 * show their type color; unselected are dimmed outlines.
 *
 *   <TypePills value={types} onChange={setTypes} />
 */
export default function TypePills({ value, onChange, max = 2, label = 'Types' }) {
  function toggle(t) {
    if (value.includes(t)) onChange(value.filter((x) => x !== t));
    else if (value.length < max) onChange([...value, t]);
    else onChange([...value.slice(1), t]); // drop oldest to make room
  }
  return (
    <div className="flex items-start gap-2 flex-wrap">
      {label && <span className="text-xs text-stone-500 dark:text-stone-400 mr-1 mt-1">{label}</span>}
      <div className="flex flex-wrap gap-1.5 items-center">
        {ALL_POKEMON_TYPES.map((t) => {
          const sel = value.includes(t);
          const c = typeColor(t);
          return (
            <button
              key={t}
              type="button"
              onClick={() => toggle(t)}
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
        {value.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="ml-1 text-xs text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 underline underline-offset-2"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
