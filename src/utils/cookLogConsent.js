/*
 * Consent + anonymous client identity for the cook-log capture UI.
 *
 * Off by default. `anon_client_id` is only ever generated on opt-in, is
 * client-generated (crypto.randomUUID()), lives in localStorage, and is
 * never tied to an account or device identifier. Opt-out wipes it and
 * everything queued locally (see cookLogQueue.js's clearAll(), called from
 * clearCookLogData() below).
 */
const CONSENT_KEY = 'pitmaster_cook_log_consent'; // 'granted' | 'denied' | absent (undecided)
const CLIENT_ID_KEY = 'pitmaster_cook_log_client_id';

export function getConsentState() {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === 'granted' || v === 'denied' ? v : null;
  } catch {
    return null;
  }
}

export function hasConsent() {
  return getConsentState() === 'granted';
}

export function setConsent(granted) {
  try {
    localStorage.setItem(CONSENT_KEY, granted ? 'granted' : 'denied');
    if (granted) {
      getOrCreateAnonClientId();
    } else {
      localStorage.removeItem(CLIENT_ID_KEY);
    }
  } catch {
    /* storage unavailable — consent simply won't persist across reloads */
  }
}

export function getOrCreateAnonClientId() {
  try {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

export function getAnonClientId() {
  try {
    return localStorage.getItem(CLIENT_ID_KEY);
  } catch {
    return null;
  }
}

/** Opt-out: stop all writes and forget the anon id (queue clearing is the caller's job — see cookLogCapture.controller.js). */
export function revokeConsent() {
  setConsent(false);
}
