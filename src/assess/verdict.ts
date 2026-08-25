import type { Assessment, RiskLevel } from "../schema/assessment.ts";

/** Convenience constructor for assessments. */
export function makeAssessment(
  name: string,
  current: string,
  latest: string,
  risk: RiskLevel,
  reason: string,
  action: string,
  layer: string,
  details: Record<string, unknown> = {},
): Assessment {
  return { name, current, latest, risk_level: risk, reason, action, layer, details };
}
