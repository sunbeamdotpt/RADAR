import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";
import { basename, join } from "jsr:@std/path@^1";
import type { ComponentRecord } from "../schema/component.ts";
import type { DryRun, DryRunStatus } from "../schema/dryrun.ts";
import { resolveChartVersion } from "../sources/helm_chart.ts";
import type { HttpClient } from "../sources/http.ts";

export interface RunnerDeps {
  kubeconfig?: string;
  domain?: string;
  acmeEmail?: string;
  /** Skip kubectl and only run sunbeam render. */
  buildOnly: boolean;
  /** Optional HTTP client; required to map appVersions back to chart versions. */
  http?: HttpClient;
  /**
   * Command executor override. Defaults to Deno.Command.
   * Every kubectl argv passed here is guaranteed to contain `--dry-run=server`.
   */
  runCommand?: (argv: string[], stdin?: string) => Promise<CommandResult> | CommandResult;
}

export interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

export interface NamespaceDryRunInput {
  namespace: string;
  /** Absolute path to the namespace base directory (contains kustomization.yaml). */
  namespaceBase: string;
  components: ComponentRecord[];
}

/**
 * Run a namespace-level dry-run: create a minimal overlay pointing at the
 * namespace base, bump Helm chart versions to their latest values, render with
 * `sunbeam service apply <namespace> --dry-run`, then validate with
 * `kubectl apply --server-side --force-conflicts --dry-run=server`.
 */
export async function runNamespaceDryRun(
  input: NamespaceDryRunInput,
  deps: RunnerDeps,
): Promise<DryRun> {
  const start = Date.now();
  const { namespace, namespaceBase, components } = input;
  const details: Record<string, unknown> = {
    namespace_base: namespaceBase,
    namespace,
    component_count: components.length,
  };

  if (components.length === 0) {
    return skipped(
      namespace,
      [],
      "skipped_no_mapping",
      "no components selected for namespace dry-run",
      start,
      details,
    );
  }

  const unsupported = components.filter((c) => c.source !== "helm_chart");
  if (unsupported.length > 0) {
    return skipped(
      namespace,
      components.map((c) => c.name),
      "skipped_unsupported_source",
      `components ${unsupported.map((c) => c.name).join(", ")} are not helm_chart sources`,
      start,
      details,
    );
  }

  if (!await hasKustomization(namespaceBase)) {
    return skipped(
      namespace,
      components.map((c) => c.name),
      "skipped_no_mapping",
      `no kustomization base found at ${namespaceBase}`,
      start,
      details,
    );
  }

  const workDir = await Deno.makeTempDir({ prefix: "radar-dryrun-" });
  try {
    details.work_dir = workDir;

    const copiedNamespace = basename(namespaceBase);
    await copyKustomizationBase(namespaceBase, workDir);

    // Build a minimal infra dir with a single-namespace overlay. This avoids
    // pulling in unrelated bases (e.g. stalwart's encrypted configs) that
    // Sunbeam's unified overlay would otherwise include. The resource path
    // uses the copied base directory name, which can differ from the
    // Kubernetes namespace when seed hints remap it.
    await prepareNamespaceOverlay(workDir, namespace, copiedNamespace);

    const mutated = await mutateHelmChartVersions(
      join(workDir, "base", copiedNamespace),
      components,
      deps,
      details,
    );
    details.mutated_versions = mutated;
    if (Object.keys(mutated).length === 0) {
      return skipped(
        namespace,
        components.map((c) => c.name),
        "skipped_no_mapping",
        "no matching helm charts found in namespace base",
        start,
        details,
      );
    }

    const sunbeamContextDir = join(workDir, ".sunbeam");
    await writeSunbeamContext(sunbeamContextDir, workDir, deps);

    // Sunbeam downloads its own helm/kustomize binaries into ~/.sunbeam/bin on
    // first use. In container/CI environments the download can hang or pull an
    // incompatible helm build, so seed the system binaries that the image already
    // ships. Sunbeam uses them if present and only falls back to downloading.
    details.sunbeam_bins_seeded = await seedSunbeamBinaries(sunbeamContextDir);

    const render = await runSunbeamRender(namespace, workDir, deps);
    details.sunbeam_exit_code = render.code;
    if (!render.success) {
      return result(
        namespace,
        components.map((c) => c.name),
        "build_failed",
        render.stdout,
        render.stderr,
        Date.now() - start,
        details,
      );
    }

    if (deps.buildOnly) {
      return result(
        namespace,
        components.map((c) => c.name),
        "success",
        render.stdout,
        "",
        Date.now() - start,
        { ...details, build_only: true },
      );
    }

    const renderedPath = join(workDir, "rendered.yaml");
    await Deno.writeTextFile(renderedPath, render.stdout);

    const kubectl = await runKubectlDryRun(renderedPath, deps);
    details.kubectl_exit_code = kubectl.code;
    return result(
      namespace,
      components.map((c) => c.name),
      kubectl.success ? "success" : "dryrun_failed",
      kubectl.stdout,
      kubectl.stderr,
      Date.now() - start,
      details,
    );
  } finally {
    await Deno.remove(workDir, { recursive: true }).catch(() => {});
  }
}

async function prepareNamespaceOverlay(
  workDir: string,
  namespace: string,
  baseName: string,
): Promise<void> {
  const overlayDir = join(workDir, "overlays");
  await Deno.mkdir(overlayDir, { recursive: true });
  await Deno.writeTextFile(
    join(overlayDir, "kustomization.yaml"),
    stringifyYaml({
      apiVersion: "kustomize.config.k8s.io/v1beta1",
      kind: "Kustomization",
      namespace,
      resources: [`../base/${baseName}`],
    }, { lineWidth: 0 }),
  );
}

async function copyKustomizationBase(
  namespaceBase: string,
  workDir: string,
): Promise<void> {
  const namespace = basename(namespaceBase);
  const dest = join(workDir, "base", namespace);
  await copyDir(namespaceBase, dest);
}

async function mutateHelmChartVersions(
  namespaceBase: string,
  components: ComponentRecord[],
  deps: RunnerDeps,
  details: Record<string, unknown>,
): Promise<Record<string, string>> {
  const kustomizationPath = join(namespaceBase, "kustomization.yaml");
  let text: string;
  try {
    text = await Deno.readTextFile(kustomizationPath);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return {};
    throw err;
  }

  const doc = parseYaml(text) as Record<string, unknown>;
  const charts = Array.isArray(doc.helmCharts) ? doc.helmCharts : [];
  const mutated: Record<string, string> = {};
  const unresolved: Record<string, string> = {};
  const byUpstream = new Map<string, ComponentRecord>();
  for (const c of components) {
    const chartName = extractHelmChartName(c.upstream);
    if (chartName) byUpstream.set(chartName, c);
  }

  for (const chart of charts) {
    if (!isRecord(chart) || typeof chart.name !== "string") continue;
    const component = byUpstream.get(chart.name);
    if (!component) continue;
    const newVersion = await resolveTargetVersion(component, deps.http, unresolved);
    if (newVersion) {
      chart.version = newVersion;
      mutated[component.name] = newVersion;
    }
  }

  if (Object.keys(unresolved).length > 0) {
    details.unresolved_components = unresolved;
  }
  if (Object.keys(mutated).length > 0) {
    await Deno.writeTextFile(kustomizationPath, stringifyYaml(doc, { lineWidth: 0 }));
  }
  return mutated;
}

async function resolveTargetVersion(
  component: ComponentRecord,
  http: HttpClient | undefined,
  unresolved: Record<string, string>,
): Promise<string | null> {
  if (!component.latest || component.latest === "n/a" || component.latest === "unknown") {
    unresolved[component.name] = "missing latest version";
    return null;
  }
  if (!component.track_app_version) {
    return component.latest;
  }
  if (!http) {
    unresolved[component.name] = "track_app_version requires an HTTP client (offline?)";
    return null;
  }
  const chartVersion = await resolveChartVersion(http, component.upstream, component.latest);
  if (!chartVersion) {
    unresolved[component.name] = `could not map appVersion ${component.latest} to a chart version`;
    return null;
  }
  return chartVersion;
}

function extractHelmChartName(upstream: string): string | null {
  const parts = upstream.split("::");
  if (parts.length === 2) {
    const name = parts[1].trim();
    return name || null;
  }
  return null;
}

async function writeSunbeamContext(
  contextDir: string,
  infraDir: string,
  deps: RunnerDeps,
): Promise<void> {
  await Deno.mkdir(contextDir, { recursive: true });
  const context = {
    "current-context": "radar-dryrun",
    "contexts": {
      "radar-dryrun": {
        "infra-dir": infraDir,
        "domain": deps.domain ?? "sunbeam.pt",
        "acme-email": deps.acmeEmail ?? "radar@example.com",
        "kube-context": "",
      },
    },
  };
  await Deno.writeTextFile(join(contextDir, "config.json"), JSON.stringify(context, null, 2));
}

/**
 * Copy system helm/kustomize binaries into the Sunbeam context so it does not
 * have to download them. Returns a map of binary name -> source path, or null
 * for each binary that could not be found. Missing binaries are non-fatal;
 * Sunbeam will fall back to its own download behavior.
 */
async function seedSunbeamBinaries(
  contextDir: string,
): Promise<Record<string, string | null>> {
  const destDir = join(contextDir, "bin");
  const result: Record<string, string | null> = { helm: null, kustomize: null };
  const candidates: Record<string, string[]> = {
    helm: ["/usr/local/bin/helm", "/usr/bin/helm", "/bin/helm"],
    kustomize: ["/usr/local/bin/kustomize", "/usr/bin/kustomize", "/bin/kustomize"],
  };

  for (const [name, paths] of Object.entries(candidates)) {
    for (const src of paths) {
      try {
        const info = await Deno.stat(src);
        if (!info.isFile) continue;
        await Deno.mkdir(destDir, { recursive: true });
        const dest = join(destDir, name);
        await Deno.copyFile(src, dest);
        await Deno.chmod(dest, 0o755);
        result[name] = src;
        break;
      } catch {
        // Try next candidate; missing binaries are OK.
      }
    }
  }
  return result;
}

async function runSunbeamRender(
  namespace: string,
  homeDir: string,
  deps: RunnerDeps,
): Promise<CommandResult> {
  const argv = ["sunbeam", "service", "apply", namespace, "--dry-run", "--quiet"];
  const env: Record<string, string> = { HOME: homeDir };
  if (deps.kubeconfig) env.KUBECONFIG = deps.kubeconfig;
  return await runCommand(argv, deps, env);
}

async function runKubectlDryRun(renderedPath: string, deps: RunnerDeps): Promise<CommandResult> {
  const argv = [
    "kubectl",
    "apply",
    "--server-side",
    "--force-conflicts",
    "--dry-run=server",
    "--request-timeout=5m",
    "-f",
    renderedPath,
  ];
  if (deps.kubeconfig) argv.push("--kubeconfig", deps.kubeconfig);
  guardDryRun(argv);
  return await runCommand(argv, deps);
}

async function runCommand(
  argv: string[],
  deps: RunnerDeps,
  env?: Record<string, string>,
): Promise<CommandResult> {
  if (deps.runCommand) return deps.runCommand(argv);
  const cmdEnv = env ? { ...Deno.env.toObject(), ...env } : undefined;
  const cmd = new Deno.Command(argv[0], {
    args: argv.slice(1),
    stdout: "piped",
    stderr: "piped",
    env: cmdEnv,
  });
  const out = await cmd.output();
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function hasKustomization(dir: string): Promise<boolean> {
  for (const name of ["kustomization.yaml", "kustomization.yml"]) {
    try {
      const info = await Deno.stat(join(dir, name));
      if (info.isFile) return true;
    } catch {
      // ignore
    }
  }
  return false;
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

function skipped(
  namespace: string,
  components: string[],
  status: DryRunStatus,
  reason: string,
  start: number,
  details: Record<string, unknown>,
): DryRun {
  return result(namespace, components, status, "", reason, Date.now() - start, details);
}

function result(
  namespace: string,
  components: string[],
  status: DryRunStatus,
  stdout: string,
  stderr: string,
  durationMs: number,
  details: Record<string, unknown>,
): DryRun {
  return {
    namespace,
    components,
    status,
    stdout: stdout.slice(0, 100_000),
    stderr: stderr.slice(0, 100_000),
    duration_ms: durationMs,
    details,
  };
}
