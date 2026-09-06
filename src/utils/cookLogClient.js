/*
 * Page-side client for the cook-log-service Worker (/api/cook-logs). Wraps
 * fetch with the offline-resilience contract from the capture-UI spec:
 * a failed write is queued (never silently dropped) and retried later, via
 * real Background Sync where supported, or the online/visibilitychange
 * fallback in cookLogCapture.controller.js on browsers without it (Safari).
 *
 * The actual IndexedDB queue + Service Worker wiring live in
 * public/sw-queue-utils.js (see that file for why it's a classic script
 * loaded via a side-effect import here rather than a normal ES module).
 */
import '../../public/sw-queue-utils.js';

const SYNC_TAG = 'cook-log-queue';

async function registerBackgroundSync() {
  try {
    const reg = await navigator.serviceWorker.ready;
    if ('sync' in reg) await reg.sync.register(SYNC_TAG);
  } catch {
    /* Background Sync unsupported (Safari) or registration failed — the
       online/visibilitychange fallback in the capture-UI controller covers it. */
  }
}

async function enqueue(method, url, body) {
  const storage = globalThis.SWQueueUtils.createIndexedDbQueueStorage();
  await storage.add({ method, url, body: JSON.stringify(body), enqueuedAt: new Date().toISOString() });
  // Deliberately not awaited: `navigator.serviceWorker.ready` can hang
  // indefinitely (registration never completes, browser quirk, etc.), and
  // the entry is already safely persisted above — the online/visibilitychange
  // fallback covers it either way, so enqueue() must return promptly
  // regardless of how Background Sync registration goes.
  registerBackgroundSync();
}

async function send(method, url, body) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // Network-level failure (offline) — queue it, never drop it.
    await enqueue(method, url, body);
    return { ok: false, queued: true };
  }
  if (!response.ok) {
    // A real server rejection (validation, 404, rate limit) — retrying the
    // identical payload won't help, so this is NOT queued. The caller
    // decides how to surface it.
    return { ok: false, queued: false, status: response.status };
  }
  return { ok: true, queued: false, data: await response.json().catch(() => null) };
}

export function postCookLog(payload) {
  return send('POST', '/api/cook-logs', payload);
}

export function patchCookLog(id, payload) {
  return send('PATCH', `/api/cook-logs/${encodeURIComponent(id)}`, payload);
}

/**
 * Manual drain for the online/visibilitychange fallback (browsers without
 * Background Sync). Safe to call opportunistically — a full queue drains in
 * order, an empty one is a no-op.
 */
export function drainQueueNow() {
  const storage = globalThis.SWQueueUtils.createIndexedDbQueueStorage();
  return globalThis.SWQueueUtils.drainQueue(storage, globalThis.SWQueueUtils.createDefaultSendFn());
}
