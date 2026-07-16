import { installInboxV2Database } from "./inbox-v2-database-lifecycle.mjs";

const options = parseArguments(process.argv.slice(2));
const result = await installInboxV2Database({
  databaseUrl: process.env.DATABASE_URL,
  migrationsFolder: process.env.HULEE_MIGRATIONS_FOLDER,
  lockTimeoutMs: optionalEnvironmentNumber(
    "HULEE_INBOX_V2_MIGRATION_LOCK_TIMEOUT_MS"
  ),
  statementTimeoutMs: optionalEnvironmentNumber(
    "HULEE_INBOX_V2_MIGRATION_STATEMENT_TIMEOUT_MS"
  ),
  bootstrap: options.bootstrap,
  allowReviewedOnlineBridge: options.allowReviewedOnlineBridge
});
console.log(JSON.stringify(result, null, 2));

function parseArguments(arguments_) {
  const parsed = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--") {
      continue;
    }
    if (argument === "--bootstrap") {
      parsed.bootstrap = requiredArgument(arguments_, ++index, argument);
      continue;
    }
    if (argument === "--allow-reviewed-online-bridge") {
      parsed.allowReviewedOnlineBridge = true;
      continue;
    }
    throw new Error(`Unknown install argument: ${argument}`);
  }
  return parsed;
}

function requiredArgument(arguments_, index, option) {
  const value = arguments_[index];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function optionalEnvironmentNumber(name) {
  const value = process.env[name];
  return value === undefined ? undefined : Number(value);
}
