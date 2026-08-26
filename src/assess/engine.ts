import type { ComponentHints, ComponentRecord } from "../schema/component.ts";
import type { Assessment, RiskLevel } from "../schema/assessment.ts";
import type { HttpClient } from "../sources/http.ts";
import { makeAssessment } from "./verdict.ts";
import { isVersionMatch, parseSemver } from "./version.ts";
import {
  applyChannelHint,
  applyVersioningHints,
  checkMajorBump,
  runPrechecks,
} from "./prechecks.ts";
import { diffCRDManifests, diffGoMod, diffHelmValuesSchema } from "./structured.ts";
import { analyzeReleaseNoteStructure } from "./notes.ts";
import { analyzeCommits } from "./commits.ts";
import { scoreKeywords } from "./keywords.ts";
import { fetchReleaseNotes, releaseNotesFetchable } from "./fetch.ts";

/**
 * The layered assessment engine. Layers run highest-confidence first; the
 * first decisive verdict wins:
 *
 *   L0  prechecks (floating, deprecated, EOL, fork, false-positive)
 *   L0  in-sync short-circuit → `non_applicable`
 *   L0h version-scheme hints (ory, major_only) — before the major-bump rule
 *   L0  major version bump
 *   L1  structured diffs (helm schema / CRD / go.mod), when data is injected
 *   L2  release-note structure
 *   L3  commit analysis, when commits are injected
 *   L4  weighted keywords
 *   L6  channel hint (experimental) — curated context outranks gap heuristics
 *   L5  version-gap fallback (a drifted component whose notes were fetchable
 *       but came back empty is unknown — silence is not safety)
 *   —   unknown
 */

export interface AssessOptions {
  /** Pre-fetched release notes; when absent and not offline, fetched via link_template. */
  releaseNotes?: string;
  helmValuesOld?: Record<string, unknown>;
  helmValuesNew?: Record<string, unknown>;
  crdOld?: Record<string, unknown>;
  crdNew?: Record<string, unknown>;
  goModOld?: string;
  goModNew?: string;
  commits?: Array<{ sha: string; message: string }>;
  offline?: boolean;
  now?: Date;
}

const L4_ACTIONS: Record<RiskLevel, string> = {
  breaking: "Do not auto-update",
  review: "Human review recommended",
  likely_safe: "Safe to auto-update",
  unknown: "Manual review required",
  false_positive: "Verify manually",
  floating_tag: "Pin to semver",
  eol_warning: "Plan migration",
  deprecated: "Migrate image type",
  custom_fork: "Verify upstream sync",
  non_applicable: "Nothing to do",
};

export async function assessComponent(
  comp: ComponentRecord,
  hints: ComponentHints,
  http: HttpClient,
  token: string | undefined,
  opts: AssessOptions = {},
): Promise<Assessment> {
  const { name, current, latest } = comp;

  // Layer 0: prechecks that need no external data.
  const precheck = runPrechecks(comp, hints, opts.now);
  if (precheck) return precheck;

  // No drift? Nothing to assess as an upgrade risk. Prechecks above still fire
  // for component-level issues (deprecated, EOL, floating tag, custom fork).
  if (isVersionMatch(current, latest)) {
    return makeAssessment(
      name,
      current,
      latest,
      "non_applicable",
      "Current and latest versions are identical — no upgrade risk to assess",
      "Nothing to do",
      "layer_0_in_sync",
      { current, latest },
    );
  }

  // Version-scheme hints interpret the version numbers themselves — they must
  // run before the generic major-bump rule reads them as semver.
  const versioning = applyVersioningHints(comp, hints);
  if (versioning) return versioning;

  const majorBump = checkMajorBump(comp);
  if (majorBump) return majorBump;

  // Layer 1: structured data (only when the caller has it).
  if (comp.source === "helm_chart" && opts.helmValuesOld && opts.helmValuesNew) {
    const changes = diffHelmValuesSchema(opts.helmValuesOld, opts.helmValuesNew);
    const breaking = changes.filter((c) => c.severity === "breaking");
    if (breaking.length > 0) {
      const paths = breaking.slice(0, 5).map((c) => c.path).join(", ");
      return makeAssessment(
        name,
        current,
        latest,
        "breaking",
        `Helm values schema breaking changes: ${paths}${breaking.length > 5 ? "…" : ""}`,
        "Review values.yaml migration guide",
        "layer_1_helm_schema",
        { breaking_changes: breaking },
      );
    }
    if (changes.length === 0) {
      return makeAssessment(
        name,
        current,
        latest,
        "likely_safe",
        "No Helm values schema changes detected",
        "Safe to upgrade",
        "layer_1_helm_schema",
      );
    }
  }
  if (opts.crdOld && opts.crdNew) {
    const changes = diffCRDManifests(opts.crdOld, opts.crdNew);
    const breaking = changes.filter((c) => c.severity === "breaking");
    if (breaking.length > 0) {
      const paths = breaking.slice(0, 5).map((c) => c.path).join(", ");
      return makeAssessment(
        name,
        current,
        latest,
        "breaking",
        `CRD breaking changes: ${paths}${breaking.length > 5 ? "…" : ""}`,
        "Review CRD migration",
        "layer_1_crd_diff",
        { breaking_changes: breaking },
      );
    }
  }
  if (opts.goModOld && opts.goModNew) {
    const changes = diffGoMod(opts.goModOld, opts.goModNew);
    const majorBumps = changes.filter((c) => c.change_type === "dependency_major_bump");
    if (majorBumps.length > 0) {
      const mods = majorBumps.slice(0, 3).map((c) => c.path).join(", ");
      return makeAssessment(
        name,
        current,
        latest,
        "review",
        `Major dependency bumps in go.mod: ${mods}`,
        "Verify upstream compatibility",
        "layer_1_go_mod",
        { major_bumps: majorBumps },
      );
    }
  }

  // Release notes: injected or fetched (soft-fail — no notes is normal).
  // notesUnavailable tracks "we expected notes and got none" so the gap
  // fallback doesn't read silence as safety.
  let releaseNotes = opts.releaseNotes ?? "";
  const notesExpected = !opts.offline && opts.releaseNotes === undefined &&
    releaseNotesFetchable(comp);
  if (!releaseNotes && !opts.offline) {
    releaseNotes = await fetchReleaseNotes(comp, http, token);
  }
  const notesUnavailable = notesExpected && !releaseNotes;
  const combinedNotes = `${releaseNotes}\n${comp.notes}`;

  // Layer 2: release-note structure.
  if (combinedNotes.trim()) {
    const structure = analyzeReleaseNoteStructure(combinedNotes);
    if (structure.has_breaking_section && structure.confidence >= 0.5) {
      return makeAssessment(
        name,
        current,
        latest,
        "breaking",
        `Detected breaking section: ${structure.breaking_header}`,
        "Do not auto-update",
        "layer_2_note_structure",
        { confidence: structure.confidence, keywords: structure.breaking_keywords },
      );
    }
    if (structure.has_removal_section) {
      return makeAssessment(
        name,
        current,
        latest,
        "review",
        "Detected removal/deprecation section",
        "Review for removed features",
        "layer_2_note_structure",
        { confidence: structure.confidence },
      );
    }
  }

  // Layer 3: commits (only when injected).
  if (opts.commits && opts.commits.length > 0) {
    const signals = analyzeCommits(opts.commits);
    const breakingCommits = signals.filter((s) => s.is_breaking);
    if (breakingCommits.length > 0) {
      const shas = breakingCommits.slice(0, 3).map((s) => s.sha).join(", ");
      return makeAssessment(
        name,
        current,
        latest,
        "review",
        `${breakingCommits.length} potentially breaking commits (${shas})`,
        "Review commit history",
        "layer_3_commits",
        {
          breaking_commits: breakingCommits.slice(0, 5).map((s) => ({
            sha: s.sha,
            msg: s.message.slice(0, 80),
          })),
        },
      );
    }
    const cur = parseSemver(current);
    const lat = parseSemver(latest);
    if (signals.length > 20 && cur && lat) {
      const gap = (lat.major - cur.major) * 100 + (lat.minor - cur.minor);
      if (gap > 5) {
        return makeAssessment(
          name,
          current,
          latest,
          "review",
          `Large commit volume (${signals.length}) with no explicit breaking markers`,
          "Review for subtle changes",
          "layer_3_commits",
          { commit_count: signals.length },
        );
      }
    }
  }

  // Layer 4: weighted keywords.
  const kwScore = scoreKeywords(combinedNotes);
  if (kwScore.confidence >= 0.5) {
    return makeAssessment(
      name,
      current,
      latest,
      kwScore.risk,
      `Keyword analysis (confidence: ${kwScore.confidence}): ${
        kwScore.matched.slice(0, 3).join(", ")
      }`,
      L4_ACTIONS[kwScore.risk],
      "layer_4_keywords",
      { confidence: kwScore.confidence, matched: kwScore.matched },
    );
  }

  // Channel hint: curated context outranks the generic gap heuristic.
  const channel = applyChannelHint(comp, hints);
  if (channel) return channel;

  // Layer 5: version-gap fallback.
  const cur = parseSemver(current);
  const lat = parseSemver(latest);
  if (cur && lat && cur.major === lat.major) {
    const gap = lat.minor - cur.minor;
    if (gap > 10) {
      return makeAssessment(
        name,
        current,
        latest,
        "review",
        `Large minor version gap (${gap} minors) — insufficient data to confirm safety`,
        "Review intermediate release notes or test thoroughly",
        "layer_5_gap_fallback",
        { minor_gap: gap },
      );
    }
    if (gap <= 2) {
      if (gap > 0 && notesUnavailable) {
        return makeAssessment(
          name,
          current,
          latest,
          "unknown",
          `Same major, small gap (${gap}), but release notes could not be fetched — cannot confirm safety`,
          "Fetch release notes manually",
          "layer_5_gap_fallback",
          { minor_gap: gap, notes_unavailable: true },
        );
      }
      return makeAssessment(
        name,
        current,
        latest,
        "likely_safe",
        `Same major, small gap (${gap}), no breaking signals detected`,
        "Likely safe",
        "layer_5_gap_fallback",
        { minor_gap: gap },
      );
    }
  }

  return makeAssessment(
    name,
    current,
    latest,
    "unknown",
    "Could not determine safety — insufficient data",
    "Manual review required",
    "layer_6_fallback",
  );
}
