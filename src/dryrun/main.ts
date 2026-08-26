import { ConfigError } from "../config/env.ts";
import { log } from "../log.ts";
import { JsonStore } from "../store/json_store.ts";
import { createStore } from "../store/factory.ts";
import { loadDryRunConfig } from "./config.ts";
import { runDryRunPass } from "./run.ts";

/**
 * RADAR dry-run preview job (pipeline step 3): reads the latest inventory run
 * and its assessments from the store, renders likely-safe drifted components
 * against their latest versions with kustomize, and pipes the manifests to
 * `kubectl apply --dry-run=server`. Results are stored back in the store.
 *
 * One-shot; exit 0/1/2 like the inventory and assess jobs.
 */
async function main(): Promise<number> {
  let config;
  try {
    config = loadDryRunConfig(Deno.env.toObject());
  } catch (err) {
    if (err instanceof ConfigError) {
      log("error", "invalid configuration", { error: err.message });
      return 2;
    }
    throw err;
  }

  log("info", "radar dry-run job starting", {
    storage: config.storage,
    git_base_url: config.gitBaseUrl,
    git_base_ref: config.gitBaseRef,
    kubeconfig: config.kubeconfig ? "set" : "unset",
    build_only: config.buildOnly,
    offline: config.offline,
  });

  try {
    const store = await createStore(config);
    try {
      const report = await runDryRunPass({ config, store });
      await store.saveDryRuns(report);
      log("info", "dry-runs saved", { storage: config.storage });

      // Optional local JSON mirror when postgres is the primary store.
      if (config.storage === "postgres" && Deno.env.get("RADAR_JSON_PATH")) {
        await new JsonStore(config.jsonPath, undefined, config.dryRunJsonPath)
          .saveDryRuns(report);
        log("info", "dry-run mirror written", { path: config.dryRunJsonPath });
      }
    } finally {
      await store.close();
    }
    return 0;
  } catch (err) {
    log("error", "radar dry-run job failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return 1;
  }
}

if (import.meta.main) {
  Deno.exit(await main());
}
