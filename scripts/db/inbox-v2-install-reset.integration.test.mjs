import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  digestMigrationJournal,
  expectedMigrationContract,
  inspectInboxV2DatabaseInventory,
  inspectInboxV2DatabaseTarget,
  installInboxV2Database,
  readAppliedMigrationJournal,
  resetInboxV2Database
} from "./inbox-v2-database-lifecycle.mjs";
import {
  INBOX_V2_DATABASE_LIFECYCLE_SCHEMA_VERSION,
  INBOX_V2_DISPOSITION_MANIFEST_SCHEMA_ID,
  INBOX_V2_MIGRATION_CONTRACT_VERSION,
  INBOX_V2_MIG_001_EVIDENCE_SCHEMA_ID,
  INBOX_V2_OBJECT_STORAGE_RECEIPT_SCHEMA_ID,
  INBOX_V2_REPOSITORY_BOOTSTRAP_SCHEMA_ID,
  digestInboxV2ReviewedDisposition,
  sha256
} from "./inbox-v2-install-contract.mjs";
import { verifyInboxV2BaselineCatalog } from "./inbox-v2-baseline-catalog.mjs";

const { Client } = pg;
const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const migrationsFolder = resolve("packages/db/drizzle");
const baselineMigrationCount = 1;
const removedInboxV1Relations = [
  "conversations",
  "conversation_participants",
  "messages",
  "message_delivery_attempts",
  "message_attachments"
];
const removedInboxV1Enums = [
  "conversation_type",
  "message_direction",
  "message_status"
];
const createdDatabases = [];
let adminClient;
let temporaryDirectory;

describePostgres("Inbox V2 clean install and guarded reset", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL is required for the DB-008 integration test."
      );
    }
    adminClient = new Client({ connectionString: process.env.DATABASE_URL });
    await adminClient.connect();
    temporaryDirectory = await mkdtemp(join(tmpdir(), "hulee-db008-"));
  }, 30_000);

  afterAll(async () => {
    const cleanupErrors = [];
    if (adminClient) {
      for (const databaseName of createdDatabases.reverse()) {
        assertDisposableTestDatabaseName(databaseName);
        try {
          await adminClient.query(
            `select pg_catalog.pg_terminate_backend(pid)
               from pg_catalog.pg_stat_activity
              where datname = $1
                and pid <> pg_backend_pid()`,
            [databaseName]
          );
          await adminClient.query(
            `drop database if exists ${quoteIdentifier(databaseName)}`
          );
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      try {
        await adminClient.end();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, "DB-008 cleanup failed.");
    }
  }, 60_000);

  it("installs empty/current state, preserves current rows, rejects implicit authority and repeatably repairs only through reviewed reset", async () => {
    const database = await createDisposableDatabase("lifecycle");
    const bootstrapDocument = await writeBootstrapFixture();
    const bootstrap = bootstrapDocument.path;

    await withClient(database.url, (client) =>
      client.query("alter default privileges grant select on tables to public")
    );
    await expect(
      installInboxV2Database({
        databaseUrl: database.url,
        migrationsFolder,
        bootstrap
      })
    ).rejects.toMatchObject({
      code: "inbox_v2.current_schema_privilege_mismatch"
    });
    expect(
      await withClient(database.url, async (client) => {
        const result = await client.query(
          "select to_regclass('public.tenants') as relation_name"
        );
        return result.rows[0].relation_name;
      })
    ).toBeNull();
    await withClient(database.url, (client) =>
      client.query(
        "alter default privileges revoke select on tables from public"
      )
    );

    await withClient(database.url, (client) =>
      client.query("grant create on schema public to public")
    );
    try {
      await expect(
        installInboxV2Database({
          databaseUrl: database.url,
          migrationsFolder,
          bootstrap
        })
      ).rejects.toMatchObject({
        code: "inbox_v2.current_schema_privilege_mismatch"
      });
      expect(
        await withClient(database.url, async (client) => {
          const result = await client.query(
            "select to_regclass('public.tenants') as relation_name"
          );
          return result.rows[0].relation_name;
        })
      ).toBeNull();
    } finally {
      await withClient(database.url, (client) =>
        client.query("revoke create on schema public from public")
      );
    }

    const firstInstall = await installInboxV2Database({
      databaseUrl: database.url,
      migrationsFolder,
      bootstrap
    });
    const firstState = await readBootstrapState(database.url);
    expect(expectedMigrationContract(migrationsFolder)).toHaveLength(
      baselineMigrationCount
    );
    expect(firstInstall.migrationCount).toBe(baselineMigrationCount);
    await expectCleanSlateBaseline(database.url);
    expect(firstState).toMatchObject({
      tenantCount: 1,
      streamHeadCount: 1,
      projectionGenerationCount: 1,
      projectionCheckpointCount: 1,
      projectionHeadCount: 1,
      streamRevision: "1",
      projectionRevision: "1",
      checkpointRevision: "1"
    });

    await withClient(database.url, (client) =>
      client.query(
        `insert into public.tenants (id, slug, display_name, deployment_type)
           values ('tenant:db008-sentinel', 'db008-sentinel',
                   'DB008 sentinel', 'saas_shared')`
      )
    );
    const secondInstall = await installInboxV2Database({
      databaseUrl: database.url,
      migrationsFolder,
      bootstrap
    });
    const secondState = await readBootstrapState(database.url);
    expect(secondInstall.migrationJournalSha256).toBe(
      firstInstall.migrationJournalSha256
    );
    expect(secondState.tenantCount).toBe(2);
    expect(secondState.streamEpoch).toBe(firstState.streamEpoch);
    expect(secondState.streamHeadCount).toBe(1);
    expect(secondState.projectionGenerationCount).toBe(1);

    await expect(
      resetInboxV2Database({
        databaseUrl: database.url,
        migrationsFolder,
        bootstrap
      })
    ).rejects.toThrow(/reset_authority_missing/u);

    for (const { mutate, code } of [
      {
        mutate: (manifest) => {
          manifest.classification = "preserve";
        },
        code: "inbox_v2.reset_classification_forbidden"
      },
      {
        mutate: (manifest) => {
          manifest.deploymentKind = "shared_development";
        },
        code: "inbox_v2.reset_deployment_kind_forbidden"
      },
      {
        mutate: (manifest) => {
          manifest.target.databaseName = "hulee_db008_wrong_target";
        },
        code: "inbox_v2.reset_target_mismatch"
      },
      {
        mutate: (manifest) => {
          manifest.target.migrationJournalSha256 = `sha256:${"f".repeat(64)}`;
        },
        code: "inbox_v2.reset_migration_journal_mismatch"
      },
      {
        mutate: (manifest) => {
          manifest.target.migrationContractSha256 = `sha256:${"b".repeat(64)}`;
        },
        code: "inbox_v2.reset_migration_contract_mismatch"
      },
      {
        mutate: (manifest) => {
          manifest.inventory.databaseInventorySha256 = `sha256:${"e".repeat(64)}`;
        },
        code: "inbox_v2.reset_database_inventory_mismatch"
      }
    ]) {
      const reviewed = await writeReviewedManifest(
        database.url,
        bootstrapDocument,
        mutate
      );
      await expect(
        resetInboxV2Database({
          databaseUrl: database.url,
          migrationsFolder,
          bootstrap,
          manifestPath: reviewed.path,
          mig001EvidencePath: reviewed.mig001EvidencePath,
          objectReceiptPath: reviewed.objectReceiptPath,
          confirmation: reviewed.digest
        })
      ).rejects.toMatchObject({ code });
      expect((await readBootstrapState(database.url)).streamEpoch).toBe(
        firstState.streamEpoch
      );
    }

    for (const { mutate, code } of [
      {
        mutate: (manifest) => {
          const approvedAt = new Date(Date.now() - 2 * 60 * 60 * 1_000);
          const expiredAt = new Date(approvedAt.getTime() + 60 * 60 * 1_000);
          setManifestEvidenceTime(manifest, approvedAt.toISOString());
          manifest.expiresAt = expiredAt.toISOString();
        },
        code: "inbox_v2.reset_disposition_expired"
      },
      {
        mutate: (manifest) => {
          const futureAt = new Date(Date.now() + 60 * 60 * 1_000);
          setManifestEvidenceTime(manifest, futureAt.toISOString());
          manifest.expiresAt = new Date(
            futureAt.getTime() + 60 * 60 * 1_000
          ).toISOString();
        },
        code: "inbox_v2.reset_disposition_from_future"
      },
      {
        mutate: (manifest) => {
          const approvedAt = new Date();
          manifest.approvedAt = approvedAt.toISOString();
          const staleAt = new Date(
            approvedAt.getTime() - 60 * 60 * 1_000 - 1
          ).toISOString();
          manifest.fastPath.verifiedAt = staleAt;
          manifest.inventory.recordedAt = staleAt;
          manifest.objectStorage.verifiedAt = staleAt;
          manifest.expiresAt = new Date(
            approvedAt.getTime() + 60 * 60 * 1_000
          ).toISOString();
        },
        code: "inbox_v2.reset_disposition_evidence_stale"
      }
    ]) {
      const invalidAuthority = await writeReviewedManifest(
        database.url,
        bootstrapDocument,
        mutate
      );
      await expect(
        resetInboxV2Database({
          databaseUrl: database.url,
          migrationsFolder,
          bootstrap,
          manifestPath: invalidAuthority.path,
          mig001EvidencePath: invalidAuthority.mig001EvidencePath,
          objectReceiptPath: invalidAuthority.objectReceiptPath,
          confirmation: invalidAuthority.digest
        })
      ).rejects.toMatchObject({ code });
    }

    const artifactSubject = await writeReviewedManifest(
      database.url,
      bootstrapDocument
    );
    const artifactDonor = await writeReviewedManifest(
      database.url,
      bootstrapDocument
    );
    await expect(
      resetInboxV2Database({
        databaseUrl: database.url,
        migrationsFolder,
        bootstrap,
        manifestPath: artifactSubject.path,
        mig001EvidencePath: artifactSubject.mig001EvidencePath,
        objectReceiptPath: artifactDonor.objectReceiptPath,
        confirmation: artifactSubject.digest
      })
    ).rejects.toMatchObject({
      code: "inbox_v2.reset_object_receipt_digest_mismatch"
    });
    await expect(
      resetInboxV2Database({
        databaseUrl: database.url,
        migrationsFolder,
        bootstrap,
        manifestPath: artifactSubject.path,
        mig001EvidencePath: artifactDonor.mig001EvidencePath,
        objectReceiptPath: artifactSubject.objectReceiptPath,
        confirmation: artifactSubject.digest
      })
    ).rejects.toMatchObject({
      code: "inbox_v2.reset_mig_001_evidence_digest_mismatch"
    });
    const differentBootstrap = await writeBootstrapFixture(
      alternateBootstrapFixture(),
      "different-bootstrap"
    );
    await expect(
      resetInboxV2Database({
        databaseUrl: database.url,
        migrationsFolder,
        bootstrap: differentBootstrap.path,
        manifestPath: artifactSubject.path,
        mig001EvidencePath: artifactSubject.mig001EvidencePath,
        objectReceiptPath: artifactSubject.objectReceiptPath,
        confirmation: artifactSubject.digest
      })
    ).rejects.toMatchObject({
      code: "inbox_v2.reset_bootstrap_digest_mismatch"
    });

    await withClient(database.url, (client) =>
      client.query("alter default privileges grant insert on tables to public")
    );
    try {
      await expect(
        installInboxV2Database({
          databaseUrl: database.url,
          migrationsFolder,
          bootstrap
        })
      ).rejects.toMatchObject({
        code: "inbox_v2.current_schema_privilege_mismatch"
      });
      const defaultAclManifest = await writeReviewedManifest(
        database.url,
        bootstrapDocument
      );
      await expect(
        resetInboxV2Database({
          databaseUrl: database.url,
          migrationsFolder,
          bootstrap,
          manifestPath: defaultAclManifest.path,
          mig001EvidencePath: defaultAclManifest.mig001EvidencePath,
          objectReceiptPath: defaultAclManifest.objectReceiptPath,
          confirmation: defaultAclManifest.digest
        })
      ).rejects.toMatchObject({
        code: "inbox_v2.reset_database_objects_unsupported"
      });
    } finally {
      await withClient(database.url, (client) =>
        client.query(
          "alter default privileges revoke insert on tables from public"
        )
      );
    }

    const wrongConfirmation = await writeReviewedManifest(
      database.url,
      bootstrapDocument
    );
    await expect(
      resetInboxV2Database({
        databaseUrl: database.url,
        migrationsFolder,
        bootstrap,
        manifestPath: wrongConfirmation.path,
        mig001EvidencePath: wrongConfirmation.mig001EvidencePath,
        objectReceiptPath: wrongConfirmation.objectReceiptPath,
        confirmation: `sha256:${"d".repeat(64)}`
      })
    ).rejects.toThrow(/reset_confirmation_mismatch/u);

    await withClient(database.url, (client) =>
      client.query(
        `insert into public.channel_connectors (
           id, tenant_id, channel_type, channel_class, provider,
           display_name, status
         ) values (
           'connector:db008-semantic', 'tenant:db008-bootstrap',
           'telegram_qr_bridge', 'direct_account', 'telegram',
           'DB008 semantic guard', 'draft'
         )`
      )
    );
    const semanticManifest = await writeReviewedManifest(
      database.url,
      bootstrapDocument
    );
    await withClient(database.url, (client) =>
      client.query(
        `update public.channel_connectors
            set status = 'connected', updated_at = statement_timestamp()
          where id = 'connector:db008-semantic'`
      )
    );
    await expect(
      resetInboxV2Database({
        databaseUrl: database.url,
        migrationsFolder,
        bootstrap,
        manifestPath: semanticManifest.path,
        mig001EvidencePath: semanticManifest.mig001EvidencePath,
        objectReceiptPath: semanticManifest.objectReceiptPath,
        confirmation: semanticManifest.digest
      })
    ).rejects.toThrow(/reset_live_active_effects_present/u);
    expect((await readBootstrapState(database.url)).tenantCount).toBe(2);
    await withClient(database.url, (client) =>
      client.query(
        `update public.channel_connectors
            set status = 'draft', updated_at = statement_timestamp()
          where id = 'connector:db008-semantic'`
      )
    );

    const sameRowContentManifest = await writeReviewedManifest(
      database.url,
      bootstrapDocument
    );
    await withClient(database.url, (client) =>
      client.query(
        `update public.tenants
            set display_name = 'DB008 changed without changing row count'
          where id = 'tenant:db008-sentinel'`
      )
    );
    await expect(
      resetInboxV2Database({
        databaseUrl: database.url,
        migrationsFolder,
        bootstrap,
        manifestPath: sameRowContentManifest.path,
        mig001EvidencePath: sameRowContentManifest.mig001EvidencePath,
        objectReceiptPath: sameRowContentManifest.objectReceiptPath,
        confirmation: sameRowContentManifest.digest
      })
    ).rejects.toThrow(/reset_database_inventory_mismatch/u);
    await withClient(database.url, (client) =>
      client.query(
        `update public.tenants
            set display_name = 'DB008 sentinel'
          where id = 'tenant:db008-sentinel'`
      )
    );

    const sequenceManifest = await writeReviewedManifest(
      database.url,
      bootstrapDocument
    );
    await withClient(database.url, (client) =>
      client.query(
        `alter sequence drizzle.__drizzle_migrations_id_seq increment by 2`
      )
    );
    await expect(
      resetInboxV2Database({
        databaseUrl: database.url,
        migrationsFolder,
        bootstrap,
        manifestPath: sequenceManifest.path,
        mig001EvidencePath: sequenceManifest.mig001EvidencePath,
        objectReceiptPath: sequenceManifest.objectReceiptPath,
        confirmation: sequenceManifest.digest
      })
    ).rejects.toThrow(/reset_database_inventory_mismatch/u);
    await withClient(database.url, (client) =>
      client.query(
        `alter sequence drizzle.__drizzle_migrations_id_seq increment by 1`
      )
    );

    const extraDrizzleObjectManifest = await writeReviewedManifest(
      database.url,
      bootstrapDocument
    );
    await withClient(database.url, (client) =>
      client.query(`
        create table drizzle.customer_backup (
          id bigint primary key,
          payload text not null
        );
        insert into drizzle.customer_backup (id, payload)
          values (1, 'must not be silently discarded')
      `)
    );
    await expect(
      resetInboxV2Database({
        databaseUrl: database.url,
        migrationsFolder,
        bootstrap,
        manifestPath: extraDrizzleObjectManifest.path,
        mig001EvidencePath: extraDrizzleObjectManifest.mig001EvidencePath,
        objectReceiptPath: extraDrizzleObjectManifest.objectReceiptPath,
        confirmation: extraDrizzleObjectManifest.digest
      })
    ).rejects.toThrow(/reset_database_inventory_mismatch/u);
    await withClient(database.url, (client) =>
      client.query(`drop table drizzle.customer_backup`)
    );

    const largeObjectOid = await withClient(database.url, async (client) => {
      const result = await client.query(`select lo_create(0) as object_oid`);
      return result.rows[0].object_oid;
    });
    const largeObjectManifest = await writeReviewedManifest(
      database.url,
      bootstrapDocument
    );
    await expect(
      resetInboxV2Database({
        databaseUrl: database.url,
        migrationsFolder,
        bootstrap,
        manifestPath: largeObjectManifest.path,
        mig001EvidencePath: largeObjectManifest.mig001EvidencePath,
        objectReceiptPath: largeObjectManifest.objectReceiptPath,
        confirmation: largeObjectManifest.digest
      })
    ).rejects.toThrow(/reset_large_objects_unsupported/u);
    await withClient(database.url, (client) =>
      client.query(`select lo_unlink($1)`, [largeObjectOid])
    );

    const fenceRecoveryManifest = await writeReviewedManifest(
      database.url,
      bootstrapDocument
    );
    await expect(
      resetInboxV2Database({
        databaseUrl: database.url,
        migrationsFolder,
        bootstrap,
        manifestPath: fenceRecoveryManifest.path,
        mig001EvidencePath: fenceRecoveryManifest.mig001EvidencePath,
        objectReceiptPath: fenceRecoveryManifest.objectReceiptPath,
        confirmation: fenceRecoveryManifest.digest,
        testOnlyLoseFenceAcquireResponse: true
      })
    ).rejects.toThrow(/reset_test_fence_acquire_response_lost/u);
    await expect(
      installInboxV2Database({
        databaseUrl: database.url,
        migrationsFolder,
        bootstrap
      })
    ).resolves.toMatchObject({ action: "install" });

    const maxPreparedTransactions = await withClient(
      database.url,
      async (client) => {
        const result = await client.query(`show max_prepared_transactions`);
        return Number(result.rows[0].max_prepared_transactions);
      }
    );
    if (maxPreparedTransactions <= 0) {
      throw new Error(
        "DB-008 integration requires PostgreSQL max_prepared_transactions > 0."
      );
    }
    const preparedManifest = await writeReviewedManifest(
      database.url,
      bootstrapDocument
    );
    const preparedTransactionId = `db008_${randomBytes(8).toString("hex")}`;
    await withClient(database.url, async (client) => {
      await client.query("begin");
      await client.query("select 1");
      await client.query(`prepare transaction '${preparedTransactionId}'`);
    });
    try {
      await expect(
        resetInboxV2Database({
          databaseUrl: database.url,
          migrationsFolder,
          bootstrap,
          manifestPath: preparedManifest.path,
          mig001EvidencePath: preparedManifest.mig001EvidencePath,
          objectReceiptPath: preparedManifest.objectReceiptPath,
          confirmation: preparedManifest.digest
        })
      ).rejects.toThrow(/reset_prepared_transactions/u);
    } finally {
      await withClient(database.url, (client) =>
        client.query(`rollback prepared '${preparedTransactionId}'`)
      );
    }

    const activeConnectionManifest = await writeReviewedManifest(
      database.url,
      bootstrapDocument
    );
    const heldClient = new Client({ connectionString: database.url });
    await heldClient.connect();
    try {
      await expect(
        resetInboxV2Database({
          databaseUrl: database.url,
          migrationsFolder,
          bootstrap,
          manifestPath: activeConnectionManifest.path,
          mig001EvidencePath: activeConnectionManifest.mig001EvidencePath,
          objectReceiptPath: activeConnectionManifest.objectReceiptPath,
          confirmation: activeConnectionManifest.digest
        })
      ).rejects.toThrow(/reset_active_connections/u);
      await expect(
        heldClient.query("select 1 as alive")
      ).resolves.toMatchObject({
        rows: [{ alive: 1 }]
      });
    } finally {
      await heldClient.end();
    }

    const rollbackManifest = await writeReviewedManifest(
      database.url,
      bootstrapDocument
    );
    await expect(
      resetInboxV2Database({
        databaseUrl: database.url,
        migrationsFolder,
        bootstrap,
        manifestPath: rollbackManifest.path,
        mig001EvidencePath: rollbackManifest.mig001EvidencePath,
        objectReceiptPath: rollbackManifest.objectReceiptPath,
        confirmation: rollbackManifest.digest,
        testOnlyFailAfterSchemaReset: true
      })
    ).rejects.toThrow(/reset_test_failure_after_schema_reset/u);
    expect((await readBootstrapState(database.url)).streamEpoch).toBe(
      firstState.streamEpoch
    );
    await expect(
      installInboxV2Database({
        databaseUrl: database.url,
        migrationsFolder,
        bootstrap
      })
    ).resolves.toMatchObject({ action: "install" });

    const reviewed = await writeReviewedManifest(
      database.url,
      bootstrapDocument
    );
    const firstReset = await resetInboxV2Database({
      databaseUrl: database.url,
      migrationsFolder,
      bootstrap,
      manifestPath: reviewed.path,
      mig001EvidencePath: reviewed.mig001EvidencePath,
      objectReceiptPath: reviewed.objectReceiptPath,
      confirmation: reviewed.digest
    });
    const afterFirstReset = await readBootstrapState(database.url);
    expect(firstReset.previousStreamEpoch).toBe(firstState.streamEpoch);
    expect(firstReset.migrationCount).toBe(baselineMigrationCount);
    expect(afterFirstReset.streamEpoch).not.toBe(firstState.streamEpoch);
    expect(afterFirstReset.tenantCount).toBe(1);
    expect(afterFirstReset.streamHeadCount).toBe(1);
    expect(afterFirstReset.projectionGenerationCount).toBe(1);

    await expect(
      resetInboxV2Database({
        databaseUrl: database.url,
        migrationsFolder,
        bootstrap,
        manifestPath: reviewed.path,
        mig001EvidencePath: reviewed.mig001EvidencePath,
        objectReceiptPath: reviewed.objectReceiptPath,
        confirmation: reviewed.digest
      })
    ).resolves.toMatchObject({
      action: "reset_noop",
      resetGeneration: reviewed.resetGeneration,
      bootstrap: { streamEpoch: afterFirstReset.streamEpoch }
    });

    const expiredRetryNow = new Date(Date.now() + 25 * 60 * 60 * 1_000);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(expiredRetryNow);
    try {
      await expect(
        resetInboxV2Database({
          databaseUrl: database.url,
          migrationsFolder,
          bootstrap,
          manifestPath: reviewed.path,
          mig001EvidencePath: reviewed.mig001EvidencePath,
          objectReceiptPath: reviewed.objectReceiptPath,
          confirmation: reviewed.digest
        })
      ).resolves.toMatchObject({
        action: "reset_noop",
        resetGeneration: reviewed.resetGeneration,
        bootstrap: { streamEpoch: afterFirstReset.streamEpoch }
      });
    } finally {
      vi.useRealTimers();
    }

    const reusedGeneration = await writeReviewedManifest(
      database.url,
      differentBootstrap,
      (manifest) => {
        manifest.reset.generation = reviewed.resetGeneration;
      }
    );
    await expect(
      resetInboxV2Database({
        databaseUrl: database.url,
        migrationsFolder,
        bootstrap: differentBootstrap.path,
        manifestPath: reusedGeneration.path,
        mig001EvidencePath: reusedGeneration.mig001EvidencePath,
        objectReceiptPath: reusedGeneration.objectReceiptPath,
        confirmation: reusedGeneration.digest
      })
    ).rejects.toMatchObject({
      code: "inbox_v2.reset_idempotency_receipt_state_mismatch"
    });
    expect((await readBootstrapState(database.url)).streamEpoch).toBe(
      afterFirstReset.streamEpoch
    );
    expect(
      await withClient(database.url, async (client) => {
        const result = await client.query(
          "select count(*)::int as tenant_count from public.tenants where id = $1",
          ["tenant:db008-alternate"]
        );
        return result.rows[0].tenant_count;
      })
    ).toBe(0);

    await withClient(database.url, async (client) => {
      await expect(
        client.query(`truncate table public.inbox_v2_database_reset_receipts`)
      ).rejects.toThrow(/inbox_v2\.database_reset_receipt_immutable/u);
    });

    await withClient(database.url, (client) =>
      client.query(
        "grant insert on table public.inbox_v2_database_reset_receipts to public"
      )
    );
    try {
      await expect(
        installInboxV2Database({
          databaseUrl: database.url,
          migrationsFolder,
          bootstrap
        })
      ).rejects.toMatchObject({
        code: "inbox_v2.current_schema_privilege_mismatch"
      });
    } finally {
      await withClient(database.url, (client) =>
        client.query(
          "revoke insert on table public.inbox_v2_database_reset_receipts from public"
        )
      );
    }

    await withClient(database.url, (client) =>
      client.query(`
        grant insert on table public.inbox_v2_database_reset_receipts
          to hulee_inbox_v2_runtime
      `)
    );
    try {
      await expect(
        installInboxV2Database({
          databaseUrl: database.url,
          migrationsFolder,
          bootstrap
        })
      ).rejects.toMatchObject({
        code: "inbox_v2.current_schema_privilege_mismatch"
      });
    } finally {
      await withClient(database.url, (client) =>
        client.query(`
          revoke insert on table public.inbox_v2_database_reset_receipts
            from hulee_inbox_v2_runtime
        `)
      );
    }

    const resetReceiptOwner = await withClient(database.url, async (client) => {
      const result = await client.query(`
          select pg_get_userbyid(relation_row.relowner) as owner_name
            from pg_catalog.pg_class relation_row
           where relation_row.oid =
                 'public.inbox_v2_database_reset_receipts'::regclass
        `);
      return result.rows[0].owner_name;
    });
    await withClient(database.url, (client) =>
      client.query(`
        alter table public.inbox_v2_database_reset_receipts
          owner to hulee_inbox_v2_runtime
      `)
    );
    try {
      await expect(
        installInboxV2Database({
          databaseUrl: database.url,
          migrationsFolder,
          bootstrap
        })
      ).rejects.toMatchObject({
        code: "inbox_v2.current_schema_privilege_mismatch"
      });
    } finally {
      await withClient(database.url, (client) =>
        client.query(`
          alter table public.inbox_v2_database_reset_receipts
            owner to ${quoteIdentifier(resetReceiptOwner)}
        `)
      );
    }

    await withClient(database.url, (client) =>
      client.query("grant select on table public.inbox_v2_messages to public")
    );
    try {
      await expect(
        installInboxV2Database({
          databaseUrl: database.url,
          migrationsFolder,
          bootstrap
        })
      ).rejects.toMatchObject({
        code: "inbox_v2.current_schema_privilege_mismatch"
      });
    } finally {
      await withClient(database.url, (client) =>
        client.query(
          "revoke select on table public.inbox_v2_messages from public"
        )
      );
    }

    await withClient(database.url, (client) =>
      client.query(`
        grant select (manifest_id)
          on table public.inbox_v2_database_reset_receipts to public
      `)
    );
    try {
      await expect(
        installInboxV2Database({
          databaseUrl: database.url,
          migrationsFolder,
          bootstrap
        })
      ).rejects.toMatchObject({
        code: "inbox_v2.current_schema_privilege_mismatch"
      });
    } finally {
      await withClient(database.url, (client) =>
        client.query(`
          revoke select (manifest_id)
            on table public.inbox_v2_database_reset_receipts from public
        `)
      );
    }

    await withClient(database.url, (client) =>
      client.query(`
        grant execute on function
          public.inbox_v2_lock_participant_membership_mutation_v1(
            text, text, bigint, text, text,
            public.inbox_v2_participant_membership_origin_kind,
            public.inbox_v2_participant_membership_state
          )
        to public
      `)
    );
    try {
      await expect(
        installInboxV2Database({
          databaseUrl: database.url,
          migrationsFolder,
          bootstrap
        })
      ).rejects.toMatchObject({
        code: "inbox_v2.current_schema_privilege_mismatch"
      });
    } finally {
      await withClient(database.url, (client) =>
        client.query(`
          revoke all privileges on function
            public.inbox_v2_lock_participant_membership_mutation_v1(
              text, text, bigint, text, text,
              public.inbox_v2_participant_membership_origin_kind,
              public.inbox_v2_participant_membership_state
            )
          from public
        `)
      );
    }

    await withClient(database.url, (client) =>
      client.query(`
        grant execute on function
          public.inbox_v2_advance_tenant_stream_retained_prefix_v1(
            text, text, bigint, bigint, bigint, bigint, text, text, timestamptz
          )
        to public
      `)
    );
    try {
      await expect(
        installInboxV2Database({
          databaseUrl: database.url,
          migrationsFolder,
          bootstrap
        })
      ).rejects.toMatchObject({
        code: "inbox_v2.current_schema_privilege_mismatch"
      });
    } finally {
      await withClient(database.url, (client) =>
        client.query(`
          revoke all privileges on function
            public.inbox_v2_advance_tenant_stream_retained_prefix_v1(
              text, text, bigint, bigint, bigint, bigint, text, text,
              timestamptz
            )
          from public
        `)
      );
    }

    await withClient(database.url, (client) =>
      client.query(`
        grant execute on function
          public.inbox_v2_advance_tenant_stream_retained_prefix_v1(
            text, text, bigint, bigint, bigint, bigint, text, text, timestamptz
          )
        to hulee_inbox_v2_runtime with grant option
      `)
    );
    try {
      await expect(
        installInboxV2Database({
          databaseUrl: database.url,
          migrationsFolder,
          bootstrap
        })
      ).rejects.toMatchObject({
        code: "inbox_v2.current_schema_privilege_mismatch"
      });
    } finally {
      await withClient(database.url, (client) =>
        client.query(`
          revoke grant option for execute on function
            public.inbox_v2_advance_tenant_stream_retained_prefix_v1(
              text, text, bigint, bigint, bigint, bigint, text, text,
              timestamptz
            )
          from hulee_inbox_v2_runtime
        `)
      );
    }

    await withClient(database.url, (client) =>
      client.query(
        `grant execute on function
           public.inbox_v2_apply_participant_membership_mutation_v1(jsonb)
         to public`
      )
    );
    await expect(
      resetInboxV2Database({
        databaseUrl: database.url,
        migrationsFolder,
        bootstrap,
        manifestPath: reviewed.path,
        mig001EvidencePath: reviewed.mig001EvidencePath,
        objectReceiptPath: reviewed.objectReceiptPath,
        confirmation: reviewed.digest
      })
    ).rejects.toThrow(/current_schema_privilege_mismatch/u);
    await withClient(database.url, (client) =>
      client.query(
        `revoke all privileges on function
           public.inbox_v2_apply_participant_membership_mutation_v1(jsonb)
         from public`
      )
    );
    await expect(
      installInboxV2Database({
        databaseUrl: database.url,
        migrationsFolder,
        bootstrap
      })
    ).resolves.toMatchObject({
      action: "install"
    });

    await withClient(database.url, (client) =>
      client.query(`
        alter table public.inbox_v2_database_reset_receipts
          drop constraint inbox_v2_database_reset_receipts_manifest_unique
      `)
    );
    try {
      await expect(
        installInboxV2Database({
          databaseUrl: database.url,
          migrationsFolder,
          bootstrap
        })
      ).rejects.toMatchObject({
        code: "inbox_v2.current_schema_incomplete"
      });
    } finally {
      await withClient(database.url, (client) =>
        client.query(`
          alter table public.inbox_v2_database_reset_receipts
            add constraint inbox_v2_database_reset_receipts_manifest_unique
            unique (manifest_sha256)
        `)
      );
    }

    await withClient(database.url, (client) =>
      client.query(
        "drop index public.inbox_v2_database_reset_receipts_tenant_idx"
      )
    );
    try {
      await expect(
        installInboxV2Database({
          databaseUrl: database.url,
          migrationsFolder,
          bootstrap
        })
      ).rejects.toMatchObject({
        code: "inbox_v2.current_schema_incomplete"
      });
    } finally {
      await withClient(database.url, (client) =>
        client.query(`
          create index inbox_v2_database_reset_receipts_tenant_idx
            on public.inbox_v2_database_reset_receipts using btree (tenant_id)
        `)
      );
    }

    const stateConstraintDefinition = await withClient(
      database.url,
      async (client) => {
        const result = await client.query(`
          select pg_get_constraintdef(constraint_row.oid, true) as definition
            from pg_catalog.pg_constraint constraint_row
           where constraint_row.conrelid =
                   'public.inbox_v2_outbox_work_items'::regclass
             and constraint_row.conname =
                   'inbox_v2_outbox_work_items_state_check'
        `);
        return result.rows[0].definition;
      }
    );
    const weakenedStateConstraintDefinition = stateConstraintDefinition.replace(
      /^CHECK \(/u,
      "CHECK (state = state OR "
    );
    await withClient(database.url, (client) =>
      client.query(`
        alter table public.inbox_v2_outbox_work_items
          drop constraint inbox_v2_outbox_work_items_state_check;
        alter table public.inbox_v2_outbox_work_items
          add constraint inbox_v2_outbox_work_items_state_check
          ${weakenedStateConstraintDefinition}
      `)
    );
    await expect(
      installInboxV2Database({
        databaseUrl: database.url,
        migrationsFolder,
        bootstrap
      })
    ).rejects.toThrow(/current_schema_definition_mismatch/u);
    await withClient(database.url, async (client) => {
      await client.query(
        `alter table public.inbox_v2_outbox_work_items
           drop constraint inbox_v2_outbox_work_items_state_check`
      );
      await client.query(
        `alter table public.inbox_v2_outbox_work_items
           add constraint inbox_v2_outbox_work_items_state_check
           ${stateConstraintDefinition}`
      );
    });

    await withClient(database.url, (client) =>
      client.query(
        `alter table public.inbox_v2_outbox_work_items
           enable replica trigger inbox_v2_outbox_work_guard_trigger`
      )
    );
    await expect(
      installInboxV2Database({
        databaseUrl: database.url,
        migrationsFolder,
        bootstrap
      })
    ).rejects.toThrow(/current_schema_definition_mismatch/u);
    await withClient(database.url, (client) =>
      client.query(
        `alter table public.inbox_v2_outbox_work_items
           enable trigger inbox_v2_outbox_work_guard_trigger`
      )
    );

    await withClient(database.url, (client) =>
      client.query(`
        drop trigger inbox_v2_database_reset_receipt_immutable_trigger
          on public.inbox_v2_database_reset_receipts;
        create trigger inbox_v2_database_reset_receipt_immutable_trigger
          before update or delete on public.inbox_v2_database_reset_receipts
          for each row when (false)
          execute function public.inbox_v2_database_reset_receipt_immutable_guard()
      `)
    );
    try {
      await expect(
        installInboxV2Database({
          databaseUrl: database.url,
          migrationsFolder,
          bootstrap
        })
      ).rejects.toMatchObject({
        code: "inbox_v2.current_schema_definition_mismatch"
      });
    } finally {
      await withClient(database.url, (client) =>
        client.query(`
          drop trigger inbox_v2_database_reset_receipt_immutable_trigger
            on public.inbox_v2_database_reset_receipts;
          create trigger inbox_v2_database_reset_receipt_immutable_trigger
            before update or delete on public.inbox_v2_database_reset_receipts
            for each row execute function
              public.inbox_v2_database_reset_receipt_immutable_guard()
        `)
      );
    }

    const streamHeadTriggerDefinition = await withClient(
      database.url,
      async (client) => {
        const result = await client.query(`
          select pg_get_triggerdef(trigger_row.oid, true) as definition
            from pg_catalog.pg_trigger trigger_row
           where trigger_row.tgrelid =
                   'public.inbox_v2_tenant_stream_heads'::regclass
             and trigger_row.tgname =
                   'inbox_v2_tenant_stream_head_guard_trigger'
        `);
        return result.rows[0].definition;
      }
    );
    await withClient(database.url, (client) =>
      client.query(
        `drop trigger inbox_v2_tenant_stream_head_guard_trigger
           on public.inbox_v2_tenant_stream_heads`
      )
    );
    await expect(
      installInboxV2Database({
        databaseUrl: database.url,
        migrationsFolder,
        bootstrap
      })
    ).rejects.toThrow(/current_schema_incomplete/u);
    await withClient(database.url, (client) =>
      client.query(streamHeadTriggerDefinition)
    );

    await withClient(database.url, (client) =>
      client.query(
        `create or replace function public.inbox_v2_repository_outbox_work_guard()
         returns trigger
         language plpgsql
         set search_path = pg_catalog, public, pg_temp
         as $function$
         begin
           return new;
         end;
         $function$`
      )
    );
    await expect(
      installInboxV2Database({
        databaseUrl: database.url,
        migrationsFolder,
        bootstrap
      })
    ).rejects.toThrow(/current_schema_definition_mismatch/u);
    const schemaRepairManifest = await writeReviewedManifest(
      database.url,
      bootstrapDocument
    );
    const schemaRepairReset = await resetInboxV2Database({
      databaseUrl: database.url,
      migrationsFolder,
      bootstrap,
      manifestPath: schemaRepairManifest.path,
      mig001EvidencePath: schemaRepairManifest.mig001EvidencePath,
      objectReceiptPath: schemaRepairManifest.objectReceiptPath,
      confirmation: schemaRepairManifest.digest
    });
    const afterSchemaRepair = await readBootstrapState(database.url);
    expect(schemaRepairReset.previousStreamEpoch).toBe(
      afterFirstReset.streamEpoch
    );
    expect(schemaRepairReset.migrationCount).toBe(baselineMigrationCount);
    expect(afterSchemaRepair.streamEpoch).not.toBe(afterFirstReset.streamEpoch);

    await expect(
      resetInboxV2Database({
        databaseUrl: database.url,
        migrationsFolder,
        bootstrap,
        manifestPath: reviewed.path,
        mig001EvidencePath: reviewed.mig001EvidencePath,
        objectReceiptPath: reviewed.objectReceiptPath,
        confirmation: reviewed.digest
      })
    ).rejects.toThrow(/reset_idempotency_receipt_state_mismatch/u);
    expect((await readBootstrapState(database.url)).streamEpoch).toBe(
      afterSchemaRepair.streamEpoch
    );

    await withClient(database.url, (client) =>
      client.query(
        `update drizzle.__drizzle_migrations
              set hash = repeat('0', 64)
            where id = (select max(id) from drizzle.__drizzle_migrations)`
      )
    );
    await expect(
      installInboxV2Database({
        databaseUrl: database.url,
        migrationsFolder,
        bootstrap
      })
    ).rejects.toThrow(/migration_journal_not_prefix/u);
    expect((await readBootstrapState(database.url)).streamEpoch).toBe(
      afterSchemaRepair.streamEpoch
    );

    const repairManifest = await writeReviewedManifest(
      database.url,
      bootstrapDocument
    );
    const repairReset = await resetInboxV2Database({
      databaseUrl: database.url,
      migrationsFolder,
      bootstrap,
      manifestPath: repairManifest.path,
      mig001EvidencePath: repairManifest.mig001EvidencePath,
      objectReceiptPath: repairManifest.objectReceiptPath,
      confirmation: repairManifest.digest
    });
    const repairedState = await readBootstrapState(database.url);
    expect(repairReset.previousStreamEpoch).toBe(afterSchemaRepair.streamEpoch);
    expect(repairReset.migrationCount).toBe(baselineMigrationCount);
    expect(repairedState.streamEpoch).not.toBe(afterSchemaRepair.streamEpoch);
    expect(repairedState.tenantCount).toBe(1);
    expect(repairedState.projectionCheckpointCount).toBe(1);

    await expect(
      installInboxV2Database({
        databaseUrl: database.url,
        migrationsFolder,
        bootstrap
      })
    ).resolves.toMatchObject({
      action: "install",
      migrationJournalSha256: firstInstall.migrationJournalSha256
    });
    await expectCleanSlateBaseline(database.url);
  }, 480_000);

  it("rejects gate-critical tenant, thread, assignment and sequence schema tampering", async () => {
    const database = await createDisposableDatabase("gate_contract");
    const expectedMigrationCount =
      expectedMigrationContract(migrationsFolder).length;
    expect(expectedMigrationCount).toBe(baselineMigrationCount);
    const installCurrent = () =>
      installInboxV2Database({
        databaseUrl: database.url,
        migrationsFolder
      });
    const expectInstallFailure = async (code) => {
      await expect(installCurrent()).rejects.toMatchObject({ code });
    };

    await expect(installCurrent()).resolves.toMatchObject({
      action: "install",
      migrationCount: expectedMigrationCount
    });
    await expectCleanSlateBaseline(database.url);

    await withClient(database.url, (client) =>
      client.query(`
        alter table public.inbox_v2_conversation_identity_fences
          rename to inbox_v2_conversation_identity_fences_tampered
      `)
    );
    try {
      await expectInstallFailure("inbox_v2.current_schema_incomplete");
    } finally {
      await withClient(database.url, (client) =>
        client.query(`
          alter table public.inbox_v2_conversation_identity_fences_tampered
            rename to inbox_v2_conversation_identity_fences
        `)
      );
    }

    await withClient(database.url, (client) =>
      client.query(`
        alter table public.inbox_v2_conversations
          drop constraint inbox_v2_conversations_tenant_id_tenants_id_fk
      `)
    );
    try {
      await expectInstallFailure("inbox_v2.current_schema_incomplete");
    } finally {
      await withClient(database.url, (client) =>
        client.query(`
          alter table public.inbox_v2_conversations
            add constraint inbox_v2_conversations_tenant_id_tenants_id_fk
            foreign key (tenant_id) references public.tenants(id)
            on delete no action on update no action
        `)
      );
    }

    await withClient(database.url, (client) =>
      client.query(`
        alter table public.inbox_v2_source_thread_bindings
          drop constraint inbox_v2_source_thread_bindings_thread_fk
      `)
    );
    try {
      await expectInstallFailure("inbox_v2.current_schema_incomplete");
    } finally {
      await withClient(database.url, (client) =>
        client.query(`
          alter table public.inbox_v2_source_thread_bindings
            add constraint inbox_v2_source_thread_bindings_thread_fk
            foreign key (tenant_id, external_thread_id)
            references public.inbox_v2_external_threads(tenant_id, id)
            on delete no action on update no action
        `)
      );
    }

    await withClient(database.url, (client) =>
      client.query(`
        alter table public.inbox_v2_external_threads
          drop constraint inbox_v2_external_threads_registry_fk
      `)
    );
    try {
      await expectInstallFailure("inbox_v2.current_schema_incomplete");
    } finally {
      await withClient(database.url, (client) =>
        client.query(`
          alter table public.inbox_v2_external_threads
            add constraint inbox_v2_external_threads_registry_fk
            foreign key (
              tenant_id,
              key_registry_id,
              key_registry_entry_kind,
              id,
              conversation_id,
              key_digest
            ) references public.inbox_v2_external_thread_key_registry (
              tenant_id,
              id,
              entry_kind,
              canonical_thread_id,
              canonical_conversation_id,
              key_digest
            ) on delete no action on update no action
        `)
      );
    }

    const bindingAnchorTriggerDefinition = await readTriggerDefinition(
      database.url,
      "inbox_v2_source_thread_bindings",
      "inbox_v2_binding_anchors_integrity"
    );
    await withClient(database.url, (client) =>
      client.query(`
        drop trigger inbox_v2_binding_anchors_integrity
          on public.inbox_v2_source_thread_bindings
      `)
    );
    try {
      await expectInstallFailure("inbox_v2.current_schema_incomplete");
    } finally {
      await withClient(database.url, (client) =>
        client.query(bindingAnchorTriggerDefinition)
      );
    }

    const bindingAnchorImmutableTriggerDefinition = await readTriggerDefinition(
      database.url,
      "inbox_v2_source_thread_bindings",
      "inbox_v2_binding_anchors_immutable"
    );
    await withClient(database.url, (client) =>
      client.query(`
        drop trigger inbox_v2_binding_anchors_immutable
          on public.inbox_v2_source_thread_bindings
      `)
    );
    try {
      await expectInstallFailure("inbox_v2.current_schema_incomplete");
    } finally {
      await withClient(database.url, (client) =>
        client.query(bindingAnchorImmutableTriggerDefinition)
      );
    }

    await withClient(database.url, (client) =>
      client.query(`
        drop index public.inbox_v2_ext_thread_key_canonical_target_unique;
        create unique index inbox_v2_ext_thread_key_canonical_target_unique
          on public.inbox_v2_external_thread_key_registry using btree
            (tenant_id, canonical_thread_id)
          where entry_kind = 'alias'
      `)
    );
    try {
      await expectInstallFailure("inbox_v2.current_schema_definition_mismatch");
    } finally {
      await withClient(database.url, (client) =>
        client.query(`
          drop index public.inbox_v2_ext_thread_key_canonical_target_unique;
          create unique index inbox_v2_ext_thread_key_canonical_target_unique
            on public.inbox_v2_external_thread_key_registry using btree
              (tenant_id, canonical_thread_id)
            where entry_kind = 'canonical'
        `)
      );
    }

    await withClient(database.url, (client) =>
      client.query(`
        alter table public.inbox_v2_work_item_primary_assignments
          enable replica trigger
            inbox_v2_work_item_primary_assignments_guard_trigger
      `)
    );
    try {
      await expectInstallFailure("inbox_v2.current_schema_definition_mismatch");
    } finally {
      await withClient(database.url, (client) =>
        client.query(`
          alter table public.inbox_v2_work_item_primary_assignments
            enable trigger
              inbox_v2_work_item_primary_assignments_guard_trigger
        `)
      );
    }

    const assignmentNonOverlapTriggerDefinition = await readTriggerDefinition(
      database.url,
      "inbox_v2_work_item_primary_assignments",
      "inbox_v2_work_assignment_non_overlap_constraint"
    );
    await withClient(database.url, (client) =>
      client.query(`
        drop trigger inbox_v2_work_assignment_non_overlap_constraint
          on public.inbox_v2_work_item_primary_assignments
      `)
    );
    try {
      await expectInstallFailure("inbox_v2.current_schema_incomplete");
    } finally {
      await withClient(database.url, (client) =>
        client.query(assignmentNonOverlapTriggerDefinition)
      );
    }

    const assignmentAggregateTriggerDefinition = await readTriggerDefinition(
      database.url,
      "inbox_v2_work_item_primary_assignments",
      "inbox_v2_work_assignment_aggregate_constraint"
    );
    await withClient(database.url, (client) =>
      client.query(`
        drop trigger inbox_v2_work_assignment_aggregate_constraint
          on public.inbox_v2_work_item_primary_assignments
      `)
    );
    try {
      await expectInstallFailure("inbox_v2.current_schema_incomplete");
    } finally {
      await withClient(database.url, (client) =>
        client.query(assignmentAggregateTriggerDefinition)
      );
    }

    await withClient(database.url, (client) =>
      client.query(`
        drop index public.inbox_v2_work_items_non_terminal_unique;
        create unique index inbox_v2_work_items_non_terminal_unique
          on public.inbox_v2_work_items using btree
            (tenant_id, conversation_id)
          where state in ('new', 'assigned', 'in_progress')
      `)
    );
    try {
      await expectInstallFailure("inbox_v2.current_schema_definition_mismatch");
    } finally {
      await withClient(database.url, (client) =>
        client.query(`
          drop index public.inbox_v2_work_items_non_terminal_unique;
          create unique index inbox_v2_work_items_non_terminal_unique
            on public.inbox_v2_work_items using btree
              (tenant_id, conversation_id)
            where state in ('new', 'assigned', 'in_progress', 'waiting')
        `)
      );
    }

    await withClient(database.url, (client) =>
      client.query(`
        drop index
          public.inbox_v2_work_item_primary_assignment_active_unique;
        create unique index
          inbox_v2_work_item_primary_assignment_active_unique
          on public.inbox_v2_work_item_primary_assignments using btree
            (tenant_id, work_item_id)
          where state = 'ended'
      `)
    );
    try {
      await expectInstallFailure("inbox_v2.current_schema_definition_mismatch");
    } finally {
      await withClient(database.url, (client) =>
        client.query(`
          drop index
            public.inbox_v2_work_item_primary_assignment_active_unique;
          create unique index
            inbox_v2_work_item_primary_assignment_active_unique
            on public.inbox_v2_work_item_primary_assignments using btree
              (tenant_id, work_item_id)
            where state = 'active'
        `)
      );
    }

    await withClient(database.url, (client) =>
      client.query(`
        alter table public.inbox_v2_conversation_identity_fences
          drop constraint inbox_v2_conversation_identity_fences_values_check;
        alter table public.inbox_v2_conversation_identity_fences
          add constraint inbox_v2_conversation_identity_fences_values_check
          check (
            retired_revision >= 0
            and retired_stream_position >= 1
            and isfinite(retired_updated_at)
            and isfinite(retired_at)
          )
      `)
    );
    try {
      await expectInstallFailure("inbox_v2.current_schema_definition_mismatch");
    } finally {
      await withClient(database.url, (client) =>
        client.query(`
          alter table public.inbox_v2_conversation_identity_fences
            drop constraint inbox_v2_conversation_identity_fences_values_check;
          alter table public.inbox_v2_conversation_identity_fences
            add constraint inbox_v2_conversation_identity_fences_values_check
            check (
              retired_revision >= 1
              and retired_stream_position >= 1
              and isfinite(retired_updated_at)
              and isfinite(retired_at)
            )
        `)
      );
    }

    await withClient(database.url, (client) =>
      client.query(`
        alter table public.inbox_v2_conversations enable replica trigger
          inbox_v2_conversations_insert_guard_trigger
      `)
    );
    try {
      await expectInstallFailure("inbox_v2.current_schema_definition_mismatch");
    } finally {
      await withClient(database.url, (client) =>
        client.query(`
          alter table public.inbox_v2_conversations enable trigger
            inbox_v2_conversations_insert_guard_trigger
        `)
      );
    }

    const identityLockFunctionDefinition = await withClient(
      database.url,
      async (client) => {
        const result = await client.query(`
          select pg_get_functiondef(
                   'public.inbox_v2_lock_conversation_identity(text,text)'
                     ::regprocedure
                 ) as definition
        `);
        return result.rows[0].definition;
      }
    );
    await withClient(database.url, (client) =>
      client.query(`
        create or replace function public.inbox_v2_lock_conversation_identity(
          checked_tenant_id text,
          checked_conversation_id text
        )
        returns void
        language plpgsql
        set search_path = pg_catalog, public, pg_temp
        as $function$
        begin
          return;
        end;
        $function$
      `)
    );
    try {
      await expectInstallFailure("inbox_v2.current_schema_definition_mismatch");
    } finally {
      await withClient(database.url, (client) =>
        client.query(identityLockFunctionDefinition)
      );
    }

    const timelineCoherenceTriggerDefinition = await readTriggerDefinition(
      database.url,
      "inbox_v2_timeline_items",
      "inbox_v2_tm_timeline_coherence"
    );
    await withClient(database.url, (client) =>
      client.query(`
        drop trigger inbox_v2_tm_timeline_coherence
          on public.inbox_v2_timeline_items
      `)
    );
    try {
      await expectInstallFailure("inbox_v2.current_schema_incomplete");
    } finally {
      await withClient(database.url, (client) =>
        client.query(timelineCoherenceTriggerDefinition)
      );
    }

    await withClient(database.url, (client) =>
      client.query(`
        alter table public.inbox_v2_timeline_items enable replica trigger
          inbox_v2_tm_timeline_head_guard
      `)
    );
    try {
      await expectInstallFailure("inbox_v2.current_schema_definition_mismatch");
    } finally {
      await withClient(database.url, (client) =>
        client.query(`
          alter table public.inbox_v2_timeline_items enable trigger
            inbox_v2_tm_timeline_head_guard
        `)
      );
    }

    await withClient(database.url, (client) =>
      client.query(`
        drop index
          public.inbox_v2_timeline_items_eligible_activity_tail_idx;
        create index inbox_v2_timeline_items_eligible_activity_tail_idx
          on public.inbox_v2_timeline_items using btree
            (
              tenant_id,
              conversation_id,
              timeline_sequence desc nulls last,
              id,
              occurred_at
            )
          where activity_kind = 'non_activity'
      `)
    );
    try {
      await expectInstallFailure("inbox_v2.current_schema_definition_mismatch");
    } finally {
      await withClient(database.url, (client) =>
        client.query(`
          drop index
            public.inbox_v2_timeline_items_eligible_activity_tail_idx;
          create index inbox_v2_timeline_items_eligible_activity_tail_idx
            on public.inbox_v2_timeline_items using btree
              (
                tenant_id,
                conversation_id,
                timeline_sequence desc nulls last,
                id,
                occurred_at
              )
            where activity_kind = 'eligible'
        `)
      );
    }

    await withClient(database.url, (client) =>
      client.query(`
        drop index
          public.inbox_v2_timeline_subject_details_system_event_unique;
        create unique index
          inbox_v2_timeline_subject_details_system_event_unique
          on public.inbox_v2_timeline_subject_details using btree
            (tenant_id, system_event_id)
          where system_event_id is null
      `)
    );
    try {
      await expectInstallFailure("inbox_v2.current_schema_definition_mismatch");
    } finally {
      await withClient(database.url, (client) =>
        client.query(`
          drop index
            public.inbox_v2_timeline_subject_details_system_event_unique;
          create unique index
            inbox_v2_timeline_subject_details_system_event_unique
            on public.inbox_v2_timeline_subject_details using btree
              (tenant_id, system_event_id)
            where system_event_id is not null
        `)
      );
    }

    for (const [relation, trigger] of [
      [
        "inbox_v2_timeline_subject_details",
        "inbox_v2_system_event_timeline_binding_guard"
      ],
      ["event_store", "inbox_v2_referenced_system_event_immutable_guard"]
    ]) {
      const definition = await readTriggerDefinition(
        database.url,
        relation,
        trigger
      );
      await withClient(database.url, (client) =>
        client.query(`drop trigger ${trigger} on public.${relation}`)
      );
      try {
        await expectInstallFailure("inbox_v2.current_schema_incomplete");
      } finally {
        await withClient(database.url, (client) => client.query(definition));
      }
    }

    for (const routine of [
      "inbox_v2_system_event_timeline_binding_guard",
      "inbox_v2_referenced_system_event_immutable_guard"
    ]) {
      const definition = await readFunctionDefinition(
        database.url,
        `public.${routine}()`
      );
      await withClient(database.url, (client) =>
        client.query(`
          create or replace function public.${routine}()
          returns trigger
          language plpgsql
          set search_path = pg_catalog, public, pg_temp
          as $function$
          begin
            if tg_op = 'DELETE' then
              return old;
            end if;
            return new;
          end;
          $function$
        `)
      );
      try {
        await expectInstallFailure(
          "inbox_v2.current_schema_definition_mismatch"
        );
      } finally {
        await withClient(database.url, (client) => client.query(definition));
      }
    }

    const timelineClockConstraintDefinition = await readConstraintDefinition(
      database.url,
      "inbox_v2_timeline_items",
      "inbox_v2_timeline_items_clock_check"
    );
    await withClient(database.url, (client) =>
      client.query(`
        alter table public.inbox_v2_timeline_items
          drop constraint inbox_v2_timeline_items_clock_check
      `)
    );
    try {
      await expectInstallFailure("inbox_v2.current_schema_incomplete");
    } finally {
      await withClient(database.url, (client) =>
        client.query(`
          alter table public.inbox_v2_timeline_items
            add constraint inbox_v2_timeline_items_clock_check
            ${timelineClockConstraintDefinition}
        `)
      );
    }

    await expect(installCurrent()).resolves.toMatchObject({
      action: "install",
      migrationCount: expectedMigrationCount
    });
  }, 420_000);
});

async function expectCleanSlateBaseline(databaseUrl) {
  const catalog = await withClient(databaseUrl, async (client) => {
    const journal = await client.query(
      "select count(*)::int as migration_count from drizzle.__drizzle_migrations"
    );
    const relations = await client.query(
      `select relation_row.relname as relation_name
           from pg_catalog.pg_class relation_row
           join pg_catalog.pg_namespace namespace_row
             on namespace_row.oid = relation_row.relnamespace
          where namespace_row.nspname = 'public'
            and relation_row.relname = any($1::text[])
          order by relation_row.relname`,
      [removedInboxV1Relations]
    );
    const enums = await client.query(
      `select type_row.typname as enum_name
           from pg_catalog.pg_type type_row
           join pg_catalog.pg_namespace namespace_row
             on namespace_row.oid = type_row.typnamespace
          where namespace_row.nspname = 'public'
            and type_row.typtype = 'e'
            and type_row.typname = any($1::text[])
          order by type_row.typname`,
      [removedInboxV1Enums]
    );
    return {
      migrationCount: journal.rows[0].migration_count,
      relations: relations.rows.map((row) => row.relation_name),
      enums: enums.rows.map((row) => row.enum_name)
    };
  });

  expect(catalog).toEqual({
    migrationCount: baselineMigrationCount,
    relations: [],
    enums: []
  });
  const retainedCatalog = await withClient(databaseUrl, (client) =>
    verifyInboxV2BaselineCatalog(client)
  );
  expect(retainedCatalog).toMatchObject({
    rowCount: 14619,
    sha256:
      "sha256:e552f4e499dd6f778bf15d277370c2277261c0756568708450fb0db7c73b8a01"
  });
}

async function createDisposableDatabase(label) {
  const suffix = randomBytes(5).toString("hex");
  const name = `hulee_db008_${label}_${process.pid}_${suffix}`.toLowerCase();
  assertDisposableTestDatabaseName(name);
  await adminClient.query(`create database ${quoteIdentifier(name)}`);
  createdDatabases.push(name);
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${name}`;
  return { name, url: url.toString() };
}

async function writeReviewedManifest(
  databaseUrl,
  bootstrapDocument,
  mutate = () => {}
) {
  const snapshot = await withClient(databaseUrl, async (client) => {
    const target = await inspectInboxV2DatabaseTarget(client);
    const journal = await readAppliedMigrationJournal(client);
    const inventory = await inspectInboxV2DatabaseInventory(client);
    return { target, journal, inventory };
  });
  const generatedResetGeneration = `reset:generation:${randomBytes(8).toString("hex")}`;
  const reviewedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1_000).toISOString();
  const manifest = {
    schemaId: INBOX_V2_DISPOSITION_MANIFEST_SCHEMA_ID,
    schemaVersion: INBOX_V2_DATABASE_LIFECYCLE_SCHEMA_VERSION,
    migrationContractVersion: INBOX_V2_MIGRATION_CONTRACT_VERSION,
    manifestId: `manifest:db008:${randomBytes(8).toString("hex")}`,
    deploymentId: "deployment:db008-integration",
    deploymentKind: "ephemeral_ci",
    classification: "disposable",
    approvedBy: "operator:db008-integration",
    approvedAt: reviewedAt,
    expiresAt,
    reason:
      "Explicit disposable child database used by the DB-008 lifecycle suite.",
    target: {
      postgresSystemIdentifier: snapshot.target.postgresSystemIdentifier,
      databaseName: snapshot.target.databaseName,
      databaseOwner: snapshot.target.databaseOwner,
      migrationJournalSha256: digestMigrationJournal(snapshot.journal),
      migrationContractSha256: digestMigrationJournal(
        expectedMigrationContract(migrationsFolder)
      )
    },
    fastPath: {
      inventoryTaskId: "INB2-MIG-001",
      evidenceId: "evidence:synthetic-db008-integration",
      evidenceSha256: `sha256:${"0".repeat(64)}`,
      decision: "eligible",
      verifiedAt: reviewedAt,
      conditions: {
        noSupportedDeployment: true,
        noPromisedPublicApiConsumer: true,
        noRealCustomerData: true,
        noLegalHoldOrRequiredAudit: true,
        noActiveProviderOrUncertainEffect: true,
        noUnknownConsumerOrInstallation: true
      }
    },
    inventory: {
      recordedAt: reviewedAt,
      databaseInventorySha256: snapshot.inventory.digest,
      tenantCount: snapshot.inventory.tenantCount,
      v1BusinessRowCount: snapshot.inventory.v1BusinessRowCount,
      activeProviderSessions: snapshot.inventory.activeProviderSessions,
      pendingOrUncertainOutbox: snapshot.inventory.pendingOrUncertainOutbox,
      activeLeases: snapshot.inventory.activeLeases,
      publishedV2Cursor: snapshot.inventory.publishedV2Cursor
    },
    objectStorage: {
      status: "not_configured",
      scope: "none",
      inventoryCheckpoint: "object-inventory:synthetic-db008-integration",
      receiptSha256: "",
      verifiedAt: reviewedAt
    },
    reset: {
      generation: generatedResetGeneration,
      bootstrapSha256: bootstrapDocument.digest,
      authorized: true,
      rotateStreamEpoch: true
    }
  };
  mutate(manifest);
  const resetGeneration = manifest.reset.generation;
  const objectReceipt = {
    schemaId: INBOX_V2_OBJECT_STORAGE_RECEIPT_SCHEMA_ID,
    schemaVersion: INBOX_V2_DATABASE_LIFECYCLE_SCHEMA_VERSION,
    manifestId: manifest.manifestId,
    resetGeneration,
    deploymentId: manifest.deploymentId,
    postgresSystemIdentifier: manifest.target.postgresSystemIdentifier,
    databaseName: manifest.target.databaseName,
    databaseOwner: manifest.target.databaseOwner,
    databaseInventorySha256: manifest.inventory.databaseInventorySha256,
    status: manifest.objectStorage.status,
    scope: manifest.objectStorage.scope,
    inventoryCheckpoint: manifest.objectStorage.inventoryCheckpoint,
    verifiedAt: manifest.objectStorage.verifiedAt
  };
  const objectReceiptContent = `${JSON.stringify(objectReceipt, null, 2)}\n`;
  manifest.objectStorage.receiptSha256 = sha256(
    Buffer.from(objectReceiptContent, "utf8")
  );
  const mig001Evidence = {
    schemaId: INBOX_V2_MIG_001_EVIDENCE_SCHEMA_ID,
    schemaVersion: INBOX_V2_DATABASE_LIFECYCLE_SCHEMA_VERSION,
    taskId: "INB2-MIG-001",
    status: "completed",
    decision: manifest.fastPath.decision,
    evidenceId: manifest.fastPath.evidenceId,
    manifestId: manifest.manifestId,
    resetGeneration,
    reviewedDispositionSha256: digestInboxV2ReviewedDisposition(manifest),
    target: {
      postgresSystemIdentifier: manifest.target.postgresSystemIdentifier,
      databaseName: manifest.target.databaseName,
      databaseOwner: manifest.target.databaseOwner
    },
    verifiedAt: manifest.fastPath.verifiedAt,
    conditions: manifest.fastPath.conditions
  };
  const mig001EvidenceContent = `${JSON.stringify(mig001Evidence, null, 2)}\n`;
  manifest.fastPath.evidenceSha256 = sha256(
    Buffer.from(mig001EvidenceContent, "utf8")
  );
  const content = `${JSON.stringify(manifest, null, 2)}\n`;
  const path = join(
    temporaryDirectory,
    `${manifest.manifestId.replaceAll(":", "-")}.json`
  );
  await writeFile(path, content, "utf8");
  const objectReceiptPath = join(
    temporaryDirectory,
    `${manifest.manifestId.replaceAll(":", "-")}-object-receipt.json`
  );
  await writeFile(objectReceiptPath, objectReceiptContent, "utf8");
  const mig001EvidencePath = join(
    temporaryDirectory,
    `${manifest.manifestId.replaceAll(":", "-")}-mig-001-evidence.json`
  );
  await writeFile(mig001EvidencePath, mig001EvidenceContent, "utf8");
  return {
    path,
    objectReceiptPath,
    mig001EvidencePath,
    resetGeneration,
    digest: sha256(Buffer.from(content, "utf8"))
  };
}

async function writeBootstrapFixture(
  fixture = bootstrapFixture(),
  label = "repository-bootstrap"
) {
  const content = `${JSON.stringify(fixture, null, 2)}\n`;
  const path = join(
    temporaryDirectory,
    `${label}-${randomBytes(5).toString("hex")}.json`
  );
  await writeFile(path, content, "utf8");
  return {
    path,
    digest: sha256(Buffer.from(content, "utf8"))
  };
}

async function readBootstrapState(databaseUrl) {
  return withClient(databaseUrl, async (client) => {
    const result = await client.query(`
      select
        (select count(*)::int from public.tenants) as tenant_count,
        (select count(*)::int from public.inbox_v2_tenant_stream_heads)
          as stream_head_count,
        (select count(*)::int from public.inbox_v2_projection_generations)
          as projection_generation_count,
        (select count(*)::int from public.inbox_v2_projection_checkpoints)
          as projection_checkpoint_count,
        (select count(*)::int from public.inbox_v2_projection_heads)
          as projection_head_count,
        (select stream_epoch from public.inbox_v2_tenant_stream_heads
          where tenant_id = 'tenant:db008-bootstrap') as stream_epoch,
        (select revision::text from public.inbox_v2_tenant_stream_heads
          where tenant_id = 'tenant:db008-bootstrap') as stream_revision,
        (select revision::text from public.inbox_v2_projection_generations
          where tenant_id = 'tenant:db008-bootstrap') as projection_revision,
        (select revision::text from public.inbox_v2_projection_checkpoints
          where tenant_id = 'tenant:db008-bootstrap') as checkpoint_revision
    `);
    const row = result.rows[0];
    return {
      tenantCount: row.tenant_count,
      streamHeadCount: row.stream_head_count,
      projectionGenerationCount: row.projection_generation_count,
      projectionCheckpointCount: row.projection_checkpoint_count,
      projectionHeadCount: row.projection_head_count,
      streamEpoch: row.stream_epoch,
      streamRevision: row.stream_revision,
      projectionRevision: row.projection_revision,
      checkpointRevision: row.checkpoint_revision
    };
  });
}

async function withClient(databaseUrl, work) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function readTriggerDefinition(databaseUrl, relation, trigger) {
  return withClient(databaseUrl, async (client) => {
    const result = await client.query(
      `select pg_get_triggerdef(trigger_row.oid, true) as definition
         from pg_catalog.pg_trigger trigger_row
        where trigger_row.tgrelid = to_regclass($1)
          and trigger_row.tgname = $2
          and not trigger_row.tgisinternal`,
      [`public.${relation}`, trigger]
    );
    if (result.rows.length !== 1) {
      throw new Error(`Missing trigger definition for ${relation}.${trigger}.`);
    }
    return result.rows[0].definition;
  });
}

async function readFunctionDefinition(databaseUrl, signature) {
  return withClient(databaseUrl, async (client) => {
    const result = await client.query(
      `select pg_get_functiondef(to_regprocedure($1)) as definition`,
      [signature]
    );
    if (result.rows.length !== 1 || result.rows[0].definition === null) {
      throw new Error(`Missing function definition for ${signature}.`);
    }
    return result.rows[0].definition;
  });
}

async function readConstraintDefinition(databaseUrl, relation, constraint) {
  return withClient(databaseUrl, async (client) => {
    const result = await client.query(
      `select pg_get_constraintdef(constraint_row.oid, false) as definition
         from pg_catalog.pg_constraint constraint_row
        where constraint_row.conrelid = to_regclass($1)
          and constraint_row.conname = $2`,
      [`public.${relation}`, constraint]
    );
    if (result.rows.length !== 1) {
      throw new Error(
        `Missing constraint definition for ${relation}.${constraint}.`
      );
    }
    return result.rows[0].definition;
  });
}

function bootstrapFixture() {
  return {
    schemaId: INBOX_V2_REPOSITORY_BOOTSTRAP_SCHEMA_ID,
    schemaVersion: INBOX_V2_DATABASE_LIFECYCLE_SCHEMA_VERSION,
    tenant: {
      id: "tenant:db008-bootstrap",
      slug: "db008-bootstrap",
      displayName: "DB008 Bootstrap",
      deploymentType: "saas_shared"
    },
    projections: [
      {
        projectionId: "core:inbox-recipient-projection",
        scopeId: "tenant",
        projectionSchemaVersion: "v1"
      }
    ]
  };
}

function alternateBootstrapFixture() {
  const fixture = bootstrapFixture();
  fixture.tenant = {
    ...fixture.tenant,
    id: "tenant:db008-alternate",
    slug: "db008-alternate",
    displayName: "DB008 Alternate"
  };
  return fixture;
}

function setManifestEvidenceTime(manifest, timestamp) {
  manifest.approvedAt = timestamp;
  manifest.fastPath.verifiedAt = timestamp;
  manifest.inventory.recordedAt = timestamp;
  manifest.objectStorage.verifiedAt = timestamp;
}

function assertDisposableTestDatabaseName(databaseName) {
  if (!/^hulee_db008_[a-z0-9_]+$/u.test(databaseName)) {
    throw new Error(`Unsafe DB-008 disposable database name: ${databaseName}`);
  }
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}
