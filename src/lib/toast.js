// Tiny app-wide toast store. A useSyncExternalStore-backed singleton so any
// module can fire a transient message (e.g. "Added Bulbasaur to Box 1") without
// prop-drilling. <Toaster/> (rendered once in App) subscribes and renders them.

import { useSyncExternalStore } from 'react';

let _toasts = [];
let _seq = 0;
const _listeners = new Set();
function notify() { for (const cb of _listeners) cb(); }

// kind: 'success' | 'warn' | 'info'. ttl in ms (auto-dismiss).
export function showToast(message, opts = {}) {
  const id = ++_seq;
  _toasts = [..._toasts, { id, message, kind: opts.kind || 'info' }];
  notify();
  const ttl = opts.ttl ?? 2400;
  if (ttl > 0 && typeof window !== 'undefined') {
    window.setTimeout(() => dismissToast(id), ttl);
  }
  return id;
}

export function dismissToast(id) {
  _toasts = _toasts.filter((t) => t.id !== id);
  notify();
}

function subscribe(cb) { _listeners.add(cb); return () => _listeners.delete(cb); }
function getSnapshot() { return _toasts; }

export function useToasts() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
