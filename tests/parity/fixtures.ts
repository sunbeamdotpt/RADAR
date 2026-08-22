import { parse as parseYaml } from "@std/yaml";
import { parseSeedDocument, toRecord } from "../../src/schema/component.ts";
import type { ComponentRecord } from "../../src/schema/component.ts";

/**
 * Build deterministic parity fixtures from the seed registry.
 *
 * For every component we invent a "previously fetched" latest version:
 *   - non-static sources: "v99.0.0" (concrete → drift depends only on `current`)
 *   - static/custom:      "unknown" (the Python static fetcher never consults
 *     its cache, so both implementations report "unknown" for static sources)
 *
 * The same values seed the Python script's cache and RADAR's JSON store, so an
 * offline run of each must produce byte-identical component records.
 */
export interface ParityFixtures {
  /** Python cache file content (~/.cache/sbbb/component-version-cache.json). */
  pythonCache: Record<string, { latest: string; latest_link: string; fetched_at: number }>;
  /** RADAR previous-report records (JsonStore input). */
  previousRecords: ComponentRecord[];
}

export async function buildFixtures(seedPath: string): Promise<ParityFixtures> {
  const seed = parseSeedDocument(parseYaml(await Deno.readTextFile(seedPath)));
  const pythonCache: ParityFixtures["pythonCache"] = {};
  const previousRecords: ComponentRecord[] = [];
  for (const component of seed) {
    const concrete = component.source !== "static" && component.source !== "custom";
    component.latest = concrete ? "v99.0.0" : "unknown";
    pythonCache[component.name] = {
      latest: component.latest,
      latest_link: "",
      fetched_at: Date.now() / 1000,
    };
    previousRecords.push(toRecord(component));
  }
  return { pythonCache, previousRecords };
}
