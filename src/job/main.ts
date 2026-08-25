import { parse as parseYaml } from "@std/yaml";
import { ConfigError } from "../config/env.ts";
import { type ClonedRepo, cloneRepo } from "../git/clone.ts";
import { log } from "../log.ts";
import { bootstrapSeedYaml, scanBaseManifests } from "../scan/manifests.ts";
import { parseSeedDocument } from "../schema/component.ts";
import { FetchHttpClient, OfflineHttpClient } from "../sources/http.ts";
import { JsonStore } from "../store/json_store.ts";
import { createStore } from "../store/factory.ts";
import { loadJobConfig } from "./config.ts";
import { runInventory } from "./inventory.ts";

async function main(): Promise<number> {
  let config;
  try {
    config = loadJobConfig(Deno.env.toObject(), Deno.args);
  } catch (err) {
    if (err instanceof ConfigError) {
      log("error", "invalid configuration", { error: err.message });
      return 2;
    }
    throw err;
  }

  log("info", "radar job starting", {
    storage: config.storage,
    domain_suffix: config.domainSuffix,
    git_base_url: config.gitBaseUrl,
    git_base_ref: config.gitBaseRef,
    offline: config.offline,
    bootstrap: config.bootstrap,
    auto_detect: config.autoDetect,
  });

  let cloned: ClonedRepo | null = null;
  try {
    cloned = await cloneRepo({ url: config.gitBaseUrl, ref: config.gitBaseRef });
    log("info", "cloned git base", { path: cloned.path });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (config.gitBaseRequired || config.bootstrap) {
      log("error", "git base clone failed", { error: message });
      return 1;
    }
    log("warn", "git base clone failed; continuing without pin refresh", { error: message });
  }

  try {
    if (config.bootstrap) {
      const scanned = await scanBaseManifests(cloned!.path, config.domainSuffix);
      await Deno.writeTextFile(config.seedPath, bootstrapSeedYaml(scanned));
      // Validate what we wrote: the seed must round-trip the strict schema.
      parseSeedDocument(parseYaml(await Deno.readTextFile(config.seedPath)));
      log("info", "bootstrap complete", { seed: config.seedPath, components: scanned.length });
      return 0;
    }

    const http = config.offline ? new OfflineHttpClient() : new FetchHttpClient();
    const store = await createStore(config);
    try {
      const report = await runInventory({
        http,
        store,
        seedPath: config.seedPath,
        domainSuffix: config.domainSuffix,
        githubToken: config.githubToken,
        clonedBasePath: cloned?.path,
        autoDetect: config.autoDetect,
        fetchDelayMs: config.fetchDelayMs,
      });
      await store.saveReport(report, {
        domainSuffix: config.domainSuffix,
        gitBaseUrl: config.gitBaseUrl,
      });
      log("info", "report saved", { storage: config.storage });

      // Optional local JSON mirror when postgres is the primary store.
      if (config.storage === "postgres" && config.jsonPathExplicit) {
        await new JsonStore(config.jsonPath).saveReport(report, {
          domainSuffix: config.domainSuffix,
          gitBaseUrl: config.gitBaseUrl,
        });
        log("info", "json mirror written", { path: config.jsonPath });
      }
    } finally {
      await store.close();
    }
    return 0;
  } catch (err) {
    log("error", "radar job failed", { error: err instanceof Error ? err.message : String(err) });
    return 1;
  } finally {
    await cloned?.cleanup();
  }
}

if (import.meta.main) {
  Deno.exit(await main());
}
