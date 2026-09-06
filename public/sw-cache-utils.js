/*
 * Pure helpers for the Service Worker's static-asset caching.
 *
 * Classic script (no import/export) so sw.js can load it with
 * importScripts(). The same file is also imported for its side effects by
 * a Vitest spec (src/utils/__tests__/swCacheUtils.spec.js) — it attaches
 * itself to `self` in a Service Worker and to `globalThis` in Node — so
 * this logic is unit-tested against the exact code the Service Worker runs,
 * not a re-implementation that could drift.
 */
(function (root) {
  // NOTE: the version number itself is NOT defined here — see CACHE_VERSION
  // in sw.js for why (short version: browsers only detect a new Service
  // Worker by byte-diffing sw.js's own script; a version bump anywhere else,
  // e.g. in this importScripts()-loaded file, would never trigger
  // install/activate, and the stale-cache cleanup below would silently never
  // run). This file only owns the prefix and the pure matching logic.
  var STATIC_CACHE_PREFIX = 'cook-static-';

  // Astro's content-hashed build output (JS/CSS bundles). Filenames change
  // whenever their content does, so caching them cache-first can never serve
  // stale code. Everything else — HTML pages, /api/*, unhashed public/
  // assets like favicons — is intentionally excluded.
  function isStaticAsset(pathname) {
    return pathname.indexOf('/_astro/') === 0;
  }

  function getStaleCacheNames(cacheNames, currentCacheName) {
    return cacheNames.filter(function (name) {
      return name.indexOf(STATIC_CACHE_PREFIX) === 0 && name !== currentCacheName;
    });
  }

  root.SWCacheUtils = {
    STATIC_CACHE_PREFIX: STATIC_CACHE_PREFIX,
    isStaticAsset: isStaticAsset,
    getStaleCacheNames: getStaleCacheNames,
  };
})(typeof self !== 'undefined' ? self : globalThis);
