import { describe, expect, it } from "vitest";

import {
  publicApiDeliveryStatusResponseSchema,
  publicApiErrorResponseSchema,
  publicApiInboundMessageRequestSchema,
  publicApiOutboundMessageRequestSchema,
  publicApiRegisterClientRequestSchema
} from "./public-api-v1";

describe("public API v1 schemas", () => {
  it("parses client registration with normalized defaults", () => {
    expect(
      publicApiRegisterClientRequestSchema.parse({
        externalId: "client-1",
        displayName: "Alice"
      })
    ).toEqual({
      externalId: "client-1",
      displayName: "Alice",
      contacts: []
    });
  });

  it("rejects inbound messages without text or attachments", () => {
    expect(() =>
      publicApiInboundMessageRequestSchema.parse({
        clientExternalId: "client-1",
        channelExternalId: "public-api",
        providerMessageId: "provider-message-1",
        occurredAt: "2026-06-22T07:00:00.000Z",
        idempotencyKey: "inbound-1"
      })
    ).toThrow();
  });

  it("parses outbound messages with tenant-safe attachment references", () => {
    expect(
      publicApiOutboundMessageRequestSchema.parse({
        conversationId: "conversation-1",
        idempotencyKey: "outbound-1",
        attachments: [
          {
            fileName: "invoice.pdf",
            mediaType: "application/pdf",
            sizeBytes: 1024,
            storageKey: "tenant/tenant-1/files/file-1/invoice.pdf"
          }
        ]
      })
    ).toMatchObject({
      conversationId: "conversation-1",
      idempotencyKey: "outbound-1"
    });
  });

  it("rejects unknown request properties", () => {
    expect(() =>
      publicApiRegisterClientRequestSchema.parse({
        externalId: "client-1",
        displayName: "Alice",
        providerSpecificFlag: true
      })
    ).toThrow();
  });

  it("allows versioned platform error codes in delivery status responses", () => {
    expect(
      publicApiDeliveryStatusResponseSchema.parse({
        messageId: "message-1",
        status: "failed",
        errorCode: "provider.temporary_failure",
        updatedAt: "2026-06-22T07:00:00.000Z"
      })
    ).toEqual({
      messageId: "message-1",
      status: "failed",
      errorCode: "provider.temporary_failure",
      updatedAt: "2026-06-22T07:00:00.000Z"
    });
  });

  it("defines a stable error response envelope", () => {
    expect(
      publicApiErrorResponseSchema.parse({
        error: {
          code: "validation.failed",
          messageKey: "errors.validation.failed",
          retryability: "not_retryable",
          requestId: "request-1"
        }
      })
    ).toEqual({
      error: {
        code: "validation.failed",
        messageKey: "errors.validation.failed",
        retryability: "not_retryable",
        requestId: "request-1"
      }
    });
  });
});
