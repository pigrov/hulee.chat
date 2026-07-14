import type {
  InboxV2ClientId,
  InboxV2ConversationId,
  InboxV2EmployeeId,
  InboxV2TenantId
} from "@hulee/contracts";

import type {
  InboxV2AuthorizationPlanInput,
  InboxV2PermissionScope,
  InboxV2PolicyGuardEvidence,
  InboxV2PolicyPrincipal,
  InboxV2PublicAuthorizationDecision
} from "./index";
import { exactClientBindingPathEvidence } from "./inbox-v2-authorization-policy.client-path.test-support";

declare const input: InboxV2AuthorizationPlanInput;
declare const tenantId: InboxV2TenantId;
declare const employeeId: InboxV2EmployeeId;
declare const clientId: InboxV2ClientId;
declare const conversationId: InboxV2ConversationId;
declare const publicDecision: InboxV2PublicAuthorizationDecision;

// @ts-expect-error Internal diagnostics never cross the public decision boundary.
const _publicDiagnostics = publicDecision.diagnostics;
// @ts-expect-error Failed requirement IDs never cross the public boundary.
const _publicFailedRequirementId = publicDecision.failedRequirementId;
// @ts-expect-error Tenant/resource identifiers are absent from public decisions.
const _publicTenantId = publicDecision.tenantId;

const _capabilityCannotBecomeInput: InboxV2AuthorizationPlanInput = {
  ...input,
  // @ts-expect-error Capabilities are derived output, never policy authority.
  capabilities: []
};

const _providerRosterCannotBecomePrincipal: InboxV2PolicyPrincipal = {
  // @ts-expect-error Provider membership is evidence, not an Hulee principal.
  kind: "provider_member",
  tenantId,
  providerMemberId: "provider-member-1"
};

const _watcherCannotBecomeScope: InboxV2PermissionScope = {
  // @ts-expect-error Watchers affect notification eligibility, never access.
  type: "watcher",
  tenantId
};

const _providerAdminCannotBecomeScope: InboxV2PermissionScope = {
  // @ts-expect-error Provider administration is not a canonical Hulee scope.
  type: "provider_admin",
  tenantId
};

const _clientTargetKeepsItsBrandedId: InboxV2PolicyGuardEvidence = {
  profileId: "core:rbac.guard.client_context",
  target: {
    kind: "client",
    // @ts-expect-error Conversation IDs cannot substitute for Client IDs.
    clientId: conversationId
  },
  accessPath: "exact_client_binding",
  pathEvidence: exactClientBindingPathEvidence({
    targetResource: input.requirements[0]!.resource,
    clientResource: input.requirements[0]!.resource,
    authorityResource: input.requirements[0]!.resource,
    suffix: "type-client-id"
  }),
  contextualRequirementIds: [],
  linkedClientRequirementIds: []
};

const _privacyPolicyCannotRequestContentAuthority: InboxV2PolicyGuardEvidence =
  {
    profileId: "core:rbac.guard.privacy_policy_revision",
    targetResource: input.requirements[0]!.resource,
    policyId: "policy-1",
    governanceContextId: "governance-context-1",
    governanceContextResource: input.requirements[0]!.resource,
    expectedGovernanceRevision: "1",
    currentGovernanceRevision: "1",
    expectedPolicyRevision: "1",
    currentPolicyRevision: "1",
    phase: "view",
    actingEmployeeId: employeeId,
    requesterEmployeeId: employeeId,
    approverEmployeeId: null,
    // @ts-expect-error Policy management never implies content authority.
    contentAuthorityRequested: true
  };

const _clientTarget: InboxV2PolicyGuardEvidence = {
  profileId: "core:rbac.guard.client_context",
  target: { kind: "client", clientId },
  accessPath: "exact_client_binding",
  pathEvidence: exactClientBindingPathEvidence({
    targetResource: input.requirements[0]!.resource,
    clientResource: input.requirements[0]!.resource,
    authorityResource: input.requirements[0]!.resource,
    suffix: "type-client"
  }),
  contextualRequirementIds: [],
  linkedClientRequirementIds: []
};

void [
  _capabilityCannotBecomeInput,
  _providerRosterCannotBecomePrincipal,
  _watcherCannotBecomeScope,
  _providerAdminCannotBecomeScope,
  _publicDiagnostics,
  _publicFailedRequirementId,
  _publicTenantId,
  _clientTargetKeepsItsBrandedId,
  _privacyPolicyCannotRequestContentAuthority,
  _clientTarget
];
