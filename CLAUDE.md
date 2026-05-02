# CLAUDE.md

Guidance for Claude Code (and other coding agents) working in this repository.

## What this project is

**PokéMMO Tools** — a single-page React app (Vite, deployed to GitHub Pages) that
ships a curated, app-ready dataset for the PokéMMO fan community. The app is a
Pokédex + advanced search built around one large generated JSON file.

The repo is essentially two things glued together:
1. A **data pipeline** (`scripts/build-data.mjs`) that merges multiple raw JSON
   sources into one `src/data/pokemmo.json` (~6 MB).
2. A **React UI** (`src/`) that consumes that JSON for browse/search/filter.

## Tech stack

- **React 18** + **react-router-dom v7** (`HashRouter` — required for GitHub Pages)
- **Vite 5** as build tool/dev server
- **Tailwind CSS 3** (with PostCSS + Autoprefixer)
- **lucide-react** for icons
- **gh-pages** for deploy
- Pure ESM throughout (`"type": "module"` in `package.json`)
- No TypeScript, no test framework currently
- Node script (`scripts/build-data.mjs`) is the only build-time data step

## Repo layout

```
pokemmo-tools/
├── data/raw/                ← Raw JSON inputs to the pipeline (large; some are 16 MB+)
│   └── README.md            ← Where each raw file comes from + how to refresh
├── scripts/
│   └── build-data.mjs       ← Merges raw → src/data/pokemmo.json
├── src/
│   ├── App.jsx              ← Routes, theme/view state, modal owner
│   ├── main.jsx             ← React entrypoint
│   ├── index.css            ← Tailwind base + a few custom rules
│   ├── data/                ← Generated; gitignored
│   │   └── pokemmo.json     ← Built by `npm run build:data`
│   ├── pages/
│   │   ├── Pokedex.jsx      ← Browse: regional dex, type filter, sort
│   │   └── Search.jsx       ← Advanced filter: moves/abilities/items/eggs/stats
│   ├── components/          ← Toolbar, filter pickers, cards, modal, etc.
│   └── lib/
│       ├── format.js        ← Display helpers (dex#, height, weight, evo strings…)
│       └── types.js         ← Type colors / metadata
├── public/                  ← Static assets served as-is (currently empty)
├── index.html               ← Vite entrypoint
├── vite.config.js           ← `base: '/pokemmo-tools/'` for GH Pages
├── tailwind.config.js
├── postcss.config.js
└── package.json
```

## Common commands

```bash
npm install            # install deps
npm run build:data     # rebuild src/data/pokemmo.json from data/raw/* — REQUIRED before first dev run
npm run dev            # Vite dev server (default http://localhost:5173)
npm run build          # vite build → dist/
npm run preview        # preview the built dist/
npm run deploy         # predeploy (build:data + build) → gh-pages -d dist
```

There is **no lint, typecheck, or test command** wired up. If a coding agent is
asked to "verify" changes it should:
1. Run `npm run build:data` if any file under `data/raw/` or `scripts/` changed.
2. Run `npm run build` to confirm the app still builds.
3. (Optional) `npm run preview` to spot-check.

## Data pipeline

`scripts/build-data.mjs` is the heart of this project. It merges:

1. **PokeMMO Hub** (current game state — `monster.json`, `dex.json`)
   - Authoritative for stats, moves, abilities, evolutions, encounter locations.
2. **PokeMMOZone / PokeAPI-derived** files
   - Contribute English text only (effect descriptions, item names, etc.)
   - Files: `pokemon-data.json`, `moves-data.json`, `abilities-data.json`,
     `item-data.json`, `types-data.json`, `natures-data.json`,
     `egg-groups-data.json`, `egg-moves-data.json`, `gender-rates.json`,
     `pvp-data.json`, `pokemon-sprites.json`.

**Merge rule:** where the two sources overlap, **PokeMMO Hub wins** because it
reflects current PokeMMO mechanics. The "old" set only fills in fields the new
one lacks.

**Output shape** (`src/data/pokemmo.json`):

- `pokemon[]` — all 610 obtainable mons. Each entry has stats, types,
  abilities (id + name), evolutions, learnsets bucketed by source
  (level/TM/tutor/egg) as IDs only, held items (id + drop chance),
  legendary/mythical/baby flags, PVP tier, shiny tier/points, sprite URLs,
  and **encounter locations** sorted easiest-first (method, region, level
  range, rarity, time of day).
- `locations` — reverse index `"Region::Location"` → list of mons.
- `moves` — id-keyed catalog (~559) with name, type, power, accuracy, PP,
  effect description, effect_chance.
- `abilities` — id-keyed catalog (~170) with name + effect description.
- `items` — id-keyed catalog (~660 relevant items) — held, evo, berries,
  balls, vitamins.
- `natures`, `egg_groups`, `egg_moves`, `gender_rates`, `pvp` — reference
  passthroughs used by future breeding / IV / team-builder tools.
- `meta` — `total_pokemon`, `total_moves`, `built_at` ISO timestamp.

**Rarity ranking** for "easiest to find" sort lives at the top of
`build-data.mjs` in the `RARITY_WEIGHT` table. Hordes count as easier
than their nominal rarity because they yield 5 mons per battle. Lures
are highest because they're a guaranteed encounter.

**Location name normalization** — PokeMMO data mixes SHOUTED CASE and
Title Case names. `normalizeLocation()` Title-Cases the SHOUTED ones while
preserving abbreviations (TM, HM, roman numerals).

## Routing & top-level state

`App.jsx` owns:
- `view` ('grid' | 'list') and `theme` ('dark' | 'light') — both persisted to
  `localStorage` under `pokemmo:view` and `pokemmo:theme`.
- `pokedexState` and `searchState` — page-specific state lifted to App so it
  survives tab switches without being lost on unmount.
- `selectedId` — currently-open Pokémon for the shared `<PokemonModal />`.

Routes:
- `/` → `Pokedex` (regional dex, simple filters)
- `/search` → `Search` (advanced filters: moves×4, abilities, held items,
  egg groups×2, stat ranges, type filter with AND/OR mode toggles)
- `/moves` → redirects to `/search` (kept for old bookmarks)
- `*` → redirects to `/`

`HashRouter` is intentional — GitHub Pages doesn't support SPA fallbacks
without a 404.html hack, and HashRouter avoids that entirely.

## Conventions to follow

- **No new files unless needed.** Prefer extending `lib/format.js` or an
  existing component over creating new ones.
- **Filter state shape** lives in `App.jsx` (`INITIAL_POKEDEX`, `INITIAL_SEARCH`).
  When adding a filter, update the initial constant, the page's filter logic,
  and the `Toolbar` / picker component as a set.
- **Components are presentational + uncontrolled-ish.** Pages own filter state
  and pass setters down. Don't introduce a state library; the lifted-state
  pattern is deliberate.
- **Stat keys** are always: `hp`, `attack`, `defense`, `sp_attack`,
  `sp_defense`, `speed`. `STAT_ORDER` in `lib/format.js` is the canonical order.
- **Region keys** are `kanto | johto | hoenn | sinnoh | unova` (lowercase).
  `regionKey()` in `lib/format.js` normalizes UI labels.
- **Move learn methods** are bucketed in `Search.jsx` via the `METHODS` table:
  `level | move_learner_tools | move_tutor | special_moves | egg_moves |
  special_egg | on_evolution | prevo_moves`. Lower priority number wins
  when a Pokémon learns the same move multiple ways.
- **Tailwind only.** No CSS modules, no styled-components. Dark mode uses
  the `dark:` variant driven by a `dark` class on `<html>`.
- **Icons:** lucide-react. Don't add a second icon library.
- **No localStorage abuse** — currently only `pokemmo:view` and `pokemmo:theme`
  are stored. If adding more, namespace with the `pokemmo:` prefix and
  centralize the keys (see the `LS` object in `App.jsx`).
- **Imports use explicit `.jsx` / `.js` extensions** (Vite + ESM).

## Performance notes

- `src/data/pokemmo.json` is ~6 MB and imported synchronously. Don't add more
  whole-dataset imports; if a future tool needs another big blob, code-split it.
- `vite.config.js` sets `chunkSizeWarningLimit: 3000` precisely because of the
  data import. Don't lower it without a plan.
- Filter functions in `Pokedex.jsx` and `Search.jsx` use `useMemo` keyed on
  the filter inputs. Preserve this when editing — re-filtering 610 mons on
  every keystroke is fine, but rebuilding indexes (see `buildIndex` in
  `Search.jsx`) is not.

## Deploy

GitHub Pages from the `gh-pages` branch via `gh-pages -d dist`. The two
deploy-sensitive values are:

- `package.json` → `homepage` (currently a placeholder
  `https://YOUR_GITHUB_USERNAME.github.io/pokemmo-tools/`)
- `vite.config.js` → `base: '/pokemmo-tools/'`

Both must match the repo name. If renaming the repo, update both.

## When making changes

- **UI tweak:** edit components/pages, `npm run dev`, eyeball it.
- **New filter:** update `INITIAL_SEARCH` in `App.jsx`, add the picker
  component, wire it in `Search.jsx` and the `Toolbar`. Make sure the
  `FilterChips` component reflects the new filter for the "remove" UX.
- **New data field on a Pokémon:** add it in `scripts/build-data.mjs`
  (in the `assemblePokemon` / merge block), re-run `npm run build:data`,
  consume it in components.
- **New raw data source:** add the file under `data/raw/`, document it in
  `data/raw/README.md`, load + merge it in `build-data.mjs`. Remember the
  merge precedence rule (Hub wins on overlap).
- **New page/route:** create `src/pages/Foo.jsx`, add a `<Route>` in
  `App.jsx`, add a nav item in `components/NavBar.jsx`. Lift any
  cross-tab state into `App.jsx` like the existing pages do.

## Things to NOT do

- Don't commit `src/data/pokemmo.json` — it's gitignored and regenerated.
- Don't switch to `BrowserRouter` — it breaks GH Pages without a 404 hack.
- Don't add TypeScript piecemeal — either a full migration in its own PR or
  not at all.
- Don't add a state-management library — lifted state is sufficient at this
  scale.
- Don't bypass the data pipeline by importing raw files directly into React
  components. Everything goes through `src/data/pokemmo.json`.

## Useful entry points when reading the code

- Want to understand the data shape? → top of `scripts/build-data.mjs` (header
  comment) and the output blocks at the bottom of that file.
- Want to understand the search/filter logic? → `src/pages/Search.jsx`
  (`buildIndex`, then the filter `useMemo`).
- Want to understand display helpers? → `src/lib/format.js`.
- Want to understand the Pokémon detail UI? → `src/components/PokemonModal.jsx`
  (the largest component, ~25 KB).
