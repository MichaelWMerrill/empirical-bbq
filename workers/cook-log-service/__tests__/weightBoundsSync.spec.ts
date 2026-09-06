import { describe, it, expect } from 'vitest';
import { WEIGHT_BOUNDS } from '../server/weightBounds';
import { PROTEINS } from '../../../src/utils/proteinRegistry.js';

/**
 * server/weightBounds.ts deliberately duplicates these bounds instead of
 * importing PROTEINS directly (see that file's header comment for why —
 * short version: this Worker's Cloudflare build is scoped to its own
 * subdirectory and can't reach ../../../src/). This spec is what keeps that
 * duplication honest: it runs from a full repo checkout (unlike the Worker's
 * own deploy build), so it can see both sources and will fail the moment
 * they drift apart.
 */
describe('cook-log-service weight bounds stay in sync with the calculator registry', () => {
  it.each(Object.keys(WEIGHT_BOUNDS) as (keyof typeof WEIGHT_BOUNDS)[])('%s', (protein) => {
    expect(WEIGHT_BOUNDS[protein]).toEqual(PROTEINS[protein].thermal.geometry.weight_bounds);
  });

  it('covers exactly the same set of proteins as the registry defines weight_bounds for', () => {
    const registryProteins = Object.keys(PROTEINS).filter((id) => PROTEINS[id].thermal?.geometry?.weight_bounds);
    expect(Object.keys(WEIGHT_BOUNDS).sort()).toEqual(registryProteins.sort());
  });
});
