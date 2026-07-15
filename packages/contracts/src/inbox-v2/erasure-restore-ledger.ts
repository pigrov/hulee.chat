import { z } from "zod";

import { inboxV2DataGovernanceContextReferenceSchema } from "./data-governance";
import {
  inboxV2DataLifecyclePolicyReferenceSchema,
  inboxV2PolicyActivationReferenceSchema
} from "./data-lifecycle-policy";
import {
  inboxV2LifecycleHandlerIdSchema,
  INBOX_V2_DATA_LIFECYCLE_SCHEMA_VERSION
} from "./data-lifecycle-primitives";
import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema
} from "./entity-metadata";
import { inboxV2TenantIdSchema } from "./ids";
import { inboxV2DeletionRunIdSchema } from "./privacy-deletion";
import {
  inboxV2PrivacyHoldReferenceSchema,
  inboxV2ProcessingRestrictionReferenceSchema
} from "./privacy-hold-restriction";
import { calculateInboxV2CanonicalSha256 } from "./recipient-sync-hash";
import {
  createInboxV2SchemaEnvelopeSchema,
  type InboxV2SchemaEnvelope
} from "./schema-version";
import { inboxV2DataRootReferenceSchema } from "./data-subject-discovery";
import {
  inboxV2EntityKeySchema,
  inboxV2PayloadReferenceSchema,
  inboxV2Sha256DigestSchema,
  inboxV2StreamEpochSchema,
  inboxV2SyncGenerationSchema,
  inboxV2TenantStreamPositionSchema
} from "./sync-primitives";

export const INBOX_V2_ERASURE_RESTORE_LEDGER_SCHEMA_ID =
  "core:inbox-v2.erasure-restore-ledger" as const;

const erasureRestoreOpaqueIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._~:-]*$/u);

export const inboxV2ErasureRestoreLedgerIdSchema = erasureRestoreOpaqueIdSchema;
export const inboxV2RestoreIdSchema = erasureRestoreOpaqueIdSchema;

export const inboxV2ErasureRestoreHighWaterSchema = z
  .object({
    streamEpoch: inboxV2StreamEpochSchema,
    syncGeneration: inboxV2SyncGenerationSchema,
    completeThrough: inboxV2TenantStreamPositionSchema
  })
  .strict();

/** Classified evidence stays encrypted elsewhere; this ledger keeps only a digest or payload reference. */
export const inboxV2ErasureRestoreEvidenceSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("digest"),
        digest: inboxV2Sha256DigestSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("payload_reference"),
        payload: inboxV2PayloadReferenceSchema
      })
      .strict()
  ]
);

export const inboxV2ErasureRestoreTargetSchema = z
  .object({
    root: inboxV2DataRootReferenceSchema,
    entity: inboxV2EntityKeySchema,
    entityRevision: inboxV2EntityRevisionSchema,
    lineageRevision: inboxV2EntityRevisionSchema
  })
  .strict()
  .superRefine((target, context) => {
    if (target.root.tenantId !== target.entity.tenantId) {
      addIssue(
        context,
        [],
        "Erasure/restore target root and entity must belong to one tenant."
      );
    }
  });

export const inboxV2ErasureRestoreAuthoritySchema = z
  .object({
    registryCompositionHash: inboxV2Sha256DigestSchema,
    governance: inboxV2DataGovernanceContextReferenceSchema,
    effectivePolicy: inboxV2DataLifecyclePolicyReferenceSchema,
    activation: inboxV2PolicyActivationReferenceSchema
  })
  .strict();

export const inboxV2PrimaryAbsenceStateSchema = z
  .object({
    state: z.literal("verified_absent"),
    verifiedAt: inboxV2TimestampSchema,
    handlerId: inboxV2LifecycleHandlerIdSchema,
    evidence: inboxV2ErasureRestoreEvidenceSchema
  })
  .strict();

export const inboxV2FiniteBackupExpiryStateSchema = z.discriminatedUnion(
  "state",
  [
    z
      .object({
        state: z.literal("not_applicable"),
        evidence: inboxV2ErasureRestoreEvidenceSchema
      })
      .strict(),
    z
      .object({
        state: z.literal("finite_expiry_pending"),
        expiresAt: inboxV2TimestampSchema,
        evidence: inboxV2ErasureRestoreEvidenceSchema
      })
      .strict(),
    z
      .object({
        state: z.literal("verified_expired"),
        expiresAt: inboxV2TimestampSchema,
        verifiedAt: inboxV2TimestampSchema,
        evidence: inboxV2ErasureRestoreEvidenceSchema
      })
      .strict()
      .superRefine((state, context) => {
        if (Date.parse(state.verifiedAt) < Date.parse(state.expiresAt)) {
          addIssue(
            context,
            ["verifiedAt"],
            "Backup expiry cannot be verified before its finite expiry."
          );
        }
      })
  ]
);

const legalHoldControlReferenceSchema = z
  .object({
    kind: z.literal("legal_hold"),
    hold: inboxV2PrivacyHoldReferenceSchema
  })
  .strict();

const processingRestrictionControlReferenceSchema = z
  .object({
    kind: z.literal("processing_restriction"),
    restriction: inboxV2ProcessingRestrictionReferenceSchema
  })
  .strict();

export const inboxV2ErasureRestoreControlReferenceSchema = z.discriminatedUnion(
  "kind",
  [legalHoldControlReferenceSchema, processingRestrictionControlReferenceSchema]
);

const commonEntryShape = {
  tenantId: inboxV2TenantIdSchema,
  ledgerId: inboxV2ErasureRestoreLedgerIdSchema,
  sequence: inboxV2EntityRevisionSchema,
  previousEntryHash: inboxV2Sha256DigestSchema.nullable(),
  target: inboxV2ErasureRestoreTargetSchema,
  authority: inboxV2ErasureRestoreAuthoritySchema,
  highWater: inboxV2ErasureRestoreHighWaterSchema,
  occurredAt: inboxV2TimestampSchema,
  entryHash: inboxV2Sha256DigestSchema
} as const;

const appliedControlStateSchema = z
  .object({
    state: z.literal("applied"),
    appliedAt: inboxV2TimestampSchema,
    evidence: inboxV2ErasureRestoreEvidenceSchema
  })
  .strict();

const releasedControlStateSchema = z
  .object({
    state: z.literal("released"),
    releasedAt: inboxV2TimestampSchema,
    evidence: inboxV2ErasureRestoreEvidenceSchema
  })
  .strict();

const pendingReapplicationStateSchema = z
  .object({
    state: z.literal("pending"),
    requiredControlEntryHashes: z
      .array(inboxV2Sha256DigestSchema)
      .max(10_000)
      .superRefine((hashes, context) =>
        addCanonicalUniqueIssue(
          context,
          hashes,
          "Required control-entry hashes"
        )
      )
  })
  .strict();

const reappliedControlStateSchema = z
  .object({
    state: z.literal("reapplied"),
    reappliedAt: inboxV2TimestampSchema,
    evidence: inboxV2ErasureRestoreEvidenceSchema
  })
  .strict();

const sealedReapplicationStateSchema = z
  .object({
    state: z.literal("sealed"),
    sealedAt: inboxV2TimestampSchema,
    requiredControlEntryHashes: z
      .array(inboxV2Sha256DigestSchema)
      .max(10_000)
      .superRefine((hashes, context) =>
        addCanonicalUniqueIssue(
          context,
          hashes,
          "Required control-entry hashes"
        )
      ),
    reappliedControlEntryHashes: z
      .array(inboxV2Sha256DigestSchema)
      .max(10_000)
      .superRefine((hashes, context) =>
        addCanonicalUniqueIssue(
          context,
          hashes,
          "Reapplied control-entry hashes"
        )
      ),
    evidence: inboxV2ErasureRestoreEvidenceSchema
  })
  .strict()
  .superRefine((state, context) => {
    if (
      state.requiredControlEntryHashes.length !==
        state.reappliedControlEntryHashes.length ||
      state.requiredControlEntryHashes.some(
        (hash, index) => hash !== state.reappliedControlEntryHashes[index]
      )
    ) {
      addIssue(
        context,
        ["reappliedControlEntryHashes"],
        "A sealed restore must reapply the exact canonical required-control set."
      );
    }
  });

export const inboxV2ErasureRestoreLedgerEntrySchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        ...commonEntryShape,
        kind: z.literal("erasure_applied"),
        deletionRun: z
          .object({
            id: inboxV2DeletionRunIdSchema,
            revision: inboxV2EntityRevisionSchema,
            planHash: inboxV2Sha256DigestSchema
          })
          .strict(),
        primaryAbsence: inboxV2PrimaryAbsenceStateSchema,
        backupExpiry: inboxV2FiniteBackupExpiryStateSchema
      })
      .strict(),
    z
      .object({
        ...commonEntryShape,
        kind: z.literal("hold_applied"),
        control: legalHoldControlReferenceSchema,
        application: appliedControlStateSchema
      })
      .strict(),
    z
      .object({
        ...commonEntryShape,
        kind: z.literal("restriction_applied"),
        control: processingRestrictionControlReferenceSchema,
        application: appliedControlStateSchema
      })
      .strict(),
    z
      .object({
        ...commonEntryShape,
        kind: z.literal("hold_released"),
        control: legalHoldControlReferenceSchema,
        release: releasedControlStateSchema
      })
      .strict(),
    z
      .object({
        ...commonEntryShape,
        kind: z.literal("restriction_released"),
        control: processingRestrictionControlReferenceSchema,
        release: releasedControlStateSchema
      })
      .strict(),
    z
      .object({
        ...commonEntryShape,
        kind: z.literal("restore_opened"),
        restoreId: inboxV2RestoreIdSchema,
        sourceErasureEntryHash: inboxV2Sha256DigestSchema,
        reapplication: pendingReapplicationStateSchema,
        evidence: inboxV2ErasureRestoreEvidenceSchema
      })
      .strict(),
    z
      .object({
        ...commonEntryShape,
        kind: z.literal("control_reapplied"),
        restoreId: inboxV2RestoreIdSchema,
        sourceControlEntryHash: inboxV2Sha256DigestSchema,
        control: inboxV2ErasureRestoreControlReferenceSchema,
        reapplication: reappliedControlStateSchema
      })
      .strict(),
    z
      .object({
        ...commonEntryShape,
        kind: z.literal("restore_sealed"),
        restoreId: inboxV2RestoreIdSchema,
        sourceErasureEntryHash: inboxV2Sha256DigestSchema,
        reapplication: sealedReapplicationStateSchema
      })
      .strict()
  ])
  .superRefine((entry, context) => {
    const tenantIds = [
      entry.target.root.tenantId,
      entry.target.entity.tenantId,
      entry.authority.governance.tenantId,
      entry.authority.effectivePolicy.tenantId,
      entry.authority.activation.tenantId,
      ...entryEvidenceTenantIds(entry),
      ...entryControlTenantIds(entry)
    ];
    if (tenantIds.some((tenantId) => tenantId !== entry.tenantId)) {
      addIssue(
        context,
        [],
        "Erasure/restore ledger entries cannot cross tenant boundaries."
      );
    }
    if (entry.entryHash !== calculateInboxV2ErasureRestoreEntryHash(entry)) {
      addIssue(
        context,
        ["entryHash"],
        "Ledger entry hash must match its canonical minimized content."
      );
    }
    addTemporalEntryIssues(entry, context);
  });

export const inboxV2ErasureRestoreLedgerSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    ledgerId: inboxV2ErasureRestoreLedgerIdSchema,
    revision: inboxV2EntityRevisionSchema,
    entries: z
      .array(inboxV2ErasureRestoreLedgerEntrySchema)
      .min(1)
      .max(100_000),
    ledgerHash: inboxV2Sha256DigestSchema
  })
  .strict()
  .superRefine((ledger, context) => {
    for (const [index, entry] of ledger.entries.entries()) {
      const previous = ledger.entries[index - 1];
      if (
        entry.tenantId !== ledger.tenantId ||
        entry.ledgerId !== ledger.ledgerId ||
        BigInt(entry.sequence) !== BigInt(index + 1) ||
        entry.previousEntryHash !== (previous?.entryHash ?? null)
      ) {
        addIssue(
          context,
          ["entries", index],
          "Ledger entries must be tenant-bound, contiguous and hash-chain ordered."
        );
      }
      if (previous !== undefined) {
        addHighWaterOrderingIssues(previous, entry, context, index);
        if (Date.parse(entry.occurredAt) < Date.parse(previous.occurredAt)) {
          addIssue(
            context,
            ["entries", index, "occurredAt"],
            "Ledger occurrence time cannot move backwards."
          );
        }
      }
    }
    const lastEntry = ledger.entries.at(-1)!;
    if (ledger.revision !== lastEntry.sequence) {
      addIssue(
        context,
        ["revision"],
        "Ledger revision must equal the last append-only entry sequence."
      );
    }
    addRestoreChainIssues(ledger.entries, context);
    if (
      ledger.ledgerHash !== calculateInboxV2ErasureRestoreLedgerHash(ledger)
    ) {
      addIssue(
        context,
        ["ledgerHash"],
        "Ledger hash must match its canonical append-only entry chain."
      );
    }
  });

export const inboxV2ErasureRestoreLedgerEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_ERASURE_RESTORE_LEDGER_SCHEMA_ID,
    INBOX_V2_DATA_LIFECYCLE_SCHEMA_VERSION,
    inboxV2ErasureRestoreLedgerSchema
  );

export type InboxV2ErasureRestoreLedgerEntry = z.infer<
  typeof inboxV2ErasureRestoreLedgerEntrySchema
>;
export type InboxV2ErasureRestoreLedger = z.infer<
  typeof inboxV2ErasureRestoreLedgerSchema
>;
type InboxV2ErasureRestoreLedgerEntryInput = z.input<
  typeof inboxV2ErasureRestoreLedgerEntrySchema
>;
type WithoutEntryHash<T> = T extends unknown
  ? Omit<T, "entryHash"> & { entryHash?: unknown }
  : never;
export type InboxV2ErasureRestoreLedgerEnvelope = InboxV2SchemaEnvelope<
  typeof INBOX_V2_ERASURE_RESTORE_LEDGER_SCHEMA_ID,
  typeof INBOX_V2_DATA_LIFECYCLE_SCHEMA_VERSION,
  InboxV2ErasureRestoreLedger
>;

export function calculateInboxV2ErasureRestoreEntryHash(input: {
  entryHash?: unknown;
  [key: string]: unknown;
}) {
  const { entryHash: _ignored, ...entry } = input;
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.erasure-restore-ledger-entry",
    hashVersion: "v1",
    entry
  });
}

export function calculateInboxV2ErasureRestoreLedgerHash(input: {
  ledgerHash?: unknown;
  [key: string]: unknown;
}) {
  const { ledgerHash: _ignored, ...ledger } = input;
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.erasure-restore-ledger",
    hashVersion: "v1",
    ledger
  });
}

export function defineInboxV2ErasureRestoreLedgerEntry(
  input: WithoutEntryHash<InboxV2ErasureRestoreLedgerEntryInput>
): InboxV2ErasureRestoreLedgerEntry {
  const { entryHash: _ignored, ...entry } = input;
  return deepFreeze(
    inboxV2ErasureRestoreLedgerEntrySchema.parse({
      ...entry,
      entryHash: calculateInboxV2ErasureRestoreEntryHash(entry)
    })
  );
}

export function defineInboxV2ErasureRestoreLedger(
  input: Omit<
    z.input<typeof inboxV2ErasureRestoreLedgerSchema>,
    "ledgerHash"
  > & {
    ledgerHash?: unknown;
  }
): InboxV2ErasureRestoreLedger {
  const { ledgerHash: _ignored, ...ledger } = input;
  return deepFreeze(
    inboxV2ErasureRestoreLedgerSchema.parse({
      ...ledger,
      ledgerHash: calculateInboxV2ErasureRestoreLedgerHash(ledger)
    })
  );
}

function entryEvidenceTenantIds(
  entry: z.infer<typeof inboxV2ErasureRestoreLedgerEntrySchema>
): string[] {
  const evidence =
    entry.kind === "erasure_applied"
      ? [entry.primaryAbsence.evidence, entry.backupExpiry.evidence]
      : entry.kind === "hold_applied" || entry.kind === "restriction_applied"
        ? [entry.application.evidence]
        : entry.kind === "hold_released" ||
            entry.kind === "restriction_released"
          ? [entry.release.evidence]
          : entry.kind === "restore_opened"
            ? [entry.evidence]
            : [entry.reapplication.evidence];
  return evidence.flatMap((item) =>
    item.kind === "payload_reference" ? [item.payload.tenantId] : []
  );
}

function entryControlTenantIds(
  entry: z.infer<typeof inboxV2ErasureRestoreLedgerEntrySchema>
): string[] {
  if (
    entry.kind !== "hold_applied" &&
    entry.kind !== "restriction_applied" &&
    entry.kind !== "hold_released" &&
    entry.kind !== "restriction_released" &&
    entry.kind !== "control_reapplied"
  ) {
    return [];
  }
  return entry.control.kind === "legal_hold"
    ? [entry.control.hold.tenantId]
    : [entry.control.restriction.tenantId];
}

function addTemporalEntryIssues(
  entry: z.infer<typeof inboxV2ErasureRestoreLedgerEntrySchema>,
  context: z.RefinementCtx
): void {
  const occurredAt = Date.parse(entry.occurredAt);
  if (entry.kind === "erasure_applied") {
    if (Date.parse(entry.primaryAbsence.verifiedAt) > occurredAt) {
      addIssue(
        context,
        ["primaryAbsence", "verifiedAt"],
        "Primary absence must be verified by the ledger occurrence time."
      );
    }
    if (
      entry.backupExpiry.state === "finite_expiry_pending" &&
      Date.parse(entry.backupExpiry.expiresAt) <= occurredAt
    ) {
      addIssue(
        context,
        ["backupExpiry", "expiresAt"],
        "Pending backup expiry must be finite and in the future."
      );
    }
    if (
      entry.backupExpiry.state === "verified_expired" &&
      Date.parse(entry.backupExpiry.verifiedAt) > occurredAt
    ) {
      addIssue(
        context,
        ["backupExpiry", "verifiedAt"],
        "Backup expiry must be verified by the ledger occurrence time."
      );
    }
    return;
  }
  const stateTime =
    entry.kind === "hold_applied" || entry.kind === "restriction_applied"
      ? entry.application.appliedAt
      : entry.kind === "hold_released" || entry.kind === "restriction_released"
        ? entry.release.releasedAt
        : entry.kind === "control_reapplied"
          ? entry.reapplication.reappliedAt
          : entry.kind === "restore_sealed"
            ? entry.reapplication.sealedAt
            : null;
  if (stateTime !== null && Date.parse(stateTime) > occurredAt) {
    addIssue(
      context,
      ["occurredAt"],
      "Ledger occurrence time cannot precede its applied or sealed state."
    );
  }
}

function addHighWaterOrderingIssues(
  previous: InboxV2ErasureRestoreLedgerEntry,
  current: InboxV2ErasureRestoreLedgerEntry,
  context: z.RefinementCtx,
  index: number
): void {
  const previousGeneration = BigInt(previous.highWater.syncGeneration);
  const currentGeneration = BigInt(current.highWater.syncGeneration);
  const sameGeneration = currentGeneration === previousGeneration;
  if (
    currentGeneration < previousGeneration ||
    (sameGeneration &&
      (current.highWater.streamEpoch !== previous.highWater.streamEpoch ||
        BigInt(current.highWater.completeThrough) <
          BigInt(previous.highWater.completeThrough)))
  ) {
    addIssue(
      context,
      ["entries", index, "highWater"],
      "Ledger high-water generation and complete-through position cannot regress."
    );
  }
}

function addRestoreChainIssues(
  entries: readonly InboxV2ErasureRestoreLedgerEntry[],
  context: z.RefinementCtx
): void {
  const priorByHash = new Map<string, InboxV2ErasureRestoreLedgerEntry>();
  const openedByRestoreId = new Map<
    string,
    Extract<InboxV2ErasureRestoreLedgerEntry, { kind: "restore_opened" }>
  >();
  const reappliedByRestoreId = new Map<string, Set<string>>();
  const sealedRestoreIds = new Set<string>();

  for (const [index, entry] of entries.entries()) {
    if (entry.kind === "restore_opened") {
      const source = priorByHash.get(entry.sourceErasureEntryHash);
      if (
        openedByRestoreId.has(entry.restoreId) ||
        source?.kind !== "erasure_applied" ||
        !sameTarget(source.target, entry.target)
      ) {
        addIssue(
          context,
          ["entries", index],
          "Restore opening requires one prior erasure entry for the exact target."
        );
      } else {
        openedByRestoreId.set(entry.restoreId, entry);
      }
    } else if (entry.kind === "control_reapplied") {
      const opened = openedByRestoreId.get(entry.restoreId);
      const source = priorByHash.get(entry.sourceControlEntryHash);
      const reapplied = reappliedByRestoreId.get(entry.restoreId) ?? new Set();
      if (
        opened === undefined ||
        (source?.kind !== "hold_applied" &&
          source?.kind !== "restriction_applied") ||
        !opened.reapplication.requiredControlEntryHashes.includes(
          entry.sourceControlEntryHash
        ) ||
        !sameTarget(opened.target, entry.target) ||
        !sameTarget(source.target, entry.target) ||
        !sameControl(source.control, entry.control) ||
        reapplied.has(entry.sourceControlEntryHash)
      ) {
        addIssue(
          context,
          ["entries", index],
          "Control reapplication requires one requested prior control for the exact restore target."
        );
      } else {
        reapplied.add(entry.sourceControlEntryHash);
        reappliedByRestoreId.set(entry.restoreId, reapplied);
      }
    } else if (entry.kind === "restore_sealed") {
      const opened = openedByRestoreId.get(entry.restoreId);
      const reapplied = [
        ...(reappliedByRestoreId.get(entry.restoreId) ?? new Set<string>())
      ].sort((left, right) => left.localeCompare(right));
      if (
        opened === undefined ||
        sealedRestoreIds.has(entry.restoreId) ||
        opened.sourceErasureEntryHash !== entry.sourceErasureEntryHash ||
        !sameTarget(opened.target, entry.target) ||
        !sameStringArray(
          opened.reapplication.requiredControlEntryHashes,
          entry.reapplication.requiredControlEntryHashes
        ) ||
        !sameStringArray(
          reapplied,
          entry.reapplication.reappliedControlEntryHashes
        )
      ) {
        addIssue(
          context,
          ["entries", index],
          "Restore sealing requires the exact opened restore and every requested control reapplication."
        );
      } else {
        sealedRestoreIds.add(entry.restoreId);
      }
    }
    priorByHash.set(entry.entryHash, entry);
  }
}

function sameTarget(
  left: z.infer<typeof inboxV2ErasureRestoreTargetSchema>,
  right: z.infer<typeof inboxV2ErasureRestoreTargetSchema>
): boolean {
  return (
    left.root.tenantId === right.root.tenantId &&
    left.root.dataClassId === right.root.dataClassId &&
    left.root.storageRootId === right.root.storageRootId &&
    left.root.recordId === right.root.recordId &&
    left.entity.tenantId === right.entity.tenantId &&
    left.entity.entityTypeId === right.entity.entityTypeId &&
    left.entity.entityId === right.entity.entityId &&
    left.entityRevision === right.entityRevision &&
    left.lineageRevision === right.lineageRevision
  );
}

function sameControl(
  left: z.infer<typeof inboxV2ErasureRestoreControlReferenceSchema>,
  right: z.infer<typeof inboxV2ErasureRestoreControlReferenceSchema>
): boolean {
  if (left.kind !== right.kind) return false;
  return left.kind === "legal_hold" && right.kind === "legal_hold"
    ? left.hold.tenantId === right.hold.tenantId &&
        left.hold.holdId === right.hold.holdId &&
        left.hold.revision === right.hold.revision
    : left.kind === "processing_restriction" &&
        right.kind === "processing_restriction" &&
        left.restriction.tenantId === right.restriction.tenantId &&
        left.restriction.restrictionId === right.restriction.restrictionId &&
        left.restriction.revision === right.restriction.revision;
}

function sameStringArray(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function addCanonicalUniqueIssue(
  context: z.RefinementCtx,
  values: readonly string[],
  label: string
): void {
  const sorted = [...values].sort((left, right) => left.localeCompare(right));
  if (
    new Set(values).size !== values.length ||
    values.some((value, index) => value !== sorted[index])
  ) {
    addIssue(context, [], `${label} must be unique and canonically sorted.`);
  }
}

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child, seen);
  }
  return Object.freeze(value);
}
