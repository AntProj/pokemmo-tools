// Cloudflare Worker — Trainer Scribe contribution endpoint.
//
// Accepts a PII-stripped scribe export ({ trainers: {...} }) by POST and stores
// it as one object in an R2 bucket. The daily GitHub Action lists these,
// consensus-merges them into the trainerInstances catalog, and redeploys.
//
// Deploy:  cd cloudflare/contribute-worker && npx wrangler deploy
// Bucket:  the R2 binding CONTRIB (see wrangler.toml)
// Spam gate (optional): npx wrangler secret put CONTRIB_KEY   (then the Scribe
//   must send the same value in the X-Scribe-Key header)

const MAX_TRAINERS = 5000;
const MAX_BYTES = 2_000_000;

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Scribe-Key',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, cors);

    if (env.CONTRIB_KEY && request.headers.get('X-Scribe-Key') !== env.CONTRIB_KEY) {
      return json({ error: 'unauthorized' }, 401, cors);
    }

    let body;
    try { body = await request.json(); } catch { return json({ error: 'invalid json' }, 400, cors); }

    const trainers = body && typeof body.trainers === 'object' ? body.trainers : null;
    const count = trainers ? Object.keys(trainers).length : 0;
    if (!count) return json({ error: 'expected a non-empty { trainers: {...} }' }, 400, cors);
    if (count > MAX_TRAINERS) return json({ error: 'too many trainers' }, 413, cors);

    // Re-serialize only the fields we want — never store raw logs or player names.
    const clean = {};
    for (const [key, p] of Object.entries(trainers)) {
      if (!p || typeof p !== 'object' || !p.name) continue;
      clean[key] = {
        name: String(p.name).slice(0, 60),
        route: p.route ? String(p.route).slice(0, 60) : null,
        reward: Number.isFinite(p.reward) ? p.reward : null,
        team: Array.isArray(p.team) ? p.team.slice(0, 6).map((t) => ({
          species: String(t.species || '').slice(0, 40),
          level: Number.isFinite(t.level) ? t.level : null,
          gender: ['M', 'F', 'N'].includes(t.gender) ? t.gender : null,
          moves: Array.isArray(t.moves) ? t.moves.slice(0, 4).map((m) => String((m && m.name) || m || '').slice(0, 40)) : [],
        })) : [],
      };
    }
    if (!Object.keys(clean).length) return json({ error: 'no valid trainers' }, 400, cors);

    const payload = JSON.stringify({
      version: 1,
      contributor: body.contributor ? String(body.contributor).slice(0, 40) : null,
      submittedAt: new Date().toISOString(),
      trainers: clean,
    });
    if (payload.length > MAX_BYTES) return json({ error: 'too large' }, 413, cors);

    const day = new Date().toISOString().slice(0, 10);
    const key = `contributions/${day}/${crypto.randomUUID()}.json`;
    await env.CONTRIB.put(key, payload, { httpMetadata: { contentType: 'application/json' } });

    return json({ ok: true, stored: Object.keys(clean).length, key }, 200, cors);
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors } });
}
