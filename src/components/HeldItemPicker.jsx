import { memo, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Search, X, Plus } from 'lucide-react';

// Single-select held-item picker. `options` is a deduped list of
// { id, name } pulled from each pokemon.held_items entry.
function HeldItemPicker({ options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const current = value != null ? options.find((o) => o.id === value) : null;

  return (
    <>
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
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
        <HeldItemPickerModal
          options={options}
          currentId={value}
          onPick={(id) => { onChange(id); setOpen(false); }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export default memo(HeldItemPicker);

function HeldItemPickerModal({ options, currentId, onPick, onClose }) {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const list = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const arr = options.slice().sort((a, b) => a.name.localeCompare(b.name));
    if (!q) return arr;
    return arr.filter((o) => o.name.toLowerCase().includes(q));
  }, [options, deferredQuery]);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70" onClick={onClose}>
      <div className="min-h-full flex items-start sm:items-center justify-center p-3 sm:p-6">
        <div
          className="w-full max-w-xl bg-[#fdf8e9] dark:bg-stone-900
                     rounded-lg shadow-2xl border border-[#e6dabf] dark:border-stone-800
                     flex flex-col h-[min(640px,calc(100vh-3rem))]"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Pick a held item"
        >
          <div className="p-4 border-b border-[#e6dabf] dark:border-stone-800 space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold mr-auto text-stone-900 dark:text-stone-100">Pick a held item</h2>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-md bg-[#fdf8e9] dark:bg-stone-800 hover:bg-[#ece2c4] dark:hover:bg-stone-700 text-stone-700 dark:text-stone-200"
                title="Close (Esc)"
              >
                <X size={18} />
              </button>
            </div>
            <div className="relative">
              <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 dark:text-stone-500" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search held items…"
                autoFocus
                className="w-full pl-8 pr-3 py-1.5 rounded-md border border-[#d6c8a3] dark:border-stone-700
                           bg-[#fdf8e9] dark:bg-stone-900 text-stone-900 dark:text-stone-100
                           placeholder:text-stone-400 dark:placeholder:text-stone-500
                           focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {list.length === 0 ? (
              <div className="p-8 text-center text-stone-500 dark:text-stone-400 text-sm">No items match.</div>
            ) : (
              <ul>
                {list.map((o) => (
                  <li key={o.id} className={`border-b border-[#ece2c4] dark:border-stone-800/60 ${o.id === currentId ? 'bg-blue-50 dark:bg-blue-950/30' : ''}`}>
                    <button
                      type="button"
                      onClick={() => onPick(o.id)}
                      className="w-full text-left px-3 py-2 hover:bg-[#f1e9d2] dark:hover:bg-stone-800/40 font-medium text-stone-900 dark:text-stone-100"
                    >
                      {o.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
