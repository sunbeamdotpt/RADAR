import type { ComponentRecord } from "../schema/component.ts";
import type { HttpClient } from "../sources/http.ts";

/**
 * Release-note fetching for the assessor.
 *
 * Resolves the component's link_template against the latest version, prefers
 * the GitHub releases API (structured `body`) for github.com links, and skips
 * registries that don't publish text notes (Docker Hub, OCI registries).
 * Failures are soft: no notes is a normal outcome, not an error.
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

const NO_NOTES_HOSTS = /hub\.docker\.com|ghcr\.io|quay\.io|oci\.|src\.|registry\./i;

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

export async function fetchReleaseNotes(
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
