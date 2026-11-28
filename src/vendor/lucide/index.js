/*
 * Lucide weather icons, vendored as static SVG files. No runtime dependency
 * and no CDN: Vite inlines each file as a string at build time (`?raw`).
 *
 * Source:  lucide-static@1.72.0 (npm), https://lucide.dev
 * License: ISC. `moon` also carries the Feather MIT notice. Both license texts
 *          are in THIRD_PARTY_NOTICES.md at the repo root.
 *
 * The .svg files are unmodified copies and keep their own license comment.
 * They draw with stroke="currentColor", so the surrounding text color applies.
 * To upgrade: replace the files from the new lucide-static release and update
 * LUCIDE_VERSION here, the version in THIRD_PARTY_NOTICES.md, and the spec.
 */
import sun from './sun.svg?raw';
import moon from './moon.svg?raw';
import cloudSun from './cloud-sun.svg?raw';
import cloudMoon from './cloud-moon.svg?raw';
import cloud from './cloud.svg?raw';
import cloudFog from './cloud-fog.svg?raw';
import cloudRain from './cloud-rain.svg?raw';
import cloudSnow from './cloud-snow.svg?raw';
import cloudLightning from './cloud-lightning.svg?raw';
import wind from './wind.svg?raw';

export const LUCIDE_VERSION = '1.72.0';

/** Icon name (the Lucide name) -> raw SVG markup. */
export const ICONS = {
  sun,
  moon,
  'cloud-sun': cloudSun,
  'cloud-moon': cloudMoon,
  cloud,
  'cloud-fog': cloudFog,
  'cloud-rain': cloudRain,
  'cloud-snow': cloudSnow,
  'cloud-lightning': cloudLightning,
  wind,
};
