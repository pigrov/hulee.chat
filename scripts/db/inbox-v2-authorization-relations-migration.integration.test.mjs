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
  "packages/db/src/schema/inbox-v2/authorization-relations.ts"
);
const finalizedMarker =
  "INBOX_V2_AUTHORIZATION_RELATIONS_MIGRATION_FINALIZED_V1";
const statementBreakpoint = "--> statement-breakpoint";
const lateFailureMessage = "inbox_v2.authorization_relations_late_failure_test";
const replaceableFoundationFunctions = [
  "inbox_v2_work_item_aggregate_coherence",
  "inbox_v2_work_item_mutation_coherence"
];

describePostgres(
  "Inbox V2 authorization relations 0034 PostgreSQL migration lifecycle",
  () => {
    let adminClient;
    let baseMigrationsDirectory;
    let targetMigrationsDirectory;
    let temporaryRoot;
    let expectedTables;
    let expectedEnums;
    let expectedInvariantFunctions;
    let expectedNewInvariantFunctions;
    let expectedInvariantTriggers;
    const createdDatabases = [];

    beforeAll(async () => {
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) {
        throw new Error(
          "DATABASE_URL is required for the RBAC-003 migration lifecycle test."
        );
      }

      const schemaSource = await readFile(schemaPath, "utf8");
      expectedTables = extractMatches(schemaSource, /pgTable\(\s*"([^"]+)"/g);
      expectedEnums = extractMatches(schemaSource, /pgEnum\(\s*"([^"]+)"/g);
      expectedInvariantFunctions = extractMatches(
        schemaSource,
        /create or replace function public\.(inbox_v2_[a-z0-9_]+)\(/g
      );
      expectedNewInvariantFunctions = expectedInvariantFunctions.filter(
        (functionName) => !replaceableFoundationFunctions.includes(functionName)
      );
      expectedInvariantTriggers =
        extractExpectedInvariantTriggers(schemaSource);
      expect(expectedTables.length).toBeGreaterThan(0);
      expect(expectedEnums.length).toBeGreaterThan(0);
      expect(expectedInvariantFunctions.length).toBeGreaterThan(0);
      expect(expectedInvariantTriggers.length).toBeGreaterThan(0);

      temporaryRoot = await mkdtemp(
        join(tmpdir(), "hulee-rbac003-migrations-")
      );
      baseMigrationsDirectory = await prepareMigrationDirectory(
        temporaryRoot,
        33
      );
      targetMigrationsDirectory = await prepareMigrationDirectory(
        temporaryRoot,
        34
      );
      const targetFiles = await migrationFilesAtIndex(
        targetMigrationsDirectory,
        34
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

    it("installs the finalized RBAC-003 schema on a fresh database", async () => {
      const databaseUrl = await createDatabase("fresh");
      await applyMigrations(databaseUrl, targetMigrationsDirectory);
      await expectRbac003Installed(databaseUrl);
    }, 120_000);

    it("upgrades a populated finalized 0033 database without inventing authorization relations", async () => {
      const databaseUrl = await createDatabase("upgrade");
      await applyMigrations(databaseUrl, baseMigrationsDirectory);
      let baseBridgeDefinitions;

      await withClient(databaseUrl, async (client) => {
        await client.query(`
          insert into public.tenants (id, slug, display_name)
          values (
            'tenant:rbac003-upgrade',
            'rbac003-upgrade',
            'RBAC003 upgrade'
          );
          insert into public.employees (
            id, tenant_id, email, display_name
          ) values (
            'employee:rbac003-upgrade',
            'tenant:rbac003-upgrade',
            'rbac003-upgrade@example.test',
            'RBAC003 Employee'
          );
          insert into public.clients (
            id, tenant_id, display_name, source, responsible_employee_id
          ) values (
            'client:rbac003-upgrade',
            'tenant:rbac003-upgrade',
            'RBAC003 Client',
            'migration-test',
            'employee:rbac003-upgrade'
          );
          insert into public.client_contacts (
            id, tenant_id, client_id, type, value
          ) values (
            'client_contact:rbac003-upgrade',
            'tenant:rbac003-upgrade',
            'client:rbac003-upgrade',
            'email',
            'client-rbac003@example.test'
          );
        `);
        expect(await appliedMigrationCount(client)).toBe(34);
        await expectCoreFixture(client);
        baseBridgeDefinitions = await installedFunctionDefinitions(
          client,
          replaceableFoundationFunctions
        );
      });

      await applyMigrations(databaseUrl, targetMigrationsDirectory);
      await expectRbac003Installed(databaseUrl);
      await withClient(databaseUrl, async (client) => {
        await expectCoreFixture(client);
        expect(await totalRows(client, expectedTables)).toBe("0");
        const upgradedBridgeDefinitions = await installedFunctionDefinitions(
          client,
          replaceableFoundationFunctions
        );
        expect(upgradedBridgeDefinitions).not.toEqual(baseBridgeDefinitions);
        for (const definition of upgradedBridgeDefinitions) {
          expect(definition.definition).toContain("collaborator_set");
        }
      });
    }, 120_000);

    it("rejects a partial RBAC-003 schema and leaves the 0033 journal unchanged", async () => {
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
        "inbox_v2.authorization_relations_partial_schema_detected"
      );
      await withClient(databaseUrl, async (client) => {
        expect(await appliedMigrationCount(client)).toBe(baseJournalCount);
        expect(await installedRelations(client, expectedTables)).toEqual([
          partialTable
        ]);
        expect(await installedTypes(client, expectedEnums)).toEqual([]);
        expect(
          await installedFunctions(client, expectedNewInvariantFunctions)
        ).toEqual([]);
        expect(
          await installedFunctions(client, replaceableFoundationFunctions)
        ).toEqual(replaceableFoundationFunctions);
        expect(
          await installedTriggers(client, expectedInvariantTriggers)
        ).toEqual([]);
      });
    }, 120_000);

    it("rejects a damaged foundation constraint and leaves the journal unchanged", async () => {
      const databaseUrl = await createDatabase("constraint");
      await applyMigrations(databaseUrl, baseMigrationsDirectory);

      let baseJournalCount;
      await withClient(databaseUrl, async (client) => {
        baseJournalCount = await appliedMigrationCount(client);
        await client.query(`
          alter table public.employees
            rename constraint employees_tenant_id_unique
            to employees_tenant_id_unique_damaged
        `);
      });

      await expectMigrationFailure(
        databaseUrl,
        "inbox_v2.authorization_relations_foundation_missing"
      );
      await withClient(databaseUrl, async (client) => {
        expect(await appliedMigrationCount(client)).toBe(baseJournalCount);
        await expectRbac003ObjectsAbsent(client);
      });
    }, 120_000);

    it("rejects a damaged finalized 0033 trigger and leaves the journal unchanged", async () => {
      const databaseUrl = await createDatabase("trigger");
      await applyMigrations(databaseUrl, baseMigrationsDirectory);

      let baseJournalCount;
      await withClient(databaseUrl, async (client) => {
        baseJournalCount = await appliedMigrationCount(client);
        await client.query(`
          alter trigger inbox_v2_dg_deletion_run_transition_guard_trigger
            on public.inbox_v2_data_governance_deletion_runs
            rename to inbox_v2_dg_deletion_run_transition_guard_damaged
        `);
      });

      await expectMigrationFailure(
        databaseUrl,
        "inbox_v2.authorization_relations_foundation_missing"
      );
      await withClient(databaseUrl, async (client) => {
        expect(await appliedMigrationCount(client)).toBe(baseJournalCount);
        await expectRbac003ObjectsAbsent(client);
      });
    }, 120_000);

    it("rejects a WorkItem bridge caller rebound to the wrong function without changing journal or bridge definitions", async () => {
      const databaseUrl = await createDatabase("bridge");
      await applyMigrations(databaseUrl, baseMigrationsDirectory);
      const triggerName = "inbox_v2_work_items_aggregate_constraint";
      const tableName = "inbox_v2_work_items";

      let baseJournalCount;
      let baseBridgeDefinitions;
      let damagedTriggerFingerprint;
      await withClient(databaseUrl, async (client) => {
        baseJournalCount = await appliedMigrationCount(client);
        baseBridgeDefinitions = await installedFunctionDefinitions(
          client,
          replaceableFoundationFunctions
        );
        await client.query(`
          drop trigger inbox_v2_work_items_aggregate_constraint
            on public.inbox_v2_work_items;
          create constraint trigger inbox_v2_work_items_aggregate_constraint
            after insert or update on public.inbox_v2_work_items
            deferrable initially deferred
            for each row execute function
              public.inbox_v2_work_item_mutation_coherence()
        `);
        damagedTriggerFingerprint = await installedTriggerFingerprint(
          client,
          triggerName,
          tableName
        );
        expect(damagedTriggerFingerprint).toMatchObject({
          name: triggerName,
          tableName,
          functionName: "inbox_v2_work_item_mutation_coherence",
          triggerType: 21,
          enabled: "O",
          internal: false,
          deferrable: true,
          initiallyDeferred: true
        });
      });

      await expectMigrationFailure(
        databaseUrl,
        "inbox_v2.authorization_relations_foundation_missing"
      );
      await withClient(databaseUrl, async (client) => {
        expect(await appliedMigrationCount(client)).toBe(baseJournalCount);
        await expectRbac003ObjectsAbsent(client);
        expect(
          await installedFunctionDefinitions(
            client,
            replaceableFoundationFunctions
          )
        ).toEqual(baseBridgeDefinitions);
        expect(
          await installedTriggerFingerprint(client, triggerName, tableName)
        ).toEqual(damagedTriggerFingerprint);
      });
    }, 120_000);

    it("rolls back every RBAC-003 object and journal row after a late migration failure", async () => {
      const databaseUrl = await createDatabase("late");
      await applyMigrations(databaseUrl, baseMigrationsDirectory);
      const lateFailureMigrationsDirectory = await prepareMigrationDirectory(
        temporaryRoot,
        34,
        "late-failure"
      );
      const targetFiles = await migrationFilesAtIndex(
        lateFailureMigrationsDirectory,
        34
      );
      expect(targetFiles).toHaveLength(1);
      const targetPath = join(lateFailureMigrationsDirectory, targetFiles[0]);
      const targetSql = await readFile(targetPath, "utf8");
      await writeFile(
        targetPath,
        `${targetSql.trimEnd()}\n${statementBreakpoint}\ndo $rbac003_late_failure$\nbegin\n  raise exception '${lateFailureMessage}' using errcode = '23514';\nend;\n$rbac003_late_failure$;\n`,
        "utf8"
      );

      let baseJournalCount;
      let baseBridgeDefinitions;
      await withClient(databaseUrl, async (client) => {
        baseJournalCount = await appliedMigrationCount(client);
        baseBridgeDefinitions = await installedFunctionDefinitions(
          client,
          replaceableFoundationFunctions
        );
      });
      await expectMigrationFailure(
        databaseUrl,
        lateFailureMessage,
        lateFailureMigrationsDirectory
      );
      await withClient(databaseUrl, async (client) => {
        expect(await appliedMigrationCount(client)).toBe(baseJournalCount);
        await expectRbac003ObjectsAbsent(client);
        expect(
          await installedFunctionDefinitions(
            client,
            replaceableFoundationFunctions
          )
        ).toEqual(baseBridgeDefinitions);
      });
    }, 120_000);

    async function createDatabase(label) {
      const baseUrl = new URL(process.env.DATABASE_URL);
      const databaseName = `hulee_rbac003_${label}_${process.pid}_${createdDatabases.length}`;
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

    async function expectRbac003Installed(databaseUrl) {
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
        expect(await appliedMigrationCount(client)).toBe(35);
      });
    }

    async function expectRbac003ObjectsAbsent(client) {
      expect(await installedRelations(client, expectedTables)).toEqual([]);
      expect(await installedTypes(client, expectedEnums)).toEqual([]);
      expect(
        await installedFunctions(client, expectedNewInvariantFunctions)
      ).toEqual([]);
      expect(
        await installedFunctions(client, replaceableFoundationFunctions)
      ).toEqual(replaceableFoundationFunctions);
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

async function installedFunctionDefinitions(client, names) {
  if (names.length === 0) return [];
  const result = await client.query(
    `select
        function_definition.proname as name,
        pg_catalog.pg_get_functiondef(function_definition.oid) as definition
       from pg_catalog.pg_proc function_definition
       join pg_catalog.pg_namespace function_namespace
         on function_namespace.oid = function_definition.pronamespace
      where function_namespace.nspname = 'public'
        and function_definition.proname = any($1::text[])
      order by function_definition.proname`,
    [names]
  );
  return result.rows;
}

async function installedTriggerFingerprint(client, triggerName, tableName) {
  const result = await client.query(
    `select
        trigger_definition.tgname as name,
        trigger_table.relname as "tableName",
        function_definition.proname as "functionName",
        trigger_definition.tgtype::int as "triggerType",
        trigger_definition.tgenabled as enabled,
        trigger_definition.tgisinternal as internal,
        trigger_definition.tgdeferrable as deferrable,
        trigger_definition.tginitdeferred as "initiallyDeferred"
       from pg_catalog.pg_trigger trigger_definition
       join pg_catalog.pg_class trigger_table
         on trigger_table.oid = trigger_definition.tgrelid
       join pg_catalog.pg_namespace trigger_namespace
         on trigger_namespace.oid = trigger_table.relnamespace
       join pg_catalog.pg_proc function_definition
         on function_definition.oid = trigger_definition.tgfoid
      where trigger_namespace.nspname = 'public'
        and trigger_table.relname = $1
        and trigger_definition.tgname = $2`,
    [tableName, triggerName]
  );
  expect(result.rows).toHaveLength(1);
  return result.rows[0];
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
        where tenant_id = 'tenant:rbac003-upgrade') as employee_count,
      (select count(*)::text from public.clients
        where tenant_id = 'tenant:rbac003-upgrade') as client_count,
      (select count(*)::text from public.client_contacts
        where tenant_id = 'tenant:rbac003-upgrade') as contact_count
  `);
  expect(result.rows[0]).toEqual({
    employee_count: "1",
    client_count: "1",
    contact_count: "1"
  });
}

async function totalRows(client, tableNames) {
  let total = 0n;
  for (const tableName of tableNames) {
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
      throw new Error("Invalid dynamic RBAC-003 trigger declaration.");
    }
    const statement = source.slice(match.index, blockEnd);
    const tableNames = [...match[1].matchAll(/'([^']+)'/g)].map(
      (tableMatch) => tableMatch[1]
    );
    if (tableNames.length === 0) {
      throw new Error("Dynamic RBAC-003 trigger declaration has no tables.");
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
      "RBAC-003 schema declares duplicate invariant trigger names."
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
  if (!/^hulee_rbac003_[a-z]+_[0-9]+_[0-9]+$/u.test(databaseName)) {
    throw new Error(`Unsafe RBAC-003 test database name: ${databaseName}`);
  }
  return `"${databaseName}"`;
}

function quoteIdentifier(identifier) {
  if (!/^inbox_v2_[a-z0-9_]+$/u.test(identifier)) {
    throw new Error(`Unsafe RBAC-003 identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}
