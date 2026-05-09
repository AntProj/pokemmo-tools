import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Star, Check, X } from 'lucide-react';
import TypeBadge from '../components/TypeBadge.jsx';
import RarityBadge from '../components/RarityBadge.jsx';
import { typeColor } from '../lib/types.js';
import { dexNum } from '../lib/format.js';
import { methodIcon, parseLocation, regionRank } from '../lib/locations.js';
import { stateOf, scorePoints, cycleClick, trackerRarityRank, METHOD_OPTIONS, isExcludedFromTracker } from '../lib/tracker.js';

const REGIONS = ['All', 'Kanto', 'Johto', 'Hoenn', 'Sinnoh', 'Unova'];
// Tracker-specific rarity order — same as TRACKER_RARITY_ORDER in tracker.js,
// duplicated here so the filter chips render in the right order without an
// extra export.
const RARITY_OPTIONS = ['Very Common', 'Common', 'Uncommon', 'Rare', 'Very Rare', 'Special', 'Horde', 'Lure'];

export default function TrackerPlan({
  data, pokemonById,
  trackerState, setMonState,
  view, updateView,
  openPanel,
}) {
  const { planRegion, planMethods, planRarities = [], hideSingles } = view;
  // Track the open modal by key so it stays bound to the *current* state of
  // the location (eligible mons / score update live as you click in the modal).
  const [openKey, setOpenKey] = useState(null);

  // ─────── Build per-location plan data ───────
  // For each (region, baseLocation) collect every encounter entry the
  // Pokémon has there. A single mon can show up under multiple methods or
  // rarities (e.g. a Horde and a Common spawn) — keep them all so the modal
  // can render them as multiple strips on the same card.
  const locationPlan = useMemo(() => {
    const groups = new Map(); // `${region}::${baseLower}` → entry
    for (const [key, monRefs] of Object.entries(data.locations)) {
      const [region, rawName] = key.split('::');
      const { base } = parseLocation(rawName);
      if (isExcludedFromTracker(base)) continue; // dex-gated locations
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
        // Pull every encounter entry for this mon at this base location
        // (across all time/season variants).
        const entriesHere = (fullPokemon.locations || []).filter(
          (l) => l.region === region && parseLocation(l.location).base.toLowerCase() === base.toLowerCase()
        );
        if (entriesHere.length === 0) continue;
        let me = g.monMap.get(ref.id);
        if (!me) {
          me = { pokemon: fullPokemon, entries: [], _seen: new Set() };
          g.monMap.set(ref.id, me);
        }
        // Dedupe identical strips (the dataset can record the same entry once
        // per seasonal variant key even when the visible details collapse).
        for (const e of entriesHere) {
          const stripKey = [e.method, e.rarity, e.min_level, e.max_level,
                            [...(parseLocation(e.location).times || [])].sort().join('|'),
                            [...(parseLocation(e.location).seasons || [])].sort().join('|')].join('::');
          if (me._seen.has(stripKey)) continue;
          me._seen.add(stripKey);
          me.entries.push(e);
        }
      }
    }
    // Strip helper fields and sort each mon's entries by tracker rarity rank.
    return [...groups.values()].map(({ _nameUpper, monMap, methodSet, ...rest }) => ({
      ...rest,
      monEntries: [...monMap.values()].map(({ _seen, entries, ...m }) => ({
        ...m,
        entries: entries.slice().sort((a, b) =>
          trackerRarityRank(a.rarity) - trackerRarityRank(b.rarity)
          || (a.min_level || 0) - (b.min_level || 0)
        ),
      })),
      methods: [...methodSet],
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
      const rarityAllowed = planRarities.length === 0
        ? null
        : new Set(planRarities);

      let score = 0;
      let priorityScore = 0;
      let priorityCount = 0;
      const eligible = [];
      for (const me of loc.monEntries) {
        const state = stateOf(trackerState, me.pokemon.id);
        if (state === 'caught' || state === 'skipped') continue;
        // Method + rarity filters: drop entries that don't match. A mon stays
        // eligible if at least one of its entries passes both filters.
        let visibleEntries = me.entries;
        if (methodAllowed) visibleEntries = visibleEntries.filter((e) => methodAllowed.has(e.method));
        if (rarityAllowed) visibleEntries = visibleEntries.filter((e) => rarityAllowed.has(e.rarity));
        if (visibleEntries.length === 0) continue;
        // Score from the best (lowest tracker rank) entry only — don't
        // double-count a mon listed under both a horde and a common.
        const bestEntry = visibleEntries.reduce((a, b) =>
          trackerRarityRank(b.rarity) < trackerRarityRank(a.rarity) ? b : a
        );
        const points = scorePoints(bestEntry.rarity, state);
        score += points;
        if (state === 'priority') {
          priorityScore += points;
          priorityCount += 1;
        }
        eligible.push({ pokemon: me.pokemon, entries: visibleEntries, bestEntry, state });
      }
      if (eligible.length === 0) continue;
      if (hideSingles && eligible.length < 2) continue;
      // Order mons by their best (lowest-rank) entry; dex id as tiebreaker.
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
        priorityScore,
        priorityCount,
      });
    }
    // Sort tiers, highest priority first:
    //   1. Locations with at least one priority mon, ranked among themselves
    //      by their priority-only score (using the base scoring algorithm,
    //      counting only priority mons).
    //   2. Locations without priority mons, ranked by overall score.
    //   3. Safari Zones always sink to the bottom regardless — Safari Balls,
    //      no battling, and mons flee, so they aren't a dependable dex farm.
    const isSafari = (loc) => /^safari zone$/i.test(loc.name);
    out.sort((a, b) => {
      const aS = isSafari(a), bS = isSafari(b);
      if (aS !== bS) return aS ? 1 : -1;
      const aP = a.priorityCount > 0, bP = b.priorityCount > 0;
      if (aP !== bP) return aP ? -1 : 1;
      if (aP) {
        return b.priorityScore - a.priorityScore
          || b.priorityCount - a.priorityCount
          || b.score - a.score
          || a.name.localeCompare(b.name, undefined, { numeric: true });
      }
      return b.score - a.score
        || b.eligible.length - a.eligible.length
        || a.name.localeCompare(b.name, undefined, { numeric: true });
    });
    return out;
  }, [locationPlan, trackerState, planRegion, planMethods, planRarities, hideSingles]);

  // ─────── Filter row handlers ───────
  const setRegion = useCallback((r) => updateView({ planRegion: r }), [updateView]);
  const toggleMethod = useCallback((m) => {
    updateView({ planMethods: planMethods.includes(m) ? planMethods.filter((x) => x !== m) : [...planMethods, m] });
  }, [planMethods, updateView]);
  const toggleRarity = useCallback((r) => {
    updateView({ planRarities: planRarities.includes(r) ? planRarities.filter((x) => x !== r) : [...planRarities, r] });
  }, [planRarities, updateView]);
  const toggleHideSingles = useCallback(() => updateView({ hideSingles: !hideSingles }), [hideSingles, updateView]);
  const resetFilters = useCallback(() => updateView({ planRegion: 'All', planMethods: [], planRarities: [], hideSingles: true }), [updateView]);

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

        <div className="flex items-start gap-2 flex-wrap">
          <span className="text-xs text-stone-500 dark:text-stone-400 mr-1 mt-1">Rarity</span>
          <div className="flex flex-wrap gap-1.5">
            {RARITY_OPTIONS.map((r) => {
              const sel = planRarities.includes(r);
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => toggleRarity(r)}
                  aria-pressed={sel}
                  title={sel ? `Hide ${r} encounters` : `Show only ${r} (toggle others to combine)`}
                  className={`px-2 py-0.5 rounded text-xs border transition-colors inline-flex items-center ${
                    sel
                      ? 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-900'
                      : 'bg-[#fdf8e9] dark:bg-stone-900 text-stone-700 dark:text-stone-300 border-[#d6c8a3] dark:border-stone-700 hover:bg-[#ece2c4] dark:hover:bg-stone-800'
                  }`}
                >
                  {r}
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
  const hasPriority = loc.priorityCount > 0;
  return (
    <button
      type="button"
      onClick={() => onOpen(key)}
      className={`w-full flex items-center gap-3 px-3 py-2.5 text-left rounded-lg
                 border transition-all duration-150 hover:shadow-md
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
                 ${hasPriority
                   ? 'border-amber-400 dark:border-amber-700 bg-amber-50/70 dark:bg-amber-950/20 hover:border-amber-500 dark:hover:border-amber-600'
                   : 'border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900 hover:border-[#c4b486] dark:hover:border-stone-600'}`}
    >
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">{loc.region}</div>
        <div className="font-semibold text-stone-900 dark:text-stone-100 truncate flex items-center gap-1.5">
          {hasPriority && <Star size={12} fill="currentColor" className="text-amber-500 shrink-0" />}
          {loc.name}
        </div>
      </div>
      <div className="hidden sm:flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-stone-600 dark:text-stone-400 max-w-[260px] justify-end">
        {loc.methods.map((m) => (
          <span key={m} className="inline-flex items-center gap-0.5"><span aria-hidden>{methodIcon(m)}</span>{m}</span>
        ))}
      </div>
      <div className="shrink-0 flex flex-col items-end ml-2">
        <div className="text-[10px] text-stone-500 dark:text-stone-400">Score</div>
        <div className="font-bold text-stone-900 dark:text-stone-100 tabular-nums text-lg leading-none">{loc.score}</div>
        <div className="text-[10px] text-stone-500 dark:text-stone-400 tabular-nums">
          {hasPriority && <span className="text-amber-600 dark:text-amber-400">★{loc.priorityCount} · </span>}
          {loc.eligible.length} mon{loc.eligible.length === 1 ? '' : 's'}
        </div>
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
                  entries={m.entries}
                  state={m.state}
                  setMonState={setMonState}
                  openPanel={openPanel}
                  currentRegion={loc.region}
                  currentLocation={loc.name}
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

const PlanMonRow = memo(function PlanMonRow({ pokemon: p, entries, state, setMonState, openPanel, currentRegion, currentLocation }) {
  const primary = typeColor(p.types[0]).bg;
  const longPress = useLongPress(() => openPanel(p.id));
  const better = findBetterLocation(p, currentRegion, currentLocation);

  function onClick(e) {
    if (e.shiftKey) return;
    setMonState(p.id, cycleClick(state));
  }
  function onContextMenu(e) {
    e.preventDefault();
    openPanel(p.id);
  }

  const isPriority = state === 'priority';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); } }}
      {...longPress}
      className={`group flex items-start gap-3 px-2 py-1.5 rounded cursor-pointer
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
        <div className="mt-1 space-y-0.5">
          {entries.map((entry, i) => <PlanEncounterStrip key={i} entry={entry} />)}
        </div>
        {better && (
          <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400" title={`Best rate for ${p.name} is at ${better.base} (${better.region}) — ${better.rarity}.`}>
            <ChevronRight size={11} className="shrink-0" />
            <span>Better at <span className="font-semibold">{better.base}</span> <span className="text-stone-500 dark:text-stone-400">({better.region})</span> · {better.rarity}</span>
          </div>
        )}
      </div>

      <span className="hidden sm:inline-flex items-center gap-1 text-[10px] text-stone-400 dark:text-stone-500 shrink-0 opacity-0 group-hover:opacity-100 mt-1">
        <Check size={10} /> click = caught
      </span>
    </div>
  );
});

// For a Pokémon listed at (currentRegion, currentLocation): does it have a
// HIGHER-weight (easier) encounter at any OTHER location? If yes, return the
// best such alternative; if the current location is already its best (or only)
// spot, return null.
function findBetterLocation(pokemon, currentRegion, currentLocation) {
  const all = pokemon.locations || [];
  if (all.length <= 1) return null;
  const curBase = (currentLocation || '').toLowerCase();
  let bestHere = 0;
  let bestElsewhere = null;
  for (const loc of all) {
    const base = parseLocation(loc.location).base;
    const isHere = loc.region === currentRegion && base.toLowerCase() === curBase;
    if (isHere) {
      if ((loc.weight || 0) > bestHere) bestHere = loc.weight || 0;
    } else {
      // Don't suggest dex-gated locations as alternatives.
      if (isExcludedFromTracker(base)) continue;
      if (!bestElsewhere || (loc.weight || 0) > bestElsewhere.weight) {
        bestElsewhere = {
          weight: loc.weight || 0,
          region: loc.region,
          base,
          rarity: loc.rarity,
        };
      }
    }
  }
  if (!bestElsewhere || bestElsewhere.weight <= bestHere) return null;
  return bestElsewhere;
}

function PlanEncounterStrip({ entry }) {
  const lvl = entry.min_level === entry.max_level
    ? `Lv ${entry.min_level}`
    : `Lv ${entry.min_level}–${entry.max_level}`;
  const parsed = parseLocation(entry.location);
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="inline-flex items-center gap-1 text-stone-700 dark:text-stone-300">
        <span aria-hidden>{methodIcon(entry.method)}</span>{entry.method}
      </span>
      <RarityBadge rarity={entry.rarity} />
      <span className="font-mono tabular-nums text-stone-700 dark:text-stone-300">{lvl}</span>
      {parsed.times.length > 0 && (
        <span className="text-stone-500 dark:text-stone-400">{parsed.times.join(' · ')}</span>
      )}
      {parsed.seasons.length > 0 && (
        <span className="text-stone-500 dark:text-stone-400">S{parsed.seasons.join(',')}</span>
      )}
    </div>
  );
}

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
