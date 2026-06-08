import { useEffect } from 'react';

/**
 * While a modal/overlay is mounted: lock body scroll and close it on Escape.
 *
 * Extracted from the verbatim useEffect that was duplicated in AbilityPicker,
 * HeldItemPicker, MovePicker, PlanLocationModal, PokemonModal, and
 * CatchInfoPanel. Pass a STABLE onClose (wrap in useCallback) so the listener
 * isn't re-bound on every render.
 */
export function useEscapeAndScrollLock(onClose) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
}
