/**
 * Version comparison logic — exact port of the Python functions
 * normalize_version / version_tuple / is_newer from component-version-inventory.py.
 */

/** Versions that never count as "newer" (floating or unknown). */
const NON_CONCRETE = new Set(["n/a", "unknown", "latest", "stable", "floating"]);

/** Strip leading 'v', 'curl-' prefixes, convert '_' to '.', keep leading numeric semver. */
export function normalizeVersion(v: string): string {
  let out = v.trim();
  out = out.replace(/^v/i, "");
  out = out.replace(/^curl-/i, "");
  out = out.replace(/_/g, ".");
  const m = out.match(/^(\d+(?:\.\d+)*)/);
  return m ? m[1] : out;
}

/** Convert a version string to a numeric tuple; (0,) when nothing numeric is found. */
export function versionTuple(v: string): number[] {
  const norm = normalizeVersion(v);
  const parts: number[] = [];
  for (const p of norm.split(".")) {
    if (!/^\d+$/.test(p)) break;
    parts.push(parseInt(p, 10));
  }
  return parts.length > 0 ? parts : [0];
}

/** Python tuple comparison: element-wise, then shorter < longer on shared prefix. */
export function compareTuples(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

/** True when `latest` is a concrete version strictly newer than `current`. */
export function isNewer(latest: string, current: string): boolean {
  if (!latest || NON_CONCRETE.has(latest.toLowerCase())) return false;
  if (!current || NON_CONCRETE.has(current.toLowerCase())) return false;
  return compareTuples(versionTuple(latest), versionTuple(current)) > 0;
}
