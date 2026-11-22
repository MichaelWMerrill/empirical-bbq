import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PROTEINS } from '../proteinRegistry.js';
import { cookDuration } from '../stallEngine.js';
import { buildMilestones, PREHEAT_HOURS } from '../cookMilestones.js';
import {
  buildCookSteps,
  buildIcs,
  planId,
  escapeText,
  foldLine,
  googleCalendarUrl,
  formatStepTime,
  ESTIMATE_NOTE,
  POINT_EVENT_MIN,
} from '../ics.js';

/* ---------- fixtures: a real plan from the real (pure) engine, anchored on the serve time ---------- */

const ZONE = 'America/Denver';
const SERVE = new Date('2026-11-22T18:00:00-07:00'); // Sunday 6:00 PM Mountain
const NOW = Date.UTC(2026, 10, 20, 15, 30, 0); // DTSTAMP
const MIN = 60 * 1000;

const BASE = { pitTemp: '225', pit: 'ceramic_kamado', wrap: 'peach_butcher_paper', wrapTemp: 160, climate: 'moderate' };

function plan(proteinId, state, { rest = 1, serve = SERVE } = {}) {
  const protein = PROTEINS[proteinId];
  const duration = cookDuration(protein, state);
  return { protein, state, duration, plan: buildMilestones({ duration, inputs: { rest, wrap: state.wrap, wrapTemp: state.wrapTemp }, serve }) };
}
const pork = () => plan('pork_shoulder', { ...BASE, weight: 8.5 });
const ribs = () => plan('pork_ribs', { ...BASE, cut: 'spare', racks: 3 }, { rest: 0.5 });
const wording = (p) => ({ finishTemp: p.protein.thermal.finish_temp, pitTemp: p.state.pitTemp, wrapTemp: p.state.wrapTemp });
const stepsFor = (p, opts = {}) => buildCookSteps(p.plan, wording(p), { timeZone: ZONE, ...opts });
const iso = (d) => d.toISOString();
const view = (steps) => steps.map((s) => ({ id: s.id, title: s.title, start: iso(s.start), end: iso(s.end), estimate: s.estimate, defaultOn: s.defaultOn, note: s.note }));
const ids = (steps) => steps.map((s) => s.id);
const byId = (steps, id) => steps.find((s) => s.id === id);

// A minimal RFC 5545 reader, enough to validate structure without a dependency.
function unfold(text) {
  return text.replace(/\r\n[ \t]/g, '');
}
function parse(text) {
  const lines = unfold(text).split('\r\n');
  expect(lines.at(-1), 'ends with CRLF').toBe('');
  const stack = [];
  const root = { name: 'ROOT', props: [], children: [] };
  let cur = root;
  for (const line of lines.slice(0, -1)) {
    const i = line.indexOf(':');
    const key = line.slice(0, i);
    const value = line.slice(i + 1);
    if (key === 'BEGIN') {
      const node = { name: value, props: [], children: [] };
      cur.children.push(node);
      stack.push(cur);
      cur = node;
    } else if (key === 'END') {
      expect(cur.name, 'balanced BEGIN/END').toBe(value);
      cur = stack.pop();
    } else cur.props.push([key, value]);
  }
  expect(stack).toHaveLength(0);
  return root.children[0];
}
const prop = (node, key) => node.props.find(([k]) => k === key)?.[1];

/* ---------- steps ---------- */

describe('buildCookSteps: pork shoulder, 8.5 lb (snapshot)', () => {
  test('the step list', () => {
    expect(view(stepsFor(pork()))).toMatchInlineSnapshot(`
      [
        {
          "defaultOn": true,
          "end": "2026-11-22T03:15:00.000Z",
          "estimate": false,
          "id": "prep",
          "note": "Trim and season tonight, and check your fuel.",
          "start": "2026-11-22T03:00:00.000Z",
          "title": "🧂 Prep the meat",
        },
        {
          "defaultOn": true,
          "end": "2026-11-22T09:20:48.751Z",
          "estimate": false,
          "id": "fire",
          "note": "Preheat the pit to 225°F (45 minutes before the meat goes on).",
          "start": "2026-11-22T09:05:48.751Z",
          "title": "🔥 Light the fire",
        },
        {
          "defaultOn": true,
          "end": "2026-11-22T10:05:48.751Z",
          "estimate": false,
          "id": "on",
          "note": "Cold meat on the grate.",
          "start": "2026-11-22T09:50:48.751Z",
          "title": "🥩 Meat on",
        },
        {
          "defaultOn": false,
          "end": "2026-11-22T20:48:27.030Z",
          "estimate": true,
          "id": "stall",
          "note": "The internal temperature may plateau around now. Starts at an internal temperature, so this time is an estimate.",
          "start": "2026-11-22T20:33:27.030Z",
          "title": "⏸️ Stall begins",
        },
        {
          "defaultOn": true,
          "end": "2026-11-22T21:12:48.092Z",
          "estimate": true,
          "id": "wrap",
          "note": "Have paper or foil ready. Starts at an internal temperature, so this time is an estimate.",
          "start": "2026-11-22T20:57:48.092Z",
          "title": "📦 Wrap at 160°F",
        },
        {
          "defaultOn": true,
          "end": "2026-11-23T00:15:00.000Z",
          "estimate": true,
          "id": "pull",
          "note": "Pull when it probes tender near 202°F. This time is an estimate.",
          "start": "2026-11-23T00:00:00.000Z",
          "title": "🌡️ Pull the meat",
        },
        {
          "defaultOn": true,
          "end": "2026-11-23T01:00:00.000Z",
          "estimate": false,
          "id": "rest",
          "note": "Rest the meat before slicing.",
          "start": "2026-11-23T00:00:00.000Z",
          "title": "⏳ Rest",
        },
        {
          "defaultOn": true,
          "end": "2026-11-23T01:15:00.000Z",
          "estimate": false,
          "id": "serve",
          "note": "Slice and serve.",
          "start": "2026-11-23T01:00:00.000Z",
          "title": "🍽️ Serve",
        },
      ]
    `);
  });

  test('works from the buildMilestones output: the same timestamps, in order', () => {
    const p = pork();
    const steps = stepsFor(p);
    expect(ids(steps)).toEqual(['prep', 'fire', 'on', 'stall', 'wrap', 'pull', 'rest', 'serve']);
    expect(byId(steps, 'fire').start.getTime()).toBe(p.plan.fireUp.getTime());
    expect(byId(steps, 'on').start.getTime()).toBe(p.plan.meatOn.getTime());
    expect(byId(steps, 'pull').start.getTime()).toBe(p.plan.pull.getTime());
    expect(byId(steps, 'serve').start.getTime()).toBe(SERVE.getTime());
    expect(byId(steps, 'stall').start.getTime()).toBe(p.plan.stallOnset.getTime());
    const starts = steps.map((s) => s.start.getTime());
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  test('the plan is anchored on the serve time: the fire step is the scheduler preheat before meat on', () => {
    const p = pork();
    const fire = byId(stepsFor(p), 'fire');
    expect(p.plan.meatOn.getTime() - fire.start.getTime()).toBe(PREHEAT_HOURS * 60 * MIN); // 45 minutes, from PREHEAT_HOURS
    expect(fire.note).toContain('45 minutes');
  });

  test('point steps last 15 minutes; the rest step is a block from pull to serve', () => {
    const steps = stepsFor(pork());
    for (const id of ['fire', 'on', 'wrap', 'pull', 'serve']) {
      const s = byId(steps, id);
      expect(s.end.getTime() - s.start.getTime(), id).toBe(POINT_EVENT_MIN * MIN);
    }
    const rest = byId(steps, 'rest');
    expect(rest.start.getTime()).toBe(byId(steps, 'pull').start.getTime());
    expect(rest.end.getTime()).toBe(SERVE.getTime());
  });

  test('estimate steps are the ones that start at an internal temperature; pull carries the probe note', () => {
    const steps = stepsFor(pork());
    expect(steps.filter((s) => s.estimate).map((s) => s.id)).toEqual(['stall', 'wrap', 'pull']);
    expect(byId(steps, 'pull').note).toBe('Pull when it probes tender near 202°F. This time is an estimate.');
    expect(byId(steps, 'wrap').note).toContain(ESTIMATE_NOTE);
    expect(ESTIMATE_NOTE).toBe('Starts at an internal temperature, so this time is an estimate.');
  });

  test('there is no probe step and the scheduler display range is left out of every step', () => {
    const steps = stepsFor(pork());
    expect(ids(steps)).not.toContain('probe');
    for (const s of steps) expect(`${s.title} ${s.note}`, s.id).not.toMatch(/%|window|range|\bto\b \d+h/i);
  });

  test('stall is off by default; the others, including prep, are on', () => {
    const steps = stepsFor(pork());
    expect(byId(steps, 'stall').defaultOn).toBe(false);
    for (const s of steps.filter((x) => x.id !== 'stall')) expect(s.defaultOn, s.id).toBe(true);
  });

  test('no step wording carries an em dash, a safety claim, or a protein name', () => {
    for (const s of [...stepsFor(pork()), ...stepsFor(ribs())]) {
      const text = `${s.title} ${s.note}`;
      expect(text, s.id).not.toMatch(/\u2014/);
      expect(text, s.id).not.toMatch(/140|safe|brisket|pork|turkey/i);
      expect(text, s.id).not.toMatch(/bark|liquid|for a while/i); // claims the site does not model or support (science-editor)
    }
  });
});

describe('buildCookSteps: ribs (3-2-1)', () => {
  test('adds a sauce step, has no stall step, and the wrap is a time not an estimate', () => {
    const steps = stepsFor(ribs());
    expect(ids(steps)).toEqual(['prep', 'fire', 'on', 'wrap', 'sauce', 'pull', 'rest', 'serve']);
    expect(byId(steps, 'wrap').estimate).toBe(false);
    expect(byId(steps, 'sauce').estimate).toBe(false);
    expect(byId(steps, 'pull').estimate).toBe(true);
    const p = ribs();
    const smoke = p.duration.phases321.smoke;
    expect(byId(steps, 'wrap').start.getTime() - p.plan.meatOn.getTime()).toBe(smoke * 60 * MIN);
  });

  test('a stall-method plan without a wrap temperature the path reaches has no wrap step', () => {
    const p = plan('pork_shoulder', { ...BASE, weight: 8.5, wrapTemp: 500 });
    expect(ids(stepsFor(p))).not.toContain('wrap');
  });
});

describe('buildCookSteps: prep (8:00 PM cook-local, the evening before)', () => {
  const localParts = (d, tz) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(d).map((x) => [x.type, +x.value]));
    return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
  };
  const fake = (fireUp, tz) =>
    buildCookSteps({ method: 'stall', fireUp, milestones: [] }, {}, { timeZone: tz }).find((s) => s.id === 'prep');

  test('is 8:00 PM on the calendar day before the day the fire is lit, in the cook zone', () => {
    const p = pork();
    const prep = byId(stepsFor(p), 'prep');
    const fireLocal = localParts(p.plan.fireUp, ZONE);
    const prepLocal = localParts(prep.start, ZONE);
    expect(prepLocal.endsWith('20:00')).toBe(true);
    const d = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
    expect((d(fireLocal) - d(prepLocal)) / 86400000).toBe(1);
  });

  test.each([
    ['America/Denver', '2026-07-18T01:30:00-06:00', '2026-07-17 20:00'], // a fire lit just after midnight
    ['America/Denver', '2026-07-18T23:30:00-06:00', '2026-07-17 20:00'], // lit late the same evening: still the evening before that day
    ['Asia/Kolkata', '2026-07-18T06:00:00+05:30', '2026-07-17 20:00'],
    ['Pacific/Auckland', '2026-07-18T05:00:00+12:00', '2026-07-17 20:00'],
    ['America/Denver', '2026-11-01T03:00:00-07:00', '2026-10-31 20:00'], // after the fall-back change; the evening before is still daylight time
    ['America/Denver', '2026-03-08T04:00:00-06:00', '2026-03-07 20:00'], // after the spring-forward change
    ['UTC', '2026-12-31T04:00:00Z', '2026-12-30 20:00'],
    ['UTC', '2027-01-01T04:00:00Z', '2026-12-31 20:00'], // across a year boundary
  ])('%s, fire at %s: prep is %s local', (tz, fireISO, expected) => {
    const prep = fake(new Date(fireISO), tz);
    expect(localParts(prep.start, tz)).toBe(expected);
  });

  test('the DST offsets are right: Oct 31 prep is -06:00, a Nov 2 prep is -07:00', () => {
    expect(fake(new Date('2026-11-01T03:00:00-07:00'), 'America/Denver').start.toISOString()).toBe('2026-11-01T02:00:00.000Z');
    expect(fake(new Date('2026-11-02T03:00:00-07:00'), 'America/Denver').start.toISOString()).toBe('2026-11-02T03:00:00.000Z');
  });

  test('includePrep: false drops it', () => {
    expect(ids(stepsFor(pork(), { includePrep: false }))).not.toContain('prep');
    expect(ids(stepsFor(pork()))).toContain('prep');
  });
});

describe('buildCookSteps: missing engine timestamps drop their steps instead of throwing', () => {
  test('no stall onset: no stall step', () => {
    const p = pork();
    expect(ids(buildCookSteps({ ...p.plan, stallOnset: null }, wording(p), { timeZone: ZONE }))).not.toContain('stall');
  });
  test('no wrap milestone: no wrap step', () => {
    const p = pork();
    const noWrap = { ...p.plan, milestones: p.plan.milestones.filter((m) => m.id !== 'wrap') };
    expect(ids(buildCookSteps(noWrap, wording(p), { timeZone: ZONE }))).not.toContain('wrap');
  });
  test('an invalid timestamp is dropped; the rest survive', () => {
    const p = pork();
    const bad = { ...p.plan, milestones: p.plan.milestones.map((m) => (m.id === 'on' ? { ...m, at: new Date('nope') } : m)) };
    const out = ids(buildCookSteps(bad, wording(p), { timeZone: ZONE }));
    expect(out).not.toContain('on');
    expect(out).toEqual(expect.arrayContaining(['fire', 'pull', 'serve']));
  });
  test('a missing plan gives no steps', () => {
    expect(buildCookSteps(null)).toEqual([]);
    expect(buildCookSteps({})).toEqual([]);
    expect(buildCookSteps({ milestones: [] }, {}, { timeZone: ZONE, includePrep: false })).toEqual([]);
  });
});

/* ---------- planId ---------- */

describe('planId', () => {
  const inputs = { protein: 'pork_shoulder', weight: 8.5, cut: undefined, pitTemp: '225', wrap: 'peach_butcher_paper', wrapTemp: 160 };
  const serveISO = SERVE.toISOString();

  test('is a short hex hash, stable for the same inputs and serve time', () => {
    const a = planId(inputs, serveISO);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(planId({ ...inputs }, serveISO)).toBe(a);
  });

  test('accepts a registry protein as well as its id', () => {
    expect(planId({ ...inputs, protein: PROTEINS.pork_shoulder }, serveISO)).toBe(planId(inputs, serveISO));
  });

  test.each([
    ['serve time', inputs, new Date(SERVE.getTime() + MIN).toISOString()],
    ['protein', { ...inputs, protein: 'beef_brisket' }, serveISO],
    ['weight', { ...inputs, weight: 9 }, serveISO],
    ['cut', { ...inputs, cut: 'spare' }, serveISO],
    ['pit temp', { ...inputs, pitTemp: '250' }, serveISO],
    ['wrap', { ...inputs, wrap: 'aluminum_foil' }, serveISO],
    ['wrap temp', { ...inputs, wrapTemp: 165 }, serveISO],
  ])('changing the %s changes it', (_n, i, s) => {
    expect(planId(i, s)).not.toBe(planId(inputs, serveISO));
  });
});

/* ---------- RFC 5545 text ---------- */

describe('escapeText', () => {
  test('escapes backslash, semicolon, comma and newlines (backslash first)', () => {
    expect(escapeText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    expect(escapeText('line1\r\nline2')).toBe('line1\\nline2');
    expect(escapeText('plain')).toBe('plain');
    expect(escapeText('\\,')).toBe('\\\\\\,');
  });
});

describe('foldLine', () => {
  const bytes = (s) => new TextEncoder().encode(s).length;
  const strict = new TextDecoder('utf-8', { fatal: true });
  const physical = (folded) => folded.split('\r\n');

  test('a short line is untouched', () => {
    expect(foldLine('SUMMARY:short')).toBe('SUMMARY:short');
    expect(foldLine('x'.repeat(75))).toBe('x'.repeat(75));
  });

  test('folds at 75 octets, continues with a single space, and unfolds to the original (ASCII)', () => {
    const line = 'DESCRIPTION:' + 'word '.repeat(60);
    const f = foldLine(line);
    const parts = physical(f);
    expect(parts.length).toBeGreaterThan(1);
    expect(bytes(parts[0])).toBe(75);
    for (const part of parts.slice(1)) {
      expect(part.startsWith(' ')).toBe(true);
      expect(bytes(part)).toBeLessThanOrEqual(75);
    }
    expect(f.replace(/\r\n /g, '')).toBe(line);
  });

  test('counts bytes, not characters: a long SUMMARY with degree signs (2 bytes each) folds at 75 bytes and never splits one', () => {
    for (const lead of ['SUMMARY:', 'SUMMARY:x', 'DESCRIPTION:', 'DESCRIPTION:x']) {
      const line = lead + '°'.repeat(120);
      const f = foldLine(line);
      for (const part of physical(f)) {
        expect(bytes(part), `${lead} line length`).toBeLessThanOrEqual(75);
        expect(() => strict.decode(new TextEncoder().encode(part)), 'valid UTF-8 on every physical line').not.toThrow();
        expect(part).not.toContain('�');
      }
      expect(f.replace(/\r\n /g, '')).toBe(line);
    }
  });

  test('a 4-byte character (an emoji) is not split either', () => {
    for (const lead of ['SUMMARY:', 'SUMMARY:x', 'SUMMARY:xx', 'SUMMARY:xxx']) {
      const line = lead + '🔥'.repeat(40);
      const f = foldLine(line);
      for (const part of physical(f)) {
        expect(bytes(part)).toBeLessThanOrEqual(75);
        expect(() => strict.decode(new TextEncoder().encode(part))).not.toThrow();
      }
      expect(f.replace(/\r\n /g, '')).toBe(line);
    }
  });

  test('the first octet over 75 moves the whole character to the next line', () => {
    const line = 'S:' + 'a'.repeat(72) + '°'; // 74 octets, then a 2-byte char would make 76
    const parts = physical(foldLine(line));
    expect(parts).toEqual(['S:' + 'a'.repeat(72), ' °']);
  });
});

/* ---------- buildIcs ---------- */

describe('buildIcs', () => {
  const p = pork();
  const steps = stepsFor(p);
  const id = planId({ protein: 'pork_shoulder', weight: 8.5, pitTemp: '225', wrap: BASE.wrap, wrapTemp: 160 }, SERVE.toISOString());
  const ics = buildIcs(steps.filter((s) => s.defaultOn), { planId: id, now: NOW });

  test('the full .ics text (snapshot)', () => {
    expect(ics.split('\r\n')).toMatchInlineSnapshot(`
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Empirical BBQ//Cook Planner//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:Empirical BBQ cook",
        "BEGIN:VEVENT",
        "UID:539c5d3b-prep@empiricalbbq.com",
        "DTSTAMP:20261120T153000Z",
        "DTSTART:20261122T030000Z",
        "DTEND:20261122T031500Z",
        "SUMMARY:🧂 Prep the meat",
        "DESCRIPTION:Trim and season tonight\\, and check your fuel. Planned with Emp",
        " irical BBQ (empiricalbbq.com/cook-scheduler)",
        "SEQUENCE:0",
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        "DESCRIPTION:🧂 Prep the meat",
        "TRIGGER:-PT10M",
        "END:VALARM",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:539c5d3b-fire@empiricalbbq.com",
        "DTSTAMP:20261120T153000Z",
        "DTSTART:20261122T090548Z",
        "DTEND:20261122T092048Z",
        "SUMMARY:🔥 Light the fire",
        "DESCRIPTION:Preheat the pit to 225°F (45 minutes before the meat goes on).",
        "  Planned with Empirical BBQ (empiricalbbq.com/cook-scheduler)",
        "SEQUENCE:0",
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        "DESCRIPTION:🔥 Light the fire",
        "TRIGGER:-PT10M",
        "END:VALARM",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:539c5d3b-on@empiricalbbq.com",
        "DTSTAMP:20261120T153000Z",
        "DTSTART:20261122T095048Z",
        "DTEND:20261122T100548Z",
        "SUMMARY:🥩 Meat on",
        "DESCRIPTION:Cold meat on the grate. Planned with Empirical BBQ (empiricalbb",
        " q.com/cook-scheduler)",
        "SEQUENCE:0",
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        "DESCRIPTION:🥩 Meat on",
        "TRIGGER:-PT10M",
        "END:VALARM",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:539c5d3b-wrap@empiricalbbq.com",
        "DTSTAMP:20261120T153000Z",
        "DTSTART:20261122T205748Z",
        "DTEND:20261122T211248Z",
        "SUMMARY:📦 Wrap at 160°F",
        "DESCRIPTION:Have paper or foil ready. Starts at an internal temperature\\, s",
        " o this time is an estimate. Planned with Empirical BBQ (empiricalbbq.com/c",
        " ook-scheduler)",
        "SEQUENCE:0",
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        "DESCRIPTION:📦 Wrap at 160°F",
        "TRIGGER:-PT10M",
        "END:VALARM",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:539c5d3b-pull@empiricalbbq.com",
        "DTSTAMP:20261120T153000Z",
        "DTSTART:20261123T000000Z",
        "DTEND:20261123T001500Z",
        "SUMMARY:🌡️ Pull the meat",
        "DESCRIPTION:Pull when it probes tender near 202°F. This time is an estimat",
        " e. Planned with Empirical BBQ (empiricalbbq.com/cook-scheduler)",
        "SEQUENCE:0",
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        "DESCRIPTION:🌡️ Pull the meat",
        "TRIGGER:-PT10M",
        "END:VALARM",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:539c5d3b-rest@empiricalbbq.com",
        "DTSTAMP:20261120T153000Z",
        "DTSTART:20261123T000000Z",
        "DTEND:20261123T010000Z",
        "SUMMARY:⏳ Rest",
        "DESCRIPTION:Rest the meat before slicing. Planned with Empirical BBQ (empir",
        " icalbbq.com/cook-scheduler)",
        "SEQUENCE:0",
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        "DESCRIPTION:⏳ Rest",
        "TRIGGER:-PT10M",
        "END:VALARM",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:539c5d3b-serve@empiricalbbq.com",
        "DTSTAMP:20261120T153000Z",
        "DTSTART:20261123T010000Z",
        "DTEND:20261123T011500Z",
        "SUMMARY:🍽️ Serve",
        "DESCRIPTION:Slice and serve. Planned with Empirical BBQ (empiricalbbq.com/c",
        " ook-scheduler)",
        "SEQUENCE:0",
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        "DESCRIPTION:🍽️ Serve",
        "TRIGGER:-PT10M",
        "END:VALARM",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
      ]
    `);
  });

  test('is a valid calendar: CRLF only, balanced, required properties, ends with CRLF', () => {
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    const cal = parse(ics);
    expect(cal.name).toBe('VCALENDAR');
    expect(prop(cal, 'VERSION')).toBe('2.0');
    expect(prop(cal, 'PRODID')).toBe('-//Empirical BBQ//Cook Planner//EN');
    expect(prop(cal, 'CALSCALE')).toBe('GREGORIAN');
    expect(prop(cal, 'METHOD')).toBe('PUBLISH');
    expect(prop(cal, 'X-WR-CALNAME')).toBe('Empirical BBQ cook');
    const events = cal.children.filter((c) => c.name === 'VEVENT');
    expect(events).toHaveLength(steps.filter((s) => s.defaultOn).length);
    for (const ev of events) {
      for (const k of ['UID', 'DTSTAMP', 'DTSTART', 'DTEND', 'SUMMARY', 'DESCRIPTION', 'SEQUENCE']) expect(prop(ev, k), k).toBeTruthy();
      expect(prop(ev, 'DTSTART')).toMatch(/^\d{8}T\d{6}Z$/);
      expect(prop(ev, 'DTEND')).toMatch(/^\d{8}T\d{6}Z$/);
      expect(prop(ev, 'DTSTAMP')).toBe('20261120T153000Z');
      expect(prop(ev, 'SEQUENCE')).toBe('0');
      const alarm = ev.children.find((c) => c.name === 'VALARM');
      expect(prop(alarm, 'ACTION')).toBe('DISPLAY');
      expect(prop(alarm, 'TRIGGER')).toBe('-PT10M');
      expect(prop(alarm, 'DESCRIPTION')).toBe(prop(ev, 'SUMMARY'));
    }
  });

  test('no physical line is over 75 octets', () => {
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });

  test('UIDs are planId-stepId@empiricalbbq.com, unique, and do not depend on the time of the download', () => {
    const uids = (text) => parse(text).children.filter((c) => c.name === 'VEVENT').map((e) => prop(e, 'UID'));
    const a = uids(ics);
    expect(a).toEqual(steps.filter((s) => s.defaultOn).map((s) => `${id}-${s.id}@empiricalbbq.com`));
    expect(new Set(a).size).toBe(a.length);
    expect(uids(buildIcs(steps.filter((s) => s.defaultOn), { planId: id, now: NOW + 86400000 }))).toEqual(a);
  });

  test('a different serve time gives different UIDs', () => {
    const other = planId({ protein: 'pork_shoulder', weight: 8.5, pitTemp: '225', wrap: BASE.wrap, wrapTemp: 160 }, new Date(SERVE.getTime() + 30 * MIN).toISOString());
    expect(other).not.toBe(id);
  });

  test('only the steps given become events', () => {
    const only = buildIcs([byId(steps, 'serve')], { planId: id, now: NOW });
    expect(parse(only).children.filter((c) => c.name === 'VEVENT')).toHaveLength(1);
    expect(parse(buildIcs([], { planId: id, now: NOW })).children.filter((c) => c.name === 'VEVENT')).toHaveLength(0);
  });

  test.each([
    [10, '-PT10M'],
    [30, '-PT30M'],
    [0, 'PT0S'], // at the start time
  ])('reminderMin %s gives TRIGGER:%s', (n, trigger) => {
    const ev = parse(buildIcs([byId(steps, 'serve')], { planId: id, now: NOW, reminderMin: n })).children.find((c) => c.name === 'VEVENT');
    expect(prop(ev.children.find((c) => c.name === 'VALARM'), 'TRIGGER')).toBe(trigger);
  });

  test('a reminder of null or NaN means no alarm', () => {
    for (const reminderMin of [null, NaN, -5]) {
      const ev = parse(buildIcs([byId(steps, 'serve')], { planId: id, now: NOW, reminderMin })).children.find((c) => c.name === 'VEVENT');
      expect(ev.children.some((c) => c.name === 'VALARM')).toBe(false);
    }
  });

  test('escapes TEXT and unfolds back to the escaped value (comma, semicolon, backslash, newline, degree, emoji)', () => {
    const tricky = {
      id: 'on',
      title: '🔥 Fire, wood; and a back\\slash',
      note: 'Line one\nline two, with 225°F; ' + 'long text '.repeat(20),
      start: new Date('2026-11-22T20:00:00Z'),
      end: new Date('2026-11-22T20:15:00Z'),
    };
    const text = buildIcs([tricky], { planId: 'abcd1234', now: NOW, calName: 'Cook, plan; v2' });
    const cal = parse(text);
    expect(prop(cal, 'X-WR-CALNAME')).toBe('Cook\\, plan\\; v2');
    const ev = cal.children.find((c) => c.name === 'VEVENT');
    expect(prop(ev, 'SUMMARY')).toBe('🔥 Fire\\, wood\\; and a back\\\\slash');
    expect(prop(ev, 'DESCRIPTION')).toContain('Line one\\nline two\\, with 225°F\\; ');
    for (const line of text.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });

  test('requires a planId', () => {
    expect(() => buildIcs(steps, { now: NOW })).toThrow(TypeError);
  });

  test('skips a step with an invalid date instead of throwing', () => {
    const bad = { ...byId(steps, 'serve'), start: new Date('nope') };
    expect(() => buildIcs([bad, byId(steps, 'fire')], { planId: id, now: NOW })).not.toThrow();
    expect(parse(buildIcs([bad, byId(steps, 'fire')], { planId: id, now: NOW })).children.filter((c) => c.name === 'VEVENT')).toHaveLength(1);
  });
});

/* ---------- Google Calendar link and display ---------- */

describe('googleCalendarUrl', () => {
  const steps = stepsFor(pork());
  const fmt = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

  test('round-trips through URL parsing with the right title, dates and details', () => {
    for (const step of steps) {
      const url = new URL(googleCalendarUrl(step));
      expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
      expect(url.searchParams.get('action')).toBe('TEMPLATE');
      expect(url.searchParams.get('text')).toBe(step.title);
      expect(url.searchParams.get('dates')).toBe(`${fmt(step.start)}/${fmt(step.end)}`);
      expect(url.searchParams.get('details')).toBe(`${step.note} Planned with Empirical BBQ (empiricalbbq.com/cook-scheduler)`);
    }
  });

  test('the dates are UTC basic format with Z', () => {
    const url = new URL(googleCalendarUrl(byId(steps, 'serve')));
    expect(url.searchParams.get('dates')).toBe('20261123T010000Z/20261123T011500Z'); // 6:00 PM MST = 01:00Z the next day
  });

  test('everything is URL-encoded, including characters that would break a query string', () => {
    const step = { id: 'x', title: 'A & B # C? 50%', note: 'a=b&c=d', start: new Date('2026-11-22T20:00:00Z'), end: new Date('2026-11-22T20:15:00Z') };
    const raw = googleCalendarUrl(step);
    expect(raw).not.toMatch(/[ #]/);
    const url = new URL(raw);
    expect(url.searchParams.get('text')).toBe('A & B # C? 50%');
    expect(url.searchParams.get('details')).toContain('a=b&c=d');
    expect([...url.searchParams.keys()].sort()).toEqual(['action', 'dates', 'details', 'text']);
  });
});

describe('formatStepTime', () => {
  const steps = stepsFor(pork());
  test('shows the cook-local time, with a leading ~ on estimate steps only', () => {
    expect(formatStepTime(byId(steps, 'serve'), ZONE, 'en-US')).toBe('Sun, Nov 22, 6:00 PM');
    const pull = byId(steps, 'pull');
    expect(formatStepTime(pull, ZONE, 'en-US')).toBe('~Sun, Nov 22, 5:00 PM');
    expect(formatStepTime({ ...pull, estimate: false }, ZONE, 'en-US').startsWith('~')).toBe(false);
  });
  test('uses the zone it is given, not the device zone', () => {
    const serve = byId(steps, 'serve');
    expect(formatStepTime(serve, 'America/Los_Angeles', 'en-US')).toBe('Sun, Nov 22, 5:00 PM');
    expect(formatStepTime(serve, 'Asia/Kolkata', 'en-US')).toBe('Mon, Nov 23, 6:30 AM');
  });
});

/* ---------- purity ---------- */

describe('ics.js is pure and adds no model math', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'ics.js'), 'utf8');
  test('imports only cookMilestones.js (for PREHEAT_HOURS): no engine, registry, DOM or network', () => {
    const imports = [...src.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]);
    expect(imports).toEqual(['./cookMilestones.js']);
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // comments may say "window" (the finish window)
    expect(code).not.toMatch(/\b(document|window|fetch|localStorage|XMLHttpRequest|navigator)\b/);
    expect((src.match(/Date\.now\(\)/g) || []).length).toBe(1); // the clock appears only as buildIcs's default `now`
  });
  test('has no em dash', () => {
    expect(src).not.toMatch(/\u2014/);
  });
});
