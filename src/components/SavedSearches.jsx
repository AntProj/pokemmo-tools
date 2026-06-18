import { useEffect, useRef, useState } from 'react';
import { Bookmark, Share2, Plus, Trash2 } from 'lucide-react';
import { loadSaved, saveSaved } from '../lib/savedSearches.js';
import { showToast } from '../lib/toast.js';

const rid = () => 'ss_' + Math.random().toString(36).slice(2, 9);

// Dropdown for sharing the current filtered view (copies the live URL) and
// for saving / recalling named filter presets. `currentParams` is the query
// string for the active filters; `onApply(paramsString)` restores a preset.
export default function SavedSearches({ currentParams, hasFilters, onApply }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState(loadSaved);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const persist = (next) => { setList(next); saveSaved(next); };

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast('Shareable link copied to clipboard', { kind: 'success' });
    } catch {
      showToast('Couldn’t copy — copy the address bar manually', { kind: 'warn' });
    }
    setOpen(false);
  };

  const saveCurrent = () => {
    const name = window.prompt('Name this search:');
    if (!name || !name.trim()) return;
    persist([...list, { id: rid(), name: name.trim(), params: currentParams }]);
    showToast(`Saved “${name.trim()}”`, { kind: 'success' });
  };

  const apply = (item) => { onApply(item.params); setOpen(false); };
  const del = (id) => persist(list.filter((x) => x.id !== id));

  const itemBtn =
    'w-full flex items-center gap-2 px-3 py-2 text-sm text-stone-700 dark:text-stone-300 ' +
    'hover:bg-[#ece2c4] dark:hover:bg-stone-800 disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm
                   bg-[#fdf8e9] dark:bg-stone-900 border-[#d6c8a3] dark:border-stone-700
                   hover:bg-[#ece2c4] dark:hover:bg-stone-800 text-stone-700 dark:text-stone-200"
        title="Save or share this search"
      >
        <Bookmark size={14} />
        <span>Saved{list.length ? ` (${list.length})` : ''}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-1 min-w-[240px] max-w-[min(20rem,90vw)] py-1 rounded-md
                     border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 shadow-xl"
        >
          <button type="button" role="menuitem" onClick={share} disabled={!hasFilters} className={itemBtn}>
            <Share2 size={14} /> Copy shareable link
          </button>
          <button type="button" role="menuitem" onClick={saveCurrent} disabled={!hasFilters} className={itemBtn}>
            <Plus size={14} /> Save current search…
          </button>

          <div className="my-1 border-t border-[#ece2c4] dark:border-stone-800" />

          {list.length === 0 ? (
            <div className="px-3 py-2 text-xs text-stone-400 dark:text-stone-500">
              No saved searches yet. Set up filters, then “Save current search”.
            </div>
          ) : (
            list.map((item) => (
              <div key={item.id} className="flex items-center group">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => apply(item)}
                  className="flex-1 min-w-0 px-3 py-2 text-sm text-left truncate text-stone-700 dark:text-stone-300 hover:bg-[#ece2c4] dark:hover:bg-stone-800"
                  title={`Apply “${item.name}”`}
                >
                  {item.name}
                </button>
                <button
                  type="button"
                  onClick={() => del(item.id)}
                  className="px-2 py-2 text-stone-400 hover:text-red-600 dark:hover:text-red-400"
                  title="Delete"
                  aria-label={`Delete ${item.name}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
