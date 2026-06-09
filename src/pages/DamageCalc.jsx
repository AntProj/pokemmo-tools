import { useEffect, useMemo, useState } from 'react';
import { Sun, Moon, ArrowLeftRight } from 'lucide-react';
import PokemonPicker from '../components/PokemonPicker.jsx';
import TypeBadge from '../components/TypeBadge.jsx';
import {
  damage, buildField, computedStats, moveDefaults, speciesTypes,
  STAT_KEYS, STAT_LABELS, CATEGORIES,
  ITEM_NAMES, ABILITY_NAMES, NATURE_NAMES, MOVE_NAMES, TYPE_NAMES, STATUSES, WEATHERS, TERRAINS, GENDERS,
} from '../lib/damage.js';

const BASE_FROM = { hp: 'hp', atk: 'attack', def: 'defense', spa: 'sp_attack', spd: 'sp_defense', spe: 'speed' };
const EMPTY_MOVE = () => ({ name: '', bp: '', type: '', category: '', crit: false });
const EMPTY_MON = () => ({
  monId: null, types: ['', ''], gender: '', level: 100, nature: 'Hardy', ability: '', item: '', status: '',
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  boosts: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  curHPpct: 100,
  moves: [EMPTY_MOVE(), EMPTY_MOVE(), EMPTY_MOVE(), EMPTY_MOVE()],
});
const EMPTY_SIDE = { sr: false, spikes: 0, reflect: false, lightScreen: false, auroraVeil: false, protect: false, leechSeed: false, foresight: false, helpingHand: false, tailwind: false, friendGuard: false, flowerGift: false, switching: false };
const EMPTY_FIELD = { gameType: 'Singles', weather: '', terrain: '', magicRoom: false, wonderRoom: false, gravity: false, side1: { ...EMPTY_SIDE }, side2: { ...EMPTY_SIDE } };

export default function DamageCalc({ data, theme, onTheme }) {
  const byId = useMemo(() => new Map(data.pokemon.map((p) => [p.id, p])), [data.pokemon]);
  const [mon1, setMon1] = useState(EMPTY_MON);
  const [mon2, setMon2] = useState(EMPTY_MON);
  const [field, setField] = useState(EMPTY_FIELD);
  const [selected, setSelected] = useState({ side: 1, index: 0 });

  const poke1 = mon1.monId != null ? byId.get(mon1.monId) : null;
  const poke2 = mon2.monId != null ? byId.get(mon2.monId) : null;

  const stats1 = useMemo(() => (poke1 ? computedStats(statSpec(mon1, poke1)) : null), [mon1, poke1]);
  const stats2 = useMemo(() => (poke2 ? computedStats(statSpec(mon2, poke2)) : null), [mon2, poke2]);
  const spec1 = useMemo(() => fullSpec(mon1, poke1, stats1), [mon1, poke1, stats1]);
  const spec2 = useMemo(() => fullSpec(mon2, poke2, stats2), [mon2, poke2, stats2]);

  const { res1, res2 } = useMemo(() => {
    if (!spec1 || !spec2) return { res1: [null, null, null, null], res2: [null, null, null, null] };
    const f12 = buildField(field, field.side1, field.side2);
    const f21 = buildField(field, field.side2, field.side1);
    return {
      res1: mon1.moves.map((mv) => (mv.name ? damage(spec1, spec2, mv, f12) : null)),
      res2: mon2.moves.map((mv) => (mv.name ? damage(spec2, spec1, mv, f21) : null)),
    };
  }, [spec1, spec2, mon1.moves, mon2.moves, field]);

  const detail = (selected.side === 1 ? res1 : res2)[selected.index];

  const swap = () => { setMon1(mon2); setMon2(mon1); setField((f) => ({ ...f, side1: f.side2, side2: f.side1 })); };

  return (
    <main className="max-w-7xl mx-auto px-4 py-4">
      <header className="flex items-center gap-3 mb-3">
        <h1 className="text-xl font-bold text-stone-900 dark:text-stone-100">Damage Calc</h1>
        <span className="text-[10px] text-stone-400">PokéMMO mechanics</span>
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={swap} title="Swap sides"
            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 hover:bg-[#ece2c4] dark:hover:bg-stone-800 text-xs">
            <ArrowLeftRight size={13} /> Swap
          </button>
          <button type="button" onClick={() => onTheme(theme === 'dark' ? 'light' : 'dark')}
            className="p-1.5 rounded-md border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 hover:bg-[#ece2c4] dark:hover:bg-stone-800 text-stone-700 dark:text-stone-200" title="Toggle theme">
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        </div>
      </header>

      {/* Top results */}
      <div className="grid sm:grid-cols-2 gap-3 mb-3">
        <MoveSummary title={poke1 ? `${poke1.name}'s moves` : "Attacker's moves"} moves={mon1.moves} results={res1} side={1} selected={selected} onSelect={setSelected} />
        <MoveSummary title={poke2 ? `${poke2.name}'s moves` : "Defender's moves"} moves={mon2.moves} results={res2} side={2} selected={selected} onSelect={setSelected} />
      </div>
      <DetailResult detail={detail} />

      {/* Panels */}
      <div className="mt-3 grid lg:grid-cols-[1fr_minmax(220px,300px)_1fr] gap-3 items-start">
        <MonPanel title="Pokémon 1" mon={mon1} setMon={setMon1} poke={poke1} stats={stats1} data={data} side="atk" />
        <FieldPanel field={field} setField={setField} setMon1={setMon1} setMon2={setMon2} name1={poke1?.name} name2={poke2?.name} />
        <MonPanel title="Pokémon 2" mon={mon2} setMon={setMon2} poke={poke2} stats={stats2} data={data} side="def" />
      </div>
    </main>
  );
}

/* ── spec derivation ── */
function statSpec(mon, poke) {
  return {
    name: poke.name, types: mon.types, gender: mon.gender, level: mon.level, nature: mon.nature,
    ability: mon.ability, item: mon.item, status: mon.status, evs: mon.evs, ivs: mon.ivs, boosts: mon.boosts,
  };
}
function fullSpec(mon, poke, stats) {
  if (!poke) return null;
  const maxHP = stats?.hp || 0;
  return { ...statSpec(mon, poke), curHP: Math.round(maxHP * (clamp(mon.curHPpct, 0, 100, 100) / 100)) };
}

/* ── learnset names ── */
function learnsetNames(poke, data) {
  if (!poke?.moves) return MOVE_NAMES;
  const ids = new Set();
  for (const v of Object.values(poke.moves)) if (Array.isArray(v)) for (const m of v) ids.add(typeof m === 'object' ? m.id : m);
  const out = [...ids].map((id) => data.moves[id]?.name).filter(Boolean);
  return out.length ? [...new Set(out)].sort((a, b) => a.localeCompare(b)) : MOVE_NAMES;
}

/* ── top: per-side move summary ── */
function MoveSummary({ title, moves, results, side, selected, onSelect }) {
  return (
    <div className="rounded-md border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900 p-2">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400 mb-1">{title}</div>
      <div className="space-y-0.5">
        {moves.map((mv, i) => {
          const r = results[i];
          const active = selected.side === side && selected.index === i;
          return (
            <button key={i} type="button" disabled={!mv.name} onClick={() => onSelect({ side, index: i })}
              className={`w-full flex items-center gap-2 px-2 py-1 rounded text-sm text-left transition-colors ${active ? 'bg-blue-100 dark:bg-blue-950/50 ring-1 ring-blue-400' : 'hover:bg-[#ece2c4] dark:hover:bg-stone-800'} ${!mv.name ? 'opacity-40' : ''}`}>
              <span className="flex-1 min-w-0 truncate text-stone-800 dark:text-stone-200">{mv.name || `Move ${i + 1}`}</span>
              <span className="font-mono tabular-nums text-xs text-stone-700 dark:text-stone-300">
                {r?.pct ? `${r.pct[0]}–${r.pct[1]}%` : '—'}
                {r?.recoil && <span className="text-amber-600 dark:text-amber-400"> ({r.recoil})</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DetailResult({ detail }) {
  if (!detail) return <div className="rounded-md border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900 p-2 text-sm text-stone-400 dark:text-stone-500">Pick both Pokémon and a move to see detailed results.</div>;
  return (
    <div className="rounded-md border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900 p-2.5">
      <div className="text-sm text-stone-800 dark:text-stone-200">{detail.desc || 'No damage.'}</div>
      {detail.ko?.text && <div className="text-xs font-semibold mt-0.5 text-stone-600 dark:text-stone-300">{detail.ko.text}</div>}
      {detail.rolls && detail.rolls.length > 1 && (
        <div className="text-[11px] text-stone-500 dark:text-stone-400 mt-1">Possible damage: ({detail.rolls.join(', ')})</div>
      )}
    </div>
  );
}

/* ── Pokémon panel ── */
function MonPanel({ title, mon, setMon, poke, stats, data }) {
  const set = (patch) => setMon((m) => ({ ...m, ...patch }));
  const setStat = (group, k, v) => setMon((m) => ({ ...m, [group]: { ...m[group], [k]: v } }));
  const setMove = (i, patch) => setMon((m) => ({ ...m, moves: m.moves.map((mv, j) => (j === i ? { ...mv, ...patch } : mv)) }));
  const abilityOpts = poke?.abilities?.map((a) => a.name) || ABILITY_NAMES;
  const moveOpts = useMemo(() => learnsetNames(poke, data), [poke, data]);
  const evTotal = STAT_KEYS.reduce((s, k) => s + (Number(mon.evs[k]) || 0), 0);

  // On species pick, seed the editable types from the species' engine typing.
  useEffect(() => {
    if (!poke) return;
    const t = speciesTypes(poke.name);
    set({ types: [t[0] || '', t[1] || ''] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mon.monId]);

  const pickMove = (i, name) => {
    const d = name ? moveDefaults(name) : null;
    setMove(i, d ? { name, bp: d.bp, type: d.type, category: d.category } : { name, bp: '', type: '', category: '' });
  };

  return (
    <section className="rounded-md border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900 p-3 space-y-2 min-w-0">
      <h2 className="text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">{title}</h2>
      <PokemonPicker pokemon={data.pokemon} value={mon.monId} onChange={(id) => set({ monId: id })} placeholder={`Pick ${title}`} />

      <div className="grid grid-cols-2 gap-2">
        <Sel label="Type 1" value={mon.types[0]} onChange={(v) => set({ types: [v, mon.types[1]] })} options={['', ...TYPE_NAMES]} />
        <Sel label="Type 2" value={mon.types[1]} onChange={(v) => set({ types: [mon.types[0], v] })} options={['', ...TYPE_NAMES]} />
        <Sel label="Gender" value={mon.gender} onChange={(v) => set({ gender: v })} options={GENDERS} render={(g) => (g === 'M' ? '♂ Male' : g === 'F' ? '♀ Female' : 'Genderless')} />
        <label className="text-xs text-stone-500 dark:text-stone-400">Level
          <input type="number" min="1" max="100" value={mon.level} onChange={(e) => set({ level: clamp(e.target.value, 1, 100, 100) })} className={inputCls} />
        </label>
        <Sel label="Nature" value={mon.nature} onChange={(v) => set({ nature: v })} options={NATURE_NAMES} className="col-span-1" />
        <Combo label="Ability" value={mon.ability} onChange={(v) => set({ ability: v })} options={abilityOpts} listId={`${title}-abil`} />
        <Combo label="Item" value={mon.item} onChange={(v) => set({ item: v })} options={ITEM_NAMES} listId={`${title}-item`} />
        <Sel label="Status" value={mon.status} onChange={(v) => set({ status: v })} options={STATUSES.map(([v]) => v)} render={(v) => (STATUSES.find(([x]) => x === v) || ['', 'Healthy'])[1]} />
      </div>

      {/* stat grid */}
      <div className="overflow-x-auto -mx-1 px-1">
        <table className="text-[11px] w-full">
          <thead className="text-stone-400"><tr><th></th><th className="font-normal">Base</th><th className="font-normal">IV</th><th className="font-normal">EV</th><th className="font-normal">Stat</th><th className="font-normal">Boost</th></tr></thead>
          <tbody>
            {STAT_KEYS.map((k) => (
              <tr key={k}>
                <td className="text-stone-500 pr-1 font-semibold">{STAT_LABELS[k]}</td>
                <td className="text-center tabular-nums text-stone-400">{poke ? poke.stats[BASE_FROM[k]] : '—'}</td>
                <td><input type="number" min="0" max="31" value={mon.ivs[k]} onChange={(e) => setStat('ivs', k, clamp(e.target.value, 0, 31, 31))} className={miniCls} /></td>
                <td><input type="number" min="0" max="252" step="4" value={mon.evs[k]} onChange={(e) => setStat('evs', k, clamp(e.target.value, 0, 252, 0))} className={miniCls} /></td>
                <td className="text-center tabular-nums font-semibold text-stone-700 dark:text-stone-300">{stats ? stats[k] : '—'}</td>
                <td>{k === 'hp' ? <div className="text-center text-stone-300">—</div> : (
                  <select value={mon.boosts[k]} onChange={(e) => setStat('boosts', k, Number(e.target.value))} className={miniSel}>
                    {[-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n > 0 ? `+${n}` : n}</option>)}
                  </select>
                )}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={`text-[10px] text-right ${evTotal > 510 ? 'text-red-500' : 'text-stone-400'}`}>EVs: {evTotal}/510</div>

      {/* current HP */}
      <div className="flex items-center gap-2">
        <label className="text-[11px] text-stone-500 dark:text-stone-400">Current HP
          <input type="number" min="0" max="100" value={mon.curHPpct} onChange={(e) => set({ curHPpct: clamp(e.target.value, 0, 100, 100) })} className="ml-1 w-14 px-1 py-0.5 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-xs tabular-nums text-right" />%
        </label>
        <div className="flex-1 h-2 rounded-full bg-stone-200 dark:bg-stone-800 overflow-hidden">
          <div className={`h-full ${mon.curHPpct > 50 ? 'bg-emerald-500' : mon.curHPpct > 20 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${clamp(mon.curHPpct, 0, 100, 100)}%` }} />
        </div>
      </div>

      {/* moves */}
      <div className="space-y-1 pt-1">
        <div className="text-[10px] uppercase tracking-wider text-stone-400">Moves</div>
        {mon.moves.map((mv, i) => (
          <div key={i} className="flex items-center gap-1">
            <input list={`${title}-mv-${i}`} value={mv.name} onChange={(e) => pickMove(i, e.target.value)} placeholder={`Move ${i + 1}`}
              className="flex-1 min-w-0 px-1.5 py-1 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-stone-900 dark:text-stone-100 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
            <datalist id={`${title}-mv-${i}`}>{moveOpts.map((o) => <option key={o} value={o} />)}</datalist>
            <input type="number" value={mv.bp} onChange={(e) => setMove(i, { bp: e.target.value })} title="Base power" className="w-12 px-1 py-1 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-xs tabular-nums text-center" />
            <select value={mv.type} onChange={(e) => setMove(i, { type: e.target.value })} title="Type" className="w-16 px-0.5 py-1 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-[10px]">
              <option value=""></option>{TYPE_NAMES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={mv.category} onChange={(e) => setMove(i, { category: e.target.value })} title="Category" className="w-12 px-0.5 py-1 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-[10px]">
              <option value=""></option>{CATEGORIES.map((c) => <option key={c} value={c}>{c[0]}</option>)}
            </select>
            <button type="button" onClick={() => setMove(i, { crit: !mv.crit })} title="Critical hit"
              className={`px-1.5 py-1 rounded border text-[10px] ${mv.crit ? 'bg-red-500 text-white border-red-600' : 'border-[#d6c8a3] dark:border-stone-700 text-stone-500'}`}>Crit</button>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── field ── */
function FieldPanel({ field, setField, setMon1, setMon2, name1, name2 }) {
  const set = (patch) => setField((f) => ({ ...f, ...patch }));
  const setSide = (key, patch) => setField((f) => ({ ...f, [key]: { ...f[key], ...patch } }));
  const setLevel = (lvl) => { setMon1((m) => ({ ...m, level: lvl })); setMon2((m) => ({ ...m, level: lvl })); };
  return (
    <section className="rounded-md border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900 p-3 space-y-2">
      <h2 className="text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400 text-center">Field</h2>

      <Seg value={field.gameType} onChange={(v) => set({ gameType: v })} options={[['Singles', 'Singles'], ['Doubles', 'Doubles']]} />
      <div className="flex gap-1 justify-center text-[10px]">
        {[100, 50, 5].map((l) => <button key={l} type="button" onClick={() => setLevel(l)} className="px-2 py-0.5 rounded border border-[#d6c8a3] dark:border-stone-700 hover:bg-[#ece2c4] dark:hover:bg-stone-800 text-stone-600 dark:text-stone-300">Lv {l}</button>)}
      </div>

      <Sel label="Weather" value={field.weather} onChange={(v) => set({ weather: v })} options={WEATHERS} render={(w) => w || 'None'} />
      <Sel label="Terrain" value={field.terrain} onChange={(v) => set({ terrain: v })} options={TERRAINS} render={(t) => (t ? `${t} Terrain` : 'None')} />
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-stone-700 dark:text-stone-300 justify-center">
        <Check label="Gravity" v={field.gravity} on={(v) => set({ gravity: v })} />
        <Check label="Magic Room" v={field.magicRoom} on={(v) => set({ magicRoom: v })} />
        <Check label="Wonder Room" v={field.wonderRoom} on={(v) => set({ wonderRoom: v })} />
      </div>

      <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[#ece2c4] dark:border-stone-800/60">
        <SidePanel title={name1 || 'P1'} side={field.side1} onChange={(p) => setSide('side1', p)} />
        <SidePanel title={name2 || 'P2'} side={field.side2} onChange={(p) => setSide('side2', p)} />
      </div>
    </section>
  );
}

function SidePanel({ title, side, onChange }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wider text-stone-400 truncate">{title}'s side</div>
      <label className="flex items-center justify-between text-[11px] text-stone-600 dark:text-stone-300">Spikes
        <select value={side.spikes} onChange={(e) => onChange({ spikes: Number(e.target.value) })} className="px-1 py-0.5 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-[11px]">
          {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      {[['sr', 'Stealth Rock'], ['reflect', 'Reflect'], ['lightScreen', 'Light Screen'], ['auroraVeil', 'Aurora Veil'], ['protect', 'Protect'], ['leechSeed', 'Leech Seed'], ['helpingHand', 'Helping Hand'], ['tailwind', 'Tailwind'], ['friendGuard', 'Friend Guard'], ['flowerGift', 'Flower Gift'], ['foresight', 'Foresight'], ['switching', 'Switching Out']].map(([k, lbl]) => (
        <Check key={k} label={lbl} v={side[k]} on={(v) => onChange({ [k]: v })} small />
      ))}
    </div>
  );
}

/* ── small controls ── */
const inputCls = 'mt-0.5 w-full px-2 py-1 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-stone-900 dark:text-stone-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const miniCls = 'w-full px-0.5 py-0.5 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-stone-900 dark:text-stone-100 text-[11px] tabular-nums text-center focus:outline-none focus:ring-1 focus:ring-blue-500';
const miniSel = 'w-full px-0.5 py-0.5 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-stone-900 dark:text-stone-100 text-[11px] text-center';

function Sel({ label, value, onChange, options, render, className = '' }) {
  return (
    <label className={`text-xs text-stone-500 dark:text-stone-400 ${className}`}>{label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
        {options.map((o) => <option key={o} value={o}>{render ? render(o) : (o || '—')}</option>)}
      </select>
    </label>
  );
}
function Combo({ label, value, onChange, options, listId }) {
  return (
    <label className="text-xs text-stone-500 dark:text-stone-400">{label}
      <input list={listId} value={value} onChange={(e) => onChange(e.target.value)} placeholder="—" className={inputCls} />
      <datalist id={listId}>{options.map((o) => <option key={o} value={o} />)}</datalist>
    </label>
  );
}
function Seg({ value, onChange, options }) {
  return (
    <div className="inline-flex w-full rounded-md border border-[#d6c8a3] dark:border-stone-700 overflow-hidden text-xs">
      {options.map(([v, l]) => <button key={v} type="button" onClick={() => onChange(v)} className={`flex-1 px-2 py-1 ${value === v ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900' : 'text-stone-600 dark:text-stone-400 hover:bg-[#ece2c4] dark:hover:bg-stone-800'}`}>{l}</button>)}
    </div>
  );
}
function Check({ label, v, on, small }) {
  return (
    <label className={`inline-flex items-center gap-1 cursor-pointer ${small ? 'text-[11px] text-stone-600 dark:text-stone-300 w-full' : ''}`}>
      <input type="checkbox" checked={!!v} onChange={(e) => on(e.target.checked)} className="accent-blue-500" /> {label}
    </label>
  );
}
function clamp(raw, lo, hi, def) {
  let n = Math.round(Number(raw));
  if (!Number.isFinite(n)) n = def;
  return Math.min(hi, Math.max(lo, n));
}
