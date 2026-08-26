import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@^1";
import { join } from "jsr:@std/path@^1";
import { runAssessment } from "../../src/assess/run.ts";
import { loadSeedHints, resolveHints } from "../../src/assess/hints.ts";
import { loadAssessConfig } from "../../src/assess/config.ts";
import {
  AssessmentSchemaError,
  parseAssessment,
  parseAssessmentReport,
  SEVERITY_ORDER,
} from "../../src/schema/assessment.ts";
import type { AssessmentReport } from "../../src/schema/assessment.ts";
import type { InventoryReport } from "../../src/schema/component.ts";
import { OfflineHttpClient } from "../../src/sources/http.ts";
import type { AssessmentStore, Store } from "../../src/store/store.ts";

class MemoryStore implements Store, AssessmentStore {
  report: InventoryReport | null = null;
  assessments: AssessmentReport | null = null;
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
  healthCheck(): Promise<boolean> {
    return Promise.resolve(true);
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

const NOW = new Date(Date.UTC(2026, 7, 25));

const INVENTORY: InventoryReport = {
  generated_at: "2026-08-25 12:00:00 UTC",
  components: [
    {
      name: "Kratos",
      namespace: "ory",
      current: "v25.4.0",
      latest: "v26.2.0",
      source: "github_release",
      upstream: "ory/kratos",
      link_template: "https://github.com/ory/kratos/releases/tag/{tag}",
      notes: "Helm chart pinned at 0.60.1",
      update_available: true,
    },
    {
      name: "CFSSL",
      namespace: "cert-manager",
      current: "v1.6.5",
      latest: "v1.6.5",
      source: "github_release",
      upstream: "cloudflare/cfssl",
      link_template: "",
      notes: "",
      update_available: false,
    },
    {
      name: "Tailscale",
      namespace: "vpn",
      current: "stable",
      latest: "v1.90.0",
      source: "github_release",
      upstream: "tailscale/tailscale",
      link_template: "",
      notes: "Floating tag",
      update_available: false,
    },
  ],
};

async function withSeed(yaml: string, fn: (seedPath: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "radar-assess-test-" });
  try {
    const seedPath = join(dir, "seed.yaml");
    await Deno.writeTextFile(seedPath, yaml);
    await fn(seedPath);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("runAssessment fails loudly when no inventory exists", async () => {
  await withSeed("components: []\n", async (seedPath) => {
    await assertRejects(
      () =>
        runAssessment({
          store: new MemoryStore(),
          http: new OfflineHttpClient(),
          seedPath,
          offline: true,
          now: NOW,
        }),
      Error,
      "no inventory run found",
    );
  });
});

Deno.test("runAssessment assesses all components, applies hints, sorts by severity", async () => {
  await withSeed(
    `components:
  - name: Kratos
    namespace: ory
    current: v25.4.0
    source: github_release
    upstream: ory/kratos
    versioning_scheme: ory
`,
    async (seedPath) => {
      const store = new MemoryStore();
      store.report = INVENTORY;
      const report = await runAssessment({
        store,
        http: new OfflineHttpClient(),
        seedPath,
        offline: true,
        now: NOW,
      });

      assertEquals(report.generated_at, "2026-08-25 00:00:00 UTC");
      assertEquals(report.inventory_generated_at, "2026-08-25 12:00:00 UTC");
      assertEquals(report.assessments.length, 3);

      // Severity order: floating_tag(4) < review(6) < non_applicable(9)
      const names = report.assessments.map((a) => a.name);
      assertEquals(names, ["Tailscale", "Kratos", "CFSSL"]);
      const kratos = report.assessments[1];
      assertEquals(kratos.risk_level, "review");
      assertEquals(kratos.layer, "layer_0_hints", "ory hint from the seed beats major-bump");
      assertEquals(report.assessments[0].risk_level, "floating_tag");
      assertEquals(report.assessments[2].risk_level, "non_applicable");
    },
  );
});

Deno.test("runAssessment updatesOnly filters to drifted components", async () => {
  await withSeed("components: []\n", async (seedPath) => {
    const store = new MemoryStore();
    store.report = INVENTORY;
    const report = await runAssessment({
      store,
      http: new OfflineHttpClient(),
      seedPath,
      offline: true,
      updatesOnly: true,
      now: NOW,
    });
    assertEquals(report.assessments.map((a) => a.name), ["Kratos"]);
  });
});

Deno.test("loadSeedHints returns empty on unreadable seed and resolves fallbacks", async () => {
  const empty = await loadSeedHints("/nonexistent/seed.yaml");
  assertEquals(empty.size, 0);

  // Auto-detected fallbacks when the seed says nothing.
  assertEquals(resolveHints("ory/hydra", undefined).versioning_scheme, "ory");
  assertEquals(
    resolveHints("opensearch-project/OpenSearch", undefined).breaking_change_policy,
    "major_only",
  );
  // Explicit seed hints win over auto-detection.
  assertEquals(
    resolveHints("ory/hydra", { versioning_scheme: "semver" }).versioning_scheme,
    "semver",
  );
  assertEquals(resolveHints("cloudflare/cfssl", undefined), {});
});

Deno.test("assessment schema validators are strict", () => {
  const valid = {
    name: "X",
    current: "1",
    latest: "2",
    risk_level: "review",
    reason: "r",
    action: "a",
    layer: "layer_0_precheck",
    details: {},
  };
  assertEquals(parseAssessment(valid, 0).risk_level, "review");
  assertThrows(
    () => parseAssessment({ ...valid, risk_level: "spicy" }, 0),
    AssessmentSchemaError,
    "risk_level",
  );
  assertThrows(
    () => parseAssessment({ ...valid, bogus: 1 }, 0),
    AssessmentSchemaError,
    'unknown key "bogus"',
  );
  assertThrows(
    () => parseAssessment({ ...valid, reason: 3 }, 0),
    AssessmentSchemaError,
    '"reason" must be a string',
  );
  const { details: _omit, ...noDetails } = valid;
  assertEquals(parseAssessment(noDetails, 0).details, {}, "details defaults to {}");

  assertThrows(() => parseAssessmentReport({}), AssessmentSchemaError, "generated_at");
  assertThrows(
    () => parseAssessmentReport({ generated_at: "x" }),
    AssessmentSchemaError,
    "inventory_generated_at",
  );
  const report = parseAssessmentReport({
    generated_at: "2026-08-25 00:00:00 UTC",
    inventory_generated_at: "2026-08-25 00:00:00 UTC",
    assessments: [valid],
  });
  assertEquals(report.assessments.length, 1);
});

Deno.test("SEVERITY_ORDER is total over risk levels", () => {
  assertEquals(Object.keys(SEVERITY_ORDER).length, 10);
  assertEquals(SEVERITY_ORDER.breaking < SEVERITY_ORDER.likely_safe, true);
  assertEquals(SEVERITY_ORDER.likely_safe < SEVERITY_ORDER.non_applicable, true);
});

Deno.test("loadAssessConfig derives the assessments path and parses flags", () => {
  const config = loadAssessConfig({
    STORAGE: "json",
    RADAR_OFFLINE: "1",
    RADAR_ASSESS_UPDATES_ONLY: "true",
  });
  assertEquals(config.assessJsonPath, "./data/component-versions.assessments.json");
  assertEquals(config.offline, true);
  assertEquals(config.updatesOnly, true);
  const explicit = loadAssessConfig({ RADAR_ASSESS_JSON_PATH: "/tmp/a.json" });
  assertEquals(explicit.assessJsonPath, "/tmp/a.json");
});
