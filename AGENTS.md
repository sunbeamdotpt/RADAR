# RADAR

Release Automation & Deployment Asset Registry. Deno + TypeScript service that tracks deployment
asset versions (Kubernetes manifests, Helm charts, GitHub releases, Docker images) and reports
upstream drift as JSON — a CI/CD integration point: one-shot job + read-only REST API + store
(json/postgres). See `README.md` for the quickstart and `docs/` for architecture, schema, API,
development, and Kubernetes details.

## Commands

```bash
deno task job               # run the inventory job (env-configured)
deno task serve             # run the REST API on :8080
deno task test              # unit + parity + integration
deno task coverage          # tests + ≥95% line-coverage gate
deno task check             # fmt + lint + typecheck + tests + gate (run before committing)
scripts/dev-up.sh           # local docker stack: postgres + API on 127.0.0.1:8080
scripts/dev-job.sh          # one-shot inventory run against the dev stack
scripts/dev-down.sh         # tear down (--volumes to drop data)
```

Integration tests need docker; the parity test needs python3 + PyYAML (it runs a legacy reference
implementation offline). Both auto-skip/fail loudly per environment.

## Conventions

- **Output compatibility is contractual.** The report JSON must match the legacy reference: record
  key order
  (`name, namespace, current, latest, source, upstream, link_template, notes,
  update_available` +
  `chart_version, track_app_version` for `helm_chart` only), `generated_at` format
  (`%Y-%m-%d %H:%M:%S UTC`), version-comparison semantics (`src/domain/version.ts`), and fallback
  behavior (previous run's `latest` on fetch failure; `latest: "error"` when no previous).
  `deno task test:parity` enforces this.
- **Strict schemas.** Registry/report validation lives in `src/schema/component.ts`; unknown keys
  and wrong types are rejected. Extend the validators when adding fields.
- **All inputs via env vars** (see README table); secrets only via env. `DATABASE_URL` wins over
  `PG*` (VSO injects it as `dsn` in cluster).
- **No new dependencies** without a reason. Current deps: `jsr:@std/yaml`, `jsr:@db/postgres` (+
  `jsr:@std/assert`, `jsr:@std/path` for tests).
- **Logs are JSON lines** via `src/log.ts`; the job exits 0/1/2 (ok/failure/bad config).
- **deploy/ is not applied anywhere.** It mirrors sbbb conventions (plain YAML, `DOMAIN_SUFFIX`
  placeholders, VSO secrets, `/__lbheartbeat__` + `/__heartbeat__` probes). Future cluster adoption
  steps are documented in `docs/KUBERNETES.md`.
- sbbb is read-only from this repo: the parity test invokes the legacy script in place; the job
  clones the repo read-only.
