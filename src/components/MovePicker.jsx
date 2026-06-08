import { memo, useCallback, useDeferredValue, useMemo, useState } from 'react';
import { Sword, Sparkles, Cog } from 'lucide-react';
import TypeBadge from './TypeBadge.jsx';
import Modal from './Modal.jsx';
import DexSearchInput from './DexSearchInput.jsx';
import { ALL_POKEMON_TYPES, typeColor } from '../lib/types.js';
import { damageClassLabel } from '../lib/format.js';

const DAMAGE_CLASSES = [
  { key: 'PHYSICAL', label: 'Physical', Icon: Sword },
  { key: 'SPECIAL',  label: 'Special',  Icon: Sparkles },
  { key: 'STATUS',   label: 'Status',   Icon: Cog },
];

export default function MovePicker({ moves, currentMoveId, onPick, onClose }) {
  const [search, setSearch] = useState('');
  // useDeferredValue: input updates immediately, list re-render runs at lower
  // priority and can be interrupted by the next keystroke. Keeps typing snappy.
  const deferredSearch = useDeferredValue(search);
  const [typeFilters, setTypeFilters] = useState([]);
  const [classFilters, setClassFilters] = useState([]);
  const [expandedId, setExpandedId] = useState(null);

  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    const list = Object.values(moves).filter((m) => {
      if (q && !m.name.toLowerCase().includes(q)) return false;
      if (typeFilters.length > 0 && !typeFilters.some((t) => t.toLowerCase() === m.type.toLowerCase())) return false;
      if (classFilters.length > 0 && !classFilters.includes(m.damage_class)) return false;
      return true;
    });
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [moves, deferredSearch, typeFilters, classFilters]);

  function toggleType(t) {
    setTypeFilters((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);
  }
  function toggleClass(k) {
    setClassFilters((prev) => prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]);
  }

  // Stable callbacks so memoized rows skip re-render when an unrelated row
  // is expanded/collapsed.
  const handleToggleExpand = useCallback((id) => {
    setExpandedId((prev) => prev === id ? null : id);
  }, []);
  const handlePick = useCallback((id) => onPick(id), [onPick]);

  return (
    <Modal
      title="Pick a move"
      onClose={onClose}
      maxWidth="max-w-2xl"
      headerExtra={
        <>
          <DexSearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search moves (e.g. earth, body, stealth)…"
            autoFocus
          />

          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-xs text-stone-500 dark:text-stone-400 mr-1">Type</span>
            {ALL_POKEMON_TYPES.map((t) => {
              const selected = typeFilters.includes(t);
              const c = typeColor(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleType(t)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border transition-all ${
                    selected
                      ? 'border-stone-900 dark:border-stone-100 ring-1 ring-blue-500'
                      : 'border-[#d6c8a3] dark:border-stone-700 opacity-70 hover:opacity-100'
                  }`}
                  style={selected ? { backgroundColor: c.bg, color: c.fg, borderColor: c.bg } : undefined}
                >
                  {t}
                </button>
              );
            })}
            {typeFilters.length > 0 && (
              <button
                type="button"
                onClick={() => setTypeFilters([])}
                className="text-[10px] text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 underline"
              >
                Clear
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-xs text-stone-500 dark:text-stone-400 mr-1">Class</span>
            {DAMAGE_CLASSES.map(({ key, label, Icon }) => {
              const selected = classFilters.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleClass(key)}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border transition-colors ${
                    selected
                      ? 'bg-blue-500 text-white border-blue-500'
                      : 'bg-[#fdf8e9] dark:bg-stone-800 text-stone-700 dark:text-stone-300 border-[#d6c8a3] dark:border-stone-700 hover:bg-[#ece2c4] dark:hover:bg-stone-700'
                  }`}
                >
                  <Icon size={12} /> {label}
                </button>
              );
            })}
            <span className="text-[11px] text-stone-400 dark:text-stone-500 ml-auto tabular-nums">
              {filtered.length} move{filtered.length === 1 ? '' : 's'}
            </span>
          </div>
        </>
      }
    >
      {filtered.length === 0 ? (
        <div className="p-8 text-center text-stone-500 dark:text-stone-400 text-sm">
          No moves match these filters.
        </div>
      ) : (
        <ul>
          {filtered.map((m) => (
            <MoveRow
              key={m.id}
              move={m}
              isCurrent={m.id === currentMoveId}
              isExpanded={expandedId === m.id}
              onToggleExpand={handleToggleExpand}
              onPick={handlePick}
            />
          ))}
        </ul>
      )}
    </Modal>
  );
}

const MoveRow = memo(function MoveRow({ move, isCurrent, isExpanded, onToggleExpand, onPick }) {
  const Icon = move.damage_class === 'PHYSICAL' ? Sword
            : move.damage_class === 'SPECIAL'  ? Sparkles
            : Cog;
  return (
    <li className={`border-b border-[#ece2c4] dark:border-stone-800/60 ${isCurrent ? 'bg-blue-50 dark:bg-blue-950/30' : ''}`}>
      <div className="flex items-center gap-3 px-3 py-2">
        <button
          type="button"
          onClick={() => onPick(move.id)}
          className="flex-1 min-w-0 text-left flex items-center gap-3"
        >
          <span className="font-semibold text-stone-900 dark:text-stone-100 truncate">{move.name}</span>
          <TypeBadge type={move.type} />
        </button>
        <div className="flex items-center gap-2 text-xs text-stone-600 dark:text-stone-400 tabular-nums shrink-0">
          <span title={damageClassLabel(move.damage_class)} className="inline-flex items-center"><Icon size={14} /></span>
          <span className="w-7 text-right">{move.power ?? '—'}</span>
          <span className="w-7 text-right">{move.accuracy ?? '—'}</span>
          <span className="w-7 text-right">{move.pp ?? '—'}</span>
          <button
            type="button"
            onClick={() => onToggleExpand(move.id)}
            className="ml-1 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 text-[11px] underline"
            title="Show effect"
          >
            {isExpanded ? 'hide' : 'info'}
          </button>
        </div>
      </div>
      {isExpanded && move.effect && (
        <div className="px-3 pb-2 -mt-1 text-xs italic text-stone-600 dark:text-stone-400">
          {move.effect}{move.effect_chance ? ` (${move.effect_chance}% chance)` : ''}
        </div>
      )}
    </li>
  );
});
