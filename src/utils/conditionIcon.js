/*
 * Display helpers for the cook conditions card: NWS forecast text -> icon key,
 * and the precipitation-chance rule.
 *
 * Display-only and pure: no DOM, no network, no clock. Like conditions.js, this
 * must NOT be imported by any engine, registry or calculator module.
 *
 * Icon keys are the Lucide icon names in src/vendor/lucide/index.js.
 */

/*
 * Rules are tried in order and the first match wins, so "Showers And
 * Thunderstorms" is lightning, not rain, and "Sunny and Breezy" is a sun, not
 * wind. Matching is on lowercased text with word boundaries, so "ice" does not
 * match inside "police".
 *
 * A rule with `night` depends on time of day. If the forecast does not say
 * whether the hour is daytime, that rule returns null instead of guessing a sun
 * for a night hour. Rules without `night` ignore time of day.
 */
const RULES = [
  { icon: 'cloud-lightning', test: /\bthunder/ },
  // "freezing rain" and "freezing drizzle" are ice; plain "freezing fog" is not,
  // so it falls through to the fog rule.
  { icon: 'cloud-snow', test: /\b(?:snow|flurries|sleet|ice)\b|\bfreezing (?:rain|drizzle)\b/ },
  { icon: 'cloud-rain', test: /\brain|\bshowers?\b|\bdrizzle/ },
  { icon: 'cloud-fog', test: /\b(?:fog|haze|smoke)/ },
  { icon: 'cloud-sun', night: 'cloud-moon', test: /\bpartly\b|\bmostly sunny\b|\bmostly clear\b/ },
  { icon: 'cloud', test: /\b(?:cloudy|overcast)\b/ },
  { icon: 'sun', night: 'moon', test: /\b(?:sunny|clear)\b/ },
  { icon: 'wind', test: /\b(?:windy|breezy|blustery)\b/ },
];

/**
 * Map an NWS `shortForecast` string to an icon key, or null when nothing
 * matches (the tile then renders without an icon, as it did before).
 *
 * @param {string} shortForecast  e.g. "Slight Chance Rain Showers then Partly Cloudy"
 * @param {boolean|null|undefined} isDaytime  NWS `isDaytime` for the hour, if known
 * @returns {string|null}
 */
export function conditionIcon(shortForecast, isDaytime) {
  if (typeof shortForecast !== 'string') return null;
  const text = shortForecast.toLowerCase();
  for (const rule of RULES) {
    if (!rule.test.test(text)) continue;
    if (!rule.night) return rule.icon;
    if (typeof isDaytime !== 'boolean') return null;
    return isDaytime ? rule.icon : rule.night;
  }
  return null;
}

/** Show a precipitation chance only from this percentage up. */
export const PRECIP_MIN_PCT = 20;

/**
 * The precipitation chance to display, as a whole percent, or null to hide it.
 * Hidden below PRECIP_MIN_PCT and when the value is missing (null, undefined,
 * not a number).
 *
 * @param {number|null|undefined} value  NWS probabilityOfPrecipitation.value
 * @returns {number|null}
 */
export function precipPercent(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < PRECIP_MIN_PCT) return null;
  return Math.round(value);
}
