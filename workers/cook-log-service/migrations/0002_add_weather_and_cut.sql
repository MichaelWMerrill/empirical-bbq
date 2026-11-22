-- Weather context + provenance, and the cut. All columns nullable; existing rows unchanged.
--
-- ambient_temp_f and altitude_ft keep their meaning: a point value typed by the user.
-- The window columns below (min/max/avg, dew point, wind, hours missing) describe the
-- weather over the cook. weather_source says where the weather fields came from:
--   typed         the user typed ambient_temp_f and/or altitude_ft (point values only)
--   manual        the user entered an expected low/high and wind for the cook
--   nws_forecast  reserved for a later PR; no code writes it yet
-- No location of any kind is stored (no lat/lon, city, state, zip, IP or time zone).
--
-- cut has NO CHECK on purpose: the Worker validates it against the registry's cut ids
-- (server/cutIds.ts, kept in sync by a test), so adding a cut never needs a migration.

ALTER TABLE cook_sessions ADD COLUMN ambient_temp_min_f INTEGER;
ALTER TABLE cook_sessions ADD COLUMN ambient_temp_max_f INTEGER;
ALTER TABLE cook_sessions ADD COLUMN ambient_temp_avg_f REAL;
ALTER TABLE cook_sessions ADD COLUMN dew_point_avg_f REAL;
ALTER TABLE cook_sessions ADD COLUMN wind_avg_mph REAL;
ALTER TABLE cook_sessions ADD COLUMN wind_gust_max_mph REAL;
ALTER TABLE cook_sessions ADD COLUMN weather_hours_missing REAL;
ALTER TABLE cook_sessions ADD COLUMN weather_source TEXT
  CHECK (weather_source IS NULL OR weather_source IN ('typed', 'manual', 'nws_forecast'));
ALTER TABLE cook_sessions ADD COLUMN cut TEXT;

-- Backfill: a row that already has a typed ambient or altitude value was typed by the user.
-- Undo with: UPDATE cook_sessions SET weather_source = NULL WHERE weather_source = 'typed';
UPDATE cook_sessions SET weather_source = 'typed'
  WHERE weather_source IS NULL AND (ambient_temp_f IS NOT NULL OR altitude_ft IS NOT NULL);
