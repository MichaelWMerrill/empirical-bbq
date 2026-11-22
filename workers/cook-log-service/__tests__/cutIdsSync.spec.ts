import { describe, it, expect } from 'vitest';
import { CUT_IDS } from '../server/cutIds';
import { PROTEINS } from '../../../src/utils/proteinRegistry.js';

/** Every cut axis the registry defines for a protein (yield and thermal blocks). */
function registryCutIds(protein: string): string[] {
  const p = PROTEINS[protein];
  const axes = [...(p.yield?.axes ?? []), ...(p.thermal?.axes ?? [])];
  const ids = new Set<string>();
  for (const axis of axes) {
    if (axis.id === 'cut') for (const o of axis.options) ids.add(o.value);
  }
  return [...ids];
}

/**
 * server/cutIds.ts duplicates the registry's cut ids (the Worker's build can't import
 * from src/). This spec fails the moment the two drift, so a new cut can't silently
 * start being rejected (or accepted) by the Worker.
 */
describe('cook-log-service cut ids stay in sync with the calculator registry', () => {
  it.each(Object.keys(CUT_IDS))('%s', (protein) => {
    expect([...CUT_IDS[protein]].sort()).toEqual(registryCutIds(protein).sort());
  });

  it('covers exactly the proteins that have a cut axis in the registry', () => {
    const withCut = Object.keys(PROTEINS).filter((id) => registryCutIds(id).length > 0);
    expect(Object.keys(CUT_IDS).sort()).toEqual(withCut.sort());
  });
});
