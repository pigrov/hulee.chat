export type Brand<TValue, TBrand extends string> = TValue & {
  readonly __brand: TBrand;
};

export type TenantId = Brand<string, "TenantId">;
export type EmployeeId = Brand<string, "EmployeeId">;
export type ClientId = Brand<string, "ClientId">;
export type ConversationId = Brand<string, "ConversationId">;
export type MessageId = Brand<string, "MessageId">;
export type EventId = Brand<string, "EventId">;

export type DeploymentType = "saas_shared" | "saas_isolated" | "on_prem";

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
      "account.password_reset_requested",
      { accountId: string; email: string }
    >
  | EventEnvelope<"account.password_reset_completed", { accountId: string }>
  | EventEnvelope<"employee.created", { employeeId: EmployeeId }>
  | EventEnvelope<
      "employee.invited",
      { invitationId: string; email: string; role: string }
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
  | EventEnvelope<"message.received", { messageId: MessageId }>
  | EventEnvelope<"message.sent", { messageId: MessageId }>
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
    >;

export type ModuleType =
  | "auth"
  | "channel"
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

export * from "./public-api-v1";
export * from "./internal-api-v1";
