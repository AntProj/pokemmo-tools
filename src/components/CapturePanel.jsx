import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, RefreshCw } from 'lucide-react';
import { isDesktop, listWindows, captureAndOcr, listen, CAPTURE_HOTKEY_EVENT, flashToast, beep, primeAudio } from '../lib/desktop.js';
import { parseSummary, resolveSpecies } from '../lib/breeding/parseSummary.js';
import { blankBoxMon } from '../lib/breeding/box.js';

// Desktop-only. Captures the PokéMMO window, OCRs the summary panel, and
// appends the parsed mon to the Box for the user to confirm/correct inline.
// Renders nothing on the website (isDesktop() === false), so it's safe to mount
// unconditionally from the Box tab.
export default function CapturePanel({ data, onImport }) {
  if (!isDesktop()) return null;
  return <CapturePanelInner data={data} onImport={onImport} />;
}

function CapturePanelInner({ data, onImport }) {
  const [windows, setWindows] = useState([]);
  const [hwnd, setHwnd] = useState(null);
  const [status, setStatus] = useState(null); // { kind:'ok'|'warn'|'err', msg }
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const list = await listWindows();
      setWindows(list || []);
      // Auto-select the PokéMMO window if we can spot it.
      const guess = (list || []).find((w) => /pok[eé]mmo/i.test(w.title));
      if (guess) setHwnd((h) => h ?? guess.hwnd);
    } catch (e) {
      setStatus({ kind: 'err', msg: String(e?.message || e) });
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const doCapture = useCallback(async () => {
    if (busy) return;
    if (!hwnd) { setStatus({ kind: 'warn', msg: 'Pick the PokéMMO window first.' }); return; }
    setBusy(true);
    setStatus({ kind: 'ok', msg: 'Capturing…' });
    try {
      const payload = await captureAndOcr({ hwnd });
      const parsed = parseSummary(payload);
      const species = resolveSpecies(parsed.speciesName, data.pokemon);
      const mon = {
        ...blankBoxMon(),
        species,
        gender: parsed.gender || 'F',
        ivs: { ...blankBoxMon().ivs, ...parsed.ivs },
        nature: parsed.nature || '',
        shiny: !!payload.shiny,
        alpha: !!payload.alpha,
        source: 'capture',
        addedAt: new Date().toISOString(),
      };
      onImport([mon]);

      // "Clean read" = species resolved AND the IV row parsed.
      const clean = !!(parsed.confidence.species && species && parsed.confidence.ivs);
      const name = species && parsed.speciesName ? parsed.speciesName : 'mon';
      const marks = [payload.shiny && 'shiny', payload.alpha && 'alpha'].filter(Boolean).join(' ');
      const toastMsg = `Added ${name}${marks ? ` (${marks})` : ''} ${clean ? '✓' : '— check it'}`;

      beep(clean);
      flashToast(toastMsg, clean);

      const bits = [];
      bits.push(species ? parsed.speciesName : 'species?');
      if (parsed.confidence.ivs) bits.push('IVs read'); else bits.push('IVs?');
      if (parsed.confidence.nature) bits.push(parsed.nature);
      if (marks) bits.push(marks);
      setStatus({ kind: clean ? 'ok' : 'warn', msg: `Added (${bits.join(' · ')}). Review the new row below and fix anything OCR missed.` });
    } catch (e) {
      beep(false);
      setStatus({ kind: 'err', msg: `Capture failed: ${String(e?.message || e)}` });
    } finally {
      setBusy(false);
    }
  }, [busy, hwnd, data, onImport]);

  // Global hotkey → capture. Keep a ref to the latest handler so the listener
  // (registered once) always calls the current closure.
  const captureRef = useRef(doCapture);
  captureRef.current = doCapture;
  useEffect(() => {
    let unlisten = null;
    listen(CAPTURE_HOTKEY_EVENT, () => captureRef.current()).then((u) => { unlisten = u; });
    return () => { if (unlisten) unlisten(); };
  }, []);

  const dot = status?.kind === 'err' ? 'text-red-600 dark:text-red-400'
            : status?.kind === 'warn' ? 'text-amber-700 dark:text-amber-400'
            : 'text-stone-600 dark:text-stone-300';

  return (
    <div className="rounded-md border border-blue-300 dark:border-blue-900 bg-blue-50/60 dark:bg-blue-950/30 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Camera size={15} className="text-blue-700 dark:text-blue-300 shrink-0" />
        <span className="text-xs font-semibold uppercase tracking-wider text-blue-800 dark:text-blue-200">Capture from game</span>
        <span className="ml-auto text-[10px] text-blue-700/70 dark:text-blue-300/70">desktop</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={hwnd ?? ''}
          onChange={(e) => { primeAudio(); setHwnd(e.target.value ? Number(e.target.value) : null); }}
          className="flex-1 min-w-0 px-2 py-1 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-stone-800 dark:text-stone-200 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Select the PokéMMO window…</option>
          {windows.map((w) => (
            <option key={w.hwnd} value={w.hwnd}>{w.title || `Window ${w.hwnd}`}</option>
          ))}
        </select>
        <button type="button" onClick={refresh} title="Refresh window list"
          className="p-1.5 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-stone-500 hover:text-stone-800 dark:hover:text-stone-200">
          <RefreshCw size={13} />
        </button>
        <button type="button" onClick={doCapture} disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed">
          <Camera size={14} /> {busy ? 'Capturing…' : 'Capture'}
        </button>
      </div>

      <div className="text-[11px] text-blue-800/80 dark:text-blue-200/80 leading-snug">
        Open a mon's summary in-game, then capture (or press <kbd className="px-1 rounded bg-blue-100 dark:bg-blue-900/60">Ctrl+Shift+B</kbd>).
        Run PokéMMO <strong>borderless-windowed</strong> — exclusive fullscreen can capture as a black frame.
      </div>

      {status && <div className={`text-[11px] ${dot}`}>{status.msg}</div>}
    </div>
  );
}
