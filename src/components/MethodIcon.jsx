// Short emoji per encounter method (the original look — kept by preference).
// Rendered as an inline glyph so it inherits the surrounding font size; the
// `size` prop is accepted for call-site compatibility but only nudges the glyph.
const METHOD_EMOJI = {
  Grass:        '🌿',
  'Dark Grass': '🌑',
  Cave:         '🪨',
  Inside:       '🏠',
  Water:        '🌊',
  Surf:         '🏄',
  'Old Rod':    '🎣',
  'Good Rod':   '🎣',
  'Super Rod':  '🎣',
  Fishing:      '🎣',
  Headbutt:     '🌳',
  'Honey Tree': '🍯',
  Rocks:        '⛏',
  'Dust Cloud': '💨',
  Shadow:       '👤',
};

export default function MethodIcon({ method, size, className, style }) {
  return (
    <span aria-hidden className={className} style={size ? { fontSize: size, lineHeight: 1, ...style } : style}>
      {METHOD_EMOJI[method] || '·'}
    </span>
  );
}
