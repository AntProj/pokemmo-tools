# CLAUDE.md

Guidance for Claude Code (and other coding agents) working in this repository.

## What this project is

**PokeKit** (full title "PokeKit by TyrAntitar") — a single-page React app (Vite,
deployed to GitHub Pages) that ships a curated, app-ready dataset for the PokéMMO
fan community. It started as a
Pokédex + search and has grown into a small **toolkit**: Pokédex, Locations,
catch Tracker, interactive Maps, a persistent Box, Catch/Damage calculators, a
Team Builder, a Gym & E4 Prep tool, and a Breeding planner — plus a Windows
**desktop app** (Tauri) that adds OCR capture.

The repo is three things glued together:
1. A **data pipeline** (`scripts/*.mjs`) that merges raw sources into generated
   JSON served from `public/data/`.
2. A **React UI** (`src/`) that fetches that JSON at runtime for browse / search
   / filter / calc.
3. A thin **Tauri desktop shell** (`src-tauri/`) that loads the live site and
   adds screen-capture + OCR (the only reason the desktop build exists).

> **Keeping this file honest:** every feature below has a **TODO** line. When you
> finish something on a TODO list, delete it; when you ship a half-built feature,
> add one. This is the map of what's real vs. half-done — don't let it rot.

## Tech stack

- **React 18** + **react-router-dom v7** (`HashRouter` — required for GitHub Pages)
- **Vite 5** as build tool/dev server; pages are `React.lazy` code-split
- **Tailwind CSS 3** (PostCSS + Autoprefixer); dark mode via `dark` class on `<html>`
- **lucide-react** for icons (don't add a second icon library)
- **Leaflet** (react-leaflet) for the interactive maps
- **Tauri v2** (Rust + WebView2) for the Windows desktop shell (`src-tauri/`)
- Vendored **`@smogon/calc` fork** at `vendor/pokemmo-calc` (CJS) for the damage engine
- Pure ESM (`"type": "module"`). **No TypeScript, no test framework, no lint.**

## Repo layout

```
pokemmo-tools/
├── data/raw/                ← Raw JSON inputs to the pipeline (some 16 MB+). README documents each source.
│   ├── gym-teams.json       ← Gym-leader teams (from gym-teams.xlsx; xlsx is gitignored)
│   └── trainers-wiki.json   ← Wiki E4/champions scrape
├── scripts/
│   ├── build-data.mjs       ← Merges raw → public/data/pokemmo.json (the core dataset)
│   ├── build-trainers.mjs   ← gym-teams.json + trainers-wiki.json → public/data/{trainers,gym-cities}.json
│   ├── parse-gym-xlsx.mjs    ← Gym Leader Team Query Form .xlsx → data/raw/gym-teams.json
│   ├── scrape-trainers.mjs   ← pokemmo.fandom.com {{trainerentry}} → data/raw/trainers-wiki.json
│   ├── merge-trainer-teams.mjs ← Scribe export → public/data/maps/<region>/trainer-instances.json
│   ├── build-map-data.mjs    ← (needs POKEMMO_MAPS_DIR) builds a region's map data
│   ├── upload-maps-to-r2.mjs ← pushes map images/tiles to Cloudflare R2
│   ├── deploy-gh-pages.mjs   ← worktree-based gh-pages publish (Windows-safe)
│   └── prune-dist-for-gh-pages.mjs
├── src/
│   ├── App.jsx              ← Routes, theme/view state, lifted page state, modal owner, data fetch
│   ├── pages/               ← One file per tab (see Features below)
│   ├── components/          ← NavBar, Modal, PokemonModal, pickers, cards, TypeBadge, …
│   ├── hooks/               ← useEscapeAndScrollLock, …
│   └── lib/                 ← format.js, types.js, box.js, teams.js, teamAnalysis.js, damage.js,
│                              trainerScribe.js, navConfig.js, monFilters.js
├── vendor/pokemmo-calc/     ← Vendored CJS @smogon/calc fork (PokéMMO mechanics). See NOTICE.md.
├── src-tauri/               ← Tauri desktop shell: capture.rs, ocr.rs, main.rs, tauri.conf.json, capabilities/
├── public/data/             ← Served as static assets, fetched at runtime (NOT bundled):
│   ├── pokemmo.json         ← Built by build:data (gitignored, ~6.7 MB)
│   ├── trainers.json        ← Built by build:trainers (committed)
│   ├── gym-cities.json      ← Built by build:trainers (committed)
│   └── maps/<region>/       ← maps-index, trainer-instances, zone graphs; images/tiles on R2 (gitignored)
├── vite.config.js           ← base '/PokeKit/' (web) or './' (Tauri); CJS interop for vendor/
└── package.json
```

## Common commands

```bash
npm install
npm run build:data     # rebuild public/data/pokemmo.json from data/raw/* — REQUIRED before first dev run
npm run build:trainers # rebuild public/data/trainers.json + gym-cities.json from the trainer raw files
npm run dev            # Vite dev server (http://localhost:5173, base /PokeKit/)
npm run build          # vite build → dist/
npm run preview        # preview the built dist/
npm run deploy         # predeploy (build:data + build:trainers + build + prune) → deploy-gh-pages.mjs
npm run desktop:dev    # Tauri dev (Windows; needs Rust toolchain + WebView2 — see DESKTOP.md)
npm run desktop:build  # Tauri release build
```

There is **no lint/typecheck/test**. To "verify" changes:
1. `npm run build:data` if anything under `data/raw/` or `scripts/build-data.mjs` changed.
2. `npm run build:trainers` if the trainer raw files or `build-trainers.mjs` changed.
3. `npm run build` to confirm the app still compiles.
4. **Test production output, not just dev** — `vite preview` (or the Preview MCP).
   Dev uses esbuild; prod uses Rollup. The vendored CJS damage engine behaves
   differently between them (it once threw "exports is not defined" only in
   prod). For anything touching `lib/damage.js` / `vendor/`, verify the preview.

## Features & tabs

Nav is **user-customizable** (`components/NavBar.jsx` + `lib/navConfig.js`):
destinations can be pinned to the bar or tucked in a **More** dropdown, order is
editable, and `devOnly` destinations (Scribe) only show in the desktop app or a
dev build. Adding a destination to `NAV_DESTINATIONS` is all that's needed.

Each tab owns its filter/UI state, lifted into `App.jsx` where it must survive
tab switches. App-wide settings (theme + sprite style) live in a **global
Settings dropdown in the NavBar** (`SettingsMenu`), not in each page's toolbar —
`theme`/`onTheme` are passed to `<NavBar/>`. `theme`/`onTheme` are still threaded
to every page for legacy per-page toggles, but the toolbar no longer renders one.

### Pokédex — `/` · `pages/Pokedex.jsx`
Browse + advanced search merged into one page. The toolbar keeps search, regional
dex, sort, and grid/list view. The advanced **Filters sidebar is always visible**
(no toggle; on lg+ it's `lg:sticky lg:top-[200px]` with its own `overflow-y-auto`
so it scrolls independently of the results) and is the only home for the type
filter (moves×4, abilities, held items, egg groups×2, stat ranges, types AND/OR).
State: `INITIAL_POKEDEX` in
`App.jsx`. Opens the shared `<PokemonModal/>`, whose detail popup now embeds the
**catch calculator** (`components/CatchCalcPanel.jsx`) and puts moves / held
items / encounters / catch calc in collapsible cards. *(The old `Search.jsx` page
was merged in and deleted; `/search` and `/moves` redirect here.)*
Also: per-stat sort options; a card hover toolbar + popup row to **act on a mon**
(add to active Box/Team via `lib/box.js`/`lib/teams.js`, mark caught in Tracker —
handlers live in `App.jsx`, feedback via `lib/toast.js` + `components/Toaster.jsx`,
control in `components/MonActions.jsx`); **side-by-side compare**
(`components/ComparePanel.jsx`, local compare tray, ≤6); and **save/share** —
filter state ↔ URL query (`lib/pokedexParams.js`, live-synced via `useSearchParams`
so the address bar is a shareable link) plus named presets
(`lib/savedSearches.js` + `components/SavedSearches.jsx`). EV yield shows in the
popup profile (`formatEvYield` in `lib/format.js`); compare includes movepools.
Evolution labels resolve id-valued params: `LEVEL_WITH_MONSTER` `val` is the
partner's dex id, NOT a level — `enrichEvoMethod` in `PokemonModal.jsx` resolves
it (Mantyke → Mantine needs Remoraid).
- **TODO:** quick actions/compare are hover-only in the grid (not list view / touch).

### Locations — `/locations/:region?/:location?` · `pages/Locations.jsx`
Reverse index `"Region::Location"` → mons. Location opens as a modal over the
grid (deep-linkable). "View on map" links into the Maps tab.
- **TODO:** none tracked.

### Tracker — `/tracker` · `pages/Tracker.jsx`
Catch tracking (caught/uncaught per mon) + a planning view. Mon-attribute
filters shared with `lib/monFilters.js`. Persists to `localStorage` `tracker:state`
(debounced). JSON import merges.
- **TODO:** none tracked.

### Maps — `/map/:region(/:zoneId)` · `pages/RegionMap.jsx`
Leaflet interactive region maps: overworld + per-zone detail, zone jump picker,
cross-zone pathfinding/walkability, trainer-NPC markers, gym-city → Prep links.
Tiles/images are hosted on **Cloudflare R2** (absolute URLs in the maps index),
built by `build-map-data.mjs` and pushed with `upload:maps`.
- **TODO:**
  - Only **Sinnoh** and **Johto** have map data. Kanto / Hoenn / Unova not built.
  - Trainer-NPC `team`/`rewardAmount` are **empty** for route trainers (await OCR
    via Scribe). Only Sinnoh/Johto have NPC catalogs at all.
  - Gym leaders aren't datamined NPCs, so they're surfaced via the gym-city → Prep
    link rather than as map markers. E4/champion locations aren't linked yet.

### Box — `/box` · `pages/Box.jsx` · `lib/box.js`
Persistent collection of owned mons. Named boxes (PokéMMO-style, store **v3**),
grid view, Pokédex-style filters, JSON import/export. The **desktop app** can OCR
a mon-summary screenshot to add a mon (gender via channel-dominance, shiny/alpha
via hue + calibration). Consumed by Breeding (owned-breeders) and Team/Prep
(counters). `localStorage` `pokemmo:box`.
- **TODO:**
  - OCR add is **desktop-only**; web users import JSON. Gender/shiny/alpha
    detection still has calibration-dependent edge cases.

### Catch Calc — in the Pokédex detail popup · `components/CatchCalcPanel.jsx`
Catch-probability calculator over the dataset (`catch_rate`, ball/status/HP),
ported from c4vv (`lib/catchCalc.js`). **No longer a standalone tab** — it's a
collapsible section inside each Pokémon's detail popup (the mon is pre-selected,
so there's no species picker; the ball list is height-capped to ~5 with scroll).
The old `pages/CatchCalc.jsx` page + `/catch` route were removed; `/catch`
redirects to `/`.
- **TODO:** none tracked.

### Damage Calc — `/damage` · `pages/DamageCalc.jsx` · `lib/damage.js` · `vendor/pokemmo-calc`
Full-parity calc against the vendored PokéMMO `@smogon/calc` fork: bidirectional
results, rolls/KO-chance/recoil, editable types/gender/nature/ability/item/status,
EV-IV-boost grid, current-HP%, per-move BP/type/category/crit, full Field panel
(Singles/Doubles, weather/terrain/rooms/gravity, per-side hazards). Accepts a
`sessionStorage 'pokemmo:calc:prefill'` handoff — a flat set (→ slot 1, Team
Builder) or `{ slot: 2 }` / `{ mon1, mon2 }` (Gym Prep sends the opponent).
- **TODO:**
  - Preset competitive sets + Showdown/import-to-calc (offered, not built).
  - Trainer-mon prefills lack nature/ability/EVs/IVs (sheet doesn't have them) —
    calc applies defaults; results are approximate.

### Team Builder — `/teams` · `pages/TeamBuilder.jsx` · `lib/teams.js` · `lib/teamAnalysis.js`
Up to 6 sets per team; create/rename/delete/duplicate team tabs. Seed by hand or
"From Box". Three analyses computed purely off `pokemmo.json` (no engine import):
defensive weakness chart, offensive coverage, speed tiers. Showdown/PokéPaste +
JSON import/export (round-trip verified). "Test in Calc" hands a set to the
Damage Calc. `localStorage` `pokemmo:teams`.
- **TODO:**
  - No EV/IV optimizer; no "what threatens this team" suggestions yet.

### Gym & E4 Prep — `/trainers` · `pages/TrainerPrep.jsx`
Browse gym leaders / Elite Four / champions by region (data: `public/data/trainers.json`).
Per-trainer detail: team-variant tabs, "Hit them with" (types super-effective vs
the most of their team), "They threaten" move-types, counters from your Box, and
per-mon "Send to Damage Calc" (as the opponent). Deep-linkable via `?open=<id>`
(the map's gym-city link uses this).
- **TODO:**
  - **Sinnoh & Unova Elite Four teams are missing** — neither the gym sheet nor
    the wiki has them. Gym leaders are complete for all 5 regions; E4/champions
    exist only for Kanto/Johto/Hoenn (+ Cynthia). Fill via OCR (Scribe) or a new
    source, then they appear automatically.
  - Gym data is the **post-E4 rematch** teams (high level), not story teams.
  - Abilities are **null** (not in the sheet); no EV/IV/nature per mon.
  - No type-specialty label per gym; no "is your team ready?" check.

### Breeding — `/breeding` · `pages/BreedingPlanner.jsx` · `lib/breeding/optimizer.js`
Breeding optimizer: target IV/nature → breeding-step tree, recipe/cost breakdown,
carrier prices, egg moves + hidden ability. **Inventory-first**: pick your boxes
in the form sidebar and the single Plan outline combines the mons you own with
the carriers you'd still buy/breed, and shows from-scratch → with-boxes savings.
Each owned mon is used **exactly once** — `planWithInventory` does iterative
pin-and-resolve (pin the most valuable owned leaf as a $0 override, drop that
mon, re-solve) so plans never over-use a single mon (e.g. one Ditto as three)
and stay feasible. The buy-optimal solve (`planBreeding`, no inventory) is the
from-scratch reference; `ownedMatch` shapes the tree, `matchInventory` is the
older single-tree overlay (now unused by the page).
- **TODO:**
  - The consume-once assignment is greedy (most-valuable owned leaf first); in
    rare cases the result can cost marginally more than the true optimum.
  - Volt Tackle / Incense babies not modelled.

### Trainer Scribe — `/scribe` · `pages/TrainerScribe.jsx` · `lib/trainerScribe.js`  *(dev-only)*
OCR authoring tool (desktop / dev builds only). Calibrate screen regions (battle
log, opponent HP-bar, route), record a battle, and it parses the log into a
trainer-team observation that accretes across battles. Export merges into a
region's `trainer-instances.json` via `merge-trainer-teams.mjs`. `localStorage`
`pokemmo:trainerscribe` + `pokemmo:scribe:regions`.
- **TODO:**
  - Route-trainer story teams are uncollected (the catalogs ship empty). This is
    the slow, manual path; only Sinnoh/Johto catalogs exist.
  - Crowdsourced contribution (Worker + daily consensus) is **on hold** (reverted).
  - The `parseBattleLog` parser is pure — could ingest a screen recording / a
    folder of screenshots instead of live capture (not built).

### Desktop app — `src-tauri/`  *(Windows)*
Thin Tauri shell whose window points at the **live site**, so the web deploy and
the desktop app stay in sync automatically. Adds `Windows.Graphics.Capture` /
`PrintWindow` capture + `Windows.Media.OCR`, a global hotkey, and a toast. All
capture features are gated on `window.__TAURI__`, so the same build is a plain
website in a browser.
- **TODO:**
  - Windows-only. Remote-IPC capture path needs verification on a real local build.

## Data pipeline

Generated data lives in `public/data/` (served as static assets, **fetched at
runtime** — `App.jsx` fetches `${import.meta.env.BASE_URL}data/pokemmo.json`).

**Core dataset — `build-data.mjs` → `public/data/pokemmo.json`** merges:
1. **PokeMMO Hub** (current game state: stats, moves, abilities, evolutions,
   encounter locations) — authoritative; **Hub wins on overlap**.
2. **PokeMMOZone / PokeAPI-derived** — English text only (effect/ability/item
   descriptions, flags) — fills fields the Hub lacks.

`pokemmo.json` shape: `pokemon[]` (stats, types, abilities, evolutions, learnsets
by source as IDs, held items, flags, PVP/shiny tiers, **`yields` incl. EV yields**,
`catch_rate`, sprites, encounter `locations` easiest-first), `locations` reverse
index, id-keyed `moves` / `abilities` / `items`, plus `natures` / `egg_groups` /
`egg_moves` / `gender_rates` / `pvp`, and `meta`.

**Trainer data — `build-trainers.mjs` → `public/data/{trainers,gym-cities}.json`**
merges two id-mapped raw sources:
- `parse-gym-xlsx.mjs` → `data/raw/gym-teams.json` — gym leaders, all 5 regions
  (incl. Sinnoh), from the community "Gym Leader Team Query Form" `.xlsx` (the
  48 MB source is gitignored; download per `data/raw/README.md`).
- `scrape-trainers.mjs` → `data/raw/trainers-wiki.json` — E4/champions/rivals from
  pokemmo.fandom.com (CC-BY-SA; no Sinnoh).

**Maps** (`build-map-data.mjs`, `upload-maps-to-r2.mjs`) are gated behind
`POKEMMO_MAPS_DIR` and R2 creds in `.env.local`. The upstream datamine that
produces the map + trainer scaffolds is `build_world.py` (in the user's local
"Pokemmo Maps" folder, **not** in this repo).

## Routing & top-level state (`App.jsx`)

Routes: `/` (Pokédex), `/locations/:region?/:location?`, `/tracker`, `/box`,
`/damage`, `/teams`, `/trainers`, `/breeding`, `/scribe` (dev-only),
`/map/sinnoh(/:zoneId)`, `/map/johto(/:zoneId)`; `/map` → sinnoh; `/search` &
`/moves` & `/catch` → `/` (Catch Calc is now in the Pokédex popup); `*` → `/`.
**`HashRouter` is intentional** (GH Pages SPA support).

Lifted state in `App.jsx`: `view`, `theme`, `pokedexState`, `locationsState`,
`trackerView`/`trackerState`, `boxStore`, `teamsStore`, `selectedId`. Stores load
from / save to `localStorage` via their lib modules.

**localStorage keys** (namespace new ones `pokemmo:` and centralize): `pokemmo:view`,
`pokemmo:theme`, `pokemmo:spriteMode` (`3d`|`still`, global Settings menu),
`pokemmo:box` (v3), `pokemmo:teams`, `pokemmo:nav`, `pokemmo:trainerscribe`,
`pokemmo:scribe:regions`, `tracker:state`. **sessionStorage:**
`pokemmo:calc:prefill` (one-shot calc handoff).

## Conventions to follow

- **Prefer extending** an existing lib/component over new files.
- **Stat keys** are always `hp | attack | defense | sp_attack | sp_defense | speed`
  (`STAT_ORDER` in `lib/format.js`). **Region keys** are lowercase
  `kanto | johto | hoenn | sinnoh | unova` (`regionKey()` normalizes UI labels).
- **Components are presentational**; pages own state and pass setters down. **No
  state-management library** — lifted state is deliberate.
- **Tailwind only.** **lucide-react** only. **Explicit `.jsx`/`.js`** extensions.
- **Global look is app-wide CSS** in `src/index.css`: `color-scheme` (light/dark)
  + custom `::-webkit-scrollbar` and `scrollbar-color` theme native controls and
  scrollbars to the parchment/stone palette everywhere. Transient feedback uses the
  global toast (`lib/toast.js` + `components/Toaster.jsx`), not per-page banners.
  See the **Global** section in `features.md` for cross-cutting standards.
- **Data goes through the pipeline** — don't import `data/raw/*` into components;
  everything is fetched from `public/data/`.

## Performance notes

- `pokemmo.json` (~6.7 MB) is **fetched once at runtime**, not bundled. Don't add
  more whole-dataset imports; code-split a secondary blob (as Prep does with
  `trainers.json`, Box with its store, etc.).
- Heavy pages (RegionMap/Leaflet, BreedingPlanner, DamageCalc engine) are
  `React.lazy`. `vite.config.js` sets `chunkSizeWarningLimit: 3000` for the
  vendored calc chunk — don't lower without a plan.
- Filter/index work uses `useMemo` keyed on inputs — preserve it.

## Deploy

GitHub Pages from the `gh-pages` branch via the custom **`scripts/deploy-gh-pages.mjs`**
(worktree + single `git rm -rf .`, to dodge Windows' argv length cap that the
`gh-pages` npm package hits with thousands of map files). `predeploy` runs
`build:data && build:trainers && build && prune-dist-for-gh-pages.mjs`.

The desktop app loads the **live site**, so `npm run deploy` updates both the web
app and the desktop app — no Tauri rebuild needed for non-capture changes.

Deploy-sensitive values: `vite.config.js` `base: '/PokeKit/'` (web, case-sensitive) and the
repo name. (`package.json` `homepage` is still the `YOUR_GITHUB_USERNAME`
placeholder — harmless, the deploy uses the git remote; fix if you care.)

## Things to NOT do

- Don't commit `public/data/pokemmo.json` or `data/raw/*.xlsx` — gitignored.
- Don't switch to `BrowserRouter` (breaks GH Pages).
- Don't add TypeScript piecemeal, a state library, or a second icon library.
- Don't "verify" a `lib/damage.js` / `vendor/` change on the dev server alone —
  test the production preview (dev esbuild ≠ prod Rollup for the CJS engine).
- Don't bypass the data pipeline by importing raw files into components.

## Useful entry points

- Dataset shape → header + output blocks of `scripts/build-data.mjs`.
- Trainer data shape → `scripts/build-trainers.mjs` and `data/raw/README.md`.
- Pokémon detail UI → `components/PokemonModal.jsx`. Shared overlay → `components/Modal.jsx`.
- Type math / analyses → `lib/teamAnalysis.js`. Damage engine wrapper → `lib/damage.js`.
- Nav customization → `lib/navConfig.js` + `components/NavBar.jsx`.
