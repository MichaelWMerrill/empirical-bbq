/*
 * Page-side client for the cook-log-service Worker (/api/cook-logs).
 *
 * This is the online-only version: a network failure surfaces as a plain
 * error result. Offline resilience (queuing a failed write instead of
 * losing it, and retrying via Background Sync / online-event fallback)
 * lands in a later commit — see cookLogQueue-related code in sw-queue-utils.js.
 */
async function send(method, url, body) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, networkError: true };
  }
  if (!response.ok) {
    return { ok: false, networkError: false, status: response.status };
  }
  return { ok: true, data: await response.json().catch(() => null) };
}

export function postCookLog(payload) {
  return send('POST', '/api/cook-logs', payload);
}

export function patchCookLog(id, payload) {
  return send('PATCH', `/api/cook-logs/${encodeURIComponent(id)}`, payload);
}
