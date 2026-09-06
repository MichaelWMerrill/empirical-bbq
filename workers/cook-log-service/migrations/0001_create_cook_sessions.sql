-- cook_sessions: anonymized, opt-in cook data from PWA users.
-- No PII: anon_client_id is a client-generated crypto.randomUUID(), never
-- tied to an account, device identifier, or precise location.

CREATE TABLE cook_sessions (
  id TEXT PRIMARY KEY,
  anon_client_id TEXT NOT NULL,
  protein_type TEXT NOT NULL
    CHECK (protein_type IN ('beef_brisket', 'pork_shoulder', 'pork_ribs', 'turkey')),
  model_version TEXT NOT NULL,
  weight_lb REAL NOT NULL,
  weight_source TEXT NOT NULL
    CHECK (weight_source IN ('scale', 'estimated')),
  cook_method TEXT
    CHECK (cook_method IS NULL OR cook_method IN ('offset', 'pellet', 'kamado', 'oven', 'other')),
  target_pit_temp_f INTEGER,
  ambient_temp_f INTEGER,
  altitude_ft INTEGER,
  start_time TEXT NOT NULL,
  wrap_time TEXT,
  wrap_method TEXT
    CHECK (wrap_method IS NULL OR wrap_method IN ('unwrapped', 'foil', 'butcher_paper')),
  stall_start_time TEXT,
  stall_end_time TEXT,
  finish_time TEXT,
  final_internal_temp_f INTEGER,
  rest_minutes INTEGER,
  predicted_cook_minutes INTEGER NOT NULL,
  consented_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Supports the read-side aggregation (scripts/cook-log-report.mjs): grouping
-- by protein_type + model_version to compare predicted vs. actual cook time
-- per calculator version.
CREATE INDEX idx_cook_sessions_protein_model ON cook_sessions (protein_type, model_version);

-- Supports the write-path rate limit (count recent writes per anon_client_id).
CREATE INDEX idx_cook_sessions_client_created ON cook_sessions (anon_client_id, created_at);
