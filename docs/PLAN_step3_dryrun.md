# Plan: RADAR step 3 — server-side dry-run preview job

## Goal

A third one-shot job that runs after the assess job. For every component where
`update_available === true` and `risk_level === "likely_safe"`, it renders the manifests with the
`latest` version applied and pipes them to `kubectl apply --dry-run=server -f -`. Results are stored
like inventory and assessment reports.

## Assumptions

- Only `likely_safe` + drifted components are dry-run.
- Multi-namespace components use the first namespace from the seed.
- Bases are kustomize, possibly with Helm (`helmCharts` generator or standalone).
- Dev dry-run against production kubeconfig is **opt-in** via `RADAR_DRYRUN_KUBECONFIG`.
- Production CronJob uses an in-cluster service account.
- The job still clones `GIT_BASE_URL` to a temp dir to mutate safely, even after RADAR moves into
  sbbb.
- Auto-detection may pick up RADAR's own manifests; that's accepted.

## New files

- `src/schema/dryrun.ts` — `DryRun`, `DryRunReport`, validators, status enum.
- `db/migrations/003_dry_runs.sql` — `dry_runs` table, PK `(run_id, name)`, FK → `runs`.
- `src/store/store.ts` — add `DryRunStore` interface.
- `src/store/json_store.ts`, `src/store/postgres_store.ts`, `src/store/factory.ts` — implement
  store.
- `src/dryrun/config.ts` — env-only config.
- `src/dryrun/mapper.ts` — component → kustomization path (`kustomize_path` hint, heuristic
  fallback).
- `src/dryrun/runner.ts` — mutate version in temp copy, build, run `kubectl apply --dry-run=server`.
- `src/dryrun/engine.ts` — filter candidates, run mapper+runner, collect results.
- `src/dryrun/run.ts` — load latest inventory + assessments, orchestrate, save.
- `src/dryrun/main.ts` — entrypoint (exit 0/1/2, JSON logs).
- `docker/dryrun.Dockerfile` — Deno + kubectl + kustomize + helm + git.
- `deploy/dryrun-cronjob.yaml` + RBAC — suspended, serviceAccount `radar-dryrun`.
- `scripts/dev-dryrun.sh` — opt-in kubeconfig dev script.
- `tests/unit/dryrun_mapper_test.ts`, `tests/unit/dryrun_runner_test.ts`.
- `tests/integration/dryrun_test.ts` — skips without kubeconfig.

## Modified files

- `src/server/routes.ts` — `GET /api/v1/dryruns[?status=]` and `GET /api/v1/dryruns/{name}`.
- `deno.json` — `deno task dryrun`; include `src/dryrun/main.ts` in check.
- `deploy/kustomization.yaml` — add CronJob + RBAC.
- `README.md`, `AGENTS.md`, `docs/ARCHITECTURE.md` — env vars, safety contract, architecture.
- `seed/component-versions.yaml` — optional `kustomize_path` hints where mapping is ambiguous.

## Safety contract

- Runner refuses to execute any `kubectl` command that does not contain `--dry-run=server`.
- Dev kubeconfig mounted `:ro`; production uses dedicated read-ish service account.
- Production RBAC: `get`, `list`, `create` only (`create` is required for server-side dry-run).
- README/AGENTS carry a bold "dry-run only; never mutates cluster state" warning.

## Next step after reload

Resume implementation from this file. First tasks:

1. Schema + migration + store interface.
2. Mapper + runner (with command guard).
3. Engine + run + main.
4. Dockerfile + dev script + CronJob.
5. API routes + tests + docs.
