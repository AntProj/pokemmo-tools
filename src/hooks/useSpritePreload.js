import { useCallback } from 'react';

/**
 * Returns a stable handler that warms the HTTP cache for a Pokémon's sprites
 * (3D HOME render first, still PNG fallback) so the detail modal / hover state
 * paints instantly. Wire it to onMouseEnter / onFocus.
 *
 * Extracted from the identical preload closures in PokemonCard and PokemonRow.
 */
export function useSpritePreload(pokemon) {
  return useCallback(() => {
    for (const url of [pokemon?.sprite_3d, pokemon?.sprite]) {
      if (url) { const img = new Image(); img.src = url; }
    }
  }, [pokemon?.sprite_3d, pokemon?.sprite]);
}
