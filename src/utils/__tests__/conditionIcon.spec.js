import { describe, it, expect } from 'vitest';
import { conditionIcon, precipPercent, PRECIP_MIN_PCT } from '../conditionIcon.js';
import { ICONS } from '../../vendor/lucide/index.js';

const D = true; // daytime
const N = false; // night

// [shortForecast, isDaytime, expected icon key]. Strings are real NWS shortForecast values.
const TABLE = [
  // 1. thunder beats everything below it
  ['Thunderstorms', D, 'cloud-lightning'],
  ['Slight Chance Thunderstorms', N, 'cloud-lightning'],
  ['Showers And Thunderstorms', D, 'cloud-lightning'],
  ['Chance Showers And Thunderstorms then Mostly Clear', N, 'cloud-lightning'],
  // 2. snow family (freezing rain and drizzle count, plain "freezing" does not)
  ['Chance Light Snow', D, 'cloud-snow'],
  ['Snow Showers', N, 'cloud-snow'],
  ['Flurries', D, 'cloud-snow'],
  ['Sleet', D, 'cloud-snow'],
  ['Freezing Rain', N, 'cloud-snow'],
  ['Freezing Drizzle', D, 'cloud-snow'],
  ['Light Rain And Snow', D, 'cloud-snow'],
  // 3. rain
  ['Slight Chance Rain Showers then Partly Cloudy', D, 'cloud-rain'],
  ['Light Rain', N, 'cloud-rain'],
  ['Scattered Showers', D, 'cloud-rain'],
  ['Drizzle', D, 'cloud-rain'],
  // 4. fog, haze, smoke
  ['Patchy Fog', D, 'cloud-fog'],
  ['Freezing Fog', N, 'cloud-fog'],
  ['Areas Of Haze', D, 'cloud-fog'],
  ['Smoke', D, 'cloud-fog'],
  // 5. partly, mostly sunny, mostly clear: cloud-sun by day, cloud-moon by night
  ['Partly Cloudy', D, 'cloud-sun'],
  ['Partly Cloudy', N, 'cloud-moon'],
  ['Partly Sunny', D, 'cloud-sun'],
  ['Mostly Sunny', D, 'cloud-sun'],
  ['Mostly Clear', N, 'cloud-moon'],
  ['Mostly Clear', D, 'cloud-sun'],
  // 6. cloudy, overcast: same by day and night
  ['Mostly Cloudy', D, 'cloud'],
  ['Mostly Cloudy', N, 'cloud'],
  ['Cloudy', D, 'cloud'],
  ['Overcast', N, 'cloud'],
  // 7. sunny, clear: sun by day, moon by night
  ['Sunny', D, 'sun'],
  ['Clear', N, 'moon'],
  ['Clear', D, 'sun'],
  ['Sunny and Breezy', D, 'sun'],
  // 8. wind, only when nothing above matched
  ['Windy', D, 'wind'],
  ['Windy', N, 'wind'],
  ['Breezy', D, 'wind'],
  ['Blustery', N, 'wind'],
  ['Mostly Cloudy and Breezy', D, 'cloud'],
  // case and spacing do not matter
  ['SUNNY', D, 'sun'],
  ['  mostly clear ', N, 'cloud-moon'],
  // no match: the tile renders without an icon
  ['', D, null],
  ['   ', D, null],
  ['Wintry Mix', D, null],
  ['Dust Storm', N, null],
  ['Police Activity', D, null], // "ice" inside a word does not match
  // unknown time of day: only the day/night rules give up
  ['Mostly Clear', null, null],
  ['Mostly Clear', undefined, null],
  ['Partly Cloudy', null, null],
  ['Sunny', undefined, null],
  ['Clear', null, null],
  ['Cloudy', null, 'cloud'],
  ['Thunderstorms', undefined, 'cloud-lightning'],
  ['Patchy Fog', null, 'cloud-fog'],
  ['Windy', null, 'wind'],
];

describe('conditionIcon', () => {
  it.each(TABLE)('%j (isDaytime %j) -> %j', (forecast, isDaytime, expected) => {
    expect(conditionIcon(forecast, isDaytime)).toBe(expected);
  });

  it('returns null for a non-string forecast', () => {
    for (const bad of [null, undefined, 42, {}, ['Sunny']]) expect(conditionIcon(bad, true)).toBeNull();
  });

  it('only ever returns a key that has a vendored icon', () => {
    const keys = new Set(TABLE.map(([f, d]) => conditionIcon(f, d)).filter(Boolean));
    expect(keys.size).toBe(Object.keys(ICONS).length); // the table exercises all ten
    for (const key of keys) expect(ICONS).toHaveProperty(key);
  });
});

describe('precipPercent', () => {
  it('hides anything under the threshold', () => {
    expect(PRECIP_MIN_PCT).toBe(20);
    for (const v of [0, 1, 10, 19, 19.9]) expect(precipPercent(v)).toBeNull();
  });

  it('shows 20 and up as a whole percent', () => {
    expect(precipPercent(20)).toBe(20);
    expect(precipPercent(40)).toBe(40);
    expect(precipPercent(55.4)).toBe(55);
    expect(precipPercent(100)).toBe(100);
  });

  it('treats null, undefined and non-numbers as hidden', () => {
    for (const v of [null, undefined, NaN, Infinity, '40', {}]) expect(precipPercent(v)).toBeNull();
  });
});
