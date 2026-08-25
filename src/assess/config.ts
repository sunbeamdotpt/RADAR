import {
  type Env,
  envBool,
  envStorage,
  envString,
  resolveDatabaseUrl,
  type StorageKind,
} from "../config/env.ts";

/** Fully-resolved assess-job configuration; every input arrives via env vars. */
export interface AssessConfig {
  storage: StorageKind;
  databaseUrl: string | undefined;
  seedPath: string;
  jsonPath: string;
  /** Assessments file for STORAGE=json (derived from RADAR_JSON_PATH by default). */
  assessJsonPath: string | undefined;
  githubToken: string | undefined;
  offline: boolean;
  /** When true, only components with update_available=true are assessed. */
  updatesOnly: boolean;
  /** Delay between release-note fetches (rate limiting); 0 in tests. */
  fetchDelayMs: number;
}

export function loadAssessConfig(env: Env): AssessConfig {
  const storage = envStorage(env);
  const jsonPath = envString(env, "RADAR_JSON_PATH", "./data/component-versions.json");
  const assessJsonPath = env.RADAR_ASSESS_JSON_PATH ||
    jsonPath.replace(/\.json$/, "") + ".assessments.json";
  return {
    storage,
    databaseUrl: storage === "postgres" ? resolveDatabaseUrl(env) : undefined,
    seedPath: envString(env, "RADAR_SEED_PATH", "./seed/component-versions.yaml"),
    jsonPath,
    assessJsonPath,
    githubToken: env.GITHUB_TOKEN || undefined,
    offline: envBool(env, "RADAR_OFFLINE", false),
    updatesOnly: envBool(env, "RADAR_ASSESS_UPDATES_ONLY", false),
    fetchDelayMs: 250,
  };
}
