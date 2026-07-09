import { describe, expect, it } from "vitest";

import type {
  NormalizedInboundEvent,
  NormalizedInboundEventId,
  RawInboundEvent,
  RawInboundEventId,
  SourceAccountId,
  SourceConnectionId,
  TenantId
} from "./index";
import {
  assertSourceNormalizerContract,
  SourceNormalizerContractError
} from "./source-normalizer-contract";

const tenantId = "tenant_source_contract" as TenantId;
const otherTenantId = "tenant_other" as TenantId;
const sourceConnectionId =
  "source_connection:marketplace:ozon" as SourceConnectionId;
const sourceAccountId = "source_account:marketplace:shop" as SourceAccountId;
const rawEventId = "raw_evt_contract_1" as RawInboundEventId;
const normalizedEventId = "norm_evt_contract_1" as NormalizedInboundEventId;

describe("source normalizer contract", () => {
  it("accepts a normalized source event with resolver handoff inputs", () => {
    expect(
      assertSourceNormalizerContract({
        name: "ozon order question",
        adapter: {
          sourceType: "marketplace",
          sourceName: "ozon"
        },
        rawEvent: validRawEvent(),
        events: [
          {
            normalizedEvent: validNormalizedEvent(),
            identityResolverInput: {
              tenantId,
              sourceConnectionId,
              sourceAccountId,
              sourceType: "marketplace",
              sourceName: "ozon",
              sourceEventType: "order_question",
              sourceVisibility: "private",
              rawEventId,
              normalizedEventId,
              externalThreadId: "question-thread-1",
              externalUserId: "buyer-1",
              candidates: [
                {
                  kind: "source_customer_id",
                  value: "buyer-1",
                  confidence: "strong"
                }
              ]
            },
            conversationResolverInput: {
              tenantId,
              sourceConnectionId,
              sourceAccountId,
              sourceType: "marketplace",
              sourceName: "ozon",
              sourceEventType: "order_question",
              sourceVisibility: "private",
              rawEventId,
              normalizedEventId,
              conversationTypeHint: "client_direct",
              externalThreadId: "question-thread-1",
              keyCandidates: [
                {
                  kind: "order",
                  value: "order-100",
                  strength: "strong"
                }
              ]
            }
          }
        ]
      })
    ).toEqual({
      name: "ozon order question",
      eventCount: 1,
      sourceType: "marketplace",
      sourceName: "ozon"
    });
  });

  it("rejects tenant boundary mismatches", () => {
    expect(() =>
      assertSourceNormalizerContract({
        name: "cross tenant leak",
        adapter: {
          sourceType: "marketplace",
          sourceName: "ozon"
        },
        rawEvent: validRawEvent(),
        events: [
          {
            normalizedEvent: {
              ...validNormalizedEvent(),
              tenantId: otherTenantId
            }
          }
        ]
      })
    ).toThrow(SourceNormalizerContractError);
  });

  it("requires resolver inputs for inbound source events", () => {
    expect(() =>
      assertSourceNormalizerContract({
        name: "missing resolver handoff",
        adapter: {
          sourceType: "marketplace",
          sourceName: "ozon"
        },
        rawEvent: validRawEvent(),
        events: [
          {
            normalizedEvent: validNormalizedEvent()
          }
        ]
      })
    ).toThrow(/identityResolverInput/);
  });

  it("allows ignored or duplicate raw events without normalized events", () => {
    expect(
      assertSourceNormalizerContract({
        name: "duplicate raw update",
        adapter: {
          sourceType: "marketplace",
          sourceName: "ozon"
        },
        rawEvent: {
          ...validRawEvent(),
          processingStatus: "duplicate"
        },
        events: []
      })
    ).toMatchObject({
      eventCount: 0
    });
  });

  it("rejects incorrect source idempotency phases", () => {
    expect(() =>
      assertSourceNormalizerContract({
        name: "bad raw key",
        adapter: {
          sourceType: "marketplace",
          sourceName: "ozon"
        },
        rawEvent: {
          ...validRawEvent(),
          idempotencyKey:
            "source:v1:normalized:webhook:connection:account:message:external_event:1"
        },
        events: []
      })
    ).toThrow(/raw phase/);
  });
});

function validRawEvent(): RawInboundEvent {
  return {
    id: rawEventId,
    tenantId,
    sourceConnectionId,
    sourceAccountId,
    externalEventId: "provider-event-1",
    idempotencyKey:
      "source:v1:raw:webhook:source_connection%3Amarketplace%3Aozon:source_account%3Amarketplace%3Ashop:_:external_event:provider-event-1",
    receivedAt: "2026-07-09T11:00:00.000Z",
    providerTimestamp: "2026-07-09T10:59:00.000Z",
    payload: {
      id: "provider-event-1"
    },
    processingStatus: "new",
    createdAt: "2026-07-09T11:00:00.000Z",
    updatedAt: "2026-07-09T11:00:00.000Z"
  };
}

function validNormalizedEvent(): NormalizedInboundEvent {
  return {
    id: normalizedEventId,
    rawEventId,
    tenantId,
    sourceConnectionId,
    sourceAccountId,
    sourceType: "marketplace",
    sourceName: "ozon",
    eventType: "order_question",
    direction: "inbound",
    visibility: "private",
    externalThreadId: "question-thread-1",
    externalMessageId: "question-message-1",
    externalUserId: "buyer-1",
    payloadVersion: "v1",
    normalizedPayload: {
      text: "Is delivery today?"
    },
    replyCapability: {
      mode: "native_reply"
    },
    idempotencyKey:
      "source:v1:normalized:webhook:source_connection%3Amarketplace%3Aozon:source_account%3Amarketplace%3Ashop:order_question:external_event:provider-event-1",
    processingStatus: "new",
    createdAt: "2026-07-09T11:00:00.000Z",
    updatedAt: "2026-07-09T11:00:00.000Z"
  };
}
