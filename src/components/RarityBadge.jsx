import { rarityClasses } from '../lib/types.js';

// `size`:
//   'default' (encounter strips, modal) — small 10px badge.
//   'chip'    (filter chip in the Locations detail) — matches the height of
//             the surrounding "All / Day / Night / Grass" filter pills, which
//             use text-xs + a 1 px border. We add a transparent border so the
//             box height matches even though the rarity bg covers everything.
export default function RarityBadge({ rarity, size = 'default' }) {
  const { bg, fg } = rarityClasses(rarity);
  const sizing = size === 'chip'
    ? 'px-2 py-0.5 text-xs border border-transparent'
    : 'px-2 py-0.5 text-[10px]';
  return (
    <span className={`inline-block rounded font-semibold uppercase tracking-wide ${sizing} ${bg} ${fg}`}>
      {rarity}
    </span>
  );
}
