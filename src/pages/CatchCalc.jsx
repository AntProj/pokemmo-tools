import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Sun, Moon, RotateCcw, Calculator } from 'lucide-react';
import PokemonPicker from '../components/PokemonPicker.jsx';
import {
  computeAllBalls, effectiveCatchRate, statusMultOf, STATUS_OPTIONS,
} from '../lib/catchCalc.js';

const TIME_OPTS = [
  { key: 'day',   label: 'Day',   Icon: Sun  },
  { key: 'night', label: 'Night', Icon: Moon },
];

// Internal default form state. Each input below mirrors a field here.
const DEFAULTS = {
  monId: null,        // pokemon.id
  manualRate: '',     // string for the input; '' means "use auto"
  alpha: false,
  hp: 1,              // 1..100, default 1 (False Swipe scenario)
  falseSwipe: false,
  status: 'asleep',   // sensible default since False Swipe + Sleep is a common combo
  turn: 1,
  chain: 0,           // catching streak — Repeat Ball
  time: 'day',
  cave: false,
  water: false,
  level: '',          // optional, used by Nest Ball
};

export default function CatchCalc({ data, theme, onTheme }) {
  const [params, setParams] = useSearchParams();

  // Initialize state from URL params (one-shot on mount via useState init).
  const [form, setForm] = useState(() => readParams(params, data));

  // When form changes, mirror to URL (replace history so back nav stays sane).
  useEffect(() => {
    const next = writeParams(form, data);
    // Avoid pointless history churn — only update when something differs.
    let same = true;
    const cur = new URLSearchParams(params);
    if (cur.toString() !== next.toString()) same = false;
    if (!same) setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  // External URL changes (e.g. clicking "Catch Calc" from another tab while
  // this page is already mounted) need to push the new params into form
  // state. Read every render and reconcile when the URL doesn't match what
  // form would produce — that lets external links override but keeps local
  // edits stable.
  useEffect(() => {
    const next = readParams(params, data);
    setForm((f) => sameForm(f, next) ? f : next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const setField = useCallback((field, value) => {
    setForm((f) => {
      const next = { ...f, [field]: value };
      // False Swipe locks HP at 1.
      if (field === 'falseSwipe' && value) next.hp = 1;
      return next;
    });
  }, []);
  const reset = useCallback(() => setForm(DEFAULTS), []);

  const pokemon = useMemo(
    () => (form.monId != null ? data.pokemon.find((p) => p.id === form.monId) : null),
    [form.monId, data.pokemon]
  );

  const manualNum = form.manualRate === '' ? null : Number(form.manualRate);
  const rateInfo = useMemo(
    () => effectiveCatchRate(pokemon, { alpha: form.alpha, manual: manualNum }),
    [pokemon, form.alpha, form.manualRate]
  );

  const rows = useMemo(() => {
    if (!pokemon || !rateInfo.value) return [];
    // Master Ball is excluded — it's a special-occasion item that always
    // catches, so showing it would dominate the comparison and bury the
    // useful rows.
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
      weight: pokemon.weight || 0, // hectograms — c4vv thresholds expect this unit
      level: form.level === '' ? null : Number(form.level),
    }).filter((b) => b.key !== 'master');
  }, [pokemon, rateInfo.value, form.hp, form.status, form.turn, form.chain,
      form.time, form.cave, form.water, form.level]);

  const [sortKey, setSortKey] = useState('chance');
  const [sortDesc, setSortDesc] = useState(true);
  const onSort = useCallback((key) => {
    setSortKey((cur) => {
      if (cur === key) { setSortDesc((d) => !d); return cur; }
      // Default direction per column: chance desc, mult desc, name asc.
      setSortDesc(key === 'name' ? false : true);
      return key;
    });
  }, []);

  const sortedRows = useMemo(() => {
    const out = rows.slice();
    out.sort((a, b) => {
      const dir = sortDesc ? -1 : 1;
      if (sortKey === 'chance') return (a.chance - b.chance) * dir || a.name.localeCompare(b.name);
      if (sortKey === 'mult')   return (a.mult   - b.mult)   * dir || a.name.localeCompare(b.name);
      if (sortKey === 'name')   return a.name.localeCompare(b.name) * dir;
      return 0;
    });
    return out;
  }, [rows, sortKey, sortDesc]);

  const bestKey = useMemo(() => {
    if (rows.length === 0) return null;
    const sortedByChance = rows.slice().sort((a, b) => b.chance - a.chance);
    return sortedByChance[0].key;
  }, [rows]);

  return (
    <main className="max-w-7xl mx-auto px-4 py-4 space-y-4">
      <div className="grid lg:grid-cols-[360px_1fr] gap-4 items-start">
        {/* ─── Form (sticky on lg+) ─── */}
        <aside className="lg:sticky lg:top-4 self-start space-y-3">
          <FormCard title="Pokémon">
            <PokemonPicker
              pokemon={data.pokemon}
              value={form.monId}
              onChange={(id) => setField('monId', id)}
            />
            <RateRow rateInfo={rateInfo} form={form} setField={setField} />
            <CheckRow checked={form.alpha} onChange={(v) => setField('alpha', v)} label="Alpha (catch rate → 10)" />
          </FormCard>

          <FormCard title="Battle">
            <div className="space-y-1.5">
              <label className="text-xs text-stone-500 dark:text-stone-400">Target HP %</label>
              <div className="flex items-center gap-3">
                <input
                  type="range" min="1" max="100" value={form.hp}
                  disabled={form.falseSwipe}
                  onChange={(e) => setField('hp', Number(e.target.value))}
                  className="flex-1 accent-blue-500"
                />
                <input
                  type="number" min="1" max="100" value={form.hp}
                  disabled={form.falseSwipe}
                  onChange={(e) => {
                    const v = Math.max(1, Math.min(100, Number(e.target.value) || 1));
                    setField('hp', v);
                  }}
                  className="w-16 px-2 py-1 rounded-md border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-stone-900 dark:text-stone-100 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <CheckRow checked={form.falseSwipe} onChange={(v) => setField('falseSwipe', v)} label="False Swipe (locks HP at 1%)" />

            <div className="space-y-1.5">
              <label className="text-xs text-stone-500 dark:text-stone-400">Status</label>
              <div className="flex flex-wrap gap-1.5">
                {STATUS_OPTIONS.map((s) => (
                  <RadioChip key={s.key} active={form.status === s.key} onClick={() => setField('status', s.key)}>
                    {s.label} <span className="opacity-60 text-[10px] tabular-nums">×{s.mult}</span>
                  </RadioChip>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <NumRow label="Battle turn" value={form.turn} min={1} onChange={(v) => setField('turn', v)} />
              <NumRow label="Mon level (Nest)" value={form.level} min={1} max={100} placeholder="—" onChange={(v) => setField('level', v)} />
            </div>
          </FormCard>

          <FormCard title="Conditions">
            <NumRow label="Catching streak (Repeat Ball)" value={form.chain} min={0} max={99} onChange={(v) => setField('chain', v === '' ? 0 : v)} />
            <div>
              <label className="text-xs text-stone-500 dark:text-stone-400 mb-1 block">Time of day</label>
              <div className="inline-flex rounded-md border border-[#d6c8a3] dark:border-stone-700 overflow-hidden">
                {TIME_OPTS.map(({ key, label, Icon }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setField('time', key)}
                    aria-pressed={form.time === key}
                    className={`px-3 py-1 text-sm font-medium inline-flex items-center gap-1 ${
                      form.time === key
                        ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                        : 'bg-[#fdf8e9] dark:bg-stone-900 text-stone-600 dark:text-stone-400 hover:bg-[#ece2c4] dark:hover:bg-stone-800'
                    }`}
                  >
                    <Icon size={12} /> {label}
                  </button>
                ))}
              </div>
            </div>
            <CheckRow checked={form.cave} onChange={(v) => setField('cave', v)} label="In a cave (Dusk Ball)" />
            <CheckRow checked={form.water} onChange={(v) => setField('water', v)} label="In water — surfing or fishing (Dive Ball)" />
          </FormCard>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 hover:bg-[#ece2c4] dark:hover:bg-stone-800 text-sm text-stone-700 dark:text-stone-300"
            >
              <RotateCcw size={14} /> Reset
            </button>
            <button
              type="button"
              onClick={() => onTheme(theme === 'dark' ? 'light' : 'dark')}
              className="p-1.5 rounded-md border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 hover:bg-[#ece2c4] dark:hover:bg-stone-800 text-stone-700 dark:text-stone-300"
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </aside>

        {/* ─── Comparison table ─── */}
        <div className="min-w-0">
          {!pokemon ? (
            <EmptyPrompt />
          ) : (
            <BallTable
              rows={sortedRows}
              bestKey={bestKey}
              sortKey={sortKey}
              sortDesc={sortDesc}
              onSort={onSort}
            />
          )}
        </div>
      </div>
    </main>
  );
}

/* ─────────────── Sub-components ─────────────── */

function FormCard({ title, children }) {
  return (
    <section className="rounded-md border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900 p-3 space-y-3">
      <h3 className="text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">{title}</h3>
      {children}
    </section>
  );
}

function RateRow({ rateInfo, form, setField }) {
  const note = rateInfo.source === 'manual'   ? 'manual'
              : rateInfo.source === 'alpha'    ? 'Alpha override'
              : rateInfo.source === 'beldum'   ? 'Beldum-line override'
              : rateInfo.source === 'starter2' ? '2nd-stage starter override'
              : rateInfo.source === 'starter3' ? '3rd-stage starter override'
              : null;
  return (
    <div>
      <label className="text-xs text-stone-500 dark:text-stone-400 mb-1 block">Catch rate</label>
      <div className="flex items-stretch gap-2">
        <input
          type="number" min="1" max="255"
          value={form.manualRate !== '' ? form.manualRate : (rateInfo.value ?? '')}
          onChange={(e) => setField('manualRate', e.target.value)}
          placeholder={rateInfo.value ?? '—'}
          className="w-24 px-2 py-1.5 rounded-md border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-stone-900 dark:text-stone-100 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex-1 text-xs text-stone-500 dark:text-stone-400 self-center">
          {note && rateInfo.base != null && rateInfo.value !== rateInfo.base && (
            <>({note} — base <span className="font-mono tabular-nums">{rateInfo.base}</span>)</>
          )}
          {!note && rateInfo.value != null && <>0 hardest · 255 easiest</>}
        </div>
        {form.manualRate !== '' && (
          <button
            type="button"
            onClick={() => setField('manualRate', '')}
            className="text-xs text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 underline underline-offset-2"
          >
            Use auto
          </button>
        )}
      </div>
    </div>
  );
}

function CheckRow({ checked, onChange, label }) {
  return (
    <label className="flex items-center gap-2 text-sm text-stone-700 dark:text-stone-300 cursor-pointer">
      <input
        type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="accent-blue-500"
      />
      {label}
    </label>
  );
}

function NumRow({ label, value, min, max, placeholder, onChange }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-stone-500 dark:text-stone-400">{label}</label>
      <input
        type="number"
        min={min} max={max}
        value={value} placeholder={placeholder}
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

function RadioChip({ active, onClick, children }) {
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

function EmptyPrompt() {
  return (
    <div className="py-20 text-center">
      <Calculator size={36} className="mx-auto mb-3 text-stone-300 dark:text-stone-600" strokeWidth={1.5} />
      <p className="text-stone-600 dark:text-stone-400 text-sm">
        Pick a Pokémon to see per-throw catch chances for every ball.
      </p>
    </div>
  );
}

const BallTable = memo(function BallTable({ rows, bestKey, sortKey, sortDesc, onSort }) {
  return (
    <div className="rounded-md border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="text-xs text-stone-500 dark:text-stone-400 bg-[#f1e9d2] dark:bg-stone-800/40">
          <tr>
            <Th label="Ball"          col="name"   active={sortKey} desc={sortDesc} onSort={onSort} align="left" />
            <Th label="Catch rate ×"  col="mult"   active={sortKey} desc={sortDesc} onSort={onSort} align="right" />
            <Th label="Catch chance" col="chance" active={sortKey} desc={sortDesc} onSort={onSort} align="right" />
            <th className="px-3 py-2 text-left">Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <BallRow key={row.key} row={row} highlight={row.key === bestKey} />
          ))}
        </tbody>
      </table>
    </div>
  );
});

function Th({ label, col, active, desc, onSort, align }) {
  const isActive = active === col;
  const arrow = isActive ? (desc ? '▾' : '▴') : '';
  return (
    <th className={`px-3 py-2 cursor-pointer select-none ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        type="button"
        onClick={() => onSort(col)}
        className={`inline-flex items-center gap-1 ${isActive ? 'text-stone-900 dark:text-stone-100' : 'hover:text-stone-900 dark:hover:text-stone-100'}`}
      >
        {label} <span className="font-mono">{arrow}</span>
      </button>
    </th>
  );
}

function BallRow({ row, highlight }) {
  const pct = row.chance * 100;
  const color =
    pct >= 80 ? 'text-emerald-600 dark:text-emerald-400'
    : pct >= 40 ? 'text-yellow-600 dark:text-yellow-300'
    : pct >= 15 ? 'text-orange-600 dark:text-orange-400'
                : 'text-red-600 dark:text-red-400';
  return (
    <tr className={`border-t border-[#ece2c4] dark:border-stone-800/60 ${highlight ? 'bg-emerald-50/70 dark:bg-emerald-950/20 border-l-4 border-l-emerald-500' : ''}`}>
      <td className="px-3 py-2">
        <span className="font-semibold text-stone-900 dark:text-stone-100">{row.name}</span>
      </td>
      <td className="px-3 py-2 text-right font-mono tabular-nums text-stone-700 dark:text-stone-300">
        {row.guaranteed ? '—' : `${row.mult.toFixed(2)}×`}
      </td>
      <td className={`px-3 py-2 text-right font-mono tabular-nums font-bold text-base ${color}`}>
        {row.guaranteed ? '100%' : `${pct.toFixed(1)}%`}
      </td>
      <td className={`px-3 py-2 text-xs ${row.condMet ? 'text-stone-600 dark:text-stone-400' : 'text-stone-400 dark:text-stone-500 italic'}`}>
        {row.note || (row.condMet ? '' : 'Condition not met')}
      </td>
    </tr>
  );
}

/* ─────────────── URL ↔ form ─────────────── */

function sameForm(a, b) {
  const keys = Object.keys(DEFAULTS);
  for (const k of keys) if (a[k] !== b[k]) return false;
  return true;
}

function readParams(params, data) {
  const f = { ...DEFAULTS };
  const monName = params.get('mon');
  if (monName) {
    const p = data.pokemon.find((x) => x.name.toLowerCase() === monName.toLowerCase());
    if (p) f.monId = p.id;
  }
  const num = (k, lo, hi) => {
    const v = params.get(k);
    if (v == null) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return Math.max(lo, Math.min(hi, n));
  };
  const bool = (k) => params.get(k) === '1' || params.get(k) === 'true';
  const hp = num('hp', 1, 100);  if (hp != null) f.hp = hp;
  const turn = num('turn', 1, 99);  if (turn != null) f.turn = turn;
  const lvl = num('level', 1, 100); if (lvl != null) f.level = lvl;
  const status = params.get('status');
  if (status && STATUS_OPTIONS.some((s) => s.key === status)) f.status = status;
  const time = params.get('time');
  if (time === 'day' || time === 'night') f.time = time;
  if (params.has('alpha'))         f.alpha = bool('alpha');
  if (params.has('cave'))          f.cave = bool('cave');
  if (params.has('water'))         f.water = bool('water');
  if (params.has('falseSwipe'))    f.falseSwipe = bool('falseSwipe');
  const chain = num('chain', 0, 99); if (chain != null) f.chain = chain;
  const rate = params.get('rate');
  if (rate != null && rate !== '' && Number.isFinite(Number(rate))) f.manualRate = String(rate);
  return f;
}

function writeParams(form, data) {
  const sp = new URLSearchParams();
  if (form.monId != null) {
    const p = data.pokemon.find((x) => x.id === form.monId);
    if (p) sp.set('mon', p.name);
  }
  if (form.hp !== DEFAULTS.hp) sp.set('hp', String(form.hp));
  if (form.status !== DEFAULTS.status) sp.set('status', form.status);
  if (form.turn !== DEFAULTS.turn) sp.set('turn', String(form.turn));
  if (form.alpha)         sp.set('alpha', '1');
  if (form.cave)          sp.set('cave', '1');
  if (form.water)         sp.set('water', '1');
  if (form.falseSwipe)    sp.set('falseSwipe', '1');
  if (form.chain && form.chain !== DEFAULTS.chain) sp.set('chain', String(form.chain));
  if (form.time !== DEFAULTS.time) sp.set('time', form.time);
  if (form.level !== '' && form.level != null) sp.set('level', String(form.level));
  if (form.manualRate !== '') sp.set('rate', String(form.manualRate));
  return sp;
}
