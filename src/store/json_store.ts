import { dirname } from "jsr:@std/path@^1";
import { type AssessmentReport, parseAssessmentReport } from "../schema/assessment.ts";
import { type InventoryReport, parseReportDocument } from "../schema/component.ts";
import { type DryRunReport, parseDryRunReport } from "../schema/dryrun.ts";
import type { AssessmentStore, DryRunStore, RunMeta, Store } from "./store.ts";

/**
 * Development store: local JSON files.
 * The inventory file is both the job's output and its next-run input
 * (previous state); assessments and dry-runs live in sibling files.
 */
export class JsonStore implements Store, AssessmentStore, DryRunStore {
  private readonly assessmentsPath: string;
  private readonly dryRunsPath: string;

  constructor(
    private readonly path: string,
    assessmentsPath?: string,
    dryRunsPath?: string,
  ) {
    this.assessmentsPath = assessmentsPath ?? path.replace(/\.json$/, "") + ".assessments.json";
    this.dryRunsPath = dryRunsPath ?? path.replace(/\.json$/, "") + ".dryruns.json";
  }

  async loadPrevious(): Promise<InventoryReport | null> {
    let text: string;
    try {
      text = await Deno.readTextFile(this.path);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return null;
      throw err;
    }
    return parseReportDocument(JSON.parse(text));
  }

  async saveReport(report: InventoryReport, _meta: RunMeta): Promise<void> {
    await Deno.mkdir(dirname(this.path), { recursive: true });
    await Deno.writeTextFile(this.path, JSON.stringify(report, null, 2));
  }

  async loadLatestAssessments(): Promise<AssessmentReport | null> {
    let text: string;
    try {
      text = await Deno.readTextFile(this.assessmentsPath);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return null;
      throw err;
    }
    return parseAssessmentReport(JSON.parse(text));
  }

  async saveAssessments(report: AssessmentReport): Promise<void> {
    await Deno.mkdir(dirname(this.assessmentsPath), { recursive: true });
    await Deno.writeTextFile(this.assessmentsPath, JSON.stringify(report, null, 2));
  }

  async loadLatestDryRuns(): Promise<DryRunReport | null> {
    let text: string;
    try {
      text = await Deno.readTextFile(this.dryRunsPath);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return null;
      throw err;
    }
    return parseDryRunReport(JSON.parse(text));
  }

  async saveDryRuns(report: DryRunReport): Promise<void> {
    await Deno.mkdir(dirname(this.dryRunsPath), { recursive: true });
    await Deno.writeTextFile(this.dryRunsPath, JSON.stringify(report, null, 2));
  }

  healthCheck(): Promise<boolean> {
    // The JSON store is always "reachable"; write errors surface on save.
    return Promise.resolve(true);
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
