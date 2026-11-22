/*
 * ConditionsCard view-model: turns conditions (from src/utils/conditions.js) and
 * the cook window into display strings. Pure: no DOM, no network, no clock.
 *
 * Display only. Nothing here is read back into the cook-time estimate.
 */
import { windowSummary, boilingPointF } from '../../utils/conditions.js';

const HOUR_MS = 3600 * 1000;

export const SKY_NOTE = 'Sky is shown for reference only.';
export const BOIL_NOTE = 'Based on elevation only.';
export const WIND_NOTE = 'Uses the windier end when the forecast gives a range.';
export const PLANNING_LINE = "Shown for planning. The time estimate doesn't use these conditions yet.";
export const SOURCE_CREDIT = 'Forecast: National Weather Service';
export const NO_WINDOW_NOTE = 'Pick a serving time to see the forecast for your cook.';

const whole = (n) => Math.round(n);
const degF = (n) => `${whole(n)}°F`;
const feet = (n) => `${Math.round(n).toLocaleString('en-US')} ft`;

function tempRange(lo, hi) {
  if (lo == null || hi == null) return null;
  const a = whole(lo);
  const b = whole(hi);
  return a === b ? `${a}°F` : `${a} to ${b}°F`;
}

/** Long generic zone name for a cook location, e.g. "Mountain Time". */
export function zoneLabel(timeZone, at = new Date()) {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longGeneric' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName');
    return `Times in ${part?.value ?? timeZone}`;
  } catch {
    return `Times in ${timeZone}`;
  }
}

function mostCommon(values) {
  const counts = new Map();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = null;
  let bestN = 0;
  for (const [v, n] of counts) {
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best; // ties go to the earliest hour (Map keeps insertion order)
}

function hourlyInWindow(conditions, startMs, endMs) {
  return (conditions.hourly ?? []).filter((p) => {
    const t = Date.parse(p.time);
    return t + HOUR_MS > startMs && t < endMs;
  });
}

function stripCells(periods, timeZone) {
  let hourFmt;
  let dayFmt;
  let dayKeyFmt;
  try {
    hourFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', timeZone });
    dayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone });
    dayKeyFmt = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone });
  } catch {
    hourFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric' });
    dayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short' });
    dayKeyFmt = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' });
  }
  let prevDay = null;
  return periods.map((p) => {
    const d = new Date(p.time);
    const dayKey = dayKeyFmt.format(d);
    const day = dayKey !== prevDay ? dayFmt.format(d) : '';
    prevDay = dayKey;
    return {
      hour: hourFmt.format(d),
      day,
      temp: `${whole(p.tempF)}°`,
      wind: p.windMph == null ? '' : `${whole(p.windMph)} mph`,
    };
  });
}

function missingNote(summary) {
  if (summary.hoursMissing <= 0) return null;
  if (summary.hoursCovered === 0) {
    return 'This cook falls outside the forecast range, so there are no numbers to show.';
  }
  const n = Math.max(1, Math.ceil(summary.hoursMissing - 1e-9));
  return n === 1
    ? '1 hour of this cook falls outside the forecast range and is left out of the numbers above.'
    : `${n} hours of this cook fall outside the forecast range and are left out of the numbers above.`;
}

/**
 * @param {object} conditions  Result of fetchConditions or manualConditions.
 * @param {{start: Date|number, end: Date|number}|null} cookWindow  Meat on to pull, from the scheduler.
 * @returns {{
 *   source: 'nws'|'manual', pill: string, place: string|null,
 *   rows: Array<{key: string, label: string, value: string, note?: string}>,
 *   strip: {label: string, cells: Array<{hour, day, temp, wind}>}|null,
 *   note: string|null, credit: string|null
 * }}
 *   Rows whose value is missing are left out (for example, Gusts when the feed
 *   reports none).
 */
export function buildConditionsView(conditions, cookWindow) {
  const manual = conditions.source === 'manual';
  const rows = [];
  if (conditions.elevationFt != null) {
    rows.push({ key: 'elevation', label: 'Elevation', value: feet(conditions.elevationFt) });
    rows.push({ key: 'boil', label: 'Water boils at', value: degF(boilingPointF(conditions.elevationFt)), note: BOIL_NOTE });
  }

  const view = {
    source: manual ? 'manual' : 'nws',
    pill: manual ? 'Manual' : 'Auto-detected',
    place: !manual && conditions.place?.city ? [conditions.place.city, conditions.place.state].filter(Boolean).join(', ') : null,
    rows,
    strip: null,
    note: null,
    credit: manual ? null : SOURCE_CREDIT,
  };

  if (!cookWindow) {
    view.note = NO_WINDOW_NOTE;
    return view;
  }
  const startMs = +cookWindow.start;
  const endMs = +cookWindow.end;
  const s = windowSummary(conditions, new Date(startMs).toISOString(), new Date(endMs).toISOString());

  const range = tempRange(s.tempMinF, s.tempMaxF);
  if (range) rows.push({ key: 'temp', label: 'Air temperature during the cook', value: range });
  if (s.windAvgMph != null) rows.push({ key: 'wind', label: 'Wind during the cook', value: manual ? `${whole(s.windAvgMph)} mph` : `${whole(s.windAvgMph)} mph average`, ...(manual ? {} : { note: WIND_NOTE }) });
  if (s.gustMaxMph != null) rows.push({ key: 'gust', label: 'Gusts', value: `up to ${whole(s.gustMaxMph)} mph` });
  if (s.dewAvgF != null) rows.push({ key: 'dew', label: 'Dew point during the cook', value: `${whole(s.dewAvgF)}°F average` });

  if (!manual) {
    const periods = hourlyInWindow(conditions, startMs, endMs);
    const sky = mostCommon(periods.map((p) => p.sky));
    if (sky) rows.push({ key: 'sky', label: 'Sky', value: sky, note: SKY_NOTE });
    if (periods.length) view.strip = { label: zoneLabel(conditions.timeZone, new Date(startMs)), cells: stripCells(periods, conditions.timeZone) };
    view.note = missingNote(s);
  }
  return view;
}
