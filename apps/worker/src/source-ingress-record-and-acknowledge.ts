import {
  inboxV2EntityRevisionSchema,
  inboxV2RecordRawIngressResultSchema,
  inboxV2RoutingTokenSchema,
  inboxV2SourceCursorLoadInputSchema,
  inboxV2SourceCursorDurableTargetLookupInputSchema,
  inboxV2SourceCursorPersistenceInputSchema,
  inboxV2SourceCursorPersistenceResultSchema,
  inboxV2SourceCursorPositionSchema,
  inboxV2SourceProcessingSourceScopeSchema,
  isInboxV2SanitizedRawIngressCandidate,
  type InboxV2RawIngressRepositoryPort,
  type InboxV2RecordRawIngressResult,
  type InboxV2SanitizedRawIngressCandidate,
  type InboxV2SourceCursorPersistenceResult,
  type InboxV2SourceCursorPosition,
  type InboxV2SourceCursorDurableTargetResolverPort,
  type InboxV2SourceProcessingRuntimeRepositoryPort,
  type InboxV2SourceProcessingSourceScope
} from "@hulee/contracts";

export type InboxV2SourceIngressCursorRequest = Readonly<{
  source: InboxV2SourceProcessingSourceScope;
  cursorOwner: "source_connection" | "source_account" | "source_thread_binding";
  sourceThreadBindingId: string | null;
  cursorSlotId: string;
  routeGeneration: string;
  expectedCheckpointRevision: string | null;
  cursor: InboxV2SourceCursorPosition;
}>;

export type InboxV2SourceIngressDurableAdmissionReceipt = Exclude<
  InboxV2RecordRawIngressResult,
  { outcome: "key_unavailable" }
>;

/**
 * Local persistence hand-off for Inbox V2 source adapters. It deliberately
 * accepts the durable admission receipt rather than a caller-asserted raw ID,
 * and it supports durable quarantine even though the current public cursor
 * contract can only name a raw-ingress work row.
 */
export type InboxV2SourceIngressDurableCursorAcknowledgeInput = Readonly<{
  source: InboxV2SourceProcessingSourceScope;
  cursorOwner: InboxV2SourceIngressCursorRequest["cursorOwner"];
  sourceThreadBindingId: string | null;
  cursorSlotId: string;
  routeGeneration: string;
  expectedCheckpointRevision: string | null;
  cursor: InboxV2SourceCursorPosition;
  admission: InboxV2SourceIngressDurableAdmissionReceipt;
}>;

export interface InboxV2SourceIngressDurableCursorAcknowledgerPort {
  acknowledge(
    input: InboxV2SourceIngressDurableCursorAcknowledgeInput
  ): Promise<InboxV2SourceCursorPersistenceResult>;
}

const databaseBackedCursorAcknowledgers = new WeakSet<object>();

/**
 * Resolves the immutable database receipt before building a cursor target.
 * This is the only path allowed to accept production HMAC envelope receipts;
 * exact raw work/quarantine fences are loaded from SQL and revalidated again
 * by acknowledgeCursor after cursor protection.
 */
export function createInboxV2SourceIngressDatabaseCursorAcknowledger(
  repository: InboxV2SourceCursorDurableTargetResolverPort &
    Pick<InboxV2SourceProcessingRuntimeRepositoryPort, "acknowledgeCursor">
): InboxV2SourceIngressDurableCursorAcknowledgerPort {
  if (
    typeof repository?.resolveCursorDurableTarget !== "function" ||
    typeof repository?.acknowledgeCursor !== "function"
  ) {
    throw new TypeError(
      "Source ingress cursor adapter requires durable-target resolution and acknowledgement."
    );
  }
  const adapter: InboxV2SourceIngressDurableCursorAcknowledgerPort =
    Object.freeze({
      async acknowledge(
        input: InboxV2SourceIngressDurableCursorAcknowledgeInput
      ) {
        const lookupInput =
          inboxV2SourceCursorDurableTargetLookupInputSchema.parse(
            input.admission.outcome === "quarantined"
              ? {
                  source: input.source,
                  receipt: {
                    kind: "quarantine",
                    quarantineId: input.admission.quarantineId,
                    safeEnvelopeDigest: input.admission.safeEnvelopeDigest,
                    reasonCode: input.admission.reasonCode
                  }
                }
              : {
                  source: input.source,
                  receipt: {
                    kind: "raw_work",
                    rawEventId: input.admission.rawEventId,
                    safeEnvelopeDigest: input.admission.safeEnvelopeDigest
                  }
                }
          );
        const resolution =
          await repository.resolveCursorDurableTarget(lookupInput);
        if (resolution.outcome !== "resolved") {
          const quarantine = lookupInput.receipt.kind === "quarantine";
          return inboxV2SourceCursorPersistenceResultSchema.parse({
            outcome:
              resolution.outcome === "not_found"
                ? quarantine
                  ? "durable_quarantine_not_found"
                  : "durable_work_not_found"
                : quarantine
                  ? "durable_quarantine_mismatch"
                  : "durable_work_mismatch"
          });
        }
        assertResolvedTargetSource(resolution.target, input.source);
        return repository.acknowledgeCursor(
          inboxV2SourceCursorPersistenceInputSchema.parse({
            acknowledgement: {
              target: resolution.target,
              cursorOwner: input.cursorOwner,
              sourceThreadBindingId: input.sourceThreadBindingId,
              cursor: input.cursor,
              acknowledgedAt: resolution.resolvedAt
            },
            cursorSlotId: input.cursorSlotId,
            routeGeneration: input.routeGeneration,
            expectedCheckpointRevision: input.expectedCheckpointRevision
          })
        );
      }
    });
  databaseBackedCursorAcknowledgers.add(adapter);
  return adapter;
}

type CursorAcknowledgedResult = Extract<
  InboxV2SourceCursorPersistenceResult,
  { outcome: "acknowledged" | "already_acknowledged" }
>;
type CursorRejectedResult = Exclude<
  InboxV2SourceCursorPersistenceResult,
  CursorAcknowledgedResult
>;

export type InboxV2SourceIngressRecordAndAcknowledgeResult =
  | Readonly<{
      outcome: CursorAcknowledgedResult["outcome"];
      admission: InboxV2SourceIngressDurableAdmissionReceipt;
      checkpointRevision: string;
    }>
  | Readonly<{
      outcome: "cursor_rejected";
      admission: InboxV2SourceIngressDurableAdmissionReceipt;
      cursor: CursorRejectedResult;
    }>;

export type InboxV2SourceIngressRecordAndAcknowledgeSeam = Readonly<{
  recordAndAcknowledge(input: {
    candidate: InboxV2SanitizedRawIngressCandidate;
    cursor: InboxV2SourceIngressCursorRequest;
  }): Promise<InboxV2SourceIngressRecordAndAcknowledgeResult>;
}>;

/**
 * Provider-neutral receive/history seam. It never invokes the cursor port
 * until raw ingress has returned a validated durable admission/quarantine
 * receipt. Provider adapters must use this boundary without a compatibility
 * fallback when they advance an external cursor.
 */
export function createInboxV2SourceIngressRecordAndAcknowledgeSeam(options: {
  rawIngress: Pick<InboxV2RawIngressRepositoryPort, "record">;
  cursorAcknowledger: InboxV2SourceIngressDurableCursorAcknowledgerPort;
}): InboxV2SourceIngressRecordAndAcknowledgeSeam {
  if (
    typeof options?.rawIngress?.record !== "function" ||
    typeof options?.cursorAcknowledger?.acknowledge !== "function"
  ) {
    throw new TypeError(
      "Source ingress record-and-acknowledge requires durable raw admission and cursor capabilities."
    );
  }

  return Object.freeze({
    async recordAndAcknowledge(input) {
      if (!isInboxV2SanitizedRawIngressCandidate(input?.candidate)) {
        throw new TypeError(
          "Source ingress record-and-acknowledge requires an authentic sanitized candidate."
        );
      }
      const cursor = parseCursorRequest(input.cursor);
      assertExactSourceScope(input.candidate, cursor.source);

      const admission = assertDurableAdmission(
        input.candidate,
        await options.rawIngress.record(input.candidate)
      );
      if (
        admission.safeEnvelopeDigest.startsWith("hmac-sha256:") &&
        !databaseBackedCursorAcknowledgers.has(options.cursorAcknowledger)
      ) {
        throw new TypeError(
          "Production HMAC admission requires the database-backed durable cursor adapter."
        );
      }
      const cursorResult = inboxV2SourceCursorPersistenceResultSchema.parse(
        await options.cursorAcknowledger.acknowledge(
          Object.freeze({
            ...cursor,
            admission
          })
        )
      );

      if ("revision" in cursorResult) {
        return Object.freeze({
          outcome: cursorResult.outcome,
          admission,
          checkpointRevision: cursorResult.revision
        });
      }
      return Object.freeze({
        outcome: "cursor_rejected" as const,
        admission,
        cursor: cursorResult
      });
    }
  });
}

function parseCursorRequest(
  raw: InboxV2SourceIngressCursorRequest
): InboxV2SourceIngressCursorRequest {
  if (raw === null || typeof raw !== "object") {
    throw new TypeError("Source ingress cursor request is missing.");
  }
  const loadInput = inboxV2SourceCursorLoadInputSchema.parse({
    source: inboxV2SourceProcessingSourceScopeSchema.parse(raw.source),
    cursorOwner: raw.cursorOwner,
    sourceThreadBindingId: raw.sourceThreadBindingId,
    cursorSlotId: raw.cursorSlotId
  });
  return Object.freeze({
    ...loadInput,
    cursorSlotId: inboxV2RoutingTokenSchema.parse(loadInput.cursorSlotId),
    routeGeneration: inboxV2EntityRevisionSchema.parse(raw.routeGeneration),
    expectedCheckpointRevision:
      raw.expectedCheckpointRevision === null
        ? null
        : inboxV2EntityRevisionSchema.parse(raw.expectedCheckpointRevision),
    cursor: inboxV2SourceCursorPositionSchema.parse(raw.cursor)
  });
}

function assertExactSourceScope(
  candidate: InboxV2SanitizedRawIngressCandidate,
  source: InboxV2SourceProcessingSourceScope
): void {
  if (
    candidate.tenantId !== source.tenantId ||
    candidate.sourceConnectionId !== source.sourceConnectionId ||
    candidate.sourceAccountId !== source.sourceAccountId
  ) {
    throw new TypeError(
      "Source ingress cursor scope must exactly match the admitted tenant, connection and account."
    );
  }
}

function assertDurableAdmission(
  candidate: InboxV2SanitizedRawIngressCandidate,
  raw: InboxV2RecordRawIngressResult
): InboxV2SourceIngressDurableAdmissionReceipt {
  const result = inboxV2RecordRawIngressResultSchema.parse(raw);
  if (result.outcome === "key_unavailable") {
    throw new TypeError(
      "Source ingress durable admission key is unavailable; cursor acknowledgement is forbidden."
    );
  }
  assertExactSourceScope(candidate, result.source);
  if (
    result.safeEnvelopeDigest.startsWith("sha256:") &&
    result.safeEnvelopeDigest !== candidate.safeEnvelopeDigest
  ) {
    throw new TypeError(
      "Source ingress durable admission does not match the sanitized envelope."
    );
  }

  if (candidate.disposition.outcome === "quarantined") {
    if (
      result.outcome !== "quarantined" ||
      result.reasonCode !== candidate.disposition.reasonCode
    ) {
      throw new TypeError(
        "Source ingress quarantine candidate has no matching durable quarantine receipt."
      );
    }
  } else if (
    result.outcome === "quarantined" &&
    result.reasonCode !== "source.idempotency_collision"
  ) {
    throw new TypeError(
      "Accepted source ingress may be quarantined only by a durable idempotency collision."
    );
  }

  if (
    result.outcome === "recorded" &&
    (result.work.tenantId !== candidate.tenantId ||
      result.work.rawEventId !== result.rawEventId ||
      result.work.state !== "pending")
  ) {
    throw new TypeError(
      "Source ingress raw admission receipt is outside the exact durable scope."
    );
  }
  return Object.freeze(result);
}

function assertResolvedTargetSource(
  target: Parameters<
    InboxV2SourceProcessingRuntimeRepositoryPort["acknowledgeCursor"]
  >[0]["acknowledgement"]["target"],
  expected: InboxV2SourceProcessingSourceScope
): void {
  const source = target.kind === "raw_work" ? target.scope : target.source;
  if (
    source.tenantId !== expected.tenantId ||
    source.sourceConnectionId !== expected.sourceConnectionId ||
    source.sourceAccountId !== expected.sourceAccountId
  ) {
    throw new TypeError(
      "Resolved source cursor target escaped its tenant, connection or account."
    );
  }
}
