-- RADAR assessments: step-2 breaking-change risk results, one set per inventory run.
-- Applied idempotently by the assess job and the API server at startup.

CREATE TABLE IF NOT EXISTS assessments (
  run_id      BIGINT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  assessed_at TIMESTAMPTZ NOT NULL,
  position    INTEGER NOT NULL,
  name        TEXT NOT NULL,
  current     TEXT NOT NULL,
  latest      TEXT NOT NULL,
  risk_level  TEXT NOT NULL,
  reason      TEXT NOT NULL,
  action      TEXT NOT NULL,
  layer       TEXT NOT NULL,
  details     JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (run_id, name)
);

CREATE INDEX IF NOT EXISTS assessments_run_id_idx ON assessments (run_id);
