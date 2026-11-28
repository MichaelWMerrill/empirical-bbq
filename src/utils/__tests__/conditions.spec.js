import { describe, test, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pointsFixture from './fixtures/nws-points.json';
import hourlyFixture from './fixtures/nws-hourly.json';
import {
  getPosition,
  fetchConditions,
  manualConditions,
  windowSummary,
  pressureKPa,
  boilingPointF,
  parseWindMph,
  ConditionsError,
} from '../conditions.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const jsonRes = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function memStorage() {
  const m = new Map();
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

function nwsFetch({ points = pointsFixture, hourly = hourlyFixture, pointsStatus = 200, hourlyStatus = 200 } = {}) {
  return vi.fn(async (url) => {
    if (url.includes('/points/')) return jsonRes(points, pointsStatus);
    return jsonRes(hourly, hourlyStatus);
  });
}

const rejectsWith = async (p, code) => {
  const err = await p.then(
    () => null,
    (e) => e
  );
  expect(err).toBeInstanceOf(ConditionsError);
  expect(err.code).toBe(code);
};

describe('getPosition', () => {
  const geo = (impl) => ({ getCurrentPosition: vi.fn(impl) });

  test('resolves lat/lon rounded to 2 decimals, low accuracy', async () => {
    const g = geo((ok) => ok({ coords: { latitude: 40.134567, longitude: -111.5849 } }));
    await expect(getPosition({ geolocation: g, timeoutMs: 5000 })).resolves.toEqual({ lat: 40.13, lon: -111.58 });
    const opts = g.getCurrentPosition.mock.calls[0][2];
    expect(opts.enableHighAccuracy).toBe(false);
    expect(opts.timeout).toBe(5000);
  });

  test('never returns negative zero', async () => {
    const g = geo((ok) => ok({ coords: { latitude: -0.001, longitude: 0.004 } }));
    const p = await getPosition({ geolocation: g });
    expect(Object.is(p.lat, 0)).toBe(true);
  });

  test.each([
    [1, 'denied'],
    [2, 'unavailable'],
    [3, 'timeout'],
  ])('maps GeolocationPositionError %i to %s', async (n, code) => {
    await rejectsWith(getPosition({ geolocation: geo((_, bad) => bad({ code: n })) }), code);
  });

  test('rejects unsupported when geolocation is missing', async () => {
    await rejectsWith(getPosition({ geolocation: null }), 'unsupported');
  });
});

describe('parseWindMph', () => {
  test('single value, range (upper wins), and non-mph', () => {
    expect(parseWindMph('5 mph')).toBe(5);
    expect(parseWindMph('5 to 10 mph')).toBe(10);
    expect(parseWindMph('Calm')).toBeNull();
    expect(parseWindMph(undefined)).toBeNull();
  });
});

describe('fetchConditions', () => {
  const NOW = 1_700_000_000_000;

  test('normalizes the recorded NWS responses', async () => {
    const f = nwsFetch();
    const c = await fetchConditions(40.134, -111.581, { fetchImpl: f, storage: memStorage(), now: () => NOW });
    expect(c.source).toBe('nws');
    expect(c.place).toEqual({ city: 'Mapleton', state: 'UT' });
    expect(c.timeZone).toBe('America/Denver');
    expect(c.elevationFt).toBe(4797); // 1462.1256 m
    expect(c.fetchedAt).toBe(NOW);
    expect(c.hourly).toHaveLength(6);
    expect(c.hourly[0]).toEqual({
      time: '2026-11-22T13:00:00-07:00',
      tempF: 44,
      dewF: 26, // -3.333 C
      rh: 48,
      windMph: 3,
      gustMph: null, // windGust is absent in the feed
      sky: 'Cloudy',
      isDaytime: true,
      precipPct: 0,
    });
  });

  test('isDaytime and the precipitation chance are passed through for display', async () => {
    const h = clone(hourlyFixture);
    h.properties.periods[1].probabilityOfPrecipitation.value = 40;
    h.properties.periods[2].probabilityOfPrecipitation.value = null; // NWS sends null when it has no value
    delete h.properties.periods[3].probabilityOfPrecipitation;
    delete h.properties.periods[4].isDaytime;
    const c = await fetchConditions(40.13, -111.58, { fetchImpl: nwsFetch({ hourly: h }), storage: memStorage(), now: () => NOW });
    expect(c.hourly.map((p) => p.isDaytime)).toEqual([true, true, true, true, null, false]); // 18:00 is after dark
    expect(c.hourly.map((p) => p.precipPct)).toEqual([0, 40, null, null, 0, 0]);
  });

  test('requests rounded coordinates, then the forecastHourly URL, as plain GETs', async () => {
    const f = nwsFetch();
    await fetchConditions(40.13456, -111.58499, { fetchImpl: f, storage: memStorage(), now: () => NOW });
    expect(f.mock.calls[0]).toEqual(['https://api.weather.gov/points/40.13,-111.58']);
    expect(f.mock.calls[1]).toEqual([pointsFixture.properties.forecastHourly]);
    // one argument only: no headers object, so the browser sends no CORS preflight
    for (const call of f.mock.calls) expect(call).toHaveLength(1);
  });

  test('the result contains no coordinates', async () => {
    const c = await fetchConditions(40.13, -111.58, { fetchImpl: nwsFetch(), storage: memStorage(), now: () => NOW });
    const s = JSON.stringify(c);
    expect(c).not.toHaveProperty('lat');
    expect(c).not.toHaveProperty('lon');
    expect(s).not.toMatch(/40\.13|111\.58/);
  });

  test('wind range uses the upper value; a present gust is parsed', async () => {
    const h = clone(hourlyFixture);
    h.properties.periods[0].windSpeed = '5 to 10 mph';
    h.properties.periods[0].windGust = '25 mph';
    const c = await fetchConditions(40.13, -111.58, { fetchImpl: nwsFetch({ hourly: h }), storage: memStorage(), now: () => NOW });
    expect(c.hourly[0].windMph).toBe(10);
    expect(c.hourly[0].gustMph).toBe(25);
  });

  test('periods without a usable time or temperature are dropped', async () => {
    const h = clone(hourlyFixture);
    delete h.properties.periods[1].temperature;
    h.properties.periods[2].startTime = 'garbage';
    const c = await fetchConditions(40.13, -111.58, { fetchImpl: nwsFetch({ hourly: h }), storage: memStorage(), now: () => NOW });
    expect(c.hourly).toHaveLength(4);
  });

  describe('cache', () => {
    test('hit within 30 minutes, no second request', async () => {
      const f = nwsFetch();
      const storage = memStorage();
      await fetchConditions(40.13, -111.58, { fetchImpl: f, storage, now: () => NOW });
      expect(f).toHaveBeenCalledTimes(2);
      const again = await fetchConditions(40.134, -111.584, { fetchImpl: f, storage, now: () => NOW + 29 * 60 * 1000 });
      expect(f).toHaveBeenCalledTimes(2);
      expect(again.place.city).toBe('Mapleton');
    });

    test('miss after 30 minutes', async () => {
      const f = nwsFetch();
      const storage = memStorage();
      await fetchConditions(40.13, -111.58, { fetchImpl: f, storage, now: () => NOW });
      await fetchConditions(40.13, -111.58, { fetchImpl: f, storage, now: () => NOW + 30 * 60 * 1000 });
      expect(f).toHaveBeenCalledTimes(4);
    });

    test('keyed by rounded coordinates: a different cell misses', async () => {
      const f = nwsFetch();
      const storage = memStorage();
      await fetchConditions(40.13, -111.58, { fetchImpl: f, storage, now: () => NOW });
      await fetchConditions(40.14, -111.58, { fetchImpl: f, storage, now: () => NOW });
      expect(f).toHaveBeenCalledTimes(4);
      expect(storage.m.size).toBe(2);
    });

    test('the cached object and its storage key contain no lat or lon', async () => {
      const storage = memStorage();
      await fetchConditions(40.13, -111.58, { fetchImpl: nwsFetch(), storage, now: () => NOW });
      const [[key, value]] = [...storage.m.entries()];
      expect(key).not.toMatch(/40\.13|111\.58/);
      expect(value).not.toMatch(/40\.13|111\.58|"lat"|"lon"/);
    });

    test('nothing else is stored, and a corrupt entry is a miss', async () => {
      const f = nwsFetch();
      const storage = memStorage();
      await fetchConditions(40.13, -111.58, { fetchImpl: f, storage, now: () => NOW });
      expect(storage.m.size).toBe(1);
      const [key] = [...storage.m.keys()];
      storage.m.set(key, '{not json');
      await fetchConditions(40.13, -111.58, { fetchImpl: f, storage, now: () => NOW });
      expect(f).toHaveBeenCalledTimes(4);
    });

    test('works when storage is unavailable or throws', async () => {
      const boom = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
      await expect(fetchConditions(40.13, -111.58, { fetchImpl: nwsFetch(), storage: boom, now: () => NOW })).resolves.toMatchObject({ source: 'nws' });
      await expect(fetchConditions(40.13, -111.58, { fetchImpl: nwsFetch(), storage: null, now: () => NOW })).resolves.toMatchObject({ source: 'nws' });
    });
  });

  describe('error codes', () => {
    const opts = (f) => ({ fetchImpl: f, storage: memStorage(), now: () => NOW });

    test('points 404 is outside_coverage', async () => {
      await rejectsWith(fetchConditions(51.51, -0.13, opts(nwsFetch({ pointsStatus: 404 }))), 'outside_coverage');
    });
    test('500 on points is upstream', async () => {
      await rejectsWith(fetchConditions(40.13, -111.58, opts(nwsFetch({ pointsStatus: 500 }))), 'upstream');
    });
    test('500 on hourly is upstream', async () => {
      await rejectsWith(fetchConditions(40.13, -111.58, opts(nwsFetch({ hourlyStatus: 500 }))), 'upstream');
    });
    test('404 on hourly is upstream, not outside_coverage', async () => {
      await rejectsWith(fetchConditions(40.13, -111.58, opts(nwsFetch({ hourlyStatus: 404 }))), 'upstream');
    });
    test('malformed JSON is upstream', async () => {
      const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } }));
      await rejectsWith(fetchConditions(40.13, -111.58, opts(f)), 'upstream');
    });
    test('unexpected shape is upstream', async () => {
      await rejectsWith(fetchConditions(40.13, -111.58, opts(nwsFetch({ points: { properties: {} } }))), 'upstream');
      await rejectsWith(fetchConditions(40.13, -111.58, opts(nwsFetch({ hourly: { properties: {} } }))), 'upstream');
    });
    test('a forecastHourly link that leaves api.weather.gov is refused', async () => {
      const p = clone(pointsFixture);
      p.properties.forecastHourly = 'https://example.com/steal';
      const f = nwsFetch({ points: p });
      await rejectsWith(fetchConditions(40.13, -111.58, opts(f)), 'upstream');
      expect(f).toHaveBeenCalledTimes(1);
    });
    test('fetch rejection is network', async () => {
      const f = vi.fn(async () => { throw new TypeError('offline'); });
      await rejectsWith(fetchConditions(40.13, -111.58, opts(f)), 'network');
    });
    test('bad coordinates make no request', async () => {
      const f = nwsFetch();
      await rejectsWith(fetchConditions(NaN, -111.58, opts(f)), 'invalid_coordinates');
      await rejectsWith(fetchConditions(95, 0, opts(f)), 'invalid_coordinates');
      expect(f).not.toHaveBeenCalled();
    });
  });
});

describe('manualConditions', () => {
  test('same shape, source manual, no synthetic hourly series', () => {
    const c = manualConditions({ elevationFt: 5200, lowF: 38, highF: 61, windMph: 8 });
    expect(c.source).toBe('manual');
    expect(c.place).toBeNull();
    expect(c.hourly).toEqual([]);
    expect(c.elevationFt).toBe(5200);
    expect(c.manual).toEqual({ elevationFt: 5200, lowF: 38, highF: 61, windMph: 8 });
    expect(c.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(c.fetchedAt).toBeNull();
  });
  test('swaps a low above the high and nulls non-numbers', () => {
    const c = manualConditions({ lowF: 70, highF: 50, windMph: '' });
    expect(c.manual).toMatchObject({ lowF: 50, highF: 70, windMph: null, elevationFt: null });
  });
});

describe('windowSummary', () => {
  // Hourly fixture covers 13:00 to 19:00 -07:00 (six one-hour periods: 44,45,46,44,42,40 F).
  let conditions;
  const setup = async () => {
    conditions ??= await fetchConditions(40.13, -111.58, { fetchImpl: nwsFetch(), storage: memStorage(), now: () => 0 });
    return conditions;
  };

  test('fully covered window', async () => {
    const c = await setup();
    const s = windowSummary(c, '2026-11-22T14:00:00-07:00', '2026-11-22T17:00:00-07:00'); // 45,46,44
    expect(s).toMatchObject({ tempMinF: 44, tempMaxF: 46, tempAvgF: 45, hoursCovered: 3, hoursMissing: 0 });
    expect(s.dewAvgF).toBe(27); // 26, 27, 28 F
    expect(s.windAvgMph).toBe(1); // 1, 1, 1 mph
    expect(s.gustMaxMph).toBeNull();
  });

  test('half-hour edges weight by overlap', async () => {
    const c = await setup();
    const s = windowSummary(c, '2026-11-22T13:30:00-07:00', '2026-11-22T14:30:00-07:00'); // half of 44 + half of 45
    expect(s.hoursCovered).toBe(1);
    expect(s.tempAvgF).toBe(44.5);
  });

  test('window past the forecast end counts hoursMissing instead of guessing', async () => {
    const c = await setup();
    const s = windowSummary(c, '2026-11-22T17:00:00-07:00', '2026-11-22T22:00:00-07:00'); // 2 h covered (42,40), 3 h beyond
    expect(s.hoursCovered).toBe(2);
    expect(s.hoursMissing).toBe(3);
    expect(s.tempMinF).toBe(40);
    expect(s.tempMaxF).toBe(42);
  });

  test('window entirely outside the forecast', async () => {
    const c = await setup();
    const s = windowSummary(c, '2026-12-05T08:00:00-07:00', '2026-12-05T12:00:00-07:00');
    expect(s.hoursCovered).toBe(0);
    expect(s.hoursMissing).toBe(4);
    expect(s.tempMinF).toBeNull();
    expect(s.tempAvgF).toBeNull();
  });

  test('max gust comes from periods that report one', () => {
    const c = {
      source: 'nws',
      hourly: [
        { time: '2026-11-22T13:00:00-07:00', tempF: 40, dewF: 30, rh: 50, windMph: 5, gustMph: 15, sky: '' },
        { time: '2026-11-22T14:00:00-07:00', tempF: 50, dewF: null, rh: 50, windMph: null, gustMph: null, sky: '' },
      ],
    };
    const s = windowSummary(c, '2026-11-22T13:00:00-07:00', '2026-11-22T15:00:00-07:00');
    expect(s.gustMaxMph).toBe(15);
    expect(s.dewAvgF).toBe(30);
    expect(s.windAvgMph).toBe(5);
  });

  test('manual conditions summarize from the manual field', () => {
    const c = manualConditions({ elevationFt: 5200, lowF: 38, highF: 62, windMph: 8 });
    const s = windowSummary(c, '2026-11-22T08:00:00Z', '2026-11-22T20:00:00Z');
    expect(s).toEqual({
      tempMinF: 38,
      tempMaxF: 62,
      tempAvgF: 50,
      dewAvgF: null,
      windAvgMph: 8,
      gustMaxMph: null,
      hoursCovered: 12,
      hoursMissing: 0,
    });
  });

  test('invalid dates throw', async () => {
    const c = await setup();
    expect(() => windowSummary(c, 'nope', '2026-11-22T17:00:00-07:00')).toThrow(TypeError);
  });
});

describe('pressure and boiling point', () => {
  test('standard atmosphere', () => {
    expect(pressureKPa(0)).toBeCloseTo(101.325, 3);
    expect(pressureKPa(4700)).toBeCloseTo(85.26, 1);
  });
  test.each([
    [0, 212.0, 0.3],
    [1900, 208.5, 0.5],
    [4700, 203.4, 0.5],
    [7000, 199.2, 0.5],
  ])('boilingPointF(%i ft) is about %f F', (ft, f, tol) => {
    expect(Math.abs(boilingPointF(ft) - f)).toBeLessThanOrEqual(tol);
  });
});

describe('isolation', () => {
  // Conditions are display-only. Exactly these files may import conditions.js; every
  // other source file (engines, registry, scheduler, calculators, pages) may not. The
  // list is explicit on purpose: a file cannot get in by choosing a name that starts
  // with "conditions". Adding to it is a deliberate, reviewed change.
  const ALLOWED_IMPORTERS = [
    'src/components/calc/conditionsCard.controller.js',
    'src/components/calc/conditionsCard.view.js',
  ];

  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return e.name === '__tests__' || e.name === 'node_modules' ? [] : walk(p);
      return /\.(js|mjs|ts|astro)$/.test(e.name) ? [p] : [];
    });
  const rel = (p) => p.slice(root.length + 1).split('\\').join('/');
  // Any import or dynamic import whose specifier ends in /conditions or /conditions.js.
  const importsConditions = (src) => /(?:from\s*|import\s*\(\s*|import\s+)['"][^'"]*\/conditions(?:\.js)?['"]/.test(src);

  const sources = walk(join(root, 'src')).filter((f) => rel(f) !== 'src/utils/conditions.js');
  const importers = sources.filter((f) => importsConditions(readFileSync(f, 'utf8'))).map(rel).sort();

  test('only the allowlisted conditions card files import conditions.js', () => {
    expect(sources.length).toBeGreaterThan(30);
    for (const f of importers) expect(ALLOWED_IMPORTERS, `${f} is not allowed to import conditions.js`).toContain(f);
  });

  test('the allowlist is exact: every entry exists and imports it, with no dormant exemptions', () => {
    expect(importers).toEqual([...ALLOWED_IMPORTERS].sort());
  });

  test('the engines, registry and scheduler controller are not importers', () => {
    for (const f of ['src/utils/stallEngine.js', 'src/utils/proteinRegistry.js', 'src/utils/cookMilestones.js', 'src/components/calc/cookScheduler.controller.js']) {
      expect(importers, f).not.toContain(f);
    }
  });

  test('the matcher catches the forms it is meant to', () => {
    expect(importsConditions("import { x } from '../../utils/conditions.js';")).toBe(true);
    expect(importsConditions("import { x } from '../utils/conditions';")).toBe(true);
    expect(importsConditions("const m = await import('./utils/conditions.js');")).toBe(true);
    expect(importsConditions("import './conditions.js';")).toBe(true);
    expect(importsConditions("import { x } from './conditionsCard.view.js';")).toBe(false);
  });
});
