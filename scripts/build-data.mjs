#!/usr/bin/env node
/**
 * build-data.mjs
 *
 * Merges two data sources into a single app-ready dataset:
 *
 *   1. PokeMMO Hub (current game state)
 *      - monster.json       — Pokémon stats, moves, abilities, evolutions, locations
 *
 *   2. PokeMMOZone (PokeAPI-derived, English effect descriptions)
 *      - pokemon-data.json   — supplementary fields (legendary flag, PVP tier, shiny tier, etc.)
 *      - moves-data.json     — move effects + effect_chance
 *      - abilities-data.json — ability effect descriptions
 *      - item-data.json      — item English names + descriptions
 *      - types-data.json     — type chart
 *      - natures-data.json   — nature stat boosts/drops
 *      - egg-groups-data.json — egg group memberships
 *      - egg-moves-data.json — egg move breeding chains
 *      - gender-rates.json   — gender ratios
 *      - pvp-data.json       — PVP tier groupings
 *      - pokemon-sprites.json — sprite URLs (default + shiny)
 *
 * Strategy: Where the two sources overlap (Pokémon stats, moves, abilities), the
 * NEW PokeMMO Hub data wins because it reflects current PokeMMO mechanics. The OLD
 * dataset only contributes fields the NEW one lacks — primarily English text.
 *
 * Output: src/data/pokemmo.json (everything the React app needs in one file)
 *
 * Run with:  npm run build:data
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RAW = path.join(ROOT, 'data', 'raw');
const OUT_DIR = path.join(ROOT, 'src', 'data');
const OUT_FILE = path.join(OUT_DIR, 'pokemmo.json');

// ---------- Rarity weights for "easiest to find" ranking ----------
// Approximate per-encounter probabilities, used purely for ranking. Higher = easier.
const RARITY_WEIGHT = {
  'Very Common': 0.40,
  'Common':      0.20,
  'Uncommon':    0.10,
  'Rare':        0.05,
  'Very Rare':   0.01,
  'Horde':       0.30, // hordes are uncommon spawns but yield 5 mons per battle
  'Lure':        0.50, // guaranteed encounter when using a Lure item
  'Special':     0.02, // tile-specific (Feebas), shadow, dust cloud, bubble, etc.
};

function rarityTier(rarity) {
  if (rarity === 'Very Common') return 'very-common';
  if (rarity === 'Common' || rarity === 'Lure' || rarity === 'Horde') return 'common';
  if (rarity === 'Uncommon') return 'uncommon';
  if (rarity === 'Rare') return 'rare';
  return 'very-rare';
}

// ---------- Location name normalization ----------
// PokeMMO data has both SHOUTED ("VIRIDIAN FOREST") and Title Case ("Mt. Silver Cave")
// names. Normalize the SHOUTED ones to Title Case.
function normalizeLocation(name) {
  if (!name) return name;
  const letters = name.split('').filter(c => /[a-z]/i.test(c));
  if (!letters.length) return name.trim();
  const upperRatio = letters.filter(c => c === c.toUpperCase()).length / letters.length;
  if (upperRatio > 0.7) {
    return name.split(' ').map(w => {
      if (/^(TM|HM|[IVX]+|[A-Z])$/.test(w)) return w; // preserve abbreviations
      if (/^\d/.test(w)) return w;                     // preserve numerics
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }).join(' ').trim();
  }
  return name.trim();
}

// Title-case a slug ("body-slam" → "Body Slam", "will-o-wisp" → "Will-O-Wisp")
function titleSlug(slug) {
  if (!slug) return slug;
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// ---------- Loader ----------
function loadJson(name, required = true) {
  const p = path.join(RAW, name);
  if (!fs.existsSync(p)) {
    if (required) {
      console.error(`✗ Missing required file: data/raw/${name}`);
      process.exit(1);
    }
    return null;
  }
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

// ============================================================================
// MAIN BUILD
// ============================================================================
function build() {
  console.log('► Loading raw data...');

  // NEW (PokeMMO Hub current data)
  const monsters = loadJson('monster.json');

  // PokeMMO Hub regional dex numbers
  const dexData = loadJson('dex.json', false) || [];
  const dexById = Object.fromEntries(dexData.map(d => [d.id, d]));

  // OLD (PokeMMOZone supplementary data) — all optional
  const oldPokemon = loadJson('pokemon-data.json', false) || {};
  const oldMoves = loadJson('moves-data.json', false) || {};
  const oldAbilities = loadJson('abilities-data.json', false) || {};
  const oldItems = loadJson('item-data.json', false) || {};
  const oldNatures = loadJson('natures-data.json', false) || {};
  const oldEggGroups = loadJson('egg-groups-data.json', false) || {};
  const oldEggMoves = loadJson('egg-moves-data.json', false) || {};
  const oldGender = loadJson('gender-rates.json', false) || {};
  const oldPvp = loadJson('pvp-data.json', false) || {};
  const oldSprites = loadJson('pokemon-sprites.json', false) || {};

  console.log('► Building lookup tables...');

  // ---- Sprites: name (lowercase) → { default, shiny } ----
  const spritesByName = {};
  for (const [name, entry] of Object.entries(oldSprites)) {
    spritesByName[name.toLowerCase()] = {
      default: entry?.sprites?.front_default || null,
      shiny: entry?.sprites?.front_shiny || null,
    };
  }

  // ---- Moves: id → enriched move object ----
  // OLD `moves-data.json` is a dict keyed by slug ("body-slam"). Build an id-keyed
  // lookup so we can join move data into each Pokémon's learnset.
  const movesById = {};
  for (const [slug, m] of Object.entries(oldMoves)) {
    if (!m || typeof m !== 'object') continue;
    movesById[m.id] = {
      id: m.id,
      name: m.name_translations?.en?.name || titleSlug(m.name),
      slug: m.name,
      type: (m.type || '').toUpperCase(),
      damage_class: (m.damage_class || '').toUpperCase(), // PHYSICAL/SPECIAL/STATUS
      power: m.power || 0,
      accuracy: m.accuracy ?? null, // null = always hits
      pp: m.pp || 0,
      priority: m.priority || 0,
      effect: m.effect || '',
      effect_chance: m.effect_chance ?? null,
    };
  }

  // ---- Abilities: id → { name, effect } ----
  const abilitiesById = {};
  for (const [slug, a] of Object.entries(oldAbilities)) {
    if (!a || typeof a !== 'object') continue;
    abilitiesById[a.id] = {
      id: a.id,
      name: titleSlug(a.name),
      slug: a.name,
      effect: a.effect || '',
    };
  }

  // ---- Items: id → { name, description } ----
  // OLD item-data is huge (1909 items). Filter to held items, evolution items,
  // berries, balls, vitamins — items players actually care about.
  const KEEP_ITEM_KEYWORDS = [
    'ball', 'berry', 'stone', 'fossil', 'orb', 'plate', 'gem', 'incense',
    'mail', 'scarf', 'band', 'specs', 'lens', 'leftover', 'bright', 'amulet',
    'belt', 'cell', 'charcoal', 'magnet', 'metal', 'miracle', 'mystic',
    'never', 'poison', 'sharp', 'silk', 'silver', 'soft', 'spell', 'twisted',
    'wave', 'pixie', 'dragon', 'rock', 'soul', 'wide', 'zoom', 'grip',
    'choice', 'expert', 'flame', 'focus', 'king', 'lagging', 'life', 'light',
    'lucky', 'macho', 'mental', 'metro', 'muscle', 'power', 'protective',
    'quick', 'reaper', 'red', 'ring', 'safety', 'scope', 'shed', 'shell',
    'smoke', 'sticky', 'stick', 'thick', 'toxic', 'vitamin', 'wise', 'razor',
    'protein', 'iron', 'calcium', 'zinc', 'carbos', 'hp-up', 'pp-up',
    'rare-candy', 'destiny', 'eviolite', 'absorb', 'air-balloon', 'big-root',
    'binding', 'black', 'blue', 'cleanse', 'damp', 'deep', 'electirizer',
    'magmarizer', 'pretty', 'shoal', 'star', 'string', 'thunderstone',
    'firestone', 'leafstone', 'moonstone', 'sunstone', 'shinystone', 'duskstone',
    'oval', 'snowball', 'flower', 'icicle', 'blunder', 'protector', 'dubious',
    'soothe',
  ];
  const itemsById = {};
  for (const [slug, item] of Object.entries(oldItems)) {
    if (!item || typeof item !== 'object') continue;
    const slugLower = slug.toLowerCase();
    const keep = KEEP_ITEM_KEYWORDS.some(kw => slugLower.includes(kw));
    if (!keep) continue;
    itemsById[item.id] = {
      id: item.id,
      name: item.name_translations?.en?.name || titleSlug(slug),
      slug,
      description: item.effect_translations?.en?.effect
        || item.flavor_text_translations?.en?.flavor_text
        || '',
    };
  }

  // ---- PVP tier: pokemon name (lowercase) → tier ----
  const pvpByName = {};
  for (const [tier, list] of Object.entries(oldPvp)) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      pvpByName[entry.name.toLowerCase()] = tier;
    }
  }

  // ---- Old pokemon supplementary data: id → extra fields ----
  const oldPokemonById = {};
  for (const [name, p] of Object.entries(oldPokemon)) {
    if (!p || typeof p !== 'object') continue;
    oldPokemonById[p.id] = {
      is_legendary: p.is_legendary || false,
      is_mythical: p.is_mythical || false,
      is_baby: p.is_baby || false,
      shiny_tier: p.shiny_tier || null,
      shiny_points: p.shiny_points || null,
      base_happiness: p.base_happiness || null,
      capture_rate: p.capture_rate || null,
      growth_rate: p.growth_rate || null,
      hatch_counter: p.hatch_counter || null,
    };
  }

  console.log('► Building Pokémon list...');

  // ---- Main pokemon list + location index ----
  const pokemonList = [];
  const locationIndex = {}; // "Region::Location" → [{id, name, method, rarity, time}]

  for (const m of monsters) {
    if (!m.obtainable) continue;

    const id = m.id;
    const sprites = spritesByName[m.name.toLowerCase()] || {};
    const oldExtras = oldPokemonById[id] || {};
    const pvpTier = pvpByName[m.name.toLowerCase()] || null;

    // Normalize encounter locations
    const normalizedLocs = (m.locations || []).map(loc => {
      const region = loc.region_name || 'Unknown';
      const locationName = normalizeLocation(loc.location || 'Unknown');
      const rarity = loc.rarity || 'Unknown';
      const method = loc.type || 'Unknown';

      const entry = {
        method,
        region,
        location: locationName,
        min_level: loc.min_level || 0,
        max_level: loc.max_level || 0,
        rarity,
        time: loc.time || 'ALL', // DAY / NIGHT / ALL — only present in some entries
        is_horde: rarity === 'Horde',
        is_lure: rarity === 'Lure',
        weight: RARITY_WEIGHT[rarity] ?? 0.02,
        tier: rarityTier(rarity),
      };

      const key = `${region}::${locationName}`;
      if (!locationIndex[key]) locationIndex[key] = [];
      locationIndex[key].push({
        id, name: m.name, method, rarity,
        time: entry.time,
      });

      return entry;
    });

    // Sort each Pokémon's locations easiest-first
    normalizedLocs.sort((a, b) =>
      b.weight - a.weight ||
      a.region.localeCompare(b.region) ||
      a.location.localeCompare(b.location)
    );

    // Process moves: split learnsets into level-up / TM / tutor / egg.
    // Don't inline full move data here — that bloats the file by ~14MB. Instead,
    // each entry just has id + learn method + level. UI looks up details from
    // the top-level `moves` catalog by id.
    const movesByMethod = { level: [], tm: [], tutor: [], egg: [], other: [] };
    for (const mv of (m.moves || [])) {
      const moveEntry = {
        id: mv.id,
        learn_method: mv.type, // "level", "tm", "tutor", "egg", etc.
        level: mv.level || null,
      };
      const bucket = movesByMethod[mv.type] ? mv.type : 'other';
      movesByMethod[bucket].push(moveEntry);
    }
    // Sort level-up moves by level
    movesByMethod.level.sort((a, b) => (a.level || 0) - (b.level || 0));

    // Filter abilities: NEW data has "--" placeholders for unused slots.
    // Don't inline `effect` per Pokémon — look it up from the `abilities` catalog.
    const cleanAbilities = (m.abilities || [])
      .filter(a => a && a.id && a.name && a.name !== '--')
      .map(a => ({ id: a.id, name: a.name }));
    // Dedupe (NEW data sometimes lists the same ability in slots 1 & 2)
    const seenAbility = new Set();
    const dedupedAbilities = [];
    for (const a of cleanAbilities) {
      if (seenAbility.has(a.id)) continue;
      seenAbility.add(a.id);
      dedupedAbilities.push(a);
    }

    // Process held items: keep id, name, and drop chance directly. Held-item
    // ids in monster.json don't share an id space with item-data.json, so the
    // name field on each entry is the only reliable way to display them.
    const heldItems = (m.held_items || []).map(it => ({
      id: it.id,
      name: it.name || null,
      chance: it.chance || null,
    }));

    pokemonList.push({
      id,
      dex: {
        national: id,
        kanto: dexById[id]?.kanto || 0,
        johto: dexById[id]?.johto || 0,
        hoenn: dexById[id]?.hoenn || 0,
        sinnoh: dexById[id]?.sinnoh || 0,
        unova: dexById[id]?.unova || 0,
      },
      name: m.name,
      types: (m.types || []).map(t => t.charAt(0) + t.slice(1).toLowerCase()),
      stats: m.stats || {},
      yields: m.yields || {},                 // EV yields
      egg_groups: m.egg_groups || [],
      gender_ratio: m.gender_ratio ?? null,   // 0=all male, 254=all female, -1=genderless, 31=12.5% female, 127=50/50
      height: m.height ?? null,               // decimeters
      weight: m.weight ?? null,               // hectograms
      exp_type: m.exp_type || null,
      abilities: dedupedAbilities,
      evolutions: m.evolutions || [],
      moves: movesByMethod,
      tiers: m.tiers || [],
      held_items: heldItems,
      catch_rate: oldExtras.capture_rate || 45,
      sprite: sprites.default || `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`,
      sprite_shiny: sprites.shiny || null,
      // Supplementary fields from OLD data
      is_legendary: oldExtras.is_legendary,
      is_mythical: oldExtras.is_mythical,
      is_baby: oldExtras.is_baby,
      shiny_tier: oldExtras.shiny_tier,
      shiny_points: oldExtras.shiny_points,
      base_happiness: oldExtras.base_happiness,
      growth_rate: oldExtras.growth_rate,
      hatch_counter: oldExtras.hatch_counter,
      pvp_tier: pvpTier,
      // Encounter data
      locations: normalizedLocs,
      best_rarity: normalizedLocs[0]?.rarity || null,
      best_weight: normalizedLocs[0]?.weight || 0,
    });
  }

  // Sort the master list by national dex
  pokemonList.sort((a, b) => a.id - b.id);

  // Dedupe the location index (same mon may appear with multiple methods at one location)
  const dedupedLocationIndex = {};
  for (const [key, mons] of Object.entries(locationIndex)) {
    const seen = new Set();
    const unique = [];
    for (const m of mons) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        unique.push(m);
      }
    }
    dedupedLocationIndex[key] = unique.sort((a, b) => a.name.localeCompare(b.name));
  }

  console.log('► Writing output...');

  const out = {
    pokemon: pokemonList,
    locations: dedupedLocationIndex,
    moves: movesById,             // id → move details (full move catalog)
    abilities: abilitiesById,     // id → ability details
    items: itemsById,             // id → item details (filtered to relevant ones)
    natures: oldNatures,          // pass-through for breeding/IV calc
    egg_groups: oldEggGroups,     // pass-through for breeding
    egg_moves: oldEggMoves,       // pass-through for egg move chains
    gender_rates: oldGender,      // pass-through for breeding
    pvp: oldPvp,                  // pass-through for PVP tier groupings
    meta: {
      regions: ['Kanto', 'Johto', 'Hoenn', 'Sinnoh', 'Unova'],
      total_pokemon: pokemonList.length,
      total_locations: Object.keys(dedupedLocationIndex).length,
      total_moves: Object.keys(movesById).length,
      total_abilities: Object.keys(abilitiesById).length,
      total_items: Object.keys(itemsById).length,
      built_at: new Date().toISOString(),
    },
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out));

  const sizeKb = (fs.statSync(OUT_FILE).size / 1024).toFixed(1);
  console.log('► Build complete.');
  console.log(`  Pokémon:    ${out.meta.total_pokemon}`);
  console.log(`  Locations:  ${out.meta.total_locations}`);
  console.log(`  Moves:      ${out.meta.total_moves}`);
  console.log(`  Abilities:  ${out.meta.total_abilities}`);
  console.log(`  Items:      ${out.meta.total_items} (filtered)`);
  console.log(`  Output:     src/data/pokemmo.json (${sizeKb} KB)`);
}

build();
