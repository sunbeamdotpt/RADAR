import type { AssessmentReport } from "../schema/assessment.ts";
import type { InventoryReport } from "../schema/component.ts";

/** Metadata recorded alongside each run. */
export interface RunMeta {
  domainSuffix: string;
  gitBaseUrl: string;
}

/**
 * Persistence backend for inventory reports.
 *
 * The store doubles as the "cache" the Python script kept in
 * ~/.cache/sbbb: loadPrevious() feeds both the fallback path (fetch failures
 * reuse the last known latest) and first-run detection (no previous run →
 * ingest the seed YAML instead).
 */
export interface Store {
  /** The most recent report, or null when the store is empty (first run). */
  loadPrevious(): Promise<InventoryReport | null>;
  /** Persist a completed report. */
  saveReport(report: InventoryReport, meta: RunMeta): Promise<void>;
  /** Liveness/readiness probe for the store backend. */
  healthCheck(): Promise<boolean>;
  /** Release any held resources. */
  close(): Promise<void>;
}

/**
 * Persistence for step-2 assessments. Assessments attach to the inventory run
 * they were computed from (run_id), so history pairs across both pipeline
 * steps. Readers get the assessments of the latest run that has any.
 */
export interface AssessmentStore {
  /** Assessments for the latest assessed inventory run, or null if none yet. */
  loadLatestAssessments(): Promise<AssessmentReport | null>;
  /** Persist an assessment report against the current latest inventory run. */
  saveAssessments(report: AssessmentReport): Promise<void>;
}
