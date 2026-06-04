#!/usr/bin/env node
/**
 * upload-maps-to-r2.mjs — Sinnoh map asset sync for Cloudflare R2
 *
 * Modes:
 *   npm run upload:maps                    — push new/changed PNGs (default)
 *   npm run upload:maps -- --dry-run       — list what would upload, no writes
 *   npm run upload:maps -- --force         — re-upload everything ignoring size
 *   npm run upload:maps -- --prune-stale   — after upload, delete R2 objects
 *                                            not present in local images/
 *   npm run purge:r2                       — wipe all sinnoh/* AND sprites/* objects
 *
 * Required env vars (see .env.example):
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
 *   R2_BUCKET (default: pokemmo-maps)
 *
 * What gets synced:
 *   public/data/maps/sinnoh/images/  →  s3://<bucket>/sinnoh/images/
 *   public/data/sprites/             →  s3://<bucket>/sprites/
 *
 * About --prune-stale:
 *   Filenames are content-hashed (e.g. `0344 - Route 203.05ae12bbef.webp`).
 *   Each data regeneration changes the hash for any PNG whose content
 *   changed, so old hashes become orphans in R2 — they're not referenced
 *   by the current `maps-index.json`, but they linger in the bucket and
 *   accumulate. --prune-stale lists everything in R2 under sinnoh/images/
 *   and deletes whatever doesn't exist in the local images/ directory.
 *   Safe because the local dir is the source of truth (the build script
 *   already prunes its own orphans before upload). Combine with regular
 *   upload to push current + clean leftovers in one shot.
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
const args = process.argv.slice(2);
const dryRun     = args.includes('--dry-run');
const force      = args.includes('--force');
const purge      = args.includes('--purge');
const pruneStale = args.includes('--prune-stale');

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
  console.log('► PURGE: deleting every object under sinnoh/, sprites/, unova/, maps/');
  const prefixes = ['sinnoh/', 'sprites/', 'unova/', 'maps/']; // include legacy prefixes
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
// Sinnoh map images are the only large asset we host on R2. They're served
// as WebP — build-map-data.mjs converts the Blender PNG output via sharp
// before placing them in public/data/maps/sinnoh/images/. WebP is ~25-50%
// smaller than the PNG source AND decodes faster in modern browsers.
// Trainer / NPC / item / sign sprites are baked INTO each map image by
// build_world.py's composite step (REACT_INTEGRATION.md §3.1) — there's no
// separate sprite upload.
const TARGETS = [
  { local: path.join(ROOT, 'public', 'data', 'maps', 'sinnoh', 'images'), prefix: 'sinnoh/images/', ext: '.webp', mime: 'image/webp' },
];

let totalUp = 0, totalSkip = 0, totalBytes = 0;

for (const target of TARGETS) {
  if (!fs.existsSync(target.local)) {
    console.log(`✗ ${target.prefix}: no local dir (${target.local}) — skipping`);
    continue;
  }
  const files = fs.readdirSync(target.local).filter(f => f.endsWith(target.ext));
  if (files.length === 0) {
    console.log(`✗ ${target.prefix}: 0 files — skipping`);
    continue;
  }
  process.stdout.write(`► ${target.prefix}: listing existing R2 objects... `);
  const remoteSizes = force ? new Map() : await listAllKeys(target.prefix);
  process.stdout.write(`${remoteSizes.size} present\n`);

  let upCount = 0, skipCount = 0, byteCount = 0;
  for (const file of files) {
    const localPath = path.join(target.local, file);
    const size = fs.statSync(localPath).size;
    const key = `${target.prefix}${file}`;
    if (!force && remoteSizes.get(key) === size) { skipCount++; continue; }
    if (dryRun) { console.log(`  [dry-run] upload ${key} (${(size/1024).toFixed(0)} KB)`); upCount++; byteCount += size; continue; }
    const body = fs.readFileSync(localPath);
    await s3.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: target.mime,
      // Cache-Control: production — immutable, 1-year cache.
      //   public           — fine for shared caches (Cloudflare's CDN edge).
      //   max-age=31536000 — 1 year. Browser doesn't even consider
      //                      revalidating until then.
      //   immutable        — browser will skip revalidation entirely, even
      //                      on hard reload.
      //
      // This is safe because filenames are content-hashed by the generator
      // (`<baseName>.<10-hex>.webp`). Any byte change in the source PNG
      // produces a different hash, hence a different URL — the browser sees
      // it as a new resource and fetches fresh. There's no "stale cache"
      // scenario possible. The R2 bucket accumulates orphans of old hashes
      // over time; `npm run purge:r2` cleans them up.
      CacheControl: 'public, max-age=31536000, immutable',
    }));
    upCount++; byteCount += size;
    if (upCount % 20 === 0) {
      process.stdout.write(`\r  uploaded ${upCount}/${files.length - skipCount} (${(byteCount/1024/1024).toFixed(1)} MB)        `);
    }
  }
  if (!dryRun && upCount > 0) process.stdout.write('\n');
  console.log(`  ${target.prefix}: ${upCount} uploaded · ${skipCount} skipped · ${(byteCount/1024/1024).toFixed(1)} MB`);
  totalUp += upCount; totalSkip += skipCount; totalBytes += byteCount;
}

// ---------- prune stale R2 objects (opt-in via --prune-stale) ----------
// Local images/ directory is the source of truth after the build script
// runs its own orphan-pruning step. Any object in R2 under sinnoh/images/
// whose filename isn't in local images/ is by definition an orphan from
// a previous content-hash version. Delete those.
let totalPruned = 0;
if (pruneStale) {
  for (const target of TARGETS) {
    if (!fs.existsSync(target.local)) continue;
    const localSet = new Set(
      fs.readdirSync(target.local)
        .filter(f => f.endsWith(target.ext))
        .map(f => `${target.prefix}${f}`)
    );
    process.stdout.write(`► ${target.prefix}: scanning for stale R2 objects... `);
    const remoteKeys = [...(await listAllKeys(target.prefix)).keys()];
    const stale = remoteKeys.filter(k => !localSet.has(k));
    process.stdout.write(`${stale.length} stale (of ${remoteKeys.length} remote · ${localSet.size} local)\n`);
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
console.log(`  Public URL pattern: https://pub-5fa7446d73c34538ae0c670b480e58a2.r2.dev/sinnoh/images/<file>.png`);
