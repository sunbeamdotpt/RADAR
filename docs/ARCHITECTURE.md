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
          │  GET /api/v1/inventory · /api/v1/components[/{name}] · /health · probes
          └───────────────────────────────────────────────────────────────────
```

## Modules (`src/`)

| Module                    | Responsibility                                                                                                                                                                                                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema/component.ts`     | Strict `Component` / `InventoryReport` types and validators. Seed YAML and previous-report JSON are both validated; unknown keys and wrong types are rejected. `toRecord()` emits JSON keys in the contractual report order.                                               |
| `domain/version.ts`       | `normalizeVersion` / `versionTuple` / `compareTuples` / `isNewer` — the version-comparison contract (prefix stripping, `_`→`.`, leading-numeric extraction, tuple ordering (shorter shared prefix loses), floating-tag rejection).                                         |
| `domain/domain_suffix.ts` | `DOMAIN_SUFFIX` placeholder substitution (default `sunbeam.pt`).                                                                                                                                                                                                           |
| `domain/time.ts`          | `generated_at` formatting/parsing (`YYYY-MM-DD HH:MM:SS UTC`).                                                                                                                                                                                                             |
| `git/clone.ts`            | Shallow clone of `GIT_BASE_URL`@`GIT_BASE_REF` into a temp dir (`/tmp`, read-only-rootfs friendly) with cleanup.                                                                                                                                                           |
| `scan/manifests.ts`       | Manifest scanner: walks `base/*/kustomization.yaml` for `helmCharts`, `images:`, workload manifests, and GitHub release URLs. Powers `--bootstrap` and pin refresh (`refreshPinsFromScan`).                                                                                |
| `sources/`                | One fetcher per upstream source: `github_release`, `github_tags`, `helm_chart`, `docker_hub`, `static` (+ `custom`/unknown fallback). All take an injected `HttpClient` (`http.ts`): `FetchHttpClient` in prod, `OfflineHttpClient` under `RADAR_OFFLINE`, stubs in tests. |
| `store/`                  | `Store` interface (`loadPrevious` / `saveReport` / `healthCheck` / `close`) with `JsonStore` (dev file) and `PostgresStore` (prod) implementations.                                                                                                                        |
| `job/`                    | `config.ts` (env parsing), `inventory.ts` (the pass itself), `main.ts` (entrypoint: clone → run → save → optional JSON mirror; exit 0/1/2).                                                                                                                                |
| `server/`                 | `routes.ts` (endpoint table), `main.ts` (bind, SIGTERM/SIGINT graceful shutdown).                                                                                                                                                                                          |
| `config/env.ts`           | Shared env parsing: booleans, `STORAGE`, `DATABASE_URL` vs `PG*` fallback.                                                                                                                                                                                                 |

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
   new components (deduped by upstream, so multi-namespace curations like "curl" aren't re-added);
   they go through the same fetch/drift/store path immediately.
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

## Storage model (postgres)

- `runs(id, generated_at, domain_suffix, git_base_url)` — one row per job run.
- `components(run_id, position, name, …, chart_version, track_app_version)` — one row per component
  per run; `position` preserves report order.
- Readers always query the latest run; migrations (`db/migrations/001_init.sql`) apply idempotently
  at job/server startup. Plain SQL, no extensions — CNPG-ready.

The append-only runs table gives free history; a future pruning policy can simply delete old `runs`
rows (cascade cleans `components`).

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
