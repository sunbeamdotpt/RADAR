/**
 * Strict schema definitions for the RADAR component registry.
 *
 * These types mirror the Python `Component` dataclass from
 * sbbb/scripts/component-version-inventory.py, but are validated strictly:
 * unknown keys, wrong types, and invalid `source` values are rejected.
 */

/** Upstream source kinds supported by the inventory job. */
export const COMPONENT_SOURCES = [
  "github_release",
  "github_tags",
  "helm_chart",
  "docker_hub",
  "static",
  "custom",
] as const;

export type ComponentSource = (typeof COMPONENT_SOURCES)[number];

/**
 * Optional per-component hints for the step-2 assessor. Curated in the seed,
 * never emitted in report records (the report shape is contractual).
 */
export interface ComponentHints {
  /** e.g. "experimental" — breaking changes allowed between releases. */
  channel?: string;
  /** e.g. "ory" — version numbers that look like semver but aren't. */
  versioning_scheme?: string;
  /** e.g. "major_only" — project policy: breaking changes only in major versions. */
  breaking_change_policy?: string;
  /** EOL tracking: version line ("2.9"), date ("2026-12-31"), and replacement text. */
  eol_version_line?: string;
  eol_date?: string;
  eol_replacement?: string;
  /** Presence marks the component deprecated; the value is the migration message. */
  deprecated?: string;
}

/** A registry entry enriched with fetch results (in-memory working type). */
export interface Component extends ComponentHints {
  name: string;
  namespace: string;
  current: string;
  source: ComponentSource;
  upstream: string;
  link_template: string;
  notes: string;
  /** Pinned chart version when source === "helm_chart". */
  chart_version: string;
  /** For helm_chart: track appVersion instead of chart version. */
  track_app_version: boolean;
  /** Latest version reported by the upstream source ("" until fetched). */
  latest: string;
  /** Link to the latest release ("" until fetched). */
  latest_link: string;
  /** True when latest is a concrete version newer than current. */
  update_available: boolean;
  /** True when latest/latest_link came from the previous run (fetch failed). */
  cached: boolean;
}

/** JSON record shape emitted in reports. Key order is contractual (Python parity). */
export interface ComponentRecord {
  name: string;
  namespace: string;
  current: string;
  latest: string;
  source: ComponentSource;
  upstream: string;
  link_template: string;
  notes: string;
  update_available: boolean;
  chart_version?: string;
  track_app_version?: boolean;
}

/** Top-level report shape: the job's JSON output and the API's inventory payload. */
export interface InventoryReport {
  generated_at: string;
  components: ComponentRecord[];
}

export class SchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** YAML scalars may parse as numbers/booleans; accept those and coerce to string. */
function requireString(obj: Record<string, unknown>, key: string, ctx: string): string {
  const value = obj[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  throw new SchemaError(`${ctx}: "${key}" must be a string, got ${JSON.stringify(value)}`);
}

function optionalString(
  obj: Record<string, unknown>,
  key: string,
  fallback: string,
  ctx: string,
): string {
  if (obj[key] === undefined || obj[key] === null) return fallback;
  return requireString(obj, key, ctx);
}

function optionalBool(
  obj: Record<string, unknown>,
  key: string,
  fallback: boolean,
  ctx: string,
): boolean {
  const value = obj[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  throw new SchemaError(`${ctx}: "${key}" must be a boolean, got ${JSON.stringify(value)}`);
}

const SEED_KEYS = new Set([
  "name",
  "namespace",
  "current",
  "source",
  "upstream",
  "link_template",
  "notes",
  "chart_version",
  "track_app_version",
  "latest",
  // Dry-run hint (curated, never emitted in report records)
  "kustomize_path",
  // Assessor hints (curated, never emitted in report records)
  "channel",
  "versioning_scheme",
  "breaking_change_policy",
  "eol_version_line",
  "eol_date",
  "eol_replacement",
  "deprecated",
]);

function parseSource(value: unknown, ctx: string): ComponentSource {
  if (typeof value !== "string" || !(COMPONENT_SOURCES as readonly string[]).includes(value)) {
    throw new SchemaError(
      `${ctx}: "source" must be one of ${COMPONENT_SOURCES.join(", ")}, got ${
        JSON.stringify(value)
      }`,
    );
  }
  return value as ComponentSource;
}

/**
 * Validate one seed registry entry (from component-versions.yaml) and build a Component.
 * Unknown keys are rejected, matching Python's `Component(**item)` strictness.
 */
export function parseSeedComponent(raw: unknown, index: number): Component {
  const ctx = `components[${index}]`;
  if (!isRecord(raw)) throw new SchemaError(`${ctx}: must be a mapping`);
  for (const key of Object.keys(raw)) {
    if (!SEED_KEYS.has(key)) throw new SchemaError(`${ctx}: unknown key "${key}"`);
  }
  for (const key of ["name", "namespace", "current", "source", "upstream"] as const) {
    if (raw[key] === undefined || raw[key] === null) {
      throw new SchemaError(`${ctx}: missing required key "${key}"`);
    }
  }
  const component: Component = {
    name: requireString(raw, "name", ctx),
    namespace: requireString(raw, "namespace", ctx),
    current: requireString(raw, "current", ctx),
    source: parseSource(raw.source, ctx),
    upstream: requireString(raw, "upstream", ctx),
    link_template: optionalString(raw, "link_template", "", ctx),
    notes: optionalString(raw, "notes", "", ctx),
    chart_version: optionalString(raw, "chart_version", "", ctx),
    track_app_version: optionalBool(raw, "track_app_version", false, ctx),
    latest: optionalString(raw, "latest", "", ctx),
    latest_link: "",
    update_available: false,
    cached: false,
  };
  // Assessor hints: present-only, so they stay out of report records.
  for (
    const key of [
      "channel",
      "versioning_scheme",
      "breaking_change_policy",
      "eol_version_line",
      "eol_date",
      "eol_replacement",
      "deprecated",
    ] as const
  ) {
    if (raw[key] !== undefined && raw[key] !== null) {
      component[key] = requireString(raw, key, ctx);
    }
  }
  return component;
}

/** Validate the whole seed document ({components: [...]}). */
export function parseSeedDocument(raw: unknown): Component[] {
  if (!isRecord(raw)) throw new SchemaError("seed document must be a mapping");
  const items = raw.components;
  if (!Array.isArray(items)) throw new SchemaError('seed document must have a "components" list');
  return items.map((item, i) => parseSeedComponent(item, i));
}

/**
 * Validate the seed document's optional `ignore` list: exact upstreams or
 * component names the auto-detector must never add. Only gates auto-detection;
 * curated components are always kept regardless of ignore entries.
 */
export function parseSeedIgnore(raw: unknown): string[] {
  if (!isRecord(raw)) throw new SchemaError("seed document must be a mapping");
  if (raw.ignore === undefined || raw.ignore === null) return [];
  if (!Array.isArray(raw.ignore)) throw new SchemaError('"ignore" must be a list of strings');
  return raw.ignore.map((entry, i) => {
    if (typeof entry !== "string" || entry === "") {
      throw new SchemaError(`ignore[${i}]: must be a non-empty string`);
    }
    return entry;
  });
}

/**
 * Build the JSON record for a component, with keys in the exact order the Python
 * script emits them (contractual for parity and downstream consumers).
 */
export function toRecord(c: Component): ComponentRecord {
  const record: ComponentRecord = {
    name: c.name,
    namespace: c.namespace,
    current: c.current,
    latest: c.latest,
    source: c.source,
    upstream: c.upstream,
    link_template: c.link_template,
    notes: c.notes,
    update_available: c.update_available,
  };
  if (c.source === "helm_chart") {
    record.chart_version = c.chart_version;
    record.track_app_version = c.track_app_version;
  }
  return record;
}

const RECORD_KEYS = new Set([
  "name",
  "namespace",
  "current",
  "latest",
  "source",
  "upstream",
  "link_template",
  "notes",
  "update_available",
  "chart_version",
  "track_app_version",
]);

/** Validate one record from a previous JSON report (ingest path). */
export function parseReportComponent(raw: unknown, index: number): Component {
  const ctx = `components[${index}]`;
  if (!isRecord(raw)) throw new SchemaError(`${ctx}: must be an object`);
  for (const key of Object.keys(raw)) {
    if (!RECORD_KEYS.has(key)) throw new SchemaError(`${ctx}: unknown key "${key}"`);
  }
  for (const key of ["name", "namespace", "current", "latest", "source", "upstream"] as const) {
    if (raw[key] === undefined || raw[key] === null) {
      throw new SchemaError(`${ctx}: missing required key "${key}"`);
    }
  }
  return {
    name: requireString(raw, "name", ctx),
    namespace: requireString(raw, "namespace", ctx),
    current: requireString(raw, "current", ctx),
    source: parseSource(raw.source, ctx),
    upstream: requireString(raw, "upstream", ctx),
    link_template: optionalString(raw, "link_template", "", ctx),
    notes: optionalString(raw, "notes", "", ctx),
    chart_version: optionalString(raw, "chart_version", "", ctx),
    track_app_version: optionalBool(raw, "track_app_version", false, ctx),
    latest: requireString(raw, "latest", ctx),
    latest_link: "",
    update_available: optionalBool(raw, "update_available", false, ctx),
    cached: false,
  };
}

/** Validate a full previous report ({generated_at, components}). */
export function parseReportDocument(raw: unknown): InventoryReport {
  if (!isRecord(raw)) throw new SchemaError("report document must be an object");
  if (typeof raw.generated_at !== "string") {
    throw new SchemaError('report document must have a string "generated_at"');
  }
  if (!Array.isArray(raw.components)) {
    throw new SchemaError('report document must have a "components" array');
  }
  return {
    generated_at: raw.generated_at,
    components: raw.components.map((item, i) => toRecord(parseReportComponent(item, i))),
  };
}

/** Serialize a report exactly like the Python script: 2-space indent, trailing newline-free. */
export function serializeReport(components: Component[], generatedAt: string): string {
  return JSON.stringify(
    { generated_at: generatedAt, components: components.map(toRecord) },
    null,
    2,
  );
}
