import type { ComponentHints, ComponentRecord } from "../schema/component.ts";
import type { Assessment } from "../schema/assessment.ts";
import { makeAssessment } from "./verdict.ts";
import { detectForkSuffix, isFalsePositiveTag, isFloatingTag, parseSemver } from "./version.ts";

/**
 * Layer 0: prechecks that decide without any external data —
 * floating tags, curated deprecation/EOL hints, fork suffixes,
 * false-positive latest tags, and version-scheme-aware bump analysis.
 */

const EOL_WARNING_WINDOW_MONTHS = 6;

export function runPrechecks(
  comp: ComponentRecord,
  hints: ComponentHints,
  now: Date = new Date(),
): Assessment | null {
  const { name, current, latest } = comp;

  if (isFloatingTag(current)) {
    return makeAssessment(
      name,
      current,
      latest,
      "floating_tag",
      `Floating tag '${current}' prevents reproducible deployments`,
      "Pin to specific semver tag",
      "layer_0_precheck",
      { floating_tag: current },
    );
  }

  if (hints.deprecated) {
    return makeAssessment(
      name,
      current,
      latest,
      "deprecated",
      hints.deprecated,
      "Migrate to the recommended replacement",
      "layer_0_precheck",
      { deprecated: true },
    );
  }

  const eol = checkEol(comp, hints, now);
  if (eol) return eol;

  const fork = detectForkSuffix(current);
  if (fork) {
    return makeAssessment(
      name,
      current,
      latest,
      "custom_fork",
      `Custom fork suffix '-${fork}' detected`,
      "Verify fork is rebased on latest upstream",
      "layer_0_precheck",
      { fork_org: fork },
    );
  }

  if (latest !== "unknown" && latest !== "" && isFalsePositiveTag(current, latest)) {
    return makeAssessment(
      name,
      current,
      latest,
      "false_positive",
      `Latest tag '${latest}' appears to be a non-standard variant`,
      "Ignore or verify against actual release tags",
      "layer_0_precheck",
      { latest_tag: latest },
    );
  }

  return null;
}

function checkEol(
  comp: ComponentRecord,
  hints: ComponentHints,
  now: Date,
): Assessment | null {
  if (!hints.eol_date || !hints.eol_version_line) return null;
  const cur = parseSemver(comp.current);
  if (!cur) return null;
  if (`${cur.major}.${cur.minor}` !== hints.eol_version_line) return null;
  const eol = new Date(`${hints.eol_date}T00:00:00Z`);
  if (Number.isNaN(eol.getTime())) return null;
  const months = Math.round(((eol.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30)) * 10) /
    10;
  if (months > EOL_WARNING_WINDOW_MONTHS) return null;
  return makeAssessment(
    comp.name,
    comp.current,
    comp.latest,
    "eol_warning",
    `Version line ${hints.eol_version_line} approaching EOL (${months} months until ${hints.eol_date})`,
    `Plan upgrade to ${hints.eol_replacement ?? "a supported version line"} before EOL`,
    "layer_0_precheck",
    { version_line: hints.eol_version_line, eol_date: hints.eol_date, months_until: months },
  );
}

/**
 * Version-scheme hints, applied before the generic major-bump rule:
 * projects whose version numbers don't carry semver meaning (e.g. Ory's
 * year-based releases) must not have "major bumps" read as breaking.
 */
export function applyVersioningHints(
  comp: ComponentRecord,
  hints: ComponentHints,
): Assessment | null {
  const { name, current, latest } = comp;
  const cur = parseSemver(current);
  const lat = parseSemver(latest);
  if (!cur || !lat) return null;

  const versioning = hints.versioning_scheme;
  if (versioning === "ory") {
    const gap = (lat.major - cur.major) * 100 + (lat.minor - cur.minor);
    if (gap > 0) {
      return makeAssessment(
        name,
        current,
        latest,
        "review",
        `Ory non-semver scheme: ${current} → ${latest} (hint: versioning_scheme=ory). Schema changes common and not always labeled.`,
        "Review release notes and verify DB migration compatibility",
        "layer_0_hints",
        { hint: "versioning_scheme=ory" },
      );
    }
    return null;
  }

  const policy = hints.breaking_change_policy;
  if (policy === "major_only" && cur.major === lat.major) {
    return makeAssessment(
      name,
      current,
      latest,
      "likely_safe",
      `Same major version (${cur.major}) — project policy: breaking changes only in major versions (hint: breaking_change_policy=major_only)`,
      "Safe to auto-update",
      "layer_0_hints",
      { hint: "breaking_change_policy=major_only" },
    );
  }

  return null;
}

/** Generic major-bump rule — runs after version-scheme hints had their say. */
export function checkMajorBump(comp: ComponentRecord): Assessment | null {
  const cur = parseSemver(comp.current);
  const lat = parseSemver(comp.latest);
  if (cur && lat && lat.major > cur.major) {
    return makeAssessment(
      comp.name,
      comp.current,
      comp.latest,
      "breaking",
      `Major version bump: ${cur.major}.${cur.minor}.${cur.patch} → ${lat.major}.${lat.minor}.${lat.patch}`,
      "Read migration guide before upgrading",
      "layer_0_precheck",
      { from: comp.current, to: comp.latest },
    );
  }
  return null;
}

/** Channel hints run late: curated context outranks the generic gap heuristic. */
export function applyChannelHint(
  comp: ComponentRecord,
  hints: ComponentHints,
): Assessment | null {
  // Auto-detect experimental channels from curated notes when not explicit.
  const channel = hints.channel ?? (/experimental/i.test(comp.notes) ? "experimental" : undefined);
  if (channel === "experimental") {
    return makeAssessment(
      comp.name,
      comp.current,
      comp.latest,
      "breaking",
      "Experimental channel — breaking changes allowed between releases (hint: channel=experimental)",
      "Always review experimental-channel updates",
      "layer_6_hints",
      { hint: "channel=experimental" },
    );
  }
  return null;
}
