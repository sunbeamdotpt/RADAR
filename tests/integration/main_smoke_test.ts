import { assertEquals } from "jsr:@std/assert@^1";
import { join } from "jsr:@std/path@^1";

const ROOT = new URL("../../", import.meta.url).pathname;
const SEED = join(ROOT, "seed", "component-versions.yaml");

async function run(args: string[], cwd: string): Promise<void> {
  const out = await new Deno.Command("git", { args, cwd, stdout: "piped", stderr: "piped" })
    .output();
  if (!out.success) throw new Error(new TextDecoder().decode(out.stderr));
}

/** A minimal local git repo with a base/ tree, usable as GIT_BASE_URL offline. */
async function makeLocalBase(dir: string): Promise<string> {
  const origin = join(dir, "origin");
  await Deno.mkdir(join(origin, "base", "cluster"), { recursive: true });
  await Deno.writeTextFile(
    join(origin, "base", "cluster", "kustomization.yaml"),
    "kind: Kustomization\nnamespace: cluster\nresources: []\n",
  );
  await run(["init", "-b", "main"], origin);
  await run(["add", "."], origin);
  await run(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"], origin);
  return origin;
}

function denoRun(script: string, env: Record<string, string>, args: string[] = []) {
  return new Deno.Command("deno", {
    args: [
      "run",
      "--allow-env",
      "--allow-net",
      "--allow-read",
      "--allow-write",
      "--allow-run=git",
      script,
      ...args,
    ],
    cwd: ROOT,
    env: {
      ...env,
      // Let child processes contribute to the parent's coverage collection.
      DENO_COVERAGE_DIR: join(ROOT, "coverage"),
    },
    stdout: "piped",
    stderr: "piped",
  });
}

Deno.test({
  name: "job main: end-to-end with json storage (seed → run → rerun ingests previous)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "radar-main-job-" });
    try {
      const origin = await makeLocalBase(dir);
      const jsonPath = join(dir, "out.json");
      const env = {
        STORAGE: "json",
        RADAR_JSON_PATH: jsonPath,
        RADAR_SEED_PATH: SEED,
        RADAR_OFFLINE: "1",
        GIT_BASE_URL: origin,
        GIT_BASE_REF: "main",
      };

      const first = await denoRun("src/job/main.ts", env).output();
      assertEquals(first.success, true, new TextDecoder().decode(first.stderr));
      const report = JSON.parse(await Deno.readTextFile(jsonPath));
      assertEquals(report.components.length, 61);
      assertEquals(
        report.components.every((c: { latest: string }) =>
          c.latest === "error" || c.latest === "unknown"
        ),
        true,
      );

      // Second run ingests the previous report instead of the seed.
      const second = await denoRun("src/job/main.ts", env).output();
      assertEquals(second.success, true, new TextDecoder().decode(second.stderr));
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "job main: bootstrap writes a valid seed from the cloned base",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "radar-main-bootstrap-" });
    try {
      const origin = await makeLocalBase(dir);
      const seedOut = join(dir, "seed.yaml");
      const result = await denoRun("src/job/main.ts", {
        RADAR_SEED_PATH: seedOut,
        GIT_BASE_URL: origin,
        GIT_BASE_REF: "main",
        RADAR_OFFLINE: "1",
      }, ["--bootstrap"]).output();
      assertEquals(result.success, true, new TextDecoder().decode(result.stderr));
      const text = await Deno.readTextFile(seedOut);
      assertEquals(text.includes("components:"), true);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "job main: invalid configuration exits 2",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const result = await denoRun("src/job/main.ts", { STORAGE: "bogus" }).output();
    assertEquals(result.code, 2);
    assertEquals(new TextDecoder().decode(result.stderr).includes("STORAGE"), true);
  },
});

Deno.test({
  name: "job main: required git base clone failure exits 1",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const result = await denoRun("src/job/main.ts", {
      STORAGE: "json",
      GIT_BASE_URL: "/nonexistent/repo.git",
      GIT_BASE_REF: "main",
      GIT_BASE_REQUIRED: "1",
      RADAR_OFFLINE: "1",
    }).output();
    assertEquals(result.code, 1);
    assertEquals(new TextDecoder().decode(result.stderr).includes("git base clone failed"), true);
  },
});

Deno.test({
  name: "job main: store failure exits 1",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "radar-main-fail-" });
    try {
      const origin = await makeLocalBase(dir);
      const result = await denoRun("src/job/main.ts", {
        STORAGE: "json",
        RADAR_JSON_PATH: "/proc/radar-forbidden/out.json",
        RADAR_SEED_PATH: SEED,
        RADAR_OFFLINE: "1",
        GIT_BASE_URL: origin,
        GIT_BASE_REF: "main",
      }).output();
      assertEquals(result.code, 1);
      assertEquals(new TextDecoder().decode(result.stderr).includes("radar job failed"), true);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "server main: serves the json store and shuts down on SIGTERM",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "radar-main-server-" });
    try {
      const jsonPath = join(dir, "report.json");
      await Deno.writeTextFile(
        jsonPath,
        JSON.stringify({
          generated_at: "2026-08-21 12:00:00 UTC",
          components: [{
            name: "CFSSL",
            namespace: "cert-manager",
            current: "v1.6.5",
            latest: "v1.7.0",
            source: "github_release",
            upstream: "cloudflare/cfssl",
            link_template: "",
            notes: "",
            update_available: true,
          }],
        }),
      );

      const port = 18091;
      const child = denoRun("src/server/main.ts", {
        STORAGE: "json",
        RADAR_JSON_PATH: jsonPath,
        PORT: String(port),
      }).spawn();

      // Wait for the server to answer.
      const deadline = Date.now() + 30_000;
      let inventory: { generated_at: string; components: unknown[] } | null = null;
      for (;;) {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/api/v1/inventory`);
          if (res.ok) {
            inventory = await res.json();
            break;
          }
        } catch { /* not up yet */ }
        if (Date.now() > deadline) break;
        await new Promise((r) => setTimeout(r, 300));
      }
      assertEquals(inventory?.generated_at, "2026-08-21 12:00:00 UTC");
      assertEquals(inventory?.components.length, 1);

      child.kill("SIGTERM");
      const status = await child.status;
      assertEquals(status.success, true);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
