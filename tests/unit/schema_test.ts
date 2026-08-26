import { assertEquals, assertThrows } from "jsr:@std/assert@^1";
import {
  parseReportComponent,
  parseReportDocument,
  parseSeedComponent,
  parseSeedDocument,
  SchemaError,
  serializeReport,
  toRecord,
} from "../../src/schema/component.ts";
import {
  DryRunSchemaError,
  parseDryRun,
  parseDryRunReport,
  parseDryRunStatus,
} from "../../src/schema/dryrun.ts";
import { DEFAULT_DOMAIN_SUFFIX, normalizeDomainSuffix } from "../../src/domain/domain_suffix.ts";
import { formatGeneratedAtUtc } from "../../src/domain/time.ts";

const validSeed = {
  name: "Cert-manager",
  namespace: "cert-manager",
  current: "v1.19.4",
  source: "helm_chart",
  upstream: "https://charts.jetstack.io::cert-manager",
  chart_version: "v1.19.4",
  track_app_version: true,
  link_template: "https://github.com/cert-manager/cert-manager/releases/tag/{app_version}",
  notes: "Helm chart 1.19.4",
};

Deno.test("parseSeedComponent accepts a full valid entry", () => {
  const c = parseSeedComponent(validSeed, 0);
  assertEquals(c.name, "Cert-manager");
  assertEquals(c.track_app_version, true);
  assertEquals(c.latest, "");
  assertEquals(c.update_available, false);
  assertEquals(c.cached, false);
});

Deno.test("parseSeedComponent fills defaults for optional keys", () => {
  const c = parseSeedComponent(
    {
      name: "CFSSL",
      namespace: "cert-manager",
      current: "v1.6.5",
      source: "github_release",
      upstream: "cloudflare/cfssl",
    },
    0,
  );
  assertEquals(c.link_template, "");
  assertEquals(c.notes, "");
  assertEquals(c.chart_version, "");
  assertEquals(c.track_app_version, false);
});

Deno.test("parseSeedComponent coerces YAML numeric scalars to strings", () => {
  const c = parseSeedComponent(
    {
      name: "OpenSearch",
      namespace: "data",
      current: 3,
      source: "github_release",
      upstream: "opensearch-project/OpenSearch",
    },
    0,
  );
  assertEquals(c.current, "3");
});

Deno.test("parseSeedComponent rejects unknown keys (Python Component(**item) strictness)", () => {
  assertThrows(
    () => parseSeedComponent({ ...validSeed, bogus: 1 }, 0),
    SchemaError,
    'unknown key "bogus"',
  );
});

Deno.test("parseSeedComponent rejects missing required keys", () => {
  const { upstream: _omit, ...rest } = validSeed;
  assertThrows(() => parseSeedComponent(rest, 2), SchemaError, 'missing required key "upstream"');
});

Deno.test("parseSeedComponent rejects invalid source", () => {
  assertThrows(
    () => parseSeedComponent({ ...validSeed, source: "pypi" }, 0),
    SchemaError,
    '"source" must be one of',
  );
});

Deno.test("parseSeedComponent rejects wrong types", () => {
  assertThrows(
    () => parseSeedComponent({ ...validSeed, name: { nested: true } }, 0),
    SchemaError,
    '"name" must be a string',
  );
  assertThrows(
    () => parseSeedComponent({ ...validSeed, track_app_version: "yes" }, 0),
    SchemaError,
    '"track_app_version" must be a boolean',
  );
});

Deno.test("parseSeedComponent accepts every documented source", () => {
  for (
    const source of [
      "github_release",
      "github_tags",
      "helm_chart",
      "docker_hub",
      "static",
      "custom",
    ]
  ) {
    const c = parseSeedComponent({ ...validSeed, source }, 0);
    assertEquals(c.source, source);
  }
});

Deno.test("parseSeedDocument requires a components list", () => {
  assertThrows(() => parseSeedDocument({}), SchemaError, '"components" list');
  assertThrows(() => parseSeedDocument([1, 2]), SchemaError, "must be a mapping");
  const components = parseSeedDocument({ components: [validSeed] });
  assertEquals(components.length, 1);
});

Deno.test("toRecord emits keys in Python order and helm extras only for helm_chart", () => {
  const helm = parseSeedComponent(validSeed, 0);
  helm.latest = "v1.20.0";
  helm.update_available = true;
  const helmKeys = Object.keys(toRecord(helm));
  assertEquals(helmKeys, [
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

  const gh = parseSeedComponent(
    {
      name: "CFSSL",
      namespace: "cert-manager",
      current: "v1.6.5",
      source: "github_release",
      upstream: "cloudflare/cfssl",
    },
    0,
  );
  const ghKeys = Object.keys(toRecord(gh));
  assertEquals(ghKeys, [
    "name",
    "namespace",
    "current",
    "latest",
    "source",
    "upstream",
    "link_template",
    "notes",
    "update_available",
  ]);
});

Deno.test("serializeReport matches Python json.dumps shape", () => {
  const c = parseSeedComponent(validSeed, 0);
  const out = serializeReport([c], "2026-08-21 12:00:00 UTC");
  const parsed = JSON.parse(out);
  assertEquals(parsed.generated_at, "2026-08-21 12:00:00 UTC");
  assertEquals(parsed.components.length, 1);
  assertEquals(out.startsWith('{\n  "generated_at":'), true);
});

Deno.test("parseReportComponent round-trips a record and keeps latest", () => {
  const c = parseSeedComponent(validSeed, 0);
  c.latest = "v1.20.0";
  c.update_available = true;
  const parsed = parseReportComponent(JSON.parse(JSON.stringify(toRecord(c))), 0);
  assertEquals(parsed.latest, "v1.20.0");
  assertEquals(parsed.update_available, true);
});

Deno.test("parseReportComponent rejects unknown keys and missing latest", () => {
  const record = JSON.parse(JSON.stringify(toRecord(parseSeedComponent(validSeed, 0))));
  assertThrows(
    () => parseReportComponent({ ...record, extra: 1 }, 0),
    SchemaError,
    'unknown key "extra"',
  );
  const { latest: _omit, ...rest } = record;
  assertThrows(() => parseReportComponent(rest, 0), SchemaError, 'missing required key "latest"');
});

Deno.test("parseReportDocument validates the envelope", () => {
  const c = parseSeedComponent(validSeed, 0);
  const report = JSON.parse(serializeReport([c], "2026-08-21 12:00:00 UTC"));
  const parsed = parseReportDocument(report);
  assertEquals(parsed.generated_at, "2026-08-21 12:00:00 UTC");
  assertEquals(parsed.components.length, 1);
  assertThrows(() => parseReportDocument({ components: [] }), SchemaError, "generated_at");
  assertThrows(() => parseReportDocument({ generated_at: "x" }), SchemaError, '"components" array');
});

Deno.test("normalizeDomainSuffix replaces all occurrences", () => {
  assertEquals(
    normalizeDomainSuffix("src.DOMAIN_SUFFIX/studio/sol", "example.com"),
    "src.example.com/studio/sol",
  );
  assertEquals(normalizeDomainSuffix("DOMAIN_SUFFIX", DEFAULT_DOMAIN_SUFFIX), "sunbeam.pt");
  assertEquals(normalizeDomainSuffix("a.DOMAIN_SUFFIX.b.DOMAIN_SUFFIX", "x.io"), "a.x.io.b.x.io");
  assertEquals(
    normalizeDomainSuffix("ghcr.io/sunbeamdotpt/doc", "x.io"),
    "ghcr.io/sunbeamdotpt/doc",
  );
});

Deno.test("formatGeneratedAtUtc matches strftime '%Y-%m-%d %H:%M:%S UTC'", () => {
  const d = new Date(Date.UTC(2026, 7, 21, 9, 5, 3));
  assertEquals(formatGeneratedAtUtc(d), "2026-08-21 09:05:03 UTC");
});

Deno.test("parseDryRun validates dry-run records", () => {
  const valid = {
    namespace: "longhorn-system",
    components: ["Longhorn"],
    status: "success",
    stdout: "service/longhorn created (dry-run)",
    stderr: "",
    duration_ms: 1234,
    details: { build_exit_code: 0 },
  };
  const parsed = parseDryRun(valid, 0);
  assertEquals(parsed.namespace, "longhorn-system");
  assertEquals(parsed.components, ["Longhorn"]);
  assertEquals(parsed.status, "success");

  assertThrows(() => parseDryRun({ ...valid, status: "boom" }, 0), DryRunSchemaError, "status");
  assertThrows(
    () => parseDryRun({ ...valid, bogus: 1 }, 0),
    DryRunSchemaError,
    'unknown key "bogus"',
  );
  assertThrows(
    () => parseDryRun({ ...valid, duration_ms: "lots" }, 0),
    DryRunSchemaError,
    "number",
  );
  const { details: _omit, ...noDetails } = valid;
  assertEquals(parseDryRun(noDetails, 0).details, {});
});

Deno.test("parseDryRunReport validates the envelope", () => {
  const valid = {
    generated_at: "2026-08-21 12:00:00 UTC",
    inventory_generated_at: "2026-08-21 11:00:00 UTC",
    assessment_generated_at: "2026-08-21 11:30:00 UTC",
    dry_runs: [{
      namespace: "longhorn-system",
      components: ["Longhorn"],
      status: "success",
      stdout: "",
      stderr: "",
      duration_ms: 0,
      details: {},
    }],
  };
  assertEquals(parseDryRunReport(valid).dry_runs.length, 1);
  assertThrows(() => parseDryRunReport({}), DryRunSchemaError, "generated_at");
  assertThrows(
    () => parseDryRunReport({ generated_at: "x" }),
    DryRunSchemaError,
    "inventory_generated_at",
  );
  assertThrows(
    () => parseDryRunReport({ generated_at: "x", inventory_generated_at: "y" }),
    DryRunSchemaError,
    "assessment_generated_at",
  );
  assertThrows(
    () =>
      parseDryRunReport({
        generated_at: "x",
        inventory_generated_at: "y",
        assessment_generated_at: "z",
      }),
    DryRunSchemaError,
    "dry_runs",
  );
});

Deno.test("parseDryRunStatus accepts all documented statuses", () => {
  for (
    const status of [
      "success",
      "build_failed",
      "dryrun_failed",
      "skipped_no_mapping",
      "skipped_unsupported_source",
    ]
  ) {
    assertEquals(parseDryRunStatus(status, "test"), status);
  }
});
