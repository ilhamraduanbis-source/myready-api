CREATE TABLE IF NOT EXISTS sandbox_tokens (
  token_id TEXT PRIMARY KEY,
  token_hash TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  is_internal INTEGER NOT NULL DEFAULT 0 CHECK (is_internal IN (0, 1)),
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 30 CHECK (rate_limit_per_minute BETWEEN 1 AND 120),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS sandbox_rate_limits (
  token_id TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL,
  PRIMARY KEY (token_id, window_start)
);

CREATE TABLE IF NOT EXISTS sandbox_events (
  event_id TEXT PRIMARY KEY,
  token_id TEXT NOT NULL,
  is_internal INTEGER NOT NULL CHECK (is_internal IN (0, 1)),
  endpoint TEXT NOT NULL,
  outcome TEXT NOT NULL,
  qualified INTEGER NOT NULL CHECK (qualified IN (0, 1)),
  duplicate INTEGER NOT NULL CHECK (duplicate IN (0, 1)),
  noise INTEGER NOT NULL CHECK (noise IN (0, 1)),
  request_fingerprint TEXT NOT NULL,
  field_count INTEGER NOT NULL,
  has_address INTEGER NOT NULL CHECK (has_address IN (0, 1)),
  has_postcode INTEGER NOT NULL CHECK (has_postcode IN (0, 1)),
  meaningful_normalisation INTEGER NOT NULL CHECK (meaningful_normalisation IN (0, 1)),
  ambiguity INTEGER NOT NULL CHECK (ambiguity IN (0, 1)),
  conflict INTEGER NOT NULL CHECK (conflict IN (0, 1)),
  error_category TEXT,
  dataset_version TEXT NOT NULL,
  latency_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sandbox_events_token_time ON sandbox_events(token_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sandbox_events_qualified ON sandbox_events(qualified, is_internal, created_at);
CREATE TABLE IF NOT EXISTS sandbox_settings (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sandbox_access_limits (
  source_hash TEXT NOT NULL,
  day_bucket TEXT NOT NULL,
  issue_count INTEGER NOT NULL,
  PRIMARY KEY (source_hash, day_bucket)
);
