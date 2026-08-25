import { ConfigError } from "../config/env.ts";
import { log } from "../log.ts";
import { FetchHttpClient, OfflineHttpClient } from "../sources/http.ts";
import { JsonStore } from "../store/json_store.ts";
import { createStore } from "../store/factory.ts";
import { loadAssessConfig } from "./config.ts";
import { runAssessment } from "./run.ts";

/**
 * RADAR assess job (pipeline step 2): reads the latest inventory run from the
 * store, assesses breaking-change risk for each component, and writes the
 * assessment report back to the store. One-shot; exit 0/1/2 like the
 * inventory job.
 */
async function main(): Promise<number> {
  let config;
  try {
    config = loadAssessConfig(Deno.env.toObject());
  } catch (err) {
    if (err instanceof ConfigError) {
      log("error", "invalid configuration", { error: err.message });
      return 2;
    }
    throw err;
  }

  log("info", "radar assess job starting", {
    storage: config.storage,
    offline: config.offline,
    updates_only: config.updatesOnly,
  });

  try {
    const http = config.offline ? new OfflineHttpClient() : new FetchHttpClient();
    const store = await createStore(config);
    try {
      const report = await runAssessment({
        store,
        http,
        seedPath: config.seedPath,
        githubToken: config.githubToken,
        offline: config.offline,
        updatesOnly: config.updatesOnly,
        fetchDelayMs: config.fetchDelayMs,
      });
      await store.saveAssessments(report);
      log("info", "assessments saved", { storage: config.storage });

      // Optional local JSON mirror when postgres is the primary store.
      if (config.storage === "postgres" && Deno.env.get("RADAR_JSON_PATH")) {
        await new JsonStore(config.jsonPath, config.assessJsonPath).saveAssessments(report);
        log("info", "assessment mirror written", { path: config.assessJsonPath });
      }
    } finally {
      await store.close();
    }
    return 0;
  } catch (err) {
    log("error", "radar assess job failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return 1;
  }
}

if (import.meta.main) {
  Deno.exit(await main());
}
