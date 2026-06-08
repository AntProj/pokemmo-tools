// The Box — a persistent, target-independent collection of Pokémon the player
// actually owns. Phase 1 of the breeding "Box" feature: the breeding planner's
// matcher pulls compatible mons from here for whatever target is on screen, and
// the same store is reused verbatim by the desktop (Tauri) shell's capture flow.
//
// Stored under localStorage `pokemmo:box`. Unlike the old per-project "Owned"
// inventory (which recorded only is-31 flags), a Box mon stores REAL 0–31 IV
// values, its nature by name, and shiny/alpha — so it's a genuine collection,
// and the planner derives "which IVs are 31" from it when matching.

import { IV_KEYS } from './data.js';

const LS_BOX = 'pokemmo:box';
export const BOX_VERSION = 2;

export function emptyBox() {
  return { version: BOX_VERSION, mons: [] };
}

// A blank Box entry. `species` is a Pokémon id (drives egg group / gender
// quirks); `gender` is only consulted for mixed-gender species.
export function blankBoxMon() {
  return {
    id: 'm_' + Math.random().toString(36).slice(2, 9),
    species: null,
    gender: 'F',
    ivs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    nature: '',
    ability: '',
    shiny: false,
    alpha: false,
    source: 'manual', // 'manual' | 'capture' | 'import'
    addedAt: null,
  };
}

export function loadBox() {
  try {
    const raw = localStorage.getItem(LS_BOX);
    if (!raw) return emptyBox();
    return normalizeBox(JSON.parse(raw));
  } catch {
    return emptyBox();
  }
}

export function saveBox(box) {
  try {
    localStorage.setItem(LS_BOX, JSON.stringify(normalizeBox(box)));
  } catch {
    /* quota / private mode — best-effort */
  }
}

function clampIV(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 0;
  return Math.min(31, Math.max(0, n));
}

// Coerce one arbitrary object (hand-edited JSON, legacy inventory, capture
// payload) into a clean Box mon. Returns null for irredeemable junk.
export function normalizeMon(m) {
  if (!m || typeof m !== 'object') return null;
  const ivsIn = m.ivs || {};
  const ivs = {};
  for (const k of IV_KEYS) {
    const v = ivsIn[k];
    // Back-compat: legacy boolean ivs (true = perfect 31).
    ivs[k] = v === true ? 31 : v === false ? 0 : clampIV(v);
  }
  // Accept both the new `species` and the legacy `monId` key.
  const speciesRaw = m.species != null ? m.species : m.monId;
  const species = Number.isFinite(Number(speciesRaw)) && speciesRaw != null ? Number(speciesRaw) : null;
  return {
    id: typeof m.id === 'string' && m.id ? m.id : 'm_' + Math.random().toString(36).slice(2, 9),
    species,
    gender: ['F', 'M', 'N', 'D'].includes(m.gender) ? m.gender : 'F',
    ivs,
    // Legacy boolean `nature` had no name to recover — drop to "don't care".
    nature: typeof m.nature === 'string' ? m.nature : '',
    ability: typeof m.ability === 'string' ? m.ability : '',
    shiny: !!m.shiny,
    alpha: !!m.alpha,
    source: ['manual', 'capture', 'import'].includes(m.source) ? m.source : 'manual',
    addedAt: typeof m.addedAt === 'string' ? m.addedAt : null,
  };
}

// Validate/coerce a whole parsed object (or bare array) into a clean box.
export function normalizeBox(obj) {
  const mons = Array.isArray(obj?.mons) ? obj.mons : Array.isArray(obj) ? obj : [];
  return { version: BOX_VERSION, mons: mons.map(normalizeMon).filter(Boolean) };
}

export function boxToJSON(box) {
  return JSON.stringify(normalizeBox(box), null, 2);
}

// Parse imported text → { mons, error }. Never throws.
export function boxFromJSON(text) {
  try {
    const norm = normalizeBox(JSON.parse(text));
    return { mons: norm.mons, error: null };
  } catch {
    return { mons: null, error: 'Could not read that file — expected a Box JSON export.' };
  }
}

// Identity for dedup on import/merge: two mons are "the same" if species,
// gender, every IV, nature, and shiny/alpha all match.
export function monSignature(m) {
  const ivs = IV_KEYS.map((k) => m.ivs?.[k] ?? 0).join(',');
  return `${m.species}|${m.gender}|${ivs}|${m.nature || ''}|${m.shiny ? 1 : 0}|${m.alpha ? 1 : 0}`;
}

// Append `incoming` to `existing`, skipping signature-duplicates.
export function mergeMons(existing, incoming) {
  const seen = new Set(existing.map(monSignature));
  const out = [...existing];
  for (const m of incoming) {
    const sig = monSignature(m);
    if (!seen.has(sig)) {
      seen.add(sig);
      out.push(m);
    }
  }
  return out;
}

// Count how many of a mon's six IVs are a perfect 31 (used for sorting / display).
export function perfectCount(m) {
  return IV_KEYS.reduce((n, k) => n + (m.ivs?.[k] === 31 ? 1 : 0), 0);
}
