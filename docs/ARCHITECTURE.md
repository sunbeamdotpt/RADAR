---
title: "RADAR Architecture"
description: "High-level architecture, data flow, and module layout for RADAR."
---

# RADAR Architecture

## Overview

```
          ┌──────────────────────────── inventory job (one-shot) ───────────────────────────┐
          │                                                                                  │
seed YAML ─┼─► ingest ──► pin refresh ──► fetch latest ──► drift ──► report ──► save         │
(1st run)  │   (previous    (clone of      (per-source      (isNewer)           (store)       │
previous ──┼─► run if any)   GIT_BASE_URL)   fetchers)                                       │
(2nd+)     │        ▲                                                          │             │
          └─────────┼──────────────────────────────────────────────────────────┼─────────────┘
                    │                                                          ▼
            store doubles as cache                              ┌───────────────────────┐
            (fallback on fetch failure)                         │  json file  │  postgres│
                                                                └───────────────────────┘
                                                                           ▲
          ┌──────────────────────── REST API (read-only) ──────────────────┘
          │  GET / (dashboard) · /api/v1/inventory · /api/v1/components[/{name}]
          │  GET /api/v1/assessments[?risk_level=…] · /api/v1/assessments/{name}
          │  GET /api/v1/dryruns[?status=…] · /api/v1/dryruns/{name}
          │  /health · /__lbheartbeat__ · /__heartbeat__
          └───────────────────────────────────────────────────────────────────

          ┌───────────────────────── assess job (one-shot, step 2) ──────────────────────────┐
          │                                                                                   │
store     │  load latest ──► layered engine (per component) ──► severity- ──► save            │
(latest   ┼─► inventory    L0 prechecks → L0h hints → L0 major bump → L1     sorted  (same    │
 run)     │  run           structured diffs → L2 notes (gap-wide for GitHub) →                 store)    │
          │                  L3 commits → L4 keywords → channel hint → L5 gap fallback           │
          │                  (else unknown)                                                         │
          └───────────────────────────────────────────────────────────────────────────────────────┘

          ┌──────────────────────── dry-run job (one-shot, step 3) ────────────────────────────┐
          │                                                                                       │
store     │  load latest ──► filter likely_safe + drifted ──► map to kustomization ──► mutate  │
(latest   ┼─► inventory +    helm components                base + seed hints       chart → latest│
assessed  │  assessments    run kustomize build ──► kubectl apply --dry-run=server ──► save     │
run)      │                                                                                   (same store)    │
          └───────────────────────────────────────────────────────────────────────────────────────┘
```

## Modules (`src/`)

| Module                    | Responsibility                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema/component.ts`     | Strict `Component` / `InventoryReport` types and validators. Seed YAML and previous-report JSON are both validated; unknown keys and wrong types are rejected. `toRecord()` emits JSON keys in the contractual report order.                                                                                                                                                          |
| `schema/assessment.ts`    | Strict `Assessment` / `AssessmentReport` types and validators: 10 risk levels + `SEVERITY_ORDER` (report sort order). Unknown keys and wrong types are rejected, same posture as the component schema.                                                                                                                                                                                |
| `schema/dryrun.ts`        | Strict `DryRun` / `DryRunReport` types and validators. Status enum: `success`, `build_failed`, `dryrun_failed`, `skipped_no_mapping`, `skipped_unsupported_source`.                                                                                                                                                                                                                   |
| `domain/version.ts`       | `normalizeVersion` / `versionTuple` / `compareTuples` / `isNewer` — the version-comparison contract (prefix stripping, `_`→`.`, leading-numeric extraction, tuple ordering (shorter shared prefix loses), floating-tag rejection).                                                                                                                                                    |
| `domain/domain_suffix.ts` | `DOMAIN_SUFFIX` placeholder substitution (default `sunbeam.pt`).                                                                                                                                                                                                                                                                                                                      |
| `domain/time.ts`          | `generated_at` formatting/parsing (`YYYY-MM-DD HH:MM:SS UTC`).                                                                                                                                                                                                                                                                                                                        |
| `git/clone.ts`            | Shallow clone of `GIT_BASE_URL`@`GIT_BASE_REF` into a temp dir (`/tmp`, read-only-rootfs friendly) with cleanup.                                                                                                                                                                                                                                                                      |
| `scan/manifests.ts`       | Manifest scanner: walks `base/*/kustomization.yaml` for `helmCharts`, `images:`, workload manifests, and GitHub release URLs. Powers `--bootstrap` and pin refresh (`refreshPinsFromScan`).                                                                                                                                                                                           |
| `sources/`                | One fetcher per upstream source: `github_release`, `github_tags`, `helm_chart`, `docker_hub`, `static` (+ `custom`/unknown fallback). All take an injected `HttpClient` (`http.ts`): `FetchHttpClient` in prod, `OfflineHttpClient` under `RADAR_OFFLINE`, stubs in tests.                                                                                                            |
| `store/`                  | `Store` interface (`loadPrevious` / `saveReport` / `healthCheck` / `close`) plus `AssessmentStore` (`loadLatestAssessments` / `saveAssessments`) and `DryRunStore` (`loadLatestDryRuns` / `saveDryRuns`), with `JsonStore` (dev files) and `PostgresStore` (prod) implementations.                                                                                                    |
| `job/`                    | `config.ts` (env parsing), `inventory.ts` (the pass itself), `main.ts` (entrypoint: clone → run → save → optional JSON mirror; exit 0/1/2).                                                                                                                                                                                                                                           |
| `assess/`                 | Pipeline step 2: `config.ts` (env parsing), `run.ts` (the pass: latest inventory run → engine → sorted report → save), `engine.ts` (the layered engine), `hints.ts` (seed-hint loading + auto-detected fallbacks), `prechecks.ts` / `structured.ts` / `notes.ts` / `commits.ts` / `keywords.ts` (the layers), `fetch.ts` (release-note fetching), `main.ts` (entrypoint; exit 0/1/2). |
| `dryrun/`                 | Pipeline step 3: `config.ts` (env parsing), `run.ts` (clone base, load hints, orchestrate), `engine.ts` (filter candidates, collect results), `mapper.ts` (component → kustomization path), `runner.ts` (mutate chart version, kustomize build, guarded kubectl dry-run), `main.ts` (entrypoint; exit 0/1/2).                                                                         |
| `server/`                 | `routes.ts` (endpoint table), `main.ts` (bind, SIGTERM/SIGINT graceful shutdown).                                                                                                                                                                                                                                                                                                     |
| `config/env.ts`           | Shared env parsing: booleans, `STORAGE`, `DATABASE_URL` vs `PG*` fallback.                                                                                                                                                                                                                                                                                                            |

## Run lifecycle (job)

1. **Configure** — everything from env vars (`src/job/config.ts`). Invalid config → exit 2.
2. **Clone the git base** — the manifests repo (`GIT_BASE_URL`) is cloned fresh each run; the job
   never assumes a local checkout. Failure aborts the run when `GIT_BASE_REQUIRED=true` (or
   `--bootstrap`); otherwise the run continues without pin refresh.
3. **Ingest** — `store.loadPrevious()`: latest postgres run, or the JSON file. First run (empty
   store) ingests `RADAR_SEED_PATH` instead. This is the "subsequent runs ingest from postgres/json"
   rule. The store carries _state_ (`latest`, pins); the seed owns _curated_ fields — on ingest,
   `notes` is reset from the seed for curated components so run-appended annotations (fetch
   failures, appVersion resolution notes) never become the next run's baseline.
4. **Pin refresh** — scan the cloned `base/`; components whose `upstream` matches a manifest pin get
   `current`/`chart_version` updated. Unmatched components keep stored values. With
   `RADAR_AUTO_DETECT=true`, scanned entries whose upstream isn't tracked yet are **appended** as
   new components (deduped by upstream — case-insensitively — so multi-namespace curations like
   "curl" aren't re-added, and case-only name variants like scanned "valkey" vs curated "Valkey" are
   skipped as already tracked); they go through the same fetch/drift/store path immediately.
5. **Fetch** — per component, dispatch on `source`, paced at 250 ms per upstream for rate limiting.
   `helm_chart` with `track_app_version` rewrites `current` to the pinned chart's `appVersion` (and
   appends a note when the pin is missing upstream).
6. **Fallback** — on fetch failure, reuse the previous run's `latest` (the store is the cache; since
   it is the system of record there is no TTL). No previous value → `latest: "error"`,
   `notes: "Fetch failed: …"`.
7. **Drift** — `update_available = isNewer(latest, current)` for every component, computed
   unconditionally after success or fallback.
8. **Persist** — `store.saveReport()`; with `STORAGE=postgres` an explicit `RADAR_JSON_PATH`
   additionally writes a local JSON mirror.

## Run lifecycle (assess)

The assess job is pipeline step 2: it runs after the inventory job and turns drift into risk.

1. **Configure** — everything from env vars (`src/assess/config.ts`). Invalid config → exit 2.
2. **Load inventory** — `store.loadPrevious()`: the latest inventory run. No run → error, exit 1
   ("run the inventory job first").
3. **Load hints** — curated per-component hints from `RADAR_SEED_PATH` (missing/unreadable seed →
   warn + assess without hints). `resolveHints` then fills in auto-detected fallbacks: ory upstreams
   get `versioning_scheme=ory`, OpenSearch gets `breaking_change_policy=major_only`.
4. **Assess** — every component through the layered engine, or only `update_available` ones with
   `RADAR_ASSESS_UPDATES_ONLY=true`. Release notes are fetched via `link_template` (the GitHub
   releases API is preferred for github.com links), paced at 250 ms per component; fetch failures
   are soft — no notes is a normal outcome.
5. **Persist** — assessments sorted by `SEVERITY_ORDER` (most urgent first), then
   `store.saveAssessments()`: the `assessments` table in postgres, or the `RADAR_ASSESS_JSON_PATH`
   file with `STORAGE=json`. With postgres + explicit `RADAR_JSON_PATH`, a JSON mirror is also
   written.

## Run lifecycle (dry-run)

The dry-run job is pipeline step 3: it runs after the assess job and previews likely-safe upgrades.

1. **Configure** — everything from env vars (`src/dryrun/config.ts`). Invalid config → exit 2.
2. **Clone the git base** — same as the inventory job (`GIT_BASE_URL`@`GIT_BASE_REF`); the manifests
   repo is cloned fresh each run.
3. **Load hints** — optional `kustomize_path` overrides from `RADAR_SEED_PATH` for components whose
   base directory doesn't match their name.
4. **Filter candidates** — from the latest inventory run + assessments, select components where
   `update_available === true` and `risk_level === "likely_safe"`. Only `source === "helm_chart"`
   components are supported today; others are recorded as `skipped_unsupported_source`.
5. **Map** — component name → kustomization directory. `kustomize_path` hint wins, then a slug
   heuristic (`base/<slugified-name>`), then shorter slug variants (so "Gateway API CRDs" finds
   `base/gateway-api`). Multi-namespace components use the first namespace from the seed.
6. **Group by namespace** — candidate components are grouped by their Kubernetes namespace. All
   candidates that share a namespace are tested in a single dry-run pass.
7. **Mutate** — in a temp copy of the mapped directory, update the matching `helmCharts[].version`
   entries for **every candidate in that namespace** to each component's `latest` version (chart
   name is parsed from the upstream `repo::name` form).
8. **Build** — `kustomize build <temp-dir>`.
9. **Dry-run** — pipe the rendered manifests to `kubectl apply --dry-run=server -f -`. The runner
   refuses to execute any `kubectl` command that does not contain `--dry-run=server`. In dev, point
   `RADAR_DRYRUN_KUBECONFIG` at a kubeconfig; in-cluster, the pod uses its service account.
10. **Persist** — one `DryRun` record per **namespace** that had candidates, sorted by namespace,
    then `store.saveDryRuns()`: the `dry_runs` table in postgres, or `RADAR_DRYRUN_JSON_PATH` with
    `STORAGE=json`. With postgres + explicit `RADAR_JSON_PATH`, a JSON mirror is also written.

Because the dry-run is run once per namespace with every candidate chart in that namespace bumped to
`latest`, all components in the namespace share the same `status`, `stdout`, and `stderr`.

### The layered engine (`src/assess/engine.ts`)

Layers run highest-confidence first; the first decisive verdict wins, and the winning layer is
recorded in the assessment's `layer` field:

- **L0 prechecks** — no external data: floating tag → `floating_tag`; curated `deprecated` hint →
  `deprecated`; EOL window (within 6 months of `eol_date` on the matching `eol_version_line`) →
  `eol_warning`; custom-fork suffix (`-sunbeam.12`) → `custom_fork`; non-standard latest tag →
  `false_positive`.
- **L0h version-scheme hints** — before version numbers are read as semver: `versioning_scheme=ory`
  (any forward gap → `review`), `breaking_change_policy=major_only` (same major → `likely_safe`).
- **L0 major bump** — `latest.major > current.major` → `breaking`.
- **L1 structured diffs** — only when the caller injects the data (acquisition is out of scope for
  the engine): Helm `values.schema.json` diff (removed keys, type changes, new `required`,
  restricted enums), CRD manifest diff (removed API versions, newly required fields), `go.mod` diff
  (removed deps, major dependency bumps).
- **L2 release-note structure** — breaking/removal/deprecation section detection over fetched
  release notes + the component's curated `notes`.
- **L3 commit analysis** — conventional-commit `!` / `BREAKING CHANGE:` markers plus keyword
  heuristics, when commits are injected.
- **L4 weighted keywords** — scored patterns over the note text (positive weights for risk, negative
  for safety signals like "bug fixes only").
- **Channel hint** — `channel: experimental` (explicit, or inferred from curated notes) →
  `breaking`. Runs late: curated context outranks the generic gap heuristic.
- **L5 gap fallback** — same-major minor gap: ≤2 → `likely_safe`, >10 → `review`; anything else with
  no signal → `unknown`. If the component drifted and its release notes were fetchable but empty,
  the verdict is `unknown` (silence is not safety). Note fetches try the resolved URL and the
  `v`-toggled tag variant (`v1.2.3` ↔ `1.2.3`) because tagging conventions differ per repo.

## Storage model (postgres)

- `runs(id, generated_at, domain_suffix, git_base_url)` — one row per job run.
- `components(run_id, position, name, …, chart_version, track_app_version)` — one row per component
  per run; `position` preserves report order.
- `assessments(run_id, assessed_at, position, name, current, latest, risk_level, reason, action,
  layer, details)`
  — one row per assessed component per run, attached to the inventory run it was computed from;
  `position` preserves severity-sorted report order. Re-assessing the same inventory run replaces
  that run's assessments (idempotent re-runs).
- `dry_runs(run_id, dry_run_at, position, namespace, components, status, stdout, stderr,
  duration_ms, details)`
  — one row per namespace dry-run per run, attached to the inventory run it was computed from.
  `components` is a JSONB array of the component names whose chart versions were bumped in that
  namespace. Re-running dry-runs against the same inventory run replaces that run's previews
  (idempotent re-runs).
- Readers always query the latest run; migrations (`db/migrations/001_init.sql`,
  `002_assessments.sql`, `003_dry_runs.sql`, `004_dry_runs_namespace.sql`) apply idempotently at
  job/server startup. Plain SQL, no extensions — CNPG-ready.

The append-only runs table gives free history; a future pruning policy can simply delete old `runs`
rows (cascade cleans `components` and `assessments`).

## Output compatibility

`tests/parity/` guards the report contract: the job (offline, seeded previous report) and a legacy
reference implementation (offline, seeded cache) must emit identical component records — same
values, same key order. The behavioral details that matter live in the module docstrings and the
"Output contract" section of `docs/DEVELOPMENT.md`.

## Failure modes

| Failure                         | Behavior                                                                            |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| Invalid env config              | exit 2, JSON error log                                                              |
| Git base clone fails            | warn + continue without pin refresh (exit 1 if `GIT_BASE_REQUIRED` / `--bootstrap`) |
| Upstream fetch fails            | previous value reused (`cached`), or `latest: "error"` on first sight               |
| Postgres unavailable at startup | job exits 1; server exits non-zero (crash-loop surfaces it)                         |
| Postgres blip while serving     | `/__heartbeat__` and `/health` go 503; liveness stays 200                           |
| kustomize build fails           | dry-run status `build_failed`; stdout/stderr captured; other components continue    |
| kubectl dry-run fails           | dry-run status `dryrun_failed`; stdout/stderr captured; other components continue   |
| Missing kustomization mapping   | dry-run status `skipped_no_mapping`                                                 |
