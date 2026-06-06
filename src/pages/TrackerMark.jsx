import { memo, useCallback, useDeferredValue, useMemo, useRef, useState } from 'react';
import { Search, Check, Slash, Star, X } from 'lucide-react';
import TypeBadge from '../components/TypeBadge.jsx';
import PokemonSprite from '../components/PokemonSprite.jsx';
import { ALL_POKEMON_TYPES, typeColor } from '../lib/types.js';
import { displayDex, regionKey, statTotal } from '../lib/format.js';
import { stateOf, cycleClick, STATES } from '../lib/tracker.js';

const REGIONS = ['All', 'Kanto', 'Johto', 'Hoenn', 'Sinnoh', 'Unova'];
const SORTS = [
  { value: 'dex',  label: 'Dex #' },
  { value: 'name', label: 'Name A→Z' },
  { value: 'bst',  label: 'BST high→low' },
  // Hunt priority — tier 0 first, then 1, 2, (4=default), 5. Tier-tagged
  // mons cluster at the top with tier 4 (everything unassigned) trailing.
  { value: 'tier', label: 'Hunt priority' },
];

// Per-tier visual styling. Keys match `data.hunt_tiers.tiers[].color`.
// Kept here rather than in pokemmo.json so Tailwind's purge can statically
// see every class string at build time.
const TIER_STYLE = {
  rose:    { active: 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-900',          badge: 'bg-rose-500 text-white'       },
  amber:   { active: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900',    badge: 'bg-amber-500 text-white'     },
  violet:  { active: 'bg-violet-100 text-violet-800 border-violet-300 dark:bg-violet-950/50 dark:text-violet-300 dark:border-violet-900', badge: 'bg-violet-500 text-white' },
  emerald: { active: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900', badge: 'bg-emerald-500 text-white' },
  stone:   { active: 'bg-stone-200 text-stone-800 border-stone-400 dark:bg-stone-800 dark:text-stone-300 dark:border-stone-600',       badge: 'bg-stone-500 text-white'     },
};
const STATE_FILTERS = [
  { key: 'uncaught', label: 'Uncaught' },
  { key: 'caught',   label: 'Caught'   },
  { key: 'priority', label: 'Priority' },
  { key: 'skipped',  label: 'Skipped'  },
];
// Baby filter — three states. Stored as a string so it serializes cleanly
// alongside the other view fields.
const BABY_FILTERS = [
  { key: 'any',     label: 'Any'            },
  { key: 'only',    label: 'Babies only'    },
  { key: 'exclude', label: 'Hide babies'    },
];
// Rarity filter — ordered roughly from most to least common, with the
// encounter-flavor rarities (Horde / Lure / Special) trailing. Matches the
// strings build-data.mjs emits as `loc.rarity`. See:
//   node -e 'r = new Set(); require("./src/data/pokemmo.json").pokemon
//     .forEach(p=>p.locations?.forEach(l=>r.add(l.rarity))); console.log([...r])'
const RARITY_FILTERS = [
  'Very Common', 'Common', 'Uncommon', 'Rare', 'Very Rare', 'Horde', 'Lure', 'Special',
];

// Evolution-method filter. Groups the raw 27 evolution `type` strings emitted
// by build-data.mjs into 8 coarse, user-meaningful buckets — the raw types
// are too granular to expose directly (HAPPINESS / HAPPINESS_DAY /
// HAPPINESS_NIGHT all "feel" like Friendship to the user; the three
// LEVEL_LOCATION_* slots are all "near a special rock"; etc.).
//
// A mon matches a category if EITHER:
//   - one of its outgoing evolutions has a type in the category, OR
//   - it was created via an evolution whose pre_evolution.type is in the
//     category (so e.g. picking "Stone" surfaces both Eevee — who needs a
//     stone to evolve into Vaporeon — and Vaporeon itself).
//
// Multi-select with OR semantics: pick "Stone" + "Trade" to see every mon
// in either bucket. Single bucket picked = just that one.
//
// Keys here are used as both `markEvolutions` array values (persisted in
// view state) and React keys; keep them stable.
const EVOLUTION_CATEGORIES = [
  { key: 'stone',      label: 'Stone',      types: ['ITEM', 'ITEM_MALE', 'ITEM_FEMALE'] },
  { key: 'level',      label: 'Level',      types: ['LEVEL', 'LEVEL_FEMALE', 'LEVEL_MALE',
                                                    'ATK_LESS_THAN_DEF', 'ATK_GREATER_THAN_DEF', 'ATK_EQUAL_TO_DEF',
                                                    'PERSONALITY_HIGH', 'PERSONALITY_LOW'] },
  { key: 'friendship', label: 'Friendship', types: ['HAPPINESS', 'HAPPINESS_DAY', 'HAPPINESS_NIGHT'] },
  { key: 'trade',      label: 'Trade',      types: ['TRADE', 'TRADE_WITH_ITEM', 'TRADE_FOR_OPPOSITE'] },
  { key: 'held',       label: 'Held item',  types: ['LEVEL_ITEM_DAY', 'LEVEL_ITEM_NIGHT'] },
  { key: 'move',       label: 'Knows move', types: ['LEVEL_WITH_SKILL'] },
  { key: 'location',   label: 'Location',   types: ['LEVEL_LOCATION_1', 'LEVEL_LOCATION_2', 'LEVEL_LOCATION_3'] },
  { key: 'special',    label: 'Special',    types: ['MAX_BEAUTY', 'LEVEL_WITH_MONSTER',
                                                    'ALLOW_MONSTER_CREATION', 'CREATE_EXTRA_MONSTER'] },
];
// Reverse lookup: raw type → category key. Lets the filter map each mon's
// evolution types straight to a Set of category keys in O(#evolutions).
const EVOLUTION_TYPE_TO_CATEGORY = (() => {
  const m = new Map();
  for (const cat of EVOLUTION_CATEGORIES) for (const t of cat.types) m.set(t, cat.key);
  return m;
})();

export default function TrackerMark({
  data,
  trackerState, setMonState, setManyMonStates,
  view, updateView,
  openPanel,
}) {
  const {
    markSearch, markRegion, markTypes, markStates, markSort,
    markBaby = 'any',
    markRarities = [],
    markRaritiesMode = 'only',
    markEvolutions = [],
    markTiers = [],
  } = view;
  // Hunt-tier catalog ships in pokemmo.json. Tracker UI degrades gracefully
  // to no tier filter if the field is absent (older builds, or a future rev
  // that drops the file).
  const huntTierCatalog = data.hunt_tiers?.tiers || [];
  const huntTierByNum = useMemo(() => {
    const m = new Map();
    for (const t of huntTierCatalog) m.set(t.tier, t);
    return m;
  }, [huntTierCatalog]);
  const deferredSearch = useDeferredValue(markSearch);

  const setSearch = useCallback((v) => updateView({ markSearch: v }),  [updateView]);
  const setRegion = useCallback((v) => updateView({ markRegion: v }),  [updateView]);
  const setSort   = useCallback((v) => updateView({ markSort:   v }),  [updateView]);
  const setBaby   = useCallback((v) => updateView({ markBaby:   v }),  [updateView]);
  const setRaritiesMode = useCallback((v) => updateView({ markRaritiesMode: v }), [updateView]);
  const toggleType = useCallback((t) => {
    const next = markTypes.includes(t)
      ? markTypes.filter((x) => x !== t)
      : (markTypes.length < 2 ? [...markTypes, t] : [markTypes[1], t]);
    updateView({ markTypes: next });
  }, [markTypes, updateView]);
  const toggleStateFilter = useCallback((s) => {
    updateView({ markStates: markStates.includes(s) ? markStates.filter((x) => x !== s) : [...markStates, s] });
  }, [markStates, updateView]);
  const toggleRarityFilter = useCallback((r) => {
    updateView({ markRarities: markRarities.includes(r) ? markRarities.filter((x) => x !== r) : [...markRarities, r] });
  }, [markRarities, updateView]);
  const toggleEvolutionFilter = useCallback((c) => {
    updateView({ markEvolutions: markEvolutions.includes(c) ? markEvolutions.filter((x) => x !== c) : [...markEvolutions, c] });
  }, [markEvolutions, updateView]);
  const toggleTierFilter = useCallback((t) => {
    updateView({ markTiers: markTiers.includes(t) ? markTiers.filter((x) => x !== t) : [...markTiers, t] });
  }, [markTiers, updateView]);

  // ─────── Evolution-family index ───────
  // Map<pokemonId, Set<pokemonId>> — for every Pokémon, the set of every
  // member of its evolution family (pre-evolutions, post-evolutions, and all
  // branches). Handles linear chains (Bulbasaur → Ivysaur → Venusaur),
  // branching post-evolutions (Eevee → 8 eeveelutions), and mid-chain
  // branches (Wurmple → Silcoon/Cascoon → Beautifly/Dustox).
  //
  // Why this exists: searching by name in the Mark grid surfaces only the
  // typed mon, which hides the fact that completing a regional dex often
  // requires breeding or evolving from a different listed mon. Expanding the
  // result to the whole family lets the user see at a glance whether they
  // already have the relevant pre-/post-evos marked.
  //
  // Built once per data.pokemon load via BFS over `evolutions[].id` and
  // `pre_evolution.id`. Connected components share their Set instance so
  // membership lookup is O(1) per filter iteration.
  const familyMap = useMemo(() => {
    const byId = new Map(data.pokemon.map((p) => [p.id, p]));
    const families = new Map();
    const visited = new Set();
    for (const root of data.pokemon) {
      if (visited.has(root.id)) continue;
      const family = new Set();
      const stack = [root.id];
      while (stack.length) {
        const cur = stack.pop();
        if (family.has(cur)) continue;
        family.add(cur);
        const mon = byId.get(cur);
        if (!mon) continue;
        if (mon.pre_evolution?.id != null) stack.push(mon.pre_evolution.id);
        for (const ev of (mon.evolutions || [])) {
          if (ev?.id != null) stack.push(ev.id);
        }
      }
      for (const id of family) {
        families.set(id, family);
        visited.add(id);
      }
    }
    return families;
  }, [data.pokemon]);

  // ─────── Filter pipeline ───────
  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    let dexQuery = null;
    if (q) {
      const m = q.replace(/^#/, '').match(/^\d+$/);
      if (m) dexQuery = parseInt(m[0], 10);
    }
    const rkey = regionKey(markRegion);
    const stateSet = markStates.length > 0 ? new Set(markStates) : null;

    // When the user typed a search, first find every mon that matches it
    // DIRECTLY, then expand to those mons' evolution families. The family
    // expansion is the user-visible behavior change — it makes the Mark
    // grid show e.g. Bulbasaur + Ivysaur + Venusaur when you search "bulb",
    // so the user can see at a glance whether the evolved forms are already
    // tracked. Region / type / state filters still apply on top.
    //
    // searchFamilyIds === null means "no search active, skip this check".
    let searchFamilyIds = null;
    if (q) {
      searchFamilyIds = new Set();
      for (const p of data.pokemon) {
        const nameMatch = p.name.toLowerCase().includes(q);
        const nationalMatch = dexQuery != null && p.id === dexQuery;
        const regionalMatch = dexQuery != null && rkey && p.dex?.[rkey] === dexQuery;
        if (!nameMatch && !nationalMatch && !regionalMatch) continue;
        const fam = familyMap.get(p.id);
        if (fam) for (const id of fam) searchFamilyIds.add(id);
        else searchFamilyIds.add(p.id);
      }
    }

    // Pre-bake the rarity filter set so we don't realloc it per mon. Empty
    // selection = filter is off.
    const raritySet = markRarities.length > 0 ? new Set(markRarities) : null;
    const evoCategorySet = markEvolutions.length > 0 ? new Set(markEvolutions) : null;
    // Hunt-tier filter set. The "null" hunt_tier (unassigned) maps to tier 4
    // (the default bucket), so picking tier 4 in the UI matches both.
    const tierSet = markTiers.length > 0 ? new Set(markTiers) : null;

    const out = data.pokemon.filter((p) => {
      if (rkey) {
        if (!p.dex || !(p.dex[rkey] > 0)) return false;
      }
      if (markTypes.length > 0) {
        for (const t of markTypes) {
          if (!p.types.some((pt) => pt.toLowerCase() === t.toLowerCase())) return false;
        }
      }
      if (searchFamilyIds && !searchFamilyIds.has(p.id)) return false;
      if (stateSet) {
        const s = stateOf(trackerState, p.id);
        if (!stateSet.has(s)) return false;
      }
      // Baby gate. `markBaby === 'any'` is the no-op default.
      if (markBaby === 'only'    && !p.is_baby) return false;
      if (markBaby === 'exclude' &&  p.is_baby) return false;
      // Rarity gate. Two semantics:
      //   'only' — every one of this mon's encounter rarities must be in
      //            raritySet (i.e. the mon is found EXCLUSIVELY at selected
      //            rarities). Useful for finding event-only mons by picking
      //            "Special" alone. Empty locations → fails (no encounters
      //            to satisfy).
      //   'any'  — at least one location matches. Catches mons that ALSO
      //            appear elsewhere.
      if (raritySet) {
        const locs = p.locations || [];
        if (locs.length === 0) return false;
        if (markRaritiesMode === 'only') {
          // Every location must be in raritySet, AND at least one must
          // match (which is implied by the subset check + locs.length > 0
          // since locs is non-empty and all locs are in raritySet means
          // every entry is a selected rarity).
          for (const l of locs) if (!raritySet.has(l.rarity)) return false;
        } else {
          // 'any' — short-circuit on first match.
          let matched = false;
          for (const l of locs) if (raritySet.has(l.rarity)) { matched = true; break; }
          if (!matched) return false;
        }
      }
      // Evolution-method gate. OR semantics: a mon matches if ANY of its
      // outgoing-evolution types or its pre_evolution.type maps to a
      // selected category. Checking both directions surfaces the whole
      // family — picking "Stone" gets you Eevee (needs Fire/Water/Thunder
      // Stone) AND Vaporeon/Flareon/Jolteon (came from a stone).
      if (evoCategorySet) {
        let matched = false;
        const pre = p.pre_evolution?.type;
        if (pre && evoCategorySet.has(EVOLUTION_TYPE_TO_CATEGORY.get(pre))) matched = true;
        if (!matched) {
          for (const ev of (p.evolutions || [])) {
            const cat = EVOLUTION_TYPE_TO_CATEGORY.get(ev?.type);
            if (cat && evoCategorySet.has(cat)) { matched = true; break; }
          }
        }
        if (!matched) return false;
      }
      // Hunt-tier gate. `p.hunt_tier === null` means the mon was not
      // assigned a tier in hunt-tiers.json — treat as tier 4 (the default
      // "normal horde" bucket). So picking tier 4 in the UI surfaces both
      // explicitly-tagged tier-4 mons (if any) AND every unassigned mon.
      if (tierSet) {
        const effectiveTier = p.hunt_tier ?? 4;
        if (!tierSet.has(effectiveTier)) return false;
      }
      return true;
    });

    if (markSort === 'name')    out.sort((a, b) => a.name.localeCompare(b.name));
    else if (markSort === 'bst') out.sort((a, b) => statTotal(b.stats) - statTotal(a.stats));
    else if (markSort === 'tier') {
      // Lower tier number = higher hunt priority → sort ascending. Unassigned
      // (null) treated as 4 (the default bucket). Ties broken by dex number
      // so the order within a tier stays predictable.
      out.sort((a, b) => {
        const ta = a.hunt_tier ?? 4;
        const tb = b.hunt_tier ?? 4;
        if (ta !== tb) return ta - tb;
        return a.id - b.id;
      });
    }
    else if (rkey)              out.sort((a, b) => (a.dex[rkey] || 0) - (b.dex[rkey] || 0));
    else                        out.sort((a, b) => a.id - b.id);
    return out;
  }, [data.pokemon, deferredSearch, markRegion, markTypes, markStates, markSort, markBaby, markRarities, markRaritiesMode, markEvolutions, markTiers, trackerState, familyMap]);

  // ─────── Selection (for bulk actions) ───────
  // Set<pokemonId>. Lives locally — selection is ephemeral and tab-scoped.
  const [selected, setSelected] = useState(() => new Set());
  const lastClickedId = useRef(null);

  const handleClick = useCallback((id, e) => {
    if (e.shiftKey) {
      // Shift-click toggles selection. Doesn't change state.
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
      lastClickedId.current = id;
      return;
    }
    // Plain click cycles state.
    setMonState(id, cycleClick(stateOf(trackerState, id)));
    lastClickedId.current = id;
  }, [setMonState, trackerState]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);
  const applyBulk = useCallback((state) => {
    setManyMonStates([...selected], state);
    setSelected(new Set());
  }, [selected, setManyMonStates]);

  return (
    <main className="max-w-7xl mx-auto px-4 py-4 space-y-4">
      {/* Filters */}
      <section className="rounded-md border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900 p-3 space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 dark:text-stone-500" />
            <input
              type="search"
              value={markSearch}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or dex number"
              className="w-full pl-8 pr-3 py-1.5 rounded-md border border-[#d6c8a3] dark:border-stone-700
                         bg-[#fdf8e9] dark:bg-stone-900 text-stone-900 dark:text-stone-100
                         placeholder:text-stone-400 dark:placeholder:text-stone-500
                         focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-stone-500 dark:text-stone-400">Sort</label>
            <select
              value={markSort}
              onChange={(e) => setSort(e.target.value)}
              className="px-2 py-1.5 rounded-md border border-[#d6c8a3] dark:border-stone-700
                         bg-[#fdf8e9] dark:bg-stone-900 text-stone-900 dark:text-stone-100 text-sm
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {SORTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <span className="text-xs text-stone-500 dark:text-stone-400 tabular-nums">
            {filtered.length} mon{filtered.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-stone-500 dark:text-stone-400 mr-1">Region</span>
          {REGIONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRegion(r)}
              aria-pressed={markRegion === r}
              className={`px-2.5 py-1 rounded-md text-sm border transition-colors ${
                markRegion === r
                  ? 'bg-stone-900 text-white border-stone-900 dark:bg-stone-100 dark:text-stone-900 dark:border-stone-100'
                  : 'bg-[#fdf8e9] text-stone-700 border-[#d6c8a3] hover:bg-[#ece2c4] dark:bg-stone-900 dark:text-stone-300 dark:border-stone-700 dark:hover:bg-stone-800'
              }`}
            >
              {r}
            </button>
          ))}
        </div>

        <div className="flex items-start gap-2 flex-wrap">
          <span className="text-xs text-stone-500 dark:text-stone-400 mr-1 mt-1">Types</span>
          <div className="flex flex-wrap gap-1.5">
            {ALL_POKEMON_TYPES.map((t) => {
              const sel = markTypes.includes(t);
              const c = typeColor(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleType(t)}
                  aria-pressed={sel}
                  className={`px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wide border transition-all ${
                    sel
                      ? 'border-stone-900 dark:border-stone-100 ring-1 ring-blue-500'
                      : 'border-[#d6c8a3] dark:border-stone-700 opacity-70 hover:opacity-100'
                  }`}
                  style={sel ? { backgroundColor: c.bg, color: c.fg, borderColor: c.bg } : undefined}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-stone-500 dark:text-stone-400 mr-1">State</span>
          {STATE_FILTERS.map(({ key, label }) => {
            const sel = markStates.includes(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleStateFilter(key)}
                aria-pressed={sel}
                className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                  sel
                    ? 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-900'
                    : 'bg-[#fdf8e9] dark:bg-stone-900 text-stone-700 dark:text-stone-300 border-[#d6c8a3] dark:border-stone-700 hover:bg-[#ece2c4] dark:hover:bg-stone-800'
                }`}
              >
                {label}
              </button>
            );
          })}
          {markStates.length > 0 && (
            <button
              type="button"
              onClick={() => updateView({ markStates: [] })}
              className="text-xs text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 underline underline-offset-2"
            >
              Clear
            </button>
          )}
        </div>

        {/* Baby filter — a three-way toggle. Babies are the unevolved
            breed-only forms (Pichu, Cleffa, etc.) that the user often
            wants to surface or hide as a group. */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-stone-500 dark:text-stone-400 mr-1">Babies</span>
          {BABY_FILTERS.map(({ key, label }) => {
            const sel = markBaby === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setBaby(key)}
                aria-pressed={sel}
                className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                  sel
                    ? 'bg-pink-100 text-pink-800 border-pink-300 dark:bg-pink-950/50 dark:text-pink-300 dark:border-pink-900'
                    : 'bg-[#fdf8e9] dark:bg-stone-900 text-stone-700 dark:text-stone-300 border-[#d6c8a3] dark:border-stone-700 hover:bg-[#ece2c4] dark:hover:bg-stone-800'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Encounter-rarity filter. "Only" mode (default) shows mons whose
            encounters fall EXCLUSIVELY within the selected rarities — pick
            "Special" alone to see event-only mons; pick "Special" + "Rare"
            to see mons found only at one of those two. "Any" mode loosens
            this: shows any mon that has at least one encounter at a
            selected rarity (so picking "Special" surfaces every mon with
            *any* Special encounter, even if they also appear commonly
            elsewhere). */}
        <div className="flex items-start gap-2 flex-wrap">
          <span className="text-xs text-stone-500 dark:text-stone-400 mr-1 mt-1">Encounter</span>
          <div className="flex flex-wrap gap-1.5 items-center">
            {RARITY_FILTERS.map((r) => {
              const sel = markRarities.includes(r);
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => toggleRarityFilter(r)}
                  aria-pressed={sel}
                  className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                    sel
                      ? 'bg-violet-100 text-violet-800 border-violet-300 dark:bg-violet-950/50 dark:text-violet-300 dark:border-violet-900'
                      : 'bg-[#fdf8e9] dark:bg-stone-900 text-stone-700 dark:text-stone-300 border-[#d6c8a3] dark:border-stone-700 hover:bg-[#ece2c4] dark:hover:bg-stone-800'
                  }`}
                >
                  {r}
                </button>
              );
            })}
            {markRarities.length > 0 && (
              <>
                <span className="text-xs text-stone-400 dark:text-stone-600 mx-1">·</span>
                {/* Mode toggle — only relevant when rarities are selected. */}
                {[
                  { key: 'only', label: 'Only' },
                  { key: 'any',  label: 'Any'  },
                ].map(({ key, label }) => {
                  const sel = markRaritiesMode === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setRaritiesMode(key)}
                      aria-pressed={sel}
                      title={key === 'only'
                        ? "Mon's encounters must ALL be in the selected rarities"
                        : "Mon has at least one encounter in the selected rarities"}
                      className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                        sel
                          ? 'bg-stone-900 text-white border-stone-900 dark:bg-stone-100 dark:text-stone-900 dark:border-stone-100'
                          : 'bg-[#fdf8e9] dark:bg-stone-900 text-stone-700 dark:text-stone-300 border-[#d6c8a3] dark:border-stone-700 hover:bg-[#ece2c4] dark:hover:bg-stone-800'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => updateView({ markRarities: [] })}
                  className="ml-1 text-xs text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 underline underline-offset-2"
                >
                  Clear
                </button>
              </>
            )}
          </div>
        </div>

        {/* Evolution-method filter — group the 27 raw evolution `type`
            strings into 8 user-friendly buckets (Stone, Level, Friendship,
            Trade, Held item, Knows move, Location, Special). Multi-select
            with OR semantics: pick Stone alone to surface mons that need
            (or came from) an evolution stone; pick Stone + Trade to widen
            to both. Match is two-way (outgoing evolutions + incoming
            pre_evolution) so the whole family shows up for any pick. */}
        <div className="flex items-start gap-2 flex-wrap">
          <span className="text-xs text-stone-500 dark:text-stone-400 mr-1 mt-1">Evolution</span>
          <div className="flex flex-wrap gap-1.5 items-center">
            {EVOLUTION_CATEGORIES.map(({ key, label }) => {
              const sel = markEvolutions.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleEvolutionFilter(key)}
                  aria-pressed={sel}
                  className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                    sel
                      ? 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900'
                      : 'bg-[#fdf8e9] dark:bg-stone-900 text-stone-700 dark:text-stone-300 border-[#d6c8a3] dark:border-stone-700 hover:bg-[#ece2c4] dark:hover:bg-stone-800'
                  }`}
                >
                  {label}
                </button>
              );
            })}
            {markEvolutions.length > 0 && (
              <button
                type="button"
                onClick={() => updateView({ markEvolutions: [] })}
                className="ml-1 text-xs text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 underline underline-offset-2"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Hunt-tier filter — only renders if the data carries the catalog
            (older builds without hunt_tiers field just don't show this row).
            Tier numbers follow the forum guide's odd "0/1/2/4/5" numbering
            so users who came here from the post recognize the labels. */}
        {huntTierCatalog.length > 0 && (
          <div className="flex items-start gap-2 flex-wrap">
            <span className="text-xs text-stone-500 dark:text-stone-400 mr-1 mt-1" title="Source: forums.pokemmo.com OT-dex completion guide">Hunt tier</span>
            <div className="flex flex-wrap gap-1.5 items-center">
              {huntTierCatalog.map((t) => {
                const sel = markTiers.includes(t.tier);
                const style = TIER_STYLE[t.color] || TIER_STYLE.stone;
                return (
                  <button
                    key={t.tier}
                    type="button"
                    onClick={() => toggleTierFilter(t.tier)}
                    aria-pressed={sel}
                    title={t.blurb}
                    className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                      sel
                        ? style.active
                        : 'bg-[#fdf8e9] dark:bg-stone-900 text-stone-700 dark:text-stone-300 border-[#d6c8a3] dark:border-stone-700 hover:bg-[#ece2c4] dark:hover:bg-stone-800'
                    }`}
                  >
                    T{t.tier} {t.label}
                  </button>
                );
              })}
              {markTiers.length > 0 && (
                <button
                  type="button"
                  onClick={() => updateView({ markTiers: [] })}
                  className="ml-1 text-xs text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 underline underline-offset-2"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <BulkBar count={selected.size} onApply={applyBulk} onClear={clearSelection} />
      )}

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="py-16 text-center text-stone-500 dark:text-stone-400">No Pokémon match.</div>
      ) : (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
          {filtered.map((p) => (
            <TrackerCard
              key={p.id}
              pokemon={p}
              region={markRegion}
              state={stateOf(trackerState, p.id)}
              isSelected={selected.has(p.id)}
              onClick={handleClick}
              openPanel={openPanel}
              tierMeta={p.hunt_tier != null ? huntTierByNum.get(p.hunt_tier) : null}
            />
          ))}
        </div>
      )}
    </main>
  );
}

/* ─────────────── Bulk action bar ─────────────── */

function BulkBar({ count, onApply, onClear }) {
  return (
    <div className="sticky top-[60px] z-10 flex items-center gap-2 flex-wrap rounded-md border border-blue-300 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 px-3 py-2 text-sm">
      <span className="font-semibold text-blue-900 dark:text-blue-200">{count} selected</span>
      <span className="text-stone-400">·</span>
      <BulkBtn onClick={() => onApply('caught')}>Caught</BulkBtn>
      <BulkBtn onClick={() => onApply('uncaught')}>Uncaught</BulkBtn>
      <BulkBtn onClick={() => onApply('priority')}>Priority</BulkBtn>
      <BulkBtn onClick={() => onApply('skipped')}>Skipped</BulkBtn>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto inline-flex items-center gap-1 text-xs text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100"
      >
        <X size={12} /> Clear selection
      </button>
    </div>
  );
}

function BulkBtn({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-2.5 py-1 rounded-md text-xs font-medium border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 hover:bg-[#ece2c4] dark:hover:bg-stone-800 text-stone-700 dark:text-stone-200"
    >
      Mark {children}
    </button>
  );
}

/* ─────────────── Tracker card ─────────────── */

const TrackerCard = memo(function TrackerCard({ pokemon: p, region, state, isSelected, onClick, openPanel, tierMeta }) {
  const primary = typeColor(p.types[0]).bg;
  const longPress = useLongPress(useCallback(() => openPanel(p.id), [openPanel, p.id]));

  const onCardClick   = useCallback((e) => onClick(p.id, e), [onClick, p.id]);
  const onContextMenu = useCallback((e) => { e.preventDefault(); openPanel(p.id); }, [openPanel, p.id]);

  const dimmed   = state === 'caught' || state === 'skipped';
  const priority = state === 'priority';
  const caught   = state === 'caught';
  const skipped  = state === 'skipped';

  return (
    <button
      type="button"
      onClick={onCardClick}
      onContextMenu={onContextMenu}
      {...longPress}
      aria-pressed={isSelected}
      className={`group relative flex flex-col items-center text-center p-3 rounded-lg
                  bg-[#fdf8e9] border hover:shadow-md dark:bg-stone-900
                  ${isSelected
                    ? 'border-blue-500 ring-2 ring-blue-300 dark:ring-blue-900'
                    : priority
                      ? 'border-amber-400 dark:border-amber-700'
                      : 'border-[#e6dabf] dark:border-stone-800 hover:border-[#c4b486] dark:hover:border-stone-600'}
                  transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500`}
    >
      <div
        className="relative w-full aspect-square flex items-center justify-center rounded-lg overflow-hidden"
        style={{ background: `radial-gradient(circle at 50% 50%, ${primary}26 0%, ${primary}14 70%, ${primary}0a 100%)` }}
      >
        <div
          className="absolute inset-0 hidden dark:block pointer-events-none"
          style={{ background: `radial-gradient(circle at 50% 50%, ${primary}3d 0%, ${primary}1f 70%, ${primary}0f 100%)` }}
        />
        <PokemonSprite
          pokemon={p}
          variant="animated"
          loading="lazy"
          className={`w-20 h-20 object-contain relative transition ${dimmed ? 'grayscale opacity-40' : ''}`}
        />
        {/* Hunt-tier badge — top-LEFT, opposite the state badge. Tooltip
            carries the per-mon `hunt_tier_note` (e.g. "Honey Tree exclusive
            — catch one of each gender") so users can hover for the why
            without leaving the grid. */}
        {tierMeta && (
          <span
            className={`absolute top-1 left-1 inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full text-[10px] font-bold shadow ${TIER_STYLE[tierMeta.color]?.badge || TIER_STYLE.stone.badge}`}
            title={`${tierMeta.label} (T${tierMeta.tier})${p.hunt_tier_note ? ' — ' + p.hunt_tier_note : ''}`}
          >
            T{tierMeta.tier}
          </span>
        )}
        {/* State badge overlays */}
        {caught && (
          <span className="absolute top-1 right-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500 text-white shadow">
            <Check size={12} strokeWidth={3} />
          </span>
        )}
        {priority && (
          <span className="absolute top-1 right-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-400 text-stone-900 shadow">
            <Star size={12} fill="currentColor" />
          </span>
        )}
        {skipped && (
          <span className="absolute top-1 right-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-stone-500 text-white shadow">
            <Slash size={12} strokeWidth={3} />
          </span>
        )}
      </div>
      <div className={`mt-2 font-mono text-xs text-stone-500 dark:text-stone-500 ${dimmed ? 'opacity-60' : ''}`}>
        {displayDex(p, region)}
      </div>
      <div className={`font-semibold text-sm text-stone-900 dark:text-stone-100 truncate w-full ${dimmed ? 'opacity-60' : ''}`}>
        {p.name}
      </div>
      <div className="mt-1 flex flex-wrap gap-1 justify-center">
        {[...new Set(p.types)].map((t) => <TypeBadge key={t} type={t} />)}
      </div>
    </button>
  );
});

function useLongPress(onLongPress, ms = 500) {
  const timer = useRef(null);
  const start = useCallback((e) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onLongPress(e), ms);
  }, [onLongPress, ms]);
  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  return { onTouchStart: start, onTouchEnd: cancel, onTouchMove: cancel, onTouchCancel: cancel };
}
