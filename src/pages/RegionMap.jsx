import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Sun, Moon, ArrowLeft, X, Users, ExternalLink, ArrowUp, ArrowDown, ArrowLeftIcon, ArrowRight, Coins, Search, ChevronDown, Route as RouteIcon, MapPin, Flag } from 'lucide-react';
import { MapContainer, ImageOverlay, TileLayer, Marker, Rectangle, Polyline, CircleMarker, useMap, useMapEvents, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  loadWalkability, aStar, computeBridgeAxes,
  pixelToTile, tileToPixelCenter,
  effectiveBlocked, hexKey,
} from '../lib/pathfinding.js';
import {
  findCrossZoneRoute, computeSegmentPaths,
} from '../lib/crossMapPathfinding.js';

// Asset URL helper: absolute URLs pass through; relative URLs prepend Vite's
// BASE_URL so they work in dev (`/`) and prod (`/pokemmo-tools/`). Map images
// are absolute R2 URLs; event JSONs are relative.
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
const asset = (p) => (/^https?:\/\//i.test(p) ? p : `${BASE}/${p}`);

// Region-display lookup. New regions just append here; everything else in the
// component is region-derived. The component receives `region` as a prop (set
// by App.jsx's route registration) and looks the display name up here for any
// UI string that needs the friendly form ("Sinnoh", "Johto").
const REGION_DISPLAY = {
  sinnoh: 'Sinnoh',
  johto:  'Johto',
};
function regionDataUrls(region) {
  return {
    mapsIndex: asset(`data/maps/${region}/maps-index.json`),
    overworld: asset(`data/maps/${region}/overworld-locations.json`),
    zoneGraph: asset(`data/maps/${region}/zone-graph.json`),
  };
}

// Hit-zone sizes from REACT_INTEGRATION.md §3.2 / §5.
// Trainers are foot-anchored: 16 map-pixels wide, 32 tall, bottom-center at
// pixelCoord. Rendered as Rectangles (map-space) so they scale with zoom and
// stay aligned to the baked-in trainer sprite.
const TRAINER_HIT = { w: 16, h: 32 };
// Warps stay as Markers — they're navigation icons (not aligned to a baked
// sprite) and should remain readable at every zoom level.
const WARP_HIT = { w: 16, h: 16 };

const MARKER_KINDS = [
  { key: 'warps',    label: 'Warps',    Icon: ExternalLink },
  { key: 'trainers', label: 'Trainers', Icon: Users },
];

// HM-clearable obstacles are sprite EVENTS (REACT_WALKABILITY.md §4,
// 2026-05). The 4-digit number in `event.spriteFile` is the underlying
// SPRITE-ASSET ID (the actual graphic file), distinct from the OW entry
// ID (which the spec doc initially confused with the sprite ID). The
// manifest exports filenames built from sprite IDs, so React matches
// on those.
//
// Sprite IDs (= filename suffix) and their HM affiliation, verified
// empirically against zone signatures across all 577 Sinnoh sidecars:
//
//   ow_0082 → strength_boulder — Victory Road, Stark Mountain, Mt.
//                                Coronet, Oreburgh Gate. Cave-confined,
//                                50 events / 13 zones. Maps to OW entry
//                                84 in the ROM.
//   ow_0083 → rock_smashable  — Turnback Cave (29-30 per chamber × 12
//                                chambers), Mt. Coronet etc. 591 events
//                                / 44 zones. OW entry 85.
//   ow_0084 → cut_tree         — Eterna Forest, Eterna City, Route
//                                212/215/225/229 — every classic Cut
//                                zone. 49 events / 14 zones. OW entry 86.
//
// (Earlier this file matched on ow_0083/0084/0085 — that was wrong; the
// exporter's spec-doc snippet had the sprite IDs shifted by one. The
// 331-event "Strength boulder" count under that mapping was a generic
// decorative sprite that's not HM-clearable. Fixed.)
function eventHmSemantic(spriteFile) {
  if (typeof spriteFile !== 'string') return null;
  const m = spriteFile.match(/^ow_(\d{4})/);
  if (!m) return null;
  switch (m[1]) {
    case '0082': return 'strength_boulder';
    case '0083': return 'rock_smashable';
    case '0084': return 'cut_tree';
    default:     return null;
  }
}

const onMap = (e) => Number.isFinite(e.pixelX) && Number.isFinite(e.pixelY);

function makeDivIcon({ html, size, anchor, className = '' }) {
  return L.divIcon({ html, className, iconSize: size, iconAnchor: anchor });
}

// Click-zone icons. Sprites are already baked into the map PNG by the
// composite step (build_world.py), so trainer hit zones are SVG Rectangles
// (map-space, scale with zoom). Warps use a Marker — they're nav indicators,
// not aligned to a baked sprite, so screen-pixel sizing is correct.
const ICONS = {
  warp: makeDivIcon({
    html: `<div style="width:16px;height:16px;border-radius:3px;background:#3b82f6;border:2px solid #1e3a8a;display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:bold;line-height:1">↗</div>`,
    size: [WARP_HIT.w, WARP_HIT.h],
    anchor: [WARP_HIT.w / 2, WARP_HIT.h / 2],
  }),
};

// Compute Leaflet bounds for a trainer hit zone, foot-anchored at (px, py).
// Sprite extents: feet at py, head at py - TRAINER_HIT.h, half-width either
// side of px. Leaflet bounds are [southWest, northEast] in [lat=-y, lng=x].
const trainerHitBounds = (px, py) => {
  const halfW = TRAINER_HIT.w / 2;
  return [
    [-py,                  px - halfW],   // SW: bottom-left   (feet line, left edge)
    [-(py - TRAINER_HIT.h), px + halfW],  // NE: top-right     (head line, right edge)
  ];
};

export default function RegionMap({ region = 'sinnoh', theme, onTheme }) {
  const { zoneId: rawZoneId } = useParams();
  const navigate = useNavigate();
  const zoneId = rawZoneId || 'world';

  // Derive everything region-dependent from the prop. URLs and display strings
  // need to recompute when `region` changes — useMemo with [region] dep guards
  // against re-fetch loops if the parent re-renders for an unrelated reason.
  const regionDisplay = REGION_DISPLAY[region] || region;
  const dataUrls = useMemo(() => regionDataUrls(region), [region]);
  // Region-scoped route prefix — every internal navigation uses this so a
  // user in Johto stays in Johto when they jump between zones, click "Back
  // to overworld", or pick a zone from the dropdown.
  const mapRoot = `/map/${region}`;

  const [mapsIndex, setMapsIndex]                       = useState(null);
  const [overworldLocations, setOverworldLocations]     = useState(null);
  const [zoneGraph, setZoneGraph]                       = useState(null);
  const [indexError, setIndexError]                     = useState(null);

  // Cross-zone route state lives at this top level (not MapView) so it
  // SURVIVES MapView's remount when the user navigates from a zone's
  // detail map to the world overview. MapView has `key={zoneId}` which
  // forces full remount on zone change — necessary for Leaflet's
  // <MapContainer> to re-fit bounds — but means MapView's own state
  // (start tile, dest zone picker, etc.) is lost on navigation. By
  // hoisting `crossRoute`, the world view can render the route polyline
  // immediately after the user clicks "Show on overworld map" from a
  // zone view.
  //
  // Region switch (e.g. user moves from /map/sinnoh to /map/johto): the
  // route change remounts the component (different Route element), which
  // resets crossRoute back to null. That's correct — a Sinnoh route doesn't
  // mean anything in Johto, so we don't want it lingering.
  //
  // Shape: { segments, sourceZone, sourceTile } | null
  const [crossRoute, setCrossRoute] = useState(null);

  // Refetch whenever the region changes. Without the [dataUrls, region] dep
  // the second-region load would never fire after the first mounted with
  // hard-coded URLs (the bug we just removed).
  useEffect(() => {
    let cancelled = false;
    // Reset state immediately on region change so the previous region's data
    // doesn't flash before the new fetch resolves.
    setMapsIndex(null);
    setOverworldLocations(null);
    setZoneGraph(null);
    setIndexError(null);
    setCrossRoute(null);
    Promise.all([
      fetch(dataUrls.mapsIndex).then(r => r.json()),
      fetch(dataUrls.overworld).then(r => r.json()),
      fetch(dataUrls.zoneGraph).then(r => r.json()),
    ]).then(([idx, loc, graph]) => {
      if (cancelled) return;
      setMapsIndex(idx);
      setOverworldLocations(loc.locations || []);
      setZoneGraph(graph);
    }).catch(e => !cancelled && setIndexError(e.message));
    return () => { cancelled = true; };
  }, [dataUrls, region]);

  return (
    <main className="max-w-7xl mx-auto px-4 py-4 space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {zoneId !== 'world' && (
          <Link
            to={mapRoot}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md
                       border border-[#d6c8a3] dark:border-stone-700
                       bg-[#fdf8e9] dark:bg-stone-900
                       hover:bg-[#ece2c4] dark:hover:bg-stone-800
                       text-sm text-stone-700 dark:text-stone-300"
            title={`Back to ${regionDisplay} overworld`}
          >
            <ArrowLeft size={14} /> Back to overworld
          </Link>
        )}
        <h1 className="text-base font-semibold text-stone-900 dark:text-stone-100">
          {mapsIndex?.[zoneId]?.displayName || (zoneId === 'world' ? `${regionDisplay} Overworld` : `Zone ${zoneId}`)}
        </h1>
        <button
          type="button"
          onClick={() => onTheme(theme === 'dark' ? 'light' : 'dark')}
          className="ml-auto p-1.5 rounded-md border border-[#d6c8a3] dark:border-stone-700
                     bg-[#fdf8e9] dark:bg-stone-900 hover:bg-[#ece2c4] dark:hover:bg-stone-800
                     text-stone-700 dark:text-stone-300"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>

      {mapsIndex && (
        <ZoneJumpPicker
          mapsIndex={mapsIndex}
          zoneId={zoneId}
          regionDisplay={regionDisplay}
          onChange={(id) => navigate(id === 'world' ? mapRoot : `${mapRoot}/${id}`)}
        />
      )}

      {indexError && (
        <div className="rounded-md border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-700 dark:text-red-300">
          Failed to load map index: {indexError}
        </div>
      )}

      {!mapsIndex && !indexError && (
        <div className="text-sm text-stone-500 dark:text-stone-400">Loading map index…</div>
      )}

      {mapsIndex && (
        <MapView
          key={`${region}-${zoneId}`}
          zoneId={zoneId}
          mapsIndex={mapsIndex}
          overworldLocations={overworldLocations || []}
          zoneGraph={zoneGraph}
          crossRoute={crossRoute}
          setCrossRoute={setCrossRoute}
          mapRoot={mapRoot}
          regionDisplay={regionDisplay}
          onNavigateToZone={(id) => navigate(`${mapRoot}/${id}`)}
        />
      )}
    </main>
  );
}

/* ─────────────── Jump-to-zone combobox (text search + filtered list) ─────────────── */

function ZoneJumpPicker({ mapsIndex, zoneId, onChange, regionDisplay = 'Sinnoh' }) {
  // Build the option list once per mapsIndex change.
  // Sort: alphabetical by display name, then by zone id within ties.
  // World overview always pinned first. Mystery Zone (placeholder ROM headers,
  // per REACT_INTEGRATION.md §9) filtered out.
  const options = useMemo(() => {
    const detail = Object.entries(mapsIndex)
      .filter(([k]) => k !== 'world')
      .filter(([, m]) => m.displayName !== 'Mystery Zone')
      .map(([id, m]) => ({
        id,
        name: m.displayName || `Zone ${id}`,
        type: m.type,
        // Pre-format the dropdown label so display + search agree.
        label: `${String(id).padStart(4, '0')} — ${m.displayName || `Zone ${id}`}`,
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || Number(a.id) - Number(b.id));
    const worldLabel = `${regionDisplay} Overworld`;
    return [{ id: 'world', name: worldLabel, type: 'overview', label: worldLabel }, ...detail];
  }, [mapsIndex, regionDisplay]);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <label className="text-xs uppercase tracking-wider text-stone-500 dark:text-stone-400">
        Jump to zone
      </label>
      <ZoneCombobox
        options={options}
        value={zoneId}
        onChange={onChange}
      />
      <span className="text-[11px] text-stone-500 dark:text-stone-400">
        {options.length - 1} zones
      </span>
    </div>
  );
}

/**
 * Combobox: text input with autocomplete + filterable dropdown.
 *
 * - Matches case-insensitively on `name` (Jubilife City), `id` (3 or "0003"),
 *   and the full `label` (so users can type either "Eterna" or "0065").
 * - Arrow keys / Enter / Esc keyboard navigation.
 * - Click outside or pick an item to close.
 * - 577 zones is enough that a virtualized list would be technically better,
 *   but the filter brings the on-screen count down fast and 577 LI elements
 *   render fine even unvirtualized — keeping it simple.
 */
function ZoneCombobox({ options, value, onChange }) {
  const [query, setQuery] = useState('');
  const [open, setOpen]   = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef(null);
  const inputRef     = useRef(null);
  const listRef      = useRef(null);

  const selected = options.find(o => String(o.id) === String(value));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o =>
      o.label.toLowerCase().includes(q) ||
      o.name.toLowerCase().includes(q) ||
      String(o.id).includes(q)
    );
  }, [options, query]);

  // Close when clicking outside.
  useEffect(() => {
    const onDown = (e) => {
      if (!containerRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // Reset highlight when filter changes.
  useEffect(() => { setHighlight(0); }, [query]);

  // Scroll the highlighted item into view.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector(`[data-idx="${highlight}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  const commit = (id) => {
    onChange(id);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      setHighlight(h => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[highlight]) commit(filtered[highlight].id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setQuery('');
      inputRef.current?.blur();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  // What to show in the input box:
  //   - typing → user's query (live filter)
  //   - closed → the currently-selected zone's label
  //   - opened (no typing) → empty so user can start fresh
  const inputValue = open ? query : (selected?.label ?? '');

  return (
    <div ref={containerRef} className="relative min-w-[260px]">
      <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-stone-400 dark:text-stone-500 pointer-events-none" />
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        placeholder="Type to search…"
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { setQuery(''); setOpen(true); }}
        onKeyDown={onKeyDown}
        className="w-full pl-7 pr-7 py-1.5 rounded-md border text-sm
                   border-[#d6c8a3] dark:border-stone-700
                   bg-[#fdf8e9] dark:bg-stone-900
                   text-stone-700 dark:text-stone-300
                   focus:outline-none focus:ring-2 focus:ring-blue-500
                   placeholder:text-stone-400 dark:placeholder:text-stone-600"
      />
      <ChevronDown
        size={14}
        className={`absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 dark:text-stone-500 pointer-events-none transition-transform ${open ? 'rotate-180' : ''}`}
      />
      {open && (
        <ul
          ref={listRef}
          // z-[1100] — above all Leaflet panes (400-700) and controls (1000).
          className="absolute z-[1100] mt-1 left-0 right-0 max-h-72 overflow-y-auto
                     rounded-md border border-[#d6c8a3] dark:border-stone-700
                     bg-[#fdf8e9] dark:bg-stone-900 shadow-lg
                     text-sm py-1"
          role="listbox"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-xs text-stone-500 dark:text-stone-400">No matches.</li>
          ) : filtered.map((o, i) => {
            const isSelected = String(o.id) === String(value);
            const isHighlighted = i === highlight;
            return (
              <li
                key={o.id}
                data-idx={i}
                role="option"
                aria-selected={isSelected}
                onMouseDown={(e) => { e.preventDefault(); commit(o.id); }}
                onMouseEnter={() => setHighlight(i)}
                className={`px-3 py-1.5 cursor-pointer flex items-center gap-2 ${
                  isHighlighted
                    ? 'bg-[#ece2c4] dark:bg-stone-800 text-stone-900 dark:text-stone-100'
                    : 'text-stone-700 dark:text-stone-300'
                } ${isSelected ? 'font-semibold' : ''}`}
              >
                <span className="flex-1 truncate">{o.label}</span>
                {o.type === 'overview' && (
                  <span className="text-[10px] uppercase tracking-wider text-blue-600 dark:text-blue-400">world</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ─────────────── MapView (Leaflet wrapper) ─────────────── */

function MapView({
  zoneId, mapsIndex, overworldLocations, zoneGraph,
  crossRoute, setCrossRoute,
  onNavigateToZone,
  // Region-scoped route prefix and friendly name. Passed down so MapView can
  // build correct "Back to overworld" links and label the world-overview card
  // with the right region name. Defaults match the legacy Sinnoh-only setup.
  mapRoot = '/map',
  regionDisplay = 'Sinnoh',
}) {
  const entry = mapsIndex[zoneId];
  const [events, setEvents] = useState(null);
  const [selected, setSelected] = useState(null);
  const [loadError, setLoadError] = useState(null);
  // Default: trainer click zones visible (so the user knows what's clickable);
  // warps always visible.
  const [visible, setVisible] = useState({ warps: true, trainers: true });

  // ── Pathfinding state ────────────────────────────────────────────────
  // Activates a separate "pathfinding mode" where map clicks set the start
  // and end tiles instead of opening trainer panels. Walkability data is
  // fetched lazily on first entry into the mode for this zone.
  const [pathMode, setPathMode] = useState('off');           // 'off' | 'placingStart' | 'placingEnd' | 'computed'
  const [walk, setWalk]         = useState(null);            // { meta, raw, W, H } from loadWalkability
  const [walkError, setWalkError] = useState(null);
  const [eventsManifest, setEventsManifest] = useState(null); // full per-header events list for NPC blocking
  const [startTile, setStartTile] = useState(null);          // { tx, ty }
  const [endTile,   setEndTile]   = useState(null);
  const [pathTiles, setPathTiles] = useState(null);          // Array<{tx,ty}> | null
  const [pushMarkers, setPushMarkers] = useState([]);        // push events from Sokoban solver
  // Boulders are a debug tool until the exporter's buildings sidecar lands.
  // Right-click on a tile in pathfinding mode toggles a boulder there.
  // When Strength is ON, A* dispatches to aStarWithBoulders (state-space
  // search that handles pushing); when OFF, they merge into blocked tiles
  // as static walls. See pathfinding.js's aStar / aStarWithBoulders.
  const [boulders, setBoulders] = useState([]);              // Array<{tx,ty}>
  const [pathOpts,  setPathOpts]  = useState({
    // Post-game defaults — user has every HM. Toggle off to see which
    // paths depend on which HM, or to plan a route at a specific story
    // milestone. Each HM gates a specific semantic name in typeByteMap
    // (see pathfinding.js stepCost).
    surfAvailable:      true,   // water_* tiles
    waterfallAvailable: true,   // waterfall tiles (ship at collision 0x80)
    rockClimbAvailable: true,   // rock_climb tiles (ship at collision 0x80)
    cutAvailable:       true,   // cut_tree obstacles (needs buildings sidecar)
    strengthAvailable:  true,   // strength_boulder — movable wall, simplified
    rockSmashAvailable: true,   // rock_smash* obstacles (needs buildings sidecar)
    bikeAvailable:      true,   // wooden beams (bike-only bridges) + bike-jump ledges
    avoidGrass:         false,
    blockEvents:        true,   // trainers + NPCs + items + signs occupy tiles & block paths
  });
  // Debug overlay — paints each walkability tile in a high-contrast color
  // on top of the visible map. Useful for verifying coordinate alignment.
  const [showWalkOverlay, setShowWalkOverlay] = useState(false);

  // ── Cross-zone pathfinding state ─────────────────────────────────────
  // Travel from the current zone's start tile to a chosen destination zone
  // (with optional destination tile, defaulting to zone center). Returns
  // a list of detailed segments — each one a zone, a tile-level path
  // inside it, and either an exit warp / adjacency or a final segment.
  // Recomputed when the user clicks "Find cross-map route." See
  // src/lib/crossMapPathfinding.js for the algorithm.
  const [crossDestZone, setCrossDestZone] = useState(null);  // zone ID string
  const [crossDestTile, setCrossDestTile] = useState(null);  // {tx,ty} in dest zone — null = zone center
  const [crossLoading, setCrossLoading]   = useState(false);
  const [crossError, setCrossError]       = useState(null);

  // Display the hoisted crossRoute segments IF this zone is the source.
  // For other zones, the route exists but doesn't belong to this view —
  // it'll show up on the world map (rendered separately below).
  const crossSegments = (crossRoute && String(crossRoute.sourceZone) === String(zoneId))
    ? crossRoute.segments
    : null;

  // Compute a cross-zone route from the current zone's start tile to the
  // chosen destination zone's center. Async because per-segment tile A*
  // lazy-loads walkability for each visited zone.
  const computeCrossMapRoute = async () => {
    if (!zoneGraph || !startTile || !crossDestZone || !mapsIndex) return;
    setCrossLoading(true);
    setCrossError(null);
    setCrossRoute(null);
    try {
      // Destination tile: user pick if available, else zone center.
      const dest = mapsIndex[crossDestZone];
      const destTilesW = Math.floor((dest.imageWidth ?? 1024) / 16);
      const destTilesH = Math.floor((dest.imageHeight ?? 1024) / 16);
      const goalTile = crossDestTile ?? {
        tx: Math.floor(destTilesW / 2),
        ty: Math.floor(destTilesH / 2),
      };

      const segs = findCrossZoneRoute(
        zoneGraph,
        zoneId, startTile,
        crossDestZone, goalTile,
      );
      if (!segs) {
        setCrossError('No route found from ' + zoneId + ' to ' + crossDestZone + '.');
        return;
      }
      // computeSegmentPaths now lazy-loads per-zone events manifests
      // internally and builds the blocked-tile set + Strength boulder
      // list per segment. The HM toggles from pathOpts (cutAvailable,
      // strengthAvailable, rockSmashAvailable) control which sprite-events
      // get filtered out of the static blocked set in each zone.
      const detailed = await computeSegmentPaths(segs, mapsIndex, asset, pathOpts);
      setCrossRoute({ segments: detailed, sourceZone: zoneId, sourceTile: startTile });
    } catch (e) {
      console.error('[crossZone]', e);
      setCrossError(e.message);
    } finally {
      setCrossLoading(false);
    }
  };

  useEffect(() => {
    setEvents(null);
    setSelected(null);
    setLoadError(null);
    if (!entry?.eventsUrl) return;
    let cancelled = false;
    fetch(asset(entry.eventsUrl))
      .then(r => r.json())
      .then(e => !cancelled && setEvents(e))
      .catch(err => !cancelled && setLoadError(err.message));
    return () => { cancelled = true; };
  }, [entry?.eventsUrl]);

  // Reset pathfinding state any time the zone changes — start/end tiles only
  // make sense on a particular zone's coordinate grid.
  useEffect(() => {
    setPathMode('off');
    setWalk(null);
    setWalkError(null);
    setEventsManifest(null);
    setStartTile(null);
    setEndTile(null);
    setPathTiles(null);
    setPushMarkers([]);
    setBoulders([]);
    setCrossDestZone(null);
    setCrossDestTile(null);
    setCrossError(null);
    // Do NOT clear `crossRoute` here — it's hoisted so the world map
    // can read it after navigation. It'll be replaced when the user
    // computes a new route from this zone, or cleared from the card's
    // "Clear" button.
  }, [zoneId]);

  // Reset destination tile + segments whenever the dest zone changes.
  useEffect(() => {
    setCrossDestTile(null);
    if (crossRoute && String(crossRoute.sourceZone) === String(zoneId)) {
      setCrossRoute(null);
    }
  }, [crossDestZone]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Lazy-load the events manifest (full per-header NPCs + trainers + items
  // + signs) once we enter pathfinding mode. Source of truth for tile
  // occupancy per REACT_UPDATE_pathfinding.md §1.
  useEffect(() => {
    if (pathMode === 'off' || eventsManifest) return;
    if (!entry?.eventsManifestUrl) return;
    let cancelled = false;
    fetch(asset(entry.eventsManifestUrl))
      .then(r => r.json())
      .then(m => !cancelled && setEventsManifest(m))
      .catch(e => !cancelled && console.warn('[pathfinding] events manifest fetch failed:', e));
    return () => { cancelled = true; };
  }, [pathMode, entry?.eventsManifestUrl, eventsManifest]);

  // Lazy-load walkability when EITHER the path mode is entered OR the
  // debug overlay is toggled on. Cached for the remainder of the zone
  // session. Errors are surfaced both in the UI (walkError state) and
  // the console for easier debugging.
  //
  // PRIMARY data path (REACT_WALKABILITY.md §3, 2026-05): the .raw.bin
  // (type+collision bytes) + .json (typeByteMap + collisionByteMap). The
  // .png is no longer required — it's optional debug visualization.
  useEffect(() => {
    const wanted = pathMode !== 'off' || showWalkOverlay;
    if (!wanted || walk || walkError) return;
    if (!entry?.walkableRawUrl || !entry?.walkableJsonUrl) {
      const msg = `no walkability data for this zone (id=${entry?.zoneId ?? '?'})`;
      console.warn('[walkability]', msg);
      setWalkError(msg);
      return;
    }
    let cancelled = false;
    console.debug('[walkability] loading', entry.walkableRawUrl);
    loadWalkability(asset(entry.walkableRawUrl), asset(entry.walkableJsonUrl))
      .then(w => {
        if (cancelled) return;
        console.debug('[walkability] loaded:', { W: w.W, H: w.H, meta: w.meta });
        setWalk(w);
      })
      .catch(e => {
        if (cancelled) return;
        console.error('[walkability] load failed:', e);
        setWalkError(e.message);
      });
    return () => { cancelled = true; };
  }, [pathMode, showWalkOverlay, entry?.walkableRawUrl, entry?.walkableJsonUrl, walk, walkError]);

  // Bridge data — neighbor-derived axis per tile, plus the per-zone set of
  // type bytes treated as bridges (REACT_WALKABILITY.md §4 / §6). The byte
  // set is built from typeByteMap labels containing "bridge" (case-insensitive),
  // including any override entries from walkability-overrides.js — so cave
  // bridges encoded with bytes other than 0x16 work as long as they're
  // labeled somewhere.
  const bridge = useMemo(() => walk ? computeBridgeAxes(walk) : null, [walk]);

  // Build the set of tiles physically blocked by every overworld event in
  // the zone — NPCs, trainers, items, signs, Pokémon. Source of truth is
  // the full events manifest (REACT_UPDATE_pathfinding.md §1).
  //
  // Foot-anchor fix-up — `pixelCoord` for foot-anchored events points to
  // the sprite's bottom-center on the PNG. The exporter says that's
  // "one pixel below the standing tile's last row" and floor((y-1)/16)
  // should land on the standing tile. That works for INTERIOR zones
  // (single-cell, integer bounds) — but for matrix-0 OVERWORLD zones
  // (multi-cell, non-integer bounds e.g. Route 203's minY=-272.04) the
  // foot pixel ends up an additional tile south of the standing tile.
  // Empirically: interiors need -1, matrix-0 zones need -17 (=-1-16) to
  // land on the visually correct tile. Sign-anchored events ("center")
  // don't need any fix-up in either case.
  const blockedTileSet = useMemo(() => {
    if (!walk || !eventsManifest) return null;
    const stride = walk.meta?.tilePxOnVisibleMap ?? 16;
    const isOverworld = entry?.type === 'overworld';
    const footOffsetY = isOverworld ? 17 : 1;
    const blocked = new Set();
    for (const ev of (eventsManifest.events || [])) {
      if (!ev.pixelCoord) continue;

      // HM-clearable sprite events get filtered out of the static blocked
      // set when the appropriate HM is on. Strength boulders are ALWAYS
      // filtered here regardless of HM state — they flow to the Sokoban
      // solver via `eventBoulders` instead of being static walls.
      const hmSemantic = eventHmSemantic(ev.spriteFile);
      if (hmSemantic === 'strength_boulder')                              continue;
      if (hmSemantic === 'rock_smashable' && pathOpts.rockSmashAvailable) continue;
      if (hmSemantic === 'cut_tree'       && pathOpts.cutAvailable)       continue;

      const yOffset = ev.anchor === 'foot' ? footOffsetY : 0;
      const tx = Math.floor(ev.pixelCoord.x / stride);
      const ty = Math.floor((ev.pixelCoord.y - yOffset) / stride);
      if (tx < 0 || ty < 0 || tx >= walk.W || ty >= walk.H) continue;
      blocked.add(ty * walk.W + tx);
    }
    return blocked;
  }, [walk, eventsManifest, entry?.type, pathOpts.cutAvailable, pathOpts.rockSmashAvailable]);

  // Auto-derived Strength boulder positions from the events manifest.
  // Combined with manually-placed `boulders` (right-click debug tool) for
  // the actual A* call. Recomputed when the manifest or zone changes; the
  // strengthAvailable toggle is consumed by aStar's dispatcher to decide
  // whether to run the Sokoban solver or treat them as static walls.
  const eventBoulders = useMemo(() => {
    if (!walk || !eventsManifest) return [];
    const stride = walk.meta?.tilePxOnVisibleMap ?? 16;
    const isOverworld = entry?.type === 'overworld';
    const footOffsetY = isOverworld ? 17 : 1;
    const out = [];
    for (const ev of (eventsManifest.events || [])) {
      if (!ev.pixelCoord) continue;
      if (eventHmSemantic(ev.spriteFile) !== 'strength_boulder') continue;
      const yOffset = ev.anchor === 'foot' ? footOffsetY : 0;
      const tx = Math.floor(ev.pixelCoord.x / stride);
      const ty = Math.floor((ev.pixelCoord.y - yOffset) / stride);
      if (tx < 0 || ty < 0 || tx >= walk.W || ty >= walk.H) continue;
      out.push({ tx, ty });
    }
    return out;
  }, [walk, eventsManifest, entry?.type]);

  // Recompute the path whenever start/end/walk/opts/blocked change.
  useEffect(() => {
    if (!walk || !bridge || !startTile || !endTile) {
      setPathTiles(null); setPushMarkers([]); return;
    }
    // Combine event-derived Strength boulders (from the events manifest's
    // ow_0085 sprites) with manually-placed boulders. Both flow into the
    // Sokoban solver via opts.boulders.
    const allBoulders = eventBoulders.length || boulders.length
      ? [...eventBoulders, ...boulders]
      : [];
    const result = aStar(walk, bridge, startTile, endTile, {
      ...pathOpts,
      blocked: pathOpts.blockEvents ? blockedTileSet : null,
      boulders: allBoulders,
    });
    if (result) {
      setPathTiles(result.path);
      setPushMarkers(result.pushes || []);
      setPathMode('computed');
    } else {
      setPathTiles(null);
      setPushMarkers([]);
    }
  }, [walk, bridge, startTile, endTile, pathOpts, blockedTileSet, boulders, eventBoulders]);

  // ─── Walkability debug overlay (Rectangle primitives) ───────────────────
  // Renders each non-plain-walkable tile as its own small Leaflet
  // <Rectangle>. Branches on the semantic name from `meta.typeByteMap`
  // rather than internal terrain codes — same source of truth as the A*.
  // Walls + grass + water + ledges + bridges get distinctly colored
  // translucent boxes; plain walkable terrain gets nothing (the visible
  // map shows through).
  //
  // Per-zone tile counts are small (Pokétch ≈ 836 total, Jubilife ≈ 4225,
  // even the biggest is well under 10k) — Leaflet renders these as SVG
  // paths at acceptable performance.
  const walkOverlayTiles = useMemo(() => {
    if (!walk) return null;
    const tiles = [];
    const s = walk.meta?.tilePxOnVisibleMap ?? 16;
    const typeMap = walk.meta?.typeByteMap || {};

    // Whitelist of "interesting" tile categories worth painting. Anything
    // else (plain walkable in all its named variants — `walkable`, `sand`,
    // `walkable_chateau`, `walkable_dock`, `walkable_indoor_*`, etc.) is
    // skipped so the visible map shows through unobstructed. Unmapped
    // bytes (typeName === undefined) ARE painted (magenta) so the rare
    // ROM-hack / data-quality outliers are visually obvious.
    const isInteresting = (typeByte, typeName, isWall) => {
      // HM-gated terrain — must be checked BEFORE isWall because these
      // ship at collisionByte 0x80 (effectiveBlocked returns true) but
      // we want them styled by their HM category, not as red walls.
      if (typeName === 'rock_climb')                  return true;
      if (typeName === 'waterfall')                   return true;
      if (typeName === 'cut_tree')                    return true;
      if (typeName && typeName.startsWith('strength')) return true;
      if (typeName && (typeName.startsWith('rock_smash') || typeName === 'smashable_rock')) return true;
      if (isWall) return true;
      if (!typeName) return true;                                  // unmapped → paint magenta
      if (typeName === 'ice_slip' || typeName === 'ice_thick') return true;
      if (typeName.startsWith('water_'))              return true;
      if (typeName.startsWith('grass'))               return true;  // grass_encounter, etc.
      if (typeName === 'long_grass_encounter')        return true;
      if (typeName === 'tall_grass_dark')             return true;
      if (typeName.startsWith('marsh'))               return true;
      if (typeName.startsWith('ledge_'))              return true;
      if (typeName.startsWith('snow'))                return true;
      if (bridge?.bytes.has(typeByte))                return true;
      return false;                                                // everything else = plain walkable
    };

    for (let y = 0; y < walk.H; y++) {
      for (let x = 0; x < walk.W; x++) {
        const i = (y * walk.W + x) * 2;
        const typeByte      = walk.raw[i];
        const collisionByte = walk.raw[i + 1];
        const typeName      = typeMap[hexKey(typeByte)];
        const isWall        = effectiveBlocked(typeByte, collisionByte);
        if (!isInteresting(typeByte, typeName, isWall)) continue;

        const left   = x * s, right  = x * s + s;
        const top    = y * s, bottom = y * s + s;
        // Leaflet bounds [southWest, northEast] in (lat=−py, lng=px):
        tiles.push({
          typeByte, collisionByte, typeName, isWall,
          bounds: [[-bottom, left], [-top, right]],
        });
      }
    }
    console.debug('[walkability] overlay tiles:', tiles.length, 'of', walk.W * walk.H, 'total');
    return tiles;
  }, [walk]);

  // Per-tile styling for the overlay Rectangles. Branches on semantic name
  // and raw bytes — the same data A* sees, no intermediate terrain code.
  // Bridge tiles are identified via the per-zone bridge byte set so cave
  // bridges with non-canonical bytes (0x70/0x72 etc.) also paint purple.
  function tileStyle({ typeByte, typeName, isWall }) {
    // HM-gated terrain — all checked BEFORE isWall because they ship at
    // collision 0x80 ("impassable without the HM"). Each gets a distinct
    // color so the user can scan the overlay and see which HM unlocks
    // which area at a glance.
    if (typeName === 'rock_climb')
      return { color: '#ea580c', fillColor: '#ea580c', fillOpacity: 0.55, weight: 0 };  // orange
    if (typeName === 'waterfall')
      return { color: '#7dd3fc', fillColor: '#7dd3fc', fillOpacity: 0.65, weight: 0 };  // pale blue
    if (typeName === 'cut_tree')
      return { color: '#16a34a', fillColor: '#16a34a', fillOpacity: 0.6,  weight: 0 };  // forest green
    if (typeName && typeName.startsWith('strength'))
      return { color: '#78716c', fillColor: '#78716c', fillOpacity: 0.7,  weight: 0 };  // stone grey
    if (typeName && (typeName.startsWith('rock_smash') || typeName === 'smashable_rock'))
      return { color: '#a8a29e', fillColor: '#a8a29e', fillOpacity: 0.65, weight: 0 };  // lighter grey
    if (isWall)
      return { color: '#dc2626', fillColor: '#dc2626', fillOpacity: 0.45, weight: 0 };  // red
    // Surface water — any `water_*` semantic. Prefix match catches the
    // new `water_a9` variant the exporter ships for shrine lakes.
    // Requires Surf HM.
    if (typeName && typeName.startsWith('water_'))
      return { color: '#38bdf8', fillColor: '#38bdf8', fillOpacity: 0.45, weight: 0 };
    // Grass + marsh — both are wild-encounter terrain. Marsh paints darker
    // green so it visually distinguishes from grass while still being
    // "encounter-tier."
    if (typeName === 'grass_encounter' || typeName === 'long_grass_encounter' || typeName === 'tall_grass_dark')
      return { color: '#84cc16', fillColor: '#84cc16', fillOpacity: 0.4, weight: 0 };
    if (typeName && typeName.startsWith('marsh'))
      return { color: '#65a30d', fillColor: '#65a30d', fillOpacity: 0.4, weight: 0 };
    // Snow / ice — pale blue tint so the slippery-or-snowy category is
    // visually obvious.
    if (typeName && (typeName.startsWith('snow') || typeName === 'ice_thick'))
      return { color: '#bae6fd', fillColor: '#bae6fd', fillOpacity: 0.5, weight: 0 };
    if (typeName && typeName.startsWith('ledge_'))
      return { color: '#facc15', fillColor: '#facc15', fillOpacity: 0.6, weight: 0 };
    if (bridge?.bytes.has(typeByte))
      return { color: '#a855f7', fillColor: '#a855f7', fillOpacity: 0.35, weight: 0 };
    if (typeName === 'ice_slip')
      return { color: '#9333ea', fillColor: '#9333ea', fillOpacity: 0.3, weight: 0 };
    // Unmapped bytes (not present in typeByteMap) — bright magenta per the
    // spec's #FF00FF "unknown" color. Surfaces tiles the exporter didn't
    // classify, so we can spot cave-specific bridges / unclassified
    // terrain that A* is currently treating as walkable by default.
    if (!typeName)
      return { color: '#d946ef', fillColor: '#d946ef', fillOpacity: 0.65, weight: 0 };
    // Other named-but-unstyled terrain (special_cyan, special_peach) —
    // faint tint so they stand out as "something here".
    return { color: '#22c55e', fillColor: '#22c55e', fillOpacity: 0.18, weight: 0 };
  }

  if (!entry) {
    return (
      <div className="rounded-md border border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-3 text-sm text-amber-800 dark:text-amber-200">
        Unknown zone "{zoneId}". <Link to={mapRoot} className="underline">Back to overworld</Link>.
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="rounded-md border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-700 dark:text-red-300">
        Failed to load zone data: {loadError}
      </div>
    );
  }

  const W = entry.imageWidth;
  const H = entry.imageHeight;
  const imgBounds = [[-H, 0], [0, W]];
  const toLatLng = (px, py) => [-py, px];

  // Convert pixel bounds to Leaflet [southWest, northEast] in (lat=-py, lng=px)
  // coords for use with <Rectangle>.
  const toLeafletBounds = (b) => [
    [-b.maxY, b.minX],
    [-b.minY, b.maxX],
  ];

  const isWorld = entry.type === 'overview';
  // Overworld is huge (~15364×12802); start zoomed out more.
  const minZoom = isWorld ? -5 : -3;
  const maxZoom = 4;

  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-4 items-stretch">
      <div className="relative rounded-md border border-[#e6dabf] dark:border-stone-800 overflow-hidden bg-stone-100 dark:bg-stone-950" style={{ height: 'min(80vh, 800px)' }}>
        <MapContainer
          crs={L.CRS.Simple}
          bounds={imgBounds}
          maxBounds={imgBounds}
          maxBoundsViscosity={0.8}
          minZoom={minZoom}
          maxZoom={maxZoom}
          scrollWheelZoom
          className={pathMode !== 'off' ? 'pathfinding-active' : ''}
          style={{ width: '100%', height: '100%', background: 'transparent' }}
          attributionControl={false}
        >
          <FitBoundsOnLoad bounds={imgBounds} />
          {/*
            Overworld tile pyramid vs single ImageOverlay.
            ---------------------------------------------
            Single <ImageOverlay> with a 15364×15360 (Sinnoh) or 16000×5798
            (Johto) bitmap means the browser holds the full decoded RGBA in
            one GPU texture (~944 MB / ~372 MB) and recomposites the lot on
            every pan/zoom frame. The square Sinnoh image is right at the
            16384 GPU max-texture cap, where some drivers also fall back to
            a slow path — so panning judders.

            <TileLayer> over a precomputed pyramid composites only the
            ~12–30 256-px tiles in view per frame instead.

            Calibration with CRS.Simple (1 projected unit = 1 pixel at map
            zoom 0). The pyramid uses URL z=0 for the native (1:1) level and
            negative z for downsampled levels (z=-1 = half-res, …, z=-N =
            single overview tile). That matches Leaflet's tile geometry —
            tile_size_in_units = 256 / 2^URL_z — without needing a custom
            CRS or zoomOffset gymnastics:
              z=0  → 256 units/tile = 256 image pixels (native)
              z=-3 → 2048 units/tile = 2048 image pixels (1/8 res)
            so the build script generates one 256-px webp per URL z + (x,y).

            Settings:
              - `maxNativeZoom = 0` — at map zoom > 0 Leaflet upscales the
                z=0 tile instead of asking for a level that doesn't exist.
                Matches the prior <ImageOverlay>'s browser-side upscale, so
                the visual at extreme zoom-in is unchanged.
              - `minNativeZoom = -tilePyramidDepth` — same idea on the
                zoom-out floor.
              - `bounds = imgBounds` — Leaflet won't request tiles outside
                the image, so the build script can skip generating them.

            Fallback: if the build hasn't written a tile pyramid yet (or
            generation failed), entry.tileUrlTemplate is absent and we
            render the single <ImageOverlay> as before. Keeps deploys
            independent of whether the bucket is up-to-date.
          */}
          {entry.tileUrlTemplate ? (
            <TileLayer
              // asset() passes absolute R2 URLs through, prepends Vite's
              // BASE_URL for relative dev URLs. The `{z}/{x}/{y}` placeholders
              // pass through both transforms untouched — Leaflet templates
              // {z} as the signed integer (e.g. `-3`) verbatim.
              url={asset(entry.tileUrlTemplate)}
              tileSize={entry.tileSize ?? 256}
              minNativeZoom={-entry.tilePyramidDepth}
              maxNativeZoom={0}
              bounds={imgBounds}
              noWrap
              // Keep request-count predictable on slow networks; default 2 is
              // fine for cached pans, this protects the first paint when 30+
              // tiles are needed at once.
              keepBuffer={2}
            />
          ) : (
            <ImageOverlay url={asset(entry.imageUrl)} bounds={imgBounds} />
          )}

          {/* Walkability debug overlay — one Rectangle per non-walkable
              tile. Walkable tiles get no overlay (the visible map shows
              through cleanly). */}
          {showWalkOverlay && walkOverlayTiles && walkOverlayTiles.map((t, i) => (
            <Rectangle
              key={i}
              bounds={t.bounds}
              pathOptions={tileStyle(t)}
              interactive={false}
            />
          ))}

          {/* Blocked-tile debug overlay — visualizes the tiles being marked
              as obstacles by trainers (and eventually NPCs). Distinct from
              the walkability overlay so we can see how trainer→tile
              mapping lines up. Renders even when walkability overlay is
              off, so the user can verify blocking in isolation. */}
          {pathMode !== 'off' && pathOpts.blockEvents && blockedTileSet && walk && (() => {
            const s = walk.meta?.tilePxOnVisibleMap ?? 16;
            return [...blockedTileSet].map((idx) => {
              const ty = Math.floor(idx / walk.W);
              const tx = idx - ty * walk.W;
              const left   = tx * s;
              const right  = (tx + 1) * s;
              const top    = ty * s;
              const bottom = (ty + 1) * s;
              return (
                <Rectangle
                  key={`blocked-${idx}`}
                  bounds={[[-bottom, left], [-top, right]]}
                  pathOptions={{
                    color: '#7c3aed',          // violet — distinct from red (walls) + red-orange (trainers)
                    weight: 2,
                    fillColor: '#7c3aed',
                    fillOpacity: 0.55,
                    dashArray: '2,2',
                  }}
                  interactive={false}
                />
              );
            });
          })()}

          {/* Pathfinding click capture — render eagerly as soon as path
              mode is on, even before walkability data has loaded. The
              capturer silently ignores clicks while walk is null so the
              user can start clicking immediately and the click that lands
              after walk loads becomes the first usable input. */}
          {pathMode !== 'off' && (
            <PathfindingClickCapture
              walk={walk}
              onPickTile={(tile) => {
                if (pathMode === 'placingStart') {
                  setStartTile(tile);
                  setEndTile(null);
                  setPathTiles(null);
                  setPathMode('placingEnd');
                } else {
                  setEndTile(tile);
                  // pathMode → 'computed' is set inside the recompute effect.
                }
              }}
              onToggleBoulder={(tile) => {
                setBoulders(prev => {
                  const i = prev.findIndex(b => b.tx === tile.tx && b.ty === tile.ty);
                  if (i >= 0) return prev.filter((_, j) => j !== i);   // remove
                  return [...prev, tile];                              // add
                });
              }}
            />
          )}

          {/* Event-derived Strength boulders (ow_0082) flow into the
              Sokoban solver but render no marker — the boulder sprite is
              already baked into the visible map PNG by build_world.py,
              and a redundant overlay just clutters the view.
              Manually-placed debug boulders DO render below (stone-grey)
              because they're hand-placed and have no corresponding map
              sprite. */}
          {pathMode !== 'off' && walk && boulders.map((b, i) => {
            const { px, py } = tileToPixelCenter(b.tx, b.ty, walk.meta);
            return (
              <CircleMarker
                key={`boulder-${b.tx}-${b.ty}`}
                center={[-py, px]}
                radius={7}
                pathOptions={{
                  color: '#44403c', weight: 2,
                  fillColor: '#78716c', fillOpacity: 0.9,
                }}
              >
                <Tooltip direction="top" offset={[0, -8]}>
                  Debug boulder ({b.tx}, {b.ty}) — right-click to remove
                </Tooltip>
              </CircleMarker>
            );
          })}

          {/* Path overlay — green polyline + start/end markers. */}
          {pathTiles && walk && (
            <Polyline
              positions={pathTiles.map(({ tx, ty }) => {
                const { px, py } = tileToPixelCenter(tx, ty, walk.meta);
                return [-py, px];
              })}
              pathOptions={{ color: '#22c55e', weight: 4, opacity: 0.9, dashArray: '6,3' }}
            />
          )}

          {/* Cross-route segment overlay — if this zone is part of an
              active cross-zone route, draw THAT segment's path so the
              user immediately sees where the route goes through this
              floor / map. Distinct purple-violet styling so it doesn't
              get confused with the user's own pathfinding output above.
              Stride hardcoded to 16 (DPPt 1.0 ppu) so this works even
              when the user hasn't opened pathfinding mode in this zone
              (no `walk` data loaded). */}
          {(() => {
            const seg = crossRoute?.segments?.find(s => String(s.zoneId) === String(zoneId));
            if (!seg?.path || seg.path.length < 2) return null;
            const stride = seg.walk?.meta?.tilePxOnVisibleMap ?? 16;
            const positions = seg.path.map(({ tx, ty }) => [-(ty * stride + stride / 2), tx * stride + stride / 2]);
            const fromPx = { x: seg.fromTile.tx * stride + stride / 2, y: seg.fromTile.ty * stride + stride / 2 };
            const toPx   = { x: seg.toTile.tx   * stride + stride / 2, y: seg.toTile.ty   * stride + stride / 2 };
            return (
              <Fragment>
                <Polyline
                  positions={positions}
                  pathOptions={{ color: '#a855f7', weight: 5, opacity: 0.85, dashArray: '8,4' }}
                />
                <CircleMarker
                  center={[-fromPx.y, fromPx.x]}
                  radius={6}
                  pathOptions={{ color: '#6b21a8', weight: 2, fillColor: '#a855f7', fillOpacity: 0.95 }}
                >
                  <Tooltip direction="top" offset={[0, -6]}>Route enters here</Tooltip>
                </CircleMarker>
                <CircleMarker
                  center={[-toPx.y, toPx.x]}
                  radius={6}
                  pathOptions={{ color: '#6b21a8', weight: 2, fillColor: seg.isFinal ? '#dc2626' : '#a855f7', fillOpacity: 0.95 }}
                >
                  <Tooltip direction="top" offset={[0, -6]}>
                    {seg.isFinal ? 'Route destination' :
                      `Exit to ${mapsIndex[seg.exitsViaWarp?.toZone]?.displayName || 'next zone'}`}
                  </Tooltip>
                </CircleMarker>
              </Fragment>
            );
          })()}

          {/* Push markers — for each Strength push event, draw a short
              amber polyline from the boulder's original tile to its
              destination tile, plus a small marker at the player's tile
              showing where the shove happened. Lets the user see exactly
              where Sokoban-style pushes occur along an otherwise normal-
              looking green path. */}
          {pathTiles && walk && pushMarkers.map((p, i) => {
            const from = tileToPixelCenter(p.boulderFrom.tx, p.boulderFrom.ty, walk.meta);
            const to   = tileToPixelCenter(p.boulderTo.tx,   p.boulderTo.ty,   walk.meta);
            const at   = tileToPixelCenter(p.playerTile.tx,  p.playerTile.ty,  walk.meta);
            return (
              <Fragment key={`push-${i}`}>
                <Polyline
                  positions={[[-from.py, from.px], [-to.py, to.px]]}
                  pathOptions={{ color: '#f59e0b', weight: 4, opacity: 0.95 }}
                />
                <CircleMarker
                  center={[-to.py, to.px]}
                  radius={5}
                  pathOptions={{ color: '#78716c', weight: 2, fillColor: '#a8a29e', fillOpacity: 0.95 }}
                >
                  <Tooltip direction="top" offset={[0, -6]}>
                    Push #{i + 1}: ({p.boulderFrom.tx}, {p.boulderFrom.ty}) → ({p.boulderTo.tx}, {p.boulderTo.ty})
                  </Tooltip>
                </CircleMarker>
                <CircleMarker
                  center={[-at.py, at.px]}
                  radius={3}
                  pathOptions={{ color: '#92400e', weight: 1, fillColor: '#f59e0b', fillOpacity: 0.9 }}
                />
              </Fragment>
            );
          })}
          {startTile && walk && (() => {
            const { px, py } = tileToPixelCenter(startTile.tx, startTile.ty, walk.meta);
            return (
              <CircleMarker
                center={[-py, px]}
                radius={6}
                pathOptions={{ color: '#15803d', weight: 2, fillColor: '#22c55e', fillOpacity: 1 }}
              >
                <Tooltip direction="top" offset={[0, -6]}>Start</Tooltip>
              </CircleMarker>
            );
          })()}
          {endTile && walk && (() => {
            const { px, py } = tileToPixelCenter(endTile.tx, endTile.ty, walk.meta);
            return (
              <CircleMarker
                center={[-py, px]}
                radius={6}
                pathOptions={{ color: '#991b1b', weight: 2, fillColor: '#ef4444', fillOpacity: 1 }}
              >
                <Tooltip direction="top" offset={[0, -6]}>End</Tooltip>
              </CircleMarker>
            );
          })()}

          {/* Overworld view: clickable regions from warps/overworld.json. Each
              region has a true pixelBounds rectangle, so we render an outline
              + a center marker. The rectangle is the actual hit zone. */}
          {isWorld && overworldLocations.map(loc => (
            <Rectangle
              key={loc.zoneId}
              bounds={toLeafletBounds(loc.pixelBounds)}
              pathOptions={{
                color: '#10b981',
                weight: 2,
                fillColor: '#10b981',
                fillOpacity: 0.18,
                className: 'overworld-region',
              }}
              eventHandlers={{ click: () => onNavigateToZone(loc.zoneId) }}
            >
              <Tooltip direction="top" offset={[0, -4]} opacity={0.95} sticky>
                {loc.name}
              </Tooltip>
            </Rectangle>
          ))}


          {/* Detail view: warps + trainer click zones. Trainer SPRITES are
              already baked into the map PNG by build_world.py — we only add
              invisible-until-hover click zones over them. */}
          {!isWorld && events && (
            <>
              {/* Warps + trainer hit-zones — only render when NOT in
                  pathfinding mode. react-leaflet 4 doesn't reliably re-bind
                  Path event handlers when `interactive` changes after mount,
                  so toggling the prop alone leaves stale click listeners
                  that swallow path-mode clicks. Conditional render bypasses
                  that entirely. */}
              {pathMode === 'off' && visible.warps && events.warps
                .filter(onMap)
                .filter(w => w.destinationZoneId != null && mapsIndex[w.destinationZoneId])
                .map(w => {
                  const dest = mapsIndex[w.destinationZoneId];
                  return (
                    <Marker
                      key={w.id}
                      position={toLatLng(w.pixelX, w.pixelY)}
                      icon={ICONS.warp}
                      eventHandlers={{ click: () => onNavigateToZone(w.destinationZoneId) }}
                    >
                      <Tooltip direction="top" offset={[0, -10]}>→ {dest.displayName}</Tooltip>
                    </Marker>
                  );
                })}
              {visible.trainers && events.trainers.filter(onMap).map(t => {
                // Two rendering modes — react-leaflet 4 can't reliably
                // re-bind Path event handlers when `interactive` flips, so
                // we key the rectangle on the mode and let React remount
                // it cleanly when entering / leaving path mode.
                const inPathMode = pathMode !== 'off';
                return (
                  <Rectangle
                    key={`${t.id}-${inPathMode ? 'path' : 'click'}`}
                    bounds={trainerHitBounds(t.pixelX, t.pixelY)}
                    interactive={!inPathMode}
                    pathOptions={{
                      color: '#dc2626',
                      weight: 2,
                      opacity: 1,
                      fillColor: '#ef4444',
                      // Slightly bolder fill in path mode so trainers read
                      // as "obstacle" rather than "click target".
                      fillOpacity: inPathMode && pathOpts.blockEvents ? 0.35 : 0.25,
                      dashArray: '4,2',
                      className: 'trainer-hit',
                    }}
                    eventHandlers={inPathMode ? undefined : { click: () => setSelected({ kind: 'trainer', data: t }) }}
                  >
                    {!inPathMode && (
                      <Tooltip direction="top" sticky>
                        {t.trainerName || `Trainer #${t.trainerInstanceId}`}
                        {t.isDoubleBattlePartner ? ' · tag' : ''}
                      </Tooltip>
                    )}
                  </Rectangle>
                );
              })}
            </>
          )}
        </MapContainer>
      </div>

      <aside className="space-y-3">
        {!isWorld && (
          <FormCard title="Click zones">
            <div className="space-y-1.5">
              {MARKER_KINDS.map(({ key, label, Icon }) => {
                let count;
                if (key === 'warps') {
                  count = (events?.warps || []).filter(onMap)
                    .filter(w => w.destinationZoneId != null && mapsIndex[w.destinationZoneId]).length;
                } else {
                  count = (events?.trainers || []).filter(onMap).length;
                }
                return (
                  <label key={key} className="flex items-center gap-2 text-sm text-stone-700 dark:text-stone-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={visible[key]}
                      onChange={(e) => setVisible(v => ({ ...v, [key]: e.target.checked }))}
                      className="accent-blue-500"
                    />
                    <Icon size={14} className="text-stone-500 dark:text-stone-400" />
                    <span className="flex-1">{label}</span>
                    <span className="tabular-nums text-xs text-stone-500 dark:text-stone-400">{count}</span>
                  </label>
                );
              })}
            </div>
            <div className="text-[11px] text-stone-500 dark:text-stone-400 leading-tight">
              Trainer / NPC / item sprites are baked into the map image. Click zones overlay
              the trainers so you can open their info panel; everything else is decorative.
            </div>
          </FormCard>
        )}

        {isWorld && (
          <FormCard title={regionDisplay}>
            <div className="text-sm text-stone-700 dark:text-stone-300">
              Click any green region to open its detail map.
              {' '}<span className="text-stone-500 dark:text-stone-400">{overworldLocations.length} locations.</span>
            </div>
          </FormCard>
        )}

        {!isWorld && (
          <PathfindingCard
            entry={entry}
            pathMode={pathMode}
            setPathMode={setPathMode}
            startTile={startTile}
            endTile={endTile}
            pathTiles={pathTiles}
            walkError={walkError}
            walk={walk}
            pathOpts={pathOpts}
            setPathOpts={setPathOpts}
            showWalkOverlay={showWalkOverlay}
            setShowWalkOverlay={setShowWalkOverlay}
            boulders={boulders}
            eventBoulders={eventBoulders}
            onClearBoulders={() => setBoulders([])}
            onClear={() => {
              setStartTile(null);
              setEndTile(null);
              setPathTiles(null);
              setBoulders([]);
              setPathMode('off');
            }}
          />
        )}

        {!isWorld && mapsIndex && zoneGraph && startTile && (
          <CrossMapCard
            mapsIndex={mapsIndex}
            zoneGraph={zoneGraph}
            currentZoneId={zoneId}
            startTile={startTile}
            crossDestZone={crossDestZone}
            setCrossDestZone={setCrossDestZone}
            crossDestTile={crossDestTile}
            setCrossDestTile={setCrossDestTile}
            crossSegments={crossSegments}
            crossLoading={crossLoading}
            crossError={crossError}
            onCompute={computeCrossMapRoute}
            onClear={() => {
              setCrossRoute(null);
              setCrossDestZone(null);
              setCrossDestTile(null);
              setCrossError(null);
            }}
            onJumpToZone={onNavigateToZone}
          />
        )}

        {selected && (
          <InfoPanel selection={selected} onClose={() => setSelected(null)} />
        )}

        {!selected && !isWorld && (
          <FormCard title="Selection">
            <div className="text-xs text-stone-500 dark:text-stone-400">Click any trainer or warp to see details.</div>
          </FormCard>
        )}
      </aside>
    </div>
  );
}

function FitBoundsOnLoad({ bounds }) {
  const map = useMap();
  useEffect(() => { map.fitBounds(bounds); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/* ─────────────── Pathfinding sidebar card ─────────────── */

function PathfindingCard({
  entry, pathMode, setPathMode, startTile, endTile, pathTiles,
  walkError, walk, pathOpts, setPathOpts,
  showWalkOverlay, setShowWalkOverlay,
  boulders, eventBoulders, onClearBoulders,
  onClear,
}) {
  // Pathfinding requires the raw bin + JSON (the PNG is optional debug viz).
  const hasWalkable = !!entry?.walkableRawUrl;

  if (!hasWalkable) {
    return (
      <FormCard title="Pathfinding">
        <div className="text-xs text-stone-500 dark:text-stone-400">
          This zone has no walkability data. Pathfinding is only available for
          zones where the DSPRE export produced a walkable sidecar.
        </div>
      </FormCard>
    );
  }

  return (
    <FormCard
      title="Pathfinding"
      action={
        pathMode !== 'off' && (
          <button
            type="button"
            onClick={onClear}
            className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded
                       border border-[#d6c8a3] dark:border-stone-700
                       text-stone-600 dark:text-stone-300
                       hover:bg-[#ece2c4] dark:hover:bg-stone-800"
          >
            Clear
          </button>
        )
      }
    >
      {pathMode === 'off' && (
        <button
          type="button"
          onClick={() => setPathMode('placingStart')}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm
                     bg-green-600 hover:bg-green-700 text-white font-medium"
        >
          <RouteIcon size={14} /> Find route on this map
        </button>
      )}

      {/* Debug overlay toggle — available at any time, including before path
          mode starts. Color-codes walkability tiles on top of the visible
          map so the user can verify alignment. */}
      <label className="flex items-center gap-2 text-xs text-stone-700 dark:text-stone-300 cursor-pointer pt-1">
        <input
          type="checkbox"
          checked={showWalkOverlay}
          onChange={(e) => setShowWalkOverlay(e.target.checked)}
          className="accent-amber-500"
        />
        <span className="flex-1">Show walkability overlay</span>
        <span className="text-[10px] text-stone-500 dark:text-stone-500">debug</span>
      </label>
      {showWalkOverlay && (
        <div className="text-[10px] leading-snug text-stone-500 dark:text-stone-400 -mt-1">
          <span className="inline-block w-2 h-2 mr-1 align-middle" style={{ background: 'rgba(34,197,94,.55)' }} />walkable
          <span className="inline-block w-2 h-2 ml-3 mr-1 align-middle" style={{ background: 'rgba(220,38,38,.7)' }} />wall
          <span className="inline-block w-2 h-2 ml-3 mr-1 align-middle" style={{ background: 'rgba(132,204,22,.7)' }} />grass
          <span className="inline-block w-2 h-2 ml-3 mr-1 align-middle" style={{ background: 'rgba(56,189,248,.7)' }} />water
          <span className="inline-block w-2 h-2 ml-3 mr-1 align-middle" style={{ background: 'rgba(250,204,21,.8)' }} />ledge
        </div>
      )}

      {pathMode !== 'off' && (
        <>
          <div className="space-y-1 text-xs">
            <StepLine
              done={!!startTile}
              active={pathMode === 'placingStart'}
              Icon={MapPin}
              label="Click a tile for the start"
              value={startTile && `(${startTile.tx}, ${startTile.ty})`}
            />
            <StepLine
              done={!!endTile}
              active={pathMode === 'placingEnd'}
              Icon={Flag}
              label="Click a tile for the destination"
              value={endTile && `(${endTile.tx}, ${endTile.ty})`}
            />
          </div>

          {pathMode === 'computed' && (
            <div className="text-xs">
              {pathTiles ? (
                <div className="text-green-700 dark:text-green-400 font-medium">
                  ✓ Path found — {pathTiles.length} tiles ({pathTiles.length - 1} steps)
                </div>
              ) : (
                <div className="text-red-700 dark:text-red-400 font-medium">
                  ✗ No route possible between these tiles under current options.
                </div>
              )}
            </div>
          )}

          {/* Strength boulders — auto-derived from the events manifest
              (ow_0085 sprites) PLUS any debug boulders the user dropped
              by right-click. Both flow into the Sokoban solver identically;
              the count display shows them separately so it's clear what's
              from data vs hand-placed. */}
          <div className="pt-2 border-t border-[#e6dabf] dark:border-stone-800">
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-wider text-stone-500 dark:text-stone-400">
                Strength boulders
                <span className="ml-1.5 tabular-nums text-stone-600 dark:text-stone-300 normal-case">
                  · {eventBoulders?.length ?? 0} data
                  {boulders?.length > 0 && (
                    <span> · {boulders.length} debug</span>
                  )}
                </span>
              </div>
              {boulders?.length > 0 && (
                <button
                  type="button"
                  onClick={onClearBoulders}
                  className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded
                             border border-[#d6c8a3] dark:border-stone-700
                             text-stone-600 dark:text-stone-300
                             hover:bg-[#ece2c4] dark:hover:bg-stone-800"
                >
                  Clear debug
                </button>
              )}
            </div>
            <div className="text-[10px] leading-snug text-stone-500 dark:text-stone-400 mt-1">
              Brown markers are real ow_0085 Strength boulders from the
              events manifest. Right-click any tile to add or remove a
              grey debug boulder for testing. With Strength on, A* pushes
              them; with Strength off, they're all static walls.
            </div>
          </div>

          <div className="space-y-1 pt-2 border-t border-[#e6dabf] dark:border-stone-800">
            <div className="text-[10px] uppercase tracking-wider text-stone-500 dark:text-stone-400">
              Options
            </div>
            <PathOpt label="Surf available"        checked={pathOpts.surfAvailable}       onChange={v => setPathOpts(o => ({ ...o, surfAvailable: v }))} />
            <PathOpt label="Waterfall available"   checked={pathOpts.waterfallAvailable}  onChange={v => setPathOpts(o => ({ ...o, waterfallAvailable: v }))} />
            <PathOpt label="Rock Climb available"  checked={pathOpts.rockClimbAvailable}  onChange={v => setPathOpts(o => ({ ...o, rockClimbAvailable: v }))} />
            <PathOpt label="Cut available"         checked={pathOpts.cutAvailable}        onChange={v => setPathOpts(o => ({ ...o, cutAvailable: v }))} />
            <PathOpt label="Strength available"    checked={pathOpts.strengthAvailable}   onChange={v => setPathOpts(o => ({ ...o, strengthAvailable: v }))} />
            <PathOpt label="Rock Smash available"  checked={pathOpts.rockSmashAvailable}  onChange={v => setPathOpts(o => ({ ...o, rockSmashAvailable: v }))} />
            <PathOpt label="Bike available"        checked={pathOpts.bikeAvailable}       onChange={v => setPathOpts(o => ({ ...o, bikeAvailable: v }))} />
            <PathOpt label="Avoid tall grass"      checked={pathOpts.avoidGrass}          onChange={v => setPathOpts(o => ({ ...o, avoidGrass: v }))} />
            <PathOpt label="Block NPCs / trainers" checked={pathOpts.blockEvents}         onChange={v => setPathOpts(o => ({ ...o, blockEvents: v }))} />
          </div>

          {walkError && (
            <div className="text-[11px] text-red-700 dark:text-red-400">
              Walkability data failed to load: {walkError}
            </div>
          )}
          {!walk && !walkError && (
            <div className="text-[11px] text-stone-500 dark:text-stone-400">
              Loading walkability data…
            </div>
          )}
        </>
      )}
    </FormCard>
  );
}

function StepLine({ done, active, Icon, label, value }) {
  return (
    <div className={`flex items-center gap-2 ${active ? 'text-stone-900 dark:text-stone-100' : (done ? 'text-stone-700 dark:text-stone-300' : 'text-stone-500 dark:text-stone-400')}`}>
      <Icon size={12} className={done ? 'text-green-600' : (active ? 'text-blue-500' : '')} />
      <span className={`flex-1 ${active ? 'font-medium' : ''}`}>{label}</span>
      {value && <span className="text-[10px] font-mono text-stone-500 dark:text-stone-500">{value}</span>}
    </div>
  );
}

function PathOpt({ label, checked, onChange }) {
  return (
    <label className="flex items-center gap-2 text-xs text-stone-700 dark:text-stone-300 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-green-600"
      />
      <span className="flex-1">{label}</span>
    </label>
  );
}

// Captures map clicks while pathfinding is active. Two handlers:
//   - Left-click → onPickTile (sets start or end tile)
//   - Right-click (contextmenu) → onToggleBoulder (debug boulder placement)
//
// Both convert the click's lat/lng to a walkability tile coord. Lives
// inside <MapContainer> so it can use useMapEvents.
//
// Since the walkability grid is aligned to the visible-map pixel space,
// pixel ↔ tile is a single divide-by-tilePxOnVisibleMap.
function PathfindingClickCapture({ walk, onPickTile, onToggleBoulder }) {
  const resolveTile = (latlng) => {
    if (!walk) return null;
    const px = latlng.lng;
    const py = -latlng.lat;
    const t = pixelToTile(px, py, walk.meta);
    if (t.tx < 0 || t.ty < 0 || t.tx >= walk.W || t.ty >= walk.H) return null;
    return t;
  };
  useMapEvents({
    click(e) {
      const t = resolveTile(e.latlng);
      if (!t) {
        if (!walk) console.debug('[pathfinding] click ignored — walkability loading');
        return;
      }
      onPickTile(t);
    },
    contextmenu(e) {
      // Right-click → toggle boulder. Suppress the browser's native
      // context menu (Leaflet's `contextmenu` event leaks through to
      // the DOM otherwise).
      e.originalEvent?.preventDefault?.();
      const t = resolveTile(e.latlng);
      if (!t) return;
      onToggleBoulder?.(t);
    },
  });
  return null;
}

/* ─────────────── Cross-map (zone-to-zone) routing card ─────────────── */

// Sidebar card: pick a destination zone, "Find route" → list of segments,
// each segment shown as a mini-map (zone PNG + path polyline overlay) with
// click-to-jump.
function CrossMapCard({
  mapsIndex, zoneGraph, currentZoneId, startTile,
  crossDestZone, setCrossDestZone,
  crossDestTile, setCrossDestTile,
  crossSegments, crossLoading, crossError,
  onCompute, onClear, onJumpToZone,
}) {
  // Zone options for the combobox — every zone except the current one.
  const destOptions = useMemo(() => {
    return Object.entries(mapsIndex)
      .filter(([k]) => k !== 'world' && k !== String(currentZoneId))
      .filter(([, m]) => m.displayName !== 'Mystery Zone')
      .map(([id, m]) => ({
        id,
        name: m.displayName || `Zone ${id}`,
        type: m.type,
        label: `${String(id).padStart(4, '0')} — ${m.displayName || `Zone ${id}`}`,
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || Number(a.id) - Number(b.id));
  }, [mapsIndex, currentZoneId]);

  return (
    <FormCard
      title="Cross-map route"
      action={
        crossSegments && (
          <button
            type="button"
            onClick={onClear}
            className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded
                       border border-[#d6c8a3] dark:border-stone-700
                       text-stone-600 dark:text-stone-300
                       hover:bg-[#ece2c4] dark:hover:bg-stone-800"
          >
            Clear
          </button>
        )
      }
    >
      <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-wider text-stone-500 dark:text-stone-400">
          Travel from <span className="font-mono normal-case text-stone-700 dark:text-stone-300">
            ({startTile.tx}, {startTile.ty})
          </span> to:
        </div>
        <ZoneCombobox
          options={destOptions}
          value={crossDestZone ?? ''}
          onChange={setCrossDestZone}
        />

        {/* Destination tile picker — appears once a destination zone is
            selected. Defaults to zone center; click on the preview to
            set a specific goal tile. Refines the cross-zone A* target. */}
        {crossDestZone && mapsIndex[crossDestZone] && (
          <DestinationTilePicker
            entry={mapsIndex[crossDestZone]}
            value={crossDestTile}
            onChange={setCrossDestTile}
          />
        )}

        <button
          type="button"
          disabled={!crossDestZone || crossLoading}
          onClick={onCompute}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm
                     bg-indigo-600 hover:bg-indigo-700 disabled:bg-stone-400
                     disabled:cursor-not-allowed text-white font-medium"
        >
          {crossLoading ? 'Finding route…' : 'Find cross-map route'}
        </button>
      </div>

      {crossError && (
        <div className="text-[11px] text-red-700 dark:text-red-400 mt-2">{crossError}</div>
      )}

      {crossSegments && (
        <div className="space-y-2 mt-2">
          <div className="text-[10px] uppercase tracking-wider text-stone-500 dark:text-stone-400">
            Route — {crossSegments.length} segment{crossSegments.length === 1 ? '' : 's'}
            <span className="ml-2 normal-case text-stone-400 dark:text-stone-500">
              click any segment to open that zone with its path drawn
            </span>
          </div>
          {crossSegments.map((seg, i) => (
            <SegmentMiniMap
              key={`${seg.zoneId}-${i}`}
              index={i}
              total={crossSegments.length}
              segment={seg}
              mapsIndex={mapsIndex}
              onJumpToZone={onJumpToZone}
            />
          ))}
        </div>
      )}
    </FormCard>
  );
}

// Destination tile picker for cross-map routing. Renders the destination
// zone's map at a compact size; clicking sets the goal tile. The chosen
// tile is shown as a red crosshair overlay. Click the same spot to clear
// (returns to default = zone center).
function DestinationTilePicker({ entry, value, onChange }) {
  const imgRef = useRef(null);
  const W = entry.imageWidth, H = entry.imageHeight;

  const handleClick = (e) => {
    const img = imgRef.current;
    if (!img) return;
    // Get the IMAGE's rendered rect — accounts for object-contain letterboxing.
    // We need to compute the click position relative to the displayed image,
    // then scale to original image pixel coords.
    const rect = img.getBoundingClientRect();
    // Image fills the box with object-contain, so its actual displayed
    // dimensions might be smaller than rect (preserving aspect ratio).
    // Compute the rendered image's offset within the box.
    const boxAspect = rect.width / rect.height;
    const imgAspect = W / H;
    let renderedW, renderedH, offsetX, offsetY;
    if (boxAspect > imgAspect) {
      // Box wider than image — letterbox left/right
      renderedH = rect.height;
      renderedW = renderedH * imgAspect;
      offsetX = (rect.width - renderedW) / 2;
      offsetY = 0;
    } else {
      // Box taller than image — letterbox top/bottom
      renderedW = rect.width;
      renderedH = renderedW / imgAspect;
      offsetX = 0;
      offsetY = (rect.height - renderedH) / 2;
    }
    const xPx = (e.clientX - rect.left - offsetX) * (W / renderedW);
    const yPx = (e.clientY - rect.top  - offsetY) * (H / renderedH);
    if (xPx < 0 || xPx >= W || yPx < 0 || yPx >= H) return;   // clicked in letterbox
    const tx = Math.floor(xPx / 16);
    const ty = Math.floor(yPx / 16);
    // Toggle off if clicking the same tile.
    if (value && value.tx === tx && value.ty === ty) onChange(null);
    else onChange({ tx, ty });
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wider text-stone-500 dark:text-stone-400">
          Goal tile
        </div>
        <div className="text-[10px] font-mono text-stone-600 dark:text-stone-300 tabular-nums">
          {value ? `(${value.tx}, ${value.ty})` : '(zone center)'}
        </div>
      </div>
      <div
        className="relative rounded-md border border-[#d6c8a3] dark:border-stone-700
                   bg-stone-100 dark:bg-stone-950 overflow-hidden cursor-crosshair"
        style={{ aspectRatio: `${W} / ${H}`, maxHeight: 180 }}
        onClick={handleClick}
      >
        <img
          ref={imgRef}
          src={asset(entry.imageUrl)}
          alt={entry.displayName}
          className="absolute inset-0 w-full h-full object-contain pixelated pointer-events-none"
          loading="lazy"
        />
        {value && (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="xMidYMid meet"
            className="absolute inset-0 w-full h-full pointer-events-none"
          >
            <circle
              cx={value.tx * 16 + 8}
              cy={value.ty * 16 + 8}
              r={Math.max(4, Math.min(W, H) / 50)}
              fill="#dc2626"
              stroke="#fff"
              strokeWidth={2}
            />
          </svg>
        )}
      </div>
      <div className="text-[10px] leading-snug text-stone-500 dark:text-stone-400">
        Click anywhere on the preview to set a specific goal tile. Click
        the same spot again to clear (defaults to zone center).
      </div>
    </div>
  );
}

// One segment of a cross-zone route — shows the zone's map with the
// tile-level path drawn on it. Clicking jumps to that zone in the main
// view (the user can then use the regular pathfinding UI for that zone).
function SegmentMiniMap({ index, total, segment, mapsIndex, onJumpToZone }) {
  const entry = mapsIndex[segment.zoneId];
  if (!entry) return null;
  const W = entry.imageWidth, H = entry.imageHeight;

  // Convert the path tile sequence to SVG polyline points.
  const stride = segment.walk?.meta?.tilePxOnVisibleMap ?? 16;
  const pathPoints = (segment.path || []).map(t => {
    return `${t.tx * stride + stride / 2},${t.ty * stride + stride / 2}`;
  }).join(' ');

  // From / to markers (pixel coords on the segment's map).
  const fromPx = { x: segment.fromTile.tx * stride + stride / 2, y: segment.fromTile.ty * stride + stride / 2 };
  const toPx   = { x: segment.toTile.tx   * stride + stride / 2, y: segment.toTile.ty   * stride + stride / 2 };

  const isAdjacency = segment.exitsViaWarp?.warpId?.startsWith('adj-');
  const transitionLabel = segment.isFinal
    ? 'destination'
    : isAdjacency
      ? `walk into ${mapsIndex[segment.exitsViaWarp.toZone]?.displayName || 'next zone'}`
      : `warp to ${mapsIndex[segment.exitsViaWarp.toZone]?.displayName || 'next zone'}`;

  return (
    <button
      type="button"
      onClick={() => onJumpToZone?.(segment.zoneId)}
      className="w-full text-left rounded-md border border-[#d6c8a3] dark:border-stone-700
                 bg-[#fdf8e9] dark:bg-stone-900 hover:bg-[#ece2c4] dark:hover:bg-stone-800
                 overflow-hidden"
    >
      <div className="px-2 pt-1.5 pb-1 flex items-center justify-between">
        <div className="text-xs font-semibold text-stone-800 dark:text-stone-200 truncate">
          {index + 1}. {entry.displayName}
        </div>
        <span className="text-[10px] uppercase tracking-wider text-stone-500 dark:text-stone-400">
          {segment.isFinal ? 'end' : isAdjacency ? 'walk' : 'warp'}
        </span>
      </div>
      <div className="text-[10px] text-stone-500 dark:text-stone-400 px-2 pb-1.5">
        {segment.path
          ? `${segment.path.length} tile${segment.path.length === 1 ? '' : 's'} • → ${transitionLabel}`
          : (segment.error || 'no tile path computed')}
      </div>
      {/* Mini-map: zone image with path SVG overlay. Image is fit to a
          fixed bounding box; SVG uses the same viewBox as the original
          map's pixel dimensions, so path coords need no rescaling. */}
      <div className="relative bg-stone-100 dark:bg-stone-950" style={{ aspectRatio: `${W} / ${H}`, maxHeight: 180 }}>
        <img
          src={asset(entry.imageUrl)}
          alt={entry.displayName}
          className="absolute inset-0 w-full h-full object-contain pixelated"
          loading="lazy"
        />
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          className="absolute inset-0 w-full h-full pointer-events-none"
        >
          {pathPoints && (
            <polyline
              points={pathPoints}
              fill="none"
              stroke="#22c55e"
              strokeWidth={Math.max(2, Math.min(W, H) / 60)}
              strokeOpacity={0.9}
              strokeLinejoin="round"
            />
          )}
          <circle cx={fromPx.x} cy={fromPx.y} r={Math.max(3, Math.min(W, H) / 80)} fill="#16a34a" stroke="#fff" strokeWidth={1} />
          <circle cx={toPx.x}   cy={toPx.y}   r={Math.max(3, Math.min(W, H) / 80)}
                  fill={segment.isFinal ? '#dc2626' : '#3b82f6'} stroke="#fff" strokeWidth={1} />
        </svg>
      </div>
    </button>
  );
}

/* ─────────────── Info panels ─────────────── */

function FormCard({ title, children, action }) {
  return (
    <section className="rounded-md border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function InfoPanel({ selection, onClose }) {
  return (
    <FormCard
      title="Trainer"
      action={
        <button
          type="button"
          onClick={onClose}
          className="p-0.5 rounded hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-500 dark:text-stone-400"
          title="Close"
        >
          <X size={14} />
        </button>
      }
    >
      <TrainerBody data={selection.data} />
    </FormCard>
  );
}

// Tiny orientation indicator — DSPRE writes "Up"/"Down"/"Left"/"Right".
function OrientationGlyph({ orientation }) {
  const Map = { Up: ArrowUp, Down: ArrowDown, Left: ArrowLeftIcon, Right: ArrowRight };
  const Icon = Map[orientation];
  if (!Icon) return null;
  return <Icon size={11} className="inline-block text-stone-500 dark:text-stone-400" />;
}

function TrainerBody({ data }) {
  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-baseline gap-2">
        <div className="font-semibold text-stone-900 dark:text-stone-100 truncate">
          {data.trainerName || `Trainer #${data.trainerInstanceId}`}
        </div>
        {data.isDoubleBattlePartner && (
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">
            Tag battle
          </span>
        )}
      </div>
      <div className="text-[11px] text-stone-500 dark:text-stone-400 flex items-center gap-2 flex-wrap">
        <span>ID #{data.trainerInstanceId}</span>
        {data.trainerId != null && <span>· ROM #{data.trainerId}</span>}
        {data.orientation && (
          <span className="inline-flex items-center gap-1">
            · facing <OrientationGlyph orientation={data.orientation} />{data.orientation.toLowerCase()}
          </span>
        )}
      </div>

      {/* Team — user fills these in. Empty until then. */}
      {data.team && data.team.length > 0 ? (
        <div>
          <div className="text-[11px] uppercase tracking-wider text-stone-500 dark:text-stone-400 mb-1">Team</div>
          <ul className="space-y-0.5 text-xs text-stone-700 dark:text-stone-300">
            {data.team.map((p, i) => (
              <li key={i}>
                {p.species || '?'} · Lv. {p.level ?? '?'}
                {p.item ? ` · ${p.item}` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="text-[11px] text-stone-500 dark:text-stone-400">
          Team not assigned. Hand-edit
          <code className="mx-1 px-1 py-0.5 rounded bg-stone-200 dark:bg-stone-800 text-[10px]">team</code>
          on this trainer's JSON (per REACT_INTEGRATION.md §4.2 _teamSchema) to fill it in.
        </div>
      )}

      {data.rewardAmount != null && (
        <div className="flex items-center gap-1.5 text-xs text-stone-700 dark:text-stone-300">
          <Coins size={12} className="text-amber-500" /> ¥{data.rewardAmount.toLocaleString()}
        </div>
      )}

      <div className="text-[11px] text-stone-400 dark:text-stone-500 font-mono tabular-nums">
        pixel ({Math.round(data.pixelX)}, {Math.round(data.pixelY)})
      </div>
    </div>
  );
}
