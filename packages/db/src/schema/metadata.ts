export type TableScope = "global" | "tenant";

export type TableDefinition = {
  name: string;
  scope: TableScope;
  requiresTenantId: boolean;
};

export const initialTables = [
  { name: "tenants", scope: "global", requiresTenantId: false },
  { name: "tenant_domains", scope: "global", requiresTenantId: false },
  { name: "platform_admin_accounts", scope: "global", requiresTenantId: false },
  { name: "platform_audit_log", scope: "global", requiresTenantId: false },
  {
    name: "deployment_egress_status_snapshots",
    scope: "global",
    requiresTenantId: false
  },
  {
    name: "deployment_egress_provider_policies",
    scope: "global",
    requiresTenantId: false
  },
  {
    name: "deployment_channel_provider_policies",
    scope: "global",
    requiresTenantId: false
  },
  {
    name: "deployment_channel_catalog_overrides",
    scope: "global",
    requiresTenantId: false
  },
  { name: "module_catalog", scope: "global", requiresTenantId: false },
  { name: "tenant_settings", scope: "tenant", requiresTenantId: true },
  { name: "tenant_brand_profiles", scope: "tenant", requiresTenantId: true },
  { name: "tenant_brand_assets", scope: "tenant", requiresTenantId: true },
  { name: "tenant_modules", scope: "tenant", requiresTenantId: true },
  { name: "channel_connectors", scope: "tenant", requiresTenantId: true },
  { name: "channel_sessions", scope: "tenant", requiresTenantId: true },
  { name: "channel_session_events", scope: "tenant", requiresTenantId: true },
  {
    name: "channel_auth_challenges",
    scope: "tenant",
    requiresTenantId: true
  },
  {
    name: "channel_provider_validation_jobs",
    scope: "tenant",
    requiresTenantId: true
  },
  { name: "source_connections", scope: "tenant", requiresTenantId: true },
  { name: "source_accounts", scope: "tenant", requiresTenantId: true },
  { name: "raw_inbound_events", scope: "tenant", requiresTenantId: true },
  {
    name: "normalized_inbound_events",
    scope: "tenant",
    requiresTenantId: true
  },
  { name: "tenant_secrets", scope: "tenant", requiresTenantId: true },
  { name: "tenant_entitlements", scope: "tenant", requiresTenantId: true },
  { name: "tenant_usage_policies", scope: "tenant", requiresTenantId: true },
  { name: "usage_records", scope: "tenant", requiresTenantId: true },
  { name: "usage_period_summaries", scope: "tenant", requiresTenantId: true },
  { name: "tenant_api_keys", scope: "tenant", requiresTenantId: true },
  { name: "accounts", scope: "tenant", requiresTenantId: true },
  {
    name: "auth_email_verification_tokens",
    scope: "tenant",
    requiresTenantId: true
  },
  { name: "external_identity_links", scope: "tenant", requiresTenantId: true },
  { name: "employees", scope: "tenant", requiresTenantId: true },
  { name: "tenant_roles", scope: "tenant", requiresTenantId: true },
  { name: "tenant_role_permissions", scope: "tenant", requiresTenantId: true },
  { name: "tenant_role_bindings", scope: "tenant", requiresTenantId: true },
  {
    name: "direct_permission_grants",
    scope: "tenant",
    requiresTenantId: true
  },
  { name: "employee_invitations", scope: "tenant", requiresTenantId: true },
  { name: "sessions", scope: "global", requiresTenantId: false },
  {
    name: "auth_rate_limit_buckets",
    scope: "global",
    requiresTenantId: false
  },
  { name: "teams", scope: "tenant", requiresTenantId: true },
  { name: "org_units", scope: "tenant", requiresTenantId: true },
  { name: "work_queues", scope: "tenant", requiresTenantId: true },
  {
    name: "employee_org_unit_memberships",
    scope: "tenant",
    requiresTenantId: true
  },
  {
    name: "employee_work_queue_memberships",
    scope: "tenant",
    requiresTenantId: true
  },
  {
    name: "employee_team_memberships",
    scope: "tenant",
    requiresTenantId: true
  },
  { name: "clients", scope: "tenant", requiresTenantId: true },
  { name: "client_contacts", scope: "tenant", requiresTenantId: true },
  { name: "conversations", scope: "tenant", requiresTenantId: true },
  {
    name: "conversation_participants",
    scope: "tenant",
    requiresTenantId: true
  },
  { name: "messages", scope: "tenant", requiresTenantId: true },
  {
    name: "message_delivery_attempts",
    scope: "tenant",
    requiresTenantId: true
  },
  { name: "files", scope: "tenant", requiresTenantId: true },
  { name: "message_attachments", scope: "tenant", requiresTenantId: true },
  { name: "event_store", scope: "tenant", requiresTenantId: true },
  { name: "outbox", scope: "tenant", requiresTenantId: true },
  { name: "audit_log", scope: "tenant", requiresTenantId: true },
  { name: "webhook_subscriptions", scope: "tenant", requiresTenantId: true },
  { name: "integration_diagnostics", scope: "tenant", requiresTenantId: true },
  { name: "notification_endpoints", scope: "tenant", requiresTenantId: true },
  { name: "notification_events", scope: "tenant", requiresTenantId: true }
] as const satisfies readonly TableDefinition[];
