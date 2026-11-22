// @vitest-environment happy-dom
/*
 * Proof that the Add to calendar panel changes nothing the scheduler outputs.
 *
 * For each case the real scheduler runs three ways:
 *   A. no panel at all,
 *   B. the panel, driven hard (calendar choice, step toggles, reminder, downloads),
 *   C. the panel together with the conditions card (a forecast loaded, which also moves the panel's time zone).
 * The rendered headline, summary, warning and every timeline row, the exact instant behind every formatted time,
 * the timeline HTML AND the arguments the scheduler passes to the engine (cookDuration) must be identical across
 * all three. The panel must also have visibly listed steps, so the comparison is not vacuous.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import CookScheduler from '../CookScheduler.astro';
import { mountComponent } from './mount.js';
import { PROTEINS } from '../../../utils/proteinRegistry.js';
import pointsFixture from '../../../utils/__tests__/fixtures/nws-points.json';
import hourlyFixture from '../../../utils/__tests__/fixtures/nws-hourly.json';
import { fetchConditions } from '../../../utils/conditions.js';

vi.mock('../../../utils/stallEngine.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, cookDuration: vi.fn(actual.cookDuration) };
});
import { cookDuration } from '../../../utils/stallEngine.js';
import { initCookScheduler } from '../cookScheduler.controller.js';
import { initAddToCalendar } from '../addToCalendar.controller.js';
import { initConditionsCard } from '../conditionsCard.controller.js';

const SERVE = '2026-07-18T18:00';
const BASE = { pitTemp: '225', pit: 'offset_smoker', wrap: 'peach_butcher_paper', wrapTemp: 160, climate: 'moderate', rest: 1 };
const CASES = [
  { name: 'brisket default', protein: 'beef_brisket', state: { ...BASE, weight: 12 } },
  { name: 'brisket foil 18 lb 250 arid', protein: 'beef_brisket', state: { ...BASE, weight: 18, wrap: 'aluminum_foil', wrapTemp: 165, pitTemp: '250', climate: 'arid', pit: 'pellet_cooker', rest: 2 } },
  { name: 'brisket unwrapped 275 humid', protein: 'beef_brisket', state: { ...BASE, weight: 8.5, wrap: 'none', pitTemp: '275', climate: 'humid', pit: 'ceramic_kamado', rest: 0.5 } },
  { name: 'pork paper 8.5 lb', protein: 'pork_shoulder', state: { ...BASE, weight: 8.5, pit: 'ceramic_kamado' } },
  { name: 'pork foil 11 lb humid', protein: 'pork_shoulder', state: { ...BASE, weight: 11, wrap: 'aluminum_foil', pitTemp: '250', climate: 'humid', pit: 'charcoal_kettle', rest: 3 } },
  { name: 'ribs spare 3-2-1', protein: 'pork_ribs', state: { ...BASE, cut: 'spare', racks: 3, rest: 0.5 } },
  { name: 'ribs baby back 2-2-1', protein: 'pork_ribs', state: { ...BASE, cut: 'baby_back', racks: 4, pitTemp: '275', rest: 1.5 } },
];

const jsonRes = (b) => ({ ok: true, status: 200, json: async () => b });
const loadForecast = () =>
  fetchConditions(40.13, -111.58, {
    fetchImpl: async (u) => jsonRes(u.includes('/points/') ? pointsFixture : hourlyFixture),
    storage: null,
    now: () => 0,
  });

const $ = (id) => document.getElementById(id);
const toggle = (id) => {
  const box = $(`calStep-${id}`);
  if (!box) return; // not every protein has every step (ribs have no stall)
  box.checked = !box.checked;
  box.dispatchEvent(new Event('change', { bubbles: true }));
};
const uncheckAll = () => {
  for (const box of document.querySelectorAll('#calSteps input')) if (box.checked) toggle(box.dataset.step);
};

async function run({ protein, state }, scenario) {
  document.body.innerHTML = '';
  localStorage.clear();
  cookDuration.mockClear();
  await mountComponent(CookScheduler);

  let card = null;
  let cal = null;
  const download = vi.fn();
  if (scenario === 'both') {
    const conditions = await loadForecast();
    card = initConditionsCard({
      deps: { getPosition: async () => ({ lat: 40.13, lon: -111.58 }), fetchConditions: async () => conditions, permissionState: async () => 'prompt' },
    });
  }
  if (scenario !== 'none') {
    cal = initAddToCalendar({ getTimeZone: card ? card.getTimeZone : () => null, deps: { download, now: () => 0, browserZone: () => 'America/Los_Angeles' } });
  }
  const sched = initCookScheduler(PROTEINS[protein], { onSchedule: card?.setWindow, onPlan: cal?.setPlan });

  if (scenario !== 'none') {
    // before the instant under test: drive the panel (and the card) as hard as a person could
    Object.assign(sched.state, state, { serveAt: SERVE });
    sched.render();
    document.querySelector('[data-calendar=google]').click();
    toggle('prep');
    toggle('stall');
    document.querySelector('[data-calendar=outlook]').click();
    $('calReminder').value = '30';
    $('calReminder').dispatchEvent(new Event('change'));
    $('calDownload').click();
    document.querySelector('[data-calendar=apple]').click();
    uncheckAll();
    $('calDownload').click(); // nothing checked: the "pick a step" path
    if (card) {
      $('condUseBtn').click();
      await vi.waitFor(() => expect(card.getState().status).toBe('ready'));
    }
  }

  const instants = [];
  const orig = Date.prototype.toLocaleString;
  const spy = vi.spyOn(Date.prototype, 'toLocaleString').mockImplementation(function (_l, o) {
    instants.push(this.getTime());
    return orig.call(this, 'en-US', o);
  });
  Object.assign(sched.state, state, { serveAt: SERVE });
  instants.length = 0;
  cookDuration.mockClear();
  sched.render();
  spy.mockRestore();

  const serveMs = new Date(SERVE).getTime();
  const warn = $('warnBox');
  return {
    out: {
      headline: $('fireUpBig').textContent,
      summary: $('totalSub').textContent,
      warn: warn.classList.contains('hidden') ? null : warn.textContent,
      rows: [...$('timeline').children].map((li) => [...li.querySelectorAll('p')].map((p) => p.textContent).join(' || ')),
      msBeforeServe: instants.map((t) => serveMs - t),
      engineArgs: cookDuration.mock.calls.map(([p, st]) => [p.meta.id, st]),
      timelineDom: $('timeline').innerHTML,
    },
    panelSteps: scenario === 'none' ? null : [...document.querySelectorAll('#calSteps input')].length,
    downloads: download.mock.calls.length,
  };
}

describe('scheduler output is identical with and without the Add to calendar panel', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 5, 1, 12, 0, 0));
  });
  afterEach(() => vi.useRealTimers());

  for (const c of CASES) {
    it(c.name, async () => {
      const none = await run(c, 'none');
      const panel = await run(c, 'panel');
      const both = await run(c, 'both');

      // The panel really listed steps and downloaded once (the second click had nothing checked): not a vacuous comparison.
      expect(panel.panelSteps).toBeGreaterThanOrEqual(7);
      expect(panel.downloads).toBe(1);
      expect(both.panelSteps).toBeGreaterThanOrEqual(7);

      // Same rendered text, same instants, same timeline, same engine calls.
      expect(panel.out).toEqual(none.out);
      expect(both.out).toEqual(none.out);
      expect(none.out.engineArgs.length).toBeGreaterThan(0);
    });
  }

  it('no calendar, panel or condition value reaches the engine', async () => {
    const r = await run(CASES[0], 'both');
    for (const [, st] of r.out.engineArgs) {
      expect(Object.keys(st).sort()).toEqual(['climate', 'cut', 'pit', 'pitTemp', 'weight', 'wrap', 'wrapTemp']);
    }
  });
});
