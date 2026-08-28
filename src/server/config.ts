import {
  type Env,
  envBool,
  envStorage,
  envString,
  resolveDatabaseUrl,
  type StorageKind,
} from "../config/env.ts";

/** Server configuration; every input arrives via env vars. */
export interface ServerConfig {
  storage: StorageKind;
  jsonPath: string;
  databaseUrl: string | undefined;
  hostname: string;
  port: number;
  dashboardEnabled: boolean;
  grafanaUrl: string | undefined;
}

export function loadServerConfig(env: Env): ServerConfig {
  const storage = envStorage(env);
  const rawPort = envString(env, "PORT", "8080");
  const port = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT: expected an integer 1-65535, got ${JSON.stringify(rawPort)}`);
  }
  return {
    storage,
    jsonPath: envString(env, "RADAR_JSON_PATH", "./data/component-versions.json"),
    databaseUrl: storage === "postgres" ? resolveDatabaseUrl(env) : undefined,
    hostname: envString(env, "RADAR_HOST", "0.0.0.0"),
    port,
    dashboardEnabled: envBool(env, "RADAR_DASHBOARD_ENABLED", true),
    grafanaUrl: envString(env, "RADAR_GRAFANA_URL", "") || undefined,
  };
}
