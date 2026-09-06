import { describe, it, expect } from 'vitest';

// Side-effect import: public/sw-cache-utils.js is a classic script (no
// import/export, so it can also be loaded via importScripts() in the real
// Service Worker) that attaches itself to globalThis when there's no `self`
// (i.e. in Node). This tests the exact code the Service Worker runs.
import '../../../public/sw-cache-utils.js';

const { isStaticAsset, getStaleCacheNames, STATIC_CACHE_PREFIX } = globalThis.SWCacheUtils;
const CURRENT_CACHE_NAME = STATIC_CACHE_PREFIX + 'v1';

describe('isStaticAsset', () => {
  it('matches Astro content-hashed build assets', () => {
    expect(isStaticAsset('/_astro/brisketEngine.CoWg8DUn.js')).toBe(true);
    expect(isStaticAsset('/_astro/about.CC3oDp5Q.css')).toBe(true);
  });

  it('does not match HTML pages, API routes, or unhashed public/ files', () => {
    expect(isStaticAsset('/brisket-calculator')).toBe(false);
    expect(isStaticAsset('/')).toBe(false);
    expect(isStaticAsset('/api/contact')).toBe(false);
    expect(isStaticAsset('/api/cook-logs')).toBe(false);
    expect(isStaticAsset('/api/cook-logs/abc-123')).toBe(false);
    expect(isStaticAsset('/favicon.ico')).toBe(false);
    expect(isStaticAsset('/sw.js')).toBe(false);
  });
});

describe('getStaleCacheNames', () => {
  it('keeps the current cache and flags older-versioned ones for deletion', () => {
    const names = [CURRENT_CACHE_NAME, 'cook-static-v0', 'some-unrelated-cache'];
    expect(getStaleCacheNames(names, CURRENT_CACHE_NAME)).toEqual(['cook-static-v0']);
  });

  it('returns nothing to delete when only the current cache exists', () => {
    expect(getStaleCacheNames([CURRENT_CACHE_NAME], CURRENT_CACHE_NAME)).toEqual([]);
  });

  it('never flags caches outside its own prefix', () => {
    expect(getStaleCacheNames(['some-other-app-cache'], CURRENT_CACHE_NAME)).toEqual([]);
  });
});
