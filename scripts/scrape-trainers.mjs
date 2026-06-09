// scrape-trainers.mjs — pull PokéMMO trainer teams from the PokéMMO Fandom wiki.
//
// The wiki documents gym leaders, the Elite Four, champions, rivals and many
// route/town trainers using a single structured template, {{trainerentry}}:
//
//   {{trainerentry| <sprite> | <Title [[Name]]> | <reward$> | <count>
//     | <species> | <type1> | <type2> | <level> | {{tb|Move|type}}×4 | {{tb|Ability}} <br> {{it|Item}}
//     | ...next mon... }}
//
// Coverage (verified June 2026): Kanto, Johto, Hoenn, Unova are well populated;
// Sinnoh is essentially absent on the wiki (filled from the datamined scaffold
// + OCR instead). The sprite field ("Spr Kanto Brock.png") encodes the region.
//
// Output: data/raw/trainers-wiki.json — every trainer × variant × full team,
// with each species/move/item/ability resolved to a pokemmo.json id where
// possible. A coverage report (unmatched names) is printed to stderr.
//
// Source: https://pokemmo.fandom.com (CC-BY-SA). Used with attribution for a
// non-commercial fan tool. One-time, low-rate scrape (~100 pages, concurrency 6).
//
// Usage:
//   node scripts/scrape-trainers.mjs [--region=hoenn] [--out=path] [--limit=N]

import fs from 'node:fs';
import path from 'node:path';

const API = 'https://pokemmo.fandom.com/api.php';
const RAW = (title) => `https://pokemmo.fandom.com/wiki/${encodeURIComponent(title)}?action=raw`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TEMPLATE = 'Template:Trainerentry';

const args = process.argv.slice(2);
const flag = (name, def) => {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return def;
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : true;
};
const ROOT = process.cwd();
const onlyRegion = (flag('region', null) || '').toLowerCase() || null;
const outPath = flag('out', path.join(ROOT, 'data/raw/trainers-wiki.json'));
const limit = Number(flag('limit', 0)) || 0;

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const DASH = /^[-−—–\s]*$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}
async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// List every page that transcludes {{trainerentry}} (paginated).
async function listTrainerPages() {
  const titles = [];
  let cont = null;
  do {
    const u = new URL(API);
    u.search = new URLSearchParams({
      action: 'query', list: 'embeddedin', eititle: TEMPLATE,
      eilimit: '500', einamespace: '0', format: 'json',
      ...(cont ? { eicontinue: cont } : {}),
    }).toString();
    const j = await getJSON(u.toString());
    for (const it of j.query?.embeddedin || []) titles.push(it.title);
    cont = j.continue?.eicontinue || null;
  } while (cont);
  // Drop template/meta pages that happen to embed the template as an example.
  return titles.filter((t) => !/^Template:|^Style guide|^Category:/.test(t));
}

// Split a {{trainerentry|...}} body on top-level pipes (ignore | inside {{}} / [[]]).
function splitTopPipes(s) {
  const out = [];
  let depthC = 0, depthB = 0, buf = '';
  for (let i = 0; i < s.length; i++) {
    const two = s.slice(i, i + 2);
    if (two === '{{') { depthC++; buf += two; i++; continue; }
    if (two === '}}') { depthC--; buf += two; i++; continue; }
    if (two === '[[') { depthB++; buf += two; i++; continue; }
    if (two === ']]') { depthB--; buf += two; i++; continue; }
    if (s[i] === '|' && depthC === 0 && depthB === 0) { out.push(buf); buf = ''; continue; }
    buf += s[i];
  }
  out.push(buf);
  return out;
}

// Extract every brace-balanced {{trainerentry ... }} block + its char index.
function extractEntries(wikitext) {
  const blocks = [];
  const needle = '{{trainerentry';
  let from = 0;
  while (true) {
    const start = wikitext.indexOf(needle, from);
    if (start === -1) break;
    let depth = 0, i = start;
    for (; i < wikitext.length; i++) {
      if (wikitext.slice(i, i + 2) === '{{') { depth++; i++; continue; }
      if (wikitext.slice(i, i + 2) === '}}') { depth--; i++; if (depth === 0) break; }
    }
    blocks.push({ index: start, body: wikitext.slice(start + needle.length, i - 1) });
    from = i;
  }
  return blocks;
}

// Map each entry to the nearest preceding {{{include|LABEL}}} (its variant).
function variantLabels(wikitext) {
  const marks = [];
  const re = /\{\{\{include\|([^}|]+)\}\}\}/g;
  let m;
  while ((m = re.exec(wikitext))) marks.push({ index: m.index, label: m[1].trim() });
  return marks;
}
function labelFor(marks, index) {
  let label = 'Default';
  for (const mk of marks) { if (mk.index < index) label = mk.label; else break; }
  return label;
}

function cleanName(raw) {
  // "Gym Leader [[Brock]]" -> { title: "Gym Leader Brock", key: "Brock" }
  let s = String(raw).trim();
  const link = s.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/);
  const key = link ? link[1].trim() : s.replace(/\[\[|\]\]/g, '').trim();
  s = s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[|\]\]/g, '').trim();
  return { title: s, key };
}

function parseMoves(field) {
  const out = [];
  const re = /\{\{tb\|([^|}]+)(?:\|[^}]*)?\}\}/g;
  let m;
  while ((m = re.exec(field))) {
    const mv = m[1].trim();
    if (!DASH.test(mv)) out.push(mv);
  }
  return out;
}
function parseAbilityItem(field) {
  const ab = field.match(/\{\{tb\|([^|}]+)(?:\|[^}]*)?\}\}/);
  const ability = ab && !DASH.test(ab[1]) ? ab[1].trim() : null;
  const it = field.match(/\{\{it\|([^|}]+)(?:\|[^}]*)?\}\}/);
  let item = it ? it[1].trim() : null;
  if (!item && /''?\s*None\s*''?/i.test(field)) item = null;
  return { ability, item };
}

function parseEntry(body) {
  const tok = splitTopPipes(body).map((t) => t.trim());
  // The body starts right after "{{trainerentry", i.e. with the leading "|",
  // so splitTopPipes yields an empty first token — drop it so field 0 is the
  // sprite, 1 the name, 2 the reward, 3 the count, 4+ the mons.
  if (tok.length && tok[0] === '') tok.shift();
  const sprite = tok[0] || '';
  // Sprite is "Spr Kanto Brock.png" / "Spr_Johto_Silver.png" — region is the
  // first word after "Spr". Use [A-Za-z]+ (not \w+) so an underscore separator
  // doesn't swallow the trainer name into the region.
  const region = (sprite.match(/Spr[_ ]+([A-Za-z]+)/i) || [])[1] || null;
  const { title, key } = cleanName(tok[1] || '');
  const reward = (() => { const n = Number(String(tok[2] || '').replace(/[,\s$]/g, '')); return Number.isFinite(n) && tok[2] ? n : null; })();
  const team = [];
  const mons = tok.slice(4);
  for (let i = 0; i + 5 < mons.length; i += 6) {
    const species = mons[i];
    if (!species || DASH.test(species)) continue;
    const type1 = mons[i + 1] && !DASH.test(mons[i + 1]) ? mons[i + 1].toLowerCase() : null;
    const type2 = mons[i + 2] && !DASH.test(mons[i + 2]) ? mons[i + 2].toLowerCase() : null;
    const level = (mons[i + 3] || '').trim() || null;
    const moves = parseMoves(mons[i + 4] || '');
    const { ability, item } = parseAbilityItem(mons[i + 5] || '');
    team.push({ species, types: [type1, type2].filter(Boolean), level, moves, ability, item });
  }
  return { region, title, key, reward, team };
}

function parsePage(title, wt) {
  if (!wt || !wt.trim()) return [];
  const marks = variantLabels(wt);
  return extractEntries(wt)
    .map(({ index, body }) => {
      const e = parseEntry(body);
      if (!e.team.length) return null;
      return { page: title, variant: labelFor(marks, index), ...e };
    })
    .filter(Boolean);
}

// Batch-fetch wikitext for many titles via the MediaWiki API (≤50 titles per
// request, formatversion=2). One gentle pass instead of ~100 raw hits — the
// per-page ?action=raw route gets rate-limited under concurrency.
async function fetchWikitexts(titles) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const u = new URL(API);
    u.search = new URLSearchParams({
      action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main',
      titles: batch.join('|'), format: 'json', formatversion: '2',
    }).toString();
    const j = await getJSON(u.toString());
    for (const p of j.query?.pages || []) {
      const content = p.revisions?.[0]?.slots?.main?.content;
      if (content) out.set(p.title, content);
    }
    await sleep(250);
  }
  return out;
}

(async () => {
  console.error('► Listing trainer pages…');
  let pages = await listTrainerPages();
  if (limit) pages = pages.slice(0, limit);
  console.error(`  ${pages.length} pages.`);

  console.error('► Fetching wikitext (batched)…');
  const wikitexts = await fetchWikitexts(pages);
  console.error('► Parsing…');
  const trainers = [];
  const errors = [];
  for (const title of pages) {
    const wt = wikitexts.get(title);
    if (!wt) { errors.push({ page: title }); continue; }
    try { trainers.push(...parsePage(title, wt)); }
    catch (err) { errors.push({ page: title, __error: String(err) }); }
  }

  // Region tagging + optional filter.
  for (const t of trainers) t.region = (t.region || 'Unknown').toLowerCase();
  const filtered = onlyRegion ? trainers.filter((t) => t.region === onlyRegion) : trainers;

  // Resolve names against the dataset (best-effort; report misses).
  const dataPath = path.join(ROOT, 'public/data/pokemmo.json');
  let resolve = null, miss = { species: new Map(), moves: new Map(), items: new Map(), abilities: new Map() };
  if (fs.existsSync(dataPath)) {
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    const sp = new Map(data.pokemon.map((p) => [norm(p.name), p]));
    const mv = new Map(Object.values(data.moves).map((m) => [norm(m.name), m]));
    const ab = new Map(Object.values(data.abilities || {}).map((x) => [norm(x.name), x]));
    // pokemmo.json suffixes held items with a stat tag, e.g. "Sitrus Berry (HP)".
    // Key the lookup on the base name so trainer items ("Sitrus Berry") resolve.
    const stripParen = (s) => String(s).replace(/\s*\([^)]*\)\s*$/, '');
    const it = new Map();
    for (const x of Object.values(data.items || {})) { const k = norm(stripParen(x.name)); if (!it.has(k)) it.set(k, x); }
    const bump = (map, k) => map.set(k, (map.get(k) || 0) + 1);
    resolve = (t) => {
      for (const mon of t.team) {
        const s = sp.get(norm(mon.species)); mon.speciesId = s ? s.id : null; if (!s) bump(miss.species, mon.species);
        mon.moveIds = mon.moves.map((m) => { const x = mv.get(norm(m)); if (!x) bump(miss.moves, m); return x ? x.id : null; });
        if (mon.ability) { const x = ab.get(norm(mon.ability)); mon.abilityId = x ? x.id : null; if (!x) bump(miss.abilities, mon.ability); }
        if (mon.item) { const x = it.get(norm(mon.item)); mon.itemId = x ? x.id : null; if (!x) bump(miss.items, mon.item); }
      }
    };
    filtered.forEach(resolve);
  }

  const byRegion = {};
  for (const t of filtered) (byRegion[t.region] ||= []).push(t);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const payload = {
    _source: 'https://pokemmo.fandom.com (CC-BY-SA)',
    _scrapedPages: pages.length,
    _trainerVariants: filtered.length,
    regions: Object.fromEntries(Object.entries(byRegion).map(([k, v]) => [k, v.length])),
    trainers: filtered,
  };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 1));

  // ── report ──
  const totalMons = filtered.reduce((a, t) => a + t.team.length, 0);
  const top = (map, n = 12) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, c]) => `${k}×${c}`);
  console.error(`\n✓ ${filtered.length} trainer-variants across regions: ${JSON.stringify(payload.regions)}`);
  console.error(`  ${totalMons} mons total.`);
  if (resolve) {
    const sumMiss = (m) => [...m.values()].reduce((a, b) => a + b, 0);
    console.error(`  Unresolved — species: ${sumMiss(miss.species)}, moves: ${sumMiss(miss.moves)}, items: ${sumMiss(miss.items)}, abilities: ${sumMiss(miss.abilities)}`);
    if (miss.species.size) console.error(`    species misses: ${top(miss.species).join(', ')}`);
    if (miss.moves.size) console.error(`    move misses: ${top(miss.moves).join(', ')}`);
    if (miss.items.size) console.error(`    item misses: ${top(miss.items).join(', ')}`);
    if (miss.abilities.size) console.error(`    ability misses: ${top(miss.abilities).join(', ')}`);
  }
  if (errors.length) console.error(`  ⚠ ${errors.length} page error(s): ${errors.map((e) => e.page).join(', ')}`);
  console.error(`\nWrote ${outPath}`);
})();
