/*
 * Weather fields for a cook-log start, built from what the reader typed. Pure: no DOM, no network,
 * no location. The Worker re-validates everything (workers/cook-log-service/server/validation.ts).
 *
 * Two kinds of input, and weather_source says which the reader gave:
 *   typed   ambient_temp_f and/or altitude_ft: single point values (what the form has always taken)
 *   manual  an expected low and high for the cook, and/or an average wind. The window average is
 *           the midpoint of the low and high, the same rule manualConditions() in conditions.js uses.
 * When both kinds are given the source is 'manual' (the reader described the whole cook, not just a moment).
 * Nothing is looked up. Forecast or observed weather ('nws_forecast') is a later change and never set here.
 */

const toInt = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
};

/**
 * @param {{ ambient?: string, altitude?: string, low?: string, high?: string, wind?: string }} raw  input values as strings
 * @returns {{ fields: object, error?: string }}
 */
export function buildWeatherFields(raw = {}) {
  const ambient = toInt(raw.ambient);
  const altitude = toInt(raw.altitude);
  const low = toInt(raw.low);
  const high = toInt(raw.high);
  const wind = toInt(raw.wind);
  if ([ambient, altitude, low, high, wind].some(Number.isNaN)) return { fields: {}, error: 'Enter numbers only in the weather fields.' };
  if ((low == null) !== (high == null)) return { fields: {}, error: 'Enter both the expected low and high, or neither.' };
  if (low != null && low > high) return { fields: {}, error: 'The expected low can’t be higher than the high.' };
  if (wind != null && wind < 0) return { fields: {}, error: 'Wind can’t be negative.' };

  const fields = {};
  if (ambient != null) fields.ambient_temp_f = ambient;
  if (altitude != null) fields.altitude_ft = altitude;
  const manual = low != null || wind != null;
  if (low != null) {
    fields.ambient_temp_min_f = low;
    fields.ambient_temp_max_f = high;
    fields.ambient_temp_avg_f = Math.round(((low + high) / 2) * 10) / 10;
  }
  if (wind != null) fields.wind_avg_mph = wind;
  if (manual) fields.weather_source = 'manual';
  else if (ambient != null || altitude != null) fields.weather_source = 'typed';
  return { fields };
}
