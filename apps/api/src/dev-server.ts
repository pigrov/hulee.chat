import { loadLocalEnvFile, mergeEnvSources } from "@hulee/config";
import {
  assertInboxV2RuntimeSchemaEpoch,
  assertInboxV2RuntimeSchemaEpochDeclaration,
  closeHuleeDatabase,
  createHuleeDatabase
} from "@hulee/db";

import { createApiDataPlaneHandler, createApiRuntime } from "./index";
import { createApiNodeServer } from "./http/node-server";

const localEnv = loadLocalEnvFile();
const env = mergeEnvSources(localEnv, process.env, {
  HULEE_API_PORT:
    process.env.HULEE_API_PORT ?? localEnv.HULEE_API_PORT ?? "4000"
});
const runtime = createApiRuntime(env);
assertInboxV2RuntimeSchemaEpochDeclaration({
  runtimeEnvironment: env.NODE_ENV,
  declaredEpoch: env.HULEE_SCHEMA_EPOCH
});
const database = createHuleeDatabase({
  connectionString: runtime.config.databaseUrl
});
let schemaEvidence;
try {
  schemaEvidence = await assertInboxV2RuntimeSchemaEpoch(database);
  runtime.logger.info("api.schema_epoch_verified", schemaEvidence);
} catch (error) {
  runtime.logger.error("api.schema_epoch_rejected", undefined, error);
  await closeHuleeDatabase(database);
  throw error;
}
const server = createApiNodeServer({
  handler: createApiDataPlaneHandler({
    database,
    env,
    logger: runtime.logger,
    internalApiSecret: runtime.config.internalApiSecret,
    secretEncryptionKey: runtime.config.secretEncryptionKey,
    egressProfile: runtime.config.egressProfile,
    publicWebhookBaseUrl: runtime.config.publicWebhookBaseUrl,
    runtimeSchemaEvidence: schemaEvidence,
    buildRevision: env.HULEE_BUILD_REVISION
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
