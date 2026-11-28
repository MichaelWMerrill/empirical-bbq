import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { ICONS, LUCIDE_VERSION } from './index.js';

const NAMES = ['sun', 'moon', 'cloud-sun', 'cloud-moon', 'cloud', 'cloud-fog', 'cloud-rain', 'cloud-snow', 'cloud-lightning', 'wind'];

describe('vendored Lucide icons', () => {
  it('exports exactly the ten weather icons', () => {
    expect(Object.keys(ICONS).sort()).toEqual([...NAMES].sort());
  });

  it('has one .svg file per icon and no strays', () => {
    const files = readdirSync(new URL('.', import.meta.url)).filter((f) => f.endsWith('.svg'));
    expect(files.sort()).toEqual(NAMES.map((n) => `${n}.svg`).sort());
  });

  it.each(NAMES)('%s keeps its license comment at the pinned version', (name) => {
    expect(ICONS[name]).toContain(`@license lucide-static v${LUCIDE_VERSION} - ISC`);
  });

  it.each(NAMES)('%s is a currentColor stroke SVG with no scripts or external references', (name) => {
    const svg = ICONS[name];
    expect(svg).toMatch(/<svg[\s>]/);
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).not.toMatch(/<script|<image|<use|href=|xlink:|on\w+=|url\(/i);
  });
});
