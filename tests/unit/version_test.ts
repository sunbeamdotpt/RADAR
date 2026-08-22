import { assertEquals } from "jsr:@std/assert@^1";
import {
  compareTuples,
  isNewer,
  normalizeVersion,
  versionTuple,
} from "../../src/domain/version.ts";

Deno.test("normalizeVersion strips leading v", () => {
  assertEquals(normalizeVersion("v1.2.3"), "1.2.3");
  assertEquals(normalizeVersion("V1.2.3"), "1.2.3");
  assertEquals(normalizeVersion("1.2.3"), "1.2.3");
});

Deno.test("normalizeVersion strips curl- prefix", () => {
  assertEquals(normalizeVersion("curl-8_9_1"), "8.9.1");
  assertEquals(normalizeVersion("curl-8.9.1"), "8.9.1");
});

Deno.test("normalizeVersion converts underscores to dots", () => {
  assertEquals(normalizeVersion("8_9_1"), "8.9.1");
});

Deno.test("normalizeVersion keeps only leading numeric semver", () => {
  assertEquals(normalizeVersion("1.2.3-rc1"), "1.2.3");
  assertEquals(normalizeVersion("18.1-system-trixie"), "18.1");
  assertEquals(normalizeVersion("v2.41.1-sunbeam.12"), "2.41.1");
  assertEquals(normalizeVersion("8-alpine"), "8");
});

Deno.test("normalizeVersion trims whitespace", () => {
  assertEquals(normalizeVersion("  v1.0.0  "), "1.0.0");
});

Deno.test("normalizeVersion returns input when no leading numerics", () => {
  assertEquals(normalizeVersion("stable"), "stable");
  assertEquals(normalizeVersion("abc"), "abc");
});

Deno.test("versionTuple parses dotted numerics", () => {
  assertEquals(versionTuple("1.2.3"), [1, 2, 3]);
  assertEquals(versionTuple("v1.19.4"), [1, 19, 4]);
  assertEquals(versionTuple("3"), [3]);
});

Deno.test("versionTuple falls back to (0,) for non-numeric", () => {
  assertEquals(versionTuple("latest"), [0]);
  assertEquals(versionTuple(""), [0]);
  assertEquals(versionTuple("stable"), [0]);
});

Deno.test("versionTuple stops at first non-numeric part", () => {
  assertEquals(versionTuple("1.2.x"), [1, 2]);
});

Deno.test("compareTuples matches Python tuple semantics", () => {
  assertEquals(compareTuples([1, 2], [1, 2]) === 0, true);
  assertEquals(compareTuples([1, 3], [1, 2]) > 0, true);
  assertEquals(compareTuples([1, 2], [1, 2, 0]) < 0, true);
  assertEquals(compareTuples([2], [1, 9, 9]) > 0, true);
  assertEquals(compareTuples([0], [0, 1]) < 0, true);
});

Deno.test("isNewer detects upgrades", () => {
  assertEquals(isNewer("v1.20.0", "v1.19.4"), true);
  assertEquals(isNewer("1.11.2", "1.11.1"), true);
  assertEquals(isNewer("v2.0.0", "v10.0.0"), false);
});

Deno.test("isNewer rejects equal and older", () => {
  assertEquals(isNewer("v1.19.4", "v1.19.4"), false);
  assertEquals(isNewer("1.10.0", "1.11.1"), false);
});

Deno.test("isNewer rejects floating/unknown values on either side", () => {
  for (const v of ["", "n/a", "N/A", "unknown", "latest", "stable", "floating"]) {
    assertEquals(isNewer(v, "1.2.3"), false, `latest=${v}`);
    assertEquals(isNewer("1.2.3", v), false, `current=${v}`);
  }
});

Deno.test("isNewer handles curl-style tags", () => {
  assertEquals(isNewer("curl-8_10_1", "8.9.1"), true);
});
