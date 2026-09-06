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
 */
self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});
