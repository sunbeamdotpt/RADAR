/**
 * Layer 2: release-note structure analysis — format-agnostic detection of
 * breaking/removal/deprecation sections and inline markers.
 */

export interface NoteStructure {
  has_breaking_section: boolean;
  breaking_header: string | null;
  has_removal_section: boolean;
  has_deprecation_section: boolean;
  breaking_keywords: string[];
  confidence: number;
}

const HEADER_PATTERNS: [RegExp, "breaking" | "removal" | "deprecation"][] = [
  [/^#{1,4}\s*⚠\s*BREAKING/i, "breaking"],
  [/^#{1,4}\s*BREAKING\s*CHANGES?/i, "breaking"],
  [/^#{1,4}\s*REMOVAL/i, "removal"],
  [/^#{1,4}\s*Deprecation/i, "deprecation"],
  [
    // deno-lint-ignore no-invalid-regexp -- valid at runtime (with and without u flag); the lint parser trips on the astral emoji.
    /^(#{1,4}|\*\*|==+|--+)?\s*(BREAKING|Breaking|⚠|🚨|ACTION REQUIRED|Migration|Upgrade Notes)/i,
    "breaking",
  ],
  [/^(#{1,4}|\*\*|==+|--+)?\s*(Removal|Removed|Deprecat)/i, "removal"],
];

const INLINE_MARKERS = ["BREAKING CHANGE", "⚠️", "🚨", "[BREAKING]", "**BREAKING**"];

export function analyzeReleaseNoteStructure(text: string): NoteStructure {
  const result: NoteStructure = {
    has_breaking_section: false,
    breaking_header: null,
    has_removal_section: false,
    has_deprecation_section: false,
    breaking_keywords: [],
    confidence: 0,
  };
  for (const line of text.split("\n")) {
    for (const [pattern, category] of HEADER_PATTERNS) {
      if (!pattern.test(line)) continue;
      if (category === "breaking") {
        result.has_breaking_section = true;
        result.breaking_header = line.trim();
        result.confidence += 0.3;
      } else if (category === "removal") {
        result.has_removal_section = true;
        result.confidence += 0.15;
      } else {
        result.has_deprecation_section = true;
        result.confidence += 0.15;
      }
    }
  }
  for (const kw of INLINE_MARKERS) {
    if (text.includes(kw)) {
      result.breaking_keywords.push(kw);
      result.confidence += 0.1;
    }
  }
  result.confidence = Math.min(result.confidence, 1.0);
  return result;
}
