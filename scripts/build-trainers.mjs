// build-trainers.mjs — merge the trainer-team sources into one app-facing file.
//
// Inputs (both already id-mapped to pokemmo.json):
//   data/raw/gym-teams.json     — gym leaders, all five regions (incl. Sinnoh)
//   data/raw/trainers-wiki.json — Elite Four / champions (+ routes we ignore),
//                                 Kanto/Johto/Hoenn/Unova only
//
// Output: public/data/trainers.json — fetched at runtime by the Gym & E4 Prep
// page. One record per trainer, grouped region→name with team variants.
//
//   { trainers: [ { id, region, name, location, kind, variants: [
//       { label, description, reward, team: [
//         { speciesId, species, level, item, itemId, moves:[name], moveIds:[id],
//           ability, abilityId, types:[] } ] } ] } ] }
//
// Run: node scripts/build-trainers.mjs   (after the two raw files exist)

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const gymRaw = read('data/raw/gym-teams.json');
const wikiRaw = fs.existsSync(path.join(ROOT, 'data/raw/trainers-wiki.json')) ? read('data/raw/trainers-wiki.json') : { trainers: [] };

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const cleanMon = (m) => ({
  speciesId: m.speciesId ?? null,
  species: m.species,
  level: m.level ?? null,
  item: m.item ?? null,
  itemId: m.itemId ?? null,
  moves: m.moves || [],
  moveIds: m.moveIds || [],
  ability: m.ability ?? null,
  abilityId: m.abilityId ?? null,
  types: m.types || [],
});

/* ── gym leaders (from the xlsx) ── */
const records = new Map(); // id -> record
function ensure(region, name, location, kind) {
  const id = `${region}-${slug(name)}`;
  if (!records.has(id)) records.set(id, { id, region, name, location: location || null, kind, variants: [] });
  return records.get(id);
}
for (const t of gymRaw.trainers || []) {
  const rec = ensure(t.region, t.trainer, t.location, 'gym');
  rec.variants.push({
    label: `Team ${t.variant}`,
    description: t.description || null,
    reward: t.reward ?? null,
    team: (t.team || []).map(cleanMon),
  });
}
// Stable variant order (Team 1, 2, …).
for (const rec of records.values()) rec.variants.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));

/* ── Elite Four + champions (from the wiki) ── */
// Curated rosters so we only pull the high-value trainers (and skip routes).
const E4 = new Set(['Lorelei', 'Bruno', 'Agatha', 'Lance', 'Will', 'Karen', 'Sidney', 'Phoebe', 'Glacia', 'Drake', 'Aaron', 'Bertha', 'Flint', 'Lucian', 'Shauntal', 'Grimsley', 'Caitlin', 'Marshal']);
const CHAMP = new Set(['Blue', 'Steven', 'Wallace', 'Cynthia', 'Alder', 'Iris', 'Red', 'Trace', 'Green']);
function classify(t) {
  const title = (t.title || '').toLowerCase();
  if (/gym leader/.test(title)) return null;          // gyms come from the xlsx
  if (/champion/.test(title)) return 'champion';
  if (/elite|four/.test(title)) return 'e4';
  if (CHAMP.has(t.key)) return 'champion';
  if (E4.has(t.key)) return 'e4';
  return null;                                        // routes / rivals — skip for v1
}
for (const t of wikiRaw.trainers || []) {
  const kind = classify(t);
  if (!kind) continue;
  const rec = ensure(t.region, t.key, t.page && !/\(/.test(t.page) ? t.page : null, kind);
  if (rec.kind === 'gym') rec.kind = kind;            // prefer e4/champion label if it slipped in as gym
  rec.variants.push({
    label: t.variant && t.variant !== 'Default' ? t.variant : 'Team',
    description: null,
    reward: t.reward ?? null,
    team: (t.team || []).map(cleanMon),
  });
}

/* ── write + report ── */
const REGION_ORDER = ['kanto', 'johto', 'hoenn', 'sinnoh', 'unova'];
const KIND_ORDER = { gym: 0, e4: 1, champion: 2 };
const trainers = [...records.values()]
  .filter((r) => r.variants.length)
  .sort((a, b) =>
    (REGION_ORDER.indexOf(a.region) - REGION_ORDER.indexOf(b.region)) ||
    ((KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9)) ||
    a.name.localeCompare(b.name));

const outPath = path.join(ROOT, 'public/data/trainers.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({
  _generated: 'scripts/build-trainers.mjs',
  _sources: ['data/raw/gym-teams.json', 'data/raw/trainers-wiki.json'],
  trainers,
}, null, 0));

const summary = {};
for (const t of trainers) { summary[t.region] = summary[t.region] || {}; summary[t.region][t.kind] = (summary[t.region][t.kind] || 0) + 1; }
const totalVariants = trainers.reduce((a, t) => a + t.variants.length, 0);
const totalMons = trainers.reduce((a, t) => a + t.variants.reduce((x, v) => x + v.team.length, 0), 0);
console.log(`✓ ${trainers.length} trainers, ${totalVariants} variants, ${totalMons} mons`);
for (const r of REGION_ORDER) if (summary[r]) console.log(`  ${r.padEnd(7)} ${JSON.stringify(summary[r])}`);
console.log(`Wrote ${path.relative(ROOT, outPath)} (${(fs.statSync(outPath).size / 1024).toFixed(0)} KB)`);
