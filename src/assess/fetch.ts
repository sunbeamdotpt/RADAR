import type { ComponentRecord } from "../schema/component.ts";
import type { HttpClient } from "../sources/http.ts";
import { parseSemver } from "./version.ts";

/**
 * Release-note fetching for the assessor.
 *
 * Resolves the component's link_template against the latest version, prefers
 * the GitHub releases API (structured `body`) for github.com links, and skips
 * registries that don't publish text notes (Docker Hub, OCI registries).
 *
 * For GitHub releases, when `current` and `latest` are both parseable and
 * drifted, the fetcher asks for the recent release list and concatenates the
 * bodies of releases strictly between the two versions. This catches breaking
 * changes announced in intermediate releases (e.g. v1.12.0 when latest is
 * v1.12.1). Failures are soft: no notes is a normal outcome, not an error.
 */

/** Resolve {tag}/{version}/{app_version} placeholders against the latest version. */
export function resolveUrl(template: string, comp: ComponentRecord): string | null {
  if (!template) return null;
  const latest = comp.latest || "";
  const current = comp.current || "";
  const version = latest && latest !== "unknown" && latest !== "error" ? latest : current;
  if (!version) return null;
  const versionNoV = version.replace(/^v/i, "");
  return template
    .replaceAll("{tag}", version)
    .replaceAll("{version}", versionNoV)
    .replaceAll("{app_version}", versionNoV);
}

/** github.com release pages map to the releases API for a structured body. */
export function githubApiUrl(url: string): string | null {
  if (!url.includes("github.com")) return null;
  const api = url.replace("github.com", "api.github.com/repos").replace(
    "/releases/tag/",
    "/releases/tags/",
  );
  return api !== url && api.includes("api.github.com/repos/") ? api : null;
}

/**
 * Toggle a leading "v" on the tag segment of a github release URL
 * (`…/releases/tag/1.2.3` ↔ `…/releases/tag/v1.2.3`). Seed templates can't
 * know a repo's tagging convention, and a wrong guess 404s silently.
 */
export function toggleTagV(url: string): string | null {
  const m = url.match(/^(.*\/releases\/tags?\/)([^/]+)$/);
  if (!m) return null;
  const [, prefix, tag] = m;
  return prefix + (tag.startsWith("v") ? tag.slice(1) : `v${tag}`);
}

/** True when a component has a resolvable, text-bearing link to fetch notes from. */
export function releaseNotesFetchable(comp: ComponentRecord): boolean {
  const url = resolveUrl(comp.link_template, comp);
  return url !== null && !NO_NOTES_HOSTS.test(url);
}

const NO_NOTES_HOSTS = /hub\.docker\.com|ghcr\.io|quay\.io|oci\.|src\.|registry\./i;

/** Parse `owner/repo` out of a github release page URL. */
function githubRepoFromReleaseUrl(url: string): { owner: string; repo: string } | null {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/releases(?:\/|$)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

/** Compare two parsed semvers numerically. */
function compareSemver(
  a: { major: number; minor: number; patch: number },
  b: { major: number; minor: number; patch: number },
): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

const RANGE_NOTES_CAP = 200_000;
const RANGE_PAGE_SIZE = 100;

async function fetchRangeNotes(
  comp: ComponentRecord,
  http: HttpClient,
  token?: string,
): Promise<string> {
  const url = resolveUrl(comp.link_template, comp);
  if (!url || NO_NOTES_HOSTS.test(url)) return "";

  const repo = githubRepoFromReleaseUrl(url);
  if (!repo) return "";

  const cur = parseSemver(comp.current);
  const lat = parseSemver(comp.latest);
  if (!cur || !lat || compareSemver(lat, cur) <= 0) return "";

  const listUrl =
    `https://api.github.com/repos/${repo.owner}/${repo.repo}/releases?per_page=${RANGE_PAGE_SIZE}`;
  let releases: unknown;
  try {
    releases = await http.json(listUrl, token);
  } catch {
    return "";
  }
  if (!Array.isArray(releases)) return "";

  const pieces: string[] = [];
  let size = 0;

  for (const rel of releases) {
    if (!rel || typeof rel !== "object") continue;
    if ((rel as Record<string, unknown>).draft) continue;
    if ((rel as Record<string, unknown>).prerelease) continue;

    const tag = (rel as Record<string, unknown>).tag_name;
    if (typeof tag !== "string") continue;

    const sv = parseSemver(tag);
    if (!sv) continue;
    if (compareSemver(sv, cur) <= 0 || compareSemver(sv, lat) >= 0) continue;

    const body = (rel as Record<string, unknown>).body;
    const text = typeof body === "string" ? body : "";
    if (!text) continue;

    const piece = `# ${tag}\n${text}`;
    if (size + piece.length > RANGE_NOTES_CAP) {
      pieces.push(
        `# _truncated_\nRelease notes capped at ${RANGE_NOTES_CAP} characters; run fetched a larger gap than this.`,
      );
      break;
    }
    pieces.push(piece);
    size += piece.length + 1; // +1 for the joining newline
  }

  return pieces.join("\n");
}

export async function fetchReleaseNotes(
  comp: ComponentRecord,
  http: HttpClient,
  token?: string,
): Promise<string> {
  // Try to read notes across the whole version gap first. If that yields
  // nothing, fall back to the single latest release (keeps behavior for
  // non-GitHub sources and gaps with no intermediate releases).
  const rangeNotes = await fetchRangeNotes(comp, http, token);
  if (rangeNotes) return rangeNotes;

  const url = resolveUrl(comp.link_template, comp);
  if (!url) return "";
  if (NO_NOTES_HOSTS.test(url)) return "";

  // Try the resolved URL first, then the v-toggled tag variant (repos differ
  // on whether release tags carry the "v" prefix; a wrong guess 404s).
  const candidates = [url];
  const toggled = toggleTagV(url);
  if (toggled) candidates.push(toggled);

  for (const candidate of candidates) {
    const apiUrl = githubApiUrl(candidate);
    if (apiUrl) {
      try {
        const data = await http.json(apiUrl, token);
        if (typeof data === "object" && data !== null) {
          const body = (data as Record<string, unknown>).body;
          if (typeof body === "string" && body) return body;
        }
      } catch {
        // fall through to the plain URL for this candidate
      }
    }
    try {
      const text = await http.text(candidate);
      if (text) return text;
    } catch {
      // try the next candidate
    }
  }
  return "";
}
