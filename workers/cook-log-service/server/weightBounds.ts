/*
 * Per-protein weight bounds, deliberately duplicated from
 * PROTEINS[...].thermal.geometry.weight_bounds in src/utils/proteinRegistry.js
 * rather than imported from it.
 *
 * Why duplicated instead of imported: this Worker's Cloudflare "Workers
 * Builds" project is configured with its Root Directory scoped to
 * workers/cook-log-service/ (a monorepo sub-project build) — that build
 * only ever checks out this subdirectory, so a relative import reaching
 * up into ../../../src/ resolves locally but fails in that isolated build
 * context ("Could not resolve ../../../src/utils/proteinRegistry.js").
 * This file keeps the Worker deployable from that isolated checkout.
 *
 * Kept honest, not just duplicated: workers/cook-log-service/__tests__/
 * weightBoundsSync.spec.ts imports both this file and proteinRegistry.js
 * (that spec runs from a full repo checkout, e.g. `npm test` in CI) and
 * fails the build if they ever drift apart. If you change a protein's
 * weight_bounds in proteinRegistry.js, update this file to match or that
 * test will catch it.
 *
 * Caveat inherited from proteinRegistry.js: pork_ribs has no weight-based
 * UI axis (ribs are planned by rack count, not raw weight), so its bound
 * (1-8) is actually a rack count, not pounds. Reused anyway because it's
 * the only per-protein bound the registry defines for ribs.
 */
export const WEIGHT_BOUNDS = {
  beef_brisket: { min: 4.0, max: 18.0 },
  pork_shoulder: { min: 4.0, max: 12.0 },
  pork_ribs: { min: 1, max: 8 },
  turkey: { min: 8, max: 24 },
} as const;
