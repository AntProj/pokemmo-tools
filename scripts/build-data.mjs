#!/usr/bin/env node
/**
 * build-data.mjs
 *
 * Merges raw data sources into a single app-ready dataset.
 *
 *   Primary game-extracted sources (authoritative for in-game state):
 *     - monsters.json — Pokémon: id, name, stats, yields, abilities, forms,
 *                        evolutions, moves (proper TM / TUTOR / EGG / SPECIAL
 *                        categories), tiers, held_items, locations, height,
 *                        weight, gender_ratio, exp_type
 *     - items.json    — Items: id, name, desc
 *     - skills.json   — Moves: id, name, skill_damage_type, base_power,
 *                        base_accuracy, base_pp, priority, type, target_type
 *
 *   Supplements (fields the game extracts don't carry):
 *     - pokemon-data.json   — is_legendary / is_mythical / is_baby /
 *                              shiny_tier / shiny_points / base_happiness /
 *                              capture_rate / growth_rate
 *     - moves-data.json     — move effect text + effect_chance
 *     - abilities-data.json — ability effect descriptions
 *     - pokemon-sprites.json — sprite URLs (default + shiny)
 *     - dex.json            — regional dex numbers
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
const RARITY_WEIGHT = {
  'Very Common': 0.40,
  'Common':      0.20,
  'Uncommon':    0.10,
  'Horde':       0.08,
  'Rare':        0.05,
  'Very Rare':   0.02,
  'Special':     0.01,
  'Lure':        0.005,
};

function rarityTier(rarity) {
  if (rarity === 'Very Common') return 'very-common';
  if (rarity === 'Common' || rarity === 'Horde') return 'common';
  if (rarity === 'Uncommon') return 'uncommon';
  if (rarity === 'Rare') return 'rare';
  return 'very-rare';
}

// ---------- Location name normalization ----------
function normalizeLocation(name) {
  if (!name) return name;
  const letters = name.split('').filter(c => /[a-z]/i.test(c));
  if (!letters.length) return name.trim();
  const upperRatio = letters.filter(c => c === c.toUpperCase()).length / letters.length;
  if (upperRatio > 0.7) {
    return name.split(' ').map(w => {
      if (/^(TM|HM|[IVX]+|[A-Z])$/.test(w)) return w;
      if (/^\d/.test(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }).join(' ').trim();
  }
  return name.trim();
}

function titleSlug(slug) {
  if (!slug) return slug;
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// ---------- Sprite URL helpers ----------
// Showdown's animated-GIF slugs differ from species names. Most reduce via the
// generic rule (lowercase, strip punctuation/whitespace, fold accents) but a
// handful need explicit overrides — especially the gendered Nidorans and
// punctuated names.
const SLUG_OVERRIDES = {
  'Nidoran♀': 'nidoranf',
  'Nidoran♂': 'nidoranm',
  "Farfetch'd": 'farfetchd',
  'Mr. Mime':  'mrmime',
  'Mime Jr.':  'mimejr',
  'Ho-Oh':     'hooh',
  'Porygon-Z': 'porygonz',
  'Flabébé':   'flabebe',
};

function spriteSlug(name) {
  if (!name) return '';
  if (SLUG_OVERRIDES[name]) return SLUG_OVERRIDES[name];
  return name
    .toLowerCase()
    .replace(/♀/g, 'f')
    .replace(/♂/g, 'm')
    .replace(/é/g, 'e')
    .replace(/[.'":\-\s]/g, '');
}

// ---------- Loaders ----------

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

// Game-extracted JSON files (monsters.json, items.json) contain raw newlines
// inside string literals — the game stores descriptions with literal '\n'
// characters that standard JSON.parse rejects. Escape control chars in
// strings before parsing.
function loadGameJson(name) {
  const p = path.join(RAW, name);
  if (!fs.existsSync(p)) {
    console.error(`✗ Missing required file: data/raw/${name}`);
    process.exit(1);
  }
  const text = fs.readFileSync(p, 'utf-8');
  let out = '', inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const cp = c.charCodeAt(0);
    if (esc) { out += c; esc = false; continue; }
    if (c === '\\') { out += c; esc = true; continue; }
    if (c === '"') { out += c; inStr = !inStr; continue; }
    if (inStr && cp < 0x20) {
      // Any C0 control char inside a string literal — escape per spec.
      if (c === '\n') out += '\\n';
      else if (c === '\r') out += '\\r';
      else if (c === '\t') out += '\\t';
      else if (c === '\b') out += '\\b';
      else if (c === '\f') out += '\\f';
      else out += '\\u' + cp.toString(16).padStart(4, '0');
      continue;
    }
    out += c;
  }
  return JSON.parse(out);
}

// ---------- Move category mapper ----------
// monsters.json uses the same uppercase categories as pokemon-data.json did
// (level / EGG / EGG & ITEM / EVOLVE / PREVO / SPECIAL / TM?? / TUTOR / sketch).
// Map to monster.json-style learn_method strings the UI's TAB_LEARN_METHODS
// in PokemonModal.jsx expects (move_learner_tools / move_tutor / egg_moves /
// special_moves / special_egg / on_evolution / prevo_moves).
function mapMoveCategory(cat) {
  switch (cat) {
    case 'level':      return 'level';
    case 'TM??':       return 'move_learner_tools';
    case 'TUTOR':      return 'move_tutor';
    case 'EGG':        return 'egg_moves';
    case 'SPECIAL':    return 'special_moves';
    case 'EGG & ITEM': return 'special_egg';
    case 'EVOLVE':     return 'on_evolution';
    case 'PREVO':      return 'prevo_moves';
    case 'sketch':     return 'move_learner_tools';
    default:           return String(cat || 'other').toLowerCase();
  }
}

function bucketForMethod(method) {
  if (method === 'level') return 'level';
  if (method === 'move_learner_tools') return 'tm';
  if (method === 'move_tutor' || method === 'special_moves') return 'tutor';
  if (method === 'egg_moves' || method === 'special_egg') return 'egg';
  return 'other';
}

// ============================================================================
// MAIN BUILD
// ============================================================================
function build() {
  console.log('► Loading raw data...');

  // Primary game-extracted sources
  const monsters = loadGameJson('monsters.json');
  const items    = loadGameJson('items.json');
  const skills   = loadJson('skills.json');

  // Supplements (fields the game extracts don't carry)
  const oldPokemon   = loadJson('pokemon-data.json', false) || {};
  const oldMoves     = loadJson('moves-data.json',   false) || {};
  const oldAbilities = loadJson('abilities-data.json', false) || {};
  const oldSprites   = loadJson('pokemon-sprites.json', false) || {};

  // PokeMMO Hub regional dex numbers
  const dexData = loadJson('dex.json', false) || [];
  const dexById = Object.fromEntries(dexData.map(d => [d.id, d]));

  console.log('► Building lookup tables...');

  // ---- Sprites: name (lowercase) → { default, shiny } ----
  const spritesByName = {};
  for (const [name, entry] of Object.entries(oldSprites)) {
    spritesByName[name.toLowerCase()] = {
      default: entry?.sprites?.front_default || null,
      shiny: entry?.sprites?.front_shiny || null,
    };
  }

  // ---- pokemon-data.json supplement (badge flags & metadata only) ----
  const supById = new Map();
  for (const p of Object.values(oldPokemon)) {
    if (!p || typeof p !== 'object' || !p.id) continue;
    supById.set(p.id, {
      is_legendary: !!p.is_legendary,
      is_mythical:  !!p.is_mythical,
      is_baby:      !!p.is_baby,
      shiny_tier:    p.shiny_tier  ?? null,
      shiny_points:  p.shiny_points ?? null,
      base_happiness: p.base_happiness ?? null,
      capture_rate:   p.capture_rate ?? null,
      growth_rate:    p.growth_rate ?? null,
      // hatch_counter intentionally dropped — PokeMMO uses time-based hatching.
    });
  }

  // ---- Moves catalog: skills.json + moves-data.json supplement for effects ----
  const oldMoveById = {};
  for (const [slug, m] of Object.entries(oldMoves)) {
    if (m && typeof m === 'object' && m.id) oldMoveById[m.id] = { ...m, slug: m.name };
  }
  const movesById = {};
  for (const s of skills) {
    if (!s || !s.id) continue;
    const sup = oldMoveById[s.id];
    movesById[s.id] = {
      id: s.id,
      name: s.name,
      slug: sup?.slug || String(s.name).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      type: (s.type || '').toUpperCase(),
      damage_class: (s.skill_damage_type || '').toUpperCase(),
      power: s.base_power || 0,
      accuracy: s.base_accuracy ?? null,
      pp: s.base_pp || 0,
      priority: s.priority || 0,
      effect: sup?.effect || '',
      effect_chance: sup?.effect_chance ?? null,
    };
  }

  // ---- Abilities catalog (from abilities-data.json supplement) ----
  const abilitiesById = {};
  for (const [slug, a] of Object.entries(oldAbilities)) {
    if (!a || typeof a !== 'object' || !a.id) continue;
    abilitiesById[a.id] = {
      id: a.id,
      name: titleSlug(a.name),
      slug: a.name,
      effect: a.effect || '',
    };
  }

  // ---- Items catalog (from items.json) ----
  const itemsById = {};
  for (const it of items) {
    if (!it || !it.id) continue;
    itemsById[it.id] = {
      id: it.id,
      name: it.name,
      description: it.desc || '',
    };
  }

  // ---- Parent-by-child map for pre_evolution ----
  // Walk every monster's evolutions[] array and record { childId → parent info }.
  const parentByChild = new Map();
  for (const m of monsters) {
    for (const evo of (m.evolutions || [])) {
      if (!evo || evo.id == null) continue;
      parentByChild.set(evo.id, {
        id: m.id,
        name: m.name,
        type: evo.type || null,
        val: evo.val ?? null,
      });
    }
  }

  console.log('► Building Pokémon list...');

  const pokemonList = [];
  const locationIndex = {};

  for (const m of monsters) {
    if (!m || !m.id) continue;
    if (!m.obtainable) continue;

    const id = m.id;
    const sprites = spritesByName[m.name.toLowerCase()] || {};
    const sup = supById.get(id) || {};

    // ---- Locations ----
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
        time: loc.time || 'ALL',
        is_horde: rarity === 'Horde',
        is_lure: rarity === 'Lure',
        weight: RARITY_WEIGHT[rarity] ?? 0.02,
        tier: rarityTier(rarity),
      };
      const key = `${region}::${locationName}`;
      if (!locationIndex[key]) locationIndex[key] = [];
      locationIndex[key].push({ id, name: m.name, method, rarity, time: entry.time });
      return entry;
    });
    normalizedLocs.sort((a, b) =>
      b.weight - a.weight ||
      a.region.localeCompare(b.region) ||
      a.location.localeCompare(b.location)
    );

    // ---- Moves ----
    const movesByMethod = { level: [], tm: [], tutor: [], egg: [], other: [] };
    for (const mv of (m.moves || [])) {
      const learn_method = mapMoveCategory(mv.type);
      const moveEntry = {
        id: mv.id,
        learn_method,
        level: mv.level || null,
      };
      const bucket = bucketForMethod(learn_method);
      movesByMethod[bucket].push(moveEntry);
    }
    movesByMethod.level.sort((a, b) => (a.level || 0) - (b.level || 0));

    // ---- Abilities ----
    const cleanAbilities = (m.abilities || [])
      .filter(a => a && a.id && a.name && a.name !== '--')
      .map(a => ({ id: a.id, name: a.name }));
    const seenAbility = new Set();
    const dedupedAbilities = [];
    for (const a of cleanAbilities) {
      if (seenAbility.has(a.id)) continue;
      seenAbility.add(a.id);
      dedupedAbilities.push(a);
    }

    // ---- Held items ----
    const heldItems = (m.held_items || []).map(it => ({
      id: it.id,
      name: it.item_name || it.name || null,
      chance: it.chance || null,
    }));

    // ---- PVP tier: first non-Untiered entry of monsters.json's tiers[] ----
    const tiers = m.tiers || [];
    const pvpTier = tiers.find(t => t && t !== 'Untiered') || null;

    // ---- Sprites ----
    // sprite_animated: Gen 5 animated GIF from Showdown (used in cards/lists).
    // sprite_3d:       Pokemon HOME PNG render from PokeAPI (used in modal hero).
    // sprite:          existing PokeAPI Gen 5 still PNG — last-resort fallback.
    const slug = spriteSlug(m.name);
    const sprite_animated = `https://play.pokemonshowdown.com/sprites/ani/${slug}.gif`;
    const sprite_animated_shiny = `https://play.pokemonshowdown.com/sprites/ani-shiny/${slug}.gif`;
    const sprite_3d = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/${id}.png`;
    const sprite_3d_shiny = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/shiny/${id}.png`;

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
      types: (m.types || []).map(t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()),
      stats: m.stats || {},
      yields: m.yields || {},
      egg_groups: m.egg_groups || [],
      gender_ratio: m.gender_ratio ?? null,
      height: m.height ?? null,
      weight: m.weight ?? null,
      exp_type: m.exp_type ?? null,
      abilities: dedupedAbilities,
      forms: m.forms || [],
      evolutions: m.evolutions || [],
      pre_evolution: parentByChild.get(id) || null,
      moves: movesByMethod,
      tiers,
      held_items: heldItems,
      catch_rate: sup.capture_rate || 45,
      sprite_animated,
      sprite_animated_shiny,
      sprite_3d,
      sprite_3d_shiny,
      sprite: sprites.default || `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`,
      sprite_shiny: sprites.shiny || null,
      is_legendary: !!sup.is_legendary,
      is_mythical: !!sup.is_mythical,
      is_baby: !!sup.is_baby,
      shiny_tier: sup.shiny_tier ?? null,
      shiny_points: sup.shiny_points ?? null,
      base_happiness: sup.base_happiness ?? null,
      growth_rate: sup.growth_rate ?? null,
      pvp_tier: pvpTier,
      locations: normalizedLocs,
      best_rarity: normalizedLocs[0]?.rarity || null,
      best_weight: normalizedLocs[0]?.weight || 0,
    });
  }

  pokemonList.sort((a, b) => a.id - b.id);

  // Dedupe the location index
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

  // Pass-through catalog fields removed: nothing in src/** reads
  // data.egg_moves / data.gender_rates / data.natures / data.egg_groups / data.pvp.
  // Breeding planner constants live in src/lib/breeding/data.js.
  const out = {
    pokemon: pokemonList,
    locations: dedupedLocationIndex,
    moves: movesById,
    abilities: abilitiesById,
    items: itemsById,
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
  console.log(`  Items:      ${out.meta.total_items}`);
  console.log(`  Output:     src/data/pokemmo.json (${sizeKb} KB)`);
}

build();
