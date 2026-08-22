import { Client } from "@db/postgres";
import { formatGeneratedAtUtc, parseGeneratedAtUtc } from "../domain/time.ts";
import {
  type ComponentRecord,
  type InventoryReport,
  parseReportComponent,
  toRecord,
} from "../schema/component.ts";
import type { RunMeta, Store } from "./store.ts";

const MIGRATION_URL = new URL("../../db/migrations/001_init.sql", import.meta.url);

/**
 * Production store: Postgres (CNPG in the sbbb cluster, a local container in dev).
 * Each job run appends one `runs` row plus its `components` rows; readers always
 * see the latest run. The latest run is also the next run's "previous" state.
 */
export class PostgresStore implements Store {
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
    const sql = await Deno.readTextFile(MIGRATION_URL);
    await this.client.queryArray(sql);
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
