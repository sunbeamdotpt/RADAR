import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";
import type { ServerConfig } from "../../src/server/config.ts";
import { createHandler, resetRouteMetrics } from "../../src/server/routes.ts";
import { renderDryRunOutput } from "../../src/server/dryrun_output.ts";
import type { AssessmentReport } from "../../src/schema/assessment.ts";
import type { InventoryReport } from "../../src/schema/component.ts";
import type { DryRun, DryRunReport } from "../../src/schema/dryrun.ts";
import type { AssessmentStore, DryRunStore, Store } from "../../src/store/store.ts";

const DEFAULT_CONFIG: ServerConfig = {
  storage: "json",
  jsonPath: "./data/component-versions.json",
  databaseUrl: undefined,
  hostname: "0.0.0.0",
  port: 8080,
  dashboardEnabled: true,
  grafanaUrl: undefined,
};

const DISABLED_DASHBOARD_CONFIG: ServerConfig = { ...DEFAULT_CONFIG, dashboardEnabled: false };

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
  const handler = createHandler(new StubStore(null), DEFAULT_CONFIG);
  const res = await get(handler, "/__lbheartbeat__");
  assertEquals(res.status, 200);
  assertEquals(await res.text(), "ok");
});

Deno.test("readiness probe reflects store health", async () => {
  const store = new StubStore(null);
  const handler = createHandler(store, DEFAULT_CONFIG);
  assertEquals((await get(handler, "/__heartbeat__")).status, 200);
  store.healthy = false;
  const res = await get(handler, "/__heartbeat__");
  assertEquals(res.status, 503);
  assertEquals(await res.text(), "unavailable");
});

Deno.test("/health returns JSON status", async () => {
  const handler = createHandler(new StubStore(null), DEFAULT_CONFIG);
  const res = await get(handler, "/health");
  assertEquals(res.status, 200);
  assertEquals((await res.json()).status, "ok");
});

Deno.test("inventory endpoints 404 before the first run", async () => {
  const handler = createHandler(new StubStore(null), DEFAULT_CONFIG);
  for (const path of ["/api/v1/inventory", "/api/v1/components", "/api/v1/components/CFSSL"]) {
    const res = await get(handler, path);
    assertEquals(res.status, 404, path);
    assertEquals((await res.json()).error, "no inventory yet — run the radar job first");
  }
});

Deno.test("inventory and components are served from the latest report", async () => {
  const handler = createHandler(new StubStore(REPORT), DEFAULT_CONFIG);
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
  const handler = createHandler(new StubStore(REPORT), DEFAULT_CONFIG);
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
  const handler = createHandler(new StubStore(REPORT), DEFAULT_CONFIG);
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
  const handler = createHandler(new StubStore(REPORT), DEFAULT_CONFIG);
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
      namespace: "longhorn-system",
      components: ["Longhorn"],
      status: "success",
      stdout: "created (dry-run)",
      stderr: "",
      duration_ms: 1234,
      details: {},
    },
    {
      namespace: "cert-manager",
      components: ["Cert-manager"],
      status: "dryrun_failed",
      stdout: "",
      stderr: "no matches for kind Issuer",
      duration_ms: 567,
      details: { kubectl_exit_code: 1 },
    },
  ],
};

Deno.test("assessments are served, filterable, and addressable by name", async () => {
  const store = new StubStore(REPORT);
  store.assessments = ASSESSMENTS;
  const handler = createHandler(store, DEFAULT_CONFIG);

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
  const handler = createHandler(new StubStore(REPORT), DEFAULT_CONFIG);
  for (const path of ["/api/v1/dryruns", "/api/v1/dryruns/longhorn-system"]) {
    const res = await get(handler, path);
    assertEquals(res.status, 404, path);
    assertEquals((await res.json()).error, "no dry-runs yet — run the radar dry-run job first");
  }
});

Deno.test("dry-runs are served, filterable, and addressable by namespace", async () => {
  const store = new StubStore(REPORT);
  store.dryRuns = DRY_RUNS;
  const handler = createHandler(store, DEFAULT_CONFIG);

  const all = await (await get(handler, "/api/v1/dryruns")).json();
  assertEquals(all.dry_runs.length, 2);
  assertEquals(all.inventory_generated_at, "2026-08-21 12:00:00 UTC");
  assertEquals(all.assessment_generated_at, "2026-08-21 13:00:00 UTC");

  const successes = await (await get(handler, "/api/v1/dryruns?status=success")).json();
  assertEquals(successes.dry_runs.map((d: { namespace: string }) => d.namespace), [
    "longhorn-system",
  ]);

  const byNamespace = await (await get(handler, "/api/v1/dryruns?namespace=cert-manager")).json();
  assertEquals(byNamespace.dry_runs.length, 1);
  assertEquals(byNamespace.dry_runs[0].status, "dryrun_failed");

  const missingNamespace = await get(handler, "/api/v1/dryruns?namespace=Nope");
  assertEquals(missingNamespace.status, 404);

  const bad = await get(handler, "/api/v1/dryruns?status=spicy");
  assertEquals(bad.status, 400);

  const one = await (await get(handler, "/api/v1/dryruns/cert-manager")).json();
  assertEquals(one.status, "dryrun_failed");

  const missing = await get(handler, "/api/v1/dryruns/Nope");
  assertEquals(missing.status, 404);
});

Deno.test("/metrics exposes Prometheus text with business metrics", async () => {
  resetRouteMetrics();
  const store = new StubStore(REPORT);
  store.assessments = ASSESSMENTS;
  store.dryRuns = DRY_RUNS;
  const handler = createHandler(store, DEFAULT_CONFIG);

  const res = await get(handler, "/metrics");
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "text/plain; version=0.0.4; charset=utf-8");

  const body = await res.text();
  assertStringIncludes(body, "# HELP radar_http_requests_total");
  assertStringIncludes(body, "# HELP radar_components_total");
  assertStringIncludes(body, "radar_store_reachable 1");
  assertStringIncludes(body, 'source="github_release"');
  assertStringIncludes(body, 'radar_components_total{risk_level="non_applicable",');
  assertStringIncludes(body, 'radar_dryruns_total{status="success"} 1');
});

Deno.test("HTTP requests are counted and timed", async () => {
  resetRouteMetrics();
  const handler = createHandler(new StubStore(null), DEFAULT_CONFIG);
  await get(handler, "/__lbheartbeat__");
  await get(handler, "/api/v1/inventory");

  const res = await get(handler, "/metrics");
  const body = await res.text();
  assertStringIncludes(
    body,
    'radar_http_requests_total{method="GET",route="/__lbheartbeat__",status="200"} 1',
  );
  assertStringIncludes(
    body,
    'radar_http_requests_total{method="GET",route="/api/v1/inventory",status="404"} 1',
  );
});

Deno.test("dashboard is served at / when enabled", async () => {
  const handler = createHandler(new StubStore(REPORT), DEFAULT_CONFIG);
  const res = await get(handler, "/");
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "text/html; charset=utf-8");
  const body = await res.text();
  assertStringIncludes(body, "Sunbeam RADAR");
  assertStringIncludes(body, "/api/v1/components");
  assertStringIncludes(body, "/api/v1/assessments");
  assertStringIncludes(body, "/api/v1/dryruns");
  assertStringIncludes(body, "show output");
  assertStringIncludes(body, 'id="output-modal"');
  assertStringIncludes(body, "output-preview-trigger");
  assertStringIncludes(body, "data-namespace=");
});

Deno.test("dashboard is hidden at / when disabled", async () => {
  const handler = createHandler(new StubStore(REPORT), DISABLED_DASHBOARD_CONFIG);
  const res = await get(handler, "/");
  assertEquals(res.status, 404);
  assertEquals((await res.json()).error, "not found");
});

Deno.test("dashboard omits Grafana link when RADAR_GRAFANA_URL is unset", async () => {
  const handler = createHandler(new StubStore(REPORT), DEFAULT_CONFIG);
  const body = await (await get(handler, "/")).text();
  assertEquals(body.includes("/assets/grafana.svg"), false);
  assertEquals(body.includes("Open Grafana dashboard"), false);
});

Deno.test("dashboard includes Grafana link when RADAR_GRAFANA_URL is set", async () => {
  const config = { ...DEFAULT_CONFIG, grafanaUrl: "https://metrics.example.com/" };
  const handler = createHandler(new StubStore(REPORT), config);
  const body = await (await get(handler, "/")).text();
  assertStringIncludes(body, "/assets/grafana.svg");
  assertStringIncludes(body, 'href="https://metrics.example.com/"');
  assertStringIncludes(body, "Open Grafana dashboard");
});

Deno.test("dashboard includes theme toggle and data-theme support", async () => {
  const handler = createHandler(new StubStore(REPORT), DEFAULT_CONFIG);
  const body = await (await get(handler, "/")).text();
  assertStringIncludes(body, 'data-theme="dark"');
  assertStringIncludes(body, 'id="theme-toggle"');
  assertStringIncludes(body, 'id="theme-icon"');
  assertStringIncludes(body, "localStorage.getItem('radar-theme')");
  assertStringIncludes(body, "document.documentElement.dataset.theme");
});

Deno.test("/assets/grafana.svg serves the bundled icon", async () => {
  const handler = createHandler(new StubStore(REPORT), DEFAULT_CONFIG);
  const res = await get(handler, "/assets/grafana.svg");
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "image/svg+xml");
  const body = await res.text();
  assertStringIncludes(body, "<svg");
});

const TEST_DRYRUN: DryRun = {
  namespace: "oci",
  components: ["zot"],
  status: "success",
  stdout: '{"kind":"List"}\n',
  stderr: "warning\n",
  duration_ms: 1234,
  details: {
    sunbeam_stderr: '{"level":"INFO"}\n',
    components: ["zot"],
  },
};

Deno.test("renderDryRunOutput renders dry-run sections and escapes HTML", async () => {
  const res = renderDryRunOutput("oci", {
    ...TEST_DRYRUN,
    stdout: "<script>",
    stderr: '&"',
    details: { sunbeam_stderr: "line1\nline2" },
  });
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "text/html; charset=utf-8");
  const body = await res.text();
  assertStringIncludes(body, "Dry-run oci");
  assertStringIncludes(body, "status-success");
  assertStringIncludes(body, "&lt;script&gt;");
  assertStringIncludes(body, "&amp;&quot;");
  assertStringIncludes(body, "line1\nline2");
  assertStringIncludes(body, "radar-glow");
});

Deno.test("renderDryRunOutput returns 404 when dry-run is missing", async () => {
  const res = renderDryRunOutput("missing", undefined);
  assertEquals(res.status, 404);
  const body = await res.text();
  assertStringIncludes(body, "Dry-run for namespace");
  assertStringIncludes(body, "missing");
  assertStringIncludes(body, "radar-glow");
});

Deno.test("renderDryRunOutput omits Grafana link when url is unset", async () => {
  const res = renderDryRunOutput("oci", TEST_DRYRUN);
  const body = await res.text();
  assertEquals(body.includes("/assets/grafana.svg"), false);
});

Deno.test("renderDryRunOutput includes Grafana link when url is set", async () => {
  const res = renderDryRunOutput("oci", TEST_DRYRUN, "https://metrics.example.com/");
  const body = await res.text();
  assertStringIncludes(body, "/assets/grafana.svg");
  assertStringIncludes(body, 'href="https://metrics.example.com/"');
});

Deno.test("/output serves dry-run report when dashboard is enabled", async () => {
  const store = new StubStore(REPORT);
  store.dryRuns = {
    generated_at: "2026-08-21 12:00:00 UTC",
    inventory_generated_at: "2026-08-21 12:00:00 UTC",
    assessment_generated_at: "2026-08-21 12:00:00 UTC",
    dry_runs: [TEST_DRYRUN],
  };
  const handler = createHandler(store, DEFAULT_CONFIG);
  const res = await get(handler, "/output?namespace=oci");
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "text/html; charset=utf-8");
  const body = await res.text();
  assertStringIncludes(body, "oci");
  assertStringIncludes(body, "success");
  assertStringIncludes(body, "kubectl stdout");
});

Deno.test("/output includes Grafana link when RADAR_GRAFANA_URL is set", async () => {
  const store = new StubStore(REPORT);
  store.dryRuns = {
    generated_at: "2026-08-21 12:00:00 UTC",
    inventory_generated_at: "2026-08-21 12:00:00 UTC",
    assessment_generated_at: "2026-08-21 12:00:00 UTC",
    dry_runs: [TEST_DRYRUN],
  };
  const config = { ...DEFAULT_CONFIG, grafanaUrl: "https://metrics.example.com/" };
  const handler = createHandler(store, config);
  const body = await (await get(handler, "/output?namespace=oci")).text();
  assertStringIncludes(body, "/assets/grafana.svg");
  assertStringIncludes(body, 'href="https://metrics.example.com/"');
});

Deno.test("/output includes theme toggle and data-theme support", async () => {
  const store = new StubStore(REPORT);
  store.dryRuns = {
    generated_at: "2026-08-21 12:00:00 UTC",
    inventory_generated_at: "2026-08-21 12:00:00 UTC",
    assessment_generated_at: "2026-08-21 12:00:00 UTC",
    dry_runs: [TEST_DRYRUN],
  };
  const handler = createHandler(store, DEFAULT_CONFIG);
  const body = await (await get(handler, "/output?namespace=oci")).text();
  assertStringIncludes(body, 'data-theme="dark"');
  assertStringIncludes(body, 'id="theme-toggle"');
  assertStringIncludes(body, "localStorage.getItem('radar-theme')");
});

Deno.test("/output requires namespace query param", async () => {
  const handler = createHandler(new StubStore(REPORT), DEFAULT_CONFIG);
  const res = await get(handler, "/output");
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "namespace query param required");
});

Deno.test("/output is hidden when dashboard is disabled", async () => {
  const handler = createHandler(new StubStore(REPORT), DISABLED_DASHBOARD_CONFIG);
  const res = await get(handler, "/output?namespace=oci");
  assertEquals(res.status, 404);
});
