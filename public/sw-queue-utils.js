/*
 * Local persistence for the cook-log capture UI's in-progress "active cook"
 * record — IndexedDB rather than localStorage because it has to survive the
 * app being closed mid-cook just as reliably as any other cook data.
 *
 * Classic script (no import/export), loaded two ways from one source of
 * truth: importScripts('/sw-queue-utils.js') from the Service Worker (once
 * the offline write queue lands here in a later commit), and a side-effect
 * `import '.../public/sw-queue-utils.js'` from the page controller, reading
 * window.SWQueueUtils.
 */
(function (root) {
  var DB_NAME = 'cook-log-client';
  var DB_VERSION = 1;
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

  /** Opt-out: wipe anything in-progress locally. */
  function clearAll() {
    return clearActiveCook();
  }

  root.SWQueueUtils = {
    getActiveCook: getActiveCook,
    setActiveCook: setActiveCook,
    clearActiveCook: clearActiveCook,
    clearAll: clearAll,
  };
})(typeof self !== 'undefined' ? self : globalThis);
