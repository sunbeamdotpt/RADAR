/**
 * Strict schema for server-side dry-run preview reports (pipeline step 3 output).
 */

export const DRYRUN_STATUSES = [
  "success",
  "build_failed",
  "dryrun_failed",
  "skipped_no_mapping",
  "skipped_unsupported_source",
] as const;

export type DryRunStatus = (typeof DRYRUN_STATUSES)[number];

export interface DryRun {
  name: string;
  current: string;
  latest: string;
  namespace: string;
  kustomize_path: string;
  status: DryRunStatus;
  /** Captured stdout from kustomize build or kubectl dry-run. */
  stdout: string;
  /** Captured stderr from kustomize build or kubectl dry-run. */
  stderr: string;
  /** Wall-clock duration of build + dry-run in milliseconds. */
  duration_ms: number;
  /** Helm chart version written into the temp copy, when applicable. */
  mutated_helm_version?: string;
  /** Free-form context: command line, exit code, path, etc. */
  details: Record<string, unknown>;
}

export interface DryRunReport {
  generated_at: string;
  /** generated_at of the inventory run these dry-runs were computed from. */
  inventory_generated_at: string;
  /** generated_at of the assessment run these dry-runs were computed from. */
  assessment_generated_at: string;
  dry_runs: DryRun[];
}

export class DryRunSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DryRunSchemaError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(obj: Record<string, unknown>, key: string, ctx: string): string {
  const value = obj[key];
  if (typeof value !== "string") {
    throw new DryRunSchemaError(`${ctx}: "${key}" must be a string`);
  }
  return value;
}

function requireNumber(obj: Record<string, unknown>, key: string, ctx: string): number {
  const value = obj[key];
  if (typeof value !== "number") {
    throw new DryRunSchemaError(`${ctx}: "${key}" must be a number`);
  }
  return value;
}

export function parseDryRunStatus(value: unknown, ctx: string): DryRunStatus {
  if (typeof value !== "string" || !(DRYRUN_STATUSES as readonly string[]).includes(value)) {
    throw new DryRunSchemaError(
      `${ctx}: "status" must be one of ${DRYRUN_STATUSES.join(", ")}, got ${JSON.stringify(value)}`,
    );
  }
  return value as DryRunStatus;
}

const DRYRUN_KEYS = new Set([
  "name",
  "current",
  "latest",
  "namespace",
  "kustomize_path",
  "status",
  "stdout",
  "stderr",
  "duration_ms",
  "mutated_helm_version",
  "details",
]);

/** Validate one stored dry-run row/document (API + store ingest path). */
export function parseDryRun(raw: unknown, index: number): DryRun {
  const ctx = `dry_runs[${index}]`;
  if (!isRecord(raw)) throw new DryRunSchemaError(`${ctx}: must be an object`);
  for (const key of Object.keys(raw)) {
    if (!DRYRUN_KEYS.has(key)) throw new DryRunSchemaError(`${ctx}: unknown key "${key}"`);
  }
  for (
    const key of [
      "name",
      "current",
      "latest",
      "namespace",
      "kustomize_path",
      "status",
      "stdout",
      "stderr",
      "duration_ms",
    ] as const
  ) {
    if (raw[key] === undefined || raw[key] === null) {
      throw new DryRunSchemaError(`${ctx}: missing required key "${key}"`);
    }
  }
  const details = raw.details ?? {};
  if (!isRecord(details)) throw new DryRunSchemaError(`${ctx}: "details" must be an object`);
  const dryrun: DryRun = {
    name: requireString(raw, "name", ctx),
    current: requireString(raw, "current", ctx),
    latest: requireString(raw, "latest", ctx),
    namespace: requireString(raw, "namespace", ctx),
    kustomize_path: requireString(raw, "kustomize_path", ctx),
    status: parseDryRunStatus(raw.status, ctx),
    stdout: requireString(raw, "stdout", ctx),
    stderr: requireString(raw, "stderr", ctx),
    duration_ms: requireNumber(raw, "duration_ms", ctx),
    details,
  };
  if (raw.mutated_helm_version !== undefined && raw.mutated_helm_version !== null) {
    dryrun.mutated_helm_version = requireString(raw, "mutated_helm_version", ctx);
  }
  return dryrun;
}

/** Validate a stored dry-run report. */
export function parseDryRunReport(raw: unknown): DryRunReport {
  if (!isRecord(raw)) throw new DryRunSchemaError("dry-run report must be an object");
  if (typeof raw.generated_at !== "string") {
    throw new DryRunSchemaError('report must have a string "generated_at"');
  }
  if (typeof raw.inventory_generated_at !== "string") {
    throw new DryRunSchemaError('report must have a string "inventory_generated_at"');
  }
  if (typeof raw.assessment_generated_at !== "string") {
    throw new DryRunSchemaError('report must have a string "assessment_generated_at"');
  }
  if (!Array.isArray(raw.dry_runs)) {
    throw new DryRunSchemaError('report must have a "dry_runs" array');
  }
  return {
    generated_at: raw.generated_at,
    inventory_generated_at: raw.inventory_generated_at,
    assessment_generated_at: raw.assessment_generated_at,
    dry_runs: raw.dry_runs.map((d, i) => parseDryRun(d, i)),
  };
}
