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
 * drifted, the fetcher walks the release list (paginated, newest first) and
 * concatenates the bodies of all releases in the gap — including the latest
 * release itself, whose notes are where breaking changes for small patch
 * drifts are announced. When the walk missed the endpoint (tag-scheme
 * mismatch, pagination cut), the endpoint's notes are fetched on their own.
 * Checksum-only pages carry no signal and are treated as empty. Failures are
 * soft: no notes is a normal outcome, not an error.
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
const RANGE_MAX_PAGES = 5;

export interface RangeNotes {
  notes: string;
  /** True when the gap walk included the latest release's own notes. */
  endpointIncluded: boolean;
}

async function fetchRangeNotes(
  comp: ComponentRecord,
  http: HttpClient,
  token?: string,
): Promise<RangeNotes> {
  const none: RangeNotes = { notes: "", endpointIncluded: false };
  const url = resolveUrl(comp.link_template, comp);
  if (!url || NO_NOTES_HOSTS.test(url)) return none;

  const repo = githubRepoFromReleaseUrl(url);
  if (!repo) return none;

  const cur = parseSemver(comp.current);
  const lat = parseSemver(comp.latest);
  if (!cur || !lat || compareSemver(lat, cur) <= 0) return none;

  const pieces: string[] = [];
  let size = 0;
  let endpointIncluded = false;
  let reachedCurrent = false;
  let capped = false;

  // Releases come back most-recent-first; walk pages until the list runs
  // short or we pass `current` (everything beyond is older than the gap).
  for (let page = 1; page <= RANGE_MAX_PAGES && !reachedCurrent && !capped; page++) {
    const listUrl =
      `https://api.github.com/repos/${repo.owner}/${repo.repo}/releases?per_page=${RANGE_PAGE_SIZE}&page=${page}`;
    let releases: unknown;
    try {
      releases = await http.json(listUrl, token);
    } catch {
      break; // soft-fail: keep whatever earlier pages yielded
    }
    if (!Array.isArray(releases)) break;

    for (const rel of releases) {
      if (!rel || typeof rel !== "object") continue;
      if ((rel as Record<string, unknown>).draft) continue;
      if ((rel as Record<string, unknown>).prerelease) continue;

      const tag = (rel as Record<string, unknown>).tag_name;
      if (typeof tag !== "string") continue;

      const sv = parseSemver(tag);
      if (!sv) continue;
      if (compareSemver(sv, cur) <= 0) {
        reachedCurrent = true; // older than the gap; later pages only get older
        continue;
      }
      if (compareSemver(sv, lat) > 0) continue; // newer than latest: outside the gap
      if (compareSemver(sv, lat) === 0) endpointIncluded = true;

      const body = (rel as Record<string, unknown>).body;
      const text = typeof body === "string" ? body : "";
      if (!text) continue;

      const piece = `# ${tag}\n${text}`;
      if (size + piece.length > RANGE_NOTES_CAP) {
        pieces.push(
          `# _truncated_\nRelease notes capped at ${RANGE_NOTES_CAP} characters; run fetched a larger gap than this.`,
        );
        capped = true;
        break;
      }
      pieces.push(piece);
      size += piece.length + 1; // +1 for the joining newline
    }
    if (releases.length < RANGE_PAGE_SIZE) break;
  }

  return { notes: pieces.join("\n"), endpointIncluded };
}

/** Long hex runs dominate checksum-only release pages (e.g. cri-tools). */
const HEX_RUN = /[a-f0-9]{32,}/gi;

/**
 * Checksum-only release notes carry no upgrade signal but would otherwise read
 * as "notes fetched, nothing found". Treat pages that are mostly hex digests
 * as empty so the caller's notes-unavailable handling kicks in — silence from
 * a checksum page is not safety either.
 */
export function isSubstantiveNotes(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  let hexChars = 0;
  for (const m of trimmed.matchAll(HEX_RUN)) hexChars += m[0].length;
  return hexChars / trimmed.length < 0.5;
}

/** Fetch the notes of the single latest release (API body, then plain text). */
async function fetchEndpointNotes(
  comp: ComponentRecord,
  http: HttpClient,
  token?: string,
): Promise<string> {
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

export async function fetchReleaseNotes(
  comp: ComponentRecord,
  http: HttpClient,
  token?: string,
): Promise<string> {
  const range = await fetchRangeNotes(comp, http, token);
  const endpoint = range.endpointIncluded ? "" : await fetchEndpointNotes(comp, http, token);
  const combined = endpoint && range.notes
    ? `${endpoint}\n${range.notes}`
    : endpoint || range.notes;
  return isSubstantiveNotes(combined) ? combined : "";
}
