/*
 * Cook milestone timestamps, as a pure function.
 *
 * Extracted verbatim from the cook scheduler controller
 * (cookScheduler.controller.js: buildStall / build321). The scheduler works
 * BACKWARD from the serve time:
 *
 *   pull   = serve - rest
 *   meatOn = pull - cookDuration.totalTime
 *   fireUp = meatOn - preheat
 *
 * and lays the intermediate milestones (wrap, stall markers) forward from
 * meatOn using durations the engine already returns. No new model math lives
 * here: every timestamp is serve, minus or plus a duration from cookDuration()
 * (or, for the stall-method wrap, a point read off the engine's own buildPath).
 *
 * This module reads engine outputs and never changes them. It has no DOM, no
 * network and no clock.
 */
import { buildPath } from './stallEngine.js';

export const HOUR_MS = 3600 * 1000;

/**
 * Smoker preheat before the meat goes on. A planning convention, not model
 * output; the scheduler has always used 45 minutes.
 */
export const PREHEAT_HOURS = 0.75;

// Point (hours from meat-on) at which the modeled internal temperature first
// reaches the wrap target; null if the path never gets there.
function wrapHoursFromPath(pts, wrapTemp) {
  for (const p of pts) if (p.temp >= wrapTemp) return p.t;
  return null;
}

/**
 * Build the absolute milestone timestamps for a cook.
 *
 * @param {object} args
 * @param {object} args.duration  Result of cookDuration(protein, state):
 *   { method:'stall', totalTime, model } or
 *   { method:'method_321', totalTime, phases321:{ smoke, wrapH, sauce } }.
 * @param {object} args.inputs    { rest (hours), wrap, wrapTemp } as on the scheduler.
 *   `wrap` and `wrapTemp` matter only for the stall method.
 * @param {Date}   args.serve     The anchor: when the food is served.
 * @param {number} [args.preheatHours]
 * @returns {{
 *   method: 'stall'|'method_321',
 *   serve: Date, pull: Date, meatOn: Date, fireUp: Date,
 *   stallOnset: Date|null, stallEnd: Date|null,
 *   milestones: Array<{ id: string, at: Date }>
 * }}
 *   `milestones` are exactly the ones the scheduler shows, sorted by time.
 *   Stall method ids: fire, on, wrap (only when wrapped and the path reaches the
 *   wrap temp), pull, serve. 3-2-1 method ids: fire, on, wrap, sauce, pull, serve.
 *   `stallOnset` / `stallEnd` are meatOn + t1 and meatOn + t1 + stallDuration (sums
 *   of engine durations). They are null for the 3-2-1 method and for proteins
 *   with no stall. They are NOT in `milestones`, which stays what the page shows.
 */
export function buildMilestones({ duration, inputs, serve, preheatHours = PREHEAT_HOURS }) {
  if (!(serve instanceof Date) || Number.isNaN(serve.getTime())) {
    throw new TypeError('buildMilestones needs a valid serve Date.');
  }
  const rest = inputs.rest;
  const pull = new Date(serve.getTime() - rest * HOUR_MS); // rest starts (pull off the pit)
  const meatOn = new Date(pull.getTime() - duration.totalTime * HOUR_MS);
  const fireUp = new Date(meatOn.getTime() - preheatHours * HOUR_MS);

  const milestones = [
    { id: 'fire', at: fireUp },
    { id: 'on', at: meatOn },
  ];
  let stallOnset = null;
  let stallEnd = null;

  if (duration.method === 'method_321') {
    const { smoke, wrapH } = duration.phases321;
    milestones.push(
      { id: 'wrap', at: new Date(meatOn.getTime() + smoke * HOUR_MS) },
      { id: 'sauce', at: new Date(meatOn.getTime() + (smoke + wrapH) * HOUR_MS) }
    );
  } else {
    const m = duration.model;
    if (inputs.wrap !== 'none') {
      const wh = wrapHoursFromPath(buildPath(m), inputs.wrapTemp);
      if (wh != null) milestones.push({ id: 'wrap', at: new Date(meatOn.getTime() + wh * HOUR_MS) });
    }
    if (!m.noStall && m.stallDuration > 0) {
      stallOnset = new Date(meatOn.getTime() + m.t1 * HOUR_MS);
      stallEnd = new Date(meatOn.getTime() + (m.t1 + m.stallDuration) * HOUR_MS);
    }
  }

  milestones.push({ id: 'pull', at: pull }, { id: 'serve', at: serve });
  milestones.sort((a, b) => a.at - b.at);

  return { method: duration.method, serve, pull, meatOn, fireUp, stallOnset, stallEnd, milestones };
}
