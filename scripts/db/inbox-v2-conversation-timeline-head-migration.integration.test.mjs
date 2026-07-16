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

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHuleeDatabase,
  createHuleeDatabase
} from "../../packages/db/src/client.ts";
import { createSqlInboxV2ConversationRepository } from "../../packages/db/src/repositories/sql-inbox-v2-conversation-repository.ts";
import { migrationJournal } from "../checks/db-check-lib.mjs";

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const checkedInMigrationsDirectory = resolve("packages/db/drizzle");
const finalizedMarker =
  "INBOX_V2_CONVERSATION_TIMELINE_HEAD_MIGRATION_FINALIZED_V1";
const migrationIndex = 38;
const baseMigrationIndex = 37;
const t0 = "2026-07-16T10:00:00.000Z";
const t1 = "2026-07-16T10:00:01.000Z";
const t2 = "2026-07-16T10:00:02.000Z";

describePostgres(
  "Inbox V2 Conversation timeline-head 0038 PostgreSQL lifecycle",
  () => {
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
          "DATABASE_URL is required for the DB-010 migration lifecycle test."
        );
      }

      temporaryRoot = await mkdtemp(join(tmpdir(), "hulee-db010-migrations-"));
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
        "\n--> statement-breakpoint\nselect inbox_v2_db010_forced_late_failure();\n",
        "utf8"
      );

      adminClient = new pg.Client({ connectionString: databaseUrl });
      await adminClient.connect();
    }, 60_000);

    afterAll(async () => {
      if (adminClient) {
        const cleanupUrl = process.env.DATABASE_URL;
        await Promise.all(
          createdDatabases.map(async (databaseName) => {
            const cleaner = new pg.Client({ connectionString: cleanupUrl });
            try {
              await cleaner.connect();
              await cleaner.query(
                `drop database if exists ${quoteDatabaseName(databaseName)} with (force)`
              );
            } finally {
              await cleaner.end().catch(() => {});
            }
          })
        );
        const remaining = await adminClient.query(
          `select count(*)::int as count
             from pg_catalog.pg_database
            where datname = any($1::text[])`,
          [createdDatabases]
        );
        expect(remaining.rows[0]?.count).toBe(0);
        await adminClient.end().catch(() => {});
      }
      if (temporaryRoot) {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
    }, 120_000);

    it("installs fresh, accepts repository create and rejects adversarial direct DML", async () => {
      const databaseUrl = await createDatabase("fresh");
      await applyMigrations(databaseUrl, targetMigrationsDirectory);
      await expectDb010Installed(databaseUrl);

      const database = createHuleeDatabase({ connectionString: databaseUrl });
      try {
        await database.execute(
          sql.raw(`
            insert into public.tenants (id, slug, display_name)
            values ('tenant:db010-fresh', 'db010-fresh', 'DB010 fresh')
          `)
        );
        const created = await createSqlInboxV2ConversationRepository(
          database
        ).create({
          tenantId: "tenant:db010-fresh",
          conversationId: "conversation:db010-repository",
          topology: "direct",
          transport: "internal",
          purposeId: "core:chat",
          lifecycle: "active",
          streamPosition: "1",
          createdAt: t0
        });
        expect(created.kind).toBe("created");
      } finally {
        await closeHuleeDatabase(database);
      }

      await withClient(databaseUrl, async (client) => {
        await expectDatabaseError(
          transactionSql([
            conversationInsert("missing-head"),
            membershipHeadInsert("missing-head"),
            "set constraints all immediate"
          ]),
          client,
          "inbox_v2.conversation_timeline_head_coherence"
        );

        await seedConversation(client, "forged-sequence");
        await expectDatabaseError(
          transactionSql([
            `update public.inbox_v2_conversation_heads
                set latest_timeline_sequence = 7,
                    revision = 2,
                    last_changed_stream_position = 2,
                    updated_at = timestamptz '${t1}'
              where tenant_id = 'tenant:db010-fresh'
                and conversation_id = 'conversation:db010-forged-sequence'`,
            "set constraints all immediate"
          ]),
          client,
          "inbox_v2.conversation_timeline_range_noncontiguous"
        );

        await seedConversation(client, "forged-activity");
        await expectDatabaseError(
          transactionSql([
            headAdvanceWithActivity(
              "forged-activity",
              "forged-activity-wrong",
              1
            ),
            eligibleTimelineInsert(
              "forged-activity-actual",
              "forged-activity",
              1
            ),
            callDetailInsert("forged-activity-actual"),
            "set constraints all immediate"
          ]),
          client,
          "inbox_v2.conversation_timeline_head_coherence"
        );

        await seedConversation(client, "deleted-head");
        await expectDatabaseError(
          transactionSql([
            `delete from public.inbox_v2_conversation_heads
              where tenant_id = 'tenant:db010-fresh'
                and conversation_id = 'conversation:db010-deleted-head'`,
            "set constraints all immediate"
          ]),
          client,
          "inbox_v2.conversation_timeline_head_delete_forbidden"
        );

        await seedConversation(client, "conversation-regression");
        await client.query(`
          update public.inbox_v2_conversations
             set lifecycle = 'ended',
                 revision = 2,
                 last_changed_stream_position = 2,
                 updated_at = timestamptz '${t1}'
           where tenant_id = 'tenant:db010-fresh'
             and id = 'conversation:db010-conversation-regression'
        `);
        await expectDatabaseError(
          `update public.inbox_v2_conversations
              set revision = 1,
                  last_changed_stream_position = 3,
                  updated_at = timestamptz '${t2}'
            where tenant_id = 'tenant:db010-fresh'
              and id = 'conversation:db010-conversation-regression'`,
          client,
          "inbox_v2.conversation_revision_regressed"
        );
        await expectDatabaseError(
          `update public.inbox_v2_conversations
              set revision = 3,
                  last_changed_stream_position = 1,
                  updated_at = timestamptz '${t2}'
            where tenant_id = 'tenant:db010-fresh'
              and id = 'conversation:db010-conversation-regression'`,
          client,
          "inbox_v2.conversation_revision_regressed"
        );
        await expectDatabaseError(
          `update public.inbox_v2_conversations
              set revision = 3,
                  last_changed_stream_position = 3,
                  updated_at = timestamptz '${t0}'
            where tenant_id = 'tenant:db010-fresh'
              and id = 'conversation:db010-conversation-regression'`,
          client,
          "inbox_v2.conversation_revision_regressed"
        );

        await seedConversation(client, "regression");
        await client.query(`
          update public.inbox_v2_conversation_heads
             set revision = 2,
                 last_changed_stream_position = 2,
                 updated_at = timestamptz '${t1}'
           where tenant_id = 'tenant:db010-fresh'
             and conversation_id = 'conversation:db010-regression'
        `);
        await expectDatabaseError(
          `update public.inbox_v2_conversation_heads
              set revision = 1,
                  last_changed_stream_position = 3,
                  updated_at = timestamptz '${t2}'
            where tenant_id = 'tenant:db010-fresh'
              and conversation_id = 'conversation:db010-regression'`,
          client,
          "inbox_v2.conversation_timeline_head_regressed"
        );
        await expectDatabaseError(
          `update public.inbox_v2_conversation_heads
              set revision = 3,
                  last_changed_stream_position = 3,
                  updated_at = timestamptz '${t0}'
            where tenant_id = 'tenant:db010-fresh'
              and conversation_id = 'conversation:db010-regression'`,
          client,
          "inbox_v2.conversation_timeline_head_regressed"
        );

        await seedConversation(client, "fence-poison-source");
        await expectDatabaseError(
          identityFenceInsert("fence-poison-source", 2, 2, t1),
          client,
          "inbox_v2.conversation_identity_fence_source_invalid"
        );

        await seedConversation(client, "fence-poison-coherence");
        await expectDatabaseError(
          transactionSql([
            identityFenceInsert("fence-poison-coherence", 1, 1, t0),
            "set constraints all immediate"
          ]),
          client,
          "inbox_v2.conversation_identity_retired"
        );

        await seedConversation(client, "head-replacement");
        await client.query(`
          update public.inbox_v2_conversation_heads
             set revision = 2,
                 last_changed_stream_position = 2,
                 updated_at = timestamptz '${t1}'
           where tenant_id = 'tenant:db010-fresh'
             and conversation_id = 'conversation:db010-head-replacement'
        `);
        await expectDatabaseError(
          transactionSql([
            `delete from public.inbox_v2_conversation_heads
              where tenant_id = 'tenant:db010-fresh'
                and conversation_id = 'conversation:db010-head-replacement'`,
            conversationHeadInsert("head-replacement"),
            "set constraints all immediate"
          ]),
          client,
          "inbox_v2.conversation_timeline_head_delete_forbidden"
        );

        await seedConversation(client, "conversation-replacement");
        await client.query(`
          update public.inbox_v2_conversations
             set lifecycle = 'ended',
                 revision = 2,
                 last_changed_stream_position = 2,
                 updated_at = timestamptz '${t1}'
           where tenant_id = 'tenant:db010-fresh'
             and id = 'conversation:db010-conversation-replacement'
        `);
        await expectDatabaseError(
          transactionSql([
            membershipHeadDelete("conversation-replacement"),
            `delete from public.inbox_v2_conversations
              where tenant_id = 'tenant:db010-fresh'
                and id = 'conversation:db010-conversation-replacement'`,
            conversationInsert("conversation-replacement"),
            conversationHeadInsert("conversation-replacement"),
            membershipHeadInsert("conversation-replacement"),
            "set constraints all immediate"
          ]),
          client,
          "inbox_v2.conversation_identity_retired"
        );
        await expectDatabaseError(
          `update public.inbox_v2_conversation_heads
              set revision = 3,
                  last_changed_stream_position = 1,
                  updated_at = timestamptz '${t2}'
            where tenant_id = 'tenant:db010-fresh'
              and conversation_id = 'conversation:db010-regression'`,
          client,
          "inbox_v2.conversation_timeline_head_regressed"
        );

        await seedConversation(client, "gap");
        await expectDatabaseError(
          transactionSql([
            headAdvance("gap", 3),
            callTimelineInsert("gap-1", "gap", 1),
            callDetailInsert("gap-1"),
            callTimelineInsert("gap-3", "gap", 3),
            callDetailInsert("gap-3"),
            "set constraints all immediate"
          ]),
          client,
          "inbox_v2.conversation_timeline_range_noncontiguous"
        );

        await seedConversation(client, "atomic");
        await client.query(
          transactionSql([
            headAdvance("atomic", 2),
            callTimelineInsert("atomic-1", "atomic", 1),
            callDetailInsert("atomic-1"),
            callTimelineInsert("atomic-2", "atomic", 2),
            callDetailInsert("atomic-2"),
            "set constraints all immediate"
          ])
        );
        const atomicHead = await client.query(`
          select latest_timeline_sequence::text as sequence,
                 revision::text as revision
            from public.inbox_v2_conversation_heads
           where tenant_id = 'tenant:db010-fresh'
             and conversation_id = 'conversation:db010-atomic'
        `);
        expect(atomicHead.rows[0]).toEqual({ sequence: "2", revision: "2" });

        await seedConversation(client, "eligible-atomic");
        await client.query(
          transactionSql([
            headAdvanceWithActivity("eligible-atomic", "eligible-atomic-1", 1),
            eligibleTimelineInsert("eligible-atomic-1", "eligible-atomic", 1),
            callDetailInsert("eligible-atomic-1"),
            "set constraints all immediate"
          ])
        );
        const eligibleAtomicHead = await client.query(`
          select latest_timeline_sequence::text as sequence,
                 latest_activity_item_id as "activityItemId",
                 latest_activity_timeline_sequence::text as "activitySequence"
            from public.inbox_v2_conversation_heads
           where tenant_id = 'tenant:db010-fresh'
             and conversation_id = 'conversation:db010-eligible-atomic'
        `);
        expect(eligibleAtomicHead.rows[0]).toEqual({
          sequence: "1",
          activityItemId: "timeline_item:db010-eligible-atomic-1",
          activitySequence: "1"
        });

        await client.query(`
          insert into public.tenants (id, slug, display_name)
          values ('tenant:db010-retirement', 'db010-retirement', 'DB010 retirement')
        `);
        await seedConversation(client, "retirement", "tenant:db010-retirement");
        await client.query(`
          update public.inbox_v2_conversations
             set lifecycle = 'ended',
                 revision = 2,
                 last_changed_stream_position = 2,
                 updated_at = timestamptz '${t1}'
           where tenant_id = 'tenant:db010-retirement'
             and id = 'conversation:db010-retirement'
        `);
        await client.query(
          transactionSql([
            membershipHeadDelete("retirement", "tenant:db010-retirement"),
            `delete from public.inbox_v2_conversations
              where tenant_id = 'tenant:db010-retirement'
                and id = 'conversation:db010-retirement'`,
            "set constraints all immediate"
          ])
        );
        const retirement = await client.query(`
          select fence_row.retired_revision::text as revision,
                 fence_row.retired_stream_position::text as "streamPosition",
                 fence_row.retired_updated_at::text as "updatedAt",
                 exists (
                   select 1
                     from public.inbox_v2_conversation_heads head_row
                    where head_row.tenant_id = fence_row.tenant_id
                      and head_row.conversation_id = fence_row.conversation_id
                 ) as "headExists"
            from public.inbox_v2_conversation_identity_fences fence_row
           where fence_row.tenant_id = 'tenant:db010-retirement'
             and fence_row.conversation_id = 'conversation:db010-retirement'
        `);
        expect(retirement.rows[0]).toMatchObject({
          revision: "2",
          streamPosition: "2",
          headExists: false
        });
        expect(new Date(retirement.rows[0].updatedAt).toISOString()).toBe(t1);
        await expectDatabaseError(
          conversationInsert("retirement", "tenant:db010-retirement"),
          client,
          "inbox_v2.conversation_identity_retired"
        );
        await expectDatabaseError(
          `update public.inbox_v2_conversation_identity_fences
              set retired_revision = 3
            where tenant_id = 'tenant:db010-retirement'
              and conversation_id = 'conversation:db010-retirement'`,
          client,
          "inbox_v2.conversation_identity_fence_immutable"
        );
        await expectDatabaseError(
          `delete from public.inbox_v2_conversation_identity_fences
            where tenant_id = 'tenant:db010-retirement'
              and conversation_id = 'conversation:db010-retirement'`,
          client,
          "inbox_v2.conversation_identity_fence_immutable"
        );
        const invariantRowsBeforeTruncate = await client.query(`
          select
            (select count(*)::int from public.inbox_v2_conversations) as conversations,
            (select count(*)::int from public.inbox_v2_conversation_heads) as heads,
            (select count(*)::int from public.inbox_v2_timeline_items) as timeline_items,
            (select count(*)::int from public.inbox_v2_conversation_identity_fences) as fences
        `);
        for (const truncateSql of [
          "truncate table public.inbox_v2_conversations cascade",
          "truncate table public.inbox_v2_conversation_heads cascade",
          "truncate table public.inbox_v2_timeline_items cascade",
          "truncate table public.inbox_v2_conversation_identity_fences cascade",
          "truncate table public.tenants cascade"
        ]) {
          await expectDatabaseError(
            truncateSql,
            client,
            "inbox_v2.conversation_timeline_truncate_forbidden"
          );
        }
        const invariantRowsAfterTruncate = await client.query(`
          select
            (select count(*)::int from public.inbox_v2_conversations) as conversations,
            (select count(*)::int from public.inbox_v2_conversation_heads) as heads,
            (select count(*)::int from public.inbox_v2_timeline_items) as timeline_items,
            (select count(*)::int from public.inbox_v2_conversation_identity_fences) as fences
        `);
        expect(invariantRowsAfterTruncate.rows).toEqual(
          invariantRowsBeforeTruncate.rows
        );
        await client.query(`
          delete from public.tenants
           where id = 'tenant:db010-retirement'
        `);
        const retiredAfterTenantDelete = await client.query(`
          select count(*)::int as count
            from public.inbox_v2_conversation_identity_fences
           where tenant_id = 'tenant:db010-retirement'
        `);
        expect(retiredAfterTenantDelete.rows[0]?.count).toBe(0);
      });
    }, 120_000);

    it("serializes hard-delete against a concurrent same-ID recreation", async () => {
      const databaseUrl = await createDatabase("identityrace");
      const databaseName = new URL(databaseUrl).pathname.slice(1);
      await applyMigrations(databaseUrl, targetMigrationsDirectory);
      await withClient(databaseUrl, async (client) => {
        await client.query(`
          insert into public.tenants (id, slug, display_name)
          values ('tenant:db010-identityrace', 'db010-identityrace', 'DB010 identity race')
        `);
        await seedConversation(
          client,
          "identityrace",
          "tenant:db010-identityrace"
        );
      });

      const deleter = new pg.Client({ connectionString: databaseUrl });
      const recreator = new pg.Client({ connectionString: databaseUrl });
      await Promise.all([deleter.connect(), recreator.connect()]);
      let recreationOutcomePromise;
      try {
        await deleter.query("begin");
        await deleter.query(
          membershipHeadDelete("identityrace", "tenant:db010-identityrace")
        );
        await deleter.query(`
          delete from public.inbox_v2_conversations
           where tenant_id = 'tenant:db010-identityrace'
             and id = 'conversation:db010-identityrace'
        `);

        recreationOutcomePromise = recreator
          .query(
            transactionSql([
              conversationInsert("identityrace", "tenant:db010-identityrace"),
              conversationHeadInsert(
                "identityrace",
                "tenant:db010-identityrace"
              ),
              membershipHeadInsert("identityrace", "tenant:db010-identityrace"),
              "set constraints all immediate"
            ])
          )
          .then(
            () => ({ kind: "committed" }),
            (error) => ({ kind: "rejected", error })
          );

        await waitForCondition(async () => {
          const result = await adminClient.query(
            `select count(*)::int as count
               from pg_catalog.pg_stat_activity
              where datname = $1
                and wait_event_type = 'Lock'`,
            [databaseName]
          );
          return (result.rows[0]?.count ?? 0) > 0;
        });

        await deleter.query("commit");
        const outcome = await recreationOutcomePromise;
        expect(outcome.kind).toBe("rejected");
        if (outcome.kind !== "rejected") {
          throw new Error("Concurrent retired Conversation ID was reused.");
        }
        const databaseError = findDatabaseError(outcome.error);
        expect(databaseError?.code).toBe("23514");
        expect(databaseError?.message).toBe(
          "inbox_v2.conversation_identity_retired"
        );
      } finally {
        await deleter.query("rollback").catch(() => {});
        await recreator.query("rollback").catch(() => {});
        await Promise.all([
          deleter.end().catch(() => {}),
          recreator.end().catch(() => {})
        ]);
      }

      await withClient(databaseUrl, async (client) => {
        const result = await client.query(`
          select
            (select count(*)::int
               from public.inbox_v2_conversations
              where tenant_id = 'tenant:db010-identityrace'
                and id = 'conversation:db010-identityrace') as conversations,
            (select count(*)::int
               from public.inbox_v2_conversation_identity_fences
              where tenant_id = 'tenant:db010-identityrace'
                and conversation_id = 'conversation:db010-identityrace') as fences
        `);
        expect(result.rows[0]).toEqual({ conversations: 0, fences: 1 });
      });
    }, 120_000);

    it("upgrades a coherent current database and reruns idempotently", async () => {
      const databaseUrl = await createDatabase("upgrade");
      await applyMigrations(databaseUrl, baseMigrationsDirectory);
      await withClient(databaseUrl, async (client) => {
        await client.query(`
          insert into public.tenants (id, slug, display_name)
          values ('tenant:db010-upgrade', 'db010-upgrade', 'DB010 upgrade')
        `);
        await seedConversation(client, "upgrade", "tenant:db010-upgrade");
        expect(await appliedMigrationCount(client)).toBe(38);
      });

      await applyMigrations(databaseUrl, targetMigrationsDirectory);
      await applyMigrations(databaseUrl, targetMigrationsDirectory);
      await expectDb010Installed(databaseUrl);
      await withClient(databaseUrl, async (client) => {
        expect(await appliedMigrationCount(client)).toBe(39);
        const result = await client.query(`
          select count(*)::int as count
            from public.inbox_v2_conversations
           where tenant_id = 'tenant:db010-upgrade'
             and id = 'conversation:db010-upgrade'
        `);
        expect(result.rows[0]?.count).toBe(1);
      });
    }, 120_000);

    it("rejects an incoherent 0037 database before installing any target object", async () => {
      const databaseUrl = await createDatabase("incoherent");
      await applyMigrations(databaseUrl, baseMigrationsDirectory);
      await withClient(databaseUrl, async (client) => {
        await client.query(`
          insert into public.tenants (id, slug, display_name)
          values ('tenant:db010-incoherent', 'db010-incoherent', 'DB010 incoherent')
        `);
        await client.query(
          transactionSql([
            conversationInsert("incoherent", "tenant:db010-incoherent"),
            membershipHeadInsert("incoherent", "tenant:db010-incoherent")
          ])
        );
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
        "inbox_v2.conversation_timeline_head_preflight_missing_head"
      );
      await expectDb010Absent(databaseUrl, 38);
    }, 120_000);

    it("locks writers before validation and rejects a concurrently deleted Head", async () => {
      const databaseUrl = await createDatabase("concurrent");
      const databaseName = new URL(databaseUrl).pathname.slice(1);
      await applyMigrations(databaseUrl, baseMigrationsDirectory);
      await withClient(databaseUrl, async (client) => {
        await client.query(`
          insert into public.tenants (id, slug, display_name)
          values ('tenant:db010-concurrent', 'db010-concurrent', 'DB010 concurrent')
        `);
        await seedConversation(client, "concurrent", "tenant:db010-concurrent");
      });

      const blocker = new pg.Client({ connectionString: databaseUrl });
      await blocker.connect();
      try {
        await blocker.query("begin");
        await blocker.query(`
          delete from public.inbox_v2_conversation_heads
           where tenant_id = 'tenant:db010-concurrent'
             and conversation_id = 'conversation:db010-concurrent'
        `);

        let migrationSettled = false;
        const migrationOutcome = applyMigrations(
          databaseUrl,
          targetMigrationsDirectory
        )
          .then(
            () => ({ kind: "applied" }),
            (error) => ({ kind: "rejected", error })
          )
          .finally(() => {
            migrationSettled = true;
          });

        await waitForCondition(async () => {
          const result = await adminClient.query(
            `select count(*)::int as count
               from pg_catalog.pg_stat_activity
              where datname = $1
                and wait_event_type = 'Lock'`,
            [databaseName]
          );
          return (result.rows[0]?.count ?? 0) > 0;
        });
        expect(migrationSettled).toBe(false);

        await blocker.query("commit");
        const outcome = await migrationOutcome;
        expect(outcome.kind).toBe("rejected");
        if (outcome.kind !== "rejected") {
          throw new Error("Concurrent invalidation unexpectedly migrated.");
        }
        const databaseError = findDatabaseError(outcome.error);
        expect(databaseError?.code).toBe("23514");
        expect(databaseError?.message).toBe(
          "inbox_v2.conversation_timeline_head_preflight_missing_head"
        );
      } finally {
        await blocker.query("rollback").catch(() => {});
        await blocker.end().catch(() => {});
      }
      await expectDb010Absent(databaseUrl, 38);
    }, 120_000);

    it("rolls every target object back after a forced late migration failure", async () => {
      const databaseUrl = await createDatabase("rollback");
      await applyMigrations(databaseUrl, baseMigrationsDirectory);

      await expect(
        applyMigrations(databaseUrl, failingMigrationsDirectory)
      ).rejects.toThrow();
      await expectDb010Absent(databaseUrl, 38);
    }, 120_000);

    async function createDatabase(label) {
      const baseUrl = new URL(process.env.DATABASE_URL);
      const databaseName = `hulee_db010_${label}_${process.pid}_${createdDatabases.length}`;
      await adminClient.query(
        `create database ${quoteDatabaseName(databaseName)}`
      );
      createdDatabases.push(databaseName);
      baseUrl.pathname = `/${databaseName}`;
      return baseUrl.toString();
    }
  }
);

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

async function expectDb010Installed(databaseUrl) {
  await withClient(databaseUrl, async (client) => {
    const result = await client.query(`
      select
        to_regprocedure(
          'public.inbox_v2_assert_conversation_timeline_head(text,text)'
        ) is not null as "assertionFunction",
        to_regprocedure(
          'public.inbox_v2_lock_conversation_identity(text,text)'
        ) is not null as "identityLockFunction",
        to_regprocedure(
          'public.inbox_v2_conversation_timeline_truncate_guard()'
        ) is not null as "truncateGuardFunction",
        to_regclass(
          'public.inbox_v2_conversation_identity_fences'
        ) is not null as "identityFenceTable",
        to_regclass(
          'public.inbox_v2_timeline_items_eligible_activity_tail_idx'
        ) is not null as "eligibleTailIndex",
        (
          select count(*)::int
            from pg_catalog.pg_trigger trigger_row
           where not trigger_row.tgisinternal
             and trigger_row.tgname = any(array[
                'inbox_v2_conversations_insert_guard_trigger',
                'inbox_v2_conversations_update_guard_trigger',
                'inbox_v2_conversations_delete_guard_trigger',
                'inbox_v2_conversation_heads_insert_guard_trigger',
                'inbox_v2_conversation_heads_update_guard_trigger',
                'inbox_v2_conversation_heads_delete_guard_trigger',
                'inbox_v2_conversation_identity_fences_guard_trigger',
                'inbox_v2_conversations_truncate_guard_trigger',
                'inbox_v2_conversation_heads_truncate_guard_trigger',
                'inbox_v2_timeline_items_truncate_guard_trigger',
                'inbox_v2_conversation_identity_fences_truncate_guard_trigger',
                'inbox_v2_conversation_identity_fence_coherence_trigger',
                'inbox_v2_conversations_timeline_head_constraint_trigger',
                'inbox_v2_conversation_heads_timeline_constraint_trigger'
              ]::text[])
        ) as "targetTriggers",
        (
          select count(*)::int
            from pg_catalog.pg_trigger trigger_row
           where not trigger_row.tgisinternal
             and trigger_row.tgenabled = 'O'
             and (trigger_row.tgtype::int & 1) = 0
             and (trigger_row.tgtype::int & 2) = 2
             and (trigger_row.tgtype::int & 32) = 32
             and trigger_row.tgname = any(array[
               'inbox_v2_conversations_truncate_guard_trigger',
               'inbox_v2_conversation_heads_truncate_guard_trigger',
               'inbox_v2_timeline_items_truncate_guard_trigger',
               'inbox_v2_conversation_identity_fences_truncate_guard_trigger'
             ]::text[])
        ) as "truncateTriggers",
        (
          select count(*)::int
            from pg_catalog.pg_trigger trigger_row
           where not trigger_row.tgisinternal
              and trigger_row.tgname = any(array[
               'inbox_v2_conversation_identity_fence_coherence_trigger',
               'inbox_v2_conversations_timeline_head_constraint_trigger',
               'inbox_v2_conversation_heads_timeline_constraint_trigger'
             ]::text[])
             and trigger_row.tgdeferrable
             and trigger_row.tginitdeferred
             and trigger_row.tgenabled = 'O'
        ) as "deferredTriggers"
    `);
    expect(result.rows[0]).toEqual({
      assertionFunction: true,
      identityLockFunction: true,
      truncateGuardFunction: true,
      identityFenceTable: true,
      eligibleTailIndex: true,
      targetTriggers: 14,
      truncateTriggers: 4,
      deferredTriggers: 3
    });
    expect(await appliedMigrationCount(client)).toBe(39);
  });
}

async function expectDb010Absent(databaseUrl, expectedMigrationCount) {
  await withClient(databaseUrl, async (client) => {
    const result = await client.query(`
      select
        to_regprocedure(
          'public.inbox_v2_assert_conversation_timeline_head(text,text)'
        ) is null as "assertionAbsent",
        to_regprocedure(
          'public.inbox_v2_lock_conversation_identity(text,text)'
        ) is null as "identityLockAbsent",
        to_regprocedure(
          'public.inbox_v2_conversation_timeline_truncate_guard()'
        ) is null as "truncateGuardAbsent",
        to_regclass(
          'public.inbox_v2_conversation_identity_fences'
        ) is null as "identityFenceAbsent",
        to_regclass(
          'public.inbox_v2_timeline_items_eligible_activity_tail_idx'
        ) is null as "eligibleTailIndexAbsent",
        (
          select count(*)::int
            from pg_catalog.pg_trigger trigger_row
           where not trigger_row.tgisinternal
             and trigger_row.tgname = any(array[
               'inbox_v2_conversations_insert_guard_trigger',
               'inbox_v2_conversations_update_guard_trigger',
               'inbox_v2_conversations_delete_guard_trigger',
               'inbox_v2_conversation_heads_insert_guard_trigger',
               'inbox_v2_conversation_heads_update_guard_trigger',
               'inbox_v2_conversation_heads_delete_guard_trigger',
               'inbox_v2_conversation_identity_fences_guard_trigger',
               'inbox_v2_conversations_truncate_guard_trigger',
               'inbox_v2_conversation_heads_truncate_guard_trigger',
               'inbox_v2_timeline_items_truncate_guard_trigger',
               'inbox_v2_conversation_identity_fences_truncate_guard_trigger',
               'inbox_v2_conversation_identity_fence_coherence_trigger',
               'inbox_v2_conversations_timeline_head_constraint_trigger',
               'inbox_v2_conversation_heads_timeline_constraint_trigger'
             ]::text[])
        ) as "targetTriggers"
    `);
    expect(result.rows[0]).toEqual({
      assertionAbsent: true,
      identityLockAbsent: true,
      truncateGuardAbsent: true,
      identityFenceAbsent: true,
      eligibleTailIndexAbsent: true,
      targetTriggers: 0
    });
    expect(await appliedMigrationCount(client)).toBe(expectedMigrationCount);
  });
}

async function seedConversation(
  client,
  label,
  tenantId = "tenant:db010-fresh"
) {
  await client.query(
    transactionSql([
      conversationInsert(label, tenantId),
      conversationHeadInsert(label, tenantId),
      membershipHeadInsert(label, tenantId),
      "set constraints all immediate"
    ])
  );
}

function conversationInsert(label, tenantId = "tenant:db010-fresh") {
  return `insert into public.inbox_v2_conversations (
    tenant_id, id, topology, transport, purpose_id, lifecycle,
    revision, last_changed_stream_position, created_at, updated_at
  ) values (
    '${tenantId}', 'conversation:db010-${label}', 'direct', 'internal',
    'core:chat', 'active', 1, 1,
    timestamptz '${t0}', timestamptz '${t0}'
  )`;
}

function conversationHeadInsert(label, tenantId = "tenant:db010-fresh") {
  return `insert into public.inbox_v2_conversation_heads (
    tenant_id, conversation_id, latest_timeline_sequence,
    latest_activity_item_id, latest_activity_timeline_sequence,
    latest_activity_at, revision, last_changed_stream_position,
    created_at, updated_at
  ) values (
    '${tenantId}', 'conversation:db010-${label}', 0,
    null, null, null, 1, 1,
    timestamptz '${t0}', timestamptz '${t0}'
  )`;
}

function membershipHeadInsert(label, tenantId = "tenant:db010-fresh") {
  return `insert into public.inbox_v2_conversation_membership_heads (
    tenant_id, conversation_id, membership_revision, created_at, updated_at
  ) values (
    '${tenantId}', 'conversation:db010-${label}', 0,
    timestamptz '${t0}', timestamptz '${t0}'
  )`;
}

function membershipHeadDelete(label, tenantId = "tenant:db010-fresh") {
  return `delete from public.inbox_v2_conversation_membership_heads
   where tenant_id = '${tenantId}'
     and conversation_id = 'conversation:db010-${label}'`;
}

function identityFenceInsert(
  label,
  retiredRevision,
  retiredStreamPosition,
  retiredUpdatedAt,
  tenantId = "tenant:db010-fresh"
) {
  return `insert into public.inbox_v2_conversation_identity_fences (
    tenant_id, conversation_id, retired_revision,
    retired_stream_position, retired_updated_at
  ) values (
    '${tenantId}', 'conversation:db010-${label}', ${retiredRevision},
    ${retiredStreamPosition}, timestamptz '${retiredUpdatedAt}'
  )`;
}

function headAdvance(label, latestSequence) {
  return `update public.inbox_v2_conversation_heads
     set latest_timeline_sequence = ${latestSequence},
         revision = 2,
         last_changed_stream_position = 2,
         updated_at = timestamptz '${t1}'
   where tenant_id = 'tenant:db010-fresh'
     and conversation_id = 'conversation:db010-${label}'`;
}

function headAdvanceWithActivity(label, activityItemLabel, latestSequence) {
  return `update public.inbox_v2_conversation_heads
     set latest_timeline_sequence = ${latestSequence},
         latest_activity_item_id = 'timeline_item:db010-${activityItemLabel}',
         latest_activity_timeline_sequence = ${latestSequence},
         latest_activity_at = timestamptz '${t0}',
         revision = 2,
         last_changed_stream_position = 2,
         updated_at = timestamptz '${t1}'
   where tenant_id = 'tenant:db010-fresh'
     and conversation_id = 'conversation:db010-${label}'`;
}

function callTimelineInsert(itemLabel, conversationLabel, sequence) {
  return `insert into public.inbox_v2_timeline_items (
    tenant_id, id, conversation_id, timeline_sequence,
    subject_kind, subject_id, visibility, activity_kind,
    activity_reason_id, occurred_at, received_at, revision,
    last_changed_stream_position, created_at, updated_at
  ) values (
    'tenant:db010-fresh', 'timeline_item:db010-${itemLabel}',
    'conversation:db010-${conversationLabel}', ${sequence},
    'call', 'call:db010-${itemLabel}', 'source_item_policy', 'non_activity',
    'core:db010_fixture', timestamptz '${t0}', timestamptz '${t1}', 1,
    2, timestamptz '${t1}', timestamptz '${t1}'
  )`;
}

function eligibleTimelineInsert(itemLabel, conversationLabel, sequence) {
  return `insert into public.inbox_v2_timeline_items (
    tenant_id, id, conversation_id, timeline_sequence,
    subject_kind, subject_id, visibility, activity_kind,
    occurred_at, received_at, revision,
    last_changed_stream_position, created_at, updated_at
  ) values (
    'tenant:db010-fresh', 'timeline_item:db010-${itemLabel}',
    'conversation:db010-${conversationLabel}', ${sequence},
    'call', 'call:db010-${itemLabel}', 'source_item_policy', 'eligible',
    timestamptz '${t0}', timestamptz '${t1}', 1,
    2, timestamptz '${t1}', timestamptz '${t1}'
  )`;
}

function callDetailInsert(itemLabel) {
  return `insert into public.inbox_v2_timeline_subject_details (
    tenant_id, timeline_item_id, subject_kind, source_object_id,
    source_object_kind_id, source_object_revision, record_revision, created_at
  ) values (
    'tenant:db010-fresh', 'timeline_item:db010-${itemLabel}', 'call',
    'call:db010-${itemLabel}', 'core:call', 1, 1, timestamptz '${t1}'
  )`;
}

function transactionSql(statements) {
  return `begin;\n${statements.join(";\n")};\ncommit;`;
}

async function expectDatabaseError(sqlText, client, expectedMessage) {
  let error;
  try {
    await client.query(sqlText);
  } catch (caught) {
    error = caught;
  }
  await client.query("rollback").catch(() => {});
  expect(error?.code).toBe("23514");
  expect(error?.message).toBe(expectedMessage);
}

async function appliedMigrationCount(client) {
  const result = await client.query(
    "select count(*)::int as count from drizzle.__drizzle_migrations"
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

async function waitForCondition(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for the PostgreSQL lock boundary.");
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
  if (!/^hulee_db010_[a-z]+_[0-9]+_[0-9]+$/u.test(databaseName)) {
    throw new Error(`Unsafe DB-010 test database name: ${databaseName}`);
  }
  return `"${databaseName}"`;
}
