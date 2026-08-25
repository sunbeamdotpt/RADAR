import { formatGeneratedAtUtc } from "../domain/time.ts";
import { log } from "../log.ts";
import { type Assessment, type AssessmentReport, SEVERITY_ORDER } from "../schema/assessment.ts";
import type { HttpClient } from "../sources/http.ts";
import type { RadarStore } from "../store/factory.ts";
import { assessComponent } from "./engine.ts";
import { loadSeedHints, resolveHints } from "./hints.ts";

export interface AssessDeps {
  store: RadarStore;
  http: HttpClient;
  seedPath: string;
  githubToken?: string;
  offline?: boolean;
  /** Assess only components with update_available=true. Default: assess all. */
  updatesOnly?: boolean;
  /** Delay between release-note fetches; 0 in tests. */
  fetchDelayMs?: number;
  /** Clock override for deterministic output. */
  now?: Date;
}

/**
 * Run one assessment pass: read the latest inventory run from the store,
 * assess every component through the layered engine, and persist a
 * severity-sorted assessment report attached to that run.
 */
export async function runAssessment(deps: AssessDeps): Promise<AssessmentReport> {
  const inventory = await deps.store.loadPrevious();
  if (!inventory) {
    throw new Error("no inventory run found — run the inventory job first");
  }
  const seedHints = await loadSeedHints(deps.seedPath);

  const updatesOnly = deps.updatesOnly ?? false;
  const delay = deps.fetchDelayMs ?? 250;
  const targets = inventory.components.filter((c) => !updatesOnly || c.update_available);

  const assessments: Assessment[] = [];
  for (const component of targets) {
    if (delay > 0 && !deps.offline) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    const hints = resolveHints(component.upstream, seedHints.get(component.name));
    assessments.push(
      await assessComponent(component, hints, deps.http, deps.githubToken, {
        offline: deps.offline,
        now: deps.now,
      }),
    );
  }

  assessments.sort((a, b) => SEVERITY_ORDER[a.risk_level] - SEVERITY_ORDER[b.risk_level]);

  const report: AssessmentReport = {
    generated_at: formatGeneratedAtUtc(deps.now ?? new Date()),
    inventory_generated_at: inventory.generated_at,
    assessments,
  };
  const counts: Record<string, number> = {};
  for (const a of assessments) counts[a.risk_level] = (counts[a.risk_level] ?? 0) + 1;
  log("info", "assessment complete", {
    assessed: assessments.length,
    inventory_generated_at: inventory.generated_at,
    ...counts,
  });
  return report;
}
