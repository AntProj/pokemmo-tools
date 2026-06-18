# PokeKit — Desktop app (Windows)

The desktop app is a thin [Tauri v2](https://tauri.app) shell around the **exact
same React build** the website ships. There is **one frontend** — the website
and the desktop app load the identical `dist/`. The desktop build only *adds*
capabilities (screen capture + on-device OCR to populate your **Box**); the
website is unchanged and never depends on any of it.

**The desktop app loads the live site** (`https://antproj.github.io/pokekit/`)
rather than a bundled copy, so it auto-updates the moment you deploy the website
— the desktop shell exists only to add native screen capture + OCR. The window's
origin is granted IPC access in `src-tauri/capabilities/default.json` so the
capture commands work even though the UI is remote. (Only changes to the native
Rust side require a fresh `desktop:build`.)

Capture/OCR features are gated on `window.__TAURI__`, so:

- **Website (GitHub Pages):** full Pokédex / breeding / tracker, zero install,
  no "Capture" button.
- **Desktop app:** identical UI **plus** a "Capture from game" flow on the Box
  tab.

Windows-only for now (it uses `Windows.Graphics.Capture` + `Windows.Media.Ocr`).

---

## One-time setup

1. **Install the Rust toolchain** (MSVC, not GNU):
   - Install [rustup](https://rustup.rs/). On Windows this pulls the
     `stable-x86_64-pc-windows-msvc` toolchain.
   - Install the **Microsoft C++ Build Tools** (the "Desktop development with
     C++" workload) if you don't already have Visual Studio. Tauri links
     against MSVC.
2. **WebView2 runtime** — preinstalled on Windows 10/11. If missing, grab the
   Evergreen runtime from Microsoft.
3. **Install JS dev deps** (adds the Tauri CLI):
   ```bash
   npm install
   ```
4. **Generate app icons** (required before the first build) from any square PNG
   (≥512×512):
   ```bash
   npm run desktop:icon path/to/logo.png
   ```
   This writes `src-tauri/icons/*` (gitignored).

## Develop

```bash
npm run desktop:dev
```

This runs `vite` (port 5173) and opens the app in a native window with hot
reload. The `TAURI_ENV_PLATFORM` env var Tauri sets makes `vite.config.js`
switch `base` to `./` automatically.

## Build an installer

```bash
npm run desktop:build
```

Produces an NSIS installer under `src-tauri/target/release/bundle/`.

> The website deploy (`npm run deploy`) is completely independent and unchanged
> — it builds the same `dist/` and pushes to GitHub Pages.

---

## Architecture (one frontend, two shells)

```
src/                     ← React app (shared, untouched)
  lib/breeding/box.js    ← the Box store (localStorage pokemmo:box)
src-tauri/               ← Windows desktop shell (Rust)
  src/main.rs            ← Tauri entry; registers capture commands (Phase 3)
  src/capture.rs         ← Windows.Graphics.Capture → frames (Phase 3)
  src/ocr.rs             ← Windows.Media.Ocr → text + word boxes (Phase 3)
  tauri.conf.json        ← bundles ../dist; withGlobalTauri = true
dist/                    ← `npm run build`; GH Pages deploys it, Tauri bundles it
```

The frontend talks to the native side through the **global** Tauri bridge
(`window.__TAURI__`, enabled by `withGlobalTauri: true`) — so `src/` never
imports an `@tauri-apps/*` package and the website build stays clean with zero
desktop dependencies.

### Capture flow (Phase 3)

1. User picks the **PokéMMO window** in the OS picker (capture by window handle
   so the summary panel is at a fixed position regardless of where the window
   sits or what's in front of it). Run PokéMMO **borderless-windowed** — some
   exclusive-fullscreen modes capture as a black frame.
2. Rust samples frames (~4 fps), frame-diffs the calibrated crop, and when the
   panel **settles** runs `Windows.Media.Ocr` on it.
3. Rust emits `{ croppedPng, ocrText, wordBoxes }` to the frontend.
4. The frontend parses it (anchor on the `IVs:` / `Nature:` words; use the
   green-31 color cue), shows a **confirm/correct** card, dedups, and writes the
   mon into the same Box store the breeding planner already reads.

OCR-of-your-own-screen is read-only observation — no client automation or memory
reading — which keeps it on the safe side of the game's rules.
