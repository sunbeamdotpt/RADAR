# RADAR Schemas

Strict definitions for the registry seed, the JSON report, and the postgres tables. Validation lives
in `src/schema/component.ts`; unknown keys and wrong types are rejected outright.

## Component sources

```ts
type ComponentSource =
  | "github_release" // api.github.com/repos/{upstream}/releases/latest
  | "github_tags" // api.github.com/repos/{upstream}/tags?per_page=1
  | "helm_chart" // {repo}/index.yaml, upstream = "{repo_url}::{chart_name}"
  | "docker_hub" // hub.docker.com/v2/repositories/{upstream}/tags
  | "static" // no upstream check; latest = seeded value or "unknown"
  | "custom"; // reserved; reports "unknown"
```

## Seed registry (`seed/component-versions.yaml`)

```yaml
ignore: # optional, list of strings — auto-detection suppression
  - wiki # matches a scanned component's upstream OR name exactly
  - busybox

components:
  - name: Cert-manager # required, string
    namespace: cert-manager # required, string
    current: v1.19.4 # required, string (YAML numbers are coerced)
    source: helm_chart # required, ComponentSource
    upstream: https://charts.jetstack.io::cert-manager # required, string
    link_template: https://github.com/cert-manager/cert-manager/releases/tag/{app_version}
    notes: Helm chart 1.19.4 # optional, default ""
    chart_version: "1.19.4" # optional, helm_chart only, default ""
    track_app_version: true # optional, helm_chart only, default false
    latest: v1.19.4 # optional, static sources may preseed it
```

Rules:

- Required: `name`, `namespace`, `current`, `source`, `upstream`.
- Optional: `link_template`, `notes`, `chart_version`, `track_app_version`, `latest` (plus
  `latest_link` is never in the seed).
- Any other key → `SchemaError`.
- `link_template` placeholders: `{tag}` (github/docker), `{version}` and `{app_version}` (helm).
  Formatted with the _latest_ fetched values.
- Top-level `ignore` is optional; when present it must be a list of non-empty strings. It only gates
  `RADAR_AUTO_DETECT` — curated components are always kept, even if listed.

## Report (job output / API payload)

```json
{
  "generated_at": "2026-08-21 12:00:00 UTC",
  "components": [
    {
      "name": "CFSSL",
      "namespace": "cert-manager",
      "current": "v1.6.5",
      "latest": "v1.7.0",
      "source": "github_release",
      "upstream": "cloudflare/cfssl",
      "link_template": "https://github.com/cloudflare/cfssl/releases/tag/{tag}",
      "notes": "",
      "update_available": true
    }
  ]
}
```

- Key order is contractual — downstream consumers and the compatibility test rely on it:
  `name, namespace, current, latest, source,
  upstream, link_template, notes, update_available`.
- `helm_chart` records append `chart_version` and `track_app_version` (only for helm).
- `latest` sentinel values: `"error"` (fetch failed, no previous), `"unknown"` (static/custom
  without a seeded value), `"n/a"` (upstream returned nothing).
- `update_available` is `isNewer(latest, current)` — floating sentinels (`latest`, `stable`,
  `floating`, `n/a`, `unknown`, `""`) never count as newer.
- **Comparison considers the leading numeric release only** (after stripping `^v`/`^curl-` and
  converting `_` to `.`). Prerelease and build suffixes are invisible by design:
  `v2.41.1-sunbeam.12` vs `v2.41.1-sunbeam.13` compares equal, and `1.0.0-rc1` compares equal to
  `1.0.0`. Suffixes aren't reliably orderable across ecosystems, so they are deliberately out of
  scope for drift detection.
- `generated_at` is UTC, formatted `%Y-%m-%d %H:%M:%S UTC`.

## Postgres tables (`db/migrations/001_init.sql`)

```sql
runs(
  id BIGSERIAL PRIMARY KEY,
  generated_at TIMESTAMPTZ NOT NULL,
  domain_suffix TEXT NOT NULL,
  git_base_url  TEXT NOT NULL
)

components(
  run_id            BIGINT REFERENCES runs(id) ON DELETE CASCADE,
  position          INTEGER NOT NULL,          -- report order
  name              TEXT NOT NULL,
  namespace         TEXT NOT NULL,
  current           TEXT NOT NULL,
  latest            TEXT NOT NULL,
  source            TEXT NOT NULL,
  upstream          TEXT NOT NULL,
  link_template     TEXT NOT NULL DEFAULT '',
  notes             TEXT NOT NULL DEFAULT '',
  update_available  BOOLEAN NOT NULL DEFAULT FALSE,
  chart_version     TEXT,                      -- null unless helm_chart
  track_app_version BOOLEAN,                   -- null unless helm_chart
  PRIMARY KEY (run_id, name)
)
```

One `runs` row + N `components` rows per job run (append-only). Readers use the latest run; the
latest run is the next run's previous state.
