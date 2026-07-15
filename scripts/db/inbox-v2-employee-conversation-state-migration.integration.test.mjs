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
const finalizedMarker =
  "INBOX_V2_EMPLOYEE_CONVERSATION_STATE_MIGRATION_FINALIZED_V1";

describePostgres(
  "Inbox V2 EmployeeConversationState 0032 PostgreSQL migration lifecycle",
  () => {
    let adminClient;
    let baseMigrationsDirectory;
    let targetMigrationsDirectory;
    let temporaryRoot;
    const createdDatabases = [];

    beforeAll(async () => {
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) {
        throw new Error(
          "DATABASE_URL is required for the DB-006 migration lifecycle test."
        );
      }

      temporaryRoot = await mkdtemp(join(tmpdir(), "hulee-db006-migrations-"));
      baseMigrationsDirectory = await prepareMigrationDirectory(
        temporaryRoot,
        31
      );
      targetMigrationsDirectory = await prepareMigrationDirectory(
        temporaryRoot,
        32
      );
      const targetFiles = await migrationFilesAtIndex(
        targetMigrationsDirectory,
        32
      );
      expect(targetFiles).toHaveLength(1);
      await expect(
        readFile(join(targetMigrationsDirectory, targetFiles[0]), "utf8")
      ).resolves.toContain(finalizedMarker);

      adminClient = new pg.Client({ connectionString: databaseUrl });
      await adminClient.connect();
    });

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
    });

    it("installs the finalized DB-006 schema on a fresh database", async () => {
      const databaseUrl = await createDatabase("fresh");
      await applyMigrations(databaseUrl, targetMigrationsDirectory);
      await expectDb006Installed(databaseUrl);
    }, 120_000);

    it("upgrades a populated finalized 0031 database without rewriting anchors", async () => {
      const databaseUrl = await createDatabase("upgrade");
      await applyMigrations(databaseUrl, baseMigrationsDirectory);

      await withClient(databaseUrl, async (client) => {
        await client.query(`
          insert into public.tenants (id, slug, display_name)
          values ('tenant:db006-upgrade', 'db006-upgrade', 'DB006 upgrade');
          insert into public.employees (
            id, tenant_id, email, display_name
          ) values (
            'employee:db006-upgrade', 'tenant:db006-upgrade',
            'db006-upgrade@example.test', 'DB006 Employee'
          );
        `);
        expect(await appliedMigrationCount(client)).toBe(32);
        expect(await employeeCount(client)).toBe("1");
        expect(
          (
            await client.query(
              "select to_regclass('public.inbox_v2_employee_conversation_states')::text as table_name"
            )
          ).rows[0]?.table_name
        ).toBeNull();
      });

      await applyMigrations(databaseUrl, targetMigrationsDirectory);
      await expectDb006Installed(databaseUrl);
      await withClient(databaseUrl, async (client) => {
        expect(await employeeCount(client)).toBe("1");
        expect(
          (
            await client.query(
              "select count(*)::text as count from public.inbox_v2_employee_conversation_states"
            )
          ).rows[0]?.count
        ).toBe("0");
      });
    }, 120_000);

    it("rejects a partial DB-006 schema and leaves the 0031 journal unchanged", async () => {
      const databaseUrl = await createDatabase("negative");
      await applyMigrations(databaseUrl, baseMigrationsDirectory);

      let baseJournalCount;
      await withClient(databaseUrl, async (client) => {
        baseJournalCount = await appliedMigrationCount(client);
        await client.query(`
          create type public.inbox_v2_employee_conversation_notification_level
          as enum ('inherit', 'all', 'mentions_only', 'none')
        `);
      });

      let migrationError;
      try {
        await applyMigrations(databaseUrl, targetMigrationsDirectory);
      } catch (error) {
        migrationError = error;
      }
      const databaseError = findDatabaseError(migrationError);
      expect(databaseError?.code).toBe("23514");
      expect(databaseError?.message).toBe(
        "inbox_v2.employee_conversation_state_partial_schema_detected"
      );

      await withClient(databaseUrl, async (client) => {
        expect(await appliedMigrationCount(client)).toBe(baseJournalCount);
        expect(
          (
            await client.query(
              "select to_regclass('public.inbox_v2_employee_conversation_states')::text as table_name"
            )
          ).rows[0]?.table_name
        ).toBeNull();
      });
    }, 120_000);

    async function createDatabase(label) {
      const baseUrl = new URL(process.env.DATABASE_URL);
      const databaseName = `hulee_db006_${label}_${process.pid}_${createdDatabases.length}`;
      await adminClient.query(
        `create database ${quoteDatabaseName(databaseName)}`
      );
      createdDatabases.push(databaseName);
      baseUrl.pathname = `/${databaseName}`;
      return baseUrl.toString();
    }
  }
);

async function prepareMigrationDirectory(temporaryRoot, boundaryIndex) {
  const directory = join(temporaryRoot, `through-${boundaryIndex}`);
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

async function expectDb006Installed(databaseUrl) {
  await withClient(databaseUrl, async (client) => {
    const result = await client.query(`
      select
        to_regclass('public.inbox_v2_employee_conversation_states')::text
          as "stateTable",
        exists (
          select 1
            from pg_catalog.pg_type type_definition
            join pg_catalog.pg_namespace type_namespace
              on type_namespace.oid = type_definition.typnamespace
           where type_namespace.nspname = 'public'
             and type_definition.typname =
               'inbox_v2_employee_conversation_notification_level'
        ) as "notificationLevelEnum",
        (
          select count(*)::int
            from pg_catalog.pg_proc function_definition
            join pg_catalog.pg_namespace function_namespace
              on function_namespace.oid = function_definition.pronamespace
           where function_namespace.nspname = 'public'
             and function_definition.proname = any(array[
               'inbox_v2_ecs_state_guard',
               'inbox_v2_ecs_read_cursor_guard'
             ]::text[])
        ) as "invariantFunctions",
        (
          select count(*)::int
            from pg_catalog.pg_trigger trigger_definition
           where trigger_definition.tgrelid =
             'public.inbox_v2_employee_conversation_states'::regclass
             and not trigger_definition.tgisinternal
        ) as "stateTriggers",
        (
          select count(*)::int
            from pg_catalog.pg_indexes index_definition
           where index_definition.schemaname = 'public'
             and index_definition.tablename =
               'inbox_v2_employee_conversation_states'
             and index_definition.indexname like
               'inbox_v2_employee_conversation_states_%'
        ) as "stateIndexes"
    `);

    expect(result.rows[0]).toEqual({
      stateTable: "inbox_v2_employee_conversation_states",
      notificationLevelEnum: true,
      invariantFunctions: 2,
      stateTriggers: 2,
      stateIndexes: 5
    });
    expect(await appliedMigrationCount(client)).toBe(33);
  });
}

async function appliedMigrationCount(client) {
  const result = await client.query(
    "select count(*)::int as count from drizzle.__drizzle_migrations"
  );
  return result.rows[0]?.count;
}

async function employeeCount(client) {
  const result = await client.query(
    "select count(*)::text as count from public.employees where tenant_id = 'tenant:db006-upgrade'"
  );
  return result.rows[0]?.count;
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
  if (!/^hulee_db006_[a-z]+_[0-9]+_[0-9]+$/u.test(databaseName)) {
    throw new Error(`Unsafe DB-006 test database name: ${databaseName}`);
  }
  return `"${databaseName}"`;
}
