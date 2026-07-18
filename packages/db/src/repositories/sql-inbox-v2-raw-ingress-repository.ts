import {
  INBOX_V2_RAW_ADMISSION_PURPOSE_ID,
  assertInboxV2SanitizedRawIngressCandidate,
  calculateInboxV2BytesSha256,
  calculateInboxV2CanonicalSha256,
  calculateInboxV2RawIngressLeaseTokenHash,
  inboxV2ClaimRawIngressInputSchema,
  inboxV2ClaimRawIngressResultSchema,
  inboxV2AuthorizeRawAdmissionInputSchema,
  inboxV2EntityRevisionSchema,
  inboxV2LoadPendingRawAdmissionInputSchema,
  inboxV2LoadPendingRawAdmissionResultSchema,
  inboxV2NamespacedIdSchema,
  inboxV2RawInboundEventIdSchema,
  inboxV2RawIngressLeaseTokenSchema,
  inboxV2RawAdmissionAuthorizationDecisionSchema,
  inboxV2RawAdmissionSkeletonHandoffInputSchema,
  inboxV2RawAdmissionSkeletonHandoffResultSchema,
  inboxV2RawAdmissionSealedSkeletonInputSchema,
  inboxV2RawIngressWorkItemSchema,
  inboxV2RecordRawIngressResultSchema,
  inboxV2ReleaseRawIngressLeaseInputSchema,
  inboxV2ReleaseRawIngressLeaseResultSchema,
  inboxV2RenewRawIngressLeaseInputSchema,
  inboxV2RenewRawIngressLeaseResultSchema,
  inboxV2Sha256DigestSchema,
  inboxV2TimestampSchema,
  type InboxV2ClaimRawIngressInput,
  type InboxV2ClaimRawIngressResult,
  type InboxV2AuthorizeRawAdmissionInput,
  type InboxV2LoadPendingRawAdmissionInput,
  type InboxV2LoadPendingRawAdmissionResult,
  type InboxV2RawAdmissionAuthorityPort,
  type InboxV2RawAdmissionAuthorizationDecision,
  type InboxV2RawAdmissionIdentityCandidate,
  type InboxV2RawAdmissionPreflightPort,
  type InboxV2RawAdmissionSkeletonHandoffInput,
  type InboxV2RawAdmissionSkeletonHandoffResult,
  type InboxV2RawIngressRepositoryPort,
  type InboxV2RawIngressWorkItem,
  type InboxV2RecordRawIngressResult,
  type InboxV2ReleaseRawIngressLeaseInput,
  type InboxV2ReleaseRawIngressLeaseResult,
  type InboxV2RenewRawIngressLeaseInput,
  type InboxV2RenewRawIngressLeaseResult,
  type InboxV2SanitizedRawIngressCandidate
} from "@hulee/contracts";
import { randomBytes, randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import type { RawSqlExecutor } from "./sql-outbox-repository";

const RAW_INGRESS_TRANSACTION_CONFIG = {
  isolationLevel: "read committed"
} as const;
const RAW_INGRESS_TRANSACTION_ATTEMPTS = 3;
const RETRYABLE_SQLSTATES = new Set(["40001", "40P01"]);
const SQLSTATE_CAUSE_DEPTH_LIMIT = 8;
const SAFE_ENVELOPE_SCHEMA_ID = "core:raw-ingress-safe-envelope";
const SAFE_ENVELOPE_SCHEMA_VERSION = "v1";
const ALLOWED_HEADERS_SCHEMA_ID = "core:raw-ingress-allowed-headers";
const ALLOWED_HEADERS_SCHEMA_VERSION = "v1";
const RAW_ADMISSION_LOCK_DOMAIN = "inbox-v2:raw-admission:v1";

export type InboxV2RawIngressTransactionExecutor = RawSqlExecutor & {
  transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>,
    config?: Readonly<{ isolationLevel: "read committed" }>
  ): Promise<TResult>;
};

export type InboxV2RawIngressIdempotencyScope = Readonly<{
  tenantId: string;
  sourceConnectionId: string;
  sourceAccountId: string | null;
  transport: string;
  eventIdentityKind: string;
  eventIdentityDigestSha256: string;
}>;

export type InboxV2RawIngressIdempotencyKeyDigestSource = (
  scope: InboxV2RawIngressIdempotencyScope
) => string;
export type InboxV2RawIngressLeaseTokenSource = (
  count: number
) => readonly string[];
export type InboxV2RawIngressRawEventIdSource = () => string;
export type InboxV2RawIngressQuarantineIdSource = () => string;

export type CreateSqlInboxV2RawIngressRepositoryOptions = Readonly<{
  rawEventIdSource?: InboxV2RawIngressRawEventIdSource;
  quarantineIdSource?: InboxV2RawIngressQuarantineIdSource;
  leaseTokenSource?: InboxV2RawIngressLeaseTokenSource;
  idempotencyKeyDigestSource?: InboxV2RawIngressIdempotencyKeyDigestSource;
}>;

export type CreateProductionSqlInboxV2RawIngressRepositoryOptions = Readonly<
  Omit<
    CreateSqlInboxV2RawIngressRepositoryOptions,
    "idempotencyKeyDigestSource"
  > & {
    admissionAuthority: InboxV2RawAdmissionAuthorityPort;
  }
>;

export type ProductionSqlInboxV2RawIngressRepository =
  InboxV2RawIngressRepositoryPort & InboxV2RawAdmissionPreflightPort;

type PreparedCandidate = Readonly<{
  candidate: InboxV2SanitizedRawIngressCandidate;
  sourceAccountScopeKey: string;
  eventIdentityDigestSha256: string;
  idempotencyKey: string;
  idempotencyKeyDigestSha256: string;
  persistedSafeEnvelopeDigest: string;
  admission: Readonly<{
    writeCandidate: InboxV2RawAdmissionIdentityCandidate;
    candidates: readonly InboxV2RawAdmissionIdentityCandidate[];
    guaranteeUntil: string;
  }> | null;
}>;

type AcceptedEvidence = Readonly<{
  payloadContent: Readonly<Record<string, unknown>>;
  payloadDigest: string;
  headerContent: Readonly<Record<string, unknown>> | null;
  headerDigest: string | null;
}>;

type IdRow = { id: unknown };
type ExistingRawIngressRow = {
  tenant_id: unknown;
  raw_event_id: unknown;
  source_connection_id: unknown;
  source_account_id: unknown;
  source_account_scope_key: unknown;
  transport_kind: unknown;
  event_identity_kind: unknown;
  event_identity_digest_sha256: unknown;
  safe_envelope_digest_sha256: unknown;
  sanitizer_id: unknown;
  sanitizer_version: unknown;
  sanitizer_declaration_revision: unknown;
};

type RawQuarantineReceiptRow = {
  id: unknown;
  tenant_id: unknown;
  source_connection_id: unknown;
  source_account_id: unknown;
};

type RawAdmissionRow = ExistingRawIngressRow & {
  tenant_id: unknown;
  purpose_id: unknown;
  key_generation: unknown;
  hmac_key_secret_ref: unknown;
  identity_hmac_sha256: unknown;
  identity_kind: unknown;
  source_account_id: unknown;
  raw_event_id: unknown;
  guarantee_until: unknown;
  state: unknown;
  terminal_skeleton_id: unknown;
  terminal_outcome_hmac_sha256: unknown;
  skeleton_handed_off_at: unknown;
  revision: unknown;
  db_now?: unknown;
};

type RawAdmissionKeyRow = {
  generation: unknown;
  secret_ref: unknown;
  state: unknown;
  activated_at: unknown;
  use_until: unknown;
  guarantee_not_after: unknown;
  verify_until: unknown;
  is_write: unknown;
  db_now: unknown;
};

type RawWorkRow = {
  tenant_id: unknown;
  raw_event_id: unknown;
  state: unknown;
  available_at: unknown;
  attempt_count: unknown;
  lease_owner_id: unknown;
  lease_token_hash: unknown;
  lease_revision: unknown;
  lease_claimed_at: unknown;
  lease_expires_at: unknown;
  reclaim_count: unknown;
  last_reclaimed_at: unknown;
  last_reclaimed_from_expires_at: unknown;
  last_reclaimed_lease_owner_id: unknown;
  last_reclaimed_lease_token_hash: unknown;
  last_reclaimed_lease_revision: unknown;
  revision: unknown;
  created_at: unknown;
  updated_at: unknown;
};

type ClaimedRawWorkRow = RawWorkRow & {
  previous_state: unknown;
  previous_lease_owner_id: unknown;
  previous_lease_revision: unknown;
  previous_lease_claimed_at: unknown;
  previous_lease_expires_at: unknown;
  claim_ordinal: unknown;
};

type LockedRawWorkRow = RawWorkRow & { db_now: unknown };

export class InboxV2RawIngressPersistenceInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InboxV2RawIngressPersistenceInvariantError";
  }
}

/**
 * N-1 compatibility/test factory. It preserves the pre-SRC-008 unkeyed SHA
 * identity path and must not be used by a production composition root.
 * @deprecated Use createProductionSqlInboxV2RawIngressRepository in runtime.
 */
export function createSqlInboxV2RawIngressRepository(
  executor: InboxV2RawIngressTransactionExecutor | HuleeDatabase,
  options: CreateSqlInboxV2RawIngressRepositoryOptions = {}
): InboxV2RawIngressRepositoryPort {
  const transactionExecutor =
    executor as unknown as InboxV2RawIngressTransactionExecutor;
  const rawEventIdSource = options.rawEventIdSource ?? defaultRawEventIdSource;
  const quarantineIdSource =
    options.quarantineIdSource ?? defaultQuarantineIdSource;
  const leaseTokenSource = options.leaseTokenSource ?? defaultLeaseTokenSource;
  const idempotencyKeyDigestSource =
    options.idempotencyKeyDigestSource ?? defaultIdempotencyKeyDigestSource;

  return Object.freeze({
    async record(rawCandidate: Readonly<InboxV2SanitizedRawIngressCandidate>) {
      const candidate = assertInboxV2SanitizedRawIngressCandidate(rawCandidate);
      const prepared = prepareCandidate(candidate, idempotencyKeyDigestSource);
      const quarantineId =
        inboxV2NamespacedIdSchema.parse(quarantineIdSource());

      if (candidate.disposition.outcome === "quarantined") {
        const reasonCode = candidate.disposition.reasonCode;
        return runRawIngressTransaction(transactionExecutor, (transaction) =>
          persistSanitizerQuarantine(transaction, {
            prepared,
            quarantineId,
            reasonCode
          })
        );
      }

      const rawEventId =
        inboxV2RawInboundEventIdSchema.parse(rawEventIdSource());
      const evidence = prepareAcceptedEvidence(candidate);
      return runRawIngressTransaction(transactionExecutor, (transaction) =>
        recordAcceptedCandidate(transaction, {
          prepared,
          evidence,
          rawEventId,
          quarantineId
        })
      );
    },

    async claim(rawInput: Readonly<InboxV2ClaimRawIngressInput>) {
      const input = inboxV2ClaimRawIngressInputSchema.parse(rawInput);
      const tokens = createClaimTokens(leaseTokenSource, input.batchSize);
      return runRawIngressTransaction(
        transactionExecutor,
        async (transaction) => {
          const result = await transaction.execute<ClaimedRawWorkRow>(
            buildClaimInboxV2RawIngressSql(
              input,
              tokens.map((token) => token.tokenHash)
            )
          );
          return mapClaimResult(input, tokens, result.rows);
        }
      );
    },

    async renewLease(rawInput: Readonly<InboxV2RenewRawIngressLeaseInput>) {
      const input = inboxV2RenewRawIngressLeaseInputSchema.parse(rawInput);
      const tokenHash = calculateInboxV2RawIngressLeaseTokenHash(
        input.leaseToken
      );
      return runRawIngressTransaction(
        transactionExecutor,
        async (transaction) => {
          const locked = await lockAndClassifyLease(
            transaction,
            input,
            tokenHash
          );
          if (locked.kind === "result") return locked.result;

          const result = await transaction.execute<RawWorkRow>(
            buildRenewInboxV2RawIngressLeaseSql({
              input,
              tokenHash,
              dbNow: locked.dbNow,
              expectedWorkRevision: locked.work.revision
            })
          );
          const row = exactlyOneRow(result.rows, "raw-ingress lease renewal");
          return inboxV2RenewRawIngressLeaseResultSchema.parse({
            outcome: "renewed",
            work: mapRawWorkRow(input.tenantId, input.rawEventId, row)
          });
        }
      );
    },

    async releaseLease(rawInput: Readonly<InboxV2ReleaseRawIngressLeaseInput>) {
      const input = inboxV2ReleaseRawIngressLeaseInputSchema.parse(rawInput);
      const tokenHash = calculateInboxV2RawIngressLeaseTokenHash(
        input.leaseToken
      );
      return runRawIngressTransaction(
        transactionExecutor,
        async (transaction) => {
          const locked = await lockAndClassifyLease(
            transaction,
            input,
            tokenHash
          );
          if (locked.kind === "result") {
            return asReleaseFailure(locked.result);
          }

          const result = await transaction.execute<RawWorkRow>(
            buildReleaseInboxV2RawIngressLeaseSql({
              input,
              tokenHash,
              dbNow: locked.dbNow,
              expectedWorkRevision: locked.work.revision
            })
          );
          const row = exactlyOneRow(result.rows, "raw-ingress lease release");
          return inboxV2ReleaseRawIngressLeaseResultSchema.parse({
            outcome: "released",
            work: mapRawWorkRow(input.tenantId, input.rawEventId, row)
          });
        }
      );
    }
  });
}

export function createCompatibilitySqlInboxV2RawIngressRepository(
  executor: InboxV2RawIngressTransactionExecutor | HuleeDatabase,
  options: CreateSqlInboxV2RawIngressRepositoryOptions = {}
): InboxV2RawIngressRepositoryPort {
  return createSqlInboxV2RawIngressRepository(executor, options);
}

/** Production raw admission fails closed unless a tenant/purpose key is live. */
export function createProductionSqlInboxV2RawIngressRepository(
  executor: InboxV2RawIngressTransactionExecutor | HuleeDatabase,
  options: CreateProductionSqlInboxV2RawIngressRepositoryOptions
): ProductionSqlInboxV2RawIngressRepository {
  const transactionExecutor =
    executor as unknown as InboxV2RawIngressTransactionExecutor;
  const compatibility = createSqlInboxV2RawIngressRepository(executor, {
    rawEventIdSource: options.rawEventIdSource,
    quarantineIdSource: options.quarantineIdSource,
    leaseTokenSource: options.leaseTokenSource
  });
  const rawEventIdSource = options.rawEventIdSource ?? defaultRawEventIdSource;
  const quarantineIdSource =
    options.quarantineIdSource ?? defaultQuarantineIdSource;

  return Object.freeze({
    async record(rawCandidate: Readonly<InboxV2SanitizedRawIngressCandidate>) {
      const candidate = assertInboxV2SanitizedRawIngressCandidate(rawCandidate);
      const authorizationInput = inboxV2AuthorizeRawAdmissionInputSchema.parse({
        source: {
          tenantId: candidate.tenantId,
          sourceConnectionId: candidate.sourceConnectionId,
          sourceAccountId: candidate.sourceAccountId
        },
        identityKind: candidate.eventIdentity.kind,
        purposeId: INBOX_V2_RAW_ADMISSION_PURPOSE_ID,
        identityMaterial: candidate.eventIdentity.value,
        safeEnvelopeMaterialDigest: candidate.safeEnvelopeDigest
      });
      const decision = inboxV2RawAdmissionAuthorizationDecisionSchema.parse(
        await options.admissionAuthority.authorizeRawAdmission(
          authorizationInput
        )
      );
      if (
        decision.outcome === "rejected" ||
        !rawAdmissionDecisionMatchesInput(decision, authorizationInput)
      ) {
        return inboxV2RecordRawIngressResultSchema.parse({
          outcome: "key_unavailable"
        });
      }

      const prepared = prepareProductionCandidate(candidate, decision);
      const quarantineId =
        inboxV2NamespacedIdSchema.parse(quarantineIdSource());
      return runRawIngressTransaction(
        transactionExecutor,
        async (transaction) => {
          const keyStateAvailable = await lockAndValidateRawAdmissionKeys(
            transaction,
            prepared
          );
          if (!keyStateAvailable) {
            return inboxV2RecordRawIngressResultSchema.parse({
              outcome: "key_unavailable"
            });
          }

          if (candidate.disposition.outcome === "quarantined") {
            return persistSanitizerQuarantine(transaction, {
              prepared,
              quarantineId,
              reasonCode: candidate.disposition.reasonCode
            });
          }

          const rawEventId =
            inboxV2RawInboundEventIdSchema.parse(rawEventIdSource());
          return recordProductionAcceptedCandidate(transaction, {
            prepared,
            evidence: prepareAcceptedEvidence(candidate),
            rawEventId,
            quarantineId
          });
        }
      );
    },
    claim: compatibility.claim,
    renewLease: compatibility.renewLease,
    releaseLease: compatibility.releaseLease,
    async loadPendingDedupeAdmission(
      input: Readonly<InboxV2LoadPendingRawAdmissionInput>
    ) {
      return loadPendingInboxV2RawDedupeAdmission(executor, input);
    }
  });
}

/**
 * Bounded preflight read. Call this before invoking KMS/crypto authority; it
 * never locks a row and never exposes the original provider identity.
 */
export async function loadPendingInboxV2RawDedupeAdmission(
  executor: RawSqlExecutor | HuleeDatabase,
  rawInput: Readonly<InboxV2LoadPendingRawAdmissionInput>
): Promise<InboxV2LoadPendingRawAdmissionResult> {
  const input = inboxV2LoadPendingRawAdmissionInputSchema.parse(rawInput);
  const result = await (executor as RawSqlExecutor).execute<RawAdmissionRow>(
    buildLoadPendingInboxV2RawDedupeAdmissionSql(input)
  );
  if (result.rows.length === 0) {
    return inboxV2LoadPendingRawAdmissionResultSchema.parse({
      outcome: "not_found"
    });
  }
  if (result.rows.length !== 1) {
    return inboxV2LoadPendingRawAdmissionResultSchema.parse({
      outcome: "integrity_failure"
    });
  }
  const row = result.rows[0]!;
  if (stringValue(row.state, "raw admission state") !== "skeleton_pending") {
    return inboxV2LoadPendingRawAdmissionResultSchema.parse({
      outcome: "not_pending"
    });
  }
  if (
    Date.parse(
      timestampValue(row.guarantee_until, "raw admission guarantee")
    ) <= Date.parse(timestampValue(row.db_now, "raw admission DB clock"))
  ) {
    return inboxV2LoadPendingRawAdmissionResultSchema.parse({
      outcome: "guarantee_expired"
    });
  }
  return inboxV2LoadPendingRawAdmissionResultSchema.parse({
    outcome: "pending",
    snapshot: mapRawAdmissionSealedSkeleton(row)
  });
}

/**
 * Transaction-local CAS handoff. The terminal apply path must call this and
 * insert the returned sealed skeleton using the same transaction/executor.
 */
export async function handoffInboxV2RawAdmissionSkeletonInTransaction(
  transaction: RawSqlExecutor,
  rawInput: Readonly<InboxV2RawAdmissionSkeletonHandoffInput>
): Promise<InboxV2RawAdmissionSkeletonHandoffResult> {
  const input = inboxV2RawAdmissionSkeletonHandoffInputSchema.parse(rawInput);
  const locked = await transaction.execute<RawAdmissionRow>(
    buildLockInboxV2RawAdmissionForHandoffSql(input)
  );
  if (locked.rows.length === 0) {
    return inboxV2RawAdmissionSkeletonHandoffResultSchema.parse({
      outcome: "not_found"
    });
  }
  if (locked.rows.length !== 1) {
    return inboxV2RawAdmissionSkeletonHandoffResultSchema.parse({
      outcome: "integrity_failure"
    });
  }

  const row = locked.rows[0]!;
  const revision = bigintText(row.revision);
  const state = stringValue(row.state, "raw admission state");
  if (state === "skeleton_handed_off") {
    const handedOffAt = timestampValue(
      row.skeleton_handed_off_at,
      "raw admission skeleton handoff"
    );
    if (
      revision ===
        inboxV2EntityRevisionSchema.parse(
          (BigInt(input.expectedAdmissionRevision) + 1n).toString()
        ) &&
      handedOffAt === input.handedOffAt &&
      stringValue(
        row.terminal_skeleton_id,
        "raw admission terminal skeleton"
      ) === input.terminalSkeletonId &&
      stringValue(
        row.terminal_outcome_hmac_sha256,
        "raw admission terminal outcome HMAC"
      ) === input.terminalOutcomeHmacSha256
    ) {
      return inboxV2RawAdmissionSkeletonHandoffResultSchema.parse({
        outcome: "already_handed_off",
        handedOffAt,
        terminalSkeletonId: input.terminalSkeletonId,
        terminalOutcomeHmacSha256: input.terminalOutcomeHmacSha256,
        sealedSkeleton: mapRawAdmissionSealedSkeleton(
          row,
          input.expectedAdmissionRevision
        )
      });
    }
    return inboxV2RawAdmissionSkeletonHandoffResultSchema.parse({
      outcome: "revision_conflict"
    });
  }
  if (
    state !== "skeleton_pending" ||
    revision !== input.expectedAdmissionRevision
  ) {
    return inboxV2RawAdmissionSkeletonHandoffResultSchema.parse({
      outcome: "revision_conflict"
    });
  }
  if (
    Date.parse(input.handedOffAt) >=
      Date.parse(
        timestampValue(row.guarantee_until, "raw admission guarantee")
      ) ||
    Date.parse(timestampValue(row.db_now, "raw admission DB clock")) >=
      Date.parse(timestampValue(row.guarantee_until, "raw admission guarantee"))
  ) {
    return inboxV2RawAdmissionSkeletonHandoffResultSchema.parse({
      outcome: "guarantee_expired"
    });
  }

  const updated = await transaction.execute<RawAdmissionRow>(
    buildHandoffInboxV2RawAdmissionSkeletonSql(input)
  );
  if (updated.rows.length !== 1) {
    return inboxV2RawAdmissionSkeletonHandoffResultSchema.parse({
      outcome: "revision_conflict"
    });
  }
  return inboxV2RawAdmissionSkeletonHandoffResultSchema.parse({
    outcome: "handed_off",
    handedOffAt: input.handedOffAt,
    terminalSkeletonId: input.terminalSkeletonId,
    terminalOutcomeHmacSha256: input.terminalOutcomeHmacSha256,
    // The cryptographic authority sealed the pre-handoff snapshot. Preserve
    // that exact revision in the receipt even though the CAS increments the
    // persisted admission revision in the same transaction.
    sealedSkeleton: mapRawAdmissionSealedSkeleton(
      updated.rows[0]!,
      input.expectedAdmissionRevision
    )
  });
}

function mapRawAdmissionSealedSkeleton(
  row: RawAdmissionRow,
  admissionRevision = bigintText(row.revision)
) {
  return inboxV2RawAdmissionSealedSkeletonInputSchema.parse({
    source: {
      tenantId: stringValue(row.tenant_id, "raw admission tenant"),
      sourceConnectionId: stringValue(
        row.source_connection_id,
        "raw admission connection"
      ),
      sourceAccountId:
        row.source_account_id === null
          ? null
          : stringValue(row.source_account_id, "raw admission account")
    },
    rawEventId: stringValue(row.raw_event_id, "raw admission raw event"),
    identityKind: stringValue(row.identity_kind, "raw admission identity kind"),
    purposeId: stringValue(row.purpose_id, "raw admission purpose"),
    keyGeneration: stringValue(
      row.key_generation,
      "raw admission key generation"
    ),
    hmacKeySecretRef: stringValue(
      row.hmac_key_secret_ref,
      "raw admission key secret"
    ),
    identityHmacSha256: stringValue(
      row.identity_hmac_sha256,
      "raw admission identity HMAC"
    ),
    safeEnvelopeDigest: stringValue(
      row.safe_envelope_digest_sha256,
      "raw admission envelope digest"
    ),
    guaranteeUntil: timestampValue(
      row.guarantee_until,
      "raw admission guarantee"
    ),
    admissionRevision
  });
}

function rawAdmissionDecisionMatchesInput(
  decision: Extract<
    InboxV2RawAdmissionAuthorizationDecision,
    Readonly<{ outcome: "authorized" }>
  >,
  input: InboxV2AuthorizeRawAdmissionInput
): boolean {
  return (
    decision.source.tenantId === input.source.tenantId &&
    decision.source.sourceConnectionId === input.source.sourceConnectionId &&
    decision.source.sourceAccountId === input.source.sourceAccountId &&
    decision.identityKind === input.identityKind &&
    decision.purposeId === input.purposeId
  );
}

async function lockAndValidateRawAdmissionKeys(
  transaction: RawSqlExecutor,
  prepared: PreparedCandidate
): Promise<boolean> {
  if (prepared.admission === null) return false;
  await transaction.execute(
    buildLockInboxV2RawAdmissionCandidatesSql(prepared)
  );
  const result = await transaction.execute<RawAdmissionKeyRow>(
    buildValidateInboxV2RawAdmissionKeysSql(prepared)
  );
  if (result.rows.length !== prepared.admission.candidates.length) {
    return false;
  }

  const guaranteeUntil = Date.parse(prepared.admission.guaranteeUntil);
  let writeCandidateValid = false;
  for (const row of result.rows) {
    const dbNow = Date.parse(
      timestampValue(row.db_now, "raw admission DB clock")
    );
    const activatedAt = Date.parse(
      timestampValue(row.activated_at, "raw admission key activation")
    );
    const useUntil = Date.parse(
      timestampValue(row.use_until, "raw admission key use window")
    );
    const guaranteeNotAfter = Date.parse(
      timestampValue(
        row.guarantee_not_after,
        "raw admission key guarantee window"
      )
    );
    const verifyUntil = Date.parse(
      timestampValue(row.verify_until, "raw admission key verify window")
    );
    const state = stringValue(row.state, "raw admission key state");
    const isWrite = row.is_write === true || row.is_write === "true";
    if (
      !Number.isFinite(guaranteeUntil) ||
      guaranteeUntil <= dbNow ||
      activatedAt > dbNow ||
      verifyUntil <= dbNow ||
      guaranteeUntil > verifyUntil ||
      (state !== "active" && state !== "verify_only")
    ) {
      return false;
    }
    if (isWrite) {
      if (
        state !== "active" ||
        useUntil <= dbNow ||
        guaranteeUntil > guaranteeNotAfter
      ) {
        return false;
      }
      writeCandidateValid = true;
    }
  }
  return writeCandidateValid;
}

async function recordProductionAcceptedCandidate(
  transaction: RawSqlExecutor,
  input: Readonly<{
    prepared: PreparedCandidate;
    evidence: AcceptedEvidence;
    rawEventId: string;
    quarantineId: string;
  }>
): Promise<InboxV2RecordRawIngressResult> {
  const result = await transaction.execute<RawAdmissionRow>(
    buildLockExistingInboxV2RawAdmissionsSql(input.prepared)
  );
  if (result.rows.length === 0) {
    return recordAcceptedCandidate(transaction, input);
  }

  const first = result.rows[0]!;
  const rawEventId = stringValue(first.raw_event_id, "admitted raw event id");
  const safeEnvelopeDigest = stringValue(
    first.safe_envelope_digest_sha256,
    "admitted safe envelope digest"
  );
  for (const row of result.rows.slice(1)) {
    if (
      stringValue(row.raw_event_id, "admitted raw event id") !== rawEventId ||
      stringValue(
        row.safe_envelope_digest_sha256,
        "admitted safe envelope digest"
      ) !== safeEnvelopeDigest
    ) {
      throw invariantError(
        "Raw admission candidates resolved to divergent durable occurrences."
      );
    }
  }

  if (existingAdmittedRawIngressMatches(first, input.prepared)) {
    return inboxV2RecordRawIngressResultSchema.parse({
      outcome: "duplicate",
      source: sourceFromExistingRawIngress(first),
      rawEventId,
      safeEnvelopeDigest,
      matchedKeyGenerations: Array.from(
        new Set(
          result.rows.map((row) =>
            stringValue(row.key_generation, "matched raw admission generation")
          )
        )
      )
    });
  }

  return persistCollisionQuarantine(transaction, input, first);
}

async function recordAcceptedCandidate(
  transaction: RawSqlExecutor,
  input: Readonly<{
    prepared: PreparedCandidate;
    evidence: AcceptedEvidence;
    rawEventId: string;
    quarantineId: string;
  }>
): Promise<InboxV2RecordRawIngressResult> {
  const inserted = await transaction.execute<IdRow>(
    buildInsertInboxV2RawIngressAnchorSql(input)
  );
  if (inserted.rows.length > 1) {
    throw invariantError("Raw-ingress anchor insert returned multiple rows.");
  }

  if (inserted.rows.length === 1) {
    const returnedId = stringValue(inserted.rows[0]!.id, "raw event id");
    if (returnedId !== input.rawEventId) {
      throw invariantError("Raw-ingress anchor returned an unexpected id.");
    }
    await transaction.execute(buildInsertInboxV2RawIngressEnvelopeSql(input));
    await transaction.execute(
      buildInsertInboxV2RawIngressPayloadEvidenceSql(input)
    );
    if (input.evidence.headerContent !== null) {
      await transaction.execute(
        buildInsertInboxV2RawIngressHeaderEvidenceSql(input)
      );
    }
    const workResult = await transaction.execute<RawWorkRow>(
      buildInsertInboxV2RawIngressWorkSql(input)
    );
    const work = mapRawWorkRow(
      input.prepared.candidate.tenantId,
      input.rawEventId,
      exactlyOneRow(workResult.rows, "raw-ingress initial work insert")
    );
    if (input.prepared.admission !== null) {
      await transaction.execute(
        buildInsertInboxV2RawAdmissionSql({
          prepared: input.prepared,
          rawEventId: input.rawEventId
        })
      );
    }
    await transaction.execute(sql.raw("set constraints all immediate"));
    return inboxV2RecordRawIngressResultSchema.parse({
      outcome: "recorded",
      source: sourceFromCandidate(input.prepared.candidate),
      rawEventId: input.rawEventId,
      safeEnvelopeDigest: input.prepared.persistedSafeEnvelopeDigest,
      work
    });
  }

  const existingResult = await transaction.execute<ExistingRawIngressRow>(
    buildLockExistingInboxV2RawIngressSql(input.prepared)
  );
  const existing = exactlyOneRow(
    existingResult.rows,
    "raw-ingress idempotency conflict lookup"
  );
  if (existingRawIngressMatches(existing, input.prepared)) {
    return inboxV2RecordRawIngressResultSchema.parse({
      outcome: "already_recorded",
      source: sourceFromExistingRawIngress(existing),
      rawEventId: stringValue(existing.raw_event_id, "existing raw event id"),
      safeEnvelopeDigest: input.prepared.persistedSafeEnvelopeDigest
    });
  }

  return persistCollisionQuarantine(transaction, input, existing);
}

async function persistSanitizerQuarantine(
  transaction: RawSqlExecutor,
  input: Readonly<{
    prepared: PreparedCandidate;
    quarantineId: string;
    reasonCode: Exclude<
      InboxV2SanitizedRawIngressCandidate["disposition"],
      Readonly<{ outcome: "accepted" }>
    >["reasonCode"];
  }>
): Promise<InboxV2RecordRawIngressResult> {
  const fingerprint = calculateQuarantineFingerprint({
    prepared: input.prepared,
    reasonCode: input.reasonCode,
    existing: null
  });
  const quarantine = await insertOrLoadQuarantine(transaction, {
    prepared: input.prepared,
    quarantineId: input.quarantineId,
    reasonCode: input.reasonCode,
    fingerprint,
    existing: null
  });
  return inboxV2RecordRawIngressResultSchema.parse({
    outcome: "quarantined",
    source: sourceFromQuarantineReceipt(quarantine),
    quarantineId: inboxV2NamespacedIdSchema.parse(
      stringValue(quarantine.id, "raw-ingress quarantine id")
    ),
    existingRawEventId: null,
    safeEnvelopeDigest: input.prepared.persistedSafeEnvelopeDigest,
    reasonCode: input.reasonCode
  });
}

async function persistCollisionQuarantine(
  transaction: RawSqlExecutor,
  input: Readonly<{
    prepared: PreparedCandidate;
    evidence: AcceptedEvidence;
    rawEventId: string;
    quarantineId: string;
  }>,
  existing: ExistingRawIngressRow
): Promise<InboxV2RecordRawIngressResult> {
  const fingerprint = calculateQuarantineFingerprint({
    prepared: input.prepared,
    reasonCode: "source.idempotency_collision",
    existing
  });
  const quarantine = await insertOrLoadQuarantine(transaction, {
    prepared: input.prepared,
    quarantineId: input.quarantineId,
    reasonCode: "source.idempotency_collision",
    fingerprint,
    existing
  });
  return inboxV2RecordRawIngressResultSchema.parse({
    outcome: "quarantined",
    source: sourceFromQuarantineReceipt(quarantine),
    quarantineId: inboxV2NamespacedIdSchema.parse(
      stringValue(quarantine.id, "raw-ingress quarantine id")
    ),
    existingRawEventId: stringValue(
      existing.raw_event_id,
      "collision existing raw event id"
    ),
    safeEnvelopeDigest: input.prepared.persistedSafeEnvelopeDigest,
    reasonCode: "source.idempotency_collision"
  });
}

async function insertOrLoadQuarantine(
  transaction: RawSqlExecutor,
  input: Parameters<typeof buildInsertInboxV2RawIngressQuarantineSql>[0]
): Promise<RawQuarantineReceiptRow> {
  const inserted = await transaction.execute<RawQuarantineReceiptRow>(
    buildInsertInboxV2RawIngressQuarantineSql(input)
  );
  if (inserted.rows.length > 1) {
    throw invariantError(
      "Raw-ingress quarantine insert returned multiple rows."
    );
  }
  if (inserted.rows[0] !== undefined) {
    inboxV2NamespacedIdSchema.parse(
      stringValue(inserted.rows[0].id, "raw-ingress quarantine id")
    );
    return inserted.rows[0];
  }
  const loaded = await transaction.execute<RawQuarantineReceiptRow>(
    buildFindInboxV2RawIngressQuarantineSql({
      tenantId: input.prepared.candidate.tenantId,
      fingerprint: input.fingerprint
    })
  );
  const row = exactlyOneRow(loaded.rows, "raw-ingress quarantine replay");
  inboxV2NamespacedIdSchema.parse(
    stringValue(row.id, "raw-ingress quarantine id")
  );
  return row;
}

function buildInsertInboxV2RawIngressAnchorSql(
  input: Readonly<{
    prepared: PreparedCandidate;
    rawEventId: string;
  }>
): SQL {
  const { candidate } = input.prepared;
  return sql`
    insert into public.raw_inbound_events (
      id, tenant_id, source_connection_id, source_account_id,
      external_event_id, event_signature, idempotency_key, received_at,
      provider_timestamp, payload, headers, processing_status, error_code,
      error_message, created_at, updated_at
    ) values (
      ${input.rawEventId}, ${candidate.tenantId}, ${candidate.sourceConnectionId},
      ${candidate.sourceAccountId}, null, null, ${input.prepared.idempotencyKey},
      ${candidate.receivedAt}::timestamptz,
      ${candidate.providerOccurredAt}::timestamptz,
      '{}'::jsonb, '{}'::jsonb, 'ignored', null, null,
      ${candidate.sanitizedAt}::timestamptz,
      ${candidate.sanitizedAt}::timestamptz
    )
    on conflict do nothing
    returning id
  `;
}

function buildInsertInboxV2RawIngressEnvelopeSql(
  input: Readonly<{
    prepared: PreparedCandidate;
    evidence: AcceptedEvidence;
    rawEventId: string;
  }>
): SQL {
  const { candidate } = input.prepared;
  return sql`
    insert into public.inbox_v2_source_raw_envelopes (
      tenant_id, raw_event_id, source_connection_id, source_account_id,
      source_account_scope_key, idempotency_key, transport_kind,
      event_identity_kind, event_identity_digest_sha256,
      safe_envelope_schema_id, safe_envelope_schema_version,
      safe_envelope_digest_sha256, sanitizer_id, sanitizer_version,
      sanitizer_declaration_revision, provider_payload_evidence_present,
      allowed_headers_evidence_present, data_class_id, sensitivity_class,
      processing_purpose_id, canonical_anchor_id, expiry_action, accepted_at,
      created_at
    ) values (
      ${candidate.tenantId}, ${input.rawEventId},
      ${candidate.sourceConnectionId}, ${candidate.sourceAccountId},
      ${input.prepared.sourceAccountScopeKey},
      ${input.prepared.idempotencyKey}, ${candidate.transport},
      ${candidate.eventIdentity.kind},
      ${input.prepared.eventIdentityDigestSha256},
      ${SAFE_ENVELOPE_SCHEMA_ID}, ${SAFE_ENVELOPE_SCHEMA_VERSION},
      ${input.prepared.persistedSafeEnvelopeDigest}, ${candidate.sanitizer.handlerId},
      ${candidate.sanitizer.handlerVersion},
      ${candidate.sanitizer.declarationRevision}, true,
      ${input.evidence.headerContent !== null}, 'core:raw_event_envelope',
      'personal_operational', 'core:source_replay_and_diagnostics',
      'core:terminal_processing', 'compact_to_safe_skeleton',
      ${candidate.receivedAt}::timestamptz,
      ${candidate.sanitizedAt}::timestamptz
    )
  `;
}

export function buildInsertInboxV2RawAdmissionSql(
  input: Readonly<{
    prepared: PreparedCandidate;
    rawEventId: string;
  }>
): SQL {
  const admission = input.prepared.admission;
  if (admission === null) {
    throw invariantError(
      "Keyed raw admission insert requires production proof."
    );
  }
  const { candidate } = input.prepared;
  return sql`
    insert into public.inbox_v2_source_raw_admissions (
      tenant_id, purpose_id, key_generation, hmac_key_secret_ref,
      identity_hmac_sha256, identity_kind, source_connection_id,
      source_account_id, source_account_scope_key, raw_event_id,
      safe_envelope_digest_sha256, guarantee_until, state,
      terminal_skeleton_id, terminal_outcome_hmac_sha256,
      skeleton_handed_off_at, revision, created_at, updated_at
    ) values (
      ${candidate.tenantId}, ${INBOX_V2_RAW_ADMISSION_PURPOSE_ID},
      ${admission.writeCandidate.generation},
      ${admission.writeCandidate.hmacKeySecretRef},
      ${admission.writeCandidate.identityHmacSha256},
      ${candidate.eventIdentity.kind}, ${candidate.sourceConnectionId},
      ${candidate.sourceAccountId}, ${input.prepared.sourceAccountScopeKey},
      ${input.rawEventId}, ${input.prepared.persistedSafeEnvelopeDigest},
      ${admission.guaranteeUntil}::timestamptz,
      'skeleton_pending'::public.inbox_v2_source_raw_admission_state,
      null, null, null, 1, ${candidate.sanitizedAt}::timestamptz,
      ${candidate.sanitizedAt}::timestamptz
    )
  `;
}

function buildInsertInboxV2RawIngressPayloadEvidenceSql(
  input: Readonly<{
    prepared: PreparedCandidate;
    evidence: AcceptedEvidence;
    rawEventId: string;
  }>
): SQL {
  const { candidate } = input.prepared;
  if (candidate.disposition.outcome !== "accepted") {
    throw invariantError("Payload evidence requires an accepted candidate.");
  }
  return buildInsertEvidenceSql({
    candidate,
    rawEventId: input.rawEventId,
    evidenceKind: "provider_payload",
    dataClassId:
      candidate.disposition.restrictedPayload.classification.dataClassId,
    sensitivityClass: "restricted_content",
    purposeIds:
      candidate.disposition.restrictedPayload.classification.purposeIds,
    schemaId: candidate.sanitizer.restrictedPayloadSchema.schemaId,
    schemaVersion: candidate.sanitizer.restrictedPayloadSchema.schemaVersion,
    contentDigest: input.evidence.payloadDigest,
    content: input.evidence.payloadContent
  });
}

function buildInsertInboxV2RawIngressHeaderEvidenceSql(
  input: Readonly<{
    prepared: PreparedCandidate;
    evidence: AcceptedEvidence;
    rawEventId: string;
  }>
): SQL {
  const { candidate } = input.prepared;
  if (
    candidate.disposition.outcome !== "accepted" ||
    input.evidence.headerContent === null ||
    input.evidence.headerDigest === null
  ) {
    throw invariantError("Header evidence requires nonempty accepted headers.");
  }
  return buildInsertEvidenceSql({
    candidate,
    rawEventId: input.rawEventId,
    evidenceKind: "allowed_headers",
    dataClassId:
      candidate.disposition.allowedHeaders.classification.dataClassId,
    sensitivityClass: "personal_identifier",
    purposeIds: candidate.disposition.allowedHeaders.classification.purposeIds,
    schemaId: ALLOWED_HEADERS_SCHEMA_ID,
    schemaVersion: ALLOWED_HEADERS_SCHEMA_VERSION,
    contentDigest: input.evidence.headerDigest,
    content: input.evidence.headerContent
  });
}

function buildInsertEvidenceSql(
  input: Readonly<{
    candidate: InboxV2SanitizedRawIngressCandidate;
    rawEventId: string;
    evidenceKind: "provider_payload" | "allowed_headers";
    dataClassId: string;
    sensitivityClass: string;
    purposeIds: readonly string[];
    schemaId: string;
    schemaVersion: string;
    contentDigest: string;
    content: Readonly<Record<string, unknown>>;
  }>
): SQL {
  return sql`
    insert into public.inbox_v2_source_raw_evidence (
      tenant_id, raw_event_id, evidence_kind, data_class_id,
      sensitivity_class, purpose_ids, evidence_schema_id,
      evidence_schema_version, content_digest_sha256, content, recorded_at
    ) values (
      ${input.candidate.tenantId}, ${input.rawEventId},
      ${input.evidenceKind}::public.inbox_v2_source_raw_evidence_kind,
      ${input.dataClassId}, ${input.sensitivityClass},
      ${JSON.stringify(input.purposeIds)}::jsonb, ${input.schemaId},
      ${input.schemaVersion}, ${input.contentDigest},
      ${JSON.stringify(input.content)}::jsonb,
      ${input.candidate.sanitizedAt}::timestamptz
    )
  `;
}

function buildInsertInboxV2RawIngressWorkSql(
  input: Readonly<{
    prepared: PreparedCandidate;
    rawEventId: string;
  }>
): SQL {
  const { candidate } = input.prepared;
  return sql`
    insert into public.inbox_v2_source_raw_work_items as work (
      tenant_id, raw_event_id, state, available_at, attempt_count,
      lease_owner_id, lease_token_hash, lease_revision, lease_claimed_at,
      lease_expires_at, reclaim_count, last_reclaimed_at,
      last_reclaimed_from_expires_at, last_reclaimed_lease_owner_id,
      last_reclaimed_lease_token_hash, last_reclaimed_lease_revision,
      revision, created_at, updated_at
    ) values (
      ${candidate.tenantId}, ${input.rawEventId},
      'pending'::public.inbox_v2_source_raw_work_state,
      ${candidate.sanitizedAt}::timestamptz, 0, null, null, null, null, null,
      0, null, null, null, null, null, 1,
      ${candidate.sanitizedAt}::timestamptz,
      ${candidate.sanitizedAt}::timestamptz
    )
    returning ${rawWorkReturningColumns("work")}
  `;
}

function buildLockExistingInboxV2RawIngressSql(
  prepared: PreparedCandidate
): SQL {
  return sql`
    select anchor.tenant_id, anchor.id as raw_event_id,
           envelope.source_connection_id,
           envelope.source_account_id,
           envelope.source_account_scope_key,
           envelope.transport_kind,
           envelope.event_identity_kind,
           envelope.event_identity_digest_sha256,
           envelope.safe_envelope_digest_sha256,
           envelope.sanitizer_id,
           envelope.sanitizer_version,
           envelope.sanitizer_declaration_revision::text
             as sanitizer_declaration_revision
      from public.raw_inbound_events anchor
      join public.inbox_v2_source_raw_envelopes envelope
        on envelope.tenant_id = anchor.tenant_id
       and envelope.raw_event_id = anchor.id
     where anchor.tenant_id = ${prepared.candidate.tenantId}
       and anchor.idempotency_key = ${prepared.idempotencyKey}
     for update of anchor
  `;
}

export function buildLockInboxV2RawAdmissionCandidatesSql(
  prepared: PreparedCandidate
): SQL {
  const admission = prepared.admission;
  if (admission === null) {
    throw invariantError("Raw admission lock requires production proof.");
  }
  const lockKeys = admission.candidates.map(
    (candidate) => sql`(
      jsonb_build_array(
        ${RAW_ADMISSION_LOCK_DOMAIN}::text,
        ${prepared.candidate.tenantId}::text,
        ${INBOX_V2_RAW_ADMISSION_PURPOSE_ID}::text,
        ${candidate.generation}::text,
        ${candidate.identityHmacSha256}::text
      )::text
    )`
  );
  return sql`
    select pg_advisory_xact_lock(hashtextextended(candidate.lock_key, 0))
      from (values ${sql.join(lockKeys, sql`, `)}) as candidate(lock_key)
     order by candidate.lock_key collate "C"
  `;
}

export function buildValidateInboxV2RawAdmissionKeysSql(
  prepared: PreparedCandidate
): SQL {
  const admission = prepared.admission;
  if (admission === null) {
    throw invariantError(
      "Raw admission key validation requires production proof."
    );
  }
  const candidates = admission.candidates.map((candidate) => ({
    generation: candidate.generation,
    secret_ref: candidate.hmacKeySecretRef,
    is_write:
      candidate.generation === admission.writeCandidate.generation &&
      candidate.identityHmacSha256 ===
        admission.writeCandidate.identityHmacSha256
  }));
  return sql`
    with db_clock as materialized (
      select clock_timestamp() as db_now
    ), supplied as materialized (
      select *
        from jsonb_to_recordset(${JSON.stringify(candidates)}::jsonb)
          as candidate(generation text, secret_ref text, is_write boolean)
    )
    select supplied.generation, key_row.secret_ref, key_row.state::text,
           key_row.activated_at, key_row.use_until,
           key_row.guarantee_not_after, key_row.verify_until,
           supplied.is_write, db_clock.db_now
      from supplied
      cross join db_clock
      join public.inbox_v2_source_processing_key_generations key_row
        on key_row.tenant_id = ${prepared.candidate.tenantId}
       and key_row.purpose_id = ${INBOX_V2_RAW_ADMISSION_PURPOSE_ID}
       and key_row.generation = supplied.generation
       and key_row.secret_ref = supplied.secret_ref
     order by supplied.generation collate "C"
     for share of key_row
  `;
}

export function buildLockExistingInboxV2RawAdmissionsSql(
  prepared: PreparedCandidate
): SQL {
  const admission = prepared.admission;
  if (admission === null) {
    throw invariantError("Raw admission lookup requires production proof.");
  }
  const candidates = admission.candidates.map((candidate) => ({
    generation: candidate.generation,
    identity_hmac_sha256: candidate.identityHmacSha256
  }));
  return sql`
    with supplied as materialized (
      select *
        from jsonb_to_recordset(${JSON.stringify(candidates)}::jsonb)
          as candidate(generation text, identity_hmac_sha256 text)
    )
    select admission.tenant_id, admission.purpose_id,
           admission.key_generation, admission.hmac_key_secret_ref,
           admission.identity_hmac_sha256, admission.identity_kind,
           admission.source_account_id, admission.raw_event_id,
           admission.guarantee_until, admission.state::text,
           admission.skeleton_handed_off_at, admission.revision::text,
           envelope.source_connection_id,
           envelope.source_account_scope_key, envelope.transport_kind,
           envelope.event_identity_kind,
           envelope.event_identity_digest_sha256,
           envelope.safe_envelope_digest_sha256, envelope.sanitizer_id,
           envelope.sanitizer_version,
           envelope.sanitizer_declaration_revision::text
      from supplied
      join public.inbox_v2_source_raw_admissions admission
        on admission.tenant_id = ${prepared.candidate.tenantId}
       and admission.purpose_id = ${INBOX_V2_RAW_ADMISSION_PURPOSE_ID}
       and admission.key_generation = supplied.generation
       and admission.identity_hmac_sha256 =
         supplied.identity_hmac_sha256
      join public.inbox_v2_source_raw_envelopes envelope
        on envelope.tenant_id = admission.tenant_id
       and envelope.raw_event_id = admission.raw_event_id
     where admission.source_connection_id =
             ${prepared.candidate.sourceConnectionId}
       and admission.source_account_scope_key =
             ${prepared.sourceAccountScopeKey}
       and admission.identity_kind =
             ${prepared.candidate.eventIdentity.kind}
       and admission.guarantee_until > clock_timestamp()
     order by admission.key_generation collate "C"
     for update of admission
  `;
}

export function buildLoadPendingInboxV2RawDedupeAdmissionSql(
  input: InboxV2LoadPendingRawAdmissionInput
): SQL {
  return sql`
    select ${rawAdmissionReturningColumns("admission")},
           clock_timestamp() as db_now
      from public.inbox_v2_source_raw_admissions admission
     where admission.tenant_id = ${input.tenantId}
       and admission.raw_event_id = ${input.rawEventId}
     order by admission.key_generation collate "C"
     limit 2
  `;
}

export function buildLockInboxV2RawAdmissionForHandoffSql(
  input: InboxV2RawAdmissionSkeletonHandoffInput
): SQL {
  return sql`
    select ${rawAdmissionReturningColumns("admission")},
           clock_timestamp() as db_now
      from public.inbox_v2_source_raw_admissions admission
     where admission.tenant_id = ${input.tenantId}
       and admission.raw_event_id = ${input.rawEventId}
     order by admission.key_generation collate "C"
     limit 2
     for update of admission
  `;
}

export function buildHandoffInboxV2RawAdmissionSkeletonSql(
  input: InboxV2RawAdmissionSkeletonHandoffInput
): SQL {
  return sql`
    update public.inbox_v2_source_raw_admissions admission
       set state =
             'skeleton_handed_off'::public.inbox_v2_source_raw_admission_state,
           terminal_skeleton_id = ${input.terminalSkeletonId},
           terminal_outcome_hmac_sha256 =
             ${input.terminalOutcomeHmacSha256},
           skeleton_handed_off_at = ${input.handedOffAt}::timestamptz,
           revision = admission.revision + 1,
           updated_at = ${input.handedOffAt}::timestamptz
     where admission.tenant_id = ${input.tenantId}
       and admission.raw_event_id = ${input.rawEventId}
       and admission.state = 'skeleton_pending'
       and admission.revision = ${input.expectedAdmissionRevision}
       and admission.guarantee_until > ${input.handedOffAt}::timestamptz
    returning ${rawAdmissionReturningColumns("admission")}
  `;
}

type QuarantineInsertInput = Readonly<{
  prepared: PreparedCandidate;
  quarantineId: string;
  reasonCode: string;
  fingerprint: string;
  existing: ExistingRawIngressRow | null;
}>;

function buildInsertInboxV2RawIngressQuarantineSql(
  input: QuarantineInsertInput
): SQL {
  const { candidate } = input.prepared;
  const existing = input.existing;
  return sql`
    insert into public.inbox_v2_source_raw_quarantines (
      tenant_id, id, reason_code, quarantine_fingerprint_sha256,
      source_connection_id, source_account_id, source_account_scope_key,
      transport_kind, event_identity_kind, event_identity_digest_sha256,
      event_identity_key_generation, event_identity_hmac_key_secret_ref,
      event_identity_guarantee_until,
      idempotency_key_digest_sha256, safe_envelope_digest_sha256,
      existing_raw_event_id, existing_source_connection_id,
      existing_source_account_scope_key, existing_transport_kind,
      existing_event_identity_kind, existing_event_identity_digest_sha256,
      existing_safe_envelope_digest_sha256, sanitizer_id, sanitizer_version,
      sanitizer_declaration_revision, recorded_at
    ) values (
      ${candidate.tenantId}, ${input.quarantineId},
      ${input.reasonCode}::public.inbox_v2_source_raw_quarantine_reason,
      ${input.fingerprint}, ${candidate.sourceConnectionId},
      ${candidate.sourceAccountId}, ${input.prepared.sourceAccountScopeKey},
      ${candidate.transport}, ${candidate.eventIdentity.kind},
      ${input.prepared.eventIdentityDigestSha256},
      ${input.prepared.admission?.writeCandidate.generation ?? null},
      ${input.prepared.admission?.writeCandidate.hmacKeySecretRef ?? null},
      ${input.prepared.admission?.guaranteeUntil ?? null}::timestamptz,
      ${input.prepared.idempotencyKeyDigestSha256},
      ${input.prepared.persistedSafeEnvelopeDigest},
      ${existing === null ? null : stringValue(existing.raw_event_id, "existing raw event")},
      ${existing === null ? null : stringValue(existing.source_connection_id, "existing connection")},
      ${existing === null ? null : stringValue(existing.source_account_scope_key, "existing account scope")},
      ${existing === null ? null : stringValue(existing.transport_kind, "existing transport")},
      ${existing === null ? null : stringValue(existing.event_identity_kind, "existing identity kind")},
      ${existing === null ? null : stringValue(existing.event_identity_digest_sha256, "existing identity digest")},
      ${existing === null ? null : stringValue(existing.safe_envelope_digest_sha256, "existing envelope digest")},
      ${candidate.sanitizer.handlerId}, ${candidate.sanitizer.handlerVersion},
      ${candidate.sanitizer.declarationRevision},
      ${candidate.sanitizedAt}::timestamptz
    )
    on conflict (tenant_id, quarantine_fingerprint_sha256) do nothing
    returning id, tenant_id, source_connection_id, source_account_id
  `;
}

function buildFindInboxV2RawIngressQuarantineSql(input: {
  tenantId: string;
  fingerprint: string;
}): SQL {
  return sql`
    select id, tenant_id, source_connection_id, source_account_id
      from public.inbox_v2_source_raw_quarantines
     where tenant_id = ${input.tenantId}
       and quarantine_fingerprint_sha256 = ${input.fingerprint}
  `;
}

export function buildClaimInboxV2RawIngressSql(
  rawInput: InboxV2ClaimRawIngressInput,
  rawTokenHashes: readonly string[]
): SQL {
  const input = inboxV2ClaimRawIngressInputSchema.parse(rawInput);
  const tokenHashes = rawTokenHashes.map((digest) =>
    inboxV2Sha256DigestSchema.parse(digest)
  );
  if (
    tokenHashes.length !== input.batchSize ||
    new Set(tokenHashes).size !== tokenHashes.length
  ) {
    throw invariantError(
      "Raw-ingress claim requires one unique token digest per ordinal."
    );
  }
  const tokenRows = JSON.stringify(
    tokenHashes.map((tokenHash, index) => ({
      claim_ordinal: index + 1,
      token_hash: tokenHash
    }))
  );
  const maxClaimsPerAccount = input.maxClaimsPerAccount ?? input.batchSize;

  return sql`
    with db_clock as materialized (
      select clock_timestamp() as db_now
    ),
    due_candidates as materialized (
      select work.tenant_id, work.raw_event_id,
             envelope.source_connection_id,
             envelope.source_account_scope_key,
             work.state::text as previous_state,
             work.lease_owner_id as previous_lease_owner_id,
             work.lease_revision as previous_lease_revision,
             work.lease_claimed_at as previous_lease_claimed_at,
             work.lease_expires_at as previous_lease_expires_at,
             db_clock.db_now,
             case when work.state = 'pending' then work.available_at
                  else work.lease_expires_at end as due_at,
             row_number() over (
               partition by envelope.source_connection_id,
                            envelope.source_account_scope_key
               order by case when work.state = 'pending' then work.available_at
                             else work.lease_expires_at end asc,
                        work.raw_event_id collate "C" asc
             )::integer as account_claim_ordinal
        from public.inbox_v2_source_raw_work_items work
        join public.inbox_v2_source_raw_envelopes envelope
          on envelope.tenant_id = work.tenant_id
         and envelope.raw_event_id = work.raw_event_id
        cross join db_clock
       where work.tenant_id = ${input.tenantId}
         and ((work.state = 'pending' and work.available_at <= db_clock.db_now)
           or (work.state = 'leased'
             and work.lease_expires_at <= db_clock.db_now))
    ),
    fair_candidates as materialized (
      select *
        from due_candidates
       where account_claim_ordinal <= ${maxClaimsPerAccount}
       order by account_claim_ordinal asc, due_at asc,
                source_connection_id collate "C" asc,
                source_account_scope_key collate "C" asc,
                raw_event_id collate "C" asc
       limit ${input.batchSize}
    ),
    locked_candidates as materialized (
      select work.tenant_id, work.raw_event_id,
             candidate.previous_state,
             candidate.previous_lease_owner_id,
             candidate.previous_lease_revision,
             candidate.previous_lease_claimed_at,
             candidate.previous_lease_expires_at,
             candidate.db_now, candidate.due_at,
             candidate.source_connection_id,
             candidate.source_account_scope_key,
             candidate.account_claim_ordinal
        from fair_candidates candidate
        join public.inbox_v2_source_raw_work_items work
          on work.tenant_id = candidate.tenant_id
         and work.raw_event_id = candidate.raw_event_id
       where ((work.state = 'pending'
               and work.available_at <= candidate.db_now)
          or (work.state = 'leased'
               and work.lease_expires_at <= candidate.db_now))
       order by candidate.account_claim_ordinal asc,
                candidate.due_at asc,
                candidate.source_connection_id collate "C" asc,
                candidate.source_account_scope_key collate "C" asc,
                work.raw_event_id collate "C" asc
       for update of work skip locked
    ),
    ranked_candidates as (
      select locked_candidates.*,
             row_number() over (
               order by account_claim_ordinal asc, due_at asc,
                        source_connection_id collate "C" asc,
                        source_account_scope_key collate "C" asc,
                        raw_event_id collate "C" asc
             )::integer as claim_ordinal
        from locked_candidates
    ),
    claim_tokens as (
      select token.claim_ordinal, token.token_hash
        from jsonb_to_recordset(${tokenRows}::jsonb)
          as token(claim_ordinal integer, token_hash text)
    ),
    claimed as (
      update public.inbox_v2_source_raw_work_items work
         set state = 'leased',
             attempt_count = work.attempt_count + 1,
             lease_owner_id = ${input.workerId},
             lease_token_hash = claim_tokens.token_hash,
             lease_revision = work.revision + 1,
             lease_claimed_at = ranked_candidates.db_now,
             lease_expires_at = ranked_candidates.db_now
               + make_interval(secs => ${input.leaseDurationSeconds}),
             reclaim_count = work.reclaim_count + case
               when ranked_candidates.previous_state = 'leased' then 1 else 0 end,
             last_reclaimed_at = case
               when ranked_candidates.previous_state = 'leased'
                 then ranked_candidates.db_now else work.last_reclaimed_at end,
             last_reclaimed_from_expires_at = case
               when ranked_candidates.previous_state = 'leased'
                 then ranked_candidates.previous_lease_expires_at
                 else work.last_reclaimed_from_expires_at end,
             last_reclaimed_lease_owner_id = case
               when ranked_candidates.previous_state = 'leased'
                 then ranked_candidates.previous_lease_owner_id
                 else work.last_reclaimed_lease_owner_id end,
             last_reclaimed_lease_token_hash = case
               when ranked_candidates.previous_state = 'leased'
                 then work.lease_token_hash
                 else work.last_reclaimed_lease_token_hash end,
             last_reclaimed_lease_revision = case
               when ranked_candidates.previous_state = 'leased'
                 then ranked_candidates.previous_lease_revision
                 else work.last_reclaimed_lease_revision end,
             revision = work.revision + 1,
             updated_at = ranked_candidates.db_now
        from ranked_candidates
        join claim_tokens
          on claim_tokens.claim_ordinal = ranked_candidates.claim_ordinal
       where work.tenant_id = ranked_candidates.tenant_id
         and work.raw_event_id = ranked_candidates.raw_event_id
      returning ${rawWorkReturningColumns("work")},
                ranked_candidates.previous_state,
                ranked_candidates.previous_lease_owner_id,
                ranked_candidates.previous_lease_revision::text
                  as previous_lease_revision,
                ranked_candidates.previous_lease_claimed_at,
                ranked_candidates.previous_lease_expires_at,
                ranked_candidates.claim_ordinal
    )
    select * from claimed order by claim_ordinal asc
  `;
}

export function buildLockInboxV2RawIngressWorkSql(input: {
  tenantId: string;
  rawEventId: string;
}): SQL {
  return sql`
    with db_clock as materialized (select clock_timestamp() as db_now)
    select ${rawWorkSelectColumns("work")}, db_clock.db_now
      from public.inbox_v2_source_raw_work_items work
      cross join db_clock
     where work.tenant_id = ${input.tenantId}
       and work.raw_event_id = ${input.rawEventId}
     for update of work
  `;
}

export function buildRenewInboxV2RawIngressLeaseSql(
  input: Readonly<{
    input: InboxV2RenewRawIngressLeaseInput;
    tokenHash: string;
    dbNow: string;
    expectedWorkRevision: string;
  }>
): SQL {
  const parsed = inboxV2RenewRawIngressLeaseInputSchema.parse(input.input);
  const tokenHash = inboxV2Sha256DigestSchema.parse(input.tokenHash);
  const dbNow = inboxV2TimestampSchema.parse(input.dbNow);
  const expectedWorkRevision = inboxV2EntityRevisionSchema.parse(
    input.expectedWorkRevision
  );
  return sql`
    update public.inbox_v2_source_raw_work_items work
       set lease_revision = work.lease_revision + 1,
           lease_expires_at = greatest(
             work.lease_expires_at + interval '1 millisecond',
             ${dbNow}::timestamptz
               + make_interval(secs => ${parsed.leaseDurationSeconds})
           ),
           revision = work.revision + 1,
           updated_at = ${dbNow}::timestamptz
     where work.tenant_id = ${parsed.tenantId}
       and work.raw_event_id = ${parsed.rawEventId}
       and work.state = 'leased'
       and work.lease_owner_id = ${parsed.workerId}
       and work.lease_token_hash = ${tokenHash}
       and work.lease_revision = ${parsed.expectedLeaseRevision}
       and work.lease_expires_at > ${dbNow}::timestamptz
       and work.revision = ${expectedWorkRevision}
    returning ${rawWorkReturningColumns("work")}
  `;
}

export function buildReleaseInboxV2RawIngressLeaseSql(
  input: Readonly<{
    input: InboxV2ReleaseRawIngressLeaseInput;
    tokenHash: string;
    dbNow: string;
    expectedWorkRevision: string;
  }>
): SQL {
  const parsed = inboxV2ReleaseRawIngressLeaseInputSchema.parse(input.input);
  const tokenHash = inboxV2Sha256DigestSchema.parse(input.tokenHash);
  const dbNow = inboxV2TimestampSchema.parse(input.dbNow);
  const expectedWorkRevision = inboxV2EntityRevisionSchema.parse(
    input.expectedWorkRevision
  );
  return sql`
    update public.inbox_v2_source_raw_work_items work
       set state = 'pending', available_at = ${dbNow}::timestamptz,
           lease_owner_id = null, lease_token_hash = null,
           lease_revision = null, lease_claimed_at = null,
           lease_expires_at = null, revision = work.revision + 1,
           updated_at = ${dbNow}::timestamptz
     where work.tenant_id = ${parsed.tenantId}
       and work.raw_event_id = ${parsed.rawEventId}
       and work.state = 'leased'
       and work.lease_owner_id = ${parsed.workerId}
       and work.lease_token_hash = ${tokenHash}
       and work.lease_revision = ${parsed.expectedLeaseRevision}
       and work.lease_expires_at > ${dbNow}::timestamptz
       and work.revision = ${expectedWorkRevision}
    returning ${rawWorkReturningColumns("work")}
  `;
}

type LeaseFenceInput = Readonly<{
  tenantId: string;
  rawEventId: string;
  workerId: string;
  leaseToken: string;
  expectedLeaseRevision: string;
}>;

type LeaseFenceFailure = Exclude<
  InboxV2RenewRawIngressLeaseResult,
  Readonly<{ outcome: "renewed" }>
>;

type LockedLease =
  | Readonly<{ kind: "result"; result: LeaseFenceFailure }>
  | Readonly<{
      kind: "locked";
      work: InboxV2RawIngressWorkItem & Readonly<{ state: "leased" }>;
      dbNow: string;
    }>;

async function lockAndClassifyLease(
  executor: RawSqlExecutor,
  input: LeaseFenceInput,
  tokenHash: string
): Promise<LockedLease> {
  const result = await executor.execute<LockedRawWorkRow>(
    buildLockInboxV2RawIngressWorkSql(input)
  );
  if (result.rows.length > 1) {
    throw invariantError("Raw-ingress work lock returned multiple rows.");
  }
  const row = result.rows[0];
  if (row === undefined) {
    return leaseFailure({
      outcome: "not_found",
      tenantId: input.tenantId,
      rawEventId: input.rawEventId
    });
  }
  const work = mapRawWorkRow(input.tenantId, input.rawEventId, row);
  const dbNow = timestampValue(row.db_now, "raw-ingress database clock");
  if (work.state !== "leased") {
    return leaseFailure({
      outcome: "not_leased",
      tenantId: input.tenantId,
      rawEventId: input.rawEventId,
      currentState: "pending"
    });
  }
  if (work.lease === null) {
    throw invariantError("Leased raw-ingress work has no lease.");
  }
  if (
    work.lease.workerId !== input.workerId ||
    work.lease.leaseTokenHash !== tokenHash
  ) {
    return leaseFailure({
      outcome: "stale_token",
      tenantId: input.tenantId,
      rawEventId: input.rawEventId,
      currentLeaseRevision: work.lease.leaseRevision
    });
  }
  if (Date.parse(work.lease.expiresAt) <= Date.parse(dbNow)) {
    return leaseFailure({
      outcome: "lease_expired",
      tenantId: input.tenantId,
      rawEventId: input.rawEventId,
      currentLeaseRevision: work.lease.leaseRevision,
      expiredAt: work.lease.expiresAt
    });
  }
  if (work.lease.leaseRevision !== input.expectedLeaseRevision) {
    return leaseFailure({
      outcome: "lease_revision_conflict",
      tenantId: input.tenantId,
      rawEventId: input.rawEventId,
      currentLeaseRevision: work.lease.leaseRevision
    });
  }
  return {
    kind: "locked",
    work: work as InboxV2RawIngressWorkItem & Readonly<{ state: "leased" }>,
    dbNow
  };
}

function leaseFailure(input: unknown): Readonly<{
  kind: "result";
  result: LeaseFenceFailure;
}> {
  const result = inboxV2RenewRawIngressLeaseResultSchema.parse(input);
  if (result.outcome === "renewed") {
    throw invariantError("Lease failure mapper returned renewed work.");
  }
  return { kind: "result", result };
}

function asReleaseFailure(
  failure: LeaseFenceFailure
): InboxV2ReleaseRawIngressLeaseResult {
  return inboxV2ReleaseRawIngressLeaseResultSchema.parse(failure);
}

type ClaimToken = Readonly<{ rawToken: string; tokenHash: string }>;

function createClaimTokens(
  source: InboxV2RawIngressLeaseTokenSource,
  count: number
): readonly ClaimToken[] {
  const rawTokens = Array.from(source(count));
  if (rawTokens.length !== count) {
    throw invariantError(
      "Raw-ingress token source must return one token per claim ordinal."
    );
  }
  const tokens = rawTokens.map((value) => {
    const rawToken = inboxV2RawIngressLeaseTokenSchema.parse(value);
    return {
      rawToken,
      tokenHash: calculateInboxV2RawIngressLeaseTokenHash(rawToken)
    };
  });
  if (
    new Set(tokens.map((token) => token.rawToken)).size !== tokens.length ||
    new Set(tokens.map((token) => token.tokenHash)).size !== tokens.length
  ) {
    throw invariantError("Raw-ingress token source returned duplicates.");
  }
  return Object.freeze(tokens);
}

function mapClaimResult(
  input: InboxV2ClaimRawIngressInput,
  tokens: readonly ClaimToken[],
  rows: readonly ClaimedRawWorkRow[]
): InboxV2ClaimRawIngressResult {
  if (rows.length === 0) {
    return inboxV2ClaimRawIngressResultSchema.parse({
      outcome: "empty",
      tenantId: input.tenantId,
      workerId: input.workerId,
      batchSize: input.batchSize
    });
  }
  if (rows.length > input.batchSize) {
    throw invariantError("Raw-ingress claim exceeded its batch size.");
  }
  const ranked = rows
    .map((row) => ({ row, ordinal: integerValue(row.claim_ordinal) }))
    .sort((left, right) => left.ordinal - right.ordinal);
  if (
    new Set(ranked.map((item) => item.ordinal)).size !== ranked.length ||
    ranked.some((item, index) => item.ordinal !== index + 1)
  ) {
    throw invariantError(
      "Raw-ingress claim token ordinals are not contiguous."
    );
  }
  const claims = ranked.map(({ row, ordinal }) => {
    const token = tokens[ordinal - 1];
    if (token === undefined) {
      throw invariantError("Raw-ingress claim returned an unknown ordinal.");
    }
    const work = mapRawWorkRow(input.tenantId, undefined, row);
    if (
      work.state !== "leased" ||
      work.lease === null ||
      work.lease.workerId !== input.workerId ||
      work.lease.leaseTokenHash !== token.tokenHash
    ) {
      throw invariantError(
        "Raw-ingress claim is not bound to its tenant worker and token."
      );
    }
    const previousState = stringValue(row.previous_state, "previous state");
    if (previousState !== "pending" && previousState !== "leased") {
      throw invariantError("Raw-ingress claim has invalid previous state.");
    }
    const expiredLease =
      previousState === "pending"
        ? null
        : {
            workerId: stringValue(
              row.previous_lease_owner_id,
              "expired lease worker"
            ),
            leaseRevision: bigintText(row.previous_lease_revision),
            claimedAt: timestampValue(
              row.previous_lease_claimed_at,
              "expired lease claim"
            ),
            expiredAt: timestampValue(
              row.previous_lease_expires_at,
              "expired lease expiry"
            )
          };
    return {
      claimKind: previousState === "pending" ? "pending" : "reclaimed",
      work,
      leaseToken: token.rawToken,
      expiredLease
    };
  });
  return inboxV2ClaimRawIngressResultSchema.parse({
    outcome: "claimed",
    tenantId: input.tenantId,
    workerId: input.workerId,
    batchSize: input.batchSize,
    claims
  });
}

function mapRawWorkRow(
  expectedTenantId: string,
  expectedRawEventId: string | undefined,
  row: RawWorkRow
): InboxV2RawIngressWorkItem {
  const tenantId = stringValue(row.tenant_id, "raw-ingress tenant");
  const rawEventId = stringValue(row.raw_event_id, "raw-ingress event");
  if (
    tenantId !== expectedTenantId ||
    (expectedRawEventId !== undefined && rawEventId !== expectedRawEventId)
  ) {
    throw invariantError(
      "Raw-ingress repository returned work outside the requested scope."
    );
  }
  const state = stringValue(row.state, "raw-ingress state");
  const leaseValues = [
    row.lease_owner_id,
    row.lease_token_hash,
    row.lease_revision,
    row.lease_claimed_at,
    row.lease_expires_at
  ];
  if (leaseValues.some((value) => value === undefined)) {
    throw invariantError("Raw-ingress work omitted a lease column.");
  }
  const hasLease = leaseValues.every(isPresent);
  if (hasMixedNullability(leaseValues) || hasLease !== (state === "leased")) {
    throw invariantError("Raw-ingress work has an incoherent lease group.");
  }
  timestampValue(row.available_at, "raw-ingress availableAt");
  timestampValue(row.created_at, "raw-ingress createdAt");
  const lease = hasLease
    ? {
        workerId: stringValue(row.lease_owner_id, "raw-ingress lease worker"),
        leaseTokenHash: stringValue(
          row.lease_token_hash,
          "raw-ingress lease token hash"
        ),
        leaseRevision: bigintText(row.lease_revision),
        claimedAt: timestampValue(
          row.lease_claimed_at,
          "raw-ingress lease claim"
        ),
        expiresAt: timestampValue(
          row.lease_expires_at,
          "raw-ingress lease expiry"
        )
      }
    : null;
  return inboxV2RawIngressWorkItemSchema.parse({
    tenantId,
    rawEventId,
    state,
    attemptCount: bigintText(row.attempt_count),
    lease,
    revision: bigintText(row.revision),
    updatedAt: timestampValue(row.updated_at, "raw-ingress updatedAt")
  });
}

function prepareCandidate(
  candidate: InboxV2SanitizedRawIngressCandidate,
  digestSource: InboxV2RawIngressIdempotencyKeyDigestSource
): PreparedCandidate {
  const eventIdentityDigestSha256 = calculateInboxV2BytesSha256(
    new TextEncoder().encode(
      `core:inbox-v2.raw-ingress-event-identity\u0000${candidate.eventIdentity.value}`
    )
  );
  const scope: InboxV2RawIngressIdempotencyScope = Object.freeze({
    tenantId: String(candidate.tenantId),
    sourceConnectionId: String(candidate.sourceConnectionId),
    sourceAccountId:
      candidate.sourceAccountId === null
        ? null
        : String(candidate.sourceAccountId),
    transport: candidate.transport,
    eventIdentityKind: candidate.eventIdentity.kind,
    eventIdentityDigestSha256
  });
  const keyDigest = inboxV2Sha256DigestSchema.parse(digestSource(scope));
  const idempotencyKey = `source:v2:raw:${keyDigest.slice("sha256:".length)}`;
  return Object.freeze({
    candidate,
    sourceAccountScopeKey: accountScopeKey(candidate.sourceAccountId),
    eventIdentityDigestSha256,
    idempotencyKey,
    idempotencyKeyDigestSha256: calculateInboxV2BytesSha256(
      new TextEncoder().encode(
        `core:inbox-v2.raw-ingress-idempotency-key\u0000${idempotencyKey}`
      )
    ),
    persistedSafeEnvelopeDigest: candidate.safeEnvelopeDigest,
    admission: null
  });
}

function prepareProductionCandidate(
  candidate: InboxV2SanitizedRawIngressCandidate,
  decision: Extract<
    InboxV2RawAdmissionAuthorizationDecision,
    Readonly<{ outcome: "authorized" }>
  >
): PreparedCandidate {
  const eventIdentityDigestSha256 = decision.writeCandidate.identityHmacSha256;
  const persistedSafeEnvelopeDigest =
    decision.writeCandidate.safeEnvelopeHmacSha256;
  const idempotencyKey = `source:v2:raw:${eventIdentityDigestSha256.slice(
    "hmac-sha256:".length
  )}`;
  return Object.freeze({
    candidate,
    sourceAccountScopeKey: accountScopeKey(candidate.sourceAccountId),
    eventIdentityDigestSha256,
    idempotencyKey,
    idempotencyKeyDigestSha256: calculateInboxV2BytesSha256(
      new TextEncoder().encode(
        `core:inbox-v2.raw-ingress-idempotency-key\u0000${idempotencyKey}`
      )
    ),
    persistedSafeEnvelopeDigest,
    admission: Object.freeze({
      writeCandidate: decision.writeCandidate,
      candidates: decision.candidates,
      guaranteeUntil: decision.guaranteeUntil
    })
  });
}

function prepareAcceptedEvidence(
  candidate: InboxV2SanitizedRawIngressCandidate
): AcceptedEvidence {
  if (candidate.disposition.outcome !== "accepted") {
    throw invariantError("Accepted evidence requires an accepted candidate.");
  }
  const payloadContent = candidate.disposition.restrictedPayload.value;
  const headerContent =
    candidate.disposition.allowedHeaders.values.length === 0
      ? null
      : Object.freeze({ headers: candidate.disposition.allowedHeaders.values });
  return Object.freeze({
    payloadContent,
    payloadDigest: calculateInboxV2CanonicalSha256(payloadContent),
    headerContent,
    headerDigest:
      headerContent === null
        ? null
        : calculateInboxV2CanonicalSha256(headerContent)
  });
}

function existingRawIngressMatches(
  row: ExistingRawIngressRow,
  prepared: PreparedCandidate
): boolean {
  const { candidate } = prepared;
  return (
    stringValue(row.source_connection_id, "existing connection") ===
      String(candidate.sourceConnectionId) &&
    stringValue(row.source_account_scope_key, "existing account scope") ===
      prepared.sourceAccountScopeKey &&
    stringValue(row.transport_kind, "existing transport") ===
      candidate.transport &&
    stringValue(row.event_identity_kind, "existing identity kind") ===
      candidate.eventIdentity.kind &&
    stringValue(
      row.event_identity_digest_sha256,
      "existing identity digest"
    ) === prepared.eventIdentityDigestSha256 &&
    stringValue(row.safe_envelope_digest_sha256, "existing envelope digest") ===
      prepared.persistedSafeEnvelopeDigest &&
    stringValue(row.sanitizer_id, "existing sanitizer") ===
      candidate.sanitizer.handlerId &&
    stringValue(row.sanitizer_version, "existing sanitizer version") ===
      candidate.sanitizer.handlerVersion &&
    bigintText(row.sanitizer_declaration_revision) ===
      candidate.sanitizer.declarationRevision
  );
}

function existingAdmittedRawIngressMatches(
  row: RawAdmissionRow,
  prepared: PreparedCandidate
): boolean {
  const { candidate } = prepared;
  const generation = stringValue(
    row.key_generation,
    "existing admission generation"
  );
  const expectedSafeEnvelopeHmac = prepared.admission?.candidates.find(
    (candidateProof) => candidateProof.generation === generation
  )?.safeEnvelopeHmacSha256;
  return (
    expectedSafeEnvelopeHmac !== undefined &&
    stringValue(row.source_connection_id, "existing connection") ===
      String(candidate.sourceConnectionId) &&
    stringValue(row.source_account_scope_key, "existing account scope") ===
      prepared.sourceAccountScopeKey &&
    stringValue(row.transport_kind, "existing transport") ===
      candidate.transport &&
    stringValue(row.event_identity_kind, "existing identity kind") ===
      candidate.eventIdentity.kind &&
    stringValue(row.safe_envelope_digest_sha256, "existing envelope digest") ===
      expectedSafeEnvelopeHmac &&
    stringValue(row.sanitizer_id, "existing sanitizer") ===
      candidate.sanitizer.handlerId &&
    stringValue(row.sanitizer_version, "existing sanitizer version") ===
      candidate.sanitizer.handlerVersion &&
    bigintText(row.sanitizer_declaration_revision) ===
      candidate.sanitizer.declarationRevision
  );
}

function sourceFromCandidate(candidate: InboxV2SanitizedRawIngressCandidate) {
  return {
    tenantId: candidate.tenantId,
    sourceConnectionId: candidate.sourceConnectionId,
    sourceAccountId: candidate.sourceAccountId
  };
}

function sourceFromExistingRawIngress(row: ExistingRawIngressRow) {
  return {
    tenantId: stringValue(row.tenant_id, "existing raw tenant"),
    sourceConnectionId: stringValue(
      row.source_connection_id,
      "existing raw connection"
    ),
    sourceAccountId:
      row.source_account_id === null
        ? null
        : stringValue(row.source_account_id, "existing raw account")
  };
}

function sourceFromQuarantineReceipt(row: RawQuarantineReceiptRow) {
  return {
    tenantId: stringValue(row.tenant_id, "quarantine tenant"),
    sourceConnectionId: stringValue(
      row.source_connection_id,
      "quarantine connection"
    ),
    sourceAccountId:
      row.source_account_id === null
        ? null
        : stringValue(row.source_account_id, "quarantine account")
  };
}

function calculateQuarantineFingerprint(
  input: Readonly<{
    prepared: PreparedCandidate;
    reasonCode: string;
    existing: ExistingRawIngressRow | null;
  }>
): string {
  const existing = input.existing;
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.raw-ingress-quarantine",
    version: "v1",
    reasonCode: input.reasonCode,
    scope: {
      tenantId: input.prepared.candidate.tenantId,
      sourceConnectionId: input.prepared.candidate.sourceConnectionId,
      sourceAccountScopeKey: input.prepared.sourceAccountScopeKey,
      transport: input.prepared.candidate.transport,
      eventIdentityKind: input.prepared.candidate.eventIdentity.kind,
      eventIdentityDigestSha256: input.prepared.eventIdentityDigestSha256,
      idempotencyKeyDigestSha256: input.prepared.idempotencyKeyDigestSha256,
      safeEnvelopeDigestSha256: input.prepared.persistedSafeEnvelopeDigest
    },
    existing:
      existing === null
        ? null
        : {
            rawEventId: stringValue(
              existing.raw_event_id,
              "existing raw event"
            ),
            sourceConnectionId: stringValue(
              existing.source_connection_id,
              "existing connection"
            ),
            sourceAccountScopeKey: stringValue(
              existing.source_account_scope_key,
              "existing account scope"
            ),
            transport: stringValue(
              existing.transport_kind,
              "existing transport"
            ),
            eventIdentityKind: stringValue(
              existing.event_identity_kind,
              "existing identity kind"
            ),
            eventIdentityDigestSha256: stringValue(
              existing.event_identity_digest_sha256,
              "existing identity digest"
            ),
            safeEnvelopeDigestSha256: stringValue(
              existing.safe_envelope_digest_sha256,
              "existing envelope digest"
            )
          },
    sanitizer: input.prepared.candidate.sanitizer
  });
}

function defaultIdempotencyKeyDigestSource(
  scope: InboxV2RawIngressIdempotencyScope
): string {
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.raw-ingress-idempotency",
    version: "v2",
    scope
  });
}

function defaultRawEventIdSource(): string {
  return `raw_inbound_event:${randomUUID()}`;
}

function defaultQuarantineIdSource(): string {
  return `core:raw-ingress-quarantine-${randomUUID()}`;
}

function defaultLeaseTokenSource(count: number): readonly string[] {
  return Array.from(
    { length: count },
    () => `raw-${randomBytes(32).toString("base64url")}`
  );
}

function accountScopeKey(accountId: string | null): string {
  return accountId === null
    ? "0:"
    : `1:${new TextEncoder().encode(accountId).byteLength}:${accountId}`;
}

async function runRawIngressTransaction<TResult>(
  executor: InboxV2RawIngressTransactionExecutor,
  work: (transaction: RawSqlExecutor) => Promise<TResult>
): Promise<TResult> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await executor.transaction(work, RAW_INGRESS_TRANSACTION_CONFIG);
    } catch (error) {
      if (
        attempt >= RAW_INGRESS_TRANSACTION_ATTEMPTS ||
        !hasRetryableSqlState(error)
      ) {
        throw error;
      }
    }
  }
}

function hasRetryableSqlState(error: unknown): boolean {
  let current = error;
  const visited = new Set<object>();

  for (let depth = 0; depth < SQLSTATE_CAUSE_DEPTH_LIMIT; depth += 1) {
    if (typeof current !== "object" || current === null) {
      return false;
    }
    if (visited.has(current)) {
      return false;
    }
    visited.add(current);

    let code: unknown;
    let cause: unknown;
    try {
      code = Reflect.get(current, "code");
      cause = Reflect.get(current, "cause");
    } catch {
      return false;
    }
    if (typeof code === "string" && RETRYABLE_SQLSTATES.has(code)) {
      return true;
    }
    current = cause;
  }

  return false;
}

function rawWorkSelectColumns(alias: string): SQL {
  return rawWorkColumns(alias);
}

function rawAdmissionReturningColumns(alias: string): SQL {
  if (alias !== "admission") {
    throw invariantError("Unsupported raw-admission SQL alias.");
  }
  return sql.raw(`
    admission.tenant_id,
    admission.purpose_id,
    admission.key_generation,
    admission.hmac_key_secret_ref,
    admission.identity_hmac_sha256,
    admission.identity_kind,
    admission.source_connection_id,
    admission.source_account_id,
    admission.source_account_scope_key,
    admission.raw_event_id,
    admission.safe_envelope_digest_sha256,
    admission.guarantee_until,
    admission.state::text as state,
    admission.terminal_skeleton_id,
    admission.terminal_outcome_hmac_sha256,
    admission.skeleton_handed_off_at,
    admission.revision::text as revision
  `);
}

function rawWorkReturningColumns(alias: string): SQL {
  return rawWorkColumns(alias);
}

function rawWorkColumns(alias: string): SQL {
  if (alias !== "work") {
    throw invariantError("Unsupported raw-ingress work SQL alias.");
  }
  return sql.raw(`
    work.tenant_id,
    work.raw_event_id,
    work.state::text as state,
    work.available_at,
    work.attempt_count::text as attempt_count,
    work.lease_owner_id,
    work.lease_token_hash,
    work.lease_revision::text as lease_revision,
    work.lease_claimed_at,
    work.lease_expires_at,
    work.reclaim_count::text as reclaim_count,
    work.last_reclaimed_at,
    work.last_reclaimed_from_expires_at,
    work.last_reclaimed_lease_owner_id,
    work.last_reclaimed_lease_token_hash,
    work.last_reclaimed_lease_revision::text as last_reclaimed_lease_revision,
    work.revision::text as revision,
    work.created_at,
    work.updated_at
  `);
}

function timestampValue(value: unknown, label: string): string {
  const timestamp =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : null;
  if (timestamp === null || Number.isNaN(timestamp.getTime())) {
    throw invariantError(`${label} must be a timestamp.`);
  }
  return inboxV2TimestampSchema.parse(timestamp.toISOString());
}

function bigintText(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  if (typeof value === "string") return value;
  throw invariantError("Raw-ingress bigint value is invalid.");
}

function integerValue(value: unknown): number {
  const result =
    typeof value === "number"
      ? value
      : typeof value === "bigint" || typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(result)) {
    throw invariantError("Raw-ingress claim ordinal is invalid.");
  }
  return result;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw invariantError(`${label} must be a string.`);
  }
  return value;
}

function isPresent(value: unknown): boolean {
  return value !== null && value !== undefined;
}

function hasMixedNullability(values: readonly unknown[]): boolean {
  return values.some(isPresent) && !values.every(isPresent);
}

function exactlyOneRow<Row>(rows: readonly Row[], label: string): Row {
  if (rows.length !== 1) {
    throw invariantError(`${label} must return exactly one row.`);
  }
  return rows[0]!;
}

function invariantError(
  message: string
): InboxV2RawIngressPersistenceInvariantError {
  return new InboxV2RawIngressPersistenceInvariantError(message);
}
