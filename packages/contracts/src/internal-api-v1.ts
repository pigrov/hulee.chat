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

export const internalTelegramIntegrationModeSchema = z.enum([
  "webhook",
  "polling"
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
export type InternalTelegramIntegrationConfig = z.infer<
  typeof internalTelegramIntegrationConfigSchema
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
