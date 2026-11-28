/*
 * ConditionsCard controller. Display only: it never reads from or writes to the
 * cook-time engine, and the scheduler only ever hands it the cook window (meat
 * on to pull) through setWindow().
 *
 * Location is not requested on page load unless the user has opted in. Two ways
 * the forecast loads on its own:
 *   - autoLocate is true (saved after a successful fetch): getPosition is called on
 *     load even when the Permissions API says 'prompt'. iOS Safari, especially when
 *     opened from another app, does not keep the geolocation grant across a reload,
 *     so the browser may ask again; that is fine for someone who opted in.
 *   - autoLocate was never decided and the browser has ALREADY granted geolocation.
 * Otherwise the user taps "Use my location". A failed location request (denied,
 * unavailable, timeout, unsupported) sets autoLocate to false, and so does the
 * "Stop using my location" link. A false value also overrides a browser grant, so
 * Stop sticks on browsers that remember it. Forecast-service failures (upstream,
 * network, outside coverage) do not change the opt-in.
 * Coordinates exist only as local variables between getPosition and
 * fetchConditions; nothing here stores or logs them (autoLocate is a boolean).
 *
 * Dependencies are injectable so tests run with no network and no geolocation.
 */
import { getPosition, fetchConditions, manualConditions } from '../../utils/conditions.js';
import { readPrefs, writePrefs } from '../../utils/plannerPrefs.js';
import { buildConditionsView, summaryLine, MINI_PROMPT, MINI_LOADING, MINI_ERROR } from './conditionsCard.view.js';
import { ICONS } from '../../vendor/lucide/index.js';

const MESSAGES = {
  denied: 'Location is blocked for this site. Allow it in your browser settings, or enter conditions manually.',
  unavailable: 'Your location could not be found. Try again, or enter conditions manually.',
  timeout: 'Finding your location took too long. Try again, or enter conditions manually.',
  unsupported: 'This browser cannot share its location. Enter conditions manually.',
  outside_coverage: "The National Weather Service forecast doesn't cover this location. It covers the United States and its territories. Enter conditions manually.",
  upstream: 'The forecast service is not responding right now. Try again, or enter conditions manually.',
  network: 'The forecast could not be reached. Check your connection, or enter conditions manually.',
};
// Retrying cannot help when the browser has no geolocation or the place is outside coverage.
const NO_RETRY = new Set(['unsupported', 'outside_coverage']);
const LOADING = 'Finding your forecast';
// Failures of the location request itself (not of the forecast service) withdraw the opt-in.
const POSITION_ERRORS = new Set(['denied', 'unavailable', 'timeout', 'unsupported', 'invalid_coordinates']);

export const MANUAL_LIMITS = {
  elevation: { min: -300, max: 15000, message: 'Enter an elevation from -300 to 15,000 ft.' },
  temp: { min: -60, max: 130, message: 'Enter a temperature from -60 to 130°F.' },
  wind: { min: 0, max: 100, message: 'Enter a wind speed from 0 to 100 mph.' },
  range: 'The low must be at or below the high.',
};

/**
 * Validate the manual form values (strings). Returns { ok, values, errors } where
 * errors is keyed elevation | low | high | wind | range. The module's low/high
 * swap is only a safety net; the UI never relies on it.
 */
export function validateManual({ elevation, low, high, wind }) {
  const errors = {};
  const num = (s) => (String(s ?? '').trim() === '' ? null : Number(s));
  const inRange = (n, lim) => n != null && Number.isFinite(n) && n >= lim.min && n <= lim.max;
  const e = num(elevation);
  const lo = num(low);
  const hi = num(high);
  const w = num(wind);
  if (!inRange(e, MANUAL_LIMITS.elevation)) errors.elevation = MANUAL_LIMITS.elevation.message;
  if (!inRange(lo, MANUAL_LIMITS.temp)) errors.low = MANUAL_LIMITS.temp.message;
  if (!inRange(hi, MANUAL_LIMITS.temp)) errors.high = MANUAL_LIMITS.temp.message;
  if (w != null && !inRange(w, MANUAL_LIMITS.wind)) errors.wind = MANUAL_LIMITS.wind.message;
  if (!errors.low && !errors.high && lo > hi) errors.range = MANUAL_LIMITS.range;
  return { ok: Object.keys(errors).length === 0, values: { elevationFt: e, lowF: lo, highF: hi, windMph: w }, errors };
}

async function defaultPermissionState() {
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });
    return status.state;
  } catch {
    return null; // Permissions API missing or not supported for geolocation
  }
}

/**
 * @param {object} [opts]
 * @param {Document} [opts.root]
 * @param {object} [opts.deps]  { getPosition, fetchConditions, manualConditions, permissionState, storage }
 * @returns {{ setWindow: (w: {start: Date|number, end: Date|number}|null) => void, getState: () => object, getTimeZone: () => string|null, ready: Promise<void> }}
 */
export function initConditionsCard({ root = document, deps = {} } = {}) {
  const d = {
    getPosition,
    fetchConditions,
    manualConditions,
    permissionState: defaultPermissionState,
    storage: undefined,
    ...deps,
  };
  const $ = (id) => root.getElementById(id);
  if (!$('conditionsCard')) return { setWindow() {}, getState: () => ({}), getTimeZone: () => null, ready: Promise.resolve() };

  const state = { status: 'idle', conditions: null, errorCode: null, window: null, formOpen: false, stopped: false };

  const show = (el, on) => el && el.classList.toggle('hidden', !on);

  /* ---- cooker class + blanket (the only two values stored) ---- */
  const ACTIVE = ['bg-flame-500', 'text-base-900'];
  const INACTIVE = ['bg-base-900', 'text-base-300', 'hover:text-white', 'ring-1', 'ring-base-400'];
  function paintPrefs() {
    const prefs = readPrefs(d.storage);
    root.querySelectorAll('.cond-cooker-opt').forEach((btn) => {
      const on = btn.dataset.cooker === prefs.cooker;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      ACTIVE.forEach((c) => btn.classList.toggle(c, on));
      INACTIVE.forEach((c) => btn.classList.toggle(c, !on));
    });
    $('condBlanket').checked = prefs.blanket;
  }
  $('condCooker').addEventListener('click', (e) => {
    const btn = e.target.closest('.cond-cooker-opt');
    if (!btn) return;
    writePrefs({ cooker: btn.dataset.cooker }, d.storage);
    paintPrefs();
  });
  $('condBlanket').addEventListener('change', () => {
    writePrefs({ blanket: $('condBlanket').checked }, d.storage);
    paintPrefs();
  });

  /* ---- rendering ---- */
  const PRIMARY = ['bg-flame-500', 'hover:bg-flame-400', 'text-base-900', 'font-bold'];
  const SECONDARY = ['bg-base-900', 'ring-1', 'ring-base-400', 'hover:bg-base-700', 'text-base-300', 'hover:text-white', 'font-medium'];
  const isReady = () => state.status === 'ready' && !!state.conditions;

  function hideBody() {
    for (const id of ['condBody', 'condPill', 'condPlace', 'condCredit']) show($(id), false);
  }

  /*
   * A 16px inline weather icon, or null for an unknown name. The markup is a
   * vendored constant (src/vendor/lucide), never forecast text. It is decorative:
   * aria-hidden, with the meaning carried by text. It draws in currentColor, so the
   * wrapper's text color applies: white like the temperature, flame-400 for the sun.
   */
  function weatherIcon(name) {
    if (!ICONS[name]) return null;
    const wrap = root.createElement('span');
    wrap.className = `inline-flex shrink-0 ${name === 'sun' ? 'text-flame-400' : 'text-white'}`;
    // Drop the license comment and the pretty-printing between tags, so the DOM holds
    // only the drawing (otherwise textContent picks up a run of blank lines). The
    // vendored files themselves are not changed.
    wrap.innerHTML = ICONS[name].replace(/<!--[\s\S]*?-->/g, '').replace(/>\s+</g, '><').trim();
    const svg = wrap.querySelector('svg');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    return wrap;
  }

  function renderBody() {
    if (!isReady() || state.formOpen) return hideBody();
    const view = buildConditionsView(state.conditions, state.window);
    show($('condPill'), true);
    $('condPill').textContent = view.pill;
    show($('condPlace'), !!view.place);
    $('condPlace').textContent = view.place ?? '';

    const rows = $('condRows');
    rows.replaceChildren();
    for (const r of view.rows) {
      const wrap = root.createElement('div');
      wrap.dataset.row = r.key;
      const dt = root.createElement('dt');
      dt.className = 'text-xs text-base-400';
      dt.textContent = r.label;
      const dd = root.createElement('dd');
      dd.className = 'text-sm font-semibold text-white';
      const rowIcon = r.icon ? weatherIcon(r.icon) : null;
      if (rowIcon) {
        dd.className += ' flex items-center gap-1.5';
        dd.append(rowIcon, root.createTextNode(r.value));
      } else {
        dd.textContent = r.value;
      }
      wrap.append(dt, dd);
      if (r.note) {
        const n = root.createElement('p');
        n.className = 'text-xs text-base-300 font-normal mt-0.5';
        n.textContent = r.note;
        wrap.append(n);
      }
      rows.append(wrap);
    }

    show($('condStrip'), !!view.strip);
    const grid = $('condStripGrid');
    grid.replaceChildren();
    if (view.strip) {
      $('condStripLabel').textContent = view.strip.label;
      for (const c of view.strip.cells) {
        const li = root.createElement('li');
        li.className = 'rounded-md bg-base-900 ring-1 ring-base-700 px-1 py-1.5 text-center';
        const line = (cls, text) => {
          const p = root.createElement('p');
          p.className = cls;
          p.textContent = text;
          return p;
        };
        li.append(
          line('text-[10px] leading-3 h-3 text-flame-400 font-semibold', c.day),
          line('text-[11px] leading-4 text-base-300', c.hour)
        );
        if (view.strip.slots) {
          // Icon, then the precipitation chance: both lines are always present in a strip
          // that has any, at a fixed height, so every tile is the same height. The visible
          // percentage is hidden from screen readers; the label below says it in words.
          const iconSlot = root.createElement('div');
          iconSlot.className = 'flex h-4 items-center justify-center';
          const icon = c.icon ? weatherIcon(c.icon) : null;
          if (icon) iconSlot.append(icon);
          const precip = line('text-[10px] leading-3 h-3 whitespace-nowrap font-semibold text-sky-300', c.precip);
          precip.dataset.precip = '';
          precip.setAttribute('aria-hidden', 'true');
          li.append(iconSlot, precip);
        }
        li.append(line('text-sm leading-5 font-bold text-white', c.temp), line('text-[10px] leading-3 text-base-300', c.wind));
        if (c.label) {
          const sr = root.createElement('span');
          sr.className = 'sr-only';
          sr.textContent = c.label;
          li.append(sr);
        }
        grid.append(li);
      }
    }
    show($('condNote'), !!view.note);
    $('condNote').textContent = view.note ?? '';
    show($('condCredit'), !!view.credit);
    show($('condBody'), true);
  }

  /* ---- compact strip under the "Light the fire at" card (optional markup) ---- */
  function renderMini() {
    const mini = $('condMini');
    if (!mini) return;
    const idle = state.status === 'idle';
    const ready = isReady();
    $('condMiniText').textContent = ready
      ? summaryLine(buildConditionsView(state.conditions, state.window))
      : state.status === 'loading'
        ? MINI_LOADING
        : state.status === 'error'
          ? MINI_ERROR
          : MINI_PROMPT;
    show($('condMiniBtn'), idle);
    const details = $('condMiniDetails');
    details.classList.toggle('hidden', idle || state.status === 'loading');
    details.classList.toggle('inline-flex', !(idle || state.status === 'loading'));
  }

  // One-way read for display-only neighbors (the Add to calendar panel): the NWS time zone of the place the
  // forecast was loaded for, or null (not loaded, manual conditions, or an error). Nothing is passed in.
  const getTimeZone = () => (isReady() && state.conditions.source === 'nws' ? state.conditions.timeZone : null);
  let lastZone = null;
  function notifyZone() {
    const zone = getTimeZone();
    if (zone === lastZone) return;
    lastZone = zone;
    root.dispatchEvent(new CustomEvent('ebq:cook-zone-changed')); // no payload: listeners call getTimeZone()
  }

  function render() {
    const { status, formOpen } = state;
    const loading = status === 'loading';
    const error = status === 'error';
    const ready = isReady();
    const manual = ready && state.conditions.source === 'manual';

    show($('condIntro'), status === 'idle' && !formOpen);
    const statusEl = $('condStatus');
    show(statusEl, (loading || error) && !formOpen);
    statusEl.textContent = loading ? LOADING : error ? MESSAGES[state.errorCode] ?? MESSAGES.unavailable : '';

    const showActions = !formOpen && !loading;
    show($('condActions'), showActions);
    show($('condPrivacy'), showActions && !ready);

    const useBtn = $('condUseBtn');
    show(useBtn, !(error && NO_RETRY.has(state.errorCode)));
    useBtn.textContent = error ? 'Try again' : ready && !manual ? 'Update location' : 'Use my location';
    const primary = !ready;
    PRIMARY.forEach((c) => useBtn.classList.toggle(c, primary));
    SECONDARY.forEach((c) => useBtn.classList.toggle(c, !primary));
    $('condManualBtn').textContent = manual ? 'Edit' : 'Enter manually';

    const autoOn = readPrefs(d.storage).autoLocate === true;
    const nws = ready && !manual;
    show($('condAutoRow'), nws && !formOpen && (autoOn || state.stopped));
    show($('condStopBtn'), autoOn);
    show($('condStopNote'), !autoOn && state.stopped);

    show($('condForm'), formOpen);
    renderBody();
    renderMini();
    notifyZone();
  }

  /* ---- location flow ---- */
  async function load() {
    if (state.status === 'loading') return;
    state.formOpen = false;
    state.stopped = false;
    state.status = 'loading';
    render();
    const fail = (err) => {
      state.status = 'error';
      state.errorCode = err && typeof err.code === 'string' ? err.code : 'unavailable';
      if (state.errorCode === 'invalid_coordinates') state.errorCode = 'unavailable';
      if (POSITION_ERRORS.has(state.errorCode)) writePrefs({ autoLocate: false }, d.storage);
    };
    try {
      // Coordinates live only in these two lines and are never stored.
      const pos = await d.getPosition({ timeoutMs: 10000 });
      const conditions = await d.fetchConditions(pos.lat, pos.lon);
      state.conditions = conditions;
      state.status = 'ready';
      writePrefs({ autoLocate: true }, d.storage); // a boolean only, never coordinates
    } catch (err) {
      fail(err);
    }
    render();
  }
  $('condUseBtn').addEventListener('click', load);
  $('condMiniBtn')?.addEventListener('click', load);
  $('condMiniDetails')?.addEventListener('click', () => {
    // The link scrolls to the card on its own; also move focus there for keyboard and screen reader users.
    $('conditionsCard').focus?.({ preventScroll: true });
  });
  $('condStopBtn').addEventListener('click', () => {
    writePrefs({ autoLocate: false }, d.storage);
    state.stopped = true;
    render();
  });

  /* ---- manual form ---- */
  const FIELDS = { elevation: 'condElev', low: 'condLow', high: 'condHigh', wind: 'condWind' };
  const ERR_IDS = { elevation: 'condElevErr', low: 'condLowErr', high: 'condHighErr', wind: 'condWindErr', range: 'condRangeErr' };
  let attempted = false;

  const formValues = () => ({
    elevation: $('condElev').value,
    low: $('condLow').value,
    high: $('condHigh').value,
    wind: $('condWind').value,
  });

  // Before the first submit only the low/high check is shown (as soon as both are
  // valid numbers); after it, every field validates as the user types.
  function paintErrors(result, live) {
    for (const key of ['elevation', 'low', 'high', 'wind']) {
      $(ERR_IDS[key]).textContent = live ? result.errors[key] ?? '' : '';
    }
    const range = result.errors.range ?? '';
    $('condRangeErr').textContent = range;
    const bad = (key) => (live && !!result.errors[key]) || (!!range && (key === 'low' || key === 'high'));
    for (const key of ['elevation', 'low', 'high', 'wind']) $(FIELDS[key]).setAttribute('aria-invalid', bad(key) ? 'true' : 'false');
  }
  const onInput = () => paintErrors(validateManual(formValues()), attempted);
  Object.values(FIELDS).forEach((id) => $(id).addEventListener('input', onInput));

  function openForm() {
    const m = state.conditions?.source === 'manual' ? state.conditions.manual : null;
    if (m) {
      $('condElev').value = m.elevationFt ?? '';
      $('condLow').value = m.lowF ?? '';
      $('condHigh').value = m.highF ?? '';
      $('condWind').value = m.windMph ?? '';
    }
    attempted = false;
    paintErrors(validateManual(formValues()), false);
    state.formOpen = true;
    render();
    $('condElev').focus?.();
  }
  $('condManualBtn').addEventListener('click', openForm);
  $('condFormBack').addEventListener('click', () => {
    state.formOpen = false;
    render();
  });
  $('condForm').addEventListener('submit', (e) => {
    e.preventDefault();
    attempted = true;
    const result = validateManual(formValues());
    paintErrors(result, true);
    if (!result.ok) {
      const first = ['elevation', 'low', 'high', 'wind'].find((k) => result.errors[k]) ?? 'low';
      $(FIELDS[first]).focus?.();
      return;
    }
    state.conditions = d.manualConditions(result.values);
    state.status = 'ready';
    state.errorCode = null;
    state.formOpen = false;
    render();
  });

  paintPrefs();
  render();

  // Load on its own only for an opted-in user, or (when they never decided) a browser
  // that has already granted location. A saved false wins over a browser grant.
  const ready = (async () => {
    const { autoLocate } = readPrefs(d.storage);
    if (autoLocate === true) {
      await load();
    } else if (autoLocate === null) {
      const perm = await d.permissionState();
      if (perm === 'granted' && state.status === 'idle' && !state.formOpen) await load();
    }
  })();

  return {
    setWindow(w) {
      state.window = w ? { start: w.start, end: w.end } : null;
      renderBody();
      renderMini();
    },
    getState: () => ({ status: state.status, source: state.conditions?.source ?? null, errorCode: state.errorCode }),
    getTimeZone,
    ready,
  };
}
