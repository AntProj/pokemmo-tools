// src/lib/spriteMode.js
//
// Global sprite-style preference: every <PokemonSprite> in the app reads
// from this single source so the user can flip between
//   '3d'    — Pokémon HOME 3D PNG renders (the smooth modal-hero look)
//   'still' — PokeAPI Gen 5 still PNG (the classic pixel sprite)
// everywhere in one shot.
//
// Persisted in localStorage so the choice survives tab switches and
// reloads. A simple `useSyncExternalStore`-backed hook lets every sprite
// re-render the moment the toggle flips, without prop-drilling.
//
// (Animated GIFs were previously the default `variant="animated"` —
// they're gone entirely; if anything in the codebase still passes that
// string, the new code maps it to whatever the user picked.)

import { useSyncExternalStore } from 'react';

const LS_KEY = 'pokemmo:spriteMode';

function readInitial() {
  if (typeof window === 'undefined') return '3d';
  try {
    const v = window.localStorage.getItem(LS_KEY);
    return v === 'still' || v === '3d' ? v : '3d';
  } catch {
    return '3d';
  }
}

let _mode = readInitial();
const _listeners = new Set();
function notify() { for (const cb of _listeners) cb(); }

export function getSpriteMode() { return _mode; }
export function setSpriteMode(next) {
  if (next !== '3d' && next !== 'still') return;
  if (next === _mode) return;
  _mode = next;
  try { window.localStorage.setItem(LS_KEY, next); } catch {}
  notify();
}

function subscribe(cb) {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

export function useSpriteMode() {
  return useSyncExternalStore(subscribe, getSpriteMode, getSpriteMode);
}
