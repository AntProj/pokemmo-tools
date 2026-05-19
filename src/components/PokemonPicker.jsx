import { memo, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Search, X, Plus } from 'lucide-react';
import TypeBadge from './TypeBadge.jsx';
import PokemonSprite from './PokemonSprite.jsx';
import { typeColor } from '../lib/types.js';
import { dexNum } from '../lib/format.js';

// Searchable Pokémon picker. Trigger button shows the current selection (or a
// placeholder); clicking opens a modal with a search box and a scrollable list.
function PokemonPicker({ pokemon, value, onChange, placeholder = 'Pick a Pokémon' }) {
  const [open, setOpen] = useState(false);
  const current = value != null ? pokemon.find((p) => p.id === value) : null;

  return (
    <>
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex-1 min-w-0 text-left px-3 py-2 rounded-md border border-[#d6c8a3] dark:border-stone-700
                     bg-[#fdf8e9] dark:bg-stone-900 hover:bg-[#ece2c4] dark:hover:bg-stone-800 transition-colors"
        >
          {current ? (
            <CurrentMon pokemon={current} />
          ) : (
            <span className="inline-flex items-center gap-1.5 text-stone-500 dark:text-stone-400 text-sm">
              <Plus size={14} /> {placeholder}
            </span>
          )}
        </button>
        {current && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="p-2 rounded-md border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"
            title="Clear selection"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {open && (
        <PokemonPickerModal
          pokemon={pokemon}
          currentId={value}
          onPick={(id) => { onChange(id); setOpen(false); }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function CurrentMon({ pokemon: p }) {
  const primary = typeColor(p.types[0]).bg;
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div
        className="relative shrink-0 w-10 h-10 rounded-md overflow-hidden flex items-center justify-center"
        style={{ background: `radial-gradient(circle at 50% 50%, ${primary}26 0%, ${primary}14 70%, ${primary}0a 100%)` }}
      >
        <PokemonSprite pokemon={p} variant="animated" loading="lazy" className="w-9 h-9 object-contain" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-[11px] text-stone-500">{dexNum(p.id)}</span>
          <span className="font-semibold text-stone-900 dark:text-stone-100 truncate">{p.name}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap gap-1">
          {[...new Set(p.types)].map((t) => <TypeBadge key={t} type={t} />)}
        </div>
      </div>
    </div>
  );
}

export default memo(PokemonPicker);

function PokemonPickerModal({ pokemon, currentId, onPick, onClose }) {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const list = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return pokemon;
    let dexQuery = null;
    const m = q.replace(/^#/, '').match(/^\d+$/);
    if (m) dexQuery = parseInt(m[0], 10);
    return pokemon.filter((p) =>
      p.name.toLowerCase().includes(q) || (dexQuery != null && p.id === dexQuery)
    );
  }, [pokemon, deferredQuery]);

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
          aria-label="Pick a Pokémon"
        >
          <div className="p-4 border-b border-[#e6dabf] dark:border-stone-800 space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold mr-auto text-stone-900 dark:text-stone-100">Pick a Pokémon</h2>
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
                placeholder="Search by name or dex number…"
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
              <div className="p-8 text-center text-stone-500 dark:text-stone-400 text-sm">No Pokémon match.</div>
            ) : (
              <ul>
                {list.map((p) => (
                  <PickRow key={p.id} pokemon={p} active={p.id === currentId} onPick={() => onPick(p.id)} />
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const PickRow = memo(function PickRow({ pokemon: p, active, onPick }) {
  const primary = typeColor(p.types[0]).bg;
  return (
    <li className={`border-b border-[#ece2c4] dark:border-stone-800/60 ${active ? 'bg-blue-50 dark:bg-blue-950/30' : ''}`}>
      <button
        type="button"
        onClick={onPick}
        className="w-full text-left px-3 py-2 hover:bg-[#f1e9d2] dark:hover:bg-stone-800/40 flex items-center gap-3"
      >
        <div
          className="relative shrink-0 w-10 h-10 rounded overflow-hidden flex items-center justify-center"
          style={{ background: `radial-gradient(circle at 50% 50%, ${primary}26 0%, ${primary}14 70%, ${primary}0a 100%)` }}
        >
          <PokemonSprite pokemon={p} variant="animated" loading="lazy" className="w-9 h-9 object-contain" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-[11px] text-stone-500">{dexNum(p.id)}</span>
            <span className="font-semibold text-stone-900 dark:text-stone-100 truncate">{p.name}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap gap-1">
            {[...new Set(p.types)].map((t) => <TypeBadge key={t} type={t} />)}
          </div>
        </div>
      </button>
    </li>
  );
});
