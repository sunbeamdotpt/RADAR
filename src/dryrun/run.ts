import { parse as parseYaml } from "@std/yaml";
import { cloneRepo } from "../git/clone.ts";
import { log } from "../log.ts";
import type { DryRunReport } from "../schema/dryrun.ts";
import type { RadarStore } from "../store/factory.ts";
import type { DryRunConfig } from "./config.ts";
import { runDryRuns } from "./engine.ts";
import type { MapperDeps } from "./mapper.ts";
import type { RunnerDeps } from "./runner.ts";

export interface DryRunOrchestratorDeps {
  config: DryRunConfig;
  store: RadarStore;
  /** Command runner override; useful in tests. */
  runnerDeps?: RunnerDeps;
  now?: Date;
}

/**
 * Load optional `kustomize_path` hints from the seed YAML. These override the
 * slug heuristic for components whose base directory does not match their name.
 */
export async function loadKustomizeHints(seedPath: string): Promise<Map<string, string>> {
  const hints = new Map<string, string>();
  let text: string;
  try {
    text = await Deno.readTextFile(seedPath);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return hints;
    throw err;
  }
  const doc = parseYaml(text) as Record<string, unknown>;
  const components = Array.isArray(doc.components) ? doc.components : [];
  for (const raw of components) {
    if (!isRecord(raw)) continue;
    const name = typeof raw.name === "string" ? raw.name : "";
    const path = typeof raw.kustomize_path === "string" ? raw.kustomize_path : "";
    if (name && path) hints.set(name, path);
  }
  return hints;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Orchestrate a full dry-run pass: clone base, load hints, run the engine, and
 * return the report. The caller is responsible for saving the report to the store.
 */
export async function runDryRunPass(deps: DryRunOrchestratorDeps): Promise<DryRunReport> {
  const { config } = deps;
  const cloned = await cloneRepo({ url: config.gitBaseUrl, ref: config.gitBaseRef });
  log("info", "cloned git base for dry-run", { path: cloned.path });

  try {
    const hints = await loadKustomizeHints(config.seedPath);
    const mapperDeps: MapperDeps = { basePath: cloned.path, hints };
    const runnerDeps: RunnerDeps = deps.runnerDeps ?? {
      kubeconfig: config.kubeconfig,
      buildOnly: config.buildOnly,
    };

    return await runDryRuns({
      store: deps.store,
      mapperDeps,
      runnerDeps,
      now: deps.now,
    });
  } finally {
    await cloned.cleanup();
  }
}
