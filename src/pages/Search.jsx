import { useCallback, useMemo, useState } from 'react';
import { Search as SearchIcon, ChevronDown } from 'lucide-react';
import Toolbar from '../components/Toolbar.jsx';
import PokemonCard from '../components/PokemonCard.jsx';
import MovePicker from '../components/MovePicker.jsx';
import TypeFilter from '../components/TypeFilter.jsx';
import AbilityPicker from '../components/AbilityPicker.jsx';
import HeldItemPicker from '../components/HeldItemPicker.jsx';
import EggGroupFilter from '../components/EggGroupFilter.jsx';
import StatRangeSliders from '../components/StatRangeSliders.jsx';
import FilterChips from '../components/FilterChips.jsx';
import MatchModeToggle from '../components/MatchModeToggle.jsx';
import TypeBadge from '../components/TypeBadge.jsx';
import { typeColor } from '../lib/types.js';
import { statTotal } from '../lib/format.js';
import { Plus, X } from 'lucide-react';

/* ─────────────── Index helpers ─────────────── */

// Map raw learn_method values from the data file into a display label and a
// priority used to pick the "best" method when a Pokémon can learn the same
// move multiple ways. Lower number = preferred.
const METHODS = [
  { match: ['level'],                       label: 'Lv',  priority: 1 },
  { match: ['move_learner_tools'],          label: 'TM',  priority: 2 },
  { match: ['move_tutor', 'special_moves'], label: 'Tut', priority: 3 },
  { match: ['egg_moves',  'special_egg'],   label: 'Egg', priority: 4 },
  { match: ['on_evolution', 'prevo_moves'], label: 'Evo', priority: 5 },
];
function classifyMethod(raw) {
  for (const m of METHODS) if (m.match.includes(raw)) return m;
  return null;
}

const STAT_KEYS = ['hp', 'attack', 'defense', 'sp_attack', 'sp_defense', 'speed'];

function buildIndex(pokemonList) {
  const byMove      = new Map();   // moveId      → Set<pokemonId>
  const byAbility   = new Map();   // abilityId   → Set<pokemonId>
  const byEggGroup  = new Map();   // slug        → Set<pokemonId>
  const byType      = new Map();   // type lower  → Set<pokemonId>
  const byHeldItem  = new Map();   // itemId      → Set<pokemonId>
  const heldItemNames = new Map(); // itemId      → name (deduped pretty list)
  const bestMethod  = new Map();   // pid → Map<moveId, {label, priority}>
  const eggGroupSet = new Set();
  const stat = {};
  for (const k of STAT_KEYS) stat[k] = { min: Infinity, max: -Infinity };
  let bstMin = Infinity, bstMax = -Infinity;

  for (const p of pokemonList) {
    // moves + best method
    if (p.moves) {
      let perPoke = bestMethod.get(p.id);
      if (!perPoke) { perPoke = new Map(); bestMethod.set(p.id, perPoke); }
      for (const bucket of Object.keys(p.moves)) {
        for (const e of (p.moves[bucket] || [])) {
          const cls = classifyMethod(e.learn_method);
          if (!cls) continue;
          if (!byMove.has(e.id)) byMove.set(e.id, new Set());
          byMove.get(e.id).add(p.id);
          const cur = perPoke.get(e.id);
          if (!cur || cls.priority < cur.priority) perPoke.set(e.id, cls);
        }
      }
    }
    // abilities
    for (const a of (p.abilities || [])) {
      if (a.id == null) continue;
      if (!byAbility.has(a.id)) byAbility.set(a.id, new Set());
      byAbility.get(a.id).add(p.id);
    }
    // egg groups
    for (const g of (p.egg_groups || [])) {
      const slug = String(g).toLowerCase();
      eggGroupSet.add(slug);
      if (!byEggGroup.has(slug)) byEggGroup.set(slug, new Set());
      byEggGroup.get(slug).add(p.id);
    }
    // types
    for (const t of (p.types || [])) {
      const tk = String(t).toLowerCase();
      if (!byType.has(tk)) byType.set(tk, new Set());
      byType.get(tk).add(p.id);
    }
    // held items
    for (const h of (p.held_items || [])) {
      if (h.id == null || !h.name) continue;
      if (!byHeldItem.has(h.id)) byHeldItem.set(h.id, new Set());
      byHeldItem.get(h.id).add(p.id);
      if (!heldItemNames.has(h.id)) heldItemNames.set(h.id, h.name);
    }
    // stat bounds
    let bst = 0;
    for (const k of STAT_KEYS) {
      const v = p.stats?.[k] || 0;
      if (v < stat[k].min) stat[k].min = v;
      if (v > stat[k].max) stat[k].max = v;
      bst += v;
    }
    if (bst < bstMin) bstMin = bst;
    if (bst > bstMax) bstMax = bst;
  }

  // Held-item options sorted by name for the picker.
  const heldItemOptions = [...heldItemNames.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    byMove, byAbility, byEggGroup, byType, byHeldItem, bestMethod,
    eggGroupOptions: [...eggGroupSet].sort(),
    heldItemOptions,
    bounds: { ...stat, bst: { min: bstMin, max: bstMax } },
  };
}

function intersect(sets) {
  if (sets.length === 0) return null;
  sets.sort((a, b) => a.size - b.size);
  const [first, ...rest] = sets;
  const out = new Set();
  for (const id of first) if (rest.every((s) => s.has(id))) out.add(id);
  return out;
}
function unionAll(sets) {
  const out = new Set();
  for (const s of sets) for (const id of s) out.add(id);
  return out;
}

/* ─────────────── Page ─────────────── */

export default function Search({ data, state, setState, view, onView, theme, onTheme, onSelect }) {
  const {
    search, types, typesMode,
    selectedMoveIds, movesMode,
    abilityId, heldItemId, eggGroups, eggGroupsMode,
    stats, sort,
  } = state;

  const [pickerSlot, setPickerSlot] = useState(null);

  // Stable single-field setters so children get unchanging callback refs.
  const setField = useCallback((field) => (val) => setState((s) => ({ ...s, [field]: val })), [setState]);
  const setSearch        = useMemo(() => setField('search'),        [setField]);
  const setTypes         = useMemo(() => setField('types'),         [setField]);
  const setTypesMode     = useMemo(() => setField('typesMode'),     [setField]);
  const setMovesMode     = useMemo(() => setField('movesMode'),     [setField]);
  const setAbility       = useMemo(() => setField('abilityId'),     [setField]);
  const setHeldItem      = useMemo(() => setField('heldItemId'),    [setField]);
  const setEggGroups     = useMemo(() => setField('eggGroups'),     [setField]);
  const setEggGroupsMode = useMemo(() => setField('eggGroupsMode'), [setField]);
  const setStats         = useMemo(() => setField('stats'),         [setField]);
  const setSort          = useMemo(() => setField('sort'),          [setField]);

  const setMove = useCallback((slot, id) => setState((s) => {
    const next = s.selectedMoveIds.slice();
    next[slot] = id;
    return { ...s, selectedMoveIds: next };
  }), [setState]);

  // Build index once per dataset.
  const index = useMemo(() => buildIndex(data.pokemon), [data.pokemon]);

  const activeMoveIds = useMemo(() => selectedMoveIds.filter((x) => x != null), [selectedMoveIds]);

  // Has *any* filter been touched? Determines whether to show the empty
  // prompt or run the filter pipeline.
  const hasAnyFilter =
    search.trim().length > 0 ||
    types.length > 0 ||
    activeMoveIds.length > 0 ||
    abilityId != null ||
    heldItemId != null ||
    eggGroups.length > 0 ||
    STAT_KEYS.concat('bst').some((k) => stats[k] != null);

  // The big filter pipeline. Memoized on every input so re-running is cheap.
  const filtered = useMemo(() => {
    if (!hasAnyFilter) return [];
    const q = search.trim().toLowerCase();
    let dexQuery = null;
    if (q) {
      const m = q.replace(/^#/, '').match(/^\d+$/);
      if (m) dexQuery = parseInt(m[0], 10);
    }

    // Build per-category sets and intersect.
    const pools = [];

    if (types.length > 0) {
      const sets = types.map((t) => index.byType.get(t.toLowerCase()) || new Set());
      pools.push(typesMode === 'all' ? intersect(sets) : unionAll(sets));
    }
    if (activeMoveIds.length > 0) {
      const sets = activeMoveIds.map((id) => index.byMove.get(id) || new Set());
      pools.push(movesMode === 'all' ? intersect(sets) : unionAll(sets));
    }
    if (abilityId != null) {
      pools.push(index.byAbility.get(abilityId) || new Set());
    }
    if (heldItemId != null) {
      pools.push(index.byHeldItem.get(heldItemId) || new Set());
    }
    if (eggGroups.length > 0) {
      const sets = eggGroups.map((g) => index.byEggGroup.get(g.toLowerCase()) || new Set());
      pools.push(eggGroupsMode === 'all' ? intersect(sets) : unionAll(sets));
    }

    // pool: intersection of all category pools (= AND across categories).
    let pool = null;
    if (pools.length > 0) {
      pool = pools.reduce((acc, s) => {
        if (s == null) return acc;
        if (acc == null) return s;
        const out = new Set();
        const [small, big] = acc.size < s.size ? [acc, s] : [s, acc];
        for (const id of small) if (big.has(id)) out.add(id);
        return out;
      }, null);
    }

    const out = data.pokemon.filter((p) => {
      if (pool && !pool.has(p.id)) return false;
      if (q) {
        const nameMatch = p.name.toLowerCase().includes(q);
        const dexMatch  = dexQuery != null && p.id === dexQuery;
        if (!nameMatch && !dexMatch) return false;
      }
      // Stat ranges
      for (const k of STAT_KEYS) {
        const r = stats[k];
        if (!r) continue;
        const v = p.stats?.[k] || 0;
        if (v < r[0] || v > r[1]) return false;
      }
      if (stats.bst) {
        const total = statTotal(p.stats);
        if (total < stats.bst[0] || total > stats.bst[1]) return false;
      }
      return true;
    });

    if (sort === 'name') out.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'bst') out.sort((a, b) => statTotal(b.stats) - statTotal(a.stats));
    else out.sort((a, b) => a.id - b.id);

    return out;
  }, [hasAnyFilter, data.pokemon, index, search, types, typesMode,
      activeMoveIds, movesMode, abilityId, heldItemId, eggGroups, eggGroupsMode, stats, sort]);

  /* Active-filter chip descriptors */
  const chips = useMemo(() => buildChipList({
    search, setSearch,
    types, setTypes, typesMode, setTypesMode,
    activeMoveIds, selectedMoveIds, setMove, movesMode, setMovesMode, moves: data.moves,
    abilityId, setAbility, abilities: data.abilities,
    heldItemId, setHeldItem, heldItemOptions: index.heldItemOptions,
    eggGroups, setEggGroups, eggGroupsMode, setEggGroupsMode,
    stats, setStats, bounds: index.bounds,
  }), [search, setSearch, types, setTypes, typesMode, setTypesMode,
       activeMoveIds, selectedMoveIds, setMove, movesMode, setMovesMode, data.moves,
       abilityId, setAbility, data.abilities,
       heldItemId, setHeldItem, index.heldItemOptions,
       eggGroups, setEggGroups, eggGroupsMode, setEggGroupsMode,
       stats, setStats, index.bounds]);

  return (
    <>
      <Toolbar
        search={search} onSearch={setSearch}
        sort={sort}     onSort={setSort}
        view={view}     onView={onView}
        theme={theme}   onTheme={onTheme}
        resultCount={hasAnyFilter ? filtered.length : 0}
      />

      <main className="max-w-7xl mx-auto px-4 py-4 space-y-4">
        {chips.length > 0 && (
          <div className="border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9]/60 dark:bg-stone-900/40 rounded-md p-2">
            <FilterChips chips={chips} />
          </div>
        )}

        <div className="grid lg:grid-cols-[320px_1fr] gap-4 items-start">
          {/* Filter panel */}
          <aside className="lg:sticky lg:top-4 self-start space-y-2">
            <Section title="Types" defaultOpen>
              <TypeFilter
                value={types} mode={typesMode}
                onChange={setTypes} onModeChange={setTypesMode}
              />
            </Section>

            <Section title="Moves" defaultOpen>
              <MoveSection
                moves={data.moves}
                selectedMoveIds={selectedMoveIds}
                matchMode={movesMode}
                onSlotClick={setPickerSlot}
                onSlotClear={(i) => setMove(i, null)}
                onMatchModeChange={setMovesMode}
              />
            </Section>

            <Section title="Ability">
              <AbilityPicker abilities={data.abilities} value={abilityId} onChange={setAbility} />
            </Section>

            <Section title="Held Item">
              <HeldItemPicker options={index.heldItemOptions} value={heldItemId} onChange={setHeldItem} />
            </Section>

            <Section title="Egg Groups">
              <EggGroupFilter
                groups={index.eggGroupOptions}
                value={eggGroups} mode={eggGroupsMode}
                onChange={setEggGroups} onModeChange={setEggGroupsMode}
              />
            </Section>

            <Section title="Base Stats">
              <StatRangeSliders bounds={index.bounds} applied={stats} onApply={setStats} />
            </Section>
          </aside>

          {/* Results */}
          <div className="min-w-0">
            {!hasAnyFilter ? (
              <EmptyPrompt />
            ) : filtered.length === 0 ? (
              <NoMatchesPrompt />
            ) : (
              <div className="grid gap-3
                              grid-cols-2 sm:grid-cols-3 md:grid-cols-3
                              lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {filtered.map((p) => (
                  <PokemonCard
                    key={p.id}
                    pokemon={p}
                    onSelect={onSelect}
                    footer={activeMoveIds.length > 0 ? (
                      <MoveMethodBadges
                        pokemon={p}
                        moveIds={activeMoveIds}
                        moves={data.moves}
                        bestMethod={index.bestMethod}
                      />
                    ) : null}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {pickerSlot != null && (
        <MovePicker
          moves={data.moves}
          currentMoveId={selectedMoveIds[pickerSlot]}
          onPick={(id) => { setMove(pickerSlot, id); setPickerSlot(null); }}
          onClose={() => setPickerSlot(null)}
        />
      )}
    </>
  );
}

/* ─────────────── Small section helpers ─────────────── */

function Section({ title, defaultOpen = false, children }) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-md border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900"
    >
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-bold uppercase tracking-wider text-stone-700 dark:text-stone-300 flex items-center gap-2">
        <ChevronDown size={14} className="transition-transform group-open:rotate-0 -rotate-90 text-stone-400" />
        {title}
      </summary>
      <div className="px-3 pb-3 pt-1">{children}</div>
    </details>
  );
}

/* ─────────────── Move slots (compact) ─────────────── */

function MoveSection({ moves, selectedMoveIds, matchMode, onSlotClick, onSlotClear, onMatchModeChange }) {
  const activeCount = selectedMoveIds.filter((x) => x != null).length;
  return (
    <div className="space-y-2">
      <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
        {selectedMoveIds.map((id, i) => (
          <CompactMoveSlot
            key={i}
            move={id != null ? moves[id] : null}
            onOpen={() => onSlotClick(i)}
            onClear={() => onSlotClear(i)}
          />
        ))}
      </div>
      {activeCount >= 2 && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-stone-500 dark:text-stone-400">Logic</span>
          <MatchModeToggle value={matchMode} onChange={onMatchModeChange} />
        </div>
      )}
    </div>
  );
}

function CompactMoveSlot({ move, onOpen, onClear }) {
  if (!move) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="h-12 rounded-md border-2 border-dashed border-[#d6c8a3] dark:border-stone-700
                   bg-[#fdf8e9]/50 dark:bg-stone-900/40
                   hover:bg-[#ece2c4] dark:hover:bg-stone-800/60
                   text-stone-500 dark:text-stone-400 text-xs font-medium
                   inline-flex items-center justify-center gap-1.5"
      >
        <Plus size={14} /> Add move
      </button>
    );
  }
  const c = typeColor(move.type);
  return (
    <div className="relative h-12 rounded-md border bg-[#fdf8e9] dark:bg-stone-900 px-2 py-1 flex items-center gap-2"
         style={{ borderColor: c.bg }}>
      <button type="button" onClick={onOpen} className="flex-1 min-w-0 text-left" title="Change move">
        <div className="text-xs font-semibold text-stone-900 dark:text-stone-100 truncate">{move.name}</div>
        <div className="mt-0.5"><TypeBadge type={move.type} /></div>
      </button>
      <button
        type="button"
        onClick={onClear}
        className="absolute top-0.5 right-0.5 p-0.5 rounded text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
        title="Remove"
      >
        <X size={12} />
      </button>
    </div>
  );
}

/* ─────────────── Move-method badges (card footer) ─────────────── */

function MoveMethodBadges({ pokemon, moveIds, moves, bestMethod }) {
  const perPoke = bestMethod.get(pokemon.id);
  return (
    <>
      {moveIds.map((id) => {
        const move = moves[id];
        const method = perPoke?.get(id);
        if (!move || !method) return null;
        const c = typeColor(move.type);
        return (
          <span
            key={id}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium
                       bg-[#fdf8e9] dark:bg-stone-800 border"
            style={{ borderColor: c.bg, color: c.bg }}
            title={`${move.name} via ${method.label}`}
          >
            <span className="truncate max-w-[80px]" style={{ color: 'inherit' }}>{move.name}</span>
            <span className="text-stone-500 dark:text-stone-400">·</span>
            <span className="text-stone-700 dark:text-stone-300 font-semibold">{method.label}</span>
          </span>
        );
      })}
    </>
  );
}

/* ─────────────── Empty / no-match prompts ─────────────── */

function EmptyPrompt() {
  return (
    <div className="py-20 text-center">
      <SearchIcon size={36} className="mx-auto mb-3 text-stone-300 dark:text-stone-600" strokeWidth={1.5} />
      <p className="text-stone-600 dark:text-stone-400 text-sm">
        Use the filters to find Pokémon.<br />
        Try searching by move, type, ability, egg group, or stat range.
      </p>
    </div>
  );
}

function NoMatchesPrompt() {
  return (
    <div className="py-16 text-center text-sm text-stone-500 dark:text-stone-400">
      No Pokémon match these filters. Try loosening them.
    </div>
  );
}

/* ─────────────── Active-filter chip builder ─────────────── */

function buildChipList(args) {
  const chips = [];
  const {
    search, setSearch,
    types, setTypes, typesMode, setTypesMode,
    activeMoveIds, selectedMoveIds, setMove, movesMode, setMovesMode, moves,
    abilityId, setAbility, abilities,
    heldItemId, setHeldItem, heldItemOptions,
    eggGroups, setEggGroups, eggGroupsMode, setEggGroupsMode,
    stats, setStats, bounds,
  } = args;

  if (search.trim()) {
    chips.push({ key: 'search', label: `“${search}”`, onRemove: () => setSearch('') });
  }
  for (const t of types) {
    chips.push({ key: `type-${t}`, label: `Type: ${t}`, onRemove: () => setTypes(types.filter((x) => x !== t)) });
  }
  if (types.length >= 2) {
    chips.push({ key: 'types-mode', kind: 'logic', label: `Type match: ${typesMode === 'all' ? 'ALL' : 'ANY'}`,
      onToggle: () => setTypesMode(typesMode === 'all' ? 'any' : 'all') });
  }

  for (const id of activeMoveIds) {
    const m = moves[id];
    if (!m) continue;
    chips.push({
      key: `move-${id}`, label: `Move: ${m.name}`,
      onRemove: () => {
        const slot = selectedMoveIds.indexOf(id);
        if (slot >= 0) setMove(slot, null);
      },
    });
  }
  if (activeMoveIds.length >= 2) {
    chips.push({ key: 'moves-mode', kind: 'logic', label: `Move match: ${movesMode === 'all' ? 'ALL' : 'ANY'}`,
      onToggle: () => setMovesMode(movesMode === 'all' ? 'any' : 'all') });
  }

  if (abilityId != null) {
    const a = abilities[abilityId];
    if (a) chips.push({ key: 'ability', label: `Ability: ${a.name}`, onRemove: () => setAbility(null) });
  }

  if (heldItemId != null) {
    const h = heldItemOptions.find((x) => x.id === heldItemId);
    if (h) chips.push({ key: 'held', label: `Item: ${h.name}`, onRemove: () => setHeldItem(null) });
  }

  for (const g of eggGroups) {
    chips.push({
      key: `egg-${g}`, label: `Egg: ${g}`,
      onRemove: () => setEggGroups(eggGroups.filter((x) => x !== g)),
    });
  }
  if (eggGroups.length >= 2) {
    chips.push({ key: 'egg-mode', kind: 'logic', label: `Egg match: ${eggGroupsMode === 'all' ? 'ALL' : 'ANY'}`,
      onToggle: () => setEggGroupsMode(eggGroupsMode === 'all' ? 'any' : 'all') });
  }

  const STAT_LABELS = { hp: 'HP', attack: 'Atk', defense: 'Def', sp_attack: 'SpA', sp_defense: 'SpD', speed: 'Spe', bst: 'BST' };
  for (const k of Object.keys(STAT_LABELS)) {
    const r = stats[k];
    if (!r) continue;
    chips.push({
      key: `stat-${k}`, label: `${STAT_LABELS[k]}: ${r[0]}–${r[1]}`,
      onRemove: () => setStats({ ...stats, [k]: null }),
    });
  }

  return chips;
}
