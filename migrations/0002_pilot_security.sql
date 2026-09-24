CREATE TABLE IF NOT EXISTS pilot_participants (
  participant_id TEXT PRIMARY KEY,
  token_hash TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 60 CHECK (rate_limit_per_minute BETWEEN 1 AND 600),
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS pilot_rate_limits (
  participant_id TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL,
  PRIMARY KEY (participant_id, window_start)
);

CREATE TABLE IF NOT EXISTS pilot_events_v2 (
  event_id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  outcome TEXT NOT NULL,
  reason_codes TEXT NOT NULL,
  simulated_value_eligible INTEGER NOT NULL,
  duplicate INTEGER NOT NULL,
  idempotent INTEGER NOT NULL,
  simulated_amount_minor INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
