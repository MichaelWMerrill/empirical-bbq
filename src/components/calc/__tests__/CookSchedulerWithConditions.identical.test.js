// @vitest-environment happy-dom
/*
 * Proof that the conditions card changes nothing the scheduler outputs.
 *
 * For each case the real scheduler runs three ways:
 *   A. no conditions card at all,
 *   B. the card with a forecast loaded (auto-detected), a cooker class and the
 *      insulation blanket chosen,
 *   C. the card with manual conditions typed into the form.
 * The rendered headline, summary, warning and every timeline row, the exact
 * instant behind every formatted time, AND the arguments the scheduler passes to
 * the engine (cookDuration) must be identical across all three. The card must
 * also have visibly shown conditions in B and C, so the comparison is not vacuous.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import CookScheduler from '../CookScheduler.astro';
import { mountComponent } from './mount.js';
import { PROTEINS } from '../../../utils/proteinRegistry.js';
import pointsFixture from '../../../utils/__tests__/fixtures/nws-points.json';
import hourlyFixture from '../../../utils/__tests__/fixtures/nws-hourly.json';
import { fetchConditions, manualConditions } from '../../../utils/conditions.js';

vi.mock('../../../utils/stallEngine.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, cookDuration: vi.fn(actual.cookDuration) };
});
import { cookDuration } from '../../../utils/stallEngine.js';
import { initCookScheduler } from '../cookScheduler.controller.js';
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

// A week of hourly forecast from the recorded NWS shape (6 recorded hours, repeated with
// varying temperature and some gusts), starting before the cook so the window is covered.
function longForecast() {
  const base = hourlyFixture.properties.periods;
  const start = new Date('2026-07-16T12:00:00-06:00').getTime();
  const periods = Array.from({ length: 156 }, (_, i) => {
    const p = JSON.parse(JSON.stringify(base[i % base.length]));
    p.startTime = new Date(start + i * 3600 * 1000).toISOString();
    p.temperature = 60 + (i % 24);
    if (i % 5 === 0) p.windGust = '22 mph';
    return p;
  });
  return { properties: { ...hourlyFixture.properties, periods } };
}
const jsonRes = (body) => ({ ok: true, status: 200, json: async () => body });
const forecast = longForecast();
const loadForecast = () =>
  fetchConditions(40.13, -111.58, {
    fetchImpl: async (url) => jsonRes(url.includes('/points/') ? pointsFixture : forecast),
    storage: null,
    now: () => 0,
  });

const $ = (id) => document.getElementById(id);
const type = (id, v) => {
  $(id).value = String(v);
  $(id).dispatchEvent(new Event('input'));
};

async function run({ protein, state, serve = SERVE }, scenario) {
  document.body.innerHTML = '';
  localStorage.clear();
  cookDuration.mockClear();
  await mountComponent(CookScheduler);

  let card = null;
  if (scenario !== 'none') {
    const conditions = scenario === 'auto' ? await loadForecast() : null;
    card = initConditionsCard({
      deps: {
        getPosition: async () => ({ lat: 40.13, lon: -111.58 }),
        fetchConditions: async () => conditions,
        manualConditions,
        permissionState: async () => 'prompt',
      },
    });
  }
  const { state: s, render } = initCookScheduler(PROTEINS[protein], card ? { onSchedule: card.setWindow } : {});

  if (scenario === 'auto') {
    $('condUseBtn').click();
    await vi.waitFor(() => expect(card.getState().status).toBe('ready'));
    document.querySelector('[data-cooker=kamado]').click();
    $('condBlanket').checked = true;
    $('condBlanket').dispatchEvent(new Event('change'));
  } else if (scenario === 'manual') {
    $('condManualBtn').click();
    type('condElev', 7000);
    type('condLow', 70); // invalid first: low above high
    type('condHigh', 50);
    type('condHigh', 85);
    type('condWind', 15);
    $('condForm').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(card.getState().source).toBe('manual');
    document.querySelector('[data-cooker=electric]').click();
  }

  const instants = [];
  const orig = Date.prototype.toLocaleString;
  const spy = vi.spyOn(Date.prototype, 'toLocaleString').mockImplementation(function (_l, o) {
    instants.push(this.getTime());
    return orig.call(this, 'en-US', o);
  });
  Object.assign(s, state, { serveAt: serve });
  instants.length = 0;
  cookDuration.mockClear();
  render();
  spy.mockRestore();

  const serveMs = new Date(serve).getTime();
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
    shown: scenario === 'none' ? null : Object.fromEntries([...document.querySelectorAll('#condRows [data-row]')].map((r) => [r.dataset.row, r.querySelector('dd').textContent])),
  };
}

describe('scheduler output is identical with and without the conditions card', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 5, 1, 12, 0, 0));
  });
  afterEach(() => vi.useRealTimers());

  for (const c of CASES) {
    it(c.name, async () => {
      const none = await run(c, 'none');
      const auto = await run(c, 'auto');
      const manual = await run(c, 'manual');

      // The card really displayed conditions (not a vacuous comparison).
      expect(auto.shown.temp).toMatch(/°F$/);
      expect(auto.shown.gust).toBe('up to 22 mph');
      expect(auto.shown.boil).toBe('203°F');
      expect(manual.shown).toMatchObject({ elevation: '7,000 ft', boil: '199°F', temp: '70 to 85°F', wind: '15 mph' });

      // Same rendered text, same instants, same engine calls.
      expect(auto.out).toEqual(none.out);
      expect(manual.out).toEqual(none.out);
      expect(none.out.engineArgs.length).toBeGreaterThan(0);
    });
  }

  it('no condition, cooker or blanket value reaches the engine', async () => {
    const r = await run(CASES[0], 'auto');
    for (const [, st] of r.out.engineArgs) {
      expect(Object.keys(st).sort()).toEqual(['climate', 'cut', 'pit', 'pitTemp', 'weight', 'wrap', 'wrapTemp']);
    }
  });
});
