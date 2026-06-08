import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Lightweight anchored popover for compact pickers (ability, held item) that
 * don't warrant a full-screen modal. Portals to <body> (so it escapes the
 * filter sidebar's clipping/stacking context), positions itself under the
 * trigger — flipping above when there isn't room below — and follows the
 * trigger on scroll/resize. Closes on Escape or an outside click; clicks on
 * the trigger itself are ignored so it can toggle.
 *
 *   const ref = useRef(null);
 *   <button ref={ref} onClick={() => setOpen(o => !o)}>…</button>
 *   {open && <Popover anchorRef={ref} onClose={() => setOpen(false)}>…</Popover>}
 *
 * Children should be a flex-col; the panel caps its own height and the body is
 * expected to scroll internally.
 */
export default function Popover({ anchorRef, onClose, children, width, maxHeight = 360 }) {
  const panelRef = useRef(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    function place() {
      const a = anchorRef.current;
      if (!a) return;
      const r = a.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      const desired = width ?? r.width;
      const w = Math.max(220, Math.min(desired, vw - 16));
      const left = Math.max(8, Math.min(r.left, vw - w - 8));
      const spaceBelow = vh - r.bottom;
      const spaceAbove = r.top;
      // Flip above only when below is cramped and above has more room.
      const openUp = spaceBelow < 220 && spaceAbove > spaceBelow;
      if (openUp) {
        setPos({ left, bottom: vh - r.top + 4, width: w, maxHeight: Math.min(maxHeight, spaceAbove - 12) });
      } else {
        setPos({ left, top: r.bottom + 4, width: w, maxHeight: Math.min(maxHeight, spaceBelow - 12) });
      }
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchorRef, width, maxHeight]);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    function onDown(e) {
      if (panelRef.current?.contains(e.target)) return;
      if (anchorRef.current?.contains(e.target)) return; // let the trigger toggle
      onClose();
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose, anchorRef]);

  if (!pos) return null;
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        bottom: pos.bottom,
        width: pos.width,
        maxHeight: pos.maxHeight,
      }}
      className="z-50 flex flex-col rounded-md border border-[#d6c8a3] dark:border-stone-700
                 bg-[#fdf8e9] dark:bg-stone-900 shadow-xl overflow-hidden"
    >
      {children}
    </div>,
    document.body,
  );
}
