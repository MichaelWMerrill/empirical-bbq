import { describe, test, expect } from 'vitest';
import { PREFS_KEY, COOKER_CLASSES, DEFAULT_PREFS, readPrefs, writePrefs } from '../plannerPrefs.js';

function mem(initial) {
  const m = new Map(initial ? [[PREFS_KEY, initial]] : []);
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)) };
}

describe('plannerPrefs', () => {
  test('defaults to Pellet with no blanket', () => {
    expect(readPrefs(mem())).toEqual({ cooker: 'pellet', blanket: false });
    expect(DEFAULT_PREFS).toEqual({ cooker: 'pellet', blanket: false });
  });

  test('offers exactly the five cooker classes', () => {
    expect(COOKER_CLASSES.map((c) => c.label)).toEqual(['Pellet', 'Offset', 'Kamado', 'Kettle', 'Electric']);
  });

  test('stores only the two values, under one namespaced key', () => {
    const s = mem();
    writePrefs({ cooker: 'kamado' }, s);
    writePrefs({ blanket: true }, s);
    expect([...s.m.keys()]).toEqual(['ebq:cook-planner']);
    expect(JSON.parse(s.m.get(PREFS_KEY))).toEqual({ cooker: 'kamado', blanket: true });
    expect(readPrefs(s)).toEqual({ cooker: 'kamado', blanket: true });
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
