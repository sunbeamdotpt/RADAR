import { parse as parseYaml } from "@std/yaml";
import { isNewer } from "../domain/version.ts";
import { formatGeneratedAtUtc } from "../domain/time.ts";
import { log } from "../log.ts";
import {
  addAutoDetectedComponents,
  refreshPinsFromScan,
  scanBaseManifests,
} from "../scan/manifests.ts";
import {
  type Component,
  type InventoryReport,
  parseReportComponent,
  parseSeedDocument,
  parseSeedIgnore,
  toRecord,
} from "../schema/component.ts";
import { fetchDockerHub } from "../sources/docker_hub.ts";
import { fetchGithubRelease, fetchGithubTags } from "../sources/github.ts";
import { fetchHelmChart } from "../sources/helm_chart.ts";
import type { HttpClient } from "../sources/http.ts";
import { fetchStatic, fetchUnknown } from "../sources/static.ts";
import type { Store } from "../store/store.ts";

export interface InventoryDeps {
  http: HttpClient;
  store: Store;
  seedPath: string;
  domainSuffix: string;
  githubToken?: string;
  /** Path of the cloned git base; pin refresh is skipped when absent. */
  clonedBasePath?: string;
  /** RADAR_AUTO_DETECT: append scanned components that aren't tracked yet. */
  autoDetect?: boolean;
  /** Delay between fetches (rate limiting); 0 in tests. */
  fetchDelayMs?: number;
  /** Clock override for deterministic output. */
  now?: Date;
}

/** Load and validate the seed registry YAML. */
export async function loadSeed(seedPath: string): Promise<Component[]> {
  const text = await Deno.readTextFile(seedPath);
  return parseSeedDocument(parseYaml(text));
}

/** Curated notes per component name; empty when the seed is absent/unreadable. */
async function loadSeedNotes(seedPath: string): Promise<Map<string, string>> {
  try {
    const seed = await loadSeed(seedPath);
    return new Map(seed.map((c) => [c.name, c.notes]));
  } catch {
    log("warn", "seed unreadable; keeping previous-run notes", { seed: seedPath });
    return new Map();
  }
}

/** Auto-detection suppression list from the seed; empty when absent/unreadable. */
async function loadSeedIgnore(seedPath: string): Promise<Set<string>> {
  try {
    const raw = parseYaml(await Deno.readTextFile(seedPath));
    return new Set(parseSeedIgnore(raw));
  } catch {
    log("warn", "seed unreadable; auto-detection running without an ignore list", {
      seed: seedPath,
    });
    return new Set();
  }
}

/** Dispatch to the source fetcher, exactly like the Python fetch_latest. */
async function fetchFromSource(
  component: Component,
  http: HttpClient,
  token?: string,
): Promise<void> {
  switch (component.source) {
    case "github_release":
      return await fetchGithubRelease(component, http, token);
    case "github_tags":
      return await fetchGithubTags(component, http, token);
    case "helm_chart":
      return await fetchHelmChart(component, http);
    case "docker_hub":
      return await fetchDockerHub(component, http);
    case "static":
      return fetchStatic(component);
    default:
      return fetchUnknown(component);
  }
}

/**
 * Run one inventory pass:
 *   ingest (previous run if any, else seed) → pin refresh from the cloned base →
 *   fetch latest per component (falling back to previous values on failure) →
 *   drift computation → report.
 */
export async function runInventory(deps: InventoryDeps): Promise<InventoryReport> {
  const previous = await deps.store.loadPrevious();
  let components: Component[];
  if (previous) {
    log("info", "ingesting previous run", {
      generated_at: previous.generated_at,
      components: previous.components.length,
    });
    components = previous.components.map((record, i) => parseReportComponent(record, i));
    // The store carries state (latest, pins); the seed owns curated fields.
    // Previous-run records may carry run-appended note annotations (fetch
    // failures, appVersion resolution) that must not become this run's
    // baseline — reset notes from the seed where the component is curated.
    const seedNotes = await loadSeedNotes(deps.seedPath);
    for (const component of components) {
      const curated = seedNotes.get(component.name);
      if (curated !== undefined) component.notes = curated;
    }
  } else {
    log("info", "no previous run; ingesting seed", { seed: deps.seedPath });
    components = await loadSeed(deps.seedPath);
  }
  const previousByName = new Map(
    (previous?.components ?? []).map((record) => [record.name, record]),
  );

  if (deps.clonedBasePath) {
    const scanned = await scanBaseManifests(deps.clonedBasePath, deps.domainSuffix);
    const updated = refreshPinsFromScan(components, scanned);
    log("info", "pin refresh complete", { scanned: scanned.length, updated });
    if (deps.autoDetect) {
      const ignore = await loadSeedIgnore(deps.seedPath);
      const { added, skipped, ignored } = addAutoDetectedComponents(components, scanned, ignore);
      if (added > 0) log("info", "auto-detected new components", { added });
      if (ignored > 0) log("info", "auto-detection suppressed by ignore list", { ignored });
      if (skipped.length > 0) log("warn", "auto-detection skipped entries", { skipped });
    }
  }

  const delay = deps.fetchDelayMs ?? 250;
  for (const component of components) {
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    try {
      await fetchFromSource(component, deps.http, deps.githubToken);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const fallback = previousByName.get(component.name);
      if (fallback && fallback.latest) {
        component.latest = fallback.latest;
        component.latest_link = "";
        component.cached = true;
        log("warn", "fetch failed; using previous value", {
          component: component.name,
          error: message,
        });
      } else {
        component.latest = "error";
        component.latest_link = "";
        component.notes = `Fetch failed: ${message}`;
        log("error", "fetch failed; no previous value", {
          component: component.name,
          error: message,
        });
      }
    }
    component.update_available = isNewer(component.latest, component.current);
  }

  const report: InventoryReport = {
    generated_at: formatGeneratedAtUtc(deps.now ?? new Date()),
    components: components.map(toRecord),
  };
  log("info", "inventory complete", {
    components: report.components.length,
    updates_available: report.components.filter((c) => c.update_available).length,
    cached: components.filter((c) => c.cached).length,
  });
  return report;
}
