// @vitest-environment happy-dom
/*
 * DOM tests for the conditions card, mounted inside the real scheduler page
 * markup. No network and no real geolocation: the card's dependencies are injected.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import CookScheduler from '../CookScheduler.astro';
import { mountComponent } from './mount.js';
import pointsFixture from '../../../utils/__tests__/fixtures/nws-points.json';
import hourlyFixture from '../../../utils/__tests__/fixtures/nws-hourly.json';
import { fetchConditions, ConditionsError } from '../../../utils/conditions.js';
import { initConditionsCard, validateManual, MANUAL_LIMITS } from '../conditionsCard.controller.js';
import { PREFS_KEY } from '../../../utils/plannerPrefs.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const jsonRes = (body) => ({ ok: true, status: 200, json: async () => body });
const nwsConditions = (hourly = hourlyFixture) =>
  fetchConditions(40.13, -111.58, {
    fetchImpl: async (url) => jsonRes(url.includes('/points/') ? pointsFixture : hourly),
    storage: null,
    now: () => 0,
  });

const WINDOW = { start: new Date('2026-11-22T14:00:00-07:00'), end: new Date('2026-11-22T17:00:00-07:00') };
const $ = (id) => document.getElementById(id);
const hidden = (id) => $(id).classList.contains('hidden');
const text = (id) => $(id).textContent.trim();
const rows = () => Object.fromEntries([...document.querySelectorAll('#condRows [data-row]')].map((r) => [r.dataset.row, r.querySelector('dd').textContent]));
const type = (id, value) => {
  $(id).value = String(value);
  $(id).dispatchEvent(new Event('input'));
};

async function setup({ permission = 'prompt', position = { lat: 40.13, lon: -111.58 }, conditions, fetchImpl } = {}) {
  await mountComponent(CookScheduler);
  const getPosition = vi.fn(async () => {
    if (position instanceof Error) throw position;
    return position;
  });
  const fetchC = fetchImpl ?? vi.fn(async () => conditions ?? (await nwsConditions()));
  const realManual = (await import('../../../utils/conditions.js')).manualConditions;
  const manualConditions = vi.fn((v) => realManual(v));
  const card = initConditionsCard({ deps: { getPosition, fetchConditions: fetchC, manualConditions, permissionState: async () => permission } });
  card.setWindow(WINDOW);
  await card.ready;
  return { card, getPosition, fetchC, manualConditions };
}

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  sessionStorage.clear();
});

describe('location flow', () => {
  it('does not ask for location on page load; shows the button and the manual link', async () => {
    const { getPosition } = await setup({ permission: 'prompt' });
    expect(getPosition).not.toHaveBeenCalled();
    expect(text('condUseBtn')).toBe('Use my location');
    expect(text('condManualBtn')).toBe('Enter manually');
    expect(hidden('condIntro')).toBe(false);
    expect(hidden('condBody')).toBe(true);
  });

  it('shows the button when the Permissions API is missing', async () => {
    const { getPosition } = await setup({ permission: null });
    expect(getPosition).not.toHaveBeenCalled();
    expect(hidden('condActions')).toBe(false);
  });

  it('shows the button when location was denied, without prompting', async () => {
    const { getPosition } = await setup({ permission: 'denied' });
    expect(getPosition).not.toHaveBeenCalled();
    expect(hidden('condActions')).toBe(false);
  });

  it('fetches automatically when geolocation is already granted', async () => {
    const { getPosition, fetchC, card } = await setup({ permission: 'granted' });
    expect(getPosition).toHaveBeenCalledTimes(1);
    expect(fetchC).toHaveBeenCalledWith(40.13, -111.58);
    expect(card.getState()).toMatchObject({ status: 'ready', source: 'nws' });
    expect(text('condPill')).toBe('Auto-detected');
    expect(text('condPlace')).toBe('Mapleton, UT');
  });

  it('tapping the button loads, with a live "loading" message while it waits', async () => {
    let release;
    const slow = vi.fn(() => new Promise((res) => (release = res)));
    const { card } = await setup({ fetchImpl: slow });
    $('condUseBtn').click();
    await vi.waitFor(() => expect(card.getState().status).toBe('loading'));
    expect($('condStatus').getAttribute('aria-live')).toBe('polite');
    expect(hidden('condStatus')).toBe(false);
    expect(text('condStatus')).toBe('Finding your forecast');
    expect(hidden('condActions')).toBe(true);
    release(await nwsConditions());
    await vi.waitFor(() => expect(card.getState().status).toBe('ready'));
    expect(hidden('condStatus')).toBe(true);
  });

  it('shows the conditions: rows, boiling point, hourly strip in the cook zone, credit, planning line', async () => {
    await setup({ permission: 'granted' });
    expect(rows()).toEqual({ elevation: '4,797 ft', boil: '203°F', temp: '44 to 46°F', wind: '1 mph average', dew: '27°F average', sky: 'Mostly Cloudy' });
    expect(text('condStripLabel')).toBe('Times in Mountain Time');
    expect(document.querySelectorAll('#condStripGrid li')).toHaveLength(3);
    expect(document.querySelector('#condRows [data-row=sky]').textContent).toContain('Sky is shown for reference only.');
    expect(hidden('condCredit')).toBe(false);
    expect(text('condPlanningLine')).toBe("Shown for planning. The time estimate doesn't use these conditions yet.");
    expect(text('condCredit')).toBe('Forecast: National Weather Service');
  });

  it('hides the gust line when there are no gusts, shows it when there are', async () => {
    await setup({ permission: 'granted' });
    expect(document.querySelector('[data-row=gust]')).toBeNull();
    document.body.innerHTML = '';
    const h = clone(hourlyFixture);
    h.properties.periods[2].windGust = '25 mph';
    await setup({ permission: 'granted', conditions: await nwsConditions(h) });
    expect(rows().gust).toBe('up to 25 mph');
  });

  it('recomputes for a new cook window without fetching again', async () => {
    const { card, fetchC } = await setup({ permission: 'granted' });
    expect(rows().temp).toBe('44 to 46°F');
    card.setWindow({ start: new Date('2026-11-22T17:00:00-07:00'), end: new Date('2026-11-22T22:00:00-07:00') });
    expect(rows().temp).toBe('40 to 42°F');
    expect(text('condNote')).toContain('3 hours of this cook fall outside the forecast range');
    card.setWindow(null);
    expect(text('condNote')).toBe('Pick a serving time to see the forecast for your cook.');
    expect(fetchC).toHaveBeenCalledTimes(1);
  });
});

describe('error states', () => {
  const cases = [
    ['denied', 'Location is blocked for this site. Allow it in your browser settings, or enter conditions manually.', true],
    ['unavailable', 'Your location could not be found. Try again, or enter conditions manually.', true],
    ['timeout', 'Finding your location took too long. Try again, or enter conditions manually.', true],
    ['unsupported', 'This browser cannot share its location. Enter conditions manually.', false],
  ];
  for (const [code, message, retry] of cases) {
    it(`position ${code}`, async () => {
      const { card } = await setup({ position: new ConditionsError(code) });
      $('condUseBtn').click();
      await vi.waitFor(() => expect(card.getState().status).toBe('error'));
      expect(text('condStatus')).toBe(message);
      expect($('condStatus').getAttribute('aria-live')).toBe('polite');
      expect(hidden('condManualBtn')).toBe(false);
      expect(hidden('condUseBtn')).toBe(!retry);
      if (retry) expect(text('condUseBtn')).toBe('Try again');
    });
  }

  const forecastCases = [
    ['outside_coverage', "The National Weather Service forecast doesn't cover this location. It covers the United States and its territories. Enter conditions manually.", false],
    ['upstream', 'The forecast service is not responding right now. Try again, or enter conditions manually.', true],
    ['network', 'The forecast could not be reached. Check your connection, or enter conditions manually.', true],
  ];
  for (const [code, message, retry] of forecastCases) {
    it(`forecast ${code}`, async () => {
      const { card } = await setup({ fetchImpl: vi.fn(async () => { throw new ConditionsError(code); }) });
      $('condUseBtn').click();
      await vi.waitFor(() => expect(card.getState().status).toBe('error'));
      expect(text('condStatus')).toBe(message);
      expect(hidden('condManualBtn')).toBe(false);
      expect(hidden('condUseBtn')).toBe(!retry);
    });
  }

  it('the manual form is reachable from an error state', async () => {
    const { card } = await setup({ position: new ConditionsError('denied') });
    $('condUseBtn').click();
    await vi.waitFor(() => expect(card.getState().status).toBe('error'));
    $('condManualBtn').click();
    expect(hidden('condForm')).toBe(false);
    expect(hidden('condStatus')).toBe(true);
  });
});

describe('manual form', () => {
  it('requires elevation, low and high, with inline messages', async () => {
    const { manualConditions } = await setup();
    $('condManualBtn').click();
    $('condForm').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(text('condElevErr')).toBe(MANUAL_LIMITS.elevation.message);
    expect(text('condLowErr')).toBe(MANUAL_LIMITS.temp.message);
    expect(text('condHighErr')).toBe(MANUAL_LIMITS.temp.message);
    expect(text('condWindErr')).toBe('');
    expect($('condElev').getAttribute('aria-invalid')).toBe('true');
    expect(manualConditions).not.toHaveBeenCalled();
  });

  it('shows "The low must be at or below the high." inline, as soon as both are filled, and blocks submit', async () => {
    const { manualConditions, card } = await setup();
    $('condManualBtn').click();
    type('condElev', 5200);
    type('condLow', 70);
    expect(text('condRangeErr')).toBe(''); // high not filled yet
    type('condHigh', 50);
    expect(text('condRangeErr')).toBe('The low must be at or below the high.');
    expect($('condLow').getAttribute('aria-invalid')).toBe('true');
    expect($('condHigh').getAttribute('aria-invalid')).toBe('true');
    expect($('condLow').getAttribute('aria-describedby')).toContain('condRangeErr');
    $('condForm').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(manualConditions).not.toHaveBeenCalled(); // the UI never relies on the module's swap
    expect(card.getState().status).toBe('idle');
    expect(hidden('condForm')).toBe(false);
  });

  it('accepts a low equal to the high, clears the message, and shows manual conditions', async () => {
    const { manualConditions, card } = await setup();
    $('condManualBtn').click();
    type('condElev', 5200);
    type('condLow', 70);
    type('condHigh', 50);
    type('condHigh', 70);
    expect(text('condRangeErr')).toBe('');
    $('condForm').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(manualConditions).toHaveBeenCalledWith({ elevationFt: 5200, lowF: 70, highF: 70, windMph: null });
    expect(card.getState()).toMatchObject({ status: 'ready', source: 'manual' });
    expect(text('condPill')).toBe('Manual');
    expect(rows()).toEqual({ elevation: '5,200 ft', boil: '203°F', temp: '70°F' });
    expect(hidden('condCredit')).toBe(true);
    expect(hidden('condStrip')).toBe(true);
    expect(text('condManualBtn')).toBe('Edit');
  });

  it('wind is optional but checked when given', async () => {
    await setup();
    $('condManualBtn').click();
    type('condElev', 100);
    type('condLow', 40);
    type('condHigh', 60);
    type('condWind', 500);
    $('condForm').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(text('condWindErr')).toBe(MANUAL_LIMITS.wind.message);
    type('condWind', 12);
    $('condForm').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(rows().wind).toBe('12 mph');
  });

  it('Back closes the form', async () => {
    await setup();
    $('condManualBtn').click();
    $('condFormBack').click();
    expect(hidden('condForm')).toBe(true);
    expect(hidden('condActions')).toBe(false);
  });

  it('validateManual', () => {
    expect(validateManual({ elevation: '4797', low: '38', high: '62', wind: '' }).ok).toBe(true);
    expect(validateManual({ elevation: '', low: '', high: '', wind: '' }).ok).toBe(false);
    expect(validateManual({ elevation: '1', low: '60', high: '40', wind: '' }).errors).toEqual({ range: 'The low must be at or below the high.' });
    expect(validateManual({ elevation: '99999', low: '1', high: '2', wind: '' }).errors.elevation).toBeTruthy();
    expect(validateManual({ elevation: '1', low: 'abc', high: '2', wind: '' }).errors.low).toBeTruthy();
  });
});

describe('cooker class and blanket', () => {
  const pressed = () => [...document.querySelectorAll('.cond-cooker-opt')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent);

  it('defaults to Pellet and remembers a choice on the device, in one namespaced key', async () => {
    await setup();
    expect(pressed()).toEqual(['Pellet']);
    document.querySelector('[data-cooker=kamado]').click();
    $('condBlanket').checked = true;
    $('condBlanket').dispatchEvent(new Event('change'));
    expect(pressed()).toEqual(['Kamado']);
    expect(localStorage.length).toBe(1);
    expect(JSON.parse(localStorage.getItem(PREFS_KEY))).toEqual({ cooker: 'kamado', blanket: true });

    document.body.innerHTML = '';
    await setup(); // a fresh page load
    expect(pressed()).toEqual(['Kamado']);
    expect($('condBlanket').checked).toBe(true);
  });

  it('offers the five classes as real buttons with aria-pressed, and a labeled checkbox', async () => {
    await setup();
    const btns = [...document.querySelectorAll('.cond-cooker-opt')];
    expect(btns.map((b) => b.textContent)).toEqual(['Pellet', 'Offset', 'Kamado', 'Kettle', 'Electric']);
    expect(btns.every((b) => b.tagName === 'BUTTON' && b.hasAttribute('aria-pressed'))).toBe(true);
    expect(document.querySelector('label[for=condBlanket]').textContent).toContain('Insulation blanket');
  });

  it('is not stored anywhere else (no cookies, no session storage, no conditions in local storage)', async () => {
    await setup({ permission: 'granted' });
    document.querySelector('[data-cooker=offset]').click();
    expect(localStorage.length).toBe(1);
    expect(sessionStorage.length).toBe(0); // the injected fetch bypasses the cache; the card itself stores nothing
    expect(localStorage.getItem(PREFS_KEY)).not.toMatch(/40\.13|111\.58|Mapleton|4797/);
  });
});

describe('accessibility and copy', () => {
  it('buttons, inputs and the checkbox label meet the 44px touch target', async () => {
    await setup();
    const targets = [...document.querySelectorAll('#conditionsCard button, #conditionsCard input:not([type=checkbox])')];
    expect(targets.length).toBeGreaterThan(8);
    for (const el of targets) expect(el.className, el.id || el.textContent).toMatch(/min-h-\[44px\]/);
    expect(document.querySelector('label[for=condBlanket]').className).toMatch(/min-h-\[44px\]/);
  });

  it('every input has a label', async () => {
    await setup();
    for (const el of document.querySelectorAll('#conditionsCard input')) {
      expect(document.querySelector(`label[for="${el.id}"]`), el.id).toBeTruthy();
    }
  });

  it('has no em dashes in any state', async () => {
    const { card } = await setup({ permission: 'granted' });
    const all = [text('conditionsCard')];
    $('condManualBtn').click();
    $('condForm').dispatchEvent(new Event('submit', { cancelable: true }));
    all.push(text('conditionsCard'));
    for (const t of all) expect(t).not.toMatch(/\u2014/);
    expect(card.getState().status).toBe('ready');
  });
});
