/*
 * Valid cut ids per protein, deliberately duplicated from the registry's cut axis
 * (PROTEINS[...] axes with id 'cut') for the same reason weightBounds.ts is: this
 * Worker's build can't import from ../../src/. __tests__/cutIdsSync.spec.ts keeps it honest.
 *
 * `cut` has no SQL CHECK, so adding a cut to the registry means: update this file (the
 * sync test fails until you do). No migration.
 *
 * Only pork shoulder and ribs have a cut. Brisket and turkey reject a cut.
 */
export const CUT_IDS: Record<string, readonly string[]> = {
  pork_shoulder: ['bone_in', 'boneless'],
  pork_ribs: ['spare', 'st_louis', 'baby_back'],
};
