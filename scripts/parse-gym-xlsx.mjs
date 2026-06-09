// parse-gym-xlsx.mjs — convert the community "Gym Leader Team Query Form"
// spreadsheet into structured, id-mapped trainer-team JSON.
//
// Source: forums.pokemmo.com/index.php?/topic/194839 — a .xlsx maintained
// alongside PokéMMO patches that documents every gym leader's team across ALL
// five regions (Kanto/Johto/Hoenn/Sinnoh/Unova), with level, item and four
// moves per Pokémon, plus several rotating team variants per leader. Unlike the
// Fandom wiki, it covers Sinnoh. Gym leaders only (no Elite Four / champions —
// those still come from the wiki scrape).
//
// The Team sheet is one row per Pokémon. Resolved columns (0-based):
//   5 Region · 6 "City「Leader」" · 7 team-variant# · 8 description ·
//   10 Level · 11 English species · 18 Item · 19-22 Moves
// (Types are cosmetic here and taken from pokemmo.json instead; the Abilities
// column ships empty in the sheet.)
//
// Output: data/raw/gym-teams.json — grouped by region→leader→variant, each
// species/move/item resolved to a pokemmo.json id where possible. Misses are
// reported to stderr (they keep their text name with a null id).
//
// Usage:
//   node scripts/parse-gym-xlsx.mjs <path-to.xlsx> [--out=path]
//
// The .xlsx is ~48 MB (embedded sprites) — not committed; download it from the
// forum thread and pass its path. Only this small JSON is kept.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const args = process.argv.slice(2);
const flag = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}`));
  if (!hit) return def;
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : true;
};
const ROOT = process.cwd();
const xlsxPath = args.find((a) => !a.startsWith('--')) || path.join(ROOT, 'data/raw/gym-teams.xlsx');
const outPath = flag('out', path.join(ROOT, 'data/raw/gym-teams.json'));

if (!fs.existsSync(xlsxPath)) {
  console.error(`Error: xlsx not found: ${xlsxPath}\nPass the downloaded spreadsheet path:  node scripts/parse-gym-xlsx.mjs <file.xlsx>`);
  process.exit(1);
}

/* ── minimal zip reader (central directory + DEFLATE), dependency-free ── */
function unzip(buf) {
  // Locate End Of Central Directory record (scan back for signature 0x06054b50).
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) { if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error('not a zip (no EOCD)');
  let cd = buf.readUInt32LE(eocd + 16);     // central directory offset
  const count = buf.readUInt16LE(eocd + 10);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(cd) !== 0x02014b50) break;
    const method = buf.readUInt16LE(cd + 10);
    const compSize = buf.readUInt32LE(cd + 20);
    const nameLen = buf.readUInt16LE(cd + 28);
    const extraLen = buf.readUInt16LE(cd + 30);
    const commentLen = buf.readUInt16LE(cd + 32);
    const localOff = buf.readUInt32LE(cd + 42);
    const name = buf.toString('utf8', cd + 46, cd + 46 + nameLen);
    // Jump to the local header to find where the data actually starts.
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    files.set(name, method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw));
    cd += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/* ── tiny xlsx readers (shared strings + a worksheet grid) ── */
const dec = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
function readSharedStrings(xml) {
  const out = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) out.push([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((r) => dec(r[1])).join(''));
  return out;
}
const colIndex = (ref) => { const c = ref.match(/^[A-Z]+/)[0]; let n = 0; for (const ch of c) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
function readSheet(xml, strings) {
  const rows = [];
  for (const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cm of rm[1].matchAll(/<c r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)<\/c>/g)) {
      const ci = colIndex(cm[1]);
      const t = (cm[2].match(/t="([^"]+)"/) || [])[1];
      const inner = cm[3];
      let v = '';
      if (t === 's') v = strings[+(inner.match(/<v>(\d+)<\/v>/) || [])[1]] ?? '';
      else if (t === 'inlineStr') v = dec((inner.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1] || '');
      else v = dec((inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1] || '');
      cells[ci] = v;
    }
    rows.push(cells);
  }
  return rows;
}

/* ── load workbook, find the "Team" sheet ── */
const zip = unzip(fs.readFileSync(xlsxPath));
const get = (name) => { const b = zip.get(name); if (!b) throw new Error(`missing ${name} in xlsx`); return b.toString('utf8'); };
const wb = get('xl/workbook.xml');
const rels = get('xl/_rels/workbook.xml.rels');
const relMap = {};
for (const m of rels.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) relMap[m[1]] = m[2];
const sheetRel = [...wb.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].find((m) => m[1] === 'Team');
if (!sheetRel) throw new Error('no "Team" sheet in workbook');
const strings = readSharedStrings(get('xl/sharedStrings.xml'));
const rows = readSheet(get('xl/' + relMap[sheetRel[2]].replace(/^\/?/, '')), strings);

/* ── extract mon rows → grouped trainer variants ── */
const DASH = /^[-−—–\s]*$/;
const COL = { region: 5, leader: 6, variant: 7, desc: 8, level: 10, species: 11, item: 18, m1: 19, m2: 20, m3: 21, m4: 22 };
function parseLeader(raw) {
  // "Pewter_City「Brock」" / "Vermilion_City「Lt._Surge」" → { location, trainer }
  const m = String(raw).match(/^(.*?)[「\[](.+?)[」\]]\s*$/);
  const loc = (m ? m[1] : raw).replace(/_/g, ' ').trim();
  const trainer = (m ? m[2] : raw).replace(/_/g, ' ').trim();
  return { location: loc, trainer };
}

const groups = new Map(); // region|leader|variant -> { ...meta, team:[] }
for (const r of rows.slice(2)) {
  const region = r[COL.region];
  const species = r[COL.species];
  if (!region || !species || DASH.test(species)) continue;
  const { location, trainer } = parseLeader(r[COL.leader] || '');
  const variant = (r[COL.variant] || '1').trim();
  const key = `${region}|${trainer}|${variant}`;
  if (!groups.has(key)) groups.set(key, { region: region.toLowerCase(), location, trainer, variant, description: r[COL.desc] || null, team: [] });
  const moves = [r[COL.m1], r[COL.m2], r[COL.m3], r[COL.m4]].map((x) => (x || '').trim()).filter((x) => x && !DASH.test(x));
  const item = (r[COL.item] || '').trim();
  groups.get(key).team.push({
    species: species.trim(),
    level: Number(r[COL.level]) || null,
    item: item && !DASH.test(item) ? item : null,
    moves,
  });
}
const trainers = [...groups.values()];

/* ── resolve names → pokemmo.json ids ── */
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const dataPath = path.join(ROOT, 'public/data/pokemmo.json');
const miss = { species: new Map(), moves: new Map(), items: new Map() };
const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
if (fs.existsSync(dataPath)) {
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const sp = new Map(data.pokemon.map((p) => [norm(p.name), p]));
  const mv = new Map(Object.values(data.moves).map((m) => [norm(m.name), m]));
  // pokemmo.json suffixes items with one or more stat tags, e.g.
  // "Choice Scarf (ATK)(SPEED)" — strip every trailing "(…)" group to the base.
  const stripParen = (s) => String(s).replace(/(\s*\([^)]*\))+\s*$/, '');
  const it = new Map();
  for (const x of Object.values(data.items || {})) { const k = norm(stripParen(x.name)); if (!it.has(k)) it.set(k, x); }
  // The sheet uses a few names the dataset spells differently / form suffixes.
  const MOVE_ALIAS = { 'high jump kick': 'hi jump kick' };
  const baseSpecies = (s) => s.replace(/\s+-\s+.+$/, '').trim(); // "Jellicent - Female" → "Jellicent"
  const findSpecies = (name) => sp.get(norm(name)) || sp.get(norm(baseSpecies(name)));
  const findMove = (name) => mv.get(norm(name)) || mv.get(norm(MOVE_ALIAS[name.toLowerCase()] || '\0'));
  for (const t of trainers) {
    for (const mon of t.team) {
      const s = findSpecies(mon.species);
      if (s) { mon.speciesId = s.id; mon.species = s.name; mon.types = s.types; }
      else { mon.speciesId = null; mon.types = []; bump(miss.species, mon.species); }
      mon.moveIds = mon.moves.map((m) => { const x = findMove(m); if (!x) bump(miss.moves, m); return x ? x.id : null; });
      if (mon.item) { const x = it.get(norm(mon.item)) || it.get(norm(stripParen(mon.item))); mon.itemId = x ? x.id : null; if (!x) bump(miss.items, mon.item); }
      else mon.itemId = null;
    }
  }
}

/* ── write + report ── */
const byRegion = {};
for (const t of trainers) byRegion[t.region] = (byRegion[t.region] || 0) + 1;
const totalMons = trainers.reduce((a, t) => a + t.team.length, 0);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({
  _source: 'PokeMMO Gym Leader Team Query Form — forums.pokemmo.com/index.php?/topic/194839 (xlsx 2026-03-16)',
  _note: 'Gym leaders only, all five regions incl. Sinnoh. Types from pokemmo.json by species.',
  regions: byRegion,
  trainerVariants: trainers.length,
  trainers,
}, null, 1));

const top = (m, n = 14) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, c]) => `${k}×${c}`);
const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);
console.error(`✓ ${trainers.length} gym-leader variants, ${totalMons} mons — regions: ${JSON.stringify(byRegion)}`);
console.error(`  Unresolved — species: ${sum(miss.species)}, moves: ${sum(miss.moves)}, items: ${sum(miss.items)}`);
if (miss.species.size) console.error(`    species: ${top(miss.species).join(', ')}`);
if (miss.moves.size) console.error(`    moves: ${top(miss.moves).join(', ')}`);
if (miss.items.size) console.error(`    items: ${top(miss.items).join(', ')}`);
console.error(`\nWrote ${outPath}`);
