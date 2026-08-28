import { parseGeneratedAtUtc } from "../domain/time.ts";
import { RISK_LEVELS } from "../schema/assessment.ts";
import { DRYRUN_STATUSES } from "../schema/dryrun.ts";
import type { AssessmentStore, DryRunStore, Store } from "../store/store.ts";
import type { ServerConfig } from "./config.ts";
import { renderDashboard } from "./dashboard.ts";
import { renderDryRunOutput } from "./dryrun_output.ts";
import {
  createCounter,
  createGauge,
  createHistogram,
  type Metric,
  metricsHandler,
  resetMetrics,
} from "../telemetry/prometheus.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// ---------------------------------------------------------------------------
// Prometheus metrics
// ---------------------------------------------------------------------------

const httpRequestsTotal = createCounter(
  "radar_http_requests_total",
  "Total HTTP requests served by the RADAR API",
  ["method", "route", "status"],
);

const httpRequestDuration = createHistogram(
  "radar_http_request_duration_seconds",
  "HTTP request duration in seconds",
  ["method", "route", "status"],
);

const storeReachable = createGauge(
  "radar_store_reachable",
  "1 if the store health check succeeded, 0 otherwise",
);

const lastRunTimestamp = createGauge(
  "radar_last_run_timestamp_seconds",
  "Unix timestamp of the latest run, by kind",
  ["kind"],
);

const componentsTotal = createGauge(
  "radar_components_total",
  "Number of components in the latest inventory, by source, risk level, and update availability",
  ["source", "risk_level", "update_available"],
);

const dryRunsTotal = createGauge(
  "radar_dryruns_total",
  "Number of namespaces in the latest dry-run report, by status",
  ["status"],
);

const allRouteMetrics: Metric[] = [
  httpRequestsTotal,
  httpRequestDuration,
  storeReachable,
  lastRunTimestamp,
  componentsTotal,
  dryRunsTotal,
];

export function resetRouteMetrics(): void {
  for (const m of allRouteMetrics) m.reset();
}

function normalizeRoute(path: string): string {
  if (path === "/__lbheartbeat__") return "/__lbheartbeat__";
  if (path === "/__heartbeat__") return "/__heartbeat__";
  if (path === "/health") return "/health";
  if (path === "/metrics") return "/metrics";
  if (path === "/api/v1/inventory") return "/api/v1/inventory";
  if (path === "/api/v1/components") return "/api/v1/components";
  if (path.startsWith("/api/v1/components/")) return "/api/v1/components/{name}";
  if (path === "/api/v1/assessments") return "/api/v1/assessments";
  if (path.startsWith("/api/v1/assessments/")) return "/api/v1/assessments/{name}";
  if (path === "/api/v1/dryruns") return "/api/v1/dryruns";
  if (path.startsWith("/api/v1/dryruns/")) return "/api/v1/dryruns/{namespace}";
  return "__unknown__";
}

async function refreshBusinessMetrics(
  store: Store & AssessmentStore & DryRunStore,
): Promise<void> {
  const healthy = await store.healthCheck();
  storeReachable.set(healthy ? 1 : 0);

  const inventory = await store.loadPrevious();
  const assessments = await store.loadLatestAssessments();
  const dryRuns = await store.loadLatestDryRuns();

  lastRunTimestamp.set(
    inventory ? parseGeneratedAtUtc(inventory.generated_at).getTime() / 1000 : 0,
    { kind: "inventory" },
  );
  lastRunTimestamp.set(
    assessments ? parseGeneratedAtUtc(assessments.generated_at).getTime() / 1000 : 0,
    { kind: "assess" },
  );
  lastRunTimestamp.set(
    dryRuns ? parseGeneratedAtUtc(dryRuns.generated_at).getTime() / 1000 : 0,
    { kind: "dryrun" },
  );

  componentsTotal.reset();
  if (inventory && assessments) {
    const riskByName = new Map(assessments.assessments.map((a) => [a.name, a.risk_level]));
    const counts = new Map<string, number>();
    for (const c of inventory.components) {
      const key = JSON.stringify({
        source: c.source,
        risk_level: riskByName.get(c.name) ?? "unknown",
        update_available: String(c.update_available),
      });
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [key, count] of counts.entries()) {
      const labels = JSON.parse(key) as Record<string, string>;
      componentsTotal.set(count, labels);
    }
  }

  dryRunsTotal.reset();
  if (dryRuns) {
    const counts = new Map<string, number>();
    for (const d of dryRuns.dry_runs) {
      counts.set(d.status, (counts.get(d.status) ?? 0) + 1);
    }
    for (const [status, count] of counts.entries()) {
      dryRunsTotal.set(count, { status });
    }
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/**
 * Read-only REST API.
 *
 *   GET /__lbheartbeat__                     liveness probe (cluster contract)
 *   GET /__heartbeat__                       readiness probe — store reachability
 *   GET /health                              JSON health summary
 *   GET /metrics                             Prometheus metrics
 *   GET /api/v1/inventory                    latest report ({generated_at, components})
 *   GET /api/v1/components                   latest report's component records
 *   GET /api/v1/components/{name}            single component record
 *   GET /api/v1/assessments[?risk_level=…]   latest assessment report (optionally filtered)
 *   GET /api/v1/assessments/{name}           single assessment
 *   GET /api/v1/dryruns[?status=…]           latest dry-run report (optionally filtered)
 *   GET /api/v1/dryruns/{name}               single dry-run result
 */
export function createHandler(
  store: Store & AssessmentStore & DryRunStore,
  config: ServerConfig,
): (req: Request) => Promise<Response> {
  const inner = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/__lbheartbeat__") {
      return new Response("ok", { headers: { "content-type": "text/plain" } });
    }

    if (req.method !== "GET") {
      return json({ error: "method not allowed" }, 405);
    }

    if (path === "/" && config.dashboardEnabled) {
      return renderDashboard();
    }

    if (path === "/output" && config.dashboardEnabled) {
      const report = await store.loadLatestDryRuns();
      const namespace = url.searchParams.get("namespace");
      if (!namespace) {
        return json({ error: "namespace query param required" }, 400);
      }
      const dryRun = report?.dry_runs.find((d) => d.namespace === namespace);
      return renderDryRunOutput(namespace, dryRun);
    }

    if (path === "/assets/sunbeam.png") {
      try {
        const data = await Deno.readFile("./assets/sunbeam.png");
        return new Response(data, {
          headers: { "content-type": "image/png", "cache-control": "public, max-age=3600" },
        });
      } catch {
        return json({ error: "not found" }, 404);
      }
    }

    if (path === "/__heartbeat__") {
      const healthy = await store.healthCheck();
      return new Response(healthy ? "ok" : "unavailable", {
        status: healthy ? 200 : 503,
        headers: { "content-type": "text/plain" },
      });
    }

    if (path === "/health") {
      const healthy = await store.healthCheck();
      return json({
        status: healthy ? "ok" : "error",
        storage: healthy ? "reachable" : "unreachable",
      }, healthy ? 200 : 503);
    }

    if (path === "/metrics") {
      await refreshBusinessMetrics(store);
      return metricsHandler();
    }

    if (
      path === "/api/v1/inventory" || path === "/api/v1/components" ||
      path.startsWith("/api/v1/components/")
    ) {
      const report = await store.loadPrevious();
      if (!report) {
        return json({ error: "no inventory yet — run the radar job first" }, 404);
      }
      if (path === "/api/v1/inventory") {
        return json(report);
      }
      if (path === "/api/v1/components") {
        return json(report.components);
      }
      const name = decodeURIComponent(path.slice("/api/v1/components/".length));
      const component = report.components.find((c) => c.name === name);
      if (!component) {
        return json({ error: `component not found: ${name}` }, 404);
      }
      return json(component);
    }

    if (path === "/api/v1/assessments" || path.startsWith("/api/v1/assessments/")) {
      const report = await store.loadLatestAssessments();
      if (!report) {
        return json({ error: "no assessments yet — run the radar assess job first" }, 404);
      }
      if (path === "/api/v1/assessments") {
        const riskLevel = url.searchParams.get("risk_level");
        if (riskLevel !== null) {
          if (!(RISK_LEVELS as readonly string[]).includes(riskLevel)) {
            return json({
              error: `invalid risk_level: ${riskLevel} (expected one of ${RISK_LEVELS.join(", ")})`,
            }, 400);
          }
          return json({
            ...report,
            assessments: report.assessments.filter((a) => a.risk_level === riskLevel),
          });
        }
        return json(report);
      }
      const name = decodeURIComponent(path.slice("/api/v1/assessments/".length));
      const assessment = report.assessments.find((a) => a.name === name);
      if (!assessment) {
        return json({ error: `assessment not found: ${name}` }, 404);
      }
      return json(assessment);
    }

    if (path === "/api/v1/dryruns" || path.startsWith("/api/v1/dryruns/")) {
      const report = await store.loadLatestDryRuns();
      if (!report) {
        return json({ error: "no dry-runs yet — run the radar dry-run job first" }, 404);
      }
      if (path === "/api/v1/dryruns") {
        const status = url.searchParams.get("status");
        const namespace = url.searchParams.get("namespace");
        if (status !== null) {
          if (!(DRYRUN_STATUSES as readonly string[]).includes(status)) {
            return json({
              error: `invalid status: ${status} (expected one of ${DRYRUN_STATUSES.join(", ")})`,
            }, 400);
          }
          return json({
            ...report,
            dry_runs: report.dry_runs.filter((d) => d.status === status),
          });
        }
        if (namespace !== null) {
          const filtered = report.dry_runs.filter((d) => d.namespace === namespace);
          if (filtered.length === 0) {
            return json({ error: `dry-run not found: ${namespace}` }, 404);
          }
          return json({ ...report, dry_runs: filtered });
        }
        return json(report);
      }
      const namespace = decodeURIComponent(path.slice("/api/v1/dryruns/".length));
      const dryRun = report.dry_runs.find((d) => d.namespace === namespace);
      if (!dryRun) {
        return json({ error: `dry-run not found: ${namespace}` }, 404);
      }
      return json(dryRun);
    }

    return json({ error: "not found" }, 404);
  };

  return async (req: Request): Promise<Response> => {
    const start = performance.now();
    const route = normalizeRoute(new URL(req.url).pathname);
    const response = await inner(req);
    const duration = (performance.now() - start) / 1000;
    const labels = {
      method: req.method,
      route,
      status: String(response.status),
    };
    httpRequestsTotal.add(1, labels);
    httpRequestDuration.observe(duration, labels);
    return response;
  };
}

// Re-export so tests and the telemetry module can clear state.
export { resetMetrics };
