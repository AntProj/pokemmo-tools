import { memo } from 'react';
import { X } from 'lucide-react';

// Tiny dumb component — receives a list of chip descriptors and renders them.
// Each chip has: { key, label, onRemove?, onToggle?, kind? }.
// kind controls coloring: 'filter' (default), 'logic' (toggleable AND/OR).
function FilterChips({ chips }) {
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      {chips.map((c) => (
        <Chip key={c.key} {...c} />
      ))}
    </div>
  );
}

function Chip({ label, onRemove, onToggle, kind = 'filter' }) {
  const base = 'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border';
  const colors = kind === 'logic'
    ? 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-900'
    : 'bg-[#fdf8e9] text-stone-700 border-[#d6c8a3] dark:bg-stone-800 dark:text-stone-200 dark:border-stone-700';
  if (onToggle) {
    return (
      <button type="button" onClick={onToggle} className={`${base} ${colors} hover:bg-blue-200 dark:hover:bg-blue-900/60`} title="Toggle AND/ANY">
        {label}
      </button>
    );
  }
  return (
    <span className={`${base} ${colors}`}>
      {label}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="text-stone-400 hover:text-stone-900 dark:hover:text-stone-100"
          title="Remove"
        >
          <X size={12} />
        </button>
      )}
    </span>
  );
}

export default memo(FilterChips);
