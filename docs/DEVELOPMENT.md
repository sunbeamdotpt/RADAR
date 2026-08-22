# RADAR Development

## Prerequisites

- Deno 2.x (developed on 2.9.5)
- Docker (for the dev stack and integration tests)
- Python 3 + PyYAML (only for the compatibility test — it runs a legacy reference implementation)
- git

## Layout

See docs/ARCHITECTURE.md for the module tour. Tests mirror `src/`:

- `tests/unit/` — pure logic, stubbed HTTP/store; no network, no docker.
- `tests/integration/` — dockerized postgres, entrypoint subprocess smoke tests.
- `tests/parity/` — golden-output compatibility test.

## Common tasks

```bash
deno task job                     # run the inventory job (STORAGE=json default)
deno task serve                   # run the API on :8080
deno task test                    # everything (unit + parity + integration)
deno task test:unit               # fast loop
deno task coverage                # tests + ≥95% line-coverage gate
deno task check                   # fmt + lint + typecheck + tests + gate
```

## Local docker stack

```bash
scripts/dev-up.sh        # postgres:18-alpine + API on 127.0.0.1:8080
scripts/dev-job.sh       # one-shot job container (clone + fetch + save)
scripts/dev-down.sh      # stop; add --volumes to drop data
```

The scripts use plain `docker` (no compose plugin required). `docker/docker-compose.yml` mirrors
them for compose users (`docker compose -f docker/docker-compose.yml up`, job via `--profile job`).
Useful env while developing:

```bash
RADAR_OFFLINE=1 scripts/dev-job.sh      # skip upstream fetches (fallback behavior)
GIT_BASE_URL=/path/to/local/sbbb scripts/dev-job.sh   # skip the GitHub clone
GITHUB_TOKEN=… scripts/dev-job.sh       # avoid GitHub rate limits
```

## The compatibility test (`tests/parity/`)

The report's shape and semantics are a hard contract — downstream consumers and CI pipelines parse
it. `tests/parity/parity_test.ts` guards that contract by running the job and a legacy reference
implementation offline against identical prior state, asserting byte-identical component records:

1. Deterministic fixtures assign every seed component a "previously fetched" latest version
   (`tests/parity/fixtures.ts`): `v99.0.0` for checkable sources, `unknown` for `static`/`custom`.
2. The reference implementation runs with a seeded cache and a dead proxy so every fetch fails
   instantly → cache fallback.
3. The RADAR job runs with the same values as its previous JSON report and the `OfflineHttpClient` →
   previous-state fallback.
4. Records are compared field-by-field **and** by key order.

The reference output is committed at `tests/parity/fixtures/golden.python.json` for review.

## Output contract

The behaviors below define the report (all covered by unit tests):

- Version comparison: strip `^v` / `^curl-`, `_`→`.`, keep leading numeric run, tuple semantics
  (`(1,2) < (1,2,0)`), `(0,)` fallback, floating sentinels.
- `helm_chart` + `track_app_version` rewrites `current` from the pinned chart entry and appends
  `"; could not resolve appVersion for chart X"` when the pin is absent. The pinned-entry lookup
  matches like helm does (exact first, then normalized semver), so a manifest pin `1.19.4` resolves
  against an index entry `v1.19.4`.
- Docker Hub filters: rolling tags, prerelease/platform keywords, ≥20-char hex tags; winner picked
  by `(version_tuple, tag)` lexicographic max.
- Fallback: previous `latest` reused on failure; otherwise `latest: "error"` and
  `notes: "Fetch failed: …"`. `update_available` computed unconditionally.

## Coverage gate

`deno task coverage` writes `coverage/lcov.info` and runs `tools/check_coverage.ts`, which fails
below 95% line coverage on `src/` (tests/fixtures excluded). Integration tests auto-skip when docker
is unavailable, so the gate is meaningful everywhere.

## Adding a component

Append to `seed/component-versions.yaml` (schema: docs/SCHEMA.md) and run the job. To regenerate the
whole seed from a manifests checkout: `deno task job -- --bootstrap` with `GIT_BASE_URL` pointing at
the repo.

### Auto-detection

With `RADAR_AUTO_DETECT=true`, the job appends components it finds in the cloned git base whose
`upstream` isn't tracked yet (helm charts, kustomize `images:`, workload container images, GitHub
release URLs — the same shapes `--bootstrap` scans). Auto-added entries carry the scanner's
"Auto-detected from …" note, are deduped by upstream, and are fetched/drifted/stored like curated
ones from their first run. Try it against the dev stack:

```bash
RADAR_AUTO_DETECT=1 scripts/dev-job.sh
```

Known limits: the scanner can't see images referenced from ConfigMaps/CRDs/operator-managed
workloads.

### Suppression (`ignore:`)

The seed's top-level `ignore:` list is the curated noise filter for auto-detection: entries match a
scanned component's `upstream` or `name` exactly and are never auto-added. It ships pre-populated
with the short-name base-manifest images whose real registry lives in overlay `images:` sections
(they would misclassify as Docker Hub repos and 404). Notes:

- `ignore` only gates auto-detection; curated components are always kept.
- It does not remove anything already in the store — delete junk runs first (dev:
  `scripts/dev-down.sh --volumes`), or wait for a pruning feature.
- Auto-added names are unique per report; collisions are disambiguated as `name (namespace)` and
  unresolvable ones are skipped with a warning in the job logs.
