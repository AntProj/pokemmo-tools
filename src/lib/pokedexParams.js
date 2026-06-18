// Serialize the Pokédex filter state to/from URL query params, so the address
// bar is always a shareable link and saved searches can store a compact string.
// Only non-default fields are written, keeping URLs short. Used by Pokedex.jsx
// (live URL sync) and SavedSearches (named presets).

const STAT_KEYS = ['hp', 'attack', 'defense', 'sp_attack', 'sp_defense', 'speed', 'bst'];

// state → URLSearchParams (only the fields that differ from the defaults).
export function stateToParams(state) {
  const p = new URLSearchParams();
  if (state.search?.trim()) p.set('q', state.search.trim());
  if (state.region && state.region !== 'All') p.set('region', state.region);
  if (state.sort && state.sort !== 'dex') p.set('sort', state.sort);

  if (state.types?.length) {
    p.set('types', state.types.join(','));
    if (state.typesMode && state.typesMode !== 'all') p.set('tmode', state.typesMode);
  }
  const moves = (state.selectedMoveIds || []).filter((x) => x != null);
  if (moves.length) {
    p.set('moves', moves.join(','));
    if (state.movesMode && state.movesMode !== 'all') p.set('mmode', state.movesMode);
  }
  if (state.abilityId != null) p.set('ability', String(state.abilityId));
  if (state.heldItemId != null) p.set('item', String(state.heldItemId));
  if (state.eggGroups?.length) {
    p.set('eggs', state.eggGroups.join(','));
    if (state.eggGroupsMode && state.eggGroupsMode !== 'any') p.set('emode', state.eggGroupsMode);
  }
  for (const k of STAT_KEYS) {
    const r = state.stats?.[k];
    if (Array.isArray(r)) p.set(`s_${k}`, `${r[0]}-${r[1]}`);
  }
  return p;
}

// URLSearchParams → a full filter state, merged onto `base` (INITIAL_POKEDEX).
// Fields absent from the params reset to their default, so applying a shared
// link or a saved search fully replaces the active filters.
export function paramsToState(params, base) {
  const num = (key) => {
    const v = params.get(key);
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const csv = (key) => {
    const v = params.get(key);
    return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
  };

  const stats = {};
  for (const k of STAT_KEYS) {
    const v = params.get(`s_${k}`);
    const m = v && v.match(/^(-?\d+)-(-?\d+)$/);
    stats[k] = m ? [Number(m[1]), Number(m[2])] : null;
  }

  const moveIds = csv('moves').map(Number).filter(Number.isFinite).slice(0, 4);
  const selectedMoveIds = [0, 1, 2, 3].map((i) => (moveIds[i] != null ? moveIds[i] : null));

  return {
    ...base,
    search: params.get('q') || '',
    region: params.get('region') || 'All',
    sort: params.get('sort') || 'dex',
    types: csv('types'),
    typesMode: params.get('tmode') === 'any' ? 'any' : 'all',
    selectedMoveIds,
    movesMode: params.get('mmode') === 'any' ? 'any' : 'all',
    abilityId: num('ability'),
    heldItemId: num('item'),
    eggGroups: csv('eggs'),
    eggGroupsMode: params.get('emode') === 'all' ? 'all' : 'any',
    stats,
  };
}
