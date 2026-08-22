import type { Component } from "../schema/component.ts";
import type { HttpClient } from "./http.ts";
import { formatTemplate, stringField } from "./util.ts";

/** Latest release of a GitHub repository (api.github.com/repos/{upstream}/releases/latest). */
export async function fetchGithubRelease(
  component: Component,
  http: HttpClient,
  token?: string,
): Promise<void> {
  const data = await http.json(
    `https://api.github.com/repos/${component.upstream}/releases/latest`,
    token,
  );
  const tag = stringField(data, "tag_name", "n/a");
  let link = stringField(data, "html_url", "");
  if (component.link_template) {
    link = formatTemplate(component.link_template, { tag });
  }
  component.latest = tag;
  component.latest_link = link;
}

/** Most recent tag of a GitHub repository (api.github.com/repos/{upstream}/tags?per_page=1). */
export async function fetchGithubTags(
  component: Component,
  http: HttpClient,
  token?: string,
): Promise<void> {
  const data = await http.json(
    `https://api.github.com/repos/${component.upstream}/tags?per_page=1`,
    token,
  );
  if (Array.isArray(data) && data.length > 0) {
    const tag = stringField(data[0], "name", "n/a");
    component.latest = tag;
    component.latest_link = `https://github.com/${component.upstream}/releases/tag/${tag}`;
    return;
  }
  component.latest = "n/a";
  component.latest_link = "";
}
