#!/usr/bin/env node
/**
 * build-data.mjs
 *
 * Merges raw data sources into a single app-ready dataset.
 *
 *   Primary per-Pokémon source:
 *     - pokemon-data.json   — PokéAPI-derived; accurate locations, full TM list,
 *                              proper HA flags, evolution chain, etc.
 *
 *   Per-Pokémon supplement:
 *     - monster.json        — kept on disk solely for height + weight, which
 *                              pokemon-data.json doesn't carry. Used by the
 *                              modal's display fields and the Catch Calc's
 *                              Heavy Ball multiplier.
 *
 *   Catalogs / pass-through:
 *     - moves-data.json     — move effects + effect_chance
 *     - abilities-data.json — ability effect descriptions
 *     - item-data.json      — item English names + descriptions
 *     - types-data.json     — type chart
 *     - natures-data.json   — nature stat boosts/drops
 *     - egg-groups-data.json — egg group memberships
 *     - egg-moves-data.json — egg move breeding chains
 *     - gender-rates.json   — gender ratios
 *     - pvp-data.json       — PVP tier groupings
 *     - pokemon-sprites.json — sprite URLs (default + shiny)
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
  'Rare':        0.05,
  'Very Rare':   0.01,
  'Horde':       0.30,
  'Lure':        0.50,
  'Special':     0.02,
};

function rarityTier(rarity) {
  if (rarity === 'Very Common') return 'very-common';
  if (rarity === 'Common' || rarity === 'Lure' || rarity === 'Horde') return 'common';
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

// ---------- Schema converters ----------

// PokéAPI gender_rate is 0-8 (chance/8 of being female; -1 = genderless).
// Convert to PokeMMO's 0-254 scale that the rest of the codebase uses.
function genderRateToRatio(rate) {
  if (rate == null || rate === -1) return -1;
  // Lookup table covers all PokéAPI values 0-8.
  return [0, 31, 63, 95, 127, 159, 191, 223, 254][rate] ?? -1;
}

// PokéAPI growth_rate slugs → uppercase enum used by the rest of the codebase.
function growthRateToExpType(slug) {
  if (!slug) return null;
  return String(slug).toUpperCase().replace(/-/g, '_');
}

// Map pokemon-data.json's move category strings to the monster.json conventions
// the UI's TAB_LEARN_METHODS expects (PokemonModal.jsx ~390).
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
    case 'sketch':     return 'move_learner_tools'; // Smeargle only — treat as TM-equivalent
    default:           return String(cat || 'other').toLowerCase();
  }
}

// Group buckets used by pokemmo.json's `moves` field. The UI re-buckets at
// render time via learn_method, but this layout matches what existed before.
function bucketForMethod(method) {
  if (method === 'level') return 'level';
  if (method === 'move_learner_tools') return 'tm';
  if (method === 'move_tutor' || method === 'special_moves') return 'tutor';
  if (method === 'egg_moves' || method === 'special_egg') return 'egg';
  return 'other';
}

// PokéAPI-shaped evolution_chain.chain is recursive. Walk to find the node
// matching the target id, return:
//   - direct successors (forward evolutions)
//   - parent + parent's evolution_details for THIS edge (pre_evolution)
//
// In pokemon-data.json, each node's species has the shape `{name, id}`.
// Fall back to parsing PokéAPI-style `species.url` ("/<id>/") if id missing.
function speciesId(species) {
  if (!species) return null;
  if (species.id != null) return Number(species.id);
  const m = String(species.url || '').match(/\/(\d+)\/?$/);
  return m ? Number(m[1]) : null;
}

function speciesNameToTitle(name) {
  if (!name) return name;
  // PokéAPI names are lowercase ("nidoran-f"); preserve hyphenation but title-case parts.
  return name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('-');
}

function detailsToTypeVal(detailsList) {
  // Most evolutions have 1 detail entry. Use the first.
  const d = (detailsList || [])[0];
  if (!d) return { type: 'OTHER', val: null };
  if (d.min_level != null)        return { type: 'LEVEL',     val: d.min_level };
  if (d.item)                     return { type: 'ITEM',      val: d.item.name || d.item };
  if (d.held_item)                return { type: 'HOLD_ITEM', val: d.held_item.name || d.held_item };
  if (d.min_happiness != null)    return { type: 'HAPPINESS', val: d.min_happiness };
  if (d.known_move)               return { type: 'MOVE',      val: d.known_move.name || d.known_move };
  if (d.known_move_type)          return { type: 'MOVE_TYPE', val: d.known_move_type.name || d.known_move_type };
  if (d.location)                 return { type: 'LOCATION',  val: d.location.name || d.location };
  if (d.min_affection != null)    return { type: 'AFFECTION', val: d.min_affection };
  if (d.min_beauty != null)       return { type: 'BEAUTY',    val: d.min_beauty };
  if (d.time_of_day)              return { type: 'TIME',      val: d.time_of_day };
  if (d.trade_species)            return { type: 'TRADE',     val: d.trade_species.name || d.trade_species };
  if (d.gender != null)           return { type: 'GENDER',    val: d.gender };
  return { type: (d.trigger?.name || 'OTHER').toUpperCase(), val: null };
}

function findEvolutionInfo(rootChain, targetId) {
  // Walk depth-first. Return { evolutions: [...], pre_evolution: {...}|null }.
  // - evolutions: direct .evolves_to[] children of the matched node, mapped to {id, name, type, val}.
  // - pre_evolution: {id, name, type, val} of the parent, or null if this is the chain root.
  if (!rootChain) return { evolutions: [], pre_evolution: null };

  // First check the root.
  const rootId = speciesId(rootChain.species);
  if (rootId === targetId) {
    const evos = (rootChain.evolves_to || []).map(child => ({
      id: speciesId(child.species),
      name: speciesNameToTitle(child.species?.name),
      ...detailsToTypeVal(child.evolution_details),
    })).filter(e => e.id != null);
    return { evolutions: evos, pre_evolution: null };
  }

  // Otherwise search children. Track parent + the edge's evolution_details so
  // we can describe how the parent evolves into the target.
  function walk(node, parentNode) {
    const myId = speciesId(node.species);
    if (myId === targetId) {
      const evos = (node.evolves_to || []).map(child => ({
        id: speciesId(child.species),
        name: speciesNameToTitle(child.species?.name),
        ...detailsToTypeVal(child.evolution_details),
      })).filter(e => e.id != null);
      const preEvo = parentNode ? {
        id: speciesId(parentNode.species),
        name: speciesNameToTitle(parentNode.species?.name),
        ...detailsToTypeVal(node.evolution_details),
      } : null;
      return { evolutions: evos, pre_evolution: preEvo };
    }
    for (const child of (node.evolves_to || [])) {
      const found = walk(child, node);
      if (found) return found;
    }
    return null;
  }

  return walk(rootChain, null) || { evolutions: [], pre_evolution: null };
}

// ============================================================================
// MAIN BUILD
// ============================================================================
function build() {
  console.log('► Loading raw data...');

  // Primary per-Pokémon source.
  const pokemonData = loadJson('pokemon-data.json');

  // Fallback for height + weight only.
  const monsters = loadJson('monster.json');
  const heightWeightById = new Map();
  for (const m of monsters) heightWeightById.set(m.id, { height: m.height, weight: m.weight });

  // PokeMMO Hub regional dex numbers
  const dexData = loadJson('dex.json', false) || [];
  const dexById = Object.fromEntries(dexData.map(d => [d.id, d]));

  // Catalogs / pass-through
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
  const movesById = {};
  for (const [slug, m] of Object.entries(oldMoves)) {
    if (!m || typeof m !== 'object') continue;
    movesById[m.id] = {
      id: m.id,
      name: m.name_translations?.en?.name || titleSlug(m.name),
      slug: m.name,
      type: (m.type || '').toUpperCase(),
      damage_class: (m.damage_class || '').toUpperCase(),
      power: m.power || 0,
      accuracy: m.accuracy ?? null,
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

  console.log('► Building Pokémon list...');

  // ---- Main pokemon list + location index ----
  const pokemonList = [];
  const locationIndex = {};

  for (const p of Object.values(pokemonData)) {
    if (!p || !p.id) continue;
    if (!p.obtainable) continue;
    if (p.is_default === false) continue; // drop alt forms (Megas, regional variants, etc.)

    const id = p.id;
    const nameTitle = p.name_translations?.en?.name || speciesNameToTitle(p.name);
    const nameLower = (p.name || '').toLowerCase();
    const sprites = spritesByName[nameLower] || {};
    const pvpTier = pvpByName[nameLower] || null;
    const hw = heightWeightById.get(id) || {};

    // ---- Locations ----
    const normalizedLocs = (p.location_area_encounters || []).map(loc => {
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
      locationIndex[key].push({ id, name: nameTitle, method, rarity, time: entry.time });
      return entry;
    });
    normalizedLocs.sort((a, b) =>
      b.weight - a.weight ||
      a.region.localeCompare(b.region) ||
      a.location.localeCompare(b.location)
    );

    // ---- Moves ----
    const movesByMethod = { level: [], tm: [], tutor: [], egg: [], other: [] };
    for (const mv of (p.moves || [])) {
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
    const seenAbility = new Set();
    const dedupedAbilities = [];
    for (const a of (p.abilities || [])) {
      if (!a || !a.id || seenAbility.has(a.id)) continue;
      seenAbility.add(a.id);
      dedupedAbilities.push({
        id: a.id,
        name: titleSlug(a.ability_name || ''),
        is_hidden: !!a.is_hidden,
        slot: a.slot || null,
      });
    }

    // ---- Stats (flatten array → object) ----
    const STAT_KEY = {
      'hp': 'hp', 'attack': 'attack', 'defense': 'defense',
      'special-attack': 'sp_attack', 'special-defense': 'sp_defense', 'speed': 'speed',
    };
    const stats = {};
    const yields = { exp: p.base_experience || 0, ev_hp: 0, ev_attack: 0, ev_defense: 0, ev_speed: 0, ev_sp_attack: 0, ev_sp_defense: 0 };
    for (const s of (p.stats || [])) {
      const key = STAT_KEY[s.stat_name];
      if (!key) continue;
      stats[key] = s.base_stat || 0;
      yields['ev_' + key] = s.effort || 0;
    }

    // ---- Tiers (PVP) ----
    const tiers = (p.pvp || []).map(t => t.tier).filter(Boolean);
    if (tiers.length === 0) tiers.push('Untiered');

    // ---- Held items ----
    const heldItems = (p.held_items || []).map(it => ({
      id: it.id,
      name: it.name || null,
      chance: it.chance || null,
    }));

    // ---- Forms ----
    const forms = (p.forms || []).map((f, idx) => ({
      form_id: idx,
      id: f.id || id,
      name: speciesNameToTitle(f.name || ''),
    }));

    // ---- Evolutions + pre_evolution ----
    const { evolutions, pre_evolution } = findEvolutionInfo(p.evolution_chain?.chain, id);

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
      name: nameTitle,
      types: (p.types || []).map(t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()),
      stats,
      yields,
      egg_groups: p.egg_groups || [],
      gender_ratio: genderRateToRatio(p.gender_rate),
      height: hw.height ?? null,
      weight: hw.weight ?? null,
      exp_type: growthRateToExpType(p.growth_rate),
      abilities: dedupedAbilities,
      forms,
      evolutions,
      pre_evolution,
      moves: movesByMethod,
      tiers,
      held_items: heldItems,
      catch_rate: p.capture_rate || 45,
      sprite: sprites.default || `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`,
      sprite_shiny: sprites.shiny || null,
      is_legendary: !!p.is_legendary,
      is_mythical: !!p.is_mythical,
      is_baby: !!p.is_baby,
      shiny_tier: p.shiny_tier || null,
      shiny_points: p.shiny_points || null,
      base_happiness: p.base_happiness || null,
      growth_rate: p.growth_rate || null,
      hatch_counter: p.hatch_counter || null,
      pvp_tier: pvpTier,
      locations: normalizedLocs,
      best_rarity: normalizedLocs[0]?.rarity || null,
      best_weight: normalizedLocs[0]?.weight || 0,
    });
  }

  // Sort the master list by national dex
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

  const out = {
    pokemon: pokemonList,
    locations: dedupedLocationIndex,
    moves: movesById,
    abilities: abilitiesById,
    items: itemsById,
    natures: oldNatures,
    egg_groups: oldEggGroups,
    egg_moves: oldEggMoves,
    gender_rates: oldGender,
    pvp: oldPvp,
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
