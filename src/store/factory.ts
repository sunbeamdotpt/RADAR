import { JsonStore } from "./json_store.ts";
import { PostgresStore } from "./postgres_store.ts";
import type { AssessmentStore, DryRunStore, Store } from "./store.ts";

export type RadarStore = Store & AssessmentStore & DryRunStore;

/** Open and initialize the configured store backend. */
export async function createStore(config: {
  storage: "json" | "postgres";
  jsonPath: string;
  databaseUrl?: string;
  assessJsonPath?: string;
  dryRunJsonPath?: string;
}): Promise<RadarStore> {
  if (config.storage === "postgres") {
    const store = new PostgresStore(config.databaseUrl!);
    await store.init();
    return store;
  }
  return new JsonStore(config.jsonPath, config.assessJsonPath, config.dryRunJsonPath);
}
