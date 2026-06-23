import { describe, expect, it } from "vitest";

import {
  internalApiErrorResponseSchema,
  internalInboxReplyRequestSchema,
  internalInboxViewResponseSchema,
  internalTenantBrandResponseSchema,
  internalTenantBrandUpdateRequestSchema,
  internalTelegramIntegrationResponseSchema,
  internalTelegramIntegrationUpdateRequestSchema
} from "./internal-api-v1";

describe("internal API v1 schemas", () => {
  it("parses an inbox view response with tenant brand context", () => {
    expect(
      internalInboxViewResponseSchema.parse({
        tenant: {
          tenantId: "tenant-1",
          displayName: "Acme",
          deploymentType: "saas_shared",
          locale: "en",
          timezone: "UTC",
          brand: {
            id: "brand-1",
            scope: "tenant",
            tenantId: "tenant-1",
            productName: "Acme Desk",
            assets: {},
            themeTokens: {},
            links: {}
          }
        },
        conversations: [],
        messages: []
      })
    ).toMatchObject({
      tenant: {
        tenantId: "tenant-1",
        brand: {
          productName: "Acme Desk"
        }
      }
    });
  });

  it("normalizes reply text and rejects empty replies", () => {
    expect(
      internalInboxReplyRequestSchema.parse({
        text: "  Hello  "
      })
    ).toEqual({
      text: "Hello"
    });
    expect(() =>
      internalInboxReplyRequestSchema.parse({ text: " " })
    ).toThrow();
  });

  it("defines a stable internal error envelope", () => {
    expect(
      internalApiErrorResponseSchema.parse({
        error: {
          code: "permission.denied",
          messageKey: "errors.permission.denied",
          retryability: "not_retryable",
          requestId: "request-1"
        }
      })
    ).toMatchObject({
      error: {
        code: "permission.denied"
      }
    });
  });

  it("parses tenant brand update requests and responses", () => {
    expect(
      internalTenantBrandUpdateRequestSchema.parse({
        productName: " Acme Desk ",
        shortProductName: " Acme ",
        themeTokens: {
          "color.brand.primary": "#177f75"
        }
      })
    ).toEqual({
      productName: "Acme Desk",
      shortProductName: "Acme",
      themeTokens: {
        "color.brand.primary": "#177f75"
      }
    });

    expect(
      internalTenantBrandResponseSchema.parse({
        brand: {
          id: "brand-1",
          scope: "tenant",
          tenantId: "tenant-1",
          productName: "Acme Desk",
          assets: {},
          themeTokens: {
            "color.brand.primary": "#177f75"
          },
          links: {}
        }
      })
    ).toMatchObject({
      brand: {
        productName: "Acme Desk"
      }
    });
  });

  it("parses Telegram integration responses without raw provider secrets", () => {
    expect(
      internalTelegramIntegrationResponseSchema.parse({
        moduleId: "channel-telegram",
        enabled: true,
        config: {
          channelExternalId: "telegram-local",
          mode: "webhook",
          botTokenSecretRef: "env:HULEE_TELEGRAM_BOT_TOKEN",
          outboundEnabled: true
        },
        webhookPath: "/webhooks/telegram/telegram-local",
        publicWebhookUrl:
          "https://example.test/webhooks/telegram/telegram-local",
        diagnostics: {
          status: "configured",
          checkedAt: "2026-06-22T10:00:00.000Z",
          bot: {
            id: "100",
            username: "hulee_test_bot"
          },
          webhook: {
            expectedUrl:
              "https://example.test/webhooks/telegram/telegram-local",
            actualUrl: "https://example.test/webhooks/telegram/telegram-local",
            pendingUpdateCount: 0
          },
          checks: {
            moduleEnabled: true,
            configValid: true,
            inboundWebhookReady: true,
            outboundEnabled: true,
            botTokenSecretRefConfigured: true,
            botTokenResolved: true,
            botApiReachable: true,
            webhookMatchesConfig: true
          }
        }
      })
    ).toMatchObject({
      moduleId: "channel-telegram",
      config: {
        botTokenSecretRef: "env:HULEE_TELEGRAM_BOT_TOKEN"
      }
    });
  });

  it("allows Telegram updates to carry a write-only bot token", () => {
    expect(
      internalTelegramIntegrationUpdateRequestSchema.parse({
        enabled: true,
        channelExternalId: "telegram-local",
        botToken: "telegram-token",
        outboundEnabled: true
      })
    ).toEqual({
      enabled: true,
      channelExternalId: "telegram-local",
      mode: "webhook",
      botToken: "telegram-token",
      outboundEnabled: true
    });

    expect(() =>
      internalTelegramIntegrationResponseSchema.parse({
        moduleId: "channel-telegram",
        enabled: true,
        config: {
          channelExternalId: "telegram-local",
          mode: "webhook",
          botToken: "telegram-token",
          outboundEnabled: true
        },
        diagnostics: {
          status: "configured",
          checkedAt: "2026-06-22T10:00:00.000Z",
          checks: {
            moduleEnabled: true,
            configValid: true,
            inboundWebhookReady: true,
            outboundEnabled: true,
            botTokenSecretRefConfigured: true
          }
        }
      })
    ).toThrow();
  });
});
