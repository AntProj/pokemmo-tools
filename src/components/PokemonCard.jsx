import { memo } from 'react';
import TypeBadge from './TypeBadge.jsx';
import PokemonSprite from './PokemonSprite.jsx';
import { displayDex } from '../lib/format.js';
import { typeColor } from '../lib/types.js';
import { useSpritePreload } from '../hooks/useSpritePreload.js';

/**
 * The shared visual body of a Pokémon card: type-tinted radial backdrop +
 * sprite + dex number + name + type badges (+ optional footer). Rendered inside
 * whatever interactive wrapper the caller needs — PokemonCard (opens the modal)
 * and the Tracker's TrackerCard (cycles catch state) both wrap this so the
 * gradient/sprite/label block stays in exactly one place.
 *
 * `overlays` is free-form absolutely-positioned content (state/tier badges)
 * placed over the sprite box. `dimmed` greys the sprite + labels for the
 * caught/skipped tracker states.
 */
export function PokemonCardBody({
  pokemon,
  region,
  footer,
  overlays,
  dimmed = false,
  spriteClass = 'w-20 h-20',
}) {
  const primaryColor = typeColor(pokemon.types[0]).bg;
  return (
    <>
      <div
        className="relative w-full aspect-square flex items-center justify-center rounded-lg overflow-hidden"
        style={{ background: `radial-gradient(circle at 50% 50%, ${primaryColor}26 0%, ${primaryColor}14 70%, ${primaryColor}0a 100%)` }}
      >
        {/* dark-mode boost: extra tint that only shows when html.dark is set */}
        <div
          className="absolute inset-0 hidden dark:block pointer-events-none"
          style={{ background: `radial-gradient(circle at 50% 50%, ${primaryColor}3d 0%, ${primaryColor}1f 70%, ${primaryColor}0f 100%)` }}
        />
        <PokemonSprite
          pokemon={pokemon}
          loading="lazy"
          className={`${spriteClass} object-contain relative ${dimmed ? 'grayscale opacity-40' : ''}`}
        />
        {overlays}
      </div>
      <div className={`mt-2 font-mono text-xs text-stone-500 dark:text-stone-500 ${dimmed ? 'opacity-60' : ''}`}>
        {displayDex(pokemon, region)}
      </div>
      <div className={`font-semibold text-sm text-stone-900 dark:text-stone-100 truncate w-full ${dimmed ? 'opacity-60' : ''}`}>
        {pokemon.name}
      </div>
      <div className="mt-1 flex flex-wrap gap-1 justify-center">
        {[...new Set(pokemon.types)].map((t) => <TypeBadge key={t} type={t} />)}
      </div>
      {footer && (
        <div className="mt-1.5 flex flex-wrap gap-1 justify-center w-full">
          {footer}
        </div>
      )}
    </>
  );
}

function PokemonCard({ pokemon, region, onSelect, footer }) {
  // Warm the HTTP cache on hover so the modal's 3D render is ready by the time
  // the user clicks.
  const preload = useSpritePreload(pokemon);
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
      <PokemonCardBody
        pokemon={pokemon}
        region={region}
        footer={footer}
        spriteClass="w-20 h-20 group-hover:scale-110 transition-transform"
      />
    </button>
  );
}

export default memo(PokemonCard);
