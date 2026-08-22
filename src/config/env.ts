/** Shared environment-variable parsing for the job and the server. */

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export type Env = Record<string, string | undefined>;

const TRUTHY = new Set(["1", "true", "yes", "on"]);
const FALSY = new Set(["0", "false", "no", "off"]);

/** Parse a boolean env var; unset/empty → fallback. */
export function envBool(env: Env, key: string, fallback: boolean): boolean {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const value = raw.toLowerCase();
  if (TRUTHY.has(value)) return true;
  if (FALSY.has(value)) return false;
  throw new ConfigError(`${key}: expected a boolean (1/0/true/false), got ${JSON.stringify(raw)}`);
}

export function envString(env: Env, key: string, fallback: string): string {
  const raw = env[key];
  return raw === undefined || raw === "" ? fallback : raw;
}

export type StorageKind = "json" | "postgres";

export function envStorage(env: Env): StorageKind {
  const raw = envString(env, "STORAGE", "json");
  if (raw !== "json" && raw !== "postgres") {
    throw new ConfigError(`STORAGE: expected "json" or "postgres", got ${JSON.stringify(raw)}`);
  }
  return raw;
}

/**
 * Resolve the Postgres connection string.
 * DATABASE_URL wins (this is what VSO injects as the `dsn` key in cluster);
 * the PG* vars are a local-dev fallback.
 */
export function resolveDatabaseUrl(env: Env): string {
  const direct = env.DATABASE_URL;
  if (direct) return direct;
  const missing = ["PGHOST", "PGUSER", "PGPASSWORD", "PGDATABASE"].filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new ConfigError(
      `postgres storage requires DATABASE_URL or PG* vars (missing: ${missing.join(", ")})`,
    );
  }
  const port = env.PGPORT ?? "5432";
  const user = encodeURIComponent(env.PGUSER!);
  const password = encodeURIComponent(env.PGPASSWORD!);
  // The PG* path is a local-dev fallback; dev containers don't terminate TLS.
  // Production DSNs arrive via DATABASE_URL and carry their own sslmode.
  return `postgresql://${user}:${password}@${env.PGHOST}:${port}/${env.PGDATABASE}?sslmode=disable`;
}
