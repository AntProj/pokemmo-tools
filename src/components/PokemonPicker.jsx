import { memo, useDeferredValue, useMemo, useState } from 'react';
import { X, Plus } from 'lucide-react';
import TypeBadge from './TypeBadge.jsx';
import PokemonSprite from './PokemonSprite.jsx';
import Modal from './Modal.jsx';
import DexSearchInput from './DexSearchInput.jsx';
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
    <Modal
      title="Pick a Pokémon"
      onClose={onClose}
      headerExtra={
        <DexSearchInput value={query} onChange={setQuery} placeholder="Search by name or dex number…" autoFocus />
      }
    >
      {list.length === 0 ? (
        <div className="p-8 text-center text-stone-500 dark:text-stone-400 text-sm">No Pokémon match.</div>
      ) : (
        <ul>
          {list.map((p) => (
            <PickRow key={p.id} pokemon={p} active={p.id === currentId} onPick={() => onPick(p.id)} />
          ))}
        </ul>
      )}
    </Modal>
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
