import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Box, Image, ChevronDown } from 'lucide-react';
import { useSpriteMode, setSpriteMode } from '../lib/spriteMode.js';

// Top-level tabs. Trimmed from 8 → 4 flat tabs + a Tools menu:
//   - Search merged into Pokédex (advanced-filters disclosure on that page).
//   - Sinnoh Map + Johto Map merged into one "Maps" tab; the region switcher
//     lives inside the map page. NavLink to "/map" prefix-matches /map/* so the
//     tab stays highlighted on /map/sinnoh, /map/johto/0285, etc.
const TABS = [
  { to: '/',          label: 'Pokédex', end: true },
  { to: '/locations', label: 'Locations' },
  { to: '/tracker',   label: 'Tracker' },
  { to: '/map',       label: 'Maps' },
];

// Calculators live under a Tools dropdown so the top bar isn't crowded and
// future tools (EV, damage, …) drop in without eating a nav slot.
const TOOLS = [
  { to: '/catch',    label: 'Catch Calc' },
  { to: '/breeding', label: 'Breeding Planner' },
];

const tabClass = ({ isActive }) => `
  px-3 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
  ${isActive
    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
    : 'border-transparent text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100'}
`;

export default function NavBar() {
  const mode = useSpriteMode();
  return (
    <nav className="bg-[#fdf8e9] dark:bg-stone-900 border-b border-[#e6dabf] dark:border-stone-800">
      <div className="max-w-7xl mx-auto px-4 flex items-center gap-1">
        <span className="font-bold text-sm tracking-tight text-stone-900 dark:text-stone-100 mr-3 py-2.5">
          PokéMMO Tools
        </span>
        {TABS.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.end} className={tabClass}>
            {tab.label}
          </NavLink>
        ))}

        <ToolsMenu />

        {/* Sprite mode toggle — flips every <PokemonSprite> between
            Pokémon HOME 3D renders and classic Gen 5 still PNGs.
            Persisted via localStorage. */}
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
    </nav>
  );
}

function ToolsMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const location = useLocation();
  const isActive = TOOLS.some((t) => location.pathname.startsWith(t.to));

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  // Close when the route changes (a menu item was picked).
  useEffect(() => { setOpen(false); }, [location.pathname]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`inline-flex items-center gap-1 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
          ${isActive
            ? 'border-blue-500 text-blue-600 dark:text-blue-400'
            : 'border-transparent text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100'}`}
      >
        Tools
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-0.5 min-w-[180px] py-1 rounded-md
                     border border-[#d6c8a3] dark:border-stone-700
                     bg-[#fdf8e9] dark:bg-stone-900 shadow-xl"
        >
          {TOOLS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              role="menuitem"
              className={({ isActive: itemActive }) => `block px-3 py-2 text-sm
                ${itemActive
                  ? 'bg-[#ece2c4] dark:bg-stone-800 text-blue-600 dark:text-blue-400 font-medium'
                  : 'text-stone-700 dark:text-stone-300 hover:bg-[#ece2c4] dark:hover:bg-stone-800'}`}
            >
              {t.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}
