import { log } from "../log.ts";
import { createStore } from "../store/factory.ts";
import { loadServerConfig } from "./config.ts";
import { createHandler } from "./routes.ts";

async function main(): Promise<void> {
  const config = loadServerConfig(Deno.env.toObject());
  const store = await createStore(config);

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
    createHandler(store, config),
  );
  await server.finished;
  await store.close();
  log("info", "radar api stopped");
}

if (import.meta.main) {
  await main();
}
