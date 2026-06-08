import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useEscapeAndScrollLock } from '../hooks/useEscapeAndScrollLock.js';

/**
 * Shared modal shell — the single overlay primitive for the whole app. Provides:
 *   - a portal to <body> (escapes parent stacking contexts)
 *   - dark backdrop with click-outside-to-close
 *   - Escape-to-close + body-scroll lock (useEscapeAndScrollLock)
 *   - a focus trap: focus is kept inside the dialog while open and restored to
 *     the trigger element on close (accessibility — keyboard / screen readers)
 *
 * Layout is flexible so every overlay (simple pickers AND the custom-header
 * detail modals) can share it:
 *
 *   title  → standard header mode: a bordered header with the title, a close
 *            button, and optional `headerExtra` (search box, filter chips),
 *            then a scrolling body.
 *   header → custom-header mode: your own fixed header node sits above a
 *            scrolling body. A close button is overlaid top-right unless
 *            showClose=false (when your header has its own).
 *   neither → bare mode: just the card; `children` is everything. A floating
 *            close button is overlaid unless showClose=false.
 *
 *   scroll = 'inside' (default) → fixed-height card, body scrolls internally.
 *   scroll = 'page'             → card grows with content, the backdrop scrolls
 *                                 (used by tall detail modals like PokemonModal).
 */
export default function Modal({
  title,
  header,
  headerExtra,
  children,
  onClose,
  maxWidth = 'max-w-xl',
  maxHeight = 'min(640px, calc(100vh - 3rem))',
  scroll = 'inside',
  showClose = true,
  z = 'z-50',
  ariaLabel,
}) {
  useEscapeAndScrollLock(onClose);
  const cardRef = useFocusTrap();

  const pageScroll = scroll === 'page';
  const standardHeader = title != null;

  const closeBtn = (cls) => (
    <button
      type="button"
      onClick={onClose}
      className={`p-1.5 rounded-md bg-[#fdf8e9]/80 dark:bg-stone-800/80 hover:bg-[#ece2c4] dark:hover:bg-stone-700 text-stone-700 dark:text-stone-200 ${cls || ''}`}
      title="Close (Esc)"
      aria-label="Close"
    >
      <X size={18} />
    </button>
  );

  return createPortal(
    <div className={`fixed inset-0 ${z} overflow-y-auto bg-black/70`} onClick={onClose}>
      <div className="min-h-full flex items-start sm:items-center justify-center p-3 sm:p-6">
        <div
          ref={cardRef}
          tabIndex={-1}
          className={`relative w-full ${maxWidth} bg-[#fdf8e9] dark:bg-stone-900
                     rounded-lg shadow-2xl border border-[#e6dabf] dark:border-stone-800
                     focus:outline-none ${pageScroll ? '' : 'flex flex-col'}`}
          style={pageScroll ? undefined : { height: maxHeight }}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel || (typeof title === 'string' ? title : undefined)}
        >
          {standardHeader ? (
            <div className="shrink-0 p-4 border-b border-[#e6dabf] dark:border-stone-800 space-y-3">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold mr-auto text-stone-900 dark:text-stone-100">{title}</h2>
                {showClose && closeBtn()}
              </div>
              {headerExtra}
            </div>
          ) : header ? (
            <div className="relative shrink-0">
              {header}
              {showClose && closeBtn('absolute top-3 right-3 z-10')}
            </div>
          ) : (
            showClose && closeBtn('absolute top-3 right-3 z-10')
          )}

          <div className={pageScroll ? '' : 'flex-1 overflow-y-auto'}>
            {children}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Keep keyboard focus inside the dialog while open, and restore it to whatever
// was focused before (the trigger) on close. Respects an existing autofocus
// (e.g. a picker's search box) — only moves focus if nothing inside is focused.
function useFocusTrap() {
  const ref = useRef(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const prevActive = document.activeElement;
    const focusables = () => [...node.querySelectorAll(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    )].filter((el) => el.offsetParent !== null);

    if (!node.contains(document.activeElement)) {
      (focusables()[0] || node).focus?.();
    }

    function onKey(e) {
      if (e.key !== 'Tab') return;
      const f = focusables();
      if (f.length === 0) { e.preventDefault(); node.focus?.(); return; }
      const idx = f.indexOf(document.activeElement);
      if (e.shiftKey && idx <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && idx === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
    node.addEventListener('keydown', onKey);
    return () => {
      node.removeEventListener('keydown', onKey);
      try { prevActive?.focus?.(); } catch { /* trigger may be unmounted */ }
    };
  }, []);
  return ref;
}
