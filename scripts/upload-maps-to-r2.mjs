#!/usr/bin/env node
/**
 * upload-maps-to-r2.mjs — region-parameterized map-asset sync for Cloudflare R2
 *
 * Usage:
 *   node scripts/upload-maps-to-r2.mjs [region] [flags]
 *
 * Examples:
 *   node scripts/upload-maps-to-r2.mjs sinnoh           — push Sinnoh new/changed
 *   node scripts/upload-maps-to-r2.mjs johto            — push Johto new/changed
 *   node scripts/upload-maps-to-r2.mjs sinnoh --dry-run — preview without writing
 *   node scripts/upload-maps-to-r2.mjs sinnoh --force   — re-upload everything
 *   node scripts/upload-maps-to-r2.mjs johto --prune-stale
 *                                                       — after upload, delete R2 objects
 *                                                         not present in local images/
 *   node scripts/upload-maps-to-r2.mjs --purge          — wipe ALL regions + sprites
 *
 * --purge always operates across every region; the per-region scoping only
 * applies to the upload / prune-stale paths. (Bucket-wide reset shouldn't be
 * region-aware — if you need to nuke just one region, do it manually with the
 * AWS CLI or extend this to a per-region purge.)
 *
 * Required env vars (see .env.example):
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
 *   R2_BUCKET (default: pokemmo-maps)
 *
 * Optional positional arg / env var:
 *   REGION  — sinnoh | johto (default: sinnoh). Determines which
 *             public/data/maps/<region>/images/ dir gets pushed and which
 *             R2 prefix it goes under (s3://<bucket>/<region>/images/).
 *
 * About --prune-stale:
 *   Filenames are content-hashed (e.g. `0344 - Route 203.05ae12bbef.webp`).
 *   Each data regeneration changes the hash for any PNG whose content
 *   changed, so old hashes become orphans in R2. --prune-stale lists every
 *   object in R2 under <region>/images/ and deletes whatever doesn't exist
 *   in the local images/ directory. Scoped per region — pruning Johto won't
 *   touch Sinnoh objects and vice versa. Local dir is the source of truth
 *   (the build script prunes its own orphans before upload).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  S3Client, ListObjectsV2Command, PutObjectCommand,
  HeadBucketCommand, DeleteObjectsCommand,
} from '@aws-sdk/client-s3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---------- args ----------
// Filter flags out first so the positional region arg can sit anywhere
// relative to flags — `upload-maps-to-r2.mjs johto --dry-run` and
// `--dry-run johto` are both valid.
const rawArgs    = process.argv.slice(2);
const dryRun     = rawArgs.includes('--dry-run');
const force      = rawArgs.includes('--force');
const purge      = rawArgs.includes('--purge');
const pruneStale = rawArgs.includes('--prune-stale');
const positional = rawArgs.filter(a => !a.startsWith('--'));

// ---------- region ----------
const REGION = (positional[0] || process.env.REGION || 'sinnoh').toLowerCase();
const VALID_REGIONS = ['sinnoh', 'johto'];
if (!VALID_REGIONS.includes(REGION)) {
  console.error(`\n  Unknown region "${REGION}". Valid: ${VALID_REGIONS.join(', ')}.\n`);
  process.exit(1);
}
console.log(`► Region: ${REGION}`);

// ---------- env ----------
const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET = 'pokemmo-maps',
} = process.env;

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
  console.error('\n  Missing Cloudflare R2 credentials.');
  console.error('  Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY first.');
  console.error('  See .env.example for a template.\n');
  process.exit(1);
}

const endpoint = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const s3 = new S3Client({
  region: 'auto',
  endpoint,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

try {
  await s3.send(new HeadBucketCommand({ Bucket: R2_BUCKET }));
} catch (e) {
  console.error(`\n  Cannot reach R2 bucket "${R2_BUCKET}" at ${endpoint}.`);
  console.error(`  ${e.name}: ${e.message}\n`);
  process.exit(1);
}

// ---------- paged list of every key under a prefix ----------
async function listAllKeys(prefix) {
  const out = new Map(); // key → size
  let token;
  do {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: R2_BUCKET,
      Prefix: prefix,
      ContinuationToken: token,
    }));
    for (const obj of res.Contents || []) out.set(obj.Key, obj.Size);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

// ---------- purge mode ----------
if (purge) {
  // Purge is intentionally cross-region — it's the nuke-from-orbit option
  // for a clean rebuild. Includes every known region prefix + sprites + the
  // legacy unscoped `maps/` prefix from before the per-region layout.
  console.log('► PURGE: deleting every object under sinnoh/, johto/, sprites/, unova/, maps/');
  const prefixes = ['sinnoh/', 'johto/', 'sprites/', 'unova/', 'maps/'];
  let totalDeleted = 0;
  for (const prefix of prefixes) {
    const keys = [...(await listAllKeys(prefix)).keys()];
    if (keys.length === 0) { console.log(`  ${prefix}: 0 objects`); continue; }
    console.log(`  ${prefix}: ${keys.length} objects`);
    if (dryRun) { totalDeleted += keys.length; continue; }
    // R2 DeleteObjects supports up to 1000 keys per call.
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      await s3.send(new DeleteObjectsCommand({
        Bucket: R2_BUCKET,
        Delete: { Objects: batch.map(Key => ({ Key })), Quiet: true },
      }));
      totalDeleted += batch.length;
      process.stdout.write(`\r  deleted ${totalDeleted}        `);
    }
    process.stdout.write('\n');
  }
  console.log(`\n► Purged ${totalDeleted} objects${dryRun ? ' (dry-run)' : ''}.`);
  process.exit(0);
}

// ---------- upload mode ----------
// Region map images are the only large asset we host on R2. They're served
// as WebP — build-map-data.mjs converts the Blender PNG output via sharp
// before placing them in public/data/maps/<region>/images/. WebP is ~25-50%
// smaller than the PNG source AND decodes faster in modern browsers.
// Trainer / NPC / item / sign sprites are baked INTO each map image by
// build_world.py's composite step (REACT_INTEGRATION.md §3.1) — there's no
// separate sprite upload.
//
// TARGETS is per-region: one entry per region we're syncing this run. Adding
// more regions = appending here, but the per-invocation REGION arg means we
// only push one region at a time. Run the script twice (once per region) to
// sync both.
// Each TARGETS entry is one local dir → one R2 prefix. `recursive: true`
// makes the walker descend (used for the tile pyramid, which is a deep
// `{z}/{x}/{y}.webp` tree). Non-recursive entries keep the original flat
// listdir behavior for the `images/` dir.
const TARGETS = [
  { local: path.join(ROOT, 'public', 'data', 'maps', REGION, 'images'), prefix: `${REGION}/images/`, ext: '.webp', mime: 'image/webp', recursive: false },
  // Tile pyramid for the overworld. Lives at <region>/tiles/overworld.<hash>/
  // — uploading the whole `tiles/` dir means any number of pyramids coexist
  // (Sinnoh + Johto + …) and the per-region prune-stale pass handles cleanup.
  // At ~5000 tiles for Sinnoh, the parallel-upload path below is mandatory.
  { local: path.join(ROOT, 'public', 'data', 'maps', REGION, 'tiles'),  prefix: `${REGION}/tiles/`,  ext: '.webp', mime: 'image/webp', recursive: true },
];

// Recursive listing for tile-pyramid uploads. Returns `{ localPath, key }`
// where `key` is the R2 object key (prefix + relative path with forward
// slashes — Windows backslashes would break TileLayer URL templating).
function listLocalFiles(target) {
  const out = [];
  const root = target.local;
  if (!fs.existsSync(root)) return out;
  if (!target.recursive) {
    for (const f of fs.readdirSync(root)) {
      if (!f.endsWith(target.ext)) continue;
      out.push({ localPath: path.join(root, f), key: `${target.prefix}${f}` });
    }
    return out;
  }
  function walk(dir, relParts) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      const next = [...relParts, ent.name];
      if (ent.isDirectory()) { walk(full, next); continue; }
      if (!ent.name.endsWith(target.ext)) continue;
      out.push({ localPath: full, key: `${target.prefix}${next.join('/')}` });
    }
  }
  walk(root, []);
  return out;
}

// PutObject one file. Body fits comfortably in memory for any single tile
// (<200 KB worst case), so we read fully — multipart upload would just add
// latency at this size.
async function putOne(localPath, key, mime) {
  const body = fs.readFileSync(localPath);
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: body,
    ContentType: mime,
    // See cache-control rationale in the comment block below the loop.
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  return body.length;
}

// Cache-Control: production — immutable, 1-year cache.
//   public           — fine for shared caches (Cloudflare's CDN edge).
//   max-age=31536000 — 1 year. Browser doesn't even consider revalidating
//                      until then.
//   immutable        — browser will skip revalidation entirely, even on
//                      hard reload.
// This is safe because filenames + tile-pyramid dirs are content-hashed by
// the generator (`<baseName>.<10-hex>.webp` for images; `overworld.<hash>/`
// for pyramid dirs). Any byte change in the source PNG produces a different
// hash, hence a different URL — the browser sees it as a new resource and
// fetches fresh. There's no "stale cache" scenario possible. The R2 bucket
// accumulates orphans of old hashes over time; --prune-stale + --purge
// clean them up.

let totalUp = 0, totalSkip = 0, totalBytes = 0;

for (const target of TARGETS) {
  if (!fs.existsSync(target.local)) {
    console.log(`✗ ${target.prefix}: no local dir (${target.local}) — skipping`);
    continue;
  }
  const entries = listLocalFiles(target);
  if (entries.length === 0) {
    console.log(`✗ ${target.prefix}: 0 files — skipping`);
    continue;
  }
  process.stdout.write(`► ${target.prefix}: listing existing R2 objects... `);
  const remoteSizes = force ? new Map() : await listAllKeys(target.prefix);
  process.stdout.write(`${remoteSizes.size} present (${entries.length} local)\n`);

  // Filter to the entries that actually need uploading. Size-equal = already
  // uploaded (content-hashed names make this a safe shortcut — same key +
  // same size = same content).
  const toUpload = [];
  let skipCount = 0;
  for (const e of entries) {
    const size = fs.statSync(e.localPath).size;
    if (!force && remoteSizes.get(e.key) === size) { skipCount++; continue; }
    toUpload.push({ ...e, size });
  }
  if (toUpload.length === 0) {
    console.log(`  ${target.prefix}: 0 uploaded · ${skipCount} skipped`);
    totalSkip += skipCount;
    continue;
  }

  if (dryRun) {
    for (const e of toUpload.slice(0, 6)) console.log(`  [dry-run] upload ${e.key} (${(e.size/1024).toFixed(0)} KB)`);
    if (toUpload.length > 6) console.log(`  [dry-run] ... and ${toUpload.length - 6} more`);
    const dryBytes = toUpload.reduce((s, e) => s + e.size, 0);
    totalUp += toUpload.length; totalSkip += skipCount; totalBytes += dryBytes;
    console.log(`  ${target.prefix}: ${toUpload.length} would upload · ${skipCount} skipped · ${(dryBytes/1024/1024).toFixed(1)} MB`);
    continue;
  }

  // Parallel uploader. Sequential PUTs at ~50 ms/object = 4+ minutes for a
  // single Sinnoh tile pyramid; with CONC=12 the same work finishes in ~30 s.
  // The cap is conservative — R2 happily takes more in parallel, but we're
  // also reading file bytes from disk and PutObjectCommand serializes per
  // request, so 12 keeps things efficient without saturating laptop I/O.
  const CONC = 12;
  let cursor = 0, done = 0, upBytes = 0;
  let lastTick = Date.now();
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (cursor < toUpload.length) {
      const e = toUpload[cursor++];
      const written = await putOne(e.localPath, e.key, target.mime);
      done++; upBytes += written;
      if (Date.now() - lastTick > 250) {
        lastTick = Date.now();
        process.stdout.write(`\r  uploaded ${done}/${toUpload.length} (${(upBytes/1024/1024).toFixed(1)} MB)        `);
      }
    }
  }));
  process.stdout.write(`\r  uploaded ${done}/${toUpload.length} (${(upBytes/1024/1024).toFixed(1)} MB)        \n`);
  console.log(`  ${target.prefix}: ${done} uploaded · ${skipCount} skipped · ${(upBytes/1024/1024).toFixed(1)} MB`);
  totalUp += done; totalSkip += skipCount; totalBytes += upBytes;
}

// ---------- prune stale R2 objects (opt-in via --prune-stale) ----------
// Local images/ directory is the source of truth after the build script
// runs its own orphan-pruning step. Any object in R2 under <region>/images/
// whose filename isn't in local images/ is by definition an orphan from a
// previous content-hash version. Delete those. SCOPED per region — pruning
// during a `johto` run can't accidentally delete Sinnoh objects.
let totalPruned = 0;
if (pruneStale) {
  for (const target of TARGETS) {
    if (!fs.existsSync(target.local)) continue;
    // Use the same recursive walker as the upload path so tile-pyramid keys
    // (which have multi-segment paths under `<region>/tiles/`) compare on
    // the same key shape as the remote keys we list from R2.
    const localKeys = new Set(listLocalFiles(target).map(e => e.key));
    process.stdout.write(`► ${target.prefix}: scanning for stale R2 objects... `);
    const remoteKeys = [...(await listAllKeys(target.prefix)).keys()];
    const stale = remoteKeys.filter(k => !localKeys.has(k));
    process.stdout.write(`${stale.length} stale (of ${remoteKeys.length} remote · ${localKeys.size} local)\n`);
    if (stale.length === 0) continue;
    if (dryRun) {
      for (const k of stale.slice(0, 8)) console.log(`  [dry-run] would delete ${k}`);
      if (stale.length > 8) console.log(`  [dry-run] ... and ${stale.length - 8} more`);
      totalPruned += stale.length;
      continue;
    }
    // R2 DeleteObjects supports up to 1000 keys per call.
    for (let i = 0; i < stale.length; i += 1000) {
      const batch = stale.slice(i, i + 1000);
      await s3.send(new DeleteObjectsCommand({
        Bucket: R2_BUCKET,
        Delete: { Objects: batch.map(Key => ({ Key })), Quiet: true },
      }));
      totalPruned += batch.length;
      process.stdout.write(`\r  pruned ${totalPruned}        `);
    }
    process.stdout.write('\n');
  }
}

console.log(`\n► Done. ${totalUp} uploaded · ${totalSkip} skipped · ${(totalBytes/1024/1024).toFixed(1)} MB${dryRun ? ' (dry-run)' : ''}.`);
if (pruneStale) {
  console.log(`  ${totalPruned} stale R2 object(s) pruned${dryRun ? ' (dry-run)' : ''}.`);
}
console.log(`  Public URL pattern: https://pub-5fa7446d73c34538ae0c670b480e58a2.r2.dev/${REGION}/images/<file>.webp`);
