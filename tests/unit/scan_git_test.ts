import { assertEquals, assertThrows } from "jsr:@std/assert@^1";
import { join } from "jsr:@std/path@^1";
import {
  bootstrapSeedYaml,
  genericLinkTemplate,
  githubReleaseFromUrl,
  imageUpstreamAndSource,
  refreshPinsFromScan,
  scanBaseManifests,
  scanManifestImages,
} from "../../src/scan/manifests.ts";
import { cloneRepo } from "../../src/git/clone.ts";
import { parseSeedComponent } from "../../src/schema/component.ts";

Deno.test("imageUpstreamAndSource classifies Docker Hub images", () => {
  assertEquals(imageUpstreamAndSource("postgres:17-alpine", "sunbeam.pt"), {
    upstream: "postgres",
    source: "docker_hub",
  });
  assertEquals(imageUpstreamAndSource("docker.io/library/postgres:17", "sunbeam.pt"), {
    upstream: "library/postgres",
    source: "docker_hub",
  });
  assertEquals(
    imageUpstreamAndSource("scaleway/cert-manager-webhook-scaleway:v0.1.1", "sunbeam.pt"),
    {
      upstream: "scaleway/cert-manager-webhook-scaleway",
      source: "docker_hub",
    },
  );
});

Deno.test("imageUpstreamAndSource classifies external registries as static", () => {
  assertEquals(imageUpstreamAndSource("ghcr.io/sunbeamdotpt/proxy:v0.3.0", "sunbeam.pt"), {
    upstream: "ghcr.io/sunbeamdotpt/proxy",
    source: "static",
  });
  assertEquals(imageUpstreamAndSource("quay.io/org/img:1.0@sha256:abc", "sunbeam.pt"), {
    upstream: "quay.io/org/img",
    source: "static",
  });
});

Deno.test("imageUpstreamAndSource resolves DOMAIN_SUFFIX placeholders", () => {
  assertEquals(imageUpstreamAndSource("src.DOMAIN_SUFFIX/studio/sol:latest", "example.com"), {
    upstream: "src.example.com/studio/sol",
    source: "static",
  });
  // oci.DOMAIN_SUFFIX counts as external via the "oci." prefix
  assertEquals(imageUpstreamAndSource("oci.DOMAIN_SUFFIX/studio/press:latest", "example.com"), {
    upstream: "oci.example.com/studio/press",
    source: "static",
  });
});

Deno.test("genericLinkTemplate covers docker_hub, ghcr static, and the empty case", () => {
  assertEquals(
    genericLinkTemplate("docker_hub", "postgres"),
    "https://hub.docker.com/r/postgres/tags",
  );
  assertEquals(genericLinkTemplate("static", "ghcr.io/x/y"), "https://ghcr.io/x/y");
  assertEquals(genericLinkTemplate("static", "codefloe.com/pat-s/zendrite"), "");
  assertEquals(genericLinkTemplate("github_release", "org/repo"), "");
});

Deno.test("githubReleaseFromUrl parses release asset URLs", () => {
  assertEquals(
    githubReleaseFromUrl(
      "https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.5.1/experimental-install.yaml",
    ),
    { ownerRepo: "kubernetes-sigs/gateway-api", tag: "v1.5.1", asset: "experimental-install.yaml" },
  );
  assertEquals(githubReleaseFromUrl("https://github.com/org/repo"), null);
  assertEquals(githubReleaseFromUrl("deploy.yaml"), null);
});

Deno.test("scanManifestImages extracts workload container images", () => {
  const manifest = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app
spec:
  template:
    spec:
      initContainers:
        - name: init
          image: busybox:1.36
      containers:
        - name: app
          image: ghcr.io/sunbeamdotpt/app:v1.0.0
---
apiVersion: v1
kind: Service
metadata:
  name: app
`;
  const seen = new Set<string>();
  const found = scanManifestImages(manifest, "app-deployment.yaml", "app", seen, "sunbeam.pt");
  assertEquals(found.length, 2);
  // Python scans containers first, then initContainers.
  assertEquals(found[0].upstream, "ghcr.io/sunbeamdotpt/app");
  assertEquals(found[0].source, "static");
  assertEquals(found[0].notes, "Auto-detected from base/app/app-deployment.yaml");
  assertEquals(found[1].upstream, "busybox");
  assertEquals(found[1].source, "docker_hub");
  assertEquals(found[1].current, "1.36");
  // Dedupe: a second scan with the same `seen` finds nothing new.
  assertEquals(scanManifestImages(manifest, "app-deployment.yaml", "app", seen, "sunbeam.pt"), []);
});

Deno.test("scanManifestImages tolerates invalid YAML and missing tag", () => {
  assertEquals(scanManifestImages("{not: yaml: [", "x.yaml", "ns", new Set(), "sunbeam.pt"), []);
  const found = scanManifestImages(
    "kind: Job\nspec:\n  template:\n    spec:\n      containers:\n        - image: curl\n",
    "job.yaml",
    "ns",
    new Set(),
    "sunbeam.pt",
  );
  assertEquals(found[0].current, "latest");
});

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "radar-scan-test-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("scanBaseManifests derives entries from kustomizations", async () => {
  await withTempDir(async (root) => {
    const clusterDir = join(root, "base", "cluster");
    const dataDir = join(root, "base", "data");
    await Deno.mkdir(clusterDir, { recursive: true });
    await Deno.mkdir(dataDir, { recursive: true });

    await Deno.writeTextFile(
      join(clusterDir, "kustomization.yaml"),
      `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: cluster
resources:
  - https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.5.1/experimental-install.yaml
`,
    );
    await Deno.writeTextFile(
      join(dataDir, "kustomization.yaml"),
      `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: data
resources:
  - postgres-deployment.yaml
helmCharts:
  - name: cloudnative-pg
    repo: https://cloudnative-pg.github.io/charts
    version: "0.29.0"
images:
  - name: postgres
    newName: ghcr.io/cloudnative-pg/postgresql
    newTag: 18.1-system-trixie
`,
    );
    await Deno.writeTextFile(
      join(dataDir, "postgres-deployment.yaml"),
      `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
spec:
  template:
    spec:
      containers:
        - name: postgres
          image: postgres:17-alpine
`,
    );

    const scanned = await scanBaseManifests(root, "sunbeam.pt");
    const byUpstream = new Map(scanned.map((s) => [s.upstream, s]));

    const gh = byUpstream.get("kubernetes-sigs/gateway-api");
    assertEquals(gh?.source, "github_release");
    assertEquals(gh?.current, "v1.5.1");
    assertEquals(
      gh?.link_template,
      "https://github.com/kubernetes-sigs/gateway-api/releases/tag/{tag}",
    );

    const helm = byUpstream.get("https://cloudnative-pg.github.io/charts::cloudnative-pg");
    assertEquals(helm?.source, "helm_chart");
    assertEquals(helm?.current, "0.29.0");
    assertEquals(helm?.chart_version, "0.29.0");
    assertEquals(helm?.track_app_version, true);

    const img = byUpstream.get("ghcr.io/cloudnative-pg/postgresql");
    assertEquals(img?.source, "static");
    assertEquals(img?.current, "18.1-system-trixie");

    const pg = byUpstream.get("postgres");
    assertEquals(pg?.source, "docker_hub");
    assertEquals(pg?.current, "17-alpine");

    // Sorted by (namespace, name): cluster < data
    assertEquals(scanned[0].namespace, "cluster");
  });
});

Deno.test("refreshPinsFromScan updates matching pins only", () => {
  const helm = parseSeedComponent({
    name: "CNPG",
    namespace: "data",
    current: "0.28.0",
    source: "helm_chart",
    upstream: "https://cloudnative-pg.github.io/charts::cloudnative-pg",
    chart_version: "0.28.0",
    track_app_version: true,
  }, 0);
  const unmatched = parseSeedComponent({
    name: "Other",
    namespace: "data",
    current: "1.0.0",
    source: "static",
    upstream: "ghcr.io/x/other",
  }, 0);
  const scanned = [
    {
      name: "cloudnative-pg",
      namespace: "data",
      current: "0.29.0",
      source: "helm_chart" as const,
      upstream: "https://cloudnative-pg.github.io/charts::cloudnative-pg",
      link_template: "",
      notes: "",
      chart_version: "0.29.0",
      track_app_version: true,
    },
  ];
  const updated = refreshPinsFromScan([helm, unmatched], scanned);
  assertEquals(updated, 1);
  assertEquals(helm.current, "0.29.0");
  assertEquals(helm.chart_version, "0.29.0");
  assertEquals(unmatched.current, "1.0.0");
});

Deno.test("bootstrapSeedYaml emits a valid seed document", async () => {
  const yaml = bootstrapSeedYaml([
    {
      name: "cloudnative-pg",
      namespace: "data",
      current: "0.29.0",
      source: "helm_chart",
      upstream: "https://cloudnative-pg.github.io/charts::cloudnative-pg",
      link_template: "",
      notes: "Helm chart 0.29.0",
      chart_version: "0.29.0",
      track_app_version: true,
    },
  ]);
  assertEquals(yaml.startsWith("# Auto-generated starter registry"), true);
  const { parse: parseYaml } = await import("@std/yaml");
  const doc = parseYaml(yaml) as { components: Record<string, unknown>[] };
  assertEquals(doc.components[0].name, "cloudnative-pg");
  assertEquals(doc.components[0].chart_version, "0.29.0");
  assertEquals(doc.components[0].track_app_version, true);
});

Deno.test("cloneRepo clones a local git repo and cleans up", async () => {
  await withTempDir(async (root) => {
    const origin = join(root, "origin");
    await Deno.mkdir(origin);
    const run = async (args: string[], cwd: string) => {
      const out = await new Deno.Command("git", { args, cwd, stdout: "piped", stderr: "piped" })
        .output();
      if (!out.success) throw new Error(new TextDecoder().decode(out.stderr));
    };
    await run(["init", "-b", "mainline"], origin);
    await run([
      "-c",
      "user.email=t@t",
      "-c",
      "user.name=t",
      "commit",
      "--allow-empty",
      "-m",
      "init",
    ], origin);

    const cloned = await cloneRepo({ url: origin, ref: "mainline" });
    const stat = await Deno.stat(join(cloned.path, ".git"));
    assertEquals(stat.isDirectory, true);
    await cloned.cleanup();
    const exists = await Deno.stat(cloned.path).then(() => true).catch(() => false);
    assertEquals(exists, false);
    await cloned.cleanup(); // idempotent
  });
});

Deno.test("cloneRepo fails cleanly on a bad ref", async () => {
  await withTempDir(async (root) => {
    const origin = join(root, "origin");
    await Deno.mkdir(origin);
    const run = async (args: string[], cwd: string) => {
      await new Deno.Command("git", { args, cwd, stdout: "piped", stderr: "piped" }).output();
    };
    await run(["init", "-b", "mainline"], origin);
    await run([
      "-c",
      "user.email=t@t",
      "-c",
      "user.name=t",
      "commit",
      "--allow-empty",
      "-m",
      "init",
    ], origin);
    let threw = false;
    try {
      await cloneRepo({ url: origin, ref: "does-not-exist" });
    } catch (err) {
      threw = true;
      assertEquals(String(err).includes("git clone failed"), true);
    }
    assertEquals(threw, true);
  });
});

Deno.test("addAutoDetectedComponents dedupes by upstream and disambiguates name collisions", async () => {
  const { addAutoDetectedComponents } = await import("../../src/scan/manifests.ts");
  const curated = [parseSeedComponent({
    name: "curl",
    namespace: "monitoring / stalwart / data",
    current: "8.9.1",
    source: "github_release",
    upstream: "curl/curl",
  }, 0)];

  const scanned = [
    // Same name, different upstream, free namespace → disambiguated.
    {
      name: "curl",
      namespace: "monitoring",
      current: "8.9.1",
      source: "docker_hub" as const,
      upstream: "curl",
      link_template: "",
      notes: "",
    },
    // Same name, another free namespace → disambiguated.
    {
      name: "curl",
      namespace: "data",
      current: "latest",
      source: "docker_hub" as const,
      upstream: "curlimages/curl",
      link_template: "",
      notes: "",
    },
    // Duplicate upstream of the first → skipped silently.
    {
      name: "curl",
      namespace: "stalwart",
      current: "8.10.1",
      source: "docker_hub" as const,
      upstream: "curl",
      link_template: "",
      notes: "",
    },
    // Same name and "curl (monitoring)" already taken → reported as skipped.
    {
      name: "curl",
      namespace: "monitoring",
      current: "1.0",
      source: "docker_hub" as const,
      upstream: "other/curl-fork",
      link_template: "",
      notes: "",
    },
    // Clean add.
    {
      name: "widget",
      namespace: "tools",
      current: "1.0",
      source: "static" as const,
      upstream: "ghcr.io/x/widget",
      link_template: "",
      notes: "",
    },
  ];

  const { added, skipped } = addAutoDetectedComponents(curated, scanned);
  assertEquals(added, 3);
  assertEquals(skipped.length, 1);
  assertEquals(skipped[0].includes("other/curl-fork"), true);
  const names = curated.map((c) => c.name);
  assertEquals(names, ["curl", "curl (monitoring)", "curl (data)", "widget"]);
  assertEquals(
    new Set(names).size,
    names.length,
    "names must stay unique for the (run_id, name) PK",
  );
});

Deno.test("addAutoDetectedComponents honors the ignore list by upstream and name", async () => {
  const { addAutoDetectedComponents } = await import("../../src/scan/manifests.ts");
  const curated = [parseSeedComponent({
    name: "CFSSL",
    namespace: "cert-manager",
    current: "v1.6.5",
    source: "github_release",
    upstream: "cloudflare/cfssl",
  }, 0)];
  const scanned = [
    {
      name: "wiki",
      namespace: "wiki",
      current: "latest",
      source: "docker_hub" as const,
      upstream: "wiki",
      link_template: "",
      notes: "",
    },
    {
      name: "widget",
      namespace: "tools",
      current: "1.0",
      source: "static" as const,
      upstream: "ghcr.io/x/widget",
      link_template: "",
      notes: "",
    },
    {
      name: "busybox",
      namespace: "tools",
      current: "1.36",
      source: "docker_hub" as const,
      upstream: "busybox",
      link_template: "",
      notes: "",
    },
  ];
  const { added, skipped, ignored } = addAutoDetectedComponents(
    curated,
    scanned,
    new Set(["wiki", "busybox"]),
  );
  assertEquals(added, 1);
  assertEquals(ignored, 2);
  assertEquals(skipped, []);
  assertEquals(curated.map((c) => c.name), ["CFSSL", "widget"]);
});

Deno.test("parseSeedIgnore validates the optional ignore list", async () => {
  const { parseSeedIgnore, SchemaError } = await import("../../src/schema/component.ts");
  assertEquals(parseSeedIgnore({ components: [] }), []);
  assertEquals(parseSeedIgnore({ components: [], ignore: ["wiki", "busybox"] }), [
    "wiki",
    "busybox",
  ]);
  assertThrows(() => parseSeedIgnore({ ignore: "wiki" }), SchemaError, '"ignore" must be a list');
  assertThrows(() => parseSeedIgnore({ ignore: [42] }), SchemaError, "ignore[0]");
  assertThrows(() => parseSeedIgnore({ ignore: [""] }), SchemaError, "non-empty string");
});
