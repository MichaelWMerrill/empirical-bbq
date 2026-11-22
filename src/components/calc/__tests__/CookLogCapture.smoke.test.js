// @vitest-environment happy-dom
/*
 * DOM smoke test for the cook-log capture panel: mount the markup, drive the
 * controller through consent -> start a cook -> checkpoint -> finish -> done,
 * and assert the right network calls and DOM state at each step. Every
 * other calc component has a smoke test in this style; this one didn't,
 * despite being the most stateful of the bunch.
 *
 * globalThis.SWQueueUtils is replaced with an in-memory fake (real
 * IndexedDB isn't available under happy-dom) — this only exercises
 * cookLogCapture.controller.js's own state machine, not the real
 * IndexedDB adapter (covered separately in swQueueUtils.spec.js) or the
 * offline-queue reconciliation logic (covered in
 * swQueueUtils.spec.js's createDefaultSendFn suite).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import CookLogCapture from '../CookLogCapture.astro';
import { PROTEINS } from '../../../utils/proteinRegistry.js';
import { mountComponent } from './mount.js';
import { initCookLogCapture } from '../cookLogCapture.controller.js';

function makeFakeSWQueueUtils() {
  let activeCook;
  return {
    getActiveCook: () => Promise.resolve(activeCook),
    setActiveCook: (cook) => {
      activeCook = cook;
      return Promise.resolve();
    },
    clearActiveCook: () => {
      activeCook = undefined;
      return Promise.resolve();
    },
    clearAll: () => {
      activeCook = undefined;
      return Promise.resolve();
    },
    createIndexedDbQueueStorage: () => ({ getAll: () => Promise.resolve([]) }),
  };
}

const fakeStallControls = {
  state: { weight: 12, pitTemp: '225', pit: 'offset_smoker', wrap: 'peach_butcher_paper' },
  getPredictedCookMinutes: () => 600,
};

const mount = () => mountComponent(CookLogCapture);

// Flush the microtask queue so the controller's async refresh()/handlers settle.
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('CookLogCapture smoke', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    vi.stubGlobal('SWQueueUtils', makeFakeSWQueueUtils());
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the consent prompt first, with no other panel visible', async () => {
    await mount();
    initCookLogCapture('beef_brisket', '2026.3', fakeStallControls);
    await tick();

    expect(document.getElementById('cookLogConsentPrompt').hidden).toBe(false);
    expect(document.getElementById('cookLogStartForm').hidden).toBe(true);
    expect(document.getElementById('cookLogCheckpoints').hidden).toBe(true);
  });

  it('opting in reveals the start form and generates an anon_client_id', async () => {
    await mount();
    initCookLogCapture('beef_brisket', '2026.3', fakeStallControls);
    await tick();

    document.getElementById('cookLogOptIn').click();
    await tick();

    expect(document.getElementById('cookLogStartForm').hidden).toBe(false);
    expect(localStorage.getItem('pitmaster_cook_log_client_id')).toBeTruthy();
  });

  it('starting a cook POSTs the calculator-sourced payload and shows checkpoints', async () => {
    await mount();
    fetch.mockResolvedValue({ ok: true, status: 201, json: () => Promise.resolve({ id: 'server-id-1' }) });
    initCookLogCapture('beef_brisket', '2026.3', fakeStallControls);
    await tick();
    document.getElementById('cookLogOptIn').click();
    await tick();

    document.getElementById('cookLogWeightSource').value = 'scale';
    document.getElementById('cookLogStartForm').dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();

    expect(fetch).toHaveBeenCalledWith('/api/cook-logs', expect.objectContaining({ method: 'POST' }));
    const [, options] = fetch.mock.calls[0];
    const payload = JSON.parse(options.body);
    expect(payload.protein_type).toBe('beef_brisket');
    expect(payload.model_version).toBe('2026.3');
    expect(payload.weight_lb).toBe(12); // read from stallControls.state, not re-asked
    expect(payload.predicted_cook_minutes).toBe(600); // read from getPredictedCookMinutes(), not recomputed
    expect(payload.weight_source).toBe('scale');

    expect(document.getElementById('cookLogCheckpoints').hidden).toBe(false);
    expect(document.getElementById('cookLogStartForm').hidden).toBe(true);
  });

  it('marking wrapped PATCHes the wrap_method mapped from the calculator wrap state', async () => {
    await mount();
    fetch.mockResolvedValue({ ok: true, status: 201, json: () => Promise.resolve({ id: 'server-id-1' }) });
    initCookLogCapture('beef_brisket', '2026.3', fakeStallControls);
    await tick();
    document.getElementById('cookLogOptIn').click();
    await tick();
    document.getElementById('cookLogStartForm').dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();

    fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
    document.getElementById('cookLogMarkWrapped').click();
    await tick();

    const patchCall = fetch.mock.calls.find(([url]) => url === '/api/cook-logs/server-id-1');
    expect(patchCall).toBeTruthy();
    const patchBody = JSON.parse(patchCall[1].body);
    expect(patchBody.wrap_method).toBe('butcher_paper'); // mapped from 'peach_butcher_paper'
    expect(patchCall[1].method).toBe('PATCH');
    // Regression: the server rejects any PATCH missing anon_client_id (400
    // "anon_client_id is required."), so every checkpoint update has to send
    // it — every checkpoint button/form goes through patchActiveCook(), so
    // this one call site covers all of them.
    expect(patchBody.anon_client_id).toBe(localStorage.getItem('pitmaster_cook_log_client_id'));
  });

  it('marking finished reveals the rest section; "done tracking" returns to the start form', async () => {
    await mount();
    fetch.mockResolvedValue({ ok: true, status: 201, json: () => Promise.resolve({ id: 'server-id-1' }) });
    initCookLogCapture('beef_brisket', '2026.3', fakeStallControls);
    await tick();
    document.getElementById('cookLogOptIn').click();
    await tick();
    document.getElementById('cookLogStartForm').dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();

    fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
    document.getElementById('cookLogFinalTemp').value = '203';
    document.getElementById('cookLogFinishForm').dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();

    expect(document.getElementById('cookLogRestSection').hidden).toBe(false);

    document.getElementById('cookLogDoneTracking').click();
    await tick();

    expect(document.getElementById('cookLogStartForm').hidden).toBe(false);
    expect(document.getElementById('cookLogCheckpoints').hidden).toBe(true);
  });

  it('opting out clears the anon_client_id and shows the re-enable link', async () => {
    await mount();
    initCookLogCapture('beef_brisket', '2026.3', fakeStallControls);
    await tick();
    document.getElementById('cookLogOptIn').click();
    await tick();
    expect(localStorage.getItem('pitmaster_cook_log_client_id')).toBeTruthy();

    document.getElementById('cookLogOptOut').click();
    await tick();

    expect(localStorage.getItem('pitmaster_cook_log_client_id')).toBeNull();
    expect(document.getElementById('cookLogDeniedLink').hidden).toBe(false);
    expect(document.getElementById('cookLogStartForm').hidden).toBe(true);
  });

  describe('weather fields and cut', () => {
    const startCook = async (proteinId, stallControls = fakeStallControls, fill = () => {}) => {
      await mountComponent(CookLogCapture, { protein: PROTEINS[proteinId] });
      fetch.mockResolvedValue({ ok: true, status: 201, json: () => Promise.resolve({ id: 'server-id-1' }) });
      initCookLogCapture(proteinId, '2026.3', stallControls);
      await tick();
      document.getElementById('cookLogOptIn').click();
      await tick();
      fill();
      document.getElementById('cookLogStartForm').dispatchEvent(new Event('submit', { cancelable: true }));
      await tick();
      const call = fetch.mock.calls.find(([url, o]) => url === '/api/cook-logs' && o.method === 'POST');
      return call ? JSON.parse(call[1].body) : null;
    };
    const set = (id, v) => (document.getElementById(id).value = v);

    it('typed ambient and altitude keep their meaning and set weather_source typed', async () => {
      const payload = await startCook('beef_brisket', fakeStallControls, () => {
        set('cookLogAmbientTemp', '71');
        set('cookLogAltitude', '5200');
      });
      expect(payload).toMatchObject({ ambient_temp_f: 71, altitude_ft: 5200, weather_source: 'typed' });
      expect(payload).not.toHaveProperty('ambient_temp_avg_f');
      expect(payload).not.toHaveProperty('cut');
    });

    it('a manual low/high/wind sends min, max, the midpoint and source manual', async () => {
      const payload = await startCook('beef_brisket', fakeStallControls, () => {
        set('cookLogTempLow', '38');
        set('cookLogTempHigh', '62');
        set('cookLogWind', '8');
      });
      expect(payload).toMatchObject({ ambient_temp_min_f: 38, ambient_temp_max_f: 62, ambient_temp_avg_f: 50, wind_avg_mph: 8, weather_source: 'manual' });
      expect(payload).not.toHaveProperty('ambient_temp_f');
    });

    it('sends no weather fields and no source when none were entered, and never any location', async () => {
      const payload = await startCook('beef_brisket');
      expect(payload).not.toHaveProperty('weather_source');
      for (const k of Object.keys(payload)) expect(k).not.toMatch(/lat|lon|city|state|zip|location|zone|postal/i);
    });

    it('a low above the high stops the submit with a message and opens the details', async () => {
      const payload = await startCook('beef_brisket', fakeStallControls, () => {
        set('cookLogTempLow', '70');
        set('cookLogTempHigh', '60');
      });
      expect(payload).toBeNull();
      expect(document.getElementById('cookLogStatus').textContent).toMatch(/low/i);
      expect(document.getElementById('cookLogOptionalDetails').hidden).toBe(false);
    });

    it('brisket and turkey have no Cut control; pork shoulder and ribs build it from the registry', async () => {
      for (const id of ['beef_brisket', 'turkey']) {
        await mountComponent(CookLogCapture, { protein: PROTEINS[id] });
        expect(document.getElementById('cookLogCut'), id).toBeNull();
      }
      await mountComponent(CookLogCapture, { protein: PROTEINS.pork_shoulder });
      expect([...document.getElementById('cookLogCut').options].map((o) => o.value)).toEqual(['', 'bone_in', 'boneless']);
      await mountComponent(CookLogCapture, { protein: PROTEINS.pork_ribs });
      expect([...document.getElementById('cookLogCut').options].map((o) => o.value)).toEqual(['', 'spare', 'st_louis', 'baby_back']);
    });

    it('ribs seed the cut from the calculator and send it; pork shoulder sends the chosen cut', async () => {
      const ribs = await startCook('pork_ribs', { ...fakeStallControls, state: { ...fakeStallControls.state, weight: 3, cut: 'st_louis' } });
      expect(ribs.cut).toBe('st_louis');
      fetch.mockReset();
      const shoulder = await startCook('pork_shoulder', fakeStallControls, () => set('cookLogCut', 'boneless'));
      expect(shoulder.cut).toBe('boneless');
      fetch.mockReset();
      const none = await startCook('pork_shoulder');
      expect(none).not.toHaveProperty('cut');
    });
  });
});
