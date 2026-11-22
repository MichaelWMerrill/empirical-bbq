/*
 * Cook conditions: browser location -> National Weather Service forecast.
 *
 * Display-only. This module must NOT be imported by any engine, registry or
 * calculator module (a test enforces it for the engine files): conditions are
 * shown, not yet used in any time estimate.
 *
 * Privacy contract:
 *   - Coordinates are rounded to 2 decimals (about 1 km) before any use.
 *   - They go only to https://api.weather.gov, as part of the request URL.
 *   - No function here returns lat or lon, so nothing downstream can log or
 *     store them by accident.
 *   - The only storage is a 30 minute sessionStorage cache of the normalized
 *     forecast. Its key is a hash of the rounded coordinates, so the
 *     coordinates themselves are never written to storage, even as a key.
 *
 * Requests are plain GETs with no custom headers, so the browser sends no CORS
 * preflight (api.weather.gov only allows the API-Key and User-Agent headers,
 * and User-Agent cannot be set from a browser).
 */

const NWS_ORIGIN = 'https://api.weather.gov/';
const CACHE_PREFIX = 'ebq:conditions:v1:';
const CACHE_TTL_MS = 30 * 60 * 1000;
const HOUR_MS = 3600 * 1000;
const FT_PER_M = 3.28084;

/** Error carrying a machine-readable `code`. */
export class ConditionsError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'ConditionsError';
    this.code = code;
  }
}

/** Round to 2 decimals (about 1 km). Never returns -0. */
const round2 = (n) => Number(n.toFixed(2)) + 0;
const round1 = (n) => Math.round(n * 10) / 10;

/* ------------------------------------------------------------------ */
/* 1. Position                                                         */
/* ------------------------------------------------------------------ */

/**
 * Ask the browser for the current position, low accuracy.
 * Resolves { lat, lon } rounded to 2 decimals.
 * Rejects with a ConditionsError whose code is
 * 'denied' | 'unavailable' | 'timeout' | 'unsupported'.
 * `geolocation` can be injected for tests.
 */
export function getPosition({ timeoutMs = 10000, geolocation } = {}) {
  const geo = geolocation ?? (typeof navigator !== 'undefined' ? navigator.geolocation : undefined);
  return new Promise((resolve, reject) => {
    if (!geo || typeof geo.getCurrentPosition !== 'function') {
      reject(new ConditionsError('unsupported', 'Geolocation is not supported.'));
      return;
    }
    geo.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos?.coords ?? {};
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          reject(new ConditionsError('unavailable', 'Position was not usable.'));
          return;
        }
        resolve({ lat: round2(latitude), lon: round2(longitude) });
      },
      (err) => {
        // GeolocationPositionError: 1 PERMISSION_DENIED, 2 POSITION_UNAVAILABLE, 3 TIMEOUT
        const code = err?.code === 1 ? 'denied' : err?.code === 3 ? 'timeout' : 'unavailable';
        reject(new ConditionsError(code));
      },
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 10 * 60 * 1000 }
    );
  });
}

/* ------------------------------------------------------------------ */
/* 2. Forecast                                                         */
/* ------------------------------------------------------------------ */

// FNV-1a, hex. Keeps the rounded coordinates out of the storage key.
function hashKey(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function defaultStorage() {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null; // access can throw when site data is blocked
  }
}

function readCache(storage, key, now) {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || typeof entry.fetchedAt !== 'number' || !entry.data) return null;
    const age = now() - entry.fetchedAt;
    if (age < 0 || age >= CACHE_TTL_MS) return null;
    return entry.data;
  } catch {
    return null;
  }
}

function writeCache(storage, key, data) {
  try {
    storage?.setItem(key, JSON.stringify({ fetchedAt: data.fetchedAt, data }));
  } catch {
    /* storage full or blocked: skip caching */
  }
}

async function getJson(fetchImpl, url, { notFoundCode } = {}) {
  let res;
  try {
    res = await fetchImpl(url); // no options on purpose: no custom headers, no preflight
  } catch {
    throw new ConditionsError('network', 'Network request failed.');
  }
  if (res.status === 404 && notFoundCode) throw new ConditionsError(notFoundCode);
  if (!res.ok) throw new ConditionsError('upstream', `Unexpected status ${res.status}.`);
  try {
    return await res.json();
  } catch {
    throw new ConditionsError('upstream', 'Malformed JSON.');
  }
}

/**
 * Wind strings look like "5 mph" or "5 to 10 mph". We use the UPPER value of a
 * range, because planning for the windier end is the conservative reading for
 * a fire. Returns null for anything that is not an mph string.
 */
export function parseWindMph(str) {
  if (typeof str !== 'string') return null;
  const m = str.match(/(\d+(?:\.\d+)?)(?:\s*to\s*(\d+(?:\.\d+)?))?\s*mph/i);
  if (!m) return null;
  return Number(m[2] ?? m[1]);
}

const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function toF(value, unit) {
  const v = numOrNull(value);
  if (v == null) return null;
  return unit === 'C' ? v * 1.8 + 32 : v;
}

function normalizeElevationFt(el) {
  const v = numOrNull(el?.value);
  if (v == null) return null;
  const unit = String(el.unitCode ?? '');
  if (unit.endsWith(':m')) return Math.round(v * FT_PER_M);
  if (unit.endsWith(':ft')) return Math.round(v);
  return null;
}

function normalizePeriod(p) {
  const time = typeof p?.startTime === 'string' && !Number.isNaN(Date.parse(p.startTime)) ? p.startTime : null;
  const tempF = toF(p?.temperature, p?.temperatureUnit);
  if (time == null || tempF == null) return null; // unusable period: dropped
  // dewpoint is degC in the NWS hourly feed
  const dewC = numOrNull(p?.dewpoint?.value);
  const dewUnit = String(p?.dewpoint?.unitCode ?? '');
  const dewF = dewC == null ? null : round1(dewUnit.endsWith('degF') ? dewC : dewC * 1.8 + 32);
  return {
    time,
    tempF,
    dewF,
    rh: numOrNull(p?.relativeHumidity?.value),
    windMph: parseWindMph(p?.windSpeed),
    gustMph: parseWindMph(p?.windGust), // usually absent: null
    sky: typeof p?.shortForecast === 'string' ? p.shortForecast : '',
  };
}

/**
 * Fetch the NWS hourly forecast for a (rounded) position.
 * Returns { source:'nws', place:{city,state}, timeZone, elevationFt, hourly, fetchedAt }.
 * `fetchedAt` is epoch milliseconds. lat/lon are NOT part of the result.
 * Rejects with a ConditionsError: 'outside_coverage' (points 404, non-US),
 * 'upstream' (5xx, bad JSON, unexpected shape) or 'network'.
 */
export async function fetchConditions(
  lat,
  lon,
  { fetchImpl = (...a) => globalThis.fetch(...a), storage = defaultStorage(), now = Date.now } = {}
) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new ConditionsError('invalid_coordinates');
  }
  const rLat = round2(lat);
  const rLon = round2(lon);
  const cacheKey = CACHE_PREFIX + hashKey(`${rLat},${rLon}`);

  const cached = readCache(storage, cacheKey, now);
  if (cached) return cached;

  const points = await getJson(fetchImpl, `${NWS_ORIGIN}points/${rLat},${rLon}`, { notFoundCode: 'outside_coverage' });
  const pp = points?.properties;
  const hourlyUrl = pp?.forecastHourly;
  // Only follow links that stay on api.weather.gov.
  if (typeof hourlyUrl !== 'string' || !hourlyUrl.startsWith(NWS_ORIGIN) || typeof pp?.timeZone !== 'string') {
    throw new ConditionsError('upstream', 'Unexpected points response.');
  }

  const forecast = await getJson(fetchImpl, hourlyUrl);
  const fp = forecast?.properties;
  if (!Array.isArray(fp?.periods)) throw new ConditionsError('upstream', 'Unexpected forecast response.');

  const rel = pp.relativeLocation?.properties ?? {};
  const result = {
    source: 'nws',
    place: { city: typeof rel.city === 'string' ? rel.city : '', state: typeof rel.state === 'string' ? rel.state : '' },
    timeZone: pp.timeZone,
    elevationFt: normalizeElevationFt(fp.elevation),
    hourly: fp.periods.map(normalizePeriod).filter(Boolean),
    fetchedAt: now(),
  };
  writeCache(storage, cacheKey, result);
  return result;
}

/* ------------------------------------------------------------------ */
/* 3. Manual fallback                                                  */
/* ------------------------------------------------------------------ */

/**
 * Same shape as fetchConditions, for when location is denied or unavailable.
 * No synthetic hourly series is created: hourly is [] and the typed values
 * live in `manual`. A low above the high is swapped.
 */
export function manualConditions({ elevationFt, lowF, highF, windMph } = {}) {
  let lo = numOrNull(lowF);
  let hi = numOrNull(highF);
  if (lo != null && hi != null && lo > hi) [lo, hi] = [hi, lo];
  const manual = { elevationFt: numOrNull(elevationFt), lowF: lo, highF: hi, windMph: numOrNull(windMph) };
  let timeZone = 'UTC';
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    /* keep UTC */
  }
  return {
    source: 'manual',
    place: null,
    timeZone,
    elevationFt: manual.elevationFt,
    hourly: [],
    manual,
    fetchedAt: null,
  };
}

/* ------------------------------------------------------------------ */
/* 4. Window summary                                                   */
/* ------------------------------------------------------------------ */

const EMPTY_SUMMARY = { tempMinF: null, tempMaxF: null, tempAvgF: null, dewAvgF: null, windAvgMph: null, gustMaxMph: null };

/**
 * Summarize conditions over [startISO, endISO).
 * Each hourly period covers one hour from its start time. Averages are
 * weighted by how much of each hour falls inside the window.
 * hoursCovered is the window time the forecast covers; hoursMissing is the rest
 * (a cook can run past the end of the forecast), never guessed.
 * Manual conditions summarize from the manual field and cover the whole window.
 */
export function windowSummary(conditions, startISO, endISO) {
  const start = Date.parse(startISO);
  const end = Date.parse(endISO);
  if (Number.isNaN(start) || Number.isNaN(end)) throw new TypeError('windowSummary needs valid ISO start and end times.');
  const totalH = Math.max(0, (end - start) / HOUR_MS);

  if (conditions?.source === 'manual') {
    const m = conditions.manual ?? {};
    const lo = m.lowF ?? null;
    const hi = m.highF ?? null;
    return {
      ...EMPTY_SUMMARY,
      tempMinF: lo,
      tempMaxF: hi,
      tempAvgF: lo != null && hi != null ? round1((lo + hi) / 2) : null,
      windAvgMph: m.windMph ?? null,
      hoursCovered: round2(totalH),
      hoursMissing: 0,
    };
  }

  let covered = 0;
  let tMin = Infinity;
  let tMax = -Infinity;
  let tSum = 0;
  let dewSum = 0;
  let dewW = 0;
  let windSum = 0;
  let windW = 0;
  let gustMax = null;

  for (const p of conditions?.hourly ?? []) {
    const ps = Date.parse(p.time);
    const overlap = Math.min(end, ps + HOUR_MS) - Math.max(start, ps);
    if (!(overlap > 0)) continue;
    const w = overlap / HOUR_MS;
    covered += w;
    tMin = Math.min(tMin, p.tempF);
    tMax = Math.max(tMax, p.tempF);
    tSum += p.tempF * w;
    if (p.dewF != null) {
      dewSum += p.dewF * w;
      dewW += w;
    }
    if (p.windMph != null) {
      windSum += p.windMph * w;
      windW += w;
    }
    if (p.gustMph != null) gustMax = gustMax == null ? p.gustMph : Math.max(gustMax, p.gustMph);
  }

  const missing = Math.max(0, totalH - covered);
  if (covered === 0) return { ...EMPTY_SUMMARY, hoursCovered: 0, hoursMissing: round2(missing) };
  return {
    tempMinF: tMin,
    tempMaxF: tMax,
    tempAvgF: round1(tSum / covered),
    dewAvgF: dewW ? round1(dewSum / dewW) : null,
    windAvgMph: windW ? round1(windSum / windW) : null,
    gustMaxMph: gustMax,
    hoursCovered: round2(covered),
    hoursMissing: round2(missing),
  };
}

/* ------------------------------------------------------------------ */
/* 5. Display helpers (not for any engine or calculator)               */
/* ------------------------------------------------------------------ */

/** Standard atmosphere: P = 101.325 * (1 - 2.25577e-5 * h_m)^5.25588, in kPa. */
export function pressureKPa(elevationFt) {
  const hM = elevationFt / FT_PER_M;
  return 101.325 * Math.pow(1 - 2.25577e-5 * hM, 5.25588);
}

/**
 * Boiling point of water in degF at an elevation, by inverting the Antoine
 * equation (A 8.07131, B 1730.63, C 233.426; mmHg, degC):
 *   log10(P) = A - B / (C + T)  =>  T = B / (A - log10(P)) - C
 */
export function boilingPointF(elevationFt) {
  const A = 8.07131;
  const B = 1730.63;
  const C = 233.426;
  const mmHg = pressureKPa(elevationFt) * 7.50062;
  const tC = B / (A - Math.log10(mmHg)) - C;
  return tC * 1.8 + 32;
}
