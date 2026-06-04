import { memo, useEffect, useState } from 'react';
import { useSpriteMode } from '../lib/spriteMode.js';

// Renders a Pokémon sprite with a fallback chain across the URL fields
// the build pipeline emits per Pokémon:
//
//   sprite_3d            — Pokémon HOME 3D PNG render (smooth, modern)
//   sprite               — PokeAPI Gen 5 still PNG (classic pixel sprite)
//
// Plus the matching `_shiny` variants. We hot-link to the CDNs (no
// bundling) and rely on the browser's HTTP cache + onError to swap to
// the next URL in the chain when the primary 404s. The image element
// re-mounts on pokemon.id / mode change so the fallback state resets
// cleanly.
//
// MODE — global preference, set by the navbar toggle and persisted in
// localStorage (see src/lib/spriteMode.js):
//   '3d'    — Pokémon HOME 3D PNG renders. Smooth, scales nicely.
//   'still' — PokeAPI Gen 5 still PNG. Pixel art, renders crisp at
//             small sizes with the `.pixelated` filter.
//
// The legacy `variant` prop is now a HINT not a directive. For
// historical 'animated' / '3d' callers we just defer to the mode
// preference. Animated GIFs are dropped entirely.

const CHAIN_3D    = (p, shiny) => [
  shiny ? p.sprite_3d_shiny : p.sprite_3d,
  shiny ? p.sprite_shiny    : p.sprite,
].filter(Boolean);

const CHAIN_STILL = (p, shiny) => [
  shiny ? p.sprite_shiny    : p.sprite,
  shiny ? p.sprite_3d_shiny : p.sprite_3d,
].filter(Boolean);

function PokemonSprite({
  pokemon,
  // `variant` is retained for backwards compatibility but ignored —
  // the active mode comes from the global toggle. (Pages used to pass
  // `variant="animated"` or `variant="3d"`; both now resolve to the
  // user's preference.)
  variant,                  // eslint-disable-line no-unused-vars
  shiny = false,
  alt,
  className = '',
  loading,
  decoding = 'async',
  fetchPriority,
  ...rest
}) {
  const mode = useSpriteMode();
  const chain = mode === 'still' ? CHAIN_STILL(pokemon, shiny) : CHAIN_3D(pokemon, shiny);
  const [idx, setIdx] = useState(0);

  // Reset the chain when species, shiny flag, or mode changes —
  // otherwise a prior fallback state would persist and the new
  // primary URL never gets tried.
  useEffect(() => { setIdx(0); }, [pokemon?.id, shiny, mode]);

  const src = chain[idx] || chain[chain.length - 1] || '';
  const pixelated = mode === 'still';
  const classes = [pixelated ? 'pixelated' : '', className].filter(Boolean).join(' ');

  return (
    <img
      src={src}
      alt={alt ?? pokemon?.name ?? ''}
      loading={loading}
      decoding={decoding}
      fetchpriority={fetchPriority}
      onError={() => {
        // Step through the fallback chain on each failed load. Bail at
        // the end so the broken-image icon doesn't replace itself.
        if (idx < chain.length - 1) setIdx(idx + 1);
      }}
      className={classes}
      {...rest}
    />
  );
}

export default memo(PokemonSprite);
