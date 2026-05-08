import { useEffect, useMemo, useState } from 'react';
import { X, Sparkles, ChevronRight, Calculator } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import TypeBadge from './TypeBadge.jsx';
import RarityBadge from './RarityBadge.jsx';
import { typeColor } from '../lib/types.js';
import {
  dexNum, formatHeight, formatWeight, formatGenderRatio, genderSplit,
  formatGrowthRate, formatHatchCounter, formatCatchRate,
  formatEvolutionMethod, damageClassIcon, damageClassLabel,
  STAT_ORDER, statLabel, statTotal, statBarPct, statBarColor,
} from '../lib/format.js';

const MOVE_TABS = [
  { key: 'level',  label: 'Level' },
  { key: 'tm',     label: 'TM' },
  { key: 'tutor',  label: 'Tutor' },
  { key: 'egg',    label: 'Egg' },
];

export default function PokemonModal({ pokemon, data, onClose, onSelect }) {
  const [shiny, setShiny] = useState(false);
  const [moveTab, setMoveTab] = useState('level');
  const [expandedMove, setExpandedMove] = useState(null);

  // Reset state every time a different Pokémon is selected.
  useEffect(() => {
    setShiny(false);
    setMoveTab('level');
    setExpandedMove(null);
  }, [pokemon?.id]);

  // Escape key dismissal + body scroll lock.
  useEffect(() => {
    if (!pokemon) return;
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [pokemon, onClose]);

  if (!pokemon) return null;

  const total = statTotal(pokemon.stats);
  const sprite = shiny && pokemon.sprite_shiny ? pokemon.sprite_shiny : pokemon.sprite;

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/70"
      onClick={onClose}
    >
      {/* min-h-full + flex centers vertically only when content fits, otherwise scrolls from the top */}
      <div className="min-h-full flex items-start sm:items-center justify-center p-3 sm:p-6">
        <div
          className="w-full max-w-3xl bg-[#fdf8e9] dark:bg-stone-900
                     rounded-lg shadow-2xl border border-[#e6dabf] dark:border-stone-800
                     relative"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label={`${pokemon.name} details`}
        >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-md
                     bg-[#fdf8e9]/80 dark:bg-stone-800/80 hover:bg-[#ece2c4] dark:hover:bg-stone-700
                     text-stone-700 dark:text-stone-200 z-10"
          title="Close (Esc)"
        >
          <X size={18} />
        </button>

        <Header pokemon={pokemon} sprite={sprite} shiny={shiny} setShiny={setShiny} onClose={onClose} />

        <div className="p-5 sm:p-6 space-y-6 border-t border-[#e6dabf] dark:border-stone-800">
          <Stats stats={pokemon.stats} total={total} />
          <Profile pokemon={pokemon} />
          <Abilities abilities={pokemon.abilities} catalog={data.abilities} />
          <Evolutions pokemon={pokemon} data={data} onSelect={onSelect} />

          <Moves
            pokemon={pokemon}
            data={data}
            tab={moveTab}
            setTab={setMoveTab}
            expandedMove={expandedMove}
            setExpandedMove={setExpandedMove}
          />

          <HeldItems items={pokemon.held_items} catalog={data.items} />
          <Locations locations={pokemon.locations} />
        </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────── Header ─────────────── */

function Header({ pokemon, sprite, shiny, setShiny, onClose }) {
  const navigate = useNavigate();
  const goCatchCalc = () => {
    onClose?.();
    navigate(`/catch?mon=${encodeURIComponent(pokemon.name)}`);
  };
  const primary = typeColor(pokemon.types[0]);
  return (
    <div
      className="p-5 sm:p-6 rounded-t-lg"
      style={{
        background: `linear-gradient(135deg, ${primary.bg}33, ${primary.bg}11)`,
      }}
    >
      <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
        <div className="flex items-center justify-center sm:justify-start">
          <div className="w-32 h-32 sm:w-40 sm:h-40 flex items-center justify-center
                          bg-[#fdf8e9]/60 dark:bg-stone-950/50 rounded-lg ring-1 ring-black/5 dark:ring-white/5">
            <img
              src={sprite}
              alt={pokemon.name}
              decoding="async"
              fetchpriority="high"
              className="pixelated w-28 h-28 sm:w-36 sm:h-36 object-contain"
            />
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-mono text-stone-500 dark:text-stone-400 text-sm">
              {dexNum(pokemon.id)}
            </span>
            <h2 className="text-2xl sm:text-3xl font-bold text-stone-900 dark:text-stone-100">
              {pokemon.name}
            </h2>
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {[...new Set(pokemon.types)].map((t) => <TypeBadge key={t} type={t} size="lg" />)}
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {pokemon.is_legendary && (
              <SpecialTag color="bg-amber-500">Legendary</SpecialTag>
            )}
            {pokemon.is_mythical && (
              <SpecialTag color="bg-pink-500">Mythical</SpecialTag>
            )}
            {pokemon.is_baby && (
              <SpecialTag color="bg-sky-400 text-stone-900">Baby</SpecialTag>
            )}
            {pokemon.pvp_tier && (
              <SpecialTag color="bg-stone-700">PVP {pokemon.pvp_tier}</SpecialTag>
            )}
            {pokemon.shiny_tier && (
              <SpecialTag color="bg-yellow-400 text-stone-900">
                Shiny tier {pokemon.shiny_tier}
              </SpecialTag>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {pokemon.sprite_shiny && (
              <button
                type="button"
                onClick={() => setShiny(!shiny)}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium border transition-colors ${
                  shiny
                    ? 'bg-yellow-400 text-stone-900 border-yellow-500'
                    : 'bg-[#fdf8e9] dark:bg-stone-800 text-stone-700 dark:text-stone-200 border-[#d6c8a3] dark:border-stone-700 hover:bg-[#ece2c4] dark:hover:bg-stone-700'
                }`}
              >
                <Sparkles size={14} />
                {shiny ? 'Shiny' : 'Show shiny'}
              </button>
            )}
            <button
              type="button"
              onClick={goCatchCalc}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium border transition-colors
                         bg-[#fdf8e9] dark:bg-stone-800 text-stone-700 dark:text-stone-200
                         border-[#d6c8a3] dark:border-stone-700
                         hover:bg-[#ece2c4] dark:hover:bg-stone-700"
              title="Open in Catch Calc"
            >
              <Calculator size={14} /> Catch Calc
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SpecialTag({ color, children }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide text-white ${color}`}>
      {children}
    </span>
  );
}

/* ─────────────── Stats ─────────────── */

function Stats({ stats, total }) {
  return (
    <Section title="Base Stats" right={<span className="text-xs text-stone-500 dark:text-stone-400">Total <strong className="text-stone-900 dark:text-stone-100">{total}</strong></span>}>
      <div className="space-y-1.5">
        {STAT_ORDER.map((k) => {
          const v = stats[k] || 0;
          return (
            <div key={k} className="grid grid-cols-[44px_44px_1fr] items-center gap-3">
              <span className="text-xs font-semibold text-stone-500 dark:text-stone-400 uppercase">
                {statLabel(k)}
              </span>
              <span className="font-mono text-sm tabular-nums text-stone-900 dark:text-stone-100 text-right">
                {v}
              </span>
              <div className="h-2.5 bg-[#e0d4b5] dark:bg-stone-800 rounded-full overflow-hidden">
                <div
                  className="stat-bar-fill h-full rounded-full"
                  style={{
                    width: `${statBarPct(v)}%`,
                    backgroundColor: statBarColor(v),
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/* ─────────────── Profile ─────────────── */

function Profile({ pokemon }) {
  const split = genderSplit(pokemon.gender_ratio);
  return (
    <Section title="Profile">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-sm">
        <Field label="Height" value={formatHeight(pokemon.height)} />
        <Field label="Weight" value={formatWeight(pokemon.weight)} />
        <Field label="Catch Rate" value={formatCatchRate(pokemon.catch_rate)} />
        <Field label="Growth Rate" value={formatGrowthRate(pokemon.growth_rate || pokemon.exp_type)} />
        <Field label="Hatch Counter" value={formatHatchCounter(pokemon.hatch_counter)} />
        <Field
          label="Egg Groups"
          value={pokemon.egg_groups?.length
            ? pokemon.egg_groups.map((g) => g.charAt(0).toUpperCase() + g.slice(1)).join(', ')
            : '—'}
        />
        <div className="col-span-2 sm:col-span-3">
          <div className="text-xs text-stone-500 dark:text-stone-400 mb-1">Gender</div>
          <div className="text-sm text-stone-900 dark:text-stone-100">
            {formatGenderRatio(pokemon.gender_ratio)}
          </div>
          {split && (
            <div className="mt-1 h-2 rounded-full overflow-hidden flex bg-stone-200 dark:bg-stone-800">
              <div className="bg-blue-400" style={{ width: `${split.male}%` }} />
              <div className="bg-pink-400" style={{ width: `${split.female}%` }} />
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <div className="text-xs text-stone-500 dark:text-stone-400">{label}</div>
      <div className="text-stone-900 dark:text-stone-100">{value}</div>
    </div>
  );
}

/* ─────────────── Abilities ─────────────── */

function Abilities({ abilities, catalog }) {
  if (!abilities?.length) return null;
  return (
    <Section title="Abilities">
      <div className="space-y-2">
        {abilities.map((a, idx) => {
          const detail = catalog[a.id];
          return (
            <div key={`${a.id}-${idx}`} className="p-3 rounded border border-[#e6dabf] dark:border-stone-800 bg-[#f1e9d2] dark:bg-stone-950/40">
              <div className="font-semibold text-stone-900 dark:text-stone-100">{a.name}</div>
              {detail?.effect && (
                <div className="mt-1 text-sm text-stone-600 dark:text-stone-400 italic">
                  {detail.effect}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/* ─────────────── Evolutions ─────────────── */

function Evolutions({ pokemon, data, onSelect }) {
  // Walk UP the pre_evolution chain to find the family's root, then build the
  // forward tree from there. This way every stage of an evolution family
  // (including the final stage with no forward evolutions) renders the full
  // tree with the active mon highlighted.
  const tree = useMemo(() => {
    const root = chainRoot(pokemon, data);
    return buildEvolutionTree(root, data);
  }, [pokemon, data]);

  // No forward evolutions AND no pre-evolution → truly a singleton (Tauros, etc.).
  const isSingleton =
    (!pokemon.evolutions || pokemon.evolutions.length === 0) &&
    !pokemon.pre_evolution;
  if (isSingleton || !tree) {
    return (
      <Section title="Evolutions">
        <div className="text-sm text-stone-500 dark:text-stone-400">Does not evolve.</div>
      </Section>
    );
  }

  return (
    <Section title="Evolutions">
      <EvolutionNode node={tree} currentId={pokemon.id} onSelect={onSelect} />
    </Section>
  );
}

// Walk pre_evolution pointers up to the chain's root (e.g., Venusaur → Ivysaur
// → Bulbasaur). Defensive against missing data and self-referential cycles.
function chainRoot(pokemon, data) {
  let cur = pokemon;
  const seen = new Set();
  while (cur?.pre_evolution && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent = data.pokemon.find((p) => p.id === cur.pre_evolution.id);
    if (!parent) break;
    cur = parent;
  }
  return cur;
}

function buildEvolutionTree(pokemon, data, visited = new Set()) {
  if (!pokemon || visited.has(pokemon.id)) return null;
  visited.add(pokemon.id);
  const children = (pokemon.evolutions || []).map((evo) => {
    const next = data.pokemon.find((p) => p.id === evo.id);
    if (!next) return { pokemon: { id: evo.id, name: evo.name, sprite: null, types: [] }, method: evo, children: [] };
    const subtree = buildEvolutionTree(next, data, visited);
    return { pokemon: next, method: evo, children: subtree?.children || [] };
  });
  return { pokemon, method: null, children };
}

function EvolutionNode({ node, currentId, onSelect }) {
  return (
    <div className="flex flex-wrap items-stretch gap-2">
      <EvolutionStage poke={node.pokemon} isCurrent={node.pokemon.id === currentId} onSelect={onSelect} />
      {node.children.length > 0 && (
        <div className="flex flex-col gap-3 justify-center">
          {node.children.map((child, idx) => (
            <div key={`${child.pokemon.id}-${idx}`} className="flex items-center gap-2">
              <div className="flex flex-col items-center text-[10px] text-stone-500 dark:text-stone-400 min-w-[60px]">
                <ChevronRight size={16} />
                <span className="text-center leading-tight">{formatEvolutionMethod(child.method)}</span>
              </div>
              <EvolutionNode node={child} currentId={currentId} onSelect={onSelect} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EvolutionStage({ poke, isCurrent, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => poke.sprite && !isCurrent && onSelect(poke.id)}
      disabled={isCurrent || !poke.sprite}
      className={`flex flex-col items-center p-2 rounded border min-w-[88px] ${
        isCurrent
          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40'
          : 'border-[#e6dabf] dark:border-stone-800 bg-[#f1e9d2] dark:bg-stone-950/40 hover:border-[#c4b486] dark:hover:border-stone-600'
      }`}
    >
      {poke.sprite
        ? <img src={poke.sprite} alt={poke.name} decoding="async" loading="lazy" className="pixelated w-16 h-16 object-contain" />
        : <div className="w-16 h-16 flex items-center justify-center text-stone-400 text-xs">?</div>}
      <div className="font-mono text-[10px] text-stone-500 dark:text-stone-500">{dexNum(poke.id)}</div>
      <div className="text-xs font-semibold text-stone-900 dark:text-stone-100">{poke.name}</div>
    </button>
  );
}

/* ─────────────── Moves ─────────────── */

// The data file's typed buckets (tm/tutor/egg) are mostly empty; real entries
// live in `other` tagged by `learn_method`. Re-bucket here for the tabs.
const TAB_LEARN_METHODS = {
  level: ['level'],
  tm:    ['move_learner_tools'],
  tutor: ['move_tutor', 'special_moves'],
  egg:   ['egg_moves', 'special_egg'],
};

function bucketMoves(pokemon, tabKey) {
  const wanted = new Set(TAB_LEARN_METHODS[tabKey]);
  const out = [];
  // Pull from any bucket — same learn_method should land in the same tab regardless
  // of where the pipeline placed it.
  for (const bucketKey of Object.keys(pokemon.moves || {})) {
    for (const entry of (pokemon.moves[bucketKey] || [])) {
      if (wanted.has(entry.learn_method)) out.push(entry);
    }
  }
  return out;
}

function Moves({ pokemon, data, tab, setTab, expandedMove, setExpandedMove }) {
  const counts = useMemo(() => ({
    level: bucketMoves(pokemon, 'level').length,
    tm:    bucketMoves(pokemon, 'tm').length,
    tutor: bucketMoves(pokemon, 'tutor').length,
    egg:   bucketMoves(pokemon, 'egg').length,
  }), [pokemon]);

  const moveList = useMemo(() => {
    const raw = bucketMoves(pokemon, tab);
    // Dedupe by move id, keeping the lowest level for level-up.
    const seen = new Map();
    for (const entry of raw) {
      const cur = seen.get(entry.id);
      if (!cur || (entry.level != null && entry.level < (cur.level ?? Infinity))) {
        seen.set(entry.id, entry);
      }
    }
    const list = [...seen.values()];
    if (tab === 'level') list.sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
    else list.sort((a, b) => {
      const an = data.moves[a.id]?.name || ''; const bn = data.moves[b.id]?.name || '';
      return an.localeCompare(bn);
    });
    return list;
  }, [pokemon, tab, data.moves]);

  return (
    <Section title="Moves">
      <div className="flex gap-1 mb-3 border-b border-[#e6dabf] dark:border-stone-800">
        {MOVE_TABS.map((t) => {
          const count = counts[t.key] ?? 0;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => { setTab(t.key); setExpandedMove(null); }}
              className={`px-3 py-1.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100'
              }`}
            >
              {t.label} <span className="text-xs text-stone-400">({count})</span>
            </button>
          );
        })}
      </div>

      {moveList.length === 0 ? (
        <div className="text-sm text-stone-500 dark:text-stone-400">No moves in this category.</div>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-stone-500 dark:text-stone-400 text-left">
                {tab === 'level' && <th className="px-2 py-1 w-10">Lv</th>}
                <th className="px-2 py-1">Move</th>
                <th className="px-2 py-1">Type</th>
                <th className="px-2 py-1 text-center" title="Category">Cat</th>
                <th className="px-2 py-1 text-right">Pwr</th>
                <th className="px-2 py-1 text-right">Acc</th>
                <th className="px-2 py-1 text-right">PP</th>
              </tr>
            </thead>
            <tbody>
              {moveList.map((entry, idx) => {
                const m = data.moves[entry.id];
                if (!m) return null;
                const isExpanded = expandedMove === `${tab}-${entry.id}-${idx}`;
                const key = `${tab}-${entry.id}-${idx}`;
                return (
                  <tr
                    key={key}
                    onClick={() => setExpandedMove(isExpanded ? null : key)}
                    className="border-t border-[#ece2c4] dark:border-stone-800/60
                               hover:bg-[#f1e9d2] dark:hover:bg-stone-800/40 cursor-pointer"
                  >
                    {tab === 'level' && (
                      <td className="px-2 py-1.5 font-mono text-xs tabular-nums text-stone-700 dark:text-stone-300">
                        {entry.level ?? '—'}
                      </td>
                    )}
                    <td className="px-2 py-1.5 font-medium text-stone-900 dark:text-stone-100">
                      {m.name}
                      {isExpanded && m.effect && (
                        <div className="mt-1 text-xs text-stone-600 dark:text-stone-400 italic font-normal whitespace-normal">
                          {m.effect}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1.5"><TypeBadge type={m.type} /></td>
                    <td className="px-2 py-1.5 text-center" title={damageClassLabel(m.damage_class)}>
                      <span className="text-base">{damageClassIcon(m.damage_class)}</span>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-stone-700 dark:text-stone-300">{m.power ?? '—'}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-stone-700 dark:text-stone-300">{m.accuracy ?? '—'}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-stone-700 dark:text-stone-300">{m.pp ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[11px] text-stone-400 dark:text-stone-500">
        Click a row to see effect description.
      </p>
    </Section>
  );
}

/* ─────────────── Held Items ─────────────── */

function HeldItems({ items, catalog }) {
  if (!items?.length) return null;
  return (
    <Section title="Wild Held Items">
      <div className="space-y-2">
        {items.map((entry, idx) => {
          // Names live directly on the entry; the catalog uses a different id
          // space and rarely resolves, so it's a fallback only.
          const name = entry.name || catalog[entry.id]?.name;
          if (!name) return null;
          const description = catalog[entry.id]?.description;
          return (
            <div key={`${entry.id}-${idx}`} className="p-3 rounded border border-[#e6dabf] dark:border-stone-800 bg-[#f1e9d2] dark:bg-stone-950/40">
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <div className="font-semibold text-stone-900 dark:text-stone-100">{name}</div>
                <div className="text-xs text-stone-500 dark:text-stone-400">
                  {entry.chance != null ? `${entry.chance}% chance` : 'chance unknown'}
                </div>
              </div>
              {description && (
                <div className="mt-1 text-sm text-stone-600 dark:text-stone-400 whitespace-pre-line">
                  {String(description).replace(/\\n/g, '\n')}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/* ─────────────── Locations ─────────────── */

function Locations({ locations }) {
  const grouped = useMemo(() => groupLocations(locations || []), [locations]);
  if (!locations?.length) {
    return (
      <Section title="Encounter Locations">
        <div className="text-sm text-stone-500 dark:text-stone-400">No wild encounters in PokéMMO data.</div>
      </Section>
    );
  }

  return (
    <Section title="Encounter Locations">
      <div className="space-y-3">
        {grouped.map(([region, locs]) => (
          <div key={region}>
            <div className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400 mb-1">
              {region}
            </div>
            <div className="space-y-1">
              {locs.map((loc, idx) => (
                <div
                  key={`${loc.location}-${idx}`}
                  className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-1 sm:gap-3 items-center
                             px-3 py-2 rounded border border-[#e6dabf] dark:border-stone-800
                             bg-[#f1e9d2] dark:bg-stone-950/40"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-stone-900 dark:text-stone-100 truncate">{loc.location}</div>
                    <div className="text-xs text-stone-500 dark:text-stone-400">
                      {loc.method}
                      <span className="mx-1.5">·</span>
                      Lv {loc.min_level === loc.max_level ? loc.min_level : `${loc.min_level}–${loc.max_level}`}
                      {loc.time && loc.time !== 'ALL' && (
                        <>
                          <span className="mx-1.5">·</span>
                          <span className="capitalize">{String(loc.time).toLowerCase()}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex justify-start sm:justify-end">
                    <RarityBadge rarity={loc.rarity} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function groupLocations(locations) {
  const map = new Map();
  for (const loc of locations) {
    if (!map.has(loc.region)) map.set(loc.region, new Map());
    const byLoc = map.get(loc.region);
    const key = `${loc.location}|${loc.method}|${loc.min_level}|${loc.max_level}|${loc.rarity}|${loc.time}`;
    if (!byLoc.has(key)) byLoc.set(key, loc);
  }
  // Region order from data.meta when possible — but here we just sort alphabetically with a known order pin.
  const regionOrder = ['Kanto', 'Johto', 'Hoenn', 'Sinnoh', 'Unova'];
  const regions = [...map.keys()].sort((a, b) => {
    const ai = regionOrder.indexOf(a); const bi = regionOrder.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  return regions.map((r) => [r, [...map.get(r).values()]]);
}

/* ─────────────── Section helper ─────────────── */

function Section({ title, right, children }) {
  return (
    <section>
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-sm font-bold uppercase tracking-wider text-stone-700 dark:text-stone-300">
          {title}
        </h3>
        {right}
      </div>
      {children}
    </section>
  );
}
