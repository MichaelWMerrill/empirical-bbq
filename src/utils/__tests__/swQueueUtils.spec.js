import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Side-effect import — same file the Service Worker loads via importScripts()
// and the page controller loads via a side-effect import. See
// public/sw-queue-utils.js for why.
import '../../../public/sw-queue-utils.js';

const { drainQueue, createDefaultSendFn } = globalThis.SWQueueUtils;

/** In-memory fake storage — the same {getAll, add, remove} shape as the real IndexedDB adapter. */
function makeFakeStorage(initialEntries) {
  let entries = [...initialEntries];
  return {
    getAll: () => Promise.resolve([...entries]),
    remove: (id) => {
      entries = entries.filter((e) => e.id !== id);
      return Promise.resolve();
    },
    _remaining: () => entries,
  };
}

describe('drainQueue', () => {
  it('sends every entry and removes it on success', async () => {
    const storage = makeFakeStorage([
      { id: 1, method: 'POST', url: '/api/cook-logs', body: '{}' },
      { id: 2, method: 'PATCH', url: '/api/cook-logs/abc', body: '{}' },
    ]);
    const sent = [];
    await drainQueue(storage, (entry) => {
      sent.push(entry.id);
      return Promise.resolve();
    });
    expect(sent).toEqual([1, 2]);
    expect(storage._remaining()).toEqual([]);
  });

  it('retries in FIFO order — entry 1 before entry 2 before entry 3', async () => {
    const storage = makeFakeStorage([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const order = [];
    await drainQueue(storage, (entry) => {
      order.push(entry.id);
      return Promise.resolve();
    });
    expect(order).toEqual([1, 2, 3]);
  });

  it('stops at the first retryable failure, leaving it and later entries queued', async () => {
    const storage = makeFakeStorage([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const attempted = [];
    await drainQueue(storage, (entry) => {
      attempted.push(entry.id);
      if (entry.id === 2) return Promise.reject(new Error('offline'));
      return Promise.resolve();
    });
    expect(attempted).toEqual([1, 2]); // never even tries entry 3
    expect(storage._remaining().map((e) => e.id)).toEqual([2, 3]); // 1 removed, 2 and 3 stay
  });

  it('does nothing on an empty queue', async () => {
    const storage = makeFakeStorage([]);
    let calls = 0;
    await drainQueue(storage, () => {
      calls++;
      return Promise.resolve();
    });
    expect(calls).toBe(0);
  });
});

/**
 * createDefaultSendFn is the exact function that had two real bugs during
 * manual browser testing (id reconciliation never running; a permanently
 * rejected create-cook POST leaving the local record stuck forever) — see
 * the "offline queue + Background Sync" commit. It's injectable with a fake
 * `cookStore` ({getActiveCook, setActiveCook, clearActiveCook}) specifically
 * so this logic can be regression-tested without real IndexedDB.
 */
describe('createDefaultSendFn', () => {
  const CREATE_URL = '/api/cook-logs';
  const CREATE_ENTRY = { id: 1, method: 'POST', url: CREATE_URL, body: '{}' };

  function makeFakeCookStore(initialCook) {
    let cook = initialCook;
    return {
      getActiveCook: () => Promise.resolve(cook),
      setActiveCook: (next) => {
        cook = next;
        return Promise.resolve();
      },
      clearActiveCook: () => {
        cook = undefined;
        return Promise.resolve();
      },
      _current: () => cook,
    };
  }

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reconciles the real server id into activeCook once a queued create-cook POST lands', async () => {
    const cookStore = makeFakeCookStore({ id: null, proteinType: 'beef_brisket', startedAt: 'x' });
    fetch.mockResolvedValue({ ok: true, status: 201, json: () => Promise.resolve({ id: 'server-id-1' }) });

    const sendFn = createDefaultSendFn(cookStore);
    await sendFn(CREATE_ENTRY);

    expect(cookStore._current()).toMatchObject({ id: 'server-id-1', proteinType: 'beef_brisket' });
  });

  it('does not overwrite an already-reconciled id', async () => {
    const cookStore = makeFakeCookStore({ id: 'already-set', proteinType: 'beef_brisket' });
    fetch.mockResolvedValue({ ok: true, status: 201, json: () => Promise.resolve({ id: 'different-id' }) });

    await createDefaultSendFn(cookStore)(CREATE_ENTRY);

    expect(cookStore._current().id).toBe('already-set');
  });

  it('clears the local placeholder when a queued create-cook POST permanently fails (4xx)', async () => {
    const cookStore = makeFakeCookStore({ id: null, proteinType: 'beef_brisket' });
    fetch.mockResolvedValue({ ok: false, status: 400 });

    await createDefaultSendFn(cookStore)(CREATE_ENTRY);

    expect(cookStore._current()).toBeUndefined();
  });

  it('rejects (retryable) on a 5xx, leaving activeCook untouched', async () => {
    const cookStore = makeFakeCookStore({ id: null, proteinType: 'beef_brisket' });
    fetch.mockResolvedValue({ ok: false, status: 503 });

    await expect(createDefaultSendFn(cookStore)(CREATE_ENTRY)).rejects.toThrow();
    expect(cookStore._current()).toMatchObject({ id: null });
  });

  it('does not touch activeCook for a non-create-cook entry (e.g. a checkpoint PATCH)', async () => {
    const cookStore = makeFakeCookStore({ id: 'real-id', proteinType: 'beef_brisket' });
    fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });

    await createDefaultSendFn(cookStore)({ id: 2, method: 'PATCH', url: '/api/cook-logs/real-id', body: '{}' });

    expect(cookStore._current()).toMatchObject({ id: 'real-id' });
  });

  it('sends the entry method, url, and body to fetch', async () => {
    const cookStore = makeFakeCookStore(undefined);
    fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });

    const entry = { id: 3, method: 'PATCH', url: '/api/cook-logs/abc', body: '{"wrap_time":"x"}' };
    await createDefaultSendFn(cookStore)(entry);

    expect(fetch).toHaveBeenCalledWith('/api/cook-logs/abc', expect.objectContaining({ method: 'PATCH', body: '{"wrap_time":"x"}' }));
  });
});
