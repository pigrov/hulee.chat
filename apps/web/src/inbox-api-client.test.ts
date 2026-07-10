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
  archiveRbacRole,
  cancelChannelAuthChallenge,
  createChannelConnector,
  createRbacDirectGrant,
  createRbacRole,
  createRbacRoleBinding,
  createSourceConnection,
  deleteChannelConnector,
  deleteTelegramWebhook,
  disableChannelConnector,
  enableChannelConnector,
  loadChannelCatalog,
  loadChannelAuthChallenge,
  loadChannelConnectors,
  loadEgressStatus,
  loadRbacDirectGrants,
  loadRbacRoleBindings,
  loadRbacRoles,
  loadSourceCatalog,
  loadSourceConnections,
  loadTenantBrand,
  loadInboxViewModel,
  loadTelegramIntegration,
  refreshTelegramDiagnostics,
  restoreRbacRole,
  revokeRbacDirectGrant,
  revokeRbacRoleBinding,
  sendInboxReply,
  setTelegramWebhook,
  startChannelAuthChallenge,
  submitChannelAuthChallenge,
  updateChannelConnector,
  updateRbacRole,
  updateInboxConversationRouting,
  updateTelegramIntegration,
  updateTenantBrand,
  validateTelegramBotToken
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

    await loadTelegramIntegration(
      {
        effectivePermissionOverride: "modules.manage"
      },
      {
        connectorId: "telegram_bot:second"
      }
    );

    expect(buildInternalApiHeaders).toHaveBeenCalledWith({
      method: "GET",
      path: "/internal/v1/channels/connectors/telegram_bot%3Asecond/telegram",
      effectivePermissionOverride: "modules.manage"
    });
  });

  it("passes explicit effective permission override when loading channel catalog and connectors", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));

      if (url.pathname.endsWith("/channels/catalog")) {
        return Response.json({
          channels: [
            {
              channelType: "telegram_bot",
              channelClass: "bot_bridge",
              provider: "telegram",
              titleKey: "integrations.catalog.telegramBot.title",
              descriptionKey: "integrations.catalog.telegramBot.description",
              readiness: "available",
              supportsMultiple: true,
              capabilities: ["inbound", "outbound", "webhook"],
              egressRequirement: {
                required: true,
                defaultProfileKind: "vpn_namespace",
                allowedProfileKinds: [
                  "vpn_namespace",
                  "http_proxy",
                  "socks_proxy",
                  "customer_network"
                ],
                enforcementScope: "hulee_managed_saas"
              },
              onboarding: {
                version: "v1",
                steps: [
                  {
                    id: "name",
                    kind: "display_name",
                    titleKey: "integrations.channel.onboarding.name",
                    action: "update_connector"
                  },
                  {
                    id: "complete",
                    kind: "complete",
                    titleKey: "integrations.channel.onboarding.complete"
                  }
                ]
              }
            }
          ]
        });
      }

      if (url.pathname.endsWith("/sources/catalog")) {
        return Response.json({
          categories: [
            {
              category: "marketplaces",
              titleKey: "sources.categories.marketplaces.title",
              descriptionKey: "sources.categories.marketplaces.description",
              sourceTypes: ["marketplace"],
              sortOrder: 300,
              defaultCapabilities: ["receive_events", "native_reply"]
            }
          ],
          sources: [
            {
              sourceName: "ozon",
              sourceType: "marketplace",
              category: "marketplaces",
              provider: "ozon",
              titleKey: "sources.catalog.ozon.title",
              shortDescriptionKey: "sources.catalog.ozon.shortDescription",
              descriptionKey: "sources.catalog.ozon.description",
              readiness: "coming_soon",
              visibility: "visible",
              setupMode: "source_connection",
              supportsMultipleAccounts: true,
              authTypes: ["api_key"],
              accountTypes: ["shop"],
              eventTypes: ["order_question"],
              capabilities: ["receive_events", "native_reply"],
              sortOrder: 300
            }
          ]
        });
      }

      if (url.pathname.endsWith("/egress/status")) {
        return Response.json({
          profiles: [
            {
              profileId: "managed-messenger-vpn",
              profileKind: "vpn_namespace",
              status: "ready",
              source: "deployment_config",
              checkedAt: "2026-06-29T10:00:00.000Z"
            }
          ]
        });
      }

      return Response.json({
        connectors: [
          {
            connectorId: "telegram_bot:tenant-1",
            channelType: "telegram_bot",
            channelClass: "bot_bridge",
            provider: "telegram",
            displayName: "Telegram Bot",
            status: "connected",
            healthStatus: "healthy",
            channelExternalId: "telegram-local",
            diagnosticsStatus: "configured"
          }
        ]
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    await loadChannelCatalog({
      effectivePermissionOverride: "modules.manage"
    });
    await loadSourceCatalog({
      effectivePermissionOverride: "modules.manage"
    });
    await loadChannelConnectors({
      effectivePermissionOverride: "modules.manage"
    });
    await loadEgressStatus({
      effectivePermissionOverride: "modules.manage"
    });

    expect(buildInternalApiHeaders).toHaveBeenNthCalledWith(1, {
      method: "GET",
      path: "/internal/v1/channels/catalog",
      effectivePermissionOverride: "modules.manage"
    });
    expect(buildInternalApiHeaders).toHaveBeenNthCalledWith(2, {
      method: "GET",
      path: "/internal/v1/sources/catalog",
      effectivePermissionOverride: "modules.manage"
    });
    expect(buildInternalApiHeaders).toHaveBeenNthCalledWith(3, {
      method: "GET",
      path: "/internal/v1/channels/connectors",
      effectivePermissionOverride: "modules.manage"
    });
    expect(buildInternalApiHeaders).toHaveBeenNthCalledWith(4, {
      method: "GET",
      path: "/internal/v1/egress/status",
      effectivePermissionOverride: "modules.manage"
    });
  });

  it("passes explicit effective permission override when loading source connections", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return Response.json({
        connections: [
          {
            sourceConnectionId: "source_connection:megapbx:1",
            sourceName: "megapbx",
            sourceType: "phone",
            displayName: "MegaPBX",
            status: "active",
            authType: "webhook_secret",
            webhookPath:
              "/webhooks/sources/megapbx/source_connection%3Amegapbx%3A1",
            webhookUrl:
              "https://chat.example.test/webhooks/sources/megapbx/source_connection%3Amegapbx%3A1",
            webhookSecretRef:
              "tenant_secret:tenant-1:source.webhook_secret:megapbx",
            createdAt: "2026-07-09T10:00:00.000Z",
            updatedAt: "2026-07-09T10:00:00.000Z"
          }
        ]
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    await loadSourceConnections({
      effectivePermissionOverride: "modules.manage"
    });

    expect(buildInternalApiHeaders).toHaveBeenCalledWith({
      method: "GET",
      path: "/internal/v1/sources/connections",
      effectivePermissionOverride: "modules.manage"
    });
  });

  it("passes explicit effective permission override when creating source connections", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return Response.json({
        connection: {
          sourceConnectionId: "source_connection:megapbx:1",
          sourceName: "megapbx",
          sourceType: "phone",
          displayName: "MegaPBX",
          status: "active",
          authType: "webhook_secret",
          webhookPath:
            "/webhooks/sources/megapbx/source_connection%3Amegapbx%3A1",
          webhookUrl:
            "https://chat.example.test/webhooks/sources/megapbx/source_connection%3Amegapbx%3A1",
          webhookSecretRef:
            "tenant_secret:tenant-1:source.webhook_secret:megapbx",
          createdAt: "2026-07-09T10:00:00.000Z",
          updatedAt: "2026-07-09T10:00:00.000Z"
        },
        webhookToken: "test-source-webhook-token"
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    await createSourceConnection(
      {
        sourceName: "megapbx",
        displayName: "MegaPBX"
      },
      {
        effectivePermissionOverride: "modules.manage"
      }
    );

    expect(buildInternalApiHeaders).toHaveBeenCalledWith({
      method: "POST",
      path: "/internal/v1/sources/connections",
      body: {
        sourceName: "megapbx",
        displayName: "MegaPBX"
      },
      effectivePermissionOverride: "modules.manage"
    });
  });

  it("passes explicit effective permission override when creating channel connectors", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return Response.json({
        connectorId: "telegram_bot:generated",
        channelType: "telegram_bot",
        channelClass: "bot_bridge",
        provider: "telegram",
        displayName: "Telegram Bot",
        status: "draft",
        healthStatus: "unknown",
        channelExternalId: "telegram-generated",
        diagnosticsStatus: "disabled"
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    await createChannelConnector(
      {
        channelType: "telegram_bot"
      },
      {
        effectivePermissionOverride: "modules.manage"
      }
    );

    expect(buildInternalApiHeaders).toHaveBeenCalledWith({
      method: "POST",
      path: "/internal/v1/channels/connectors",
      body: {
        channelType: "telegram_bot"
      },
      effectivePermissionOverride: "modules.manage"
    });
  });

  it("passes explicit effective permission override when updating channel connector settings", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return Response.json({
        connectorId: "telegram_qr_bridge:second",
        channelType: "telegram_qr_bridge",
        channelClass: "user_bridge",
        provider: "telegram",
        displayName: "Sales Telegram",
        status: "connected",
        healthStatus: "healthy"
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    await updateChannelConnector(
      {
        connectorId: "telegram_qr_bridge:second",
        request: {
          displayName: "Sales Telegram"
        }
      },
      {
        effectivePermissionOverride: "modules.manage"
      }
    );

    expect(buildInternalApiHeaders).toHaveBeenCalledWith({
      method: "PATCH",
      path: "/internal/v1/channels/connectors/telegram_qr_bridge%3Asecond",
      body: {
        displayName: "Sales Telegram"
      },
      effectivePermissionOverride: "modules.manage"
    });
  });

  it("passes explicit effective permission override when changing connector lifecycle", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const path = String(_input);
      const status =
        init?.method === "DELETE"
          ? "deleted"
          : path.endsWith("/enable")
            ? "connected"
            : "disabled";

      return Response.json({
        connectorId: "telegram_bot:second",
        channelType: "telegram_bot",
        channelClass: "bot_bridge",
        provider: "telegram",
        displayName: "Telegram Bot",
        status,
        healthStatus: status === "connected" ? "healthy" : "unknown",
        channelExternalId: "telegram-local",
        diagnosticsStatus: status === "connected" ? "configured" : "disabled"
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    await enableChannelConnector(
      {
        connectorId: "telegram_bot:second"
      },
      {
        effectivePermissionOverride: "modules.manage"
      }
    );
    await disableChannelConnector(
      {
        connectorId: "telegram_bot:second"
      },
      {
        effectivePermissionOverride: "modules.manage"
      }
    );
    await deleteChannelConnector(
      {
        connectorId: "telegram_bot:second"
      },
      {
        effectivePermissionOverride: "modules.manage"
      }
    );

    expect(buildInternalApiHeaders).toHaveBeenNthCalledWith(1, {
      method: "POST",
      path: "/internal/v1/channels/connectors/telegram_bot%3Asecond/enable",
      effectivePermissionOverride: "modules.manage"
    });
    expect(buildInternalApiHeaders).toHaveBeenNthCalledWith(2, {
      method: "POST",
      path: "/internal/v1/channels/connectors/telegram_bot%3Asecond/disable",
      effectivePermissionOverride: "modules.manage"
    });
    expect(buildInternalApiHeaders).toHaveBeenNthCalledWith(3, {
      method: "DELETE",
      path: "/internal/v1/channels/connectors/telegram_bot%3Asecond",
      effectivePermissionOverride: "modules.manage"
    });
  });

  it("passes explicit effective permission override for channel auth challenge commands", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const status = String(init?.body ?? "").includes("12345")
        ? "waiting"
        : "requires_code";

      return Response.json(channelAuthChallengeResponse(status));
    });

    vi.stubGlobal("fetch", fetchMock);

    await startChannelAuthChallenge(
      {
        connectorId: "telegram_qr_bridge:second",
        request: {
          challengeType: "phone_code",
          phoneNumber: "+79990000000"
        }
      },
      {
        effectivePermissionOverride: "modules.manage"
      }
    );
    await loadChannelAuthChallenge(
      {
        connectorId: "telegram_qr_bridge:second",
        challengeId: "challenge-1"
      },
      {
        effectivePermissionOverride: "modules.manage"
      }
    );
    await submitChannelAuthChallenge(
      {
        connectorId: "telegram_qr_bridge:second",
        challengeId: "challenge-1",
        request: {
          code: "12345"
        }
      },
      {
        effectivePermissionOverride: "modules.manage"
      }
    );
    await cancelChannelAuthChallenge(
      {
        connectorId: "telegram_qr_bridge:second",
        challengeId: "challenge-1"
      },
      {
        effectivePermissionOverride: "modules.manage"
      }
    );
    await cancelChannelAuthChallenge(
      {
        connectorId: "telegram_qr_bridge:second",
        challengeId: "challenge-2",
        resetSession: true
      },
      {
        effectivePermissionOverride: "modules.manage"
      }
    );

    expect(buildInternalApiHeaders).toHaveBeenNthCalledWith(1, {
      method: "POST",
      path: "/internal/v1/channels/connectors/telegram_qr_bridge%3Asecond/auth-challenges",
      body: {
        challengeType: "phone_code",
        phoneNumber: "+79990000000"
      },
      effectivePermissionOverride: "modules.manage"
    });
    expect(buildInternalApiHeaders).toHaveBeenNthCalledWith(2, {
      method: "GET",
      path: "/internal/v1/channels/connectors/telegram_qr_bridge%3Asecond/auth-challenges/challenge-1",
      effectivePermissionOverride: "modules.manage"
    });
    expect(buildInternalApiHeaders).toHaveBeenNthCalledWith(3, {
      method: "POST",
      path: "/internal/v1/channels/connectors/telegram_qr_bridge%3Asecond/auth-challenges/challenge-1/submit",
      body: {
        code: "12345"
      },
      effectivePermissionOverride: "modules.manage"
    });
    expect(buildInternalApiHeaders).toHaveBeenNthCalledWith(4, {
      method: "POST",
      path: "/internal/v1/channels/connectors/telegram_qr_bridge%3Asecond/auth-challenges/challenge-1/cancel",
      effectivePermissionOverride: "modules.manage"
    });
    expect(buildInternalApiHeaders).toHaveBeenNthCalledWith(5, {
      method: "POST",
      path: "/internal/v1/channels/connectors/telegram_qr_bridge%3Asecond/auth-challenges/challenge-2/cancel",
      body: {
        resetSession: true
      },
      effectivePermissionOverride: "modules.manage"
    });
  });

  it("passes explicit effective permission override when validating Telegram bot tokens", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return Response.json({
        bot: {
          id: "100",
          username: "hulee_test_bot"
        }
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      validateTelegramBotToken(
        {
          botToken: "123456789:AAExampleTokenValue_000000000000000000"
        },
        {
          effectivePermissionOverride: "modules.manage"
        }
      )
    ).resolves.toEqual({
      bot: {
        id: "100",
        username: "hulee_test_bot"
      }
    });

    expect(buildInternalApiHeaders).toHaveBeenCalledWith({
      method: "POST",
      path: "/internal/v1/channels/telegram-bot/token/validate",
      body: {
        botToken: "123456789:AAExampleTokenValue_000000000000000000"
      },
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
        connectorId: "telegram_bot:second",
        enabled: true,
        channelExternalId: "telegram-local",
        mode: "webhook",
        botTokenSecretRef: "env:HULEE_TELEGRAM_BOT_TOKEN",
        outboundEnabled: true
      },
      { effectivePermissionOverride: "modules.manage" }
    );
    await refreshTelegramDiagnostics(
      {
        effectivePermissionOverride: "modules.manage"
      },
      {
        connectorId: "telegram_bot:second"
      }
    );
    await setTelegramWebhook(
      { effectivePermissionOverride: "modules.manage" },
      {
        connectorId: "telegram_bot:second"
      }
    );
    await deleteTelegramWebhook(
      {
        effectivePermissionOverride: "modules.manage"
      },
      {
        connectorId: "telegram_bot:second"
      }
    );

    expect(buildInternalApiHeaders).toHaveBeenNthCalledWith(1, {
      method: "PUT",
      path: "/internal/v1/channels/connectors/telegram_bot%3Asecond/telegram",
      body: {
        connectorId: "telegram_bot:second",
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
      path: "/internal/v1/channels/connectors/telegram_bot%3Asecond/telegram/diagnostics",
      effectivePermissionOverride: "modules.manage"
    });
    expect(buildInternalApiHeaders).toHaveBeenNthCalledWith(3, {
      method: "POST",
      path: "/internal/v1/channels/connectors/telegram_bot%3Asecond/telegram/webhook",
      effectivePermissionOverride: "modules.manage"
    });
    expect(buildInternalApiHeaders).toHaveBeenNthCalledWith(4, {
      method: "DELETE",
      path: "/internal/v1/channels/connectors/telegram_bot%3Asecond/telegram/webhook",
      effectivePermissionOverride: "modules.manage"
    });
  });

  it("rejects admin clients without the required narrow override", async () => {
    const fetchMock = vi.fn<typeof fetch>();

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      loadTelegramIntegration(undefined as never, {
        connectorId: "telegram_bot:second"
      })
    ).rejects.toEqual(new CoreError("permission.denied"));
    await expect(
      loadTenantBrand({
        effectivePermissionOverride: "modules.manage"
      } as never)
    ).rejects.toEqual(new CoreError("permission.denied"));
    await expect(
      loadRbacRoles({
        effectivePermissionOverride: "tenant.manage"
      } as never)
    ).rejects.toEqual(new CoreError("permission.denied"));
    expect(buildInternalApiHeaders).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes explicit effective permission override for RBAC admin clients", async () => {
    const rolesManageOptions = {
      effectivePermissionOverride: "roles.manage" as const
    };
    const fetchMock = vi.fn<typeof fetch>(async (url, request) => {
      return Response.json(
        rbacResponseForRequest(String(url), request?.method ?? "GET")
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    await loadRbacRoles(rolesManageOptions);
    await createRbacRole(
      {
        name: "Sales",
        description: "Sales team",
        permissions: ["client.view"]
      },
      rolesManageOptions
    );
    await updateRbacRole(
      "role-sales",
      {
        name: "Sales custom",
        description: undefined,
        permissions: ["client.view", "message.reply"]
      },
      rolesManageOptions
    );
    await archiveRbacRole("role-sales", rolesManageOptions);
    await restoreRbacRole("role-sales", rolesManageOptions);
    await loadRbacRoleBindings(rolesManageOptions);
    await createRbacRoleBinding(
      {
        roleId: "role-sales",
        subject: {
          type: "employee",
          id: "employee-2"
        },
        scope: {
          type: "tenant"
        }
      },
      rolesManageOptions
    );
    await revokeRbacRoleBinding("binding-sales", rolesManageOptions);
    await loadRbacDirectGrants(rolesManageOptions);
    await createRbacDirectGrant(
      {
        employeeId: "employee-2",
        permission: "client.view",
        scope: {
          type: "tenant"
        },
        reason: "Temporary sales handoff"
      },
      rolesManageOptions
    );
    await revokeRbacDirectGrant("grant-client", rolesManageOptions);

    expect(buildInternalApiHeaders).toHaveBeenNthCalledWith(1, {
      method: "GET",
      path: "/internal/v1/rbac/roles",
      effectivePermissionOverride: "roles.manage"
    });
    expect(buildInternalApiHeaders).toHaveBeenNthCalledWith(2, {
      method: "POST",
      path: "/internal/v1/rbac/roles",
      body: {
        name: "Sales",
        description: "Sales team",
        permissions: ["client.view"]
      },
      effectivePermissionOverride: "roles.manage"
    });
    expect(buildInternalApiHeaders).toHaveBeenNthCalledWith(3, {
      method: "PATCH",
      path: "/internal/v1/rbac/roles/role-sales",
      body: {
        name: "Sales custom",
        description: undefined,
        permissions: ["client.view", "message.reply"]
      },
      effectivePermissionOverride: "roles.manage"
    });
    expect(buildInternalApiHeaders).toHaveBeenNthCalledWith(4, {
      method: "POST",
      path: "/internal/v1/rbac/roles/role-sales/archive",
      effectivePermissionOverride: "roles.manage"
    });
    expect(buildInternalApiHeaders).toHaveBeenNthCalledWith(5, {
      method: "POST",
      path: "/internal/v1/rbac/roles/role-sales/restore",
      effectivePermissionOverride: "roles.manage"
    });
    expect(buildInternalApiHeaders).toHaveBeenNthCalledWith(6, {
      method: "GET",
      path: "/internal/v1/rbac/role-bindings",
      effectivePermissionOverride: "roles.manage"
    });
    expect(buildInternalApiHeaders).toHaveBeenNthCalledWith(7, {
      method: "POST",
      path: "/internal/v1/rbac/role-bindings",
      body: {
        roleId: "role-sales",
        subject: {
          type: "employee",
          id: "employee-2"
        },
        scope: {
          type: "tenant"
        }
      },
      effectivePermissionOverride: "roles.manage"
    });
    expect(buildInternalApiHeaders).toHaveBeenNthCalledWith(8, {
      method: "DELETE",
      path: "/internal/v1/rbac/role-bindings/binding-sales",
      effectivePermissionOverride: "roles.manage"
    });
    expect(buildInternalApiHeaders).toHaveBeenNthCalledWith(9, {
      method: "GET",
      path: "/internal/v1/rbac/direct-grants",
      effectivePermissionOverride: "roles.manage"
    });
    expect(buildInternalApiHeaders).toHaveBeenNthCalledWith(10, {
      method: "POST",
      path: "/internal/v1/rbac/direct-grants",
      body: {
        employeeId: "employee-2",
        permission: "client.view",
        scope: {
          type: "tenant"
        },
        reason: "Temporary sales handoff"
      },
      effectivePermissionOverride: "roles.manage"
    });
    expect(buildInternalApiHeaders).toHaveBeenNthCalledWith(11, {
      method: "DELETE",
      path: "/internal/v1/rbac/direct-grants/grant-client",
      effectivePermissionOverride: "roles.manage"
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      name: "Sales",
      description: "Sales team",
      permissions: ["client.view"]
    });
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
      egress: {
        required: true,
        status: "unknown",
        profileKind: "vpn_namespace",
        checkedAt: "2026-01-01T00:00:00.000Z"
      },
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

function channelAuthChallengeResponse(status = "requires_code"): unknown {
  return {
    challenge: {
      challengeId: "challenge-1",
      connectorId: "telegram_qr_bridge:second",
      challengeType: "phone_code",
      status,
      publicPayload: {
        phoneNumber: "+79990000000",
        expiresAt: "2026-06-29T10:00:00.000Z"
      },
      expiresAt: "2026-06-29T10:00:00.000Z",
      createdAt: "2026-06-29T09:55:00.000Z",
      updatedAt: "2026-06-29T09:55:00.000Z"
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

function rbacResponseForRequest(url: string, method: string): unknown {
  const path = new URL(url).pathname;

  if (path === "/internal/v1/rbac/roles" && method === "GET") {
    return {
      roles: [rbacRoleResponse()]
    };
  }

  if (path === "/internal/v1/rbac/roles" && method === "POST") {
    return {
      role: rbacRoleResponse({ name: "Sales" })
    };
  }

  if (path === "/internal/v1/rbac/roles/role-sales" && method === "PATCH") {
    return {
      role: rbacRoleResponse({ name: "Sales custom" })
    };
  }

  if (
    (path === "/internal/v1/rbac/roles/role-sales/archive" ||
      path === "/internal/v1/rbac/roles/role-sales/restore") &&
    method === "POST"
  ) {
    return {
      role: rbacRoleResponse()
    };
  }

  if (path === "/internal/v1/rbac/role-bindings" && method === "GET") {
    return {
      roleBindings: []
    };
  }

  if (path === "/internal/v1/rbac/role-bindings" && method === "POST") {
    return {
      roleBinding: rbacRoleBindingResponse()
    };
  }

  if (
    path === "/internal/v1/rbac/role-bindings/binding-sales" &&
    method === "DELETE"
  ) {
    return {
      revoked: true
    };
  }

  if (path === "/internal/v1/rbac/direct-grants" && method === "GET") {
    return {
      directGrants: []
    };
  }

  if (path === "/internal/v1/rbac/direct-grants" && method === "POST") {
    return {
      directGrant: rbacDirectGrantResponse()
    };
  }

  if (
    path === "/internal/v1/rbac/direct-grants/grant-client" &&
    method === "DELETE"
  ) {
    return {
      revoked: true
    };
  }

  throw new Error(`Unexpected RBAC request ${method} ${path}.`);
}

function rbacRoleResponse(
  overrides: {
    readonly name?: string;
  } = {}
): unknown {
  return {
    id: "role-sales",
    name: overrides.name ?? "Sales",
    description: "Sales team",
    status: "active",
    isSystem: false,
    permissions: ["client.view"],
    createdByEmployeeId: null
  };
}

function rbacRoleBindingResponse(): unknown {
  return {
    id: "binding-sales",
    roleId: "role-sales",
    subject: {
      type: "employee",
      id: "employee-2"
    },
    scope: {
      type: "tenant"
    }
  };
}

function rbacDirectGrantResponse(): unknown {
  return {
    id: "grant-client",
    employeeId: "employee-2",
    permission: "client.view",
    scope: {
      type: "tenant"
    },
    reason: "Temporary sales handoff"
  };
}
