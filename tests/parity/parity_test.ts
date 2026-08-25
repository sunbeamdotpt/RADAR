import { assertEquals } from "jsr:@std/assert@^1";
import { join } from "jsr:@std/path@^1";
import { runInventory } from "../../src/job/inventory.ts";
import { OfflineHttpClient } from "../../src/sources/http.ts";
import { JsonStore } from "../../src/store/json_store.ts";
import { buildFixtures } from "./fixtures.ts";

const PYTHON_SCRIPT =
  "/home/tmckenzie/development/sunbeam/sbbb/scripts/component-version-inventory.py";
const SEED_PATH = new URL("../../seed/component-versions.yaml", import.meta.url).pathname;

/**
 * Parity harness: the TypeScript port must produce the same JSON report as the
 * original Python script when both run offline against identical prior state.
 *
 *   Python: HOME=<tmp> with a seeded cache + a dead proxy → every fetch fails →
 *           cache fallback produces the report.
 *   RADAR:  previous report seeded into the JSON store + OfflineHttpClient →
 *           previous-state fallback produces the report.
 */
Deno.test({
  name: "typescript job output matches python script output (offline fallback)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const workDir = await Deno.makeTempDir({ prefix: "radar-parity-" });
    try {
      const { pythonCache, previousRecords } = await buildFixtures(SEED_PATH);

      // The reference implementation's strict constructor rejects unknown keys;
      // assessor hints (channel, versioning_scheme, …) are RADAR-only, so the
      // reference runs against a hint-stripped copy of the seed.
      const strippedSeed = join(workDir, "seed.python.yaml");
      {
        const { parse, stringify } = await import("@std/yaml");
        const doc = parse(await Deno.readTextFile(SEED_PATH)) as {
          components: Record<string, unknown>[];
        };
        const HINT_KEYS = [
          "channel",
          "versioning_scheme",
          "breaking_change_policy",
          "eol_version_line",
          "eol_date",
          "eol_replacement",
          "deprecated",
        ];
        const components = doc.components.map((c) =>
          Object.fromEntries(Object.entries(c).filter(([k]) => !HINT_KEYS.includes(k)))
        );
        await Deno.writeTextFile(strippedSeed, stringify({ components }));
      }

      // --- Python run ---
      const home = join(workDir, "home");
      await Deno.mkdir(join(home, ".cache", "sbbb"), { recursive: true });
      await Deno.writeTextFile(
        join(home, ".cache", "sbbb", "component-version-cache.json"),
        JSON.stringify(pythonCache),
      );
      const pythonOut = join(workDir, "python.json");
      const python = await new Deno.Command("python3", {
        args: [PYTHON_SCRIPT, "--config", strippedSeed, "--json", "--json-out", pythonOut],
        env: {
          HOME: home,
          HTTPS_PROXY: "http://127.0.0.1:9",
          https_proxy: "http://127.0.0.1:9",
          HTTP_PROXY: "http://127.0.0.1:9",
          http_proxy: "http://127.0.0.1:9",
          PATH: "/usr/bin:/bin",
        },
        stdout: "piped",
        stderr: "piped",
      }).output();
      if (!python.success) {
        throw new Error(
          `python script failed: ${new TextDecoder().decode(python.stderr)}`,
        );
      }
      const pythonReport = JSON.parse(await Deno.readTextFile(pythonOut));

      // --- TypeScript run ---
      const jsonPath = join(workDir, "radar.json");
      const store = new JsonStore(jsonPath);
      await store.saveReport(
        { generated_at: "2026-01-01 00:00:00 UTC", components: previousRecords },
        { domainSuffix: "sunbeam.pt", gitBaseUrl: "fixture" },
      );
      const tsReport = await runInventory({
        http: new OfflineHttpClient("parity offline"),
        store,
        seedPath: SEED_PATH,
        domainSuffix: "sunbeam.pt",
        fetchDelayMs: 0,
        now: new Date(Date.UTC(2026, 7, 21, 12, 0, 0)),
      });

      // --- Compare ---
      const pythonComponents = pythonReport.components as Record<string, unknown>[];
      assertEquals(
        tsReport.components.length,
        pythonComponents.length,
        "component count mismatch",
      );

      for (const [i, py] of pythonComponents.entries()) {
        const ts = tsReport.components[i] as unknown as Record<string, unknown>;
        assertEquals(
          Object.keys(ts),
          Object.keys(py),
          `key order mismatch for component ${py.name}`,
        );
        assertEquals(ts, py, `record mismatch for component ${py.name} (index ${i})`);
      }

      // Reference copy for review/debugging (trailing newline keeps deno fmt happy).
      await Deno.writeTextFile(
        new URL("./fixtures/golden.python.json", import.meta.url),
        JSON.stringify(pythonReport, null, 2) + "\n",
      );
    } finally {
      await Deno.remove(workDir, { recursive: true });
    }
  },
});
