/*
 * CookScheduler controller — client logic extracted verbatim from the former
 * inline script in cook-scheduler.astro. The only protein-driven input is meat
 * weight, whose slider range/clamp now comes from the registry's `thermal.axes`.
 * Pit / wrap / climate / rest are equipment/environment inputs and stay
 * component-local.
 */
import { PROTEINS } from '../../utils/proteinRegistry.js';
import { computeModel, FINISH_TEMP, dangerZoneHours, dangerZoneNote, cookDuration } from '../../utils/stallEngine.js';
import { clampNum, enumParam, getParams, writeParams, wireCopyButton } from '../../utils/shareLink.js';
import { buildMilestones, PREHEAT_HOURS as PREHEAT_HRS } from '../../utils/cookMilestones.js';

// `onPlan` is a second one-way, display-only hook for the Add to calendar panel: after each render it is called
// with a frozen copy of the plan (the buildMilestones result and the inputs behind it) or null. Like
// `onSchedule`, nothing flows back and a throwing listener never affects the schedule.
// `onSchedule` is a one-way, display-only hook: after each render it is called with
// the cook window ({ start: meat on, end: pull }) or null. Nothing flows back, and
// a throwing listener never affects the schedule.
export function initCookScheduler(protein = PROTEINS.beef_brisket, { onSchedule, onPlan } = {}) {
  const thermal = protein.thermal;
  const finishTemp = thermal.finish_temp;
  const pitTemps = Object.keys(thermal.cook_temperatures); // registry-driven, per-protein
  const method321 = thermal.method_321 || null; // ribs use fixed 3-2-1 blocks
  const usesStall = !method321; // brisket/pork use the stall/curve back-calc
  const tAxes = thermal.axes;
  const tSliders = tAxes.filter((a) => a.type === 'slider');
  const tSegs = tAxes.filter((a) => a.type === 'enum' && a.control === 'segmented');
  const wAxis = tSliders.find((a) => a.id === 'weight'); // may be undefined (ribs)
  const PARAM = { weight: 'w', racks: 'rk', cut: 'ct', preparation: 'pp' };

  const state = {
    ...(thermal.initialState ?? { weight: 12 }),
    pitTemp: '225',
    pit: 'offset_smoker',
    wrap: 'peach_butcher_paper',
    wrapTemp: 160,
    climate: 'moderate',
    rest: 1,
    serveAt: '', // datetime-local string
  };

  const $ = (id) => document.getElementById(id);

  const ACTIVE = ['bg-flame-500', 'text-white', 'shadow'];
  const INACTIVE = ['text-base-400', 'hover:text-base-300'];
  function paintGroup(selector, attr, current) {
    document.querySelectorAll(selector).forEach((btn) => {
      const on = btn.dataset[attr] === current;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      ACTIVE.forEach((c) => btn.classList.toggle(c, on));
      INACTIVE.forEach((c) => btn.classList.toggle(c, !on));
    });
  }
  function paintThermal(axisId, current) {
    document.querySelectorAll(`.${axisId}-opt`).forEach((btn) => {
      const on = btn.dataset.value === current;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      ACTIVE.forEach((c) => btn.classList.toggle(c, on));
      INACTIVE.forEach((c) => btn.classList.toggle(c, !on));
    });
  }
  function setFill(el) {
    const min = parseFloat(el.min),
      max = parseFloat(el.max),
      val = parseFloat(el.value);
    el.style.setProperty('--fill', ((val - min) / (max - min)) * 100 + '%');
  }

  const fmtClock = (d) =>
    d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const fmtHrs = (h) => {
    const hh = Math.floor(h);
    const mm = Math.round((h - hh) * 60);
    return (hh ? hh + 'h ' : '') + String(mm).padStart(2, '0') + 'm';
  };
  // Wrap-dependent confidence band around the point estimate (the estimate
  // itself stays in the share link via the input params, so precision isn't
  // lost — just honest). Foil is the most predictable, unwrapped the widest.
  const bandFraction = (wrap) =>
    wrap === 'aluminum_foil' ? 0.15 : wrap === 'peach_butcher_paper' ? 0.2 : 0.25;
  const fmtHrsRange = (h, frac) => (h > 0 ? fmtHrs(h * (1 - frac)) + '–' + fmtHrs(h * (1 + frac)) : fmtHrs(h));

  // Compute the schedule; returns milestones or null if no valid serve time.
  // The cook-time model selection (stall vs fixed 3-2-1) is delegated to the
  // shared, pure cookDuration(), and the timestamps to the pure
  // buildMilestones() (src/utils/cookMilestones.js); this controller only
  // attaches the display copy to each milestone.
  function computeSchedule() {
    const serve = state.serveAt ? new Date(state.serveAt) : null;
    if (!serve || isNaN(serve.getTime())) return null;
    const d = cookDuration(protein, engineState());
    const ms = buildMilestones({ duration: d, inputs: milestoneInputs(), serve });
    return d.method === 'method_321' ? build321(ms, d) : buildStall(ms, d);
  }

  // The inputs the (pure) cook-time and milestone functions take, shared with the calendar download.
  const engineState = () => ({
    weight: state.weight,
    pitTemp: state.pitTemp,
    pit: state.pit,
    wrap: state.wrap,
    wrapTemp: state.wrapTemp,
    climate: state.climate,
    cut: state.cut,
  });
  const milestoneInputs = () => ({ rest: state.rest, wrap: state.wrap, wrapTemp: state.wrapTemp });

  // Stall-model back-calc (brisket / pork).
  function buildStall(ms, d) {
    const m = d.model;
    const copy = {
      fire: { icon: '🔥', title: 'Light the fire', sub: `Preheat the pit to ${state.pitTemp}°F (${fmtHrs(PREHEAT_HRS)} before the meat goes on).` },
      on: { icon: '🥩', title: 'Meat on', sub: `Cold meat on the grate. Estimated ${fmtHrs(m.totalTime)} to a ${finishTemp}°F finish.` },
      wrap: {
        icon: '📦',
        title: `Wrap at ${state.wrapTemp}°F`,
        sub: `Roughly when the internal temp hits your wrap target. Have paper/foil ready once the bark is set.`,
      },
      pull: {
        icon: '🌡️',
        title: `Pull & rest`,
        sub: `Probe-tender near ${finishTemp}°F. Rest ${fmtHrs(state.rest)} in a faux-cambro before slicing.`,
      },
      serve: { icon: '🍽️', title: 'Serve', sub: 'Slice against the grain and eat.' },
    };
    const milestones = ms.milestones.map(({ id, at }) => ({ ...copy[id], at }));
    return { milestones, model: m, fireUp: ms.fireUp, serve: ms.serve, meatOn: ms.meatOn, pull: ms.pull, plan: ms };
  }

  // Fixed 3-2-1 (or 2-2-1) method for ribs: unwrapped smoke → wrapped → sauced.
  function build321(ms, d) {
    const { smoke, wrapH, sauce } = d.phases321;
    const total = d.totalTime;
    const label = `${smoke}-${wrapH}-${sauce}`;
    const copy = {
      fire: { icon: '🔥', title: 'Light the fire', sub: `Preheat the pit to ${state.pitTemp}°F (${fmtHrs(PREHEAT_HRS)} before the ribs go on).` },
      on: { icon: '🥩', title: 'Ribs on', sub: `Smoke unwrapped for ${fmtHrs(smoke)} (the "${label}" method for this cut).` },
      wrap: { icon: '📦', title: 'Wrap in foil', sub: `Wrap with a little liquid and cook ${fmtHrs(wrapH)} to tenderize.` },
      sauce: { icon: '🍯', title: 'Unwrap & sauce', sub: `Unwrap, sauce, and firm up the bark for the final ${fmtHrs(sauce)}.` },
      pull: { icon: '🌡️', title: 'Pull & rest', sub: `Bend-tender near ${finishTemp}°F. Rest ${fmtHrs(state.rest)} before cutting.` },
      serve: { icon: '🍽️', title: 'Serve', sub: 'Cut between the bones and eat.' },
    };
    const milestones = ms.milestones.map(({ id, at }) => ({ ...copy[id], at }));
    return { milestones, model: { totalTime: total }, fireUp: ms.fireUp, serve: ms.serve, meatOn: ms.meatOn, pull: ms.pull, plan: ms };
  }

  function render() {
    for (const a of tSliders) {
      const el = $(a.id);
      if (el) {
        setFill(el);
        $(`${a.id}Val`).textContent = Number(state[a.id]).toFixed(1);
      }
    }
    for (const a of tSegs) {
      paintThermal(a.id, state[a.id]);
      if (a.copy && $(`${a.id}Desc`)) $(`${a.id}Desc`).innerHTML = (thermal.copy || {})[a.copy][state[a.id]];
    }
    setFill($('rest'));
    $('restVal').textContent = state.rest.toFixed(1);
    paintGroup('.temp-opt', 'temp', state.pitTemp);
    if (usesStall) {
      setFill($('wrapTemp'));
      $('wrapTempVal').textContent = state.wrapTemp;
      paintGroup('.wrap-opt', 'wrap', state.wrap);
      paintGroup('.climate-opt', 'climate', state.climate);
      $('wrapTempWrap').style.opacity = state.wrap === 'none' ? '0.4' : '1';
      $('wrapTemp').disabled = state.wrap === 'none';
    }

    const sched = computeSchedule();
    try {
      // Copies, so a listener can never alter the scheduler's own Date objects.
      onSchedule?.(sched ? { start: new Date(sched.meatOn), end: new Date(sched.pull) } : null);
    } catch {
      /* display-only listener: never let it affect the schedule */
    }
    try {
      onPlan?.(sched ? planSnapshot(sched) : null);
    } catch {
      /* display-only listener: never let it affect the schedule */
    }
    const timeline = $('timeline');
    const warn = $('warnBox');

    if (!sched) {
      $('fireUpBig').textContent = 'Pick a serving time';
      $('totalSub').textContent = 'Choose when you want to eat to see your fire-up time.';
      warn.classList.add('hidden');
      timeline.replaceChildren();
      updateShareUrl();
      return;
    }

    $('fireUpBig').textContent = fmtClock(sched.fireUp);
    $('totalSub').textContent = `≈ ${fmtHrsRange(sched.model.totalTime, bandFraction(state.wrap))} cook + ${fmtHrs(state.rest)} rest + ${fmtHrs(PREHEAT_HRS)} preheat`;

    // Food-safety danger-zone readout — poultry only. No scheduler protein is
    // flagged today (turkey isn't schedulable), so this stays hidden; wired here
    // so it works the moment a danger-zone protein joins the scheduler.
    const dzEl = $('dangerZone');
    if (dzEl) {
      if (thermal.dangerZone && usesStall) {
        const note = dangerZoneNote(dangerZoneHours(sched.model));
        dzEl.textContent = note.text;
        dzEl.className = 'text-[11px] mt-1 leading-snug ' + (note.escalated ? 'text-amber-400/90' : 'text-base-500');
      } else {
        dzEl.classList.add('hidden');
      }
    }

    if (sched.fireUp.getTime() < Date.now()) {
      warn.textContent =
        '⚠️ That fire-up time has already passed. Move the meal later, raise the pit temp, or wrap to shorten the cook.';
      warn.classList.remove('hidden');
    } else {
      warn.classList.add('hidden');
    }

    // Build timeline (textContent only — no user HTML).
    timeline.replaceChildren();
    for (const ms of sched.milestones) {
      const li = document.createElement('li');
      li.className = 'ml-6';
      const dot = document.createElement('span');
      dot.className =
        'absolute -left-3 flex h-6 w-6 items-center justify-center rounded-full bg-base-900 ring-1 ring-base-700 text-xs';
      dot.textContent = ms.icon;
      const time = document.createElement('p');
      time.className = 'text-sm font-bold text-white';
      time.textContent = `${ms.title}: ${fmtClock(ms.at)}`;
      const sub = document.createElement('p');
      sub.className = 'text-[13px] text-base-400 leading-relaxed mt-0.5';
      sub.textContent = ms.sub;
      li.append(dot, time, sub);
      timeline.appendChild(li);
    }

    updateShareUrl();
  }

  const pad = (n) => String(n).padStart(2, '0');

  // A read-only copy of the plan and the inputs behind it, for display-only listeners. Dates are copied and the
  // result is frozen, so a listener can neither alter the scheduler's own objects nor keep a live reference.
  function planSnapshot(sched) {
    const copy = (d) => (d instanceof Date ? new Date(d.getTime()) : d);
    const ms = sched.plan;
    return Object.freeze({
      plan: Object.freeze({
        method: ms.method,
        serve: copy(ms.serve),
        pull: copy(ms.pull),
        meatOn: copy(ms.meatOn),
        fireUp: copy(ms.fireUp),
        stallOnset: copy(ms.stallOnset),
        stallEnd: copy(ms.stallEnd),
        milestones: Object.freeze(ms.milestones.map(({ id, at }) => Object.freeze({ id, at: copy(at) }))),
      }),
      inputs: Object.freeze({
        protein: protein.meta.id,
        slug: protein.meta.slug,
        weight: state.weight,
        cut: state.cut,
        pitTemp: state.pitTemp,
        wrap: state.wrap,
        wrapTemp: state.wrapTemp,
        finishTemp,
        totalTime: sched.model.totalTime,
        serveISO: sched.serve.toISOString(),
      }),
    });
  }

  /* ---- share links (validated) ---- */
  function hydrateFromParams() {
    const p = getParams();
    if (![...p.keys()].length) return;
    for (const a of tSliders) {
      const key = PARAM[a.id];
      if (key && p.has(key)) state[a.id] = clampNum(p.get(key), a.range.min, a.range.max, state[a.id]);
    }
    for (const a of tSegs) {
      const key = PARAM[a.id];
      if (key && p.has(key)) state[a.id] = enumParam(p.get(key), a.options.map((o) => o.value), state[a.id]);
    }
    if (p.has('pt')) state.pitTemp = enumParam(p.get('pt'), pitTemps, state.pitTemp);
    if (p.has('pit'))
      state.pit = enumParam(p.get('pit'), ['pellet_cooker', 'offset_smoker', 'ceramic_kamado', 'charcoal_kettle'], state.pit);
    if (usesStall) {
      if (p.has('wr')) state.wrap = enumParam(p.get('wr'), ['none', 'peach_butcher_paper', 'aluminum_foil'], state.wrap);
      if (p.has('wt')) state.wrapTemp = Math.round(clampNum(p.get('wt'), 150, 170, state.wrapTemp));
      if (p.has('cl')) state.climate = enumParam(p.get('cl'), ['arid', 'moderate', 'humid'], state.climate);
    }
    if (p.has('r')) state.rest = clampNum(p.get('r'), 0.5, 4, state.rest);
    // serve time: accept only a well-formed datetime-local string
    if (p.has('s')) {
      const s = p.get('s');
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s) && !isNaN(new Date(s).getTime())) state.serveAt = s;
    }
    maybeNoticeVersion(p);
  }
  // Notify (don't pin): a shared link made under a different model version may
  // now compute different times. Absent `v` = pre-v2026.2 link.
  function maybeNoticeVersion(p) {
    const el = document.getElementById('versionNotice');
    if (!el) return;
    // Only a real share link carries cook settings (pt, and w for weight-based proteins). A visit with
    // just ?pr= (the protein tabs link there, with no version) is not a shared link, so it never warns.
    if (!(p.has('pt') || p.has('w'))) return;
    const shared = p.get('v');
    if (shared === protein.meta.version) return;
    const was = shared || 'v2026.1 or earlier';
    el.textContent = `Heads up: this link was shared under Model ${was.startsWith('v') ? was : 'v' + was}; you're viewing Model v${protein.meta.version}, which may produce different times.`;
    el.classList.remove('hidden');
  }
  function updateShareUrl() {
    const params = { pr: protein.meta.id, pt: state.pitTemp, pit: state.pit, r: state.rest, v: protein.meta.version };
    for (const a of tAxes) if (PARAM[a.id]) params[PARAM[a.id]] = state[a.id];
    if (usesStall) {
      params.wr = state.wrap;
      params.wt = state.wrapTemp;
      params.cl = state.climate;
    }
    if (state.serveAt) params.s = state.serveAt;
    writeParams(params);
  }

  // Default serve time: tomorrow at 6:00 PM local.
  function defaultServe() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(18, 0, 0, 0);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function init() {
    hydrateFromParams();
    if (!state.serveAt) state.serveAt = defaultServe();

    // Model-version badge reflects the client-selected protein.
    if ($('modelVer')) $('modelVer').textContent = protein.meta.version;

    // hydrate controls
    $('serveAt').value = state.serveAt;

    // Show only the active protein's thermal controls; hide stall-only controls
    // (wrap / wrap-temp / climate) for fixed-method proteins like ribs.
    const activeIds = new Set(tAxes.map((a) => a.id));
    document.querySelectorAll('[data-thermal-axis]').forEach((c) => {
      c.hidden = !activeIds.has(c.dataset.thermalAxis);
    });
    document.querySelectorAll('[data-stall-only]').forEach((c) => {
      c.hidden = !usesStall;
    });

    // Protein thermal sliders: set value + protein-aware bounds/labels + wire.
    for (const a of tSliders) {
      const el = $(a.id);
      if (!el) continue;
      state[a.id] = Math.min(a.range.max, Math.max(a.range.min, state[a.id]));
      el.min = a.range.min;
      el.max = a.range.max;
      el.step = a.range.step;
      el.value = state[a.id];
      if ($(`${a.id}Min`)) $(`${a.id}Min`).textContent = `${a.range.min} ${a.range.unit}`;
      if ($(`${a.id}Max`)) $(`${a.id}Max`).textContent = `${a.range.max} ${a.range.unit}`;
      el.addEventListener('input', () => {
        state[a.id] = parseFloat(el.value);
        render();
      });
    }
    // Protein thermal segmented controls (e.g. rib cut).
    for (const a of tSegs) {
      paintThermal(a.id, state[a.id]);
      $(`${a.id}Toggle`).addEventListener('click', (e) => {
        const btn = e.target.closest(`.${a.id}-opt`);
        if (!btn) return;
        state[a.id] = btn.dataset.value;
        paintThermal(a.id, state[a.id]);
        render();
      });
    }

    // Highlight the active protein tab (selector is interactive on this page).
    document.querySelectorAll('.protein-tab').forEach((tab) => {
      const on = tab.dataset.proteinTab === protein.meta.id;
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.classList.toggle('bg-flame-500', on);
      tab.classList.toggle('text-white', on);
      tab.classList.toggle('font-semibold', on);
      tab.classList.toggle('shadow', on);
      tab.classList.toggle('text-white/60', !on);
      tab.classList.toggle('font-medium', !on);
    });
    $('rest').value = state.rest;
    $('pit').value = state.pit;

    $('serveAt').addEventListener('input', () => {
      state.serveAt = $('serveAt').value;
      render();
    });
    $('rest').addEventListener('input', () => {
      state.rest = parseFloat($('rest').value);
      render();
    });
    $('pit').addEventListener('change', () => {
      state.pit = $('pit').value;
      render();
    });
    $('pitTempToggle').addEventListener('click', (e) => {
      const btn = e.target.closest('.temp-opt');
      if (!btn) return;
      state.pitTemp = btn.dataset.temp;
      render();
    });

    if (usesStall) {
      $('wrapTemp').value = state.wrapTemp;
      $('wrapTemp').addEventListener('input', () => {
        state.wrapTemp = parseInt($('wrapTemp').value, 10);
        render();
      });
      $('wrapToggle').addEventListener('click', (e) => {
        const btn = e.target.closest('.wrap-opt');
        if (!btn) return;
        state.wrap = btn.dataset.wrap;
        render();
      });
      $('climateToggle').addEventListener('click', (e) => {
        const btn = e.target.closest('.climate-opt');
        if (!btn) return;
        state.climate = btn.dataset.climate;
        render();
      });
    }
    wireCopyButton('shareBtn');

    render();
  }

  init();
  return { state, render };
}
