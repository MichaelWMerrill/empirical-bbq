/*
 * AddToCalendar controller. Display only: it never reads from or writes to the cook-time engine, and it
 * never writes to the conditions card.
 *
 * Inputs:
 *   - setPlan(snapshot): the scheduler's onPlan hook, a frozen copy of the plan and the inputs behind it
 *     ({ plan, inputs }), or null when there is no serving time yet.
 *   - getTimeZone(): a one-way getter for the cook's time zone (the conditions card's NWS zone when it has
 *     loaded, else null). When it changes the card dispatches "ebq:cook-zone-changed" and this panel reads
 *     the getter again. The browser's own zone is the fallback.
 *
 * Everything runs in the browser. There are no network calls and no server. The only thing stored is the
 * calendar choice (apple, google, outlook), in the shared planner key. The reminder, the checkboxes and the
 * status are not stored. Checkbox choices are kept by step id while the page is open, so changing a scheduler
 * input (which recomputes the steps) keeps what the reader picked.
 *
 * Deliberately no import of conditions.js or the conditions card: the isolation test keeps conditions out of
 * everything that is not the card.
 */
import { buildCookSteps, buildIcs, planId, googleCalendarUrl, formatStepTime, zoneName, icsFilename } from '../../utils/ics.js';
import { readPrefs, writePrefs } from '../../utils/plannerPrefs.js';

export const MESSAGES = {
  none: 'Pick at least one step',
  downloaded: 'Downloaded. Open the file to add the events.',
};

// Steps whose time is a guess because they start at an internal temperature, in timeline order.
const ESTIMATE_ORDER = ['stall', 'wrap', 'pull'];

/** The one line under the buttons, built from the estimate steps actually in the list. */
export function estimateNote(steps) {
  const names = ESTIMATE_ORDER.filter((id) => steps.some((s) => s.id === id && s.estimate));
  if (!names.length) return '';
  if (names.length === 1) return `The ${names[0]} time is an estimate because it starts at an internal temperature.`;
  const list = names.length === 2 ? `${names[0]} and ${names[1]}` : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return `${list[0].toUpperCase()}${list.slice(1)} times are estimates because they start at an internal temperature.`;
}

function defaultDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function defaultBrowserZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * @param {object} [opts]
 * @param {Document} [opts.root]
 * @param {() => string|null} [opts.getTimeZone]
 * @param {object} [opts.deps]  { storage, download(blob, filename), now, browserZone }
 * @returns {{ setPlan: (snapshot: object|null) => void, refresh: () => void, getState: () => object }}
 */
export function initAddToCalendar({ root = document, getTimeZone = () => null, deps = {} } = {}) {
  const d = { storage: undefined, download: defaultDownload, now: Date.now, browserZone: defaultBrowserZone, ...deps };
  const $ = (id) => root.getElementById(id);
  if (!$('calendarPanel')) return { setPlan() {}, refresh() {}, getState: () => ({}) };

  const state = {
    snapshot: null,
    steps: [],
    checked: new Map(), // step id -> boolean, kept for the life of the page
    calendar: readPrefs(d.storage).calendar,
    reminder: 10,
    status: '',
  };

  const show = (el, on) => el && el.classList.toggle('hidden', !on);
  const zone = () => getTimeZone() || d.browserZone();
  const isGoogle = () => state.calendar === 'google';
  const selected = () => state.steps.filter((s) => state.checked.get(s.id));

  const ACTIVE = ['bg-flame-500', 'text-base-900'];
  const INACTIVE = ['bg-base-900', 'text-base-300', 'hover:text-white', 'ring-1', 'ring-base-400'];

  /* ---- the step list: rebuilt only when the steps or the zone change, never on a toggle ---- */
  function rebuildSteps() {
    const list = $('calSteps');
    list.replaceChildren();
    const tz = zone();
    for (const step of state.steps) {
      const li = root.createElement('li');
      li.className = 'py-1';
      const row = root.createElement('div');
      row.className = 'flex flex-wrap items-start justify-between gap-x-3';

      const inputId = `calStep-${step.id}`;
      const noteId = `calNote-${step.id}`;
      const label = root.createElement('label');
      label.htmlFor = inputId;
      label.className = 'flex min-h-[44px] min-w-0 flex-1 cursor-pointer items-start gap-3 py-2';
      const input = root.createElement('input');
      input.type = 'checkbox';
      input.id = inputId;
      input.dataset.step = step.id;
      input.checked = !!state.checked.get(step.id);
      input.setAttribute('aria-describedby', noteId);
      input.className =
        'mt-0.5 h-5 w-5 shrink-0 rounded border-base-400 bg-base-900 accent-flame-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-flame-400';
      const text = root.createElement('span');
      text.className = 'min-w-0';
      const title = root.createElement('span');
      title.className = 'block text-sm font-semibold text-white';
      title.textContent = step.title;
      const time = root.createElement('span');
      time.className = 'block text-sm text-base-300';
      time.dataset.time = step.id;
      time.textContent = formatStepTime(step, tz);
      text.append(title, time);
      label.append(input, text);

      const link = root.createElement('a');
      link.dataset.googleLink = step.id;
      link.href = googleCalendarUrl(step);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Add to Google';
      link.setAttribute('aria-label', `Add to Google: ${step.title}`);
      link.className =
        'hidden min-h-[44px] items-center rounded-md px-2 text-sm font-medium text-flame-400 underline underline-offset-2 hover:text-flame-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-flame-400';

      const note = root.createElement('p');
      note.id = noteId;
      note.className = 'pb-2 pl-8 text-xs text-base-400';
      note.textContent = step.note;

      row.append(label, link);
      li.append(row, note);
      list.append(li);
    }
  }

  /* ---- everything that changes with a toggle, the calendar choice or a message ---- */
  function paint() {
    root.querySelectorAll('.cal-choice-opt').forEach((btn) => {
      const on = btn.dataset.calendar === state.calendar;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      ACTIVE.forEach((c) => btn.classList.toggle(c, on));
      INACTIVE.forEach((c) => btn.classList.toggle(c, !on));
    });

    const google = isGoogle();
    for (const step of state.steps) {
      const box = $(`calStep-${step.id}`);
      if (box) box.checked = !!state.checked.get(step.id);
      const link = root.querySelector(`[data-google-link="${step.id}"]`);
      if (link) {
        const visible = google && !!state.checked.get(step.id);
        link.classList.toggle('hidden', !visible);
        link.classList.toggle('inline-flex', visible);
      }
    }

    const n = selected().length;
    $('calCount').textContent = `${n} of ${state.steps.length} ${state.steps.length === 1 ? 'step' : 'steps'} selected`;
    $('calDownload').textContent = `Download ${n} ${n === 1 ? 'event' : 'events'} (.ics)`;
    show($('calDownload'), !google);
    show($('calGoogle'), google);
    $('calStatus').textContent = state.status;
    $('calEstimateNote').textContent = estimateNote(state.steps);
  }

  function recompute() {
    const snap = state.snapshot;
    show($('calEmpty'), !snap);
    show($('calBody'), !!snap);
    if (!snap) {
      state.steps = [];
      return;
    }
    const { finishTemp, pitTemp, wrapTemp, totalTime } = snap.inputs;
    state.steps = buildCookSteps(snap.plan, { finishTemp, pitTemp, wrapTemp, totalTime }, { includePrep: true, timeZone: zone() });
    for (const step of state.steps) if (!state.checked.has(step.id)) state.checked.set(step.id, step.defaultOn);
    $('calZone').textContent = `Times in ${zoneName(zone(), snap.plan.serve)}, where the cook is`;
    rebuildSteps();
    paint();
  }

  /* ---- download ---- */
  function download() {
    const picked = selected();
    if (!picked.length) {
      state.status = MESSAGES.none; // the button stays enabled; nothing is downloaded
      paint();
      return;
    }
    const inputs = state.snapshot.inputs;
    const id = planId(
      { protein: inputs.protein, weight: inputs.weight, cut: inputs.cut, pitTemp: inputs.pitTemp, wrap: inputs.wrap, wrapTemp: inputs.wrapTemp },
      inputs.serveISO
    );
    const text = buildIcs(picked, { planId: id, reminderMin: state.reminder, now: d.now() });
    const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
    d.download(blob, icsFilename(inputs.slug, new Date(inputs.serveISO), zone()));
    state.status = MESSAGES.downloaded; // no Undo: a downloaded file cannot be taken back from here
    paint();
  }
  $('calDownload').addEventListener('click', download);
  $('calDownloadAlt').addEventListener('click', download);

  /* ---- controls ---- */
  $('calSteps').addEventListener('change', (e) => {
    const box = e.target.closest('input[type=checkbox]');
    if (!box) return;
    state.checked.set(box.dataset.step, box.checked);
    state.status = '';
    paint();
  });
  $('calChoice').addEventListener('click', (e) => {
    const btn = e.target.closest('.cal-choice-opt');
    if (!btn) return;
    state.calendar = btn.dataset.calendar;
    writePrefs({ calendar: state.calendar }, d.storage); // the only thing this panel stores
    state.status = '';
    paint();
  });
  $('calReminder').addEventListener('change', () => {
    state.reminder = Number($('calReminder').value);
    state.status = '';
    paint();
  });

  // The cook's zone moved (the conditions card loaded a place): read the getter again.
  root.addEventListener('ebq:cook-zone-changed', () => recompute());

  paint();
  recompute();

  return {
    setPlan(snapshot) {
      state.snapshot = snapshot ?? null;
      state.status = ''; // a new plan makes an earlier "Downloaded" stale
      recompute();
    },
    refresh: recompute,
    getState: () => ({
      calendar: state.calendar,
      reminder: state.reminder,
      steps: state.steps.map((s) => s.id),
      checked: Object.fromEntries(state.checked),
      status: state.status,
    }),
  };
}
