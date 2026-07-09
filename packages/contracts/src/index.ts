export type Brand<TValue, TBrand extends string> = TValue & {
  readonly __brand: TBrand;
};

export type TenantId = Brand<string, "TenantId">;
export type EmployeeId = Brand<string, "EmployeeId">;
export type ClientId = Brand<string, "ClientId">;
export type ConversationId = Brand<string, "ConversationId">;
export type MessageId = Brand<string, "MessageId">;
export type EventId = Brand<string, "EventId">;
export type ChannelConnectorId = Brand<string, "ChannelConnectorId">;
export type SourceConnectionId = Brand<string, "SourceConnectionId">;
export type SourceAccountId = Brand<string, "SourceAccountId">;
export type RawInboundEventId = Brand<string, "RawInboundEventId">;
export type NormalizedInboundEventId = Brand<
  string,
  "NormalizedInboundEventId"
>;

export type DeploymentType = "saas_shared" | "saas_isolated" | "on_prem";

export type ChannelClass = "bot_bridge" | "user_bridge" | "official_api";

export type ChannelConnectorStatus =
  | "draft"
  | "onboarding"
  | "authorizing"
  | "connected"
  | "degraded"
  | "reauth_required"
  | "disabled"
  | "failed"
  | "deleted";

export type ChannelConnectorHealthStatus =
  | "unknown"
  | "healthy"
  | "degraded"
  | "unhealthy";

export type ChannelType =
  | "telegram_bot"
  | "telegram_qr_bridge"
  | "whatsapp_qr_bridge"
  | "max_qr_bridge"
  | "max_bot"
  | "vk_community";

export type ChannelProviderOperation =
  | "telegram.diagnostics.refresh"
  | "telegram.webhook.set"
  | "telegram.webhook.delete";

export type SourceType =
  | "messenger"
  | "social"
  | "marketplace"
  | "classified"
  | "review"
  | "email"
  | "phone"
  | "form"
  | "internal"
  | "crm"
  | "api";

export type SourceConnectionStatus =
  | "draft"
  | "onboarding"
  | "active"
  | "disabled"
  | "degraded"
  | "error"
  | "deleted";

export type SourceAuthType =
  | "oauth2"
  | "api_key"
  | "token"
  | "basic"
  | "imap"
  | "webhook_secret"
  | "custom";

export type SourceAccountType =
  | "bot"
  | "user_session"
  | "group"
  | "shop"
  | "branch"
  | "mailbox"
  | "phone_number"
  | "ad_account"
  | "site"
  | "custom";

export type SourceEventType =
  | "message"
  | "comment"
  | "review"
  | "lead"
  | "call"
  | "order_question"
  | "system"
  | "status_update";

export type SourceEventDirection = "inbound" | "outbound" | "system";

export type SourceVisibility = "private" | "public" | "internal";

export type SourceEventProcessingStatus =
  | "new"
  | "processed"
  | "failed"
  | "ignored"
  | "duplicate";

export type ReplyCapabilityMode =
  | "native_reply"
  | "external_link"
  | "readonly"
  | "expired"
  | "unsupported";

export type SourceCapabilities = {
  canReceive: boolean;
  canReply: boolean;
  canFetchHistory: boolean;
  canSendFiles: boolean;
  canReceiveFiles: boolean;
  supportsThreads: boolean;
  supportsReactions: boolean;
  supportsReadStatus: boolean;
  supportsDeliveryStatus: boolean;
  webhookSupported: boolean;
  pollingRequired: boolean;
  customerProfile: boolean;
  rateLimitsKnown: boolean;
  oauthSupported: boolean;
  sandboxAvailable: boolean;
  legalRisk?: "low" | "medium" | "high";
  replyWindowSeconds?: number;
};

export type ReplyCapability = {
  mode: ReplyCapabilityMode;
  reason?: string;
  externalReplyUrl?: string;
  expiresAt?: string;
};

export type SourceConnection = {
  id: SourceConnectionId;
  tenantId: TenantId;
  sourceType: SourceType;
  sourceName: string;
  displayName: string;
  status: SourceConnectionStatus;
  authType: SourceAuthType;
  capabilities: SourceCapabilities;
  config?: Record<string, unknown>;
  diagnostics?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type SourceAccount = {
  id: SourceAccountId;
  tenantId: TenantId;
  sourceConnectionId: SourceConnectionId;
  externalAccountId?: string;
  externalAccountName?: string;
  accountType: SourceAccountType;
  displayName: string;
  status: SourceConnectionStatus;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type RawInboundEvent = {
  id: RawInboundEventId;
  tenantId: TenantId;
  sourceConnectionId: SourceConnectionId;
  sourceAccountId?: SourceAccountId;
  externalEventId?: string;
  eventSignature?: string;
  idempotencyKey: string;
  receivedAt: string;
  providerTimestamp?: string;
  payload: unknown;
  headers?: Record<string, unknown>;
  processingStatus: SourceEventProcessingStatus;
  errorCode?: PlatformErrorCode;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
};

export type NormalizedInboundEvent = {
  id: NormalizedInboundEventId;
  rawEventId: RawInboundEventId;
  tenantId: TenantId;
  sourceConnectionId: SourceConnectionId;
  sourceAccountId?: SourceAccountId;
  sourceType: SourceType;
  sourceName: string;
  eventType: SourceEventType;
  direction: SourceEventDirection;
  visibility: SourceVisibility;
  externalThreadId?: string;
  externalMessageId?: string;
  externalUserId?: string;
  payloadVersion: EventSchemaVersion;
  normalizedPayload: Record<string, unknown>;
  replyCapability?: ReplyCapability;
  conversationId?: ConversationId;
  messageId?: MessageId;
  idempotencyKey: string;
  processingStatus: SourceEventProcessingStatus;
  createdAt: string;
  updatedAt: string;
};

export type EventSchemaVersion = "v1";

export type EventEnvelope<TType extends string, TPayload> = {
  id: EventId;
  type: TType;
  version: EventSchemaVersion;
  tenantId: TenantId;
  occurredAt: string;
  idempotencyKey?: string;
  payload: TPayload;
};

export type PlatformEvent =
  | EventEnvelope<"tenant.created", { tenantId: TenantId }>
  | EventEnvelope<
      "tenant.brand_profile_updated",
      { brandProfileId: string; productName: string }
    >
  | EventEnvelope<
      "account.email_verification_requested",
      { accountId: string; email: string }
    >
  | EventEnvelope<"account.email_verified", { accountId: string }>
  | EventEnvelope<
      "account.email_change_requested",
      { accountId: string; email: string }
    >
  | EventEnvelope<"account.email_changed", { accountId: string; email: string }>
  | EventEnvelope<
      "account.password_reset_requested",
      { accountId: string; email: string }
    >
  | EventEnvelope<"account.password_reset_completed", { accountId: string }>
  | EventEnvelope<"employee.created", { employeeId: EmployeeId }>
  | EventEnvelope<
      "employee.profile_updated",
      { employeeId: EmployeeId; fields: readonly string[] }
    >
  | EventEnvelope<
      "employee.invited",
      { invitationId: string; email: string; role?: string }
    >
  | EventEnvelope<
      "employee.invitation_accepted",
      { invitationId: string; employeeId: EmployeeId }
    >
  | EventEnvelope<"employee.invitation_revoked", { invitationId: string }>
  | EventEnvelope<"employee.invitation_resent", { invitationId: string }>
  | EventEnvelope<
      "employee.role_changed",
      { employeeId: EmployeeId; role: string }
    >
  | EventEnvelope<"employee.deactivated", { employeeId: EmployeeId }>
  | EventEnvelope<"client.created", { clientId: ClientId }>
  | EventEnvelope<"conversation.created", { conversationId: ConversationId }>
  | EventEnvelope<
      "conversation.assigned",
      {
        conversationId: ConversationId;
        actorEmployeeId: EmployeeId;
        currentQueueId: string | null;
        assignedEmployeeId: EmployeeId | null;
        assignedTeamId: string | null;
      }
    >
  | EventEnvelope<"message.received", { messageId: MessageId }>
  | EventEnvelope<"message.sent", { messageId: MessageId }>
  | EventEnvelope<
      "channel.provider_operation.requested",
      {
        connectorId: ChannelConnectorId;
        channelType: ChannelType;
        provider: string;
        operation: ChannelProviderOperation;
        actorEmployeeId: EmployeeId;
      }
    >
  | EventEnvelope<
      "channel.provider_validation.requested",
      {
        jobId: string;
        channelType: ChannelType;
        provider: string;
        validationKind: "telegram_bot_token";
        actorEmployeeId: EmployeeId;
      }
    >
  | EventEnvelope<
      "source.raw_event_received",
      {
        rawEventId: RawInboundEventId;
        sourceConnectionId: SourceConnectionId;
        sourceAccountId?: SourceAccountId;
        sourceType: SourceType;
        sourceName: string;
      }
    >
  | EventEnvelope<
      "source.normalized_event_created",
      {
        normalizedEventId: NormalizedInboundEventId;
        rawEventId: RawInboundEventId;
        sourceConnectionId: SourceConnectionId;
        eventType: SourceEventType;
      }
    >
  | EventEnvelope<
      "message.delivery_failed",
      { messageId: MessageId; errorCode: PlatformErrorCode }
    >
  | EventEnvelope<"notification.created", { notificationId: string }>
  | EventEnvelope<"notification_endpoint.registered", { endpointId: string }>
  | EventEnvelope<
      "usage.recorded",
      { entitlementKey: string; quantity: number }
    >
  | EventEnvelope<
      "usage.limit_exceeded",
      { entitlementKey: string; limit: number }
    >
  | EventEnvelope<
      "integration.failed",
      { moduleId: string; errorCode: PlatformErrorCode }
    >
  | EventEnvelope<
      "role.created",
      {
        roleId: string;
        actorEmployeeId: EmployeeId;
        name: string;
        description?: string | null;
        permissions: readonly string[];
        permissionCount: number;
        isSystem: boolean;
        templateId?: string;
        recommendedScopeType?: string;
      }
    >
  | EventEnvelope<
      "role.updated",
      {
        roleId: string;
        actorEmployeeId: EmployeeId;
        previousName: string;
        nextName: string;
        previousDescription?: string | null;
        nextDescription?: string | null;
        previousPermissions: readonly string[];
        nextPermissions: readonly string[];
        addedPermissions: readonly string[];
        removedPermissions: readonly string[];
      }
    >
  | EventEnvelope<
      "role.archived",
      {
        roleId: string;
        actorEmployeeId: EmployeeId;
        name: string;
        status: "archived";
      }
    >
  | EventEnvelope<
      "role.restored",
      {
        roleId: string;
        actorEmployeeId: EmployeeId;
        name: string;
        status: "active";
      }
    >
  | EventEnvelope<
      "role_binding.created",
      {
        bindingId: string;
        roleId: string;
        actorEmployeeId: EmployeeId;
        subject: { type: string; id: string };
        scope: { type: string; id?: string };
        targetEmployeeId?: EmployeeId;
      }
    >
  | EventEnvelope<
      "role_binding.revoked",
      {
        bindingId: string;
        roleId: string;
        actorEmployeeId: EmployeeId;
        subject: { type: string; id: string };
        scope: { type: string; id?: string };
        targetEmployeeId?: EmployeeId;
      }
    >
  | EventEnvelope<
      "direct_grant.created",
      {
        grantId: string;
        actorEmployeeId: EmployeeId;
        targetEmployeeId: EmployeeId;
        permission: string;
        scope: { type: string; id?: string };
        reason: string;
        expiresAt?: string;
      }
    >
  | EventEnvelope<
      "direct_grant.revoked",
      {
        grantId: string;
        actorEmployeeId: EmployeeId;
        targetEmployeeId: EmployeeId;
        permission: string;
        scope: { type: string; id?: string };
        reason: string;
      }
    >;

export type ModuleType =
  | "auth"
  | "channel"
  | "source"
  | "telephony"
  | "crm"
  | "ai"
  | "marketing"
  | "analytics"
  | "storage"
  | "notification"
  | "workflow"
  | "billing"
  | "company";

export type UiSlotId =
  | "tenant.settings.section"
  | "integration.settings.section"
  | "client.profile.card"
  | "conversation.composer.tool"
  | "conversation.message.action"
  | "inbox.sidebar.section"
  | "admin.section"
  | "reports.section"
  | "support.case.panel";

export type UiClientKind = "web" | "mobile" | "desktop";

export type UiSlotContribution = {
  id: string;
  slot: UiSlotId;
  componentRef: string;
  titleKey?: string;
  requiredPermissions?: string[];
  supportedClients?: UiClientKind[];
  order?: number;
};

export type ModuleManifest = {
  id: string;
  type: ModuleType;
  name: string;
  version: string;
  capabilities: string[];
  configSchema: unknown;
  secretsSchema?: unknown;
  permissions?: string[];
  events?: string[];
  webhooks?: string[];
  jobs?: string[];
  uiSlots?: UiSlotContribution[];
  healthChecks?: string[];
};

export type PlatformErrorCode =
  | "auth.invalid_credentials"
  | "auth.email_not_verified"
  | "auth.rate_limited"
  | "entitlement.missing"
  | "license.inactive"
  | "permission.denied"
  | "tenant.not_found"
  | "tenant.boundary_violation"
  | "module.disabled"
  | "module.unhealthy"
  | "usage.limit_exceeded"
  | "provider.temporary_failure"
  | "provider.permanent_failure"
  | "validation.failed";

export type Retryability = "retryable" | "not_retryable" | "unknown";

export type PlatformErrorCategory =
  | "auth"
  | "entitlement"
  | "license"
  | "permission"
  | "tenant"
  | "module"
  | "usage"
  | "provider"
  | "validation";

export type PlatformErrorSeverity = "info" | "warn" | "error";

export type PlatformErrorDefinition = {
  code: PlatformErrorCode;
  category: PlatformErrorCategory;
  httpStatus: number;
  retryability: Retryability;
  severity: PlatformErrorSeverity;
  messageKey: string;
};

export const platformErrorCatalog = {
  "auth.invalid_credentials": {
    code: "auth.invalid_credentials",
    category: "auth",
    httpStatus: 401,
    retryability: "not_retryable",
    severity: "warn",
    messageKey: "errors.auth.invalidCredentials"
  },
  "auth.email_not_verified": {
    code: "auth.email_not_verified",
    category: "auth",
    httpStatus: 403,
    retryability: "not_retryable",
    severity: "warn",
    messageKey: "errors.auth.emailNotVerified"
  },
  "auth.rate_limited": {
    code: "auth.rate_limited",
    category: "auth",
    httpStatus: 429,
    retryability: "not_retryable",
    severity: "warn",
    messageKey: "errors.auth.rateLimited"
  },
  "entitlement.missing": {
    code: "entitlement.missing",
    category: "entitlement",
    httpStatus: 403,
    retryability: "not_retryable",
    severity: "warn",
    messageKey: "errors.entitlement.missing"
  },
  "license.inactive": {
    code: "license.inactive",
    category: "license",
    httpStatus: 402,
    retryability: "not_retryable",
    severity: "warn",
    messageKey: "errors.license.inactive"
  },
  "permission.denied": {
    code: "permission.denied",
    category: "permission",
    httpStatus: 403,
    retryability: "not_retryable",
    severity: "warn",
    messageKey: "errors.permission.denied"
  },
  "tenant.not_found": {
    code: "tenant.not_found",
    category: "tenant",
    httpStatus: 404,
    retryability: "not_retryable",
    severity: "warn",
    messageKey: "errors.tenant.notFound"
  },
  "tenant.boundary_violation": {
    code: "tenant.boundary_violation",
    category: "tenant",
    httpStatus: 403,
    retryability: "not_retryable",
    severity: "error",
    messageKey: "errors.tenant.boundaryViolation"
  },
  "module.disabled": {
    code: "module.disabled",
    category: "module",
    httpStatus: 403,
    retryability: "not_retryable",
    severity: "warn",
    messageKey: "errors.module.disabled"
  },
  "module.unhealthy": {
    code: "module.unhealthy",
    category: "module",
    httpStatus: 503,
    retryability: "retryable",
    severity: "error",
    messageKey: "errors.module.unhealthy"
  },
  "usage.limit_exceeded": {
    code: "usage.limit_exceeded",
    category: "usage",
    httpStatus: 429,
    retryability: "not_retryable",
    severity: "warn",
    messageKey: "errors.usage.limitExceeded"
  },
  "provider.temporary_failure": {
    code: "provider.temporary_failure",
    category: "provider",
    httpStatus: 502,
    retryability: "retryable",
    severity: "error",
    messageKey: "errors.provider.temporaryFailure"
  },
  "provider.permanent_failure": {
    code: "provider.permanent_failure",
    category: "provider",
    httpStatus: 502,
    retryability: "not_retryable",
    severity: "error",
    messageKey: "errors.provider.permanentFailure"
  },
  "validation.failed": {
    code: "validation.failed",
    category: "validation",
    httpStatus: 400,
    retryability: "not_retryable",
    severity: "warn",
    messageKey: "errors.validation.failed"
  }
} satisfies Record<PlatformErrorCode, PlatformErrorDefinition>;

export function getPlatformErrorDefinition(
  code: PlatformErrorCode
): PlatformErrorDefinition {
  return platformErrorCatalog[code];
}

export function isPlatformErrorCode(value: string): value is PlatformErrorCode {
  return Object.hasOwn(platformErrorCatalog, value);
}

export type AdapterHealth = {
  status: "healthy" | "degraded" | "unhealthy";
  checkedAt: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastErrorCode?: PlatformErrorCode;
  operatorHint?: string;
};

export type SourceAdapterNormalizeInput = {
  connection: SourceConnection;
  account?: SourceAccount;
  rawEvent: RawInboundEvent;
};

export type SourceAdapterNormalizeResult = {
  events: NormalizedInboundEvent[];
};

export type SourceAdapter = {
  manifest: ModuleManifest;
  sourceType: SourceType;
  sourceName: string;
  capabilities: SourceCapabilities;
  normalize(
    input: SourceAdapterNormalizeInput
  ): Promise<SourceAdapterNormalizeResult>;
  health(input?: {
    connection?: SourceConnection;
    account?: SourceAccount;
  }): Promise<AdapterHealth>;
};

export type NormalizedAttachment = {
  id?: string;
  fileName?: string;
  mediaType: string;
  sizeBytes?: number;
  storageKey?: string;
  sourceUrl?: string;
};

export type NormalizedIncomingMessage = {
  tenantId: TenantId;
  providerMessageId: string;
  channelExternalId: string;
  clientExternalId: string;
  clientDisplayName?: string;
  text?: string;
  attachments?: NormalizedAttachment[];
  occurredAt: string;
  idempotencyKey: string;
};

export type NormalizedOutgoingMessage = {
  tenantId: TenantId;
  conversationId: ConversationId;
  messageId: MessageId;
  channelExternalId: string;
  clientExternalId?: string;
  text?: string;
  attachments?: NormalizedAttachment[];
  idempotencyKey: string;
};

export type DeliveryResult = {
  providerMessageId?: string;
  status: "accepted" | "sent" | "failed";
  errorCode?: PlatformErrorCode;
  retryability?: Retryability;
};

export type ChannelAdapter = {
  manifest: ModuleManifest;
  normalizeIncoming(input: unknown): Promise<NormalizedIncomingMessage>;
  sendMessage(message: NormalizedOutgoingMessage): Promise<DeliveryResult>;
  health(): Promise<AdapterHealth>;
};

export type TelephonyProvider = {
  manifest: ModuleManifest;
  health(): Promise<AdapterHealth>;
};

export type AuthProviderLoginStartInput = {
  tenantId?: TenantId;
  redirectUri?: string;
  state?: string;
};

export type AuthProviderPasswordInput = {
  tenantId?: TenantId;
  email: string;
  password: string;
};

export type AuthProviderRegistrationInput = AuthProviderPasswordInput & {
  displayName?: string;
};

export type AuthProviderCallbackInput = {
  tenantId?: TenantId;
  redirectUri?: string;
  code?: string;
  state?: string;
  idToken?: string;
  rawPayload?: unknown;
};

export type AuthProviderIdentity = {
  providerId: string;
  externalSubject: string;
  email: string;
  emailVerified?: boolean;
  displayName?: string;
  avatarUrl?: string;
};

export type AuthProviderAccountLinkInput = {
  tenantId: TenantId;
  accountId: string;
  identity: AuthProviderIdentity;
};

export type AuthProvider = {
  manifest: ModuleManifest;
  startLogin?(input: AuthProviderLoginStartInput): Promise<{ url: string }>;
  validateCallback?(
    input: AuthProviderCallbackInput
  ): Promise<AuthProviderIdentity | null>;
  authenticatePassword?(
    input: AuthProviderPasswordInput
  ): Promise<AuthProviderIdentity | null>;
  registerPassword?(
    input: AuthProviderRegistrationInput
  ): Promise<AuthProviderIdentity | null>;
  linkIdentity?(input: AuthProviderAccountLinkInput): Promise<void>;
  health(): Promise<AdapterHealth>;
};

export type StorageProvider = {
  manifest: ModuleManifest;
  buildTenantObjectKey(input: {
    tenantId: TenantId;
    fileId: string;
    fileName: string;
  }): string;
  health(): Promise<AdapterHealth>;
};

export {
  defaultSourceCapabilities,
  normalizeSourceCapabilities,
  replyCapabilitySchema,
  resolveReplyCapability,
  sourceCapabilitiesSchema
} from "./source-capabilities";
export type { ResolveReplyCapabilityInput } from "./source-capabilities";

export * from "./public-api-v1";
export * from "./internal-api-v1";
