import { memo, useEffect } from 'react';
import { X, Star, Check, Slash, Circle, MapPin, Calculator } from 'lucide-react';
import { Link } from 'react-router-dom';
import TypeBadge from './TypeBadge.jsx';
import RarityBadge from './RarityBadge.jsx';
import { typeColor } from '../lib/types.js';
import { dexNum } from '../lib/format.js';
import { methodIcon } from '../lib/locations.js';
import { stateOf, bestCatchEntry, recommendBalls, statusTip } from '../lib/tracker.js';

const STATE_BUTTONS = [
  { key: 'uncaught', label: 'Uncaught', Icon: Circle, classes: 'data-[active=true]:bg-stone-700 data-[active=true]:text-white' },
  { key: 'caught',   label: 'Caught',   Icon: Check,  classes: 'data-[active=true]:bg-emerald-600 data-[active=true]:text-white' },
  { key: 'priority', label: 'Priority', Icon: Star,   classes: 'data-[active=true]:bg-amber-500  data-[active=true]:text-white' },
  { key: 'skipped',  label: 'Skipped',  Icon: Slash,  classes: 'data-[active=true]:bg-stone-500  data-[active=true]:text-white' },
];

function CatchInfoPanel({ pokemon, trackerState, onSetState, onOpenFullEntry, onClose }) {
  // Esc closes. No body scroll-lock — this is a focused popover, not a modal,
  // so the page beneath should still scroll if needed.
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!pokemon) return null;

  const state    = stateOf(trackerState, pokemon.id);
  const best     = bestCatchEntry(pokemon);
  const balls    = recommendBalls(pokemon, best, state);
  const tip      = statusTip(pokemon.catch_rate);
  const primary  = typeColor(pokemon.types[0]).bg;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40" onClick={onClose}>
      <div className="min-h-full flex items-start sm:items-center justify-center p-3 sm:p-6">
        <div
          className="w-full max-w-md bg-[#fdf8e9] dark:bg-stone-900
                     rounded-lg shadow-xl border border-[#e6dabf] dark:border-stone-800"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label={`Catch info for ${pokemon.name}`}
        >
          {/* Header */}
          <div
            className="p-3 rounded-t-lg flex items-center gap-3"
            style={{ background: `linear-gradient(135deg, ${primary}33, ${primary}11)` }}
          >
            <div
              className="relative shrink-0 w-14 h-14 rounded-md overflow-hidden flex items-center justify-center bg-white/40 dark:bg-stone-950/50"
              style={{ background: `radial-gradient(circle at 50% 50%, ${primary}33 0%, ${primary}14 70%, ${primary}0a 100%)` }}
            >
              <img src={pokemon.sprite} alt={pokemon.name} className="pixelated w-12 h-12 object-contain" decoding="async" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="font-mono text-xs text-stone-600 dark:text-stone-400">{dexNum(pokemon.id)}</span>
                <h2 className="text-lg font-bold text-stone-900 dark:text-stone-100 truncate">{pokemon.name}</h2>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {[...new Set(pokemon.types)].map((t) => <TypeBadge key={t} type={t} />)}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md hover:bg-white/40 dark:hover:bg-stone-700/40 text-stone-700 dark:text-stone-200"
              title="Close (Esc)"
            >
              <X size={16} />
            </button>
          </div>

          {/* State buttons */}
          <div className="p-3 border-t border-[#e6dabf] dark:border-stone-800 space-y-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400 mb-1.5">State</div>
              <div className="grid grid-cols-4 gap-1.5">
                {STATE_BUTTONS.map(({ key, label, Icon, classes }) => (
                  <button
                    key={key}
                    type="button"
                    data-active={state === key}
                    onClick={() => onSetState(pokemon.id, key)}
                    className={`px-2 py-1.5 rounded-md border text-xs font-medium inline-flex items-center justify-center gap-1
                                bg-[#fdf8e9] dark:bg-stone-800 text-stone-700 dark:text-stone-300
                                border-[#d6c8a3] dark:border-stone-700
                                hover:bg-[#ece2c4] dark:hover:bg-stone-700
                                ${classes}`}
                  >
                    <Icon size={12} />{label}
                  </button>
                ))}
              </div>
            </div>

            {/* Best location */}
            {best && (
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400 mb-1.5">Best location</div>
                <div className="flex items-start gap-2 text-sm">
                  <MapPin size={14} className="mt-0.5 text-stone-500 dark:text-stone-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-stone-500 dark:text-stone-400">{best.region}</div>
                    <div className="font-semibold text-stone-900 dark:text-stone-100 truncate">{baseLocationName(best.location)}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#f1e9d2] dark:bg-stone-800/40 text-stone-700 dark:text-stone-300">
                        <span aria-hidden>{methodIcon(best.method)}</span>{best.method}
                      </span>
                      <RarityBadge rarity={best.rarity} />
                      <span className="font-mono tabular-nums text-stone-700 dark:text-stone-300">
                        {best.min_level === best.max_level ? `Lv ${best.min_level}` : `Lv ${best.min_level}–${best.max_level}`}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Recommended balls */}
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400 mb-1.5">Recommended balls</div>
              <ul className="space-y-1 text-sm">
                {balls.map((b) => (
                  <li key={b.name} className="flex items-center gap-2">
                    <span className="font-semibold text-stone-900 dark:text-stone-100 w-24 shrink-0">{b.name}</span>
                    <span className="font-mono tabular-nums text-stone-700 dark:text-stone-300 w-12 shrink-0">{b.mult}×</span>
                    <span className="text-xs text-stone-500 dark:text-stone-400 truncate">{b.why}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Status tip */}
            <div className="text-xs italic text-stone-600 dark:text-stone-400 border-t border-[#ece2c4] dark:border-stone-800/60 pt-2">
              {tip} Catch rate <span className="font-mono tabular-nums">{pokemon.catch_rate ?? '—'}/255</span>.
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Link
                to={`/catch?mon=${encodeURIComponent(pokemon.name)}&hp=1&status=asleep`}
                onClick={onClose}
                className="text-center px-3 py-1.5 rounded-md text-xs font-medium border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-800 hover:bg-[#ece2c4] dark:hover:bg-stone-700 text-stone-700 dark:text-stone-200 inline-flex items-center justify-center gap-1.5"
              >
                <Calculator size={12} /> Catch Calc
              </Link>
              <button
                type="button"
                onClick={() => onOpenFullEntry(pokemon.id)}
                className="px-3 py-1.5 rounded-md text-xs font-medium border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-800 hover:bg-[#ece2c4] dark:hover:bg-stone-700 text-stone-700 dark:text-stone-200"
              >
                Full Pokédex entry
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Strip the "(Day/Morning/SEASON1)" suffix used by the dataset so the panel
// shows the readable base name.
function baseLocationName(name) {
  return String(name || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
}

export default memo(CatchInfoPanel);
