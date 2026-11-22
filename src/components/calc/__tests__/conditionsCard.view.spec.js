import { describe, test, expect, vi } from 'vitest';
import pointsFixture from '../../../utils/__tests__/fixtures/nws-points.json';
import hourlyFixture from '../../../utils/__tests__/fixtures/nws-hourly.json';
import { fetchConditions, manualConditions } from '../../../utils/conditions.js';
import { buildConditionsView, zoneLabel, NO_WINDOW_NOTE, SKY_NOTE, SOURCE_CREDIT, PLANNING_LINE } from '../conditionsCard.view.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const jsonRes = (body) => ({ ok: true, status: 200, json: async () => body });
async function nws(hourly = hourlyFixture) {
  const f = vi.fn(async (url) => jsonRes(url.includes('/points/') ? pointsFixture : hourly));
  return fetchConditions(40.13, -111.58, { fetchImpl: f, storage: null, now: () => 0 });
}
// Recorded hours: 13:00 to 19:00 on 2026-11-22, Mountain Standard Time (-07:00).
const win = (from, to) => ({ start: new Date(`2026-11-22T${from}:00-07:00`), end: new Date(`2026-11-22T${to}:00-07:00`) });
const rowMap = (v) => Object.fromEntries(v.rows.map((r) => [r.key, r.value]));

describe('buildConditionsView: auto-detected', () => {
  test('place, pill, elevation, boiling point and the window summary', async () => {
    const v = buildConditionsView(await nws(), win('14:00', '17:00')); // hours 45, 46, 44 F
    expect(v.pill).toBe('Auto-detected');
    expect(v.place).toBe('Mapleton, UT');
    expect(rowMap(v)).toEqual({
      elevation: '4,797 ft',
      boil: '203°F', // boilingPointF(4797) = 203.27
      temp: '44 to 46°F',
      wind: '1 mph average',
      dew: '27°F average', // 26, 27, 28 F
      sky: 'Mostly Cloudy',
    });
    expect(v.note).toBeNull();
    expect(v.credit).toBe(SOURCE_CREDIT);
  });

  test('the boiling point says it is based on elevation only, and wind says it uses the windier end of a range', async () => {
    const v = buildConditionsView(await nws(), win('14:00', '17:00'));
    expect(v.rows.find((r) => r.key === 'boil').note).toBe('Based on elevation only.');
    expect(v.rows.find((r) => r.key === 'wind').note).toBe('Uses the windier end when the forecast gives a range.');
    const manual = buildConditionsView(manualConditions({ elevationFt: 5200, lowF: 38, highF: 62, windMph: 8 }), win('14:00', '17:00'));
    expect(manual.rows.find((r) => r.key === 'wind').note).toBeUndefined();
  });

  test('the sky row carries "Sky is shown for reference only."', async () => {
    const v = buildConditionsView(await nws(), win('14:00', '17:00'));
    expect(v.rows.find((r) => r.key === 'sky').note).toBe(SKY_NOTE);
    expect(SKY_NOTE).toBe('Sky is shown for reference only.');
  });

  test('the gust row is hidden when the feed reports no gusts, and shown when it does', async () => {
    const none = buildConditionsView(await nws(), win('14:00', '17:00'));
    expect(none.rows.some((r) => r.key === 'gust')).toBe(false);
    const h = clone(hourlyFixture);
    h.properties.periods[2].windGust = '25 mph';
    const some = buildConditionsView(await nws(h), win('14:00', '17:00'));
    expect(rowMap(some).gust).toBe('up to 25 mph');
  });

  test('the hourly strip is in the cook location zone, one cell per hour in the window', async () => {
    const v = buildConditionsView(await nws(), win('14:00', '17:00'));
    expect(v.strip.label).toBe('Times in Mountain Time');
    expect(v.strip.cells).toEqual([
      { hour: '2 PM', day: 'Sun', temp: '45°', wind: '1 mph' },
      { hour: '3 PM', day: '', temp: '46°', wind: '1 mph' },
      { hour: '4 PM', day: '', temp: '44°', wind: '1 mph' },
    ]);
  });

  test('a window that runs past the forecast says how many hours fall outside', async () => {
    const v = buildConditionsView(await nws(), win('17:00', '22:00')); // 2 h covered, 3 h beyond
    expect(v.note).toBe('3 hours of this cook fall outside the forecast range and are left out of the numbers above.');
    expect(rowMap(v).temp).toBe('40 to 42°F');
    expect(v.strip.cells).toHaveLength(2);
  });

  test('singular wording for one missing hour', async () => {
    const v = buildConditionsView(await nws(), win('18:00', '20:00'));
    expect(v.note).toBe('1 hour of this cook falls outside the forecast range and is left out of the numbers above.');
  });

  test('a window entirely outside the forecast shows only elevation and boiling point, plus a message', async () => {
    const v = buildConditionsView(await nws(), { start: new Date('2026-12-05T08:00:00-07:00'), end: new Date('2026-12-05T20:00:00-07:00') });
    expect(Object.keys(rowMap(v))).toEqual(['elevation', 'boil']);
    expect(v.strip).toBeNull();
    expect(v.note).toBe('This cook falls outside the forecast range, so there are no numbers to show.');
  });

  test('no cook window yet: elevation and boiling point, and a prompt to pick a serving time', async () => {
    const v = buildConditionsView(await nws(), null);
    expect(Object.keys(rowMap(v))).toEqual(['elevation', 'boil']);
    expect(v.note).toBe(NO_WINDOW_NOTE);
  });

  test('the strip day tag appears when the local day changes', async () => {
    const h = clone(hourlyFixture);
    h.properties.periods = [
      { ...h.properties.periods[0], startTime: '2026-11-22T23:00:00-07:00' },
      { ...h.properties.periods[1], startTime: '2026-11-23T00:00:00-07:00' },
      { ...h.properties.periods[2], startTime: '2026-11-23T01:00:00-07:00' },
    ];
    const v = buildConditionsView(await nws(h), { start: new Date('2026-11-22T23:00:00-07:00'), end: new Date('2026-11-23T02:00:00-07:00') });
    expect(v.strip.cells.map((c) => [c.hour, c.day])).toEqual([['11 PM', 'Sun'], ['12 AM', 'Mon'], ['1 AM', '']]);
  });

  test('omits elevation rows when the feed has no elevation', async () => {
    const h = clone(hourlyFixture);
    delete h.properties.elevation;
    const v = buildConditionsView(await nws(h), win('14:00', '17:00'));
    expect(v.rows.some((r) => r.key === 'elevation' || r.key === 'boil')).toBe(false);
  });
});

describe('buildConditionsView: manual', () => {
  const m = manualConditions({ elevationFt: 5200, lowF: 38, highF: 62, windMph: 8 });

  test('pill, rows, no strip, no credit, no sky or dew or gust', () => {
    const v = buildConditionsView(m, win('14:00', '17:00'));
    expect(v.pill).toBe('Manual');
    expect(v.place).toBeNull();
    expect(rowMap(v)).toEqual({ elevation: '5,200 ft', boil: '203°F', temp: '38 to 62°F', wind: '8 mph' });
    expect(v.strip).toBeNull();
    expect(v.credit).toBeNull();
    expect(v.note).toBeNull();
  });

  test('wind is optional', () => {
    const v = buildConditionsView(manualConditions({ elevationFt: 0, lowF: 50, highF: 50 }), win('14:00', '17:00'));
    expect(rowMap(v)).toEqual({ elevation: '0 ft', boil: '212°F', temp: '50°F' });
  });
});

describe('zoneLabel', () => {
  test.each([
    ['America/Denver', 'Times in Mountain Time'],
    ['America/Los_Angeles', 'Times in Pacific Time'],
    ['America/New_York', 'Times in Eastern Time'],
  ])('%s', (tz, expected) => expect(zoneLabel(tz)).toBe(expected));
  test('falls back to the zone id when it is not recognized', () => {
    expect(zoneLabel('Not/AZone')).toBe('Times in Not/AZone');
  });
});

describe('copy', () => {
  test('the required planning line is the approved wording', () => {
    expect(PLANNING_LINE).toBe("Shown for planning. The time estimate doesn't use these conditions yet.");
    expect(SOURCE_CREDIT).toBe('Forecast: National Weather Service');
  });
});
