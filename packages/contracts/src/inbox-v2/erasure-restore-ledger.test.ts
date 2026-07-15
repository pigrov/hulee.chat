import { describe, expect, it } from "vitest";

import {
  calculateInboxV2ErasureRestoreEntryHash,
  defineInboxV2ErasureRestoreLedger,
  defineInboxV2ErasureRestoreLedgerEntry,
  inboxV2ErasureRestoreLedgerEntrySchema,
  inboxV2ErasureRestoreLedgerSchema
} from "./erasure-restore-ledger";
import { assertInboxV2ClosedJsonSchema } from "./schema-safety";

const tenantId = "tenant:tenant-1";
const otherTenantId = "tenant:tenant-2";
const hashA = `sha256:${"a".repeat(64)}`;
const hashB = `sha256:${"b".repeat(64)}`;
const hashC = `sha256:${"c".repeat(64)}`;

function target(targetTenantId = tenantId) {
  return {
    root: {
      tenantId: targetTenantId,
      dataClassId: "core:message_content_blocks",
      storageRootId: "core:message-content-sql",
      recordId: "data_root:conversation-1"
    },
    entity: {
      tenantId: targetTenantId,
      entityTypeId: "core:conversation",
      entityId: "conversation:conversation-1"
    },
    entityRevision: "7",
    lineageRevision: "3"
  } as const;
}

function authority(authorityTenantId = tenantId) {
  return {
    registryCompositionHash: hashA,
    governance: {
      tenantId: authorityTenantId,
      id: "core:tenant-default-governance",
      version: "4",
      contextHash: hashB
    },
    effectivePolicy: {
      tenantId: authorityTenantId,
      id: "core:tenant-default-policy",
      version: "5",
      policyHash: hashC
    },
    activation: {
      tenantId: authorityTenantId,
      id: "core:tenant-default-policy-activation-5",
      revision: "2",
      activationHash: hashA
    }
  } as const;
}

function base(
  sequence: string,
  previousEntryHash: string | null,
  completeThrough: string,
  occurredAt: string
) {
  return {
    tenantId,
    ledgerId: "privacy-ledger:tenant-1",
    sequence,
    previousEntryHash,
    target: target(),
    authority: authority(),
    highWater: {
      streamEpoch: "stream:epoch-1",
      syncGeneration: "1",
      completeThrough
    },
    occurredAt
  } as const;
}

function erasureEntry(
  sequence = "1",
  previousEntryHash: string | null = null,
  completeThrough = "100",
  occurredAt = "2026-07-15T10:00:00.000Z"
) {
  return defineInboxV2ErasureRestoreLedgerEntry({
    ...base(sequence, previousEntryHash, completeThrough, occurredAt),
    kind: "erasure_applied",
    deletionRun: {
      id: "privacy-deletion-run:run-1",
      revision: "3",
      planHash: hashB
    },
    primaryAbsence: {
      state: "verified_absent",
      verifiedAt: "2026-07-15T09:59:59.000Z",
      handlerId: "core:message-content-delete",
      evidence: { kind: "digest", digest: hashC }
    },
    backupExpiry: {
      state: "finite_expiry_pending",
      expiresAt: "2026-08-15T10:00:00.000Z",
      evidence: { kind: "digest", digest: hashA }
    }
  });
}

describe("Inbox V2 erasure/restore ledger", () => {
  it("defines a canonical tenant-bound append-only hash chain", () => {
    const erasure = erasureEntry();
    const opened = defineInboxV2ErasureRestoreLedgerEntry({
      ...base("2", erasure.entryHash, "101", "2026-07-15T10:01:00.000Z"),
      kind: "restore_opened",
      restoreId: "privacy-restore:restore-1",
      sourceErasureEntryHash: erasure.entryHash,
      reapplication: {
        state: "pending",
        requiredControlEntryHashes: []
      },
      evidence: { kind: "digest", digest: hashB }
    });
    const sealed = defineInboxV2ErasureRestoreLedgerEntry({
      ...base("3", opened.entryHash, "102", "2026-07-15T10:02:00.000Z"),
      kind: "restore_sealed",
      restoreId: "privacy-restore:restore-1",
      sourceErasureEntryHash: erasure.entryHash,
      reapplication: {
        state: "sealed",
        sealedAt: "2026-07-15T10:02:00.000Z",
        requiredControlEntryHashes: [],
        reappliedControlEntryHashes: [],
        evidence: { kind: "digest", digest: hashC }
      }
    });

    const ledger = defineInboxV2ErasureRestoreLedger({
      tenantId,
      ledgerId: "privacy-ledger:tenant-1",
      revision: "3",
      entries: [erasure, opened, sealed]
    });

    expect(ledger.entries).toHaveLength(3);
    expect(ledger.entries[1]!.previousEntryHash).toBe(erasure.entryHash);
    expect(Object.isFrozen(ledger.entries[0])).toBe(true);
    expect(
      calculateInboxV2ErasureRestoreEntryHash({
        ...erasure,
        entryHash: hashA
      })
    ).toBe(erasure.entryHash);
  });

  it("reapplies the exact prior hold and restriction set before sealing", () => {
    const hold = defineInboxV2ErasureRestoreLedgerEntry({
      ...base("1", null, "90", "2026-07-15T09:55:00.000Z"),
      kind: "hold_applied",
      control: {
        kind: "legal_hold",
        hold: { tenantId, holdId: "hold:1", revision: "1" }
      },
      application: {
        state: "applied",
        appliedAt: "2026-07-15T09:55:00.000Z",
        evidence: { kind: "digest", digest: hashA }
      }
    });
    const restriction = defineInboxV2ErasureRestoreLedgerEntry({
      ...base("2", hold.entryHash, "91", "2026-07-15T09:56:00.000Z"),
      kind: "restriction_applied",
      control: {
        kind: "processing_restriction",
        restriction: {
          tenantId,
          restrictionId: "restriction:1",
          revision: "1"
        }
      },
      application: {
        state: "applied",
        appliedAt: "2026-07-15T09:56:00.000Z",
        evidence: { kind: "digest", digest: hashB }
      }
    });
    const erasure = erasureEntry(
      "3",
      restriction.entryHash,
      "100",
      "2026-07-15T10:00:00.000Z"
    );
    const required = [hold.entryHash, restriction.entryHash].sort(
      (left, right) => left.localeCompare(right)
    );
    const opened = defineInboxV2ErasureRestoreLedgerEntry({
      ...base("4", erasure.entryHash, "101", "2026-07-15T10:01:00.000Z"),
      kind: "restore_opened",
      restoreId: "privacy-restore:restore-controls",
      sourceErasureEntryHash: erasure.entryHash,
      reapplication: {
        state: "pending",
        requiredControlEntryHashes: required
      },
      evidence: { kind: "digest", digest: hashC }
    });
    const sources = required.map((sourceHash) =>
      sourceHash === hold.entryHash ? hold : restriction
    );
    const firstSource = sources[0]!;
    if (
      firstSource.kind !== "hold_applied" &&
      firstSource.kind !== "restriction_applied"
    ) {
      throw new Error("Expected a control ledger entry.");
    }
    const firstReapplied = defineInboxV2ErasureRestoreLedgerEntry({
      ...base("5", opened.entryHash, "102", "2026-07-15T10:02:00.000Z"),
      kind: "control_reapplied",
      restoreId: "privacy-restore:restore-controls",
      sourceControlEntryHash: firstSource.entryHash,
      control: firstSource.control,
      reapplication: {
        state: "reapplied",
        reappliedAt: "2026-07-15T10:02:00.000Z",
        evidence: { kind: "digest", digest: hashA }
      }
    });
    const secondSource = sources[1]!;
    if (
      secondSource.kind !== "hold_applied" &&
      secondSource.kind !== "restriction_applied"
    ) {
      throw new Error("Expected a control ledger entry.");
    }
    const secondReapplied = defineInboxV2ErasureRestoreLedgerEntry({
      ...base("6", firstReapplied.entryHash, "103", "2026-07-15T10:03:00.000Z"),
      kind: "control_reapplied",
      restoreId: "privacy-restore:restore-controls",
      sourceControlEntryHash: secondSource.entryHash,
      control: secondSource.control,
      reapplication: {
        state: "reapplied",
        reappliedAt: "2026-07-15T10:03:00.000Z",
        evidence: { kind: "digest", digest: hashB }
      }
    });
    const sealed = defineInboxV2ErasureRestoreLedgerEntry({
      ...base(
        "7",
        secondReapplied.entryHash,
        "104",
        "2026-07-15T10:04:00.000Z"
      ),
      kind: "restore_sealed",
      restoreId: "privacy-restore:restore-controls",
      sourceErasureEntryHash: erasure.entryHash,
      reapplication: {
        state: "sealed",
        sealedAt: "2026-07-15T10:04:00.000Z",
        requiredControlEntryHashes: required,
        reappliedControlEntryHashes: required,
        evidence: { kind: "digest", digest: hashC }
      }
    });

    const ledger = defineInboxV2ErasureRestoreLedger({
      tenantId,
      ledgerId: "privacy-ledger:tenant-1",
      revision: "7",
      entries: [
        hold,
        restriction,
        erasure,
        opened,
        firstReapplied,
        secondReapplied,
        sealed
      ]
    });
    expect(ledger.entries.map(({ kind }) => kind)).toContain(
      "control_reapplied"
    );
  });

  it("records an explicit release transition newer than a restored backup snapshot", () => {
    const applied = defineInboxV2ErasureRestoreLedgerEntry({
      ...base("1", null, "90", "2026-07-15T09:55:00.000Z"),
      kind: "hold_applied",
      control: {
        kind: "legal_hold",
        hold: { tenantId, holdId: "hold:released-after-backup", revision: "1" }
      },
      application: {
        state: "applied",
        appliedAt: "2026-07-15T09:55:00.000Z",
        evidence: { kind: "digest", digest: hashA }
      }
    });
    const released = defineInboxV2ErasureRestoreLedgerEntry({
      ...base("2", applied.entryHash, "110", "2026-07-15T10:05:00.000Z"),
      kind: "hold_released",
      control: {
        kind: "legal_hold",
        hold: { tenantId, holdId: "hold:released-after-backup", revision: "2" }
      },
      release: {
        state: "released",
        releasedAt: "2026-07-15T10:05:00.000Z",
        evidence: { kind: "digest", digest: hashB }
      }
    });

    expect(
      defineInboxV2ErasureRestoreLedger({
        tenantId,
        ledgerId: "privacy-ledger:tenant-1",
        revision: "2",
        entries: [applied, released]
      }).entries.map((entry) => entry.kind)
    ).toEqual(["hold_applied", "hold_released"]);
  });

  it("rejects cross-tenant authority, target and payload evidence", () => {
    expect(() =>
      defineInboxV2ErasureRestoreLedgerEntry({
        ...base("1", null, "100", "2026-07-15T10:00:00.000Z"),
        authority: authority(otherTenantId),
        kind: "hold_applied",
        control: {
          kind: "legal_hold",
          hold: { tenantId, holdId: "hold:1", revision: "1" }
        },
        application: {
          state: "applied",
          appliedAt: "2026-07-15T10:00:00.000Z",
          evidence: { kind: "digest", digest: hashA }
        }
      })
    ).toThrow(/cross tenant boundaries/u);

    expect(() =>
      defineInboxV2ErasureRestoreLedgerEntry({
        ...base("1", null, "100", "2026-07-15T10:00:00.000Z"),
        kind: "restriction_applied",
        control: {
          kind: "processing_restriction",
          restriction: {
            tenantId,
            restrictionId: "restriction:1",
            revision: "1"
          }
        },
        application: {
          state: "applied",
          appliedAt: "2026-07-15T10:00:00.000Z",
          evidence: {
            kind: "payload_reference",
            payload: {
              tenantId: otherTenantId,
              recordId: "payload:privacy-evidence-1",
              schemaId: "core:privacy-evidence",
              schemaVersion: "v1",
              digest: hashB
            }
          }
        }
      })
    ).toThrow(/cross tenant boundaries/u);
  });

  it("requires verified primary absence and a genuinely finite backup state", () => {
    expect(() =>
      defineInboxV2ErasureRestoreLedgerEntry({
        ...base("1", null, "100", "2026-07-15T10:00:00.000Z"),
        kind: "erasure_applied",
        deletionRun: {
          id: "privacy-deletion-run:run-1",
          revision: "3",
          planHash: hashB
        },
        primaryAbsence: {
          state: "verified_absent",
          verifiedAt: "2026-07-15T10:00:01.000Z",
          handlerId: "core:message-content-delete",
          evidence: { kind: "digest", digest: hashC }
        },
        backupExpiry: {
          state: "finite_expiry_pending",
          expiresAt: "2026-07-15T09:00:00.000Z",
          evidence: { kind: "digest", digest: hashA }
        }
      })
    ).toThrow();
  });

  it("rejects non-contiguous order, regressing high water and incomplete reapplication", () => {
    const erasure = erasureEntry();
    const outOfOrder = defineInboxV2ErasureRestoreLedgerEntry({
      ...base("3", erasure.entryHash, "99", "2026-07-15T10:01:00.000Z"),
      kind: "restore_opened",
      restoreId: "privacy-restore:restore-1",
      sourceErasureEntryHash: erasure.entryHash,
      reapplication: {
        state: "pending",
        requiredControlEntryHashes: []
      },
      evidence: { kind: "digest", digest: hashB }
    });
    expect(() =>
      defineInboxV2ErasureRestoreLedger({
        tenantId,
        ledgerId: "privacy-ledger:tenant-1",
        revision: "2",
        entries: [erasure, outOfOrder]
      })
    ).toThrow(/contiguous|high-water/u);

    expect(() =>
      defineInboxV2ErasureRestoreLedgerEntry({
        ...base("1", null, "100", "2026-07-15T10:00:00.000Z"),
        kind: "restore_sealed",
        restoreId: "privacy-restore:restore-1",
        sourceErasureEntryHash: hashA,
        reapplication: {
          state: "sealed",
          sealedAt: "2026-07-15T10:00:00.000Z",
          requiredControlEntryHashes: [hashA],
          reappliedControlEntryHashes: [],
          evidence: { kind: "digest", digest: hashC }
        }
      })
    ).toThrow(/exact canonical required-control set/u);
  });

  it("keeps JSON contracts closed against accidental raw PII fields", () => {
    expect(() =>
      inboxV2ErasureRestoreLedgerEntrySchema.parse({
        ...erasureEntry(),
        email: "client@example.test"
      })
    ).toThrow();
    assertInboxV2ClosedJsonSchema(inboxV2ErasureRestoreLedgerEntrySchema);
    assertInboxV2ClosedJsonSchema(inboxV2ErasureRestoreLedgerSchema);
  });
});
