import { assertEquals } from "jsr:@std/assert@^1";
import { assessComponent } from "../../src/assess/engine.ts";
import { fetchReleaseNotes, githubApiUrl, resolveUrl } from "../../src/assess/fetch.ts";
import type { ComponentHints, ComponentRecord } from "../../src/schema/component.ts";
import { OfflineHttpClient } from "../../src/sources/http.ts";
import type { HttpClient } from "../../src/sources/http.ts";

const offline = new OfflineHttpClient();
const NOW = new Date(Date.UTC(2026, 7, 25)); // 2026-08-25

function comp(overrides: Partial<ComponentRecord>): ComponentRecord {
  return {
    name: "Test",
    namespace: "ns",
    current: "1.0.0",
    latest: "1.1.0",
    source: "github_release",
    upstream: "org/repo",
    link_template: "",
    notes: "",
    update_available: true,
    ...overrides,
  };
}

async function assess(c: ComponentRecord, hints: ComponentHints = {}, opts = {}) {
  return await assessComponent(c, hints, offline, undefined, { offline: true, now: NOW, ...opts });
}

// --- ground-truth cases from the v2 benchmark/findings ---

Deno.test("major bump → breaking (Valkey 8 → 9)", async () => {
  const a = await assess(comp({ name: "Valkey", current: "8-alpine", latest: "9.1.1" }));
  assertEquals(a.risk_level, "breaking");
  assertEquals(a.layer, "layer_0_precheck");
});

Deno.test("ory versioning hint beats the major-bump rule (Kratos 25 → 26)", async () => {
  const a = await assess(
    comp({ name: "Kratos", current: "v25.4.0", latest: "v26.2.0", upstream: "ory/kratos" }),
    { versioning_scheme: "ory" },
  );
  assertEquals(a.risk_level, "review");
  assertEquals(a.layer, "layer_0_hints");
});

Deno.test("experimental channel is breaking even on a minor bump (Gateway API)", async () => {
  const a = await assess(
    comp({
      name: "Gateway API CRDs",
      current: "v1.5.1",
      latest: "v1.6.1",
      notes: "Experimental channel required by Sunbeam Proxy 0.2.0+",
    }),
    { channel: "experimental" },
  );
  assertEquals(a.risk_level, "breaking");
  assertEquals(a.layer, "layer_6_hints");
});

Deno.test("channel hint is auto-detected from curated notes", async () => {
  const a = await assess(comp({ notes: "Requires experimental channel support" }));
  assertEquals(a.risk_level, "breaking");
  assertEquals(a.layer, "layer_6_hints");
});

Deno.test("deprecated hint (CNPG system images)", async () => {
  const a = await assess(
    comp({
      name: "CloudNativePG PostgreSQL image",
      current: "18.1-system-trixie",
      latest: "unknown",
      source: "static",
      upstream: "ghcr.io/cloudnative-pg/postgresql",
      update_available: false,
    }),
    { deprecated: "CNPG system images are deprecated. Migrate to standard/minimal." },
  );
  assertEquals(a.risk_level, "deprecated");
});

Deno.test("eol hint fires within the warning window (Tempo 2.9)", async () => {
  const a = await assess(
    comp({
      name: "Tempo",
      current: "v2.9.0",
      latest: "v2.9.0",
      upstream: "https://grafana.github.io/helm-charts::tempo",
      source: "helm_chart",
      update_available: false,
    }),
    { eol_version_line: "2.9", eol_date: "2026-12-31", eol_replacement: "Tempo 2.10 or 3.0" },
  );
  assertEquals(a.risk_level, "eol_warning");
  assertEquals(a.action.includes("Tempo 2.10"), true);
});

Deno.test("eol hint ignores other version lines and far-future dates", async () => {
  const other = await assess(
    comp({ current: "v2.10.0", latest: "v2.10.0", update_available: false }),
    { eol_version_line: "2.9", eol_date: "2026-12-31" },
  );
  assertEquals(other.risk_level, "non_applicable"); // in-sync, wrong version line
  const future = await assess(
    comp({ current: "v2.9.0", latest: "v2.9.0", update_available: false }),
    { eol_version_line: "2.9", eol_date: "2035-01-01" },
  );
  assertEquals(future.risk_level, "non_applicable");
});

Deno.test("floating tag (Tailscale stable)", async () => {
  const a = await assess(comp({ name: "Tailscale", current: "stable", latest: "v1.90.0" }));
  assertEquals(a.risk_level, "floating_tag");
});

Deno.test("custom fork suffix (OpenSign -sunbeam.12)", async () => {
  const a = await assess(
    comp({ name: "OpenSign", current: "v2.41.1-sunbeam.12", latest: "unknown" }),
  );
  assertEquals(a.risk_level, "custom_fork");
});

Deno.test("false positive latest tag (seaweedfs large_disk variant)", async () => {
  const a = await assess(comp({ current: "4.18", latest: "4.43_large_disk_rocksdb" }));
  assertEquals(a.risk_level, "false_positive");
});

Deno.test("major_only policy confirms same-major as safe after note analysis (OpenSearch)", async () => {
  const a = await assess(
    comp({ name: "OpenSearch", current: "3", latest: "3.8.0" }),
    { breaking_change_policy: "major_only" },
  );
  assertEquals(a.risk_level, "likely_safe");
  assertEquals(a.layer, "layer_5_hints");
});

Deno.test("multi-tag current parses first token (curl 8.9.1 / … → gap review)", async () => {
  const a = await assess(
    comp({
      name: "curl",
      current: "8.9.1 / 8.10.1 / latest",
      latest: "curl-8_21_0",
      source: "docker_hub",
    }),
  );
  assertEquals(a.risk_level, "review");
  assertEquals(a.layer, "layer_5_gap_fallback");
});

Deno.test("in-sync components are non_applicable; unknown latest is unknown", async () => {
  const safe = await assess(comp({ current: "v1.6.5", latest: "v1.6.5", update_available: false }));
  assertEquals(safe.risk_level, "non_applicable");
  assertEquals(safe.layer, "layer_0_in_sync");
  const unk = await assess(comp({ current: "v0.3.0", latest: "unknown", source: "static" }));
  assertEquals(unk.risk_level, "unknown");
  assertEquals(unk.layer, "layer_6_fallback");
});

// --- layer precedence ---

Deno.test("injected helm schema diff beats note analysis (layer 1 > 2)", async () => {
  const a = await assess(
    comp({ source: "helm_chart", current: "1.0.0", latest: "1.1.0" }),
    {},
    {
      helmValuesOld: { properties: { a: { type: "string" } } },
      helmValuesNew: { properties: {} },
      releaseNotes: "perfectly calm release notes",
    },
  );
  assertEquals(a.risk_level, "breaking");
  assertEquals(a.layer, "layer_1_helm_schema");
});

Deno.test("clean helm schema diff is likely_safe (layer 1)", async () => {
  const schema = { properties: { a: { type: "string" } } };
  const a = await assess(
    comp({ source: "helm_chart" }),
    {},
    { helmValuesOld: schema, helmValuesNew: schema },
  );
  assertEquals(a.risk_level, "likely_safe");
  assertEquals(a.layer, "layer_1_helm_schema");
});

Deno.test("injected CRD diff and go.mod bumps", async () => {
  const crd = await assess(
    comp({}),
    {},
    {
      crdOld: { spec: { versions: [{ name: "v1alpha1" }] } },
      crdNew: { spec: { versions: [] } },
    },
  );
  assertEquals(crd.risk_level, "breaking");
  assertEquals(crd.layer, "layer_1_crd_diff");

  const gomod = await assess(
    comp({}),
    {},
    { goModOld: "require github.com/x/y v1.0.0\n", goModNew: "require github.com/x/y v2.0.0\n" },
  );
  assertEquals(gomod.risk_level, "review");
  assertEquals(gomod.layer, "layer_1_go_mod");
});

Deno.test("breaking section in release notes (layer 2)", async () => {
  const a = await assess(
    comp({ name: "Headscale", current: "0.28.0", latest: "v0.29.3" }),
    {},
    {
      releaseNotes:
        "## ⚠ BREAKING CHANGES\n- ACL wildcard semantics changed\n- must migrate config\n",
    },
  );
  assertEquals(a.risk_level, "breaking");
  assertEquals(a.layer, "layer_2_note_structure");
});

Deno.test("removal section without breaking header is review (layer 2)", async () => {
  const a = await assess(comp({}), {}, { releaseNotes: "## Removed\n- old thing\n" });
  assertEquals(a.risk_level, "review");
  assertEquals(a.layer, "layer_2_note_structure");
});

Deno.test("breaking commits flag review (layer 3)", async () => {
  const a = await assess(
    comp({}),
    {},
    { commits: [{ sha: "abc1234567", message: "feat!: drop legacy auth" }] },
  );
  assertEquals(a.risk_level, "review");
  assertEquals(a.layer, "layer_3_commits");
});

Deno.test("keyword fallback fires on injected notes (layer 4)", async () => {
  const a = await assess(
    comp({}),
    {},
    { releaseNotes: "several deprecated endpoints will be removed; you must migrate" },
  );
  assertEquals(a.risk_level, "breaking");
  assertEquals(a.layer, "layer_4_keywords");
});

// --- release-notes fetcher ---

Deno.test("resolveUrl fills placeholders from latest, falling back to current", () => {
  const c = comp({ latest: "v1.21.1", link_template: "https://github.com/o/r/releases/tag/{tag}" });
  assertEquals(resolveUrl(c.link_template, c), "https://github.com/o/r/releases/tag/v1.21.1");
  const noV = comp({ link_template: "https://x/{version}/{app_version}" });
  assertEquals(resolveUrl(noV.link_template, noV), "https://x/1.1.0/1.1.0");
  assertEquals(resolveUrl("", c), null);
  const unknownLatest = comp({ latest: "unknown" });
  assertEquals(
    resolveUrl(unknownLatest.link_template || "https://x/{tag}", unknownLatest),
    "https://x/1.0.0",
    "unknown latest falls back to current",
  );
});

Deno.test("githubApiUrl rewrites release pages to the API", () => {
  assertEquals(
    githubApiUrl("https://github.com/org/repo/releases/tag/v1.2.3"),
    "https://api.github.com/repos/org/repo/releases/tags/v1.2.3",
  );
  assertEquals(githubApiUrl("https://example.com/notes"), null);
});

Deno.test("fetchReleaseNotes prefers the github API body and forwards the token", async () => {
  const calls: { url: string; token?: string }[] = [];
  const http: HttpClient = {
    json: (url: string, token?: string) => {
      calls.push({ url, token });
      return Promise.resolve({ body: "release notes here" });
    },
    text: () => Promise.reject(new Error("should not be called")),
  };
  // current == latest → range fetch is skipped, single-release path is exercised.
  const c = comp({
    current: "v1.21.1",
    latest: "v1.21.1",
    link_template: "https://github.com/cert-manager/cert-manager/releases/tag/{tag}",
  });
  const notes = await fetchReleaseNotes(c, http, "tok");
  assertEquals(notes, "release notes here");
  assertEquals(
    calls[0].url,
    "https://api.github.com/repos/cert-manager/cert-manager/releases/tags/v1.21.1",
  );
  assertEquals(calls[0].token, "tok");
});

Deno.test("fetchReleaseNotes falls back to plain text and soft-fails", async () => {
  const http: HttpClient = {
    json: () => Promise.reject(new Error("api down")),
    text: () => Promise.resolve("plain text notes"),
  };
  const c = comp({ latest: "v1.0.0", link_template: "https://github.com/o/r/releases/tag/{tag}" });
  assertEquals(await fetchReleaseNotes(c, http), "plain text notes");

  const broken: HttpClient = {
    json: () => Promise.reject(new Error("x")),
    text: () => Promise.reject(new Error("y")),
  };
  assertEquals(await fetchReleaseNotes(c, broken), "");

  const docker = comp({ source: "docker_hub", link_template: "https://hub.docker.com/r/o/r/tags" });
  assertEquals(await fetchReleaseNotes(docker, broken), "", "registries without notes are skipped");
});

Deno.test("toggleTagV flips the v prefix on github release tag URLs", async () => {
  const { toggleTagV } = await import("../../src/assess/fetch.ts");
  assertEquals(
    toggleTagV("https://github.com/longhorn/longhorn/releases/tag/1.12.1"),
    "https://github.com/longhorn/longhorn/releases/tag/v1.12.1",
  );
  assertEquals(
    toggleTagV("https://github.com/o/r/releases/tag/v1.0.0"),
    "https://github.com/o/r/releases/tag/1.0.0",
  );
  assertEquals(toggleTagV("https://example.com/changelog"), null);
});

Deno.test("fetchReleaseNotes retries the v-toggled tag when the resolved URL 404s", async () => {
  const calls: string[] = [];
  const http: HttpClient = {
    json: (url: string) => {
      calls.push(url);
      if (url.includes("/releases?per_page=")) {
        return Promise.resolve([]); // no intermediate releases
      }
      if (url.endsWith("/releases/tags/v1.12.1")) {
        return Promise.resolve({ body: "## Breaking Changes\n- x" });
      }
      return Promise.reject(new Error("404"));
    },
    text: () => Promise.reject(new Error("404")),
  };
  // Longhorn: seed template uses {app_version} (v stripped) but tags are v-prefixed.
  const c = comp({
    name: "Longhorn",
    current: "v1.11.1",
    latest: "v1.12.1",
    source: "helm_chart",
    link_template: "https://github.com/longhorn/longhorn/releases/tag/{app_version}",
  });
  const notes = await fetchReleaseNotes(c, http);
  assertEquals(notes, "## Breaking Changes\n- x");
  assertEquals(calls, [
    "https://api.github.com/repos/longhorn/longhorn/releases?per_page=100&page=1",
    "https://api.github.com/repos/longhorn/longhorn/releases/tags/1.12.1",
    "https://api.github.com/repos/longhorn/longhorn/releases/tags/v1.12.1",
  ]);
});

Deno.test("drifted small-gap with fetchable-but-empty notes is unknown, not likely_safe", async () => {
  const silent: HttpClient = {
    json: () => Promise.reject(new Error("404")),
    text: () => Promise.reject(new Error("404")),
  };
  const a = await assessComponent(
    comp({
      name: "Longhorn",
      current: "v1.11.1",
      latest: "v1.12.1",
      source: "helm_chart",
      link_template: "https://github.com/longhorn/longhorn/releases/tag/{app_version}",
    }),
    {},
    silent,
    undefined,
    { now: NOW },
  );
  assertEquals(a.risk_level, "unknown");
  assertEquals(a.layer, "layer_5_gap_fallback");
  assertEquals(a.details.notes_unavailable, true);

  // No drift → non_applicable; nothing to be unsafe about.
  const inSync = await assessComponent(
    comp({ latest: "1.0.0", update_available: false }),
    {},
    silent,
    undefined,
    { now: NOW },
  );
  assertEquals(inSync.risk_level, "non_applicable");
  assertEquals(inSync.layer, "layer_0_in_sync");

  // Sources with no text notes by design (docker hub) keep the old behavior.
  const docker = await assessComponent(
    comp({
      name: "NATS server",
      source: "docker_hub",
      upstream: "nats",
      link_template: "",
    }),
    {},
    silent,
    undefined,
    { now: NOW },
  );
  assertEquals(docker.risk_level, "likely_safe");
});

Deno.test("fetchReleaseNotes concatenates intermediate release notes across the gap", async () => {
  const http: HttpClient = {
    json: (url: string) => {
      if (url.includes("/releases?per_page=")) {
        return Promise.resolve([
          { tag_name: "v1.2.4", body: "patch fixes", draft: false, prerelease: false },
          {
            tag_name: "v1.2.3",
            body: "## Breaking Changes\n- removed X",
            draft: false,
            prerelease: false,
          },
          { tag_name: "v1.2.2", body: "bugfixes", draft: false, prerelease: false },
          { tag_name: "v1.2.0", body: "initial", draft: false, prerelease: false },
        ]);
      }
      return Promise.reject(new Error("should not call single-release API"));
    },
    text: () => Promise.reject(new Error("should not call text fallback")),
  };
  const c = comp({
    current: "v1.2.1",
    latest: "v1.2.4",
    link_template: "https://github.com/o/r/releases/tag/{tag}",
  });
  const notes = await fetchReleaseNotes(c, http);
  assertEquals(notes.includes("## Breaking Changes"), true, "catches intermediate breakage");
  assertEquals(notes.includes("# v1.2.3"), true);
  assertEquals(notes.includes("# v1.2.2"), true);
  assertEquals(notes.includes("# v1.2.0"), false, "current or older releases are excluded");
  assertEquals(notes.includes("# v1.2.4"), true, "latest release's own notes are included");
  assertEquals(notes.indexOf("# v1.2.4") < notes.indexOf("# v1.2.3"), true, "endpoint first");
  assertEquals(notes.indexOf("# v1.2.3") < notes.indexOf("# v1.2.2"), true, "newest first");
});

Deno.test("fetchReleaseNotes skips drafts and prereleases in the gap", async () => {
  const http: HttpClient = {
    json: () =>
      Promise.resolve([
        { tag_name: "v1.1.2", body: "final", draft: false, prerelease: false },
        { tag_name: "v1.1.1-rc1", body: "rc", draft: false, prerelease: true },
        { tag_name: "v1.1.1-beta", body: "this is a draft", draft: true, prerelease: false },
        { tag_name: "v1.1.1", body: "stable release", draft: false, prerelease: false },
      ]),
    text: () => Promise.reject(new Error("x")),
  };
  const c = comp({
    current: "v1.1.0",
    latest: "v1.1.2",
    link_template: "https://github.com/o/r/releases/tag/{tag}",
  });
  const notes = await fetchReleaseNotes(c, http);
  assertEquals(notes.includes("stable release"), true);
  assertEquals(notes.includes("rc"), false);
  assertEquals(notes.includes("this is a draft"), false);
});

Deno.test("fetchReleaseNotes falls back to single release when range fetch fails", async () => {
  const http: HttpClient = {
    json: (url: string) => {
      if (url.includes("/releases?per_page=")) return Promise.reject(new Error("list down"));
      return Promise.resolve({ body: "single release notes" });
    },
    text: () => Promise.reject(new Error("x")),
  };
  const c = comp({
    current: "v1.0.0",
    latest: "v1.1.0",
    link_template: "https://github.com/o/r/releases/tag/{tag}",
  });
  assertEquals(await fetchReleaseNotes(c, http), "single release notes");
});

// --- gap-walk regressions (endpoint inclusion, pagination, checksum pages) ---

Deno.test("endpoint release notes are analyzed when the gap walk includes them (Loki 3.6.x)", async () => {
  const http: HttpClient = {
    json: (url: string) => {
      if (url.includes("/releases?per_page=")) {
        return Promise.resolve([
          {
            tag_name: "v3.6.12",
            body: "## ⚠ BREAKING CHANGES\n- operator: consolidate image build workflows",
            draft: false,
            prerelease: false,
          },
          { tag_name: "v3.6.11", body: "bug fixes", draft: false, prerelease: false },
          { tag_name: "v3.6.5", body: "old", draft: false, prerelease: false },
        ]);
      }
      return Promise.reject(new Error("endpoint already in range; must not fetch single"));
    },
    text: () => Promise.reject(new Error("x")),
  };
  const a = await assessComponent(
    comp({
      name: "Loki",
      current: "3.6.5",
      latest: "3.6.12",
      link_template: "https://github.com/grafana/loki/releases/tag/v{version}",
    }),
    {},
    http,
    undefined,
    { now: NOW },
  );
  assertEquals(a.risk_level, "breaking");
  assertEquals(a.layer, "layer_2_note_structure");
});

Deno.test("endpoint release notes are fetched on their own when the gap walk missed them", async () => {
  const calls: string[] = [];
  const http: HttpClient = {
    json: (url: string) => {
      calls.push(url);
      if (url.includes("/releases?per_page=")) {
        // Only intermediate releases listed — the endpoint tag is absent.
        return Promise.resolve([
          { tag_name: "v3.6.11", body: "bug fixes", draft: false, prerelease: false },
          { tag_name: "v3.6.5", body: "old", draft: false, prerelease: false },
        ]);
      }
      if (url.endsWith("/releases/tags/v3.6.12")) {
        return Promise.resolve({ body: "## BREAKING CHANGES\n- move the Loki UI to a plugin" });
      }
      return Promise.reject(new Error("404"));
    },
    text: () => Promise.reject(new Error("404")),
  };
  const a = await assessComponent(
    comp({
      name: "Loki",
      current: "3.6.5",
      latest: "v3.6.12",
      link_template: "https://github.com/grafana/loki/releases/tag/{tag}",
    }),
    {},
    http,
    undefined,
    { now: NOW },
  );
  assertEquals(a.risk_level, "breaking");
  assertEquals(a.layer, "layer_2_note_structure");
  assertEquals(
    calls.some((u) => u.endsWith("/releases/tags/v3.6.12")),
    true,
    "endpoint fetched singly when absent from the range",
  );
});

Deno.test("fetchReleaseNotes paginates the release list across pages", async () => {
  const calls: string[] = [];
  const filler = Array.from({ length: 100 }, (_, i) => ({
    tag_name: `v9.9.${i}`, // newer than latest: skipped, but keeps the page full
    body: "",
    draft: false,
    prerelease: false,
  }));
  const http: HttpClient = {
    json: (url: string) => {
      calls.push(url);
      if (url.endsWith("page=1")) return Promise.resolve(filler);
      if (url.endsWith("page=2")) {
        return Promise.resolve([
          { tag_name: "v1.2.0", body: "latest notes", draft: false, prerelease: false },
          {
            tag_name: "v1.1.0",
            body: "## Breaking Changes\n- removed X",
            draft: false,
            prerelease: false,
          },
          { tag_name: "v1.0.0", body: "current", draft: false, prerelease: false },
        ]);
      }
      return Promise.reject(new Error("unexpected page"));
    },
    text: () => Promise.reject(new Error("x")),
  };
  const c = comp({
    current: "v1.0.0",
    latest: "v1.2.0",
    link_template: "https://github.com/o/r/releases/tag/{tag}",
  });
  const notes = await fetchReleaseNotes(c, http);
  assertEquals(notes.includes("## Breaking Changes"), true, "page 2 intermediate found");
  assertEquals(notes.includes("# v1.2.0"), true, "endpoint on page 2 included");
  assertEquals(calls.length, 2, "stopped after the short page");
  assertEquals(calls[1].includes("page=2"), true);
});

Deno.test("checksum-only release notes are treated as unavailable (crictl)", async () => {
  const checksums = [
    "SHA256 checksums:",
    `crictl-v1.32.0-linux-amd64.tar.gz: ${"a".repeat(64)}`,
    `crictl-v1.32.0-linux-arm64.tar.gz: ${"b".repeat(64)}`,
    `crictl-v1.32.0-windows-amd64.zip: ${"c".repeat(64)}`,
  ].join("\n");
  const http: HttpClient = {
    json: (url: string) => {
      if (url.includes("/releases?per_page=")) {
        return Promise.resolve([
          { tag_name: "v1.32.0", body: checksums, draft: false, prerelease: false },
          { tag_name: "v1.31.0", body: "old", draft: false, prerelease: false },
        ]);
      }
      return Promise.reject(new Error("no single fetch needed"));
    },
    text: () => Promise.reject(new Error("x")),
  };
  const c = comp({
    name: "crictl",
    current: "v1.31.0",
    latest: "v1.32.0",
    link_template: "https://github.com/kubernetes-sigs/cri-tools/releases/tag/{tag}",
  });
  assertEquals(await fetchReleaseNotes(c, http), "", "checksum pages carry no signal");

  const a = await assessComponent(c, {}, http, undefined, { now: NOW });
  assertEquals(a.risk_level, "unknown");
  assertEquals(a.layer, "layer_5_gap_fallback");
  assertEquals(a.details.notes_unavailable, true);
});

// --- deferred breaking-change policy hint ---

Deno.test("major_only hint loses to breaking signals in the actual notes", async () => {
  const a = await assess(
    comp({ name: "OpenSearch", current: "3", latest: "3.8.0" }),
    { breaking_change_policy: "major_only" },
    { releaseNotes: "## BREAKING CHANGES\n- removed index setting" },
  );
  assertEquals(a.risk_level, "breaking");
  assertEquals(a.layer, "layer_2_note_structure");
});

Deno.test("major_only hint confirms silent notes as likely_safe", async () => {
  const a = await assess(
    comp({ name: "OpenSearch", current: "3", latest: "3.8.0" }),
    { breaking_change_policy: "major_only" },
    { releaseNotes: "bug fixes and enhancements" },
  );
  assertEquals(a.risk_level, "likely_safe");
  assertEquals(a.layer, "layer_5_hints");
});

Deno.test("major_only hint stays silent when notes were expected but unavailable", async () => {
  const failing: HttpClient = {
    json: () => Promise.reject(new Error("rate limited")),
    text: () => Promise.reject(new Error("rate limited")),
  };
  const a = await assessComponent(
    comp({
      name: "OpenSearch",
      current: "3.7.0",
      latest: "3.8.0",
      link_template: "https://github.com/opensearch-project/OpenSearch/releases/tag/{version}",
    }),
    { breaking_change_policy: "major_only" },
    failing,
    undefined,
    { now: NOW },
  );
  assertEquals(a.risk_level, "unknown");
  assertEquals(a.details.notes_unavailable, true);
});

Deno.test("bold inline breaking label in the endpoint release is flagged (OpenFGA v1.19.0)", async () => {
  const http: HttpClient = {
    json: (url: string) => {
      if (url.includes("/releases?per_page=")) {
        return Promise.resolve([
          {
            tag_name: "v1.19.0",
            body:
              "### Fixed\n- **Breaking:** authorization models with this defect that were already persisted will now fail to resolve on a cache miss with `ErrInvalidModel`\n### Dependencies\n- bumped deps via dependabot",
            draft: false,
            prerelease: false,
          },
          { tag_name: "v1.18.3", body: "bug fixes", draft: false, prerelease: false },
          { tag_name: "v1.18.1", body: "old", draft: false, prerelease: false },
        ]);
      }
      return Promise.reject(new Error("endpoint already in range; must not fetch single"));
    },
    text: () => Promise.reject(new Error("x")),
  };
  const a = await assessComponent(
    comp({
      name: "OpenFGA",
      current: "v1.18.1",
      latest: "v1.19.0",
      link_template: "https://github.com/openfga/openfga/releases/tag/{tag}",
    }),
    {},
    http,
    undefined,
    { now: NOW },
  );
  assertEquals(a.layer, "layer_4_keywords");
  assertEquals(a.risk_level !== "likely_safe", true, "breaking label must not read as safe");
});

Deno.test("schema migration in the endpoint release floors at review (Stalwart v0.16.19)", async () => {
  const http: HttpClient = {
    json: (url: string) => {
      if (url.includes("/releases?per_page=")) {
        return Promise.resolve([
          {
            tag_name: "v0.16.19",
            body:
              "Upgrading to this version is as simple as replace the binary or docker pull.\n\n" +
              "Key columns are now VARBINARY(255). Existing deployments should run, once per table, " +
              "the command ALTER TABLE a MODIFY k VARBINARY(255) NOT NULL;",
            draft: false,
            prerelease: false,
          },
          { tag_name: "v0.16.11", body: "old", draft: false, prerelease: false },
        ]);
      }
      return Promise.reject(new Error("endpoint already in range; must not fetch single"));
    },
    text: () => Promise.reject(new Error("x")),
  };
  const a = await assessComponent(
    comp({
      name: "Stalwart",
      current: "v0.16.11",
      latest: "v0.16.19",
      link_template: "https://github.com/stalwartlabs/stalwart/releases/tag/{tag}",
    }),
    {},
    http,
    undefined,
    { now: NOW },
  );
  assertEquals(a.layer, "layer_4_keywords");
  assertEquals(a.risk_level !== "likely_safe", true, "schema migration must not read as safe");
});
