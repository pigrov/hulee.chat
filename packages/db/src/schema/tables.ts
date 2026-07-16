import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
};

function tenantIdColumn() {
  return text("tenant_id").notNull();
}

export const deploymentType = pgEnum("deployment_type", [
  "saas_shared",
  "saas_isolated",
  "on_prem"
]);
export const conversationType = pgEnum("conversation_type", [
  "client_direct",
  "client_group",
  "internal_direct",
  "internal_group",
  "support_case",
  "intake"
]);
export const inboxV2ConversationTopology = pgEnum(
  "inbox_v2_conversation_topology",
  ["direct", "group", "case", "object"]
);
export const inboxV2ConversationTransport = pgEnum(
  "inbox_v2_conversation_transport",
  ["internal", "external"]
);
export const inboxV2ConversationLifecycle = pgEnum(
  "inbox_v2_conversation_lifecycle",
  ["active", "ended"]
);
export const messageDirection = pgEnum("message_direction", [
  "inbound",
  "outbound"
]);
export const messageStatus = pgEnum("message_status", [
  "received",
  "queued",
  "sent",
  "failed"
]);
export const outboxStatus = pgEnum("outbox_status", [
  "pending",
  "processing",
  "processed",
  "failed"
]);

export const tenants = pgTable(
  "tenants",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    displayName: text("display_name").notNull(),
    deploymentType: deploymentType("deployment_type")
      .notNull()
      .default("saas_shared"),
    ...timestamps
  },
  (table) => [uniqueIndex("tenants_slug_unique").on(table.slug)]
);

export const tenantDomains = pgTable(
  "tenant_domains",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    domain: text("domain").notNull(),
    ...timestamps
  },
  (table) => [
    uniqueIndex("tenant_domains_domain_unique").on(table.domain),
    index("tenant_domains_tenant_idx").on(table.tenantId)
  ]
);

export const platformAdminAccounts = pgTable(
  "platform_admin_accounts",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash"),
    ...timestamps
  },
  (table) => [
    uniqueIndex("platform_admin_accounts_email_unique").on(table.email)
  ]
);

export const platformAuditLog = pgTable(
  "platform_audit_log",
  {
    id: text("id").primaryKey(),
    actorPlatformAdminAccountId: text(
      "actor_platform_admin_account_id"
    ).references(() => platformAdminAccounts.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    ...timestamps
  },
  (table) => [
    index("platform_audit_log_actor_idx").on(
      table.actorPlatformAdminAccountId,
      table.createdAt
    ),
    index("platform_audit_log_entity_idx").on(table.entityType, table.entityId)
  ]
);

export const deploymentEgressStatusSnapshots = pgTable(
  "deployment_egress_status_snapshots",
  {
    profileId: text("profile_id").primaryKey(),
    profileKind: text("profile_kind").notNull(),
    status: text("status").notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
    lastReadyAt: timestamp("last_ready_at", { withTimezone: true }),
    lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    alertSeverity: text("alert_severity").notNull().default("none"),
    lastErrorCode: text("last_error_code"),
    operatorHint: text("operator_hint"),
    publicIp: text("public_ip"),
    details: jsonb("details").notNull().default({}),
    ...timestamps
  },
  (table) => [
    index("deployment_egress_status_checked_idx").on(table.checkedAt),
    index("deployment_egress_status_status_idx").on(table.status)
  ]
);

export const deploymentEgressProviderPolicies = pgTable(
  "deployment_egress_provider_policies",
  {
    provider: text("provider").primaryKey(),
    routingMode: text("routing_mode").notNull(),
    profileId: text("profile_id").notNull(),
    required: boolean("required").notNull().default(true),
    supportedChannelTypes: jsonb("supported_channel_types")
      .notNull()
      .default([]),
    allowedProfileKinds: jsonb("allowed_profile_kinds").notNull().default([]),
    updatedByPlatformAdminAccountId: text(
      "updated_by_platform_admin_account_id"
    ).references(() => platformAdminAccounts.id),
    ...timestamps
  },
  (table) => [
    index("deployment_egress_provider_policy_profile_idx").on(table.profileId),
    index("deployment_egress_provider_policy_route_idx").on(table.routingMode)
  ]
);

export const deploymentChannelProviderPolicies = pgTable(
  "deployment_channel_provider_policies",
  {
    provider: text("provider").notNull(),
    channelType: text("channel_type").notNull(),
    inboundMode: text("inbound_mode").notNull(),
    outboundEnabled: boolean("outbound_enabled").notNull().default(true),
    updatedByPlatformAdminAccountId: text(
      "updated_by_platform_admin_account_id"
    ).references(() => platformAdminAccounts.id),
    ...timestamps
  },
  (table) => [
    primaryKey({
      name: "deployment_channel_provider_policies_pk",
      columns: [table.provider, table.channelType]
    }),
    index("deployment_channel_provider_policy_provider_idx").on(table.provider),
    index("deployment_channel_provider_policy_channel_idx").on(
      table.channelType
    )
  ]
);

export const deploymentChannelCatalogOverrides = pgTable(
  "deployment_channel_catalog_overrides",
  {
    channelType: text("channel_type").primaryKey(),
    titleOverrides: jsonb("title_overrides").notNull().default({}),
    shortDescriptionOverrides: jsonb("short_description_overrides")
      .notNull()
      .default({}),
    descriptionOverrides: jsonb("description_overrides").notNull().default({}),
    iconAssetRef: text("icon_asset_ref"),
    sortOrder: integer("sort_order"),
    visibility: text("visibility").notNull().default("visible"),
    readiness: text("readiness"),
    updatedByPlatformAdminAccountId: text(
      "updated_by_platform_admin_account_id"
    ).references(() => platformAdminAccounts.id),
    ...timestamps
  },
  (table) => [
    index("deployment_channel_catalog_override_visibility_idx").on(
      table.visibility
    ),
    index("deployment_channel_catalog_override_sort_idx").on(table.sortOrder),
    index("deployment_channel_catalog_override_readiness_idx").on(
      table.readiness
    )
  ]
);

export const moduleCatalog = pgTable(
  "module_catalog",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    name: text("name").notNull(),
    version: text("version").notNull(),
    manifest: jsonb("manifest").notNull(),
    ...timestamps
  },
  (table) => [index("module_catalog_type_idx").on(table.type)]
);

export const tenantSettings = pgTable(
  "tenant_settings",
  {
    tenantId: tenantIdColumn()
      .primaryKey()
      .references(() => tenants.id),
    locale: text("locale").notNull(),
    timezone: text("timezone").notNull(),
    region: text("region"),
    settings: jsonb("settings").notNull().default({})
  },
  (table) => [index("tenant_settings_tenant_idx").on(table.tenantId)]
);

export const tenantBrandProfiles = pgTable(
  "tenant_brand_profiles",
  {
    id: text("id").primaryKey(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    productName: text("product_name").notNull(),
    shortProductName: text("short_product_name"),
    assets: jsonb("assets").notNull().default({}),
    themeTokens: jsonb("theme_tokens").notNull().default({}),
    links: jsonb("links").notNull().default({}),
    ...timestamps
  },
  (table) => [index("tenant_brand_profiles_tenant_idx").on(table.tenantId)]
);

export const tenantBrandAssets = pgTable(
  "tenant_brand_assets",
  {
    id: text("id").primaryKey(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    kind: text("kind").notNull(),
    storageKey: text("storage_key").notNull(),
    mediaType: text("media_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    ...timestamps
  },
  (table) => [index("tenant_brand_assets_tenant_idx").on(table.tenantId)]
);

export const tenantModules = pgTable(
  "tenant_modules",
  {
    tenantId: tenantIdColumn().references(() => tenants.id),
    moduleId: text("module_id").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    config: jsonb("config").notNull().default({}),
    diagnostics: jsonb("diagnostics").notNull().default({}),
    ...timestamps
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.moduleId] }),
    index("tenant_modules_tenant_idx").on(table.tenantId)
  ]
);

export const channelConnectors = pgTable(
  "channel_connectors",
  {
    id: text("id").primaryKey(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    channelType: text("channel_type").notNull(),
    channelClass: text("channel_class").notNull(),
    provider: text("provider").notNull(),
    displayName: text("display_name").notNull(),
    status: text("status").notNull().default("onboarding"),
    healthStatus: text("health_status").notNull().default("unknown"),
    capabilities: jsonb("capabilities").notNull().default({}),
    onboardingState: jsonb("onboarding_state").notNull().default({}),
    config: jsonb("config").notNull().default({}),
    diagnostics: jsonb("diagnostics").notNull().default({}),
    sourceConnectionId: text("source_connection_id").references(
      () => sourceConnections.id
    ),
    createdByEmployeeId: text("created_by_employee_id"),
    ...timestamps
  },
  (table) => [
    index("channel_connectors_tenant_idx").on(table.tenantId),
    index("channel_connectors_tenant_type_idx").on(
      table.tenantId,
      table.channelType
    ),
    index("channel_connectors_tenant_status_idx").on(
      table.tenantId,
      table.status
    ),
    index("channel_connectors_tenant_source_connection_idx").on(
      table.tenantId,
      table.sourceConnectionId
    )
  ]
);

export const channelSessions = pgTable(
  "channel_sessions",
  {
    id: text("id").primaryKey(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    connectorId: text("connector_id")
      .notNull()
      .references(() => channelConnectors.id),
    sessionKey: text("session_key").notNull(),
    status: text("status").notNull().default("not_started"),
    sessionEncrypted: text("session_encrypted"),
    sessionFingerprint: text("session_fingerprint"),
    externalAccountId: text("external_account_id"),
    displayAddress: text("display_address"),
    publicState: jsonb("public_state").notNull().default({}),
    metadata: jsonb("metadata").notNull().default({}),
    challengeType: text("challenge_type"),
    challengeExpiresAt: timestamp("challenge_expires_at", {
      withTimezone: true
    }),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lastConnectedAt: timestamp("last_connected_at", { withTimezone: true }),
    lastDisconnectedAt: timestamp("last_disconnected_at", {
      withTimezone: true
    }),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    lastOutboundAt: timestamp("last_outbound_at", { withTimezone: true }),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    ...timestamps
  },
  (table) => [
    uniqueIndex("channel_sessions_tenant_connector_key_unique").on(
      table.tenantId,
      table.connectorId,
      table.sessionKey
    ),
    index("channel_sessions_tenant_idx").on(table.tenantId),
    index("channel_sessions_tenant_connector_idx").on(
      table.tenantId,
      table.connectorId
    ),
    index("channel_sessions_tenant_status_idx").on(
      table.tenantId,
      table.status
    ),
    index("channel_sessions_tenant_lease_idx").on(
      table.tenantId,
      table.status,
      table.leaseExpiresAt
    ),
    index("channel_sessions_tenant_heartbeat_idx").on(
      table.tenantId,
      table.lastHeartbeatAt
    )
  ]
);

export const channelSessionEvents = pgTable(
  "channel_session_events",
  {
    id: text("id").primaryKey(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    connectorId: text("connector_id")
      .notNull()
      .references(() => channelConnectors.id),
    sessionId: text("session_id")
      .notNull()
      .references(() => channelSessions.id),
    eventType: text("event_type").notNull(),
    severity: text("severity").notNull().default("info"),
    code: text("code"),
    message: text("message"),
    metadata: jsonb("metadata").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    ...timestamps
  },
  (table) => [
    index("channel_session_events_tenant_idx").on(table.tenantId),
    index("channel_session_events_tenant_connector_idx").on(
      table.tenantId,
      table.connectorId,
      table.occurredAt
    ),
    index("channel_session_events_tenant_session_idx").on(
      table.tenantId,
      table.sessionId,
      table.occurredAt
    )
  ]
);

export const channelAuthChallenges = pgTable(
  "channel_auth_challenges",
  {
    id: text("id").primaryKey(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    connectorId: text("connector_id")
      .notNull()
      .references(() => channelConnectors.id),
    challengeType: text("challenge_type").notNull(),
    status: text("status").notNull(),
    publicPayload: jsonb("public_payload").notNull().default({}),
    secretPayloadEncrypted: text("secret_payload_encrypted"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdByEmployeeId: text("created_by_employee_id"),
    ...timestamps
  },
  (table) => [
    index("channel_auth_challenges_tenant_idx").on(table.tenantId),
    index("channel_auth_challenges_tenant_connector_idx").on(
      table.tenantId,
      table.connectorId
    ),
    index("channel_auth_challenges_tenant_status_idx").on(
      table.tenantId,
      table.status
    ),
    index("channel_auth_challenges_tenant_created_idx").on(
      table.tenantId,
      table.createdAt
    )
  ]
);

export const channelProviderValidationJobs = pgTable(
  "channel_provider_validation_jobs",
  {
    id: text("id").primaryKey(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    channelType: text("channel_type").notNull(),
    provider: text("provider").notNull(),
    validationKind: text("validation_kind").notNull(),
    status: text("status").notNull().default("pending"),
    botTokenSecretRef: text("bot_token_secret_ref").notNull(),
    resultPayload: jsonb("result_payload").notNull().default({}),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdByEmployeeId: text("created_by_employee_id"),
    ...timestamps
  },
  (table) => [
    index("channel_provider_validation_jobs_tenant_idx").on(table.tenantId),
    index("channel_provider_validation_jobs_tenant_status_idx").on(
      table.tenantId,
      table.status
    ),
    index("channel_provider_validation_jobs_tenant_created_idx").on(
      table.tenantId,
      table.createdAt
    )
  ]
);

export const sourceConnections = pgTable(
  "source_connections",
  {
    id: text("id").primaryKey(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    sourceType: text("source_type").notNull(),
    sourceName: text("source_name").notNull(),
    displayName: text("display_name").notNull(),
    status: text("status").notNull().default("draft"),
    authType: text("auth_type").notNull().default("custom"),
    capabilities: jsonb("capabilities").notNull().default({}),
    config: jsonb("config").notNull().default({}),
    diagnostics: jsonb("diagnostics").notNull().default({}),
    metadata: jsonb("metadata").notNull().default({}),
    createdByEmployeeId: text("created_by_employee_id"),
    ...timestamps
  },
  (table) => [
    unique("source_connections_tenant_id_unique").on(table.tenantId, table.id),
    index("source_connections_tenant_idx").on(table.tenantId),
    index("source_connections_tenant_type_idx").on(
      table.tenantId,
      table.sourceType
    ),
    index("source_connections_tenant_source_idx").on(
      table.tenantId,
      table.sourceName
    ),
    index("source_connections_tenant_status_idx").on(
      table.tenantId,
      table.status
    )
  ]
);

export const sourceAccounts = pgTable(
  "source_accounts",
  {
    id: text("id").primaryKey(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    sourceConnectionId: text("source_connection_id")
      .notNull()
      .references(() => sourceConnections.id),
    externalAccountId: text("external_account_id"),
    externalAccountName: text("external_account_name"),
    accountType: text("account_type").notNull(),
    displayName: text("display_name").notNull(),
    status: text("status").notNull().default("active"),
    metadata: jsonb("metadata").notNull().default({}),
    ...timestamps
  },
  (table) => [
    unique("source_accounts_tenant_id_unique").on(table.tenantId, table.id),
    unique("source_accounts_tenant_id_connection_unique").on(
      table.tenantId,
      table.id,
      table.sourceConnectionId
    ),
    foreignKey({
      name: "source_accounts_tenant_connection_fk",
      columns: [table.tenantId, table.sourceConnectionId],
      foreignColumns: [sourceConnections.tenantId, sourceConnections.id]
    }),
    index("source_accounts_tenant_idx").on(table.tenantId),
    index("source_accounts_tenant_connection_idx").on(
      table.tenantId,
      table.sourceConnectionId
    ),
    index("source_accounts_tenant_external_idx").on(
      table.tenantId,
      table.externalAccountId
    ),
    uniqueIndex("source_accounts_tenant_connection_external_unique").on(
      table.tenantId,
      table.sourceConnectionId,
      table.externalAccountId
    )
  ]
);

export const rawInboundEvents = pgTable(
  "raw_inbound_events",
  {
    id: text("id").primaryKey(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    sourceConnectionId: text("source_connection_id")
      .notNull()
      .references(() => sourceConnections.id),
    sourceAccountId: text("source_account_id").references(
      () => sourceAccounts.id
    ),
    sourceAccountScopeKey: text("source_account_scope_key")
      .notNull()
      .generatedAlwaysAs(
        sql`case
          when source_account_id is null then '0:'
          else '1:' || octet_length(source_account_id)::text || ':' || source_account_id
        end`
      ),
    externalEventId: text("external_event_id"),
    eventSignature: text("event_signature"),
    idempotencyKey: text("idempotency_key").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    providerTimestamp: timestamp("provider_timestamp", { withTimezone: true }),
    payload: jsonb("payload").notNull(),
    headers: jsonb("headers").notNull().default({}),
    processingStatus: text("processing_status").notNull().default("new"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    ...timestamps
  },
  (table) => [
    unique("raw_inbound_events_tenant_id_unique").on(table.tenantId, table.id),
    unique("raw_inbound_events_tenant_id_connection_unique").on(
      table.tenantId,
      table.id,
      table.sourceConnectionId
    ),
    unique("raw_inbound_events_tenant_id_account_unique").on(
      table.tenantId,
      table.id,
      table.sourceAccountId
    ),
    unique("raw_inbound_events_tenant_id_account_scope_unique").on(
      table.tenantId,
      table.id,
      table.sourceAccountScopeKey
    ),
    foreignKey({
      name: "raw_inbound_events_tenant_connection_fk",
      columns: [table.tenantId, table.sourceConnectionId],
      foreignColumns: [sourceConnections.tenantId, sourceConnections.id]
    }),
    foreignKey({
      name: "raw_inbound_events_tenant_account_fk",
      columns: [table.tenantId, table.sourceAccountId],
      foreignColumns: [sourceAccounts.tenantId, sourceAccounts.id]
    }),
    foreignKey({
      name: "raw_inbound_events_account_connection_fk",
      columns: [
        table.tenantId,
        table.sourceAccountId,
        table.sourceConnectionId
      ],
      foreignColumns: [
        sourceAccounts.tenantId,
        sourceAccounts.id,
        sourceAccounts.sourceConnectionId
      ]
    }),
    uniqueIndex("raw_inbound_events_tenant_idempotency_unique").on(
      table.tenantId,
      table.idempotencyKey
    ),
    index("raw_inbound_events_tenant_idx").on(table.tenantId),
    index("raw_inbound_events_tenant_connection_idx").on(
      table.tenantId,
      table.sourceConnectionId,
      table.receivedAt
    ),
    index("raw_inbound_events_tenant_account_idx").on(
      table.tenantId,
      table.sourceAccountId,
      table.receivedAt
    ),
    index("raw_inbound_events_tenant_status_idx").on(
      table.tenantId,
      table.processingStatus
    )
  ]
);

export const normalizedInboundEvents = pgTable(
  "normalized_inbound_events",
  {
    id: text("id").primaryKey(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    rawEventId: text("raw_event_id")
      .notNull()
      .references(() => rawInboundEvents.id),
    sourceConnectionId: text("source_connection_id")
      .notNull()
      .references(() => sourceConnections.id),
    sourceAccountId: text("source_account_id").references(
      () => sourceAccounts.id
    ),
    sourceAccountScopeKey: text("source_account_scope_key")
      .notNull()
      .generatedAlwaysAs(
        sql`case
          when source_account_id is null then '0:'
          else '1:' || octet_length(source_account_id)::text || ':' || source_account_id
        end`
      ),
    sourceType: text("source_type").notNull(),
    sourceName: text("source_name").notNull(),
    eventType: text("event_type").notNull(),
    direction: text("direction").notNull(),
    visibility: text("visibility").notNull().default("private"),
    externalThreadId: text("external_thread_id"),
    externalMessageId: text("external_message_id"),
    externalUserId: text("external_user_id"),
    payloadVersion: text("payload_version").notNull().default("v1"),
    normalizedPayload: jsonb("normalized_payload").notNull().default({}),
    replyCapability: jsonb("reply_capability").notNull().default({}),
    conversationId: text("conversation_id"),
    messageId: text("message_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    processingStatus: text("processing_status").notNull().default("new"),
    ...timestamps
  },
  (table) => [
    unique("normalized_inbound_events_tenant_id_unique").on(
      table.tenantId,
      table.id
    ),
    unique("normalized_inbound_events_tenant_id_connection_unique").on(
      table.tenantId,
      table.id,
      table.sourceConnectionId
    ),
    unique("normalized_inbound_events_tenant_id_account_unique").on(
      table.tenantId,
      table.id,
      table.sourceAccountId
    ),
    foreignKey({
      name: "normalized_inbound_events_tenant_raw_fk",
      columns: [table.tenantId, table.rawEventId],
      foreignColumns: [rawInboundEvents.tenantId, rawInboundEvents.id]
    }),
    foreignKey({
      name: "normalized_inbound_events_tenant_connection_fk",
      columns: [table.tenantId, table.sourceConnectionId],
      foreignColumns: [sourceConnections.tenantId, sourceConnections.id]
    }),
    foreignKey({
      name: "normalized_inbound_events_tenant_account_fk",
      columns: [table.tenantId, table.sourceAccountId],
      foreignColumns: [sourceAccounts.tenantId, sourceAccounts.id]
    }),
    foreignKey({
      name: "normalized_inbound_events_account_connection_fk",
      columns: [
        table.tenantId,
        table.sourceAccountId,
        table.sourceConnectionId
      ],
      foreignColumns: [
        sourceAccounts.tenantId,
        sourceAccounts.id,
        sourceAccounts.sourceConnectionId
      ]
    }),
    foreignKey({
      name: "normalized_inbound_events_raw_connection_fk",
      columns: [table.tenantId, table.rawEventId, table.sourceConnectionId],
      foreignColumns: [
        rawInboundEvents.tenantId,
        rawInboundEvents.id,
        rawInboundEvents.sourceConnectionId
      ]
    }),
    foreignKey({
      name: "normalized_inbound_events_raw_account_scope_fk",
      columns: [table.tenantId, table.rawEventId, table.sourceAccountScopeKey],
      foreignColumns: [
        rawInboundEvents.tenantId,
        rawInboundEvents.id,
        rawInboundEvents.sourceAccountScopeKey
      ]
    }),
    uniqueIndex("normalized_inbound_events_tenant_idempotency_unique").on(
      table.tenantId,
      table.idempotencyKey
    ),
    index("normalized_inbound_events_tenant_idx").on(table.tenantId),
    index("normalized_inbound_events_tenant_raw_idx").on(
      table.tenantId,
      table.rawEventId
    ),
    index("normalized_inbound_events_tenant_connection_idx").on(
      table.tenantId,
      table.sourceConnectionId,
      table.createdAt
    ),
    index("normalized_inbound_events_tenant_account_idx").on(
      table.tenantId,
      table.sourceAccountId,
      table.createdAt
    ),
    index("normalized_inbound_events_tenant_thread_idx").on(
      table.tenantId,
      table.externalThreadId
    ),
    index("normalized_inbound_events_tenant_status_idx").on(
      table.tenantId,
      table.processingStatus
    )
  ]
);

export const tenantSecrets = pgTable(
  "tenant_secrets",
  {
    tenantId: tenantIdColumn().references(() => tenants.id),
    secretRef: text("secret_ref").notNull(),
    purpose: text("purpose").notNull(),
    encryptedValue: text("encrypted_value").notNull(),
    encryptionKeyRef: text("encryption_key_ref").notNull().default("local"),
    ...timestamps
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.secretRef] }),
    index("tenant_secrets_tenant_idx").on(table.tenantId),
    index("tenant_secrets_tenant_purpose_idx").on(table.tenantId, table.purpose)
  ]
);

export const tenantEntitlements = pgTable(
  "tenant_entitlements",
  {
    tenantId: tenantIdColumn().references(() => tenants.id),
    key: text("key").notNull(),
    value: text("value").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    source: text("source").notNull().default("license"),
    ...timestamps
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.key, table.value] }),
    index("tenant_entitlements_tenant_idx").on(table.tenantId)
  ]
);

export const tenantUsagePolicies = pgTable(
  "tenant_usage_policies",
  {
    tenantId: tenantIdColumn().references(() => tenants.id),
    entitlement: text("entitlement").notNull(),
    included: integer("included").notNull(),
    softLimit: integer("soft_limit"),
    hardLimit: integer("hard_limit"),
    resetPeriod: text("reset_period").notNull().default("monthly"),
    ...timestamps
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.entitlement] }),
    index("tenant_usage_policies_tenant_idx").on(table.tenantId)
  ]
);

export const usageRecords = pgTable(
  "usage_records",
  {
    id: text("id").primaryKey(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    entitlement: text("entitlement").notNull(),
    quantity: integer("quantity").notNull(),
    periodKey: text("period_key").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    ...timestamps
  },
  (table) => [
    uniqueIndex("usage_records_idempotency_unique").on(
      table.tenantId,
      table.idempotencyKey
    ),
    index("usage_records_tenant_period_idx").on(table.tenantId, table.periodKey)
  ]
);

export const usagePeriodSummaries = pgTable(
  "usage_period_summaries",
  {
    tenantId: tenantIdColumn().references(() => tenants.id),
    entitlement: text("entitlement").notNull(),
    periodKey: text("period_key").notNull(),
    used: integer("used").notNull().default(0),
    ...timestamps
  },
  (table) => [
    primaryKey({
      columns: [table.tenantId, table.entitlement, table.periodKey]
    }),
    index("usage_period_summaries_tenant_idx").on(table.tenantId)
  ]
);

export const tenantApiKeys = pgTable(
  "tenant_api_keys",
  {
    id: text("id").primaryKey(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => [index("tenant_api_keys_tenant_idx").on(table.tenantId)]
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    email: text("email").notNull(),
    passwordHash: text("password_hash"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    unique("accounts_tenant_id_unique").on(table.tenantId, table.id),
    uniqueIndex("accounts_tenant_email_unique").on(table.tenantId, table.email),
    index("accounts_tenant_idx").on(table.tenantId)
  ]
);

export const authEmailVerificationTokens = pgTable(
  "auth_email_verification_tokens",
  {
    id: text("id").primaryKey(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    email: text("email"),
    tokenHash: text("token_hash").notNull(),
    purpose: text("purpose").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    uniqueIndex("auth_email_tokens_tenant_token_unique").on(
      table.tenantId,
      table.tokenHash
    ),
    index("auth_email_tokens_tenant_account_idx").on(
      table.tenantId,
      table.accountId
    )
  ]
);

export const externalIdentityLinks = pgTable(
  "external_identity_links",
  {
    id: text("id").primaryKey(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    providerId: text("provider_id").notNull(),
    externalSubject: text("external_subject").notNull(),
    email: text("email"),
    displayName: text("display_name"),
    emailVerified: boolean("email_verified").notNull().default(false),
    profile: jsonb("profile").notNull().default({}),
    ...timestamps
  },
  (table) => [
    uniqueIndex("external_identity_tenant_provider_subject_unique").on(
      table.tenantId,
      table.providerId,
      table.externalSubject
    ),
    index("external_identity_tenant_account_idx").on(
      table.tenantId,
      table.accountId
    )
  ]
);

export const employees = pgTable(
  "employees",
  {
    id: text("id").primaryKey(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    accountId: text("account_id").references(() => accounts.id),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    profile: jsonb("profile").notNull().default({}),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    unique("employees_tenant_id_unique").on(table.tenantId, table.id),
    index("employees_tenant_idx").on(table.tenantId),
    index("employees_tenant_status_idx").on(table.tenantId, table.deactivatedAt)
  ]
);

export const tenantRoles = pgTable(
  "tenant_roles",
  {
    id: text("id").primaryKey(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull().default("active"),
    isSystem: boolean("is_system").notNull().default(false),
    createdByEmployeeId: text("created_by_employee_id").references(
      () => employees.id
    ),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    uniqueIndex("tenant_roles_tenant_name_unique").on(
      table.tenantId,
      table.name
    ),
    index("tenant_roles_tenant_idx").on(table.tenantId),
    index("tenant_roles_tenant_status_idx").on(table.tenantId, table.status)
  ]
);

export const tenantRolePermissions = pgTable(
  "tenant_role_permissions",
  {
    tenantId: tenantIdColumn().references(() => tenants.id),
    roleId: text("role_id")
      .notNull()
      .references(() => tenantRoles.id),
    permission: text("permission").notNull(),
    ...timestamps
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.roleId, table.permission] }),
    index("tenant_role_permissions_tenant_idx").on(table.tenantId),
    index("tenant_role_permissions_tenant_role_idx").on(
      table.tenantId,
      table.roleId
    )
  ]
);

export const tenantRoleBindings = pgTable(
  "tenant_role_bindings",
  {
    id: text("id").primaryKey(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    roleId: text("role_id")
      .notNull()
      .references(() => tenantRoles.id),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    scopeType: text("scope_type").notNull(),
    scopeId: text("scope_id"),
    createdByEmployeeId: text("created_by_employee_id").references(
      () => employees.id
    ),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    index("tenant_role_bindings_tenant_idx").on(table.tenantId),
    index("tenant_role_bindings_tenant_role_idx").on(
      table.tenantId,
      table.roleId
    ),
    index("tenant_role_bindings_tenant_subject_idx").on(
      table.tenantId,
      table.subjectType,
      table.subjectId
    ),
    index("tenant_role_bindings_tenant_active_idx").on(
      table.tenantId,
      table.revokedAt,
      table.expiresAt
    )
  ]
);

export const directPermissionGrants = pgTable(
  "direct_permission_grants",
  {
    id: text("id").primaryKey(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    permission: text("permission").notNull(),
    scopeType: text("scope_type").notNull(),
    scopeId: text("scope_id"),
    reason: text("reason").notNull(),
    createdByEmployeeId: text("created_by_employee_id").references(
      () => employees.id
    ),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    index("direct_permission_grants_tenant_idx").on(table.tenantId),
    index("direct_permission_grants_tenant_employee_idx").on(
      table.tenantId,
      table.employeeId
    ),
    index("direct_permission_grants_tenant_permission_idx").on(
      table.tenantId,
      table.permission
    ),
    index("direct_permission_grants_tenant_active_idx").on(
      table.tenantId,
      table.revokedAt,
      table.expiresAt
    )
  ]
);

export const employeeInvitations = pgTable(
  "employee_invitations",
  {
    id: text("id").primaryKey(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    email: text("email").notNull(),
    displayName: text("display_name"),
    tokenHash: text("token_hash").notNull(),
    invitedByEmployeeId: text("invited_by_employee_id")
      .notNull()
      .references(() => employees.id),
    acceptedEmployeeId: text("accepted_employee_id").references(
      () => employees.id
    ),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    uniqueIndex("employee_invitations_token_unique").on(table.tokenHash),
    index("employee_invitations_tenant_email_idx").on(
      table.tenantId,
      table.email
    ),
    index("employee_invitations_tenant_status_idx").on(
      table.tenantId,
      table.acceptedAt,
      table.revokedAt
    )
  ]
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    sessionHash: text("session_hash").notNull(),
    tenantId: text("tenant_id").references(() => tenants.id),
    employeeId: text("employee_id").references(() => employees.id),
    platformAdminAccountId: text("platform_admin_account_id").references(
      () => platformAdminAccounts.id
    ),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    uniqueIndex("sessions_session_hash_unique").on(table.sessionHash),
    index("sessions_tenant_employee_idx").on(table.tenantId, table.employeeId),
    index("sessions_platform_admin_idx").on(table.platformAdminAccountId),
    index("sessions_expires_idx").on(table.expiresAt)
  ]
);

export const authRateLimitBuckets = pgTable(
  "auth_rate_limit_buckets",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull(),
    resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [index("auth_rate_limit_buckets_reset_idx").on(table.resetAt)]
);

export const teams = pgTable(
  "teams",
  {
    id: text("id").primaryKey(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    name: text("name").notNull(),
    ...timestamps
  },
  (table) => [
    unique("teams_tenant_id_unique").on(table.tenantId, table.id),
    index("teams_tenant_idx").on(table.tenantId)
  ]
);

export const orgUnits = pgTable(
  "org_units",
  {
    id: text("id").primaryKey(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    parentOrgUnitId: text("parent_org_unit_id"),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("active"),
    ...timestamps
  },
  (table) => [
    unique("org_units_tenant_id_unique").on(table.tenantId, table.id),
    uniqueIndex("org_units_tenant_name_unique").on(table.tenantId, table.name),
    index("org_units_tenant_idx").on(table.tenantId),
    index("org_units_tenant_parent_idx").on(
      table.tenantId,
      table.parentOrgUnitId
    ),
    index("org_units_tenant_status_idx").on(table.tenantId, table.status)
  ]
);

export const workQueues = pgTable(
  "work_queues",
  {
    id: text("id").primaryKey(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    owningOrgUnitId: text("owning_org_unit_id"),
    status: text("status").notNull().default("active"),
    routingConfig: jsonb("routing_config").notNull().default({}),
    ...timestamps
  },
  (table) => [
    unique("work_queues_tenant_id_unique").on(table.tenantId, table.id),
    uniqueIndex("work_queues_tenant_name_unique").on(
      table.tenantId,
      table.name
    ),
    index("work_queues_tenant_idx").on(table.tenantId),
    index("work_queues_tenant_kind_idx").on(table.tenantId, table.kind),
    index("work_queues_tenant_org_unit_idx").on(
      table.tenantId,
      table.owningOrgUnitId
    ),
    index("work_queues_tenant_status_idx").on(table.tenantId, table.status)
  ]
);

export const employeeOrgUnitMemberships = pgTable(
  "employee_org_unit_memberships",
  {
    tenantId: tenantIdColumn().references(() => tenants.id),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    orgUnitId: text("org_unit_id")
      .notNull()
      .references(() => orgUnits.id),
    ...timestamps
  },
  (table) => [
    primaryKey({
      columns: [table.tenantId, table.employeeId, table.orgUnitId]
    }),
    index("employee_org_unit_memberships_tenant_idx").on(table.tenantId),
    index("employee_org_unit_memberships_tenant_employee_idx").on(
      table.tenantId,
      table.employeeId
    ),
    index("employee_org_unit_memberships_tenant_org_unit_idx").on(
      table.tenantId,
      table.orgUnitId
    )
  ]
);

export const employeeWorkQueueMemberships = pgTable(
  "employee_work_queue_memberships",
  {
    tenantId: tenantIdColumn().references(() => tenants.id),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    workQueueId: text("work_queue_id")
      .notNull()
      .references(() => workQueues.id),
    ...timestamps
  },
  (table) => [
    primaryKey({
      columns: [table.tenantId, table.employeeId, table.workQueueId]
    }),
    index("employee_work_queue_memberships_tenant_idx").on(table.tenantId),
    index("employee_work_queue_memberships_tenant_employee_idx").on(
      table.tenantId,
      table.employeeId
    ),
    index("employee_work_queue_memberships_tenant_work_queue_idx").on(
      table.tenantId,
      table.workQueueId
    )
  ]
);

export const employeeTeamMemberships = pgTable(
  "employee_team_memberships",
  {
    tenantId: tenantIdColumn().references(() => tenants.id),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id),
    status: text("status").notNull().default("active"),
    roleLabel: text("role_label"),
    ...timestamps
  },
  (table) => [
    primaryKey({
      columns: [table.tenantId, table.employeeId, table.teamId]
    }),
    index("employee_team_memberships_tenant_idx").on(table.tenantId),
    index("employee_team_memberships_tenant_employee_idx").on(
      table.tenantId,
      table.employeeId
    ),
    index("employee_team_memberships_tenant_team_idx").on(
      table.tenantId,
      table.teamId
    ),
    index("employee_team_memberships_tenant_status_idx").on(
      table.tenantId,
      table.status
    )
  ]
);

export const clients = pgTable(
  "clients",
  {
    id: text("id").primaryKey(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    displayName: text("display_name").notNull(),
    source: text("source").notNull(),
    responsibleEmployeeId: text("responsible_employee_id").references(
      () => employees.id
    ),
    ...timestamps
  },
  (table) => [
    unique("clients_tenant_id_unique").on(table.tenantId, table.id),
    index("clients_tenant_idx").on(table.tenantId)
  ]
);

export const clientContacts = pgTable(
  "client_contacts",
  {
    id: text("id").primaryKey(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id),
    type: text("type").notNull(),
    value: text("value").notNull(),
    ...timestamps
  },
  (table) => [
    unique("client_contacts_tenant_id_unique").on(table.tenantId, table.id),
    foreignKey({
      name: "client_contacts_tenant_client_fk",
      columns: [table.tenantId, table.clientId],
      foreignColumns: [clients.tenantId, clients.id]
    }),
    index("client_contacts_tenant_client_idx").on(
      table.tenantId,
      table.clientId
    ),
    index("client_contacts_tenant_value_idx").on(table.tenantId, table.value)
  ]
);

export const inboxV2Conversations = pgTable(
  "inbox_v2_conversations",
  {
    tenantId: tenantIdColumn().references(() => tenants.id),
    id: text("id").notNull(),
    topology: inboxV2ConversationTopology("topology").notNull(),
    transport: inboxV2ConversationTransport("transport").notNull(),
    purposeId: text("purpose_id").notNull(),
    lifecycle: inboxV2ConversationLifecycle("lifecycle")
      .notNull()
      .default("active"),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`),
    lastChangedStreamPosition: bigint("last_changed_stream_position", {
      mode: "bigint"
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_conversations_pk",
      columns: [table.tenantId, table.id]
    }),
    unique("inbox_v2_conversations_tenant_id_shape_unique").on(
      table.tenantId,
      table.id,
      table.transport,
      table.topology
    ),
    check(
      "inbox_v2_conversations_purpose_format_check",
      sql`char_length(${table.purposeId}) <= 256 and (
        (
          ${table.purposeId} ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
          and char_length(split_part(${table.purposeId}, ':', 2)) <= 160
        ) or (
          ${table.purposeId} ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
          and char_length(split_part(${table.purposeId}, ':', 2)) <= 80
          and char_length(split_part(${table.purposeId}, ':', 3)) <= 160
          and split_part(${table.purposeId}, ':', 2) not in (
            'core', 'hulee', 'module', 'platform', 'system'
          )
        )
      )`
    ),
    check("inbox_v2_conversations_revision_check", sql`${table.revision} >= 1`),
    check(
      "inbox_v2_conversations_stream_position_check",
      sql`${table.lastChangedStreamPosition} >= 1`
    ),
    check(
      "inbox_v2_conversations_timestamps_check",
      sql`isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}`
    ),
    index("inbox_v2_conversations_tenant_lifecycle_updated_idx").on(
      table.tenantId,
      table.lifecycle,
      table.updatedAt.desc(),
      table.id
    ),
    index("inbox_v2_conversations_tenant_shape_updated_idx").on(
      table.tenantId,
      table.transport,
      table.topology,
      table.lifecycle,
      table.updatedAt.desc(),
      table.id
    ),
    index("inbox_v2_conversations_tenant_purpose_updated_idx").on(
      table.tenantId,
      table.purposeId,
      table.lifecycle,
      table.updatedAt.desc(),
      table.id
    )
  ]
);

export const inboxV2ConversationHeads = pgTable(
  "inbox_v2_conversation_heads",
  {
    tenantId: tenantIdColumn().references(() => tenants.id),
    conversationId: text("conversation_id").notNull(),
    latestTimelineSequence: bigint("latest_timeline_sequence", {
      mode: "bigint"
    })
      .notNull()
      .default(sql`0`),
    latestActivityItemId: text("latest_activity_item_id"),
    latestActivityTimelineSequence: bigint(
      "latest_activity_timeline_sequence",
      { mode: "bigint" }
    ),
    latestActivityAt: timestamp("latest_activity_at", {
      withTimezone: true,
      precision: 3
    }),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`),
    lastChangedStreamPosition: bigint("last_changed_stream_position", {
      mode: "bigint"
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_conversation_heads_pk",
      columns: [table.tenantId, table.conversationId]
    }),
    foreignKey({
      name: "inbox_v2_conversation_heads_conversation_fk",
      columns: [table.tenantId, table.conversationId],
      foreignColumns: [inboxV2Conversations.tenantId, inboxV2Conversations.id]
    }).onDelete("cascade"),
    check(
      "inbox_v2_conversation_heads_timeline_sequence_check",
      sql`${table.latestTimelineSequence} >= 0`
    ),
    check(
      "inbox_v2_conversation_heads_activity_tuple_check",
      sql`(
        ${table.latestActivityItemId} is null
        and ${table.latestActivityTimelineSequence} is null
        and ${table.latestActivityAt} is null
      ) or (
        ${table.latestActivityItemId} is not null
        and ${table.latestActivityTimelineSequence} is not null
        and ${table.latestActivityAt} is not null
      )`
    ),
    check(
      "inbox_v2_conversation_heads_activity_item_check",
      sql`${table.latestActivityItemId} is null or (
        char_length(${table.latestActivityItemId}) <= 256
        and ${table.latestActivityItemId} ~ '^timeline_item:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'
      )`
    ),
    check(
      "inbox_v2_conversation_heads_activity_sequence_check",
      sql`${table.latestActivityTimelineSequence} is null or (
        ${table.latestActivityTimelineSequence} >= 1
        and ${table.latestActivityTimelineSequence} <= ${table.latestTimelineSequence}
      )`
    ),
    check(
      "inbox_v2_conversation_heads_revision_check",
      sql`${table.revision} >= 1`
    ),
    check(
      "inbox_v2_conversation_heads_stream_position_check",
      sql`${table.lastChangedStreamPosition} >= 1`
    ),
    check(
      "inbox_v2_conversation_heads_timestamps_check",
      sql`isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and (${table.latestActivityAt} is null or isfinite(${table.latestActivityAt}))
        and ${table.updatedAt} >= ${table.createdAt}`
    ),
    index("inbox_v2_conversation_heads_tenant_activity_idx").on(
      table.tenantId,
      table.latestActivityAt.desc().nullsLast(),
      table.conversationId
    ),
    index("inbox_v2_conversation_heads_tenant_updated_idx").on(
      table.tenantId,
      table.updatedAt.desc(),
      table.conversationId
    ),
    index("inbox_v2_conversation_heads_tenant_stream_idx").on(
      table.tenantId,
      table.lastChangedStreamPosition,
      table.conversationId
    )
  ]
);

/**
 * Minimal identity anchor retained after a Conversation hard-delete. It has no
 * FK back to Conversation by design: the row prevents a retired canonical ID
 * from being reused with reset revisions or stream positions.
 */
export const inboxV2ConversationIdentityFences = pgTable(
  "inbox_v2_conversation_identity_fences",
  {
    tenantId: tenantIdColumn().references(() => tenants.id, {
      onDelete: "cascade"
    }),
    conversationId: text("conversation_id").notNull(),
    retiredRevision: bigint("retired_revision", { mode: "bigint" }).notNull(),
    retiredStreamPosition: bigint("retired_stream_position", {
      mode: "bigint"
    }).notNull(),
    retiredUpdatedAt: timestamp("retired_updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    retiredAt: timestamp("retired_at", {
      withTimezone: true,
      precision: 3
    })
      .notNull()
      .defaultNow()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_conversation_identity_fences_pk",
      columns: [table.tenantId, table.conversationId]
    }),
    check(
      "inbox_v2_conversation_identity_fences_values_check",
      sql`${table.retiredRevision} >= 1
        and ${table.retiredStreamPosition} >= 1
        and isfinite(${table.retiredUpdatedAt})
        and isfinite(${table.retiredAt})`
    ),
    index("inbox_v2_conversation_identity_fences_tenant_retired_idx").on(
      table.tenantId,
      table.retiredAt,
      table.conversationId
    )
  ]
);

export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    type: conversationType("type").notNull(),
    clientId: text("client_id").references(() => clients.id),
    currentQueueId: text("current_queue_id").references(() => workQueues.id),
    assignedEmployeeId: text("assigned_employee_id").references(
      () => employees.id
    ),
    assignedTeamId: text("assigned_team_id").references(() => teams.id),
    status: text("status").notNull().default("open"),
    ...timestamps
  },
  (table) => [
    index("conversations_tenant_idx").on(table.tenantId),
    index("conversations_tenant_queue_idx").on(
      table.tenantId,
      table.currentQueueId
    ),
    index("conversations_tenant_assigned_employee_idx").on(
      table.tenantId,
      table.assignedEmployeeId
    ),
    index("conversations_tenant_assigned_team_idx").on(
      table.tenantId,
      table.assignedTeamId
    )
  ]
);

export const conversationParticipants = pgTable(
  "conversation_participants",
  {
    tenantId: tenantIdColumn().references(() => tenants.id),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    ...timestamps
  },
  (table) => [
    primaryKey({
      columns: [table.tenantId, table.conversationId, table.employeeId]
    }),
    index("conversation_participants_tenant_idx").on(table.tenantId)
  ]
);

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id),
    direction: messageDirection("direction").notNull(),
    text: text("text"),
    status: messageStatus("status").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    errorCode: text("error_code"),
    ...timestamps
  },
  (table) => [
    uniqueIndex("messages_tenant_idempotency_unique").on(
      table.tenantId,
      table.idempotencyKey
    ),
    index("messages_tenant_conversation_idx").on(
      table.tenantId,
      table.conversationId
    )
  ]
);

export const messageDeliveryAttempts = pgTable(
  "message_delivery_attempts",
  {
    id: text("id").primaryKey(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id),
    status: text("status").notNull(),
    providerMessageId: text("provider_message_id"),
    errorCode: text("error_code"),
    retryable: boolean("retryable"),
    ...timestamps
  },
  (table) => [
    index("message_delivery_attempts_tenant_message_idx").on(
      table.tenantId,
      table.messageId
    )
  ]
);

export const files = pgTable(
  "files",
  {
    id: text("id").primaryKey(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    storageKey: text("storage_key").notNull(),
    fileName: text("file_name").notNull(),
    mediaType: text("media_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    status: text("status").notNull().default("stored"),
    metadata: jsonb("metadata").notNull().default({}),
    ...timestamps
  },
  (table) => [
    unique("files_tenant_id_unique").on(table.tenantId, table.id),
    uniqueIndex("files_tenant_storage_key_unique").on(
      table.tenantId,
      table.storageKey
    ),
    index("files_tenant_idx").on(table.tenantId)
  ]
);

export const messageAttachments = pgTable(
  "message_attachments",
  {
    id: text("id").primaryKey(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id),
    fileId: text("file_id")
      .notNull()
      .references(() => files.id),
    provider: text("provider").notNull(),
    providerAttachmentId: text("provider_attachment_id"),
    sourceUrl: text("source_url"),
    sortOrder: integer("sort_order").notNull().default(0),
    metadata: jsonb("metadata").notNull().default({}),
    ...timestamps
  },
  (table) => [
    index("message_attachments_tenant_message_idx").on(
      table.tenantId,
      table.messageId
    ),
    index("message_attachments_tenant_file_idx").on(
      table.tenantId,
      table.fileId
    )
  ]
);

export const eventStore = pgTable(
  "event_store",
  {
    id: text("id").primaryKey(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    type: text("type").notNull(),
    version: text("version").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    idempotencyKey: text("idempotency_key"),
    payload: jsonb("payload").notNull(),
    ...timestamps
  },
  (table) => [
    unique("event_store_tenant_id_unique").on(table.tenantId, table.id),
    index("event_store_tenant_type_idx").on(table.tenantId, table.type),
    index("event_store_tenant_occurred_idx").on(
      table.tenantId,
      table.occurredAt
    )
  ]
);

export const outbox = pgTable(
  "outbox",
  {
    id: text("id").primaryKey(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    eventId: text("event_id")
      .notNull()
      .references(() => eventStore.id),
    status: outboxStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    payload: jsonb("payload").notNull(),
    ...timestamps
  },
  (table) => [
    index("outbox_tenant_status_idx").on(table.tenantId, table.status),
    index("outbox_tenant_next_attempt_idx").on(
      table.tenantId,
      table.nextAttemptAt
    )
  ]
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    actorEmployeeId: text("actor_employee_id").references(() => employees.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    ...timestamps
  },
  (table) => [
    index("audit_log_tenant_entity_idx").on(
      table.tenantId,
      table.entityType,
      table.entityId
    )
  ]
);

export const webhookSubscriptions = pgTable(
  "webhook_subscriptions",
  {
    id: text("id").primaryKey(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    url: text("url").notNull(),
    events: jsonb("events").notNull(),
    secretRef: text("secret_ref"),
    enabled: boolean("enabled").notNull().default(true),
    ...timestamps
  },
  (table) => [index("webhook_subscriptions_tenant_idx").on(table.tenantId)]
);

export const integrationDiagnostics = pgTable(
  "integration_diagnostics",
  {
    id: text("id").primaryKey(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    moduleId: text("module_id").notNull(),
    status: text("status").notNull(),
    lastErrorCode: text("last_error_code"),
    details: jsonb("details").notNull().default({}),
    ...timestamps
  },
  (table) => [
    index("integration_diagnostics_tenant_module_idx").on(
      table.tenantId,
      table.moduleId
    )
  ]
);

export const notificationEndpoints = pgTable(
  "notification_endpoints",
  {
    id: text("id").primaryKey(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    clientKind: text("client_kind").notNull(),
    endpointTokenHash: text("endpoint_token_hash").notNull(),
    appVersion: text("app_version").notNull(),
    ...timestamps
  },
  (table) => [
    index("notification_endpoints_tenant_employee_idx").on(
      table.tenantId,
      table.employeeId
    )
  ]
);

export const notificationEvents = pgTable(
  "notification_events",
  {
    id: text("id").primaryKey(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    eventType: text("event_type").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    payload: jsonb("payload").notNull(),
    ...timestamps
  },
  (table) => [
    uniqueIndex("notification_events_tenant_dedupe_unique").on(
      table.tenantId,
      table.dedupeKey
    ),
    index("notification_events_tenant_employee_idx").on(
      table.tenantId,
      table.employeeId
    )
  ]
);
