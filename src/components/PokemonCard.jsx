import { memo } from 'react';
import TypeBadge from './TypeBadge.jsx';
import PokemonSprite from './PokemonSprite.jsx';
import { displayDex } from '../lib/format.js';
import { typeColor } from '../lib/types.js';

function PokemonCard({ pokemon, region, onSelect, footer }) {
  // Warm the HTTP cache on hover so the modal's 3D render is ready by the
  // time the user clicks. Also warm the animated GIF in case it hasn't loaded
  // yet in the card itself.
  const preload = () => {
    for (const url of [pokemon.sprite_3d, pokemon.sprite_animated, pokemon.sprite]) {
      if (url) { const img = new Image(); img.src = url; }
    }
  };
  // Subtle radial tint matching the primary type. Two opacity levels via
  // overlapping divs (light vs dark) so each theme gets the right strength.
  const primaryColor = typeColor(pokemon.types[0]).bg;
  return (
    <button
      type="button"
      onClick={() => onSelect(pokemon.id)}
      onMouseEnter={preload}
      onFocus={preload}
      className="group flex flex-col items-center text-center p-3 rounded-lg
                 bg-[#fdf8e9] border border-[#e6dabf] hover:border-[#c4b486] hover:shadow-md
                 dark:bg-stone-900 dark:border-stone-800 dark:hover:border-stone-600
                 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      <div
        className="relative w-full aspect-square flex items-center justify-center rounded-lg overflow-hidden"
        style={{
          background: `radial-gradient(circle at 50% 50%, ${primaryColor}26 0%, ${primaryColor}14 70%, ${primaryColor}0a 100%)`,
        }}
      >
        {/* dark-mode boost: extra tint that only shows when html.dark is set */}
        <div
          className="absolute inset-0 hidden dark:block pointer-events-none"
          style={{ background: `radial-gradient(circle at 50% 50%, ${primaryColor}3d 0%, ${primaryColor}1f 70%, ${primaryColor}0f 100%)` }}
        />
        <PokemonSprite
          pokemon={pokemon}
          variant="animated"
          loading="lazy"
          className="w-20 h-20 object-contain group-hover:scale-110 transition-transform relative"
        />
      </div>
      <div className="mt-2 font-mono text-xs text-stone-500 dark:text-stone-500">{displayDex(pokemon, region)}</div>
      <div className="font-semibold text-sm text-stone-900 dark:text-stone-100 truncate w-full">{pokemon.name}</div>
      <div className="mt-1 flex flex-wrap gap-1 justify-center">
        {[...new Set(pokemon.types)].map((t) => <TypeBadge key={t} type={t} />)}
      </div>
      {footer && (
        <div className="mt-1.5 flex flex-wrap gap-1 justify-center w-full">
          {footer}
        </div>
      )}
    </button>
  );
}

export default memo(PokemonCard);
