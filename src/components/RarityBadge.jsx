import { rarityClasses } from '../lib/types.js';

export default function RarityBadge({ rarity }) {
  const { bg, fg } = rarityClasses(rarity);
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${bg} ${fg}`}>
      {rarity}
    </span>
  );
}
