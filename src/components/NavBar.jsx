import { NavLink } from 'react-router-dom';

const TABS = [
  { to: '/',          label: 'Pokédex'   },
  { to: '/search',    label: 'Search'    },
  { to: '/locations', label: 'Locations' },
  { to: '/tracker',   label: 'Tracker'   },
];

export default function NavBar() {
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
      </div>
    </nav>
  );
}
