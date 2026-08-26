---
title: "RADAR"
description: "Release Automation & Deployment Asset Registry. Deno + TypeScript service that tracks deployment asset versions (Kubernetes manifests, Helm charts, GitHub releases, Docker images) and reports..."
---

# RADAR

Release Automation & Deployment Asset Registry. Deno + TypeScript service that tracks deployment
asset versions (Kubernetes manifests, Helm charts, GitHub releases, Docker images) and reports
upstream drift as JSON — a CI/CD integration point: one-shot job + read-only REST API + store
(json/postgres). See `README.md` for the quickstart and `docs/` for architecture, schema, API,
development, and Kubernetes details.

## Commands

```bash
deno task job               # run the inventory job (env-configured)
deno task assess            # run the assess job (step 2; needs an inventory run first)
deno task dryrun            # run the dry-run job (step 3; non-mutating preview)
deno task serve             # run the REST API on :8080
deno task test              # unit + parity + integration
deno task coverage          # tests + ≥95% line-coverage gate
deno task check             # fmt + lint + typecheck + tests + gate (run before committing)
scripts/dev-up.sh           # local docker stack: postgres + API on 127.0.0.1:8080
scripts/dev-job.sh          # one-shot inventory run against the dev stack
scripts/dev-assess.sh       # one-shot assess run against the dev stack
scripts/dev-dryrun.sh       # one-shot dry-run preview against the dev stack
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
- **The assessment record schema is contractual too.** The step-2 assessor's output is validated by
  `src/schema/assessment.ts` (9 risk levels, `SEVERITY_ORDER` sort, unknown keys rejected) — extend
  the validators when adding fields, same as the report schema.
- **Seed hints are parsed, never emitted.** Assessor hints (`channel`, `versioning_scheme`,
  `breaking_change_policy`, `eol_*`, `deprecated`) live in the seed YAML and feed the assess engine;
  they must stay out of inventory report records (parity).
- **Strict schemas.** Registry/report validation lives in `src/schema/component.ts`; unknown keys
  and wrong types are rejected. Extend the validators when adding fields.
- **All inputs via env vars** (see README table); secrets only via env. `DATABASE_URL` wins over
  `PG*` (VSO injects it as `dsn` in cluster).
- **No new dependencies** without a reason. Current deps: `jsr:@std/yaml`, `jsr:@db/postgres` (+
  `jsr:@std/assert`, `jsr:@std/path` for tests).
- **Logs are JSON lines** via `src/log.ts`; the jobs exit 0/1/2 (ok/failure/bad config). The assess
  job (`src/assess/`) and dry-run job (`src/dryrun/`) follow the same job standards: exit codes
  0/1/2, JSON logs, env-only config.
- **Dry-run is non-mutating.** The `src/dryrun/runner.ts` command guard refuses to execute any
  `kubectl` invocation that does not contain `--dry-run=server`. Dev cluster access is opt-in via
  `RADAR_DRYRUN_KUBECONFIG`; production uses the dedicated `radar-dryrun` service account.
- **deploy/ is not applied anywhere.** It mirrors sbbb conventions (plain YAML, `DOMAIN_SUFFIX`
  placeholders, VSO secrets, `/__lbheartbeat__` + `/__heartbeat__` probes). Future cluster adoption
  steps are documented in `docs/KUBERNETES.md`.
- sbbb is read-only from this repo: the parity test invokes the legacy script in place; the job
  clones the repo read-only.
