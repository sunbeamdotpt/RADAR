import { parse as parseYaml } from "@std/yaml";
import { compareTuples, normalizeVersion, versionTuple } from "../domain/version.ts";
import type { Component } from "../schema/component.ts";
import type { HttpClient } from "./http.ts";
import { formatTemplate, stripChars } from "./util.ts";

interface HelmEntry {
  version?: unknown;
  appVersion?: unknown;
}

function entryVersion(entry: HelmEntry): string {
  return typeof entry.version === "string" ? entry.version : "0";
}

/** Python: entry.get("appVersion", entry.get("version", "n/a")) */
function appVersion(entry: HelmEntry): string {
  if (typeof entry.appVersion === "string") return entry.appVersion;
  if (typeof entry.version === "string") return entry.version;
  return "n/a";
}

interface ChartIndex {
  entries?: Record<string, unknown>;
}

function parseChartEntries(upstream: string, index: ChartIndex | null): HelmEntry[] {
  const sep = upstream.indexOf("::");
  if (sep === -1) return [];
  const chartName = upstream.slice(sep + 2);
  const entries = index?.entries ?? {};
  const chartEntries = entries[chartName];
  return Array.isArray(chartEntries) ? chartEntries as HelmEntry[] : [];
}

function repoIndexUrl(upstream: string): string {
  const sep = upstream.indexOf("::");
  const repoUrl = upstream.slice(0, sep);
  return repoUrl.endsWith("/index.yaml") ? repoUrl : repoUrl.replace(/\/+$/, "") + "/index.yaml";
}

/**
 * Find the chart version that ships a given appVersion. Returns `null` when the
 * target appVersion is not present in the index. When multiple chart versions
 * ship the same appVersion, the greatest chart version is returned.
 */
export async function resolveChartVersion(
  http: HttpClient,
  upstream: string,
  targetAppVersion: string,
): Promise<string | null> {
  const index = parseYaml(await http.text(repoIndexUrl(upstream))) as ChartIndex | null;
  const entries = parseChartEntries(upstream, index);
  if (entries.length === 0) return null;

  const target = normalizeVersion(targetAppVersion);
  let best: HelmEntry | null = null;
  for (const entry of entries) {
    if (normalizeVersion(appVersion(entry)) !== target) continue;
    if (
      !best ||
      compareTuples(versionTuple(entryVersion(entry)), versionTuple(entryVersion(best))) > 0
    ) {
      best = entry;
    }
  }
  return best ? entryVersion(best) : null;
}

/**
 * Latest version from a Helm repository index.yaml.
 * upstream format: "{repo_url}::{chart_name}".
 *
 * With track_app_version, `current` is resolved to the appVersion of the pinned
 * chart version (mutating the component, like the Python script does).
 */
export async function fetchHelmChart(component: Component, _http: HttpClient): Promise<void> {
  const sep = component.upstream.indexOf("::");
  if (sep === -1) {
    throw new Error(`invalid helm upstream (expected "repo::chart"): ${component.upstream}`);
  }
  let repoUrl = component.upstream.slice(0, sep);
  const chartName = component.upstream.slice(sep + 2);
  if (!repoUrl.endsWith("/index.yaml")) {
    repoUrl = repoUrl.replace(/\/+$/, "") + "/index.yaml";
  }

  const index = parseYaml(await _http.text(repoUrl)) as Record<string, unknown> | null;
  const entries = (index?.entries ?? {}) as Record<string, unknown>;
  const chartEntries = entries[chartName];
  if (!Array.isArray(chartEntries) || chartEntries.length === 0) {
    component.latest = "n/a";
    component.latest_link = "";
    return;
  }

  // Python max(entries, key=...): first strictly-greatest entry wins.
  let latestEntry = chartEntries[0] as HelmEntry;
  for (const entry of chartEntries.slice(1) as HelmEntry[]) {
    if (
      compareTuples(versionTuple(entryVersion(entry)), versionTuple(entryVersion(latestEntry))) > 0
    ) {
      latestEntry = entry;
    }
  }
  const latestChartVersion = typeof latestEntry.version === "string" ? latestEntry.version : "n/a";
  const latestAppVersion = appVersion(latestEntry);

  let version: string;
  if (component.track_app_version) {
    const pinned = component.chart_version || component.current;
    // Helm treats chart versions as semver constraints, so a manifest pin of
    // "1.19.4" must resolve against an index entry "v1.19.4": exact match
    // first, normalized-semver match second. The note below is reserved for
    // pins that are genuinely absent upstream.
    const entries = chartEntries as HelmEntry[];
    const currentEntry = entries.find((e) => e.version === pinned) ??
      entries.find((e) =>
        typeof e.version === "string" && normalizeVersion(e.version) === normalizeVersion(pinned)
      );
    if (currentEntry) {
      component.current = appVersion(currentEntry);
    } else {
      component.notes = stripChars(
        `${component.notes}; could not resolve appVersion for chart ${pinned}`,
        "; ",
      );
    }
    version = latestAppVersion;
  } else {
    version = latestChartVersion;
  }

  let link = component.link_template;
  if (link) {
    link = formatTemplate(link, {
      version: latestChartVersion,
      app_version: latestAppVersion,
    });
  }
  component.latest = version;
  component.latest_link = link;
}
