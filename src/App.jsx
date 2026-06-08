import { useCallback, useEffect, useMemo, useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import data from './data/pokemmo.json';
import NavBar from './components/NavBar.jsx';
import PokemonModal from './components/PokemonModal.jsx';
import Pokedex from './pages/Pokedex.jsx';
import Search from './pages/Search.jsx';
import Locations from './pages/Locations.jsx';
import LocationDetail from './pages/LocationDetail.jsx';
import Tracker from './pages/Tracker.jsx';
import CatchCalc from './pages/CatchCalc.jsx';
import BreedingPlanner from './pages/BreedingPlanner.jsx';
import RegionMap from './pages/RegionMap.jsx';

const LS = {
  view:    'pokemmo:view',
  theme:   'pokemmo:theme',
  tracker: 'tracker:state',
};

function initialView() {
  if (typeof window === 'undefined') return 'grid';
  const v = localStorage.getItem(LS.view);
  return v === 'list' ? 'list' : 'grid';
}

function initialTheme() {
  if (typeof window === 'undefined') return 'dark';
  const stored = localStorage.getItem(LS.theme);
  if (stored === 'dark' || stored === 'light') return stored;
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
}

// Unified Pokédex state (post Search-merge). Carries every field the merged
// Pokedex page reads — the simple toolbar uses search/region/types/sort, the
// advanced sidebar uses the rest. See src/pages/Pokedex.jsx.
const INITIAL_POKEDEX = {
  search: '', region: 'All', sort: 'dex',
  types: [], typesMode: 'all',
  selectedMoveIds: [null, null, null, null], movesMode: 'all',
  abilityId: null, heldItemId: null,
  eggGroups: [], eggGroupsMode: 'any',
  stats: { hp: null, attack: null, defense: null, sp_attack: null, sp_defense: null, speed: null, bst: null },
};
const INITIAL_LOCATIONS = { search: '', region: 'All', sort: 'region' };
const INITIAL_TRACKER_VIEW = { view: 'plan', planRegion: 'All', planMethods: [], planRarities: [], hideSingles: true,
  // Mark-tab filters:
  //   markBaby           'any' | 'only' | 'exclude'  — gate by pokemon.is_baby
  //   markRarities       [] | string[]               — selected encounter rarities
  //                                                    (e.g. "Special", "Rare").
  //   markRaritiesMode   'only' | 'any'              — 'only': mon's encounters
  //                                                    must all fall within the
  //                                                    selected rarities (i.e. the
  //                                                    mon is found EXCLUSIVELY at
  //                                                    those rarities). 'any': mon
  //                                                    has at least one matching
  //                                                    location. Default 'only' so
  //                                                    selecting "Special" finds
  //                                                    event-only mons.
  //   markEvolutions    [] | string[]                — selected evolution-method
  //                                                    categories ("stone",
  //                                                    "trade", etc.; see
  //                                                    EVOLUTION_CATEGORIES in
  //                                                    TrackerMark.jsx). OR
  //                                                    semantics, matches on
  //                                                    either incoming
  //                                                    pre_evolution or any
  //                                                    outgoing evolution.
  //   markTiers          [] | number[]                — selected hunt tiers
  //                                                    (e.g. [0, 1] for "show
  //                                                    only top-priority").
  //                                                    Multi-select OR semantics.
  //                                                    Source: forums OT-dex
  //                                                    guide (see data/raw/
  //                                                    hunt-tiers.json).
  markSearch: '', markRegion: 'All', markTypes: [], markStates: [], markSort: 'dex',
  markBaby: 'any', markRarities: [], markRaritiesMode: 'only', markEvolutions: [], markTiers: [] };

// Read once from localStorage; default to {} so unlisted ids are 'uncaught'.
function loadTrackerState() {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(LS.tracker);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch { return {}; }
}
const INITIAL_SEARCH = {
  search: '',
  // Advanced type filter — up to 4 types with AND/OR.
  types: [],
  typesMode: 'all',
  // Move filter — up to 4 slots with AND/OR.
  selectedMoveIds: [null, null, null, null],
  movesMode: 'all',
  // Single-select ability id (null = no filter).
  abilityId: null,
  // Single-select held-item id (null = no filter).
  heldItemId: null,
  // Egg group filter — up to 2 with AND/OR (default OR).
  eggGroups: [],
  eggGroupsMode: 'any',
  // Stat ranges — null = unset; otherwise [min, max] inclusive.
  stats: { hp: null, attack: null, defense: null, sp_attack: null, sp_defense: null, speed: null, bst: null },
  sort: 'dex',
};

export default function App() {
  // Persisted across tabs
  const [view, setView]   = useState(initialView);
  const [theme, setTheme] = useState(initialTheme);

  // Page-specific state lifted here so it survives tab switches.
  const [pokedexState, setPokedexState]       = useState(INITIAL_POKEDEX);
  const [searchState, setSearchState]         = useState(INITIAL_SEARCH);
  const [locationsState, setLocationsState]   = useState(INITIAL_LOCATIONS);
  const [trackerView, setTrackerView]         = useState(INITIAL_TRACKER_VIEW);
  const [trackerState, setTrackerStateRaw]    = useState(loadTrackerState);

  // Pokémon detail modal — shared so both pages can open it.
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => { localStorage.setItem(LS.view, view); }, [view]);
  useEffect(() => {
    localStorage.setItem(LS.theme, theme);
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark'); else root.classList.remove('dark');
  }, [theme]);

  // Debounce-write tracker state so rapid toggling (e.g. shift-click bulk
  // marking) doesn't write to disk on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => {
      try { localStorage.setItem(LS.tracker, JSON.stringify(trackerState)); } catch {}
    }, 200);
    return () => clearTimeout(id);
  }, [trackerState]);

  // Mutators: setMonState(id, state) for one mon, setManyMonStates(ids, state)
  // for bulk. We delete keys when state is 'uncaught' to keep storage compact —
  // unlisted ids default to 'uncaught' on read.
  const setMonState = useCallback((id, state) => {
    setTrackerStateRaw((prev) => {
      const next = { ...prev };
      if (!state || state === 'uncaught') delete next[id];
      else next[id] = state;
      return next;
    });
  }, []);
  const setManyMonStates = useCallback((ids, state) => {
    setTrackerStateRaw((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        if (!state || state === 'uncaught') delete next[id];
        else next[id] = state;
      }
      return next;
    });
  }, []);
  // Merge an incoming { id: state } object into the existing tracker state.
  // Used by the JSON import — incoming entries override matching ids; ids
  // not in `incoming` are preserved.
  const mergeTrackerState = useCallback((incoming) => {
    setTrackerStateRaw((prev) => ({ ...prev, ...incoming }));
  }, []);

  const selected = useMemo(
    () => (selectedId != null ? data.pokemon.find((p) => p.id === selectedId) : null),
    [selectedId]
  );
  const handleSelect = useCallback((id) => setSelectedId(id), []);
  const handleClose  = useCallback(() => setSelectedId(null), []);

  return (
    <HashRouter>
      <div className="min-h-screen bg-[#f6efdc] dark:bg-stone-950 text-stone-900 dark:text-stone-100">
        <NavBar />

        <Routes>
          <Route
            path="/"
            element={
              <Pokedex
                data={data}
                state={pokedexState}
                setState={setPokedexState}
                view={view} onView={setView}
                theme={theme} onTheme={setTheme}
                onSelect={handleSelect}
              />
            }
          />
          <Route
            path="/search"
            element={
              <Search
                data={data}
                state={searchState}
                setState={setSearchState}
                view={view} onView={setView}
                theme={theme} onTheme={setTheme}
                onSelect={handleSelect}
              />
            }
          />
          <Route
            path="/locations"
            element={
              <Locations
                data={data}
                state={locationsState}
                setState={setLocationsState}
                theme={theme} onTheme={setTheme}
              />
            }
          />
          <Route
            path="/locations/:region/:location"
            element={<LocationDetail data={data} onSelect={handleSelect} />}
          />
          <Route
            path="/tracker"
            element={
              <Tracker
                data={data}
                trackerState={trackerState}
                setMonState={setMonState}
                setManyMonStates={setManyMonStates}
                mergeTrackerState={mergeTrackerState}
                view={trackerView}
                setView={setTrackerView}
                theme={theme} onTheme={setTheme}
                onSelect={handleSelect}
              />
            }
          />
          <Route
            path="/catch"
            element={
              <CatchCalc
                data={data}
                theme={theme} onTheme={setTheme}
              />
            }
          />
          <Route
            path="/breeding"
            element={
              <BreedingPlanner
                data={data}
                theme={theme} onTheme={setTheme}
                onSelect={handleSelect}
              />
            }
          />
          {/* Region interactive maps. One <RegionMap> component drives both
              regions — the `region` prop selects which data folder it reads
              and how it builds internal links. Each region gets two routes:
              the overworld view and a zone-detail view. */}
          <Route path="/map/sinnoh"           element={<RegionMap region="sinnoh" theme={theme} onTheme={setTheme} />} />
          <Route path="/map/sinnoh/:zoneId"   element={<RegionMap region="sinnoh" theme={theme} onTheme={setTheme} />} />
          <Route path="/map/johto"            element={<RegionMap region="johto"  theme={theme} onTheme={setTheme} />} />
          <Route path="/map/johto/:zoneId"    element={<RegionMap region="johto"  theme={theme} onTheme={setTheme} />} />
          {/* Backwards compatibility for old single-region bookmarks. The
              literal /map/sinnoh and /map/johto routes are matched first
              (Router 7 ranks literals above dynamic params), so /map/:zoneId
              here only catches numeric zone ids from the pre-Johto URL scheme.
              We render Sinnoh directly (component reads zoneId from useParams,
              not from any region-aware path) — the user's URL stays /map/XXXX
              until they click a zone, at which point internal links push them
              onto the new /map/sinnoh/XXXX scheme. */}
          <Route path="/map"             element={<Navigate to="/map/sinnoh" replace />} />
          <Route path="/map/:zoneId"     element={<RegionMap region="sinnoh" theme={theme} onTheme={setTheme} />} />
          {/* Old URL kept working for bookmarks. */}
          <Route path="/moves"  element={<Navigate to="/search" replace />} />
          <Route path="*"       element={<Navigate to="/" replace />} />
        </Routes>

        <PokemonModal
          pokemon={selected}
          data={data}
          onClose={handleClose}
          onSelect={handleSelect}
        />

        <footer className="max-w-7xl mx-auto px-4 py-6 text-xs text-stone-400 dark:text-stone-600 text-center">
          {data.meta.total_pokemon} Pokémon · {data.meta.total_moves} moves · built {new Date(data.meta.built_at).toLocaleDateString()}
        </footer>
      </div>
    </HashRouter>
  );
}
