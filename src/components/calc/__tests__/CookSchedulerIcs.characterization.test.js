// @vitest-environment happy-dom
/*
 * Characterization test for the scheduler's calendar download (#icsBtn).
 *
 * It drives the real scheduler, clicks the existing "Add to calendar (.ics)" button, captures the file
 * it hands to the browser, and pins it for two fixture plans (pork shoulder, and ribs for the sauce step).
 * The expectations were first captured from the inline buildIcs in cookScheduler.controller.js BEFORE it
 * moved into src/utils/ics.js. They were then updated, deliberately and in the same commit, for exactly
 * these changes (the before and after are in the PR):
 *   - PRODID "Cook Scheduler" -> "Cook Planner", and an X-WR-CALNAME line;
 *   - UIDs: time-based "empiricalbbq-<ms>-<n>@" -> stable "<planId>-<step id>@" (the planId is tested on its own);
 *   - RFC 5545: lines folded at 75 octets, and a trailing CRLF (the old file had five lines over 75 octets);
 *   - a point event lasts 15 minutes (was 5), and every event gets SEQUENCE:0;
 *   - the alarm text is the full step title (it was the title without its emoji);
 *   - step wording now comes from buildCookSteps (for example "Pull & rest" is now the "Pull the meat" step).
 *   - then, on the author's review of the PR: the "Meat on" note carries the engine cook time again ("Estimated 14h 09m
 *     to a 202°F finish"), and the stall-method wrap note says to start checking the internal temp well before it.
 * Same event set as before for this button (fire, meat on, wrap, sauce, pull, serve). Do not regenerate
 * this to make a refactor pass: a difference outside the list above means the file changed unintentionally.
 *
 * Time zone: the clock is frozen and every UTC timestamp and the legacy time-based UID are normalized to
 * a count of minutes (or ms) from the serve time, so the pin does not depend on the machine's zone.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import CookScheduler from '../CookScheduler.astro';
import { mountComponent } from './mount.js';
import { PROTEINS } from '../../../utils/proteinRegistry.js';
import { initCookScheduler } from '../cookScheduler.controller.js';

const SERVE = '2026-07-18T18:00';
const BASE = { pitTemp: '225', pit: 'ceramic_kamado', wrap: 'peach_butcher_paper', wrapTemp: 160, climate: 'moderate', rest: 1 };

const CASES = [
  { name: 'pork shoulder 8.5 lb', protein: 'pork_shoulder', state: { ...BASE, weight: 8.5 } },
  { name: 'ribs spare 3-2-1', protein: 'pork_ribs', state: { ...BASE, cut: 'spare', racks: 3, rest: 0.5 } },
];

// First captured from the controller's inline buildIcs, before it moved into src/utils/ics.js; then
// updated, on purpose and in the same commit, for the Prompt 4 spec (see the header). The trailing
// empty element is the final CRLF.
const EXPECTED = {
  "pork shoulder 8.5 lb": [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Empirical BBQ//Cook Planner//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Empirical BBQ cook",
    "BEGIN:VEVENT",
    "UID:<planId>-fire@empiricalbbq.com",
    "DTSTAMP:<serve-68040m>",
    "DTSTART:<serve-954.2m>",
    "DTEND:<serve-939.2m>",
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
    "UID:<planId>-on@empiricalbbq.com",
    "DTSTAMP:<serve-68040m>",
    "DTSTART:<serve-909.2m>",
    "DTEND:<serve-894.2m>",
    "SUMMARY:🥩 Meat on",
    "DESCRIPTION:Cold meat on the grate. Estimated 14h 09m to a 202°F finish. P",
    " lanned with Empirical BBQ (empiricalbbq.com/cook-scheduler)",
    "SEQUENCE:0",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:🥩 Meat on",
    "TRIGGER:-PT10M",
    "END:VALARM",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:<planId>-wrap@empiricalbbq.com",
    "DTSTAMP:<serve-68040m>",
    "DTSTART:<serve-242.2m>",
    "DTEND:<serve-227.2m>",
    "SUMMARY:📦 Wrap at 160°F",
    "DESCRIPTION:Start checking the internal temp well before this. Starts at an",
    "  internal temperature\\, so this time is an estimate. Planned with Empirica",
    " l BBQ (empiricalbbq.com/cook-scheduler)",
    "SEQUENCE:0",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:📦 Wrap at 160°F",
    "TRIGGER:-PT10M",
    "END:VALARM",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:<planId>-pull@empiricalbbq.com",
    "DTSTAMP:<serve-68040m>",
    "DTSTART:<serve-60m>",
    "DTEND:<serve-45m>",
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
    "UID:<planId>-serve@empiricalbbq.com",
    "DTSTAMP:<serve-68040m>",
    "DTSTART:<serve+0m>",
    "DTEND:<serve+15m>",
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
  ].join('\r\n'),
  "ribs spare 3-2-1": [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Empirical BBQ//Cook Planner//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Empirical BBQ cook",
    "BEGIN:VEVENT",
    "UID:<planId>-fire@empiricalbbq.com",
    "DTSTAMP:<serve-68040m>",
    "DTSTART:<serve-435m>",
    "DTEND:<serve-420m>",
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
    "UID:<planId>-on@empiricalbbq.com",
    "DTSTAMP:<serve-68040m>",
    "DTSTART:<serve-390m>",
    "DTEND:<serve-375m>",
    "SUMMARY:🥩 Meat on",
    "DESCRIPTION:Cold meat on the grate. Estimated 6h 00m to a 203°F finish. Pl",
    " anned with Empirical BBQ (empiricalbbq.com/cook-scheduler)",
    "SEQUENCE:0",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:🥩 Meat on",
    "TRIGGER:-PT10M",
    "END:VALARM",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:<planId>-wrap@empiricalbbq.com",
    "DTSTAMP:<serve-68040m>",
    "DTSTART:<serve-210m>",
    "DTEND:<serve-195m>",
    "SUMMARY:📦 Wrap in foil",
    "DESCRIPTION:Wrap now\\, as the fixed-time method calls for. Planned with Emp",
    " irical BBQ (empiricalbbq.com/cook-scheduler)",
    "SEQUENCE:0",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:📦 Wrap in foil",
    "TRIGGER:-PT10M",
    "END:VALARM",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:<planId>-sauce@empiricalbbq.com",
    "DTSTAMP:<serve-68040m>",
    "DTSTART:<serve-90m>",
    "DTEND:<serve-75m>",
    "SUMMARY:🍯 Unwrap and sauce",
    "DESCRIPTION:Unwrap and sauce\\, as the fixed-time method calls for. Planned ",
    " with Empirical BBQ (empiricalbbq.com/cook-scheduler)",
    "SEQUENCE:0",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:🍯 Unwrap and sauce",
    "TRIGGER:-PT10M",
    "END:VALARM",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:<planId>-pull@empiricalbbq.com",
    "DTSTAMP:<serve-68040m>",
    "DTSTART:<serve-30m>",
    "DTEND:<serve-15m>",
    "SUMMARY:🌡️ Pull the meat",
    "DESCRIPTION:Pull when it probes tender near 203°F. This time is an estimat",
    " e. Planned with Empirical BBQ (empiricalbbq.com/cook-scheduler)",
    "SEQUENCE:0",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:🌡️ Pull the meat",
    "TRIGGER:-PT10M",
    "END:VALARM",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:<planId>-serve@empiricalbbq.com",
    "DTSTAMP:<serve-68040m>",
    "DTSTART:<serve+0m>",
    "DTEND:<serve+15m>",
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
  ].join('\r\n'),
};

const utcMs = (s) => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(9, 11), +s.slice(11, 13), +s.slice(13, 15));
const rel = (ms, serveMs) => {
  const m = (ms - serveMs) / 60000;
  return `serve${m >= 0 ? '+' : '-'}${Math.abs(m)}m`;
};

function normalize(text, serveMs) {
  return text
    .replace(/(DTSTAMP|DTSTART|DTEND):(\d{8}T\d{6}Z)/g, (_, k, v) => `${k}:<${rel(utcMs(v), serveMs)}>`)
    .replace(/UID:empiricalbbq-(\d+)-(\d+)@/g, (_, ms, i) => `UID:empiricalbbq-<${rel(+ms, serveMs)}>-${i}@`)
    .replace(/UID:[0-9a-f]{8}-([a-z]+)@/g, 'UID:<planId>-$1@'); // stable UIDs after the move: planId is tested on its own
}

async function download(protein, state) {
  document.body.innerHTML = '';
  await mountComponent(CookScheduler);
  const { state: s, render } = initCookScheduler(PROTEINS[protein]);
  Object.assign(s, state, { serveAt: SERVE });
  render();

  let blob = null;
  const create = vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => ((blob = b), 'blob:test'));
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  document.getElementById('icsBtn').click();
  create.mockRestore();
  click.mockRestore();
  expect(blob, 'the button handed a file to the browser').toBeTruthy();
  return { text: await blob.text(), type: blob.type };
}

describe('scheduler .ics download (characterization)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 5, 1, 12, 0, 0));
  });
  afterEach(() => vi.useRealTimers());

  for (const c of CASES) {
    it(c.name, async () => {
      const { text, type } = await download(c.protein, c.state);
      expect(type).toBe('text/calendar;charset=utf-8');
      const got = normalize(text, new Date(SERVE).getTime());
      if (!EXPECTED[c.name]) throw new Error(`No expected value yet for "${c.name}". Observed:\n${JSON.stringify(got)}`);
      expect(got).toBe(EXPECTED[c.name]);
    });
  }

  it('covers every case with an expectation', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(CASES.map((c) => c.name).sort());
  });
});
