import { useMemo, useState } from 'react';
import { Sun, Moon, ArrowLeftRight } from 'lucide-react';
import PokemonPicker from '../components/PokemonPicker.jsx';
import PokemonSprite from '../components/PokemonSprite.jsx';
import TypeBadge from '../components/TypeBadge.jsx';
import {
  damage, computedStats, STAT_KEYS, STAT_LABELS,
  ITEM_NAMES, ABILITY_NAMES, NATURE_NAMES, MOVE_NAMES, STATUSES, WEATHERS, TERRAINS,
} from '../lib/damage.js';

const EMPTY_MON = () => ({
  monId: null, level: 100, nature: 'Hardy', ability: '', item: '',
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  boosts: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  status: '', moves: ['', '', '', ''],
});

const EMPTY_FIELD = { weather: '', terrain: '', reflect: false, lightScreen: false, auroraVeil: false, gravity: false, helpingHand: false, crit: false };

export default function DamageCalc({ data, theme, onTheme }) {
  const byId = useMemo(() => new Map(data.pokemon.map((p) => [p.id, p])), [data.pokemon]);
  const [attacker, setAttacker] = useState(EMPTY_MON);
  const [defender, setDefender] = useState(EMPTY_MON);
  const [field, setField] = useState(EMPTY_FIELD);

  const atkPoke = attacker.monId != null ? byId.get(attacker.monId) : null;
  const defPoke = defender.monId != null ? byId.get(defender.monId) : null;

  // Engine specs (name-based) derived from the UI state.
  const atkSpec = useMemo(() => toSpec(attacker, atkPoke), [attacker, atkPoke]);
  const defSpec = useMemo(() => toSpec(defender, defPoke), [defender, defPoke]);

  const results = useMemo(() => {
    if (!atkSpec || !defSpec) return [];
    return attacker.moves.map((mv) => (mv ? damage(atkSpec, defSpec, mv, field, { crit: field.crit }) : null));
  }, [atkSpec, defSpec, attacker.moves, field]);

  const swap = () => {
    setAttacker((a) => ({ ...defender, moves: defender.moves || ['', '', '', ''] }));
    setDefender(() => ({ ...attacker }));
  };

  return (
    <main className="max-w-6xl mx-auto px-4 py-4">
      <header className="flex items-center gap-3 mb-3">
        <h1 className="text-xl font-bold text-stone-900 dark:text-stone-100">Damage Calc</h1>
        <span className="text-[10px] text-stone-400">PokéMMO mechanics</span>
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={swap} title="Swap attacker / defender"
            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 hover:bg-[#ece2c4] dark:hover:bg-stone-800 text-xs">
            <ArrowLeftRight size={13} /> Swap
          </button>
          <button type="button" onClick={() => onTheme(theme === 'dark' ? 'light' : 'dark')}
            className="p-1.5 rounded-md border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 hover:bg-[#ece2c4] dark:hover:bg-stone-800 text-stone-700 dark:text-stone-200" title="Toggle theme">
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        </div>
      </header>

      <div className="grid lg:grid-cols-2 gap-3">
        <MonPanel title="Attacker" mon={attacker} setMon={setAttacker} poke={atkPoke} data={data} byId={byId} withMoves results={results} />
        <MonPanel title="Defender" mon={defender} setMon={setDefender} poke={defPoke} data={data} byId={byId} />
      </div>

      <FieldPanel field={field} setField={setField} />

      <ResultsPanel results={results} moves={attacker.moves} atkName={atkPoke?.name} defName={defPoke?.name} />
    </main>
  );
}

/* ── derive engine spec from UI state ── */
function toSpec(mon, poke) {
  if (!poke) return null;
  return {
    name: poke.name,
    level: mon.level,
    nature: mon.nature || 'Hardy',
    ability: mon.ability || undefined,
    item: mon.item || undefined,
    evs: mon.evs,
    ivs: mon.ivs,
    boosts: mon.boosts,
    status: mon.status || '',
  };
}

/* ── learnset / ability options from pokemmo.json ── */
function learnsetNames(poke, data) {
  if (!poke?.moves) return [];
  const ids = new Set();
  for (const v of Object.values(poke.moves)) {
    if (!Array.isArray(v)) continue;
    for (const m of v) ids.add(typeof m === 'object' ? m.id : m);
  }
  const names = [...ids].map((id) => data.moves[id]?.name).filter(Boolean);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

/* ── Pokémon panel ── */
function MonPanel({ title, mon, setMon, poke, data, withMoves, results }) {
  const set = (patch) => setMon((m) => ({ ...m, ...patch }));
  const setStat = (group, k, v) => setMon((m) => ({ ...m, [group]: { ...m[group], [k]: v } }));
  const stats = useMemo(() => (poke ? computedStats(toSpec(mon, poke)) : null), [mon, poke]);
  const abilityOpts = poke?.abilities?.map((a) => a.name) || ABILITY_NAMES;
  const moveOpts = useMemo(() => (poke ? learnsetNames(poke, data) : MOVE_NAMES), [poke, data]);
  const evTotal = STAT_KEYS.reduce((s, k) => s + (Number(mon.evs[k]) || 0), 0);

  return (
    <section className="rounded-md border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <h2 className="text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">{title}</h2>
        {poke && <div className="flex gap-1">{[...new Set(poke.types)].map((t) => <TypeBadge key={t} type={t} />)}</div>}
      </div>

      <PokemonPicker pokemon={data.pokemon} value={mon.monId} onChange={(id) => set({ monId: id })} placeholder={`Pick ${title.toLowerCase()}`} />

      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-stone-500 dark:text-stone-400">Level
          <input type="number" min="1" max="100" value={mon.level}
            onChange={(e) => set({ level: clamp(e.target.value, 1, 100, 100) })}
            className={inputCls} />
        </label>
        <label className="text-xs text-stone-500 dark:text-stone-400">Nature
          <select value={mon.nature} onChange={(e) => set({ nature: e.target.value })} className={inputCls}>
            {NATURE_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <Combo label="Ability" value={mon.ability} onChange={(v) => set({ ability: v })} options={abilityOpts} listId={`${title}-abil`} />
        <Combo label="Item" value={mon.item} onChange={(v) => set({ item: v })} options={ITEM_NAMES} listId={`${title}-item`} />
        <label className="text-xs text-stone-500 dark:text-stone-400 col-span-2">Status
          <select value={mon.status} onChange={(e) => set({ status: e.target.value })} className={inputCls}>
            {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>

      {/* EV / IV / boost grid */}
      <div className="overflow-x-auto -mx-1 px-1">
        <table className="text-[11px] w-full">
          <thead className="text-stone-400">
            <tr><th className="text-left font-normal"></th>{STAT_KEYS.map((k) => <th key={k} className="px-0.5 font-normal">{STAT_LABELS[k]}</th>)}</tr>
          </thead>
          <tbody>
            <tr>
              <td className="text-stone-500 pr-1">Stat</td>
              {STAT_KEYS.map((k) => <td key={k} className="px-0.5 text-center tabular-nums font-semibold text-stone-700 dark:text-stone-300">{stats ? stats[k] : '—'}</td>)}
            </tr>
            <tr>
              <td className="text-stone-500 pr-1">EV</td>
              {STAT_KEYS.map((k) => <td key={k} className="px-0.5"><input type="number" min="0" max="252" step="4" value={mon.evs[k]} onChange={(e) => setStat('evs', k, clamp(e.target.value, 0, 252, 0))} className={miniCls} /></td>)}
            </tr>
            <tr>
              <td className="text-stone-500 pr-1">IV</td>
              {STAT_KEYS.map((k) => <td key={k} className="px-0.5"><input type="number" min="0" max="31" value={mon.ivs[k]} onChange={(e) => setStat('ivs', k, clamp(e.target.value, 0, 31, 31))} className={miniCls} /></td>)}
            </tr>
            <tr>
              <td className="text-stone-500 pr-1">Boost</td>
              {STAT_KEYS.map((k) => (
                <td key={k} className="px-0.5">
                  {k === 'hp' ? <div className="text-center text-stone-300">—</div> : (
                    <select value={mon.boosts[k]} onChange={(e) => setStat('boosts', k, Number(e.target.value))} className={miniSel}>
                      {[-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n > 0 ? `+${n}` : n}</option>)}
                    </select>
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <div className={`text-[10px] text-right ${evTotal > 510 ? 'text-red-500' : 'text-stone-400'}`}>EVs: {evTotal}/510</div>

      {withMoves && (
        <div className="space-y-1.5 pt-1">
          <div className="text-[10px] uppercase tracking-wider text-stone-400">Moves</div>
          {mon.moves.map((mv, i) => (
            <div key={i} className="flex items-center gap-2">
              <Combo value={mv} onChange={(v) => setMon((m) => ({ ...m, moves: m.moves.map((x, j) => (j === i ? v : x)) }))}
                options={moveOpts} listId={`atk-move-${i}`} className="flex-1" placeholder={`Move ${i + 1}`} />
              <MiniResult res={results?.[i]} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ── field ── */
function FieldPanel({ field, setField }) {
  const set = (patch) => setField((f) => ({ ...f, ...patch }));
  return (
    <section className="mt-3 rounded-md border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900 p-3">
      <h2 className="text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400 mb-2">Field</h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-stone-500 dark:text-stone-400">Weather
          <select value={field.weather} onChange={(e) => set({ weather: e.target.value })} className={inputCls}>
            {WEATHERS.map((w) => <option key={w} value={w}>{w || 'None'}</option>)}
          </select>
        </label>
        <label className="text-xs text-stone-500 dark:text-stone-400">Terrain
          <select value={field.terrain} onChange={(e) => set({ terrain: e.target.value })} className={inputCls}>
            {TERRAINS.map((t) => <option key={t} value={t}>{t ? `${t} Terrain` : 'None'}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap gap-2 text-xs text-stone-700 dark:text-stone-300">
          <Check label="Reflect" v={field.reflect} on={(v) => set({ reflect: v })} />
          <Check label="Light Screen" v={field.lightScreen} on={(v) => set({ lightScreen: v })} />
          <Check label="Aurora Veil" v={field.auroraVeil} on={(v) => set({ auroraVeil: v })} />
          <Check label="Helping Hand" v={field.helpingHand} on={(v) => set({ helpingHand: v })} />
          <Check label="Gravity" v={field.gravity} on={(v) => set({ gravity: v })} />
          <Check label="Critical hit" v={field.crit} on={(v) => set({ crit: v })} />
        </div>
      </div>
    </section>
  );
}

/* ── results ── */
function ResultsPanel({ results, moves, atkName, defName }) {
  const any = results.some(Boolean);
  return (
    <section className="mt-3 rounded-md border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900 p-3">
      <h2 className="text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400 mb-2">Results</h2>
      {!any ? (
        <div className="text-sm text-stone-400 dark:text-stone-500">Pick an attacker, a defender, and at least one move.</div>
      ) : (
        <ul className="space-y-2">
          {results.map((r, i) => r && (
            <li key={i} className="rounded border border-[#ece2c4] dark:border-stone-800/60 p-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-stone-900 dark:text-stone-100">{moves[i]}</span>
                {r.move?.type && <TypeBadge type={String(r.move.type).toLowerCase()} />}
                <span className="text-[10px] uppercase text-stone-400">{r.move?.category}{r.move?.bp ? ` · ${r.move.bp} BP` : ''}</span>
                {r.pct && <span className="ml-auto font-mono tabular-nums text-sm font-bold text-stone-900 dark:text-stone-100">{r.pct[0]}–{r.pct[1]}%</span>}
              </div>
              {r.ko?.text && <div className={`text-xs mt-0.5 ${koClass(r.ko)}`}>{r.ko.text}</div>}
              {r.desc && <div className="text-[11px] text-stone-500 dark:text-stone-400 mt-0.5">{r.desc}</div>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MiniResult({ res }) {
  if (!res || !res.pct) return <span className="w-16 text-right text-[10px] text-stone-300 dark:text-stone-600">—</span>;
  return <span className="w-16 text-right font-mono tabular-nums text-[11px] text-stone-700 dark:text-stone-300">{res.pct[0]}–{res.pct[1]}%</span>;
}

/* ── small controls ── */
const inputCls = 'mt-0.5 w-full px-2 py-1 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-stone-900 dark:text-stone-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const miniCls = 'w-full px-0.5 py-0.5 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-stone-900 dark:text-stone-100 text-[11px] tabular-nums text-center focus:outline-none focus:ring-1 focus:ring-blue-500';
const miniSel = 'w-full px-0.5 py-0.5 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-stone-900 dark:text-stone-100 text-[11px] text-center';

function Combo({ label, value, onChange, options, listId, className = '', placeholder }) {
  return (
    <label className={`text-xs text-stone-500 dark:text-stone-400 ${className}`}>
      {label}
      <input list={listId} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder || '—'} className={inputCls} />
      <datalist id={listId}>{options.map((o) => <option key={o} value={o} />)}</datalist>
    </label>
  );
}

function Check({ label, v, on }) {
  return (
    <label className="inline-flex items-center gap-1 cursor-pointer">
      <input type="checkbox" checked={v} onChange={(e) => on(e.target.checked)} className="accent-blue-500" /> {label}
    </label>
  );
}

function clamp(raw, lo, hi, def) {
  let n = Math.round(Number(raw));
  if (!Number.isFinite(n)) n = def;
  return Math.min(hi, Math.max(lo, n));
}
function koClass(ko) {
  if (ko.n === 0 || ko.chance === 0) return 'text-stone-500';
  if (ko.n === 1) return 'text-red-600 dark:text-red-400 font-semibold';
  if (ko.n === 2) return 'text-orange-600 dark:text-orange-400';
  return 'text-stone-600 dark:text-stone-300';
}
