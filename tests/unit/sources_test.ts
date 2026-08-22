import { assertEquals, assertRejects } from "jsr:@std/assert@^1";
import type { Component } from "../../src/schema/component.ts";
import { parseSeedComponent } from "../../src/schema/component.ts";
import { OfflineHttpClient } from "../../src/sources/http.ts";
import type { HttpClient } from "../../src/sources/http.ts";
import { fetchGithubRelease, fetchGithubTags } from "../../src/sources/github.ts";
import { fetchHelmChart } from "../../src/sources/helm_chart.ts";
import { fetchDockerHub } from "../../src/sources/docker_hub.ts";
import { fetchStatic, fetchUnknown } from "../../src/sources/static.ts";
import { formatTemplate, stringField, stripChars } from "../../src/sources/util.ts";

class StubHttp implements HttpClient {
  constructor(
    private readonly jsonResponses: Record<string, unknown> = {},
    private readonly textResponses: Record<string, string> = {},
  ) {}
  json(url: string): Promise<unknown> {
    if (url in this.jsonResponses) return Promise.resolve(this.jsonResponses[url]);
    return Promise.reject(new Error(`no json stub for ${url}`));
  }
  text(url: string): Promise<string> {
    if (url in this.textResponses) return Promise.resolve(this.textResponses[url]);
    return Promise.reject(new Error(`no text stub for ${url}`));
  }
}

function makeComponent(overrides: Record<string, unknown>): Component {
  return parseSeedComponent(
    {
      name: "x",
      namespace: "ns",
      current: "1.0.0",
      source: "github_release",
      upstream: "org/repo",
      ...overrides,
    },
    0,
  );
}

// --- util ---

Deno.test("stripChars behaves like Python str.strip(chars)", () => {
  assertEquals(stripChars("; could not resolve", "; "), "could not resolve");
  assertEquals(stripChars("notes; could not resolve", "; "), "notes; could not resolve");
  assertEquals(stripChars(";;  x  ;;", "; "), "x");
});

Deno.test("formatTemplate replaces provided keys only", () => {
  assertEquals(formatTemplate("https://x/{tag}", { tag: "v1" }), "https://x/v1");
  assertEquals(
    formatTemplate("{version}/{app_version}", { version: "1", app_version: "2" }),
    "1/2",
  );
  assertEquals(formatTemplate("no placeholders", { tag: "v1" }), "no placeholders");
});

Deno.test("stringField falls back on non-strings", () => {
  assertEquals(stringField({ a: "x" }, "a", "d"), "x");
  assertEquals(stringField({ a: 3 }, "a", "d"), "d");
  assertEquals(stringField(null, "a", "d"), "d");
  assertEquals(stringField({}, "missing", "d"), "d");
});

// --- github_release ---

Deno.test("github_release uses tag_name and formats link_template", async () => {
  const c = makeComponent({ link_template: "https://github.com/org/repo/releases/tag/{tag}" });
  const http = new StubHttp({
    "https://api.github.com/repos/org/repo/releases/latest": {
      tag_name: "v2.0.0",
      html_url: "https://github.com/org/repo/releases/tag/v2.0.0",
    },
  });
  await fetchGithubRelease(c, http, "token");
  assertEquals(c.latest, "v2.0.0");
  assertEquals(c.latest_link, "https://github.com/org/repo/releases/tag/v2.0.0");
});

Deno.test("github_release falls back to n/a and html_url", async () => {
  const c = makeComponent({});
  const http = new StubHttp({
    "https://api.github.com/repos/org/repo/releases/latest": { html_url: "https://x" },
  });
  await fetchGithubRelease(c, http);
  assertEquals(c.latest, "n/a");
  assertEquals(c.latest_link, "https://x");
});

// --- github_tags ---

Deno.test("github_tags builds the release link from the first tag", async () => {
  const c = makeComponent({});
  const http = new StubHttp({
    "https://api.github.com/repos/org/repo/tags?per_page=1": [{ name: "v3.1.0" }],
  });
  await fetchGithubTags(c, http);
  assertEquals(c.latest, "v3.1.0");
  assertEquals(c.latest_link, "https://github.com/org/repo/releases/tag/v3.1.0");
});

Deno.test("github_tags returns n/a for empty tag list", async () => {
  const c = makeComponent({});
  const http = new StubHttp({ "https://api.github.com/repos/org/repo/tags?per_page=1": [] });
  await fetchGithubTags(c, http);
  assertEquals(c.latest, "n/a");
  assertEquals(c.latest_link, "");
});

// --- helm_chart ---

const INDEX = `
entries:
  cert-manager:
    - version: "1.18.0"
      appVersion: "v1.18.0"
    - version: "1.19.4"
      appVersion: "v1.19.4"
    - version: "1.20.0"
      appVersion: "v1.20.0"
`;

Deno.test("helm_chart resolves latest appVersion with track_app_version", async () => {
  const c = makeComponent({
    source: "helm_chart",
    upstream: "https://charts.jetstack.io::cert-manager",
    current: "v1.19.4",
    chart_version: "1.19.4",
    track_app_version: true,
    link_template: "https://github.com/cert-manager/cert-manager/releases/tag/{app_version}",
  });
  const http = new StubHttp({}, { "https://charts.jetstack.io/index.yaml": INDEX });
  await fetchHelmChart(c, http);
  assertEquals(c.latest, "v1.20.0");
  assertEquals(c.latest_link, "https://github.com/cert-manager/cert-manager/releases/tag/v1.20.0");
  // current is resolved from the pinned chart entry (appVersion of 1.19.4)
  assertEquals(c.current, "v1.19.4");
});

Deno.test("helm_chart without track_app_version reports the chart version", async () => {
  const c = makeComponent({
    source: "helm_chart",
    upstream: "https://prometheus-community.github.io/helm-charts::kube-prometheus-stack",
    current: "88.3.0",
    chart_version: "88.3.0",
    track_app_version: false,
    link_template: "https://x/{version}",
  });
  const index = `
entries:
  kube-prometheus-stack:
    - version: "88.3.0"
      appVersion: "0.90.0"
    - version: "90.0.1"
      appVersion: "0.91.0"
`;
  const http = new StubHttp({}, {
    "https://prometheus-community.github.io/helm-charts/index.yaml": index,
  });
  await fetchHelmChart(c, http);
  assertEquals(c.latest, "90.0.1");
  assertEquals(c.latest_link, "https://x/90.0.1");
  assertEquals(c.current, "88.3.0");
});

Deno.test("helm_chart resolves a v-prefixed index entry against an unprefixed pin", async () => {
  // The cert-manager case: the manifest pins "1.19.4", the jetstack index
  // publishes "v1.19.4". Helm treats versions as semver constraints; so do we.
  const c = makeComponent({
    source: "helm_chart",
    upstream: "https://charts.jetstack.io::cert-manager",
    current: "1.19.4",
    chart_version: "1.19.4",
    track_app_version: true,
    notes: "Helm chart 1.19.4",
  });
  const index = `
entries:
  cert-manager:
    - version: "v1.19.4"
      appVersion: "v1.19.4"
    - version: "v1.21.1"
      appVersion: "v1.21.1"
`;
  const http = new StubHttp({}, { "https://charts.jetstack.io/index.yaml": index });
  await fetchHelmChart(c, http);
  assertEquals(c.current, "v1.19.4");
  assertEquals(c.notes, "Helm chart 1.19.4", "no resolution note expected");
  assertEquals(c.latest, "v1.21.1");
});

Deno.test("helm_chart prefers an exact match over a normalized one", async () => {
  const c = makeComponent({
    source: "helm_chart",
    upstream: "https://x.io::chart",
    current: "1.0.0",
    chart_version: "1.0.0",
    track_app_version: true,
  });
  const index = `
entries:
  chart:
    - version: "v1.0.0"
      appVersion: "app-v"
    - version: "1.0.0"
      appVersion: "app-exact"
`;
  const http = new StubHttp({}, { "https://x.io/index.yaml": index });
  await fetchHelmChart(c, http);
  assertEquals(c.current, "app-exact");
});

Deno.test("helm_chart appends a note when the pinned chart is missing", async () => {
  const c = makeComponent({
    source: "helm_chart",
    upstream: "https://charts.jetstack.io::cert-manager",
    current: "v9.9.9",
    chart_version: "9.9.9",
    track_app_version: true,
    notes: "Helm chart 9.9.9",
  });
  const http = new StubHttp({}, { "https://charts.jetstack.io/index.yaml": INDEX });
  await fetchHelmChart(c, http);
  assertEquals(c.notes, "Helm chart 9.9.9; could not resolve appVersion for chart 9.9.9");
  assertEquals(c.latest, "v1.20.0");
});

Deno.test("helm_chart picks the greatest by version tuple, not list order", async () => {
  const c = makeComponent({
    source: "helm_chart",
    upstream: "https://x.io::chart",
    track_app_version: false,
  });
  const index = `
entries:
  chart:
    - version: "9.0.0"
    - version: "10.0.0"
    - version: "9.9.9"
`;
  const http = new StubHttp({}, { "https://x.io/index.yaml": index });
  await fetchHelmChart(c, http);
  assertEquals(c.latest, "10.0.0");
});

Deno.test("helm_chart returns n/a for unknown chart", async () => {
  const c = makeComponent({ source: "helm_chart", upstream: "https://x.io::missing" });
  const http = new StubHttp({}, { "https://x.io/index.yaml": "entries: {}" });
  await fetchHelmChart(c, http);
  assertEquals(c.latest, "n/a");
  assertEquals(c.latest_link, "");
});

Deno.test("helm_chart keeps repo URLs that already end in /index.yaml", async () => {
  const c = makeComponent({
    source: "helm_chart",
    upstream: "https://x.io/custom/index.yaml::chart",
    track_app_version: false,
  });
  const http = new StubHttp({}, {
    "https://x.io/custom/index.yaml": "entries:\n  chart:\n    - version: '1.0.0'\n",
  });
  await fetchHelmChart(c, http);
  assertEquals(c.latest, "1.0.0");
});

Deno.test("helm_chart rejects upstreams without :: separator", async () => {
  const c = makeComponent({ source: "helm_chart", upstream: "https://x.io" });
  const http = new StubHttp();
  await assertRejects(() => fetchHelmChart(c, http), Error, "invalid helm upstream");
});

// --- docker_hub ---

Deno.test("docker_hub filters rolling, prerelease, platform and hash tags", async () => {
  const c = makeComponent({
    source: "docker_hub",
    upstream: "scaleway/cert-manager-webhook-scaleway",
    link_template: "https://hub.docker.com/r/x/tags/{tag}",
  });
  const http = new StubHttp({
    "https://hub.docker.com/v2/repositories/scaleway/cert-manager-webhook-scaleway/tags?page_size=100&ordering=last_updated":
      {
        results: [
          { name: "latest" },
          { name: "stable" },
          { name: "nightly" },
          { name: "v0.2.0-rc1" },
          { name: "1.0.0-windowsservercore" },
          { name: "0123456789abcdef0123456789" },
          { name: "alpine" },
          { name: "v0.1.1" },
          { name: "v0.3.0" },
        ],
      },
  });
  await fetchDockerHub(c, http);
  assertEquals(c.latest, "v0.3.0");
  assertEquals(c.latest_link, "https://hub.docker.com/r/x/tags/v0.3.0");
});

Deno.test("docker_hub prefers higher version tuples over lexical order", async () => {
  const c = makeComponent({ source: "docker_hub", upstream: "o/r" });
  const http = new StubHttp({
    "https://hub.docker.com/v2/repositories/o/r/tags?page_size=100&ordering=last_updated": {
      results: [{ name: "v9.9.9" }, { name: "v10.0.0" }],
    },
  });
  await fetchDockerHub(c, http);
  assertEquals(c.latest, "v10.0.0");
});

Deno.test("docker_hub returns n/a when no usable tags", async () => {
  const c = makeComponent({ source: "docker_hub", upstream: "o/r" });
  const http = new StubHttp({
    "https://hub.docker.com/v2/repositories/o/r/tags?page_size=100&ordering=last_updated": {
      results: [{ name: "latest" }, { name: "dev" }],
    },
  });
  await fetchDockerHub(c, http);
  assertEquals(c.latest, "n/a");
  assertEquals(c.latest_link, "");
});

// --- static / unknown ---

Deno.test("static keeps a seeded latest and links the template", () => {
  const c = makeComponent({ source: "static", latest: "v0.3.0", link_template: "https://x" });
  fetchStatic(c);
  assertEquals(c.latest, "v0.3.0");
  assertEquals(c.latest_link, "https://x");
});

Deno.test("static reports unknown when nothing is seeded", () => {
  const c = makeComponent({ source: "static" });
  fetchStatic(c);
  assertEquals(c.latest, "unknown");
});

Deno.test("unknown source reports unknown", () => {
  const c = makeComponent({ source: "custom", link_template: "https://x" });
  fetchUnknown(c);
  assertEquals(c.latest, "unknown");
  assertEquals(c.latest_link, "https://x");
});

// --- offline client ---

Deno.test("OfflineHttpClient rejects every request", async () => {
  const http = new OfflineHttpClient();
  await assertRejects(() => http.json("https://x"), Error, "offline mode");
  await assertRejects(() => http.text("https://x"), Error, "offline mode");
});
