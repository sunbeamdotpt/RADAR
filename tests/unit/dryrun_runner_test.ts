import { assertEquals, assertThrows } from "jsr:@std/assert@^1";
import { join } from "jsr:@std/path@^1";
import { parse as parseYaml } from "@std/yaml";
import type { ComponentRecord } from "../../src/schema/component.ts";
import { guardDryRun, runComponentDryRun } from "../../src/dryrun/runner.ts";

async function makeKustomizationDir(chartName: string, version: string): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "radar-dryrun-runner-" });
  await Deno.writeTextFile(
    join(dir, "kustomization.yaml"),
    `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - namespace.yaml
helmCharts:
  - name: ${chartName}
    repo: https://example.test
    version: "${version}"
    releaseName: ${chartName}
    namespace: default
`,
  );
  await Deno.writeTextFile(
    join(dir, "namespace.yaml"),
    `apiVersion: v1\nkind: Namespace\nmetadata:\n  name: test\n`,
  );
  return dir;
}

const COMPONENT: ComponentRecord = {
  name: "Example",
  namespace: "default",
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
  guardDryRun(["kustomize", "build", "/tmp"]);
  guardDryRun(["helm", "version"]);
});

Deno.test("runComponentDryRun skips non-helm components", async () => {
  const dir = await Deno.makeTempDir({ prefix: "radar-dryrun-runner-" });
  try {
    const result = await runComponentDryRun(
      { ...COMPONENT, source: "github_release" },
      { path: dir, source: "test" },
      { buildOnly: false },
    );
    assertEquals(result.status, "skipped_unsupported_source");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("runComponentDryRun skips when upstream has no chart name", async () => {
  const dir = await makeKustomizationDir("example", "1.0.0");
  try {
    const result = await runComponentDryRun(
      { ...COMPONENT, upstream: "https://example.test" },
      { path: dir, source: "test" },
      { buildOnly: false },
    );
    assertEquals(result.status, "skipped_unsupported_source");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("runComponentDryRun skips when chart is not present", async () => {
  const dir = await makeKustomizationDir("other", "1.0.0");
  try {
    const result = await runComponentDryRun(
      COMPONENT,
      { path: dir, source: "test" },
      { buildOnly: false },
    );
    assertEquals(result.status, "skipped_no_mapping");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("runComponentDryRun mutates version and reports build failure", async () => {
  const dir = await makeKustomizationDir("example", "1.0.0");
  try {
    const result = await runComponentDryRun(
      COMPONENT,
      { path: dir, source: "test" },
      {
        buildOnly: true,
        runCommand: (argv) => {
          const [tool, ...args] = argv;
          if (tool === "kustomize" && args[0] === "build") {
            return { success: false, code: 1, stdout: "", stderr: "helm not configured" };
          }
          return { success: true, code: 0, stdout: "", stderr: "" };
        },
      },
    );
    assertEquals(result.status, "build_failed");
    assertEquals(result.mutated_helm_version, "v2.0.0");
    assertEquals(result.stderr, "helm not configured");
    // Verify the temp copy was mutated, not the original.
    const original = parseYaml(await Deno.readTextFile(join(dir, "kustomization.yaml"))) as Record<
      string,
      unknown
    >;
    const charts = original.helmCharts as Array<{ version: string }>;
    assertEquals(charts[0].version, "1.0.0");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("runComponentDryRun succeeds with buildOnly", async () => {
  const dir = await makeKustomizationDir("example", "1.0.0");
  try {
    const result = await runComponentDryRun(
      COMPONENT,
      { path: dir, source: "test" },
      {
        buildOnly: true,
        runCommand: (argv) => {
          const [tool, ...args] = argv;
          if (tool === "kustomize" && args[0] === "build") {
            return { success: true, code: 0, stdout: "namespace/test created", stderr: "" };
          }
          return { success: true, code: 0, stdout: "", stderr: "" };
        },
      },
    );
    assertEquals(result.status, "success");
    assertEquals(result.stdout, "namespace/test created");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("runComponentDryRun pipes build output to kubectl dry-run", async () => {
  const dir = await makeKustomizationDir("example", "1.0.0");
  try {
    let kubectlInput = "";
    const result = await runComponentDryRun(
      COMPONENT,
      { path: dir, source: "test" },
      {
        buildOnly: false,
        runCommand: (argv, stdin?) => {
          const [tool] = argv;
          if (tool === "kustomize") {
            return { success: true, code: 0, stdout: "rendered-manifests", stderr: "" };
          }
          if (tool === "kubectl") {
            kubectlInput = stdin ?? "";
            return { success: true, code: 0, stdout: "created (dry-run)", stderr: "" };
          }
          return { success: true, code: 0, stdout: "", stderr: "" };
        },
      },
    );
    assertEquals(result.status, "success");
    assertEquals(kubectlInput, "rendered-manifests");
    assertEquals(result.stdout, "created (dry-run)");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("runComponentDryRun records dryrun failure", async () => {
  const dir = await makeKustomizationDir("example", "1.0.0");
  try {
    const result = await runComponentDryRun(
      COMPONENT,
      { path: dir, source: "test" },
      {
        buildOnly: false,
        runCommand: (argv) => {
          const [tool] = argv;
          if (tool === "kustomize") return { success: true, code: 0, stdout: "x", stderr: "" };
          if (tool === "kubectl") return { success: false, code: 1, stdout: "", stderr: "no CRD" };
          return { success: true, code: 0, stdout: "", stderr: "" };
        },
      },
    );
    assertEquals(result.status, "dryrun_failed");
    assertEquals(result.stderr, "no CRD");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("runComponentDryRun passes --dry-run=server to kubectl", async () => {
  const dir = await makeKustomizationDir("example", "1.0.0");
  try {
    let kubectlArgv: string[] = [];
    await runComponentDryRun(
      COMPONENT,
      { path: dir, source: "test" },
      {
        buildOnly: false,
        runCommand: (argv) => {
          const [tool] = argv;
          if (tool === "kustomize") return { success: true, code: 0, stdout: "x", stderr: "" };
          if (tool === "kubectl") {
            kubectlArgv = argv;
            return { success: true, code: 0, stdout: "", stderr: "" };
          }
          return { success: true, code: 0, stdout: "", stderr: "" };
        },
      },
    );
    assertEquals(kubectlArgv.includes("--dry-run=server"), true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
