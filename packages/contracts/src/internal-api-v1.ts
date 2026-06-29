import { z } from "zod";

import type { PlatformErrorCode } from "./index";

export const internalApiV1Version = "v1";

export const internalApiPlatformErrorCodeSchema = z.enum([
  "auth.invalid_credentials",
  "auth.email_not_verified",
  "auth.rate_limited",
  "entitlement.missing",
  "license.inactive",
  "permission.denied",
  "tenant.not_found",
  "tenant.boundary_violation",
  "module.disabled",
  "module.unhealthy",
  "usage.limit_exceeded",
  "provider.temporary_failure",
  "provider.permanent_failure",
  "validation.failed"
] satisfies [PlatformErrorCode, ...PlatformErrorCode[]]);

export const internalInboxLocaleSchema = z.enum(["ru", "en"]);
export const internalInboxDeploymentTypeSchema = z.enum([
  "saas_shared",
  "saas_isolated",
  "on_prem"
]);

export const internalInboxBrandProfileSchema = z
  .object({
    id: z.string().trim().min(1),
    scope: z.enum(["platform", "tenant", "deployment"]),
    tenantId: z.string().trim().min(1).optional(),
    productName: z.string().trim().min(1),
    shortProductName: z.string().trim().min(1).optional(),
    companyName: z.string().trim().min(1).optional(),
    assets: z.record(z.string(), z.string()).default({}),
    themeTokens: z.record(z.string(), z.string()).default({}),
    links: z.record(z.string(), z.string()).default({})
  })
  .strict();

export const internalInboxTenantContextSchema = z
  .object({
    tenantId: z.string().trim().min(1),
    displayName: z.string().trim().min(1),
    deploymentType: internalInboxDeploymentTypeSchema,
    locale: internalInboxLocaleSchema,
    timezone: z.string().trim().min(1),
    brand: internalInboxBrandProfileSchema
  })
  .strict();

export const internalInboxConversationSchema = z
  .object({
    id: z.string().trim().min(1),
    clientId: z.string().trim().min(1),
    clientDisplayName: z.string().trim().min(1),
    status: z.string().trim().min(1),
    source: z.string().trim().min(1),
    currentQueueId: z.string().trim().min(1).optional(),
    currentQueueName: z.string().trim().min(1).optional(),
    currentQueueOwningOrgUnitId: z.string().trim().min(1).optional(),
    assignedEmployeeId: z.string().trim().min(1).optional(),
    assignedEmployeeDisplayName: z.string().trim().min(1).optional(),
    assignedTeamId: z.string().trim().min(1).optional(),
    assignedTeamName: z.string().trim().min(1).optional(),
    messageCount: z.number().int().nonnegative(),
    queuedCount: z.number().int().nonnegative(),
    lastMessageText: z.string().optional(),
    lastMessageAt: z.string().datetime({ offset: true }).optional()
  })
  .strict();

export const internalInboxMessageSchema = z
  .object({
    id: z.string().trim().min(1),
    conversationId: z.string().trim().min(1),
    direction: z.enum(["inbound", "outbound"]),
    text: z.string().optional(),
    status: z.enum(["received", "queued", "sent", "failed"]),
    createdAt: z.string().datetime({ offset: true })
  })
  .strict();

export const internalInboxViewResponseSchema = z
  .object({
    tenant: internalInboxTenantContextSchema,
    conversations: z.array(internalInboxConversationSchema),
    selectedConversation: internalInboxConversationSchema.optional(),
    messages: z.array(internalInboxMessageSchema)
  })
  .strict();

export const internalInboxReplyRequestSchema = z
  .object({
    text: z.string().trim().min(1).max(20_000),
    idempotencyKey: z.string().trim().min(1).max(300).optional()
  })
  .strict();

export const internalInboxReplyResponseSchema = z
  .object({
    messageId: z.string().trim().min(1),
    status: z.literal("queued"),
    idempotencyKey: z.string().trim().min(1)
  })
  .strict();

export const internalInboxConversationRoutingUpdateRequestSchema = z
  .object({
    currentQueueId: z.string().trim().min(1).max(200).nullable().optional(),
    assignedEmployeeId: z.string().trim().min(1).max(200).nullable().optional(),
    assignedTeamId: z.string().trim().min(1).max(200).nullable().optional()
  })
  .strict()
  .refine(
    (request) => Object.values(request).some((value) => value !== undefined),
    {
      message: "At least one routing field is required."
    }
  );

export const internalInboxConversationRoutingUpdateResponseSchema = z
  .object({
    conversationId: z.string().trim().min(1),
    currentQueueId: z.string().trim().min(1).optional(),
    assignedEmployeeId: z.string().trim().min(1).optional(),
    assignedTeamId: z.string().trim().min(1).optional()
  })
  .strict();

export const internalTenantBrandUpdateRequestSchema = z
  .object({
    productName: z.string().trim().min(1).max(120),
    shortProductName: z.string().trim().min(1).max(40).optional(),
    themeTokens: z.record(z.string(), z.string()).default({})
  })
  .strict();

export const internalTenantBrandResponseSchema = z
  .object({
    brand: internalInboxBrandProfileSchema
  })
  .strict();

export const internalOrgStructureStatusSchema = z.enum(["active", "archived"]);
export const internalOrgUnitKindSchema = z.enum([
  "department",
  "branch",
  "function",
  "custom"
]);
export const internalWorkQueueKindSchema = z.enum([
  "lead_intake",
  "sales",
  "claims",
  "measurements",
  "support",
  "custom"
]);

export const internalOrgUnitSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    parentOrgUnitId: z.string().trim().min(1).max(200).nullable(),
    name: z.string().trim().min(1).max(120),
    kind: internalOrgUnitKindSchema,
    status: internalOrgStructureStatusSchema
  })
  .strict();

export const internalWorkQueueSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(120),
    kind: internalWorkQueueKindSchema,
    owningOrgUnitId: z.string().trim().min(1).max(200).nullable(),
    status: internalOrgStructureStatusSchema,
    routingConfig: z.record(z.string(), z.unknown()).default({})
  })
  .strict();

export const internalOrgStructureResponseSchema = z
  .object({
    orgUnits: z.array(internalOrgUnitSchema),
    workQueues: z.array(internalWorkQueueSchema)
  })
  .strict();

export const internalOrgUnitUpsertRequestSchema = z
  .object({
    id: z.string().trim().min(1).max(200).optional(),
    parentOrgUnitId: z.string().trim().min(1).max(200).nullable().optional(),
    name: z.string().trim().min(1).max(120),
    kind: internalOrgUnitKindSchema.default("department"),
    status: internalOrgStructureStatusSchema.default("active")
  })
  .strict();

export const internalWorkQueueUpsertRequestSchema = z
  .object({
    id: z.string().trim().min(1).max(200).optional(),
    name: z.string().trim().min(1).max(120),
    kind: internalWorkQueueKindSchema.default("custom"),
    owningOrgUnitId: z.string().trim().min(1).max(200).nullable().optional(),
    status: internalOrgStructureStatusSchema.default("active"),
    routingConfig: z.record(z.string(), z.unknown()).default({})
  })
  .strict();

const internalAccessDecisionIdSchema = z.string().trim().min(1).max(200);
const internalAccessDecisionPermissionSchema = z
  .string()
  .trim()
  .min(1)
  .max(200);
const internalAccessDecisionResourceIdListSchema = z
  .array(internalAccessDecisionIdSchema)
  .max(100);

export const internalAccessDecisionResourceContextSchema = z
  .object({
    orgUnitId: internalAccessDecisionIdSchema.optional(),
    orgUnitIds: internalAccessDecisionResourceIdListSchema.optional(),
    teamId: internalAccessDecisionIdSchema.optional(),
    teamIds: internalAccessDecisionResourceIdListSchema.optional(),
    queueId: internalAccessDecisionIdSchema.optional(),
    assignedEmployeeId: internalAccessDecisionIdSchema.optional(),
    assignedEmployeeIds: internalAccessDecisionResourceIdListSchema.optional(),
    assignedTeamIds: internalAccessDecisionResourceIdListSchema.optional(),
    ownerEmployeeId: internalAccessDecisionIdSchema.optional(),
    clientId: internalAccessDecisionIdSchema.optional(),
    conversationId: internalAccessDecisionIdSchema.optional()
  })
  .strict();

export const internalAccessDecisionRequestSchema = z
  .object({
    employeeId: internalAccessDecisionIdSchema,
    permission: internalAccessDecisionPermissionSchema,
    resource: internalAccessDecisionResourceContextSchema.default({}),
    at: z.string().datetime({ offset: true }).optional()
  })
  .strict();

export const internalAccessDecisionReasonSchema = z.enum([
  "allowed",
  "missing_permission",
  "scope_mismatch"
]);

export const internalAccessDecisionScopeSchema = z.union([
  z.object({ type: z.literal("tenant") }).strict(),
  z.object({ type: z.literal("assigned") }).strict(),
  z.object({ type: z.literal("own") }).strict(),
  z
    .object({
      type: z.literal("org_unit"),
      id: internalAccessDecisionIdSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("team"),
      id: internalAccessDecisionIdSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("queue"),
      id: internalAccessDecisionIdSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("client"),
      id: internalAccessDecisionIdSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("conversation"),
      id: internalAccessDecisionIdSchema
    })
    .strict()
]);

export const internalAccessDecisionGrantSourceSchema = z.union([
  z
    .object({
      type: z.literal("role_binding"),
      roleId: internalAccessDecisionIdSchema,
      bindingId: internalAccessDecisionIdSchema.optional()
    })
    .strict(),
  z
    .object({
      type: z.literal("direct_grant"),
      grantId: internalAccessDecisionIdSchema.optional(),
      reason: z.string().trim().min(1).max(1000)
    })
    .strict()
]);

export const internalAccessDecisionGrantSchema = z
  .object({
    permission: internalAccessDecisionPermissionSchema,
    scope: internalAccessDecisionScopeSchema,
    sources: z.array(internalAccessDecisionGrantSourceSchema).min(1)
  })
  .strict();

export const internalAccessDecisionResponseSchema = z
  .object({
    employeeId: internalAccessDecisionIdSchema,
    permission: internalAccessDecisionPermissionSchema,
    resource: internalAccessDecisionResourceContextSchema,
    evaluatedAt: z.string().datetime({ offset: true }),
    decision: z
      .object({
        allowed: z.boolean(),
        reason: internalAccessDecisionReasonSchema,
        matchedGrant: internalAccessDecisionGrantSchema.optional()
      })
      .strict(),
    candidateGrants: z.array(internalAccessDecisionGrantSchema),
    effectiveGrantCount: z.number().int().nonnegative()
  })
  .strict();

export const internalRbacRoleStatusSchema = z.enum(["active", "archived"]);

export const internalRbacRoleSchema = z
  .object({
    id: internalAccessDecisionIdSchema,
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(500).nullable(),
    status: internalRbacRoleStatusSchema,
    isSystem: z.boolean(),
    permissions: z.array(internalAccessDecisionPermissionSchema),
    createdByEmployeeId: internalAccessDecisionIdSchema.nullable(),
    archivedAt: z.string().datetime({ offset: true }).optional()
  })
  .strict();

export const internalRbacRoleSubjectSchema = z.union([
  z
    .object({
      type: z.literal("employee"),
      id: internalAccessDecisionIdSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("team"),
      id: internalAccessDecisionIdSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("org_unit"),
      id: internalAccessDecisionIdSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("queue"),
      id: internalAccessDecisionIdSchema
    })
    .strict()
]);

export const internalRbacRoleBindingSchema = z
  .object({
    id: internalAccessDecisionIdSchema,
    roleId: internalAccessDecisionIdSchema,
    subject: internalRbacRoleSubjectSchema,
    scope: internalAccessDecisionScopeSchema,
    startsAt: z.string().datetime({ offset: true }).optional(),
    expiresAt: z.string().datetime({ offset: true }).optional(),
    revokedAt: z.string().datetime({ offset: true }).optional()
  })
  .strict();

export const internalRbacDirectGrantSchema = z
  .object({
    id: internalAccessDecisionIdSchema,
    employeeId: internalAccessDecisionIdSchema,
    permission: internalAccessDecisionPermissionSchema,
    scope: internalAccessDecisionScopeSchema,
    reason: z.string().trim().min(1).max(500),
    startsAt: z.string().datetime({ offset: true }).optional(),
    expiresAt: z.string().datetime({ offset: true }).optional(),
    revokedAt: z.string().datetime({ offset: true }).optional()
  })
  .strict();

export const internalRbacRolesResponseSchema = z
  .object({
    roles: z.array(internalRbacRoleSchema)
  })
  .strict();

export const internalRbacRoleBindingsResponseSchema = z
  .object({
    roleBindings: z.array(internalRbacRoleBindingSchema)
  })
  .strict();

export const internalRbacDirectGrantsResponseSchema = z
  .object({
    directGrants: z.array(internalRbacDirectGrantSchema)
  })
  .strict();

export const internalRbacRoleResponseSchema = z
  .object({
    role: internalRbacRoleSchema
  })
  .strict();

export const internalRbacRoleBindingResponseSchema = z
  .object({
    roleBinding: internalRbacRoleBindingSchema
  })
  .strict();

export const internalRbacDirectGrantResponseSchema = z
  .object({
    directGrant: internalRbacDirectGrantSchema
  })
  .strict();

export const internalRbacRevokeResponseSchema = z
  .object({
    revoked: z.literal(true)
  })
  .strict();

export const internalRbacRoleMutationRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(500).optional(),
    permissions: z.array(internalAccessDecisionPermissionSchema).min(1).max(100)
  })
  .strict();

export const internalRbacRoleBindingCreateRequestSchema = z
  .object({
    roleId: internalAccessDecisionIdSchema,
    subject: internalRbacRoleSubjectSchema,
    scope: internalAccessDecisionScopeSchema,
    startsAt: z.string().datetime({ offset: true }).optional(),
    expiresAt: z.string().datetime({ offset: true }).optional()
  })
  .strict();

export const internalRbacDirectGrantCreateRequestSchema = z
  .object({
    employeeId: internalAccessDecisionIdSchema,
    permission: internalAccessDecisionPermissionSchema,
    scope: internalAccessDecisionScopeSchema,
    reason: z.string().trim().min(1).max(500),
    startsAt: z.string().datetime({ offset: true }).optional(),
    expiresAt: z.string().datetime({ offset: true }).optional()
  })
  .strict();

export const internalChannelTypeSchema = z.enum([
  "telegram_bot",
  "telegram_qr_bridge",
  "whatsapp_qr_bridge",
  "max_qr_bridge",
  "max_bot",
  "vk_community"
]);

export const internalChannelClassSchema = z.enum([
  "bot_bridge",
  "user_bridge",
  "official_api"
]);

export const internalChannelConnectorStatusSchema = z.enum([
  "draft",
  "onboarding",
  "authorizing",
  "connected",
  "degraded",
  "reauth_required",
  "disabled",
  "failed",
  "deleted"
]);

export const internalChannelConnectorHealthStatusSchema = z.enum([
  "unknown",
  "healthy",
  "degraded",
  "unhealthy"
]);

export const internalEgressProfileKindSchema = z.enum([
  "direct",
  "vpn_namespace",
  "http_proxy",
  "socks_proxy",
  "customer_network",
  "disabled"
]);

export const internalEgressRequirementSchema = z
  .object({
    required: z.boolean(),
    defaultProfileKind: internalEgressProfileKindSchema,
    allowedProfileKinds: z.array(internalEgressProfileKindSchema).min(1).max(8),
    enforcementScope: z.enum([
      "hulee_managed_saas",
      "deployment_policy",
      "none"
    ])
  })
  .strict()
  .refine(
    (requirement) =>
      requirement.allowedProfileKinds.includes(requirement.defaultProfileKind),
    {
      message: "defaultProfileKind must be listed in allowedProfileKinds.",
      path: ["defaultProfileKind"]
    }
  );

export const internalEgressDiagnosticsSchema = z
  .object({
    required: z.boolean(),
    status: z.enum([
      "unknown",
      "ready",
      "degraded",
      "unavailable",
      "misconfigured"
    ]),
    profileKind: internalEgressProfileKindSchema.optional(),
    profileId: z.string().trim().min(1).max(200).optional(),
    checkedAt: z.string().datetime({ offset: true }).optional(),
    lastErrorCode: internalApiPlatformErrorCodeSchema.optional(),
    operatorHint: z.string().trim().min(1).max(500).optional()
  })
  .strict();

export const internalChannelOnboardingStepKindSchema = z.enum([
  "display_name",
  "secret_text",
  "select",
  "toggle",
  "diagnostics",
  "webhook_sync",
  "qr_code",
  "phone_number",
  "verification_code",
  "password",
  "waiting",
  "complete"
]);

export const internalChannelOnboardingActionSchema = z.enum([
  "update_connector",
  "refresh_diagnostics",
  "sync_webhook",
  "start_auth_challenge",
  "poll_auth_challenge",
  "submit_auth_code",
  "submit_auth_password",
  "none"
]);

export const internalChannelOnboardingStepSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    kind: internalChannelOnboardingStepKindSchema,
    titleKey: z.string().trim().min(1).max(140),
    action: internalChannelOnboardingActionSchema.optional(),
    required: z.boolean().optional()
  })
  .strict();

export const internalChannelOnboardingFlowSchema = z
  .object({
    version: z.literal("v1"),
    steps: z.array(internalChannelOnboardingStepSchema).min(1).max(20)
  })
  .strict();

export const internalChannelCatalogItemSchema = z
  .object({
    channelType: internalChannelTypeSchema,
    channelClass: internalChannelClassSchema,
    provider: z.string().trim().min(1).max(80),
    titleKey: z.string().trim().min(1).max(120),
    descriptionKey: z.string().trim().min(1).max(160),
    readiness: z.enum(["available", "coming_soon", "disabled"]),
    supportsMultiple: z.boolean(),
    capabilities: z.array(z.string().trim().min(1).max(80)).max(20),
    egressRequirement: internalEgressRequirementSchema,
    onboarding: internalChannelOnboardingFlowSchema
  })
  .strict();

export const internalChannelCatalogResponseSchema = z
  .object({
    channels: z.array(internalChannelCatalogItemSchema)
  })
  .strict();

export const internalChannelConnectorSummarySchema = z
  .object({
    connectorId: z.string().trim().min(1).max(200),
    channelType: internalChannelTypeSchema,
    channelClass: internalChannelClassSchema,
    provider: z.string().trim().min(1).max(80),
    displayName: z.string().trim().min(1).max(120),
    status: internalChannelConnectorStatusSchema,
    healthStatus: internalChannelConnectorHealthStatusSchema,
    channelExternalId: z.string().trim().min(1).max(200).optional(),
    diagnosticsStatus: z.string().trim().min(1).max(80).optional()
  })
  .strict();

export const internalChannelConnectorsResponseSchema = z
  .object({
    connectors: z.array(internalChannelConnectorSummarySchema)
  })
  .strict();

export const internalChannelConnectorCreateRequestSchema = z
  .object({
    channelType: internalChannelTypeSchema,
    displayName: z.string().trim().min(1).max(120).optional()
  })
  .strict();

export const internalChannelAuthChallengeTypeSchema = z.enum([
  "qr",
  "phone_code",
  "password",
  "reauth"
]);

export const internalChannelAuthChallengeStatusSchema = z.enum([
  "pending",
  "waiting",
  "requires_code",
  "requires_password",
  "succeeded",
  "failed",
  "expired",
  "cancelled"
]);

export const internalChannelAuthChallengePublicPayloadSchema = z
  .object({
    qrImageDataUrl: z.string().trim().min(1).max(20000).optional(),
    qrPayloadRef: z.string().trim().min(1).max(500).optional(),
    phoneNumber: z.string().trim().min(1).max(80).optional(),
    expiresAt: z.string().datetime({ offset: true }).optional(),
    operatorHint: z.string().trim().min(1).max(500).optional()
  })
  .strict();

export const internalChannelAuthChallengeSchema = z
  .object({
    challengeId: z.string().trim().min(1).max(200),
    connectorId: z.string().trim().min(1).max(200),
    challengeType: internalChannelAuthChallengeTypeSchema,
    status: internalChannelAuthChallengeStatusSchema,
    publicPayload: internalChannelAuthChallengePublicPayloadSchema.default({}),
    errorCode: internalApiPlatformErrorCodeSchema.optional(),
    errorMessage: z.string().trim().min(1).max(500).optional(),
    expiresAt: z.string().datetime({ offset: true }).optional(),
    completedAt: z.string().datetime({ offset: true }).optional(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true })
  })
  .strict();

export const internalChannelAuthChallengeResponseSchema = z
  .object({
    challenge: internalChannelAuthChallengeSchema
  })
  .strict();

export const internalChannelAuthChallengeStartRequestSchema = z
  .object({
    challengeType: internalChannelAuthChallengeTypeSchema,
    phoneNumber: z.string().trim().min(1).max(80).optional()
  })
  .strict()
  .refine(
    (request) =>
      request.challengeType !== "phone_code" || Boolean(request.phoneNumber),
    {
      message: "phoneNumber is required for phone_code challenges.",
      path: ["phoneNumber"]
    }
  );

export const internalChannelAuthChallengeSubmitRequestSchema = z
  .object({
    code: z.string().trim().min(1).max(80).optional(),
    password: z.string().trim().min(1).max(500).optional()
  })
  .strict()
  .refine((request) => request.code || request.password, {
    message: "code or password is required."
  });

export const internalTelegramIntegrationModeSchema = z.enum([
  "webhook",
  "polling"
]);

export const internalTelegramSetupStepSchema = z.enum([
  "name",
  "token",
  "mode",
  "diagnostics",
  "webhook",
  "complete"
]);

export const internalTelegramIntegrationConfigSchema = z
  .object({
    channelExternalId: z.string().trim().min(1).max(200),
    mode: internalTelegramIntegrationModeSchema.default("webhook"),
    botTokenSecretRef: z.string().trim().min(1).max(500).optional(),
    webhookConnectorId: z.string().trim().min(1).max(200).optional(),
    webhookSecretTokenSecretRef: z.string().trim().min(1).max(500).optional(),
    outboundEnabled: z.boolean().default(false)
  })
  .strict()
  .refine((config) => !config.outboundEnabled || config.botTokenSecretRef, {
    message: "botTokenSecretRef is required when outbound is enabled.",
    path: ["botTokenSecretRef"]
  });

export const internalTelegramIntegrationUpdateRequestSchema = z
  .object({
    connectorId: z.string().trim().min(1).max(200),
    displayName: z.string().trim().min(1).max(120).optional(),
    setupStepCompleted: z.enum(["name", "token", "mode"]).optional(),
    enabled: z.boolean().default(true),
    channelExternalId: z.string().trim().min(1).max(200),
    mode: internalTelegramIntegrationModeSchema.default("webhook"),
    botTokenSecretRef: z.string().trim().min(1).max(500).optional(),
    botToken: z.string().trim().min(1).max(4096).optional(),
    outboundEnabled: z.boolean().default(false)
  })
  .strict();

export const internalTelegramIntegrationDiagnosticsSchema = z
  .object({
    status: z.enum([
      "disabled",
      "configured",
      "invalid_config",
      "provider_unreachable",
      "webhook_mismatch"
    ]),
    lastErrorCode: internalApiPlatformErrorCodeSchema.optional(),
    operatorHint: z.string().trim().min(1).max(500).optional(),
    checkedAt: z.string().datetime({ offset: true }),
    bot: z
      .object({
        id: z.string().trim().min(1),
        username: z.string().trim().min(1).optional(),
        firstName: z.string().trim().min(1).optional()
      })
      .strict()
      .optional(),
    webhook: z
      .object({
        expectedUrl: z.string().url().optional(),
        actualUrl: z.string().optional(),
        pendingUpdateCount: z.number().int().nonnegative().optional(),
        lastErrorAt: z.string().datetime({ offset: true }).optional(),
        lastErrorMessage: z.string().trim().min(1).max(500).optional()
      })
      .strict()
      .optional(),
    polling: z
      .object({
        lastUpdateId: z.number().int().nonnegative().optional(),
        lastRunAt: z.string().datetime({ offset: true }).optional(),
        receivedUpdateCount: z.number().int().nonnegative().optional(),
        acceptedUpdateCount: z.number().int().nonnegative().optional(),
        failedUpdateCount: z.number().int().nonnegative().optional()
      })
      .strict()
      .optional(),
    egress: internalEgressDiagnosticsSchema.optional(),
    checks: z
      .object({
        moduleEnabled: z.boolean(),
        configValid: z.boolean(),
        inboundWebhookReady: z.boolean(),
        outboundEnabled: z.boolean(),
        botTokenSecretRefConfigured: z.boolean(),
        webhookSecretTokenResolved: z.boolean().optional(),
        botTokenResolved: z.boolean().optional(),
        botApiReachable: z.boolean().optional(),
        webhookMatchesConfig: z.boolean().optional()
      })
      .strict()
  })
  .strict();

export const internalTelegramIntegrationResponseSchema = z
  .object({
    moduleId: z.literal("channel-telegram"),
    connectorId: z.string().trim().min(1).optional(),
    channelType: z.literal("telegram_bot").optional(),
    channelClass: z.literal("bot_bridge").optional(),
    displayName: z.string().trim().min(1).optional(),
    status: internalChannelConnectorStatusSchema.optional(),
    setupStep: internalTelegramSetupStepSchema.optional(),
    enabled: z.boolean(),
    config: internalTelegramIntegrationConfigSchema.optional(),
    webhookPath: z.string().trim().min(1).optional(),
    publicWebhookUrl: z.string().url().optional(),
    diagnostics: internalTelegramIntegrationDiagnosticsSchema
  })
  .strict();

export const internalApiErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: internalApiPlatformErrorCodeSchema,
        messageKey: z.string().trim().min(1),
        retryability: z.enum(["retryable", "not_retryable", "unknown"]),
        requestId: z.string().trim().min(1)
      })
      .strict()
  })
  .strict();

export type InternalInboxBrandProfile = z.infer<
  typeof internalInboxBrandProfileSchema
>;
export type InternalInboxTenantContext = z.infer<
  typeof internalInboxTenantContextSchema
>;
export type InternalInboxConversation = z.infer<
  typeof internalInboxConversationSchema
>;
export type InternalInboxMessage = z.infer<typeof internalInboxMessageSchema>;
export type InternalInboxViewResponse = z.infer<
  typeof internalInboxViewResponseSchema
>;
export type InternalInboxReplyRequest = z.infer<
  typeof internalInboxReplyRequestSchema
>;
export type InternalInboxReplyResponse = z.infer<
  typeof internalInboxReplyResponseSchema
>;
export type InternalInboxConversationRoutingUpdateRequest = z.infer<
  typeof internalInboxConversationRoutingUpdateRequestSchema
>;
export type InternalInboxConversationRoutingUpdateResponse = z.infer<
  typeof internalInboxConversationRoutingUpdateResponseSchema
>;
export type InternalTenantBrandUpdateRequest = z.infer<
  typeof internalTenantBrandUpdateRequestSchema
>;
export type InternalTenantBrandResponse = z.infer<
  typeof internalTenantBrandResponseSchema
>;
export type InternalOrgStructureStatus = z.infer<
  typeof internalOrgStructureStatusSchema
>;
export type InternalOrgUnitKind = z.infer<typeof internalOrgUnitKindSchema>;
export type InternalWorkQueueKind = z.infer<typeof internalWorkQueueKindSchema>;
export type InternalOrgUnit = z.infer<typeof internalOrgUnitSchema>;
export type InternalWorkQueue = z.infer<typeof internalWorkQueueSchema>;
export type InternalOrgStructureResponse = z.infer<
  typeof internalOrgStructureResponseSchema
>;
export type InternalOrgUnitUpsertRequest = z.infer<
  typeof internalOrgUnitUpsertRequestSchema
>;
export type InternalWorkQueueUpsertRequest = z.infer<
  typeof internalWorkQueueUpsertRequestSchema
>;
export type InternalAccessDecisionResourceContext = z.infer<
  typeof internalAccessDecisionResourceContextSchema
>;
export type InternalAccessDecisionRequest = z.infer<
  typeof internalAccessDecisionRequestSchema
>;
export type InternalAccessDecisionReason = z.infer<
  typeof internalAccessDecisionReasonSchema
>;
export type InternalAccessDecisionScope = z.infer<
  typeof internalAccessDecisionScopeSchema
>;
export type InternalAccessDecisionGrantSource = z.infer<
  typeof internalAccessDecisionGrantSourceSchema
>;
export type InternalAccessDecisionGrant = z.infer<
  typeof internalAccessDecisionGrantSchema
>;
export type InternalAccessDecisionResponse = z.infer<
  typeof internalAccessDecisionResponseSchema
>;
export type InternalRbacRoleStatus = z.infer<
  typeof internalRbacRoleStatusSchema
>;
export type InternalRbacRole = z.infer<typeof internalRbacRoleSchema>;
export type InternalRbacRoleSubject = z.infer<
  typeof internalRbacRoleSubjectSchema
>;
export type InternalRbacRoleBinding = z.infer<
  typeof internalRbacRoleBindingSchema
>;
export type InternalRbacDirectGrant = z.infer<
  typeof internalRbacDirectGrantSchema
>;
export type InternalRbacRolesResponse = z.infer<
  typeof internalRbacRolesResponseSchema
>;
export type InternalRbacRoleBindingsResponse = z.infer<
  typeof internalRbacRoleBindingsResponseSchema
>;
export type InternalRbacDirectGrantsResponse = z.infer<
  typeof internalRbacDirectGrantsResponseSchema
>;
export type InternalRbacRoleResponse = z.infer<
  typeof internalRbacRoleResponseSchema
>;
export type InternalRbacRoleBindingResponse = z.infer<
  typeof internalRbacRoleBindingResponseSchema
>;
export type InternalRbacDirectGrantResponse = z.infer<
  typeof internalRbacDirectGrantResponseSchema
>;
export type InternalRbacRevokeResponse = z.infer<
  typeof internalRbacRevokeResponseSchema
>;
export type InternalRbacRoleMutationRequest = z.infer<
  typeof internalRbacRoleMutationRequestSchema
>;
export type InternalRbacRoleBindingCreateRequest = z.infer<
  typeof internalRbacRoleBindingCreateRequestSchema
>;
export type InternalRbacDirectGrantCreateRequest = z.infer<
  typeof internalRbacDirectGrantCreateRequestSchema
>;
export type InternalChannelType = z.infer<typeof internalChannelTypeSchema>;
export type InternalChannelClass = z.infer<typeof internalChannelClassSchema>;
export type InternalChannelConnectorStatus = z.infer<
  typeof internalChannelConnectorStatusSchema
>;
export type InternalChannelConnectorHealthStatus = z.infer<
  typeof internalChannelConnectorHealthStatusSchema
>;
export type InternalEgressProfileKind = z.infer<
  typeof internalEgressProfileKindSchema
>;
export type InternalEgressRequirement = z.infer<
  typeof internalEgressRequirementSchema
>;
export type InternalEgressDiagnostics = z.infer<
  typeof internalEgressDiagnosticsSchema
>;
export type InternalChannelOnboardingStepKind = z.infer<
  typeof internalChannelOnboardingStepKindSchema
>;
export type InternalChannelOnboardingAction = z.infer<
  typeof internalChannelOnboardingActionSchema
>;
export type InternalChannelOnboardingStep = z.infer<
  typeof internalChannelOnboardingStepSchema
>;
export type InternalChannelOnboardingFlow = z.infer<
  typeof internalChannelOnboardingFlowSchema
>;
export type InternalChannelCatalogItem = z.infer<
  typeof internalChannelCatalogItemSchema
>;
export type InternalChannelCatalogResponse = z.infer<
  typeof internalChannelCatalogResponseSchema
>;
export type InternalChannelConnectorSummary = z.infer<
  typeof internalChannelConnectorSummarySchema
>;
export type InternalChannelConnectorsResponse = z.infer<
  typeof internalChannelConnectorsResponseSchema
>;
export type InternalChannelConnectorCreateRequest = z.infer<
  typeof internalChannelConnectorCreateRequestSchema
>;
export type InternalChannelAuthChallengeType = z.infer<
  typeof internalChannelAuthChallengeTypeSchema
>;
export type InternalChannelAuthChallengeStatus = z.infer<
  typeof internalChannelAuthChallengeStatusSchema
>;
export type InternalChannelAuthChallengePublicPayload = z.infer<
  typeof internalChannelAuthChallengePublicPayloadSchema
>;
export type InternalChannelAuthChallenge = z.infer<
  typeof internalChannelAuthChallengeSchema
>;
export type InternalChannelAuthChallengeResponse = z.infer<
  typeof internalChannelAuthChallengeResponseSchema
>;
export type InternalChannelAuthChallengeStartRequest = z.infer<
  typeof internalChannelAuthChallengeStartRequestSchema
>;
export type InternalChannelAuthChallengeSubmitRequest = z.infer<
  typeof internalChannelAuthChallengeSubmitRequestSchema
>;
export type InternalTelegramIntegrationConfig = z.infer<
  typeof internalTelegramIntegrationConfigSchema
>;
export type InternalTelegramSetupStep = z.infer<
  typeof internalTelegramSetupStepSchema
>;
export type InternalTelegramIntegrationUpdateRequest = z.infer<
  typeof internalTelegramIntegrationUpdateRequestSchema
>;
export type InternalTelegramIntegrationDiagnostics = z.infer<
  typeof internalTelegramIntegrationDiagnosticsSchema
>;
export type InternalTelegramIntegrationResponse = z.infer<
  typeof internalTelegramIntegrationResponseSchema
>;
export type InternalApiErrorResponse = z.infer<
  typeof internalApiErrorResponseSchema
>;
