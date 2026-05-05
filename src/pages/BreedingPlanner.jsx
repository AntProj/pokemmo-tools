import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sun, Moon, RotateCcw, Save, Trash2, Copy, FolderOpen, Info, X, Check, ShoppingCart } from 'lucide-react';
import PokemonPicker from '../components/PokemonPicker.jsx';
import TypeBadge from '../components/TypeBadge.jsx';
import { typeColor } from '../lib/types.js';
import { dexNum } from '../lib/format.js';
import {
  IV_KEYS, IV_LABELS, NATURE_NAMES, POWER_ITEM_FOR,
  DEFAULT_PER_STAT_PRICES, DEFAULT_CONSUMABLE_PRICES, DEFAULT_BASE_PRICES,
  canBreed, isGenderless, genderRatioCategory,
} from '../lib/breeding/data.js';
import {
  planBreeding, ROLE_LABELS, ROLE_TIERS_FOR_SPECIES, TIER_LABELS,
} from '../lib/breeding/optimizer.js';
import { ChevronRight, ChevronDown, GitFork } from 'lucide-react';

const SUB_TABS = [
  { key: 'plan',    label: 'IV Plan' },
  { key: 'costs',   label: 'Costs'   },
  { key: 'profit',  label: 'Profit'  },
  { key: 'saved',   label: 'Saved'   },
];

const LS_PROJECTS_V2 = 'breeding_projects:v2';
const LS_PROJECTS_V1 = 'breeding_projects:v1';

const DEFAULT_FORM = {
  monId: null,
  ivs: { hp: false, atk: false, def: false, spa: false, spd: false, spe: false },
  nature: '',
  guaranteeGender: true,
  targetGender: 'F',
  prices: clonePrices(DEFAULT_PER_STAT_PRICES),
  basePrices: { ...DEFAULT_BASE_PRICES },
  consumables: { ...DEFAULT_CONSUMABLE_PRICES },
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
  // Hydrate against defaults so projects saved before a new role tier (e.g.
  // groupF) was added still get a price for it.
  const out = {};
  for (const stat of IV_KEYS) {
    out[stat] = { ...DEFAULT_PER_STAT_PRICES[stat], ...(src?.[stat] || {}) };
  }
  return out;
}

function cloneBasePrices(src) {
  return { ...DEFAULT_BASE_PRICES, ...(src || {}) };
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
  const target = useMemo(
    () => (form.monId != null ? data.pokemon.find((p) => p.id === form.monId) : null),
    [form.monId, data.pokemon]
  );
  const targetIVs = useMemo(() => IV_KEYS.filter((k) => form.ivs[k]), [form.ivs]);
  const speciesCat = target ? genderRatioCategory(target) : 'mixed';
  const visibleTiers = ROLE_TIERS_FOR_SPECIES[speciesCat] || ROLE_TIERS_FOR_SPECIES.mixed;

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
      return { ...f, overrides: { byInstance: {}, byRecipe: {} }, targetGender: g };
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
    setForm((f) => ({ ...f, prices: clonePrices(DEFAULT_PER_STAT_PRICES), basePrices: { ...DEFAULT_BASE_PRICES }, overrides: { byInstance: {}, byRecipe: {} } }));
    showToast(setToast, 'Prices reset to defaults.');
  }, []);

  const saveProject = useCallback((name) => {
    const proj = {
      id: 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      name: name || autoProjectName(target, targetIVs, form.nature),
      createdAt: new Date().toISOString(),
      target: target ? { id: target.id, name: target.name } : null,
      inputs: {
        ivs: { ...form.ivs },
        nature: form.nature, ability: null, moves: [],
        targetGender: form.targetGender, guaranteeGender: form.guaranteeGender, shiny: false,
      },
      prices: clonePrices(form.prices),
      basePrices: { ...form.basePrices },
      consumables: { ...form.consumables },
      overrides: normalizeOverrides(form.overrides),
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
      guaranteeGender: p.inputs?.guaranteeGender !== false,
      targetGender: p.inputs?.targetGender || 'F',
      prices: p.prices ? clonePrices(p.prices) : clonePrices(DEFAULT_PER_STAT_PRICES),
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
          </FormCard>

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
          {tab === 'plan'   && <IVPlanTab target={target} plan={planResult} form={form} setOverride={setOverride} onSave={saveProject} />}
          {tab === 'costs'  && <CostsTab plan={planResult} target={target} form={form} />}
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

function SpeciesSummary({ pokemon }) {
  const primary = typeColor(pokemon.types[0]).bg;
  const cat = genderRatioCategory(pokemon);
  const note = cat === 'female-only' ? 'Female-only — male slot uses egg-group ♂'
             : cat === 'male-only'   ? 'Male-only — female slot uses Ditto'
             : cat === 'genderless'  ? 'Genderless — slots are line members or Ditto'
             : null;
  return (
    <div className="flex items-start gap-2">
      <div className="relative shrink-0 w-12 h-12 rounded-md overflow-hidden flex items-center justify-center"
           style={{ background: `radial-gradient(circle at 50% 50%, ${primary}26 0%, ${primary}14 70%, ${primary}0a 100%)` }}>
        <img src={pokemon.sprite} alt={pokemon.name} loading="lazy" decoding="async" className="pixelated w-11 h-11 object-contain" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5"><span className="font-mono text-[11px] text-stone-500">{dexNum(pokemon.id)}</span><span className="font-semibold text-stone-900 dark:text-stone-100">{pokemon.name}</span></div>
        <div className="mt-0.5 flex flex-wrap gap-1">{[...new Set(pokemon.types)].map((t) => <TypeBadge key={t} type={t} />)}</div>
        {note && <div className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">⚠ {note}</div>}
      </div>
    </div>
  );
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
      <table className="w-full text-xs table-fixed">
        <thead className="text-stone-500 dark:text-stone-400 align-bottom">
          <tr>
            <th className="px-0.5 py-1 text-left font-normal w-7">Stat</th>
            {tiers.map((t) => (
              <th key={t} className="px-0.5 py-1 text-right font-normal leading-tight">{TIER_LABELS[t]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stats.map((stat) => (
            <tr key={stat}>
              <td className="px-0.5 py-0.5 text-stone-700 dark:text-stone-300 font-semibold">{IV_LABELS[stat]}</td>
              {tiers.map((tier) => (
                <td key={tier} className="px-0.5 py-0.5">
                  <PriceInput value={prices[stat][tier]} defaultValue={DEFAULT_PER_STAT_PRICES[stat][tier]} onChange={(v) => onChange(stat, tier, v)} />
                </td>
              ))}
            </tr>
          ))}
          <tr className="border-t border-[#ece2c4] dark:border-stone-800/60">
            <td className="px-0.5 py-0.5 text-stone-700 dark:text-stone-300 font-semibold whitespace-nowrap">0×31</td>
            {tiers.map((tier) => (
              <td key={tier} className="px-0.5 py-0.5">
                <PriceInput value={basePrices?.[tier]} defaultValue={DEFAULT_BASE_PRICES[tier]} onChange={(v) => onChangeBase(tier, v)} />
              </td>
            ))}
          </tr>
        </tbody>
      </table>
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

function PriceInput({ value, defaultValue, onChange }) {
  const isDefault = Number(value) === Number(defaultValue);
  return (
    <input
      type="number" min="0"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={defaultValue?.toLocaleString()}
      className={`w-full min-w-0 px-1 py-1 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-stone-900 dark:text-stone-100 text-[13px] tabular-nums text-right ${isDefault ? '' : 'font-bold'}`}
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
        Planner v2 covers IV + nature optimization with per-stat 1×31 pricing, recursive intermediate breeding (no buy at 2×31+ tiers), accurate egg fees, and per-node cost overrides. Hidden Ability tracing, egg-move chains, Volt Tackle, Incense babies, owned-parent reuse, and SVG tree visualization are deferred.
      </span>
    </div>
  );
}

/* ─────────────── IV Plan tab ─────────────── */

function IVPlanTab({ target, plan, form, setOverride, onSave }) {
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

      <BreedingPlanView plan={plan} target={target} nature={form.nature} setOverride={setOverride} recipeLabels={recipeLabels} />
    </div>
  );
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
    <ol className="space-y-2 text-sm">
      {steps.map((s, i) => {
        const isFiller = s.species === 'group';
        const fillerGender = s.gender === 'F' ? '♀' : s.gender === 'M' ? '♂' : '';
        const producesLabel = isFiller
          ? `→ produces an egg-group ${fillerGender} filler at ${s.ivs.length}×31`
          : `→ produces ${target.name} at ${s.ivs.length}×31${s.gender === 'F' ? ' ♀' : s.gender === 'M' ? ' ♂' : ''}`;
        return (
        <li key={s.instanceId} className={`rounded border p-2 ${isFiller ? 'border-amber-300 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20' : 'border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900'}`}>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">Step {i + 1}{isFiller ? ' · filler' : ''}</span>
            <span className="text-stone-700 dark:text-stone-300 text-xs">
              {producesLabel}
              {s.ivs.length > 0 && <span className="text-stone-500 dark:text-stone-400"> ({formatIVList(s.ivs)})</span>}
            </span>
            <RecipePill recipeLabels={recipeLabels} recipeId={s.recipeId} />
            <NodeCostBadge node={s} setOverride={setOverride} recipeLabels={recipeLabels} compact />
          </div>
          <div className="mt-1 grid sm:grid-cols-2 gap-2">
            <ParentSlot side="Mother" parent={s.left}  item={s.leftItem}  powerItem={s.leftPowerItem}  nature={nature} setOverride={setOverride} recipeLabels={recipeLabels} />
            <ParentSlot side="Father" parent={s.right} item={s.rightItem} powerItem={s.rightPowerItem} nature={nature} setOverride={setOverride} recipeLabels={recipeLabels} />
          </div>
          {s.sharedIVs?.length > 0 && (
            <div className="mt-1 text-[11px] text-stone-600 dark:text-stone-400">
              Shared IVs (free via matching): <span className="font-semibold">{formatIVList(s.sharedIVs)}</span>
            </div>
          )}
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-stone-600 dark:text-stone-400">
            <span>Power Items: <span className="font-mono tabular-nums">{s.powerItems}</span></span>
            {s.everstones > 0 && (
              <span>Everstone: <span className="font-mono tabular-nums">{s.everstones}</span> {nature && `(passes ${nature})`}</span>
            )}
            <span>Egg fee: <span className="font-mono tabular-nums">${formatMoney(s.eggFee)}</span></span>
          </div>
        </li>
        );
      })}
    </ol>
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
  const leaves = collectLeaves(plan.node);
  const items  = plan.counts;
  return (
    <div className="space-y-3">
      <FormCard title="Shopping list — 1×31 parents to acquire">
        <ul className="text-sm divide-y divide-[#ece2c4] dark:divide-stone-800/60">
          {leaves.map((l, i) => {
            const ivs = l.ivs || [];
            const ivCount = ivs.length;
            const role = ROLE_LABELS[l.role] || 'Carrier';
            return (
              <li key={l.id + ':' + i} className="flex items-baseline gap-3 py-1">
                <span className="flex-1">
                  {role} · {ivCount}×31{l.gender === 'F' ? ' ♀' : l.gender === 'M' ? ' ♂' : ''}
                  {ivCount > 0 && <span className="text-stone-500 dark:text-stone-400"> ({formatIVList(ivs)})</span>}
                  {l.overridden && <span className="ml-1 px-1 py-px rounded bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 text-[9px] uppercase tracking-wider">Overridden</span>}
                </span>
                <span className="font-mono tabular-nums text-stone-700 dark:text-stone-300">${formatMoney(l.cost)}</span>
              </li>
            );
          })}
        </ul>
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

function collectLeaves(node, out = [], seen = new Set()) {
  if (!node) return out;
  if (node.kind === 'leaf') {
    if (node.cost > 0 && !seen.has(node.id)) { seen.add(node.id); out.push(node); }
    return out;
  }
  collectLeaves(node.left,  out, seen);
  collectLeaves(node.right, out, seen);
  return out;
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

function SavedProjectsTab({ data, projects, onOpen, onDuplicate, onDelete }) {
  if (projects.length === 0) return <Empty msg="No saved projects yet. Save one from the IV Plan tab." />;
  return (
    <div className="space-y-2">
      {projects.map((p) => {
        const target = p.target ? data.pokemon.find((x) => x.id === p.target.id) : null;
        const date = p.createdAt || p.savedAt;
        return (
          <div key={p.id} className="rounded-md border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900 p-3 flex items-center gap-3">
            {target && <img src={target.sprite} alt={target.name} className="pixelated w-10 h-10 object-contain" />}
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
