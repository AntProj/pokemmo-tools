import { useCallback, useEffect, useRef, useState } from 'react';
import DualRangeSlider from './DualRangeSlider.jsx';

const STATS = [
  { key: 'hp',         label: 'HP'  },
  { key: 'attack',     label: 'Atk' },
  { key: 'defense',    label: 'Def' },
  { key: 'sp_attack',  label: 'SpA' },
  { key: 'sp_defense', label: 'SpD' },
  { key: 'speed',      label: 'Spe' },
  { key: 'bst',        label: 'BST' },
];

// Props:
// - bounds: { hp: {min,max}, ... bst: {min,max} } from the dataset
// - applied: { hp: null | [lo, hi], ... }  ← state lifted to App.jsx
// - onApply(applied):  pushes the next applied state up
//
// The component holds its own draft state, which mirrors `applied` on mount.
// Drags update draft only, and a 150 ms debounce timer pushes draft → applied.
export default function StatRangeSliders({ bounds, applied, onApply }) {
  const [draft, setDraft] = useState(() => initDraft(applied, bounds));
  const onApplyRef = useRef(onApply);
  useEffect(() => { onApplyRef.current = onApply; }, [onApply]);

  // Debounce draft → applied. We compare draft to bounds to know whether each
  // slider is "filtering" or at full-range (= null in applied).
  useEffect(() => {
    const id = setTimeout(() => {
      const next = {};
      for (const { key } of STATS) {
        const [lo, hi] = draft[key];
        const b = bounds[key];
        next[key] = (lo === b.min && hi === b.max) ? null : [lo, hi];
      }
      onApplyRef.current(next);
    }, 150);
    return () => clearTimeout(id);
  }, [draft, bounds]);

  // Sync from applied when it changes externally (e.g. Reset button or
  // navigation back to the page). Compare deeply against draft to avoid loops.
  useEffect(() => {
    const incoming = initDraft(applied, bounds);
    setDraft((prev) => {
      let same = true;
      for (const { key } of STATS) {
        if (prev[key][0] !== incoming[key][0] || prev[key][1] !== incoming[key][1]) {
          same = false; break;
        }
      }
      return same ? prev : incoming;
    });
  }, [applied, bounds]);

  const setRow = useCallback((key, range) => {
    setDraft((prev) => ({ ...prev, [key]: range }));
  }, []);

  const reset = useCallback(() => {
    const cleared = {};
    for (const { key } of STATS) cleared[key] = [bounds[key].min, bounds[key].max];
    setDraft(cleared);
  }, [bounds]);

  return (
    <div className="space-y-3">
      {STATS.map(({ key, label }) => (
        <StatRow
          key={key}
          label={label}
          range={draft[key]}
          bounds={bounds[key]}
          onChange={(r) => setRow(key, r)}
        />
      ))}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={reset}
          className="text-xs text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 underline underline-offset-2"
        >
          Reset stats
        </button>
      </div>
    </div>
  );
}

function StatRow({ label, range, bounds, onChange }) {
  const [lo, hi] = range;
  return (
    <div className="grid grid-cols-[40px_1fr_70px] items-center gap-3">
      <span className="text-xs font-semibold text-stone-500 dark:text-stone-400 uppercase">{label}</span>
      <DualRangeSlider min={bounds.min} max={bounds.max} value={range} onChange={onChange} />
      <span className="font-mono text-xs tabular-nums text-stone-700 dark:text-stone-300 text-right">
        {lo}–{hi}
      </span>
    </div>
  );
}

function initDraft(applied, bounds) {
  const out = {};
  for (const { key } of STATS) {
    const v = applied?.[key];
    out[key] = v ? [v[0], v[1]] : [bounds[key].min, bounds[key].max];
  }
  return out;
}
