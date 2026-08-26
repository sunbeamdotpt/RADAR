import { assertEquals, assertRejects } from "jsr:@std/assert@^1";
import { join } from "jsr:@std/path@^1";
import { runDryRuns } from "../../src/dryrun/engine.ts";
import type { AssessmentReport } from "../../src/schema/assessment.ts";
import type { InventoryReport } from "../../src/schema/component.ts";
import type { DryRunReport } from "../../src/schema/dryrun.ts";
import type { RadarStore } from "../../src/store/factory.ts";
import type { HttpClient } from "../../src/sources/http.ts";

class MemoryStore implements RadarStore {
  report: InventoryReport | null = null;
  assessments: AssessmentReport | null = null;
  dryRuns: DryRunReport | null = null;

  loadPrevious(): Promise<InventoryReport | null> {
    return Promise.resolve(this.report);
  }
  saveReport(): Promise<void> {
    return Promise.resolve();
  }
  loadLatestAssessments(): Promise<AssessmentReport | null> {
    return Promise.resolve(this.assessments);
  }
  saveAssessments(): Promise<void> {
    return Promise.resolve();
  }
  loadLatestDryRuns(): Promise<DryRunReport | null> {
    return Promise.resolve(this.dryRuns);
  }
  saveDryRuns(): Promise<void> {
    return Promise.resolve();
  }
  healthCheck(): Promise<boolean> {
    return Promise.resolve(true);
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

function fakeIndexHttp(): HttpClient {
  return {
    json: () => Promise.reject(new Error("unexpected json")),
    text: () =>
      Promise.resolve(`
apiVersion: v1
entries:
  longhorn:
    - version: 1.12.0
      appVersion: v1.12.0
  cert-manager:
    - version: v1.20.0
      appVersion: v1.20.0
`),
  };
}

const INVENTORY: InventoryReport = {
  generated_at: "2026-08-25 12:00:00 UTC",
  components: [
    {
      name: "Longhorn",
      namespace: "longhorn-system",
      current: "v1.11.1",
      latest: "v1.12.0",
      source: "helm_chart",
      upstream: "https://charts.longhorn.io::longhorn",
      link_template: "",
      notes: "",
      update_available: true,
      chart_version: "1.11.1",
      track_app_version: true,
    },
    {
      name: "Cert-manager",
      namespace: "cert-manager",
      current: "v1.19.4",
      latest: "v1.20.0",
      source: "helm_chart",
      upstream: "https://charts.jetstack.io::cert-manager",
      link_template: "",
      notes: "",
      update_available: true,
      chart_version: "v1.19.4",
      track_app_version: true,
    },
    {
      // Not likely_safe → filtered out.
      name: "Kratos",
      namespace: "ory",
      current: "v25.4.0",
      latest: "v26.2.0",
      source: "helm_chart",
      upstream: "https://charts.example.test::kratos",
      link_template: "",
      notes: "",
      update_available: true,
      chart_version: "0.60.1",
      track_app_version: true,
    },
    {
      // No drift → filtered out.
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
  ],
};

const ASSESSMENTS: AssessmentReport = {
  generated_at: "2026-08-25 13:00:00 UTC",
  inventory_generated_at: "2026-08-25 12:00:00 UTC",
  assessments: [
    {
      name: "Longhorn",
      current: "v1.11.1",
      latest: "v1.12.0",
      risk_level: "likely_safe",
      reason: "",
      action: "",
      layer: "",
      details: {},
    },
    {
      name: "Cert-manager",
      current: "v1.19.4",
      latest: "v1.20.0",
      risk_level: "likely_safe",
      reason: "",
      action: "",
      layer: "",
      details: {},
    },
    {
      name: "Kratos",
      current: "v25.4.0",
      latest: "v26.2.0",
      risk_level: "breaking",
      reason: "",
      action: "",
      layer: "",
      details: {},
    },
    {
      name: "CFSSL",
      current: "v1.6.5",
      latest: "v1.6.5",
      risk_level: "non_applicable",
      reason: "",
      action: "",
      layer: "",
      details: {},
    },
  ],
};

Deno.test("runDryRuns fails when no inventory exists", async () => {
  await assertRejects(
    () =>
      runDryRuns({
        store: new MemoryStore(),
        mapperDeps: { basePath: "/tmp", hints: new Map() },
        runnerDeps: { buildOnly: true },
      }),
    Error,
    "no inventory run found",
  );
});

Deno.test("runDryRuns fails when no assessments exist", async () => {
  const store = new MemoryStore();
  store.report = INVENTORY;
  await assertRejects(
    () =>
      runDryRuns({
        store,
        mapperDeps: { basePath: "/tmp", hints: new Map() },
        runnerDeps: { buildOnly: true },
      }),
    Error,
    "no assessments found",
  );
});

Deno.test("runDryRuns groups likely_safe drifted helm components by namespace", async () => {
  const base = await Deno.makeTempDir({ prefix: "radar-dryrun-engine-" });
  try {
    for (const ns of ["longhorn", "cert-manager"]) {
      await Deno.mkdir(join(base, "base", ns), { recursive: true });
      await Deno.writeTextFile(
        join(base, "base", ns, "kustomization.yaml"),
        `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
helmCharts:
  - name: ${ns}
    repo: https://example.test
    version: "1.0.0"
    releaseName: ${ns}
    namespace: ${ns}
`,
      );
    }

    const store = new MemoryStore();
    store.report = INVENTORY;
    store.assessments = ASSESSMENTS;

    const report = await runDryRuns({
      store,
      mapperDeps: { basePath: base, hints: new Map() },
      runnerDeps: {
        buildOnly: true,
        http: fakeIndexHttp(),
        runCommand: (argv) => {
          const [tool] = argv;
          if (tool === "sunbeam") {
            return { success: true, code: 0, stdout: "built", stderr: "" };
          }
          return { success: true, code: 0, stdout: "", stderr: "" };
        },
      },
      now: new Date(Date.UTC(2026, 7, 25, 14)),
    });

    assertEquals(report.inventory_generated_at, "2026-08-25 12:00:00 UTC");
    assertEquals(report.assessment_generated_at, "2026-08-25 13:00:00 UTC");
    assertEquals(report.generated_at, "2026-08-25 14:00:00 UTC");
    assertEquals(report.dry_runs.length, 2);
    assertEquals(report.dry_runs.map((d) => d.namespace).sort(), [
      "cert-manager",
      "longhorn-system",
    ]);
    const longhorn = report.dry_runs.find((d) => d.namespace === "longhorn-system")!;
    assertEquals(longhorn.status, "success");
    assertEquals(longhorn.components, ["Longhorn"]);
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("runDryRuns records skipped_no_mapping for unmatched namespaces", async () => {
  const base = await Deno.makeTempDir({ prefix: "radar-dryrun-engine-" });
  try {
    const store = new MemoryStore();
    store.report = INVENTORY;
    store.assessments = ASSESSMENTS;

    const report = await runDryRuns({
      store,
      mapperDeps: { basePath: base, hints: new Map() },
      runnerDeps: { buildOnly: true },
      now: new Date(Date.UTC(2026, 7, 25, 14)),
    });

    const longhorn = report.dry_runs.find((d) => d.namespace === "longhorn-system");
    assertEquals(longhorn?.status, "skipped_no_mapping");
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});
