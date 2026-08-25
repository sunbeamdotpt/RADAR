import { assertEquals } from "jsr:@std/assert@^1";
import { join } from "jsr:@std/path@^1";
import { runAssessment } from "../../src/assess/run.ts";
import { PostgresStore } from "../../src/store/postgres_store.ts";
import { JsonStore } from "../../src/store/json_store.ts";
import { createHandler } from "../../src/server/routes.ts";
import { OfflineHttpClient } from "../../src/sources/http.ts";
import type { InventoryReport } from "../../src/schema/component.ts";

const META = { domainSuffix: "sunbeam.pt", gitBaseUrl: "https://example.test/repo.git" };

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
      name: "Valkey",
      namespace: "data",
      current: "8-alpine",
      latest: "9.1.1",
      source: "docker_hub",
      upstream: "valkey-io/valkey",
      link_template: "",
      notes: "",
      update_available: true,
    },
    {
      name: "Kratos",
      namespace: "ory",
      current: "v25.4.0",
      latest: "v26.2.0",
      source: "github_release",
      upstream: "ory/kratos",
      link_template: "https://github.com/ory/kratos/releases/tag/{tag}",
      notes: "",
      update_available: true,
    },
  ],
};

const NOW = new Date(Date.UTC(2026, 7, 25));

Deno.test({
  name: "assess e2e: inventory → assess → postgres → API",
  sanitizeOps: false,
  sanitizeResources: false,
  ignore: !(await dockerAvailable()),
  fn: async () => {
    const pg = await startPostgres();
    try {
      const dir = await Deno.makeTempDir({ prefix: "radar-it-assess-" });
      try {
        const seedPath = join(dir, "seed.yaml");
        await Deno.writeTextFile(
          seedPath,
          `components:
  - name: Kratos
    namespace: ory
    current: v25.4.0
    source: github_release
    upstream: ory/kratos
    versioning_scheme: ory
`,
        );

        const store = new PostgresStore(pg.url);
        await store.init();
        try {
          // Step 1 output exists; step 2 consumes it.
          await store.saveReport(INVENTORY, META);
          const report = await runAssessment({
            store,
            http: new OfflineHttpClient("it offline"),
            seedPath,
            offline: true,
            fetchDelayMs: 0,
            now: NOW,
          });
          await store.saveAssessments(report);

          const loaded = await store.loadLatestAssessments();
          assertEquals(loaded?.inventory_generated_at, "2026-08-25 12:00:00 UTC");
          assertEquals(loaded?.generated_at, "2026-08-25 00:00:00 UTC");
          // breaking(0) sorts before review(6)
          assertEquals(loaded?.assessments.map((a) => a.name), ["Valkey", "Kratos"]);
          assertEquals(loaded?.assessments[0].risk_level, "breaking");
          assertEquals(loaded?.assessments[1].risk_level, "review");
          assertEquals(loaded?.assessments[1].layer, "layer_0_hints");

          // Re-assessing the same run replaces instead of duplicating.
          await store.saveAssessments(report);
          const reloaded = await store.loadLatestAssessments();
          assertEquals(reloaded?.assessments.length, 2);

          // API serves the same data.
          const handler = createHandler(store);
          const res = await handler(new Request("http://localhost/api/v1/assessments"));
          assertEquals(res.status, 200);
          const body = await res.json();
          assertEquals(body.assessments.length, 2);
          const one = await handler(new Request("http://localhost/api/v1/assessments/Valkey"));
          assertEquals((await one.json()).risk_level, "breaking");
        } finally {
          await store.close();
        }
      } finally {
        await Deno.remove(dir, { recursive: true });
      }
    } finally {
      await run(["rm", "-f", pg.name]);
    }
  },
});

Deno.test({
  name: "assessments round-trip through the json store",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "radar-it-json-assess-" });
    try {
      const store = new JsonStore(join(dir, "report.json"));
      assertEquals(await store.loadLatestAssessments(), null);

      await store.saveReport(INVENTORY, META);
      const report = await runAssessment({
        store,
        http: new OfflineHttpClient("it offline"),
        seedPath: "/nonexistent/seed.yaml",
        offline: true,
        fetchDelayMs: 0,
        now: NOW,
      });
      await store.saveAssessments(report);
      const loaded = await store.loadLatestAssessments();
      assertEquals(loaded?.assessments.length, 2);
      assertEquals(loaded?.assessments[0].name, "Valkey");
      // Kratos: no seed hints here, but ory upstream auto-detection applies.
      assertEquals(loaded?.assessments[1].risk_level, "review");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "assess main: json storage end-to-end, exit codes",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const root = new URL("../../", import.meta.url).pathname;
    const dir = await Deno.makeTempDir({ prefix: "radar-it-assess-main-" });
    try {
      const jsonPath = join(dir, "report.json");
      await new JsonStore(jsonPath).saveReport(INVENTORY, META);

      const denoRun = (env: Record<string, string>) =>
        new Deno.Command("deno", {
          args: [
            "run",
            "--allow-env",
            "--allow-net",
            "--allow-read",
            "--allow-write",
            "src/assess/main.ts",
          ],
          cwd: root,
          env: { ...env, DENO_COVERAGE_DIR: `${root}coverage` },
          stdout: "piped",
          stderr: "piped",
        });

      // No inventory → exit 1.
      const empty = await denoRun({
        STORAGE: "json",
        RADAR_JSON_PATH: join(dir, "missing.json"),
        RADAR_OFFLINE: "1",
      }).output();
      assertEquals(empty.code, 1);

      // Bad config → exit 2.
      const bad = await denoRun({ STORAGE: "bogus" }).output();
      assertEquals(bad.code, 2);

      // Happy path → exit 0, sibling assessments file written.
      const ok = await denoRun({
        STORAGE: "json",
        RADAR_JSON_PATH: jsonPath,
        RADAR_SEED_PATH: join(root, "seed", "component-versions.yaml"),
        RADAR_OFFLINE: "1",
      }).output();
      assertEquals(ok.success, true, new TextDecoder().decode(ok.stderr));
      const assessPath = jsonPath.replace(/\.json$/, "") + ".assessments.json";
      const written = JSON.parse(await Deno.readTextFile(assessPath));
      assertEquals(written.assessments.length, 2);
      assertEquals(written.assessments[0].name, "Valkey");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
