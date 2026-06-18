// Named Pokédex search presets, stored in localStorage. Each entry is
// { id, name, params } where `params` is the URL query string produced by
// stateToParams(...).toString() — compact and reused by the same parser that
// reads shareable links.

const LS = 'pokemmo:savedSearches';

export function loadSaved() {
  if (typeof window === 'undefined') return [];
  try {
    const a = JSON.parse(localStorage.getItem(LS));
    return Array.isArray(a) ? a.filter((x) => x && typeof x.name === 'string') : [];
  } catch {
    return [];
  }
}

export function saveSaved(list) {
  try { localStorage.setItem(LS, JSON.stringify(list)); } catch { /* ignore */ }
}
