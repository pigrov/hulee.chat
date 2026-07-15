import {
  defineInboxV2DeletionRunStateRepository,
  inboxV2CreateDeletionRunInputSchema,
  inboxV2CommitDeletionStageOneInputSchema,
  inboxV2DeletionRunMutableStateSchema,
  inboxV2DeletionRunStateTransitionInputSchema,
  inboxV2DeletionRunStateTransitionResultSchema,
  initialInboxV2DeletionRunMutableState,
  type InboxV2CreateDeletionRunInput,
  type InboxV2CommitDeletionStageOneInput,
  type InboxV2DeletionRunMutableState,
  type InboxV2DeletionRunStateRepository,
  type InboxV2DeletionRunStateTransitionInput,
  type InboxV2DeletionRunStateTransitionResult,
  type InboxV2DeletionStageOneTargetProof
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";

import type { HuleeDatabase } from "../client";
import { buildInboxV2AdvisoryLockKeySql } from "./sql-inbox-v2-advisory-lock";
import type { RawSqlExecutor } from "./sql-outbox-repository";

export type {
  InboxV2CommitDeletionStageOneInput,
  InboxV2CreateDeletionRunInput,
  InboxV2DeletionRunMutableState,
  InboxV2DeletionRunStateRepository,
  InboxV2DeletionRunStateTransitionInput,
  InboxV2DeletionRunStateTransitionResult,
  InboxV2DeletionStageOneTargetProof
} from "@hulee/contracts";

export type InboxV2DeletionRunStateTransactionExecutor = RawSqlExecutor & {
  transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>
  ): Promise<TResult>;
};

export type TransitionInboxV2DeletionRunInput =
  InboxV2DeletionRunStateTransitionInput;
export type TransitionInboxV2DeletionRunResult =
  InboxV2DeletionRunStateTransitionResult;

type DeletionRunStateRow = {
  plan_id: unknown;
  plan_revision: unknown;
  plan_hash: unknown;
  plan_cause: unknown;
  operated_checkpoint_count: unknown;
  backup_checkpoint_count: unknown;
  external_checkpoint_count: unknown;
  started_at: unknown;
  state_revision: unknown;
  state: unknown;
  result: unknown;
  stage_one_state: unknown;
  stage_one_committed_at: unknown;
  primary_absence_verified: unknown;
  has_internal_residual: unknown;
  has_external_residual: unknown;
  has_backup_expiry_pending: unknown;
  backup_latest_possible_expiry_at: unknown;
  completed_checkpoint_count: unknown;
  completed_at: unknown;
  state_hash: unknown;
  updated_at: unknown;
};

type DeletionRunAdmissionRow = { admitted_at: unknown };
type DeletionRunTerminalExportRow = { bound_at: unknown };

type DeletionStageOneTargetRow = {
  tenant_id: unknown;
  checkpoint_id: unknown;
  requirement_hash: unknown;
  storage_root_id: unknown;
  data_class_id: unknown;
  root_record_id: unknown;
  entity_type_id: unknown;
  entity_id: unknown;
  expected_revision: unknown;
  resulting_revision: unknown;
  tombstone_tenant_id: unknown;
  tombstone_record_id: unknown;
  tombstone_schema_id: unknown;
  tombstone_schema_version: unknown;
  tombstone_digest: unknown;
  invalidation_digest: unknown;
  committed_at: unknown;
};

/** Single-row CAS for the stable execution revision referenced by all attempts. */
export function createSqlInboxV2DeletionRunStateRepository(
  executor: InboxV2DeletionRunStateTransactionExecutor | HuleeDatabase
): InboxV2DeletionRunStateRepository {
  const transactionExecutor =
    executor as unknown as InboxV2DeletionRunStateTransactionExecutor;
  return defineInboxV2DeletionRunStateRepository({
    async createRun(rawInput) {
      const input = inboxV2CreateDeletionRunInputSchema.parse(rawInput);
      return transactionExecutor.transaction(async (transaction) => {
        const admission = (
          await transaction.execute<DeletionRunAdmissionRow>(
            buildLockInboxV2DeletionRunSql(input)
          )
        ).rows[0];
        if (admission === undefined) {
          throw new Error("Deletion-run admission lock returned no timestamp.");
        }
        const admittedAt = timestampValue(admission.admitted_at);
        const existing = (
          await transaction.execute<DeletionRunStateRow>(
            buildFindInboxV2DeletionRunStateSql(input, true)
          )
        ).rows[0];
        if (existing !== undefined) {
          return (await sameInitialRunAndCurrentTerminalExport(
            transaction,
            existing,
            input,
            admittedAt
          ))
            ? transitionResult({
                outcome: "already_applied",
                stateRevision: "1"
              })
            : conflictResult(existing);
        }

        const inserted = await transaction.execute<DeletionRunStateRow>(
          buildCreateInboxV2DeletionRunSql(input, admittedAt)
        );
        if (inserted.rows.length === 1) {
          if (input.terminalExport !== null) {
            const binding =
              await transaction.execute<DeletionRunTerminalExportRow>(
                buildInsertInboxV2DeletionRunTerminalExportSql(
                  input,
                  admittedAt
                )
              );
            if (binding.rows.length !== 1) {
              throw new Error(
                "Tenant-offboarding deletion run did not persist its terminal export binding."
              );
            }
          }
          await transaction.execute(sql.raw("set constraints all immediate"));
          return transitionResult({
            outcome: "applied",
            stateRevision: "1"
          });
        }
        const winner = (
          await transaction.execute<DeletionRunStateRow>(
            buildFindInboxV2DeletionRunStateSql(input, true)
          )
        ).rows[0];
        if (winner === undefined) return { outcome: "not_found" } as const;
        if (
          await sameInitialRunAndCurrentTerminalExport(
            transaction,
            winner,
            input,
            admittedAt
          )
        ) {
          return transitionResult({
            outcome: "already_applied",
            stateRevision: "1"
          });
        }
        return conflictResult(winner);
      });
    },
    async transition(rawInput) {
      const input =
        inboxV2DeletionRunStateTransitionInputSchema.parse(rawInput);
      if (
        input.expectedStageOneState === "pending" &&
        input.next.stageOneState === "content_unavailable"
      ) {
        throw new Error(
          "Pending stage one must be committed atomically with target proofs."
        );
      }
      return transactionExecutor.transaction(async (transaction) => {
        const transition = await executeTransition(transaction, input);
        if (transition.outcome === "applied") {
          await transaction.execute(sql.raw("set constraints all immediate"));
        }
        return transition;
      });
    },
    async commitStageOne(rawInput) {
      const input = inboxV2CommitDeletionStageOneInputSchema.parse(rawInput);
      return transactionExecutor.transaction(async (transaction) => {
        const current = (
          await transaction.execute<DeletionRunStateRow>(
            buildFindInboxV2DeletionRunStateSql(input, true)
          )
        ).rows[0];
        if (current === undefined) return { outcome: "not_found" } as const;

        const nextStateRevision = (
          BigInt(input.expectedStateRevision) + 1n
        ).toString();
        const persistedTargets = (
          await transaction.execute<DeletionStageOneTargetRow>(
            buildFindInboxV2DeletionStageOneTargetsSql(input)
          )
        ).rows;
        if (
          bigintText(current.state_revision) === nextStateRevision &&
          sameMutableState(current, input.next) &&
          sameStageOneTargets(persistedTargets, input.targets)
        ) {
          return transitionResult({
            outcome: "already_applied",
            stateRevision: nextStateRevision
          });
        }
        if (
          bigintText(current.state_revision) !== input.expectedStateRevision ||
          runState(current.state) !== input.expectedState ||
          stageOneState(current.stage_one_state) !== input.expectedStageOneState
        ) {
          return conflictResult(current);
        }
        if (
          persistedTargets.length > 0 &&
          !sameStageOneTargets(persistedTargets, input.targets)
        ) {
          return conflictResult(current);
        }
        if (persistedTargets.length === 0) {
          await transaction.execute(
            buildInsertInboxV2DeletionStageOneTargetsSql(input)
          );
        }
        const updated = await transaction.execute<DeletionRunStateRow>(
          buildTransitionInboxV2DeletionRunSql(input)
        );
        if (updated.rows.length !== 1) {
          throw new Error(
            "Deletion stage-one CAS lost after locking its run row."
          );
        }
        await transaction.execute(sql.raw("set constraints all immediate"));
        return transitionResult({
          outcome: "applied",
          stateRevision: nextStateRevision
        });
      });
    }
  });
}

/** Serializes bootstrap attempts for one stable deletion-run revision. */
export function buildLockInboxV2DeletionRunSql(input: {
  tenantId: string;
  runId: string;
  revision: string;
}): SQL {
  return sql`
    with admission_lock as materialized (
      select pg_advisory_xact_lock(
        ${buildInboxV2AdvisoryLockKeySql([
          input.tenantId,
          input.runId,
          input.revision
        ])}
      ) as acquired
    )
    select clock_timestamp() as admitted_at
      from admission_lock
  `;
}

export function buildCreateInboxV2DeletionRunSql(
  input: InboxV2CreateDeletionRunInput,
  admittedAt: string
): SQL {
  const initial = initialInboxV2DeletionRunMutableState(input);
  const checkedAt = timestampValue(admittedAt);
  const terminal = input.terminalExport;
  const terminalAuthorityCte =
    terminal === null
      ? sql``
      : sql`,
    current_terminal_export as materialized (
      select artifact.expires_at
        from current_authority authority
        join inbox_v2_data_governance_scope_manifests scope_manifest
          on scope_manifest.tenant_id = authority.tenant_id
         and scope_manifest.manifest_id = authority.manifest_id
         and scope_manifest.revision = authority.manifest_revision
         and scope_manifest.kind = 'tenant_wide'
         and scope_manifest.registry_id = authority.registry_id
         and scope_manifest.registry_revision = authority.registry_revision
         and scope_manifest.stream_epoch = authority.stream_epoch
         and scope_manifest.sync_generation = authority.sync_generation
         and scope_manifest.complete_through_position = authority.complete_through_position
        join inbox_v2_data_governance_tenant_termination_scope_authorities scope_authority
          on scope_authority.tenant_id = scope_manifest.tenant_id
         and scope_authority.manifest_id = scope_manifest.manifest_id
         and scope_authority.manifest_revision = scope_manifest.revision
         and scope_authority.registry_composition_hash = authority.registry_composition_hash
         and scope_authority.governance_context_id = authority.governance_context_id
         and scope_authority.governance_context_version = authority.governance_context_version
         and scope_authority.governance_context_hash = authority.governance_context_hash
         and scope_authority.policy_id = authority.policy_id
         and scope_authority.policy_version = authority.policy_version
         and scope_authority.policy_hash = authority.policy_hash
         and scope_authority.activation_id = authority.activation_id
         and scope_authority.activation_revision = authority.activation_revision
         and scope_authority.activation_hash = authority.activation_hash
        join inbox_v2_data_governance_export_jobs export_job
          on export_job.tenant_id = authority.tenant_id
         and export_job.job_id = ${terminal.job.id}
         and export_job.revision = ${terminal.job.revision}
         and export_job.state = 'ready'
         and export_job.product_kind = 'tenant_deployment'
         and export_job.product_authority_id = scope_authority.manifest_id
         and export_job.product_authority_revision = scope_authority.manifest_revision
         and export_job.product_authority_hash = scope_authority.proof_hash
         and export_job.scope_manifest_id = scope_authority.manifest_id
         and export_job.scope_manifest_revision = scope_authority.manifest_revision
         and export_job.governance_context_id = authority.governance_context_id
         and export_job.governance_context_version = authority.governance_context_version
         and export_job.governance_context_hash = authority.governance_context_hash
         and export_job.policy_id = authority.policy_id
         and export_job.policy_version = authority.policy_version
         and export_job.policy_hash = authority.policy_hash
         and export_job.activation_id = authority.activation_id
         and export_job.activation_revision = authority.activation_revision
         and export_job.activation_hash = authority.activation_hash
         and export_job.registry_id = authority.registry_id
         and export_job.registry_revision = authority.registry_revision
         and export_job.export_manifest_id = ${terminal.manifest.id}
         and export_job.export_manifest_revision = ${terminal.manifest.revision}
         and export_job.export_artifact_id = ${terminal.artifact.id}
         and export_job.export_artifact_revision = ${terminal.artifact.revision}
        join inbox_v2_data_governance_export_manifests export_manifest
          on export_manifest.tenant_id = export_job.tenant_id
         and export_manifest.manifest_id = ${terminal.manifest.id}
         and export_manifest.revision = ${terminal.manifest.revision}
         and export_manifest.manifest_hash = ${terminal.manifest.manifestHash}
         and export_manifest.job_id = export_job.job_id
         and export_manifest.job_revision = export_job.revision
         and export_manifest.scope_manifest_id = scope_authority.manifest_id
         and export_manifest.scope_manifest_revision = scope_authority.manifest_revision
         and export_manifest.scope_proof_hash = scope_authority.proof_hash
         and export_manifest.root_set_hash = scope_authority.export_root_set_hash
         and export_manifest.boundary = 'operated_data_plane'
         and export_manifest.stream_epoch = authority.stream_epoch
         and export_manifest.sync_generation = authority.sync_generation
         and export_manifest.complete_through_position = authority.complete_through_position
        join inbox_v2_data_governance_export_artifact_heads artifact_head
          on artifact_head.tenant_id = export_job.tenant_id
         and artifact_head.artifact_id = ${terminal.artifact.id}
         and artifact_head.job_id = export_job.job_id
         and artifact_head.job_revision = export_job.revision
         and artifact_head.current_revision = ${terminal.artifact.revision}
         and artifact_head.current_state = 'ready'
        join inbox_v2_data_governance_export_artifacts artifact
          on artifact.tenant_id = artifact_head.tenant_id
         and artifact.artifact_id = artifact_head.artifact_id
         and artifact.revision = artifact_head.current_revision
         and artifact.job_id = artifact_head.job_id
         and artifact.job_revision = artifact_head.job_revision
         and artifact.artifact_claim_key = artifact_head.artifact_claim_key
         and artifact.state = 'ready'
         and artifact.manifest_id = export_manifest.manifest_id
         and artifact.manifest_revision = export_manifest.revision
         and artifact.manifest_hash = export_manifest.manifest_hash
         and artifact.payload_checksum = ${terminal.artifact.checksum}
         and artifact.payload_locator is not null
         and artifact.ready_at = ${terminal.artifact.readyAt}
         and artifact.expires_at = ${terminal.artifact.expiresAt}
         and artifact.deleted_at is null
       where scope_authority.proof_hash = ${terminal.tenantScopeProofHash}
         and scope_authority.export_root_set_hash = ${terminal.rootSetHash}
         and authority.governance_context_id = ${terminal.governanceContext.id}
         and authority.governance_context_version = ${terminal.governanceContext.version}
         and authority.governance_context_hash = ${terminal.governanceContext.contextHash}
         and authority.policy_id = ${terminal.policy.id}
         and authority.policy_version = ${terminal.policy.version}
         and authority.policy_hash = ${terminal.policy.policyHash}
         and artifact.ready_at <= ${input.startedAt}
         and artifact.expires_at > ${checkedAt}
         and artifact.expires_at > clock_timestamp()
       for share of scope_manifest, scope_authority, export_job,
                    export_manifest, artifact_head, artifact
    )`;
  const terminalJoin =
    terminal === null
      ? sql``
      : sql`cross join current_terminal_export terminal_authority`;
  const causePredicate =
    terminal === null
      ? sql`plan.cause <> 'tenant_offboarding'`
      : sql`plan.cause = 'tenant_offboarding'`;
  return sql`
    with current_authority as materialized (
      select plan.tenant_id, plan.plan_id, plan.revision, plan.cause,
             plan.manifest_id, plan.manifest_revision,
             plan.registry_id, plan.registry_revision,
             plan.registry_composition_hash,
             plan.governance_context_id, plan.governance_context_version,
             plan.governance_context_hash,
             plan.policy_id, plan.policy_version, plan.policy_hash,
             plan.activation_id, plan.activation_revision,
             plan.activation_hash, plan.stream_epoch, plan.sync_generation,
             plan.complete_through_position
        from inbox_v2_data_governance_deletion_plans plan
        join inbox_v2_data_governance_policy_activation_heads activation_head
          on activation_head.tenant_id = plan.tenant_id
         and activation_head.policy_id = plan.policy_id
         and activation_head.current_policy_version = plan.policy_version
         and activation_head.current_activation_id = plan.activation_id
         and activation_head.current_activation_revision = plan.activation_revision
        join inbox_v2_data_governance_control_set_heads control_head
          on control_head.tenant_id = plan.tenant_id
         and control_head.legal_hold_set_revision = plan.legal_hold_set_revision
         and control_head.restriction_set_revision = plan.restriction_set_revision
       where plan.tenant_id = ${input.tenantId}
         and plan.plan_id = ${input.plan.planId}
         and plan.revision = ${input.plan.revision}
         and plan.plan_hash = ${input.plan.planHash}
         and ${causePredicate}
         and plan.earliest_execution_at <= ${input.startedAt}
         and ${input.startedAt}::timestamptz <= ${checkedAt}
       for share of plan, activation_head, control_head
    )
    ${terminalAuthorityCte},
    frozen_checkpoint_counts as (
      select count(*) filter (where requirement.surface = 'operated')::bigint as operated_count,
             count(*) filter (where requirement.surface = 'backup')::bigint as backup_count,
             count(*) filter (where requirement.surface = 'external')::bigint as external_count
        from inbox_v2_data_governance_deletion_checkpoint_requirements requirement
       where requirement.tenant_id = ${input.tenantId}
         and requirement.plan_id = ${input.plan.planId}
         and requirement.plan_revision = ${input.plan.revision}
    )
    insert into inbox_v2_data_governance_deletion_runs (
      tenant_id, run_id, revision, state_revision, plan_id, plan_revision,
      state, result, stage_one_state, stage_one_committed_at,
      primary_absence_verified, has_internal_residual, has_external_residual,
      has_backup_expiry_pending, backup_latest_possible_expiry_at,
      operated_checkpoint_count, backup_checkpoint_count,
      external_checkpoint_count, completed_checkpoint_count,
      started_at, completed_at, updated_at, state_hash
    )
    select authority.tenant_id, ${input.runId}, ${input.revision}, 1,
           authority.plan_id, authority.revision, ${initial.state}, ${initial.result},
           ${initial.stageOneState}, ${initial.stageOneCommittedAt},
           ${initial.primaryAbsenceVerified}, ${initial.hasInternalResidual},
           ${initial.hasExternalResidual}, ${initial.hasBackupExpiryPending},
           ${initial.backupLatestPossibleExpiryAt}, frozen.operated_count,
           frozen.backup_count, frozen.external_count,
           ${initial.completedCheckpointCount}, ${input.startedAt},
           ${initial.completedAt}, ${initial.updatedAt}, ${initial.stateHash}
      from current_authority authority
      ${terminalJoin}
      cross join frozen_checkpoint_counts frozen
     where frozen.operated_count >= 1
    on conflict (tenant_id, run_id, revision) do nothing
    returning plan_id, plan_revision,
              operated_checkpoint_count::text as operated_checkpoint_count,
              backup_checkpoint_count::text as backup_checkpoint_count,
              external_checkpoint_count::text as external_checkpoint_count,
              started_at, state_revision::text as state_revision, state,
              result, stage_one_state, stage_one_committed_at,
              primary_absence_verified, has_internal_residual,
              has_external_residual, has_backup_expiry_pending,
              backup_latest_possible_expiry_at,
              completed_checkpoint_count::text as completed_checkpoint_count,
              completed_at, state_hash, updated_at
  `;
}

export function buildInsertInboxV2DeletionRunTerminalExportSql(
  input: InboxV2CreateDeletionRunInput,
  boundAt: string
): SQL {
  const terminal = input.terminalExport;
  if (terminal === null) {
    throw new Error(
      "A terminal export reference is required to persist an offboarding binding."
    );
  }
  return sql`
    insert into inbox_v2_data_governance_deletion_run_terminal_exports (
      tenant_id, run_id, run_revision, job_id, job_revision,
      manifest_id, manifest_revision, artifact_id, artifact_revision, bound_at
    ) values (
      ${input.tenantId}, ${input.runId}, ${input.revision},
      ${terminal.job.id}, ${terminal.job.revision},
      ${terminal.manifest.id}, ${terminal.manifest.revision},
      ${terminal.artifact.id}, ${terminal.artifact.revision},
      ${timestampValue(boundAt)}
    )
    returning bound_at
  `;
}

/**
 * Exact retry check for the immutable offboarding binding. The reference must
 * still identify the current ready job, manifest and artifact at admission.
 */
export function buildFindInboxV2CurrentDeletionRunTerminalExportSql(
  input: InboxV2CreateDeletionRunInput,
  checkedAt: string
): SQL {
  const terminal = input.terminalExport;
  if (terminal === null) {
    throw new Error(
      "A terminal export reference is required to verify an offboarding binding."
    );
  }
  return sql`
    select binding.bound_at
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
      join inbox_v2_data_governance_policy_activation_heads activation_head
        on activation_head.tenant_id = plan.tenant_id
       and activation_head.policy_id = plan.policy_id
       and activation_head.current_policy_version = plan.policy_version
       and activation_head.current_activation_id = plan.activation_id
       and activation_head.current_activation_revision = plan.activation_revision
      join inbox_v2_data_governance_scope_manifests scope_manifest
        on scope_manifest.tenant_id = plan.tenant_id
       and scope_manifest.manifest_id = plan.manifest_id
       and scope_manifest.revision = plan.manifest_revision
       and scope_manifest.kind = 'tenant_wide'
       and scope_manifest.registry_id = plan.registry_id
       and scope_manifest.registry_revision = plan.registry_revision
       and scope_manifest.stream_epoch = plan.stream_epoch
       and scope_manifest.sync_generation = plan.sync_generation
       and scope_manifest.complete_through_position = plan.complete_through_position
      join inbox_v2_data_governance_tenant_termination_scope_authorities scope_authority
        on scope_authority.tenant_id = scope_manifest.tenant_id
       and scope_authority.manifest_id = scope_manifest.manifest_id
       and scope_authority.manifest_revision = scope_manifest.revision
       and scope_authority.registry_composition_hash = plan.registry_composition_hash
       and scope_authority.governance_context_id = plan.governance_context_id
       and scope_authority.governance_context_version = plan.governance_context_version
       and scope_authority.governance_context_hash = plan.governance_context_hash
       and scope_authority.policy_id = plan.policy_id
       and scope_authority.policy_version = plan.policy_version
       and scope_authority.policy_hash = plan.policy_hash
       and scope_authority.activation_id = plan.activation_id
       and scope_authority.activation_revision = plan.activation_revision
       and scope_authority.activation_hash = plan.activation_hash
      join inbox_v2_data_governance_export_jobs export_job
        on export_job.tenant_id = binding.tenant_id
       and export_job.job_id = binding.job_id
       and export_job.revision = binding.job_revision
       and export_job.state = 'ready'
       and export_job.product_kind = 'tenant_deployment'
       and export_job.product_authority_id = scope_authority.manifest_id
       and export_job.product_authority_revision = scope_authority.manifest_revision
       and export_job.product_authority_hash = scope_authority.proof_hash
       and export_job.scope_manifest_id = scope_authority.manifest_id
       and export_job.scope_manifest_revision = scope_authority.manifest_revision
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
       and export_manifest.scope_manifest_id = scope_authority.manifest_id
       and export_manifest.scope_manifest_revision = scope_authority.manifest_revision
       and export_manifest.scope_proof_hash = scope_authority.proof_hash
       and export_manifest.root_set_hash = scope_authority.export_root_set_hash
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
       and artifact.job_id = artifact_head.job_id
       and artifact.job_revision = artifact_head.job_revision
       and artifact.artifact_claim_key = artifact_head.artifact_claim_key
       and artifact.state = 'ready'
       and artifact.manifest_id = export_manifest.manifest_id
       and artifact.manifest_revision = export_manifest.revision
       and artifact.manifest_hash = export_manifest.manifest_hash
       and artifact.payload_locator is not null
       and artifact.deleted_at is null
     where binding.tenant_id = ${input.tenantId}
       and binding.run_id = ${input.runId}
       and binding.run_revision = ${input.revision}
       and binding.job_id = ${terminal.job.id}
       and binding.job_revision = ${terminal.job.revision}
       and binding.manifest_id = ${terminal.manifest.id}
       and binding.manifest_revision = ${terminal.manifest.revision}
       and binding.artifact_id = ${terminal.artifact.id}
       and binding.artifact_revision = ${terminal.artifact.revision}
       and plan.plan_id = ${input.plan.planId}
       and plan.revision = ${input.plan.revision}
       and plan.plan_hash = ${input.plan.planHash}
       and scope_authority.proof_hash = ${terminal.tenantScopeProofHash}
       and scope_authority.export_root_set_hash = ${terminal.rootSetHash}
       and plan.governance_context_id = ${terminal.governanceContext.id}
       and plan.governance_context_version = ${terminal.governanceContext.version}
       and plan.governance_context_hash = ${terminal.governanceContext.contextHash}
       and plan.policy_id = ${terminal.policy.id}
       and plan.policy_version = ${terminal.policy.version}
       and plan.policy_hash = ${terminal.policy.policyHash}
       and export_manifest.manifest_hash = ${terminal.manifest.manifestHash}
       and artifact.payload_checksum = ${terminal.artifact.checksum}
       and artifact.ready_at = ${terminal.artifact.readyAt}
       and artifact.expires_at = ${terminal.artifact.expiresAt}
       and binding.bound_at >= run_row.started_at
       and binding.bound_at <= ${timestampValue(checkedAt)}
       and artifact.ready_at <= run_row.started_at
       and artifact.expires_at > ${timestampValue(checkedAt)}
       and artifact.expires_at > clock_timestamp()
     for share of activation_head, export_job, artifact_head, artifact
  `;
}

async function executeTransition(
  executor: RawSqlExecutor,
  input: InboxV2DeletionRunStateTransitionInput
): Promise<InboxV2DeletionRunStateTransitionResult> {
  const nextStateRevision = (
    BigInt(input.expectedStateRevision) + 1n
  ).toString();
  const updated = await executor.execute<DeletionRunStateRow>(
    buildTransitionInboxV2DeletionRunSql(input)
  );
  if (updated.rows.length === 1) {
    return transitionResult({
      outcome: "applied",
      stateRevision: nextStateRevision
    });
  }
  const current = (
    await executor.execute<DeletionRunStateRow>(
      buildFindInboxV2DeletionRunStateSql(input)
    )
  ).rows[0];
  if (current === undefined) return { outcome: "not_found" };
  if (
    bigintText(current.state_revision) === nextStateRevision &&
    sameMutableState(current, input.next)
  ) {
    return transitionResult({
      outcome: "already_applied",
      stateRevision: nextStateRevision
    });
  }
  return conflictResult(current);
}

export function buildTransitionInboxV2DeletionRunSql(
  input: TransitionInboxV2DeletionRunInput
): SQL {
  return sql`
    update inbox_v2_data_governance_deletion_runs run_row
       set state_revision = run_row.state_revision + 1,
           state = ${input.next.state},
           result = ${input.next.result},
           stage_one_state = ${input.next.stageOneState},
           stage_one_committed_at = ${input.next.stageOneCommittedAt},
           primary_absence_verified = ${input.next.primaryAbsenceVerified},
           has_internal_residual = ${input.next.hasInternalResidual},
           has_external_residual = ${input.next.hasExternalResidual},
           has_backup_expiry_pending = ${input.next.hasBackupExpiryPending},
           backup_latest_possible_expiry_at = ${input.next.backupLatestPossibleExpiryAt},
           completed_checkpoint_count = ${input.next.completedCheckpointCount},
           completed_at = ${input.next.completedAt},
           state_hash = ${input.next.stateHash},
           updated_at = ${input.next.updatedAt}
     where run_row.tenant_id = ${input.tenantId}
       and run_row.run_id = ${input.runId}
       and run_row.revision = ${input.revision}
       and run_row.state = ${input.expectedState}
       and run_row.stage_one_state = ${input.expectedStageOneState}
       and run_row.state_revision = ${input.expectedStateRevision}
     returning run_row.state_revision::text as state_revision,
               run_row.state,
               run_row.result,
               run_row.stage_one_state,
               run_row.stage_one_committed_at,
               run_row.primary_absence_verified,
               run_row.has_internal_residual,
               run_row.has_external_residual,
               run_row.has_backup_expiry_pending,
               run_row.backup_latest_possible_expiry_at,
               run_row.completed_checkpoint_count::text as completed_checkpoint_count,
               run_row.completed_at,
               run_row.state_hash,
               run_row.updated_at
  `;
}

export function buildFindInboxV2DeletionRunStateSql(
  input: { tenantId: string; runId: string; revision: string },
  forUpdate = false
): SQL {
  return sql`
    select run_row.state_revision::text as state_revision,
           run_row.plan_id,
           run_row.plan_revision::text as plan_revision,
           plan.plan_hash,
           plan.cause as plan_cause,
           run_row.operated_checkpoint_count::text as operated_checkpoint_count,
           run_row.backup_checkpoint_count::text as backup_checkpoint_count,
           run_row.external_checkpoint_count::text as external_checkpoint_count,
           run_row.started_at,
           run_row.state,
           run_row.result,
           run_row.stage_one_state,
           run_row.stage_one_committed_at,
           run_row.primary_absence_verified,
           run_row.has_internal_residual,
           run_row.has_external_residual,
           run_row.has_backup_expiry_pending,
           run_row.backup_latest_possible_expiry_at,
           run_row.completed_checkpoint_count::text as completed_checkpoint_count,
           run_row.completed_at,
           run_row.state_hash,
           run_row.updated_at
      from inbox_v2_data_governance_deletion_runs run_row
      join inbox_v2_data_governance_deletion_plans plan
        on plan.tenant_id = run_row.tenant_id
       and plan.plan_id = run_row.plan_id
       and plan.revision = run_row.plan_revision
     where run_row.tenant_id = ${input.tenantId}
       and run_row.run_id = ${input.runId}
       and run_row.revision = ${input.revision}
     ${forUpdate ? sql`for update of run_row` : sql``}
  `;
}

export function buildFindInboxV2DeletionStageOneTargetsSql(input: {
  tenantId: string;
  runId: string;
  revision: string;
}): SQL {
  return sql`
    select target.tenant_id,
           target.checkpoint_id,
           target.requirement_hash,
           target.storage_root_id,
           target.data_class_id,
           target.root_record_id,
           target.entity_type_id,
           target.entity_id,
           target.expected_revision::text as expected_revision,
           target.resulting_revision::text as resulting_revision,
           target.tombstone_tenant_id,
           target.tombstone_record_id,
           target.tombstone_schema_id,
           target.tombstone_schema_version,
           target.tombstone_digest,
           target.invalidation_digest,
           target.committed_at
      from inbox_v2_data_governance_deletion_stage_one_targets target
     where target.tenant_id = ${input.tenantId}
       and target.run_id = ${input.runId}
       and target.run_revision = ${input.revision}
     order by target.checkpoint_id
  `;
}

export function buildInsertInboxV2DeletionStageOneTargetsSql(
  input: InboxV2CommitDeletionStageOneInput
): SQL {
  const proofValues = sql.join(
    input.targets.map(
      (target) => sql`(
        ${target.checkpointId}, ${target.requirementHash},
        ${target.root.storageRootId}, ${target.root.dataClassId}, ${target.root.recordId},
        ${target.entity.entityTypeId}, ${target.entity.entityId},
        ${target.expectedRevision}, ${target.resultingRevision},
        ${target.tombstoneManifest.tenantId}, ${target.tombstoneManifest.recordId},
        ${target.tombstoneManifest.schemaId}, ${target.tombstoneManifest.schemaVersion},
        ${target.tombstoneManifest.digest}, ${target.invalidationDigest}, ${target.committedAt}
      )`
    ),
    sql`, `
  );
  return sql`
    insert into inbox_v2_data_governance_deletion_stage_one_targets (
      tenant_id, run_id, run_revision, plan_id, plan_revision,
      checkpoint_id, requirement_hash, storage_root_id, data_class_id,
      root_record_id, entity_type_id, entity_id, expected_revision,
      resulting_revision, tombstone_tenant_id, tombstone_record_id,
      tombstone_schema_id, tombstone_schema_version, tombstone_digest,
      invalidation_digest, committed_at
    )
    select run_row.tenant_id, run_row.run_id, run_row.revision,
           run_row.plan_id, run_row.plan_revision,
           proof.checkpoint_id, proof.requirement_hash, proof.storage_root_id,
           proof.data_class_id, proof.root_record_id, proof.entity_type_id,
           proof.entity_id, proof.expected_revision::bigint,
           proof.resulting_revision::bigint, proof.tombstone_tenant_id,
           proof.tombstone_record_id, proof.tombstone_schema_id,
           proof.tombstone_schema_version, proof.tombstone_digest,
           proof.invalidation_digest, proof.committed_at::timestamptz
      from inbox_v2_data_governance_deletion_runs run_row
      cross join (values ${proofValues}) as proof(
        checkpoint_id, requirement_hash, storage_root_id, data_class_id,
        root_record_id, entity_type_id, entity_id, expected_revision,
        resulting_revision, tombstone_tenant_id, tombstone_record_id,
        tombstone_schema_id, tombstone_schema_version, tombstone_digest,
        invalidation_digest, committed_at
      )
     where run_row.tenant_id = ${input.tenantId}
       and run_row.run_id = ${input.runId}
       and run_row.revision = ${input.revision}
       and run_row.state = ${input.expectedState}
       and run_row.stage_one_state = ${input.expectedStageOneState}
       and run_row.state_revision = ${input.expectedStateRevision}
  `;
}

function conflictResult(
  row: DeletionRunStateRow
): Extract<InboxV2DeletionRunStateTransitionResult, { outcome: "conflict" }> {
  return transitionResult({
    outcome: "conflict",
    currentState: runState(row.state),
    currentStateRevision: bigintText(row.state_revision)
  }) as Extract<
    InboxV2DeletionRunStateTransitionResult,
    { outcome: "conflict" }
  >;
}

function transitionResult(
  value: unknown
): InboxV2DeletionRunStateTransitionResult {
  return inboxV2DeletionRunStateTransitionResultSchema.parse(value);
}

function sameStageOneTargets(
  rows: readonly DeletionStageOneTargetRow[],
  expected: readonly InboxV2DeletionStageOneTargetProof[]
): boolean {
  const persisted = rows.map((row) => ({
    checkpointId: textValue(row.checkpoint_id),
    requirementHash: textValue(row.requirement_hash),
    root: {
      tenantId: textValue(row.tenant_id),
      dataClassId: textValue(row.data_class_id),
      storageRootId: textValue(row.storage_root_id),
      recordId: textValue(row.root_record_id)
    },
    entity: {
      tenantId: textValue(row.tenant_id),
      entityTypeId: textValue(row.entity_type_id),
      entityId: textValue(row.entity_id)
    },
    expectedRevision: bigintText(row.expected_revision),
    resultingRevision: bigintText(row.resulting_revision),
    tombstoneManifest: {
      tenantId: textValue(row.tombstone_tenant_id),
      recordId: textValue(row.tombstone_record_id),
      schemaId: textValue(row.tombstone_schema_id),
      schemaVersion: textValue(row.tombstone_schema_version),
      digest: textValue(row.tombstone_digest)
    },
    invalidationDigest: textValue(row.invalidation_digest),
    committedAt: timestampValue(row.committed_at)
  }));
  const normalizedExpected = expected.map((proof) => ({
    ...proof,
    committedAt: timestampValue(proof.committedAt)
  }));
  return isDeepStrictEqual(persisted, normalizedExpected);
}

function sameMutableState(
  row: DeletionRunStateRow,
  expected: InboxV2DeletionRunMutableState
): boolean {
  return isDeepStrictEqual(mutableState(row), normalizeState(expected));
}

function sameInitialRun(
  row: DeletionRunStateRow,
  input: InboxV2CreateDeletionRunInput
): boolean {
  return (
    textValue(row.plan_id) === input.plan.planId &&
    bigintText(row.plan_revision) === input.plan.revision &&
    textValue(row.plan_hash) === input.plan.planHash &&
    timestampValue(row.started_at) === timestampValue(input.startedAt) &&
    bigintText(row.state_revision) === "1" &&
    BigInt(bigintText(row.operated_checkpoint_count)) >= 1n &&
    isDeepStrictEqual(
      mutableState(row),
      normalizeState(initialInboxV2DeletionRunMutableState(input))
    )
  );
}

async function sameInitialRunAndCurrentTerminalExport(
  executor: RawSqlExecutor,
  row: DeletionRunStateRow,
  input: InboxV2CreateDeletionRunInput,
  checkedAt: string
): Promise<boolean> {
  if (!sameInitialRun(row, input)) return false;
  const cause = deletionCause(row.plan_cause);
  if (cause !== "tenant_offboarding") return input.terminalExport === null;
  if (input.terminalExport === null) return false;
  const current = await executor.execute<DeletionRunTerminalExportRow>(
    buildFindInboxV2CurrentDeletionRunTerminalExportSql(input, checkedAt)
  );
  return current.rows.length === 1;
}

function mutableState(
  row: DeletionRunStateRow
): InboxV2DeletionRunMutableState {
  return inboxV2DeletionRunMutableStateSchema.parse({
    state: runState(row.state),
    result: runResult(row.result),
    stageOneState: stageOneState(row.stage_one_state),
    stageOneCommittedAt: nullableTimestampValue(row.stage_one_committed_at),
    primaryAbsenceVerified: booleanValue(row.primary_absence_verified),
    hasInternalResidual: booleanValue(row.has_internal_residual),
    hasExternalResidual: booleanValue(row.has_external_residual),
    hasBackupExpiryPending: booleanValue(row.has_backup_expiry_pending),
    backupLatestPossibleExpiryAt: nullableTimestampValue(
      row.backup_latest_possible_expiry_at
    ),
    completedCheckpointCount: bigintText(row.completed_checkpoint_count),
    completedAt: nullableTimestampValue(row.completed_at),
    stateHash: textValue(row.state_hash),
    updatedAt: timestampValue(row.updated_at)
  });
}

function normalizeState(
  state: InboxV2DeletionRunMutableState
): InboxV2DeletionRunMutableState {
  return {
    ...state,
    stageOneCommittedAt: normalizeNullableTimestamp(state.stageOneCommittedAt),
    backupLatestPossibleExpiryAt: normalizeNullableTimestamp(
      state.backupLatestPossibleExpiryAt
    ),
    completedAt: normalizeNullableTimestamp(state.completedAt),
    updatedAt: timestampValue(state.updatedAt),
    stateHash: state.stateHash
  };
}

function runState(
  value: unknown
): "executing" | "verification_pending" | "terminal" {
  if (
    value === "executing" ||
    value === "verification_pending" ||
    value === "terminal"
  ) {
    return value;
  }
  throw new Error(`Invalid persisted deletion run state: ${String(value)}.`);
}

function stageOneState(value: unknown): "pending" | "content_unavailable" {
  if (value === "pending" || value === "content_unavailable") return value;
  throw new Error(
    `Invalid persisted deletion stage-one state: ${String(value)}.`
  );
}

function runResult(value: unknown): InboxV2DeletionRunMutableState["result"] {
  if (value === null || value === undefined) return null;
  if (
    value === "completed" ||
    value === "completed_with_external_residuals" ||
    value === "primary_purged_backup_expiry_pending" ||
    value === "verification_blocked_internal_residual" ||
    value === "failed_retryable"
  ) {
    return value;
  }
  throw new Error(`Invalid persisted deletion result: ${String(value)}.`);
}

function deletionCause(
  value: unknown
):
  | "privacy_erasure"
  | "tenant_offboarding"
  | "retention_expiry"
  | "provider_message_delete"
  | "employee_ui_delete"
  | "administrative_policy_purge" {
  if (
    value === "privacy_erasure" ||
    value === "tenant_offboarding" ||
    value === "retention_expiry" ||
    value === "provider_message_delete" ||
    value === "employee_ui_delete" ||
    value === "administrative_policy_purge"
  ) {
    return value;
  }
  throw new Error(`Invalid persisted deletion cause: ${String(value)}.`);
}

function textValue(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid SQL text: ${String(value)}.`);
  }
  return value;
}

function timestampValue(value: unknown): string {
  const raw = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(raw.getTime())) throw new Error("Invalid SQL timestamp.");
  return raw.toISOString();
}

function normalizeNullableTimestamp(value: string | null): string | null {
  return value === null ? null : timestampValue(value);
}

function nullableTimestampValue(value: unknown): string | null {
  return value === null || value === undefined ? null : timestampValue(value);
}

function bigintText(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isSafeInteger(value))
    return String(value);
  if (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value))
    return value;
  throw new Error(`Invalid SQL bigint: ${String(value)}.`);
}

function booleanValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (value === "t" || value === "true" || value === "1" || value === 1)
    return true;
  if (value === "f" || value === "false" || value === "0" || value === 0)
    return false;
  throw new Error(`Invalid SQL boolean: ${String(value)}.`);
}
