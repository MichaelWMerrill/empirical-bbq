// @vitest-environment happy-dom
/*
 * Same rule as the scheduler (see CookSchedulerVersionNotice.test.js): the "Heads up: this link was
 * shared under Model ..." notice is for shared links only. A visit with just ?pr= is not a shared
 * link, so it must never warn. Nothing links to the predictor with ?pr= today; this keeps the bug from
 * coming back if that page ever gets such links (for example protein tabs like the scheduler's).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import StallPredictor from '../StallPredictor.astro';
import { mountComponent } from './mount.js';
import { PROTEINS } from '../../../utils/proteinRegistry.js';
import { initStallPredictor } from '../stallPredictor.controller.js';

const notice = () => document.getElementById('versionNotice');
const shown = () => !notice().classList.contains('hidden');

async function visit(search, proteinId = 'beef_brisket') {
  document.body.innerHTML = '';
  window.history.replaceState(null, '', `/stall-predictor${search}`);
  await mountComponent(StallPredictor, { protein: PROTEINS[proteinId] });
  initStallPredictor(PROTEINS[proteinId]);
}

describe('stall predictor version notice', () => {
  beforeEach(() => window.history.replaceState(null, '', '/stall-predictor'));

  for (const id of ['beef_brisket', 'pork_shoulder', 'pork_ribs']) {
    it(`a ?pr=${id} visit with no other params shows no notice`, async () => {
      await visit(`?pr=${id}`, id);
      expect(shown()).toBe(false);
    });
  }

  it('a plain visit shows no notice', async () => {
    await visit('');
    expect(shown()).toBe(false);
  });

  it('unrelated query params (for example campaign tags) show no notice', async () => {
    await visit('?utm_source=newsletter&pr=pork_shoulder', 'pork_shoulder');
    expect(shown()).toBe(false);
  });

  it('a real share link made under an older model (pt and w, no v) shows the notice', async () => {
    await visit('?pr=pork_shoulder&pt=225&w=9', 'pork_shoulder');
    expect(shown()).toBe(true);
    expect(notice().textContent).toContain('Model v2026.1 or earlier');
  });

  it('a share link carrying a different version names it', async () => {
    await visit('?pr=beef_brisket&pt=250&w=12&v=2026.1');
    expect(shown()).toBe(true);
    expect(notice().textContent).toContain('Model v2026.1');
  });

  it('a share link from the current version shows no notice', async () => {
    await visit(`?pr=beef_brisket&pt=250&w=12&v=${PROTEINS.beef_brisket.meta.version}`);
    expect(shown()).toBe(false);
  });
});
