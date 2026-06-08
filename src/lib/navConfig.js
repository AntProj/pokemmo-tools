// Single source of truth for top-level navigation destinations, plus a
// user-customizable layout: which destinations are pinned to the navbar vs.
// tucked in the "More" dropdown, and in what order. Persisted to localStorage.
//
// Adding a destination here is all that's needed — the reconcile step folds new
// entries into a user's saved layout automatically (pinned if `defaultBar`).

export const NAV_DESTINATIONS = [
  { id: 'pokedex',   label: 'Pokédex',    to: '/',          end: true,  defaultBar: true },
  { id: 'locations', label: 'Locations',  to: '/locations',             defaultBar: true },
  { id: 'tracker',   label: 'Tracker',    to: '/tracker',               defaultBar: true },
  { id: 'maps',      label: 'Maps',       to: '/map',                   defaultBar: true },
  { id: 'catch',     label: 'Catch Calc', to: '/catch',                 defaultBar: false },
  { id: 'breeding',  label: 'Breeding',   to: '/breeding',              defaultBar: false },
];

export const NAV_BY_ID = Object.fromEntries(NAV_DESTINATIONS.map((d) => [d.id, d]));

const LS_NAV = 'pokemmo:nav';

export function defaultNav() {
  return {
    order: NAV_DESTINATIONS.map((d) => d.id),
    bar: NAV_DESTINATIONS.filter((d) => d.defaultBar).map((d) => d.id),
  };
}

// Merge a stored layout with the current registry: drop ids that no longer
// exist, append any new destinations (pinning the ones marked defaultBar).
function reconcile(nav) {
  const known = new Set(NAV_DESTINATIONS.map((d) => d.id));
  const storedOrder = Array.isArray(nav.order) ? nav.order.filter((id) => known.has(id)) : [];
  const storedBar = Array.isArray(nav.bar) ? nav.bar.filter((id) => known.has(id)) : [];

  const order = [...storedOrder];
  const bar = [...storedBar];
  for (const d of NAV_DESTINATIONS) {
    if (!order.includes(d.id)) {
      order.push(d.id);
      if (d.defaultBar) bar.push(d.id);
    }
  }
  return { order, bar };
}

export function loadNav() {
  if (typeof window === 'undefined') return defaultNav();
  try {
    const raw = JSON.parse(localStorage.getItem(LS_NAV));
    if (!raw || !Array.isArray(raw.order)) return defaultNav();
    return reconcile(raw);
  } catch {
    return defaultNav();
  }
}

export function saveNav(nav) {
  try { localStorage.setItem(LS_NAV, JSON.stringify(nav)); } catch { /* ignore */ }
}

// Resolve a layout into ordered destination objects for each slot.
export function resolveNav(nav) {
  const barSet = new Set(nav.bar);
  const pinned = nav.order.filter((id) => barSet.has(id)).map((id) => NAV_BY_ID[id]).filter(Boolean);
  const more   = nav.order.filter((id) => !barSet.has(id)).map((id) => NAV_BY_ID[id]).filter(Boolean);
  return { pinned, more };
}
