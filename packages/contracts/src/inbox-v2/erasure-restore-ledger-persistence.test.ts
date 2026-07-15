import { describe, expect, it, vi } from "vitest";

import {
  appendInboxV2ErasureRestoreLedgerEntry,
  calculateInboxV2ErasureRestoreLeaseTokenHash,
  defineInboxV2ErasureRestoreLedgerRepository
} from "./erasure-restore-ledger-persistence";
import { defineInboxV2ErasureRestoreLedgerEntry } from "./erasure-restore-ledger";

const hash = (character: string) => `sha256:${character.repeat(64)}`;
const tenantId = "tenant:ledger-persistence";
const occurredAt = "2026-07-15T08:00:00.000Z";
const restoreId = "restore:persistence";

const entry = defineInboxV2ErasureRestoreLedgerEntry({
  tenantId,
  ledgerId: "ledger:persistence",
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
    registryCompositionHash: hash("a"),
    governance: {
      tenantId,
      id: "core:governance.default",
      version: "1",
      contextHash: hash("b")
    },
    effectivePolicy: {
      tenantId,
      id: "core:lifecycle.default",
      version: "1",
      policyHash: hash("c")
    },
    activation: {
      tenantId,
      id: "core:lifecycle-activation.default",
      revision: "1",
      activationHash: hash("d")
    }
  },
  deletionRun: { id: "deletion_run:one", revision: "1", planHash: hash("e") },
  primaryAbsence: {
    state: "verified_absent",
    verifiedAt: occurredAt,
    handlerId: "core:message-delete-verification",
    evidence: { kind: "digest", digest: hash("f") }
  },
  backupExpiry: {
    state: "not_applicable",
    evidence: { kind: "digest", digest: hash("0") }
  },
  highWater: {
    streamEpoch: "epoch:ledger-persistence",
    syncGeneration: "1",
    completeThrough: "10"
  },
  occurredAt
});

const restoreEntry = defineInboxV2ErasureRestoreLedgerEntry({
  tenantId,
  ledgerId: entry.ledgerId,
  sequence: "2",
  previousEntryHash: entry.entryHash,
  kind: "restore_opened",
  target: entry.target,
  authority: entry.authority,
  restoreId,
  sourceErasureEntryHash: entry.entryHash,
  reapplication: { state: "pending", requiredControlEntryHashes: [] },
  evidence: { kind: "digest", digest: hash("9") },
  highWater: {
    streamEpoch: "epoch:ledger-persistence",
    syncGeneration: "1",
    completeThrough: "11"
  },
  occurredAt: "2026-07-15T08:01:00.000Z"
});

describe("Inbox V2 durable erasure/restore ledger repository boundary", () => {
  it("accepts one exact typed persisted entry", async () => {
    const append = vi.fn(async () => ({ outcome: "applied", entry }) as const);
    const repository = defineInboxV2ErasureRestoreLedgerRepository({ append });

    await expect(
      appendInboxV2ErasureRestoreLedgerEntry({ repository, entry })
    ).resolves.toEqual({ outcome: "applied", entry });
    expect(append).toHaveBeenCalledWith(entry);
  });

  it("rejects unregistered repositories and substituted persisted entries", async () => {
    await expect(
      appendInboxV2ErasureRestoreLedgerEntry({
        repository: { append: async () => ({ outcome: "applied", entry }) },
        entry
      })
    ).rejects.toThrow(/registered durable repository/u);

    const other = defineInboxV2ErasureRestoreLedgerEntry({
      ...entry,
      ledgerId: "ledger:other"
    });
    const repository = defineInboxV2ErasureRestoreLedgerRepository({
      append: async () => ({ outcome: "already_applied", entry: other })
    });
    await expect(
      appendInboxV2ErasureRestoreLedgerEntry({ repository, entry })
    ).rejects.toThrow(/different persisted entry/u);
  });

  it("preserves typed conflict and missing-authority outcomes", async () => {
    const conflict = defineInboxV2ErasureRestoreLedgerRepository({
      append: async () => ({ outcome: "conflict", facet: "restore_chain" })
    });
    await expect(
      appendInboxV2ErasureRestoreLedgerEntry({
        repository: conflict,
        entry
      })
    ).resolves.toEqual({ outcome: "conflict", facet: "restore_chain" });

    const missing = defineInboxV2ErasureRestoreLedgerRepository({
      append: async () => ({ outcome: "not_found", subject: "storage_root" })
    });
    await expect(
      appendInboxV2ErasureRestoreLedgerEntry({ repository: missing, entry })
    ).resolves.toEqual({ outcome: "not_found", subject: "storage_root" });
  });

  it("requires a typed lease/CAS fence for every restore mutation", async () => {
    const append = vi.fn(
      async () => ({ outcome: "applied", entry: restoreEntry }) as const
    );
    const repository = defineInboxV2ErasureRestoreLedgerRepository({ append });

    await expect(
      appendInboxV2ErasureRestoreLedgerEntry({
        repository,
        entry: restoreEntry
      })
    ).rejects.toThrow(/database CAS lease fence/u);
    await expect(
      appendInboxV2ErasureRestoreLedgerEntry({
        repository,
        entry: restoreEntry,
        restoreFence: {
          operation: "open_restore",
          restoreId: "restore:other",
          leaseToken: "restore-lease-token-000000000000000000000001",
          leaseDurationSeconds: 30
        }
      })
    ).rejects.toThrow(/exact restore operation/u);

    const restoreFence = {
      operation: "open_restore",
      restoreId,
      leaseToken: "restore-lease-token-000000000000000000000001",
      leaseDurationSeconds: 30
    } as const;
    await expect(
      appendInboxV2ErasureRestoreLedgerEntry({
        repository,
        entry: restoreEntry,
        restoreFence
      })
    ).resolves.toEqual({ outcome: "applied", entry: restoreEntry });
    expect(append).toHaveBeenLastCalledWith(restoreEntry, restoreFence);
  });

  it("hashes an opaque restore lease without exposing the raw token", () => {
    const token = "restore-lease-token-000000000000000000000001";
    const digest = calculateInboxV2ErasureRestoreLeaseTokenHash(token);
    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(digest).not.toContain(token);
    expect(calculateInboxV2ErasureRestoreLeaseTokenHash(token)).toBe(digest);
  });
});
