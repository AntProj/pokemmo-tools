import { Box, Users, Check } from 'lucide-react';

// Quick "act on this mon" controls: add to the active Box, add to the active
// Team, or mark caught in the Tracker. Used both as compact icon buttons on a
// Pokédex card (labeled=false) and as a labeled button row in the detail popup
// (labeled=true). Handlers receive the pokemon id; each is optional.
//
// Clicks preventDefault + stopPropagation so using these on a card never also
// triggers the card's open-detail click.
export default function MonActions({
  monId,
  onAddToBox,
  onAddToTeam,
  onMarkCaught,
  labeled = false,
  className = '',
}) {
  if (!onAddToBox && !onAddToTeam && !onMarkCaught) return null;
  const fire = (fn) => (e) => { e.preventDefault(); e.stopPropagation(); fn(monId); };

  const base = labeled
    ? 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium'
    : 'inline-flex items-center justify-center p-1.5 rounded-md border shadow-sm';
  const skin =
    'bg-[#fdf8e9]/95 dark:bg-stone-800/95 text-stone-700 dark:text-stone-200 ' +
    'border-[#d6c8a3] dark:border-stone-600 hover:bg-[#ece2c4] dark:hover:bg-stone-700';
  const cls = `${base} ${skin}`;
  const sz = labeled ? 14 : 13;

  return (
    <div className={`flex ${labeled ? 'gap-2 flex-wrap' : 'gap-1'} ${className}`}>
      {onAddToBox && (
        <button type="button" title="Add to Box" aria-label="Add to Box" onClick={fire(onAddToBox)} className={cls}>
          <Box size={sz} />{labeled && <span>Add to Box</span>}
        </button>
      )}
      {onAddToTeam && (
        <button type="button" title="Add to active Team" aria-label="Add to active Team" onClick={fire(onAddToTeam)} className={cls}>
          <Users size={sz} />{labeled && <span>Add to Team</span>}
        </button>
      )}
      {onMarkCaught && (
        <button type="button" title="Mark caught (Tracker)" aria-label="Mark caught" onClick={fire(onMarkCaught)} className={cls}>
          <Check size={sz} />{labeled && <span>Mark caught</span>}
        </button>
      )}
    </div>
  );
}
