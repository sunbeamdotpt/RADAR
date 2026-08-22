import {
  type Env,
  envBool,
  envStorage,
  envString,
  resolveDatabaseUrl,
  type StorageKind,
} from "../config/env.ts";
import { DEFAULT_DOMAIN_SUFFIX } from "../domain/domain_suffix.ts";

export const DEFAULT_GIT_BASE_URL = "https://github.com/sunbeamdotpt/sbbb.git";
export const DEFAULT_GIT_BASE_REF = "mainline";

/** Fully-resolved job configuration; every input arrives via env vars or CLI flags. */
export interface JobConfig {
  domainSuffix: string;
  gitBaseUrl: string;
  gitBaseRef: string;
  gitBaseRequired: boolean;
  githubToken: string | undefined;
  storage: StorageKind;
  seedPath: string;
  jsonPath: string;
  /** True when RADAR_JSON_PATH was set explicitly (enables the postgres mirror). */
  jsonPathExplicit: boolean;
  databaseUrl: string | undefined;
  offline: boolean;
  bootstrap: boolean;
  /** Append components discovered in the git base that aren't tracked yet. */
  autoDetect: boolean;
  /** Delay between upstream fetches, mirroring the Python script's 0.25s. */
  fetchDelayMs: number;
}

export function loadJobConfig(env: Env, args: string[]): JobConfig {
  const bootstrap = args.includes("--bootstrap");
  const storage = envStorage(env);
  return {
    domainSuffix: envString(env, "DOMAIN_SUFFIX", DEFAULT_DOMAIN_SUFFIX),
    gitBaseUrl: envString(env, "GIT_BASE_URL", DEFAULT_GIT_BASE_URL),
    gitBaseRef: envString(env, "GIT_BASE_REF", DEFAULT_GIT_BASE_REF),
    gitBaseRequired: envBool(env, "GIT_BASE_REQUIRED", false),
    githubToken: env.GITHUB_TOKEN || undefined,
    storage,
    seedPath: envString(env, "RADAR_SEED_PATH", "./seed/component-versions.yaml"),
    jsonPath: envString(env, "RADAR_JSON_PATH", "./data/component-versions.json"),
    jsonPathExplicit: !!(env.RADAR_JSON_PATH && env.RADAR_JSON_PATH !== ""),
    databaseUrl: storage === "postgres" ? resolveDatabaseUrl(env) : undefined,
    offline: envBool(env, "RADAR_OFFLINE", false),
    bootstrap,
    autoDetect: envBool(env, "RADAR_AUTO_DETECT", false),
    fetchDelayMs: 250,
  };
}
