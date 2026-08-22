import { dirname } from "jsr:@std/path@^1";
import { type InventoryReport, parseReportDocument } from "../schema/component.ts";
import type { RunMeta, Store } from "./store.ts";

/**
 * Development store: a single local JSON file.
 * The file is both the job's output and its next-run input (previous state).
 */
export class JsonStore implements Store {
  constructor(private readonly path: string) {}

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

  healthCheck(): Promise<boolean> {
    // The JSON store is always "reachable"; write errors surface on save.
    return Promise.resolve(true);
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
