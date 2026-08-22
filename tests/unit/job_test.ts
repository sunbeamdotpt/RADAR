import { assertEquals } from "jsr:@std/assert@^1";
import { join } from "jsr:@std/path@^1";
import { runInventory } from "../../src/job/inventory.ts";
import type { InventoryReport } from "../../src/schema/component.ts";
import { OfflineHttpClient } from "../../src/sources/http.ts";
import type { HttpClient } from "../../src/sources/http.ts";
import { JsonStore } from "../../src/store/json_store.ts";
import type { RunMeta, Store } from "../../src/store/store.ts";

const META: RunMeta = { domainSuffix: "sunbeam.pt", gitBaseUrl: "https://example.test/repo.git" };

class MemoryStore implements Store {
  report: InventoryReport | null = null;
  loadPrevious(): Promise<InventoryReport | null> {
    return Promise.resolve(this.report);
  }
  saveReport(report: InventoryReport, _meta: RunMeta): Promise<void> {
    this.report = report;
    return Promise.resolve();
  }
  healthCheck(): Promise<boolean> {
    return Promise.resolve(true);
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

async function withSeed(components: unknown[], fn: (seedPath: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "radar-job-test-" });
  try {
    const { stringify } = await import("@std/yaml");
    const seedPath = join(dir, "seed.yaml");
    await Deno.writeTextFile(seedPath, stringify({ components }));
    await fn(seedPath);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const SEED = [
  {
    name: "CFSSL",
    namespace: "cert-manager",
    current: "v1.6.5",
    source: "github_release",
    upstream: "cloudflare/cfssl",
    link_template: "https://github.com/cloudflare/cfssl/releases/tag/{tag}",
  },
  {
    name: "Sunbeam Proxy",
    namespace: "ingress",
    current: "v0.3.0",
    source: "static",
    upstream: "ghcr.io/sunbeamdotpt/proxy",
    link_template: "https://ghcr.io/sunbeamdotpt/proxy",
    notes: "Custom image",
  },
];

const NOW = new Date(Date.UTC(2026, 7, 21, 12, 0, 0));

Deno.test("first run ingests the seed; offline fetches fall to error state", async () => {
  await withSeed(SEED, async (seedPath) => {
    const store = new MemoryStore();
    const report = await runInventory({
      http: new OfflineHttpClient("test offline"),
      store,
      seedPath,
      domainSuffix: "sunbeam.pt",
      fetchDelayMs: 0,
      now: NOW,
    });
    assertEquals(report.generated_at, "2026-08-21 12:00:00 UTC");
    assertEquals(report.components.length, 2);

    const [cfssl, proxy] = report.components;
    assertEquals(cfssl.latest, "error");
    assertEquals(cfssl.notes.startsWith("Fetch failed: fetch failed:"), true);
    assertEquals(cfssl.update_available, false);
    // static never touches the network → "unknown", notes preserved
    assertEquals(proxy.latest, "unknown");
    assertEquals(proxy.notes, "Custom image");
  });
});

Deno.test("second run ingests the previous report and falls back to it offline", async () => {
  await withSeed(SEED, async (seedPath) => {
    const store = new MemoryStore();
    const first = await runInventory({
      http: new StubGithub({ tag_name: "v1.7.0", html_url: "https://x" }),
      store,
      seedPath,
      domainSuffix: "sunbeam.pt",
      fetchDelayMs: 0,
      now: NOW,
    });
    await store.saveReport(first, META);
    assertEquals(first.components[0].latest, "v1.7.0");
    assertEquals(first.components[0].update_available, true);

    // Offline now: previous values must be reused, not "error".
    const second = await runInventory({
      http: new OfflineHttpClient(),
      store,
      seedPath,
      domainSuffix: "sunbeam.pt",
      fetchDelayMs: 0,
      now: NOW,
    });
    assertEquals(second.components[0].latest, "v1.7.0");
    assertEquals(second.components[0].notes, "");
    assertEquals(second.components[0].update_available, true);
    // Seed must NOT be re-ingested: notes reflect first run's state.
    assertEquals(second.components.length, 2);
  });
});

class StubGithub implements HttpClient {
  constructor(private readonly release: unknown) {}
  json(url: string): Promise<unknown> {
    if (url.includes("/releases/latest")) return Promise.resolve(this.release);
    return Promise.reject(new Error(`unstubbed ${url}`));
  }
  text(url: string): Promise<string> {
    return Promise.reject(new Error(`unstubbed ${url}`));
  }
}

Deno.test("ingest resets run-appended notes from the seed's curated values", async () => {
  await withSeed(SEED, async (seedPath) => {
    const store = new MemoryStore();
    // First run offline: CFSSL gets a "Fetch failed" note, nothing curates it away.
    const first = await runInventory({
      http: new OfflineHttpClient("transient outage"),
      store,
      seedPath,
      domainSuffix: "sunbeam.pt",
      fetchDelayMs: 0,
      now: NOW,
    });
    assertEquals(first.components[0].notes.includes("Fetch failed"), true);
    await store.saveReport(first, META);

    // Second run: the transient note must not become the new baseline —
    // the seed's curated notes ("") win, and the fresh failure re-annotates.
    const second = await runInventory({
      http: new StubGithub({ tag_name: "v1.7.0", html_url: "https://x" }),
      store,
      seedPath,
      domainSuffix: "sunbeam.pt",
      fetchDelayMs: 0,
      now: NOW,
    });
    assertEquals(second.components[0].notes, "");
    assertEquals(second.components[0].latest, "v1.7.0");
  });
});

Deno.test("pin refresh updates current from the cloned base", async () => {
  await withSeed(SEED, async (seedPath) => {
    const base = await Deno.makeTempDir({ prefix: "radar-pin-test-" });
    try {
      await Deno.mkdir(join(base, "base", "ingress"), { recursive: true });
      await Deno.writeTextFile(
        join(base, "base", "ingress", "kustomization.yaml"),
        `kind: Kustomization
namespace: ingress
images:
  - name: proxy
    newName: ghcr.io/sunbeamdotpt/proxy
    newTag: v0.4.0
`,
      );
      const report = await runInventory({
        http: new OfflineHttpClient(),
        store: new MemoryStore(),
        seedPath,
        domainSuffix: "sunbeam.pt",
        clonedBasePath: base,
        fetchDelayMs: 0,
        now: NOW,
      });
      const proxy = report.components.find((c) => c.name === "Sunbeam Proxy")!;
      assertEquals(proxy.current, "v0.4.0");
    } finally {
      await Deno.remove(base, { recursive: true });
    }
  });
});

Deno.test("auto-detect appends untracked components from the cloned base", async () => {
  await withSeed(SEED, async (seedPath) => {
    const base = await Deno.makeTempDir({ prefix: "radar-autodetect-test-" });
    try {
      await Deno.mkdir(join(base, "base", "newns"), { recursive: true });
      await Deno.writeTextFile(
        join(base, "base", "newns", "kustomization.yaml"),
        `kind: Kustomization
namespace: newns
helmCharts:
  - name: brand-new-chart
    repo: https://charts.example.io
    version: "2.0.0"
images:
  - name: proxy
    newName: ghcr.io/sunbeamdotpt/proxy
    newTag: v0.5.0
`,
      );

      const run = (autoDetect: boolean) =>
        runInventory({
          http: new OfflineHttpClient("test offline"),
          store: new MemoryStore(),
          seedPath,
          domainSuffix: "sunbeam.pt",
          clonedBasePath: base,
          autoDetect,
          fetchDelayMs: 0,
          now: NOW,
        });

      // Gated off: only the two curated components, but pins still refresh.
      const off = await run(false);
      assertEquals(off.components.length, 2);
      assertEquals(off.components.find((c) => c.name === "Sunbeam Proxy")?.current, "v0.5.0");

      // Gated on: the new chart is appended and goes through the same fetch path.
      const on = await run(true);
      assertEquals(on.components.length, 3);
      const added = on.components.find((c) => c.name === "brand-new-chart")!;
      assertEquals(added.namespace, "newns");
      assertEquals(added.source, "helm_chart");
      assertEquals(added.current, "2.0.0");
      assertEquals(added.chart_version, "2.0.0");
      assertEquals(added.track_app_version, true);
      // Offline, first sight, no previous value → error state.
      assertEquals(added.latest, "error");
      assertEquals(added.notes.startsWith("Fetch failed:"), true);
      // The already-tracked proxy upstream is not duplicated.
      assertEquals(
        on.components.filter((c) => c.upstream === "ghcr.io/sunbeamdotpt/proxy").length,
        1,
      );
    } finally {
      await Deno.remove(base, { recursive: true });
    }
  });
});

Deno.test("auto-detected components persist and fall back on subsequent runs", async () => {
  await withSeed(SEED, async (seedPath) => {
    const base = await Deno.makeTempDir({ prefix: "radar-autodetect-rerun-" });
    try {
      await Deno.mkdir(join(base, "base", "newns"), { recursive: true });
      await Deno.writeTextFile(
        join(base, "base", "newns", "kustomization.yaml"),
        `kind: Kustomization
namespace: newns
images:
  - name: widget
    newName: ghcr.io/studio/widget
    newTag: v1.0.0
`,
      );
      const store = new MemoryStore();
      const deps = {
        http: new OfflineHttpClient("test offline"),
        store,
        seedPath,
        domainSuffix: "sunbeam.pt",
        clonedBasePath: base,
        autoDetect: true,
        fetchDelayMs: 0,
        now: NOW,
      };

      const first = await runInventory(deps);
      assertEquals(first.components.length, 3);
      const widget = first.components.find((c) => c.name === "widget")!;
      assertEquals(widget.source, "static"); // ghcr.io → static per classifier
      assertEquals(widget.latest, "unknown"); // static fetcher, no network involved
      await store.saveReport(first, META);

      // Second run ingests the store: still 3 components, no duplicates.
      const second = await runInventory(deps);
      assertEquals(second.components.length, 3);
      assertEquals(second.components.filter((c) => c.name === "widget").length, 1);
    } finally {
      await Deno.remove(base, { recursive: true });
    }
  });
});

Deno.test("JsonStore round-trips a report and returns null when missing", async () => {
  const dir = await Deno.makeTempDir({ prefix: "radar-jsonstore-test-" });
  try {
    const path = join(dir, "nested", "report.json");
    const store = new JsonStore(path);
    assertEquals(await store.loadPrevious(), null);

    const report: InventoryReport = {
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
      ],
    };
    await store.saveReport(report, META);
    const loaded = await store.loadPrevious();
    assertEquals(loaded, report);
    assertEquals(await store.healthCheck(), true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("auto-detect reads the ignore list from the seed file", async () => {
  const dir = await Deno.makeTempDir({ prefix: "radar-ignore-test-" });
  const base = await Deno.makeTempDir({ prefix: "radar-ignore-base-" });
  try {
    const { stringify } = await import("@std/yaml");
    const seedPath = join(dir, "seed.yaml");
    await Deno.writeTextFile(
      seedPath,
      stringify({ ignore: ["wiki"], components: SEED }),
    );
    await Deno.mkdir(join(base, "base", "wiki"), { recursive: true });
    await Deno.writeTextFile(
      join(base, "base", "wiki", "kustomization.yaml"),
      `kind: Kustomization
namespace: wiki
images:
  - name: wiki
    newTag: latest
  - name: docs-widget
    newName: ghcr.io/sunbeamdotpt/docs-widget
    newTag: v1.0.0
`,
    );
    const report = await runInventory({
      http: new OfflineHttpClient("test offline"),
      store: new MemoryStore(),
      seedPath,
      domainSuffix: "sunbeam.pt",
      clonedBasePath: base,
      autoDetect: true,
      fetchDelayMs: 0,
      now: NOW,
    });
    const names = report.components.map((c) => c.name);
    assertEquals(names.includes("wiki"), false, "ignored upstream must not be added");
    assertEquals(names.includes("docs-widget"), true, "non-ignored entry must be added");
    assertEquals(report.components.length, 3);
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(base, { recursive: true });
  }
});
