import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
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

export const platformAdminAccounts = pgTable("platform_admin_accounts", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  ...timestamps
});

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
    ...timestamps
  },
  (table) => [
    uniqueIndex("accounts_tenant_email_unique").on(table.tenantId, table.email),
    index("accounts_tenant_idx").on(table.tenantId)
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
    ...timestamps
  },
  (table) => [index("employees_tenant_idx").on(table.tenantId)]
);

export const employeeRoles = pgTable(
  "employee_roles",
  {
    tenantId: tenantIdColumn().references(() => tenants.id),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    role: text("role").notNull(),
    ...timestamps
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.employeeId, table.role] }),
    index("employee_roles_tenant_idx").on(table.tenantId)
  ]
);

export const teams = pgTable(
  "teams",
  {
    id: text("id").primaryKey(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    name: text("name").notNull(),
    ...timestamps
  },
  (table) => [index("teams_tenant_idx").on(table.tenantId)]
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
  (table) => [index("clients_tenant_idx").on(table.tenantId)]
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
    index("client_contacts_tenant_client_idx").on(
      table.tenantId,
      table.clientId
    ),
    index("client_contacts_tenant_value_idx").on(table.tenantId, table.value)
  ]
);

export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    type: conversationType("type").notNull(),
    clientId: text("client_id").references(() => clients.id),
    status: text("status").notNull().default("open"),
    ...timestamps
  },
  (table) => [index("conversations_tenant_idx").on(table.tenantId)]
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
    ...timestamps
  },
  (table) => [
    uniqueIndex("files_tenant_storage_key_unique").on(
      table.tenantId,
      table.storageKey
    ),
    index("files_tenant_idx").on(table.tenantId)
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
