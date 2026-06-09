// Consensus aggregation of community Trainer Scribe contributions.
//
// Reads a directory of contribution files (each a scribe export
// { version, trainers:{ key: profile } } from one contributor), tallies
// agreement across contributors, validates against the dataset, and fills a
// region's trainerInstances catalog with confidence-annotated teams.
//
// Why consensus: a single contributor's OCR can misread a move or level. A
// datum is only "confirmed" once >= --min-sources independent contributors
// report it; junk that doesn't validate against the dex is dropped outright.
//
// Usage:
//   node scripts/aggregate-contributions.mjs [--dir=data/contributions]
//        [--region=sinnoh] [--min-sources=2] [--dry-run] [--out=path]

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name, def) => {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return def;
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : true;
};

const ROOT = process.cwd();
const dir = flag('dir', 'data/contributions');
const region = flag('region', 'sinnoh');
const minSources = Number(flag('min-sources', 2)) || 1;
const dryRun = !!flag('dry-run', false);
const outPath = flag('out', null);

const catalogPath = path.join(ROOT, 'public/data/maps', region, 'trainer-instances.json');
const dataPath = path.join(ROOT, 'public/data/pokemmo.json');
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const die = (m) => { console.error('Error: ' + m); process.exit(1); };

if (!fs.existsSync(dir)) die(`contributions dir not found: ${dir}`);
if (!fs.existsSync(catalogPath)) die(`catalog not found: ${catalogPath} (is --region right?)`);
if (!fs.existsSync(dataPath)) die(`dataset not found: ${dataPath} — run npm run build:data first`);

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const spByName = new Map(data.pokemon.map((p) => [norm(p.name), p]));
const mvByName = new Map(Object.values(data.moves).map((m) => [norm(m.name), m]));

// Each contribution file = one contributor (filename is the contributor id).
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
if (!files.length) die(`no .json contributions in ${dir}`);
const contributions = files.map((f) => ({
  contributor: f.replace(/\.json$/, ''),
  store: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')),
}));

// Index catalog instances by normalized trainer name.
const instances = catalog.trainerInstances || {};
const byName = new Map();
for (const k of Object.keys(instances)) {
  const inst = instances[k];
  if (!inst?.trainerName) continue;
  const nn = norm(inst.trainerName);
  if (!byName.has(nn)) byName.set(nn, []);
  byName.get(nn).push(inst);
}
function resolveTrainerIds(name, route) {
  const candidates = byName.get(norm(name)) || [];
  if (!candidates.length) return null;
  const zoneMatch = candidates.filter((c) => norm(c.zoneName) === norm(route));
  if (zoneMatch.length) return [...new Set(zoneMatch.map((c) => c.trainerId))];
  const ids = new Set(candidates.map((c) => c.trainerId));
  return ids.size === 1 ? [...ids] : null; // ambiguous → skip
}

const mode = (arr) => {
  if (!arr.length) return null;
  const counts = new Map();
  for (const v of arr) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
};

// Tally votes per trainerId.
const votes = new Map(); // trainerId -> { contributors:Set, rewards:[], species:Map }
const stats = { contributions: contributions.length, profiles: 0, unresolved: 0, droppedSpecies: 0, droppedMoves: 0 };

for (const { contributor, store } of contributions) {
  for (const prof of Object.values(store?.trainers || {})) {
    stats.profiles++;
    const ids = resolveTrainerIds(prof.name, prof.route);
    if (!ids) { stats.unresolved++; continue; }
    for (const tid of ids) {
      let v = votes.get(tid);
      if (!v) { v = { contributors: new Set(), rewards: [], species: new Map() }; votes.set(tid, v); }
      v.contributors.add(contributor);
      if (prof.reward != null) v.rewards.push(prof.reward);
      for (const mon of prof.team || []) {
        const sp = spByName.get(norm(mon.species));
        if (!sp) { stats.droppedSpecies++; continue; }
        let s = v.species.get(sp.id);
        if (!s) { s = { id: sp.id, name: sp.name, levels: [], genders: [], contributors: new Set(), moves: new Map() }; v.species.set(sp.id, s); }
        s.contributors.add(contributor);
        if (mon.level) s.levels.push(mon.level);
        if (mon.gender) s.genders.push(mon.gender);
        for (const mvRaw of mon.moves || []) {
          const mvName = typeof mvRaw === 'string' ? mvRaw : mvRaw?.name;
          const mv = mvByName.get(norm(mvName));
          if (!mv) { stats.droppedMoves++; continue; }
          let e = s.moves.get(mv.id);
          if (!e) { e = { id: mv.id, name: mv.name, contributors: new Set() }; s.moves.set(mv.id, e); }
          e.contributors.add(contributor);
        }
      }
    }
  }
}

// Build confidence-annotated canonical teams.
const resolved = new Map(); // trainerId -> { team, reward, sources }
for (const [tid, v] of votes) {
  const team = [...v.species.values()]
    .sort((a, b) => b.contributors.size - a.contributors.size)
    .map((s) => ({
      speciesId: s.id,
      species: s.name,
      level: mode(s.levels),
      gender: mode(s.genders),
      sources: s.contributors.size,
      confirmed: s.contributors.size >= minSources,
      moves: [...s.moves.values()]
        .sort((a, b) => b.contributors.size - a.contributors.size)
        .map((m) => ({ id: m.id, name: m.name, sources: m.contributors.size, confirmed: m.contributors.size >= minSources })),
    }));
  resolved.set(tid, { team, reward: mode(v.rewards), sources: v.contributors.size });
}

// Apply to all instances of each resolved trainerId.
let filled = 0;
for (const k of Object.keys(instances)) {
  const inst = instances[k];
  const r = resolved.get(inst?.trainerId);
  if (r) { inst.team = r.team; if (r.reward != null) inst.rewardAmount = r.reward; filled++; }
}

console.log(`Contributions: ${stats.contributions} · profiles ${stats.profiles} · unresolved ${stats.unresolved}`);
console.log(`Dropped (not in dex): ${stats.droppedSpecies} species, ${stats.droppedMoves} moves`);
console.log(`Resolved ${resolved.size} trainers (min-sources=${minSources}); filled ${filled} catalog instances.`);

if (dryRun) {
  // Show a sample so consensus is inspectable.
  const sample = [...resolved.entries()].slice(0, 3);
  for (const [tid, r] of sample) {
    console.log(`\ntrainerId ${tid} (${r.sources} contributor${r.sources === 1 ? '' : 's'}, reward ${r.reward ?? '?'}):`);
    for (const m of r.team) console.log(`  ${m.species} Lv${m.level ?? '?'} ${m.gender || ''} [${m.confirmed ? '✓' : '?'}${m.sources}] — ${m.moves.map((x) => `${x.name}(${x.confirmed ? '✓' : '?'}${x.sources})`).join(', ')}`);
  }
  console.log('\n(dry run — nothing written)');
} else {
  const out = outPath || catalogPath;
  fs.writeFileSync(out, JSON.stringify(catalog, null, 1));
  console.log(`Wrote ${out}`);
}
