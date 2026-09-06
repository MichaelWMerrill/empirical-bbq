/*
 * Service Worker for the installable PWA shell.
 *
 * Conservative on purpose: this is a content site with blog posts shipping
 * twice a week and a live Search Console crawl-budget investigation, so
 * nothing here may risk serving stale HTML or interfering with API calls.
 * See sw-cache-utils.js (loaded below) for what actually gets cached and why.
 *
 * This file stays a classic (non-module) script deliberately, for maximum
 * browser support — `importScripts` requires classic scope.
 *
 * CACHE_VERSION lives HERE, not in sw-cache-utils.js, on purpose: browsers
 * decide whether there's a "new" Service Worker by byte-diffing this file
 * (the one passed to register()) — files pulled in via importScripts() are
 * not part of that comparison. A version bump anywhere else would never
 * trigger install/activate, so the stale-cache cleanup below would silently
 * never run. Bump this whenever the caching strategy changes (not on every
 * content deploy — hashed asset filenames already change on their own when
 * their content does).
 */
importScripts('/sw-cache-utils.js');
var CACHE_VERSION = 'v1';
var STATIC_CACHE_NAME = self.SWCacheUtils.STATIC_CACHE_PREFIX + CACHE_VERSION;

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url = new URL(request.url);
  // Only same-origin, content-hashed build assets are ever intercepted.
  // Everything else — HTML navigations, /api/contact, /api/cook-logs*,
  // unhashed public/ files — falls through untouched and hits the network
  // exactly as if this Service Worker didn't exist.
  if (url.origin !== self.location.origin || !self.SWCacheUtils.isStaticAsset(url.pathname)) return;

  event.respondWith(
    caches.open(STATIC_CACHE_NAME).then(function (cache) {
      return cache.match(request).then(function (cached) {
        if (cached) return cached;
        return fetch(request).then(function (response) {
          if (response && response.ok) cache.put(request, response.clone());
          return response;
        });
      });
    })
  );
});
