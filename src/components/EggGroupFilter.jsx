import { memo } from 'react';
import MatchModeToggle from './MatchModeToggle.jsx';

// Simple two-slot select for egg groups. The list of group slugs comes from
// the page (derived from data.pokemon).
function EggGroupFilter({ groups, value, mode, onChange, onModeChange }) {
  const slot0 = value[0] || '';
  const slot1 = value[1] || '';

  function setSlot(idx, val) {
    const next = [slot0, slot1];
    next[idx] = val;
    onChange(next.filter(Boolean));
  }

  function clearAt(idx) {
    const next = [slot0, slot1];
    next[idx] = '';
    onChange(next.filter(Boolean));
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Slot value={slot0} groups={groups} onChange={(v) => setSlot(0, v)} onClear={() => clearAt(0)} placeholder="Pick group…" />
        <Slot value={slot1} groups={groups} onChange={(v) => setSlot(1, v)} onClear={() => clearAt(1)} placeholder="Pick group…" />
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

function Slot({ value, groups, onChange, onClear, placeholder }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2 py-1.5 pr-7 rounded-md border border-[#d6c8a3] dark:border-stone-700
                   bg-[#fdf8e9] dark:bg-stone-900 text-sm text-stone-900 dark:text-stone-100
                   focus:outline-none focus:ring-2 focus:ring-blue-500 capitalize"
      >
        <option value="">{placeholder}</option>
        {groups.map((g) => (
          <option key={g} value={g} className="capitalize">{g}</option>
        ))}
      </select>
      {value && (
        <button
          type="button"
          onClick={onClear}
          className="absolute top-1/2 right-1 -translate-y-1/2 text-xs text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 px-1"
          title="Clear"
        >
          ×
        </button>
      )}
    </div>
  );
}

export default memo(EggGroupFilter);
