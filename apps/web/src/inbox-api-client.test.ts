import { CoreError } from "@hulee/core";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./session", () => ({
  buildInternalApiHeaders: vi.fn(async () => ({
    "x-hulee-tenant-id": "tenant-1",
    "x-hulee-employee-id": "employee-1"
  }))
}));

vi.mock("./web-config", () => ({
  resolveWebConfig: () => ({
    internalApiBaseUrl: "https://api.example.test"
  })
}));

import { buildInternalApiHeaders } from "./session";
import {
  loadInboxViewModel,
  loadTelegramIntegration,
  updateTenantBrand
} from "./inbox-api-client";

describe("inbox API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("maps versioned inbox access errors to CoreError", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: "permission.denied",
            messageKey: "errors.permission.denied",
            retryability: "not_retryable",
            requestId: "request-1"
          }
        }),
        {
          status: 403,
          headers: {
            "content-type": "application/json; charset=utf-8"
          }
        }
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    await expect(loadInboxViewModel()).rejects.toEqual(
      new CoreError("permission.denied")
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.example.test/internal/v1/inbox"
    );
  });

  it("passes explicit effective permissions when loading integration settings", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return Response.json({
        moduleId: "channel-telegram",
        enabled: true,
        config: {
          channelExternalId: "telegram-local",
          mode: "webhook",
          botTokenSecretRef: "env:HULEE_TELEGRAM_BOT_TOKEN",
          outboundEnabled: true
        },
        webhookPath: "/webhooks/telegram/telegram-local",
        diagnostics: {
          status: "configured",
          checkedAt: "2026-01-01T00:00:00.000Z",
          checks: {
            moduleEnabled: true,
            configValid: true,
            inboundWebhookReady: true,
            outboundEnabled: true,
            botTokenSecretRefConfigured: true,
            webhookSecretTokenResolved: true,
            botTokenResolved: true,
            botApiReachable: true,
            webhookMatchesConfig: true
          }
        }
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    await loadTelegramIntegration({ permissions: ["modules.manage"] });

    expect(buildInternalApiHeaders).toHaveBeenCalledWith({
      method: "GET",
      path: "/internal/v1/integrations/telegram",
      permissions: ["modules.manage"]
    });
  });

  it("passes explicit effective permissions when updating tenant brand", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return Response.json({
        brand: {
          id: "brand-1",
          scope: "tenant",
          tenantId: "tenant-1",
          productName: "Acme Desk",
          shortProductName: "Desk",
          assets: {},
          themeTokens: {
            "color.brand.primary": "#177f75"
          },
          links: {}
        }
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    await updateTenantBrand(
      {
        productName: "Acme Desk",
        shortProductName: "Desk",
        themeTokens: {
          "color.brand.primary": "#177f75"
        }
      },
      { permissions: ["tenant.manage"] }
    );

    expect(buildInternalApiHeaders).toHaveBeenCalledWith({
      method: "PUT",
      path: "/internal/v1/tenant/brand",
      body: {
        productName: "Acme Desk",
        shortProductName: "Desk",
        themeTokens: {
          "color.brand.primary": "#177f75"
        }
      },
      permissions: ["tenant.manage"]
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      productName: "Acme Desk",
      shortProductName: "Desk",
      themeTokens: {
        "color.brand.primary": "#177f75"
      }
    });
  });
});
