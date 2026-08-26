import { assertEquals } from "jsr:@std/assert@^1";
import { join } from "jsr:@std/path@^1";
import { JsonStore } from "../../src/store/json_store.ts";
import type { DryRunReport } from "../../src/schema/dryrun.ts";

const META = { domainSuffix: "sunbeam.pt", gitBaseUrl: "https://example.test/repo.git" };

const DRY_RUNS: DryRunReport = {
  generated_at: "2026-08-25 14:00:00 UTC",
  inventory_generated_at: "2026-08-25 12:00:00 UTC",
  assessment_generated_at: "2026-08-25 13:00:00 UTC",
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
  ],
};

Deno.test("JsonStore round-trips dry-run reports", async () => {
  const dir = await Deno.makeTempDir({ prefix: "radar-store-test-" });
  try {
    const store = new JsonStore(join(dir, "report.json"));
    assertEquals(await store.loadLatestDryRuns(), null);

    await store.saveReport({ generated_at: "2026-08-25 12:00:00 UTC", components: [] }, META);
    await store.saveDryRuns(DRY_RUNS);

    const loaded = await store.loadLatestDryRuns();
    assertEquals(loaded?.generated_at, "2026-08-25 14:00:00 UTC");
    assertEquals(loaded?.dry_runs.length, 1);
    assertEquals(loaded?.dry_runs[0].name, "Longhorn");
    assertEquals(loaded?.dry_runs[0].status, "success");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("JsonStore uses explicit dry-run path when provided", async () => {
  const dir = await Deno.makeTempDir({ prefix: "radar-store-test-" });
  try {
    const customPath = join(dir, "custom.dryruns.json");
    const store = new JsonStore(join(dir, "report.json"), undefined, customPath);
    await store.saveDryRuns(DRY_RUNS);

    const loaded = await store.loadLatestDryRuns();
    assertEquals(loaded?.dry_runs.length, 1);
    assertEquals((await Deno.stat(customPath)).isFile, true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
