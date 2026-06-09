import { damage } from '../lib/damage.js';

// Temporary smoke-test page — verifies the vendored engine bundles + computes
// in the browser before the full UI is built.
export default function DamageCalc() {
  const r = damage(
    { name: 'Tyranitar', level: 100, nature: 'Adamant', item: 'Choice Band', evs: { atk: 252 } },
    { name: 'Breloom', level: 100, evs: { hp: 252 } },
    'Crunch',
    {},
  );
  return (
    <main className="max-w-3xl mx-auto px-4 py-6">
      <h1 className="text-xl font-bold text-stone-900 dark:text-stone-100">Damage Calc</h1>
      <pre className="mt-3 text-xs whitespace-pre-wrap text-stone-700 dark:text-stone-300">{JSON.stringify(r, null, 2)}</pre>
    </main>
  );
}
