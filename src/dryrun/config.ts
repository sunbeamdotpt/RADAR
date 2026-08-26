import {
  type Env,
  envBool,
  envStorage,
  envString,
  resolveDatabaseUrl,
  type StorageKind,
} from "../config/env.ts";

export const DEFAULT_GIT_BASE_URL = "https://github.com/sunbeamdotpt/sbbb.git";
export const DEFAULT_GIT_BASE_REF = "mainline";

/** Fully-resolved dry-run job configuration; every input arrives via env vars. */
export interface DryRunConfig {
  storage: StorageKind;
  databaseUrl: string | undefined;
  seedPath: string;
  jsonPath: string;
  /** Dry-runs file for STORAGE=json (derived from RADAR_JSON_PATH by default). */
  dryRunJsonPath: string | undefined;
  gitBaseUrl: string;
  gitBaseRef: string;
  /** Absolute path to a kubeconfig file for dev dry-runs; omitted in-cluster. */
  kubeconfig: string | undefined;
  /** Domain suffix for Sunbeam manifest substitution. */
  domain: string;
  /** ACME email passed to Sunbeam for cert-manager resources. */
  acmeEmail: string;
  /** Run sunbeam render but skip kubectl dry-run (useful when no cluster is reachable). */
  buildOnly: boolean;
  offline: boolean;
}

export function loadDryRunConfig(env: Env): DryRunConfig {
  const storage = envStorage(env);
  const jsonPath = envString(env, "RADAR_JSON_PATH", "./data/component-versions.json");
  const dryRunJsonPath = env.RADAR_DRYRUN_JSON_PATH ||
    jsonPath.replace(/\.json$/, "") + ".dryruns.json";
  return {
    storage,
    databaseUrl: storage === "postgres" ? resolveDatabaseUrl(env) : undefined,
    seedPath: envString(env, "RADAR_SEED_PATH", "./seed/component-versions.yaml"),
    jsonPath,
    dryRunJsonPath,
    gitBaseUrl: envString(env, "GIT_BASE_URL", DEFAULT_GIT_BASE_URL),
    gitBaseRef: envString(env, "GIT_BASE_REF", DEFAULT_GIT_BASE_REF),
    kubeconfig: env.RADAR_DRYRUN_KUBECONFIG || undefined,
    domain: envString(env, "RADAR_DOMAIN_SUFFIX", "sunbeam.pt"),
    acmeEmail: envString(env, "RADAR_ACME_EMAIL", "radar@example.com"),
    buildOnly: envBool(env, "RADAR_DRYRUN_BUILD_ONLY", false),
    offline: envBool(env, "RADAR_OFFLINE", false),
  };
}
