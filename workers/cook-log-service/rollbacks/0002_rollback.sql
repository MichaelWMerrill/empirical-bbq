-- Rollback for 0002_add_weather_and_cut.sql. Lives outside migrations/ on purpose: wrangler applies every .sql file in migrations/.
-- Run it by hand, local first:
--   npx wrangler d1 execute cook-log-db --local --file=rollbacks/0002_rollback.sql
-- Drops only the columns 0002 added. ambient_temp_f and altitude_ft are untouched.
ALTER TABLE cook_sessions DROP COLUMN cut;
ALTER TABLE cook_sessions DROP COLUMN weather_source;
ALTER TABLE cook_sessions DROP COLUMN weather_hours_missing;
ALTER TABLE cook_sessions DROP COLUMN wind_gust_max_mph;
ALTER TABLE cook_sessions DROP COLUMN wind_avg_mph;
ALTER TABLE cook_sessions DROP COLUMN dew_point_avg_f;
ALTER TABLE cook_sessions DROP COLUMN ambient_temp_avg_f;
ALTER TABLE cook_sessions DROP COLUMN ambient_temp_max_f;
ALTER TABLE cook_sessions DROP COLUMN ambient_temp_min_f;
