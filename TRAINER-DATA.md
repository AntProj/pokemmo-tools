# Crowdsourced trainer-team data

The Trainer Scribe (desktop, dev-only) reads trainer battles via OCR. Players
can **contribute** their observations; a daily job **consensus-merges** them and
**redeploys**, so everyone's app gets better the more people play.

```
desktop Scribe ──POST──▶ Cloudflare Worker ──▶ R2 bucket
                                                  │
                       (daily GitHub Action)      ▼
        fetch contributions ──▶ consensus merge ──▶ trainerInstances.json
                                                  │
                                          commit + deploy ──▶ everyone
```

Only parsed **trainer profiles** are sent (name, route, team, levels, moves,
reward) — never raw logs, usernames, or chat.

## Why consensus (not last-write-wins)
OCR misreads happen. A datum (a move, a level) is only marked **confirmed** once
`--min-sources` independent contributors agree; anything that doesn't validate
against the dataset (unknown species/move) is dropped. So crowd size cancels out
noise. See `scripts/aggregate-contributions.mjs`.

## One-time setup (maintainer)

### 1. R2 bucket
```bash
cd cloudflare/contribute-worker
npx wrangler r2 bucket create pokemmo-trainer-contributions
```

### 2. Deploy the Worker
```bash
npx wrangler deploy           # prints the Worker URL
npx wrangler secret put CONTRIB_KEY   # optional anti-spam shared secret
```
Put the Worker URL in the Scribe's **Community data** box (or ship it via
`VITE_CONTRIBUTE_URL` at build time).

### 3. GitHub repo secrets
Add (Settings → Secrets → Actions):
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
- `R2_CONTRIB_BUCKET` = `pokemmo-trainer-contributions`

The workflow `.github/workflows/trainer-data.yml` runs daily (06:00 UTC) and on
demand: fetch → consensus-merge each region → commit → `npm run deploy`.

## Manual / local commands
```bash
# Fold a single Scribe export into a catalog
npm run merge:trainers -- ~/Downloads/trainer-teams.json --region=johto --dry-run

# Pull community contributions from R2 (needs R2_* in .env.local)
npm run fetch:contributions

# Consensus-merge a folder of contributions
npm run aggregate:trainers -- --dir=data/contributions --region=johto --min-sources=2 --dry-run
```

## Notes
- `trainerInstances.json` is the committed source the aggregator fills. If you
  ever regenerate map data, re-run `aggregate:trainers` afterwards (contributions
  persist in R2, so the teams are restored deterministically).
- For desktop apps to receive community updates without reinstalling, point the
  app's data fetch at the live site URL (it already fetches `data/pokemmo.json`
  that way).
