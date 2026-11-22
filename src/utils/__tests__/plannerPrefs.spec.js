import { describe, test, expect } from 'vitest';
import { PREFS_KEY, COOKER_CLASSES, DEFAULT_PREFS, readPrefs, writePrefs } from '../plannerPrefs.js';

function mem(initial) {
  const m = new Map(initial ? [[PREFS_KEY, initial]] : []);
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)) };
}

describe('plannerPrefs', () => {
  test('defaults to Pellet, no blanket, and no auto-locate decision yet', () => {
    expect(readPrefs(mem())).toEqual({ cooker: 'pellet', blanket: false, autoLocate: null });
    expect(DEFAULT_PREFS).toEqual({ cooker: 'pellet', blanket: false, autoLocate: null });
  });

  test('offers exactly the five cooker classes', () => {
    expect(COOKER_CLASSES.map((c) => c.label)).toEqual(['Pellet', 'Offset', 'Kamado', 'Kettle', 'Electric']);
  });

  test('stores only the cooker id and booleans, under one namespaced key', () => {
    const s = mem();
    writePrefs({ cooker: 'kamado' }, s);
    writePrefs({ blanket: true }, s);
    writePrefs({ autoLocate: true }, s);
    expect([...s.m.keys()]).toEqual(['ebq:cook-planner']);
    expect(JSON.parse(s.m.get(PREFS_KEY))).toEqual({ cooker: 'kamado', blanket: true, autoLocate: true });
    expect(readPrefs(s)).toEqual({ cooker: 'kamado', blanket: true, autoLocate: true });
  });

  test('autoLocate is a tri-state: null until decided, then true or false', () => {
    const s = mem();
    expect(readPrefs(s).autoLocate).toBeNull();
    writePrefs({ autoLocate: true }, s);
    expect(readPrefs(s).autoLocate).toBe(true);
    writePrefs({ autoLocate: false }, s);
    expect(readPrefs(s).autoLocate).toBe(false);
  });

  test('an invalid autoLocate value is ignored and reads back as undecided', () => {
    const s = mem();
    writePrefs({ autoLocate: 'yes' }, s);
    expect(readPrefs(s).autoLocate).toBeNull();
    expect(readPrefs(mem(JSON.stringify({ autoLocate: 1 }))).autoLocate).toBeNull();
  });

  test('ignores invalid values and falls back to defaults on bad stored data', () => {
    const s = mem();
    writePrefs({ cooker: 'gas grill', blanket: 'yes' }, s);
    expect(readPrefs(s)).toEqual(DEFAULT_PREFS);
    expect(readPrefs(mem('{not json'))).toEqual(DEFAULT_PREFS);
    expect(readPrefs(mem('[1,2]'))).toEqual(DEFAULT_PREFS);
    expect(readPrefs(mem(JSON.stringify({ cooker: 'nope', blanket: 1 })))).toEqual(DEFAULT_PREFS);
  });

  test('keeps other keys already under the namespace when writing', () => {
    const s = mem(JSON.stringify({ calendar: 'google' }));
    writePrefs({ cooker: 'offset' }, s);
    expect(JSON.parse(s.m.get(PREFS_KEY))).toEqual({ calendar: 'google', cooker: 'offset' });
  });

  test('never throws when storage is blocked or missing', () => {
    const boom = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readPrefs(boom)).toEqual(DEFAULT_PREFS);
    expect(() => writePrefs({ cooker: 'kettle' }, boom)).not.toThrow();
    expect(readPrefs(null)).toEqual(DEFAULT_PREFS);
  });
});
