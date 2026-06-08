import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sun, Moon, RotateCcw, Save, Trash2, Copy, FolderOpen, Info, X, Check, ShoppingCart } from 'lucide-react';
import PokemonPicker from '../components/PokemonPicker.jsx';
import PokemonSprite from '../components/PokemonSprite.jsx';
import {
  IV_KEYS, IV_LABELS, NATURE_NAMES, POWER_ITEM_FOR,
  DEFAULT_PER_STAT_PRICES, DEFAULT_CONSUMABLE_PRICES, DEFAULT_BASE_PRICES,
  canBreed, isGenderless, genderRatioCategory,
} from '../lib/breeding/data.js';
import {
  planBreeding, matchInventory, ROLE_LABELS, ROLE_TIERS_FOR_SPECIES, TIER_LABELS,
} from '../lib/breeding/optimizer.js';
import { ChevronRight, ChevronDown, GitFork } from 'lucide-react';

const SUB_TABS = [
  { key: 'plan',    label: 'IV Plan' },
  { key: 'costs',   label: 'Costs'   },
  { key: 'have',    label: 'Owned'   },
  { key: 'profit',  label: 'Profit'  },
  { key: 'saved',   label: 'Saved'   },
];

// A blank owned-breeder row for the "Owned" tab. The species (monId) drives
// role + gender; `gender` here is only used for mixed-gender species.
function blankBreeder() {
  return {
    id: 'b_' + Math.random().toString(36).slice(2, 9),
    monId: null,
    ivs: { hp: false, atk: false, def: false, spa: false, spd: false, spe: false },
    gender: 'F',     // only consulted for mixed-gender species
    nature: false,
    shiny: false,
    alpha: false,
  };
}

const LS_PROJECTS_V2 = 'breeding_projects:v2';
const LS_PROJECTS_V1 = 'breeding_projects:v1';

// GTL carrier prices are volatile, so the form leaves them BLANK — no baked-in
// defaults. Empty cells are treated as $0 by the optimizer (see priceVal) so
// the tree/shopping list still build; the user fills in their own market
// prices. Declared before DEFAULT_FORM because that runs clonePrices() at load.
const EMPTY_TIERS = { targetM: null, targetF: null, target: null, groupM: null, groupF: null, ditto: null };

const DEFAULT_FORM = {
  monId: null,
  ivs: { hp: false, atk: false, def: false, spa: false, spd: false, spe: false },
  nature: '',
  // Egg moves (array of move ids) the target should hatch knowing, and whether
  // to breed for the hidden ability. Both are informational — they don't change
  // the IV tree's cost, but they impose a carrier requirement on the lineage.
  eggMoves: [],
  hiddenAbility: false,
  // Shiny / Alpha targets impose tree-wide constraints (see the IV Plan note):
  // shiny only breeds shiny; Alpha needs both parents Alpha at every step.
  shiny: false,
  alpha: false,
  // Owned breeders for the "Owned" tab — matched against the plan tree.
  inventory: [],
  guaranteeGender: true,
  targetGender: 'F',
  prices: clonePrices(),       // blank — user enters volatile GTL prices
  basePrices: cloneBasePrices(),
  consumables: { ...DEFAULT_CONSUMABLE_PRICES }, // power item/everstone are fixed daycare prices
  // Two-layer overrides:
  //   byInstance — applies to a specific occurrence (instanceId key)
  //   byRecipe   — applies to every occurrence of a recipe (recipeId key)
  // Resolution: byInstance wins, then byRecipe, then computed cost.
  overrides: { byInstance: {}, byRecipe: {} },
};

// Migrate any pre-two-layer overrides to byRecipe (the previous turn's keys
// were recipe signatures, not instance IDs).
function normalizeOverrides(raw) {
  if (raw && typeof raw === 'object' && (raw.byInstance || raw.byRecipe)) {
    return {
      byInstance: { ...(raw.byInstance || {}) },
      byRecipe:   { ...(raw.byRecipe   || {}) },
    };
  }
  return { byInstance: {}, byRecipe: { ...(raw || {}) } };
}

function clonePrices(src) {
  // Null template + saved overrides — a fresh form is all-blank; a loaded
  // project keeps whatever it had (and gains any newer tier key as blank).
  const out = {};
  for (const stat of IV_KEYS) {
    out[stat] = { ...EMPTY_TIERS, ...(src?.[stat] || {}) };
  }
  return out;
}

function cloneBasePrices(src) {
  return { ...EMPTY_TIERS, ...(src || {}) };
}

export default function BreedingPlanner({ data, theme, onTheme }) {
  const [tab, setTab] = useState('plan');
  const [form, setForm] = useState(DEFAULT_FORM);
  const [salePrice, setSalePrice] = useState('');
  const [projects, setProjects] = useState(() => loadProjects());
  const [toast, setToast] = useState(null);
  const lastTargetIdRef = useRef(null);

  const setField = useCallback((field, value) => setForm((f) => ({ ...f, [field]: value })), []);
  const setIV    = useCallback((k, v) => setForm((f) => ({ ...f, ivs: { ...f.ivs, [k]: v } })), []);
  const reset    = useCallback(() => setForm(DEFAULT_FORM), []);

  const breedablePokemon = useMemo(() => data.pokemon.filter(canBreed), [data.pokemon]);
  // Owned breeders can also be Ditto (a valid parent though not a valid target).
  const breederPokemon = useMemo(
    () => data.pokemon.filter((p) => p.id === 132 || canBreed(p)),
    [data.pokemon]
  );
  const target = useMemo(
    () => (form.monId != null ? data.pokemon.find((p) => p.id === form.monId) : null),
    [form.monId, data.pokemon]
  );
  const targetIVs = useMemo(() => IV_KEYS.filter((k) => form.ivs[k]), [form.ivs]);
  const speciesCat = target ? genderRatioCategory(target) : 'mixed';
  const visibleTiers = ROLE_TIERS_FOR_SPECIES[speciesCat] || ROLE_TIERS_FOR_SPECIES.mixed;

  // Egg-move + hidden-ability options for the selected target.
  const hiddenAbility = useMemo(() => target?.abilities?.find((a) => a.hidden) || null, [target]);
  const eggMoveOptions = useMemo(() => {
    const ids = [...new Set((target?.moves?.egg || []).map((m) => m.id))];
    return ids
      .map((id) => ({ id, name: data.moves[id]?.name }))
      .filter((o) => o.name)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [target, data.moves]);
  const selectedEggMoveNames = useMemo(
    () => form.eggMoves.map((id) => data.moves[id]?.name).filter(Boolean),
    [form.eggMoves, data.moves]
  );
  const toggleEggMove = useCallback((id) => {
    setForm((f) => ({
      ...f,
      eggMoves: f.eggMoves.includes(id) ? f.eggMoves.filter((x) => x !== id) : [...f.eggMoves, id],
    }));
  }, []);

  // Owned-breeder inventory handlers ("I Have" tab).
  const addBreeder    = useCallback(() => setForm((f) => ({ ...f, inventory: [...(f.inventory || []), blankBreeder()] })), []);
  const removeBreeder = useCallback((id) => setForm((f) => ({ ...f, inventory: (f.inventory || []).filter((b) => b.id !== id) })), []);
  const updateBreeder = useCallback((id, patch) => setForm((f) => ({
    ...f, inventory: (f.inventory || []).map((b) => (b.id === id ? { ...b, ...patch } : b)),
  })), []);

  // Run optimizer.
  const planResult = useMemo(() => planBreeding({
    target,
    ivs: targetIVs,
    targetGender: form.targetGender,
    nature: form.nature || null,
    guaranteeGender: form.guaranteeGender,
    prices: form.prices,
    basePrices: form.basePrices,
    consumables: form.consumables,
    overrides: form.overrides,
  }), [target, targetIVs, form.targetGender, form.nature, form.guaranteeGender, form.prices, form.basePrices, form.consumables, form.overrides]);

  // Migrate v1 saved projects on first mount.
  useEffect(() => {
    const out = migrateV1IfNeeded();
    if (out.migrated > 0) {
      setProjects(loadProjects());
      showToast(setToast, `${out.migrated} project${out.migrated === 1 ? '' : 's'} migrated to the new planner. Some price details may need updating.`);
    }
  }, []);

  // When the target species changes: clear overrides (different market) and
  // snap the target gender to whatever's valid for the species.
  useEffect(() => {
    if (target?.id === lastTargetIdRef.current) return;
    lastTargetIdRef.current = target?.id ?? null;
    if (!target) return;
    setForm((f) => {
      const cat = genderRatioCategory(target);
      let g = f.targetGender;
      if (cat === 'female-only') g = 'F';
      else if (cat === 'male-only') g = 'M';
      else if (cat === 'genderless') g = 'N';
      else if (g !== 'F' && g !== 'M') g = 'F';
      // Egg moves + hidden-ability + shiny/alpha are species-specific — clear on target change.
      return { ...f, overrides: { byInstance: {}, byRecipe: {} }, targetGender: g, eggMoves: [], hiddenAbility: false, shiny: false, alpha: false };
    });
  }, [target?.id]);

  // setOverride(node, scope, value)
  //   scope ∈ { 'instance', 'recipe' }
  //   value === null clears the override (and also clears the other layer for
  //   that node so a single Reset removes any conflicting prior layer).
  const setOverride = useCallback((node, scope, value) => {
    if (!node) return;
    setForm((f) => {
      const cur = normalizeOverrides(f.overrides);
      const byInstance = { ...cur.byInstance };
      const byRecipe   = { ...cur.byRecipe };
      if (value == null || !Number.isFinite(value) || value < 0) {
        delete byInstance[node.instanceId];
        delete byRecipe[node.recipeId];
      } else if (scope === 'recipe') {
        byRecipe[node.recipeId] = value;
        // Drop any per-instance overrides on this recipe so the recipe-wide
        // value applies cleanly.
        for (const k of Object.keys(byInstance)) {
          if (k.startsWith(node.recipeId + '#')) delete byInstance[k];
        }
      } else {
        byInstance[node.instanceId] = value;
      }
      return { ...f, overrides: { byInstance, byRecipe } };
    });
  }, []);

  const setPriceCell = useCallback((stat, tier, raw) => {
    const value = Math.max(0, Math.round(Number(raw) || 0));
    setForm((f) => {
      const cur = normalizeOverrides(f.overrides);
      const had = Object.keys(cur.byInstance).length + Object.keys(cur.byRecipe).length > 0;
      const nextPrices = clonePrices(f.prices);
      nextPrices[stat][tier] = value;
      const next = { ...f, prices: nextPrices, overrides: { byInstance: {}, byRecipe: {} } };
      if (had) queueMicrotask(() => showToast(setToast, 'Prices changed — overrides cleared.'));
      return next;
    });
  }, []);

  const setBasePriceCell = useCallback((tier, raw) => {
    const value = Math.max(0, Math.round(Number(raw) || 0));
    setForm((f) => {
      const cur = normalizeOverrides(f.overrides);
      const had = Object.keys(cur.byInstance).length + Object.keys(cur.byRecipe).length > 0;
      const next = { ...f, basePrices: { ...f.basePrices, [tier]: value }, overrides: { byInstance: {}, byRecipe: {} } };
      if (had) queueMicrotask(() => showToast(setToast, 'Prices changed — overrides cleared.'));
      return next;
    });
  }, []);

  const setConsumable = useCallback((key, raw) => {
    const value = Math.max(0, Math.round(Number(raw) || 0));
    setForm((f) => ({ ...f, consumables: { ...f.consumables, [key]: value } }));
  }, []);

  const resetPrices = useCallback(() => {
    setForm((f) => ({ ...f, prices: clonePrices(), basePrices: cloneBasePrices(), consumables: { ...DEFAULT_CONSUMABLE_PRICES }, overrides: { byInstance: {}, byRecipe: {} } }));
    showToast(setToast, 'Carrier prices cleared.');
  }, []);

  const saveProject = useCallback((name) => {
    const proj = {
      id: 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      name: name || autoProjectName(target, targetIVs, form.nature),
      createdAt: new Date().toISOString(),
      target: target ? { id: target.id, name: target.name } : null,
      inputs: {
        ivs: { ...form.ivs },
        nature: form.nature, ability: form.hiddenAbility, moves: [...form.eggMoves],
        targetGender: form.targetGender, guaranteeGender: form.guaranteeGender,
        shiny: form.shiny, alpha: form.alpha,
      },
      prices: clonePrices(form.prices),
      basePrices: { ...form.basePrices },
      consumables: { ...form.consumables },
      overrides: normalizeOverrides(form.overrides),
      inventory: (form.inventory || []).map((b) => ({ ...b, ivs: { ...b.ivs } })),
      computedTotalCost: planResult?.totalCost ?? null,
      salePrice: salePrice ? Number(salePrice) : null,
    };
    const next = [proj, ...projects];
    setProjects(next); saveProjects(next);
    showToast(setToast, 'Project saved.');
  }, [target, targetIVs, form, salePrice, planResult, projects]);

  const deleteProject = useCallback((id) => {
    const next = projects.filter((p) => p.id !== id);
    setProjects(next); saveProjects(next);
  }, [projects]);

  const duplicateProject = useCallback((id) => {
    const p = projects.find((x) => x.id === id); if (!p) return;
    const dupe = { ...p, id: 'p_' + Date.now(), name: p.name + ' (copy)', createdAt: new Date().toISOString() };
    const next = [dupe, ...projects];
    setProjects(next); saveProjects(next);
  }, [projects]);

  const openProject = useCallback((id) => {
    const p = projects.find((x) => x.id === id); if (!p) return;
    setForm({
      monId: p.target?.id ?? null,
      ivs: { ...DEFAULT_FORM.ivs, ...(p.inputs?.ivs || {}) },
      nature: p.inputs?.nature || '',
      eggMoves: Array.isArray(p.inputs?.moves) ? p.inputs.moves : [],
      hiddenAbility: !!p.inputs?.ability,
      shiny: !!p.inputs?.shiny,
      alpha: !!p.inputs?.alpha,
      inventory: Array.isArray(p.inventory) ? p.inventory : [],
      guaranteeGender: p.inputs?.guaranteeGender !== false,
      targetGender: p.inputs?.targetGender || 'F',
      prices: p.prices ? clonePrices(p.prices) : clonePrices(),
      basePrices: cloneBasePrices(p.basePrices),
      consumables: p.consumables ? { ...p.consumables } : { ...DEFAULT_CONSUMABLE_PRICES },
      overrides: normalizeOverrides(p.overrides),
    });
    if (p.salePrice != null) setSalePrice(String(p.salePrice));
    lastTargetIdRef.current = p.target?.id ?? null; // skip the mon-change useEffect that would clear overrides
    setTab('plan');
  }, [projects]);

  return (
    <main className="max-w-7xl mx-auto px-4 py-4 space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-md border border-[#d6c8a3] dark:border-stone-700 overflow-hidden">
          {SUB_TABS.map((t) => (
            <button
              key={t.key} type="button"
              onClick={() => setTab(t.key)}
              aria-pressed={tab === t.key}
              className={`px-3 py-1.5 text-sm font-medium ${tab === t.key
                ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                : 'bg-[#fdf8e9] text-stone-700 hover:bg-[#ece2c4] dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800'}`}
            >{t.label}</button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => onTheme(theme === 'dark' ? 'light' : 'dark')}
          className="ml-auto p-1.5 rounded-md border border-[#d6c8a3] dark:border-stone-700
                     bg-[#fdf8e9] dark:bg-stone-900 hover:bg-[#ece2c4] dark:hover:bg-stone-800
                     text-stone-700 dark:text-stone-300"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>

      <DeferredFeaturesNotice />

      <div className="grid lg:grid-cols-[380px_1fr] gap-4 items-start">
        <aside className="lg:sticky lg:top-4 self-start space-y-3">
          <FormCard title="Target">
            <PokemonPicker
              pokemon={breedablePokemon}
              value={form.monId}
              onChange={(id) => setField('monId', id)}
              placeholder="Pick a target species"
            />
            {target && <SpeciesSummary pokemon={target} />}
          </FormCard>

          <FormCard title="IVs (mark stats you want at 31)">
            <div className="grid grid-cols-3 gap-1.5">
              {IV_KEYS.map((k) => (
                <button
                  key={k} type="button"
                  onClick={() => setIV(k, !form.ivs[k])}
                  aria-pressed={form.ivs[k]}
                  className={`px-2 py-1 rounded text-xs font-semibold uppercase border transition-colors ${
                    form.ivs[k]
                      ? 'bg-emerald-500 text-white border-emerald-600'
                      : 'bg-[#fdf8e9] dark:bg-stone-900 text-stone-600 dark:text-stone-400 border-[#d6c8a3] dark:border-stone-700 hover:bg-[#ece2c4] dark:hover:bg-stone-800'
                  }`}
                >{IV_LABELS[k]}</button>
              ))}
            </div>
            <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">
              {targetIVs.length} of 6 stats targeted at 31
            </div>
          </FormCard>

          <FormCard title="Nature & Gender">
            <div className="space-y-1.5">
              <label className="text-xs text-stone-500 dark:text-stone-400">Nature</label>
              <select
                value={form.nature}
                onChange={(e) => setField('nature', e.target.value)}
                className="w-full px-2 py-1.5 rounded-md border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-stone-900 dark:text-stone-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Don't care</option>
                {NATURE_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            {target && !isGenderless(target) && speciesCat === 'mixed' && (
              <div className="space-y-1.5">
                <label className="text-xs text-stone-500 dark:text-stone-400">Target gender</label>
                <div className="inline-flex rounded-md border border-[#d6c8a3] dark:border-stone-700 overflow-hidden">
                  {['F', 'M'].map((g) => (
                    <button
                      key={g} type="button"
                      onClick={() => setField('targetGender', g)}
                      aria-pressed={form.targetGender === g}
                      className={`px-3 py-1 text-xs font-medium ${form.targetGender === g
                        ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                        : 'bg-[#fdf8e9] dark:bg-stone-900 text-stone-600 dark:text-stone-400 hover:bg-[#ece2c4] dark:hover:bg-stone-800'}`}
                    >{g === 'F' ? 'Female' : 'Male'}</button>
                  ))}
                </div>
              </div>
            )}
            <CheckRow label="Pay to guarantee child gender at each step"
                      checked={form.guaranteeGender}
                      onChange={(v) => setField('guaranteeGender', v)} />
            {!form.guaranteeGender && (
              <div className="text-[11px] text-amber-700 dark:text-amber-400">
                Egg fees waived. You'll need to retry breeds where the wrong gender appears.
              </div>
            )}
            <div className="pt-1.5 mt-1.5 border-t border-[#ece2c4] dark:border-stone-800/60 space-y-1">
              <CheckRow label="Shiny" checked={form.shiny} onChange={(v) => setField('shiny', v)} />
              <CheckRow label="Alpha" checked={form.alpha} onChange={(v) => setField('alpha', v)} />
              {(form.shiny || form.alpha) && (
                <div className="text-[11px] text-violet-700 dark:text-violet-300">
                  {form.shiny && 'Shinies only breed with shinies — every parent must be shiny. '}
                  {form.alpha && 'Alpha needs both parents Alpha at every step.'}
                </div>
              )}
            </div>
          </FormCard>

          {target && (hiddenAbility || eggMoveOptions.length > 0) && (
            <FormCard title="Egg moves & ability">
              {hiddenAbility && (
                <CheckRow
                  label={`Breed for hidden ability (${hiddenAbility.name})`}
                  checked={form.hiddenAbility}
                  onChange={(v) => setField('hiddenAbility', v)}
                />
              )}
              {eggMoveOptions.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs text-stone-500 dark:text-stone-400">
                    Egg moves to inherit {form.eggMoves.length > 0 && <span className="text-stone-400">({form.eggMoves.length})</span>}
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {eggMoveOptions.map((o) => {
                      const sel = form.eggMoves.includes(o.id);
                      return (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() => toggleEggMove(o.id)}
                          aria-pressed={sel}
                          className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                            sel
                              ? 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-900'
                              : 'bg-[#fdf8e9] dark:bg-stone-900 text-stone-700 dark:text-stone-300 border-[#d6c8a3] dark:border-stone-700 hover:bg-[#ece2c4] dark:hover:bg-stone-800'
                          }`}
                        >
                          {o.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </FormCard>
          )}

          <PerStatPriceTable
            stats={targetIVs}
            tiers={visibleTiers}
            prices={form.prices}
            basePrices={form.basePrices}
            onChange={setPriceCell}
            onChangeBase={setBasePriceCell}
            onReset={resetPrices}
          />

          <ConsumablePriceCard
            consumables={form.consumables}
            onChange={setConsumable}
          />

          <button
            type="button" onClick={reset}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 hover:bg-[#ece2c4] dark:hover:bg-stone-800 text-sm text-stone-700 dark:text-stone-300"
          >
            <RotateCcw size={14} /> Reset form
          </button>
        </aside>

        <section className="min-w-0">
          {tab === 'plan'   && <IVPlanTab target={target} plan={planResult} form={form} setOverride={setOverride} onSave={saveProject} eggMoveNames={selectedEggMoveNames} hiddenAbility={form.hiddenAbility ? hiddenAbility : null} shiny={form.shiny} alpha={form.alpha} />}
          {tab === 'costs'  && <CostsTab plan={planResult} target={target} form={form} />}
          {tab === 'have'   && <HaveTab data={data} plan={planResult} target={target} breederPokemon={breederPokemon} inventory={form.inventory || []} shiny={form.shiny} alpha={form.alpha} onAdd={addBreeder} onRemove={removeBreeder} onUpdate={updateBreeder} />}
          {tab === 'profit' && <ProfitTab plan={planResult} salePrice={salePrice} setSalePrice={setSalePrice} />}
          {tab === 'saved'  && <SavedProjectsTab data={data} projects={projects} onOpen={openProject} onDuplicate={duplicateProject} onDelete={deleteProject} />}
        </section>
      </div>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </main>
  );
}

/* ─────────────── Form sub-components ─────────────── */

function FormCard({ title, children, action }) {
  return (
    <section className="rounded-md border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function CheckRow({ label, checked, onChange }) {
  return (
    <label className="flex items-center gap-2 text-sm text-stone-700 dark:text-stone-300 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-blue-500" />
      {label}
    </label>
  );
}

// Breeding-relevant context for the selected target. The sprite / name / types
// are already shown in the PokemonPicker trigger above, so this only adds what
// the picker doesn't: egg group(s) and any gender-ratio caveat that changes how
// the breed tree is built.
function SpeciesSummary({ pokemon }) {
  const cat = genderRatioCategory(pokemon);
  const note = cat === 'female-only' ? 'Female-only — every breed uses an egg-group ♂ as the other parent.'
             : cat === 'male-only'   ? 'Male-only — the other parent is always Ditto.'
             : cat === 'genderless'  ? 'Genderless — parents are same-line members or Ditto.'
             : null;
  const groups = [...new Set(pokemon.egg_groups || [])];
  if (groups.length === 0 && !note) return null;
  return (
    <div className="mt-2 pt-2 border-t border-[#ece2c4] dark:border-stone-800/60 space-y-1.5 text-[11px]">
      {groups.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="uppercase tracking-wider text-[10px] text-stone-500 dark:text-stone-500">Egg group</span>
          {groups.map((g) => (
            <span key={g} className="px-1.5 py-px rounded bg-[#ece2c4] dark:bg-stone-800 text-stone-700 dark:text-stone-300">{eggGroupLabel(g)}</span>
          ))}
        </div>
      )}
      {note && <div className="text-amber-700 dark:text-amber-400">⚠ {note}</div>}
    </div>
  );
}

// "water1" → "Water 1", "human-like" → "Human Like".
function eggGroupLabel(g) {
  return String(g)
    .replace(/(\d+)/, ' $1')
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

const PerStatPriceTable = memo(function PerStatPriceTable({ stats, tiers, prices, basePrices, onChange, onChangeBase, onReset }) {
  if (stats.length === 0) {
    return (
      <FormCard title="Carrier prices">
        <div className="text-xs text-stone-500 dark:text-stone-400">Mark at least one IV at 31 to set carrier prices.</div>
      </FormCard>
    );
  }
  return (
    <FormCard
      title="Carrier prices ($)"
      action={
        <button type="button" onClick={onReset}
          className="text-[10px] uppercase tracking-wider text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200">
          Reset prices
        </button>
      }
    >
      {/* Vertical, wrapping layout: one block per stat (+ a 0×31 block), each
          with its tier inputs in a 2-column grid. Fits the sidebar with no
          horizontal scroll and keeps each price box comfortably wide. */}
      <div className="space-y-2">
        {stats.map((stat) => (
          <PriceStatBlock
            key={stat}
            heading={`${IV_LABELS[stat]} · 1×31`}
            tiers={tiers}
            get={(tier) => prices[stat][tier]}
            set={(tier, v) => onChange(stat, tier, v)}
          />
        ))}
        <PriceStatBlock
          heading="0×31 · any stat (breed-up placeholder)"
          tiers={tiers}
          get={(tier) => basePrices?.[tier]}
          set={(tier, v) => onChangeBase(tier, v)}
        />
      </div>
      <div className="text-[10px] text-stone-500 dark:text-stone-400 leading-snug space-y-1">
        <div>2×31+ carriers are bred from these 1×31 components — no buy option at higher tiers.</div>
        <div>1×31 carriers can also be bred from a 0×31 mom of the same role + a 1×31 dad of any role + Power Item — the optimizer picks the cheaper of buy vs breed-up.</div>
        <div>
          <span className="font-semibold">Note:</span> Enter prices for species that can pass IVs through breeding.
          Female-only species (Kangaskhan, Jynx, Miltank, etc.) and male-only species (Tauros, Volbeat, etc.)
          only produce more of themselves regardless of partner — they're dead-end carriers and shouldn't influence
          your egg-group prices.
        </div>
      </div>
    </FormCard>
  );
});

// One stat's price row: a labeled heading and the per-tier inputs in a wrapping
// 2-column grid (each input fills its cell, so no horizontal scroll).
function PriceStatBlock({ heading, tiers, get, set }) {
  return (
    <div className="rounded border border-[#e6dabf] dark:border-stone-800 bg-[#f7f0db]/70 dark:bg-stone-900/50 p-2">
      <div className="text-[11px] font-semibold text-stone-700 dark:text-stone-300 mb-1.5">{heading}</div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
        {tiers.map((tier) => (
          <label key={tier} className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[10px] text-stone-500 dark:text-stone-400 truncate" title={TIER_LABELS[tier]}>{TIER_LABELS[tier]}</span>
            <PriceInput value={get(tier)} onChange={(v) => set(tier, v)} />
          </label>
        ))}
      </div>
    </div>
  );
}

function PriceInput({ value, onChange, placeholder = '—' }) {
  const hasValue = Number.isFinite(Number(value)) && value !== null && value !== '';
  return (
    <input
      type="number" min="0"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full px-2 py-1.5 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-stone-900 dark:text-stone-100 text-sm tabular-nums text-right focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-stone-400 dark:placeholder:text-stone-600 ${hasValue ? 'font-semibold' : ''}`}
    />
  );
}

const ConsumablePriceCard = memo(function ConsumablePriceCard({ consumables, onChange }) {
  return (
    <FormCard title="Consumable prices ($)">
      <div className="grid grid-cols-2 gap-2 text-xs">
        <PriceField label="Power Item (each)" value={consumables.powerItem} onChange={(v) => onChange('powerItem', v)} />
        <PriceField label="Everstone (each)"  value={consumables.everstone} onChange={(v) => onChange('everstone', v)} />
      </div>
    </FormCard>
  );
});

function PriceField({ label, value, onChange }) {
  return (
    <label className="block">
      <span className="text-stone-500 dark:text-stone-400">{label}</span>
      <input type="number" min="0" value={value || ''} onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full px-1.5 py-1 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-stone-900 dark:text-stone-100 text-xs tabular-nums text-right" />
    </label>
  );
}

function DeferredFeaturesNotice() {
  return (
    <div className="rounded-md border border-blue-300 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 p-2.5 text-xs text-blue-900 dark:text-blue-200 flex items-start gap-2">
      <Info size={14} className="shrink-0 mt-0.5" />
      <span>
        Planner covers IV + nature optimization with per-stat 1×31 pricing, recursive intermediate breeding (no buy at 2×31+ tiers), accurate egg fees, per-node cost overrides, and now egg-move + hidden-ability carrier requirements. Volt Tackle / Incense babies and owned-parent reuse are still to come.
      </span>
    </div>
  );
}

// True once the user has entered at least one GTL carrier price. Until then,
// totals reflect only fixed costs (power items + egg fees).
function anyCarrierPriced(prices) {
  if (!prices) return false;
  for (const stat of IV_KEYS) {
    const row = prices[stat];
    if (!row) continue;
    for (const v of Object.values(row)) {
      if (v !== null && v !== '' && Number.isFinite(Number(v)) && Number(v) > 0) return true;
    }
  }
  return false;
}

function PricesNotSetNote() {
  return (
    <div className="rounded-md border border-amber-300 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/30 p-2.5 text-xs text-amber-800 dark:text-amber-300">
      Carrier prices aren't set — totals count only fixed costs (power items + egg fees). GTL prices swing too much to ship defaults, so enter your current market prices in the sidebar's “Carrier prices” table to fold them in.
    </div>
  );
}

/* ─────────────── IV Plan tab ─────────────── */

function IVPlanTab({ target, plan, form, setOverride, onSave, eggMoveNames = [], hiddenAbility = null, shiny = false, alpha = false }) {
  if (!target) return <Empty msg="Pick a target species to start." />;
  if (!plan) return <Empty msg="No IVs targeted yet — flip at least one stat to 31 in the form." />;

  // Build a stable label per duplicated recipe (only recipes used 2+ times get
  // a pill so the user can spot identical sub-trees at a glance).
  const recipeLabels = useMemo(() => {
    const out = new Map();
    if (!plan.recipeUsage) return out;
    let i = 0;
    for (const [rid, count] of plan.recipeUsage) {
      if (count > 1) {
        out.set(rid, { letter: indexToLetter(i), count, paletteIdx: i % RECIPE_PALETTE.length });
        i += 1;
      }
    }
    return out;
  }, [plan.recipeUsage]);

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900 p-3 flex items-center gap-3 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-stone-500 dark:text-stone-400">Total cost</div>
          <div className="text-2xl font-bold text-stone-900 dark:text-stone-100 tabular-nums">${formatMoney(plan.totalCost)}</div>
        </div>
        <div className="text-xs text-stone-500 dark:text-stone-400 ml-auto">
          {plan.counts.steps} step{plan.counts.steps === 1 ? '' : 's'}
          {plan.counts.breedUps > 0 && <> + {plan.counts.breedUps} breed-up{plan.counts.breedUps === 1 ? '' : 's'}</>}
          {' · '}{plan.counts.leaves} parent leaf{plan.counts.leaves === 1 ? '' : 'es'}
        </div>
        <SaveButton onSave={onSave} />
      </div>

      {!anyCarrierPriced(form.prices) && <PricesNotSetNote />}

      {(eggMoveNames.length > 0 || hiddenAbility || shiny || alpha) && (
        <div className="rounded-md border border-violet-300 dark:border-violet-900 bg-violet-50/60 dark:bg-violet-950/30 p-3 text-sm space-y-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-violet-700 dark:text-violet-300">Carrier requirements</div>
          {shiny && (
            <div className="text-stone-700 dark:text-stone-300">
              <span className="font-semibold">Shiny:</span> shinies only breed with other shinies — <em>every</em> breeder in the tree must be shiny. The prices below are for normal carriers; shiny carriers cost far more, so treat the total as a floor (use per-node overrides for real shiny prices).
            </div>
          )}
          {alpha && (
            <div className="text-stone-700 dark:text-stone-300">
              <span className="font-semibold">Alpha:</span> a child is Alpha only when <em>both</em> parents are Alpha — so every carrier in the tree must be Alpha too.
            </div>
          )}
          {hiddenAbility && (
            <div className="text-stone-700 dark:text-stone-300">
              <span className="font-semibold">Hidden ability ({hiddenAbility.name}):</span> passes by species — make sure the
              {' '}{target.name}-species parent in the final breed (the ♀, or the ♂ paired with Ditto) already has it. It can't be added with an item.
            </div>
          )}
          {eggMoveNames.length > 0 && (
            <div className="text-stone-700 dark:text-stone-300">
              <span className="font-semibold">Egg moves:</span> one parent in the final breed must already know{' '}
              {eggMoveNames.map((n, i) => (
                <span key={n}>
                  <span className="font-medium text-stone-900 dark:text-stone-100">{n}</span>{i < eggMoveNames.length - 1 ? ', ' : ''}
                </span>
              ))}. In PokeMMO an egg move passes from <em>either</em> parent that knows it; chain it in via any same-egg-group carrier that can learn it.
            </div>
          )}
        </div>
      )}

      <RecipeBreakdown node={plan.node} target={target} consumables={form.consumables} recipeLabels={recipeLabels} />

      <BreedingPlanView plan={plan} target={target} nature={form.nature} setOverride={setOverride} recipeLabels={recipeLabels} />
    </div>
  );
}

// "Recipes" = the distinct breeder builds the plan reuses. A recipe is one
// (species role + IV set + gender + nature) combo; the same one usually recurs
// across the tree (e.g. a 2×31 Atk+SpA ♂ used at several branches). This card
// aggregates every node by its recipe so the user can see, at a glance, how
// many of each build they must make or buy — and what each costs.
//
// Cost shown per recipe is its OWN cost (a Buy's purchase price, or a Build's
// power-items + everstone + egg fee for that one breed event), NOT the subtree
// total — so the column reconciles to the plan total without double-counting.
function RecipeBreakdown({ node, target, consumables, recipeLabels }) {
  const recipes = useMemo(() => {
    const arr = [...aggregateRecipes(node, consumables).values()]
      // Drop free 0×31 placeholders — they cost nothing and add noise.
      .filter((r) => !(r.kind === 'leaf' && r.ivs.length === 0 && r.total === 0));
    arr.sort((a, b) =>
      b.count - a.count ||
      b.ivs.length - a.ivs.length ||
      (b.count * b.unit) - (a.count * a.unit)
    );
    return arr;
  }, [node, consumables]);

  if (recipes.length === 0) return null;
  const repeated = recipes.filter((r) => r.count > 1).length;
  const grandTotal = recipes.reduce((s, r) => s + r.total, 0);

  return (
    <FormCard title={`Recipe breakdown — ${recipes.length} distinct build${recipes.length === 1 ? '' : 's'}`}>
      <p className="-mt-1 text-[11px] text-stone-500 dark:text-stone-400 leading-snug">
        A <span className="font-semibold text-stone-700 dark:text-stone-300">recipe</span> is a reusable breeder build — a set species role + IV set (and nature/gender). The same build recurs across the tree, so here's each distinct one and how many you need.
        {repeated > 0 && <> Builds used 2+ times carry a colored letter that matches the outline and tree.</>}
      </p>
      <ul className="mt-2 text-sm divide-y divide-[#ece2c4] dark:divide-stone-800/60">
        {recipes.map((r) => {
          const role = ROLE_LABELS[r.role] || (r.species === 'group' ? 'Egg-group filler' : r.species === 'ditto' ? 'Ditto' : 'Carrier');
          const genderSym = r.gender === 'F' ? ' ♀' : r.gender === 'M' ? ' ♂' : '';
          const isBuild = r.kind === 'breed';
          const label = recipeLabels?.get(r.recipeId);
          return (
            <li key={r.recipeId} className="flex items-baseline gap-2 py-1.5">
              <span className="font-mono tabular-nums font-bold text-stone-900 dark:text-stone-100 w-9 shrink-0">{r.count}×</span>
              <span className="flex-1 min-w-0">
                <span className="font-medium text-stone-800 dark:text-stone-200">{r.ivs.length}×31 {role}{genderSym}</span>
                {r.ivs.length > 0 && <span className="text-stone-500 dark:text-stone-400"> ({formatIVList(r.ivs)})</span>}
                <span className={`ml-1.5 px-1 py-px rounded text-[9px] uppercase tracking-wider ${isBuild ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' : 'bg-stone-200 text-stone-600 dark:bg-stone-800 dark:text-stone-400'}`}>
                  {isBuild ? 'Build' : 'Buy'}
                </span>
                {label && <span className="ml-1.5 align-middle"><RecipePill recipeLabels={recipeLabels} recipeId={r.recipeId} /></span>}
              </span>
              <span className="hidden sm:inline text-xs text-stone-400 dark:text-stone-500 tabular-nums">
                {r.varies ? 'varies' : `$${formatMoney(r.unit)} ea`}
              </span>
              <span className="font-mono tabular-nums text-stone-700 dark:text-stone-300 w-20 text-right">${formatMoney(r.total)}</span>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 pt-2 border-t border-[#ece2c4] dark:border-stone-800/60 flex items-baseline justify-between text-sm">
        <span className="text-stone-500 dark:text-stone-400">Builds + buys subtotal</span>
        <span className="font-mono tabular-nums font-semibold text-stone-900 dark:text-stone-100">${formatMoney(grandTotal)}</span>
      </div>
    </FormCard>
  );
}

// Group every node in the instantiated tree by recipeId. Each recipe records
// how many times it occurs (count) and its OWN per-occurrence cost — for a leaf
// that's the buy price; for a breed it's that one event's power items +
// everstone + egg fee (NOT the subtree, so totals don't double-count nested
// recipes). `varies` flags recipes whose instances differ (per-instance cost
// overrides).
function aggregateRecipes(node, consumables, map = new Map()) {
  if (!node) return map;
  const own = node.kind === 'breed'
    ? (node.powerItems || 0) * (consumables?.powerItem || 0)
      + (node.everstones || 0) * (consumables?.everstone || 0)
      + (node.eggFee || 0)
    : (node.cost || 0);
  const e = map.get(node.recipeId);
  if (e) {
    e.count += 1;
    e.total += own;
    if (own !== e.unit) e.varies = true;
  } else {
    map.set(node.recipeId, {
      recipeId: node.recipeId, count: 1, total: own, unit: own, varies: false,
      species: node.species, role: node.role, gender: node.gender,
      ivs: node.ivs || [], kind: node.kind, breedUp: !!node.breedUp,
    });
  }
  if (node.kind === 'breed') {
    aggregateRecipes(node.left, consumables, map);
    aggregateRecipes(node.right, consumables, map);
  }
  return map;
}

function BreedingPlanView({ plan, target, nature, setOverride, recipeLabels }) {
  const [view, setView] = useState('outline'); // 'outline' | 'tree'
  return (
    <FormCard
      title={view === 'tree' ? 'Tree' : 'Outline'}
      action={
        <div className="inline-flex rounded border border-[#d6c8a3] dark:border-stone-700 overflow-hidden text-[10px] uppercase tracking-wider">
          <button type="button" onClick={() => setView('outline')}
            className={`px-2 py-0.5 ${view === 'outline' ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900' : 'text-stone-500 hover:bg-[#ece2c4] dark:hover:bg-stone-800'}`}>
            Outline
          </button>
          <button type="button" onClick={() => setView('tree')}
            className={`px-2 py-0.5 ${view === 'tree' ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900' : 'text-stone-500 hover:bg-[#ece2c4] dark:hover:bg-stone-800'}`}>
            Tree
          </button>
        </div>
      }
    >
      {view === 'outline'
        ? <BreedingOutline node={plan.node} target={target} nature={nature} setOverride={setOverride} recipeLabels={recipeLabels} />
        : <BreedingTree     node={plan.node} target={target} nature={nature} recipeLabels={recipeLabels} />}
    </FormCard>
  );
}

const RECIPE_PALETTE = [
  { bg: 'bg-blue-100 dark:bg-blue-950/40',       text: 'text-blue-700 dark:text-blue-300',       border: 'border-blue-300 dark:border-blue-800/60' },
  { bg: 'bg-emerald-100 dark:bg-emerald-950/40', text: 'text-emerald-700 dark:text-emerald-300', border: 'border-emerald-300 dark:border-emerald-800/60' },
  { bg: 'bg-fuchsia-100 dark:bg-fuchsia-950/40', text: 'text-fuchsia-700 dark:text-fuchsia-300', border: 'border-fuchsia-300 dark:border-fuchsia-800/60' },
  { bg: 'bg-orange-100 dark:bg-orange-950/40',   text: 'text-orange-700 dark:text-orange-300',   border: 'border-orange-300 dark:border-orange-800/60' },
  { bg: 'bg-sky-100 dark:bg-sky-950/40',         text: 'text-sky-700 dark:text-sky-300',         border: 'border-sky-300 dark:border-sky-800/60' },
  { bg: 'bg-rose-100 dark:bg-rose-950/40',       text: 'text-rose-700 dark:text-rose-300',       border: 'border-rose-300 dark:border-rose-800/60' },
];

function indexToLetter(i) {
  // 0 → A, 25 → Z, 26 → AA, …
  let s = '';
  let n = i;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}

function RecipePill({ recipeLabels, recipeId }) {
  const info = recipeLabels?.get(recipeId);
  if (!info) return null;
  const c = RECIPE_PALETTE[info.paletteIdx];
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${c.bg} ${c.text} ${c.border}`} title={`Recipe ${info.letter} — used ${info.count} times in this plan; each occurrence is a separate breed event.`}>
      Recipe {info.letter}
    </span>
  );
}

function BreedingOutline({ node, target, nature, setOverride, recipeLabels }) {
  if (!node) return null;
  const steps = flattenSteps(node);
  return (
    <ol className="space-y-2.5 text-sm">
      {steps.map((s, i) => {
        const isFiller = s.species === 'group';
        const isFinal = i === steps.length - 1;
        const genderSym = s.gender === 'F' ? ' ♀' : s.gender === 'M' ? ' ♂' : '';
        const outName = isFiller ? `Egg-group filler${genderSym}` : `${target.name}${genderSym}`;
        const sharedSet = new Set(s.sharedIVs || []);
        const tone = isFiller
          ? 'border-amber-300 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20'
          : isFinal
            ? 'border-emerald-300 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/15'
            : 'border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900';
        return (
        <li key={s.instanceId} className={`rounded-md border overflow-hidden ${tone}`}>
          {/* Header: step number + what this breed produces + cost */}
          <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-[#ece2c4]/70 dark:border-stone-800/60">
            <span className="shrink-0 w-6 h-6 rounded-full bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900 text-xs font-bold flex items-center justify-center tabular-nums">{i + 1}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap leading-none">
                <span className="text-[10px] uppercase tracking-wider text-stone-500 dark:text-stone-400">
                  {isFinal ? 'Final breed' : isFiller ? 'Filler breed' : 'Breed'}
                </span>
                <RecipePill recipeLabels={recipeLabels} recipeId={s.recipeId} />
              </div>
              <div className="mt-0.5 font-semibold text-stone-900 dark:text-stone-100 leading-tight truncate">
                {outName} <span className="font-normal text-stone-500 dark:text-stone-400">· {s.ivs.length}×31</span>
              </div>
            </div>
            <NodeCostBadge node={s} setOverride={setOverride} recipeLabels={recipeLabels} compact />
          </div>

          {/* The IVs this step locks in (shared ones are inherited free) */}
          {s.ivs.length > 0 && (
            <div className="px-2.5 pt-2 flex flex-wrap gap-1">
              {s.ivs.map((iv) => <IVChip key={iv} iv={iv} shared={sharedSet.has(iv)} />)}
            </div>
          )}

          {/* Parents */}
          <div className="px-2.5 py-2 grid sm:grid-cols-2 gap-2">
            <ParentSlot side="Mother" parent={s.left}  item={s.leftItem}  powerItem={s.leftPowerItem}  nature={nature} setOverride={setOverride} recipeLabels={recipeLabels} />
            <ParentSlot side="Father" parent={s.right} item={s.rightItem} powerItem={s.rightPowerItem} nature={nature} setOverride={setOverride} recipeLabels={recipeLabels} />
          </div>

          {/* Footer: this breed's own consumables + fee, plus the free-IV note */}
          <div className="px-2.5 pb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-stone-600 dark:text-stone-400">
            {s.powerItems > 0 && <span>Power Items: <span className="font-mono tabular-nums font-semibold">{s.powerItems}</span></span>}
            {s.everstones > 0 && <span>Everstone: <span className="font-mono tabular-nums font-semibold">{s.everstones}</span>{nature && <span className="text-stone-500"> → {nature}</span>}</span>}
            <span>Egg fee: <span className="font-mono tabular-nums font-semibold">${formatMoney(s.eggFee)}</span></span>
            {sharedSet.size > 0 && (
              <span className="text-emerald-700 dark:text-emerald-400">✓ {formatIVList(s.sharedIVs)} inherited free (both parents carry it)</span>
            )}
          </div>
        </li>
        );
      })}
    </ol>
  );
}

// A single IV pill. Shared IVs (carried by both parents, so inherited free)
// are tinted green to set them apart from IVs locked in by a Power Item.
function IVChip({ iv, shared }) {
  return (
    <span
      title={shared ? 'Inherited free — both parents already carry this IV' : 'Locked in this step (via a Power Item)'}
      className={`px-1.5 py-px rounded text-[10px] font-semibold uppercase tracking-wide border ${
        shared
          ? 'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/60'
          : 'bg-[#f1e9d2] text-stone-700 border-[#e6dabf] dark:bg-stone-800 dark:text-stone-300 dark:border-stone-700'
      }`}
    >
      {IV_LABELS[iv] || iv}
    </span>
  );
}

/* ─────────────── Tree view ─────────────── */

const IV_SLICE_COLORS = {
  hp:  '#52c41a', // green
  atk: '#ff4d4f', // red
  def: '#fa8c16', // orange
  spa: '#722ed1', // purple
  spd: '#fadb14', // yellow
  spe: '#1890ff', // blue
};

// Layout helper: lay every node out on a tree. Each node gets {x, y}. Leaves
// occupy contiguous slots at the bottom (y = max depth); interior nodes sit
// above their children at the average x of their two parents-as-children.
function layoutTree(root) {
  // First pass: depth-first, compute depth (root at 0) and assign leaves
  // contiguous x positions.
  const positions = new Map(); // instanceId → { x, y }
  let leafIndex = 0;
  let maxDepth = 0;
  function walk(node, depth) {
    if (!node) return null;
    maxDepth = Math.max(maxDepth, depth);
    if (node.kind !== 'breed') {
      const x = leafIndex++;
      positions.set(node.instanceId, { x, y: depth });
      return x;
    }
    const lx = walk(node.left,  depth + 1);
    const rx = walk(node.right, depth + 1);
    const x = (lx + rx) / 2;
    positions.set(node.instanceId, { x, y: depth });
    return x;
  }
  walk(root, 0);
  return { positions, leafCount: leafIndex, maxDepth };
}

function BreedingTree({ node, target, nature, recipeLabels }) {
  const [hovered, setHovered] = useState(null);

  if (!node) return null;
  const { positions, leafCount, maxDepth } = useMemo(() => layoutTree(node), [node]);

  // Render dimensions.
  const NODE_R = 16;
  const COL_W = 50;
  const ROW_H = 70;
  const PAD = 30;
  const width = leafCount * COL_W + PAD * 2;
  const height = (maxDepth + 1) * ROW_H + PAD * 2;
  const xOf = (x) => PAD + x * COL_W + COL_W / 2;
  const yOf = (y) => PAD + y * ROW_H + NODE_R;

  // Collect all nodes in render order.
  const nodes = [];
  const edges = [];
  function collect(n) {
    if (!n) return;
    nodes.push(n);
    if (n.kind === 'breed') {
      collect(n.left);
      collect(n.right);
      edges.push({ parent: n, child: n.left });
      edges.push({ parent: n, child: n.right });
    }
  }
  collect(node);

  return (
    <div className="relative">
      <div className="overflow-auto rounded border border-[#e6dabf] dark:border-stone-800 bg-stone-900 dark:bg-stone-950">
        <svg width={width} height={height} className="block">
          {/* Edges first so they sit behind nodes. */}
          {edges.map((e, i) => {
            const p = positions.get(e.parent.instanceId);
            const c = positions.get(e.child.instanceId);
            if (!p || !c) return null;
            const px = xOf(p.x), py = yOf(p.y);
            const cx = xOf(c.x), cy = yOf(c.y);
            return (
              <path key={i}
                d={`M ${cx} ${cy - NODE_R} V ${(cy + py) / 2} H ${px} V ${py + NODE_R}`}
                fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth={1.5} strokeDasharray="3,3"
              />
            );
          })}
          {/* Nodes */}
          {nodes.map((n) => {
            const pos = positions.get(n.instanceId);
            if (!pos) return null;
            const cx = xOf(pos.x);
            const cy = yOf(pos.y);
            const ivs = n.ivs || [];
            const recipeInfo = recipeLabels?.get(n.recipeId);
            const recipeColor = recipeInfo ? hexFromPaletteIdx(recipeInfo.paletteIdx) : null;
            return (
              <g key={n.instanceId}
                 transform={`translate(${cx},${cy})`}
                 onMouseEnter={() => setHovered({ node: n, cx, cy })}
                 onMouseLeave={() => setHovered(null)}
                 style={{ cursor: 'pointer' }}>
                {/* recipe-color outer ring (only for duplicated recipes) */}
                {recipeColor && (
                  <circle r={NODE_R + 2.5} fill="none" stroke={recipeColor} strokeWidth={2} />
                )}
                {/* IV slices */}
                {ivs.length === 0 ? (
                  <circle r={NODE_R} fill="#3a3a3a" stroke="rgba(255,255,255,0.4)" strokeWidth={1.5} />
                ) : (
                  ivs.map((iv, i) => {
                    const slice = 360 / ivs.length;
                    const a0 = -90 + i * slice;
                    const a1 = a0 + slice;
                    const path = ivs.length === 1
                      ? `M ${-NODE_R} 0 A ${NODE_R} ${NODE_R} 0 1 1 ${NODE_R} 0 A ${NODE_R} ${NODE_R} 0 1 1 ${-NODE_R} 0 Z`
                      : `M 0 0 L ${NODE_R * Math.cos(a0 * Math.PI / 180)} ${NODE_R * Math.sin(a0 * Math.PI / 180)} A ${NODE_R} ${NODE_R} 0 ${slice > 180 ? 1 : 0} 1 ${NODE_R * Math.cos(a1 * Math.PI / 180)} ${NODE_R * Math.sin(a1 * Math.PI / 180)} Z`;
                    return <path key={iv} d={path} fill={IV_SLICE_COLORS[iv] || '#888'} />;
                  })
                )}
                <circle r={NODE_R} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={1.5} />
                {/* Nature dot */}
                {n.naturePassing && (
                  <circle r={4} cx={NODE_R - 2} cy={-NODE_R + 2} fill="#facc15" stroke="#0c0a09" strokeWidth={1} />
                )}
                {/* Override marker */}
                {n.overridden && (
                  <circle r={4} cx={-NODE_R + 2} cy={-NODE_R + 2} fill="#f59e0b" stroke="#0c0a09" strokeWidth={1} />
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-stone-600 dark:text-stone-400">
        {Object.entries(IV_SLICE_COLORS).map(([iv, color]) => (
          <span key={iv} className="inline-flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: color }} />
            {IV_LABELS[iv]}
          </span>
        ))}
        <span className="inline-flex items-center gap-1 ml-auto">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: '#facc15' }} />
          Passes nature
        </span>
      </div>

      {/* Hover tooltip */}
      {hovered && (
        <BreedNodeTooltip node={hovered.node} target={target} nature={nature} recipeLabels={recipeLabels} />
      )}
    </div>
  );
}

function hexFromPaletteIdx(idx) {
  const map = ['#3b82f6', '#10b981', '#d946ef', '#f97316', '#0ea5e9', '#f43f5e'];
  return map[idx % map.length];
}

function BreedNodeTooltip({ node, target, nature, recipeLabels }) {
  const ivs = node.ivs || [];
  const ivLabel = ivs.length > 0 ? formatIVList(ivs) : '—';
  const role = ROLE_LABELS[node.role] || 'Carrier';
  const isFiller = node.species === 'group';
  const speciesName = isFiller
    ? `Egg-group ${node.gender === 'F' ? '♀' : '♂'} filler`
    : (target?.name || 'Target');
  const recipeInfo = recipeLabels?.get(node.recipeId);
  const isLeaf = node.kind === 'leaf';
  return (
    <div className="absolute top-2 right-2 max-w-xs p-2.5 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 shadow-lg text-[11px] text-stone-800 dark:text-stone-200 space-y-1 pointer-events-none">
      <div className="flex items-center gap-1 flex-wrap">
        <div className="font-semibold text-stone-900 dark:text-stone-100">
          {speciesName} · {ivs.length}×31{node.gender === 'F' ? ' ♀' : node.gender === 'M' ? ' ♂' : ''}
        </div>
        {recipeInfo && (
          <span className="px-1 py-px rounded text-[9px] uppercase font-semibold tracking-wider"
                style={{ background: hexFromPaletteIdx(recipeInfo.paletteIdx) + '30', color: hexFromPaletteIdx(recipeInfo.paletteIdx) }}>
            Recipe {recipeInfo.letter}
          </span>
        )}
      </div>
      <div>IVs: <span className="font-semibold">{ivLabel}</span></div>
      {node.naturePassing && (
        <div className="text-amber-700 dark:text-amber-400">Passes {nature || 'nature'} via Everstone</div>
      )}
      {!isLeaf && (
        <>
          <div className="pt-1 border-t border-[#ece2c4] dark:border-stone-800">
            <div>Power Items: <span className="font-mono">{node.powerItems}</span></div>
            {node.everstones > 0 && <div>Everstone: <span className="font-mono">{node.everstones}</span></div>}
            <div>Egg fee: <span className="font-mono">${formatMoney(node.eggFee)}</span></div>
            {node.sharedIVs?.length > 0 && (
              <div className="text-stone-500 dark:text-stone-400">Matched (free): {formatIVList(node.sharedIVs)}</div>
            )}
            {node.breedUp && <div className="text-blue-600 dark:text-blue-400">Bred-up 1×31 (0×31 mom + 1×31 dad)</div>}
          </div>
        </>
      )}
      {isLeaf && (
        <div className="text-stone-500 dark:text-stone-400">{role}{node.overridden ? ' · manual buy' : ' · 1×31 buy'}</div>
      )}
      <div className="pt-1 border-t border-[#ece2c4] dark:border-stone-800 font-mono tabular-nums">
        Subtree cost: ${formatMoney(node.cost)}
      </div>
    </div>
  );
}

function ParentSlot({ side, parent, item, powerItem, nature, setOverride, recipeLabels }) {
  if (!parent) return null;
  const ivs = parent.ivs || [];
  const ivCount = ivs.length;
  const ivLabel = ivCount > 0 ? formatIVList(ivs) : '—';
  const heldLabel =
    item === 'everstone' ? `Everstone (passes ${nature || 'nature'})` :
    item === 'powerItem' ? `${POWER_ITEM_FOR[powerItem] || 'Power Item'} (locks ${IV_LABELS[powerItem] || powerItem})` :
    null;
  const roleLabel = ROLE_LABELS[parent.role] || 'Carrier';

  // Bred 1×31 carrier: rendered like a leaf with an expand chevron that
  // reveals the sub-breed (0×31 mom + 1×31 dad + Power Item + egg fee).
  if (parent.kind === 'breed' && parent.breedUp) {
    return (
      <BreedUpSlot side={side} parent={parent} ivLabel={ivLabel} ivCount={ivCount} roleLabel={roleLabel} heldLabel={heldLabel} nature={nature} setOverride={setOverride} recipeLabels={recipeLabels} />
    );
  }

  if (parent.kind === 'leaf') {
    return (
      <div className={`rounded px-2 py-1.5 border text-xs ${parent.overridden ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-300 dark:border-amber-800/60' : 'bg-[#f1e9d2] dark:bg-stone-800/40 border-[#e6dabf] dark:border-stone-700/60'}`}>
        <div className="flex items-center gap-1">
          <div className="text-[10px] uppercase tracking-wider text-stone-500 dark:text-stone-400 flex-1">{side}</div>
          <RecipePill recipeLabels={recipeLabels} recipeId={parent.recipeId} />
        </div>
        <div className="font-semibold text-stone-900 dark:text-stone-100">
          {roleLabel} · {ivCount}×31{parent.gender === 'F' ? ' ♀' : parent.gender === 'M' ? ' ♂' : ''}
        </div>
        <div className="text-[11px] text-stone-700 dark:text-stone-300">IVs: <span className="font-semibold">{ivLabel}</span></div>
        {heldLabel && <div className="text-[11px] text-amber-700 dark:text-amber-400">Hold: {heldLabel}</div>}
        <NodeCostBadge node={parent} setOverride={setOverride} recipeLabels={recipeLabels} />
      </div>
    );
  }
  // Sub-bred parent — represents a child of a deeper step.
  return (
    <div className={`rounded px-2 py-1.5 border text-xs ${parent.overridden ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-300 dark:border-amber-800/60' : 'bg-[#f1e9d2] dark:bg-stone-800/40 border-[#e6dabf] dark:border-stone-700/60'}`}>
      <div className="flex items-center gap-1">
        <div className="text-[10px] uppercase tracking-wider text-stone-500 dark:text-stone-400 flex-1">{side} · bred from earlier step</div>
        <RecipePill recipeLabels={recipeLabels} recipeId={parent.recipeId} />
      </div>
      <div className="font-semibold text-stone-900 dark:text-stone-100">{roleLabel} · {ivCount}×31{parent.gender === 'F' ? ' ♀' : parent.gender === 'M' ? ' ♂' : ''}</div>
      <div className="text-[11px] text-stone-700 dark:text-stone-300">IVs: <span className="font-semibold">{ivLabel}</span></div>
      {heldLabel && <div className="text-[11px] text-amber-700 dark:text-amber-400">Hold: {heldLabel}</div>}
      <NodeCostBadge node={parent} setOverride={setOverride} recipeLabels={recipeLabels} />
    </div>
  );
}

function BreedUpSlot({ side, parent, ivLabel, ivCount, roleLabel, heldLabel, nature, setOverride, recipeLabels }) {
  const [expanded, setExpanded] = useState(false);
  const mom = parent.left;
  const dad = parent.right;
  const stat = parent.rightPowerItem;
  return (
    <div className={`rounded px-2 py-1.5 border text-xs ${parent.overridden ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-300 dark:border-amber-800/60' : 'bg-[#f1e9d2] dark:bg-stone-800/40 border-[#e6dabf] dark:border-stone-700/60'}`}>
      <div className="flex items-center gap-1">
        <div className="text-[10px] uppercase tracking-wider text-stone-500 dark:text-stone-400 flex-1">{side} · bred 1×31</div>
        <RecipePill recipeLabels={recipeLabels} recipeId={parent.recipeId} />
        <GitFork size={11} className="text-blue-600 dark:text-blue-400" aria-label="Bred 1×31" />
        <button type="button" onClick={() => setExpanded(!expanded)}
          className="p-0.5 rounded hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-500 dark:text-stone-400"
          title={expanded ? 'Collapse sub-breed' : 'Show sub-breed'}>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
      </div>
      <div className="font-semibold text-stone-900 dark:text-stone-100">
        {roleLabel} · {ivCount}×31{parent.gender === 'F' ? ' ♀' : parent.gender === 'M' ? ' ♂' : ''}
      </div>
      <div className="text-[11px] text-stone-700 dark:text-stone-300">IVs: <span className="font-semibold">{ivLabel}</span></div>
      {heldLabel && <div className="text-[11px] text-amber-700 dark:text-amber-400">Hold: {heldLabel}</div>}
      <NodeCostBadge node={parent} setOverride={setOverride} recipeLabels={recipeLabels} />
      {expanded && (
        <div className="mt-1.5 pl-2 border-l-2 border-blue-300 dark:border-blue-800 space-y-1 text-[11px]">
          <div className="text-[10px] uppercase tracking-wider text-stone-500 dark:text-stone-400">Sub-breed</div>
          <div>
            <span className="text-stone-500 dark:text-stone-400">Mom:</span>{' '}
            {ROLE_LABELS[mom.role] || 'Carrier'} · 0×31{mom.gender === 'F' ? ' ♀' : mom.gender === 'M' ? ' ♂' : mom.gender === 'D' ? '' : ''}
            <span className="ml-1 text-stone-500 dark:text-stone-400">— species placeholder</span>
            <span className="ml-2 font-mono tabular-nums">${formatMoney(mom.cost)}</span>
          </div>
          <div>
            <span className="text-stone-500 dark:text-stone-400">Dad:</span>{' '}
            {ROLE_LABELS[dad.role] || 'Carrier'} · 1×31{dad.gender === 'F' ? ' ♀' : dad.gender === 'M' ? ' ♂' : ''} ({IV_LABELS[stat] || stat})
            <span className="ml-2 font-mono tabular-nums">${formatMoney(dad.cost)}</span>
          </div>
          <div>
            <span className="text-stone-500 dark:text-stone-400">Held by Dad:</span> {POWER_ITEM_FOR[stat] || 'Power Item'} (locks {IV_LABELS[stat] || stat})
          </div>
          {parent.eggFee > 0 && (
            <div>
              <span className="text-stone-500 dark:text-stone-400">Egg fee:</span>{' '}
              <span className="font-mono tabular-nums">${formatMoney(parent.eggFee)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NodeCostBadge({ node, setOverride, recipeLabels, compact }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [pendingScope, setPendingScope] = useState(null); // { value } when modal is open

  const dupCount = recipeLabels?.get(node.recipeId)?.count ?? 1;

  const start = (e) => {
    e?.stopPropagation();
    setDraft(String(Math.round(node.cost)));
    setEditing(true);
  };
  const cancel = () => { setEditing(false); setDraft(''); };
  const commit = () => {
    const n = Number(draft);
    if (!Number.isFinite(n) || n < 0) { setEditing(false); return; }
    setEditing(false);
    if (dupCount > 1) {
      setPendingScope({ value: n });
    } else {
      setOverride(node, 'instance', n);
    }
  };
  const reset = (e) => {
    e?.stopPropagation();
    setOverride(node, 'instance', null);
  };

  const scopeApply = (scope) => {
    setOverride(node, scope, pendingScope.value);
    setPendingScope(null);
  };
  const scopeCancel = () => setPendingScope(null);

  if (editing) {
    return (
      <div className={`flex items-center gap-1 ${compact ? 'ml-auto' : 'mt-1'}`} onClick={(e) => e.stopPropagation()}>
        <span className="text-[10px] text-stone-500 dark:text-stone-400">$</span>
        <input
          type="number" min="0" inputMode="numeric"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel(); }}
          autoFocus
          className="w-24 px-1 py-0.5 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-stone-900 dark:text-stone-100 text-[11px] tabular-nums text-right"
        />
        <button type="button" onClick={commit} className="p-0.5 rounded hover:bg-emerald-100 dark:hover:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400" title="Save override"><Check size={12} /></button>
        <button type="button" onClick={cancel} className="p-0.5 rounded hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-500 dark:text-stone-400" title="Cancel"><X size={12} /></button>
      </div>
    );
  }

  return (
    <>
      <div className={`flex items-center gap-1 ${compact ? 'ml-auto' : 'mt-1'} text-[11px]`}>
        <button type="button" onClick={start}
          className={`tabular-nums ${node.overridden ? 'text-amber-700 dark:text-amber-300 font-semibold' : 'text-stone-700 dark:text-stone-300'} hover:underline`}
          title="Click to override this cost"
        >
          ${formatMoney(node.cost)}
        </button>
        {node.overridden && (
          <>
            <span className="inline-flex items-center gap-0.5 px-1 py-px rounded bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 text-[9px] uppercase tracking-wider" title="Manually-set cost; subtree is replaced by this fixed buy price.">
              <ShoppingCart size={9} aria-label="Overridden" /> Manual buy
            </span>
            <button type="button" onClick={reset} className="p-0.5 rounded hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-500 dark:text-stone-400" title="Reset to computed cost">
              <RotateCcw size={11} />
            </button>
          </>
        )}
      </div>
      {pendingScope && (
        <OverrideScopeModal
          dupCount={dupCount}
          value={pendingScope.value}
          recipeLabel={recipeLabels?.get(node.recipeId)?.letter}
          onApply={scopeApply}
          onCancel={scopeCancel}
        />
      )}
    </>
  );
}

function OverrideScopeModal({ dupCount, value, recipeLabel, onApply, onCancel }) {
  // Auto-focus the "Only this copy" button as the safe default.
  const onlyBtnRef = useRef(null);
  useEffect(() => {
    onlyBtnRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div className="rounded-md border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900 p-4 max-w-sm w-full mx-4 shadow-xl space-y-3 text-sm" onClick={(e) => e.stopPropagation()}>
        <div className="font-semibold text-stone-900 dark:text-stone-100">
          Recipe {recipeLabel ?? ''} is used {dupCount} times
        </div>
        <div className="text-stone-600 dark:text-stone-400 text-xs">
          Apply this override (${formatMoney(value)}) to:
        </div>
        <div className="space-y-1.5">
          <button
            ref={onlyBtnRef}
            type="button"
            onClick={() => onApply('instance')}
            className="w-full text-left px-3 py-2 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 hover:bg-emerald-100 dark:hover:bg-emerald-950/40 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-stone-800 dark:text-stone-200"
          >
            <div className="font-semibold">Only this copy</div>
            <div className="text-[11px] text-stone-500 dark:text-stone-400">${formatMoney(value)} for this instance; other instances of Recipe {recipeLabel ?? ''} keep their computed cost.</div>
          </button>
          <button
            type="button"
            onClick={() => onApply('recipe')}
            className="w-full text-left px-3 py-2 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 hover:bg-blue-100 dark:hover:bg-blue-950/40 focus:outline-none focus:ring-2 focus:ring-blue-500 text-stone-800 dark:text-stone-200"
          >
            <div className="font-semibold">All copies</div>
            <div className="text-[11px] text-stone-500 dark:text-stone-400">${formatMoney(value)} × {dupCount} = ${formatMoney(value * dupCount)} total. Applies to every instance of Recipe {recipeLabel ?? ''}.</div>
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="w-full text-left px-3 py-2 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 hover:bg-stone-200 dark:hover:bg-stone-800 text-stone-700 dark:text-stone-300"
          >
            <div className="font-semibold">Cancel</div>
          </button>
        </div>
      </div>
    </div>
  );
}

function formatIVList(ivs) {
  if (!ivs || ivs.length === 0) return '—';
  return ivs.map((k) => IV_LABELS[k] || k).join(' + ');
}

// Walk the per-instance tree depth-first and emit a flat list of breed steps
// in execution order (deepest steps first, root last). NO dedup — every
// occurrence is a real breed event because parents are consumed in PokeMMO.
// 1×31 breed-ups are excluded by default (shown inline in their parent slot
// via the chevron); pass includeBreedUps=true (e.g. for the Costs tab's
// per-step table) to list them alongside main steps.
function flattenSteps(root, includeBreedUps = false) {
  const out = [];
  function walk(node) {
    if (!node || node.kind !== 'breed') return;
    walk(node.left);
    walk(node.right);
    if (includeBreedUps || !node.breedUp) out.push(node);
  }
  walk(root);
  return out;
}

/* ─────────────── Costs tab ─────────────── */

function CostsTab({ plan, target, form }) {
  if (!plan) return <Empty msg="Build a plan first on the IV Plan tab." />;
  const steps = flattenSteps(plan.node, /*includeBreedUps=*/true);
  const leafGroups = [...aggregateLeaves(plan.node).values()]
    .sort((a, b) => (b.count * b.cost) - (a.count * a.cost) || a.ivs.length - b.ivs.length);
  const leafTotal = leafGroups.reduce((s, g) => s + g.count * g.cost, 0);
  const leafCount = leafGroups.reduce((s, g) => s + g.count, 0);
  const items  = plan.counts;
  return (
    <div className="space-y-3">
      {!anyCarrierPriced(form.prices) && <PricesNotSetNote />}
      <FormCard title={`Shopping list — ${leafCount} parent${leafCount === 1 ? '' : 's'} to acquire`}>
        <ul className="text-sm divide-y divide-[#ece2c4] dark:divide-stone-800/60">
          {leafGroups.map((g, i) => {
            const ivCount = g.ivs.length;
            const role = ROLE_LABELS[g.role] || 'Carrier';
            return (
              <li key={i} className="flex items-baseline gap-2 py-1">
                <span className="font-mono tabular-nums font-semibold text-stone-900 dark:text-stone-100 w-8 shrink-0">{g.count}×</span>
                <span className="flex-1 min-w-0">
                  {role} · {ivCount}×31{g.gender === 'F' ? ' ♀' : g.gender === 'M' ? ' ♂' : ''}
                  {ivCount > 0 && <span className="text-stone-500 dark:text-stone-400"> ({formatIVList(g.ivs)})</span>}
                  {g.overridden && <span className="ml-1 px-1 py-px rounded bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 text-[9px] uppercase tracking-wider">Overridden</span>}
                </span>
                <span className="text-xs text-stone-400 dark:text-stone-500 tabular-nums hidden sm:inline">${formatMoney(g.cost)} ea</span>
                <span className="font-mono tabular-nums text-stone-700 dark:text-stone-300 w-20 text-right">${formatMoney(g.count * g.cost)}</span>
              </li>
            );
          })}
        </ul>
        <div className="mt-2 pt-2 border-t border-[#ece2c4] dark:border-stone-800/60 flex items-baseline justify-between text-sm">
          <span className="text-stone-500 dark:text-stone-400">Parents subtotal</span>
          <span className="font-mono tabular-nums font-semibold text-stone-900 dark:text-stone-100">${formatMoney(leafTotal)}</span>
        </div>
      </FormCard>

      <FormCard title="Consumables">
        <div className="text-sm space-y-1">
          <Row label={`Power Items × ${items.powerItems}`} value={items.powerItems * (form.consumables.powerItem || 0)} />
          <Row label={`Everstones × ${items.everstones}`}  value={items.everstones * (form.consumables.everstone || 0)} />
        </div>
      </FormCard>

      <FormCard title="Per-step cost">
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm">
            <thead className="text-xs text-stone-500 dark:text-stone-400">
              <tr>
                <th className="px-1 py-1 text-left">Step</th>
                <th className="px-1 py-1 text-left">Output</th>
                <th className="px-1 py-1 text-right">Items</th>
                <th className="px-1 py-1 text-right">Egg fee</th>
                <th className="px-1 py-1 text-right">Step cost</th>
              </tr>
            </thead>
            <tbody>
              {steps.map((s, i) => {
                const stepOnly = (s.powerItems * form.consumables.powerItem) + (s.everstones * form.consumables.everstone) + s.eggFee;
                return (
                  <tr key={s.id + ':' + i} className="border-t border-[#ece2c4] dark:border-stone-800/60">
                    <td className="px-1 py-1 tabular-nums">{i + 1}</td>
                    <td className="px-1 py-1 text-stone-700 dark:text-stone-300">
                      {s.species === 'group' ? `Egg-group ${s.gender === 'F' ? '♀' : '♂'} filler` : target.name} {s.ivs.length}×31
                      {s.ivs.length > 0 && <span className="text-stone-500 dark:text-stone-400"> ({formatIVList(s.ivs)})</span>}
                      {s.breedUp && <span className="ml-1 text-[10px] uppercase tracking-wider text-blue-600 dark:text-blue-400">· breed-up</span>}
                    </td>
                    <td className="px-1 py-1 text-right tabular-nums">{s.powerItems} PI{s.everstones ? ` + ${s.everstones} ES` : ''}</td>
                    <td className="px-1 py-1 text-right tabular-nums">${formatMoney(s.eggFee)}</td>
                    <td className="px-1 py-1 text-right tabular-nums font-semibold text-stone-900 dark:text-stone-100">${formatMoney(stepOnly)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </FormCard>

      <div className="rounded-md border border-emerald-300 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 p-3 flex items-baseline justify-between">
        <span className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">Total cost</span>
        <span className="font-mono tabular-nums text-2xl font-bold text-emerald-900 dark:text-emerald-100">${formatMoney(plan.totalCost)}</span>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-stone-700 dark:text-stone-300">{label}</span>
      <span className="font-mono tabular-nums">${formatMoney(value)}</span>
    </div>
  );
}

// Aggregate the leaf carriers you must ACQUIRE (cost > 0) into a shopping
// list — identical buys (same role / IV set / gender / price) collapse into
// one row with a count, instead of one row per breed-tree occurrence.
function aggregateLeaves(node, map = new Map()) {
  if (!node) return map;
  if (node.kind === 'leaf') {
    if (node.cost > 0) {
      const ivs = node.ivs || [];
      const key = `${node.role}|${ivs.join(',')}|${node.gender}|${node.cost}|${node.overridden ? 1 : 0}`;
      const e = map.get(key);
      if (e) e.count += 1;
      else map.set(key, { count: 1, role: node.role, ivs, gender: node.gender, cost: node.cost, overridden: node.overridden });
    }
    return map;
  }
  aggregateLeaves(node.left, map);
  aggregateLeaves(node.right, map);
  return map;
}

/* ─────────────── Profit tab ─────────────── */

function ProfitTab({ plan, salePrice, setSalePrice }) {
  if (!plan) return <Empty msg="Build a plan first on the IV Plan tab." />;
  const sale = Number(salePrice) || 0;
  const cost = plan.totalCost;
  const profit = sale - cost;
  const roi = cost > 0 ? (profit / cost) * 100 : 0;
  return (
    <div className="space-y-3 max-w-md">
      <FormCard title="Sale">
        <label className="block text-xs text-stone-500 dark:text-stone-400">Expected sale price ($)</label>
        <input type="number" min="0" value={salePrice} onChange={(e) => setSalePrice(e.target.value)}
          className="mt-1 w-full px-2 py-1.5 rounded-md border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-stone-900 dark:text-stone-100 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </FormCard>
      <FormCard title="Result">
        <div className="space-y-1 text-sm">
          <Row label="Total cost" value={cost} />
          <Row label="Sale price" value={sale} />
          <div className="flex items-center justify-between pt-1 border-t border-[#ece2c4] dark:border-stone-800/60">
            <span className="text-stone-700 dark:text-stone-300 font-semibold">Profit</span>
            <span className={`font-mono tabular-nums text-lg font-bold ${profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              {profit >= 0 ? '+' : '−'}${formatMoney(Math.abs(profit))}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-stone-700 dark:text-stone-300">ROI</span>
            <span className={`font-mono tabular-nums ${roi >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{roi.toFixed(1)}%</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-stone-700 dark:text-stone-300">Break-even price</span>
            <span className="font-mono tabular-nums">${formatMoney(cost)}</span>
          </div>
        </div>
      </FormCard>
    </div>
  );
}

/* ─────────────── Saved Projects tab ─────────────── */

/* ─────────────── "I Have" (owned breeders) tab ─────────────── */

// Work out how an owned breeder of a specific SPECIES can be used against the
// current target: its role (target / egg-group filler / ditto), the gender it
// breeds as, and whether it's usable at all (with a human reason if not).
//
// The key gotchas this surfaces:
//   - female-only species (Kangaskhan, Miltank, …) only ever produce more of
//     themselves, so they can't be an egg-group filler for another species;
//   - genderless species only breed within their own line or with Ditto;
//   - a species in a different egg group simply can't breed with the target.
function breederCompat(species, target) {
  if (!species) return { usable: false, error: 'Pick the species' };
  if (species.id === 132) return { role: 'ditto', gender: 'D', usable: true }; // Ditto
  if (!target) return { usable: false, error: 'Pick a target species first' };

  const cat = genderRatioCategory(species);
  const sameSpecies = species.id === target.id;
  let role = 'target';
  if (!sameSpecies) {
    const sg = (species.egg_groups || []).map((g) => String(g).toLowerCase());
    const tg = (target.egg_groups || []).map((g) => String(g).toLowerCase());
    if (!sg.some((g) => tg.includes(g))) {
      return { usable: false, role: 'group', error: `Different egg group from ${target.name} — they can't breed together.` };
    }
    role = 'group';
  }

  if (cat === 'genderless') {
    if (!sameSpecies) return { usable: false, role, gender: 'N', error: `${species.name} is genderless — it only breeds within its own line or with Ditto.` };
    return { role, gender: 'N', usable: true };
  }
  if (cat === 'female-only') {
    if (!sameSpecies) return { usable: false, role, gender: 'F', error: `${species.name} is female-only — it only ever produces more ${species.name}, so it can't be a parent for ${target.name}.` };
    return { role, gender: 'F', usable: true, warn: `${species.name} is female-only.` };
  }
  if (cat === 'male-only') {
    return { role, gender: 'M', usable: true, warn: sameSpecies ? null : `${species.name} is male-only — usable only as a ♂ parent.` };
  }
  // Mixed-gender species: caller supplies the chosen ♀/♂ (gender === null here).
  return { role, gender: null, usable: true };
}

function HaveTab({ data, plan, target, breederPokemon, inventory, shiny, alpha, onAdd, onRemove, onUpdate }) {
  if (!target) return <Empty msg="Pick a target species on the IV Plan tab first." />;
  if (!plan)   return <Empty msg="Target at least one IV first — there's nothing to match against yet." />;

  const byId = useMemo(() => new Map(data.pokemon.map((p) => [p.id, p])), [data.pokemon]);

  // Evaluate each owned breeder against the target: species compatibility, then
  // the shiny/alpha gate. Only usable ones go to the matcher.
  const evals = useMemo(() => inventory.map((b) => {
    const species = b.monId != null ? byId.get(b.monId) : null;
    const compat = breederCompat(species, target);
    let usable = compat.usable;
    let reason = compat.error || null;
    if (usable) {
      if (shiny && !b.shiny)        { usable = false; reason = 'Target is shiny — only shiny breeders qualify (shinies only breed with shinies).'; }
      else if (!shiny && b.shiny)   { usable = false; reason = 'This is shiny but the target isn’t — shinies only breed with shinies.'; }
      else if (alpha && !b.alpha)   { usable = false; reason = 'Target is Alpha — both parents of every breed must be Alpha.'; }
    }
    const gender = compat.gender ?? b.gender; // mixed species use the chosen ♀/♂
    const matcher = usable ? { id: b.id, ivs: IV_KEYS.filter((k) => b.ivs[k]), gender, role: compat.role, nature: !!b.nature } : null;
    return { b, species, compat, usable, reason, warn: compat.warn, matcher };
  }), [inventory, byId, target, shiny, alpha]);

  const matched = useMemo(
    () => matchInventory(plan.node, evals.filter((e) => e.usable).map((e) => e.matcher)),
    [plan.node, evals]
  );
  const matchedIds = useMemo(() => new Set(matched.matches.map((m) => m.breeder.id)), [matched]);
  const remaining = useMemo(
    () => [...aggregateLeaves(matched.node).values()].sort((a, b) => (b.count * b.cost) - (a.count * a.cost)),
    [matched.node]
  );
  const remainingTotal = remaining.reduce((s, g) => s + g.count * g.cost, 0);

  // Breeders that contributed nothing — either unusable, or usable but no node
  // fit — each with a human reason.
  const notUsed = evals
    .filter((e) => !matchedIds.has(e.b.id))
    .map((e) => ({ e, reason: e.usable ? "didn't fit any node in this plan" : (e.reason || 'unusable') }));

  return (
    <div className="space-y-3">
      <div className="text-xs text-stone-500 dark:text-stone-400">
        List breeders you already own — pick each one's species so the planner knows its egg group, gender, and quirks.
        It then claims each against the most expensive matching node and prunes that branch.
      </div>

      <FormCard
        title={`Your breeders (${inventory.length})`}
        action={
          <button type="button" onClick={onAdd}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 hover:bg-[#ece2c4] dark:hover:bg-stone-800 text-xs">
            + Add breeder
          </button>
        }
      >
        {inventory.length === 0 ? (
          <div className="text-sm text-stone-500 dark:text-stone-400 py-2">No breeders yet. Add the ones in your box to see what they save.</div>
        ) : (
          <div className="space-y-2">
            {evals.map((e) => (
              <BreederRow key={e.b.id} b={e.b} breederPokemon={breederPokemon} info={e} onRemove={onRemove} onUpdate={onUpdate} />
            ))}
          </div>
        )}
      </FormCard>

      {inventory.length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Base cost" value={plan.totalCost} />
            <Stat label="With your breeders" value={matched.node.cost} accent />
            <Stat label="Saved" value={matched.savings} good />
          </div>

          {matched.matches.length > 0 && (
            <FormCard title={`Matched (${matched.matches.length})`}>
              <ul className="text-sm divide-y divide-[#ece2c4] dark:divide-stone-800/60">
                {matched.matches.map((m, i) => {
                  const sp = byId.get(m.breeder.id ? (inventory.find((x) => x.id === m.breeder.id)?.monId) : null);
                  return (
                    <li key={i} className="flex items-baseline gap-2 py-1">
                      <span className="flex-1 min-w-0">
                        {sp ? sp.name : SPECIES_TXT(m.species)} · {m.ivs.length}×31 {m.gender === 'F' ? '♀' : m.gender === 'M' ? '♂' : m.gender === 'D' ? '' : ''}
                        {m.ivs.length > 0 && <span className="text-stone-500 dark:text-stone-400"> ({formatIVList(m.ivs)})</span>}
                      </span>
                      <span className="font-mono tabular-nums text-emerald-600 dark:text-emerald-400">−${formatMoney(m.saved)}</span>
                    </li>
                  );
                })}
              </ul>
            </FormCard>
          )}

          {notUsed.length > 0 && (
            <FormCard title={`Not used (${notUsed.length})`}>
              <ul className="text-xs space-y-1">
                {notUsed.map(({ e, reason }, i) => (
                  <li key={i} className="flex items-baseline gap-2">
                    <span className="text-stone-700 dark:text-stone-300 shrink-0">{e.species ? e.species.name : 'Breeder'}</span>
                    <span className="text-amber-700 dark:text-amber-400">{reason}</span>
                  </li>
                ))}
              </ul>
            </FormCard>
          )}

          <FormCard title="Still to acquire">
            {remaining.length === 0 ? (
              <div className="text-sm text-emerald-700 dark:text-emerald-400 py-1">Nothing — your breeders cover the whole tree! 🎉</div>
            ) : (
              <>
                <ul className="text-sm divide-y divide-[#ece2c4] dark:divide-stone-800/60">
                  {remaining.map((g, i) => (
                    <li key={i} className="flex items-baseline gap-2 py-1">
                      <span className="font-mono tabular-nums font-semibold w-8 shrink-0">{g.count}×</span>
                      <span className="flex-1 min-w-0">
                        {ROLE_LABELS[g.role] || 'Carrier'} · {g.ivs.length}×31{g.gender === 'F' ? ' ♀' : g.gender === 'M' ? ' ♂' : ''}
                        {g.ivs.length > 0 && <span className="text-stone-500 dark:text-stone-400"> ({formatIVList(g.ivs)})</span>}
                      </span>
                      <span className="font-mono tabular-nums text-stone-700 dark:text-stone-300 w-20 text-right">${formatMoney(g.count * g.cost)}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 pt-2 border-t border-[#ece2c4] dark:border-stone-800/60 flex items-baseline justify-between text-sm">
                  <span className="text-stone-500 dark:text-stone-400">Remaining parents subtotal</span>
                  <span className="font-mono tabular-nums font-semibold">${formatMoney(remainingTotal)}</span>
                </div>
              </>
            )}
          </FormCard>
        </>
      )}
    </div>
  );
}

function SPECIES_TXT(s) {
  return s === 'target' ? 'target' : s === 'group' ? 'egg-group' : s === 'ditto' ? '' : s;
}

function Stat({ label, value, accent, good }) {
  return (
    <div className={`rounded-md border p-2.5 ${good ? 'border-emerald-300 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20' : 'border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900'}`}>
      <div className="text-[10px] uppercase tracking-wider text-stone-500 dark:text-stone-400">{label}</div>
      <div className={`font-mono tabular-nums font-bold ${good ? 'text-emerald-700 dark:text-emerald-300' : accent ? 'text-stone-900 dark:text-stone-100' : 'text-stone-700 dark:text-stone-300'} text-lg`}>${formatMoney(value)}</div>
    </div>
  );
}

function BreederRow({ b, breederPokemon, info, onRemove, onUpdate }) {
  const compat = info.compat;
  const isMixed = compat.gender == null && info.species && info.species.id !== 132; // show ♀/♂ toggle
  const fixedGenderLabel = !info.species ? null
    : compat.gender === 'D' ? 'Ditto'
    : compat.gender === 'N' ? 'Genderless'
    : compat.gender === 'F' ? '♀ (female-only)'
    : compat.gender === 'M' ? '♂ (male-only)'
    : null;

  return (
    <div className={`rounded-md border p-2 space-y-2 ${info.usable ? 'border-[#e6dabf] dark:border-stone-800 bg-[#f1e9d2] dark:bg-stone-950/40' : 'border-amber-300 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20'}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <PokemonPicker
            pokemon={breederPokemon}
            value={b.monId}
            onChange={(id) => onUpdate(b.id, { monId: id })}
            placeholder="Pick this breeder's species"
          />
        </div>
        <button type="button" onClick={() => onRemove(b.id)}
          className="p-1 rounded text-stone-400 hover:text-red-600 dark:hover:text-red-400 shrink-0" title="Remove">
          <Trash2 size={14} />
        </button>
      </div>

      <div className="flex flex-wrap gap-1">
        {IV_KEYS.map((k) => (
          <button key={k} type="button"
            onClick={() => onUpdate(b.id, { ivs: { ...b.ivs, [k]: !b.ivs[k] } })}
            aria-pressed={b.ivs[k]}
            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase border transition-colors ${
              b.ivs[k] ? 'bg-emerald-500 text-white border-emerald-600' : 'bg-[#fdf8e9] dark:bg-stone-900 text-stone-500 dark:text-stone-400 border-[#d6c8a3] dark:border-stone-700'
            }`}>{IV_LABELS[k]}</button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {isMixed ? (
          <div className="inline-flex rounded border border-[#d6c8a3] dark:border-stone-700 overflow-hidden">
            {['F', 'M'].map((g) => (
              <button key={g} type="button" onClick={() => onUpdate(b.id, { gender: g })}
                className={`px-2 py-0.5 ${b.gender === g ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900' : 'text-stone-600 dark:text-stone-400'}`}>
                {g === 'F' ? '♀' : '♂'}
              </button>
            ))}
          </div>
        ) : fixedGenderLabel ? (
          <span className="text-stone-500 dark:text-stone-400">{fixedGenderLabel}</span>
        ) : null}
        <label className="inline-flex items-center gap-1 text-stone-700 dark:text-stone-300 cursor-pointer">
          <input type="checkbox" checked={b.nature} onChange={(e) => onUpdate(b.id, { nature: e.target.checked })} className="accent-blue-500" />
          nature
        </label>
        <label className="inline-flex items-center gap-1 text-stone-700 dark:text-stone-300 cursor-pointer">
          <input type="checkbox" checked={b.shiny} onChange={(e) => onUpdate(b.id, { shiny: e.target.checked })} className="accent-yellow-500" />
          shiny
        </label>
        <label className="inline-flex items-center gap-1 text-stone-700 dark:text-stone-300 cursor-pointer">
          <input type="checkbox" checked={b.alpha} onChange={(e) => onUpdate(b.id, { alpha: e.target.checked })} className="accent-red-500" />
          alpha
        </label>
      </div>

      {(info.reason || info.warn) && (
        <div className={`text-[11px] ${info.usable ? 'text-amber-700 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>
          {info.reason || info.warn}
        </div>
      )}
    </div>
  );
}

function SavedProjectsTab({ data, projects, onOpen, onDuplicate, onDelete }) {
  if (projects.length === 0) return <Empty msg="No saved projects yet. Save one from the IV Plan tab." />;
  return (
    <div className="space-y-2">
      {projects.map((p) => {
        const target = p.target ? data.pokemon.find((x) => x.id === p.target.id) : null;
        const date = p.createdAt || p.savedAt;
        return (
          <div key={p.id} className="rounded-md border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900 p-3 flex items-center gap-3">
            {target && <PokemonSprite pokemon={target} variant="animated" className="w-10 h-10 object-contain" />}
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-stone-900 dark:text-stone-100 truncate">{p.name}</div>
              <div className="text-xs text-stone-500 dark:text-stone-400">
                {p.computedTotalCost != null && <>Saved cost ${formatMoney(p.computedTotalCost)} · </>}
                {date && new Date(date).toLocaleDateString()}
              </div>
            </div>
            <button onClick={() => onOpen(p.id)}      title="Open"      className="p-1.5 rounded hover:bg-[#ece2c4] dark:hover:bg-stone-800 text-stone-700 dark:text-stone-300"><FolderOpen size={16} /></button>
            <button onClick={() => onDuplicate(p.id)} title="Duplicate" className="p-1.5 rounded hover:bg-[#ece2c4] dark:hover:bg-stone-800 text-stone-700 dark:text-stone-300"><Copy size={16} /></button>
            <button onClick={() => { if (confirm('Delete this project?')) onDelete(p.id); }} title="Delete" className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-950/40 text-red-600 dark:text-red-400"><Trash2 size={16} /></button>
          </div>
        );
      })}
    </div>
  );
}

function SaveButton({ onSave }) {
  return (
    <button
      type="button"
      onClick={() => { const name = prompt('Project name:'); if (name !== null) onSave(name); }}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 hover:bg-[#ece2c4] dark:hover:bg-stone-800 text-sm text-stone-700 dark:text-stone-300"
    >
      <Save size={14} /> Save project
    </button>
  );
}

/* ─────────────── Toast ─────────────── */

function Toast({ toast, onClose }) {
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(onClose, 3500);
    return () => clearTimeout(id);
  }, [toast, onClose]);
  if (!toast) return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-3 py-2 rounded-md border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 shadow-lg flex items-center gap-2 text-sm text-stone-700 dark:text-stone-200">
      <Info size={14} className="text-blue-600 dark:text-blue-400" />
      <span>{toast}</span>
      <button onClick={onClose} className="p-0.5 rounded hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-500 dark:text-stone-400"><X size={12} /></button>
    </div>
  );
}

function showToast(setToast, msg) {
  setToast(msg);
}

/* ─────────────── Misc helpers ─────────────── */

function Empty({ msg }) {
  return <div className="py-16 text-center text-sm text-stone-500 dark:text-stone-400">{msg}</div>;
}
function formatMoney(n) {
  if (!Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString();
}
function autoProjectName(target, ivList, nature) {
  if (!target) return 'Untitled project';
  const ivPart = ivList.length > 0 ? `${ivList.length}×31` : 'no-IV';
  return `${ivPart}${nature ? ' ' + nature : ''} ${target.name}`;
}

function loadProjects() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LS_PROJECTS_V2);
    if (!raw) return [];
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
function saveProjects(list) {
  try { localStorage.setItem(LS_PROJECTS_V2, JSON.stringify(list)); } catch {}
}

// Migrate v1 projects (carrier-table schema) to v2 (per-stat schema). Best effort:
// fan the old generic carrier price out to every stat in the new schema.
function migrateV1IfNeeded() {
  if (typeof window === 'undefined') return { migrated: 0 };
  try {
    if (localStorage.getItem(LS_PROJECTS_V2)) return { migrated: 0 }; // already migrated/saved
    const raw = localStorage.getItem(LS_PROJECTS_V1);
    if (!raw) return { migrated: 0 };
    const v1 = JSON.parse(raw);
    if (!Array.isArray(v1) || v1.length === 0) return { migrated: 0 };
    const v2 = v1.map((p) => {
      const oldForm = p.form || {};
      const oldPrices = oldForm.prices || {};
      const perStat = clonePrices(DEFAULT_PER_STAT_PRICES);
      // Map old generic carrier prices (1×31 column = index 0) to every stat.
      for (const stat of IV_KEYS) {
        if (Number.isFinite(oldPrices.targetF?.[0])) perStat[stat].targetF = oldPrices.targetF[0];
        if (Number.isFinite(oldPrices.targetM?.[0])) perStat[stat].targetM = oldPrices.targetM[0];
        if (Number.isFinite(oldPrices.groupM?.[0]))  perStat[stat].groupM  = oldPrices.groupM[0];
        if (Number.isFinite(oldPrices.ditto?.[0]))   perStat[stat].ditto   = oldPrices.ditto[0];
        // Genderless tier reuses the targetF column.
        perStat[stat].target = oldPrices.targetF?.[0] ?? DEFAULT_PER_STAT_PRICES[stat].target;
      }
      return {
        id: p.id || ('p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)),
        name: p.name || 'Migrated project',
        createdAt: p.savedAt || new Date().toISOString(),
        target: p.target || null,
        inputs: {
          ivs: oldForm.ivs ? { ...oldForm.ivs } : { ...DEFAULT_FORM.ivs },
          nature: oldForm.nature || '',
          ability: null,
          moves: [],
          targetGender: oldForm.targetGender || 'F',
          guaranteeGender: oldForm.guaranteeGender !== false,
          shiny: false,
        },
        prices: perStat,
        basePrices: { ...DEFAULT_BASE_PRICES },
        consumables: oldForm.itemPrices
          ? { powerItem: oldForm.itemPrices.powerItem ?? DEFAULT_CONSUMABLE_PRICES.powerItem,
              everstone: oldForm.itemPrices.everstone ?? DEFAULT_CONSUMABLE_PRICES.everstone }
          : { ...DEFAULT_CONSUMABLE_PRICES },
        // v1 leaf-identity overrides don't translate to v2 node ids — drop them.
        overrides: {},
        computedTotalCost: p.totalCost ?? null,
        salePrice: p.salePrice != null ? Number(p.salePrice) : null,
      };
    });
    localStorage.setItem(LS_PROJECTS_V2, JSON.stringify(v2));
    // Keep v1 around in case the user wants to manually inspect; the migration
    // is a one-shot guarded by the v2-key presence check above.
    return { migrated: v2.length };
  } catch {
    return { migrated: 0 };
  }
}
