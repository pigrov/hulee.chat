import {
  calculateInboxV2CanonicalSha256,
  calculateInboxV2ErasureRestoreLeaseTokenHash,
  defineInboxV2ErasureRestoreLedgerRepository,
  inboxV2ErasureRestoreAppendFenceSchema,
  inboxV2ErasureRestoreEvidenceSchema,
  inboxV2ErasureRestoreLedgerEntrySchema,
  type InboxV2ErasureRestoreAppendFence,
  type InboxV2ErasureRestoreLedgerAppendResult,
  type InboxV2ErasureRestoreLedgerEntry,
  type InboxV2ErasureRestoreLedgerRepository
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";

import type { HuleeDatabase } from "../client";
import { buildInboxV2AdvisoryXactLockSql } from "./sql-inbox-v2-advisory-lock";
import type { RawSqlExecutor } from "./sql-outbox-repository";

type InboxV2ErasureRestoreEvidence = Extract<
  InboxV2ErasureRestoreLedgerEntry,
  { kind: "erasure_applied" }
>["primaryAbsence"]["evidence"];

export type InboxV2ErasureRestoreLedgerTransactionExecutor = RawSqlExecutor & {
  transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>
  ): Promise<TResult>;
};

type LedgerRow = Record<string, unknown> & {
  tenant_id: unknown;
  ledger_id: unknown;
  ledger_entry_id: unknown;
  sequence: unknown;
  kind: unknown;
  entry_hash: unknown;
};

type EvidenceRow = {
  slot: unknown;
  kind: unknown;
  digest: unknown;
  payload_tenant_id: unknown;
  payload_record_id: unknown;
  payload_schema_id: unknown;
  payload_schema_version: unknown;
};

type ControlSetRow = {
  role: unknown;
  control_kind: unknown;
  control_id: unknown;
  control_revision: unknown;
  control_entry_hash: unknown;
};

type AuthorityRootRow = {
  registry_id: unknown;
  registry_revision: unknown;
  root_kind: unknown;
  boundary: unknown;
  checked_at: unknown;
};

type AuthorityPresenceRow = {
  registry_found: unknown;
  governance_context_found: unknown;
  effective_policy_found: unknown;
  activation_found: unknown;
  storage_root_found: unknown;
};

type ExactPresenceRow = { subject_found: unknown; exact_match: unknown };

type AppliedControlRow = {
  entry_hash: unknown;
  control_kind: unknown;
  control_id: unknown;
  control_revision: unknown;
};

type ControlSetFenceRow = {
  legal_hold_set_revision: unknown;
  restriction_set_revision: unknown;
  last_changed_stream_position: unknown;
  head_revision: unknown;
};

type CurrentRestoreControlRow = AppliedControlRow & {
  control_head_revision: unknown;
};

type RestoreAuthorityRow = {
  restore_state: unknown;
  head_revision: unknown;
  source_erasure_entry_hash: unknown;
  storage_root_id: unknown;
  data_class_id: unknown;
  root_record_id: unknown;
  entity_type_id: unknown;
  entity_id: unknown;
  entity_revision: unknown;
  lineage_revision: unknown;
  opened_sequence: unknown;
  required_control_set_hash: unknown;
  required_control_count: unknown;
  stored_legal_hold_set_revision: unknown;
  stored_restriction_set_revision: unknown;
  stored_control_set_head_revision: unknown;
  stored_control_set_stream_position: unknown;
  lease_revision: unknown;
  restore_head_revision: unknown;
  lease_state: unknown;
  lease_token_hash: unknown;
  lease_expires_at: unknown;
  current_legal_hold_set_revision: unknown;
  current_restriction_set_revision: unknown;
  current_control_set_head_revision: unknown;
  current_control_set_stream_position: unknown;
};

type RestoreRequiredControlRow = {
  control_kind: unknown;
  control_id: unknown;
  control_revision: unknown;
  control_head_revision: unknown;
  source_control_entry_hash: unknown;
  row_revision: unknown;
  reapplied_entry_hash: unknown;
};

type EvidenceInsert = {
  slot: "primary_absence" | "backup_expiry" | "control_application" | "restore";
  evidence: InboxV2ErasureRestoreEvidence;
};

type ControlSetInsert = {
  role: "required" | "reapplied";
  controlKind: "legal_hold" | "restriction";
  controlId: string;
  controlRevision: string;
  controlEntryHash: string;
};

type RestoreRequiredControlInsert = Omit<ControlSetInsert, "role"> & {
  controlHeadRevision: string;
};

type RestoreMutationPlan =
  | {
      kind: "open_restore";
      fence: Extract<
        InboxV2ErasureRestoreAppendFence,
        { operation: "open_restore" }
      >;
      controlSet: ControlSetFenceRow;
      sourceErasureSequence: string;
      requiredControls: RestoreRequiredControlInsert[];
      checkedAt: string;
    }
  | {
      kind: "reapply_control";
      fence: Extract<
        InboxV2ErasureRestoreAppendFence,
        { operation: "reapply_control" }
      >;
      checkedAt: string;
    }
  | {
      kind: "seal_restore";
      fence: Extract<
        InboxV2ErasureRestoreAppendFence,
        { operation: "seal_restore" }
      >;
      checkedAt: string;
    };

/**
 * Durable append-only erasure/restore ledger. The advisory lock serializes one
 * tenant ledger, while deferred DDL constraints provide the final relational
 * proof before the transaction is allowed to return an applied result.
 */
export function createSqlInboxV2ErasureRestoreLedgerRepository(
  executor: InboxV2ErasureRestoreLedgerTransactionExecutor | HuleeDatabase
): InboxV2ErasureRestoreLedgerRepository {
  const transactionExecutor =
    executor as unknown as InboxV2ErasureRestoreLedgerTransactionExecutor;

  return defineInboxV2ErasureRestoreLedgerRepository({
    append: async (input, restoreFenceInput) => {
      const entry = inboxV2ErasureRestoreLedgerEntrySchema.parse(input);
      const restoreFence = parseRepositoryRestoreFence(
        entry,
        restoreFenceInput
      );
      return transactionExecutor.transaction(async (transaction) => {
        await transaction.execute(
          buildLockInboxV2ErasureRestoreLedgerSql(entry)
        );

        const candidates = await transaction.execute<LedgerRow>(
          buildFindInboxV2ErasureRestoreLedgerCandidatesSql(entry)
        );
        const exactCandidate = candidates.rows.find(
          (row) =>
            textValue(row.ledger_entry_id) === entry.entryHash &&
            textValue(row.entry_hash) === entry.entryHash
        );
        if (exactCandidate !== undefined) {
          const relationalEntry = await loadRelationalEntry(
            transaction,
            exactCandidate
          );
          if (samePersistedEntry(relationalEntry, entry)) {
            return result({ outcome: "already_applied", entry });
          }
          return result({ outcome: "conflict", facet: "entry_id" });
        }
        if (
          candidates.rows.some(
            (row) =>
              textValue(row.ledger_entry_id) === entry.entryHash ||
              textValue(row.entry_hash) === entry.entryHash
          )
        ) {
          return result({ outcome: "conflict", facet: "entry_id" });
        }
        if (
          candidates.rows.some(
            (row) => bigintText(row.sequence) === entry.sequence
          )
        ) {
          return result({ outcome: "conflict", facet: "sequence" });
        }

        const latestResult = await transaction.execute<LedgerRow>(
          buildFindLatestInboxV2ErasureRestoreLedgerEntrySql(entry)
        );
        const chainConflict = firstChainConflict(latestResult.rows[0], entry);
        if (chainConflict !== null) {
          return result({ outcome: "conflict", facet: chainConflict });
        }

        const authorityResult = await transaction.execute<AuthorityRootRow>(
          buildFindExactInboxV2ErasureRestoreAuthorityRootSql(entry)
        );
        const authorityRoot = authorityResult.rows[0];
        if (authorityRoot === undefined) {
          return classifyAuthorityAbsence(
            await transaction.execute<AuthorityPresenceRow>(
              buildFindInboxV2ErasureRestoreAuthorityPresenceSql(entry)
            )
          );
        }
        if (
          Date.parse(entry.occurredAt) >
            Date.parse(timestampValue(authorityRoot.checked_at)) ||
          (entry.kind === "erasure_applied" &&
            entry.backupExpiry.state === "finite_expiry_pending" &&
            Date.parse(entry.backupExpiry.expiresAt) <=
              Date.parse(timestampValue(authorityRoot.checked_at)))
        ) {
          return result({ outcome: "conflict", facet: "occurred_at" });
        }

        const kindPreflight = await preflightEntryKind(
          transaction,
          entry,
          restoreFence,
          timestampValue(authorityRoot.checked_at)
        );
        if (kindPreflight.result !== null) return kindPreflight.result;

        const controlSetRows = kindPreflight.controlSetRows;
        await transaction.execute(
          buildInsertInboxV2ErasureRestoreLedgerEntrySql({
            entry,
            authorityRoot
          })
        );
        await transaction.execute(
          buildInsertInboxV2ErasureRestoreLedgerEvidenceSql(entry)
        );
        if (controlSetRows.length > 0) {
          await transaction.execute(
            buildInsertInboxV2ErasureRestoreLedgerControlsSql(
              entry,
              controlSetRows
            )
          );
        }
        if (kindPreflight.restoreMutation !== null) {
          await applyRestoreMutation(
            transaction,
            entry,
            kindPreflight.restoreMutation
          );
        }
        await transaction.execute(
          buildCheckInboxV2ErasureRestoreLedgerConstraintsSql()
        );
        return result({ outcome: "applied", entry });
      });
    }
  });
}

export function buildLockInboxV2ErasureRestoreLedgerSql(
  entry: InboxV2ErasureRestoreLedgerEntry
): SQL {
  return buildInboxV2AdvisoryXactLockSql([entry.tenantId, entry.ledgerId]);
}

export function buildFindInboxV2ErasureRestoreLedgerCandidatesSql(
  entry: InboxV2ErasureRestoreLedgerEntry
): SQL {
  return sql`
    select ledger.*,
           deletion_plan.plan_hash as deletion_plan_hash
      from inbox_v2_data_governance_erasure_restore_ledger ledger
      left join inbox_v2_data_governance_deletion_runs deletion_run
        on deletion_run.tenant_id = ledger.tenant_id
       and deletion_run.run_id = ledger.deletion_run_id
       and deletion_run.revision = ledger.deletion_run_revision
      left join inbox_v2_data_governance_deletion_plans deletion_plan
        on deletion_plan.tenant_id = deletion_run.tenant_id
       and deletion_plan.plan_id = deletion_run.plan_id
       and deletion_plan.revision = deletion_run.plan_revision
     where ledger.tenant_id = ${entry.tenantId}
       and ledger.ledger_id = ${entry.ledgerId}
       and (ledger.ledger_entry_id = ${entry.entryHash}
         or ledger.entry_hash = ${entry.entryHash}
         or ledger.sequence = ${entry.sequence})
     order by ledger.sequence
     for update of ledger
  `;
}

export function buildFindLatestInboxV2ErasureRestoreLedgerEntrySql(
  entry: InboxV2ErasureRestoreLedgerEntry
): SQL {
  return sql`
    select ledger.*
      from inbox_v2_data_governance_erasure_restore_ledger ledger
     where ledger.tenant_id = ${entry.tenantId}
       and ledger.ledger_id = ${entry.ledgerId}
     order by ledger.sequence desc
     limit 1
     for update
  `;
}

export function buildFindExactInboxV2ErasureRestoreAuthorityRootSql(
  entry: InboxV2ErasureRestoreLedgerEntry
): SQL {
  return sql`
    select registry.id as registry_id,
           registry.revision::text as registry_revision,
           root.kind as root_kind,
           root.boundary as boundary,
           clock_timestamp() as checked_at
      from inbox_v2_data_governance_registry_versions registry
      join inbox_v2_data_governance_storage_roots root
        on root.registry_id = registry.id
       and root.registry_revision = registry.revision
       and root.storage_root_id = ${entry.target.root.storageRootId}
      join inbox_v2_data_governance_contexts governance
        on governance.tenant_id = ${entry.tenantId}
       and governance.context_id = ${entry.authority.governance.id}
       and governance.version = ${entry.authority.governance.version}
       and governance.context_hash = ${entry.authority.governance.contextHash}
       and governance.registry_id = registry.id
       and governance.registry_revision = registry.revision
      join inbox_v2_data_governance_effective_policies policy
        on policy.tenant_id = governance.tenant_id
       and policy.policy_id = ${entry.authority.effectivePolicy.id}
       and policy.version = ${entry.authority.effectivePolicy.version}
       and policy.policy_hash = ${entry.authority.effectivePolicy.policyHash}
       and policy.governance_context_id = governance.context_id
       and policy.governance_context_version = governance.version
       and policy.registry_id = registry.id
       and policy.registry_revision = registry.revision
      join inbox_v2_data_governance_policy_activations activation
        on activation.tenant_id = policy.tenant_id
       and activation.activation_id = ${entry.authority.activation.id}
       and activation.revision = ${entry.authority.activation.revision}
       and activation.activation_hash = ${entry.authority.activation.activationHash}
       and activation.policy_id = policy.policy_id
       and activation.policy_version = policy.version
       and activation.candidate_policy_hash = policy.policy_hash
       and activation.governance_context_id = governance.context_id
       and activation.governance_context_version = governance.version
       and activation.governance_context_hash = governance.context_hash
     where registry.composition_hash = ${entry.authority.registryCompositionHash}
     limit 1
  `;
}

export function buildFindInboxV2ErasureRestoreAuthorityPresenceSql(
  entry: InboxV2ErasureRestoreLedgerEntry
): SQL {
  return sql`
    select exists (
      select 1 from inbox_v2_data_governance_registry_versions registry
       where registry.composition_hash = ${entry.authority.registryCompositionHash}
    ) as registry_found,
    exists (
      select 1 from inbox_v2_data_governance_contexts governance
       where governance.tenant_id = ${entry.tenantId}
         and governance.context_id = ${entry.authority.governance.id}
         and governance.version = ${entry.authority.governance.version}
         and governance.context_hash = ${entry.authority.governance.contextHash}
    ) as governance_context_found,
    exists (
      select 1 from inbox_v2_data_governance_effective_policies policy
       where policy.tenant_id = ${entry.tenantId}
         and policy.policy_id = ${entry.authority.effectivePolicy.id}
         and policy.version = ${entry.authority.effectivePolicy.version}
         and policy.policy_hash = ${entry.authority.effectivePolicy.policyHash}
    ) as effective_policy_found,
    exists (
      select 1 from inbox_v2_data_governance_policy_activations activation
       where activation.tenant_id = ${entry.tenantId}
         and activation.activation_id = ${entry.authority.activation.id}
         and activation.revision = ${entry.authority.activation.revision}
         and activation.activation_hash = ${entry.authority.activation.activationHash}
    ) as activation_found,
    exists (
      select 1
        from inbox_v2_data_governance_registry_versions registry
        join inbox_v2_data_governance_storage_roots root
          on root.registry_id = registry.id
         and root.registry_revision = registry.revision
       where registry.composition_hash = ${entry.authority.registryCompositionHash}
         and root.storage_root_id = ${entry.target.root.storageRootId}
    ) as storage_root_found
  `;
}

export function buildFindInboxV2ErasureDeletionRunSql(
  entry: Extract<InboxV2ErasureRestoreLedgerEntry, { kind: "erasure_applied" }>
): SQL {
  return sql`
    select exists (
      select 1 from inbox_v2_data_governance_deletion_runs run_row
       where run_row.tenant_id = ${entry.tenantId}
         and run_row.run_id = ${entry.deletionRun.id}
         and run_row.revision = ${entry.deletionRun.revision}
    ) as subject_found,
    exists (
      select 1
        from inbox_v2_data_governance_deletion_runs run_row
        join inbox_v2_data_governance_deletion_plans plan
          on plan.tenant_id = run_row.tenant_id
         and plan.plan_id = run_row.plan_id
         and plan.revision = run_row.plan_revision
         and plan.plan_hash = ${entry.deletionRun.planHash}
        join inbox_v2_data_governance_deletion_checkpoint_requirements requirement
          on requirement.tenant_id = run_row.tenant_id
         and requirement.plan_id = run_row.plan_id
         and requirement.plan_revision = run_row.plan_revision
         and requirement.surface = 'operated'
        join inbox_v2_data_governance_operated_checkpoint_heads checkpoint
          on checkpoint.tenant_id = run_row.tenant_id
         and checkpoint.run_id = run_row.run_id
         and checkpoint.run_revision = run_row.revision
         and checkpoint.checkpoint_id = requirement.checkpoint_id
         and checkpoint.current_outcome = 'verified_absent'
       where run_row.tenant_id = ${entry.tenantId}
         and run_row.run_id = ${entry.deletionRun.id}
         and run_row.revision = ${entry.deletionRun.revision}
         and run_row.state = 'terminal'
         and run_row.primary_absence_verified
         and requirement.storage_root_id = ${entry.target.root.storageRootId}
         and requirement.data_class_id = ${entry.target.root.dataClassId}
         and requirement.root_record_id = ${entry.target.root.recordId}
         and requirement.entity_type_id = ${entry.target.entity.entityTypeId}
         and requirement.entity_id = ${entry.target.entity.entityId}
         and requirement.expected_entity_revision = ${entry.target.entityRevision}
         and requirement.expected_lineage_revision = ${entry.target.lineageRevision}
    ) as exact_match
  `;
}

export function buildFindInboxV2ErasureRestoreControlSql(
  entry: Extract<
    InboxV2ErasureRestoreLedgerEntry,
    {
      kind:
        | "hold_applied"
        | "restriction_applied"
        | "hold_released"
        | "restriction_released"
        | "control_reapplied";
    }
  >
): SQL {
  const expectedState =
    entry.kind === "hold_released" || entry.kind === "restriction_released"
      ? "released"
      : "active";
  if (entry.control.kind === "legal_hold") {
    return sql`
      select exists (
        select 1 from inbox_v2_data_governance_legal_hold_revisions hold
         where hold.tenant_id = ${entry.tenantId}
           and hold.hold_id = ${entry.control.hold.holdId}
           and hold.revision = ${entry.control.hold.revision}
      ) as subject_found,
      exists (
        select 1
          from inbox_v2_data_governance_legal_hold_revisions hold
          join inbox_v2_data_governance_legal_hold_data_classes data_class
            on data_class.tenant_id = hold.tenant_id
           and data_class.hold_id = hold.hold_id
           and data_class.hold_revision = hold.revision
           and data_class.data_class_id = ${entry.target.root.dataClassId}
          join inbox_v2_data_governance_legal_hold_targets target
           on target.tenant_id = hold.tenant_id
           and target.hold_id = hold.hold_id
           and target.hold_revision = hold.revision
         where hold.tenant_id = ${entry.tenantId}
           and hold.hold_id = ${entry.control.hold.holdId}
           and hold.revision = ${entry.control.hold.revision}
           and hold.state = ${expectedState}
           and target.state = ${expectedState}
           and target.storage_root_id = ${entry.target.root.storageRootId}
           and target.root_record_id = ${entry.target.root.recordId}
           and target.entity_type_id = ${entry.target.entity.entityTypeId}
           and target.entity_id = ${entry.target.entity.entityId}
           and target.expected_entity_revision = ${entry.target.entityRevision}
           and target.expected_lineage_revision = ${entry.target.lineageRevision}
      ) as exact_match
    `;
  }
  return sql`
    select exists (
      select 1 from inbox_v2_data_governance_restriction_revisions restriction
       where restriction.tenant_id = ${entry.tenantId}
         and restriction.restriction_id = ${entry.control.restriction.restrictionId}
         and restriction.revision = ${entry.control.restriction.revision}
    ) as subject_found,
    exists (
      select 1
        from inbox_v2_data_governance_restriction_revisions restriction
        join inbox_v2_data_governance_scope_manifest_roots target
          on target.tenant_id = restriction.tenant_id
         and target.manifest_id = restriction.scope_manifest_id
         and target.manifest_revision = restriction.scope_manifest_revision
       where restriction.tenant_id = ${entry.tenantId}
         and restriction.restriction_id = ${entry.control.restriction.restrictionId}
         and restriction.revision = ${entry.control.restriction.revision}
         and restriction.state = ${expectedState}
         and target.storage_root_id = ${entry.target.root.storageRootId}
         and target.data_class_id = ${entry.target.root.dataClassId}
         and target.root_record_id = ${entry.target.root.recordId}
         and target.entity_type_id = ${entry.target.entity.entityTypeId}
         and target.entity_id = ${entry.target.entity.entityId}
         and target.expected_entity_revision = ${entry.target.entityRevision}
         and target.expected_lineage_revision = ${entry.target.lineageRevision}
    ) as exact_match
  `;
}

export function buildFindInboxV2ErasureRestoreSourceErasureSql(
  entry: Extract<
    InboxV2ErasureRestoreLedgerEntry,
    { kind: "restore_opened" | "restore_sealed" }
  >
): SQL {
  return sql`
    select source.*
      from inbox_v2_data_governance_erasure_restore_ledger source
     where source.tenant_id = ${entry.tenantId}
       and source.ledger_id = ${entry.ledgerId}
       and source.entry_hash = ${entry.sourceErasureEntryHash}
       and source.kind = 'erasure_applied'
       and source.storage_root_id = ${entry.target.root.storageRootId}
       and source.data_class_id = ${entry.target.root.dataClassId}
       and source.root_record_id = ${entry.target.root.recordId}
       and source.entity_type_id = ${entry.target.entity.entityTypeId}
       and source.entity_id = ${entry.target.entity.entityId}
       and source.entity_revision = ${entry.target.entityRevision}
       and source.lineage_revision = ${entry.target.lineageRevision}
       and source.sequence < ${entry.sequence}
     limit 1
  `;
}

export function buildFindInboxV2OpenedRestoreSql(
  entry: Extract<
    InboxV2ErasureRestoreLedgerEntry,
    { kind: "restore_opened" | "control_reapplied" | "restore_sealed" }
  >
): SQL {
  return sql`
    select opened.*
      from inbox_v2_data_governance_erasure_restore_ledger opened
     where opened.tenant_id = ${entry.tenantId}
       and opened.ledger_id = ${entry.ledgerId}
       and opened.restore_id = ${entry.restoreId}
       and opened.kind = 'restore_opened'
       and opened.sequence < ${entry.sequence}
     order by opened.sequence
     limit 1
  `;
}

export function buildFindInboxV2AppliedControlEntriesSql(
  entry: InboxV2ErasureRestoreLedgerEntry,
  hashes: readonly string[]
): SQL {
  if (hashes.length === 0) {
    return sql`select null::text as entry_hash, null::text as control_kind, null::text as control_id, null::text as control_revision where false`;
  }
  return sql`
    select control.entry_hash,
           control.control_kind,
           control.control_id,
           control.control_revision::text as control_revision
      from inbox_v2_data_governance_erasure_restore_ledger control
     where control.tenant_id = ${entry.tenantId}
       and control.ledger_id = ${entry.ledgerId}
       and control.entry_hash in (${sql.join(
         hashes.map((hash) => sql`${hash}`),
         sql`, `
       )})
       and control.kind in ('hold_applied', 'restriction_applied')
       and control.storage_root_id = ${entry.target.root.storageRootId}
       and control.data_class_id = ${entry.target.root.dataClassId}
       and control.root_record_id = ${entry.target.root.recordId}
       and control.entity_type_id = ${entry.target.entity.entityTypeId}
       and control.entity_id = ${entry.target.entity.entityId}
       and control.entity_revision = ${entry.target.entityRevision}
       and control.lineage_revision = ${entry.target.lineageRevision}
       and control.sequence < ${entry.sequence}
     order by control.entry_hash
  `;
}

export function buildFindInboxV2RestoreChainStateSql(
  entry: Extract<
    InboxV2ErasureRestoreLedgerEntry,
    { kind: "control_reapplied" }
  >
): SQL {
  return sql`
    select exists (
      select 1 from inbox_v2_data_governance_erasure_restore_ledger duplicate
       where duplicate.tenant_id = ${entry.tenantId}
         and duplicate.ledger_id = ${entry.ledgerId}
         and duplicate.restore_id = ${entry.restoreId}
         and duplicate.kind = 'control_reapplied'
         and duplicate.source_control_entry_hash = ${entry.sourceControlEntryHash}
    ) as duplicate_reapplication,
    exists (
      select 1 from inbox_v2_data_governance_erasure_restore_ledger sealed
       where sealed.tenant_id = ${entry.tenantId}
         and sealed.ledger_id = ${entry.ledgerId}
         and sealed.restore_id = ${entry.restoreId}
         and sealed.kind = 'restore_sealed'
    ) as sealed
  `;
}

export function buildFindInboxV2RestoreReapplicationsSql(
  entry: Extract<InboxV2ErasureRestoreLedgerEntry, { kind: "restore_sealed" }>
): SQL {
  return sql`
    select reapplied.source_control_entry_hash
      from inbox_v2_data_governance_erasure_restore_ledger reapplied
     where reapplied.tenant_id = ${entry.tenantId}
       and reapplied.ledger_id = ${entry.ledgerId}
       and reapplied.restore_id = ${entry.restoreId}
       and reapplied.kind = 'control_reapplied'
       and reapplied.sequence < ${entry.sequence}
     order by reapplied.source_control_entry_hash
  `;
}

export function buildFindInboxV2RestoreControlSetFenceSql(
  entry: Extract<
    InboxV2ErasureRestoreLedgerEntry,
    { kind: "restore_opened" | "control_reapplied" | "restore_sealed" }
  >
): SQL {
  return sql`
    select control_set.legal_hold_set_revision,
           control_set.restriction_set_revision,
           control_set.last_changed_stream_position,
           control_set.head_revision
      from inbox_v2_data_governance_control_set_heads control_set
     where control_set.tenant_id = ${entry.tenantId}
     for update
  `;
}

/**
 * Selects the exact currently active control set. Released heads are excluded
 * even when an older backup still contains their prior application ledger row.
 */
export function buildFindInboxV2CurrentRestoreControlsSql(
  entry: Extract<
    InboxV2ErasureRestoreLedgerEntry,
    { kind: "restore_opened" | "control_reapplied" | "restore_sealed" }
  >
): SQL {
  const target = entry.target;
  return sql`
    select current_control.entry_hash,
           current_control.control_kind,
           current_control.control_id,
           current_control.control_revision,
           current_control.control_head_revision
      from (
        select applied.entry_hash,
               'legal_hold'::text as control_kind,
               head.hold_id as control_id,
               applied.control_revision::text as control_revision,
               applied.sequence::text as control_head_revision
          from inbox_v2_data_governance_legal_hold_heads head
          join inbox_v2_data_governance_legal_hold_revisions revision
            on revision.tenant_id = head.tenant_id
           and revision.hold_id = head.hold_id
           and revision.revision = head.current_revision
           and revision.state = 'active'
           and revision.scope_kind = 'exact'
          join inbox_v2_data_governance_legal_hold_data_classes data_class
            on data_class.tenant_id = revision.tenant_id
           and data_class.hold_id = revision.hold_id
           and data_class.hold_revision = revision.revision
           and data_class.data_class_id = ${target.root.dataClassId}
          join inbox_v2_data_governance_legal_hold_targets exact_target
            on exact_target.tenant_id = revision.tenant_id
           and exact_target.hold_id = revision.hold_id
           and exact_target.hold_revision = revision.revision
           and exact_target.state = 'active'
           and exact_target.storage_root_id = ${target.root.storageRootId}
           and exact_target.root_record_id = ${target.root.recordId}
           and exact_target.entity_type_id = ${target.entity.entityTypeId}
           and exact_target.entity_id = ${target.entity.entityId}
           and exact_target.expected_entity_revision = ${target.entityRevision}
           and exact_target.expected_lineage_revision = ${target.lineageRevision}
          left join lateral (
            select ledger.entry_hash,
                   ledger.kind,
                   ledger.control_revision,
                   ledger.sequence
              from inbox_v2_data_governance_erasure_restore_ledger ledger
             where ledger.tenant_id = head.tenant_id
               and ledger.ledger_id = ${entry.ledgerId}
               and ledger.kind in ('hold_applied', 'hold_released')
               and ledger.control_kind = 'legal_hold'
               and ledger.control_id = head.hold_id
               and ledger.storage_root_id = ${target.root.storageRootId}
               and ledger.data_class_id = ${target.root.dataClassId}
               and ledger.root_record_id = ${target.root.recordId}
               and ledger.entity_type_id = ${target.entity.entityTypeId}
               and ledger.entity_id = ${target.entity.entityId}
               and ledger.entity_revision = ${target.entityRevision}
               and ledger.lineage_revision = ${target.lineageRevision}
               and ledger.sequence < ${entry.sequence}
             order by ledger.sequence desc
             limit 1
          ) applied on true
         where head.tenant_id = ${entry.tenantId}
           and head.state = 'active'
           and (applied.kind is null or applied.kind = 'hold_applied')

        union all

        select applied.entry_hash,
               'restriction'::text as control_kind,
               head.restriction_id as control_id,
               applied.control_revision::text as control_revision,
               applied.sequence::text as control_head_revision
          from inbox_v2_data_governance_restriction_heads head
          join inbox_v2_data_governance_restriction_revisions revision
            on revision.tenant_id = head.tenant_id
           and revision.restriction_id = head.restriction_id
           and revision.revision = head.current_revision
           and revision.state = 'active'
           and revision.scope_kind = 'exact'
          join inbox_v2_data_governance_scope_manifest_roots exact_target
            on exact_target.tenant_id = revision.tenant_id
           and exact_target.manifest_id = revision.scope_manifest_id
           and exact_target.manifest_revision = revision.scope_manifest_revision
           and exact_target.storage_root_id = ${target.root.storageRootId}
           and exact_target.data_class_id = ${target.root.dataClassId}
           and exact_target.root_record_id = ${target.root.recordId}
           and exact_target.entity_type_id = ${target.entity.entityTypeId}
           and exact_target.entity_id = ${target.entity.entityId}
           and exact_target.expected_entity_revision = ${target.entityRevision}
           and exact_target.expected_lineage_revision = ${target.lineageRevision}
          left join lateral (
            select ledger.entry_hash,
                   ledger.kind,
                   ledger.control_revision,
                   ledger.sequence
              from inbox_v2_data_governance_erasure_restore_ledger ledger
             where ledger.tenant_id = head.tenant_id
               and ledger.ledger_id = ${entry.ledgerId}
               and ledger.kind in (
                 'restriction_applied', 'restriction_released'
               )
               and ledger.control_kind = 'restriction'
               and ledger.control_id = head.restriction_id
               and ledger.storage_root_id = ${target.root.storageRootId}
               and ledger.data_class_id = ${target.root.dataClassId}
               and ledger.root_record_id = ${target.root.recordId}
               and ledger.entity_type_id = ${target.entity.entityTypeId}
               and ledger.entity_id = ${target.entity.entityId}
               and ledger.entity_revision = ${target.entityRevision}
               and ledger.lineage_revision = ${target.lineageRevision}
               and ledger.sequence < ${entry.sequence}
             order by ledger.sequence desc
             limit 1
          ) applied on true
         where head.tenant_id = ${entry.tenantId}
           and head.state = 'active'
           and (
             applied.kind is null or applied.kind = 'restriction_applied'
           )
      ) current_control
     order by current_control.control_kind,
              current_control.control_id,
              current_control.control_revision
  `;
}

export function buildFindInboxV2ProspectiveRestoreControlsSql(
  entry: Extract<
    InboxV2ErasureRestoreLedgerEntry,
    { kind: "restore_opened" | "control_reapplied" | "restore_sealed" }
  >
): SQL {
  return sql`
    select exists (
      select 1
        from inbox_v2_data_governance_legal_hold_heads head
        join inbox_v2_data_governance_legal_hold_revisions revision
          on revision.tenant_id = head.tenant_id
         and revision.hold_id = head.hold_id
         and revision.revision = head.current_revision
        join inbox_v2_data_governance_legal_hold_data_classes data_class
          on data_class.tenant_id = revision.tenant_id
         and data_class.hold_id = revision.hold_id
         and data_class.hold_revision = revision.revision
         and data_class.data_class_id = ${entry.target.root.dataClassId}
       where head.tenant_id = ${entry.tenantId}
         and head.state = 'active'
         and revision.state = 'active'
         and revision.scope_kind = 'prospective'
    ) as prospective_legal_hold,
    exists (
      select 1
        from inbox_v2_data_governance_restriction_heads head
        join inbox_v2_data_governance_restriction_revisions revision
          on revision.tenant_id = head.tenant_id
         and revision.restriction_id = head.restriction_id
         and revision.revision = head.current_revision
       where head.tenant_id = ${entry.tenantId}
         and head.state = 'active'
         and revision.state = 'active'
         and revision.scope_kind = 'prospective'
    ) as prospective_restriction
  `;
}

export function buildFindInboxV2RestoreAuthoritySql(
  entry: Extract<
    InboxV2ErasureRestoreLedgerEntry,
    { kind: "restore_opened" | "control_reapplied" | "restore_sealed" }
  >
): SQL {
  return sql`
    select restore_head.state as restore_state,
           restore_head.head_revision,
           restore_head.source_erasure_entry_hash,
           restore_head.storage_root_id,
           restore_head.data_class_id,
           restore_head.root_record_id,
           restore_head.entity_type_id,
           restore_head.entity_id,
           restore_head.entity_revision,
           restore_head.lineage_revision,
           restore_head.opened_sequence,
           restore_head.required_control_set_hash,
           restore_head.required_control_count,
           restore_head.legal_hold_set_revision as stored_legal_hold_set_revision,
           restore_head.restriction_set_revision as stored_restriction_set_revision,
           restore_head.control_set_head_revision as stored_control_set_head_revision,
           restore_head.control_set_stream_position as stored_control_set_stream_position,
           restore_lease.lease_revision,
           restore_lease.restore_head_revision,
           restore_lease.state as lease_state,
           restore_lease.lease_token_hash,
           restore_lease.lease_expires_at,
           control_set.legal_hold_set_revision as current_legal_hold_set_revision,
           control_set.restriction_set_revision as current_restriction_set_revision,
           control_set.head_revision as current_control_set_head_revision,
           control_set.last_changed_stream_position as current_control_set_stream_position
      from inbox_v2_data_governance_restore_heads restore_head
      join inbox_v2_data_governance_restore_leases restore_lease
        on restore_lease.tenant_id = restore_head.tenant_id
       and restore_lease.ledger_id = restore_head.ledger_id
       and restore_lease.restore_id = restore_head.restore_id
      join inbox_v2_data_governance_control_set_heads control_set
        on control_set.tenant_id = restore_head.tenant_id
     where restore_head.tenant_id = ${entry.tenantId}
       and restore_head.ledger_id = ${entry.ledgerId}
       and restore_head.restore_id = ${entry.restoreId}
     for update of restore_head, restore_lease, control_set
  `;
}

export function buildFindInboxV2RestoreRequiredControlsSql(
  entry: Extract<
    InboxV2ErasureRestoreLedgerEntry,
    { kind: "control_reapplied" | "restore_sealed" }
  >
): SQL {
  return sql`
    select required.control_kind,
           required.control_id,
           required.control_revision,
           required.control_head_revision,
           required.source_control_entry_hash,
           required.row_revision,
           required.reapplied_entry_hash
      from inbox_v2_data_governance_restore_required_controls required
     where required.tenant_id = ${entry.tenantId}
       and required.ledger_id = ${entry.ledgerId}
       and required.restore_id = ${entry.restoreId}
     order by required.control_kind,
              required.control_id,
              required.control_revision
     for update
  `;
}

export function buildFindInboxV2InterveningRestoreControlSql(
  entry: Extract<
    InboxV2ErasureRestoreLedgerEntry,
    { kind: "control_reapplied" | "restore_sealed" }
  >,
  openedSequence: string
): SQL {
  return sql`
    select exists (
      select 1
        from inbox_v2_data_governance_erasure_restore_ledger control_entry
       where control_entry.tenant_id = ${entry.tenantId}
         and control_entry.ledger_id = ${entry.ledgerId}
         and control_entry.kind in (
           'hold_applied', 'restriction_applied',
           'hold_released', 'restriction_released'
         )
         and control_entry.storage_root_id = ${entry.target.root.storageRootId}
         and control_entry.data_class_id = ${entry.target.root.dataClassId}
         and control_entry.root_record_id = ${entry.target.root.recordId}
         and control_entry.entity_type_id = ${entry.target.entity.entityTypeId}
         and control_entry.entity_id = ${entry.target.entity.entityId}
         and control_entry.entity_revision = ${entry.target.entityRevision}
         and control_entry.lineage_revision = ${entry.target.lineageRevision}
         and control_entry.sequence > ${openedSequence}
         and control_entry.sequence < ${entry.sequence}
    ) as found
  `;
}

export function buildInsertInboxV2ErasureRestoreLedgerEntrySql(input: {
  entry: InboxV2ErasureRestoreLedgerEntry;
  authorityRoot: AuthorityRootRow;
}): SQL {
  const { entry } = input;
  const values = entryValues(entry);
  return sql`
    insert into inbox_v2_data_governance_erasure_restore_ledger (
      tenant_id, ledger_id, ledger_entry_id, sequence, kind,
      registry_id, registry_revision, registry_composition_hash,
      governance_context_id, governance_context_version, governance_context_hash,
      policy_id, policy_version, policy_hash,
      activation_id, activation_revision, activation_hash,
      storage_root_id, root_kind, boundary, data_class_id, root_record_id,
      entity_type_id, entity_id, entity_revision, lineage_revision,
      deletion_run_id, deletion_run_revision,
      control_kind, control_id, control_revision, restore_id,
      primary_absence_verified, primary_absence_verified_at,
      primary_verification_handler_id, backup_expiry_state,
      backup_latest_possible_expiry_at, backup_verified_at,
      control_applied_at, control_released_at,
      control_reapplied_at, restore_sealed_at,
      required_control_hash, reapplied_control_hash,
      source_erasure_entry_hash, source_control_entry_hash,
      stream_epoch, sync_generation, complete_through_position,
      previous_entry_hash, entry_hash, occurred_at, recorded_at
    ) values (
      ${entry.tenantId}, ${entry.ledgerId}, ${entry.entryHash}, ${entry.sequence}, ${entry.kind},
      ${textValue(input.authorityRoot.registry_id)}, ${bigintText(input.authorityRoot.registry_revision)}, ${entry.authority.registryCompositionHash},
      ${entry.authority.governance.id}, ${entry.authority.governance.version}, ${entry.authority.governance.contextHash},
      ${entry.authority.effectivePolicy.id}, ${entry.authority.effectivePolicy.version}, ${entry.authority.effectivePolicy.policyHash},
      ${entry.authority.activation.id}, ${entry.authority.activation.revision}, ${entry.authority.activation.activationHash},
      ${entry.target.root.storageRootId}, ${textValue(input.authorityRoot.root_kind)}, ${textValue(input.authorityRoot.boundary)}, ${entry.target.root.dataClassId}, ${entry.target.root.recordId},
      ${entry.target.entity.entityTypeId}, ${entry.target.entity.entityId}, ${entry.target.entityRevision}, ${entry.target.lineageRevision},
      ${values.deletionRunId}, ${values.deletionRunRevision},
      ${values.controlKind}, ${values.controlId}, ${values.controlRevision}, ${values.restoreId},
      ${values.primaryAbsenceVerified}, ${values.primaryAbsenceVerifiedAt},
      ${values.primaryVerificationHandlerId}, ${values.backupExpiryState},
      ${values.backupLatestPossibleExpiryAt}, ${values.backupVerifiedAt},
      ${values.controlAppliedAt}, ${values.controlReleasedAt},
      ${values.controlReappliedAt}, ${values.restoreSealedAt},
      ${values.requiredControlHash}, ${values.reappliedControlHash},
      ${values.sourceErasureEntryHash}, ${values.sourceControlEntryHash},
      ${entry.highWater.streamEpoch}, ${entry.highWater.syncGeneration}, ${entry.highWater.completeThrough},
      ${entry.previousEntryHash}, ${entry.entryHash}, ${entry.occurredAt}, clock_timestamp()
    )
  `;
}

export function buildInsertInboxV2ErasureRestoreLedgerEvidenceSql(
  entry: InboxV2ErasureRestoreLedgerEntry
): SQL {
  const rows = evidenceForEntry(entry);
  return sql`
    insert into inbox_v2_data_governance_erasure_restore_ledger_evidence (
      tenant_id, ledger_id, ledger_entry_id, slot, kind, digest,
      payload_tenant_id, payload_record_id, payload_schema_id, payload_schema_version
    ) values ${sql.join(
      rows.map(({ slot, evidence }) => {
        const payload =
          evidence.kind === "payload_reference" ? evidence.payload : null;
        return sql`(
          ${entry.tenantId}, ${entry.ledgerId}, ${entry.entryHash}, ${slot},
          ${evidence.kind}, ${evidence.kind === "digest" ? evidence.digest : evidence.payload.digest},
          ${payload?.tenantId ?? null}, ${payload?.recordId ?? null},
          ${payload?.schemaId ?? null}, ${payload?.schemaVersion ?? null}
        )`;
      }),
      sql`, `
    )}
  `;
}

export function buildInsertInboxV2ErasureRestoreLedgerControlsSql(
  entry: InboxV2ErasureRestoreLedgerEntry,
  rows: readonly ControlSetInsert[]
): SQL {
  return sql`
    insert into inbox_v2_data_governance_erasure_restore_ledger_controls (
      tenant_id, ledger_id, ledger_entry_id, role,
      control_kind, control_id, control_revision, control_entry_hash
    ) values ${sql.join(
      rows.map(
        (row) => sql`(
          ${entry.tenantId}, ${entry.ledgerId}, ${entry.entryHash}, ${row.role},
          ${row.controlKind}, ${row.controlId}, ${row.controlRevision}, ${row.controlEntryHash}
        )`
      ),
      sql`, `
    )}
  `;
}

async function applyRestoreMutation(
  transaction: RawSqlExecutor,
  entry: InboxV2ErasureRestoreLedgerEntry,
  mutation: RestoreMutationPlan
): Promise<void> {
  if (mutation.kind === "open_restore") {
    if (entry.kind !== "restore_opened") {
      throw new Error("Restore-open mutation/entry kind mismatch.");
    }
    await requireOneRestoreMutation(
      transaction,
      buildInsertInboxV2RestoreHeadSql(entry, mutation)
    );
    if (mutation.requiredControls.length > 0) {
      await transaction.execute(
        buildInsertInboxV2RestoreRequiredControlsSql(entry, mutation)
      );
    }
    await requireOneRestoreMutation(
      transaction,
      buildInsertInboxV2RestoreLeaseSql(entry, mutation)
    );
    return;
  }
  if (mutation.kind === "reapply_control") {
    if (entry.kind !== "control_reapplied") {
      throw new Error("Control-reapplication mutation/entry kind mismatch.");
    }
    await requireOneRestoreMutation(
      transaction,
      buildReapplyInboxV2RestoreControlSql(entry, mutation)
    );
    await requireOneRestoreMutation(
      transaction,
      buildAdvanceInboxV2RestoreHeadSql(entry, mutation)
    );
    await requireOneRestoreMutation(
      transaction,
      buildAdvanceInboxV2RestoreLeaseSql(entry, mutation)
    );
    return;
  }
  if (entry.kind !== "restore_sealed") {
    throw new Error("Restore-seal mutation/entry kind mismatch.");
  }
  await requireOneRestoreMutation(
    transaction,
    buildSealInboxV2RestoreHeadSql(entry, mutation)
  );
  await requireOneRestoreMutation(
    transaction,
    buildCompleteInboxV2RestoreLeaseSql(entry, mutation)
  );
}

export function buildInsertInboxV2RestoreHeadSql(
  entry: Extract<InboxV2ErasureRestoreLedgerEntry, { kind: "restore_opened" }>,
  mutation: Extract<RestoreMutationPlan, { kind: "open_restore" }>
): SQL {
  const controlSet = mutation.controlSet;
  return sql`
    insert into inbox_v2_data_governance_restore_heads (
      tenant_id, ledger_id, restore_id, state, head_revision,
      source_erasure_entry_hash, source_erasure_sequence,
      storage_root_id, data_class_id, root_record_id,
      entity_type_id, entity_id, entity_revision, lineage_revision,
      opened_entry_hash, opened_sequence, opened_stream_epoch,
      opened_sync_generation, opened_complete_through_position,
      control_set_head_revision, legal_hold_set_revision,
      restriction_set_revision, control_set_stream_position,
      required_control_set_hash, required_control_count,
      opened_at, updated_at
    ) values (
      ${entry.tenantId}, ${entry.ledgerId}, ${entry.restoreId}, 'open', 1,
      ${entry.sourceErasureEntryHash}, ${mutation.sourceErasureSequence},
      ${entry.target.root.storageRootId}, ${entry.target.root.dataClassId}, ${entry.target.root.recordId},
      ${entry.target.entity.entityTypeId}, ${entry.target.entity.entityId},
      ${entry.target.entityRevision}, ${entry.target.lineageRevision},
      ${entry.entryHash}, ${entry.sequence}, ${entry.highWater.streamEpoch},
      ${entry.highWater.syncGeneration}, ${entry.highWater.completeThrough},
      ${bigintText(controlSet.head_revision)},
      ${bigintText(controlSet.legal_hold_set_revision)},
      ${bigintText(controlSet.restriction_set_revision)},
      ${bigintText(controlSet.last_changed_stream_position)},
      ${controlSetHash(entry.reapplication.requiredControlEntryHashes)},
      ${mutation.requiredControls.length}, ${entry.occurredAt}, ${mutation.checkedAt}
    )
    returning restore_id
  `;
}

export function buildInsertInboxV2RestoreRequiredControlsSql(
  entry: Extract<InboxV2ErasureRestoreLedgerEntry, { kind: "restore_opened" }>,
  mutation: Extract<RestoreMutationPlan, { kind: "open_restore" }>
): SQL {
  return sql`
    insert into inbox_v2_data_governance_restore_required_controls (
      tenant_id, ledger_id, restore_id, control_kind, control_id,
      control_revision, control_head_revision, source_control_entry_hash,
      row_revision
    ) values ${sql.join(
      mutation.requiredControls.map(
        (control) => sql`(
          ${entry.tenantId}, ${entry.ledgerId}, ${entry.restoreId},
          ${control.controlKind}, ${control.controlId}, ${control.controlRevision},
          ${control.controlHeadRevision}, ${control.controlEntryHash}, 1
        )`
      ),
      sql`, `
    )}
  `;
}

export function buildInsertInboxV2RestoreLeaseSql(
  entry: Extract<InboxV2ErasureRestoreLedgerEntry, { kind: "restore_opened" }>,
  mutation: Extract<RestoreMutationPlan, { kind: "open_restore" }>
): SQL {
  const leaseExpiresAt = new Date(
    Date.parse(mutation.checkedAt) + mutation.fence.leaseDurationSeconds * 1_000
  ).toISOString();
  return sql`
    insert into inbox_v2_data_governance_restore_leases (
      tenant_id, ledger_id, restore_id, lease_revision,
      restore_head_revision, state, lease_token_hash,
      claimed_at, lease_expires_at, updated_at
    ) values (
      ${entry.tenantId}, ${entry.ledgerId}, ${entry.restoreId}, 1, 1, 'active',
      ${calculateInboxV2ErasureRestoreLeaseTokenHash(mutation.fence.leaseToken)},
      ${mutation.checkedAt}, ${leaseExpiresAt}, ${mutation.checkedAt}
    )
    returning restore_id
  `;
}

export function buildReapplyInboxV2RestoreControlSql(
  entry: Extract<
    InboxV2ErasureRestoreLedgerEntry,
    { kind: "control_reapplied" }
  >,
  _mutation: Extract<RestoreMutationPlan, { kind: "reapply_control" }>
): SQL {
  return sql`
    update inbox_v2_data_governance_restore_required_controls
       set row_revision = row_revision + 1,
           reapplied_entry_hash = ${entry.entryHash},
           reapplied_at = ${entry.reapplication.reappliedAt}
     where tenant_id = ${entry.tenantId}
       and ledger_id = ${entry.ledgerId}
       and restore_id = ${entry.restoreId}
       and source_control_entry_hash = ${entry.sourceControlEntryHash}
       and row_revision = 1
       and reapplied_entry_hash is null
       and reapplied_at is null
    returning restore_id
  `;
}

export function buildAdvanceInboxV2RestoreHeadSql(
  entry: Extract<
    InboxV2ErasureRestoreLedgerEntry,
    { kind: "control_reapplied" }
  >,
  mutation: Extract<RestoreMutationPlan, { kind: "reapply_control" }>
): SQL {
  return sql`
    update inbox_v2_data_governance_restore_heads
       set head_revision = head_revision + 1,
           updated_at = ${mutation.checkedAt}
     where tenant_id = ${entry.tenantId}
       and ledger_id = ${entry.ledgerId}
       and restore_id = ${entry.restoreId}
       and state = 'open'
       and head_revision = ${mutation.fence.expectedHeadRevision}
    returning restore_id
  `;
}

export function buildAdvanceInboxV2RestoreLeaseSql(
  entry: Extract<
    InboxV2ErasureRestoreLedgerEntry,
    { kind: "control_reapplied" }
  >,
  mutation: Extract<RestoreMutationPlan, { kind: "reapply_control" }>
): SQL {
  return sql`
    update inbox_v2_data_governance_restore_leases
       set lease_revision = lease_revision + 1,
           restore_head_revision = restore_head_revision + 1,
           updated_at = ${mutation.checkedAt}
     where tenant_id = ${entry.tenantId}
       and ledger_id = ${entry.ledgerId}
       and restore_id = ${entry.restoreId}
       and state = 'active'
       and lease_revision = ${mutation.fence.expectedLeaseRevision}
       and restore_head_revision = ${mutation.fence.expectedHeadRevision}
       and lease_token_hash = ${calculateInboxV2ErasureRestoreLeaseTokenHash(
         mutation.fence.leaseToken
       )}
       and lease_expires_at > ${mutation.checkedAt}
    returning restore_id
  `;
}

export function buildSealInboxV2RestoreHeadSql(
  entry: Extract<InboxV2ErasureRestoreLedgerEntry, { kind: "restore_sealed" }>,
  mutation: Extract<RestoreMutationPlan, { kind: "seal_restore" }>
): SQL {
  return sql`
    update inbox_v2_data_governance_restore_heads
       set state = 'sealed',
           head_revision = head_revision + 1,
           sealed_entry_hash = ${entry.entryHash},
           sealed_sequence = ${entry.sequence},
           sealed_at = ${entry.reapplication.sealedAt},
           updated_at = ${mutation.checkedAt}
     where tenant_id = ${entry.tenantId}
       and ledger_id = ${entry.ledgerId}
       and restore_id = ${entry.restoreId}
       and state = 'open'
       and head_revision = ${mutation.fence.expectedHeadRevision}
    returning restore_id
  `;
}

export function buildCompleteInboxV2RestoreLeaseSql(
  entry: Extract<InboxV2ErasureRestoreLedgerEntry, { kind: "restore_sealed" }>,
  mutation: Extract<RestoreMutationPlan, { kind: "seal_restore" }>
): SQL {
  return sql`
    update inbox_v2_data_governance_restore_leases
       set lease_revision = lease_revision + 1,
           restore_head_revision = restore_head_revision + 1,
           state = 'completed',
           completed_at = ${mutation.checkedAt},
           updated_at = ${mutation.checkedAt}
     where tenant_id = ${entry.tenantId}
       and ledger_id = ${entry.ledgerId}
       and restore_id = ${entry.restoreId}
       and state = 'active'
       and lease_revision = ${mutation.fence.expectedLeaseRevision}
       and restore_head_revision = ${mutation.fence.expectedHeadRevision}
       and lease_token_hash = ${calculateInboxV2ErasureRestoreLeaseTokenHash(
         mutation.fence.leaseToken
       )}
       and lease_expires_at > ${mutation.checkedAt}
    returning restore_id
  `;
}

async function requireOneRestoreMutation(
  transaction: RawSqlExecutor,
  statement: SQL
): Promise<void> {
  const applied = await transaction.execute<{ restore_id: unknown }>(statement);
  if (applied.rows.length !== 1) {
    throw new Error("Restore CAS mutation lost its locked database authority.");
  }
}

export function buildCheckInboxV2ErasureRestoreLedgerConstraintsSql(): SQL {
  return sql.raw("set constraints all immediate");
}

async function preflightEntryKind(
  transaction: RawSqlExecutor,
  entry: InboxV2ErasureRestoreLedgerEntry,
  restoreFence: InboxV2ErasureRestoreAppendFence | undefined,
  checkedAt: string
): Promise<{
  result: InboxV2ErasureRestoreLedgerAppendResult | null;
  controlSetRows: ControlSetInsert[];
  restoreMutation: RestoreMutationPlan | null;
}> {
  if (entry.kind === "erasure_applied") {
    const exact = firstRow(
      await transaction.execute<ExactPresenceRow>(
        buildFindInboxV2ErasureDeletionRunSql(entry)
      )
    );
    if (!booleanValue(exact.subject_found)) {
      return {
        result: result({ outcome: "not_found", subject: "deletion_run" }),
        controlSetRows: [],
        restoreMutation: null
      };
    }
    if (!booleanValue(exact.exact_match)) {
      return {
        result: result({ outcome: "conflict", facet: "target" }),
        controlSetRows: [],
        restoreMutation: null
      };
    }
    return { result: null, controlSetRows: [], restoreMutation: null };
  }

  if (
    entry.kind === "restore_opened" ||
    entry.kind === "control_reapplied" ||
    entry.kind === "restore_sealed"
  ) {
    return preflightDbOwnedRestoreMutation(
      transaction,
      entry,
      requiredRestoreFence(restoreFence),
      checkedAt
    );
  }

  if (
    entry.kind === "hold_applied" ||
    entry.kind === "restriction_applied" ||
    entry.kind === "hold_released" ||
    entry.kind === "restriction_released"
  ) {
    const exact = firstRow(
      await transaction.execute<ExactPresenceRow>(
        buildFindInboxV2ErasureRestoreControlSql(entry)
      )
    );
    if (!booleanValue(exact.subject_found)) {
      return {
        result: result({ outcome: "not_found", subject: "control" }),
        controlSetRows: [],
        restoreMutation: null
      };
    }
    if (!booleanValue(exact.exact_match)) {
      return {
        result: result({ outcome: "conflict", facet: "target" }),
        controlSetRows: [],
        restoreMutation: null
      };
    }
  }

  if (
    entry.kind === "hold_applied" ||
    entry.kind === "restriction_applied" ||
    entry.kind === "hold_released" ||
    entry.kind === "restriction_released"
  ) {
    return { result: null, controlSetRows: [], restoreMutation: null };
  }
  throw new Error("Unsupported erasure/restore ledger kind.");
}

function parseRepositoryRestoreFence(
  entry: InboxV2ErasureRestoreLedgerEntry,
  input: Readonly<InboxV2ErasureRestoreAppendFence> | undefined
): InboxV2ErasureRestoreAppendFence | undefined {
  const restoreOperation =
    entry.kind === "restore_opened"
      ? "open_restore"
      : entry.kind === "control_reapplied"
        ? "reapply_control"
        : entry.kind === "restore_sealed"
          ? "seal_restore"
          : null;
  if (restoreOperation === null) {
    if (input !== undefined) {
      throw new Error("A restore fence cannot authorize a non-restore entry.");
    }
    return undefined;
  }
  if (input === undefined) {
    throw new Error("Restore ledger mutation requires a database lease fence.");
  }
  const fence = inboxV2ErasureRestoreAppendFenceSchema.parse(input);
  const restoreId =
    entry.kind === "restore_opened" ||
    entry.kind === "control_reapplied" ||
    entry.kind === "restore_sealed"
      ? entry.restoreId
      : null;
  if (fence.operation !== restoreOperation || fence.restoreId !== restoreId) {
    throw new Error("Restore lease fence does not match the ledger mutation.");
  }
  return fence;
}

function requiredRestoreFence(
  fence: InboxV2ErasureRestoreAppendFence | undefined
): InboxV2ErasureRestoreAppendFence {
  if (fence === undefined) {
    throw new Error("Restore ledger mutation requires a database lease fence.");
  }
  return fence;
}

async function preflightDbOwnedRestoreMutation(
  transaction: RawSqlExecutor,
  entry: Extract<
    InboxV2ErasureRestoreLedgerEntry,
    { kind: "restore_opened" | "control_reapplied" | "restore_sealed" }
  >,
  restoreFence: InboxV2ErasureRestoreAppendFence,
  checkedAt: string
): Promise<{
  result: InboxV2ErasureRestoreLedgerAppendResult | null;
  controlSetRows: ControlSetInsert[];
  restoreMutation: RestoreMutationPlan | null;
}> {
  const controlSet = (
    await transaction.execute<ControlSetFenceRow>(
      buildFindInboxV2RestoreControlSetFenceSql(entry)
    )
  ).rows[0];
  if (controlSet === undefined) {
    return restorePreflightConflict("control_set");
  }
  if (
    BigInt(entry.highWater.completeThrough) <
    BigInt(bigintText(controlSet.last_changed_stream_position))
  ) {
    return restorePreflightConflict("high_water");
  }
  const prospective = firstRow(
    await transaction.execute<{
      prospective_legal_hold: unknown;
      prospective_restriction: unknown;
    }>(buildFindInboxV2ProspectiveRestoreControlsSql(entry))
  );
  if (
    booleanValue(prospective.prospective_legal_hold) ||
    booleanValue(prospective.prospective_restriction)
  ) {
    return restorePreflightConflict("scope_ambiguous");
  }

  const currentRows = (
    await transaction.execute<CurrentRestoreControlRow>(
      buildFindInboxV2CurrentRestoreControlsSql(entry)
    )
  ).rows;
  if (currentRows.some((row) => row.entry_hash === null)) {
    return {
      result: result({ outcome: "not_found", subject: "control" }),
      controlSetRows: [],
      restoreMutation: null
    };
  }
  const currentControls = currentRows.map((row) => ({
    ...controlSetIdentity(row),
    controlHeadRevision: bigintText(row.control_head_revision)
  }));
  const currentHashes = currentControls
    .map((control) => control.controlEntryHash)
    .sort((left, right) => left.localeCompare(right));

  if (entry.kind === "restore_opened") {
    if (restoreFence.operation !== "open_restore") {
      return restorePreflightConflict("restore_lease");
    }
    const source = await transaction.execute<LedgerRow>(
      buildFindInboxV2ErasureRestoreSourceErasureSql(entry)
    );
    const existing = await transaction.execute<RestoreAuthorityRow>(
      buildFindInboxV2RestoreAuthoritySql(entry)
    );
    if (source.rows.length !== 1) {
      return restorePreflightConflict("restore_chain");
    }
    if (existing.rows.length !== 0) {
      return restorePreflightConflict("restore_head");
    }
    if (
      !sameStrings(
        currentHashes,
        entry.reapplication.requiredControlEntryHashes
      )
    ) {
      return restorePreflightConflict("control_set");
    }
    return {
      result: null,
      controlSetRows: currentControls.map((control) => ({
        ...control,
        role: "required"
      })),
      restoreMutation: {
        kind: "open_restore",
        fence: restoreFence,
        controlSet,
        sourceErasureSequence: bigintText(source.rows[0]!.sequence),
        requiredControls: currentControls,
        checkedAt
      }
    };
  }

  const authority = (
    await transaction.execute<RestoreAuthorityRow>(
      buildFindInboxV2RestoreAuthoritySql(entry)
    )
  ).rows[0];
  if (authority === undefined) {
    return {
      result: result({ outcome: "not_found", subject: "restore" }),
      controlSetRows: [],
      restoreMutation: null
    };
  }
  if (restoreFence.operation === "open_restore") {
    return restorePreflightConflict("restore_lease");
  }
  if (
    textValue(authority.restore_state) !== "open" ||
    textValue(authority.lease_state) !== "active" ||
    bigintText(authority.head_revision) !== restoreFence.expectedHeadRevision ||
    bigintText(authority.lease_revision) !==
      restoreFence.expectedLeaseRevision ||
    bigintText(authority.restore_head_revision) !==
      restoreFence.expectedHeadRevision ||
    textValue(authority.lease_token_hash) !==
      calculateInboxV2ErasureRestoreLeaseTokenHash(restoreFence.leaseToken) ||
    Date.parse(timestampValue(authority.lease_expires_at)) <=
      Date.parse(checkedAt)
  ) {
    return restorePreflightConflict("restore_lease");
  }
  if (!sameTargetRow(authority, entry)) {
    return restorePreflightConflict("target");
  }
  if (
    bigintText(authority.stored_legal_hold_set_revision) !==
      bigintText(controlSet.legal_hold_set_revision) ||
    bigintText(authority.stored_restriction_set_revision) !==
      bigintText(controlSet.restriction_set_revision) ||
    bigintText(authority.stored_control_set_head_revision) !==
      bigintText(controlSet.head_revision) ||
    bigintText(authority.stored_control_set_stream_position) !==
      bigintText(controlSet.last_changed_stream_position)
  ) {
    return restorePreflightConflict("control_set");
  }
  const requiredRows = (
    await transaction.execute<RestoreRequiredControlRow>(
      buildFindInboxV2RestoreRequiredControlsSql(entry)
    )
  ).rows;
  if (!sameDbOwnedRequiredControls(requiredRows, currentControls)) {
    return restorePreflightConflict("control_state");
  }
  if (
    Number(bigintText(authority.required_control_count)) !==
      requiredRows.length ||
    textValue(authority.required_control_set_hash) !==
      controlSetHash(currentHashes)
  ) {
    return restorePreflightConflict("control_state");
  }
  const intervening = firstRow(
    await transaction.execute<{ found: unknown }>(
      buildFindInboxV2InterveningRestoreControlSql(
        entry,
        bigintText(authority.opened_sequence)
      )
    )
  );
  if (booleanValue(intervening.found)) {
    return restorePreflightConflict("control_state");
  }

  if (entry.kind === "control_reapplied") {
    if (restoreFence.operation !== "reapply_control") {
      return restorePreflightConflict("restore_lease");
    }
    const required = requiredRows.find(
      (row) =>
        textValue(row.source_control_entry_hash) ===
        entry.sourceControlEntryHash
    );
    const expectedControl = controlIdentity(entry);
    if (
      required === undefined ||
      required.reapplied_entry_hash !== null ||
      textValue(required.control_kind) !== expectedControl.controlKind ||
      textValue(required.control_id) !== expectedControl.controlId ||
      bigintText(required.control_revision) !== expectedControl.controlRevision
    ) {
      return restorePreflightConflict("control_state");
    }
    const control = currentControls.find(
      (item) => item.controlEntryHash === entry.sourceControlEntryHash
    )!;
    return {
      result: null,
      controlSetRows: [{ ...control, role: "reapplied" }],
      restoreMutation: {
        kind: "reapply_control",
        fence: restoreFence,
        checkedAt
      }
    };
  }

  if (restoreFence.operation !== "seal_restore") {
    return restorePreflightConflict("restore_lease");
  }

  if (
    textValue(authority.source_erasure_entry_hash) !==
      entry.sourceErasureEntryHash ||
    requiredRows.some((row) => row.reapplied_entry_hash === null) ||
    !sameStrings(
      currentHashes,
      entry.reapplication.requiredControlEntryHashes
    ) ||
    !sameStrings(currentHashes, entry.reapplication.reappliedControlEntryHashes)
  ) {
    return restorePreflightConflict("control_state");
  }
  return {
    result: null,
    controlSetRows: currentControls.flatMap((control) => [
      { ...control, role: "required" as const },
      { ...control, role: "reapplied" as const }
    ]),
    restoreMutation: {
      kind: "seal_restore",
      fence: restoreFence,
      checkedAt
    }
  };
}

function restorePreflightConflict(
  facet: Extract<
    InboxV2ErasureRestoreLedgerAppendResult,
    { outcome: "conflict" }
  >["facet"]
) {
  return {
    result: result({ outcome: "conflict", facet }),
    controlSetRows: [],
    restoreMutation: null
  };
}

function sameDbOwnedRequiredControls(
  rows: readonly RestoreRequiredControlRow[],
  current: readonly RestoreRequiredControlInsert[]
): boolean {
  if (rows.length !== current.length) return false;
  const bySource = new Map(
    current.map((control) => [control.controlEntryHash, control])
  );
  return rows.every((row) => {
    const expected = bySource.get(textValue(row.source_control_entry_hash));
    return (
      expected !== undefined &&
      textValue(row.control_kind) === expected.controlKind &&
      textValue(row.control_id) === expected.controlId &&
      bigintText(row.control_revision) === expected.controlRevision &&
      bigintText(row.control_head_revision) === expected.controlHeadRevision
    );
  });
}

async function loadRelationalEntry(
  transaction: RawSqlExecutor,
  row: LedgerRow
): Promise<Record<string, unknown>> {
  const tenantId = textValue(row.tenant_id);
  const ledgerId = textValue(row.ledger_id);
  const ledgerEntryId = textValue(row.ledger_entry_id);
  const evidence = await loadEvidenceRows(
    transaction,
    tenantId,
    ledgerId,
    ledgerEntryId
  );
  const controls = await loadControlSetRows(
    transaction,
    tenantId,
    ledgerId,
    ledgerEntryId
  );
  return relationalEntry(row, evidence, controls);
}

async function loadEvidenceRows(
  transaction: RawSqlExecutor,
  tenantId: string,
  ledgerId: string,
  ledgerEntryId: string
): Promise<readonly EvidenceRow[]> {
  return (
    await transaction.execute<EvidenceRow>(sql`
      select evidence.slot, evidence.kind, evidence.digest,
             evidence.payload_tenant_id, evidence.payload_record_id,
             evidence.payload_schema_id, evidence.payload_schema_version
        from inbox_v2_data_governance_erasure_restore_ledger_evidence evidence
       where evidence.tenant_id = ${tenantId}
         and evidence.ledger_id = ${ledgerId}
         and evidence.ledger_entry_id = ${ledgerEntryId}
       order by evidence.slot
    `)
  ).rows;
}

async function loadControlSetRows(
  transaction: RawSqlExecutor,
  tenantId: string,
  ledgerId: string,
  ledgerEntryId: string
): Promise<readonly ControlSetRow[]> {
  return (
    await transaction.execute<ControlSetRow>(sql`
      select control.role, control.control_kind, control.control_id,
             control.control_revision::text as control_revision,
             control.control_entry_hash
        from inbox_v2_data_governance_erasure_restore_ledger_controls control
       where control.tenant_id = ${tenantId}
         and control.ledger_id = ${ledgerId}
         and control.ledger_entry_id = ${ledgerEntryId}
       order by control.role, control.control_entry_hash
    `)
  ).rows;
}

function firstChainConflict(
  latest: LedgerRow | undefined,
  entry: InboxV2ErasureRestoreLedgerEntry
): "sequence" | "previous_entry_hash" | "high_water" | "occurred_at" | null {
  if (latest === undefined) {
    if (entry.sequence !== "1") return "sequence";
    return entry.previousEntryHash === null ? null : "previous_entry_hash";
  }
  if (BigInt(entry.sequence) !== BigInt(bigintText(latest.sequence)) + 1n) {
    return "sequence";
  }
  if (entry.previousEntryHash !== textValue(latest.entry_hash)) {
    return "previous_entry_hash";
  }
  const previousGeneration = BigInt(bigintText(latest.sync_generation));
  const currentGeneration = BigInt(entry.highWater.syncGeneration);
  if (
    currentGeneration < previousGeneration ||
    (currentGeneration === previousGeneration &&
      (entry.highWater.streamEpoch !== textValue(latest.stream_epoch) ||
        BigInt(entry.highWater.completeThrough) <
          BigInt(bigintText(latest.complete_through_position))))
  ) {
    return "high_water";
  }
  return Date.parse(entry.occurredAt) <
    Date.parse(timestampValue(latest.occurred_at))
    ? "occurred_at"
    : null;
}

function classifyAuthorityAbsence(input: {
  rows: readonly AuthorityPresenceRow[];
}): InboxV2ErasureRestoreLedgerAppendResult {
  const row = firstRow(input);
  if (!booleanValue(row.registry_found)) {
    return result({ outcome: "not_found", subject: "registry" });
  }
  if (!booleanValue(row.governance_context_found)) {
    return result({ outcome: "not_found", subject: "governance_context" });
  }
  if (!booleanValue(row.effective_policy_found)) {
    return result({ outcome: "not_found", subject: "effective_policy" });
  }
  if (!booleanValue(row.activation_found)) {
    return result({ outcome: "not_found", subject: "activation" });
  }
  if (!booleanValue(row.storage_root_found)) {
    return result({ outcome: "not_found", subject: "storage_root" });
  }
  return result({ outcome: "conflict", facet: "authority" });
}

function entryValues(entry: InboxV2ErasureRestoreLedgerEntry) {
  const control =
    entry.kind === "hold_applied" ||
    entry.kind === "restriction_applied" ||
    entry.kind === "hold_released" ||
    entry.kind === "restriction_released" ||
    entry.kind === "control_reapplied"
      ? controlIdentity(entry)
      : null;
  const requiredHashes =
    entry.kind === "restore_opened" || entry.kind === "restore_sealed"
      ? entry.reapplication.requiredControlEntryHashes
      : null;
  const reappliedHashes =
    entry.kind === "restore_sealed"
      ? entry.reapplication.reappliedControlEntryHashes
      : null;
  return {
    deletionRunId:
      entry.kind === "erasure_applied" ? entry.deletionRun.id : null,
    deletionRunRevision:
      entry.kind === "erasure_applied" ? entry.deletionRun.revision : null,
    controlKind: control?.controlKind ?? null,
    controlId: control?.controlId ?? null,
    controlRevision: control?.controlRevision ?? null,
    restoreId:
      entry.kind === "restore_opened" ||
      entry.kind === "control_reapplied" ||
      entry.kind === "restore_sealed"
        ? entry.restoreId
        : null,
    primaryAbsenceVerified: entry.kind === "erasure_applied",
    primaryAbsenceVerifiedAt:
      entry.kind === "erasure_applied" ? entry.primaryAbsence.verifiedAt : null,
    primaryVerificationHandlerId:
      entry.kind === "erasure_applied" ? entry.primaryAbsence.handlerId : null,
    backupExpiryState:
      entry.kind === "erasure_applied"
        ? entry.backupExpiry.state
        : "not_applicable",
    backupLatestPossibleExpiryAt:
      entry.kind === "erasure_applied" &&
      entry.backupExpiry.state !== "not_applicable"
        ? entry.backupExpiry.expiresAt
        : null,
    backupVerifiedAt:
      entry.kind === "erasure_applied" &&
      entry.backupExpiry.state === "verified_expired"
        ? entry.backupExpiry.verifiedAt
        : null,
    controlAppliedAt:
      entry.kind === "hold_applied" || entry.kind === "restriction_applied"
        ? entry.application.appliedAt
        : null,
    controlReleasedAt:
      entry.kind === "hold_released" || entry.kind === "restriction_released"
        ? entry.release.releasedAt
        : null,
    controlReappliedAt:
      entry.kind === "control_reapplied"
        ? entry.reapplication.reappliedAt
        : null,
    restoreSealedAt:
      entry.kind === "restore_sealed" ? entry.reapplication.sealedAt : null,
    requiredControlHash:
      requiredHashes === null ? null : controlSetHash(requiredHashes),
    reappliedControlHash:
      reappliedHashes === null ? null : controlSetHash(reappliedHashes),
    sourceErasureEntryHash:
      entry.kind === "restore_opened" || entry.kind === "restore_sealed"
        ? entry.sourceErasureEntryHash
        : null,
    sourceControlEntryHash:
      entry.kind === "control_reapplied" ? entry.sourceControlEntryHash : null
  };
}

function evidenceForEntry(
  entry: InboxV2ErasureRestoreLedgerEntry
): EvidenceInsert[] {
  if (entry.kind === "erasure_applied") {
    return [
      { slot: "primary_absence", evidence: entry.primaryAbsence.evidence },
      { slot: "backup_expiry", evidence: entry.backupExpiry.evidence }
    ];
  }
  if (entry.kind === "hold_applied" || entry.kind === "restriction_applied") {
    return [
      { slot: "control_application", evidence: entry.application.evidence }
    ];
  }
  if (entry.kind === "hold_released" || entry.kind === "restriction_released") {
    return [{ slot: "control_application", evidence: entry.release.evidence }];
  }
  if (entry.kind === "restore_opened") {
    return [{ slot: "restore", evidence: entry.evidence }];
  }
  return [
    {
      slot:
        entry.kind === "control_reapplied" ? "control_application" : "restore",
      evidence: entry.reapplication.evidence
    }
  ];
}

function controlIdentity(
  entry: Extract<
    InboxV2ErasureRestoreLedgerEntry,
    {
      kind:
        | "hold_applied"
        | "restriction_applied"
        | "hold_released"
        | "restriction_released"
        | "control_reapplied";
    }
  >
): Omit<ControlSetInsert, "role" | "controlEntryHash"> {
  return entry.control.kind === "legal_hold"
    ? {
        controlKind: "legal_hold",
        controlId: entry.control.hold.holdId,
        controlRevision: entry.control.hold.revision
      }
    : {
        controlKind: "restriction",
        controlId: entry.control.restriction.restrictionId,
        controlRevision: entry.control.restriction.revision
      };
}

function controlSetIdentity(
  row: AppliedControlRow
): Omit<ControlSetInsert, "role"> {
  const kind = textValue(row.control_kind);
  if (kind !== "legal_hold" && kind !== "restriction") {
    throw new Error(`Invalid persisted ledger control kind: ${kind}`);
  }
  return {
    controlKind: kind,
    controlId: textValue(row.control_id),
    controlRevision: bigintText(row.control_revision),
    controlEntryHash: textValue(row.entry_hash)
  };
}

function sameTargetRow(
  row: Record<string, unknown>,
  entry: InboxV2ErasureRestoreLedgerEntry
): boolean {
  return (
    textValue(row.storage_root_id) === entry.target.root.storageRootId &&
    textValue(row.data_class_id) === entry.target.root.dataClassId &&
    textValue(row.root_record_id) === entry.target.root.recordId &&
    textValue(row.entity_type_id) === entry.target.entity.entityTypeId &&
    textValue(row.entity_id) === entry.target.entity.entityId &&
    bigintText(row.entity_revision) === entry.target.entityRevision &&
    bigintText(row.lineage_revision) === entry.target.lineageRevision
  );
}

function relationalEntry(
  row: LedgerRow,
  evidenceRows: readonly EvidenceRow[],
  controlRows: readonly ControlSetRow[]
): Record<string, unknown> {
  const evidence = new Map(
    evidenceRows.map((item) => [textValue(item.slot), evidenceValue(item)])
  );
  const common = {
    tenantId: textValue(row.tenant_id),
    ledgerId: textValue(row.ledger_id),
    sequence: bigintText(row.sequence),
    previousEntryHash: nullableText(row.previous_entry_hash),
    target: {
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
      entityRevision: bigintText(row.entity_revision),
      lineageRevision: bigintText(row.lineage_revision)
    },
    authority: {
      registryCompositionHash: textValue(row.registry_composition_hash),
      governance: {
        tenantId: textValue(row.tenant_id),
        id: textValue(row.governance_context_id),
        version: bigintText(row.governance_context_version),
        contextHash: textValue(row.governance_context_hash)
      },
      effectivePolicy: {
        tenantId: textValue(row.tenant_id),
        id: textValue(row.policy_id),
        version: bigintText(row.policy_version),
        policyHash: textValue(row.policy_hash)
      },
      activation: {
        tenantId: textValue(row.tenant_id),
        id: textValue(row.activation_id),
        revision: bigintText(row.activation_revision),
        activationHash: textValue(row.activation_hash)
      }
    },
    highWater: {
      streamEpoch: textValue(row.stream_epoch),
      syncGeneration: bigintText(row.sync_generation),
      completeThrough: bigintText(row.complete_through_position)
    },
    occurredAt: timestampValue(row.occurred_at),
    entryHash: textValue(row.entry_hash)
  };
  const kind = textValue(row.kind);
  if (kind === "erasure_applied") {
    const backupState = textValue(row.backup_expiry_state);
    const backupEvidence = requiredEvidence(evidence, "backup_expiry");
    const backupExpiry =
      backupState === "not_applicable"
        ? { state: backupState, evidence: backupEvidence }
        : backupState === "finite_expiry_pending"
          ? {
              state: backupState,
              expiresAt: timestampValue(row.backup_latest_possible_expiry_at),
              evidence: backupEvidence
            }
          : {
              state: "verified_expired",
              expiresAt: timestampValue(row.backup_latest_possible_expiry_at),
              verifiedAt: timestampValue(row.backup_verified_at),
              evidence: backupEvidence
            };
    return {
      ...common,
      kind,
      deletionRun: {
        id: textValue(row.deletion_run_id),
        revision: bigintText(row.deletion_run_revision),
        planHash: textValue(row.deletion_plan_hash)
      },
      primaryAbsence: {
        state: "verified_absent",
        verifiedAt: timestampValue(row.primary_absence_verified_at),
        handlerId: textValue(row.primary_verification_handler_id),
        evidence: requiredEvidence(evidence, "primary_absence")
      },
      backupExpiry
    };
  }
  if (kind === "hold_applied" || kind === "restriction_applied") {
    return {
      ...common,
      kind,
      control: contractControl(row),
      application: {
        state: "applied",
        appliedAt: timestampValue(row.control_applied_at),
        evidence: requiredEvidence(evidence, "control_application")
      }
    };
  }
  if (kind === "hold_released" || kind === "restriction_released") {
    return {
      ...common,
      kind,
      control: contractControl(row),
      release: {
        state: "released",
        releasedAt: timestampValue(row.control_released_at),
        evidence: requiredEvidence(evidence, "control_application")
      }
    };
  }
  if (kind === "restore_opened") {
    return {
      ...common,
      kind,
      restoreId: textValue(row.restore_id),
      sourceErasureEntryHash: textValue(row.source_erasure_entry_hash),
      reapplication: {
        state: "pending",
        requiredControlEntryHashes: controlHashes(controlRows, "required")
      },
      evidence: requiredEvidence(evidence, "restore")
    };
  }
  if (kind === "control_reapplied") {
    return {
      ...common,
      kind,
      restoreId: textValue(row.restore_id),
      sourceControlEntryHash: textValue(row.source_control_entry_hash),
      control: contractControl(row),
      reapplication: {
        state: "reapplied",
        reappliedAt: timestampValue(row.control_reapplied_at),
        evidence: requiredEvidence(evidence, "control_application")
      }
    };
  }
  if (kind !== "restore_sealed") {
    throw new Error(`Invalid persisted erasure/restore ledger kind: ${kind}`);
  }
  return {
    ...common,
    kind,
    restoreId: textValue(row.restore_id),
    sourceErasureEntryHash: textValue(row.source_erasure_entry_hash),
    reapplication: {
      state: "sealed",
      sealedAt: timestampValue(row.restore_sealed_at),
      requiredControlEntryHashes: controlHashes(controlRows, "required"),
      reappliedControlEntryHashes: controlHashes(controlRows, "reapplied"),
      evidence: requiredEvidence(evidence, "restore")
    }
  };
}

function contractControl(row: Record<string, unknown>) {
  const kind = textValue(row.control_kind);
  if (kind === "legal_hold") {
    return {
      kind: "legal_hold" as const,
      hold: {
        tenantId: textValue(row.tenant_id),
        holdId: textValue(row.control_id),
        revision: bigintText(row.control_revision)
      }
    };
  }
  if (kind !== "restriction") {
    throw new Error(`Invalid persisted ledger control kind: ${kind}`);
  }
  return {
    kind: "processing_restriction" as const,
    restriction: {
      tenantId: textValue(row.tenant_id),
      restrictionId: textValue(row.control_id),
      revision: bigintText(row.control_revision)
    }
  };
}

function evidenceValue(row: EvidenceRow): InboxV2ErasureRestoreEvidence {
  const kind = textValue(row.kind);
  if (kind === "digest") {
    return inboxV2ErasureRestoreEvidenceSchema.parse({
      kind,
      digest: textValue(row.digest)
    });
  }
  if (kind !== "payload_reference") {
    throw new Error(`Invalid persisted ledger evidence kind: ${kind}`);
  }
  return inboxV2ErasureRestoreEvidenceSchema.parse({
    kind,
    payload: {
      tenantId: textValue(row.payload_tenant_id),
      recordId: textValue(row.payload_record_id),
      schemaId: textValue(row.payload_schema_id),
      schemaVersion: textValue(row.payload_schema_version),
      digest: textValue(row.digest)
    }
  });
}

function requiredEvidence(
  evidence: ReadonlyMap<string, InboxV2ErasureRestoreEvidence>,
  slot: string
): InboxV2ErasureRestoreEvidence {
  const value = evidence.get(slot);
  if (value === undefined)
    throw new Error(`Missing persisted ledger evidence: ${slot}`);
  return value;
}

function controlHashes(
  rows: readonly ControlSetRow[],
  role: "required" | "reapplied"
): string[] {
  return rows
    .filter((row) => textValue(row.role) === role)
    .map((row) => textValue(row.control_entry_hash))
    .sort((left, right) => left.localeCompare(right));
}

function samePersistedEntry(
  relational: Record<string, unknown>,
  entry: InboxV2ErasureRestoreLedgerEntry
): boolean {
  return isDeepStrictEqual(
    normalizeTemporalStrings(relational),
    normalizeTemporalStrings(entry as unknown as Record<string, unknown>)
  );
}

function normalizeTemporalStrings(value: unknown, key?: string): unknown {
  if (
    typeof value === "string" &&
    key !== undefined &&
    TEMPORAL_KEYS.has(key)
  ) {
    return new Date(value).toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeTemporalStrings(item));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        normalizeTemporalStrings(child, childKey)
      ])
    );
  }
  return value;
}

const TEMPORAL_KEYS = new Set([
  "occurredAt",
  "verifiedAt",
  "expiresAt",
  "appliedAt",
  "reappliedAt",
  "sealedAt"
]);

function controlSetHash(hashes: readonly string[]): string {
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.erasure-restore-control-entry-set",
    hashVersion: "v1",
    entryHashes: hashes
  });
}

function sameStrings(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function result(
  value: InboxV2ErasureRestoreLedgerAppendResult
): InboxV2ErasureRestoreLedgerAppendResult {
  return value;
}

function firstRow<Row>(input: { rows: readonly Row[] }): Row {
  const row = input.rows[0];
  if (row === undefined) throw new Error("Expected one SQL preflight row.");
  return row;
}

function booleanValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "t" || value === "true")
    return true;
  if (value === 0 || value === "0" || value === "f" || value === "false")
    return false;
  throw new Error(`Expected SQL boolean, received ${String(value)}.`);
}

function textValue(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected non-empty SQL text, received ${String(value)}.`);
  }
  return value;
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : textValue(value);
}

function bigintText(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isSafeInteger(value))
    return String(value);
  if (typeof value === "string" && /^-?(?:0|[1-9][0-9]*)$/u.test(value))
    return value;
  throw new Error(`Expected SQL bigint, received ${String(value)}.`);
}

function timestampValue(value: unknown): string {
  const date = value instanceof Date ? value : new Date(textValue(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Expected SQL timestamp, received ${String(value)}.`);
  }
  return date.toISOString();
}
