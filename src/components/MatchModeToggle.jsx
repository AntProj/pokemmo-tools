import { memo } from 'react';

function MatchModeToggle({ value, onChange }) {
  return (
    <div className="inline-flex rounded-md border border-[#d6c8a3] dark:border-stone-700 overflow-hidden text-xs">
      <button
        type="button"
        onClick={() => onChange('all')}
        aria-pressed={value === 'all'}
        className={`px-3 py-1 font-medium ${value === 'all'
          ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
          : 'bg-[#fdf8e9] dark:bg-stone-900 text-stone-600 dark:text-stone-400 hover:bg-[#ece2c4] dark:hover:bg-stone-800'}`}
      >
        Match ALL
      </button>
      <button
        type="button"
        onClick={() => onChange('any')}
        aria-pressed={value === 'any'}
        className={`px-3 py-1 font-medium ${value === 'any'
          ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
          : 'bg-[#fdf8e9] dark:bg-stone-900 text-stone-600 dark:text-stone-400 hover:bg-[#ece2c4] dark:hover:bg-stone-800'}`}
      >
        Match ANY
      </button>
    </div>
  );
}

export default memo(MatchModeToggle);
