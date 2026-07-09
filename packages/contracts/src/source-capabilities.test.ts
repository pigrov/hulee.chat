import { describe, expect, it } from "vitest";

import {
  defaultSourceCapabilities,
  normalizeSourceCapabilities,
  replyCapabilitySchema,
  resolveReplyCapability,
  sourceCapabilitiesSchema
} from "./source-capabilities";

describe("source capability model", () => {
  it("normalizes partial source capabilities with explicit safe defaults", () => {
    expect(
      normalizeSourceCapabilities({
        canReceive: true,
        canReply: true,
        legalRisk: "high",
        replyWindowSeconds: 86_400
      })
    ).toEqual({
      ...defaultSourceCapabilities,
      canReceive: true,
      canReply: true,
      legalRisk: "high",
      replyWindowSeconds: 86_400
    });
  });

  it("rejects invalid source capability values", () => {
    expect(() =>
      sourceCapabilitiesSchema.parse({
        ...defaultSourceCapabilities,
        replyWindowSeconds: 0
      })
    ).toThrow();
  });

  it("allows native reply while the source is active and inside the reply window", () => {
    expect(
      resolveReplyCapability({
        capabilities: normalizeSourceCapabilities({
          canReceive: true,
          canReply: true,
          replyWindowSeconds: 3_600
        }),
        sourceStatus: "active",
        receivedAt: "2026-07-09T09:00:00.000Z",
        now: "2026-07-09T09:30:00.000Z"
      })
    ).toEqual({
      mode: "native_reply",
      expiresAt: "2026-07-09T10:00:00.000Z"
    });
  });

  it("expires reply capability after the source reply window", () => {
    expect(
      resolveReplyCapability({
        capabilities: normalizeSourceCapabilities({
          canReceive: true,
          canReply: true,
          replyWindowSeconds: 3_600
        }),
        sourceStatus: "active",
        receivedAt: "2026-07-09T09:00:00.000Z",
        now: "2026-07-09T10:00:00.000Z"
      })
    ).toEqual({
      mode: "expired",
      reason: "reply_window_expired",
      expiresAt: "2026-07-09T10:00:00.000Z"
    });
  });

  it("falls back to an external reply link when native reply is unavailable", () => {
    expect(
      resolveReplyCapability({
        capabilities: normalizeSourceCapabilities({
          canReceive: true,
          canReply: false
        }),
        sourceStatus: "degraded",
        externalReplyUrl: "https://seller.example.test/orders/123"
      })
    ).toEqual({
      mode: "external_link",
      externalReplyUrl: "https://seller.example.test/orders/123"
    });
  });

  it("keeps replies readonly when a source is not active", () => {
    expect(
      resolveReplyCapability({
        capabilities: normalizeSourceCapabilities({
          canReceive: true,
          canReply: true
        }),
        sourceStatus: "error"
      })
    ).toEqual({
      mode: "readonly",
      reason: "source_not_active"
    });
  });

  it("returns unsupported when no native or external reply path exists", () => {
    expect(
      resolveReplyCapability({
        capabilities: normalizeSourceCapabilities({
          canReceive: true,
          canReply: false
        }),
        sourceStatus: "active"
      })
    ).toEqual({
      mode: "unsupported",
      reason: "native_reply_not_supported"
    });
  });

  it("validates reply capability payloads", () => {
    expect(
      replyCapabilitySchema.parse({
        mode: "external_link",
        externalReplyUrl: "https://seller.example.test/orders/123"
      })
    ).toEqual({
      mode: "external_link",
      externalReplyUrl: "https://seller.example.test/orders/123"
    });
  });
});
