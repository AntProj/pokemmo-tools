import { memo, useEffect, useState } from 'react';

// Renders a Pokémon sprite with a fallback chain across the three URL fields
// the build pipeline emits per Pokémon:
//
//   sprite_animated      — Gen 5 animated GIF (Pokémon Showdown CDN)
//   sprite_3d            — Pokémon HOME 3D PNG render (PokeAPI sprites repo)
//   sprite               — PokeAPI Gen 5 still PNG — last-resort fallback
//
// Plus the matching `_shiny` variants. We hot-link to the CDNs (no bundling),
// and rely on the browser's HTTP cache + onError to swap to the next URL in
// the chain when the primary 404s. The image element re-mounts on pokemon.id
// change so the fallback state resets cleanly for the new species.
//
// `variant`:
//   'animated' — start with sprite_animated (cards, lists, breeding nodes).
//                Falls back to 3D → still. Renders pixelated so the 2-frame
//                GIF looks crisp at the small render sizes we use.
//   '3d'       — start with sprite_3d (modal hero). Falls back to animated →
//                still. Smooth rendering (no pixelated) since 3D renders are
//                ~512×512 native and scale nicely.

const ANIMATED_CHAIN = (p, shiny) => [
  shiny ? p.sprite_animated_shiny : p.sprite_animated,
  shiny ? p.sprite_3d_shiny       : p.sprite_3d,
  shiny ? p.sprite_shiny          : p.sprite,
].filter(Boolean);

const THREEDEE_CHAIN = (p, shiny) => [
  shiny ? p.sprite_3d_shiny       : p.sprite_3d,
  shiny ? p.sprite_animated_shiny : p.sprite_animated,
  shiny ? p.sprite_shiny          : p.sprite,
].filter(Boolean);

function PokemonSprite({
  pokemon,
  variant = 'animated',
  shiny = false,
  alt,
  className = '',
  loading,
  decoding = 'async',
  fetchPriority,
  ...rest
}) {
  const chain = variant === '3d'
    ? THREEDEE_CHAIN(pokemon, shiny)
    : ANIMATED_CHAIN(pokemon, shiny);
  const [idx, setIdx] = useState(0);

  // Reset the chain when species or shiny flag changes — otherwise a prior
  // fallback state would persist and the new species' primary URL never gets
  // tried.
  useEffect(() => { setIdx(0); }, [pokemon?.id, shiny, variant]);

  const src = chain[idx] || chain[chain.length - 1] || '';
  const pixelated = variant === 'animated';
  const classes = [pixelated ? 'pixelated' : '', className].filter(Boolean).join(' ');

  return (
    <img
      src={src}
      alt={alt ?? pokemon?.name ?? ''}
      loading={loading}
      decoding={decoding}
      fetchpriority={fetchPriority}
      onError={() => {
        // Step through the fallback chain on each failed load. Bail at the end
        // so the broken-image icon doesn't replace itself forever.
        if (idx < chain.length - 1) setIdx(idx + 1);
      }}
      className={classes}
      {...rest}
    />
  );
}

export default memo(PokemonSprite);
