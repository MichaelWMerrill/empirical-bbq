import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { postCookLog, patchCookLog, drainQueueNow } from '../cookLogClient.js';

/**
 * cookLogClient.js reads globalThis.SWQueueUtils at call time (never caches
 * it into a local binding at import time), so overriding it here — after the
 * real side-effect import inside cookLogClient.js has already run — swaps in
 * an in-memory fake for every test without touching real IndexedDB.
 */
function makeFakeSWQueueUtils() {
  const added = [];
  return {
    added,
    createIndexedDbQueueStorage: () => ({
      add: (entry) => {
        added.push(entry);
        return Promise.resolve();
      },
      getAll: () => Promise.resolve([...added]),
      remove: vi.fn(() => Promise.resolve()),
    }),
    drainQueue: vi.fn(() => Promise.resolve()),
    createDefaultSendFn: vi.fn(() => vi.fn()),
  };
}

let fakeSWQueueUtils;

beforeEach(() => {
  fakeSWQueueUtils = makeFakeSWQueueUtils();
  vi.stubGlobal('SWQueueUtils', fakeSWQueueUtils);
  vi.stubGlobal('fetch', vi.fn());
  vi.stubGlobal('navigator', { serviceWorker: undefined }); // no SW in this test env — registerBackgroundSync must fail silently, not throw
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('postCookLog / patchCookLog — happy path', () => {
  it('returns ok:true with the parsed body on a 2xx response', async () => {
    fetch.mockResolvedValue({ ok: true, status: 201, json: () => Promise.resolve({ id: 'server-id-1' }) });

    const result = await postCookLog({ protein_type: 'beef_brisket' });

    expect(result).toEqual({ ok: true, queued: false, data: { id: 'server-id-1' } });
    expect(fetch).toHaveBeenCalledWith(
      '/api/cook-logs',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ protein_type: 'beef_brisket' }) }),
    );
  });

  it('URL-encodes the id in patchCookLog', async () => {
    fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });

    await patchCookLog('an id/with slashes', { wrap_time: 'x' });

    expect(fetch).toHaveBeenCalledWith('/api/cook-logs/an%20id%2Fwith%20slashes', expect.objectContaining({ method: 'PATCH' }));
  });
});

describe('postCookLog / patchCookLog — server rejection (not queued)', () => {
  it('returns ok:false, queued:false on a 4xx/5xx response, and does not enqueue it', async () => {
    fetch.mockResolvedValue({ ok: false, status: 400 });

    const result = await postCookLog({ protein_type: 'bad' });

    expect(result).toEqual({ ok: false, queued: false, status: 400 });
    expect(fakeSWQueueUtils.added).toEqual([]);
  });
});

describe('postCookLog / patchCookLog — network failure (queued)', () => {
  it('returns ok:false, queued:true and persists the entry when fetch throws', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));

    const payload = { protein_type: 'beef_brisket', weight_lb: 12 };
    const result = await postCookLog(payload);

    expect(result).toEqual({ ok: false, queued: true });
    expect(fakeSWQueueUtils.added).toHaveLength(1);
    expect(fakeSWQueueUtils.added[0]).toMatchObject({ method: 'POST', url: '/api/cook-logs', body: JSON.stringify(payload) });
  });

  it('does not throw or hang even though there is no real Service Worker in this environment', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    // registerBackgroundSync() is fire-and-forget inside enqueue(); this just
    // asserts postCookLog itself resolves promptly regardless of it.
    await expect(postCookLog({})).resolves.toEqual({ ok: false, queued: true });
  });
});

describe('drainQueueNow', () => {
  it('drains via the shared queue storage and the shared default send function', async () => {
    const sentinelSendFn = vi.fn();
    fakeSWQueueUtils.createDefaultSendFn.mockReturnValue(sentinelSendFn);

    await drainQueueNow();

    expect(fakeSWQueueUtils.drainQueue).toHaveBeenCalledTimes(1);
    const [storageArg, sendFnArg] = fakeSWQueueUtils.drainQueue.mock.calls[0];
    expect(sendFnArg).toBe(sentinelSendFn);
    expect(storageArg).toEqual(expect.objectContaining({ add: expect.any(Function), getAll: expect.any(Function), remove: expect.any(Function) }));
  });
});
