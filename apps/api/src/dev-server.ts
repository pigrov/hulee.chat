import { loadLocalEnvFile, mergeEnvSources } from "@hulee/config";
import { closeHuleeDatabase, createHuleeDatabase } from "@hulee/db";

import { createApiDataPlaneHandler, createApiRuntime } from "./index";
import { createApiNodeServer } from "./http/node-server";

const localEnv = loadLocalEnvFile();
const env = mergeEnvSources(localEnv, process.env, {
  HULEE_API_PORT:
    process.env.HULEE_API_PORT ?? localEnv.HULEE_API_PORT ?? "4000"
});
const runtime = createApiRuntime(env);
const database = createHuleeDatabase({
  connectionString: runtime.config.databaseUrl
});
const server = createApiNodeServer({
  handler: createApiDataPlaneHandler({
    database,
    env,
    logger: runtime.logger,
    internalApiSecret: runtime.config.internalApiSecret,
    secretEncryptionKey: runtime.config.secretEncryptionKey,
    egressProfile: runtime.config.egressProfile,
    publicWebhookBaseUrl: runtime.config.publicWebhookBaseUrl
  })
});

server.listen(runtime.config.port, runtime.config.host, () => {
  runtime.logger.info("api.dev_server_started", {
    host: runtime.config.host,
    port: runtime.config.port
  });
});

async function shutdown(): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeHuleeDatabase(database);
}

process.once("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});
process.once("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});
