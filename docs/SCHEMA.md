# RADAR Schemas

Strict definitions for the registry seed, the JSON report, the assessment report, and the postgres
tables. Validation lives in `src/schema/component.ts` and `src/schema/assessment.ts`; unknown keys
and wrong types are rejected outright.

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

    # Assessor hints (optional, curated; consumed by the assess job, never
    # emitted in inventory report records — the report shape is contractual)
    channel: experimental # breaking changes allowed between releases
    versioning_scheme: ory # version numbers that look like semver but aren't
    breaking_change_policy: major_only # breaking changes only in major versions
    eol_version_line: "2.9" # version line approaching end-of-life
    eol_date: "2026-12-31" # EOL date for that line
    eol_replacement: 3.x # replacement text used in the EOL action
    deprecated: Replaced by cert-manager # presence marks the component deprecated
```

Rules:

- Required: `name`, `namespace`, `current`, `source`, `upstream`.
- Optional: `link_template`, `notes`, `chart_version`, `track_app_version`, `latest` (plus
  `latest_link` is never in the seed).
- Assessor hints (all optional strings): `channel`, `versioning_scheme`, `breaking_change_policy`,
  `eol_version_line`, `eol_date`, `eol_replacement`, `deprecated`. They are parsed from the seed but
  kept out of report records. When a hint is absent the assessor auto-detects well-known upstream
  shapes as a fallback (ory upstreams → `versioning_scheme=ory`, OpenSearch →
  `breaking_change_policy=major_only`).
- Any other key → `SchemaError`.
- `link_template` placeholders: `{tag}` (github/docker), `{version}` and `{app_version}` (helm).
  Formatted with the _latest_ fetched values.
- Top-level `ignore` is optional; when present it must be a list of non-empty strings. It only gates
  `RADAR_AUTO_DETECT` — curated components are always kept, even if listed.

### Assessor hint fields

| Hint                     | Meaning                                                                                                    | Consuming layer                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `channel`                | e.g. `experimental` — breaking changes allowed between releases                                            | channel hint (runs late, `layer_6_hints`)                 |
| `versioning_scheme`      | e.g. `ory` — version numbers that look like semver but aren't; a forward gap is `review`, not a major bump | version-scheme hints (`layer_0_hints`, before major-bump) |
| `breaking_change_policy` | e.g. `major_only` — breaking changes only in major versions; same-major → `likely_safe`                    | version-scheme hints (`layer_0_hints`)                    |
| `eol_version_line`       | version line approaching EOL, e.g. `"2.9"`                                                                 | EOL precheck (`layer_0_precheck`)                         |
| `eol_date`               | EOL date for that line (`YYYY-MM-DD`); warns within 6 months                                               | EOL precheck (`layer_0_precheck`)                         |
| `eol_replacement`        | replacement text used in the EOL action                                                                    | EOL precheck (`layer_0_precheck`)                         |
| `deprecated`             | presence marks the component deprecated; the value is the migration message                                | prechecks (`layer_0_precheck`)                            |

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

## Assessment report (assess-job output / API payload)

The step-2 assessor's output, validated by `src/schema/assessment.ts`:

```json
{
  "generated_at": "2026-08-22 01:30:12 UTC",
  "inventory_generated_at": "2026-08-22 01:00:38 UTC",
  "assessments": [
    {
      "name": "CFSSL",
      "current": "v1.6.5",
      "latest": "v2.0.0",
      "risk_level": "breaking",
      "reason": "Major version bump: 1.6.5 → 2.0.0",
      "action": "Read migration guide before upgrading",
      "layer": "layer_0_precheck",
      "details": { "from": "v1.6.5", "to": "v2.0.0" }
    }
  ]
}
```

- `inventory_generated_at` ties the report to the inventory run it was computed from. Both
  timestamps use the same `%Y-%m-%d %H:%M:%S UTC` format as the inventory report.
- Assessment fields: `name`, `current`, `latest`, `risk_level`, `reason` (why), `action` (what to
  do), `layer` (which analysis layer produced the verdict, e.g. `layer_0_precheck`), `details`
  (layer-specific evidence, default `{}`). All are required except `details`; unknown keys are
  rejected.
- `assessments` is sorted by `SEVERITY_ORDER` — most urgent first:

  | Order | Risk level       | Meaning                                                          |
  | ----- | ---------------- | ---------------------------------------------------------------- |
  | 0     | `breaking`       | Breaking change detected (major bump, breaking notes section, …) |
  | 1     | `deprecated`     | Component marked deprecated in the seed                          |
  | 2     | `eol_warning`    | Version line approaching end-of-life                             |
  | 3     | `false_positive` | Latest tag looks like a non-standard variant                     |
  | 4     | `floating_tag`   | `current` is a floating tag — not reproducible                   |
  | 5     | `custom_fork`    | Custom fork suffix detected on `current`                         |
  | 6     | `review`         | Signals warrant human review                                     |
  | 7     | `unknown`        | Insufficient data to decide                                      |
  | 8     | `likely_safe`    | No breaking signals; safe to auto-update                         |

## Postgres tables (`db/migrations/001_init.sql`, `002_assessments.sql`)

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

assessments(
  run_id      BIGINT REFERENCES runs(id) ON DELETE CASCADE,
  assessed_at TIMESTAMPTZ NOT NULL,
  position    INTEGER NOT NULL,          -- severity-sorted report order
  name        TEXT NOT NULL,
  current     TEXT NOT NULL,
  latest      TEXT NOT NULL,
  risk_level  TEXT NOT NULL,
  reason      TEXT NOT NULL,
  action      TEXT NOT NULL,
  layer       TEXT NOT NULL,
  details     JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (run_id, name)
)
```

One `runs` row + N `components` rows per inventory run, and one `assessments` row per assessed
component attached to the run it was computed from (append-only). Readers use the latest run; the
latest run is the next run's previous state.
