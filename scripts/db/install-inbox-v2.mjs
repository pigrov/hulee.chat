import { installInboxV2Database } from "./inbox-v2-database-lifecycle.mjs";

const options = parseArguments(process.argv.slice(2));
const result = await installInboxV2Database({
  databaseUrl: process.env.DATABASE_URL,
  migrationsFolder: process.env.HULEE_MIGRATIONS_FOLDER,
  bootstrap: options.bootstrap
});
console.log(JSON.stringify(result, null, 2));

function parseArguments(arguments_) {
  const parsed = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--bootstrap") {
      parsed.bootstrap = requiredArgument(arguments_, ++index, argument);
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
