import { useMemo, useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import {
  computeAllBalls, effectiveCatchRate, statusMultOf, STATUS_OPTIONS,
} from '../lib/catchCalc.js';

// Compact catch calculator embedded in the Pokémon detail popup. Same engine
// (lib/catchCalc.js) as the old standalone Catch Calc tab, minus the species
// picker (the popup already knows the mon) and the URL sync. The ball list is
// height-capped so it shows ~5 balls at a time and scrolls the rest — keeps the
// popup short.
//
// Catch rate is read automatically from the mon (incl. PokeMMO starter/Beldum
// overrides); there's no manual-rate box here to stay compact.

const DEFAULTS = {
  hp: 1,             // False-Swipe-to-1% is the common case
  falseSwipe: false,
  status: 'asleep',
  turn: 1,
  level: '',
  chain: 0,
  time: 'day',
  cave: false,
  water: false,
  alpha: false,
};

export default function CatchCalcPanel({ pokemon }) {
  const [form, setForm] = useState(DEFAULTS);
  const set = (field, value) => setForm((f) => {
    const next = { ...f, [field]: value };
    if (field === 'falseSwipe' && value) next.hp = 1;
    return next;
  });

  const rateInfo = useMemo(
    () => effectiveCatchRate(pokemon, { alpha: form.alpha }),
    [pokemon, form.alpha]
  );

  const rows = useMemo(() => {
    if (!pokemon || !rateInfo.value) return [];
    return computeAllBalls({
      pokemon,
      catchRate: rateInfo.value,
      hp: form.hp,
      statusMult: statusMultOf(form.status),
      turn: form.turn,
      chain: form.chain,
      night: form.time === 'night',
      cave: form.cave,
      water: form.water,
      types: pokemon.types,
      weight: pokemon.weight || 0,
      level: form.level === '' ? null : Number(form.level),
    })
      .filter((b) => b.key !== 'master')
      .sort((a, b) => b.chance - a.chance);
  }, [pokemon, rateInfo.value, form.hp, form.status, form.turn, form.chain,
      form.time, form.cave, form.water, form.level]);

  const bestKey = rows[0]?.key ?? null;

  return (
    <div className="space-y-3 text-sm">
      {/* Catch rate + Alpha */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs text-stone-500 dark:text-stone-400">
          Catch rate{' '}
          <span className="font-mono tabular-nums text-stone-800 dark:text-stone-200">
            {rateInfo.value ?? '—'}
          </span>
          <span className="text-stone-400 dark:text-stone-500">/255</span>
          {rateInfo.source !== 'base' && rateInfo.base != null && rateInfo.value !== rateInfo.base && (
            <span className="ml-1 text-stone-400 dark:text-stone-500">(base {rateInfo.base})</span>
          )}
        </div>
        <Check label="Alpha (rate → 10)" checked={form.alpha} onChange={(v) => set('alpha', v)} />
      </div>

      {/* HP */}
      <div className="space-y-1">
        <label className="text-xs text-stone-500 dark:text-stone-400">Target HP %</label>
        <div className="flex items-center gap-2">
          <input
            type="range" min="1" max="100" value={form.hp}
            disabled={form.falseSwipe}
            onChange={(e) => set('hp', Number(e.target.value))}
            className="flex-1 accent-blue-500 disabled:opacity-50"
          />
          <span className="w-9 text-right font-mono tabular-nums text-xs text-stone-700 dark:text-stone-300">
            {form.hp}%
          </span>
        </div>
        <Check label="False Swipe (locks HP at 1%)" checked={form.falseSwipe} onChange={(v) => set('falseSwipe', v)} />
      </div>

      {/* Status */}
      <div className="space-y-1">
        <label className="text-xs text-stone-500 dark:text-stone-400">Status</label>
        <div className="flex flex-wrap gap-1">
          {STATUS_OPTIONS.map((s) => (
            <Chip key={s.key} active={form.status === s.key} onClick={() => set('status', s.key)}>
              {s.label} <span className="opacity-60 text-[10px] tabular-nums">×{s.mult}</span>
            </Chip>
          ))}
        </div>
      </div>

      {/* Conditions */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-xs text-stone-500 dark:text-stone-400">Time</label>
          <div className="inline-flex w-full rounded-md border border-[#d6c8a3] dark:border-stone-700 overflow-hidden">
            {[{ k: 'day', L: 'Day', I: Sun }, { k: 'night', L: 'Night', I: Moon }].map(({ k, L, I }) => (
              <button
                key={k} type="button" onClick={() => set('time', k)} aria-pressed={form.time === k}
                className={`flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 text-xs ${
                  form.time === k
                    ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                    : 'bg-[#fdf8e9] dark:bg-stone-900 text-stone-600 dark:text-stone-400 hover:bg-[#ece2c4] dark:hover:bg-stone-800'
                }`}
              >
                <I size={12} /> {L}
              </button>
            ))}
          </div>
        </div>
        <Num label="Battle turn" value={form.turn} min={1} max={99} onChange={(v) => set('turn', v === '' ? 1 : v)} />
        <Num label="Catch streak (Repeat)" value={form.chain} min={0} max={99} onChange={(v) => set('chain', v === '' ? 0 : v)} />
        <Num label="Mon level (Nest)" value={form.level} min={1} max={100} placeholder="—" onChange={(v) => set('level', v)} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Check label="In a cave (Dusk)" checked={form.cave} onChange={(v) => set('cave', v)} />
        <Check label="In water (Dive/Lure)" checked={form.water} onChange={(v) => set('water', v)} />
      </div>

      {/* Ball list — scrollable, ~5 visible */}
      <div className="space-y-1">
        <label className="text-xs text-stone-500 dark:text-stone-400">
          Best balls <span className="text-stone-400 dark:text-stone-500">(by catch chance)</span>
        </label>
        <div className="max-h-[200px] overflow-y-auto rounded-md border border-[#e6dabf] dark:border-stone-800 divide-y divide-[#ece2c4] dark:divide-stone-800/60">
          {rows.map((row) => (
            <BallRow key={row.key} row={row} best={row.key === bestKey} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─────────────── small helpers ─────────────── */

function BallRow({ row, best }) {
  const pct = row.chance * 100;
  const color =
    pct >= 80 ? 'text-emerald-600 dark:text-emerald-400'
    : pct >= 40 ? 'text-yellow-600 dark:text-yellow-300'
    : pct >= 15 ? 'text-orange-600 dark:text-orange-400'
                : 'text-red-600 dark:text-red-400';
  return (
    <div className={`flex items-center gap-2 px-2.5 py-1.5 ${best ? 'bg-emerald-50/70 dark:bg-emerald-950/20 border-l-2 border-l-emerald-500' : ''}`}>
      <span className={`flex-1 min-w-0 truncate font-semibold ${row.condMet ? 'text-stone-900 dark:text-stone-100' : 'text-stone-400 dark:text-stone-500'}`}>
        {row.name}
      </span>
      <span className="w-12 text-right font-mono tabular-nums text-xs text-stone-600 dark:text-stone-400">
        {row.guaranteed ? '—' : `${row.mult.toFixed(2)}×`}
      </span>
      <span className={`w-14 text-right font-mono tabular-nums font-bold ${color}`}>
        {row.guaranteed ? '100%' : `${pct.toFixed(1)}%`}
      </span>
    </div>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-2 py-0.5 rounded text-xs border transition-colors ${
        active
          ? 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-900'
          : 'bg-[#fdf8e9] dark:bg-stone-900 text-stone-700 dark:text-stone-300 border-[#d6c8a3] dark:border-stone-700 hover:bg-[#ece2c4] dark:hover:bg-stone-800'
      }`}
    >
      {children}
    </button>
  );
}

function Check({ label, checked, onChange }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-stone-700 dark:text-stone-300 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-blue-500" />
      {label}
    </label>
  );
}

function Num({ label, value, min, max, placeholder, onChange }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-stone-500 dark:text-stone-400">{label}</label>
      <input
        type="number" min={min} max={max} value={value} placeholder={placeholder}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '') { onChange(''); return; }
          const n = Number(v);
          if (!Number.isFinite(n)) return;
          onChange(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n)));
        }}
        className="w-full px-2 py-1 rounded-md border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-stone-900 dark:text-stone-100 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}
