import { memo, useDeferredValue, useMemo, useRef, useState } from 'react';
import { X, Plus } from 'lucide-react';
import Popover from './Popover.jsx';
import DexSearchInput from './DexSearchInput.jsx';

// Single-select held-item picker. `options` is a deduped list of { id, name }.
// Trigger button → anchored popover (no full-screen modal for one pick).
function HeldItemPicker({ options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const current = value != null ? options.find((o) => o.id === value) : null;

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
            <div className="font-semibold text-stone-900 dark:text-stone-100 truncate">{current.name}</div>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-stone-500 dark:text-stone-400 text-sm">
              <Plus size={14} /> Pick a held item
            </span>
          )}
        </button>
        {current && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="p-2 rounded-md border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"
            title="Clear held item"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {open && (
        <Popover anchorRef={triggerRef} onClose={() => setOpen(false)}>
          <HeldItemPopoverBody
            options={options}
            currentId={value}
            onPick={(id) => { onChange(id); setOpen(false); }}
          />
        </Popover>
      )}
    </>
  );
}

export default memo(HeldItemPicker);

function HeldItemPopoverBody({ options, currentId, onPick }) {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);

  const list = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const arr = options.slice().sort((a, b) => a.name.localeCompare(b.name));
    if (!q) return arr;
    return arr.filter((o) => o.name.toLowerCase().includes(q));
  }, [options, deferredQuery]);

  return (
    <>
      <div className="p-2 border-b border-[#e6dabf] dark:border-stone-800">
        <DexSearchInput value={query} onChange={setQuery} placeholder="Search held items…" autoFocus />
      </div>
      <div className="flex-1 overflow-y-auto">
        {list.length === 0 ? (
          <div className="p-6 text-center text-stone-500 dark:text-stone-400 text-sm">No items match.</div>
        ) : (
          <ul>
            {list.map((o) => (
              <li key={o.id} className={`border-b border-[#ece2c4] dark:border-stone-800/60 ${o.id === currentId ? 'bg-blue-50 dark:bg-blue-950/30' : ''}`}>
                <button
                  type="button"
                  onClick={() => onPick(o.id)}
                  className="w-full text-left px-3 py-2 hover:bg-[#f1e9d2] dark:hover:bg-stone-800/40 text-sm font-medium text-stone-900 dark:text-stone-100"
                >
                  {o.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
