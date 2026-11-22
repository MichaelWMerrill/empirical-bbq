import { describe, test, expect } from 'vitest';
import { PROTEINS } from '../proteinRegistry.js';
import { cookDuration } from '../stallEngine.js';
import { buildMilestones, PREHEAT_HOURS, HOUR_MS } from '../cookMilestones.js';

// Serve anchor as an absolute instant, so these tests do not depend on the time zone.
const SERVE = new Date('2026-07-18T18:00:00Z');
const BASE = { pitTemp: '225', pit: 'offset_smoker', wrap: 'peach_butcher_paper', wrapTemp: 160, climate: 'moderate' };

function plan(proteinId, state, rest = 1) {
  const protein = PROTEINS[proteinId];
  const duration = cookDuration(protein, state);
  const out = buildMilestones({ duration, inputs: { rest, wrap: state.wrap, wrapTemp: state.wrapTemp }, serve: SERVE });
  return { duration, out };
}
const ids = (out) => out.milestones.map((m) => m.id);
const at = (out, id) => out.milestones.find((m) => m.id === id)?.at.getTime();

describe('buildMilestones: stall method (brisket, pork)', () => {
  const state = { ...BASE, weight: 12 };

  test('works backward from serve: pull = serve - rest, meatOn = pull - totalTime, fireUp = meatOn - preheat', () => {
    const { duration, out } = plan('beef_brisket', state, 1);
    expect(out.pull.getTime()).toBe(SERVE.getTime() - HOUR_MS);
    expect(out.meatOn.getTime()).toBe(Math.trunc(out.pull.getTime() - duration.totalTime * HOUR_MS));
    expect(out.fireUp.getTime()).toBe(Math.trunc(out.meatOn.getTime() - PREHEAT_HOURS * HOUR_MS));
    expect(PREHEAT_HOURS).toBe(0.75);
  });

  test('milestones are exactly fire, on, wrap, pull, serve, in time order', () => {
    const { out } = plan('beef_brisket', state);
    expect(ids(out)).toEqual(['fire', 'on', 'wrap', 'pull', 'serve']);
    const times = out.milestones.map((m) => m.at.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(out.method).toBe('stall');
  });

  test('pins absolute offsets for the default brisket (same values the rendered-times characterization test pins)', () => {
    const { out } = plan('beef_brisket', state, 1);
    const before = (ms) => SERVE.getTime() - ms;
    expect(before(out.fireUp.getTime())).toBe(58546447);
    expect(before(out.meatOn.getTime())).toBe(55846447);
    expect(before(at(out, 'wrap'))).toBe(15828927);
    expect(before(out.pull.getTime())).toBe(3600000);
  });

  test('no wrap means no wrap milestone', () => {
    const { out } = plan('beef_brisket', { ...state, wrap: 'none' });
    expect(ids(out)).toEqual(['fire', 'on', 'pull', 'serve']);
  });

  test('a wrap temperature the path never reaches drops the wrap milestone instead of throwing', () => {
    const { out } = plan('beef_brisket', { ...state, wrapTemp: 500 });
    expect(ids(out)).not.toContain('wrap');
  });

  test('wrap lands where the engine path first reaches the wrap temperature, after meat on and before pull', () => {
    const { out } = plan('pork_shoulder', { ...state, weight: 8.5 });
    expect(at(out, 'wrap')).toBeGreaterThan(out.meatOn.getTime());
    expect(at(out, 'wrap')).toBeLessThan(out.pull.getTime());
  });

  test('stall onset and end are sums of engine durations, kept out of the shown milestones', () => {
    const { duration, out } = plan('beef_brisket', state);
    const m = duration.model;
    expect(out.stallOnset.getTime()).toBe(Math.trunc(out.meatOn.getTime() + m.t1 * HOUR_MS));
    expect(out.stallEnd.getTime()).toBe(Math.trunc(out.meatOn.getTime() + (m.t1 + m.stallDuration) * HOUR_MS));
    expect(out.stallOnset.getTime()).toBeLessThan(out.stallEnd.getTime());
    expect(ids(out)).not.toContain('stall');
  });

  test('longer rest moves pull, meat on and fire up earlier and leaves serve alone', () => {
    const a = plan('beef_brisket', state, 1).out;
    const b = plan('beef_brisket', state, 3).out;
    expect(b.serve.getTime()).toBe(a.serve.getTime());
    expect(a.pull.getTime() - b.pull.getTime()).toBe(2 * HOUR_MS);
    expect(a.fireUp.getTime() - b.fireUp.getTime()).toBe(2 * HOUR_MS);
  });
});

describe('buildMilestones: 3-2-1 method (ribs)', () => {
  const ribs = (cut) => ({ ...BASE, cut, racks: 3 });

  test('spare 3-2-1: exact block boundaries', () => {
    const { out } = plan('pork_ribs', ribs('spare'), 0.5);
    expect(out.method).toBe('method_321');
    expect(ids(out)).toEqual(['fire', 'on', 'wrap', 'sauce', 'pull', 'serve']);
    expect(at(out, 'wrap') - out.meatOn.getTime()).toBe(3 * HOUR_MS);
    expect(at(out, 'sauce') - out.meatOn.getTime()).toBe(5 * HOUR_MS);
    expect(out.pull.getTime() - at(out, 'sauce')).toBe(1 * HOUR_MS);
    expect(SERVE.getTime() - out.pull.getTime()).toBe(0.5 * HOUR_MS);
  });

  test('baby back uses the 2-2-1 blocks', () => {
    const { out } = plan('pork_ribs', ribs('baby_back'));
    expect(at(out, 'wrap') - out.meatOn.getTime()).toBe(2 * HOUR_MS);
    expect(at(out, 'sauce') - out.meatOn.getTime()).toBe(4 * HOUR_MS);
  });

  test('no stall markers for the fixed method', () => {
    const { out } = plan('pork_ribs', ribs('spare'));
    expect(out.stallOnset).toBeNull();
    expect(out.stallEnd).toBeNull();
  });
});

describe('buildMilestones: inputs and errors', () => {
  test('no stall markers for a no-stall protein', () => {
    const { out } = plan('turkey', { ...BASE, weight: 14, pitTemp: '325' });
    expect(out.stallOnset).toBeNull();
    expect(out.stallEnd).toBeNull();
  });

  test('rejects a missing or invalid serve time', () => {
    const duration = cookDuration(PROTEINS.beef_brisket, { ...BASE, weight: 12 });
    const inputs = { rest: 1, wrap: 'none', wrapTemp: 160 };
    expect(() => buildMilestones({ duration, inputs, serve: new Date('nope') })).toThrow(TypeError);
    expect(() => buildMilestones({ duration, inputs, serve: null })).toThrow(TypeError);
  });

  test('is pure: same inputs give identical output and the serve Date is not mutated', () => {
    const state = { ...BASE, weight: 12 };
    const serve = new Date(SERVE.getTime());
    const duration = cookDuration(PROTEINS.beef_brisket, state);
    const inputs = { rest: 1, wrap: state.wrap, wrapTemp: state.wrapTemp };
    const a = buildMilestones({ duration, inputs, serve });
    const b = buildMilestones({ duration, inputs, serve });
    expect(a).toEqual(b);
    expect(serve.getTime()).toBe(SERVE.getTime());
  });
});
