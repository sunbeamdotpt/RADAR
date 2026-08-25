import { parse as parseYaml } from "@std/yaml";
import { type ComponentHints, parseSeedDocument } from "../schema/component.ts";
import { log } from "../log.ts";

/**
 * Assessor hints are curated in the seed YAML (the "seed owns curated fields"
 * rule). Loaded per run and keyed by component name.
 */
export async function loadSeedHints(seedPath: string): Promise<Map<string, ComponentHints>> {
  try {
    const seed = parseSeedDocument(parseYaml(await Deno.readTextFile(seedPath)));
    const map = new Map<string, ComponentHints>();
    for (const c of seed) {
      const hints: ComponentHints = {};
      if (c.channel) hints.channel = c.channel;
      if (c.versioning_scheme) hints.versioning_scheme = c.versioning_scheme;
      if (c.breaking_change_policy) hints.breaking_change_policy = c.breaking_change_policy;
      if (c.eol_version_line) hints.eol_version_line = c.eol_version_line;
      if (c.eol_date) hints.eol_date = c.eol_date;
      if (c.eol_replacement) hints.eol_replacement = c.eol_replacement;
      if (c.deprecated) hints.deprecated = c.deprecated;
      if (Object.keys(hints).length > 0) map.set(c.name, hints);
    }
    return map;
  } catch (err) {
    log("warn", "seed hints unavailable; assessing without hints", {
      seed: seedPath,
      error: err instanceof Error ? err.message : String(err),
    });
    return new Map();
  }
}

/**
 * Resolve the effective hints for a component: explicit seed hints win;
 * well-known upstream shapes are auto-detected as a fallback (Ory's
 * year-based versioning, OpenSearch's major-only breaking policy).
 */
export function resolveHints(
  upstream: string,
  hints: ComponentHints | undefined,
): ComponentHints {
  const resolved: ComponentHints = { ...hints };
  if (!resolved.versioning_scheme && (/ory\//i.test(upstream) || /k8s\.ory\.sh/i.test(upstream))) {
    resolved.versioning_scheme = "ory";
  }
  if (!resolved.breaking_change_policy && /opensearch/i.test(upstream)) {
    resolved.breaking_change_policy = "major_only";
  }
  return resolved;
}
