import {
  calculateInboxV2ErasureRestoreLeaseTokenHash,
  defineInboxV2ErasureRestoreLedgerEntry,
  inboxV2ErasureRestoreAppendFenceSchema,
  type InboxV2ErasureRestoreLedgerEntry
} from "@hulee/contracts";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  buildAdvanceInboxV2RestoreHeadSql,
  buildAdvanceInboxV2RestoreLeaseSql,
  buildFindInboxV2CurrentRestoreControlsSql,
  createSqlInboxV2ErasureRestoreLedgerRepository,
  type InboxV2ErasureRestoreLedgerTransactionExecutor
} from "./sql-inbox-v2-erasure-restore-ledger-repository";

const tenantId = "tenant:restore-ledger";
const checkedAt = "2026-07-15T10:00:05.000Z";
const leaseToken = "restore-lease-token-000000000000000000000001";
const digest = (character: string) => `sha256:${character.repeat(64)}`;

const erased = (() => {
  const entry = defineInboxV2ErasureRestoreLedgerEntry({
    tenantId,
    ledgerId: "ledger:restore-ledger",
    sequence: "1",
    previousEntryHash: null,
    kind: "erasure_applied",
    target: {
      root: {
        tenantId,
        dataClassId: "core:message_content",
        storageRootId: "core:message-content-sql",
        recordId: "data_root:message-1"
      },
      entity: {
        tenantId,
        entityTypeId: "core:message",
        entityId: "internal-ref:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      },
      entityRevision: "3",
      lineageRevision: "2"
    },
    authority: {
      registryCompositionHash: digest("a"),
      governance: {
        tenantId,
        id: "core:governance.default",
        version: "1",
        contextHash: digest("b")
      },
      effectivePolicy: {
        tenantId,
        id: "core:lifecycle.default",
        version: "1",
        policyHash: digest("c")
      },
      activation: {
        tenantId,
        id: "core:lifecycle-activation.default",
        revision: "1",
        activationHash: digest("d")
      }
    },
    deletionRun: {
      id: "deletion_run:restore-ledger",
      revision: "1",
      planHash: digest("e")
    },
    primaryAbsence: {
      state: "verified_absent",
      verifiedAt: "2026-07-15T09:59:00.000Z",
      handlerId: "core:message-delete-verification",
      evidence: { kind: "digest", digest: digest("f") }
    },
    backupExpiry: {
      state: "not_applicable",
      evidence: { kind: "digest", digest: digest("0") }
    },
    highWater: {
      streamEpoch: "epoch:restore-ledger",
      syncGeneration: "1",
      completeThrough: "10"
    },
    occurredAt: "2026-07-15T09:59:00.000Z"
  });
  if (entry.kind !== "erasure_applied") {
    throw new Error("Invalid erasure ledger fixture.");
  }
  return entry;
})();

const opened = restoreOpenedEntry([]);
const sealed = restoreSealedEntry();

describe("Inbox V2 SQL erasure/restore database authority", () => {
  it("returns already_applied for an exact erasure retry reconstructed through its tenant-local plan", async () => {
    const executor = queuedExecutor([
      [],
      [persistedErasureRow()],
      persistedErasureEvidenceRows(),
      []
    ]);

    await expect(
      createSqlInboxV2ErasureRestoreLedgerRepository(executor).append(erased)
    ).resolves.toEqual({ outcome: "already_applied", entry: erased });

    expect(executor.queries[1]).toContain(
      "deletion_plan.plan_hash as deletion_plan_hash"
    );
    expect(executor.queries[1]).toContain(
      "deletion_run.tenant_id = ledger.tenant_id"
    );
    expect(executor.queries[1]).toContain(
      "deletion_plan.tenant_id = deletion_run.tenant_id"
    );
    expect(executor.queries[1]).toContain("for update of ledger");
  });

  it("derives an empty set only from current heads, so a released control from an older backup is not resurrected", async () => {
    const executor = queuedExecutor([
      [],
      [],
      [ledgerRow(erased)],
      [authorityRootRow()],
      [controlSetRow()],
      [prospectiveRow()],
      [],
      [ledgerRow(erased)],
      [],
      [],
      [],
      [{ restore_id: "restore:one" }],
      [{ restore_id: "restore:one" }],
      []
    ]);

    await expect(
      createSqlInboxV2ErasureRestoreLedgerRepository(executor).append(
        opened,
        inboxV2ErasureRestoreAppendFenceSchema.parse({
          operation: "open_restore",
          restoreId: "restore:one",
          leaseToken,
          leaseDurationSeconds: 60
        })
      )
    ).resolves.toEqual({ outcome: "applied", entry: opened });

    const derivedSetSql = executor.queries.find((query) =>
      query.includes("current_control.entry_hash")
    );
    expect(derivedSetSql).toContain("head.state = 'active'");
    expect(derivedSetSql).toContain(
      "revision.revision = head.current_revision"
    );
    expect(derivedSetSql).toContain("revision.state = 'active'");
    expect(derivedSetSql).toContain(
      "ledger.kind in ('hold_applied', 'hold_released')"
    );
    expect(derivedSetSql).toContain("applied.kind = 'hold_applied'");
    expect(derivedSetSql).toContain("order by ledger.sequence desc");
    expect(
      executor.queries.some((query) => query.includes("restore_heads"))
    ).toBe(true);
    expect(
      executor.queries.some((query) => query.includes("restore_leases"))
    ).toBe(true);
  });

  it("rejects caller-declared empty required controls when the database derives an active exact hold", async () => {
    const executor = queuedExecutor([
      [],
      [],
      [ledgerRow(erased)],
      [authorityRootRow()],
      [controlSetRow()],
      [prospectiveRow()],
      [
        {
          entry_hash: digest("1"),
          control_kind: "legal_hold",
          control_id: "legal-hold:case-1",
          control_revision: "4",
          control_head_revision: "6"
        }
      ],
      [ledgerRow(erased)],
      []
    ]);

    await expect(
      createSqlInboxV2ErasureRestoreLedgerRepository(executor).append(
        opened,
        inboxV2ErasureRestoreAppendFenceSchema.parse({
          operation: "open_restore",
          restoreId: "restore:one",
          leaseToken,
          leaseDurationSeconds: 60
        })
      )
    ).resolves.toEqual({ outcome: "conflict", facet: "control_set" });
    expect(executor.queries.some((query) => query.startsWith("insert"))).toBe(
      false
    );
  });

  it("rejects a stale restore head/lease fence before reading required rows or sealing", async () => {
    const executor = queuedExecutor([
      [],
      [],
      [ledgerRow(erased)],
      [authorityRootRow()],
      [controlSetRow()],
      [prospectiveRow()],
      [],
      [restoreAuthorityRow({ head_revision: "2" })]
    ]);

    await expect(
      createSqlInboxV2ErasureRestoreLedgerRepository(executor).append(
        sealed,
        inboxV2ErasureRestoreAppendFenceSchema.parse({
          operation: "seal_restore",
          restoreId: "restore:one",
          leaseToken,
          expectedHeadRevision: "1",
          expectedLeaseRevision: "1"
        })
      )
    ).resolves.toEqual({ outcome: "conflict", facet: "restore_lease" });
    expect(executor.queries).toHaveLength(8);
    expect(executor.queries.some((query) => query.startsWith("update"))).toBe(
      false
    );
  });

  it("binds reapplication CAS to both head and lease revisions without a free-standing renewal", () => {
    const reapplication = controlReappliedEntry();
    const parsedFence = inboxV2ErasureRestoreAppendFenceSchema.parse({
      operation: "reapply_control",
      restoreId: "restore:one",
      leaseToken,
      expectedHeadRevision: "3",
      expectedLeaseRevision: "3"
    });
    if (parsedFence.operation !== "reapply_control") {
      throw new Error("Invalid reapplication fence fixture.");
    }
    const mutation = {
      kind: "reapply_control",
      fence: parsedFence,
      checkedAt
    } as const;
    const headSql = render(
      buildAdvanceInboxV2RestoreHeadSql(reapplication, mutation)
    );
    const leaseSql = render(
      buildAdvanceInboxV2RestoreLeaseSql(reapplication, mutation)
    );
    expect(headSql).toContain("head_revision = head_revision + 1");
    expect(headSql).toContain("state = 'open'");
    expect(headSql).toContain("head_revision = $5");
    expect(leaseSql).toContain("lease_revision = lease_revision + 1");
    expect(leaseSql).toContain(
      "restore_head_revision = restore_head_revision + 1"
    );
    expect(leaseSql).toContain("lease_token_hash = $7");
    expect(
      render(buildFindInboxV2CurrentRestoreControlsSql(reapplication))
    ).toContain("head.state = 'active'");
    expect(calculateInboxV2ErasureRestoreLeaseTokenHash(leaseToken)).toMatch(
      /^sha256:[0-9a-f]{64}$/u
    );
  });
});

function restoreOpenedEntry(requiredControlEntryHashes: string[]) {
  const entry = defineInboxV2ErasureRestoreLedgerEntry({
    tenantId,
    ledgerId: erased.ledgerId,
    sequence: "2",
    previousEntryHash: erased.entryHash,
    kind: "restore_opened",
    target: erased.target,
    authority: erased.authority,
    restoreId: "restore:one",
    sourceErasureEntryHash: erased.entryHash,
    reapplication: { state: "pending", requiredControlEntryHashes },
    evidence: { kind: "digest", digest: digest("2") },
    highWater: {
      streamEpoch: "epoch:restore-ledger",
      syncGeneration: "1",
      completeThrough: "20"
    },
    occurredAt: "2026-07-15T10:00:00.000Z"
  });
  if (entry.kind !== "restore_opened") throw new Error("Invalid fixture.");
  return entry;
}

function restoreSealedEntry() {
  const entry = defineInboxV2ErasureRestoreLedgerEntry({
    tenantId,
    ledgerId: erased.ledgerId,
    sequence: "2",
    previousEntryHash: erased.entryHash,
    kind: "restore_sealed",
    target: erased.target,
    authority: erased.authority,
    restoreId: "restore:one",
    sourceErasureEntryHash: erased.entryHash,
    reapplication: {
      state: "sealed",
      sealedAt: "2026-07-15T10:00:00.000Z",
      requiredControlEntryHashes: [],
      reappliedControlEntryHashes: [],
      evidence: { kind: "digest", digest: digest("3") }
    },
    highWater: {
      streamEpoch: "epoch:restore-ledger",
      syncGeneration: "1",
      completeThrough: "20"
    },
    occurredAt: "2026-07-15T10:00:00.000Z"
  });
  if (entry.kind !== "restore_sealed") throw new Error("Invalid fixture.");
  return entry;
}

function controlReappliedEntry() {
  const entry = defineInboxV2ErasureRestoreLedgerEntry({
    tenantId,
    ledgerId: erased.ledgerId,
    sequence: "2",
    previousEntryHash: erased.entryHash,
    kind: "control_reapplied",
    target: erased.target,
    authority: erased.authority,
    restoreId: "restore:one",
    sourceControlEntryHash: digest("1"),
    control: {
      kind: "legal_hold",
      hold: { tenantId, holdId: "legal-hold:case-1", revision: "4" }
    },
    reapplication: {
      state: "reapplied",
      reappliedAt: "2026-07-15T10:00:00.000Z",
      evidence: { kind: "digest", digest: digest("4") }
    },
    highWater: {
      streamEpoch: "epoch:restore-ledger",
      syncGeneration: "1",
      completeThrough: "20"
    },
    occurredAt: "2026-07-15T10:00:00.000Z"
  });
  if (entry.kind !== "control_reapplied") throw new Error("Invalid fixture.");
  return entry;
}

function ledgerRow(entry: InboxV2ErasureRestoreLedgerEntry) {
  return {
    tenant_id: entry.tenantId,
    ledger_id: entry.ledgerId,
    ledger_entry_id: entry.entryHash,
    sequence: entry.sequence,
    kind: entry.kind,
    entry_hash: entry.entryHash,
    stream_epoch: entry.highWater.streamEpoch,
    sync_generation: entry.highWater.syncGeneration,
    complete_through_position: entry.highWater.completeThrough,
    occurred_at: entry.occurredAt
  };
}

function persistedErasureRow() {
  return {
    ...ledgerRow(erased),
    previous_entry_hash: erased.previousEntryHash,
    registry_composition_hash: erased.authority.registryCompositionHash,
    governance_context_id: erased.authority.governance.id,
    governance_context_version: erased.authority.governance.version,
    governance_context_hash: erased.authority.governance.contextHash,
    policy_id: erased.authority.effectivePolicy.id,
    policy_version: erased.authority.effectivePolicy.version,
    policy_hash: erased.authority.effectivePolicy.policyHash,
    activation_id: erased.authority.activation.id,
    activation_revision: erased.authority.activation.revision,
    activation_hash: erased.authority.activation.activationHash,
    storage_root_id: erased.target.root.storageRootId,
    data_class_id: erased.target.root.dataClassId,
    root_record_id: erased.target.root.recordId,
    entity_type_id: erased.target.entity.entityTypeId,
    entity_id: erased.target.entity.entityId,
    entity_revision: erased.target.entityRevision,
    lineage_revision: erased.target.lineageRevision,
    deletion_run_id: erased.deletionRun.id,
    deletion_run_revision: erased.deletionRun.revision,
    deletion_plan_hash: erased.deletionRun.planHash,
    primary_absence_verified_at: erased.primaryAbsence.verifiedAt,
    primary_verification_handler_id: erased.primaryAbsence.handlerId,
    backup_expiry_state: erased.backupExpiry.state,
    backup_latest_possible_expiry_at: null,
    backup_verified_at: null,
    stream_epoch: erased.highWater.streamEpoch,
    sync_generation: erased.highWater.syncGeneration,
    complete_through_position: erased.highWater.completeThrough,
    occurred_at: erased.occurredAt
  };
}

function persistedErasureEvidenceRows() {
  if (
    erased.primaryAbsence.evidence.kind !== "digest" ||
    erased.backupExpiry.evidence.kind !== "digest"
  ) {
    throw new Error("Invalid erasure evidence fixture.");
  }
  return [
    {
      slot: "primary_absence",
      kind: "digest",
      digest: erased.primaryAbsence.evidence.digest,
      payload_tenant_id: null,
      payload_record_id: null,
      payload_schema_id: null,
      payload_schema_version: null
    },
    {
      slot: "backup_expiry",
      kind: "digest",
      digest: erased.backupExpiry.evidence.digest,
      payload_tenant_id: null,
      payload_record_id: null,
      payload_schema_id: null,
      payload_schema_version: null
    }
  ];
}

function authorityRootRow() {
  return {
    registry_id: "core:data-governance-registry",
    registry_revision: "1",
    root_kind: "sql",
    boundary: "operated_data_plane",
    checked_at: checkedAt
  };
}

function controlSetRow() {
  return {
    legal_hold_set_revision: "7",
    restriction_set_revision: "9",
    last_changed_stream_position: "15",
    head_revision: "11"
  };
}

function prospectiveRow() {
  return {
    prospective_legal_hold: false,
    prospective_restriction: false
  };
}

function restoreAuthorityRow(patch: Record<string, unknown> = {}) {
  return {
    restore_state: "open",
    head_revision: "1",
    lease_revision: "1",
    restore_head_revision: "1",
    lease_state: "active",
    lease_token_hash: calculateInboxV2ErasureRestoreLeaseTokenHash(leaseToken),
    lease_expires_at: "2026-07-15T10:01:00.000Z",
    ...patch
  };
}

function queuedExecutor(rows: readonly (readonly Record<string, unknown>[])[]) {
  let index = 0;
  const queries: string[] = [];
  const executor: InboxV2ErasureRestoreLedgerTransactionExecutor & {
    queries: string[];
  } = {
    queries,
    async execute(query) {
      queries.push(render(query));
      return { rows: (rows[index++] ?? []) as never };
    },
    async transaction(work) {
      return work(executor);
    }
  };
  return executor;
}

function render(query: Parameters<PgDialect["sqlToQuery"]>[0]): string {
  return new PgDialect().sqlToQuery(query).sql.replace(/\s+/gu, " ").trim();
}
