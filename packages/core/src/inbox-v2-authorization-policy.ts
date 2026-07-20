import type {
  InboxV2AuthorizationDependencyVector,
  InboxV2AuthorizationEpoch,
  InboxV2AuthorizationEpochSnapshot,
  InboxV2ClientId,
  InboxV2ConversationId,
  InboxV2EmployeeId,
  InboxV2EmployeeReference,
  InboxV2EntityKey,
  InboxV2EntityRevision,
  InboxV2OrgUnitId,
  InboxV2SourceAccountId,
  InboxV2SecurityDenialAction,
  InboxV2TeamId,
  InboxV2TenantId,
  InboxV2TrustedServiceId,
  InboxV2WorkItemId,
  InboxV2WorkQueueId
} from "@hulee/contracts";

import {
  evaluateInboxV2PermissionScopePairLegality,
  getInboxV2PermissionDefinition,
  type InboxV2PermissionId,
  type InboxV2PermissionScope,
  type InboxV2PermissionScopeType
} from "./inbox-v2-permission-catalog";

/**
 * Pure, provider-neutral Inbox V2 authorization policy.
 *
 * Every value accepted here is a fact loaded by a trusted server-side facade.
 * Public request DTOs, provider roles, cached capabilities and UI hints must
 * never be adapted directly into these types.
 */

export type InboxV2PolicyTimestamp = string;

export type InboxV2PolicyPrincipal =
  | Readonly<{ kind: "unauthenticated" }>
  | Readonly<{
      kind: "employee";
      employee: InboxV2EmployeeReference;
      lifecycle: "active" | "draining" | "inactive";
      session: Readonly<{
        state: "active" | "expired" | "revoked";
        authorization: InboxV2AuthorizationEpochSnapshot;
        notAfter: InboxV2PolicyTimestamp;
      }>;
    }>
  | Readonly<{
      kind: "trusted_service";
      tenantId: InboxV2TenantId;
      trustedServiceId: InboxV2TrustedServiceId;
      registrationState: "active" | "disabled";
      authorizationEpoch: InboxV2AuthorizationEpoch;
      dependencies: InboxV2AuthorizationDependencyVector;
      /** Closed registration allow-list; catalog principal legality is not enough. */
      allowedPermissionIds: readonly InboxV2PermissionId[];
      notAfter: InboxV2PolicyTimestamp;
    }>;

type InboxV2EmployeeGrantSource =
  | Readonly<{
      kind: "role_binding";
      origin: "inbox_v2_native";
      roleBindingId: string;
      bindingResource: InboxV2EntityKey;
      bindingRevision: InboxV2EntityRevision;
    }>
  | Readonly<{
      kind: "direct_grant";
      origin: "inbox_v2_native";
      directGrantId: string;
      bindingResource: InboxV2EntityKey;
      bindingRevision: InboxV2EntityRevision;
    }>;

type InboxV2ServiceGrantSource = Readonly<{
  kind: "service_registration";
  origin: "inbox_v2_native";
  serviceRegistrationId: string;
  bindingResource: InboxV2EntityKey;
  bindingRevision: InboxV2EntityRevision;
}>;

type InboxV2PolicyGrantBase = Readonly<{
  id: string;
  tenantId: InboxV2TenantId;
  permissionId: InboxV2PermissionId;
  catalogSchemaId: "core:inbox-v2.permission-scope-catalog";
  catalogVersion: "v1";
  scope: InboxV2PermissionScope;
  revision: InboxV2EntityRevision;
  validFrom: InboxV2PolicyTimestamp | null;
  validUntil: InboxV2PolicyTimestamp | null;
  revokedAt: InboxV2PolicyTimestamp | null;
}>;

export type InboxV2PolicyGrant = InboxV2PolicyGrantBase &
  (
    | Readonly<{
        principal: Readonly<{
          kind: "employee";
          employeeId: InboxV2EmployeeId;
        }>;
        source: InboxV2EmployeeGrantSource;
      }>
    | Readonly<{
        principal: Readonly<{
          kind: "trusted_service";
          trustedServiceId: InboxV2TrustedServiceId;
        }>;
        source: InboxV2ServiceGrantSource;
      }>
  );

type InboxV2TemporalScopeFact = Readonly<{
  /** Exact primary resource for which this structural/relation fact was loaded. */
  resource: InboxV2EntityKey;
  /** Exact structural/relation endpoint; never inferred from a caller ID. */
  scopeTarget: InboxV2EntityKey;
  pathRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
  authorityProvenance: Readonly<{
    kind: "hulee_canonical_repository";
    factId: string;
    loaderDecisionId: string;
    projectionRevision: InboxV2EntityRevision;
    observedAt: InboxV2PolicyTimestamp;
  }>;
  validUntil: InboxV2PolicyTimestamp | null;
}>;

/** Canonical relations which may satisfy a grant scope. */
export type InboxV2CanonicalScopeFact =
  | (InboxV2TemporalScopeFact &
      Readonly<{
        kind: "org_unit";
        orgUnitId: InboxV2OrgUnitId;
        ancestorOrgUnitIds: readonly InboxV2OrgUnitId[];
        closureRevision: InboxV2EntityRevision;
        currentClosureRevision: InboxV2EntityRevision;
      }>)
  | (InboxV2TemporalScopeFact &
      Readonly<{ kind: "team"; teamId: InboxV2TeamId }>)
  | (InboxV2TemporalScopeFact &
      Readonly<{ kind: "queue"; queueId: InboxV2WorkQueueId }>)
  | (InboxV2TemporalScopeFact &
      Readonly<{ kind: "client"; clientId: InboxV2ClientId }>)
  | (InboxV2TemporalScopeFact &
      Readonly<{
        kind: "conversation";
        conversationId: InboxV2ConversationId;
      }>)
  | (InboxV2TemporalScopeFact &
      Readonly<{ kind: "work_item"; workItemId: InboxV2WorkItemId }>)
  | (InboxV2TemporalScopeFact &
      Readonly<{
        kind: "source_account";
        sourceAccountId: InboxV2SourceAccountId;
      }>)
  | (InboxV2TemporalScopeFact &
      Readonly<{
        kind: "responsible";
        employeeId: InboxV2EmployeeId;
        workItemId: InboxV2WorkItemId;
        state: "active" | "recovery_pending" | "closed";
        assignmentRevision: InboxV2EntityRevision;
        currentAssignmentRevision: InboxV2EntityRevision;
      }>)
  | (InboxV2TemporalScopeFact &
      Readonly<{
        kind: "collaborator";
        employeeId: InboxV2EmployeeId;
        subject:
          | Readonly<{
              kind: "conversation";
              conversationId: InboxV2ConversationId;
            }>
          | Readonly<{
              kind: "work_item";
              workItemId: InboxV2WorkItemId;
              workCycle: string;
              currentWorkCycle: string;
            }>;
        state: "active" | "closed";
        episodeRevision: InboxV2EntityRevision;
        currentEpisodeRevision: InboxV2EntityRevision;
      }>)
  | (InboxV2TemporalScopeFact &
      Readonly<{
        kind: "internal_participant";
        employeeId: InboxV2EmployeeId;
        conversationId: InboxV2ConversationId;
        origin: "hulee_internal_command" | "provider_observation";
        state: "active" | "closed";
        role: "owner" | "admin" | "member" | "observer";
        membershipRevision: InboxV2EntityRevision;
        currentMembershipRevision: InboxV2EntityRevision;
      }>)
  | (InboxV2TemporalScopeFact &
      Readonly<{
        kind: "client_owner";
        employeeId: InboxV2EmployeeId;
        clientId: InboxV2ClientId;
        state: "active" | "closed";
        ownershipRevision: InboxV2EntityRevision;
        currentOwnershipRevision: InboxV2EntityRevision;
      }>);

export type InboxV2PolicyRevisionCheck = Readonly<{
  kind:
    | "entity"
    | "state"
    | "relation"
    | "binding"
    | "route"
    | "policy"
    | "manifest"
    | "legal_hold_set"
    | "high_water"
    | "handler";
  expected: string;
  actual: string;
}>;

type InboxV2KeyedRevisionCheck = Readonly<{
  resource: InboxV2EntityKey;
  expected: string;
  actual: string;
}>;

type InboxV2PrivilegedMutationAuditAction =
  | "tenant_settings_change"
  | "employee_invite"
  | "employee_profile_update"
  | "employee_deactivate"
  | "role_definition_change"
  | "organization_graph_change"
  | "role_bind"
  | "direct_grant"
  | "internal_membership_add"
  | "internal_membership_remove"
  | "internal_membership_change_role"
  | "internal_owner_recovery"
  | "internal_break_glass_read";

type InboxV2PrivilegedMutationAuditEvidence = Readonly<{
  eventResource: InboxV2EntityKey;
  bindingResource: InboxV2EntityKey;
  bindingEventResource: InboxV2EntityKey;
  bindingTargetResource: InboxV2EntityKey;
  bindingActorEmployeeResource: InboxV2EntityKey;
  action: InboxV2PrivilegedMutationAuditAction;
  revisionChecks: readonly InboxV2KeyedRevisionCheck[];
}>;

type InboxV2EmployeeDeactivationRelationSetEvidence = Readonly<{
  kind: "primary_work" | "client_owner" | "internal_owner";
  resource: InboxV2EntityKey;
  fenceResource: InboxV2EntityKey;
  employeeResource: InboxV2EntityKey;
  activeCount: number;
  expectedHighWater: string;
  currentHighWater: string;
  revisionChecks: readonly InboxV2KeyedRevisionCheck[];
}>;

type InboxV2EmployeeDeactivationHandlerSetEvidence = Readonly<{
  resource: InboxV2EntityKey;
  workflowResource: InboxV2EntityKey;
  employeeResource: InboxV2EntityKey;
  registrySelection: Readonly<{
    resource: InboxV2EntityKey;
    tenantResource: InboxV2EntityKey;
    selectedRegistryResource: InboxV2EntityKey;
    selectedVersion: string;
    selectedDigest: string;
    state: "active" | "inactive";
    mandatoryHandlerResources: readonly InboxV2EntityKey[];
    revisionChecks: readonly InboxV2KeyedRevisionCheck[];
  }>;
  registryManifest: Readonly<{
    resource: InboxV2EntityKey;
    tenantResource: InboxV2EntityKey;
    version: string;
    digest: string;
    registeredMandatoryHandlerResources: readonly InboxV2EntityKey[];
    revisionChecks: readonly InboxV2KeyedRevisionCheck[];
  }>;
  requiredHandlerResources: readonly InboxV2EntityKey[];
  completedHandlerResources: readonly InboxV2EntityKey[];
  revisionChecks: readonly InboxV2KeyedRevisionCheck[];
}>;

type InboxV2InternalOwnerSetEvidence = Readonly<{
  resource: InboxV2EntityKey;
  conversationResource: InboxV2EntityKey;
  beforeOwnerMembershipResources: readonly InboxV2EntityKey[];
  afterOwnerMembershipResources: readonly InboxV2EntityKey[];
}>;

type InboxV2InternalOwnerSuccessorEvidence = Readonly<{
  employeeId: InboxV2EmployeeId;
  employeeResource: InboxV2EntityKey;
  membershipRelationResource: InboxV2EntityKey;
  relationConversationResource: InboxV2EntityKey;
  relationEmployeeResource: InboxV2EntityKey;
  lifecycle: "active" | "draining" | "inactive";
  currentRole: "admin" | "member" | "observer";
  newRole: "owner";
}>;

type InboxV2ReportPrivacyEvidence = Readonly<{
  requestedDimensionIds: readonly string[];
  allowedDimensionIds: readonly string[];
  minimumCellSize: number;
  primarySuppressionApplied: boolean;
  complementarySuppressionApplied: boolean;
  differencingBudgetRemaining: number;
  privateInternalIncluded: boolean;
  stablePersonIdentifiersIncluded: boolean;
}>;

type InboxV2CanonicalActionEvidence =
  | Readonly<{ kind: "canonical" }>
  | Readonly<{
      kind: "inbox_entry_read";
      targetResource: InboxV2EntityKey;
      entryBoundary: "query" | "external_metadata" | "internal_metadata";
      internalReadRequirementId: string | null;
      topologyResource: InboxV2EntityKey;
      topologyTargetResource: InboxV2EntityKey;
      topologyConversationKind: "external_work" | "internal" | null;
      topologyRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
    }>
  | Readonly<{
      kind: "conversation_content_read";
      targetResource: InboxV2EntityKey;
      conversationKind: "external_work" | "internal";
      contentBoundary: "external" | "internal";
      topologyResource: InboxV2EntityKey;
      topologyConversationResource: InboxV2EntityKey;
      topologyConversationKind: "external_work" | "internal";
      topologyRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
    }>
  | Readonly<{
      kind: "tenant_settings_change";
      targetResource: InboxV2EntityKey;
      targetRevisionChecks: readonly InboxV2KeyedRevisionCheck[];
      reason: string;
      audit: InboxV2PrivilegedMutationAuditEvidence;
    }>
  | Readonly<{
      kind: "employee_record_change";
      operation: "invite" | "profile_update" | "deactivate";
      targetResource: InboxV2EntityKey;
      targetEmployeeResource: InboxV2EntityKey | null;
      lifecycleBefore: "pending" | "active" | "draining" | "inactive" | null;
      lifecycleAfter: "pending" | "active" | "draining" | "inactive";
      targetRevisionChecks: readonly InboxV2KeyedRevisionCheck[];
      reason: string;
      audit: InboxV2PrivilegedMutationAuditEvidence;
      deactivationWorkflow: Readonly<{
        resource: InboxV2EntityKey;
        employeeResource: InboxV2EntityKey;
        phase: "start_draining" | "finalize_inactive";
        handlerSet: InboxV2EmployeeDeactivationHandlerSetEvidence;
        zeroRelationsProofResource: InboxV2EntityKey;
        proofWorkflowResource: InboxV2EntityKey;
        proofEmployeeResource: InboxV2EntityKey;
        relationSets: readonly InboxV2EmployeeDeactivationRelationSetEvidence[];
        revisionChecks: readonly InboxV2KeyedRevisionCheck[];
      }> | null;
    }>
  | Readonly<{
      kind: "role_definition_change";
      targetResource: InboxV2EntityKey;
      permissionSetIds: readonly InboxV2PermissionId[];
      targetRevisionChecks: readonly InboxV2KeyedRevisionCheck[];
      reason: string;
      audit: InboxV2PrivilegedMutationAuditEvidence;
    }>
  | Readonly<{
      kind: "organization_graph_change";
      resourceKind: "org_unit" | "team" | "queue";
      targetResource: InboxV2EntityKey;
      graphResource: InboxV2EntityKey;
      graphTargetResource: InboxV2EntityKey;
      parentResource: InboxV2EntityKey | null;
      graphParentResource: InboxV2EntityKey | null;
      graphRevisionChecks: readonly InboxV2KeyedRevisionCheck[];
      createsCycle: boolean;
      reason: string;
      audit: InboxV2PrivilegedMutationAuditEvidence;
    }>
  | Readonly<{
      kind: "source_item_open_external";
      targetResource: InboxV2EntityKey;
      descriptorResource: InboxV2EntityKey;
      descriptorTargetResource: InboxV2EntityKey;
      sourceAccountResource: InboxV2EntityKey;
      descriptorSourceAccountResource: InboxV2EntityKey;
      descriptorState: "approved" | "revoked" | "expired";
      actionType: "open_url" | "provider_action";
      descriptorRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
      notAfter: InboxV2PolicyTimestamp;
    }>
  | Readonly<{
      kind: "delegation_change";
      targetResource: InboxV2EntityKey;
      operation: "role_bind" | "direct_grant";
      actorEmployeeId: InboxV2EmployeeId;
      subjectEmployeeId: InboxV2EmployeeId;
      subjectEmployeeResource: InboxV2EntityKey;
      subjectDirectoryRequirementId: string;
      delegatedAuthorities: readonly Readonly<{
        requirementId: string;
        permissionId: InboxV2PermissionId;
        requestedScope: InboxV2PermissionScope;
      }>[];
      bindingScope: InboxV2PermissionScope;
      bindingScopeResource: InboxV2EntityKey;
      bindingRelationResource: InboxV2EntityKey;
      relationBindingResource: InboxV2EntityKey;
      relationSubjectEmployeeResource: InboxV2EntityKey;
      relationScopeResource: InboxV2EntityKey;
      bindingRevisionChecks: readonly InboxV2KeyedRevisionCheck[];
      reason: string;
      validUntil: InboxV2PolicyTimestamp | null;
      audit: InboxV2PrivilegedMutationAuditEvidence;
      roleDefinition: Readonly<{
        resource: InboxV2EntityKey;
        bindingResource: InboxV2EntityKey;
        bindingRoleResource: InboxV2EntityKey;
        permissionSetIds: readonly InboxV2PermissionId[];
        revisionChecks: readonly InboxV2PolicyRevisionCheck[];
      }> | null;
    }>
  | Readonly<{
      kind: "conversation_access_change";
      targetResource: InboxV2EntityKey;
      operation: "manage" | "apply_policy";
      bindingResource: InboxV2EntityKey;
      bindingConversationResource: InboxV2EntityKey;
      bindingRevisionChecks: readonly InboxV2KeyedRevisionCheck[];
      oldTargetResource: InboxV2EntityKey;
      oldTargetScope: InboxV2PermissionScope;
      newTargetResource: InboxV2EntityKey;
      newTargetScope: InboxV2PermissionScope;
      targetRevisionChecks: readonly InboxV2KeyedRevisionCheck[];
      reason: string;
      policyResource: InboxV2EntityKey | null;
      policyRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
    }>
  | Readonly<{
      kind: "internal_conversation_create";
      targetResource: InboxV2EntityKey;
      conversationKind: "internal_direct" | "internal_group";
      creatorEmployeeId: InboxV2EmployeeId;
      members: readonly Readonly<{
        employeeId: InboxV2EmployeeId;
        employeeResource: InboxV2EntityKey;
        lifecycle: "active" | "draining" | "inactive";
        role: "owner" | "admin" | "member" | "observer";
        directoryRequirementId: string;
      }>[];
      topologyResource: InboxV2EntityKey;
      topologyConversationResource: InboxV2EntityKey;
      topologyKind: "internal_direct" | "internal_group";
      policyResource: InboxV2EntityKey;
      policyTopologyResource: InboxV2EntityKey;
      policyRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
    }>
  | Readonly<{
      kind: "conversation_collaborator_change";
      targetResource: InboxV2EntityKey;
      targetEmployeeResource: InboxV2EntityKey;
      targetEmployeeId: InboxV2EmployeeId;
      targetLifecycle: "active" | "draining" | "inactive";
      targetDirectoryRequirementId: string;
      intendedCollaboratorPermissionIds: readonly InboxV2PermissionId[];
      targetGrantIds: readonly string[];
      expectedRelationRevision: string;
      currentRelationRevision: string;
      reason: string;
    }>
  | Readonly<{
      kind: "notification_self_settings";
      targetResource: InboxV2EntityKey;
      employeeResource: InboxV2EntityKey;
      employeeId: InboxV2EmployeeId;
      endpointOwnerEmployeeId: InboxV2EmployeeId;
      ownershipEndpointResource: InboxV2EntityKey | null;
      ownershipEmployeeResource: InboxV2EntityKey;
      ownershipRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
    }>
  | Readonly<{
      kind: "message_author_action";
      operation: "edit" | "delete";
      targetResource: InboxV2EntityKey;
      actorEmployeeId: InboxV2EmployeeId;
      authorEmployeeId: InboxV2EmployeeId;
      contentBoundary: "external" | "internal" | "staff_only";
      targetRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
      authorshipResource: InboxV2EntityKey;
      authorshipTimelineItemResource: InboxV2EntityKey;
      authorshipEmployeeResource: InboxV2EntityKey;
      authorshipRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
      contentTopologyResource: InboxV2EntityKey;
      topologyTimelineItemResource: InboxV2EntityKey;
      topologyConversationResource: InboxV2EntityKey;
      topologyBoundary: "external" | "internal" | "staff_only";
      topologyRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
      contentReadRequirementIds: readonly string[];
      deletionMode: "local_tombstone" | "provider_delete" | null;
      holdProof: Readonly<{
        resource: InboxV2EntityKey;
        targetResource: InboxV2EntityKey;
        state: "none" | "active";
        revisionChecks: readonly InboxV2PolicyRevisionCheck[];
      }> | null;
      originalRouteRequirementId: string | null;
      originalSourceAccountId: InboxV2SourceAccountId | null;
      originalSourceAccountResource: InboxV2EntityKey | null;
      originalBindingResource: InboxV2EntityKey | null;
      originalBindingSourceAccountResource: InboxV2EntityKey | null;
      externalReferenceResource: InboxV2EntityKey | null;
      externalReferenceBindingResource: InboxV2EntityKey | null;
      externalReferenceTargetResource: InboxV2EntityKey | null;
      routeRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
      capabilityId:
        | "core:capability.message.edit"
        | "core:capability.message.delete"
        | null;
      capabilityManifestResource: InboxV2EntityKey | null;
      capabilityManifestSourceAccountResource: InboxV2EntityKey | null;
      capabilityRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
      capabilityState:
        | "not_applicable"
        | "supported"
        | "unsupported"
        | "expired";
      capabilityNotAfter: InboxV2PolicyTimestamp | null;
    }>
  | Readonly<{
      kind: "message_reaction";
      targetResource: InboxV2EntityKey;
      contentReadResource: InboxV2EntityKey;
      contentRelationTargetResource: InboxV2EntityKey;
      contentRelationReadResource: InboxV2EntityKey;
      contentRelationRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
      contentReadRequirementId: string;
      contentBoundary: "external" | "internal";
      targetRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
      contentTopologyResource: InboxV2EntityKey;
      topologyTimelineItemResource: InboxV2EntityKey;
      topologyConversationResource: InboxV2EntityKey;
      topologyBoundary: "external" | "internal";
      topologyRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
      originalRouteRequirementId: string | null;
      originalSourceAccountId: InboxV2SourceAccountId | null;
      originalSourceAccountResource: InboxV2EntityKey | null;
      originalBindingResource: InboxV2EntityKey | null;
      originalBindingSourceAccountResource: InboxV2EntityKey | null;
      externalReferenceResource: InboxV2EntityKey | null;
      externalReferenceBindingResource: InboxV2EntityKey | null;
      externalReferenceTargetResource: InboxV2EntityKey | null;
      routeRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
      capabilityId: "core:capability.message.react" | null;
      capabilityManifestResource: InboxV2EntityKey | null;
      capabilityManifestSourceAccountResource: InboxV2EntityKey | null;
      capabilityRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
      capabilityState:
        | "not_applicable"
        | "supported"
        | "unsupported"
        | "expired";
      capabilityNotAfter: InboxV2PolicyTimestamp | null;
    }>
  | Readonly<{
      kind: "external_moderation";
      operation: "edit" | "delete";
      targetResource: InboxV2EntityKey;
      contentReadResource: InboxV2EntityKey;
      contentRelationTargetResource: InboxV2EntityKey;
      contentRelationReadResource: InboxV2EntityKey;
      contentRelationRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
      reason: string;
      auditEventId: string | null;
      contentReadRequirementId: string;
      deletionMode: "local_tombstone" | "provider_delete" | null;
      holdProof: Readonly<{
        resource: InboxV2EntityKey;
        targetResource: InboxV2EntityKey;
        state: "none" | "active";
        revisionChecks: readonly InboxV2PolicyRevisionCheck[];
      }> | null;
      targetRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
      contentTopologyResource: InboxV2EntityKey;
      topologyTimelineItemResource: InboxV2EntityKey;
      topologyConversationResource: InboxV2EntityKey;
      topologyBoundary: "external";
      topologyRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
      originalRouteRequirementId: string | null;
      originalSourceAccountId: InboxV2SourceAccountId | null;
      originalSourceAccountResource: InboxV2EntityKey | null;
      originalBindingResource: InboxV2EntityKey | null;
      originalBindingSourceAccountResource: InboxV2EntityKey | null;
      externalReferenceResource: InboxV2EntityKey | null;
      externalReferenceBindingResource: InboxV2EntityKey | null;
      externalReferenceTargetResource: InboxV2EntityKey | null;
      routeRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
      capabilityId:
        | "core:capability.message.edit"
        | "core:capability.message.delete"
        | null;
      capabilityManifestResource: InboxV2EntityKey | null;
      capabilityManifestSourceAccountResource: InboxV2EntityKey | null;
      capabilityRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
      capabilityState:
        | "not_applicable"
        | "supported"
        | "unsupported"
        | "expired";
      capabilityNotAfter: InboxV2PolicyTimestamp | null;
    }>
  | Readonly<{
      kind: "internal_moderation";
      operation: "edit" | "delete";
      targetResource: InboxV2EntityKey;
      contentReadResource: InboxV2EntityKey;
      contentRelationTargetResource: InboxV2EntityKey;
      contentRelationReadResource: InboxV2EntityKey;
      contentRelationRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
      reason: string;
      auditEventId: string | null;
      contentReadRequirementId: string;
      deletionMode: "local_tombstone" | null;
      holdProof: Readonly<{
        resource: InboxV2EntityKey;
        targetResource: InboxV2EntityKey;
        state: "none" | "active";
        revisionChecks: readonly InboxV2PolicyRevisionCheck[];
      }> | null;
      targetRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
      contentTopologyResource: InboxV2EntityKey;
      topologyTimelineItemResource: InboxV2EntityKey;
      topologyConversationResource: InboxV2EntityKey;
      topologyBoundary: "internal";
      topologyRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
    }>
  | Readonly<{
      kind: "internal_owner_recovery";
      targetResource: InboxV2EntityKey;
      conversationId: InboxV2ConversationId;
      recoveryState: "owner_recovery" | "healthy";
      actorEmployeeId: InboxV2EmployeeId;
      successorEmployeeId: InboxV2EmployeeId;
      approverEmployeeId: InboxV2EmployeeId;
      approverEmployeeResource: InboxV2EntityKey;
      approverDirectoryRequirementId: string;
      approverGrantId: string;
      successorMembershipRequirementId: string;
      approvalResource: InboxV2EntityKey;
      approvalConversationResource: InboxV2EntityKey;
      approvalApproverEmployeeResource: InboxV2EntityKey;
      approvalSuccessorEmployeeResource: InboxV2EntityKey;
      approvalState: "approved" | "pending" | "revoked";
      approvalRevisionChecks: readonly InboxV2KeyedRevisionCheck[];
      approvalNotAfter: InboxV2PolicyTimestamp;
      successorMembership: InboxV2InternalOwnerSuccessorEvidence;
      ownerSet: InboxV2InternalOwnerSetEvidence;
      mutationRevisionChecks: readonly InboxV2KeyedRevisionCheck[];
      reason: string;
      audit: InboxV2PrivilegedMutationAuditEvidence;
    }>
  | Readonly<{
      kind: "report_aggregate";
      targetResource: InboxV2EntityKey;
      privacy: InboxV2ReportPrivacyEvidence;
    }>
  | Readonly<{
      kind: "report_workforce";
      targetResource: InboxV2EntityKey;
      privacy: InboxV2ReportPrivacyEvidence;
      employeeDirectoryRequirementId: string;
      employeeDirectoryResource: InboxV2EntityKey;
    }>
  | Readonly<{
      kind: "report_export";
      targetResource: InboxV2EntityKey;
      privacy: InboxV2ReportPrivacyEvidence;
      reportsViewRequirementId: string;
    }>
  | Readonly<{
      kind: "sensitive_content";
      targetResource: InboxV2EntityKey;
      baseReadResource: InboxV2EntityKey;
      baseReadRelationTargetResource: InboxV2EntityKey;
      baseReadRelationResource: InboxV2EntityKey;
      baseReadRelationRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
      baseReadRequirementId: string;
      purpose: string;
      policyEvidence:
        | Readonly<{
            kind: "participant_pii";
            policyResource: InboxV2EntityKey;
            policyTargetResource: InboxV2EntityKey;
            approvedPurposeIds: readonly string[];
            revisionChecks: readonly InboxV2PolicyRevisionCheck[];
            notAfter: InboxV2PolicyTimestamp;
          }>
        | Readonly<{
            kind: "call_recording" | "call_transcript";
            contentResource: InboxV2EntityKey;
            availability: "available" | "restricted" | "expired";
            retentionNotAfter: InboxV2PolicyTimestamp;
            consentState: "allowed" | "denied" | "not_applicable";
            processingState: "allowed" | "denied";
            policyResource: InboxV2EntityKey;
            policyTargetResource: InboxV2EntityKey;
            approvedPurposeIds: readonly string[];
            revisionChecks: readonly InboxV2PolicyRevisionCheck[];
          }>;
    }>;

type InboxV2CanonicalResourceGuard = Readonly<{
  profileId: "core:rbac.guard.canonical_resource";
  resourceState: "active" | "inactive" | "deleted";
  contentBoundary: "none" | "external" | "staff_only";
  routeInputFields: readonly string[];
  companionRequirementIds: readonly string[];
  action: InboxV2CanonicalActionEvidence;
}>;

type InboxV2InternalMembershipGuard = Readonly<{
  profileId: "core:rbac.guard.internal_membership";
  conversationId: InboxV2ConversationId;
  employeeId: InboxV2EmployeeId;
  membershipState: "active" | "closed";
  membershipOrigin: "hulee_internal_command" | "provider_observation";
  membershipRole: "owner" | "admin" | "member" | "observer";
  contentBoundary: "internal" | "external" | "staff_only";
  validUntil: InboxV2PolicyTimestamp | null;
  moderationAction?: Extract<
    InboxV2CanonicalActionEvidence,
    { kind: "internal_moderation" }
  >;
  membershipChange?: Readonly<{
    operation: "add" | "remove" | "change_role";
    targetEmployeeId: InboxV2EmployeeId;
    targetEmployeeResource: InboxV2EntityKey;
    targetDirectoryRequirementId: string;
    targetLifecycle: "active" | "draining" | "inactive";
    oldRole: "owner" | "admin" | "member" | "observer" | null;
    newRole: "owner" | "admin" | "member" | "observer" | null;
    membershipRelationResource: InboxV2EntityKey;
    relationConversationResource: InboxV2EntityKey;
    relationEmployeeResource: InboxV2EntityKey;
    topologyResource: InboxV2EntityKey;
    topologyConversationResource: InboxV2EntityKey;
    successorOwnerRequirementId: string | null;
    successorOwner: InboxV2InternalOwnerSuccessorEvidence | null;
    ownerSet: InboxV2InternalOwnerSetEvidence;
    mutationRevisionChecks: readonly InboxV2KeyedRevisionCheck[];
    reason: string;
    audit: InboxV2PrivilegedMutationAuditEvidence;
  }>;
}>;

type InboxV2InternalBreakGlassReadGuard = Readonly<{
  profileId: "core:rbac.guard.internal_break_glass_read";
  conversationId: InboxV2ConversationId;
  exactGrantConversationId: InboxV2ConversationId;
  grantKind: "direct_grant" | "role_binding";
  reason: string;
  auditEventId: string;
  audit: InboxV2PrivilegedMutationAuditEvidence;
  accessMode: "read_only" | "read_write";
  validUntil: InboxV2PolicyTimestamp;
}>;

type InboxV2InternalBreakGlassIssueGuard = Readonly<{
  profileId: "core:rbac.guard.internal_break_glass_issue";
  conversationId: InboxV2ConversationId;
  requesterEmployeeId: InboxV2EmployeeId;
  approverEmployeeId: InboxV2EmployeeId;
  targetEmployeeId: InboxV2EmployeeId;
  approverEmployeeResource: InboxV2EntityKey;
  approverLifecycle: "active" | "draining" | "inactive";
  approverDirectoryRequirementId: string;
  approverGrantId: string;
  targetEmployeeResource: InboxV2EntityKey;
  targetLifecycle: "active" | "draining" | "inactive";
  targetDirectoryRequirementId: string;
  reason: string;
  alarmEventId: string | null;
  alarmEvidence: Readonly<{
    resource: InboxV2EntityKey;
    conversationResource: InboxV2EntityKey;
    actorEmployeeResource: InboxV2EntityKey;
    action: "internal_break_glass_issue";
    revisionChecks: readonly InboxV2KeyedRevisionCheck[];
  }> | null;
  validUntil: InboxV2PolicyTimestamp;
  approvalEvidence: Readonly<{
    resource: InboxV2EntityKey;
    conversationResource: InboxV2EntityKey;
    requesterEmployeeResource: InboxV2EntityKey;
    approverEmployeeResource: InboxV2EntityKey;
    targetEmployeeResource: InboxV2EntityKey;
    state: "approved" | "pending" | "revoked";
    revisionChecks: readonly InboxV2KeyedRevisionCheck[];
    notAfter: InboxV2PolicyTimestamp;
  }>;
  policyResource: InboxV2EntityKey;
  policyConversationResource: InboxV2EntityKey;
  policyBindingResource: InboxV2EntityKey;
  policyBindingPolicyResource: InboxV2EntityKey;
  policyBindingConversationResource: InboxV2EntityKey;
  policyDigest: string;
  maximumTtlSeconds: number;
  policyMaximumTtlSeconds: number;
  policyRevisionChecks: readonly InboxV2KeyedRevisionCheck[];
  policySelection: Readonly<{
    resource: InboxV2EntityKey;
    conversationResource: InboxV2EntityKey;
    selectedPolicyResource: InboxV2EntityKey;
    selectedBindingResource: InboxV2EntityKey;
    selectedPolicyDigest: string;
    selectedMaximumTtlSeconds: number;
    state: "active" | "inactive";
    revisionChecks: readonly InboxV2KeyedRevisionCheck[];
  }>;
}>;

type InboxV2NotificationSelfGuard = Readonly<{
  profileId: "core:rbac.guard.notification_self";
  targetResource: InboxV2EntityKey;
  targetEmployeeId: InboxV2EmployeeId;
  targetReadRequirementId: string;
}>;

type InboxV2NotificationTargetReadGuard = Readonly<{
  profileId: "core:rbac.guard.notification_target_read";
  targetResource: InboxV2EntityKey;
  targetEmployeeId: InboxV2EmployeeId;
  targetLifecycle: "active" | "draining" | "inactive";
  targetReadRequirementId: string;
}>;

type InboxV2ExternalReferencePortability =
  | "binding_only"
  | "external_thread"
  | "provider_global";

type InboxV2ProviderGlobalReferenceProof = Readonly<{
  resource: InboxV2EntityKey;
  sourceReferenceResource: InboxV2EntityKey;
  sourceOccurrenceResource: InboxV2EntityKey;
  originBindingResource: InboxV2EntityKey;
  originSourceAccountResource: InboxV2EntityKey;
  destinationBindingResource: InboxV2EntityKey;
  destinationSourceAccountResource: InboxV2EntityKey;
  providerContractResource: InboxV2EntityKey;
  originSourceAccountProviderContractResource: InboxV2EntityKey;
  destinationSourceAccountProviderContractResource: InboxV2EntityKey;
  revisionChecks: readonly InboxV2PolicyRevisionCheck[];
  resourceRevisionChecks: readonly InboxV2KeyedRevisionCheck[];
  notAfter: InboxV2PolicyTimestamp;
}>;

type InboxV2ExternalRouteOperationEvidence =
  | Readonly<{
      kind: "reply";
      mode: "new_response";
      sourceReadRequirementId: null;
      sourceReadResource: null;
      sourceTimelineItemResource: null;
      sourceOccurrenceResource: null;
      occurrenceTimelineItemResource: null;
      occurrenceReferenceResource: null;
      occurrenceBindingResource: null;
      sourceReferenceResource: null;
      referenceTimelineItemResource: null;
      referenceBindingResource: null;
      revisionChecks: readonly InboxV2PolicyRevisionCheck[];
      resourceRevisionChecks: readonly InboxV2KeyedRevisionCheck[];
    }>
  | Readonly<{
      kind: "reply";
      mode: "provider_reference";
      sourceReadRequirementId: string;
      sourceReadResource: InboxV2EntityKey;
      sourceTimelineItemResource: InboxV2EntityKey;
      sourceOccurrenceResource: InboxV2EntityKey;
      occurrenceTimelineItemResource: InboxV2EntityKey;
      occurrenceReferenceResource: InboxV2EntityKey;
      occurrenceBindingResource: InboxV2EntityKey;
      sourceReferenceResource: InboxV2EntityKey;
      referenceTimelineItemResource: InboxV2EntityKey;
      referenceBindingResource: InboxV2EntityKey;
      sourceBindingResource: InboxV2EntityKey;
      bindingConversationResource: InboxV2EntityKey;
      bindingExternalThreadResource: InboxV2EntityKey;
      bindingSourceAccountResource: InboxV2EntityKey;
      sourceExternalThreadResource: InboxV2EntityKey;
      portability: InboxV2ExternalReferencePortability;
      providerGlobalProof: InboxV2ProviderGlobalReferenceProof | null;
      revisionChecks: readonly InboxV2PolicyRevisionCheck[];
      resourceRevisionChecks: readonly InboxV2KeyedRevisionCheck[];
    }>
  | Readonly<{
      kind: "forward";
      mode: "copy" | "native";
      sourceContentBoundary: "external" | "internal" | "staff_only";
      sourceReadRequirementId: string;
      sourceReadResource: InboxV2EntityKey;
      sourceTimelineItemResource: InboxV2EntityKey;
      timelineItemRelationResource: InboxV2EntityKey;
      timelineItemRelationItemResource: InboxV2EntityKey;
      timelineItemConversationResource: InboxV2EntityKey;
      timelineItemRelationRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
      sourceResourceRevisionChecks: readonly InboxV2KeyedRevisionCheck[];
      sourceOccurrenceResource: InboxV2EntityKey | null;
      occurrenceTimelineItemResource: InboxV2EntityKey | null;
      occurrenceReferenceResource: InboxV2EntityKey | null;
      occurrenceBindingResource: InboxV2EntityKey | null;
      sourceReferenceResource: InboxV2EntityKey | null;
      referenceTimelineItemResource: InboxV2EntityKey | null;
      referenceBindingResource: InboxV2EntityKey | null;
      sourceBindingResource: InboxV2EntityKey | null;
      bindingConversationResource: InboxV2EntityKey | null;
      bindingExternalThreadResource: InboxV2EntityKey | null;
      bindingSourceAccountResource: InboxV2EntityKey | null;
      sourceAccountRequirementId: string | null;
      sourceExternalThreadResource: InboxV2EntityKey | null;
      portability:
        | "not_applicable"
        | "binding_only"
        | "external_thread"
        | "provider_global";
      providerGlobalProof: InboxV2ProviderGlobalReferenceProof | null;
      occurrenceRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
      nativeResourceRevisionChecks: readonly InboxV2KeyedRevisionCheck[];
    }>
  | Readonly<{
      kind: "multi_send";
      operationId: string;
      destinations: readonly Readonly<{
        targetResource: InboxV2EntityKey;
        externalThreadResource: InboxV2EntityKey;
        bindingResource: InboxV2EntityKey;
        sourceAccountResource: InboxV2EntityKey;
        bindingConversationResource: InboxV2EntityKey;
        bindingExternalThreadResource: InboxV2EntityKey;
        bindingSourceAccountResource: InboxV2EntityKey;
        conversationRequirementId: string;
        sourceRequirementId: string;
        operationRequirementId: string;
        revisionChecks: readonly InboxV2PolicyRevisionCheck[];
        capabilityId: "core:capability.source.multi_send";
        capabilityManifestResource: InboxV2EntityKey;
        capabilityManifestSourceAccountResource: InboxV2EntityKey;
        capabilityManifestBindingResource: InboxV2EntityKey;
        capabilityRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
        capabilityState: "supported" | "unsupported" | "expired";
        capabilityNotAfter: InboxV2PolicyTimestamp;
      }>[];
    }>
  | Readonly<{
      kind: "source_item_reply";
      sourceItemResource: InboxV2EntityKey;
      sourceItemReadRequirementId: string;
      replyDescriptorResource: InboxV2EntityKey;
      descriptorTargetResource: InboxV2EntityKey;
      descriptorSourceAccountResource: InboxV2EntityKey;
      descriptorRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
    }>
  | Readonly<{
      kind: "call_initiate";
      telephonyAccountResource: InboxV2EntityKey;
      accountRequirementId: string;
      callTargetResource: InboxV2EntityKey;
      targetRequirementId: string;
      clientConversationLinkResource: InboxV2EntityKey | null;
      linkClientResource: InboxV2EntityKey | null;
      linkConversationResource: InboxV2EntityKey | null;
      linkRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
      capabilityId: "core:capability.call.initiate";
      capabilityRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
    }>;

type InboxV2ExternalRouteGuard = Readonly<{
  profileId: "core:rbac.guard.external_route";
  authorizationMode: "operation" | "destination_authority";
  multiSendDestinationAuthority: Readonly<{
    operationId: string;
    targetResource: InboxV2EntityKey;
    bindingResource: InboxV2EntityKey;
    sourceAccountResource: InboxV2EntityKey;
  }> | null;
  operation: InboxV2ExternalRouteOperationEvidence;
  targetResource: InboxV2EntityKey;
  conversationResource: InboxV2EntityKey;
  bindingResource: InboxV2EntityKey;
  externalThreadResource: InboxV2EntityKey;
  bindingConversationResource: InboxV2EntityKey;
  bindingExternalThreadResource: InboxV2EntityKey;
  bindingSourceAccountResource: InboxV2EntityKey;
  routeRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
  conversationRequirementId: string;
  sourceAccountRequirementId: string;
  workRequirementId: string | null;
  overrideRequirementId: string | null;
  claimRequirementId: string | null;
  workItemId: InboxV2WorkItemId | null;
  workState:
    | "no_work_non_actionable"
    | "active"
    | "recovery_pending"
    | "terminal_actionable";
  actorRelation:
    | "primary_responsible"
    | "work_item_collaborator"
    | "scoped_supervisor_override"
    | "queue_member"
    | "structural_access_binding"
    | "exact_conversation_scope"
    | "conversation_collaborator"
    | "none";
  queueReplyPolicy:
    | "responsible_only"
    | "responsible_or_work_item_collaborator";
  replyPolicyEvidence: Readonly<{
    resource: InboxV2EntityKey;
    conversationResource: InboxV2EntityKey;
    workItemResource: InboxV2EntityKey | null;
    policy: "responsible_only" | "responsible_or_work_item_collaborator";
    revisionChecks: readonly InboxV2PolicyRevisionCheck[];
    notAfter: InboxV2PolicyTimestamp;
  }>;
  workAbsenceProof: Readonly<{
    resource: InboxV2EntityKey;
    conversationResource: InboxV2EntityKey;
    workItemCount: 0;
    expectedHighWater: string;
    currentHighWater: string;
    revisionChecks: readonly InboxV2PolicyRevisionCheck[];
  }> | null;
  conversationAccessBindingState: "active" | "missing" | "inactive";
  structuralAccessBinding: Readonly<{
    resource: InboxV2EntityKey;
    conversationResource: InboxV2EntityKey;
    scopeTargetResource: InboxV2EntityKey;
    state: "active" | "inactive";
    revisionChecks: readonly InboxV2PolicyRevisionCheck[];
    notAfter: InboxV2PolicyTimestamp;
  }> | null;
  sourceAccountId: InboxV2SourceAccountId;
  bindingSourceAccountId: InboxV2SourceAccountId;
  bindingState: "active" | "inactive" | "ambiguous";
  bindingGeneration: string;
  expectedBindingGeneration: string;
  capabilityState: "supported" | "unsupported" | "expired";
  capabilityId:
    | "core:capability.message.reply"
    | "core:capability.message.forward"
    | "core:capability.source.multi_send"
    | "core:capability.source_item.reply"
    | "core:capability.call.initiate";
  capabilityManifestResource: InboxV2EntityKey;
  capabilityManifestSourceAccountResource: InboxV2EntityKey;
  capabilityManifestBindingResource: InboxV2EntityKey;
  capabilityRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
  capabilityNotAfter: InboxV2PolicyTimestamp | null;
  claimMode: "none" | "atomic_claim_and_reply";
  overrideReason: string | null;
  routeFallbackRequested: boolean;
}>;

type InboxV2WorkItemStateGuard = Readonly<{
  profileId: "core:rbac.guard.work_item_state";
  authorizationMode: "operation" | "destination_authority";
  workItemId: InboxV2WorkItemId;
  operation:
    | "read"
    | "claim"
    | "assign"
    | "servicing_team_manage"
    | "release_self"
    | "release_other"
    | "transfer"
    | "close"
    | "reopen"
    | "override";
  workState: "active" | "recovery_pending" | "terminal_actionable" | "terminal";
  actorRelation:
    | "primary_responsible"
    | "work_item_collaborator"
    | "scoped_supervisor_override"
    | "queue_member"
    | "none";
  assignmentState: "unassigned" | "assigned" | "recovery_pending";
  expectedStateRevision: string;
  currentStateRevision: string;
  destinationRequirementIds: readonly string[];
  destinationResources: readonly InboxV2EntityKey[];
  authorityTargetResource: InboxV2EntityKey | null;
  authorityState: "eligible" | "ineligible" | null;
  eligibleEmployeeId: InboxV2EmployeeId | null;
  authorityRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
  assignmentEligibility?: Readonly<{
    employeeResource: InboxV2EntityKey;
    queueResource: InboxV2EntityKey;
    relationEmployeeResource: InboxV2EntityKey;
    relationQueueResource: InboxV2EntityKey;
    state: "eligible" | "ineligible";
    revisionChecks: readonly InboxV2PolicyRevisionCheck[];
  }>;
  servicingTeamChange?: Readonly<{
    workItemResource: InboxV2EntityKey;
    currentTeamResource: InboxV2EntityKey | null;
    requestedTeamResource: InboxV2EntityKey;
    relationWorkItemResource: InboxV2EntityKey;
    relationCurrentTeamResource: InboxV2EntityKey | null;
    relationRequestedTeamResource: InboxV2EntityKey;
    revisionChecks: readonly InboxV2PolicyRevisionCheck[];
    reason: string;
    auditEventResource: InboxV2EntityKey;
  }>;
  overrideReason: string | null;
  overrideRequirementId: string | null;
}>;

type InboxV2SourceAccountCapabilityManifest = Readonly<{
  resource: InboxV2EntityKey;
  capabilityId:
    | "core:capability.source_account.use"
    | "core:capability.source.dispatch.reroute";
  sourceAccountResource: InboxV2EntityKey;
  bindingResource: InboxV2EntityKey;
  routeResource: InboxV2EntityKey | null;
  manifestSourceAccountResource: InboxV2EntityKey;
  manifestBindingResource: InboxV2EntityKey;
  manifestRouteResource: InboxV2EntityKey | null;
  state: "supported" | "unsupported" | "expired";
  revisionChecks: readonly InboxV2KeyedRevisionCheck[];
  notAfter: InboxV2PolicyTimestamp;
}>;

type InboxV2SourceAccountRouteGuard = Readonly<{
  profileId: "core:rbac.guard.source_account_route";
  operation:
    | Readonly<{
        kind: "use";
        sourceAccountResource: InboxV2EntityKey;
        bindingResource: InboxV2EntityKey;
        capabilityManifest: InboxV2SourceAccountCapabilityManifest;
      }>
    | Readonly<{
        kind: "manage_route_policy";
        policyResource: InboxV2EntityKey;
        policySourceAccountResource: InboxV2EntityKey;
        policyRelationResource: InboxV2EntityKey;
        relationPolicyResource: InboxV2EntityKey;
        relationSourceAccountResource: InboxV2EntityKey;
        relationRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
        policyRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
        futureDispatchesOnly: true;
        pinnedDispatchMutationRequested: false;
        reason: string;
        auditEventId: string;
      }>
    | Readonly<{
        kind: "reroute_dispatch";
        dispatch: Readonly<{
          resource: InboxV2EntityKey;
          originalRouteResource: InboxV2EntityKey;
          requestedRouteResource: InboxV2EntityKey;
          relationResource: InboxV2EntityKey;
          relationDispatchResource: InboxV2EntityKey;
          relationOriginalRouteResource: InboxV2EntityKey;
          relationRequestedRouteResource: InboxV2EntityKey;
          state: "before_provider_io" | "provider_io_started";
          expectedStateRevision: string;
          currentStateRevision: string;
          revisionChecks: readonly InboxV2KeyedRevisionCheck[];
        }>;
        originalRoute: Readonly<{
          resource: InboxV2EntityKey;
          bindingResource: InboxV2EntityKey;
          sourceAccountResource: InboxV2EntityKey;
          routeBindingRelationResource: InboxV2EntityKey;
          relationRouteResource: InboxV2EntityKey;
          relationBindingResource: InboxV2EntityKey;
          conversationResource: InboxV2EntityKey;
          externalThreadResource: InboxV2EntityKey;
          bindingConversationResource: InboxV2EntityKey;
          bindingExternalThreadResource: InboxV2EntityKey;
          bindingSourceAccountResource: InboxV2EntityKey;
          relationRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
        }>;
        newRoute: Readonly<{
          resource: InboxV2EntityKey;
          bindingResource: InboxV2EntityKey;
          sourceAccountResource: InboxV2EntityKey;
          routeBindingRelationResource: InboxV2EntityKey;
          relationRouteResource: InboxV2EntityKey;
          relationBindingResource: InboxV2EntityKey;
          conversationResource: InboxV2EntityKey;
          externalThreadResource: InboxV2EntityKey;
          bindingConversationResource: InboxV2EntityKey;
          bindingExternalThreadResource: InboxV2EntityKey;
          bindingSourceAccountResource: InboxV2EntityKey;
          relationRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
        }>;
        originalCapabilityManifest: InboxV2SourceAccountCapabilityManifest;
        newCapabilityManifest: InboxV2SourceAccountCapabilityManifest;
        originalSourceRequirementId: string;
        newSourceRequirementId: string;
        dispatchState: "before_provider_io" | "provider_io_started";
        routeRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
        originalRouteHistoryRecorded: boolean;
        reason: string;
        auditEventId: string;
      }>;
  sourceAccountId: InboxV2SourceAccountId;
  routeSourceAccountId: InboxV2SourceAccountId;
  sourceState: "active" | "inactive";
  bindingState: "active" | "inactive" | "ambiguous";
  bindingGeneration: string;
  expectedBindingGeneration: string;
  capabilityState: "supported" | "unsupported" | "expired";
  capabilityNotAfter: InboxV2PolicyTimestamp | null;
}>;

type InboxV2FileParentGuard = Readonly<{
  profileId: "core:rbac.guard.file_parent_content";
  targetResource: InboxV2EntityKey;
  parentResource: InboxV2EntityKey;
  parentRelationResource: InboxV2EntityKey;
  relationFileResource: InboxV2EntityKey;
  relationParentResource: InboxV2EntityKey;
  relationBoundary: "external" | "staff_only" | "internal";
  parentRelationRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
  parentBoundary: "external" | "staff_only" | "internal";
  parentRequirementIds: readonly string[];
  retentionState: "available" | "expired" | "deleted";
  holdState: "none" | "active";
  holdIndexResource: InboxV2EntityKey;
  holdIndexFileResource: InboxV2EntityKey;
  holdRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
  operation: "view" | "upload" | "delete";
  storagePolicyState: "allowed" | "blocked";
  actorEmployeeId: InboxV2EmployeeId;
  uploaderEmployeeId: InboxV2EmployeeId | null;
  uploaderRelationResource: InboxV2EntityKey | null;
  uploaderRelationFileResource: InboxV2EntityKey | null;
  uploaderEmployeeResource: InboxV2EntityKey | null;
  uploaderRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
  moderationRequirementId: string | null;
  expectedFileRevision: string;
  currentFileRevision: string;
}>;

type InboxV2ClientPipelineTransitionMutation = Readonly<{
  kind: "pipeline_transition";
  clientResource: InboxV2EntityKey;
  oldStageResource: InboxV2EntityKey;
  newStageResource: InboxV2EntityKey;
  transitionPolicyResource: InboxV2EntityKey;
  policyClientResource: InboxV2EntityKey;
  policyOldStageResource: InboxV2EntityKey;
  policyNewStageResource: InboxV2EntityKey;
  policyState: "active" | "inactive";
  policyRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
  expectedClientRevision: string;
  currentClientRevision: string;
  reason: string;
  auditEventResource: InboxV2EntityKey;
  auditClientResource: InboxV2EntityKey;
  auditOldStageResource: InboxV2EntityKey;
  auditNewStageResource: InboxV2EntityKey;
}>;

type InboxV2ClientFieldValueType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "enum"
  | "json";

type InboxV2ClientFieldEditMutation = Readonly<{
  kind: "field_edit";
  clientResource: InboxV2EntityKey;
  fieldDefinitionResource: InboxV2EntityKey;
  fieldValueResource: InboxV2EntityKey;
  fieldValueClientResource: InboxV2EntityKey;
  fieldValueDefinitionResource: InboxV2EntityKey;
  definitionState: "active" | "inactive";
  definitionValueType: InboxV2ClientFieldValueType;
  submittedValueType: InboxV2ClientFieldValueType;
  valueValidationState: "validated" | "invalid";
  requestedValueDigest: string;
  validatedValueDigest: string;
  definitionRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
  expectedFieldValueRevision: string;
  currentFieldValueRevision: string;
  expectedClientRevision: string;
  currentClientRevision: string;
  reason: string;
  auditEventResource: InboxV2EntityKey;
  auditClientResource: InboxV2EntityKey;
  auditFieldDefinitionResource: InboxV2EntityKey;
  auditFieldValueResource: InboxV2EntityKey;
}>;

type InboxV2ClientAccessBindingTargetAuthority = Readonly<{
  side: "old" | "new";
  targetResource: InboxV2EntityKey;
  requirementId: string;
}>;

type InboxV2ClientAccessBindingChangeMutation = Readonly<{
  kind: "access_binding_change";
  operation: "add" | "replace" | "remove";
  clientResource: InboxV2EntityKey;
  bindingSetResource: InboxV2EntityKey;
  bindingSetClientResource: InboxV2EntityKey;
  oldBindingResource: InboxV2EntityKey | null;
  oldBindingClientResource: InboxV2EntityKey | null;
  oldBindingTargetResource: InboxV2EntityKey | null;
  newBindingResource: InboxV2EntityKey | null;
  newBindingClientResource: InboxV2EntityKey | null;
  newBindingTargetResource: InboxV2EntityKey | null;
  targetAuthorities: readonly InboxV2ClientAccessBindingTargetAuthority[];
  expectedBindingSetRevision: string;
  currentBindingSetRevision: string;
  oldRelationRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
  newRelationRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
  reason: string;
  auditEventResource: InboxV2EntityKey;
  auditClientResource: InboxV2EntityKey;
  auditOldTargetResource: InboxV2EntityKey | null;
  auditNewTargetResource: InboxV2EntityKey | null;
}>;

type InboxV2ClientAccessBindingTargetAuthorityMutation = Readonly<{
  kind: "access_binding_target_authority";
  clientResource: InboxV2EntityKey;
  bindingSetResource: InboxV2EntityKey;
  side: "old" | "new";
  targetResource: InboxV2EntityKey;
  relationClientResource: InboxV2EntityKey;
  relationTargetResource: InboxV2EntityKey;
  relationRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
}>;

type InboxV2ConversationClientLinkTarget = Readonly<{
  clientResource: InboxV2EntityKey;
  linkResource: InboxV2EntityKey;
  relationConversationResource: InboxV2EntityKey;
  relationClientResource: InboxV2EntityKey;
  expectedLinkRevision: string;
  currentLinkRevision: string;
  relationRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
  clientRequirementId: string;
}>;

type InboxV2ConversationClientLinksChangeMutation = Readonly<{
  kind: "conversation_client_links_change";
  operation: "add" | "remove";
  conversationResource: InboxV2EntityKey;
  manifestResource: InboxV2EntityKey;
  manifestConversationResource: InboxV2EntityKey;
  requestedTargetCount: number;
  manifestTargetCount: number;
  requestedTargetSetDigest: string;
  manifestTargetSetDigest: string;
  manifestRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
  targets: readonly InboxV2ConversationClientLinkTarget[];
  reason: string;
  auditEventResource: InboxV2EntityKey;
  auditConversationResource: InboxV2EntityKey;
  auditManifestResource: InboxV2EntityKey;
}>;

type InboxV2ClientLinkTargetAuthorityMutation = Readonly<{
  kind: "client_link_target_authority";
  operation: "add" | "remove";
  clientResource: InboxV2EntityKey;
  conversationResource: InboxV2EntityKey;
  linkResource: InboxV2EntityKey;
  relationConversationResource: InboxV2EntityKey;
  relationClientResource: InboxV2EntityKey;
  expectedLinkRevision: string;
  currentLinkRevision: string;
  relationRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
  manifestResource: InboxV2EntityKey;
  manifestConversationResource: InboxV2EntityKey;
  manifestTargetCount: number;
  manifestTargetSetDigest: string;
  manifestRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
  reason: string;
  auditEventResource: InboxV2EntityKey;
  auditConversationResource: InboxV2EntityKey;
  auditClientResource: InboxV2EntityKey;
  auditLinkResource: InboxV2EntityKey;
}>;

type InboxV2ClientMutationEvidence =
  | InboxV2ClientPipelineTransitionMutation
  | InboxV2ClientFieldEditMutation
  | InboxV2ClientAccessBindingChangeMutation
  | InboxV2ClientAccessBindingTargetAuthorityMutation
  | InboxV2ConversationClientLinksChangeMutation
  | InboxV2ClientLinkTargetAuthorityMutation;

type InboxV2ClientPathManifestEvidence = Readonly<{
  manifestResource: InboxV2EntityKey;
  manifestTargetResource: InboxV2EntityKey;
  manifestRevisionChecks: readonly InboxV2KeyedRevisionCheck[];
  pathRevisionChecks: readonly InboxV2KeyedRevisionCheck[];
}>;

type InboxV2ClientExactBindingPathEvidence = InboxV2ClientPathManifestEvidence &
  Readonly<{
    kind: "exact_client_binding";
    clientResource: InboxV2EntityKey;
    bindingResource: InboxV2EntityKey;
    bindingClientResource: InboxV2EntityKey;
    authorityResource: InboxV2EntityKey;
    bindingAuthorityResource: InboxV2EntityKey;
    state: "active" | "closed";
  }>;

type InboxV2ClientConversationLinkPathEvidence =
  InboxV2ClientPathManifestEvidence &
    Readonly<{
      kind: "active_conversation_link";
      clientResource: InboxV2EntityKey;
      conversationResource: InboxV2EntityKey;
      linkResource: InboxV2EntityKey;
      linkClientResource: InboxV2EntityKey;
      linkConversationResource: InboxV2EntityKey;
      state: "active" | "closed";
    }>;

type InboxV2ClientWorkPathBase = InboxV2ClientPathManifestEvidence &
  Readonly<{
    clientResource: InboxV2EntityKey;
    conversationResource: InboxV2EntityKey;
    linkResource: InboxV2EntityKey;
    linkClientResource: InboxV2EntityKey;
    linkConversationResource: InboxV2EntityKey;
    workHeadResource: InboxV2EntityKey;
    workHeadConversationResource: InboxV2EntityKey;
    workHeadWorkItemResource: InboxV2EntityKey;
    workItemResource: InboxV2EntityKey;
    workConversationRelationResource: InboxV2EntityKey;
    relationWorkItemResource: InboxV2EntityKey;
    relationConversationResource: InboxV2EntityKey;
    workState: "queued" | "assigned" | "in_progress" | "waiting";
    state: "active" | "closed";
  }>;

type InboxV2ClientWorkItemQueuePathEvidence = InboxV2ClientWorkPathBase &
  Readonly<{
    kind: "current_work_item_queue";
    queueResource: InboxV2EntityKey;
    queueRelationResource: InboxV2EntityKey;
    queueRelationWorkItemResource: InboxV2EntityKey;
    relationQueueResource: InboxV2EntityKey;
  }>;

type InboxV2ClientResponsiblePathEvidence = InboxV2ClientWorkPathBase &
  Readonly<{
    kind: "current_responsible";
    responsibleEmployeeResource: InboxV2EntityKey;
    responsibilityRelationResource: InboxV2EntityKey;
    responsibilityRelationWorkItemResource: InboxV2EntityKey;
    relationResponsibleEmployeeResource: InboxV2EntityKey;
  }>;

type InboxV2ClientOwnerPathEvidence = InboxV2ClientPathManifestEvidence &
  Readonly<{
    kind: "client_owner";
    clientResource: InboxV2EntityKey;
    ownerEmployeeResource: InboxV2EntityKey;
    ownershipRelationResource: InboxV2EntityKey;
    relationClientResource: InboxV2EntityKey;
    relationOwnerEmployeeResource: InboxV2EntityKey;
    state: "active" | "closed";
  }>;

type InboxV2ClientPathEvidence =
  | InboxV2ClientExactBindingPathEvidence
  | InboxV2ClientConversationLinkPathEvidence
  | InboxV2ClientWorkItemQueuePathEvidence
  | InboxV2ClientResponsiblePathEvidence
  | InboxV2ClientOwnerPathEvidence;

type InboxV2ClientContextGuardBase = Readonly<{
  profileId: "core:rbac.guard.client_context";
  target:
    | Readonly<{ kind: "client"; clientId: InboxV2ClientId }>
    | Readonly<{
        kind: "conversation";
        conversationId: InboxV2ConversationId;
      }>;
  contextualRequirementIds: readonly string[];
  linkedClientRequirementIds: readonly string[];
  mutation?: InboxV2ClientMutationEvidence;
  clientOwnerAssignment?: Readonly<{
    clientResource: InboxV2EntityKey;
    targetEmployeeResource: InboxV2EntityKey;
    targetEmployeeId: InboxV2EmployeeId;
    targetDirectoryRequirementId: string;
    targetLifecycle: "active" | "draining" | "inactive";
    eligibilityState: "eligible" | "ineligible";
    eligibilityResource: InboxV2EntityKey;
    eligibilityClientResource: InboxV2EntityKey;
    eligibilityEmployeeResource: InboxV2EntityKey;
    eligibilityRevisionChecks: readonly InboxV2KeyedRevisionCheck[];
    lifecycleRevisionChecks: readonly InboxV2KeyedRevisionCheck[];
    ownershipRelationResource: InboxV2EntityKey;
    ownershipRelationClientResource: InboxV2EntityKey;
    ownershipRelationEmployeeResource: InboxV2EntityKey;
    ownershipRevisionChecks: readonly InboxV2KeyedRevisionCheck[];
    expectedOwnershipRevision: string;
    currentOwnershipRevision: string;
    reason: string;
    auditEventResource: InboxV2EntityKey;
  }>;
}>;

type InboxV2ClientContextGuard = InboxV2ClientContextGuardBase &
  Readonly<
    | {
        accessPath: "exact_client_binding";
        pathEvidence: InboxV2ClientExactBindingPathEvidence;
      }
    | {
        accessPath: "active_conversation_link";
        pathEvidence: InboxV2ClientConversationLinkPathEvidence;
      }
    | {
        accessPath: "current_work_item_queue";
        pathEvidence: InboxV2ClientWorkItemQueuePathEvidence;
      }
    | {
        accessPath: "current_responsible";
        pathEvidence: InboxV2ClientResponsiblePathEvidence;
      }
    | {
        accessPath: "client_owner";
        pathEvidence: InboxV2ClientOwnerPathEvidence;
      }
  >;

type InboxV2IdentityLeafOperation<
  Kind extends "source_identity_use" | "evidence_view"
> = Readonly<{
  kind: Kind;
  actorEmployeeId: InboxV2EmployeeId;
  evidenceResource: InboxV2EntityKey;
  revisionChecks: readonly InboxV2PolicyRevisionCheck[];
}>;

type InboxV2IdentityManualSourceAuthority = Readonly<{
  actorEmployeeId: InboxV2EmployeeId;
  sourceIdentityResource: InboxV2EntityKey;
  sourceIdentityRequirementId: string;
  sourceIdentityRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
  reasonCodeId: string;
  auditEventResource: InboxV2EntityKey;
  auditActorEmployeeId: InboxV2EmployeeId;
  auditSourceIdentityResource: InboxV2EntityKey;
  auditTargetResource: InboxV2EntityKey;
  auditRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
}>;

type InboxV2IdentityClaimEvidence = Readonly<{
  claimPolicyResource: InboxV2EntityKey;
  claimPolicyState: "approved_active" | "draft" | "retired";
  claimPolicyVersion: string;
  evidencePolicyResource: InboxV2EntityKey;
  evidencePolicyVersion: string;
  evidenceResource: InboxV2EntityKey;
  evidenceSourceIdentityResource: InboxV2EntityKey;
  evidenceTargetResource: InboxV2EntityKey;
  sensitiveEvidenceIncluded: boolean;
  evidenceViewRequirementId: string | null;
  claimPolicyRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
  evidenceRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
  targetRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
  claimHeadResource: InboxV2EntityKey;
  claimHeadSourceIdentityResource: InboxV2EntityKey;
  currentClaimTargetResource: InboxV2EntityKey | null;
  expectedClaimVersion: string | null;
  currentClaimVersion: string | null;
  claimRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
}>;

type InboxV2IdentityClaimOperation =
  | (InboxV2IdentityManualSourceAuthority &
      InboxV2IdentityClaimEvidence &
      Readonly<{
        kind: "employee_claim_manage";
        oldTargetResource: InboxV2EntityKey | null;
        oldTargetRequirementId: string | null;
        newTargetResource: InboxV2EntityKey;
        newTargetEmployeeId: InboxV2EmployeeId;
        newTargetLifecycle: "active" | "draining" | "inactive";
      }>)
  | (InboxV2IdentityManualSourceAuthority &
      InboxV2IdentityClaimEvidence &
      Readonly<{
        kind: "client_contact_claim_manage";
        oldTargetResource: InboxV2EntityKey | null;
        oldTargetRequirementId: string | null;
        newTargetResource: InboxV2EntityKey;
      }>);

type InboxV2IdentityRevokeOperation = InboxV2IdentityManualSourceAuthority &
  Readonly<{
    kind: "claim_revoke";
    activeClaimResource: InboxV2EntityKey;
    claimSourceIdentityResource: InboxV2EntityKey;
    existingTargetResource: InboxV2EntityKey;
    claimTargetResource: InboxV2EntityKey;
    activeClaimRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
    targetRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
  }>;

type InboxV2IdentityScopeEvidence =
  | Readonly<{ kind: "provider" }>
  | Readonly<{
      kind: "source_connection" | "source_account";
      ownerResource: InboxV2EntityKey;
    }>;

type InboxV2IdentityRealmScopeBindingEvidence = Readonly<{
  resource: InboxV2EntityKey;
  identityResource: InboxV2EntityKey;
  realmResource: InboxV2EntityKey;
  scopeResource: InboxV2EntityKey;
  bindingIdentityResource: InboxV2EntityKey;
  bindingRealmResource: InboxV2EntityKey;
  bindingScopeResource: InboxV2EntityKey;
  realmId: string;
  realmVersion: string;
  scopeKind: InboxV2IdentityScopeEvidence["kind"];
  revisionChecks: readonly InboxV2KeyedRevisionCheck[];
}>;

type InboxV2IdentityResolutionEvidence =
  | Readonly<{ state: "unresolved" }>
  | Readonly<{ state: "claimed"; targetResource: InboxV2EntityKey }>
  | Readonly<{ state: "conflicting" }>;

type InboxV2IdentityMergeClaimTargetAuthority = Readonly<{
  kind: "employee" | "client_contact";
  targetResource: InboxV2EntityKey;
  targetRequirementId: string;
  authorityResource: InboxV2EntityKey;
  bindingResource: InboxV2EntityKey;
  bindingMutationResource: InboxV2EntityKey;
  bindingClaimHeadResource: InboxV2EntityKey;
  bindingTargetResource: InboxV2EntityKey;
  bindingAuthorityResource: InboxV2EntityKey;
  revisionChecks: readonly InboxV2KeyedRevisionCheck[];
}>;

type InboxV2IdentityMergeOperation = Readonly<{
  kind: "merge";
  actorEmployeeId: InboxV2EmployeeId;
  mutationResource: InboxV2EntityKey;
  mutationBindingResource: InboxV2EntityKey;
  bindingMutationResource: InboxV2EntityKey;
  bindingCanonicalIdentityResource: InboxV2EntityKey;
  bindingAliasIdentityResource: InboxV2EntityKey;
  mutationRevisionChecks: readonly InboxV2KeyedRevisionCheck[];
  canonicalIdentityResource: InboxV2EntityKey;
  canonicalIdentityRequirementId: string;
  aliasIdentityResource: InboxV2EntityKey;
  aliasIdentityRequirementId: string;
  canonicalRealmId: string;
  aliasRealmId: string;
  canonicalRealmVersion: string;
  aliasRealmVersion: string;
  canonicalizationVersion: string;
  aliasCanonicalizationVersion: string;
  canonicalScope: InboxV2IdentityScopeEvidence;
  aliasScope: InboxV2IdentityScopeEvidence;
  canonicalRealmScopeBinding: InboxV2IdentityRealmScopeBindingEvidence;
  aliasRealmScopeBinding: InboxV2IdentityRealmScopeBindingEvidence;
  canonicalResolution: InboxV2IdentityResolutionEvidence;
  aliasResolution: InboxV2IdentityResolutionEvidence;
  conflictState: "reviewed_clear" | "unreviewed" | "active_claim_conflict";
  conflictReviewResource: InboxV2EntityKey;
  reviewedCanonicalIdentityResource: InboxV2EntityKey;
  reviewedAliasIdentityResource: InboxV2EntityKey;
  mergeDirection: "alias_into_canonical";
  createsAcyclicAlias: boolean;
  canonicalIdentityRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
  aliasIdentityRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
  conflictReviewRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
  canonicalClaimHeadResource: InboxV2EntityKey;
  canonicalClaimHeadIdentityResource: InboxV2EntityKey;
  canonicalClaimHeadTargetResource: InboxV2EntityKey | null;
  canonicalClaimTargetAuthority: InboxV2IdentityMergeClaimTargetAuthority | null;
  canonicalClaimHeadRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
  aliasClaimHeadResource: InboxV2EntityKey;
  aliasClaimHeadIdentityResource: InboxV2EntityKey;
  aliasClaimHeadTargetResource: InboxV2EntityKey | null;
  aliasClaimTargetAuthority: InboxV2IdentityMergeClaimTargetAuthority | null;
  aliasClaimHeadRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
  aliasGraphResource: InboxV2EntityKey;
  aliasGraphCanonicalIdentityResource: InboxV2EntityKey;
  aliasGraphAliasIdentityResource: InboxV2EntityKey;
  expectedAliasGraphRevision: string;
  currentAliasGraphRevision: string;
  reasonCodeId: string;
  auditEventResource: InboxV2EntityKey;
  auditActorEmployeeId: InboxV2EmployeeId;
  auditCanonicalIdentityResource: InboxV2EntityKey;
  auditAliasIdentityResource: InboxV2EntityKey;
  auditRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
  resourceRevisionChecks: readonly InboxV2KeyedRevisionCheck[];
}>;

type InboxV2IdentityObservationReviewOperation =
  InboxV2IdentityManualSourceAuthority &
    Readonly<{
      kind: "observation_review";
      observationResource: InboxV2EntityKey;
      reviewedObservationResource: InboxV2EntityKey;
      annotationResource: InboxV2EntityKey;
      annotationOperation: "append_annotation";
      observationSourceIdentityResource: InboxV2EntityKey;
      writeSet: readonly (
        | "review_annotation"
        | "adapter_evidence"
        | "normalized_evidence"
      )[];
      observationRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
      annotationRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
    }>;

type InboxV2IdentityAutoResolutionPolicyRuleManifest = Readonly<{
  resource: InboxV2EntityKey;
  policyResource: InboxV2EntityKey;
  sourceIdentityResource: InboxV2EntityKey;
  evidenceResource: InboxV2EntityKey;
  claimTargetResource: InboxV2EntityKey;
  ruleId: string;
  ruleVersion: string;
  evidenceRuleId: string;
  evidenceRuleVersion: string;
  state: "approved_active" | "draft" | "retired";
  revisionChecks: readonly InboxV2KeyedRevisionCheck[];
  notAfter: InboxV2PolicyTimestamp;
}>;

type InboxV2IdentityEvidenceGuard = Readonly<{
  profileId: "core:rbac.guard.identity_evidence";
  targetResource: InboxV2EntityKey;
  evidenceState: "verified" | "unverified" | "conflicting";
  operation:
    | InboxV2IdentityClaimOperation
    | InboxV2IdentityRevokeOperation
    | InboxV2IdentityMergeOperation
    | InboxV2IdentityObservationReviewOperation
    | InboxV2IdentityLeafOperation<"source_identity_use">
    | InboxV2IdentityLeafOperation<"evidence_view">
    | Readonly<{
        kind: "auto_resolve";
        trustedServiceId: InboxV2TrustedServiceId;
        manualActorEmployeeId: null;
        resolutionDecisionResource: InboxV2EntityKey;
        resolutionRelationResource: InboxV2EntityKey;
        decisionSourceIdentityResource: InboxV2EntityKey;
        decisionClaimTargetResource: InboxV2EntityKey;
        decisionPolicyResource: InboxV2EntityKey;
        resolutionResourceRevisionChecks: readonly InboxV2KeyedRevisionCheck[];
        sourceIdentityResource: InboxV2EntityKey;
        evidenceResource: InboxV2EntityKey;
        claimTargetResource: InboxV2EntityKey;
        evidenceSourceIdentityResource: InboxV2EntityKey;
        evidenceClaimTargetResource: InboxV2EntityKey;
        evidenceKind: "verified_scope_correct";
        policyResource: InboxV2EntityKey;
        policyState: "approved_active" | "draft" | "retired";
        policyId: string;
        policyVersion: string;
        evidencePolicyId: string;
        evidencePolicyVersion: string;
        policyRuleManifest: InboxV2IdentityAutoResolutionPolicyRuleManifest;
        policyAllowedTargetKind: "employee" | "client_contact";
        targetKind: "employee" | "client_contact";
        targetEmployeeId: InboxV2EmployeeId | null;
        targetEmployeeLifecycle: "active" | "draining" | "inactive" | null;
        sourceIdentityResolution:
          | Readonly<{ state: "unresolved" }>
          | Readonly<{
              state: "claimed";
              activeClaimTargetResource: InboxV2EntityKey;
            }>
          | Readonly<{ state: "conflicting" }>;
        claimHeadResource: InboxV2EntityKey;
        claimHeadSourceIdentityResource: InboxV2EntityKey;
        currentClaimTargetResource: InboxV2EntityKey | null;
        expectedClaimVersion: string | null;
        currentClaimVersion: string | null;
        auditEventResource: InboxV2EntityKey;
        auditSourceIdentityResource: InboxV2EntityKey;
        auditClaimTargetResource: InboxV2EntityKey;
        auditTrustedServiceId: InboxV2TrustedServiceId;
        reasonCodeId: string;
        resolutionRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
        sourceIdentityRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
        evidenceRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
        targetRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
        policyRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
        claimRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
        auditRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
      }>;
}>;

type InboxV2ReportResourceGuard = Readonly<{
  profileId: "core:rbac.guard.report_resource_conjunction";
  targetResource: InboxV2EntityKey;
  accessLevel: "drilldown" | "pii" | "pii_export";
  layerRequirementIds: readonly string[];
  underlyingRequirementIds: readonly string[];
  underlyingResources: readonly InboxV2EntityKey[];
  manifestResource: InboxV2EntityKey;
  manifestTargetResource: InboxV2EntityKey;
  manifestRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
  scopeAppliedBeforeCountAndPagination: boolean;
  privateInternalIncluded: boolean;
  privateInternalRequirementIds: readonly string[];
}>;

type InboxV2AuditFacetGuard = Readonly<{
  profileId: "core:rbac.guard.audit_facets";
  targetResource: InboxV2EntityKey;
  facetRequirementIds: readonly string[];
  facetResources: readonly InboxV2EntityKey[];
  manifestResource: InboxV2EntityKey;
  manifestTargetResource: InboxV2EntityKey;
  manifestRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
  scopeAppliedBeforeCountAndPagination: boolean;
  piiRequested: boolean;
  piiRequirementId: string | null;
}>;

type InboxV2PrivacyPolicyGuard = Readonly<{
  profileId: "core:rbac.guard.privacy_policy_revision";
  targetResource: InboxV2EntityKey;
  policyId: string;
  governanceContextId: string;
  governanceContextResource: InboxV2EntityKey;
  governanceRelationResource: InboxV2EntityKey;
  governancePolicyResource: InboxV2EntityKey;
  governanceRelationContextResource: InboxV2EntityKey;
  governanceRevisionChecks: readonly InboxV2KeyedRevisionCheck[];
  expectedGovernanceRevision: string;
  currentGovernanceRevision: string;
  expectedPolicyRevision: string;
  currentPolicyRevision: string;
  phase: "view" | "preview" | "activate";
  actingEmployeeId: InboxV2EmployeeId;
  requesterEmployeeId: InboxV2EmployeeId;
  approverEmployeeId: InboxV2EmployeeId | null;
  activationEvidence: Readonly<{
    previewResource: InboxV2EntityKey;
    previewPolicyResource: InboxV2EntityKey;
    previewRequesterEmployeeResource: InboxV2EntityKey;
    previewGovernanceContextResource: InboxV2EntityKey;
    impactManifestResource: InboxV2EntityKey;
    impactManifestPolicyResource: InboxV2EntityKey;
    impactManifestPreviewResource: InboxV2EntityKey;
    impactManifestGovernanceContextResource: InboxV2EntityKey;
    approvalResource: InboxV2EntityKey;
    approvalPolicyResource: InboxV2EntityKey;
    approvalPreviewResource: InboxV2EntityKey;
    approvalImpactManifestResource: InboxV2EntityKey;
    approvalGovernanceContextResource: InboxV2EntityKey;
    approvalRequesterEmployeeResource: InboxV2EntityKey;
    approvalApproverEmployeeResource: InboxV2EntityKey;
    activationLedgerResource: InboxV2EntityKey;
    activationLedgerPolicyResource: InboxV2EntityKey;
    activationLedgerGovernanceContextResource: InboxV2EntityKey;
    activationLedgerGovernanceRelationResource: InboxV2EntityKey;
    activationLedgerPreviewResource: InboxV2EntityKey;
    activationLedgerImpactManifestResource: InboxV2EntityKey;
    activationLedgerApprovalResource: InboxV2EntityKey;
    approverDirectoryRequirementId: string;
    approverGrantId: string;
    approverLifecycle: "active" | "draining" | "inactive";
    approvalState: "approved" | "pending" | "revoked";
    revisionChecks: readonly InboxV2KeyedRevisionCheck[];
    coolingPeriodEndsAt: InboxV2PolicyTimestamp;
    approvalNotAfter: InboxV2PolicyTimestamp;
  }> | null;
  contentAuthorityRequested: false;
}>;

type InboxV2PrivacyRequestGuard = Readonly<{
  profileId: "core:rbac.guard.privacy_request_roots_revision";
  targetResource: InboxV2EntityKey;
  caseId: string;
  casePartyEvidence: Readonly<{
    bindingResource: InboxV2EntityKey;
    bindingCaseResource: InboxV2EntityKey;
    requesterEmployeeResource: InboxV2EntityKey;
    bindingRequesterEmployeeResource: InboxV2EntityKey;
    state: "immutable" | "revoked";
    revisionChecks: readonly InboxV2KeyedRevisionCheck[];
  }>;
  verificationState: "verified" | "unverified";
  expectedRootsRevision: string;
  currentRootsRevision: string;
  governanceContextResource: InboxV2EntityKey;
  expectedGovernanceRevision: string;
  currentGovernanceRevision: string;
  discoveryManifestResource: InboxV2EntityKey;
  discoveryManifestTargetResource: InboxV2EntityKey;
  discoveryManifestRevisionChecks: readonly InboxV2KeyedRevisionCheck[];
  discoveryManifestRootResources: readonly InboxV2EntityKey[];
  discoveryManifestMembershipRevisionChecks: readonly InboxV2KeyedRevisionCheck[];
  rootDecisions: readonly Readonly<{
    rootResource: InboxV2EntityKey;
    discoveryProofResource: InboxV2EntityKey;
    proofRequestResource: InboxV2EntityKey;
    proofRootResource: InboxV2EntityKey;
    proofRevisionChecks: readonly InboxV2KeyedRevisionCheck[];
    policyRuleId: string;
    policyRuleResource: InboxV2EntityKey;
    policyRuleRequestResource: InboxV2EntityKey;
    policyRuleRootResource: InboxV2EntityKey;
    policyRuleState: "active" | "inactive";
    policyRuleRevisionChecks: readonly InboxV2KeyedRevisionCheck[];
    expectedDecisionRevision: string;
    currentDecisionRevision: string;
    decisionState: "pending" | "approved" | "excluded";
  }>[];
  phase: "view" | "decide" | "execute";
  actingEmployeeId: InboxV2EmployeeId;
  requesterEmployeeId: InboxV2EmployeeId;
  deciderEmployeeId: InboxV2EmployeeId | null;
  executorEmployeeId: InboxV2EmployeeId | null;
  decisionLedger: Readonly<{
    resource: InboxV2EntityKey;
    caseResource: InboxV2EntityKey;
    requesterEmployeeResource: InboxV2EntityKey;
    deciderEmployeeResource: InboxV2EntityKey;
    rootManifestResource: InboxV2EntityKey;
    rootManifestDecisionResource: InboxV2EntityKey;
    rootManifestCaseResource: InboxV2EntityKey;
    rootManifestRootResources: readonly InboxV2EntityKey[];
    rootManifestEntries: readonly Readonly<{
      rootResource: InboxV2EntityKey;
      discoveryProofResource: InboxV2EntityKey;
      policyRuleId: string;
      policyRuleResource: InboxV2EntityKey;
      decisionState: "pending" | "approved" | "excluded";
      expectedDecisionRevision: string;
      currentDecisionRevision: string;
    }>[];
    rootManifestDecisionSetDigest: string;
    ledgerDecisionSetDigest: string;
    state: "pending" | "approved" | "rejected" | "revoked";
    revisionChecks: readonly InboxV2KeyedRevisionCheck[];
  }> | null;
  executorRelation: Readonly<{
    resource: InboxV2EntityKey;
    decisionResource: InboxV2EntityKey;
    caseResource: InboxV2EntityKey;
    executorEmployeeResource: InboxV2EntityKey;
    relationExecutorEmployeeResource: InboxV2EntityKey;
    state: "active" | "revoked";
    revisionChecks: readonly InboxV2KeyedRevisionCheck[];
  }> | null;
  contentAuthorityDerivedFromRequester: false;
}>;

type InboxV2PrivacySubjectEvidenceGuard = Readonly<{
  profileId: "core:rbac.guard.privacy_subject_evidence_roots";
  targetResource: InboxV2EntityKey;
  caseId: string;
  evidenceState: "verified" | "unverified";
  exactRootRequirementIds: readonly string[];
  exactRootResources: readonly InboxV2EntityKey[];
  manifestResource: InboxV2EntityKey;
  manifestTargetResource: InboxV2EntityKey;
  manifestRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
  manifestRootResources: readonly InboxV2EntityKey[];
  manifestMembershipRevisionChecks: readonly InboxV2KeyedRevisionCheck[];
  thirdPartyPolicy: "mask" | "exclude" | "allow_with_purpose";
  purpose: string | null;
  purposePolicy: Readonly<{
    resource: InboxV2EntityKey;
    targetResource: InboxV2EntityKey;
    approvedPurposeIds: readonly string[];
    revisionChecks: readonly InboxV2KeyedRevisionCheck[];
    notAfter: InboxV2PolicyTimestamp;
  }> | null;
}>;

type InboxV2PrivacyHoldGuard = Readonly<{
  profileId: "core:rbac.guard.privacy_hold_manifest_revision";
  targetResource: InboxV2EntityKey;
  holdId: string;
  manifestAuthenticity: "authentic" | "invalid" | "ambiguous";
  manifestResource: InboxV2EntityKey;
  manifestHoldResource: InboxV2EntityKey;
  rootResources: readonly InboxV2EntityKey[];
  manifestRootResources: readonly InboxV2EntityKey[];
  manifestRevisionChecks: readonly InboxV2KeyedRevisionCheck[];
  expectedManifestRevision: string;
  currentManifestRevision: string;
  lastReviewedAt: InboxV2PolicyTimestamp;
  nextReviewAt: InboxV2PolicyTimestamp;
  phase: "view" | "issue" | "release";
  actingEmployeeId: InboxV2EmployeeId;
  reason: string;
  reviewerEmployeeId: InboxV2EmployeeId | null;
  issuerEmployeeId: InboxV2EmployeeId | null;
  releaserEmployeeId: InboxV2EmployeeId | null;
  issuerEvidence: Readonly<{
    resource: InboxV2EntityKey;
    holdResource: InboxV2EntityKey;
    manifestResource: InboxV2EntityKey;
    manifestRootResources: readonly InboxV2EntityKey[];
    issuerEmployeeResource: InboxV2EntityKey;
    issuerEmployeeId: InboxV2EmployeeId;
    revisionChecks: readonly InboxV2KeyedRevisionCheck[];
  }> | null;
  approvalEvidence: Readonly<{
    resource: InboxV2EntityKey;
    holdResource: InboxV2EntityKey;
    manifestResource: InboxV2EntityKey;
    manifestRootResources: readonly InboxV2EntityKey[];
    approverEmployeeResource: InboxV2EntityKey;
    approverEmployeeId: InboxV2EmployeeId;
    approverLifecycle: "active" | "draining" | "inactive";
    approverDirectoryRequirementId: string;
    approverGrantId: string;
    state: "approved" | "pending" | "revoked";
    revisionChecks: readonly InboxV2KeyedRevisionCheck[];
    notAfter: InboxV2PolicyTimestamp;
  }> | null;
  contentAuthorityRequested: false;
}>;

type InboxV2PrivacyTenantExportGuard = Readonly<{
  profileId: "core:rbac.guard.privacy_tenant_export_high_water";
  targetResource: InboxV2EntityKey;
  exportId: string;
  manifestResource: InboxV2EntityKey;
  manifestExportResource: InboxV2EntityKey;
  manifestRequesterEmployeeResource: InboxV2EntityKey;
  manifestRequesterRelationResource: InboxV2EntityKey;
  graphResource: InboxV2EntityKey;
  manifestGraphResource: InboxV2EntityKey;
  rootResources: readonly InboxV2EntityKey[];
  manifestRootResources: readonly InboxV2EntityKey[];
  manifestRevisionChecks: readonly InboxV2KeyedRevisionCheck[];
  expectedGraphHighWater: string;
  currentGraphHighWater: string;
  actingEmployeeId: InboxV2EmployeeId;
  requesterEmployeeId: InboxV2EmployeeId;
  requesterEmployeeResource: InboxV2EntityKey;
  requesterRelationResource: InboxV2EntityKey;
  requesterRelationExportResource: InboxV2EntityKey;
  requesterRelationEmployeeResource: InboxV2EntityKey;
  requesterRevisionChecks: readonly InboxV2KeyedRevisionCheck[];
  approverEmployeeId: InboxV2EmployeeId;
  approvalResource: InboxV2EntityKey;
  approvalExportResource: InboxV2EntityKey;
  approvalManifestResource: InboxV2EntityKey;
  approvalRequesterEmployeeResource: InboxV2EntityKey;
  approvalRequesterRelationResource: InboxV2EntityKey;
  approvalGraphResource: InboxV2EntityKey;
  approvalGraphHighWater: string;
  approvalRootResources: readonly InboxV2EntityKey[];
  approvalPiiAuthorityResource: InboxV2EntityKey | null;
  approvalApproverEmployeeResource: InboxV2EntityKey;
  approverLifecycle: "active" | "draining" | "inactive";
  approverDirectoryRequirementId: string;
  approverGrantId: string;
  approvalState: "approved" | "pending" | "expired" | "revoked";
  approvalRevisionChecks: readonly InboxV2KeyedRevisionCheck[];
  approvalNotAfter: InboxV2PolicyTimestamp;
  authorizationAppliedBeforePaginationAndMaterialization: boolean;
  secretsIncluded: false;
  piiIncluded: boolean;
  piiAuthorityResource: InboxV2EntityKey | null;
  piiRequirementId: string | null;
}>;

type InboxV2PrivacyDeletionRootKind =
  | "sql"
  | "json_blob"
  | "object"
  | "index_cache"
  | "log_trace"
  | "backup"
  | "external_route";

type InboxV2PrivacyDeletionRootEvidence = Readonly<{
  resource: InboxV2EntityKey;
  rootKind: InboxV2PrivacyDeletionRootKind;
  boundary: "operated_data_plane" | "outside_operated_data_plane";
  relationResource: InboxV2EntityKey;
  relationPlanResource: InboxV2EntityKey;
  relationRootResource: InboxV2EntityKey;
  revisionChecks: readonly InboxV2KeyedRevisionCheck[];
}>;

type InboxV2PrivacyDeletionExternalProviderEvidence = Readonly<{
  sourceAccountResource: InboxV2EntityKey;
  bindingResource: InboxV2EntityKey;
  bindingRootResource: InboxV2EntityKey;
  bindingSourceAccountResource: InboxV2EntityKey;
  bindingRevisionChecks: readonly InboxV2KeyedRevisionCheck[];
  capabilityId: "core:capability.message.delete";
  capabilityState: "supported" | "unsupported" | "expired";
  capabilityManifestResource: InboxV2EntityKey;
  capabilityManifestSourceAccountResource: InboxV2EntityKey;
  capabilityManifestBindingResource: InboxV2EntityKey;
  capabilityManifestHandlerResource: InboxV2EntityKey;
  capabilityRevisionChecks: readonly InboxV2KeyedRevisionCheck[];
  capabilityNotAfter: InboxV2PolicyTimestamp;
  sourceAccountUseRequirementId: string;
}>;

type InboxV2PrivacyDeletionHandlerEvidence = Readonly<{
  resource: InboxV2EntityKey;
  rootResource: InboxV2EntityKey;
  relationResource: InboxV2EntityKey;
  relationPlanResource: InboxV2EntityKey;
  relationRootResource: InboxV2EntityKey;
  relationHandlerResource: InboxV2EntityKey;
  revisionChecks: readonly InboxV2KeyedRevisionCheck[];
}> &
  Readonly<
    | {
        surfaceKind: Exclude<InboxV2PrivacyDeletionRootKind, "external_route">;
        executionMode: "none" | "operated_io";
        externalOutcome: null;
        externalProvider: null;
      }
    | {
        surfaceKind: "external_route";
        executionMode: "none" | "provider_io" | "external_residual_only";
        externalOutcome: "not_started" | "requested" | "unsupported";
        externalProvider: InboxV2PrivacyDeletionExternalProviderEvidence | null;
      }
  >;

type InboxV2PrivacyDeletionGuard = Readonly<{
  profileId: "core:rbac.guard.privacy_deletion_plan_revisions";
  targetResource: InboxV2EntityKey;
  deletionPlanId: string;
  expectedPlanRevision: string;
  currentPlanRevision: string;
  manifestResource: InboxV2EntityKey;
  manifestTargetResource: InboxV2EntityKey;
  manifestRequesterEmployeeResource: InboxV2EntityKey;
  manifestRequesterRelationResource: InboxV2EntityKey;
  manifestRootResources: readonly InboxV2EntityKey[];
  manifestHandlerResources: readonly InboxV2EntityKey[];
  manifestRevisionChecks: readonly InboxV2KeyedRevisionCheck[];
  roots: readonly InboxV2PrivacyDeletionRootEvidence[];
  handlers: readonly InboxV2PrivacyDeletionHandlerEvidence[];
  requesterEmployeeResource: InboxV2EntityKey;
  requesterRelationResource: InboxV2EntityKey;
  requesterRelationPlanResource: InboxV2EntityKey;
  requesterRelationEmployeeResource: InboxV2EntityKey;
  requesterRevisionChecks: readonly InboxV2KeyedRevisionCheck[];
  holdIndexResource: InboxV2EntityKey;
  holdIndexPlanResource: InboxV2EntityKey;
  holdIndexRootResources: readonly InboxV2EntityKey[];
  holdState: "clear" | "active" | "ambiguous";
  holdRevisionChecks: readonly InboxV2KeyedRevisionCheck[];
  holdFenceCheckedAt: InboxV2PolicyTimestamp;
  holdFenceNotAfter: InboxV2PolicyTimestamp;
  phase: "preview" | "approve" | "execute";
  actingEmployeeId: InboxV2EmployeeId;
  requesterEmployeeId: InboxV2EmployeeId;
  approverEmployeeId: InboxV2EmployeeId | null;
  executorEmployeeId: InboxV2EmployeeId | null;
  approvalEvidence: Readonly<{
    resource: InboxV2EntityKey;
    planResource: InboxV2EntityKey;
    manifestResource: InboxV2EntityKey;
    requesterEmployeeResource: InboxV2EntityKey;
    requesterRelationResource: InboxV2EntityKey;
    approverEmployeeResource: InboxV2EntityKey;
    approverEmployeeId: InboxV2EmployeeId;
    approverLifecycle: "active" | "draining" | "inactive";
    approverDirectoryRequirementId: string;
    approverGrantId: string;
    state: "approved" | "pending" | "revoked";
    revisionChecks: readonly InboxV2KeyedRevisionCheck[];
    notAfter: InboxV2PolicyTimestamp;
  }> | null;
  coolingPeriodEndsAt: InboxV2PolicyTimestamp;
  ioRequested: boolean;
}>;

type InboxV2PrivacyAuditGuard = Readonly<{
  profileId: "core:rbac.guard.privacy_audit_facets";
  targetResource: InboxV2EntityKey;
  accessLevel: "view" | "export";
  actorFacet: string | null;
  targetFacet: string | null;
  scopeFacet: string | null;
  facetRequirementIds: readonly string[];
  facetResources: readonly InboxV2EntityKey[];
  manifestResource: InboxV2EntityKey;
  manifestTargetResource: InboxV2EntityKey;
  manifestRevisionChecks: readonly InboxV2PolicyRevisionCheck[];
  piiRequested: boolean;
  piiRequirementId: string | null;
  piiAuthorityEvidence: Readonly<{
    bindingResource: InboxV2EntityKey;
    auditQueryResource: InboxV2EntityKey;
    auditManifestResource: InboxV2EntityKey;
    reportQueryResource: InboxV2EntityKey;
    reportManifestResource: InboxV2EntityKey;
    facetResources: readonly InboxV2EntityKey[];
    revisionChecks: readonly InboxV2KeyedRevisionCheck[];
  }> | null;
  actingEmployeeId: InboxV2EmployeeId;
  auditAccessEventId: string | null;
  auditAccessEventResource: InboxV2EntityKey;
  auditEventActorEmployeeResource: InboxV2EntityKey;
  auditEventAction: "privacy_audit_view" | "privacy_audit_export";
  auditEventTargetResource: InboxV2EntityKey;
  auditEventRevisionChecks: readonly InboxV2KeyedRevisionCheck[];
  scopeAppliedBeforeCountAndPagination: boolean;
}>;

export type InboxV2PolicyGuardEvidence =
  | InboxV2CanonicalResourceGuard
  | InboxV2InternalMembershipGuard
  | InboxV2InternalBreakGlassReadGuard
  | InboxV2InternalBreakGlassIssueGuard
  | InboxV2NotificationSelfGuard
  | InboxV2NotificationTargetReadGuard
  | InboxV2ExternalRouteGuard
  | InboxV2WorkItemStateGuard
  | InboxV2SourceAccountRouteGuard
  | InboxV2FileParentGuard
  | InboxV2ClientContextGuard
  | InboxV2IdentityEvidenceGuard
  | InboxV2ReportResourceGuard
  | InboxV2AuditFacetGuard
  | InboxV2PrivacyPolicyGuard
  | InboxV2PrivacyRequestGuard
  | InboxV2PrivacySubjectEvidenceGuard
  | InboxV2PrivacyHoldGuard
  | InboxV2PrivacyTenantExportGuard
  | InboxV2PrivacyDeletionGuard
  | InboxV2PrivacyAuditGuard;

export type InboxV2AuthorizationRequirement = Readonly<{
  id: string;
  permissionId: string;
  resource: InboxV2EntityKey;
  resourceAccessRevision: string;
  expectedResourceAccessRevision: string | null;
  scopeFacts: readonly InboxV2CanonicalScopeFact[];
  revisionChecks: readonly InboxV2PolicyRevisionCheck[];
  guard: InboxV2PolicyGuardEvidence;
  visibility: "primary" | "secondary_hidden";
  authorizationSubject:
    | Readonly<{ kind: "actor" }>
    | Readonly<{
        kind: "independent_employee";
        employee: InboxV2EmployeeReference;
        lifecycle: "active" | "draining" | "inactive";
        authorization: InboxV2AuthorizationEpochSnapshot;
        currentAuthorization: InboxV2CurrentAuthorizationFacts;
        notAfter: InboxV2PolicyTimestamp;
      }>;
}>;

export type InboxV2AuthorizationInternalReason =
  | "allowed"
  | "empty_plan"
  | "principal_invalid"
  | "principal_inactive"
  | "tenant_boundary_mismatch"
  | "authorization_epoch_stale"
  | "temporal_boundary_reached"
  | "unknown_permission"
  | "illegal_principal"
  | "illegal_scope"
  | "missing_permission"
  | "scope_not_matched"
  | "canonical_relation_not_matched"
  | "structural_path_missing"
  | "secondary_resource_denied"
  | "state_guard_failed"
  | "revision_guard_failed"
  | "route_guard_failed"
  | "hard_boundary_denied"
  | "separation_of_duties_denied"
  | "hidden_target";

export type InboxV2AuthorizationPublicErrorCode =
  | "auth.session_invalid"
  | "auth.employee_inactive"
  | "auth.access_revision_stale"
  | "resource.not_found"
  | "permission.denied"
  | "revision.conflict"
  | "conversation.internal_membership_required"
  | "message.staff_only_route_forbidden"
  | "route.forbidden"
  | "route.inactive"
  | "route.binding_changed"
  | "work.state_changed"
  | "file.parent_forbidden"
  | "identity.evidence_required"
  | "identity.claim_self_forbidden"
  | "report.scope_forbidden"
  | "privacy.scope_ambiguous"
  | "privacy.approval_required"
  | "privacy.separation_of_duties"
  | "privacy.revision_changed"
  | "privacy.cooling_period_active"
  | "privacy.hold_active";

type InboxV2RequirementAllow = Readonly<{
  outcome: "allowed";
  requirementId: string;
  permissionId: InboxV2PermissionId;
  resource: InboxV2EntityKey;
  matchedGrantId: string;
  matchedScope: InboxV2PermissionScope;
  notAfter: InboxV2PolicyTimestamp;
  authorizationSubjectKind: "actor" | "independent_employee" | "supporting";
}>;

type InboxV2RequirementDeny = Readonly<{
  outcome: "denied";
  requirementId: string;
  reason: InboxV2AuthorizationInternalReason;
  publicErrorCode: InboxV2AuthorizationPublicErrorCode;
}>;

export type InboxV2RequirementDecision =
  | InboxV2RequirementAllow
  | InboxV2RequirementDeny;

export type InboxV2AuthorizationDecision =
  | Readonly<{
      outcome: "allowed";
      tenantId: InboxV2TenantId;
      evaluatedAt: InboxV2PolicyTimestamp;
      notAfter: InboxV2PolicyTimestamp;
      nextAuthorizationBoundary: InboxV2PolicyTimestamp;
      requirements: readonly InboxV2RequirementAllow[];
      diagnostics: Readonly<{
        reason: "allowed";
        evaluatedRequirementCount: number;
      }>;
    }>
  | Readonly<{
      outcome: "denied";
      tenantId: InboxV2TenantId;
      evaluatedAt: InboxV2PolicyTimestamp;
      /** Server-derived from the evaluated permission plan, never a request hint. */
      securityDenialAction: InboxV2SecurityDenialAction;
      /** Authenticated attribution; null means use a configured deployment bucket. */
      securityDenialTenantId: InboxV2TenantId | null;
      securityDenialPrincipalClass:
        | "employee"
        | "trusted_service"
        | "invalid_or_anonymous";
      publicErrorCode: InboxV2AuthorizationPublicErrorCode;
      diagnostics: Readonly<{
        reason: InboxV2AuthorizationInternalReason;
        failedRequirementId: string | null;
      }>;
    }>;

export type InboxV2PublicAuthorizationDecision =
  | Readonly<{
      outcome: "allowed";
      notAfter: InboxV2PolicyTimestamp;
    }>
  | Readonly<{
      outcome: "denied";
      errorCode: InboxV2AuthorizationPublicErrorCode;
    }>;

export type InboxV2AuthorizationPlanInput = Readonly<{
  tenantId: InboxV2TenantId;
  evaluatedAt: InboxV2PolicyTimestamp;
  principal: InboxV2PolicyPrincipal;
  currentAuthorization: InboxV2CurrentAuthorizationFacts;
  grants: readonly InboxV2PolicyGrant[];
  requirements: readonly InboxV2AuthorizationRequirement[];
}>;

export type InboxV2CurrentAuthorizationFacts = Readonly<{
  tenantId: InboxV2TenantId;
  principal:
    | Readonly<{ kind: "employee"; employeeId: InboxV2EmployeeId }>
    | Readonly<{
        kind: "trusted_service";
        trustedServiceId: InboxV2TrustedServiceId;
      }>;
  authorizationEpoch: InboxV2AuthorizationEpoch;
  dependencies: InboxV2AuthorizationDependencyVector;
}>;

export type InboxV2DerivedCapability = Readonly<{
  kind: "inbox_v2_derived_capability";
  tenantId: InboxV2TenantId;
  requirementId: string;
  permissionId: InboxV2PermissionId;
  resource: InboxV2EntityKey;
  scopeType: InboxV2PermissionScopeType;
  notAfter: InboxV2PolicyTimestamp;
}>;

type EvaluationContext = Readonly<{
  input: InboxV2AuthorizationPlanInput;
  principalKind: "employee" | "trusted_service";
  principalId: string;
  principalNotAfter: InboxV2PolicyTimestamp;
  employeeId: InboxV2EmployeeId | null;
  currentAuthorization: InboxV2CurrentAuthorizationFacts;
  authorizationSubjectKind: "actor" | "independent_employee";
}>;

type GuardResult =
  | Readonly<{
      outcome: "allowed";
      boundaries: readonly InboxV2PolicyTimestamp[];
      companionRequirementIds: readonly string[];
    }>
  | Readonly<{
      outcome: "denied";
      reason: InboxV2AuthorizationInternalReason;
      publicErrorCode: InboxV2AuthorizationPublicErrorCode;
    }>;

type ScopeFailureReason =
  | "scope_not_matched"
  | "canonical_relation_not_matched"
  | "structural_path_missing"
  | "revision_guard_failed";

type ScopeMatch =
  | Readonly<{
      matched: true;
      boundary: InboxV2PolicyTimestamp | null;
    }>
  | Readonly<{
      matched: false;
      reason: ScopeFailureReason;
    }>;

export function evaluateInboxV2AuthorizationPlan(
  input: InboxV2AuthorizationPlanInput
): InboxV2AuthorizationDecision {
  if (!isTimestamp(input.evaluatedAt)) {
    return denyPlan(input, "principal_invalid", "auth.session_invalid", null);
  }

  if (input.requirements.length === 0) {
    return denyPlan(input, "empty_plan", "permission.denied", null);
  }

  const principal = evaluatePrincipal(input);
  if (principal.outcome === "denied") {
    return denyPlan(input, principal.reason, principal.publicErrorCode, null);
  }

  const requirementIds = new Set<string>();
  for (const requirement of input.requirements) {
    if (requirement.id.length === 0 || requirementIds.has(requirement.id)) {
      return denyPlan(input, "hard_boundary_denied", "permission.denied", null);
    }
    requirementIds.add(requirement.id);
  }

  const context: EvaluationContext = Object.freeze({
    input,
    principalKind: principal.principalKind,
    principalId: principal.principalId,
    principalNotAfter: principal.notAfter,
    employeeId:
      input.principal.kind === "employee" ? input.principal.employee.id : null,
    currentAuthorization: input.currentAuthorization,
    authorizationSubjectKind: "actor"
  });
  const localDecisions = new Map<string, InboxV2RequirementDecision>();
  const companionIds = new Map<string, readonly string[]>();

  for (const requirement of input.requirements) {
    const result = evaluateRequirement(context, requirement);
    localDecisions.set(requirement.id, result.decision);
    companionIds.set(requirement.id, result.companionRequirementIds);
  }

  const referencedCompanionIds = new Set(
    [...companionIds.values()].flatMap((ids) => [...ids])
  );
  if (
    [...referencedCompanionIds].some((id) => {
      const companion = input.requirements.find(
        (requirement) => requirement.id === id
      );
      return (
        companion === undefined || companion.visibility !== "secondary_hidden"
      );
    })
  ) {
    return denyPlan(
      input,
      "secondary_resource_denied",
      "resource.not_found",
      null
    );
  }

  const independentSubjectsBound = independentAuthorizationSubjectsAreBound(
    input.requirements,
    companionIds
  );
  const supportingAuthoritiesBound =
    supportingWorkDestinationAuthoritiesAreBound(
      input.requirements,
      companionIds
    );
  if (!supportingAuthoritiesBound) {
    return denyPlan(
      input,
      "secondary_resource_denied",
      "resource.not_found",
      null
    );
  }
  if (!independentSubjectsBound) {
    return denyPlan(input, "hard_boundary_denied", "permission.denied", null);
  }

  // Hidden secondary targets are collapsed before any visible failure so the
  // result cannot be used to probe which member of a multi-target action exists.
  for (const requirement of input.requirements) {
    const decision = localDecisions.get(requirement.id)!;
    if (
      requirement.visibility === "secondary_hidden" &&
      decision.outcome === "denied"
    ) {
      return collapseRequirementDeny(input, requirement, decision);
    }
  }

  for (const requirement of input.requirements) {
    const decision = localDecisions.get(requirement.id)!;
    if (decision.outcome === "denied") {
      return collapseRequirementDeny(input, requirement, decision);
    }
  }

  for (const requirement of input.requirements) {
    const declaredCompanions = companionIds.get(requirement.id) ?? [];
    if (
      new Set(declaredCompanions).size !== declaredCompanions.length ||
      declaredCompanions.includes(requirement.id)
    ) {
      return collapseRequirementDeny(
        input,
        requirement,
        Object.freeze({
          outcome: "denied",
          requirementId: requirement.id,
          reason: "hard_boundary_denied",
          publicErrorCode: "permission.denied"
        })
      );
    }
  }
  if (hasCompanionCycle(companionIds)) {
    return denyPlan(input, "hard_boundary_denied", "permission.denied", null);
  }

  for (const requirement of input.requirements) {
    if (
      !areCompanionRequirementsSemanticallyValid(
        requirement,
        input.requirements,
        localDecisions
      )
    ) {
      return collapseRequirementDeny(
        input,
        requirement,
        Object.freeze({
          outcome: "denied",
          requirementId: requirement.id,
          reason: "secondary_resource_denied",
          publicErrorCode: "permission.denied"
        })
      );
    }

    for (const companionId of companionIds.get(requirement.id) ?? []) {
      const companion = localDecisions.get(companionId);
      if (companion?.outcome !== "allowed") {
        const companionRequirement = input.requirements.find(
          (candidate) => candidate.id === companionId
        );
        if (companionRequirement?.visibility === "secondary_hidden") {
          return denyPlan(
            input,
            "secondary_resource_denied",
            "resource.not_found",
            null
          );
        }
        return collapseRequirementDeny(
          input,
          requirement,
          Object.freeze({
            outcome: "denied",
            requirementId: requirement.id,
            reason: "secondary_resource_denied",
            publicErrorCode: "permission.denied"
          })
        );
      }
    }
  }

  const allowedRequirements = input.requirements.map((requirement) => {
    const decision = localDecisions.get(
      requirement.id
    ) as InboxV2RequirementAllow;
    return requirement.authorizationSubject.kind === "actor" &&
      referencedCompanionIds.has(requirement.id)
      ? Object.freeze({
          ...decision,
          authorizationSubjectKind: "supporting" as const
        })
      : decision;
  });
  const notAfter = earliestTimestamp([
    principal.notAfter,
    ...allowedRequirements.map((decision) => decision.notAfter)
  ]);

  if (notAfter === null || !isStrictlyAfter(notAfter, input.evaluatedAt)) {
    return denyPlan(
      input,
      "temporal_boundary_reached",
      "auth.access_revision_stale",
      null
    );
  }

  return Object.freeze({
    outcome: "allowed",
    tenantId: input.tenantId,
    evaluatedAt: input.evaluatedAt,
    notAfter,
    nextAuthorizationBoundary: notAfter,
    requirements: Object.freeze(allowedRequirements),
    diagnostics: Object.freeze({
      reason: "allowed",
      evaluatedRequirementCount: allowedRequirements.length
    })
  });
}

function areCompanionRequirementsSemanticallyValid(
  requirement: InboxV2AuthorizationRequirement,
  requirements: readonly InboxV2AuthorizationRequirement[],
  decisions: ReadonlyMap<string, InboxV2RequirementDecision>
): boolean {
  const byId = (id: string): InboxV2AuthorizationRequirement | undefined =>
    requirements.find((candidate) => candidate.id === id);
  const isAllowed = (id: string): boolean =>
    decisions.get(id)?.outcome === "allowed";
  const isAllowedPermission = (
    id: string,
    predicate: (permissionId: string) => boolean,
    allowIndependentEmployee = false
  ): boolean => {
    const companion = byId(id);
    return (
      companion !== undefined &&
      isAllowed(id) &&
      (allowIndependentEmployee ||
        companion.authorizationSubject.kind === "actor") &&
      predicate(companion.permissionId)
    );
  };
  const { guard } = requirement;

  switch (guard.profileId) {
    case "core:rbac.guard.canonical_resource": {
      if (requirement.permissionId.startsWith("core:message.staff_note.")) {
        if (guard.companionRequirementIds.length !== 1) return false;
        const companion = byId(guard.companionRequirementIds[0]!);
        if (
          companion === undefined ||
          !isAllowed(companion.id) ||
          companion.authorizationSubject.kind !== "actor" ||
          companion.permissionId !== "core:conversation.read" ||
          !sameEntityKey(companion.resource, requirement.resource)
        ) {
          return false;
        }
      } else if (!guard.companionRequirementIds.every((id) => isAllowed(id))) {
        return false;
      }

      const action = guard.action;
      if (action.kind === "inbox_entry_read") {
        if (action.entryBoundary !== "internal_metadata") {
          return action.internalReadRequirementId === null;
        }
        if (action.internalReadRequirementId === null) return false;
        const internalRead = byId(action.internalReadRequirementId);
        return (
          internalRead !== undefined &&
          isAllowedPermission(
            internalRead.id,
            (permissionId) => permissionId === "core:conversation.internal.read"
          ) &&
          sameEntityKey(internalRead.resource, action.targetResource)
        );
      }
      if (action.kind === "delegation_change") {
        const subjectDirectory = byId(action.subjectDirectoryRequirementId);
        const subjectDirectoryDecision = decisions.get(
          action.subjectDirectoryRequirementId
        );
        return (
          action.validUntil !== null &&
          subjectDirectory !== undefined &&
          subjectDirectoryDecision?.outcome === "allowed" &&
          !isStrictlyAfter(
            action.validUntil,
            subjectDirectoryDecision.notAfter
          ) &&
          isAllowedPermission(
            subjectDirectory.id,
            (permissionId) => permissionId === "core:employee.directory.view"
          ) &&
          sameEntityKey(
            subjectDirectory.resource,
            action.subjectEmployeeResource
          ) &&
          action.delegatedAuthorities.every((authority) => {
            const companion = byId(authority.requirementId);
            const decision = decisions.get(authority.requirementId);
            return (
              companion !== undefined &&
              companion.authorizationSubject.kind === "actor" &&
              decision?.outcome === "allowed" &&
              action.validUntil !== null &&
              !isStrictlyAfter(action.validUntil, decision.notAfter) &&
              companion.permissionId === authority.permissionId &&
              scopeContains(decision.matchedScope, authority.requestedScope)
            );
          })
        );
      }
      if (action.kind === "internal_conversation_create") {
        return action.members.every((member) => {
          const directory = byId(member.directoryRequirementId);
          return (
            directory !== undefined &&
            isAllowedPermission(
              directory.id,
              (permissionId) => permissionId === "core:employee.directory.view"
            ) &&
            sameEntityKey(directory.resource, member.employeeResource)
          );
        });
      }
      if (action.kind === "conversation_collaborator_change") {
        const targetDirectory = byId(action.targetDirectoryRequirementId);
        return (
          targetDirectory !== undefined &&
          isAllowedPermission(
            targetDirectory.id,
            (permissionId) => permissionId === "core:employee.directory.view"
          ) &&
          sameEntityKey(targetDirectory.resource, action.targetEmployeeResource)
        );
      }
      if (action.kind === "message_author_action") {
        const reads = action.contentReadRequirementIds.map(byId);
        const permissionIds = reads.map((read) => read?.permissionId);
        const readsValid =
          new Set(action.contentReadRequirementIds).size ===
            action.contentReadRequirementIds.length &&
          reads.every(
            (read) =>
              read !== undefined &&
              isAllowed(read.id) &&
              sameEntityKey(read.resource, action.topologyConversationResource)
          ) &&
          (action.contentBoundary === "external"
            ? action.contentReadRequirementIds.length === 1 &&
              permissionIds[0] === "core:conversation.read"
            : action.contentBoundary === "internal"
              ? action.contentReadRequirementIds.length === 1 &&
                permissionIds[0] === "core:conversation.internal.read"
              : action.contentReadRequirementIds.length === 2 &&
                permissionIds.includes("core:conversation.read") &&
                permissionIds.includes("core:message.staff_note.read"));
        if (!readsValid) return false;
        if (action.originalRouteRequirementId === null) return true;
        const route = byId(action.originalRouteRequirementId);
        return (
          route !== undefined &&
          action.originalSourceAccountResource !== null &&
          isAllowedPermission(
            route.id,
            (permissionId) => permissionId === "core:source_account.use"
          ) &&
          sameEntityKey(route.resource, action.originalSourceAccountResource)
        );
      }
      if (action.kind === "message_reaction") {
        const contentRead = byId(action.contentReadRequirementId);
        const route =
          action.originalRouteRequirementId === null
            ? undefined
            : byId(action.originalRouteRequirementId);
        return (
          contentRead !== undefined &&
          isAllowedPermission(
            action.contentReadRequirementId,
            (permissionId) =>
              action.contentBoundary === "internal"
                ? permissionId === "core:conversation.internal.read"
                : isExternalResourceReadPermission(permissionId)
          ) &&
          sameEntityKey(contentRead.resource, action.contentReadResource) &&
          (action.originalRouteRequirementId === null ||
            (route !== undefined &&
              action.originalSourceAccountResource !== null &&
              isAllowedPermission(
                route.id,
                (permissionId) => permissionId === "core:source_account.use"
              ) &&
              sameEntityKey(
                route.resource,
                action.originalSourceAccountResource
              )))
        );
      }
      if (action.kind === "external_moderation") {
        const contentRead = byId(action.contentReadRequirementId);
        const requiresProviderRoute =
          action.operation === "edit" ||
          action.deletionMode === "provider_delete";
        const route =
          action.originalRouteRequirementId === null
            ? undefined
            : byId(action.originalRouteRequirementId);
        return (
          contentRead !== undefined &&
          isAllowedPermission(
            contentRead.id,
            isExternalResourceReadPermission
          ) &&
          sameEntityKey(contentRead.resource, action.contentReadResource) &&
          (requiresProviderRoute
            ? route !== undefined &&
              action.originalSourceAccountResource !== null &&
              isAllowedPermission(
                route.id,
                (permissionId) => permissionId === "core:source_account.use"
              ) &&
              sameEntityKey(
                route.resource,
                action.originalSourceAccountResource
              )
            : action.originalRouteRequirementId === null)
        );
      }
      if (action.kind === "internal_owner_recovery") {
        const successor = byId(action.successorMembershipRequirementId);
        const approverDirectory = byId(action.approverDirectoryRequirementId);
        return (
          successor !== undefined &&
          approverDirectory !== undefined &&
          isAllowedPermission(
            approverDirectory.id,
            (permissionId) => permissionId === "core:employee.directory.view"
          ) &&
          sameEntityKey(
            approverDirectory.resource,
            action.approverEmployeeResource
          ) &&
          isAllowed(successor.id) &&
          successor.permissionId === "core:conversation.internal.read" &&
          successor.authorizationSubject.kind === "independent_employee" &&
          successor.authorizationSubject.employee.id ===
            action.successorEmployeeId &&
          sameEntityKey(successor.resource, action.targetResource) &&
          successor.guard.profileId === "core:rbac.guard.internal_membership" &&
          successor.guard.employeeId ===
            action.successorMembership.employeeId &&
          successor.guard.membershipState === "active" &&
          successor.guard.membershipOrigin === "hulee_internal_command" &&
          successor.guard.membershipRole ===
            action.successorMembership.currentRole
        );
      }
      if (action.kind === "report_workforce") {
        const directory = byId(action.employeeDirectoryRequirementId);
        return (
          isAllowedPermission(
            action.employeeDirectoryRequirementId,
            (permissionId) => permissionId === "core:employee.directory.view"
          ) &&
          directory !== undefined &&
          sameEntityKey(directory.resource, action.employeeDirectoryResource)
        );
      }
      if (action.kind === "report_export") {
        const reportView = byId(action.reportsViewRequirementId);
        return (
          isAllowedPermission(
            action.reportsViewRequirementId,
            (permissionId) => permissionId === "core:reports.view"
          ) &&
          reportView !== undefined &&
          sameEntityKey(reportView.resource, action.targetResource)
        );
      }
      if (action.kind === "sensitive_content") {
        const baseRead = byId(action.baseReadRequirementId);
        return (
          isAllowedPermission(
            action.baseReadRequirementId,
            isResourceReadPermission
          ) &&
          baseRead !== undefined &&
          sameEntityKey(baseRead.resource, action.baseReadResource)
        );
      }
      return true;
    }
    case "core:rbac.guard.notification_self": {
      const companion = byId(guard.targetReadRequirementId);
      return (
        companion !== undefined &&
        isAllowed(companion.id) &&
        companion.authorizationSubject.kind === "actor" &&
        isResourceReadPermission(companion.permissionId) &&
        sameEntityKey(companion.resource, requirement.resource)
      );
    }
    case "core:rbac.guard.notification_target_read": {
      const companion = byId(guard.targetReadRequirementId);
      return (
        companion !== undefined &&
        isAllowed(companion.id) &&
        companion.authorizationSubject.kind === "independent_employee" &&
        companion.authorizationSubject.employee.id === guard.targetEmployeeId &&
        isResourceReadPermission(companion.permissionId) &&
        sameEntityKey(companion.resource, requirement.resource)
      );
    }
    case "core:rbac.guard.internal_break_glass_issue": {
      const targetDirectory = byId(guard.targetDirectoryRequirementId);
      const approverDirectory = byId(guard.approverDirectoryRequirementId);
      return (
        targetDirectory !== undefined &&
        approverDirectory !== undefined &&
        isAllowedPermission(
          targetDirectory.id,
          (permissionId) => permissionId === "core:employee.directory.view"
        ) &&
        isAllowedPermission(
          approverDirectory.id,
          (permissionId) => permissionId === "core:employee.directory.view"
        ) &&
        sameEntityKey(targetDirectory.resource, guard.targetEmployeeResource) &&
        sameEntityKey(
          approverDirectory.resource,
          guard.approverEmployeeResource
        )
      );
    }
    case "core:rbac.guard.internal_membership": {
      if (requirement.permissionId === "core:message.moderate_internal") {
        const action = guard.moderationAction;
        if (guard.membershipChange !== undefined || action === undefined) {
          return false;
        }
        const contentRead = byId(action.contentReadRequirementId);
        return (
          contentRead !== undefined &&
          isAllowedPermission(
            contentRead.id,
            (permissionId) => permissionId === "core:conversation.internal.read"
          ) &&
          sameEntityKey(contentRead.resource, action.contentReadResource) &&
          sameEntityKey(contentRead.resource, requirement.resource) &&
          sameEntityKey(
            action.topologyConversationResource,
            requirement.resource
          )
        );
      }
      if (
        requirement.permissionId !== "core:conversation.internal.members.manage"
      ) {
        return (
          guard.membershipChange === undefined &&
          guard.moderationAction === undefined
        );
      }
      const change = guard.membershipChange;
      if (change === undefined || guard.moderationAction !== undefined) {
        return false;
      }
      const targetDirectory = byId(change.targetDirectoryRequirementId);
      const successor =
        change.successorOwnerRequirementId === null
          ? undefined
          : byId(change.successorOwnerRequirementId);
      return (
        targetDirectory !== undefined &&
        isAllowedPermission(
          targetDirectory.id,
          (permissionId) => permissionId === "core:employee.directory.view"
        ) &&
        sameEntityKey(
          targetDirectory.resource,
          change.targetEmployeeResource
        ) &&
        ((change.successorOwnerRequirementId === null &&
          change.successorOwner === null) ||
          (change.successorOwnerRequirementId !== null &&
            change.successorOwner !== null &&
            successor !== undefined &&
            isAllowedPermission(
              successor.id,
              (permissionId) =>
                permissionId === "core:conversation.internal.read",
              true
            ) &&
            sameEntityKey(successor.resource, requirement.resource) &&
            successor.authorizationSubject.kind === "independent_employee" &&
            successor.authorizationSubject.employee.id ===
              change.successorOwner.employeeId &&
            successor.guard.profileId ===
              "core:rbac.guard.internal_membership" &&
            successor.guard.employeeId === change.successorOwner.employeeId &&
            successor.guard.membershipState === "active" &&
            successor.guard.membershipOrigin === "hulee_internal_command" &&
            successor.guard.membershipRole ===
              change.successorOwner.currentRole))
      );
    }
    case "core:rbac.guard.external_route": {
      if (guard.authorizationMode === "destination_authority") {
        const authority = guard.multiSendDestinationAuthority;
        if (
          requirement.permissionId !== "core:source.multi_send" ||
          requirement.authorizationSubject.kind !== "actor" ||
          requirement.visibility !== "secondary_hidden" ||
          authority === null ||
          guard.operation.kind !== "multi_send" ||
          guard.operation.operationId !== authority.operationId ||
          !sameEntityKey(requirement.resource, authority.targetResource) ||
          !sameEntityKey(guard.targetResource, authority.targetResource) ||
          !sameEntityKey(guard.conversationResource, authority.targetResource)
        ) {
          return false;
        }
        const parents = requirements.filter((candidate) => {
          if (
            candidate.id === requirement.id ||
            candidate.permissionId !== "core:source.multi_send" ||
            candidate.authorizationSubject.kind !== "actor" ||
            candidate.guard.profileId !== "core:rbac.guard.external_route" ||
            candidate.guard.authorizationMode !== "operation" ||
            candidate.guard.operation.kind !== "multi_send" ||
            candidate.guard.operation.operationId !== authority.operationId
          ) {
            return false;
          }
          return candidate.guard.operation.destinations.some(
            (destination) =>
              destination.operationRequirementId === requirement.id &&
              sameEntityKey(
                destination.targetResource,
                authority.targetResource
              ) &&
              sameEntityKey(
                destination.bindingResource,
                authority.bindingResource
              ) &&
              sameEntityKey(
                destination.sourceAccountResource,
                authority.sourceAccountResource
              )
          );
        });
        return parents.length === 1;
      }
      if (guard.multiSendDestinationAuthority !== null) return false;
      const conversation = byId(guard.conversationRequirementId);
      const source = byId(guard.sourceAccountRequirementId);
      const work =
        guard.workRequirementId === null
          ? undefined
          : byId(guard.workRequirementId);
      const override =
        guard.overrideRequirementId === null
          ? undefined
          : byId(guard.overrideRequirementId);
      const claim =
        guard.claimRequirementId === null
          ? undefined
          : byId(guard.claimRequirementId);
      const conversationDecision = decisions.get(
        guard.conversationRequirementId
      );
      const operationCompanionsValid = (() => {
        const operation = guard.operation;
        if (operation.kind === "reply") {
          if (operation.mode === "new_response") return true;
          const sourceRead =
            operation.sourceReadRequirementId === null
              ? undefined
              : byId(operation.sourceReadRequirementId);
          return (
            sourceRead !== undefined &&
            operation.sourceReadResource !== null &&
            isAllowedPermission(
              sourceRead.id,
              (permissionId) => permissionId === "core:conversation.read"
            ) &&
            sameEntityKey(sourceRead.resource, operation.sourceReadResource)
          );
        }
        if (operation.kind === "forward") {
          const sourceRead = byId(operation.sourceReadRequirementId);
          const sourceAccount =
            operation.sourceAccountRequirementId === null
              ? undefined
              : byId(operation.sourceAccountRequirementId);
          return (
            sourceRead !== undefined &&
            isAllowedPermission(
              sourceRead.id,
              (permissionId) => permissionId === "core:conversation.read"
            ) &&
            sameEntityKey(sourceRead.resource, operation.sourceReadResource) &&
            (operation.mode === "copy"
              ? operation.sourceAccountRequirementId === null
              : sourceAccount !== undefined &&
                operation.bindingSourceAccountResource !== null &&
                isAllowedPermission(
                  sourceAccount.id,
                  (permissionId) => permissionId === "core:source_account.use"
                ) &&
                sameEntityKey(
                  sourceAccount.resource,
                  operation.bindingSourceAccountResource
                ))
          );
        }
        if (operation.kind === "multi_send") {
          return operation.destinations.every((destination) => {
            const destinationRead = byId(destination.conversationRequirementId);
            const destinationSource = byId(destination.sourceRequirementId);
            const destinationAuthority = byId(
              destination.operationRequirementId
            );
            const authorityEvidence =
              destinationAuthority?.guard.profileId ===
                "core:rbac.guard.external_route" &&
              destinationAuthority.guard.authorizationMode ===
                "destination_authority"
                ? destinationAuthority.guard.multiSendDestinationAuthority
                : null;
            return (
              destinationRead !== undefined &&
              destinationSource !== undefined &&
              destinationAuthority !== undefined &&
              isAllowedPermission(
                destinationRead.id,
                (permissionId) => permissionId === "core:conversation.read"
              ) &&
              sameEntityKey(
                destinationRead.resource,
                destination.targetResource
              ) &&
              isAllowedPermission(
                destinationSource.id,
                (permissionId) => permissionId === "core:source_account.use"
              ) &&
              sameEntityKey(
                destinationSource.resource,
                destination.sourceAccountResource
              ) &&
              destinationAuthority.authorizationSubject.kind === "actor" &&
              destinationAuthority.visibility === "secondary_hidden" &&
              isAllowedPermission(
                destinationAuthority.id,
                (permissionId) => permissionId === "core:source.multi_send"
              ) &&
              sameEntityKey(
                destinationAuthority.resource,
                destination.targetResource
              ) &&
              authorityEvidence !== null &&
              authorityEvidence.operationId === operation.operationId &&
              sameEntityKey(
                authorityEvidence.targetResource,
                destination.targetResource
              ) &&
              sameEntityKey(
                authorityEvidence.bindingResource,
                destination.bindingResource
              ) &&
              sameEntityKey(
                authorityEvidence.sourceAccountResource,
                destination.sourceAccountResource
              )
            );
          });
        }
        if (operation.kind === "source_item_reply") {
          const sourceItemRead = byId(operation.sourceItemReadRequirementId);
          const sourceItemAction =
            sourceItemRead?.guard.profileId ===
              "core:rbac.guard.canonical_resource" &&
            sourceItemRead.guard.action.kind === "source_item_open_external"
              ? sourceItemRead.guard.action
              : null;
          return (
            sourceItemRead !== undefined &&
            sourceItemAction !== null &&
            isAllowedPermission(
              sourceItemRead.id,
              (permissionId) =>
                permissionId === "core:source_item.open_external"
            ) &&
            sameEntityKey(
              sourceItemRead.resource,
              operation.sourceItemResource
            ) &&
            sameEntityKey(
              sourceItemAction.descriptorSourceAccountResource,
              operation.descriptorSourceAccountResource
            ) &&
            sameEntityKey(
              operation.descriptorSourceAccountResource,
              guard.bindingSourceAccountResource
            )
          );
        }
        const account = byId(operation.accountRequirementId);
        const target = byId(operation.targetRequirementId);
        return (
          account !== undefined &&
          target !== undefined &&
          isAllowedPermission(
            account.id,
            (permissionId) => permissionId === "core:source_account.use"
          ) &&
          sameEntityKey(account.resource, operation.telephonyAccountResource) &&
          isAllowedPermission(target.id, isResourceReadPermission) &&
          sameEntityKey(target.resource, operation.callTargetResource)
        );
      })();
      return (
        guard.conversationRequirementId !== guard.sourceAccountRequirementId &&
        conversation !== undefined &&
        source !== undefined &&
        isAllowed(conversation.id) &&
        isAllowed(source.id) &&
        conversation.permissionId === "core:conversation.read" &&
        sameEntityKey(conversation.resource, guard.conversationResource) &&
        (guard.operation.kind === "source_item_reply"
          ? sameEntityKey(
              requirement.resource,
              guard.operation.sourceItemResource
            )
          : guard.operation.kind === "call_initiate"
            ? sameEntityKey(
                requirement.resource,
                guard.operation.callTargetResource
              )
            : sameEntityKey(
                requirement.resource,
                guard.conversationResource
              )) &&
        source.permissionId === "core:source_account.use" &&
        source.resource.entityTypeId === "core:source-account" &&
        String(source.resource.entityId) === String(guard.sourceAccountId) &&
        guard.bindingResource.tenantId === requirement.resource.tenantId &&
        guard.bindingResource.entityTypeId === "core:source-thread-binding" &&
        guard.externalThreadResource.entityTypeId === "core:external-thread" &&
        sameEntityKey(
          guard.bindingConversationResource,
          guard.conversationResource
        ) &&
        sameEntityKey(
          guard.bindingExternalThreadResource,
          guard.externalThreadResource
        ) &&
        sameEntityKey(guard.bindingSourceAccountResource, source.resource) &&
        guard.externalThreadResource.tenantId ===
          requirement.resource.tenantId &&
        operationCompanionsValid &&
        (guard.actorRelation !== "exact_conversation_scope" ||
          (conversationDecision?.outcome === "allowed" &&
            conversationDecision.matchedScope.type === "conversation" &&
            conversationDecision.matchedScope.id ===
              String(guard.conversationResource.entityId))) &&
        (guard.actorRelation !== "structural_access_binding" ||
          (guard.structuralAccessBinding !== null &&
            conversationDecision?.outcome === "allowed" &&
            (conversationDecision.matchedScope.type === "org_unit" ||
              conversationDecision.matchedScope.type === "team") &&
            permissionScopeTargetsResource(
              conversationDecision.matchedScope,
              guard.structuralAccessBinding.scopeTargetResource
            ))) &&
        routeRevisionSetIsCurrent(guard.routeRevisionChecks) &&
        (guard.workState === "no_work_non_actionable"
          ? guard.workRequirementId === null && guard.workItemId === null
          : work !== undefined &&
            isAllowed(work.id) &&
            work.permissionId === "core:work.read" &&
            work.resource.entityTypeId === "core:work-item" &&
            guard.workItemId !== null &&
            String(work.resource.entityId) === String(guard.workItemId)) &&
        (guard.actorRelation === "scoped_supervisor_override"
          ? override !== undefined &&
            isAllowed(override.id) &&
            override.permissionId === "core:work.override" &&
            guard.workItemId !== null &&
            override.resource.entityTypeId === "core:work-item" &&
            String(override.resource.entityId) === String(guard.workItemId)
          : guard.overrideRequirementId === null) &&
        (guard.actorRelation === "queue_member"
          ? claim !== undefined &&
            isAllowed(claim.id) &&
            claim.permissionId === "core:work.claim" &&
            guard.workItemId !== null &&
            claim.resource.entityTypeId === "core:work-item" &&
            String(claim.resource.entityId) === String(guard.workItemId)
          : guard.claimRequirementId === null)
      );
    }
    case "core:rbac.guard.file_parent_content": {
      const parents = guard.parentRequirementIds
        .map((id) => byId(id))
        .filter(
          (candidate): candidate is InboxV2AuthorizationRequirement =>
            candidate !== undefined &&
            candidate.authorizationSubject.kind === "actor" &&
            isAllowed(candidate.id) &&
            sameEntityKey(candidate.resource, guard.parentResource)
        );
      const permissionIds = parents.map(({ permissionId }) => permissionId);
      if (permissionIds.length !== guard.parentRequirementIds.length) {
        return false;
      }
      if (
        !fileParentPermissionSetIsValid(
          guard.operation,
          guard.parentBoundary,
          permissionIds
        )
      ) {
        return false;
      }
      if (guard.moderationRequirementId === null) return true;
      const moderation = byId(guard.moderationRequirementId);
      return (
        moderation !== undefined &&
        moderation.authorizationSubject.kind === "actor" &&
        isAllowed(moderation.id) &&
        sameEntityKey(moderation.resource, guard.parentResource) &&
        (guard.parentBoundary === "internal"
          ? moderation.permissionId === "core:message.moderate_internal"
          : moderation.permissionId === "core:message.moderate_external")
      );
    }
    case "core:rbac.guard.client_context": {
      const ownerDirectory =
        guard.clientOwnerAssignment === undefined
          ? undefined
          : byId(guard.clientOwnerAssignment.targetDirectoryRequirementId);
      const ownerDirectoryValid =
        guard.clientOwnerAssignment === undefined ||
        (ownerDirectory !== undefined &&
          isAllowedPermission(
            ownerDirectory.id,
            (permissionId) => permissionId === "core:employee.directory.view"
          ) &&
          sameEntityKey(
            ownerDirectory.resource,
            guard.clientOwnerAssignment.targetEmployeeResource
          ));
      return (
        ownerDirectoryValid &&
        clientPathCompanionsAreValid(
          requirement,
          guard,
          decisions,
          byId,
          isAllowed
        ) &&
        guard.linkedClientRequirementIds.every((id) => {
          const companion = byId(id);
          return (
            companion !== undefined &&
            isAllowed(id) &&
            companion.permissionId === "core:client.link.manage" &&
            companion.resource.entityTypeId === "core:client"
          );
        }) &&
        clientMutationCompanionsAreValid(requirement, requirements, decisions)
      );
    }
    case "core:rbac.guard.work_item_state": {
      if (guard.authorizationMode === "destination_authority") {
        return (
          guard.authorityTargetResource !== null &&
          guard.destinationRequirementIds.length === 0 &&
          guard.destinationResources.length === 0 &&
          guard.overrideRequirementId === null
        );
      }
      if (
        guard.destinationRequirementIds.length !==
          guard.destinationResources.length ||
        new Set(guard.destinationRequirementIds).size !==
          guard.destinationRequirementIds.length ||
        new Set(guard.destinationResources.map(entityKeyString)).size !==
          guard.destinationResources.length
      ) {
        return false;
      }
      const requiredDestinationTypes = requiredWorkDestinationEntityTypes(
        guard.operation
      );
      if (
        !requiredDestinationTypes.every((entityTypeId) =>
          guard.destinationResources.some(
            (resource) => resource.entityTypeId === entityTypeId
          )
        ) ||
        (requiredDestinationTypes.length === 0 &&
          guard.destinationResources.length > 0)
      ) {
        return false;
      }
      const destinationsValid = guard.destinationRequirementIds.every(
        (id, index) => {
          const destination = byId(id);
          const destinationResource = guard.destinationResources[index]!;
          if (destination === undefined || !isAllowed(id)) return false;
          if (destinationResource.entityTypeId === "core:employee") {
            return (
              destination.permissionId === "core:employee.directory.view" &&
              destination.authorizationSubject.kind === "actor" &&
              sameEntityKey(destination.resource, destinationResource)
            );
          }
          return (
            destination.permissionId === requirement.permissionId &&
            destination.guard.profileId === "core:rbac.guard.work_item_state" &&
            destination.guard.authorizationMode === "destination_authority" &&
            destination.guard.authorityTargetResource !== null &&
            sameEntityKey(
              destination.guard.authorityTargetResource,
              destinationResource
            ) &&
            sameEntityKey(destination.resource, requirement.resource)
          );
        }
      );
      if (!destinationsValid) return false;
      if (
        guard.overrideRequirementId === null ||
        guard.operation === "override"
      ) {
        return true;
      }
      const override = byId(guard.overrideRequirementId);
      return (
        override !== undefined &&
        isAllowedPermission(
          guard.overrideRequirementId,
          (permissionId) => permissionId === "core:work.override"
        ) &&
        override.resource.entityTypeId === "core:work-item" &&
        String(override.resource.entityId) === String(guard.workItemId)
      );
    }
    case "core:rbac.guard.source_account_route": {
      if (guard.operation.kind !== "reroute_dispatch") return true;
      const originalSource = byId(guard.operation.originalSourceRequirementId);
      const newSource = byId(guard.operation.newSourceRequirementId);
      return (
        guard.operation.originalSourceRequirementId !==
          guard.operation.newSourceRequirementId &&
        originalSource !== undefined &&
        newSource !== undefined &&
        isAllowedPermission(
          originalSource.id,
          (permissionId) => permissionId === "core:source_account.use"
        ) &&
        isAllowedPermission(
          newSource.id,
          (permissionId) => permissionId === "core:source_account.use"
        ) &&
        originalSource.guard.profileId ===
          "core:rbac.guard.source_account_route" &&
        originalSource.guard.operation.kind === "use" &&
        newSource.guard.profileId === "core:rbac.guard.source_account_route" &&
        newSource.guard.operation.kind === "use" &&
        sameEntityKey(
          originalSource.resource,
          guard.operation.originalRoute.sourceAccountResource
        ) &&
        sameEntityKey(
          newSource.resource,
          guard.operation.newRoute.sourceAccountResource
        ) &&
        sameEntityKey(
          originalSource.guard.operation.bindingResource,
          guard.operation.originalRoute.bindingResource
        ) &&
        sameEntityKey(
          newSource.guard.operation.bindingResource,
          guard.operation.newRoute.bindingResource
        )
      );
    }
    case "core:rbac.guard.identity_evidence": {
      const operation = guard.operation;
      if (
        operation.kind === "source_identity_use" ||
        operation.kind === "evidence_view" ||
        operation.kind === "auto_resolve"
      ) {
        return true;
      }
      const exactAllowed = (
        requirementId: string,
        resource: InboxV2EntityKey,
        permissionPredicate: (permissionId: string) => boolean
      ): boolean => {
        const requirement = byId(requirementId);
        return (
          requirement !== undefined &&
          sameEntityKey(requirement.resource, resource) &&
          isAllowedPermission(requirementId, permissionPredicate)
        );
      };
      const exactSourceUse = (
        requirementId: string,
        resource: InboxV2EntityKey
      ): boolean =>
        exactAllowed(
          requirementId,
          resource,
          (permissionId) => permissionId === "core:identity.source_identity.use"
        );
      if (
        operation.kind === "employee_claim_manage" ||
        operation.kind === "client_contact_claim_manage"
      ) {
        const ids = [
          operation.sourceIdentityRequirementId,
          ...(operation.oldTargetRequirementId === null
            ? []
            : [operation.oldTargetRequirementId]),
          ...(operation.evidenceViewRequirementId === null
            ? []
            : [operation.evidenceViewRequirementId])
        ];
        return (
          new Set(ids).size === ids.length &&
          exactSourceUse(
            operation.sourceIdentityRequirementId,
            operation.sourceIdentityResource
          ) &&
          ((operation.oldTargetResource === null &&
            operation.oldTargetRequirementId === null) ||
            (operation.oldTargetResource !== null &&
              operation.oldTargetRequirementId !== null &&
              exactAllowed(
                operation.oldTargetRequirementId,
                operation.oldTargetResource,
                (permissionId) => permissionId === "core:identity.claim.revoke"
              ))) &&
          (operation.sensitiveEvidenceIncluded
            ? operation.evidenceViewRequirementId !== null &&
              exactAllowed(
                operation.evidenceViewRequirementId,
                operation.evidenceResource,
                (permissionId) => permissionId === "core:identity.evidence.view"
              )
            : operation.evidenceViewRequirementId === null)
        );
      }
      if (operation.kind === "claim_revoke") {
        return exactSourceUse(
          operation.sourceIdentityRequirementId,
          operation.sourceIdentityResource
        );
      }
      if (operation.kind === "merge") {
        const targetAuthorities = [
          operation.canonicalClaimTargetAuthority,
          operation.aliasClaimTargetAuthority
        ].filter(
          (authority): authority is InboxV2IdentityMergeClaimTargetAuthority =>
            authority !== null
        );
        return (
          operation.canonicalIdentityRequirementId !==
            operation.aliasIdentityRequirementId &&
          exactSourceUse(
            operation.canonicalIdentityRequirementId,
            operation.canonicalIdentityResource
          ) &&
          exactSourceUse(
            operation.aliasIdentityRequirementId,
            operation.aliasIdentityResource
          ) &&
          targetAuthorities.every((authority) => {
            const target = byId(authority.targetRequirementId);
            if (
              target === undefined ||
              !sameEntityKey(target.resource, authority.authorityResource)
            ) {
              return false;
            }
            if (authority.kind === "employee") {
              return isAllowedPermission(
                target.id,
                (permissionId) =>
                  permissionId === "core:employee.directory.view"
              );
            }
            return (
              isAllowedPermission(
                target.id,
                (permissionId) => permissionId === "core:client.contacts.view"
              ) &&
              target.guard.profileId === "core:rbac.guard.client_context" &&
              target.guard.target.kind === "client" &&
              entityKeyMatchesOpaqueId(
                authority.authorityResource,
                String(target.guard.target.clientId)
              )
            );
          })
        );
      }
      return exactSourceUse(
        operation.sourceIdentityRequirementId,
        operation.sourceIdentityResource
      );
    }
    case "core:rbac.guard.report_resource_conjunction":
      return (
        reportLayersAreValid(guard, byId, isAllowed) &&
        guard.underlyingRequirementIds.length ===
          guard.underlyingResources.length &&
        guard.underlyingRequirementIds.every((id, index) => {
          const underlying = byId(id);
          const underlyingResource = guard.underlyingResources[index]!;
          return (
            underlying !== undefined &&
            isAllowedPermission(id, (permissionId) =>
              isReportUnderlyingPermission(
                permissionId,
                underlyingResource,
                guard.accessLevel
              )
            ) &&
            sameEntityKey(underlying.resource, underlyingResource)
          );
        }) &&
        guard.privateInternalRequirementIds.every((id) =>
          isAllowedPermission(
            id,
            (permissionId) => permissionId === "core:conversation.internal.read"
          )
        )
      );
    case "core:rbac.guard.audit_facets":
      return (
        guard.facetRequirementIds.length === guard.facetResources.length &&
        guard.facetRequirementIds.every((id, index) => {
          const facet = byId(id);
          return (
            facet !== undefined &&
            isAllowedPermission(id, isResourceReadPermission) &&
            sameEntityKey(facet.resource, guard.facetResources[index]!)
          );
        }) &&
        (guard.piiRequirementId === null ||
          isAllowedPermission(
            guard.piiRequirementId,
            (permissionId) =>
              permissionId ===
              (requirement.permissionId === "core:audit.privacy.export"
                ? "core:reports.pii.export"
                : "core:reports.pii.view")
          ))
      );
    case "core:rbac.guard.privacy_policy_revision": {
      if (guard.activationEvidence === null) {
        return guard.phase !== "activate";
      }
      const approverDirectory = byId(
        guard.activationEvidence.approverDirectoryRequirementId
      );
      return (
        guard.phase === "activate" &&
        approverDirectory !== undefined &&
        isAllowedPermission(
          approverDirectory.id,
          (permissionId) => permissionId === "core:employee.directory.view"
        ) &&
        sameEntityKey(
          approverDirectory.resource,
          guard.activationEvidence.approvalApproverEmployeeResource
        )
      );
    }
    case "core:rbac.guard.privacy_subject_evidence_roots":
      return (
        guard.exactRootRequirementIds.length ===
          guard.exactRootResources.length &&
        guard.exactRootRequirementIds.every((id, index) => {
          const root = byId(id);
          return (
            root !== undefined &&
            isAllowedPermission(id, isResourceReadPermission) &&
            sameEntityKey(root.resource, guard.exactRootResources[index]!)
          );
        })
      );
    case "core:rbac.guard.privacy_hold_manifest_revision": {
      if (guard.phase === "view") {
        return guard.approvalEvidence === null;
      }
      const approval = guard.approvalEvidence;
      if (approval === null) return false;
      const approverDirectory = byId(approval.approverDirectoryRequirementId);
      return (
        approverDirectory !== undefined &&
        approverDirectory.authorizationSubject.kind === "actor" &&
        isAllowedPermission(
          approverDirectory.id,
          (permissionId) => permissionId === "core:employee.directory.view"
        ) &&
        sameEntityKey(
          approverDirectory.resource,
          approval.approverEmployeeResource
        )
      );
    }
    case "core:rbac.guard.privacy_tenant_export_high_water": {
      const approverDirectory = byId(guard.approverDirectoryRequirementId);
      const piiRequirement =
        guard.piiRequirementId === null
          ? undefined
          : byId(guard.piiRequirementId);
      return (
        approverDirectory !== undefined &&
        approverDirectory.authorizationSubject.kind === "actor" &&
        isAllowedPermission(
          approverDirectory.id,
          (permissionId) => permissionId === "core:employee.directory.view"
        ) &&
        sameEntityKey(
          approverDirectory.resource,
          guard.approvalApproverEmployeeResource
        ) &&
        (guard.piiIncluded
          ? guard.piiRequirementId !== null &&
            guard.piiRequirementId !== guard.approverDirectoryRequirementId &&
            guard.piiAuthorityResource !== null &&
            piiRequirement !== undefined &&
            piiRequirement.authorizationSubject.kind === "actor" &&
            sameEntityKey(
              piiRequirement.resource,
              guard.piiAuthorityResource
            ) &&
            isAllowedPermission(
              piiRequirement.id,
              (permissionId) => permissionId === "core:reports.pii.export"
            )
          : guard.piiRequirementId === null &&
            guard.piiAuthorityResource === null)
      );
    }
    case "core:rbac.guard.privacy_deletion_plan_revisions":
      if (guard.phase === "execute") {
        const approval = guard.approvalEvidence;
        if (approval === null) return false;
        const approverDirectory = byId(approval.approverDirectoryRequirementId);
        if (
          approverDirectory === undefined ||
          approverDirectory.authorizationSubject.kind !== "actor" ||
          !isAllowedPermission(
            approverDirectory.id,
            (permissionId) => permissionId === "core:employee.directory.view"
          ) ||
          !sameEntityKey(
            approverDirectory.resource,
            approval.approverEmployeeResource
          )
        ) {
          return false;
        }
      } else if (guard.approvalEvidence !== null) {
        return false;
      }
      return guard.handlers.every((handler) => {
        if (handler.surfaceKind !== "external_route") return true;
        const provider = handler.externalProvider;
        if (guard.phase !== "execute") return provider === null;
        if (provider === null) return false;
        const sourceUse = byId(provider.sourceAccountUseRequirementId);
        const bindingRevision = keyedRevisionFor(
          provider.bindingRevisionChecks,
          provider.bindingResource
        );
        return (
          sourceUse !== undefined &&
          sourceUse.authorizationSubject.kind === "actor" &&
          sourceUse.permissionId === "core:source_account.use" &&
          isAllowed(sourceUse.id) &&
          sameEntityKey(sourceUse.resource, provider.sourceAccountResource) &&
          sourceUse.guard.profileId ===
            "core:rbac.guard.source_account_route" &&
          sourceUse.guard.operation.kind === "use" &&
          sourceUse.guard.sourceAccountId ===
            sourceUse.guard.routeSourceAccountId &&
          bindingRevision !== undefined &&
          sourceUse.guard.expectedBindingGeneration ===
            bindingRevision.expected &&
          sourceUse.guard.bindingGeneration === bindingRevision.actual &&
          sourceAccountResourceMatches(
            sourceUse.resource,
            sourceUse.guard.sourceAccountId,
            requirement.resource.tenantId
          )
        );
      });
    case "core:rbac.guard.privacy_audit_facets": {
      const facetsAreExact =
        guard.facetRequirementIds.length === guard.facetResources.length &&
        guard.facetRequirementIds.every((id, index) => {
          const facet = byId(id);
          return (
            facet !== undefined &&
            isAllowedPermission(id, isResourceReadPermission) &&
            sameEntityKey(facet.resource, guard.facetResources[index]!)
          );
        });
      if (!facetsAreExact) return false;

      const authority = guard.piiAuthorityEvidence;
      if (guard.piiRequirementId === null) return authority === null;
      const piiRequirement = byId(guard.piiRequirementId);
      if (
        authority === null ||
        piiRequirement === undefined ||
        !isAllowedPermission(
          guard.piiRequirementId,
          (permissionId) =>
            permissionId ===
            (requirement.permissionId === "core:audit.privacy.export"
              ? "core:reports.pii.export"
              : "core:reports.pii.view")
        ) ||
        piiRequirement.guard.profileId !==
          "core:rbac.guard.report_resource_conjunction" ||
        !sameEntityKey(
          authority.reportQueryResource,
          piiRequirement.resource
        ) ||
        !sameEntityKey(
          authority.reportManifestResource,
          piiRequirement.guard.manifestResource
        ) ||
        !sameEntityKey(authority.auditQueryResource, requirement.resource) ||
        !sameEntityKey(
          authority.auditManifestResource,
          guard.manifestResource
        ) ||
        !exactEntityKeySetMatches(
          authority.facetResources,
          guard.facetResources
        ) ||
        !exactEntityKeySetMatches(
          piiRequirement.guard.underlyingResources,
          guard.facetResources
        ) ||
        !exactStringSetMatches(
          piiRequirement.guard.underlyingRequirementIds,
          guard.facetRequirementIds
        ) ||
        !keyedRevisionMatchesRequirement(
          authority.revisionChecks,
          requirement
        ) ||
        !keyedRevisionMatchesRequirement(
          authority.revisionChecks,
          piiRequirement
        ) ||
        !keyedRevisionMatchesPolicyRevision(
          authority.revisionChecks,
          guard.manifestResource,
          guard.manifestRevisionChecks,
          "manifest"
        ) ||
        !keyedRevisionMatchesPolicyRevision(
          authority.revisionChecks,
          piiRequirement.guard.manifestResource,
          piiRequirement.guard.manifestRevisionChecks,
          "manifest"
        ) ||
        guard.facetRequirementIds.some((id) => {
          const facet = byId(id);
          return (
            facet === undefined ||
            !keyedRevisionMatchesRequirement(authority.revisionChecks, facet)
          );
        })
      ) {
        return false;
      }
      return true;
    }
    default:
      return true;
  }
}

function isExternalResourceReadPermission(permissionId: string): boolean {
  return (
    permissionId === "core:conversation.read" ||
    permissionId === "core:client.view" ||
    permissionId === "core:work.read" ||
    permissionId === "core:source_account.view" ||
    permissionId === "core:source_item.open_external"
  );
}

function fileParentPermissionSetIsValid(
  operation: InboxV2FileParentGuard["operation"],
  boundary: InboxV2FileParentGuard["parentBoundary"],
  permissionIds: readonly string[]
): boolean {
  if (operation === "view" || operation === "delete") {
    return boundary === "external"
      ? permissionIds.some(isExternalResourceReadPermission)
      : boundary === "staff_only"
        ? permissionIds.includes("core:conversation.read") &&
          permissionIds.includes("core:message.staff_note.read")
        : permissionIds.includes("core:conversation.internal.read");
  }
  return boundary === "external"
    ? permissionIds.includes("core:conversation.read") &&
        permissionIds.includes("core:message.reply_external")
    : boundary === "staff_only"
      ? permissionIds.includes("core:conversation.read") &&
        permissionIds.includes("core:message.staff_note.create")
      : permissionIds.includes("core:conversation.internal.read") &&
        permissionIds.includes("core:message.send_internal");
}

function isResourceReadPermission(permissionId: string): boolean {
  return (
    isExternalResourceReadPermission(permissionId) ||
    permissionId === "core:conversation.internal.read" ||
    permissionId === "core:message.staff_note.read" ||
    permissionId === "core:file.view" ||
    permissionId === "core:call.recording.view" ||
    permissionId === "core:call.transcript.view" ||
    permissionId === "core:participant.pii.view"
  );
}

function isReportUnderlyingPermission(
  permissionId: string,
  resource: InboxV2EntityKey,
  accessLevel: InboxV2ReportResourceGuard["accessLevel"]
): boolean {
  if (
    accessLevel !== "drilldown" &&
    (resource.entityTypeId === "core:client" ||
      resource.entityTypeId === "core:client-contact")
  ) {
    return permissionId === "core:client.contacts.view";
  }
  if (
    accessLevel !== "drilldown" &&
    resource.entityTypeId === "core:participant"
  ) {
    return permissionId === "core:participant.pii.view";
  }
  return isResourceReadPermission(permissionId);
}

function reportLayersAreValid(
  guard: InboxV2ReportResourceGuard,
  byId: (id: string) => InboxV2AuthorizationRequirement | undefined,
  isAllowed: (id: string) => boolean
): boolean {
  const allowedLayerPermissions = guard.layerRequirementIds
    .map((id) => byId(id))
    .filter(
      (requirement): requirement is InboxV2AuthorizationRequirement =>
        requirement !== undefined &&
        requirement.authorizationSubject.kind === "actor" &&
        isAllowed(requirement.id) &&
        sameEntityKey(requirement.resource, guard.targetResource)
    )
    .map((requirement) => requirement.permissionId);
  if (allowedLayerPermissions.length !== guard.layerRequirementIds.length) {
    return false;
  }
  const required =
    guard.accessLevel === "drilldown"
      ? ["core:reports.view"]
      : guard.accessLevel === "pii"
        ? ["core:reports.view", "core:reports.drilldown"]
        : [
            "core:reports.view",
            "core:reports.export",
            "core:reports.drilldown",
            "core:reports.pii.view"
          ];
  return required.every((permissionId) =>
    allowedLayerPermissions.includes(permissionId)
  );
}

function scopeContains(
  granted: InboxV2PermissionScope,
  requested: InboxV2PermissionScope
): boolean {
  if (granted.tenantId !== requested.tenantId) return false;
  if (granted.type === "tenant") return true;
  if (granted.type !== requested.type) return false;
  if (granted.type === "org_unit" && requested.type === "org_unit") {
    return granted.id === requested.id && granted.mode === requested.mode;
  }
  if (
    (granted.type === "team" && requested.type === "team") ||
    (granted.type === "queue" && requested.type === "queue") ||
    (granted.type === "client" && requested.type === "client") ||
    (granted.type === "conversation" && requested.type === "conversation") ||
    (granted.type === "work_item" && requested.type === "work_item") ||
    (granted.type === "source_account" && requested.type === "source_account")
  ) {
    return granted.id === requested.id;
  }
  return true;
}

function permissionScopeTargetsResource(
  scope: InboxV2PermissionScope,
  resource: InboxV2EntityKey
): boolean {
  if (scope.tenantId !== resource.tenantId) return false;
  if (scope.type === "tenant") {
    return resource.entityTypeId === "core:tenant";
  }
  const entityTypeByScope: Partial<Record<InboxV2PermissionScopeType, string>> =
    {
      org_unit: "core:org-unit",
      team: "core:team",
      queue: "core:work-queue",
      client: "core:client",
      conversation: "core:conversation",
      work_item: "core:work-item",
      source_account: "core:source-account"
    };
  if (!("id" in scope)) return false;
  return (
    resource.entityTypeId === entityTypeByScope[scope.type] &&
    entityKeyMatchesOpaqueId(resource, String(scope.id))
  );
}

function matchActivePrincipalGrantForScope(
  context: EvaluationContext,
  permissionId: InboxV2PermissionId,
  requestedScope: InboxV2PermissionScope
): InboxV2EmployeeGrantMatch {
  for (const grant of context.input.grants) {
    if (
      !grantProvenanceIsValid(grant) ||
      grant.tenantId !== context.input.tenantId ||
      grant.permissionId !== permissionId ||
      !grantTargetsPrincipal(
        grant,
        context.principalKind,
        context.principalId
      ) ||
      !isGrantActive(grant, context.input.evaluatedAt) ||
      !scopeContains(grant.scope, requestedScope)
    ) {
      continue;
    }
    if (
      evaluateInboxV2PermissionScopePairLegality({
        permissionId,
        scope: grant.scope,
        principalKind: context.principalKind
      }).kind === "legal"
    ) {
      return Object.freeze({
        matched: true,
        boundary: earliestTimestamp([
          grant.validUntil,
          futureTimestamp(grant.revokedAt, context.input.evaluatedAt)
        ])
      });
    }
  }
  return Object.freeze({ matched: false });
}

type InboxV2EmployeeGrantMatch =
  | Readonly<{
      matched: true;
      boundary: InboxV2PolicyTimestamp | null;
    }>
  | Readonly<{ matched: false }>;

function matchActiveEmployeeGrantForScope(
  input: InboxV2AuthorizationPlanInput,
  grantId: string,
  employeeId: InboxV2EmployeeId,
  permissionId: InboxV2PermissionId,
  requestedScope: InboxV2PermissionScope,
  requiredGrantScopeType: InboxV2PermissionScopeType | null = null
): InboxV2EmployeeGrantMatch {
  for (const grant of input.grants) {
    if (
      grant.id !== grantId ||
      !grantProvenanceIsValid(grant) ||
      grant.tenantId !== input.tenantId ||
      grant.permissionId !== permissionId ||
      (requiredGrantScopeType !== null &&
        grant.scope.type !== requiredGrantScopeType) ||
      grant.principal.kind !== "employee" ||
      grant.principal.employeeId !== employeeId ||
      !isGrantActive(grant, input.evaluatedAt) ||
      !scopeContains(grant.scope, requestedScope)
    ) {
      continue;
    }
    if (
      evaluateInboxV2PermissionScopePairLegality({
        permissionId,
        scope: grant.scope,
        principalKind: "employee"
      }).kind === "legal"
    ) {
      return Object.freeze({
        matched: true,
        boundary: earliestTimestamp([
          grant.validUntil,
          futureTimestamp(grant.revokedAt, input.evaluatedAt)
        ])
      });
    }
  }
  return Object.freeze({ matched: false });
}

function canonicalPermissionMayUseBareAction(
  permissionId: InboxV2PermissionId
): boolean {
  return (
    permissionId === "core:employee.directory.view" ||
    permissionId === "core:source_account.view" ||
    permissionId === "core:source_account.diagnostics.view" ||
    permissionId.startsWith("core:message.staff_note.")
  );
}

function hasCompanionCycle(
  companions: ReadonlyMap<string, readonly string[]>
): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const companionId of companions.get(id) ?? []) {
      if (companions.has(companionId) && visit(companionId)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return [...companions.keys()].some(visit);
}

function independentAuthorizationSubjectsAreBound(
  requirements: readonly InboxV2AuthorizationRequirement[],
  companions: ReadonlyMap<string, readonly string[]>
): boolean {
  for (const requirement of requirements) {
    if (requirement.authorizationSubject.kind !== "independent_employee") {
      continue;
    }
    if (requirement.visibility !== "secondary_hidden") return false;

    const parents = requirements.filter(
      (candidate) =>
        candidate.authorizationSubject.kind === "actor" &&
        (companions.get(candidate.id) ?? []).includes(requirement.id)
    );
    if (parents.length !== 1) return false;

    const parent = parents[0]!;
    const targetEmployeeId = requirement.authorizationSubject.employee.id;
    if (parent.guard.profileId === "core:rbac.guard.notification_target_read") {
      if (
        parent.guard.targetReadRequirementId !== requirement.id ||
        parent.guard.targetEmployeeId !== targetEmployeeId
      ) {
        return false;
      }
      continue;
    }
    if (
      parent.guard.profileId === "core:rbac.guard.canonical_resource" &&
      parent.guard.action.kind === "internal_owner_recovery" &&
      parent.guard.action.successorMembershipRequirementId === requirement.id &&
      parent.guard.action.successorEmployeeId === targetEmployeeId
    ) {
      continue;
    }
    if (
      parent.guard.profileId === "core:rbac.guard.internal_membership" &&
      parent.guard.membershipChange !== undefined &&
      parent.guard.membershipChange.successorOwner !== null &&
      parent.guard.membershipChange.successorOwnerRequirementId ===
        requirement.id &&
      parent.guard.membershipChange.successorOwner.employeeId ===
        targetEmployeeId
    ) {
      continue;
    }
    return false;
  }
  return true;
}

function supportingWorkDestinationAuthoritiesAreBound(
  requirements: readonly InboxV2AuthorizationRequirement[],
  companions: ReadonlyMap<string, readonly string[]>
): boolean {
  for (const requirement of requirements) {
    if (
      requirement.guard.profileId !== "core:rbac.guard.work_item_state" ||
      requirement.guard.authorizationMode !== "destination_authority"
    ) {
      continue;
    }
    if (
      requirement.authorizationSubject.kind !== "actor" ||
      requirement.visibility !== "secondary_hidden"
    ) {
      return false;
    }
    const supportingGuard = requirement.guard;
    const parents = requirements.filter((candidate) => {
      const parentGuard = candidate.guard;
      if (
        candidate.authorizationSubject.kind !== "actor" ||
        parentGuard.profileId !== "core:rbac.guard.work_item_state" ||
        parentGuard.authorizationMode !== "operation" ||
        candidate.permissionId !== requirement.permissionId ||
        !sameEntityKey(candidate.resource, requirement.resource) ||
        !(companions.get(candidate.id) ?? []).includes(requirement.id)
      ) {
        return false;
      }
      return parentGuard.destinationRequirementIds.some((id, index) => {
        const destinationResource = parentGuard.destinationResources[index];
        return (
          id === requirement.id &&
          destinationResource !== undefined &&
          supportingGuard.authorityTargetResource !== null &&
          sameEntityKey(
            destinationResource,
            supportingGuard.authorityTargetResource
          )
        );
      });
    });
    if (parents.length !== 1) return false;
  }
  return true;
}

function permissionForWorkOperation(
  operation: InboxV2WorkItemStateGuard["operation"]
): InboxV2PermissionId {
  const permissionByOperation: Readonly<
    Record<InboxV2WorkItemStateGuard["operation"], InboxV2PermissionId>
  > = {
    read: "core:work.read",
    claim: "core:work.claim",
    assign: "core:work.assign",
    servicing_team_manage: "core:work.servicing_team.manage",
    release_self: "core:work.release_self",
    release_other: "core:work.release_other",
    transfer: "core:work.transfer",
    close: "core:work.close",
    reopen: "core:work.reopen",
    override: "core:work.override"
  };
  return permissionByOperation[operation];
}

function requiredWorkDestinationEntityTypes(
  operation: InboxV2WorkItemStateGuard["operation"]
): readonly string[] {
  switch (operation) {
    case "assign":
      return ["core:employee", "core:work-queue"];
    case "claim":
      return ["core:work-queue"];
    case "servicing_team_manage":
      return ["core:team"];
    case "transfer":
    case "reopen":
    case "release_self":
    case "release_other":
      return ["core:work-queue"];
    default:
      return [];
  }
}

/** Capabilities are outputs only and expire at the authorization boundary. */
export function deriveInboxV2Capabilities(
  decision: InboxV2AuthorizationDecision
): readonly InboxV2DerivedCapability[] {
  if (decision.outcome === "denied") {
    return Object.freeze([]);
  }

  return Object.freeze(
    decision.requirements
      .filter((requirement) => requirement.authorizationSubjectKind === "actor")
      .map((requirement) =>
        Object.freeze({
          kind: "inbox_v2_derived_capability" as const,
          tenantId: decision.tenantId,
          requirementId: requirement.requirementId,
          permissionId: requirement.permissionId,
          resource: immutableEntityKey(requirement.resource),
          scopeType: requirement.matchedScope.type,
          notAfter: decision.notAfter
        })
      )
  );
}

/** The only decision shape that may cross a public API disclosure boundary. */
export function toInboxV2PublicAuthorizationDecision(
  decision: InboxV2AuthorizationDecision
): InboxV2PublicAuthorizationDecision {
  return decision.outcome === "allowed"
    ? Object.freeze({ outcome: "allowed", notAfter: decision.notAfter })
    : Object.freeze({
        outcome: "denied",
        errorCode: decision.publicErrorCode
      });
}

function evaluatePrincipal(input: InboxV2AuthorizationPlanInput):
  | Readonly<{
      outcome: "allowed";
      principalKind: "employee" | "trusted_service";
      principalId: string;
      notAfter: InboxV2PolicyTimestamp;
    }>
  | Readonly<{
      outcome: "denied";
      reason: InboxV2AuthorizationInternalReason;
      publicErrorCode: InboxV2AuthorizationPublicErrorCode;
    }> {
  const { principal } = input;
  if (principal.kind === "unauthenticated") {
    return deny("principal_invalid", "auth.session_invalid");
  }

  if (input.currentAuthorization.tenantId !== input.tenantId) {
    return deny("tenant_boundary_mismatch", "resource.not_found");
  }

  if (
    (principal.kind === "employee" &&
      principal.employee.tenantId !== input.tenantId) ||
    (principal.kind === "trusted_service" &&
      principal.tenantId !== input.tenantId)
  ) {
    return deny("tenant_boundary_mismatch", "resource.not_found");
  }

  if (principal.kind === "employee") {
    if (principal.lifecycle !== "active") {
      return deny("principal_inactive", "auth.employee_inactive");
    }
    if (principal.session.state !== "active") {
      return deny("principal_invalid", "auth.session_invalid");
    }

    const snapshot = principal.session.authorization;
    if (
      !isTimestamp(principal.session.notAfter) ||
      !isTimestamp(snapshot.evaluatedAt) ||
      !isTimestamp(snapshot.notAfter) ||
      (snapshot.nextAuthorizationBoundary !== null &&
        !isTimestamp(snapshot.nextAuthorizationBoundary)) ||
      snapshot.tenantId !== input.tenantId ||
      snapshot.employee.tenantId !== input.tenantId ||
      snapshot.employee.id !== principal.employee.id ||
      input.currentAuthorization.principal.kind !== "employee" ||
      input.currentAuthorization.principal.employeeId !==
        principal.employee.id ||
      snapshot.value !== input.currentAuthorization.authorizationEpoch ||
      !isAtOrAfter(input.evaluatedAt, snapshot.evaluatedAt) ||
      !sameDependencyVector(
        snapshot.dependencies,
        input.currentAuthorization.dependencies
      )
    ) {
      return deny("authorization_epoch_stale", "auth.access_revision_stale");
    }

    const notAfter = earliestTimestamp([
      principal.session.notAfter,
      snapshot.notAfter,
      snapshot.nextAuthorizationBoundary
    ]);
    if (notAfter === null || !isStrictlyAfter(notAfter, input.evaluatedAt)) {
      return deny("temporal_boundary_reached", "auth.access_revision_stale");
    }

    return Object.freeze({
      outcome: "allowed",
      principalKind: "employee",
      principalId: String(principal.employee.id),
      notAfter
    });
  }

  if (principal.registrationState !== "active") {
    return deny("principal_invalid", "auth.session_invalid");
  }
  if (!isTimestamp(principal.notAfter)) {
    return deny("principal_invalid", "auth.session_invalid");
  }
  if (
    input.currentAuthorization.principal.kind !== "trusted_service" ||
    input.currentAuthorization.principal.trustedServiceId !==
      principal.trustedServiceId ||
    principal.authorizationEpoch !==
      input.currentAuthorization.authorizationEpoch ||
    !sameDependencyVector(
      principal.dependencies,
      input.currentAuthorization.dependencies
    )
  ) {
    return deny("authorization_epoch_stale", "auth.access_revision_stale");
  }
  if (!isStrictlyAfter(principal.notAfter, input.evaluatedAt)) {
    return deny("temporal_boundary_reached", "auth.access_revision_stale");
  }

  return Object.freeze({
    outcome: "allowed",
    principalKind: "trusted_service",
    principalId: String(principal.trustedServiceId),
    notAfter: principal.notAfter
  });
}

function evaluateRequirement(
  actorContext: EvaluationContext,
  requirement: InboxV2AuthorizationRequirement
): Readonly<{
  decision: InboxV2RequirementDecision;
  companionRequirementIds: readonly string[];
}> {
  const subjectContext = contextForRequirement(actorContext, requirement);
  if (subjectContext.outcome === "denied") {
    return requirementDeny(
      requirement,
      subjectContext.reason,
      subjectContext.publicErrorCode
    );
  }
  const context = subjectContext.context;
  const { input } = context;
  if (requirement.resource.tenantId !== input.tenantId) {
    return requirementDeny(
      requirement,
      "tenant_boundary_mismatch",
      "resource.not_found"
    );
  }

  const definition = getInboxV2PermissionDefinition(requirement.permissionId);
  if (definition === undefined) {
    return requirementDeny(
      requirement,
      "unknown_permission",
      "permission.denied"
    );
  }
  if (definition.guardProfileId !== requirement.guard.profileId) {
    return requirementDeny(
      requirement,
      "hard_boundary_denied",
      "permission.denied"
    );
  }
  if (!guardTargetsCanonicalResource(definition.id, requirement)) {
    return requirementDeny(
      requirement,
      "hard_boundary_denied",
      "permission.denied"
    );
  }

  if (
    context.authorizationSubjectKind === "actor" &&
    context.input.principal.kind === "trusted_service" &&
    !context.input.principal.allowedPermissionIds.includes(definition.id)
  ) {
    return requirementDeny(
      requirement,
      "illegal_principal",
      "permission.denied"
    );
  }

  const dependency =
    context.currentAuthorization.dependencies.resourceDependencies.find(
      ({ resource }) => sameEntityKey(resource, requirement.resource)
    );
  if (
    dependency === undefined ||
    String(dependency.accessRevision) !== requirement.resourceAccessRevision
  ) {
    return requirementDeny(
      requirement,
      "revision_guard_failed",
      "auth.access_revision_stale"
    );
  }

  const activeGrantMatches: Array<
    Readonly<{
      grant: InboxV2PolicyGrant;
      boundary: InboxV2PolicyTimestamp | null;
    }>
  > = [];
  let sawPermissionGrant = false;
  let sawLegalScope = false;
  let sawInactiveTemporalGrant = false;
  let sawActiveTemporalGrant = false;
  let sawInvalidGrantProvenance = false;
  let scopeFailure: ScopeFailureReason = "scope_not_matched";

  for (const grant of input.grants) {
    if (!grantProvenanceIsValid(grant)) {
      sawInvalidGrantProvenance = true;
      continue;
    }
    if (
      grant.tenantId !== input.tenantId ||
      grant.scope.tenantId !== input.tenantId ||
      grant.permissionId !== definition.id ||
      !grantTargetsPrincipal(grant, context.principalKind, context.principalId)
    ) {
      continue;
    }
    sawPermissionGrant = true;

    const legality = evaluateInboxV2PermissionScopePairLegality({
      permissionId: grant.permissionId,
      scope: grant.scope,
      principalKind: context.principalKind
    });
    if (legality.kind === "rejected") {
      continue;
    }
    sawLegalScope = true;
    if (!isGrantActive(grant, input.evaluatedAt)) {
      sawInactiveTemporalGrant = true;
      continue;
    }
    sawActiveTemporalGrant = true;

    const match = matchScope(
      grant.scope,
      requirement.scopeFacts,
      requirement.resource,
      context,
      input.evaluatedAt
    );
    if (!match.matched) {
      scopeFailure = strongerScopeFailure(scopeFailure, match.reason);
      continue;
    }

    activeGrantMatches.push(
      Object.freeze({
        grant,
        boundary: earliestTimestamp([
          grant.validUntil,
          futureTimestamp(grant.revokedAt, input.evaluatedAt),
          match.boundary
        ])
      })
    );
  }

  if (activeGrantMatches.length === 0) {
    const reason: InboxV2AuthorizationInternalReason = sawInvalidGrantProvenance
      ? "hard_boundary_denied"
      : !sawPermissionGrant
        ? "missing_permission"
        : !sawLegalScope
          ? "illegal_scope"
          : sawInactiveTemporalGrant && !sawActiveTemporalGrant
            ? "temporal_boundary_reached"
            : scopeFailure;
    return requirementDeny(
      requirement,
      reason,
      reason === "temporal_boundary_reached"
        ? "auth.access_revision_stale"
        : "permission.denied"
    );
  }

  const guardEligibleGrantMatches = activeGrantMatches.filter(({ grant }) =>
    requirement.permissionId === "core:conversation.internal.break_glass_read"
      ? grant.source.kind === "direct_grant" &&
        grant.scope.type === "conversation"
      : true
  );
  if (guardEligibleGrantMatches.length === 0) {
    return requirementDeny(
      requirement,
      "hard_boundary_denied",
      "permission.denied"
    );
  }

  if (
    requirement.expectedResourceAccessRevision !== null &&
    requirement.expectedResourceAccessRevision !==
      requirement.resourceAccessRevision
  ) {
    return requirementDeny(
      requirement,
      "revision_guard_failed",
      "revision.conflict"
    );
  }
  if (
    requirement.revisionChecks.some((check) => check.expected !== check.actual)
  ) {
    return requirementDeny(
      requirement,
      "revision_guard_failed",
      "revision.conflict"
    );
  }
  if (!guardRelationIsCanonicallyAnchored(requirement, context)) {
    return requirementDeny(
      requirement,
      "canonical_relation_not_matched",
      "permission.denied"
    );
  }

  const guardResult = evaluateGuard(
    requirement.permissionId as InboxV2PermissionId,
    requirement.guard,
    context,
    requirement.resource
  );
  if (guardResult.outcome === "denied") {
    return requirementDeny(
      requirement,
      guardResult.reason,
      guardResult.publicErrorCode
    );
  }

  const candidates = guardEligibleGrantMatches
    .map(({ grant, boundary }) => ({
      grant,
      notAfter: earliestTimestamp([
        context.principalNotAfter,
        boundary,
        ...guardResult.boundaries
      ])
    }))
    .filter(
      (
        candidate
      ): candidate is {
        grant: InboxV2PolicyGrant;
        notAfter: InboxV2PolicyTimestamp;
      } =>
        candidate.notAfter !== null &&
        isStrictlyAfter(candidate.notAfter, input.evaluatedAt) &&
        requestedMutationHorizonIsContained(
          requirement.guard,
          candidate.notAfter
        )
    )
    .sort((left, right) =>
      left.notAfter === right.notAfter
        ? left.grant.id.localeCompare(right.grant.id)
        : Date.parse(right.notAfter) - Date.parse(left.notAfter)
    );
  const selected = candidates[0];
  if (selected === undefined) {
    return requirementDeny(
      requirement,
      "temporal_boundary_reached",
      "auth.access_revision_stale"
    );
  }

  return Object.freeze({
    decision: Object.freeze({
      outcome: "allowed",
      requirementId: requirement.id,
      permissionId: definition.id,
      resource: immutableEntityKey(requirement.resource),
      matchedGrantId: selected.grant.id,
      matchedScope: immutablePermissionScope(selected.grant.scope),
      notAfter: selected.notAfter,
      authorizationSubjectKind: context.authorizationSubjectKind
    }),
    companionRequirementIds: guardResult.companionRequirementIds
  });
}

function requestedMutationHorizonIsContained(
  guard: InboxV2PolicyGuardEvidence,
  authorityNotAfter: InboxV2PolicyTimestamp
): boolean {
  const requestedNotAfter =
    guard.profileId === "core:rbac.guard.canonical_resource" &&
    guard.action.kind === "delegation_change"
      ? guard.action.validUntil
      : guard.profileId === "core:rbac.guard.internal_break_glass_issue"
        ? guard.validUntil
        : null;
  return (
    requestedNotAfter === null ||
    !isStrictlyAfter(requestedNotAfter, authorityNotAfter)
  );
}

function guardRelationIsCanonicallyAnchored(
  requirement: InboxV2AuthorizationRequirement,
  context: EvaluationContext
): boolean {
  const { guard } = requirement;
  const facts = requirement.scopeFacts.filter(
    (fact) =>
      scopeFactIsInternallyConsistent(fact, context.input.evaluatedAt) &&
      sameEntityKey(fact.resource, requirement.resource) &&
      isTemporalFactActive(fact, context.input.evaluatedAt)
  );
  const responsible = (workItemId: InboxV2WorkItemId): boolean =>
    context.employeeId !== null &&
    facts.some(
      (fact) =>
        fact.kind === "responsible" &&
        fact.employeeId === context.employeeId &&
        fact.workItemId === workItemId &&
        fact.state === "active" &&
        fact.assignmentRevision === fact.currentAssignmentRevision
    );
  const workCollaborator = (workItemId: InboxV2WorkItemId): boolean =>
    context.employeeId !== null &&
    facts.some(
      (fact) =>
        fact.kind === "collaborator" &&
        fact.employeeId === context.employeeId &&
        fact.state === "active" &&
        fact.episodeRevision === fact.currentEpisodeRevision &&
        fact.subject.kind === "work_item" &&
        fact.subject.workItemId === workItemId &&
        fact.subject.workCycle === fact.subject.currentWorkCycle
    );

  if (guard.profileId === "core:rbac.guard.internal_membership") {
    return (
      context.employeeId !== null &&
      guard.employeeId === context.employeeId &&
      facts.some(
        (fact) =>
          fact.kind === "internal_participant" &&
          fact.employeeId === guard.employeeId &&
          fact.conversationId === guard.conversationId &&
          fact.state === guard.membershipState &&
          fact.origin === guard.membershipOrigin &&
          fact.role === guard.membershipRole &&
          fact.membershipRevision === fact.currentMembershipRevision &&
          sameEntityKey(fact.scopeTarget, requirement.resource)
      )
    );
  }

  if (guard.profileId === "core:rbac.guard.work_item_state") {
    if (guard.authorizationMode === "destination_authority") {
      if (guard.authorityTargetResource === null) return false;
      return facts.some((fact) => {
        if (!sameEntityKey(fact.scopeTarget, guard.authorityTargetResource!)) {
          return false;
        }
        return (
          (guard.authorityTargetResource!.entityTypeId === "core:work-queue" &&
            fact.kind === "queue") ||
          (guard.authorityTargetResource!.entityTypeId === "core:team" &&
            fact.kind === "team") ||
          (guard.authorityTargetResource!.entityTypeId === "core:org-unit" &&
            fact.kind === "org_unit")
        );
      });
    }
    return guard.actorRelation === "primary_responsible"
      ? responsible(guard.workItemId)
      : guard.actorRelation === "work_item_collaborator"
        ? workCollaborator(guard.workItemId)
        : true;
  }
  if (
    guard.profileId === "core:rbac.guard.external_route" &&
    guard.authorizationMode === "destination_authority"
  ) {
    return true;
  }
  if (
    guard.profileId === "core:rbac.guard.external_route" &&
    guard.workItemId !== null
  ) {
    if (guard.actorRelation === "primary_responsible") {
      return responsible(guard.workItemId);
    }
    if (guard.actorRelation === "work_item_collaborator") {
      return workCollaborator(guard.workItemId);
    }
  }
  if (
    guard.profileId === "core:rbac.guard.external_route" &&
    guard.actorRelation === "conversation_collaborator"
  ) {
    return (
      context.employeeId !== null &&
      facts.some(
        (fact) =>
          fact.kind === "collaborator" &&
          fact.employeeId === context.employeeId &&
          fact.state === "active" &&
          fact.episodeRevision === fact.currentEpisodeRevision &&
          fact.subject.kind === "conversation" &&
          sameEntityKey(fact.scopeTarget, requirement.resource)
      )
    );
  }
  return true;
}

function clientMutationCompanionsAreValid(
  requirement: InboxV2AuthorizationRequirement,
  requirements: readonly InboxV2AuthorizationRequirement[],
  decisions: ReadonlyMap<string, InboxV2RequirementDecision>
): boolean {
  if (requirement.guard.profileId !== "core:rbac.guard.client_context") {
    return true;
  }
  const mutation = requirement.guard.mutation;
  if (mutation === undefined) return true;
  const byId = (id: string): InboxV2AuthorizationRequirement | undefined =>
    requirements.find((candidate) => candidate.id === id);
  const allowedDecision = (id: string): InboxV2RequirementAllow | undefined => {
    const decision = decisions.get(id);
    return decision?.outcome === "allowed" ? decision : undefined;
  };

  if (mutation.kind === "access_binding_change") {
    return mutation.targetAuthorities.every((authority) => {
      const companion = byId(authority.requirementId);
      const decision = allowedDecision(authority.requirementId);
      if (
        companion?.guard.profileId !== "core:rbac.guard.client_context" ||
        companion.guard.mutation?.kind !== "access_binding_target_authority" ||
        companion.permissionId !== "core:client.access_binding.manage" ||
        companion.authorizationSubject.kind !== "actor" ||
        companion.visibility !== "secondary_hidden" ||
        decision === undefined
      ) {
        return false;
      }
      const evidence = companion.guard.mutation;
      const parentRevisionChecks =
        authority.side === "old"
          ? mutation.oldRelationRevisionChecks
          : mutation.newRelationRevisionChecks;
      return (
        sameEntityKey(companion.resource, mutation.clientResource) &&
        sameEntityKey(evidence.clientResource, mutation.clientResource) &&
        sameEntityKey(
          evidence.bindingSetResource,
          mutation.bindingSetResource
        ) &&
        evidence.side === authority.side &&
        sameEntityKey(evidence.targetResource, authority.targetResource) &&
        samePolicyRevisionChecks(
          evidence.relationRevisionChecks,
          parentRevisionChecks
        ) &&
        permissionScopeTargetsResource(
          decision.matchedScope,
          authority.targetResource
        )
      );
    });
  }

  if (mutation.kind === "access_binding_target_authority") {
    const parents = requirements.filter((candidate) => {
      if (
        candidate.guard.profileId !== "core:rbac.guard.client_context" ||
        candidate.guard.mutation?.kind !== "access_binding_change"
      ) {
        return false;
      }
      return candidate.guard.mutation.targetAuthorities.some(
        (authority) =>
          authority.requirementId === requirement.id &&
          authority.side === mutation.side &&
          sameEntityKey(authority.targetResource, mutation.targetResource)
      );
    });
    return parents.length === 1;
  }

  if (mutation.kind === "conversation_client_links_change") {
    return mutation.targets.every((target) => {
      const companion = byId(target.clientRequirementId);
      const decision = allowedDecision(target.clientRequirementId);
      if (
        companion?.guard.profileId !== "core:rbac.guard.client_context" ||
        companion.guard.mutation?.kind !== "client_link_target_authority" ||
        companion.permissionId !== "core:client.link.manage" ||
        companion.authorizationSubject.kind !== "actor" ||
        companion.visibility !== "secondary_hidden" ||
        decision === undefined
      ) {
        return false;
      }
      const evidence = companion.guard.mutation;
      return (
        sameEntityKey(companion.resource, target.clientResource) &&
        sameEntityKey(evidence.clientResource, target.clientResource) &&
        evidence.operation === mutation.operation &&
        sameEntityKey(
          evidence.conversationResource,
          mutation.conversationResource
        ) &&
        sameEntityKey(evidence.linkResource, target.linkResource) &&
        sameEntityKey(
          evidence.relationConversationResource,
          target.relationConversationResource
        ) &&
        sameEntityKey(
          evidence.relationClientResource,
          target.relationClientResource
        ) &&
        evidence.expectedLinkRevision === target.expectedLinkRevision &&
        evidence.currentLinkRevision === target.currentLinkRevision &&
        samePolicyRevisionChecks(
          evidence.relationRevisionChecks,
          target.relationRevisionChecks
        ) &&
        sameEntityKey(evidence.manifestResource, mutation.manifestResource) &&
        sameEntityKey(
          evidence.manifestConversationResource,
          mutation.manifestConversationResource
        ) &&
        evidence.manifestTargetCount === mutation.manifestTargetCount &&
        evidence.manifestTargetSetDigest === mutation.manifestTargetSetDigest &&
        samePolicyRevisionChecks(
          evidence.manifestRevisionChecks,
          mutation.manifestRevisionChecks
        ) &&
        evidence.reason === mutation.reason &&
        sameEntityKey(
          evidence.auditEventResource,
          mutation.auditEventResource
        ) &&
        sameEntityKey(
          evidence.auditConversationResource,
          mutation.auditConversationResource
        )
      );
    });
  }

  if (mutation.kind === "client_link_target_authority") {
    const parents = requirements.filter((candidate) => {
      if (
        candidate.guard.profileId !== "core:rbac.guard.client_context" ||
        candidate.guard.mutation?.kind !== "conversation_client_links_change"
      ) {
        return false;
      }
      return candidate.guard.mutation.targets.some(
        (target) =>
          target.clientRequirementId === requirement.id &&
          sameEntityKey(target.clientResource, mutation.clientResource) &&
          sameEntityKey(target.linkResource, mutation.linkResource)
      );
    });
    return parents.length === 1;
  }

  return true;
}

function clientPathCompanionsAreValid(
  requirement: InboxV2AuthorizationRequirement,
  guard: InboxV2ClientContextGuard,
  decisions: ReadonlyMap<string, InboxV2RequirementDecision>,
  byId: (id: string) => InboxV2AuthorizationRequirement | undefined,
  isAllowed: (id: string) => boolean
): boolean {
  const decision = decisions.get(requirement.id);
  if (decision?.outcome !== "allowed") return false;

  const pathResources: readonly InboxV2EntityKey[] =
    guard.pathEvidence.kind === "active_conversation_link"
      ? [guard.pathEvidence.conversationResource]
      : guard.pathEvidence.kind === "current_work_item_queue" ||
          guard.pathEvidence.kind === "current_responsible"
        ? [
            guard.pathEvidence.conversationResource,
            guard.pathEvidence.workItemResource
          ]
        : [];
  const sensitiveClientResource =
    requirement.permissionId === "core:client.fields.view_sensitive" ||
    requirement.permissionId === "core:client.fields.edit"
      ? guard.target.kind === "client"
        ? guard.pathEvidence.clientResource
        : null
      : null;
  if (
    (requirement.permissionId === "core:client.fields.view_sensitive" ||
      requirement.permissionId === "core:client.fields.edit") &&
    sensitiveClientResource === null
  ) {
    return false;
  }
  const expectedResources = uniqueEntityResources([
    ...pathResources,
    ...(sensitiveClientResource === null ? [] : [sensitiveClientResource])
  ]);
  if (
    guard.contextualRequirementIds.length !== expectedResources.length ||
    new Set(guard.contextualRequirementIds).size !==
      guard.contextualRequirementIds.length
  ) {
    return false;
  }
  const companionsValid = guard.contextualRequirementIds.every((id) => {
    const companion = byId(id);
    if (
      companion === undefined ||
      companion.authorizationSubject.kind !== "actor" ||
      companion.visibility !== "secondary_hidden" ||
      !isAllowed(id)
    ) {
      return false;
    }
    const expected = expectedResources.find((resource) =>
      sameEntityKey(resource, companion.resource)
    );
    if (expected === undefined) return false;
    return expected.entityTypeId === "core:client"
      ? companion.permissionId === "core:client.view"
      : expected.entityTypeId === "core:conversation"
        ? companion.permissionId === "core:conversation.read"
        : expected.entityTypeId === "core:work-item" &&
          companion.permissionId === "core:work.read";
  });
  if (!companionsValid) return false;

  const evidence = guard.pathEvidence;
  if (evidence.kind === "exact_client_binding") {
    return permissionScopeTargetsResource(
      decision.matchedScope,
      evidence.authorityResource
    );
  }
  if (evidence.kind === "current_work_item_queue") {
    return (
      decision.matchedScope.type === "queue" &&
      permissionScopeTargetsResource(
        decision.matchedScope,
        evidence.queueResource
      )
    );
  }
  if (evidence.kind === "current_responsible") {
    return decision.matchedScope.type === "responsible";
  }
  if (evidence.kind === "client_owner") {
    return decision.matchedScope.type === "client_owner";
  }
  return true;
}

function samePolicyRevisionChecks(
  left: readonly InboxV2PolicyRevisionCheck[],
  right: readonly InboxV2PolicyRevisionCheck[]
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (check, index) =>
        check.kind === right[index]?.kind &&
        check.expected === right[index]?.expected &&
        check.actual === right[index]?.actual
    )
  );
}

function contextForRequirement(
  actorContext: EvaluationContext,
  requirement: InboxV2AuthorizationRequirement
):
  | Readonly<{ outcome: "allowed"; context: EvaluationContext }>
  | Readonly<{
      outcome: "denied";
      reason: InboxV2AuthorizationInternalReason;
      publicErrorCode: InboxV2AuthorizationPublicErrorCode;
    }> {
  const { authorizationSubject } = requirement;
  if (authorizationSubject.kind === "actor") {
    return Object.freeze({ outcome: "allowed", context: actorContext });
  }

  const {
    employee: subjectEmployee,
    authorization,
    currentAuthorization
  } = authorizationSubject;
  if (
    subjectEmployee.tenantId !== actorContext.input.tenantId ||
    authorization.tenantId !== actorContext.input.tenantId ||
    currentAuthorization.tenantId !== actorContext.input.tenantId
  ) {
    return deny("tenant_boundary_mismatch", "resource.not_found");
  }
  if (authorizationSubject.lifecycle !== "active") {
    return deny("principal_inactive", "auth.employee_inactive");
  }
  if (
    !isTimestamp(authorizationSubject.notAfter) ||
    !isTimestamp(authorization.evaluatedAt) ||
    !isTimestamp(authorization.notAfter) ||
    (authorization.nextAuthorizationBoundary !== null &&
      !isTimestamp(authorization.nextAuthorizationBoundary)) ||
    authorization.employee.id !== subjectEmployee.id ||
    authorization.employee.tenantId !== subjectEmployee.tenantId ||
    currentAuthorization.principal.kind !== "employee" ||
    currentAuthorization.principal.employeeId !== subjectEmployee.id ||
    authorization.value !== currentAuthorization.authorizationEpoch ||
    !sameDependencyVector(
      authorization.dependencies,
      currentAuthorization.dependencies
    ) ||
    !isAtOrAfter(actorContext.input.evaluatedAt, authorization.evaluatedAt)
  ) {
    return deny("authorization_epoch_stale", "auth.access_revision_stale");
  }

  const notAfter = earliestTimestamp([
    authorizationSubject.notAfter,
    authorization.notAfter,
    authorization.nextAuthorizationBoundary
  ]);
  if (
    notAfter === null ||
    !isStrictlyAfter(notAfter, actorContext.input.evaluatedAt)
  ) {
    return deny("temporal_boundary_reached", "auth.access_revision_stale");
  }

  return Object.freeze({
    outcome: "allowed",
    context: Object.freeze({
      ...actorContext,
      principalKind: "employee",
      principalId: String(subjectEmployee.id),
      principalNotAfter: notAfter,
      employeeId: subjectEmployee.id,
      currentAuthorization,
      authorizationSubjectKind: "independent_employee"
    })
  });
}

function evaluateGuard(
  permissionId: InboxV2PermissionId,
  guard: InboxV2PolicyGuardEvidence,
  context: EvaluationContext,
  requirementResource: InboxV2EntityKey
): GuardResult {
  const actorEmployeeId = context.employeeId;

  switch (guard.profileId) {
    case "core:rbac.guard.canonical_resource": {
      if (guard.resourceState !== "active") {
        return guardDeny("state_guard_failed", "permission.denied");
      }
      if (
        permissionId === "core:conversation.read" &&
        guard.contentBoundary !== "external"
      ) {
        return guardDeny("hard_boundary_denied", "permission.denied");
      }
      if (
        guard.contentBoundary === "staff_only" &&
        !permissionId.startsWith("core:message.staff_note.")
      ) {
        return guardDeny("hard_boundary_denied", "permission.denied");
      }
      if (guard.routeInputFields.length > 0) {
        return guardDeny(
          "hard_boundary_denied",
          permissionId.startsWith("core:message.staff_note.")
            ? "message.staff_only_route_forbidden"
            : "route.forbidden"
        );
      }
      if (permissionId.startsWith("core:message.staff_note.")) {
        if (
          guard.contentBoundary !== "staff_only" ||
          guard.companionRequirementIds.length === 0
        ) {
          return guardDeny("hard_boundary_denied", "permission.denied");
        }
      }
      const action = evaluateCanonicalAction(
        permissionId,
        guard.action,
        context
      );
      if (action.outcome === "denied") {
        return action;
      }
      return guardAllow(
        [...guard.companionRequirementIds, ...action.companionRequirementIds],
        ...action.boundaries
      );
    }
    case "core:rbac.guard.internal_membership": {
      if (
        actorEmployeeId === null ||
        guard.employeeId !== actorEmployeeId ||
        guard.membershipState !== "active" ||
        guard.membershipOrigin !== "hulee_internal_command" ||
        guard.contentBoundary !== "internal"
      ) {
        return guardDeny(
          "canonical_relation_not_matched",
          "conversation.internal_membership_required"
        );
      }
      if (
        permissionId === "core:message.send_internal" &&
        guard.membershipRole === "observer"
      ) {
        return guardDeny("hard_boundary_denied", "permission.denied");
      }
      if (
        (permissionId === "core:conversation.internal.members.manage" ||
          permissionId === "core:message.moderate_internal") &&
        guard.membershipRole !== "owner" &&
        guard.membershipRole !== "admin"
      ) {
        return guardDeny("hard_boundary_denied", "permission.denied");
      }
      if (permissionId === "core:conversation.internal.members.manage") {
        const change = guard.membershipChange;
        if (
          change === undefined ||
          guard.moderationAction !== undefined ||
          !internalMembershipChangeIsCurrent(
            change,
            requirementResource,
            actorEmployeeId,
            context.input.tenantId
          )
        ) {
          return guardDeny("revision_guard_failed", "revision.conflict");
        }
        return guardAllow(
          [
            change.targetDirectoryRequirementId,
            ...(change.successorOwnerRequirementId === null
              ? []
              : [change.successorOwnerRequirementId])
          ],
          guard.validUntil
        );
      }
      if (permissionId === "core:message.moderate_internal") {
        const action = guard.moderationAction;
        if (
          guard.membershipChange !== undefined ||
          action === undefined ||
          !sameEntityKey(
            action.topologyConversationResource,
            requirementResource
          ) ||
          !sameEntityKey(action.contentReadResource, requirementResource)
        ) {
          return guardDeny("hard_boundary_denied", "permission.denied");
        }
        const moderation = evaluateCanonicalAction(
          permissionId,
          action,
          context
        );
        if (moderation.outcome === "denied") {
          return moderation;
        }
        return guardAllow(
          moderation.companionRequirementIds,
          guard.validUntil,
          ...moderation.boundaries
        );
      }
      if (
        guard.membershipChange !== undefined ||
        guard.moderationAction !== undefined
      ) {
        return guardDeny("hard_boundary_denied", "permission.denied");
      }
      return guardAllow([], guard.validUntil);
    }
    case "core:rbac.guard.internal_break_glass_read": {
      if (
        actorEmployeeId === null ||
        guard.conversationId !== guard.exactGrantConversationId ||
        guard.grantKind !== "direct_grant" ||
        guard.reason.trim().length === 0 ||
        guard.auditEventId.trim().length === 0 ||
        !entityKeyMatchesOpaqueId(
          guard.audit.eventResource,
          guard.auditEventId
        ) ||
        !privilegedMutationAuditIsCurrent(
          guard.audit,
          "internal_break_glass_read",
          requirementResource,
          actorEmployeeId,
          context.input.tenantId
        ) ||
        guard.accessMode !== "read_only"
      ) {
        return guardDeny("hard_boundary_denied", "permission.denied");
      }
      return guardAllow([], guard.validUntil);
    }
    case "core:rbac.guard.internal_break_glass_issue": {
      const approval = guard.approvalEvidence;
      const alarm = guard.alarmEvidence;
      const policySelection = guard.policySelection;
      const approverGrant = matchActiveEmployeeGrantForScope(
        context.input,
        guard.approverGrantId,
        guard.approverEmployeeId,
        "core:conversation.internal.break_glass.issue",
        {
          type: "conversation",
          tenantId: context.input.tenantId,
          id: guard.conversationId
        }
      );
      if (
        actorEmployeeId === null ||
        guard.requesterEmployeeId !== actorEmployeeId ||
        guard.requesterEmployeeId === guard.approverEmployeeId ||
        guard.approverEmployeeId === guard.targetEmployeeId ||
        guard.approverLifecycle !== "active" ||
        guard.targetLifecycle !== "active" ||
        guard.approverEmployeeResource.entityTypeId !== "core:employee" ||
        !entityKeyMatchesOpaqueId(
          guard.approverEmployeeResource,
          String(guard.approverEmployeeId)
        ) ||
        guard.targetEmployeeResource.entityTypeId !== "core:employee" ||
        !entityKeyMatchesOpaqueId(
          guard.targetEmployeeResource,
          String(guard.targetEmployeeId)
        ) ||
        guard.approverEmployeeResource.tenantId !== context.input.tenantId ||
        guard.targetEmployeeResource.tenantId !== context.input.tenantId ||
        approval.resource.entityTypeId !== "core:break-glass-approval" ||
        [
          approval.resource,
          approval.conversationResource,
          approval.requesterEmployeeResource,
          approval.approverEmployeeResource,
          approval.targetEmployeeResource
        ].some((resource) => resource.tenantId !== context.input.tenantId) ||
        !sameEntityKey(
          approval.conversationResource,
          guard.policyConversationResource
        ) ||
        approval.requesterEmployeeResource.entityTypeId !== "core:employee" ||
        !entityKeyMatchesOpaqueId(
          approval.requesterEmployeeResource,
          String(guard.requesterEmployeeId)
        ) ||
        !sameEntityKey(
          approval.approverEmployeeResource,
          guard.approverEmployeeResource
        ) ||
        !sameEntityKey(
          approval.targetEmployeeResource,
          guard.targetEmployeeResource
        ) ||
        approval.state !== "approved" ||
        !exactKeyedRevisionSetIsCurrent(approval.revisionChecks, [
          approval.resource,
          approval.conversationResource,
          approval.requesterEmployeeResource,
          approval.approverEmployeeResource,
          approval.targetEmployeeResource
        ]) ||
        !isTimestamp(approval.notAfter) ||
        !isStrictlyAfter(approval.notAfter, context.input.evaluatedAt) ||
        guard.alarmEventId === null ||
        guard.alarmEventId.trim().length === 0 ||
        alarm === null ||
        alarm.resource.entityTypeId !== "core:security-alarm-event" ||
        !entityKeyMatchesOpaqueId(alarm.resource, guard.alarmEventId) ||
        !sameEntityKey(
          alarm.conversationResource,
          guard.policyConversationResource
        ) ||
        alarm.actorEmployeeResource.entityTypeId !== "core:employee" ||
        !entityKeyMatchesOpaqueId(
          alarm.actorEmployeeResource,
          String(guard.requesterEmployeeId)
        ) ||
        alarm.action !== "internal_break_glass_issue" ||
        ![
          alarm.resource,
          alarm.conversationResource,
          alarm.actorEmployeeResource
        ].every((resource) => resource.tenantId === context.input.tenantId) ||
        !exactKeyedRevisionSetIsCurrent(alarm.revisionChecks, [
          alarm.resource,
          alarm.conversationResource,
          alarm.actorEmployeeResource
        ]) ||
        guard.policyResource.entityTypeId !== "core:break-glass-policy" ||
        guard.policyResource.tenantId !== context.input.tenantId ||
        guard.policyConversationResource.entityTypeId !== "core:conversation" ||
        !entityKeyMatchesOpaqueId(
          guard.policyConversationResource,
          String(guard.conversationId)
        ) ||
        guard.policyBindingResource.entityTypeId !==
          "core:break-glass-policy-binding" ||
        guard.policyBindingResource.tenantId !== context.input.tenantId ||
        !sameEntityKey(
          guard.policyBindingPolicyResource,
          guard.policyResource
        ) ||
        !sameEntityKey(
          guard.policyBindingConversationResource,
          guard.policyConversationResource
        ) ||
        !exactKeyedRevisionSetIsCurrent(guard.policyRevisionChecks, [
          guard.policyResource,
          guard.policyBindingResource,
          guard.policyConversationResource
        ]) ||
        guard.policyDigest.trim().length === 0 ||
        policySelection.resource.entityTypeId !==
          "core:break-glass-policy-selection" ||
        policySelection.resource.tenantId !== context.input.tenantId ||
        !entityKeyMatchesCanonicalSingletonId(
          policySelection.resource,
          "break_glass_policy_selection",
          String(guard.conversationId)
        ) ||
        !sameEntityKey(
          policySelection.conversationResource,
          guard.policyConversationResource
        ) ||
        !sameEntityKey(
          policySelection.selectedPolicyResource,
          guard.policyResource
        ) ||
        !sameEntityKey(
          policySelection.selectedBindingResource,
          guard.policyBindingResource
        ) ||
        policySelection.selectedPolicyDigest !== guard.policyDigest ||
        policySelection.selectedMaximumTtlSeconds !==
          guard.policyMaximumTtlSeconds ||
        policySelection.state !== "active" ||
        !exactKeyedRevisionSetIsCurrent(policySelection.revisionChecks, [
          policySelection.resource,
          guard.policyConversationResource,
          guard.policyResource,
          guard.policyBindingResource
        ]) ||
        ![
          guard.policyConversationResource,
          guard.policyResource,
          guard.policyBindingResource
        ].every((resource) =>
          keyedRevisionsAgree(
            policySelection.revisionChecks,
            guard.policyRevisionChecks,
            resource
          )
        ) ||
        !keyedRevisionsAgree(
          guard.policyRevisionChecks,
          approval.revisionChecks,
          guard.policyConversationResource
        ) ||
        !keyedRevisionsAgree(
          guard.policyRevisionChecks,
          alarm.revisionChecks,
          guard.policyConversationResource
        ) ||
        !keyedRevisionsAgree(
          alarm.revisionChecks,
          approval.revisionChecks,
          alarm.actorEmployeeResource
        ) ||
        !Number.isInteger(guard.maximumTtlSeconds) ||
        guard.maximumTtlSeconds <= 0 ||
        guard.maximumTtlSeconds > 86_400 ||
        !Number.isInteger(guard.policyMaximumTtlSeconds) ||
        guard.policyMaximumTtlSeconds !== guard.maximumTtlSeconds ||
        !isTimestamp(guard.validUntil) ||
        !isStrictlyAfter(guard.validUntil, context.input.evaluatedAt) ||
        Date.parse(guard.validUntil) - Date.parse(context.input.evaluatedAt) >
          guard.maximumTtlSeconds * 1_000 ||
        isStrictlyAfter(guard.validUntil, approval.notAfter) ||
        !approverGrant.matched ||
        (approverGrant.matched &&
          approverGrant.boundary !== null &&
          isStrictlyAfter(guard.validUntil, approverGrant.boundary)) ||
        guard.reason.trim().length === 0
      ) {
        return guardDeny("separation_of_duties_denied", "permission.denied");
      }
      return guardAllow(
        [
          guard.targetDirectoryRequirementId,
          guard.approverDirectoryRequirementId
        ],
        guard.validUntil,
        approval.notAfter,
        ...(approverGrant.matched ? [approverGrant.boundary] : [])
      );
    }
    case "core:rbac.guard.notification_self": {
      if (
        actorEmployeeId === null ||
        guard.targetEmployeeId !== actorEmployeeId
      ) {
        return guardDeny("hard_boundary_denied", "permission.denied");
      }
      return guardAllow([guard.targetReadRequirementId]);
    }
    case "core:rbac.guard.notification_target_read": {
      if (guard.targetLifecycle !== "active") {
        return guardDeny("state_guard_failed", "permission.denied");
      }
      return guardAllow([guard.targetReadRequirementId]);
    }
    case "core:rbac.guard.external_route":
      return evaluateExternalRouteGuard(
        permissionId,
        guard,
        context.input.evaluatedAt
      );
    case "core:rbac.guard.work_item_state": {
      if (permissionId !== permissionForWorkOperation(guard.operation)) {
        return guardDeny("hard_boundary_denied", "permission.denied");
      }
      if (guard.authorizationMode === "destination_authority") {
        if (
          guard.authorityTargetResource === null ||
          guard.authorityTargetResource.tenantId !== context.input.tenantId ||
          !["core:work-queue", "core:team", "core:org-unit"].includes(
            String(guard.authorityTargetResource.entityTypeId)
          ) ||
          guard.authorityState !== "eligible" ||
          (guard.operation === "claim"
            ? actorEmployeeId === null ||
              guard.eligibleEmployeeId !== actorEmployeeId
            : guard.eligibleEmployeeId !== null) ||
          guard.authorityRevisionChecks.length === 0 ||
          guard.authorityRevisionChecks.some(
            (check) => check.expected !== check.actual
          ) ||
          (guard.operation === "claim" &&
            !guard.authorityRevisionChecks.some(
              (check) => check.kind === "relation"
            )) ||
          guard.destinationRequirementIds.length !== 0 ||
          guard.destinationResources.length !== 0 ||
          guard.overrideRequirementId !== null
        ) {
          return guardDeny("state_guard_failed", "permission.denied");
        }
        return guardAllow([]);
      }
      if (guard.expectedStateRevision !== guard.currentStateRevision) {
        return guardDeny("revision_guard_failed", "work.state_changed");
      }
      if (
        guard.authorityTargetResource !== null ||
        guard.authorityState !== null ||
        guard.eligibleEmployeeId !== null ||
        guard.authorityRevisionChecks.length !== 0 ||
        guard.destinationRequirementIds.length !==
          guard.destinationResources.length
      ) {
        return guardDeny("hard_boundary_denied", "permission.denied");
      }
      const requiredDestinationTypes = requiredWorkDestinationEntityTypes(
        guard.operation
      );
      const hasRequiredDestinationEvidence =
        guard.destinationResources.length === requiredDestinationTypes.length &&
        requiredDestinationTypes.every(
          (entityTypeId) =>
            guard.destinationResources.filter(
              (resource) => resource.entityTypeId === entityTypeId
            ).length === 1
        );
      const assignmentEligibilityValid =
        guard.operation === "assign"
          ? (() => {
              const evidence = guard.assignmentEligibility;
              const employee = guard.destinationResources.find(
                (resource) => resource.entityTypeId === "core:employee"
              );
              const queue = guard.destinationResources.find(
                (resource) => resource.entityTypeId === "core:work-queue"
              );
              return (
                evidence !== undefined &&
                employee !== undefined &&
                queue !== undefined &&
                evidence.state === "eligible" &&
                sameEntityKey(evidence.employeeResource, employee) &&
                sameEntityKey(evidence.queueResource, queue) &&
                sameEntityKey(
                  evidence.relationEmployeeResource,
                  evidence.employeeResource
                ) &&
                sameEntityKey(
                  evidence.relationQueueResource,
                  evidence.queueResource
                ) &&
                evidence.employeeResource.tenantId === context.input.tenantId &&
                evidence.queueResource.tenantId === context.input.tenantId &&
                identityRevisionSetIsCurrent(
                  evidence.revisionChecks,
                  "relation"
                )
              );
            })()
          : guard.assignmentEligibility === undefined;
      const servicingTeamChangeValid =
        guard.operation === "servicing_team_manage"
          ? (() => {
              const evidence = guard.servicingTeamChange;
              const requestedTeam = guard.destinationResources.find(
                (resource) => resource.entityTypeId === "core:team"
              );
              return (
                evidence !== undefined &&
                requestedTeam !== undefined &&
                evidence.workItemResource.entityTypeId === "core:work-item" &&
                entityKeyMatchesOpaqueId(
                  evidence.workItemResource,
                  String(guard.workItemId)
                ) &&
                sameEntityKey(
                  evidence.relationWorkItemResource,
                  evidence.workItemResource
                ) &&
                sameEntityKey(evidence.requestedTeamResource, requestedTeam) &&
                sameEntityKey(
                  evidence.relationRequestedTeamResource,
                  evidence.requestedTeamResource
                ) &&
                ((evidence.currentTeamResource === null &&
                  evidence.relationCurrentTeamResource === null) ||
                  (evidence.currentTeamResource !== null &&
                    evidence.relationCurrentTeamResource !== null &&
                    sameEntityKey(
                      evidence.currentTeamResource,
                      evidence.relationCurrentTeamResource
                    ))) &&
                evidence.reason.trim().length > 0 &&
                evidence.auditEventResource.entityTypeId ===
                  "core:audit-event" &&
                [
                  evidence.workItemResource,
                  evidence.requestedTeamResource,
                  evidence.auditEventResource,
                  ...(evidence.currentTeamResource === null
                    ? []
                    : [evidence.currentTeamResource])
                ].every(
                  (resource) => resource.tenantId === context.input.tenantId
                ) &&
                identityRevisionSetIsCurrent(
                  evidence.revisionChecks,
                  "relation"
                )
              );
            })()
          : guard.servicingTeamChange === undefined;
      if (!assignmentEligibilityValid || !servicingTeamChangeValid) {
        return guardDeny("state_guard_failed", "permission.denied");
      }
      const supervisorOverride =
        guard.actorRelation === "scoped_supervisor_override";
      const hasOverrideEvidence =
        !supervisorOverride ||
        guard.operation === "override" ||
        (guard.overrideRequirementId !== null &&
          guard.overrideReason !== null &&
          guard.overrideReason.trim().length > 0);
      const allowed =
        guard.operation === "read" ||
        (guard.operation === "claim" &&
          guard.workState === "active" &&
          guard.assignmentState === "unassigned" &&
          guard.actorRelation === "queue_member" &&
          hasRequiredDestinationEvidence) ||
        (guard.operation === "assign" &&
          (guard.workState === "active" ||
            guard.workState === "recovery_pending") &&
          supervisorOverride &&
          hasRequiredDestinationEvidence &&
          hasOverrideEvidence) ||
        (guard.operation === "servicing_team_manage" &&
          guard.workState === "active" &&
          supervisorOverride &&
          hasRequiredDestinationEvidence &&
          hasOverrideEvidence) ||
        (guard.operation === "release_self" &&
          guard.workState === "active" &&
          guard.actorRelation === "primary_responsible" &&
          hasRequiredDestinationEvidence) ||
        (guard.operation === "release_other" &&
          (guard.workState === "active" ||
            guard.workState === "recovery_pending") &&
          supervisorOverride &&
          hasOverrideEvidence) ||
        (guard.operation === "transfer" &&
          guard.workState === "active" &&
          (guard.actorRelation === "primary_responsible" ||
            (supervisorOverride && hasOverrideEvidence)) &&
          hasRequiredDestinationEvidence) ||
        (guard.operation === "close" &&
          guard.workState === "active" &&
          (guard.actorRelation === "primary_responsible" ||
            (supervisorOverride && hasOverrideEvidence))) ||
        (guard.operation === "reopen" &&
          (guard.workState === "terminal" ||
            guard.workState === "terminal_actionable") &&
          supervisorOverride &&
          hasRequiredDestinationEvidence &&
          hasOverrideEvidence) ||
        (guard.operation === "override" &&
          supervisorOverride &&
          guard.overrideReason !== null &&
          guard.overrideReason.trim().length > 0);
      if (!allowed) {
        return guardDeny("state_guard_failed", "permission.denied");
      }
      return guardAllow([
        ...guard.destinationRequirementIds,
        ...(guard.overrideRequirementId === null ||
        guard.operation === "override"
          ? []
          : [guard.overrideRequirementId])
      ]);
    }
    case "core:rbac.guard.source_account_route": {
      const expectedOperation =
        permissionId === "core:source_account.use"
          ? "use"
          : permissionId === "core:source.route_policy.manage"
            ? "manage_route_policy"
            : permissionId === "core:source.dispatch.reroute"
              ? "reroute_dispatch"
              : null;
      if (
        expectedOperation === null ||
        guard.operation.kind !== expectedOperation
      ) {
        return guardDeny("hard_boundary_denied", "permission.denied");
      }
      if (guard.sourceAccountId !== guard.routeSourceAccountId) {
        return guardDeny("route_guard_failed", "route.forbidden");
      }
      if (
        guard.bindingGeneration !== guard.expectedBindingGeneration ||
        guard.bindingState === "ambiguous"
      ) {
        return guardDeny("revision_guard_failed", "route.binding_changed");
      }
      if (
        guard.sourceState !== "active" ||
        guard.bindingState !== "active" ||
        guard.capabilityState !== "supported" ||
        guard.capabilityNotAfter === null ||
        !isTimestamp(guard.capabilityNotAfter) ||
        !isStrictlyAfter(guard.capabilityNotAfter, context.input.evaluatedAt)
      ) {
        return guardDeny("route_guard_failed", "route.inactive");
      }
      if (guard.operation.kind === "use") {
        if (
          !sameEntityKey(
            guard.operation.sourceAccountResource,
            requirementResource
          ) ||
          !sourceAccountResourceMatches(
            guard.operation.sourceAccountResource,
            guard.sourceAccountId,
            context.input.tenantId
          ) ||
          !sourceAccountCapabilityManifestIsValid(
            guard.operation.capabilityManifest,
            "core:capability.source_account.use",
            guard.operation.sourceAccountResource,
            guard.operation.bindingResource,
            null,
            context.input.tenantId,
            context.input.evaluatedAt
          )
        ) {
          return guardDeny("revision_guard_failed", "route.binding_changed");
        }
      }
      if (guard.operation.kind === "manage_route_policy") {
        if (
          guard.operation.policyResource.entityTypeId !==
            "core:source-route-policy" ||
          guard.operation.policyResource.tenantId !== context.input.tenantId ||
          !sourceAccountResourceMatches(
            guard.operation.policySourceAccountResource,
            guard.sourceAccountId,
            context.input.tenantId
          ) ||
          guard.operation.policyRelationResource.entityTypeId !==
            "core:source-route-policy-binding" ||
          guard.operation.policyRelationResource.tenantId !==
            context.input.tenantId ||
          !sameEntityKey(
            guard.operation.relationPolicyResource,
            guard.operation.policyResource
          ) ||
          !sameEntityKey(
            guard.operation.relationSourceAccountResource,
            guard.operation.policySourceAccountResource
          ) ||
          !identityRevisionSetIsCurrent(
            guard.operation.relationRevisionChecks,
            "relation"
          ) ||
          guard.operation.policyRevisionChecks.length === 0 ||
          guard.operation.policyRevisionChecks.some(
            (check) => check.expected !== check.actual
          ) ||
          !guard.operation.policyRevisionChecks.some(
            (check) => check.kind === "policy"
          ) ||
          !guard.operation.futureDispatchesOnly ||
          guard.operation.pinnedDispatchMutationRequested ||
          guard.operation.reason.trim().length === 0 ||
          guard.operation.auditEventId.trim().length === 0
        ) {
          return guardDeny("revision_guard_failed", "revision.conflict");
        }
      }
      if (guard.operation.kind === "reroute_dispatch") {
        if (
          guard.operation.dispatch.resource.entityTypeId !==
            "core:outbound-dispatch" ||
          guard.operation.dispatch.relationResource.entityTypeId !==
            "core:outbound-dispatch-route-decision" ||
          guard.operation.originalRoute.resource.entityTypeId !==
            "core:outbound-route" ||
          guard.operation.newRoute.resource.entityTypeId !==
            "core:outbound-route" ||
          guard.operation.originalRoute.bindingResource.entityTypeId !==
            "core:source-thread-binding" ||
          guard.operation.newRoute.bindingResource.entityTypeId !==
            "core:source-thread-binding" ||
          guard.operation.originalRoute.routeBindingRelationResource
            .entityTypeId !== "core:outbound-route-binding" ||
          guard.operation.newRoute.routeBindingRelationResource.entityTypeId !==
            "core:outbound-route-binding" ||
          sameEntityKey(
            guard.operation.originalRoute.resource,
            guard.operation.newRoute.resource
          ) ||
          sameEntityKey(
            guard.operation.originalRoute.bindingResource,
            guard.operation.newRoute.bindingResource
          ) ||
          !sameEntityKey(
            guard.operation.dispatch.originalRouteResource,
            guard.operation.originalRoute.resource
          ) ||
          !sameEntityKey(
            guard.operation.dispatch.requestedRouteResource,
            guard.operation.newRoute.resource
          ) ||
          !sameEntityKey(
            guard.operation.dispatch.relationDispatchResource,
            guard.operation.dispatch.resource
          ) ||
          !sameEntityKey(
            guard.operation.dispatch.relationOriginalRouteResource,
            guard.operation.originalRoute.resource
          ) ||
          !sameEntityKey(
            guard.operation.dispatch.relationRequestedRouteResource,
            guard.operation.newRoute.resource
          ) ||
          guard.operation.dispatch.resource.tenantId !==
            context.input.tenantId ||
          guard.operation.dispatch.relationResource.tenantId !==
            context.input.tenantId ||
          guard.operation.originalRoute.resource.tenantId !==
            context.input.tenantId ||
          guard.operation.newRoute.resource.tenantId !==
            context.input.tenantId ||
          guard.operation.originalRoute.bindingResource.tenantId !==
            context.input.tenantId ||
          guard.operation.newRoute.bindingResource.tenantId !==
            context.input.tenantId ||
          guard.operation.originalRoute.routeBindingRelationResource
            .tenantId !== context.input.tenantId ||
          guard.operation.newRoute.routeBindingRelationResource.tenantId !==
            context.input.tenantId ||
          !sameEntityKey(
            guard.operation.originalRoute.relationRouteResource,
            guard.operation.originalRoute.resource
          ) ||
          !sameEntityKey(
            guard.operation.originalRoute.relationBindingResource,
            guard.operation.originalRoute.bindingResource
          ) ||
          !sameEntityKey(
            guard.operation.newRoute.relationRouteResource,
            guard.operation.newRoute.resource
          ) ||
          !sameEntityKey(
            guard.operation.newRoute.relationBindingResource,
            guard.operation.newRoute.bindingResource
          ) ||
          guard.operation.originalRoute.conversationResource.entityTypeId !==
            "core:conversation" ||
          guard.operation.originalRoute.externalThreadResource.entityTypeId !==
            "core:external-thread" ||
          guard.operation.originalRoute.conversationResource.tenantId !==
            context.input.tenantId ||
          guard.operation.originalRoute.externalThreadResource.tenantId !==
            context.input.tenantId ||
          guard.operation.newRoute.conversationResource.entityTypeId !==
            "core:conversation" ||
          guard.operation.newRoute.externalThreadResource.entityTypeId !==
            "core:external-thread" ||
          !sameEntityKey(
            guard.operation.originalRoute.bindingConversationResource,
            guard.operation.originalRoute.conversationResource
          ) ||
          !sameEntityKey(
            guard.operation.originalRoute.bindingExternalThreadResource,
            guard.operation.originalRoute.externalThreadResource
          ) ||
          !sameEntityKey(
            guard.operation.originalRoute.bindingSourceAccountResource,
            guard.operation.originalRoute.sourceAccountResource
          ) ||
          !sameEntityKey(
            guard.operation.newRoute.bindingConversationResource,
            guard.operation.newRoute.conversationResource
          ) ||
          !sameEntityKey(
            guard.operation.newRoute.bindingExternalThreadResource,
            guard.operation.newRoute.externalThreadResource
          ) ||
          !sameEntityKey(
            guard.operation.newRoute.bindingSourceAccountResource,
            guard.operation.newRoute.sourceAccountResource
          ) ||
          !sameEntityKey(
            guard.operation.originalRoute.conversationResource,
            guard.operation.newRoute.conversationResource
          ) ||
          !sameEntityKey(
            guard.operation.originalRoute.externalThreadResource,
            guard.operation.newRoute.externalThreadResource
          ) ||
          !identityRevisionSetIsCurrent(
            guard.operation.originalRoute.relationRevisionChecks,
            "relation"
          ) ||
          !identityRevisionSetIsCurrent(
            guard.operation.newRoute.relationRevisionChecks,
            "relation"
          ) ||
          !sourceAccountResourceMatches(
            guard.operation.originalRoute.sourceAccountResource,
            guard.sourceAccountId,
            context.input.tenantId
          ) ||
          guard.operation.newRoute.sourceAccountResource.entityTypeId !==
            "core:source-account" ||
          guard.operation.newRoute.sourceAccountResource.tenantId !==
            context.input.tenantId ||
          !sourceAccountCapabilityManifestIsValid(
            guard.operation.originalCapabilityManifest,
            "core:capability.source.dispatch.reroute",
            guard.operation.originalRoute.sourceAccountResource,
            guard.operation.originalRoute.bindingResource,
            guard.operation.originalRoute.resource,
            context.input.tenantId,
            context.input.evaluatedAt
          ) ||
          !sourceAccountCapabilityManifestIsValid(
            guard.operation.newCapabilityManifest,
            "core:capability.source.dispatch.reroute",
            guard.operation.newRoute.sourceAccountResource,
            guard.operation.newRoute.bindingResource,
            guard.operation.newRoute.resource,
            context.input.tenantId,
            context.input.evaluatedAt
          ) ||
          guard.operation.dispatch.state !== guard.operation.dispatchState ||
          guard.operation.dispatch.expectedStateRevision.trim().length === 0 ||
          guard.operation.dispatch.expectedStateRevision !==
            guard.operation.dispatch.currentStateRevision ||
          !exactKeyedRevisionSetIsCurrent(
            guard.operation.dispatch.revisionChecks,
            [
              guard.operation.dispatch.resource,
              guard.operation.dispatch.relationResource,
              guard.operation.originalRoute.resource,
              guard.operation.newRoute.resource
            ]
          ) ||
          !keyedRevisionMatchesValues(
            guard.operation.dispatch.revisionChecks,
            guard.operation.dispatch.resource,
            guard.operation.dispatch.expectedStateRevision,
            guard.operation.dispatch.currentStateRevision
          ) ||
          !keyedRevisionsAgree(
            guard.operation.dispatch.revisionChecks,
            guard.operation.originalCapabilityManifest.revisionChecks,
            guard.operation.originalRoute.resource
          ) ||
          !keyedRevisionsAgree(
            guard.operation.dispatch.revisionChecks,
            guard.operation.newCapabilityManifest.revisionChecks,
            guard.operation.newRoute.resource
          ) ||
          guard.operation.originalSourceRequirementId ===
            guard.operation.newSourceRequirementId ||
          guard.operation.dispatchState !== "before_provider_io" ||
          guard.operation.routeRevisionChecks.length === 0 ||
          !routeRevisionSetIsCurrent(guard.operation.routeRevisionChecks) ||
          !guard.operation.originalRouteHistoryRecorded ||
          guard.operation.reason.trim().length === 0 ||
          guard.operation.auditEventId.trim().length === 0
        ) {
          return guardDeny("revision_guard_failed", "route.binding_changed");
        }
      }
      return guardAllow(
        guard.operation.kind === "reroute_dispatch"
          ? [
              guard.operation.originalSourceRequirementId,
              guard.operation.newSourceRequirementId
            ]
          : [],
        guard.capabilityNotAfter,
        ...(guard.operation.kind === "use"
          ? [guard.operation.capabilityManifest.notAfter]
          : guard.operation.kind === "reroute_dispatch"
            ? [
                guard.operation.originalCapabilityManifest.notAfter,
                guard.operation.newCapabilityManifest.notAfter
              ]
            : [])
      );
    }
    case "core:rbac.guard.file_parent_content": {
      const expectedOperation =
        permissionId === "core:file.view"
          ? "view"
          : permissionId === "core:file.upload"
            ? "upload"
            : permissionId === "core:file.delete"
              ? "delete"
              : null;
      if (
        actorEmployeeId === null ||
        guard.actorEmployeeId !== actorEmployeeId ||
        expectedOperation === null ||
        guard.operation !== expectedOperation ||
        guard.parentRequirementIds.length === 0 ||
        guard.parentRelationResource.entityTypeId !==
          "core:file-parent-relation" ||
        guard.parentRelationResource.tenantId !==
          guard.targetResource.tenantId ||
        !sameEntityKey(guard.relationFileResource, guard.targetResource) ||
        !sameEntityKey(guard.relationParentResource, guard.parentResource) ||
        guard.relationBoundary !== guard.parentBoundary ||
        !identityRevisionSetIsCurrent(
          guard.parentRelationRevisionChecks,
          "relation"
        ) ||
        guard.holdIndexResource.entityTypeId !== "core:file-hold-index" ||
        guard.holdIndexResource.tenantId !== guard.targetResource.tenantId ||
        !sameEntityKey(guard.holdIndexFileResource, guard.targetResource) ||
        !identityRevisionSetIsCurrent(guard.holdRevisionChecks, "state") ||
        (guard.uploaderEmployeeId === null
          ? guard.uploaderRelationResource !== null ||
            guard.uploaderRelationFileResource !== null ||
            guard.uploaderEmployeeResource !== null ||
            guard.uploaderRevisionChecks.length !== 0
          : guard.uploaderRelationResource?.entityTypeId !==
              "core:file-uploader-relation" ||
            guard.uploaderRelationResource.tenantId !==
              guard.targetResource.tenantId ||
            guard.uploaderRelationFileResource === null ||
            !sameEntityKey(
              guard.uploaderRelationFileResource,
              guard.targetResource
            ) ||
            guard.uploaderEmployeeResource?.entityTypeId !== "core:employee" ||
            !entityKeyMatchesOpaqueId(
              guard.uploaderEmployeeResource,
              String(guard.uploaderEmployeeId)
            ) ||
            !identityRevisionSetIsCurrent(
              guard.uploaderRevisionChecks,
              "relation"
            ))
      ) {
        return guardDeny("secondary_resource_denied", "file.parent_forbidden");
      }
      if (
        guard.expectedFileRevision !== guard.currentFileRevision ||
        guard.retentionState !== "available" ||
        (guard.operation === "upload" &&
          guard.storagePolicyState !== "allowed") ||
        (guard.operation === "delete" &&
          (guard.holdState === "active" ||
            (guard.uploaderEmployeeId !== actorEmployeeId &&
              guard.moderationRequirementId === null)))
      ) {
        return guardDeny("hard_boundary_denied", "permission.denied");
      }
      return guardAllow([
        ...guard.parentRequirementIds,
        ...(guard.moderationRequirementId === null
          ? []
          : [guard.moderationRequirementId])
      ]);
    }
    case "core:rbac.guard.client_context": {
      if (
        (permissionId.startsWith("core:client.") &&
          guard.target.kind !== "client") ||
        (permissionId === "core:conversation.clients.manage" &&
          guard.target.kind !== "conversation")
      ) {
        return guardDeny("hard_boundary_denied", "permission.denied");
      }
      const mutationDecision = evaluateClientMutationEvidence(
        permissionId,
        guard,
        requirementResource,
        context.input.tenantId
      );
      if (mutationDecision.outcome === "denied") {
        return mutationDecision;
      }
      if (permissionId === "core:client.owner.assign") {
        const assignment = guard.clientOwnerAssignment;
        if (
          assignment === undefined ||
          guard.target.kind !== "client" ||
          assignment.clientResource.entityTypeId !== "core:client" ||
          !sameEntityKey(assignment.clientResource, requirementResource) ||
          !entityKeyMatchesOpaqueId(
            assignment.clientResource,
            String(guard.target.clientId)
          ) ||
          assignment.targetEmployeeResource.entityTypeId !== "core:employee" ||
          !entityKeyMatchesOpaqueId(
            assignment.targetEmployeeResource,
            String(assignment.targetEmployeeId)
          ) ||
          assignment.targetLifecycle !== "active" ||
          assignment.eligibilityState !== "eligible" ||
          assignment.eligibilityResource.entityTypeId !==
            "core:client-owner-eligibility" ||
          assignment.eligibilityResource.tenantId !== context.input.tenantId ||
          !sameEntityKey(
            assignment.eligibilityClientResource,
            assignment.clientResource
          ) ||
          !sameEntityKey(
            assignment.eligibilityEmployeeResource,
            assignment.targetEmployeeResource
          ) ||
          !exactKeyedRevisionSetIsCurrent(
            assignment.eligibilityRevisionChecks,
            [
              assignment.eligibilityResource,
              assignment.clientResource,
              assignment.targetEmployeeResource
            ]
          ) ||
          !exactKeyedRevisionSetIsCurrent(assignment.lifecycleRevisionChecks, [
            assignment.targetEmployeeResource
          ]) ||
          assignment.ownershipRelationResource.entityTypeId !==
            "core:client-owner-relation" ||
          !sameEntityKey(
            assignment.ownershipRelationClientResource,
            assignment.clientResource
          ) ||
          !sameEntityKey(
            assignment.ownershipRelationEmployeeResource,
            assignment.targetEmployeeResource
          ) ||
          !exactKeyedRevisionSetIsCurrent(assignment.ownershipRevisionChecks, [
            assignment.ownershipRelationResource,
            assignment.clientResource,
            assignment.targetEmployeeResource
          ]) ||
          !keyedRevisionsAgree(
            assignment.eligibilityRevisionChecks,
            assignment.ownershipRevisionChecks,
            assignment.clientResource
          ) ||
          !keyedRevisionsAgree(
            assignment.eligibilityRevisionChecks,
            assignment.ownershipRevisionChecks,
            assignment.targetEmployeeResource
          ) ||
          !keyedRevisionsAgree(
            assignment.lifecycleRevisionChecks,
            assignment.ownershipRevisionChecks,
            assignment.targetEmployeeResource
          ) ||
          !keyedRevisionMatchesValues(
            assignment.ownershipRevisionChecks,
            assignment.ownershipRelationResource,
            assignment.expectedOwnershipRevision,
            assignment.currentOwnershipRevision
          ) ||
          assignment.expectedOwnershipRevision.trim().length === 0 ||
          assignment.expectedOwnershipRevision !==
            assignment.currentOwnershipRevision ||
          assignment.reason.trim().length === 0 ||
          assignment.auditEventResource.entityTypeId !== "core:audit-event" ||
          [
            assignment.clientResource,
            assignment.targetEmployeeResource,
            assignment.ownershipRelationResource,
            assignment.ownershipRelationClientResource,
            assignment.ownershipRelationEmployeeResource,
            assignment.auditEventResource
          ].some((resource) => resource.tenantId !== context.input.tenantId)
        ) {
          return guardDeny("state_guard_failed", "permission.denied");
        }
      } else if (guard.clientOwnerAssignment !== undefined) {
        return guardDeny("hard_boundary_denied", "permission.denied");
      }
      if (
        !clientPathEvidenceIsCurrent(
          guard,
          requirementResource,
          actorEmployeeId,
          context.input.tenantId
        )
      ) {
        return guardDeny("structural_path_missing", "permission.denied");
      }
      if (
        permissionId === "core:conversation.clients.manage" &&
        guard.linkedClientRequirementIds.length === 0
      ) {
        return guardDeny("secondary_resource_denied", "permission.denied");
      }
      if (
        (permissionId === "core:client.fields.view_sensitive" ||
          permissionId === "core:client.fields.edit") &&
        guard.contextualRequirementIds.length === 0
      ) {
        return guardDeny("secondary_resource_denied", "permission.denied");
      }
      return guardAllow(
        uniqueRequirementIds([
          ...guard.contextualRequirementIds,
          ...guard.linkedClientRequirementIds,
          ...mutationDecision.companionRequirementIds,
          ...(guard.clientOwnerAssignment === undefined
            ? []
            : [guard.clientOwnerAssignment.targetDirectoryRequirementId])
        ])
      );
    }
    case "core:rbac.guard.identity_evidence": {
      const expectedOperation =
        permissionId === "core:identity.employee_claim.manage"
          ? "employee_claim_manage"
          : permissionId === "core:identity.client_contact_claim.manage"
            ? "client_contact_claim_manage"
            : permissionId === "core:identity.source_identity.use"
              ? "source_identity_use"
              : permissionId === "core:identity.evidence.view"
                ? "evidence_view"
                : permissionId === "core:identity.auto_resolve"
                  ? "auto_resolve"
                  : permissionId === "core:identity.claim.revoke"
                    ? "claim_revoke"
                    : permissionId === "core:identity.merge"
                      ? "merge"
                      : permissionId === "core:identity.observation.review"
                        ? "observation_review"
                        : null;
      if (
        expectedOperation === null ||
        guard.operation.kind !== expectedOperation ||
        guard.evidenceState !== "verified"
      ) {
        return guardDeny("hard_boundary_denied", "identity.evidence_required");
      }
      const operation = guard.operation;
      if (operation.kind === "auto_resolve") {
        if (
          context.principalKind !== "trusted_service" ||
          String(operation.trustedServiceId) !== context.principalId ||
          operation.manualActorEmployeeId !== null
        ) {
          return guardDeny("principal_invalid", "auth.session_invalid");
        }
        if (
          !sameEntityKey(
            operation.resolutionDecisionResource,
            guard.targetResource
          ) ||
          operation.resolutionDecisionResource.entityTypeId !==
            "core:identity-resolution" ||
          operation.resolutionRelationResource.entityTypeId !==
            "core:identity-resolution-binding" ||
          !sameEntityKey(
            operation.decisionSourceIdentityResource,
            operation.sourceIdentityResource
          ) ||
          !sameEntityKey(
            operation.decisionClaimTargetResource,
            operation.claimTargetResource
          ) ||
          !sameEntityKey(
            operation.decisionPolicyResource,
            operation.policyResource
          ) ||
          !exactKeyedRevisionSetIsCurrent(
            operation.resolutionResourceRevisionChecks,
            [
              operation.resolutionDecisionResource,
              operation.resolutionRelationResource,
              operation.sourceIdentityResource,
              operation.claimTargetResource,
              operation.policyResource,
              operation.evidenceResource,
              operation.claimHeadResource,
              operation.auditEventResource
            ]
          ) ||
          operation.sourceIdentityResource.entityTypeId !==
            "core:source-external-identity" ||
          operation.evidenceResource.entityTypeId !==
            "core:identity-evidence" ||
          (operation.claimTargetResource.entityTypeId !== "core:employee" &&
            operation.claimTargetResource.entityTypeId !==
              "core:client-contact") ||
          !sameEntityKey(
            operation.evidenceSourceIdentityResource,
            operation.sourceIdentityResource
          ) ||
          !sameEntityKey(
            operation.evidenceClaimTargetResource,
            operation.claimTargetResource
          ) ||
          operation.evidenceKind !== "verified_scope_correct" ||
          operation.policyResource.entityTypeId !==
            "core:identity-claim-policy" ||
          operation.policyState !== "approved_active" ||
          operation.policyId.trim().length === 0 ||
          operation.policyVersion.trim().length === 0 ||
          operation.evidencePolicyId !== operation.policyId ||
          operation.evidencePolicyVersion !== operation.policyVersion ||
          operation.policyRuleManifest.resource.entityTypeId !==
            "core:identity-auto-resolution-policy-rule-manifest" ||
          !sameEntityKey(
            operation.policyRuleManifest.policyResource,
            operation.policyResource
          ) ||
          !sameEntityKey(
            operation.policyRuleManifest.sourceIdentityResource,
            operation.sourceIdentityResource
          ) ||
          !sameEntityKey(
            operation.policyRuleManifest.evidenceResource,
            operation.evidenceResource
          ) ||
          !sameEntityKey(
            operation.policyRuleManifest.claimTargetResource,
            operation.claimTargetResource
          ) ||
          operation.policyRuleManifest.ruleId.trim().length === 0 ||
          operation.policyRuleManifest.ruleVersion.trim().length === 0 ||
          operation.policyRuleManifest.evidenceRuleId !==
            operation.policyRuleManifest.ruleId ||
          operation.policyRuleManifest.evidenceRuleVersion !==
            operation.policyRuleManifest.ruleVersion ||
          operation.policyRuleManifest.state !== operation.policyState ||
          !exactKeyedRevisionSetIsCurrent(
            operation.policyRuleManifest.revisionChecks,
            [
              operation.policyRuleManifest.resource,
              operation.policyResource,
              operation.sourceIdentityResource,
              operation.evidenceResource,
              operation.claimTargetResource
            ]
          ) ||
          ![
            operation.policyResource,
            operation.sourceIdentityResource,
            operation.evidenceResource,
            operation.claimTargetResource
          ].every((resource) =>
            keyedRevisionsAgree(
              operation.policyRuleManifest.revisionChecks,
              operation.resolutionResourceRevisionChecks,
              resource
            )
          ) ||
          !isTimestamp(operation.policyRuleManifest.notAfter) ||
          !isStrictlyAfter(
            operation.policyRuleManifest.notAfter,
            context.input.evaluatedAt
          ) ||
          operation.policyAllowedTargetKind !== operation.targetKind ||
          (operation.targetKind === "employee"
            ? operation.claimTargetResource.entityTypeId !== "core:employee" ||
              operation.targetEmployeeId === null ||
              operation.targetEmployeeLifecycle !== "active" ||
              !entityKeyMatchesOpaqueId(
                operation.claimTargetResource,
                String(operation.targetEmployeeId)
              )
            : operation.claimTargetResource.entityTypeId !==
                "core:client-contact" ||
              operation.targetEmployeeId !== null ||
              operation.targetEmployeeLifecycle !== null) ||
          operation.sourceIdentityResolution.state === "conflicting" ||
          operation.claimHeadResource.entityTypeId !==
            "core:source-identity-claim-head" ||
          !sameEntityKey(
            operation.claimHeadSourceIdentityResource,
            operation.sourceIdentityResource
          ) ||
          operation.expectedClaimVersion !== operation.currentClaimVersion ||
          (operation.sourceIdentityResolution.state === "unresolved"
            ? operation.currentClaimTargetResource !== null ||
              operation.expectedClaimVersion !== null ||
              operation.currentClaimVersion !== null
            : operation.sourceIdentityResolution.state === "claimed" &&
              (operation.currentClaimTargetResource === null ||
                !sameEntityKey(
                  operation.currentClaimTargetResource,
                  operation.claimTargetResource
                ) ||
                !sameEntityKey(
                  operation.sourceIdentityResolution.activeClaimTargetResource,
                  operation.claimTargetResource
                ) ||
                operation.expectedClaimVersion === null ||
                operation.currentClaimVersion === null)) ||
          operation.auditEventResource.entityTypeId !== "core:audit-event" ||
          !sameEntityKey(
            operation.auditSourceIdentityResource,
            operation.sourceIdentityResource
          ) ||
          !sameEntityKey(
            operation.auditClaimTargetResource,
            operation.claimTargetResource
          ) ||
          operation.auditTrustedServiceId !== operation.trustedServiceId ||
          operation.reasonCodeId.trim().length === 0 ||
          [
            operation.resolutionDecisionResource,
            operation.resolutionRelationResource,
            operation.decisionSourceIdentityResource,
            operation.decisionClaimTargetResource,
            operation.decisionPolicyResource,
            operation.sourceIdentityResource,
            operation.evidenceResource,
            operation.claimTargetResource,
            operation.policyResource,
            operation.claimHeadResource,
            operation.auditEventResource,
            operation.policyRuleManifest.resource,
            operation.policyRuleManifest.policyResource,
            operation.policyRuleManifest.sourceIdentityResource,
            operation.policyRuleManifest.evidenceResource,
            operation.policyRuleManifest.claimTargetResource,
            ...(operation.currentClaimTargetResource === null
              ? []
              : [operation.currentClaimTargetResource]),
            ...(operation.sourceIdentityResolution.state === "claimed"
              ? [operation.sourceIdentityResolution.activeClaimTargetResource]
              : [])
          ].some((resource) => resource.tenantId !== context.input.tenantId) ||
          !identityRevisionSetIsCurrent(
            operation.resolutionRevisionChecks,
            "entity"
          ) ||
          !identityRevisionSetIsCurrent(
            operation.sourceIdentityRevisionChecks,
            "entity"
          ) ||
          !identityRevisionSetIsCurrent(
            operation.evidenceRevisionChecks,
            "entity"
          ) ||
          !identityRevisionSetIsCurrent(
            operation.targetRevisionChecks,
            "entity"
          ) ||
          !identityRevisionSetIsCurrent(
            operation.policyRevisionChecks,
            "policy"
          ) ||
          !identityRevisionSetIsCurrent(
            operation.claimRevisionChecks,
            "relation"
          ) ||
          !identityRevisionSetIsCurrent(operation.auditRevisionChecks, "entity")
        ) {
          return guardDeny(
            "hard_boundary_denied",
            "identity.evidence_required"
          );
        }
        return guardAllow([], operation.policyRuleManifest.notAfter);
      }
      if (
        operation.kind === "source_identity_use" ||
        operation.kind === "evidence_view"
      ) {
        if (
          actorEmployeeId === null ||
          operation.actorEmployeeId !== actorEmployeeId ||
          !sameEntityKey(operation.evidenceResource, guard.targetResource) ||
          (operation.kind === "source_identity_use" &&
            operation.evidenceResource.entityTypeId !==
              "core:source-external-identity") ||
          operation.revisionChecks.length === 0 ||
          operation.revisionChecks.some(
            (check) => check.expected !== check.actual
          )
        ) {
          return guardDeny("principal_invalid", "auth.session_invalid");
        }
        return guardAllow([]);
      }
      if (
        actorEmployeeId === null ||
        operation.actorEmployeeId !== actorEmployeeId
      ) {
        return guardDeny("principal_invalid", "auth.session_invalid");
      }
      if (
        operation.kind === "employee_claim_manage" ||
        operation.kind === "client_contact_claim_manage"
      ) {
        const expectedTargetType =
          operation.kind === "employee_claim_manage"
            ? "core:employee"
            : "core:client-contact";
        if (
          operation.sourceIdentityResource.entityTypeId !==
            "core:source-external-identity" ||
          !sameEntityKey(guard.targetResource, operation.newTargetResource) ||
          operation.newTargetResource.entityTypeId !== expectedTargetType ||
          (operation.oldTargetResource !== null &&
            operation.oldTargetResource.entityTypeId !== "core:employee" &&
            operation.oldTargetResource.entityTypeId !==
              "core:client-contact") ||
          operation.claimPolicyResource.entityTypeId !==
            "core:identity-claim-policy" ||
          operation.claimPolicyState !== "approved_active" ||
          operation.claimPolicyVersion.trim().length === 0 ||
          !sameEntityKey(
            operation.evidencePolicyResource,
            operation.claimPolicyResource
          ) ||
          operation.evidencePolicyVersion !== operation.claimPolicyVersion ||
          operation.evidenceResource.entityTypeId !==
            "core:identity-evidence" ||
          !sameEntityKey(
            operation.evidenceSourceIdentityResource,
            operation.sourceIdentityResource
          ) ||
          !sameEntityKey(
            operation.evidenceTargetResource,
            operation.newTargetResource
          ) ||
          operation.claimHeadResource.entityTypeId !==
            "core:source-identity-claim-head" ||
          !sameEntityKey(
            operation.claimHeadSourceIdentityResource,
            operation.sourceIdentityResource
          ) ||
          operation.expectedClaimVersion !== operation.currentClaimVersion ||
          (operation.oldTargetResource === null
            ? operation.oldTargetRequirementId !== null ||
              operation.currentClaimTargetResource !== null
            : operation.oldTargetRequirementId === null ||
              operation.currentClaimTargetResource === null ||
              !sameEntityKey(
                operation.currentClaimTargetResource,
                operation.oldTargetResource
              ) ||
              operation.expectedClaimVersion === null ||
              operation.currentClaimVersion === null) ||
          operation.reasonCodeId.trim().length === 0 ||
          operation.auditEventResource.entityTypeId !== "core:audit-event" ||
          operation.auditActorEmployeeId !== operation.actorEmployeeId ||
          !sameEntityKey(
            operation.auditSourceIdentityResource,
            operation.sourceIdentityResource
          ) ||
          !sameEntityKey(
            operation.auditTargetResource,
            operation.newTargetResource
          ) ||
          !identityRevisionSetIsCurrent(
            operation.sourceIdentityRevisionChecks,
            "entity"
          ) ||
          !identityRevisionSetIsCurrent(
            operation.claimPolicyRevisionChecks,
            "policy"
          ) ||
          !identityRevisionSetIsCurrent(
            operation.evidenceRevisionChecks,
            "entity"
          ) ||
          !identityRevisionSetIsCurrent(
            operation.targetRevisionChecks,
            "entity"
          ) ||
          !identityRevisionSetIsCurrent(
            operation.claimRevisionChecks,
            "relation"
          ) ||
          !identityRevisionSetIsCurrent(
            operation.auditRevisionChecks,
            "entity"
          ) ||
          [
            operation.sourceIdentityResource,
            operation.newTargetResource,
            operation.claimPolicyResource,
            operation.evidenceResource,
            operation.claimHeadResource,
            operation.auditEventResource,
            ...(operation.oldTargetResource === null
              ? []
              : [operation.oldTargetResource]),
            ...(operation.currentClaimTargetResource === null
              ? []
              : [operation.currentClaimTargetResource])
          ].some((resource) => resource.tenantId !== context.input.tenantId)
        ) {
          return guardDeny("state_guard_failed", "identity.evidence_required");
        }
        if (
          operation.kind === "employee_claim_manage" &&
          (operation.newTargetLifecycle !== "active" ||
            !entityKeyMatchesOpaqueId(
              operation.newTargetResource,
              String(operation.newTargetEmployeeId)
            ))
        ) {
          return guardDeny("state_guard_failed", "identity.evidence_required");
        }
        if (
          operation.kind === "employee_claim_manage" &&
          (operation.actorEmployeeId === operation.newTargetEmployeeId ||
            entityKeyMatchesOpaqueId(
              operation.newTargetResource,
              String(operation.actorEmployeeId)
            ))
        ) {
          return guardDeny(
            "separation_of_duties_denied",
            "identity.claim_self_forbidden"
          );
        }
        return guardAllow([
          operation.sourceIdentityRequirementId,
          ...(operation.oldTargetRequirementId === null
            ? []
            : [operation.oldTargetRequirementId]),
          ...(operation.evidenceViewRequirementId === null
            ? []
            : [operation.evidenceViewRequirementId])
        ]);
      }
      if (operation.kind === "claim_revoke") {
        if (
          operation.sourceIdentityResource.entityTypeId !==
            "core:source-external-identity" ||
          operation.activeClaimResource.entityTypeId !==
            "core:source-identity-claim" ||
          !sameEntityKey(
            guard.targetResource,
            operation.existingTargetResource
          ) ||
          (operation.existingTargetResource.entityTypeId !== "core:employee" &&
            operation.existingTargetResource.entityTypeId !==
              "core:client-contact") ||
          !sameEntityKey(
            operation.claimSourceIdentityResource,
            operation.sourceIdentityResource
          ) ||
          !sameEntityKey(
            operation.claimTargetResource,
            operation.existingTargetResource
          ) ||
          operation.reasonCodeId.trim().length === 0 ||
          operation.auditEventResource.entityTypeId !== "core:audit-event" ||
          operation.auditActorEmployeeId !== operation.actorEmployeeId ||
          !sameEntityKey(
            operation.auditSourceIdentityResource,
            operation.sourceIdentityResource
          ) ||
          !sameEntityKey(
            operation.auditTargetResource,
            operation.existingTargetResource
          ) ||
          !identityRevisionSetIsCurrent(
            operation.sourceIdentityRevisionChecks,
            "entity"
          ) ||
          !identityRevisionSetIsCurrent(
            operation.activeClaimRevisionChecks,
            "relation"
          ) ||
          !identityRevisionSetIsCurrent(
            operation.targetRevisionChecks,
            "entity"
          ) ||
          !identityRevisionSetIsCurrent(
            operation.auditRevisionChecks,
            "entity"
          ) ||
          [
            operation.sourceIdentityResource,
            operation.activeClaimResource,
            operation.existingTargetResource,
            operation.auditEventResource
          ].some((resource) => resource.tenantId !== context.input.tenantId)
        ) {
          return guardDeny("state_guard_failed", "identity.evidence_required");
        }
        return guardAllow([operation.sourceIdentityRequirementId]);
      }
      if (operation.kind === "merge") {
        if (
          !sameEntityKey(operation.mutationResource, guard.targetResource) ||
          operation.mutationResource.entityTypeId !==
            "core:identity-mutation" ||
          operation.mutationBindingResource.entityTypeId !==
            "core:identity-mutation-binding" ||
          !sameEntityKey(
            operation.bindingMutationResource,
            operation.mutationResource
          ) ||
          !sameEntityKey(
            operation.bindingCanonicalIdentityResource,
            operation.canonicalIdentityResource
          ) ||
          !sameEntityKey(
            operation.bindingAliasIdentityResource,
            operation.aliasIdentityResource
          ) ||
          !exactKeyedRevisionSetIsCurrent(operation.mutationRevisionChecks, [
            operation.mutationBindingResource,
            operation.mutationResource,
            operation.canonicalIdentityResource,
            operation.aliasIdentityResource
          ]) ||
          operation.canonicalIdentityResource.entityTypeId !==
            "core:source-external-identity" ||
          operation.aliasIdentityResource.entityTypeId !==
            "core:source-external-identity" ||
          sameEntityKey(
            operation.canonicalIdentityResource,
            operation.aliasIdentityResource
          ) ||
          operation.canonicalRealmId.trim().length === 0 ||
          operation.canonicalRealmId !== operation.aliasRealmId ||
          operation.canonicalRealmVersion.trim().length === 0 ||
          operation.canonicalRealmVersion !== operation.aliasRealmVersion ||
          operation.canonicalizationVersion.trim().length === 0 ||
          operation.canonicalizationVersion !==
            operation.aliasCanonicalizationVersion ||
          !identityScopeEvidenceIsValid(
            operation.canonicalScope,
            context.input.tenantId
          ) ||
          !identityScopeEvidenceIsValid(
            operation.aliasScope,
            context.input.tenantId
          ) ||
          !identityRealmScopeBindingEvidenceIsValid(
            operation.canonicalRealmScopeBinding,
            operation.canonicalIdentityResource,
            operation.canonicalRealmId,
            operation.canonicalRealmVersion,
            operation.canonicalScope,
            context.input.tenantId
          ) ||
          !identityRealmScopeBindingEvidenceIsValid(
            operation.aliasRealmScopeBinding,
            operation.aliasIdentityResource,
            operation.aliasRealmId,
            operation.aliasRealmVersion,
            operation.aliasScope,
            context.input.tenantId
          ) ||
          !sameEntityKey(
            operation.canonicalRealmScopeBinding.realmResource,
            operation.aliasRealmScopeBinding.realmResource
          ) ||
          !sameEntityKey(
            operation.canonicalRealmScopeBinding.scopeResource,
            operation.aliasRealmScopeBinding.scopeResource
          ) ||
          identityScopeEvidenceKey(operation.canonicalScope) !==
            identityScopeEvidenceKey(operation.aliasScope) ||
          !identityResolutionEvidenceIsValid(
            operation.canonicalResolution,
            context.input.tenantId
          ) ||
          !identityResolutionEvidenceIsValid(
            operation.aliasResolution,
            context.input.tenantId
          ) ||
          !identityMergeResolutionsAreCompatible(
            operation.canonicalResolution,
            operation.aliasResolution
          ) ||
          operation.conflictState !== "reviewed_clear" ||
          operation.conflictReviewResource.entityTypeId !==
            "core:identity-conflict-review" ||
          operation.canonicalClaimHeadResource.entityTypeId !==
            "core:source-identity-claim-head" ||
          operation.aliasClaimHeadResource.entityTypeId !==
            "core:source-identity-claim-head" ||
          !sameEntityKey(
            operation.canonicalClaimHeadIdentityResource,
            operation.canonicalIdentityResource
          ) ||
          !sameEntityKey(
            operation.aliasClaimHeadIdentityResource,
            operation.aliasIdentityResource
          ) ||
          !identityResolutionMatchesClaimHead(
            operation.canonicalResolution,
            operation.canonicalClaimHeadTargetResource
          ) ||
          !identityResolutionMatchesClaimHead(
            operation.aliasResolution,
            operation.aliasClaimHeadTargetResource
          ) ||
          !identityMergeClaimTargetAuthorityIsValid(
            operation.canonicalClaimTargetAuthority,
            operation.canonicalResolution,
            operation.mutationResource,
            operation.canonicalClaimHeadResource,
            context.input.tenantId
          ) ||
          !identityMergeClaimTargetAuthorityIsValid(
            operation.aliasClaimTargetAuthority,
            operation.aliasResolution,
            operation.mutationResource,
            operation.aliasClaimHeadResource,
            context.input.tenantId
          ) ||
          !identityMergeClaimTargetAuthoritiesAreDeduplicated(
            operation.canonicalClaimTargetAuthority,
            operation.aliasClaimTargetAuthority
          ) ||
          operation.aliasGraphResource.entityTypeId !==
            "core:source-identity-alias-graph" ||
          !sameEntityKey(
            operation.aliasGraphCanonicalIdentityResource,
            operation.canonicalIdentityResource
          ) ||
          !sameEntityKey(
            operation.aliasGraphAliasIdentityResource,
            operation.aliasIdentityResource
          ) ||
          operation.expectedAliasGraphRevision !==
            operation.currentAliasGraphRevision ||
          !sameEntityKey(
            operation.reviewedCanonicalIdentityResource,
            operation.canonicalIdentityResource
          ) ||
          !sameEntityKey(
            operation.reviewedAliasIdentityResource,
            operation.aliasIdentityResource
          ) ||
          operation.mergeDirection !== "alias_into_canonical" ||
          !operation.createsAcyclicAlias ||
          operation.reasonCodeId.trim().length === 0 ||
          operation.auditEventResource.entityTypeId !== "core:audit-event" ||
          operation.auditActorEmployeeId !== operation.actorEmployeeId ||
          !sameEntityKey(
            operation.auditCanonicalIdentityResource,
            operation.canonicalIdentityResource
          ) ||
          !sameEntityKey(
            operation.auditAliasIdentityResource,
            operation.aliasIdentityResource
          ) ||
          !identityRevisionSetIsCurrent(
            operation.canonicalIdentityRevisionChecks,
            "entity"
          ) ||
          !identityRevisionSetIsCurrent(
            operation.aliasIdentityRevisionChecks,
            "entity"
          ) ||
          !identityRevisionSetIsCurrent(
            operation.conflictReviewRevisionChecks,
            "state"
          ) ||
          !identityRevisionSetIsCurrent(
            operation.canonicalClaimHeadRevisionChecks,
            "relation"
          ) ||
          !identityRevisionSetIsCurrent(
            operation.aliasClaimHeadRevisionChecks,
            "relation"
          ) ||
          !identityRevisionSetIsCurrent(
            operation.auditRevisionChecks,
            "entity"
          ) ||
          !exactKeyedRevisionSetIsCurrent(operation.resourceRevisionChecks, [
            operation.conflictReviewResource,
            operation.canonicalClaimHeadResource,
            operation.aliasClaimHeadResource,
            operation.aliasGraphResource,
            operation.auditEventResource
          ]) ||
          [
            operation.mutationResource,
            operation.mutationBindingResource,
            operation.bindingMutationResource,
            operation.bindingCanonicalIdentityResource,
            operation.bindingAliasIdentityResource,
            operation.canonicalIdentityResource,
            operation.aliasIdentityResource,
            operation.canonicalRealmScopeBinding.resource,
            operation.canonicalRealmScopeBinding.identityResource,
            operation.canonicalRealmScopeBinding.realmResource,
            operation.canonicalRealmScopeBinding.scopeResource,
            operation.aliasRealmScopeBinding.resource,
            operation.aliasRealmScopeBinding.identityResource,
            operation.aliasRealmScopeBinding.realmResource,
            operation.aliasRealmScopeBinding.scopeResource,
            operation.conflictReviewResource,
            operation.canonicalClaimHeadResource,
            operation.aliasClaimHeadResource,
            operation.aliasGraphResource,
            operation.auditEventResource,
            ...(operation.canonicalScope.kind === "provider"
              ? []
              : [operation.canonicalScope.ownerResource]),
            ...(operation.aliasScope.kind === "provider"
              ? []
              : [operation.aliasScope.ownerResource]),
            ...(operation.canonicalResolution.state === "claimed"
              ? [operation.canonicalResolution.targetResource]
              : []),
            ...(operation.aliasResolution.state === "claimed"
              ? [operation.aliasResolution.targetResource]
              : []),
            ...(operation.canonicalClaimHeadTargetResource === null
              ? []
              : [operation.canonicalClaimHeadTargetResource]),
            ...(operation.aliasClaimHeadTargetResource === null
              ? []
              : [operation.aliasClaimHeadTargetResource])
          ].some((resource) => resource.tenantId !== context.input.tenantId)
        ) {
          return guardDeny("state_guard_failed", "identity.evidence_required");
        }
        return guardAllow([
          operation.canonicalIdentityRequirementId,
          operation.aliasIdentityRequirementId,
          ...new Set([
            ...(operation.canonicalClaimTargetAuthority === null
              ? []
              : [operation.canonicalClaimTargetAuthority.targetRequirementId]),
            ...(operation.aliasClaimTargetAuthority === null
              ? []
              : [operation.aliasClaimTargetAuthority.targetRequirementId])
          ])
        ]);
      }
      if (
        operation.sourceIdentityResource.entityTypeId !==
          "core:source-external-identity" ||
        operation.observationResource.entityTypeId !==
          "core:source-identity-observation" ||
        operation.annotationResource.entityTypeId !==
          "core:identity-review-annotation" ||
        !sameEntityKey(
          operation.observationSourceIdentityResource,
          operation.sourceIdentityResource
        ) ||
        !sameEntityKey(
          operation.reviewedObservationResource,
          operation.observationResource
        ) ||
        !sameEntityKey(operation.annotationResource, guard.targetResource) ||
        operation.annotationOperation !== "append_annotation" ||
        operation.writeSet.length !== 1 ||
        operation.writeSet[0] !== "review_annotation" ||
        operation.reasonCodeId.trim().length === 0 ||
        operation.auditEventResource.entityTypeId !== "core:audit-event" ||
        operation.auditActorEmployeeId !== operation.actorEmployeeId ||
        !sameEntityKey(
          operation.auditSourceIdentityResource,
          operation.sourceIdentityResource
        ) ||
        !sameEntityKey(
          operation.auditTargetResource,
          operation.annotationResource
        ) ||
        !identityRevisionSetIsCurrent(
          operation.sourceIdentityRevisionChecks,
          "entity"
        ) ||
        !identityRevisionSetIsCurrent(
          operation.observationRevisionChecks,
          "entity"
        ) ||
        !identityRevisionSetIsCurrent(
          operation.annotationRevisionChecks,
          "entity"
        ) ||
        !identityRevisionSetIsCurrent(
          operation.auditRevisionChecks,
          "entity"
        ) ||
        [
          operation.sourceIdentityResource,
          operation.observationResource,
          operation.annotationResource,
          operation.auditEventResource
        ].some((resource) => resource.tenantId !== context.input.tenantId)
      ) {
        return guardDeny("hard_boundary_denied", "identity.evidence_required");
      }
      return guardAllow([operation.sourceIdentityRequirementId]);
    }
    case "core:rbac.guard.report_resource_conjunction": {
      if (
        (permissionId === "core:reports.drilldown"
          ? guard.accessLevel !== "drilldown"
          : permissionId === "core:reports.pii.view"
            ? guard.accessLevel !== "pii"
            : permissionId === "core:reports.pii.export"
              ? guard.accessLevel !== "pii_export"
              : true) ||
        guard.layerRequirementIds.length === 0 ||
        !guard.scopeAppliedBeforeCountAndPagination ||
        guard.underlyingRequirementIds.length === 0 ||
        guard.underlyingResources.length !==
          guard.underlyingRequirementIds.length ||
        new Set(guard.underlyingRequirementIds).size !==
          guard.underlyingRequirementIds.length ||
        new Set(guard.underlyingResources.map(entityKeyString)).size !==
          guard.underlyingResources.length ||
        !authorizationManifestIsCurrent(
          guard.manifestResource,
          guard.manifestTargetResource,
          guard.targetResource,
          guard.manifestRevisionChecks
        ) ||
        guard.privateInternalIncluded ||
        guard.privateInternalRequirementIds.length > 0
      ) {
        return guardDeny("hard_boundary_denied", "report.scope_forbidden");
      }
      return guardAllow([
        ...guard.layerRequirementIds,
        ...guard.underlyingRequirementIds,
        ...guard.privateInternalRequirementIds
      ]);
    }
    case "core:rbac.guard.audit_facets": {
      if (
        !guard.scopeAppliedBeforeCountAndPagination ||
        guard.facetRequirementIds.length === 0 ||
        guard.facetResources.length !== guard.facetRequirementIds.length ||
        new Set(guard.facetRequirementIds).size !==
          guard.facetRequirementIds.length ||
        new Set(guard.facetResources.map(entityKeyString)).size !==
          guard.facetResources.length ||
        !authorizationManifestIsCurrent(
          guard.manifestResource,
          guard.manifestTargetResource,
          guard.targetResource,
          guard.manifestRevisionChecks
        ) ||
        (guard.piiRequested && guard.piiRequirementId === null)
      ) {
        return guardDeny("hard_boundary_denied", "report.scope_forbidden");
      }
      return guardAllow([
        ...guard.facetRequirementIds,
        ...(guard.piiRequirementId === null ? [] : [guard.piiRequirementId])
      ]);
    }
    case "core:rbac.guard.privacy_policy_revision": {
      const activation = guard.activationEvidence;
      const approverGrant =
        activation !== null && guard.approverEmployeeId !== null
          ? matchActiveEmployeeGrantForScope(
              context.input,
              activation.approverGrantId,
              guard.approverEmployeeId,
              "core:privacy.policy.manage",
              { type: "tenant", tenantId: context.input.tenantId }
            )
          : Object.freeze({ matched: false as const });
      if (
        actorEmployeeId === null ||
        guard.actingEmployeeId !== actorEmployeeId ||
        (permissionId === "core:privacy.policy.view"
          ? guard.phase !== "view"
          : permissionId === "core:privacy.policy.manage"
            ? guard.phase !== "preview" && guard.phase !== "activate"
            : true) ||
        guard.contentAuthorityRequested !== false
      ) {
        return guardDeny("hard_boundary_denied", "permission.denied");
      }
      if (
        guard.expectedPolicyRevision !== guard.currentPolicyRevision ||
        guard.governanceContextId.trim().length === 0 ||
        guard.governanceContextResource.entityTypeId !==
          "core:governance-context" ||
        !entityKeyMatchesOpaqueId(
          guard.governanceContextResource,
          guard.governanceContextId
        ) ||
        guard.governanceContextResource.tenantId !==
          guard.targetResource.tenantId ||
        guard.expectedGovernanceRevision !== guard.currentGovernanceRevision ||
        guard.governanceRelationResource.entityTypeId !==
          "core:privacy-policy-governance-binding" ||
        [
          guard.governanceContextResource,
          guard.governanceRelationResource,
          guard.governancePolicyResource,
          guard.governanceRelationContextResource
        ].some(
          (resource) => resource.tenantId !== guard.targetResource.tenantId
        ) ||
        !sameEntityKey(guard.governancePolicyResource, guard.targetResource) ||
        !sameEntityKey(
          guard.governanceRelationContextResource,
          guard.governanceContextResource
        ) ||
        !exactKeyedRevisionSetIsCurrent(guard.governanceRevisionChecks, [
          guard.governanceRelationResource,
          guard.targetResource,
          guard.governanceContextResource
        ])
      ) {
        return guardDeny("revision_guard_failed", "privacy.revision_changed");
      }
      if (
        guard.phase === "activate" &&
        (guard.approverEmployeeId === null ||
          guard.actingEmployeeId !== guard.approverEmployeeId ||
          guard.approverEmployeeId === guard.requesterEmployeeId)
      ) {
        return guardDeny(
          "separation_of_duties_denied",
          "privacy.separation_of_duties"
        );
      }
      if (guard.phase === "activate") {
        if (
          activation === null ||
          guard.approverEmployeeId === null ||
          activation.previewResource.entityTypeId !==
            "core:privacy-policy-preview" ||
          !sameEntityKey(
            activation.previewPolicyResource,
            guard.targetResource
          ) ||
          !sameEntityKey(
            activation.previewGovernanceContextResource,
            guard.governanceContextResource
          ) ||
          activation.impactManifestResource.entityTypeId !==
            "core:privacy-policy-impact-manifest" ||
          !sameEntityKey(
            activation.impactManifestPolicyResource,
            guard.targetResource
          ) ||
          !sameEntityKey(
            activation.impactManifestPreviewResource,
            activation.previewResource
          ) ||
          !sameEntityKey(
            activation.impactManifestGovernanceContextResource,
            guard.governanceContextResource
          ) ||
          activation.approvalResource.entityTypeId !==
            "core:privacy-policy-approval" ||
          activation.activationLedgerResource.entityTypeId !==
            "core:privacy-policy-activation-ledger" ||
          [
            activation.previewResource,
            activation.previewPolicyResource,
            activation.previewRequesterEmployeeResource,
            activation.previewGovernanceContextResource,
            activation.impactManifestResource,
            activation.impactManifestPolicyResource,
            activation.impactManifestPreviewResource,
            activation.impactManifestGovernanceContextResource,
            activation.approvalResource,
            activation.approvalPolicyResource,
            activation.approvalPreviewResource,
            activation.approvalImpactManifestResource,
            activation.approvalGovernanceContextResource,
            activation.approvalRequesterEmployeeResource,
            activation.approvalApproverEmployeeResource,
            activation.activationLedgerResource,
            activation.activationLedgerPolicyResource,
            activation.activationLedgerGovernanceContextResource,
            activation.activationLedgerGovernanceRelationResource,
            activation.activationLedgerPreviewResource,
            activation.activationLedgerImpactManifestResource,
            activation.activationLedgerApprovalResource
          ].some(
            (resource) => resource.tenantId !== guard.targetResource.tenantId
          ) ||
          !sameEntityKey(
            activation.approvalPolicyResource,
            guard.targetResource
          ) ||
          !sameEntityKey(
            activation.approvalPreviewResource,
            activation.previewResource
          ) ||
          !sameEntityKey(
            activation.approvalImpactManifestResource,
            activation.impactManifestResource
          ) ||
          !sameEntityKey(
            activation.approvalGovernanceContextResource,
            guard.governanceContextResource
          ) ||
          !sameEntityKey(
            activation.activationLedgerPolicyResource,
            guard.targetResource
          ) ||
          !sameEntityKey(
            activation.activationLedgerGovernanceContextResource,
            guard.governanceContextResource
          ) ||
          !sameEntityKey(
            activation.activationLedgerGovernanceRelationResource,
            guard.governanceRelationResource
          ) ||
          !sameEntityKey(
            activation.activationLedgerPreviewResource,
            activation.previewResource
          ) ||
          !sameEntityKey(
            activation.activationLedgerImpactManifestResource,
            activation.impactManifestResource
          ) ||
          !sameEntityKey(
            activation.activationLedgerApprovalResource,
            activation.approvalResource
          ) ||
          activation.previewRequesterEmployeeResource.entityTypeId !==
            "core:employee" ||
          activation.approvalRequesterEmployeeResource.entityTypeId !==
            "core:employee" ||
          !entityKeyMatchesOpaqueId(
            activation.previewRequesterEmployeeResource,
            String(guard.requesterEmployeeId)
          ) ||
          !entityKeyMatchesOpaqueId(
            activation.approvalRequesterEmployeeResource,
            String(guard.requesterEmployeeId)
          ) ||
          !sameEntityKey(
            activation.previewRequesterEmployeeResource,
            activation.approvalRequesterEmployeeResource
          ) ||
          activation.approvalApproverEmployeeResource.entityTypeId !==
            "core:employee" ||
          !entityKeyMatchesOpaqueId(
            activation.approvalApproverEmployeeResource,
            String(guard.approverEmployeeId)
          ) ||
          activation.approverLifecycle !== "active" ||
          activation.approvalState !== "approved" ||
          !exactKeyedRevisionSetIsCurrent(
            activation.revisionChecks,
            uniqueEntityResources([
              activation.previewResource,
              activation.impactManifestResource,
              activation.approvalResource,
              activation.activationLedgerResource,
              guard.targetResource,
              guard.governanceContextResource,
              guard.governanceRelationResource,
              activation.approvalRequesterEmployeeResource,
              activation.approvalApproverEmployeeResource
            ])
          ) ||
          !keyedRevisionMatchesValues(
            activation.revisionChecks,
            guard.targetResource,
            guard.expectedPolicyRevision,
            guard.currentPolicyRevision
          ) ||
          !keyedRevisionMatchesValues(
            activation.revisionChecks,
            guard.governanceContextResource,
            guard.expectedGovernanceRevision,
            guard.currentGovernanceRevision
          ) ||
          !keyedRevisionsAgree(
            activation.revisionChecks,
            guard.governanceRevisionChecks,
            guard.targetResource
          ) ||
          !keyedRevisionsAgree(
            activation.revisionChecks,
            guard.governanceRevisionChecks,
            guard.governanceContextResource
          ) ||
          !keyedRevisionsAgree(
            activation.revisionChecks,
            guard.governanceRevisionChecks,
            guard.governanceRelationResource
          ) ||
          !isTimestamp(activation.coolingPeriodEndsAt) ||
          Date.parse(context.input.evaluatedAt) <
            Date.parse(activation.coolingPeriodEndsAt) ||
          !isTimestamp(activation.approvalNotAfter) ||
          !isStrictlyAfter(
            activation.approvalNotAfter,
            context.input.evaluatedAt
          ) ||
          !approverGrant.matched ||
          (approverGrant.matched &&
            approverGrant.boundary !== null &&
            isStrictlyAfter(
              activation.approvalNotAfter,
              approverGrant.boundary
            ))
        ) {
          return guardDeny("revision_guard_failed", "privacy.revision_changed");
        }
      } else if (activation !== null) {
        return guardDeny("hard_boundary_denied", "permission.denied");
      }
      if (
        (guard.phase === "view" || guard.phase === "preview") &&
        guard.actingEmployeeId !== guard.requesterEmployeeId
      ) {
        return guardDeny(
          "separation_of_duties_denied",
          "privacy.separation_of_duties"
        );
      }
      return guardAllow(
        activation === null ? [] : [activation.approverDirectoryRequirementId],
        activation?.approvalNotAfter ?? null,
        ...(approverGrant.matched ? [approverGrant.boundary] : [])
      );
    }
    case "core:rbac.guard.privacy_request_roots_revision": {
      const party = guard.casePartyEvidence;
      const ledger = guard.decisionLedger;
      const executorRelation = guard.executorRelation;
      const rootResources = guard.rootDecisions.map(
        ({ rootResource }) => rootResource
      );
      if (
        actorEmployeeId === null ||
        guard.actingEmployeeId !== actorEmployeeId ||
        (permissionId === "core:privacy.request.view"
          ? guard.phase !== "view"
          : permissionId === "core:privacy.request.decide"
            ? guard.phase !== "decide"
            : permissionId === "core:privacy.request.execute"
              ? guard.phase !== "execute"
              : true) ||
        guard.contentAuthorityDerivedFromRequester !== false
      ) {
        return guardDeny("hard_boundary_denied", "permission.denied");
      }
      if (
        guard.targetResource.entityTypeId !== "core:privacy-request" ||
        guard.targetResource.tenantId !== context.input.tenantId ||
        !entityKeyMatchesOpaqueId(guard.targetResource, guard.caseId) ||
        party.bindingResource.entityTypeId !==
          "core:privacy-request-party-binding" ||
        party.bindingResource.tenantId !== guard.targetResource.tenantId ||
        !sameEntityKey(party.bindingCaseResource, guard.targetResource) ||
        !sameEntityKey(
          party.bindingRequesterEmployeeResource,
          party.requesterEmployeeResource
        ) ||
        !privacyEmployeeResourceMatchesId(
          party.requesterEmployeeResource,
          guard.requesterEmployeeId,
          guard.targetResource.tenantId
        ) ||
        party.state !== "immutable" ||
        !exactKeyedRevisionSetIsCurrent(party.revisionChecks, [
          party.bindingResource,
          guard.targetResource,
          party.requesterEmployeeResource
        ]) ||
        (guard.phase !== "view" && guard.verificationState !== "verified") ||
        guard.expectedRootsRevision !== guard.currentRootsRevision ||
        guard.governanceContextResource.entityTypeId !==
          "core:governance-context" ||
        guard.governanceContextResource.tenantId !==
          guard.targetResource.tenantId ||
        guard.expectedGovernanceRevision !== guard.currentGovernanceRevision ||
        !privacyDiscoveryManifestIsCurrent(
          guard.discoveryManifestResource,
          guard.discoveryManifestTargetResource,
          guard.targetResource,
          guard.discoveryManifestRevisionChecks
        ) ||
        !exactEntityKeySetMatches(
          guard.discoveryManifestRootResources,
          rootResources
        ) ||
        guard.discoveryManifestRootResources.some(
          (resource) => resource.tenantId !== guard.targetResource.tenantId
        ) ||
        !exactKeyedRevisionSetIsCurrent(
          guard.discoveryManifestMembershipRevisionChecks,
          uniqueEntityResources([
            guard.discoveryManifestResource,
            guard.targetResource,
            ...rootResources
          ])
        ) ||
        !keyedRevisionsAgree(
          guard.discoveryManifestMembershipRevisionChecks,
          guard.discoveryManifestRevisionChecks,
          guard.discoveryManifestResource
        ) ||
        !keyedRevisionsAgree(
          guard.discoveryManifestMembershipRevisionChecks,
          guard.discoveryManifestRevisionChecks,
          guard.targetResource
        ) ||
        (guard.phase !== "view" &&
          (guard.rootDecisions.length === 0 ||
            new Set(
              guard.rootDecisions.map(({ rootResource }) =>
                entityKeyString(rootResource)
              )
            ).size !== guard.rootDecisions.length ||
            guard.rootDecisions.some(
              (decision) =>
                decision.rootResource.tenantId !==
                  guard.targetResource.tenantId ||
                decision.discoveryProofResource.tenantId !==
                  guard.targetResource.tenantId ||
                decision.discoveryProofResource.entityTypeId !==
                  "core:privacy-discovery-proof" ||
                !sameEntityKey(
                  decision.proofRequestResource,
                  guard.targetResource
                ) ||
                !sameEntityKey(
                  decision.proofRootResource,
                  decision.rootResource
                ) ||
                !exactKeyedRevisionSetIsCurrent(decision.proofRevisionChecks, [
                  decision.discoveryProofResource,
                  guard.targetResource,
                  decision.rootResource
                ]) ||
                !keyedRevisionsAgree(
                  guard.discoveryManifestMembershipRevisionChecks,
                  decision.proofRevisionChecks,
                  guard.targetResource
                ) ||
                !keyedRevisionsAgree(
                  guard.discoveryManifestMembershipRevisionChecks,
                  decision.proofRevisionChecks,
                  decision.rootResource
                ) ||
                decision.policyRuleId.trim().length === 0 ||
                decision.policyRuleResource.entityTypeId !==
                  "core:data-lifecycle-policy-rule" ||
                decision.policyRuleResource.tenantId !==
                  guard.targetResource.tenantId ||
                !entityKeyMatchesOpaqueId(
                  decision.policyRuleResource,
                  decision.policyRuleId
                ) ||
                !sameEntityKey(
                  decision.policyRuleRequestResource,
                  guard.targetResource
                ) ||
                !sameEntityKey(
                  decision.policyRuleRootResource,
                  decision.rootResource
                ) ||
                decision.policyRuleState !== "active" ||
                !exactKeyedRevisionSetIsCurrent(
                  decision.policyRuleRevisionChecks,
                  [
                    decision.policyRuleResource,
                    guard.targetResource,
                    decision.rootResource
                  ]
                ) ||
                !keyedRevisionsAgree(
                  guard.discoveryManifestMembershipRevisionChecks,
                  decision.policyRuleRevisionChecks,
                  guard.targetResource
                ) ||
                !keyedRevisionsAgree(
                  guard.discoveryManifestMembershipRevisionChecks,
                  decision.policyRuleRevisionChecks,
                  decision.rootResource
                ) ||
                decision.expectedDecisionRevision.trim().length === 0 ||
                decision.expectedDecisionRevision !==
                  decision.currentDecisionRevision ||
                (guard.phase === "execute" &&
                  decision.decisionState === "pending")
            ))) ||
        (guard.phase === "view" &&
          (ledger !== null || executorRelation !== null)) ||
        (guard.phase === "decide" &&
          (ledger === null ||
            executorRelation !== null ||
            guard.deciderEmployeeId === null ||
            ledger.resource.entityTypeId !==
              "core:privacy-request-decision-ledger" ||
            ledger.resource.tenantId !== guard.targetResource.tenantId ||
            !sameEntityKey(ledger.caseResource, guard.targetResource) ||
            !sameEntityKey(
              ledger.requesterEmployeeResource,
              party.requesterEmployeeResource
            ) ||
            !privacyEmployeeResourceMatchesId(
              ledger.deciderEmployeeResource,
              guard.deciderEmployeeId,
              guard.targetResource.tenantId
            ) ||
            ledger.rootManifestResource.entityTypeId !==
              "core:privacy-request-root-decision-manifest" ||
            ledger.rootManifestResource.tenantId !==
              guard.targetResource.tenantId ||
            !sameEntityKey(
              ledger.rootManifestDecisionResource,
              ledger.resource
            ) ||
            !sameEntityKey(
              ledger.rootManifestCaseResource,
              guard.targetResource
            ) ||
            !exactEntityKeySetMatches(
              ledger.rootManifestRootResources,
              rootResources
            ) ||
            ledger.state !== "pending" ||
            !privacyRequestDecisionManifestIsCurrent(
              ledger,
              guard.targetResource,
              party.requesterEmployeeResource,
              ledger.deciderEmployeeResource,
              guard.rootDecisions,
              guard.discoveryManifestResource,
              guard.discoveryManifestMembershipRevisionChecks
            ))) ||
        (guard.phase === "execute" &&
          (ledger === null ||
            executorRelation === null ||
            guard.deciderEmployeeId === null ||
            guard.executorEmployeeId === null ||
            ledger.resource.entityTypeId !==
              "core:privacy-request-decision-ledger" ||
            ledger.resource.tenantId !== guard.targetResource.tenantId ||
            !sameEntityKey(ledger.caseResource, guard.targetResource) ||
            !sameEntityKey(
              ledger.requesterEmployeeResource,
              party.requesterEmployeeResource
            ) ||
            !privacyEmployeeResourceMatchesId(
              ledger.deciderEmployeeResource,
              guard.deciderEmployeeId,
              guard.targetResource.tenantId
            ) ||
            ledger.rootManifestResource.entityTypeId !==
              "core:privacy-request-root-decision-manifest" ||
            ledger.rootManifestResource.tenantId !==
              guard.targetResource.tenantId ||
            !sameEntityKey(
              ledger.rootManifestDecisionResource,
              ledger.resource
            ) ||
            !sameEntityKey(
              ledger.rootManifestCaseResource,
              guard.targetResource
            ) ||
            !exactEntityKeySetMatches(
              ledger.rootManifestRootResources,
              rootResources
            ) ||
            ledger.state !== "approved" ||
            !privacyRequestDecisionManifestIsCurrent(
              ledger,
              guard.targetResource,
              party.requesterEmployeeResource,
              ledger.deciderEmployeeResource,
              guard.rootDecisions,
              guard.discoveryManifestResource,
              guard.discoveryManifestMembershipRevisionChecks
            ) ||
            executorRelation.resource.entityTypeId !==
              "core:privacy-request-executor-relation" ||
            executorRelation.resource.tenantId !==
              guard.targetResource.tenantId ||
            !sameEntityKey(
              executorRelation.decisionResource,
              ledger.resource
            ) ||
            !sameEntityKey(
              executorRelation.caseResource,
              guard.targetResource
            ) ||
            !sameEntityKey(
              executorRelation.relationExecutorEmployeeResource,
              executorRelation.executorEmployeeResource
            ) ||
            !privacyEmployeeResourceMatchesId(
              executorRelation.executorEmployeeResource,
              guard.executorEmployeeId,
              guard.targetResource.tenantId
            ) ||
            executorRelation.state !== "active" ||
            !exactKeyedRevisionSetIsCurrent(
              executorRelation.revisionChecks,
              uniqueEntityResources([
                executorRelation.resource,
                ledger.resource,
                guard.targetResource,
                party.requesterEmployeeResource,
                ledger.deciderEmployeeResource,
                ledger.rootManifestResource,
                guard.discoveryManifestResource,
                ...rootResources,
                executorRelation.executorEmployeeResource
              ])
            ) ||
            !uniqueEntityResources([
              ledger.resource,
              guard.targetResource,
              party.requesterEmployeeResource,
              ledger.deciderEmployeeResource,
              ledger.rootManifestResource,
              guard.discoveryManifestResource,
              ...rootResources
            ]).every((resource) =>
              keyedRevisionsAgree(
                executorRelation.revisionChecks,
                ledger.revisionChecks,
                resource
              )
            ) ||
            !uniqueEntityResources([
              guard.discoveryManifestResource,
              guard.targetResource,
              ...rootResources
            ]).every((resource) =>
              keyedRevisionsAgree(
                executorRelation.revisionChecks,
                guard.discoveryManifestMembershipRevisionChecks,
                resource
              )
            )))
      ) {
        return guardDeny("revision_guard_failed", "privacy.revision_changed");
      }
      if (
        (guard.phase === "decide" &&
          (guard.deciderEmployeeId === null ||
            guard.actingEmployeeId !== guard.deciderEmployeeId ||
            ledger === null ||
            sameEntityKey(
              ledger.deciderEmployeeResource,
              party.requesterEmployeeResource
            ))) ||
        (guard.phase === "execute" &&
          (guard.executorEmployeeId === null ||
            guard.deciderEmployeeId === null ||
            ledger === null ||
            executorRelation === null ||
            guard.actingEmployeeId !== guard.executorEmployeeId ||
            sameEntityKey(
              executorRelation.executorEmployeeResource,
              party.requesterEmployeeResource
            ) ||
            sameEntityKey(
              executorRelation.executorEmployeeResource,
              ledger.deciderEmployeeResource
            )))
      ) {
        return guardDeny(
          "separation_of_duties_denied",
          "privacy.separation_of_duties"
        );
      }
      return guardAllow([]);
    }
    case "core:rbac.guard.privacy_subject_evidence_roots": {
      if (
        guard.evidenceState !== "verified" ||
        guard.exactRootRequirementIds.length === 0 ||
        guard.exactRootResources.length !==
          guard.exactRootRequirementIds.length ||
        new Set(guard.exactRootRequirementIds).size !==
          guard.exactRootRequirementIds.length ||
        new Set(guard.exactRootResources.map(entityKeyString)).size !==
          guard.exactRootResources.length ||
        !authorizationManifestIsCurrent(
          guard.manifestResource,
          guard.manifestTargetResource,
          guard.targetResource,
          guard.manifestRevisionChecks
        ) ||
        guard.manifestRootResources.length !==
          guard.exactRootResources.length ||
        !guard.manifestRootResources.every((resource, index) =>
          sameEntityKey(resource, guard.exactRootResources[index]!)
        ) ||
        !exactKeyedRevisionSetIsCurrent(
          guard.manifestMembershipRevisionChecks,
          uniqueEntityResources([
            guard.manifestResource,
            guard.targetResource,
            ...guard.exactRootResources
          ])
        ) ||
        (guard.thirdPartyPolicy === "allow_with_purpose"
          ? guard.purpose === null ||
            guard.purpose.trim().length === 0 ||
            guard.purposePolicy === null ||
            guard.purposePolicy.resource.entityTypeId !==
              "core:privacy-purpose-policy" ||
            guard.purposePolicy.resource.tenantId !==
              guard.targetResource.tenantId ||
            !sameEntityKey(
              guard.purposePolicy.targetResource,
              guard.targetResource
            ) ||
            !guard.purposePolicy.approvedPurposeIds.includes(guard.purpose) ||
            !exactKeyedRevisionSetIsCurrent(
              guard.purposePolicy.revisionChecks,
              [guard.purposePolicy.resource, guard.targetResource]
            ) ||
            !isTimestamp(guard.purposePolicy.notAfter) ||
            !isStrictlyAfter(
              guard.purposePolicy.notAfter,
              context.input.evaluatedAt
            )
          : guard.purpose !== null || guard.purposePolicy !== null)
      ) {
        return guardDeny("hard_boundary_denied", "privacy.scope_ambiguous");
      }
      return guardAllow(
        guard.exactRootRequirementIds,
        guard.purposePolicy?.notAfter ?? null
      );
    }
    case "core:rbac.guard.privacy_hold_manifest_revision": {
      const approval = guard.approvalEvidence;
      const issuer = guard.issuerEvidence;
      const approverGrant =
        approval === null
          ? Object.freeze({ matched: false as const })
          : matchActiveEmployeeGrantForScope(
              context.input,
              approval.approverGrantId,
              approval.approverEmployeeId,
              permissionId,
              { type: "tenant", tenantId: context.input.tenantId },
              "tenant"
            );
      if (
        actorEmployeeId === null ||
        guard.actingEmployeeId !== actorEmployeeId ||
        (permissionId === "core:privacy.hold.view"
          ? guard.phase !== "view"
          : permissionId === "core:privacy.hold.issue"
            ? guard.phase !== "issue"
            : permissionId === "core:privacy.hold.release"
              ? guard.phase !== "release"
              : true) ||
        guard.contentAuthorityRequested !== false
      ) {
        return guardDeny("hard_boundary_denied", "permission.denied");
      }
      if (
        guard.manifestAuthenticity !== "authentic" ||
        guard.manifestResource.entityTypeId !==
          "core:privacy-hold-scope-manifest" ||
        guard.manifestResource.tenantId !== context.input.tenantId ||
        !sameEntityKey(guard.manifestHoldResource, guard.targetResource) ||
        guard.rootResources.length === 0 ||
        !exactEntityKeySetMatches(
          guard.manifestRootResources,
          guard.rootResources
        ) ||
        guard.rootResources.some(
          (resource) => resource.tenantId !== context.input.tenantId
        ) ||
        !exactKeyedRevisionSetIsCurrent(
          guard.manifestRevisionChecks,
          uniqueEntityResources([
            guard.manifestResource,
            guard.targetResource,
            ...guard.rootResources
          ])
        ) ||
        guard.expectedManifestRevision.trim().length === 0 ||
        guard.expectedManifestRevision !== guard.currentManifestRevision ||
        !keyedRevisionMatchesValues(
          guard.manifestRevisionChecks,
          guard.targetResource,
          guard.expectedManifestRevision,
          guard.currentManifestRevision
        ) ||
        !isTimestamp(guard.lastReviewedAt) ||
        !isTimestamp(guard.nextReviewAt) ||
        !isAtOrAfter(context.input.evaluatedAt, guard.lastReviewedAt)
      ) {
        return guardDeny("revision_guard_failed", "privacy.scope_ambiguous");
      }
      if (guard.phase === "view") {
        if (
          guard.reason.trim().length !== 0 ||
          guard.reviewerEmployeeId !== null ||
          guard.issuerEmployeeId !== null ||
          guard.releaserEmployeeId !== null ||
          issuer !== null ||
          approval !== null
        ) {
          return guardDeny("hard_boundary_denied", "permission.denied");
        }
        // An overdue hold remains visible so that it can be reviewed/remediated.
        return guardAllow([]);
      }
      if (
        !isStrictlyAfter(guard.nextReviewAt, context.input.evaluatedAt) ||
        issuer === null ||
        issuer.resource.entityTypeId !== "core:privacy-hold-issuer-binding" ||
        issuer.resource.tenantId !== context.input.tenantId ||
        !sameEntityKey(issuer.holdResource, guard.targetResource) ||
        !sameEntityKey(issuer.manifestResource, guard.manifestResource) ||
        !exactEntityKeySetMatches(
          issuer.manifestRootResources,
          guard.rootResources
        ) ||
        issuer.issuerEmployeeResource.entityTypeId !== "core:employee" ||
        issuer.issuerEmployeeResource.tenantId !== context.input.tenantId ||
        !entityKeyMatchesOpaqueId(
          issuer.issuerEmployeeResource,
          String(issuer.issuerEmployeeId)
        ) ||
        guard.issuerEmployeeId !== issuer.issuerEmployeeId ||
        !exactKeyedRevisionSetIsCurrent(issuer.revisionChecks, [
          issuer.resource,
          guard.targetResource,
          guard.manifestResource,
          issuer.issuerEmployeeResource,
          ...guard.rootResources
        ]) ||
        !keyedRevisionsAgree(
          issuer.revisionChecks,
          guard.manifestRevisionChecks,
          guard.targetResource
        ) ||
        !keyedRevisionsAgree(
          issuer.revisionChecks,
          guard.manifestRevisionChecks,
          guard.manifestResource
        ) ||
        guard.rootResources.some(
          (resource) =>
            !keyedRevisionsAgree(
              issuer.revisionChecks,
              guard.manifestRevisionChecks,
              resource
            )
        ) ||
        approval === null ||
        approval.resource.entityTypeId !== "core:privacy-hold-approval" ||
        approval.resource.tenantId !== context.input.tenantId ||
        !sameEntityKey(approval.holdResource, guard.targetResource) ||
        !sameEntityKey(approval.manifestResource, guard.manifestResource) ||
        !exactEntityKeySetMatches(
          approval.manifestRootResources,
          guard.rootResources
        ) ||
        approval.approverEmployeeResource.entityTypeId !== "core:employee" ||
        !entityKeyMatchesOpaqueId(
          approval.approverEmployeeResource,
          String(approval.approverEmployeeId)
        ) ||
        approval.approverEmployeeResource.tenantId !== context.input.tenantId ||
        approval.approverLifecycle !== "active" ||
        approval.state !== "approved" ||
        !exactKeyedRevisionSetIsCurrent(approval.revisionChecks, [
          approval.resource,
          guard.targetResource,
          guard.manifestResource,
          approval.approverEmployeeResource,
          ...guard.rootResources
        ]) ||
        !keyedRevisionsAgree(
          approval.revisionChecks,
          guard.manifestRevisionChecks,
          guard.targetResource
        ) ||
        !keyedRevisionsAgree(
          approval.revisionChecks,
          guard.manifestRevisionChecks,
          guard.manifestResource
        ) ||
        guard.rootResources.some(
          (resource) =>
            !keyedRevisionsAgree(
              approval.revisionChecks,
              guard.manifestRevisionChecks,
              resource
            )
        ) ||
        !isTimestamp(approval.notAfter) ||
        !isStrictlyAfter(approval.notAfter, context.input.evaluatedAt) ||
        !approverGrant.matched ||
        (approverGrant.matched &&
          approverGrant.boundary !== null &&
          isStrictlyAfter(approval.notAfter, approverGrant.boundary))
      ) {
        return guardDeny("revision_guard_failed", "privacy.scope_ambiguous");
      }
      if (
        guard.phase === "issue" &&
        (guard.issuerEmployeeId === null ||
          guard.actingEmployeeId !== guard.issuerEmployeeId ||
          guard.actingEmployeeId !== issuer.issuerEmployeeId ||
          guard.reviewerEmployeeId === null ||
          guard.reviewerEmployeeId !== approval.approverEmployeeId ||
          guard.reviewerEmployeeId === guard.issuerEmployeeId ||
          guard.releaserEmployeeId !== null ||
          guard.reason.trim().length === 0)
      ) {
        return guardDeny(
          "separation_of_duties_denied",
          "privacy.separation_of_duties"
        );
      }
      if (
        guard.phase === "release" &&
        (guard.issuerEmployeeId === null ||
          guard.releaserEmployeeId === null ||
          guard.actingEmployeeId !== guard.releaserEmployeeId ||
          issuer.issuerEmployeeId === guard.releaserEmployeeId ||
          guard.reviewerEmployeeId === null ||
          guard.reviewerEmployeeId !== approval.approverEmployeeId ||
          guard.reviewerEmployeeId === guard.releaserEmployeeId ||
          guard.reason.trim().length === 0)
      ) {
        return guardDeny(
          "separation_of_duties_denied",
          "privacy.separation_of_duties"
        );
      }
      return guardAllow(
        [approval.approverDirectoryRequirementId],
        guard.nextReviewAt,
        approval.notAfter,
        ...(approverGrant.matched ? [approverGrant.boundary] : [])
      );
    }
    case "core:rbac.guard.privacy_tenant_export_high_water": {
      const approverGrant = matchActiveEmployeeGrantForScope(
        context.input,
        guard.approverGrantId,
        guard.approverEmployeeId,
        "core:privacy.tenant_export",
        { type: "tenant", tenantId: context.input.tenantId },
        "tenant"
      );
      if (
        actorEmployeeId === null ||
        guard.actingEmployeeId !== actorEmployeeId ||
        guard.actingEmployeeId !== guard.requesterEmployeeId ||
        guard.secretsIncluded !== false ||
        !guard.authorizationAppliedBeforePaginationAndMaterialization
      ) {
        return guardDeny("hard_boundary_denied", "permission.denied");
      }
      if (
        guard.manifestResource.entityTypeId !==
          "core:privacy-tenant-export-manifest" ||
        guard.manifestResource.tenantId !== context.input.tenantId ||
        !sameEntityKey(guard.manifestExportResource, guard.targetResource) ||
        guard.requesterEmployeeResource.entityTypeId !== "core:employee" ||
        guard.requesterEmployeeResource.tenantId !== context.input.tenantId ||
        !entityKeyMatchesOpaqueId(
          guard.requesterEmployeeResource,
          String(guard.requesterEmployeeId)
        ) ||
        guard.requesterRelationResource.entityTypeId !==
          "core:privacy-tenant-export-requester" ||
        guard.requesterRelationResource.tenantId !== context.input.tenantId ||
        !sameEntityKey(
          guard.requesterRelationExportResource,
          guard.targetResource
        ) ||
        !sameEntityKey(
          guard.requesterRelationEmployeeResource,
          guard.requesterEmployeeResource
        ) ||
        !sameEntityKey(
          guard.manifestRequesterEmployeeResource,
          guard.requesterEmployeeResource
        ) ||
        !sameEntityKey(
          guard.manifestRequesterRelationResource,
          guard.requesterRelationResource
        ) ||
        guard.graphResource.entityTypeId !== "core:tenant-resource-graph" ||
        guard.graphResource.tenantId !== context.input.tenantId ||
        !sameEntityKey(guard.manifestGraphResource, guard.graphResource) ||
        guard.rootResources.length === 0 ||
        !exactEntityKeySetMatches(
          guard.manifestRootResources,
          guard.rootResources
        ) ||
        guard.rootResources.some(
          (resource) => resource.tenantId !== context.input.tenantId
        ) ||
        (guard.piiAuthorityResource !== null &&
          (guard.piiAuthorityResource.entityTypeId !== "core:report-query" ||
            guard.piiAuthorityResource.tenantId !== context.input.tenantId)) ||
        !exactKeyedRevisionSetIsCurrent(
          guard.manifestRevisionChecks,
          uniqueEntityResources([
            guard.manifestResource,
            guard.targetResource,
            guard.requesterRelationResource,
            guard.requesterEmployeeResource,
            guard.graphResource,
            ...guard.rootResources,
            ...(guard.piiAuthorityResource === null
              ? []
              : [guard.piiAuthorityResource])
          ])
        ) ||
        !exactKeyedRevisionSetIsCurrent(guard.requesterRevisionChecks, [
          guard.requesterRelationResource,
          guard.targetResource,
          guard.requesterEmployeeResource
        ]) ||
        !keyedRevisionsAgree(
          guard.requesterRevisionChecks,
          guard.manifestRevisionChecks,
          guard.requesterRelationResource
        ) ||
        !keyedRevisionsAgree(
          guard.requesterRevisionChecks,
          guard.manifestRevisionChecks,
          guard.requesterEmployeeResource
        ) ||
        guard.expectedGraphHighWater.trim().length === 0 ||
        guard.expectedGraphHighWater !== guard.currentGraphHighWater
      ) {
        return guardDeny("revision_guard_failed", "privacy.revision_changed");
      }
      if (
        guard.approvalState !== "approved" ||
        guard.requesterEmployeeId === guard.approverEmployeeId ||
        guard.approvalResource.entityTypeId !==
          "core:privacy-tenant-export-approval" ||
        guard.approvalResource.tenantId !== context.input.tenantId ||
        !sameEntityKey(guard.approvalExportResource, guard.targetResource) ||
        !sameEntityKey(
          guard.approvalManifestResource,
          guard.manifestResource
        ) ||
        !sameEntityKey(
          guard.approvalRequesterEmployeeResource,
          guard.requesterEmployeeResource
        ) ||
        !sameEntityKey(
          guard.approvalRequesterRelationResource,
          guard.requesterRelationResource
        ) ||
        !sameEntityKey(guard.approvalGraphResource, guard.graphResource) ||
        guard.approvalGraphHighWater !== guard.currentGraphHighWater ||
        !exactEntityKeySetMatches(
          guard.approvalRootResources,
          guard.rootResources
        ) ||
        (guard.approvalPiiAuthorityResource === null
          ? guard.piiAuthorityResource !== null
          : guard.piiAuthorityResource === null ||
            !sameEntityKey(
              guard.approvalPiiAuthorityResource,
              guard.piiAuthorityResource
            )) ||
        guard.approvalApproverEmployeeResource.entityTypeId !==
          "core:employee" ||
        !entityKeyMatchesOpaqueId(
          guard.approvalApproverEmployeeResource,
          String(guard.approverEmployeeId)
        ) ||
        guard.approvalApproverEmployeeResource.tenantId !==
          context.input.tenantId ||
        guard.approverLifecycle !== "active" ||
        !exactKeyedRevisionSetIsCurrent(guard.approvalRevisionChecks, [
          guard.approvalResource,
          guard.targetResource,
          guard.manifestResource,
          guard.requesterRelationResource,
          guard.requesterEmployeeResource,
          guard.graphResource,
          guard.approvalApproverEmployeeResource,
          ...guard.rootResources,
          ...(guard.piiAuthorityResource === null
            ? []
            : [guard.piiAuthorityResource])
        ]) ||
        !keyedRevisionsAgree(
          guard.approvalRevisionChecks,
          guard.manifestRevisionChecks,
          guard.manifestResource
        ) ||
        !keyedRevisionsAgree(
          guard.approvalRevisionChecks,
          guard.requesterRevisionChecks,
          guard.requesterRelationResource
        ) ||
        !keyedRevisionsAgree(
          guard.approvalRevisionChecks,
          guard.requesterRevisionChecks,
          guard.requesterEmployeeResource
        ) ||
        !keyedRevisionsAgree(
          guard.approvalRevisionChecks,
          guard.manifestRevisionChecks,
          guard.graphResource
        ) ||
        guard.rootResources.some(
          (resource) =>
            !keyedRevisionsAgree(
              guard.approvalRevisionChecks,
              guard.manifestRevisionChecks,
              resource
            )
        ) ||
        (guard.piiAuthorityResource !== null &&
          !keyedRevisionsAgree(
            guard.approvalRevisionChecks,
            guard.manifestRevisionChecks,
            guard.piiAuthorityResource
          )) ||
        !isTimestamp(guard.approvalNotAfter) ||
        !isStrictlyAfter(guard.approvalNotAfter, context.input.evaluatedAt) ||
        !approverGrant.matched ||
        (approverGrant.matched &&
          approverGrant.boundary !== null &&
          isStrictlyAfter(guard.approvalNotAfter, approverGrant.boundary))
      ) {
        return guardDeny(
          "separation_of_duties_denied",
          "privacy.approval_required"
        );
      }
      return guardAllow(
        [
          guard.approverDirectoryRequirementId,
          ...(guard.piiRequirementId === null ? [] : [guard.piiRequirementId])
        ],
        guard.approvalNotAfter,
        ...(approverGrant.matched ? [approverGrant.boundary] : [])
      );
    }
    case "core:rbac.guard.privacy_deletion_plan_revisions": {
      const rootResources = guard.roots.map(({ resource }) => resource);
      const handlerResources = guard.handlers.map(({ resource }) => resource);
      const tenantId = guard.targetResource.tenantId;
      const externalSourceUseRequirementIds: string[] = [];
      const approval = guard.approvalEvidence;
      const approverGrant =
        approval === null
          ? Object.freeze({ matched: false as const })
          : matchActiveEmployeeGrantForScope(
              context.input,
              approval.approverGrantId,
              approval.approverEmployeeId,
              "core:privacy.deletion.approve",
              { type: "tenant", tenantId: context.input.tenantId },
              "tenant"
            );
      if (
        actorEmployeeId === null ||
        guard.actingEmployeeId !== actorEmployeeId ||
        (permissionId === "core:privacy.deletion.preview"
          ? guard.phase !== "preview"
          : permissionId === "core:privacy.deletion.approve"
            ? guard.phase !== "approve"
            : permissionId === "core:privacy.deletion.execute"
              ? guard.phase !== "execute"
              : true) ||
        guard.expectedPlanRevision.trim().length === 0 ||
        (guard.phase === "execute" ? approval === null : approval !== null) ||
        guard.roots.length === 0 ||
        guard.handlers.length === 0 ||
        !isTimestamp(guard.coolingPeriodEndsAt) ||
        !isTimestamp(guard.holdFenceCheckedAt) ||
        guard.holdFenceCheckedAt !== context.input.evaluatedAt ||
        !isTimestamp(guard.holdFenceNotAfter) ||
        !isStrictlyAfter(guard.holdFenceNotAfter, context.input.evaluatedAt) ||
        guard.manifestResource.entityTypeId !== "core:privacy-scope-manifest" ||
        guard.manifestResource.tenantId !== tenantId ||
        !sameEntityKey(guard.manifestTargetResource, guard.targetResource) ||
        guard.requesterEmployeeResource.entityTypeId !== "core:employee" ||
        guard.requesterEmployeeResource.tenantId !== tenantId ||
        !entityKeyMatchesOpaqueId(
          guard.requesterEmployeeResource,
          String(guard.requesterEmployeeId)
        ) ||
        guard.requesterRelationResource.entityTypeId !==
          "core:privacy-deletion-plan-requester" ||
        guard.requesterRelationResource.tenantId !== tenantId ||
        !sameEntityKey(
          guard.requesterRelationPlanResource,
          guard.targetResource
        ) ||
        !sameEntityKey(
          guard.requesterRelationEmployeeResource,
          guard.requesterEmployeeResource
        ) ||
        !sameEntityKey(
          guard.manifestRequesterEmployeeResource,
          guard.requesterEmployeeResource
        ) ||
        !sameEntityKey(
          guard.manifestRequesterRelationResource,
          guard.requesterRelationResource
        ) ||
        !exactEntityKeySetMatches(guard.manifestRootResources, rootResources) ||
        !exactEntityKeySetMatches(
          guard.manifestHandlerResources,
          handlerResources
        ) ||
        guard.holdIndexResource.entityTypeId !==
          "core:privacy-deletion-hold-index" ||
        guard.holdIndexResource.tenantId !== tenantId ||
        !sameEntityKey(guard.holdIndexPlanResource, guard.targetResource) ||
        !exactEntityKeySetMatches(
          guard.holdIndexRootResources,
          rootResources
        ) ||
        new Set(rootResources.map(entityKeyString)).size !==
          rootResources.length ||
        new Set(handlerResources.map(entityKeyString)).size !==
          handlerResources.length ||
        new Set(
          guard.roots.map(({ relationResource }) =>
            entityKeyString(relationResource)
          )
        ).size !== guard.roots.length ||
        new Set(
          guard.handlers.map(({ relationResource }) =>
            entityKeyString(relationResource)
          )
        ).size !== guard.handlers.length ||
        guard.roots.some(
          (root) =>
            !guard.handlers.some((handler) =>
              sameEntityKey(handler.rootResource, root.resource)
            )
        ) ||
        guard.roots.some(
          (root) =>
            root.resource.tenantId !== tenantId ||
            root.relationResource.entityTypeId !==
              "core:privacy-deletion-plan-root" ||
            root.relationResource.tenantId !== tenantId ||
            !sameEntityKey(root.relationPlanResource, guard.targetResource) ||
            !sameEntityKey(root.relationRootResource, root.resource) ||
            (root.rootKind === "external_route"
              ? root.boundary !== "outside_operated_data_plane"
              : root.boundary !== "operated_data_plane")
        ) ||
        guard.handlers.some((handler) => {
          const root = guard.roots.find((candidate) =>
            sameEntityKey(candidate.resource, handler.rootResource)
          );
          return (
            handler.resource.entityTypeId !== "core:privacy-delete-handler" ||
            handler.resource.tenantId !== tenantId ||
            handler.relationResource.entityTypeId !==
              "core:privacy-deletion-plan-handler" ||
            handler.relationResource.tenantId !== tenantId ||
            !sameEntityKey(
              handler.relationPlanResource,
              guard.targetResource
            ) ||
            !sameEntityKey(
              handler.relationRootResource,
              handler.rootResource
            ) ||
            !sameEntityKey(handler.relationHandlerResource, handler.resource) ||
            root === undefined ||
            root.rootKind !== handler.surfaceKind
          );
        })
      ) {
        return guardDeny("hard_boundary_denied", "permission.denied");
      }
      if (
        guard.expectedPlanRevision !== guard.currentPlanRevision ||
        !exactKeyedRevisionSetIsCurrent(guard.manifestRevisionChecks, [
          guard.manifestResource,
          guard.targetResource,
          guard.requesterRelationResource,
          guard.requesterEmployeeResource,
          ...rootResources,
          ...handlerResources
        ]) ||
        !exactKeyedRevisionSetIsCurrent(guard.requesterRevisionChecks, [
          guard.requesterRelationResource,
          guard.targetResource,
          guard.requesterEmployeeResource
        ]) ||
        guard.roots.some(
          (root) =>
            !exactKeyedRevisionSetIsCurrent(root.revisionChecks, [
              root.relationResource,
              guard.targetResource,
              root.resource
            ])
        ) ||
        guard.handlers.some(
          (handler) =>
            !exactKeyedRevisionSetIsCurrent(handler.revisionChecks, [
              handler.relationResource,
              guard.targetResource,
              handler.rootResource,
              handler.resource
            ])
        ) ||
        !exactKeyedRevisionSetIsCurrent(guard.holdRevisionChecks, [
          guard.holdIndexResource,
          guard.targetResource,
          ...rootResources
        ]) ||
        !keyedRevisionMatchesValues(
          guard.manifestRevisionChecks,
          guard.targetResource,
          guard.expectedPlanRevision,
          guard.currentPlanRevision
        ) ||
        !keyedRevisionMatchesValues(
          guard.requesterRevisionChecks,
          guard.targetResource,
          guard.expectedPlanRevision,
          guard.currentPlanRevision
        ) ||
        !keyedRevisionsAgree(
          guard.requesterRevisionChecks,
          guard.manifestRevisionChecks,
          guard.requesterRelationResource
        ) ||
        !keyedRevisionsAgree(
          guard.requesterRevisionChecks,
          guard.manifestRevisionChecks,
          guard.requesterEmployeeResource
        ) ||
        !keyedRevisionMatchesValues(
          guard.holdRevisionChecks,
          guard.targetResource,
          guard.expectedPlanRevision,
          guard.currentPlanRevision
        ) ||
        guard.roots.some(
          (root) =>
            !keyedRevisionMatchesValues(
              root.revisionChecks,
              guard.targetResource,
              guard.expectedPlanRevision,
              guard.currentPlanRevision
            ) ||
            !keyedRevisionsAgree(
              root.revisionChecks,
              guard.manifestRevisionChecks,
              root.resource
            ) ||
            !keyedRevisionsAgree(
              root.revisionChecks,
              guard.holdRevisionChecks,
              root.resource
            )
        ) ||
        guard.handlers.some((handler) => {
          const root = guard.roots.find((candidate) =>
            sameEntityKey(candidate.resource, handler.rootResource)
          );
          return (
            root === undefined ||
            !keyedRevisionMatchesValues(
              handler.revisionChecks,
              guard.targetResource,
              guard.expectedPlanRevision,
              guard.currentPlanRevision
            ) ||
            !keyedRevisionsAgree(
              handler.revisionChecks,
              guard.manifestRevisionChecks,
              handler.resource
            ) ||
            !keyedRevisionsAgree(
              handler.revisionChecks,
              root.revisionChecks,
              handler.rootResource
            )
          );
        })
      ) {
        return guardDeny("revision_guard_failed", "privacy.revision_changed");
      }

      if (
        guard.phase === "execute" &&
        (approval === null ||
          approval.resource.entityTypeId !== "core:privacy-deletion-approval" ||
          approval.resource.tenantId !== tenantId ||
          !sameEntityKey(approval.planResource, guard.targetResource) ||
          !sameEntityKey(approval.manifestResource, guard.manifestResource) ||
          !sameEntityKey(
            approval.requesterEmployeeResource,
            guard.requesterEmployeeResource
          ) ||
          !sameEntityKey(
            approval.requesterRelationResource,
            guard.requesterRelationResource
          ) ||
          approval.approverEmployeeResource.entityTypeId !== "core:employee" ||
          approval.approverEmployeeResource.tenantId !== tenantId ||
          !entityKeyMatchesOpaqueId(
            approval.approverEmployeeResource,
            String(approval.approverEmployeeId)
          ) ||
          approval.approverLifecycle !== "active" ||
          approval.approverDirectoryRequirementId.trim().length === 0 ||
          approval.approverGrantId.trim().length === 0 ||
          approval.state !== "approved" ||
          !isTimestamp(approval.notAfter) ||
          !isStrictlyAfter(approval.notAfter, context.input.evaluatedAt) ||
          !exactKeyedRevisionSetIsCurrent(approval.revisionChecks, [
            approval.resource,
            guard.targetResource,
            guard.manifestResource,
            guard.requesterRelationResource,
            guard.requesterEmployeeResource,
            approval.approverEmployeeResource,
            ...rootResources,
            ...handlerResources
          ]) ||
          !keyedRevisionMatchesValues(
            approval.revisionChecks,
            guard.targetResource,
            guard.expectedPlanRevision,
            guard.currentPlanRevision
          ) ||
          !keyedRevisionsAgree(
            approval.revisionChecks,
            guard.manifestRevisionChecks,
            guard.manifestResource
          ) ||
          !keyedRevisionsAgree(
            approval.revisionChecks,
            guard.requesterRevisionChecks,
            guard.requesterRelationResource
          ) ||
          !keyedRevisionsAgree(
            approval.revisionChecks,
            guard.requesterRevisionChecks,
            guard.requesterEmployeeResource
          ) ||
          rootResources.some(
            (resource) =>
              !keyedRevisionsAgree(
                approval.revisionChecks,
                guard.manifestRevisionChecks,
                resource
              )
          ) ||
          handlerResources.some(
            (resource) =>
              !keyedRevisionsAgree(
                approval.revisionChecks,
                guard.manifestRevisionChecks,
                resource
              )
          ) ||
          !approverGrant.matched ||
          (approverGrant.matched &&
            approverGrant.boundary !== null &&
            isStrictlyAfter(approval.notAfter, approverGrant.boundary)))
      ) {
        return guardDeny("revision_guard_failed", "privacy.approval_required");
      }

      for (const handler of guard.handlers) {
        if (handler.surfaceKind !== "external_route") {
          if (
            handler.externalProvider !== null ||
            handler.externalOutcome !== null ||
            (guard.phase === "execute"
              ? handler.executionMode !== "operated_io"
              : handler.executionMode !== "none")
          ) {
            return guardDeny("hard_boundary_denied", "permission.denied");
          }
          continue;
        }

        if (guard.phase !== "execute") {
          if (
            handler.externalProvider !== null ||
            handler.executionMode !== "none" ||
            handler.externalOutcome !== "not_started"
          ) {
            return guardDeny("hard_boundary_denied", "permission.denied");
          }
          continue;
        }

        const provider = handler.externalProvider;
        const root = guard.roots.find((candidate) =>
          sameEntityKey(candidate.resource, handler.rootResource)
        );
        if (provider === null) {
          return guardDeny("hard_boundary_denied", "permission.denied");
        }
        externalSourceUseRequirementIds.push(
          provider.sourceAccountUseRequirementId
        );
        if (
          root === undefined ||
          provider.sourceAccountUseRequirementId.trim().length === 0 ||
          provider.sourceAccountResource.entityTypeId !==
            "core:source-account" ||
          provider.sourceAccountResource.tenantId !== tenantId ||
          provider.bindingResource.entityTypeId !==
            "core:source-thread-binding" ||
          provider.bindingResource.tenantId !== tenantId ||
          !sameEntityKey(provider.bindingRootResource, handler.rootResource) ||
          !sameEntityKey(
            provider.bindingSourceAccountResource,
            provider.sourceAccountResource
          ) ||
          provider.capabilityId !== "core:capability.message.delete" ||
          provider.capabilityManifestResource.entityTypeId !==
            "core:provider-capability-manifest" ||
          provider.capabilityManifestResource.tenantId !== tenantId ||
          !sameEntityKey(
            provider.capabilityManifestSourceAccountResource,
            provider.sourceAccountResource
          ) ||
          !sameEntityKey(
            provider.capabilityManifestBindingResource,
            provider.bindingResource
          ) ||
          !sameEntityKey(
            provider.capabilityManifestHandlerResource,
            handler.resource
          ) ||
          !isTimestamp(provider.capabilityNotAfter) ||
          !isStrictlyAfter(
            provider.capabilityNotAfter,
            context.input.evaluatedAt
          )
        ) {
          return guardDeny("hard_boundary_denied", "permission.denied");
        }
        if (
          !exactKeyedRevisionSetIsCurrent(provider.bindingRevisionChecks, [
            provider.bindingResource,
            handler.rootResource,
            provider.sourceAccountResource
          ]) ||
          !exactKeyedRevisionSetIsCurrent(provider.capabilityRevisionChecks, [
            provider.capabilityManifestResource,
            provider.sourceAccountResource,
            provider.bindingResource,
            handler.resource
          ]) ||
          !keyedRevisionsAgree(
            provider.bindingRevisionChecks,
            root.revisionChecks,
            handler.rootResource
          ) ||
          !keyedRevisionsAgree(
            provider.bindingRevisionChecks,
            provider.capabilityRevisionChecks,
            provider.bindingResource
          ) ||
          !keyedRevisionsAgree(
            provider.bindingRevisionChecks,
            provider.capabilityRevisionChecks,
            provider.sourceAccountResource
          ) ||
          !keyedRevisionsAgree(
            handler.revisionChecks,
            provider.capabilityRevisionChecks,
            handler.resource
          ) ||
          provider.capabilityState === "expired"
        ) {
          return guardDeny("revision_guard_failed", "privacy.revision_changed");
        }

        const externalExecutionIsValid =
          provider.capabilityState === "supported"
            ? handler.executionMode === "provider_io" &&
              handler.externalOutcome === "requested"
            : handler.executionMode === "external_residual_only" &&
              handler.externalOutcome === "unsupported";
        if (!externalExecutionIsValid) {
          return guardDeny("hard_boundary_denied", "permission.denied");
        }
      }

      const handlerIoRequested = guard.handlers.some(
        (handler) =>
          handler.executionMode === "operated_io" ||
          handler.executionMode === "provider_io"
      );
      if (
        guard.ioRequested !== handlerIoRequested ||
        (guard.phase !== "execute" && guard.ioRequested)
      ) {
        return guardDeny("hard_boundary_denied", "permission.denied");
      }
      if (
        (guard.phase === "approve" &&
          (guard.approverEmployeeId === null ||
            guard.actingEmployeeId !== guard.approverEmployeeId ||
            guard.approverEmployeeId === guard.requesterEmployeeId)) ||
        (guard.phase === "execute" &&
          (guard.executorEmployeeId === null ||
            guard.approverEmployeeId === null ||
            guard.actingEmployeeId !== guard.executorEmployeeId ||
            guard.executorEmployeeId === guard.requesterEmployeeId ||
            guard.executorEmployeeId === guard.approverEmployeeId ||
            approval === null ||
            guard.approverEmployeeId !== approval.approverEmployeeId))
      ) {
        return guardDeny(
          "separation_of_duties_denied",
          "privacy.separation_of_duties"
        );
      }
      if (
        guard.phase === "execute" &&
        !isAtOrAfter(context.input.evaluatedAt, guard.coolingPeriodEndsAt)
      ) {
        return guardDeny(
          "temporal_boundary_reached",
          "privacy.cooling_period_active"
        );
      }
      if (guard.holdState === "ambiguous") {
        return guardDeny("revision_guard_failed", "privacy.scope_ambiguous");
      }
      if (guard.phase === "execute" && guard.holdState === "active") {
        return guardDeny("hard_boundary_denied", "privacy.hold_active");
      }
      if (
        guard.phase === "preview" &&
        guard.actingEmployeeId !== guard.requesterEmployeeId
      ) {
        return guardDeny(
          "separation_of_duties_denied",
          "privacy.separation_of_duties"
        );
      }
      return guardAllow(
        [
          ...new Set(externalSourceUseRequirementIds),
          ...(guard.phase === "execute" && approval !== null
            ? [approval.approverDirectoryRequirementId]
            : [])
        ],
        earliestTimestamp([
          guard.holdFenceNotAfter,
          ...guard.handlers.flatMap((handler) =>
            handler.surfaceKind === "external_route" &&
            handler.externalProvider !== null
              ? [handler.externalProvider.capabilityNotAfter]
              : []
          ),
          ...(guard.phase === "execute" && approval !== null
            ? [
                approval.notAfter,
                ...(approverGrant.matched ? [approverGrant.boundary] : [])
              ]
            : [])
        ])
      );
    }
    case "core:rbac.guard.privacy_audit_facets": {
      const expectedAccessLevel =
        permissionId === "core:audit.privacy.view"
          ? "view"
          : permissionId === "core:audit.privacy.export"
            ? "export"
            : null;
      const expectedAuditAction =
        expectedAccessLevel === "view"
          ? "privacy_audit_view"
          : expectedAccessLevel === "export"
            ? "privacy_audit_export"
            : null;
      const piiAuthority = guard.piiAuthorityEvidence;
      if (
        actorEmployeeId === null ||
        guard.actingEmployeeId !== actorEmployeeId ||
        expectedAccessLevel === null ||
        expectedAuditAction === null ||
        guard.accessLevel !== expectedAccessLevel ||
        guard.auditEventAction !== expectedAuditAction ||
        guard.actorFacet === null ||
        guard.targetFacet === null ||
        guard.scopeFacet === null ||
        guard.auditAccessEventId === null ||
        guard.auditAccessEventId.trim().length === 0 ||
        guard.auditAccessEventResource.entityTypeId !== "core:audit-event" ||
        guard.auditAccessEventResource.tenantId !==
          guard.targetResource.tenantId ||
        guard.auditEventActorEmployeeResource.entityTypeId !==
          "core:employee" ||
        guard.auditEventActorEmployeeResource.tenantId !==
          guard.targetResource.tenantId ||
        !entityKeyMatchesOpaqueId(
          guard.auditEventActorEmployeeResource,
          String(actorEmployeeId)
        ) ||
        !entityKeyMatchesOpaqueId(
          guard.auditAccessEventResource,
          guard.auditAccessEventId
        ) ||
        !sameEntityKey(guard.auditEventTargetResource, guard.targetResource) ||
        !exactKeyedRevisionSetIsCurrent(guard.auditEventRevisionChecks, [
          guard.auditAccessEventResource,
          guard.targetResource,
          guard.auditEventActorEmployeeResource
        ]) ||
        !guard.scopeAppliedBeforeCountAndPagination ||
        guard.facetRequirementIds.length === 0 ||
        guard.facetResources.length !== guard.facetRequirementIds.length ||
        new Set(guard.facetRequirementIds).size !==
          guard.facetRequirementIds.length ||
        new Set(guard.facetResources.map(entityKeyString)).size !==
          guard.facetResources.length ||
        !authorizationManifestIsCurrent(
          guard.manifestResource,
          guard.manifestTargetResource,
          guard.targetResource,
          guard.manifestRevisionChecks
        ) ||
        (guard.piiRequested
          ? guard.piiRequirementId === null || piiAuthority === null
          : guard.piiRequirementId !== null || piiAuthority !== null) ||
        (piiAuthority !== null &&
          (piiAuthority.bindingResource.entityTypeId !==
            "core:privacy-audit-pii-authority-binding" ||
            piiAuthority.reportQueryResource.entityTypeId !==
              "core:report-query" ||
            piiAuthority.auditManifestResource.entityTypeId !==
              "core:authorization-manifest" ||
            piiAuthority.reportManifestResource.entityTypeId !==
              "core:authorization-manifest" ||
            [
              piiAuthority.bindingResource,
              piiAuthority.auditQueryResource,
              piiAuthority.auditManifestResource,
              piiAuthority.reportQueryResource,
              piiAuthority.reportManifestResource,
              ...piiAuthority.facetResources
            ].some(
              (resource) => resource.tenantId !== guard.targetResource.tenantId
            ) ||
            !sameEntityKey(
              piiAuthority.auditQueryResource,
              guard.targetResource
            ) ||
            !sameEntityKey(
              piiAuthority.auditManifestResource,
              guard.manifestResource
            ) ||
            !exactEntityKeySetMatches(
              piiAuthority.facetResources,
              guard.facetResources
            ) ||
            !exactKeyedRevisionSetIsCurrent(
              piiAuthority.revisionChecks,
              uniqueEntityResources([
                piiAuthority.bindingResource,
                guard.targetResource,
                guard.manifestResource,
                piiAuthority.reportQueryResource,
                piiAuthority.reportManifestResource,
                ...guard.facetResources
              ])
            ) ||
            !keyedRevisionMatchesPolicyRevision(
              piiAuthority.revisionChecks,
              guard.manifestResource,
              guard.manifestRevisionChecks,
              "manifest"
            ) ||
            !keyedRevisionsAgree(
              piiAuthority.revisionChecks,
              guard.auditEventRevisionChecks,
              guard.targetResource
            )))
      ) {
        return guardDeny("hard_boundary_denied", "report.scope_forbidden");
      }
      return guardAllow([
        ...guard.facetRequirementIds,
        ...(guard.piiRequirementId === null ? [] : [guard.piiRequirementId])
      ]);
    }
  }
}

function evaluateCanonicalAction(
  permissionId: InboxV2PermissionId,
  action: InboxV2CanonicalActionEvidence,
  context: EvaluationContext
): GuardResult {
  const actorEmployeeId = context.employeeId;
  if (permissionId === "core:inbox.read") {
    if (
      action.kind !== "inbox_entry_read" ||
      !sameEntityKey(action.topologyTargetResource, action.targetResource) ||
      action.topologyResource.tenantId !== action.targetResource.tenantId ||
      !identityRevisionSetIsCurrent(action.topologyRevisionChecks, "state") ||
      (action.entryBoundary === "query"
        ? action.targetResource.entityTypeId !== "core:inbox-query" ||
          action.topologyResource.entityTypeId !==
            "core:inbox-query-topology" ||
          action.topologyConversationKind !== null ||
          action.internalReadRequirementId !== null
        : action.entryBoundary === "external_metadata"
          ? action.targetResource.entityTypeId !== "core:conversation" ||
            action.topologyResource.entityTypeId !==
              "core:conversation-topology" ||
            action.topologyConversationKind !== "external_work" ||
            action.internalReadRequirementId !== null
          : action.targetResource.entityTypeId !== "core:conversation" ||
            action.topologyResource.entityTypeId !==
              "core:conversation-topology" ||
            action.topologyConversationKind !== "internal" ||
            action.internalReadRequirementId === null)
    ) {
      return guardDeny("hard_boundary_denied", "permission.denied");
    }
    return guardAllow(
      action.internalReadRequirementId === null
        ? []
        : [action.internalReadRequirementId]
    );
  }
  if (permissionId === "core:conversation.read") {
    return action.kind === "conversation_content_read" &&
      action.conversationKind === "external_work" &&
      action.contentBoundary === "external" &&
      action.targetResource.entityTypeId === "core:conversation" &&
      action.topologyResource.entityTypeId === "core:conversation-topology" &&
      action.topologyResource.tenantId === action.targetResource.tenantId &&
      sameEntityKey(
        action.topologyConversationResource,
        action.targetResource
      ) &&
      action.topologyConversationKind === action.conversationKind &&
      identityRevisionSetIsCurrent(action.topologyRevisionChecks, "state")
      ? guardAllow([])
      : guardDeny("hard_boundary_denied", "permission.denied");
  }
  if (permissionId === "core:tenant.manage") {
    return action.kind === "tenant_settings_change" &&
      action.targetResource.entityTypeId === "core:tenant" &&
      exactKeyedRevisionSetIsCurrent(action.targetRevisionChecks, [
        action.targetResource
      ]) &&
      action.reason.trim().length > 0 &&
      privilegedMutationAuditIsCurrent(
        action.audit,
        "tenant_settings_change",
        action.targetResource,
        actorEmployeeId,
        context.input.tenantId
      ) &&
      keyedRevisionsAgree(
        action.audit.revisionChecks,
        action.targetRevisionChecks,
        action.targetResource
      )
      ? guardAllow([])
      : guardDeny("revision_guard_failed", "revision.conflict");
  }
  if (
    permissionId === "core:employee.invite" ||
    permissionId === "core:employee.profile.manage" ||
    permissionId === "core:employee.deactivate"
  ) {
    const expectedOperation =
      permissionId === "core:employee.invite"
        ? "invite"
        : permissionId === "core:employee.profile.manage"
          ? "profile_update"
          : "deactivate";
    const validTarget =
      action.kind === "employee_record_change" &&
      (expectedOperation === "invite"
        ? action.targetResource.entityTypeId === "core:employee-invitation" &&
          action.targetEmployeeResource === null &&
          action.lifecycleBefore === null &&
          action.lifecycleAfter === "pending"
        : action.targetResource.entityTypeId === "core:employee" &&
          action.targetEmployeeResource !== null &&
          sameEntityKey(action.targetEmployeeResource, action.targetResource));
    const deactivationWorkflowValid =
      action.kind === "employee_record_change" &&
      expectedOperation === "deactivate"
        ? employeeDeactivationWorkflowIsCurrent(
            action.deactivationWorkflow,
            action.targetResource,
            action.lifecycleBefore,
            action.lifecycleAfter,
            context.input.tenantId
          )
        : action.kind === "employee_record_change" &&
          action.deactivationWorkflow === null;
    const expectedAuditAction =
      expectedOperation === "invite"
        ? "employee_invite"
        : expectedOperation === "profile_update"
          ? "employee_profile_update"
          : "employee_deactivate";
    return action.kind === "employee_record_change" &&
      action.operation === expectedOperation &&
      validTarget &&
      deactivationWorkflowValid &&
      exactKeyedRevisionSetIsCurrent(action.targetRevisionChecks, [
        action.targetResource
      ]) &&
      action.reason.trim().length > 0 &&
      privilegedMutationAuditIsCurrent(
        action.audit,
        expectedAuditAction,
        action.targetResource,
        actorEmployeeId,
        context.input.tenantId
      ) &&
      keyedRevisionsAgree(
        action.audit.revisionChecks,
        action.targetRevisionChecks,
        action.targetResource
      )
      ? guardAllow([])
      : guardDeny("revision_guard_failed", "revision.conflict");
  }
  if (permissionId === "core:roles.define") {
    return action.kind === "role_definition_change" &&
      action.targetResource.entityTypeId === "core:role" &&
      action.permissionSetIds.length > 0 &&
      new Set(action.permissionSetIds).size ===
        action.permissionSetIds.length &&
      exactKeyedRevisionSetIsCurrent(action.targetRevisionChecks, [
        action.targetResource
      ]) &&
      action.reason.trim().length > 0 &&
      privilegedMutationAuditIsCurrent(
        action.audit,
        "role_definition_change",
        action.targetResource,
        actorEmployeeId,
        context.input.tenantId
      ) &&
      keyedRevisionsAgree(
        action.audit.revisionChecks,
        action.targetRevisionChecks,
        action.targetResource
      )
      ? guardAllow([])
      : guardDeny("revision_guard_failed", "revision.conflict");
  }
  if (
    permissionId === "core:org_unit.manage" ||
    permissionId === "core:team.manage" ||
    permissionId === "core:queue.manage"
  ) {
    const expectedKind =
      permissionId === "core:org_unit.manage"
        ? "org_unit"
        : permissionId === "core:team.manage"
          ? "team"
          : "queue";
    const expectedEntityType =
      expectedKind === "org_unit"
        ? "core:org-unit"
        : expectedKind === "team"
          ? "core:team"
          : "core:work-queue";
    return action.kind === "organization_graph_change" &&
      action.resourceKind === expectedKind &&
      action.targetResource.entityTypeId === expectedEntityType &&
      action.graphResource.entityTypeId === "core:organization-graph" &&
      action.graphResource.tenantId === action.targetResource.tenantId &&
      sameEntityKey(action.graphTargetResource, action.targetResource) &&
      ((action.parentResource === null &&
        action.graphParentResource === null) ||
        (action.parentResource !== null &&
          action.graphParentResource !== null &&
          sameEntityKey(action.parentResource, action.graphParentResource) &&
          action.parentResource.tenantId === action.targetResource.tenantId)) &&
      exactKeyedRevisionSetIsCurrent(
        action.graphRevisionChecks,
        uniqueEntityResources([
          action.targetResource,
          action.graphResource,
          ...(action.parentResource === null ? [] : [action.parentResource])
        ])
      ) &&
      !action.createsCycle &&
      action.reason.trim().length > 0 &&
      privilegedMutationAuditIsCurrent(
        action.audit,
        "organization_graph_change",
        action.targetResource,
        actorEmployeeId,
        context.input.tenantId
      ) &&
      keyedRevisionsAgree(
        action.audit.revisionChecks,
        action.graphRevisionChecks,
        action.targetResource
      )
      ? guardAllow([])
      : guardDeny("revision_guard_failed", "revision.conflict");
  }
  if (permissionId === "core:source_item.open_external") {
    if (
      action.kind !== "source_item_open_external" ||
      action.targetResource.entityTypeId !== "core:source-item" ||
      action.descriptorResource.entityTypeId !==
        "core:source-action-descriptor" ||
      action.sourceAccountResource.entityTypeId !== "core:source-account" ||
      !sameEntityKey(action.targetResource, action.descriptorTargetResource) ||
      !sameEntityKey(
        action.sourceAccountResource,
        action.descriptorSourceAccountResource
      ) ||
      action.targetResource.tenantId !== action.descriptorResource.tenantId ||
      action.targetResource.tenantId !==
        action.sourceAccountResource.tenantId ||
      action.descriptorState !== "approved" ||
      action.descriptorRevisionChecks.length === 0 ||
      action.descriptorRevisionChecks.some(
        (check) => check.expected !== check.actual
      ) ||
      !(["binding", "state"] as const).every((kind) =>
        action.descriptorRevisionChecks.some((check) => check.kind === kind)
      ) ||
      !isTimestamp(action.notAfter) ||
      !isStrictlyAfter(action.notAfter, context.input.evaluatedAt)
    ) {
      return guardDeny("hard_boundary_denied", "permission.denied");
    }
    return guardAllow([], action.notAfter);
  }
  if (
    permissionId === "core:roles.bind" ||
    permissionId === "core:direct_grants.manage"
  ) {
    if (
      action.kind !== "delegation_change" ||
      actorEmployeeId === null ||
      action.actorEmployeeId !== actorEmployeeId ||
      action.subjectEmployeeId === actorEmployeeId ||
      action.subjectEmployeeResource.entityTypeId !== "core:employee" ||
      String(action.subjectEmployeeResource.entityId) !==
        String(action.subjectEmployeeId) ||
      action.subjectEmployeeResource.tenantId !==
        action.targetResource.tenantId ||
      (permissionId === "core:roles.bind"
        ? action.operation !== "role_bind"
        : action.operation !== "direct_grant") ||
      action.delegatedAuthorities.length === 0 ||
      (action.operation === "direct_grant" &&
        action.delegatedAuthorities.length !== 1) ||
      !permissionScopeTargetsResource(
        action.bindingScope,
        action.bindingScopeResource
      ) ||
      action.bindingRelationResource.entityTypeId !==
        "core:delegation-effect" ||
      action.bindingRelationResource.tenantId !== context.input.tenantId ||
      !sameEntityKey(action.relationBindingResource, action.targetResource) ||
      !sameEntityKey(
        action.relationSubjectEmployeeResource,
        action.subjectEmployeeResource
      ) ||
      !sameEntityKey(
        action.relationScopeResource,
        action.bindingScopeResource
      ) ||
      !exactKeyedRevisionSetIsCurrent(
        action.bindingRevisionChecks,
        uniqueEntityResources([
          action.targetResource,
          action.bindingRelationResource,
          action.subjectEmployeeResource,
          action.bindingScopeResource
        ])
      ) ||
      action.delegatedAuthorities.some(
        ({ requestedScope }) =>
          !scopeContains(action.bindingScope, requestedScope) ||
          !scopeContains(requestedScope, action.bindingScope)
      ) ||
      action.reason.trim().length === 0 ||
      action.validUntil === null ||
      !isTimestamp(action.validUntil) ||
      !isStrictlyAfter(action.validUntil, context.input.evaluatedAt) ||
      (action.operation === "direct_grant" &&
        action.delegatedAuthorities.some(
          ({ permissionId }) =>
            permissionId === "core:conversation.internal.break_glass_read"
        )) ||
      (action.operation === "role_bind"
        ? action.roleDefinition === null ||
          action.roleDefinition.resource.entityTypeId !== "core:role" ||
          action.roleDefinition.resource.tenantId !== context.input.tenantId ||
          !sameEntityKey(
            action.roleDefinition.bindingResource,
            action.targetResource
          ) ||
          !sameEntityKey(
            action.roleDefinition.bindingRoleResource,
            action.roleDefinition.resource
          ) ||
          action.roleDefinition.permissionSetIds.length !==
            action.delegatedAuthorities.length ||
          new Set(action.roleDefinition.permissionSetIds).size !==
            action.roleDefinition.permissionSetIds.length ||
          !action.roleDefinition.permissionSetIds.every((permissionId) =>
            action.delegatedAuthorities.some(
              (authority) => authority.permissionId === permissionId
            )
          ) ||
          !identityRevisionSetIsCurrent(
            action.roleDefinition.revisionChecks,
            "manifest"
          )
        : action.roleDefinition !== null) ||
      !privilegedMutationAuditIsCurrent(
        action.audit,
        action.operation,
        action.targetResource,
        actorEmployeeId,
        context.input.tenantId
      ) ||
      !keyedRevisionsAgree(
        action.audit.revisionChecks,
        action.bindingRevisionChecks,
        action.targetResource
      )
    ) {
      return guardDeny("separation_of_duties_denied", "permission.denied");
    }
    return guardAllow(
      [
        action.subjectDirectoryRequirementId,
        ...action.delegatedAuthorities.map(({ requirementId }) => requirementId)
      ],
      action.validUntil
    );
  }
  if (
    permissionId === "core:conversation.access_binding.manage" ||
    permissionId === "core:conversation.access_binding.apply_policy"
  ) {
    const oldScopeGrant =
      action.kind === "conversation_access_change"
        ? matchActivePrincipalGrantForScope(
            context,
            permissionId,
            action.oldTargetScope
          )
        : Object.freeze({ matched: false as const });
    const newScopeGrant =
      action.kind === "conversation_access_change"
        ? matchActivePrincipalGrantForScope(
            context,
            permissionId,
            action.newTargetScope
          )
        : Object.freeze({ matched: false as const });
    if (
      action.kind !== "conversation_access_change" ||
      (permissionId === "core:conversation.access_binding.manage"
        ? action.operation !== "manage"
        : action.operation !== "apply_policy") ||
      action.bindingResource.entityTypeId !==
        "core:conversation-access-binding" ||
      action.bindingResource.tenantId !== action.targetResource.tenantId ||
      !sameEntityKey(
        action.bindingConversationResource,
        action.targetResource
      ) ||
      action.reason.trim().length === 0 ||
      !exactKeyedRevisionSetIsCurrent(action.bindingRevisionChecks, [
        action.bindingResource,
        action.bindingConversationResource
      ]) ||
      !exactKeyedRevisionSetIsCurrent(
        action.targetRevisionChecks,
        uniqueEntityResources([
          action.bindingResource,
          action.bindingConversationResource,
          action.oldTargetResource,
          action.newTargetResource
        ])
      ) ||
      !keyedRevisionsAgree(
        action.bindingRevisionChecks,
        action.targetRevisionChecks,
        action.bindingResource
      ) ||
      !keyedRevisionsAgree(
        action.bindingRevisionChecks,
        action.targetRevisionChecks,
        action.bindingConversationResource
      ) ||
      !permissionScopeTargetsResource(
        action.oldTargetScope,
        action.oldTargetResource
      ) ||
      !permissionScopeTargetsResource(
        action.newTargetScope,
        action.newTargetResource
      ) ||
      !oldScopeGrant.matched ||
      !newScopeGrant.matched ||
      (action.operation === "manage"
        ? action.policyResource !== null ||
          action.policyRevisionChecks.length !== 0
        : action.policyResource === null ||
          action.policyResource.entityTypeId !== "core:routing-policy" ||
          action.policyResource.tenantId !== action.targetResource.tenantId ||
          action.policyRevisionChecks.length === 0 ||
          action.policyRevisionChecks.some(
            (check) => check.expected !== check.actual
          ))
    ) {
      return guardDeny("revision_guard_failed", "revision.conflict");
    }
    return guardAllow([], oldScopeGrant.boundary, newScopeGrant.boundary);
  }
  if (permissionId === "core:conversation.internal.create") {
    if (
      action.kind !== "internal_conversation_create" ||
      actorEmployeeId === null ||
      action.creatorEmployeeId !== actorEmployeeId ||
      action.targetResource.entityTypeId !== "core:conversation" ||
      (action.conversationKind === "internal_direct"
        ? action.members.length !== 2
        : action.members.length < 3) ||
      new Set(action.members.map(({ employeeId }) => employeeId)).size !==
        action.members.length ||
      !action.members.some(
        ({ employeeId, role }) =>
          employeeId === actorEmployeeId && role === "owner"
      ) ||
      !action.members.some(({ role }) => role === "owner") ||
      action.members.some(
        ({ employeeId, employeeResource, lifecycle }) =>
          lifecycle !== "active" ||
          employeeResource.entityTypeId !== "core:employee" ||
          String(employeeResource.entityId) !== String(employeeId) ||
          employeeResource.tenantId !== action.targetResource.tenantId
      ) ||
      action.topologyResource.entityTypeId !==
        "core:internal-conversation-topology" ||
      action.topologyResource.tenantId !== action.targetResource.tenantId ||
      !sameEntityKey(
        action.topologyConversationResource,
        action.targetResource
      ) ||
      action.topologyKind !== action.conversationKind ||
      action.policyResource.entityTypeId !==
        "core:internal-conversation-policy" ||
      action.policyResource.tenantId !== action.targetResource.tenantId ||
      !sameEntityKey(action.policyTopologyResource, action.topologyResource) ||
      !identityRevisionSetIsCurrent(action.policyRevisionChecks, "policy")
    ) {
      return guardDeny("hard_boundary_denied", "permission.denied");
    }
    return guardAllow(
      action.members.map(({ directoryRequirementId }) => directoryRequirementId)
    );
  }
  if (permissionId === "core:conversation.collaborators.manage") {
    if (action.kind !== "conversation_collaborator_change") {
      return guardDeny("hard_boundary_denied", "permission.denied");
    }
    const targetGrantMatches = action.intendedCollaboratorPermissionIds.map(
      (intendedPermissionId, index) =>
        matchActiveEmployeeGrantForScope(
          context.input,
          action.targetGrantIds[index] ?? "",
          action.targetEmployeeId,
          intendedPermissionId,
          { type: "collaborator", tenantId: context.input.tenantId },
          "collaborator"
        )
    );
    if (
      action.targetLifecycle !== "active" ||
      action.targetEmployeeResource.entityTypeId !== "core:employee" ||
      String(action.targetEmployeeResource.entityId) !==
        String(action.targetEmployeeId) ||
      action.targetEmployeeResource.tenantId !==
        action.targetResource.tenantId ||
      action.expectedRelationRevision !== action.currentRelationRevision ||
      action.reason.trim().length === 0 ||
      action.intendedCollaboratorPermissionIds.length === 0 ||
      action.intendedCollaboratorPermissionIds.length !==
        action.targetGrantIds.length ||
      new Set(action.intendedCollaboratorPermissionIds).size !==
        action.intendedCollaboratorPermissionIds.length ||
      new Set(action.targetGrantIds).size !== action.targetGrantIds.length ||
      targetGrantMatches.some((match) => !match.matched)
    ) {
      return guardDeny("revision_guard_failed", "revision.conflict");
    }
    return guardAllow(
      [action.targetDirectoryRequirementId],
      ...targetGrantMatches.flatMap((match) =>
        match.matched ? [match.boundary] : []
      )
    );
  }
  if (
    permissionId === "core:notification.preferences.manage_self" ||
    permissionId === "core:notification.endpoints.manage_self"
  ) {
    return action.kind === "notification_self_settings" &&
      actorEmployeeId !== null &&
      action.employeeId === actorEmployeeId &&
      action.endpointOwnerEmployeeId === actorEmployeeId &&
      action.employeeResource.entityTypeId === "core:employee" &&
      String(action.employeeResource.entityId) === String(actorEmployeeId) &&
      sameEntityKey(
        action.ownershipEmployeeResource,
        action.employeeResource
      ) &&
      action.ownershipRevisionChecks.length > 0 &&
      action.ownershipRevisionChecks.every(
        (check) => check.expected === check.actual
      ) &&
      action.ownershipRevisionChecks.some(
        (check) => check.kind === "relation"
      ) &&
      (permissionId === "core:notification.preferences.manage_self"
        ? action.ownershipEndpointResource === null &&
          sameEntityKey(action.targetResource, action.employeeResource)
        : action.ownershipEndpointResource !== null &&
          sameEntityKey(
            action.ownershipEndpointResource,
            action.targetResource
          ) &&
          action.targetResource.entityTypeId === "core:notification-endpoint" &&
          action.targetResource.tenantId === action.employeeResource.tenantId)
      ? guardAllow([])
      : guardDeny("hard_boundary_denied", "permission.denied");
  }
  if (
    permissionId === "core:message.edit_own" ||
    permissionId === "core:message.delete_own"
  ) {
    const expectedOperation =
      permissionId === "core:message.edit_own" ? "edit" : "delete";
    const expectedCapabilityId =
      expectedOperation === "edit"
        ? "core:capability.message.edit"
        : "core:capability.message.delete";
    if (
      action.kind !== "message_author_action" ||
      action.operation !== expectedOperation
    ) {
      return guardDeny("hard_boundary_denied", "permission.denied");
    }
    const requiresProviderMutation =
      action.contentBoundary === "external" &&
      (action.operation === "edit" ||
        action.deletionMode === "provider_delete");
    if (
      actorEmployeeId === null ||
      action.actorEmployeeId !== actorEmployeeId ||
      action.authorEmployeeId !== actorEmployeeId ||
      action.authorshipResource.entityTypeId !== "core:message-authorship" ||
      action.authorshipResource.tenantId !== action.targetResource.tenantId ||
      !sameEntityKey(
        action.authorshipTimelineItemResource,
        action.targetResource
      ) ||
      action.authorshipEmployeeResource.entityTypeId !== "core:employee" ||
      !entityKeyMatchesOpaqueId(
        action.authorshipEmployeeResource,
        String(action.authorEmployeeId)
      ) ||
      action.authorshipEmployeeResource.tenantId !==
        action.targetResource.tenantId ||
      !identityRevisionSetIsCurrent(
        action.authorshipRevisionChecks,
        "relation"
      ) ||
      !timelineContentTopologyIsCurrent(
        action.targetResource,
        action.contentBoundary,
        action.contentTopologyResource,
        action.topologyTimelineItemResource,
        action.topologyConversationResource,
        action.topologyBoundary,
        action.targetRevisionChecks,
        action.topologyRevisionChecks
      ) ||
      (expectedOperation === "delete"
        ? !messageDeletionHoldIsClear(
            action.targetResource,
            action.deletionMode,
            action.holdProof
          ) ||
          (action.contentBoundary !== "external" &&
            action.deletionMode !== "local_tombstone")
        : action.deletionMode !== null || action.holdProof !== null) ||
      (requiresProviderMutation
        ? action.originalRouteRequirementId === null ||
          action.capabilityId !== expectedCapabilityId ||
          !canonicalCapabilityManifestIsCurrent(action) ||
          action.capabilityState !== "supported" ||
          !canonicalRouteEvidenceIsValid(action)
        : !canonicalProviderMutationEvidenceIsAbsent(action))
    ) {
      return guardDeny("hard_boundary_denied", "permission.denied");
    }
    return guardAllow(
      [
        ...action.contentReadRequirementIds,
        ...(action.originalRouteRequirementId === null
          ? []
          : [action.originalRouteRequirementId])
      ],
      action.capabilityNotAfter
    );
  }
  if (permissionId === "core:message.react") {
    if (
      action.kind !== "message_reaction" ||
      !canonicalContentRelationIsCurrent(
        action.targetResource,
        action.contentReadResource,
        action.contentRelationTargetResource,
        action.contentRelationReadResource,
        action.contentRelationRevisionChecks
      ) ||
      !timelineContentTopologyIsCurrent(
        action.targetResource,
        action.contentBoundary,
        action.contentTopologyResource,
        action.topologyTimelineItemResource,
        action.topologyConversationResource,
        action.topologyBoundary,
        action.targetRevisionChecks,
        action.topologyRevisionChecks
      ) ||
      (action.contentBoundary === "external"
        ? action.capabilityId !== "core:capability.message.react" ||
          !canonicalCapabilityManifestIsCurrent(action) ||
          action.capabilityState !== "supported" ||
          action.originalRouteRequirementId === null ||
          !canonicalRouteEvidenceIsValid(action)
        : action.capabilityId !== null ||
          action.capabilityManifestResource !== null ||
          action.capabilityManifestSourceAccountResource !== null ||
          action.capabilityRevisionChecks.length > 0 ||
          action.capabilityState !== "not_applicable" ||
          action.capabilityNotAfter !== null ||
          action.originalRouteRequirementId !== null ||
          action.originalSourceAccountId !== null ||
          action.originalSourceAccountResource !== null ||
          action.originalBindingResource !== null ||
          action.originalBindingSourceAccountResource !== null ||
          action.externalReferenceResource !== null ||
          action.externalReferenceBindingResource !== null ||
          action.externalReferenceTargetResource !== null ||
          action.routeRevisionChecks.length > 0)
    ) {
      return guardDeny("route_guard_failed", "route.inactive");
    }
    return guardAllow(
      [
        action.contentReadRequirementId,
        ...(action.originalRouteRequirementId === null
          ? []
          : [action.originalRouteRequirementId])
      ],
      action.capabilityNotAfter
    );
  }
  if (permissionId === "core:message.moderate_external") {
    if (action.kind !== "external_moderation") {
      return guardDeny("route_guard_failed", "route.inactive");
    }
    const expectedCapabilityId =
      action.operation === "edit"
        ? "core:capability.message.edit"
        : "core:capability.message.delete";
    const requiresProviderMutation =
      action.operation === "edit" || action.deletionMode === "provider_delete";
    if (
      !canonicalContentRelationIsCurrent(
        action.targetResource,
        action.contentReadResource,
        action.contentRelationTargetResource,
        action.contentRelationReadResource,
        action.contentRelationRevisionChecks
      ) ||
      !timelineContentTopologyIsCurrent(
        action.targetResource,
        "external",
        action.contentTopologyResource,
        action.topologyTimelineItemResource,
        action.topologyConversationResource,
        action.topologyBoundary,
        action.targetRevisionChecks,
        action.topologyRevisionChecks
      ) ||
      (action.operation === "delete"
        ? (action.deletionMode !== "local_tombstone" &&
            action.deletionMode !== "provider_delete") ||
          !messageDeletionHoldIsClear(
            action.targetResource,
            action.deletionMode,
            action.holdProof
          )
        : action.deletionMode !== null || action.holdProof !== null) ||
      action.reason.trim().length === 0 ||
      action.auditEventId === null ||
      action.auditEventId.trim().length === 0 ||
      (requiresProviderMutation
        ? action.originalRouteRequirementId === null ||
          action.capabilityId !== expectedCapabilityId ||
          !canonicalCapabilityManifestIsCurrent(action) ||
          action.capabilityState !== "supported" ||
          (action.capabilityNotAfter !== null &&
            (!isTimestamp(action.capabilityNotAfter) ||
              !isStrictlyAfter(
                action.capabilityNotAfter,
                context.input.evaluatedAt
              ))) ||
          !canonicalRouteEvidenceIsValid(action)
        : !canonicalProviderMutationEvidenceIsAbsent(action))
    ) {
      return guardDeny("route_guard_failed", "route.inactive");
    }
    return guardAllow(
      [
        action.contentReadRequirementId,
        ...(action.originalRouteRequirementId === null
          ? []
          : [action.originalRouteRequirementId])
      ],
      action.capabilityNotAfter
    );
  }
  if (permissionId === "core:message.moderate_internal") {
    if (
      action.kind !== "internal_moderation" ||
      !canonicalContentRelationIsCurrent(
        action.targetResource,
        action.contentReadResource,
        action.contentRelationTargetResource,
        action.contentRelationReadResource,
        action.contentRelationRevisionChecks
      ) ||
      !sameEntityKey(
        action.contentReadResource,
        action.topologyConversationResource
      ) ||
      !timelineContentTopologyIsCurrent(
        action.targetResource,
        "internal",
        action.contentTopologyResource,
        action.topologyTimelineItemResource,
        action.topologyConversationResource,
        action.topologyBoundary,
        action.targetRevisionChecks,
        action.topologyRevisionChecks
      ) ||
      (action.operation === "delete"
        ? action.deletionMode !== "local_tombstone" ||
          !messageDeletionHoldIsClear(
            action.targetResource,
            action.deletionMode,
            action.holdProof
          )
        : action.deletionMode !== null || action.holdProof !== null) ||
      action.reason.trim().length === 0 ||
      action.auditEventId === null ||
      action.auditEventId.trim().length === 0
    ) {
      return guardDeny("hard_boundary_denied", "permission.denied");
    }
    return guardAllow([action.contentReadRequirementId]);
  }
  if (permissionId === "core:conversation.internal.owner_recover") {
    const approverGrant =
      action.kind === "internal_owner_recovery"
        ? matchActiveEmployeeGrantForScope(
            context.input,
            action.approverGrantId,
            action.approverEmployeeId,
            "core:conversation.internal.owner_recover",
            {
              type: "conversation",
              tenantId: context.input.tenantId,
              id: action.conversationId
            }
          )
        : Object.freeze({ matched: false as const });
    if (
      action.kind !== "internal_owner_recovery" ||
      actorEmployeeId === null ||
      action.actorEmployeeId !== actorEmployeeId ||
      action.targetResource.entityTypeId !== "core:conversation" ||
      !entityKeyMatchesOpaqueId(
        action.targetResource,
        String(action.conversationId)
      ) ||
      action.recoveryState !== "owner_recovery" ||
      action.successorEmployeeId === actorEmployeeId ||
      action.approverEmployeeId === actorEmployeeId ||
      action.approverEmployeeId === action.successorEmployeeId ||
      action.approverEmployeeResource.entityTypeId !== "core:employee" ||
      !entityKeyMatchesOpaqueId(
        action.approverEmployeeResource,
        String(action.approverEmployeeId)
      ) ||
      action.approverEmployeeResource.tenantId !== context.input.tenantId ||
      !approverGrant.matched ||
      action.approvalResource.entityTypeId !== "core:owner-recovery-approval" ||
      action.approvalResource.tenantId !== context.input.tenantId ||
      !sameEntityKey(
        action.approvalConversationResource,
        action.targetResource
      ) ||
      !sameEntityKey(
        action.approvalApproverEmployeeResource,
        action.approverEmployeeResource
      ) ||
      action.approvalSuccessorEmployeeResource.entityTypeId !==
        "core:employee" ||
      !entityKeyMatchesOpaqueId(
        action.approvalSuccessorEmployeeResource,
        String(action.successorEmployeeId)
      ) ||
      action.approvalState !== "approved" ||
      !exactKeyedRevisionSetIsCurrent(action.approvalRevisionChecks, [
        action.approvalResource,
        action.targetResource,
        action.approverEmployeeResource,
        action.approvalSuccessorEmployeeResource
      ]) ||
      !isTimestamp(action.approvalNotAfter) ||
      !isStrictlyAfter(action.approvalNotAfter, context.input.evaluatedAt) ||
      (approverGrant.matched &&
        approverGrant.boundary !== null &&
        isStrictlyAfter(action.approvalNotAfter, approverGrant.boundary)) ||
      action.successorMembership.employeeId !== action.successorEmployeeId ||
      !sameEntityKey(
        action.successorMembership.employeeResource,
        action.approvalSuccessorEmployeeResource
      ) ||
      action.successorMembership.lifecycle !== "active" ||
      action.successorMembership.newRole !== "owner" ||
      action.successorMembership.membershipRelationResource.entityTypeId !==
        "core:internal-membership" ||
      !sameEntityKey(
        action.successorMembership.relationConversationResource,
        action.targetResource
      ) ||
      !sameEntityKey(
        action.successorMembership.relationEmployeeResource,
        action.successorMembership.employeeResource
      ) ||
      action.ownerSet.resource.entityTypeId !==
        "core:internal-owner-set-manifest" ||
      action.ownerSet.resource.tenantId !== context.input.tenantId ||
      !sameEntityKey(
        action.ownerSet.conversationResource,
        action.targetResource
      ) ||
      action.ownerSet.beforeOwnerMembershipResources.length !== 0 ||
      action.ownerSet.afterOwnerMembershipResources.length !== 1 ||
      !sameEntityKey(
        action.ownerSet.afterOwnerMembershipResources[0]!,
        action.successorMembership.membershipRelationResource
      ) ||
      !exactKeyedRevisionSetIsCurrent(
        action.mutationRevisionChecks,
        uniqueEntityResources([
          action.targetResource,
          action.ownerSet.resource,
          action.successorMembership.employeeResource,
          action.successorMembership.membershipRelationResource
        ])
      ) ||
      action.reason.trim().length === 0 ||
      !privilegedMutationAuditIsCurrent(
        action.audit,
        "internal_owner_recovery",
        action.targetResource,
        actorEmployeeId,
        context.input.tenantId
      ) ||
      !keyedRevisionsAgree(
        action.audit.revisionChecks,
        action.mutationRevisionChecks,
        action.targetResource
      )
    ) {
      return guardDeny("revision_guard_failed", "revision.conflict");
    }
    return guardAllow(
      [
        action.successorMembershipRequirementId,
        action.approverDirectoryRequirementId
      ],
      action.approvalNotAfter,
      ...(approverGrant.matched ? [approverGrant.boundary] : [])
    );
  }
  if (permissionId === "core:reports.view") {
    return action.kind === "report_aggregate" &&
      isReportPrivacyEvidenceSafe(action.privacy)
      ? guardAllow([])
      : guardDeny("hard_boundary_denied", "report.scope_forbidden");
  }
  if (permissionId === "core:reports.workforce_dimension.view") {
    return action.kind === "report_workforce" &&
      isReportPrivacyEvidenceSafe(action.privacy)
      ? guardAllow([action.employeeDirectoryRequirementId])
      : guardDeny("hard_boundary_denied", "report.scope_forbidden");
  }
  if (permissionId === "core:reports.export") {
    return action.kind === "report_export" &&
      isReportPrivacyEvidenceSafe(action.privacy)
      ? guardAllow([action.reportsViewRequirementId])
      : guardDeny("hard_boundary_denied", "report.scope_forbidden");
  }
  if (
    permissionId === "core:participant.pii.view" ||
    permissionId === "core:call.recording.view" ||
    permissionId === "core:call.transcript.view"
  ) {
    return action.kind === "sensitive_content" &&
      canonicalContentRelationIsCurrent(
        action.targetResource,
        action.baseReadResource,
        action.baseReadRelationTargetResource,
        action.baseReadRelationResource,
        action.baseReadRelationRevisionChecks
      ) &&
      sensitiveContentPolicyIsCurrent(
        permissionId,
        action,
        context.input.evaluatedAt
      )
      ? guardAllow(
          [action.baseReadRequirementId],
          action.policyEvidence.kind === "participant_pii"
            ? action.policyEvidence.notAfter
            : action.policyEvidence.retentionNotAfter
        )
      : guardDeny("hard_boundary_denied", "permission.denied");
  }

  return action.kind === "canonical" &&
    canonicalPermissionMayUseBareAction(permissionId)
    ? guardAllow([])
    : guardDeny("hard_boundary_denied", "permission.denied");
}

function sensitiveContentPolicyIsCurrent(
  permissionId: InboxV2PermissionId,
  action: Extract<
    InboxV2CanonicalActionEvidence,
    { kind: "sensitive_content" }
  >,
  evaluatedAt: InboxV2PolicyTimestamp
): boolean {
  const evidence = action.policyEvidence;
  const expectedKind =
    permissionId === "core:participant.pii.view"
      ? "participant_pii"
      : permissionId === "core:call.recording.view"
        ? "call_recording"
        : permissionId === "core:call.transcript.view"
          ? "call_transcript"
          : null;
  if (
    expectedKind === null ||
    evidence.kind !== expectedKind ||
    action.purpose.trim().length === 0 ||
    !evidence.approvedPurposeIds.includes(action.purpose) ||
    evidence.policyResource.tenantId !== action.targetResource.tenantId ||
    evidence.policyTargetResource.tenantId !== action.targetResource.tenantId ||
    !sameEntityKey(evidence.policyTargetResource, action.targetResource) ||
    !identityRevisionSetIsCurrent(evidence.revisionChecks, "policy")
  ) {
    return false;
  }
  if (evidence.kind === "participant_pii") {
    return (
      evidence.policyResource.entityTypeId === "core:pii-access-policy" &&
      isTimestamp(evidence.notAfter) &&
      isStrictlyAfter(evidence.notAfter, evaluatedAt)
    );
  }
  return (
    sameEntityKey(evidence.contentResource, action.targetResource) &&
    evidence.policyResource.entityTypeId === "core:call-data-access-policy" &&
    evidence.availability === "available" &&
    evidence.processingState === "allowed" &&
    evidence.consentState !== "denied" &&
    isTimestamp(evidence.retentionNotAfter) &&
    isStrictlyAfter(evidence.retentionNotAfter, evaluatedAt)
  );
}

function isReportPrivacyEvidenceSafe(
  evidence: InboxV2ReportPrivacyEvidence
): boolean {
  return (
    evidence.requestedDimensionIds.length > 0 &&
    evidence.requestedDimensionIds.every((dimensionId) =>
      evidence.allowedDimensionIds.includes(dimensionId)
    ) &&
    evidence.minimumCellSize >= 5 &&
    evidence.primarySuppressionApplied &&
    evidence.complementarySuppressionApplied &&
    evidence.differencingBudgetRemaining > 0 &&
    !evidence.privateInternalIncluded &&
    !evidence.stablePersonIdentifiersIncluded
  );
}

function canonicalContentRelationIsCurrent(
  targetResource: InboxV2EntityKey,
  readResource: InboxV2EntityKey,
  relationTargetResource: InboxV2EntityKey,
  relationReadResource: InboxV2EntityKey,
  revisionChecks: readonly InboxV2PolicyRevisionCheck[]
): boolean {
  return (
    sameEntityKey(targetResource, relationTargetResource) &&
    sameEntityKey(readResource, relationReadResource) &&
    identityRevisionSetIsCurrent(revisionChecks, "relation")
  );
}

function timelineContentTopologyIsCurrent(
  targetResource: InboxV2EntityKey,
  boundary: "external" | "internal" | "staff_only",
  topologyResource: InboxV2EntityKey,
  topologyTimelineItemResource: InboxV2EntityKey,
  topologyConversationResource: InboxV2EntityKey,
  topologyBoundary: "external" | "internal" | "staff_only",
  targetRevisionChecks: readonly InboxV2PolicyRevisionCheck[],
  topologyRevisionChecks: readonly InboxV2PolicyRevisionCheck[]
): boolean {
  return (
    targetResource.entityTypeId === "core:timeline-item" &&
    topologyResource.entityTypeId === "core:timeline-content-topology" &&
    topologyResource.tenantId === targetResource.tenantId &&
    sameEntityKey(topologyTimelineItemResource, targetResource) &&
    topologyConversationResource.entityTypeId === "core:conversation" &&
    topologyConversationResource.tenantId === targetResource.tenantId &&
    topologyBoundary === boundary &&
    identityRevisionSetIsCurrent(targetRevisionChecks, "entity") &&
    identityRevisionSetIsCurrent(topologyRevisionChecks, "state")
  );
}

function messageDeletionHoldIsClear(
  targetResource: InboxV2EntityKey,
  deletionMode: "local_tombstone" | "provider_delete" | null,
  proof: Readonly<{
    resource: InboxV2EntityKey;
    targetResource: InboxV2EntityKey;
    state: "none" | "active";
    revisionChecks: readonly InboxV2PolicyRevisionCheck[];
  }> | null
): boolean {
  return (
    deletionMode !== null &&
    proof !== null &&
    proof.resource.entityTypeId === "core:content-hold-index" &&
    proof.resource.tenantId === targetResource.tenantId &&
    sameEntityKey(proof.targetResource, targetResource) &&
    proof.state === "none" &&
    proof.revisionChecks.length === 1 &&
    identityRevisionSetIsCurrent(proof.revisionChecks, "legal_hold_set")
  );
}

function canonicalProviderMutationEvidenceIsAbsent(
  action:
    | Extract<InboxV2CanonicalActionEvidence, { kind: "message_author_action" }>
    | Extract<InboxV2CanonicalActionEvidence, { kind: "external_moderation" }>
): boolean {
  return (
    action.originalRouteRequirementId === null &&
    action.originalSourceAccountId === null &&
    action.originalSourceAccountResource === null &&
    action.originalBindingResource === null &&
    action.originalBindingSourceAccountResource === null &&
    action.externalReferenceResource === null &&
    action.externalReferenceBindingResource === null &&
    action.externalReferenceTargetResource === null &&
    action.routeRevisionChecks.length === 0 &&
    action.capabilityId === null &&
    action.capabilityManifestResource === null &&
    action.capabilityManifestSourceAccountResource === null &&
    action.capabilityRevisionChecks.length === 0 &&
    action.capabilityState === "not_applicable" &&
    action.capabilityNotAfter === null
  );
}

function canonicalRouteEvidenceIsValid(
  action:
    | Extract<InboxV2CanonicalActionEvidence, { kind: "message_author_action" }>
    | Extract<InboxV2CanonicalActionEvidence, { kind: "message_reaction" }>
    | Extract<InboxV2CanonicalActionEvidence, { kind: "external_moderation" }>
): boolean {
  return (
    action.originalSourceAccountId !== null &&
    action.originalSourceAccountResource !== null &&
    action.originalSourceAccountResource.entityTypeId ===
      "core:source-account" &&
    String(action.originalSourceAccountResource.entityId) ===
      String(action.originalSourceAccountId) &&
    action.originalBindingResource !== null &&
    action.originalBindingResource.entityTypeId ===
      "core:source-thread-binding" &&
    action.originalBindingSourceAccountResource !== null &&
    sameEntityKey(
      action.originalBindingSourceAccountResource,
      action.originalSourceAccountResource
    ) &&
    action.externalReferenceResource !== null &&
    action.externalReferenceResource.entityTypeId ===
      "core:external-message-reference" &&
    action.externalReferenceBindingResource !== null &&
    sameEntityKey(
      action.externalReferenceBindingResource,
      action.originalBindingResource
    ) &&
    action.externalReferenceTargetResource !== null &&
    sameEntityKey(
      action.externalReferenceTargetResource,
      action.targetResource
    ) &&
    action.originalSourceAccountResource.tenantId ===
      action.originalBindingResource.tenantId &&
    action.originalBindingResource.tenantId ===
      action.externalReferenceResource.tenantId &&
    action.targetResource.tenantId ===
      action.originalSourceAccountResource.tenantId &&
    routeRevisionSetIsCurrent(action.routeRevisionChecks)
  );
}

function canonicalCapabilityManifestIsCurrent(
  action:
    | Extract<InboxV2CanonicalActionEvidence, { kind: "message_author_action" }>
    | Extract<InboxV2CanonicalActionEvidence, { kind: "message_reaction" }>
    | Extract<InboxV2CanonicalActionEvidence, { kind: "external_moderation" }>
): boolean {
  return (
    action.originalSourceAccountResource !== null &&
    action.capabilityManifestResource !== null &&
    action.capabilityManifestResource.entityTypeId ===
      "core:provider-capability-manifest" &&
    action.capabilityManifestResource.tenantId ===
      action.targetResource.tenantId &&
    action.capabilityManifestSourceAccountResource !== null &&
    sameEntityKey(
      action.capabilityManifestSourceAccountResource,
      action.originalSourceAccountResource
    ) &&
    identityRevisionSetIsCurrent(action.capabilityRevisionChecks, "manifest")
  );
}

function routeRevisionSetIsCurrent(
  checks: readonly InboxV2PolicyRevisionCheck[]
): boolean {
  return (
    checks.every((check) => check.expected === check.actual) &&
    (["binding", "route", "state"] as const).every((kind) =>
      checks.some((check) => check.kind === kind)
    )
  );
}

function identityRevisionSetIsCurrent(
  checks: readonly InboxV2PolicyRevisionCheck[],
  requiredKind: InboxV2PolicyRevisionCheck["kind"]
): boolean {
  return (
    checks.length > 0 &&
    checks.every((check) => check.expected === check.actual) &&
    checks.some((check) => check.kind === requiredKind)
  );
}

function authorizationManifestIsCurrent(
  manifestResource: InboxV2EntityKey,
  manifestTargetResource: InboxV2EntityKey,
  targetResource: InboxV2EntityKey,
  revisionChecks: readonly InboxV2PolicyRevisionCheck[]
): boolean {
  return (
    manifestResource.entityTypeId === "core:authorization-manifest" &&
    manifestResource.tenantId === targetResource.tenantId &&
    sameEntityKey(manifestTargetResource, targetResource) &&
    identityRevisionSetIsCurrent(revisionChecks, "manifest")
  );
}

function clientPathEvidenceIsCurrent(
  guard: InboxV2ClientContextGuard,
  requirementResource: InboxV2EntityKey,
  actorEmployeeId: InboxV2EmployeeId | null,
  tenantId: InboxV2TenantId
): boolean {
  const evidence: InboxV2ClientPathEvidence = guard.pathEvidence;
  if (
    evidence.kind !== guard.accessPath ||
    evidence.manifestResource.entityTypeId !==
      "core:client-access-path-manifest" ||
    !sameEntityKey(evidence.manifestTargetResource, requirementResource)
  ) {
    return false;
  }

  const pathResources = clientPathEvidenceResources(
    evidence,
    requirementResource
  );
  if (
    pathResources.some((resource) => resource.tenantId !== tenantId) ||
    !exactKeyedRevisionSetIsCurrent(
      evidence.manifestRevisionChecks,
      pathResources
    ) ||
    !exactKeyedRevisionSetIsCurrent(
      evidence.pathRevisionChecks,
      pathResources
    ) ||
    pathResources.some(
      (resource) =>
        !keyedRevisionsAgree(
          evidence.manifestRevisionChecks,
          evidence.pathRevisionChecks,
          resource
        )
    )
  ) {
    return false;
  }

  const clientTargetIsExact =
    guard.target.kind === "client" &&
    requirementResource.entityTypeId === "core:client" &&
    entityKeyMatchesOpaqueId(
      requirementResource,
      String(guard.target.clientId)
    ) &&
    evidence.clientResource.entityTypeId === "core:client" &&
    sameEntityKey(evidence.clientResource, requirementResource);
  if (evidence.kind === "exact_client_binding") {
    return (
      clientTargetIsExact &&
      evidence.bindingResource.entityTypeId === "core:client-access-binding" &&
      sameEntityKey(evidence.bindingClientResource, evidence.clientResource) &&
      sameEntityKey(
        evidence.bindingAuthorityResource,
        evidence.authorityResource
      ) &&
      ["core:tenant", "core:org-unit", "core:team", "core:client"].includes(
        String(evidence.authorityResource.entityTypeId)
      ) &&
      (evidence.authorityResource.entityTypeId !== "core:client" ||
        sameEntityKey(evidence.authorityResource, evidence.clientResource)) &&
      evidence.state === "active"
    );
  }
  if (evidence.kind === "client_owner") {
    return (
      clientTargetIsExact &&
      actorEmployeeId !== null &&
      evidence.ownerEmployeeResource.entityTypeId === "core:employee" &&
      entityKeyMatchesOpaqueId(
        evidence.ownerEmployeeResource,
        String(actorEmployeeId)
      ) &&
      evidence.ownershipRelationResource.entityTypeId ===
        "core:client-owner-relation" &&
      sameEntityKey(evidence.relationClientResource, evidence.clientResource) &&
      sameEntityKey(
        evidence.relationOwnerEmployeeResource,
        evidence.ownerEmployeeResource
      ) &&
      evidence.state === "active"
    );
  }

  const linkIsExact =
    evidence.linkResource.entityTypeId === "core:conversation-client-link" &&
    evidence.conversationResource.entityTypeId === "core:conversation" &&
    sameEntityKey(evidence.linkClientResource, evidence.clientResource) &&
    sameEntityKey(
      evidence.linkConversationResource,
      evidence.conversationResource
    );
  if (evidence.kind === "active_conversation_link") {
    const conversationTargetIsExact =
      guard.target.kind === "conversation" &&
      requirementResource.entityTypeId === "core:conversation" &&
      entityKeyMatchesOpaqueId(
        requirementResource,
        String(guard.target.conversationId)
      ) &&
      sameEntityKey(evidence.conversationResource, requirementResource);
    return (
      linkIsExact &&
      evidence.state === "active" &&
      (clientTargetIsExact || conversationTargetIsExact)
    );
  }

  const workPathIsExact =
    clientTargetIsExact &&
    linkIsExact &&
    evidence.workHeadResource.entityTypeId === "core:conversation-work-head" &&
    sameEntityKey(
      evidence.workHeadConversationResource,
      evidence.conversationResource
    ) &&
    sameEntityKey(
      evidence.workHeadWorkItemResource,
      evidence.workItemResource
    ) &&
    evidence.workItemResource.entityTypeId === "core:work-item" &&
    evidence.workConversationRelationResource.entityTypeId ===
      "core:work-item-conversation-relation" &&
    sameEntityKey(
      evidence.relationWorkItemResource,
      evidence.workItemResource
    ) &&
    sameEntityKey(
      evidence.relationConversationResource,
      evidence.conversationResource
    ) &&
    ["queued", "assigned", "in_progress", "waiting"].includes(
      evidence.workState
    ) &&
    evidence.state === "active";
  if (!workPathIsExact) return false;

  if (evidence.kind === "current_work_item_queue") {
    return (
      evidence.queueResource.entityTypeId === "core:work-queue" &&
      evidence.queueRelationResource.entityTypeId ===
        "core:work-item-queue-relation" &&
      sameEntityKey(
        evidence.queueRelationWorkItemResource,
        evidence.workItemResource
      ) &&
      sameEntityKey(evidence.relationQueueResource, evidence.queueResource)
    );
  }
  return (
    actorEmployeeId !== null &&
    evidence.responsibleEmployeeResource.entityTypeId === "core:employee" &&
    entityKeyMatchesOpaqueId(
      evidence.responsibleEmployeeResource,
      String(actorEmployeeId)
    ) &&
    evidence.responsibilityRelationResource.entityTypeId ===
      "core:work-item-primary-responsibility" &&
    sameEntityKey(
      evidence.responsibilityRelationWorkItemResource,
      evidence.workItemResource
    ) &&
    sameEntityKey(
      evidence.relationResponsibleEmployeeResource,
      evidence.responsibleEmployeeResource
    )
  );
}

function clientPathEvidenceResources(
  evidence: InboxV2ClientPathEvidence,
  requirementResource: InboxV2EntityKey
): readonly InboxV2EntityKey[] {
  const common = [
    evidence.manifestResource,
    requirementResource,
    evidence.clientResource
  ];
  if (evidence.kind === "exact_client_binding") {
    return uniqueEntityResources([
      ...common,
      evidence.bindingResource,
      evidence.authorityResource
    ]);
  }
  if (evidence.kind === "client_owner") {
    return uniqueEntityResources([
      ...common,
      evidence.ownerEmployeeResource,
      evidence.ownershipRelationResource
    ]);
  }
  if (evidence.kind === "active_conversation_link") {
    return uniqueEntityResources([
      ...common,
      evidence.conversationResource,
      evidence.linkResource
    ]);
  }
  const work = [
    ...common,
    evidence.conversationResource,
    evidence.linkResource,
    evidence.workHeadResource,
    evidence.workItemResource,
    evidence.workConversationRelationResource
  ];
  return evidence.kind === "current_work_item_queue"
    ? uniqueEntityResources([
        ...work,
        evidence.queueResource,
        evidence.queueRelationResource
      ])
    : uniqueEntityResources([
        ...work,
        evidence.responsibleEmployeeResource,
        evidence.responsibilityRelationResource
      ]);
}

function evaluateClientMutationEvidence(
  permissionId: InboxV2PermissionId,
  guard: InboxV2ClientContextGuard,
  requirementResource: InboxV2EntityKey,
  tenantId: InboxV2TenantId
): GuardResult {
  const mutation = guard.mutation;
  const expectedKinds: readonly InboxV2ClientMutationEvidence["kind"][] =
    permissionId === "core:client.pipeline.transition"
      ? ["pipeline_transition"]
      : permissionId === "core:client.fields.edit"
        ? ["field_edit"]
        : permissionId === "core:client.access_binding.manage"
          ? ["access_binding_change", "access_binding_target_authority"]
          : permissionId === "core:conversation.clients.manage"
            ? ["conversation_client_links_change"]
            : permissionId === "core:client.link.manage"
              ? ["client_link_target_authority"]
              : [];

  if (expectedKinds.length === 0) {
    return mutation === undefined
      ? guardAllow([])
      : guardDeny("hard_boundary_denied", "permission.denied");
  }
  if (mutation === undefined || !expectedKinds.includes(mutation.kind)) {
    return guardDeny("hard_boundary_denied", "permission.denied");
  }

  if (mutation.kind === "pipeline_transition") {
    const structurallyValid =
      mutation.clientResource.entityTypeId === "core:client" &&
      sameEntityKey(mutation.clientResource, requirementResource) &&
      mutation.oldStageResource.entityTypeId === "core:client-pipeline-stage" &&
      mutation.newStageResource.entityTypeId === "core:client-pipeline-stage" &&
      !sameEntityKey(mutation.oldStageResource, mutation.newStageResource) &&
      mutation.transitionPolicyResource.entityTypeId ===
        "core:client-pipeline-transition-policy" &&
      sameEntityKey(mutation.policyClientResource, mutation.clientResource) &&
      sameEntityKey(
        mutation.policyOldStageResource,
        mutation.oldStageResource
      ) &&
      sameEntityKey(
        mutation.policyNewStageResource,
        mutation.newStageResource
      ) &&
      mutation.policyState === "active" &&
      mutation.reason.trim().length > 0 &&
      mutation.auditEventResource.entityTypeId === "core:audit-event" &&
      sameEntityKey(mutation.auditClientResource, mutation.clientResource) &&
      sameEntityKey(
        mutation.auditOldStageResource,
        mutation.oldStageResource
      ) &&
      sameEntityKey(
        mutation.auditNewStageResource,
        mutation.newStageResource
      ) &&
      clientMutationResourcesBelongToTenant(
        [
          mutation.clientResource,
          mutation.oldStageResource,
          mutation.newStageResource,
          mutation.transitionPolicyResource,
          mutation.auditEventResource
        ],
        tenantId
      );
    if (!structurallyValid) {
      return guardDeny("state_guard_failed", "permission.denied");
    }
    return mutation.expectedClientRevision.trim().length > 0 &&
      mutation.expectedClientRevision === mutation.currentClientRevision &&
      identityRevisionSetIsCurrent(mutation.policyRevisionChecks, "policy")
      ? guardAllow([])
      : guardDeny("revision_guard_failed", "revision.conflict");
  }

  if (mutation.kind === "field_edit") {
    const structurallyValid =
      mutation.clientResource.entityTypeId === "core:client" &&
      sameEntityKey(mutation.clientResource, requirementResource) &&
      mutation.fieldDefinitionResource.entityTypeId ===
        "core:client-field-definition" &&
      mutation.fieldValueResource.entityTypeId === "core:client-field-value" &&
      sameEntityKey(
        mutation.fieldValueClientResource,
        mutation.clientResource
      ) &&
      sameEntityKey(
        mutation.fieldValueDefinitionResource,
        mutation.fieldDefinitionResource
      ) &&
      mutation.definitionState === "active" &&
      mutation.definitionValueType === mutation.submittedValueType &&
      mutation.valueValidationState === "validated" &&
      mutation.requestedValueDigest.trim().length > 0 &&
      mutation.requestedValueDigest === mutation.validatedValueDigest &&
      mutation.reason.trim().length > 0 &&
      mutation.auditEventResource.entityTypeId === "core:audit-event" &&
      sameEntityKey(mutation.auditClientResource, mutation.clientResource) &&
      sameEntityKey(
        mutation.auditFieldDefinitionResource,
        mutation.fieldDefinitionResource
      ) &&
      sameEntityKey(
        mutation.auditFieldValueResource,
        mutation.fieldValueResource
      ) &&
      clientMutationResourcesBelongToTenant(
        [
          mutation.clientResource,
          mutation.fieldDefinitionResource,
          mutation.fieldValueResource,
          mutation.auditEventResource
        ],
        tenantId
      );
    if (!structurallyValid) {
      return guardDeny("state_guard_failed", "permission.denied");
    }
    return mutation.expectedClientRevision.trim().length > 0 &&
      mutation.expectedClientRevision === mutation.currentClientRevision &&
      mutation.expectedFieldValueRevision.trim().length > 0 &&
      mutation.expectedFieldValueRevision ===
        mutation.currentFieldValueRevision &&
      identityRevisionSetIsCurrent(mutation.definitionRevisionChecks, "entity")
      ? guardAllow([])
      : guardDeny("revision_guard_failed", "revision.conflict");
  }

  if (mutation.kind === "access_binding_target_authority") {
    const structurallyValid =
      mutation.clientResource.entityTypeId === "core:client" &&
      sameEntityKey(mutation.clientResource, requirementResource) &&
      mutation.bindingSetResource.entityTypeId ===
        "core:client-access-binding-set" &&
      clientStructuralTargetIsValid(mutation.targetResource) &&
      sameEntityKey(mutation.relationClientResource, mutation.clientResource) &&
      sameEntityKey(mutation.relationTargetResource, mutation.targetResource) &&
      clientMutationResourcesBelongToTenant(
        [
          mutation.clientResource,
          mutation.bindingSetResource,
          mutation.targetResource
        ],
        tenantId
      );
    if (!structurallyValid) {
      return guardDeny("state_guard_failed", "permission.denied");
    }
    return identityRevisionSetIsCurrent(
      mutation.relationRevisionChecks,
      "relation"
    )
      ? guardAllow([])
      : guardDeny("revision_guard_failed", "revision.conflict");
  }

  if (mutation.kind === "access_binding_change") {
    const oldExpected =
      mutation.operation === "replace" || mutation.operation === "remove";
    const newExpected =
      mutation.operation === "replace" || mutation.operation === "add";
    const oldRelationValid = clientAccessBindingRelationIsValid(
      oldExpected,
      mutation.oldBindingResource,
      mutation.oldBindingClientResource,
      mutation.oldBindingTargetResource,
      mutation.clientResource,
      tenantId
    );
    const newRelationValid = clientAccessBindingRelationIsValid(
      newExpected,
      mutation.newBindingResource,
      mutation.newBindingClientResource,
      mutation.newBindingTargetResource,
      mutation.clientResource,
      tenantId
    );
    const expectedAuthorities = [
      ...(oldExpected && mutation.oldBindingTargetResource !== null
        ? [{ side: "old" as const, target: mutation.oldBindingTargetResource }]
        : []),
      ...(newExpected && mutation.newBindingTargetResource !== null
        ? [{ side: "new" as const, target: mutation.newBindingTargetResource }]
        : [])
    ];
    const authoritiesValid =
      mutation.targetAuthorities.length === expectedAuthorities.length &&
      new Set(
        mutation.targetAuthorities.map((authority) => authority.requirementId)
      ).size === mutation.targetAuthorities.length &&
      mutation.targetAuthorities.every(
        (authority) =>
          authority.requirementId.trim().length > 0 &&
          expectedAuthorities.some(
            (expected) =>
              expected.side === authority.side &&
              sameEntityKey(expected.target, authority.targetResource)
          )
      );
    const structurallyValid =
      mutation.clientResource.entityTypeId === "core:client" &&
      sameEntityKey(mutation.clientResource, requirementResource) &&
      mutation.bindingSetResource.entityTypeId ===
        "core:client-access-binding-set" &&
      sameEntityKey(
        mutation.bindingSetClientResource,
        mutation.clientResource
      ) &&
      oldRelationValid &&
      newRelationValid &&
      (mutation.operation !== "replace" ||
        (mutation.oldBindingResource !== null &&
          mutation.newBindingResource !== null &&
          !sameEntityKey(
            mutation.oldBindingResource,
            mutation.newBindingResource
          ) &&
          mutation.oldBindingTargetResource !== null &&
          mutation.newBindingTargetResource !== null &&
          !sameEntityKey(
            mutation.oldBindingTargetResource,
            mutation.newBindingTargetResource
          ))) &&
      authoritiesValid &&
      mutation.reason.trim().length > 0 &&
      mutation.auditEventResource.entityTypeId === "core:audit-event" &&
      sameEntityKey(mutation.auditClientResource, mutation.clientResource) &&
      clientNullableEntityKeyEquals(
        mutation.auditOldTargetResource,
        mutation.oldBindingTargetResource
      ) &&
      clientNullableEntityKeyEquals(
        mutation.auditNewTargetResource,
        mutation.newBindingTargetResource
      ) &&
      clientMutationResourcesBelongToTenant(
        [
          mutation.clientResource,
          mutation.bindingSetResource,
          mutation.auditEventResource
        ],
        tenantId
      );
    if (!structurallyValid) {
      return guardDeny("state_guard_failed", "permission.denied");
    }
    const revisionsValid =
      mutation.expectedBindingSetRevision.trim().length > 0 &&
      mutation.expectedBindingSetRevision ===
        mutation.currentBindingSetRevision &&
      (oldExpected
        ? identityRevisionSetIsCurrent(
            mutation.oldRelationRevisionChecks,
            "relation"
          )
        : mutation.oldRelationRevisionChecks.length === 0) &&
      (newExpected
        ? identityRevisionSetIsCurrent(
            mutation.newRelationRevisionChecks,
            "relation"
          )
        : mutation.newRelationRevisionChecks.length === 0);
    return revisionsValid
      ? guardAllow(
          mutation.targetAuthorities.map(({ requirementId }) => requirementId)
        )
      : guardDeny("revision_guard_failed", "revision.conflict");
  }

  if (mutation.kind === "conversation_client_links_change") {
    const targetRequirementIds = mutation.targets.map(
      ({ clientRequirementId }) => clientRequirementId
    );
    const targetsValid =
      mutation.targets.length > 0 &&
      new Set(targetRequirementIds).size === mutation.targets.length &&
      new Set(
        mutation.targets.map(({ clientResource }) =>
          entityKeyString(clientResource)
        )
      ).size === mutation.targets.length &&
      new Set(
        mutation.targets.map(({ linkResource }) =>
          entityKeyString(linkResource)
        )
      ).size === mutation.targets.length &&
      mutation.targets.every(
        (target) =>
          target.clientRequirementId.trim().length > 0 &&
          target.clientResource.entityTypeId === "core:client" &&
          target.linkResource.entityTypeId ===
            "core:conversation-client-link" &&
          sameEntityKey(
            target.relationConversationResource,
            mutation.conversationResource
          ) &&
          sameEntityKey(target.relationClientResource, target.clientResource) &&
          target.expectedLinkRevision.trim().length > 0 &&
          target.expectedLinkRevision === target.currentLinkRevision &&
          identityRevisionSetIsCurrent(
            target.relationRevisionChecks,
            "relation"
          ) &&
          clientMutationResourcesBelongToTenant(
            [target.clientResource, target.linkResource],
            tenantId
          )
      );
    const structurallyValid =
      mutation.conversationResource.entityTypeId === "core:conversation" &&
      sameEntityKey(mutation.conversationResource, requirementResource) &&
      authorizationManifestIsCurrent(
        mutation.manifestResource,
        mutation.manifestConversationResource,
        mutation.conversationResource,
        mutation.manifestRevisionChecks
      ) &&
      Number.isSafeInteger(mutation.requestedTargetCount) &&
      mutation.requestedTargetCount > 0 &&
      mutation.requestedTargetCount === mutation.manifestTargetCount &&
      mutation.manifestTargetCount === mutation.targets.length &&
      mutation.requestedTargetSetDigest.trim().length > 0 &&
      mutation.requestedTargetSetDigest === mutation.manifestTargetSetDigest &&
      targetsValid &&
      clientRequirementIdSetsAreEqual(
        guard.linkedClientRequirementIds,
        targetRequirementIds
      ) &&
      mutation.reason.trim().length > 0 &&
      mutation.auditEventResource.entityTypeId === "core:audit-event" &&
      sameEntityKey(
        mutation.auditConversationResource,
        mutation.conversationResource
      ) &&
      sameEntityKey(
        mutation.auditManifestResource,
        mutation.manifestResource
      ) &&
      clientMutationResourcesBelongToTenant(
        [
          mutation.conversationResource,
          mutation.manifestResource,
          mutation.auditEventResource
        ],
        tenantId
      );
    return structurallyValid
      ? guardAllow(targetRequirementIds)
      : guardDeny("state_guard_failed", "permission.denied");
  }

  const structurallyValid =
    mutation.clientResource.entityTypeId === "core:client" &&
    sameEntityKey(mutation.clientResource, requirementResource) &&
    mutation.conversationResource.entityTypeId === "core:conversation" &&
    mutation.linkResource.entityTypeId === "core:conversation-client-link" &&
    sameEntityKey(
      mutation.relationConversationResource,
      mutation.conversationResource
    ) &&
    sameEntityKey(mutation.relationClientResource, mutation.clientResource) &&
    authorizationManifestIsCurrent(
      mutation.manifestResource,
      mutation.manifestConversationResource,
      mutation.conversationResource,
      mutation.manifestRevisionChecks
    ) &&
    Number.isSafeInteger(mutation.manifestTargetCount) &&
    mutation.manifestTargetCount > 0 &&
    mutation.manifestTargetSetDigest.trim().length > 0 &&
    mutation.reason.trim().length > 0 &&
    mutation.auditEventResource.entityTypeId === "core:audit-event" &&
    sameEntityKey(
      mutation.auditConversationResource,
      mutation.conversationResource
    ) &&
    sameEntityKey(mutation.auditClientResource, mutation.clientResource) &&
    sameEntityKey(mutation.auditLinkResource, mutation.linkResource) &&
    guard.linkedClientRequirementIds.length === 0 &&
    clientMutationResourcesBelongToTenant(
      [
        mutation.clientResource,
        mutation.conversationResource,
        mutation.linkResource,
        mutation.manifestResource,
        mutation.auditEventResource
      ],
      tenantId
    );
  if (!structurallyValid) {
    return guardDeny("state_guard_failed", "permission.denied");
  }
  return mutation.expectedLinkRevision.trim().length > 0 &&
    mutation.expectedLinkRevision === mutation.currentLinkRevision &&
    identityRevisionSetIsCurrent(mutation.relationRevisionChecks, "relation")
    ? guardAllow([])
    : guardDeny("revision_guard_failed", "revision.conflict");
}

function clientAccessBindingRelationIsValid(
  expected: boolean,
  bindingResource: InboxV2EntityKey | null,
  bindingClientResource: InboxV2EntityKey | null,
  bindingTargetResource: InboxV2EntityKey | null,
  clientResource: InboxV2EntityKey,
  tenantId: InboxV2TenantId
): boolean {
  if (!expected) {
    return (
      bindingResource === null &&
      bindingClientResource === null &&
      bindingTargetResource === null
    );
  }
  return (
    bindingResource?.entityTypeId === "core:client-access-binding" &&
    bindingClientResource !== null &&
    sameEntityKey(bindingClientResource, clientResource) &&
    bindingTargetResource !== null &&
    clientStructuralTargetIsValid(bindingTargetResource) &&
    clientMutationResourcesBelongToTenant(
      [bindingResource, bindingTargetResource],
      tenantId
    )
  );
}

function clientStructuralTargetIsValid(resource: InboxV2EntityKey): boolean {
  return (
    resource.entityTypeId === "core:org-unit" ||
    resource.entityTypeId === "core:team"
  );
}

function clientNullableEntityKeyEquals(
  left: InboxV2EntityKey | null,
  right: InboxV2EntityKey | null
): boolean {
  return left === null || right === null
    ? left === null && right === null
    : sameEntityKey(left, right);
}

function clientMutationResourcesBelongToTenant(
  resources: readonly InboxV2EntityKey[],
  tenantId: InboxV2TenantId
): boolean {
  return resources.every((resource) => resource.tenantId === tenantId);
}

function clientRequirementIdSetsAreEqual(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return (
    left.length === right.length &&
    new Set(left).size === left.length &&
    left.every((id) => right.includes(id))
  );
}

function privacyDiscoveryManifestIsCurrent(
  manifestResource: InboxV2EntityKey,
  manifestTargetResource: InboxV2EntityKey,
  requestResource: InboxV2EntityKey,
  revisionChecks: readonly InboxV2KeyedRevisionCheck[]
): boolean {
  return (
    manifestResource.entityTypeId === "core:privacy-discovery-manifest" &&
    manifestResource.tenantId === requestResource.tenantId &&
    sameEntityKey(manifestTargetResource, requestResource) &&
    exactKeyedRevisionSetIsCurrent(revisionChecks, [
      manifestResource,
      requestResource
    ])
  );
}

function privacyRequestDecisionManifestIsCurrent(
  ledger: NonNullable<InboxV2PrivacyRequestGuard["decisionLedger"]>,
  requestResource: InboxV2EntityKey,
  requesterEmployeeResource: InboxV2EntityKey,
  deciderEmployeeResource: InboxV2EntityKey,
  decisions: InboxV2PrivacyRequestGuard["rootDecisions"],
  discoveryManifestResource: InboxV2EntityKey,
  discoveryManifestMembershipRevisionChecks: readonly InboxV2KeyedRevisionCheck[]
): boolean {
  if (
    ledger.rootManifestDecisionSetDigest.trim().length === 0 ||
    ledger.rootManifestDecisionSetDigest !== ledger.ledgerDecisionSetDigest ||
    ledger.rootManifestEntries.length !== decisions.length ||
    new Set(
      ledger.rootManifestEntries.map(({ rootResource }) =>
        entityKeyString(rootResource)
      )
    ).size !== ledger.rootManifestEntries.length
  ) {
    return false;
  }

  const entriesMatch = decisions.every((decision) => {
    const entry = ledger.rootManifestEntries.find(({ rootResource }) =>
      sameEntityKey(rootResource, decision.rootResource)
    );
    return (
      entry !== undefined &&
      sameEntityKey(
        entry.discoveryProofResource,
        decision.discoveryProofResource
      ) &&
      entry.policyRuleId === decision.policyRuleId &&
      sameEntityKey(entry.policyRuleResource, decision.policyRuleResource) &&
      entry.decisionState === decision.decisionState &&
      entry.expectedDecisionRevision === decision.expectedDecisionRevision &&
      entry.currentDecisionRevision === decision.currentDecisionRevision
    );
  });
  if (!entriesMatch) return false;

  const exactLedgerResources = uniqueEntityResources([
    ledger.resource,
    requestResource,
    requesterEmployeeResource,
    deciderEmployeeResource,
    discoveryManifestResource,
    ledger.rootManifestResource,
    ...decisions.flatMap((decision) => [
      decision.rootResource,
      decision.discoveryProofResource,
      decision.policyRuleResource
    ])
  ]);
  if (
    !exactKeyedRevisionSetIsCurrent(ledger.revisionChecks, exactLedgerResources)
  ) {
    return false;
  }

  return (
    uniqueEntityResources([
      discoveryManifestResource,
      requestResource,
      ...decisions.map(({ rootResource }) => rootResource)
    ]).every((resource) =>
      keyedRevisionsAgree(
        ledger.revisionChecks,
        discoveryManifestMembershipRevisionChecks,
        resource
      )
    ) &&
    decisions.every(
      (decision) =>
        keyedRevisionsAgree(
          ledger.revisionChecks,
          decision.proofRevisionChecks,
          decision.discoveryProofResource
        ) &&
        keyedRevisionsAgree(
          ledger.revisionChecks,
          decision.proofRevisionChecks,
          requestResource
        ) &&
        keyedRevisionsAgree(
          ledger.revisionChecks,
          decision.proofRevisionChecks,
          decision.rootResource
        ) &&
        keyedRevisionsAgree(
          ledger.revisionChecks,
          decision.policyRuleRevisionChecks,
          decision.policyRuleResource
        ) &&
        keyedRevisionsAgree(
          ledger.revisionChecks,
          decision.policyRuleRevisionChecks,
          requestResource
        ) &&
        keyedRevisionsAgree(
          ledger.revisionChecks,
          decision.policyRuleRevisionChecks,
          decision.rootResource
        )
    )
  );
}

function privacyEmployeeResourceMatchesId(
  resource: InboxV2EntityKey,
  employeeId: InboxV2EmployeeId,
  tenantId: InboxV2TenantId
): boolean {
  return (
    resource.tenantId === tenantId &&
    resource.entityTypeId === "core:employee" &&
    String(resource.entityId) === String(employeeId)
  );
}

function exactKeyedRevisionSetIsCurrent(
  checks: readonly InboxV2KeyedRevisionCheck[],
  expectedResources: readonly InboxV2EntityKey[]
): boolean {
  const expectedKeys = expectedResources.map(entityKeyString);
  if (
    checks.length !== expectedKeys.length ||
    new Set(expectedKeys).size !== expectedKeys.length
  ) {
    return false;
  }
  const remaining = new Set(expectedKeys);
  for (const check of checks) {
    const key = entityKeyString(check.resource);
    if (
      !remaining.delete(key) ||
      check.expected.trim().length === 0 ||
      check.expected !== check.actual
    ) {
      return false;
    }
  }
  return remaining.size === 0;
}

function privilegedMutationAuditIsCurrent(
  audit: InboxV2PrivilegedMutationAuditEvidence,
  expectedAction: InboxV2PrivilegedMutationAuditAction,
  targetResource: InboxV2EntityKey,
  actorEmployeeId: InboxV2EmployeeId | null,
  tenantId: InboxV2TenantId
): boolean {
  if (actorEmployeeId === null) return false;
  const resources = uniqueEntityResources([
    audit.eventResource,
    audit.bindingResource,
    targetResource,
    audit.bindingActorEmployeeResource
  ]);
  return (
    audit.action === expectedAction &&
    audit.eventResource.entityTypeId === "core:audit-event" &&
    audit.bindingResource.entityTypeId === "core:audit-event-binding" &&
    audit.bindingActorEmployeeResource.entityTypeId === "core:employee" &&
    entityKeyMatchesOpaqueId(
      audit.bindingActorEmployeeResource,
      String(actorEmployeeId)
    ) &&
    sameEntityKey(audit.bindingEventResource, audit.eventResource) &&
    sameEntityKey(audit.bindingTargetResource, targetResource) &&
    resources.every((resource) => resource.tenantId === tenantId) &&
    exactKeyedRevisionSetIsCurrent(audit.revisionChecks, resources)
  );
}

function employeeDeactivationWorkflowIsCurrent(
  workflow: NonNullable<
    Extract<
      InboxV2CanonicalActionEvidence,
      { kind: "employee_record_change" }
    >["deactivationWorkflow"]
  > | null,
  targetResource: InboxV2EntityKey,
  lifecycleBefore: "pending" | "active" | "draining" | "inactive" | null,
  lifecycleAfter: "pending" | "active" | "draining" | "inactive",
  tenantId: InboxV2TenantId
): boolean {
  if (
    workflow === null ||
    workflow.resource.entityTypeId !== "core:employee-deactivation-workflow" ||
    workflow.resource.tenantId !== tenantId ||
    !sameEntityKey(workflow.employeeResource, targetResource) ||
    workflow.zeroRelationsProofResource.entityTypeId !==
      "core:employee-active-relation-fence" ||
    workflow.zeroRelationsProofResource.tenantId !== tenantId ||
    !sameEntityKey(workflow.proofWorkflowResource, workflow.resource) ||
    !sameEntityKey(workflow.proofEmployeeResource, targetResource) ||
    workflow.relationSets.length !== 3 ||
    new Set(workflow.relationSets.map(({ kind }) => kind)).size !== 3
  ) {
    return false;
  }

  const requiredKinds = new Set([
    "primary_work",
    "client_owner",
    "internal_owner"
  ]);
  if (
    workflow.relationSets.some(
      (set) =>
        !requiredKinds.delete(set.kind) ||
        set.resource.entityTypeId !==
          "core:employee-active-relation-set-manifest" ||
        set.resource.tenantId !== tenantId ||
        !sameEntityKey(
          set.fenceResource,
          workflow.zeroRelationsProofResource
        ) ||
        !sameEntityKey(set.employeeResource, targetResource) ||
        !Number.isInteger(set.activeCount) ||
        set.activeCount < 0 ||
        set.expectedHighWater.trim().length === 0 ||
        set.expectedHighWater !== set.currentHighWater ||
        !exactKeyedRevisionSetIsCurrent(set.revisionChecks, [
          set.resource,
          workflow.zeroRelationsProofResource,
          targetResource
        ]) ||
        !keyedRevisionsAgree(
          set.revisionChecks,
          workflow.revisionChecks,
          set.resource
        ) ||
        !keyedRevisionsAgree(
          set.revisionChecks,
          workflow.revisionChecks,
          workflow.zeroRelationsProofResource
        ) ||
        !keyedRevisionsAgree(
          set.revisionChecks,
          workflow.revisionChecks,
          targetResource
        )
    ) ||
    requiredKinds.size !== 0
  ) {
    return false;
  }

  const handlerSet = workflow.handlerSet;
  const registry = handlerSet.registryManifest;
  const registrySelection = handlerSet.registrySelection;
  const requiredHandlerKeys =
    handlerSet.requiredHandlerResources.map(entityKeyString);
  const completedHandlerKeys =
    handlerSet.completedHandlerResources.map(entityKeyString);
  const requiredHandlerKeySet = new Set(requiredHandlerKeys);
  const registeredHandlerKeys =
    registry.registeredMandatoryHandlerResources.map(entityKeyString);
  if (
    handlerSet.resource.entityTypeId !==
      "core:employee-deactivation-handler-set-manifest" ||
    handlerSet.resource.tenantId !== tenantId ||
    !sameEntityKey(handlerSet.workflowResource, workflow.resource) ||
    !sameEntityKey(handlerSet.employeeResource, targetResource) ||
    registrySelection.resource.entityTypeId !==
      "core:employee-deactivation-handler-registry-selection" ||
    registrySelection.resource.tenantId !== tenantId ||
    !entityKeyMatchesCanonicalSingletonId(
      registrySelection.resource,
      "employee_deactivation_handler_registry_selection",
      String(tenantId)
    ) ||
    registrySelection.tenantResource.entityTypeId !== "core:tenant" ||
    !entityKeyMatchesOpaqueId(
      registrySelection.tenantResource,
      String(tenantId)
    ) ||
    !sameEntityKey(registrySelection.tenantResource, registry.tenantResource) ||
    !sameEntityKey(
      registrySelection.selectedRegistryResource,
      registry.resource
    ) ||
    registrySelection.selectedVersion !== registry.version ||
    registrySelection.selectedDigest.trim().length === 0 ||
    registrySelection.selectedDigest !== registry.digest ||
    registrySelection.state !== "active" ||
    registrySelection.mandatoryHandlerResources.length === 0 ||
    registrySelection.mandatoryHandlerResources.some(
      (resource) =>
        resource.entityTypeId !==
          "core:employee-deactivation-handler-checkpoint" ||
        resource.tenantId !== tenantId
    ) ||
    !exactEntityKeySetMatches(
      registrySelection.mandatoryHandlerResources,
      registry.registeredMandatoryHandlerResources
    ) ||
    !exactKeyedRevisionSetIsCurrent(registrySelection.revisionChecks, [
      registrySelection.resource,
      registrySelection.tenantResource,
      registry.resource,
      ...registrySelection.mandatoryHandlerResources
    ]) ||
    registry.resource.entityTypeId !==
      "core:employee-deactivation-handler-registry-manifest" ||
    registry.resource.tenantId !== tenantId ||
    registry.tenantResource.entityTypeId !== "core:tenant" ||
    !entityKeyMatchesOpaqueId(registry.tenantResource, String(tenantId)) ||
    registry.version.trim().length === 0 ||
    !entityKeyMatchesOpaqueId(registry.resource, registry.version) ||
    registry.digest.trim().length === 0 ||
    registeredHandlerKeys.length === 0 ||
    new Set(registeredHandlerKeys).size !== registeredHandlerKeys.length ||
    registry.registeredMandatoryHandlerResources.some(
      (resource) =>
        resource.entityTypeId !==
          "core:employee-deactivation-handler-checkpoint" ||
        resource.tenantId !== tenantId
    ) ||
    !exactEntityKeySetMatches(
      handlerSet.requiredHandlerResources,
      registry.registeredMandatoryHandlerResources
    ) ||
    !exactKeyedRevisionSetIsCurrent(registry.revisionChecks, [
      registry.resource,
      registry.tenantResource,
      ...registry.registeredMandatoryHandlerResources
    ]) ||
    requiredHandlerKeys.length === 0 ||
    requiredHandlerKeySet.size !== requiredHandlerKeys.length ||
    new Set(completedHandlerKeys).size !== completedHandlerKeys.length ||
    handlerSet.requiredHandlerResources.some(
      (resource) =>
        resource.entityTypeId !==
          "core:employee-deactivation-handler-checkpoint" ||
        resource.tenantId !== tenantId
    ) ||
    completedHandlerKeys.some((key) => !requiredHandlerKeySet.has(key)) ||
    !exactKeyedRevisionSetIsCurrent(
      handlerSet.revisionChecks,
      uniqueEntityResources([
        handlerSet.resource,
        workflow.resource,
        targetResource,
        registrySelection.resource,
        registry.resource,
        ...handlerSet.requiredHandlerResources
      ])
    ) ||
    !exactKeyedRevisionSetIsCurrent(
      workflow.revisionChecks,
      uniqueEntityResources([
        workflow.zeroRelationsProofResource,
        workflow.resource,
        targetResource,
        handlerSet.resource,
        registrySelection.resource,
        registry.resource,
        ...workflow.relationSets.map(({ resource }) => resource)
      ])
    ) ||
    ![
      handlerSet.resource,
      workflow.resource,
      targetResource,
      registrySelection.resource,
      registry.resource
    ].every((resource) =>
      keyedRevisionsAgree(
        handlerSet.revisionChecks,
        workflow.revisionChecks,
        resource
      )
    ) ||
    ![registry.resource, ...registry.registeredMandatoryHandlerResources].every(
      (resource) =>
        keyedRevisionsAgree(
          registry.revisionChecks,
          handlerSet.revisionChecks,
          resource
        )
    ) ||
    ![
      registrySelection.tenantResource,
      registry.resource,
      ...registry.registeredMandatoryHandlerResources
    ].every((resource) =>
      keyedRevisionsAgree(
        registrySelection.revisionChecks,
        registry.revisionChecks,
        resource
      )
    ) ||
    ![
      registrySelection.resource,
      registry.resource,
      ...handlerSet.requiredHandlerResources
    ].every((resource) =>
      keyedRevisionsAgree(
        registrySelection.revisionChecks,
        handlerSet.revisionChecks,
        resource
      )
    )
  ) {
    return false;
  }

  return workflow.phase === "start_draining"
    ? lifecycleBefore === "active" && lifecycleAfter === "draining"
    : lifecycleBefore === "draining" &&
        lifecycleAfter === "inactive" &&
        completedHandlerKeys.length === requiredHandlerKeys.length &&
        completedHandlerKeys.every((key) => requiredHandlerKeySet.has(key)) &&
        workflow.relationSets.every(({ activeCount }) => activeCount === 0);
}

function internalMembershipChangeIsCurrent(
  change: NonNullable<InboxV2InternalMembershipGuard["membershipChange"]>,
  conversationResource: InboxV2EntityKey,
  actorEmployeeId: InboxV2EmployeeId,
  tenantId: InboxV2TenantId
): boolean {
  if (
    change.targetEmployeeResource.entityTypeId !== "core:employee" ||
    !entityKeyMatchesOpaqueId(
      change.targetEmployeeResource,
      String(change.targetEmployeeId)
    ) ||
    change.targetEmployeeResource.tenantId !== tenantId ||
    change.targetLifecycle !== "active" ||
    (change.operation === "add"
      ? change.oldRole !== null || change.newRole === null
      : change.operation === "remove"
        ? change.oldRole === null || change.newRole !== null
        : change.oldRole === null ||
          change.newRole === null ||
          change.oldRole === change.newRole) ||
    change.membershipRelationResource.entityTypeId !==
      "core:internal-membership" ||
    change.membershipRelationResource.tenantId !== tenantId ||
    !sameEntityKey(change.relationConversationResource, conversationResource) ||
    !sameEntityKey(
      change.relationEmployeeResource,
      change.targetEmployeeResource
    ) ||
    change.topologyResource.entityTypeId !==
      "core:internal-conversation-topology" ||
    change.topologyResource.tenantId !== tenantId ||
    !sameEntityKey(change.topologyConversationResource, conversationResource) ||
    change.ownerSet.resource.entityTypeId !==
      "core:internal-owner-set-manifest" ||
    change.ownerSet.resource.tenantId !== tenantId ||
    !sameEntityKey(
      change.ownerSet.conversationResource,
      conversationResource
    ) ||
    !internalOwnerSetTransitionIsValid(
      change.ownerSet,
      change.membershipRelationResource,
      change.oldRole,
      change.newRole,
      change.successorOwner
    ) ||
    (change.successorOwnerRequirementId === null) !==
      (change.successorOwner === null) ||
    change.reason.trim().length === 0
  ) {
    return false;
  }

  const successorResources =
    change.successorOwner === null
      ? []
      : [
          change.successorOwner.employeeResource,
          change.successorOwner.membershipRelationResource
        ];
  const mutationResources = uniqueEntityResources([
    conversationResource,
    change.membershipRelationResource,
    change.targetEmployeeResource,
    change.topologyResource,
    change.ownerSet.resource,
    ...change.ownerSet.beforeOwnerMembershipResources,
    ...change.ownerSet.afterOwnerMembershipResources,
    ...successorResources
  ]);
  return (
    mutationResources.every((resource) => resource.tenantId === tenantId) &&
    exactKeyedRevisionSetIsCurrent(
      change.mutationRevisionChecks,
      mutationResources
    ) &&
    privilegedMutationAuditIsCurrent(
      change.audit,
      change.operation === "add"
        ? "internal_membership_add"
        : change.operation === "remove"
          ? "internal_membership_remove"
          : "internal_membership_change_role",
      change.membershipRelationResource,
      actorEmployeeId,
      tenantId
    ) &&
    keyedRevisionsAgree(
      change.audit.revisionChecks,
      change.mutationRevisionChecks,
      change.membershipRelationResource
    )
  );
}

function internalOwnerSetTransitionIsValid(
  ownerSet: InboxV2InternalOwnerSetEvidence,
  targetMembershipResource: InboxV2EntityKey,
  oldRole: "owner" | "admin" | "member" | "observer" | null,
  newRole: "owner" | "admin" | "member" | "observer" | null,
  successor: InboxV2InternalOwnerSuccessorEvidence | null
): boolean {
  const beforeKeys =
    ownerSet.beforeOwnerMembershipResources.map(entityKeyString);
  const afterKeys = ownerSet.afterOwnerMembershipResources.map(entityKeyString);
  const before = new Set(beforeKeys);
  const after = new Set(afterKeys);
  const targetKey = entityKeyString(targetMembershipResource);
  if (
    beforeKeys.length === 0 ||
    afterKeys.length === 0 ||
    before.size !== beforeKeys.length ||
    after.size !== afterKeys.length ||
    [
      ...ownerSet.beforeOwnerMembershipResources,
      ...ownerSet.afterOwnerMembershipResources
    ].some(
      (resource) =>
        resource.entityTypeId !== "core:internal-membership" ||
        resource.tenantId !== ownerSet.resource.tenantId
    ) ||
    before.has(targetKey) !== (oldRole === "owner") ||
    after.has(targetKey) !== (newRole === "owner")
  ) {
    return false;
  }

  const beforeWithoutTarget = new Set(before);
  const afterWithoutTarget = new Set(after);
  beforeWithoutTarget.delete(targetKey);
  afterWithoutTarget.delete(targetKey);
  const removesLastOwner =
    oldRole === "owner" && newRole !== "owner" && before.size === 1;
  if (!removesLastOwner) {
    return (
      successor === null &&
      stringSetsEqual(beforeWithoutTarget, afterWithoutTarget)
    );
  }
  if (
    successor === null ||
    successor.lifecycle !== "active" ||
    successor.newRole !== "owner" ||
    successor.employeeResource.entityTypeId !== "core:employee" ||
    !entityKeyMatchesOpaqueId(
      successor.employeeResource,
      String(successor.employeeId)
    ) ||
    successor.membershipRelationResource.entityTypeId !==
      "core:internal-membership" ||
    !sameEntityKey(
      successor.relationConversationResource,
      ownerSet.conversationResource
    ) ||
    !sameEntityKey(
      successor.relationEmployeeResource,
      successor.employeeResource
    ) ||
    sameEntityKey(
      successor.membershipRelationResource,
      targetMembershipResource
    )
  ) {
    return false;
  }
  const successorKey = entityKeyString(successor.membershipRelationResource);
  return (
    !before.has(successorKey) && after.size === 1 && after.has(successorKey)
  );
}

function stringSetsEqual(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>
): boolean {
  return (
    left.size === right.size && [...left].every((value) => right.has(value))
  );
}

function sourceAccountCapabilityManifestIsValid(
  manifest: InboxV2SourceAccountCapabilityManifest,
  capabilityId: InboxV2SourceAccountCapabilityManifest["capabilityId"],
  sourceAccountResource: InboxV2EntityKey,
  bindingResource: InboxV2EntityKey,
  routeResource: InboxV2EntityKey | null,
  tenantId: InboxV2TenantId,
  evaluatedAt: InboxV2PolicyTimestamp
): boolean {
  const expectedResources = [
    manifest.resource,
    sourceAccountResource,
    bindingResource,
    ...(routeResource === null ? [] : [routeResource])
  ];
  return (
    manifest.resource.entityTypeId === "core:provider-capability-manifest" &&
    manifest.capabilityId === capabilityId &&
    sourceAccountResource.entityTypeId === "core:source-account" &&
    bindingResource.entityTypeId === "core:source-thread-binding" &&
    (routeResource === null ||
      routeResource.entityTypeId === "core:outbound-route") &&
    sameEntityKey(manifest.sourceAccountResource, sourceAccountResource) &&
    sameEntityKey(manifest.bindingResource, bindingResource) &&
    (routeResource === null
      ? manifest.routeResource === null
      : manifest.routeResource !== null &&
        sameEntityKey(manifest.routeResource, routeResource)) &&
    sameEntityKey(
      manifest.manifestSourceAccountResource,
      sourceAccountResource
    ) &&
    sameEntityKey(manifest.manifestBindingResource, bindingResource) &&
    (routeResource === null
      ? manifest.manifestRouteResource === null
      : manifest.manifestRouteResource !== null &&
        sameEntityKey(manifest.manifestRouteResource, routeResource)) &&
    manifest.state === "supported" &&
    isTimestamp(manifest.notAfter) &&
    isStrictlyAfter(manifest.notAfter, evaluatedAt) &&
    exactKeyedRevisionSetIsCurrent(
      manifest.revisionChecks,
      expectedResources
    ) &&
    [manifest.resource, ...expectedResources].every(
      (resource) => resource.tenantId === tenantId
    )
  );
}

function exactEntityKeySetMatches(
  actual: readonly InboxV2EntityKey[],
  expected: readonly InboxV2EntityKey[]
): boolean {
  if (actual.length !== expected.length) return false;
  const expectedKeys = new Set(expected.map(entityKeyString));
  return (
    expectedKeys.size === expected.length &&
    new Set(actual.map(entityKeyString)).size === actual.length &&
    actual.every((resource) => expectedKeys.has(entityKeyString(resource)))
  );
}

function exactStringSetMatches(
  actual: readonly string[],
  expected: readonly string[]
): boolean {
  if (actual.length !== expected.length) return false;
  const expectedValues = new Set(expected);
  return (
    expectedValues.size === expected.length &&
    new Set(actual).size === actual.length &&
    actual.every((value) => expectedValues.has(value))
  );
}

function keyedRevisionFor(
  checks: readonly InboxV2KeyedRevisionCheck[],
  resource: InboxV2EntityKey
): InboxV2KeyedRevisionCheck | undefined {
  return checks.find((check) => sameEntityKey(check.resource, resource));
}

function keyedRevisionMatchesValues(
  checks: readonly InboxV2KeyedRevisionCheck[],
  resource: InboxV2EntityKey,
  expected: string,
  actual: string
): boolean {
  const check = keyedRevisionFor(checks, resource);
  return check?.expected === expected && check.actual === actual;
}

function keyedRevisionMatchesRequirement(
  checks: readonly InboxV2KeyedRevisionCheck[],
  requirement: InboxV2AuthorizationRequirement
): boolean {
  return (
    requirement.expectedResourceAccessRevision !== null &&
    keyedRevisionMatchesValues(
      checks,
      requirement.resource,
      requirement.expectedResourceAccessRevision,
      requirement.resourceAccessRevision
    )
  );
}

function keyedRevisionMatchesPolicyRevision(
  checks: readonly InboxV2KeyedRevisionCheck[],
  resource: InboxV2EntityKey,
  policyChecks: readonly InboxV2PolicyRevisionCheck[],
  kind: InboxV2PolicyRevisionCheck["kind"]
): boolean {
  const matchingPolicyChecks = policyChecks.filter(
    (policyCheck) => policyCheck.kind === kind
  );
  const keyedCheck = keyedRevisionFor(checks, resource);
  return (
    matchingPolicyChecks.length === 1 &&
    keyedCheck !== undefined &&
    keyedCheck.expected === matchingPolicyChecks[0]!.expected &&
    keyedCheck.actual === matchingPolicyChecks[0]!.actual
  );
}

function keyedRevisionsAgree(
  leftChecks: readonly InboxV2KeyedRevisionCheck[],
  rightChecks: readonly InboxV2KeyedRevisionCheck[],
  resource: InboxV2EntityKey
): boolean {
  const left = keyedRevisionFor(leftChecks, resource);
  const right = keyedRevisionFor(rightChecks, resource);
  return (
    left !== undefined &&
    right !== undefined &&
    left.expected === right.expected &&
    left.actual === right.actual
  );
}

function uniqueEntityResources(
  resources: readonly InboxV2EntityKey[]
): readonly InboxV2EntityKey[] {
  const byKey = new Map<string, InboxV2EntityKey>();
  for (const resource of resources) {
    byKey.set(entityKeyString(resource), resource);
  }
  return Object.freeze([...byKey.values()]);
}

function identityScopeEvidenceKey(scope: InboxV2IdentityScopeEvidence): string {
  return scope.kind === "provider"
    ? scope.kind
    : `${scope.kind}\u0000${entityKeyString(scope.ownerResource)}`;
}

function identityScopeEvidenceIsValid(
  scope: InboxV2IdentityScopeEvidence,
  tenantId: InboxV2TenantId
): boolean {
  return scope.kind === "provider"
    ? true
    : scope.ownerResource.tenantId === tenantId &&
        scope.ownerResource.entityTypeId ===
          (scope.kind === "source_account"
            ? "core:source-account"
            : "core:source-connection");
}

function identityRealmScopeBindingEvidenceIsValid(
  evidence: InboxV2IdentityRealmScopeBindingEvidence,
  identityResource: InboxV2EntityKey,
  realmId: string,
  realmVersion: string,
  scope: InboxV2IdentityScopeEvidence,
  tenantId: InboxV2TenantId
): boolean {
  const expectedScopeResource =
    scope.kind === "provider" ? evidence.scopeResource : scope.ownerResource;
  return (
    evidence.resource.entityTypeId === "core:identity-realm-scope-binding" &&
    evidence.identityResource.entityTypeId ===
      "core:source-external-identity" &&
    evidence.realmResource.entityTypeId === "core:identity-realm" &&
    entityKeyMatchesOpaqueId(evidence.realmResource, realmId) &&
    evidence.scopeResource.entityTypeId ===
      (scope.kind === "provider"
        ? "core:identity-provider-scope"
        : scope.kind === "source_account"
          ? "core:source-account"
          : "core:source-connection") &&
    sameEntityKey(evidence.identityResource, identityResource) &&
    sameEntityKey(evidence.scopeResource, expectedScopeResource) &&
    sameEntityKey(evidence.bindingIdentityResource, identityResource) &&
    sameEntityKey(evidence.bindingRealmResource, evidence.realmResource) &&
    sameEntityKey(evidence.bindingScopeResource, evidence.scopeResource) &&
    evidence.realmId === realmId &&
    evidence.realmVersion === realmVersion &&
    evidence.realmId.trim().length > 0 &&
    evidence.realmVersion.trim().length > 0 &&
    evidence.scopeKind === scope.kind &&
    exactKeyedRevisionSetIsCurrent(evidence.revisionChecks, [
      evidence.resource,
      identityResource,
      evidence.realmResource,
      evidence.scopeResource
    ]) &&
    [
      evidence.resource,
      evidence.identityResource,
      evidence.realmResource,
      evidence.scopeResource,
      evidence.bindingIdentityResource,
      evidence.bindingRealmResource,
      evidence.bindingScopeResource
    ].every((resource) => resource.tenantId === tenantId)
  );
}

function identityResolutionEvidenceIsValid(
  resolution: InboxV2IdentityResolutionEvidence,
  tenantId: InboxV2TenantId
): boolean {
  return (
    resolution.state !== "claimed" ||
    (resolution.targetResource.tenantId === tenantId &&
      (resolution.targetResource.entityTypeId === "core:employee" ||
        resolution.targetResource.entityTypeId === "core:client-contact"))
  );
}

function identityResolutionMatchesClaimHead(
  resolution: InboxV2IdentityResolutionEvidence,
  claimHeadTargetResource: InboxV2EntityKey | null
): boolean {
  return resolution.state === "claimed"
    ? claimHeadTargetResource !== null &&
        sameEntityKey(resolution.targetResource, claimHeadTargetResource)
    : claimHeadTargetResource === null;
}

function identityMergeResolutionsAreCompatible(
  canonical: InboxV2IdentityResolutionEvidence,
  alias: InboxV2IdentityResolutionEvidence
): boolean {
  if (canonical.state === "conflicting" || alias.state === "conflicting") {
    return false;
  }
  return canonical.state !== "claimed" || alias.state !== "claimed"
    ? true
    : sameEntityKey(canonical.targetResource, alias.targetResource);
}

function identityMergeClaimTargetAuthorityIsValid(
  authority: InboxV2IdentityMergeClaimTargetAuthority | null,
  resolution: InboxV2IdentityResolutionEvidence,
  mutationResource: InboxV2EntityKey,
  claimHeadResource: InboxV2EntityKey,
  tenantId: InboxV2TenantId
): boolean {
  if (resolution.state !== "claimed") return authority === null;
  if (authority === null) return false;
  const targetKindIsValid =
    authority.kind === "employee"
      ? authority.targetResource.entityTypeId === "core:employee" &&
        sameEntityKey(authority.authorityResource, authority.targetResource)
      : authority.targetResource.entityTypeId === "core:client-contact" &&
        authority.authorityResource.entityTypeId === "core:client";
  return (
    authority.targetRequirementId.trim().length > 0 &&
    targetKindIsValid &&
    sameEntityKey(authority.targetResource, resolution.targetResource) &&
    authority.bindingResource.entityTypeId ===
      "core:identity-merge-claim-target-binding" &&
    sameEntityKey(authority.bindingMutationResource, mutationResource) &&
    sameEntityKey(authority.bindingClaimHeadResource, claimHeadResource) &&
    sameEntityKey(authority.bindingTargetResource, authority.targetResource) &&
    sameEntityKey(
      authority.bindingAuthorityResource,
      authority.authorityResource
    ) &&
    [
      authority.targetResource,
      authority.authorityResource,
      authority.bindingResource,
      authority.bindingMutationResource,
      authority.bindingClaimHeadResource,
      authority.bindingTargetResource,
      authority.bindingAuthorityResource
    ].every((resource) => resource.tenantId === tenantId) &&
    exactKeyedRevisionSetIsCurrent(
      authority.revisionChecks,
      uniqueEntityResources([
        authority.bindingResource,
        mutationResource,
        claimHeadResource,
        authority.targetResource,
        authority.authorityResource
      ])
    )
  );
}

function identityMergeClaimTargetAuthoritiesAreDeduplicated(
  canonical: InboxV2IdentityMergeClaimTargetAuthority | null,
  alias: InboxV2IdentityMergeClaimTargetAuthority | null
): boolean {
  if (canonical === null || alias === null) return true;
  return sameEntityKey(canonical.targetResource, alias.targetResource)
    ? canonical.targetRequirementId === alias.targetRequirementId &&
        sameEntityKey(canonical.authorityResource, alias.authorityResource)
    : canonical.targetRequirementId !== alias.targetRequirementId;
}

function guardTargetsCanonicalResource(
  permissionId: InboxV2PermissionId,
  requirement: InboxV2AuthorizationRequirement
): boolean {
  const { guard, resource } = requirement;
  if (permissionId === "core:tenant.manage") {
    return resource.entityTypeId === "core:tenant";
  }
  if (
    guard.profileId === "core:rbac.guard.notification_self" ||
    guard.profileId === "core:rbac.guard.notification_target_read"
  ) {
    return sameEntityKey(resource, guard.targetResource);
  }
  if (guard.profileId === "core:rbac.guard.external_route") {
    if (guard.operation.kind === "source_item_reply") {
      return (
        sameEntityKey(resource, guard.targetResource) &&
        sameEntityKey(resource, guard.operation.sourceItemResource) &&
        resource.entityTypeId === "core:source-item" &&
        guard.conversationResource.entityTypeId === "core:conversation" &&
        guard.conversationResource.tenantId === resource.tenantId
      );
    }
    if (guard.operation.kind === "call_initiate") {
      return (
        sameEntityKey(resource, guard.targetResource) &&
        sameEntityKey(resource, guard.operation.callTargetResource) &&
        (resource.entityTypeId === "core:conversation" ||
          resource.entityTypeId === "core:client") &&
        guard.conversationResource.entityTypeId === "core:conversation" &&
        guard.conversationResource.tenantId === resource.tenantId
      );
    }
    return (
      sameEntityKey(resource, guard.targetResource) &&
      guard.conversationResource.entityTypeId === "core:conversation" &&
      sameEntityKey(guard.conversationResource, resource)
    );
  }
  if (guard.profileId === "core:rbac.guard.file_parent_content") {
    return (
      sameEntityKey(resource, guard.targetResource) &&
      resource.entityTypeId === "core:file" &&
      guard.parentResource.tenantId === resource.tenantId
    );
  }
  if (guard.profileId === "core:rbac.guard.client_context") {
    return guard.target.kind === "client"
      ? resource.entityTypeId === "core:client" &&
          String(resource.entityId) === String(guard.target.clientId)
      : resource.entityTypeId === "core:conversation" &&
          String(resource.entityId) === String(guard.target.conversationId);
  }
  if (guard.profileId === "core:rbac.guard.internal_membership") {
    return (
      resource.entityTypeId === "core:conversation" &&
      String(resource.entityId) === String(guard.conversationId)
    );
  }
  if (
    guard.profileId === "core:rbac.guard.internal_break_glass_read" ||
    guard.profileId === "core:rbac.guard.internal_break_glass_issue"
  ) {
    return (
      resource.entityTypeId === "core:conversation" &&
      String(resource.entityId) === String(guard.conversationId)
    );
  }
  if (guard.profileId === "core:rbac.guard.work_item_state") {
    return (
      resource.entityTypeId === "core:work-item" &&
      String(resource.entityId) === String(guard.workItemId)
    );
  }
  if (guard.profileId === "core:rbac.guard.source_account_route") {
    return (
      resource.entityTypeId === "core:source-account" &&
      String(resource.entityId) === String(guard.sourceAccountId)
    );
  }
  if (guard.profileId === "core:rbac.guard.identity_evidence") {
    const identityTypeAllowed =
      permissionId === "core:identity.employee_claim.manage"
        ? resource.entityTypeId === "core:employee"
        : permissionId === "core:identity.client_contact_claim.manage"
          ? resource.entityTypeId === "core:client-contact"
          : permissionId === "core:identity.source_identity.use"
            ? resource.entityTypeId === "core:source-external-identity"
            : permissionId === "core:identity.evidence.view"
              ? [
                  "core:identity-evidence",
                  "core:source-external-identity",
                  "core:source-identity-observation"
                ].includes(String(resource.entityTypeId))
              : permissionId === "core:identity.auto_resolve"
                ? resource.entityTypeId === "core:identity-resolution"
                : permissionId === "core:identity.claim.revoke"
                  ? resource.entityTypeId === "core:employee" ||
                    resource.entityTypeId === "core:client-contact"
                  : permissionId === "core:identity.merge"
                    ? resource.entityTypeId === "core:identity-mutation"
                    : permissionId === "core:identity.observation.review"
                      ? resource.entityTypeId ===
                        "core:identity-review-annotation"
                      : false;
    return sameEntityKey(resource, guard.targetResource) && identityTypeAllowed;
  }
  if (guard.profileId === "core:rbac.guard.report_resource_conjunction") {
    return (
      sameEntityKey(resource, guard.targetResource) &&
      resource.entityTypeId === "core:report-query"
    );
  }
  if (guard.profileId === "core:rbac.guard.audit_facets") {
    return (
      sameEntityKey(resource, guard.targetResource) &&
      resource.entityTypeId === "core:audit-query"
    );
  }
  if (guard.profileId === "core:rbac.guard.privacy_policy_revision") {
    return (
      sameEntityKey(resource, guard.targetResource) &&
      resource.entityTypeId === "core:data-lifecycle-policy" &&
      entityKeyMatchesOpaqueId(resource, guard.policyId)
    );
  }
  if (
    guard.profileId === "core:rbac.guard.privacy_request_roots_revision" ||
    guard.profileId === "core:rbac.guard.privacy_subject_evidence_roots"
  ) {
    return (
      sameEntityKey(resource, guard.targetResource) &&
      resource.entityTypeId === "core:privacy-request" &&
      entityKeyMatchesOpaqueId(resource, guard.caseId)
    );
  }
  if (guard.profileId === "core:rbac.guard.privacy_hold_manifest_revision") {
    return (
      sameEntityKey(resource, guard.targetResource) &&
      resource.entityTypeId === "core:privacy-hold" &&
      entityKeyMatchesOpaqueId(resource, guard.holdId)
    );
  }
  if (guard.profileId === "core:rbac.guard.privacy_tenant_export_high_water") {
    return (
      sameEntityKey(resource, guard.targetResource) &&
      resource.entityTypeId === "core:privacy-export-job" &&
      entityKeyMatchesOpaqueId(resource, guard.exportId)
    );
  }
  if (guard.profileId === "core:rbac.guard.privacy_deletion_plan_revisions") {
    return (
      sameEntityKey(resource, guard.targetResource) &&
      resource.entityTypeId === "core:privacy-deletion-plan" &&
      entityKeyMatchesOpaqueId(resource, guard.deletionPlanId)
    );
  }
  if (guard.profileId === "core:rbac.guard.privacy_audit_facets") {
    return (
      sameEntityKey(resource, guard.targetResource) &&
      resource.entityTypeId === "core:privacy-audit-query"
    );
  }
  if (
    permissionId.startsWith("core:message.staff_note.") &&
    guard.profileId === "core:rbac.guard.canonical_resource"
  ) {
    return (
      resource.entityTypeId === "core:conversation" &&
      canonicalActionTargetsResource(guard.action, resource)
    );
  }
  if (guard.profileId === "core:rbac.guard.canonical_resource") {
    return (
      canonicalActionTargetsResource(guard.action, resource) &&
      canonicalPermissionResourceTypeIsAllowed(
        permissionId,
        String(resource.entityTypeId)
      )
    );
  }
  return false;
}

function canonicalActionTargetsResource(
  action: InboxV2CanonicalActionEvidence,
  resource: InboxV2EntityKey
): boolean {
  return action.kind === "inbox_entry_read" ||
    action.kind === "conversation_content_read" ||
    action.kind === "tenant_settings_change" ||
    action.kind === "employee_record_change" ||
    action.kind === "role_definition_change" ||
    action.kind === "organization_graph_change" ||
    action.kind === "source_item_open_external" ||
    action.kind === "message_author_action" ||
    action.kind === "delegation_change" ||
    action.kind === "conversation_access_change" ||
    action.kind === "internal_conversation_create" ||
    action.kind === "conversation_collaborator_change" ||
    action.kind === "internal_owner_recovery" ||
    action.kind === "notification_self_settings" ||
    action.kind === "report_aggregate" ||
    action.kind === "report_workforce" ||
    action.kind === "report_export" ||
    action.kind === "message_reaction" ||
    action.kind === "external_moderation" ||
    action.kind === "internal_moderation" ||
    action.kind === "sensitive_content"
    ? sameEntityKey(action.targetResource, resource)
    : true;
}

function canonicalPermissionResourceTypeIsAllowed(
  permissionId: InboxV2PermissionId,
  entityTypeId: string
): boolean {
  const allowed = (...entityTypeIds: readonly string[]): boolean =>
    entityTypeIds.includes(entityTypeId);
  if (permissionId === "core:tenant.manage") return allowed("core:tenant");
  if (permissionId === "core:employee.directory.view") {
    return allowed("core:employee", "core:employee-directory-query");
  }
  if (
    permissionId === "core:employee.profile.manage" ||
    permissionId === "core:employee.deactivate"
  ) {
    return allowed("core:employee");
  }
  if (permissionId === "core:employee.invite") {
    return allowed("core:employee-invitation");
  }
  if (permissionId === "core:roles.define") return allowed("core:role");
  if (permissionId === "core:roles.bind") return allowed("core:role-binding");
  if (permissionId === "core:direct_grants.manage") {
    return allowed("core:direct-grant");
  }
  if (permissionId === "core:org_unit.manage") {
    return allowed("core:org-unit");
  }
  if (permissionId === "core:team.manage") return allowed("core:team");
  if (permissionId === "core:queue.manage") {
    return allowed("core:work-queue");
  }
  if (permissionId === "core:inbox.read") {
    return allowed("core:inbox-query", "core:conversation", "core:work-item");
  }
  if (
    permissionId.startsWith("core:conversation.") ||
    permissionId.startsWith("core:message.staff_note.")
  ) {
    return allowed("core:conversation");
  }
  if (
    permissionId === "core:message.edit_own" ||
    permissionId === "core:message.delete_own" ||
    permissionId === "core:message.react" ||
    permissionId === "core:message.moderate_external"
  ) {
    return allowed("core:timeline-item");
  }
  if (permissionId === "core:notification.preferences.manage_self") {
    return allowed("core:employee");
  }
  if (permissionId === "core:notification.endpoints.manage_self") {
    return allowed("core:notification-endpoint");
  }
  if (
    permissionId === "core:source_account.view" ||
    permissionId === "core:source_account.diagnostics.view"
  ) {
    return allowed("core:source-account");
  }
  if (permissionId === "core:source_item.open_external") {
    return allowed("core:source-item");
  }
  if (
    permissionId === "core:call.recording.view" ||
    permissionId === "core:call.transcript.view"
  ) {
    return allowed("core:call");
  }
  if (permissionId === "core:participant.pii.view") {
    return allowed("core:conversation-participant");
  }
  if (
    permissionId === "core:reports.view" ||
    permissionId === "core:reports.workforce_dimension.view"
  ) {
    return allowed("core:report-query");
  }
  if (permissionId === "core:reports.export") {
    return allowed("core:report-query", "core:report-export");
  }
  return false;
}

function evaluateExternalRouteGuard(
  permissionId: InboxV2PermissionId,
  guard: InboxV2ExternalRouteGuard,
  evaluatedAt: InboxV2PolicyTimestamp
): GuardResult {
  if (guard.authorizationMode === "destination_authority") {
    const authority = guard.multiSendDestinationAuthority;
    const matchingDestinations =
      authority === null || guard.operation.kind !== "multi_send"
        ? []
        : guard.operation.destinations.filter(
            (destination) =>
              sameEntityKey(
                destination.targetResource,
                authority.targetResource
              ) &&
              sameEntityKey(
                destination.bindingResource,
                authority.bindingResource
              ) &&
              sameEntityKey(
                destination.sourceAccountResource,
                authority.sourceAccountResource
              )
          );
    return permissionId === "core:source.multi_send" &&
      authority !== null &&
      guard.operation.kind === "multi_send" &&
      guard.operation.operationId === authority.operationId &&
      authority.operationId.trim().length > 0 &&
      authority.targetResource.entityTypeId === "core:conversation" &&
      authority.bindingResource.entityTypeId === "core:source-thread-binding" &&
      authority.sourceAccountResource.entityTypeId === "core:source-account" &&
      [
        authority.targetResource,
        authority.bindingResource,
        authority.sourceAccountResource
      ].every(
        (resource) => resource.tenantId === guard.targetResource.tenantId
      ) &&
      sameEntityKey(guard.targetResource, authority.targetResource) &&
      sameEntityKey(guard.conversationResource, authority.targetResource) &&
      matchingDestinations.length === 1
      ? guardAllow([])
      : guardDeny("hard_boundary_denied", "permission.denied");
  }
  if (guard.multiSendDestinationAuthority !== null) {
    return guardDeny("hard_boundary_denied", "permission.denied");
  }
  const expectedOperation =
    permissionId === "core:message.reply_external"
      ? "reply"
      : permissionId === "core:message.forward_external"
        ? "forward"
        : permissionId === "core:source.multi_send"
          ? "multi_send"
          : permissionId === "core:source_item.reply"
            ? "source_item_reply"
            : permissionId === "core:call.initiate"
              ? "call_initiate"
              : null;
  const expectedCapabilityId =
    expectedOperation === "reply"
      ? "core:capability.message.reply"
      : expectedOperation === "forward"
        ? "core:capability.message.forward"
        : expectedOperation === "multi_send"
          ? "core:capability.source.multi_send"
          : expectedOperation === "source_item_reply"
            ? "core:capability.source_item.reply"
            : expectedOperation === "call_initiate"
              ? "core:capability.call.initiate"
              : null;
  if (
    expectedOperation === null ||
    expectedCapabilityId === null ||
    guard.operation.kind !== expectedOperation ||
    guard.capabilityId !== expectedCapabilityId ||
    guard.capabilityManifestResource.entityTypeId !==
      "core:provider-capability-manifest" ||
    guard.capabilityManifestResource.tenantId !==
      guard.targetResource.tenantId ||
    !sameEntityKey(
      guard.capabilityManifestSourceAccountResource,
      guard.bindingSourceAccountResource
    ) ||
    !sameEntityKey(
      guard.capabilityManifestBindingResource,
      guard.bindingResource
    ) ||
    !identityRevisionSetIsCurrent(guard.capabilityRevisionChecks, "manifest") ||
    !externalRouteOperationEvidenceIsValid(guard, evaluatedAt)
  ) {
    return guardDeny("hard_boundary_denied", "permission.denied");
  }
  if (guard.routeFallbackRequested) {
    return guardDeny("route_guard_failed", "route.forbidden");
  }
  if (guard.sourceAccountId !== guard.bindingSourceAccountId) {
    return guardDeny("route_guard_failed", "route.forbidden");
  }
  if (
    guard.bindingGeneration !== guard.expectedBindingGeneration ||
    guard.bindingState === "ambiguous" ||
    !routeRevisionSetIsCurrent(guard.routeRevisionChecks)
  ) {
    return guardDeny("revision_guard_failed", "route.binding_changed");
  }
  if (
    guard.bindingState !== "active" ||
    guard.capabilityState !== "supported" ||
    guard.capabilityNotAfter === null ||
    !isTimestamp(guard.capabilityNotAfter) ||
    !isStrictlyAfter(guard.capabilityNotAfter, evaluatedAt)
  ) {
    return guardDeny("route_guard_failed", "route.inactive");
  }

  const policy = guard.replyPolicyEvidence;
  if (
    policy.resource.entityTypeId !== "core:queue-reply-policy" ||
    policy.resource.tenantId !== guard.targetResource.tenantId ||
    !sameEntityKey(policy.conversationResource, guard.conversationResource) ||
    policy.policy !== guard.queueReplyPolicy ||
    !identityRevisionSetIsCurrent(policy.revisionChecks, "state") ||
    !isTimestamp(policy.notAfter) ||
    !isStrictlyAfter(policy.notAfter, evaluatedAt) ||
    (guard.workItemId === null
      ? policy.workItemResource !== null
      : policy.workItemResource === null ||
        policy.workItemResource.entityTypeId !== "core:work-item" ||
        !entityKeyMatchesOpaqueId(
          policy.workItemResource,
          String(guard.workItemId)
        ))
  ) {
    return guardDeny("revision_guard_failed", "route.binding_changed");
  }

  const absence = guard.workAbsenceProof;
  if (
    guard.workState === "no_work_non_actionable"
      ? absence === null ||
        absence.resource.entityTypeId !== "core:conversation-work-head" ||
        absence.resource.tenantId !== guard.targetResource.tenantId ||
        !sameEntityKey(
          absence.conversationResource,
          guard.conversationResource
        ) ||
        absence.workItemCount !== 0 ||
        absence.expectedHighWater !== absence.currentHighWater ||
        !identityRevisionSetIsCurrent(absence.revisionChecks, "state")
      : absence !== null
  ) {
    return guardDeny("revision_guard_failed", "route.binding_changed");
  }

  const structural = guard.structuralAccessBinding;
  if (
    guard.actorRelation === "structural_access_binding"
      ? structural === null ||
        structural.resource.entityTypeId !==
          "core:conversation-access-binding" ||
        structural.resource.tenantId !== guard.targetResource.tenantId ||
        !sameEntityKey(
          structural.conversationResource,
          guard.conversationResource
        ) ||
        !["core:org-unit", "core:team"].includes(
          String(structural.scopeTargetResource.entityTypeId)
        ) ||
        structural.scopeTargetResource.tenantId !==
          guard.targetResource.tenantId ||
        structural.state !== "active" ||
        guard.conversationAccessBindingState !== "active" ||
        !identityRevisionSetIsCurrent(structural.revisionChecks, "relation") ||
        !isTimestamp(structural.notAfter) ||
        !isStrictlyAfter(structural.notAfter, evaluatedAt)
      : structural !== null
  ) {
    return guardDeny("state_guard_failed", "route.forbidden");
  }

  const relationAllowed =
    (guard.workState === "active" &&
      (guard.actorRelation === "primary_responsible" ||
        (guard.actorRelation === "scoped_supervisor_override" &&
          guard.overrideRequirementId !== null &&
          guard.overrideReason !== null &&
          guard.overrideReason.trim().length > 0) ||
        (guard.actorRelation === "work_item_collaborator" &&
          guard.queueReplyPolicy === "responsible_or_work_item_collaborator") ||
        (guard.actorRelation === "queue_member" &&
          guard.claimMode === "atomic_claim_and_reply" &&
          guard.claimRequirementId !== null))) ||
    (guard.workState === "no_work_non_actionable" &&
      (guard.actorRelation === "conversation_collaborator" ||
        guard.actorRelation === "exact_conversation_scope" ||
        (guard.actorRelation === "structural_access_binding" &&
          guard.conversationAccessBindingState === "active")));
  if (!relationAllowed) {
    return guardDeny("state_guard_failed", "route.forbidden");
  }

  return guardAllow(
    uniqueRequirementIds([
      guard.conversationRequirementId,
      guard.sourceAccountRequirementId,
      ...(guard.workRequirementId === null ? [] : [guard.workRequirementId]),
      ...(guard.overrideRequirementId === null
        ? []
        : [guard.overrideRequirementId]),
      ...(guard.claimRequirementId === null ? [] : [guard.claimRequirementId]),
      ...externalRouteOperationCompanionIds(guard.operation)
    ]),
    guard.capabilityNotAfter,
    policy.notAfter,
    ...(structural === null ? [] : [structural.notAfter]),
    ...((guard.operation.kind === "forward" ||
      (guard.operation.kind === "reply" &&
        guard.operation.mode === "provider_reference")) &&
    guard.operation.providerGlobalProof !== null
      ? [guard.operation.providerGlobalProof.notAfter]
      : []),
    ...(guard.operation.kind === "multi_send"
      ? guard.operation.destinations.map(
          (destination) => destination.capabilityNotAfter
        )
      : [])
  );
}

function externalRouteOperationEvidenceIsValid(
  guard: InboxV2ExternalRouteGuard,
  evaluatedAt: InboxV2PolicyTimestamp
): boolean {
  const { operation } = guard;
  if (operation.kind === "reply") {
    if (operation.mode === "new_response") {
      return (
        operation.sourceReadRequirementId === null &&
        operation.sourceReadResource === null &&
        operation.sourceTimelineItemResource === null &&
        operation.sourceOccurrenceResource === null &&
        operation.occurrenceTimelineItemResource === null &&
        operation.occurrenceReferenceResource === null &&
        operation.occurrenceBindingResource === null &&
        operation.sourceReferenceResource === null &&
        operation.referenceTimelineItemResource === null &&
        operation.referenceBindingResource === null &&
        operation.revisionChecks.length === 0 &&
        operation.resourceRevisionChecks.length === 0
      );
    }
    if (
      operation.sourceReadRequirementId !== null &&
      operation.sourceReadResource.entityTypeId === "core:conversation" &&
      sameEntityKey(operation.sourceReadResource, guard.conversationResource) &&
      operation.sourceTimelineItemResource.entityTypeId ===
        "core:timeline-item" &&
      operation.sourceOccurrenceResource.entityTypeId ===
        "core:source-occurrence" &&
      operation.sourceReferenceResource.entityTypeId ===
        "core:external-message-reference" &&
      operation.sourceBindingResource.entityTypeId ===
        "core:source-thread-binding" &&
      operation.bindingSourceAccountResource.entityTypeId ===
        "core:source-account" &&
      operation.sourceExternalThreadResource.entityTypeId ===
        "core:external-thread" &&
      sameEntityKey(
        operation.occurrenceTimelineItemResource,
        operation.sourceTimelineItemResource
      ) &&
      sameEntityKey(
        operation.occurrenceReferenceResource,
        operation.sourceReferenceResource
      ) &&
      sameEntityKey(
        operation.occurrenceBindingResource,
        operation.sourceBindingResource
      ) &&
      sameEntityKey(
        operation.referenceTimelineItemResource,
        operation.sourceTimelineItemResource
      ) &&
      sameEntityKey(
        operation.referenceBindingResource,
        operation.sourceBindingResource
      ) &&
      sameEntityKey(
        operation.bindingConversationResource,
        operation.sourceReadResource
      ) &&
      sameEntityKey(
        operation.bindingExternalThreadResource,
        operation.sourceExternalThreadResource
      ) &&
      sameEntityKey(
        operation.sourceExternalThreadResource,
        guard.externalThreadResource
      ) &&
      [
        operation.sourceReadResource,
        operation.sourceTimelineItemResource,
        operation.sourceOccurrenceResource,
        operation.sourceReferenceResource,
        operation.sourceBindingResource,
        operation.bindingConversationResource,
        operation.bindingExternalThreadResource,
        operation.bindingSourceAccountResource,
        operation.sourceExternalThreadResource
      ].every(
        (resource) => resource.tenantId === guard.targetResource.tenantId
      ) &&
      routeRevisionSetIsCurrent(operation.revisionChecks) &&
      exactKeyedRevisionSetIsCurrent(
        operation.resourceRevisionChecks,
        uniqueEntityResources([
          operation.sourceReadResource,
          operation.sourceTimelineItemResource,
          operation.sourceOccurrenceResource,
          operation.sourceReferenceResource,
          operation.sourceBindingResource,
          operation.bindingSourceAccountResource,
          operation.sourceExternalThreadResource
        ])
      )
    ) {
      if (operation.portability === "binding_only") {
        return (
          operation.providerGlobalProof === null &&
          sameEntityKey(
            operation.sourceBindingResource,
            guard.bindingResource
          ) &&
          sameEntityKey(
            operation.bindingConversationResource,
            guard.bindingConversationResource
          ) &&
          sameEntityKey(
            operation.bindingExternalThreadResource,
            guard.bindingExternalThreadResource
          ) &&
          sameEntityKey(
            operation.bindingSourceAccountResource,
            guard.bindingSourceAccountResource
          )
        );
      }
      if (operation.portability === "external_thread") {
        return (
          operation.providerGlobalProof === null &&
          sameEntityKey(
            operation.bindingConversationResource,
            guard.bindingConversationResource
          ) &&
          sameEntityKey(
            operation.sourceExternalThreadResource,
            guard.externalThreadResource
          ) &&
          sameEntityKey(
            operation.bindingExternalThreadResource,
            guard.bindingExternalThreadResource
          )
        );
      }
      return providerGlobalReferenceProofIsValid({
        proof: operation.providerGlobalProof,
        sourceReferenceResource: operation.sourceReferenceResource,
        sourceOccurrenceResource: operation.sourceOccurrenceResource,
        originBindingResource: operation.sourceBindingResource,
        originSourceAccountResource: operation.bindingSourceAccountResource,
        destinationBindingResource: guard.bindingResource,
        destinationSourceAccountResource: guard.bindingSourceAccountResource,
        tenantId: guard.targetResource.tenantId,
        evaluatedAt
      });
    }
    return false;
  }
  if (operation.kind === "forward") {
    if (
      operation.sourceContentBoundary !== "external" ||
      operation.sourceReadResource.entityTypeId !== "core:conversation" ||
      operation.sourceReadResource.tenantId !== guard.targetResource.tenantId ||
      operation.sourceTimelineItemResource.entityTypeId !==
        "core:timeline-item" ||
      operation.sourceTimelineItemResource.tenantId !==
        guard.targetResource.tenantId ||
      operation.timelineItemRelationResource.entityTypeId !==
        "core:timeline-item-conversation-relation" ||
      operation.timelineItemRelationResource.tenantId !==
        guard.targetResource.tenantId ||
      !sameEntityKey(
        operation.timelineItemRelationItemResource,
        operation.sourceTimelineItemResource
      ) ||
      !sameEntityKey(
        operation.timelineItemConversationResource,
        operation.sourceReadResource
      ) ||
      operation.timelineItemRelationRevisionChecks.length === 0 ||
      operation.timelineItemRelationRevisionChecks.some(
        (check) => check.expected !== check.actual
      ) ||
      !operation.timelineItemRelationRevisionChecks.some(
        (check) => check.kind === "relation"
      ) ||
      !exactKeyedRevisionSetIsCurrent(operation.sourceResourceRevisionChecks, [
        operation.timelineItemRelationResource,
        operation.sourceTimelineItemResource,
        operation.sourceReadResource
      ])
    ) {
      return false;
    }
    if (operation.mode === "copy") {
      return (
        operation.portability === "not_applicable" &&
        operation.sourceOccurrenceResource === null &&
        operation.occurrenceTimelineItemResource === null &&
        operation.occurrenceReferenceResource === null &&
        operation.occurrenceBindingResource === null &&
        operation.sourceReferenceResource === null &&
        operation.referenceTimelineItemResource === null &&
        operation.referenceBindingResource === null &&
        operation.sourceBindingResource === null &&
        operation.bindingConversationResource === null &&
        operation.bindingExternalThreadResource === null &&
        operation.bindingSourceAccountResource === null &&
        operation.sourceAccountRequirementId === null &&
        operation.sourceExternalThreadResource === null &&
        operation.providerGlobalProof === null &&
        operation.occurrenceRevisionChecks.length === 0 &&
        operation.nativeResourceRevisionChecks.length === 0
      );
    }
    if (
      operation.portability === "not_applicable" ||
      operation.sourceAccountRequirementId === null ||
      operation.sourceOccurrenceResource?.entityTypeId !==
        "core:source-occurrence" ||
      operation.occurrenceTimelineItemResource === null ||
      operation.occurrenceReferenceResource === null ||
      operation.occurrenceBindingResource === null ||
      operation.sourceReferenceResource?.entityTypeId !==
        "core:external-message-reference" ||
      operation.referenceTimelineItemResource === null ||
      operation.referenceBindingResource === null ||
      operation.sourceBindingResource?.entityTypeId !==
        "core:source-thread-binding" ||
      operation.bindingConversationResource === null ||
      operation.bindingExternalThreadResource === null ||
      operation.bindingSourceAccountResource?.entityTypeId !==
        "core:source-account" ||
      operation.sourceExternalThreadResource?.entityTypeId !==
        "core:external-thread" ||
      operation.sourceOccurrenceResource.tenantId !==
        guard.targetResource.tenantId ||
      operation.sourceReferenceResource.tenantId !==
        guard.targetResource.tenantId ||
      operation.sourceBindingResource.tenantId !==
        guard.targetResource.tenantId ||
      operation.sourceExternalThreadResource.tenantId !==
        guard.targetResource.tenantId ||
      operation.bindingSourceAccountResource.tenantId !==
        guard.targetResource.tenantId ||
      !sameEntityKey(
        operation.occurrenceTimelineItemResource,
        operation.sourceTimelineItemResource
      ) ||
      !sameEntityKey(
        operation.occurrenceReferenceResource,
        operation.sourceReferenceResource
      ) ||
      !sameEntityKey(
        operation.occurrenceBindingResource,
        operation.sourceBindingResource
      ) ||
      !sameEntityKey(
        operation.referenceTimelineItemResource,
        operation.sourceTimelineItemResource
      ) ||
      !sameEntityKey(
        operation.referenceBindingResource,
        operation.sourceBindingResource
      ) ||
      !sameEntityKey(
        operation.bindingConversationResource,
        operation.sourceReadResource
      ) ||
      !sameEntityKey(
        operation.bindingExternalThreadResource,
        operation.sourceExternalThreadResource
      ) ||
      operation.occurrenceRevisionChecks.length === 0 ||
      operation.occurrenceRevisionChecks.some(
        (check) => check.expected !== check.actual
      ) ||
      !operation.occurrenceRevisionChecks.some(
        (check) => check.kind === "binding"
      ) ||
      !exactKeyedRevisionSetIsCurrent(
        operation.nativeResourceRevisionChecks,
        uniqueEntityResources([
          operation.sourceOccurrenceResource,
          operation.sourceReferenceResource,
          operation.sourceBindingResource,
          operation.sourceExternalThreadResource,
          operation.bindingSourceAccountResource
        ])
      )
    ) {
      return false;
    }
    if (operation.portability === "binding_only") {
      return (
        operation.providerGlobalProof === null &&
        sameEntityKey(operation.sourceBindingResource, guard.bindingResource) &&
        sameEntityKey(
          operation.bindingConversationResource,
          guard.bindingConversationResource
        ) &&
        sameEntityKey(
          operation.bindingExternalThreadResource,
          guard.bindingExternalThreadResource
        ) &&
        sameEntityKey(
          operation.bindingSourceAccountResource,
          guard.bindingSourceAccountResource
        )
      );
    }
    if (operation.portability === "external_thread") {
      return (
        operation.providerGlobalProof === null &&
        sameEntityKey(
          operation.sourceExternalThreadResource,
          guard.externalThreadResource
        ) &&
        sameEntityKey(
          operation.bindingConversationResource,
          guard.bindingConversationResource
        ) &&
        sameEntityKey(
          operation.bindingExternalThreadResource,
          guard.bindingExternalThreadResource
        )
      );
    }
    return providerGlobalReferenceProofIsValid({
      proof: operation.providerGlobalProof,
      sourceReferenceResource: operation.sourceReferenceResource,
      sourceOccurrenceResource: operation.sourceOccurrenceResource,
      originBindingResource: operation.sourceBindingResource,
      originSourceAccountResource: operation.bindingSourceAccountResource,
      destinationBindingResource: guard.bindingResource,
      destinationSourceAccountResource: guard.bindingSourceAccountResource,
      tenantId: guard.targetResource.tenantId,
      evaluatedAt
    });
  }
  if (operation.kind === "multi_send") {
    const operationRequirementIds = operation.destinations.map(
      ({ operationRequirementId }) => operationRequirementId
    );
    if (
      operation.operationId.trim().length === 0 ||
      operation.destinations.length < 2 ||
      operationRequirementIds.some((id) => id.trim().length === 0) ||
      new Set(operationRequirementIds).size !== operation.destinations.length ||
      operation.destinations.some(
        (destination) =>
          destination.operationRequirementId ===
            destination.conversationRequirementId ||
          destination.operationRequirementId === destination.sourceRequirementId
      ) ||
      new Set(
        operation.destinations.map(
          ({ targetResource, bindingResource }) =>
            `${entityKeyString(targetResource)}\u0000${entityKeyString(bindingResource)}`
        )
      ).size !== operation.destinations.length
    ) {
      return false;
    }
    const allCurrent = operation.destinations.every(
      (destination) =>
        destination.targetResource.entityTypeId === "core:conversation" &&
        destination.externalThreadResource.entityTypeId ===
          "core:external-thread" &&
        destination.bindingResource.entityTypeId ===
          "core:source-thread-binding" &&
        destination.sourceAccountResource.entityTypeId ===
          "core:source-account" &&
        destination.targetResource.tenantId === guard.targetResource.tenantId &&
        destination.externalThreadResource.tenantId ===
          guard.targetResource.tenantId &&
        destination.bindingResource.tenantId ===
          guard.targetResource.tenantId &&
        destination.sourceAccountResource.tenantId ===
          guard.targetResource.tenantId &&
        sameEntityKey(
          destination.bindingConversationResource,
          destination.targetResource
        ) &&
        sameEntityKey(
          destination.bindingExternalThreadResource,
          destination.externalThreadResource
        ) &&
        sameEntityKey(
          destination.bindingSourceAccountResource,
          destination.sourceAccountResource
        ) &&
        routeRevisionSetIsCurrent(destination.revisionChecks) &&
        destination.capabilityId === "core:capability.source.multi_send" &&
        destination.capabilityManifestResource.entityTypeId ===
          "core:provider-capability-manifest" &&
        destination.capabilityManifestResource.tenantId ===
          guard.targetResource.tenantId &&
        sameEntityKey(
          destination.capabilityManifestSourceAccountResource,
          destination.sourceAccountResource
        ) &&
        sameEntityKey(
          destination.capabilityManifestBindingResource,
          destination.bindingResource
        ) &&
        identityRevisionSetIsCurrent(
          destination.capabilityRevisionChecks,
          "manifest"
        ) &&
        destination.capabilityState === "supported" &&
        isTimestamp(destination.capabilityNotAfter) &&
        isStrictlyAfter(destination.capabilityNotAfter, evaluatedAt)
    );
    return (
      allCurrent &&
      operation.destinations.some(
        (destination) =>
          sameEntityKey(
            destination.targetResource,
            guard.conversationResource
          ) &&
          sameEntityKey(destination.bindingResource, guard.bindingResource) &&
          sameEntityKey(
            destination.sourceAccountResource,
            guard.bindingSourceAccountResource
          ) &&
          sameEntityKey(
            destination.externalThreadResource,
            guard.externalThreadResource
          )
      )
    );
  }
  if (operation.kind === "source_item_reply") {
    return (
      operation.sourceItemResource.entityTypeId === "core:source-item" &&
      sameEntityKey(operation.sourceItemResource, guard.targetResource) &&
      operation.replyDescriptorResource.entityTypeId ===
        "core:source-reply-descriptor" &&
      sameEntityKey(
        operation.descriptorTargetResource,
        operation.sourceItemResource
      ) &&
      operation.replyDescriptorResource.tenantId ===
        guard.targetResource.tenantId &&
      operation.descriptorSourceAccountResource.entityTypeId ===
        "core:source-account" &&
      sameEntityKey(
        operation.descriptorSourceAccountResource,
        guard.bindingSourceAccountResource
      ) &&
      operation.descriptorRevisionChecks.length > 0 &&
      operation.descriptorRevisionChecks.every(
        (check) => check.expected === check.actual
      ) &&
      operation.descriptorRevisionChecks.some(
        (check) => check.kind === "binding"
      )
    );
  }
  return (
    operation.telephonyAccountResource.entityTypeId === "core:source-account" &&
    sameEntityKey(
      operation.telephonyAccountResource,
      guard.bindingSourceAccountResource
    ) &&
    sameEntityKey(operation.callTargetResource, guard.targetResource) &&
    (operation.callTargetResource.entityTypeId === "core:conversation" ||
      operation.callTargetResource.entityTypeId === "core:client") &&
    (operation.callTargetResource.entityTypeId === "core:client"
      ? operation.clientConversationLinkResource?.entityTypeId ===
          "core:conversation-client-link" &&
        operation.clientConversationLinkResource.tenantId ===
          guard.targetResource.tenantId &&
        operation.linkClientResource !== null &&
        operation.linkConversationResource !== null &&
        sameEntityKey(
          operation.linkClientResource,
          operation.callTargetResource
        ) &&
        sameEntityKey(
          operation.linkConversationResource,
          guard.conversationResource
        ) &&
        operation.linkRevisionChecks.length > 0 &&
        operation.linkRevisionChecks.every(
          (check) => check.expected === check.actual
        ) &&
        operation.linkRevisionChecks.some((check) => check.kind === "relation")
      : operation.clientConversationLinkResource === null &&
        operation.linkClientResource === null &&
        operation.linkConversationResource === null &&
        operation.linkRevisionChecks.length === 0) &&
    operation.capabilityId === "core:capability.call.initiate" &&
    operation.capabilityRevisionChecks.length > 0 &&
    operation.capabilityRevisionChecks.every(
      (check) => check.expected === check.actual
    ) &&
    operation.capabilityRevisionChecks.some(
      (check) => check.kind === "manifest"
    )
  );
}

function providerGlobalReferenceProofIsValid(
  input: Readonly<{
    proof: InboxV2ProviderGlobalReferenceProof | null;
    sourceReferenceResource: InboxV2EntityKey;
    sourceOccurrenceResource: InboxV2EntityKey;
    originBindingResource: InboxV2EntityKey;
    originSourceAccountResource: InboxV2EntityKey;
    destinationBindingResource: InboxV2EntityKey;
    destinationSourceAccountResource: InboxV2EntityKey;
    tenantId: InboxV2TenantId;
    evaluatedAt: InboxV2PolicyTimestamp;
  }>
): boolean {
  const proof = input.proof;
  return (
    proof !== null &&
    proof.resource.entityTypeId === "core:reference-portability-proof" &&
    proof.resource.tenantId === input.tenantId &&
    sameEntityKey(
      proof.sourceReferenceResource,
      input.sourceReferenceResource
    ) &&
    sameEntityKey(
      proof.sourceOccurrenceResource,
      input.sourceOccurrenceResource
    ) &&
    sameEntityKey(proof.originBindingResource, input.originBindingResource) &&
    sameEntityKey(
      proof.originSourceAccountResource,
      input.originSourceAccountResource
    ) &&
    sameEntityKey(
      proof.destinationBindingResource,
      input.destinationBindingResource
    ) &&
    sameEntityKey(
      proof.destinationSourceAccountResource,
      input.destinationSourceAccountResource
    ) &&
    proof.providerContractResource.entityTypeId ===
      "core:adapter-contract-snapshot" &&
    proof.providerContractResource.tenantId === input.tenantId &&
    sameEntityKey(
      proof.originSourceAccountProviderContractResource,
      proof.providerContractResource
    ) &&
    sameEntityKey(
      proof.destinationSourceAccountProviderContractResource,
      proof.providerContractResource
    ) &&
    proof.revisionChecks.length > 0 &&
    proof.revisionChecks.every((check) => check.expected === check.actual) &&
    proof.revisionChecks.some((check) => check.kind === "binding") &&
    proof.revisionChecks.some((check) => check.kind === "manifest") &&
    exactKeyedRevisionSetIsCurrent(
      proof.resourceRevisionChecks,
      uniqueEntityResources([
        proof.resource,
        proof.sourceReferenceResource,
        proof.sourceOccurrenceResource,
        proof.originBindingResource,
        proof.originSourceAccountResource,
        proof.destinationBindingResource,
        proof.destinationSourceAccountResource,
        proof.providerContractResource
      ])
    ) &&
    isStrictlyAfter(proof.notAfter, input.evaluatedAt)
  );
}

function externalRouteOperationCompanionIds(
  operation: InboxV2ExternalRouteOperationEvidence
): readonly string[] {
  switch (operation.kind) {
    case "reply":
      return operation.sourceReadRequirementId === null
        ? []
        : [operation.sourceReadRequirementId];
    case "forward":
      return [
        operation.sourceReadRequirementId,
        ...(operation.sourceAccountRequirementId === null
          ? []
          : [operation.sourceAccountRequirementId])
      ];
    case "multi_send":
      return operation.destinations.flatMap(
        ({
          conversationRequirementId,
          sourceRequirementId,
          operationRequirementId
        }) => [
          conversationRequirementId,
          sourceRequirementId,
          operationRequirementId
        ]
      );
    case "source_item_reply":
      return [operation.sourceItemReadRequirementId];
    case "call_initiate":
      return [operation.accountRequirementId, operation.targetRequirementId];
  }
}

function uniqueRequirementIds(ids: readonly string[]): readonly string[] {
  return [...new Set(ids)];
}

function matchScope(
  scope: InboxV2PermissionScope,
  facts: readonly InboxV2CanonicalScopeFact[],
  resource: InboxV2EntityKey,
  context: EvaluationContext,
  evaluatedAt: InboxV2PolicyTimestamp
): ScopeMatch {
  if (scope.type === "tenant") {
    return Object.freeze({ matched: true, boundary: null });
  }

  const usableFacts = facts.filter(
    (fact) =>
      scopeFactIsInternallyConsistent(fact, evaluatedAt) &&
      sameEntityKey(fact.resource, resource) &&
      isTemporalFactActive(fact, evaluatedAt)
  );
  const principalEmployeeId = context.employeeId;

  for (const fact of usableFacts) {
    if (scope.type === "org_unit" && fact.kind === "org_unit") {
      if (fact.closureRevision !== fact.currentClosureRevision) {
        return Object.freeze({
          matched: false,
          reason: "revision_guard_failed"
        });
      }
      const exact = fact.orgUnitId === scope.id;
      const descendant = fact.ancestorOrgUnitIds.includes(scope.id);
      if (exact || (scope.mode === "subtree" && descendant)) {
        return Object.freeze({ matched: true, boundary: fact.validUntil });
      }
    } else if (
      (scope.type === "team" &&
        fact.kind === "team" &&
        fact.teamId === scope.id) ||
      (scope.type === "queue" &&
        fact.kind === "queue" &&
        fact.queueId === scope.id) ||
      (scope.type === "client" &&
        fact.kind === "client" &&
        fact.clientId === scope.id) ||
      (scope.type === "conversation" &&
        fact.kind === "conversation" &&
        fact.conversationId === scope.id) ||
      (scope.type === "work_item" &&
        fact.kind === "work_item" &&
        fact.workItemId === scope.id) ||
      (scope.type === "source_account" &&
        fact.kind === "source_account" &&
        fact.sourceAccountId === scope.id)
    ) {
      return Object.freeze({ matched: true, boundary: fact.validUntil });
    } else if (
      scope.type === "responsible" &&
      fact.kind === "responsible" &&
      principalEmployeeId !== null &&
      fact.employeeId === principalEmployeeId &&
      fact.state === "active"
    ) {
      if (fact.assignmentRevision !== fact.currentAssignmentRevision) {
        return Object.freeze({
          matched: false,
          reason: "revision_guard_failed"
        });
      }
      return Object.freeze({ matched: true, boundary: fact.validUntil });
    } else if (
      scope.type === "collaborator" &&
      fact.kind === "collaborator" &&
      principalEmployeeId !== null &&
      fact.employeeId === principalEmployeeId &&
      fact.state === "active"
    ) {
      if (
        fact.episodeRevision !== fact.currentEpisodeRevision ||
        (fact.subject.kind === "work_item" &&
          fact.subject.workCycle !== fact.subject.currentWorkCycle)
      ) {
        return Object.freeze({
          matched: false,
          reason: "revision_guard_failed"
        });
      }
      return Object.freeze({ matched: true, boundary: fact.validUntil });
    } else if (
      scope.type === "internal_participant" &&
      fact.kind === "internal_participant" &&
      principalEmployeeId !== null &&
      fact.employeeId === principalEmployeeId &&
      fact.state === "active" &&
      fact.origin === "hulee_internal_command"
    ) {
      if (fact.membershipRevision !== fact.currentMembershipRevision) {
        return Object.freeze({
          matched: false,
          reason: "revision_guard_failed"
        });
      }
      return Object.freeze({ matched: true, boundary: fact.validUntil });
    } else if (
      scope.type === "client_owner" &&
      fact.kind === "client_owner" &&
      principalEmployeeId !== null &&
      fact.employeeId === principalEmployeeId &&
      fact.state === "active"
    ) {
      if (fact.ownershipRevision !== fact.currentOwnershipRevision) {
        return Object.freeze({
          matched: false,
          reason: "revision_guard_failed"
        });
      }
      return Object.freeze({ matched: true, boundary: fact.validUntil });
    }
  }

  return Object.freeze({
    matched: false,
    reason:
      scope.type === "org_unit" ||
      scope.type === "team" ||
      scope.type === "queue"
        ? "structural_path_missing"
        : scope.type === "responsible" ||
            scope.type === "collaborator" ||
            scope.type === "internal_participant" ||
            scope.type === "client_owner"
          ? "canonical_relation_not_matched"
          : "scope_not_matched"
  });
}

function scopeFactIsInternallyConsistent(
  fact: InboxV2CanonicalScopeFact,
  evaluatedAt: InboxV2PolicyTimestamp
): boolean {
  const candidate = fact as unknown;
  if (!isRecord(candidate)) return false;
  const pathRevisionChecks = candidate.pathRevisionChecks;
  const authorityProvenance = candidate.authorityProvenance;
  const resource = candidate.resource;
  const scopeTarget = candidate.scopeTarget;
  if (
    !Array.isArray(pathRevisionChecks) ||
    !entityKeyRecordIsValid(resource) ||
    !entityKeyRecordIsValid(scopeTarget) ||
    !isRecord(authorityProvenance) ||
    authorityProvenance.kind !== "hulee_canonical_repository" ||
    typeof authorityProvenance.factId !== "string" ||
    authorityProvenance.factId.trim().length === 0 ||
    typeof authorityProvenance.loaderDecisionId !== "string" ||
    authorityProvenance.loaderDecisionId.trim().length === 0 ||
    typeof authorityProvenance.projectionRevision !== "string" ||
    !/^[1-9][0-9]*$/.test(authorityProvenance.projectionRevision) ||
    typeof authorityProvenance.observedAt !== "string" ||
    !isTimestamp(authorityProvenance.observedAt) ||
    !isAtOrAfter(evaluatedAt, authorityProvenance.observedAt) ||
    (candidate.validUntil !== null &&
      (typeof candidate.validUntil !== "string" ||
        !isTimestamp(candidate.validUntil))) ||
    !scopeFactVariantIsStructurallyValid(candidate)
  ) {
    return false;
  }
  if (
    resource.tenantId !== scopeTarget.tenantId ||
    pathRevisionChecks.length === 0 ||
    pathRevisionChecks.some(
      (check) =>
        !revisionCheckRecordIsValid(check) || check.expected !== check.actual
    ) ||
    !pathRevisionChecks.some(
      (check) => isRecord(check) && check.kind === "state"
    ) ||
    !pathRevisionChecks.some(
      (check) =>
        isRecord(check) &&
        (check.kind === "relation" || check.kind === "binding")
    )
  ) {
    return false;
  }
  const targetMatches = (entityTypeId: string, id: string): boolean =>
    fact.scopeTarget.entityTypeId === entityTypeId &&
    String(fact.scopeTarget.entityId) === id;
  switch (fact.kind) {
    case "org_unit":
      return targetMatches("core:org-unit", String(fact.orgUnitId));
    case "team":
      return targetMatches("core:team", String(fact.teamId));
    case "queue":
      return targetMatches("core:work-queue", String(fact.queueId));
    case "client":
      return (
        targetMatches("core:client", String(fact.clientId)) &&
        (fact.resource.entityTypeId !== "core:client" ||
          sameEntityKey(fact.scopeTarget, fact.resource))
      );
    case "conversation":
      return targetMatches("core:conversation", String(fact.conversationId));
    case "work_item":
    case "responsible":
      return targetMatches("core:work-item", String(fact.workItemId));
    case "source_account":
      return targetMatches("core:source-account", String(fact.sourceAccountId));
    case "collaborator":
      return fact.subject.kind === "conversation"
        ? targetMatches(
            "core:conversation",
            String(fact.subject.conversationId)
          )
        : targetMatches("core:work-item", String(fact.subject.workItemId));
    case "internal_participant":
      return targetMatches("core:conversation", String(fact.conversationId));
    case "client_owner":
      return targetMatches("core:client", String(fact.clientId));
  }
}

function scopeFactVariantIsStructurallyValid(
  candidate: Record<string, unknown>
): boolean {
  const stringField = (name: string): boolean =>
    typeof candidate[name] === "string" &&
    (candidate[name] as string).trim().length > 0;
  const revisionPair = (expected: string, current: string): boolean =>
    stringField(expected) && stringField(current);

  switch (candidate.kind) {
    case "org_unit":
      return (
        stringField("orgUnitId") &&
        Array.isArray(candidate.ancestorOrgUnitIds) &&
        candidate.ancestorOrgUnitIds.every(
          (id) => typeof id === "string" && id.trim().length > 0
        ) &&
        revisionPair("closureRevision", "currentClosureRevision")
      );
    case "team":
      return stringField("teamId");
    case "queue":
      return stringField("queueId");
    case "client":
      return stringField("clientId");
    case "conversation":
      return stringField("conversationId");
    case "work_item":
      return stringField("workItemId");
    case "source_account":
      return stringField("sourceAccountId");
    case "responsible":
      return (
        stringField("employeeId") &&
        stringField("workItemId") &&
        (candidate.state === "active" ||
          candidate.state === "recovery_pending" ||
          candidate.state === "closed") &&
        revisionPair("assignmentRevision", "currentAssignmentRevision")
      );
    case "collaborator": {
      const subject = candidate.subject;
      if (
        !stringField("employeeId") ||
        (candidate.state !== "active" && candidate.state !== "closed") ||
        !revisionPair("episodeRevision", "currentEpisodeRevision") ||
        !isRecord(subject)
      ) {
        return false;
      }
      return subject.kind === "conversation"
        ? typeof subject.conversationId === "string" &&
            subject.conversationId.trim().length > 0
        : subject.kind === "work_item" &&
            typeof subject.workItemId === "string" &&
            subject.workItemId.trim().length > 0 &&
            typeof subject.workCycle === "string" &&
            typeof subject.currentWorkCycle === "string";
    }
    case "internal_participant":
      return (
        stringField("employeeId") &&
        stringField("conversationId") &&
        (candidate.state === "active" || candidate.state === "closed") &&
        (candidate.origin === "hulee_internal_command" ||
          candidate.origin === "provider_observation") &&
        revisionPair("membershipRevision", "currentMembershipRevision")
      );
    case "client_owner":
      return (
        stringField("employeeId") &&
        stringField("clientId") &&
        (candidate.state === "active" || candidate.state === "closed") &&
        revisionPair("ownershipRevision", "currentOwnershipRevision")
      );
    default:
      return false;
  }
}

function revisionCheckRecordIsValid(value: unknown): value is Readonly<{
  kind: InboxV2PolicyRevisionCheck["kind"];
  expected: string;
  actual: string;
}> {
  return (
    isRecord(value) &&
    typeof value.kind === "string" &&
    [
      "entity",
      "state",
      "relation",
      "binding",
      "route",
      "policy",
      "manifest",
      "high_water",
      "handler"
    ].includes(value.kind) &&
    typeof value.expected === "string" &&
    value.expected.trim().length > 0 &&
    typeof value.actual === "string" &&
    value.actual.trim().length > 0
  );
}

function entityKeyRecordIsValid(value: unknown): value is InboxV2EntityKey {
  return (
    isRecord(value) &&
    typeof value.tenantId === "string" &&
    value.tenantId.trim().length > 0 &&
    typeof value.entityTypeId === "string" &&
    value.entityTypeId.trim().length > 0 &&
    typeof value.entityId === "string" &&
    value.entityId.trim().length > 0
  );
}

function grantTargetsPrincipal(
  grant: InboxV2PolicyGrant,
  principalKind: "employee" | "trusted_service",
  principalId: string
): boolean {
  return (
    grant.principal.kind === principalKind &&
    (grant.principal.kind === "employee"
      ? String(grant.principal.employeeId) === principalId
      : String(grant.principal.trustedServiceId) === principalId)
  );
}

function grantProvenanceIsValid(grant: InboxV2PolicyGrant): boolean {
  const candidate = grant as unknown;
  if (
    !isRecord(candidate) ||
    typeof candidate.id !== "string" ||
    candidate.id.trim().length === 0 ||
    typeof candidate.tenantId !== "string" ||
    candidate.tenantId.trim().length === 0 ||
    typeof candidate.permissionId !== "string" ||
    candidate.permissionId.trim().length === 0 ||
    typeof candidate.revision !== "string" ||
    !/^[1-9][0-9]*$/.test(candidate.revision) ||
    !grantPrincipalRecordIsValid(candidate.principal) ||
    !permissionScopeRecordIsValid(candidate.scope) ||
    !grantTimestampIsValid(candidate.validFrom) ||
    !grantTimestampIsValid(candidate.validUntil) ||
    !grantTimestampIsValid(candidate.revokedAt) ||
    !isRecord(candidate.source)
  ) {
    return false;
  }
  const source = candidate.source;
  if (
    !isRecord(candidate.principal) ||
    (candidate.principal.kind === "employee" &&
      source.kind === "service_registration") ||
    (candidate.principal.kind === "trusted_service" &&
      source.kind !== "service_registration") ||
    source.origin !== "inbox_v2_native" ||
    typeof source.kind !== "string" ||
    !["role_binding", "direct_grant", "service_registration"].includes(
      source.kind
    ) ||
    !isRecord(source.bindingResource) ||
    typeof source.bindingResource.tenantId !== "string" ||
    typeof source.bindingResource.entityTypeId !== "string" ||
    typeof source.bindingResource.entityId !== "string" ||
    typeof source.bindingRevision !== "string" ||
    !/^[1-9][0-9]*$/.test(source.bindingRevision)
  ) {
    return false;
  }
  if (
    grant.catalogSchemaId !== "core:inbox-v2.permission-scope-catalog" ||
    grant.catalogVersion !== "v1" ||
    grant.source.origin !== "inbox_v2_native" ||
    grant.source.bindingResource.tenantId !== grant.tenantId ||
    grant.source.bindingRevision !== grant.revision
  ) {
    return false;
  }
  const expected =
    grant.source.kind === "role_binding"
      ? {
          entityTypeId: "core:role-binding",
          id: grant.source.roleBindingId
        }
      : grant.source.kind === "direct_grant"
        ? {
            entityTypeId: "core:direct-grant",
            id: grant.source.directGrantId
          }
        : {
            entityTypeId: "core:service-registration",
            id: grant.source.serviceRegistrationId
          };
  if (typeof expected.id !== "string" || expected.id.trim().length === 0) {
    return false;
  }
  return (
    grant.source.bindingResource.entityTypeId === expected.entityTypeId &&
    entityKeyMatchesOpaqueId(grant.source.bindingResource, expected.id)
  );
}

function grantPrincipalRecordIsValid(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return value.kind === "employee"
    ? typeof value.employeeId === "string" && value.employeeId.trim().length > 0
    : value.kind === "trusted_service" &&
        typeof value.trustedServiceId === "string" &&
        value.trustedServiceId.trim().length > 0;
}

function permissionScopeRecordIsValid(value: unknown): boolean {
  if (
    !isRecord(value) ||
    typeof value.type !== "string" ||
    typeof value.tenantId !== "string" ||
    value.tenantId.trim().length === 0
  ) {
    return false;
  }
  if (
    value.type === "tenant" ||
    value.type === "responsible" ||
    value.type === "collaborator" ||
    value.type === "internal_participant" ||
    value.type === "client_owner"
  ) {
    return true;
  }
  if (
    ![
      "org_unit",
      "team",
      "queue",
      "client",
      "conversation",
      "work_item",
      "source_account"
    ].includes(value.type) ||
    typeof value.id !== "string" ||
    value.id.trim().length === 0
  ) {
    return false;
  }
  return (
    value.type !== "org_unit" ||
    value.mode === "exact" ||
    value.mode === "subtree"
  );
}

function grantTimestampIsValid(value: unknown): boolean {
  return value === null || (typeof value === "string" && isTimestamp(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGrantActive(
  grant: InboxV2PolicyGrant,
  evaluatedAt: InboxV2PolicyTimestamp
): boolean {
  return (
    (grant.validFrom === null || isAtOrAfter(evaluatedAt, grant.validFrom)) &&
    (grant.validUntil === null ||
      isStrictlyAfter(grant.validUntil, evaluatedAt)) &&
    (grant.revokedAt === null || isStrictlyAfter(grant.revokedAt, evaluatedAt))
  );
}

function isTemporalFactActive(
  fact: InboxV2TemporalScopeFact,
  evaluatedAt: InboxV2PolicyTimestamp
): boolean {
  return (
    fact.validUntil === null || isStrictlyAfter(fact.validUntil, evaluatedAt)
  );
}

function sameDependencyVector(
  left: InboxV2AuthorizationDependencyVector,
  right: InboxV2AuthorizationDependencyVector
): boolean {
  return (
    left.tenantRbacRevision === right.tenantRbacRevision &&
    left.employeeAccessRevision === right.employeeAccessRevision &&
    left.employeeInboxRelationRevision ===
      right.employeeInboxRelationRevision &&
    left.sharedAccessRevision === right.sharedAccessRevision &&
    left.temporalBoundaryDigest === right.temporalBoundaryDigest &&
    left.resourceDependencies.length === right.resourceDependencies.length &&
    left.resourceDependencies.every((dependency, index) => {
      const other = right.resourceDependencies[index];
      return (
        other !== undefined &&
        sameEntityKey(dependency.resource, other.resource) &&
        dependency.accessRevision === other.accessRevision
      );
    })
  );
}

function sameEntityKey(
  left: InboxV2EntityKey,
  right: InboxV2EntityKey
): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.entityTypeId === right.entityTypeId &&
    left.entityId === right.entityId
  );
}

function entityKeyString(resource: InboxV2EntityKey): string {
  return `${resource.tenantId}\u0000${resource.entityTypeId}\u0000${resource.entityId}`;
}

function immutableEntityKey(resource: InboxV2EntityKey): InboxV2EntityKey {
  return Object.freeze({
    tenantId: resource.tenantId,
    entityTypeId: resource.entityTypeId,
    entityId: resource.entityId
  });
}

function immutablePermissionScope(
  scope: InboxV2PermissionScope
): InboxV2PermissionScope {
  return Object.freeze({ ...scope }) as InboxV2PermissionScope;
}

function entityKeyMatchesOpaqueId(
  resource: InboxV2EntityKey,
  expectedId: string
): boolean {
  const entityId = String(resource.entityId);
  return entityId === expectedId || entityId.endsWith(`:${expectedId}`);
}

function entityKeyMatchesCanonicalSingletonId(
  resource: InboxV2EntityKey,
  canonicalPrefix: string,
  expectedId: string
): boolean {
  return String(resource.entityId) === `${canonicalPrefix}:${expectedId}`;
}

function sourceAccountResourceMatches(
  resource: InboxV2EntityKey,
  sourceAccountId: InboxV2SourceAccountId,
  tenantId: InboxV2TenantId
): boolean {
  return (
    resource.tenantId === tenantId &&
    resource.entityTypeId === "core:source-account" &&
    entityKeyMatchesOpaqueId(resource, String(sourceAccountId))
  );
}

function collapseRequirementDeny(
  input: InboxV2AuthorizationPlanInput,
  requirement: InboxV2AuthorizationRequirement,
  decision: InboxV2RequirementDeny
): InboxV2AuthorizationDecision {
  if (requirement.visibility === "secondary_hidden") {
    return denyPlan(
      input,
      "secondary_resource_denied",
      "resource.not_found",
      null
    );
  }
  return denyPlan(
    input,
    decision.reason,
    decision.publicErrorCode,
    requirement.id
  );
}

function requirementDeny(
  requirement: InboxV2AuthorizationRequirement,
  reason: InboxV2AuthorizationInternalReason,
  publicErrorCode: InboxV2AuthorizationPublicErrorCode
): Readonly<{
  decision: InboxV2RequirementDeny;
  companionRequirementIds: readonly string[];
}> {
  return Object.freeze({
    decision: Object.freeze({
      outcome: "denied",
      requirementId: requirement.id,
      reason,
      publicErrorCode
    }),
    companionRequirementIds: Object.freeze([])
  });
}

function denyPlan(
  input: InboxV2AuthorizationPlanInput,
  reason: InboxV2AuthorizationInternalReason,
  publicErrorCode: InboxV2AuthorizationPublicErrorCode,
  failedRequirementId: string | null
): InboxV2AuthorizationDecision {
  return Object.freeze({
    outcome: "denied",
    tenantId: input.tenantId,
    evaluatedAt: input.evaluatedAt,
    securityDenialAction: deriveSecurityDenialAction(
      input,
      publicErrorCode,
      failedRequirementId
    ),
    ...deriveSecurityDenialAttribution(input.principal),
    publicErrorCode,
    diagnostics: Object.freeze({ reason, failedRequirementId })
  });
}

function deriveSecurityDenialAttribution(
  principal: InboxV2PolicyPrincipal
): Readonly<{
  securityDenialTenantId: InboxV2TenantId | null;
  securityDenialPrincipalClass:
    | "employee"
    | "trusted_service"
    | "invalid_or_anonymous";
}> {
  if (principal.kind === "employee") {
    return {
      securityDenialTenantId: principal.employee.tenantId,
      securityDenialPrincipalClass: "employee"
    };
  }
  if (principal.kind === "trusted_service") {
    return {
      securityDenialTenantId: principal.tenantId,
      securityDenialPrincipalClass: "trusted_service"
    };
  }
  return {
    securityDenialTenantId: null,
    securityDenialPrincipalClass: "invalid_or_anonymous"
  };
}

const SECURITY_DENIAL_ACTION_BY_PERMISSION = Object.freeze({
  "core:privacy.hold.issue": "privacy.hold.issue",
  "core:privacy.hold.release": "privacy.hold.release",
  "core:privacy.subject_evidence.view": "privacy.subject_evidence.view",
  "core:privacy.tenant_export": "privacy.tenant_export",
  "core:privacy.deletion.preview": "privacy.deletion.preview",
  "core:privacy.deletion.approve": "privacy.deletion.approve",
  "core:privacy.deletion.execute": "privacy.deletion.execute"
} satisfies Readonly<Record<string, InboxV2SecurityDenialAction>>);

const PRIVILEGED_SECURITY_DENIAL_PERMISSIONS = new Set<string>([
  "core:tenant.manage",
  "core:employee.invite",
  "core:employee.profile.manage",
  "core:employee.deactivate",
  "core:roles.define",
  "core:roles.bind",
  "core:direct_grants.manage",
  "core:org_unit.manage",
  "core:team.manage",
  "core:queue.manage",
  "core:conversation.internal.break_glass.issue",
  "core:conversation.internal.break_glass_read"
]);

function deriveSecurityDenialAction(
  input: InboxV2AuthorizationPlanInput,
  publicErrorCode: InboxV2AuthorizationPublicErrorCode,
  failedRequirementId: string | null
): InboxV2SecurityDenialAction {
  if (publicErrorCode === "identity.claim_self_forbidden") {
    return "identity.claim";
  }

  const failedRequirement =
    failedRequirementId === null
      ? undefined
      : input.requirements.find(
          (requirement) => requirement.id === failedRequirementId
        );
  const failedAction =
    failedRequirement === undefined
      ? undefined
      : SECURITY_DENIAL_ACTION_BY_PERMISSION[
          failedRequirement.permissionId as keyof typeof SECURITY_DENIAL_ACTION_BY_PERMISSION
        ];
  if (failedAction !== undefined) return failedAction;

  // Early principal/tenant failures happen before a requirement is evaluated.
  // Preserve an unambiguous sensitive operation, but never let a malformed
  // mixed plan choose a lower-risk lifecycle action.
  const sensitiveActions = new Set(
    input.requirements
      .map(
        (requirement) =>
          SECURITY_DENIAL_ACTION_BY_PERMISSION[
            requirement.permissionId as keyof typeof SECURITY_DENIAL_ACTION_BY_PERMISSION
          ]
      )
      .filter(
        (action): action is NonNullable<typeof action> => action !== undefined
      )
  );
  if (sensitiveActions.size === 1) return [...sensitiveActions][0]!;
  if (sensitiveActions.size > 1) return "authorization.privileged_mutation";

  const representative =
    failedRequirement ??
    input.requirements.find(
      (requirement) => requirement.visibility === "primary"
    );
  const permissionId = representative?.permissionId ?? "";
  if (permissionId.startsWith("core:identity.")) return "identity.claim";
  if (
    /(?:^|\.)(?:view|read|list)$/u.test(permissionId) ||
    permissionId.includes(".view_")
  ) {
    return "resource.read";
  }
  if (PRIVILEGED_SECURITY_DENIAL_PERMISSIONS.has(permissionId)) {
    return "authorization.privileged_mutation";
  }
  return input.requirements.length === 0 ? "resource.read" : "resource.mutate";
}

function deny(
  reason: InboxV2AuthorizationInternalReason,
  publicErrorCode: InboxV2AuthorizationPublicErrorCode
): Readonly<{
  outcome: "denied";
  reason: InboxV2AuthorizationInternalReason;
  publicErrorCode: InboxV2AuthorizationPublicErrorCode;
}> {
  return Object.freeze({ outcome: "denied", reason, publicErrorCode });
}

function guardAllow(
  companionRequirementIds: readonly string[],
  ...boundaries: Array<InboxV2PolicyTimestamp | null>
): GuardResult {
  if (boundaries.some((value) => value !== null && !isTimestamp(value))) {
    return guardDeny("hard_boundary_denied", "permission.denied");
  }
  return Object.freeze({
    outcome: "allowed",
    boundaries: Object.freeze(
      boundaries.filter(
        (value): value is InboxV2PolicyTimestamp => value !== null
      )
    ),
    companionRequirementIds: Object.freeze([...companionRequirementIds])
  });
}

function guardDeny(
  reason: InboxV2AuthorizationInternalReason,
  publicErrorCode: InboxV2AuthorizationPublicErrorCode
): GuardResult {
  return Object.freeze({ outcome: "denied", reason, publicErrorCode });
}

function strongerScopeFailure(
  left: ScopeFailureReason,
  right: ScopeFailureReason
): ScopeFailureReason {
  const weight: Record<ScopeFailureReason, number> = {
    scope_not_matched: 0,
    structural_path_missing: 1,
    canonical_relation_not_matched: 2,
    revision_guard_failed: 3
  };
  return weight[right] > weight[left] ? right : left;
}

function earliestTimestamp(
  values: readonly (InboxV2PolicyTimestamp | null)[]
): InboxV2PolicyTimestamp | null {
  const timestamps = values.filter(
    (value): value is InboxV2PolicyTimestamp =>
      value !== null && isTimestamp(value)
  );
  if (timestamps.length === 0) {
    return null;
  }
  return timestamps.reduce((earliest, current) =>
    Date.parse(current) < Date.parse(earliest) ? current : earliest
  );
}

function futureTimestamp(
  value: InboxV2PolicyTimestamp | null,
  evaluatedAt: InboxV2PolicyTimestamp
): InboxV2PolicyTimestamp | null {
  return value !== null && isStrictlyAfter(value, evaluatedAt) ? value : null;
}

function isTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function isStrictlyAfter(left: string, right: string): boolean {
  return (
    isTimestamp(left) &&
    isTimestamp(right) &&
    Date.parse(left) > Date.parse(right)
  );
}

function isAtOrAfter(left: string, right: string): boolean {
  return (
    isTimestamp(left) &&
    isTimestamp(right) &&
    Date.parse(left) >= Date.parse(right)
  );
}
