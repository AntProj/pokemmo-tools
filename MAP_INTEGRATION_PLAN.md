# Unova Map integration — investigation + plan

## Existing app conventions (the source of truth)

After reading the repo, here is what new code must match.

### Build & runtime
- **Build tool**: Vite 5 (`vite.config.js` present; `npm run dev` / `npm run build` / `npm run preview`)
- **Framework**: React 18 with JSX (no TypeScript anywhere — every page is `.jsx`)
- **Package manager**: npm (`package-lock.json` present)
- **Lint**: none configured beyond Vite defaults
- **Deploy target**: GitHub Pages at `https://antproj.github.io/pokemmo-tools/` — `vite.config.js` sets `base: '/pokemmo-tools/'`, so all static asset URLs must respect that base

### Routing
- **Router**: `react-router-dom` v6, **HashRouter** (URLs use `#/...`)
- **Routes are declared in** [src/App.jsx](src/App.jsx) inside a single `<Routes>` block; each `<Route path="..." element={<PageComponent .../>} />` lives at the top level
- Existing routes: `/` (Pokédex), `/search`, `/locations`, `/locations/:region/:location`, `/tracker`, `/catch`, `/breeding`. There's already a working dynamic-param route (`LocationDetail`), so `/map/:mapId` will be a direct fit
- Old URLs are redirected via `<Navigate to=... replace />` — same pattern works if we ever rename a path
- A catch-all `<Route path="*" element={<Navigate to="/" />} />` handles unknown URLs at the bottom

### Page structure
- Every tab is a single `src/pages/*.jsx` file (no subfolders today). Per-page state lives in `App.jsx` and is passed down as props (see `pokedexState`, `searchState`, `locationsState`, `trackerView`)
- Each page accepts `data` (the global `pokemmo.json`), plus `theme` / `onTheme` for the light/dark toggle, plus any page-specific state hooks
- I'll keep this convention: **single file `src/pages/UnovaMap.jsx`** rather than a folder. Helper sub-components live inside the same file (matches `BreedingPlanner.jsx`, `TrackerPlan.jsx` etc., which are 700-1200 LOC each with internal sub-components)

### Styling
- **Tailwind CSS** (configured via `tailwind.config.js` + `postcss.config.js`)
- Warm light-mode palette: card backgrounds `bg-[#fdf8e9]`, borders `border-[#e6dabf]`, hover `bg-[#ece2c4]`. Dark mode uses `bg-stone-900` / `border-stone-800` family. Blue-500 for primary action accents
- Icons via `lucide-react` (already a dep)
- Match: page wrapper is `<main className="max-w-7xl mx-auto px-4 py-4 space-y-4">`; section cards use the `FormCard` pattern (rounded-md border bg p-3)

### Navigation
- **Tabs registered in** [src/components/NavBar.jsx](src/components/NavBar.jsx) as a `TABS` array of `{ to, label }`. Adding a new tab = appending one entry. The bar already uses `NavLink` for active styling

### Shared components (reuse, don't re-invent)
- `NavBar` — the top nav strip
- `TypeBadge`, `RarityBadge`, `PokemonSprite` (just added) — none directly applicable to the map but worth knowing about
- Theme toggle is inline per page (every page accepts `theme` / `onTheme` and renders its own Sun/Moon button). The map page will do the same

### Data location
- **Runtime catalog**: `src/data/pokemmo.json` — imported as an ES module at build time (`import data from './data/pokemmo.json'`)
- **Build inputs**: `data/raw/*.json` — never shipped to the browser; consumed only by `scripts/build-data.mjs`
- **Generator**: `scripts/build-data.mjs` exists already; new generator follows same shape (`#!/usr/bin/env node` ES module, reads from disk, writes deterministic outputs, logs progress)
- **Static assets the app fetches at runtime**: there's currently nothing in `public/` other than `vite.svg`. The map feature introduces this pattern for the first time. Per the prompt: PNGs and bounds files go to `public/data/maps/`, trainer sprites to `public/data/trainers/sprites/`, per-zone event JSONs to `public/data/maps/events/`. With `base: '/pokemmo-tools/'`, runtime URLs will be `/pokemmo-tools/data/maps/...`

## New files I will add

### Generator
- **`scripts/build-map-data.mjs`** — reads from the three Windows absolute paths the prompt specified, emits:
  - `public/data/maps/maps-index.json` (master registry)
  - `public/data/maps/world-regions.json` (clickable world overview regions)
  - `public/data/maps/events/<id>_<name>.events.json` × ~285 (per-zone events, only for zones that have a matching bounds JSON)
  - `public/data/trainers/trainers-catalog.json`
  - Copies PNGs + bounds JSONs + trainer sprites into `public/data/`
  - Idempotent; logs every file written + every zone skipped

### React feature
- **`src/pages/UnovaMap.jsx`** — single-file page (matches existing convention). Internal sub-components: `MapView`, `MarkerLayer`, `InfoPanel`, `WarpPanel` / `TrainerPanel` / `ItemPanel` / `NpcPanel`, plus a `coords` helper at the bottom. Uses Leaflet's `MapContainer` + `ImageOverlay` + `Marker` from `react-leaflet`. CRS is `L.CRS.Simple`
- **Route entries in [src/App.jsx](src/App.jsx)**:
  ```jsx
  <Route path="/map"          element={<UnovaMap data={data} theme={theme} onTheme={setTheme} />} />
  <Route path="/map/:mapId"   element={<UnovaMap data={data} theme={theme} onTheme={setTheme} />} />
  ```
  The single page reads `useParams().mapId` and renders the world overview when missing.
- **Nav entry in [src/components/NavBar.jsx](src/components/NavBar.jsx)**: append `{ to: '/map', label: 'Unova Map' }` to the `TABS` array.

### Dependencies (`package.json`)
- `leaflet`
- `react-leaflet`
- Their CSS imported at the top of `UnovaMap.jsx`: `import 'leaflet/dist/leaflet.css';`

### Docs
- A small "Unova Map" section appended to the README pointing at `MAP_INTEGRATION_PLAN.md` and noting the generator command.

## Coordinate conversion

Per the prompt + my sidecar inspection:

```
pixelX = (worldX  - bounds.minX) / (bounds.maxX - bounds.minX) * imageWidth
pixelY = imageHeight - (-worldZ - bounds.minY) / (bounds.maxY - bounds.minY) * imageHeight
```

Sign-flip on `worldZ`: the raw zone JSONs report `worldZ` in positive units (e.g. 9400), but bounds JSONs have Y range in negatives (e.g. -9736 to -9184). Spot-check: a south-edge warp at raw `worldZ ≈ 9700` should land near the bottom of the rendered PNG (high pixelY close to imageHeight), and a north-edge warp at raw `worldZ ≈ 9200` should land near the top. I'll verify against Striaton City after the first run; if the mirror is wrong, flip the sign.

## Out of scope (per prompt)

- Searching/filtering by name (the underlying ROM extracts have no trainer or item names — `trainerId` and `itemId` are `null` in every raw record). Info panels surface this with explicit "data not available" copy
- Tile pyramids for the 25 MB world map (direct `ImageOverlay` for v1)
- Mobile responsive polish
- Animation between maps
- Encounter / spawn / gym data

## Known data limitations I observed

- Only **4 trainers and 48 items** across all 427 zone JSONs have an entry to surface — the rest are NPCs / signs / warps. The map will still render trainer/item layers; they'll just be sparse
- `trainers.json` keys by `spriteId` (not by trainer instance). The catalog's 174 entries describe **sprite categories**, not individual trainers. When a zone has a trainer at spriteId=74, the panel can show "Trainer sprite #74 — appears in N zones" plus the sprite image
- Item entities have a `spriteId` (8000-range = item-shaped placeholder) and `isHidden`, but no `itemId` mapping yet. Panel says "Item identity not available"
- Many zones in raw data don't have a matching PNG in `Pictures/` (e.g., dozens of `Black_City` zone variants). The generator skips zones without bounds and logs them; only the ~285 zones that have rendered maps appear in `maps-index.json`

## Acceptance checklist (from prompt)

1. Generator runs without errors and is idempotent ✓ (will verify)
2. `npm run build` succeeds ✓ (will verify)
3. New "Unova Map" tab in nav ✓
4. `/map` shows world overview with clickable region markers ✓
5. Clicking a region navigates to its detail map ✓
6. Clicking a warp navigates to destination map ✓
7. Clicking a trainer marker opens info panel with sprite ✓
8. Browser back button works ✓ (uses standard `<Link>` and `useNavigate`)
9. Existing tabs continue to work ✓ (no changes outside the new files + 2 small adds)

## File-by-file change list

| File | Action |
|---|---|
| `MAP_INTEGRATION_PLAN.md` | new (this file) |
| `scripts/build-map-data.mjs` | new |
| `public/data/maps/maps-index.json` | generated |
| `public/data/maps/world-regions.json` | generated |
| `public/data/maps/images/*.png` | copied (~285 + 1 world) |
| `public/data/maps/bounds/*.json` | copied |
| `public/data/maps/events/*.events.json` | generated |
| `public/data/trainers/trainers-catalog.json` | generated |
| `public/data/trainers/sprites/*.png` | copied (~157 files) |
| `src/pages/UnovaMap.jsx` | new |
| `src/App.jsx` | add 2 routes |
| `src/components/NavBar.jsx` | add 1 tab entry |
| `package.json` | add `leaflet` + `react-leaflet` |
| `README.md` | append map feature notes |
