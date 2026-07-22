import type {
  EmployeeId,
  InternalAccessDecisionRequest,
  InternalAccessDecisionResponse,
  InternalOrgUnitUpsertRequest,
  InternalRbacDirectGrantCreateRequest,
  InternalRbacRoleBindingCreateRequest,
  InternalRbacRoleMutationRequest,
  InternalTenantBrandUpdateRequest,
  InternalTelegramIntegrationUpdateRequest,
  InternalWorkQueueUpsertRequest,
  TenantId
} from "@hulee/contracts";
import { inboxV2ClientMutationIdSchema } from "@hulee/contracts";
import {
  CoreError,
  createInternalApiSignature,
  internalApiSignatureHeader,
  internalApiTimestampHeader
} from "@hulee/core";
import { describe, expect, it, vi } from "vitest";

import { InboxV2FileDownloadTicketError } from "../inbox-v2-file-download-ticket";
import {
  createInternalApiHandler,
  createLocalDevInternalSessionResolver,
  createSignedInternalSessionResolver,
  type InternalApiHandlerOptions,
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
const tenantBrand = {
  id: "brand-1",
  scope: "tenant" as const,
  tenantId,
  productName: "Acme Desk",
  assets: {},
  themeTokens: {},
  links: {}
};

function createHandler(input?: {
  session?: InternalApiSession | null;
  fileDownloadsConfigured?: boolean;
  handlerOptions?: Pick<
    InternalApiHandlerOptions,
    "runtimeSchemaEvidence" | "buildRevision"
  >;
}) {
  const redeemFileDownload = vi.fn(async () => ({
    fileName: "exact-photo.jpg",
    mediaType: "image/jpeg",
    sizeBytes: 3,
    body: new Uint8Array([4, 5, 6])
  }));
  const issueFileDownload = vi.fn(async () => ({
    ticket: "opaque-signed-ticket",
    downloadUrl:
      "/internal/inbox-v2/files/download?ticket=opaque-signed-ticket",
    expiresAt: "2026-07-19T00:01:00.000Z"
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
  const loadEgressStatus = vi.fn(async () => ({
    profiles: [
      {
        profileId: "managed-messenger-vpn",
        profileKind: "vpn_namespace" as const,
        status: "ready" as const,
        source: "deployment_config" as const,
        checkedAt: "2026-06-29T10:00:00.000Z",
        supportedProviders: ["telegram", "whatsapp"]
      }
    ]
  }));
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
        visibility: "visible" as const,
        supportsMultiple: true,
        capabilities: ["inbound", "outbound", "webhook"],
        egressRequirement: {
          required: true,
          defaultProfileKind: "vpn_namespace" as const,
          allowedProfileKinds: [
            "vpn_namespace" as const,
            "http_proxy" as const,
            "socks_proxy" as const,
            "customer_network" as const
          ],
          enforcementScope: "hulee_managed_saas" as const
        },
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
  const listSourceConnections = vi.fn(async () => ({
    connections: [
      {
        sourceConnectionId: "source_connection:megapbx:1",
        sourceName: "megapbx",
        sourceType: "phone" as const,
        displayName: "MegaPBX",
        status: "onboarding" as const,
        authType: "webhook_secret" as const,
        webhookPath:
          "/webhooks/sources/megapbx/source_connection%3Amegapbx%3A1",
        webhookUrl:
          "https://chat.example.test/webhooks/sources/megapbx/source_connection%3Amegapbx%3A1",
        webhookSecretRef: "secret:tenant_1/source-megapbx/webhook-source-1",
        createdAt: "2026-07-09T10:00:00.000Z",
        updatedAt: "2026-07-09T10:00:00.000Z"
      }
    ]
  }));
  const createSourceConnection = vi.fn(async () => ({
    connection: {
      sourceConnectionId: "source_connection:megapbx:generated",
      sourceName: "megapbx",
      sourceType: "phone" as const,
      displayName: "MegaPBX",
      status: "onboarding" as const,
      authType: "webhook_secret" as const,
      webhookPath:
        "/webhooks/sources/megapbx/source_connection%3Amegapbx%3Agenerated",
      webhookUrl:
        "https://chat.example.test/webhooks/sources/megapbx/source_connection%3Amegapbx%3Agenerated",
      webhookSecretRef:
        "secret:tenant_1/source-megapbx/webhook-source-generated",
      createdAt: "2026-07-09T10:00:00.000Z",
      updatedAt: "2026-07-09T10:00:00.000Z"
    },
    command: {
      outcome: "applied" as const,
      commandId: "command:source-onboarding-generated",
      clientMutationId: inboxV2ClientMutationIdSchema.parse(
        "client-mutation:http-source-test"
      ),
      mutationId: "source-onboarding:mutation-generated",
      publicResultCode: "core:source-connection.created",
      streamCommitId: "commit:source-onboarding-generated",
      streamEpoch: "stream:source-onboarding-generated",
      streamPosition: "1",
      committedAt: "2026-07-09T10:00:00.000Z"
    },
    webhookToken: "source-webhook-token-generated"
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
  const updateChannelConnector = vi.fn(
    async (
      _context: unknown,
      input: { connectorId: string; request: { displayName?: string } }
    ) => ({
      connectorId: input.connectorId,
      channelType: "telegram_qr_bridge" as const,
      channelClass: "user_bridge" as const,
      provider: "telegram",
      displayName: input.request.displayName ?? "Telegram account",
      status: "connected" as const,
      healthStatus: "healthy" as const
    })
  );
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
  const enableChannelConnector = vi.fn(async () => ({
    connectorId: "telegram_bot:tenant-1",
    channelType: "telegram_bot" as const,
    channelClass: "bot_bridge" as const,
    provider: "telegram",
    displayName: "Telegram Bot",
    status: "connected" as const,
    healthStatus: "healthy" as const,
    channelExternalId: "telegram-local",
    diagnosticsStatus: "configured"
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
      egress: {
        required: true,
        status: "unknown" as const,
        profileKind: "vpn_namespace" as const,
        checkedAt: "2026-06-22T10:00:00.000Z"
      },
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
        egress: {
          required: true,
          status: "unknown" as const,
          profileKind: "vpn_namespace" as const,
          checkedAt: "2026-06-22T10:00:00.000Z"
        },
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
      egress: {
        required: true,
        status: "unknown" as const,
        profileKind: "vpn_namespace" as const,
        checkedAt: "2026-06-22T10:00:00.000Z"
      },
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
  const validateTelegramBotToken = vi.fn(async () => ({
    bot: {
      id: "100",
      username: "hulee_test_bot"
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
    brand: tenantBrand
  }));
  const updateTenantBrand = vi.fn(
    async (_context: unknown, request: InternalTenantBrandUpdateRequest) => ({
      brand: {
        ...tenantBrand,
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
    ...(input?.fileDownloadsConfigured === false
      ? {}
      : { fileDownloads: { issueFileDownload, redeemFileDownload } }),
    integrations: {
      listChannelCatalog,
      listChannelConnectors,
      listSourceConnections,
      createSourceConnection,
      createChannelConnector,
      updateChannelConnector,
      enableChannelConnector,
      disableChannelConnector,
      deleteChannelConnector,
      startChannelAuthChallenge,
      loadChannelAuthChallenge,
      submitChannelAuthChallenge,
      cancelChannelAuthChallenge,
      loadTelegramIntegration,
      validateTelegramBotToken,
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
    egressStatus: {
      loadEgressStatus
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
    },
    ...input?.handlerOptions
  });

  return {
    handler,
    issueFileDownload,
    redeemFileDownload,
    listChannelCatalog,
    listChannelConnectors,
    listSourceConnections,
    createSourceConnection,
    createChannelConnector,
    updateChannelConnector,
    enableChannelConnector,
    disableChannelConnector,
    deleteChannelConnector,
    startChannelAuthChallenge,
    loadChannelAuthChallenge,
    submitChannelAuthChallenge,
    cancelChannelAuthChallenge,
    loadTelegramIntegration,
    validateTelegramBotToken,
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
    loadEgressStatus,
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

  it("publishes verified schema epoch and build revision in runtime health", async () => {
    const { handler } = createHandler({
      session: null,
      handlerOptions: {
        runtimeSchemaEvidence: {
          epoch: "preproduction-inbox-v2-1",
          migrationCount: 1
        },
        buildRevision: "revision-clean-gate"
      }
    });
    const response = await handler.handle({
      method: "GET",
      path: "/internal/v1/health"
    });

    expect(response.body).toEqual({
      status: "ok",
      version: "v1",
      schemaEpoch: "preproduction-inbox-v2-1",
      migrationCount: 1,
      buildRevision: "revision-clean-gate"
    });
  });

  it("rejects internal routes without a session", async () => {
    const { handler } = createHandler({ session: null });
    const response = await handler.handle({
      method: "GET",
      path: "/internal/v1/tenant/brand"
    });

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      error: {
        code: "auth.invalid_credentials",
        requestId: "request-1"
      }
    });
  });

  it("redeems an opaque Inbox V2 ticket as the authenticated session and returns a no-store stream", async () => {
    const scopedSession: InternalApiSession = {
      ...session,
      permissions: []
    };
    const { handler, redeemFileDownload } = createHandler({
      session: scopedSession
    });
    const response = await handler.handle({
      method: "GET",
      path: "/internal/inbox-v2/files/download?ticket=opaque-ticket&tenantId=tenant-2&principalId=employee-2&authorizationEpoch=forged"
    });

    expect(response.status).toBe(200);
    expect(response.headers).toEqual({
      "content-type": "image/jpeg",
      "content-length": "3",
      "content-disposition":
        "attachment; filename=\"exact-photo.jpg\"; filename*=UTF-8''exact-photo.jpg",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff"
    });
    expect(response.body).toEqual(new Uint8Array([4, 5, 6]));
    expect(redeemFileDownload).toHaveBeenCalledWith(scopedSession, {
      ticket: "opaque-ticket"
    });
  });

  it.each([
    ["text/html", "payload.html"],
    ["image/svg+xml", "payload.svg"]
  ])(
    "forces untrusted %s content to download as an attachment",
    async (mediaType, fileName) => {
      const { handler, redeemFileDownload } = createHandler();
      redeemFileDownload.mockResolvedValueOnce({
        fileName,
        mediaType,
        sizeBytes: 3,
        body: new Uint8Array([1, 2, 3])
      });

      const response = await handler.handle({
        method: "GET",
        path: "/internal/inbox-v2/files/download?ticket=opaque-ticket"
      });

      expect(response.status).toBe(200);
      expect(response.headers).toMatchObject({
        "content-type": mediaType,
        "content-disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${fileName}`,
        "x-content-type-options": "nosniff"
      });
    }
  );

  it("issues an Inbox V2 download ticket from session identity without caller authority fields", async () => {
    const { handler, issueFileDownload } = createHandler();
    const request = {
      pin: {
        tenantId,
        fileId: "file-1",
        fileRevision: "3",
        fileVersionId: "file-version-1",
        objectVersionId: "object-version-1"
      },
      parentLinkId: "parent-link-1"
    };

    const response = await handler.handle({
      method: "POST",
      path: "/internal/inbox-v2/files/download-tickets",
      body: request
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      ticket: "opaque-signed-ticket",
      downloadUrl:
        "/internal/inbox-v2/files/download?ticket=opaque-signed-ticket",
      expiresAt: "2026-07-19T00:01:00.000Z"
    });
    expect(issueFileDownload).toHaveBeenCalledWith(session, request);
  });

  it("rejects caller-supplied principal or authorization epoch during ticket issuance", async () => {
    const { handler, issueFileDownload } = createHandler();
    const response = await handler.handle({
      method: "POST",
      path: "/internal/inbox-v2/files/download-tickets",
      body: {
        pin: {
          tenantId,
          fileId: "file-1",
          fileRevision: "3",
          fileVersionId: "file-version-1",
          objectVersionId: "object-version-1"
        },
        parentLinkId: "parent-link-1",
        principalId: "employee-2",
        authorizationEpoch: "forged"
      }
    });

    expect(response.status).toBe(400);
    expect(issueFileDownload).not.toHaveBeenCalled();
  });

  it("does not redeem Inbox V2 downloads without a session or a non-empty ticket", async () => {
    const unauthenticated = createHandler({ session: null });
    const unauthenticatedResponse = await unauthenticated.handler.handle({
      method: "GET",
      path: "/internal/inbox-v2/files/download?ticket=opaque-ticket"
    });
    const missingTicket = createHandler();
    const missingTicketResponse = await missingTicket.handler.handle({
      method: "GET",
      path: "/internal/inbox-v2/files/download?ticket=%20%20"
    });

    expect(unauthenticatedResponse.status).toBe(401);
    expect(missingTicketResponse.status).toBe(404);
    expect(unauthenticated.redeemFileDownload).not.toHaveBeenCalled();
    expect(missingTicket.redeemFileDownload).not.toHaveBeenCalled();
  });

  it("does not disclose why an Inbox V2 download ticket was rejected", async () => {
    const { handler, redeemFileDownload } = createHandler();
    redeemFileDownload.mockRejectedValueOnce(
      new InboxV2FileDownloadTicketError("ticket_principal_mismatch")
    );

    const response = await handler.handle({
      method: "GET",
      path: "/internal/inbox-v2/files/download?ticket=opaque-ticket"
    });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      error: { code: "permission.denied" }
    });
  });

  it("fails closed when runtime composition has no download authority service", async () => {
    const { handler, issueFileDownload, redeemFileDownload } = createHandler({
      fileDownloadsConfigured: false
    });

    const issueResponse = await handler.handle({
      method: "POST",
      path: "/internal/inbox-v2/files/download-tickets",
      body: {
        pin: {
          tenantId,
          fileId: "file-1",
          fileRevision: "3",
          fileVersionId: "file-version-1",
          objectVersionId: "object-version-1"
        },
        parentLinkId: "parent-link-1"
      }
    });
    const redeemResponse = await handler.handle({
      method: "GET",
      path: "/internal/inbox-v2/files/download?ticket=opaque-ticket"
    });

    expect(issueResponse.status).toBe(400);
    expect(redeemResponse.status).toBe(400);
    expect(issueFileDownload).not.toHaveBeenCalled();
    expect(redeemFileDownload).not.toHaveBeenCalled();
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
      brand: tenantBrand
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

  it("delegates org structure authorization to the service", async () => {
    const orgStructureSession = sessionWithPermissions([]);
    const { handler, loadOrgStructure, upsertOrgUnit, upsertWorkQueue } =
      createHandler({
        session: orgStructureSession
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
    expect(loadOrgStructure).toHaveBeenCalledWith(orgStructureSession);
    expect(upsertOrgUnit).toHaveBeenCalledWith(orgStructureSession, {
      name: "Sales",
      kind: "department",
      status: "active"
    });
    expect(upsertWorkQueue).toHaveBeenCalledWith(orgStructureSession, {
      name: "Claims",
      kind: "claims",
      owningOrgUnitId: "org-sales",
      status: "active",
      routingConfig: {}
    });
  });

  it("does not enforce permission headers for org structure routes", async () => {
    const { handler, loadOrgStructure } = createHandler({
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

    expect(response.status).toBe(200);
    expect(loadOrgStructure).toHaveBeenCalledOnce();
  });

  it("delegates access-decision authorization to the DB-backed service", async () => {
    const rolesManageSession = sessionWithPermissions([]);
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

  it("does not let coarse signed permissions bypass an access-decision service denial", async () => {
    const { handler, inspectAccessDecision } = createHandler({
      session: sessionWithPermissions(["roles.manage", "tenant.manage"])
    });
    inspectAccessDecision.mockRejectedValueOnce(
      new CoreError("permission.denied")
    );
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
    expect(inspectAccessDecision).toHaveBeenCalledOnce();
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

  it("delegates RBAC role authorization to the DB-backed service", async () => {
    const rolesManageSession = sessionWithPermissions([]);
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

  it("delegates scoped bindings and grants to the DB-backed RBAC service", async () => {
    const rolesManageSession = sessionWithPermissions([]);
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

  it("does not let coarse signed permissions bypass RBAC service denials", async () => {
    const { handler, listRoles, createRoleBinding, createDirectGrant } =
      createHandler({
        session: sessionWithPermissions(["roles.manage", "tenant.manage"])
      });
    listRoles.mockRejectedValueOnce(new CoreError("permission.denied"));
    createRoleBinding.mockRejectedValueOnce(new CoreError("permission.denied"));
    createDirectGrant.mockRejectedValueOnce(new CoreError("permission.denied"));
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
    expect(listRoles).toHaveBeenCalledOnce();
    expect(createRoleBinding).toHaveBeenCalledOnce();
    expect(createDirectGrant).toHaveBeenCalledOnce();
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

  it("loads Telegram integration config through modules.manage permission", async () => {
    const modulesManageSession = sessionWithPermissions(["modules.manage"]);
    const { handler, loadTelegramIntegration } = createHandler({
      session: modulesManageSession
    });
    const response = await handler.handle({
      method: "GET",
      path: "/internal/v1/channels/connectors/telegram_bot%3Atenant-1/telegram"
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      moduleId: "channel-telegram",
      enabled: true,
      webhookPath: "/webhooks/telegram/telegram-local"
    });
    expect(loadTelegramIntegration).toHaveBeenCalledWith(modulesManageSession, {
      connectorId: "telegram_bot:tenant-1"
    });
  });

  it("loads channel catalog and connector summaries through modules.manage permission", async () => {
    const modulesManageSession = sessionWithPermissions(["modules.manage"]);
    const {
      handler,
      listChannelCatalog,
      listChannelConnectors,
      listSourceConnections,
      createSourceConnection
    } = createHandler({
      session: modulesManageSession
    });

    const catalogResponse = await handler.handle({
      method: "GET",
      path: "/internal/v1/channels/catalog"
    });
    const sourceCatalogResponse = await handler.handle({
      method: "GET",
      path: "/internal/v1/sources/catalog"
    });
    const sourceConnectionsResponse = await handler.handle({
      method: "GET",
      path: "/internal/v1/sources/connections"
    });
    const sourceConnectionCreateResponse = await handler.handle({
      method: "POST",
      path: "/internal/v1/sources/connections",
      body: {
        clientMutationId: inboxV2ClientMutationIdSchema.parse(
          "client-mutation:http-source-test"
        ),
        sourceName: "megapbx",
        displayName: "MegaPBX"
      }
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
    expect(sourceCatalogResponse.status).toBe(200);
    expect(sourceCatalogResponse.body).toMatchObject({
      categories: expect.arrayContaining([
        expect.objectContaining({
          category: "messengers"
        })
      ]),
      sources: expect.arrayContaining([
        expect.objectContaining({
          sourceName: "megapbx",
          sourceType: "phone",
          readiness: "coming_soon"
        }),
        expect.objectContaining({
          sourceName: "ozon",
          sourceType: "marketplace",
          readiness: "coming_soon"
        })
      ])
    });
    expect(sourceConnectionsResponse.status).toBe(200);
    expect(sourceConnectionsResponse.body).toMatchObject({
      connections: [
        {
          sourceConnectionId: "source_connection:megapbx:1",
          sourceName: "megapbx",
          sourceType: "phone",
          status: "onboarding"
        }
      ]
    });
    expect(sourceConnectionCreateResponse.status).toBe(201);
    expect(sourceConnectionCreateResponse.body).toMatchObject({
      connection: {
        sourceConnectionId: "source_connection:megapbx:generated",
        sourceName: "megapbx"
      },
      command: {
        outcome: "applied",
        clientMutationId: "client-mutation:http-source-test",
        streamCommitId: "commit:source-onboarding-generated"
      },
      webhookToken: "source-webhook-token-generated"
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
    expect(listSourceConnections).toHaveBeenCalledWith(modulesManageSession);
    expect(createSourceConnection).toHaveBeenCalledWith(modulesManageSession, {
      clientMutationId: "client-mutation:http-source-test",
      sourceName: "megapbx",
      displayName: "MegaPBX"
    });
  });

  it("returns a stable conflict for a reused source-onboarding mutation with a different request", async () => {
    const modulesManageSession = sessionWithPermissions(["modules.manage"]);
    const { handler, createSourceConnection } = createHandler({
      session: modulesManageSession
    });
    createSourceConnection.mockRejectedValueOnce(
      new CoreError("command.idempotency_conflict")
    );

    const response = await handler.handle({
      method: "POST",
      path: "/internal/v1/sources/connections",
      body: {
        clientMutationId: "client-mutation:http-source-conflict",
        sourceName: "megapbx",
        displayName: "Different request"
      }
    });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      error: {
        code: "command.idempotency_conflict",
        retryability: "not_retryable"
      }
    });
  });

  it("loads egress status through modules.manage permission", async () => {
    const modulesManageSession = sessionWithPermissions(["modules.manage"]);
    const { handler, loadEgressStatus } = createHandler({
      session: modulesManageSession
    });

    const response = await handler.handle({
      method: "GET",
      path: "/internal/v1/egress/status"
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      profiles: [
        {
          profileId: "managed-messenger-vpn",
          profileKind: "vpn_namespace",
          status: "ready",
          source: "deployment_config",
          checkedAt: "2026-06-29T10:00:00.000Z",
          supportedProviders: ["telegram", "whatsapp"]
        }
      ]
    });
    expect(loadEgressStatus).toHaveBeenCalledWith(modulesManageSession);
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

  it("updates channel connector settings through modules.manage permission", async () => {
    const modulesManageSession = sessionWithPermissions(["modules.manage"]);
    const { handler, updateChannelConnector } = createHandler({
      session: modulesManageSession
    });

    const response = await handler.handle({
      method: "PATCH",
      path: "/internal/v1/channels/connectors/telegram_qr_bridge%3Atenant-1",
      body: {
        displayName: "Sales Telegram"
      }
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      connectorId: "telegram_qr_bridge:tenant-1",
      displayName: "Sales Telegram"
    });
    expect(updateChannelConnector).toHaveBeenCalledWith(modulesManageSession, {
      connectorId: "telegram_qr_bridge:tenant-1",
      request: {
        displayName: "Sales Telegram"
      }
    });
  });

  it("updates channel connector lifecycle through modules.manage permission", async () => {
    const modulesManageSession = sessionWithPermissions(["modules.manage"]);
    const {
      handler,
      enableChannelConnector,
      disableChannelConnector,
      deleteChannelConnector
    } = createHandler({
      session: modulesManageSession
    });

    const enableResponse = await handler.handle({
      method: "POST",
      path: "/internal/v1/channels/connectors/telegram_bot%3Atenant-1/enable"
    });
    const disableResponse = await handler.handle({
      method: "POST",
      path: "/internal/v1/channels/connectors/telegram_bot%3Atenant-1/disable"
    });
    const deleteResponse = await handler.handle({
      method: "DELETE",
      path: "/internal/v1/channels/connectors/telegram_bot%3Atenant-1"
    });

    expect(enableResponse.status).toBe(200);
    expect(disableResponse.status).toBe(200);
    expect(enableResponse.body).toMatchObject({
      connectorId: "telegram_bot:tenant-1",
      status: "connected"
    });
    expect(disableResponse.body).toMatchObject({
      connectorId: "telegram_bot:tenant-1",
      status: "disabled"
    });
    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body).toMatchObject({
      connectorId: "telegram_bot:tenant-1",
      status: "deleted"
    });
    expect(enableChannelConnector).toHaveBeenCalledWith(modulesManageSession, {
      connectorId: "telegram_bot:tenant-1"
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
        challengeId: "challenge-1",
        request: {}
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
      path: "/internal/v1/channels/connectors/telegram_bot%3Atenant-1/telegram",
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

  it("validates Telegram bot tokens before connector creation", async () => {
    const modulesManageSession = sessionWithPermissions(["modules.manage"]);
    const { handler, validateTelegramBotToken } = createHandler({
      session: modulesManageSession
    });
    const response = await handler.handle({
      method: "POST",
      path: "/internal/v1/channels/telegram-bot/token/validate",
      body: {
        botToken: "123456789:AAExampleTokenValue_000000000000000000"
      }
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      bot: {
        id: "100",
        username: "hulee_test_bot"
      }
    });
    expect(validateTelegramBotToken).toHaveBeenCalledWith(
      modulesManageSession,
      {
        botToken: "123456789:AAExampleTokenValue_000000000000000000"
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
      path: "/internal/v1/channels/connectors/telegram_bot%3Asecond/telegram"
    });
    await handler.handle({
      method: "POST",
      path: "/internal/v1/channels/connectors/telegram_bot%3Asecond/telegram/diagnostics"
    });
    await handler.handle({
      method: "POST",
      path: "/internal/v1/channels/connectors/telegram_bot%3Asecond/telegram/webhook"
    });
    await handler.handle({
      method: "DELETE",
      path: "/internal/v1/channels/connectors/telegram_bot%3Asecond/telegram/webhook"
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
      path: "/internal/v1/channels/connectors/telegram_bot%3Atenant-1/telegram"
    });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      error: {
        code: "permission.denied"
      }
    });
  });

  it("requires narrow modules.manage override for egress status", async () => {
    const { handler, loadEgressStatus } = createHandler({
      session: sessionWithPermissions(["modules.manage", "tenant.manage"])
    });
    const response = await handler.handle({
      method: "GET",
      path: "/internal/v1/egress/status"
    });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      error: {
        code: "permission.denied"
      }
    });
    expect(loadEgressStatus).not.toHaveBeenCalled();
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
      path: "/internal/v1/channels/connectors/telegram_bot%3Atenant-1/telegram"
    });
    const updateResponse = await handler.handle({
      method: "PUT",
      path: "/internal/v1/channels/connectors/telegram_bot%3Atenant-1/telegram",
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
      path: "/internal/v1/channels/connectors/telegram_bot%3Atenant-1/telegram/diagnostics"
    });
    const setWebhookResponse = await handler.handle({
      method: "POST",
      path: "/internal/v1/channels/connectors/telegram_bot%3Atenant-1/telegram/webhook"
    });
    const deleteWebhookResponse = await handler.handle({
      method: "DELETE",
      path: "/internal/v1/channels/connectors/telegram_bot%3Atenant-1/telegram/webhook"
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
        path: "/internal/v1/channels/connectors/telegram_bot%3Atenant-1/telegram",
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
      path: "/internal/v1/channels/connectors/telegram_bot%3Atenant-1/telegram"
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
      path: "/internal/v1/channels/connectors/telegram_bot%3Atenant-1/telegram",
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
          path: "/internal/v1/channels/connectors/telegram_bot%3Atenant-1/telegram",
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
      path: "/internal/v1/access/decision",
      headers: {
        "x-hulee-tenant-id": tenantId,
        "x-hulee-employee-id": employeeId,
        "x-hulee-permissions": "roles.manage",
        [internalApiTimestampHeader]: "2026-06-23T10:00:00.000Z"
      },
      body: {
        employeeId: "employee-2",
        permission: "conversation.read",
        resource: { tenantId }
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
            permissions: ["roles.manage"],
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
      permissions: ["roles.manage"],
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
      employeeId: "employee-2",
      permission: "conversation.read",
      resource: { tenantId }
    };
    const signature = createInternalApiSignature("internal-secret", {
      method: "POST",
      path: "/internal/v1/access/decision",
      body,
      tenantId,
      employeeId,
      permissions: ["roles.manage"],
      timestamp
    });

    await expect(
      resolver.resolve(
        {
          method: "POST",
          path: "/internal/v1/access/decision",
          headers: {
            "x-hulee-tenant-id": tenantId,
            "x-hulee-employee-id": employeeId,
            "x-hulee-permissions": "roles.manage",
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
          path: "/internal/v1/access/decision",
          headers: {
            "x-hulee-tenant-id": tenantId,
            "x-hulee-employee-id": employeeId,
            "x-hulee-permissions": "roles.manage",
            [internalApiTimestampHeader]: timestamp,
            [internalApiSignatureHeader]: signature
          },
          body: {
            ...body,
            employeeId: "employee-3"
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
      path: "/internal/v1/channels/connectors/telegram_bot%3Atenant-1/telegram",
      body: {
        enabled: true,
        channelExternalId: "",
        outboundEnabled: false
      }
    });

    expect(response.status).toBe(400);
    expect(updateTelegramIntegration).not.toHaveBeenCalled();
  });

  it("rejects Telegram updates when route and body connector ids differ", async () => {
    const { handler, updateTelegramIntegration } = createHandler({
      session: sessionWithPermissions(["modules.manage"])
    });
    const response = await handler.handle({
      method: "PUT",
      path: "/internal/v1/channels/connectors/telegram_bot%3Atenant-1/telegram",
      body: {
        connectorId: "telegram_bot:second",
        enabled: true,
        channelExternalId: "telegram-local",
        mode: "webhook",
        outboundEnabled: false
      }
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: {
        code: "validation.failed"
      }
    });
    expect(updateTelegramIntegration).not.toHaveBeenCalled();
  });

  it("refreshes Telegram diagnostics through modules.manage permission", async () => {
    const modulesManageSession = sessionWithPermissions(["modules.manage"]);
    const { handler, refreshTelegramDiagnostics } = createHandler({
      session: modulesManageSession
    });
    const response = await handler.handle({
      method: "POST",
      path: "/internal/v1/channels/connectors/telegram_bot%3Atenant-1/telegram/diagnostics"
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

  it("rejects removed legacy Telegram routes", async () => {
    const modulesManageSession = sessionWithPermissions(["modules.manage"]);
    const { handler, refreshTelegramDiagnostics } = createHandler({
      session: modulesManageSession
    });
    const response = await handler.handle({
      method: "POST",
      path: "/internal/v1/integrations/telegram/diagnostics"
    });

    expect(response.status).toBe(404);
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
      path: "/internal/v1/channels/connectors/telegram_bot%3Atenant-1/telegram/webhook"
    });
    const deleteResponse = await handler.handle({
      method: "DELETE",
      path: "/internal/v1/channels/connectors/telegram_bot%3Atenant-1/telegram/webhook"
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
