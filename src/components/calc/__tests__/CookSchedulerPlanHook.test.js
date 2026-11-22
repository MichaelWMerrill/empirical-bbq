// @vitest-environment happy-dom
/*
 * The scheduler's onPlan hook: a one-way, display-only snapshot of the plan for the Add to calendar panel.
 * Also: the old #icsBtn and its handler are gone from the scheduler.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import CookScheduler from '../CookScheduler.astro';
import { mountComponent } from './mount.js';
import { PROTEINS } from '../../../utils/proteinRegistry.js';
import { initCookScheduler } from '../cookScheduler.controller.js';

const SERVE = '2026-07-18T18:00';
const PORK = { pitTemp: '225', pit: 'ceramic_kamado', wrap: 'peach_butcher_paper', wrapTemp: 160, climate: 'moderate', rest: 1, weight: 8.5 };
const $ = (id) => document.getElementById(id);

async function run(protein, hooks, state = PORK) {
  document.body.innerHTML = '';
  await mountComponent(CookScheduler);
  const sched = initCookScheduler(PROTEINS[protein], hooks);
  Object.assign(sched.state, state, { serveAt: SERVE });
  sched.render();
  return sched;
}
const rendered = () => ({ headline: $('fireUpBig').textContent, rows: $('timeline').innerHTML, summary: $('totalSub').textContent });

describe('scheduler onPlan hook', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('hands over a frozen snapshot of the plan and the inputs behind it', async () => {
    let snap = null;
    await run('pork_shoulder', { onPlan: (s) => (snap = s) });
    expect(snap).toBeTruthy();
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.plan)).toBe(true);
    expect(Object.isFrozen(snap.inputs)).toBe(true);
    expect(Object.isFrozen(snap.plan.milestones)).toBe(true);
    expect(snap.plan.method).toBe('stall');
    expect(snap.plan.milestones.map((m) => m.id)).toEqual(['fire', 'on', 'wrap', 'pull', 'serve']);
    expect(snap.plan.stallOnset).toBeInstanceOf(Date);
    expect(snap.inputs).toMatchObject({ protein: 'pork_shoulder', slug: 'pork-shoulder', weight: 8.5, pitTemp: '225', wrap: 'peach_butcher_paper', wrapTemp: 160, finishTemp: 202 });
    expect(snap.inputs.totalTime).toBeGreaterThan(10);
    expect(snap.inputs.serveISO).toBe(new Date(SERVE).toISOString());
  });

  it('is null when there is no serving time', async () => {
    const seen = [];
    const sched = await run('pork_shoulder', { onPlan: (s) => seen.push(s) });
    sched.state.serveAt = '';
    sched.render();
    expect(seen.at(-1)).toBeNull();
  });

  it('the ribs plan carries the fixed-time method and a sauce milestone', async () => {
    let snap = null;
    await run('pork_ribs', { onPlan: (s) => (snap = s) }, { ...PORK, cut: 'spare', racks: 3, rest: 0.5 });
    expect(snap.plan.method).toBe('method_321');
    expect(snap.plan.milestones.map((m) => m.id)).toContain('sauce');
    expect(snap.plan.stallOnset).toBeNull();
  });

  it('a listener that vandalizes the snapshot DURING the call cannot change what the scheduler renders: copies, not live objects', async () => {
    await run('pork_shoulder', {});
    const baseline = rendered(); // the same plan with no listener at all
    let snap = null;
    await run('pork_shoulder', {
      onPlan: (s) => {
        snap = s;
        // the scheduler builds its timeline right after this call; live dates would corrupt it
        s.plan.serve.setTime(0);
        s.plan.meatOn.setTime(0);
        s.plan.pull.setTime(0);
        s.plan.fireUp.setTime(0);
        for (const m of s.plan.milestones) m.at.setTime(0);
      },
    });
    expect(rendered()).toEqual(baseline);
    expect(() => {
      'use strict';
      snap.plan.method = 'x';
    }).toThrow(TypeError); // and the snapshot itself is frozen
  });

  it('a throwing listener never affects the schedule', async () => {
    await run('pork_shoulder', {});
    const baseline = rendered();
    await run('pork_shoulder', {
      onPlan: () => {
        throw new Error('boom');
      },
    });
    expect(rendered()).toEqual(baseline);
  });

  it('works without any listener', async () => {
    await run('pork_shoulder', {});
    expect($('fireUpBig').textContent).not.toBe('Pick a serving time');
  });
});

describe('the old calendar button is gone from the scheduler', () => {
  it('has no #icsBtn in the page and no calendar code left in the scheduler controller', async () => {
    await run('pork_shoulder', {});
    expect($('icsBtn')).toBeNull();
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'cookScheduler.controller.js'), 'utf8');
    expect(src).not.toMatch(/icsBtn|downloadIcs|buildIcs|buildCookSteps|utils\/ics\.js/);
  });
});
