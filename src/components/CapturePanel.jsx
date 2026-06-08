import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, RefreshCw, Crop, X } from 'lucide-react';
import {
  isDesktop, listWindows, captureAndOcr, listen, CAPTURE_HOTKEY_EVENT,
  flashToast, beep, primeAudio,
} from '../lib/desktop.js';
import { parseSummary, resolveSpecies } from '../lib/breeding/parseSummary.js';
import { blankBoxMon } from '../lib/breeding/box.js';

const LS_RECT = 'pokemmo:capture:rect';
function loadRect() {
  try {
    const r = JSON.parse(localStorage.getItem(LS_RECT));
    if (r && typeof r.x === 'number' && r.w > 0 && r.h > 0) return r;
  } catch { /* ignore */ }
  return null;
}
function saveRect(r) {
  try { localStorage.setItem(LS_RECT, JSON.stringify(r)); } catch { /* ignore */ }
}

// Desktop-only. Captures the PokéMMO window, OCRs the summary panel, and
// appends the parsed mon to the Box for inline confirm/correct. Renders nothing
// on the website.
export default function CapturePanel({ data, onImport }) {
  if (!isDesktop()) return null;
  return <CapturePanelInner data={data} onImport={onImport} />;
}

function CapturePanelInner({ data, onImport }) {
  const [windows, setWindows] = useState([]);
  const [hwnd, setHwnd] = useState(null);
  const [status, setStatus] = useState(null); // { kind:'ok'|'warn'|'err', msg }
  const [busy, setBusy] = useState(false);
  const [rect, setRect] = useState(loadRect);
  const [calibSrc, setCalibSrc] = useState(null); // data URL while calibrating
  const [preview, setPreview] = useState(null);    // { src, gender, shiny, alpha }

  const refresh = useCallback(async () => {
    try {
      const list = await listWindows();
      setWindows(list || []);
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
      const payload = await captureAndOcr({ hwnd, rect: rect || null });
      const parsed = parseSummary(payload);
      const species = resolveSpecies(parsed.speciesName, data.pokemon);
      const gender = payload.gender || parsed.gender || 'F';
      const mon = {
        ...blankBoxMon(),
        species,
        gender,
        ivs: { ...blankBoxMon().ivs, ...parsed.ivs },
        nature: parsed.nature || '',
        shiny: !!payload.shiny,
        alpha: !!payload.alpha,
        source: 'capture',
        addedAt: new Date().toISOString(),
      };
      onImport([mon]);

      const clean = !!(parsed.confidence.species && species && parsed.confidence.ivs);
      const name = species && parsed.speciesName ? parsed.speciesName : 'mon';
      const marks = [payload.shiny && 'shiny', payload.alpha && 'alpha'].filter(Boolean).join(' ');
      beep(clean);
      flashToast(`Added ${name}${marks ? ` (${marks})` : ''} ${clean ? '✓' : '— check it'}`, clean);

      setPreview({
        src: `data:image/png;base64,${payload.pngBase64}`,
        gender, shiny: !!payload.shiny, alpha: !!payload.alpha,
      });
      const bits = [species ? parsed.speciesName : 'species?'];
      bits.push(parsed.confidence.ivs ? 'IVs read' : 'IVs?');
      if (parsed.confidence.nature) bits.push(parsed.nature);
      bits.push(gender === 'M' ? '♂' : gender === 'F' ? '♀' : gender);
      if (marks) bits.push(marks);
      setStatus({ kind: clean ? 'ok' : 'warn', msg: `Added (${bits.join(' · ')}). Review the new row below.` });
    } catch (e) {
      beep(false);
      setStatus({ kind: 'err', msg: `Capture failed: ${String(e?.message || e)}` });
    } finally {
      setBusy(false);
    }
  }, [busy, hwnd, rect, data, onImport]);

  const startCalibrate = useCallback(async () => {
    if (!hwnd) { setStatus({ kind: 'warn', msg: 'Pick the PokéMMO window first.' }); return; }
    primeAudio();
    setBusy(true);
    setStatus({ kind: 'ok', msg: 'Capturing for calibration…' });
    try {
      const payload = await captureAndOcr({ hwnd }); // full window, uncropped
      setCalibSrc(`data:image/png;base64,${payload.pngBase64}`);
      setStatus(null);
    } catch (e) {
      setStatus({ kind: 'err', msg: `Capture failed: ${String(e?.message || e)}` });
    } finally {
      setBusy(false);
    }
  }, [hwnd]);

  // Global hotkey → capture. Ref keeps the listener calling the latest closure.
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
        <button type="button" onClick={startCalibrate} disabled={busy} title="Mark where the summary panel is"
          className="inline-flex items-center gap-1 px-2 py-1.5 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-stone-700 dark:text-stone-300 text-xs disabled:opacity-50">
          <Crop size={13} /> Calibrate
        </button>
        <button type="button" onClick={doCapture} disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed">
          <Camera size={14} /> {busy ? '…' : 'Capture'}
        </button>
      </div>

      <div className="text-[11px] text-blue-800/80 dark:text-blue-200/80 leading-snug">
        Open a mon's summary in-game, then capture (or press <kbd className="px-1 rounded bg-blue-100 dark:bg-blue-900/60">Ctrl+Shift+B</kbd>).
        Run PokéMMO <strong>borderless-windowed</strong>.{' '}
        {rect
          ? <span className="text-emerald-700 dark:text-emerald-400">Panel region calibrated ✓</span>
          : <span className="text-amber-700 dark:text-amber-400">Not calibrated — alpha/shiny &amp; gender need you to <strong>Calibrate</strong> the panel region once.</span>}
      </div>

      {status && <div className={`text-[11px] ${dot}`}>{status.msg}</div>}

      {preview && (
        <div className="flex items-start gap-2 pt-1">
          <img src={preview.src} alt="last capture" className="w-16 rounded border border-[#d6c8a3] dark:border-stone-700" />
          <div className="text-[10px] text-stone-600 dark:text-stone-400 leading-tight">
            <div>Last capture:</div>
            <div>{preview.gender === 'M' ? '♂ male' : preview.gender === 'F' ? '♀ female' : preview.gender}</div>
            <div>{preview.shiny ? '★ shiny' : 'not shiny'} · {preview.alpha ? 'α alpha' : 'not alpha'}</div>
          </div>
        </div>
      )}

      {calibSrc && (
        <CalibrateOverlay
          src={calibSrc}
          initialRect={rect}
          onSave={(r) => { setRect(r); saveRect(r); setCalibSrc(null); setStatus({ kind: 'ok', msg: 'Panel region saved. Capture again to use it.' }); }}
          onCancel={() => setCalibSrc(null)}
        />
      )}
    </div>
  );
}

// Full-screen overlay: drag a rectangle over the captured screenshot to mark
// the summary-panel region. Coordinates are normalized (0..1) to the image so
// the Rust side can crop any future capture to exactly that area.
function CalibrateOverlay({ src, initialRect, onSave, onCancel }) {
  const imgRef = useRef(null);
  const dragStart = useRef(null);
  const [sel, setSel] = useState(initialRect || null);

  const toNorm = (clientX, clientY) => {
    const r = imgRef.current.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (clientY - r.top) / r.height)),
    };
  };
  const onDown = (e) => {
    e.preventDefault();
    const p = toNorm(e.clientX, e.clientY);
    dragStart.current = p;
    setSel({ x: p.x, y: p.y, w: 0, h: 0 });
  };
  const onMove = (e) => {
    if (!dragStart.current) return;
    const p = toNorm(e.clientX, e.clientY);
    const a = dragStart.current;
    setSel({ x: Math.min(a.x, p.x), y: Math.min(a.y, p.y), w: Math.abs(p.x - a.x), h: Math.abs(p.y - a.y) });
  };
  const onUp = () => { dragStart.current = null; };

  const valid = sel && sel.w > 0.02 && sel.h > 0.02;

  return (
    <div className="fixed inset-0 z-[200] bg-black/80 flex flex-col items-center justify-center p-4" onMouseUp={onUp} onMouseMove={onMove}>
      <div className="text-white text-sm mb-2">Drag a box around the <strong>summary panel</strong> (name, stats, IVs).</div>
      <div className="relative max-w-full max-h-[78vh] select-none">
        <img
          ref={imgRef}
          src={src}
          alt="calibration"
          draggable={false}
          onMouseDown={onDown}
          className="max-w-full max-h-[78vh] object-contain cursor-crosshair rounded"
        />
        {sel && (
          <div
            className="absolute border-2 border-emerald-400 bg-emerald-400/15 pointer-events-none"
            style={{
              left: `${sel.x * 100}%`, top: `${sel.y * 100}%`,
              width: `${sel.w * 100}%`, height: `${sel.h * 100}%`,
            }}
          />
        )}
      </div>
      <div className="flex items-center gap-2 mt-3">
        <button type="button" onClick={onCancel}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-stone-500 text-stone-200 hover:bg-white/10 text-sm">
          <X size={14} /> Cancel
        </button>
        <button type="button" disabled={!valid} onClick={() => onSave(sel)}
          className="inline-flex items-center gap-1 px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-sm disabled:opacity-40 disabled:cursor-not-allowed">
          Save region
        </button>
      </div>
    </div>
  );
}
