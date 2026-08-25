# RADAR REST API

Read-only JSON over the latest stored inventory report and assessment report. Base URL in local dev:
`http://127.0.0.1:8080`. No authentication (cluster-internal service; expose via Sunbeam Proxy if
needed — see docs/KUBERNETES.md).

## Probes

| Endpoint               | Purpose                               | Success                 | Failure                    |
| ---------------------- | ------------------------------------- | ----------------------- | -------------------------- |
| `GET /__lbheartbeat__` | Liveness (cluster contract)           | `200 ok` (text)         | —                          |
| `GET /__heartbeat__`   | Readiness — checks store reachability | `200 ok` (text)         | `503 unavailable`          |
| `GET /health`          | JSON health summary                   | `200 {"status":"ok",…}` | `503 {"status":"error",…}` |

## Inventory

### `GET /api/v1/inventory`

The full latest report.

```json
{
  "generated_at": "2026-08-22 01:00:38 UTC",
  "components": [{ "name": "Gateway API CRDs", "…": "…" }]
}
```

`404 {"error":"no inventory yet — run the radar job first"}` before the first run.

### `GET /api/v1/components`

The latest report's component records as a flat array (record shape: docs/SCHEMA.md).

### `GET /api/v1/components/{name}`

One component record. `name` is URL-encoded and matched exactly (e.g.
`/api/v1/components/Scaleway%20cert-manager%20webhook`).

```json
{
  "name": "Cert-manager",
  "namespace": "cert-manager",
  "current": "1.19.4",
  "latest": "v1.21.1",
  "source": "helm_chart",
  "upstream": "https://charts.jetstack.io::cert-manager",
  "link_template": "https://github.com/cert-manager/cert-manager/releases/tag/{app_version}",
  "notes": "Helm chart 1.19.4",
  "update_available": true,
  "chart_version": "1.19.4",
  "track_app_version": true
}
```

`404 {"error":"component not found: {name}"}` when absent.

## Assessments

The assess job (pipeline step 2 — see docs/ARCHITECTURE.md) attaches one assessment report to the
latest inventory run; these endpoints serve it (record shape: docs/SCHEMA.md).

### `GET /api/v1/assessments`

The full latest assessment report. Optional `?risk_level=` narrows `assessments` to one risk level.

```json
{
  "generated_at": "2026-08-22 01:30:12 UTC",
  "inventory_generated_at": "2026-08-22 01:00:38 UTC",
  "assessments": [{ "name": "Cert-manager", "risk_level": "breaking", "…": "…" }]
}
```

`inventory_generated_at` is the `generated_at` of the inventory run the assessments were computed
from. `404 {"error":"no assessments yet — run the radar assess job first"}` before the first assess
run; `400 {"error":"invalid risk_level: … (expected one of …)"}` when the filter value isn't a known
risk level.

Risk levels: `breaking`, `deprecated`, `eol_warning`, `false_positive`, `floating_tag`,
`custom_fork`, `review`, `unknown`, `likely_safe`. Assessments are sorted most-urgent-first in
exactly that order.

### `GET /api/v1/assessments/{name}`

One assessment record. `name` is URL-encoded and matched exactly, like the component endpoints.

```json
{
  "name": "Cert-manager",
  "current": "v1.19.4",
  "latest": "v2.0.0",
  "risk_level": "breaking",
  "reason": "Major version bump: 1.19.4 → 2.0.0",
  "action": "Read migration guide before upgrading",
  "layer": "layer_0_precheck",
  "details": { "from": "v1.19.4", "to": "v2.0.0" }
}
```

`layer` names the analysis layer that produced the verdict; `details` carries layer-specific
evidence. `404 {"error":"assessment not found: {name}"}` when absent.

## Errors

| Status | Body                                                              | When                      |
| ------ | ----------------------------------------------------------------- | ------------------------- |
| 400    | `{"error":"invalid risk_level: … (expected one of …)"}`           | Bad `?risk_level=` filter |
| 404    | `{"error":"not found"}`                                           | Unknown path              |
| 404    | `{"error":"no inventory yet — run the radar job first"}`          | Store empty               |
| 404    | `{"error":"no assessments yet — run the radar assess job first"}` | No assessment run yet     |
| 404    | `{"error":"component not found: …"}`                              | Unknown component name    |
| 404    | `{"error":"assessment not found: …"}`                             | Unknown component name    |
| 405    | `{"error":"method not allowed"}`                                  | Non-GET on data endpoints |
| 503    | probe bodies above                                                | Store unreachable         |

## Notes

- There are no write endpoints by design. Refresh happens by running the job (Kubernetes
  Job/CronJob, later wfe); the API always serves the latest stored run.
- Responses are pretty-printed JSON with `content-type: application/json; charset=utf-8`.
- Component names are not unique across runs but are unique within one report (postgres enforces
  `PRIMARY KEY (run_id, name)`).
