import {
  INBOX_V2_NORMALIZED_EVENT_ENVELOPE_SCHEMA_ID,
  INBOX_V2_RAW_INGRESS_SANITIZER_PROFILE_SCHEMA_ID,
  INBOX_V2_RAW_INGRESS_SCHEMA_VERSION,
  assertInboxV2SourceNormalizationCandidateBatch,
  calculateInboxV2CanonicalSha256,
  calculateInboxV2RawIngressLeaseTokenHash,
  encodeInboxV2CanonicalJson,
  inboxV2CompleteSourceNormalizationResultSchema,
  inboxV2EntityRevisionSchema,
  inboxV2NamespacedIdSchema,
  inboxV2NormalizedInboundEventIdSchema,
  inboxV2RawInboundEventIdSchema,
  inboxV2RawIngressLeaseTokenSchema,
  inboxV2RawIngressWorkerIdSchema,
  inboxV2SchemaIdSchema,
  inboxV2SchemaVersionTokenSchema,
  inboxV2Sha256DigestSchema,
  inboxV2SourceAccountIdSchema,
  inboxV2SourceConnectionIdSchema,
  inboxV2SourceNormalizationHmacSha256Schema,
  inboxV2TenantIdSchema,
  inboxV2TimestampSchema,
  type InboxV2CompleteSourceNormalizationInput,
  type InboxV2CompleteSourceNormalizationResult,
  type InboxV2LoadClaimedSourceNormalizationInput,
  type InboxV2LoadClaimedSourceNormalizationResult,
  type InboxV2NormalizedEventCandidate,
  type InboxV2SourceNormalizationInput,
  type InboxV2SourceNormalizationCandidateBatch,
  type InboxV2SourceNormalizationRepositoryPort
} from "@hulee/contracts";
import { createHmac, randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import { buildInboxV2AdvisoryXactLockSql } from "./sql-inbox-v2-advisory-lock";
import type { RawSqlExecutor } from "./sql-outbox-repository";

const TRANSACTION_CONFIG = { isolationLevel: "read committed" } as const;
const TRANSACTION_ATTEMPTS = 3;
const RETRYABLE_SQLSTATES = new Set(["40001", "40P01"]);
const SQLSTATE_CAUSE_DEPTH_LIMIT = 8;
const RESULT_SCHEMA_ID = "core:inbox-v2.source-normalization-completion";
const RESULT_SCHEMA_VERSION = "v1";
const NORMALIZED_EVENT_ENVELOPE_SCHEMA_VERSION = "v1";
const NORMALIZED_ENVELOPE_DATA_CLASS_ID = "core:normalized_event_envelope";
const REPLAY_PURPOSE_ID = "core:source_replay_and_diagnostics";
const NORMALIZATION_HMAC_PURPOSE = "core:source-normalization-persistence";

export type InboxV2SourceNormalizationTransactionExecutor = RawSqlExecutor & {
  transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>,
    config?: Readonly<{ isolationLevel: "read committed" }>
  ): Promise<TResult>;
};

export type InboxV2SourceNormalizationDigestKey = Readonly<{
  keyGeneration: string;
  key: Uint8Array;
}>;

/**
 * Passing null requests the active tenant key; a concrete generation requests
 * historical verification material for an immutable completion retry.
 */
export type InboxV2SourceNormalizationDigestKeySource = (
  input: Readonly<{
    tenantId: string;
    keyGeneration: string | null;
  }>
) =>
  | InboxV2SourceNormalizationDigestKey
  | Promise<InboxV2SourceNormalizationDigestKey>;

export type InboxV2SourceNormalizationNormalizedEventIdSource = (
  input: Readonly<{
    tenantId: string;
    rawEventId: string;
    ordinal: number;
  }>
) => string;

export type InboxV2SourceNormalizationQuarantineIdSource = (
  input: Readonly<{
    tenantId: string;
    rawEventId: string;
  }>
) => string;

export type CreateSqlInboxV2SourceNormalizationRepositoryOptions = Readonly<{
  normalizationDigestKeySource: InboxV2SourceNormalizationDigestKeySource;
  normalizedEventIdSource?: InboxV2SourceNormalizationNormalizedEventIdSource;
  quarantineIdSource?: InboxV2SourceNormalizationQuarantineIdSource;
}>;

type JsonObject = Readonly<Record<string, unknown>>;

type PreparedEvidence = Readonly<{
  evidenceKey: string;
  slotId: string;
  schemaId: string;
  schemaVersion: string;
  dataClassId: string;
  purposeIds: readonly string[];
  contentHmacSha256: string;
  content: unknown;
}>;

type PreparedEvent = Readonly<{
  ordinal: number;
  normalizedEventId: string;
  idempotencyKey: string;
  idempotencyKeyHmacSha256: string;
  eventType: string;
  direction: string;
  visibility: string;
  providerOccurredAt: string | null;
  payloadSchemaId: string;
  payloadSchemaVersion: string;
  capabilitySchemaId: string;
  capabilitySchemaVersion: string;
  capabilityHmacSha256: string;
  identityObservationCount: number;
  rosterCompleteness: string | null;
  rosterAuthority: string | null;
  rosterOmissionPolicy: string | null;
  safeEnvelope: JsonObject;
  safeEnvelopeHmacSha256: string;
  collisionFingerprintHmacSha256: string;
  evidence: readonly PreparedEvidence[];
}>;

type PreparedCandidate = Readonly<{
  candidate: InboxV2SourceNormalizationCandidateBatch;
  digestKeyGeneration: string;
  sourceAccountScopeKey: string;
  events: readonly PreparedEvent[];
  orderedEventHmacSha256: string;
  candidateCompletionHmacSha256: string;
  successfulResultHmacSha256: string;
  quarantinedResultHmacSha256: string;
  quarantineId: string;
}>;

type LockedRawWorkRow = {
  db_now: unknown;
  state: unknown;
  attempt_count: unknown;
  lease_owner_id: unknown;
  lease_token_hash: unknown;
  lease_revision: unknown;
  lease_claimed_at: unknown;
  lease_expires_at: unknown;
  reclaim_count: unknown;
  revision: unknown;
  updated_at: unknown;
  source_connection_id: unknown;
  source_account_id: unknown;
  source_account_scope_key: unknown;
  transport_kind: unknown;
  sanitizer_id: unknown;
  sanitizer_version: unknown;
  sanitizer_declaration_revision: unknown;
  raw_payload_digest_sha256: unknown;
  raw_payload_schema_id: unknown;
  raw_payload_schema_version: unknown;
  source_type: unknown;
  source_name: unknown;
};

type RawScopeRow = {
  source_connection_id: unknown;
  source_account_id: unknown;
  source_account_scope_key: unknown;
  transport_kind: unknown;
  sanitizer_id: unknown;
  sanitizer_version: unknown;
  sanitizer_declaration_revision: unknown;
  source_type: unknown;
  source_name: unknown;
};

type ExistingNormalizedRow = {
  normalized_event_id: unknown;
  raw_event_id: unknown;
  source_connection_id: unknown;
  source_account_scope_key: unknown;
  normalized_ordinal: unknown;
  idempotency_key: unknown;
  event_type: unknown;
  digest_key_generation: unknown;
  safe_envelope_hmac_sha256: unknown;
  normalizer_id: unknown;
  normalizer_version: unknown;
  normalizer_declaration_revision: unknown;
};

type CompletionRow = {
  outcome: unknown;
  quarantine_id: unknown;
  digest_key_generation: unknown;
  ordered_event_hmac_sha256: unknown;
  candidate_completion_hmac_sha256: unknown;
  result_hmac_sha256: unknown;
  completed_at: unknown;
};

type NormalizedEventIdRow = { normalized_event_id: unknown };
type IdRow = { id: unknown };

type LockedRawWork = Readonly<{
  dbNow: string;
  state: string;
  attemptCount: string;
  reclaimCount: string;
  leaseOwnerId: string | null;
  leaseTokenHash: string | null;
  leaseRevision: string | null;
  leaseClaimedAt: string | null;
  leaseExpiresAt: string | null;
  revision: string;
  updatedAt: string;
  sourceConnectionId: string;
  sourceAccountId: string | null;
  sourceAccountScopeKey: string;
  transportKind: string;
  sanitizerId: string;
  sanitizerVersion: string;
  sanitizerDeclarationRevision: string;
  rawPayloadDigestSha256: string | null;
  rawPayloadSchemaId: string | null;
  rawPayloadSchemaVersion: string | null;
  sourceType: string;
  sourceName: string;
}>;

type LoadedClaimedInputRow = LockedRawWorkRow & {
  provider_timestamp: unknown;
  restricted_payload: unknown;
};

type RawScope = Pick<
  LockedRawWork,
  | "sourceConnectionId"
  | "sourceAccountId"
  | "sourceAccountScopeKey"
  | "transportKind"
  | "sanitizerId"
  | "sanitizerVersion"
  | "sanitizerDeclarationRevision"
  | "sourceType"
  | "sourceName"
>;

type LeaseFence = Readonly<{
  tenantId: string;
  rawEventId: string;
  workerId: string;
  expectedLeaseRevision: string;
}>;

type CompletionLeaseFailure = Extract<
  InboxV2CompleteSourceNormalizationResult,
  {
    outcome:
      | "not_found"
      | "not_leased"
      | "stale_token"
      | "lease_expired"
      | "lease_revision_conflict";
  }
>;

type Collision = Readonly<{
  candidate: PreparedEvent;
  existing: ExistingNormalized;
}>;

type ExistingNormalized = Readonly<{
  normalizedEventId: string;
  rawEventId: string;
  sourceConnectionId: string;
  sourceAccountScopeKey: string;
  normalizedOrdinal: number;
  idempotencyKey: string;
  eventType: string;
  digestKeyGeneration: string;
  safeEnvelopeHmacSha256: string;
  normalizerId: string;
  normalizerVersion: string;
  normalizerDeclarationRevision: string;
}>;

class ReprepareForDigestGenerationError extends Error {
  constructor(readonly keyGeneration: string) {
    super("Source normalization retry requires its original digest key.");
    this.name = "ReprepareForDigestGenerationError";
  }
}

export class InboxV2SourceNormalizationPersistenceInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InboxV2SourceNormalizationPersistenceInvariantError";
  }
}

export function createSqlInboxV2SourceNormalizationRepository(
  executor: InboxV2SourceNormalizationTransactionExecutor | HuleeDatabase,
  options: CreateSqlInboxV2SourceNormalizationRepositoryOptions
): InboxV2SourceNormalizationRepositoryPort {
  if (typeof options?.normalizationDigestKeySource !== "function") {
    throw invariantError(
      "Source normalization requires a tenant digest-key source."
    );
  }
  const transactionExecutor =
    executor as unknown as InboxV2SourceNormalizationTransactionExecutor;
  const normalizedEventIdSource =
    options.normalizedEventIdSource ?? defaultNormalizedEventIdSource;
  const quarantineIdSource =
    options.quarantineIdSource ?? defaultQuarantineIdSource;

  return Object.freeze({
    async loadClaimedInput(
      rawInput: InboxV2LoadClaimedSourceNormalizationInput
    ) {
      const input = parseLoadClaimedInput(rawInput);
      return runNormalizationTransaction(transactionExecutor, (transaction) =>
        loadClaimedInput(transaction, input)
      );
    },
    async complete(rawInput: InboxV2CompleteSourceNormalizationInput) {
      const input = parseCompleteInput(rawInput);
      let generationHint = await findCompletionDigestGeneration(
        transactionExecutor,
        input.candidate.tenantId,
        input.candidate.rawEventId
      );
      for (
        let preparationAttempt = 0;
        preparationAttempt < 2;
        preparationAttempt += 1
      ) {
        const prepared = await prepareCandidate({
          candidate: input.candidate,
          keySource: options.normalizationDigestKeySource,
          keyGeneration: generationHint,
          normalizedEventIdSource,
          quarantineIdSource
        });
        try {
          return await runNormalizationTransaction(
            transactionExecutor,
            (transaction) =>
              completeCandidate(transaction, {
                input,
                prepared
              })
          );
        } catch (error) {
          if (
            error instanceof ReprepareForDigestGenerationError &&
            error.keyGeneration !== prepared.digestKeyGeneration
          ) {
            generationHint = error.keyGeneration;
            continue;
          }
          throw error;
        }
      }
      throw invariantError(
        "Source normalization digest generation changed repeatedly."
      );
    }
  });
}

function parseLoadClaimedInput(
  input: InboxV2LoadClaimedSourceNormalizationInput
): InboxV2LoadClaimedSourceNormalizationInput {
  return Object.freeze({
    tenantId: inboxV2TenantIdSchema.parse(input?.tenantId),
    rawEventId: inboxV2RawInboundEventIdSchema.parse(input?.rawEventId),
    workerId: inboxV2RawIngressWorkerIdSchema.parse(input?.workerId),
    leaseToken: inboxV2RawIngressLeaseTokenSchema.parse(input?.leaseToken),
    expectedLeaseRevision: inboxV2EntityRevisionSchema.parse(
      input?.expectedLeaseRevision
    )
  });
}

function parseCompleteInput(
  input: InboxV2CompleteSourceNormalizationInput
): InboxV2CompleteSourceNormalizationInput {
  const candidate = assertInboxV2SourceNormalizationCandidateBatch(
    input?.candidate
  );
  return Object.freeze({
    candidate,
    workerId: inboxV2RawIngressWorkerIdSchema.parse(input.workerId),
    leaseToken: inboxV2RawIngressLeaseTokenSchema.parse(input.leaseToken),
    expectedLeaseRevision: inboxV2EntityRevisionSchema.parse(
      input.expectedLeaseRevision
    )
  });
}

async function prepareCandidate(input: {
  candidate: InboxV2SourceNormalizationCandidateBatch;
  keySource: InboxV2SourceNormalizationDigestKeySource;
  keyGeneration: string | null;
  normalizedEventIdSource: InboxV2SourceNormalizationNormalizedEventIdSource;
  quarantineIdSource: InboxV2SourceNormalizationQuarantineIdSource;
}): Promise<PreparedCandidate> {
  const sourceKey = await input.keySource({
    tenantId: input.candidate.tenantId,
    keyGeneration: input.keyGeneration
  });
  const keyGeneration = keyGenerationValue(sourceKey.keyGeneration);
  if (input.keyGeneration !== null && keyGeneration !== input.keyGeneration) {
    throw invariantError(
      "Digest-key source returned a generation different from the requested generation."
    );
  }
  if (!(sourceKey.key instanceof Uint8Array) || sourceKey.key.byteLength < 32) {
    throw invariantError(
      "Source-normalization digest keys must contain at least 256 bits."
    );
  }
  const key = Uint8Array.from(sourceKey.key);
  try {
    const sourceAccountScopeKey = accountScopeKey(
      input.candidate.sourceAccountId
    );
    const slots = new Map(
      input.candidate.evidenceSlots.map((slot) => [slot.slotId, slot] as const)
    );
    const events = input.candidate.events.map((event) => {
      const normalizedEventId = inboxV2NormalizedInboundEventIdSchema.parse(
        input.normalizedEventIdSource({
          tenantId: input.candidate.tenantId,
          rawEventId: input.candidate.rawEventId,
          ordinal: event.ordinal
        })
      );
      return prepareEvent({
        batch: input.candidate,
        event,
        slots,
        normalizedEventId,
        key,
        keyGeneration
      });
    });
    const orderedEventHmacSha256 = calculateHmac(key, {
      domain: "core:inbox-v2.source-normalization-ordered-events",
      version: "v1",
      tenantId: input.candidate.tenantId,
      sourceConnectionId: input.candidate.sourceConnectionId,
      sourceAccountScopeKey,
      events: events.map((event) => ({
        ordinal: event.ordinal,
        eventType: event.eventType,
        idempotencyKeyHmacSha256: event.idempotencyKeyHmacSha256,
        safeEnvelopeHmacSha256: event.safeEnvelopeHmacSha256,
        evidence: event.evidence.map((item) => ({
          evidenceKey: item.evidenceKey,
          contentHmacSha256: item.contentHmacSha256
        }))
      }))
    });
    const candidateCompletionHmacSha256 = calculateHmac(key, {
      domain: "core:inbox-v2.source-normalization-candidate-completion",
      version: "v1",
      protection: {
        tenantId: input.candidate.tenantId,
        purpose: NORMALIZATION_HMAC_PURPOSE,
        keyGeneration
      },
      rawEventId: input.candidate.rawEventId,
      sourceConnectionId: input.candidate.sourceConnectionId,
      sourceAccountScopeKey,
      transport: input.candidate.transport,
      restrictedPayloadDigestSha256:
        input.candidate.restrictedPayloadDigestSha256,
      adapterContract: input.candidate.adapterContract,
      rawIngressSanitizer: input.candidate.rawIngressSanitizer,
      normalizer: input.candidate.normalizer,
      outcome: input.candidate.outcome,
      ignoredReasonCode: input.candidate.ignoredReasonCode,
      orderedEventHmacSha256
    });
    const successfulResultHmacSha256 = calculateHmac(key, {
      domain: "core:inbox-v2.source-normalization-result",
      version: "v1",
      protection: {
        tenantId: input.candidate.tenantId,
        purpose: NORMALIZATION_HMAC_PURPOSE,
        keyGeneration
      },
      outcome: input.candidate.outcome === "emitted" ? "normalized" : "ignored",
      candidateCompletionHmacSha256,
      orderedEventHmacSha256
    });
    const quarantinedResultHmacSha256 = calculateHmac(key, {
      domain: "core:inbox-v2.source-normalization-result",
      version: "v1",
      protection: {
        tenantId: input.candidate.tenantId,
        purpose: NORMALIZATION_HMAC_PURPOSE,
        keyGeneration
      },
      outcome: "quarantined",
      reasonCode: "source.idempotency_collision",
      candidateCompletionHmacSha256,
      orderedEventHmacSha256
    });
    return Object.freeze({
      candidate: input.candidate,
      digestKeyGeneration: keyGeneration,
      sourceAccountScopeKey,
      events: Object.freeze(events),
      orderedEventHmacSha256,
      candidateCompletionHmacSha256,
      successfulResultHmacSha256,
      quarantinedResultHmacSha256,
      quarantineId: inboxV2NamespacedIdSchema.parse(
        input.quarantineIdSource({
          tenantId: input.candidate.tenantId,
          rawEventId: input.candidate.rawEventId
        })
      )
    });
  } finally {
    key.fill(0);
  }
}

function prepareEvent(input: {
  batch: InboxV2SourceNormalizationCandidateBatch;
  event: InboxV2NormalizedEventCandidate;
  slots: ReadonlyMap<
    string,
    InboxV2SourceNormalizationCandidateBatch["evidenceSlots"][number]
  >;
  normalizedEventId: string;
  key: Uint8Array;
  keyGeneration: string;
}): PreparedEvent {
  const evidenceDescriptors = input.event.evidence.map((draft) => {
    const slot = input.slots.get(draft.slotId);
    if (slot === undefined) {
      throw invariantError(
        `Authentic normalization candidate references unknown evidence slot ${draft.slotId}.`
      );
    }
    return {
      slotId: slot.slotId,
      schemaId: slot.schemaId,
      schemaVersion: slot.schemaVersion,
      dataClassId: slot.dataClassId,
      purposeIds: slot.purposeIds
    } as const;
  });
  const safeEnvelope = Object.freeze({
    domain: "core:inbox-v2.normalized-event-safe-envelope",
    schemaId: INBOX_V2_NORMALIZED_EVENT_ENVELOPE_SCHEMA_ID,
    schemaVersion: NORMALIZED_EVENT_ENVELOPE_SCHEMA_VERSION,
    ordinal: input.event.ordinal,
    eventType: input.event.eventType,
    direction: input.event.direction,
    visibility: input.event.visibility,
    payloadSchema: input.event.payloadSchema,
    providerOccurredAt: input.event.providerOccurredAt,
    semantic: input.event.semantic,
    thread: input.event.thread,
    message: input.event.message,
    identityObservations: input.event.identityObservations,
    rosterObservation: input.event.rosterObservation,
    capabilityObservation: input.event.capabilityObservation,
    evidenceDescriptors,
    normalizer: input.batch.normalizer,
    adapterContract: input.batch.adapterContract
  });
  const idempotencyKeyHmacSha256 = calculateHmac(input.key, {
    domain: "core:inbox-v2.source-normalization-idempotency",
    version: "v1",
    protection: {
      tenantId: input.batch.tenantId,
      purpose: NORMALIZATION_HMAC_PURPOSE,
      keyGeneration: input.keyGeneration
    },
    sourceConnectionId: input.batch.sourceConnectionId,
    sourceAccountId: input.batch.sourceAccountId,
    ordinal: input.event.ordinal,
    eventType: input.event.eventType,
    providerOccurredAt: input.event.providerOccurredAt,
    semantic: input.event.semantic,
    thread: input.event.thread,
    message: input.event.message
  });
  const idempotencyKey = `source:v2:normalized:${idempotencyKeyHmacSha256.slice(
    "hmac-sha256:".length
  )}`;
  const evidence = input.event.evidence.map((draft, index) => {
    const descriptor = evidenceDescriptors[index];
    if (descriptor === undefined) {
      throw invariantError("Normalization evidence descriptor is missing.");
    }
    const evidenceKeyDigest = calculateHmac(input.key, {
      domain: "core:inbox-v2.source-normalization-evidence-reference",
      version: "v1",
      tenantId: input.batch.tenantId,
      rawEventId: input.batch.rawEventId,
      ordinal: input.event.ordinal,
      slotId: descriptor.slotId
    }).slice("hmac-sha256:".length);
    return Object.freeze({
      evidenceKey: inboxV2NamespacedIdSchema.parse(
        `core:normalized-event-evidence.${evidenceKeyDigest}`
      ),
      ...descriptor,
      contentHmacSha256: calculateHmac(input.key, {
        domain: "core:inbox-v2.source-normalization-evidence-content",
        version: "v1",
        protection: {
          tenantId: input.batch.tenantId,
          purpose: NORMALIZATION_HMAC_PURPOSE,
          keyGeneration: input.keyGeneration
        },
        rawEventId: input.batch.rawEventId,
        ordinal: input.event.ordinal,
        slotId: descriptor.slotId,
        content: draft.value
      }),
      content: draft.value
    });
  });
  const safeEnvelopeHmacSha256 = calculateHmac(input.key, {
    domain: "core:inbox-v2.source-normalization-safe-envelope",
    version: "v1",
    protection: {
      tenantId: input.batch.tenantId,
      purpose: NORMALIZATION_HMAC_PURPOSE,
      keyGeneration: input.keyGeneration
    },
    rawEventId: input.batch.rawEventId,
    sourceConnectionId: input.batch.sourceConnectionId,
    sourceAccountId: input.batch.sourceAccountId,
    safeEnvelope,
    evidenceContentHmacs: evidence.map((item) => ({
      slotId: item.slotId,
      contentHmacSha256: item.contentHmacSha256
    }))
  });
  const collisionFingerprintHmacSha256 = calculateHmac(input.key, {
    domain: "core:inbox-v2.source-normalization-idempotency-collision",
    version: "v1",
    protection: {
      tenantId: input.batch.tenantId,
      purpose: NORMALIZATION_HMAC_PURPOSE,
      keyGeneration: input.keyGeneration
    },
    rawEventId: input.batch.rawEventId,
    sourceConnectionId: input.batch.sourceConnectionId,
    sourceAccountId: input.batch.sourceAccountId,
    ordinal: input.event.ordinal,
    eventType: input.event.eventType,
    idempotencyKeyHmacSha256,
    safeEnvelopeHmacSha256
  });
  return Object.freeze({
    ordinal: input.event.ordinal,
    normalizedEventId: input.normalizedEventId,
    idempotencyKey,
    idempotencyKeyHmacSha256,
    eventType: input.event.eventType,
    direction: input.event.direction,
    visibility: input.event.visibility,
    providerOccurredAt: input.event.providerOccurredAt,
    payloadSchemaId: input.event.payloadSchema.schemaId,
    payloadSchemaVersion: input.event.payloadSchema.schemaVersion,
    capabilitySchemaId: input.event.capabilityObservation.schemaId,
    capabilitySchemaVersion: input.event.capabilityObservation.schemaVersion,
    capabilityHmacSha256: calculateHmac(
      input.key,
      input.event.capabilityObservation
    ),
    identityObservationCount: input.event.identityObservations.length,
    rosterCompleteness: input.event.rosterObservation?.completeness ?? null,
    rosterAuthority: input.event.rosterObservation?.authority ?? null,
    rosterOmissionPolicy: input.event.rosterObservation?.omissionPolicy ?? null,
    safeEnvelope,
    safeEnvelopeHmacSha256,
    collisionFingerprintHmacSha256,
    evidence: Object.freeze(evidence)
  });
}

async function loadClaimedInput(
  transaction: RawSqlExecutor,
  input: InboxV2LoadClaimedSourceNormalizationInput
): Promise<InboxV2LoadClaimedSourceNormalizationResult> {
  const rows = await transaction.execute<LoadedClaimedInputRow>(
    buildLoadClaimedInputSql(input)
  );
  if (rows.rows.length > 1) {
    throw invariantError(
      "Source-normalization claimed-input lookup returned multiple rows."
    );
  }
  const row = rows.rows[0];
  if (row === undefined) {
    return {
      outcome: "not_found",
      tenantId: input.tenantId,
      rawEventId: input.rawEventId
    };
  }

  const work = mapLockedRawWork(row);
  const leaseFailure = classifyLeaseFence(
    input,
    calculateInboxV2RawIngressLeaseTokenHash(input.leaseToken),
    work
  );
  if (leaseFailure !== null) return leaseFailure;

  const unavailable = (): InboxV2LoadClaimedSourceNormalizationResult => ({
    outcome: "evidence_unavailable",
    tenantId: input.tenantId,
    rawEventId: input.rawEventId,
    reasonCode: "source.evidence_unavailable"
  });
  if (
    work.rawPayloadDigestSha256 === null ||
    work.rawPayloadSchemaId === null ||
    work.rawPayloadSchemaVersion === null ||
    row.restricted_payload === null
  ) {
    return unavailable();
  }

  let restrictedPayload: Readonly<Record<string, unknown>>;
  try {
    const digest = inboxV2Sha256DigestSchema.parse(work.rawPayloadDigestSha256);
    if (calculateInboxV2CanonicalSha256(row.restricted_payload) !== digest) {
      return unavailable();
    }
    restrictedPayload = cloneAndFreezeCanonicalJsonObject(
      row.restricted_payload
    );
  } catch {
    return unavailable();
  }

  return Object.freeze({
    outcome: "loaded" as const,
    sourceTypeId: sourceTypeCatalogId(work.sourceType),
    sourceName: work.sourceName,
    raw: Object.freeze({
      tenantId: inboxV2TenantIdSchema.parse(input.tenantId),
      rawEventId: inboxV2RawInboundEventIdSchema.parse(input.rawEventId),
      sourceConnectionId: inboxV2SourceConnectionIdSchema.parse(
        work.sourceConnectionId
      ),
      sourceAccountId:
        work.sourceAccountId === null
          ? null
          : inboxV2SourceAccountIdSchema.parse(work.sourceAccountId),
      transport: sourceTransportValue(work.transportKind),
      providerOccurredAt: nullableTimestamp(
        row.provider_timestamp,
        "provider occurrence time"
      ),
      rawIngressSanitizer: Object.freeze({
        profileSchemaId: INBOX_V2_RAW_INGRESS_SANITIZER_PROFILE_SCHEMA_ID,
        profileSchemaVersion: INBOX_V2_RAW_INGRESS_SCHEMA_VERSION,
        handlerId: inboxV2NamespacedIdSchema.parse(work.sanitizerId),
        handlerVersion: inboxV2SchemaVersionTokenSchema.parse(
          work.sanitizerVersion
        ),
        declarationRevision: inboxV2EntityRevisionSchema.parse(
          work.sanitizerDeclarationRevision
        ),
        restrictedPayloadSchema: Object.freeze({
          schemaId: inboxV2SchemaIdSchema.parse(work.rawPayloadSchemaId),
          schemaVersion: inboxV2SchemaVersionTokenSchema.parse(
            work.rawPayloadSchemaVersion
          )
        })
      }),
      restrictedPayload
    })
  });
}

async function completeCandidate(
  transaction: RawSqlExecutor,
  input: Readonly<{
    input: InboxV2CompleteSourceNormalizationInput;
    prepared: PreparedCandidate;
  }>
): Promise<InboxV2CompleteSourceNormalizationResult> {
  const tokenHash = calculateInboxV2RawIngressLeaseTokenHash(
    input.input.leaseToken
  );
  const lockedRows = await transaction.execute<LockedRawWorkRow>(
    buildLockRawWorkSql(input.prepared.candidate)
  );
  if (lockedRows.rows.length > 1) {
    throw invariantError(
      "Source-normalization work lock returned multiple rows."
    );
  }
  const lockedRow = lockedRows.rows[0];
  if (lockedRow === undefined) {
    return completeWithoutWork(transaction, input.prepared);
  }
  let work = mapLockedRawWork(lockedRow);
  assertCandidateMatchesRawScope(input.prepared, work);
  const leaseFailure = classifyLease(input.input, tokenHash, work);
  if (leaseFailure !== null) return leaseFailure;
  assertCandidateMatchesRawEvidence(input.prepared, work);

  const existing = await lockExistingNormalizedEvents(
    transaction,
    input.prepared
  );
  work = await refreshLockedRawWorkClock(transaction, input.prepared, work);
  const finalLeaseFailure = classifyLease(input.input, tokenHash, work);
  if (finalLeaseFailure !== null) return finalLeaseFailure;
  const collision = findCollision(input.prepared, existing);
  if (collision !== null) {
    return persistCollisionCompletion(transaction, {
      prepared: input.prepared,
      work,
      collision
    });
  }

  const eventIds: string[] = [];
  for (const event of input.prepared.events) {
    const exact = findExactExisting(event, existing, input.prepared);
    if (exact !== null) {
      eventIds.push(exact.normalizedEventId);
      continue;
    }
    await persistNormalizedEvent(transaction, {
      prepared: input.prepared,
      work,
      event
    });
    eventIds.push(event.normalizedEventId);
  }
  const outcome =
    input.prepared.candidate.outcome === "emitted" ? "normalized" : "ignored";
  const resultHmacSha256 = input.prepared.successfulResultHmacSha256;
  await insertCompletionResult(transaction, {
    prepared: input.prepared,
    work,
    outcome,
    normalizedEventIds: eventIds,
    quarantineId: null,
    reasonCode: input.prepared.candidate.ignoredReasonCode,
    resultHmacSha256
  });
  await deleteCompletedWork(transaction, input.prepared, work);
  await forceDeferredConstraints(transaction);
  return parseResult({
    outcome: "completed",
    completion: {
      tenantId: input.prepared.candidate.tenantId,
      rawEventId: input.prepared.candidate.rawEventId,
      outcome,
      normalizedEventIds: eventIds,
      quarantineId: null,
      orderedEventHmacSha256: input.prepared.orderedEventHmacSha256,
      candidateCompletionHmacSha256:
        input.prepared.candidateCompletionHmacSha256,
      resultHmacSha256,
      completedAt: work.dbNow
    }
  });
}

async function completeWithoutWork(
  transaction: RawSqlExecutor,
  prepared: PreparedCandidate
): Promise<InboxV2CompleteSourceNormalizationResult> {
  const scopeRows = await transaction.execute<RawScopeRow>(
    buildLoadRawScopeSql(prepared.candidate)
  );
  if (scopeRows.rows.length > 1) {
    throw invariantError(
      "Source-normalization raw scope returned multiple rows."
    );
  }
  const scope = scopeRows.rows[0];
  if (scope === undefined) {
    return parseResult({
      outcome: "not_found",
      tenantId: prepared.candidate.tenantId,
      rawEventId: prepared.candidate.rawEventId
    });
  }
  assertCandidateMatchesRawScope(prepared, mapRawScope(scope));
  const completionRows = await transaction.execute<CompletionRow>(
    buildLoadCompletionSql(prepared.candidate)
  );
  if (completionRows.rows.length !== 1) {
    throw invariantError(
      "A completed raw aggregate must retain exactly one normalization result."
    );
  }
  const row = completionRows.rows[0]!;
  const keyGeneration = textValue(
    row.digest_key_generation,
    "completion digest key generation"
  );
  if (keyGeneration !== prepared.digestKeyGeneration) {
    throw new ReprepareForDigestGenerationError(keyGeneration);
  }
  const storedCandidateHmac = hmacValue(
    row.candidate_completion_hmac_sha256,
    "completion candidate HMAC"
  );
  if (storedCandidateHmac !== prepared.candidateCompletionHmacSha256) {
    throw invariantError(
      "Completed normalization retry does not match the immutable candidate."
    );
  }
  const eventRows = await transaction.execute<NormalizedEventIdRow>(
    buildListCompletionEventIdsSql(prepared.candidate)
  );
  return parseResult({
    outcome: "already_completed",
    completion: {
      tenantId: prepared.candidate.tenantId,
      rawEventId: prepared.candidate.rawEventId,
      outcome: normalizationOutcomeValue(row.outcome),
      normalizedEventIds: eventRows.rows.map((eventRow) =>
        inboxV2NormalizedInboundEventIdSchema.parse(
          textValue(eventRow.normalized_event_id, "normalized event ID")
        )
      ),
      quarantineId:
        row.quarantine_id === null
          ? null
          : inboxV2NamespacedIdSchema.parse(row.quarantine_id),
      orderedEventHmacSha256: hmacValue(
        row.ordered_event_hmac_sha256,
        "ordered event HMAC"
      ),
      candidateCompletionHmacSha256: storedCandidateHmac,
      resultHmacSha256: hmacValue(row.result_hmac_sha256, "result HMAC"),
      completedAt: timestampValue(row.completed_at, "completion time")
    }
  });
}

async function lockExistingNormalizedEvents(
  transaction: RawSqlExecutor,
  prepared: PreparedCandidate
): Promise<readonly ExistingNormalized[]> {
  const keys = [
    ...new Set(prepared.events.map((event) => event.idempotencyKey))
  ].sort(bytewiseCompare);
  for (const key of keys) {
    await transaction.execute(
      buildInboxV2AdvisoryXactLockSql([
        "core:source-normalization-idempotency",
        prepared.candidate.tenantId,
        key
      ])
    );
  }
  if (prepared.events.length === 0) return [];
  const byKey = await transaction.execute<ExistingNormalizedRow>(
    buildLockNormalizedByKeysSql(prepared.candidate.tenantId, keys)
  );
  const byOrdinal = await transaction.execute<ExistingNormalizedRow>(
    buildLockNormalizedByOrdinalsSql(prepared)
  );
  const rows = new Map<string, ExistingNormalized>();
  for (const row of [...byKey.rows, ...byOrdinal.rows]) {
    const mapped = mapExistingNormalized(row);
    rows.set(mapped.normalizedEventId, mapped);
  }
  return [...rows.values()].sort(
    (left, right) =>
      left.normalizedOrdinal - right.normalizedOrdinal ||
      bytewiseCompare(left.normalizedEventId, right.normalizedEventId)
  );
}

async function refreshLockedRawWorkClock(
  transaction: RawSqlExecutor,
  prepared: PreparedCandidate,
  work: LockedRawWork
): Promise<LockedRawWork> {
  const result = await transaction.execute<{ db_now: unknown }>(
    buildRefreshLockedRawWorkClockSql(prepared, work)
  );
  if (result.rows.length !== 1) {
    throw invariantError(
      "Source-normalization final lease-clock refresh lost the locked work item."
    );
  }
  return Object.freeze({
    ...work,
    dbNow: timestampValue(result.rows[0]!.db_now, "final database clock")
  });
}

function findCollision(
  prepared: PreparedCandidate,
  existing: readonly ExistingNormalized[]
): Collision | null {
  for (const candidate of prepared.events) {
    const matches = existing.filter(
      (row) =>
        row.idempotencyKey === candidate.idempotencyKey ||
        row.normalizedOrdinal === candidate.ordinal
    );
    for (const row of matches) {
      if (!isExactExisting(candidate, row, prepared)) {
        return { candidate, existing: row };
      }
    }
  }
  return null;
}

function findExactExisting(
  event: PreparedEvent,
  existing: readonly ExistingNormalized[],
  prepared: PreparedCandidate
): ExistingNormalized | null {
  return (
    existing.find(
      (row) =>
        row.rawEventId === prepared.candidate.rawEventId &&
        row.sourceConnectionId === prepared.candidate.sourceConnectionId &&
        row.sourceAccountScopeKey === prepared.sourceAccountScopeKey &&
        isExactExisting(event, row, prepared)
    ) ?? null
  );
}

function isExactExisting(
  candidate: PreparedEvent,
  existing: ExistingNormalized,
  prepared: PreparedCandidate
): boolean {
  return (
    existing.rawEventId === prepared.candidate.rawEventId &&
    existing.sourceConnectionId === prepared.candidate.sourceConnectionId &&
    existing.sourceAccountScopeKey === prepared.sourceAccountScopeKey &&
    existing.idempotencyKey === candidate.idempotencyKey &&
    existing.normalizedOrdinal === candidate.ordinal &&
    existing.eventType === candidate.eventType &&
    existing.digestKeyGeneration === prepared.digestKeyGeneration &&
    existing.safeEnvelopeHmacSha256 === candidate.safeEnvelopeHmacSha256
  );
}

async function persistNormalizedEvent(
  transaction: RawSqlExecutor,
  input: Readonly<{
    prepared: PreparedCandidate;
    work: LockedRawWork;
    event: PreparedEvent;
  }>
): Promise<void> {
  const anchor = await transaction.execute<IdRow>(
    buildInsertNormalizedAnchorSql(input)
  );
  exactlyOneId(anchor.rows, input.event.normalizedEventId, "normalized anchor");
  const envelope = await transaction.execute<IdRow>(
    buildInsertNormalizedEnvelopeSql(input)
  );
  exactlyOneId(
    envelope.rows,
    input.event.normalizedEventId,
    "normalized envelope"
  );
  for (const evidence of input.event.evidence) {
    const reference = await transaction.execute<IdRow>(
      buildInsertEvidenceReferenceSql(input, evidence)
    );
    exactlyOneId(reference.rows, evidence.evidenceKey, "evidence reference");
    const payload = await transaction.execute<IdRow>(
      buildInsertEvidencePayloadSql(input, evidence)
    );
    exactlyOneId(payload.rows, evidence.evidenceKey, "evidence payload");
  }
}

async function persistCollisionCompletion(
  transaction: RawSqlExecutor,
  input: Readonly<{
    prepared: PreparedCandidate;
    work: LockedRawWork;
    collision: Collision;
  }>
): Promise<InboxV2CompleteSourceNormalizationResult> {
  const fingerprint = input.collision.candidate.collisionFingerprintHmacSha256;
  const quarantineRows = await transaction.execute<IdRow>(
    buildInsertCollisionQuarantineSql(input, fingerprint)
  );
  let quarantineId: string;
  if (quarantineRows.rows.length === 1) {
    quarantineId = inboxV2NamespacedIdSchema.parse(
      textValue(quarantineRows.rows[0]!.id, "quarantine ID")
    );
  } else if (quarantineRows.rows.length === 0) {
    const existing = await transaction.execute<IdRow>(
      buildFindCollisionQuarantineSql(input.prepared, fingerprint)
    );
    quarantineId = inboxV2NamespacedIdSchema.parse(
      exactlyOneText(existing.rows, "id", "collision quarantine")
    );
  } else {
    throw invariantError("Collision quarantine insert returned multiple rows.");
  }
  const resultHmacSha256 = input.prepared.quarantinedResultHmacSha256;
  await insertCompletionResult(transaction, {
    prepared: input.prepared,
    work: input.work,
    outcome: "quarantined",
    normalizedEventIds: [],
    quarantineId,
    reasonCode: "source.idempotency_collision",
    resultHmacSha256
  });
  await deleteCompletedWork(transaction, input.prepared, input.work);
  await forceDeferredConstraints(transaction);
  return parseResult({
    outcome: "quarantined",
    quarantineId,
    reasonCode: "source.idempotency_collision"
  });
}

async function insertCompletionResult(
  transaction: RawSqlExecutor,
  input: Readonly<{
    prepared: PreparedCandidate;
    work: LockedRawWork;
    outcome: "normalized" | "ignored" | "quarantined";
    normalizedEventIds: readonly string[];
    quarantineId: string | null;
    reasonCode: string | null;
    resultHmacSha256: string;
  }>
): Promise<void> {
  const result = await transaction.execute<IdRow>(
    buildInsertCompletionResultSql(input)
  );
  exactlyOneId(
    result.rows,
    input.prepared.candidate.rawEventId,
    "normalization completion"
  );
}

async function deleteCompletedWork(
  transaction: RawSqlExecutor,
  prepared: PreparedCandidate,
  work: LockedRawWork
): Promise<void> {
  const result = await transaction.execute<IdRow>(
    buildDeleteCompletedWorkSql(prepared, work)
  );
  exactlyOneId(
    result.rows,
    prepared.candidate.rawEventId,
    "completed raw work"
  );
}

async function forceDeferredConstraints(transaction: RawSqlExecutor) {
  await transaction.execute(sql`set constraints all immediate`);
}

function classifyLease(
  input: InboxV2CompleteSourceNormalizationInput,
  tokenHash: string,
  work: LockedRawWork
): InboxV2CompleteSourceNormalizationResult | null {
  return classifyLeaseFence(
    {
      tenantId: input.candidate.tenantId,
      rawEventId: input.candidate.rawEventId,
      workerId: input.workerId,
      expectedLeaseRevision: input.expectedLeaseRevision
    },
    tokenHash,
    work
  );
}

function classifyLeaseFence(
  input: LeaseFence,
  tokenHash: string,
  work: LockedRawWork
): CompletionLeaseFailure | null {
  const scope = {
    tenantId: inboxV2TenantIdSchema.parse(input.tenantId),
    rawEventId: inboxV2RawInboundEventIdSchema.parse(input.rawEventId)
  };
  if (work.state !== "leased") {
    return parseLeaseFailure({ outcome: "not_leased", ...scope });
  }
  if (
    work.leaseOwnerId !== input.workerId ||
    work.leaseTokenHash !== tokenHash
  ) {
    return parseLeaseFailure({
      outcome: "stale_token",
      ...scope,
      currentLeaseRevision: requiredLeaseRevision(work)
    });
  }
  if (
    work.leaseExpiresAt === null ||
    Date.parse(work.leaseExpiresAt) <= Date.parse(work.dbNow)
  ) {
    return parseLeaseFailure({
      outcome: "lease_expired",
      ...scope,
      currentLeaseRevision: requiredLeaseRevision(work),
      expiredAt: requiredLeaseTimestamp(work.leaseExpiresAt)
    });
  }
  if (work.leaseRevision !== input.expectedLeaseRevision) {
    return parseLeaseFailure({
      outcome: "lease_revision_conflict",
      ...scope,
      currentLeaseRevision: requiredLeaseRevision(work)
    });
  }
  return null;
}

function assertCandidateMatchesRawScope(
  prepared: PreparedCandidate,
  raw: RawScope
): void {
  const candidate = prepared.candidate;
  if (
    raw.sourceConnectionId !== candidate.sourceConnectionId ||
    raw.sourceAccountId !== candidate.sourceAccountId ||
    raw.sourceAccountScopeKey !== prepared.sourceAccountScopeKey ||
    raw.transportKind !== candidate.transport ||
    raw.sanitizerId !== candidate.rawIngressSanitizer.handlerId ||
    raw.sanitizerVersion !== candidate.rawIngressSanitizer.handlerVersion ||
    raw.sanitizerDeclarationRevision !==
      candidate.rawIngressSanitizer.declarationRevision
  ) {
    throw invariantError(
      "Authentic normalization candidate does not match the accepted raw source scope."
    );
  }
}

function assertCandidateMatchesRawEvidence(
  prepared: PreparedCandidate,
  work: LockedRawWork
): void {
  if (
    work.rawPayloadDigestSha256 === null ||
    work.rawPayloadSchemaId === null ||
    work.rawPayloadSchemaVersion === null ||
    work.rawPayloadDigestSha256 !==
      prepared.candidate.restrictedPayloadDigestSha256 ||
    work.rawPayloadSchemaId !==
      prepared.candidate.rawIngressSanitizer.restrictedPayloadSchema.schemaId ||
    work.rawPayloadSchemaVersion !==
      prepared.candidate.rawIngressSanitizer.restrictedPayloadSchema
        .schemaVersion
  ) {
    throw invariantError(
      "Authentic normalization candidate is not bound to the persisted raw provider evidence."
    );
  }
}

function mapLockedRawWork(row: LockedRawWorkRow): LockedRawWork {
  return Object.freeze({
    dbNow: timestampValue(row.db_now, "database clock"),
    state: textValue(row.state, "raw work state"),
    attemptCount: integerText(row.attempt_count, "raw work attempt count"),
    reclaimCount: integerText(row.reclaim_count, "raw work reclaim count"),
    leaseOwnerId: nullableText(row.lease_owner_id, "raw work lease owner"),
    leaseTokenHash: nullableText(row.lease_token_hash, "raw work token hash"),
    leaseRevision: nullableIntegerText(
      row.lease_revision,
      "raw work lease revision"
    ),
    leaseClaimedAt: nullableTimestamp(
      row.lease_claimed_at,
      "raw work claimed time"
    ),
    leaseExpiresAt: nullableTimestamp(
      row.lease_expires_at,
      "raw work expiry time"
    ),
    revision: integerText(row.revision, "raw work revision"),
    updatedAt: timestampValue(row.updated_at, "raw work update time"),
    sourceConnectionId: textValue(
      row.source_connection_id,
      "raw source connection"
    ),
    sourceAccountId: nullableText(row.source_account_id, "raw source account"),
    sourceAccountScopeKey: textValue(
      row.source_account_scope_key,
      "raw source account scope"
    ),
    transportKind: textValue(row.transport_kind, "raw transport"),
    sanitizerId: textValue(row.sanitizer_id, "raw sanitizer ID"),
    sanitizerVersion: textValue(row.sanitizer_version, "raw sanitizer version"),
    sanitizerDeclarationRevision: integerText(
      row.sanitizer_declaration_revision,
      "raw sanitizer declaration revision"
    ),
    rawPayloadDigestSha256: nullableText(
      row.raw_payload_digest_sha256,
      "raw provider-payload digest"
    ),
    rawPayloadSchemaId: nullableText(
      row.raw_payload_schema_id,
      "raw provider-payload schema ID"
    ),
    rawPayloadSchemaVersion: nullableText(
      row.raw_payload_schema_version,
      "raw provider-payload schema version"
    ),
    sourceType: textValue(row.source_type, "source type"),
    sourceName: textValue(row.source_name, "source name")
  });
}

function mapRawScope(row: RawScopeRow): RawScope {
  return {
    sourceConnectionId: textValue(
      row.source_connection_id,
      "raw source connection"
    ),
    sourceAccountId: nullableText(row.source_account_id, "raw source account"),
    sourceAccountScopeKey: textValue(
      row.source_account_scope_key,
      "raw source account scope"
    ),
    transportKind: textValue(row.transport_kind, "raw transport"),
    sanitizerId: textValue(row.sanitizer_id, "raw sanitizer ID"),
    sanitizerVersion: textValue(row.sanitizer_version, "raw sanitizer version"),
    sanitizerDeclarationRevision: integerText(
      row.sanitizer_declaration_revision,
      "raw sanitizer declaration revision"
    ),
    sourceType: textValue(row.source_type, "source type"),
    sourceName: textValue(row.source_name, "source name")
  };
}

function mapExistingNormalized(row: ExistingNormalizedRow): ExistingNormalized {
  return Object.freeze({
    normalizedEventId: inboxV2NormalizedInboundEventIdSchema.parse(
      textValue(row.normalized_event_id, "existing normalized event ID")
    ),
    rawEventId: textValue(row.raw_event_id, "existing raw event ID"),
    sourceConnectionId: textValue(
      row.source_connection_id,
      "existing source connection"
    ),
    sourceAccountScopeKey: textValue(
      row.source_account_scope_key,
      "existing source account scope"
    ),
    normalizedOrdinal: numberValue(
      row.normalized_ordinal,
      "existing normalized ordinal"
    ),
    idempotencyKey: textValue(
      row.idempotency_key,
      "existing normalized idempotency key"
    ),
    eventType: textValue(row.event_type, "existing event type"),
    digestKeyGeneration: textValue(
      row.digest_key_generation,
      "existing digest key generation"
    ),
    safeEnvelopeHmacSha256: hmacValue(
      row.safe_envelope_hmac_sha256,
      "existing safe envelope HMAC"
    ),
    normalizerId: textValue(row.normalizer_id, "existing normalizer ID"),
    normalizerVersion: textValue(
      row.normalizer_version,
      "existing normalizer version"
    ),
    normalizerDeclarationRevision: integerText(
      row.normalizer_declaration_revision,
      "existing normalizer declaration revision"
    )
  });
}

function buildLockRawWorkSql(
  candidate: InboxV2SourceNormalizationCandidateBatch
): SQL {
  return sql`
    select clock_timestamp() as db_now,
           work.state::text as state,
           work.attempt_count::text as attempt_count,
           work.lease_owner_id,
           work.lease_token_hash,
           work.lease_revision::text as lease_revision,
           work.lease_claimed_at,
           work.lease_expires_at,
           work.reclaim_count::text as reclaim_count,
           work.revision::text as revision,
           work.updated_at,
           raw.source_connection_id,
           raw.source_account_id,
           raw.source_account_scope_key,
           raw.transport_kind,
           raw.sanitizer_id,
           raw.sanitizer_version,
           raw.sanitizer_declaration_revision::text as sanitizer_declaration_revision,
           payload.content_digest_sha256 as raw_payload_digest_sha256,
           payload.evidence_schema_id as raw_payload_schema_id,
           payload.evidence_schema_version as raw_payload_schema_version,
           connection.source_type,
           connection.source_name
      from public.inbox_v2_source_raw_work_items work
      join public.inbox_v2_source_raw_envelopes raw
        on raw.tenant_id = work.tenant_id
       and raw.raw_event_id = work.raw_event_id
      join public.source_connections connection
        on connection.tenant_id = raw.tenant_id
       and connection.id = raw.source_connection_id
      left join public.inbox_v2_source_raw_evidence payload
        on payload.tenant_id = raw.tenant_id
       and payload.raw_event_id = raw.raw_event_id
       and payload.evidence_kind = 'provider_payload'
     where work.tenant_id = ${candidate.tenantId}
       and work.raw_event_id = ${candidate.rawEventId}
     for update of work
  `;
}

function buildLoadClaimedInputSql(
  input: InboxV2LoadClaimedSourceNormalizationInput
): SQL {
  return sql`
    select clock_timestamp() as db_now,
           work.state::text as state,
           work.attempt_count::text as attempt_count,
           work.lease_owner_id,
           work.lease_token_hash,
           work.lease_revision::text as lease_revision,
           work.lease_claimed_at,
           work.lease_expires_at,
           work.reclaim_count::text as reclaim_count,
           work.revision::text as revision,
           work.updated_at,
           raw.source_connection_id,
           raw.source_account_id,
           raw.source_account_scope_key,
           raw.transport_kind,
           raw.sanitizer_id,
           raw.sanitizer_version,
           raw.sanitizer_declaration_revision::text as sanitizer_declaration_revision,
           payload.content_digest_sha256 as raw_payload_digest_sha256,
           payload.evidence_schema_id as raw_payload_schema_id,
           payload.evidence_schema_version as raw_payload_schema_version,
           payload.content as restricted_payload,
           anchor.provider_timestamp,
           connection.source_type,
           connection.source_name
      from public.inbox_v2_source_raw_work_items work
      join public.inbox_v2_source_raw_envelopes raw
        on raw.tenant_id = work.tenant_id
       and raw.raw_event_id = work.raw_event_id
      join public.raw_inbound_events anchor
        on anchor.tenant_id = raw.tenant_id
       and anchor.id = raw.raw_event_id
      join public.source_connections connection
        on connection.tenant_id = raw.tenant_id
       and connection.id = raw.source_connection_id
      left join public.inbox_v2_source_raw_evidence payload
        on payload.tenant_id = raw.tenant_id
       and payload.raw_event_id = raw.raw_event_id
       and payload.evidence_kind = 'provider_payload'
     where work.tenant_id = ${input.tenantId}
       and work.raw_event_id = ${input.rawEventId}
     for share of work
  `;
}

function buildRefreshLockedRawWorkClockSql(
  prepared: PreparedCandidate,
  work: LockedRawWork
): SQL {
  return sql`
    select clock_timestamp() as db_now
      from public.inbox_v2_source_raw_work_items work
     where work.tenant_id = ${prepared.candidate.tenantId}
       and work.raw_event_id = ${prepared.candidate.rawEventId}
       and work.state = 'leased'
       and work.lease_owner_id = ${work.leaseOwnerId}
       and work.lease_token_hash = ${work.leaseTokenHash}
       and work.lease_revision = ${work.leaseRevision}::bigint
       and work.revision = ${work.revision}::bigint
  `;
}

function buildLoadRawScopeSql(
  candidate: InboxV2SourceNormalizationCandidateBatch
): SQL {
  return sql`
    select raw.source_connection_id,
           raw.source_account_id,
           raw.source_account_scope_key,
           raw.transport_kind,
           raw.sanitizer_id,
           raw.sanitizer_version,
           raw.sanitizer_declaration_revision::text as sanitizer_declaration_revision,
           connection.source_type,
           connection.source_name
      from public.inbox_v2_source_raw_envelopes raw
      join public.source_connections connection
        on connection.tenant_id = raw.tenant_id
       and connection.id = raw.source_connection_id
     where raw.tenant_id = ${candidate.tenantId}
       and raw.raw_event_id = ${candidate.rawEventId}
  `;
}

function buildLoadCompletionSql(
  candidate: InboxV2SourceNormalizationCandidateBatch
): SQL {
  return sql`
    select result.outcome::text as outcome,
           result.quarantine_id,
           result.digest_key_generation,
           result.ordered_event_hmac_sha256,
           result.candidate_completion_hmac_sha256,
           result.result_hmac_sha256,
           result.completed_at
      from public.inbox_v2_source_normalization_results result
     where result.tenant_id = ${candidate.tenantId}
       and result.raw_event_id = ${candidate.rawEventId}
  `;
}

function buildListCompletionEventIdsSql(
  candidate: InboxV2SourceNormalizationCandidateBatch
): SQL {
  return sql`
    select envelope.normalized_event_id
      from public.inbox_v2_source_normalized_envelopes envelope
     where envelope.tenant_id = ${candidate.tenantId}
       and envelope.raw_event_id = ${candidate.rawEventId}
     order by envelope.normalized_ordinal, envelope.normalized_event_id
  `;
}

function buildLockNormalizedByKeysSql(
  tenantId: string,
  keys: readonly string[]
): SQL {
  return sql`
    select ${existingNormalizedColumns()}
      from public.inbox_v2_source_normalized_envelopes envelope
     where envelope.tenant_id = ${tenantId}
       and envelope.idempotency_key in (${sql.join(
         keys.map((key) => sql`${key}`),
         sql`, `
       )})
     order by envelope.idempotency_key, envelope.normalized_event_id
     for update
  `;
}

function buildLockNormalizedByOrdinalsSql(prepared: PreparedCandidate): SQL {
  return sql`
    select ${existingNormalizedColumns()}
      from public.inbox_v2_source_normalized_envelopes envelope
     where envelope.tenant_id = ${prepared.candidate.tenantId}
       and envelope.raw_event_id = ${prepared.candidate.rawEventId}
       and envelope.normalized_ordinal in (${sql.join(
         prepared.events.map((event) => sql`${event.ordinal}`),
         sql`, `
       )})
     order by envelope.normalized_ordinal, envelope.normalized_event_id
     for update
  `;
}

function existingNormalizedColumns(): SQL {
  return sql.raw(`
    envelope.normalized_event_id,
    envelope.raw_event_id,
    envelope.source_connection_id,
    envelope.source_account_scope_key,
    envelope.normalized_ordinal,
    envelope.idempotency_key,
    envelope.event_type,
    envelope.digest_key_generation,
    envelope.safe_envelope_hmac_sha256,
    envelope.normalizer_id,
    envelope.normalizer_version,
    envelope.normalizer_declaration_revision
  `);
}

function buildInsertNormalizedAnchorSql(input: {
  prepared: PreparedCandidate;
  work: LockedRawWork;
  event: PreparedEvent;
}): SQL {
  const { candidate } = input.prepared;
  const { event, work } = input;
  return sql`
    insert into public.normalized_inbound_events (
      id, tenant_id, raw_event_id, source_connection_id, source_account_id,
      source_type, source_name, event_type, direction, visibility,
      external_thread_id, external_message_id, external_user_id,
      payload_version, normalized_payload, reply_capability,
      conversation_id, message_id, idempotency_key, processing_status,
      created_at, updated_at
    ) values (
      ${event.normalizedEventId}, ${candidate.tenantId}, ${candidate.rawEventId},
      ${candidate.sourceConnectionId}, ${candidate.sourceAccountId},
      ${work.sourceType}, ${work.sourceName}, ${event.eventType},
      ${event.direction}, ${event.visibility}, null, null, null,
      ${event.payloadSchemaVersion}, '{}'::jsonb, '{}'::jsonb,
      null, null, ${event.idempotencyKey}, 'ignored',
      ${work.dbNow}::timestamptz, ${work.dbNow}::timestamptz
    )
    returning id
  `;
}

function buildInsertNormalizedEnvelopeSql(input: {
  prepared: PreparedCandidate;
  work: LockedRawWork;
  event: PreparedEvent;
}): SQL {
  const { prepared, work, event } = input;
  const candidate = prepared.candidate;
  return sql`
    insert into public.inbox_v2_source_normalized_envelopes (
      tenant_id, normalized_event_id, raw_event_id, source_connection_id,
      source_account_id, source_account_scope_key, normalized_ordinal,
      idempotency_key, source_type, source_name, event_type, direction,
      visibility, provider_occurred_at, payload_schema_id,
      payload_schema_version, capability_schema_id, capability_schema_version,
      capability_hmac_sha256, identity_observation_count,
      roster_completeness, roster_authority, roster_omission_policy,
      normalizer_id, normalizer_version, normalizer_declaration_revision,
      adapter_contract_id, adapter_contract_version,
      adapter_declaration_revision, adapter_surface_id,
      safe_envelope_schema_id, safe_envelope_schema_version,
      digest_key_generation, safe_envelope_hmac_sha256, safe_envelope,
      normalized_evidence_count, data_class_id, sensitivity_class,
      processing_purpose_id, canonical_anchor_id, expiry_action,
      normalized_at, created_at
    ) values (
      ${candidate.tenantId}, ${event.normalizedEventId}, ${candidate.rawEventId},
      ${candidate.sourceConnectionId}, ${candidate.sourceAccountId},
      ${prepared.sourceAccountScopeKey}, ${event.ordinal},
      ${event.idempotencyKey}, ${work.sourceType}, ${work.sourceName},
      ${event.eventType}, ${event.direction}, ${event.visibility},
      ${event.providerOccurredAt}::timestamptz, ${event.payloadSchemaId},
      ${event.payloadSchemaVersion}, ${event.capabilitySchemaId},
      ${event.capabilitySchemaVersion}, ${event.capabilityHmacSha256},
      ${event.identityObservationCount}, ${event.rosterCompleteness},
      ${event.rosterAuthority}, ${event.rosterOmissionPolicy},
      ${candidate.normalizer.handlerId}, ${candidate.normalizer.handlerVersion},
      ${candidate.normalizer.declarationRevision}::bigint,
      ${candidate.adapterContract.contractId},
      ${candidate.adapterContract.contractVersion},
      ${candidate.adapterContract.declarationRevision}::bigint,
      ${candidate.adapterContract.surfaceId},
      ${INBOX_V2_NORMALIZED_EVENT_ENVELOPE_SCHEMA_ID},
      ${NORMALIZED_EVENT_ENVELOPE_SCHEMA_VERSION},
      ${prepared.digestKeyGeneration}, ${event.safeEnvelopeHmacSha256},
      ${JSON.stringify(event.safeEnvelope)}::jsonb, ${event.evidence.length},
      ${NORMALIZED_ENVELOPE_DATA_CLASS_ID}, 'personal_operational',
      ${REPLAY_PURPOSE_ID}, 'core:materialization_or_final_failure',
      'compact_to_safe_skeleton', ${work.dbNow}::timestamptz,
      ${work.dbNow}::timestamptz
    )
    returning normalized_event_id as id
  `;
}

function buildInsertEvidenceReferenceSql(
  input: {
    prepared: PreparedCandidate;
    work: LockedRawWork;
    event: PreparedEvent;
  },
  evidence: PreparedEvidence
): SQL {
  return sql`
    insert into public.inbox_v2_source_normalized_evidence (
      tenant_id, normalized_event_id, evidence_key, slot_id, data_class_id,
      sensitivity_class, purpose_ids, evidence_schema_id,
      evidence_schema_version, digest_key_generation, content_hmac_sha256,
      created_at
    ) values (
      ${input.prepared.candidate.tenantId}, ${input.event.normalizedEventId},
      ${evidence.evidenceKey}, ${evidence.slotId}, ${evidence.dataClassId},
      'restricted_content', ${JSON.stringify(evidence.purposeIds)}::jsonb,
      ${evidence.schemaId}, ${evidence.schemaVersion},
      ${input.prepared.digestKeyGeneration}, ${evidence.contentHmacSha256},
      ${input.work.dbNow}::timestamptz
    )
    returning evidence_key as id
  `;
}

function buildInsertEvidencePayloadSql(
  input: {
    prepared: PreparedCandidate;
    work: LockedRawWork;
    event: PreparedEvent;
  },
  evidence: PreparedEvidence
): SQL {
  return sql`
    insert into public.inbox_v2_source_normalized_evidence_payloads (
      tenant_id, normalized_event_id, evidence_key, content, recorded_at
    ) values (
      ${input.prepared.candidate.tenantId}, ${input.event.normalizedEventId},
      ${evidence.evidenceKey}, ${JSON.stringify(evidence.content)}::jsonb,
      ${input.work.dbNow}::timestamptz
    )
    returning evidence_key as id
  `;
}

function buildInsertCollisionQuarantineSql(
  input: {
    prepared: PreparedCandidate;
    work: LockedRawWork;
    collision: Collision;
  },
  fingerprint: string
): SQL {
  const { prepared, work, collision } = input;
  const candidate = prepared.candidate;
  return sql`
    insert into public.inbox_v2_source_normalized_quarantines (
      tenant_id, id, reason_code, digest_key_generation,
      quarantine_fingerprint_hmac_sha256,
      candidate_completion_hmac_sha256, raw_event_id, source_connection_id,
      source_account_scope_key, normalized_ordinal, event_type,
      idempotency_key_hmac_sha256, safe_envelope_hmac_sha256,
      existing_normalized_event_id, existing_raw_event_id,
      existing_source_connection_id, existing_source_account_scope_key,
      existing_event_type, existing_safe_envelope_hmac_sha256,
      normalizer_id, normalizer_version, normalizer_declaration_revision,
      recorded_at
    ) values (
      ${candidate.tenantId}, ${prepared.quarantineId},
      'source.idempotency_collision', ${prepared.digestKeyGeneration},
      ${fingerprint}, ${prepared.candidateCompletionHmacSha256},
      ${candidate.rawEventId}, ${candidate.sourceConnectionId},
      ${prepared.sourceAccountScopeKey}, ${collision.candidate.ordinal},
      ${collision.candidate.eventType},
      ${collision.candidate.idempotencyKeyHmacSha256},
      ${collision.candidate.safeEnvelopeHmacSha256},
      ${collision.existing.normalizedEventId}, ${collision.existing.rawEventId},
      ${collision.existing.sourceConnectionId},
      ${collision.existing.sourceAccountScopeKey},
      ${collision.existing.eventType},
      ${collision.existing.safeEnvelopeHmacSha256},
      ${candidate.normalizer.handlerId}, ${candidate.normalizer.handlerVersion},
      ${candidate.normalizer.declarationRevision}::bigint,
      ${work.dbNow}::timestamptz
    )
    on conflict (tenant_id, quarantine_fingerprint_hmac_sha256) do nothing
    returning id
  `;
}

function buildFindCollisionQuarantineSql(
  prepared: PreparedCandidate,
  fingerprint: string
): SQL {
  return sql`
    select quarantine.id
      from public.inbox_v2_source_normalized_quarantines quarantine
     where quarantine.tenant_id = ${prepared.candidate.tenantId}
       and quarantine.quarantine_fingerprint_hmac_sha256 = ${fingerprint}
  `;
}

function buildInsertCompletionResultSql(input: {
  prepared: PreparedCandidate;
  work: LockedRawWork;
  outcome: "normalized" | "ignored" | "quarantined";
  normalizedEventIds: readonly string[];
  quarantineId: string | null;
  reasonCode: string | null;
  resultHmacSha256: string;
}): SQL {
  const { prepared, work } = input;
  return sql`
    insert into public.inbox_v2_source_normalization_results (
      tenant_id, raw_event_id, outcome, normalized_event_count,
      ordered_event_hmac_sha256, reason_code, quarantine_id,
      digest_key_generation, candidate_completion_hmac_sha256,
      worker_id, completed_attempt_count, completed_reclaim_count,
      completed_lease_token_hash, completed_lease_revision,
      completed_lease_claimed_at, completed_lease_expires_at,
      completed_work_revision, result_schema_id, result_schema_version,
      result_hmac_sha256, completed_at, created_at
    ) values (
      ${prepared.candidate.tenantId}, ${prepared.candidate.rawEventId},
      ${input.outcome}, ${input.normalizedEventIds.length},
      ${prepared.orderedEventHmacSha256}, ${input.reasonCode},
      ${input.quarantineId}, ${prepared.digestKeyGeneration},
      ${prepared.candidateCompletionHmacSha256}, ${work.leaseOwnerId},
      ${work.attemptCount}::bigint, ${work.reclaimCount}::bigint,
      ${work.leaseTokenHash}, ${work.leaseRevision}::bigint,
      ${work.leaseClaimedAt}::timestamptz,
      ${work.leaseExpiresAt}::timestamptz, ${work.revision}::bigint,
      ${RESULT_SCHEMA_ID}, ${RESULT_SCHEMA_VERSION}, ${input.resultHmacSha256},
      ${work.dbNow}::timestamptz, ${work.dbNow}::timestamptz
    )
    returning raw_event_id as id
  `;
}

function buildDeleteCompletedWorkSql(
  prepared: PreparedCandidate,
  work: LockedRawWork
): SQL {
  return sql`
    delete from public.inbox_v2_source_raw_work_items work
     where work.tenant_id = ${prepared.candidate.tenantId}
       and work.raw_event_id = ${prepared.candidate.rawEventId}
       and work.state = 'leased'
       and work.lease_owner_id = ${work.leaseOwnerId}
       and work.lease_token_hash = ${work.leaseTokenHash}
       and work.lease_revision = ${work.leaseRevision}::bigint
       and work.lease_claimed_at = ${work.leaseClaimedAt}::timestamptz
       and work.lease_expires_at = ${work.leaseExpiresAt}::timestamptz
       and work.revision = ${work.revision}::bigint
       and work.lease_expires_at > clock_timestamp()
    returning work.raw_event_id as id
  `;
}

async function findCompletionDigestGeneration(
  executor: RawSqlExecutor,
  tenantId: string,
  rawEventId: string
): Promise<string | null> {
  const result = await executor.execute<{ digest_key_generation: unknown }>(
    sql`
      select result.digest_key_generation
        from public.inbox_v2_source_normalization_results result
       where result.tenant_id = ${tenantId}
         and result.raw_event_id = ${rawEventId}
    `
  );
  if (result.rows.length > 1) {
    throw invariantError(
      "Normalization completion lookup returned multiple rows."
    );
  }
  return result.rows[0] === undefined
    ? null
    : keyGenerationValue(result.rows[0].digest_key_generation);
}

function calculateHmac(key: Uint8Array, value: unknown): string {
  return inboxV2SourceNormalizationHmacSha256Schema.parse(
    `hmac-sha256:${createHmac("sha256", key)
      .update(encodeInboxV2CanonicalJson(value))
      .digest("hex")}`
  );
}

async function runNormalizationTransaction<TResult>(
  executor: InboxV2SourceNormalizationTransactionExecutor,
  work: (transaction: RawSqlExecutor) => Promise<TResult>
): Promise<TResult> {
  for (let attempt = 1; attempt <= TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await executor.transaction(work, TRANSACTION_CONFIG);
    } catch (error) {
      if (attempt === TRANSACTION_ATTEMPTS || !hasRetryableSqlState(error)) {
        throw error;
      }
    }
  }
  throw invariantError("Normalization transaction retry loop exhausted.");
}

function hasRetryableSqlState(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < SQLSTATE_CAUSE_DEPTH_LIMIT; depth += 1) {
    if (current === null || typeof current !== "object") return false;
    const code = Reflect.get(current, "code");
    if (typeof code === "string" && RETRYABLE_SQLSTATES.has(code)) {
      return true;
    }
    current = Reflect.get(current, "cause");
  }
  return false;
}

function defaultNormalizedEventIdSource(): string {
  return `normalized_inbound_event:${randomUUID()}`;
}

function defaultQuarantineIdSource(): string {
  return `core:source-normalization-quarantine-${randomUUID()}`;
}

function accountScopeKey(accountId: string | null): string {
  return accountId === null
    ? "0:"
    : `1:${Buffer.byteLength(accountId, "utf8")}:${accountId}`;
}

function parseResult(input: unknown): InboxV2CompleteSourceNormalizationResult {
  return inboxV2CompleteSourceNormalizationResultSchema.parse(input);
}

function parseLeaseFailure(input: unknown): CompletionLeaseFailure {
  const result = parseResult(input);
  if (
    result.outcome === "not_found" ||
    result.outcome === "not_leased" ||
    result.outcome === "stale_token" ||
    result.outcome === "lease_expired" ||
    result.outcome === "lease_revision_conflict"
  ) {
    return result;
  }
  throw invariantError("Normalization lease classification was not a failure.");
}

function sourceTransportValue(
  value: string
): InboxV2SourceNormalizationInput["transport"] {
  if (
    value === "webhook" ||
    value === "polling" ||
    value === "stream" ||
    value === "email" ||
    value === "api"
  ) {
    return value;
  }
  throw invariantError("Stored raw source transport is invalid.");
}

function sourceTypeCatalogId(value: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/u.test(value)) {
    throw invariantError("Stored legacy source type is invalid.");
  }
  return inboxV2NamespacedIdSchema.parse(`core:${value}`);
}

function cloneAndFreezeCanonicalJsonObject(
  value: unknown
): Readonly<Record<string, unknown>> {
  const canonical = new TextDecoder().decode(encodeInboxV2CanonicalJson(value));
  const clone: unknown = JSON.parse(canonical);
  if (clone === null || typeof clone !== "object" || Array.isArray(clone)) {
    throw invariantError("Stored raw provider evidence must be a JSON object.");
  }
  return freezeCanonicalJson(clone) as Readonly<Record<string, unknown>>;
}

function freezeCanonicalJson(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    for (const item of value) freezeCanonicalJson(item);
    return Object.freeze(value);
  }
  for (const item of Object.values(value)) freezeCanonicalJson(item);
  return Object.freeze(value);
}

function normalizationOutcomeValue(
  value: unknown
): "normalized" | "ignored" | "quarantined" {
  if (
    value === "normalized" ||
    value === "ignored" ||
    value === "quarantined"
  ) {
    return value;
  }
  throw invariantError("Stored normalization outcome is invalid.");
}

function keyGenerationValue(value: unknown): string {
  const generation = textValue(value, "normalization digest key generation");
  if (
    generation.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9._~:-]*$/u.test(generation)
  ) {
    throw invariantError("Normalization digest key generation is invalid.");
  }
  return generation;
}

function hmacValue(value: unknown, label: string): string {
  try {
    return inboxV2SourceNormalizationHmacSha256Schema.parse(value);
  } catch {
    throw invariantError(`${label} must be a tenant-keyed HMAC.`);
  }
}

function requiredLeaseRevision(work: LockedRawWork): string {
  if (work.leaseRevision === null) {
    throw invariantError("Leased raw work has no lease revision.");
  }
  return inboxV2EntityRevisionSchema.parse(work.leaseRevision);
}

function requiredLeaseTimestamp(value: string | null): string {
  if (value === null) throw invariantError("Leased raw work has no expiry.");
  return inboxV2TimestampSchema.parse(value);
}

function exactlyOneId(
  rows: readonly IdRow[],
  expected: string,
  label: string
): void {
  if (rows.length !== 1 || textValue(rows[0]!.id, `${label} ID`) !== expected) {
    throw invariantError(`${label} write did not return its exact ID.`);
  }
}

function exactlyOneText(
  rows: readonly Record<string, unknown>[],
  field: string,
  label: string
): string {
  if (rows.length !== 1) {
    throw invariantError(`${label} lookup did not return exactly one row.`);
  }
  return textValue(rows[0]![field], `${label} ${field}`);
}

function textValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw invariantError(`${label} must be a non-empty string.`);
  }
  return value;
}

function nullableText(value: unknown, label: string): string | null {
  return value === null ? null : textValue(value, label);
}

function integerText(value: unknown, label: string): string {
  const text = typeof value === "bigint" ? value.toString() : String(value);
  if (!/^(?:0|[1-9][0-9]*)$/u.test(text)) {
    throw invariantError(`${label} must be an unsigned integer.`);
  }
  return text;
}

function nullableIntegerText(value: unknown, label: string): string | null {
  return value === null ? null : integerText(value, label);
}

function numberValue(value: unknown, label: string): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw invariantError(`${label} must be a safe unsigned integer.`);
  }
  return number;
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

function nullableTimestamp(value: unknown, label: string): string | null {
  return value === null ? null : timestampValue(value, label);
}

function bytewiseCompare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function invariantError(
  message: string
): InboxV2SourceNormalizationPersistenceInvariantError {
  return new InboxV2SourceNormalizationPersistenceInvariantError(message);
}
