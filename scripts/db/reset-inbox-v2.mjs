import { resetInboxV2Database } from "./inbox-v2-database-lifecycle.mjs";

const options = parseArguments(process.argv.slice(2));
const result = await resetInboxV2Database({
  databaseUrl: process.env.DATABASE_URL,
  migrationsFolder: process.env.HULEE_MIGRATIONS_FOLDER,
  manifestPath: options.manifest,
  mig001EvidencePath: options.mig001Evidence,
  objectReceiptPath: options.objectReceipt,
  confirmation: options.confirm,
  bootstrap: options.bootstrap
});
console.log(JSON.stringify(result, null, 2));

function parseArguments(arguments_) {
  const parsed = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--manifest") {
      parsed.manifest = requiredArgument(arguments_, ++index, argument);
      continue;
    }
    if (argument === "--confirm") {
      parsed.confirm = requiredArgument(arguments_, ++index, argument);
      continue;
    }
    if (argument === "--object-receipt") {
      parsed.objectReceipt = requiredArgument(arguments_, ++index, argument);
      continue;
    }
    if (argument === "--mig-001-evidence") {
      parsed.mig001Evidence = requiredArgument(arguments_, ++index, argument);
      continue;
    }
    if (argument === "--bootstrap") {
      parsed.bootstrap = requiredArgument(arguments_, ++index, argument);
      continue;
    }
    throw new Error(`Unknown reset argument: ${argument}`);
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
