import {
  calculateInboxV2CanonicalSha256,
  calculateInboxV2DestructiveCheckpointExecutionFenceHash,
  defineInboxV2DestructiveCheckpointGuardRepository,
  inboxV2ClaimDestructiveCheckpointInputSchema,
  inboxV2ClaimDestructiveCheckpointResultSchema,
  inboxV2DeletionExecutionFenceSchema,
  inboxV2DestructiveCheckpointControlSetSchema,
  inboxV2DestructiveCheckpointExecutionHandlerId,
  inboxV2DestructiveCheckpointLeaseSchema,
  inboxV2PolicyActivationAuthoritySchema,
  type InboxV2ClaimDestructiveCheckpointInput,
  type InboxV2ClaimDestructiveCheckpointResult,
  type InboxV2DestructiveCheckpointControlSet,
  type InboxV2DestructiveCheckpointGuardRepository,
  type InboxV2ObservedDestructiveCheckpoint,
  type InboxV2PolicyActivationAuthority
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import { buildInboxV2AdvisoryXactLockSql } from "./sql-inbox-v2-advisory-lock";
import type { RawSqlExecutor } from "./sql-outbox-repository";

export type InboxV2DestructiveCheckpointGuardTransactionExecutor =
  RawSqlExecutor & {
    transaction<TResult>(
      work: (transaction: RawSqlExecutor) => Promise<TResult>
    ): Promise<TResult>;
  };

type GuardSnapshotRow = {
  plan_cause: unknown;
  plan_hash: unknown;
  earliest_execution_at: unknown;
  run_state: unknown;
  stage_one_state: unknown;
  checked_at: unknown;
  requirement_hash: unknown;
  surface: unknown;
  registry_id: unknown;
  registry_revision: unknown;
  plan_registry_composition_hash: unknown;
  storage_root_id: unknown;
  data_class_id: unknown;
  root_kind: unknown;
  boundary: unknown;
  copy_role: unknown;
  root_record_id: unknown;
  entity_type_id: unknown;
  entity_id: unknown;
  expected_entity_revision: unknown;
  expected_lineage_revision: unknown;
  delete_handler_id: unknown;
  verification_handler_id: unknown;
  expiry_ledger_handler_id: unknown;
  external_delete_handler_id: unknown;
  plan_governance_context_id: unknown;
  plan_governance_context_version: unknown;
  plan_governance_context_hash: unknown;
  plan_policy_id: unknown;
  plan_policy_version: unknown;
  plan_policy_hash: unknown;
  plan_activation_id: unknown;
  plan_activation_revision: unknown;
  plan_activation_hash: unknown;
  plan_legal_hold_set_revision: unknown;
  plan_restriction_set_revision: unknown;
  current_registry_composition_hash: unknown;
  current_governance_context_id: unknown;
  current_governance_context_version: unknown;
  current_governance_context_hash: unknown;
  current_policy_id: unknown;
  current_policy_version: unknown;
  current_policy_hash: unknown;
  current_activation_id: unknown;
  current_activation_revision: unknown;
  current_activation_hash: unknown;
  current_legal_hold_set_revision: unknown;
  current_restriction_set_revision: unknown;
};

type GuardPresenceRow = {
  plan_found: unknown;
  run_found: unknown;
  checkpoint_found: unknown;
  scope_root_found: unknown;
  authority_found: unknown;
  control_set_found: unknown;
};

type LegalHoldRow = {
  hold_id: unknown;
  hold_revision: unknown;
  review_at: unknown;
};

type RestrictionRow = {
  restriction_id: unknown;
  restriction_revision: unknown;
};

type BooleanRow = { found: unknown };

type TerminalExportRow = { expires_at: unknown };

type LeaseRow = {
  tenant_id: unknown;
  run_id: unknown;
  run_revision: unknown;
  plan_id: unknown;
  plan_revision: unknown;
  checkpoint_id: unknown;
  requirement_hash: unknown;
  claim_revision: unknown;
  state: unknown;
  execution_fence_hash: unknown;
  surface: unknown;
  registry_id: unknown;
  registry_revision: unknown;
  registry_composition_hash: unknown;
  storage_root_id: unknown;
  data_class_id: unknown;
  root_record_id: unknown;
  entity_type_id: unknown;
  entity_id: unknown;
  execution_handler_id: unknown;
  expected_entity_revision: unknown;
  expected_lineage_revision: unknown;
  governance_context_id: unknown;
  governance_context_version: unknown;
  governance_context_hash: unknown;
  policy_id: unknown;
  policy_version: unknown;
  policy_hash: unknown;
  activation_id: unknown;
  activation_revision: unknown;
  activation_hash: unknown;
  legal_hold_set_revision: unknown;
  restriction_set_revision: unknown;
  authorization_decision_id: unknown;
  authorization_epoch: unknown;
  authorization_principal_kind: unknown;
  authorization_principal_key: unknown;
  authorization_permission_id: unknown;
  authorization_resource_scope_id: unknown;
  authorization_resource_entity_type_id: unknown;
  authorization_resource_entity_id: unknown;
  authorization_resource_access_revision: unknown;
  authorization_decision_revision: unknown;
  authorization_decision_hash: unknown;
  authorization_outcome: unknown;
  authorization_decided_at: unknown;
  authorization_not_after: unknown;
  claimed_at: unknown;
  lease_expires_at: unknown;
  completed_at: unknown;
  updated_at: unknown;
};

type GuardSnapshot = {
  planCause:
    | "provider_message_delete"
    | "employee_ui_delete"
    | "retention_expiry"
    | "privacy_erasure"
    | "tenant_offboarding"
    | "administrative_policy_purge";
  planHash: string;
  earliestExecutionAt: string;
  runState: string;
  stageOneState: string;
  checkedAt: string;
  checkpoint: {
    requirementHash: string;
    surface: string;
    registryId: string;
    registryRevision: string;
    registryCompositionHash: string;
    storageRootId: string;
    dataClassId: string;
    rootKind: string;
    boundary: string;
    copyRole: string;
    rootRecordId: string;
    entityTypeId: string;
    entityId: string;
    expectedEntityRevision: string;
    expectedLineageRevision: string;
    deleteHandlerId: string | null;
    verificationHandlerId: string | null;
    expiryLedgerHandlerId: string | null;
    externalDeleteHandlerId: string | null;
  };
  planAuthority: InboxV2PolicyActivationAuthority;
  currentAuthority: InboxV2PolicyActivationAuthority;
  planControlSet: InboxV2DestructiveCheckpointControlSet;
  currentControlSet: InboxV2DestructiveCheckpointControlSet;
};

type NormalizedLeaseRow = {
  tenantId: string;
  runId: string;
  runRevision: string;
  planId: string;
  planRevision: string;
  checkpointId: string;
  requirementHash: string;
  claimRevision: string;
  state: "claimed" | "completed" | "released" | "expired";
  executionFenceHash: string;
  surface: string;
  registryId: string;
  registryRevision: string;
  registryCompositionHash: string;
  storageRootId: string;
  dataClassId: string;
  rootRecordId: string;
  entityTypeId: string;
  entityId: string;
  executionHandlerId: string;
  expectedEntityRevision: string;
  expectedLineageRevision: string;
  governanceContextId: string;
  governanceContextVersion: string;
  governanceContextHash: string;
  policyId: string;
  policyVersion: string;
  policyHash: string;
  activationId: string;
  activationRevision: string;
  activationHash: string;
  legalHoldSetRevision: string;
  restrictionSetRevision: string;
  authorizationDecisionId: string;
  authorizationEpoch: string;
  authorizationPrincipalKind: "employee" | "trusted_service";
  authorizationPrincipalKey: string;
  authorizationPermissionId: string;
  authorizationResourceScopeId: string;
  authorizationResourceEntityTypeId: string;
  authorizationResourceEntityId: string;
  authorizationResourceAccessRevision: string;
  authorizationDecisionRevision: string;
  authorizationDecisionHash: string;
  authorizationOutcome: string;
  authorizationDecidedAt: string;
  authorizationNotAfter: string;
  claimedAt: string;
  leaseExpiresAt: string;
};

/**
 * Claims a short-lived, opaque execution capability immediately before one
 * destructive handler call. Every decision and lease mutation is serialized
 * in one transaction under a tenant/checkpoint advisory lock.
 */
export function createSqlInboxV2DestructiveCheckpointGuardRepository(
  executor: InboxV2DestructiveCheckpointGuardTransactionExecutor | HuleeDatabase
): InboxV2DestructiveCheckpointGuardRepository {
  const transactionExecutor =
    executor as unknown as InboxV2DestructiveCheckpointGuardTransactionExecutor;

  return defineInboxV2DestructiveCheckpointGuardRepository({
    async claim(input) {
      const claim = inboxV2ClaimDestructiveCheckpointInputSchema.parse(input);
      try {
        const result = await transactionExecutor.transaction<unknown>(
          async (transaction) => {
            await transaction.execute(
              buildLockInboxV2DestructiveCheckpointSql(claim)
            );

            const snapshot = await loadGuardSnapshot(transaction, claim);
            if (snapshot === null) {
              return classifyMissingGuardSnapshot(
                await loadGuardPresence(transaction, claim)
              );
            }

            const checkpointConflict = firstCheckpointConflict(snapshot, claim);
            if (checkpointConflict !== null) {
              return {
                outcome: "checkpoint_conflict",
                facet: checkpointConflict
              };
            }
            if (
              !sameAuthority(
                snapshot.currentAuthority,
                claim.expectedAuthority
              ) ||
              !sameAuthority(snapshot.planAuthority, claim.expectedAuthority)
            ) {
              return {
                outcome: "policy_conflict",
                current: snapshot.currentAuthority
              };
            }
            if (
              !sameControlSet(
                snapshot.currentControlSet,
                claim.expectedControlSet
              ) ||
              !sameControlSet(snapshot.planControlSet, claim.expectedControlSet)
            ) {
              return {
                outcome: "control_set_conflict",
                current: snapshot.currentControlSet
              };
            }
            if (snapshot.runState === "terminal") {
              return { outcome: "run_not_executable", reason: "terminal" };
            }
            if (snapshot.stageOneState !== "content_unavailable") {
              return {
                outcome: "run_not_executable",
                reason: "stage_one_pending"
              };
            }
            if (
              Date.parse(snapshot.checkedAt) <
              Date.parse(snapshot.earliestExecutionAt)
            ) {
              return { outcome: "run_not_executable", reason: "not_before" };
            }
            const terminalExportExpiresAt =
              snapshot.planCause === "tenant_offboarding"
                ? await loadCurrentTerminalExport(
                    transaction,
                    claim,
                    snapshot.checkedAt
                  )
                : null;
            if (
              snapshot.planCause === "tenant_offboarding" &&
              terminalExportExpiresAt === null
            ) {
              return {
                outcome: "run_not_executable",
                reason: "terminal_export_not_current"
              };
            }
            if (
              Date.parse(snapshot.checkedAt) <
              Date.parse(claim.executionAuthorization.decidedAt)
            ) {
              return {
                outcome: "authorization_conflict",
                reason: "not_yet_valid"
              };
            }
            if (
              Date.parse(snapshot.checkedAt) >=
              Date.parse(claim.executionAuthorization.notAfter)
            ) {
              return { outcome: "authorization_conflict", reason: "expired" };
            }

            const exactHold = await loadExactLegalHold(
              transaction,
              claim,
              snapshot
            );
            if (exactHold !== null) {
              return {
                outcome: "blocked_by_legal_hold",
                hold: {
                  tenantId: claim.tenantId,
                  holdId: exactHold.holdId,
                  revision: exactHold.revision
                },
                reviewAt: exactHold.reviewAt
              };
            }
            if (
              await loadProspectiveControlExists(
                transaction,
                buildFindInboxV2ProspectiveLegalHoldSql(claim)
              )
            ) {
              return { outcome: "scope_ambiguous", controlKind: "legal_hold" };
            }

            const restrictions = await loadExactRestrictions(
              transaction,
              claim,
              snapshot
            );
            if (
              await loadProspectiveControlExists(
                transaction,
                buildFindInboxV2ProspectiveRestrictionSql(claim)
              )
            ) {
              return {
                outcome: "scope_ambiguous",
                controlKind: "processing_restriction"
              };
            }

            const executionFenceHash =
              calculateInboxV2DestructiveCheckpointExecutionFenceHash(
                claim.leaseToken
              );
            const existing = await loadLease(transaction, claim);
            const activeResult = classifyActiveLease({
              row: existing,
              claim,
              snapshot,
              executionFenceHash,
              restrictions
            });
            if (activeResult !== null) return activeResult;

            const leaseExpiresAt = new Date(
              Math.min(
                Date.parse(snapshot.checkedAt) +
                  claim.leaseDurationSeconds * 1_000,
                Date.parse(claim.executionAuthorization.notAfter),
                terminalExportExpiresAt === null
                  ? Number.POSITIVE_INFINITY
                  : Date.parse(terminalExportExpiresAt)
              )
            ).toISOString();
            if (existing === null) {
              const inserted = await transaction.execute<LeaseRow>(
                buildInsertInboxV2DestructiveCheckpointLeaseSql({
                  claim,
                  snapshot,
                  executionFenceHash,
                  leaseExpiresAt
                })
              );
              if (inserted.rows.length === 1) {
                return grantedLeaseResult({
                  outcome: "granted",
                  row: inserted.rows[0]!,
                  claim,
                  snapshot,
                  restrictions
                });
              }
              const winner = await loadLease(transaction, claim);
              if (winner === null) return { outcome: "lease_token_conflict" };
              return (
                classifyActiveLease({
                  row: winner,
                  claim,
                  snapshot,
                  executionFenceHash,
                  restrictions
                }) ?? leaseConflictResult(winner)
              );
            }

            const takenOver = await transaction.execute<LeaseRow>(
              buildTakeOverInboxV2DestructiveCheckpointLeaseSql({
                claim,
                snapshot,
                previous: existing,
                executionFenceHash,
                leaseExpiresAt
              })
            );
            if (takenOver.rows.length === 1) {
              return grantedLeaseResult({
                outcome: "granted",
                row: takenOver.rows[0]!,
                claim,
                snapshot,
                restrictions
              });
            }
            const winner = await loadLease(transaction, claim);
            return winner === null
              ? { outcome: "lease_token_conflict" }
              : (classifyActiveLease({
                  row: winner,
                  claim,
                  snapshot,
                  executionFenceHash,
                  restrictions
                }) ?? leaseConflictResult(winner));
          }
        );
        return inboxV2ClaimDestructiveCheckpointResultSchema.parse(result);
      } catch (error) {
        if (isUniqueViolation(error)) {
          return { outcome: "lease_token_conflict" };
        }
        throw error;
      }
    }
  });
}

export function buildLockInboxV2DestructiveCheckpointSql(
  input: InboxV2ClaimDestructiveCheckpointInput
): SQL {
  return buildInboxV2AdvisoryXactLockSql([
    input.tenantId,
    input.run.runId,
    input.run.revision,
    input.checkpoint.checkpointId
  ]);
}

export function buildFindInboxV2DestructiveCheckpointGuardSql(
  input: InboxV2ClaimDestructiveCheckpointInput
): SQL {
  return sql`
    select plan.plan_hash,
           plan.cause as plan_cause,
           plan.earliest_execution_at,
           run_row.state as run_state,
           run_row.stage_one_state,
           clock_timestamp() as checked_at,
           requirement.requirement_hash,
           requirement.surface,
           requirement.registry_id,
           requirement.registry_revision::text as registry_revision,
           plan.registry_composition_hash as plan_registry_composition_hash,
           requirement.storage_root_id,
           requirement.data_class_id,
           requirement.root_kind,
           requirement.boundary,
           requirement.copy_role,
           requirement.root_record_id,
           requirement.entity_type_id,
           requirement.entity_id,
           requirement.expected_entity_revision::text as expected_entity_revision,
           requirement.expected_lineage_revision::text as expected_lineage_revision,
           requirement.delete_handler_id,
           requirement.verification_handler_id,
           requirement.expiry_ledger_handler_id,
           requirement.external_delete_handler_id,
           plan.governance_context_id as plan_governance_context_id,
           plan.governance_context_version::text as plan_governance_context_version,
           plan.governance_context_hash as plan_governance_context_hash,
           plan.policy_id as plan_policy_id,
           plan.policy_version::text as plan_policy_version,
           plan.policy_hash as plan_policy_hash,
           plan.activation_id as plan_activation_id,
           plan.activation_revision::text as plan_activation_revision,
           plan.activation_hash as plan_activation_hash,
           plan.legal_hold_set_revision::text as plan_legal_hold_set_revision,
           plan.restriction_set_revision::text as plan_restriction_set_revision,
           current_registry.composition_hash as current_registry_composition_hash,
           current_governance.context_id as current_governance_context_id,
           current_governance.version::text as current_governance_context_version,
           current_governance.context_hash as current_governance_context_hash,
           current_policy.policy_id as current_policy_id,
           current_policy.version::text as current_policy_version,
           current_policy.policy_hash as current_policy_hash,
           current_activation.activation_id as current_activation_id,
           current_activation.revision::text as current_activation_revision,
           current_activation.activation_hash as current_activation_hash,
           control_head.legal_hold_set_revision::text as current_legal_hold_set_revision,
           control_head.restriction_set_revision::text as current_restriction_set_revision
      from inbox_v2_data_governance_deletion_plans plan
      join inbox_v2_data_governance_deletion_runs run_row
        on run_row.tenant_id = plan.tenant_id
       and run_row.plan_id = plan.plan_id
       and run_row.plan_revision = plan.revision
       and run_row.run_id = ${input.run.runId}
       and run_row.revision = ${input.run.revision}
      join inbox_v2_data_governance_deletion_checkpoint_requirements requirement
        on requirement.tenant_id = plan.tenant_id
       and requirement.plan_id = plan.plan_id
       and requirement.plan_revision = plan.revision
       and requirement.checkpoint_id = ${input.checkpoint.checkpointId}
       and requirement.registry_id = plan.registry_id
       and requirement.registry_revision = plan.registry_revision
      join inbox_v2_data_governance_registry_versions plan_registry
        on plan_registry.id = plan.registry_id
       and plan_registry.revision = plan.registry_revision
       and plan_registry.composition_hash = plan.registry_composition_hash
      join inbox_v2_data_governance_contexts plan_governance
        on plan_governance.tenant_id = plan.tenant_id
       and plan_governance.context_id = plan.governance_context_id
       and plan_governance.version = plan.governance_context_version
       and plan_governance.context_hash = plan.governance_context_hash
       and plan_governance.registry_id = plan.registry_id
       and plan_governance.registry_revision = plan.registry_revision
      join inbox_v2_data_governance_effective_policies plan_policy
        on plan_policy.tenant_id = plan.tenant_id
       and plan_policy.policy_id = plan.policy_id
       and plan_policy.version = plan.policy_version
       and plan_policy.policy_hash = plan.policy_hash
       and plan_policy.registry_id = plan.registry_id
       and plan_policy.registry_revision = plan.registry_revision
       and plan_policy.governance_context_id = plan.governance_context_id
       and plan_policy.governance_context_version = plan.governance_context_version
      join inbox_v2_data_governance_policy_activations plan_activation
        on plan_activation.tenant_id = plan.tenant_id
       and plan_activation.activation_id = plan.activation_id
       and plan_activation.revision = plan.activation_revision
       and plan_activation.activation_hash = plan.activation_hash
       and plan_activation.policy_id = plan.policy_id
       and plan_activation.policy_version = plan.policy_version
       and plan_activation.candidate_policy_hash = plan.policy_hash
       and plan_activation.governance_context_id = plan.governance_context_id
       and plan_activation.governance_context_version = plan.governance_context_version
       and plan_activation.governance_context_hash = plan.governance_context_hash
      join inbox_v2_data_governance_scope_manifest_roots scope_root
        on scope_root.tenant_id = plan.tenant_id
       and scope_root.manifest_id = plan.manifest_id
       and scope_root.manifest_revision = plan.manifest_revision
       and scope_root.registry_id = requirement.registry_id
       and scope_root.registry_revision = requirement.registry_revision
       and scope_root.storage_root_id = requirement.storage_root_id
       and scope_root.data_class_id = requirement.data_class_id
       and scope_root.root_record_id = requirement.root_record_id
       and scope_root.root_kind = requirement.root_kind
       and scope_root.boundary = requirement.boundary
       and scope_root.copy_role = requirement.copy_role
       and scope_root.entity_type_id = requirement.entity_type_id
       and scope_root.entity_id = requirement.entity_id
       and scope_root.expected_entity_revision = requirement.expected_entity_revision
       and scope_root.expected_lineage_revision = requirement.expected_lineage_revision
      join inbox_v2_data_governance_policy_activation_heads activation_head
        on activation_head.tenant_id = plan.tenant_id
       and activation_head.policy_id = plan.policy_id
      join inbox_v2_data_governance_effective_policies current_policy
        on current_policy.tenant_id = activation_head.tenant_id
       and current_policy.policy_id = activation_head.policy_id
       and current_policy.version = activation_head.current_policy_version
      join inbox_v2_data_governance_contexts current_governance
        on current_governance.tenant_id = current_policy.tenant_id
       and current_governance.context_id = current_policy.governance_context_id
       and current_governance.version = current_policy.governance_context_version
       and current_governance.registry_id = current_policy.registry_id
       and current_governance.registry_revision = current_policy.registry_revision
      join inbox_v2_data_governance_registry_versions current_registry
        on current_registry.id = current_policy.registry_id
       and current_registry.revision = current_policy.registry_revision
      join inbox_v2_data_governance_policy_activations current_activation
        on current_activation.tenant_id = activation_head.tenant_id
       and current_activation.activation_id = activation_head.current_activation_id
       and current_activation.revision = activation_head.current_activation_revision
       and current_activation.policy_id = current_policy.policy_id
       and current_activation.policy_version = current_policy.version
       and current_activation.candidate_policy_hash = current_policy.policy_hash
       and current_activation.governance_context_id = current_governance.context_id
       and current_activation.governance_context_version = current_governance.version
       and current_activation.governance_context_hash = current_governance.context_hash
      join inbox_v2_data_governance_control_set_heads control_head
        on control_head.tenant_id = plan.tenant_id
     where plan.tenant_id = ${input.tenantId}
       and plan.plan_id = ${input.plan.planId}
       and plan.revision = ${input.plan.revision}
     for update of run_row, activation_head, control_head
  `;
}

/**
 * Rechecks the exact terminal tenant export under row locks immediately before
 * a destructive lease is issued. Expiry is exclusive and any newer job or
 * artifact-head revision invalidates the run binding.
 */
export function buildFindInboxV2CurrentTerminalExportSql(input: {
  claim: InboxV2ClaimDestructiveCheckpointInput;
  checkedAt: string;
}): SQL {
  return sql`
    select artifact.expires_at
      from inbox_v2_data_governance_deletion_run_terminal_exports binding
      join inbox_v2_data_governance_deletion_runs run_row
        on run_row.tenant_id = binding.tenant_id
       and run_row.run_id = binding.run_id
       and run_row.revision = binding.run_revision
      join inbox_v2_data_governance_deletion_plans plan
        on plan.tenant_id = run_row.tenant_id
       and plan.plan_id = run_row.plan_id
       and plan.revision = run_row.plan_revision
       and plan.cause = 'tenant_offboarding'
      join inbox_v2_data_governance_tenant_termination_scope_authorities scope
        on scope.tenant_id = plan.tenant_id
       and scope.manifest_id = plan.manifest_id
       and scope.manifest_revision = plan.manifest_revision
       and scope.registry_composition_hash = plan.registry_composition_hash
       and scope.governance_context_id = plan.governance_context_id
       and scope.governance_context_version = plan.governance_context_version
       and scope.governance_context_hash = plan.governance_context_hash
       and scope.policy_id = plan.policy_id
       and scope.policy_version = plan.policy_version
       and scope.policy_hash = plan.policy_hash
       and scope.activation_id = plan.activation_id
       and scope.activation_revision = plan.activation_revision
       and scope.activation_hash = plan.activation_hash
      join inbox_v2_data_governance_scope_manifests scope_manifest
        on scope_manifest.tenant_id = scope.tenant_id
       and scope_manifest.manifest_id = scope.manifest_id
       and scope_manifest.revision = scope.manifest_revision
       and scope_manifest.registry_id = plan.registry_id
       and scope_manifest.registry_revision = plan.registry_revision
       and scope_manifest.stream_epoch = plan.stream_epoch
       and scope_manifest.sync_generation = plan.sync_generation
       and scope_manifest.complete_through_position = plan.complete_through_position
      join inbox_v2_data_governance_export_jobs export_job
        on export_job.tenant_id = binding.tenant_id
       and export_job.job_id = binding.job_id
       and export_job.revision = binding.job_revision
       and export_job.state = 'ready'
       and export_job.product_kind = 'tenant_deployment'
       and export_job.product_authority_id = scope.manifest_id
       and export_job.product_authority_revision = scope.manifest_revision
       and export_job.product_authority_hash = scope.proof_hash
       and export_job.scope_manifest_id = scope.manifest_id
       and export_job.scope_manifest_revision = scope.manifest_revision
       and export_job.governance_context_id = plan.governance_context_id
       and export_job.governance_context_version = plan.governance_context_version
       and export_job.governance_context_hash = plan.governance_context_hash
       and export_job.policy_id = plan.policy_id
       and export_job.policy_version = plan.policy_version
       and export_job.policy_hash = plan.policy_hash
       and export_job.activation_id = plan.activation_id
       and export_job.activation_revision = plan.activation_revision
       and export_job.activation_hash = plan.activation_hash
       and export_job.registry_id = plan.registry_id
       and export_job.registry_revision = plan.registry_revision
       and export_job.export_manifest_id = binding.manifest_id
       and export_job.export_manifest_revision = binding.manifest_revision
       and export_job.export_artifact_id = binding.artifact_id
       and export_job.export_artifact_revision = binding.artifact_revision
      join inbox_v2_data_governance_export_manifests export_manifest
        on export_manifest.tenant_id = binding.tenant_id
       and export_manifest.manifest_id = binding.manifest_id
       and export_manifest.revision = binding.manifest_revision
       and export_manifest.job_id = binding.job_id
       and export_manifest.job_revision = binding.job_revision
       and export_manifest.scope_manifest_id = scope.manifest_id
       and export_manifest.scope_manifest_revision = scope.manifest_revision
       and export_manifest.scope_proof_hash = scope.proof_hash
       and export_manifest.root_set_hash = scope.export_root_set_hash
       and export_manifest.boundary = 'operated_data_plane'
       and export_manifest.stream_epoch = plan.stream_epoch
       and export_manifest.sync_generation = plan.sync_generation
       and export_manifest.complete_through_position = plan.complete_through_position
      join inbox_v2_data_governance_export_artifact_heads artifact_head
        on artifact_head.tenant_id = binding.tenant_id
       and artifact_head.artifact_id = binding.artifact_id
       and artifact_head.job_id = binding.job_id
       and artifact_head.job_revision = binding.job_revision
       and artifact_head.current_revision = binding.artifact_revision
       and artifact_head.current_state = 'ready'
      join inbox_v2_data_governance_export_artifacts artifact
        on artifact.tenant_id = artifact_head.tenant_id
       and artifact.artifact_id = artifact_head.artifact_id
       and artifact.revision = artifact_head.current_revision
       and artifact.job_id = binding.job_id
       and artifact.job_revision = binding.job_revision
       and artifact.artifact_claim_key = artifact_head.artifact_claim_key
       and artifact.state = 'ready'
       and artifact.manifest_id = binding.manifest_id
       and artifact.manifest_revision = binding.manifest_revision
       and artifact.manifest_hash = export_manifest.manifest_hash
       and artifact.payload_checksum is not null
       and artifact.payload_locator is not null
     where binding.tenant_id = ${input.claim.tenantId}
       and binding.run_id = ${input.claim.run.runId}
       and binding.run_revision = ${input.claim.run.revision}
       and plan.plan_id = ${input.claim.plan.planId}
       and plan.revision = ${input.claim.plan.revision}
       and plan.plan_hash = ${input.claim.plan.planHash}
       and binding.bound_at <= ${input.checkedAt}
       and binding.bound_at >= run_row.started_at
       and artifact.ready_at <= binding.bound_at
       and artifact.expires_at > binding.bound_at
       and artifact.ready_at <= ${input.checkedAt}
       and artifact.expires_at > ${input.checkedAt}
     for update of export_job, artifact_head, artifact
  `;
}

export function buildFindInboxV2DestructiveCheckpointPresenceSql(
  input: InboxV2ClaimDestructiveCheckpointInput
): SQL {
  return sql`
    select exists (
      select 1 from inbox_v2_data_governance_deletion_plans plan
       where plan.tenant_id = ${input.tenantId}
         and plan.plan_id = ${input.plan.planId}
         and plan.revision = ${input.plan.revision}
    ) as plan_found,
    exists (
      select 1 from inbox_v2_data_governance_deletion_runs run_row
       where run_row.tenant_id = ${input.tenantId}
         and run_row.run_id = ${input.run.runId}
         and run_row.revision = ${input.run.revision}
         and run_row.plan_id = ${input.plan.planId}
         and run_row.plan_revision = ${input.plan.revision}
    ) as run_found,
    exists (
      select 1 from inbox_v2_data_governance_deletion_checkpoint_requirements requirement
       where requirement.tenant_id = ${input.tenantId}
         and requirement.plan_id = ${input.plan.planId}
         and requirement.plan_revision = ${input.plan.revision}
         and requirement.checkpoint_id = ${input.checkpoint.checkpointId}
    ) as checkpoint_found,
    exists (
      select 1
        from inbox_v2_data_governance_deletion_plans plan
        join inbox_v2_data_governance_deletion_checkpoint_requirements requirement
          on requirement.tenant_id = plan.tenant_id
         and requirement.plan_id = plan.plan_id
         and requirement.plan_revision = plan.revision
         and requirement.checkpoint_id = ${input.checkpoint.checkpointId}
         and requirement.registry_id = plan.registry_id
         and requirement.registry_revision = plan.registry_revision
        join inbox_v2_data_governance_scope_manifest_roots scope_root
          on scope_root.tenant_id = plan.tenant_id
         and scope_root.manifest_id = plan.manifest_id
         and scope_root.manifest_revision = plan.manifest_revision
         and scope_root.registry_id = requirement.registry_id
         and scope_root.registry_revision = requirement.registry_revision
         and scope_root.storage_root_id = requirement.storage_root_id
         and scope_root.data_class_id = requirement.data_class_id
         and scope_root.root_record_id = requirement.root_record_id
         and scope_root.root_kind = requirement.root_kind
         and scope_root.boundary = requirement.boundary
         and scope_root.copy_role = requirement.copy_role
         and scope_root.entity_type_id = requirement.entity_type_id
         and scope_root.entity_id = requirement.entity_id
         and scope_root.expected_entity_revision = requirement.expected_entity_revision
         and scope_root.expected_lineage_revision = requirement.expected_lineage_revision
       where plan.tenant_id = ${input.tenantId}
         and plan.plan_id = ${input.plan.planId}
         and plan.revision = ${input.plan.revision}
    ) as scope_root_found,
    exists (
      select 1
        from inbox_v2_data_governance_policy_activation_heads activation_head
        join inbox_v2_data_governance_effective_policies policy
          on policy.tenant_id = activation_head.tenant_id
         and policy.policy_id = activation_head.policy_id
         and policy.version = activation_head.current_policy_version
        join inbox_v2_data_governance_contexts governance
          on governance.tenant_id = policy.tenant_id
         and governance.context_id = policy.governance_context_id
         and governance.version = policy.governance_context_version
         and governance.registry_id = policy.registry_id
         and governance.registry_revision = policy.registry_revision
        join inbox_v2_data_governance_registry_versions registry
          on registry.id = policy.registry_id
         and registry.revision = policy.registry_revision
        join inbox_v2_data_governance_policy_activations activation
          on activation.tenant_id = activation_head.tenant_id
         and activation.activation_id = activation_head.current_activation_id
         and activation.revision = activation_head.current_activation_revision
         and activation.policy_id = policy.policy_id
         and activation.policy_version = policy.version
         and activation.candidate_policy_hash = policy.policy_hash
         and activation.governance_context_id = governance.context_id
         and activation.governance_context_version = governance.version
         and activation.governance_context_hash = governance.context_hash
       where activation_head.tenant_id = ${input.tenantId}
         and activation_head.policy_id = ${input.expectedAuthority.effectivePolicy.id}
    ) as authority_found,
    exists (
      select 1 from inbox_v2_data_governance_control_set_heads control_head
       where control_head.tenant_id = ${input.tenantId}
    ) as control_set_found
  `;
}

export function buildFindInboxV2ExactLegalHoldSql(input: {
  claim: InboxV2ClaimDestructiveCheckpointInput;
  snapshot: GuardSnapshot;
}): SQL {
  const checkpoint = input.snapshot.checkpoint;
  return sql`
    select head.hold_id,
           head.current_revision::text as hold_revision,
           revision.review_at
      from inbox_v2_data_governance_legal_hold_heads head
      join inbox_v2_data_governance_legal_hold_revisions revision
        on revision.tenant_id = head.tenant_id
       and revision.hold_id = head.hold_id
       and revision.revision = head.current_revision
       and revision.state = 'active'
       and revision.scope_kind = 'exact'
      join inbox_v2_data_governance_legal_hold_targets target
        on target.tenant_id = revision.tenant_id
       and target.hold_id = revision.hold_id
       and target.hold_revision = revision.revision
       and target.state = 'active'
      join inbox_v2_data_governance_legal_hold_data_classes hold_class
        on hold_class.tenant_id = revision.tenant_id
       and hold_class.hold_id = revision.hold_id
       and hold_class.hold_revision = revision.revision
       and hold_class.data_class_id = ${checkpoint.dataClassId}
      join inbox_v2_data_governance_scope_manifest_roots scope_root
        on scope_root.tenant_id = target.tenant_id
       and scope_root.manifest_id = target.scope_manifest_id
       and scope_root.manifest_revision = target.scope_manifest_revision
       and scope_root.storage_root_id = target.storage_root_id
       and scope_root.root_record_id = target.root_record_id
       and scope_root.entity_type_id = target.entity_type_id
       and scope_root.entity_id = target.entity_id
       and scope_root.expected_entity_revision = target.expected_entity_revision
       and scope_root.expected_lineage_revision = target.expected_lineage_revision
     where head.tenant_id = ${input.claim.tenantId}
       and head.state = 'active'
       and target.storage_root_id = ${checkpoint.storageRootId}
       and target.root_record_id = ${checkpoint.rootRecordId}
       and target.entity_type_id = ${checkpoint.entityTypeId}
       and target.entity_id = ${checkpoint.entityId}
       and target.expected_entity_revision = ${checkpoint.expectedEntityRevision}
       and target.expected_lineage_revision = ${checkpoint.expectedLineageRevision}
       and scope_root.registry_id = ${checkpoint.registryId}
       and scope_root.registry_revision = ${checkpoint.registryRevision}
       and scope_root.data_class_id = ${checkpoint.dataClassId}
       and scope_root.root_kind = ${checkpoint.rootKind}
       and scope_root.boundary = ${checkpoint.boundary}
       and scope_root.copy_role = ${checkpoint.copyRole}
     order by head.hold_id, head.current_revision
     limit 1
  `;
}

export function buildFindInboxV2ProspectiveLegalHoldSql(
  input: InboxV2ClaimDestructiveCheckpointInput
): SQL {
  return sql`
    select exists (
      select 1
        from inbox_v2_data_governance_legal_hold_heads head
        join inbox_v2_data_governance_legal_hold_revisions revision
          on revision.tenant_id = head.tenant_id
         and revision.hold_id = head.hold_id
         and revision.revision = head.current_revision
        join inbox_v2_data_governance_legal_hold_data_classes hold_class
          on hold_class.tenant_id = revision.tenant_id
         and hold_class.hold_id = revision.hold_id
         and hold_class.hold_revision = revision.revision
         and hold_class.data_class_id = ${input.checkpoint.root.dataClassId}
       where head.tenant_id = ${input.tenantId}
         and head.state = 'active'
         and revision.state = 'active'
         and revision.scope_kind = 'prospective'
    ) as found
  `;
}

export function buildFindInboxV2ExactRestrictionsSql(input: {
  claim: InboxV2ClaimDestructiveCheckpointInput;
  snapshot: GuardSnapshot;
}): SQL {
  const checkpoint = input.snapshot.checkpoint;
  return sql`
    select head.restriction_id,
           head.current_revision::text as restriction_revision
      from inbox_v2_data_governance_restriction_heads head
      join inbox_v2_data_governance_restriction_revisions revision
        on revision.tenant_id = head.tenant_id
       and revision.restriction_id = head.restriction_id
       and revision.revision = head.current_revision
       and revision.state = 'active'
       and revision.scope_kind = 'exact'
      join inbox_v2_data_governance_scope_manifest_roots scope_root
        on scope_root.tenant_id = revision.tenant_id
       and scope_root.manifest_id = revision.scope_manifest_id
       and scope_root.manifest_revision = revision.scope_manifest_revision
     where head.tenant_id = ${input.claim.tenantId}
       and head.state = 'active'
       and scope_root.storage_root_id = ${checkpoint.storageRootId}
       and scope_root.root_record_id = ${checkpoint.rootRecordId}
       and scope_root.entity_type_id = ${checkpoint.entityTypeId}
       and scope_root.entity_id = ${checkpoint.entityId}
       and scope_root.expected_entity_revision = ${checkpoint.expectedEntityRevision}
       and scope_root.expected_lineage_revision = ${checkpoint.expectedLineageRevision}
       and scope_root.registry_id = ${checkpoint.registryId}
       and scope_root.registry_revision = ${checkpoint.registryRevision}
       and scope_root.data_class_id = ${checkpoint.dataClassId}
       and scope_root.root_kind = ${checkpoint.rootKind}
       and scope_root.boundary = ${checkpoint.boundary}
       and scope_root.copy_role = ${checkpoint.copyRole}
     order by head.restriction_id, head.current_revision
  `;
}

export function buildFindInboxV2ProspectiveRestrictionSql(
  input: InboxV2ClaimDestructiveCheckpointInput
): SQL {
  return sql`
    select exists (
      select 1
        from inbox_v2_data_governance_restriction_heads head
        join inbox_v2_data_governance_restriction_revisions revision
          on revision.tenant_id = head.tenant_id
         and revision.restriction_id = head.restriction_id
         and revision.revision = head.current_revision
        join inbox_v2_data_governance_scope_manifest_roots scope_root
          on scope_root.tenant_id = revision.tenant_id
         and scope_root.manifest_id = revision.scope_manifest_id
         and scope_root.manifest_revision = revision.scope_manifest_revision
         and scope_root.data_class_id = ${input.checkpoint.root.dataClassId}
       where head.tenant_id = ${input.tenantId}
         and head.state = 'active'
         and revision.state = 'active'
         and revision.scope_kind = 'prospective'
    ) as found
  `;
}

export function buildFindInboxV2DestructiveCheckpointLeaseSql(
  input: InboxV2ClaimDestructiveCheckpointInput
): SQL {
  return sql`
    select *
      from inbox_v2_data_governance_destructive_checkpoint_leases lease
     where lease.tenant_id = ${input.tenantId}
       and lease.run_id = ${input.run.runId}
       and lease.run_revision = ${input.run.revision}
       and lease.checkpoint_id = ${input.checkpoint.checkpointId}
     for update of lease
  `;
}

export function buildInsertInboxV2DestructiveCheckpointLeaseSql(input: {
  claim: InboxV2ClaimDestructiveCheckpointInput;
  snapshot: GuardSnapshot;
  executionFenceHash: string;
  leaseExpiresAt: string;
}): SQL {
  const values = leasePersistenceValues(input);
  return sql`
    insert into inbox_v2_data_governance_destructive_checkpoint_leases (
      tenant_id, run_id, run_revision, plan_id, plan_revision, checkpoint_id,
      requirement_hash, claim_revision, state, execution_fence_hash, surface,
      registry_id, registry_revision, registry_composition_hash,
      storage_root_id, data_class_id, root_record_id, entity_type_id, entity_id,
      execution_handler_id, expected_entity_revision, expected_lineage_revision,
      governance_context_id, governance_context_version, governance_context_hash,
      policy_id, policy_version, policy_hash,
      activation_id, activation_revision, activation_hash,
      legal_hold_set_revision, restriction_set_revision,
      authorization_decision_id, authorization_epoch,
      authorization_principal_kind, authorization_principal_key,
      authorization_permission_id, authorization_resource_scope_id,
      authorization_resource_entity_type_id, authorization_resource_entity_id,
      authorization_resource_access_revision, authorization_decision_revision,
      authorization_decision_hash, authorization_outcome,
      authorization_decided_at, authorization_not_after,
      claimed_at, lease_expires_at, completed_at, updated_at
    ) values (
      ${values.tenantId}, ${values.runId}, ${values.runRevision},
      ${values.planId}, ${values.planRevision}, ${values.checkpointId},
      ${values.requirementHash}, 1, 'claimed', ${values.executionFenceHash},
      ${values.surface}, ${values.registryId}, ${values.registryRevision},
      ${values.registryCompositionHash}, ${values.storageRootId},
      ${values.dataClassId}, ${values.rootRecordId}, ${values.entityTypeId},
      ${values.entityId}, ${values.executionHandlerId},
      ${values.expectedEntityRevision}, ${values.expectedLineageRevision},
      ${values.governanceContextId}, ${values.governanceContextVersion},
      ${values.governanceContextHash}, ${values.policyId},
      ${values.policyVersion}, ${values.policyHash}, ${values.activationId},
      ${values.activationRevision}, ${values.activationHash},
      ${values.legalHoldSetRevision}, ${values.restrictionSetRevision},
      ${values.authorizationDecisionId}, ${values.authorizationEpoch},
      ${values.authorizationPrincipalKind}, ${values.authorizationPrincipalKey},
      ${values.authorizationPermissionId}, ${values.authorizationResourceScopeId},
      ${values.authorizationResourceEntityTypeId}, ${values.authorizationResourceEntityId},
      ${values.authorizationResourceAccessRevision}, ${values.authorizationDecisionRevision},
      ${values.authorizationDecisionHash}, ${values.authorizationOutcome},
      ${values.authorizationDecidedAt}, ${values.authorizationNotAfter},
      ${values.checkedAt}, ${values.leaseExpiresAt}, null, ${values.checkedAt}
    )
    on conflict do nothing
    returning *
  `;
}

export function buildTakeOverInboxV2DestructiveCheckpointLeaseSql(input: {
  claim: InboxV2ClaimDestructiveCheckpointInput;
  snapshot: GuardSnapshot;
  previous: LeaseRow;
  executionFenceHash: string;
  leaseExpiresAt: string;
}): SQL {
  const values = leasePersistenceValues(input);
  const previous = normalizeLeaseRow(input.previous);
  return sql`
    update inbox_v2_data_governance_destructive_checkpoint_leases
       set claim_revision = claim_revision + 1,
           state = 'claimed',
           requirement_hash = ${values.requirementHash},
           execution_fence_hash = ${values.executionFenceHash},
           surface = ${values.surface},
           registry_id = ${values.registryId},
           registry_revision = ${values.registryRevision},
           registry_composition_hash = ${values.registryCompositionHash},
           storage_root_id = ${values.storageRootId},
           data_class_id = ${values.dataClassId},
           root_record_id = ${values.rootRecordId},
           entity_type_id = ${values.entityTypeId},
           entity_id = ${values.entityId},
           execution_handler_id = ${values.executionHandlerId},
           expected_entity_revision = ${values.expectedEntityRevision},
           expected_lineage_revision = ${values.expectedLineageRevision},
           governance_context_id = ${values.governanceContextId},
           governance_context_version = ${values.governanceContextVersion},
           governance_context_hash = ${values.governanceContextHash},
           policy_id = ${values.policyId},
           policy_version = ${values.policyVersion},
           policy_hash = ${values.policyHash},
           activation_id = ${values.activationId},
           activation_revision = ${values.activationRevision},
           activation_hash = ${values.activationHash},
           legal_hold_set_revision = ${values.legalHoldSetRevision},
           restriction_set_revision = ${values.restrictionSetRevision},
           authorization_decision_id = ${values.authorizationDecisionId},
           authorization_epoch = ${values.authorizationEpoch},
           authorization_principal_kind = ${values.authorizationPrincipalKind},
           authorization_principal_key = ${values.authorizationPrincipalKey},
           authorization_permission_id = ${values.authorizationPermissionId},
           authorization_resource_scope_id = ${values.authorizationResourceScopeId},
           authorization_resource_entity_type_id = ${values.authorizationResourceEntityTypeId},
           authorization_resource_entity_id = ${values.authorizationResourceEntityId},
           authorization_resource_access_revision = ${values.authorizationResourceAccessRevision},
           authorization_decision_revision = ${values.authorizationDecisionRevision},
           authorization_decision_hash = ${values.authorizationDecisionHash},
           authorization_outcome = ${values.authorizationOutcome},
           authorization_decided_at = ${values.authorizationDecidedAt},
           authorization_not_after = ${values.authorizationNotAfter},
           claimed_at = ${values.checkedAt},
           lease_expires_at = ${values.leaseExpiresAt},
           completed_at = null,
           updated_at = ${values.checkedAt}
     where tenant_id = ${values.tenantId}
       and run_id = ${values.runId}
       and run_revision = ${values.runRevision}
       and checkpoint_id = ${values.checkpointId}
       and claim_revision = ${previous.claimRevision}
       and state = ${previous.state}
       and execution_fence_hash = ${previous.executionFenceHash}
       and (
         state in ('released', 'expired')
         or (state = 'claimed' and lease_expires_at <= ${values.checkedAt})
       )
    returning *
  `;
}

async function loadGuardSnapshot(
  executor: RawSqlExecutor,
  input: InboxV2ClaimDestructiveCheckpointInput
): Promise<GuardSnapshot | null> {
  const result = await executor.execute<GuardSnapshotRow>(
    buildFindInboxV2DestructiveCheckpointGuardSql(input)
  );
  if (result.rows.length > 1) {
    throw new Error("Destructive checkpoint guard snapshot is not unique.");
  }
  return result.rows.length === 0
    ? null
    : normalizeGuardSnapshot(result.rows[0]!, input);
}

async function loadCurrentTerminalExport(
  executor: RawSqlExecutor,
  claim: InboxV2ClaimDestructiveCheckpointInput,
  checkedAt: string
): Promise<string | null> {
  const result = await executor.execute<TerminalExportRow>(
    buildFindInboxV2CurrentTerminalExportSql({ claim, checkedAt })
  );
  if (result.rows.length > 1) {
    throw new Error("Terminal tenant export binding is not unique.");
  }
  return result.rows.length === 0
    ? null
    : requiredTimestamp(result.rows[0]!.expires_at);
}

async function loadGuardPresence(
  executor: RawSqlExecutor,
  input: InboxV2ClaimDestructiveCheckpointInput
): Promise<GuardPresenceRow> {
  const result = await executor.execute<GuardPresenceRow>(
    buildFindInboxV2DestructiveCheckpointPresenceSql(input)
  );
  if (result.rows.length !== 1) {
    throw new Error(
      "Destructive checkpoint presence query returned no result."
    );
  }
  return result.rows[0]!;
}

function classifyMissingGuardSnapshot(
  row: GuardPresenceRow
): InboxV2ClaimDestructiveCheckpointResult {
  if (!requiredBoolean(row.plan_found))
    return { outcome: "not_found", subject: "plan" };
  if (!requiredBoolean(row.run_found))
    return { outcome: "not_found", subject: "run" };
  if (!requiredBoolean(row.checkpoint_found)) {
    return { outcome: "not_found", subject: "checkpoint" };
  }
  if (!requiredBoolean(row.scope_root_found)) {
    return { outcome: "checkpoint_conflict", facet: "root" };
  }
  if (!requiredBoolean(row.authority_found)) {
    return { outcome: "policy_conflict", current: null };
  }
  if (!requiredBoolean(row.control_set_found)) {
    return { outcome: "control_set_conflict", current: null };
  }
  return { outcome: "checkpoint_conflict", facet: "registry" };
}

async function loadExactLegalHold(
  executor: RawSqlExecutor,
  claim: InboxV2ClaimDestructiveCheckpointInput,
  snapshot: GuardSnapshot
): Promise<{ holdId: string; revision: string; reviewAt: string } | null> {
  const result = await executor.execute<LegalHoldRow>(
    buildFindInboxV2ExactLegalHoldSql({ claim, snapshot })
  );
  if (result.rows.length > 1) {
    throw new Error("Exact legal-hold lookup must return at most one blocker.");
  }
  if (result.rows.length === 0) return null;
  const row = result.rows[0]!;
  return {
    holdId: requiredString(row.hold_id),
    revision: requiredCounter(row.hold_revision),
    reviewAt: requiredTimestamp(row.review_at)
  };
}

async function loadProspectiveControlExists(
  executor: RawSqlExecutor,
  statement: SQL
): Promise<boolean> {
  const result = await executor.execute<BooleanRow>(statement);
  if (result.rows.length !== 1) {
    throw new Error("Prospective privacy-control lookup returned no result.");
  }
  return requiredBoolean(result.rows[0]!.found);
}

async function loadExactRestrictions(
  executor: RawSqlExecutor,
  claim: InboxV2ClaimDestructiveCheckpointInput,
  snapshot: GuardSnapshot
): Promise<
  readonly { tenantId: string; restrictionId: string; revision: string }[]
> {
  const result = await executor.execute<RestrictionRow>(
    buildFindInboxV2ExactRestrictionsSql({ claim, snapshot })
  );
  return result.rows.map((row) => ({
    tenantId: claim.tenantId,
    restrictionId: requiredString(row.restriction_id),
    revision: requiredCounter(row.restriction_revision)
  }));
}

async function loadLease(
  executor: RawSqlExecutor,
  claim: InboxV2ClaimDestructiveCheckpointInput
): Promise<LeaseRow | null> {
  const result = await executor.execute<LeaseRow>(
    buildFindInboxV2DestructiveCheckpointLeaseSql(claim)
  );
  if (result.rows.length > 1) {
    throw new Error("Destructive checkpoint lease is not unique.");
  }
  return result.rows[0] ?? null;
}

function classifyActiveLease(input: {
  row: LeaseRow | null;
  claim: InboxV2ClaimDestructiveCheckpointInput;
  snapshot: GuardSnapshot;
  executionFenceHash: string;
  restrictions: readonly {
    tenantId: string;
    restrictionId: string;
    revision: string;
  }[];
}): InboxV2ClaimDestructiveCheckpointResult | null {
  if (input.row === null) return null;
  const row = normalizeLeaseRow(input.row);
  if (row.state === "completed") {
    return inboxV2ClaimDestructiveCheckpointResultSchema.parse({
      outcome: "checkpoint_completed",
      claimRevision: row.claimRevision
    });
  }
  if (
    row.state === "claimed" &&
    Date.parse(row.leaseExpiresAt) > Date.parse(input.snapshot.checkedAt)
  ) {
    if (
      row.executionFenceHash === input.executionFenceHash &&
      leaseSnapshotMatches(row, input.claim, input.snapshot)
    ) {
      return grantedLeaseResult({
        outcome: "already_granted",
        row: input.row,
        claim: input.claim,
        snapshot: input.snapshot,
        restrictions: input.restrictions
      });
    }
    return leaseConflictResult(input.row);
  }
  return null;
}

function leaseConflictResult(
  row: LeaseRow
): InboxV2ClaimDestructiveCheckpointResult {
  const lease = normalizeLeaseRow(row);
  if (lease.state === "completed") {
    return inboxV2ClaimDestructiveCheckpointResultSchema.parse({
      outcome: "checkpoint_completed",
      claimRevision: lease.claimRevision
    });
  }
  return inboxV2ClaimDestructiveCheckpointResultSchema.parse({
    outcome: "lease_conflict",
    state: lease.state,
    claimRevision: lease.claimRevision,
    leaseExpiresAt: lease.leaseExpiresAt
  });
}

function grantedLeaseResult(input: {
  outcome: "granted" | "already_granted";
  row: LeaseRow;
  claim: InboxV2ClaimDestructiveCheckpointInput;
  snapshot: GuardSnapshot;
  restrictions: readonly {
    tenantId: string;
    restrictionId: string;
    revision: string;
  }[];
}): InboxV2ClaimDestructiveCheckpointResult {
  const row = normalizeLeaseRow(input.row);
  if (!leaseSnapshotMatches(row, input.claim, input.snapshot)) {
    throw new Error(
      "Persisted destructive lease lost its frozen checkpoint lineage."
    );
  }
  const restriction = {
    tenantId: input.claim.tenantId,
    restrictions: [...input.restrictions],
    evaluatedAt: input.snapshot.checkedAt,
    decisionHash: calculateInboxV2CanonicalSha256({
      domain: "core:inbox-v2.destructive-checkpoint-restriction-fence",
      hashVersion: "v1",
      tenantId: input.claim.tenantId,
      controlSet: input.snapshot.currentControlSet,
      restrictions: input.restrictions,
      evaluatedAt: input.snapshot.checkedAt
    }),
    restrictionExtendedRetention: false as const
  };
  const fence = inboxV2DeletionExecutionFenceSchema.parse({
    tenantId: input.claim.tenantId,
    plan: input.claim.plan,
    governance: input.snapshot.currentAuthority.governance,
    policy: input.snapshot.currentAuthority.effectivePolicy,
    executionAuthorization: input.claim.executionAuthorization,
    revision: {
      kind: "matched",
      expectedRevision: input.snapshot.checkpoint.expectedEntityRevision,
      observedRevision: input.claim.checkpoint.observedEntityRevision
    },
    lineage: {
      kind: "matched",
      expectedRevision: input.snapshot.checkpoint.expectedLineageRevision,
      observedRevision: input.claim.checkpoint.observedLineageRevision
    },
    hold: { kind: "clear" },
    restriction,
    checkedAt: input.snapshot.checkedAt
  });
  const lease = inboxV2DestructiveCheckpointLeaseSchema.parse({
    tenantId: input.claim.tenantId,
    plan: input.claim.plan,
    run: input.claim.run,
    checkpoint: input.claim.checkpoint,
    authority: input.snapshot.currentAuthority,
    controlSet: input.snapshot.currentControlSet,
    claimRevision: row.claimRevision,
    state: "claimed",
    leaseToken: input.claim.leaseToken,
    executionFenceHash: row.executionFenceHash,
    executionHandlerId: row.executionHandlerId,
    fence,
    claimedAt: row.claimedAt,
    leaseExpiresAt: row.leaseExpiresAt
  });
  return { outcome: input.outcome, lease };
}

function normalizeGuardSnapshot(
  row: GuardSnapshotRow,
  input: InboxV2ClaimDestructiveCheckpointInput
): GuardSnapshot {
  const tenantId = input.tenantId;
  return {
    planCause: requiredDeletionCause(row.plan_cause),
    planHash: requiredString(row.plan_hash),
    earliestExecutionAt: requiredTimestamp(row.earliest_execution_at),
    runState: requiredString(row.run_state),
    stageOneState: requiredString(row.stage_one_state),
    checkedAt: requiredTimestamp(row.checked_at),
    checkpoint: {
      requirementHash: requiredString(row.requirement_hash),
      surface: requiredString(row.surface),
      registryId: requiredString(row.registry_id),
      registryRevision: requiredCounter(row.registry_revision),
      registryCompositionHash: requiredString(
        row.plan_registry_composition_hash
      ),
      storageRootId: requiredString(row.storage_root_id),
      dataClassId: requiredString(row.data_class_id),
      rootKind: requiredString(row.root_kind),
      boundary: requiredString(row.boundary),
      copyRole: requiredString(row.copy_role),
      rootRecordId: requiredString(row.root_record_id),
      entityTypeId: requiredString(row.entity_type_id),
      entityId: requiredString(row.entity_id),
      expectedEntityRevision: requiredCounter(row.expected_entity_revision),
      expectedLineageRevision: requiredCounter(row.expected_lineage_revision),
      deleteHandlerId: optionalString(row.delete_handler_id),
      verificationHandlerId: optionalString(row.verification_handler_id),
      expiryLedgerHandlerId: optionalString(row.expiry_ledger_handler_id),
      externalDeleteHandlerId: optionalString(row.external_delete_handler_id)
    },
    planAuthority: inboxV2PolicyActivationAuthoritySchema.parse({
      tenantId,
      registryCompositionHash: row.plan_registry_composition_hash,
      governance: {
        tenantId,
        id: row.plan_governance_context_id,
        version: requiredCounter(row.plan_governance_context_version),
        contextHash: row.plan_governance_context_hash
      },
      effectivePolicy: {
        tenantId,
        id: row.plan_policy_id,
        version: requiredCounter(row.plan_policy_version),
        policyHash: row.plan_policy_hash
      },
      activation: {
        tenantId,
        id: row.plan_activation_id,
        revision: requiredCounter(row.plan_activation_revision),
        activationHash: row.plan_activation_hash
      }
    }),
    currentAuthority: inboxV2PolicyActivationAuthoritySchema.parse({
      tenantId,
      registryCompositionHash: row.current_registry_composition_hash,
      governance: {
        tenantId,
        id: row.current_governance_context_id,
        version: requiredCounter(row.current_governance_context_version),
        contextHash: row.current_governance_context_hash
      },
      effectivePolicy: {
        tenantId,
        id: row.current_policy_id,
        version: requiredCounter(row.current_policy_version),
        policyHash: row.current_policy_hash
      },
      activation: {
        tenantId,
        id: row.current_activation_id,
        revision: requiredCounter(row.current_activation_revision),
        activationHash: row.current_activation_hash
      }
    }),
    planControlSet: inboxV2DestructiveCheckpointControlSetSchema.parse({
      legalHoldSetRevision: requiredCounter(row.plan_legal_hold_set_revision),
      restrictionSetRevision: requiredCounter(row.plan_restriction_set_revision)
    }),
    currentControlSet: inboxV2DestructiveCheckpointControlSetSchema.parse({
      legalHoldSetRevision: requiredCounter(
        row.current_legal_hold_set_revision
      ),
      restrictionSetRevision: requiredCounter(
        row.current_restriction_set_revision
      )
    })
  };
}

function firstCheckpointConflict(
  snapshot: GuardSnapshot,
  claim: InboxV2ClaimDestructiveCheckpointInput
):
  | "plan_hash"
  | "requirement_hash"
  | "surface"
  | "registry"
  | "root"
  | "entity"
  | "entity_revision"
  | "lineage_revision"
  | "handler_set"
  | null {
  const expected = snapshot.checkpoint;
  const observed = claim.checkpoint;
  if (snapshot.planHash !== claim.plan.planHash) return "plan_hash";
  if (expected.requirementHash !== observed.requirementHash) {
    return "requirement_hash";
  }
  if (
    expected.surface !== observed.surface ||
    expected.rootKind !== observed.rootKind ||
    expected.boundary !== observed.boundary ||
    expected.copyRole !== observed.copyRole
  ) {
    return "surface";
  }
  if (
    expected.registryId !== observed.registry.id ||
    expected.registryRevision !== observed.registry.revision ||
    expected.registryCompositionHash !== observed.registry.compositionHash
  ) {
    return "registry";
  }
  if (
    expected.storageRootId !== observed.root.storageRootId ||
    expected.dataClassId !== observed.root.dataClassId ||
    expected.rootRecordId !== observed.root.recordId
  ) {
    return "root";
  }
  if (
    expected.entityTypeId !== observed.entity.entityTypeId ||
    expected.entityId !== observed.entity.entityId
  ) {
    return "entity";
  }
  if (expected.expectedEntityRevision !== observed.observedEntityRevision) {
    return "entity_revision";
  }
  if (expected.expectedLineageRevision !== observed.observedLineageRevision) {
    return "lineage_revision";
  }
  if (!handlerSetMatches(expected, observed)) return "handler_set";
  return null;
}

function handlerSetMatches(
  expected: GuardSnapshot["checkpoint"],
  observed: InboxV2ObservedDestructiveCheckpoint
): boolean {
  if (observed.surface === "operated") {
    return (
      expected.deleteHandlerId === observed.handlers.deleteHandlerId &&
      expected.verificationHandlerId ===
        observed.handlers.verificationHandlerId &&
      expected.expiryLedgerHandlerId === null &&
      expected.externalDeleteHandlerId === null
    );
  }
  if (observed.surface === "backup") {
    return (
      expected.deleteHandlerId === null &&
      expected.verificationHandlerId ===
        observed.handlers.verificationHandlerId &&
      expected.expiryLedgerHandlerId ===
        observed.handlers.expiryLedgerHandlerId &&
      expected.externalDeleteHandlerId === null
    );
  }
  return (
    expected.deleteHandlerId === null &&
    expected.verificationHandlerId === null &&
    expected.expiryLedgerHandlerId === null &&
    expected.externalDeleteHandlerId ===
      observed.handlers.externalDeleteHandlerId
  );
}

function leasePersistenceValues(input: {
  claim: InboxV2ClaimDestructiveCheckpointInput;
  snapshot: GuardSnapshot;
  executionFenceHash: string;
  leaseExpiresAt: string;
}) {
  const checkpoint = input.snapshot.checkpoint;
  const authority = input.snapshot.currentAuthority;
  const authorization = input.claim.executionAuthorization;
  return {
    tenantId: input.claim.tenantId,
    runId: input.claim.run.runId,
    runRevision: input.claim.run.revision,
    planId: input.claim.plan.planId,
    planRevision: input.claim.plan.revision,
    checkpointId: input.claim.checkpoint.checkpointId,
    requirementHash: checkpoint.requirementHash,
    executionFenceHash: input.executionFenceHash,
    surface: checkpoint.surface,
    registryId: checkpoint.registryId,
    registryRevision: checkpoint.registryRevision,
    registryCompositionHash: checkpoint.registryCompositionHash,
    storageRootId: checkpoint.storageRootId,
    dataClassId: checkpoint.dataClassId,
    rootRecordId: checkpoint.rootRecordId,
    entityTypeId: checkpoint.entityTypeId,
    entityId: checkpoint.entityId,
    executionHandlerId: inboxV2DestructiveCheckpointExecutionHandlerId(
      input.claim.checkpoint
    ),
    expectedEntityRevision: checkpoint.expectedEntityRevision,
    expectedLineageRevision: checkpoint.expectedLineageRevision,
    governanceContextId: authority.governance.id,
    governanceContextVersion: authority.governance.version,
    governanceContextHash: authority.governance.contextHash,
    policyId: authority.effectivePolicy.id,
    policyVersion: authority.effectivePolicy.version,
    policyHash: authority.effectivePolicy.policyHash,
    activationId: authority.activation.id,
    activationRevision: authority.activation.revision,
    activationHash: authority.activation.activationHash,
    legalHoldSetRevision: input.snapshot.currentControlSet.legalHoldSetRevision,
    restrictionSetRevision:
      input.snapshot.currentControlSet.restrictionSetRevision,
    authorizationDecisionId: authorization.id,
    authorizationEpoch: authorization.authorizationEpoch,
    authorizationPrincipalKind: authorization.principal.kind,
    authorizationPrincipalKey: authorizationPrincipalKey(authorization),
    authorizationPermissionId: authorization.permissionId,
    authorizationResourceScopeId: authorization.resourceScopeId,
    authorizationResourceEntityTypeId: authorization.resource.entityTypeId,
    authorizationResourceEntityId: authorization.resource.entityId,
    authorizationResourceAccessRevision: authorization.resourceAccessRevision,
    authorizationDecisionRevision: authorization.decisionRevision,
    authorizationDecisionHash: authorization.decisionHash,
    authorizationOutcome: authorization.outcome,
    authorizationDecidedAt: authorization.decidedAt,
    authorizationNotAfter: authorization.notAfter,
    checkedAt: input.snapshot.checkedAt,
    leaseExpiresAt: input.leaseExpiresAt
  };
}

function normalizeLeaseRow(row: LeaseRow): NormalizedLeaseRow {
  const state = requiredString(row.state);
  if (!isLeaseState(state)) {
    throw new Error("Destructive checkpoint lease has an invalid state.");
  }
  return {
    tenantId: requiredString(row.tenant_id),
    runId: requiredString(row.run_id),
    runRevision: requiredCounter(row.run_revision),
    planId: requiredString(row.plan_id),
    planRevision: requiredCounter(row.plan_revision),
    checkpointId: requiredString(row.checkpoint_id),
    requirementHash: requiredString(row.requirement_hash),
    claimRevision: requiredCounter(row.claim_revision),
    state,
    executionFenceHash: requiredString(row.execution_fence_hash),
    surface: requiredString(row.surface),
    registryId: requiredString(row.registry_id),
    registryRevision: requiredCounter(row.registry_revision),
    registryCompositionHash: requiredString(row.registry_composition_hash),
    storageRootId: requiredString(row.storage_root_id),
    dataClassId: requiredString(row.data_class_id),
    rootRecordId: requiredString(row.root_record_id),
    entityTypeId: requiredString(row.entity_type_id),
    entityId: requiredString(row.entity_id),
    executionHandlerId: requiredString(row.execution_handler_id),
    expectedEntityRevision: requiredCounter(row.expected_entity_revision),
    expectedLineageRevision: requiredCounter(row.expected_lineage_revision),
    governanceContextId: requiredString(row.governance_context_id),
    governanceContextVersion: requiredCounter(row.governance_context_version),
    governanceContextHash: requiredString(row.governance_context_hash),
    policyId: requiredString(row.policy_id),
    policyVersion: requiredCounter(row.policy_version),
    policyHash: requiredString(row.policy_hash),
    activationId: requiredString(row.activation_id),
    activationRevision: requiredCounter(row.activation_revision),
    activationHash: requiredString(row.activation_hash),
    legalHoldSetRevision: requiredCounter(row.legal_hold_set_revision),
    restrictionSetRevision: requiredCounter(row.restriction_set_revision),
    authorizationDecisionId: requiredString(row.authorization_decision_id),
    authorizationEpoch: requiredString(row.authorization_epoch),
    authorizationPrincipalKind: requiredAuthorizationPrincipalKind(
      row.authorization_principal_kind
    ),
    authorizationPrincipalKey: requiredString(row.authorization_principal_key),
    authorizationPermissionId: requiredString(row.authorization_permission_id),
    authorizationResourceScopeId: requiredString(
      row.authorization_resource_scope_id
    ),
    authorizationResourceEntityTypeId: requiredString(
      row.authorization_resource_entity_type_id
    ),
    authorizationResourceEntityId: requiredString(
      row.authorization_resource_entity_id
    ),
    authorizationResourceAccessRevision: requiredCounter(
      row.authorization_resource_access_revision
    ),
    authorizationDecisionRevision: requiredCounter(
      row.authorization_decision_revision
    ),
    authorizationDecisionHash: requiredString(row.authorization_decision_hash),
    authorizationOutcome: requiredString(row.authorization_outcome),
    authorizationDecidedAt: requiredTimestamp(row.authorization_decided_at),
    authorizationNotAfter: requiredTimestamp(row.authorization_not_after),
    claimedAt: requiredTimestamp(row.claimed_at),
    leaseExpiresAt: requiredTimestamp(row.lease_expires_at)
  };
}

function leaseSnapshotMatches(
  row: NormalizedLeaseRow,
  claim: InboxV2ClaimDestructiveCheckpointInput,
  snapshot: GuardSnapshot
): boolean {
  const checkpoint = snapshot.checkpoint;
  const authority = snapshot.currentAuthority;
  const authorization = claim.executionAuthorization;
  return (
    row.tenantId === claim.tenantId &&
    row.runId === claim.run.runId &&
    row.runRevision === claim.run.revision &&
    row.planId === claim.plan.planId &&
    row.planRevision === claim.plan.revision &&
    row.checkpointId === claim.checkpoint.checkpointId &&
    row.requirementHash === checkpoint.requirementHash &&
    row.surface === checkpoint.surface &&
    row.registryId === checkpoint.registryId &&
    row.registryRevision === checkpoint.registryRevision &&
    row.registryCompositionHash === checkpoint.registryCompositionHash &&
    row.storageRootId === checkpoint.storageRootId &&
    row.dataClassId === checkpoint.dataClassId &&
    row.rootRecordId === checkpoint.rootRecordId &&
    row.entityTypeId === checkpoint.entityTypeId &&
    row.entityId === checkpoint.entityId &&
    row.executionHandlerId ===
      inboxV2DestructiveCheckpointExecutionHandlerId(claim.checkpoint) &&
    row.expectedEntityRevision === checkpoint.expectedEntityRevision &&
    row.expectedLineageRevision === checkpoint.expectedLineageRevision &&
    row.governanceContextId === authority.governance.id &&
    row.governanceContextVersion === authority.governance.version &&
    row.governanceContextHash === authority.governance.contextHash &&
    row.policyId === authority.effectivePolicy.id &&
    row.policyVersion === authority.effectivePolicy.version &&
    row.policyHash === authority.effectivePolicy.policyHash &&
    row.activationId === authority.activation.id &&
    row.activationRevision === authority.activation.revision &&
    row.activationHash === authority.activation.activationHash &&
    row.legalHoldSetRevision ===
      snapshot.currentControlSet.legalHoldSetRevision &&
    row.restrictionSetRevision ===
      snapshot.currentControlSet.restrictionSetRevision &&
    row.authorizationDecisionId === authorization.id &&
    row.authorizationEpoch === authorization.authorizationEpoch &&
    row.authorizationPrincipalKind === authorization.principal.kind &&
    row.authorizationPrincipalKey ===
      authorizationPrincipalKey(authorization) &&
    row.authorizationPermissionId === authorization.permissionId &&
    row.authorizationResourceScopeId === authorization.resourceScopeId &&
    row.authorizationResourceEntityTypeId ===
      authorization.resource.entityTypeId &&
    row.authorizationResourceEntityId === authorization.resource.entityId &&
    row.authorizationResourceAccessRevision ===
      authorization.resourceAccessRevision &&
    row.authorizationDecisionRevision === authorization.decisionRevision &&
    row.authorizationDecisionHash === authorization.decisionHash &&
    row.authorizationOutcome === authorization.outcome &&
    Date.parse(row.authorizationDecidedAt) ===
      Date.parse(authorization.decidedAt) &&
    Date.parse(row.authorizationNotAfter) === Date.parse(authorization.notAfter)
  );
}

function authorizationPrincipalKey(
  authorization: InboxV2ClaimDestructiveCheckpointInput["executionAuthorization"]
): string {
  return authorization.principal.kind === "employee"
    ? String(authorization.principal.employee.id)
    : String(authorization.principal.trustedServiceId);
}

function sameAuthority(
  left: InboxV2PolicyActivationAuthority,
  right: InboxV2PolicyActivationAuthority
): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.registryCompositionHash === right.registryCompositionHash &&
    left.governance.id === right.governance.id &&
    left.governance.version === right.governance.version &&
    left.governance.contextHash === right.governance.contextHash &&
    left.effectivePolicy.id === right.effectivePolicy.id &&
    left.effectivePolicy.version === right.effectivePolicy.version &&
    left.effectivePolicy.policyHash === right.effectivePolicy.policyHash &&
    left.activation.id === right.activation.id &&
    left.activation.revision === right.activation.revision &&
    left.activation.activationHash === right.activation.activationHash
  );
}

function sameControlSet(
  left: InboxV2DestructiveCheckpointControlSet,
  right: InboxV2DestructiveCheckpointControlSet
): boolean {
  return (
    left.legalHoldSetRevision === right.legalHoldSetRevision &&
    left.restrictionSetRevision === right.restrictionSetRevision
  );
}

function isLeaseState(
  value: string
): value is "claimed" | "completed" | "released" | "expired" {
  return ["claimed", "completed", "released", "expired"].includes(value);
}

function requiredDeletionCause(value: unknown): GuardSnapshot["planCause"] {
  if (
    value === "provider_message_delete" ||
    value === "employee_ui_delete" ||
    value === "retention_expiry" ||
    value === "privacy_erasure" ||
    value === "tenant_offboarding" ||
    value === "administrative_policy_purge"
  ) {
    return value;
  }
  throw new Error("Destructive checkpoint plan has an invalid cause.");
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      "Destructive checkpoint repository returned an invalid row."
    );
  }
  return value;
}

function optionalString(value: unknown): string | null {
  return value === null ? null : requiredString(value);
}

function requiredCounter(value: unknown): string {
  const normalized = typeof value === "bigint" ? value.toString() : value;
  if (
    typeof normalized !== "string" ||
    !/^(0|[1-9][0-9]*)$/u.test(normalized)
  ) {
    throw new Error(
      "Destructive checkpoint repository returned an invalid revision."
    );
  }
  return normalized;
}

function requiredTimestamp(value: unknown): string {
  const normalized = value instanceof Date ? value.toISOString() : value;
  if (
    typeof normalized !== "string" ||
    !Number.isFinite(Date.parse(normalized))
  ) {
    throw new Error(
      "Destructive checkpoint repository returned an invalid timestamp."
    );
  }
  return new Date(normalized).toISOString();
}

function requiredBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new Error(
      "Destructive checkpoint repository returned an invalid boolean."
    );
  }
  return value;
}

function requiredAuthorizationPrincipalKind(
  value: unknown
): "employee" | "trusted_service" {
  if (value !== "employee" && value !== "trusted_service") {
    throw new Error(
      "Destructive checkpoint repository returned an invalid authorization principal."
    );
  }
  return value;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}
