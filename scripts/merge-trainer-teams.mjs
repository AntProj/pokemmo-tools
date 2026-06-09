// Merge a Trainer Scribe export (trainer-teams.json) into a region's
// trainerInstances catalog — filling the empty `team` / `rewardAmount` fields
// the catalog ships, by resolving each scribe profile's (name + route) to a
// trainerId. A trainer's team is per-trainerId, so once one placement matches,
// every placement of that trainer is filled.
//
// Usage:
//   node scripts/merge-trainer-teams.mjs <trainer-teams.json> [--region=johto] [--dry-run] [--out=path]
//
// Defaults: trainer-teams.json in cwd, region=sinnoh, writes the catalog in place.

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name, def) => {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return def;
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : true;
};
const positional = args.filter((a) => !a.startsWith('--'));

const ROOT = process.cwd();
const teamsPath = positional[0] || 'trainer-teams.json';
const region = flag('region', 'sinnoh');
const dryRun = !!flag('dry-run', false);
const outPath = flag('out', null);

const catalogPath = path.join(ROOT, 'public/data/maps', region, 'trainer-instances.json');
const dataPath = path.join(ROOT, 'public/data/pokemmo.json');

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function die(msg) { console.error('Error: ' + msg); process.exit(1); }

if (!fs.existsSync(teamsPath)) die(`scribe export not found: ${teamsPath}`);
if (!fs.existsSync(catalogPath)) die(`catalog not found: ${catalogPath} (is --region right?)`);
if (!fs.existsSync(dataPath)) die(`dataset not found: ${dataPath} — run npm run build:data first`);

const teams = JSON.parse(fs.readFileSync(teamsPath, 'utf8'));
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

const spByName = new Map(data.pokemon.map((p) => [norm(p.name), p]));
const mvByName = new Map(Object.values(data.moves).map((m) => [norm(m.name), m]));

function resolveMon(t) {
  const sp = spByName.get(norm(t.species));
  return {
    speciesId: sp ? sp.id : null,
    species: sp ? sp.name : t.species,
    level: t.level ?? null,
    gender: t.gender ?? null,
    moves: (t.moves || []).map((mv) => {
      const m = mvByName.get(norm(mv));
      return m ? { id: m.id, name: m.name } : { id: null, name: mv };
    }),
  };
}

const instances = catalog.trainerInstances || {};
const byName = new Map(); // normName -> [instance]
for (const k of Object.keys(instances)) {
  const inst = instances[k];
  if (!inst || !inst.trainerName) continue;
  const nn = norm(inst.trainerName);
  if (!byName.has(nn)) byName.set(nn, []);
  byName.get(nn).push(inst);
}

const profiles = Object.values(teams.trainers || {});
if (!profiles.length) die('no trainer profiles in the scribe export.');

const resolved = new Map(); // trainerId -> { team, reward }
const report = [];
for (const prof of profiles) {
  const candidates = byName.get(norm(prof.name)) || [];
  if (!candidates.length) { report.push(`SKIP   ${prof.name} — no catalog trainer by that name`); continue; }
  const zoneMatch = candidates.filter((c) => norm(c.zoneName) === norm(prof.route));
  let chosen;
  if (zoneMatch.length) chosen = zoneMatch;
  else {
    const ids = new Set(candidates.map((c) => c.trainerId));
    if (ids.size === 1) chosen = candidates;
    else { report.push(`AMBIG  ${prof.name} @ ${prof.route} — ${ids.size} trainerIds, no zone match (skipped)`); continue; }
  }
  const team = (prof.team || []).map(resolveMon);
  const ids = [...new Set(chosen.map((c) => c.trainerId))];
  for (const tid of ids) resolved.set(tid, { team, reward: prof.reward ?? null });
  const unknown = team.filter((m) => m.speciesId == null).map((m) => m.species);
  report.push(`OK     ${prof.name} @ ${prof.route} → trainerId ${ids.join(',')} (${team.length} mon${unknown.length ? `, unresolved species: ${unknown.join(', ')}` : ''})`);
}

let filled = 0;
for (const k of Object.keys(instances)) {
  const inst = instances[k];
  const r = resolved.get(inst?.trainerId);
  if (r) { inst.team = r.team; if (r.reward != null) inst.rewardAmount = r.reward; filled++; }
}

console.log(report.join('\n'));
console.log(`\nResolved ${resolved.size} trainer${resolved.size === 1 ? '' : 's'}; filled ${filled} catalog instance${filled === 1 ? '' : 's'}.`);

if (dryRun) {
  console.log('(dry run — nothing written)');
} else {
  const out = outPath || catalogPath;
  fs.writeFileSync(out, JSON.stringify(catalog, null, 1));
  console.log(`Wrote ${out}`);
}
