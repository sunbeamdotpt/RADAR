-- RADAR inventory schema. Plain SQL, no extensions — CNPG-compatible.
-- Applied idempotently by the job and the API server at startup.

CREATE TABLE IF NOT EXISTS runs (
  id            BIGSERIAL PRIMARY KEY,
  generated_at  TIMESTAMPTZ NOT NULL,
  domain_suffix TEXT NOT NULL,
  git_base_url  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS components (
  run_id            BIGINT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  position          INTEGER NOT NULL,
  name              TEXT NOT NULL,
  namespace         TEXT NOT NULL,
  current           TEXT NOT NULL,
  latest            TEXT NOT NULL,
  source            TEXT NOT NULL,
  upstream          TEXT NOT NULL,
  link_template     TEXT NOT NULL DEFAULT '',
  notes             TEXT NOT NULL DEFAULT '',
  update_available  BOOLEAN NOT NULL DEFAULT FALSE,
  chart_version     TEXT,
  track_app_version BOOLEAN,
  PRIMARY KEY (run_id, name)
);

CREATE INDEX IF NOT EXISTS components_run_id_idx ON components (run_id);
