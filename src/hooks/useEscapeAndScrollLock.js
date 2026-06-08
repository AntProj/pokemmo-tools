import { useEffect, useRef } from 'react';

/**
 * While a modal/overlay is mounted: lock body scroll and close it on Escape.
 *
 * Uses a module-level stack so STACKED modals behave correctly:
 *   - Escape closes only the TOP-most modal (not every open one at once).
 *   - Body scroll-lock is ref-counted — the page only regains scroll when the
 *     last modal closes.
 *
 * onClose is read through a ref so the effect runs once per mount regardless of
 * whether the caller passes a fresh inline arrow each render.
 */

const stack = []; // array of stable close-entry fns, top = last
let savedOverflow = null;

function onKey(e) {
  if (e.key !== 'Escape') return;
  const top = stack[stack.length - 1];
  if (top) { e.stopPropagation(); top(); }
}

export function useEscapeAndScrollLock(onClose) {
  const ref = useRef(onClose);
  ref.current = onClose;

  useEffect(() => {
    const entry = () => ref.current?.();
    stack.push(entry);
    if (stack.length === 1) {
      document.addEventListener('keydown', onKey);
      savedOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    return () => {
      const i = stack.lastIndexOf(entry);
      if (i !== -1) stack.splice(i, 1);
      if (stack.length === 0) {
        document.removeEventListener('keydown', onKey);
        document.body.style.overflow = savedOverflow || '';
        savedOverflow = null;
      }
    };
  }, []);
}
