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

async function setup({ permission = 'prompt', position = { lat: 40.13, lon: -111.58 }, conditions, fetchImpl, prefs } = {}) {
  await mountComponent(CookScheduler);
  if (prefs) localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
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

describe('remembering the opt-in (autoLocate)', () => {
  const stored = () => JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');

  it('no contact on load unless autoLocate is true: nothing stored, nothing requested', async () => {
    const { getPosition, fetchC } = await setup({ permission: 'prompt' });
    expect(getPosition).not.toHaveBeenCalled();
    expect(fetchC).not.toHaveBeenCalled();
    expect(localStorage.getItem(PREFS_KEY)).toBeNull();
  });

  it('with autoLocate true it re-detects on load even though the Permissions API says prompt', async () => {
    const { getPosition, fetchC, card } = await setup({ permission: 'prompt', prefs: { autoLocate: true } });
    expect(getPosition).toHaveBeenCalledTimes(1);
    expect(fetchC).toHaveBeenCalledWith(40.13, -111.58);
    expect(card.getState()).toMatchObject({ status: 'ready', source: 'nws' });
    expect(text('condPlace')).toBe('Mapleton, UT');
  });

  it('with autoLocate true it re-detects when the Permissions API is missing or denied, too', async () => {
    for (const permission of [null, 'denied']) {
      document.body.innerHTML = '';
      const { getPosition } = await setup({ permission, prefs: { autoLocate: true } });
      expect(getPosition).toHaveBeenCalledTimes(1);
    }
  });

  it('a successful fetch saves autoLocate true, a boolean and no coordinates', async () => {
    await setup({ permission: 'prompt' });
    $('condUseBtn').click();
    await vi.waitFor(() => expect(stored().autoLocate).toBe(true));
    expect(localStorage.getItem(PREFS_KEY)).not.toMatch(/40\.13|111\.58|Mapleton|4797/);
    expect(localStorage.length).toBe(1);
  });

  it('manual conditions do not turn it on', async () => {
    await setup();
    $('condManualBtn').click();
    type('condElev', 100);
    type('condLow', 40);
    type('condHigh', 60);
    $('condForm').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(stored().autoLocate).toBeUndefined();
  });

  for (const code of ['denied', 'unavailable', 'timeout', 'unsupported']) {
    it(`a ${code} location request clears it and shows the button instead of retrying on the next load`, async () => {
      const { card } = await setup({ permission: 'prompt', prefs: { autoLocate: true }, position: new ConditionsError(code) });
      expect(card.getState().status).toBe('error');
      expect(stored().autoLocate).toBe(false);
      expect(hidden('condActions')).toBe(false);
      expect(hidden('condManualBtn')).toBe(false);
      document.body.innerHTML = '';
      const next = await setup({ permission: 'prompt' }); // reload
      expect(next.getPosition).not.toHaveBeenCalled();
    });
  }

  it('a forecast-service failure does not withdraw the opt-in', async () => {
    for (const code of ['upstream', 'network', 'outside_coverage']) {
      document.body.innerHTML = '';
      localStorage.clear();
      const { card } = await setup({ prefs: { autoLocate: true }, fetchImpl: vi.fn(async () => { throw new ConditionsError(code); }) });
      expect(card.getState()).toMatchObject({ status: 'error', errorCode: code });
      expect(stored().autoLocate).toBe(true);
    }
  });

  it('shows "Stop using my location" when loaded with the opt-in on, and it clears the opt-in', async () => {
    await setup({ permission: 'prompt', prefs: { autoLocate: true } });
    expect(hidden('condAutoRow')).toBe(false);
    expect(hidden('condStopBtn')).toBe(false);
    expect(text('condStopBtn')).toBe('Stop using my location');
    expect($('condStopBtn').className).toMatch(/min-h-\[44px\]/);
    $('condStopBtn').click();
    expect(stored().autoLocate).toBe(false);
    expect(hidden('condStopBtn')).toBe(true);
    expect(hidden('condStopNote')).toBe(false);
    expect(text('condStopNote')).toBe('Your location will not be requested automatically.');
    expect(rows().elevation).toBe('4,797 ft'); // what is on screen stays
  });

  it('Stop sticks even on a browser that remembers the grant, and is not offered when manual or not loaded', async () => {
    await setup({ permission: 'prompt', prefs: { autoLocate: true } });
    $('condStopBtn').click();
    document.body.innerHTML = '';
    const { getPosition } = await setup({ permission: 'granted' }); // reload, browser still says granted
    expect(getPosition).not.toHaveBeenCalled();
    expect(hidden('condAutoRow')).toBe(true);
  });

  it('a browser grant still loads on its own when the user has never decided', async () => {
    const { getPosition } = await setup({ permission: 'granted' });
    expect(getPosition).toHaveBeenCalledTimes(1);
    expect(stored().autoLocate).toBe(true);
  });

  it('the location note says when location is read', async () => {
    await setup();
    expect(text('condPrivacy')).toBe(
      "Your browser reads your location only when you tap the button, or automatically if you've allowed it for this site or turned it on here before. It's rounded to about 1 km on your device, and only that rounded position goes to the National Weather Service."
    );
  });
});

describe('compact strip under "Light the fire at"', () => {
  it('sits directly under the "Light the fire at" card, above the timeline', async () => {
    await setup();
    const hero = $('fireUpBig').closest('.rounded-2xl');
    expect(hero.nextElementSibling.id).toBe('condMini');
    expect($('condMini').nextElementSibling.querySelector('#timeline')).toBeTruthy();
  });

  it('before a location it asks, with the button', async () => {
    await setup({ permission: 'prompt' });
    expect(text('condMiniText')).toBe('Cooking somewhere cold or high up?');
    expect(text('condMiniBtn')).toBe('Use my location');
    expect(hidden('condMiniBtn')).toBe(false);
    expect(hidden('condMiniDetails')).toBe(true);
    expect($('condMiniText').getAttribute('aria-live')).toBe('polite');
  });

  it('tapping its button runs the same load as the card and then summarizes with a Details link', async () => {
    const { getPosition, card } = await setup({ permission: 'prompt' });
    $('condMiniBtn').click();
    await vi.waitFor(() => expect(card.getState().status).toBe('ready'));
    expect(getPosition).toHaveBeenCalledTimes(1);
    expect(text('condMiniText')).toBe('Mapleton, UT · 4,797 ft · 44 to 46°F');
    expect(hidden('condMiniBtn')).toBe(true);
    expect(hidden('condMiniDetails')).toBe(false);
    expect($('condMiniDetails').getAttribute('href')).toBe('#conditionsCard');
    expect(text('condPlace')).toBe('Mapleton, UT'); // the full card shows the same state
  });

  it('shows a loading message while it waits, with no button', async () => {
    let release;
    const { card } = await setup({ fetchImpl: vi.fn(() => new Promise((res) => (release = res))) });
    $('condMiniBtn').click();
    await vi.waitFor(() => expect(card.getState().status).toBe('loading'));
    expect(text('condMiniText')).toBe('Finding your forecast');
    expect(hidden('condMiniBtn')).toBe(true);
    expect(hidden('condMiniDetails')).toBe(true);
    release(await nwsConditions());
    await vi.waitFor(() => expect(card.getState().status).toBe('ready'));
  });

  it('on an error it says so and points to the card for the options', async () => {
    const { card } = await setup({ position: new ConditionsError('denied') });
    $('condMiniBtn').click();
    await vi.waitFor(() => expect(card.getState().status).toBe('error'));
    expect(text('condMiniText')).toBe('Conditions are not available right now.');
    expect(hidden('condMiniDetails')).toBe(false);
    expect(hidden('condMiniBtn')).toBe(true);
  });

  it('follows the cook window and manual conditions', async () => {
    const { card } = await setup({ permission: 'granted' });
    expect(text('condMiniText')).toBe('Mapleton, UT · 4,797 ft · 44 to 46°F');
    card.setWindow({ start: new Date('2026-11-22T17:00:00-07:00'), end: new Date('2026-11-22T22:00:00-07:00') });
    expect(text('condMiniText')).toBe('Mapleton, UT · 4,797 ft · 40 to 42°F');
    card.setWindow(null);
    expect(text('condMiniText')).toBe('Mapleton, UT · 4,797 ft');

    document.body.innerHTML = '';
    localStorage.clear();
    await setup();
    $('condManualBtn').click();
    type('condElev', 5200);
    type('condLow', 38);
    type('condHigh', 62);
    $('condForm').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(text('condMiniText')).toBe('Manual · 5,200 ft · 38 to 62°F');
  });

  it('the Details link moves focus to the full card', async () => {
    await setup({ permission: 'granted' });
    $('condMiniDetails').click();
    expect(document.activeElement.id).toBe('conditionsCard');
  });

  it('meets the 44px target and has no em dashes in any state', async () => {
    const { card } = await setup({ permission: 'granted' });
    expect($('condMiniBtn').className).toMatch(/min-h-\[44px\]/);
    expect($('condMiniDetails').className).toMatch(/min-h-\[44px\]/);
    expect(text('condMini')).not.toMatch(/\u2014/);
    expect(card.getState().status).toBe('ready');
  });
});

describe('cook time zone (one-way getter for the Add to calendar panel)', () => {
  it('is null until a forecast has loaded, then the NWS zone of the place', async () => {
    const { card } = await setup({ permission: 'prompt' });
    expect(card.getTimeZone()).toBeNull();
    $('condUseBtn').click();
    await vi.waitFor(() => expect(card.getState().status).toBe('ready'));
    expect(card.getTimeZone()).toBe('America/Denver');
  });

  it('is null for manual conditions (the browser zone is the panel fallback) and after an error', async () => {
    const { card } = await setup();
    $('condManualBtn').click();
    type('condElev', 5200);
    type('condLow', 38);
    type('condHigh', 62);
    $('condForm').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(card.getState().source).toBe('manual');
    expect(card.getTimeZone()).toBeNull();

    document.body.innerHTML = '';
    const failed = await setup({ position: new ConditionsError('denied') });
    $('condUseBtn').click();
    await vi.waitFor(() => expect(failed.card.getState().status).toBe('error'));
    expect(failed.card.getTimeZone()).toBeNull();
  });

  it('announces a change of zone once, with no payload, and takes nothing in', async () => {
    document.body.innerHTML = '';
    let heard = 0;
    const listener = () => heard++;
    document.addEventListener('ebq:cook-zone-changed', listener);
    try {
      const { card } = await setup({ permission: 'prompt' });
      expect(heard).toBe(0);
      $('condUseBtn').click();
      await vi.waitFor(() => expect(card.getState().status).toBe('ready'));
      expect(heard).toBe(1);
      card.setWindow(WINDOW); // a re-render that does not change the zone
      expect(heard).toBe(1);
      expect(card.getTimeZone.length).toBe(0); // a getter: no arguments, so nothing can be written through it
    } finally {
      document.removeEventListener('ebq:cook-zone-changed', listener);
    }
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
    expect(JSON.parse(localStorage.getItem(PREFS_KEY))).toEqual({ autoLocate: true, cooker: 'offset' });
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

describe('weather icons and precipitation chance on the hourly tiles', () => {
  const setPeriod = (p, sky, isDaytime, pct) => {
    p.shortForecast = sky;
    p.isDaytime = isDaytime;
    p.probabilityOfPrecipitation.value = pct;
  };
  const tiles = () => [...document.querySelectorAll('#condStripGrid li')];
  const tags = (li) => [...li.children].map((el) => el.tagName);

  async function mixed() {
    const h = clone(hourlyFixture);
    setPeriod(h.properties.periods[1], 'Sunny', true, 40);
    setPeriod(h.properties.periods[2], 'Mostly Clear', false, 10);
    setPeriod(h.properties.periods[3], 'Wintry Mix', true, 100);
    await setup({ permission: 'granted', conditions: await nwsConditions(h) });
  }

  it('puts a 16px decorative icon between the time and the temperature, with the chance under it', async () => {
    await mixed();
    const [a] = tiles();
    // day, time, icon slot, precipitation, temperature, wind, hidden text
    expect(tags(a)).toEqual(['P', 'P', 'DIV', 'P', 'P', 'P', 'SPAN']);
    const svg = a.querySelector('svg');
    expect(svg.getAttribute('width')).toBe('16');
    expect(svg.getAttribute('height')).toBe('16');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    for (const s of document.querySelectorAll('#condStripGrid svg, #condRows svg')) expect(s.getAttribute('aria-hidden')).toBe('true');
  });

  it('every tile in a strip has the same lines, so they are the same height', async () => {
    await mixed();
    const all = tiles().map((li) => tags(li).join());
    expect(new Set(all).size).toBe(1);
    expect(all[0]).toBe('P,P,DIV,P,P,P,SPAN');
  });

  it('shows the chance from 20% up, and only that line is empty otherwise', async () => {
    await mixed();
    expect(tiles().map((li) => li.querySelector('[data-precip]').textContent)).toEqual(['40%', '', '100%']);
    expect(tiles().every((li) => li.querySelector('[data-precip]').getAttribute('aria-hidden') === 'true')).toBe(true);
  });

  it('the sun is flame-400 and the other icons are white, like the temperature', async () => {
    await mixed();
    const [sun, moonCloud, none] = tiles();
    expect(sun.querySelector('svg').parentElement.className).toContain('text-flame-400');
    expect(moonCloud.querySelector('svg').parentElement.className).toContain('text-white');
    expect(none.querySelector('svg')).toBeNull(); // unknown text: no icon, empty slot
    expect(none.querySelector('.h-4')).not.toBeNull();
  });

  it('each tile has visually hidden text that says the sky and the chance in words', async () => {
    await mixed();
    expect(tiles().map((li) => li.querySelector('.sr-only').textContent)).toEqual([
      'Sunny, 40% chance of precipitation',
      'Mostly clear',
      'Wintry mix, 100% chance of precipitation',
    ]);
  });

  it('the Sky row shows the same mapper icon next to its text', async () => {
    await mixed();
    const dd = document.querySelector('#condRows [data-row=sky] dd');
    expect(dd.textContent).toBe('Sunny'); // three different hours: the earliest wins the tie
    expect(dd.querySelector('svg')).not.toBeNull();
    expect(dd.querySelector('svg').parentElement.className).toContain('text-flame-400');
  });

  it('tiles with no icon and no chance are as before, plus the hidden text', async () => {
    const h = clone(hourlyFixture);
    for (const p of h.properties.periods) setPeriod(p, 'Wintry Mix', true, 0);
    await setup({ permission: 'granted', conditions: await nwsConditions(h) });
    for (const li of tiles()) {
      expect(tags(li)).toEqual(['P', 'P', 'P', 'P', 'SPAN']);
      expect(li.querySelector('svg')).toBeNull();
    }
    expect(document.querySelector('#condRows [data-row=sky] svg')).toBeNull();
  });

  it('forecast data from before these fields existed (a cached entry) still renders', async () => {
    const conditions = await nwsConditions();
    for (const p of conditions.hourly) {
      delete p.isDaytime;
      delete p.precipPct;
      p.sky = 'Mostly Clear';
    }
    await setup({ permission: 'granted', conditions });
    expect(tiles()).toHaveLength(3);
    expect(document.querySelectorAll('#condStripGrid svg')).toHaveLength(0); // never a guessed sun or moon
  });
});
