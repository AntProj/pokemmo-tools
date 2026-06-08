import { memo, useDeferredValue, useMemo, useRef, useState } from 'react';
import { X, Plus } from 'lucide-react';
import Popover from './Popover.jsx';
import DexSearchInput from './DexSearchInput.jsx';

// A trigger button → anchored popover. The button shows the current selection;
// clicking opens a searchable list anchored beneath it (no full-screen modal —
// picking one ability shouldn't black out the page).
function AbilityPicker({ abilities, value, onChange }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const current = value != null ? abilities[value] : null;

  return (
    <>
      <div className="flex items-stretch gap-2">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex-1 min-w-0 text-left px-3 py-2 rounded-md border border-[#d6c8a3] dark:border-stone-700
                     bg-[#fdf8e9] dark:bg-stone-900 hover:bg-[#ece2c4] dark:hover:bg-stone-800
                     transition-colors"
        >
          {current ? (
            <>
              <div className="font-semibold text-stone-900 dark:text-stone-100 truncate">{current.name}</div>
              <div className="mt-0.5 text-xs text-stone-500 dark:text-stone-400 truncate">{current.effect}</div>
            </>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-stone-500 dark:text-stone-400 text-sm">
              <Plus size={14} /> Pick an ability
            </span>
          )}
        </button>
        {current && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="p-2 rounded-md border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"
            title="Clear ability"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {open && (
        <Popover anchorRef={triggerRef} onClose={() => setOpen(false)}>
          <AbilityPopoverBody
            abilities={abilities}
            currentId={value}
            onPick={(id) => { onChange(id); setOpen(false); }}
          />
        </Popover>
      )}
    </>
  );
}

export default memo(AbilityPicker);

function AbilityPopoverBody({ abilities, currentId, onPick }) {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);

  const list = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const arr = Object.values(abilities);
    arr.sort((a, b) => a.name.localeCompare(b.name));
    if (!q) return arr;
    return arr.filter((a) =>
      a.name.toLowerCase().includes(q) || (a.effect || '').toLowerCase().includes(q)
    );
  }, [abilities, deferredQuery]);

  return (
    <>
      <div className="p-2 border-b border-[#e6dabf] dark:border-stone-800">
        <DexSearchInput value={query} onChange={setQuery} placeholder="Search abilities…" autoFocus />
      </div>
      <div className="flex-1 overflow-y-auto">
        {list.length === 0 ? (
          <div className="p-6 text-center text-stone-500 dark:text-stone-400 text-sm">No abilities match.</div>
        ) : (
          <ul>
            {list.map((a) => (
              <li key={a.id} className={`border-b border-[#ece2c4] dark:border-stone-800/60 ${a.id === currentId ? 'bg-blue-50 dark:bg-blue-950/30' : ''}`}>
                <button
                  type="button"
                  onClick={() => onPick(a.id)}
                  className="w-full text-left px-3 py-2 hover:bg-[#f1e9d2] dark:hover:bg-stone-800/40"
                >
                  <div className="font-semibold text-sm text-stone-900 dark:text-stone-100">{a.name}</div>
                  {a.effect && (
                    <div className="text-xs text-stone-600 dark:text-stone-400 italic mt-0.5 line-clamp-2">{a.effect}</div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
