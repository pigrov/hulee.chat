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
  deleteTelegramWebhook,
  loadTenantBrand,
  loadInboxViewModel,
  loadTelegramIntegration,
  refreshTelegramDiagnostics,
  sendInboxReply,
  setTelegramWebhook,
  updateInboxConversationRouting,
  updateTelegramIntegration,
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
    expect(buildInternalApiHeaders).toHaveBeenCalledWith({
      method: "GET",
      path: "/internal/v1/inbox"
    });
  });

  it("builds operational inbox view requests without effective permission override", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return Response.json(inboxViewResponse());
    });

    vi.stubGlobal("fetch", fetchMock);

    await loadInboxViewModel({
      selectedConversationId: "conversation-1",
      queueId: "queue-sales",
      assignedToMe: true
    });

    const headerInput = vi.mocked(buildInternalApiHeaders).mock.calls[0]?.[0];

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.example.test/internal/v1/inbox?conversationId=conversation-1&queueId=queue-sales&assigned=me"
    );
    expect(headerInput).toEqual({
      method: "GET",
      path: "/internal/v1/inbox?conversationId=conversation-1&queueId=queue-sales&assigned=me"
    });
    expect(headerInput).not.toHaveProperty("effectivePermissionOverride");
  });

  it("builds operational inbox command requests without effective permission override", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_url, request) => {
      return request?.method === "PATCH"
        ? Response.json({
            conversationId: "conversation-1",
            currentQueueId: "queue-sales",
            assignedEmployeeId: "employee-2"
          })
        : Response.json({
            messageId: "message-1",
            status: "queued",
            idempotencyKey: "reply-1"
          });
    });

    vi.stubGlobal("fetch", fetchMock);

    await sendInboxReply({
      conversationId: "conversation-1",
      text: "Hello",
      idempotencyKey: "reply-1"
    });
    await updateInboxConversationRouting({
      conversationId: "conversation-1",
      request: {
        currentQueueId: "queue-sales",
        assignedEmployeeId: "employee-2",
        assignedTeamId: null
      }
    });

    const replyHeaderInput = vi.mocked(buildInternalApiHeaders).mock
      .calls[0]?.[0];
    const routingHeaderInput = vi.mocked(buildInternalApiHeaders).mock
      .calls[1]?.[0];

    expect(replyHeaderInput).toEqual({
      method: "POST",
      path: "/internal/v1/inbox/conversations/conversation-1/replies",
      body: {
        text: "Hello",
        idempotencyKey: "reply-1"
      }
    });
    expect(replyHeaderInput).not.toHaveProperty("effectivePermissionOverride");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      text: "Hello",
      idempotencyKey: "reply-1"
    });
    expect(routingHeaderInput).toEqual({
      method: "PATCH",
      path: "/internal/v1/inbox/conversations/conversation-1/routing",
      body: {
        currentQueueId: "queue-sales",
        assignedEmployeeId: "employee-2",
        assignedTeamId: null
      }
    });
    expect(routingHeaderInput).not.toHaveProperty(
      "effectivePermissionOverride"
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      currentQueueId: "queue-sales",
      assignedEmployeeId: "employee-2",
      assignedTeamId: null
    });
  });

  it("passes explicit effective permission override when loading integration settings", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return Response.json(telegramIntegrationResponse());
    });

    vi.stubGlobal("fetch", fetchMock);

    await loadTelegramIntegration({
      effectivePermissionOverride: "modules.manage"
    });

    expect(buildInternalApiHeaders).toHaveBeenCalledWith({
      method: "GET",
      path: "/internal/v1/integrations/telegram",
      effectivePermissionOverride: "modules.manage"
    });
  });

  it("passes explicit effective permission override for Telegram admin commands", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return Response.json(telegramIntegrationResponse());
    });

    vi.stubGlobal("fetch", fetchMock);

    await updateTelegramIntegration(
      {
        enabled: true,
        channelExternalId: "telegram-local",
        mode: "webhook",
        botTokenSecretRef: "env:HULEE_TELEGRAM_BOT_TOKEN",
        outboundEnabled: true
      },
      { effectivePermissionOverride: "modules.manage" }
    );
    await refreshTelegramDiagnostics({
      effectivePermissionOverride: "modules.manage"
    });
    await setTelegramWebhook({ effectivePermissionOverride: "modules.manage" });
    await deleteTelegramWebhook({
      effectivePermissionOverride: "modules.manage"
    });

    expect(buildInternalApiHeaders).toHaveBeenNthCalledWith(1, {
      method: "PUT",
      path: "/internal/v1/integrations/telegram",
      body: {
        enabled: true,
        channelExternalId: "telegram-local",
        mode: "webhook",
        botTokenSecretRef: "env:HULEE_TELEGRAM_BOT_TOKEN",
        outboundEnabled: true
      },
      effectivePermissionOverride: "modules.manage"
    });
    expect(buildInternalApiHeaders).toHaveBeenNthCalledWith(2, {
      method: "POST",
      path: "/internal/v1/integrations/telegram/diagnostics",
      effectivePermissionOverride: "modules.manage"
    });
    expect(buildInternalApiHeaders).toHaveBeenNthCalledWith(3, {
      method: "POST",
      path: "/internal/v1/integrations/telegram/webhook",
      effectivePermissionOverride: "modules.manage"
    });
    expect(buildInternalApiHeaders).toHaveBeenNthCalledWith(4, {
      method: "DELETE",
      path: "/internal/v1/integrations/telegram/webhook",
      effectivePermissionOverride: "modules.manage"
    });
  });

  it("rejects admin clients without the required narrow override", async () => {
    const fetchMock = vi.fn<typeof fetch>();

    vi.stubGlobal("fetch", fetchMock);

    await expect(loadTelegramIntegration(undefined as never)).rejects.toEqual(
      new CoreError("permission.denied")
    );
    await expect(
      loadTenantBrand({
        effectivePermissionOverride: "modules.manage"
      } as never)
    ).rejects.toEqual(new CoreError("permission.denied"));
    expect(buildInternalApiHeaders).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes explicit effective permission override when updating tenant brand", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return Response.json(tenantBrandResponse());
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
      { effectivePermissionOverride: "tenant.manage" }
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
      effectivePermissionOverride: "tenant.manage"
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      productName: "Acme Desk",
      shortProductName: "Desk",
      themeTokens: {
        "color.brand.primary": "#177f75"
      }
    });
  });

  it("passes explicit effective permission override when loading tenant brand", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return Response.json(tenantBrandResponse());
    });

    vi.stubGlobal("fetch", fetchMock);

    await loadTenantBrand({ effectivePermissionOverride: "tenant.manage" });

    expect(buildInternalApiHeaders).toHaveBeenCalledWith({
      method: "GET",
      path: "/internal/v1/tenant/brand",
      effectivePermissionOverride: "tenant.manage"
    });
  });
});

function inboxViewResponse(): unknown {
  return {
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
  };
}

function telegramIntegrationResponse(): unknown {
  return {
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
  };
}

function tenantBrandResponse(): unknown {
  return {
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
  };
}
