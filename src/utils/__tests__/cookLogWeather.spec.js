import { describe, it, expect } from 'vitest';
import { buildWeatherFields } from '../cookLogWeather.js';

describe('buildWeatherFields', () => {
  it('sends nothing, and no source, when nothing was entered', () => {
    expect(buildWeatherFields({})).toEqual({ fields: {} });
    expect(buildWeatherFields({ ambient: '', altitude: '', low: '', high: '', wind: '' })).toEqual({ fields: {} });
  });

  it('typed point values keep ambient_temp_f as a point value and set source typed', () => {
    expect(buildWeatherFields({ ambient: '71', altitude: '5200' })).toEqual({
      fields: { ambient_temp_f: 71, altitude_ft: 5200, weather_source: 'typed' },
    });
    expect(buildWeatherFields({ altitude: '800' }).fields).toEqual({ altitude_ft: 800, weather_source: 'typed' });
  });

  it('a manual low and high set min, max, the midpoint average, and source manual (never touching ambient_temp_f)', () => {
    const { fields } = buildWeatherFields({ low: '38', high: '61', wind: '8' });
    expect(fields).toEqual({ ambient_temp_min_f: 38, ambient_temp_max_f: 61, ambient_temp_avg_f: 49.5, wind_avg_mph: 8, weather_source: 'manual' });
    expect(fields).not.toHaveProperty('ambient_temp_f');
  });

  it('wind alone is a manual entry', () => {
    expect(buildWeatherFields({ wind: '12' }).fields).toEqual({ wind_avg_mph: 12, weather_source: 'manual' });
  });

  it('typed and manual together: both kinds of value are sent, the source is manual', () => {
    const { fields } = buildWeatherFields({ ambient: '70', low: '60', high: '80' });
    expect(fields).toMatchObject({ ambient_temp_f: 70, ambient_temp_avg_f: 70, weather_source: 'manual' });
  });

  it('never produces the forecast-only fields or the forecast source', () => {
    const { fields } = buildWeatherFields({ ambient: '70', altitude: '100', low: '60', high: '80', wind: '5' });
    for (const k of ['dew_point_avg_f', 'wind_gust_max_mph', 'weather_hours_missing']) expect(fields).not.toHaveProperty(k);
    expect(fields.weather_source).not.toBe('nws_forecast');
  });

  it('rejects a low above the high, a lone low or high, negative wind and non-numbers, with a message', () => {
    expect(buildWeatherFields({ low: '70', high: '60' }).error).toMatch(/low/);
    expect(buildWeatherFields({ low: '60' }).error).toMatch(/both/);
    expect(buildWeatherFields({ high: '60' }).error).toMatch(/both/);
    expect(buildWeatherFields({ wind: '-3' }).error).toMatch(/negative/);
    expect(buildWeatherFields({ ambient: 'abc' }).error).toMatch(/numbers/);
    expect(buildWeatherFields({ low: '70', high: '60' }).fields).toEqual({});
  });
});
