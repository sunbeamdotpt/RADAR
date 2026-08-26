import { assertEquals } from "jsr:@std/assert@^1";
import { join } from "jsr:@std/path@^1";
import { runDryRuns } from "../../src/dryrun/engine.ts";
import { PostgresStore } from "../../src/store/postgres_store.ts";
import type { AssessmentReport } from "../../src/schema/assessment.ts";
import type { InventoryReport } from "../../src/schema/component.ts";
import type { HttpClient } from "../../src/sources/http.ts";

const META = { domainSuffix: "sunbeam.pt", gitBaseUrl: "https://example.test/repo.git" };

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
`),
  };
}

async function dockerAvailable(): Promise<boolean> {
  try {
    const out = await new Deno.Command("docker", {
      args: ["info"],
      stdout: "null",
      stderr: "null",
    }).output();
    return out.success;
  } catch {
    return false;
  }
}

async function run(args: string[]): Promise<string> {
  const out = await new Deno.Command("docker", { args, stdout: "piped", stderr: "piped" }).output();
  if (!out.success) {
    throw new Error(`docker ${args.join(" ")} failed: ${new TextDecoder().decode(out.stderr)}`);
  }
  return new TextDecoder().decode(out.stdout).trim();
}

async function startPostgres(): Promise<{ name: string; url: string }> {
  const name = `radar-it-${crypto.randomUUID().slice(0, 8)}`;
  await run([
    "run",
    "-d",
    "--name",
    name,
    "-e",
    "POSTGRES_PASSWORD=radar-it",
    "-p",
    "127.0.0.1::5432",
    "postgres:18-alpine",
  ]);
  const portLine = await run(["port", name, "5432/tcp"]);
  const port = portLine.split(":").pop()!;
  const deadline = Date.now() + 60_000;
  for (;;) {
    const probe = await new Deno.Command("docker", {
      args: ["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"],
      stdout: "null",
      stderr: "null",
    }).output();
    if (probe.success) break;
    if (Date.now() > deadline) throw new Error("postgres container did not become ready");
    await new Promise((r) => setTimeout(r, 500));
  }
  return { name, url: `postgresql://postgres:radar-it@127.0.0.1:${port}/postgres?sslmode=disable` };
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
      reason: "patch bump",
      action: "dry-run",
      layer: "layer_1_semver",
      details: {},
    },
  ],
};

Deno.test({
  name: "dry-run e2e: inventory + assessments → postgres → dry-run report",
  sanitizeOps: false,
  sanitizeResources: false,
  ignore: !(await dockerAvailable()),
  fn: async () => {
    const pg = await startPostgres();
    try {
      const baseDir = await Deno.makeTempDir({ prefix: "radar-it-dryrun-base-" });
      try {
        await Deno.mkdir(join(baseDir, "base", "longhorn"), { recursive: true });
        await Deno.writeTextFile(
          join(baseDir, "base", "longhorn", "kustomization.yaml"),
          `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
helmCharts:
  - name: longhorn
    repo: https://charts.longhorn.io
    version: "1.11.1"
    releaseName: longhorn
    namespace: longhorn-system
`,
        );

        const store = new PostgresStore(pg.url);
        await store.init();
        try {
          await store.saveReport(INVENTORY, META);
          await store.saveAssessments(ASSESSMENTS);

          const report = await runDryRuns({
            store,
            mapperDeps: { basePath: baseDir, hints: new Map() },
            runnerDeps: {
              buildOnly: true,
              http: fakeIndexHttp(),
              runCommand: (argv) => {
                const [tool] = argv;
                if (tool === "sunbeam") {
                  return {
                    success: true,
                    code: 0,
                    stdout: "namespace/longhorn-system created",
                    stderr: "",
                  };
                }
                return { success: true, code: 0, stdout: "", stderr: "" };
              },
            },
            now: new Date(Date.UTC(2026, 7, 25, 14)),
          });
          await store.saveDryRuns(report);

          const loaded = await store.loadLatestDryRuns();
          assertEquals(loaded?.dry_runs.length, 1);
          const longhorn = loaded?.dry_runs[0];
          assertEquals(longhorn?.namespace, "longhorn-system");
          assertEquals(longhorn?.components, ["Longhorn"]);
          assertEquals(longhorn?.status, "success");
          assertEquals(loaded?.inventory_generated_at, "2026-08-25 12:00:00 UTC");
          assertEquals(loaded?.assessment_generated_at, "2026-08-25 13:00:00 UTC");
          assertEquals(loaded?.generated_at, "2026-08-25 14:00:00 UTC");

          // Re-running replaces instead of duplicating.
          const report2 = await runDryRuns({
            store,
            mapperDeps: { basePath: baseDir, hints: new Map() },
            runnerDeps: {
              buildOnly: true,
              http: fakeIndexHttp(),
              runCommand: (argv) => {
                const [tool] = argv;
                if (tool === "sunbeam") {
                  return {
                    success: true,
                    code: 0,
                    stdout: "namespace/longhorn-system created",
                    stderr: "",
                  };
                }
                return { success: true, code: 0, stdout: "", stderr: "" };
              },
            },
            now: new Date(Date.UTC(2026, 7, 25, 14, 1)),
          });
          await store.saveDryRuns(report2);
          const reloaded = await store.loadLatestDryRuns();
          assertEquals(reloaded?.dry_runs.length, 1);
        } finally {
          await store.close();
        }
      } finally {
        await Deno.remove(baseDir, { recursive: true });
      }
    } finally {
      await run(["rm", "-f", pg.name]);
    }
  },
});
