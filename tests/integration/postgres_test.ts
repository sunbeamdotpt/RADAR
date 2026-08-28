import { assertEquals } from "jsr:@std/assert@^1";
import { PostgresStore } from "../../src/store/postgres_store.ts";
import type { ServerConfig } from "../../src/server/config.ts";
import { createHandler } from "../../src/server/routes.ts";
import { runInventory } from "../../src/job/inventory.ts";
import { OfflineHttpClient } from "../../src/sources/http.ts";
import type { InventoryReport } from "../../src/schema/component.ts";

const META = { domainSuffix: "sunbeam.pt", gitBaseUrl: "https://example.test/repo.git" };

const DEFAULT_CONFIG: ServerConfig = {
  storage: "json",
  jsonPath: "./data/component-versions.json",
  databaseUrl: undefined,
  hostname: "0.0.0.0",
  port: 8080,
  dashboardEnabled: true,
  grafanaUrl: undefined,
};

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

interface PgContainer {
  name: string;
  url: string;
}

async function startPostgres(): Promise<PgContainer> {
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
  const url = `postgresql://postgres:radar-it@127.0.0.1:${port}/postgres?sslmode=disable`;

  // Wait until postgres accepts TCP sessions. The entrypoint's temporary init
  // server listens on a unix socket only, so `pg_isready -h 127.0.0.1` inside
  // the container fails during init and succeeds once the real postmaster is up.
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
  return { name, url };
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
      name: "Cert-manager",
      namespace: "cert-manager",
      current: "v1.19.4",
      latest: "v1.20.0",
      source: "helm_chart",
      upstream: "https://charts.jetstack.io::cert-manager",
      link_template: "https://github.com/cert-manager/cert-manager/releases/tag/{app_version}",
      notes: "Helm chart 1.19.4",
      update_available: true,
      chart_version: "1.19.4",
      track_app_version: true,
    },
  ],
};

Deno.test({
  name: "postgres store: migrations, save, latest-run reads, API serving",
  sanitizeOps: false,
  sanitizeResources: false,
  ignore: !(await dockerAvailable()),
  fn: async () => {
    const pg = await startPostgres();
    try {
      const store = new PostgresStore(pg.url);
      await store.init();
      try {
        assertEquals(await store.healthCheck(), true);
        assertEquals(await store.loadPrevious(), null, "empty store must report first run");

        await store.saveReport(REPORT, META);
        const first = await store.loadPrevious();
        assertEquals(first?.generated_at, "2026-08-21 12:00:00 UTC");
        assertEquals(first?.components, REPORT.components);

        // A second run supersedes the first for readers.
        const second = {
          ...REPORT,
          generated_at: "2026-08-21 13:00:00 UTC",
          components: REPORT.components.map((c) => ({ ...c, latest: "v9.9.9" })),
        };
        await store.saveReport(second, META);
        const latest = await store.loadPrevious();
        assertEquals(latest?.generated_at, "2026-08-21 13:00:00 UTC");
        assertEquals(latest?.components[0].latest, "v9.9.9");
        assertEquals(latest?.components.length, 2);

        // The API serves exactly what the store persisted.
        const handler = createHandler(store, DEFAULT_CONFIG);
        const res = await handler(new Request("http://localhost/api/v1/inventory"));
        assertEquals(res.status, 200);
        const body = await res.json();
        assertEquals(body.generated_at, "2026-08-21 13:00:00 UTC");
        assertEquals(body.components.length, 2);

        const one = await handler(
          new Request(`http://localhost/api/v1/components/${encodeURIComponent("Cert-manager")}`),
        );
        assertEquals(one.status, 200);
        const record = await one.json();
        assertEquals(record.chart_version, "1.19.4");
        assertEquals(record.track_app_version, true);
      } finally {
        await store.close();
      }

      // healthCheck reports false once the connection is gone.
      const closed = new PostgresStore(pg.url);
      await closed.init();
      await closed.close();
      assertEquals(await closed.healthCheck(), false);
    } finally {
      await run(["rm", "-f", pg.name]);
    }
  },
});

Deno.test({
  name: "server main: serves from postgres and shuts down on SIGTERM",
  sanitizeOps: false,
  sanitizeResources: false,
  ignore: !(await dockerAvailable()),
  fn: async () => {
    const pg = await startPostgres();
    try {
      // Seed one report via the store so the server has something to serve.
      const store = new PostgresStore(pg.url);
      await store.init();
      await store.saveReport(REPORT, META);
      await store.close();

      const port = 18092;
      const root = new URL("../../", import.meta.url).pathname;
      const child = new Deno.Command("deno", {
        args: ["run", "--allow-env", "--allow-net", "--allow-read", "src/server/main.ts"],
        cwd: root,
        env: {
          STORAGE: "postgres",
          DATABASE_URL: pg.url,
          PORT: String(port),
          DENO_COVERAGE_DIR: `${root}coverage`,
        },
        stdout: "piped",
        stderr: "piped",
      }).spawn();

      const deadline = Date.now() + 30_000;
      let body: { generated_at?: string; components?: unknown[] } = {};
      for (;;) {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/api/v1/inventory`);
          if (res.ok) {
            body = await res.json();
            break;
          }
        } catch { /* not up yet */ }
        if (Date.now() > deadline) break;
        await new Promise((r) => setTimeout(r, 300));
      }
      assertEquals(body.generated_at, "2026-08-21 12:00:00 UTC");
      assertEquals(body.components?.length, 2);

      child.kill("SIGTERM");
      const status = await child.status;
      assertEquals(status.success, true);
    } finally {
      await run(["rm", "-f", pg.name]);
    }
  },
});

Deno.test({
  name: "job main with postgres: saves the run and writes the JSON mirror",
  sanitizeOps: false,
  sanitizeResources: false,
  ignore: !(await dockerAvailable()),
  fn: async () => {
    const pg = await startPostgres();
    try {
      const dir = await Deno.makeTempDir({ prefix: "radar-it-job-main-" });
      try {
        const mirror = `${dir}/mirror.json`;
        const root = new URL("../../", import.meta.url).pathname;
        const result = await new Deno.Command("deno", {
          args: [
            "run",
            "--allow-env",
            "--allow-net",
            "--allow-read",
            "--allow-write",
            "--allow-run=git",
            "src/job/main.ts",
          ],
          cwd: root,
          env: {
            STORAGE: "postgres",
            DATABASE_URL: pg.url,
            RADAR_SEED_PATH: `${root}seed/component-versions.yaml`,
            RADAR_JSON_PATH: mirror,
            RADAR_OFFLINE: "1",
            // No clone in this test: bad URL, not required → warn and continue.
            GIT_BASE_URL: "/nonexistent/repo.git",
            DENO_COVERAGE_DIR: `${root}coverage`,
          },
          stdout: "piped",
          stderr: "piped",
        }).output();
        assertEquals(result.success, true, new TextDecoder().decode(result.stderr));

        // JSON mirror was written and matches what postgres holds.
        const mirrored = JSON.parse(await Deno.readTextFile(mirror));
        assertEquals(mirrored.components.length, 61);

        const store = new PostgresStore(pg.url);
        await store.init();
        const latest = await store.loadPrevious();
        await store.close();
        assertEquals(latest?.components.length, 61);
        assertEquals(latest?.generated_at, mirrored.generated_at);
      } finally {
        await Deno.remove(dir, { recursive: true });
      }
    } finally {
      await run(["rm", "-f", pg.name]);
    }
  },
});

Deno.test({
  name: "job ingests from postgres on subsequent runs (offline fallback)",
  sanitizeOps: false,
  sanitizeResources: false,
  ignore: !(await dockerAvailable()),
  fn: async () => {
    const pg = await startPostgres();
    try {
      const dir = await Deno.makeTempDir({ prefix: "radar-it-seed-" });
      try {
        const seedPath = `${dir}/seed.yaml`;
        await Deno.writeTextFile(
          seedPath,
          `components:
  - name: CFSSL
    namespace: cert-manager
    current: v1.6.5
    source: github_release
    upstream: cloudflare/cfssl
    link_template: https://github.com/cloudflare/cfssl/releases/tag/{tag}
`,
        );
        const store = new PostgresStore(pg.url);
        await store.init();
        try {
          // First run: offline, no previous state → "error".
          const first = await runInventory({
            http: new OfflineHttpClient("it offline"),
            store,
            seedPath,
            domainSuffix: "sunbeam.pt",
            fetchDelayMs: 0,
            now: new Date(Date.UTC(2026, 7, 21, 12, 0, 0)),
          });
          assertEquals(first.components[0].latest, "error");
          await store.saveReport(first, META);

          // Second run: previous row feeds the fallback even though it is "error".
          const second = await runInventory({
            http: new OfflineHttpClient("it offline"),
            store,
            seedPath,
            domainSuffix: "sunbeam.pt",
            fetchDelayMs: 0,
            now: new Date(Date.UTC(2026, 7, 21, 13, 0, 0)),
          });
          assertEquals(second.components[0].latest, "error");
          assertEquals(second.generated_at, "2026-08-21 13:00:00 UTC");
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
