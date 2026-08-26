-- RADAR dry-run previews: pipeline step 3 results, one set per assessed run.
-- Applied idempotently by the dry-run job and the API server at startup.

CREATE TABLE IF NOT EXISTS dry_runs (
  run_id               BIGINT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  dry_run_at           TIMESTAMPTZ NOT NULL,
  position             INTEGER NOT NULL,
  name                 TEXT NOT NULL,
  current              TEXT NOT NULL,
  latest               TEXT NOT NULL,
  namespace            TEXT NOT NULL,
  kustomize_path       TEXT NOT NULL,
  status               TEXT NOT NULL,
  stdout               TEXT NOT NULL DEFAULT '',
  stderr               TEXT NOT NULL DEFAULT '',
  duration_ms          INTEGER NOT NULL DEFAULT 0,
  mutated_helm_version TEXT,
  details              JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (run_id, name)
);

CREATE INDEX IF NOT EXISTS dry_runs_run_id_idx ON dry_runs (run_id);
CREATE INDEX IF NOT EXISTS dry_runs_status_idx ON dry_runs (status);
