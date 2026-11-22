// @vitest-environment happy-dom
/*
 * The "Heads up: this link was shared under Model ..." notice is for shared links. The protein tabs
 * link to /cook-scheduler?pr=<id> with no version, so a visit with only ?pr= (a tab tap or a bookmark)
 * must not show it. Real share links always carry the cook settings (pt, and w when the protein has
 * a weight), so those still do.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import CookScheduler from '../CookScheduler.astro';
import { mountComponent } from './mount.js';
import { PROTEINS } from '../../../utils/proteinRegistry.js';
import { initCookScheduler } from '../cookScheduler.controller.js';

const notice = () => document.getElementById('versionNotice');
const shown = () => !notice().classList.contains('hidden');

async function visit(search, proteinId = 'beef_brisket') {
  document.body.innerHTML = '';
  window.history.replaceState(null, '', `/cook-scheduler${search}`);
  await mountComponent(CookScheduler);
  initCookScheduler(PROTEINS[proteinId]);
}

describe('scheduler version notice', () => {
  beforeEach(() => window.history.replaceState(null, '', '/cook-scheduler'));

  for (const id of ['beef_brisket', 'pork_shoulder', 'pork_ribs']) {
    it(`a protein tab link (?pr=${id}, no other params) shows no notice`, async () => {
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
    expect(notice().textContent).toContain(`Model v${PROTEINS.pork_shoulder.meta.version}`);
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

  it('a ribs share link (pt, no weight) from an older version shows the notice', async () => {
    await visit('?pr=pork_ribs&pt=225&ct=spare', 'pork_ribs');
    expect(shown()).toBe(true);
  });
});
