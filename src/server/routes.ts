import type { AssessmentStore, Store } from "../store/store.ts";
import { RISK_LEVELS } from "../schema/assessment.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/**
 * Read-only REST API.
 *
 *   GET /__lbheartbeat__                     liveness probe (cluster contract)
 *   GET /__heartbeat__                       readiness probe — store reachability
 *   GET /health                              JSON health summary
 *   GET /api/v1/inventory                    latest report ({generated_at, components})
 *   GET /api/v1/components                   latest report's component records
 *   GET /api/v1/components/{name}            single component record
 *   GET /api/v1/assessments[?risk_level=…]   latest assessment report (optionally filtered)
 *   GET /api/v1/assessments/{name}           single assessment
 */
export function createHandler(
  store: Store & AssessmentStore,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/__lbheartbeat__") {
      return new Response("ok", { headers: { "content-type": "text/plain" } });
    }

    if (req.method !== "GET") {
      return json({ error: "method not allowed" }, 405);
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

    return json({ error: "not found" }, 404);
  };
}
