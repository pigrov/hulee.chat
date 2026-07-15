import { z } from "zod";

import {
  inboxV2ErasureRestoreLedgerEntrySchema,
  inboxV2RestoreIdSchema,
  type InboxV2ErasureRestoreLedgerEntry
} from "./erasure-restore-ledger";
import { inboxV2EntityRevisionSchema } from "./entity-metadata";
import { calculateInboxV2CanonicalSha256 } from "./recipient-sync-hash";

export const inboxV2ErasureRestoreLeaseTokenSchema = z
  .string()
  .min(32)
  .max(512)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._~:-]*$/u);

/**
 * Persistence-only restore capability. It is deliberately excluded from the
 * canonical ledger entry hash: the database stores only its digest and uses
 * the expected revisions as a short-lived CAS fence.
 */
export const inboxV2ErasureRestoreAppendFenceSchema = z.discriminatedUnion(
  "operation",
  [
    z
      .object({
        operation: z.literal("open_restore"),
        restoreId: inboxV2RestoreIdSchema,
        leaseToken: inboxV2ErasureRestoreLeaseTokenSchema,
        leaseDurationSeconds: z.number().int().min(1).max(300)
      })
      .strict(),
    z
      .object({
        operation: z.literal("reapply_control"),
        restoreId: inboxV2RestoreIdSchema,
        leaseToken: inboxV2ErasureRestoreLeaseTokenSchema,
        expectedHeadRevision: inboxV2EntityRevisionSchema,
        expectedLeaseRevision: inboxV2EntityRevisionSchema
      })
      .strict(),
    z
      .object({
        operation: z.literal("seal_restore"),
        restoreId: inboxV2RestoreIdSchema,
        leaseToken: inboxV2ErasureRestoreLeaseTokenSchema,
        expectedHeadRevision: inboxV2EntityRevisionSchema,
        expectedLeaseRevision: inboxV2EntityRevisionSchema
      })
      .strict()
  ]
);

export type InboxV2ErasureRestoreAppendFence = z.infer<
  typeof inboxV2ErasureRestoreAppendFenceSchema
>;

const persistedEntryResultShape = {
  entry: inboxV2ErasureRestoreLedgerEntrySchema
} as const;

export const inboxV2ErasureRestoreLedgerAppendResultSchema =
  z.discriminatedUnion("outcome", [
    z
      .object({ outcome: z.literal("applied"), ...persistedEntryResultShape })
      .strict(),
    z
      .object({
        outcome: z.literal("already_applied"),
        ...persistedEntryResultShape
      })
      .strict(),
    z
      .object({
        outcome: z.literal("not_found"),
        subject: z.enum([
          "registry",
          "governance_context",
          "effective_policy",
          "activation",
          "storage_root",
          "deletion_run",
          "control",
          "restore",
          "restore_lease"
        ])
      })
      .strict(),
    z
      .object({
        outcome: z.literal("conflict"),
        facet: z.enum([
          "entry_id",
          "sequence",
          "previous_entry_hash",
          "high_water",
          "occurred_at",
          "authority",
          "target",
          "restore_chain",
          "restore_head",
          "restore_lease",
          "control_set",
          "control_state",
          "scope_ambiguous"
        ])
      })
      .strict()
  ]);

export type InboxV2ErasureRestoreLedgerAppendResult = z.infer<
  typeof inboxV2ErasureRestoreLedgerAppendResultSchema
>;

export interface InboxV2ErasureRestoreLedgerRepository {
  append(
    entry: Readonly<InboxV2ErasureRestoreLedgerEntry>,
    restoreFence?: Readonly<InboxV2ErasureRestoreAppendFence>
  ): Promise<InboxV2ErasureRestoreLedgerAppendResult>;
}

const authenticErasureRestoreLedgerRepositories = new WeakSet<object>();

/** Trusted composition-root registration for the durable append-only ledger. */
export function defineInboxV2ErasureRestoreLedgerRepository(
  repository: InboxV2ErasureRestoreLedgerRepository
): InboxV2ErasureRestoreLedgerRepository {
  if (typeof repository.append !== "function") {
    throw new Error("Erasure/restore ledger repository is invalid.");
  }
  const registered = Object.freeze({ append: repository.append });
  authenticErasureRestoreLedgerRepositories.add(registered);
  return registered;
}

export function isInboxV2ErasureRestoreLedgerRepository(
  value: unknown
): value is InboxV2ErasureRestoreLedgerRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    authenticErasureRestoreLedgerRepositories.has(value)
  );
}

export async function appendInboxV2ErasureRestoreLedgerEntry(input: {
  repository: InboxV2ErasureRestoreLedgerRepository;
  entry: z.input<typeof inboxV2ErasureRestoreLedgerEntrySchema>;
  restoreFence?: z.input<typeof inboxV2ErasureRestoreAppendFenceSchema>;
}): Promise<InboxV2ErasureRestoreLedgerAppendResult> {
  if (!authenticErasureRestoreLedgerRepositories.has(input.repository)) {
    throw new Error(
      "Erasure/restore append requires the registered durable repository."
    );
  }
  const entry = inboxV2ErasureRestoreLedgerEntrySchema.parse(input.entry);
  const restoreFence = parseRestoreFence(entry, input.restoreFence);
  const result = inboxV2ErasureRestoreLedgerAppendResultSchema.parse(
    restoreFence === undefined
      ? await input.repository.append(entry)
      : await input.repository.append(entry, restoreFence)
  );
  if (
    (result.outcome === "applied" || result.outcome === "already_applied") &&
    !sameEntry(result.entry, entry)
  ) {
    throw new Error(
      "Erasure/restore repository returned a different persisted entry."
    );
  }
  return deepFreeze(result);
}

export function calculateInboxV2ErasureRestoreLeaseTokenHash(
  leaseToken: string
): string {
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.erasure-restore-lease-token",
    hashVersion: "v1",
    leaseToken: inboxV2ErasureRestoreLeaseTokenSchema.parse(leaseToken)
  });
}

function parseRestoreFence(
  entry: InboxV2ErasureRestoreLedgerEntry,
  input: z.input<typeof inboxV2ErasureRestoreAppendFenceSchema> | undefined
): InboxV2ErasureRestoreAppendFence | undefined {
  const expectedOperation =
    entry.kind === "restore_opened"
      ? "open_restore"
      : entry.kind === "control_reapplied"
        ? "reapply_control"
        : entry.kind === "restore_sealed"
          ? "seal_restore"
          : null;
  if (expectedOperation === null) {
    if (input !== undefined) {
      throw new Error("A restore fence is valid only for restore mutations.");
    }
    return undefined;
  }
  const restoreId =
    entry.kind === "restore_opened" ||
    entry.kind === "control_reapplied" ||
    entry.kind === "restore_sealed"
      ? entry.restoreId
      : null;
  if (input === undefined) {
    throw new Error(
      "A restore mutation requires its database CAS lease fence."
    );
  }
  const fence = inboxV2ErasureRestoreAppendFenceSchema.parse(input);
  if (fence.operation !== expectedOperation || fence.restoreId !== restoreId) {
    throw new Error("The restore fence must bind the exact restore operation.");
  }
  return fence;
}

function sameEntry(
  left: InboxV2ErasureRestoreLedgerEntry,
  right: InboxV2ErasureRestoreLedgerEntry
): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.ledgerId === right.ledgerId &&
    left.sequence === right.sequence &&
    left.entryHash === right.entryHash
  );
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
