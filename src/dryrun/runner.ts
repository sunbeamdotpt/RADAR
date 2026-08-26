import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";
import { join } from "jsr:@std/path@^1";
import type { ComponentRecord } from "../schema/component.ts";
import type { DryRun, DryRunStatus } from "../schema/dryrun.ts";
import type { MappedPath } from "./mapper.ts";

export interface RunnerDeps {
  kubeconfig?: string;
  /** Skip kubectl and only run kustomize build. */
  buildOnly: boolean;
  /**
   * Command executor override. Defaults to Deno.Command.
   * Every argv passed here is guaranteed to contain `--dry-run=server` when kubectl is used.
   * For kubectl, stdin carries the rendered manifest stream from kustomize build.
   */
  runCommand?: (argv: string[], stdin?: string) => Promise<CommandResult> | CommandResult;
}

export interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

/** Run kustomize build + kubectl apply --dry-run=server for one component. */
export async function runComponentDryRun(
  component: ComponentRecord,
  mapped: MappedPath,
  deps: RunnerDeps,
): Promise<DryRun> {
  const start = Date.now();
  const details: Record<string, unknown> = {
    mapped_path: mapped.path,
    mapped_source: mapped.source,
  };

  if (component.source !== "helm_chart") {
    return skipped(
      component,
      mapped,
      "skipped_unsupported_source",
      `source "${component.source}" does not support deterministic manifest mutation`,
      start,
      details,
    );
  }

  const chartName = extractHelmChartName(component.upstream);
  if (!chartName) {
    return skipped(
      component,
      mapped,
      "skipped_unsupported_source",
      `could not derive helm chart name from upstream "${component.upstream}"`,
      start,
      details,
    );
  }
  details.chart_name = chartName;

  const workDir = await Deno.makeTempDir({ prefix: "radar-dryrun-" });
  try {
    await copyDir(mapped.path, workDir);
    details.work_dir = workDir;

    const mutatedVersion = await mutateHelmChartVersion(workDir, chartName, component.latest);
    if (mutatedVersion === null) {
      return skipped(
        component,
        mapped,
        "skipped_no_mapping",
        `no helm chart named "${chartName}" in ${mapped.path}`,
        start,
        details,
      );
    }
    details.mutated = true;

    const build = await runCommand(["kustomize", "build", workDir], deps);
    details.build_exit_code = build.code;
    if (!build.success) {
      return result(
        component,
        mapped,
        "build_failed",
        build.stdout,
        build.stderr,
        Date.now() - start,
        mutatedVersion,
        details,
      );
    }

    if (deps.buildOnly) {
      return result(
        component,
        mapped,
        "success",
        build.stdout,
        "",
        Date.now() - start,
        mutatedVersion,
        { ...details, build_only: true },
      );
    }

    const kubectl = await runCommandWithStdin(
      kubectlArgv(deps.kubeconfig),
      build.stdout,
      deps,
    );
    details.kubectl_exit_code = kubectl.code;
    return result(
      component,
      mapped,
      kubectl.success ? "success" : "dryrun_failed",
      kubectl.stdout,
      kubectl.stderr,
      Date.now() - start,
      mutatedVersion,
      details,
    );
  } finally {
    await Deno.remove(workDir, { recursive: true }).catch(() => {});
  }
}

function extractHelmChartName(upstream: string): string | null {
  const parts = upstream.split("::");
  if (parts.length === 2) {
    const name = parts[1].trim();
    return name || null;
  }
  return null;
}

async function mutateHelmChartVersion(
  dir: string,
  chartName: string,
  latest: string,
): Promise<string | null> {
  const kustomizationPath = join(dir, "kustomization.yaml");
  let text: string;
  try {
    text = await Deno.readTextFile(kustomizationPath);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }

  const doc = parseYaml(text) as Record<string, unknown>;
  const charts = Array.isArray(doc.helmCharts) ? doc.helmCharts : [];
  let mutated = false;
  for (const chart of charts) {
    if (
      isRecord(chart) && typeof chart.name === "string" && chart.name === chartName
    ) {
      chart.version = latest;
      mutated = true;
    }
  }
  if (!mutated) return null;

  await Deno.writeTextFile(kustomizationPath, stringifyYaml(doc, { lineWidth: 0 }));
  return latest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Simple recursive directory copy using only Deno built-ins. */
async function copyDir(src: string, dest: string): Promise<void> {
  await Deno.mkdir(dest, { recursive: true });
  for await (const entry of Deno.readDir(src)) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory) {
      await copyDir(srcPath, destPath);
    } else if (entry.isFile) {
      await Deno.copyFile(srcPath, destPath);
    } else if (entry.isSymlink) {
      const target = await Deno.readLink(srcPath);
      await Deno.symlink(target, destPath);
    }
  }
}

function kubectlArgv(kubeconfig?: string): string[] {
  const argv = ["kubectl", "apply", "--dry-run=server", "-f", "-"];
  if (kubeconfig) {
    argv.push("--kubeconfig", kubeconfig);
  }
  return argv;
}

async function runCommand(argv: string[], deps: RunnerDeps): Promise<CommandResult> {
  if (deps.runCommand) return deps.runCommand(argv);
  const cmd = new Deno.Command(argv[0], {
    args: argv.slice(1),
    stdout: "piped",
    stderr: "piped",
  });
  const out = await cmd.output();
  return {
    success: out.success,
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

async function runCommandWithStdin(
  argv: string[],
  stdin: string,
  deps: RunnerDeps,
): Promise<CommandResult> {
  guardDryRun(argv);
  if (deps.runCommand) return deps.runCommand(argv, stdin);
  const cmd = new Deno.Command(argv[0], {
    args: argv.slice(1),
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const child = cmd.spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(stdin));
  await writer.close();
  const out = await child.output();
  return {
    success: out.success,
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

/**
 * Safety guard: refuse to execute any kubectl command that does not contain
 * `--dry-run=server`. This is the single point that protects against accidental
 * cluster mutations.
 */
export function guardDryRun(argv: string[]): void {
  if (argv[0] !== "kubectl") return;
  if (!argv.includes("--dry-run=server")) {
    throw new Error(
      `refusing to execute kubectl without --dry-run=server: ${argv.join(" ")}`,
    );
  }
}

function skipped(
  component: ComponentRecord,
  mapped: MappedPath,
  status: DryRunStatus,
  reason: string,
  start: number,
  details: Record<string, unknown>,
): DryRun {
  return result(component, mapped, status, "", reason, Date.now() - start, undefined, details);
}

function result(
  component: ComponentRecord,
  mapped: MappedPath,
  status: DryRunStatus,
  stdout: string,
  stderr: string,
  durationMs: number,
  mutatedHelmVersion: string | undefined,
  details: Record<string, unknown>,
): DryRun {
  return {
    name: component.name,
    current: component.current,
    latest: component.latest,
    namespace: component.namespace,
    kustomize_path: mapped.path,
    status,
    stdout: stdout.slice(0, 100_000),
    stderr: stderr.slice(0, 100_000),
    duration_ms: durationMs,
    mutated_helm_version: mutatedHelmVersion,
    details,
  };
}
