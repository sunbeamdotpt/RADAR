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

export async function fetchReleaseNotes(
  comp: ComponentRecord,
  http: HttpClient,
  token?: string,
): Promise<string> {
  const url = resolveUrl(comp.link_template, comp);
  if (!url) return "";
  if (NO_NOTES_HOSTS.test(url)) return "";

  const apiUrl = githubApiUrl(url);
  if (apiUrl) {
    try {
      const data = await http.json(apiUrl, token);
      if (typeof data === "object" && data !== null) {
        const body = (data as Record<string, unknown>).body;
        if (typeof body === "string" && body) return body;
      }
    } catch {
      // fall through to the plain URL
    }
  }
  try {
    return await http.text(url);
  } catch {
    return "";
  }
}
