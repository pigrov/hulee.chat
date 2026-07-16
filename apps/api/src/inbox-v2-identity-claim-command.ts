import {
  calculateInboxV2CanonicalSha256,
  inboxV2ClientContactIdSchema,
  inboxV2EmployeeIdSchema,
  inboxV2EntityKeySchema,
  inboxV2InternalEntityReferenceSchema,
  inboxV2SourceExternalIdentityIdSchema,
  inboxV2SourceIdentityClaimEvidenceReferenceSchema,
  inboxV2SourceIdentityClaimIdSchema,
  inboxV2SourceIdentityClaimVersionSchema,
  inboxV2TenantIdSchema,
  type InboxV2ClientContactId,
  type InboxV2EmployeeId,
  type InboxV2EntityKey,
  type InboxV2SourceExternalIdentityId,
  type InboxV2SourceIdentityClaim,
  type InboxV2SourceIdentityClaimVersion,
  type InboxV2TenantId
} from "@hulee/contracts";
import {
  CoreError,
  executeInboxV2AuthorizationGate,
  type InboxV2AuthorizationPlanInput,
  type InboxV2SecurityDenialContext,
  type InboxV2SecurityDenialSink
} from "@hulee/core";
import type {
  ApplyInboxV2SourceIdentityClaimTransitionInput,
  ApplyInboxV2SourceIdentityClaimTransitionResult,
  InboxV2AuthorizedCommandCoordinator,
  InboxV2AuthorizedSourceIdentityClaimStateFence,
  InboxV2SourceIdentityClaimRepository,
  WithInboxV2AuthorizedCommandMutationInput,
  InboxV2AuthorizedCommandMutationResult
} from "@hulee/db";

type ClaimEvidenceReference =
  InboxV2SourceIdentityClaim["evidenceReferences"][number];
type AppliedClaimTransition = Extract<
  ApplyInboxV2SourceIdentityClaimTransitionResult,
  { kind: "applied" }
>;

export type InboxV2IdentityClaimEvidenceManifest = Readonly<{
  /** One server-owned authorization resource representing this exact set. */
  resource: InboxV2EntityKey;
  references: readonly ClaimEvidenceReference[];
  digest: string;
}>;

/**
 * Server-loaded state that closes facts which are deliberately absent from
 * the public command. Keeping this discriminated prevents a manual claim,
 * revoke and trusted automatic resolution from borrowing each other's guard.
 */
export type InboxV2PreparedIdentityClaimAuthorizationBinding =
  | Readonly<{
      kind: "manual_claim";
      activeClaimResource: InboxV2EntityKey | null;
      activeTargetResource: InboxV2EntityKey | null;
      expectedClaimVersion: InboxV2SourceIdentityClaimVersion | null;
    }>
  | Readonly<{
      kind: "manual_revoke";
      activeClaimResource: InboxV2EntityKey;
      activeTargetResource: InboxV2EntityKey;
      expectedClaimVersion: InboxV2SourceIdentityClaimVersion;
    }>
  | Readonly<{
      kind: "automatic";
      resolutionDecisionResource: InboxV2EntityKey;
      activeClaimResource: null;
      activeTargetResource: null;
      expectedClaimVersion: null;
    }>;

export type InboxV2ManualEmployeeClaimCommand = Readonly<{
  tenantId: InboxV2TenantId;
  sourceExternalIdentityId: InboxV2SourceExternalIdentityId;
  employeeId: InboxV2EmployeeId;
  expectedVersion: InboxV2SourceIdentityClaimVersion | null;
  evidenceReferences: readonly ClaimEvidenceReference[];
  clientMutationId: string;
}>;

export type InboxV2ManualClientContactClaimCommand = Readonly<{
  tenantId: InboxV2TenantId;
  sourceExternalIdentityId: InboxV2SourceExternalIdentityId;
  clientContactId: InboxV2ClientContactId;
  expectedVersion: InboxV2SourceIdentityClaimVersion | null;
  evidenceReferences: readonly ClaimEvidenceReference[];
  clientMutationId: string;
}>;

export type InboxV2IdentityClaimRevokeCommand = Readonly<{
  tenantId: InboxV2TenantId;
  sourceExternalIdentityId: InboxV2SourceExternalIdentityId;
  expectedVersion: InboxV2SourceIdentityClaimVersion;
  clientMutationId: string;
}>;

export type InboxV2AutomaticIdentityClaimCommand = Readonly<{
  tenantId: InboxV2TenantId;
  sourceExternalIdentityId: InboxV2SourceExternalIdentityId;
  assessmentId: string;
  expectedVersion: InboxV2SourceIdentityClaimVersion | null;
  clientMutationId: string;
}>;

export type InboxV2IdentityClaimCommand =
  | InboxV2ManualEmployeeClaimCommand
  | InboxV2ManualClientContactClaimCommand
  | InboxV2IdentityClaimRevokeCommand
  | InboxV2AutomaticIdentityClaimCommand;

export type InboxV2PreparedIdentityClaimCommand = Readonly<{
  authorizationPlan: InboxV2AuthorizationPlanInput;
  denialContext: InboxV2SecurityDenialContext;
  authorizedMutation: WithInboxV2AuthorizedCommandMutationInput;
  transition: ApplyInboxV2SourceIdentityClaimTransitionInput;
  evidenceManifest: InboxV2IdentityClaimEvidenceManifest | null;
  authorizationBinding: InboxV2PreparedIdentityClaimAuthorizationBinding;
}>;

export type InboxV2IdentityClaimCommandPreparer = Readonly<{
  prepareEmployeeClaim(
    command: InboxV2ManualEmployeeClaimCommand
  ): Promise<InboxV2PreparedIdentityClaimCommand | null>;
  prepareClientContactClaim(
    command: InboxV2ManualClientContactClaimCommand
  ): Promise<InboxV2PreparedIdentityClaimCommand | null>;
  prepareRevoke(
    command: InboxV2IdentityClaimRevokeCommand
  ): Promise<InboxV2PreparedIdentityClaimCommand | null>;
  prepareAutomaticClaim(
    command: InboxV2AutomaticIdentityClaimCommand
  ): Promise<InboxV2PreparedIdentityClaimCommand | null>;
}>;

type AuthorizationMutationFailure = Exclude<
  InboxV2AuthorizedCommandMutationResult<AppliedClaimTransition>,
  { kind: "applied" | "already_applied" }
>;

export type InboxV2IdentityClaimCommandResult =
  | Readonly<{
      outcome: "applied";
      claim: AppliedClaimTransition;
      commit: Extract<
        InboxV2AuthorizedCommandMutationResult<AppliedClaimTransition>,
        { kind: "applied" }
      >["status"];
    }>
  | Readonly<{
      outcome: "already_applied";
      commit: Extract<
        InboxV2AuthorizedCommandMutationResult<AppliedClaimTransition>,
        { kind: "already_applied" }
      >["status"];
    }>
  | Readonly<{
      outcome: "denied";
      errorCode: string;
    }>
  | Readonly<{
      outcome: "not_found";
    }>
  | Readonly<{
      outcome: "claim_rejected";
      rejection: Exclude<
        ApplyInboxV2SourceIdentityClaimTransitionResult,
        { kind: "applied" }
      >;
    }>
  | Readonly<{
      outcome: "authorization_conflict";
      conflict: AuthorizationMutationFailure;
    }>;

export type InboxV2IdentityClaimCommandService = Readonly<{
  claimEmployee(
    command: InboxV2ManualEmployeeClaimCommand
  ): Promise<InboxV2IdentityClaimCommandResult>;
  claimClientContact(
    command: InboxV2ManualClientContactClaimCommand
  ): Promise<InboxV2IdentityClaimCommandResult>;
  revokeClaim(
    command: InboxV2IdentityClaimRevokeCommand
  ): Promise<InboxV2IdentityClaimCommandResult>;
  autoResolve(
    command: InboxV2AutomaticIdentityClaimCommand
  ): Promise<InboxV2IdentityClaimCommandResult>;
}>;

export type InboxV2IdentityClaimCommandServiceOptions = Readonly<{
  preparer: InboxV2IdentityClaimCommandPreparer;
  denialSink: InboxV2SecurityDenialSink;
  coordinator: InboxV2AuthorizedCommandCoordinator;
  repository: Pick<
    InboxV2SourceIdentityClaimRepository,
    "applyTransitionInAuthorizedContext"
  >;
}>;

/**
 * Runtime boundary for identity claims. Public callers never supply an actor,
 * decision, policy authority, authorization plan, claim ID or transition ID.
 * A trusted server loader prepares those facts; this service binds them back
 * to the narrow request, evaluates the complete policy plan, and writes only
 * inside the coordinator's live non-forgeable transaction context.
 */
export function createInboxV2IdentityClaimCommandService(
  options: InboxV2IdentityClaimCommandServiceOptions
): InboxV2IdentityClaimCommandService {
  return Object.freeze({
    claimEmployee(commandInput) {
      const command = normalizeEmployeeCommand(commandInput);
      return executePreparedClaim(options, command, "manual_employee", () =>
        options.preparer.prepareEmployeeClaim(command)
      );
    },
    claimClientContact(commandInput) {
      const command = normalizeClientContactCommand(commandInput);
      return executePreparedClaim(
        options,
        command,
        "manual_client_contact",
        () => options.preparer.prepareClientContactClaim(command)
      );
    },
    revokeClaim(commandInput) {
      const command = normalizeRevokeCommand(commandInput);
      return executePreparedClaim(options, command, "manual_revoke", () =>
        options.preparer.prepareRevoke(command)
      );
    },
    autoResolve(commandInput) {
      const command = normalizeAutomaticCommand(commandInput);
      return executePreparedClaim(options, command, "automatic", () =>
        options.preparer.prepareAutomaticClaim(command)
      );
    }
  });
}

export type InboxV2IdentityClaimIntentKind =
  | "manual_employee"
  | "manual_client_contact"
  | "manual_revoke"
  | "automatic";

async function executePreparedClaim(
  options: InboxV2IdentityClaimCommandServiceOptions,
  command: InboxV2IdentityClaimCommand,
  kind: InboxV2IdentityClaimIntentKind,
  prepare: () => Promise<InboxV2PreparedIdentityClaimCommand | null>
): Promise<InboxV2IdentityClaimCommandResult> {
  const prepared = await prepare();
  if (prepared === null) return { outcome: "not_found" };
  assertPreparedCommandClosure(command, kind, prepared);

  try {
    const gated = await executeInboxV2AuthorizationGate({
      authorizationPlan: prepared.authorizationPlan,
      denialContext: prepared.denialContext,
      denialSink: options.denialSink,
      executeAllowed: () =>
        options.coordinator.withAuthorizedCommandMutation(
          prepared.authorizedMutation,
          async (context) => {
            const result =
              await options.repository.applyTransitionInAuthorizedContext(
                context,
                prepared.transition,
                authorizedStateFenceFor(prepared)
              );
            if (result.kind !== "applied") {
              throw new IdentityClaimMutationRejected(result);
            }
            return { result };
          }
        )
    });

    if (gated.outcome === "denied") {
      return {
        outcome: "denied",
        errorCode: gated.publicDecision.errorCode
      };
    }
    if (gated.value.kind === "applied") {
      return {
        outcome: "applied",
        claim: gated.value.result,
        commit: gated.value.status
      };
    }
    if (gated.value.kind === "already_applied") {
      return { outcome: "already_applied", commit: gated.value.status };
    }
    return { outcome: "authorization_conflict", conflict: gated.value };
  } catch (error) {
    if (error instanceof IdentityClaimMutationRejected) {
      return { outcome: "claim_rejected", rejection: error.rejection };
    }
    throw error;
  }
}

class IdentityClaimMutationRejected extends Error {
  constructor(
    readonly rejection: Exclude<
      ApplyInboxV2SourceIdentityClaimTransitionResult,
      { kind: "applied" }
    >
  ) {
    super(`Identity claim mutation rejected: ${rejection.kind}`);
    this.name = "IdentityClaimMutationRejected";
  }
}

function assertPreparedCommandClosure(
  command: InboxV2IdentityClaimCommand,
  kind: InboxV2IdentityClaimIntentKind,
  prepared: InboxV2PreparedIdentityClaimCommand
): void {
  const transition = prepared.transition;
  const mutation = prepared.authorizedMutation;
  const plan = prepared.authorizationPlan;
  const expectedOperation =
    kind === "manual_employee"
      ? "claim_employee"
      : kind === "manual_client_contact"
        ? "claim_client_contact"
        : kind === "manual_revoke"
          ? "revoke"
          : transition.operation.kind;

  if (
    transition.tenantId !== command.tenantId ||
    transition.sourceExternalIdentityId !== command.sourceExternalIdentityId ||
    transition.expectedVersion !== command.expectedVersion ||
    transition.operation.kind !== expectedOperation ||
    mutation.tenantId !== command.tenantId ||
    mutation.command.clientMutationId !== command.clientMutationId ||
    mutation.command.actor.kind !== plan.currentAuthorization.principal.kind ||
    plan.tenantId !== command.tenantId ||
    plan.currentAuthorization.tenantId !== command.tenantId ||
    mutation.occurredAt !== transition.occurredAt ||
    !samePlanPrincipal(plan, mutation.command.actor) ||
    !sameDecisionActor(transition, mutation.command.actor) ||
    !authorizedMutationClosesAuthorizationPlan(command, kind, prepared)
  ) {
    throw new CoreError("permission.denied");
  }

  if (kind === "manual_employee") {
    if (
      !("employeeId" in command) ||
      transition.operation.kind !== "claim_employee" ||
      transition.operation.employeeId !== command.employeeId ||
      transition.decision.kind !== "manual" ||
      prepared.authorizationBinding.kind !== "manual_claim" ||
      prepared.authorizationBinding.expectedClaimVersion !==
        transition.expectedVersion
    ) {
      throw new CoreError("permission.denied");
    }
  } else if (kind === "manual_client_contact") {
    if (
      !("clientContactId" in command) ||
      transition.operation.kind !== "claim_client_contact" ||
      transition.operation.clientContactId !== command.clientContactId ||
      transition.decision.kind !== "manual" ||
      prepared.authorizationBinding.kind !== "manual_claim" ||
      prepared.authorizationBinding.expectedClaimVersion !==
        transition.expectedVersion
    ) {
      throw new CoreError("permission.denied");
    }
  } else if (kind === "manual_revoke") {
    if (
      transition.operation.kind !== "revoke" ||
      transition.decision.kind !== "manual" ||
      prepared.evidenceManifest !== null ||
      prepared.authorizationBinding.kind !== "manual_revoke" ||
      !planContainsExactIdentityClaimRevokeGuard(
        prepared,
        prepared.authorizationBinding
      )
    ) {
      throw new CoreError("permission.denied");
    }
  } else if (
    transition.operation.kind === "revoke" ||
    transition.decision.kind !== "automatic_policy" ||
    transition.operation.confidence !== "verified" ||
    prepared.authorizationBinding.kind !== "automatic" ||
    transition.expectedVersion !== null
  ) {
    // There is intentionally no runtime `migration` command. Single-admin
    // bootstrap must arrive through an active trusted resolver policy.
    throw new CoreError("permission.denied");
  }

  if (transition.operation.kind !== "revoke") {
    const requestedEvidence =
      "evidenceReferences" in command ? command.evidenceReferences : null;
    const manifest = prepared.evidenceManifest;
    if (
      manifest === null ||
      (requestedEvidence !== null &&
        !sameEvidence(
          requestedEvidence,
          transition.operation.evidenceReferences
        )) ||
      !sameEvidence(
        manifest.references,
        transition.operation.evidenceReferences
      ) ||
      manifest.digest !== evidenceManifestDigest(manifest.references) ||
      !(kind === "automatic"
        ? planContainsExactAutomaticIdentityClaimGuard(
            command,
            prepared,
            manifest.resource,
            prepared.authorizationBinding
          )
        : planContainsExactManualIdentityClaimGuard(
            prepared,
            manifest.resource,
            prepared.authorizationBinding
          ))
    ) {
      throw new CoreError("permission.denied");
    }
  }
}

function planContainsExactManualIdentityClaimGuard(
  prepared: InboxV2PreparedIdentityClaimCommand,
  evidenceResource: InboxV2EntityKey,
  binding: InboxV2PreparedIdentityClaimAuthorizationBinding
): boolean {
  const transition = prepared.transition;
  if (
    transition.operation.kind === "revoke" ||
    binding.kind !== "manual_claim"
  ) {
    return false;
  }
  const expectedPermission =
    transition.operation.kind === "claim_employee"
      ? "core:identity.employee_claim.manage"
      : "core:identity.client_contact_claim.manage";
  const expectedTargetType =
    transition.operation.kind === "claim_employee"
      ? "core:employee"
      : "core:client-contact";
  const expectedTargetId =
    transition.operation.kind === "claim_employee"
      ? transition.operation.employeeId
      : transition.operation.clientContactId;
  const sourceId = String(transition.sourceExternalIdentityId);

  return prepared.authorizationPlan.requirements.some((requirement) => {
    const guard = requirement.guard;
    if (
      requirement.permissionId !== expectedPermission ||
      requirement.resource.entityTypeId !== expectedTargetType ||
      String(requirement.resource.entityId) !== String(expectedTargetId) ||
      guard.profileId !== "core:rbac.guard.identity_evidence" ||
      (guard.operation.kind !== "employee_claim_manage" &&
        guard.operation.kind !== "client_contact_claim_manage")
    ) {
      return false;
    }
    const operation = guard.operation;
    if (
      operation.evidenceResource.tenantId !== evidenceResource.tenantId ||
      operation.evidenceResource.entityTypeId !==
        evidenceResource.entityTypeId ||
      operation.evidenceResource.entityId !== evidenceResource.entityId ||
      operation.sourceIdentityResource.entityTypeId !==
        "core:source-external-identity" ||
      operation.sourceIdentityResource.entityId !== sourceId ||
      operation.newTargetResource.entityTypeId !== expectedTargetType ||
      String(operation.newTargetResource.entityId) !==
        String(expectedTargetId) ||
      !sameEntity(requirement.resource, operation.newTargetResource) ||
      !sameEntity(guard.targetResource, operation.newTargetResource) ||
      !sameEntity(
        operation.evidenceSourceIdentityResource,
        operation.sourceIdentityResource
      ) ||
      !sameEntity(
        operation.evidenceTargetResource,
        operation.newTargetResource
      ) ||
      operation.claimHeadResource.entityTypeId !==
        "core:source-identity-claim-head" ||
      !sameEntity(
        operation.claimHeadSourceIdentityResource,
        operation.sourceIdentityResource
      ) ||
      operation.expectedClaimVersion !== transition.expectedVersion ||
      operation.currentClaimVersion !== transition.expectedVersion
    ) {
      return false;
    }
    const sourceRequirement = prepared.authorizationPlan.requirements.find(
      ({ id }) => id === operation.sourceIdentityRequirementId
    );
    if (
      sourceRequirement?.permissionId !== "core:identity.source_identity.use" ||
      !sameEntity(sourceRequirement.resource, operation.sourceIdentityResource)
    ) {
      return false;
    }
    if (operation.oldTargetResource === null) {
      return (
        operation.oldTargetRequirementId === null &&
        operation.currentClaimTargetResource === null &&
        binding.expectedClaimVersion === transition.expectedVersion &&
        binding.activeClaimResource === null &&
        binding.activeTargetResource === null
      );
    }
    if (
      binding.expectedClaimVersion !== transition.expectedVersion ||
      binding.activeClaimResource === null ||
      binding.activeTargetResource === null ||
      binding.activeClaimResource.entityTypeId !==
        "core:source-identity-claim" ||
      (binding.activeTargetResource.entityTypeId !== "core:employee" &&
        binding.activeTargetResource.entityTypeId !== "core:client-contact") ||
      binding.activeClaimResource.tenantId !== transition.tenantId ||
      binding.activeTargetResource.tenantId !== transition.tenantId ||
      !sameEntity(binding.activeTargetResource, operation.oldTargetResource)
    ) {
      return false;
    }
    const oldTargetRequirement = prepared.authorizationPlan.requirements.find(
      ({ id }) => id === operation.oldTargetRequirementId
    );
    const oldTargetGuard = oldTargetRequirement?.guard;
    return (
      oldTargetRequirement?.permissionId === "core:identity.claim.revoke" &&
      sameEntity(oldTargetRequirement.resource, operation.oldTargetResource) &&
      oldTargetGuard?.profileId === "core:rbac.guard.identity_evidence" &&
      oldTargetGuard.operation.kind === "claim_revoke" &&
      sameEntity(
        oldTargetGuard.operation.activeClaimResource,
        binding.activeClaimResource
      ) &&
      sameEntity(
        oldTargetGuard.operation.sourceIdentityResource,
        operation.sourceIdentityResource
      ) &&
      sameEntity(
        oldTargetGuard.operation.existingTargetResource,
        binding.activeTargetResource
      ) &&
      sameEntity(
        oldTargetGuard.operation.claimTargetResource,
        binding.activeTargetResource
      ) &&
      operation.currentClaimTargetResource !== null &&
      sameEntity(
        operation.currentClaimTargetResource,
        operation.oldTargetResource
      )
    );
  });
}

function planContainsExactIdentityClaimRevokeGuard(
  prepared: InboxV2PreparedIdentityClaimCommand,
  binding: Extract<
    InboxV2PreparedIdentityClaimAuthorizationBinding,
    { kind: "manual_revoke" }
  >
): boolean {
  const transition = prepared.transition;
  if (
    transition.operation.kind !== "revoke" ||
    transition.expectedVersion === null ||
    binding.expectedClaimVersion !== transition.expectedVersion ||
    binding.activeClaimResource.entityTypeId !== "core:source-identity-claim" ||
    (binding.activeTargetResource.entityTypeId !== "core:employee" &&
      binding.activeTargetResource.entityTypeId !== "core:client-contact") ||
    binding.activeClaimResource.tenantId !== transition.tenantId ||
    binding.activeTargetResource.tenantId !== transition.tenantId
  ) {
    return false;
  }
  const sourceResource = sourceIdentityResourceFor(transition);

  return prepared.authorizationPlan.requirements.some((requirement) => {
    const guard = requirement.guard;
    if (
      requirement.permissionId !== "core:identity.claim.revoke" ||
      !sameEntity(requirement.resource, binding.activeTargetResource) ||
      guard.profileId !== "core:rbac.guard.identity_evidence" ||
      guard.operation.kind !== "claim_revoke" ||
      !sameEntity(guard.targetResource, binding.activeTargetResource)
    ) {
      return false;
    }
    const operation = guard.operation;
    if (
      !sameEntity(operation.sourceIdentityResource, sourceResource) ||
      !sameEntity(operation.claimSourceIdentityResource, sourceResource) ||
      !sameEntity(operation.activeClaimResource, binding.activeClaimResource) ||
      !sameEntity(
        operation.existingTargetResource,
        binding.activeTargetResource
      ) ||
      !sameEntity(operation.claimTargetResource, binding.activeTargetResource)
    ) {
      return false;
    }
    const sourceRequirement = prepared.authorizationPlan.requirements.find(
      ({ id }) => id === operation.sourceIdentityRequirementId
    );
    return (
      sourceRequirement?.permissionId === "core:identity.source_identity.use" &&
      sameEntity(sourceRequirement.resource, sourceResource)
    );
  });
}

function planContainsExactAutomaticIdentityClaimGuard(
  command: InboxV2IdentityClaimCommand,
  prepared: InboxV2PreparedIdentityClaimCommand,
  evidenceResource: InboxV2EntityKey,
  binding: InboxV2PreparedIdentityClaimAuthorizationBinding
): boolean {
  const transition = prepared.transition;
  if (
    binding.kind !== "automatic" ||
    !("assessmentId" in command) ||
    transition.operation.kind === "revoke" ||
    transition.decision.kind !== "automatic_policy" ||
    binding.resolutionDecisionResource.entityTypeId !==
      "core:identity-resolution" ||
    String(binding.resolutionDecisionResource.entityId) !==
      command.assessmentId ||
    binding.resolutionDecisionResource.tenantId !== command.tenantId
  ) {
    return false;
  }
  const trustedServiceId = transition.decision.trustedServiceId;
  const sourceResource = sourceIdentityResourceFor(transition);
  const expectedTargetResource =
    transition.operation.kind === "claim_employee"
      ? entityResource(
          transition.tenantId,
          "core:employee",
          transition.operation.employeeId
        )
      : entityResource(
          transition.tenantId,
          "core:client-contact",
          transition.operation.clientContactId
        );

  return prepared.authorizationPlan.requirements.some((requirement) => {
    const guard = requirement.guard;
    if (
      requirement.permissionId !== "core:identity.auto_resolve" ||
      !sameEntity(requirement.resource, binding.resolutionDecisionResource) ||
      guard.profileId !== "core:rbac.guard.identity_evidence" ||
      guard.operation.kind !== "auto_resolve" ||
      !sameEntity(guard.targetResource, binding.resolutionDecisionResource)
    ) {
      return false;
    }
    const operation = guard.operation;
    const expectedTargetKind =
      transition.operation.kind === "claim_employee"
        ? "employee"
        : "client_contact";
    return (
      operation.trustedServiceId === trustedServiceId &&
      operation.manualActorEmployeeId === null &&
      sameEntity(
        operation.resolutionDecisionResource,
        binding.resolutionDecisionResource
      ) &&
      sameEntity(operation.decisionSourceIdentityResource, sourceResource) &&
      sameEntity(operation.sourceIdentityResource, sourceResource) &&
      sameEntity(
        operation.decisionClaimTargetResource,
        expectedTargetResource
      ) &&
      sameEntity(operation.claimTargetResource, expectedTargetResource) &&
      sameEntity(
        operation.evidenceClaimTargetResource,
        expectedTargetResource
      ) &&
      sameEntity(operation.evidenceSourceIdentityResource, sourceResource) &&
      sameEntity(operation.evidenceResource, evidenceResource) &&
      operation.evidenceKind === "verified_scope_correct" &&
      operation.policyState === "approved_active" &&
      operation.policyId === String(transition.policyId) &&
      operation.policyVersion === transition.policyVersion &&
      operation.evidencePolicyId === operation.policyId &&
      operation.evidencePolicyVersion === operation.policyVersion &&
      operation.policyResource.entityTypeId === "core:identity-claim-policy" &&
      String(operation.policyResource.entityId) ===
        String(transition.policyId) &&
      sameEntity(operation.decisionPolicyResource, operation.policyResource) &&
      operation.policyAllowedTargetKind === expectedTargetKind &&
      operation.targetKind === expectedTargetKind &&
      operation.claimHeadResource.entityTypeId ===
        "core:source-identity-claim-head" &&
      sameEntity(operation.claimHeadSourceIdentityResource, sourceResource) &&
      operation.expectedClaimVersion === transition.expectedVersion &&
      operation.currentClaimVersion === transition.expectedVersion &&
      operation.auditTrustedServiceId === trustedServiceId
    );
  });
}

export function calculateInboxV2IdentityClaimIntentDigest(input: {
  kind: InboxV2IdentityClaimIntentKind;
  command: InboxV2IdentityClaimCommand;
  transition: ApplyInboxV2SourceIdentityClaimTransitionInput;
  authorizationBinding: InboxV2PreparedIdentityClaimAuthorizationBinding;
  evidenceManifest: InboxV2IdentityClaimEvidenceManifest | null;
  authorizationPlan: InboxV2AuthorizationPlanInput;
}): string {
  return calculateInboxV2CanonicalSha256({
    protocol: "core:inbox-v2.identity-claim-command-intent@v1",
    kind: input.kind,
    command: input.command,
    transition: input.transition,
    authorizationBinding: input.authorizationBinding,
    evidenceManifest:
      input.evidenceManifest === null
        ? null
        : {
            resource: input.evidenceManifest.resource,
            digest: input.evidenceManifest.digest
          },
    authorization: {
      epoch: input.authorizationPlan.currentAuthorization.authorizationEpoch,
      dependencies: input.authorizationPlan.currentAuthorization.dependencies,
      requirements: [...input.authorizationPlan.requirements]
        .sort((left, right) => compareCanonicalStrings(left.id, right.id))
        .map((requirement) => ({
          id: requirement.id,
          permissionId: requirement.permissionId,
          resource: requirement.resource,
          expectedResourceAccessRevision:
            requirement.expectedResourceAccessRevision
        }))
    }
  });
}

function authorizedMutationClosesAuthorizationPlan(
  command: InboxV2IdentityClaimCommand,
  kind: InboxV2IdentityClaimIntentKind,
  prepared: InboxV2PreparedIdentityClaimCommand
): boolean {
  const plan = prepared.authorizationPlan;
  const mutation = prepared.authorizedMutation;
  const dependencies = plan.currentAuthorization.dependencies;
  const revisions = mutation.revisions;
  const decisions = mutation.records.audit.authorizationDecisionRefs;
  const intentDigest = calculateInboxV2IdentityClaimIntentDigest({
    kind,
    command,
    transition: prepared.transition,
    authorizationBinding: prepared.authorizationBinding,
    evidenceManifest: prepared.evidenceManifest,
    authorizationPlan: plan
  });

  if (
    mutation.command.commandTypeId !== "core:identity.claim" ||
    mutation.command.requestHash !== intentDigest ||
    mutation.command.authorizationEpoch !==
      plan.currentAuthorization.authorizationEpoch ||
    mutation.command.authorizedAt !== plan.evaluatedAt ||
    mutation.records.relationKind !== null ||
    revisions.expectedTenantRbacRevision !== dependencies.tenantRbacRevision ||
    revisions.expectedSharedAccessRevision !==
      dependencies.sharedAccessRevision ||
    revisions.advanceTenantRbac ||
    revisions.advanceSharedAccess ||
    revisions.resources.length !== 0 ||
    decisions.length !== plan.requirements.length ||
    decisions.length === 0 ||
    !identityClaimAuditClosesIntent(kind, prepared, intentDigest)
  ) {
    return false;
  }

  if (mutation.command.actor.kind === "employee") {
    if (
      revisions.employees.length !== 1 ||
      revisions.employees[0]?.employeeId !==
        mutation.command.actor.employeeId ||
      revisions.employees[0]?.expectedEmployeeAccessRevision !==
        dependencies.employeeAccessRevision ||
      revisions.employees[0]?.expectedEmployeeInboxRelationRevision !==
        dependencies.employeeInboxRelationRevision ||
      revisions.employees[0]?.advanceEmployeeAccess ||
      revisions.employees[0]?.advanceEmployeeInboxRelation
    ) {
      return false;
    }
  } else if (revisions.employees.length !== 0) {
    return false;
  }

  const requirementResources = new Map<string, string>();
  for (const requirement of plan.requirements) {
    const key = entityKey(requirement.resource);
    const current = requirementResources.get(key);
    if (
      (current !== undefined &&
        current !== requirement.resourceAccessRevision) ||
      requirement.resourceAccessRevision !==
        requirement.expectedResourceAccessRevision
    ) {
      return false;
    }
    requirementResources.set(key, requirement.resourceAccessRevision);
  }
  if (
    dependencies.resourceDependencies.length !== requirementResources.size ||
    dependencies.resourceDependencies.some(
      ({ resource, accessRevision }) =>
        requirementResources.get(entityKey(resource)) !== accessRevision
    )
  ) {
    return false;
  }

  const remainingRequirements = [...plan.requirements];
  let commandDecisionClosesPrimaryRequirement = false;
  let previousDecisionId: string | null = null;
  const seenDecisionIds = new Set<string>();
  for (const decision of decisions) {
    const decisionId = String(decision.id);
    if (
      seenDecisionIds.has(decisionId) ||
      (previousDecisionId !== null && decisionId <= previousDecisionId) ||
      decision.tenantId !== plan.tenantId ||
      decision.authorizationEpoch !==
        plan.currentAuthorization.authorizationEpoch ||
      decision.outcome !== "allowed" ||
      decision.decidedAt !== plan.evaluatedAt ||
      !decisionPrincipalMatchesMutationActor(
        decision.principal,
        mutation.command.actor
      )
    ) {
      return false;
    }
    seenDecisionIds.add(decisionId);
    previousDecisionId = decisionId;
    const requirementIndex = remainingRequirements.findIndex(
      (requirement) =>
        requirement.permissionId === decision.permissionId &&
        sameEntity(requirement.resource, decision.resource) &&
        requirement.resourceAccessRevision === decision.resourceAccessRevision
    );
    if (requirementIndex === -1) return false;
    const [requirement] = remainingRequirements.splice(requirementIndex, 1);
    if (
      decision.id === mutation.command.authorizationDecisionId &&
      requirement?.visibility === "primary"
    ) {
      commandDecisionClosesPrimaryRequirement = true;
    }
  }

  const expectedPermissionIds = [
    ...new Set(
      plan.requirements.map(({ permissionId }) => String(permissionId))
    )
  ].sort(compareCanonicalStrings);
  const actualPermissionIds =
    mutation.records.audit.matchedPermissionIds.map(String);
  return (
    remainingRequirements.length === 0 &&
    commandDecisionClosesPrimaryRequirement &&
    sameStringArray(actualPermissionIds, expectedPermissionIds)
  );
}

function identityClaimAuditClosesIntent(
  kind: InboxV2IdentityClaimIntentKind,
  prepared: InboxV2PreparedIdentityClaimCommand,
  intentDigest: string
): boolean {
  const transition = prepared.transition;
  const audit = prepared.authorizedMutation.records.audit;
  const expectedTarget = inboxV2InternalEntityReferenceSchema.parse({
    tenantId: transition.tenantId,
    entityTypeId: "core:identity-claim-intent",
    entityId: `internal-ref:${intentDigest.slice("sha256:".length)}`
  });
  const expectedActionId =
    kind === "manual_employee"
      ? "core:identity.claim.employee"
      : kind === "manual_client_contact"
        ? "core:identity.claim.client_contact"
        : kind === "manual_revoke"
          ? "core:identity.claim.revoke"
          : "core:identity.claim.auto_resolve";
  return (
    audit.actionId === expectedActionId &&
    audit.target.tenantId === expectedTarget.tenantId &&
    audit.target.entityTypeId === expectedTarget.entityTypeId &&
    audit.target.entityId === expectedTarget.entityId &&
    audit.reasonCodeId === transition.reasonCodeId &&
    audit.policyVersion === transition.policyVersion &&
    audit.occurredAt === transition.occurredAt &&
    audit.recordedAt === transition.occurredAt
  );
}

function authorizedStateFenceFor(
  prepared: InboxV2PreparedIdentityClaimCommand
): InboxV2AuthorizedSourceIdentityClaimStateFence {
  const binding = prepared.authorizationBinding;
  const expectedActiveClaim =
    binding.activeClaimResource === null ||
    binding.activeTargetResource === null
      ? null
      : {
          claimId: inboxV2SourceIdentityClaimIdSchema.parse(
            binding.activeClaimResource.entityId
          ),
          target:
            binding.activeTargetResource.entityTypeId === "core:employee"
              ? {
                  kind: "employee" as const,
                  employeeId: inboxV2EmployeeIdSchema.parse(
                    binding.activeTargetResource.entityId
                  )
                }
              : {
                  kind: "client_contact" as const,
                  clientContactId: inboxV2ClientContactIdSchema.parse(
                    binding.activeTargetResource.entityId
                  )
                }
        };
  return Object.freeze({
    authorizationDecisionId:
      prepared.authorizedMutation.command.authorizationDecisionId,
    expectedActiveClaim
  });
}

function decisionPrincipalMatchesMutationActor(
  principal: WithInboxV2AuthorizedCommandMutationInput["records"]["audit"]["authorizationDecisionRefs"][number]["principal"],
  actor: WithInboxV2AuthorizedCommandMutationInput["command"]["actor"]
): boolean {
  return actor.kind === "employee"
    ? principal.kind === "employee" &&
        principal.employee.id === actor.employeeId
    : principal.kind === "trusted_service" &&
        principal.trustedServiceId === actor.trustedServiceId;
}

function entityKey(value: InboxV2EntityKey): string {
  return `${value.tenantId}\u0000${value.entityTypeId}\u0000${value.entityId}`;
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

function compareCanonicalStrings(left: string, right: string): -1 | 0 | 1 {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sourceIdentityResourceFor(
  transition: ApplyInboxV2SourceIdentityClaimTransitionInput
): InboxV2EntityKey {
  return entityResource(
    transition.tenantId,
    "core:source-external-identity",
    transition.sourceExternalIdentityId
  );
}

function entityResource(
  tenantId: InboxV2TenantId,
  entityTypeId: string,
  entityId: string
): InboxV2EntityKey {
  return inboxV2EntityKeySchema.parse({ tenantId, entityTypeId, entityId });
}

function samePlanPrincipal(
  plan: InboxV2AuthorizationPlanInput,
  actor: WithInboxV2AuthorizedCommandMutationInput["command"]["actor"]
): boolean {
  if (actor.kind === "employee") {
    return (
      plan.principal.kind === "employee" &&
      plan.principal.employee.id === actor.employeeId &&
      plan.currentAuthorization.principal.kind === "employee" &&
      plan.currentAuthorization.principal.employeeId === actor.employeeId
    );
  }
  return (
    plan.principal.kind === "trusted_service" &&
    plan.principal.trustedServiceId === actor.trustedServiceId &&
    plan.currentAuthorization.principal.kind === "trusted_service" &&
    plan.currentAuthorization.principal.trustedServiceId ===
      actor.trustedServiceId
  );
}

function sameDecisionActor(
  transition: ApplyInboxV2SourceIdentityClaimTransitionInput,
  actor: WithInboxV2AuthorizedCommandMutationInput["command"]["actor"]
): boolean {
  if (transition.decision.kind === "manual") {
    return (
      actor.kind === "employee" &&
      transition.decision.actorEmployee.id === actor.employeeId
    );
  }
  if (transition.decision.kind === "automatic_policy") {
    return (
      actor.kind === "trusted_service" &&
      transition.decision.trustedServiceId === actor.trustedServiceId
    );
  }
  return false;
}

function evidenceManifestDigest(
  references: readonly ClaimEvidenceReference[]
): string {
  return calculateInboxV2CanonicalSha256({
    protocol: "core:inbox-v2.identity-claim-evidence-set@v1",
    references
  });
}

function sameEvidence(
  left: readonly ClaimEvidenceReference[],
  right: readonly ClaimEvidenceReference[]
): boolean {
  if (left.length !== right.length || left.length === 0) return false;
  const seen = new Set<string>();
  for (let index = 0; index < left.length; index += 1) {
    const leftReference =
      inboxV2SourceIdentityClaimEvidenceReferenceSchema.parse(left[index]);
    const rightReference =
      inboxV2SourceIdentityClaimEvidenceReferenceSchema.parse(right[index]);
    const leftDigest = calculateInboxV2CanonicalSha256(leftReference);
    if (
      leftDigest !== calculateInboxV2CanonicalSha256(rightReference) ||
      seen.has(leftDigest)
    ) {
      return false;
    }
    seen.add(leftDigest);
  }
  return true;
}

function sameEntity(left: InboxV2EntityKey, right: InboxV2EntityKey): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.entityTypeId === right.entityTypeId &&
    left.entityId === right.entityId
  );
}

function normalizeEmployeeCommand(
  input: InboxV2ManualEmployeeClaimCommand
): InboxV2ManualEmployeeClaimCommand {
  return Object.freeze({
    tenantId: inboxV2TenantIdSchema.parse(input.tenantId),
    sourceExternalIdentityId: inboxV2SourceExternalIdentityIdSchema.parse(
      input.sourceExternalIdentityId
    ),
    employeeId: inboxV2EmployeeIdSchema.parse(input.employeeId),
    expectedVersion: parseNullableVersion(input.expectedVersion),
    evidenceReferences: normalizeEvidence(input.evidenceReferences),
    clientMutationId: nonEmpty(input.clientMutationId, "clientMutationId")
  });
}

function normalizeClientContactCommand(
  input: InboxV2ManualClientContactClaimCommand
): InboxV2ManualClientContactClaimCommand {
  return Object.freeze({
    tenantId: inboxV2TenantIdSchema.parse(input.tenantId),
    sourceExternalIdentityId: inboxV2SourceExternalIdentityIdSchema.parse(
      input.sourceExternalIdentityId
    ),
    clientContactId: inboxV2ClientContactIdSchema.parse(input.clientContactId),
    expectedVersion: parseNullableVersion(input.expectedVersion),
    evidenceReferences: normalizeEvidence(input.evidenceReferences),
    clientMutationId: nonEmpty(input.clientMutationId, "clientMutationId")
  });
}

function normalizeRevokeCommand(
  input: InboxV2IdentityClaimRevokeCommand
): InboxV2IdentityClaimRevokeCommand {
  return Object.freeze({
    tenantId: inboxV2TenantIdSchema.parse(input.tenantId),
    sourceExternalIdentityId: inboxV2SourceExternalIdentityIdSchema.parse(
      input.sourceExternalIdentityId
    ),
    expectedVersion: inboxV2SourceIdentityClaimVersionSchema.parse(
      input.expectedVersion
    ),
    clientMutationId: nonEmpty(input.clientMutationId, "clientMutationId")
  });
}

function normalizeAutomaticCommand(
  input: InboxV2AutomaticIdentityClaimCommand
): InboxV2AutomaticIdentityClaimCommand {
  return Object.freeze({
    tenantId: inboxV2TenantIdSchema.parse(input.tenantId),
    sourceExternalIdentityId: inboxV2SourceExternalIdentityIdSchema.parse(
      input.sourceExternalIdentityId
    ),
    assessmentId: nonEmpty(input.assessmentId, "assessmentId"),
    expectedVersion: parseNullableVersion(input.expectedVersion),
    clientMutationId: nonEmpty(input.clientMutationId, "clientMutationId")
  });
}

function parseNullableVersion(
  value: InboxV2SourceIdentityClaimVersion | null
): InboxV2SourceIdentityClaimVersion | null {
  return value === null
    ? null
    : inboxV2SourceIdentityClaimVersionSchema.parse(value);
}

function normalizeEvidence(
  values: readonly ClaimEvidenceReference[]
): readonly ClaimEvidenceReference[] {
  if (values.length === 0 || values.length > 50) {
    throw new CoreError("validation.failed");
  }
  return Object.freeze(
    values.map((value) =>
      Object.freeze(
        inboxV2SourceIdentityClaimEvidenceReferenceSchema.parse(value)
      )
    )
  );
}

function nonEmpty(value: string, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    throw new CoreError("validation.failed", `${field} is invalid.`);
  }
  return value;
}

export function createInboxV2IdentityClaimEvidenceManifest(input: {
  resource: InboxV2EntityKey;
  references: readonly ClaimEvidenceReference[];
}): InboxV2IdentityClaimEvidenceManifest {
  const references = normalizeEvidence(input.references);
  return Object.freeze({
    resource: inboxV2EntityKeySchema.parse(input.resource),
    references,
    digest: evidenceManifestDigest(references)
  });
}
