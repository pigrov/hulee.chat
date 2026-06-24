import type {
  EmployeeId,
  InternalInboxViewResponse,
  InternalOrgUnitUpsertRequest,
  InternalTenantBrandUpdateRequest,
  InternalTelegramIntegrationUpdateRequest,
  InternalWorkQueueUpsertRequest,
  TenantId
} from "@hulee/contracts";
import {
  createInternalApiSignature,
  internalApiSignatureHeader,
  internalApiTimestampHeader
} from "@hulee/core";
import { describe, expect, it, vi } from "vitest";

import {
  createInternalApiHandler,
  createLocalDevInternalSessionResolver,
  createSignedInternalSessionResolver,
  type InternalApiSession
} from "./internal-api-handler";

const tenantId = "tenant-1" as TenantId;
const employeeId = "employee-1" as EmployeeId;
const session: InternalApiSession = {
  requestId: "request-1",
  tenantId,
  employeeId,
  permissions: [
    "tenant.manage",
    "employees.manage",
    "inbox.read",
    "message.reply",
    "conversation.assign",
    "modules.manage"
  ]
};
const inboxView: InternalInboxViewResponse = {
  tenant: {
    tenantId,
    displayName: "Acme",
    deploymentType: "saas_shared",
    locale: "en",
    timezone: "UTC",
    brand: {
      id: "brand-1",
      scope: "tenant",
      tenantId,
      productName: "Acme Desk",
      assets: {},
      themeTokens: {},
      links: {}
    }
  },
  conversations: [],
  messages: []
};

function createHandler(input?: {
  session?: InternalApiSession | null;
  view?: InternalInboxViewResponse;
}) {
  const loadInboxView = vi.fn(async () => input?.view ?? inboxView);
  const sendReply = vi.fn(async () => ({
    messageId: "message-1",
    status: "queued" as const,
    idempotencyKey: "reply-1"
  }));
  const updateConversationRouting = vi.fn(async () => ({
    conversationId: "conversation-1",
    currentQueueId: "queue-sales",
    assignedEmployeeId: "employee-2"
  }));
  const loadTelegramIntegration = vi.fn(async () => ({
    moduleId: "channel-telegram" as const,
    enabled: true,
    config: {
      channelExternalId: "telegram-local",
      mode: "webhook" as const,
      botTokenSecretRef: "env:HULEE_TELEGRAM_BOT_TOKEN",
      outboundEnabled: true
    },
    webhookPath: "/webhooks/telegram/telegram-local",
    diagnostics: {
      status: "configured" as const,
      checkedAt: "2026-06-22T10:00:00.000Z",
      checks: {
        moduleEnabled: true,
        configValid: true,
        inboundWebhookReady: true,
        outboundEnabled: true,
        botTokenSecretRefConfigured: true
      }
    }
  }));
  const updateTelegramIntegration = vi.fn(
    async (
      _context: unknown,
      request: InternalTelegramIntegrationUpdateRequest
    ) => ({
      moduleId: "channel-telegram" as const,
      enabled: request.enabled,
      config: {
        channelExternalId: request.channelExternalId,
        mode: request.mode,
        botTokenSecretRef: request.botTokenSecretRef,
        outboundEnabled: request.outboundEnabled
      },
      webhookPath: `/webhooks/telegram/${request.channelExternalId}`,
      diagnostics: {
        status: request.enabled
          ? ("configured" as const)
          : ("disabled" as const),
        checkedAt: "2026-06-22T10:00:00.000Z",
        checks: {
          moduleEnabled: request.enabled,
          configValid: true,
          inboundWebhookReady: request.mode === "webhook",
          outboundEnabled: request.outboundEnabled,
          botTokenSecretRefConfigured: Boolean(request.botTokenSecretRef)
        }
      }
    })
  );
  const refreshTelegramDiagnostics = vi.fn(async () => ({
    moduleId: "channel-telegram" as const,
    enabled: true,
    config: {
      channelExternalId: "telegram-local",
      mode: "webhook" as const,
      botTokenSecretRef: "env:HULEE_TELEGRAM_BOT_TOKEN",
      outboundEnabled: true
    },
    webhookPath: "/webhooks/telegram/telegram-local",
    publicWebhookUrl: "https://example.test/webhooks/telegram/telegram-local",
    diagnostics: {
      status: "configured" as const,
      checkedAt: "2026-06-22T10:00:00.000Z",
      bot: {
        id: "100",
        username: "hulee_test_bot"
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
  }));
  const setTelegramWebhook = vi.fn(refreshTelegramDiagnostics);
  const deleteTelegramWebhook = vi.fn(refreshTelegramDiagnostics);
  const loadTenantBrand = vi.fn(async () => ({
    brand: inboxView.tenant.brand
  }));
  const updateTenantBrand = vi.fn(
    async (_context: unknown, request: InternalTenantBrandUpdateRequest) => ({
      brand: {
        ...inboxView.tenant.brand,
        productName: request.productName,
        shortProductName: request.shortProductName,
        themeTokens: request.themeTokens
      }
    })
  );
  const loadOrgStructure = vi.fn(async () => ({
    orgUnits: [
      {
        id: "org-sales",
        parentOrgUnitId: null,
        name: "Sales",
        kind: "department" as const,
        status: "active" as const
      }
    ],
    workQueues: [
      {
        id: "queue-sales",
        name: "Sales queue",
        kind: "sales" as const,
        owningOrgUnitId: "org-sales",
        status: "active" as const,
        routingConfig: {}
      }
    ]
  }));
  const upsertOrgUnit = vi.fn(
    async (_context: unknown, request: InternalOrgUnitUpsertRequest) => ({
      id: request.id ?? "org-generated",
      parentOrgUnitId: request.parentOrgUnitId ?? null,
      name: request.name,
      kind: request.kind,
      status: request.status
    })
  );
  const upsertWorkQueue = vi.fn(
    async (_context: unknown, request: InternalWorkQueueUpsertRequest) => ({
      id: request.id ?? "queue-generated",
      name: request.name,
      kind: request.kind,
      owningOrgUnitId: request.owningOrgUnitId ?? null,
      status: request.status,
      routingConfig: request.routingConfig
    })
  );
  const handler = createInternalApiHandler({
    requestIdFactory: () => "request-1",
    sessionResolver: {
      async resolve() {
        return input?.session === undefined ? session : input.session;
      }
    },
    inboxQueries: { loadInboxView },
    inboxCommands: { sendReply, updateConversationRouting },
    integrations: {
      loadTelegramIntegration,
      updateTelegramIntegration,
      refreshTelegramDiagnostics,
      setTelegramWebhook,
      deleteTelegramWebhook
    },
    tenantSettings: {
      loadTenantBrand,
      updateTenantBrand
    },
    orgStructure: {
      loadOrgStructure,
      upsertOrgUnit,
      upsertWorkQueue
    }
  });

  return {
    handler,
    loadInboxView,
    sendReply,
    updateConversationRouting,
    loadTelegramIntegration,
    updateTelegramIntegration,
    refreshTelegramDiagnostics,
    setTelegramWebhook,
    deleteTelegramWebhook,
    loadTenantBrand,
    updateTenantBrand,
    loadOrgStructure,
    upsertOrgUnit,
    upsertWorkQueue
  };
}

describe("internal API handler", () => {
  it("serves versioned health without a session", async () => {
    const { handler } = createHandler({ session: null });
    const response = await handler.handle({
      method: "GET",
      path: "/internal/v1/health"
    });

    expect(response).toEqual({
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8"
      },
      body: {
        status: "ok",
        version: "v1"
      }
    });
  });

  it("rejects internal routes without a session", async () => {
    const { handler } = createHandler({ session: null });
    const response = await handler.handle({
      method: "GET",
      path: "/internal/v1/inbox"
    });

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      error: {
        code: "auth.invalid_credentials",
        requestId: "request-1"
      }
    });
  });

  it("loads inbox through the tenant-scoped session context", async () => {
    const { handler, loadInboxView } = createHandler();
    const response = await handler.handle({
      method: "GET",
      path: "/internal/v1/inbox?conversationId=conversation-1&queueId=queue-sales&assigned=me"
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(inboxView);
    expect(loadInboxView).toHaveBeenCalledWith(session, {
      selectedConversationId: "conversation-1",
      filters: {
        queueId: "queue-sales",
        assignedToMe: true
      }
    });
  });

  it("requires inbox.read permission for the inbox view", async () => {
    const { handler } = createHandler({
      session: {
        ...session,
        permissions: ["message.reply", "modules.manage"]
      }
    });
    const response = await handler.handle({
      method: "GET",
      path: "/internal/v1/inbox"
    });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      error: {
        code: "permission.denied"
      }
    });
  });

  it("loads and updates tenant brand through tenant.manage permission", async () => {
    const { handler, loadTenantBrand, updateTenantBrand } = createHandler();
    const loadResponse = await handler.handle({
      method: "GET",
      path: "/internal/v1/tenant/brand"
    });
    const updateResponse = await handler.handle({
      method: "PUT",
      path: "/internal/v1/tenant/brand",
      body: {
        productName: "Acme Desk",
        shortProductName: "Acme",
        themeTokens: {
          "color.brand.primary": "#177f75",
          "color.brand.foreground": "#ffffff"
        }
      }
    });

    expect(loadResponse.status).toBe(200);
    expect(loadResponse.body).toEqual({
      brand: inboxView.tenant.brand
    });
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body).toMatchObject({
      brand: {
        productName: "Acme Desk",
        shortProductName: "Acme",
        themeTokens: {
          "color.brand.primary": "#177f75"
        }
      }
    });
    expect(loadTenantBrand).toHaveBeenCalledWith(session);
    expect(updateTenantBrand).toHaveBeenCalledWith(session, {
      productName: "Acme Desk",
      shortProductName: "Acme",
      themeTokens: {
        "color.brand.primary": "#177f75",
        "color.brand.foreground": "#ffffff"
      }
    });
  });

  it("requires tenant.manage for tenant brand routes", async () => {
    const { handler } = createHandler({
      session: {
        ...session,
        permissions: ["inbox.read", "message.reply", "modules.manage"]
      }
    });
    const response = await handler.handle({
      method: "GET",
      path: "/internal/v1/tenant/brand"
    });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      error: {
        code: "permission.denied"
      }
    });
  });

  it("loads and upserts org structure through employees.manage permission", async () => {
    const { handler, loadOrgStructure, upsertOrgUnit, upsertWorkQueue } =
      createHandler();
    const loadResponse = await handler.handle({
      method: "GET",
      path: "/internal/v1/org-structure"
    });
    const orgUnitResponse = await handler.handle({
      method: "PUT",
      path: "/internal/v1/org-structure/org-units",
      body: {
        name: " Sales ",
        kind: "department"
      }
    });
    const queueResponse = await handler.handle({
      method: "PUT",
      path: "/internal/v1/org-structure/work-queues",
      body: {
        name: " Claims ",
        kind: "claims",
        owningOrgUnitId: "org-sales"
      }
    });

    expect(loadResponse.status).toBe(200);
    expect(loadResponse.body).toMatchObject({
      orgUnits: [
        {
          id: "org-sales"
        }
      ],
      workQueues: [
        {
          id: "queue-sales"
        }
      ]
    });
    expect(orgUnitResponse.status).toBe(200);
    expect(orgUnitResponse.body).toMatchObject({
      id: "org-generated",
      name: "Sales",
      status: "active"
    });
    expect(queueResponse.status).toBe(200);
    expect(queueResponse.body).toMatchObject({
      id: "queue-generated",
      name: "Claims",
      kind: "claims",
      owningOrgUnitId: "org-sales"
    });
    expect(loadOrgStructure).toHaveBeenCalledWith(session);
    expect(upsertOrgUnit).toHaveBeenCalledWith(session, {
      name: "Sales",
      kind: "department",
      status: "active"
    });
    expect(upsertWorkQueue).toHaveBeenCalledWith(session, {
      name: "Claims",
      kind: "claims",
      owningOrgUnitId: "org-sales",
      status: "active",
      routingConfig: {}
    });
  });

  it("requires employees.manage for org structure routes", async () => {
    const { handler } = createHandler({
      session: {
        ...session,
        permissions: ["tenant.manage", "inbox.read", "message.reply"]
      }
    });
    const response = await handler.handle({
      method: "GET",
      path: "/internal/v1/org-structure"
    });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      error: {
        code: "permission.denied"
      }
    });
  });

  it("validates and queues replies through the command service", async () => {
    const { handler, sendReply } = createHandler();
    const response = await handler.handle({
      method: "POST",
      path: "/internal/v1/inbox/conversations/conversation-1/replies",
      body: {
        text: " Hello ",
        idempotencyKey: "reply-1"
      }
    });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      messageId: "message-1",
      status: "queued",
      idempotencyKey: "reply-1"
    });
    expect(sendReply).toHaveBeenCalledWith(session, {
      conversationId: "conversation-1",
      request: {
        text: "Hello",
        idempotencyKey: "reply-1"
      }
    });
  });

  it("rejects empty reply bodies before command execution", async () => {
    const { handler, sendReply } = createHandler();
    const response = await handler.handle({
      method: "POST",
      path: "/internal/v1/inbox/conversations/conversation-1/replies",
      body: {
        text: " "
      }
    });

    expect(response.status).toBe(400);
    expect(sendReply).not.toHaveBeenCalled();
  });

  it("validates and updates conversation routing through conversation.assign", async () => {
    const { handler, updateConversationRouting } = createHandler();
    const response = await handler.handle({
      method: "PATCH",
      path: "/internal/v1/inbox/conversations/conversation-1/routing",
      body: {
        currentQueueId: " queue-sales ",
        assignedEmployeeId: "employee-2",
        assignedTeamId: null
      }
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      conversationId: "conversation-1",
      currentQueueId: "queue-sales",
      assignedEmployeeId: "employee-2"
    });
    expect(updateConversationRouting).toHaveBeenCalledWith(session, {
      conversationId: "conversation-1",
      request: {
        currentQueueId: "queue-sales",
        assignedEmployeeId: "employee-2",
        assignedTeamId: null
      }
    });
  });

  it("requires conversation.assign for conversation routing updates", async () => {
    const { handler, updateConversationRouting } = createHandler({
      session: {
        ...session,
        permissions: ["inbox.read", "message.reply"]
      }
    });
    const response = await handler.handle({
      method: "PATCH",
      path: "/internal/v1/inbox/conversations/conversation-1/routing",
      body: {
        currentQueueId: "queue-sales"
      }
    });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      error: {
        code: "permission.denied"
      }
    });
    expect(updateConversationRouting).not.toHaveBeenCalled();
  });

  it("loads Telegram integration config through modules.manage permission", async () => {
    const { handler, loadTelegramIntegration } = createHandler();
    const response = await handler.handle({
      method: "GET",
      path: "/internal/v1/integrations/telegram"
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      moduleId: "channel-telegram",
      enabled: true,
      webhookPath: "/webhooks/telegram/telegram-local"
    });
    expect(loadTelegramIntegration).toHaveBeenCalledWith(session);
  });

  it("updates Telegram integration config after request validation", async () => {
    const { handler, updateTelegramIntegration } = createHandler();
    const response = await handler.handle({
      method: "PUT",
      path: "/internal/v1/integrations/telegram",
      body: {
        enabled: true,
        channelExternalId: "telegram-local",
        mode: "webhook",
        botTokenSecretRef: "env:HULEE_TELEGRAM_BOT_TOKEN",
        outboundEnabled: true
      }
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      enabled: true,
      config: {
        channelExternalId: "telegram-local",
        outboundEnabled: true
      }
    });
    expect(updateTelegramIntegration).toHaveBeenCalledWith(session, {
      enabled: true,
      channelExternalId: "telegram-local",
      mode: "webhook",
      botTokenSecretRef: "env:HULEE_TELEGRAM_BOT_TOKEN",
      outboundEnabled: true
    });
  });

  it("requires modules.manage for Telegram integration routes", async () => {
    const { handler } = createHandler({
      session: {
        ...session,
        permissions: ["inbox.read", "message.reply"]
      }
    });
    const response = await handler.handle({
      method: "GET",
      path: "/internal/v1/integrations/telegram"
    });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      error: {
        code: "permission.denied"
      }
    });
  });

  it("honors permissions passed by the internal web client headers", async () => {
    const localDevResolver = createLocalDevInternalSessionResolver();
    const resolvedSession = await localDevResolver.resolve(
      {
        method: "GET",
        path: "/internal/v1/integrations/telegram",
        headers: {
          "x-hulee-tenant-id": tenantId,
          "x-hulee-employee-id": employeeId,
          "x-hulee-permissions": "inbox.read,message.reply"
        }
      },
      "request-1"
    );
    const guardedHandler = createHandler({ session: resolvedSession }).handler;
    const response = await guardedHandler.handle({
      method: "GET",
      path: "/internal/v1/integrations/telegram"
    });

    expect(resolvedSession?.permissions).toEqual([
      "inbox.read",
      "message.reply"
    ]);
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      error: {
        code: "permission.denied"
      }
    });
  });

  it("resolves signed internal web client headers", async () => {
    const resolver = createSignedInternalSessionResolver({
      secret: "internal-secret",
      now: () => new Date("2026-06-23T10:00:01.000Z")
    });
    const request = {
      method: "POST" as const,
      path: "/internal/v1/inbox/conversations/conversation-1/replies",
      headers: {
        "x-hulee-tenant-id": tenantId,
        "x-hulee-employee-id": employeeId,
        "x-hulee-permissions": "inbox.read,message.reply",
        [internalApiTimestampHeader]: "2026-06-23T10:00:00.000Z"
      },
      body: {
        text: "Hello",
        idempotencyKey: "reply-1"
      }
    };
    const signedRequest = {
      ...request,
      headers: {
        ...request.headers,
        [internalApiSignatureHeader]: createInternalApiSignature(
          "internal-secret",
          {
            method: request.method,
            path: request.path,
            body: request.body,
            tenantId,
            employeeId,
            permissions: ["inbox.read", "message.reply"],
            timestamp: request.headers[internalApiTimestampHeader]
          }
        )
      }
    };

    await expect(
      resolver.resolve(signedRequest, "request-1")
    ).resolves.toMatchObject({
      tenantId,
      employeeId,
      permissions: ["inbox.read", "message.reply"]
    });
  });

  it("rejects unsigned or tampered internal web client headers when signing is enabled", async () => {
    const resolver = createSignedInternalSessionResolver({
      secret: "internal-secret",
      now: () => new Date("2026-06-23T10:00:01.000Z")
    });
    const timestamp = "2026-06-23T10:00:00.000Z";
    const body = {
      text: "Hello"
    };
    const signature = createInternalApiSignature("internal-secret", {
      method: "POST",
      path: "/internal/v1/inbox/conversations/conversation-1/replies",
      body,
      tenantId,
      employeeId,
      permissions: ["message.reply"],
      timestamp
    });

    await expect(
      resolver.resolve(
        {
          method: "POST",
          path: "/internal/v1/inbox/conversations/conversation-1/replies",
          headers: {
            "x-hulee-tenant-id": tenantId,
            "x-hulee-employee-id": employeeId,
            "x-hulee-permissions": "message.reply",
            [internalApiTimestampHeader]: timestamp
          },
          body
        },
        "request-1"
      )
    ).resolves.toBeNull();
    await expect(
      resolver.resolve(
        {
          method: "POST",
          path: "/internal/v1/inbox/conversations/conversation-1/replies",
          headers: {
            "x-hulee-tenant-id": tenantId,
            "x-hulee-employee-id": employeeId,
            "x-hulee-permissions": "message.reply",
            [internalApiTimestampHeader]: timestamp,
            [internalApiSignatureHeader]: signature
          },
          body: {
            text: "Changed"
          }
        },
        "request-1"
      )
    ).resolves.toBeNull();
  });

  it("rejects invalid Telegram integration payloads before command execution", async () => {
    const { handler, updateTelegramIntegration } = createHandler();
    const response = await handler.handle({
      method: "PUT",
      path: "/internal/v1/integrations/telegram",
      body: {
        enabled: true,
        channelExternalId: "",
        outboundEnabled: false
      }
    });

    expect(response.status).toBe(400);
    expect(updateTelegramIntegration).not.toHaveBeenCalled();
  });

  it("refreshes Telegram diagnostics through modules.manage permission", async () => {
    const { handler, refreshTelegramDiagnostics } = createHandler();
    const response = await handler.handle({
      method: "POST",
      path: "/internal/v1/integrations/telegram/diagnostics"
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      diagnostics: {
        checks: {
          botApiReachable: true
        }
      }
    });
    expect(refreshTelegramDiagnostics).toHaveBeenCalledWith(session);
  });

  it("syncs Telegram webhook through modules.manage permission", async () => {
    const { handler, setTelegramWebhook, deleteTelegramWebhook } =
      createHandler();
    const setResponse = await handler.handle({
      method: "POST",
      path: "/internal/v1/integrations/telegram/webhook"
    });
    const deleteResponse = await handler.handle({
      method: "DELETE",
      path: "/internal/v1/integrations/telegram/webhook"
    });

    expect(setResponse.status).toBe(200);
    expect(deleteResponse.status).toBe(200);
    expect(setTelegramWebhook).toHaveBeenCalledWith(session);
    expect(deleteTelegramWebhook).toHaveBeenCalledWith(session);
  });
});
