import { normalizeVersion } from "../domain/version.ts";

/**
 * Version parsing for the assessor. Reuses the inventory's normalization
 * (strip ^v/^curl-, `_`→`.`) and adds multi-tag support: strings like
 * "8.9.1 / 8.10.1 / latest" resolve to the first parseable token.
 */

export interface Semver {
  major: number;
  minor: number;
  patch: number;
}

/** True when both versions parse and resolve to the same semver triple. */
export function isVersionMatch(a: string, b: string): boolean {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (!x || !y) return false;
  return x.major === y.major && x.minor === y.minor && x.patch === y.patch;
}
export function parseSemver(tag: string): Semver | null {
  for (const part of tag.split("/")) {
    const norm = normalizeVersion(part.trim());
    const m = norm.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
    if (m) {
      return {
        major: parseInt(m[1], 10),
        minor: parseInt(m[2] ?? "0", 10),
        patch: parseInt(m[3] ?? "0", 10),
      };
    }
  }
  return null;
}

const FLOATING_TAGS = new Set(["latest", "stable", "main", "master", "nightly", "edge"]);

export function isFloatingTag(tag: string): boolean {
  return FLOATING_TAGS.has(tag.toLowerCase());
}

const PRERELEASE_WORDS = new Set(["rc", "beta", "alpha", "pre", "dev", "snapshot"]);

/**
 * Detect custom-fork suffixes like "-sunbeam.12". Prerelease identifiers
 * ("-rc.1", "-beta.2") are explicitly not forks.
 */
export function detectForkSuffix(tag: string): string | null {
  const m = tag.match(/-([a-z]+)\.(\d+)$/i);
  if (!m) return null;
  if (PRERELEASE_WORDS.has(m[1].toLowerCase())) return null;
  return m[1];
}

const FALSE_POSITIVE_SUFFIXES: RegExp[] = [
  /_large_disk_[a-z0-9]+/i,
  /-debug$/i,
  /-distroless$/i,
  /-slim$/i,
  /-experimental$/i,
  /-backup-[a-f0-9]{8,}-[a-z]+/i,
  /[a-z]+-[a-f0-9]{8,}-[a-z]+$/i,
];

/**
 * Heuristic: the "latest" tag looks like a build variant rather than a release
 * (e.g. "4.43_large_disk_rocksdb"). Only fires when `current` is a clean
 * numeric tag — a suffixed current means variants are normal here.
 */
export function isFalsePositiveTag(current: string, latest: string): boolean {
  if (/[-_][a-z]/i.test(current)) return false;
  return FALSE_POSITIVE_SUFFIXES.some((p) => p.test(latest));
}
