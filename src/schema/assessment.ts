/**
 * Strict schema for breaking-change risk assessments (pipeline step 2 output).
 */

export const RISK_LEVELS = [
  "breaking",
  "deprecated",
  "eol_warning",
  "false_positive",
  "floating_tag",
  "custom_fork",
  "review",
  "unknown",
  "likely_safe",
] as const;

export type RiskLevel = (typeof RISK_LEVELS)[number];

/** Sort order for reports: most urgent first. */
export const SEVERITY_ORDER: Record<RiskLevel, number> = {
  breaking: 0,
  deprecated: 1,
  eol_warning: 2,
  false_positive: 3,
  floating_tag: 4,
  custom_fork: 5,
  review: 6,
  unknown: 7,
  likely_safe: 8,
};

export interface Assessment {
  name: string;
  current: string;
  latest: string;
  risk_level: RiskLevel;
  reason: string;
  action: string;
  /** Which analysis layer produced the verdict, e.g. "layer_0_precheck". */
  layer: string;
  details: Record<string, unknown>;
}

export interface AssessmentReport {
  generated_at: string;
  /** generated_at of the inventory run these assessments were computed from. */
  inventory_generated_at: string;
  assessments: Assessment[];
}

export class AssessmentSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssessmentSchemaError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(obj: Record<string, unknown>, key: string, ctx: string): string {
  const value = obj[key];
  if (typeof value !== "string") {
    throw new AssessmentSchemaError(`${ctx}: "${key}" must be a string`);
  }
  return value;
}

export function parseRiskLevel(value: unknown, ctx: string): RiskLevel {
  if (typeof value !== "string" || !(RISK_LEVELS as readonly string[]).includes(value)) {
    throw new AssessmentSchemaError(
      `${ctx}: "risk_level" must be one of ${RISK_LEVELS.join(", ")}, got ${JSON.stringify(value)}`,
    );
  }
  return value as RiskLevel;
}

const ASSESSMENT_KEYS = new Set([
  "name",
  "current",
  "latest",
  "risk_level",
  "reason",
  "action",
  "layer",
  "details",
]);

/** Validate one stored assessment row/document (API + store ingest path). */
export function parseAssessment(raw: unknown, index: number): Assessment {
  const ctx = `assessments[${index}]`;
  if (!isRecord(raw)) throw new AssessmentSchemaError(`${ctx}: must be an object`);
  for (const key of Object.keys(raw)) {
    if (!ASSESSMENT_KEYS.has(key)) throw new AssessmentSchemaError(`${ctx}: unknown key "${key}"`);
  }
  for (
    const key of ["name", "current", "latest", "risk_level", "reason", "action", "layer"] as const
  ) {
    if (raw[key] === undefined || raw[key] === null) {
      throw new AssessmentSchemaError(`${ctx}: missing required key "${key}"`);
    }
  }
  const details = raw.details ?? {};
  if (!isRecord(details)) throw new AssessmentSchemaError(`${ctx}: "details" must be an object`);
  return {
    name: requireString(raw, "name", ctx),
    current: requireString(raw, "current", ctx),
    latest: requireString(raw, "latest", ctx),
    risk_level: parseRiskLevel(raw.risk_level, ctx),
    reason: requireString(raw, "reason", ctx),
    action: requireString(raw, "action", ctx),
    layer: requireString(raw, "layer", ctx),
    details,
  };
}

/** Validate a stored assessment report. */
export function parseAssessmentReport(raw: unknown): AssessmentReport {
  if (!isRecord(raw)) throw new AssessmentSchemaError("assessment report must be an object");
  if (typeof raw.generated_at !== "string") {
    throw new AssessmentSchemaError('report must have a string "generated_at"');
  }
  if (typeof raw.inventory_generated_at !== "string") {
    throw new AssessmentSchemaError('report must have a string "inventory_generated_at"');
  }
  if (!Array.isArray(raw.assessments)) {
    throw new AssessmentSchemaError('report must have an "assessments" array');
  }
  return {
    generated_at: raw.generated_at,
    inventory_generated_at: raw.inventory_generated_at,
    assessments: raw.assessments.map((a, i) => parseAssessment(a, i)),
  };
}
