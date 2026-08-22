import { assertEquals } from "jsr:@std/assert@^1";
import { createHandler } from "../../src/server/routes.ts";
import type { InventoryReport } from "../../src/schema/component.ts";
import type { Store } from "../../src/store/store.ts";

class StubStore implements Store {
  healthy = true;
  constructor(public report: InventoryReport | null) {}
  loadPrevious(): Promise<InventoryReport | null> {
    return Promise.resolve(this.report);
  }
  saveReport(): Promise<void> {
    return Promise.resolve();
  }
  healthCheck(): Promise<boolean> {
    return Promise.resolve(this.healthy);
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

const REPORT: InventoryReport = {
  generated_at: "2026-08-21 12:00:00 UTC",
  components: [
    {
      name: "CFSSL",
      namespace: "cert-manager",
      current: "v1.6.5",
      latest: "v1.7.0",
      source: "github_release",
      upstream: "cloudflare/cfssl",
      link_template: "https://github.com/cloudflare/cfssl/releases/tag/{tag}",
      notes: "",
      update_available: true,
    },
    {
      name: "Scaleway cert-manager webhook",
      namespace: "cert-manager",
      current: "v0.1.1",
      latest: "v0.2.0",
      source: "docker_hub",
      upstream: "scaleway/cert-manager-webhook-scaleway",
      link_template: "https://hub.docker.com/r/scaleway/cert-manager-webhook-scaleway/tags",
      notes: "",
      update_available: true,
    },
  ],
};

function get(handler: (req: Request) => Promise<Response>, path: string, method = "GET") {
  return handler(new Request(`http://localhost${path}`, { method }));
}

Deno.test("liveness probe always answers ok", async () => {
  const handler = createHandler(new StubStore(null));
  const res = await get(handler, "/__lbheartbeat__");
  assertEquals(res.status, 200);
  assertEquals(await res.text(), "ok");
});

Deno.test("readiness probe reflects store health", async () => {
  const store = new StubStore(null);
  const handler = createHandler(store);
  assertEquals((await get(handler, "/__heartbeat__")).status, 200);
  store.healthy = false;
  const res = await get(handler, "/__heartbeat__");
  assertEquals(res.status, 503);
  assertEquals(await res.text(), "unavailable");
});

Deno.test("/health returns JSON status", async () => {
  const handler = createHandler(new StubStore(null));
  const res = await get(handler, "/health");
  assertEquals(res.status, 200);
  assertEquals((await res.json()).status, "ok");
});

Deno.test("inventory endpoints 404 before the first run", async () => {
  const handler = createHandler(new StubStore(null));
  for (const path of ["/api/v1/inventory", "/api/v1/components", "/api/v1/components/CFSSL"]) {
    const res = await get(handler, path);
    assertEquals(res.status, 404, path);
    assertEquals((await res.json()).error, "no inventory yet — run the radar job first");
  }
});

Deno.test("inventory and components are served from the latest report", async () => {
  const handler = createHandler(new StubStore(REPORT));
  const inventory = await (await get(handler, "/api/v1/inventory")).json();
  assertEquals(inventory.generated_at, "2026-08-21 12:00:00 UTC");
  assertEquals(inventory.components.length, 2);

  const components = await (await get(handler, "/api/v1/components")).json();
  assertEquals(components.map((c: { name: string }) => c.name), [
    "CFSSL",
    "Scaleway cert-manager webhook",
  ]);
});

Deno.test("component lookup by name, including spaces", async () => {
  const handler = createHandler(new StubStore(REPORT));
  const res = await get(
    handler,
    `/api/v1/components/${encodeURIComponent("Scaleway cert-manager webhook")}`,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.upstream, "scaleway/cert-manager-webhook-scaleway");

  const missing = await get(handler, "/api/v1/components/Nope");
  assertEquals(missing.status, 404);
  assertEquals((await missing.json()).error, "component not found: Nope");
});

Deno.test("unknown paths and non-GET methods are rejected", async () => {
  const handler = createHandler(new StubStore(REPORT));
  assertEquals((await get(handler, "/nope")).status, 404);
  assertEquals((await get(handler, "/api/v1/inventory", "POST")).status, 405);
});
