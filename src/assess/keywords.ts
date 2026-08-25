import type { RiskLevel } from "../schema/assessment.ts";

/**
 * Layer 4: weighted keyword scoring over release-note text. Positive weights
 * indicate risk; negative weights are safety signals (dependency bots, "bug
 * fixes only", …).
 */

export interface KeywordScore {
  risk: RiskLevel;
  confidence: number;
  matched: string[];
}

const KEYWORD_PATTERNS: [RegExp, number][] = [
  [/^#{1,4}\s*⚠\s*BREAKING/im, 1.0],
  [/\bBREAKING\s*CHANGES?\b/i, 0.9],
  [/must (migrate|update|change|modify|upgrade)/i, 0.8],
  [/schema validation error/i, 0.8],
  [/refuse(s)? to start/i, 0.8],
  // Calibrated down from 0.8: minor CLI/env removals over-fired on this phrase.
  [/no longer (supported|default|required|available)/i, 0.5],
  [/removed (support for|the|default)/i, 0.7],
  [/deprecated.*will be removed/i, 0.6],
  [/enforced.*upgrade path/i, 0.7],
  [/skipping.*versions.*blocked/i, 0.7],
  [/now defaults to/i, 0.4],
  [/changed from .* to/i, 0.4],
  [/bug fix(?:es)? only/i, -0.5],
  [/security (?:fix|patch|update)/i, -0.4],
  [/dependabot/i, -0.3],
  [/renovate/i, -0.3],
  [/chore\(deps\)/i, -0.3],
  [/replace the binary/i, -0.6],
  [/docker pull/i, -0.5],
];

export function scoreKeywords(text: string): KeywordScore {
  const matched: string[] = [];
  let total = 0;
  for (const [pattern, weight] of KEYWORD_PATTERNS) {
    if (pattern.test(text)) {
      matched.push(pattern.source.slice(0, 40));
      total += weight;
    }
  }
  const confidence = Math.min(Math.abs(total), 1.0);
  if (total >= 0.7) return { risk: "breaking", confidence, matched };
  if (total >= 0.3) return { risk: "review", confidence, matched };
  if (total <= -0.3) return { risk: "likely_safe", confidence, matched };
  return { risk: "unknown", confidence, matched };
}
