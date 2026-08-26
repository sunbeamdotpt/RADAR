# RADAR

**Release Automation & Deployment Asset Registry** — tracks the software versions pinned in the
Sunbeam Kubernetes platform (Kubernetes manifests, Helm charts, GitHub releases, Docker images) and
locates the latest upstream version of each, surfacing drift as machine-readable JSON.

RADAR is a CI/CD integration point: the inventory job runs wherever your automation runs (Kubernetes
Job/CronJob today, wfe later, any CI runner), and the REST API + Postgres store give pipelines,
dashboards, and release tooling a canonical answer to "what are we running, and what's outdated?"

## Components

- **Inventory job** (`src/job/`) — one-shot, automation-friendly (exit codes, JSON logs, env-only
  config). Ingests the registry (previous run, or the seed YAML on first run), refreshes pins from a
  cloned copy of the manifests repo, checks every upstream, and writes the report to the store.
- **Assess job** (`src/assess/`) — pipeline step 2, run after the inventory job. Compares each
  component's `current` vs `latest` and produces a risk assessment (`breaking`, `review`,
  `deprecated`, `eol_warning`, `custom_fork`, `floating_tag`, …) via layered checks: seed hints,
  prechecks (fork/floating/deprecated/EOL), version delta, structured manifests (Helm values schema,
  CRD, go.mod), upstream release notes, and changelog keywords. Writes the assessment run to the
  same store.
- **REST API** (`src/server/`) — read-only JSON over the latest stored report and assessments.
- **Stores** (`src/store/`) — `json` (local file, dev default) or `postgres` (prod).

## Quickstart (local docker)

```bash
scripts/dev-up.sh     # postgres + api on http://127.0.0.1:8080
scripts/dev-job.sh    # inventory pass (clone sbbb, check upstreams, save)
scripts/dev-assess.sh # assess pass (compare current vs latest, save risk assessments)
curl -s http://127.0.0.1:8080/api/v1/inventory | head
curl -s http://127.0.0.1:8080/api/v1/assessments | head
scripts/dev-down.sh   # tear down (--volumes to also drop data)
```

`docker/docker-compose.yml` provides the same stack for compose users.

## Quickstart (bare metal)

```bash
deno task job                         # STORAGE=json → ./data/component-versions.json
deno task assess                      # STORAGE=json → ./data/component-versions.assessments.json
deno task serve                       # serves those files on :8080
deno task job -- --bootstrap          # regenerate the seed from the cloned git base
```

## Configuration

Everything is env vars; secrets only ever arrive via env. See [docs/SCHEMA.md](docs/SCHEMA.md) for
the data model and [docs/API.md](docs/API.md) for endpoints.

| Var                         | Default                                      | Purpose                                                                         |
| --------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------- |
| `STORAGE`                   | `json`                                       | `json` (dev) or `postgres` (prod)                                               |
| `DATABASE_URL`              | —                                            | Postgres DSN (`PGHOST`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`/`PGPORT` as fallback) |
| `RADAR_SEED_PATH`           | `./seed/component-versions.yaml`             | First-run registry seed                                                         |
| `RADAR_JSON_PATH`           | `./data/component-versions.json`             | Dev JSON store; also an optional mirror when `STORAGE=postgres`                 |
| `GIT_BASE_URL`              | `https://github.com/sunbeamdotpt/sbbb.git`   | Manifests repo cloned each run                                                  |
| `GIT_BASE_REF`              | `mainline`                                   | Branch/tag to clone                                                             |
| `GIT_BASE_REQUIRED`         | `false`                                      | Fail the run when the clone fails                                               |
| `DOMAIN_SUFFIX`             | `sunbeam.pt`                                 | Substitutes `DOMAIN_SUFFIX` placeholders in manifests                           |
| `GITHUB_TOKEN`              | —                                            | GitHub API auth (avoids rate limits)                                            |
| `RADAR_OFFLINE`             | `false`                                      | Force all fetches to fail → previous-state fallback (test harness)              |
| `RADAR_AUTO_DETECT`         | `false`                                      | Append components discovered in the git base that aren't tracked yet            |
| `RADAR_FETCH_TIMEOUT_MS`    | `20000`                                      | Per-fetch timeout; retries count as fresh attempts                              |
| `RADAR_FETCH_RETRIES`       | `1`                                          | Number of retries for timeout/5xx/transport errors (4xx is not retried)         |
| `RADAR_HOST` / `PORT`       | `0.0.0.0` / `8080`                           | API bind address                                                                |
| `RADAR_ASSESS_UPDATES_ONLY` | `false`                                      | Assess only components with `update_available`                                  |
| `RADAR_ASSESS_JSON_PATH`    | `./data/component-versions.assessments.json` | Dev JSON assessment store; also a mirror when `STORAGE=postgres`                |

## CI/CD integration

RADAR is built to sit inside delivery automation, not next to it:

- **Scheduled drift detection** — run the job from a CronJob (`deploy/job-cronjob.yaml`), a wfe
  workflow, or a CI schedule. Exit code 0/1/2 (ok/failure/bad config) and JSON-line logs slot into
  any runner.
- **Pipeline gating** — the API's `update_available` flags and the Postgres store let pipelines gate
  releases, open upgrade tickets, or feed release notes. The assess job (step 2) adds per-component
  risk levels via `/api/v1/assessments`. Example:
  `curl -s $RADAR/api/v1/components | jq '[.[] | select(.update_available)]'`
- **Registry as code** — the seed YAML (`seed/component-versions.yaml`) is the curated source of
  truth; reviews happen in git. `RADAR_AUTO_DETECT=true` proposes new services automatically.
- **Manifest drift reconciliation** — each run clones the manifests repo and refreshes pinned
  versions from it, so the registry tracks what's actually deployed, not what someone remembered.

## Testing

```bash
deno task test:unit          # fast unit tests
deno task test:parity        # golden-output compatibility test
deno task test:integration   # dockerized postgres + entrypoint smoke tests
deno task coverage           # all of the above + ≥95% line-coverage gate
deno task check              # fmt + lint + types + tests + coverage gate
```

The parity test runs the job and a legacy reference implementation offline against identical prior
state and asserts byte-identical component records (see `tests/parity/`).

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — design and data flow
- [docs/SCHEMA.md](docs/SCHEMA.md) — strict registry/report schemas
- [docs/API.md](docs/API.md) — REST endpoint reference
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — local workflows, testing, coverage
- [docs/KUBERNETES.md](docs/KUBERNETES.md) — `deploy/` walkthrough and sbbb integration
