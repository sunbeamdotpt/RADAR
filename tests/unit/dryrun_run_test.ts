import { assertEquals } from "jsr:@std/assert@^1";
import { join } from "jsr:@std/path@^1";
import { loadDryRunConfig } from "../../src/dryrun/config.ts";
import { loadKustomizeHints, runDryRunPass } from "../../src/dryrun/run.ts";
import { JsonStore } from "../../src/store/json_store.ts";
import type { AssessmentReport } from "../../src/schema/assessment.ts";
import type { InventoryReport } from "../../src/schema/component.ts";

async function initGitRepo(dir: string): Promise<{ url: string; ref: string }> {
  const out = await new Deno.Command("git", {
    args: ["init", dir],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!out.success) throw new Error(`git init failed: ${new TextDecoder().decode(out.stderr)}`);

  await new Deno.Command("git", { args: ["-C", dir, "config", "user.email", "radar@example.test"] })
    .output();
  await new Deno.Command("git", { args: ["-C", dir, "config", "user.name", "RADAR"] }).output();
  await new Deno.Command("git", { args: ["-C", dir, "add", "."] }).output();
  const commit = await new Deno.Command("git", {
    args: ["-C", dir, "commit", "-m", "initial"],
    stdout: "null",
    stderr: "piped",
  }).output();
  if (!commit.success) {
    throw new Error(`git commit failed: ${new TextDecoder().decode(commit.stderr)}`);
  }

  const branch = await new Deno.Command("git", {
    args: ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!branch.success) throw new Error("git branch lookup failed");
  const ref = new TextDecoder().decode(branch.stdout).trim();
  return { url: `file://${dir}`, ref };
}

const INVENTORY: InventoryReport = {
  generated_at: "2026-08-25 12:00:00 UTC",
  components: [{
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
  }],
};

const ASSESSMENTS: AssessmentReport = {
  generated_at: "2026-08-25 13:00:00 UTC",
  inventory_generated_at: "2026-08-25 12:00:00 UTC",
  assessments: [{
    name: "Longhorn",
    current: "v1.11.1",
    latest: "v1.12.0",
    risk_level: "likely_safe",
    reason: "",
    action: "",
    layer: "",
    details: {},
  }],
};

Deno.test("loadKustomizeHints reads kustomize_path from seed yaml", async () => {
  const dir = await Deno.makeTempDir({ prefix: "radar-dryrun-hints-" });
  try {
    const seedPath = join(dir, "seed.yaml");
    await Deno.writeTextFile(
      seedPath,
      `components:
  - name: Longhorn
    namespace: longhorn-system
    current: v1.11.1
    source: helm_chart
    upstream: https://charts.longhorn.io::longhorn
    kustomize_path: base/longhorn
`,
    );
    const hints = await loadKustomizeHints(seedPath);
    assertEquals(hints.get("Longhorn"), "base/longhorn");
    assertEquals(hints.get("Missing"), undefined);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("loadKustomizeHints returns empty map for missing seed", async () => {
  const hints = await loadKustomizeHints("/nonexistent/seed.yaml");
  assertEquals(hints.size, 0);
});

Deno.test("runDryRunPass clones base, runs dry-runs, and cleans up", async () => {
  const dir = await Deno.makeTempDir({ prefix: "radar-dryrun-pass-" });
  try {
    const repoDir = join(dir, "repo");
    await Deno.mkdir(join(repoDir, "base", "longhorn"), { recursive: true });
    await Deno.writeTextFile(
      join(repoDir, "base", "longhorn", "kustomization.yaml"),
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
    const { url, ref } = await initGitRepo(repoDir);

    const jsonPath = join(dir, "report.json");
    const store = new JsonStore(jsonPath);
    await store.saveReport(INVENTORY, { domainSuffix: "sunbeam.pt", gitBaseUrl: url });
    await store.saveAssessments(ASSESSMENTS);

    const config = loadDryRunConfig({
      STORAGE: "json",
      RADAR_JSON_PATH: jsonPath,
      RADAR_SEED_PATH: join(dir, "seed.yaml"),
      GIT_BASE_URL: url,
      GIT_BASE_REF: ref,
      RADAR_DRYRUN_BUILD_ONLY: "true",
    });

    const report = await runDryRunPass({
      config,
      store,
      runnerDeps: {
        buildOnly: true,
        runCommand: (argv) => {
          const [tool] = argv;
          if (tool === "kustomize") {
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
    });
    assertEquals(report.dry_runs.length, 1);
    assertEquals(report.dry_runs[0].status, "success");
    assertEquals(report.dry_runs[0].mutated_helm_version, "v1.12.0");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
