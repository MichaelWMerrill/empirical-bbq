// @vitest-environment happy-dom
/*
 * The rest note under the "Rest Before Serving" slider is shown for every protein the scheduler
 * supports (brisket, pork shoulder, ribs), so it must not name one as the subject. It is also a
 * food-safety statement: it cites guidance rather than promising how long a hold stays hot, and
 * makes no duration promise. The scheduler FAQ answer about rest carries the same statement.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import CookScheduler from '../CookScheduler.astro';
import { mountComponent } from './mount.js';

const NOTE =
  'A faux-cambro (foil, towels and a dry cooler) slows cooling during the rest. Food safety guidance is to keep hot food at 140°F or above, so probe it before slicing, especially thinner cuts like ribs.';

// Phrases that would promise how long food stays hot or safe.
const PROMISES = /\bsafely above\b|\bkeeps? (it|the meat|them)\b|\bfor (several|\d+) hours?\b|\bstays? (hot|above|safe)\b|\bhour or more keeps\b/i;

describe('scheduler rest note', () => {
  it('is protein-neutral, cites guidance, and makes no duration promise', async () => {
    await mountComponent(CookScheduler);
    const note = [...document.querySelectorAll('p')].find((p) => p.textContent.includes('faux-cambro'));
    expect(note, 'rest note present').toBeTruthy();
    const text = note.textContent.trim();
    expect(text).toBe(NOTE);
    expect(text).not.toMatch(/brisket|pork|shoulder|turkey|beef/i); // ribs appears only as an example of a thin cut
    expect(text).not.toMatch(PROMISES);
    expect(text).not.toMatch(/—/);
  });
});

describe('scheduler FAQ answer about rest', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'pages', 'cook-scheduler.astro'), 'utf8');
  const answer = src.match(/q: 'How long should a brisket rest before slicing\?',\s*a: '([^']*)',/)?.[1];

  it('says the same thing as the note, with no duration promise', () => {
    expect(answer, 'FAQ entry found').toBeTruthy();
    expect(answer).toContain(NOTE);
    expect(answer).not.toMatch(PROMISES);
    expect(answer).not.toMatch(/—/);
    expect(answer).not.toMatch(/\bour\b/i); // first person singular only
  });

  it('describes an hour or more as common practice, not a guarantee', () => {
    expect(answer.startsWith('Common practice is an hour or more.')).toBe(true);
  });
});
