import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/*
 * The serve-time input (<input type="datetime-local" id="serveAt">) overflowed its card on iOS
 * Safari, which gives that control an intrinsic width. The fix is CSS, so this pins the rules in the
 * component source: it cannot render iOS Safari, but it stops the fix from being dropped by accident.
 */
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'CookScheduler.astro'), 'utf8')
  .split('<style is:global>')[1]
  .split('</style>')[0];

const block = (selectorStart) => {
  const i = css.indexOf(selectorStart);
  expect(i, `${selectorStart} rule exists`).toBeGreaterThan(-1);
  return css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
};

describe('serveAt layout (iOS Safari overflow)', () => {
  test('lets the input shrink inside its card on every browser', () => {
    const rule = block('body.page-scheduler #serveAt {');
    expect(rule).toMatch(/display:\s*block/);
    expect(rule).toMatch(/min-width:\s*0/);
    expect(rule).toMatch(/max-width:\s*100%/);
    expect(rule).toMatch(/box-sizing:\s*border-box/);
  });

  test('on iOS Safari only, drops the native appearance and left-aligns the value', () => {
    const at = css.indexOf('@supports (-webkit-touch-callout: none)');
    expect(at).toBeGreaterThan(-1);
    const ios = css.slice(at, css.indexOf('\n  body.page-scheduler input[type=', at));
    expect(ios).toMatch(/-webkit-appearance:\s*none/);
    expect(ios).toMatch(/text-align:\s*left/);
    expect(ios).toMatch(/min-height:\s*2\.75rem/); // 44px target
    expect(ios).toMatch(/#serveAt::-webkit-date-and-time-value/);
  });

  test('the input still spans its card and is still a datetime-local control', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'CookScheduler.astro'), 'utf8');
    const tag = src.match(/<input id="serveAt"[^>]*>/)[0];
    expect(tag).toMatch(/type="datetime-local"/);
    expect(tag).toMatch(/\bw-full\b/);
  });
});
