import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Box, Image, ChevronDown, SlidersHorizontal, ArrowUp, ArrowDown, Check } from 'lucide-react';
import { useSpriteMode, setSpriteMode } from '../lib/spriteMode.js';
import { NAV_DESTINATIONS, NAV_BY_ID, loadNav, saveNav, resolveNav } from '../lib/navConfig.js';
import Modal from './Modal.jsx';

const tabClass = ({ isActive }) => `
  px-3 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
  ${isActive
    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
    : 'border-transparent text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100'}
`;

// A destination is "active" when the route matches its path (prefix for all but
// the Pokédex, which is an exact match on "/").
function isDestActive(dest, pathname) {
  if (dest.end) return pathname === dest.to;
  return pathname === dest.to || pathname.startsWith(dest.to + '/') || pathname.startsWith(dest.to);
}

export default function NavBar() {
  const mode = useSpriteMode();
  const [nav, setNav] = useState(loadNav);
  const [customizing, setCustomizing] = useState(false);

  const update = (next) => { setNav(next); saveNav(next); };
  const { pinned, more } = useMemo(() => resolveNav(nav), [nav]);

  return (
    <nav className="bg-[#fdf8e9] dark:bg-stone-900 border-b border-[#e6dabf] dark:border-stone-800">
      <div className="max-w-7xl mx-auto px-4 flex items-center gap-1">
        <span className="font-bold text-sm tracking-tight text-stone-900 dark:text-stone-100 mr-3 py-2.5">
          PokéMMO Tools
        </span>

        {pinned.map((dest) => (
          <NavLink key={dest.id} to={dest.to} end={dest.end} className={tabClass}>
            {dest.label}
          </NavLink>
        ))}

        <MoreMenu more={more} onCustomize={() => setCustomizing(true)} />

        <button
          type="button"
          onClick={() => setSpriteMode(mode === '3d' ? 'still' : '3d')}
          className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md
                     border border-[#d6c8a3] dark:border-stone-700
                     bg-[#fdf8e9] dark:bg-stone-900
                     hover:bg-[#ece2c4] dark:hover:bg-stone-800
                     text-xs font-medium text-stone-700 dark:text-stone-200"
          title={mode === '3d'
            ? 'Showing 3D renders — click to switch to classic still sprites'
            : 'Showing still sprites — click to switch to 3D renders'}
        >
          {mode === '3d' ? <Box size={14} /> : <Image size={14} />}
          <span className="hidden sm:inline">{mode === '3d' ? '3D' : 'Still'}</span>
        </button>
      </div>

      {customizing && (
        <CustomizeNavModal nav={nav} onChange={update} onClose={() => setCustomizing(false)} />
      )}
    </nav>
  );
}

function MoreMenu({ more, onCustomize }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const location = useLocation();
  const anyActive = more.some((d) => isDestActive(d, location.pathname));

  useEffect(() => {
    if (!open) return;
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  useEffect(() => { setOpen(false); }, [location.pathname]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`inline-flex items-center gap-1 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
          ${anyActive
            ? 'border-blue-500 text-blue-600 dark:text-blue-400'
            : 'border-transparent text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100'}`}
      >
        More
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-0.5 min-w-[200px] py-1 rounded-md
                     border border-[#d6c8a3] dark:border-stone-700
                     bg-[#fdf8e9] dark:bg-stone-900 shadow-xl"
        >
          {more.length === 0 && (
            <div className="px-3 py-2 text-xs text-stone-400 dark:text-stone-500">Everything's pinned to the bar.</div>
          )}
          {more.map((dest) => (
            <NavLink
              key={dest.id}
              to={dest.to}
              end={dest.end}
              role="menuitem"
              className={({ isActive }) => `block px-3 py-2 text-sm
                ${isActive
                  ? 'bg-[#ece2c4] dark:bg-stone-800 text-blue-600 dark:text-blue-400 font-medium'
                  : 'text-stone-700 dark:text-stone-300 hover:bg-[#ece2c4] dark:hover:bg-stone-800'}`}
            >
              {dest.label}
            </NavLink>
          ))}
          <div className="my-1 border-t border-[#ece2c4] dark:border-stone-800" />
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onCustomize(); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-stone-600 dark:text-stone-300 hover:bg-[#ece2c4] dark:hover:bg-stone-800"
          >
            <SlidersHorizontal size={14} /> Customize navigation…
          </button>
        </div>
      )}
    </div>
  );
}

// Reorder destinations and choose, per item, whether it sits on the navbar or in
// the More dropdown. Live-updates the nav as you go.
function CustomizeNavModal({ nav, onChange, onClose }) {
  const barSet = new Set(nav.bar);

  const toggleBar = (id) => {
    const bar = barSet.has(id) ? nav.bar.filter((x) => x !== id) : [...nav.bar, id];
    onChange({ ...nav, bar });
  };
  const move = (id, dir) => {
    const order = [...nav.order];
    const i = order.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    onChange({ ...nav, order });
  };
  const reset = () => onChange({
    order: NAV_DESTINATIONS.map((d) => d.id),
    bar: NAV_DESTINATIONS.filter((d) => d.defaultBar).map((d) => d.id),
  });

  return (
    <Modal title="Customize navigation" onClose={onClose}>
      <div className="p-3 space-y-2">
        <p className="text-xs text-stone-500 dark:text-stone-400">
          Pin the tabs you use most to the bar; the rest live under <strong>More</strong>. Drag order with the arrows.
        </p>
        <ul className="divide-y divide-[#ece2c4] dark:divide-stone-800/60">
          {nav.order.map((id, i) => {
            const dest = NAV_BY_ID[id];
            if (!dest) return null;
            const onBar = barSet.has(id);
            return (
              <li key={id} className="flex items-center gap-2 py-2">
                <div className="flex flex-col">
                  <button type="button" onClick={() => move(id, -1)} disabled={i === 0}
                    className="p-0.5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 disabled:opacity-30" title="Move up">
                    <ArrowUp size={13} />
                  </button>
                  <button type="button" onClick={() => move(id, 1)} disabled={i === nav.order.length - 1}
                    className="p-0.5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 disabled:opacity-30" title="Move down">
                    <ArrowDown size={13} />
                  </button>
                </div>
                <span className="flex-1 text-sm text-stone-800 dark:text-stone-200">{dest.label}</span>
                <button
                  type="button"
                  onClick={() => toggleBar(id)}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors ${
                    onBar
                      ? 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-900'
                      : 'bg-[#fdf8e9] dark:bg-stone-900 text-stone-500 dark:text-stone-400 border-[#d6c8a3] dark:border-stone-700'
                  }`}
                >
                  {onBar ? <><Check size={12} /> On navbar</> : 'In More'}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center justify-between pt-1">
          <button type="button" onClick={reset}
            className="text-xs text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200">
            Reset to defaults
          </button>
          <button type="button" onClick={onClose}
            className="px-3 py-1.5 rounded-md bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900 text-sm">
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}
