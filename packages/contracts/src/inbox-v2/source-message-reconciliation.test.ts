import { describe, expect, it } from "vitest";

import {
  INBOX_V2_PROVIDER_ORDERING_POSITION_MAX_DIGITS,
  inboxV2ProviderOrderingPositionSchema
} from "./provider-semantic-proof";

import {
  INBOX_V2_SOURCE_MESSAGE_RECONCILIATION_PLAN_SCHEMA_ID,
  INBOX_V2_SOURCE_MESSAGE_RECONCILIATION_SCHEMA_VERSION,
  INBOX_V2_SOURCE_MESSAGE_WEAK_CORRELATION_EVIDENCE_MAX,
  inboxV2SourceMessageAdapterIntentDescriptorSchema,
  inboxV2SourceMessageExactOutboundCorrelationSchema,
  inboxV2SourceMessageObservationOriginDescriptorSchema,
  inboxV2SourceMessageWeakCorrelationEvidenceListSchema,
  inboxV2SourceMessageWeakCorrelationEvidenceSchema
} from "./source-message-reconciliation";

function weakEvidence(index: number) {
  return {
    codeId: `core:weak-correlation-${index}`,
    evidenceHmacSha256: `hmac-sha256:${index.toString(16).padStart(64, "0")}`,
    expiresAt: "2026-07-17T09:00:00.000Z"
  };
}

describe("Inbox V2 source-message reconciliation contracts", () => {
  it("publishes one versioned provider-neutral plan contract", () => {
    expect(INBOX_V2_SOURCE_MESSAGE_RECONCILIATION_PLAN_SCHEMA_ID).toBe(
      "core:inbox-v2.source-message-reconciliation-plan"
    );
    expect(INBOX_V2_SOURCE_MESSAGE_RECONCILIATION_SCHEMA_VERSION).toBe("v1");
  });

  it("keeps weak evidence bounded, canonical and target-free", () => {
    const evidence = weakEvidence(1);
    expect(
      inboxV2SourceMessageWeakCorrelationEvidenceSchema.safeParse(evidence)
        .success
    ).toBe(true);
    expect(
      inboxV2SourceMessageWeakCorrelationEvidenceSchema.safeParse({
        ...evidence,
        messageId: "message:latest"
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceMessageWeakCorrelationEvidenceListSchema.safeParse([
        evidence,
        evidence
      ]).success
    ).toBe(false);
    expect(
      inboxV2SourceMessageWeakCorrelationEvidenceListSchema.safeParse(
        Array.from(
          { length: INBOX_V2_SOURCE_MESSAGE_WEAK_CORRELATION_EVIDENCE_MAX + 1 },
          (_, index) => weakEvidence(index + 1)
        )
      ).success
    ).toBe(false);
  });

  it("reserves provider responses for MSG-007 and accepts only provider echoes", () => {
    expect(
      inboxV2SourceMessageObservationOriginDescriptorSchema.safeParse({
        kind: "provider_response",
        outboundDispatchAttempt: {
          tenantId: "tenant:alpha",
          kind: "outbound_dispatch_attempt",
          id: "outbound_dispatch_attempt:attempt-1"
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceMessageAdapterIntentDescriptorSchema.safeParse({
        kind: "echo_handoff",
        transportRole: "provider_response",
        exactOutboundCorrelation: null
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceMessageAdapterIntentDescriptorSchema.safeParse({
        kind: "echo_handoff",
        transportRole: "provider_echo",
        exactOutboundCorrelation: null
      }).success
    ).toBe(true);
  });

  it("keeps exact echo correlation provider-owned and target-free", () => {
    const exact = {
      providerReferenceKindId: "module:synthetic:client-correlation-token",
      correlationToken: "provider:idempotency-0001",
      artifactOrdinal: 2
    };
    expect(
      inboxV2SourceMessageExactOutboundCorrelationSchema.safeParse(exact)
        .success
    ).toBe(true);
    expect(
      inboxV2SourceMessageAdapterIntentDescriptorSchema.safeParse({
        kind: "echo_handoff",
        transportRole: "provider_echo",
        exactOutboundCorrelation: exact
      }).success
    ).toBe(true);
    expect(
      inboxV2SourceMessageExactOutboundCorrelationSchema.safeParse({
        ...exact,
        messageId: "message:adapter-selected"
      }).success
    ).toBe(false);
  });

  it("bounds exact provider ordering positions before BigInt comparison", () => {
    expect(
      inboxV2ProviderOrderingPositionSchema.safeParse(
        "9".repeat(INBOX_V2_PROVIDER_ORDERING_POSITION_MAX_DIGITS)
      ).success
    ).toBe(true);
    expect(
      inboxV2ProviderOrderingPositionSchema.safeParse(
        "9".repeat(INBOX_V2_PROVIDER_ORDERING_POSITION_MAX_DIGITS + 1)
      ).success
    ).toBe(false);
  });
});
