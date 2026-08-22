import { compareTuples, versionTuple } from "../domain/version.ts";
import type { Component } from "../schema/component.ts";
import type { HttpClient } from "./http.ts";
import { formatTemplate, stringField } from "./util.ts";

/** Rolling tags that never count as a newest release. */
const ROLLING_TAGS = new Set(["latest", "stable", "main", "master", "dev", "unstable", "nightly"]);

/** Python: re.match(r"^v?\d", name, re.I) */
function startsLikeSemver(name: string): boolean {
  return /^v?\d/i.test(name);
}

/** Python: re.search(r"(windows|nanoserver|ltsc|rc|beta|alpha|dev|unstable)", name, re.I) */
function isPrereleaseOrPlatform(name: string): boolean {
  return /(windows|nanoserver|ltsc|rc|beta|alpha|dev|unstable)/i.test(name);
}

/** Python: re.fullmatch(r"[0-9a-f]{20,}", name, re.I) — long commit-hash tags. */
function isCommitHashTag(name: string): boolean {
  return /^[0-9a-f]{20,}$/i.test(name);
}

/** Newest semver-ish tag from Docker Hub, ignoring rolling/prerelease/hash tags. */
export async function fetchDockerHub(component: Component, http: HttpClient): Promise<void> {
  const url =
    `https://hub.docker.com/v2/repositories/${component.upstream}/tags?page_size=100&ordering=last_updated`;
  const data = await http.json(url);
  const results = typeof data === "object" && data !== null
    ? (data as Record<string, unknown>).results
    : undefined;
  const tags: string[] = [];
  if (Array.isArray(results)) {
    for (const result of results) {
      const name = stringField(result, "name", "");
      if (!name || ROLLING_TAGS.has(name.toLowerCase())) continue;
      if (!startsLikeSemver(name)) continue;
      if (isPrereleaseOrPlatform(name)) continue;
      if (isCommitHashTag(name)) continue;
      tags.push(name);
    }
  }
  if (tags.length === 0) {
    component.latest = "n/a";
    component.latest_link = "";
    return;
  }
  // Python: max(tags, key=lambda t: (version_tuple(t), t)) — first max wins on ties.
  let latest = tags[0];
  for (const tag of tags.slice(1)) {
    const cmp = compareTuples(versionTuple(tag), versionTuple(latest));
    if (cmp > 0 || (cmp === 0 && tag > latest)) {
      latest = tag;
    }
  }
  component.latest = latest;
  component.latest_link = formatTemplate(component.link_template, { tag: latest });
}
