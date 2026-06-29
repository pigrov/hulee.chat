import type {
  EmployeeId,
  InternalAccessDecisionRequest,
  InternalAccessDecisionResponse,
  InternalInboxViewResponse,
  InternalOrgUnitUpsertRequest,
  InternalRbacDirectGrantCreateRequest,
  InternalRbacRoleBindingCreateRequest,
  InternalRbacRoleMutationRequest,
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
  const rbacRole = {
    id: "role-sales",
    name: "Sales",
    description: "Sales role",
    status: "active" as const,
    isSystem: false,
    permissions: ["conversation.read", "message.reply"],
    createdByEmployeeId: employeeId,
    archivedAt: undefined
  };
  const rbacRoleBinding = {
    id: "binding-sales",
    roleId: "role-sales",
    subject: {
      type: "employee" as const,
      id: "employee-2"
    },
    scope: {
      type: "queue" as const,
      id: "queue-sales"
    }
  };
  const rbacDirectGrant = {
    id: "grant-sales",
    employeeId: "employee-2",
    permission: "conversation.assign",
    scope: {
      type: "queue" as const,
      id: "queue-sales"
    },
    reason: "temporary coverage"
  };
  const listRoles = vi.fn(async () => ({
    roles: [rbacRole]
  }));
  const createRole = vi.fn(
    async (_context: unknown, request: InternalRbacRoleMutationRequest) => ({
      role: {
        ...rbacRole,
        id: "role-created",
        name: request.name,
        description: request.description ?? null,
        permissions: request.permissions
      }
    })
  );
  const updateRole = vi.fn(
    async (
      _context: unknown,
      input: { roleId: string; request: InternalRbacRoleMutationRequest }
    ) => ({
      role: {
        ...rbacRole,
        id: input.roleId,
        name: input.request.name,
        description: input.request.description ?? null,
        permissions: input.request.permissions
      }
    })
  );
  const archiveRole = vi.fn(
    async (_context: unknown, input: { roleId: string }) => ({
      role: {
        ...rbacRole,
        id: input.roleId,
        status: "archived" as const,
        archivedAt: "2026-06-24T10:00:00.000Z"
      }
    })
  );
  const restoreRole = vi.fn(
    async (_context: unknown, input: { roleId: string }) => ({
      role: {
        ...rbacRole,
        id: input.roleId,
        status: "active" as const,
        archivedAt: undefined
      }
    })
  );
  const listRoleBindings = vi.fn(async () => ({
    roleBindings: [rbacRoleBinding]
  }));
  const createRoleBinding = vi.fn(
    async (
      _context: unknown,
      request: InternalRbacRoleBindingCreateRequest
    ) => ({
      roleBinding: {
        ...rbacRoleBinding,
        roleId: request.roleId,
        subject: request.subject,
        scope: request.scope,
        expiresAt: request.expiresAt
      }
    })
  );
  const revokeRoleBinding = vi.fn(async () => ({
    revoked: true as const
  }));
  const listDirectGrants = vi.fn(async () => ({
    directGrants: [rbacDirectGrant]
  }));
  const createDirectGrant = vi.fn(
    async (
      _context: unknown,
      request: InternalRbacDirectGrantCreateRequest
    ) => ({
      directGrant: {
        ...rbacDirectGrant,
        employeeId: request.employeeId,
        permission: request.permission,
        scope: request.scope,
        reason: request.reason,
        expiresAt: request.expiresAt
      }
    })
  );
  const revokeDirectGrant = vi.fn(async () => ({
    revoked: true as const
  }));
  const listChannelCatalog = vi.fn(async () => ({
    channels: [
      {
        channelType: "telegram_bot" as const,
        channelClass: "bot_bridge" as const,
        provider: "telegram",
        titleKey: "integrations.catalog.telegramBot.title",
        descriptionKey: "integrations.catalog.telegramBot.description",
        readiness: "available" as const,
        supportsMultiple: true,
        capabilities: ["inbound", "outbound", "webhook"],
        onboarding: {
          version: "v1" as const,
          steps: [
            {
              id: "name",
              kind: "display_name" as const,
              titleKey: "integrations.channel.onboarding.name",
              action: "update_connector" as const
            },
            {
              id: "complete",
              kind: "complete" as const,
              titleKey: "integrations.channel.onboarding.complete"
            }
          ]
        }
      }
    ]
  }));
  const listChannelConnectors = vi.fn(async () => ({
    connectors: [
      {
        connectorId: "telegram_bot:tenant-1",
        channelType: "telegram_bot" as const,
        channelClass: "bot_bridge" as const,
        provider: "telegram",
        displayName: "Telegram Bot",
        status: "connected" as const,
        healthStatus: "healthy" as const,
        channelExternalId: "telegram-local",
        diagnosticsStatus: "configured"
      }
    ]
  }));
  const createChannelConnector = vi.fn(async () => ({
    connectorId: "telegram_bot:generated",
    channelType: "telegram_bot" as const,
    channelClass: "bot_bridge" as const,
    provider: "telegram",
    displayName: "Telegram Bot",
    status: "draft" as const,
    healthStatus: "unknown" as const,
    channelExternalId: "telegram-generated",
    diagnosticsStatus: "disabled"
  }));
  const disableChannelConnector = vi.fn(async () => ({
    connectorId: "telegram_bot:tenant-1",
    channelType: "telegram_bot" as const,
    channelClass: "bot_bridge" as const,
    provider: "telegram",
    displayName: "Telegram Bot",
    status: "disabled" as const,
    healthStatus: "unknown" as const,
    channelExternalId: "telegram-local",
    diagnosticsStatus: "disabled"
  }));
  const deleteChannelConnector = vi.fn(async () => ({
    connectorId: "telegram_bot:tenant-1",
    channelType: "telegram_bot" as const,
    channelClass: "bot_bridge" as const,
    provider: "telegram",
    displayName: "Telegram Bot",
    status: "deleted" as const,
    healthStatus: "unknown" as const,
    channelExternalId: "telegram-local",
    diagnosticsStatus: "disabled"
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
  const channelAuthChallengeResponse = {
    challenge: {
      challengeId: "challenge-1",
      connectorId: "telegram_qr_bridge:tenant-1",
      challengeType: "phone_code" as const,
      status: "requires_code" as const,
      publicPayload: {
        phoneNumber: "+79990000000",
        expiresAt: "2026-06-29T10:00:00.000Z"
      },
      expiresAt: "2026-06-29T10:00:00.000Z",
      createdAt: "2026-06-29T09:55:00.000Z",
      updatedAt: "2026-06-29T09:55:00.000Z"
    }
  };
  const startChannelAuthChallenge = vi.fn(
    async () => channelAuthChallengeResponse
  );
  const loadChannelAuthChallenge = vi.fn(
    async () => channelAuthChallengeResponse
  );
  const submitChannelAuthChallenge = vi.fn(async () => ({
    challenge: {
      ...channelAuthChallengeResponse.challenge,
      status: "waiting" as const
    }
  }));
  const cancelChannelAuthChallenge = vi.fn(async () => ({
    challenge: {
      ...channelAuthChallengeResponse.challenge,
      status: "cancelled" as const,
      completedAt: "2026-06-29T09:56:00.000Z"
    }
  }));
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
      listChannelCatalog,
      listChannelConnectors,
      createChannelConnector,
      disableChannelConnector,
      deleteChannelConnector,
      startChannelAuthChallenge,
      loadChannelAuthChallenge,
      submitChannelAuthChallenge,
      cancelChannelAuthChallenge,
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
    },
    rbac: {
      listRoles,
      createRole,
      updateRole,
      archiveRole,
      restoreRole,
      listRoleBindings,
      createRoleBinding,
      revokeRoleBinding,
      listDirectGrants,
      createDirectGrant,
      revokeDirectGrant
    }
  });

  return {
    handler,
    loadInboxView,
    sendReply,
    updateConversationRouting,
    listChannelCatalog,
    listChannelConnectors,
    createChannelConnector,
    disableChannelConnector,
    deleteChannelConnector,
    startChannelAuthChallenge,
    loadChannelAuthChallenge,
    submitChannelAuthChallenge,
    cancelChannelAuthChallenge,
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
    inspectAccessDecision,
    listRoles,
    createRole,
    updateRole,
    archiveRole,
    restoreRole,
    listRoleBindings,
    createRoleBinding,
    revokeRoleBinding,
    listDirectGrants,
    createDirectGrant,
    revokeDirectGrant
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

  it("manages RBAC roles through roles.manage permission", async () => {
    const rolesManageSession = sessionWithPermissions(["roles.manage"]);
    const {
      handler,
      listRoles,
      createRole,
      updateRole,
      archiveRole,
      restoreRole
    } = createHandler({
      session: rolesManageSession
    });
    const listResponse = await handler.handle({
      method: "GET",
      path: "/internal/v1/rbac/roles"
    });
    const createResponse = await handler.handle({
      method: "POST",
      path: "/internal/v1/rbac/roles",
      body: {
        name: " Sales ",
        description: " Sales role ",
        permissions: ["conversation.read", "message.reply"]
      }
    });
    const updateResponse = await handler.handle({
      method: "PATCH",
      path: "/internal/v1/rbac/roles/role-sales",
      body: {
        name: " Sales lead ",
        permissions: ["conversation.read"]
      }
    });
    const archiveResponse = await handler.handle({
      method: "POST",
      path: "/internal/v1/rbac/roles/role-sales/archive"
    });
    const restoreResponse = await handler.handle({
      method: "POST",
      path: "/internal/v1/rbac/roles/role-sales/restore"
    });

    expect(listResponse.status).toBe(200);
    expect(listResponse.body).toMatchObject({
      roles: [
        {
          id: "role-sales"
        }
      ]
    });
    expect(createResponse.status).toBe(201);
    expect(createResponse.body).toMatchObject({
      role: {
        id: "role-created",
        name: "Sales"
      }
    });
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body).toMatchObject({
      role: {
        id: "role-sales",
        name: "Sales lead"
      }
    });
    expect(archiveResponse.status).toBe(200);
    expect(archiveResponse.body).toMatchObject({
      role: {
        status: "archived"
      }
    });
    expect(restoreResponse.status).toBe(200);
    expect(restoreResponse.body).toMatchObject({
      role: {
        status: "active"
      }
    });
    expect(listRoles).toHaveBeenCalledWith(rolesManageSession);
    expect(createRole).toHaveBeenCalledWith(rolesManageSession, {
      name: "Sales",
      description: "Sales role",
      permissions: ["conversation.read", "message.reply"]
    });
    expect(updateRole).toHaveBeenCalledWith(rolesManageSession, {
      roleId: "role-sales",
      request: {
        name: "Sales lead",
        permissions: ["conversation.read"]
      }
    });
    expect(archiveRole).toHaveBeenCalledWith(rolesManageSession, {
      roleId: "role-sales"
    });
    expect(restoreRole).toHaveBeenCalledWith(rolesManageSession, {
      roleId: "role-sales"
    });
  });

  it("manages role bindings and direct grants through roles.manage permission", async () => {
    const rolesManageSession = sessionWithPermissions(["roles.manage"]);
    const {
      handler,
      listRoleBindings,
      createRoleBinding,
      revokeRoleBinding,
      listDirectGrants,
      createDirectGrant,
      revokeDirectGrant
    } = createHandler({
      session: rolesManageSession
    });
    const bindingsResponse = await handler.handle({
      method: "GET",
      path: "/internal/v1/rbac/role-bindings"
    });
    const createBindingResponse = await handler.handle({
      method: "POST",
      path: "/internal/v1/rbac/role-bindings",
      body: {
        roleId: "role-sales",
        subject: {
          type: "employee",
          id: "employee-2"
        },
        scope: {
          type: "queue",
          id: "queue-sales"
        }
      }
    });
    const revokeBindingResponse = await handler.handle({
      method: "DELETE",
      path: "/internal/v1/rbac/role-bindings/binding-sales"
    });
    const grantsResponse = await handler.handle({
      method: "GET",
      path: "/internal/v1/rbac/direct-grants"
    });
    const createGrantResponse = await handler.handle({
      method: "POST",
      path: "/internal/v1/rbac/direct-grants",
      body: {
        employeeId: "employee-2",
        permission: "conversation.assign",
        scope: {
          type: "queue",
          id: "queue-sales"
        },
        reason: " temporary coverage "
      }
    });
    const revokeGrantResponse = await handler.handle({
      method: "DELETE",
      path: "/internal/v1/rbac/direct-grants/grant-sales"
    });

    expect(bindingsResponse.status).toBe(200);
    expect(bindingsResponse.body).toMatchObject({
      roleBindings: [
        {
          id: "binding-sales"
        }
      ]
    });
    expect(createBindingResponse.status).toBe(201);
    expect(createBindingResponse.body).toMatchObject({
      roleBinding: {
        roleId: "role-sales",
        scope: {
          type: "queue",
          id: "queue-sales"
        }
      }
    });
    expect(revokeBindingResponse.status).toBe(200);
    expect(revokeBindingResponse.body).toEqual({
      revoked: true
    });
    expect(grantsResponse.status).toBe(200);
    expect(grantsResponse.body).toMatchObject({
      directGrants: [
        {
          id: "grant-sales"
        }
      ]
    });
    expect(createGrantResponse.status).toBe(201);
    expect(createGrantResponse.body).toMatchObject({
      directGrant: {
        employeeId: "employee-2",
        reason: "temporary coverage"
      }
    });
    expect(revokeGrantResponse.status).toBe(200);
    expect(revokeGrantResponse.body).toEqual({
      revoked: true
    });
    expect(listRoleBindings).toHaveBeenCalledWith(rolesManageSession);
    expect(createRoleBinding).toHaveBeenCalledWith(rolesManageSession, {
      roleId: "role-sales",
      subject: {
        type: "employee",
        id: "employee-2"
      },
      scope: {
        type: "queue",
        id: "queue-sales"
      }
    });
    expect(revokeRoleBinding).toHaveBeenCalledWith(rolesManageSession, {
      bindingId: "binding-sales"
    });
    expect(listDirectGrants).toHaveBeenCalledWith(rolesManageSession);
    expect(createDirectGrant).toHaveBeenCalledWith(rolesManageSession, {
      employeeId: "employee-2",
      permission: "conversation.assign",
      scope: {
        type: "queue",
        id: "queue-sales"
      },
      reason: "temporary coverage"
    });
    expect(revokeDirectGrant).toHaveBeenCalledWith(rolesManageSession, {
      grantId: "grant-sales"
    });
  });

  it("requires a signed narrow roles.manage override for RBAC management routes", async () => {
    const { handler, listRoles, createRoleBinding, createDirectGrant } =
      createHandler({
        session: sessionWithPermissions(["roles.manage", "tenant.manage"])
      });
    const rolesResponse = await handler.handle({
      method: "GET",
      path: "/internal/v1/rbac/roles"
    });
    const bindingResponse = await handler.handle({
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
      }
    });
    const grantResponse = await handler.handle({
      method: "POST",
      path: "/internal/v1/rbac/direct-grants",
      body: {
        employeeId: "employee-2",
        permission: "conversation.read",
        scope: {
          type: "tenant"
        },
        reason: "temporary coverage"
      }
    });

    for (const response of [rolesResponse, bindingResponse, grantResponse]) {
      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({
        error: {
          code: "permission.denied"
        }
      });
    }
    expect(listRoles).not.toHaveBeenCalled();
    expect(createRoleBinding).not.toHaveBeenCalled();
    expect(createDirectGrant).not.toHaveBeenCalled();
  });

  it("rejects invalid RBAC payloads before service execution", async () => {
    const { handler, createRole, createDirectGrant } = createHandler({
      session: sessionWithPermissions(["roles.manage"])
    });
    const roleResponse = await handler.handle({
      method: "POST",
      path: "/internal/v1/rbac/roles",
      body: {
        name: "",
        permissions: ["conversation.read"]
      }
    });
    const grantResponse = await handler.handle({
      method: "POST",
      path: "/internal/v1/rbac/direct-grants",
      body: {
        employeeId: "employee-2",
        permission: "conversation.read",
        scope: {
          type: "queue"
        },
        reason: "temporary coverage"
      }
    });

    expect(roleResponse.status).toBe(400);
    expect(grantResponse.status).toBe(400);
    expect(createRole).not.toHaveBeenCalled();
    expect(createDirectGrant).not.toHaveBeenCalled();
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
    expect(loadTelegramIntegration).toHaveBeenCalledWith(modulesManageSession, {
      connectorId: undefined
    });
  });

  it("loads channel catalog and connector summaries through modules.manage permission", async () => {
    const modulesManageSession = sessionWithPermissions(["modules.manage"]);
    const { handler, listChannelCatalog, listChannelConnectors } =
      createHandler({
        session: modulesManageSession
      });

    const catalogResponse = await handler.handle({
      method: "GET",
      path: "/internal/v1/channels/catalog"
    });
    const connectorsResponse = await handler.handle({
      method: "GET",
      path: "/internal/v1/channels/connectors"
    });

    expect(catalogResponse.status).toBe(200);
    expect(catalogResponse.body).toMatchObject({
      channels: [
        {
          channelType: "telegram_bot",
          readiness: "available"
        }
      ]
    });
    expect(connectorsResponse.status).toBe(200);
    expect(connectorsResponse.body).toMatchObject({
      connectors: [
        {
          connectorId: "telegram_bot:tenant-1",
          channelType: "telegram_bot",
          status: "connected"
        }
      ]
    });
    expect(listChannelCatalog).toHaveBeenCalledWith(modulesManageSession);
    expect(listChannelConnectors).toHaveBeenCalledWith(modulesManageSession);
  });

  it("creates channel connectors through modules.manage permission", async () => {
    const modulesManageSession = sessionWithPermissions(["modules.manage"]);
    const { handler, createChannelConnector } = createHandler({
      session: modulesManageSession
    });

    const response = await handler.handle({
      method: "POST",
      path: "/internal/v1/channels/connectors",
      body: {
        channelType: "telegram_bot"
      }
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      connectorId: "telegram_bot:generated",
      channelType: "telegram_bot",
      status: "draft"
    });
    expect(createChannelConnector).toHaveBeenCalledWith(modulesManageSession, {
      channelType: "telegram_bot"
    });
  });

  it("updates channel connector lifecycle through modules.manage permission", async () => {
    const modulesManageSession = sessionWithPermissions(["modules.manage"]);
    const { handler, disableChannelConnector, deleteChannelConnector } =
      createHandler({
        session: modulesManageSession
      });

    const disableResponse = await handler.handle({
      method: "POST",
      path: "/internal/v1/channels/connectors/telegram_bot%3Atenant-1/disable"
    });
    const deleteResponse = await handler.handle({
      method: "DELETE",
      path: "/internal/v1/channels/connectors/telegram_bot%3Atenant-1"
    });

    expect(disableResponse.status).toBe(200);
    expect(disableResponse.body).toMatchObject({
      connectorId: "telegram_bot:tenant-1",
      status: "disabled"
    });
    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body).toMatchObject({
      connectorId: "telegram_bot:tenant-1",
      status: "deleted"
    });
    expect(disableChannelConnector).toHaveBeenCalledWith(modulesManageSession, {
      connectorId: "telegram_bot:tenant-1"
    });
    expect(deleteChannelConnector).toHaveBeenCalledWith(modulesManageSession, {
      connectorId: "telegram_bot:tenant-1"
    });
  });

  it("manages channel auth challenges through modules.manage permission", async () => {
    const modulesManageSession = sessionWithPermissions(["modules.manage"]);
    const {
      handler,
      startChannelAuthChallenge,
      loadChannelAuthChallenge,
      submitChannelAuthChallenge,
      cancelChannelAuthChallenge
    } = createHandler({
      session: modulesManageSession
    });
    const connectorPath = "telegram_qr_bridge%3Atenant-1";

    const startResponse = await handler.handle({
      method: "POST",
      path: `/internal/v1/channels/connectors/${connectorPath}/auth-challenges`,
      body: {
        challengeType: "phone_code",
        phoneNumber: "+79990000000"
      }
    });
    const viewResponse = await handler.handle({
      method: "GET",
      path: `/internal/v1/channels/connectors/${connectorPath}/auth-challenges/challenge-1`
    });
    const submitResponse = await handler.handle({
      method: "POST",
      path: `/internal/v1/channels/connectors/${connectorPath}/auth-challenges/challenge-1/submit`,
      body: {
        code: "12345"
      }
    });
    const cancelResponse = await handler.handle({
      method: "POST",
      path: `/internal/v1/channels/connectors/${connectorPath}/auth-challenges/challenge-1/cancel`
    });

    expect(startResponse.status).toBe(201);
    expect(startResponse.body).toMatchObject({
      challenge: {
        challengeType: "phone_code",
        status: "requires_code"
      }
    });
    expect(viewResponse.status).toBe(200);
    expect(submitResponse.body).toMatchObject({
      challenge: {
        status: "waiting"
      }
    });
    expect(cancelResponse.body).toMatchObject({
      challenge: {
        status: "cancelled"
      }
    });
    expect(startChannelAuthChallenge).toHaveBeenCalledWith(
      modulesManageSession,
      {
        connectorId: "telegram_qr_bridge:tenant-1",
        request: {
          challengeType: "phone_code",
          phoneNumber: "+79990000000"
        }
      }
    );
    expect(loadChannelAuthChallenge).toHaveBeenCalledWith(
      modulesManageSession,
      {
        connectorId: "telegram_qr_bridge:tenant-1",
        challengeId: "challenge-1"
      }
    );
    expect(submitChannelAuthChallenge).toHaveBeenCalledWith(
      modulesManageSession,
      {
        connectorId: "telegram_qr_bridge:tenant-1",
        challengeId: "challenge-1",
        request: {
          code: "12345"
        }
      }
    );
    expect(cancelChannelAuthChallenge).toHaveBeenCalledWith(
      modulesManageSession,
      {
        connectorId: "telegram_qr_bridge:tenant-1",
        challengeId: "challenge-1"
      }
    );
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
        connectorId: "telegram_bot:tenant-1",
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
        connectorId: "telegram_bot:tenant-1",
        enabled: true,
        channelExternalId: "telegram-local",
        mode: "webhook",
        botTokenSecretRef: "env:HULEE_TELEGRAM_BOT_TOKEN",
        outboundEnabled: true
      }
    );
  });

  it("passes selected connector id to Telegram admin commands", async () => {
    const modulesManageSession = sessionWithPermissions(["modules.manage"]);
    const {
      handler,
      loadTelegramIntegration,
      refreshTelegramDiagnostics,
      setTelegramWebhook,
      deleteTelegramWebhook
    } = createHandler({
      session: modulesManageSession
    });

    await handler.handle({
      method: "GET",
      path: "/internal/v1/integrations/telegram?connectorId=telegram_bot%3Asecond"
    });
    await handler.handle({
      method: "POST",
      path: "/internal/v1/integrations/telegram/diagnostics?connectorId=telegram_bot%3Asecond"
    });
    await handler.handle({
      method: "POST",
      path: "/internal/v1/integrations/telegram/webhook?connectorId=telegram_bot%3Asecond"
    });
    await handler.handle({
      method: "DELETE",
      path: "/internal/v1/integrations/telegram/webhook?connectorId=telegram_bot%3Asecond"
    });

    expect(loadTelegramIntegration).toHaveBeenCalledWith(modulesManageSession, {
      connectorId: "telegram_bot:second"
    });
    expect(refreshTelegramDiagnostics).toHaveBeenCalledWith(
      modulesManageSession,
      {
        connectorId: "telegram_bot:second"
      }
    );
    expect(setTelegramWebhook).toHaveBeenCalledWith(modulesManageSession, {
      connectorId: "telegram_bot:second"
    });
    expect(deleteTelegramWebhook).toHaveBeenCalledWith(modulesManageSession, {
      connectorId: "telegram_bot:second"
    });
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
      path: "/internal/v1/integrations/telegram/diagnostics?connectorId=telegram_bot%3Atenant-1"
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
      path: "/internal/v1/integrations/telegram/diagnostics?connectorId=telegram_bot%3Atenant-1"
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
      modulesManageSession,
      {
        connectorId: "telegram_bot:tenant-1"
      }
    );
  });

  it("rejects Telegram commands without selected connector id", async () => {
    const modulesManageSession = sessionWithPermissions(["modules.manage"]);
    const { handler, refreshTelegramDiagnostics } = createHandler({
      session: modulesManageSession
    });
    const response = await handler.handle({
      method: "POST",
      path: "/internal/v1/integrations/telegram/diagnostics"
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: {
        code: "validation.failed"
      }
    });
    expect(refreshTelegramDiagnostics).not.toHaveBeenCalled();
  });

  it("syncs Telegram webhook through modules.manage permission", async () => {
    const modulesManageSession = sessionWithPermissions(["modules.manage"]);
    const { handler, setTelegramWebhook, deleteTelegramWebhook } =
      createHandler({
        session: modulesManageSession
      });
    const setResponse = await handler.handle({
      method: "POST",
      path: "/internal/v1/integrations/telegram/webhook?connectorId=telegram_bot%3Atenant-1"
    });
    const deleteResponse = await handler.handle({
      method: "DELETE",
      path: "/internal/v1/integrations/telegram/webhook?connectorId=telegram_bot%3Atenant-1"
    });

    expect(setResponse.status).toBe(200);
    expect(deleteResponse.status).toBe(200);
    expect(setTelegramWebhook).toHaveBeenCalledWith(modulesManageSession, {
      connectorId: "telegram_bot:tenant-1"
    });
    expect(deleteTelegramWebhook).toHaveBeenCalledWith(modulesManageSession, {
      connectorId: "telegram_bot:tenant-1"
    });
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
