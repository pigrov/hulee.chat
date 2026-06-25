import type {
  EmployeeId,
  InternalAccessDecisionRequest,
  InternalAccessDecisionResponse,
  InternalInboxViewResponse,
  InternalOrgUnitUpsertRequest,
  InternalTenantBrandUpdateRequest,
  InternalTelegramIntegrationUpdateRequest,
  InternalWorkQueueUpsertRequest,
  TenantId
} from "@hulee/contracts";
import {
  CoreError,
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
  ],
  authMode: "signed"
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
  const inspectAccessDecision = vi.fn(
    async (
      _context: unknown,
      request: InternalAccessDecisionRequest
    ): Promise<InternalAccessDecisionResponse> => ({
      employeeId: request.employeeId,
      permission: request.permission,
      resource: request.resource,
      evaluatedAt: "2026-06-24T10:00:00.000Z",
      decision: {
        allowed: false,
        reason: "missing_permission"
      },
      candidateGrants: [],
      effectiveGrantCount: 0
    })
  );
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
    },
    accessDecisions: {
      inspectAccessDecision
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
    upsertWorkQueue,
    inspectAccessDecision
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

  it("delegates inbox authorization to the query service", async () => {
    const scopedSession: InternalApiSession = {
      ...session,
      permissions: ["message.reply", "modules.manage"]
    };
    const { handler, loadInboxView } = createHandler({
      session: scopedSession
    });
    const response = await handler.handle({
      method: "GET",
      path: "/internal/v1/inbox"
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(inboxView);
    expect(loadInboxView).toHaveBeenCalledWith(scopedSession, {
      selectedConversationId: undefined,
      filters: {
        queueId: undefined,
        assignedToMe: false
      }
    });
  });

  it("returns inbox permission errors from the query service", async () => {
    const scopedSession: InternalApiSession = {
      ...session,
      permissions: []
    };
    const { handler, loadInboxView } = createHandler({
      session: scopedSession
    });
    loadInboxView.mockRejectedValueOnce(new CoreError("permission.denied"));

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
    expect(loadInboxView).toHaveBeenCalledWith(scopedSession, {
      selectedConversationId: undefined,
      filters: {
        queueId: undefined,
        assignedToMe: false
      }
    });
  });

  it("loads and updates tenant brand through tenant.manage permission", async () => {
    const tenantManageSession = sessionWithPermissions(["tenant.manage"]);
    const { handler, loadTenantBrand, updateTenantBrand } = createHandler({
      session: tenantManageSession
    });
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
    expect(loadTenantBrand).toHaveBeenCalledWith(tenantManageSession);
    expect(updateTenantBrand).toHaveBeenCalledWith(tenantManageSession, {
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
      session: sessionWithPermissions([
        "inbox.read",
        "message.reply",
        "modules.manage"
      ])
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

  it("requires signed narrow effective permission override for admin settings routes", async () => {
    const { handler, loadTenantBrand } = createHandler({
      session
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
    expect(loadTenantBrand).not.toHaveBeenCalled();
  });

  it("requires narrow effective permission override in local dev mode too", async () => {
    const { handler, loadTenantBrand } = createHandler({
      session: sessionWithPermissions(
        ["tenant.manage", "employees.manage"],
        "local_dev"
      )
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
    expect(loadTenantBrand).not.toHaveBeenCalled();
  });

  it("loads and upserts org structure through employees.manage permission", async () => {
    const employeesManageSession = sessionWithPermissions(["employees.manage"]);
    const { handler, loadOrgStructure, upsertOrgUnit, upsertWorkQueue } =
      createHandler({
        session: employeesManageSession
      });
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
    expect(loadOrgStructure).toHaveBeenCalledWith(employeesManageSession);
    expect(upsertOrgUnit).toHaveBeenCalledWith(employeesManageSession, {
      name: "Sales",
      kind: "department",
      status: "active"
    });
    expect(upsertWorkQueue).toHaveBeenCalledWith(employeesManageSession, {
      name: "Claims",
      kind: "claims",
      owningOrgUnitId: "org-sales",
      status: "active",
      routingConfig: {}
    });
  });

  it("requires employees.manage for org structure routes", async () => {
    const { handler } = createHandler({
      session: sessionWithPermissions([
        "tenant.manage",
        "inbox.read",
        "message.reply"
      ])
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

  it("requires narrow employees.manage override for org structure routes", async () => {
    const { handler, loadOrgStructure, upsertOrgUnit, upsertWorkQueue } =
      createHandler({
        session: sessionWithPermissions(["employees.manage", "tenant.manage"])
      });
    const loadResponse = await handler.handle({
      method: "GET",
      path: "/internal/v1/org-structure"
    });
    const orgUnitResponse = await handler.handle({
      method: "PUT",
      path: "/internal/v1/org-structure/org-units",
      body: {
        name: "Sales",
        kind: "department"
      }
    });
    const queueResponse = await handler.handle({
      method: "PUT",
      path: "/internal/v1/org-structure/work-queues",
      body: {
        name: "Claims",
        kind: "claims",
        owningOrgUnitId: "org-sales"
      }
    });

    for (const response of [loadResponse, orgUnitResponse, queueResponse]) {
      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({
        error: {
          code: "permission.denied"
        }
      });
    }
    expect(loadOrgStructure).not.toHaveBeenCalled();
    expect(upsertOrgUnit).not.toHaveBeenCalled();
    expect(upsertWorkQueue).not.toHaveBeenCalled();
  });

  it("inspects access decisions through roles.manage permission", async () => {
    const rolesManageSession = sessionWithPermissions(["roles.manage"]);
    const { handler, inspectAccessDecision } = createHandler({
      session: rolesManageSession
    });
    const response = await handler.handle({
      method: "POST",
      path: "/internal/v1/access/decision",
      body: {
        employeeId: "employee-2",
        permission: "conversation.read",
        resource: {
          queueId: " queue-sales "
        },
        at: "2026-06-24T10:00:00.000Z"
      }
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      employeeId: "employee-2",
      permission: "conversation.read",
      decision: {
        allowed: false,
        reason: "missing_permission"
      }
    });
    expect(inspectAccessDecision).toHaveBeenCalledWith(rolesManageSession, {
      employeeId: "employee-2",
      permission: "conversation.read",
      resource: {
        queueId: "queue-sales"
      },
      at: "2026-06-24T10:00:00.000Z"
    });
  });

  it("requires a signed narrow roles.manage override for access decisions", async () => {
    const { handler, inspectAccessDecision } = createHandler({
      session: sessionWithPermissions(["roles.manage", "tenant.manage"])
    });
    const response = await handler.handle({
      method: "POST",
      path: "/internal/v1/access/decision",
      body: {
        employeeId: "employee-2",
        permission: "conversation.read",
        resource: {}
      }
    });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      error: {
        code: "permission.denied"
      }
    });
    expect(inspectAccessDecision).not.toHaveBeenCalled();
  });

  it("rejects invalid access decision payloads before service execution", async () => {
    const { handler, inspectAccessDecision } = createHandler({
      session: sessionWithPermissions(["roles.manage"])
    });
    const response = await handler.handle({
      method: "POST",
      path: "/internal/v1/access/decision",
      body: {
        employeeId: "",
        permission: "conversation.read",
        resource: {}
      }
    });

    expect(response.status).toBe(400);
    expect(inspectAccessDecision).not.toHaveBeenCalled();
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

  it("delegates reply authorization to the command service instead of session permissions", async () => {
    const scopedSession = sessionWithPermissions([]);
    const { handler, sendReply } = createHandler({
      session: scopedSession
    });
    const response = await handler.handle({
      method: "POST",
      path: "/internal/v1/inbox/conversations/conversation-1/replies",
      body: {
        text: "Hello",
        idempotencyKey: "reply-1"
      }
    });

    expect(response.status).toBe(202);
    expect(sendReply).toHaveBeenCalledWith(scopedSession, {
      conversationId: "conversation-1",
      request: {
        text: "Hello",
        idempotencyKey: "reply-1"
      }
    });
  });

  it("returns reply permission errors from the command service", async () => {
    const scopedSession: InternalApiSession = {
      ...session,
      permissions: ["inbox.read"]
    };
    const { handler, sendReply } = createHandler({
      session: scopedSession
    });
    sendReply.mockRejectedValueOnce(new CoreError("permission.denied"));

    const response = await handler.handle({
      method: "POST",
      path: "/internal/v1/inbox/conversations/conversation-1/replies",
      body: {
        text: " Hello ",
        idempotencyKey: "reply-1"
      }
    });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      error: {
        code: "permission.denied"
      }
    });
    expect(sendReply).toHaveBeenCalledWith(scopedSession, {
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

  it("validates and updates conversation routing through the command service", async () => {
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

  it("delegates routing authorization to the command service instead of session permissions", async () => {
    const scopedSession = sessionWithPermissions([]);
    const { handler, updateConversationRouting } = createHandler({
      session: scopedSession
    });
    const response = await handler.handle({
      method: "PATCH",
      path: "/internal/v1/inbox/conversations/conversation-1/routing",
      body: {
        currentQueueId: "queue-sales"
      }
    });

    expect(response.status).toBe(200);
    expect(updateConversationRouting).toHaveBeenCalledWith(scopedSession, {
      conversationId: "conversation-1",
      request: {
        currentQueueId: "queue-sales"
      }
    });
  });

  it("returns routing permission errors from the command service", async () => {
    const scopedSession: InternalApiSession = {
      ...session,
      permissions: ["inbox.read", "message.reply"]
    };
    const { handler, updateConversationRouting } = createHandler({
      session: scopedSession
    });
    updateConversationRouting.mockRejectedValueOnce(
      new CoreError("permission.denied")
    );

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
    expect(updateConversationRouting).toHaveBeenCalledWith(scopedSession, {
      conversationId: "conversation-1",
      request: {
        currentQueueId: "queue-sales"
      }
    });
  });

  it("loads Telegram integration config through modules.manage permission", async () => {
    const modulesManageSession = sessionWithPermissions(["modules.manage"]);
    const { handler, loadTelegramIntegration } = createHandler({
      session: modulesManageSession
    });
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
    expect(loadTelegramIntegration).toHaveBeenCalledWith(modulesManageSession);
  });

  it("updates Telegram integration config after request validation", async () => {
    const modulesManageSession = sessionWithPermissions(["modules.manage"]);
    const { handler, updateTelegramIntegration } = createHandler({
      session: modulesManageSession
    });
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
    expect(updateTelegramIntegration).toHaveBeenCalledWith(
      modulesManageSession,
      {
        enabled: true,
        channelExternalId: "telegram-local",
        mode: "webhook",
        botTokenSecretRef: "env:HULEE_TELEGRAM_BOT_TOKEN",
        outboundEnabled: true
      }
    );
  });

  it("requires modules.manage for Telegram integration routes", async () => {
    const { handler } = createHandler({
      session: sessionWithPermissions(["inbox.read", "message.reply"])
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

  it("requires narrow modules.manage override for Telegram integration routes", async () => {
    const {
      handler,
      loadTelegramIntegration,
      updateTelegramIntegration,
      refreshTelegramDiagnostics,
      setTelegramWebhook,
      deleteTelegramWebhook
    } = createHandler({
      session: sessionWithPermissions(["modules.manage", "tenant.manage"])
    });
    const loadResponse = await handler.handle({
      method: "GET",
      path: "/internal/v1/integrations/telegram"
    });
    const updateResponse = await handler.handle({
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
    const diagnosticsResponse = await handler.handle({
      method: "POST",
      path: "/internal/v1/integrations/telegram/diagnostics"
    });
    const setWebhookResponse = await handler.handle({
      method: "POST",
      path: "/internal/v1/integrations/telegram/webhook"
    });
    const deleteWebhookResponse = await handler.handle({
      method: "DELETE",
      path: "/internal/v1/integrations/telegram/webhook"
    });

    for (const response of [
      loadResponse,
      updateResponse,
      diagnosticsResponse,
      setWebhookResponse,
      deleteWebhookResponse
    ]) {
      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({
        error: {
          code: "permission.denied"
        }
      });
    }
    expect(loadTelegramIntegration).not.toHaveBeenCalled();
    expect(updateTelegramIntegration).not.toHaveBeenCalled();
    expect(refreshTelegramDiagnostics).not.toHaveBeenCalled();
    expect(setTelegramWebhook).not.toHaveBeenCalled();
    expect(deleteTelegramWebhook).not.toHaveBeenCalled();
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

  it("does not create unsigned fallback sessions without explicit headers", async () => {
    const localDevResolver = createLocalDevInternalSessionResolver();
    const unsignedResolver = createSignedInternalSessionResolver({});
    const request = {
      method: "GET" as const,
      path: "/internal/v1/integrations/telegram",
      headers: {}
    };

    await expect(
      localDevResolver.resolve(request, "request-1")
    ).resolves.toBeNull();
    await expect(
      unsignedResolver.resolve(request, "request-1")
    ).resolves.toBeNull();
  });

  it("resolves explicit local dev headers when signing is not configured", async () => {
    const resolver = createSignedInternalSessionResolver({});

    await expect(
      resolver.resolve(
        {
          method: "GET",
          path: "/internal/v1/integrations/telegram",
          headers: {
            "x-hulee-tenant-id": tenantId,
            "x-hulee-employee-id": employeeId,
            "x-hulee-permissions": "modules.manage"
          }
        },
        "request-1"
      )
    ).resolves.toMatchObject({
      tenantId,
      employeeId,
      permissions: ["modules.manage"],
      authMode: "local_dev"
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
      permissions: ["inbox.read", "message.reply"],
      authMode: "signed"
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
    const { handler, updateTelegramIntegration } = createHandler({
      session: sessionWithPermissions(["modules.manage"])
    });
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
    const modulesManageSession = sessionWithPermissions(["modules.manage"]);
    const { handler, refreshTelegramDiagnostics } = createHandler({
      session: modulesManageSession
    });
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
    expect(refreshTelegramDiagnostics).toHaveBeenCalledWith(
      modulesManageSession
    );
  });

  it("syncs Telegram webhook through modules.manage permission", async () => {
    const modulesManageSession = sessionWithPermissions(["modules.manage"]);
    const { handler, setTelegramWebhook, deleteTelegramWebhook } =
      createHandler({
        session: modulesManageSession
      });
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
    expect(setTelegramWebhook).toHaveBeenCalledWith(modulesManageSession);
    expect(deleteTelegramWebhook).toHaveBeenCalledWith(modulesManageSession);
  });
});

function sessionWithPermissions(
  permissions: InternalApiSession["permissions"],
  authMode: InternalApiSession["authMode"] = "signed"
): InternalApiSession {
  return {
    ...session,
    permissions,
    authMode
  };
}
