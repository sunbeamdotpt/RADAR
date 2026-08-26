import { formatGeneratedAtUtc } from "../domain/time.ts";
import { log } from "../log.ts";
import type { ComponentRecord } from "../schema/component.ts";
import type { DryRun, DryRunReport } from "../schema/dryrun.ts";
import type { RadarStore } from "../store/factory.ts";
import type { MapperDeps } from "./mapper.ts";
import { mapNamespaceToBase } from "./mapper.ts";
import type { RunnerDeps } from "./runner.ts";
import { runNamespaceDryRun } from "./runner.ts";

export interface DryRunEngineDeps {
  store: RadarStore;
  mapperDeps: MapperDeps;
  runnerDeps: RunnerDeps;
  now?: Date;
}

/**
 * Run one dry-run pass: read the latest inventory + assessments, filter to
 * drifted likely-safe Helm components, group them by namespace, and run a
 * namespace-level Sunbeam render + kubectl server-side dry-run for each group.
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
    c.source === "helm_chart" &&
    riskByName.get(c.name)?.risk_level === "likely_safe"
  );

  const byNamespace = groupByNamespace(candidates);
  const dryRuns: DryRun[] = [];

  for (const [namespace, components] of byNamespace.entries()) {
    const mapped = await mapNamespaceToBase(namespace, deps.mapperDeps);
    if (!mapped) {
      dryRuns.push({
        namespace,
        components: components.map((c) => c.name),
        status: "skipped_no_mapping",
        stdout: "",
        stderr: `no kustomization base found for namespace "${namespace}"`,
        duration_ms: 0,
        details: {},
      });
      continue;
    }

    const dryRun = await runNamespaceDryRun(
      { namespace, namespaceBase: mapped.path, components },
      deps.runnerDeps,
    );
    dryRuns.push(dryRun);
  }

  const counts: Record<string, number> = {};
  for (const d of dryRuns) counts[d.status] = (counts[d.status] ?? 0) + 1;
  log("info", "dry-run pass complete", {
    namespaces: byNamespace.size,
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

function groupByNamespace(components: ComponentRecord[]): Map<string, ComponentRecord[]> {
  const map = new Map<string, ComponentRecord[]>();
  for (const c of components) {
    const list = map.get(c.namespace) ?? [];
    list.push(c);
    map.set(c.namespace, list);
  }
  return map;
}
