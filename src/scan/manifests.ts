import {
  parse as parseYaml,
  parseAll as parseYamlAll,
  stringify as stringifyYaml,
} from "@std/yaml";
import { join } from "jsr:@std/path@^1";
import { normalizeDomainSuffix } from "../domain/domain_suffix.ts";
import type { Component, ComponentSource } from "../schema/component.ts";

/**
 * Port of the Python bootstrap scanner: walks base/<namespace>/kustomization.yaml in a
 * checked-out sbbb-style repo and derives registry entries from helmCharts,
 * images:, workload manifests, and GitHub release URLs.
 *
 * Used for `--bootstrap` (regenerate the seed) and for pin refresh (updating
 * `current` pins from the cloned base).
 */

export interface ScannedComponent {
  name: string;
  namespace: string;
  current: string;
  source: ComponentSource;
  upstream: string;
  link_template: string;
  notes: string;
  chart_version?: string;
  track_app_version?: boolean;
}

const KNOWN_EXTERNAL_PREFIXES = [
  "ghcr.io/",
  "oci.",
  "src.",
  "registry.",
  "gcr.io/",
  "quay.io/",
  "k8s.gcr.io/",
  "registry.k8s.io/",
];

/** Port of _image_upstream_and_source: classify a container image reference. */
export function imageUpstreamAndSource(
  image: string,
  domainSuffix: string,
): { upstream: string; source: "docker_hub" | "static" } {
  let repo = image.split(":")[0].split("@")[0];
  repo = normalizeDomainSuffix(repo, domainSuffix);
  const lower = repo.toLowerCase();
  const isExternal = KNOWN_EXTERNAL_PREFIXES.some((p) => lower.startsWith(p));
  if (lower.startsWith("docker.io/") || !lower.includes("/") || !isExternal) {
    const upstream = repo.startsWith("docker.io/") ? repo.slice("docker.io/".length) : repo;
    return { upstream, source: "docker_hub" };
  }
  return { upstream: repo, source: "static" };
}

/** Port of _generic_link_template. */
export function genericLinkTemplate(source: ComponentSource, upstream: string): string {
  if (source === "docker_hub") return `https://hub.docker.com/r/${upstream}/tags`;
  if (source === "static" && upstream.startsWith("ghcr.io/")) return `https://${upstream}`;
  return "";
}

const WORKLOAD_KINDS = new Set([
  "Deployment",
  "StatefulSet",
  "DaemonSet",
  "ReplicaSet",
  "Job",
  "CronJob",
]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Port of _scan_manifest_images: container images in a single YAML manifest. */
export function scanManifestImages(
  content: string,
  fileName: string,
  namespace: string,
  seen: Set<string>,
  domainSuffix: string,
): ScannedComponent[] {
  const components: ScannedComponent[] = [];
  let docs: unknown[];
  try {
    docs = [...parseYamlAll(content)];
  } catch {
    return components;
  }
  for (const doc of docs) {
    if (!isRecord(doc)) continue;
    const kind = typeof doc.kind === "string" ? doc.kind : "";
    if (!WORKLOAD_KINDS.has(kind)) continue;
    const spec = isRecord(doc.spec) ? doc.spec : {};
    const template = isRecord(spec.template) ? spec.template : {};
    const podSpec = isRecord(template.spec) ? template.spec : {};
    const containers = [
      ...(Array.isArray(podSpec.containers) ? podSpec.containers : []),
      ...(Array.isArray(podSpec.initContainers) ? podSpec.initContainers : []),
    ];
    for (const container of containers) {
      if (!isRecord(container)) continue;
      const image = typeof container.image === "string" ? container.image : "";
      if (!image) continue;
      const { upstream, source } = imageUpstreamAndSource(image, domainSuffix);
      const tag = image.includes(":") ? image.split(":")[1].split("@")[0] : "latest";
      const name = upstream.split("/").pop() ?? upstream;
      const key = `${namespace} ${upstream}`;
      if (seen.has(key)) continue;
      seen.add(key);
      components.push({
        name,
        namespace,
        current: tag,
        source,
        upstream,
        link_template: genericLinkTemplate(source, upstream),
        notes: `Auto-detected from base/${namespace}/${fileName}`,
      });
    }
  }
  return components;
}

const GITHUB_RELEASE_RE =
  /^https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\/download\/([^/]+)\/(.+)$/;

/** Port of _github_release_from_url. */
export function githubReleaseFromUrl(
  url: string,
): { ownerRepo: string; tag: string; asset: string } | null {
  const m = url.match(GITHUB_RELEASE_RE);
  if (!m) return null;
  return { ownerRepo: m[1], tag: m[2], asset: m[3] };
}

async function pathIsFile(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isFile;
  } catch {
    return false;
  }
}

/**
 * Port of bootstrap_config's scanning phase: walk base/<namespace>/kustomization.yaml
 * under `root` and return the derived registry entries, sorted by (namespace, name).
 */
export async function scanBaseManifests(
  root: string,
  domainSuffix: string,
): Promise<ScannedComponent[]> {
  const components: ScannedComponent[] = [];
  const seen = new Set<string>();

  const baseDir = join(root, "base");
  const namespaces: string[] = [];
  try {
    for await (const entry of Deno.readDir(baseDir)) {
      if (!entry.isDirectory) continue;
      if (await pathIsFile(join(baseDir, entry.name, "kustomization.yaml"))) {
        namespaces.push(entry.name);
      }
    }
  } catch {
    return components; // no base/ directory
  }
  namespaces.sort();

  for (const dirName of namespaces) {
    const kustomizationPath = join(baseDir, dirName, "kustomization.yaml");
    let data: Record<string, unknown>;
    try {
      const parsed = parseYaml(await Deno.readTextFile(kustomizationPath));
      data = isRecord(parsed) ? parsed : {};
    } catch {
      continue;
    }
    const namespace = typeof data.namespace === "string" ? data.namespace : dirName;

    const helmCharts = Array.isArray(data.helmCharts) ? data.helmCharts : [];
    for (const chart of helmCharts) {
      if (!isRecord(chart)) continue;
      const chartName = typeof chart.name === "string" ? chart.name : "";
      const repo = (typeof chart.repo === "string" ? chart.repo : "").replace(/\/+$/, "");
      const rawVersion = chart.version;
      const version = rawVersion === undefined || rawVersion === null ? "" : String(rawVersion);
      if (!chartName || !repo || !version) continue;
      const upstream = `${repo}::${chartName}`;
      const key = `${namespace} ${upstream}`;
      if (seen.has(key)) continue;
      seen.add(key);
      components.push({
        name: chartName,
        namespace,
        current: version,
        source: "helm_chart",
        upstream,
        link_template: "",
        notes: `Helm chart ${version}`,
        chart_version: version,
        track_app_version: true,
      });
    }

    const images = Array.isArray(data.images) ? data.images : [];
    for (const image of images) {
      if (!isRecord(image)) continue;
      const newName = typeof image.newName === "string" ? image.newName : "";
      const raw = newName || (typeof image.name === "string" ? image.name : "");
      const tag = typeof image.newTag === "string" ? image.newTag : "";
      if (!raw) continue;
      const { upstream, source } = imageUpstreamAndSource(raw, domainSuffix);
      const name = upstream.split("/").pop() ?? upstream;
      const key = `${namespace} ${upstream}`;
      if (seen.has(key)) continue;
      seen.add(key);
      components.push({
        name,
        namespace,
        current: tag || "latest",
        source,
        upstream,
        link_template: genericLinkTemplate(source, upstream),
        notes: `Auto-detected from base/${namespace}/kustomization.yaml images section`,
      });
    }

    const resources = Array.isArray(data.resources) ? data.resources : [];
    for (const resource of resources) {
      if (typeof resource !== "string") continue;
      if (resource.startsWith("https://github.com/")) {
        const release = githubReleaseFromUrl(resource);
        if (release) {
          const key = `${namespace} ${release.ownerRepo}`;
          if (seen.has(key)) continue;
          seen.add(key);
          components.push({
            name: release.ownerRepo.split("/").pop() ?? release.ownerRepo,
            namespace,
            current: release.tag,
            source: "github_release",
            upstream: release.ownerRepo,
            link_template: `https://github.com/${release.ownerRepo}/releases/tag/{tag}`,
            notes: `Auto-detected from ${resource}`,
          });
        }
        continue;
      }
      const resourcePath = join(baseDir, dirName, resource);
      if (await pathIsFile(resourcePath)) {
        let content: string;
        try {
          content = await Deno.readTextFile(resourcePath);
        } catch {
          continue;
        }
        const fileName = resource.split("/").pop() ?? resource;
        components.push(...scanManifestImages(content, fileName, namespace, seen, domainSuffix));
      }
    }
  }

  components.sort((a, b) =>
    a.namespace === b.namespace
      ? a.name.localeCompare(b.name)
      : a.namespace.localeCompare(b.namespace)
  );
  return components;
}

const BOOTSTRAP_HEADER = "# Auto-generated starter registry for RADAR.\n" +
  "# Every entry has the required keys; review source/link_template before trusting the output.\n";

/** Serialize scanned components as a seed component-versions.yaml document. */
export function bootstrapSeedYaml(components: ScannedComponent[]): string {
  const records = components.map((c) => {
    const record: Record<string, unknown> = {
      name: c.name,
      namespace: c.namespace,
      current: c.current,
      source: c.source,
      upstream: c.upstream,
      link_template: c.link_template,
      notes: c.notes,
    };
    if (c.source === "helm_chart") {
      record.chart_version = c.chart_version ?? "";
      record.track_app_version = c.track_app_version ?? false;
    }
    return record;
  });
  return BOOTSTRAP_HEADER + stringifyYaml({ components: records });
}

/**
 * Pin refresh: update `current` (and helm `chart_version`) of registry components
 * from scanned manifest pins, matched by (namespace, upstream), then upstream alone.
 * Components without a matching pin keep their stored values.
 */
export function refreshPinsFromScan(
  components: Pick<Component, "name" | "namespace" | "upstream" | "current" | "chart_version">[],
  scanned: ScannedComponent[],
): number {
  const byNsUpstream = new Map<string, ScannedComponent>();
  const byUpstream = new Map<string, ScannedComponent>();
  for (const s of scanned) {
    const nsKey = `${s.namespace} ${s.upstream}`;
    if (!byNsUpstream.has(nsKey)) byNsUpstream.set(nsKey, s);
    if (!byUpstream.has(s.upstream)) byUpstream.set(s.upstream, s);
  }
  let updated = 0;
  for (const c of components) {
    const match = byNsUpstream.get(`${c.namespace} ${c.upstream}`) ?? byUpstream.get(c.upstream);
    if (!match) continue;
    if (c.current !== match.current) {
      c.current = match.current;
      updated++;
    }
    if (match.chart_version !== undefined && c.chart_version !== match.chart_version) {
      c.chart_version = match.chart_version;
    }
  }
  return updated;
}

/**
 * Auto-detection: append scanned entries whose upstream is not tracked yet.
 * Dedupe is upstream-only (not namespaced) so a component curated once for
 * several namespaces (e.g. "curl") is not re-added per namespace. All
 * comparisons — upstream, name, and the ignore list — are case-insensitive
 * ("Valkey" curated, "valkey" scanned is the same component).
 *
 * `ignore` (from the seed) suppresses entries by upstream or name — the
 * user's curated noise filter, e.g. short-name images whose real registry
 * only exists in overlay `images:` sections.
 *
 * Names must be unique within a report (postgres PK is (run_id, name)). A
 * scanned entry whose name matches a tracked component only by case (e.g.
 * "valkey" vs "Valkey") is treated as already tracked and skipped — the
 * curated entry wins. On an exact-case name collision with a *different*
 * upstream the auto-added entry is disambiguated as "name (namespace)"; if
 * that is taken too, the entry is skipped and reported in `skipped`.
 */
export function addAutoDetectedComponents(
  components: Component[],
  scanned: ScannedComponent[],
  ignore: ReadonlySet<string> = new Set(),
): { added: number; skipped: string[]; ignored: number } {
  const upstreams = new Set(components.map((c) => c.upstream.toLowerCase()));
  const names = new Set(components.map((c) => c.name.toLowerCase()));
  const exactNames = new Set(components.map((c) => c.name));
  const ignoreLower = new Set([...ignore].map((entry) => entry.toLowerCase()));
  const skipped: string[] = [];
  let added = 0;
  let ignored = 0;
  for (const s of scanned) {
    if (upstreams.has(s.upstream.toLowerCase())) continue;
    if (ignoreLower.has(s.upstream.toLowerCase()) || ignoreLower.has(s.name.toLowerCase())) {
      ignored++;
      continue;
    }
    upstreams.add(s.upstream.toLowerCase());
    let name = s.name;
    if (names.has(name.toLowerCase())) {
      if (!exactNames.has(name)) {
        skipped.push(
          `${s.upstream} (already tracked as "${
            [...exactNames].find((n) => n.toLowerCase() === name.toLowerCase())
          }")`,
        );
        continue;
      }
      name = `${s.name} (${s.namespace})`;
      if (names.has(name.toLowerCase())) {
        skipped.push(`${s.upstream} (name collision: ${s.name}, namespace ${s.namespace})`);
        continue;
      }
    }
    names.add(name.toLowerCase());
    exactNames.add(name);
    components.push({
      name,
      namespace: s.namespace,
      current: s.current,
      source: s.source,
      upstream: s.upstream,
      link_template: s.link_template,
      notes: s.notes,
      chart_version: s.chart_version ?? "",
      track_app_version: s.track_app_version ?? false,
      latest: "",
      latest_link: "",
      update_available: false,
      cached: false,
    });
    added++;
  }
  return { added, skipped, ignored };
}
