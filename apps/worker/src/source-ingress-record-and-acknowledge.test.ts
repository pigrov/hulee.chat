import {
  defineInboxV2RawIngressSanitizer,
  defineInboxV2RawIngressSanitizerProfile,
  inboxV2RecordRawIngressResultSchema,
  inboxV2SourceAccountIdSchema,
  inboxV2SourceCursorDurableTargetLookupResultSchema,
  inboxV2SourceCursorPersistenceResultSchema,
  sanitizeInboxV2RawIngress,
  type InboxV2RawIngressInput,
  type InboxV2RecordRawIngressResult,
  type InboxV2SanitizedRawIngressCandidate,
  type InboxV2SourceProcessingRuntimeRepositoryPort
} from "@hulee/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  createInboxV2SourceIngressDatabaseCursorAcknowledger,
  createInboxV2SourceIngressRecordAndAcknowledgeSeam,
  type InboxV2SourceIngressCursorRequest
} from "./source-ingress-record-and-acknowledge";

const t0 = "2026-07-17T10:00:00.000Z";
const t1 = "2026-07-17T10:00:01.000Z";
const t2 = "2026-07-17T10:00:02.000Z";

describe("Inbox V2 source ingress record-and-acknowledge seam", () => {
  it("acknowledges only after the exact raw occurrence is durable", async () => {
    const candidate = await acceptedCandidate("source_account:alpha");
    const order: string[] = [];
    const admission = recordedAdmission(candidate, "alpha");
    const record = vi.fn(async () => {
      order.push("raw-durable");
      return admission;
    });
    const acknowledge = vi.fn(async (input) => {
      order.push("cursor-acknowledged");
      expect(input.admission).toEqual(admission);
      return cursorResult("acknowledged", "1");
    });
    const seam = createInboxV2SourceIngressRecordAndAcknowledgeSeam({
      rawIngress: { record },
      cursorAcknowledger: { acknowledge }
    });

    await expect(
      seam.recordAndAcknowledge({
        candidate,
        cursor: cursorRequest(candidate)
      })
    ).resolves.toEqual({
      outcome: "acknowledged",
      admission,
      checkpointRevision: "1"
    });
    expect(order).toEqual(["raw-durable", "cursor-acknowledged"]);
    expect(record).toHaveBeenCalledOnce();
    expect(acknowledge).toHaveBeenCalledOnce();
  });

  it("acknowledges a durably quarantined poison occurrence without fabricating raw work", async () => {
    const candidate = await quarantinedCandidate("source_account:alpha");
    const admission = inboxV2RecordRawIngressResultSchema.parse({
      outcome: "quarantined",
      source: sourceScope(candidate),
      quarantineId: "core:source-quarantine-alpha",
      existingRawEventId: null,
      safeEnvelopeDigest: candidate.safeEnvelopeDigest,
      reasonCode: "source.sanitizer_rejected"
    });
    const acknowledge = vi.fn(async (input) => {
      expect(input.admission).toEqual(admission);
      expect(input.admission).not.toHaveProperty("work");
      return cursorResult("acknowledged", "4");
    });
    const seam = createInboxV2SourceIngressRecordAndAcknowledgeSeam({
      rawIngress: { record: vi.fn(async () => admission) },
      cursorAcknowledger: { acknowledge }
    });

    await expect(
      seam.recordAndAcknowledge({
        candidate,
        cursor: cursorRequest(candidate)
      })
    ).resolves.toMatchObject({
      outcome: "acknowledged",
      admission: { outcome: "quarantined" },
      checkpointRevision: "4"
    });
    expect(acknowledge).toHaveBeenCalledOnce();
  });

  it("never calls cursor acknowledgement when durable admission fails", async () => {
    const candidate = await acceptedCandidate("source_account:alpha");
    const acknowledge = vi.fn();
    const seam = createInboxV2SourceIngressRecordAndAcknowledgeSeam({
      rawIngress: {
        record: vi.fn(async () => {
          throw new Error("durable raw admission failed");
        })
      },
      cursorAcknowledger: { acknowledge }
    });

    await expect(
      seam.recordAndAcknowledge({
        candidate,
        cursor: cursorRequest(candidate)
      })
    ).rejects.toThrow(/durable raw admission failed/u);
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it("never acknowledges when the tenant raw-admission key is unavailable", async () => {
    const candidate = await acceptedCandidate("source_account:alpha");
    const acknowledge = vi.fn();
    const seam = createInboxV2SourceIngressRecordAndAcknowledgeSeam({
      rawIngress: {
        record: vi.fn(async () => ({ outcome: "key_unavailable" as const }))
      },
      cursorAcknowledger: { acknowledge }
    });

    await expect(
      seam.recordAndAcknowledge({
        candidate,
        cursor: cursorRequest(candidate)
      })
    ).rejects.toThrow(/admission key is unavailable/u);
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it("coalesces an exact raw retry with an already durable cursor acknowledgement", async () => {
    const candidate = await acceptedCandidate("source_account:alpha");
    const admission = inboxV2RecordRawIngressResultSchema.parse({
      outcome: "duplicate",
      source: sourceScope(candidate),
      rawEventId: "raw_inbound_event:record-and-ack-alpha",
      safeEnvelopeDigest: candidate.safeEnvelopeDigest,
      matchedKeyGenerations: ["generation-1"]
    });
    const acknowledge = vi.fn(async (input) => {
      expect(input.admission).toEqual(admission);
      return cursorResult("already_acknowledged", "7");
    });
    const seam = createInboxV2SourceIngressRecordAndAcknowledgeSeam({
      rawIngress: { record: vi.fn(async () => admission) },
      cursorAcknowledger: { acknowledge }
    });

    await expect(
      seam.recordAndAcknowledge({
        candidate,
        cursor: cursorRequest(candidate, {
          expectedCheckpointRevision: "7"
        })
      })
    ).resolves.toEqual({
      outcome: "already_acknowledged",
      admission,
      checkpointRevision: "7"
    });
  });

  it("surfaces a durable cursor rejection without claiming provider progress", async () => {
    const candidate = await acceptedCandidate("source_account:alpha");
    const admission = recordedAdmission(candidate, "rejected");
    const seam = createInboxV2SourceIngressRecordAndAcknowledgeSeam({
      rawIngress: { record: vi.fn(async () => admission) },
      cursorAcknowledger: {
        acknowledge: vi.fn(async () => ({
          outcome: "durable_work_mismatch" as const
        }))
      }
    });

    await expect(
      seam.recordAndAcknowledge({
        candidate,
        cursor: cursorRequest(candidate)
      })
    ).resolves.toEqual({
      outcome: "cursor_rejected",
      admission,
      cursor: { outcome: "durable_work_mismatch" }
    });
  });

  it("rejects cross-account cursor substitution before either durable call", async () => {
    const candidate = await acceptedCandidate("source_account:alpha");
    const record = vi.fn();
    const acknowledge = vi.fn();
    const seam = createInboxV2SourceIngressRecordAndAcknowledgeSeam({
      rawIngress: { record },
      cursorAcknowledger: { acknowledge }
    });

    await expect(
      seam.recordAndAcknowledge({
        candidate,
        cursor: cursorRequest(candidate, {
          source: {
            tenantId: candidate.tenantId,
            sourceConnectionId: candidate.sourceConnectionId,
            sourceAccountId: inboxV2SourceAccountIdSchema.parse(
              "source_account:beta"
            )
          }
        })
      })
    ).rejects.toThrow(/exactly match.*tenant, connection and account/u);
    expect(record).not.toHaveBeenCalled();
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it("resolves an immutable quarantine receipt before acknowledging the poisoned cursor", async () => {
    const candidate = await quarantinedCandidate("source_account:alpha");
    const admission = inboxV2RecordRawIngressResultSchema.parse({
      outcome: "quarantined",
      source: sourceScope(candidate),
      quarantineId: "core:source-quarantine-alpha",
      existingRawEventId: null,
      safeEnvelopeDigest: candidate.safeEnvelopeDigest,
      reasonCode: "source.sanitizer_rejected"
    });
    if (admission.outcome !== "quarantined") {
      throw new Error("quarantine fixture invariant");
    }
    const resolution = inboxV2SourceCursorDurableTargetLookupResultSchema.parse(
      {
        outcome: "resolved",
        target: {
          kind: "quarantine",
          source: sourceScope(candidate),
          quarantineId: admission.quarantineId,
          quarantineFingerprintSha256: `sha256:${"f".repeat(64)}`,
          reasonCode: admission.reasonCode,
          persistedAt: t1
        },
        resolvedAt: t2
      }
    );
    const resolveCursorDurableTarget = vi.fn(async () => resolution);
    const acknowledgeCursor = vi.fn(
      async (
        input: Parameters<
          InboxV2SourceProcessingRuntimeRepositoryPort["acknowledgeCursor"]
        >[0]
      ) => {
        expect(input.acknowledgement.target).toMatchObject({
          kind: "quarantine",
          quarantineId: admission.quarantineId
        });
        expect(input.acknowledgement.target).not.toHaveProperty(
          "durableWorkId"
        );
        expect(input.acknowledgement.acknowledgedAt).toBe(t2);
        return cursorResult("acknowledged", "8");
      }
    );
    const adapter = createInboxV2SourceIngressDatabaseCursorAcknowledger({
      resolveCursorDurableTarget,
      acknowledgeCursor
    });

    await expect(
      adapter.acknowledge({ ...cursorRequest(candidate), admission })
    ).resolves.toEqual(cursorResult("acknowledged", "8"));
    expect(resolveCursorDurableTarget).toHaveBeenCalledOnce();
    expect(acknowledgeCursor).toHaveBeenCalledOnce();
  });

  it("fails closed when a duplicate receipt has no exact durable raw work", async () => {
    const candidate = await acceptedCandidate("source_account:alpha");
    const admission = inboxV2RecordRawIngressResultSchema.parse({
      outcome: "duplicate",
      source: sourceScope(candidate),
      rawEventId: "raw_inbound_event:missing-after-crash",
      safeEnvelopeDigest: candidate.safeEnvelopeDigest,
      matchedKeyGenerations: ["generation-1"]
    });
    if (admission.outcome !== "duplicate") {
      throw new Error("duplicate fixture invariant");
    }
    const acknowledgeCursor = vi.fn();
    const adapter = createInboxV2SourceIngressDatabaseCursorAcknowledger({
      resolveCursorDurableTarget: vi.fn(async () => ({
        outcome: "not_found" as const
      })),
      acknowledgeCursor
    });

    await expect(
      adapter.acknowledge({ ...cursorRequest(candidate), admission })
    ).resolves.toEqual({ outcome: "durable_work_not_found" });
    expect(acknowledgeCursor).not.toHaveBeenCalled();
  });

  it("accepts a production HMAC receipt only through the database-backed adapter", async () => {
    const candidate = await acceptedCandidate("source_account:alpha");
    const hmacAdmission = inboxV2RecordRawIngressResultSchema.parse({
      ...recordedAdmission(candidate, "hmac"),
      safeEnvelopeDigest: `hmac-sha256:${"e".repeat(64)}`
    });
    if (hmacAdmission.outcome === "key_unavailable") {
      throw new Error("HMAC fixture invariant");
    }
    const acknowledge = vi.fn();
    const seam = createInboxV2SourceIngressRecordAndAcknowledgeSeam({
      rawIngress: { record: vi.fn(async () => hmacAdmission) },
      cursorAcknowledger: { acknowledge }
    });

    await expect(
      seam.recordAndAcknowledge({
        candidate,
        cursor: cursorRequest(candidate)
      })
    ).rejects.toThrow(/database-backed durable cursor adapter/u);
    expect(acknowledge).not.toHaveBeenCalled();
  });
});

async function acceptedCandidate(
  sourceAccountId: string
): Promise<InboxV2SanitizedRawIngressCandidate> {
  const result = await sanitizeInboxV2RawIngress({
    sanitizer: sanitizer(async () => ({
      outcome: "accepted",
      restrictedPayload: { message: "safe" },
      validatedAllowedHeaders: []
    })),
    request: rawRequest(sourceAccountId)
  });
  if (result.outcome !== "accepted") throw new Error("fixture invariant");
  return result.candidate;
}

async function quarantinedCandidate(
  sourceAccountId: string
): Promise<InboxV2SanitizedRawIngressCandidate> {
  const result = await sanitizeInboxV2RawIngress({
    sanitizer: sanitizer(async () => ({
      outcome: "quarantined",
      reasonCode: "source.sanitizer_rejected"
    })),
    request: rawRequest(sourceAccountId)
  });
  if (result.outcome !== "quarantined") throw new Error("fixture invariant");
  return result.candidate;
}

function sanitizer(
  handler: Parameters<typeof defineInboxV2RawIngressSanitizer>[0]["handler"]
) {
  return defineInboxV2RawIngressSanitizer({
    profile: defineInboxV2RawIngressSanitizerProfile({
      schemaId: "core:inbox-v2.raw-ingress-sanitizer-profile",
      schemaVersion: "v1",
      payload: {
        adapterContract: {
          contractId: "module:synthetic:record-and-ack",
          contractVersion: "v1",
          declarationRevision: "1",
          surfaceId: "core:direct-messenger",
          loadedByTrustedServiceId: "core:source-runtime",
          loadedAt: t0
        },
        handlerId: "module:synthetic:record-and-ack-sanitizer",
        handlerVersion: "v1",
        declarationRevision: "1",
        restrictedPayloadSchema: {
          schemaId: "module:synthetic:record-and-ack-payload",
          schemaVersion: "v1"
        },
        persistedHeaderNames: [],
        payloadClassification: {
          dataClassId: "core:raw_provider_payload",
          purposeIds: ["core:source_replay_and_diagnostics"]
        },
        allowedHeadersClassification: {
          dataClassId: "core:raw_provider_allowed_headers",
          purposeIds: ["core:source_replay_and_diagnostics"]
        }
      }
    }),
    handler,
    parseRestrictedPayload: (value) => value
  });
}

function rawRequest(sourceAccountId: string): InboxV2RawIngressInput {
  return {
    tenantId: "tenant:alpha",
    sourceConnectionId: "source_connection:alpha",
    sourceAccountId,
    transport: "polling",
    eventIdentity: {
      kind: "provider_event_id",
      value: `event-${sourceAccountId}`
    },
    providerOccurredAt: t0,
    receivedAt: t1,
    sanitizedAt: t2,
    body: new TextEncoder().encode('{"message":"safe"}'),
    headers: {}
  };
}

function recordedAdmission(
  candidate: InboxV2SanitizedRawIngressCandidate,
  label: string
): InboxV2RecordRawIngressResult {
  const rawEventId = `raw_inbound_event:record-and-ack-${label}`;
  return inboxV2RecordRawIngressResultSchema.parse({
    outcome: "recorded",
    source: sourceScope(candidate),
    rawEventId,
    safeEnvelopeDigest: candidate.safeEnvelopeDigest,
    work: {
      tenantId: candidate.tenantId,
      rawEventId,
      state: "pending",
      attemptCount: "0",
      lease: null,
      revision: "1",
      updatedAt: t2
    }
  });
}

function sourceScope(candidate: InboxV2SanitizedRawIngressCandidate) {
  return {
    tenantId: candidate.tenantId,
    sourceConnectionId: candidate.sourceConnectionId,
    sourceAccountId: candidate.sourceAccountId
  };
}

function cursorRequest(
  candidate: InboxV2SanitizedRawIngressCandidate,
  overrides: Partial<InboxV2SourceIngressCursorRequest> = {}
): InboxV2SourceIngressCursorRequest {
  return {
    source: {
      tenantId: candidate.tenantId,
      sourceConnectionId: candidate.sourceConnectionId,
      sourceAccountId: candidate.sourceAccountId
    },
    cursorOwner: "source_account",
    sourceThreadBindingId: null,
    cursorSlotId: "source-cursor:receive",
    routeGeneration: "1",
    expectedCheckpointRevision: null,
    cursor: { kind: "receive_cursor", value: "provider-cursor:42" },
    ...overrides
  };
}

function cursorResult(
  outcome: "acknowledged" | "already_acknowledged",
  revision: string
) {
  return inboxV2SourceCursorPersistenceResultSchema.parse({
    outcome,
    revision
  });
}
