// @vitest-environment happy-dom
/*
 * Characterization test for the cook scheduler's rendered times.
 *
 * It pins what the controller shows today for all three schedulable proteins
 * (brisket, pork shoulder, ribs), so the milestone-timestamp extraction into
 * src/utils/cookMilestones.js can be proven behavior-neutral.
 *
 * Two layers are pinned per case:
 *   1. The rendered text: headline, summary line, warning, and each timeline row.
 *   2. The exact instant behind every formatted time, as milliseconds before the
 *      serve time. Rendering rounds to the minute, so this catches drift the
 *      text cannot. (Every displayed time goes through Date#toLocaleString, which
 *      is recorded here.)
 *
 * Determinism: the clock is frozen, the locale is forced to en-US, and the serve
 * time is a local datetime-local string in July, so results do not depend on the
 * machine's time zone or locale. Do not regenerate EXPECTED to make a refactor
 * pass; a difference here means the rendered times changed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import CookScheduler from '../CookScheduler.astro';
import { mountComponent } from './mount.js';
import { PROTEINS } from '../../../utils/proteinRegistry.js';
import { initCookScheduler } from '../cookScheduler.controller.js';

const SERVE = '2026-07-18T18:00';

const BASE = { pitTemp: '225', pit: 'offset_smoker', wrap: 'peach_butcher_paper', wrapTemp: 160, climate: 'moderate', rest: 1 };

const CASES = [
  { name: 'brisket default', protein: 'beef_brisket', state: { ...BASE, weight: 12 } },
  { name: 'brisket foil 18 lb 250 arid', protein: 'beef_brisket', state: { ...BASE, weight: 18, wrap: 'aluminum_foil', wrapTemp: 165, pitTemp: '250', climate: 'arid', pit: 'pellet_cooker', rest: 2 } },
  { name: 'brisket unwrapped 8.5 lb 275 humid', protein: 'beef_brisket', state: { ...BASE, weight: 8.5, wrap: 'none', pitTemp: '275', climate: 'humid', pit: 'ceramic_kamado', rest: 0.5 } },
  { name: 'pork paper 8.5 lb', protein: 'pork_shoulder', state: { ...BASE, weight: 8.5, pit: 'ceramic_kamado' } },
  { name: 'pork foil 11 lb 250 humid', protein: 'pork_shoulder', state: { ...BASE, weight: 11, wrap: 'aluminum_foil', pitTemp: '250', climate: 'humid', pit: 'charcoal_kettle', rest: 3 } },
  { name: 'pork unwrapped 6 lb 275 arid', protein: 'pork_shoulder', state: { ...BASE, weight: 6, wrap: 'none', pitTemp: '275', climate: 'arid', pit: 'pellet_cooker' } },
  { name: 'ribs spare 3-2-1', protein: 'pork_ribs', state: { ...BASE, cut: 'spare', racks: 3, rest: 0.5 } },
  { name: 'ribs st louis 250', protein: 'pork_ribs', state: { ...BASE, cut: 'st_louis', racks: 2, pitTemp: '250' } },
  { name: 'ribs baby back 2-2-1', protein: 'pork_ribs', state: { ...BASE, cut: 'baby_back', racks: 4, pitTemp: '275', rest: 1.5 } },
  { name: 'brisket fire-up already passed', protein: 'beef_brisket', serve: '2026-06-01T20:00', state: { ...BASE, weight: 12 } },
];

// Captured from the controller before the extraction (see header).
const EXPECTED = {
  "brisket default": {
    "headline": "Sat, Jul 18, 1:44 AM",
    "summary": "≈ 11h 37m–17h 25m cook + 1h 00m rest + 45m preheat",
    "warn": null,
    "rows": [
      "Light the fire: Sat, Jul 18, 1:44 AM || Preheat the pit to 225°F (45m before the meat goes on).",
      "Meat on: Sat, Jul 18, 2:29 AM || Cold meat on the grate. Estimated 14h 31m to a 203°F finish.",
      "Wrap at 160°F: Sat, Jul 18, 1:36 PM || Roughly when the internal temp hits your wrap target. Have paper/foil ready once the bark is set.",
      "Pull & rest: Sat, Jul 18, 5:00 PM || Probe-tender near 203°F. Rest 1h 00m in a faux-cambro before slicing.",
      "Serve: Sat, Jul 18, 6:00 PM || Slice against the grain and eat."
    ],
    "msBeforeServe": [
      58546447,
      58546447,
      55846447,
      15828927,
      3600000,
      0
    ]
  },
  "brisket foil 18 lb 250 arid": {
    "headline": "Fri, Jul 17, 9:33 PM",
    "summary": "≈ 15h 02m–20h 20m cook + 2h 00m rest + 45m preheat",
    "warn": null,
    "rows": [
      "Light the fire: Fri, Jul 17, 9:33 PM || Preheat the pit to 250°F (45m before the meat goes on).",
      "Meat on: Fri, Jul 17, 10:18 PM || Cold meat on the grate. Estimated 17h 41m to a 203°F finish.",
      "Wrap at 165°F: Sat, Jul 18, 2:05 PM || Roughly when the internal temp hits your wrap target. Have paper/foil ready once the bark is set.",
      "Pull & rest: Sat, Jul 18, 4:00 PM || Probe-tender near 203°F. Rest 2h 00m in a faux-cambro before slicing.",
      "Serve: Sat, Jul 18, 6:00 PM || Slice against the grain and eat."
    ],
    "msBeforeServe": [
      73565556,
      73565556,
      70865556,
      14066327,
      7200000,
      0
    ]
  },
  "brisket unwrapped 8.5 lb 275 humid": {
    "headline": "Sat, Jul 18, 8:18 AM",
    "summary": "≈ 6h 20m–10h 33m cook + 30m rest + 45m preheat",
    "warn": null,
    "rows": [
      "Light the fire: Sat, Jul 18, 8:18 AM || Preheat the pit to 275°F (45m before the meat goes on).",
      "Meat on: Sat, Jul 18, 9:03 AM || Cold meat on the grate. Estimated 8h 27m to a 203°F finish.",
      "Pull & rest: Sat, Jul 18, 5:30 PM || Probe-tender near 203°F. Rest 30m in a faux-cambro before slicing.",
      "Serve: Sat, Jul 18, 6:00 PM || Slice against the grain and eat."
    ],
    "msBeforeServe": [
      34905063,
      34905063,
      32205063,
      1800000,
      0
    ]
  },
  "pork paper 8.5 lb": {
    "headline": "Sat, Jul 18, 2:05 AM",
    "summary": "≈ 11h 19m–16h 59m cook + 1h 00m rest + 45m preheat",
    "warn": null,
    "rows": [
      "Light the fire: Sat, Jul 18, 2:05 AM || Preheat the pit to 225°F (45m before the meat goes on).",
      "Meat on: Sat, Jul 18, 2:50 AM || Cold meat on the grate. Estimated 14h 09m to a 202°F finish.",
      "Wrap at 160°F: Sat, Jul 18, 1:57 PM || Roughly when the internal temp hits your wrap target. Have paper/foil ready once the bark is set.",
      "Pull & rest: Sat, Jul 18, 5:00 PM || Probe-tender near 202°F. Rest 1h 00m in a faux-cambro before slicing.",
      "Serve: Sat, Jul 18, 6:00 PM || Slice against the grain and eat."
    ],
    "msBeforeServe": [
      57251249,
      57251249,
      54551249,
      14531908,
      3600000,
      0
    ]
  },
  "pork foil 11 lb 250 humid": {
    "headline": "Sat, Jul 18, 2:07 AM",
    "summary": "≈ 10h 18m–13h 56m cook + 3h 00m rest + 45m preheat",
    "warn": null,
    "rows": [
      "Light the fire: Sat, Jul 18, 2:07 AM || Preheat the pit to 250°F (45m before the meat goes on).",
      "Meat on: Sat, Jul 18, 2:52 AM || Cold meat on the grate. Estimated 12h 07m to a 202°F finish.",
      "Wrap at 160°F: Sat, Jul 18, 12:34 PM || Roughly when the internal temp hits your wrap target. Have paper/foil ready once the bark is set.",
      "Pull & rest: Sat, Jul 18, 3:00 PM || Probe-tender near 202°F. Rest 3h 00m in a faux-cambro before slicing.",
      "Serve: Sat, Jul 18, 6:00 PM || Slice against the grain and eat."
    ],
    "msBeforeServe": [
      57140345,
      57140345,
      54440345,
      19530496,
      10800000,
      0
    ]
  },
  "pork unwrapped 6 lb 275 arid": {
    "headline": "Sat, Jul 18, 9:08 AM",
    "summary": "≈ 5h 20m–8h 53m cook + 1h 00m rest + 45m preheat",
    "warn": null,
    "rows": [
      "Light the fire: Sat, Jul 18, 9:08 AM || Preheat the pit to 275°F (45m before the meat goes on).",
      "Meat on: Sat, Jul 18, 9:53 AM || Cold meat on the grate. Estimated 7h 07m to a 202°F finish.",
      "Pull & rest: Sat, Jul 18, 5:00 PM || Probe-tender near 202°F. Rest 1h 00m in a faux-cambro before slicing.",
      "Serve: Sat, Jul 18, 6:00 PM || Slice against the grain and eat."
    ],
    "msBeforeServe": [
      31903246,
      31903246,
      29203246,
      3600000,
      0
    ]
  },
  "ribs spare 3-2-1": {
    "headline": "Sat, Jul 18, 10:45 AM",
    "summary": "≈ 4h 48m–7h 12m cook + 30m rest + 45m preheat",
    "warn": null,
    "rows": [
      "Light the fire: Sat, Jul 18, 10:45 AM || Preheat the pit to 225°F (45m before the ribs go on).",
      "Ribs on: Sat, Jul 18, 11:30 AM || Smoke unwrapped for 3h 00m (the \"3-2-1\" method for this cut).",
      "Wrap in foil: Sat, Jul 18, 2:30 PM || Wrap with a little liquid and cook 2h 00m to tenderize.",
      "Unwrap & sauce: Sat, Jul 18, 4:30 PM || Unwrap, sauce, and firm up the bark for the final 1h 00m.",
      "Pull & rest: Sat, Jul 18, 5:30 PM || Bend-tender near 203°F. Rest 30m before cutting.",
      "Serve: Sat, Jul 18, 6:00 PM || Cut between the bones and eat."
    ],
    "msBeforeServe": [
      26100000,
      26100000,
      23400000,
      12600000,
      5400000,
      1800000,
      0
    ]
  },
  "ribs st louis 250": {
    "headline": "Sat, Jul 18, 10:15 AM",
    "summary": "≈ 4h 48m–7h 12m cook + 1h 00m rest + 45m preheat",
    "warn": null,
    "rows": [
      "Light the fire: Sat, Jul 18, 10:15 AM || Preheat the pit to 250°F (45m before the ribs go on).",
      "Ribs on: Sat, Jul 18, 11:00 AM || Smoke unwrapped for 3h 00m (the \"3-2-1\" method for this cut).",
      "Wrap in foil: Sat, Jul 18, 2:00 PM || Wrap with a little liquid and cook 2h 00m to tenderize.",
      "Unwrap & sauce: Sat, Jul 18, 4:00 PM || Unwrap, sauce, and firm up the bark for the final 1h 00m.",
      "Pull & rest: Sat, Jul 18, 5:00 PM || Bend-tender near 203°F. Rest 1h 00m before cutting.",
      "Serve: Sat, Jul 18, 6:00 PM || Cut between the bones and eat."
    ],
    "msBeforeServe": [
      27900000,
      27900000,
      25200000,
      14400000,
      7200000,
      3600000,
      0
    ]
  },
  "ribs baby back 2-2-1": {
    "headline": "Sat, Jul 18, 10:45 AM",
    "summary": "≈ 4h 00m–6h 00m cook + 1h 30m rest + 45m preheat",
    "warn": null,
    "rows": [
      "Light the fire: Sat, Jul 18, 10:45 AM || Preheat the pit to 275°F (45m before the ribs go on).",
      "Ribs on: Sat, Jul 18, 11:30 AM || Smoke unwrapped for 2h 00m (the \"2-2-1\" method for this cut).",
      "Wrap in foil: Sat, Jul 18, 1:30 PM || Wrap with a little liquid and cook 2h 00m to tenderize.",
      "Unwrap & sauce: Sat, Jul 18, 3:30 PM || Unwrap, sauce, and firm up the bark for the final 1h 00m.",
      "Pull & rest: Sat, Jul 18, 4:30 PM || Bend-tender near 203°F. Rest 1h 30m before cutting.",
      "Serve: Sat, Jul 18, 6:00 PM || Cut between the bones and eat."
    ],
    "msBeforeServe": [
      26100000,
      26100000,
      23400000,
      16200000,
      9000000,
      5400000,
      0
    ]
  },
  "brisket fire-up already passed": {
    "headline": "Mon, Jun 1, 3:44 AM",
    "summary": "≈ 11h 37m–17h 25m cook + 1h 00m rest + 45m preheat",
    "warn": "⚠️ That fire-up time has already passed. Move the meal later, raise the pit temp, or wrap to shorten the cook.",
    "rows": [
      "Light the fire: Mon, Jun 1, 3:44 AM || Preheat the pit to 225°F (45m before the meat goes on).",
      "Meat on: Mon, Jun 1, 4:29 AM || Cold meat on the grate. Estimated 14h 31m to a 203°F finish.",
      "Wrap at 160°F: Mon, Jun 1, 3:36 PM || Roughly when the internal temp hits your wrap target. Have paper/foil ready once the bark is set.",
      "Pull & rest: Mon, Jun 1, 7:00 PM || Probe-tender near 203°F. Rest 1h 00m in a faux-cambro before slicing.",
      "Serve: Mon, Jun 1, 8:00 PM || Slice against the grain and eat."
    ],
    "msBeforeServe": [
      58546447,
      58546447,
      55846447,
      15828927,
      3600000,
      0
    ]
  }
};

function observe(protein, state, serveAt) {
  const instants = [];
  const orig = Date.prototype.toLocaleString;
  const spy = vi.spyOn(Date.prototype, 'toLocaleString').mockImplementation(function (_locale, opts) {
    instants.push(this.getTime());
    return orig.call(this, 'en-US', opts);
  });

  const { state: s, render } = initCookScheduler(PROTEINS[protein]);
  Object.assign(s, state, { serveAt });
  instants.length = 0; // keep only the render under test
  render();
  spy.mockRestore();

  const serveMs = new Date(serveAt).getTime();
  const rows = [...document.getElementById('timeline').children].map((li) => {
    const p = li.querySelectorAll('p');
    return `${p[0].textContent} || ${p[1].textContent}`;
  });
  const warn = document.getElementById('warnBox');
  return {
    headline: document.getElementById('fireUpBig').textContent,
    summary: document.getElementById('totalSub').textContent,
    warn: warn.classList.contains('hidden') ? null : warn.textContent,
    rows,
    msBeforeServe: instants.map((t) => serveMs - t),
  };
}

describe('scheduler rendered times (characterization)', () => {
  beforeEach(async () => {
    document.body.innerHTML = '';
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 5, 1, 12, 0, 0));
    await mountComponent(CookScheduler);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  for (const c of CASES) {
    it(c.name, () => {
      const got = observe(c.protein, c.state, c.serve ?? SERVE);
      if (!EXPECTED[c.name]) throw new Error(`No expected value yet for "${c.name}". Observed:\n${JSON.stringify(got)}`);
      expect(got).toEqual(EXPECTED[c.name]);
    });
  }

  it('covers every case with an expectation', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(CASES.map((c) => c.name).sort());
  });
});
