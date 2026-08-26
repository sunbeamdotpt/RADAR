import { assertEquals, assertThrows } from "jsr:@std/assert@^1";
import { join } from "jsr:@std/path@^1";
import { parse as parseYaml } from "@std/yaml";
import type { ComponentRecord } from "../../src/schema/component.ts";
import { guardDryRun, runNamespaceDryRun } from "../../src/dryrun/runner.ts";

async function makeNamespaceBase(
  base: string,
  namespace: string,
  chartName: string,
  version: string,
): Promise<string> {
  const dir = join(base, namespace);
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(
    join(dir, "kustomization.yaml"),
    `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: ${namespace}
resources:
  - namespace.yaml
helmCharts:
  - name: ${chartName}
    repo: https://example.test
    version: "${version}"
    releaseName: ${chartName}
    namespace: ${namespace}
`,
  );
  await Deno.writeTextFile(
    join(dir, "namespace.yaml"),
    `apiVersion: v1\nkind: Namespace\nmetadata:\n  name: ${namespace}\n`,
  );
  return dir;
}

const COMPONENT: ComponentRecord = {
  name: "Example",
  namespace: "test",
  current: "v1.0.0",
  latest: "v2.0.0",
  source: "helm_chart",
  upstream: "https://example.test::example",
  link_template: "",
  notes: "",
  update_available: true,
  chart_version: "1.0.0",
  track_app_version: false,
};

Deno.test("guardDryRun allows kubectl with --dry-run=server", () => {
  guardDryRun(["kubectl", "apply", "--dry-run=server", "-f", "-"]);
  guardDryRun(["kubectl", "--dry-run=server", "apply", "-f", "-"]);
});

Deno.test("guardDryRun rejects kubectl without --dry-run=server", () => {
  assertThrows(
    () => guardDryRun(["kubectl", "apply", "-f", "-"]),
    Error,
    "refusing to execute kubectl",
  );
  assertThrows(
    () => guardDryRun(["kubectl", "apply", "--dry-run=client", "-f", "-"]),
    Error,
    "refusing to execute kubectl",
  );
});

Deno.test("guardDryRun ignores non-kubectl commands", () => {
  guardDryRun(["sunbeam", "service", "apply", "test", "--dry-run"]);
  guardDryRun(["helm", "version"]);
});

Deno.test("runNamespaceDryRun skips when no components provided", async () => {
  const base = await Deno.makeTempDir({ prefix: "radar-dryrun-runner-" });
  try {
    const result = await runNamespaceDryRun(
      { namespace: "test", namespaceBase: base, components: [] },
      { buildOnly: true },
    );
    assertEquals(result.status, "skipped_no_mapping");
    assertEquals(result.namespace, "test");
    assertEquals(result.components, []);
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("runNamespaceDryRun skips non-helm components", async () => {
  const base = await Deno.makeTempDir({ prefix: "radar-dryrun-runner-" });
  try {
    const result = await runNamespaceDryRun(
      {
        namespace: "test",
        namespaceBase: base,
        components: [{ ...COMPONENT, source: "github_release" }],
      },
      { buildOnly: true },
    );
    assertEquals(result.status, "skipped_unsupported_source");
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("runNamespaceDryRun skips when namespace base is missing", async () => {
  const base = await Deno.makeTempDir({ prefix: "radar-dryrun-runner-" });
  try {
    const result = await runNamespaceDryRun(
      { namespace: "test", namespaceBase: base, components: [COMPONENT] },
      { buildOnly: true },
    );
    assertEquals(result.status, "skipped_no_mapping");
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("runNamespaceDryRun mutates version and reports build failure", async () => {
  const base = await Deno.makeTempDir({ prefix: "radar-dryrun-runner-" });
  try {
    const nsBase = await makeNamespaceBase(base, "test", "example", "1.0.0");
    const result = await runNamespaceDryRun(
      { namespace: "test", namespaceBase: nsBase, components: [COMPONENT] },
      {
        buildOnly: true,
        runCommand: (argv) => {
          const [tool, ...args] = argv;
          if (tool === "sunbeam" && args[0] === "service" && args[1] === "apply") {
            return { success: false, code: 1, stdout: "", stderr: "sunbeam not configured" };
          }
          return { success: true, code: 0, stdout: "", stderr: "" };
        },
      },
    );
    assertEquals(result.status, "build_failed");
    assertEquals(result.stderr, "sunbeam not configured");
    // Verify the temp copy was mutated, not the original.
    const original = parseYaml(
      await Deno.readTextFile(join(base, "test", "kustomization.yaml")),
    ) as Record<string, unknown>;
    const charts = original.helmCharts as Array<{ version: string }>;
    assertEquals(charts[0].version, "1.0.0");
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("runNamespaceDryRun succeeds with buildOnly", async () => {
  const base = await Deno.makeTempDir({ prefix: "radar-dryrun-runner-" });
  try {
    const nsBase = await makeNamespaceBase(base, "test", "example", "1.0.0");
    const result = await runNamespaceDryRun(
      { namespace: "test", namespaceBase: nsBase, components: [COMPONENT] },
      {
        buildOnly: true,
        runCommand: (argv) => {
          const [tool, ...args] = argv;
          if (tool === "sunbeam" && args[0] === "service" && args[1] === "apply") {
            return { success: true, code: 0, stdout: "namespace/test created", stderr: "" };
          }
          return { success: true, code: 0, stdout: "", stderr: "" };
        },
      },
    );
    assertEquals(result.status, "success");
    assertEquals(result.stdout, "namespace/test created");
    assertEquals(result.components, ["Example"]);
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("runNamespaceDryRun runs kubectl server-side dry-run", async () => {
  const base = await Deno.makeTempDir({ prefix: "radar-dryrun-runner-" });
  try {
    const nsBase = await makeNamespaceBase(base, "test", "example", "1.0.0");
    let kubectlArgv: string[] = [];
    const result = await runNamespaceDryRun(
      { namespace: "test", namespaceBase: nsBase, components: [COMPONENT] },
      {
        buildOnly: false,
        runCommand: (argv) => {
          const [tool, ...args] = argv;
          if (tool === "sunbeam" && args[0] === "service" && args[1] === "apply") {
            return { success: true, code: 0, stdout: "rendered-manifests", stderr: "" };
          }
          if (tool === "kubectl") {
            kubectlArgv = argv;
            return {
              success: true,
              code: 0,
              stdout: "serverside-applied (server dry run)",
              stderr: "",
            };
          }
          return { success: true, code: 0, stdout: "", stderr: "" };
        },
      },
    );
    assertEquals(result.status, "success");
    assertEquals(kubectlArgv.includes("--server-side"), true);
    assertEquals(kubectlArgv.includes("--force-conflicts"), true);
    assertEquals(kubectlArgv.includes("--dry-run=server"), true);
    assertEquals(kubectlArgv.includes("--request-timeout=5m"), true);
    assertEquals(result.stdout, "serverside-applied (server dry run)");
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("runNamespaceDryRun records dryrun failure", async () => {
  const base = await Deno.makeTempDir({ prefix: "radar-dryrun-runner-" });
  try {
    const nsBase = await makeNamespaceBase(base, "test", "example", "1.0.0");
    const result = await runNamespaceDryRun(
      { namespace: "test", namespaceBase: nsBase, components: [COMPONENT] },
      {
        buildOnly: false,
        runCommand: (argv) => {
          const [tool] = argv;
          if (tool === "sunbeam") return { success: true, code: 0, stdout: "x", stderr: "" };
          if (tool === "kubectl") return { success: false, code: 1, stdout: "", stderr: "no CRD" };
          return { success: true, code: 0, stdout: "", stderr: "" };
        },
      },
    );
    assertEquals(result.status, "dryrun_failed");
    assertEquals(result.stderr, "no CRD");
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});
