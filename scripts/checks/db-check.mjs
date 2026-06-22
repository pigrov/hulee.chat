import { readdir, readFile } from "node:fs/promises";

const metadata = await readFile("packages/db/src/schema/metadata.ts", "utf8");
const migrationDirectory = "packages/db/drizzle";
const migrationFileNames = (await readdir(migrationDirectory)).filter(
  (fileName) => fileName.endsWith(".sql")
);
const migrationSql = (
  await Promise.all(
    migrationFileNames.map((fileName) =>
      readFile(`${migrationDirectory}/${fileName}`, "utf8")
    )
  )
).join("\n");

const tenantTables = [
  ...metadata.matchAll(
    /\{ name: "([^"]+)", scope: "tenant", requiresTenantId: true \}/g
  )
].map((match) => match[1]);

if (tenantTables.length === 0) {
  console.error("DB schema scaffold does not declare tenant-scoped tables.");
  process.exit(1);
}

for (const tableName of ["event_store", "outbox", "audit_log"]) {
  if (
    !metadata.includes(`name: "${tableName}"`) ||
    !migrationSql.includes(`"${tableName}"`)
  ) {
    console.error(
      `DB schema and migration must include required table: ${tableName}.`
    );
    process.exit(1);
  }
}

for (const tableName of tenantTables) {
  const tableBlock = findCreateTableBlock(migrationSql, tableName);

  if (!tableBlock) {
    console.error(`Missing migration CREATE TABLE block for ${tableName}.`);
    process.exit(1);
  }

  if (!/"tenant_id"\s+text\b[^\n]*NOT NULL/.test(tableBlock)) {
    console.error(`${tableName} must include a non-null tenant_id column.`);
    process.exit(1);
  }

  if (!hasTenantAwareIndex(migrationSql, tableName)) {
    console.error(`${tableName} must include a tenant-aware index.`);
    process.exit(1);
  }
}

console.log("db:check passed");

function findCreateTableBlock(sql, tableName) {
  const escapedTableName = escapeRegExp(tableName);
  const match = sql.match(
    new RegExp(`CREATE TABLE "${escapedTableName}" \\([\\s\\S]*?\\);`)
  );

  return match?.[0];
}

function hasTenantAwareIndex(sql, tableName) {
  const escapedTableName = escapeRegExp(tableName);

  return new RegExp(
    `CREATE (UNIQUE )?INDEX "[^"]+" ON "${escapedTableName}"[\\s\\S]*?\\("tenant_id"`
  ).test(sql);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
