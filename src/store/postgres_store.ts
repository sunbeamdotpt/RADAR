import { Client } from "@db/postgres";
import { formatGeneratedAtUtc, parseGeneratedAtUtc } from "../domain/time.ts";
import { type Assessment, type AssessmentReport, parseAssessment } from "../schema/assessment.ts";
import {
  type ComponentRecord,
  type InventoryReport,
  parseReportComponent,
  toRecord,
} from "../schema/component.ts";
import { type DryRun, type DryRunReport, parseDryRun } from "../schema/dryrun.ts";
import type { AssessmentStore, DryRunStore, RunMeta, Store } from "./store.ts";

const MIGRATIONS_URL = new URL("../../db/migrations/", import.meta.url);

/**
 * Production store: Postgres (CNPG in the sbbb cluster, a local container in dev).
 * Each inventory run appends one `runs` row plus its `components` rows; the
 * assess job appends `assessments` rows against the latest run. Readers always
 * see the latest run / latest assessed run.
 */
export class PostgresStore implements Store, AssessmentStore, DryRunStore {
  private readonly client: Client;
  private migrated = false;

  constructor(connection: string) {
    this.client = new Client(connection);
  }

  /** Connect and apply migrations idempotently. */
  async init(): Promise<void> {
    await this.client.connect();
    await this.migrate();
  }

  private async migrate(): Promise<void> {
    if (this.migrated) return;
    const entries: string[] = [];
    for await (const entry of Deno.readDir(MIGRATIONS_URL)) {
      if (entry.isFile && entry.name.endsWith(".sql")) entries.push(entry.name);
    }
    entries.sort();
    for (const name of entries) {
      const sql = await Deno.readTextFile(new URL(name, MIGRATIONS_URL));
      await this.client.queryArray(sql);
    }
    this.migrated = true;
  }

  async loadPrevious(): Promise<InventoryReport | null> {
    const runs = await this.client.queryObject<{ id: string; generated_at: Date }>`
      SELECT id, generated_at FROM runs ORDER BY id DESC LIMIT 1
    `;
    const run = runs.rows[0];
    if (!run) return null;

    const result = await this.client.queryObject<Record<string, unknown>>`
      SELECT name, namespace, current, latest, source, upstream, link_template,
             notes, update_available, chart_version, track_app_version
      FROM components WHERE run_id = ${run.id} ORDER BY position
    `;
    const components: ComponentRecord[] = result.rows.map((row, i) =>
      toRecord(parseReportComponent(row, i))
    );
    return {
      generated_at: formatGeneratedAtUtc(run.generated_at),
      components,
    };
  }

  async saveReport(report: InventoryReport, meta: RunMeta): Promise<void> {
    const generatedAt = parseGeneratedAtUtc(report.generated_at);
    await this.client.queryArray`BEGIN`;
    try {
      const runResult = await this.client.queryObject<{ id: string }>`
        INSERT INTO runs (generated_at, domain_suffix, git_base_url)
        VALUES (${generatedAt}, ${meta.domainSuffix}, ${meta.gitBaseUrl})
        RETURNING id
      `;
      const runId = runResult.rows[0].id;
      for (const [position, c] of report.components.entries()) {
        await this.client.queryArray`
          INSERT INTO components (
            run_id, position, name, namespace, current, latest, source, upstream,
            link_template, notes, update_available, chart_version, track_app_version
          ) VALUES (
            ${runId}, ${position}, ${c.name}, ${c.namespace}, ${c.current}, ${c.latest},
            ${c.source}, ${c.upstream}, ${c.link_template}, ${c.notes},
            ${c.update_available}, ${c.chart_version ?? null}, ${c.track_app_version ?? null}
          )
        `;
      }
      await this.client.queryArray`COMMIT`;
    } catch (err) {
      await this.client.queryArray`ROLLBACK`.catch(() => {});
      throw err;
    }
  }

  async loadLatestAssessments(): Promise<AssessmentReport | null> {
    const assessed = await this.client.queryObject<{ run_id: string; assessed_at: Date }>`
      SELECT a.run_id, MAX(a.assessed_at) AS assessed_at
      FROM assessments a
      GROUP BY a.run_id
      ORDER BY a.run_id DESC
      LIMIT 1
    `;
    const batch = assessed.rows[0];
    if (!batch) return null;

    const run = await this.client.queryObject<{ generated_at: Date }>`
      SELECT generated_at FROM runs WHERE id = ${batch.run_id}
    `;
    const rows = await this.client.queryObject<Record<string, unknown>>`
      SELECT name, current, latest, risk_level, reason, action, layer, details
      FROM assessments WHERE run_id = ${batch.run_id} ORDER BY position
    `;
    const assessments: Assessment[] = rows.rows.map((row, i) => parseAssessment(row, i));
    return {
      generated_at: formatGeneratedAtUtc(batch.assessed_at),
      inventory_generated_at: run.rows[0] ? formatGeneratedAtUtc(run.rows[0].generated_at) : "",
      assessments,
    };
  }

  async saveAssessments(report: AssessmentReport): Promise<void> {
    const assessedAt = parseGeneratedAtUtc(report.generated_at);
    await this.client.queryArray`BEGIN`;
    try {
      const runResult = await this.client.queryObject<{ id: string }>`
        SELECT id FROM runs ORDER BY id DESC LIMIT 1
      `;
      const run = runResult.rows[0];
      if (!run) {
        throw new Error("no inventory run to attach assessments to — run the inventory job first");
      }
      // Re-assessing the same run replaces that run's assessments (idempotent re-runs).
      await this.client.queryArray`DELETE FROM assessments WHERE run_id = ${run.id}`;
      for (const [position, a] of report.assessments.entries()) {
        await this.client.queryArray`
          INSERT INTO assessments (
            run_id, assessed_at, position, name, current, latest,
            risk_level, reason, action, layer, details
          ) VALUES (
            ${run.id}, ${assessedAt}, ${position}, ${a.name}, ${a.current}, ${a.latest},
            ${a.risk_level}, ${a.reason}, ${a.action}, ${a.layer}, ${JSON.stringify(a.details)}
          )
        `;
      }
      await this.client.queryArray`COMMIT`;
    } catch (err) {
      await this.client.queryArray`ROLLBACK`.catch(() => {});
      throw err;
    }
  }

  async loadLatestDryRuns(): Promise<DryRunReport | null> {
    const assessed = await this.client.queryObject<{ run_id: string; dry_run_at: Date }>`
      SELECT d.run_id, MAX(d.dry_run_at) AS dry_run_at
      FROM dry_runs d
      GROUP BY d.run_id
      ORDER BY d.run_id DESC
      LIMIT 1
    `;
    const batch = assessed.rows[0];
    if (!batch) return null;

    const run = await this.client.queryObject<{ generated_at: Date }>`
      SELECT generated_at FROM runs WHERE id = ${batch.run_id}
    `;
    const assessment = await this.client.queryObject<{ assessed_at: Date }>`
      SELECT MAX(assessed_at) AS assessed_at
      FROM assessments WHERE run_id = ${batch.run_id}
    `;
    const rows = await this.client.queryObject<Record<string, unknown>>`
      SELECT namespace, components, status, stdout, stderr, duration_ms, details
      FROM dry_runs WHERE run_id = ${batch.run_id} ORDER BY position
    `;
    const dryRuns: DryRun[] = rows.rows.map((row, i) => parseDryRun(row, i));
    return {
      generated_at: formatGeneratedAtUtc(batch.dry_run_at),
      inventory_generated_at: run.rows[0] ? formatGeneratedAtUtc(run.rows[0].generated_at) : "",
      assessment_generated_at: assessment.rows[0]
        ? formatGeneratedAtUtc(assessment.rows[0].assessed_at)
        : "",
      dry_runs: dryRuns,
    };
  }

  async saveDryRuns(report: DryRunReport): Promise<void> {
    const dryRunAt = parseGeneratedAtUtc(report.generated_at);
    await this.client.queryArray`BEGIN`;
    try {
      const runResult = await this.client.queryObject<{ id: string }>`
        SELECT id FROM runs ORDER BY id DESC LIMIT 1
      `;
      const run = runResult.rows[0];
      if (!run) {
        throw new Error("no inventory run to attach dry-runs to — run the inventory job first");
      }
      // Re-running dry-runs against the same run replaces that run's previews (idempotent).
      await this.client.queryArray`DELETE FROM dry_runs WHERE run_id = ${run.id}`;
      for (const [position, d] of report.dry_runs.entries()) {
        await this.client.queryArray`
          INSERT INTO dry_runs (
            run_id, dry_run_at, position, namespace, components,
            status, stdout, stderr, duration_ms, details
          ) VALUES (
            ${run.id}, ${dryRunAt}, ${position}, ${d.namespace}, ${JSON.stringify(d.components)},
            ${d.status}, ${d.stdout}, ${d.stderr}, ${d.duration_ms}, ${JSON.stringify(d.details)}
          )
        `;
      }
      await this.client.queryArray`COMMIT`;
    } catch (err) {
      await this.client.queryArray`ROLLBACK`.catch(() => {});
      throw err;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.queryArray`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.client.end();
  }
}
