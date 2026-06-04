import { NavLink } from 'react-router-dom';
import { Box, Image } from 'lucide-react';
import { useSpriteMode, setSpriteMode } from '../lib/spriteMode.js';

const TABS = [
  { to: '/',            label: 'Pokédex'           },
  { to: '/search',      label: 'Search'            },
  { to: '/locations',   label: 'Locations'         },
  { to: '/tracker',     label: 'Tracker'           },
  { to: '/catch',       label: 'Catch Calc'        },
  { to: '/breeding',    label: 'Breeding Planner'  },
  // Region map tabs. NavLink prefix-matches by default (no `end` flag), so
  // navigating to e.g. /map/sinnoh/0285 still highlights the Sinnoh tab.
  { to: '/map/sinnoh',  label: 'Sinnoh Map'        },
  { to: '/map/johto',   label: 'Johto Map'         },
];

export default function NavBar() {
  const mode = useSpriteMode();
  return (
    <nav className="bg-[#fdf8e9] dark:bg-stone-900 border-b border-[#e6dabf] dark:border-stone-800">
      <div className="max-w-7xl mx-auto px-4 flex items-center gap-1">
        <span className="font-bold text-sm tracking-tight text-stone-900 dark:text-stone-100 mr-3 py-2.5">
          PokéMMO Tools
        </span>
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === '/'}
            className={({ isActive }) => `
              px-3 py-2.5 text-sm font-medium border-b-2 transition-colors
              ${isActive
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100'}
            `}
          >
            {tab.label}
          </NavLink>
        ))}

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
