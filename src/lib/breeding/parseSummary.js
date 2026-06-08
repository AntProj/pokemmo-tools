// Parse the OCR output of a captured PokéMMO summary panel into a structured
// mon for the Box. Pure + dependency-light so it can be unit-tested in the
// browser with a synthetic payload (no native capture needed).
//
// Input payload (produced by the Rust capture/OCR command):
//   {
//     text:   string,                       // full recognized text (fallback)
//     width:  number, height: number,       // cropped image dimensions
//     words: [{ text, x, y, w, h, green? }] // per-word boxes; green = the IV
//                                           //   cell was tinted green (a 31)
//   }
//
// Output:
//   { ivs:{hp,atk,def,spa,spd,spe}, nature, gender, speciesName, confidence }
// Any field we can't read is left null / 0 so the user confirms it in the Box.

import { IV_KEYS, NATURE_NAMES } from './data.js';

const NATURE_SET = new Set(NATURE_NAMES.map((n) => n.toLowerCase()));

// Group words into visual lines by y-proximity (tolerance ~ 60% of the median
// word height). Returns lines sorted top→bottom, words within each left→right.
function groupLines(words) {
  if (!words.length) return [];
  const heights = words.map((w) => w.h || 0).filter(Boolean).sort((a, b) => a - b);
  const medH = heights.length ? heights[Math.floor(heights.length / 2)] : 12;
  const tol = Math.max(6, medH * 0.6);
  const sorted = [...words].sort((a, b) => a.y - b.y);
  const lines = [];
  for (const w of sorted) {
    const line = lines.find((l) => Math.abs(l.yc - (w.y + (w.h || 0) / 2)) <= tol);
    if (line) {
      line.words.push(w);
      line.yc = (line.yc * (line.words.length - 1) + (w.y + (w.h || 0) / 2)) / line.words.length;
    } else {
      lines.push({ yc: w.y + (w.h || 0) / 2, words: [w] });
    }
  }
  for (const l of lines) l.words.sort((a, b) => a.x - b.x);
  return lines.sort((a, b) => a.yc - b.yc);
}

// Numeric tokens (1–3 digits) within a list of words, in reading order, each
// tagged with whether its source word was green (an in-game 31 cue).
function numberTokens(words) {
  const out = [];
  for (const w of words) {
    const matches = String(w.text).match(/\d{1,3}/g);
    if (!matches) continue;
    for (const m of matches) out.push({ value: parseInt(m, 10), green: !!w.green });
  }
  return out;
}

const labelRe = {
  ivs: /^ivs?$|^iv'?s?:?$/i,
  evs: /^evs?$|^ev'?s?:?$/i,
  nature: /^nature:?$/i,
  level: /^lv\.?$/i,
};

function findLabelLine(lines, re) {
  return lines.find((l) => l.words.some((w) => re.test(String(w.text).replace(/[:.]+$/, ''))));
}

// Words on a line that come after the label word (to its right).
function valuesAfterLabel(line, re) {
  const idx = line.words.findIndex((w) => re.test(String(w.text).replace(/[:.]+$/, '')));
  return idx === -1 ? line.words : line.words.slice(idx + 1);
}

export function parseSummary(payload) {
  const words = Array.isArray(payload?.words) ? payload.words : [];
  const text = payload?.text || words.map((w) => w.text).join(' ');
  const lines = groupLines(words);

  const result = {
    ivs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    nature: '',
    gender: null,
    speciesName: null,
    confidence: { ivs: false, nature: false, species: false },
  };

  // ── IVs ── prefer the line anchored by the "IVs" label, then map the six
  // numbers to HP/Atk/Def/SpA/SpD/Spe. Green cells override to 31 (a misread
  // 31→51 still resolves correctly).
  let ivTokens = null;
  const ivLine = findLabelLine(lines, labelRe.ivs);
  if (ivLine) {
    const toks = numberTokens(valuesAfterLabel(ivLine, labelRe.ivs));
    if (toks.length >= 6) ivTokens = toks.slice(0, 6);
  }
  if (!ivTokens) {
    // Fallback: a 6-number slash group where every value ≤ 31 and not all zero
    // (distinguishes IVs from the >31 stats line; "not all zero" skips EVs).
    const groups = [...text.matchAll(/(\d{1,3})\s*\/\s*(\d{1,3})\s*\/\s*(\d{1,3})\s*\/\s*(\d{1,3})\s*\/\s*(\d{1,3})\s*\/\s*(\d{1,3})/g)];
    for (const g of groups) {
      const vals = g.slice(1, 7).map(Number);
      if (vals.every((v) => v >= 0 && v <= 31) && vals.some((v) => v > 0)) {
        ivTokens = vals.map((v) => ({ value: v, green: false }));
        break;
      }
    }
  }
  if (ivTokens) {
    IV_KEYS.forEach((k, i) => {
      const t = ivTokens[i];
      let v = t.green ? 31 : Math.min(31, Math.max(0, t.value));
      result.ivs[k] = v;
    });
    result.confidence.ivs = true;
  }

  // ── Nature ── first token on the Nature line that names a real nature.
  const natLine = findLabelLine(lines, labelRe.nature);
  const natSource = natLine ? valuesAfterLabel(natLine, labelRe.nature).map((w) => w.text) : text.split(/\s+/);
  for (const tok of natSource) {
    const clean = String(tok).replace(/[^a-z]/gi, '').toLowerCase();
    if (NATURE_SET.has(clean)) {
      result.nature = NATURE_NAMES.find((n) => n.toLowerCase() === clean);
      result.confidence.nature = true;
      break;
    }
  }

  // ── Gender ── PokéMMO draws a ♂/♀ glyph by the name. OCR rarely reads it
  // reliably, so this is best-effort; the user confirms.
  if (/[♂]/.test(text)) result.gender = 'M';
  else if (/[♀]/.test(text)) result.gender = 'F';

  // ── Species name ── the "Lv. N <Name>" line; take the words after the level
  // number, dropping gender glyphs.
  const lvLine = findLabelLine(lines, labelRe.level);
  if (lvLine) {
    const after = valuesAfterLabel(lvLine, labelRe.level)
      .map((w) => String(w.text))
      .filter((t) => !/^\d+$/.test(t) && !/^[♂♀]$/.test(t));
    const name = after.join(' ').replace(/[♂♀]/g, '').trim();
    if (name) { result.speciesName = name; result.confidence.species = true; }
  }
  if (!result.speciesName) {
    // Fallback: "Lv. 100 Tyranitar" anywhere in the text.
    const m = text.match(/lv\.?\s*\d+\s+([A-Za-z.'’\- ]{3,})/i);
    if (m) result.speciesName = m[1].replace(/[♂♀]/g, '').trim();
  }

  return result;
}

// Resolve a parsed species name to a Pokémon id against the dex. Exact match
// first, then a loose contains/startsWith. Returns id or null.
export function resolveSpecies(name, pokemon) {
  if (!name || !Array.isArray(pokemon)) return null;
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const n = norm(name);
  if (!n) return null;
  let hit = pokemon.find((p) => norm(p.name) === n);
  if (hit) return hit.id;
  hit = pokemon.find((p) => norm(p.name).startsWith(n) || n.startsWith(norm(p.name)));
  if (hit) return hit.id;
  hit = pokemon.find((p) => norm(p.name).includes(n) || n.includes(norm(p.name)));
  return hit ? hit.id : null;
}
