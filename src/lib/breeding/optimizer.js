// Breeding tree optimizer (v3).
//
// Architecture:
//   - 1×31 carriers are the only leaf-buy nodes. Priced from the per-stat
//     × per-role table.
//   - 2×31+ carriers are always bred. The exception is Ditto, which can't be
//     bred in PokeMMO; multi-IV Ditto cost = sum of per-stat 1×31 Ditto prices.
//   - At INTERMEDIATE breed steps, any egg-group-compatible pair is allowed.
//     The offspring's species is determined by the mother (or non-Ditto parent
//     if Ditto is involved). Intermediate offspring of any species can fill
//     the carrier slot in a downstream step — same egg-group filler is
//     interchangeable.
//   - At the FINAL (root) breed step, the offspring must be the target
//     species. So either mother is targetF (or genderless line member) or the
//     pair is Ditto + targetM.
//   - Egg fee for an intermediate breed depends on the offspring's species.
//     Target offspring uses the target's gender_ratio + childGender table.
//     Group offspring (any other egg-group species) uses a flat 1F:1M $5k
//     since the species isn't pinned.
//   - User overrides force a node into a fixed-cost leaf and abandon its
//     subtree. Two structurally identical subtrees share an id (same species,
//     same gender, same IV set, same naturePassing flag) — an override on one
//     applies to both.
//   - Memoization keys on (speciesConstraint, gender, ivs).

import {
  DEFAULT_PER_STAT_PRICES, DEFAULT_CONSUMABLE_PRICES, DEFAULT_BASE_PRICES,
  IV_KEYS, POWER_ITEM_FOR, eggFee,
  isGenderless, genderlessLineOf, genderRatioCategory,
} from './data.js';

/* ─────────────── Public API ─────────────── */

export function planBreeding(args) {
  const target = args.target;
  if (!target) return null;
  const ivList = (args.ivs || []).filter((iv) => IV_KEYS.includes(iv));
  if (ivList.length === 0) return null;

  const sortedIVs = sortIVs(ivList);
  const speciesCat = genderRatioCategory(target);
  const targetGender = speciesCat === 'genderless'
    ? 'N'
    : (args.targetGender || (speciesCat === 'male-only' ? 'M' : 'F'));
  const nature = args.nature || null;

  // PokeMMO breeding consumes both parents per breed event. The solver runs
  // in two phases: Phase 1 builds a memoized RECIPE tree (shared subtrees ok
  // because cost is identical), Phase 2 instantiates fresh node objects with
  // unique instanceIds so every occurrence in the rendered plan is its own
  // distinct breed event. byRecipe overrides flow into Phase 1 (treated as
  // fixed-cost leaves at the recipe level). byInstance overrides are applied
  // post-instantiation by replacing matching nodes with fixed-cost leaves and
  // re-folding parent costs upward.
  const overridesArg = args.overrides || {};
  const byRecipe   = overridesArg.byRecipe   || {};
  const byInstance = overridesArg.byInstance || {};

  const ctx = {
    target,
    nature,
    guaranteeGender: args.guaranteeGender !== false,
    prices: args.prices || DEFAULT_PER_STAT_PRICES,
    basePrices: args.basePrices || DEFAULT_BASE_PRICES,
    consumables: args.consumables || DEFAULT_CONSUMABLE_PRICES,
    overrides: byRecipe,
    memo: new Map(),
    speciesCat,
  };

  // nature is treated as an extra "category" alongside IVs, but unlike IVs
  // matching nature on both parents does NOT auto-pass — only an Everstone
  // held by one parent passes nature. The ES parent therefore has to BE
  // nature-bearing, which (without a multi-IV catch shortcut) propagates
  // through its lineage — every step in the ES chain uses Everstone.
  const recipe = solveCarrier(ctx, sortedIVs, targetGender, 'target', /*isFinal=*/true, /*nat=*/!!nature);

  if (!recipe || !Number.isFinite(recipe.cost)) return null;

  // Phase 2 — clone the recipe into a per-instance tree.
  const recipeUsage = new Map();
  const counters = new Map();
  let root = instantiate(recipe, counters, recipeUsage);

  // Apply byInstance overrides post-instantiation.
  if (Object.keys(byInstance).length > 0) {
    root = applyInstanceOverrides(root, byInstance, ctx);
  }

  return {
    node: root,
    totalCost: root.cost,
    counts: collectCounts(root),
    recipeUsage,
  };
}

// Walk the memoized recipe tree top-down and clone every node so each
// occurrence has a unique instanceId. Shared sub-recipes get fresh clones at
// every visit — they represent separate breed events.
function instantiate(recipe, counters, recipeUsage) {
  if (!recipe) return null;
  const recipeId = recipe.id;
  recipeUsage.set(recipeId, (recipeUsage.get(recipeId) || 0) + 1);
  const n = counters.get(recipeId) || 0;
  counters.set(recipeId, n + 1);
  const instanceId = `${recipeId}#${n}`;
  const node = { ...recipe, recipeId, instanceId, id: instanceId };
  if (recipe.kind === 'breed') {
    node.left  = instantiate(recipe.left,  counters, recipeUsage);
    node.right = instantiate(recipe.right, counters, recipeUsage);
  }
  return node;
}

// Replace any node whose instanceId matches a byInstance key with a fixed-
// cost leaf at the override price, then re-fold parent costs upward.
function applyInstanceOverrides(root, byInstance, ctx) {
  function walk(node) {
    if (!node) return null;
    const ov = byInstance[node.instanceId];
    if (Number.isFinite(ov) && ov >= 0) {
      // Replace with leaf — abandon subtree.
      return {
        ...node, kind: 'leaf', cost: ov, overridden: true,
        left: undefined, right: undefined,
        powerItems: 0, everstones: 0, eggFee: 0,
        breedUp: false,
      };
    }
    if (node.kind !== 'breed') return node;
    const left  = walk(node.left);
    const right = walk(node.right);
    const piCost = (node.powerItems || 0) * (ctx.consumables?.powerItem || 0);
    const esCost = (node.everstones || 0) * (ctx.consumables?.everstone || 0);
    const cost = (left?.cost || 0) + (right?.cost || 0) + piCost + esCost + (node.eggFee || 0);
    return { ...node, left, right, cost };
  }
  return walk(root);
}

/* ─────────────── Recursive solver ─────────────── */

// Node id encodes (speciesConstraint, gender, ivs, naturePassing).
// Two structurally identical subtrees share an id, which means user overrides
// on the same node identity apply to both.
export function nodeId(species, gender, ivs, naturePassing) {
  const sorted = sortIVs(ivs);
  return `${species}|${gender}|${sorted.join(',')}${naturePassing ? '|nat' : ''}`;
}

function solveCarrier(ctx, ivs, gender, speciesConstraint, isFinal = false, nat = false) {
  const sortedIVs = sortIVs(ivs);

  // 'any' fan-out: pick cheapest among the species classes valid for this
  // gender slot. Don't include 'ditto' here — Ditto has its own gender 'D'
  // and a 'D' parent slot is enumerated separately by the breed combo logic.
  if (speciesConstraint === 'any') {
    const candidates = [];
    if (gender === 'M' || gender === 'F') {
      const t = solveCarrier(ctx, sortedIVs, gender, 'target', isFinal, nat);
      const g = solveCarrier(ctx, sortedIVs, gender, 'group', isFinal, nat);
      if (t) candidates.push(t);
      if (g) candidates.push(g);
    } else if (gender === 'N') {
      const t = solveCarrier(ctx, sortedIVs, 'N', 'target', isFinal, nat);
      if (t) candidates.push(t);
    }
    if (candidates.length === 0) return null;
    return candidates.reduce((a, b) => (a.cost <= b.cost ? a : b));
  }

  const id = nodeId(speciesConstraint, gender, sortedIVs, nat);

  // User override → fixed-cost leaf.
  const ov = ctx.overrides[id];
  if (Number.isFinite(ov) && ov >= 0) {
    return { ...makeLeaf(id, speciesConstraint, sortedIVs, gender, ov, true), naturePassing: nat || undefined };
  }

  // Memoize only intermediate results — the root call (isFinal=true) uses a
  // different egg-fee schedule, so caching it would poison sub-calls.
  if (!isFinal && ctx.memo.has(id)) return ctx.memo.get(id);

  let result = null;
  const N = sortedIVs.length;

  if (speciesConstraint === 'ditto') {
    // Ditto can't breed and isn't priced above 1×31. Multi-IV Ditto requires
    // the user to manually override the node's cost. nat=true Ditto is the
    // same price (Synchronizer: catch a Ditto with the requested nature).
    if (N === 0) {
      result = makeLeaf(id, 'ditto', [], 'D', 0, false);
    } else if (N === 1) {
      const stat = sortedIVs[0];
      const p = ctx.prices?.[stat]?.ditto;
      if (Number.isFinite(p) && p >= 0) {
        result = makeLeaf(id, 'ditto', sortedIVs, 'D', p, false);
        if (nat) result.naturePassing = true;
      }
    }
  } else if (N === 0) {
    result = makeLeaf(id, speciesConstraint, [], gender, 0, false);
    if (nat) result.naturePassing = true;
  } else if (N === 1) {
    // 1×31 — try BUY vs BREED-UP. nat=true 1×31 leaf is bought at the same
    // price as nat=false (Synchronizer makes any specific nature available
    // for a few extra catch attempts). Breed-up with nat=true holds Everstone
    // on the 0×31 mother in addition to the Power Item on the 1×31 father.
    const stat = sortedIVs[0];
    const tier = roleForSpeciesGender(speciesConstraint, gender);
    const buyPrice = ctx.prices?.[stat]?.[tier];

    let best = null;
    if (Number.isFinite(buyPrice) && buyPrice >= 0) {
      best = makeLeaf(id, speciesConstraint, sortedIVs, gender, buyPrice, false);
      if (nat) best.naturePassing = true;
    }
    const bred = solveBreedUp(ctx, stat, gender, speciesConstraint, isFinal, nat);
    if (bred && (!best || bred.cost < best.cost)) best = bred;
    result = best;
  } else {
    // 2×31+ bred. nat=true uses asymmetric Everstone structure (1 PI + 1 ES,
    // PI parent at N×31 nat=false, ES parent at (N-1)×31 nat=true). nat=false
    // uses standard symmetric (2 PI, both parents at (N-1)×31 sharing N-2).
    result = nat
      ? solveBreedNat(ctx, sortedIVs, gender, speciesConstraint, isFinal)
      : solveBreed(ctx, sortedIVs, gender, speciesConstraint, isFinal);
  }

  if (!isFinal) ctx.memo.set(id, result);
  return result;
}

// Try breeding a 1×31 carrier from a 0×31 mother + 1×31 father (buy-only) +
// Power Item. Returns the cheapest valid breed-up, or null if none priced.
// The recursion bottoms out here — the inner 1×31 dad is bought (not bred-up
// recursively).
function solveBreedUp(ctx, stat, childGender, childSpec, isFinal, nat = false) {
  let best = null;
  for (const combo of validCombosFor(ctx, childSpec)) {
    // Mother: 0×31 of combo.motherSpec/Gender — priced from base table.
    // For nat=true, the mother is nat-bearing (Synchronizer-caught — same price)
    // and holds the Everstone that passes nature to the child.
    const mother = buy0x31Leaf(ctx, combo.motherSpec, combo.motherGender);
    if (!mother) continue;
    // Father: 1×31 of combo.fatherSpec/Gender for the desired stat — buy-only
    // to avoid infinite recursion.
    const father = buy1x31LeafOnly(ctx, stat, combo.fatherGender, combo.fatherSpec);
    if (!father) continue;

    const fee = ctx.guaranteeGender ? eggFeeForChild(ctx, childSpec, childGender, isFinal) : 0;
    if (!Number.isFinite(fee)) continue;

    const items = ctx.consumables.powerItem + (nat ? ctx.consumables.everstone : 0);
    const cost = mother.cost + father.cost + items + fee;
    if (!best || cost < best.cost) {
      const id = nodeId(childSpec, childGender, [stat], nat);
      const motherWithNat = nat ? { ...mother, naturePassing: true } : mother;
      best = {
        id, kind: 'breed', species: childSpec,
        role: roleForSpeciesGender(childSpec, childGender),
        ivs: [stat], gender: childGender,
        left: motherWithNat, right: father,
        leftRole: motherWithNat.role, rightRole: father.role,
        leftItem: nat ? 'everstone' : null,
        rightItem: 'powerItem',
        leftPowerItem: null, rightPowerItem: stat,
        sharedIVs: [], powerItems: 1, everstones: nat ? 1 : 0, eggFee: fee,
        cost,
        breedUp: true,
        naturePassing: nat || undefined,
      };
    }
  }
  return best;
}

// Buy-only 1×31 leaf — used as the inner father in a breed-up so we don't
// recurse infinitely back into solveCarrier. Honours user overrides on the
// shared (species, gender, stat) node id.
function buy1x31LeafOnly(ctx, stat, gender, species) {
  if (species === 'ditto') {
    // Ditto buy-only — share with the regular Ditto leaf logic.
    const id = nodeId('ditto', 'D', [stat], false);
    const ov = ctx.overrides[id];
    if (Number.isFinite(ov) && ov >= 0) return makeLeaf(id, 'ditto', [stat], 'D', ov, true);
    const p = ctx.prices?.[stat]?.ditto;
    if (!Number.isFinite(p) || p < 0) return null;
    return makeLeaf(id, 'ditto', [stat], 'D', p, false);
  }
  const id = nodeId(species, gender, [stat], false);
  const ov = ctx.overrides[id];
  if (Number.isFinite(ov) && ov >= 0) return makeLeaf(id, species, [stat], gender, ov, true);
  const tier = roleForSpeciesGender(species, gender);
  const p = ctx.prices?.[stat]?.[tier];
  if (!Number.isFinite(p) || p < 0) return null;
  return makeLeaf(id, species, [stat], gender, p, false);
}

// 0×31 leaf — species placeholder used as the mother in a breed-up. Priced
// from the per-role base table.
function buy0x31Leaf(ctx, species, gender) {
  const id = nodeId(species, gender, [], false);
  const ov = ctx.overrides[id];
  if (Number.isFinite(ov) && ov >= 0) return makeLeaf(id, species, [], gender, ov, true);
  const tier = roleForSpeciesGender(species, gender);
  const p = ctx.basePrices?.[tier];
  if (!Number.isFinite(p) || p < 0) return null;
  return makeLeaf(id, species, [], gender, p, false);
}

function solveBreed(ctx, ivs, gender, childSpec, isFinal) {
  let best = null;
  for (let i = 0; i < ivs.length; i++) {
    for (let j = 0; j < ivs.length; j++) {
      if (i === j) continue;
      const leftStat = ivs[i];
      const rightStat = ivs[j];
      const shared = ivs.filter((s) => s !== leftStat && s !== rightStat);
      const motherIVs = sortIVs([...shared, leftStat]);
      const fatherIVs = sortIVs([...shared, rightStat]);

      for (const combo of validCombosFor(ctx, childSpec)) {
        const mother = solveCarrier(ctx, motherIVs, combo.motherGender, combo.motherSpec);
        if (!mother) continue;
        const father = solveCarrier(ctx, fatherIVs, combo.fatherGender, combo.fatherSpec);
        if (!father) continue;
        const fee = ctx.guaranteeGender ? eggFeeForChild(ctx, childSpec, gender, isFinal) : 0;
        if (!Number.isFinite(fee)) continue;
        const cost = mother.cost + father.cost + 2 * ctx.consumables.powerItem + fee;
        if (!best || cost < best.cost) {
          best = {
            id: nodeId(childSpec, gender, ivs, false),
            kind: 'breed',
            species: childSpec,
            role: roleForSpeciesGender(childSpec, gender),
            ivs: sortIVs(ivs), gender,
            left: mother, right: father,
            leftRole:  mother.role,  rightRole:  father.role,
            leftItem: 'powerItem', rightItem: 'powerItem',
            leftPowerItem: leftStat, rightPowerItem: rightStat,
            sharedIVs: shared,
            powerItems: 2, everstones: 0, eggFee: fee,
            cost,
          };
        }
      }
    }
  }
  return best;
}

// Asymmetric "with nature" breed: PI parent at N IVs (nat=false, locks 1 IV);
// ES parent at (N-1) IVs (nat=true) holding Everstone, passes nature.
// Used at every step in the nat chain — the ES parent's lineage all uses
// Everstone, since nature only passes via Everstone (matching nature on both
// parents does not auto-pass).
function solveBreedNat(ctx, ivs, gender, childSpec, isFinal) {
  const sortedIVs = sortIVs(ivs);
  let best = null;
  for (const lockIV of sortedIVs) {
    const piIVs = sortedIVs;
    const esIVs = sortedIVs.filter((s) => s !== lockIV);

    for (const esSide of ['mother', 'father']) {
      const motherIsES = esSide === 'mother';
      const motherIVs = motherIsES ? esIVs : piIVs;
      const fatherIVs = motherIsES ? piIVs : esIVs;

      for (const combo of validCombosFor(ctx, childSpec)) {
        const mother = motherIVs.length === 0
          ? { ...makeLeaf('empty|m', combo.motherSpec, [], combo.motherGender, 0, false), naturePassing: motherIsES || undefined }
          : solveCarrier(ctx, motherIVs, combo.motherGender, combo.motherSpec, false, /*nat=*/motherIsES);
        if (!mother) continue;
        const father = fatherIVs.length === 0
          ? { ...makeLeaf('empty|f', combo.fatherSpec, [], combo.fatherGender, 0, false), naturePassing: !motherIsES || undefined }
          : solveCarrier(ctx, fatherIVs, combo.fatherGender, combo.fatherSpec, false, /*nat=*/!motherIsES);
        if (!father) continue;
        const fee = ctx.guaranteeGender ? eggFeeForChild(ctx, childSpec, gender, isFinal) : 0;
        if (!Number.isFinite(fee)) continue;
        const cost = mother.cost + father.cost
                   + ctx.consumables.powerItem
                   + ctx.consumables.everstone
                   + fee;
        if (!best || cost < best.cost) {
          best = {
            id: nodeId(childSpec, gender, sortedIVs, /*nat=*/true),
            kind: 'breed', species: childSpec,
            role: roleForSpeciesGender(childSpec, gender),
            ivs: sortedIVs, gender,
            left: mother, right: father,
            leftRole: mother.role, rightRole: father.role,
            leftItem:  motherIsES ? 'everstone' : 'powerItem',
            rightItem: motherIsES ? 'powerItem' : 'everstone',
            leftPowerItem:  motherIsES ? null   : lockIV,
            rightPowerItem: motherIsES ? lockIV : null,
            sharedIVs: esIVs,
            powerItems: 1, everstones: 1, eggFee: fee,
            cost,
            naturePassing: true,
          };
        }
      }
    }
  }
  return best;
}

function makeLeaf(id, species, ivs, gender, cost, overridden) {
  return {
    id, kind: 'leaf', species,
    role: roleForSpeciesGender(species, gender),
    ivs: sortIVs(ivs), gender, cost, overridden: !!overridden,
  };
}

function roleForSpeciesGender(species, gender) {
  if (species === 'ditto') return 'ditto';
  if (species === 'target') {
    if (gender === 'M') return 'targetM';
    if (gender === 'F') return 'targetF';
    return 'target';
  }
  if (species === 'group') {
    if (gender === 'M') return 'groupM';
    if (gender === 'F') return 'groupF';
  }
  return 'unknown';
}

function eggFeeForChild(ctx, childSpec, childGender, isFinal) {
  // Genderless lines skip the fee entirely. For target species: at the FINAL
  // step we pay the user-requested gender fee (rare-gender premium possible).
  // At INTERMEDIATE steps we charge the COMMON gender fee for the species —
  // the optimizer models intermediate carriers as the cheap gender even if
  // they nominally fill a slot of the rare gender, since real PokeMMO players
  // accept retries to avoid the per-step rare-gender fee. Group offspring
  // (any non-target egg-group species) is treated as 1F:1M ($5k either way).
  if (ctx.speciesCat === 'genderless') return 0;
  if (childSpec === 'target') {
    const r = ctx.target.gender_ratio;
    if (isFinal) return eggFee(r, childGender);
    if (r === 0)   return eggFee(0, 'M');
    if (r === 254) return eggFee(254, 'F');
    if (r === 127) return 5000;
    const common = r < 127 ? 'M' : 'F';
    return eggFee(r, common);
  }
  return eggFee(127, childGender);
}

// Enumerate valid breeding combos producing a child of the requested species
// class, filtered by the target's gender category (which tiers exist).
function validCombosFor(ctx, childSpec) {
  const cat = ctx.speciesCat;

  if (cat === 'genderless') {
    if (childSpec !== 'target') return [];
    // Genderless lines only breed with Ditto.
    return [
      { motherSpec: 'ditto',  motherGender: 'D', fatherSpec: 'target', fatherGender: 'N' },
      { motherSpec: 'target', motherGender: 'N', fatherSpec: 'ditto',  fatherGender: 'D' },
    ];
  }

  // Universal table for mixed/female-only/male-only species.
  const all = [
    // target child
    { motherSpec: 'target', motherGender: 'F', fatherSpec: 'target', fatherGender: 'M', childSpec: 'target' },
    { motherSpec: 'target', motherGender: 'F', fatherSpec: 'group',  fatherGender: 'M', childSpec: 'target' },
    { motherSpec: 'target', motherGender: 'F', fatherSpec: 'ditto',  fatherGender: 'D', childSpec: 'target' },
    { motherSpec: 'ditto',  motherGender: 'D', fatherSpec: 'target', fatherGender: 'M', childSpec: 'target' },
    // group child
    { motherSpec: 'group',  motherGender: 'F', fatherSpec: 'target', fatherGender: 'M', childSpec: 'group'  },
    { motherSpec: 'group',  motherGender: 'F', fatherSpec: 'group',  fatherGender: 'M', childSpec: 'group'  },
    { motherSpec: 'group',  motherGender: 'F', fatherSpec: 'ditto',  fatherGender: 'D', childSpec: 'group'  },
    { motherSpec: 'ditto',  motherGender: 'D', fatherSpec: 'group',  fatherGender: 'M', childSpec: 'group'  },
  ];

  return all
    .filter((c) => c.childSpec === childSpec)
    .filter((c) => {
      // Drop combos that need a non-existent target gender.
      if (cat === 'female-only' && c.fatherSpec === 'target' && c.fatherGender === 'M') return false;
      if (cat === 'male-only'   && c.motherSpec === 'target' && c.motherGender === 'F') return false;
      return true;
    });
}

/* ─────────────── Helpers ─────────────── */

function sortIVs(arr) {
  return [...arr].sort((a, b) => IV_KEYS.indexOf(a) - IV_KEYS.indexOf(b));
}

// No dedup — each occurrence in the instantiated tree is a real breed event
// (parents are consumed). Counts the per-instance tree, not the recipe.
function collectCounts(node, acc = { steps: 0, breedUps: 0, leaves: 0, powerItems: 0, everstones: 0, eggFees: 0 }) {
  if (!node) return acc;
  if (node.kind === 'leaf') { acc.leaves += 1; return acc; }
  if (node.breedUp) acc.breedUps += 1; else acc.steps += 1;
  acc.powerItems += node.powerItems || 0;
  acc.everstones += node.everstones || 0;
  acc.eggFees    += node.eggFee || 0;
  collectCounts(node.left,  acc);
  collectCounts(node.right, acc);
  return acc;
}

export const ROLE_LABELS = {
  target:   'Target species',
  targetF:  'Target ♀',
  targetM:  'Target ♂',
  groupM:   'Egg-group ♂',
  groupF:   'Egg-group ♀',
  ditto:    'Ditto',
};

export const ROLE_TIERS_FOR_SPECIES = {
  mixed:        ['targetM', 'targetF', 'groupM', 'groupF', 'ditto'],
  'female-only':['targetF', 'groupM', 'groupF', 'ditto'],
  'male-only':  ['targetM', 'groupM', 'groupF', 'ditto'],
  genderless:   ['target', 'ditto'],
};

export const TIER_LABELS = {
  targetM: 'Target ♂',
  targetF: 'Target ♀',
  target:  'Genderless line member',
  groupM:  'Egg-group ♂',
  groupF:  'Egg-group ♀',
  ditto:   'Ditto',
};

export const SPECIES_LABELS = {
  target: 'Target species',
  group:  'Egg-group',
  ditto:  'Ditto',
};

export { POWER_ITEM_FOR, genderlessLineOf };
