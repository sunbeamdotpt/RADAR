import type { Store } from "../store/store.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/**
 * Read-only REST API.
 *
 *   GET /__lbheartbeat__          liveness probe (cluster contract)
 *   GET /__heartbeat__            readiness probe — checks store reachability
 *   GET /health                   JSON health summary
 *   GET /api/v1/inventory         latest report ({generated_at, components})
 *   GET /api/v1/components        latest report's component records
 *   GET /api/v1/components/{name} single component record
 */
export function createHandler(store: Store): (req: Request) => Promise<Response> {
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

    return json({ error: "not found" }, 404);
  };
}
