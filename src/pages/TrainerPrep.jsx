import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sun, Moon, Swords, ChevronRight } from 'lucide-react';
import Modal from '../components/Modal.jsx';
import TypeBadge from '../components/TypeBadge.jsx';
import { typeColor } from '../lib/types.js';
import { TYPES, effectiveness } from '../lib/teamAnalysis.js';
import { allMons } from '../lib/box.js';

// Gym & E4 Prep — browse every gym leader / Elite Four / champion (from
// public/data/trainers.json), see their team variants, what types beat them,
// what they threaten you with, suggested counters from your Box, and hand any
// mon to the Damage Calc as the opponent.

const TRAINERS_URL = `${import.meta.env.BASE_URL}data/trainers.json`;
const REGIONS = ['All', 'kanto', 'johto', 'hoenn', 'sinnoh', 'unova'];
const KINDS = [
  { id: 'All', label: 'All' },
  { id: 'gym', label: 'Gym Leaders' },
  { id: 'e4', label: 'Elite Four' },
  { id: 'champion', label: 'Champions' },
];
const KIND_BADGE = {
  gym: { label: 'Gym', cls: 'bg-amber-200 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200' },
  e4: { label: 'Elite Four', cls: 'bg-violet-200 text-violet-900 dark:bg-violet-900/50 dark:text-violet-200' },
  champion: { label: 'Champion', cls: 'bg-rose-200 text-rose-900 dark:bg-rose-900/50 dark:text-rose-200' },
};
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const dedupeTypes = (arr) => [...new Set((arr || []).map((t) => String(t).toLowerCase()))];

export default function TrainerPrep({ data, boxStore, theme, onTheme }) {
  const navigate = useNavigate();
  const byId = useMemo(() => new Map(data.pokemon.map((p) => [p.id, p])), [data.pokemon]);
  const [trainers, setTrainers] = useState(null);
  const [error, setError] = useState(null);
  const [region, setRegion] = useState('All');
  const [kind, setKind] = useState('All');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(TRAINERS_URL)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((j) => { if (!cancelled) setTrainers(j.trainers || []); })
      .catch((e) => { if (!cancelled) setError(e.message || String(e)); });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!trainers) return [];
    const q = search.trim().toLowerCase();
    return trainers.filter((t) =>
      (region === 'All' || t.region === region) &&
      (kind === 'All' || t.kind === kind) &&
      (!q || t.name.toLowerCase().includes(q) || (t.location || '').toLowerCase().includes(q)));
  }, [trainers, region, kind, search]);

  const open = openId ? filtered.find((t) => t.id === openId) || trainers?.find((t) => t.id === openId) : null;

  return (
    <main className="max-w-7xl mx-auto px-4 py-4">
      <header className="flex items-center gap-3 mb-3">
        <h1 className="text-xl font-bold text-stone-900 dark:text-stone-100">Gym &amp; E4 Prep</h1>
        <span className="text-[10px] text-stone-400">trainer teams · PokéMMO</span>
        <button type="button" onClick={() => onTheme(theme === 'dark' ? 'light' : 'dark')}
          className="ml-auto p-1.5 rounded-md border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 hover:bg-[#ece2c4] dark:hover:bg-stone-800 text-stone-700 dark:text-stone-200" title="Toggle theme">
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </header>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Pills options={REGIONS.map((r) => ({ id: r, label: r === 'All' ? 'All' : cap(r) }))} value={region} onChange={setRegion} />
        <span className="w-px h-5 bg-[#d6c8a3] dark:bg-stone-700 mx-1" />
        <Pills options={KINDS} value={kind} onChange={setKind} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search trainer / city…"
          className="ml-auto px-3 py-1.5 rounded-md border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-sm text-stone-800 dark:text-stone-100 placeholder:text-stone-400 w-48" />
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">Couldn’t load trainer data: {error}</p>}
      {!trainers && !error && <p className="text-sm text-stone-500 dark:text-stone-400 animate-pulse">Loading trainers…</p>}

      {trainers && (
        <>
          <p className="text-xs text-stone-500 dark:text-stone-500 mb-2">{filtered.length} trainer{filtered.length === 1 ? '' : 's'}</p>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((t) => <TrainerCard key={t.id} t={t} byId={byId} onClick={() => setOpenId(t.id)} />)}
          </div>
          {!filtered.length && <p className="text-sm text-stone-500 dark:text-stone-400 py-8 text-center">No trainers match these filters.</p>}
        </>
      )}

      {open && (
        <TrainerDetail trainer={open} data={data} byId={byId} boxStore={boxStore} onClose={() => setOpenId(null)} navigate={navigate} />
      )}
    </main>
  );
}

function Pills({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button key={o.id} type="button" onClick={() => onChange(o.id)}
          className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
            value === o.id
              ? 'bg-amber-600 border-amber-600 text-white'
              : 'border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-stone-700 dark:text-stone-300 hover:bg-[#ece2c4] dark:hover:bg-stone-800'
          }`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function TrainerCard({ t, byId, onClick }) {
  const badge = KIND_BADGE[t.kind] || KIND_BADGE.gym;
  const team = t.variants[0]?.team || [];
  return (
    <button type="button" onClick={onClick}
      className="text-left p-3 rounded-lg border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900 hover:border-amber-500 dark:hover:border-amber-600 hover:shadow-sm transition-all">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="font-bold text-stone-900 dark:text-stone-100">{t.name}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${badge.cls}`}>{badge.label}</span>
        <ChevronRight size={15} className="ml-auto text-stone-400" />
      </div>
      <div className="text-xs text-stone-500 dark:text-stone-400 mb-2">
        {t.location || cap(t.region)} · {cap(t.region)} · {t.variants.length} team{t.variants.length === 1 ? '' : 's'}
      </div>
      <div className="flex flex-wrap gap-0.5">
        {team.map((m, i) => {
          const p = m.speciesId != null ? byId.get(m.speciesId) : null;
          return p ? <img key={i} src={p.sprite} alt={m.species} title={`${m.species} Lv${m.level}`} className="w-8 h-8 object-contain" loading="lazy" />
            : <span key={i} className="w-8 h-8 grid place-items-center text-[8px] text-stone-400">{m.species}</span>;
        })}
      </div>
    </button>
  );
}

/* ── detail modal ── */
function TrainerDetail({ trainer, data, byId, boxStore, onClose, navigate }) {
  const [vi, setVi] = useState(0);
  const variant = trainer.variants[Math.min(vi, trainer.variants.length - 1)];
  const team = variant.team;
  const badge = KIND_BADGE[trainer.kind] || KIND_BADGE.gym;

  // Ranking: which attacking type hits the most of their mons super-effectively.
  const offense = useMemo(() => {
    const teamTypes = team.map((m) => dedupeTypes(m.types)).filter((a) => a.length);
    return TYPES.map((type) => {
      let se = 0, immune = 0;
      for (const tt of teamTypes) { const e = effectiveness(type, tt); if (e > 1) se++; else if (e === 0) immune++; }
      return { type, se, immune };
    }).filter((r) => r.se > 0).sort((a, b) => b.se - a.se || a.immune - b.immune).slice(0, 6);
  }, [team]);

  // What they threaten you with: the damaging move-types across the team.
  const threats = useMemo(() => {
    const set = new Set();
    for (const m of team) for (const id of m.moveIds || []) {
      const mv = id != null ? data.moves[id] : null;
      if (mv && mv.type && (mv.power ?? mv.damage_class !== 'status')) set.add(String(mv.type).toLowerCase());
    }
    return [...set];
  }, [team, data.moves]);

  // Box counters: your mons whose STAB types hit the most of their team SE.
  const boxCounters = useMemo(() => {
    const mons = allMons(boxStore || {});
    if (!mons.length) return [];
    const teamTypes = team.map((m) => dedupeTypes(m.types)).filter((a) => a.length);
    const seen = new Set();
    const scored = [];
    for (const bm of mons) {
      const p = bm.monId != null ? byId.get(bm.monId) : null;
      if (!p || seen.has(p.id)) continue;
      seen.add(p.id);
      const myTypes = dedupeTypes(p.types);
      let hits = 0;
      for (const tt of teamTypes) { const best = Math.max(...myTypes.map((mt) => effectiveness(mt, tt))); if (best > 1) hits++; }
      // How exposed I am: their move-types that are SE on me.
      let exposed = 0;
      for (const th of threats) if (effectiveness(th, myTypes) > 1) exposed++;
      if (hits > 0) scored.push({ p, hits, exposed });
    }
    return scored.sort((a, b) => b.hits - a.hits || a.exposed - b.exposed).slice(0, 6);
  }, [boxStore, team, threats, byId]);

  function sendToCalc(m) {
    const set = { slot: 2, monId: m.speciesId, level: m.level ?? 50, item: m.item || '', ability: m.ability || '', moves: m.moves || [] };
    try { sessionStorage.setItem('pokemmo:calc:prefill', JSON.stringify(set)); } catch { /* ignore */ }
    navigate('/damage');
  }

  const header = (
    <div className="p-4 border-b border-[#e6dabf] dark:border-stone-800">
      <div className="flex items-center gap-2 flex-wrap pr-8">
        <h2 className="text-lg font-bold text-stone-900 dark:text-stone-100">{trainer.name}</h2>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${badge.cls}`}>{badge.label}</span>
        <span className="text-xs text-stone-500 dark:text-stone-400">{trainer.location || cap(trainer.region)} · {cap(trainer.region)}</span>
      </div>
      {trainer.variants.length > 1 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {trainer.variants.map((v, i) => (
            <button key={i} type="button" onClick={() => setVi(i)}
              className={`px-2 py-0.5 rounded text-xs border ${i === vi ? 'bg-amber-600 border-amber-600 text-white' : 'border-[#d6c8a3] dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-[#ece2c4] dark:hover:bg-stone-800'}`}>
              {v.label}
            </button>
          ))}
        </div>
      )}
      {variant.description && <p className="text-xs text-stone-500 dark:text-stone-400 mt-1.5">{variant.description}</p>}
    </div>
  );

  return (
    <Modal header={header} onClose={onClose} maxWidth="max-w-3xl" scroll="page">
      <div className="p-4 space-y-4">
        {/* Prep summary */}
        <div className="grid sm:grid-cols-2 gap-3">
          <Panel title="Hit them with" hint="types super-effective vs the most team members">
            {offense.length ? (
              <div className="flex flex-wrap gap-1.5">
                {offense.map((o) => (
                  <span key={o.type} className="inline-flex items-center gap-1">
                    <TypeBadge type={o.type} />
                    <span className="text-xs text-stone-500 dark:text-stone-400">×{o.se}</span>
                  </span>
                ))}
              </div>
            ) : <p className="text-xs text-stone-500">No clear type advantage.</p>}
          </Panel>
          <Panel title="They threaten" hint="damaging move-types on this team">
            {threats.length ? (
              <div className="flex flex-wrap gap-1">{threats.map((t) => <TypeBadge key={t} type={t} />)}</div>
            ) : <p className="text-xs text-stone-500">No moves recorded.</p>}
          </Panel>
        </div>

        {/* Box counters */}
        {boxCounters.length > 0 && (
          <Panel title="Counters from your Box" hint="your mons whose STAB hits the most of their team">
            <div className="flex flex-wrap gap-2">
              {boxCounters.map(({ p, hits, exposed }) => (
                <div key={p.id} className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-[#e6dabf] dark:border-stone-800 bg-[#fbf5e4] dark:bg-stone-950/40">
                  <img src={p.sprite} alt={p.name} className="w-8 h-8 object-contain" />
                  <div className="leading-tight">
                    <div className="text-xs font-medium text-stone-800 dark:text-stone-100">{p.name}</div>
                    <div className="text-[10px] text-stone-500 dark:text-stone-400">hits {hits} · weak to {exposed}</div>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {/* Team */}
        <div>
          <div className="text-xs font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wide mb-2">Team ({team.length})</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {team.map((m, i) => <MonCard key={i} mon={m} byId={byId} data={data} onSendToCalc={() => sendToCalc(m)} />)}
          </div>
        </div>

        {(trainer.region === 'sinnoh' || trainer.region === 'unova') && trainer.kind === 'gym' && (
          <p className="text-[11px] text-stone-400 dark:text-stone-500">
            Note: {cap(trainer.region)} Elite Four teams aren’t in the data source yet — gym leaders are complete.
          </p>
        )}
      </div>
    </Modal>
  );
}

function Panel({ title, hint, children }) {
  return (
    <div className="rounded-lg border border-[#e6dabf] dark:border-stone-800 bg-[#fbf5e4] dark:bg-stone-950/40 p-3">
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="text-xs font-semibold text-stone-700 dark:text-stone-200 uppercase tracking-wide">{title}</span>
        {hint && <span className="text-[10px] text-stone-400 dark:text-stone-500">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function MonCard({ mon, byId, data, onSendToCalc }) {
  const p = mon.speciesId != null ? byId.get(mon.speciesId) : null;
  const types = dedupeTypes(p ? p.types : mon.types);
  return (
    <div className="rounded-lg border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900 p-2.5">
      <div className="flex items-center gap-2">
        {p ? <img src={p.sprite} alt={mon.species} className="w-12 h-12 object-contain" />
          : <div className="w-12 h-12 grid place-items-center text-[9px] text-stone-400 text-center">{mon.species}</div>}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-sm text-stone-900 dark:text-stone-100 truncate">{mon.species}</span>
            <span className="text-xs text-stone-500 dark:text-stone-400">Lv{mon.level ?? '?'}</span>
          </div>
          <div className="flex gap-1 mt-0.5">{types.map((t) => <TypeBadge key={t} type={t} />)}</div>
          {mon.item && <div className="text-[11px] text-stone-500 dark:text-stone-400 mt-0.5 truncate">@ {mon.item}</div>}
        </div>
        <button type="button" onClick={onSendToCalc} title="Open in Damage Calc as the opponent"
          className="self-start p-1.5 rounded-md border border-[#d6c8a3] dark:border-stone-700 hover:bg-[#ece2c4] dark:hover:bg-stone-800 text-stone-600 dark:text-stone-300">
          <Swords size={13} />
        </button>
      </div>
      {mon.moves?.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {mon.moves.map((mv, i) => {
            const id = (mon.moveIds || [])[i];
            const t = id != null && data.moves[id]?.type ? String(data.moves[id].type).toLowerCase() : null;
            const c = t ? typeColor(t) : null;
            return (
              <span key={i} className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                style={c ? { backgroundColor: c.bg, color: c.fg } : undefined}>
                {mv}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
