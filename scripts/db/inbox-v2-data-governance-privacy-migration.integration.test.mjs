import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrationJournal } from "../checks/db-check-lib.mjs";

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const checkedInMigrationsDirectory = resolve("packages/db/drizzle");
const schemaPath = resolve(
  "packages/db/src/schema/inbox-v2/data-governance-privacy.ts"
);
const finalizedMarker =
  "INBOX_V2_DATA_GOVERNANCE_PRIVACY_MIGRATION_FINALIZED_V1";
const statementBreakpoint = "--> statement-breakpoint";
const lateFailureMessage = "inbox_v2.data_governance_privacy_late_failure_test";

describePostgres(
  "Inbox V2 data-governance/privacy 0033 PostgreSQL migration lifecycle",
  () => {
    let adminClient;
    let baseMigrationsDirectory;
    let targetMigrationsDirectory;
    let temporaryRoot;
    let expectedTables;
    let expectedEnums;
    let expectedInvariantFunctions;
    let expectedInvariantTriggers;
    const createdDatabases = [];

    beforeAll(async () => {
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) {
        throw new Error(
          "DATABASE_URL is required for the DB-009 migration lifecycle test."
        );
      }

      const schemaSource = await readFile(schemaPath, "utf8");
      expectedTables = extractMatches(schemaSource, /pgTable\(\s*"([^"]+)"/g);
      expectedEnums = extractMatches(schemaSource, /pgEnum\(\s*"([^"]+)"/g);
      expectedInvariantFunctions = extractMatches(
        schemaSource,
        /create or replace function public\.(inbox_v2_[a-z0-9_]+)\(/g
      );
      expectedInvariantTriggers =
        extractExpectedInvariantTriggers(schemaSource);
      expect(expectedTables.length).toBeGreaterThan(0);
      expect(expectedInvariantFunctions.length).toBeGreaterThan(0);

      temporaryRoot = await mkdtemp(join(tmpdir(), "hulee-db009-migrations-"));
      baseMigrationsDirectory = await prepareMigrationDirectory(
        temporaryRoot,
        32
      );
      targetMigrationsDirectory = await prepareMigrationDirectory(
        temporaryRoot,
        33
      );
      const targetFiles = await migrationFilesAtIndex(
        targetMigrationsDirectory,
        33
      );
      expect(targetFiles).toHaveLength(1);
      await expect(
        readFile(join(targetMigrationsDirectory, targetFiles[0]), "utf8")
      ).resolves.toContain(finalizedMarker);

      adminClient = new pg.Client({ connectionString: databaseUrl });
      await adminClient.connect();
    }, 60_000);

    afterAll(async () => {
      if (adminClient) {
        for (const databaseName of createdDatabases.reverse()) {
          await adminClient
            .query(
              `select pg_terminate_backend(pid)
                 from pg_catalog.pg_stat_activity
                where datname = $1 and pid <> pg_backend_pid()`,
              [databaseName]
            )
            .catch(() => {});
          await adminClient
            .query(`drop database if exists ${quoteDatabaseName(databaseName)}`)
            .catch(() => {});
        }
        await adminClient.end().catch(() => {});
      }
      if (temporaryRoot) {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
    }, 60_000);

    it("installs the finalized DB-009 schema on a fresh database", async () => {
      const databaseUrl = await createDatabase("fresh");
      await applyMigrations(databaseUrl, targetMigrationsDirectory);
      await expectDb009Installed(databaseUrl);
    }, 120_000);

    it("upgrades a populated finalized 0032 database without inventing lifecycle authority", async () => {
      const databaseUrl = await createDatabase("upgrade");
      await applyMigrations(databaseUrl, baseMigrationsDirectory);

      await withClient(databaseUrl, async (client) => {
        await client.query(`
          insert into public.tenants (id, slug, display_name)
          values ('tenant:db009-upgrade', 'db009-upgrade', 'DB009 upgrade');
          insert into public.employees (
            id, tenant_id, email, display_name
          ) values (
            'employee:db009-upgrade', 'tenant:db009-upgrade',
            'db009-upgrade@example.test', 'DB009 Employee'
          );
          insert into public.clients (
            id, tenant_id, display_name, source, responsible_employee_id
          ) values (
            'client:db009-upgrade', 'tenant:db009-upgrade',
            'DB009 Client', 'migration-test', 'employee:db009-upgrade'
          );
          insert into public.client_contacts (
            id, tenant_id, client_id, type, value
          ) values (
            'client_contact:db009-upgrade', 'tenant:db009-upgrade',
            'client:db009-upgrade', 'email', 'client-db009@example.test'
          );
        `);
        expect(await appliedMigrationCount(client)).toBe(33);
        await expectCoreFixture(client);
      });

      await applyMigrations(databaseUrl, targetMigrationsDirectory);
      await expectDb009Installed(databaseUrl);
      await withClient(databaseUrl, async (client) => {
        await expectCoreFixture(client);
        expect(await totalRows(client, expectedTables)).toBe("0");
      });
    }, 120_000);

    it("rejects a partial DB-009 schema and leaves the 0032 journal unchanged", async () => {
      const databaseUrl = await createDatabase("partial");
      await applyMigrations(databaseUrl, baseMigrationsDirectory);

      let baseJournalCount;
      const partialTable = expectedTables[0];
      await withClient(databaseUrl, async (client) => {
        baseJournalCount = await appliedMigrationCount(client);
        await client.query(
          `create table public.${quoteIdentifier(partialTable)} (id text)`
        );
      });

      await expectMigrationFailure(
        databaseUrl,
        "inbox_v2.data_governance_privacy_partial_schema_detected"
      );
      await withClient(databaseUrl, async (client) => {
        expect(await appliedMigrationCount(client)).toBe(baseJournalCount);
        expect(
          (
            await client.query("select to_regclass($1)::text as table_name", [
              `public.${partialTable}`
            ])
          ).rows[0]?.table_name
        ).toBe(partialTable);
        expect(await installedRelations(client, expectedTables)).toEqual([
          partialTable
        ]);
        expect(await installedTypes(client, expectedEnums)).toEqual([]);
        expect(
          await installedFunctions(client, expectedInvariantFunctions)
        ).toEqual([]);
        expect(
          await installedTriggers(client, expectedInvariantTriggers)
        ).toEqual([]);
      });
    }, 120_000);

    it("rejects a damaged finalized foundation and leaves the journal unchanged", async () => {
      const databaseUrl = await createDatabase("damaged");
      await applyMigrations(databaseUrl, baseMigrationsDirectory);

      let baseJournalCount;
      await withClient(databaseUrl, async (client) => {
        baseJournalCount = await appliedMigrationCount(client);
        await client.query(`
          drop trigger inbox_v2_ecs_state_guard_trigger
            on public.inbox_v2_employee_conversation_states
        `);
      });

      await expectMigrationFailure(
        databaseUrl,
        "inbox_v2.data_governance_privacy_foundation_missing"
      );
      await withClient(databaseUrl, async (client) => {
        expect(await appliedMigrationCount(client)).toBe(baseJournalCount);
        await expectDb009ObjectsAbsent(client);
      });
    }, 120_000);

    it("rolls back every DB-009 object and journal row after a late migration failure", async () => {
      const databaseUrl = await createDatabase("late");
      await applyMigrations(databaseUrl, baseMigrationsDirectory);
      const lateFailureMigrationsDirectory = await prepareMigrationDirectory(
        temporaryRoot,
        33,
        "late-failure"
      );
      const targetFiles = await migrationFilesAtIndex(
        lateFailureMigrationsDirectory,
        33
      );
      expect(targetFiles).toHaveLength(1);
      const targetPath = join(lateFailureMigrationsDirectory, targetFiles[0]);
      const targetSql = await readFile(targetPath, "utf8");
      await writeFile(
        targetPath,
        `${targetSql.trimEnd()}\n${statementBreakpoint}\ndo $db009_late_failure$\nbegin\n  raise exception '${lateFailureMessage}' using errcode = '23514';\nend;\n$db009_late_failure$;\n`,
        "utf8"
      );

      let baseJournalCount;
      await withClient(databaseUrl, async (client) => {
        baseJournalCount = await appliedMigrationCount(client);
      });
      await expectMigrationFailure(
        databaseUrl,
        lateFailureMessage,
        lateFailureMigrationsDirectory
      );
      await withClient(databaseUrl, async (client) => {
        expect(await appliedMigrationCount(client)).toBe(baseJournalCount);
        await expectDb009ObjectsAbsent(client);
      });
    }, 120_000);

    async function createDatabase(label) {
      const baseUrl = new URL(process.env.DATABASE_URL);
      const databaseName = `hulee_db009_${label}_${process.pid}_${createdDatabases.length}`;
      await adminClient.query(
        `create database ${quoteDatabaseName(databaseName)}`
      );
      createdDatabases.push(databaseName);
      baseUrl.pathname = `/${databaseName}`;
      return baseUrl.toString();
    }

    async function expectMigrationFailure(
      databaseUrl,
      expectedMessage,
      migrationsDirectory = targetMigrationsDirectory
    ) {
      let migrationError;
      try {
        await applyMigrations(databaseUrl, migrationsDirectory);
      } catch (error) {
        migrationError = error;
      }
      const databaseError = findDatabaseError(migrationError);
      expect(databaseError?.code).toBe("23514");
      expect(databaseError?.message).toBe(expectedMessage);
    }

    async function expectDb009Installed(databaseUrl) {
      await withClient(databaseUrl, async (client) => {
        expect(await installedRelations(client, expectedTables)).toEqual(
          expectedTables
        );
        expect(await installedTypes(client, expectedEnums)).toEqual(
          expectedEnums
        );
        expect(
          await installedFunctions(client, expectedInvariantFunctions)
        ).toEqual(expectedInvariantFunctions);
        expect(
          await installedTriggers(client, expectedInvariantTriggers)
        ).toEqual(expectedInvariantTriggers);
        expect(await appliedMigrationCount(client)).toBe(34);
      });
    }

    async function expectDb009ObjectsAbsent(client) {
      expect(await installedRelations(client, expectedTables)).toEqual([]);
      expect(await installedTypes(client, expectedEnums)).toEqual([]);
      expect(
        await installedFunctions(client, expectedInvariantFunctions)
      ).toEqual([]);
      expect(
        await installedTriggers(client, expectedInvariantTriggers)
      ).toEqual([]);
    }
  }
);

async function prepareMigrationDirectory(
  temporaryRoot,
  boundaryIndex,
  variant = null
) {
  const directory = join(
    temporaryRoot,
    `through-${boundaryIndex}${variant === null ? "" : `-${variant}`}`
  );
  const metadataDirectory = join(directory, "meta");
  await mkdir(metadataDirectory, { recursive: true });
  const journal = JSON.parse(
    await readFile(
      join(checkedInMigrationsDirectory, "meta/_journal.json"),
      "utf8"
    )
  );
  const boundedJournal = migrationJournal(journal, boundaryIndex);
  await Promise.all([
    writeFile(
      join(metadataDirectory, "_journal.json"),
      `${JSON.stringify(boundedJournal, null, 2)}\n`,
      "utf8"
    ),
    ...boundedJournal.entries.map(({ tag }) =>
      copyFile(
        join(checkedInMigrationsDirectory, `${tag}.sql`),
        join(directory, `${tag}.sql`)
      )
    )
  ]);
  return directory;
}

async function migrationFilesAtIndex(directory, index) {
  const journal = JSON.parse(
    await readFile(join(directory, "meta/_journal.json"), "utf8")
  );
  return journal.entries
    .filter((entry) => entry.idx === index)
    .map((entry) => `${entry.tag}.sql`);
}

async function applyMigrations(databaseUrl, migrationsDirectory) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: migrationsDirectory });
  } finally {
    await pool.end();
  }
}

async function installedRelations(client, names) {
  if (names.length === 0) return [];
  const result = await client.query(
    `select relation_name
       from unnest($1::text[]) as expected(relation_name)
      where to_regclass('public.' || relation_name) is not null
      order by relation_name`,
    [names]
  );
  return result.rows.map(({ relation_name: name }) => name);
}

async function installedTypes(client, names) {
  if (names.length === 0) return [];
  const result = await client.query(
    `select type_definition.typname as type_name
       from pg_catalog.pg_type type_definition
       join pg_catalog.pg_namespace type_namespace
         on type_namespace.oid = type_definition.typnamespace
      where type_namespace.nspname = 'public'
        and type_definition.typname = any($1::text[])
      order by type_definition.typname`,
    [names]
  );
  return result.rows.map(({ type_name: name }) => name);
}

async function installedFunctions(client, names) {
  if (names.length === 0) return [];
  const result = await client.query(
    `select function_definition.proname as function_name
       from pg_catalog.pg_proc function_definition
       join pg_catalog.pg_namespace function_namespace
         on function_namespace.oid = function_definition.pronamespace
      where function_namespace.nspname = 'public'
        and function_definition.proname = any($1::text[])
      order by function_definition.proname`,
    [names]
  );
  return result.rows.map(({ function_name: name }) => name);
}

async function installedTriggers(client, definitions) {
  if (definitions.length === 0) return [];
  const result = await client.query(
    `select
        trigger_definition.tgname as name,
        trigger_table.relname as "tableName",
        trigger_definition.tgenabled as enabled,
        (trigger_definition.tgconstraint <> 0) as "isConstraint",
        coalesce(trigger_constraint.condeferrable, false) as deferrable,
        coalesce(trigger_constraint.condeferred, false) as "initiallyDeferred"
       from pg_catalog.pg_trigger trigger_definition
       join pg_catalog.pg_class trigger_table
         on trigger_table.oid = trigger_definition.tgrelid
       join pg_catalog.pg_namespace trigger_namespace
         on trigger_namespace.oid = trigger_table.relnamespace
       left join pg_catalog.pg_constraint trigger_constraint
         on trigger_constraint.oid = trigger_definition.tgconstraint
       where not trigger_definition.tgisinternal
         and trigger_namespace.nspname = 'public'
         and trigger_definition.tgname = any($1::text[])
       order by trigger_definition.tgname`,
    [definitions.map(({ name }) => name)]
  );
  return result.rows;
}

async function appliedMigrationCount(client) {
  const result = await client.query(
    "select count(*)::int as count from drizzle.__drizzle_migrations"
  );
  return result.rows[0]?.count;
}

async function expectCoreFixture(client) {
  const result = await client.query(`
    select
      (select count(*)::text from public.employees
        where tenant_id = 'tenant:db009-upgrade') as employee_count,
      (select count(*)::text from public.clients
        where tenant_id = 'tenant:db009-upgrade') as client_count,
      (select count(*)::text from public.client_contacts
        where tenant_id = 'tenant:db009-upgrade') as contact_count
  `);
  expect(result.rows[0]).toEqual({
    employee_count: "1",
    client_count: "1",
    contact_count: "1"
  });
}

async function totalRows(client, tableNames, tolerateMissing = false) {
  let total = 0n;
  for (const tableName of tableNames) {
    if (tolerateMissing) {
      const relation = await client.query(
        "select to_regclass($1)::text as table_name",
        [`public.${tableName}`]
      );
      if (relation.rows[0]?.table_name === null) continue;
    }
    const result = await client.query(
      `select count(*)::text as count from public.${quoteIdentifier(tableName)}`
    );
    total += BigInt(result.rows[0]?.count ?? "0");
  }
  return total.toString();
}

async function withClient(databaseUrl, work) {
  const client = new pg.Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    return await work(client);
  } finally {
    await client.end().catch(() => {});
  }
}

function extractMatches(source, pattern) {
  const values = [...source.matchAll(pattern)].map((match) => match[1]);
  return [...new Set(values)].sort();
}

function extractExpectedInvariantTriggers(source) {
  const definitions = [];
  for (const match of source.matchAll(
    /create (constraint )?trigger (inbox_v2_[a-z0-9_]+)([\s\S]*?)on public\.([a-z0-9_]+)([\s\S]*?);/g
  )) {
    definitions.push(
      triggerDefinition({
        name: match[2],
        tableName: match[4],
        isConstraint: match[1] !== undefined,
        statement: match[0]
      })
    );
  }

  for (const match of source.matchAll(
    /foreach v_table in array array\[([\s\S]*?)\]\s*loop\s*v_trigger := '([^']+)' \|\| substr\(md5\(v_table\), 1, 16\);/g
  )) {
    const blockEnd = source.indexOf("end loop;", match.index);
    if (blockEnd < 0 || !/^inbox_v2_[a-z0-9_]+$/u.test(match[2])) {
      throw new Error("Invalid dynamic DB-009 trigger declaration.");
    }
    const statement = source.slice(match.index, blockEnd);
    const tableNames = [...match[1].matchAll(/'([^']+)'/g)].map(
      (tableMatch) => tableMatch[1]
    );
    if (tableNames.length === 0) {
      throw new Error("Dynamic DB-009 trigger declaration has no tables.");
    }
    for (const tableName of tableNames) {
      const suffix = createHash("md5")
        .update(tableName, "utf8")
        .digest("hex")
        .slice(0, 16);
      definitions.push(
        triggerDefinition({
          name: `${match[2]}${suffix}`,
          tableName,
          isConstraint: statement.includes("create constraint trigger %I"),
          statement
        })
      );
    }
  }

  const names = definitions.map(({ name }) => name);
  if (new Set(names).size !== names.length) {
    throw new Error(
      "DB-009 schema declares duplicate invariant trigger names."
    );
  }
  return definitions.sort((left, right) => left.name.localeCompare(right.name));
}

function triggerDefinition({ name, tableName, isConstraint, statement }) {
  const deferrable = /\bdeferrable\b/u.test(statement);
  const initiallyDeferred = /\binitially deferred\b/u.test(statement);
  if (initiallyDeferred && !deferrable) {
    throw new Error(`${name} is initially deferred but not deferrable.`);
  }
  return {
    name,
    tableName,
    enabled: "O",
    isConstraint,
    deferrable,
    initiallyDeferred
  };
}

function findDatabaseError(error) {
  let current = error;
  for (let depth = 0; depth < 10 && current; depth += 1) {
    if (
      typeof current === "object" &&
      typeof current.code === "string" &&
      typeof current.message === "string"
    ) {
      return current;
    }
    if (typeof current !== "object" || !("cause" in current)) break;
    const cause = current.cause;
    if (!cause || cause === current) break;
    current = cause;
  }
  return null;
}

function quoteDatabaseName(databaseName) {
  if (!/^hulee_db009_[a-z]+_[0-9]+_[0-9]+$/u.test(databaseName)) {
    throw new Error(`Unsafe DB-009 test database name: ${databaseName}`);
  }
  return `"${databaseName}"`;
}

function quoteIdentifier(identifier) {
  if (!/^inbox_v2_[a-z0-9_]+$/u.test(identifier)) {
    throw new Error(`Unsafe DB-009 identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}
