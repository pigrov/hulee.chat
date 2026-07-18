import {
  createInboxV2CoreCatalogRegistrationSchema,
  createInboxV2ModuleCatalogRegistrationSchema,
  createInboxV2SchemaEnvelopeSchema,
  defineInboxV2CatalogRegistrations,
  INBOX_V2_CATALOG_REGISTRATION_SCHEMA_ID,
  INBOX_V2_INITIAL_SCHEMA_VERSION,
  inboxV2ClientIdSchema,
  inboxV2ConversationIdSchema,
  inboxV2OrgUnitIdSchema,
  inboxV2SourceAccountIdSchema,
  inboxV2TeamIdSchema,
  inboxV2TenantIdSchema,
  inboxV2WorkItemIdSchema,
  inboxV2WorkQueueIdSchema,
  inboxV2NamespacedIdSchema,
  type InboxV2ClientId,
  type InboxV2ConversationId,
  type InboxV2OrgUnitId,
  type InboxV2SourceAccountId,
  type InboxV2TeamId,
  type InboxV2TenantId,
  type InboxV2WorkItemId,
  type InboxV2WorkQueueId
} from "@hulee/contracts";
import { z } from "zod";

import {
  isPermission as isInboxV1Permission,
  isPermissionScope as isInboxV1PermissionScope,
  isPermissionScopeAllowed as isInboxV1PermissionScopeAllowed,
  type Permission as InboxV1Permission,
  type PermissionScope as InboxV1PermissionScope
} from "./permissions";

export const INBOX_V2_PERMISSION_SCOPE_CATALOG_SCHEMA_ID =
  "core:inbox-v2.permission-scope-catalog" as const;
export const INBOX_V2_PERMISSION_SCOPE_CATALOG_VERSION = "v1" as const;

export const inboxV2PermissionScopeTypes = Object.freeze([
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
] as const);

export type InboxV2PermissionScopeType =
  (typeof inboxV2PermissionScopeTypes)[number];
export type InboxV2PermissionPrincipalKind = "employee" | "trusted_service";
export type InboxV2OrgUnitScopeMode = "exact" | "subtree";

export const inboxV2PermissionGuardProfileIds = Object.freeze([
  "core:rbac.guard.canonical_resource",
  "core:rbac.guard.internal_membership",
  "core:rbac.guard.internal_break_glass_read",
  "core:rbac.guard.internal_break_glass_issue",
  "core:rbac.guard.notification_self",
  "core:rbac.guard.notification_target_read",
  "core:rbac.guard.external_route",
  "core:rbac.guard.work_item_state",
  "core:rbac.guard.source_account_route",
  "core:rbac.guard.file_parent_content",
  "core:rbac.guard.client_context",
  "core:rbac.guard.identity_evidence",
  "core:rbac.guard.report_resource_conjunction",
  "core:rbac.guard.audit_facets",
  "core:rbac.guard.privacy_policy_revision",
  "core:rbac.guard.privacy_request_roots_revision",
  "core:rbac.guard.privacy_subject_evidence_roots",
  "core:rbac.guard.privacy_hold_manifest_revision",
  "core:rbac.guard.privacy_tenant_export_high_water",
  "core:rbac.guard.privacy_deletion_plan_revisions",
  "core:rbac.guard.privacy_audit_facets"
] as const);

export type InboxV2PermissionGuardProfileId =
  (typeof inboxV2PermissionGuardProfileIds)[number];

function fenceIds<const TFences extends readonly `core:${string}`[]>(
  ...values: TFences
): Readonly<TFences> {
  return Object.freeze(values);
}

const inboxV2PermissionGuardProfileDefinitions = [
  {
    id: "core:rbac.guard.canonical_resource",
    requiredFenceIds: fenceIds(
      "core:rbac.fence.active_principal",
      "core:rbac.fence.tenant_boundary",
      "core:rbac.fence.canonical_action_resources"
    )
  },
  {
    id: "core:rbac.guard.internal_membership",
    requiredFenceIds: fenceIds(
      "core:rbac.fence.tenant_boundary",
      "core:rbac.fence.canonical_internal_membership",
      "core:rbac.fence.internal_content_hard_boundary"
    )
  },
  {
    id: "core:rbac.guard.internal_break_glass_read",
    requiredFenceIds: fenceIds(
      "core:rbac.fence.exact_conversation",
      "core:rbac.fence.direct_grant_ttl_reason_audit",
      "core:rbac.fence.read_only_no_send"
    )
  },
  {
    id: "core:rbac.guard.internal_break_glass_issue",
    requiredFenceIds: fenceIds(
      "core:rbac.fence.exact_conversation",
      "core:rbac.fence.separate_approver_target",
      "core:rbac.fence.ttl_reason_alarm_audit"
    )
  },
  {
    id: "core:rbac.guard.notification_self",
    requiredFenceIds: fenceIds(
      "core:rbac.fence.actor_self",
      "core:rbac.fence.target_read_authority"
    )
  },
  {
    id: "core:rbac.guard.notification_target_read",
    requiredFenceIds: fenceIds(
      "core:rbac.fence.same_tenant_active_target",
      "core:rbac.fence.target_independent_read_authority"
    )
  },
  {
    id: "core:rbac.guard.external_route",
    requiredFenceIds: fenceIds(
      "core:rbac.fence.canonical_conversation_work_state",
      "core:rbac.fence.exact_source_binding_route",
      "core:rbac.fence.provider_capability"
    )
  },
  {
    id: "core:rbac.guard.work_item_state",
    requiredFenceIds: fenceIds(
      "core:rbac.fence.exact_work_item",
      "core:rbac.fence.canonical_work_relations",
      "core:rbac.fence.expected_state_revision"
    )
  },
  {
    id: "core:rbac.guard.source_account_route",
    requiredFenceIds: fenceIds(
      "core:rbac.fence.exact_source_account",
      "core:rbac.fence.binding_generation_route",
      "core:rbac.fence.provider_capability"
    )
  },
  {
    id: "core:rbac.guard.file_parent_content",
    requiredFenceIds: fenceIds(
      "core:rbac.fence.parent_content_authority",
      "core:rbac.fence.file_retention_hold_policy"
    )
  },
  {
    id: "core:rbac.guard.client_context",
    requiredFenceIds: fenceIds(
      "core:rbac.fence.exact_client_or_context_path",
      "core:rbac.fence.no_client_conversation_propagation"
    )
  },
  {
    id: "core:rbac.guard.identity_evidence",
    requiredFenceIds: fenceIds(
      "core:rbac.fence.identity_targets_independently_authorized",
      "core:rbac.fence.provider_evidence_never_authority"
    )
  },
  {
    id: "core:rbac.guard.report_resource_conjunction",
    requiredFenceIds: fenceIds(
      "core:rbac.fence.scope_before_count_pagination",
      "core:rbac.fence.current_underlying_resource_authority"
    )
  },
  {
    id: "core:rbac.guard.audit_facets",
    requiredFenceIds: fenceIds(
      "core:rbac.fence.target_facets_before_count_pagination",
      "core:rbac.fence.audit_no_implicit_pii"
    )
  },
  {
    id: "core:rbac.guard.privacy_policy_revision",
    requiredFenceIds: fenceIds(
      "core:rbac.fence.exact_governance_context_revision",
      "core:rbac.fence.policy_preview_expected_revision_approval",
      "core:rbac.fence.no_content_authority"
    )
  },
  {
    id: "core:rbac.guard.privacy_request_roots_revision",
    requiredFenceIds: fenceIds(
      "core:rbac.fence.exact_verified_case_roots_revision",
      "core:rbac.fence.request_decide_execute_separation",
      "core:rbac.fence.requester_not_resource_authority"
    )
  },
  {
    id: "core:rbac.guard.privacy_subject_evidence_roots",
    requiredFenceIds: fenceIds(
      "core:rbac.fence.exact_case_subject_evidence_roots",
      "core:rbac.fence.third_party_masking_evidence_purpose"
    )
  },
  {
    id: "core:rbac.guard.privacy_hold_manifest_revision",
    requiredFenceIds: fenceIds(
      "core:rbac.fence.authentic_frozen_hold_manifest_revision",
      "core:rbac.fence.hold_issue_release_separation",
      "core:rbac.fence.hold_no_read_export_authority"
    )
  },
  {
    id: "core:rbac.guard.privacy_tenant_export_high_water",
    requiredFenceIds: fenceIds(
      "core:rbac.fence.current_tenant_graph_pinned_high_water",
      "core:rbac.fence.two_person_approval",
      "core:rbac.fence.secrets_excluded"
    )
  },
  {
    id: "core:rbac.guard.privacy_deletion_plan_revisions",
    requiredFenceIds: fenceIds(
      "core:rbac.fence.exact_deletion_plan_roots_handlers_revisions",
      "core:rbac.fence.preview_approve_execute_separation",
      "core:rbac.fence.cooling_period_recheck"
    )
  },
  {
    id: "core:rbac.guard.privacy_audit_facets",
    requiredFenceIds: fenceIds(
      "core:rbac.fence.privacy_actor_target_scope_facets",
      "core:rbac.fence.privacy_audit_no_implicit_pii",
      "core:rbac.fence.audit_access_is_audited"
    )
  }
] as const satisfies readonly Readonly<{
  id: InboxV2PermissionGuardProfileId;
  requiredFenceIds: readonly `core:${string}`[];
}>[];

export const inboxV2PermissionGuardProfiles = Object.freeze(
  inboxV2PermissionGuardProfileDefinitions.map((profile) =>
    Object.freeze({
      ...profile,
      requiredFenceIds: Object.freeze([...profile.requiredFenceIds])
    })
  )
);

type InboxV2ExactReferenceScopeType =
  | "team"
  | "queue"
  | "client"
  | "conversation"
  | "work_item"
  | "source_account";
type InboxV2RelationScopeType =
  | "responsible"
  | "collaborator"
  | "internal_participant"
  | "client_owner";

export type InboxV2PermissionScope =
  | Readonly<{ type: "tenant"; tenantId: InboxV2TenantId }>
  | Readonly<{
      type: "org_unit";
      tenantId: InboxV2TenantId;
      id: InboxV2OrgUnitId;
      mode: InboxV2OrgUnitScopeMode;
    }>
  | Readonly<{
      type: "team";
      tenantId: InboxV2TenantId;
      id: InboxV2TeamId;
    }>
  | Readonly<{
      type: "queue";
      tenantId: InboxV2TenantId;
      id: InboxV2WorkQueueId;
    }>
  | Readonly<{
      type: "client";
      tenantId: InboxV2TenantId;
      id: InboxV2ClientId;
    }>
  | Readonly<{
      type: "conversation";
      tenantId: InboxV2TenantId;
      id: InboxV2ConversationId;
    }>
  | Readonly<{
      type: "work_item";
      tenantId: InboxV2TenantId;
      id: InboxV2WorkItemId;
    }>
  | Readonly<{
      type: "source_account";
      tenantId: InboxV2TenantId;
      id: InboxV2SourceAccountId;
    }>
  | Readonly<{
      type: InboxV2RelationScopeType;
      tenantId: InboxV2TenantId;
    }>;

export type InboxV2PermissionScopeDefinition = Readonly<{
  type: InboxV2PermissionScopeType;
  family: "structural" | "exact_resource" | "relation";
  referenceKind:
    | "org_unit"
    | "team"
    | "queue"
    | "client"
    | "conversation"
    | "work_item"
    | "source_account"
    | null;
  orgUnitModes: readonly InboxV2OrgUnitScopeMode[];
}>;

function scopeDefinition(
  definition: InboxV2PermissionScopeDefinition
): InboxV2PermissionScopeDefinition {
  return Object.freeze({
    ...definition,
    orgUnitModes: Object.freeze([...definition.orgUnitModes])
  });
}

export const inboxV2ScopeCatalog = Object.freeze([
  scopeDefinition({
    type: "tenant",
    family: "structural",
    referenceKind: null,
    orgUnitModes: []
  }),
  scopeDefinition({
    type: "org_unit",
    family: "structural",
    referenceKind: "org_unit",
    orgUnitModes: ["exact", "subtree"]
  }),
  scopeDefinition({
    type: "team",
    family: "structural",
    referenceKind: "team",
    orgUnitModes: []
  }),
  scopeDefinition({
    type: "queue",
    family: "structural",
    referenceKind: "queue",
    orgUnitModes: []
  }),
  scopeDefinition({
    type: "client",
    family: "exact_resource",
    referenceKind: "client",
    orgUnitModes: []
  }),
  scopeDefinition({
    type: "conversation",
    family: "exact_resource",
    referenceKind: "conversation",
    orgUnitModes: []
  }),
  scopeDefinition({
    type: "work_item",
    family: "exact_resource",
    referenceKind: "work_item",
    orgUnitModes: []
  }),
  scopeDefinition({
    type: "source_account",
    family: "exact_resource",
    referenceKind: "source_account",
    orgUnitModes: []
  }),
  scopeDefinition({
    type: "responsible",
    family: "relation",
    referenceKind: null,
    orgUnitModes: []
  }),
  scopeDefinition({
    type: "collaborator",
    family: "relation",
    referenceKind: null,
    orgUnitModes: []
  }),
  scopeDefinition({
    type: "internal_participant",
    family: "relation",
    referenceKind: null,
    orgUnitModes: []
  }),
  scopeDefinition({
    type: "client_owner",
    family: "relation",
    referenceKind: null,
    orgUnitModes: []
  })
] as const);

const WORKFORCE_OR_SERVICE = Object.freeze([
  "employee",
  "trusted_service"
] as const);
const TRUSTED_SERVICE = Object.freeze(["trusted_service"] as const);

function scopes<const TScopes extends readonly InboxV2PermissionScopeType[]>(
  ...values: TScopes
): Readonly<TScopes> {
  if (new Set(values).size !== values.length) {
    throw new Error("Inbox V2 permission contains duplicate scope types.");
  }

  return Object.freeze(values);
}

const T = scopes("tenant");
const TO = scopes("tenant", "org_unit");
const TOT = scopes("tenant", "org_unit", "team");
const TQ = scopes("tenant", "org_unit", "queue");
const STRUCTURAL = scopes("tenant", "org_unit", "team", "queue");
const INTERNAL = scopes("internal_participant");
const EXTERNAL_READ = scopes(
  "tenant",
  "org_unit",
  "team",
  "queue",
  "responsible",
  "collaborator",
  "conversation"
);
const EXTERNAL_WORK = scopes(
  "tenant",
  "org_unit",
  "team",
  "queue",
  "responsible",
  "collaborator",
  "conversation",
  "work_item"
);
const WORK_STRUCTURAL = scopes(
  "tenant",
  "org_unit",
  "team",
  "queue",
  "work_item"
);
const CLIENT_ACCESS = scopes(
  "tenant",
  "org_unit",
  "team",
  "queue",
  "responsible",
  "client_owner",
  "client"
);

export type InboxV2PermissionDefinition<TId extends string = string> =
  Readonly<{
    id: TId;
    allowedScopes: readonly InboxV2PermissionScopeType[];
    allowedPrincipalKinds: readonly InboxV2PermissionPrincipalKind[];
    guardProfileId: InboxV2PermissionGuardProfileId;
  }>;

function permission<
  const TId extends `core:${string}`,
  const TScopes extends readonly InboxV2PermissionScopeType[]
>(
  id: TId,
  allowedScopes: TScopes,
  allowedPrincipalKinds:
    | typeof WORKFORCE_OR_SERVICE
    | typeof TRUSTED_SERVICE = WORKFORCE_OR_SERVICE
): InboxV2PermissionDefinition<TId> & {
  readonly allowedScopes: Readonly<TScopes>;
} {
  if (!/^core:[a-z][a-z0-9_]*(?:[.-][a-z0-9_]+)*$/.test(id)) {
    throw new Error(`Invalid Inbox V2 core permission ID: ${id}.`);
  }

  if (allowedScopes.length === 0) {
    throw new Error(`Inbox V2 permission ${id} must allow at least one scope.`);
  }

  return Object.freeze({
    id,
    allowedScopes,
    allowedPrincipalKinds,
    guardProfileId: guardProfileForPermission(id)
  });
}

export const inboxV2PermissionCatalog = Object.freeze([
  permission("core:tenant.manage", T),
  permission("core:employee.directory.view", TOT),
  permission("core:employee.invite", TO),
  permission("core:employee.profile.manage", TOT),
  permission("core:employee.deactivate", T),
  permission("core:roles.define", T),
  permission("core:roles.bind", STRUCTURAL),
  permission("core:direct_grants.manage", STRUCTURAL),
  permission("core:org_unit.manage", TO),
  permission("core:team.manage", TOT),
  permission("core:queue.manage", TQ),

  permission(
    "core:inbox.read",
    scopes(
      "tenant",
      "org_unit",
      "team",
      "queue",
      "responsible",
      "collaborator",
      "internal_participant",
      "conversation"
    )
  ),
  permission("core:conversation.read", EXTERNAL_READ),
  permission("core:conversation.internal.read", INTERNAL),
  permission("core:conversation.internal.create", TOT),
  permission("core:conversation.internal.members.manage", INTERNAL),
  permission(
    "core:conversation.internal.owner_recover",
    scopes("conversation")
  ),
  permission(
    "core:conversation.internal.break_glass_read",
    scopes("conversation")
  ),
  permission(
    "core:conversation.internal.break_glass.issue",
    scopes("tenant", "conversation")
  ),
  permission(
    "core:conversation.access_binding.manage",
    scopes("tenant", "org_unit", "team", "conversation")
  ),
  permission(
    "core:conversation.access_binding.apply_policy",
    scopes("tenant", "org_unit", "team", "conversation"),
    TRUSTED_SERVICE
  ),
  permission(
    "core:conversation.timeline_append_system",
    scopes("tenant", "org_unit", "team", "queue", "conversation"),
    TRUSTED_SERVICE
  ),
  permission(
    "core:conversation.collaborators.manage",
    scopes(
      "tenant",
      "org_unit",
      "team",
      "queue",
      "responsible",
      "conversation",
      "work_item"
    )
  ),
  permission(
    "core:notification.watch.self",
    scopes(
      "tenant",
      "org_unit",
      "team",
      "queue",
      "responsible",
      "collaborator",
      "internal_participant",
      "conversation",
      "work_item"
    )
  ),
  permission(
    "core:notification.watchers.manage",
    scopes(
      "tenant",
      "org_unit",
      "team",
      "queue",
      "responsible",
      "conversation",
      "work_item"
    )
  ),
  permission("core:notification.preferences.manage_self", T),
  permission("core:notification.endpoints.manage_self", T),

  permission("core:message.reply_external", EXTERNAL_WORK),
  permission("core:message.send_internal", INTERNAL),
  permission("core:message.staff_note.read", EXTERNAL_WORK),
  permission("core:message.staff_note.create", EXTERNAL_WORK),
  permission(
    "core:message.edit_own",
    scopes(
      "responsible",
      "collaborator",
      "internal_participant",
      "conversation"
    )
  ),
  permission(
    "core:message.delete_own",
    scopes(
      "responsible",
      "collaborator",
      "internal_participant",
      "conversation"
    )
  ),
  permission(
    "core:message.react",
    scopes(
      "responsible",
      "collaborator",
      "internal_participant",
      "conversation"
    )
  ),
  permission(
    "core:message.moderate_external",
    scopes("tenant", "org_unit", "team", "queue", "conversation")
  ),
  permission("core:message.moderate_internal", INTERNAL),
  permission("core:message.forward_external", EXTERNAL_WORK),

  permission(
    "core:work.read",
    scopes(
      "tenant",
      "org_unit",
      "team",
      "queue",
      "responsible",
      "collaborator",
      "work_item",
      "conversation"
    )
  ),
  permission("core:work.claim", WORK_STRUCTURAL),
  permission("core:work.assign", WORK_STRUCTURAL),
  permission("core:work.servicing_team.manage", WORK_STRUCTURAL),
  permission("core:work.release_self", scopes("responsible")),
  permission("core:work.release_other", WORK_STRUCTURAL),
  permission(
    "core:work.transfer",
    scopes("tenant", "org_unit", "team", "queue", "responsible", "work_item")
  ),
  permission(
    "core:work.close",
    scopes("tenant", "org_unit", "team", "queue", "responsible", "work_item")
  ),
  permission("core:work.reopen", WORK_STRUCTURAL),
  permission("core:work.override", WORK_STRUCTURAL),

  permission(
    "core:source_account.view",
    scopes("tenant", "org_unit", "source_account")
  ),
  permission(
    "core:source_account.diagnostics.view",
    scopes("tenant", "org_unit", "source_account")
  ),
  permission(
    "core:source_account.use",
    scopes("tenant", "org_unit", "source_account")
  ),
  permission(
    "core:source.route_policy.manage",
    scopes("tenant", "org_unit", "source_account")
  ),
  permission(
    "core:source.dispatch.reroute",
    scopes("tenant", "org_unit", "source_account")
  ),
  permission("core:source.multi_send", TO),
  permission("core:source_item.reply", EXTERNAL_WORK),
  permission("core:source_item.open_external", EXTERNAL_READ),
  permission(
    "core:call.initiate",
    scopes(
      "tenant",
      "org_unit",
      "team",
      "queue",
      "responsible",
      "client",
      "conversation"
    )
  ),
  permission(
    "core:call.recording.view",
    scopes(
      "tenant",
      "org_unit",
      "team",
      "queue",
      "responsible",
      "client",
      "conversation"
    )
  ),
  permission(
    "core:call.transcript.view",
    scopes(
      "tenant",
      "org_unit",
      "team",
      "queue",
      "responsible",
      "client",
      "conversation"
    )
  ),

  permission(
    "core:file.view",
    scopes(
      "tenant",
      "org_unit",
      "team",
      "queue",
      "responsible",
      "collaborator",
      "internal_participant",
      "client",
      "conversation",
      "work_item"
    )
  ),
  permission(
    "core:file.upload",
    scopes(
      "tenant",
      "org_unit",
      "team",
      "queue",
      "responsible",
      "collaborator",
      "internal_participant",
      "client",
      "conversation",
      "work_item"
    )
  ),
  permission(
    "core:file.delete",
    scopes(
      "tenant",
      "org_unit",
      "team",
      "queue",
      "responsible",
      "collaborator",
      "internal_participant",
      "client",
      "conversation",
      "work_item"
    )
  ),
  permission("core:participant.pii.view", EXTERNAL_READ),

  permission("core:client.view", CLIENT_ACCESS),
  permission("core:client.contacts.view", CLIENT_ACCESS),
  permission("core:client.edit", CLIENT_ACCESS),
  permission("core:client.pipeline.transition", CLIENT_ACCESS),
  permission("core:client.fields.view_sensitive", CLIENT_ACCESS),
  permission("core:client.fields.edit", CLIENT_ACCESS),
  permission(
    "core:client.owner.assign",
    scopes("tenant", "org_unit", "team", "client")
  ),
  permission(
    "core:client.access_binding.manage",
    scopes("tenant", "org_unit", "team", "client")
  ),
  permission(
    "core:conversation.clients.manage",
    scopes("tenant", "org_unit", "team", "queue", "responsible", "conversation")
  ),
  permission(
    "core:client.link.manage",
    scopes("tenant", "org_unit", "team", "client_owner", "client")
  ),

  permission("core:identity.employee_claim.manage", TOT),
  permission(
    "core:identity.client_contact_claim.manage",
    scopes("tenant", "org_unit", "team", "queue", "client")
  ),
  permission(
    "core:identity.source_identity.use",
    scopes("tenant", "org_unit", "source_account", "conversation")
  ),
  permission(
    "core:identity.evidence.view",
    scopes("tenant", "org_unit", "source_account", "conversation")
  ),
  permission(
    "core:identity.auto_resolve",
    scopes("tenant", "org_unit", "source_account"),
    TRUSTED_SERVICE
  ),
  permission(
    "core:identity.claim.revoke",
    scopes("tenant", "org_unit", "team", "queue", "client")
  ),
  permission("core:identity.merge", TO),
  permission("core:identity.observation.review", STRUCTURAL),

  permission("core:reports.view", STRUCTURAL),
  permission("core:reports.workforce_dimension.view", STRUCTURAL),
  permission("core:reports.drilldown", STRUCTURAL),
  permission("core:reports.export", STRUCTURAL),
  permission("core:reports.pii.view", STRUCTURAL),
  permission("core:reports.pii.export", STRUCTURAL),
  permission("core:audit.view", STRUCTURAL),

  permission("core:privacy.policy.view", T),
  permission("core:privacy.policy.manage", T),
  permission("core:privacy.request.view", T),
  permission("core:privacy.request.decide", T),
  permission("core:privacy.request.execute", T),
  permission("core:privacy.subject_evidence.view", T),
  permission("core:privacy.hold.view", T),
  permission("core:privacy.hold.issue", T),
  permission("core:privacy.hold.release", T),
  permission("core:privacy.tenant_export", T),
  permission("core:privacy.deletion.preview", T),
  permission("core:privacy.deletion.approve", T),
  permission("core:privacy.deletion.execute", T),
  permission("core:audit.privacy.view", STRUCTURAL),
  permission("core:audit.privacy.export", STRUCTURAL)
] as const);

export type InboxV2PermissionId =
  (typeof inboxV2PermissionCatalog)[number]["id"];
export type InboxV2PermissionCatalogEntry =
  (typeof inboxV2PermissionCatalog)[number];

const permissionById = new Map<
  InboxV2PermissionId,
  InboxV2PermissionCatalogEntry
>(inboxV2PermissionCatalog.map((entry) => [entry.id, entry]));

export function isInboxV2PermissionId(
  value: string
): value is InboxV2PermissionId {
  return permissionById.has(value as InboxV2PermissionId);
}

export function getInboxV2PermissionDefinition(
  permissionId: string
): InboxV2PermissionCatalogEntry | undefined {
  return permissionById.get(permissionId as InboxV2PermissionId);
}

export function parseInboxV2PermissionScope(
  value: unknown
): InboxV2PermissionScope | undefined {
  if (!isRecord(value) || typeof value.type !== "string") {
    return undefined;
  }

  const tenantId = inboxV2TenantIdSchema.safeParse(value.tenantId);
  if (!tenantId.success) {
    return undefined;
  }

  if (value.type === "tenant" || isRelationScopeType(value.type)) {
    return hasExactKeys(value, ["type", "tenantId"])
      ? Object.freeze({ type: value.type, tenantId: tenantId.data })
      : undefined;
  }

  if (value.type === "org_unit") {
    if (
      !hasExactKeys(value, ["type", "tenantId", "id", "mode"]) ||
      (value.mode !== "exact" && value.mode !== "subtree")
    ) {
      return undefined;
    }

    const id = inboxV2OrgUnitIdSchema.safeParse(value.id);
    return id.success
      ? Object.freeze({
          type: "org_unit",
          tenantId: tenantId.data,
          id: id.data,
          mode: value.mode
        })
      : undefined;
  }

  if (!isExactReferenceScopeType(value.type)) {
    return undefined;
  }

  if (!hasExactKeys(value, ["type", "tenantId", "id"])) {
    return undefined;
  }

  const id = exactReferenceIdParserByScopeType[value.type].safeParse(value.id);
  return id.success
    ? createExactReferenceScope(value.type, tenantId.data, id.data)
    : undefined;
}

export function isInboxV2PermissionScope(
  value: unknown
): value is InboxV2PermissionScope {
  return parseInboxV2PermissionScope(value) !== undefined;
}

export type InboxV2PermissionScopePairLegality =
  | Readonly<{
      kind: "legal";
      permission: InboxV2PermissionCatalogEntry;
      scope: InboxV2PermissionScope;
    }>
  | Readonly<{
      kind: "rejected";
      reason:
        | "unknown_permission"
        | "invalid_scope"
        | "illegal_scope"
        | "illegal_principal";
    }>;

/**
 * Validates only the immutable catalog-level permission/scope/principal shape.
 * It is not an authorization decision and must never replace INB2-RBAC-002,
 * which also validates current tenant, grants, relations, revisions and state.
 */
export function evaluateInboxV2PermissionScopePairLegality(input: {
  permissionId: string;
  scope: unknown;
  principalKind: string;
}): InboxV2PermissionScopePairLegality {
  const permission = getInboxV2PermissionDefinition(input.permissionId);
  if (permission === undefined) {
    return Object.freeze({ kind: "rejected", reason: "unknown_permission" });
  }

  if (
    !permission.allowedPrincipalKinds.includes(
      input.principalKind as InboxV2PermissionPrincipalKind
    )
  ) {
    return Object.freeze({ kind: "rejected", reason: "illegal_principal" });
  }

  const scope = parseInboxV2PermissionScope(input.scope);
  if (scope === undefined) {
    return Object.freeze({ kind: "rejected", reason: "invalid_scope" });
  }

  if (!permission.allowedScopes.includes(scope.type)) {
    return Object.freeze({ kind: "rejected", reason: "illegal_scope" });
  }

  return Object.freeze({ kind: "legal", permission, scope });
}

/** Catalog legality only; this boolean is never enforcement authority. */
export function isInboxV2PermissionScopePairLegal(input: {
  permissionId: string;
  scope: unknown;
  principalKind: string;
}): boolean {
  return evaluateInboxV2PermissionScopePairLegality(input).kind === "legal";
}

export type InboxV1PermissionMappingDisposition =
  | "automatic_if_scope_legal"
  | "review_required"
  | "compatibility_only";

export type InboxV1PermissionMappingDefinition = Readonly<{
  v1PermissionId: InboxV1Permission;
  disposition: InboxV1PermissionMappingDisposition;
  candidatePermissionIds: readonly InboxV2PermissionId[];
  semanticRestriction:
    | "same_or_narrower"
    | "aggregate_only"
    | "external_reply_only"
    | "action_split"
    | "outside_inbox_v2";
}>;

function v1Mapping(
  v1PermissionId: InboxV1Permission,
  disposition: InboxV1PermissionMappingDisposition,
  candidatePermissionIds: readonly InboxV2PermissionId[],
  semanticRestriction: InboxV1PermissionMappingDefinition["semanticRestriction"]
): InboxV1PermissionMappingDefinition {
  return Object.freeze({
    v1PermissionId,
    disposition,
    candidatePermissionIds: Object.freeze([...candidatePermissionIds]),
    semanticRestriction
  });
}

const v1MappingByPermission = {
  "tenant.manage": v1Mapping(
    "tenant.manage",
    "automatic_if_scope_legal",
    ["core:tenant.manage"],
    "same_or_narrower"
  ),
  "employees.manage": v1Mapping(
    "employees.manage",
    "review_required",
    [
      "core:employee.directory.view",
      "core:employee.invite",
      "core:employee.profile.manage",
      "core:employee.deactivate",
      "core:org_unit.manage",
      "core:team.manage",
      "core:queue.manage"
    ],
    "action_split"
  ),
  "roles.manage": v1Mapping(
    "roles.manage",
    "review_required",
    ["core:roles.define", "core:roles.bind", "core:direct_grants.manage"],
    "action_split"
  ),
  "modules.manage": v1Mapping(
    "modules.manage",
    "compatibility_only",
    [],
    "outside_inbox_v2"
  ),
  "integrations.manage": v1Mapping(
    "integrations.manage",
    "compatibility_only",
    [],
    "outside_inbox_v2"
  ),
  "branding.manage": v1Mapping(
    "branding.manage",
    "compatibility_only",
    [],
    "outside_inbox_v2"
  ),
  "inbox.read": v1Mapping(
    "inbox.read",
    "automatic_if_scope_legal",
    ["core:inbox.read"],
    "same_or_narrower"
  ),
  "message.reply": v1Mapping(
    "message.reply",
    "review_required",
    ["core:message.reply_external"],
    "external_reply_only"
  ),
  "client.view": v1Mapping(
    "client.view",
    "automatic_if_scope_legal",
    ["core:client.view"],
    "same_or_narrower"
  ),
  "client.edit": v1Mapping(
    "client.edit",
    "automatic_if_scope_legal",
    ["core:client.edit"],
    "same_or_narrower"
  ),
  "client.contacts.view": v1Mapping(
    "client.contacts.view",
    "automatic_if_scope_legal",
    ["core:client.contacts.view"],
    "same_or_narrower"
  ),
  "client.contacts.edit": v1Mapping(
    "client.contacts.edit",
    "review_required",
    ["core:client.edit", "core:client.fields.edit"],
    "action_split"
  ),
  "conversation.read": v1Mapping(
    "conversation.read",
    "automatic_if_scope_legal",
    ["core:conversation.read"],
    "same_or_narrower"
  ),
  "conversation.assign": v1Mapping(
    "conversation.assign",
    "review_required",
    [
      "core:work.claim",
      "core:work.assign",
      "core:work.servicing_team.manage",
      "core:work.release_self",
      "core:work.release_other",
      "core:work.transfer"
    ],
    "action_split"
  ),
  "conversation.close": v1Mapping(
    "conversation.close",
    "review_required",
    ["core:work.close"],
    "action_split"
  ),
  "conversation.reopen": v1Mapping(
    "conversation.reopen",
    "review_required",
    ["core:work.reopen"],
    "action_split"
  ),
  "lead.classify": v1Mapping(
    "lead.classify",
    "review_required",
    ["core:client.pipeline.transition"],
    "action_split"
  ),
  "lead.qualify": v1Mapping(
    "lead.qualify",
    "review_required",
    ["core:client.pipeline.transition"],
    "action_split"
  ),
  "lead.assign": v1Mapping(
    "lead.assign",
    "review_required",
    ["core:work.assign", "core:client.owner.assign"],
    "action_split"
  ),
  "files.view": v1Mapping(
    "files.view",
    "automatic_if_scope_legal",
    ["core:file.view"],
    "same_or_narrower"
  ),
  "files.upload": v1Mapping(
    "files.upload",
    "automatic_if_scope_legal",
    ["core:file.upload"],
    "same_or_narrower"
  ),
  "reports.view": v1Mapping(
    "reports.view",
    "automatic_if_scope_legal",
    ["core:reports.view"],
    "aggregate_only"
  ),
  "audit.view": v1Mapping(
    "audit.view",
    "automatic_if_scope_legal",
    ["core:audit.view"],
    "same_or_narrower"
  ),
  "api_keys.manage": v1Mapping(
    "api_keys.manage",
    "compatibility_only",
    [],
    "outside_inbox_v2"
  ),
  "webhooks.manage": v1Mapping(
    "webhooks.manage",
    "compatibility_only",
    [],
    "outside_inbox_v2"
  )
} as const satisfies Record<
  InboxV1Permission,
  InboxV1PermissionMappingDefinition
>;

export const inboxV1ToV2PermissionMappings = Object.freeze(
  Object.values(v1MappingByPermission)
);

export type InboxV1PermissionScopeMigrationResult =
  | Readonly<{
      kind: "mapped";
      grants: readonly Readonly<{
        permissionId: InboxV2PermissionId;
        scope: InboxV2PermissionScope;
      }>[];
      semanticRestriction: InboxV1PermissionMappingDefinition["semanticRestriction"];
    }>
  | Readonly<{
      kind: "review_required";
      reason:
        | "legacy_relation_scope_ambiguous"
        | "legacy_client_scope_does_not_propagate"
        | "permission_action_split"
        | "scope_pair_not_legal"
        | "scope_target_requires_v2_id_mapping";
      candidatePermissionIds: readonly InboxV2PermissionId[];
    }>
  | Readonly<{
      kind: "compatibility_only";
      reason: "outside_inbox_v2";
    }>
  | Readonly<{
      kind: "invalid";
      reason:
        | "unknown_v1_permission"
        | "invalid_v1_scope"
        | "illegal_v1_permission_scope_pair"
        | "invalid_tenant";
    }>;

export function migrateInboxV1PermissionScopeToV2(input: {
  tenantId: string;
  permissionId: string;
  scope: unknown;
}): InboxV1PermissionScopeMigrationResult {
  const tenantId = inboxV2TenantIdSchema.safeParse(input.tenantId);
  if (!tenantId.success) {
    return Object.freeze({ kind: "invalid", reason: "invalid_tenant" });
  }

  if (!isInboxV1Permission(input.permissionId)) {
    return Object.freeze({
      kind: "invalid",
      reason: "unknown_v1_permission"
    });
  }

  if (!isInboxV1PermissionScope(input.scope)) {
    return Object.freeze({ kind: "invalid", reason: "invalid_v1_scope" });
  }

  const mapping = v1MappingByPermission[input.permissionId];
  if (input.scope.type === "assigned" || input.scope.type === "own") {
    return reviewRequired(
      "legacy_relation_scope_ambiguous",
      mapping.candidatePermissionIds
    );
  }

  if (!isInboxV1PermissionScopeAllowed(input.permissionId, input.scope.type)) {
    return Object.freeze({
      kind: "invalid",
      reason: "illegal_v1_permission_scope_pair"
    });
  }

  if (mapping.disposition === "compatibility_only") {
    return Object.freeze({
      kind: "compatibility_only",
      reason: "outside_inbox_v2"
    });
  }

  if (
    input.scope.type === "client" &&
    mapping.candidatePermissionIds.some(
      (permissionId) =>
        permissionId === "core:inbox.read" ||
        permissionId === "core:conversation.read" ||
        permissionId === "core:message.reply_external"
    )
  ) {
    return reviewRequired(
      "legacy_client_scope_does_not_propagate",
      mapping.candidatePermissionIds
    );
  }

  const scope = translateInboxV1Scope(tenantId.data, input.scope);
  if (scope === undefined) {
    return reviewRequired(
      "scope_target_requires_v2_id_mapping",
      mapping.candidatePermissionIds
    );
  }
  const legalCandidateIds = mapping.candidatePermissionIds.filter(
    (permissionId) =>
      isInboxV2PermissionScopePairLegal({
        permissionId,
        scope,
        principalKind: "employee"
      })
  );

  if (mapping.disposition === "review_required") {
    return reviewRequired(
      "permission_action_split",
      legalCandidateIds.length > 0
        ? legalCandidateIds
        : mapping.candidatePermissionIds
    );
  }

  if (legalCandidateIds.length !== mapping.candidatePermissionIds.length) {
    return reviewRequired("scope_pair_not_legal", legalCandidateIds);
  }

  return Object.freeze({
    kind: "mapped",
    grants: Object.freeze(
      legalCandidateIds.map((permissionId) =>
        Object.freeze({ permissionId, scope })
      )
    ),
    semanticRestriction: mapping.semanticRestriction
  });
}

const scopeTypeSchema = z.enum(inboxV2PermissionScopeTypes);
const principalKindSchema = z.enum(["employee", "trusted_service"]);
const orgUnitModeSchema = z.enum(["exact", "subtree"]);
const scopeReferenceKindSchema = z.enum([
  "org_unit",
  "team",
  "queue",
  "client",
  "conversation",
  "work_item",
  "source_account"
]);

const permissionDefinitionRegistrationSchema = z
  .object({
    allowedScopes: z
      .array(scopeTypeSchema)
      .min(1)
      .max(inboxV2PermissionScopeTypes.length),
    allowedPrincipalKinds: z.array(principalKindSchema).min(1).max(2),
    guardProfileId: z.enum(inboxV2PermissionGuardProfileIds)
  })
  .strict()
  .superRefine((value, context) => {
    addDuplicateArrayIssues(value.allowedScopes, "allowedScopes", context);
    addDuplicateArrayIssues(
      value.allowedPrincipalKinds,
      "allowedPrincipalKinds",
      context
    );
  });

const scopeDefinitionRegistrationSchema = z
  .object({
    scopeType: scopeTypeSchema,
    family: z.enum(["structural", "exact_resource", "relation"]),
    referenceKind: scopeReferenceKindSchema.nullable(),
    orgUnitModes: z.array(orgUnitModeSchema).max(2)
  })
  .strict()
  .superRefine((value, context) => {
    addDuplicateArrayIssues(value.orgUnitModes, "orgUnitModes", context);

    const expected = inboxV2ScopeCatalog.find(
      ({ type }) => type === value.scopeType
    );
    if (
      expected === undefined ||
      expected.family !== value.family ||
      expected.referenceKind !== value.referenceKind ||
      !sameStringArray(expected.orgUnitModes, value.orgUnitModes)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Inbox V2 scope definition does not match the closed scope catalog."
      });
    }
  });

const guardProfileDefinitionRegistrationSchema = z
  .object({
    requiredFenceIds: z.array(inboxV2NamespacedIdSchema).min(1).max(32)
  })
  .strict()
  .superRefine((value, context) => {
    addDuplicateArrayIssues(
      value.requiredFenceIds,
      "requiredFenceIds",
      context
    );
  });

const v1MappingDefinitionRegistrationSchema = z
  .object({
    v1PermissionId: z.string().refine(isInboxV1Permission),
    disposition: z.enum([
      "automatic_if_scope_legal",
      "review_required",
      "compatibility_only"
    ]),
    candidatePermissionIds: z
      .array(z.string().refine(isInboxV2PermissionId))
      .max(inboxV2PermissionCatalog.length),
    semanticRestriction: z.enum([
      "same_or_narrower",
      "aggregate_only",
      "external_reply_only",
      "action_split",
      "outside_inbox_v2"
    ])
  })
  .strict()
  .superRefine((value, context) => {
    addDuplicateArrayIssues(
      value.candidatePermissionIds,
      "candidatePermissionIds",
      context
    );
    if (
      (value.disposition === "compatibility_only") !==
      (value.candidatePermissionIds.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Compatibility-only V1 mappings must be the only mappings without V2 candidates."
      });
    }
  });

const inboxV2PermissionCatalogRegistrationBaseSchema =
  createInboxV2CoreCatalogRegistrationSchema({
    catalog: "inbox-v2-permission",
    definitionSchema: permissionDefinitionRegistrationSchema
  });
export const inboxV2PermissionCatalogRegistrationSchema =
  inboxV2PermissionCatalogRegistrationBaseSchema.superRefine(
    (registration, context) => {
      if (
        registration.payload.entries.length !== inboxV2PermissionCatalog.length
      ) {
        context.addIssue({
          code: "custom",
          path: ["payload", "entries"],
          message: "Core Inbox V2 permission registration must be complete."
        });
      }

      for (const [index, entry] of registration.payload.entries.entries()) {
        const expected = getInboxV2PermissionDefinition(String(entry.id));
        if (
          expected === undefined ||
          !sameStringArray(
            expected.allowedScopes,
            entry.definition.allowedScopes
          ) ||
          !sameStringArray(
            expected.allowedPrincipalKinds,
            entry.definition.allowedPrincipalKinds
          ) ||
          expected.guardProfileId !== entry.definition.guardProfileId
        ) {
          context.addIssue({
            code: "custom",
            path: ["payload", "entries", index],
            message:
              "Core Inbox V2 permission registration differs from the canonical catalog."
          });
        }
      }
    }
  );

/**
 * Modules may add namespaced actions, but they reuse the closed V2 scope and
 * principal vocabulary. Provider roster/claim/watcher concepts therefore
 * cannot become authority through a module permission definition.
 */
export function createInboxV2ModulePermissionCatalogRegistrationSchema<
  const TModuleId extends string
>(moduleId: TModuleId) {
  return createInboxV2ModuleCatalogRegistrationSchema({
    catalog: "inbox-v2-permission",
    moduleId,
    definitionSchema: permissionDefinitionRegistrationSchema
  });
}

const inboxV2ScopeCatalogRegistrationBaseSchema =
  createInboxV2CoreCatalogRegistrationSchema({
    catalog: "inbox-v2-permission-scope",
    definitionSchema: scopeDefinitionRegistrationSchema
  });
export const inboxV2ScopeCatalogRegistrationSchema =
  inboxV2ScopeCatalogRegistrationBaseSchema.superRefine(
    (registration, context) => {
      if (registration.payload.entries.length !== inboxV2ScopeCatalog.length) {
        context.addIssue({
          code: "custom",
          path: ["payload", "entries"],
          message: "Core Inbox V2 scope registration must be complete."
        });
      }

      for (const [index, entry] of registration.payload.entries.entries()) {
        const expected = inboxV2ScopeCatalog.find(
          ({ type }) => `core:permission-scope.${type}` === String(entry.id)
        );
        if (
          expected === undefined ||
          expected.type !== entry.definition.scopeType ||
          expected.family !== entry.definition.family ||
          expected.referenceKind !== entry.definition.referenceKind ||
          !sameStringArray(expected.orgUnitModes, entry.definition.orgUnitModes)
        ) {
          context.addIssue({
            code: "custom",
            path: ["payload", "entries", index],
            message:
              "Core Inbox V2 scope registration differs from the canonical catalog."
          });
        }
      }
    }
  );

const inboxV2PermissionGuardProfileCatalogRegistrationBaseSchema =
  createInboxV2CoreCatalogRegistrationSchema({
    catalog: "inbox-v2-permission-guard-profile",
    definitionSchema: guardProfileDefinitionRegistrationSchema
  });
export const inboxV2PermissionGuardProfileCatalogRegistrationSchema =
  inboxV2PermissionGuardProfileCatalogRegistrationBaseSchema.superRefine(
    (registration, context) => {
      if (
        registration.payload.entries.length !==
        inboxV2PermissionGuardProfiles.length
      ) {
        context.addIssue({
          code: "custom",
          path: ["payload", "entries"],
          message:
            "Core Inbox V2 permission guard-profile registration must be complete."
        });
      }

      for (const [index, entry] of registration.payload.entries.entries()) {
        const expected = inboxV2PermissionGuardProfiles.find(
          ({ id }) => id === String(entry.id)
        );
        if (
          expected === undefined ||
          !sameStringArray(
            expected.requiredFenceIds,
            entry.definition.requiredFenceIds
          )
        ) {
          context.addIssue({
            code: "custom",
            path: ["payload", "entries", index],
            message:
              "Core Inbox V2 guard profile differs from the canonical catalog."
          });
        }
      }
    }
  );

const inboxV1PermissionMappingCatalogRegistrationBaseSchema =
  createInboxV2CoreCatalogRegistrationSchema({
    catalog: "inbox-v1-permission-mapping",
    definitionSchema: v1MappingDefinitionRegistrationSchema
  });
export const inboxV1PermissionMappingCatalogRegistrationSchema =
  inboxV1PermissionMappingCatalogRegistrationBaseSchema.superRefine(
    (registration, context) => {
      if (
        registration.payload.entries.length !==
        inboxV1ToV2PermissionMappings.length
      ) {
        context.addIssue({
          code: "custom",
          path: ["payload", "entries"],
          message: "Inbox V1 compatibility mapping must be complete."
        });
      }

      for (const [index, entry] of registration.payload.entries.entries()) {
        const expected = isInboxV1Permission(entry.definition.v1PermissionId)
          ? v1MappingByPermission[entry.definition.v1PermissionId]
          : undefined;
        if (
          expected === undefined ||
          `core:v1-permission.${expected.v1PermissionId}` !==
            String(entry.id) ||
          expected.disposition !== entry.definition.disposition ||
          expected.semanticRestriction !==
            entry.definition.semanticRestriction ||
          !sameStringArray(
            expected.candidatePermissionIds,
            entry.definition.candidatePermissionIds
          )
        ) {
          context.addIssue({
            code: "custom",
            path: ["payload", "entries", index],
            message:
              "Inbox V1 compatibility mapping differs from the canonical catalog."
          });
        }
      }
    }
  );

export const inboxV2PermissionCatalogRegistration = requireRegistration(
  defineInboxV2CatalogRegistrations([
    inboxV2PermissionCatalogRegistrationSchema.parse({
      schemaId: INBOX_V2_CATALOG_REGISTRATION_SCHEMA_ID,
      schemaVersion: INBOX_V2_INITIAL_SCHEMA_VERSION,
      payload: {
        catalog: "inbox-v2-permission",
        owner: { kind: "core" },
        entries: inboxV2PermissionCatalog.map((entry) => ({
          id: entry.id,
          definition: {
            allowedScopes: entry.allowedScopes,
            allowedPrincipalKinds: entry.allowedPrincipalKinds,
            guardProfileId: entry.guardProfileId
          }
        }))
      }
    })
  ])[0]
);

export const inboxV2ScopeCatalogRegistration = requireRegistration(
  defineInboxV2CatalogRegistrations([
    inboxV2ScopeCatalogRegistrationSchema.parse({
      schemaId: INBOX_V2_CATALOG_REGISTRATION_SCHEMA_ID,
      schemaVersion: INBOX_V2_INITIAL_SCHEMA_VERSION,
      payload: {
        catalog: "inbox-v2-permission-scope",
        owner: { kind: "core" },
        entries: inboxV2ScopeCatalog.map((entry) => ({
          id: `core:permission-scope.${entry.type}`,
          definition: {
            scopeType: entry.type,
            family: entry.family,
            referenceKind: entry.referenceKind,
            orgUnitModes: entry.orgUnitModes
          }
        }))
      }
    })
  ])[0]
);

export const inboxV2PermissionGuardProfileCatalogRegistration =
  requireRegistration(
    defineInboxV2CatalogRegistrations([
      inboxV2PermissionGuardProfileCatalogRegistrationSchema.parse({
        schemaId: INBOX_V2_CATALOG_REGISTRATION_SCHEMA_ID,
        schemaVersion: INBOX_V2_INITIAL_SCHEMA_VERSION,
        payload: {
          catalog: "inbox-v2-permission-guard-profile",
          owner: { kind: "core" },
          entries: inboxV2PermissionGuardProfiles.map((entry) => ({
            id: entry.id,
            definition: { requiredFenceIds: entry.requiredFenceIds }
          }))
        }
      })
    ])[0]
  );

export const inboxV1PermissionMappingCatalogRegistration = requireRegistration(
  defineInboxV2CatalogRegistrations([
    inboxV1PermissionMappingCatalogRegistrationSchema.parse({
      schemaId: INBOX_V2_CATALOG_REGISTRATION_SCHEMA_ID,
      schemaVersion: INBOX_V2_INITIAL_SCHEMA_VERSION,
      payload: {
        catalog: "inbox-v1-permission-mapping",
        owner: { kind: "core" },
        entries: inboxV1ToV2PermissionMappings.map((entry) => ({
          id: `core:v1-permission.${entry.v1PermissionId}`,
          definition: entry
        }))
      }
    })
  ])[0]
);

const inboxV2PermissionScopeCatalogPayloadSchema = z
  .object({
    registrations: z.tuple([
      inboxV2PermissionCatalogRegistrationSchema,
      inboxV2ScopeCatalogRegistrationSchema,
      inboxV2PermissionGuardProfileCatalogRegistrationSchema,
      inboxV1PermissionMappingCatalogRegistrationSchema
    ])
  })
  .strict();

export const inboxV2PermissionScopeCatalogSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_PERMISSION_SCOPE_CATALOG_SCHEMA_ID,
    INBOX_V2_PERMISSION_SCOPE_CATALOG_VERSION,
    inboxV2PermissionScopeCatalogPayloadSchema
  );

const inboxV2PermissionScopeCatalogRegistrations = Object.freeze([
  inboxV2PermissionCatalogRegistration,
  inboxV2ScopeCatalogRegistration,
  inboxV2PermissionGuardProfileCatalogRegistration,
  inboxV1PermissionMappingCatalogRegistration
] as const);

inboxV2PermissionScopeCatalogSchema.parse({
  schemaId: INBOX_V2_PERMISSION_SCOPE_CATALOG_SCHEMA_ID,
  schemaVersion: INBOX_V2_PERMISSION_SCOPE_CATALOG_VERSION,
  payload: { registrations: inboxV2PermissionScopeCatalogRegistrations }
});

export const inboxV2PermissionScopeCatalog = Object.freeze({
  schemaId: INBOX_V2_PERMISSION_SCOPE_CATALOG_SCHEMA_ID,
  schemaVersion: INBOX_V2_PERMISSION_SCOPE_CATALOG_VERSION,
  payload: Object.freeze({
    registrations: inboxV2PermissionScopeCatalogRegistrations
  })
});

function translateInboxV1Scope(
  tenantId: InboxV2TenantId,
  scope: InboxV1PermissionScope
): InboxV2PermissionScope | undefined {
  if (scope.type === "tenant") {
    return Object.freeze({ type: "tenant", tenantId });
  }

  if (scope.type === "org_unit") {
    const id = inboxV2OrgUnitIdSchema.safeParse(scope.id);
    if (!id.success) {
      return undefined;
    }
    return Object.freeze({
      type: "org_unit",
      tenantId,
      id: id.data,
      mode: "exact"
    });
  }

  if (scope.type === "assigned" || scope.type === "own") {
    return undefined;
  }

  if (!("id" in scope)) {
    return undefined;
  }

  const parser = exactReferenceIdParserByScopeType[scope.type];
  const id = parser.safeParse(scope.id);
  return id.success
    ? createExactReferenceScope(scope.type, tenantId, id.data)
    : undefined;
}

function reviewRequired(
  reason: Extract<
    InboxV1PermissionScopeMigrationResult,
    { kind: "review_required" }
  >["reason"],
  candidatePermissionIds: readonly InboxV2PermissionId[]
): InboxV1PermissionScopeMigrationResult {
  return Object.freeze({
    kind: "review_required",
    reason,
    candidatePermissionIds: Object.freeze([...candidatePermissionIds])
  });
}

const exactReferenceIdParserByScopeType = {
  team: inboxV2TeamIdSchema,
  queue: inboxV2WorkQueueIdSchema,
  client: inboxV2ClientIdSchema,
  conversation: inboxV2ConversationIdSchema,
  work_item: inboxV2WorkItemIdSchema,
  source_account: inboxV2SourceAccountIdSchema
} as const;

function createExactReferenceScope(
  type: InboxV2ExactReferenceScopeType,
  tenantId: InboxV2TenantId,
  id: string
): InboxV2PermissionScope {
  switch (type) {
    case "team":
      return Object.freeze({
        type,
        tenantId,
        id: inboxV2TeamIdSchema.parse(id)
      });
    case "queue":
      return Object.freeze({
        type,
        tenantId,
        id: inboxV2WorkQueueIdSchema.parse(id)
      });
    case "client":
      return Object.freeze({
        type,
        tenantId,
        id: inboxV2ClientIdSchema.parse(id)
      });
    case "conversation":
      return Object.freeze({
        type,
        tenantId,
        id: inboxV2ConversationIdSchema.parse(id)
      });
    case "work_item":
      return Object.freeze({
        type,
        tenantId,
        id: inboxV2WorkItemIdSchema.parse(id)
      });
    case "source_account":
      return Object.freeze({
        type,
        tenantId,
        id: inboxV2SourceAccountIdSchema.parse(id)
      });
  }
}

function guardProfileForPermission(
  permissionId: `core:${string}`
): InboxV2PermissionGuardProfileId {
  if (permissionId === "core:conversation.internal.break_glass_read") {
    return "core:rbac.guard.internal_break_glass_read";
  }
  if (permissionId === "core:conversation.internal.break_glass.issue") {
    return "core:rbac.guard.internal_break_glass_issue";
  }
  if (
    permissionId === "core:conversation.internal.read" ||
    permissionId === "core:conversation.internal.members.manage" ||
    permissionId === "core:message.send_internal" ||
    permissionId === "core:message.moderate_internal"
  ) {
    return "core:rbac.guard.internal_membership";
  }
  if (permissionId === "core:notification.watch.self") {
    return "core:rbac.guard.notification_self";
  }
  if (permissionId === "core:notification.watchers.manage") {
    return "core:rbac.guard.notification_target_read";
  }
  if (permissionId.startsWith("core:privacy.policy.")) {
    return "core:rbac.guard.privacy_policy_revision";
  }
  if (permissionId.startsWith("core:privacy.request.")) {
    return "core:rbac.guard.privacy_request_roots_revision";
  }
  if (permissionId === "core:privacy.subject_evidence.view") {
    return "core:rbac.guard.privacy_subject_evidence_roots";
  }
  if (permissionId.startsWith("core:privacy.hold.")) {
    return "core:rbac.guard.privacy_hold_manifest_revision";
  }
  if (permissionId === "core:privacy.tenant_export") {
    return "core:rbac.guard.privacy_tenant_export_high_water";
  }
  if (permissionId.startsWith("core:privacy.deletion.")) {
    return "core:rbac.guard.privacy_deletion_plan_revisions";
  }
  if (permissionId.startsWith("core:audit.privacy.")) {
    return "core:rbac.guard.privacy_audit_facets";
  }
  if (permissionId.startsWith("core:file.")) {
    return "core:rbac.guard.file_parent_content";
  }
  if (
    permissionId.startsWith("core:client.") ||
    permissionId === "core:conversation.clients.manage"
  ) {
    return "core:rbac.guard.client_context";
  }
  if (permissionId.startsWith("core:work.")) {
    return "core:rbac.guard.work_item_state";
  }
  if (
    permissionId === "core:source_account.use" ||
    permissionId === "core:source.route_policy.manage" ||
    permissionId === "core:source.dispatch.reroute"
  ) {
    return "core:rbac.guard.source_account_route";
  }
  if (
    permissionId === "core:message.reply_external" ||
    permissionId === "core:message.forward_external" ||
    permissionId === "core:source.multi_send" ||
    permissionId === "core:source_item.reply" ||
    permissionId === "core:call.initiate"
  ) {
    return "core:rbac.guard.external_route";
  }
  if (permissionId.startsWith("core:identity.")) {
    return "core:rbac.guard.identity_evidence";
  }
  if (
    permissionId === "core:reports.drilldown" ||
    permissionId === "core:reports.pii.view" ||
    permissionId === "core:reports.pii.export"
  ) {
    return "core:rbac.guard.report_resource_conjunction";
  }
  if (permissionId === "core:audit.view") {
    return "core:rbac.guard.audit_facets";
  }

  return "core:rbac.guard.canonical_resource";
}

function isRelationScopeType(value: string): value is InboxV2RelationScopeType {
  return (
    value === "responsible" ||
    value === "collaborator" ||
    value === "internal_participant" ||
    value === "client_owner"
  );
}

function isExactReferenceScopeType(
  value: string
): value is InboxV2ExactReferenceScopeType {
  return (
    value === "team" ||
    value === "queue" ||
    value === "client" ||
    value === "conversation" ||
    value === "work_item" ||
    value === "source_account"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[]
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === expected.length &&
    actual.every((key) => expected.includes(key))
  );
}

function sameStringArray(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function addDuplicateArrayIssues(
  values: readonly string[],
  path: string,
  context: {
    addIssue(issue: {
      code: "custom";
      path: (string | number)[];
      message: string;
    }): void;
  }
): void {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (seen.has(value)) {
      context.addIssue({
        code: "custom",
        path: [path, index],
        message: `Duplicate Inbox V2 catalog value: ${value}.`
      });
    }
    seen.add(value);
  }
}

function requireRegistration<TValue>(value: TValue | undefined): TValue {
  if (value === undefined) {
    throw new Error("Inbox V2 catalog registration is missing.");
  }
  return value;
}
