/*
 * Cook plan -> calendar steps -> RFC 5545 (.ics) text and Google Calendar links.
 *
 * Pure: no DOM, no network, no clock (callers pass `now`), no dependencies. It reads the
 * output of buildMilestones() (src/utils/cookMilestones.js) and adds no model math: every
 * timestamp here is one buildMilestones already returned, except two planning conventions
 * that are NOT model output and say so below (the evening prep reminder, and the 15 minute
 * length of a point-in-time event).
 *
 * The plan is anchored on the SERVE time, as the scheduler is: meat-on, pull and fire-up are
 * worked backward from it. There is no start-time anchor and no finish window; the pull step
 * carries the probe guidance, and the scheduler's +/-15 to 25% display range is deliberately
 * left out of the calendar.
 */
import { PREHEAT_HOURS } from './cookMilestones.js';

const MIN_MS = 60 * 1000;
export const POINT_EVENT_MIN = 15; // a point-in-time step gets a 15 minute block; a planning convention
export const PREP_LOCAL_HOUR = 20; // the prep reminder is 8:00 PM, cook-local, the evening before; a planning convention
export const ESTIMATE_NOTE = 'Starts at an internal temperature, so this time is an estimate.';
export const SITE_LINE = 'Planned with Empirical BBQ (empiricalbbq.com/cook-scheduler)';
const UID_DOMAIN = 'empiricalbbq.com';

const validDate = (d) => d instanceof Date && !Number.isNaN(d.getTime());
const defaultZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

/* ------------------------------------------------------------------ */
/* Cook-local wall time (no time zone library)                         */
/* ------------------------------------------------------------------ */

function zoneParts(ms, timeZone) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, +x.value]));
  return { year: p.year, month: p.month, day: p.day, hour: p.hour === 24 ? 0 : p.hour, minute: p.minute, second: p.second };
}

// Offset of `timeZone` from UTC at instant `ms`, in ms (positive east of UTC).
function zoneOffsetMs(ms, timeZone) {
  const p = zoneParts(ms, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

// The instant at which the wall clock in `timeZone` reads year-month-day hour:minute.
// Two passes handle a zone whose offset differs between the guess and the answer.
function wallToUtcMs({ year, month, day, hour, minute = 0 }, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let ms = guess - zoneOffsetMs(guess, timeZone);
  ms = guess - zoneOffsetMs(ms, timeZone);
  return ms;
}

// 8:00 PM, cook-local, on the calendar day before the day the fire is lit.
function prepStartMs(fireUp, timeZone) {
  const { year, month, day } = zoneParts(fireUp.getTime(), timeZone);
  const before = new Date(Date.UTC(year, month - 1, day - 1)); // calendar arithmetic only
  return wallToUtcMs(
    { year: before.getUTCFullYear(), month: before.getUTCMonth() + 1, day: before.getUTCDate(), hour: PREP_LOCAL_HOUR },
    timeZone
  );
}

/* ------------------------------------------------------------------ */
/* Steps                                                               */
/* ------------------------------------------------------------------ */

/**
 * Hours as the scheduler writes a duration: "14h 09m", "2h 00m", "45m". Rounds to whole minutes first, so it
 * can never print 60 minutes.
 */
export function formatDuration(hours) {
  const total = Math.round(hours * 60);
  const hh = Math.floor(total / 60);
  return `${hh ? `${hh}h ` : ''}${String(total % 60).padStart(2, '0')}m`;
}

/**
 * Turn buildMilestones() output into calendar steps.
 *
 * @param {object} plan    Result of buildMilestones: { method, serve, pull, meatOn, fireUp,
 *                         stallOnset, stallEnd, milestones:[{id, at}] }.
 * @param {object} [inputs] { finishTemp, pitTemp, wrapTemp, totalTime } for the step wording. `totalTime` is the
 *                         engine's cook time in hours (cookDuration().totalTime); if it is not given, the plan's own
 *                         meat-on to pull span (the same quantity) is used.
 * @param {object} [opts]   { includePrep = true, timeZone } (timeZone: where the cook is; defaults to the device's).
 * @returns {Array<{ id, title, start: Date, end: Date, estimate: boolean, defaultOn: boolean, note: string }>}
 *   Sorted by start. Ids follow the milestone ids: prep (optional), fire, on, stall (only when the plan
 *   has a stall onset, off by default), wrap (only when present), sauce (3-2-1 ribs only), pull, rest
 *   (a block from pull to serve), serve. A step whose timestamp is missing or invalid is dropped, never thrown.
 *   `estimate` steps start at an internal temperature, so their time is a guess; pull is one.
 */
export function buildCookSteps(plan, inputs = {}, { includePrep = true, timeZone } = {}) {
  if (!plan || !Array.isArray(plan.milestones)) return [];
  const zone = timeZone || defaultZone();
  const timed = new Map(plan.milestones.filter((m) => validDate(m?.at)).map((m) => [m.id, m.at]));
  const isStallMethod = plan.method !== 'method_321';
  const { finishTemp, pitTemp, wrapTemp } = inputs;
  const totalTime = Number.isFinite(inputs.totalTime)
    ? inputs.totalTime
    : validDate(plan.meatOn) && validDate(plan.pull)
      ? (plan.pull.getTime() - plan.meatOn.getTime()) / (60 * MIN_MS)
      : null;
  const steps = [];
  const point = (id, title, at, note, extra = {}) => {
    if (!validDate(at)) return;
    steps.push({
      id,
      title,
      start: new Date(at.getTime()),
      end: new Date(at.getTime() + POINT_EVENT_MIN * MIN_MS),
      estimate: false,
      defaultOn: true,
      note,
      ...extra,
    });
  };

  if (includePrep && validDate(plan.fireUp)) {
    const start = new Date(prepStartMs(plan.fireUp, zone));
    point('prep', '🧂 Prep the meat', start, 'Trim and season tonight, and check your fuel.');
  }

  // fire: the scheduler's preheat (PREHEAT_HOURS, 45 minutes) is a planning convention, not model output.
  const preheatMin = Math.round(PREHEAT_HOURS * 60);
  point(
    'fire',
    '🔥 Light the fire',
    timed.get('fire'),
    pitTemp ? `Preheat the pit to ${pitTemp}°F (${preheatMin} minutes before the meat goes on).` : `Preheat the pit (${preheatMin} minutes before the meat goes on).`
  );
  // The cook time is the engine's (it is what the whole plan was worked backward from), shown as an estimate.
  const estimated = totalTime > 0 ? ` Estimated ${formatDuration(totalTime)}${finishTemp ? ` to a ${finishTemp}°F finish` : ''}.` : '';
  point('on', '🥩 Meat on', timed.get('on'), `Cold meat on the grate.${estimated}`);

  if (validDate(plan.stallOnset)) {
    point('stall', '⏸️ Stall begins', plan.stallOnset, `The internal temperature may plateau around now. ${ESTIMATE_NOTE}`, { estimate: true, defaultOn: false });
  }

  if (timed.has('wrap')) {
    if (isStallMethod) {
      point('wrap', wrapTemp ? `📦 Wrap at ${wrapTemp}°F` : '📦 Wrap', timed.get('wrap'), 'Start checking the internal temp ahead of this time, since the real moment can come sooner.', { estimate: true });
    } else {
      point('wrap', '📦 Wrap in foil', timed.get('wrap'), 'Wrap now, as the fixed-time method calls for.'); // a fixed block (3-2-1 or 2-2-1): a time, not a temperature
    }
  }
  if (timed.has('sauce')) point('sauce', '🍯 Unwrap and sauce', timed.get('sauce'), 'Unwrap and sauce, as the fixed-time method calls for.');

  // pull is the estimate step: there is no finish window, so it carries the probe guidance.
  point(
    'pull',
    '🌡️ Pull the meat',
    timed.get('pull'),
    finishTemp ? `Pull when it probes tender near ${finishTemp}°F. This time is an estimate.` : 'Pull when it probes tender. This time is an estimate.',
    { estimate: true }
  );

  const pull = timed.get('pull');
  const serve = timed.get('serve');
  if (validDate(pull) && validDate(serve) && serve.getTime() > pull.getTime()) {
    steps.push({
      id: 'rest',
      title: '⏳ Rest',
      start: new Date(pull.getTime()),
      end: new Date(serve.getTime()),
      estimate: false,
      defaultOn: true,
      note: 'Rest the meat before slicing.',
    });
  }
  point('serve', '🍽️ Serve', serve, 'Slice and serve.');

  return steps.sort((a, b) => a.start - b.start);
}

/* ------------------------------------------------------------------ */
/* Stable plan id                                                      */
/* ------------------------------------------------------------------ */

// FNV-1a, 32 bit, as 8 hex digits.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(str)) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * A short stable id for a plan: the same inputs and serve time always give the same id, so events
 * a person already added keep their UIDs; a different serve time, protein, weight, cut, pit
 * temperature or wrap setting gives a different one.
 * @param {object} inputs  { protein (id or a registry protein), weight, cut, pitTemp, wrap, wrapTemp }
 * @param {string} serveISO  the serve instant, as an ISO string
 */
export function planId(inputs, serveISO) {
  const protein = typeof inputs.protein === 'object' && inputs.protein ? inputs.protein.meta?.id : inputs.protein;
  return fnv1a([protein, inputs.weight, inputs.cut ?? '', inputs.pitTemp, inputs.wrap, inputs.wrapTemp, serveISO].map((v) => String(v ?? '')).join('|'));
}

/* ------------------------------------------------------------------ */
/* RFC 5545 text                                                       */
/* ------------------------------------------------------------------ */

/** Escape a TEXT value: backslash, semicolon, comma and newlines. */
export function escapeText(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Fold a content line at 75 octets (UTF-8 bytes, not characters), continuing with CRLF plus one
 * space. A character is never split, so a multi-byte one (the degree sign is 2 bytes, an emoji 4)
 * moves whole to the next line. A continuation line is the space plus at most 74 octets.
 */
export function foldLine(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) {
      out.push(cur);
      cur = '';
      bytes = 0;
      limit = 74; // the leading space of a continuation line takes one octet
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
function icsUtc(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/**
 * Build the .ics text for the given (already selected) steps.
 * Every line ends CRLF, long lines are folded, TEXT is escaped, times are UTC with a Z (so no
 * VTIMEZONE is needed), and each event has UID `${planId}-${step.id}@empiricalbbq.com`, SEQUENCE:0
 * and a DISPLAY alarm `reminderMin` minutes before (0 means at the start time; a non-number means none).
 * @param {Array} steps
 * @param {object} opts { planId (required), calName, reminderMin = 10, now (Date or ms) }
 */
export function buildIcs(steps, { planId: id, calName = 'Empirical BBQ cook', reminderMin = 10, now = Date.now() } = {}) {
  if (!id) throw new TypeError('buildIcs needs a planId.');
  const stamp = icsUtc(+now);
  const alarm = Number.isFinite(reminderMin) && reminderMin >= 0 ? (reminderMin === 0 ? 'PT0S' : `-PT${Math.round(reminderMin)}M`) : null;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Empirical BBQ//Cook Planner//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calName)}`,
  ];
  for (const step of steps) {
    if (!validDate(step?.start) || !validDate(step?.end)) continue;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${id}-${step.id}@${UID_DOMAIN}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsUtc(step.start.getTime())}`,
      `DTEND:${icsUtc(step.end.getTime())}`,
      `SUMMARY:${escapeText(step.title)}`,
      `DESCRIPTION:${escapeText(`${step.note} ${SITE_LINE}`)}`,
      'SEQUENCE:0'
    );
    if (alarm) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(step.title)}`, `TRIGGER:${alarm}`, 'END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/* ------------------------------------------------------------------ */
/* Google Calendar and display                                         */
/* ------------------------------------------------------------------ */

/** A link that opens Google Calendar's "add event" page with this step filled in. */
export function googleCalendarUrl(step) {
  const q = (s) => encodeURIComponent(s);
  const dates = `${icsUtc(step.start.getTime())}/${icsUtc(step.end.getTime())}`;
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${q(step.title)}&dates=${dates}&details=${q(`${step.note} ${SITE_LINE}`)}`;
}

/**
 * Whether two time zones show a different clock reading at `at` (a different UTC offset then). A zone that is not
 * recognized never counts as different: it cannot be compared, so no warning is better than a wrong one.
 */
export function zonesDiffer(zoneA, zoneB, at = new Date()) {
  try {
    return zoneOffsetMs(at.getTime(), zoneA) !== zoneOffsetMs(at.getTime(), zoneB);
  } catch {
    return false;
  }
}

/** The long generic name of a time zone, for example "Mountain Time"; the zone id itself if it is not recognized. */
export function zoneName(timeZone, at = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longGeneric' }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

/**
 * A download file name like "empirical-bbq-pork-shoulder-2026-11-22.ics": the protein's slug and the serve
 * date as it reads in the cook's time zone.
 */
export function icsFilename(slug, serve, timeZone) {
  let date;
  try {
    date = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(serve);
  } catch {
    date = serve.toISOString().slice(0, 10);
  }
  const safe = String(slug || 'cook').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'cook';
  return `empirical-bbq-${safe}-${date}.ics`;
}

/**
 * The step's start time, in the cook's time zone. Estimate steps get a leading "~".
 * @param {object} step
 * @param {string} [timeZone]  IANA zone of the cook (defaults to the device's)
 * @param {string} [locale]    defaults to the device's
 */
export function formatStepTime(step, timeZone, locale) {
  const f = new Intl.DateTimeFormat(locale, {
    timeZone: timeZone || defaultZone(),
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${step.estimate ? '~' : ''}${f.format(step.start)}`;
}
