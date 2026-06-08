import { memo } from 'react';
import TypeBadge from './TypeBadge.jsx';
import PokemonSprite from './PokemonSprite.jsx';
import { displayDex, statTotal } from '../lib/format.js';
import { useSpritePreload } from '../hooks/useSpritePreload.js';

function PokemonRow({ pokemon, region, onSelect }) {
  const total = statTotal(pokemon.stats);
  const encounters = pokemon.locations?.length || 0;
  const preload = useSpritePreload(pokemon);
  return (
    <button
      type="button"
      onClick={() => onSelect(pokemon.id)}
      onMouseEnter={preload}
      onFocus={preload}
      className="w-full grid grid-cols-[44px_64px_1fr_auto_auto_auto] items-center gap-3 px-3 py-1.5 text-left
                 border-b border-[#e6dabf] dark:border-stone-800
                 hover:bg-[#ece2c4] dark:hover:bg-stone-800/60
                 focus:outline-none focus:bg-[#ece2c4] dark:focus:bg-stone-800/80 transition-colors"
    >
      <PokemonSprite
        pokemon={pokemon}
        loading="lazy"
        className="w-10 h-10 object-contain"
      />
      <span className="font-mono text-xs text-stone-500 dark:text-stone-500">{displayDex(pokemon, region)}</span>
      <span className="font-semibold text-stone-900 dark:text-stone-100 truncate">{pokemon.name}</span>
      <div className="flex gap-1">
        {[...new Set(pokemon.types)].map((t) => <TypeBadge key={t} type={t} />)}
      </div>
      <span className="font-mono text-sm text-stone-700 dark:text-stone-300 tabular-nums w-12 text-right">
        BST <span className="font-semibold text-stone-900 dark:text-stone-100">{total}</span>
      </span>
      <span className="font-mono text-xs text-stone-500 dark:text-stone-400 tabular-nums w-20 text-right">
        {encounters} {encounters === 1 ? 'enc' : 'encs'}
      </span>
    </button>
  );
}

export default memo(PokemonRow);
