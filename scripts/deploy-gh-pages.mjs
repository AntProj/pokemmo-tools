#!/usr/bin/env node
/**
 * deploy-gh-pages.mjs — publish dist/ to the gh-pages branch
 *
 * Drop-in replacement for the `gh-pages` npm package on Windows. The
 * gh-pages package's `Git.rm()` does `git rm -- <file1> <file2> ...` with
 * every checked-in file spread as a separate argv (lib/git.js:146). On
 * Windows that argv list goes through CreateProcess, which caps total
 * command-line length at ~32 KB. Once the gh-pages branch holds more than
 * a few thousand files (~600 per-zone WebPs + ~500 event manifests +
 * ~500 walkable sidecars + the new ~5000-file tile pyramid), the
 * spawn fails with ENAMETOOLONG and the deploy never gets past cleanup.
 *
 * Strategy here:
 *   1. Make sure a fresh `dist/` exists (caller runs vite build first).
 *   2. Add a temporary worktree on the gh-pages branch in a sibling dir,
 *      creating it as an orphan if it doesn't exist yet.
 *   3. `git rm -rf .` inside the worktree — ONE short command, no argv
 *      explosion regardless of file count.
 *   4. Copy dist/ → worktree, stage everything, commit, push.
 *   5. Remove the worktree.
 *
 * The git binary itself has no problem with thousands of tracked files
 * once they're already on disk — only the spawn argv path is limited.
 * `git rm -rf .` (one dot, three flags) is well under the cap.
 *
 * No external deps; spawns `git` directly. Works on Windows / macOS /
 * Linux as long as git is on PATH.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(REPO_ROOT, 'dist');
// Worktree lives OUTSIDE the main checkout so its file tree doesn't show
// up in `git status` on the main branch. `.gh-pages-tmp` is .gitignored
// at the repo level for safety.
const WORKTREE_DIR = path.join(REPO_ROOT, '.gh-pages-tmp');
const BRANCH = 'gh-pages';

function git(args, opts = {}) {
  const cwd = opts.cwd || REPO_ROOT;
  const printable = `git ${args.join(' ')}`;
  if (!opts.quiet) console.log(`  $ ${printable}  (in ${path.relative(REPO_ROOT, cwd) || '.'})`);
  const res = spawnSync('git', args, { cwd, stdio: opts.quiet ? 'pipe' : 'inherit', encoding: 'utf-8' });
  if (res.error) throw res.error;
  if (res.status !== 0 && !opts.allowFail) {
    if (opts.quiet) {
      // Print captured output so failures are debuggable.
      if (res.stdout) process.stdout.write(res.stdout);
      if (res.stderr) process.stderr.write(res.stderr);
    }
    throw new Error(`${printable} failed with exit ${res.status}`);
  }
  return res;
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

if (!fs.existsSync(DIST_DIR)) {
  console.error('  dist/ does not exist — run `npm run build` first.');
  process.exit(1);
}

// Detect the origin remote URL up front so the orphan-branch case below
// has somewhere to push to. (`git push origin <branch>` works either way,
// but failing fast here is friendlier than a cryptic push error.)
const remoteCheck = git(['remote', 'get-url', 'origin'], { quiet: true, allowFail: true });
if (remoteCheck.status !== 0) {
  console.error('  No "origin" remote configured. Add one with `git remote add origin <url>`.');
  process.exit(1);
}

console.log('► Preparing gh-pages worktree...');

// Always start clean: nuke any leftover worktree from a previous run
// (failed runs can leave the dir behind).
try { git(['worktree', 'remove', '--force', WORKTREE_DIR], { quiet: true, allowFail: true }); } catch {}
if (fs.existsSync(WORKTREE_DIR)) fs.rmSync(WORKTREE_DIR, { recursive: true, force: true });

// Fetch the remote branch so we attach to its current tip if it exists.
// allowFail because a brand-new repo may not have gh-pages on origin yet.
git(['fetch', 'origin', BRANCH], { quiet: true, allowFail: true });

// Try to attach to the existing remote branch; if that fails, create an
// orphan branch (first-ever deploy).
const refCheck = git(['rev-parse', '--verify', `origin/${BRANCH}`], { quiet: true, allowFail: true });
if (refCheck.status === 0) {
  git(['worktree', 'add', '-B', BRANCH, WORKTREE_DIR, `origin/${BRANCH}`]);
} else {
  console.log('  gh-pages branch does not exist yet — creating as orphan');
  git(['worktree', 'add', '--detach', WORKTREE_DIR]);
  git(['checkout', '--orphan', BRANCH], { cwd: WORKTREE_DIR });
}

// The single-argv cleanup. Even with hundreds of thousands of tracked
// files in the branch, this is one short command — no argv explosion.
console.log('► Clearing worktree...');
git(['rm', '-rf', '.'], { cwd: WORKTREE_DIR, allowFail: true });
// Also nuke any untracked junk that might be lying around.
git(['clean', '-fdx'], { cwd: WORKTREE_DIR, quiet: true });

console.log('► Copying dist/ → worktree...');
copyDir(DIST_DIR, WORKTREE_DIR);
// GitHub Pages otherwise treats the site as Jekyll and silently drops files
// whose paths start with `_`. Vite emits `_assets/`-style chunks; the
// `.nojekyll` marker disables Jekyll entirely.
fs.writeFileSync(path.join(WORKTREE_DIR, '.nojekyll'), '');

console.log('► Committing...');
git(['add', '-A'], { cwd: WORKTREE_DIR, quiet: true });
const diffCheck = git(['diff-index', '--quiet', 'HEAD', '--'], { cwd: WORKTREE_DIR, quiet: true, allowFail: true });
if (diffCheck.status === 0) {
  console.log('  (nothing to commit — gh-pages branch is already up to date)');
} else {
  // ISO timestamp keeps deploy commits sortable and traceable. No author
  // override — uses the local git config.
  const msg = `deploy ${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}`;
  git(['commit', '-m', msg], { cwd: WORKTREE_DIR });
}

console.log('► Pushing to origin...');
git(['push', 'origin', BRANCH], { cwd: WORKTREE_DIR });

console.log('► Cleaning up worktree...');
git(['worktree', 'remove', '--force', WORKTREE_DIR], { quiet: true, allowFail: true });
if (fs.existsSync(WORKTREE_DIR)) fs.rmSync(WORKTREE_DIR, { recursive: true, force: true });

console.log('► Deploy complete.');
