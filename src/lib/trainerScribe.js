// Trainer Scribe — parse a PokéMMO battle log (+ the opponent HP-bar and route
// regions) into a trainer-team observation, and accrete observations across
// battles into a profile. Dev-only authoring tool: turns playing the game into
// trainer-team data (the trainerInstances catalog ships team:[] / reward:null).
//
// The parser is pure + dependency-light so it can be unit-tested against real
// battle-log screenshots without any capture.
//
// Battle-log grammar (after stripping the "[7:39:40 PM] [Battle] " prefix):
//   You are challenged by <Trainer>!            → trainer identity
//   <Trainer> sent out <Mon>!                   → opponent mon (leading name == trainer)
//   <Player> sent out <Mon>! / Go! <Mon>!       → player (ignored)
//   The foe's <Mon> used <Move>!                → opponent move (the clean signal)
//   The foe's <Mon> fainted!                    → opponent mon down
//   <Trainer> was defeated! / You got $<N>...   → battle won + reward

const PREFIX = /^\s*\[?\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?\]?\s*(?:\[Battle\]\s*)?/i;

export function stripBattlePrefix(line) {
  return String(line).replace(PREFIX, '').trim();
}

const RE = {
  challenge: /^You are challenged by (.+?)\s*!?$/i,
  sentOut:   /^(.+?) sent out (.+?)\s*!?$/i,
  foeMove:   /^The foe['’`]s (.+?) used (.+?)\s*!.*$/i,
  foeFaint:  /^The foe['’`]s (.+?) fainted\s*!?$/i,
  // Two win phrasings: "<Trainer> was defeated!" and "<Winner> defeated <Trainer>!".
  wasDefeated: /^(.+?) was defeated\s*!?$/i,
  defeatedBy:  /^.+? defeated (.+?)\s*!?$/i,
  reward:    /(?:got|received|won|earned)\s*\$\s*([\d,]+)/i,
};

// "Route 37 Ch. 1" → "Route 37" (drop the channel suffix).
export function parseRoute(text) {
  if (!text) return null;
  const t = String(text).replace(/\s*Ch\.?\s*\d+\s*$/i, '').trim();
  return t || null;
}

// Opponent HP-bar OCR: "Umbreon Lv. 43 ♂" → { species, level, gender }.
export function parseOpponentBar(text) {
  if (!text) return null;
  const m = String(text).match(/^(.+?)\s+Lv\.?\s*(\d{1,3})\s*([♂♀])?/i);
  if (!m) return null;
  return {
    species: m[1].trim(),
    level: Number(m[2]),
    gender: m[3] === '♂' ? 'M' : m[3] === '♀' ? 'F' : null,
  };
}

function cleanMove(s) {
  return String(s).replace(/[!.]+$/, '').replace(/\s*\(.*$/, '').trim();
}

// Parse accumulated log lines (deduped, any order is fine — we read forward).
// Returns { trainer, reward, defeated, team:[{species, moves:[]}] } in
// first-seen order.
export function parseBattleLog(rawLines) {
  const lines = (rawLines || []).map(stripBattlePrefix).filter(Boolean);
  let trainer = null;
  let reward = null;
  let defeated = false;
  const team = new Map(); // species -> { species, moves:Set, order }
  let order = 0;
  const ensure = (sp) => {
    const key = sp.trim();
    if (!team.has(key)) team.set(key, { species: key, moves: new Set(), order: order++ });
    return team.get(key);
  };

  for (const ln of lines) {
    let m;
    if ((m = ln.match(RE.challenge))) { trainer = m[1].trim(); continue; }
    if ((m = ln.match(RE.foeMove)))   { ensure(m[1]).moves.add(cleanMove(m[2])); continue; }
    if ((m = ln.match(RE.foeFaint)))  { ensure(m[1]); continue; }
    if ((m = ln.match(RE.reward)))    { reward = Number(m[1].replace(/,/g, '')); continue; }
    if ((m = ln.match(RE.sentOut))) {
      const who = m[1].trim();
      if (trainer && who === trainer) ensure(m[2]);
      continue;
    }
    if ((m = ln.match(RE.wasDefeated))) {
      if (trainer && m[1].trim() === trainer) defeated = true;
      continue;
    }
    if ((m = ln.match(RE.defeatedBy))) {
      // "<winner> defeated <Trainer>!" — only counts when the loser is the trainer.
      if (trainer && m[1].trim() === trainer) defeated = true;
      continue;
    }
  }

  return {
    trainer,
    reward,
    defeated,
    team: [...team.values()]
      .sort((a, b) => a.order - b.order)
      .map((t) => ({ species: t.species, moves: [...t.moves] })),
  };
}

// Fold the opponent HP-bar reads (species → level/gender) into the parsed team.
// `bars` is an array of parseOpponentBar() results collected over the battle.
export function buildObservation({ logLines, bars = [], routeText }) {
  const parsed = parseBattleLog(logLines);
  const barBySpecies = new Map();
  for (const b of bars) {
    if (!b || !b.species) continue;
    barBySpecies.set(norm(b.species), b);
  }
  const team = parsed.team.map((t) => {
    const bar = barBySpecies.get(norm(t.species));
    return { species: t.species, level: bar?.level ?? null, gender: bar?.gender ?? null, moves: t.moves };
  });
  // A mon seen only on the HP bar (e.g. it never got a move off) still counts.
  for (const b of bars) {
    if (b && b.species && !team.some((t) => norm(t.species) === norm(b.species))) {
      team.push({ species: b.species, level: b.level ?? null, gender: b.gender ?? null, moves: [] });
    }
  }
  return {
    trainer: parsed.trainer,
    route: parseRoute(routeText),
    reward: parsed.reward,
    defeated: parsed.defeated,
    team,
  };
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/* ── accretive store ─────────────────────────────────────────────────────── */

const LS_SCRIBE = 'pokemmo:trainerscribe';

export function emptyScribe() {
  return { version: 1, trainers: {} };
}

export function loadScribe() {
  if (typeof window === 'undefined') return emptyScribe();
  try {
    const raw = JSON.parse(localStorage.getItem(LS_SCRIBE));
    if (raw && raw.trainers) return raw;
  } catch { /* ignore */ }
  return emptyScribe();
}

export function saveScribe(store) {
  try { localStorage.setItem(LS_SCRIBE, JSON.stringify(store)); } catch { /* ignore */ }
}

export function trainerKey(obs) {
  return `${obs.route || '?'}::${obs.trainer || '?'}`;
}

// Merge one battle observation into the store — accretive: unions team members
// (by species), unions each member's moves, and updates level/gender/reward as
// they become known. Battle a trainer again tomorrow and the profile fills in.
export function mergeObservation(store, obs, stampISO) {
  if (!obs.trainer) return store;
  const key = trainerKey(obs);
  const prev = store.trainers[key] || { name: obs.trainer, route: obs.route, reward: null, team: [], battles: 0 };

  const bySpecies = new Map(prev.team.map((t) => [norm(t.species), { ...t, moves: [...(t.moves || [])] }]));
  for (const t of obs.team) {
    const k = norm(t.species);
    const e = bySpecies.get(k) || { species: t.species, level: null, gender: null, moves: [] };
    if (t.level) e.level = t.level;
    if (t.gender) e.gender = t.gender;
    if (t.species) e.species = t.species;
    e.moves = [...new Set([...(e.moves || []), ...(t.moves || [])])];
    bySpecies.set(k, e);
  }

  const merged = {
    name: obs.trainer,
    route: obs.route || prev.route,
    reward: obs.reward ?? prev.reward,
    team: [...bySpecies.values()],
    battles: (prev.battles || 0) + 1,
    updatedAt: stampISO || prev.updatedAt || null,
  };
  return { ...store, trainers: { ...store.trainers, [key]: merged } };
}

export function scribeToJSON(store) {
  return JSON.stringify(store, null, 2);
}
