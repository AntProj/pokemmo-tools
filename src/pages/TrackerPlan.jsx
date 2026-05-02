import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Star, Check, X } from 'lucide-react';
import TypeBadge from '../components/TypeBadge.jsx';
import RarityBadge from '../components/RarityBadge.jsx';
import { typeColor } from '../lib/types.js';
import { dexNum } from '../lib/format.js';
import { methodIcon, parseLocation, regionRank } from '../lib/locations.js';
import { stateOf, scorePoints, cycleClick, trackerRarityRank, METHOD_OPTIONS } from '../lib/tracker.js';

const REGIONS = ['All', 'Kanto', 'Johto', 'Hoenn', 'Sinnoh', 'Unova'];

export default function TrackerPlan({
  data, pokemonById,
  trackerState, setMonState,
  view, updateView,
  openPanel,
}) {
  const { planRegion, planMethods, hideSingles } = view;
  // Track the open modal by key so it stays bound to the *current* state of
  // the location (eligible mons / score update live as you click in the modal).
  const [openKey, setOpenKey] = useState(null);

  // ─────── Build per-location plan data ───────
  // For each (region, baseLocation) compute the best uncaught/priority entry
  // for each unique mon there. Group by base location name (lowercased) so
  // time/season variants collapse into one card — same as the Locations tab.
  const locationPlan = useMemo(() => {
    const groups = new Map(); // `${region}::${baseLower}` → entry
    for (const [key, monRefs] of Object.entries(data.locations)) {
      const [region, rawName] = key.split('::');
      const { base } = parseLocation(rawName);
      const groupKey = `${region}::${base.toLowerCase()}`;
      let g = groups.get(groupKey);
      if (!g) {
        g = { region, name: base, monMap: new Map(), methodSet: new Set(), _nameUpper: isAllUpper(base) };
        groups.set(groupKey, g);
      } else if (g._nameUpper && !isAllUpper(base)) {
        // Prefer the mixed-case variant for the display name.
        g.name = base; g._nameUpper = false;
      }
      for (const ref of monRefs) {
        g.methodSet.add(ref.method);
        const fullPokemon = pokemonById.get(ref.id);
        if (!fullPokemon) continue;
        // Find this mon's best entry at this base location across all variants.
        const entriesHere = (fullPokemon.locations || []).filter(
          (l) => l.region === region && parseLocation(l.location).base.toLowerCase() === base.toLowerCase()
        );
        if (entriesHere.length === 0) continue;
        // Highest "weight" = best (data is sorted easiest-first).
        let best = entriesHere[0];
        for (const e of entriesHere) if ((e.weight ?? 0) > (best.weight ?? 0)) best = e;
        const existing = g.monMap.get(ref.id);
        if (!existing || (best.weight ?? 0) > (existing.bestEntry.weight ?? 0)) {
          g.monMap.set(ref.id, { pokemon: fullPokemon, bestEntry: best });
        }
      }
    }
    return [...groups.values()].map(({ _nameUpper, monMap, methodSet, ...rest }) => ({
      ...rest, monEntries: [...monMap.values()], methods: [...methodSet],
    }));
  }, [data.locations, pokemonById]);

  // Apply state + filters and compute scores. Keeping this separate from the
  // index so changing tracker state doesn't rebuild the index.
  const ranked = useMemo(() => {
    const out = [];
    for (const loc of locationPlan) {
      if (planRegion !== 'All' && loc.region !== planRegion) continue;
      const methodAllowed = planMethods.length === 0
        ? null
        : new Set(planMethods);

      let score = 0;
      const eligible = [];
      for (const me of loc.monEntries) {
        const state = stateOf(trackerState, me.pokemon.id);
        if (state === 'caught' || state === 'skipped') continue;
        if (methodAllowed && !methodAllowed.has(me.bestEntry.method)) continue;
        score += scorePoints(me.bestEntry.rarity, state);
        eligible.push({ ...me, state });
      }
      if (eligible.length === 0) continue;
      if (hideSingles && eligible.length < 2) continue;
      // Order mons by tracker-specific rarity rank (Horde after Very Rare,
      // Lure last) with dex-id as tiebreaker.
      eligible.sort((a, b) =>
        trackerRarityRank(a.bestEntry.rarity) - trackerRarityRank(b.bestEntry.rarity)
        || a.pokemon.id - b.pokemon.id
      );
      out.push({
        region: loc.region,
        name: loc.name,
        methods: loc.methods,
        eligible,
        score,
      });
    }
    out.sort((a, b) => b.score - a.score
      || b.eligible.length - a.eligible.length
      || a.name.localeCompare(b.name, undefined, { numeric: true }));
    return out;
  }, [locationPlan, trackerState, planRegion, planMethods, hideSingles]);

  // ─────── Filter row handlers ───────
  const setRegion = useCallback((r) => updateView({ planRegion: r }), [updateView]);
  const toggleMethod = useCallback((m) => {
    updateView({ planMethods: planMethods.includes(m) ? planMethods.filter((x) => x !== m) : [...planMethods, m] });
  }, [planMethods, updateView]);
  const toggleHideSingles = useCallback(() => updateView({ hideSingles: !hideSingles }), [hideSingles, updateView]);
  const resetFilters = useCallback(() => updateView({ planRegion: 'All', planMethods: [], hideSingles: true }), [updateView]);

  return (
    <main className="max-w-7xl mx-auto px-4 py-4 space-y-4">
      {/* Filter row */}
      <section className="rounded-md border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900 p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-stone-500 dark:text-stone-400 mr-1">Region</span>
          {REGIONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRegion(r)}
              aria-pressed={planRegion === r}
              className={`px-2.5 py-1 rounded-md text-sm border transition-colors ${
                planRegion === r
                  ? 'bg-stone-900 text-white border-stone-900 dark:bg-stone-100 dark:text-stone-900 dark:border-stone-100'
                  : 'bg-[#fdf8e9] text-stone-700 border-[#d6c8a3] hover:bg-[#ece2c4] dark:bg-stone-900 dark:text-stone-300 dark:border-stone-700 dark:hover:bg-stone-800'
              }`}
            >
              {r}
            </button>
          ))}
        </div>

        <div className="flex items-start gap-2 flex-wrap">
          <span className="text-xs text-stone-500 dark:text-stone-400 mr-1 mt-1">Method</span>
          <div className="flex flex-wrap gap-1.5">
            {METHOD_OPTIONS.map((m) => {
              const sel = planMethods.includes(m);
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => toggleMethod(m)}
                  aria-pressed={sel}
                  className={`px-2 py-0.5 rounded text-xs border transition-colors inline-flex items-center gap-1 ${
                    sel
                      ? 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-900'
                      : 'bg-[#fdf8e9] dark:bg-stone-900 text-stone-700 dark:text-stone-300 border-[#d6c8a3] dark:border-stone-700 hover:bg-[#ece2c4] dark:hover:bg-stone-800'
                  }`}
                >
                  <span aria-hidden>{methodIcon(m)}</span>{m}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap text-xs">
          <label className="inline-flex items-center gap-1.5 text-stone-700 dark:text-stone-300 cursor-pointer">
            <input
              type="checkbox"
              checked={hideSingles}
              onChange={toggleHideSingles}
              className="accent-blue-500"
            />
            Hide single-mon locations
          </label>
          <button
            type="button"
            onClick={resetFilters}
            className="text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 underline underline-offset-2"
          >
            Reset filters
          </button>
          <span className="ml-auto text-stone-500 dark:text-stone-400 tabular-nums">
            {ranked.length} location{ranked.length === 1 ? '' : 's'}
          </span>
        </div>
      </section>

      {/* Location cards */}
      {ranked.length === 0 ? (
        <div className="py-16 text-center text-stone-500 dark:text-stone-400 text-sm">
          No locations have catchable mons under your current filters.
        </div>
      ) : (
        <div className="space-y-2">
          {ranked.map((loc) => (
            <PlanLocationCard
              key={`${loc.region}::${loc.name}`}
              loc={loc}
              onOpen={setOpenKey}
            />
          ))}
        </div>
      )}

      {openKey && (() => {
        const loc = ranked.find((l) => `${l.region}::${l.name}` === openKey);
        if (!loc) { setOpenKey(null); return null; }
        return (
          <PlanLocationModal
            loc={loc}
            trackerState={trackerState}
            setMonState={setMonState}
            openPanel={openPanel}
            onClose={() => setOpenKey(null)}
          />
        );
      })()}
    </main>
  );
}

function isAllUpper(s) { return s.length > 0 && s === s.toUpperCase() && s !== s.toLowerCase(); }

/* ─────────────── Plan location card ─────────────── */

// A summary card. Clicking it opens the modal that lists the location's
// catchable mons. We pass `loc` for display and a stable `onOpen(key)` setter
// so the modal binds to the live ranked entry by key.
const PlanLocationCard = memo(function PlanLocationCard({ loc, onOpen }) {
  const key = `${loc.region}::${loc.name}`;
  return (
    <button
      type="button"
      onClick={() => onOpen(key)}
      className="w-full flex items-center gap-3 px-3 py-2.5 text-left rounded-lg
                 border border-[#e6dabf] dark:border-stone-800
                 bg-[#fdf8e9] dark:bg-stone-900
                 hover:border-[#c4b486] dark:hover:border-stone-600 hover:shadow-md
                 transition-all duration-150
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">{loc.region}</div>
        <div className="font-semibold text-stone-900 dark:text-stone-100 truncate">{loc.name}</div>
      </div>
      <div className="hidden sm:flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-stone-600 dark:text-stone-400 max-w-[260px] justify-end">
        {loc.methods.map((m) => (
          <span key={m} className="inline-flex items-center gap-0.5"><span aria-hidden>{methodIcon(m)}</span>{m}</span>
        ))}
      </div>
      <div className="shrink-0 flex flex-col items-end ml-2">
        <div className="text-[10px] text-stone-500 dark:text-stone-400">Score</div>
        <div className="font-bold text-stone-900 dark:text-stone-100 tabular-nums text-lg leading-none">{loc.score}</div>
        <div className="text-[10px] text-stone-500 dark:text-stone-400 tabular-nums">{loc.eligible.length} mon{loc.eligible.length === 1 ? '' : 's'}</div>
      </div>
      <ChevronRight size={16} className="shrink-0 text-stone-400 ml-1" />
    </button>
  );
});

/* ─────────────── Plan location modal ─────────────── */

function PlanLocationModal({ loc, trackerState, setMonState, openPanel, onClose }) {
  // Esc + body scroll lock — same pattern as PokemonModal.
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-black/70" onClick={onClose}>
      <div className="min-h-full flex items-start sm:items-center justify-center p-3 sm:p-6">
        <div
          className="w-full max-w-2xl bg-[#fdf8e9] dark:bg-stone-900
                     rounded-lg shadow-2xl border border-[#e6dabf] dark:border-stone-800
                     flex flex-col h-[min(720px,calc(100vh-3rem))]"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label={`${loc.name} catch plan`}
        >
          {/* Header */}
          <div className="p-4 border-b border-[#e6dabf] dark:border-stone-800 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">{loc.region}</div>
              <h2 className="text-lg font-bold text-stone-900 dark:text-stone-100 truncate">{loc.name}</h2>
              <div className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
                {loc.eligible.length} catchable mon{loc.eligible.length === 1 ? '' : 's'}
              </div>
            </div>
            <div className="shrink-0 flex flex-col items-end">
              <div className="text-[10px] text-stone-500 dark:text-stone-400">Score</div>
              <div className="font-bold text-stone-900 dark:text-stone-100 tabular-nums text-2xl leading-none">{loc.score}</div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md bg-[#fdf8e9] dark:bg-stone-800 hover:bg-[#ece2c4] dark:hover:bg-stone-700 text-stone-700 dark:text-stone-200"
              title="Close (Esc)"
            >
              <X size={18} />
            </button>
          </div>

          {/* Mon list — scrolls inside the modal */}
          <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
            {loc.eligible.length === 0 ? (
              <div className="py-8 text-center text-sm text-stone-500 dark:text-stone-400">
                Everything here is caught. Close to find the next location.
              </div>
            ) : (
              loc.eligible.map((m) => (
                <PlanMonRow
                  key={m.pokemon.id}
                  pokemon={m.pokemon}
                  entry={m.bestEntry}
                  state={m.state}
                  trackerState={trackerState}
                  setMonState={setMonState}
                  openPanel={openPanel}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────── Plan mon row (interactive) ─────────────── */

const PlanMonRow = memo(function PlanMonRow({ pokemon: p, entry, state, setMonState, openPanel }) {
  const primary = typeColor(p.types[0]).bg;
  const longPress = useLongPress(() => openPanel(p.id));

  function onClick(e) {
    // Right-click already handled by onContextMenu. Plain click → cycle.
    if (e.shiftKey) return; // ignore — Plan view doesn't have bulk select
    setMonState(p.id, cycleClick(state));
  }
  function onContextMenu(e) {
    e.preventDefault();
    openPanel(p.id);
  }

  const lvl = entry.min_level === entry.max_level ? `Lv ${entry.min_level}` : `Lv ${entry.min_level}–${entry.max_level}`;
  const isPriority = state === 'priority';
  const parsed = parseLocation(entry.location);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); } }}
      {...longPress}
      className={`group flex items-center gap-3 px-2 py-1.5 rounded cursor-pointer
                  border ${isPriority ? 'border-amber-300 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20' : 'border-transparent hover:bg-[#ece2c4]/60 dark:hover:bg-stone-800/30'}
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500`}
    >
      <div
        className="relative shrink-0 w-10 h-10 rounded overflow-hidden flex items-center justify-center"
        style={{ background: `radial-gradient(circle at 50% 50%, ${primary}26 0%, ${primary}14 70%, ${primary}0a 100%)` }}
      >
        <img src={p.sprite} alt={p.name} loading="lazy" decoding="async" className="pixelated w-9 h-9 object-contain" />
        {isPriority && (
          <Star size={10} fill="currentColor" className="absolute top-0 right-0 text-amber-500 drop-shadow" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className="font-mono text-[11px] text-stone-500">{dexNum(p.id)}</span>
          <span className="font-semibold text-sm text-stone-900 dark:text-stone-100 truncate">{p.name}</span>
          <div className="flex gap-1">
            {[...new Set(p.types)].map((t) => <TypeBadge key={t} type={t} />)}
          </div>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="inline-flex items-center gap-1 text-stone-700 dark:text-stone-300">
            <span aria-hidden>{methodIcon(entry.method)}</span>{entry.method}
          </span>
          <RarityBadge rarity={entry.rarity} />
          <span className="font-mono tabular-nums text-stone-700 dark:text-stone-300">{lvl}</span>
          {parsed.times.length > 0 && (
            <span className="text-stone-500 dark:text-stone-400">{parsed.times.join(' · ')}</span>
          )}
        </div>
      </div>

      {/* Single-click affordance */}
      <span className="hidden sm:inline-flex items-center gap-1 text-[10px] text-stone-400 dark:text-stone-500 shrink-0 opacity-0 group-hover:opacity-100">
        <Check size={10} /> click = caught
      </span>
    </div>
  );
});

// Long-press helper for touch devices. Returns props you spread on the element.
function useLongPress(onLongPress, ms = 500) {
  const timer = useRef(null);
  const triggered = useRef(false);
  const start = useCallback((e) => {
    triggered.current = false;
    timer.current = setTimeout(() => {
      triggered.current = true;
      onLongPress(e);
    }, ms);
  }, [onLongPress, ms]);
  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  return {
    onTouchStart: start,
    onTouchEnd: cancel,
    onTouchMove: cancel,
    onTouchCancel: cancel,
  };
}
