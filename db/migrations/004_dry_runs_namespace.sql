-- RADAR dry-run previews are now namespace-level records, not per-component.
-- Each row captures every component whose chart version was bumped in that
-- namespace dry-run.

DROP TABLE IF EXISTS dry_runs;

CREATE TABLE dry_runs (
  run_id               BIGINT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  dry_run_at           TIMESTAMPTZ NOT NULL,
  position             INTEGER NOT NULL,
  namespace            TEXT NOT NULL,
  components           JSONB NOT NULL DEFAULT '[]',
  status               TEXT NOT NULL,
  stdout               TEXT NOT NULL DEFAULT '',
  stderr               TEXT NOT NULL DEFAULT '',
  duration_ms          INTEGER NOT NULL DEFAULT 0,
  details              JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (run_id, namespace)
);

CREATE INDEX IF NOT EXISTS dry_runs_run_id_idx ON dry_runs (run_id);
CREATE INDEX IF NOT EXISTS dry_runs_status_idx ON dry_runs (status);
