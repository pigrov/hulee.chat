import {
  appendFile,
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
const finalizedMarker = "INBOX_V2_SOURCE_REGISTRY_MIGRATION_FINALIZED_V1";
const migrationIndex = 39;
const baseMigrationIndex = 38;

describePostgres("Inbox V2 source-registry 0039 PostgreSQL lifecycle", () => {
  let adminClient;
  let baseMigrationsDirectory;
  let targetMigrationsDirectory;
  let failingMigrationsDirectory;
  let temporaryRoot;
  const createdDatabases = [];

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(
        "DATABASE_URL is required for the SRC-010 migration lifecycle test."
      );
    }

    temporaryRoot = await mkdtemp(join(tmpdir(), "hulee-src010-migrations-"));
    baseMigrationsDirectory = await prepareMigrationDirectory(
      temporaryRoot,
      "base",
      baseMigrationIndex
    );
    targetMigrationsDirectory = await prepareMigrationDirectory(
      temporaryRoot,
      "target",
      migrationIndex
    );
    failingMigrationsDirectory = await prepareMigrationDirectory(
      temporaryRoot,
      "failing",
      migrationIndex
    );

    const targetFiles = await migrationFilesAtIndex(
      targetMigrationsDirectory,
      migrationIndex
    );
    expect(targetFiles).toHaveLength(1);
    await expect(
      readFile(join(targetMigrationsDirectory, targetFiles[0]), "utf8")
    ).resolves.toContain(finalizedMarker);
    await appendFile(
      join(failingMigrationsDirectory, targetFiles[0]),
      "\n--> statement-breakpoint\nselect inbox_v2_src010_forced_late_failure();\n",
      "utf8"
    );

    adminClient = new pg.Client({ connectionString: databaseUrl });
    await adminClient.connect();
  }, 60_000);

  afterAll(async () => {
    const cleanupErrors = [];
    if (adminClient) {
      for (const databaseName of createdDatabases.reverse()) {
        try {
          await adminClient.query(
            `drop database if exists ${quoteDatabaseName(databaseName)} with (force)`
          );
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      await adminClient.end().catch((error) => cleanupErrors.push(error));
    }
    if (temporaryRoot) {
      await rm(temporaryRoot, { recursive: true, force: true }).catch((error) =>
        cleanupErrors.push(error)
      );
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        cleanupErrors,
        "SRC-010 migration lifecycle cleanup failed."
      );
    }
  }, 120_000);

  it("installs the complete registry from a fresh database", async () => {
    const databaseUrl = await createDatabase("fresh");
    await applyMigrations(databaseUrl, targetMigrationsDirectory);
    await expectSourceRegistryInstalled(databaseUrl);
  }, 120_000);

  it("upgrades the current 0038 schema without replacing existing objects", async () => {
    const databaseUrl = await createDatabase("current");
    await applyMigrations(databaseUrl, baseMigrationsDirectory);
    await expectSourceRegistryAbsent(databaseUrl, 39);

    await applyMigrations(databaseUrl, targetMigrationsDirectory);
    await expectSourceRegistryInstalled(databaseUrl);
  }, 120_000);

  it("rejects a cross-tenant legacy connector before adding any target object", async () => {
    const databaseUrl = await createDatabase("incoherent");
    await applyMigrations(databaseUrl, baseMigrationsDirectory);
    await withClient(databaseUrl, async (client) => {
      await client.query(`
        insert into public.tenants (id, slug, display_name)
        values
          ('tenant:src010-owner', 'src010-owner', 'SRC-010 owner'),
          ('tenant:src010-forged', 'src010-forged', 'SRC-010 forged');

        insert into public.source_connections (
          id, tenant_id, source_type, source_name, display_name
        ) values (
          'source_connection:src010-owner', 'tenant:src010-owner',
          'messenger', 'synthetic', 'Synthetic'
        );

        insert into public.channel_connectors (
          id, tenant_id, channel_type, channel_class, provider, display_name,
          source_connection_id
        ) values (
          'connector:src010-forged', 'tenant:src010-forged',
          'synthetic', 'direct', 'synthetic', 'Forged',
          'source_connection:src010-owner'
        );
      `);
    });

    await expect(
      applyMigrations(databaseUrl, targetMigrationsDirectory)
    ).rejects.toThrow(/source_registry_preflight_connector_incoherent/u);
    await expectSourceRegistryAbsent(databaseUrl, 39);
  }, 120_000);

  it("rolls back every target object after a forced late failure", async () => {
    const databaseUrl = await createDatabase("rollback");
    await applyMigrations(databaseUrl, baseMigrationsDirectory);

    await expect(
      applyMigrations(databaseUrl, failingMigrationsDirectory)
    ).rejects.toThrow();
    await expectSourceRegistryAbsent(databaseUrl, 39);
  }, 120_000);

  async function createDatabase(label) {
    const baseUrl = new URL(process.env.DATABASE_URL);
    const databaseName = `hulee_src010_${label}_${process.pid}_${createdDatabases.length}`;
    await adminClient.query(
      `create database ${quoteDatabaseName(databaseName)}`
    );
    createdDatabases.push(databaseName);
    baseUrl.pathname = `/${databaseName}`;
    return baseUrl.toString();
  }
});

async function prepareMigrationDirectory(temporaryRoot, label, boundaryIndex) {
  const directory = join(temporaryRoot, `${label}-through-${boundaryIndex}`);
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

async function expectSourceRegistryInstalled(databaseUrl) {
  await withClient(databaseUrl, async (client) => {
    const result = await client.query(`
      select
        to_regclass('public.inbox_v2_source_account_identities') is not null
          as "identityHeadPresent",
        to_regtype('public.inbox_v2_source_registry_secret_kind') is null
          as "deadSecretKindAbsent",
        (
          select count(*)::int
            from unnest(array[
              to_regclass('public.inbox_v2_source_registry_transitions'),
              to_regclass('public.inbox_v2_source_registry_heads'),
              to_regclass('public.inbox_v2_source_registry_artifact_refs'),
              to_regclass('public.inbox_v2_source_registry_secret_refs'),
              to_regclass('public.inbox_v2_source_registry_ingress_routes'),
              to_regclass('public.inbox_v2_source_registry_related_authority_refs')
            ]) relation_name
           where relation_name is not null
        ) as "targetTables",
        (
          select count(*)::int
            from pg_catalog.pg_trigger trigger_row
           where not trigger_row.tgisinternal
             and trigger_row.tgname like 'inbox_v2_source_registry_%'
        ) as "targetTriggers",
        (
          select count(*)::int
            from pg_catalog.pg_trigger trigger_row
           where not trigger_row.tgisinternal
             and trigger_row.tgname like 'inbox_v2_source_registry_%'
             and trigger_row.tgdeferrable
             and trigger_row.tginitdeferred
        ) as "deferredTriggers",
        (
          select to_json(
                   array_agg(attribute.attname::text order by key_column.ordinality)
                 )
            from pg_catalog.pg_constraint constraint_row
            cross join lateral unnest(constraint_row.conkey)
              with ordinality as key_column(attribute_number, ordinality)
            join pg_catalog.pg_attribute attribute
              on attribute.attrelid = constraint_row.conrelid
             and attribute.attnum = key_column.attribute_number
           where constraint_row.conname =
             'inbox_v2_source_registry_transitions_authority_revision_unique'
        ) as "transitionAuthorityColumns"
    `);
    expect(result.rows[0]).toEqual({
      identityHeadPresent: true,
      deadSecretKindAbsent: true,
      targetTables: 6,
      targetTriggers: 16,
      deferredTriggers: 9,
      transitionAuthorityColumns: [
        "tenant_id",
        "transition_id",
        "authority_id",
        "resulting_revision"
      ]
    });
    expect(await appliedMigrationCount(client)).toBe(40);
  });
}

async function expectSourceRegistryAbsent(databaseUrl, expectedMigrationCount) {
  await withClient(databaseUrl, async (client) => {
    const result = await client.query(`
      select
        to_regclass('public.inbox_v2_source_registry_transitions') is null
          as "transitionsAbsent",
        to_regclass('public.inbox_v2_source_registry_heads') is null
          as "headsAbsent",
        to_regprocedure('public.inbox_v2_source_registry_transition_guard()')
          is null as "guardAbsent",
        not exists (
          select 1
            from pg_catalog.pg_constraint
           where conname =
             'inbox_v2_source_registry_transitions_authority_revision_unique'
        ) as "transitionAuthorityUniqueAbsent"
    `);
    expect(result.rows[0]).toEqual({
      transitionsAbsent: true,
      headsAbsent: true,
      guardAbsent: true,
      transitionAuthorityUniqueAbsent: true
    });
    expect(await appliedMigrationCount(client)).toBe(expectedMigrationCount);
  });
}

async function appliedMigrationCount(client) {
  const result = await client.query(
    `select count(*)::int as count from drizzle.__drizzle_migrations`
  );
  return result.rows[0]?.count;
}

async function withClient(databaseUrl, work) {
  const client = new pg.Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    return await work(client);
  } finally {
    await client.end();
  }
}

function quoteDatabaseName(value) {
  if (!/^hulee_src010_[a-z0-9_]+$/u.test(value)) {
    throw new Error(`Unsafe SRC-010 test database name: ${value}`);
  }
  return `"${value.replaceAll('"', '""')}"`;
}
