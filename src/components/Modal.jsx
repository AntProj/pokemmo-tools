import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useEscapeAndScrollLock } from '../hooks/useEscapeAndScrollLock.js';

/**
 * Shared modal shell: portal to <body>, dark backdrop, click-outside-to-close,
 * Escape-to-close, body-scroll lock, and a framed card with a standard header
 * (title + close button). The card is a flex column with a fixed height so its
 * body scrolls internally.
 *
 * WHY a portal: the picker buttons render deep inside `<aside>`/`<details>`
 * stacking contexts. A plain `fixed` overlay rendered there gets trapped behind
 * the surrounding chrome (this caused the transparent/behind bug the
 * AbilityPicker + HeldItemPicker were patched for, and which MovePicker was
 * still missing — folding everyone onto this shell removes that drift class).
 *
 * Props:
 *   title        ReactNode  header title (string → also used as aria-label)
 *   onClose      ()=>void   STABLE callback (useCallback) — used for backdrop,
 *                           Escape, and the header X.
 *   headerExtra  ReactNode  optional content under the title row (search box,
 *                           filter chips, …) inside the bordered header.
 *   children     ReactNode  the scrollable body.
 *   maxWidth     string     Tailwind max-w-* class (default max-w-xl).
 *   maxHeight    string     CSS height value (default min(640px, 100vh-3rem)).
 *   z            string     Tailwind z-* class (default z-50).
 *   ariaLabel    string     overrides the derived aria-label.
 */
export default function Modal({
  title,
  onClose,
  headerExtra,
  children,
  maxWidth = 'max-w-xl',
  maxHeight = 'min(640px, calc(100vh - 3rem))',
  z = 'z-50',
  ariaLabel,
}) {
  useEscapeAndScrollLock(onClose);

  return createPortal(
    <div className={`fixed inset-0 ${z} overflow-y-auto bg-black/70`} onClick={onClose}>
      <div className="min-h-full flex items-start sm:items-center justify-center p-3 sm:p-6">
        <div
          className={`w-full ${maxWidth} bg-[#fdf8e9] dark:bg-stone-900
                     rounded-lg shadow-2xl border border-[#e6dabf] dark:border-stone-800
                     flex flex-col`}
          style={{ height: maxHeight }}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel || (typeof title === 'string' ? title : undefined)}
        >
          <div className="p-4 border-b border-[#e6dabf] dark:border-stone-800 space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold mr-auto text-stone-900 dark:text-stone-100">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-md bg-[#fdf8e9] dark:bg-stone-800 hover:bg-[#ece2c4] dark:hover:bg-stone-700 text-stone-700 dark:text-stone-200"
                title="Close (Esc)"
              >
                <X size={18} />
              </button>
            </div>
            {headerExtra}
          </div>

          <div className="flex-1 overflow-y-auto">
            {children}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
