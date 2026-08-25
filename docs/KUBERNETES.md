# RADAR on Kubernetes

`deploy/` contains plain-YAML, kustomize-ready manifests following the sbbb conventions (no Helm, no
Ingress, `DOMAIN_SUFFIX` placeholders, secrets via the Vault Secrets Operator). **Nothing here is
applied yet** — this documents the layout and the out-of-band steps required when RADAR joins the
cluster.

## Layout

```
deploy/
├── kustomization.yaml    # namespace radar; wires images to oci.DOMAIN_SUFFIX/studio/radar-{api,job}
├── namespace.yaml
├── config.yaml           # radar-config ConfigMap: STORAGE, DOMAIN_SUFFIX, GIT_BASE_*, PORT
├── vault-secrets.yaml    # VaultAuth vso-auth + VaultDynamicSecret radar-db-creds (dsn key)
├── api-deployment.yaml   # 1 replica, probes /__lbheartbeat__ + /__heartbeat__
├── api-service.yaml      # ClusterIP :8080
├── job-cronjob.yaml      # suspended CronJob "23 */6 * * *", manual trigger or wfe later
└── assess-cronjob.yaml   # suspended CronJob "53 */6 * * *" (step 2, 30 min after inventory)
```

Render locally:

```bash
kustomize build deploy
```

## Runtime contract

- **API Deployment** — `envFrom: radar-config` + `DATABASE_URL` from the `radar-db-creds` secret
  (`dsn` key). Probes match the cluster contract; the server shuts down gracefully on SIGTERM.
- **Inventory CronJob** — same env wiring in the `sunbeam-radar-job` image. Suspended by default;
  trigger manually:

  ```bash
  kubectl -n radar create job --from=cronjob/radar-inventory radar-inventory-manual
  kubectl -n radar logs job/radar-inventory-manual
  ```

  Un-suspend for the 4×/day schedule, or let wfe invoke the same image/command — the job is
  idempotent and safe to re-run.
- **Assess CronJob** (`deploy/assess-cronjob.yaml`) — pipeline step 2. Reuses the same
  `sunbeam-radar-job` image; since that image's entrypoint is the inventory job, the pod overrides
  it with `command: ["deno"]` + `args: ["run", …, "src/assess/main.ts"]`. Scheduled `53 */6 * * *`,
  30 minutes after the inventory CronJob, and also suspended by default; trigger manually:

  ```bash
  kubectl -n radar create job --from=cronjob/radar-assess radar-assess-manual
  kubectl -n radar logs job/radar-assess-manual
  ```

  Same env wiring as the inventory job (`radar-config` + `radar-db-creds`); it reads the latest
  inventory run and needs one to exist.
- Both pods run as the `default` service account **with a token mounted** — VSO's Kubernetes auth
  needs it to sync `radar-db-creds`. `runAsNonRoot` + `seccompProfile: RuntimeDefault` are set at
  the pod level.

## Out-of-band integration steps (when adopting into sbbb)

These mirror how kanban/goalert are wired. Nothing below exists today.

1. **Database** — create `radar_db` and the `radar` user on the CNPG cluster via an idempotent Job
   in `base/data` (copy `base/data/postgres-goalert-db-job.yaml`, swap names). RADAR's schema
   (`db/migrations/001_init.sql`, `002_assessments.sql`) is applied by the app itself; the Job only
   needs `CREATE USER` / `CREATE DATABASE` / `GRANT`.
2. **OpenBao static role** — seed the database secrets-engine role `static-creds/radar` (see
   `base/openbao/vault-bootstrap-job.yaml` for the pattern), rotation matching the other app roles.
   This is what `deploy/vault-secrets.yaml` reads via `static-creds/radar`.
3. **Manifests into sbbb** — vendor `deploy/` as `base/radar/` in sbbb (keep the kustomization; the
   overlay already substitutes `DOMAIN_SUFFIX` and the image registry at
   `oci.sunbeam.pt/studio/sunbeam-radar-*`).
4. **Exposure (optional)** — RADAR has no Ingress. To browse the API, add an HTTPRoute in
   `base/ingress/routes.yaml` on the Sunbeam Proxy:

   ```yaml
   # sketch only — follow the existing entries in base/ingress/routes.yaml
   - name: radar
     host: radar.DOMAIN_SUFFIX
     backend: { namespace: radar, service: radar-api, port: 8080 }
   ```

5. **GITHUB_TOKEN (optional)** — without it the job is limited to 60 GitHub API calls/hour. To wire
   one: create kv entry `radar/github` in OpenBao, add a `VaultStaticSecret` to
   `deploy/vault-secrets.yaml` templating `GITHUB_TOKEN`, and add the corresponding `env` entry
   (secretKeyRef) to `job-cronjob.yaml`.

## From CronJob to wfe

The job image is the wfe payload: all inputs are env vars, output goes to postgres, exit code
signals success/failure, logs are JSON lines. A wfe workflow can invoke the same container (or
`deno task job` in the wfe runtime) on any schedule or trigger without code changes.
