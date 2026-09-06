import { describe, it, expect } from 'vitest';

// Side-effect import — same file the Service Worker loads via importScripts()
// and the page controller loads via a side-effect import. See
// public/sw-queue-utils.js for why.
import '../../../public/sw-queue-utils.js';

const { drainQueue } = globalThis.SWQueueUtils;

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
