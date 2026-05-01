import { typeColor, normalizeType } from '../lib/types.js';

export default function TypeBadge({ type, size = 'sm' }) {
  if (!type) return null;
  const { bg, fg } = typeColor(type);
  const label = normalizeType(type);
  const padding = size === 'lg' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs';
  return (
    <span
      className={`inline-block ${padding} rounded font-semibold uppercase tracking-wide`}
      style={{ backgroundColor: bg, color: fg }}
    >
      {label}
    </span>
  );
}
