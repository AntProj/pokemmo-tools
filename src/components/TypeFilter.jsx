import { memo } from 'react';
import { ALL_POKEMON_TYPES, typeColor } from '../lib/types.js';
import MatchModeToggle from './MatchModeToggle.jsx';

// Up to 4 types, plus AND/OR toggle. Used by the Search tab.
function TypeFilter({ value, mode, max = 4, onChange, onModeChange }) {
  function toggle(t) {
    if (value.includes(t)) onChange(value.filter((x) => x !== t));
    else if (value.length < max) onChange([...value, t]);
    else onChange([...value.slice(1), t]); // bump oldest
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5 items-center">
        {ALL_POKEMON_TYPES.map((t) => {
          const selected = value.includes(t);
          const c = typeColor(t);
          return (
            <button
              key={t}
              type="button"
              onClick={() => toggle(t)}
              aria-pressed={selected}
              className={`px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wide border transition-all ${
                selected
                  ? 'border-stone-900 dark:border-stone-100 ring-2 ring-blue-500'
                  : 'border-[#d6c8a3] dark:border-stone-700 opacity-70 hover:opacity-100'
              }`}
              style={selected ? { backgroundColor: c.bg, color: c.fg, borderColor: c.bg } : undefined}
            >
              {t}
            </button>
          );
        })}
        {value.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="px-2 py-0.5 rounded text-xs text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 underline underline-offset-2"
          >
            Clear
          </button>
        )}
      </div>
      {value.length >= 2 && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-stone-500 dark:text-stone-400">Logic</span>
          <MatchModeToggle value={mode} onChange={onModeChange} />
        </div>
      )}
    </div>
  );
}

export default memo(TypeFilter);
