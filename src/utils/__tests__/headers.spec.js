import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/*
 * Guards the two response headers the cook conditions card depends on, in
 * public/_headers: the Content-Security-Policy connect-src allowance for the
 * National Weather Service API, and the Permissions-Policy geolocation token.
 */
const file = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'public', '_headers');
const lines = readFileSync(file, 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

const headerValue = (name) => {
  const l = lines.find((x) => x.toLowerCase().startsWith(name.toLowerCase() + ':'));
  return l ? l.slice(name.length + 1).trim() : null;
};

const csp = Object.fromEntries(
  (headerValue('Content-Security-Policy') ?? '')
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const [name, ...tokens] = d.split(/\s+/);
      return [name, tokens];
    })
);

describe('Content-Security-Policy', () => {
  test('connect-src allows the exact NWS host, once', () => {
    expect(csp['connect-src'].filter((t) => t === 'https://api.weather.gov')).toHaveLength(1);
  });

  test('no other directive mentions weather.gov', () => {
    for (const [name, tokens] of Object.entries(csp)) {
      if (name === 'connect-src') continue;
      expect(tokens.join(' '), name).not.toMatch(/weather\.gov/);
    }
  });

  test('no wildcard was added for weather.gov and connect-src gained no blanket source', () => {
    const cs = csp['connect-src'];
    expect(cs.some((t) => /\*\.?weather\.gov/.test(t))).toBe(false);
    for (const blanket of ['*', 'https:', 'http:', 'https://*', 'data:', 'blob:']) expect(cs).not.toContain(blanket);
  });

  test('the policy is still enforced, not report-only', () => {
    expect(headerValue('Content-Security-Policy')).toBeTruthy();
    expect(headerValue('Content-Security-Policy-Report-Only')).toBeNull();
  });
});

describe('Permissions-Policy', () => {
  const pp = Object.fromEntries(
    (headerValue('Permissions-Policy') ?? '').split(',').map((e) => {
      const [k, v] = e.trim().split('=');
      return [k, v];
    })
  );

  test('geolocation is limited to this origin', () => {
    expect(pp.geolocation).toBe('(self)');
  });

  test('every other entry is unchanged', () => {
    expect(pp).toEqual({ geolocation: '(self)', microphone: '()', camera: '()', 'interest-cohort': '()' });
  });
});
