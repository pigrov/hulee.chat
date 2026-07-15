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
  "packages/db/src/schema/inbox-v2/security-denial.ts"
);
const finalizedMarker = "INBOX_V2_SECURITY_DENIAL_MIGRATION_FINALIZED_V1";
const statementBreakpoint = "--> statement-breakpoint";
const lateFailureMessage = "inbox_v2.security_denial_late_failure_test";

describePostgres(
  "Inbox V2 security-denial 0035 PostgreSQL migration lifecycle",
  () => {
    let adminClient;
    let baseMigrationsDirectory;
    let targetMigrationsDirectory;
    let temporaryRoot;
    let expectedTables;
    let expectedEnums;
    let expectedFunctions;
    const createdDatabases = [];

    beforeAll(async () => {
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) {
        throw new Error(
          "DATABASE_URL is required for the RBAC-007 migration lifecycle test."
        );
      }

      const schemaSource = await readFile(schemaPath, "utf8");
      expectedTables = extractMatches(schemaSource, /pgTable\(\s*"([^"]+)"/g);
      expectedEnums = extractMatches(schemaSource, /pgEnum\(\s*"([^"]+)"/g);
      expectedFunctions = extractMatches(
        schemaSource,
        /create or replace function public\.(inbox_v2_[a-z0-9_]+)\(/g
      );
      expect(expectedTables).toHaveLength(3);
      expect(expectedEnums).toHaveLength(11);
      expect(expectedFunctions).toEqual([
        "inbox_v2_security_denial_integrity_guard",
        "inbox_v2_security_denial_prune",
        "inbox_v2_security_denial_record"
      ]);

      temporaryRoot = await mkdtemp(
        join(tmpdir(), "hulee-rbac007-migrations-")
      );
      baseMigrationsDirectory = await prepareMigrationDirectory(
        temporaryRoot,
        34
      );
      targetMigrationsDirectory = await prepareMigrationDirectory(
        temporaryRoot,
        35
      );
      const targetFiles = await migrationFilesAtIndex(
        targetMigrationsDirectory,
        35
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

    it("installs the finalized RBAC-007 sink on a fresh database", async () => {
      const databaseUrl = await createDatabase("fresh");

      await applyMigrations(databaseUrl, targetMigrationsDirectory);

      await expectRbac007Installed(databaseUrl);
    }, 120_000);

    it("upgrades populated finalized 0034 data without inventing denial rows", async () => {
      const databaseUrl = await createDatabase("upgrade");
      await applyMigrations(databaseUrl, baseMigrationsDirectory);

      await withClient(databaseUrl, async (client) => {
        await client.query(`
          insert into public.tenants (id, slug, display_name)
          values (
            'tenant:rbac007-upgrade',
            'rbac007-upgrade',
            'RBAC007 upgrade'
          );
          insert into public.inbox_v2_auth_tenant_heads (
            tenant_id,
            tenant_rbac_revision,
            shared_access_revision,
            revision,
            created_at,
            updated_at
          ) values (
            'tenant:rbac007-upgrade', 1, 1, 1,
            timestamptz '2026-07-15 10:00:00+00',
            timestamptz '2026-07-15 10:00:00+00'
          );
          insert into public.inbox_v2_tenant_stream_heads (
            tenant_id,
            stream_epoch,
            last_position,
            min_retained_position,
            revision,
            created_at,
            updated_at
          ) values (
            'tenant:rbac007-upgrade',
            'epoch:rbac007-upgrade',
            0,
            0,
            1,
            timestamptz '2026-07-15 10:00:00+00',
            timestamptz '2026-07-15 10:00:00+00'
          );
        `);
        expect(await appliedMigrationCount(client)).toBe(35);
        await expectBaseFixture(client);
      });

      await applyMigrations(databaseUrl, targetMigrationsDirectory);

      await expectRbac007Installed(databaseUrl);
      await withClient(databaseUrl, async (client) => {
        await expectBaseFixture(client);
        expect(await totalRows(client, expectedTables)).toBe("0");
      });
    }, 120_000);

    it("rejects a partial RBAC-007 schema and leaves the 0034 journal unchanged", async () => {
      const databaseUrl = await createDatabase("partial");
      await applyMigrations(databaseUrl, baseMigrationsDirectory);
      const partialTable = expectedTables[0];
      let baseJournalCount;

      await withClient(databaseUrl, async (client) => {
        baseJournalCount = await appliedMigrationCount(client);
        await client.query(
          `create table public.${quoteIdentifier(partialTable)} (id text)`
        );
      });

      await expectMigrationFailure(
        databaseUrl,
        "inbox_v2.security_denial_partial_schema_detected"
      );
      await withClient(databaseUrl, async (client) => {
        expect(await appliedMigrationCount(client)).toBe(baseJournalCount);
        expect(await installedRelations(client, expectedTables)).toEqual([
          partialTable
        ]);
        expect(await installedTypes(client, expectedEnums)).toEqual([]);
        expect(await installedFunctions(client, expectedFunctions)).toEqual([]);
      });
    }, 120_000);

    it("rejects a damaged finalized-0034 anchor and leaves no RBAC-007 objects", async () => {
      const databaseUrl = await createDatabase("anchor");
      await applyMigrations(databaseUrl, baseMigrationsDirectory);
      let baseJournalCount;

      await withClient(databaseUrl, async (client) => {
        baseJournalCount = await appliedMigrationCount(client);
        await client.query(`
          alter table public.inbox_v2_auth_command_records
            rename constraint inbox_v2_auth_command_records_pk
            to inbox_v2_auth_command_records_pk_damaged
        `);
      });

      await expectMigrationFailure(
        databaseUrl,
        "inbox_v2.security_denial_foundation_missing"
      );
      await withClient(databaseUrl, async (client) => {
        expect(await appliedMigrationCount(client)).toBe(baseJournalCount);
        await expectRbac007ObjectsAbsent(client);
      });
    }, 120_000);

    it("rolls back every RBAC-007 object and journal row after a late failure", async () => {
      const databaseUrl = await createDatabase("late");
      await applyMigrations(databaseUrl, baseMigrationsDirectory);
      const lateFailureMigrationsDirectory = await prepareMigrationDirectory(
        temporaryRoot,
        35,
        "late-failure"
      );
      const targetFiles = await migrationFilesAtIndex(
        lateFailureMigrationsDirectory,
        35
      );
      expect(targetFiles).toHaveLength(1);
      const targetPath = join(lateFailureMigrationsDirectory, targetFiles[0]);
      const targetSql = await readFile(targetPath, "utf8");
      await writeFile(
        targetPath,
        `${targetSql.trimEnd()}\n${statementBreakpoint}\ndo $rbac007_late_failure$\nbegin\n  raise exception '${lateFailureMessage}' using errcode = '23514';\nend;\n$rbac007_late_failure$;\n`,
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
        await expectRbac007ObjectsAbsent(client);
      });
    }, 120_000);

    async function createDatabase(label) {
      const baseUrl = new URL(process.env.DATABASE_URL);
      const databaseName = `hulee_rbac007_${label}_${process.pid}_${createdDatabases.length}`;
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

    async function expectRbac007Installed(databaseUrl) {
      await withClient(databaseUrl, async (client) => {
        expect(await installedRelations(client, expectedTables)).toEqual(
          expectedTables
        );
        expect(await installedTypes(client, expectedEnums)).toEqual(
          expectedEnums
        );
        expect(await installedFunctions(client, expectedFunctions)).toEqual(
          expectedFunctions
        );
        expect(await appliedMigrationCount(client)).toBe(36);
      });
    }

    async function expectRbac007ObjectsAbsent(client) {
      expect(await installedRelations(client, expectedTables)).toEqual([]);
      expect(await installedTypes(client, expectedEnums)).toEqual([]);
      expect(await installedFunctions(client, expectedFunctions)).toEqual([]);
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

async function appliedMigrationCount(client) {
  const result = await client.query(
    "select count(*)::int as count from drizzle.__drizzle_migrations"
  );
  return result.rows[0]?.count;
}

async function expectBaseFixture(client) {
  const result = await client.query(`
    select
      (select count(*)::text from public.inbox_v2_auth_tenant_heads
        where tenant_id = 'tenant:rbac007-upgrade'
          and tenant_rbac_revision = 1
          and shared_access_revision = 1
          and revision = 1) as auth_head_count,
      (select count(*)::text from public.inbox_v2_tenant_stream_heads
        where tenant_id = 'tenant:rbac007-upgrade'
          and stream_epoch = 'epoch:rbac007-upgrade'
          and last_position = 0
          and min_retained_position = 0
          and revision = 1) as stream_head_count
  `);
  expect(result.rows[0]).toEqual({
    auth_head_count: "1",
    stream_head_count: "1"
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
  if (!/^hulee_rbac007_[a-z]+_[0-9]+_[0-9]+$/u.test(databaseName)) {
    throw new Error(`Unsafe RBAC-007 test database name: ${databaseName}`);
  }
  return `"${databaseName}"`;
}

function quoteIdentifier(identifier) {
  if (!/^inbox_v2_[a-z0-9_]+$/u.test(identifier)) {
    throw new Error(`Unsafe RBAC-007 identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}
