import {
  Sprout, Leaf, Mountain, Home, Waves, Fish, Trees, TreePine,
  Pickaxe, Wind, Ghost, MapPin,
} from 'lucide-react';

// A lucide line-icon per encounter method, replacing the old emoji
// (lib/locations.js used to return 🌿 🪨 🎣 …). Emoji rendered full-colour and
// platform-dependent, which clashed with the app's monochrome lucide icons —
// this keeps the Locations / encounter UI consistent with everything else and
// theme-aware (icons inherit currentColor).
const METHOD_ICON = {
  Grass:        Sprout,
  'Dark Grass': Leaf,
  Cave:         Mountain,
  Inside:       Home,
  Water:        Waves,
  Surf:         Waves,
  'Old Rod':    Fish,
  'Good Rod':   Fish,
  'Super Rod':  Fish,
  Fishing:      Fish,
  Headbutt:     Trees,
  'Honey Tree': TreePine,
  Rocks:        Pickaxe,
  'Dust Cloud': Wind,
  Shadow:       Ghost,
};

export default function MethodIcon({ method, size = 13, className }) {
  const Icon = METHOD_ICON[method] || MapPin;
  return <Icon size={size} className={className} aria-hidden />;
}
