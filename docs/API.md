# RADAR REST API

Read-only JSON over the latest stored inventory report. Base URL in local dev:
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

## Errors

| Status | Body                                                     | When                      |
| ------ | -------------------------------------------------------- | ------------------------- |
| 404    | `{"error":"not found"}`                                  | Unknown path              |
| 404    | `{"error":"no inventory yet — run the radar job first"}` | Store empty               |
| 404    | `{"error":"component not found: …"}`                     | Unknown component name    |
| 405    | `{"error":"method not allowed"}`                         | Non-GET on data endpoints |
| 503    | probe bodies above                                       | Store unreachable         |

## Notes

- There are no write endpoints by design. Refresh happens by running the job (Kubernetes
  Job/CronJob, later wfe); the API always serves the latest stored run.
- Responses are pretty-printed JSON with `content-type: application/json; charset=utf-8`.
- Component names are not unique across runs but are unique within one report (postgres enforces
  `PRIMARY KEY (run_id, name)`).
