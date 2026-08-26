# RADAR step 3 dry-run — follow-up plan

Status: captured after first live-cluster validation (commit `a1df7ce`).
The dry-run job now reaches the cluster and executes real `kubectl apply --dry-run=server` calls.
The items below are the remaining gaps found during that validation.

## 1. Chart-version resolution for `track_app_version=true` components

**Problem**
For Helm components with `track_app_version: true`, the inventory job stores the
_latest app version_ in `component.latest`. The kustomization's `helmCharts`
entry, however, expects a _chart version_. When the dry-run runner mutates the
kustomization to `component.latest`, `kustomize build` fails with:

```text
Error: chart "zot" version "v2.1.18" not found in https://zotregistry.dev/helm-charts repository
```

Affected likely_safe drifted components seen in validation:
- Zot (`latest=v2.1.18` app version, chart version is something like `0.1.xxx`)
- Loki (`latest=3.6.12` app version, chart version is `6.x.x`)
- scaleway-certmanager-webhook
- Longhorn, Vault Secrets Operator, OpenBao, NATS server, Cert-manager (also `track_app_version=true`, but either not mapped or not likely_safe at the time)

Only `kube-prometheus-stack` (`track_app_version=false`) successfully reached
kubectl in the validation run.

**Proposed fix**
Add a resolver that, given a Helm repo URL, chart name, and target app version,
fetches `index.yaml` and returns the chart version of the newest entry whose
`appVersion` matches the target. If no exact match exists, return the chart
version of the newest entry whose normalized app version matches.

- Add to `src/sources/helm_chart.ts`:
  ```ts
  export async function resolveChartVersionForAppVersion(
    repoUrl: string,
    chartName: string,
    appVersion: string,
    http: HttpClient,
  ): Promise<string | null>
  ```
- Plumb an `HttpClient` (or a small fetch wrapper) into the dry-run runner deps.
- In `src/dryrun/runner.ts` `runComponentDryRun`, when
  `component.track_app_version` is true, call the resolver and mutate to the
  returned chart version instead of `component.latest`.
- If resolution fails, return a new `DryRunStatus` such as
  `skipped_chart_resolution_failed` (or reuse `skipped_unsupported_source` with a
  clear reason).

**Files to touch**
- `src/sources/helm_chart.ts`
- `src/dryrun/runner.ts`
- `src/dryrun/run.ts` (pass http client to runner deps)
- `src/dryrun/main.ts` (create http client)
- `src/schema/dryrun.ts` (add new status if needed)
- `tests/unit/dryrun_runner_test.ts`
- `tests/unit/sources/helm_chart_test.ts` (or extend existing)

---

## 2. Shared kustomization bases inflate unrelated charts

**Problem**
`sbbb/base/monitoring/kustomization.yaml` contains multiple `helmCharts`
entries (kube-prometheus-stack, Loki, etc.). When RADAR dry-runs Loki, it
mutates only Loki's chart version but `kustomize build` renders the entire base,
including kube-prometheus-stack. This:
- is slower than necessary,
- can fail because of unrelated charts,
- makes it hard to attribute a failure to the component being tested.

**Options**

a. **Accept current behavior** (simplest). A base is a deployment unit; testing
the whole base is arguably correct. Document that dry-run failures in shared
bases may be caused by sibling charts.

b. **Generate a scoped kustomization** (cleanest). Before running `kustomize
build`, create a temporary kustomization that:
   - copies only the relevant `helmCharts` entry,
   - references the same `valuesFile` and other local resources,
   - runs `kustomize build` against that scoped copy.
   This keeps sibling charts out of the render.

c. **Use a kustomize component/overlay per chart**. Requires changing the sbbb
repo layout; out of scope for RADAR.

**Recommendation**: implement option (b). It keeps the dry-run focused on one
component while still using the real chart values and resources from the base.

**Files to touch**
- `src/dryrun/runner.ts`
- `tests/unit/dryrun_runner_test.ts`

---

## 3. Large stdout/stderr truncation hides the real error

**Problem**
`result()` truncates `stdout` and `stderr` to 100,000 characters. For large
manifests such as kube-prometheus-stack, the useful error is at the _end_ of
stderr, after many "missing last-applied-configuration" warnings. The current
truncation keeps the beginning, so the actual `Error from server (Invalid)` may
be cut off.

**Proposed fix**
Keep the tail for failures and the head for successes:

```ts
const keepHead = status === "success" || status === "build_failed" /* ? */;
const out = keepHead ? s.slice(0, cap) : s.slice(-cap);
```

For `dryrun_failed` and `build_failed`, keep the last 100k characters so the
actual error is visible. For `success`, keep the first 100k characters.

**Files to touch**
- `src/dryrun/runner.ts`

---

## 4. (Minor) Dev networking is Linux-specific

**Problem**
`scripts/dev-dryrun.sh` uses `--network host` when a kubeconfig is provided so
that `127.0.0.1:6443` port-forwards are reachable. This works on Linux but not
on Docker Desktop, and it removes container DNS isolation.

**Options**
- Document the limitation and recommend `kubectl port-forward --address 0.0.0.0`
  plus `host.docker.internal` on macOS/Windows.
- Rewrite `127.0.0.1` / `localhost` in the copied kubeconfig to
  `host.docker.internal` and add `--add-host=host.docker.internal:host-gateway`.

**Recommendation**: document for now; revisit if the dev team uses mixed OSes.

**Files to touch**
- `docs/DEVELOPMENT.md`
- `scripts/dev-dryrun.sh` (optional)

---

## Suggested implementation order

1. Chart-version resolution (#1) — unblocks the majority of likely_safe helm
   components from reaching kubectl.
2. Scoped kustomization (#2) — makes failures attributable and speeds up runs.
3. Tail-truncation for errors (#3) — improves debuggability.
4. Documentation (#4) — low priority.

## Acceptance criteria for #1

- `deno task check` passes.
- Coverage remains ≥95%.
- A dry-run against the dev stack with `RADAR_DRYRUN_KUBECONFIG` set succeeds
  (reaches kubectl) for at least one `track_app_version=true` component such as
  Zot or Loki, or reports a clear cluster validation error instead of a Helm
  chart-not-found build failure.
