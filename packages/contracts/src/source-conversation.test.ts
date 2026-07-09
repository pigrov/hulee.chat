import { describe, expect, it } from "vitest";

import type {
  ClientId,
  ConversationId,
  NormalizedInboundEventId,
  RawInboundEventId,
  SourceAccountId,
  SourceConnectionId,
  TenantId
} from "./index";
import {
  normalizeSourceConversationKeyCandidates,
  normalizeSourceConversationResolverInput,
  sourceConversationResolverInputSchema
} from "./source-conversation";

const tenantId = "tenant_source" as TenantId;
const sourceConnectionId =
  "source_connection:marketplace:1" as SourceConnectionId;
const sourceAccountId = "source_account:marketplace:shop" as SourceAccountId;
const rawEventId = "raw_evt_order_question" as RawInboundEventId;
const normalizedEventId = "norm_evt_order_question" as NormalizedInboundEventId;
const clientId = "client_marketplace_customer" as ClientId;
const existingConversationId = "conversation_order_1" as ConversationId;

describe("source conversation resolver input", () => {
  it("normalizes marketplace conversation context and key candidates", () => {
    expect(
      normalizeSourceConversationResolverInput({
        tenantId,
        sourceConnectionId,
        sourceAccountId,
        sourceType: "marketplace",
        sourceName: "ozon",
        sourceEventType: "order_question",
        sourceVisibility: "private",
        rawEventId,
        normalizedEventId,
        occurredAt: new Date("2026-07-09T09:10:00.000Z"),
        clientId,
        existingConversationId,
        conversationTypeHint: "client_direct",
        externalThreadId: "question-thread-1",
        externalMessageId: "question-message-1",
        title: "Question about order 100",
        keyCandidates: [
          {
            kind: "order",
            value: "order-100",
            strength: "strong",
            sourceField: "order.id"
          },
          {
            kind: "listing",
            value: "sku-10",
            strength: "weak",
            sourceField: "item.sku"
          }
        ],
        routingHints: {
          queueKey: "marketplace-support",
          priority: "high",
          tags: ["marketplace", "order-question"]
        },
        eventPayload: {
          bodyPreview: "Is delivery still today?"
        }
      })
    ).toEqual({
      tenantId,
      sourceConnectionId,
      sourceAccountId,
      sourceType: "marketplace",
      sourceName: "ozon",
      sourceEventType: "order_question",
      sourceVisibility: "private",
      rawEventId,
      normalizedEventId,
      occurredAt: "2026-07-09T09:10:00.000Z",
      clientId,
      existingConversationId,
      conversationTypeHint: "client_direct",
      externalThreadId: "question-thread-1",
      externalMessageId: "question-message-1",
      title: "Question about order 100",
      keyCandidates: [
        {
          kind: "external_thread",
          value: "question-thread-1",
          strength: "exact",
          sourceField: "externalThreadId"
        },
        {
          kind: "order",
          value: "order-100",
          strength: "strong",
          sourceField: "order.id"
        },
        {
          kind: "listing",
          value: "sku-10",
          strength: "weak",
          sourceField: "item.sku"
        }
      ],
      routingHints: {
        queueKey: "marketplace-support",
        priority: "high",
        tags: ["marketplace", "order-question"]
      },
      eventPayload: {
        bodyPreview: "Is delivery still today?"
      }
    });
  });

  it("supports non-threaded lead sources with explicit key candidates", () => {
    expect(
      normalizeSourceConversationResolverInput({
        tenantId,
        sourceConnectionId: "source_connection:webform:1",
        sourceType: "form",
        sourceName: "website_contact_form",
        sourceEventType: "lead",
        sourceVisibility: "private",
        conversationTypeHint: "intake",
        keyCandidates: [
          {
            kind: "form_submission",
            value: "submission-1",
            strength: "exact",
            sourceField: "submission.id"
          }
        ],
        summary: "Customer requested a callback"
      })
    ).toMatchObject({
      sourceType: "form",
      sourceEventType: "lead",
      conversationTypeHint: "intake",
      summary: "Customer requested a callback",
      keyCandidates: [
        {
          kind: "form_submission",
          value: "submission-1",
          strength: "exact",
          sourceField: "submission.id"
        }
      ]
    });
  });

  it("deduplicates key candidates and keeps the strongest version", () => {
    expect(
      normalizeSourceConversationKeyCandidates([
        {
          kind: "order",
          value: "ORDER-100",
          strength: "weak",
          sourceField: "message.text"
        },
        {
          kind: "order",
          value: "order-100",
          strength: "exact",
          sourceField: "order.id"
        },
        {
          kind: "listing",
          value: "sku-10",
          strength: "strong"
        }
      ])
    ).toEqual([
      {
        kind: "order",
        value: "order-100",
        strength: "exact",
        sourceField: "order.id"
      },
      {
        kind: "listing",
        value: "sku-10",
        strength: "strong"
      }
    ]);
  });

  it("rejects resolver inputs without conversation keys", () => {
    expect(() =>
      normalizeSourceConversationResolverInput({
        tenantId,
        sourceConnectionId,
        sourceType: "review",
        sourceName: "maps",
        sourceEventType: "review",
        sourceVisibility: "public"
      })
    ).toThrow();
  });

  it("validates resolver input shape at the contract boundary", () => {
    expect(() =>
      sourceConversationResolverInputSchema.parse({
        tenantId,
        sourceConnectionId,
        sourceType: "marketplace",
        sourceName: "ozon",
        sourceEventType: "order_question",
        sourceVisibility: "private",
        keyCandidates: [
          {
            kind: "unknown",
            value: "order-100"
          }
        ]
      })
    ).toThrow();
  });
});
