import { loadLocalEnvFile, mergeEnvSources } from "@hulee/config";
import {
  assertInboxV2RuntimeSchemaEpoch,
  assertInboxV2RuntimeSchemaEpochDeclaration,
  closeHuleeDatabase,
  createHuleeDatabase
} from "@hulee/db";

const env = mergeEnvSources(loadLocalEnvFile(), process.env);
assertInboxV2RuntimeSchemaEpochDeclaration({
  runtimeEnvironment: env.NODE_ENV,
  declaredEpoch: env.HULEE_SCHEMA_EPOCH
});

const database = createHuleeDatabase({
  connectionString: env.DATABASE_URL
});
try {
  const evidence = await assertInboxV2RuntimeSchemaEpoch(database);
  console.log(
    JSON.stringify({
      event: "web.schema_epoch_verified",
      ...evidence
    })
  );
} finally {
  await closeHuleeDatabase(database);
}
