// Canonical in-game progression order for locations, per region, so the
// Locations list can be sorted "the way you encounter places while playing"
// instead of alphabetically. PokéMMO uses FireRed (Kanto + Sevii Islands),
// HeartGold/SoulSilver (Johto), Emerald (Hoenn), Platinum (Sinnoh) and
// Black/White (Unova); this follows each game's main-story route order, then
// side/post-game areas. Names are lower-cased and matched against a location's
// (case-folded) display name — anything not listed sorts after, alphabetically.
//
// This is a best-effort curated order: the numbered routes are exact; a few
// towns/dungeons are placed at their approximate story point and can be nudged.

const ORDER = {
  Kanto: [
    'pallet town', 'route 1', 'viridian city', 'route 2', 'viridian forest',
    'pewter city', 'route 3', 'mt. moon', 'route 4', 'cerulean city',
    'route 24', 'route 25', 'route 5', 'route 6', 'vermilion city', 's.s. anne',
    'route 11', "diglett's cave", 'route 9', 'route 10', 'power plant',
    'rock tunnel', 'route 8', 'route 7', 'celadon city', 'route 16', 'route 17',
    'route 18', 'fuchsia city', 'safari zone', 'route 15', 'route 14',
    'route 13', 'route 12', 'pokémon tower', 'route 19', 'route 20',
    'seafoam islands', 'cinnabar island', 'pokémon mansion', 'route 21',
    'route 22', 'route 23', 'victory road', 'cerulean cave',
    // Sevii Islands
    'one island', 'treasure beach', 'kindle road', 'mt. ember', 'cape brink',
    'bond bridge', 'berry forest', 'three isle port', 'four island',
    'icefall cave', 'five island', 'five isle meadow', 'memorial pillar',
    'resort gorgeous', 'water labyrinth', 'water path', 'green path',
    'outcast island', 'lost cave', 'pattern bush', 'ruin valley',
    'altering cave', 'tanoby ruins', 'monean chamber', 'liptoo chamber',
    'weepth chamber', 'dilford chamber', 'scufib chamber', 'rixy chamber',
    'viapois chamber', 'trainer tower', 'sevault canyon', 'canyon entrance',
  ],
  Johto: [
    'new bark town', 'route 29', 'cherrygrove city', 'route 30', 'route 31',
    'violet city', 'sprout tower', 'ruins of alph', 'route 32', 'union cave',
    'route 33', 'azalea town', 'slowpoke well', 'ilex forest', 'route 34',
    'national park', 'route 35', 'route 36', 'route 37', 'ecruteak city',
    'burned tower', 'bell tower', 'route 38', 'route 39', 'olivine city',
    'route 40', 'route 41', 'cianwood city', 'route 47', 'route 48',
    'safari zone gate', 'safari zone', 'cliff cave', 'cliff edge gate',
    'route 42', 'mt. mortar', 'mahogany town', 'route 43', 'lake of rage',
    'team rocket hq', 'route 44', 'ice path', 'blackthorn city', "dragon's den",
    'route 45', 'route 46', 'dark cave', 'route 27', 'tohjo falls', 'route 26',
    'victory road', 'whirl islands', 'pokéathlon dome', 'route 28', 'mt. silver',
    'mt. silver cave',
  ],
  Hoenn: [
    'route 101', 'route 103', 'route 102', 'petalburg city', 'route 104',
    'petalburg woods', 'route 116', 'rusturf tunnel', 'dewford town',
    'granite cave', 'route 106', 'route 107', 'route 108', 'route 109',
    'slateport city', 'route 110', 'route 117', 'route 111', 'route 112',
    'fiery path', 'route 113', 'route 114', 'meteor falls', 'route 115',
    'jagged pass', 'route 118', 'route 119', 'route 120', 'route 121',
    'safari zone', 'lilycove city', 'route 122', 'mt. pyre', 'route 123',
    'aqua hideout', 'magma hideout', 'route 124', 'mossdeep city', 'route 125',
    'shoal cave', 'route 126', 'underwater', 'sootopolis city', 'cave of origin',
    'route 127', 'route 128', 'seafloor cavern', 'route 129', 'route 130',
    'route 131', 'pacifidlog town', 'route 132', 'route 133', 'route 134',
    'sky pillar', 'ever grande city', 'victory road', 'new mauville',
    'abandoned ship', 'sealed chamber', 'scorched slab', 'desert underpass',
    'artisan cave', 'mirage tower', 'battle frontier', 'altering cave',
  ],
  Sinnoh: [
    'twinleaf town', 'route 201', 'lake verity', 'route 202', 'route 203',
    'oreburgh gate', 'oreburgh mine', 'route 207', 'ravaged path', 'route 204',
    'valley windworks', 'route 205', 'eterna forest', 'old chateau',
    'eterna city', 'route 211', 'route 206', 'wayward cave', 'mt. coronet',
    'route 208', 'route 209', 'solaceon ruins', 'route 210', 'route 215',
    'route 214', 'maniac tunnel', 'ruin maniac cave', 'route 212',
    'pastoria city', 'great marsh', 'route 213', 'valor lakefront', 'lake valor',
    'route 216', 'route 217', 'acuity lakefront', 'lake acuity',
    'snowpoint temple', 'celestic town', 'canalave city', 'iron island',
    'fuego ironworks', 'route 218', 'route 219', 'route 220', 'route 221',
    'route 222', 'sunyshore city', 'route 223', 'victory road', 'pokémon league',
    'route 224', 'route 225', 'route 226', 'route 227', 'stark mountain',
    'route 228', 'route 229', 'route 230', 'resort area', 'sendoff spring',
    'turnback cave', 'trophy garden', 'honey tree',
  ],
  Unova: [
    'route 1', 'route 2', 'striaton city', 'dreamyard', 'route 3',
    'wellspring cave', 'pinwheel forest', 'route 4', 'desert resort',
    'relic castle', 'route 5', 'driftveil drawbridge', 'driftveil city',
    'cold storage', 'route 6', 'chargestone cave', 'route 7', 'celestial tower',
    'mistralton cave', 'twist mountain', 'icirrus city', 'dragonspiral tower',
    'route 8', 'moor of icirrus', 'route 9', 'route 10', 'victory road',
    'route 11', 'village bridge', 'route 12', 'route 13', 'undella town',
    'undella bay', 'route 14', 'abundant shrine', 'route 15', 'marvelous bridge',
    'route 16', 'lostlorn forest', 'route 17', 'route 18', 'p2 laboratory',
    "challenger's cave", 'giant chasm', 'guidance chamber', 'trial chamber',
  ],
};

const INDEX = {};
for (const [region, list] of Object.entries(ORDER)) {
  INDEX[region] = new Map(list.map((n, i) => [n, i]));
}

// Progression index for a location within its region (Infinity if unlisted, so
// it sorts to the end). Match is case-insensitive on the display name.
export function locationOrderIndex(region, name) {
  const m = INDEX[region];
  if (!m) return Infinity;
  const i = m.get(String(name).toLowerCase());
  return i == null ? Infinity : i;
}
