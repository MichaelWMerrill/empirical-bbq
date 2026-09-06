/*
 * Cook-log capture UI controller. Mounted once per StallPredictor instance
 * (all four protein stall pages share that component), so this same file
 * drives the panel on /stall-predictor, /pork-shoulder-stall, /ribs-stall,
 * and /turkey-stall.
 *
 * State so far: undecided consent -> prompt; denied -> a small re-enable
 * link; granted -> start a cook. In-progress checkpoints land in the next
 * commit, and offline resilience (queue + Background Sync) in the one
 * after that.
 *
 * The active-cook record lives in IndexedDB (public/sw-queue-utils.js),
 * not localStorage, because it has to survive the app being closed
 * mid-cook.
 */
import '../../../public/sw-queue-utils.js';
import { getConsentState, setConsent, getOrCreateAnonClientId, getAnonClientId } from '../../utils/cookLogConsent.js';
import { postCookLog } from '../../utils/cookLogClient.js';

// Calculator enum -> cook-log enum. Only used to seed sensible defaults in
// the collapsed "optional details" section — never auto-submitted without
// the user seeing/being able to change it.
const PIT_TO_COOK_METHOD = {
  offset_smoker: 'offset',
  pellet_cooker: 'pellet',
  ceramic_kamado: 'kamado',
  charcoal_kettle: 'other',
};

export function initCookLogCapture(proteinTypeId, modelVersion, stallControls) {
  const $ = (id) => document.getElementById(id);
  const panels = {
    consent: $('cookLogConsentPrompt'),
    denied: $('cookLogDeniedLink'),
    start: $('cookLogStartForm'),
  };
  if (!panels.consent) return; // component not present on this page

  function showOnly(name) {
    for (const key of Object.keys(panels)) {
      if (panels[key]) panels[key].hidden = key !== name;
    }
  }

  function setStatus(message) {
    const el = $('cookLogStatus');
    if (el) el.textContent = message || '';
  }

  async function refresh() {
    const consentState = getConsentState();
    if (consentState === null) return showOnly('consent');
    if (consentState === 'denied') return showOnly('denied');

    const activeCook = await globalThis.SWQueueUtils.getActiveCook();
    if (activeCook) {
      // Checkpoint UI for an in-progress cook lands in the next commit —
      // for now, just don't re-show the start form over an active cook.
      showOnly(null);
    } else {
      showOnly('start');
    }
  }

  /* ---------- Consent ---------- */
  async function optOut() {
    setConsent(false);
    await globalThis.SWQueueUtils.clearAll();
    refresh();
  }
  $('cookLogOptIn')?.addEventListener('click', () => {
    setConsent(true);
    refresh();
  });
  $('cookLogOptOut')?.addEventListener('click', optOut);
  document.querySelectorAll('[data-cook-log-opt-out]').forEach((btn) => btn.addEventListener('click', optOut));
  $('cookLogEnableLink')?.addEventListener('click', () => {
    setConsent(true);
    refresh();
  });

  /* ---------- Start a cook ---------- */
  const optionalToggle = $('cookLogOptionalToggle');
  optionalToggle?.addEventListener('click', () => {
    const details = $('cookLogOptionalDetails');
    if (details) details.hidden = !details.hidden;
  });

  $('cookLogStartForm')?.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    const predictedMinutes = stallControls.getPredictedCookMinutes();
    if (predictedMinutes == null) return; // model hasn't rendered yet — shouldn't happen, but don't submit garbage

    const weightSource = $('cookLogWeightSource').value;
    const targetPitTemp = $('cookLogTargetPitTemp').value;
    const cookMethod = $('cookLogCookMethod').value;
    const ambientTemp = $('cookLogAmbientTemp').value;
    const altitude = $('cookLogAltitude').value;

    const payload = {
      anon_client_id: getOrCreateAnonClientId() || getAnonClientId(),
      protein_type: proteinTypeId,
      model_version: modelVersion,
      weight_lb: stallControls.state.weight,
      weight_source: weightSource,
      predicted_cook_minutes: predictedMinutes,
      consented_at: new Date().toISOString(),
      start_time: new Date().toISOString(),
      ...(cookMethod && { cook_method: cookMethod }),
      ...(targetPitTemp && { target_pit_temp_f: parseInt(targetPitTemp, 10) }),
      ...(ambientTemp && { ambient_temp_f: parseInt(ambientTemp, 10) }),
      ...(altitude && { altitude_ft: parseInt(altitude, 10) }),
    };

    setStatus('Starting…');
    const result = await postCookLog(payload);
    if (!result.ok) {
      setStatus('Could not start tracking (please try again).');
      return;
    }
    await globalThis.SWQueueUtils.setActiveCook({ id: result.data.id, proteinType: proteinTypeId, startedAt: payload.start_time });
    setStatus('');
    refresh();
  });

  /* ---------- Optional-details defaults (seeded, never auto-submitted) ---------- */
  const pitTempInput = $('cookLogTargetPitTemp');
  if (pitTempInput && stallControls.state.pitTemp) pitTempInput.value = stallControls.state.pitTemp;
  const cookMethodSelect = $('cookLogCookMethod');
  if (cookMethodSelect && PIT_TO_COOK_METHOD[stallControls.state.pit]) {
    cookMethodSelect.value = PIT_TO_COOK_METHOD[stallControls.state.pit];
  }

  refresh();
}
