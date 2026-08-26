import { assertEquals } from "jsr:@std/assert@^1";
import { createHandler } from "../../src/server/routes.ts";
import type { AssessmentReport } from "../../src/schema/assessment.ts";
import type { InventoryReport } from "../../src/schema/component.ts";
import type { DryRunReport } from "../../src/schema/dryrun.ts";
import type { AssessmentStore, DryRunStore, Store } from "../../src/store/store.ts";

class StubStore implements Store, AssessmentStore, DryRunStore {
  healthy = true;
  assessments: AssessmentReport | null = null;
  dryRuns: DryRunReport | null = null;
  constructor(public report: InventoryReport | null) {}
  loadPrevious(): Promise<InventoryReport | null> {
    return Promise.resolve(this.report);
  }
  saveReport(): Promise<void> {
    return Promise.resolve();
  }
  loadLatestAssessments(): Promise<AssessmentReport | null> {
    return Promise.resolve(this.assessments);
  }
  saveAssessments(report: AssessmentReport): Promise<void> {
    this.assessments = report;
    return Promise.resolve();
  }
  loadLatestDryRuns(): Promise<DryRunReport | null> {
    return Promise.resolve(this.dryRuns);
  }
  saveDryRuns(report: DryRunReport): Promise<void> {
    this.dryRuns = report;
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

const ASSESSMENTS: AssessmentReport = {
  generated_at: "2026-08-21 13:00:00 UTC",
  inventory_generated_at: "2026-08-21 12:00:00 UTC",
  assessments: [
    {
      name: "Kratos",
      current: "v25.4.0",
      latest: "v26.2.0",
      risk_level: "review",
      reason: "Ory non-semver scheme",
      action: "Review release notes",
      layer: "layer_0_hints",
      details: { hint: "versioning_scheme=ory" },
    },
    {
      name: "Valkey",
      current: "8-alpine",
      latest: "9.1.1",
      risk_level: "breaking",
      reason: "Major version bump: 8.0.0 → 9.1.1",
      action: "Read migration guide",
      layer: "layer_0_precheck",
      details: {},
    },
    {
      name: "CFSSL",
      current: "v1.6.5",
      latest: "v1.6.5",
      risk_level: "non_applicable",
      reason: "No drift",
      action: "Nothing to do",
      layer: "layer_0_in_sync",
      details: {},
    },
  ],
};

Deno.test("assessment endpoints 404 before the first assess run", async () => {
  const handler = createHandler(new StubStore(REPORT));
  for (const path of ["/api/v1/assessments", "/api/v1/assessments/Kratos"]) {
    const res = await get(handler, path);
    assertEquals(res.status, 404, path);
    assertEquals((await res.json()).error, "no assessments yet — run the radar assess job first");
  }
});

const DRY_RUNS: DryRunReport = {
  generated_at: "2026-08-21 14:00:00 UTC",
  inventory_generated_at: "2026-08-21 12:00:00 UTC",
  assessment_generated_at: "2026-08-21 13:00:00 UTC",
  dry_runs: [
    {
      name: "Longhorn",
      current: "v1.11.1",
      latest: "v1.12.0",
      namespace: "longhorn-system",
      kustomize_path: "/tmp/base/longhorn",
      status: "success",
      stdout: "created (dry-run)",
      stderr: "",
      duration_ms: 1234,
      mutated_helm_version: "v1.12.0",
      details: {},
    },
    {
      name: "Cert-manager",
      current: "v1.19.4",
      latest: "v1.20.0",
      namespace: "cert-manager",
      kustomize_path: "/tmp/base/cert-manager",
      status: "dryrun_failed",
      stdout: "",
      stderr: "no matches for kind Issuer",
      duration_ms: 567,
      mutated_helm_version: "v1.20.0",
      details: { kubectl_exit_code: 1 },
    },
  ],
};

Deno.test("assessments are served, filterable, and addressable by name", async () => {
  const store = new StubStore(REPORT);
  store.assessments = ASSESSMENTS;
  const handler = createHandler(store);

  const all = await (await get(handler, "/api/v1/assessments")).json();
  assertEquals(all.assessments.length, 3);
  assertEquals(all.inventory_generated_at, "2026-08-21 12:00:00 UTC");

  const breaking = await (await get(handler, "/api/v1/assessments?risk_level=breaking")).json();
  assertEquals(breaking.assessments.map((a: { name: string }) => a.name), ["Valkey"]);

  const na = await (await get(handler, "/api/v1/assessments?risk_level=non_applicable")).json();
  assertEquals(na.assessments.map((a: { name: string }) => a.name), ["CFSSL"]);

  const bad = await get(handler, "/api/v1/assessments?risk_level=spicy");
  assertEquals(bad.status, 400);

  const one = await (await get(handler, "/api/v1/assessments/Kratos")).json();
  assertEquals(one.risk_level, "review");

  const missing = await get(handler, "/api/v1/assessments/Nope");
  assertEquals(missing.status, 404);
});

Deno.test("dry-run endpoints 404 before the first dry-run job", async () => {
  const handler = createHandler(new StubStore(REPORT));
  for (const path of ["/api/v1/dryruns", "/api/v1/dryruns/Longhorn"]) {
    const res = await get(handler, path);
    assertEquals(res.status, 404, path);
    assertEquals((await res.json()).error, "no dry-runs yet — run the radar dry-run job first");
  }
});

Deno.test("dry-runs are served, filterable, and addressable by name", async () => {
  const store = new StubStore(REPORT);
  store.dryRuns = DRY_RUNS;
  const handler = createHandler(store);

  const all = await (await get(handler, "/api/v1/dryruns")).json();
  assertEquals(all.dry_runs.length, 2);
  assertEquals(all.inventory_generated_at, "2026-08-21 12:00:00 UTC");
  assertEquals(all.assessment_generated_at, "2026-08-21 13:00:00 UTC");

  const successes = await (await get(handler, "/api/v1/dryruns?status=success")).json();
  assertEquals(successes.dry_runs.map((d: { name: string }) => d.name), ["Longhorn"]);

  const bad = await get(handler, "/api/v1/dryruns?status=spicy");
  assertEquals(bad.status, 400);

  const one = await (await get(handler, "/api/v1/dryruns/Cert-manager")).json();
  assertEquals(one.status, "dryrun_failed");

  const missing = await get(handler, "/api/v1/dryruns/Nope");
  assertEquals(missing.status, 404);
});
