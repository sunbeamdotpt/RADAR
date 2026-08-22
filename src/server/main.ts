import { log } from "../log.ts";
import { JsonStore } from "../store/json_store.ts";
import { PostgresStore } from "../store/postgres_store.ts";
import type { Store } from "../store/store.ts";
import { loadServerConfig } from "./config.ts";
import { createHandler } from "./routes.ts";

async function main(): Promise<void> {
  const config = loadServerConfig(Deno.env.toObject());

  let store: Store;
  if (config.storage === "postgres") {
    const pg = new PostgresStore(config.databaseUrl!);
    await pg.init();
    store = pg;
  } else {
    store = new JsonStore(config.jsonPath);
  }

  const abort = new AbortController();
  const shutdown = () => {
    log("info", "shutdown requested");
    abort.abort();
  };
  Deno.addSignalListener("SIGTERM", shutdown);
  Deno.addSignalListener("SIGINT", shutdown);

  log("info", "radar api starting", {
    hostname: config.hostname,
    port: config.port,
    storage: config.storage,
  });

  const server = Deno.serve(
    { hostname: config.hostname, port: config.port, signal: abort.signal },
    createHandler(store),
  );
  await server.finished;
  await store.close();
  log("info", "radar api stopped");
}

if (import.meta.main) {
  await main();
}
