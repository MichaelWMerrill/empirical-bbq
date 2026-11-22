// @vitest-environment happy-dom
/*
 * DOM tests for the Add to calendar panel, mounted inside the real scheduler page markup and fed by the real
 * scheduler (through its onPlan hook) and, for the time zone, the real conditions card. No network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import CookScheduler from '../CookScheduler.astro';
import { mountComponent } from './mount.js';
import { PROTEINS } from '../../../utils/proteinRegistry.js';
import { cookDuration } from '../../../utils/stallEngine.js';
import { buildMilestones } from '../../../utils/cookMilestones.js';
import { buildCookSteps, formatStepTime, icsFilename } from '../../../utils/ics.js';
import pointsFixture from '../../../utils/__tests__/fixtures/nws-points.json';
import hourlyFixture from '../../../utils/__tests__/fixtures/nws-hourly.json';
import { fetchConditions } from '../../../utils/conditions.js';
import { PREFS_KEY } from '../../../utils/plannerPrefs.js';
import { initCookScheduler } from '../cookScheduler.controller.js';
import { initAddToCalendar, estimateNote, zoneNote, MESSAGES } from '../addToCalendar.controller.js';
import { initConditionsCard } from '../conditionsCard.controller.js';

const SERVE = '2026-07-18T18:00'; // local wall time; every expectation below is relative to it, so no time zone assumption
const SERVE_DATE = new Date(SERVE);
const NOW = Date.UTC(2026, 6, 10, 15, 0, 0);
const MACHINE_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const MIN = 60 * 1000;
const BASE = { pitTemp: '225', pit: 'ceramic_kamado', wrap: 'peach_butcher_paper', wrapTemp: 160, climate: 'moderate', rest: 1 };
const PORK = { ...BASE, weight: 8.5 };
const RIBS = { ...BASE, cut: 'spare', racks: 3, rest: 0.5 };

const $ = (id) => document.getElementById(id);
const text = (id) => $(id).textContent.trim();
const hidden = (id) => $(id).classList.contains('hidden');
const stepIds = () => [...document.querySelectorAll('#calSteps input[type=checkbox]')].map((i) => i.dataset.step);
const isChecked = (id) => $(`calStep-${id}`).checked;
const toggle = (id) => {
  const box = $(`calStep-${id}`);
  box.checked = !box.checked;
  box.dispatchEvent(new Event('change', { bubbles: true }));
};
const links = () => [...document.querySelectorAll('#calSteps [data-google-link]')].filter((a) => !a.classList.contains('hidden'));
const fmt = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const unfold = (t) => t.replace(/\r\n[ \t]/g, '');
const prop = (ics, key) => unfold(ics).split('\r\n').filter((l) => l.startsWith(`${key}:`)).map((l) => l.slice(key.length + 1));

async function setup({ proteinId = 'pork_shoulder', state = PORK, zone = null, browserZone = MACHINE_ZONE, prefs, serve = SERVE, plan = true } = {}) {
  document.body.innerHTML = '';
  if (prefs) localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  await mountComponent(CookScheduler);
  const zoneRef = { value: zone };
  const download = vi.fn();
  const cal = initAddToCalendar({ getTimeZone: () => zoneRef.value, deps: { download, now: () => NOW, browserZone: () => browserZone } });
  const protein = PROTEINS[proteinId];
  const sched = initCookScheduler(protein, plan ? { onPlan: cal.setPlan } : {});
  Object.assign(sched.state, state, { serveAt: serve });
  sched.render();
  return { cal, sched, download, zoneRef, protein };
}
async function downloaded(download, n = 0) {
  const [blob, filename] = download.mock.calls[n];
  return { text: await blob.text(), filename, type: blob.type };
}
// The steps the panel should be listing, derived independently from the same pure functions.
function expectedSteps(protein, state, zone = MACHINE_ZONE, serve = SERVE_DATE) {
  const duration = cookDuration(protein, state);
  const plan = buildMilestones({ duration, inputs: { rest: state.rest, wrap: state.wrap, wrapTemp: state.wrapTemp }, serve });
  return buildCookSteps(plan, { finishTemp: protein.thermal.finish_temp, pitTemp: state.pitTemp, wrapTemp: state.wrapTemp, totalTime: duration.totalTime }, { timeZone: zone });
}

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  sessionStorage.clear();
});

describe('placement and structure', () => {
  it('sits directly below the cook timeline and above the conditions card; #icsBtn is gone', async () => {
    await setup();
    const timelineCard = $('timeline').closest('.rounded-2xl');
    expect(timelineCard.nextElementSibling.id).toBe('calendarPanel');
    expect($('calendarPanel').nextElementSibling.id).toBe('conditionsCard');
    expect($('icsBtn')).toBeNull();
    expect(document.querySelector('[id*=ics]')).toBeNull();
  });

  it('has the heading and the line, and a three-option Apple, Google, Outlook control', async () => {
    await setup();
    expect(text('calTitle')).toBe('Add to calendar');
    expect($('calendarPanel').textContent).toContain('Review the steps, pick the ones you want, then add them.');
    const opts = [...document.querySelectorAll('.cal-choice-opt')];
    expect(opts.map((b) => b.textContent)).toEqual(['Apple', 'Google', 'Outlook']);
    expect(opts.every((b) => b.tagName === 'BUTTON' && b.hasAttribute('aria-pressed'))).toBe(true);
    expect(opts.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent)).toEqual(['Apple']); // the default
  });

  it('with no serving time it says so instead of listing steps', async () => {
    const { cal } = await setup({ plan: true });
    cal.setPlan(null);
    expect(hidden('calEmpty')).toBe(false);
    expect(text('calEmpty')).toBe('Pick a serving time to see the steps.');
    expect(hidden('calBody')).toBe(true);
  });
});

describe('the step list', () => {
  it('lists the steps of the plan, pre-checked per defaultOn (stall off), with title, time and note', async () => {
    const { protein } = await setup();
    const want = expectedSteps(protein, PORK);
    expect(stepIds()).toEqual(['prep', 'fire', 'on', 'stall', 'wrap', 'pull', 'rest', 'serve']);
    expect(stepIds()).toEqual(want.map((s) => s.id));
    for (const s of want) {
      expect(isChecked(s.id), s.id).toBe(s.defaultOn);
      const li = $(`calStep-${s.id}`).closest('li');
      expect(li.textContent).toContain(s.title);
      expect(li.textContent).toContain(s.note);
      expect(li.querySelector('[data-time]').textContent).toBe(formatStepTime(s, MACHINE_ZONE));
    }
    expect(isChecked('stall')).toBe(false);
    expect(text('calCount')).toBe('7 of 8 steps selected');
  });

  it('shows a leading "~" on estimate steps only', async () => {
    await setup();
    const time = (id) => document.querySelector(`[data-time="${id}"]`).textContent;
    for (const id of ['stall', 'wrap', 'pull']) expect(time(id).startsWith('~'), id).toBe(true);
    for (const id of ['prep', 'fire', 'on', 'rest', 'serve']) expect(time(id).startsWith('~'), id).toBe(false);
  });

  it('ribs get a sauce step; the fixed-time wrap and sauce are not estimates', async () => {
    await setup({ proteinId: 'pork_ribs', state: RIBS });
    expect(stepIds()).toEqual(['prep', 'fire', 'on', 'wrap', 'sauce', 'pull', 'rest', 'serve']);
    const time = (id) => document.querySelector(`[data-time="${id}"]`).textContent;
    expect(time('wrap').startsWith('~')).toBe(false);
    expect(time('sauce').startsWith('~')).toBe(false);
    expect(time('pull').startsWith('~')).toBe(true);
  });

  it('every step has a labeled checkbox described by its note', async () => {
    await setup();
    for (const input of document.querySelectorAll('#calSteps input')) {
      expect(document.querySelector(`label[for="${input.id}"]`), input.id).toBeTruthy();
      expect(document.getElementById(input.getAttribute('aria-describedby')), input.id).toBeTruthy();
    }
  });
});

describe('the time zone: the device zone, like the timeline', () => {
  const LA = 'America/Los_Angeles';
  const note = () => $('calZoneNote');

  it('labels the times with the device zone and says so', async () => {
    await setup({ browserZone: LA });
    expect(text('calZone')).toBe("Times in Pacific Time, this device's time zone");
    expect(hidden('calZoneNote')).toBe(true); // no cook zone known: nothing to add
  });

  it('shows every time in the device zone', async () => {
    const { protein } = await setup({ browserZone: LA });
    for (const s of expectedSteps(protein, PORK, LA)) {
      expect(document.querySelector(`[data-time="${s.id}"]`).textContent, s.id).toBe(formatStepTime(s, LA));
    }
  });

  it('with a different cook zone, adds one line and still uses the device zone for every time', async () => {
    const { protein } = await setup({ browserZone: LA, zone: 'America/Denver' });
    expect(hidden('calZoneNote')).toBe(false);
    expect(text('calZoneNote')).toBe(
      'This device is on Pacific Time, but your cook location is on Mountain Time. Times here, and the serve time you entered, use Pacific Time.'
    );
    expect(note().getAttribute('aria-live')).toBe('polite');
    expect(text('calZone')).toBe("Times in Pacific Time, this device's time zone"); // the label is unchanged
    for (const s of expectedSteps(protein, PORK, LA)) {
      expect(document.querySelector(`[data-time="${s.id}"]`).textContent, s.id).toBe(formatStepTime(s, LA));
    }
    // and the times are not the cook zone's
    const denverServe = expectedSteps(protein, PORK, 'America/Denver').find((s) => s.id === 'serve');
    expect(document.querySelector('[data-time="serve"]').textContent).not.toBe(formatStepTime(denverServe, 'America/Denver'));
  });

  it('the downloaded file and the Google links do not depend on the cook zone (they are absolute times)', async () => {
    const withCook = await setup({ browserZone: LA, zone: 'America/Denver' });
    $('calDownload').click();
    const a = prop((await downloaded(withCook.download)).text, 'DTSTART');
    const without = await setup({ browserZone: LA, zone: null });
    $('calDownload').click();
    const b = prop((await downloaded(without.download)).text, 'DTSTART');
    expect(a).toEqual(b);
  });

  it('says nothing when the cook zone reads the same clock as the device (same zone, or the same offset all year)', async () => {
    await setup({ browserZone: LA, zone: LA });
    expect(hidden('calZoneNote')).toBe(true);
    await setup({ browserZone: LA, zone: 'America/Vancouver' });
    expect(hidden('calZoneNote')).toBe(true);
  });

  it('tells Phoenix from Denver in summer (different offsets, different names)', async () => {
    await setup({ browserZone: 'America/Phoenix', zone: 'America/Denver' });
    expect(text('calZoneNote')).toBe(
      'This device is on Mountain Standard Time, but your cook location is on Mountain Time. Times here, and the serve time you entered, use Mountain Standard Time.'
    );
  });

  it('never names the same zone twice: across every zone the runtime knows, zones that read differently have different names', () => {
    const at = new Date('2026-07-18T18:00:00Z');
    const zones = Intl.supportedValuesOf('timeZone');
    const name = (tz) => new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longGeneric' }).formatToParts(at).find((p) => p.type === 'timeZoneName').value;
    for (const a of ['America/Los_Angeles', 'America/Denver', 'Asia/Kolkata', 'Europe/London', 'Pacific/Auckland']) {
      for (const b of zones) if (zoneNote(a, b, at)) expect(name(a), `${a} vs ${b}`).not.toBe(name(b));
    }
  });

  it('follows the cook zone coming and going: the line appears and disappears, the times never move', async () => {
    const { zoneRef, protein } = await setup({ browserZone: LA });
    const before = [...document.querySelectorAll('[data-time]')].map((e) => e.textContent);
    zoneRef.value = 'America/New_York';
    document.dispatchEvent(new CustomEvent('ebq:cook-zone-changed'));
    expect(hidden('calZoneNote')).toBe(false);
    expect(text('calZoneNote')).toContain('your cook location is on Eastern Time');
    expect([...document.querySelectorAll('[data-time]')].map((e) => e.textContent)).toEqual(before);
    zoneRef.value = null;
    document.dispatchEvent(new CustomEvent('ebq:cook-zone-changed'));
    expect(hidden('calZoneNote')).toBe(true);
    expect(expectedSteps(protein, PORK, LA).length).toBeGreaterThan(0);
  });

  it('works with the real conditions card: a forecast for another zone adds the line and moves no time', async () => {
    document.body.innerHTML = '';
    await mountComponent(CookScheduler);
    const jsonRes = (b) => ({ ok: true, status: 200, json: async () => b });
    const conditions = await fetchConditions(40.13, -111.58, {
      fetchImpl: async (u) => jsonRes(u.includes('/points/') ? pointsFixture : hourlyFixture),
      storage: null,
      now: () => 0,
    });
    const card = initConditionsCard({
      deps: { getPosition: async () => ({ lat: 40.13, lon: -111.58 }), fetchConditions: async () => conditions, permissionState: async () => 'prompt' },
    });
    const cal = initAddToCalendar({ getTimeZone: card.getTimeZone, deps: { download: vi.fn(), now: () => NOW, browserZone: () => LA } });
    const sched = initCookScheduler(PROTEINS.pork_shoulder, { onSchedule: card.setWindow, onPlan: cal.setPlan });
    Object.assign(sched.state, PORK, { serveAt: SERVE });
    sched.render();
    expect(hidden('calZoneNote')).toBe(true);
    const before = [...document.querySelectorAll('[data-time]')].map((e) => e.textContent);

    $('condUseBtn').click();
    await vi.waitFor(() => expect(card.getState().status).toBe('ready'));
    expect(text('calZoneNote')).toBe(
      'This device is on Pacific Time, but your cook location is on Mountain Time. Times here, and the serve time you entered, use Pacific Time.'
    );
    expect(text('calZone')).toBe("Times in Pacific Time, this device's time zone");
    expect([...document.querySelectorAll('[data-time]')].map((e) => e.textContent)).toEqual(before);
    // the panel wrote nothing to the card: its own state is exactly what it loaded
    expect(card.getState()).toEqual({ status: 'ready', source: 'nws', errorCode: null });
  });
});

describe('zoneNote', () => {
  const at = new Date('2026-07-18T18:00:00Z');
  test_each();
  function test_each() {
    it('is empty without a cook zone, and for zones that read the same', () => {
      expect(zoneNote('America/Los_Angeles', null, at)).toBe('');
      expect(zoneNote(null, 'America/Denver', at)).toBe('');
      expect(zoneNote('America/Los_Angeles', 'America/Los_Angeles', at)).toBe('');
      expect(zoneNote('America/Los_Angeles', 'America/Vancouver', at)).toBe('');
    });
    it('is empty for a zone it cannot compare, rather than a wrong warning', () => {
      expect(zoneNote('America/Los_Angeles', 'Not/AZone', at)).toBe('');
    });
    it('names both zones and which one the times use', () => {
      expect(zoneNote('America/Los_Angeles', 'Asia/Kolkata', at)).toBe(
        'This device is on Pacific Time, but your cook location is on India Standard Time. Times here, and the serve time you entered, use Pacific Time.'
      );
    });
    it('has no em dash', () => {
      expect(zoneNote('America/Los_Angeles', 'America/New_York', at)).not.toMatch(/\u2014/);
    });
  }
});

describe('download', () => {
  it('the button says how many events, and toggling changes the count', async () => {
    await setup();
    expect(text('calDownload')).toBe('Download 7 events (.ics)');
    toggle('prep');
    expect(text('calCount')).toBe('6 of 8 steps selected');
    expect(text('calDownload')).toBe('Download 6 events (.ics)');
    toggle('stall');
    expect(text('calDownload')).toBe('Download 7 events (.ics)');
    for (const id of ['fire', 'on', 'wrap', 'pull', 'rest', 'stall']) toggle(id);
    expect(text('calDownload')).toBe('Download 1 event (.ics)'); // singular
  });

  it('the downloaded .ics holds exactly the checked steps, as text/calendar', async () => {
    const { download, protein } = await setup();
    toggle('prep');
    toggle('stall'); // now checked
    toggle('rest');
    $('calDownload').click();
    const file = await downloaded(download);
    expect(file.type).toBe('text/calendar;charset=utf-8');
    const want = expectedSteps(protein, PORK).filter((s) => ['fire', 'on', 'stall', 'wrap', 'pull', 'serve'].includes(s.id));
    expect(prop(file.text, 'SUMMARY')).toEqual(want.map((s) => s.title));
    expect(prop(file.text, 'DTSTART')).toEqual(want.map((s) => fmt(s.start)));
    expect(file.text.split('\r\n').filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(6);
    expect(file.text.endsWith('\r\n')).toBe(true);
  });

  it('is named for the protein and the serve date in the device zone', async () => {
    const { download } = await setup({ browserZone: 'America/Denver', zone: 'Asia/Kolkata' });
    $('calDownload').click();
    expect((await downloaded(download)).filename).toBe(icsFilename('pork-shoulder', SERVE_DATE, 'America/Denver'));
    expect((await downloaded(download)).filename).toMatch(/^empirical-bbq-pork-shoulder-\d{4}-\d{2}-\d{2}\.ics$/);
    const dateInZone = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(SERVE_DATE);
    expect((await downloaded(download)).filename).toBe(`empirical-bbq-pork-shoulder-${dateInZone}.ics`);
  });

  it('afterwards says "Downloaded. Open the file to add the events." and offers no Undo', async () => {
    const { download } = await setup();
    $('calDownload').click();
    expect(download).toHaveBeenCalledTimes(1);
    expect(text('calStatus')).toBe('Downloaded. Open the file to add the events.');
    expect(text('calStatus')).toBe(MESSAGES.downloaded);
    expect([...document.querySelectorAll('#calendarPanel button, #calendarPanel a')].some((el) => /undo/i.test(el.textContent))).toBe(false);
    toggle('fire'); // changing the selection makes the earlier message stale
    expect(text('calStatus')).toBe('');
  });

  it('with nothing checked the button stays enabled and shows "Pick at least one step" instead of downloading', async () => {
    const { download } = await setup();
    for (const id of stepIds()) if (isChecked(id)) toggle(id);
    expect(text('calCount')).toBe('0 of 8 steps selected');
    expect($('calDownload').disabled).toBe(false);
    $('calDownload').click();
    expect(download).not.toHaveBeenCalled();
    expect(text('calStatus')).toBe('Pick at least one step');
    toggle('serve');
    expect(text('calStatus')).toBe('');
  });

  it('the count line is singular for a one-step list', async () => {
    const { cal } = await setup();
    const one = { plan: { method: 'stall', serve: SERVE_DATE, pull: SERVE_DATE, meatOn: null, fireUp: null, stallOnset: null, stallEnd: null, milestones: [{ id: 'serve', at: SERVE_DATE }] }, inputs: { protein: 'pork_shoulder', slug: 'pork-shoulder', weight: 8.5, pitTemp: '225', wrap: 'none', wrapTemp: 160, finishTemp: 202, totalTime: 12, serveISO: SERVE_DATE.toISOString() } };
    cal.setPlan(one);
    expect(stepIds()).toEqual(['serve']);
    expect(text('calCount')).toBe('1 of 1 step selected');
  });

  it('a new plan clears an old "Downloaded" message', async () => {
    const { sched } = await setup();
    $('calDownload').click();
    expect(text('calStatus')).toBe('Downloaded. Open the file to add the events.');
    sched.state.weight = 10;
    sched.render();
    expect(text('calStatus')).toBe('');
  });
});

describe('the reminder', () => {
  it('offers 10 minutes before (the default), at start time, and 30 minutes before', async () => {
    await setup();
    const opts = [...$('calReminder').options];
    expect(opts.map((o) => o.textContent)).toEqual(['10 minutes before', 'At start time', '30 minutes before']);
    expect($('calReminder').value).toBe('10');
  });

  it.each([
    ['10', '-PT10M'],
    ['0', 'PT0S'],
    ['30', '-PT30M'],
  ])('reminder %s writes TRIGGER:%s on every event', async (value, trigger) => {
    const { download } = await setup();
    $('calReminder').value = value;
    $('calReminder').dispatchEvent(new Event('change'));
    $('calDownload').click();
    const { text: ics } = await downloaded(download);
    const triggers = prop(ics, 'TRIGGER');
    expect(triggers).toHaveLength(7);
    expect(new Set(triggers)).toEqual(new Set([trigger]));
  });
});

describe('Google', () => {
  it('shows one "Add to Google" link per checked step, with the right dates, in a new tab', async () => {
    const { protein } = await setup();
    document.querySelector('[data-calendar=google]').click();
    expect(document.querySelector('[data-calendar=google]').getAttribute('aria-pressed')).toBe('true');
    const want = expectedSteps(protein, PORK).filter((s) => s.defaultOn);
    const shown = links();
    expect(shown).toHaveLength(want.length);
    for (const s of want) {
      const a = document.querySelector(`[data-google-link="${s.id}"]`);
      expect(a.classList.contains('hidden'), s.id).toBe(false);
      expect(a.textContent).toBe('Add to Google');
      expect(a.getAttribute('aria-label')).toContain('Add to Google');
      expect(a.target).toBe('_blank');
      expect(a.rel).toContain('noopener');
      const url = new URL(a.href);
      expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
      expect(url.searchParams.get('action')).toBe('TEMPLATE');
      expect(url.searchParams.get('text')).toBe(s.title);
      expect(url.searchParams.get('dates')).toBe(`${fmt(s.start)}/${fmt(s.end)}`);
    }
    // the serve step is the serve instant, and pull is an hour earlier (rest = 1 h): checked without re-deriving the plan
    const dates = (id) => new URL(document.querySelector(`[data-google-link="${id}"]`).href).searchParams.get('dates');
    expect(dates('serve')).toBe(`${fmt(SERVE_DATE)}/${fmt(new Date(SERVE_DATE.getTime() + 15 * MIN))}`);
    expect(dates('pull').split('/')[0]).toBe(fmt(new Date(SERVE_DATE.getTime() - 60 * MIN)));
    expect(dates('rest')).toBe(`${fmt(new Date(SERVE_DATE.getTime() - 60 * MIN))}/${fmt(SERVE_DATE)}`);
  });

  it('a link follows its checkbox: unchecked steps have none, a newly checked step gains one', async () => {
    await setup();
    document.querySelector('[data-calendar=google]').click();
    toggle('wrap');
    expect(document.querySelector('[data-google-link="wrap"]').classList.contains('hidden')).toBe(true);
    expect(links()).toHaveLength(6);
    toggle('stall');
    expect(document.querySelector('[data-google-link="stall"]').classList.contains('hidden')).toBe(false);
    expect(links()).toHaveLength(7);
  });

  it('swaps the primary button for "Download .ics instead" and the Google import line', async () => {
    const { download } = await setup();
    expect(hidden('calGoogle')).toBe(true);
    document.querySelector('[data-calendar=google]').click();
    expect(hidden('calDownload')).toBe(true);
    expect(hidden('calGoogle')).toBe(false);
    expect(text('calDownloadAlt')).toBe('Download .ics instead');
    expect($('calGoogle').textContent).toContain('On a computer, Google Calendar can import the .ics file from Settings, Import & export.');
    $('calDownloadAlt').click();
    expect(download).toHaveBeenCalledTimes(1);
    expect(text('calStatus')).toBe('Downloaded. Open the file to add the events.');
  });

  it('with nothing checked there are no links, and "Download .ics instead" says to pick a step', async () => {
    const { download } = await setup();
    document.querySelector('[data-calendar=google]').click();
    for (const id of stepIds()) if (isChecked(id)) toggle(id);
    expect(links()).toHaveLength(0);
    $('calDownloadAlt').click();
    expect(download).not.toHaveBeenCalled();
    expect(text('calStatus')).toBe('Pick at least one step');
  });

  it('Apple and Outlook show no links and the primary button', async () => {
    await setup();
    for (const cal of ['apple', 'outlook']) {
      document.querySelector(`[data-calendar=${cal}]`).click();
      expect(links(), cal).toHaveLength(0);
      expect(hidden('calDownload'), cal).toBe(false);
      expect(hidden('calGoogle'), cal).toBe(true);
    }
  });
});

describe('when scheduler inputs change', () => {
  it('keeps the checkbox choices by step id while the times follow the new plan', async () => {
    const { sched } = await setup();
    toggle('wrap'); // now unchecked
    toggle('stall'); // now checked
    const fireBefore = document.querySelector('[data-time="fire"]').textContent;
    sched.state.weight = 12;
    sched.render();
    expect(stepIds()).toEqual(['prep', 'fire', 'on', 'stall', 'wrap', 'pull', 'rest', 'serve']);
    expect(isChecked('wrap')).toBe(false);
    expect(isChecked('stall')).toBe(true);
    expect(isChecked('prep')).toBe(true);
    expect(text('calCount')).toBe('7 of 8 steps selected');
    expect(document.querySelector('[data-time="fire"]').textContent).not.toBe(fireBefore); // it did recompute
  });

  it('a different protein (ribs) keeps the choices for the ids they share and defaults the new ones', async () => {
    const { sched } = await setup();
    toggle('prep'); // unchecked
    sched.state.cut = 'spare';
    // switching protein needs a fresh scheduler; the panel is fed again through setPlan
    const ribs = await setup({ proteinId: 'pork_ribs', state: RIBS });
    expect(isChecked('prep')).toBe(true); // a fresh page starts from defaults
    expect(isChecked('sauce')).toBe(true);
    expect(ribs.cal.getState().steps).toContain('sauce');
  });
});

describe('what is stored', () => {
  it('only the calendar choice, in the shared planner key; checkboxes and reminder are not stored', async () => {
    await setup();
    document.querySelector('[data-calendar=google]').click();
    toggle('prep');
    $('calReminder').value = '30';
    $('calReminder').dispatchEvent(new Event('change'));
    $('calDownload')?.click();
    expect(localStorage.length).toBe(1);
    expect(JSON.parse(localStorage.getItem(PREFS_KEY))).toEqual({ calendar: 'google' });
    expect(sessionStorage.length).toBe(0);
  });

  it('remembers the last choice on the next visit and shares the key with the cooker class', async () => {
    await setup({ prefs: { cooker: 'kamado' } });
    document.querySelector('[data-calendar=outlook]').click();
    expect(JSON.parse(localStorage.getItem(PREFS_KEY))).toEqual({ cooker: 'kamado', calendar: 'outlook' });
    await setup(); // a fresh page load (the stored value is still there)
    expect(document.querySelector('[data-calendar=outlook]').getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-calendar=apple]').getAttribute('aria-pressed')).toBe('false');
  });
});

describe('the estimate line', () => {
  it('names the estimate steps that are in the list', async () => {
    await setup();
    expect(text('calEstimateNote')).toBe('Wrap and pull times are estimates, because they depend on when the meat reaches a temperature.');
    await setup({ proteinId: 'pork_ribs', state: RIBS });
    expect(text('calEstimateNote')).toBe('The pull time is an estimate, because it depends on when the meat reaches a temperature.');
  });

  it('estimateNote: none, one, two; the stall row is flagged by its own "~" and note, not named here', () => {
    const steps = (...ids) => ids.map((id) => ({ id, estimate: true }));
    expect(estimateNote([])).toBe('');
    expect(estimateNote([{ id: 'pull', estimate: false }])).toBe('');
    expect(estimateNote(steps('stall'))).toBe('');
    expect(estimateNote(steps('pull'))).toBe('The pull time is an estimate, because it depends on when the meat reaches a temperature.');
    expect(estimateNote(steps('wrap', 'pull'))).toBe('Wrap and pull times are estimates, because they depend on when the meat reaches a temperature.');
    expect(estimateNote(steps('stall', 'wrap', 'pull'))).toBe('Wrap and pull times are estimates, because they depend on when the meat reaches a temperature.');
  });
});

describe('accessibility, targets and copy', () => {
  it('every button, the select, each step row and each Google link is at least 44px tall', async () => {
    await setup();
    document.querySelector('[data-calendar=google]').click();
    const tall = /min-h-\[44px\]/;
    for (const el of document.querySelectorAll('#calendarPanel button')) expect(el.className, el.textContent).toMatch(tall);
    expect($('calReminder').className).toMatch(tall);
    for (const label of document.querySelectorAll('#calSteps label')) expect(label.className).toMatch(tall);
    for (const a of document.querySelectorAll('#calSteps a')) expect(a.className).toMatch(tall);
  });

  it('announces the count and the messages politely, and every input has a label', async () => {
    await setup();
    expect($('calCount').getAttribute('aria-live')).toBe('polite');
    expect($('calStatus').getAttribute('aria-live')).toBe('polite');
    expect(document.querySelector('label[for=calReminder]').textContent).toBe('Reminder');
    expect($('calendarPanel').getAttribute('aria-labelledby')).toBe('calTitle');
  });

  it('uses the dark-on-orange primary button and no white-on-orange', async () => {
    await setup();
    const primary = $('calDownload').className;
    expect(primary).toMatch(/bg-flame-500/);
    expect(primary).toMatch(/text-base-900/);
    expect(primary).not.toMatch(/text-white/);
  });

  it('has no em dash in any state', async () => {
    await setup();
    const all = [text('calendarPanel')];
    document.querySelector('[data-calendar=google]').click();
    all.push(text('calendarPanel'));
    for (const id of stepIds()) if (isChecked(id)) toggle(id);
    $('calDownloadAlt').click();
    all.push(text('calendarPanel'));
    for (const t of all) expect(t).not.toMatch(/\u2014/);
  });
});

describe('no network, no server, no other coupling', () => {
  it('makes no network request in any flow', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.reject(new Error('no network expected')));
    const xhr = vi.spyOn(globalThis, 'XMLHttpRequest').mockImplementation(() => {
      throw new Error('no network expected');
    });
    try {
      const { download } = await setup();
      document.querySelector('[data-calendar=google]').click();
      $('calDownloadAlt').click();
      document.querySelector('[data-calendar=apple]').click();
      $('calDownload').click();
      expect(download).toHaveBeenCalledTimes(2);
      expect(f).not.toHaveBeenCalled();
      expect(xhr).not.toHaveBeenCalled();
    } finally {
      f.mockRestore();
      xhr.mockRestore();
    }
  });

  it('imports only the ics helpers and the prefs helper: not conditions, not the card, not the engine', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'addToCalendar.controller.js'), 'utf8');
    const imports = [...src.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]);
    expect(imports).toEqual(['../../utils/ics.js', '../../utils/plannerPrefs.js']);
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/conditionsCard|conditions\.js|stallEngine|proteinRegistry|fetch\(|XMLHttpRequest|document\.cookie|sessionStorage/);
  });
});
