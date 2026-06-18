import { X } from 'lucide-react';
import Modal from './Modal.jsx';
import TypeBadge from './TypeBadge.jsx';
import PokemonSprite from './PokemonSprite.jsx';
import { STAT_ORDER, statLabel, statTotal, dexNum, formatEvYield } from '../lib/format.js';

// Side-by-side comparison of a handful of Pokémon: sprites, types, each base
// stat (best value per row highlighted), BST, EV yield, and abilities. Driven by
// the Pokédex compare tray. `onRemove(id)` drops a column; `onSelect(id)` opens
// that mon's full detail popup.
export default function ComparePanel({ pokemon, onClose, onRemove, onSelect }) {
  if (!pokemon?.length) return null;
  const multi = pokemon.length > 1;
  const best = {};
  for (const k of STAT_ORDER) best[k] = Math.max(...pokemon.map((p) => p.stats?.[k] || 0));
  const bestBst = Math.max(...pokemon.map((p) => statTotal(p.stats)));

  const statCell = (p, k) => {
    const v = p.stats?.[k] || 0;
    const isBest = multi && v === best[k];
    return (
      <td key={p.id} className={`px-3 py-1.5 text-center font-mono tabular-nums ${isBest ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-stone-700 dark:text-stone-300'}`}>
        {v}
      </td>
    );
  };

  return (
    <Modal onClose={onClose} title={`Compare (${pokemon.length})`} maxWidth="max-w-5xl" scroll="page" ariaLabel="Compare Pokémon">
      <div className="p-4 overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              <th className="px-3 py-2" />
              {pokemon.map((p) => (
                <th key={p.id} className="px-3 py-2 align-bottom min-w-[128px]">
                  <div className="flex flex-col items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onRemove(p.id)}
                      className="self-end -mb-1 p-1 rounded text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
                      title="Remove from compare"
                      aria-label="Remove from compare"
                    >
                      <X size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onSelect(p.id)}
                      className="flex flex-col items-center gap-1 group"
                      title="Open detail"
                    >
                      <PokemonSprite pokemon={p} className="w-16 h-16 object-contain group-hover:scale-110 transition-transform" />
                      <span className="font-mono text-[10px] text-stone-500 dark:text-stone-500">{dexNum(p.id)}</span>
                      <span className="font-semibold text-stone-900 dark:text-stone-100 leading-tight text-center">{p.name}</span>
                    </button>
                    <div className="flex flex-wrap gap-1 justify-center">
                      {[...new Set(p.types)].map((t) => <TypeBadge key={t} type={t} />)}
                    </div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {STAT_ORDER.map((k) => (
              <tr key={k} className="border-t border-[#ece2c4] dark:border-stone-800/60">
                <td className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">{statLabel(k)}</td>
                {pokemon.map((p) => statCell(p, k))}
              </tr>
            ))}
            <tr className="border-t-2 border-[#d6c8a3] dark:border-stone-700">
              <td className="px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-stone-600 dark:text-stone-300">Total</td>
              {pokemon.map((p) => {
                const t = statTotal(p.stats);
                return (
                  <td key={p.id} className={`px-3 py-1.5 text-center font-mono tabular-nums font-bold ${multi && t === bestBst ? 'text-emerald-600 dark:text-emerald-400' : 'text-stone-800 dark:text-stone-200'}`}>
                    {t}
                  </td>
                );
              })}
            </tr>
            <tr className="border-t border-[#ece2c4] dark:border-stone-800/60">
              <td className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400 align-top">EV yield</td>
              {pokemon.map((p) => (
                <td key={p.id} className="px-3 py-2 text-center text-xs text-stone-700 dark:text-stone-300">{formatEvYield(p.yields)}</td>
              ))}
            </tr>
            <tr className="border-t border-[#ece2c4] dark:border-stone-800/60">
              <td className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400 align-top">Abilities</td>
              {pokemon.map((p) => (
                <td key={p.id} className="px-3 py-2 text-center text-xs text-stone-700 dark:text-stone-300">
                  {(p.abilities || []).length
                    ? (p.abilities || []).map((a) => `${a.name}${a.hidden ? ' (H)' : ''}`).join(', ')
                    : '—'}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
        {pokemon.length === 1 && (
          <p className="mt-3 text-xs text-stone-500 dark:text-stone-400">Add another Pokémon to the compare tray to see best-stat highlights.</p>
        )}
      </div>
    </Modal>
  );
}
