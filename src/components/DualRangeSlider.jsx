import { memo } from 'react';

// Two overlapping <input type="range"> inputs. Each handle controls one bound,
// clamped so they can't cross. The tracks are pointer-events: none in CSS;
// only the thumbs receive events.
function DualRangeSlider({ min, max, value, onChange, step = 1 }) {
  const [lo, hi] = value;
  const span = max - min;
  const loPct = span > 0 ? ((lo - min) / span) * 100 : 0;
  const hiPct = span > 0 ? ((hi - min) / span) * 100 : 0;

  return (
    <div className="relative h-5 w-full select-none">
      <div className="absolute top-1/2 left-0 right-0 h-1 -translate-y-1/2 rounded-full bg-[#e0d4b5] dark:bg-stone-800" />
      <div
        className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-blue-500"
        style={{ left: `${loPct}%`, width: `${Math.max(0, hiPct - loPct)}%` }}
      />
      <input
        type="range" min={min} max={max} step={step} value={lo}
        onChange={(e) => {
          const v = +e.target.value;
          onChange([Math.min(v, hi), hi]);
        }}
        className="dual-range"
        aria-label="Minimum"
      />
      <input
        type="range" min={min} max={max} step={step} value={hi}
        onChange={(e) => {
          const v = +e.target.value;
          onChange([lo, Math.max(v, lo)]);
        }}
        className="dual-range"
        aria-label="Maximum"
      />
    </div>
  );
}

export default memo(DualRangeSlider);
