/**
 * Generic toggle-pill filter row. Replaces the ~5 near-clone rows in
 * TrackerMark (State / Babies / Encounter / Evolution / Hunt tier) and the
 * Method / Rarity rows in TrackerPlan — each was ~25 lines of JSX differing
 * only by color token and select mode.
 *
 *   <FilterRow
 *     label="State"
 *     options={[{ key:'caught', label:'Caught' }, ...]}
 *     selected={markStates}            // array (multi) or value (single)
 *     onToggle={toggleStateFilter}
 *     color="blue"
 *     onClear={() => updateView({ markStates: [] })}
 *   />
 *
 * Per-option overrides: `option.color`, `option.title` (tooltip), `option.icon`
 * (ReactNode rendered before the label). `mode="single"` compares `selected`
 * by equality instead of array membership (used for the 3-way Babies toggle).
 * `children` renders after the pills (e.g. the rarity Only/Any mode switch).
 */

const SELECTED_COLORS = {
  blue:    'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-900',
  pink:    'bg-pink-100 text-pink-800 border-pink-300 dark:bg-pink-950/50 dark:text-pink-300 dark:border-pink-900',
  violet:  'bg-violet-100 text-violet-800 border-violet-300 dark:bg-violet-950/50 dark:text-violet-300 dark:border-violet-900',
  emerald: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900',
  amber:   'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900',
  rose:    'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-900',
  stone:   'bg-stone-200 text-stone-800 border-stone-400 dark:bg-stone-800 dark:text-stone-300 dark:border-stone-600',
};
const UNSELECTED =
  'bg-[#fdf8e9] dark:bg-stone-900 text-stone-700 dark:text-stone-300 border-[#d6c8a3] dark:border-stone-700 hover:bg-[#ece2c4] dark:hover:bg-stone-800';

export default function FilterRow({
  label,
  options,
  selected,
  onToggle,
  mode = 'multi',
  color = 'blue',
  onClear,
  children,
}) {
  const isSelected = (key) => (mode === 'single' ? selected === key : selected.includes(key));
  const anySelected = mode === 'single'
    ? selected != null
    : Array.isArray(selected) && selected.length > 0;

  return (
    <div className="flex items-start gap-2 flex-wrap">
      <span className="text-xs text-stone-500 dark:text-stone-400 mr-1 mt-1">{label}</span>
      <div className="flex flex-wrap gap-1.5 items-center">
        {options.map((opt) => {
          const sel = isSelected(opt.key);
          const selClass = SELECTED_COLORS[opt.color || color] || SELECTED_COLORS.blue;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => onToggle(opt.key)}
              aria-pressed={sel}
              title={opt.title}
              className={`px-2 py-0.5 rounded text-xs border transition-colors inline-flex items-center gap-1 ${
                sel ? selClass : UNSELECTED
              }`}
            >
              {opt.icon != null && <span aria-hidden>{opt.icon}</span>}
              {opt.label}
            </button>
          );
        })}
        {children}
        {onClear && anySelected && (
          <button
            type="button"
            onClick={onClear}
            className="ml-1 text-xs text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 underline underline-offset-2"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
