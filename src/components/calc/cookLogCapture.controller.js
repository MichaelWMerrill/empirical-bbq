/*
 * Cook-log capture UI controller. Mounted once per StallPredictor instance
 * (all four protein stall pages share that component), so this same file
 * drives the panel on /stall-predictor, /pork-shoulder-stall, /ribs-stall,
 * and /turkey-stall.
 *
 * This is the consent-only slice: opt in/out, shown once, with a small
 * non-nagging way back in after opting out. Starting a cook and in-progress
 * checkpoints land in later commits.
 */
import { getConsentState, setConsent } from '../../utils/cookLogConsent.js';

export function initCookLogCapture(proteinTypeId) {
  const $ = (id) => document.getElementById(id);
  const panels = {
    consent: $('cookLogConsentPrompt'),
    denied: $('cookLogDeniedLink'),
  };
  if (!panels.consent) return; // component not present on this page

  function showOnly(name) {
    for (const key of Object.keys(panels)) {
      if (panels[key]) panels[key].hidden = key !== name;
    }
  }

  function refresh() {
    const consentState = getConsentState();
    if (consentState === null) return showOnly('consent');
    if (consentState === 'denied') return showOnly('denied');
    // Nothing opted-in to show yet in this commit — later commits add the
    // start-cook form and checkpoints here.
    showOnly(null);
  }

  $('cookLogOptIn')?.addEventListener('click', () => {
    setConsent(true);
    refresh();
  });
  $('cookLogOptOut')?.addEventListener('click', () => {
    setConsent(false);
    refresh();
  });
  $('cookLogEnableLink')?.addEventListener('click', () => {
    setConsent(true);
    refresh();
  });

  refresh();
}
