// Download all Trainer Scribe contributions from R2 into a local folder so the
// aggregator can consensus-merge them. Reuses the same R2 credentials as the
// map upload script.
//
// Env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
//      R2_CONTRIB_BUCKET (default: pokemmo-trainer-contributions)
// Usage: node scripts/fetch-contributions.mjs [--out=data/contributions]

import fs from 'node:fs';
import path from 'node:path';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';

const args = process.argv.slice(2);
const outDir = (args.find((a) => a.startsWith('--out=')) || '').split('=')[1] || 'data/contributions';

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_CONTRIB_BUCKET = 'pokemmo-trainer-contributions',
} = process.env;

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
  console.error('Missing R2 credentials. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.');
  process.exit(1);
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

fs.mkdirSync(outDir, { recursive: true });

async function streamToString(body) {
  const chunks = [];
  for await (const c of body) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

let token;
let total = 0;
do {
  const list = await s3.send(new ListObjectsV2Command({
    Bucket: R2_CONTRIB_BUCKET,
    Prefix: 'contributions/',
    ContinuationToken: token,
  }));
  for (const obj of list.Contents || []) {
    if (!obj.Key.endsWith('.json')) continue;
    const res = await s3.send(new GetObjectCommand({ Bucket: R2_CONTRIB_BUCKET, Key: obj.Key }));
    const text = await streamToString(res.Body);
    const fname = obj.Key.replace(/[\\/]/g, '_');
    fs.writeFileSync(path.join(outDir, fname), text);
    total++;
  }
  token = list.IsTruncated ? list.NextContinuationToken : undefined;
} while (token);

console.log(`Downloaded ${total} contribution file(s) → ${outDir}`);
