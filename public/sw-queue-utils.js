/*
 * Shared local persistence for the cook-log capture UI: the offline write
 * queue (failed POST/PATCH requests, retried in order) and the in-progress
 * "active cook" record (so it survives the app closing mid-cook).
 *
 * Classic script (no import/export), loaded three ways from one source of
 * truth:
 *  - importScripts('/sw-queue-utils.js') in sw.js (the `sync` handler drains
 *    the queue there).
 *  - a side-effect `import '.../public/sw-queue-utils.js'` from the page
 *    controller (cookLogCapture.controller.js), reading window.SWQueueUtils.
 *  - the same side-effect import from a Vitest spec, reading
 *    globalThis.SWQueueUtils — drainQueue() itself takes a `storage` and
 *    `sendFn` as plain arguments, so it's tested with an in-memory fake, no
 *    real IndexedDB required.
 */
(function (root) {
  var DB_NAME = 'cook-log-client';
  var DB_VERSION = 1;
  var QUEUE_STORE = 'pendingRequests';
  var COOK_STORE = 'activeCook';
  var COOK_KEY = 'current';

  function reqToPromise(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error);
      };
    });
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(QUEUE_STORE)) {
          db.createObjectStore(QUEUE_STORE, { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains(COOK_STORE)) {
          db.createObjectStore(COOK_STORE);
        }
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error);
      };
    });
  }

  function getAllPending() {
    return openDb().then(function (db) {
      return reqToPromise(db.transaction(QUEUE_STORE, 'readonly').objectStore(QUEUE_STORE).getAll());
    });
  }

  function addPending(entry) {
    return openDb().then(function (db) {
      return reqToPromise(db.transaction(QUEUE_STORE, 'readwrite').objectStore(QUEUE_STORE).add(entry));
    });
  }

  function removePending(id) {
    return openDb().then(function (db) {
      return reqToPromise(db.transaction(QUEUE_STORE, 'readwrite').objectStore(QUEUE_STORE).delete(id));
    });
  }

  function getActiveCook() {
    return openDb().then(function (db) {
      return reqToPromise(db.transaction(COOK_STORE, 'readonly').objectStore(COOK_STORE).get(COOK_KEY));
    });
  }

  function setActiveCook(cook) {
    return openDb().then(function (db) {
      return reqToPromise(db.transaction(COOK_STORE, 'readwrite').objectStore(COOK_STORE).put(cook, COOK_KEY));
    });
  }

  function clearActiveCook() {
    return openDb().then(function (db) {
      return reqToPromise(db.transaction(COOK_STORE, 'readwrite').objectStore(COOK_STORE).delete(COOK_KEY));
    });
  }

  /** Opt-out: wipe everything queued/in-progress locally. */
  function clearAll() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction([QUEUE_STORE, COOK_STORE], 'readwrite');
        tx.objectStore(QUEUE_STORE).clear();
        tx.objectStore(COOK_STORE).clear();
        tx.oncomplete = function () {
          resolve();
        };
        tx.onerror = function () {
          reject(tx.error);
        };
      });
    });
  }

  function createIndexedDbQueueStorage() {
    return { getAll: getAllPending, add: addPending, remove: removePending };
  }

  /**
   * The real network replay for a queued entry, shared by both the Service
   * Worker's `sync` handler and the page's online/visibilitychange fallback
   * — one implementation so they can't drift apart.
   *
   * A queued cook-creation POST is a special case: it was queued because the
   * server was unreachable when the cook started, so the caller only has a
   * local placeholder (`activeCook.id === null`). Once it actually lands, the
   * real id from the response is reconciled into the activeCook record —
   * without this, every checkpoint after an offline cook start would stay
   * permanently stuck thinking the cook itself never synced.
   */
  function isCreateCookRequest(entry) {
    return entry.method === 'POST' && entry.url === '/api/cook-logs';
  }

  function createDefaultSendFn() {
    return function (entry) {
      return fetch(entry.url, {
        method: entry.method,
        headers: { 'content-type': 'application/json' },
        body: entry.body,
      }).then(function (res) {
        if (!res.ok) {
          if (res.status >= 500) throw new Error('retryable');
          // Permanent 4xx — retrying the identical payload won't help, so
          // this drops from the queue either way. But if it was the
          // cook-creation POST, the cook was never actually created
          // server-side: clear the (now-unrecoverable, id-less) local
          // placeholder too, rather than leaving it stuck forever with no
          // way for the UI to know the cook itself never synced.
          if (isCreateCookRequest(entry)) return clearActiveCook();
          return;
        }
        if (!isCreateCookRequest(entry)) return;
        return res
          .json()
          .then(function (data) {
            return getActiveCook().then(function (cook) {
              if (cook && cook.id == null && data && data.id) {
                return setActiveCook(Object.assign({}, cook, { id: data.id }));
              }
            });
          })
          .catch(function () {
            /* response wasn't valid JSON — nothing to reconcile */
          });
      });
    };
  }

  /**
   * Pure orchestration: replays queued entries in FIFO order via `sendFn`.
   * `sendFn(entry)` must resolve when the entry is handled (success, or a
   * permanent failure not worth retrying — e.g. a 4xx) and reject when it
   * should be retried later (offline, 5xx). Stops at the first rejection so
   * order is preserved and a still-offline queue isn't hammered — later
   * entries stay queued for the next drain attempt. Never throws.
   */
  function drainQueue(storage, sendFn) {
    return storage.getAll().then(function (entries) {
      var i = 0;
      function next() {
        if (i >= entries.length) return Promise.resolve();
        var entry = entries[i];
        return sendFn(entry).then(
          function () {
            return storage.remove(entry.id).then(function () {
              i++;
              return next();
            });
          },
          function () {
            /* retryable failure — stop here, leave this and later entries queued */
          }
        );
      }
      return next();
    });
  }

  root.SWQueueUtils = {
    drainQueue: drainQueue,
    createIndexedDbQueueStorage: createIndexedDbQueueStorage,
    createDefaultSendFn: createDefaultSendFn,
    getActiveCook: getActiveCook,
    setActiveCook: setActiveCook,
    clearActiveCook: clearActiveCook,
    clearAll: clearAll,
  };
})(typeof self !== 'undefined' ? self : globalThis);
