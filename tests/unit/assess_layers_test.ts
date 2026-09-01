import { assertEquals } from "jsr:@std/assert@^1";
import {
  detectForkSuffix,
  isFalsePositiveTag,
  isFloatingTag,
  parseSemver,
} from "../../src/assess/version.ts";
import { diffCRDManifests, diffGoMod, diffHelmValuesSchema } from "../../src/assess/structured.ts";
import { analyzeReleaseNoteStructure } from "../../src/assess/notes.ts";
import { analyzeCommits } from "../../src/assess/commits.ts";
import { scoreKeywords } from "../../src/assess/keywords.ts";

// --- version parsing ---

Deno.test("parseSemver handles prefixes, suffixes and multi-tag strings", () => {
  assertEquals(parseSemver("v1.19.4"), { major: 1, minor: 19, patch: 4 });
  assertEquals(parseSemver("8-alpine"), { major: 8, minor: 0, patch: 0 });
  assertEquals(parseSemver("18.1-system-trixie"), { major: 18, minor: 1, patch: 0 });
  assertEquals(parseSemver("curl-8_21_0"), { major: 8, minor: 21, patch: 0 });
  assertEquals(parseSemver("8.9.1 / 8.10.1 / latest"), { major: 8, minor: 9, patch: 1 });
  assertEquals(parseSemver("v2026.08.5"), { major: 2026, minor: 8, patch: 5 });
  assertEquals(parseSemver("stable"), null);
  assertEquals(parseSemver("unknown"), null);
  assertEquals(parseSemver("latest / stable"), null);
});

Deno.test("isFloatingTag recognizes non-reproducible tags", () => {
  for (const t of ["latest", "stable", "main", "master", "nightly", "edge", "LATEST"]) {
    assertEquals(isFloatingTag(t), true, t);
  }
  assertEquals(isFloatingTag("v1.0.0"), false);
});

Deno.test("detectForkSuffix finds forks but not prereleases", () => {
  assertEquals(detectForkSuffix("v2.41.1-sunbeam.12"), "sunbeam");
  assertEquals(detectForkSuffix("v1.0.0-rc.14"), null, "rc.N is a prerelease, not a fork");
  assertEquals(detectForkSuffix("v1.0.0-rc14"), null);
  assertEquals(detectForkSuffix("v1.21.1"), null);
});

Deno.test("isFalsePositiveTag spots build variants as latest", () => {
  assertEquals(isFalsePositiveTag("4.18", "4.43_large_disk_rocksdb"), true);
  assertEquals(isFalsePositiveTag("0.28.0", "v1-ogen-backup-0e77a212b-debug"), true);
  assertEquals(isFalsePositiveTag("v0.28.0", "v0.30.0-distroless"), true);
  assertEquals(
    isFalsePositiveTag("8-alpine", "9.1.1-trixie"),
    false,
    "suffixed current: variants are normal",
  );
  assertEquals(isFalsePositiveTag("1.0.0", "1.2.3"), false);
});

// --- layer 1: structured diffs ---

Deno.test("diffHelmValuesSchema detects removals, type changes, required, enum restrictions", () => {
  const oldSchema = {
    properties: {
      prometheus: { type: "object", properties: { path: { type: "string" } } },
      mode: { type: "string", enum: ["a", "b"] },
      replicaCount: { type: "number" },
    },
    required: ["image"],
  };
  const newSchema = {
    properties: {
      prometheus: { type: "object", properties: {} },
      mode: { type: "string", enum: ["a"] },
      replicaCount: { type: "string" },
    },
    required: ["image", "domain"],
  };
  const changes = diffHelmValuesSchema(oldSchema, newSchema);
  const types = changes.map((c) => c.change_type).sort();
  assertEquals(types, ["enum_restricted", "removed", "required_added", "type_changed"]);
  assertEquals(changes.every((c) => c.severity === "breaking"), true);
  assertEquals(
    changes.find((c) => c.change_type === "required_added")?.path,
    "domain",
    "root-level required additions are detected",
  );
  assertEquals(
    changes.some((c) => c.path.includes("enum.1")),
    false,
    "enum arrays are leaves, not walked by index",
  );
});

Deno.test("diffHelmValuesSchema reports no changes for identical schemas", () => {
  const s = { properties: { a: { type: "string" } } };
  assertEquals(diffHelmValuesSchema(s, s), []);
});

Deno.test("diffCRDManifests detects removed API versions and new required fields", () => {
  const oldCrd = {
    spec: {
      versions: [
        { name: "v1alpha1", schema: { openAPIV3Schema: { required: ["spec"] } } },
        { name: "v1beta1", schema: { openAPIV3Schema: {} } },
      ],
    },
  };
  const newCrd = {
    spec: {
      versions: [
        { name: "v1alpha1", schema: { openAPIV3Schema: { required: ["spec", "targetRef"] } } },
      ],
    },
  };
  const changes = diffCRDManifests(oldCrd, newCrd);
  assertEquals(changes.map((c) => c.change_type).sort(), [
    "api_version_removed",
    "required_field_added",
  ]);
  assertEquals(changes[0].path, "versions.v1beta1");
});

Deno.test("diffGoMod flags removed deps and major bumps", () => {
  const oldMod = "require github.com/foo/bar v1.2.3\nrequire github.com/gone/dep v0.9.0\n";
  const newMod = "require github.com/foo/bar v2.0.0\n";
  const changes = diffGoMod(oldMod, newMod);
  assertEquals(changes.map((c) => c.change_type).sort(), [
    "dependency_major_bump",
    "dependency_removed",
  ]);
  assertEquals(diffGoMod("require a v1.0.0\n", "require a v1.2.0\n"), []);
});

// --- layer 2: note structure ---

Deno.test("analyzeReleaseNoteStructure detects breaking sections", () => {
  const s = analyzeReleaseNoteStructure(
    "## What's New\nstuff\n## ⚠ BREAKING CHANGES\n- removed X\n",
  );
  assertEquals(s.has_breaking_section, true);
  assertEquals(s.breaking_header, "## ⚠ BREAKING CHANGES");
  assertEquals(s.confidence >= 0.5, true);
});

Deno.test("analyzeReleaseNoteStructure detects removal/deprecation and inline markers", () => {
  const s = analyzeReleaseNoteStructure("### Removed\n- old flag\n**BREAKING** inline note\n");
  assertEquals(s.has_removal_section, true);
  assertEquals(s.breaking_keywords.includes("**BREAKING**"), true);
  const d = analyzeReleaseNoteStructure("## Deprecation Notice\n- x\n");
  assertEquals(d.has_deprecation_section, true);
  assertEquals(analyzeReleaseNoteStructure("just a changelog\n").confidence, 0);
});

// --- layer 3: commits ---

Deno.test("analyzeCommits detects conventional breaking markers", () => {
  const signals = analyzeCommits([
    { sha: "abcdef123456", message: "feat(api)!: remove deprecated endpoint" },
    { sha: "1234567abcdef", message: "fix: correct typo\n\nBREAKING CHANGE: config renamed" },
    { sha: "9999999ffffff", message: "chore: bump deps" },
    { sha: "8888888eeeeee", message: "drop support for legacy auth" },
  ]);
  assertEquals(signals.length, 4, "safe conventional commits are signals too");
  assertEquals(signals[0].is_breaking, true);
  assertEquals(signals[0].ctype, "feat");
  assertEquals(signals[0].scope, "api");
  assertEquals(signals[1].is_breaking, true);
  assertEquals(signals[2].is_breaking, false);
  assertEquals(signals[2].ctype, "chore");
  assertEquals(signals[3].ctype, "unknown");
  assertEquals(signals[3].is_breaking, true);
});

// --- layer 4: keywords ---

Deno.test("scoreKeywords thresholds: breaking / review / likely_safe / unknown", () => {
  assertEquals(scoreKeywords("## BREAKING CHANGES\nmust migrate now").risk, "breaking");
  assertEquals(scoreKeywords("something now defaults to on").risk, "review");
  assertEquals(scoreKeywords("bug fixes only, dependabot, security fix").risk, "likely_safe");
  assertEquals(scoreKeywords("a perfectly ordinary changelog").risk, "unknown");
});

Deno.test("scoreKeywords keeps 'no longer supported' below the breaking threshold", () => {
  // Calibrated: minor removals (BuildKit OTEL vars) should be review, not breaking.
  const s = scoreKeywords("the OTEL fallback variables are no longer supported");
  assertEquals(s.risk, "review");
  assertEquals(s.confidence, 0.5);
});

Deno.test("scoreKeywords catches bold inline breaking labels (OpenFGA '**Breaking:**')", () => {
  const s = scoreKeywords(
    "### Fixed\n- **Breaking:** persisted malformed models now fail with `ErrInvalidModel`\n",
  );
  assertEquals(s.risk, "breaking");
  assertEquals(s.confidence, 0.9);
});

Deno.test("scoreKeywords flags manual schema migrations (Stalwart VARBINARY)", () => {
  const s = scoreKeywords(
    "Key columns are now VARBINARY(255). Existing deployments should run, once per table, " +
      "the command ALTER TABLE a MODIFY k VARBINARY(255) NOT NULL;",
  );
  assertEquals(s.risk, "breaking");
});

Deno.test("scoreKeywords floors strong risk signals at review despite safety keywords", () => {
  // Stalwart-style: real migration language plus "replace the binary" / "docker pull"
  // safety phrases. The negatives must not net the migration out to likely_safe.
  const s = scoreKeywords(
    "Upgrading is as simple as replace the binary or docker pull. " +
      "Existing MySQL deployments must run ALTER TABLE a MODIFY k VARBINARY(255) NOT NULL.",
  );
  assertEquals(s.risk, "review", "strong positive floored at review, never likely_safe");
  assertEquals(s.confidence, 0.8);
});

Deno.test("scoreKeywords matches 'now default to' wording variants (BuildKit)", () => {
  const s = scoreKeywords("All image results now default to using OCI media types");
  assertEquals(s.risk, "review");
  assertEquals(s.confidence, 0.4);
});
