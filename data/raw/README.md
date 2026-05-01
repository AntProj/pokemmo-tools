# Raw Data

The build pipeline merges two sources to get the best of both:

## Source 1: PokeMMO Hub (current game state)

Used for anything that reflects the *current* state of PokeMMO — the game's encounter tables, learnsets, evolutions, and so on. Stays up-to-date with patches.

| File | Description |
|---|---|
| `monster.json` | Pokémon stats, moves, abilities, evolutions, **wild encounter locations** |

Source: https://github.com/PokeMMO-Tools/pokemmo-hub/tree/main/src/data/pokemmo

## Source 2: PokeMMOZone (English descriptions, PokeAPI-derived)

Used to enrich the raw PokeMMO data with English text — move effect descriptions, ability descriptions, item descriptions, and metadata flags PokeMMO doesn't track. This dataset is archived (last updated July 2025) but stable: PokeMMO doesn't typically change move mechanics, so the English text remains accurate.

| File | Description |
|---|---|
| `pokemon-data.json` | Supplementary Pokémon flags (legendary, mythical, baby, shiny tier, hatch counter, growth rate) |
| `moves-data.json` | Move catalog with **English effect descriptions and effect_chance** |
| `abilities-data.json` | Ability catalog with **English effect descriptions** |
| `item-data.json` | Item catalog with English names and descriptions (filtered at build time to held items, evo items, berries, balls, vitamins) |
| `natures-data.json` | Nature stat boosts/drops |
| `egg-groups-data.json` | Egg group memberships |
| `egg-moves-data.json` | Egg move breeding chains |
| `gender-rates.json` | Gender ratio buckets |
| `pvp-data.json` | PVP tier groupings (UN/UU/NU/OU/UB) |
| `pokemon-sprites.json` | Sprite URLs (default + shiny) |

Source: https://github.com/PokeMMOZone/PokeMMO-Data/tree/main/data

## Merge strategy

Where the sources overlap (Pokémon stats, moves, abilities), the **PokeMMO Hub data wins**. The PokeMMOZone data only contributes fields the PokeMMO Hub data lacks — primarily English text for effects and descriptions.

## Updating the data

To refresh with the latest data from upstream:

1. Download fresh copies of the relevant files from the URLs above
2. Replace them in this folder
3. Run `npm run build:data` from the project root
4. The merged output is written to `src/data/pokemmo.json`

The processed file is what the React app actually imports.
