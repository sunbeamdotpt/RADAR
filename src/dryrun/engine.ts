import { formatGeneratedAtUtc } from "../domain/time.ts";
import { log } from "../log.ts";
import type { DryRun, DryRunReport } from "../schema/dryrun.ts";
import type { RadarStore } from "../store/factory.ts";
import type { MapperDeps } from "./mapper.ts";
import { mapComponentToKustomization } from "./mapper.ts";
import type { RunnerDeps } from "./runner.ts";
import { runComponentDryRun } from "./runner.ts";

export interface DryRunEngineDeps {
  store: RadarStore;
  mapperDeps: MapperDeps;
  runnerDeps: RunnerDeps;
  now?: Date;
}

/**
 * Run one dry-run pass: read the latest inventory + assessments, filter to
 * drifted likely-safe Helm components, map each to its kustomization base,
 * mutate the chart version to latest, and run kustomize build + kubectl
 * apply --dry-run=server.
 */
export async function runDryRuns(deps: DryRunEngineDeps): Promise<DryRunReport> {
  const inventory = await deps.store.loadPrevious();
  if (!inventory) {
    throw new Error("no inventory run found — run the inventory job first");
  }
  const assessments = await deps.store.loadLatestAssessments();
  if (!assessments) {
    throw new Error("no assessments found — run the assess job first");
  }

  const riskByName = new Map(
    assessments.assessments.map((a) => [a.name, a]),
  );

  const candidates = inventory.components.filter((c) =>
    c.update_available &&
    riskByName.get(c.name)?.risk_level === "likely_safe"
  );

  const dryRuns: DryRun[] = [];
  for (const component of candidates) {
    const mapped = await mapComponentToKustomization(component.name, deps.mapperDeps);
    if (!mapped) {
      dryRuns.push({
        name: component.name,
        current: component.current,
        latest: component.latest,
        namespace: component.namespace,
        kustomize_path: "",
        status: "skipped_no_mapping",
        stdout: "",
        stderr: `no kustomization base found for "${component.name}"`,
        duration_ms: 0,
        details: {},
      });
      continue;
    }

    const dryRun = await runComponentDryRun(component, mapped, deps.runnerDeps);
    dryRuns.push(dryRun);
  }

  const counts: Record<string, number> = {};
  for (const d of dryRuns) counts[d.status] = (counts[d.status] ?? 0) + 1;
  log("info", "dry-run pass complete", {
    candidates: candidates.length,
    ...counts,
  });

  return {
    generated_at: formatGeneratedAtUtc(deps.now ?? new Date()),
    inventory_generated_at: inventory.generated_at,
    assessment_generated_at: assessments.generated_at,
    dry_runs: dryRuns,
  };
}
