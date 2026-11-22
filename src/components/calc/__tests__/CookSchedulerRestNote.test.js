// @vitest-environment happy-dom
/*
 * The rest note under the "Rest Before Serving" slider is shown for every protein the scheduler
 * supports (brisket, pork shoulder, ribs), so it must not name one.
 */
import { describe, it, expect } from 'vitest';
import CookScheduler from '../CookScheduler.astro';
import { mountComponent } from './mount.js';

describe('scheduler rest note', () => {
  it('is protein-neutral and keeps the 140°F statement', async () => {
    await mountComponent(CookScheduler);
    const note = [...document.querySelectorAll('p')].find((p) => p.textContent.includes('faux-cambro'));
    expect(note, 'rest note present').toBeTruthy();
    const text = note.textContent.trim();
    expect(text).toBe('Held in a faux-cambro (foil + towels in a cooler), a rest of an hour or more keeps the meat safely above 140°F.');
    expect(text).not.toMatch(/brisket|pork|shoulder|ribs?|turkey|beef/i);
  });
});
