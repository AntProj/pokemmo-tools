import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Sun, Moon, ArrowLeft, X, MapPin, User, Package, Users, ExternalLink } from 'lucide-react';
import { MapContainer, ImageOverlay, Marker, CircleMarker, useMap, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Vite serves public assets at BASE_URL ('/pokemmo-tools/' in prod, '/' in dev).
// The generator writes URLs as 'data/maps/...' (root-relative to public/), and
// we prepend BASE_URL at runtime to get a working URL in both environments.
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
const asset = (p) => `${BASE}/${p}`;

const MAPS_INDEX_URL    = asset('data/maps/maps-index.json');
const WORLD_REGIONS_URL = asset('data/maps/world-regions.json');

const MARKER_KINDS = [
  { key: 'warps',    label: 'Warps',    Icon: ExternalLink },
  { key: 'trainers', label: 'Trainers', Icon: Users },
  { key: 'items',    label: 'Items',    Icon: Package },
  { key: 'npcs',     label: 'NPCs',     Icon: User },
];

// Entities with finite pixel coords get rendered as markers; null-coord
// entries (rail warps, off-grid actors) live in the sidebar instead.
const onMap = (e) => Number.isFinite(e.pixelX) && Number.isFinite(e.pixelY);

// Custom Leaflet icons. Built as plain SVG → divIcon so we can color/size
// without shipping extra image files.
function makeDivIcon({ html, size, anchor }) {
  return L.divIcon({
    html,
    className: '',          // Leaflet defaults add a noisy white box; clear it.
    iconSize: size,
    iconAnchor: anchor,
  });
}

const ICONS = {
  warp: makeDivIcon({
    html: `<div style="width:18px;height:18px;border-radius:4px;background:#3b82f6;border:2px solid #1e3a8a;display:flex;align-items:center;justify-content:center;color:white;font-size:11px;font-weight:bold;line-height:1">↗</div>`,
    size: [18, 18], anchor: [9, 9],
  }),
  trainer: makeDivIcon({
    html: `<div style="width:16px;height:16px;border-radius:50%;background:#ef4444;border:2px solid #7f1d1d;box-shadow:0 0 0 1px rgba(255,255,255,.8)"></div>`,
    size: [16, 16], anchor: [8, 8],
  }),
  item: makeDivIcon({
    html: `<div style="width:10px;height:10px;border-radius:50%;background:#eab308;border:2px solid #713f12"></div>`,
    size: [10, 10], anchor: [5, 5],
  }),
  npc: makeDivIcon({
    html: `<div style="width:7px;height:7px;border-radius:50%;background:#9ca3af;border:1px solid #374151"></div>`,
    size: [7, 7], anchor: [3.5, 3.5],
  }),
  region: makeDivIcon({
    html: `<div style="width:14px;height:14px;border-radius:50%;background:#10b981;border:2px solid #064e3b;box-shadow:0 0 0 2px rgba(255,255,255,.7)"></div>`,
    size: [14, 14], anchor: [7, 7],
  }),
};

export default function UnovaMap({ theme, onTheme }) {
  const { mapId: rawMapId } = useParams();
  const mapId = rawMapId || 'world';
  const navigate = useNavigate();

  // Master index + world regions are tiny — fetch once on mount and cache in
  // state. Per-map events files are fetched on demand by mapId.
  const [mapsIndex, setMapsIndex] = useState(null);
  const [worldRegions, setWorldRegions] = useState(null);
  const [indexError, setIndexError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(MAPS_INDEX_URL).then(r => r.json()),
      fetch(WORLD_REGIONS_URL).then(r => r.json()),
    ]).then(([idx, regions]) => {
      if (cancelled) return;
      setMapsIndex(idx);
      setWorldRegions(regions);
    }).catch(e => !cancelled && setIndexError(e.message));
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="max-w-7xl mx-auto px-4 py-4 space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {mapId !== 'world' && (
          <Link
            to="/map"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md
                       border border-[#d6c8a3] dark:border-stone-700
                       bg-[#fdf8e9] dark:bg-stone-900
                       hover:bg-[#ece2c4] dark:hover:bg-stone-800
                       text-sm text-stone-700 dark:text-stone-300"
            title="Back to Unova overview"
          >
            <ArrowLeft size={14} /> Back to Unova
          </Link>
        )}
        <h1 className="text-base font-semibold text-stone-900 dark:text-stone-100">
          {mapsIndex?.[mapId]?.displayName || (mapId === 'world' ? 'Unova Region' : `Map ${mapId}`)}
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
          mapId={mapId}
          mapsIndex={mapsIndex}
          worldRegions={worldRegions?.regions || []}
          onNavigateToMap={(id) => navigate(`/map/${id}`)}
        />
      )}
    </main>
  );
}

/* ─────────────── MapView (Leaflet wrapper) ─────────────── */

function MapView({ mapId, mapsIndex, worldRegions, onNavigateToMap }) {
  const entry = mapsIndex[mapId];
  const [bounds, setBounds] = useState(null);
  const [events, setEvents] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [visible, setVisible] = useState({ warps: true, trainers: true, items: true, npcs: true });

  // Reset side-state when switching maps
  useEffect(() => {
    setBounds(null);
    setEvents(null);
    setSelected(null);
    setLoadError(null);
  }, [mapId]);

  // Load bounds + events for the active map
  useEffect(() => {
    if (!entry) return;
    let cancelled = false;
    const boundsPromise = fetch(asset(entry.boundsUrl)).then(r => r.json());
    const eventsPromise = entry.eventsUrl
      ? fetch(asset(entry.eventsUrl)).then(r => r.json())
      : Promise.resolve(null);
    Promise.all([boundsPromise, eventsPromise])
      .then(([b, e]) => {
        if (cancelled) return;
        setBounds(b);
        setEvents(e);
      })
      .catch(err => !cancelled && setLoadError(err.message));
    return () => { cancelled = true; };
  }, [entry?.boundsUrl, entry?.eventsUrl]);

  if (!entry) {
    return (
      <div className="rounded-md border border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-3 text-sm text-amber-800 dark:text-amber-200">
        Unknown map "{mapId}". <Link to="/map" className="underline">Return to Unova overview</Link>.
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-md border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-700 dark:text-red-300">
        Failed to load map data: {loadError}
      </div>
    );
  }

  if (!bounds) {
    return <div className="text-sm text-stone-500 dark:text-stone-400">Loading map…</div>;
  }

  // Leaflet's L.CRS.Simple uses (lat, lng) = (row, col) for pixel coords.
  // Origin is top-left at (0, 0), so the image occupies lat ∈ [-H, 0] when we
  // place corners at [-H, 0] and [0, W]. That puts the visible map upright.
  const W = bounds.imageWidth;
  const H = bounds.imageHeight;
  const imgBounds = [[-H, 0], [0, W]];
  // Convert a (pixelX, pixelY) marker coord to Leaflet's [lat, lng].
  const toLatLng = (px, py) => [-py, px];

  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-4 items-stretch">
      <div className="relative rounded-md border border-[#e6dabf] dark:border-stone-800 overflow-hidden bg-stone-100 dark:bg-stone-950" style={{ height: 'min(70vh, 720px)' }}>
        <MapContainer
          crs={L.CRS.Simple}
          bounds={imgBounds}
          maxBounds={imgBounds}
          maxBoundsViscosity={0.8}
          minZoom={-3}
          maxZoom={4}
          scrollWheelZoom
          style={{ width: '100%', height: '100%', background: 'transparent' }}
          attributionControl={false}
        >
          <FitBoundsOnLoad bounds={imgBounds} />
          <ImageOverlay url={asset(entry.imageUrl)} bounds={imgBounds} />

          {/* World overview: clickable region markers */}
          {entry.type === 'overview' && worldRegions.map(r => {
            const px = ((r.centerWorldX - bounds.worldBounds.minX) / (bounds.worldBounds.maxX - bounds.worldBounds.minX)) * W;
            const py = H - ((r.centerWorldY - bounds.worldBounds.minY) / (bounds.worldBounds.maxY - bounds.worldBounds.minY)) * H;
            return (
              <Marker
                key={r.mapId}
                position={toLatLng(px, py)}
                icon={ICONS.region}
                eventHandlers={{ click: () => onNavigateToMap(r.mapId) }}
              >
                <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
                  {r.displayName}
                </Tooltip>
              </Marker>
            );
          })}

          {/* Detail view: event markers. Skip any entity flagged offMap —
              rail-system warps and a handful of off-grid actors have null
              world coords in the raw data; they're listed in the sidebar's
              "Off-map links" panel instead of as map markers. */}
          {entry.type === 'detail' && events && (
            <>
              {visible.warps && events.warps.filter(onMap).map(w => (
                <Marker
                  key={w.id}
                  position={toLatLng(w.pixelX, w.pixelY)}
                  icon={ICONS.warp}
                  eventHandlers={{ click: () => setSelected({ kind: 'warp', data: w }) }}
                >
                  <Tooltip direction="top" offset={[0, -10]}>Warp → {w.destinationLabel || w.destinationMapId}</Tooltip>
                </Marker>
              ))}
              {visible.trainers && events.trainers.filter(onMap).map(t => (
                <Marker
                  key={t.id}
                  position={toLatLng(t.pixelX, t.pixelY)}
                  icon={ICONS.trainer}
                  eventHandlers={{ click: () => setSelected({ kind: 'trainer', data: t }) }}
                >
                  <Tooltip direction="top" offset={[0, -8]}>Trainer #{t.spriteId}</Tooltip>
                </Marker>
              ))}
              {visible.items && events.items.filter(onMap).map(i => (
                <Marker
                  key={i.id}
                  position={toLatLng(i.pixelX, i.pixelY)}
                  icon={ICONS.item}
                  eventHandlers={{ click: () => setSelected({ kind: 'item', data: i }) }}
                >
                  <Tooltip direction="top" offset={[0, -6]}>{i.isHidden ? 'Hidden item' : 'Item'}</Tooltip>
                </Marker>
              ))}
              {visible.npcs && events.npcs.filter(onMap).map(n => (
                <Marker
                  key={n.id}
                  position={toLatLng(n.pixelX, n.pixelY)}
                  icon={ICONS.npc}
                  eventHandlers={{ click: () => setSelected({ kind: 'npc', data: n }) }}
                >
                  <Tooltip direction="top" offset={[0, -5]}>NPC #{n.spriteId}</Tooltip>
                </Marker>
              ))}
            </>
          )}
        </MapContainer>
      </div>

      <aside className="space-y-3">
        {entry.type === 'detail' && (
          <FormCard title="Layers">
            <div className="space-y-1.5">
              {MARKER_KINDS.map(({ key, label, Icon }) => {
                const total = events?.[key]?.length ?? 0;
                const mapped = events?.[key]?.filter(onMap).length ?? 0;
                const off = total - mapped;
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
                    <span className="tabular-nums text-xs text-stone-500 dark:text-stone-400" title={off ? `${mapped} on map · ${off} off map` : ''}>
                      {mapped}{off ? ` (+${off} off-map)` : ''}
                    </span>
                  </label>
                );
              })}
            </div>
          </FormCard>
        )}

        {entry.type === 'detail' && events && (() => {
          const offWarps = (events.warps || []).filter(w => !onMap(w));
          if (offWarps.length === 0) return null;
          return (
            <FormCard title="Off-map warps">
              <div className="text-[11px] text-stone-500 dark:text-stone-400 mb-1">
                Rail-system / off-grid links without map positions. Click to navigate.
              </div>
              <ul className="space-y-1 text-sm">
                {offWarps.map(w => {
                  const dest = mapsIndex[w.destinationMapId];
                  return (
                    <li key={w.id}>
                      <button
                        type="button"
                        onClick={() => dest && onNavigateToMap(w.destinationMapId)}
                        disabled={!dest}
                        className={`w-full text-left px-2 py-1 rounded inline-flex items-center gap-1.5 ${
                          dest
                            ? 'hover:bg-[#ece2c4] dark:hover:bg-stone-800 text-stone-700 dark:text-stone-300 cursor-pointer'
                            : 'text-stone-400 dark:text-stone-600 cursor-default'
                        }`}
                      >
                        <ExternalLink size={11} />
                        <span className="flex-1 truncate">{dest?.displayName || `Zone ${w.destinationMapId}`}</span>
                        {w.faceDirection && (
                          <span className="text-[10px] text-stone-500 dark:text-stone-500 uppercase tracking-wider">{w.faceDirection}</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </FormCard>
          );
        })()}

        {entry.type === 'overview' && (
          <FormCard title="Unova">
            <div className="text-sm text-stone-700 dark:text-stone-300">
              Click any green marker to open a detailed map. {worldRegions.length} zones available.
            </div>
          </FormCard>
        )}

        {selected && (
          <InfoPanel
            selection={selected}
            onClose={() => setSelected(null)}
            mapsIndex={mapsIndex}
            onNavigateToMap={onNavigateToMap}
          />
        )}

        {!selected && entry.type === 'detail' && (
          <FormCard title="Selection">
            <div className="text-xs text-stone-500 dark:text-stone-400">Click any marker to see details.</div>
          </FormCard>
        )}
      </aside>
    </div>
  );
}

// Fit Leaflet to the image bounds when the map mounts. Doing this in
// `MapContainer.bounds` works but only on first render; we want it as a one-
// shot effect to handle later remounts triggered by mapId change.
function FitBoundsOnLoad({ bounds }) {
  const map = useMap();
  useEffect(() => { map.fitBounds(bounds); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
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

function InfoPanel({ selection, onClose, mapsIndex, onNavigateToMap }) {
  const { kind, data } = selection;
  const titles = { warp: 'Warp', trainer: 'Trainer', item: 'Item', npc: 'NPC' };
  return (
    <FormCard
      title={titles[kind] || 'Selection'}
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
      {kind === 'warp'    && <WarpBody data={data} mapsIndex={mapsIndex} onNavigateToMap={onNavigateToMap} />}
      {kind === 'trainer' && <TrainerBody data={data} />}
      {kind === 'item'    && <ItemBody    data={data} />}
      {kind === 'npc'     && <NpcBody     data={data} />}
    </FormCard>
  );
}

function PositionLine({ data }) {
  return (
    <div className="text-[11px] text-stone-500 dark:text-stone-400 font-mono tabular-nums">
      world ({Math.round(data.worldX)}, {Math.round(data.worldZ)}) · pixel ({Math.round(data.pixelX)}, {Math.round(data.pixelY)})
    </div>
  );
}

function WarpBody({ data, mapsIndex, onNavigateToMap }) {
  const dest = mapsIndex[data.destinationMapId];
  const destLabel = dest?.displayName || data.destinationLabel || `Zone ${data.destinationMapId}`;
  const canNavigate = !!dest;
  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-2 text-stone-900 dark:text-stone-100">
        <ExternalLink size={14} className="text-blue-500" />
        <span>To <span className="font-semibold">{destLabel}</span></span>
      </div>
      {data.faceDirection && (
        <div className="text-xs text-stone-600 dark:text-stone-400">Facing {data.faceDirection.toLowerCase()}</div>
      )}
      <PositionLine data={data} />
      {canNavigate ? (
        <button
          type="button"
          onClick={() => onNavigateToMap(data.destinationMapId)}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium border
                     bg-[#fdf8e9] dark:bg-stone-800 text-stone-700 dark:text-stone-200
                     border-[#d6c8a3] dark:border-stone-700
                     hover:bg-[#ece2c4] dark:hover:bg-stone-700"
        >
          <ExternalLink size={12} /> Go to {destLabel}
        </button>
      ) : (
        <div className="text-[11px] text-amber-700 dark:text-amber-400">
          Destination map not in dataset (zone {data.destinationMapId}).
        </div>
      )}
    </div>
  );
}

function TrainerBody({ data }) {
  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-3">
        {data.spritePath ? (
          <img
            src={asset(data.spritePath)}
            alt={`Trainer sprite ${data.spriteId}`}
            className="pixelated w-12 h-12 object-contain bg-stone-200 dark:bg-stone-800 rounded"
            onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
          />
        ) : (
          <div className="w-12 h-12 rounded bg-stone-200 dark:bg-stone-800 flex items-center justify-center text-stone-500">?</div>
        )}
        <div>
          <div className="font-semibold text-stone-900 dark:text-stone-100">Trainer sprite #{data.spriteId}</div>
          {data.visionRange != null && (
            <div className="text-xs text-stone-600 dark:text-stone-400">Vision range: {data.visionRange}</div>
          )}
        </div>
      </div>
      <div className="text-[11px] text-amber-700 dark:text-amber-400">
        Trainer team data not available — ROM extraction does not yet expose individual trainer IDs or party lists.
      </div>
      <PositionLine data={data} />
    </div>
  );
}

function ItemBody({ data }) {
  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-2 text-stone-900 dark:text-stone-100">
        <Package size={14} className="text-amber-500" />
        <span className="font-semibold">{data.isHidden ? 'Hidden item' : 'Item placement'}</span>
      </div>
      <div className="text-xs text-stone-600 dark:text-stone-400">Sprite id: {data.spriteId}</div>
      <div className="text-[11px] text-amber-700 dark:text-amber-400">
        Item identity not available — the ROM extraction stores only sprite + position, not the item table mapping.
      </div>
      <PositionLine data={data} />
    </div>
  );
}

function NpcBody({ data }) {
  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-3">
        {data.spritePath ? (
          <img
            src={asset(data.spritePath)}
            alt={`NPC sprite ${data.spriteId}`}
            className="pixelated w-12 h-12 object-contain bg-stone-200 dark:bg-stone-800 rounded"
            onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
          />
        ) : (
          <div className="w-12 h-12 rounded bg-stone-200 dark:bg-stone-800 flex items-center justify-center text-stone-500">?</div>
        )}
        <div>
          <div className="font-semibold text-stone-900 dark:text-stone-100">NPC sprite #{data.spriteId}</div>
          {data.faceDirection && (
            <div className="text-xs text-stone-600 dark:text-stone-400">Facing {data.faceDirection.toLowerCase()}</div>
          )}
        </div>
      </div>
      <div className="text-[11px] text-stone-500 dark:text-stone-400">NPC details TBD — dialog text is not yet extracted.</div>
      <PositionLine data={data} />
    </div>
  );
}
