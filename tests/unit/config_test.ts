import { assertEquals, assertThrows } from "jsr:@std/assert@^1";
import { ConfigError, resolveDatabaseUrl } from "../../src/config/env.ts";
import { loadDryRunConfig } from "../../src/dryrun/config.ts";
import { loadJobConfig } from "../../src/job/config.ts";
import { loadServerConfig } from "../../src/server/config.ts";

Deno.test("loadJobConfig applies documented defaults", () => {
  const config = loadJobConfig({}, []);
  assertEquals(config.domainSuffix, "sunbeam.pt");
  assertEquals(config.gitBaseUrl, "https://github.com/sunbeamdotpt/sbbb.git");
  assertEquals(config.gitBaseRef, "mainline");
  assertEquals(config.gitBaseRequired, false);
  assertEquals(config.storage, "json");
  assertEquals(config.seedPath, "./seed/component-versions.yaml");
  assertEquals(config.jsonPath, "./data/component-versions.json");
  assertEquals(config.jsonPathExplicit, false);
  assertEquals(config.offline, false);
  assertEquals(config.bootstrap, false);
  assertEquals(config.autoDetect, false);
  assertEquals(config.githubToken, undefined);
  assertEquals(config.databaseUrl, undefined);
});

Deno.test("loadJobConfig honors env overrides and flags", () => {
  const config = loadJobConfig({
    DOMAIN_SUFFIX: "example.com",
    GIT_BASE_URL: "https://github.com/x/y.git",
    GIT_BASE_REF: "main",
    GIT_BASE_REQUIRED: "true",
    GITHUB_TOKEN: "tok",
    STORAGE: "postgres",
    DATABASE_URL: "postgresql://u:p@db:5432/radar_db",
    RADAR_JSON_PATH: "/tmp/out.json",
    RADAR_SEED_PATH: "/tmp/seed.yaml",
    RADAR_OFFLINE: "1",
    RADAR_AUTO_DETECT: "yes",
  }, ["--bootstrap"]);
  assertEquals(config.domainSuffix, "example.com");
  assertEquals(config.gitBaseRequired, true);
  assertEquals(config.githubToken, "tok");
  assertEquals(config.storage, "postgres");
  assertEquals(config.databaseUrl, "postgresql://u:p@db:5432/radar_db");
  assertEquals(config.jsonPathExplicit, true);
  assertEquals(config.offline, true);
  assertEquals(config.bootstrap, true);
  assertEquals(config.autoDetect, true);
});

Deno.test("loadJobConfig rejects invalid STORAGE and booleans", () => {
  assertThrows(() => loadJobConfig({ STORAGE: "sqlite" }, []), ConfigError, "STORAGE");
  assertThrows(() => loadJobConfig({ RADAR_OFFLINE: "maybe" }, []), ConfigError, "RADAR_OFFLINE");
});

Deno.test("resolveDatabaseUrl prefers DATABASE_URL", () => {
  assertEquals(
    resolveDatabaseUrl({ DATABASE_URL: "postgresql://a:b@h:5432/d", PGHOST: "ignored" }),
    "postgresql://a:b@h:5432/d",
  );
});

Deno.test("resolveDatabaseUrl composes from PG* vars with encoding", () => {
  assertEquals(
    resolveDatabaseUrl({
      PGHOST: "postgres-rw.data.svc.cluster.local",
      PGUSER: "radar",
      PGPASSWORD: "p@ss/word",
      PGDATABASE: "radar_db",
    }),
    "postgresql://radar:p%40ss%2Fword@postgres-rw.data.svc.cluster.local:5432/radar_db?sslmode=disable",
  );
});

Deno.test("resolveDatabaseUrl lists every missing PG* var", () => {
  try {
    resolveDatabaseUrl({ PGHOST: "h" });
    throw new Error("should have thrown");
  } catch (err) {
    assertEquals(err instanceof ConfigError, true);
    assertEquals((err as Error).message.includes("PGUSER"), true);
    assertEquals((err as Error).message.includes("PGPASSWORD"), true);
    assertEquals((err as Error).message.includes("PGDATABASE"), true);
  }
});

Deno.test("loadJobConfig requires database config for postgres storage", () => {
  assertThrows(() => loadJobConfig({ STORAGE: "postgres" }, []), ConfigError, "DATABASE_URL");
});

Deno.test("loadServerConfig defaults and overrides", () => {
  assertEquals(loadServerConfig({}), {
    storage: "json",
    jsonPath: "./data/component-versions.json",
    databaseUrl: undefined,
    hostname: "0.0.0.0",
    port: 8080,
    dashboardEnabled: true,
  });
  const config = loadServerConfig({
    STORAGE: "postgres",
    DATABASE_URL: "postgresql://u:p@h/d",
    PORT: "9090",
    RADAR_HOST: "127.0.0.1",
    RADAR_DASHBOARD_ENABLED: "false",
  });
  assertEquals(config.port, 9090);
  assertEquals(config.hostname, "127.0.0.1");
  assertEquals(config.databaseUrl, "postgresql://u:p@h/d");
  assertEquals(config.dashboardEnabled, false);
});

Deno.test("loadDryRunConfig applies documented defaults", () => {
  const config = loadDryRunConfig({});
  assertEquals(config.storage, "json");
  assertEquals(config.gitBaseUrl, "https://github.com/sunbeamdotpt/sbbb.git");
  assertEquals(config.gitBaseRef, "mainline");
  assertEquals(config.seedPath, "./seed/component-versions.yaml");
  assertEquals(config.jsonPath, "./data/component-versions.json");
  assertEquals(config.dryRunJsonPath, "./data/component-versions.dryruns.json");
  assertEquals(config.kubeconfig, undefined);
  assertEquals(config.buildOnly, false);
  assertEquals(config.offline, false);
  assertEquals(config.databaseUrl, undefined);
});

Deno.test("loadDryRunConfig honors env overrides", () => {
  const config = loadDryRunConfig({
    STORAGE: "postgres",
    DATABASE_URL: "postgresql://u:p@db:5432/radar_db",
    RADAR_JSON_PATH: "/tmp/out.json",
    RADAR_DRYRUN_JSON_PATH: "/tmp/dry.json",
    RADAR_SEED_PATH: "/tmp/seed.yaml",
    GIT_BASE_URL: "https://github.com/x/y.git",
    GIT_BASE_REF: "main",
    RADAR_DRYRUN_KUBECONFIG: "/tmp/kubeconfig",
    RADAR_DRYRUN_BUILD_ONLY: "true",
    RADAR_OFFLINE: "1",
  });
  assertEquals(config.storage, "postgres");
  assertEquals(config.databaseUrl, "postgresql://u:p@db:5432/radar_db");
  assertEquals(config.dryRunJsonPath, "/tmp/dry.json");
  assertEquals(config.gitBaseUrl, "https://github.com/x/y.git");
  assertEquals(config.kubeconfig, "/tmp/kubeconfig");
  assertEquals(config.buildOnly, true);
  assertEquals(config.offline, true);
});

Deno.test("loadDryRunConfig derives dry-run json path from RADAR_JSON_PATH", () => {
  const config = loadDryRunConfig({ RADAR_JSON_PATH: "/tmp/out.json" });
  assertEquals(config.dryRunJsonPath, "/tmp/out.dryruns.json");
});

Deno.test("loadServerConfig rejects bad ports", () => {
  assertThrows(() => loadServerConfig({ PORT: "not-a-port" }), Error, "PORT");
  assertThrows(() => loadServerConfig({ PORT: "70000" }), Error, "PORT");
});
