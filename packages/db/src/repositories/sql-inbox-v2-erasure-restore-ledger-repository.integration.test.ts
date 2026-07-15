import {
  defineInboxV2ErasureRestoreLedgerEntry,
  inboxV2ErasureRestoreAppendFenceSchema,
  inboxV2ErasureRestoreAuthoritySchema,
  inboxV2ErasureRestoreTargetSchema,
  inboxV2Sha256DigestSchema,
  inboxV2TenantIdSchema,
  type InboxV2ErasureRestoreLedgerEntry
} from "@hulee/contracts";
import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHuleeDatabase,
  createHuleeDatabase,
  type HuleeDatabase
} from "../client";
import {
  buildInsertInboxV2ErasureRestoreLedgerEntrySql,
  buildInsertInboxV2ErasureRestoreLedgerEvidenceSql,
  createSqlInboxV2ErasureRestoreLedgerRepository
} from "./sql-inbox-v2-erasure-restore-ledger-repository";

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const suiteSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
let fixtureSequence = 0;

type ErasureEntry = Extract<
  InboxV2ErasureRestoreLedgerEntry,
  { kind: "erasure_applied" }
>;
type RestoreOpenedEntry = Extract<
  InboxV2ErasureRestoreLedgerEntry,
  { kind: "restore_opened" }
>;
type HoldEntry = Extract<
  InboxV2ErasureRestoreLedgerEntry,
  { kind: "hold_applied" | "hold_released" }
>;

type RestoreFixture = Readonly<{
  tenantId: string;
  registryId: string;
  storageRootId: string;
  dataClassId: string;
  rootRecordId: string;
  entityTypeId: string;
  entityId: string;
  contextId: string;
  policyId: string;
  activationId: string;
  manifestId: string;
  ownerEmployeeId: string;
  approverEmployeeId: string;
  ledgerId: string;
  restoreId: string;
  leaseToken: string;
  epoch: string;
  clock: number;
  authority: ErasureEntry["authority"];
  target: ErasureEntry["target"];
  erased: ErasureEntry;
}>;

describePostgres(
  "SQL Inbox V2 erasure/restore ledger repository (PostgreSQL)",
  () => {
    let db: HuleeDatabase;

    beforeAll(async () => {
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) {
        throw new Error(
          "DATABASE_URL is required for the restore-ledger integration test."
        );
      }
      db = createHuleeDatabase({
        connectionString: databaseUrl,
        poolConfig: { max: 8 }
      });
      const readiness = await db.execute<{
        ledger: string | null;
        restoreHeads: string | null;
        requiredControls: string | null;
        restoreLeases: string | null;
        enabledRestoreTriggers: string;
      }>(sql`
        select
          to_regclass(
            'public.inbox_v2_data_governance_erasure_restore_ledger'
          )::text as ledger,
          to_regclass(
            'public.inbox_v2_data_governance_restore_heads'
          )::text as "restoreHeads",
          to_regclass(
            'public.inbox_v2_data_governance_restore_required_controls'
          )::text as "requiredControls",
          to_regclass(
            'public.inbox_v2_data_governance_restore_leases'
          )::text as "restoreLeases",
          (
            select count(*)::text
              from pg_catalog.pg_trigger trigger_row
              join pg_catalog.pg_class table_row
                on table_row.oid = trigger_row.tgrelid
             where table_row.relname in (
               'inbox_v2_data_governance_erasure_restore_ledger',
               'inbox_v2_data_governance_restore_heads',
               'inbox_v2_data_governance_restore_required_controls',
               'inbox_v2_data_governance_restore_leases'
             )
               and trigger_row.tgname like 'inbox_v2_dg_restore_%'
               and not trigger_row.tgisinternal
               and trigger_row.tgenabled = 'O'
          ) as "enabledRestoreTriggers"
      `);
      expect(readiness.rows[0]).toEqual({
        ledger: "inbox_v2_data_governance_erasure_restore_ledger",
        restoreHeads: "inbox_v2_data_governance_restore_heads",
        requiredControls: "inbox_v2_data_governance_restore_required_controls",
        restoreLeases: "inbox_v2_data_governance_restore_leases",
        enabledRestoreTriggers: "4"
      });
    }, 120_000);

    afterAll(async () => {
      if (db) await closeHuleeDatabase(db);
    });

    it("returns already_applied for an exact persisted erasure retry", async () => {
      const fixture = await seedRestoreFixture(db, "erasure-retry");
      const repository = createSqlInboxV2ErasureRestoreLedgerRepository(db);

      await expect(repository.append(fixture.erased)).resolves.toEqual({
        outcome: "already_applied",
        entry: fixture.erased
      });
      expect(await ledgerSequenceCount(db, fixture, "1")).toBe(1);
    });

    it("derives and persists the exact current required-control set, while rejecting an empty caller set", async () => {
      const fixture = await seedRestoreFixture(db, "exact-controls");
      const appliedHold = await appendNewActiveHold(db, fixture, {
        label: "required",
        sequence: "2",
        previousEntryHash: fixture.erased.entryHash,
        controlStreamPosition: "15",
        completeThrough: "20",
        occurredAt: fixtureTimestamp(fixture, 10_000)
      });
      const repository = createSqlInboxV2ErasureRestoreLedgerRepository(db);
      const emptyOpen = restoreOpenedEntry(fixture, {
        sequence: "3",
        previousEntryHash: appliedHold.entryHash,
        requiredControlEntryHashes: [],
        completeThrough: "30",
        occurredAt: fixtureTimestamp(fixture, 20_000)
      });

      await expect(
        repository.append(emptyOpen, openFence(fixture))
      ).resolves.toEqual({ outcome: "conflict", facet: "control_set" });
      expect(await ledgerSequenceCount(db, fixture, "3")).toBe(0);

      const exactOpen = restoreOpenedEntry(fixture, {
        sequence: "3",
        previousEntryHash: appliedHold.entryHash,
        requiredControlEntryHashes: [appliedHold.entryHash],
        completeThrough: "30",
        occurredAt: fixtureTimestamp(fixture, 20_000)
      });
      await expect(
        repository.append(exactOpen, openFence(fixture))
      ).resolves.toEqual({ outcome: "applied", entry: exactOpen });

      const persisted = await db.execute<{
        source_control_entry_hash: string;
        control_kind: string;
        control_id: string;
        control_revision: string;
        control_head_revision: string;
        row_revision: string;
        reapplied_entry_hash: string | null;
        required_control_count: string;
        head_revision: string;
        lease_revision: string;
      }>(sql`
        select required.source_control_entry_hash,
               required.control_kind,
               required.control_id,
               required.control_revision::text as control_revision,
               required.control_head_revision::text as control_head_revision,
               required.row_revision::text as row_revision,
               required.reapplied_entry_hash,
               head.required_control_count::text as required_control_count,
               head.head_revision::text as head_revision,
               lease.lease_revision::text as lease_revision
          from inbox_v2_data_governance_restore_required_controls required
          join inbox_v2_data_governance_restore_heads head
            on head.tenant_id = required.tenant_id
           and head.ledger_id = required.ledger_id
           and head.restore_id = required.restore_id
          join inbox_v2_data_governance_restore_leases lease
            on lease.tenant_id = required.tenant_id
           and lease.ledger_id = required.ledger_id
           and lease.restore_id = required.restore_id
         where required.tenant_id = ${fixture.tenantId}
           and required.ledger_id = ${fixture.ledgerId}
           and required.restore_id = ${fixture.restoreId}
      `);
      expect(persisted.rows).toEqual([
        {
          source_control_entry_hash: appliedHold.entryHash,
          control_kind: "legal_hold",
          control_id: appliedHold.control.hold.holdId,
          control_revision: "1",
          control_head_revision: "2",
          row_revision: "1",
          reapplied_entry_hash: null,
          required_control_count: "1",
          head_revision: "1",
          lease_revision: "1"
        }
      ]);
    });

    it("rejects missing, malformed and mismatched restore authorization before writing", async () => {
      const fixture = await seedRestoreFixture(db, "invalid-input");
      const repository = createSqlInboxV2ErasureRestoreLedgerRepository(db);
      const opened = restoreOpenedEntry(fixture, {
        sequence: "2",
        previousEntryHash: fixture.erased.entryHash,
        requiredControlEntryHashes: [],
        completeThrough: "20",
        occurredAt: fixtureTimestamp(fixture, 10_000)
      });

      await expect(repository.append(opened)).rejects.toThrow(
        /requires a database lease fence/u
      );
      await expect(
        repository.append(opened, {
          operation: "open_restore",
          restoreId: `${fixture.restoreId}-substituted`,
          leaseToken: fixture.leaseToken,
          leaseDurationSeconds: 60
        })
      ).rejects.toThrow(/does not match the ledger mutation/u);
      await expect(
        repository.append(opened, {
          operation: "open_restore",
          restoreId: fixture.restoreId,
          leaseToken: "short",
          leaseDurationSeconds: 60
        })
      ).rejects.toThrow();
      expect(await ledgerSequenceCount(db, fixture, "2")).toBe(0);
    });

    it.each(["released control", "new control"] as const)(
      "rejects sealing after open when the current set gains a %s transition",
      async (transition) => {
        const fixture = await seedRestoreFixture(
          db,
          transition === "released control"
            ? "release-after-open"
            : "new-after-open"
        );
        const requiredHold = await appendNewActiveHold(db, fixture, {
          label: "required",
          sequence: "2",
          previousEntryHash: fixture.erased.entryHash,
          controlStreamPosition: "15",
          completeThrough: "20",
          occurredAt: fixtureTimestamp(fixture, 10_000)
        });
        const repository = createSqlInboxV2ErasureRestoreLedgerRepository(db);
        const opened = restoreOpenedEntry(fixture, {
          sequence: "3",
          previousEntryHash: requiredHold.entryHash,
          requiredControlEntryHashes: [requiredHold.entryHash],
          completeThrough: "30",
          occurredAt: fixtureTimestamp(fixture, 20_000)
        });
        await expect(
          repository.append(opened, openFence(fixture))
        ).resolves.toEqual({ outcome: "applied", entry: opened });

        const changed =
          transition === "released control"
            ? await appendReleasedHold(db, fixture, {
                holdId: requiredHold.control.hold.holdId,
                sequence: "4",
                previousEntryHash: opened.entryHash,
                controlStreamPosition: "35",
                completeThrough: "40",
                occurredAt: fixtureTimestamp(fixture, 30_000)
              })
            : await appendNewActiveHold(db, fixture, {
                label: "new-after-open",
                sequence: "4",
                previousEntryHash: opened.entryHash,
                controlStreamPosition: "35",
                completeThrough: "40",
                occurredAt: fixtureTimestamp(fixture, 30_000)
              });
        const sealed = restoreSealedEntry(fixture, {
          sequence: "5",
          previousEntryHash: changed.entryHash,
          requiredControlEntryHashes: [requiredHold.entryHash],
          completeThrough: "50",
          occurredAt: fixtureTimestamp(fixture, 40_000)
        });

        await expect(
          repository.append(sealed, sealFence(fixture, "1", "1"))
        ).resolves.toEqual({ outcome: "conflict", facet: "control_set" });
        expect(await ledgerSequenceCount(db, fixture, "5")).toBe(0);
      }
    );

    it("fences stale restore-head, lease revision and lease-token mutations", async () => {
      const fixture = await seedRestoreFixture(db, "stale-fence");
      const repository = createSqlInboxV2ErasureRestoreLedgerRepository(db);
      const opened = restoreOpenedEntry(fixture, {
        sequence: "2",
        previousEntryHash: fixture.erased.entryHash,
        requiredControlEntryHashes: [],
        completeThrough: "20",
        occurredAt: fixtureTimestamp(fixture, 10_000)
      });
      await expect(
        repository.append(opened, openFence(fixture))
      ).resolves.toEqual({ outcome: "applied", entry: opened });
      const sealed = restoreSealedEntry(fixture, {
        sequence: "3",
        previousEntryHash: opened.entryHash,
        requiredControlEntryHashes: [],
        completeThrough: "30",
        occurredAt: fixtureTimestamp(fixture, 20_000)
      });

      await expect(
        repository.append(sealed, sealFence(fixture, "2", "1"))
      ).resolves.toEqual({ outcome: "conflict", facet: "restore_lease" });
      await expect(
        repository.append(sealed, sealFence(fixture, "1", "2"))
      ).resolves.toEqual({ outcome: "conflict", facet: "restore_lease" });
      await expect(
        repository.append(sealed, {
          ...sealFence(fixture, "1", "1"),
          leaseToken: `${fixture.leaseToken}-stale`
        })
      ).resolves.toEqual({ outcome: "conflict", facet: "restore_lease" });
      expect(await ledgerSequenceCount(db, fixture, "3")).toBe(0);
    });

    it("returns already_applied for an exact seal retry and sequence conflict for a competing seal", async () => {
      const fixture = await seedRestoreFixture(db, "duplicate-seal");
      const repository = createSqlInboxV2ErasureRestoreLedgerRepository(db);
      const opened = restoreOpenedEntry(fixture, {
        sequence: "2",
        previousEntryHash: fixture.erased.entryHash,
        requiredControlEntryHashes: [],
        completeThrough: "20",
        occurredAt: fixtureTimestamp(fixture, 10_000)
      });
      await expect(
        repository.append(opened, openFence(fixture))
      ).resolves.toEqual({ outcome: "applied", entry: opened });
      const sealed = restoreSealedEntry(fixture, {
        sequence: "3",
        previousEntryHash: opened.entryHash,
        requiredControlEntryHashes: [],
        completeThrough: "30",
        occurredAt: fixtureTimestamp(fixture, 20_000)
      });
      const fence = sealFence(fixture, "1", "1");

      await expect(repository.append(sealed, fence)).resolves.toEqual({
        outcome: "applied",
        entry: sealed
      });
      await expect(repository.append(sealed, fence)).resolves.toEqual({
        outcome: "already_applied",
        entry: sealed
      });

      const competing = restoreSealedEntry(fixture, {
        sequence: "3",
        previousEntryHash: opened.entryHash,
        requiredControlEntryHashes: [],
        completeThrough: "31",
        occurredAt: fixtureTimestamp(fixture, 21_000)
      });
      await expect(repository.append(competing, fence)).resolves.toEqual({
        outcome: "conflict",
        facet: "sequence"
      });
      expect(await ledgerSequenceCount(db, fixture, "3")).toBe(1);
    });

    it("rejects a direct SQL ledger append that skips a sequence", async () => {
      const fixture = await seedRestoreFixture(db, "direct-gap");
      const holdId = await seedActiveHold(db, fixture, "gap-control");
      await advanceControlSet(
        db,
        fixture,
        "15",
        fixtureTimestamp(fixture, 5_000)
      );
      const broken = holdAppliedEntry(fixture, {
        holdId,
        sequence: "3",
        previousEntryHash: fixture.erased.entryHash,
        completeThrough: "20",
        occurredAt: fixtureTimestamp(fixture, 10_000)
      });

      let databaseError: unknown;
      try {
        await db.transaction(async (transaction) => {
          await transaction.execute(
            buildInsertInboxV2ErasureRestoreLedgerEntrySql({
              entry: broken,
              authorityRoot: authorityRoot(fixture)
            })
          );
          await transaction.execute(
            buildInsertInboxV2ErasureRestoreLedgerEvidenceSql(broken)
          );
          await transaction.execute(sql.raw("set constraints all immediate"));
        });
      } catch (error) {
        databaseError = error;
      }

      expect(readSqlState(databaseError)).toBe("23514");
      expect(readErrorMessage(databaseError)).toMatch(
        /Ledger hash chain must be contiguous and high-water monotonic/u
      );
      expect(await ledgerSequenceCount(db, fixture, "3")).toBe(0);
    });
  }
);

async function seedRestoreFixture(
  db: HuleeDatabase,
  label: string
): Promise<RestoreFixture> {
  fixtureSequence += 1;
  const idSuffix = `${label}-${fixtureSequence}-${suiteSuffix}`;
  const tenantId = inboxV2TenantIdSchema.parse(
    `tenant:db009-restore-${idSuffix}`
  );
  const clock = Date.now() - 180_000;
  const registryId = `registry:db009-restore-${idSuffix}`;
  const storageRootId = `core:db009-restore-root-${idSuffix}`;
  const dataClassId = "core:message-content";
  const rootRecordId = `data_root:db009-restore-${idSuffix}`;
  const entityTypeId = "core:message";
  const entityId = `message:db009-restore-${idSuffix}`;
  const contextId = `core:db009-restore-context-${idSuffix}`;
  const policyId = `core:db009-restore-policy-${idSuffix}`;
  const activationId = `core:db009-restore-activation-${idSuffix}`;
  const manifestId = `scope-manifest:db009-restore-${idSuffix}`;
  const planId = `plan:db009-restore-${idSuffix}`;
  const deletionRunId = `deletion_run:db009-restore-${idSuffix}`;
  const verificationHandlerId = `core:verify-db009-restore-${idSuffix}`;
  const ownerEmployeeId = `employee:db009-restore-owner-${idSuffix}`;
  const approverEmployeeId = `employee:db009-restore-approver-${idSuffix}`;
  const ledgerId = `ledger:db009-restore-${idSuffix}`;
  const restoreId = `restore:db009-restore-${idSuffix}`;
  const leaseToken = `restore-lease-token-${createHash("sha256")
    .update(idSuffix)
    .digest("hex")}`;
  const epoch = `epoch:db009-restore-${idSuffix}`;
  const registryHash = digest(idSuffix, "registry");
  const contextHash = digest(idSuffix, "context");
  const policyHash = digest(idSuffix, "policy");
  const activationHash = digest(idSuffix, "activation");
  const manifestHash = digest(idSuffix, "manifest");
  const planHash = digest(idSuffix, "plan");
  const authority = inboxV2ErasureRestoreAuthoritySchema.parse({
    registryCompositionHash: registryHash,
    governance: {
      tenantId,
      id: contextId,
      version: "1",
      contextHash
    },
    effectivePolicy: {
      tenantId,
      id: policyId,
      version: "1",
      policyHash
    },
    activation: {
      tenantId,
      id: activationId,
      revision: "1",
      activationHash
    }
  });
  const target = inboxV2ErasureRestoreTargetSchema.parse({
    root: {
      tenantId,
      dataClassId,
      storageRootId,
      recordId: rootRecordId
    },
    entity: { tenantId, entityTypeId, entityId },
    entityRevision: "1",
    lineageRevision: "1"
  });
  const erasedCandidate = defineInboxV2ErasureRestoreLedgerEntry({
    tenantId,
    ledgerId,
    sequence: "1",
    previousEntryHash: null,
    kind: "erasure_applied",
    target,
    authority,
    deletionRun: { id: deletionRunId, revision: "1", planHash },
    primaryAbsence: {
      state: "verified_absent",
      verifiedAt: timestamp(clock - 10_000),
      handlerId: verificationHandlerId,
      evidence: { kind: "digest", digest: digest(idSuffix, "primary") }
    },
    backupExpiry: {
      state: "not_applicable",
      evidence: { kind: "digest", digest: digest(idSuffix, "backup") }
    },
    highWater: {
      streamEpoch: epoch,
      syncGeneration: "1",
      completeThrough: "10"
    },
    occurredAt: timestamp(clock)
  });
  if (erasedCandidate.kind !== "erasure_applied") {
    throw new Error("Invalid erasure fixture.");
  }
  const erased = erasedCandidate;
  const fixture: RestoreFixture = {
    tenantId,
    registryId,
    storageRootId,
    dataClassId,
    rootRecordId,
    entityTypeId,
    entityId,
    contextId,
    policyId,
    activationId,
    manifestId,
    ownerEmployeeId,
    approverEmployeeId,
    ledgerId,
    restoreId,
    leaseToken,
    epoch,
    clock,
    authority,
    target,
    erased
  };

  await db.transaction(async (transaction) => {
    const registryCreatedAt = timestamp(clock - 120_000);
    const registryActivatedAt = timestamp(clock - 110_000);
    const contextEffectiveAt = timestamp(clock - 100_000);
    const policyEffectiveAt = timestamp(clock - 90_000);
    const activationApprovedAt = timestamp(clock - 80_000);
    const activationNotBefore = timestamp(clock - 70_000);
    const activationActivatedAt = timestamp(clock - 60_000);
    const manifestFrozenAt = timestamp(clock - 50_000);
    const planCreatedAt = timestamp(clock - 40_000);
    const earliestExecutionAt = timestamp(clock - 35_000);
    const runStartedAt = timestamp(clock - 30_000);
    const stageOneCommittedAt = timestamp(clock - 20_000);
    const runCompletedAt = timestamp(clock - 10_000);

    await transaction.execute(sql`
      insert into tenants (id, slug, display_name, deployment_type)
      values (
        ${tenantId}, ${`db009-restore-${fixtureSequence}-${suiteSuffix}`},
        'DB009 restore-ledger integration tenant', 'saas_shared'
      )
    `);
    await transaction.execute(sql`
      insert into employees (
        id, tenant_id, email, display_name, profile, created_at, updated_at
      ) values
        (
          ${ownerEmployeeId}, ${tenantId},
          ${`db009-restore-owner-${idSuffix}@example.test`},
          'DB009 restore owner', '{}'::jsonb, ${registryCreatedAt},
          ${registryCreatedAt}
        ),
        (
          ${approverEmployeeId}, ${tenantId},
          ${`db009-restore-approver-${idSuffix}@example.test`},
          'DB009 restore approver', '{}'::jsonb, ${registryCreatedAt},
          ${registryCreatedAt}
        )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_data_governance_registry_versions (
        id, revision, schema_version, composition_hash, canonical_snapshot,
        activated_at, created_at
      ) values (
        ${registryId}, 1, 'v1', ${registryHash}, '{}'::jsonb,
        ${registryActivatedAt}, ${registryCreatedAt}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_data_governance_storage_roots (
        registry_id, registry_revision, storage_root_id, kind, boundary,
        version_enumeration, configuration_profile_id, owner_module_id,
        canonical_snapshot
      ) values (
        ${registryId}, 1, ${storageRootId}, 'sql', 'operated_data_plane',
        'not_applicable', ${`profile:${idSuffix}`}, null, '{}'::jsonb
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_data_governance_lifecycle_handlers (
        registry_id, registry_revision, handler_id, kind, owner_module_id,
        handler_version, bounded, idempotent, checks_tenant_fence,
        checks_revision_fence, checks_hold_fence, verifies_absence,
        canonical_snapshot
      ) values (
        ${registryId}, 1, ${verificationHandlerId}, 'verification', null,
        1, true, true, true, true, true, true, '{}'::jsonb
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_data_governance_contexts (
        tenant_id, context_id, version, context_hash, policy_revision,
        registry_id, registry_revision, deployment_profile, time_zone,
        tzdb_version, approved_at, effective_at, review_at,
        canonical_snapshot
      ) values (
        ${tenantId}, ${contextId}, 1, ${contextHash}, 1,
        ${registryId}, 1, 'saas_shared', 'UTC', '2026a',
        ${registryCreatedAt}, ${contextEffectiveAt},
        ${timestamp(clock + 86_400_000)}, '{}'::jsonb
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_data_governance_effective_policies (
        tenant_id, policy_id, version, policy_hash, registry_id,
        registry_revision, governance_context_id, governance_context_version,
        deployment_profile, effective_at, canonical_snapshot, created_at
      ) values (
        ${tenantId}, ${policyId}, 1, ${policyHash}, ${registryId}, 1,
        ${contextId}, 1, 'saas_shared', ${policyEffectiveAt}, '{}'::jsonb,
        ${contextEffectiveAt}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_data_governance_policy_activations (
        tenant_id, activation_id, revision, activation_hash, policy_id,
        policy_version, candidate_policy_hash, governance_context_id,
        governance_context_version, governance_context_hash, transition_kind,
        prior_activation_id, prior_activation_revision, prior_policy_version,
        requester_principal_kind, requester_principal_key,
        requester_decision_id, requester_decision_hash,
        approver_principal_kind, approver_principal_key,
        approver_decision_id, approver_decision_hash, reason_code,
        impact_preview_hash, impact_stream_epoch, impact_sync_generation,
        impact_complete_through_position, affected_root_count,
        affected_byte_count, held_root_count, backup_copy_count,
        earliest_destructive_at, requested_at, approved_at, not_before,
        activated_at, canonical_snapshot
      ) values (
        ${tenantId}, ${activationId}, 1, ${activationHash}, ${policyId}, 1,
        ${policyHash}, ${contextId}, 1, ${contextHash},
        'initial_reviewed_bootstrap', null, null, null,
        'service', 'service:db009-restore-requester',
        ${`decision:requester-${idSuffix}`}, ${digest(idSuffix, "requester")},
        'service', 'service:db009-restore-approver',
        ${`decision:approver-${idSuffix}`}, ${digest(idSuffix, "approver")},
        'db009_restore_fixture', ${digest(idSuffix, "impact")}, ${epoch}, 1,
        10, 1, 0, 0, 0, ${earliestExecutionAt}, ${registryCreatedAt},
        ${activationApprovedAt}, ${activationNotBefore},
        ${activationActivatedAt}, '{}'::jsonb
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_data_governance_policy_activation_heads (
        tenant_id, policy_id, current_policy_version,
        current_activation_id, current_activation_revision,
        head_revision, updated_at
      ) values (
        ${tenantId}, ${policyId}, 1, ${activationId}, 1, 1,
        ${activationActivatedAt}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_data_governance_control_set_heads (
        tenant_id, legal_hold_set_revision, restriction_set_revision,
        last_changed_stream_position, head_revision, updated_at
      ) values (${tenantId}, 0, 0, 0, 1, ${activationActivatedAt})
    `);
    await transaction.execute(sql`
      insert into inbox_v2_data_governance_scope_manifests (
        tenant_id, manifest_id, revision, registry_id, registry_revision,
        kind, manifest_hash, stream_epoch, sync_generation,
        complete_through_position, frozen_at, canonical_snapshot
      ) values (
        ${tenantId}, ${manifestId}, 1, ${registryId}, 1, 'exact',
        ${manifestHash}, ${epoch}, 1, 10, ${manifestFrozenAt}, '{}'::jsonb
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_data_governance_scope_manifest_roots (
        tenant_id, manifest_id, manifest_revision, registry_id,
        registry_revision, data_class_id, storage_root_id, root_record_id,
        root_kind, boundary, copy_role, entity_type_id, entity_id,
        expected_entity_revision, expected_lineage_revision
      ) values (
        ${tenantId}, ${manifestId}, 1, ${registryId}, 1, ${dataClassId},
        ${storageRootId}, ${rootRecordId}, 'sql', 'operated_data_plane',
        'primary', ${entityTypeId}, ${entityId}, 1, 1
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_data_governance_deletion_plans (
        tenant_id, plan_id, revision, plan_hash, cause,
        decision_basis_kind, decision_basis_id, decision_basis_hash,
        request_id, request_revision, manifest_id, manifest_revision,
        registry_id, registry_revision, registry_composition_hash,
        governance_context_id, governance_context_version,
        governance_context_hash, policy_id, policy_version, policy_hash,
        activation_id, activation_revision, activation_hash,
        legal_hold_set_revision, restriction_set_revision, stream_epoch,
        sync_generation, complete_through_position, earliest_execution_at,
        canonical_snapshot, created_at
      ) values (
        ${tenantId}, ${planId}, 1, ${planHash}, 'retention_expiry',
        'lifecycle_policy', ${`lifecycle-decision:${idSuffix}`},
        ${digest(idSuffix, "decision")}, null, null, ${manifestId}, 1,
        ${registryId}, 1, ${registryHash}, ${contextId}, 1, ${contextHash},
        ${policyId}, 1, ${policyHash}, ${activationId}, 1, ${activationHash},
        0, 0, ${epoch}, 1, 10, ${earliestExecutionAt}, '{}'::jsonb,
        ${planCreatedAt}
      )
    `);

    await transaction.execute(
      sql.raw(`
      alter table inbox_v2_data_governance_deletion_runs
        disable trigger inbox_v2_dg_deletion_run_transition_guard_trigger
    `)
    );
    await transaction.execute(
      sql.raw(`
      alter table inbox_v2_data_governance_deletion_runs
        disable trigger inbox_v2_dg_deletion_terminal_coherence_constraint
    `)
    );
    await transaction.execute(sql`
      insert into inbox_v2_data_governance_deletion_runs (
        tenant_id, run_id, revision, state_revision, plan_id, plan_revision,
        state, result, stage_one_state, stage_one_committed_at,
        primary_absence_verified, has_internal_residual,
        has_external_residual, has_backup_expiry_pending,
        backup_latest_possible_expiry_at, operated_checkpoint_count,
        backup_checkpoint_count, external_checkpoint_count,
        completed_checkpoint_count, started_at, completed_at, updated_at,
        state_hash
      ) values (
        ${tenantId}, ${deletionRunId}, 1, 4, ${planId}, 1,
        'terminal', 'completed', 'content_unavailable',
        ${stageOneCommittedAt}, true, false, false, false, null,
        1, 0, 0, 1, ${runStartedAt}, ${runCompletedAt}, ${runCompletedAt},
        ${digest(idSuffix, "terminal-run")}
      )
    `);
    await transaction.execute(sql.raw("set constraints all immediate"));
    await transaction.execute(
      sql.raw(`
      alter table inbox_v2_data_governance_deletion_runs
        enable trigger inbox_v2_dg_deletion_terminal_coherence_constraint
    `)
    );
    await transaction.execute(
      sql.raw(`
      alter table inbox_v2_data_governance_deletion_runs
        enable trigger inbox_v2_dg_deletion_run_transition_guard_trigger
    `)
    );

    // The source erasure is a narrow fixture prerequisite. Its full deletion
    // workflow is covered by the deletion-run integration suite; all restore
    // mutations below run with every production constraint enabled.
    await transaction.execute(
      sql.raw(`
      alter table inbox_v2_data_governance_erasure_restore_ledger
        disable trigger inbox_v2_dg_erasure_ledger_coherence_constraint
    `)
    );
    await transaction.execute(
      sql.raw(`
      alter table inbox_v2_data_governance_erasure_restore_ledger_evidence
        disable trigger inbox_v2_dg_erasure_ledger_evidence_coherence_constraint
    `)
    );
    await transaction.execute(
      buildInsertInboxV2ErasureRestoreLedgerEntrySql({
        entry: erased,
        authorityRoot: authorityRoot(fixture)
      })
    );
    await transaction.execute(
      buildInsertInboxV2ErasureRestoreLedgerEvidenceSql(erased)
    );
    await transaction.execute(sql.raw("set constraints all immediate"));
    await transaction.execute(
      sql.raw(`
      alter table inbox_v2_data_governance_erasure_restore_ledger_evidence
        enable trigger inbox_v2_dg_erasure_ledger_evidence_coherence_constraint
    `)
    );
    await transaction.execute(
      sql.raw(`
      alter table inbox_v2_data_governance_erasure_restore_ledger
        enable trigger inbox_v2_dg_erasure_ledger_coherence_constraint
    `)
    );
  });

  return fixture;
}

async function appendNewActiveHold(
  db: HuleeDatabase,
  fixture: RestoreFixture,
  input: Readonly<{
    label: string;
    sequence: string;
    previousEntryHash: string;
    controlStreamPosition: string;
    completeThrough: string;
    occurredAt: string;
  }>
): Promise<Extract<HoldEntry, { kind: "hold_applied" }>> {
  const holdId = await seedActiveHold(db, fixture, input.label);
  await advanceControlSet(
    db,
    fixture,
    input.controlStreamPosition,
    input.occurredAt
  );
  const entry = holdAppliedEntry(fixture, {
    holdId,
    sequence: input.sequence,
    previousEntryHash: input.previousEntryHash,
    completeThrough: input.completeThrough,
    occurredAt: input.occurredAt
  });
  const outcome =
    await createSqlInboxV2ErasureRestoreLedgerRepository(db).append(entry);
  if (outcome.outcome !== "applied") {
    throw new Error(
      `Could not append active hold fixture: ${JSON.stringify(outcome)}`
    );
  }
  return entry;
}

async function appendReleasedHold(
  db: HuleeDatabase,
  fixture: RestoreFixture,
  input: Readonly<{
    holdId: string;
    sequence: string;
    previousEntryHash: string;
    controlStreamPosition: string;
    completeThrough: string;
    occurredAt: string;
  }>
): Promise<Extract<HoldEntry, { kind: "hold_released" }>> {
  await seedReleasedHold(db, fixture, input.holdId, input.occurredAt);
  await advanceControlSet(
    db,
    fixture,
    input.controlStreamPosition,
    input.occurredAt
  );
  const candidate = defineInboxV2ErasureRestoreLedgerEntry({
    tenantId: fixture.tenantId,
    ledgerId: fixture.ledgerId,
    sequence: input.sequence,
    previousEntryHash: input.previousEntryHash,
    kind: "hold_released",
    target: fixture.target,
    authority: fixture.authority,
    control: {
      kind: "legal_hold",
      hold: { tenantId: fixture.tenantId, holdId: input.holdId, revision: "2" }
    },
    release: {
      state: "released",
      releasedAt: input.occurredAt,
      evidence: {
        kind: "digest",
        digest: digest(input.holdId, "released-evidence")
      }
    },
    highWater: {
      streamEpoch: fixture.epoch,
      syncGeneration: "1",
      completeThrough: input.completeThrough
    },
    occurredAt: input.occurredAt
  });
  if (candidate.kind !== "hold_released") {
    throw new Error("Invalid released-hold fixture.");
  }
  const outcome =
    await createSqlInboxV2ErasureRestoreLedgerRepository(db).append(candidate);
  if (outcome.outcome !== "applied") {
    throw new Error(
      `Could not append released hold fixture: ${JSON.stringify(outcome)}`
    );
  }
  return candidate;
}

async function seedActiveHold(
  db: HuleeDatabase,
  fixture: RestoreFixture,
  label: string
): Promise<string> {
  const holdId = `legal-hold:${label}-${fixture.ledgerId}`;
  const effectiveAt = fixtureTimestamp(fixture, 1_000);
  await db.transaction(async (transaction) => {
    await transaction.execute(sql`
      insert into inbox_v2_data_governance_legal_hold_revisions (
        tenant_id, hold_id, revision, state, scope_kind,
        scope_manifest_id, scope_manifest_revision, registry_id,
        registry_revision, case_id, matcher_handler_id, matcher_version,
        predicate_hash, owner_employee_id, approver_employee_id,
        reason_code, legal_reference_code, anchor_from, anchor_through,
        end_condition_id, end_condition_hash, effective_at, review_at,
        released_at, canonical_snapshot
      ) values (
        ${fixture.tenantId}, ${holdId}, 1, 'active', 'exact',
        ${fixture.manifestId}, 1, ${fixture.registryId}, 1,
        ${`case:${label}-${fixture.ledgerId}`}, null, null, null,
        ${fixture.ownerEmployeeId}, ${fixture.approverEmployeeId},
        'litigation_hold', ${`legal:${label}`},
        ${fixtureTimestamp(fixture, -1_000)}, null,
        ${`end-condition:${label}`}, ${digest(holdId, "end-condition")},
        ${effectiveAt}, ${fixtureTimestamp(fixture, 86_400_000)}, null,
        '{}'::jsonb
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_data_governance_legal_hold_data_classes (
        tenant_id, hold_id, hold_revision, data_class_id
      ) values (${fixture.tenantId}, ${holdId}, 1, ${fixture.dataClassId})
    `);
    await transaction.execute(sql`
      insert into inbox_v2_data_governance_legal_hold_targets (
        tenant_id, hold_id, hold_revision, state, scope_manifest_id,
        scope_manifest_revision, storage_root_id, root_record_id,
        entity_type_id, entity_id, expected_entity_revision,
        expected_lineage_revision
      ) values (
        ${fixture.tenantId}, ${holdId}, 1, 'active', ${fixture.manifestId}, 1,
        ${fixture.storageRootId}, ${fixture.rootRecordId},
        ${fixture.entityTypeId}, ${fixture.entityId}, 1, 1
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_data_governance_legal_hold_heads (
        tenant_id, hold_id, current_revision, state, head_revision, updated_at
      ) values (${fixture.tenantId}, ${holdId}, 1, 'active', 1, ${effectiveAt})
    `);
    await transaction.execute(sql.raw("set constraints all immediate"));
  });
  return holdId;
}

async function seedReleasedHold(
  db: HuleeDatabase,
  fixture: RestoreFixture,
  holdId: string,
  releasedAt: string
): Promise<void> {
  await db.transaction(async (transaction) => {
    await transaction.execute(sql`
      insert into inbox_v2_data_governance_legal_hold_revisions (
        tenant_id, hold_id, revision, state, scope_kind,
        scope_manifest_id, scope_manifest_revision, registry_id,
        registry_revision, case_id, matcher_handler_id, matcher_version,
        predicate_hash, owner_employee_id, approver_employee_id,
        reason_code, legal_reference_code, anchor_from, anchor_through,
        end_condition_id, end_condition_hash, effective_at, review_at,
        released_at, canonical_snapshot
      ) values (
        ${fixture.tenantId}, ${holdId}, 2, 'released', 'exact',
        ${fixture.manifestId}, 1, ${fixture.registryId}, 1,
        ${`case:released-${fixture.ledgerId}`}, null, null, null,
        ${fixture.ownerEmployeeId}, ${fixture.approverEmployeeId},
        'litigation_hold_released', 'legal:released',
        ${fixtureTimestamp(fixture, -1_000)}, ${releasedAt},
        'end-condition:released', ${digest(holdId, "released-end-condition")},
        ${fixtureTimestamp(fixture, 1_000)},
        ${fixtureTimestamp(fixture, 86_400_000)}, ${releasedAt}, '{}'::jsonb
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_data_governance_legal_hold_data_classes (
        tenant_id, hold_id, hold_revision, data_class_id
      ) values (${fixture.tenantId}, ${holdId}, 2, ${fixture.dataClassId})
    `);
    await transaction.execute(sql`
      insert into inbox_v2_data_governance_legal_hold_targets (
        tenant_id, hold_id, hold_revision, state, scope_manifest_id,
        scope_manifest_revision, storage_root_id, root_record_id,
        entity_type_id, entity_id, expected_entity_revision,
        expected_lineage_revision
      ) values (
        ${fixture.tenantId}, ${holdId}, 2, 'released', ${fixture.manifestId}, 1,
        ${fixture.storageRootId}, ${fixture.rootRecordId},
        ${fixture.entityTypeId}, ${fixture.entityId}, 1, 1
      )
    `);
    await transaction.execute(sql`
      update inbox_v2_data_governance_legal_hold_heads
         set current_revision = 2,
             state = 'released',
             head_revision = head_revision + 1,
             updated_at = ${releasedAt}
       where tenant_id = ${fixture.tenantId}
         and hold_id = ${holdId}
         and current_revision = 1
         and state = 'active'
         and head_revision = 1
    `);
    await transaction.execute(sql.raw("set constraints all immediate"));
  });
}

async function advanceControlSet(
  db: HuleeDatabase,
  fixture: RestoreFixture,
  streamPosition: string,
  updatedAt: string
): Promise<void> {
  const result = await db.execute<{ tenant_id: string }>(sql`
    update inbox_v2_data_governance_control_set_heads
       set legal_hold_set_revision = legal_hold_set_revision + 1,
           last_changed_stream_position = ${streamPosition},
           head_revision = head_revision + 1,
           updated_at = ${updatedAt}
     where tenant_id = ${fixture.tenantId}
       and last_changed_stream_position < ${streamPosition}
    returning tenant_id
  `);
  if (result.rows.length !== 1) {
    throw new Error("Could not advance the control-set fixture head.");
  }
}

function holdAppliedEntry(
  fixture: RestoreFixture,
  input: Readonly<{
    holdId: string;
    sequence: string;
    previousEntryHash: string;
    completeThrough: string;
    occurredAt: string;
  }>
): Extract<HoldEntry, { kind: "hold_applied" }> {
  const candidate = defineInboxV2ErasureRestoreLedgerEntry({
    tenantId: fixture.tenantId,
    ledgerId: fixture.ledgerId,
    sequence: input.sequence,
    previousEntryHash: input.previousEntryHash,
    kind: "hold_applied",
    target: fixture.target,
    authority: fixture.authority,
    control: {
      kind: "legal_hold",
      hold: { tenantId: fixture.tenantId, holdId: input.holdId, revision: "1" }
    },
    application: {
      state: "applied",
      appliedAt: input.occurredAt,
      evidence: {
        kind: "digest",
        digest: digest(input.holdId, "applied-evidence")
      }
    },
    highWater: {
      streamEpoch: fixture.epoch,
      syncGeneration: "1",
      completeThrough: input.completeThrough
    },
    occurredAt: input.occurredAt
  });
  if (candidate.kind !== "hold_applied") {
    throw new Error("Invalid applied-hold fixture.");
  }
  return candidate;
}

function restoreOpenedEntry(
  fixture: RestoreFixture,
  input: Readonly<{
    sequence: string;
    previousEntryHash: string;
    requiredControlEntryHashes: string[];
    completeThrough: string;
    occurredAt: string;
  }>
): RestoreOpenedEntry {
  const candidate = defineInboxV2ErasureRestoreLedgerEntry({
    tenantId: fixture.tenantId,
    ledgerId: fixture.ledgerId,
    sequence: input.sequence,
    previousEntryHash: input.previousEntryHash,
    kind: "restore_opened",
    target: fixture.target,
    authority: fixture.authority,
    restoreId: fixture.restoreId,
    sourceErasureEntryHash: fixture.erased.entryHash,
    reapplication: {
      state: "pending",
      requiredControlEntryHashes: [...input.requiredControlEntryHashes].sort()
    },
    evidence: {
      kind: "digest",
      digest: digest(fixture.restoreId, `open-${input.completeThrough}`)
    },
    highWater: {
      streamEpoch: fixture.epoch,
      syncGeneration: "1",
      completeThrough: input.completeThrough
    },
    occurredAt: input.occurredAt
  });
  if (candidate.kind !== "restore_opened") {
    throw new Error("Invalid restore-open fixture.");
  }
  return candidate;
}

function restoreSealedEntry(
  fixture: RestoreFixture,
  input: Readonly<{
    sequence: string;
    previousEntryHash: string;
    requiredControlEntryHashes: string[];
    completeThrough: string;
    occurredAt: string;
  }>
) {
  const controlHashes = [...input.requiredControlEntryHashes].sort();
  const candidate = defineInboxV2ErasureRestoreLedgerEntry({
    tenantId: fixture.tenantId,
    ledgerId: fixture.ledgerId,
    sequence: input.sequence,
    previousEntryHash: input.previousEntryHash,
    kind: "restore_sealed",
    target: fixture.target,
    authority: fixture.authority,
    restoreId: fixture.restoreId,
    sourceErasureEntryHash: fixture.erased.entryHash,
    reapplication: {
      state: "sealed",
      sealedAt: input.occurredAt,
      requiredControlEntryHashes: controlHashes,
      reappliedControlEntryHashes: controlHashes,
      evidence: {
        kind: "digest",
        digest: digest(fixture.restoreId, `seal-${input.completeThrough}`)
      }
    },
    highWater: {
      streamEpoch: fixture.epoch,
      syncGeneration: "1",
      completeThrough: input.completeThrough
    },
    occurredAt: input.occurredAt
  });
  if (candidate.kind !== "restore_sealed") {
    throw new Error("Invalid restore-seal fixture.");
  }
  return candidate;
}

function openFence(fixture: RestoreFixture) {
  return inboxV2ErasureRestoreAppendFenceSchema.parse({
    operation: "open_restore",
    restoreId: fixture.restoreId,
    leaseToken: fixture.leaseToken,
    leaseDurationSeconds: 120
  });
}

function sealFence(
  fixture: RestoreFixture,
  expectedHeadRevision: string,
  expectedLeaseRevision: string
) {
  return inboxV2ErasureRestoreAppendFenceSchema.parse({
    operation: "seal_restore",
    restoreId: fixture.restoreId,
    leaseToken: fixture.leaseToken,
    expectedHeadRevision,
    expectedLeaseRevision
  });
}

function authorityRoot(fixture: RestoreFixture) {
  return {
    registry_id: fixture.registryId,
    registry_revision: "1",
    root_kind: "sql",
    boundary: "operated_data_plane",
    checked_at: timestamp(Date.now())
  };
}

async function ledgerSequenceCount(
  db: HuleeDatabase,
  fixture: RestoreFixture,
  sequence: string
): Promise<number> {
  const result = await db.execute<{ count: string }>(sql`
    select count(*)::text as count
      from inbox_v2_data_governance_erasure_restore_ledger
     where tenant_id = ${fixture.tenantId}
       and ledger_id = ${fixture.ledgerId}
       and sequence = ${sequence}
  `);
  return Number(result.rows[0]?.count ?? "0");
}

function fixtureTimestamp(fixture: RestoreFixture, offset: number): string {
  return timestamp(fixture.clock + offset);
}

function timestamp(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}

function digest(scope: string, value: string) {
  return inboxV2Sha256DigestSchema.parse(
    `sha256:${createHash("sha256")
      .update(`db009-restore:${suiteSuffix}:${scope}:${value}`)
      .digest("hex")}`
  );
}

function readSqlState(error: unknown): string {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current !== null; depth += 1) {
    if (typeof current !== "object") return "";
    if ("code" in current && typeof current.code === "string") {
      return current.code;
    }
    current = "cause" in current ? current.cause : null;
  }
  return "";
}

function readErrorMessage(error: unknown): string {
  let current: unknown = error;
  const messages: string[] = [];
  for (let depth = 0; depth < 8 && current !== null; depth += 1) {
    if (typeof current !== "object") break;
    if ("message" in current && typeof current.message === "string") {
      messages.push(current.message);
    }
    current = "cause" in current ? current.cause : null;
  }
  return messages.join("\n");
}
