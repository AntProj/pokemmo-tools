// Thin bridge to the Tauri desktop shell. Uses the injected `window.__TAURI__`
// global (enabled by withGlobalTauri in tauri.conf.json) rather than importing
// an @tauri-apps/* package — so the website build pulls in ZERO desktop deps
// and these helpers simply no-op / throw outside the desktop app.

export function isDesktop() {
  return typeof window !== 'undefined' && !!window.__TAURI__;
}

function bridge() {
  const t = typeof window !== 'undefined' ? window.__TAURI__ : null;
  if (!t) throw new Error('Not running in the PokéMMO Tools desktop app.');
  return t;
}

export async function invoke(cmd, args) {
  return bridge().core.invoke(cmd, args);
}

// Subscribe to a Tauri event; returns an unlisten function (no-op off-desktop).
export async function listen(event, handler) {
  if (!isDesktop()) return () => {};
  return bridge().event.listen(event, handler);
}

/* ── Capture/OCR commands (implemented in src-tauri) ─────────────────────── */

// List capturable top-level windows: [{ hwnd:number, title:string }].
export async function listWindows() {
  return invoke('list_windows');
}

// Capture a window (optionally a sub-rect) and OCR it. Returns the parse
// payload: { text, width, height, words:[{text,x,y,w,h,green}], pngBase64 }.
// `rect` is a normalized { x, y, w, h } in 0..1 of the window, or null for the
// whole window.
export async function captureAndOcr({ hwnd, rect = null } = {}) {
  return invoke('capture_and_ocr', { hwnd, rect });
}

// Event name the global capture hotkey fires.
export const CAPTURE_HOTKEY_EVENT = 'capture-hotkey';
