import { sql, type SQLWrapper } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex
} from "drizzle-orm/pg-core";

import {
  clients,
  employees,
  inboxV2Conversations,
  orgUnits,
  sourceAccounts,
  teams,
  tenants,
  workQueues
} from "../tables";
import { inboxV2ParticipantMembershipTransitions } from "./participant-membership";
import {
  inboxV2WorkItemRelationTransitions,
  inboxV2WorkItemTransitions,
  inboxV2WorkItems
} from "./work-item";

export const inboxV2AuthorizationActorKind = pgEnum(
  "inbox_v2_auth_actor_kind",
  ["employee", "trusted_service"]
);

export const inboxV2AuthorizationRecordState = pgEnum(
  "inbox_v2_auth_record_state",
  ["active", "revoked", "archived"]
);

export const inboxV2AuthorizationRoleBindingSubjectKind = pgEnum(
  "inbox_v2_auth_binding_subject_kind",
  ["employee", "team", "org_unit", "queue"]
);

export const inboxV2AuthorizationScopeKind = pgEnum(
  "inbox_v2_auth_scope_kind",
  [
    "tenant",
    "org_unit",
    "team",
    "queue",
    "client",
    "conversation",
    "work_item",
    "source_account",
    "responsible",
    "collaborator",
    "internal_participant",
    "client_owner"
  ]
);

export const inboxV2AuthorizationOrgUnitMode = pgEnum(
  "inbox_v2_auth_org_unit_mode",
  ["exact", "subtree"]
);

export const inboxV2AuthorizationWorkforceMembershipKind = pgEnum(
  "inbox_v2_auth_workforce_membership_kind",
  ["org_unit", "team", "queue"]
);

export const inboxV2AuthorizationStructuralResourceKind = pgEnum(
  "inbox_v2_auth_structural_resource_kind",
  ["conversation", "client", "source_account"]
);

export const inboxV2AuthorizationStructuralTargetKind = pgEnum(
  "inbox_v2_auth_structural_target_kind",
  ["org_unit", "team"]
);

export const inboxV2AuthorizationCollaboratorResourceKind = pgEnum(
  "inbox_v2_auth_collaborator_resource_kind",
  ["conversation", "work_item"]
);

export const inboxV2AuthorizationCommandState = pgEnum(
  "inbox_v2_auth_command_state",
  ["pending", "completed"]
);

export const inboxV2AudienceImpactKind = pgEnum(
  "inbox_v2_audience_impact_kind",
  ["none", "direct", "structural", "tenant_rbac"]
);

export const inboxV2TenantStreamAudience = pgEnum(
  "inbox_v2_tenant_stream_audience",
  [
    "conversation_external",
    "internal_participants",
    "staff_only",
    "workforce_metadata",
    "policy_filtered"
  ]
);

export const inboxV2DomainEventAccessEffect = pgEnum(
  "inbox_v2_domain_event_access_effect",
  ["none", "may_change_access"]
);

export const inboxV2OutboxIntentEffectClass = pgEnum(
  "inbox_v2_outbox_intent_effect_class",
  ["projection", "notification", "provider_io", "search", "workflow"]
);

export const inboxV2AuthorizationAuditFacetKind = pgEnum(
  "inbox_v2_auth_audit_facet_kind",
  ["source", "destination", "affected"]
);

export const inboxV2AuthorizationRevisionEffectKind = pgEnum(
  "inbox_v2_auth_revision_effect_kind",
  [
    "tenant_rbac",
    "shared_access",
    "employee_access",
    "employee_inbox_relation",
    "resource_access",
    "collaborator_set"
  ]
);

export const inboxV2AuthorizationRelationKind = pgEnum(
  "inbox_v2_auth_relation_kind",
  [
    "role",
    "role_binding",
    "direct_grant",
    "workforce_membership",
    "structural_access",
    "conversation_collaborator",
    "work_item_collaborator",
    "internal_membership",
    "primary_responsibility",
    "servicing_team",
    "client_owner"
  ]
);

/** Shared tenant-level authorization clocks; broad changes update this row once. */
export const inboxV2AuthorizationTenantHeads = pgTable(
  "inbox_v2_auth_tenant_heads",
  {
    tenantId: text("tenant_id").notNull(),
    tenantRbacRevision: bigint("tenant_rbac_revision", {
      mode: "bigint"
    }).notNull(),
    sharedAccessRevision: bigint("shared_access_revision", {
      mode: "bigint"
    }).notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_auth_tenant_heads_pk",
      columns: [table.tenantId]
    }),
    foreignKey({
      name: "inbox_v2_auth_tenant_heads_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    check(
      "inbox_v2_auth_tenant_heads_revisions_check",
      sql`${table.tenantRbacRevision} >= 1
        and ${table.sharedAccessRevision} >= 1
        and ${table.revision} >= 1`
    ),
    check(
      "inbox_v2_auth_tenant_heads_times_check",
      finiteOrderedTimestamps(table.createdAt, table.updatedAt)
    ),
    index("inbox_v2_auth_tenant_heads_tenant_idx").on(table.tenantId)
  ]
);

/** Per-Employee bounded access clocks. No Employee x resource expansion is stored. */
export const inboxV2AuthorizationEmployeeHeads = pgTable(
  "inbox_v2_auth_employee_heads",
  {
    tenantId: text("tenant_id").notNull(),
    employeeId: text("employee_id").notNull(),
    employeeAccessRevision: bigint("employee_access_revision", {
      mode: "bigint"
    }).notNull(),
    employeeInboxRelationRevision: bigint("employee_inbox_relation_revision", {
      mode: "bigint"
    }).notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_auth_employee_heads_pk",
      columns: [table.tenantId, table.employeeId]
    }),
    foreignKey({
      name: "inbox_v2_auth_employee_heads_employee_fk",
      columns: [table.tenantId, table.employeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }).onDelete("cascade"),
    check(
      "inbox_v2_auth_employee_heads_revisions_check",
      sql`${table.employeeAccessRevision} >= 1
        and ${table.employeeInboxRelationRevision} >= 1
        and ${table.revision} >= 1`
    ),
    check(
      "inbox_v2_auth_employee_heads_times_check",
      finiteOrderedTimestamps(table.createdAt, table.updatedAt)
    ),
    index("inbox_v2_auth_employee_heads_access_idx").on(
      table.tenantId,
      table.employeeAccessRevision,
      table.employeeId
    ),
    index("inbox_v2_auth_employee_heads_relation_idx").on(
      table.tenantId,
      table.employeeInboxRelationRevision,
      table.employeeId
    )
  ]
);

/** Immutable role definition history. The current role head is declared below. */
export const inboxV2AuthorizationRoleVersions = pgTable(
  "inbox_v2_auth_role_versions",
  {
    tenantId: text("tenant_id").notNull(),
    roleId: text("role_id").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    state: inboxV2AuthorizationRecordState("state").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    permissionCount: integer("permission_count").notNull(),
    permissionSetDigestSha256: text("permission_set_digest_sha256").notNull(),
    catalogDigestSha256: text("catalog_digest_sha256").notNull(),
    snapshotHash: text("snapshot_hash").notNull(),
    actorKind: inboxV2AuthorizationActorKind("actor_kind").notNull(),
    actorEmployeeId: text("actor_employee_id"),
    actorTrustedServiceId: text("actor_trusted_service_id"),
    reasonId: text("reason_id").notNull(),
    mutationId: text("mutation_id").notNull(),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_auth_role_versions_pk",
      columns: [table.tenantId, table.roleId, table.revision]
    }),
    unique("inbox_v2_auth_role_versions_mutation_unique").on(
      table.tenantId,
      table.roleId,
      table.revision,
      table.mutationId
    ),
    foreignKey({
      name: "inbox_v2_auth_role_versions_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_auth_role_versions_actor_fk",
      columns: [table.tenantId, table.actorEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    check(
      "inbox_v2_auth_role_versions_values_check",
      sql`${table.revision} >= 1
        and char_length(${table.name}) between 1 and 160
        and (${table.description} is null
          or char_length(${table.description}) <= 2000)
        and ${table.permissionCount} between 1 and 256
        and ${sha256Sql(table.permissionSetDigestSha256)}
        and ${sha256Sql(table.catalogDigestSha256)}
        and ${sha256Sql(table.snapshotHash)}
        and ${catalogIdSql(table.reasonId)}
        and char_length(${table.mutationId}) between 1 and 256`
    ),
    check(
      "inbox_v2_auth_role_versions_actor_check",
      actorColumnsSql(
        table.actorKind,
        table.actorEmployeeId,
        table.actorTrustedServiceId
      )
    ),
    check(
      "inbox_v2_auth_role_versions_times_check",
      sql`isfinite(${table.occurredAt})
        and ${table.createdAt} = ${table.occurredAt}`
    ),
    index("inbox_v2_auth_role_versions_tenant_history_idx").on(
      table.tenantId,
      table.roleId,
      table.revision.desc()
    )
  ]
);

/** Closed permission snapshot owned by one immutable role revision. */
export const inboxV2AuthorizationRoleVersionPermissions = pgTable(
  "inbox_v2_auth_role_version_permissions",
  {
    tenantId: text("tenant_id").notNull(),
    roleId: text("role_id").notNull(),
    roleRevision: bigint("role_revision", { mode: "bigint" }).notNull(),
    ordinal: smallint("ordinal").notNull(),
    permissionId: text("permission_id").notNull(),
    catalogSchemaId: text("catalog_schema_id").notNull(),
    catalogVersion: text("catalog_version").notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_auth_role_version_permissions_pk",
      columns: [table.tenantId, table.roleId, table.roleRevision, table.ordinal]
    }),
    unique("inbox_v2_auth_role_permissions_value_unique").on(
      table.tenantId,
      table.roleId,
      table.roleRevision,
      table.permissionId
    ),
    foreignKey({
      name: "inbox_v2_auth_role_permissions_version_fk",
      columns: [table.tenantId, table.roleId, table.roleRevision],
      foreignColumns: [
        inboxV2AuthorizationRoleVersions.tenantId,
        inboxV2AuthorizationRoleVersions.roleId,
        inboxV2AuthorizationRoleVersions.revision
      ]
    }).onDelete("cascade"),
    check(
      "inbox_v2_auth_role_permissions_values_check",
      sql`${table.roleRevision} >= 1
        and ${table.ordinal} between 1 and 256
        and ${catalogIdSql(table.permissionId)}
        and ${table.catalogSchemaId} =
          'core:inbox-v2.permission-scope-catalog'
        and ${table.catalogVersion} = 'v1'`
    ),
    index("inbox_v2_auth_role_permissions_tenant_permission_idx").on(
      table.tenantId,
      table.permissionId,
      table.roleId
    )
  ]
);

/** Compact current role pointer; role definition changes do not rewrite bindings. */
export const inboxV2AuthorizationRoleHeads = pgTable(
  "inbox_v2_auth_role_heads",
  {
    tenantId: text("tenant_id").notNull(),
    roleId: text("role_id").notNull(),
    currentRevision: bigint("current_revision", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_auth_role_heads_pk",
      columns: [table.tenantId, table.roleId]
    }),
    foreignKey({
      name: "inbox_v2_auth_role_heads_current_fk",
      columns: [table.tenantId, table.roleId, table.currentRevision],
      foreignColumns: [
        inboxV2AuthorizationRoleVersions.tenantId,
        inboxV2AuthorizationRoleVersions.roleId,
        inboxV2AuthorizationRoleVersions.revision
      ]
    }).onDelete("cascade"),
    check(
      "inbox_v2_auth_role_heads_revision_check",
      sql`${table.currentRevision} >= 1`
    ),
    check(
      "inbox_v2_auth_role_heads_times_check",
      finiteOrderedTimestamps(table.createdAt, table.updatedAt)
    ),
    index("inbox_v2_auth_role_heads_tenant_revision_idx").on(
      table.tenantId,
      table.currentRevision,
      table.roleId
    )
  ]
);

/** Immutable temporal role-binding history with typed subject and scope edges. */
export const inboxV2AuthorizationRoleBindingVersions = pgTable(
  "inbox_v2_auth_role_binding_versions",
  {
    tenantId: text("tenant_id").notNull(),
    bindingId: text("binding_id").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    roleId: text("role_id").notNull(),
    roleRevisionObserved: bigint("role_revision_observed", {
      mode: "bigint"
    }).notNull(),
    subjectKind:
      inboxV2AuthorizationRoleBindingSubjectKind("subject_kind").notNull(),
    subjectEmployeeId: text("subject_employee_id"),
    subjectTeamId: text("subject_team_id"),
    subjectOrgUnitId: text("subject_org_unit_id"),
    subjectWorkQueueId: text("subject_work_queue_id"),
    scopeKind: inboxV2AuthorizationScopeKind("scope_kind").notNull(),
    scopeOrgUnitMode: inboxV2AuthorizationOrgUnitMode("scope_org_unit_mode"),
    scopeOrgUnitId: text("scope_org_unit_id"),
    scopeTeamId: text("scope_team_id"),
    scopeWorkQueueId: text("scope_work_queue_id"),
    scopeClientId: text("scope_client_id"),
    scopeConversationId: text("scope_conversation_id"),
    scopeWorkItemId: text("scope_work_item_id"),
    scopeSourceAccountId: text("scope_source_account_id"),
    state: inboxV2AuthorizationRecordState("state").notNull(),
    validFrom: timestamp("valid_from", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    validUntil: timestamp("valid_until", {
      withTimezone: true,
      precision: 3
    }),
    revokedAt: timestamp("revoked_at", {
      withTimezone: true,
      precision: 3
    }),
    actorKind: inboxV2AuthorizationActorKind("actor_kind").notNull(),
    actorEmployeeId: text("actor_employee_id"),
    actorTrustedServiceId: text("actor_trusted_service_id"),
    reasonId: text("reason_id").notNull(),
    mutationId: text("mutation_id").notNull(),
    recordHash: text("record_hash").notNull(),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_auth_role_binding_versions_pk",
      columns: [table.tenantId, table.bindingId, table.revision]
    }),
    unique("inbox_v2_auth_role_binding_versions_mutation_unique").on(
      table.tenantId,
      table.bindingId,
      table.revision,
      table.mutationId
    ),
    foreignKey({
      name: "inbox_v2_auth_role_binding_versions_role_fk",
      columns: [table.tenantId, table.roleId],
      foreignColumns: [
        inboxV2AuthorizationRoleHeads.tenantId,
        inboxV2AuthorizationRoleHeads.roleId
      ]
    }),
    foreignKey({
      name: "inbox_v2_auth_role_binding_versions_role_observed_fk",
      columns: [table.tenantId, table.roleId, table.roleRevisionObserved],
      foreignColumns: [
        inboxV2AuthorizationRoleVersions.tenantId,
        inboxV2AuthorizationRoleVersions.roleId,
        inboxV2AuthorizationRoleVersions.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_auth_role_binding_subject_employee_fk",
      columns: [table.tenantId, table.subjectEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_auth_role_binding_subject_team_fk",
      columns: [table.tenantId, table.subjectTeamId],
      foreignColumns: [teams.tenantId, teams.id]
    }),
    foreignKey({
      name: "inbox_v2_auth_role_binding_subject_org_fk",
      columns: [table.tenantId, table.subjectOrgUnitId],
      foreignColumns: [orgUnits.tenantId, orgUnits.id]
    }),
    foreignKey({
      name: "inbox_v2_auth_role_binding_subject_queue_fk",
      columns: [table.tenantId, table.subjectWorkQueueId],
      foreignColumns: [workQueues.tenantId, workQueues.id]
    }),
    foreignKey({
      name: "inbox_v2_auth_role_binding_scope_org_fk",
      columns: [table.tenantId, table.scopeOrgUnitId],
      foreignColumns: [orgUnits.tenantId, orgUnits.id]
    }),
    foreignKey({
      name: "inbox_v2_auth_role_binding_scope_team_fk",
      columns: [table.tenantId, table.scopeTeamId],
      foreignColumns: [teams.tenantId, teams.id]
    }),
    foreignKey({
      name: "inbox_v2_auth_role_binding_scope_queue_fk",
      columns: [table.tenantId, table.scopeWorkQueueId],
      foreignColumns: [workQueues.tenantId, workQueues.id]
    }),
    foreignKey({
      name: "inbox_v2_auth_role_binding_scope_client_fk",
      columns: [table.tenantId, table.scopeClientId],
      foreignColumns: [clients.tenantId, clients.id]
    }),
    foreignKey({
      name: "inbox_v2_auth_role_binding_scope_conversation_fk",
      columns: [table.tenantId, table.scopeConversationId],
      foreignColumns: [inboxV2Conversations.tenantId, inboxV2Conversations.id]
    }),
    foreignKey({
      name: "inbox_v2_auth_role_binding_scope_work_item_fk",
      columns: [table.tenantId, table.scopeWorkItemId],
      foreignColumns: [inboxV2WorkItems.tenantId, inboxV2WorkItems.id]
    }),
    foreignKey({
      name: "inbox_v2_auth_role_binding_scope_source_fk",
      columns: [table.tenantId, table.scopeSourceAccountId],
      foreignColumns: [sourceAccounts.tenantId, sourceAccounts.id]
    }),
    check(
      "inbox_v2_auth_role_binding_subject_check",
      bindingSubjectColumnsSql(table)
    ),
    check("inbox_v2_auth_role_binding_scope_check", scopeColumnsSql(table)),
    check(
      "inbox_v2_auth_role_binding_state_check",
      temporalStateSql(
        table.state,
        table.validFrom,
        table.validUntil,
        table.revokedAt,
        table.occurredAt
      )
    ),
    check(
      "inbox_v2_auth_role_binding_values_check",
      sql`${table.revision} >= 1
        and ${table.roleRevisionObserved} >= 1
        and ${catalogIdSql(table.reasonId)}
        and char_length(${table.mutationId}) between 1 and 256
        and ${sha256Sql(table.recordHash)}`
    ),
    check(
      "inbox_v2_auth_role_binding_actor_check",
      actorColumnsSql(
        table.actorKind,
        table.actorEmployeeId,
        table.actorTrustedServiceId
      )
    ),
    check(
      "inbox_v2_auth_role_binding_times_check",
      sql`isfinite(${table.occurredAt})
        and ${table.createdAt} = ${table.occurredAt}`
    ),
    index("inbox_v2_auth_role_binding_tenant_subject_idx").on(
      table.tenantId,
      table.subjectKind,
      table.subjectEmployeeId,
      table.subjectTeamId,
      table.subjectOrgUnitId,
      table.subjectWorkQueueId,
      table.validFrom
    ),
    index("inbox_v2_auth_role_binding_tenant_scope_idx").on(
      table.tenantId,
      table.scopeKind,
      table.validFrom,
      table.bindingId
    ),
    index("inbox_v2_auth_role_binding_tenant_role_active_idx")
      .on(table.tenantId, table.roleId, table.bindingId, table.revision)
      .where(sql`${table.state} = 'active'`)
  ]
);

export const inboxV2AuthorizationRoleBindingHeads = pgTable(
  "inbox_v2_auth_role_binding_heads",
  {
    tenantId: text("tenant_id").notNull(),
    bindingId: text("binding_id").notNull(),
    currentRevision: bigint("current_revision", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_auth_role_binding_heads_pk",
      columns: [table.tenantId, table.bindingId]
    }),
    foreignKey({
      name: "inbox_v2_auth_role_binding_heads_current_fk",
      columns: [table.tenantId, table.bindingId, table.currentRevision],
      foreignColumns: [
        inboxV2AuthorizationRoleBindingVersions.tenantId,
        inboxV2AuthorizationRoleBindingVersions.bindingId,
        inboxV2AuthorizationRoleBindingVersions.revision
      ]
    }).onDelete("cascade"),
    check(
      "inbox_v2_auth_role_binding_heads_revision_check",
      sql`${table.currentRevision} >= 1`
    ),
    check(
      "inbox_v2_auth_role_binding_heads_times_check",
      finiteOrderedTimestamps(table.createdAt, table.updatedAt)
    ),
    index("inbox_v2_auth_role_binding_heads_tenant_revision_idx").on(
      table.tenantId,
      table.currentRevision,
      table.bindingId
    )
  ]
);

/** Immutable direct-grant revisions; every scope endpoint is tenant constrained. */
export const inboxV2AuthorizationDirectGrantVersions = pgTable(
  "inbox_v2_auth_direct_grant_versions",
  {
    tenantId: text("tenant_id").notNull(),
    grantId: text("grant_id").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    employeeId: text("employee_id").notNull(),
    permissionId: text("permission_id").notNull(),
    catalogSchemaId: text("catalog_schema_id").notNull(),
    catalogVersion: text("catalog_version").notNull(),
    catalogDigestSha256: text("catalog_digest_sha256").notNull(),
    scopeKind: inboxV2AuthorizationScopeKind("scope_kind").notNull(),
    scopeOrgUnitMode: inboxV2AuthorizationOrgUnitMode("scope_org_unit_mode"),
    scopeOrgUnitId: text("scope_org_unit_id"),
    scopeTeamId: text("scope_team_id"),
    scopeWorkQueueId: text("scope_work_queue_id"),
    scopeClientId: text("scope_client_id"),
    scopeConversationId: text("scope_conversation_id"),
    scopeWorkItemId: text("scope_work_item_id"),
    scopeSourceAccountId: text("scope_source_account_id"),
    state: inboxV2AuthorizationRecordState("state").notNull(),
    validFrom: timestamp("valid_from", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    validUntil: timestamp("valid_until", {
      withTimezone: true,
      precision: 3
    }),
    revokedAt: timestamp("revoked_at", {
      withTimezone: true,
      precision: 3
    }),
    actorKind: inboxV2AuthorizationActorKind("actor_kind").notNull(),
    actorEmployeeId: text("actor_employee_id"),
    actorTrustedServiceId: text("actor_trusted_service_id"),
    reasonId: text("reason_id").notNull(),
    mutationId: text("mutation_id").notNull(),
    recordHash: text("record_hash").notNull(),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_auth_direct_grant_versions_pk",
      columns: [table.tenantId, table.grantId, table.revision]
    }),
    unique("inbox_v2_auth_direct_grant_versions_mutation_unique").on(
      table.tenantId,
      table.grantId,
      table.revision,
      table.mutationId
    ),
    foreignKey({
      name: "inbox_v2_auth_direct_grant_employee_fk",
      columns: [table.tenantId, table.employeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_auth_direct_grant_actor_fk",
      columns: [table.tenantId, table.actorEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_auth_direct_grant_scope_org_fk",
      columns: [table.tenantId, table.scopeOrgUnitId],
      foreignColumns: [orgUnits.tenantId, orgUnits.id]
    }),
    foreignKey({
      name: "inbox_v2_auth_direct_grant_scope_team_fk",
      columns: [table.tenantId, table.scopeTeamId],
      foreignColumns: [teams.tenantId, teams.id]
    }),
    foreignKey({
      name: "inbox_v2_auth_direct_grant_scope_queue_fk",
      columns: [table.tenantId, table.scopeWorkQueueId],
      foreignColumns: [workQueues.tenantId, workQueues.id]
    }),
    foreignKey({
      name: "inbox_v2_auth_direct_grant_scope_client_fk",
      columns: [table.tenantId, table.scopeClientId],
      foreignColumns: [clients.tenantId, clients.id]
    }),
    foreignKey({
      name: "inbox_v2_auth_direct_grant_scope_conversation_fk",
      columns: [table.tenantId, table.scopeConversationId],
      foreignColumns: [inboxV2Conversations.tenantId, inboxV2Conversations.id]
    }),
    foreignKey({
      name: "inbox_v2_auth_direct_grant_scope_work_item_fk",
      columns: [table.tenantId, table.scopeWorkItemId],
      foreignColumns: [inboxV2WorkItems.tenantId, inboxV2WorkItems.id]
    }),
    foreignKey({
      name: "inbox_v2_auth_direct_grant_scope_source_fk",
      columns: [table.tenantId, table.scopeSourceAccountId],
      foreignColumns: [sourceAccounts.tenantId, sourceAccounts.id]
    }),
    check("inbox_v2_auth_direct_grant_scope_check", scopeColumnsSql(table)),
    check(
      "inbox_v2_auth_direct_grant_state_check",
      temporalStateSql(
        table.state,
        table.validFrom,
        table.validUntil,
        table.revokedAt,
        table.occurredAt
      )
    ),
    check(
      "inbox_v2_auth_direct_grant_values_check",
      sql`${table.revision} >= 1
        and ${catalogIdSql(table.permissionId)}
        and ${table.catalogSchemaId} =
          'core:inbox-v2.permission-scope-catalog'
        and ${table.catalogVersion} = 'v1'
        and ${sha256Sql(table.catalogDigestSha256)}
        and ${catalogIdSql(table.reasonId)}
        and char_length(${table.mutationId}) between 1 and 256
        and ${sha256Sql(table.recordHash)}`
    ),
    check(
      "inbox_v2_auth_direct_grant_actor_check",
      actorColumnsSql(
        table.actorKind,
        table.actorEmployeeId,
        table.actorTrustedServiceId
      )
    ),
    check(
      "inbox_v2_auth_direct_grant_times_check",
      sql`isfinite(${table.occurredAt})
        and ${table.createdAt} = ${table.occurredAt}`
    ),
    index("inbox_v2_auth_direct_grant_tenant_employee_idx").on(
      table.tenantId,
      table.employeeId,
      table.validFrom,
      table.grantId
    ),
    index("inbox_v2_auth_direct_grant_tenant_permission_idx").on(
      table.tenantId,
      table.permissionId,
      table.validFrom,
      table.grantId
    )
  ]
);

export const inboxV2AuthorizationDirectGrantHeads = pgTable(
  "inbox_v2_auth_direct_grant_heads",
  {
    tenantId: text("tenant_id").notNull(),
    grantId: text("grant_id").notNull(),
    currentRevision: bigint("current_revision", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_auth_direct_grant_heads_pk",
      columns: [table.tenantId, table.grantId]
    }),
    foreignKey({
      name: "inbox_v2_auth_direct_grant_heads_current_fk",
      columns: [table.tenantId, table.grantId, table.currentRevision],
      foreignColumns: [
        inboxV2AuthorizationDirectGrantVersions.tenantId,
        inboxV2AuthorizationDirectGrantVersions.grantId,
        inboxV2AuthorizationDirectGrantVersions.revision
      ]
    }).onDelete("cascade"),
    check(
      "inbox_v2_auth_direct_grant_heads_revision_check",
      sql`${table.currentRevision} >= 1`
    ),
    check(
      "inbox_v2_auth_direct_grant_heads_times_check",
      finiteOrderedTimestamps(table.createdAt, table.updatedAt)
    ),
    index("inbox_v2_auth_direct_grant_heads_tenant_revision_idx").on(
      table.tenantId,
      table.currentRevision,
      table.grantId
    )
  ]
);

/** Immutable org/team/Queue membership snapshots used by V2 authorization. */
export const inboxV2AuthorizationWorkforceMembershipVersions = pgTable(
  "inbox_v2_auth_workforce_membership_versions",
  {
    tenantId: text("tenant_id").notNull(),
    membershipId: text("membership_id").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    employeeId: text("employee_id").notNull(),
    membershipKind:
      inboxV2AuthorizationWorkforceMembershipKind("membership_kind").notNull(),
    orgUnitId: text("org_unit_id"),
    teamId: text("team_id"),
    workQueueId: text("work_queue_id"),
    state: inboxV2AuthorizationRecordState("state").notNull(),
    validFrom: timestamp("valid_from", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    validUntil: timestamp("valid_until", {
      withTimezone: true,
      precision: 3
    }),
    revokedAt: timestamp("revoked_at", {
      withTimezone: true,
      precision: 3
    }),
    actorKind: inboxV2AuthorizationActorKind("actor_kind").notNull(),
    actorEmployeeId: text("actor_employee_id"),
    actorTrustedServiceId: text("actor_trusted_service_id"),
    reasonId: text("reason_id").notNull(),
    mutationId: text("mutation_id").notNull(),
    recordHash: text("record_hash").notNull(),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_auth_workforce_versions_pk",
      columns: [table.tenantId, table.membershipId, table.revision]
    }),
    unique("inbox_v2_auth_workforce_versions_mutation_unique").on(
      table.tenantId,
      table.membershipId,
      table.revision,
      table.mutationId
    ),
    foreignKey({
      name: "inbox_v2_auth_workforce_versions_employee_fk",
      columns: [table.tenantId, table.employeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_auth_workforce_versions_org_fk",
      columns: [table.tenantId, table.orgUnitId],
      foreignColumns: [orgUnits.tenantId, orgUnits.id]
    }),
    foreignKey({
      name: "inbox_v2_auth_workforce_versions_team_fk",
      columns: [table.tenantId, table.teamId],
      foreignColumns: [teams.tenantId, teams.id]
    }),
    foreignKey({
      name: "inbox_v2_auth_workforce_versions_queue_fk",
      columns: [table.tenantId, table.workQueueId],
      foreignColumns: [workQueues.tenantId, workQueues.id]
    }),
    foreignKey({
      name: "inbox_v2_auth_workforce_versions_actor_fk",
      columns: [table.tenantId, table.actorEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    check(
      "inbox_v2_auth_workforce_versions_target_check",
      workforceMembershipColumnsSql(table)
    ),
    check(
      "inbox_v2_auth_workforce_versions_state_check",
      temporalStateSql(
        table.state,
        table.validFrom,
        table.validUntil,
        table.revokedAt,
        table.occurredAt
      )
    ),
    check(
      "inbox_v2_auth_workforce_versions_actor_check",
      actorColumnsSql(
        table.actorKind,
        table.actorEmployeeId,
        table.actorTrustedServiceId
      )
    ),
    check(
      "inbox_v2_auth_workforce_versions_values_check",
      sql`${table.revision} >= 1
        and ${catalogIdSql(table.reasonId)}
        and char_length(${table.mutationId}) between 1 and 256
        and ${sha256Sql(table.recordHash)}
        and isfinite(${table.occurredAt})
        and ${table.createdAt} = ${table.occurredAt}`
    ),
    index("inbox_v2_auth_workforce_versions_employee_idx").on(
      table.tenantId,
      table.employeeId,
      table.membershipKind,
      table.validFrom,
      table.membershipId
    )
  ]
);

/** Current workforce relation pointer and duplicate-logical-edge fence. */
export const inboxV2AuthorizationWorkforceMembershipHeads = pgTable(
  "inbox_v2_auth_workforce_membership_heads",
  {
    tenantId: text("tenant_id").notNull(),
    membershipId: text("membership_id").notNull(),
    employeeId: text("employee_id").notNull(),
    membershipKind:
      inboxV2AuthorizationWorkforceMembershipKind("membership_kind").notNull(),
    orgUnitId: text("org_unit_id"),
    teamId: text("team_id"),
    workQueueId: text("work_queue_id"),
    currentState: inboxV2AuthorizationRecordState("current_state").notNull(),
    currentRevision: bigint("current_revision", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_auth_workforce_heads_pk",
      columns: [table.tenantId, table.membershipId]
    }),
    foreignKey({
      name: "inbox_v2_auth_workforce_heads_current_fk",
      columns: [table.tenantId, table.membershipId, table.currentRevision],
      foreignColumns: [
        inboxV2AuthorizationWorkforceMembershipVersions.tenantId,
        inboxV2AuthorizationWorkforceMembershipVersions.membershipId,
        inboxV2AuthorizationWorkforceMembershipVersions.revision
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_auth_workforce_heads_employee_fk",
      columns: [table.tenantId, table.employeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_auth_workforce_heads_org_fk",
      columns: [table.tenantId, table.orgUnitId],
      foreignColumns: [orgUnits.tenantId, orgUnits.id]
    }),
    foreignKey({
      name: "inbox_v2_auth_workforce_heads_team_fk",
      columns: [table.tenantId, table.teamId],
      foreignColumns: [teams.tenantId, teams.id]
    }),
    foreignKey({
      name: "inbox_v2_auth_workforce_heads_queue_fk",
      columns: [table.tenantId, table.workQueueId],
      foreignColumns: [workQueues.tenantId, workQueues.id]
    }),
    check(
      "inbox_v2_auth_workforce_heads_target_check",
      workforceMembershipColumnsSql(table)
    ),
    check(
      "inbox_v2_auth_workforce_heads_values_check",
      sql`${table.currentRevision} >= 1`
    ),
    check(
      "inbox_v2_auth_workforce_heads_times_check",
      finiteOrderedTimestamps(table.createdAt, table.updatedAt)
    ),
    uniqueIndex("inbox_v2_auth_workforce_heads_org_unique")
      .on(table.tenantId, table.employeeId, table.orgUnitId)
      .where(
        sql`${table.membershipKind} = 'org_unit'
          and ${table.currentState} = 'active'`
      ),
    uniqueIndex("inbox_v2_auth_workforce_heads_team_unique")
      .on(table.tenantId, table.employeeId, table.teamId)
      .where(
        sql`${table.membershipKind} = 'team'
          and ${table.currentState} = 'active'`
      ),
    uniqueIndex("inbox_v2_auth_workforce_heads_queue_unique")
      .on(table.tenantId, table.employeeId, table.workQueueId)
      .where(
        sql`${table.membershipKind} = 'queue'
          and ${table.currentState} = 'active'`
      ),
    index("inbox_v2_auth_workforce_heads_employee_idx").on(
      table.tenantId,
      table.employeeId,
      table.membershipKind,
      table.membershipId
    )
  ]
);

/** Bounded access revision aggregate for Conversation, Client or SourceAccount. */
export const inboxV2AuthorizationResourceHeads = pgTable(
  "inbox_v2_auth_resource_heads",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    resourceKind:
      inboxV2AuthorizationStructuralResourceKind("resource_kind").notNull(),
    conversationId: text("conversation_id"),
    clientId: text("client_id"),
    sourceAccountId: text("source_account_id"),
    resourceAccessRevision: bigint("resource_access_revision", {
      mode: "bigint"
    }).notNull(),
    structuralRelationRevision: bigint("structural_relation_revision", {
      mode: "bigint"
    }).notNull(),
    collaboratorSetRevision: bigint("collaborator_set_revision", {
      mode: "bigint"
    }).notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_auth_resource_heads_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_auth_resource_heads_conversation_fk",
      columns: [table.tenantId, table.conversationId],
      foreignColumns: [inboxV2Conversations.tenantId, inboxV2Conversations.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_auth_resource_heads_client_fk",
      columns: [table.tenantId, table.clientId],
      foreignColumns: [clients.tenantId, clients.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_auth_resource_heads_source_fk",
      columns: [table.tenantId, table.sourceAccountId],
      foreignColumns: [sourceAccounts.tenantId, sourceAccounts.id]
    }).onDelete("cascade"),
    check(
      "inbox_v2_auth_resource_heads_resource_check",
      structuralResourceColumnsSql(table)
    ),
    check(
      "inbox_v2_auth_resource_heads_revisions_check",
      sql`${table.resourceAccessRevision} >= 1
        and ${table.structuralRelationRevision} >= 1
        and ${table.collaboratorSetRevision} >= 1
        and ${table.revision} >= 1`
    ),
    check(
      "inbox_v2_auth_resource_heads_times_check",
      finiteOrderedTimestamps(table.createdAt, table.updatedAt)
    ),
    uniqueIndex("inbox_v2_auth_resource_heads_conversation_unique")
      .on(table.tenantId, table.conversationId)
      .where(sql`${table.resourceKind} = 'conversation'`),
    uniqueIndex("inbox_v2_auth_resource_heads_client_unique")
      .on(table.tenantId, table.clientId)
      .where(sql`${table.resourceKind} = 'client'`),
    uniqueIndex("inbox_v2_auth_resource_heads_source_unique")
      .on(table.tenantId, table.sourceAccountId)
      .where(sql`${table.resourceKind} = 'source_account'`),
    index("inbox_v2_auth_resource_heads_access_idx").on(
      table.tenantId,
      table.resourceAccessRevision,
      table.id
    )
  ]
);

/** Immutable structural resource-to-workforce access edge snapshots. */
export const inboxV2AuthorizationStructuralAccessVersions = pgTable(
  "inbox_v2_auth_structural_access_versions",
  {
    tenantId: text("tenant_id").notNull(),
    bindingId: text("binding_id").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    resourceHeadId: text("resource_head_id").notNull(),
    resourceKind:
      inboxV2AuthorizationStructuralResourceKind("resource_kind").notNull(),
    conversationId: text("conversation_id"),
    clientId: text("client_id"),
    sourceAccountId: text("source_account_id"),
    targetKind:
      inboxV2AuthorizationStructuralTargetKind("target_kind").notNull(),
    targetOrgUnitId: text("target_org_unit_id"),
    targetTeamId: text("target_team_id"),
    policyId: text("policy_id"),
    policyRevision: bigint("policy_revision", { mode: "bigint" }),
    state: inboxV2AuthorizationRecordState("state").notNull(),
    validFrom: timestamp("valid_from", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    validUntil: timestamp("valid_until", {
      withTimezone: true,
      precision: 3
    }),
    revokedAt: timestamp("revoked_at", {
      withTimezone: true,
      precision: 3
    }),
    actorKind: inboxV2AuthorizationActorKind("actor_kind").notNull(),
    actorEmployeeId: text("actor_employee_id"),
    actorTrustedServiceId: text("actor_trusted_service_id"),
    reasonId: text("reason_id").notNull(),
    mutationId: text("mutation_id").notNull(),
    recordHash: text("record_hash").notNull(),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_auth_structural_versions_pk",
      columns: [table.tenantId, table.bindingId, table.revision]
    }),
    unique("inbox_v2_auth_structural_versions_mutation_unique").on(
      table.tenantId,
      table.bindingId,
      table.revision,
      table.mutationId
    ),
    foreignKey({
      name: "inbox_v2_auth_structural_versions_head_fk",
      columns: [table.tenantId, table.resourceHeadId],
      foreignColumns: [
        inboxV2AuthorizationResourceHeads.tenantId,
        inboxV2AuthorizationResourceHeads.id
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_auth_structural_versions_conversation_fk",
      columns: [table.tenantId, table.conversationId],
      foreignColumns: [inboxV2Conversations.tenantId, inboxV2Conversations.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_auth_structural_versions_client_fk",
      columns: [table.tenantId, table.clientId],
      foreignColumns: [clients.tenantId, clients.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_auth_structural_versions_source_fk",
      columns: [table.tenantId, table.sourceAccountId],
      foreignColumns: [sourceAccounts.tenantId, sourceAccounts.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_auth_structural_versions_org_fk",
      columns: [table.tenantId, table.targetOrgUnitId],
      foreignColumns: [orgUnits.tenantId, orgUnits.id]
    }),
    foreignKey({
      name: "inbox_v2_auth_structural_versions_team_fk",
      columns: [table.tenantId, table.targetTeamId],
      foreignColumns: [teams.tenantId, teams.id]
    }),
    foreignKey({
      name: "inbox_v2_auth_structural_versions_actor_fk",
      columns: [table.tenantId, table.actorEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    check(
      "inbox_v2_auth_structural_versions_resource_check",
      structuralResourceColumnsSql(table)
    ),
    check(
      "inbox_v2_auth_structural_versions_target_check",
      structuralTargetColumnsSql(table)
    ),
    check(
      "inbox_v2_auth_structural_versions_source_target_check",
      sql`${table.resourceKind} <> 'source_account'
        or ${table.targetKind} = 'org_unit'`
    ),
    check(
      "inbox_v2_auth_structural_versions_policy_check",
      sql`(${table.policyId} is null and ${table.policyRevision} is null)
        or (${table.policyId} is not null
          and ${catalogIdSql(table.policyId)}
          and ${table.policyRevision} >= 1)`
    ),
    check(
      "inbox_v2_auth_structural_versions_state_check",
      temporalStateSql(
        table.state,
        table.validFrom,
        table.validUntil,
        table.revokedAt,
        table.occurredAt
      )
    ),
    check(
      "inbox_v2_auth_structural_versions_actor_check",
      actorColumnsSql(
        table.actorKind,
        table.actorEmployeeId,
        table.actorTrustedServiceId
      )
    ),
    check(
      "inbox_v2_auth_structural_versions_values_check",
      sql`${table.revision} >= 1
        and ${catalogIdSql(table.reasonId)}
        and char_length(${table.mutationId}) between 1 and 256
        and ${sha256Sql(table.recordHash)}
        and isfinite(${table.occurredAt})
        and ${table.createdAt} = ${table.occurredAt}`
    ),
    index("inbox_v2_auth_structural_versions_resource_idx").on(
      table.tenantId,
      table.resourceHeadId,
      table.validFrom,
      table.bindingId
    ),
    index("inbox_v2_auth_structural_versions_target_idx").on(
      table.tenantId,
      table.targetKind,
      table.targetOrgUnitId,
      table.targetTeamId,
      table.validFrom
    )
  ]
);

export const inboxV2AuthorizationStructuralAccessHeads = pgTable(
  "inbox_v2_auth_structural_access_heads",
  {
    tenantId: text("tenant_id").notNull(),
    bindingId: text("binding_id").notNull(),
    resourceHeadId: text("resource_head_id").notNull(),
    resourceKind:
      inboxV2AuthorizationStructuralResourceKind("resource_kind").notNull(),
    conversationId: text("conversation_id"),
    clientId: text("client_id"),
    sourceAccountId: text("source_account_id"),
    targetKind:
      inboxV2AuthorizationStructuralTargetKind("target_kind").notNull(),
    targetOrgUnitId: text("target_org_unit_id"),
    targetTeamId: text("target_team_id"),
    currentState: inboxV2AuthorizationRecordState("current_state").notNull(),
    currentRevision: bigint("current_revision", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_auth_structural_heads_pk",
      columns: [table.tenantId, table.bindingId]
    }),
    foreignKey({
      name: "inbox_v2_auth_structural_heads_current_fk",
      columns: [table.tenantId, table.bindingId, table.currentRevision],
      foreignColumns: [
        inboxV2AuthorizationStructuralAccessVersions.tenantId,
        inboxV2AuthorizationStructuralAccessVersions.bindingId,
        inboxV2AuthorizationStructuralAccessVersions.revision
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_auth_structural_heads_resource_head_fk",
      columns: [table.tenantId, table.resourceHeadId],
      foreignColumns: [
        inboxV2AuthorizationResourceHeads.tenantId,
        inboxV2AuthorizationResourceHeads.id
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_auth_structural_heads_conversation_fk",
      columns: [table.tenantId, table.conversationId],
      foreignColumns: [inboxV2Conversations.tenantId, inboxV2Conversations.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_auth_structural_heads_client_fk",
      columns: [table.tenantId, table.clientId],
      foreignColumns: [clients.tenantId, clients.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_auth_structural_heads_source_fk",
      columns: [table.tenantId, table.sourceAccountId],
      foreignColumns: [sourceAccounts.tenantId, sourceAccounts.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_auth_structural_heads_org_fk",
      columns: [table.tenantId, table.targetOrgUnitId],
      foreignColumns: [orgUnits.tenantId, orgUnits.id]
    }),
    foreignKey({
      name: "inbox_v2_auth_structural_heads_team_fk",
      columns: [table.tenantId, table.targetTeamId],
      foreignColumns: [teams.tenantId, teams.id]
    }),
    check(
      "inbox_v2_auth_structural_heads_resource_check",
      structuralResourceColumnsSql(table)
    ),
    check(
      "inbox_v2_auth_structural_heads_target_check",
      structuralTargetColumnsSql(table)
    ),
    check(
      "inbox_v2_auth_structural_heads_source_target_check",
      sql`${table.resourceKind} <> 'source_account'
        or ${table.targetKind} = 'org_unit'`
    ),
    check(
      "inbox_v2_auth_structural_heads_values_check",
      sql`${table.currentRevision} >= 1`
    ),
    check(
      "inbox_v2_auth_structural_heads_times_check",
      finiteOrderedTimestamps(table.createdAt, table.updatedAt)
    ),
    uniqueIndex("inbox_v2_auth_structural_heads_conversation_org_unique")
      .on(table.tenantId, table.conversationId, table.targetOrgUnitId)
      .where(
        sql`${table.resourceKind} = 'conversation'
          and ${table.targetKind} = 'org_unit'
          and ${table.currentState} = 'active'`
      ),
    uniqueIndex("inbox_v2_auth_structural_heads_conversation_team_unique")
      .on(table.tenantId, table.conversationId, table.targetTeamId)
      .where(
        sql`${table.resourceKind} = 'conversation'
          and ${table.targetKind} = 'team'
          and ${table.currentState} = 'active'`
      ),
    uniqueIndex("inbox_v2_auth_structural_heads_client_org_unique")
      .on(table.tenantId, table.clientId, table.targetOrgUnitId)
      .where(
        sql`${table.resourceKind} = 'client'
          and ${table.targetKind} = 'org_unit'
          and ${table.currentState} = 'active'`
      ),
    uniqueIndex("inbox_v2_auth_structural_heads_client_team_unique")
      .on(table.tenantId, table.clientId, table.targetTeamId)
      .where(
        sql`${table.resourceKind} = 'client'
          and ${table.targetKind} = 'team'
          and ${table.currentState} = 'active'`
      ),
    uniqueIndex("inbox_v2_auth_structural_heads_source_org_unique")
      .on(table.tenantId, table.sourceAccountId, table.targetOrgUnitId)
      .where(
        sql`${table.resourceKind} = 'source_account'
          and ${table.targetKind} = 'org_unit'
          and ${table.currentState} = 'active'`
      ),
    index("inbox_v2_auth_structural_heads_resource_idx").on(
      table.tenantId,
      table.resourceHeadId,
      table.bindingId
    )
  ]
);

/** Immutable explicit Hulee collaborator snapshots; never provider roster. */
export const inboxV2AuthorizationCollaboratorVersions = pgTable(
  "inbox_v2_auth_collaborator_versions",
  {
    tenantId: text("tenant_id").notNull(),
    collaboratorId: text("collaborator_id").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    resourceKind:
      inboxV2AuthorizationCollaboratorResourceKind("resource_kind").notNull(),
    conversationId: text("conversation_id"),
    workItemId: text("work_item_id"),
    workItemCycle: bigint("work_item_cycle", { mode: "bigint" }),
    employeeId: text("employee_id").notNull(),
    state: inboxV2AuthorizationRecordState("state").notNull(),
    validFrom: timestamp("valid_from", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    validUntil: timestamp("valid_until", {
      withTimezone: true,
      precision: 3
    }),
    revokedAt: timestamp("revoked_at", {
      withTimezone: true,
      precision: 3
    }),
    actorKind: inboxV2AuthorizationActorKind("actor_kind").notNull(),
    actorEmployeeId: text("actor_employee_id"),
    actorTrustedServiceId: text("actor_trusted_service_id"),
    reasonId: text("reason_id").notNull(),
    mutationId: text("mutation_id").notNull(),
    recordHash: text("record_hash").notNull(),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_auth_collaborator_versions_pk",
      columns: [table.tenantId, table.collaboratorId, table.revision]
    }),
    unique("inbox_v2_auth_collaborator_versions_mutation_unique").on(
      table.tenantId,
      table.collaboratorId,
      table.revision,
      table.mutationId
    ),
    foreignKey({
      name: "inbox_v2_auth_collaborator_versions_conversation_fk",
      columns: [table.tenantId, table.conversationId],
      foreignColumns: [inboxV2Conversations.tenantId, inboxV2Conversations.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_auth_collaborator_versions_work_item_fk",
      columns: [table.tenantId, table.workItemId],
      foreignColumns: [inboxV2WorkItems.tenantId, inboxV2WorkItems.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_auth_collaborator_versions_employee_fk",
      columns: [table.tenantId, table.employeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_auth_collaborator_versions_actor_fk",
      columns: [table.tenantId, table.actorEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    check(
      "inbox_v2_auth_collaborator_versions_resource_check",
      collaboratorResourceColumnsSql(table)
    ),
    check(
      "inbox_v2_auth_collaborator_versions_state_check",
      temporalStateSql(
        table.state,
        table.validFrom,
        table.validUntil,
        table.revokedAt,
        table.occurredAt
      )
    ),
    check(
      "inbox_v2_auth_collaborator_versions_actor_check",
      actorColumnsSql(
        table.actorKind,
        table.actorEmployeeId,
        table.actorTrustedServiceId
      )
    ),
    check(
      "inbox_v2_auth_collaborator_versions_values_check",
      sql`${table.revision} >= 1
        and ${catalogIdSql(table.reasonId)}
        and char_length(${table.mutationId}) between 1 and 256
        and ${sha256Sql(table.recordHash)}
        and isfinite(${table.occurredAt})
        and ${table.createdAt} = ${table.occurredAt}`
    ),
    index("inbox_v2_auth_collaborator_versions_employee_idx").on(
      table.tenantId,
      table.employeeId,
      table.resourceKind,
      table.validFrom,
      table.collaboratorId
    ),
    index("inbox_v2_auth_collaborator_versions_resource_idx").on(
      table.tenantId,
      table.resourceKind,
      table.conversationId,
      table.workItemId,
      table.validFrom
    )
  ]
);

export const inboxV2AuthorizationCollaboratorHeads = pgTable(
  "inbox_v2_auth_collaborator_heads",
  {
    tenantId: text("tenant_id").notNull(),
    collaboratorId: text("collaborator_id").notNull(),
    resourceKind:
      inboxV2AuthorizationCollaboratorResourceKind("resource_kind").notNull(),
    conversationId: text("conversation_id"),
    workItemId: text("work_item_id"),
    workItemCycle: bigint("work_item_cycle", { mode: "bigint" }),
    employeeId: text("employee_id").notNull(),
    currentState: inboxV2AuthorizationRecordState("current_state").notNull(),
    currentRevision: bigint("current_revision", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_auth_collaborator_heads_pk",
      columns: [table.tenantId, table.collaboratorId]
    }),
    foreignKey({
      name: "inbox_v2_auth_collaborator_heads_current_fk",
      columns: [table.tenantId, table.collaboratorId, table.currentRevision],
      foreignColumns: [
        inboxV2AuthorizationCollaboratorVersions.tenantId,
        inboxV2AuthorizationCollaboratorVersions.collaboratorId,
        inboxV2AuthorizationCollaboratorVersions.revision
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_auth_collaborator_heads_conversation_fk",
      columns: [table.tenantId, table.conversationId],
      foreignColumns: [inboxV2Conversations.tenantId, inboxV2Conversations.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_auth_collaborator_heads_work_item_fk",
      columns: [table.tenantId, table.workItemId],
      foreignColumns: [inboxV2WorkItems.tenantId, inboxV2WorkItems.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_auth_collaborator_heads_employee_fk",
      columns: [table.tenantId, table.employeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    check(
      "inbox_v2_auth_collaborator_heads_resource_check",
      collaboratorResourceColumnsSql(table)
    ),
    check(
      "inbox_v2_auth_collaborator_heads_values_check",
      sql`${table.currentRevision} >= 1`
    ),
    check(
      "inbox_v2_auth_collaborator_heads_times_check",
      finiteOrderedTimestamps(table.createdAt, table.updatedAt)
    ),
    uniqueIndex("inbox_v2_auth_collaborator_heads_conversation_unique")
      .on(table.tenantId, table.conversationId, table.employeeId)
      .where(
        sql`${table.resourceKind} = 'conversation'
          and ${table.currentState} = 'active'`
      ),
    uniqueIndex("inbox_v2_auth_collaborator_heads_work_item_unique")
      .on(
        table.tenantId,
        table.workItemId,
        table.workItemCycle,
        table.employeeId
      )
      .where(
        sql`${table.resourceKind} = 'work_item'
          and ${table.currentState} = 'active'`
      ),
    index("inbox_v2_auth_collaborator_heads_employee_idx").on(
      table.tenantId,
      table.employeeId,
      table.resourceKind,
      table.collaboratorId
    )
  ]
);

/** Successful idempotent privileged command record; denials use RBAC-007. */
export const inboxV2AuthorizationCommandRecords = pgTable(
  "inbox_v2_auth_command_records",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    clientMutationId: text("client_mutation_id").notNull(),
    commandTypeId: text("command_type_id").notNull(),
    firstRequestId: text("first_request_id").notNull(),
    requestHash: text("request_hash").notNull(),
    actorKind: inboxV2AuthorizationActorKind("actor_kind").notNull(),
    actorEmployeeId: text("actor_employee_id"),
    actorTrustedServiceId: text("actor_trusted_service_id"),
    principalScopeKey: text("principal_scope_key")
      .notNull()
      .generatedAlwaysAs(
        sql`case actor_kind
          when 'employee' then
            'employee|' || octet_length(actor_employee_id)::text || ':' ||
              actor_employee_id
          when 'trusted_service' then
            'trusted_service|' ||
              octet_length(actor_trusted_service_id)::text || ':' ||
              actor_trusted_service_id
          else null
        end`
      ),
    authorizationDecisionId: text("authorization_decision_id").notNull(),
    authorizationEpoch: text("authorization_epoch").notNull(),
    authorizationDecisionRefs: jsonb("authorization_decision_refs")
      .$type<readonly Readonly<Record<string, unknown>>[]>()
      .notNull(),
    authorizedAt: timestamp("authorized_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    authorizationNotAfter: timestamp("authorization_not_after", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    state: inboxV2AuthorizationCommandState("state").notNull(),
    mutationId: text("mutation_id"),
    publicResultCode: text("public_result_code").notNull(),
    sensitiveResultReference: text("sensitive_result_reference"),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_auth_command_records_pk",
      columns: [table.tenantId, table.id]
    }),
    unique("inbox_v2_auth_command_records_mutation_unique").on(
      table.tenantId,
      table.mutationId
    ),
    unique("inbox_v2_auth_command_records_id_mutation_unique").on(
      table.tenantId,
      table.id,
      table.mutationId
    ),
    uniqueIndex("inbox_v2_auth_command_records_idempotency_unique").on(
      table.tenantId,
      table.principalScopeKey,
      table.commandTypeId,
      table.clientMutationId
    ),
    foreignKey({
      name: "inbox_v2_auth_command_records_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_auth_command_records_employee_fk",
      columns: [table.tenantId, table.actorEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    check(
      "inbox_v2_auth_command_records_actor_check",
      actorColumnsSql(
        table.actorKind,
        table.actorEmployeeId,
        table.actorTrustedServiceId
      )
    ),
    check(
      "inbox_v2_auth_command_records_state_check",
      sql`(${table.state} = 'completed'
          and ${table.mutationId} is not null)
        or (${table.state} = 'pending'
          and ${table.mutationId} is null
          and ${table.sensitiveResultReference} is null)`
    ),
    check(
      "inbox_v2_auth_command_records_values_check",
      sql`char_length(${table.clientMutationId}) between 1 and 256
        and ${catalogIdSql(table.commandTypeId)}
        and char_length(${table.firstRequestId}) between 1 and 512
        and ${table.firstRequestId} ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
        and ${sha256Sql(table.requestHash)}
        and char_length(${table.authorizationDecisionId}) between 1 and 256
        and char_length(${table.authorizationEpoch}) between 8 and 1024
        and jsonb_typeof(${table.authorizationDecisionRefs}) = 'array'
        and jsonb_array_length(${table.authorizationDecisionRefs}) between 1 and 64
        and isfinite(${table.authorizedAt})
        and isfinite(${table.authorizationNotAfter})
        and ${table.authorizationNotAfter} > ${table.authorizedAt}
        and ${catalogIdSql(table.publicResultCode)}
        and (${table.sensitiveResultReference} is null
          or ${table.sensitiveResultReference} ~
            '^internal-ref:[a-f0-9]{32,64}$')
        and ${table.revision} >= 1
        and isfinite(${table.occurredAt})
        and ${table.createdAt} = ${table.occurredAt}
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}`
    ),
    index("inbox_v2_auth_command_records_time_idx").on(
      table.tenantId,
      table.occurredAt,
      table.id
    )
  ]
);

/** One total-order tenant Inbox stream shared by every V2 domain writer. */
export const inboxV2TenantStreamHeads = pgTable(
  "inbox_v2_tenant_stream_heads",
  {
    tenantId: text("tenant_id").notNull(),
    streamEpoch: text("stream_epoch").notNull(),
    lastPosition: bigint("last_position", { mode: "bigint" }).notNull(),
    minRetainedPosition: bigint("min_retained_position", {
      mode: "bigint"
    }).notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_tenant_stream_heads_pk",
      columns: [table.tenantId]
    }),
    foreignKey({
      name: "inbox_v2_tenant_stream_heads_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    check(
      "inbox_v2_tenant_stream_heads_values_check",
      sql`${table.lastPosition} >= 0
        and ${table.minRetainedPosition} >= 0
        and ${table.minRetainedPosition} <= ${table.lastPosition}
        and ${table.revision} >= 1
        and char_length(${table.streamEpoch}) between 8 and 256`
    ),
    check(
      "inbox_v2_tenant_stream_heads_times_check",
      finiteOrderedTimestamps(table.createdAt, table.updatedAt)
    ),
    index("inbox_v2_tenant_stream_heads_tenant_idx").on(table.tenantId)
  ]
);

export const inboxV2TenantStreamCommits = pgTable(
  "inbox_v2_tenant_stream_commits",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    mutationId: text("mutation_id").notNull(),
    streamEpoch: text("stream_epoch").notNull(),
    position: bigint("position", { mode: "bigint" }).notNull(),
    previousPosition: bigint("previous_position", {
      mode: "bigint"
    }).notNull(),
    schemaVersion: text("schema_version").notNull(),
    correlationId: text("correlation_id").notNull(),
    commandIds: jsonb("command_ids").$type<readonly string[]>().notNull(),
    clientMutationIds: jsonb("client_mutation_ids")
      .$type<readonly string[]>()
      .notNull(),
    authorizationDecisionRefs: jsonb("authorization_decision_refs")
      .$type<readonly Readonly<Record<string, unknown>>[]>()
      .notNull(),
    changeIds: jsonb("change_ids").$type<readonly string[]>().notNull(),
    eventIds: jsonb("event_ids").$type<readonly string[]>().notNull(),
    outboxIntentIds: jsonb("outbox_intent_ids")
      .$type<readonly string[]>()
      .notNull(),
    audienceImpactKind: inboxV2AudienceImpactKind(
      "audience_impact_kind"
    ).notNull(),
    audienceImpactManifest: jsonb("audience_impact_manifest")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    changeCount: integer("change_count").notNull(),
    eventCount: integer("event_count").notNull(),
    outboxIntentCount: integer("outbox_intent_count").notNull(),
    manifestDigestSha256: text("manifest_digest_sha256").notNull(),
    commitHash: text("commit_hash").notNull(),
    committedAt: timestamp("committed_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_tenant_stream_commits_pk",
      columns: [table.tenantId, table.id]
    }),
    unique("inbox_v2_tenant_stream_commits_mutation_unique").on(
      table.tenantId,
      table.id,
      table.mutationId
    ),
    unique("inbox_v2_tenant_stream_commits_position_unique").on(
      table.tenantId,
      table.streamEpoch,
      table.position
    ),
    unique("inbox_v2_tenant_stream_commits_mutation_id_unique").on(
      table.tenantId,
      table.mutationId
    ),
    foreignKey({
      name: "inbox_v2_tenant_stream_commits_head_fk",
      columns: [table.tenantId],
      foreignColumns: [inboxV2TenantStreamHeads.tenantId]
    }).onDelete("cascade"),
    check(
      "inbox_v2_tenant_stream_commits_position_check",
      sql`${table.previousPosition} >= 0
        and ${table.position} = ${table.previousPosition} + 1`
    ),
    check(
      "inbox_v2_tenant_stream_commits_manifest_check",
      sql`${table.changeCount} >= 1
        and ${table.eventCount} >= 1
        and ${table.outboxIntentCount} >= 0
        and char_length(${table.schemaVersion}) between 1 and 64
        and char_length(${table.correlationId}) between 1 and 256
        and jsonb_typeof(${table.commandIds}) = 'array'
        and jsonb_array_length(${table.commandIds}) <= 64
        and jsonb_typeof(${table.clientMutationIds}) = 'array'
        and jsonb_array_length(${table.clientMutationIds}) <= 64
        and jsonb_typeof(${table.authorizationDecisionRefs}) = 'array'
        and jsonb_array_length(${table.authorizationDecisionRefs}) <= 64
        and jsonb_typeof(${table.changeIds}) = 'array'
        and jsonb_array_length(${table.changeIds}) between 1 and 1000
        and jsonb_array_length(${table.changeIds}) = ${table.changeCount}
        and jsonb_typeof(${table.eventIds}) = 'array'
        and jsonb_array_length(${table.eventIds}) between 1 and 1000
        and jsonb_array_length(${table.eventIds}) = ${table.eventCount}
        and jsonb_typeof(${table.outboxIntentIds}) = 'array'
        and jsonb_array_length(${table.outboxIntentIds}) <= 1000
        and jsonb_array_length(${table.outboxIntentIds}) =
          ${table.outboxIntentCount}
        and jsonb_typeof(${table.audienceImpactManifest}) = 'object'
        and ${table.audienceImpactManifest}->>'kind' =
          ${table.audienceImpactKind}::text
        and ${sha256Sql(table.manifestDigestSha256)}
        and ${sha256Sql(table.commitHash)}`
    ),
    check(
      "inbox_v2_tenant_stream_commits_times_check",
      sql`isfinite(${table.committedAt})
        and ${table.createdAt} = ${table.committedAt}`
    ),
    index("inbox_v2_tenant_stream_commits_time_idx").on(
      table.tenantId,
      table.committedAt,
      table.id
    )
  ]
);

export const inboxV2TenantStreamChanges = pgTable(
  "inbox_v2_tenant_stream_changes",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    mutationId: text("mutation_id").notNull(),
    streamCommitId: text("stream_commit_id").notNull(),
    streamPosition: bigint("stream_position", { mode: "bigint" }).notNull(),
    ordinal: smallint("ordinal").notNull(),
    entityTypeId: text("entity_type_id").notNull(),
    entityId: text("entity_id").notNull(),
    resultingRevision: bigint("resulting_revision", {
      mode: "bigint"
    }).notNull(),
    timeline: jsonb("timeline").$type<Readonly<Record<string, unknown>>>(),
    audience: inboxV2TenantStreamAudience("audience").notNull(),
    stateKind: text("state_kind").notNull(),
    stateSchemaId: text("state_schema_id"),
    stateSchemaVersion: text("state_schema_version"),
    stateHash: text("state_hash").notNull(),
    payloadReference:
      jsonb("payload_reference").$type<Readonly<Record<string, unknown>>>(),
    domainCommitReference: jsonb("domain_commit_reference")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_tenant_stream_changes_pk",
      columns: [table.tenantId, table.id]
    }),
    unique("inbox_v2_tenant_stream_changes_ordinal_unique").on(
      table.tenantId,
      table.streamCommitId,
      table.ordinal
    ),
    foreignKey({
      name: "inbox_v2_tenant_stream_changes_commit_fk",
      columns: [table.tenantId, table.streamCommitId, table.mutationId],
      foreignColumns: [
        inboxV2TenantStreamCommits.tenantId,
        inboxV2TenantStreamCommits.id,
        inboxV2TenantStreamCommits.mutationId
      ]
    }).onDelete("cascade"),
    check(
      "inbox_v2_tenant_stream_changes_values_check",
      sql`${table.streamPosition} >= 1
        and ${table.ordinal} >= 1
        and ${table.resultingRevision} >= 1
        and char_length(${table.entityTypeId}) between 3 and 256
        and char_length(${table.entityId}) between 1 and 256
        and ${table.stateKind} in ('upsert', 'tombstone')
        and ${sha256Sql(table.stateHash)}
        and (${table.timeline} is null
          or jsonb_typeof(${table.timeline}) = 'object')
        and jsonb_typeof(${table.domainCommitReference}) = 'object'
        and (${table.payloadReference} is null
          or jsonb_typeof(${table.payloadReference}) = 'object')
        and ((${table.stateKind} = 'upsert'
          and ${table.stateSchemaId} is not null
          and ${table.stateSchemaVersion} is not null
          and ${table.payloadReference} is not null)
          or (${table.stateKind} = 'tombstone'
            and ${table.stateSchemaId} is null
            and ${table.stateSchemaVersion} is null
            and ${table.payloadReference} is null))
        and isfinite(${table.createdAt})`
    ),
    index("inbox_v2_tenant_stream_changes_entity_idx").on(
      table.tenantId,
      table.entityTypeId,
      table.entityId,
      table.streamPosition
    )
  ]
);

export const inboxV2DomainEvents = pgTable(
  "inbox_v2_domain_events",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    mutationId: text("mutation_id").notNull(),
    streamCommitId: text("stream_commit_id").notNull(),
    streamPosition: bigint("stream_position", { mode: "bigint" }).notNull(),
    ordinal: smallint("ordinal").notNull(),
    typeId: text("type_id").notNull(),
    payloadSchemaId: text("payload_schema_id").notNull(),
    payloadSchemaVersion: text("payload_schema_version").notNull(),
    changeIds: jsonb("change_ids").$type<readonly string[]>().notNull(),
    subjects: jsonb("subjects")
      .$type<readonly Record<string, unknown>[]>()
      .notNull(),
    payloadReference:
      jsonb("payload_reference").$type<Readonly<Record<string, unknown>>>(),
    correlationId: text("correlation_id").notNull(),
    commandIds: jsonb("command_ids").$type<readonly string[]>().notNull(),
    clientMutationIds: jsonb("client_mutation_ids")
      .$type<readonly string[]>()
      .notNull(),
    authorizationDecisionRefs: jsonb("authorization_decision_refs")
      .$type<readonly Readonly<Record<string, unknown>>[]>()
      .notNull(),
    accessEffect: inboxV2DomainEventAccessEffect("access_effect").notNull(),
    accessEffectCauses: jsonb("access_effect_causes")
      .$type<readonly string[]>()
      .notNull(),
    eventHash: text("event_hash").notNull(),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    recordedAt: timestamp("recorded_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_domain_events_pk",
      columns: [table.tenantId, table.id]
    }),
    unique("inbox_v2_domain_events_ordinal_unique").on(
      table.tenantId,
      table.streamCommitId,
      table.ordinal
    ),
    foreignKey({
      name: "inbox_v2_domain_events_commit_fk",
      columns: [table.tenantId, table.streamCommitId, table.mutationId],
      foreignColumns: [
        inboxV2TenantStreamCommits.tenantId,
        inboxV2TenantStreamCommits.id,
        inboxV2TenantStreamCommits.mutationId
      ]
    }).onDelete("cascade"),
    check(
      "inbox_v2_domain_events_values_check",
      sql`${table.streamPosition} >= 1
        and ${table.ordinal} >= 1
        and char_length(${table.typeId}) between 3 and 256
        and char_length(${table.payloadSchemaId}) between 3 and 256
        and char_length(${table.payloadSchemaVersion}) between 1 and 64
        and jsonb_typeof(${table.changeIds}) = 'array'
        and jsonb_array_length(${table.changeIds}) between 1 and 1000
        and jsonb_typeof(${table.subjects}) = 'array'
        and jsonb_array_length(${table.subjects}) between 1 and 1000
        and char_length(${table.correlationId}) between 1 and 256
        and jsonb_typeof(${table.commandIds}) = 'array'
        and jsonb_array_length(${table.commandIds}) <= 64
        and jsonb_typeof(${table.clientMutationIds}) = 'array'
        and jsonb_array_length(${table.clientMutationIds}) <= 64
        and jsonb_typeof(${table.authorizationDecisionRefs}) = 'array'
        and jsonb_array_length(${table.authorizationDecisionRefs}) <= 64
        and jsonb_typeof(${table.accessEffectCauses}) = 'array'
        and ((${table.accessEffect} = 'none'
            and jsonb_array_length(${table.accessEffectCauses}) = 0)
          or (${table.accessEffect} = 'may_change_access'
            and jsonb_array_length(${table.accessEffectCauses}) between 1 and 8))
        and (${table.payloadReference} is null
          or jsonb_typeof(${table.payloadReference}) = 'object')
        and ${sha256Sql(table.eventHash)}`
    ),
    check(
      "inbox_v2_domain_events_times_check",
      sql`isfinite(${table.occurredAt})
        and isfinite(${table.recordedAt})
        and ${table.recordedAt} >= ${table.occurredAt}`
    ),
    index("inbox_v2_domain_events_type_idx").on(
      table.tenantId,
      table.typeId,
      table.streamPosition
    )
  ]
);

export const inboxV2OutboxIntents = pgTable(
  "inbox_v2_outbox_intents",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    mutationId: text("mutation_id").notNull(),
    streamCommitId: text("stream_commit_id").notNull(),
    streamPosition: bigint("stream_position", { mode: "bigint" }).notNull(),
    ordinal: smallint("ordinal").notNull(),
    typeId: text("type_id").notNull(),
    handlerId: text("handler_id").notNull(),
    effectClass: inboxV2OutboxIntentEffectClass("effect_class").notNull(),
    eventId: text("event_id").notNull(),
    consumerDedupeKey: text("consumer_dedupe_key").notNull(),
    changeIds: jsonb("change_ids").$type<readonly string[]>().notNull(),
    payloadReference:
      jsonb("payload_reference").$type<Readonly<Record<string, unknown>>>(),
    correlationId: text("correlation_id").notNull(),
    intentHash: text("intent_hash").notNull(),
    availableAt: timestamp("available_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_outbox_intents_pk",
      columns: [table.tenantId, table.id]
    }),
    unique("inbox_v2_outbox_intents_ordinal_unique").on(
      table.tenantId,
      table.streamCommitId,
      table.ordinal
    ),
    unique("inbox_v2_outbox_intents_dedupe_unique").on(
      table.tenantId,
      table.consumerDedupeKey
    ),
    foreignKey({
      name: "inbox_v2_outbox_intents_commit_fk",
      columns: [table.tenantId, table.streamCommitId, table.mutationId],
      foreignColumns: [
        inboxV2TenantStreamCommits.tenantId,
        inboxV2TenantStreamCommits.id,
        inboxV2TenantStreamCommits.mutationId
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_outbox_intents_event_fk",
      columns: [table.tenantId, table.eventId],
      foreignColumns: [inboxV2DomainEvents.tenantId, inboxV2DomainEvents.id]
    }),
    check(
      "inbox_v2_outbox_intents_values_check",
      sql`${table.streamPosition} >= 1
        and ${table.ordinal} >= 1
        and char_length(${table.typeId}) between 3 and 256
        and char_length(${table.handlerId}) between 3 and 256
        and ${sha256Sql(table.consumerDedupeKey)}
        and char_length(${table.correlationId}) between 1 and 256
        and jsonb_typeof(${table.changeIds}) = 'array'
        and jsonb_array_length(${table.changeIds}) <= 1000
        and (${table.payloadReference} is null
          or jsonb_typeof(${table.payloadReference}) = 'object')
        and ${sha256Sql(table.intentHash)}
        and isfinite(${table.availableAt})
        and isfinite(${table.createdAt})`
    ),
    index("inbox_v2_outbox_intents_available_idx").on(
      table.tenantId,
      table.availableAt,
      table.id
    )
  ]
);

/** Immutable, PII-free successful privileged-action audit skeleton. */
export const inboxV2AuthorizationAuditEvents = pgTable(
  "inbox_v2_auth_audit_events",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    mutationId: text("mutation_id").notNull(),
    commandRecordId: text("command_record_id").notNull(),
    category: text("category").notNull(),
    actionId: text("action_id").notNull(),
    actorKind: inboxV2AuthorizationActorKind("actor_kind").notNull(),
    actorEmployeeId: text("actor_employee_id"),
    actorTrustedServiceId: text("actor_trusted_service_id"),
    targetTypeId: text("target_type_id").notNull(),
    internalTargetRef: text("internal_target_ref").notNull(),
    facetCount: smallint("facet_count").notNull(),
    facetsDigestSha256: text("facets_digest_sha256").notNull(),
    authorizationDecisionRefs: jsonb("authorization_decision_refs")
      .$type<readonly Readonly<Record<string, unknown>>[]>()
      .notNull(),
    authorizationEpoch: text("authorization_epoch").notNull(),
    revisionDeltaHash: text("revision_delta_hash").notNull(),
    reasonCodeId: text("reason_code_id").notNull(),
    clientMutationId: text("client_mutation_id").notNull(),
    commandTypeId: text("command_type_id").notNull(),
    requestHash: text("request_hash").notNull(),
    correlationId: text("correlation_id").notNull(),
    matchedPermissionIds: text("matched_permission_ids").array().notNull(),
    grantSourceIds: text("grant_source_ids").array().notNull(),
    scopeIds: text("scope_ids").array().notNull(),
    overrideReasonId: text("override_reason_id"),
    policyVersion: text("policy_version"),
    evidenceReference:
      jsonb("evidence_reference").$type<Readonly<Record<string, unknown>>>(),
    outcome: text("outcome").notNull(),
    previousAuditHash: text("previous_audit_hash"),
    auditHash: text("audit_hash").notNull(),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    recordedAt: timestamp("recorded_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_auth_audit_events_pk",
      columns: [table.tenantId, table.id]
    }),
    unique("inbox_v2_auth_audit_events_mutation_unique").on(
      table.tenantId,
      table.mutationId
    ),
    unique("inbox_v2_auth_audit_events_id_mutation_unique").on(
      table.tenantId,
      table.id,
      table.mutationId
    ),
    unique("inbox_v2_auth_audit_events_hash_unique").on(
      table.tenantId,
      table.auditHash
    ),
    foreignKey({
      name: "inbox_v2_auth_audit_events_command_fk",
      columns: [table.tenantId, table.commandRecordId, table.mutationId],
      foreignColumns: [
        inboxV2AuthorizationCommandRecords.tenantId,
        inboxV2AuthorizationCommandRecords.id,
        inboxV2AuthorizationCommandRecords.mutationId
      ]
    }),
    foreignKey({
      name: "inbox_v2_auth_audit_events_actor_fk",
      columns: [table.tenantId, table.actorEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    check(
      "inbox_v2_auth_audit_events_actor_check",
      actorColumnsSql(
        table.actorKind,
        table.actorEmployeeId,
        table.actorTrustedServiceId
      )
    ),
    check(
      "inbox_v2_auth_audit_events_reference_check",
      sql`${table.category} = 'privileged_security'
        and ${catalogIdSql(table.actionId)}
        and ${catalogIdSql(table.targetTypeId)}
        and ${table.internalTargetRef} ~ '^internal-ref:[a-f0-9]{32,64}$'
        and ${table.facetCount} between 1 and 64
        and ${sha256Sql(table.facetsDigestSha256)}
        and jsonb_typeof(${table.authorizationDecisionRefs}) = 'array'
        and jsonb_array_length(${table.authorizationDecisionRefs}) between 1 and 64
        and char_length(${table.authorizationEpoch}) between 8 and 1024
        and ${sha256Sql(table.revisionDeltaHash)}
        and ${catalogIdSql(table.reasonCodeId)}
        and char_length(${table.clientMutationId}) between 1 and 256
        and ${catalogIdSql(table.commandTypeId)}
        and ${sha256Sql(table.requestHash)}
        and char_length(${table.correlationId}) between 1 and 256
        and cardinality(${table.matchedPermissionIds}) between 1 and 256
        and array_position(${table.matchedPermissionIds}, null) is null
        and cardinality(${table.grantSourceIds}) between 1 and 256
        and array_position(${table.grantSourceIds}, null) is null
        and cardinality(${table.scopeIds}) between 1 and 256
        and array_position(${table.scopeIds}, null) is null
        and (${table.overrideReasonId} is null
          or ${catalogIdSql(table.overrideReasonId)})
        and (${table.policyVersion} is null
          or (char_length(${table.policyVersion}) between 2 and 128
            and ${table.policyVersion} ~ '^v[1-9][0-9]*$'))
        and (${table.evidenceReference} is null or (
          jsonb_typeof(${table.evidenceReference}) = 'object'
          and ${table.evidenceReference} ?&
            array['tenantId', 'recordId', 'schemaId', 'schemaVersion', 'digest']::text[]
          and (${table.evidenceReference} -
            array['tenantId', 'recordId', 'schemaId', 'schemaVersion', 'digest']::text[]) =
              '{}'::jsonb
          and ${table.evidenceReference}->>'tenantId' = ${table.tenantId}
          and ${table.evidenceReference}->>'digest' ~ '^sha256:[0-9a-f]{64}$'
        ))
        and ${table.outcome} = 'succeeded'
        and (${table.previousAuditHash} is null
          or ${sha256Sql(table.previousAuditHash)})
        and ${sha256Sql(table.auditHash)}`
    ),
    check(
      "inbox_v2_auth_audit_events_times_check",
      sql`isfinite(${table.occurredAt})
        and isfinite(${table.recordedAt})
        and isfinite(${table.expiresAt})
        and ${table.recordedAt} >= ${table.occurredAt}
        and ${table.expiresAt} > ${table.recordedAt}
        and ${table.createdAt} = ${table.recordedAt}`
    ),
    index("inbox_v2_auth_audit_events_time_idx").on(
      table.tenantId,
      table.occurredAt,
      table.id
    ),
    index("inbox_v2_auth_audit_events_target_idx").on(
      table.tenantId,
      table.targetTypeId,
      table.internalTargetRef,
      table.occurredAt
    )
  ]
);

/** Immutable target-derived audit dimensions; never current actor memberships. */
export const inboxV2AuthorizationAuditFacets = pgTable(
  "inbox_v2_auth_audit_facets",
  {
    tenantId: text("tenant_id").notNull(),
    auditEventId: text("audit_event_id").notNull(),
    ordinal: smallint("ordinal").notNull(),
    dimension: text("dimension").notNull(),
    facetKind: inboxV2AuthorizationAuditFacetKind("facet_kind").notNull(),
    entityTypeId: text("entity_type_id").notNull(),
    internalEntityRef: text("internal_entity_ref").notNull(),
    facetHash: text("facet_hash").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_auth_audit_facets_pk",
      columns: [table.tenantId, table.auditEventId, table.ordinal]
    }),
    unique("inbox_v2_auth_audit_facets_value_unique").on(
      table.tenantId,
      table.auditEventId,
      table.dimension,
      table.entityTypeId,
      table.internalEntityRef,
      table.facetKind
    ),
    foreignKey({
      name: "inbox_v2_auth_audit_facets_event_fk",
      columns: [table.tenantId, table.auditEventId],
      foreignColumns: [
        inboxV2AuthorizationAuditEvents.tenantId,
        inboxV2AuthorizationAuditEvents.id
      ]
    }).onDelete("cascade"),
    check(
      "inbox_v2_auth_audit_facets_values_check",
      sql`${table.ordinal} between 1 and 64
        and ${table.dimension} in ('tenant', 'org_unit', 'team', 'queue', 'resource')
        and case ${table.dimension}
          when 'tenant' then ${table.entityTypeId} = 'core:tenant'
          when 'org_unit' then ${table.entityTypeId} = 'core:org-unit'
          when 'team' then ${table.entityTypeId} = 'core:team'
          when 'queue' then ${table.entityTypeId} = 'core:work-queue'
          when 'resource' then ${table.entityTypeId} in (
            'core:conversation', 'core:client', 'core:work-item',
            'core:source-account'
          )
          else false
        end
        and ${table.entityTypeId} ~ '^core:[A-Za-z0-9][A-Za-z0-9._~:-]{0,250}$'
        and ${table.internalEntityRef} ~ '^internal-ref:[a-f0-9]{32,64}$'
        and ${sha256Sql(table.facetHash)}
        and isfinite(${table.createdAt})`
    ),
    index("inbox_v2_auth_audit_facets_lookup_idx").on(
      table.tenantId,
      table.dimension,
      table.entityTypeId,
      table.internalEntityRef,
      table.auditEventId
    )
  ]
);

/** Final privileged mutation closure; children are verified at commit time. */
export const inboxV2AuthorizationMutationCommits = pgTable(
  "inbox_v2_auth_mutation_commits",
  {
    tenantId: text("tenant_id").notNull(),
    mutationId: text("mutation_id").notNull(),
    commandRecordId: text("command_record_id").notNull(),
    streamCommitId: text("stream_commit_id").notNull(),
    auditEventId: text("audit_event_id").notNull(),
    revisionEffectCount: integer("revision_effect_count").notNull(),
    revisionEffectDigestSha256: text("revision_effect_digest_sha256").notNull(),
    relationWriteCount: integer("relation_write_count").notNull(),
    relationWriteDigestSha256: text("relation_write_digest_sha256").notNull(),
    projectionIntentCount: integer("projection_intent_count").notNull(),
    manifestDigestSha256: text("manifest_digest_sha256").notNull(),
    committedAt: timestamp("committed_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_auth_mutation_commits_pk",
      columns: [table.tenantId, table.mutationId]
    }),
    unique("inbox_v2_auth_mutation_commits_command_unique").on(
      table.tenantId,
      table.commandRecordId
    ),
    unique("inbox_v2_auth_mutation_commits_stream_unique").on(
      table.tenantId,
      table.streamCommitId
    ),
    unique("inbox_v2_auth_mutation_commits_audit_unique").on(
      table.tenantId,
      table.auditEventId
    ),
    foreignKey({
      name: "inbox_v2_auth_mutation_commits_command_fk",
      columns: [table.tenantId, table.commandRecordId, table.mutationId],
      foreignColumns: [
        inboxV2AuthorizationCommandRecords.tenantId,
        inboxV2AuthorizationCommandRecords.id,
        inboxV2AuthorizationCommandRecords.mutationId
      ]
    }),
    foreignKey({
      name: "inbox_v2_auth_mutation_commits_stream_fk",
      columns: [table.tenantId, table.streamCommitId, table.mutationId],
      foreignColumns: [
        inboxV2TenantStreamCommits.tenantId,
        inboxV2TenantStreamCommits.id,
        inboxV2TenantStreamCommits.mutationId
      ]
    }),
    foreignKey({
      name: "inbox_v2_auth_mutation_commits_audit_fk",
      columns: [table.tenantId, table.auditEventId, table.mutationId],
      foreignColumns: [
        inboxV2AuthorizationAuditEvents.tenantId,
        inboxV2AuthorizationAuditEvents.id,
        inboxV2AuthorizationAuditEvents.mutationId
      ]
    }),
    check(
      "inbox_v2_auth_mutation_commits_manifest_check",
      sql`${table.revisionEffectCount} >= 1
        and ${table.relationWriteCount} >= 1
        and ${table.projectionIntentCount} >= 1
        and ${sha256Sql(table.revisionEffectDigestSha256)}
        and ${sha256Sql(table.relationWriteDigestSha256)}
        and ${sha256Sql(table.manifestDigestSha256)}`
    ),
    check(
      "inbox_v2_auth_mutation_commits_times_check",
      sql`isfinite(${table.committedAt})
        and ${table.createdAt} = ${table.committedAt}`
    ),
    index("inbox_v2_auth_mutation_commits_time_idx").on(
      table.tenantId,
      table.committedAt,
      table.mutationId
    )
  ]
);

/** One bounded authorization clock delta; never an Employee x resource row. */
export const inboxV2AuthorizationRevisionEffects = pgTable(
  "inbox_v2_auth_revision_effects",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    mutationId: text("mutation_id").notNull(),
    ordinal: smallint("ordinal").notNull(),
    effectKind: inboxV2AuthorizationRevisionEffectKind("effect_kind").notNull(),
    beforeRevision: bigint("before_revision", { mode: "bigint" }).notNull(),
    afterRevision: bigint("after_revision", { mode: "bigint" }).notNull(),
    employeeId: text("employee_id"),
    resourceHeadId: text("resource_head_id"),
    workItemId: text("work_item_id"),
    workItemCycle: bigint("work_item_cycle", { mode: "bigint" }),
    expectedWorkItemRevision: bigint("expected_work_item_revision", {
      mode: "bigint"
    }),
    resultingWorkItemRevision: bigint("resulting_work_item_revision", {
      mode: "bigint"
    }),
    effectHash: text("effect_hash").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_auth_revision_effects_pk",
      columns: [table.tenantId, table.id]
    }),
    unique("inbox_v2_auth_revision_effects_ordinal_unique").on(
      table.tenantId,
      table.mutationId,
      table.ordinal
    ),
    unique("inbox_v2_auth_revision_effects_hash_unique").on(
      table.tenantId,
      table.mutationId,
      table.effectHash
    ),
    foreignKey({
      name: "inbox_v2_auth_revision_effects_commit_fk",
      columns: [table.tenantId, table.mutationId],
      foreignColumns: [
        inboxV2AuthorizationMutationCommits.tenantId,
        inboxV2AuthorizationMutationCommits.mutationId
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_auth_revision_effects_employee_fk",
      columns: [table.tenantId, table.employeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_auth_revision_effects_resource_fk",
      columns: [table.tenantId, table.resourceHeadId],
      foreignColumns: [
        inboxV2AuthorizationResourceHeads.tenantId,
        inboxV2AuthorizationResourceHeads.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_auth_revision_effects_work_item_fk",
      columns: [table.tenantId, table.workItemId],
      foreignColumns: [inboxV2WorkItems.tenantId, inboxV2WorkItems.id]
    }),
    check(
      "inbox_v2_auth_revision_effects_shape_check",
      revisionEffectColumnsSql(table)
    ),
    check(
      "inbox_v2_auth_revision_effects_values_check",
      sql`${table.ordinal} between 1 and 1000
        and ${table.beforeRevision} >= 1
        and ${table.afterRevision} = ${table.beforeRevision} + 1
        and ${sha256Sql(table.effectHash)}
        and isfinite(${table.createdAt})`
    ),
    index("inbox_v2_auth_revision_effects_target_idx").on(
      table.tenantId,
      table.effectKind,
      table.employeeId,
      table.resourceHeadId,
      table.workItemId,
      table.workItemCycle,
      table.mutationId
    ),
    uniqueIndex("inbox_v2_auth_revision_effects_tenant_clock_unique")
      .on(table.tenantId, table.effectKind, table.afterRevision)
      .where(sql`${table.effectKind} in ('tenant_rbac', 'shared_access')`),
    uniqueIndex("inbox_v2_auth_revision_effects_employee_clock_unique")
      .on(
        table.tenantId,
        table.effectKind,
        table.employeeId,
        table.afterRevision
      )
      .where(sql`${table.employeeId} is not null`),
    uniqueIndex("inbox_v2_auth_revision_effects_resource_clock_unique")
      .on(
        table.tenantId,
        table.effectKind,
        table.resourceHeadId,
        table.afterRevision
      )
      .where(sql`${table.resourceHeadId} is not null`),
    uniqueIndex("inbox_v2_auth_revision_effects_work_item_clock_unique")
      .on(
        table.tenantId,
        table.effectKind,
        table.workItemId,
        table.afterRevision
      )
      .where(sql`${table.workItemId} is not null`)
  ]
);

/** Exact immutable relation writes, separate from bounded revision effects. */
export const inboxV2AuthorizationRelationWrites = pgTable(
  "inbox_v2_auth_relation_writes",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    mutationId: text("mutation_id").notNull(),
    ordinal: smallint("ordinal").notNull(),
    relationKind: inboxV2AuthorizationRelationKind("relation_kind").notNull(),
    relationId: text("relation_id").notNull(),
    previousRevision: bigint("previous_revision", { mode: "bigint" }),
    resultingRevision: bigint("resulting_revision", {
      mode: "bigint"
    }).notNull(),
    roleId: text("role_id"),
    roleBindingId: text("role_binding_id"),
    directGrantId: text("direct_grant_id"),
    workforceMembershipId: text("workforce_membership_id"),
    structuralAccessBindingId: text("structural_access_binding_id"),
    collaboratorId: text("collaborator_id"),
    internalMembershipTransitionId: text("internal_membership_transition_id"),
    primaryResponsibilityTransitionId: text(
      "primary_responsibility_transition_id"
    ),
    servicingTeamTransitionId: text("servicing_team_transition_id"),
    writeHash: text("write_hash").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_auth_relation_writes_pk",
      columns: [table.tenantId, table.id]
    }),
    unique("inbox_v2_auth_relation_writes_ordinal_unique").on(
      table.tenantId,
      table.mutationId,
      table.ordinal
    ),
    unique("inbox_v2_auth_relation_writes_target_unique").on(
      table.tenantId,
      table.mutationId,
      table.relationKind,
      table.relationId,
      table.resultingRevision
    ),
    foreignKey({
      name: "inbox_v2_auth_relation_writes_commit_fk",
      columns: [table.tenantId, table.mutationId],
      foreignColumns: [
        inboxV2AuthorizationMutationCommits.tenantId,
        inboxV2AuthorizationMutationCommits.mutationId
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_auth_relation_writes_role_fk",
      columns: [table.tenantId, table.roleId, table.resultingRevision],
      foreignColumns: [
        inboxV2AuthorizationRoleVersions.tenantId,
        inboxV2AuthorizationRoleVersions.roleId,
        inboxV2AuthorizationRoleVersions.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_auth_relation_writes_binding_fk",
      columns: [table.tenantId, table.roleBindingId, table.resultingRevision],
      foreignColumns: [
        inboxV2AuthorizationRoleBindingVersions.tenantId,
        inboxV2AuthorizationRoleBindingVersions.bindingId,
        inboxV2AuthorizationRoleBindingVersions.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_auth_relation_writes_grant_fk",
      columns: [table.tenantId, table.directGrantId, table.resultingRevision],
      foreignColumns: [
        inboxV2AuthorizationDirectGrantVersions.tenantId,
        inboxV2AuthorizationDirectGrantVersions.grantId,
        inboxV2AuthorizationDirectGrantVersions.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_auth_relation_writes_workforce_fk",
      columns: [
        table.tenantId,
        table.workforceMembershipId,
        table.resultingRevision
      ],
      foreignColumns: [
        inboxV2AuthorizationWorkforceMembershipVersions.tenantId,
        inboxV2AuthorizationWorkforceMembershipVersions.membershipId,
        inboxV2AuthorizationWorkforceMembershipVersions.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_auth_relation_writes_structural_fk",
      columns: [
        table.tenantId,
        table.structuralAccessBindingId,
        table.resultingRevision
      ],
      foreignColumns: [
        inboxV2AuthorizationStructuralAccessVersions.tenantId,
        inboxV2AuthorizationStructuralAccessVersions.bindingId,
        inboxV2AuthorizationStructuralAccessVersions.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_auth_relation_writes_collaborator_fk",
      columns: [table.tenantId, table.collaboratorId, table.resultingRevision],
      foreignColumns: [
        inboxV2AuthorizationCollaboratorVersions.tenantId,
        inboxV2AuthorizationCollaboratorVersions.collaboratorId,
        inboxV2AuthorizationCollaboratorVersions.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_auth_relation_writes_membership_transition_fk",
      columns: [table.tenantId, table.internalMembershipTransitionId],
      foreignColumns: [
        inboxV2ParticipantMembershipTransitions.tenantId,
        inboxV2ParticipantMembershipTransitions.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_auth_relation_writes_primary_transition_fk",
      columns: [table.tenantId, table.primaryResponsibilityTransitionId],
      foreignColumns: [
        inboxV2WorkItemTransitions.tenantId,
        inboxV2WorkItemTransitions.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_auth_relation_writes_team_transition_fk",
      columns: [table.tenantId, table.servicingTeamTransitionId],
      foreignColumns: [
        inboxV2WorkItemRelationTransitions.tenantId,
        inboxV2WorkItemRelationTransitions.id
      ]
    }),
    check(
      "inbox_v2_auth_relation_writes_shape_check",
      relationWriteColumnsSql(table)
    ),
    check(
      "inbox_v2_auth_relation_writes_values_check",
      sql`${table.ordinal} between 1 and 1000
        and ((${table.previousRevision} is null
            and ${table.resultingRevision} = 1)
          or (${table.previousRevision} >= 1
            and ${table.previousRevision} < 9223372036854775807
            and ${table.resultingRevision} = ${table.previousRevision} + 1))
        and char_length(${table.relationId}) between 1 and 256
        and ${table.relationKind} <> 'client_owner'
        and ${sha256Sql(table.writeHash)}
        and isfinite(${table.createdAt})`
    ),
    index("inbox_v2_auth_relation_writes_relation_idx").on(
      table.tenantId,
      table.relationKind,
      table.relationId,
      table.resultingRevision
    )
  ]
);

function finiteOrderedTimestamps(createdAt: SQLWrapper, updatedAt: SQLWrapper) {
  return sql`isfinite(${createdAt})
    and isfinite(${updatedAt})
    and ${updatedAt} >= ${createdAt}`;
}

function actorColumnsSql(
  kind: SQLWrapper,
  employeeId: SQLWrapper,
  trustedServiceId: SQLWrapper
) {
  return sql`(
      ${kind} = 'employee'
      and ${employeeId} is not null
      and ${trustedServiceId} is null
    ) or (
      ${kind} = 'trusted_service'
      and ${employeeId} is null
      and ${trustedServiceId} is not null
      and ${catalogIdSql(trustedServiceId)}
    )`;
}

function sha256Sql(value: SQLWrapper) {
  return sql`${value} ~ '^sha256:[0-9a-f]{64}$'`;
}

function catalogIdSql(value: SQLWrapper) {
  return sql`char_length(${value}) <= 256 and (
    (
      ${value} ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part(${value}, ':', 2)) <= 160
    ) or (
      ${value} ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part(${value}, ':', 2)) <= 80
      and char_length(split_part(${value}, ':', 3)) <= 160
      and split_part(${value}, ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )`;
}

function workforceMembershipColumnsSql(table: {
  membershipKind: SQLWrapper;
  orgUnitId: SQLWrapper;
  teamId: SQLWrapper;
  workQueueId: SQLWrapper;
}) {
  return sql`case ${table.membershipKind}
    when 'org_unit' then ${table.orgUnitId} is not null
      and ${table.teamId} is null and ${table.workQueueId} is null
    when 'team' then ${table.teamId} is not null
      and ${table.orgUnitId} is null and ${table.workQueueId} is null
    when 'queue' then ${table.workQueueId} is not null
      and ${table.orgUnitId} is null and ${table.teamId} is null
    else false
  end`;
}

function structuralResourceColumnsSql(table: {
  resourceKind: SQLWrapper;
  conversationId: SQLWrapper;
  clientId: SQLWrapper;
  sourceAccountId: SQLWrapper;
}) {
  return sql`case ${table.resourceKind}
    when 'conversation' then ${table.conversationId} is not null
      and ${table.clientId} is null and ${table.sourceAccountId} is null
    when 'client' then ${table.clientId} is not null
      and ${table.conversationId} is null and ${table.sourceAccountId} is null
    when 'source_account' then ${table.sourceAccountId} is not null
      and ${table.conversationId} is null and ${table.clientId} is null
    else false
  end`;
}

function structuralTargetColumnsSql(table: {
  targetKind: SQLWrapper;
  targetOrgUnitId: SQLWrapper;
  targetTeamId: SQLWrapper;
}) {
  return sql`case ${table.targetKind}
    when 'org_unit' then ${table.targetOrgUnitId} is not null
      and ${table.targetTeamId} is null
    when 'team' then ${table.targetTeamId} is not null
      and ${table.targetOrgUnitId} is null
    else false
  end`;
}

function collaboratorResourceColumnsSql(table: {
  resourceKind: SQLWrapper;
  conversationId: SQLWrapper;
  workItemId: SQLWrapper;
  workItemCycle: SQLWrapper;
}) {
  return sql`case ${table.resourceKind}
    when 'conversation' then ${table.conversationId} is not null
      and ${table.workItemId} is null and ${table.workItemCycle} is null
    when 'work_item' then ${table.workItemId} is not null
      and ${table.workItemCycle} is not null
      and ${table.workItemCycle} >= 0
      and ${table.conversationId} is null
    else false
  end`;
}

function revisionEffectColumnsSql(table: {
  effectKind: SQLWrapper;
  employeeId: SQLWrapper;
  resourceHeadId: SQLWrapper;
  workItemId: SQLWrapper;
  workItemCycle: SQLWrapper;
  expectedWorkItemRevision: SQLWrapper;
  resultingWorkItemRevision: SQLWrapper;
}) {
  return sql`case ${table.effectKind}
    when 'tenant_rbac' then num_nonnulls(${table.employeeId},
      ${table.resourceHeadId}, ${table.workItemId}, ${table.workItemCycle},
      ${table.expectedWorkItemRevision}, ${table.resultingWorkItemRevision}) = 0
    when 'shared_access' then num_nonnulls(${table.employeeId},
      ${table.resourceHeadId}, ${table.workItemId}, ${table.workItemCycle},
      ${table.expectedWorkItemRevision}, ${table.resultingWorkItemRevision}) = 0
    when 'employee_access' then ${table.employeeId} is not null
      and num_nonnulls(${table.resourceHeadId}, ${table.workItemId},
        ${table.workItemCycle}, ${table.expectedWorkItemRevision},
        ${table.resultingWorkItemRevision}) = 0
    when 'employee_inbox_relation' then ${table.employeeId} is not null
      and num_nonnulls(${table.resourceHeadId}, ${table.workItemId},
        ${table.workItemCycle}, ${table.expectedWorkItemRevision},
        ${table.resultingWorkItemRevision}) = 0
    when 'resource_access' then ${table.employeeId} is null
      and num_nonnulls(${table.resourceHeadId}, ${table.workItemId}) = 1
      and num_nonnulls(${table.workItemCycle},
        ${table.expectedWorkItemRevision}, ${table.resultingWorkItemRevision}) = 0
    when 'collaborator_set' then ${table.employeeId} is null
      and (
        (${table.resourceHeadId} is not null
          and num_nonnulls(${table.workItemId}, ${table.workItemCycle},
            ${table.expectedWorkItemRevision},
            ${table.resultingWorkItemRevision}) = 0)
        or
        (${table.resourceHeadId} is null
          and num_nonnulls(${table.workItemId}, ${table.workItemCycle},
            ${table.expectedWorkItemRevision},
            ${table.resultingWorkItemRevision}) = 4
          and ${table.workItemCycle} >= 0
          and ${table.expectedWorkItemRevision} >= 1
          and ${table.resultingWorkItemRevision} =
            ${table.expectedWorkItemRevision} + 1)
      )
    else false
  end`;
}

function relationWriteColumnsSql(table: {
  relationKind: SQLWrapper;
  relationId: SQLWrapper;
  roleId: SQLWrapper;
  roleBindingId: SQLWrapper;
  directGrantId: SQLWrapper;
  workforceMembershipId: SQLWrapper;
  structuralAccessBindingId: SQLWrapper;
  collaboratorId: SQLWrapper;
  internalMembershipTransitionId: SQLWrapper;
  primaryResponsibilityTransitionId: SQLWrapper;
  servicingTeamTransitionId: SQLWrapper;
}) {
  const typedReferences = sql`${table.roleId}, ${table.roleBindingId},
    ${table.directGrantId}, ${table.workforceMembershipId},
    ${table.structuralAccessBindingId}, ${table.collaboratorId},
    ${table.internalMembershipTransitionId},
    ${table.primaryResponsibilityTransitionId},
    ${table.servicingTeamTransitionId}`;
  return sql`num_nonnulls(${typedReferences}) = 1
    and case ${table.relationKind}
      when 'role' then ${table.roleId} = ${table.relationId}
      when 'role_binding' then ${table.roleBindingId} = ${table.relationId}
      when 'direct_grant' then ${table.directGrantId} = ${table.relationId}
      when 'workforce_membership' then
        ${table.workforceMembershipId} = ${table.relationId}
      when 'structural_access' then
        ${table.structuralAccessBindingId} = ${table.relationId}
      when 'conversation_collaborator' then
        ${table.collaboratorId} = ${table.relationId}
      when 'work_item_collaborator' then
        ${table.collaboratorId} = ${table.relationId}
      when 'internal_membership' then
        ${table.internalMembershipTransitionId} = ${table.relationId}
      when 'primary_responsibility' then
        ${table.primaryResponsibilityTransitionId} = ${table.relationId}
      when 'servicing_team' then
        ${table.servicingTeamTransitionId} = ${table.relationId}
      else false
    end`;
}

function temporalStateSql(
  state: SQLWrapper,
  validFrom: SQLWrapper,
  validUntil: SQLWrapper,
  revokedAt: SQLWrapper,
  occurredAt: SQLWrapper
) {
  return sql`isfinite(${validFrom})
    and (${validUntil} is null or (
      isfinite(${validUntil}) and ${validUntil} > ${validFrom}
    ))
    and ((${state} = 'active'
        and ${revokedAt} is null
        and ${occurredAt} <= ${validFrom})
      or (${state} = 'revoked'
        and ${revokedAt} is not null
        and isfinite(${revokedAt})
        and ${revokedAt} > ${validFrom}
        and (${validUntil} is null or ${revokedAt} <= ${validUntil})
        and ${occurredAt} = ${revokedAt})
      or (${state} = 'archived'
        and ${revokedAt} is null
        and ${validUntil} is not null
        and ${occurredAt} >= ${validUntil}))`;
}

function bindingSubjectColumnsSql(table: {
  subjectKind: SQLWrapper;
  subjectEmployeeId: SQLWrapper;
  subjectTeamId: SQLWrapper;
  subjectOrgUnitId: SQLWrapper;
  subjectWorkQueueId: SQLWrapper;
}) {
  return sql`case ${table.subjectKind}
    when 'employee' then num_nonnulls(${table.subjectEmployeeId}) = 1
      and num_nonnulls(${table.subjectTeamId}, ${table.subjectOrgUnitId},
        ${table.subjectWorkQueueId}) = 0
    when 'team' then num_nonnulls(${table.subjectTeamId}) = 1
      and num_nonnulls(${table.subjectEmployeeId}, ${table.subjectOrgUnitId},
        ${table.subjectWorkQueueId}) = 0
    when 'org_unit' then num_nonnulls(${table.subjectOrgUnitId}) = 1
      and num_nonnulls(${table.subjectEmployeeId}, ${table.subjectTeamId},
        ${table.subjectWorkQueueId}) = 0
    when 'queue' then num_nonnulls(${table.subjectWorkQueueId}) = 1
      and num_nonnulls(${table.subjectEmployeeId}, ${table.subjectTeamId},
        ${table.subjectOrgUnitId}) = 0
    else false
  end`;
}

function scopeColumnsSql(table: {
  scopeKind: SQLWrapper;
  scopeOrgUnitMode: SQLWrapper;
  scopeOrgUnitId: SQLWrapper;
  scopeTeamId: SQLWrapper;
  scopeWorkQueueId: SQLWrapper;
  scopeClientId: SQLWrapper;
  scopeConversationId: SQLWrapper;
  scopeWorkItemId: SQLWrapper;
  scopeSourceAccountId: SQLWrapper;
}) {
  return sql`case ${table.scopeKind}
    when 'tenant' then num_nonnulls(${table.scopeOrgUnitMode},
      ${table.scopeOrgUnitId}, ${table.scopeTeamId}, ${table.scopeWorkQueueId},
      ${table.scopeClientId}, ${table.scopeConversationId},
      ${table.scopeWorkItemId}, ${table.scopeSourceAccountId}) = 0
    when 'org_unit' then ${table.scopeOrgUnitId} is not null
      and ${table.scopeOrgUnitMode} is not null
      and num_nonnulls(${table.scopeTeamId}, ${table.scopeWorkQueueId},
        ${table.scopeClientId}, ${table.scopeConversationId},
        ${table.scopeWorkItemId}, ${table.scopeSourceAccountId}) = 0
    when 'team' then ${table.scopeTeamId} is not null
      and num_nonnulls(${table.scopeOrgUnitMode}, ${table.scopeOrgUnitId},
        ${table.scopeWorkQueueId}, ${table.scopeClientId},
        ${table.scopeConversationId}, ${table.scopeWorkItemId},
        ${table.scopeSourceAccountId}) = 0
    when 'queue' then ${table.scopeWorkQueueId} is not null
      and num_nonnulls(${table.scopeOrgUnitMode}, ${table.scopeOrgUnitId},
        ${table.scopeTeamId}, ${table.scopeClientId},
        ${table.scopeConversationId}, ${table.scopeWorkItemId},
        ${table.scopeSourceAccountId}) = 0
    when 'client' then ${table.scopeClientId} is not null
      and num_nonnulls(${table.scopeOrgUnitMode}, ${table.scopeOrgUnitId},
        ${table.scopeTeamId}, ${table.scopeWorkQueueId},
        ${table.scopeConversationId}, ${table.scopeWorkItemId},
        ${table.scopeSourceAccountId}) = 0
    when 'conversation' then ${table.scopeConversationId} is not null
      and num_nonnulls(${table.scopeOrgUnitMode}, ${table.scopeOrgUnitId},
        ${table.scopeTeamId}, ${table.scopeWorkQueueId}, ${table.scopeClientId},
        ${table.scopeWorkItemId}, ${table.scopeSourceAccountId}) = 0
    when 'work_item' then ${table.scopeWorkItemId} is not null
      and num_nonnulls(${table.scopeOrgUnitMode}, ${table.scopeOrgUnitId},
        ${table.scopeTeamId}, ${table.scopeWorkQueueId}, ${table.scopeClientId},
        ${table.scopeConversationId}, ${table.scopeSourceAccountId}) = 0
    when 'source_account' then ${table.scopeSourceAccountId} is not null
      and num_nonnulls(${table.scopeOrgUnitMode}, ${table.scopeOrgUnitId},
        ${table.scopeTeamId}, ${table.scopeWorkQueueId}, ${table.scopeClientId},
        ${table.scopeConversationId}, ${table.scopeWorkItemId}) = 0
    when 'responsible' then num_nonnulls(${table.scopeOrgUnitMode},
      ${table.scopeOrgUnitId}, ${table.scopeTeamId}, ${table.scopeWorkQueueId},
      ${table.scopeClientId}, ${table.scopeConversationId},
      ${table.scopeWorkItemId}, ${table.scopeSourceAccountId}) = 0
    when 'collaborator' then num_nonnulls(${table.scopeOrgUnitMode},
      ${table.scopeOrgUnitId}, ${table.scopeTeamId}, ${table.scopeWorkQueueId},
      ${table.scopeClientId}, ${table.scopeConversationId},
      ${table.scopeWorkItemId}, ${table.scopeSourceAccountId}) = 0
    when 'internal_participant' then num_nonnulls(${table.scopeOrgUnitMode},
      ${table.scopeOrgUnitId}, ${table.scopeTeamId}, ${table.scopeWorkQueueId},
      ${table.scopeClientId}, ${table.scopeConversationId},
      ${table.scopeWorkItemId}, ${table.scopeSourceAccountId}) = 0
    when 'client_owner' then num_nonnulls(${table.scopeOrgUnitMode},
      ${table.scopeOrgUnitId}, ${table.scopeTeamId}, ${table.scopeWorkQueueId},
      ${table.scopeClientId}, ${table.scopeConversationId},
      ${table.scopeWorkItemId}, ${table.scopeSourceAccountId}) = 0
    else false
  end`;
}

/**
 * Database-side closure for revision-owned authorization state. Drizzle cannot
 * express immutable-row, monotonic-head or deferred multi-table manifests.
 */
export const INBOX_V2_AUTHORIZATION_WORK_ITEM_BRIDGE_INTEGRITY_SQL = String.raw`
create or replace function public.inbox_v2_work_item_aggregate_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_tenant_id text;
  v_work_item_id text;
  v_work public.inbox_v2_work_items%rowtype;
  v_creation public.inbox_v2_work_item_creation_decisions%rowtype;
  v_creation_queue public.inbox_v2_work_queue_versions%rowtype;
  v_creation_sla public.inbox_v2_work_item_sla_snapshots%rowtype;
  v_sla public.inbox_v2_work_item_sla_snapshots%rowtype;
  v_sla_count bigint;
  v_sla_min_revision bigint;
  v_sla_max_revision bigint;
  v_sla_cycle_count bigint;
  v_sla_min_cycle bigint;
  v_sla_max_cycle bigint;
  v_slot_revision bigint;
  v_conversation_transport public.inbox_v2_conversation_transport;
  v_expected_creation_slot_revision bigint;
  v_active_assignment_count bigint;
  v_active_assignment_id text;
  v_last_effect_opened_assignment_id text;
  v_last_effect_closed_assignment_id text;
  v_active_team_count bigint;
  v_active_team_episode_id text;
  v_active_team_id text;
  v_active_team_cycle bigint;
  v_last_effect_opened_team_episode_id text;
  v_last_effect_closed_team_episode_id text;
  v_proof_count bigint;
  v_distinct_proof_count bigint;
  v_min_proof_revision bigint;
  v_max_proof_revision bigint;
  v_collaborator_effect_count bigint;
  v_distinct_collaborator_revision_count bigint;
  v_min_collaborator_revision bigint;
  v_max_collaborator_revision bigint;
  v_reopen_count bigint;
  v_access_change_count bigint;
  v_relation_count bigint;
  v_distinct_relation_count bigint;
  v_min_relation_revision bigint;
  v_max_relation_revision bigint;
  v_transition public.inbox_v2_work_item_transitions%rowtype;
  v_relation public.inbox_v2_work_item_relation_transitions%rowtype;
  v_chain_state public.inbox_v2_work_item_state;
  v_chain_queue_id text;
  v_chain_queue_revision bigint;
  v_chain_relation_revision bigint;
  v_revision_proof record;
begin
  v_tenant_id := new.tenant_id;
  if tg_table_name = 'inbox_v2_work_items' then
    v_work_item_id := new.id;
  else
    v_work_item_id := new.work_item_id;
  end if;

  select * into v_work
    from public.inbox_v2_work_items w
   where w.tenant_id = v_tenant_id and w.id = v_work_item_id;
  if not found then
    return null;
  end if;

  select * into v_sla
    from public.inbox_v2_work_item_sla_snapshots s
   where s.tenant_id = v_work.tenant_id
     and s.work_item_id = v_work.id
     and s.sla_cycle = v_work.sla_cycle
     and s.revision = v_work.sla_snapshot_revision;
  if not found then
    raise exception 'WorkItem SLA head must reference an exact immutable snapshot'
      using errcode = '23514';
  end if;
  select count(*), min(s.revision), max(s.revision)
    into v_sla_count, v_sla_min_revision, v_sla_max_revision
    from public.inbox_v2_work_item_sla_snapshots s
   where s.tenant_id = v_work.tenant_id
     and s.work_item_id = v_work.id
     and s.sla_cycle = v_work.sla_cycle;
  if v_sla_min_revision <> 1
     or v_sla_max_revision <> v_work.sla_snapshot_revision
     or v_sla_count <> v_work.sla_snapshot_revision then
    raise exception 'WorkItem SLA snapshot revisions must be contiguous through the cycle head'
      using errcode = '23514';
  end if;
  select count(distinct s.sla_cycle), min(s.sla_cycle), max(s.sla_cycle)
    into v_sla_cycle_count, v_sla_min_cycle, v_sla_max_cycle
    from public.inbox_v2_work_item_sla_snapshots s
   where s.tenant_id = v_work.tenant_id and s.work_item_id = v_work.id;
  if v_sla_min_cycle <> 1
     or v_sla_max_cycle <> v_work.sla_cycle
     or v_sla_cycle_count <> v_work.sla_cycle
     or exists (
       select 1
         from public.inbox_v2_work_item_sla_snapshots s
        where s.tenant_id = v_work.tenant_id
          and s.work_item_id = v_work.id
        group by s.sla_cycle
       having min(s.revision) <> 1 or count(*) <> max(s.revision)
     ) then
    raise exception 'WorkItem SLA cycles and per-cycle revisions must be gap-free'
      using errcode = '23514';
  end if;

  select * into v_creation
    from public.inbox_v2_work_item_creation_decisions d
   where d.tenant_id = v_work.tenant_id and d.work_item_id = v_work.id;
  select * into v_creation_queue
    from public.inbox_v2_work_queue_versions q
   where q.tenant_id = v_creation.tenant_id
     and q.work_queue_id = v_creation.work_queue_id
     and q.revision = v_creation.work_queue_revision;
  select * into v_creation_sla
    from public.inbox_v2_work_item_sla_snapshots s
   where s.tenant_id = v_work.tenant_id
     and s.work_item_id = v_work.id
     and s.sla_cycle = 1
     and s.revision = 1;
  select c.transport into v_conversation_transport
    from public.inbox_v2_conversations c
   where c.tenant_id = v_work.tenant_id and c.id = v_work.conversation_id;
  select s.revision into v_slot_revision
    from public.inbox_v2_conversation_work_item_slots s
   where s.tenant_id = v_work.tenant_id
     and s.conversation_id = v_work.conversation_id;
  select 1 + v_work.ordinal + count(t.id)
    into v_expected_creation_slot_revision
    from public.inbox_v2_work_items prior
    join public.inbox_v2_work_item_transitions t
      on t.tenant_id = prior.tenant_id and t.work_item_id = prior.id
   where prior.tenant_id = v_work.tenant_id
     and prior.conversation_id = v_work.conversation_id
     and prior.ordinal < v_work.ordinal
     and t.kind in (
       'close_resolved',
       'close_dismissed',
       'reopen_unassigned',
       'reopen_assigned'
     );
  if v_creation.work_item_id is null
     or v_creation.conversation_id <> v_work.conversation_id
     or v_creation.transport <> v_conversation_transport
     or v_creation.reason_id <> v_work.creation_reason_id
     or v_work.created_actor_kind <> 'trusted_service'
     or v_creation.decided_by_trusted_service_id <>
        v_work.created_actor_trusted_service_id
     or v_creation.decided_at > v_work.created_at
     or v_creation.slot_after_revision > v_slot_revision
     or v_creation.slot_after_revision <>
        v_expected_creation_slot_revision
     or (v_work.ordinal = 1 and
       v_creation.latest_terminal_handling <> 'no_latest_work_item')
     or (v_work.ordinal > 1 and
       v_creation.latest_terminal_handling <> 'create_sequential') then
    raise exception 'WorkItem must retain its exact creation decision authority'
      using errcode = '23514';
  end if;

  if v_creation_sla.revision is null
     or v_creation_sla.kind <> v_creation_queue.default_sla_kind
     or v_creation_sla.calculated_at <> v_work.created_at
     or v_creation_sla.created_at <> v_work.created_at
     or (
       v_creation_queue.default_sla_kind = 'tracked'
       and (
         v_creation_sla.policy_id <>
            v_creation_queue.default_sla_policy_id
         or v_creation_sla.policy_version <>
            v_creation_queue.default_sla_policy_version
         or v_creation_sla.policy_revision <>
            v_creation_queue.default_sla_policy_revision
         or v_creation_sla.input_revision <> 1
         or v_creation_sla.business_calendar_id <>
            v_creation_queue.default_business_calendar_id
         or v_creation_sla.business_calendar_version <>
            v_creation_queue.default_business_calendar_version
         or v_creation_sla.business_calendar_revision <>
            v_creation_queue.default_business_calendar_revision
         or v_creation_sla.time_zone <>
            v_creation_queue.default_sla_time_zone
         or v_creation_sla.clock_state <> 'running'
         or v_creation_sla.started_at <> v_work.created_at
         or v_creation_sla.paused_at is not null
         or v_creation_sla.pause_condition_id is not null
         or v_creation_sla.stopped_at is not null
         or v_creation_sla.first_human_response_at is not null
       )
     ) then
    raise exception 'WorkItem cycle-one SLA must retain exact creation Queue defaults'
      using errcode = '23514';
  end if;

  if v_work.revision = 1 and (
    v_work.state <> 'new'
    or v_work.queue_id <> v_creation.work_queue_id
    or v_work.queue_revision <> v_creation.work_queue_revision
    or v_work.reopen_cycle <> 0
    or v_work.servicing_team_relation_revision <> 1
    or v_work.collaborator_set_revision <> 1
    or v_work.resource_access_revision <> 1
    or v_work.priority_id <> v_creation_queue.default_priority_id
    or v_work.sla_cycle <> 1
    or v_work.sla_snapshot_revision <> 1
    or v_work.current_primary_assignment_id is not null
    or v_work.current_servicing_team_episode_id is not null
  ) then
    raise exception 'Revision-one WorkItem must be the unassigned creation snapshot'
      using errcode = '23514';
  end if;

  if v_sla.kind = 'tracked' and (
       (v_work.state in ('resolved', 'dismissed') and
         (
           v_sla.clock_state <> 'stopped'
           or v_sla.stopped_at <> v_work.updated_at
           or v_sla.calculated_at <> v_work.updated_at
         ))
       or (v_work.state in ('new', 'assigned', 'in_progress', 'waiting') and
         v_sla.clock_state = 'stopped')
     ) then
    raise exception 'Tracked SLA clock state must follow WorkItem terminality'
      using errcode = '23514';
  end if;

  select
    count(*) filter (where a.state = 'active'),
    max(a.id) filter (where a.state = 'active')
    into v_active_assignment_count, v_active_assignment_id
    from public.inbox_v2_work_item_primary_assignments a
   where a.tenant_id = v_work.tenant_id and a.work_item_id = v_work.id;
  if (
      v_work.state in ('assigned', 'in_progress', 'waiting')
      and (
        v_active_assignment_count <> 1
        or v_work.current_primary_assignment_id is distinct from
           v_active_assignment_id
      )
    ) or (
      v_work.state in ('new', 'resolved', 'dismissed')
      and (
        v_active_assignment_count <> 0
        or v_work.current_primary_assignment_id is not null
      )
    ) then
    raise exception 'WorkItem state and active primary-assignment head diverged'
      using errcode = '23514';
  end if;
  if v_work.last_primary_assignment_id is not null and not exists (
    select 1
      from public.inbox_v2_work_item_primary_assignments a
     where a.tenant_id = v_work.tenant_id
       and a.work_item_id = v_work.id
       and a.id = v_work.last_primary_assignment_id
  ) then
    raise exception 'WorkItem last primary-assignment pointer crosses aggregate scope'
      using errcode = '23514';
  end if;
  select t.opened_primary_assignment_id, t.closed_primary_assignment_id
    into v_last_effect_opened_assignment_id,
         v_last_effect_closed_assignment_id
    from public.inbox_v2_work_item_transitions t
   where t.tenant_id = v_work.tenant_id
     and t.work_item_id = v_work.id
     and (
       t.opened_primary_assignment_id is not null
       or t.closed_primary_assignment_id is not null
     )
   order by t.resulting_revision desc
   limit 1;
  if v_work.last_primary_assignment_id is distinct from coalesce(
       v_last_effect_opened_assignment_id,
       v_last_effect_closed_assignment_id
     )
     or (v_work.state in ('assigned', 'in_progress', 'waiting') and
       v_work.current_primary_assignment_id is distinct from
         v_last_effect_opened_assignment_id) then
    raise exception 'WorkItem primary-assignment pointers must follow the latest assignment effect'
      using errcode = '23514';
  end if;

  select
    count(*) filter (where e.state = 'active'),
    max(e.id) filter (where e.state = 'active'),
    max(e.team_id) filter (where e.state = 'active'),
    max(e.work_item_cycle) filter (where e.state = 'active')
    into v_active_team_count,
         v_active_team_episode_id,
         v_active_team_id,
         v_active_team_cycle
    from public.inbox_v2_work_item_servicing_team_episodes e
   where e.tenant_id = v_work.tenant_id and e.work_item_id = v_work.id;
  if v_work.state in ('resolved', 'dismissed') and v_active_team_count <> 0 then
    raise exception 'Terminal WorkItem cannot retain an active servicing team'
      using errcode = '23514';
  end if;
  if (
      v_work.current_servicing_team_episode_id is null
      and (v_active_team_count <> 0 or v_work.current_servicing_team_id is not null)
    ) or (
      v_work.current_servicing_team_episode_id is not null
      and (
        v_active_team_count <> 1
        or v_work.current_servicing_team_episode_id is distinct from
           v_active_team_episode_id
        or v_work.current_servicing_team_id is distinct from v_active_team_id
        or v_work.reopen_cycle <> v_active_team_cycle
      )
    ) then
    raise exception 'WorkItem servicing-team head is not the exact active episode'
      using errcode = '23514';
  end if;
  if v_work.last_servicing_team_episode_id is not null and not exists (
    select 1
      from public.inbox_v2_work_item_servicing_team_episodes e
     where e.tenant_id = v_work.tenant_id
       and e.work_item_id = v_work.id
       and e.id = v_work.last_servicing_team_episode_id
  ) then
    raise exception 'WorkItem last servicing-team pointer crosses aggregate scope'
      using errcode = '23514';
  end if;
  select effect.opened_episode_id, effect.closed_episode_id
    into v_last_effect_opened_team_episode_id,
         v_last_effect_closed_team_episode_id
    from (
      select
        r.resulting_work_item_revision as work_item_revision,
        r.next_episode_id as opened_episode_id,
        r.previous_episode_id as closed_episode_id
      from public.inbox_v2_work_item_relation_transitions r
      where r.tenant_id = v_work.tenant_id and r.work_item_id = v_work.id
      union all
      select
        t.resulting_revision as work_item_revision,
        null::text as opened_episode_id,
        t.closed_servicing_team_episode_id as closed_episode_id
      from public.inbox_v2_work_item_transitions t
      where t.tenant_id = v_work.tenant_id
        and t.work_item_id = v_work.id
        and t.closed_servicing_team_episode_id is not null
    ) effect
   order by effect.work_item_revision desc
   limit 1;
  if v_work.last_servicing_team_episode_id is distinct from coalesce(
       v_last_effect_opened_team_episode_id,
       v_last_effect_closed_team_episode_id
     )
     or (v_work.current_servicing_team_episode_id is not null and
       v_work.current_servicing_team_episode_id is distinct from
         v_last_effect_opened_team_episode_id) then
    raise exception 'WorkItem servicing-team pointers must follow the latest relation effect'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.inbox_v2_work_item_primary_assignments a
     where a.tenant_id = v_work.tenant_id
       and a.work_item_id = v_work.id
       and a.state = 'ended'
       and not exists (
         select 1
           from public.inbox_v2_work_item_transitions t
          where t.tenant_id = a.tenant_id
            and t.work_item_id = a.work_item_id
            and t.id = a.termination_transition_id
            and t.closed_primary_assignment_id = a.id
            and t.occurred_at = a.end_recorded_at
            and t.actor_kind = a.ended_actor_kind
            and t.actor_employee_id is not distinct from a.ended_actor_employee_id
            and t.actor_authorization_epoch is not distinct from
                a.ended_actor_authorization_epoch
            and t.actor_trusted_service_id is not distinct from
                a.ended_actor_trusted_service_id
            and t.reason_id = a.end_reason_id
            and (
              (t.kind in ('recovery_requeue', 'recovery_transfer')
                and a.end_basis = 'employee_fence_time')
              or (t.kind in (
                'release',
                'transfer',
                'close_resolved',
                'close_dismissed'
              ) and a.end_basis = 'command_time')
            )
       )
  ) then
    raise exception 'Ended assignment must name its exact WorkItem transition'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.inbox_v2_work_item_primary_assignments a
      join public.inbox_v2_work_queue_eligibility_decisions d
        on d.tenant_id = a.tenant_id and d.id = a.eligibility_decision_id
     where a.tenant_id = v_work.tenant_id
       and a.work_item_id = v_work.id
       and not exists (
         select 1
           from public.inbox_v2_work_item_transitions t
          where t.tenant_id = a.tenant_id
            and t.work_item_id = a.work_item_id
            and t.opened_primary_assignment_id = a.id
            and t.expected_revision = d.expected_work_item_revision
            and t.destination_queue_id = a.queue_at_start_id
            and t.destination_queue_revision = a.queue_at_start_revision
            and t.occurred_at = a.started_at
            and a.created_at = t.occurred_at
            and d.decided_at = t.occurred_at
            and d.employee_fence_loaded_at = t.occurred_at
            and t.actor_kind = a.started_actor_kind
            and t.actor_employee_id is not distinct from a.started_actor_employee_id
            and t.actor_authorization_epoch is not distinct from
                a.started_actor_authorization_epoch
            and t.actor_trusted_service_id is not distinct from
                a.started_actor_trusted_service_id
            and t.reason_id = a.start_reason_id
            and (
              (t.kind = 'claim'
                and a.source = 'claim'
                and t.actor_kind = 'employee'
                and t.actor_employee_id = a.employee_id)
              or (t.kind = 'assign' and
                a.source in ('manual_assignment', 'policy_assignment'))
              or (t.kind = 'transfer' and a.source = 'transfer')
              or (t.kind = 'reopen_assigned' and a.source = 'reopen')
              or (t.kind = 'recovery_transfer' and
                a.source = 'recovery_transfer')
            )
       )
  ) then
    raise exception 'Primary assignment must retain its exact opening transition'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.inbox_v2_work_item_transitions t
     where t.tenant_id = v_work.tenant_id
       and t.work_item_id = v_work.id
       and (
         (t.opened_primary_assignment_id is not null and not exists (
           select 1
             from public.inbox_v2_work_item_primary_assignments a
             join public.inbox_v2_work_queue_eligibility_decisions d
               on d.tenant_id = a.tenant_id
              and d.id = a.eligibility_decision_id
            where a.tenant_id = t.tenant_id
              and a.work_item_id = t.work_item_id
              and a.id = t.opened_primary_assignment_id
              and d.expected_work_item_revision = t.expected_revision
              and a.queue_at_start_id = t.destination_queue_id
              and a.queue_at_start_revision = t.destination_queue_revision
              and a.started_at = t.occurred_at
              and a.created_at = t.occurred_at
              and d.decided_at = t.occurred_at
              and d.employee_fence_loaded_at = t.occurred_at
              and a.started_actor_kind = t.actor_kind
              and a.started_actor_employee_id is not distinct from
                  t.actor_employee_id
              and a.started_actor_authorization_epoch is not distinct from
                  t.actor_authorization_epoch
              and a.started_actor_trusted_service_id is not distinct from
                  t.actor_trusted_service_id
              and a.start_reason_id = t.reason_id
              and (
                (t.kind = 'claim'
                  and a.source = 'claim'
                  and t.actor_kind = 'employee'
                  and t.actor_employee_id = a.employee_id)
                or (t.kind = 'assign' and
                  a.source in ('manual_assignment', 'policy_assignment'))
                or (t.kind = 'transfer' and a.source = 'transfer')
                or (t.kind = 'reopen_assigned' and a.source = 'reopen')
                or (t.kind = 'recovery_transfer' and
                  a.source = 'recovery_transfer')
              )
         ))
         or (t.closed_primary_assignment_id is not null and not exists (
           select 1
             from public.inbox_v2_work_item_primary_assignments a
            where a.tenant_id = t.tenant_id
              and a.work_item_id = t.work_item_id
              and a.id = t.closed_primary_assignment_id
              and a.state = 'ended'
              and a.termination_transition_id = t.id
              and a.end_recorded_at = t.occurred_at
              and a.ended_actor_kind = t.actor_kind
              and a.ended_actor_employee_id is not distinct from
                  t.actor_employee_id
              and a.ended_actor_authorization_epoch is not distinct from
                  t.actor_authorization_epoch
              and a.ended_actor_trusted_service_id is not distinct from
                  t.actor_trusted_service_id
              and a.end_reason_id = t.reason_id
              and (
                (t.kind in ('recovery_requeue', 'recovery_transfer')
                  and a.end_basis = 'employee_fence_time')
                or (t.kind in (
                  'release',
                  'transfer',
                  'close_resolved',
                  'close_dismissed'
                ) and a.end_basis = 'command_time')
              )
         ))
       )
  ) then
    raise exception 'WorkItem transition assignment effect lacks exact bidirectional history'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.inbox_v2_work_item_transitions t
      join public.inbox_v2_work_item_primary_assignments closed
        on closed.tenant_id = t.tenant_id
       and closed.id = t.closed_primary_assignment_id
      join public.inbox_v2_work_item_primary_assignments opened
        on opened.tenant_id = t.tenant_id
       and opened.id = t.opened_primary_assignment_id
     where t.tenant_id = v_work.tenant_id
       and t.work_item_id = v_work.id
       and t.kind in ('transfer', 'recovery_transfer')
       and closed.employee_id = opened.employee_id
       and closed.queue_at_start_id = opened.queue_at_start_id
       and closed.queue_at_start_revision = opened.queue_at_start_revision
  ) then
    raise exception 'Primary transfer must change Employee or Queue'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.inbox_v2_work_item_servicing_team_episodes e
     where e.tenant_id = v_work.tenant_id
       and e.work_item_id = v_work.id
       and e.state = 'ended'
       and (
         (e.end_cause = 'relation_command' and not exists (
           select 1
             from public.inbox_v2_work_item_relation_transitions r
            where r.tenant_id = e.tenant_id
              and r.work_item_id = e.work_item_id
              and r.id = e.end_relation_transition_id
              and r.previous_episode_id = e.id
              and r.occurred_at = e.end_recorded_at
              and r.occurred_at = e.ended_at
         ))
         or (e.end_cause = 'work_item_terminal' and not exists (
           select 1
             from public.inbox_v2_work_item_transitions t
            where t.tenant_id = e.tenant_id
              and t.work_item_id = e.work_item_id
              and t.id = e.end_work_item_transition_id
              and t.kind in ('close_resolved', 'close_dismissed')
              and t.closed_servicing_team_episode_id = e.id
              and t.occurred_at = e.end_recorded_at
              and t.occurred_at = e.ended_at
         ))
       )
  ) then
    raise exception 'Ended servicing-team episode must name its exact transition'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.inbox_v2_work_item_relation_transitions r
      join public.inbox_v2_work_item_servicing_team_episodes previous
        on previous.tenant_id = r.tenant_id
       and previous.id = r.previous_episode_id
      join public.inbox_v2_work_item_servicing_team_episodes following
        on following.tenant_id = r.tenant_id
       and following.id = r.next_episode_id
     where r.tenant_id = v_work.tenant_id
       and r.work_item_id = v_work.id
       and r.kind = 'servicing_team_change'
       and previous.team_id = following.team_id
  ) then
    raise exception 'Servicing-team change must target a different Team'
      using errcode = '23514';
  end if;

  select count(*), count(distinct p.resulting_revision),
         min(p.resulting_revision), max(p.resulting_revision)
    into v_proof_count, v_distinct_proof_count,
         v_min_proof_revision, v_max_proof_revision
    from (
      select t.resulting_revision
        from public.inbox_v2_work_item_transitions t
       where t.tenant_id = v_work.tenant_id and t.work_item_id = v_work.id
      union all
      select r.resulting_work_item_revision
        from public.inbox_v2_work_item_relation_transitions r
       where r.tenant_id = v_work.tenant_id and r.work_item_id = v_work.id
      union all
      select effect_row.resulting_work_item_revision
        from public.inbox_v2_auth_revision_effects effect_row
       where effect_row.tenant_id = v_work.tenant_id
         and effect_row.effect_kind = 'collaborator_set'
         and effect_row.work_item_id = v_work.id
    ) p;
  if (v_work.revision = 1 and v_proof_count <> 0)
     or (v_work.revision > 1 and (
       v_proof_count <> v_work.revision - 1
       or v_distinct_proof_count <> v_proof_count
       or v_min_proof_revision <> 2
       or v_max_proof_revision <> v_work.revision
     )) then
    raise exception 'WorkItem revision chain requires exactly one immutable proof per +1'
      using errcode = '23514';
  end if;

  select count(*) into v_reopen_count
    from public.inbox_v2_work_item_transitions t
   where t.tenant_id = v_work.tenant_id
     and t.work_item_id = v_work.id
     and t.kind in ('reopen_unassigned', 'reopen_assigned');
  select count(*), count(distinct effect_row.after_revision),
         min(effect_row.before_revision), max(effect_row.after_revision)
    into v_collaborator_effect_count,
         v_distinct_collaborator_revision_count,
         v_min_collaborator_revision, v_max_collaborator_revision
    from public.inbox_v2_auth_revision_effects effect_row
   where effect_row.tenant_id = v_work.tenant_id
     and effect_row.effect_kind = 'collaborator_set'
     and effect_row.work_item_id = v_work.id;
  if v_work.reopen_cycle <> v_reopen_count
     or v_work.collaborator_set_revision < 1
     or v_collaborator_effect_count <>
        v_work.collaborator_set_revision - 1
     or v_distinct_collaborator_revision_count <>
        v_collaborator_effect_count
     or (v_collaborator_effect_count > 0 and (
       v_min_collaborator_revision <> 1
       or v_max_collaborator_revision <> v_work.collaborator_set_revision
     ))
     or exists (
       select 1
         from public.inbox_v2_auth_revision_effects effect_row
        where effect_row.tenant_id = v_work.tenant_id
          and effect_row.effect_kind = 'collaborator_set'
          and effect_row.work_item_id = v_work.id
          and (
            effect_row.resulting_work_item_revision <>
              effect_row.expected_work_item_revision + 1
            or effect_row.work_item_cycle <> (
              select count(*)
                from public.inbox_v2_work_item_transitions reopen
               where reopen.tenant_id = effect_row.tenant_id
                 and reopen.work_item_id = effect_row.work_item_id
                 and reopen.resulting_revision <=
                   effect_row.expected_work_item_revision
                 and reopen.kind in ('reopen_unassigned', 'reopen_assigned')
            )
          )
     ) then
    raise exception 'WorkItem reopen/collaborator revisions lack exact history proof'
      using errcode = '23514';
  end if;

  select count(*) into v_access_change_count
    from (
      select t.id
        from public.inbox_v2_work_item_transitions t
       where t.tenant_id = v_work.tenant_id
         and t.work_item_id = v_work.id
         and (
           t.opened_primary_assignment_id is not null
           or t.closed_primary_assignment_id is not null
           or t.source_queue_id <> t.destination_queue_id
           or t.source_queue_revision <> t.destination_queue_revision
           or t.from_state in ('resolved', 'dismissed')
           or t.to_state in ('resolved', 'dismissed')
         )
      union all
      select r.id
        from public.inbox_v2_work_item_relation_transitions r
       where r.tenant_id = v_work.tenant_id and r.work_item_id = v_work.id
    ) access_change;
  if v_work.resource_access_revision <> 1 + v_access_change_count then
    raise exception 'WorkItem resource-access revision lacks exact authority-change proof'
      using errcode = '23514';
  end if;

  v_chain_state := 'new';
  v_chain_queue_id := v_creation.work_queue_id;
  v_chain_queue_revision := v_creation.work_queue_revision;
  for v_transition in
    select *
      from public.inbox_v2_work_item_transitions t
     where t.tenant_id = v_work.tenant_id and t.work_item_id = v_work.id
     order by t.resulting_revision
  loop
    if v_transition.from_state <> v_chain_state
       or v_transition.source_queue_id <> v_chain_queue_id
       or v_transition.source_queue_revision <> v_chain_queue_revision then
      raise exception 'WorkItem transition source breaks the persisted lifecycle chain'
        using errcode = '23514';
    end if;
    v_chain_state := v_transition.to_state;
    v_chain_queue_id := v_transition.destination_queue_id;
    v_chain_queue_revision := v_transition.destination_queue_revision;
  end loop;
  if v_chain_state <> v_work.state
     or v_chain_queue_id <> v_work.queue_id
     or v_chain_queue_revision <> v_work.queue_revision then
    raise exception 'WorkItem lifecycle transition chain does not induce the head'
      using errcode = '23514';
  end if;

  v_chain_relation_revision := 1;
  for v_revision_proof in
    select
      t.resulting_revision as work_item_revision,
      t.expected_servicing_team_relation_revision as expected_relation_revision,
      t.resulting_servicing_team_relation_revision as resulting_relation_revision
    from public.inbox_v2_work_item_transitions t
    where t.tenant_id = v_work.tenant_id and t.work_item_id = v_work.id
    union all
    select
      r.resulting_work_item_revision as work_item_revision,
      r.expected_relation_revision,
      r.resulting_relation_revision
    from public.inbox_v2_work_item_relation_transitions r
    where r.tenant_id = v_work.tenant_id and r.work_item_id = v_work.id
    order by work_item_revision
  loop
    if v_revision_proof.expected_relation_revision <>
         v_chain_relation_revision then
      raise exception 'WorkItem proof breaks the servicing-team relation chain'
        using errcode = '23514';
    end if;
    v_chain_relation_revision := v_revision_proof.resulting_relation_revision;
  end loop;
  if v_chain_relation_revision <> v_work.servicing_team_relation_revision then
    raise exception 'Servicing-team relation proof chain does not induce the head'
      using errcode = '23514';
  end if;

  select * into v_transition
    from public.inbox_v2_work_item_transitions t
   where t.tenant_id = v_work.tenant_id
     and t.work_item_id = v_work.id
     and t.resulting_revision = v_work.revision;
  if found and (
    v_transition.occurred_at <> v_work.updated_at
    or v_transition.resulting_servicing_team_relation_revision <>
       v_work.servicing_team_relation_revision
  ) then
    raise exception 'Latest WorkItem transition timestamp/relation does not induce the head'
      using errcode = '23514';
  end if;

  select count(*), count(distinct p.resulting_relation_revision),
         min(p.resulting_relation_revision), max(p.resulting_relation_revision)
    into v_relation_count, v_distinct_relation_count,
         v_min_relation_revision, v_max_relation_revision
    from (
      select r.resulting_relation_revision
        from public.inbox_v2_work_item_relation_transitions r
       where r.tenant_id = v_work.tenant_id and r.work_item_id = v_work.id
      union all
      select t.resulting_servicing_team_relation_revision
        from public.inbox_v2_work_item_transitions t
       where t.tenant_id = v_work.tenant_id
         and t.work_item_id = v_work.id
         and t.closed_servicing_team_episode_id is not null
    ) p;
  if (v_work.servicing_team_relation_revision = 1 and v_relation_count <> 0)
     or (v_work.servicing_team_relation_revision > 1 and (
       v_relation_count <> v_work.servicing_team_relation_revision - 1
       or v_distinct_relation_count <> v_relation_count
       or v_min_relation_revision <> 2
       or v_max_relation_revision <> v_work.servicing_team_relation_revision
     )) then
    raise exception 'Servicing-team relation revision chain is not contiguous'
      using errcode = '23514';
  end if;

  select * into v_relation
    from public.inbox_v2_work_item_relation_transitions r
   where r.tenant_id = v_work.tenant_id
     and r.work_item_id = v_work.id
     and r.resulting_work_item_revision = v_work.revision;
  if found then
    if v_relation.resulting_relation_revision <>
         v_work.servicing_team_relation_revision
       or v_relation.occurred_at <> v_work.updated_at
       or (v_relation.kind = 'servicing_team_add' and (
         v_work.current_servicing_team_episode_id is distinct from
           v_relation.next_episode_id
         or v_relation.previous_episode_id is not null
       ))
       or (v_relation.kind = 'servicing_team_remove' and (
         v_work.current_servicing_team_episode_id is not null
         or v_relation.next_episode_id is not null
       ))
       or (v_relation.kind = 'servicing_team_change' and
         v_work.current_servicing_team_episode_id is distinct from
           v_relation.next_episode_id) then
      raise exception 'Latest servicing-team transition does not induce the relation head'
        using errcode = '23514';
    end if;
  end if;

  if exists (
    select 1
      from public.inbox_v2_work_item_relation_transitions r
     where r.tenant_id = v_work.tenant_id
       and r.work_item_id = v_work.id
       and (
         (r.previous_episode_id is not null and not exists (
           select 1
             from public.inbox_v2_work_item_servicing_team_episodes e
            where e.tenant_id = r.tenant_id
              and e.work_item_id = r.work_item_id
              and e.id = r.previous_episode_id
              and e.state = 'ended'
              and e.end_cause = 'relation_command'
              and e.end_relation_transition_id = r.id
              and e.end_recorded_at = r.occurred_at
              and e.ended_at = r.occurred_at
              and e.ended_actor_kind = r.actor_kind
              and e.ended_actor_employee_id is not distinct from
                  r.actor_employee_id
              and e.ended_actor_authorization_epoch is not distinct from
                  r.actor_authorization_epoch
              and e.ended_actor_trusted_service_id is not distinct from
                  r.actor_trusted_service_id
              and e.end_reason_id = r.reason_id
         ))
         or (r.next_episode_id is not null and not exists (
           select 1
             from public.inbox_v2_work_item_servicing_team_episodes e
            where e.tenant_id = r.tenant_id
              and e.work_item_id = r.work_item_id
              and e.id = r.next_episode_id
              and e.started_at = r.occurred_at
              and e.started_actor_kind = r.actor_kind
              and e.started_actor_employee_id is not distinct from
                  r.actor_employee_id
              and e.started_actor_authorization_epoch is not distinct from
                  r.actor_authorization_epoch
              and e.started_actor_trusted_service_id is not distinct from
                  r.actor_trusted_service_id
              and e.start_reason_id = r.reason_id
              and e.work_item_cycle = (
                select count(*)
                  from public.inbox_v2_work_item_transitions reopen
                 where reopen.tenant_id = r.tenant_id
                   and reopen.work_item_id = r.work_item_id
                   and reopen.resulting_revision <=
                       r.expected_work_item_revision
                   and reopen.kind in (
                     'reopen_unassigned',
                     'reopen_assigned'
                   )
              )
         ))
       )
  ) then
    raise exception 'Servicing-team transition episode pointers cross aggregate scope'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.inbox_v2_work_item_servicing_team_episodes e
     where e.tenant_id = v_work.tenant_id
       and e.work_item_id = v_work.id
       and not exists (
         select 1
           from public.inbox_v2_work_item_relation_transitions r
          where r.tenant_id = e.tenant_id
            and r.work_item_id = e.work_item_id
            and r.next_episode_id = e.id
            and r.occurred_at = e.started_at
            and r.actor_kind = e.started_actor_kind
            and r.actor_employee_id is not distinct from
                e.started_actor_employee_id
            and r.actor_authorization_epoch is not distinct from
                e.started_actor_authorization_epoch
            and r.actor_trusted_service_id is not distinct from
                e.started_actor_trusted_service_id
            and r.reason_id = e.start_reason_id
            and e.work_item_cycle = (
              select count(*)
                from public.inbox_v2_work_item_transitions reopen
               where reopen.tenant_id = r.tenant_id
                 and reopen.work_item_id = r.work_item_id
                 and reopen.resulting_revision <=
                     r.expected_work_item_revision
                 and reopen.kind in ('reopen_unassigned', 'reopen_assigned')
            )
       )
  ) then
    raise exception 'Servicing-team episode must retain its exact opening relation transition'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.inbox_v2_work_item_transitions t
     where t.tenant_id = v_work.tenant_id
       and t.work_item_id = v_work.id
       and t.closed_servicing_team_episode_id is not null
       and not exists (
         select 1
           from public.inbox_v2_work_item_servicing_team_episodes e
          where e.tenant_id = t.tenant_id
            and e.work_item_id = t.work_item_id
            and e.id = t.closed_servicing_team_episode_id
            and e.state = 'ended'
            and e.end_cause = 'work_item_terminal'
            and e.end_work_item_transition_id = t.id
            and e.end_recorded_at = t.occurred_at
            and e.ended_at = t.occurred_at
            and e.ended_actor_kind = t.actor_kind
            and e.ended_actor_employee_id is not distinct from
                t.actor_employee_id
            and e.ended_actor_authorization_epoch is not distinct from
                t.actor_authorization_epoch
            and e.ended_actor_trusted_service_id is not distinct from
                t.actor_trusted_service_id
            and e.end_reason_id = t.reason_id
       )
  ) then
    raise exception 'Terminal WorkItem relation proof must close its exact team episode'
      using errcode = '23514';
  end if;

  return null;
end
$function$;

create or replace function public.inbox_v2_work_item_mutation_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_transition_count bigint;
  v_relation_transition_count bigint;
  v_collaborator_effect_count bigint;
  v_collaborator_effect record;
  v_transition public.inbox_v2_work_item_transitions%rowtype;
  v_relation public.inbox_v2_work_item_relation_transitions%rowtype;
  v_old_sla public.inbox_v2_work_item_sla_snapshots%rowtype;
  v_new_sla public.inbox_v2_work_item_sla_snapshots%rowtype;
  v_destination_queue public.inbox_v2_work_queue_versions%rowtype;
  v_previous_team_id text;
  v_next_team_id text;
  v_expected_access_revision bigint;
begin
  if not exists (
    select 1
      from public.inbox_v2_work_items w
     where w.tenant_id = new.tenant_id and w.id = new.id
  ) then
    return null;
  end if;

  select count(*) into v_transition_count
    from public.inbox_v2_work_item_transitions t
   where t.tenant_id = new.tenant_id
     and t.work_item_id = new.id
     and t.resulting_revision = new.revision;
  select count(*) into v_relation_transition_count
    from public.inbox_v2_work_item_relation_transitions r
   where r.tenant_id = new.tenant_id
     and r.work_item_id = new.id
     and r.resulting_work_item_revision = new.revision;
  select count(*) into v_collaborator_effect_count
    from public.inbox_v2_auth_revision_effects effect_row
   where effect_row.tenant_id = new.tenant_id
     and effect_row.effect_kind = 'collaborator_set'
     and effect_row.work_item_id = new.id
     and effect_row.resulting_work_item_revision = new.revision;

  if v_transition_count + v_relation_transition_count +
       v_collaborator_effect_count <> 1 then
    raise exception 'Each WorkItem +1 mutation requires exactly one lifecycle XOR servicing-team XOR collaborator-set proof'
      using errcode = '23514';
  end if;

  if v_transition_count = 1 then
    select * into strict v_transition
      from public.inbox_v2_work_item_transitions t
     where t.tenant_id = new.tenant_id
       and t.work_item_id = new.id
       and t.resulting_revision = new.revision;

    if v_transition.expected_revision <> old.revision
       or v_transition.resulting_revision <> new.revision
       or v_transition.from_state <> old.state
       or v_transition.to_state <> new.state
       or v_transition.source_queue_id <> old.queue_id
       or v_transition.source_queue_revision <> old.queue_revision
       or v_transition.destination_queue_id <> new.queue_id
       or v_transition.destination_queue_revision <> new.queue_revision
       or v_transition.occurred_at <> new.updated_at
       or v_transition.expected_servicing_team_relation_revision <>
          old.servicing_team_relation_revision
       or v_transition.resulting_servicing_team_relation_revision <>
          new.servicing_team_relation_revision then
      raise exception 'WorkItem lifecycle proof does not bind the exact OLD and NEW heads'
        using errcode = '23514';
    end if;

    if v_transition.opened_primary_assignment_id is not null then
      if (
          v_transition.closed_primary_assignment_id is null
          and old.current_primary_assignment_id is not null
        )
        or (
          v_transition.closed_primary_assignment_id is not null
          and old.current_primary_assignment_id is distinct from
              v_transition.closed_primary_assignment_id
        )
        or new.current_primary_assignment_id is distinct from
            v_transition.opened_primary_assignment_id
        or new.last_primary_assignment_id is distinct from
            v_transition.opened_primary_assignment_id then
        raise exception 'WorkItem assignment opening does not induce the exact OLD and NEW pointers'
          using errcode = '23514';
      end if;
    elsif v_transition.closed_primary_assignment_id is not null then
      if old.current_primary_assignment_id is distinct from
           v_transition.closed_primary_assignment_id
         or new.current_primary_assignment_id is not null
         or new.last_primary_assignment_id is distinct from
           v_transition.closed_primary_assignment_id then
        raise exception 'WorkItem assignment closure does not induce the exact OLD and NEW pointers'
          using errcode = '23514';
      end if;
    elsif new.current_primary_assignment_id is distinct from
            old.current_primary_assignment_id
       or new.last_primary_assignment_id is distinct from
            old.last_primary_assignment_id then
      raise exception 'WorkItem transition without assignment effect changed assignment pointers'
        using errcode = '23514';
    end if;

    if v_transition.kind in ('close_resolved', 'close_dismissed') then
      if v_transition.closed_servicing_team_episode_id is distinct from
           old.current_servicing_team_episode_id then
        raise exception 'Terminal WorkItem transition must close the exact OLD servicing-team head'
          using errcode = '23514';
      end if;
    elsif v_transition.closed_servicing_team_episode_id is not null then
      raise exception 'Non-terminal WorkItem transition cannot close a servicing-team episode'
        using errcode = '23514';
    end if;

    if v_transition.closed_servicing_team_episode_id is not null then
      select e.team_id into strict v_previous_team_id
        from public.inbox_v2_work_item_servicing_team_episodes e
       where e.tenant_id = new.tenant_id
         and e.work_item_id = new.id
         and e.id = v_transition.closed_servicing_team_episode_id;
      if old.current_servicing_team_id is distinct from v_previous_team_id
         or new.current_servicing_team_episode_id is not null
         or new.current_servicing_team_id is not null
         or new.last_servicing_team_episode_id is distinct from
            v_transition.closed_servicing_team_episode_id then
        raise exception 'Terminal WorkItem relation closure does not induce the exact OLD and NEW pointers'
          using errcode = '23514';
      end if;
    elsif new.current_servicing_team_episode_id is distinct from
            old.current_servicing_team_episode_id
       or new.current_servicing_team_id is distinct from
            old.current_servicing_team_id
       or new.last_servicing_team_episode_id is distinct from
            old.last_servicing_team_episode_id then
      raise exception 'Lifecycle transition without team closure changed servicing-team pointers'
        using errcode = '23514';
    end if;

    if v_transition.kind = 'priority_change' then
      if new.priority_id is not distinct from old.priority_id then
        raise exception 'Priority change cannot be a no-op'
          using errcode = '23514';
      end if;
    elsif new.priority_id is distinct from old.priority_id then
      raise exception 'Only priority_change may mutate WorkItem priority'
        using errcode = '23514';
    end if;

    select * into v_old_sla
      from public.inbox_v2_work_item_sla_snapshots s
     where s.tenant_id = old.tenant_id
       and s.work_item_id = old.id
       and s.sla_cycle = old.sla_cycle
       and s.revision = old.sla_snapshot_revision;
    select * into v_new_sla
      from public.inbox_v2_work_item_sla_snapshots s
     where s.tenant_id = new.tenant_id
       and s.work_item_id = new.id
       and s.sla_cycle = new.sla_cycle
       and s.revision = new.sla_snapshot_revision;
    if v_old_sla.revision is null or v_new_sla.revision is null then
      raise exception 'WorkItem mutation must retain exact OLD and NEW SLA snapshots'
        using errcode = '23514';
    end if;
    if v_transition.kind = 'sla_refresh' then
      if new.sla_cycle <> old.sla_cycle
         or new.sla_snapshot_revision <> old.sla_snapshot_revision + 1
         or v_old_sla.kind <> 'tracked'
         or v_new_sla.kind <> 'tracked'
         or v_new_sla.policy_id <> v_old_sla.policy_id
         or v_new_sla.policy_version <> v_old_sla.policy_version
         or v_new_sla.policy_revision <> v_old_sla.policy_revision
         or v_new_sla.business_calendar_id <>
            v_old_sla.business_calendar_id
         or v_new_sla.business_calendar_version <>
            v_old_sla.business_calendar_version
         or v_new_sla.business_calendar_revision <>
            v_old_sla.business_calendar_revision
         or v_new_sla.time_zone <> v_old_sla.time_zone
         or v_new_sla.started_at <> v_old_sla.started_at
         or v_new_sla.input_revision < v_old_sla.input_revision
         or (v_old_sla.first_human_response_at is not null and
           v_new_sla.first_human_response_at is distinct from
             v_old_sla.first_human_response_at) then
        raise exception 'SLA refresh must advance one tracked SLA snapshot revision'
          using errcode = '23514';
      end if;
    elsif v_transition.kind not in (
      'close_resolved',
      'close_dismissed',
      'reopen_unassigned',
      'reopen_assigned'
    ) and (
      new.sla_cycle <> old.sla_cycle
      or new.sla_snapshot_revision <> old.sla_snapshot_revision
    ) then
      raise exception 'This WorkItem transition cannot mutate SLA'
        using errcode = '23514';
    end if;
    if (
         new.sla_cycle <> old.sla_cycle
         or new.sla_snapshot_revision <> old.sla_snapshot_revision
       )
       and (
         v_new_sla.calculated_at <> new.updated_at
         or v_new_sla.created_at <> new.updated_at
       ) then
      raise exception 'New WorkItem SLA snapshot must be recorded at transition time'
        using errcode = '23514';
    end if;
    if v_transition.kind in ('close_resolved', 'close_dismissed') then
      if v_old_sla.kind = 'not_applied' then
        if new.sla_cycle <> old.sla_cycle
           or new.sla_snapshot_revision <> old.sla_snapshot_revision then
          raise exception 'Terminal close cannot synthesize an absent SLA'
            using errcode = '23514';
        end if;
      elsif new.sla_cycle <> old.sla_cycle
         or new.sla_snapshot_revision <> old.sla_snapshot_revision + 1
         or v_new_sla.kind <> 'tracked'
         or v_new_sla.policy_id <> v_old_sla.policy_id
         or v_new_sla.policy_version <> v_old_sla.policy_version
         or v_new_sla.policy_revision <> v_old_sla.policy_revision
         or v_new_sla.business_calendar_id <>
            v_old_sla.business_calendar_id
         or v_new_sla.business_calendar_version <>
            v_old_sla.business_calendar_version
         or v_new_sla.business_calendar_revision <>
            v_old_sla.business_calendar_revision
         or v_new_sla.time_zone <> v_old_sla.time_zone
         or v_new_sla.started_at <> v_old_sla.started_at
         or v_new_sla.clock_state <> 'stopped'
         or v_new_sla.stopped_at <> new.updated_at then
        raise exception 'Terminal close must append the exact stopped SLA revision'
          using errcode = '23514';
      end if;
    elsif v_transition.kind in ('reopen_unassigned', 'reopen_assigned') then
      if new.last_reopen_snapshot ->> 'slaMode' = 'new_cycle' then
        select * into v_destination_queue
          from public.inbox_v2_work_queue_versions q
         where q.tenant_id = v_transition.tenant_id
           and q.work_queue_id = v_transition.destination_queue_id
           and q.revision = v_transition.destination_queue_revision;
        if v_destination_queue.revision is null
           or new.sla_cycle <> old.sla_cycle + 1
           or new.sla_snapshot_revision <> 1
           or v_new_sla.kind <> v_destination_queue.default_sla_kind
           or (
             v_destination_queue.default_sla_kind = 'tracked'
             and (
               v_new_sla.policy_id <>
                  v_destination_queue.default_sla_policy_id
               or v_new_sla.policy_version <>
                  v_destination_queue.default_sla_policy_version
               or v_new_sla.policy_revision <>
                  v_destination_queue.default_sla_policy_revision
               or v_new_sla.input_revision <> 1
               or v_new_sla.business_calendar_id <>
                  v_destination_queue.default_business_calendar_id
               or v_new_sla.business_calendar_version <>
                  v_destination_queue.default_business_calendar_version
               or v_new_sla.business_calendar_revision <>
                  v_destination_queue.default_business_calendar_revision
               or v_new_sla.time_zone <>
                  v_destination_queue.default_sla_time_zone
               or v_new_sla.clock_state <> 'running'
               or v_new_sla.started_at <> new.updated_at
               or v_new_sla.paused_at is not null
               or v_new_sla.pause_condition_id is not null
               or v_new_sla.stopped_at is not null
               or v_new_sla.first_human_response_at is not null
             )
           ) then
          raise exception 'New-cycle reopen must reset SLA to exact destination Queue defaults'
            using errcode = '23514';
        end if;
      elsif new.last_reopen_snapshot ->> 'slaMode' = 'resume_remaining' then
        if v_old_sla.kind = 'not_applied' then
          if new.sla_cycle <> old.sla_cycle
             or new.sla_snapshot_revision <>
                old.sla_snapshot_revision then
            raise exception 'Resume cannot invent an SLA absent from the prior cycle'
              using errcode = '23514';
          end if;
        elsif new.sla_cycle <> old.sla_cycle
           or new.sla_snapshot_revision <> old.sla_snapshot_revision + 1
           or v_new_sla.kind <> 'tracked'
           or v_new_sla.policy_id <> v_old_sla.policy_id
           or v_new_sla.policy_version <> v_old_sla.policy_version
           or v_new_sla.policy_revision <> v_old_sla.policy_revision
           or v_new_sla.business_calendar_id <>
              v_old_sla.business_calendar_id
           or v_new_sla.business_calendar_version <>
              v_old_sla.business_calendar_version
           or v_new_sla.business_calendar_revision <>
              v_old_sla.business_calendar_revision
           or v_new_sla.time_zone <> v_old_sla.time_zone
           or v_new_sla.started_at <> v_old_sla.started_at
           or v_new_sla.clock_state = 'stopped' then
          raise exception 'Resume reopen must append one non-stopped SLA revision in the same cycle'
            using errcode = '23514';
        end if;
      else
        raise exception 'Reopen snapshot must select new_cycle or resume_remaining SLA mode'
          using errcode = '23514';
      end if;
    end if;
    if v_new_sla.kind = 'tracked' and (
      (new.state in ('resolved', 'dismissed') and
        v_new_sla.clock_state <> 'stopped')
      or (new.state in ('new', 'assigned', 'in_progress', 'waiting') and
        v_new_sla.clock_state = 'stopped')
    ) then
      raise exception 'Every WorkItem mutation must retain lifecycle-correct SLA clock state'
        using errcode = '23514';
    end if;

    if v_transition.kind in ('reopen_unassigned', 'reopen_assigned') then
      if new.reopen_cycle <> old.reopen_cycle + 1
         or new.last_reopen_snapshot is not distinct from
            old.last_reopen_snapshot
         or old.terminal_snapshot is null
         or new.terminal_snapshot is not null then
        raise exception 'Reopen must advance exact cycle and snapshot fields'
          using errcode = '23514';
      end if;
    elsif v_transition.kind in ('close_resolved', 'close_dismissed') then
      if new.reopen_cycle <> old.reopen_cycle
         or new.last_reopen_snapshot is distinct from old.last_reopen_snapshot
         or old.terminal_snapshot is not null
         or new.terminal_snapshot is null then
        raise exception 'Terminal close must preserve reopen history and append terminal snapshot'
          using errcode = '23514';
      end if;
    elsif new.reopen_cycle <> old.reopen_cycle
       or new.last_reopen_snapshot is distinct from old.last_reopen_snapshot
       or new.terminal_snapshot is distinct from old.terminal_snapshot then
      raise exception 'Only terminal close or reopen may mutate lifecycle snapshots'
        using errcode = '23514';
    end if;

    if new.collaborator_set_revision <> old.collaborator_set_revision then
      raise exception 'Lifecycle transition cannot mutate collaborator-set revision'
        using errcode = '23514';
    end if;

    v_expected_access_revision := old.resource_access_revision;
    if new.current_primary_assignment_id is distinct from
         old.current_primary_assignment_id
       or new.queue_id <> old.queue_id
       or new.queue_revision <> old.queue_revision
       or old.state in ('resolved', 'dismissed')
       or new.state in ('resolved', 'dismissed') then
      v_expected_access_revision := v_expected_access_revision + 1;
    end if;
    if new.resource_access_revision <> v_expected_access_revision then
      raise exception 'WorkItem mutation has an invalid resource-access revision step'
        using errcode = '23514';
    end if;
  elsif v_relation_transition_count = 1 then
    select * into strict v_relation
      from public.inbox_v2_work_item_relation_transitions r
     where r.tenant_id = new.tenant_id
       and r.work_item_id = new.id
       and r.resulting_work_item_revision = new.revision;

    if v_relation.expected_work_item_revision <> old.revision
       or v_relation.resulting_work_item_revision <> new.revision
       or v_relation.occurred_at <> new.updated_at
       or v_relation.expected_relation_revision <>
          old.servicing_team_relation_revision
       or v_relation.resulting_relation_revision <>
          new.servicing_team_relation_revision then
      raise exception 'Servicing-team relation proof does not bind the exact OLD and NEW heads'
        using errcode = '23514';
    end if;
    if old.state in ('resolved', 'dismissed')
       or new.state <> old.state
       or new.queue_id <> old.queue_id
       or new.queue_revision <> old.queue_revision
       or new.priority_id <> old.priority_id
       or new.sla_cycle <> old.sla_cycle
       or new.sla_snapshot_revision <> old.sla_snapshot_revision
       or new.current_primary_assignment_id is distinct from
          old.current_primary_assignment_id
       or new.last_primary_assignment_id is distinct from
          old.last_primary_assignment_id
       or new.collaborator_set_revision <> old.collaborator_set_revision
       or new.reopen_cycle <> old.reopen_cycle
       or new.last_reopen_snapshot is distinct from old.last_reopen_snapshot
       or new.terminal_snapshot is distinct from old.terminal_snapshot then
      raise exception 'Servicing-team relation command mutated an unrelated WorkItem field'
        using errcode = '23514';
    end if;
    if new.resource_access_revision <> old.resource_access_revision + 1 then
      raise exception 'Servicing-team relation command must advance resource access once'
        using errcode = '23514';
    end if;

    if v_relation.previous_episode_id is not null then
      select e.team_id into strict v_previous_team_id
        from public.inbox_v2_work_item_servicing_team_episodes e
       where e.tenant_id = new.tenant_id
         and e.work_item_id = new.id
         and e.id = v_relation.previous_episode_id;
      if old.current_servicing_team_episode_id is distinct from
           v_relation.previous_episode_id
         or old.current_servicing_team_id is distinct from
           v_previous_team_id then
        raise exception 'Servicing-team relation command did not close the exact OLD head'
          using errcode = '23514';
      end if;
    elsif old.current_servicing_team_episode_id is not null
       or old.current_servicing_team_id is not null then
      raise exception 'Servicing-team add requires an empty OLD relation head'
        using errcode = '23514';
    end if;

    if v_relation.next_episode_id is not null then
      select e.team_id into strict v_next_team_id
        from public.inbox_v2_work_item_servicing_team_episodes e
       where e.tenant_id = new.tenant_id
         and e.work_item_id = new.id
         and e.id = v_relation.next_episode_id;
      if new.current_servicing_team_episode_id is distinct from
           v_relation.next_episode_id
         or new.current_servicing_team_id is distinct from v_next_team_id
         or new.last_servicing_team_episode_id is distinct from
           v_relation.next_episode_id then
        raise exception 'Servicing-team relation command did not open the exact NEW head'
          using errcode = '23514';
      end if;
    elsif new.current_servicing_team_episode_id is not null
       or new.current_servicing_team_id is not null
       or new.last_servicing_team_episode_id is distinct from
          v_relation.previous_episode_id then
      raise exception 'Servicing-team removal did not induce the exact NEW head'
        using errcode = '23514';
    end if;
  else
    select * into strict v_collaborator_effect
      from public.inbox_v2_auth_revision_effects effect_row
     where effect_row.tenant_id = new.tenant_id
       and effect_row.effect_kind = 'collaborator_set'
       and effect_row.work_item_id = new.id
       and effect_row.resulting_work_item_revision = new.revision;

    if v_collaborator_effect.before_revision <>
         old.collaborator_set_revision
       or v_collaborator_effect.after_revision <>
         new.collaborator_set_revision
       or v_collaborator_effect.expected_work_item_revision <> old.revision
       or v_collaborator_effect.resulting_work_item_revision <> new.revision
       or v_collaborator_effect.work_item_cycle <> new.reopen_cycle
       or v_collaborator_effect.created_at <> new.updated_at
       or new.collaborator_set_revision <>
         old.collaborator_set_revision + 1
       or (to_jsonb(new) - array[
         'revision', 'updated_at', 'collaborator_set_revision'
       ]::text[]) is distinct from (to_jsonb(old) - array[
         'revision', 'updated_at', 'collaborator_set_revision'
       ]::text[]) then
      raise exception 'Collaborator-set proof does not bind the exact OLD and NEW WorkItem heads'
        using errcode = '23514';
    end if;
  end if;

  return null;
end
$function$;
`;

export const INBOX_V2_AUTHORIZATION_RELATIONS_INTEGRITY_SQL = String.raw`
create or replace function public.inbox_v2_auth_reject_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' and not exists (
    select 1 from public.tenants tenant_row where tenant_row.id = old.tenant_id
  ) then
    return old;
  end if;
  raise exception using
    errcode = '23514',
    message = format('inbox_v2.authorization_immutable:%s:%s', tg_table_name, tg_op);
end;
$function$;

create or replace function public.inbox_v2_auth_json_tenant_safe(
  checked_value jsonb,
  checked_tenant_id text
)
returns boolean
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $function$
  select checked_value is null or not exists (
    select 1
      from jsonb_path_query(checked_value, '$.**.tenantId') tenant_ref
     where jsonb_typeof(tenant_ref) <> 'string'
        or tenant_ref #>> '{}' is distinct from checked_tenant_id
  );
$function$;

create or replace function public.inbox_v2_auth_catalog_id_safe(
  checked_value text
)
returns boolean
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $function$
  select coalesce(char_length(checked_value) <= 256 and (
    (
      checked_value ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part(checked_value, ':', 2)) <= 160
    ) or (
      checked_value ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part(checked_value, ':', 2)) <= 80
      and char_length(split_part(checked_value, ':', 3)) <= 160
      and split_part(checked_value, ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  ), false);
$function$;

create or replace function public.inbox_v2_auth_payload_reference_safe(
  checked_value jsonb,
  checked_tenant_id text
)
returns boolean
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $function$
  select checked_value is null or (
    jsonb_typeof(checked_value) = 'object'
    and checked_value ?&
      array['tenantId', 'recordId', 'schemaId', 'schemaVersion', 'digest']::text[]
    and (checked_value -
      array['tenantId', 'recordId', 'schemaId', 'schemaVersion', 'digest']::text[]) =
        '{}'::jsonb
    and jsonb_typeof(checked_value->'tenantId') = 'string'
    and checked_value->>'tenantId' = checked_tenant_id
    and jsonb_typeof(checked_value->'recordId') = 'string'
    and char_length(checked_value->>'recordId') between 1 and 512
    and checked_value->>'recordId' ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
    and jsonb_typeof(checked_value->'schemaId') = 'string'
    and public.inbox_v2_auth_catalog_id_safe(checked_value->>'schemaId')
    and jsonb_typeof(checked_value->'schemaVersion') = 'string'
    and char_length(checked_value->>'schemaVersion') between 1 and 64
    and checked_value->>'schemaVersion' ~
      '^[A-Za-z0-9][A-Za-z0-9._~-]*$'
    and jsonb_typeof(checked_value->'digest') = 'string'
    and checked_value->>'digest' ~ '^sha256:[0-9a-f]{64}$'
  );
$function$;

create or replace function public.inbox_v2_auth_invalidations_safe(
  checked_value jsonb,
  checked_tenant_id text,
  checked_max integer
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  invalidation jsonb;
begin
  if jsonb_typeof(checked_value) <> 'array' then
    return false;
  end if;
  if checked_max is null or checked_max < 1
     or jsonb_array_length(checked_value) not between 1 and checked_max
     or not public.inbox_v2_auth_json_tenant_safe(
       checked_value, checked_tenant_id
     ) then
    return false;
  end if;
  for invalidation in select value from jsonb_array_elements(checked_value)
  loop
    if jsonb_typeof(invalidation) <> 'object' then
      return false;
    end if;
    case invalidation->>'kind'
      when 'recipient_scope' then
        if (invalidation - array['kind']::text[]) <> '{}'::jsonb then
          return false;
        end if;
      when 'projection' then
        if not (invalidation ?& array['kind', 'projectionId']::text[])
           or (invalidation - array['kind', 'projectionId']::text[]) <> '{}'::jsonb
           or jsonb_typeof(invalidation->'projectionId') <> 'string'
           or char_length(invalidation->>'projectionId') not between 1 and 512
           or invalidation->>'projectionId' !~
             '^[A-Za-z0-9][A-Za-z0-9._~:-]*$' then
          return false;
        end if;
      when 'conversation' then
        if not (invalidation ?& array['kind', 'conversation']::text[])
           or (invalidation - array['kind', 'conversation']::text[]) <> '{}'::jsonb
           or jsonb_typeof(invalidation->'conversation') <> 'object'
           or not (invalidation->'conversation' ?&
             array['tenantId', 'kind', 'id']::text[])
           or ((invalidation->'conversation') -
             array['tenantId', 'kind', 'id']::text[]) <> '{}'::jsonb
           or jsonb_typeof(
             invalidation->'conversation'->'tenantId'
           ) <> 'string'
           or invalidation->'conversation'->>'tenantId' <>
             checked_tenant_id
           or jsonb_typeof(
             invalidation->'conversation'->'kind'
           ) <> 'string'
           or invalidation->'conversation'->>'kind' <> 'conversation'
           or jsonb_typeof(invalidation->'conversation'->'id') <> 'string'
           or char_length(invalidation->'conversation'->>'id')
             not between 1 and 256
           or invalidation->'conversation'->>'id' !~
             '^[A-Za-z0-9][A-Za-z0-9._~:-]*$' then
          return false;
        end if;
      when 'entity' then
        if not (invalidation ?& array['kind', 'entity']::text[])
           or (invalidation - array['kind', 'entity']::text[]) <> '{}'::jsonb
           or jsonb_typeof(invalidation->'entity') <> 'object'
           or not (invalidation->'entity' ?&
             array['tenantId', 'entityTypeId', 'entityId']::text[])
           or ((invalidation->'entity') -
             array['tenantId', 'entityTypeId', 'entityId']::text[]) <> '{}'::jsonb
           or jsonb_typeof(invalidation->'entity'->'tenantId') <> 'string'
           or invalidation->'entity'->>'tenantId' <> checked_tenant_id
           or jsonb_typeof(
             invalidation->'entity'->'entityTypeId'
           ) <> 'string'
           or not public.inbox_v2_auth_catalog_id_safe(
             invalidation->'entity'->>'entityTypeId'
           )
           or jsonb_typeof(invalidation->'entity'->'entityId') <> 'string'
           or char_length(invalidation->'entity'->>'entityId')
             not between 1 and 512
           or invalidation->'entity'->>'entityId' !~
             '^[A-Za-z0-9][A-Za-z0-9._~:-]*$' then
          return false;
        end if;
      else
        return false;
    end case;
  end loop;
  return true;
end;
$function$;

create or replace function public.inbox_v2_auth_decision_refs_safe(
  checked_value jsonb,
  checked_tenant_id text,
  checked_at timestamptz,
  require_allowed boolean
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  decision_ref jsonb;
begin
  if jsonb_typeof(checked_value) <> 'array' then
    return false;
  end if;
  if jsonb_array_length(checked_value) not between 1 and 64
     or not public.inbox_v2_auth_json_tenant_safe(
       checked_value, checked_tenant_id
     ) then
    return false;
  end if;
  if (
    select count(*) <> count(distinct decision_value->>'id')
      from jsonb_array_elements(checked_value)
        as decision_rows(decision_value)
  ) then
    return false;
  end if;

  for decision_ref in select value from jsonb_array_elements(checked_value)
  loop
    if jsonb_typeof(decision_ref) <> 'object'
       or not (decision_ref ?& array[
         'tenantId', 'id', 'authorizationEpoch', 'principal',
         'permissionId', 'resourceScopeId', 'resource',
         'resourceAccessRevision', 'decisionRevision', 'decisionHash',
         'outcome', 'decidedAt', 'notAfter'
       ]::text[])
       or (decision_ref - array[
         'tenantId', 'id', 'authorizationEpoch', 'principal',
         'permissionId', 'resourceScopeId', 'resource',
         'resourceAccessRevision', 'decisionRevision', 'decisionHash',
         'outcome', 'decidedAt', 'notAfter'
       ]::text[]) <> '{}'::jsonb
       or decision_ref->>'tenantId' <> checked_tenant_id
       or jsonb_typeof(decision_ref->'id') <> 'string'
       or char_length(decision_ref->>'id') not between 1 and 512
       or decision_ref->>'id' !~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
       or jsonb_typeof(decision_ref->'authorizationEpoch') <> 'string'
       or char_length(decision_ref->>'authorizationEpoch') not between 8 and 1024
       or jsonb_typeof(decision_ref->'permissionId') <> 'string'
       or not public.inbox_v2_auth_catalog_id_safe(
         decision_ref->>'permissionId'
       )
       or jsonb_typeof(decision_ref->'resourceScopeId') <> 'string'
       or not public.inbox_v2_auth_catalog_id_safe(
         decision_ref->>'resourceScopeId'
       )
       or jsonb_typeof(decision_ref->'principal') <> 'object'
       or jsonb_typeof(decision_ref->'resource') <> 'object'
       or not (
         (
           decision_ref->'principal'->>'kind' = 'employee'
           and decision_ref->'principal' ?& array['kind', 'employee']::text[]
           and ((decision_ref->'principal') -
             array['kind', 'employee']::text[]) =
             '{}'::jsonb
           and jsonb_typeof(
             decision_ref->'principal'->'employee'
           ) = 'object'
           and decision_ref->'principal'->'employee' ?&
             array['tenantId', 'kind', 'id']::text[]
           and ((decision_ref->'principal'->'employee') -
             array['tenantId', 'kind', 'id']::text[]) = '{}'::jsonb
           and jsonb_typeof(
             decision_ref->'principal'->'employee'->'tenantId'
           ) = 'string'
           and decision_ref->'principal'->'employee'->>'tenantId' =
             checked_tenant_id
           and jsonb_typeof(
             decision_ref->'principal'->'employee'->'kind'
           ) = 'string'
           and decision_ref->'principal'->'employee'->>'kind' = 'employee'
           and jsonb_typeof(
             decision_ref->'principal'->'employee'->'id'
           ) = 'string'
           and char_length(
             decision_ref->'principal'->'employee'->>'id'
           ) between 1 and 256
           and decision_ref->'principal'->'employee'->>'id' ~
             '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
         ) or (
           decision_ref->'principal'->>'kind' = 'trusted_service'
           and decision_ref->'principal' ?&
             array['kind', 'trustedServiceId']::text[]
           and ((decision_ref->'principal') -
             array['kind', 'trustedServiceId']::text[]) = '{}'::jsonb
           and jsonb_typeof(
             decision_ref->'principal'->'trustedServiceId'
           ) = 'string'
           and public.inbox_v2_auth_catalog_id_safe(
             decision_ref->'principal'->>'trustedServiceId'
           )
         )
       )
       or not (decision_ref->'resource' ?&
         array['tenantId', 'entityTypeId', 'entityId']::text[])
       or jsonb_typeof(decision_ref->'resource'->'tenantId') <> 'string'
       or decision_ref->'resource'->>'tenantId' <> checked_tenant_id
       or ((decision_ref->'resource') -
         array['tenantId', 'entityTypeId', 'entityId']::text[]) <> '{}'::jsonb
       or jsonb_typeof(decision_ref->'resource'->'entityTypeId') <> 'string'
       or not public.inbox_v2_auth_catalog_id_safe(
         decision_ref->'resource'->>'entityTypeId'
       )
       or jsonb_typeof(decision_ref->'resource'->'entityId') <> 'string'
       or char_length(decision_ref->'resource'->>'entityId') not between 1 and 512
       or decision_ref->'resource'->>'entityId' !~
         '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
       or jsonb_typeof(decision_ref->'resourceAccessRevision') <> 'string'
       or decision_ref->>'resourceAccessRevision' !~ '^[1-9][0-9]{0,18}$'
       or jsonb_typeof(decision_ref->'decisionRevision') <> 'string'
       or decision_ref->>'decisionRevision' !~ '^[1-9][0-9]{0,18}$'
       or jsonb_typeof(decision_ref->'decisionHash') <> 'string'
       or decision_ref->>'decisionHash' !~ '^sha256:[0-9a-f]{64}$'
       or jsonb_typeof(decision_ref->'outcome') <> 'string'
       or decision_ref->>'outcome' not in ('allowed', 'denied')
       or jsonb_typeof(decision_ref->'decidedAt') <> 'string'
       or jsonb_typeof(decision_ref->'notAfter') <> 'string'
       or (require_allowed and decision_ref->>'outcome' <> 'allowed') then
      return false;
    end if;
    begin
      if (decision_ref->>'resourceAccessRevision')::numeric >
           9223372036854775807
         or (decision_ref->>'decisionRevision')::numeric >
           9223372036854775807
         or not isfinite((decision_ref->>'decidedAt')::timestamptz)
         or not isfinite((decision_ref->>'notAfter')::timestamptz)
         or (decision_ref->>'decidedAt')::timestamptz > checked_at
         or checked_at >= (decision_ref->>'notAfter')::timestamptz then
        return false;
      end if;
    exception when others then
      return false;
    end;
  end loop;
  return true;
end;
$function$;

create or replace function public.inbox_v2_auth_audit_identifier_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_invalid boolean;
begin
  select exists (
    select 1
      from (
        select identifier,
               lag(identifier) over (order by ordinal) as previous_identifier
          from unnest(new.matched_permission_ids) with ordinality
            identifier_row(identifier, ordinal)
     ) checked
     where checked.identifier is null
        or not public.inbox_v2_auth_catalog_id_safe(checked.identifier)
        or (checked.previous_identifier is not null and
            checked.previous_identifier collate "C" >=
              checked.identifier collate "C")
  ) into v_invalid;
  if v_invalid then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_audit_permission_ids_invalid';
  end if;

  select exists (
    select 1
      from (
        select identifier,
               lag(identifier) over (order by ordinal) as previous_identifier
          from unnest(new.scope_ids) with ordinality
            identifier_row(identifier, ordinal)
     ) checked
     where checked.identifier is null
        or not public.inbox_v2_auth_catalog_id_safe(checked.identifier)
        or (checked.previous_identifier is not null and
            checked.previous_identifier collate "C" >=
              checked.identifier collate "C")
  ) into v_invalid;
  if v_invalid then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_audit_scope_ids_invalid';
  end if;

  select exists (
    select 1
      from (
        select identifier,
               lag(identifier) over (order by ordinal) as previous_identifier
          from unnest(new.grant_source_ids) with ordinality
            identifier_row(identifier, ordinal)
      ) checked
     where checked.identifier is null
        or checked.identifier !~ '^internal-ref:[a-f0-9]{32,64}$'
        or (checked.previous_identifier is not null and
            checked.previous_identifier collate "C" >=
              checked.identifier collate "C")
  ) into v_invalid;
  if v_invalid then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_audit_grant_refs_invalid';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_auth_relation_version_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_current_revision bigint;
  v_head_found boolean := false;
  v_previous jsonb;
  v_incoming jsonb := to_jsonb(new);
  v_identity_matches boolean := true;
  v_temporal boolean := false;
begin
  case tg_table_name
    when 'inbox_v2_auth_role_versions' then
      select head_row.current_revision into v_current_revision
        from public.inbox_v2_auth_role_heads head_row
       where head_row.tenant_id = new.tenant_id
         and head_row.role_id = new.role_id
       for update;
      v_head_found := found;
    when 'inbox_v2_auth_role_binding_versions' then
      v_temporal := true;
      select head_row.current_revision into v_current_revision
        from public.inbox_v2_auth_role_binding_heads head_row
       where head_row.tenant_id = new.tenant_id
         and head_row.binding_id = new.binding_id
       for update;
      v_head_found := found;
      perform 1
        from public.inbox_v2_auth_role_heads role_head
       where role_head.tenant_id = new.tenant_id
         and role_head.role_id = new.role_id
         and role_head.current_revision = new.role_revision_observed
       for share;
      if not found then
        raise exception using errcode = '40001',
          message = 'inbox_v2.authorization_role_observation_stale';
      end if;
    when 'inbox_v2_auth_direct_grant_versions' then
      v_temporal := true;
      select head_row.current_revision into v_current_revision
        from public.inbox_v2_auth_direct_grant_heads head_row
       where head_row.tenant_id = new.tenant_id
         and head_row.grant_id = new.grant_id
       for update;
      v_head_found := found;
    when 'inbox_v2_auth_workforce_membership_versions' then
      v_temporal := true;
      select head_row.current_revision into v_current_revision
        from public.inbox_v2_auth_workforce_membership_heads head_row
       where head_row.tenant_id = new.tenant_id
         and head_row.membership_id = new.membership_id
       for update;
      v_head_found := found;
    when 'inbox_v2_auth_structural_access_versions' then
      v_temporal := true;
      select head_row.current_revision into v_current_revision
        from public.inbox_v2_auth_structural_access_heads head_row
       where head_row.tenant_id = new.tenant_id
         and head_row.binding_id = new.binding_id
       for update;
      v_head_found := found;
      perform 1
        from public.inbox_v2_auth_resource_heads resource_head
       where resource_head.tenant_id = new.tenant_id
         and resource_head.id = new.resource_head_id
         and row(
           resource_head.resource_kind,
           resource_head.conversation_id,
           resource_head.client_id,
           resource_head.source_account_id
         ) is not distinct from row(
           new.resource_kind,
           new.conversation_id,
           new.client_id,
           new.source_account_id
         )
       for share;
      if not found then
        raise exception using errcode = '23514',
          message = 'inbox_v2.authorization_structural_resource_mismatch';
      end if;
    when 'inbox_v2_auth_collaborator_versions' then
      v_temporal := true;
      select head_row.current_revision into v_current_revision
        from public.inbox_v2_auth_collaborator_heads head_row
       where head_row.tenant_id = new.tenant_id
         and head_row.collaborator_id = new.collaborator_id
       for update;
      v_head_found := found;
    else
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_version_guard_table_invalid';
  end case;

  if new.revision = 1 then
    if v_head_found then
      raise exception using errcode = '40001',
        message = 'inbox_v2.authorization_version_cas_conflict';
    end if;
  elsif not v_head_found or v_current_revision <> new.revision - 1 then
    raise exception using errcode = '40001',
      message = 'inbox_v2.authorization_version_cas_conflict';
  end if;

  if not v_head_found then
    if v_temporal and v_incoming->>'state' <> 'active' then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_initial_relation_state_invalid';
    end if;
    return new;
  end if;

  case tg_table_name
    when 'inbox_v2_auth_role_versions' then
      select to_jsonb(version_row) into strict v_previous
        from public.inbox_v2_auth_role_versions version_row
       where version_row.tenant_id = new.tenant_id
         and version_row.role_id = new.role_id
         and version_row.revision = v_current_revision;
    when 'inbox_v2_auth_role_binding_versions' then
      select to_jsonb(version_row) into strict v_previous
        from public.inbox_v2_auth_role_binding_versions version_row
       where version_row.tenant_id = new.tenant_id
         and version_row.binding_id = new.binding_id
         and version_row.revision = v_current_revision;
      v_identity_matches := jsonb_build_array(
        v_previous->'role_id',
        v_previous->'subject_kind',
        v_previous->'subject_employee_id',
        v_previous->'subject_team_id',
        v_previous->'subject_org_unit_id',
        v_previous->'subject_work_queue_id',
        v_previous->'scope_kind',
        v_previous->'scope_org_unit_mode',
        v_previous->'scope_org_unit_id',
        v_previous->'scope_team_id',
        v_previous->'scope_work_queue_id',
        v_previous->'scope_client_id',
        v_previous->'scope_conversation_id',
        v_previous->'scope_work_item_id',
        v_previous->'scope_source_account_id',
        v_previous->'valid_from'
      ) = jsonb_build_array(
        v_incoming->'role_id',
        v_incoming->'subject_kind',
        v_incoming->'subject_employee_id',
        v_incoming->'subject_team_id',
        v_incoming->'subject_org_unit_id',
        v_incoming->'subject_work_queue_id',
        v_incoming->'scope_kind',
        v_incoming->'scope_org_unit_mode',
        v_incoming->'scope_org_unit_id',
        v_incoming->'scope_team_id',
        v_incoming->'scope_work_queue_id',
        v_incoming->'scope_client_id',
        v_incoming->'scope_conversation_id',
        v_incoming->'scope_work_item_id',
        v_incoming->'scope_source_account_id',
        v_incoming->'valid_from'
      );
    when 'inbox_v2_auth_direct_grant_versions' then
      select to_jsonb(version_row) into strict v_previous
        from public.inbox_v2_auth_direct_grant_versions version_row
       where version_row.tenant_id = new.tenant_id
         and version_row.grant_id = new.grant_id
         and version_row.revision = v_current_revision;
      v_identity_matches := jsonb_build_array(
        v_previous->'employee_id',
        v_previous->'catalog_schema_id',
        v_previous->'catalog_schema_version',
        v_previous->'catalog_digest_sha256',
        v_previous->'permission_id',
        v_previous->'scope_kind',
        v_previous->'scope_org_unit_mode',
        v_previous->'scope_org_unit_id',
        v_previous->'scope_team_id',
        v_previous->'scope_work_queue_id',
        v_previous->'scope_client_id',
        v_previous->'scope_conversation_id',
        v_previous->'scope_work_item_id',
        v_previous->'scope_source_account_id',
        v_previous->'valid_from'
      ) = jsonb_build_array(
        v_incoming->'employee_id',
        v_incoming->'catalog_schema_id',
        v_incoming->'catalog_schema_version',
        v_incoming->'catalog_digest_sha256',
        v_incoming->'permission_id',
        v_incoming->'scope_kind',
        v_incoming->'scope_org_unit_mode',
        v_incoming->'scope_org_unit_id',
        v_incoming->'scope_team_id',
        v_incoming->'scope_work_queue_id',
        v_incoming->'scope_client_id',
        v_incoming->'scope_conversation_id',
        v_incoming->'scope_work_item_id',
        v_incoming->'scope_source_account_id',
        v_incoming->'valid_from'
      );
    when 'inbox_v2_auth_workforce_membership_versions' then
      select to_jsonb(version_row) into strict v_previous
        from public.inbox_v2_auth_workforce_membership_versions version_row
       where version_row.tenant_id = new.tenant_id
         and version_row.membership_id = new.membership_id
         and version_row.revision = v_current_revision;
      v_identity_matches := jsonb_build_array(
        v_previous->'employee_id',
        v_previous->'membership_kind',
        v_previous->'org_unit_id',
        v_previous->'team_id',
        v_previous->'work_queue_id',
        v_previous->'valid_from'
      ) = jsonb_build_array(
        v_incoming->'employee_id',
        v_incoming->'membership_kind',
        v_incoming->'org_unit_id',
        v_incoming->'team_id',
        v_incoming->'work_queue_id',
        v_incoming->'valid_from'
      );
    when 'inbox_v2_auth_structural_access_versions' then
      select to_jsonb(version_row) into strict v_previous
        from public.inbox_v2_auth_structural_access_versions version_row
       where version_row.tenant_id = new.tenant_id
         and version_row.binding_id = new.binding_id
         and version_row.revision = v_current_revision;
      v_identity_matches := jsonb_build_array(
        v_previous->'resource_head_id',
        v_previous->'resource_kind',
        v_previous->'conversation_id',
        v_previous->'client_id',
        v_previous->'source_account_id',
        v_previous->'target_kind',
        v_previous->'target_org_unit_id',
        v_previous->'target_team_id',
        v_previous->'policy_id',
        v_previous->'policy_revision',
        v_previous->'valid_from'
      ) = jsonb_build_array(
        v_incoming->'resource_head_id',
        v_incoming->'resource_kind',
        v_incoming->'conversation_id',
        v_incoming->'client_id',
        v_incoming->'source_account_id',
        v_incoming->'target_kind',
        v_incoming->'target_org_unit_id',
        v_incoming->'target_team_id',
        v_incoming->'policy_id',
        v_incoming->'policy_revision',
        v_incoming->'valid_from'
      );
    when 'inbox_v2_auth_collaborator_versions' then
      select to_jsonb(version_row) into strict v_previous
        from public.inbox_v2_auth_collaborator_versions version_row
       where version_row.tenant_id = new.tenant_id
         and version_row.collaborator_id = new.collaborator_id
         and version_row.revision = v_current_revision;
      v_identity_matches := jsonb_build_array(
        v_previous->'resource_kind',
        v_previous->'conversation_id',
        v_previous->'work_item_id',
        v_previous->'work_item_cycle',
        v_previous->'employee_id',
        v_previous->'valid_from'
      ) = jsonb_build_array(
        v_incoming->'resource_kind',
        v_incoming->'conversation_id',
        v_incoming->'work_item_id',
        v_incoming->'work_item_cycle',
        v_incoming->'employee_id',
        v_incoming->'valid_from'
      );
  end case;

  if (v_incoming->>'occurred_at')::timestamptz <
     (v_previous->>'occurred_at')::timestamptz then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_version_time_regression';
  end if;

  if v_temporal then
    if not v_identity_matches then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_relation_identity_morph';
    end if;
    if v_previous->>'state' <> 'active'
       or v_incoming->>'state' not in ('revoked', 'archived') then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_relation_state_transition_invalid';
    end if;
    if v_incoming->>'valid_until' is distinct from
       v_previous->>'valid_until' then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_relation_interval_morph';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_auth_head_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_version_matches boolean := true;
begin
  if tg_op = 'DELETE' then
    if not exists (
      select 1 from public.tenants tenant_row where tenant_row.id = old.tenant_id
    ) then
      return old;
    end if;
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_head_delete_forbidden';
  end if;

  if tg_op = 'INSERT' then
    case tg_table_name
      when 'inbox_v2_auth_tenant_heads' then
        if new.revision <> 1 or new.tenant_rbac_revision <> 1
           or new.shared_access_revision <> 1 then
          raise exception using errcode = '23514',
            message = 'inbox_v2.authorization_head_initial_revision_invalid';
        end if;
      when 'inbox_v2_auth_employee_heads' then
        if new.revision <> 1 or new.employee_access_revision <> 1
           or new.employee_inbox_relation_revision <> 1 then
          raise exception using errcode = '23514',
            message = 'inbox_v2.authorization_head_initial_revision_invalid';
        end if;
      when 'inbox_v2_auth_resource_heads' then
        if new.revision <> 1 or new.resource_access_revision <> 1
           or new.structural_relation_revision <> 1
           or new.collaborator_set_revision <> 1 then
          raise exception using errcode = '23514',
            message = 'inbox_v2.authorization_head_initial_revision_invalid';
        end if;
      else
        if new.current_revision <> 1 then
          raise exception using errcode = '23514',
            message = 'inbox_v2.authorization_head_initial_revision_invalid';
        end if;
    end case;
  elsif new.tenant_id is distinct from old.tenant_id
     or new.created_at is distinct from old.created_at
     or new.updated_at < old.updated_at then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_head_identity_invalid';
  elsif tg_table_name = 'inbox_v2_auth_tenant_heads' then
    if new.revision <> old.revision + 1
       or new.tenant_rbac_revision not in (
         old.tenant_rbac_revision, old.tenant_rbac_revision + 1
       )
       or new.shared_access_revision not in (
         old.shared_access_revision, old.shared_access_revision + 1
       )
       or (new.tenant_rbac_revision - old.tenant_rbac_revision) +
          (new.shared_access_revision - old.shared_access_revision) <> 1 then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_tenant_head_invalid_advance';
    end if;
  elsif tg_table_name = 'inbox_v2_auth_employee_heads' then
    if new.employee_id is distinct from old.employee_id
       or new.revision <> old.revision + 1
       or new.employee_access_revision not in (
         old.employee_access_revision, old.employee_access_revision + 1
       )
       or new.employee_inbox_relation_revision not in (
         old.employee_inbox_relation_revision,
         old.employee_inbox_relation_revision + 1
       )
       or (new.employee_access_revision - old.employee_access_revision) +
          (new.employee_inbox_relation_revision -
            old.employee_inbox_relation_revision) <> 1 then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_employee_head_invalid_advance';
    end if;
  elsif tg_table_name = 'inbox_v2_auth_resource_heads' then
    if row(new.id, new.resource_kind, new.conversation_id, new.client_id,
           new.source_account_id) is distinct from
       row(old.id, old.resource_kind, old.conversation_id, old.client_id,
           old.source_account_id)
       or new.revision <> old.revision + 1
       or not (
         (new.resource_access_revision = old.resource_access_revision + 1
          and new.structural_relation_revision =
            old.structural_relation_revision + 1
          and new.collaborator_set_revision = old.collaborator_set_revision)
         or
         (new.resource_kind = 'conversation'
          and new.resource_access_revision = old.resource_access_revision
          and new.structural_relation_revision = old.structural_relation_revision
          and new.collaborator_set_revision =
            old.collaborator_set_revision + 1)
       ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_resource_head_invalid_advance';
    end if;
  else
    if new.current_revision <> old.current_revision + 1 then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_relation_head_invalid_advance';
    end if;
    case tg_table_name
      when 'inbox_v2_auth_role_heads' then
        if new.role_id is distinct from old.role_id then v_version_matches := false; end if;
      when 'inbox_v2_auth_role_binding_heads' then
        if new.binding_id is distinct from old.binding_id then v_version_matches := false; end if;
      when 'inbox_v2_auth_direct_grant_heads' then
        if new.grant_id is distinct from old.grant_id then v_version_matches := false; end if;
      when 'inbox_v2_auth_workforce_membership_heads' then
        if row(new.membership_id, new.employee_id, new.membership_kind,
               new.org_unit_id, new.team_id, new.work_queue_id) is distinct from
           row(old.membership_id, old.employee_id, old.membership_kind,
               old.org_unit_id, old.team_id, old.work_queue_id) then
          v_version_matches := false;
        end if;
      when 'inbox_v2_auth_structural_access_heads' then
        if row(new.binding_id, new.resource_head_id, new.resource_kind,
               new.conversation_id, new.client_id, new.source_account_id,
               new.target_kind, new.target_org_unit_id, new.target_team_id)
             is distinct from
           row(old.binding_id, old.resource_head_id, old.resource_kind,
               old.conversation_id, old.client_id, old.source_account_id,
               old.target_kind, old.target_org_unit_id, old.target_team_id) then
          v_version_matches := false;
        end if;
      when 'inbox_v2_auth_collaborator_heads' then
        if row(new.collaborator_id, new.resource_kind, new.conversation_id,
               new.work_item_id, new.work_item_cycle, new.employee_id)
             is distinct from
           row(old.collaborator_id, old.resource_kind, old.conversation_id,
               old.work_item_id, old.work_item_cycle, old.employee_id) then
          v_version_matches := false;
        end if;
      else
        v_version_matches := false;
    end case;
    if not v_version_matches then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_relation_head_identity_invalid';
    end if;
  end if;

  case tg_table_name
    when 'inbox_v2_auth_role_heads' then
      select exists (
        select 1 from public.inbox_v2_auth_role_versions version_row
         where version_row.tenant_id = new.tenant_id
           and version_row.role_id = new.role_id
           and version_row.revision = new.current_revision
           and version_row.occurred_at = new.updated_at
      ) into v_version_matches;
    when 'inbox_v2_auth_role_binding_heads' then
      select exists (
        select 1 from public.inbox_v2_auth_role_binding_versions version_row
         where version_row.tenant_id = new.tenant_id
           and version_row.binding_id = new.binding_id
           and version_row.revision = new.current_revision
           and version_row.occurred_at = new.updated_at
      ) into v_version_matches;
    when 'inbox_v2_auth_direct_grant_heads' then
      select exists (
        select 1 from public.inbox_v2_auth_direct_grant_versions version_row
         where version_row.tenant_id = new.tenant_id
           and version_row.grant_id = new.grant_id
           and version_row.revision = new.current_revision
           and version_row.occurred_at = new.updated_at
      ) into v_version_matches;
    when 'inbox_v2_auth_workforce_membership_heads' then
      select exists (
        select 1 from public.inbox_v2_auth_workforce_membership_versions version_row
         where version_row.tenant_id = new.tenant_id
           and version_row.membership_id = new.membership_id
           and version_row.revision = new.current_revision
           and version_row.state = new.current_state
           and version_row.occurred_at = new.updated_at
           and row(version_row.employee_id, version_row.membership_kind,
                   version_row.org_unit_id, version_row.team_id,
                   version_row.work_queue_id) is not distinct from
               row(new.employee_id, new.membership_kind, new.org_unit_id,
                   new.team_id, new.work_queue_id)
      ) into v_version_matches;
    when 'inbox_v2_auth_structural_access_heads' then
      select exists (
        select 1 from public.inbox_v2_auth_structural_access_versions version_row
         where version_row.tenant_id = new.tenant_id
           and version_row.binding_id = new.binding_id
           and version_row.revision = new.current_revision
           and version_row.state = new.current_state
           and version_row.occurred_at = new.updated_at
           and row(version_row.resource_head_id, version_row.resource_kind,
                   version_row.conversation_id, version_row.client_id,
                   version_row.source_account_id, version_row.target_kind,
                   version_row.target_org_unit_id, version_row.target_team_id)
             is not distinct from
               row(new.resource_head_id, new.resource_kind,
                   new.conversation_id, new.client_id, new.source_account_id,
                   new.target_kind, new.target_org_unit_id, new.target_team_id)
      ) into v_version_matches;
    when 'inbox_v2_auth_collaborator_heads' then
      select exists (
        select 1 from public.inbox_v2_auth_collaborator_versions version_row
         where version_row.tenant_id = new.tenant_id
           and version_row.collaborator_id = new.collaborator_id
           and version_row.revision = new.current_revision
           and version_row.state = new.current_state
           and version_row.occurred_at = new.updated_at
           and row(version_row.resource_kind, version_row.conversation_id,
                   version_row.work_item_id, version_row.work_item_cycle,
                   version_row.employee_id) is not distinct from
               row(new.resource_kind, new.conversation_id, new.work_item_id,
                   new.work_item_cycle, new.employee_id)
      ) into v_version_matches;
    else
      v_version_matches := true;
  end case;
  if not v_version_matches then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_head_version_mismatch';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_auth_command_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    if not exists (
      select 1 from public.tenants tenant_row where tenant_row.id = old.tenant_id
    ) then return old; end if;
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_command_delete_forbidden';
  end if;
  if tg_op = 'INSERT' then
    if new.state <> 'pending' or new.mutation_id is not null
       or new.revision <> 1 or new.updated_at <> new.created_at then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_command_initial_state_invalid';
    end if;
    return new;
  end if;
  if old.state <> 'pending' or new.state <> 'completed'
     or old.mutation_id is not null or new.mutation_id is null
     or new.revision <> old.revision + 1
     or row(new.tenant_id, new.id, new.client_mutation_id,
            new.command_type_id, new.first_request_id, new.request_hash,
            new.actor_kind,
            new.actor_employee_id, new.actor_trusted_service_id,
            new.authorization_decision_id,
            new.authorization_epoch, new.authorization_decision_refs,
            new.authorized_at, new.authorization_not_after,
            new.occurred_at, new.created_at)
        is distinct from
        row(old.tenant_id, old.id, old.client_mutation_id,
            old.command_type_id, old.first_request_id, old.request_hash,
            old.actor_kind,
            old.actor_employee_id, old.actor_trusted_service_id,
            old.authorization_decision_id,
            old.authorization_epoch, old.authorization_decision_refs,
            old.authorized_at, old.authorization_not_after,
            old.occurred_at, old.created_at)
     or new.updated_at < old.updated_at then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_command_invalid_completion';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_auth_stream_head_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    if not exists (
      select 1 from public.tenants tenant_row where tenant_row.id = old.tenant_id
    ) then return old; end if;
    raise exception using errcode = '23514',
      message = 'inbox_v2.tenant_stream_head_delete_forbidden';
  end if;
  if tg_op = 'INSERT' then
    if new.last_position <> 0 or new.min_retained_position <> 0
       or new.revision <> 1 or new.updated_at <> new.created_at then
      raise exception using errcode = '23514',
        message = 'inbox_v2.tenant_stream_head_initial_state_invalid';
    end if;
  elsif new.tenant_id is distinct from old.tenant_id
     or new.stream_epoch is distinct from old.stream_epoch
     or new.created_at is distinct from old.created_at
     or new.last_position <> old.last_position + 1
     or new.min_retained_position <> old.min_retained_position
     or new.revision <> old.revision + 1
     or new.updated_at < old.updated_at then
    raise exception using errcode = '40001',
      message = 'inbox_v2.tenant_stream_head_cas_conflict';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_auth_role_permission_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_tenant_id text;
  v_role_id text;
  v_role_revision bigint;
  v_expected_count integer;
  v_expected_digest text;
  v_actual_count integer;
  v_min_ordinal integer;
  v_max_ordinal integer;
  v_sorted_contiguous boolean;
  v_actual_digest text;
begin
  v_tenant_id := coalesce(to_jsonb(new)->>'tenant_id', to_jsonb(old)->>'tenant_id');
  v_role_id := coalesce(to_jsonb(new)->>'role_id', to_jsonb(old)->>'role_id');
  v_role_revision := coalesce(
    (to_jsonb(new)->>'role_revision')::bigint,
    (to_jsonb(new)->>'revision')::bigint,
    (to_jsonb(old)->>'role_revision')::bigint,
    (to_jsonb(old)->>'revision')::bigint
  );

  select version_row.permission_count,
         version_row.permission_set_digest_sha256
    into v_expected_count, v_expected_digest
    from public.inbox_v2_auth_role_versions version_row
   where version_row.tenant_id = v_tenant_id
     and version_row.role_id = v_role_id
     and version_row.revision = v_role_revision;
  if not found then
    if not exists (
      select 1 from public.tenants tenant_row where tenant_row.id = v_tenant_id
    ) then return null; end if;
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_role_permission_version_missing';
  end if;

  select count(*)::integer,
         min(permission_row.ordinal)::integer,
         max(permission_row.ordinal)::integer,
         coalesce(bool_and(permission_row.ordinal = permission_row.sorted_ordinal), false),
         'sha256:' || encode(sha256(convert_to(coalesce(string_agg(
           permission_row.ordinal::text || ':' ||
           octet_length(permission_row.permission_id)::text || ':' ||
           permission_row.permission_id,
           chr(10) order by permission_row.ordinal
         ), ''), 'UTF8')), 'hex')
    into v_actual_count, v_min_ordinal, v_max_ordinal,
         v_sorted_contiguous, v_actual_digest
    from (
      select permission_row.*,
             row_number() over (order by permission_row.permission_id)::integer
               as sorted_ordinal
        from public.inbox_v2_auth_role_version_permissions permission_row
       where permission_row.tenant_id = v_tenant_id
         and permission_row.role_id = v_role_id
         and permission_row.role_revision = v_role_revision
    ) permission_row;

  if v_actual_count <> v_expected_count
     or v_min_ordinal <> 1
     or v_max_ordinal <> v_expected_count
     or not v_sorted_contiguous
     or v_actual_digest <> v_expected_digest then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_role_permission_manifest_incomplete';
  end if;
  return null;
end;
$function$;

create or replace function public.inbox_v2_auth_head_commit_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_closed boolean := false;
begin
  if tg_op = 'UPDATE' and tg_table_name = 'inbox_v2_auth_tenant_heads' then
    if new.tenant_rbac_revision = old.tenant_rbac_revision + 1 then
      select exists (
        select 1 from public.inbox_v2_auth_revision_effects effect_row
         where effect_row.tenant_id = new.tenant_id
           and effect_row.effect_kind = 'tenant_rbac'
           and effect_row.before_revision = old.tenant_rbac_revision
           and effect_row.after_revision = new.tenant_rbac_revision
           and effect_row.created_at = new.updated_at
      ) into v_closed;
    else
      select exists (
        select 1 from public.inbox_v2_auth_revision_effects effect_row
         where effect_row.tenant_id = new.tenant_id
           and effect_row.effect_kind = 'shared_access'
           and effect_row.before_revision = old.shared_access_revision
           and effect_row.after_revision = new.shared_access_revision
           and effect_row.created_at = new.updated_at
      ) into v_closed;
    end if;
  elsif tg_op = 'UPDATE' and tg_table_name = 'inbox_v2_auth_employee_heads' then
    select exists (
      select 1 from public.inbox_v2_auth_revision_effects effect_row
       where effect_row.tenant_id = new.tenant_id
         and effect_row.employee_id = new.employee_id
         and effect_row.effect_kind = case
           when new.employee_access_revision = old.employee_access_revision + 1
             then 'employee_access'::public.inbox_v2_auth_revision_effect_kind
           else 'employee_inbox_relation'::public.inbox_v2_auth_revision_effect_kind
         end
         and effect_row.before_revision = case
           when new.employee_access_revision = old.employee_access_revision + 1
             then old.employee_access_revision
           else old.employee_inbox_relation_revision
         end
         and effect_row.after_revision = case
           when new.employee_access_revision = old.employee_access_revision + 1
             then new.employee_access_revision
           else new.employee_inbox_relation_revision
         end
         and effect_row.created_at = new.updated_at
    ) into v_closed;
  elsif tg_op = 'UPDATE' and tg_table_name = 'inbox_v2_auth_resource_heads' then
    if new.resource_access_revision = old.resource_access_revision + 1 then
      select exists (
        select 1 from public.inbox_v2_auth_revision_effects effect_row
         where effect_row.tenant_id = new.tenant_id
           and effect_row.effect_kind = 'resource_access'
           and effect_row.resource_head_id = new.id
           and effect_row.before_revision = old.resource_access_revision
           and effect_row.after_revision = new.resource_access_revision
           and effect_row.created_at = new.updated_at
      ) into v_closed;
    else
      select exists (
        select 1 from public.inbox_v2_auth_revision_effects effect_row
         where effect_row.tenant_id = new.tenant_id
           and effect_row.effect_kind = 'collaborator_set'
           and effect_row.resource_head_id = new.id
           and effect_row.before_revision = old.collaborator_set_revision
           and effect_row.after_revision = new.collaborator_set_revision
           and effect_row.created_at = new.updated_at
      ) into v_closed;
    end if;
  elsif tg_table_name = 'inbox_v2_auth_role_heads' then
    select exists (
      select 1
        from public.inbox_v2_auth_role_versions version_row
        join public.inbox_v2_auth_relation_writes write_row
          on write_row.tenant_id = version_row.tenant_id
         and write_row.mutation_id = version_row.mutation_id
         and write_row.relation_kind = 'role'
         and write_row.role_id = version_row.role_id
         and write_row.resulting_revision = version_row.revision
       where version_row.tenant_id = new.tenant_id
         and version_row.role_id = new.role_id
         and version_row.revision = new.current_revision
    ) into v_closed;
  elsif tg_table_name = 'inbox_v2_auth_role_binding_heads' then
    select exists (
      select 1
        from public.inbox_v2_auth_role_binding_versions version_row
        join public.inbox_v2_auth_relation_writes write_row
          on write_row.tenant_id = version_row.tenant_id
         and write_row.mutation_id = version_row.mutation_id
         and write_row.relation_kind = 'role_binding'
         and write_row.role_binding_id = version_row.binding_id
         and write_row.resulting_revision = version_row.revision
       where version_row.tenant_id = new.tenant_id
         and version_row.binding_id = new.binding_id
         and version_row.revision = new.current_revision
    ) into v_closed;
  elsif tg_table_name = 'inbox_v2_auth_direct_grant_heads' then
    select exists (
      select 1
        from public.inbox_v2_auth_direct_grant_versions version_row
        join public.inbox_v2_auth_relation_writes write_row
          on write_row.tenant_id = version_row.tenant_id
         and write_row.mutation_id = version_row.mutation_id
         and write_row.relation_kind = 'direct_grant'
         and write_row.direct_grant_id = version_row.grant_id
         and write_row.resulting_revision = version_row.revision
       where version_row.tenant_id = new.tenant_id
         and version_row.grant_id = new.grant_id
         and version_row.revision = new.current_revision
    ) into v_closed;
  elsif tg_table_name = 'inbox_v2_auth_workforce_membership_heads' then
    select exists (
      select 1
        from public.inbox_v2_auth_workforce_membership_versions version_row
        join public.inbox_v2_auth_relation_writes write_row
          on write_row.tenant_id = version_row.tenant_id
         and write_row.mutation_id = version_row.mutation_id
         and write_row.relation_kind = 'workforce_membership'
         and write_row.workforce_membership_id = version_row.membership_id
         and write_row.resulting_revision = version_row.revision
       where version_row.tenant_id = new.tenant_id
         and version_row.membership_id = new.membership_id
         and version_row.revision = new.current_revision
    ) into v_closed;
  elsif tg_table_name = 'inbox_v2_auth_structural_access_heads' then
    select exists (
      select 1
        from public.inbox_v2_auth_structural_access_versions version_row
        join public.inbox_v2_auth_relation_writes write_row
          on write_row.tenant_id = version_row.tenant_id
         and write_row.mutation_id = version_row.mutation_id
         and write_row.relation_kind = 'structural_access'
         and write_row.structural_access_binding_id = version_row.binding_id
         and write_row.resulting_revision = version_row.revision
       where version_row.tenant_id = new.tenant_id
         and version_row.binding_id = new.binding_id
         and version_row.revision = new.current_revision
    ) into v_closed;
  elsif tg_table_name = 'inbox_v2_auth_collaborator_heads' then
    select exists (
      select 1
        from public.inbox_v2_auth_collaborator_versions version_row
        join public.inbox_v2_auth_relation_writes write_row
          on write_row.tenant_id = version_row.tenant_id
         and write_row.mutation_id = version_row.mutation_id
         and write_row.relation_kind = case version_row.resource_kind
           when 'conversation' then
             'conversation_collaborator'::public.inbox_v2_auth_relation_kind
           else 'work_item_collaborator'::public.inbox_v2_auth_relation_kind
         end
         and write_row.collaborator_id = version_row.collaborator_id
         and write_row.resulting_revision = version_row.revision
       where version_row.tenant_id = new.tenant_id
         and version_row.collaborator_id = new.collaborator_id
         and version_row.revision = new.current_revision
    ) into v_closed;
  else
    v_closed := tg_op = 'INSERT';
  end if;

  if not v_closed then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_head_commit_incomplete';
  end if;
  return null;
end;
$function$;

create or replace function public.inbox_v2_auth_relation_version_commit_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_closed boolean := false;
  v_command_actor_kind public.inbox_v2_auth_actor_kind;
  v_command_actor_employee_id text;
  v_command_actor_trusted_service_id text;
  v_mutation_committed_at timestamptz;
begin
  select
    command_row.actor_kind,
    command_row.actor_employee_id,
    command_row.actor_trusted_service_id,
    mutation_row.committed_at
    into
      v_command_actor_kind,
      v_command_actor_employee_id,
      v_command_actor_trusted_service_id,
      v_mutation_committed_at
    from public.inbox_v2_auth_mutation_commits mutation_row
    join public.inbox_v2_auth_command_records command_row
      on command_row.tenant_id = mutation_row.tenant_id
     and command_row.id = mutation_row.command_record_id
     and command_row.mutation_id = mutation_row.mutation_id
   where mutation_row.tenant_id = new.tenant_id
     and mutation_row.mutation_id = new.mutation_id;

  if not found then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_relation_version_orphan';
  end if;

  if row(
    new.actor_kind,
    new.actor_employee_id,
    new.actor_trusted_service_id
  ) is distinct from row(
    v_command_actor_kind,
    v_command_actor_employee_id,
    v_command_actor_trusted_service_id
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_relation_actor_mismatch';
  end if;

  if new.occurred_at is distinct from v_mutation_committed_at then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_relation_occurred_at_mismatch';
  end if;

  case tg_table_name
    when 'inbox_v2_auth_role_versions' then
      select exists (
        select 1
          from public.inbox_v2_auth_role_heads head_row
          join public.inbox_v2_auth_relation_writes write_row
            on write_row.tenant_id = head_row.tenant_id
           and write_row.mutation_id = new.mutation_id
           and write_row.relation_kind = 'role'
           and write_row.role_id = new.role_id
           and write_row.resulting_revision = new.revision
           and write_row.previous_revision is not distinct from case
             when new.revision = 1 then null::bigint else new.revision - 1
           end
          join public.inbox_v2_auth_mutation_commits mutation_row
            on mutation_row.tenant_id = write_row.tenant_id
           and mutation_row.mutation_id = write_row.mutation_id
         where head_row.tenant_id = new.tenant_id
           and head_row.role_id = new.role_id
           and head_row.current_revision = new.revision
      ) into v_closed;
    when 'inbox_v2_auth_role_binding_versions' then
      select exists (
        select 1
          from public.inbox_v2_auth_role_binding_heads head_row
          join public.inbox_v2_auth_relation_writes write_row
            on write_row.tenant_id = head_row.tenant_id
           and write_row.mutation_id = new.mutation_id
           and write_row.relation_kind = 'role_binding'
           and write_row.role_binding_id = new.binding_id
           and write_row.resulting_revision = new.revision
           and write_row.previous_revision is not distinct from case
             when new.revision = 1 then null::bigint else new.revision - 1
           end
          join public.inbox_v2_auth_mutation_commits mutation_row
            on mutation_row.tenant_id = write_row.tenant_id
           and mutation_row.mutation_id = write_row.mutation_id
         where head_row.tenant_id = new.tenant_id
           and head_row.binding_id = new.binding_id
           and head_row.current_revision = new.revision
      ) into v_closed;
    when 'inbox_v2_auth_direct_grant_versions' then
      select exists (
        select 1
          from public.inbox_v2_auth_direct_grant_heads head_row
          join public.inbox_v2_auth_relation_writes write_row
            on write_row.tenant_id = head_row.tenant_id
           and write_row.mutation_id = new.mutation_id
           and write_row.relation_kind = 'direct_grant'
           and write_row.direct_grant_id = new.grant_id
           and write_row.resulting_revision = new.revision
           and write_row.previous_revision is not distinct from case
             when new.revision = 1 then null::bigint else new.revision - 1
           end
          join public.inbox_v2_auth_mutation_commits mutation_row
            on mutation_row.tenant_id = write_row.tenant_id
           and mutation_row.mutation_id = write_row.mutation_id
         where head_row.tenant_id = new.tenant_id
           and head_row.grant_id = new.grant_id
           and head_row.current_revision = new.revision
      ) into v_closed;
    when 'inbox_v2_auth_workforce_membership_versions' then
      select exists (
        select 1
          from public.inbox_v2_auth_workforce_membership_heads head_row
          join public.inbox_v2_auth_relation_writes write_row
            on write_row.tenant_id = head_row.tenant_id
           and write_row.mutation_id = new.mutation_id
           and write_row.relation_kind = 'workforce_membership'
           and write_row.workforce_membership_id = new.membership_id
           and write_row.resulting_revision = new.revision
           and write_row.previous_revision is not distinct from case
             when new.revision = 1 then null::bigint else new.revision - 1
           end
          join public.inbox_v2_auth_mutation_commits mutation_row
            on mutation_row.tenant_id = write_row.tenant_id
           and mutation_row.mutation_id = write_row.mutation_id
         where head_row.tenant_id = new.tenant_id
           and head_row.membership_id = new.membership_id
           and head_row.current_revision = new.revision
      ) into v_closed;
    when 'inbox_v2_auth_structural_access_versions' then
      select exists (
        select 1
          from public.inbox_v2_auth_structural_access_heads head_row
          join public.inbox_v2_auth_relation_writes write_row
            on write_row.tenant_id = head_row.tenant_id
           and write_row.mutation_id = new.mutation_id
           and write_row.relation_kind = 'structural_access'
           and write_row.structural_access_binding_id = new.binding_id
           and write_row.resulting_revision = new.revision
           and write_row.previous_revision is not distinct from case
             when new.revision = 1 then null::bigint else new.revision - 1
           end
          join public.inbox_v2_auth_mutation_commits mutation_row
            on mutation_row.tenant_id = write_row.tenant_id
           and mutation_row.mutation_id = write_row.mutation_id
         where head_row.tenant_id = new.tenant_id
           and head_row.binding_id = new.binding_id
           and head_row.current_revision = new.revision
      ) into v_closed;
    when 'inbox_v2_auth_collaborator_versions' then
      select exists (
        select 1
          from public.inbox_v2_auth_collaborator_heads head_row
          join public.inbox_v2_auth_relation_writes write_row
            on write_row.tenant_id = head_row.tenant_id
           and write_row.mutation_id = new.mutation_id
           and write_row.relation_kind = case new.resource_kind
             when 'conversation' then
               'conversation_collaborator'::public.inbox_v2_auth_relation_kind
             else 'work_item_collaborator'::public.inbox_v2_auth_relation_kind
           end
           and write_row.collaborator_id = new.collaborator_id
           and write_row.resulting_revision = new.revision
           and write_row.previous_revision is not distinct from case
             when new.revision = 1 then null::bigint else new.revision - 1
           end
          join public.inbox_v2_auth_mutation_commits mutation_row
            on mutation_row.tenant_id = write_row.tenant_id
           and mutation_row.mutation_id = write_row.mutation_id
         where head_row.tenant_id = new.tenant_id
           and head_row.collaborator_id = new.collaborator_id
           and head_row.current_revision = new.revision
      ) into v_closed;
  end case;

  if not coalesce(v_closed, false) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_relation_version_orphan';
  end if;
  return null;
end;
$function$;

create or replace function public.inbox_v2_auth_command_commit_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_closed boolean;
begin
  select exists (
    select 1
      from public.inbox_v2_auth_command_records command_row
      join public.inbox_v2_auth_mutation_commits mutation_row
        on mutation_row.tenant_id = command_row.tenant_id
       and mutation_row.mutation_id = command_row.mutation_id
       and mutation_row.command_record_id = command_row.id
     where command_row.tenant_id = new.tenant_id
       and command_row.id = new.id
       and command_row.state = 'completed'
       and command_row.updated_at = mutation_row.committed_at
  ) into v_closed;
  if not v_closed then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_command_orphan';
  end if;
  return null;
end;
$function$;

create or replace function public.inbox_v2_auth_mutation_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_command public.inbox_v2_auth_command_records%rowtype;
  v_stream public.inbox_v2_tenant_stream_commits%rowtype;
  v_audit public.inbox_v2_auth_audit_events%rowtype;
  v_count integer;
  v_invalid_count integer;
  v_change_count integer;
  v_event_count integer;
  v_authorization_event_count integer;
  v_outbox_count integer;
  v_effect_count integer;
  v_relation_count integer;
  v_facet_count integer;
  v_projection_count integer;
  v_role_write_count integer;
  v_structural_write_count integer;
  v_direct_access_write_count integer;
  v_direct_relation_write_count integer;
  v_change_ids jsonb;
  v_event_ids jsonb;
  v_outbox_ids jsonb;
  v_effect_digest text;
  v_relation_digest text;
  v_facet_digest text;
  v_stream_manifest_digest text;
  v_mutation_manifest_digest text;
  v_closed boolean;
  v_before_revision bigint;
  v_after_revision bigint;
  v_decision_not_after timestamptz;
begin
  select * into strict v_command
    from public.inbox_v2_auth_command_records command_row
   where command_row.tenant_id = new.tenant_id
     and command_row.id = new.command_record_id
     and command_row.mutation_id = new.mutation_id;
  select * into strict v_stream
    from public.inbox_v2_tenant_stream_commits stream_row
   where stream_row.tenant_id = new.tenant_id
     and stream_row.id = new.stream_commit_id
     and stream_row.mutation_id = new.mutation_id;
  select * into strict v_audit
    from public.inbox_v2_auth_audit_events audit_row
   where audit_row.tenant_id = new.tenant_id
     and audit_row.id = new.audit_event_id
     and audit_row.mutation_id = new.mutation_id;

  if v_command.state <> 'completed'
     or v_command.updated_at <> new.committed_at
     or v_stream.committed_at <> new.committed_at
     or v_audit.recorded_at <> new.committed_at
     or v_command.authorized_at > new.committed_at
     or new.committed_at >= v_command.authorization_not_after
     or v_command.authorization_decision_refs <>
        v_stream.authorization_decision_refs
     or row(v_audit.actor_kind, v_audit.actor_employee_id,
            v_audit.actor_trusted_service_id, v_audit.authorization_epoch,
            v_audit.client_mutation_id, v_audit.command_type_id,
            v_audit.request_hash)
       is distinct from
       row(v_command.actor_kind, v_command.actor_employee_id,
           v_command.actor_trusted_service_id, v_command.authorization_epoch,
           v_command.client_mutation_id, v_command.command_type_id,
           v_command.request_hash)
     or v_audit.correlation_id <> v_stream.correlation_id
     or v_audit.authorization_decision_refs <>
        v_stream.authorization_decision_refs
     or v_stream.command_ids <> to_jsonb(array[v_command.id]::text[])
     or v_stream.client_mutation_ids <>
        to_jsonb(array[v_command.client_mutation_id]::text[]) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_mutation_command_audit_mismatch';
  end if;

  if not public.inbox_v2_auth_decision_refs_safe(
       v_command.authorization_decision_refs,
       new.tenant_id,
       v_command.authorized_at,
       true
     )
     or not public.inbox_v2_auth_decision_refs_safe(
       v_stream.authorization_decision_refs,
       new.tenant_id,
       new.committed_at,
       true
     )
     or not public.inbox_v2_auth_json_tenant_safe(
       v_stream.audience_impact_manifest, new.tenant_id
     )
     or not public.inbox_v2_auth_payload_reference_safe(
       v_audit.evidence_reference, new.tenant_id
     ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_decision_manifest_invalid';
  end if;

  select min((decision_ref->>'notAfter')::timestamptz)
    into v_decision_not_after
    from jsonb_array_elements(
      v_command.authorization_decision_refs
    ) decision_ref;
  if v_command.authorization_not_after is distinct from v_decision_not_after
     or not exists (
       select 1
         from jsonb_array_elements(
           v_command.authorization_decision_refs
         ) decision_ref
        where decision_ref->>'id' = v_command.authorization_decision_id
          and decision_ref->>'authorizationEpoch' =
            v_command.authorization_epoch
          and decision_ref->>'outcome' = 'allowed'
     )
     or exists (
       select 1
         from jsonb_array_elements(
           v_command.authorization_decision_refs
         ) decision_ref
        where decision_ref->>'authorizationEpoch' <>
            v_command.authorization_epoch
           or case v_command.actor_kind
             when 'employee' then
               decision_ref->'principal'->>'kind' <> 'employee'
               or decision_ref->'principal'->'employee'->>'tenantId' <>
                 new.tenant_id
               or decision_ref->'principal'->'employee'->>'id' <>
                 v_command.actor_employee_id
             when 'trusted_service' then
               decision_ref->'principal'->>'kind' <> 'trusted_service'
               or decision_ref->'principal'->>'trustedServiceId' <>
                 v_command.actor_trusted_service_id
             else true
           end
     ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_decision_manifest_invalid';
  end if;

  select count(*)::integer,
         coalesce(to_jsonb(array_agg(change_row.id order by change_row.ordinal)),
                  '[]'::jsonb)
    into v_change_count, v_change_ids
    from public.inbox_v2_tenant_stream_changes change_row
   where change_row.tenant_id = new.tenant_id
     and change_row.stream_commit_id = new.stream_commit_id
     and change_row.mutation_id = new.mutation_id;
  select count(*)::integer,
         coalesce(to_jsonb(array_agg(event_row.id order by event_row.ordinal)),
                  '[]'::jsonb),
         count(*) filter (
           where event_row.type_id = 'core:authorization.changed'
         )::integer
    into v_event_count, v_event_ids, v_authorization_event_count
    from public.inbox_v2_domain_events event_row
   where event_row.tenant_id = new.tenant_id
     and event_row.stream_commit_id = new.stream_commit_id
     and event_row.mutation_id = new.mutation_id;
  select count(*)::integer,
         coalesce(to_jsonb(array_agg(intent_row.id order by intent_row.ordinal)),
                  '[]'::jsonb),
         count(*) filter (
           where intent_row.effect_class = 'projection'
             and intent_row.type_id = 'core:projection.update'
         )::integer
    into v_outbox_count, v_outbox_ids, v_projection_count
    from public.inbox_v2_outbox_intents intent_row
   where intent_row.tenant_id = new.tenant_id
     and intent_row.stream_commit_id = new.stream_commit_id
     and intent_row.mutation_id = new.mutation_id;

  if row(v_change_count, v_event_count, v_outbox_count,
         v_change_ids, v_event_ids, v_outbox_ids)
       is distinct from
     row(v_stream.change_count, v_stream.event_count,
         v_stream.outbox_intent_count, v_stream.change_ids,
         v_stream.event_ids, v_stream.outbox_intent_ids)
     or v_projection_count <> new.projection_intent_count
     or v_projection_count < 1
     or v_authorization_event_count < 1 then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_stream_manifest_incomplete';
  end if;

  select count(*)::integer into v_invalid_count
    from public.inbox_v2_tenant_stream_changes change_row
   where change_row.tenant_id = new.tenant_id
     and change_row.stream_commit_id = new.stream_commit_id
     and (change_row.stream_position <> v_stream.position
       or change_row.created_at <> new.committed_at
       or not public.inbox_v2_auth_payload_reference_safe(
         change_row.domain_commit_reference, new.tenant_id
       )
       or not public.inbox_v2_auth_payload_reference_safe(
         change_row.payload_reference, new.tenant_id
       )
       or not public.inbox_v2_auth_json_tenant_safe(
         change_row.timeline, new.tenant_id
       )
       or (change_row.timeline is not null and (
         not (change_row.timeline ?&
           array['conversation', 'timelineSequence']::text[])
         or (change_row.timeline -
           array['conversation', 'timelineSequence']::text[]) <> '{}'::jsonb
         or jsonb_typeof(change_row.timeline->'conversation') <> 'object'
         or not (change_row.timeline->'conversation' ?&
           array['tenantId', 'kind', 'id']::text[])
         or ((change_row.timeline->'conversation') -
           array['tenantId', 'kind', 'id']::text[]) <> '{}'::jsonb
         or jsonb_typeof(
           change_row.timeline->'conversation'->'tenantId'
         ) <> 'string'
         or change_row.timeline->'conversation'->>'tenantId' <>
           new.tenant_id
         or jsonb_typeof(
           change_row.timeline->'conversation'->'kind'
         ) <> 'string'
         or change_row.timeline->'conversation'->>'kind' <> 'conversation'
         or jsonb_typeof(
           change_row.timeline->'conversation'->'id'
         ) <> 'string'
         or char_length(
           change_row.timeline->'conversation'->>'id'
         ) not between 1 and 256
         or change_row.timeline->'conversation'->>'id' !~
           '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
         or jsonb_typeof(change_row.timeline->'timelineSequence') <> 'string'
         or change_row.timeline->>'timelineSequence' !~
           '^[1-9][0-9]{0,18}$'
       ))
       or (change_row.state_kind = 'upsert' and (
         change_row.payload_reference->>'schemaId' <>
           change_row.state_schema_id
         or change_row.payload_reference->>'schemaVersion' <>
           change_row.state_schema_version
       )));
  select v_invalid_count + count(*)::integer into v_invalid_count
    from public.inbox_v2_domain_events event_row
   where event_row.tenant_id = new.tenant_id
     and event_row.stream_commit_id = new.stream_commit_id
     and (event_row.stream_position <> v_stream.position
       or event_row.recorded_at <> new.committed_at
       or event_row.correlation_id <> v_stream.correlation_id
       or event_row.command_ids <> v_stream.command_ids
       or event_row.client_mutation_ids <> v_stream.client_mutation_ids
       or event_row.authorization_decision_refs <>
          v_stream.authorization_decision_refs
       or (event_row.type_id = 'core:authorization.changed'
         and event_row.access_effect <> 'may_change_access')
       or not (v_stream.change_ids @> event_row.change_ids)
       or not public.inbox_v2_auth_payload_reference_safe(
         event_row.payload_reference, new.tenant_id
       )
       or (event_row.payload_reference is not null and (
         event_row.payload_reference->>'schemaId' <>
           event_row.payload_schema_id
         or event_row.payload_reference->>'schemaVersion' <>
           event_row.payload_schema_version
       ))
       or not public.inbox_v2_auth_decision_refs_safe(
         event_row.authorization_decision_refs,
         new.tenant_id,
         new.committed_at,
         true
       )
       or exists (
         select 1
           from jsonb_array_elements(event_row.subjects) subject_row
          where jsonb_typeof(subject_row) <> 'object'
             or not (subject_row ?&
               array['tenantId', 'entityTypeId', 'entityId']::text[])
             or (subject_row -
               array['tenantId', 'entityTypeId', 'entityId']::text[]) <>
                 '{}'::jsonb
             or subject_row->>'tenantId' <> new.tenant_id
             or jsonb_typeof(subject_row->'tenantId') <> 'string'
             or jsonb_typeof(subject_row->'entityTypeId') <> 'string'
             or not public.inbox_v2_auth_catalog_id_safe(
               subject_row->>'entityTypeId'
             )
             or jsonb_typeof(subject_row->'entityId') <> 'string'
             or char_length(subject_row->>'entityId') not between 1 and 512
             or subject_row->>'entityId' !~
               '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
       ));
  select v_invalid_count + count(*)::integer into v_invalid_count
    from public.inbox_v2_outbox_intents intent_row
    join public.inbox_v2_domain_events event_row
      on event_row.tenant_id = intent_row.tenant_id
     and event_row.id = intent_row.event_id
   where intent_row.tenant_id = new.tenant_id
     and intent_row.stream_commit_id = new.stream_commit_id
     and (intent_row.stream_position <> v_stream.position
       or intent_row.created_at <> new.committed_at
       or intent_row.available_at < new.committed_at
       or intent_row.correlation_id <> v_stream.correlation_id
       or event_row.stream_commit_id <> new.stream_commit_id
       or event_row.mutation_id <> new.mutation_id
       or event_row.correlation_id <> intent_row.correlation_id
       or intent_row.effect_class = 'provider_io'
       or not (v_stream.change_ids @> intent_row.change_ids)
       or not (event_row.change_ids @> intent_row.change_ids)
       or not public.inbox_v2_auth_payload_reference_safe(
         intent_row.payload_reference, new.tenant_id
       ));
  if v_invalid_count <> 0 then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_stream_child_mismatch';
  end if;

  select 'sha256:' || encode(sha256(convert_to(coalesce(string_agg(
           manifest_row.item_hash,
           chr(10) order by manifest_row.kind_ordinal, manifest_row.ordinal
         ), ''), 'UTF8')), 'hex')
    into v_stream_manifest_digest
    from (
      select 1 as kind_ordinal, change_row.ordinal,
             'change:' || change_row.state_hash as item_hash
        from public.inbox_v2_tenant_stream_changes change_row
       where change_row.tenant_id = new.tenant_id
         and change_row.stream_commit_id = new.stream_commit_id
      union all
      select 2, event_row.ordinal, 'event:' || event_row.event_hash
        from public.inbox_v2_domain_events event_row
       where event_row.tenant_id = new.tenant_id
         and event_row.stream_commit_id = new.stream_commit_id
      union all
      select 3, intent_row.ordinal, 'intent:' || intent_row.intent_hash
        from public.inbox_v2_outbox_intents intent_row
       where intent_row.tenant_id = new.tenant_id
         and intent_row.stream_commit_id = new.stream_commit_id
    ) manifest_row;
  if v_stream_manifest_digest <> v_stream.manifest_digest_sha256 then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_stream_digest_mismatch';
  end if;

  select count(*)::integer,
         'sha256:' || encode(sha256(convert_to(coalesce(string_agg(
           effect_row.effect_hash, chr(10) order by effect_row.ordinal
         ), ''), 'UTF8')), 'hex')
    into v_effect_count, v_effect_digest
    from public.inbox_v2_auth_revision_effects effect_row
   where effect_row.tenant_id = new.tenant_id
     and effect_row.mutation_id = new.mutation_id;
  select count(*)::integer,
         'sha256:' || encode(sha256(convert_to(coalesce(string_agg(
           write_row.write_hash, chr(10) order by write_row.ordinal
         ), ''), 'UTF8')), 'hex')
    into v_relation_count, v_relation_digest
    from public.inbox_v2_auth_relation_writes write_row
   where write_row.tenant_id = new.tenant_id
     and write_row.mutation_id = new.mutation_id;
  select count(*)::integer,
         'sha256:' || encode(sha256(convert_to(coalesce(string_agg(
           facet_row.facet_hash, chr(10) order by facet_row.ordinal
         ), ''), 'UTF8')), 'hex')
    into v_facet_count, v_facet_digest
    from public.inbox_v2_auth_audit_facets facet_row
   where facet_row.tenant_id = new.tenant_id
     and facet_row.audit_event_id = new.audit_event_id;

  if row(v_effect_count, v_effect_digest, v_relation_count,
         v_relation_digest, v_facet_count, v_facet_digest)
       is distinct from
     row(new.revision_effect_count, new.revision_effect_digest_sha256,
         new.relation_write_count, new.relation_write_digest_sha256,
         v_audit.facet_count, v_audit.facets_digest_sha256)
     or v_audit.revision_delta_hash <> v_effect_digest then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_mutation_manifest_incomplete';
  end if;

  select count(*)::integer into v_invalid_count
    from public.inbox_v2_auth_revision_effects effect_row
   where effect_row.tenant_id = new.tenant_id
     and effect_row.mutation_id = new.mutation_id
     and (effect_row.created_at <> new.committed_at or not case effect_row.effect_kind
       when 'tenant_rbac' then exists (
         select 1 from public.inbox_v2_auth_tenant_heads head_row
          where head_row.tenant_id = effect_row.tenant_id
            and head_row.tenant_rbac_revision = effect_row.after_revision
       )
       when 'shared_access' then exists (
         select 1 from public.inbox_v2_auth_tenant_heads head_row
          where head_row.tenant_id = effect_row.tenant_id
            and head_row.shared_access_revision = effect_row.after_revision
       )
       when 'employee_access' then exists (
         select 1 from public.inbox_v2_auth_employee_heads head_row
          where head_row.tenant_id = effect_row.tenant_id
            and head_row.employee_id = effect_row.employee_id
            and head_row.employee_access_revision = effect_row.after_revision
       )
       when 'employee_inbox_relation' then exists (
         select 1 from public.inbox_v2_auth_employee_heads head_row
          where head_row.tenant_id = effect_row.tenant_id
            and head_row.employee_id = effect_row.employee_id
            and head_row.employee_inbox_relation_revision =
                effect_row.after_revision
       )
        when 'resource_access' then (
         (effect_row.resource_head_id is not null and exists (
           select 1 from public.inbox_v2_auth_resource_heads head_row
            where head_row.tenant_id = effect_row.tenant_id
              and head_row.id = effect_row.resource_head_id
              and head_row.resource_access_revision = effect_row.after_revision
         )) or
         (effect_row.work_item_id is not null and exists (
           select 1 from public.inbox_v2_work_items work_item
            where work_item.tenant_id = effect_row.tenant_id
              and work_item.id = effect_row.work_item_id
              and work_item.resource_access_revision = effect_row.after_revision
          ))
        )
       when 'collaborator_set' then (
         (effect_row.resource_head_id is not null and exists (
           select 1 from public.inbox_v2_auth_resource_heads head_row
            where head_row.tenant_id = effect_row.tenant_id
              and head_row.id = effect_row.resource_head_id
              and head_row.collaborator_set_revision =
                  effect_row.after_revision
              and head_row.updated_at = effect_row.created_at
         )) or
         (effect_row.work_item_id is not null and exists (
           select 1 from public.inbox_v2_work_items work_item_row
            where work_item_row.tenant_id = effect_row.tenant_id
              and work_item_row.id = effect_row.work_item_id
              and work_item_row.reopen_cycle = effect_row.work_item_cycle
              and work_item_row.revision =
                  effect_row.resulting_work_item_revision
              and work_item_row.collaborator_set_revision =
                  effect_row.after_revision
              and work_item_row.updated_at = effect_row.created_at
         ))
       )
       else false
     end);
  if v_invalid_count <> 0 then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_revision_effect_invalid';
  end if;

  select count(*)::integer into v_invalid_count
    from public.inbox_v2_auth_relation_writes write_row
   where write_row.tenant_id = new.tenant_id
     and write_row.mutation_id = new.mutation_id
     and (write_row.created_at <> new.committed_at or not case write_row.relation_kind
       when 'role' then exists (
         select 1 from public.inbox_v2_auth_role_versions version_row
          join public.inbox_v2_auth_role_heads head_row
            on head_row.tenant_id = version_row.tenant_id
           and head_row.role_id = version_row.role_id
           and head_row.current_revision = version_row.revision
          where version_row.tenant_id = write_row.tenant_id
            and version_row.role_id = write_row.role_id
            and version_row.revision = write_row.resulting_revision
            and write_row.previous_revision is not distinct from case
              when version_row.revision = 1 then null::bigint
              else version_row.revision - 1
            end
            and version_row.mutation_id = write_row.mutation_id
            and version_row.occurred_at = new.committed_at
       )
       when 'role_binding' then exists (
         select 1 from public.inbox_v2_auth_role_binding_versions version_row
          join public.inbox_v2_auth_role_binding_heads head_row
            on head_row.tenant_id = version_row.tenant_id
           and head_row.binding_id = version_row.binding_id
           and head_row.current_revision = version_row.revision
          where version_row.tenant_id = write_row.tenant_id
            and version_row.binding_id = write_row.role_binding_id
            and version_row.revision = write_row.resulting_revision
            and write_row.previous_revision is not distinct from case
              when version_row.revision = 1 then null::bigint
              else version_row.revision - 1
            end
            and version_row.mutation_id = write_row.mutation_id
            and version_row.occurred_at = new.committed_at
       )
       when 'direct_grant' then exists (
         select 1 from public.inbox_v2_auth_direct_grant_versions version_row
          join public.inbox_v2_auth_direct_grant_heads head_row
            on head_row.tenant_id = version_row.tenant_id
           and head_row.grant_id = version_row.grant_id
           and head_row.current_revision = version_row.revision
          where version_row.tenant_id = write_row.tenant_id
            and version_row.grant_id = write_row.direct_grant_id
            and version_row.revision = write_row.resulting_revision
            and write_row.previous_revision is not distinct from case
              when version_row.revision = 1 then null::bigint
              else version_row.revision - 1
            end
            and version_row.mutation_id = write_row.mutation_id
            and version_row.occurred_at = new.committed_at
       )
       when 'workforce_membership' then exists (
         select 1 from public.inbox_v2_auth_workforce_membership_versions version_row
          join public.inbox_v2_auth_workforce_membership_heads head_row
            on head_row.tenant_id = version_row.tenant_id
           and head_row.membership_id = version_row.membership_id
           and head_row.current_revision = version_row.revision
          where version_row.tenant_id = write_row.tenant_id
            and version_row.membership_id = write_row.workforce_membership_id
            and version_row.revision = write_row.resulting_revision
            and write_row.previous_revision is not distinct from case
              when version_row.revision = 1 then null::bigint
              else version_row.revision - 1
            end
            and version_row.mutation_id = write_row.mutation_id
            and version_row.occurred_at = new.committed_at
       )
       when 'structural_access' then exists (
         select 1 from public.inbox_v2_auth_structural_access_versions version_row
          join public.inbox_v2_auth_structural_access_heads head_row
            on head_row.tenant_id = version_row.tenant_id
           and head_row.binding_id = version_row.binding_id
           and head_row.current_revision = version_row.revision
          where version_row.tenant_id = write_row.tenant_id
            and version_row.binding_id = write_row.structural_access_binding_id
            and version_row.revision = write_row.resulting_revision
            and write_row.previous_revision is not distinct from case
              when version_row.revision = 1 then null::bigint
              else version_row.revision - 1
            end
            and version_row.mutation_id = write_row.mutation_id
            and version_row.occurred_at = new.committed_at
       )
       when 'conversation_collaborator' then exists (
         select 1 from public.inbox_v2_auth_collaborator_versions version_row
          join public.inbox_v2_auth_collaborator_heads head_row
            on head_row.tenant_id = version_row.tenant_id
           and head_row.collaborator_id = version_row.collaborator_id
           and head_row.current_revision = version_row.revision
          where version_row.tenant_id = write_row.tenant_id
            and version_row.collaborator_id = write_row.collaborator_id
            and version_row.revision = write_row.resulting_revision
            and write_row.previous_revision is not distinct from case
              when version_row.revision = 1 then null::bigint
              else version_row.revision - 1
            end
            and version_row.resource_kind = 'conversation'
            and version_row.mutation_id = write_row.mutation_id
            and version_row.occurred_at = new.committed_at
            and exists (
              select 1 from public.inbox_v2_auth_resource_heads resource_head
               where resource_head.tenant_id = version_row.tenant_id
                 and resource_head.resource_kind = 'conversation'
                 and resource_head.conversation_id = version_row.conversation_id
                 and resource_head.updated_at = new.committed_at
            )
       )
       when 'work_item_collaborator' then exists (
         select 1 from public.inbox_v2_auth_collaborator_versions version_row
          join public.inbox_v2_auth_collaborator_heads head_row
            on head_row.tenant_id = version_row.tenant_id
           and head_row.collaborator_id = version_row.collaborator_id
           and head_row.current_revision = version_row.revision
          where version_row.tenant_id = write_row.tenant_id
            and version_row.collaborator_id = write_row.collaborator_id
            and version_row.revision = write_row.resulting_revision
            and write_row.previous_revision is not distinct from case
              when version_row.revision = 1 then null::bigint
              else version_row.revision - 1
            end
            and version_row.resource_kind = 'work_item'
            and version_row.work_item_cycle >= 0
            and version_row.mutation_id = write_row.mutation_id
            and version_row.occurred_at = new.committed_at
            and exists (
              select 1 from public.inbox_v2_work_items work_item
               where work_item.tenant_id = version_row.tenant_id
                 and work_item.id = version_row.work_item_id
                 and work_item.reopen_cycle = version_row.work_item_cycle
            )
       )
       when 'internal_membership' then exists (
         select 1 from public.inbox_v2_participant_membership_transitions transition_row
          where transition_row.tenant_id = write_row.tenant_id
            and transition_row.id = write_row.internal_membership_transition_id
            and transition_row.resulting_revision = write_row.resulting_revision
            and transition_row.current_revision is not distinct from
                write_row.previous_revision
            and transition_row.cause_kind = 'hulee_internal_command'
            and v_command.actor_kind = 'employee'
            and transition_row.cause_actor_employee_id =
                v_command.actor_employee_id
            and transition_row.occurred_at = new.committed_at
       )
       when 'primary_responsibility' then exists (
         select 1 from public.inbox_v2_work_item_transitions transition_row
          where transition_row.tenant_id = write_row.tenant_id
            and transition_row.id = write_row.primary_responsibility_transition_id
            and transition_row.resulting_revision = write_row.resulting_revision
            and transition_row.expected_revision = write_row.previous_revision
            and (transition_row.closed_primary_assignment_id is not null
              or transition_row.opened_primary_assignment_id is not null)
            and row(
              transition_row.actor_kind::text,
              transition_row.actor_employee_id,
              transition_row.actor_trusted_service_id,
              transition_row.actor_authorization_epoch
            ) is not distinct from row(
              v_command.actor_kind::text,
              v_command.actor_employee_id,
              v_command.actor_trusted_service_id,
              case when v_command.actor_kind = 'employee'
                then v_command.authorization_epoch else null::text end
            )
            and transition_row.occurred_at = new.committed_at
       )
       when 'servicing_team' then exists (
         select 1 from public.inbox_v2_work_item_relation_transitions transition_row
          where transition_row.tenant_id = write_row.tenant_id
            and transition_row.id = write_row.servicing_team_transition_id
            and transition_row.resulting_relation_revision =
                write_row.resulting_revision
            and transition_row.expected_relation_revision =
                write_row.previous_revision
            and row(
              transition_row.actor_kind::text,
              transition_row.actor_employee_id,
              transition_row.actor_trusted_service_id,
              transition_row.actor_authorization_epoch
            ) is not distinct from row(
              v_command.actor_kind::text,
              v_command.actor_employee_id,
              v_command.actor_trusted_service_id,
              case when v_command.actor_kind = 'employee'
                then v_command.authorization_epoch else null::text end
            )
            and transition_row.occurred_at = new.committed_at
       )
       else false
     end);
  if v_invalid_count <> 0 then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_relation_write_invalid';
  end if;

  select count(*) filter (
           where write_row.relation_kind in ('role', 'role_binding')
         )::integer,
         count(*) filter (
           where write_row.relation_kind in ('structural_access', 'servicing_team')
         )::integer,
         count(*) filter (
           where write_row.relation_kind in ('direct_grant', 'workforce_membership')
         )::integer,
         count(*) filter (
           where write_row.relation_kind in (
             'conversation_collaborator', 'work_item_collaborator',
             'internal_membership', 'primary_responsibility'
           )
         )::integer
    into v_role_write_count, v_structural_write_count,
         v_direct_access_write_count, v_direct_relation_write_count
    from public.inbox_v2_auth_relation_writes write_row
   where write_row.tenant_id = new.tenant_id
     and write_row.mutation_id = new.mutation_id;

  if v_role_write_count = v_relation_count then
    select count(*)::integer,
           min(effect_row.before_revision),
           max(effect_row.after_revision)
      into v_count, v_before_revision, v_after_revision
      from public.inbox_v2_auth_revision_effects effect_row
     where effect_row.tenant_id = new.tenant_id
       and effect_row.mutation_id = new.mutation_id
       and effect_row.effect_kind = 'tenant_rbac';
    if v_stream.audience_impact_kind <> 'tenant_rbac'
       or v_count <> 1 or v_effect_count <> 1
       or not (v_stream.audience_impact_manifest ?& array[
         'kind', 'impactId', 'deliveryFence',
         'previousTenantRbacRevision', 'resultingTenantRbacRevision',
         'invalidations', 'indexedFanoutPlanId'
       ]::text[])
       or (v_stream.audience_impact_manifest - array[
         'kind', 'impactId', 'deliveryFence',
         'previousTenantRbacRevision', 'resultingTenantRbacRevision',
         'invalidations', 'indexedFanoutPlanId'
       ]::text[]) <> '{}'::jsonb
       or jsonb_typeof(
         v_stream.audience_impact_manifest->'impactId'
       ) <> 'string'
       or char_length(v_stream.audience_impact_manifest->>'impactId')
         not between 1 and 512
       or v_stream.audience_impact_manifest->>'impactId' !~
         '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
       or v_stream.audience_impact_manifest->>'deliveryFence' <>
         'invalidate_before_payload'
       or jsonb_typeof(
         v_stream.audience_impact_manifest->'previousTenantRbacRevision'
       ) <> 'string'
       or jsonb_typeof(
         v_stream.audience_impact_manifest->'resultingTenantRbacRevision'
       ) <> 'string'
       or v_stream.audience_impact_manifest->>'previousTenantRbacRevision' <>
         v_before_revision::text
       or v_stream.audience_impact_manifest->>'resultingTenantRbacRevision' <>
         v_after_revision::text
       or jsonb_typeof(
         v_stream.audience_impact_manifest->'indexedFanoutPlanId'
       ) <> 'string'
       or char_length(
         v_stream.audience_impact_manifest->>'indexedFanoutPlanId'
       ) not between 1 and 512
       or v_stream.audience_impact_manifest->>'indexedFanoutPlanId' !~
         '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
       or jsonb_typeof(
         v_stream.audience_impact_manifest->'invalidations'
       ) <> 'array'
       or (case when jsonb_typeof(
         v_stream.audience_impact_manifest->'invalidations'
       ) = 'array' then jsonb_array_length(
         v_stream.audience_impact_manifest->'invalidations'
       ) not between 1 and 1000 else true end)
       or not public.inbox_v2_auth_invalidations_safe(
         v_stream.audience_impact_manifest->'invalidations',
         new.tenant_id,
         1000
       ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_tenant_rbac_fanout_invalid';
    end if;
  elsif v_structural_write_count = v_relation_count then
    select count(*) filter (where effect_row.effect_kind = 'shared_access')::integer,
           count(*) filter (where effect_row.effect_kind = 'resource_access')::integer
      into v_count, v_invalid_count
      from public.inbox_v2_auth_revision_effects effect_row
     where effect_row.tenant_id = new.tenant_id
       and effect_row.mutation_id = new.mutation_id;
    if v_stream.audience_impact_kind <> 'structural'
       or v_count <> 1 or v_invalid_count < 1
       or v_effect_count <> v_count + v_invalid_count then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_structural_impact_invalid';
    end if;

    with expected_targets(resource_head_id, work_item_id) as (
      select version_row.resource_head_id, null::text
        from public.inbox_v2_auth_relation_writes write_row
        join public.inbox_v2_auth_structural_access_versions version_row
          on version_row.tenant_id = write_row.tenant_id
         and version_row.binding_id = write_row.structural_access_binding_id
         and version_row.revision = write_row.resulting_revision
         and version_row.mutation_id = write_row.mutation_id
       where write_row.tenant_id = new.tenant_id
         and write_row.mutation_id = new.mutation_id
         and write_row.relation_kind = 'structural_access'
      union
      select null::text, transition_row.work_item_id
        from public.inbox_v2_auth_relation_writes write_row
        join public.inbox_v2_work_item_relation_transitions transition_row
          on transition_row.tenant_id = write_row.tenant_id
         and transition_row.id = write_row.servicing_team_transition_id
         and transition_row.resulting_relation_revision =
           write_row.resulting_revision
       where write_row.tenant_id = new.tenant_id
         and write_row.mutation_id = new.mutation_id
         and write_row.relation_kind = 'servicing_team'
    ), actual_targets as (
      select effect_row.resource_head_id, effect_row.work_item_id
        from public.inbox_v2_auth_revision_effects effect_row
       where effect_row.tenant_id = new.tenant_id
         and effect_row.mutation_id = new.mutation_id
         and effect_row.effect_kind = 'resource_access'
    )
    select exists (
      (select * from expected_targets except select * from actual_targets)
      union all
      (select * from actual_targets except select * from expected_targets)
    ) into v_closed;
    if v_closed then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_structural_target_set_mismatch';
    end if;

    select effect_row.before_revision, effect_row.after_revision
      into strict v_before_revision, v_after_revision
      from public.inbox_v2_auth_revision_effects effect_row
     where effect_row.tenant_id = new.tenant_id
       and effect_row.mutation_id = new.mutation_id
       and effect_row.effect_kind = 'shared_access';
    if not (v_stream.audience_impact_manifest ?& array[
         'kind', 'impactId', 'deliveryFence',
         'previousSharedAccessRevision', 'resultingSharedAccessRevision',
         'invalidations', 'indexedFanoutPlanId'
       ]::text[])
       or (v_stream.audience_impact_manifest - array[
         'kind', 'impactId', 'deliveryFence',
         'previousSharedAccessRevision', 'resultingSharedAccessRevision',
         'invalidations', 'indexedFanoutPlanId'
       ]::text[]) <> '{}'::jsonb
       or jsonb_typeof(
         v_stream.audience_impact_manifest->'impactId'
       ) <> 'string'
       or char_length(v_stream.audience_impact_manifest->>'impactId')
         not between 1 and 512
       or v_stream.audience_impact_manifest->>'impactId' !~
         '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
       or v_stream.audience_impact_manifest->>'deliveryFence' <>
         'invalidate_before_payload'
       or jsonb_typeof(
         v_stream.audience_impact_manifest->'previousSharedAccessRevision'
       ) <> 'string'
       or jsonb_typeof(
         v_stream.audience_impact_manifest->'resultingSharedAccessRevision'
       ) <> 'string'
       or v_stream.audience_impact_manifest->>'previousSharedAccessRevision' <>
         v_before_revision::text
       or v_stream.audience_impact_manifest->>'resultingSharedAccessRevision' <>
         v_after_revision::text
       or jsonb_typeof(
         v_stream.audience_impact_manifest->'indexedFanoutPlanId'
       ) <> 'string'
       or char_length(
         v_stream.audience_impact_manifest->>'indexedFanoutPlanId'
       ) not between 1 and 512
       or v_stream.audience_impact_manifest->>'indexedFanoutPlanId' !~
         '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
       or jsonb_typeof(
         v_stream.audience_impact_manifest->'invalidations'
       ) <> 'array'
       or (case when jsonb_typeof(
         v_stream.audience_impact_manifest->'invalidations'
       ) = 'array' then jsonb_array_length(
         v_stream.audience_impact_manifest->'invalidations'
       ) not between 1 and 1000 else true end)
       or not public.inbox_v2_auth_invalidations_safe(
         v_stream.audience_impact_manifest->'invalidations',
         new.tenant_id,
         1000
       ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_structural_audience_invalid';
    end if;
  elsif v_direct_access_write_count = v_relation_count then
    select count(*)::integer into v_count
      from public.inbox_v2_auth_revision_effects effect_row
     where effect_row.tenant_id = new.tenant_id
       and effect_row.mutation_id = new.mutation_id
       and effect_row.effect_kind = 'employee_access';
    if v_stream.audience_impact_kind <> 'direct'
       or v_count < 1 or v_count <> v_effect_count then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_employee_access_impact_invalid';
    end if;

    with expected_targets(employee_id) as (
      select version_row.employee_id
        from public.inbox_v2_auth_relation_writes write_row
        join public.inbox_v2_auth_direct_grant_versions version_row
          on version_row.tenant_id = write_row.tenant_id
         and version_row.grant_id = write_row.direct_grant_id
         and version_row.revision = write_row.resulting_revision
         and version_row.mutation_id = write_row.mutation_id
       where write_row.tenant_id = new.tenant_id
         and write_row.mutation_id = new.mutation_id
         and write_row.relation_kind = 'direct_grant'
      union
      select version_row.employee_id
        from public.inbox_v2_auth_relation_writes write_row
        join public.inbox_v2_auth_workforce_membership_versions version_row
          on version_row.tenant_id = write_row.tenant_id
         and version_row.membership_id = write_row.workforce_membership_id
         and version_row.revision = write_row.resulting_revision
         and version_row.mutation_id = write_row.mutation_id
       where write_row.tenant_id = new.tenant_id
         and write_row.mutation_id = new.mutation_id
         and write_row.relation_kind = 'workforce_membership'
    ), actual_targets as (
      select effect_row.employee_id
        from public.inbox_v2_auth_revision_effects effect_row
       where effect_row.tenant_id = new.tenant_id
         and effect_row.mutation_id = new.mutation_id
         and effect_row.effect_kind = 'employee_access'
    )
    select exists (
      (select * from expected_targets except select * from actual_targets)
      union all
      (select * from actual_targets except select * from expected_targets)
    ) into v_closed;
    if v_closed then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_employee_access_target_set_mismatch';
    end if;
  elsif v_direct_relation_write_count = v_relation_count then
    select count(*) filter (
             where effect_row.effect_kind = 'employee_inbox_relation'
           )::integer,
           count(*) filter (
             where effect_row.effect_kind = 'collaborator_set'
           )::integer
      into v_count, v_invalid_count
      from public.inbox_v2_auth_revision_effects effect_row
     where effect_row.tenant_id = new.tenant_id
       and effect_row.mutation_id = new.mutation_id;
    if v_stream.audience_impact_kind <> 'direct'
       or v_count < 1
       or v_count + v_invalid_count <> v_effect_count
       or (exists (
         select 1 from public.inbox_v2_auth_relation_writes write_row
          where write_row.tenant_id = new.tenant_id
            and write_row.mutation_id = new.mutation_id
            and write_row.relation_kind in (
              'conversation_collaborator', 'work_item_collaborator'
            )
       )) is distinct from (v_invalid_count = 1) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_direct_relation_impact_invalid';
    end if;

    with expected_targets(employee_id) as (
      select version_row.employee_id
        from public.inbox_v2_auth_relation_writes write_row
        join public.inbox_v2_auth_collaborator_versions version_row
          on version_row.tenant_id = write_row.tenant_id
         and version_row.collaborator_id = write_row.collaborator_id
         and version_row.revision = write_row.resulting_revision
         and version_row.mutation_id = write_row.mutation_id
       where write_row.tenant_id = new.tenant_id
         and write_row.mutation_id = new.mutation_id
         and write_row.relation_kind in (
           'conversation_collaborator', 'work_item_collaborator'
         )
      union
      select participant_row.subject_employee_id
        from public.inbox_v2_auth_relation_writes write_row
        join public.inbox_v2_participant_membership_transitions transition_row
          on transition_row.tenant_id = write_row.tenant_id
         and transition_row.id = write_row.internal_membership_transition_id
         and transition_row.resulting_revision = write_row.resulting_revision
        join public.inbox_v2_conversation_participants participant_row
          on participant_row.tenant_id = transition_row.tenant_id
         and participant_row.id = transition_row.participant_id
         and participant_row.conversation_id = transition_row.conversation_id
         and participant_row.subject_kind = 'employee'
       where write_row.tenant_id = new.tenant_id
         and write_row.mutation_id = new.mutation_id
         and write_row.relation_kind = 'internal_membership'
      union
      select assignment_row.employee_id
        from public.inbox_v2_auth_relation_writes write_row
        join public.inbox_v2_work_item_transitions transition_row
          on transition_row.tenant_id = write_row.tenant_id
         and transition_row.id = write_row.primary_responsibility_transition_id
         and transition_row.resulting_revision = write_row.resulting_revision
        join public.inbox_v2_work_item_primary_assignments assignment_row
          on assignment_row.tenant_id = transition_row.tenant_id
         and assignment_row.id = transition_row.closed_primary_assignment_id
       where write_row.tenant_id = new.tenant_id
         and write_row.mutation_id = new.mutation_id
         and write_row.relation_kind = 'primary_responsibility'
      union
      select assignment_row.employee_id
        from public.inbox_v2_auth_relation_writes write_row
        join public.inbox_v2_work_item_transitions transition_row
          on transition_row.tenant_id = write_row.tenant_id
         and transition_row.id = write_row.primary_responsibility_transition_id
         and transition_row.resulting_revision = write_row.resulting_revision
        join public.inbox_v2_work_item_primary_assignments assignment_row
          on assignment_row.tenant_id = transition_row.tenant_id
         and assignment_row.id = transition_row.opened_primary_assignment_id
       where write_row.tenant_id = new.tenant_id
         and write_row.mutation_id = new.mutation_id
         and write_row.relation_kind = 'primary_responsibility'
    ), actual_targets as (
      select effect_row.employee_id
        from public.inbox_v2_auth_revision_effects effect_row
       where effect_row.tenant_id = new.tenant_id
         and effect_row.mutation_id = new.mutation_id
         and effect_row.effect_kind = 'employee_inbox_relation'
    )
    select exists (
      (select * from expected_targets except select * from actual_targets)
      union all
      (select * from actual_targets except select * from expected_targets)
    ) into v_closed;
    if v_closed then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_direct_relation_target_set_mismatch';
    end if;

    with expected_targets(
      resource_head_id, work_item_id, work_item_cycle
    ) as (
      select resource_head.id, version_row.work_item_id,
             version_row.work_item_cycle
        from public.inbox_v2_auth_relation_writes write_row
        join public.inbox_v2_auth_collaborator_versions version_row
          on version_row.tenant_id = write_row.tenant_id
         and version_row.collaborator_id = write_row.collaborator_id
         and version_row.revision = write_row.resulting_revision
         and version_row.mutation_id = write_row.mutation_id
        left join public.inbox_v2_auth_resource_heads resource_head
          on resource_head.tenant_id = version_row.tenant_id
         and version_row.resource_kind = 'conversation'
         and resource_head.resource_kind = 'conversation'
         and resource_head.conversation_id = version_row.conversation_id
       where write_row.tenant_id = new.tenant_id
         and write_row.mutation_id = new.mutation_id
         and write_row.relation_kind in (
           'conversation_collaborator', 'work_item_collaborator'
         )
    ), actual_targets as (
      select effect_row.resource_head_id, effect_row.work_item_id,
             effect_row.work_item_cycle
        from public.inbox_v2_auth_revision_effects effect_row
       where effect_row.tenant_id = new.tenant_id
         and effect_row.mutation_id = new.mutation_id
         and effect_row.effect_kind = 'collaborator_set'
    )
    select exists (
      (select * from expected_targets except select * from actual_targets)
      union all
      (select * from actual_targets except select * from expected_targets)
    ) into v_closed;
    if v_closed then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_collaborator_set_target_mismatch';
    end if;
  else
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_mutation_relation_class_mixed';
  end if;

  if v_stream.audience_impact_kind = 'direct' then
    if not (v_stream.audience_impact_manifest ?& array[
         'kind', 'impactId', 'deliveryFence', 'affectedRecipients'
       ]::text[])
       or (v_stream.audience_impact_manifest - array[
         'kind', 'impactId', 'deliveryFence', 'affectedRecipients'
       ]::text[]) <> '{}'::jsonb
       or jsonb_typeof(
         v_stream.audience_impact_manifest->'impactId'
       ) <> 'string'
       or char_length(v_stream.audience_impact_manifest->>'impactId')
         not between 1 and 512
       or v_stream.audience_impact_manifest->>'impactId' !~
         '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
       or v_stream.audience_impact_manifest->>'deliveryFence' <>
         'invalidate_before_payload'
       or jsonb_typeof(
         v_stream.audience_impact_manifest->'affectedRecipients'
       ) <> 'array'
       or (case when jsonb_typeof(
         v_stream.audience_impact_manifest->'affectedRecipients'
       ) = 'array' then jsonb_array_length(
         v_stream.audience_impact_manifest->'affectedRecipients'
       ) not between 1 and 1000 else true end) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_direct_audience_invalid';
    end if;

    select count(*)::integer into v_invalid_count
      from jsonb_array_elements(
        v_stream.audience_impact_manifest->'affectedRecipients'
      ) recipient_row
     where jsonb_typeof(recipient_row) <> 'object'
        or not (recipient_row ?& array[
          'employee', 'relation', 'previousAuthorizationEpoch',
          'resultingAuthorizationEpoch', 'invalidations',
          'authorizationDecisionRefs'
        ]::text[])
        or (recipient_row - array[
          'employee', 'relation', 'previousAuthorizationEpoch',
          'resultingAuthorizationEpoch', 'invalidations',
          'authorizationDecisionRefs'
        ]::text[]) <> '{}'::jsonb
        or jsonb_typeof(recipient_row->'employee') <> 'object'
        or not (recipient_row->'employee' ?&
          array['tenantId', 'kind', 'id']::text[])
        or ((recipient_row->'employee') -
          array['tenantId', 'kind', 'id']::text[]) <>
          '{}'::jsonb
        or jsonb_typeof(recipient_row->'employee'->'tenantId') <> 'string'
        or recipient_row->'employee'->>'tenantId' <> new.tenant_id
        or jsonb_typeof(recipient_row->'employee'->'kind') <> 'string'
        or recipient_row->'employee'->>'kind' <> 'employee'
        or jsonb_typeof(recipient_row->'employee'->'id') <> 'string'
        or char_length(recipient_row->'employee'->>'id') not between 1 and 256
        or recipient_row->'employee'->>'id' !~
          '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
        or jsonb_typeof(recipient_row->'relation') <> 'string'
        or recipient_row->>'relation' not in ('previous', 'resulting', 'both')
        or jsonb_typeof(
          recipient_row->'previousAuthorizationEpoch'
        ) <> 'string'
        or char_length(recipient_row->>'previousAuthorizationEpoch')
          not between 8 and 1024
        or jsonb_typeof(
          recipient_row->'resultingAuthorizationEpoch'
        ) <> 'string'
        or char_length(recipient_row->>'resultingAuthorizationEpoch')
          not between 8 and 1024
        or recipient_row->>'previousAuthorizationEpoch' =
          recipient_row->>'resultingAuthorizationEpoch'
        or jsonb_typeof(recipient_row->'invalidations') <> 'array'
        or (case when jsonb_typeof(recipient_row->'invalidations') = 'array'
          then jsonb_array_length(recipient_row->'invalidations')
            not between 1 and 64 else true end)
        or not public.inbox_v2_auth_json_tenant_safe(
          recipient_row->'invalidations', new.tenant_id
        )
        or not public.inbox_v2_auth_invalidations_safe(
          recipient_row->'invalidations', new.tenant_id, 64
        )
        or not public.inbox_v2_auth_decision_refs_safe(
          recipient_row->'authorizationDecisionRefs',
          new.tenant_id,
          new.committed_at,
          false
        )
        or not exists (
          select 1 from public.employees employee_row
           where employee_row.tenant_id = new.tenant_id
             and employee_row.id = recipient_row->'employee'->>'id'
        );
    if v_invalid_count <> 0 then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_direct_recipient_invalid';
    end if;

    select count(*)::integer into v_invalid_count
      from jsonb_array_elements(
        v_stream.audience_impact_manifest->'affectedRecipients'
      ) recipient_row
     where exists (
       select 1
         from jsonb_array_elements(
           recipient_row->'authorizationDecisionRefs'
         ) decision_ref
        where decision_ref->>'authorizationEpoch' <>
            recipient_row->>'resultingAuthorizationEpoch'
           or decision_ref->'principal'->>'kind' <> 'employee'
           or decision_ref->'principal'->'employee'->>'tenantId' <>
             new.tenant_id
           or decision_ref->'principal'->'employee'->>'id' <>
             recipient_row->'employee'->>'id'
     )
        or case recipient_row->>'relation'
          when 'previous' then
            not exists (
              select 1
                from jsonb_array_elements(
                  recipient_row->'authorizationDecisionRefs'
                ) decision_ref
               where decision_ref->>'outcome' = 'denied'
            ) or exists (
              select 1
                from jsonb_array_elements(
                  recipient_row->'authorizationDecisionRefs'
                ) decision_ref
               where decision_ref->>'outcome' = 'allowed'
            )
          when 'resulting' then
            not exists (
              select 1
                from jsonb_array_elements(
                  recipient_row->'authorizationDecisionRefs'
                ) decision_ref
               where decision_ref->>'outcome' = 'allowed'
            ) or exists (
              select 1
                from jsonb_array_elements(
                  recipient_row->'authorizationDecisionRefs'
                ) decision_ref
               where decision_ref->>'outcome' = 'denied'
            )
          when 'both' then
            not exists (
              select 1
                from jsonb_array_elements(
                  recipient_row->'authorizationDecisionRefs'
                ) decision_ref
               where decision_ref->>'outcome' = 'allowed'
            )
          else true
        end
        or (
          exists (
            select 1
              from jsonb_array_elements(
                recipient_row->'authorizationDecisionRefs'
              ) decision_ref
             where decision_ref->>'outcome' = 'denied'
          ) and not exists (
            select 1
              from jsonb_array_elements(
                recipient_row->'invalidations'
              ) invalidation
             where invalidation->>'kind' = 'recipient_scope'
          )
        );
    if v_invalid_count <> 0 then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_direct_recipient_relation_invalid';
    end if;

    select count(*)::integer - count(distinct
             recipient_row->'employee'->>'id')::integer
      into v_invalid_count
      from jsonb_array_elements(
        v_stream.audience_impact_manifest->'affectedRecipients'
      ) recipient_row;
    if v_invalid_count <> 0 then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_direct_recipient_duplicate';
    end if;

    select coalesce((
      select to_jsonb(array_agg(
        recipient_row.value->'employee'->>'id'
        order by recipient_row.ordinal
      ))
        from jsonb_array_elements(
          v_stream.audience_impact_manifest->'affectedRecipients'
        ) with ordinality recipient_row(value, ordinal)
    ), '[]'::jsonb) is distinct from coalesce((
      select to_jsonb(array_agg(
        effect_row.employee_id order by effect_row.ordinal
      ))
        from public.inbox_v2_auth_revision_effects effect_row
       where effect_row.tenant_id = new.tenant_id
         and effect_row.mutation_id = new.mutation_id
         and effect_row.effect_kind in (
           'employee_access', 'employee_inbox_relation'
         )
    ), '[]'::jsonb) into v_closed;
    if v_closed then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_direct_recipient_set_mismatch';
    end if;
  end if;

  select stream_head.last_position = v_stream.position
         and stream_head.stream_epoch = v_stream.stream_epoch
         and stream_head.updated_at = new.committed_at
    into v_closed
    from public.inbox_v2_tenant_stream_heads stream_head
   where stream_head.tenant_id = new.tenant_id;
  if not coalesce(v_closed, false) then
    raise exception using errcode = '40001',
      message = 'inbox_v2.authorization_stream_head_not_closed';
  end if;

  v_mutation_manifest_digest := 'sha256:' || encode(sha256(convert_to(
    'effects:' || v_effect_digest || chr(10) ||
    'relations:' || v_relation_digest || chr(10) ||
    'stream:' || v_stream.commit_hash || chr(10) ||
    'audit:' || v_audit.audit_hash,
    'UTF8'
  )), 'hex');
  if v_mutation_manifest_digest <> new.manifest_digest_sha256 then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_mutation_digest_mismatch';
  end if;
  return null;
exception
  when no_data_found or too_many_rows then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_mutation_parent_incomplete';
end;
$function$;

create or replace function public.inbox_v2_auth_mutation_child_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_mutation public.inbox_v2_auth_mutation_commits%rowtype;
  v_stream public.inbox_v2_tenant_stream_commits%rowtype;
  v_audit public.inbox_v2_auth_audit_events%rowtype;
  v_change_count integer;
  v_event_count integer;
  v_outbox_count integer;
  v_projection_count integer;
  v_effect_count integer;
  v_relation_count integer;
  v_facet_count integer;
begin
  if tg_table_name = 'inbox_v2_auth_audit_facets' then
    select mutation_row.* into strict v_mutation
      from public.inbox_v2_auth_audit_events audit_row
      join public.inbox_v2_auth_mutation_commits mutation_row
        on mutation_row.tenant_id = audit_row.tenant_id
       and mutation_row.audit_event_id = audit_row.id
       and mutation_row.mutation_id = audit_row.mutation_id
     where audit_row.tenant_id = new.tenant_id
       and audit_row.id = new.audit_event_id;
  elsif tg_table_name in (
    'inbox_v2_tenant_stream_changes',
    'inbox_v2_domain_events',
    'inbox_v2_outbox_intents'
  ) then
    select * into v_mutation
      from public.inbox_v2_auth_mutation_commits mutation_row
     where mutation_row.tenant_id = new.tenant_id
       and mutation_row.mutation_id = new.mutation_id;
    -- The tenant stream is shared by every V2 domain writer. Only children of
    -- an authorization mutation use this authorization-specific seal.
    if not found then
      return null;
    end if;
  else
    select * into strict v_mutation
      from public.inbox_v2_auth_mutation_commits mutation_row
     where mutation_row.tenant_id = new.tenant_id
       and mutation_row.mutation_id = new.mutation_id;
  end if;

  select * into strict v_stream
    from public.inbox_v2_tenant_stream_commits stream_row
   where stream_row.tenant_id = v_mutation.tenant_id
     and stream_row.id = v_mutation.stream_commit_id
     and stream_row.mutation_id = v_mutation.mutation_id;
  select * into strict v_audit
    from public.inbox_v2_auth_audit_events audit_row
   where audit_row.tenant_id = v_mutation.tenant_id
     and audit_row.id = v_mutation.audit_event_id
     and audit_row.mutation_id = v_mutation.mutation_id;

  select count(*)::integer into v_change_count
    from public.inbox_v2_tenant_stream_changes change_row
   where change_row.tenant_id = v_mutation.tenant_id
     and change_row.stream_commit_id = v_mutation.stream_commit_id
     and change_row.mutation_id = v_mutation.mutation_id;
  select count(*)::integer into v_event_count
    from public.inbox_v2_domain_events event_row
   where event_row.tenant_id = v_mutation.tenant_id
     and event_row.stream_commit_id = v_mutation.stream_commit_id
     and event_row.mutation_id = v_mutation.mutation_id;
  select count(*)::integer,
         count(*) filter (
           where intent_row.effect_class = 'projection'
             and intent_row.type_id = 'core:projection.update'
         )::integer
    into v_outbox_count, v_projection_count
    from public.inbox_v2_outbox_intents intent_row
   where intent_row.tenant_id = v_mutation.tenant_id
     and intent_row.stream_commit_id = v_mutation.stream_commit_id
     and intent_row.mutation_id = v_mutation.mutation_id;
  select count(*)::integer into v_effect_count
    from public.inbox_v2_auth_revision_effects effect_row
   where effect_row.tenant_id = v_mutation.tenant_id
     and effect_row.mutation_id = v_mutation.mutation_id;
  select count(*)::integer into v_relation_count
    from public.inbox_v2_auth_relation_writes write_row
   where write_row.tenant_id = v_mutation.tenant_id
     and write_row.mutation_id = v_mutation.mutation_id;
  select count(*)::integer into v_facet_count
    from public.inbox_v2_auth_audit_facets facet_row
   where facet_row.tenant_id = v_mutation.tenant_id
     and facet_row.audit_event_id = v_mutation.audit_event_id;

  if row(v_change_count, v_event_count, v_outbox_count,
         v_projection_count, v_effect_count, v_relation_count,
         v_facet_count)
       is distinct from
     row(v_stream.change_count, v_stream.event_count,
         v_stream.outbox_intent_count, v_mutation.projection_intent_count,
         v_mutation.revision_effect_count,
         v_mutation.relation_write_count, v_audit.facet_count) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_mutation_sealed_manifest_changed';
  end if;
  return null;
exception
  when no_data_found or too_many_rows then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_mutation_parent_incomplete';
end;
$function$;

do $triggers$
declare
  v_table text;
  v_trigger text;
begin
  foreach v_table in array array[
    'inbox_v2_auth_role_versions',
    'inbox_v2_auth_role_version_permissions',
    'inbox_v2_auth_role_binding_versions',
    'inbox_v2_auth_direct_grant_versions',
    'inbox_v2_auth_workforce_membership_versions',
    'inbox_v2_auth_structural_access_versions',
    'inbox_v2_auth_collaborator_versions',
    'inbox_v2_tenant_stream_commits',
    'inbox_v2_tenant_stream_changes',
    'inbox_v2_domain_events',
    'inbox_v2_outbox_intents',
    'inbox_v2_auth_audit_events',
    'inbox_v2_auth_audit_facets',
    'inbox_v2_auth_mutation_commits',
    'inbox_v2_auth_revision_effects',
    'inbox_v2_auth_relation_writes'
  ]
  loop
    v_trigger := 'inbox_v2_auth_immutable_' || substr(md5(v_table), 1, 16);
    execute format(
      'create trigger %I before update or delete on public.%I for each row execute function public.inbox_v2_auth_reject_immutable()',
      v_trigger,
      v_table
    );
  end loop;
end;
$triggers$;

create trigger inbox_v2_auth_role_version_insert_guard
before insert on public.inbox_v2_auth_role_versions
for each row execute function public.inbox_v2_auth_relation_version_guard();

create trigger inbox_v2_auth_binding_version_insert_guard
before insert on public.inbox_v2_auth_role_binding_versions
for each row execute function public.inbox_v2_auth_relation_version_guard();

create trigger inbox_v2_auth_grant_version_insert_guard
before insert on public.inbox_v2_auth_direct_grant_versions
for each row execute function public.inbox_v2_auth_relation_version_guard();

create trigger inbox_v2_auth_workforce_version_insert_guard
before insert on public.inbox_v2_auth_workforce_membership_versions
for each row execute function public.inbox_v2_auth_relation_version_guard();

create trigger inbox_v2_auth_structural_version_insert_guard
before insert on public.inbox_v2_auth_structural_access_versions
for each row execute function public.inbox_v2_auth_relation_version_guard();

create trigger inbox_v2_auth_collaborator_version_insert_guard
before insert on public.inbox_v2_auth_collaborator_versions
for each row execute function public.inbox_v2_auth_relation_version_guard();

create constraint trigger inbox_v2_auth_role_version_commit_coherence
after insert on public.inbox_v2_auth_role_versions
deferrable initially deferred
for each row execute function public.inbox_v2_auth_relation_version_commit_coherence();

create constraint trigger inbox_v2_auth_binding_version_commit_coherence
after insert on public.inbox_v2_auth_role_binding_versions
deferrable initially deferred
for each row execute function public.inbox_v2_auth_relation_version_commit_coherence();

create constraint trigger inbox_v2_auth_grant_version_commit_coherence
after insert on public.inbox_v2_auth_direct_grant_versions
deferrable initially deferred
for each row execute function public.inbox_v2_auth_relation_version_commit_coherence();

create constraint trigger inbox_v2_auth_workforce_version_commit_coherence
after insert on public.inbox_v2_auth_workforce_membership_versions
deferrable initially deferred
for each row execute function public.inbox_v2_auth_relation_version_commit_coherence();

create constraint trigger inbox_v2_auth_structural_version_commit_coherence
after insert on public.inbox_v2_auth_structural_access_versions
deferrable initially deferred
for each row execute function public.inbox_v2_auth_relation_version_commit_coherence();

create constraint trigger inbox_v2_auth_collaborator_version_commit_coherence
after insert on public.inbox_v2_auth_collaborator_versions
deferrable initially deferred
for each row execute function public.inbox_v2_auth_relation_version_commit_coherence();

create trigger inbox_v2_auth_tenant_head_guard
before insert or update or delete on public.inbox_v2_auth_tenant_heads
for each row execute function public.inbox_v2_auth_head_guard();

create trigger inbox_v2_auth_employee_head_guard
before insert or update or delete on public.inbox_v2_auth_employee_heads
for each row execute function public.inbox_v2_auth_head_guard();

create trigger inbox_v2_auth_role_head_guard
before insert or update or delete on public.inbox_v2_auth_role_heads
for each row execute function public.inbox_v2_auth_head_guard();

create trigger inbox_v2_auth_binding_head_guard
before insert or update or delete on public.inbox_v2_auth_role_binding_heads
for each row execute function public.inbox_v2_auth_head_guard();

create trigger inbox_v2_auth_grant_head_guard
before insert or update or delete on public.inbox_v2_auth_direct_grant_heads
for each row execute function public.inbox_v2_auth_head_guard();

create trigger inbox_v2_auth_workforce_head_guard
before insert or update or delete on public.inbox_v2_auth_workforce_membership_heads
for each row execute function public.inbox_v2_auth_head_guard();

create trigger inbox_v2_auth_resource_head_guard
before insert or update or delete on public.inbox_v2_auth_resource_heads
for each row execute function public.inbox_v2_auth_head_guard();

create trigger inbox_v2_auth_structural_head_guard
before insert or update or delete on public.inbox_v2_auth_structural_access_heads
for each row execute function public.inbox_v2_auth_head_guard();

create trigger inbox_v2_auth_collaborator_head_guard
before insert or update or delete on public.inbox_v2_auth_collaborator_heads
for each row execute function public.inbox_v2_auth_head_guard();

create constraint trigger inbox_v2_auth_tenant_head_commit_coherence
after insert or update on public.inbox_v2_auth_tenant_heads
deferrable initially deferred
for each row execute function public.inbox_v2_auth_head_commit_coherence();

create constraint trigger inbox_v2_auth_employee_head_commit_coherence
after insert or update on public.inbox_v2_auth_employee_heads
deferrable initially deferred
for each row execute function public.inbox_v2_auth_head_commit_coherence();

create constraint trigger inbox_v2_auth_role_head_commit_coherence
after insert or update on public.inbox_v2_auth_role_heads
deferrable initially deferred
for each row execute function public.inbox_v2_auth_head_commit_coherence();

create constraint trigger inbox_v2_auth_binding_head_commit_coherence
after insert or update on public.inbox_v2_auth_role_binding_heads
deferrable initially deferred
for each row execute function public.inbox_v2_auth_head_commit_coherence();

create constraint trigger inbox_v2_auth_grant_head_commit_coherence
after insert or update on public.inbox_v2_auth_direct_grant_heads
deferrable initially deferred
for each row execute function public.inbox_v2_auth_head_commit_coherence();

create constraint trigger inbox_v2_auth_workforce_head_commit_coherence
after insert or update on public.inbox_v2_auth_workforce_membership_heads
deferrable initially deferred
for each row execute function public.inbox_v2_auth_head_commit_coherence();

create constraint trigger inbox_v2_auth_resource_head_commit_coherence
after insert or update on public.inbox_v2_auth_resource_heads
deferrable initially deferred
for each row execute function public.inbox_v2_auth_head_commit_coherence();

create constraint trigger inbox_v2_auth_structural_head_commit_coherence
after insert or update on public.inbox_v2_auth_structural_access_heads
deferrable initially deferred
for each row execute function public.inbox_v2_auth_head_commit_coherence();

create constraint trigger inbox_v2_auth_collaborator_head_commit_coherence
after insert or update on public.inbox_v2_auth_collaborator_heads
deferrable initially deferred
for each row execute function public.inbox_v2_auth_head_commit_coherence();

create trigger inbox_v2_auth_command_guard_trigger
before insert or update or delete on public.inbox_v2_auth_command_records
for each row execute function public.inbox_v2_auth_command_guard();

create constraint trigger inbox_v2_auth_command_commit_coherence
after insert or update on public.inbox_v2_auth_command_records
deferrable initially deferred
for each row execute function public.inbox_v2_auth_command_commit_coherence();

create trigger inbox_v2_auth_audit_identifier_guard_trigger
before insert on public.inbox_v2_auth_audit_events
for each row execute function public.inbox_v2_auth_audit_identifier_guard();

create trigger inbox_v2_tenant_stream_head_guard_trigger
before insert or update or delete on public.inbox_v2_tenant_stream_heads
for each row execute function public.inbox_v2_auth_stream_head_guard();

create constraint trigger inbox_v2_auth_role_version_permissions_coherence
after insert on public.inbox_v2_auth_role_versions
deferrable initially deferred
for each row execute function public.inbox_v2_auth_role_permission_coherence();

create constraint trigger inbox_v2_auth_role_permission_rows_coherence
after insert on public.inbox_v2_auth_role_version_permissions
deferrable initially deferred
for each row execute function public.inbox_v2_auth_role_permission_coherence();

create constraint trigger inbox_v2_auth_mutation_commit_coherence
after insert on public.inbox_v2_auth_mutation_commits
deferrable initially deferred
for each row execute function public.inbox_v2_auth_mutation_coherence();

create constraint trigger inbox_v2_auth_change_mutation_child_coherence
after insert on public.inbox_v2_tenant_stream_changes
deferrable initially deferred
for each row execute function public.inbox_v2_auth_mutation_child_coherence();

create constraint trigger inbox_v2_auth_event_mutation_child_coherence
after insert on public.inbox_v2_domain_events
deferrable initially deferred
for each row execute function public.inbox_v2_auth_mutation_child_coherence();

create constraint trigger inbox_v2_auth_outbox_mutation_child_coherence
after insert on public.inbox_v2_outbox_intents
deferrable initially deferred
for each row execute function public.inbox_v2_auth_mutation_child_coherence();

create constraint trigger inbox_v2_auth_facet_mutation_child_coherence
after insert on public.inbox_v2_auth_audit_facets
deferrable initially deferred
for each row execute function public.inbox_v2_auth_mutation_child_coherence();

create constraint trigger inbox_v2_auth_effect_mutation_child_coherence
after insert on public.inbox_v2_auth_revision_effects
deferrable initially deferred
for each row execute function public.inbox_v2_auth_mutation_child_coherence();

create constraint trigger inbox_v2_auth_relation_mutation_child_coherence
after insert on public.inbox_v2_auth_relation_writes
deferrable initially deferred
for each row execute function public.inbox_v2_auth_mutation_child_coherence();
`;
