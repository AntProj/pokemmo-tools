# PokéMMO Tools

A growing toolbox for PokéMMO players. Built with React + Vite, deployable to GitHub Pages.

## Project Structure

```
pokemmo-tools/
├── data/raw/             ← Raw JSON files (input to data pipeline)
│   └── README.md         ← Where the raw data comes from + how to update
├── scripts/
│   └── build-data.mjs    ← Merges raw files → src/data/pokemmo.json
├── src/
│   ├── data/             ← Processed app data (generated, gitignored)
│   ├── App.jsx           ← Main app component (currently a placeholder)
│   ├── main.jsx          ← React entrypoint
│   └── index.css         ← Tailwind base styles
├── public/               ← Static assets served as-is
├── index.html            ← Vite entrypoint
├── vite.config.js        ← Build config (sets GitHub Pages base path)
└── package.json
```

## First-time setup

```bash
npm install              # install dependencies
npm run build:data       # process raw data → src/data/pokemmo.json
npm run dev              # start dev server (usually http://localhost:5173)
```

The `build:data` step is required at least once before the dev server will work, because `App.jsx` imports `./data/pokemmo.json` which is generated and gitignored.

## What's in the processed data

Running `npm run build:data` produces a single `src/data/pokemmo.json` (~6 MB) with:

- **`pokemon`** — array of all 610 obtainable Pokémon. Each has stats, types, abilities (id+name), evolutions, learnsets (split by level/TM/tutor/egg as just IDs), held items (id+drop chance), legendary/mythical/baby flags, PVP tier, shiny tier/points, sprite URLs, and **encounter locations** (sorted easiest-first with method, region, level range, rarity, time of day)
- **`locations`** — reverse index: `"Region::Location"` → list of mons found there
- **`moves`** — id-keyed catalog of all 559 moves (name, type, power, accuracy, PP, **effect description, effect_chance**)
- **`abilities`** — id-keyed catalog of all 170 abilities (name, **effect description**)
- **`items`** — id-keyed catalog of ~660 relevant items (held items, evo items, berries, balls, vitamins) with English names and descriptions
- **`natures`**, **`egg_groups`**, **`egg_moves`**, **`gender_rates`**, **`pvp`** — pass-through reference data for breeding tools, IV calc, etc.

## Daily development

```bash
npm run dev              # auto-reloads on file changes
```

If you ever update files in `data/raw/`, re-run `npm run build:data` to regenerate.

## Deploying to GitHub Pages

### One-time GitHub setup

1. Create a new repo on GitHub named `pokemmo-tools` (or whatever; just match the `base` in `vite.config.js`).
2. From this folder:
   ```bash
   git init
   git add .
   git commit -m "initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/pokemmo-tools.git
   git push -u origin main
   ```
3. In your GitHub repo go to **Settings → Pages**. Under "Source" pick **Deploy from a branch**, and set branch to **`gh-pages`** (folder: `/ (root)`). Save.

### Update `homepage` and `base`

- In `package.json`, change `homepage` to `https://YOUR_USERNAME.github.io/pokemmo-tools/`
- In `vite.config.js`, the `base` value must match `/your-repo-name/` (already set to `/pokemmo-tools/`)

### Deploy

```bash
npm run deploy
```

This runs `build:data` + `vite build`, then pushes the `dist/` folder to the `gh-pages` branch. After ~1 minute, your site is live at `https://YOUR_USERNAME.github.io/pokemmo-tools/`.

Re-run `npm run deploy` anytime you want to publish updates.

## Updating the encounter / Pokémon data

The data pipeline keeps the React app fully decoupled from the raw source format.

See [`data/raw/README.md`](data/raw/README.md) for the full list of files, where to download them, and the merge strategy.

## Adding a new tool / page later

The current structure is single-page. When you add more tools (moves, breeding, IV calc, team builder, etc.), the typical refactor is:

1. Create a `src/pages/` folder, move the current dex tracker into `src/pages/Encounters.jsx`
2. Add a router (`react-router-dom` with `HashRouter` works best on GitHub Pages — no 404 redirect tricks needed)
3. Add a sidebar/tab nav in `App.jsx`
4. Each new tool reads from the same `src/data/pokemmo.json`

## License

MIT — do whatever you want.
