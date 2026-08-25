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
  assertEquals(other.risk_level, "likely_safe"); // falls through to gap fallback
  const future = await assess(
    comp({ current: "v2.9.0", latest: "v2.9.0", update_available: false }),
    { eol_version_line: "2.9", eol_date: "2035-01-01" },
  );
  assertEquals(future.risk_level, "likely_safe");
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

Deno.test("major_only policy marks same-major as safe (OpenSearch)", async () => {
  const a = await assess(
    comp({ name: "OpenSearch", current: "3", latest: "3.8.0" }),
    { breaking_change_policy: "major_only" },
  );
  assertEquals(a.risk_level, "likely_safe");
  assertEquals(a.layer, "layer_0_hints");
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

Deno.test("small same-major gap is likely_safe; unknown latest is unknown", async () => {
  const safe = await assess(comp({ current: "v1.6.5", latest: "v1.6.5", update_available: false }));
  assertEquals(safe.risk_level, "likely_safe");
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
  const c = comp({
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
