import { Check, Info, X } from 'lucide-react';
import { useToasts, dismissToast } from '../lib/toast.js';

// Bottom-right stack of transient toasts. Rendered once in App.
export default function Toaster() {
  const toasts = useToasts();
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col items-end gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className="pointer-events-auto inline-flex items-center gap-2 max-w-[min(90vw,22rem)] px-3 py-2 rounded-md shadow-lg text-sm
                     bg-stone-900 text-stone-100 dark:bg-stone-100 dark:text-stone-900 border border-black/10 dark:border-white/10"
        >
          {t.kind === 'success'
            ? <Check size={15} className="shrink-0 text-emerald-400 dark:text-emerald-600" />
            : t.kind === 'warn'
              ? <Info size={15} className="shrink-0 text-amber-400 dark:text-amber-600" />
              : <Info size={15} className="shrink-0 opacity-70" />}
          <span className="min-w-0">{t.message}</span>
          <button
            type="button"
            onClick={() => dismissToast(t.id)}
            className="ml-1 shrink-0 opacity-60 hover:opacity-100"
            aria-label="Dismiss"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
