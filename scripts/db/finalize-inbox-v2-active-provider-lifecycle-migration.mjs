import { readFile, writeFile } from "node:fs/promises";

const migrationPath =
  process.argv.slice(2).find((argument) => !argument.startsWith("--")) ??
  "packages/db/drizzle/0056_inbox_v2_active_provider_lifecycle_operation.sql";
const refresh = process.argv.includes("--refresh");
const marker = "INBOX_V2_ACTIVE_PROVIDER_LIFECYCLE_MIGRATION_FINALIZED_V1";

let migration = (await readFile(migrationPath, "utf8")).replaceAll(
  "\r\n",
  "\n"
);
if (migration.includes(marker)) {
  if (!refresh) throw new Error(`${migrationPath} is already finalized.`);
  if (!migration.startsWith(`-- ${marker}\n`)) {
    throw new Error(`${migrationPath} has an invalid finalization marker.`);
  }
  migration = migration.slice(`-- ${marker}\n`.length);
}

const normalized = migration.replace(/\s+/gu, " ").trim();
if (
  !normalized.startsWith(
    'CREATE UNIQUE INDEX "inbox_v2_provider_lifecycle_active_message_unique" ON "inbox_v2_message_provider_lifecycle_operations" USING btree ("tenant_id","message_id") WHERE '
  ) ||
  !normalized.includes(
    '"inbox_v2_message_provider_lifecycle_operations"."origin" = \'hulee_requested\''
  ) ||
  !normalized.includes(
    "\"inbox_v2_message_provider_lifecycle_operations\".\"outcome\" in ( 'pending', 'accepted', 'outcome_unknown' )"
  ) ||
  (normalized.match(/\bCREATE\s+UNIQUE\s+INDEX\b/giu) ?? []).length !== 1 ||
  /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER)\b/iu.test(normalized)
) {
  throw new Error(
    `${migrationPath} must contain only the reviewed active provider-lifecycle partial unique index.`
  );
}

await writeFile(migrationPath, `-- ${marker}\n${migration.trim()}\n`, "utf8");
console.log(`Finalized ${migrationPath}: one reviewed partial unique index.`);
