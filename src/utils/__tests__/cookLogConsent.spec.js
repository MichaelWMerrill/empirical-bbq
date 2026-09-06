// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getConsentState,
  hasConsent,
  setConsent,
  getAnonClientId,
  getOrCreateAnonClientId,
  revokeConsent,
} from '../cookLogConsent.js';

beforeEach(() => {
  localStorage.clear();
});

describe('getConsentState / hasConsent', () => {
  it('is undecided (null) before any choice is made', () => {
    expect(getConsentState()).toBeNull();
    expect(hasConsent()).toBe(false);
  });
});

describe('setConsent(true)', () => {
  it('grants consent and generates an anon_client_id', () => {
    setConsent(true);
    expect(hasConsent()).toBe(true);
    const id = getAnonClientId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('keeps the same anon_client_id across repeated opt-ins', () => {
    setConsent(true);
    const first = getAnonClientId();
    setConsent(true);
    expect(getAnonClientId()).toBe(first);
  });
});

describe('setConsent(false) / revokeConsent', () => {
  it('denies consent and clears the anon_client_id', () => {
    setConsent(true);
    expect(getAnonClientId()).not.toBeNull();

    setConsent(false);
    expect(hasConsent()).toBe(false);
    expect(getConsentState()).toBe('denied');
    expect(getAnonClientId()).toBeNull();
  });

  it('revokeConsent() is equivalent to setConsent(false)', () => {
    setConsent(true);
    revokeConsent();
    expect(hasConsent()).toBe(false);
    expect(getAnonClientId()).toBeNull();
  });

  it('opting back in after opting out generates a fresh anon_client_id', () => {
    setConsent(true);
    const first = getAnonClientId();
    setConsent(false);
    setConsent(true);
    expect(getAnonClientId()).not.toBe(first);
  });
});

describe('getOrCreateAnonClientId', () => {
  it('creates an id even without going through setConsent', () => {
    expect(getAnonClientId()).toBeNull();
    const id = getOrCreateAnonClientId();
    expect(id).not.toBeNull();
    expect(getAnonClientId()).toBe(id);
  });
});
