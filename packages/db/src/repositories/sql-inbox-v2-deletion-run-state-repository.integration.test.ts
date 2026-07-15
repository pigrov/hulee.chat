import {
  calculateInboxV2DeletionRunMutableStateHash,
  inboxV2CommitDeletionStageOneInputSchema,
  inboxV2CreateDeletionRunInputSchema,
  inboxV2DeletionRunStateTransitionInputSchema,
  inboxV2Sha256DigestSchema,
  inboxV2TenantIdSchema,
  initialInboxV2DeletionRunMutableState
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHuleeDatabase,
  createHuleeDatabase,
  type HuleeDatabase
} from "../client";
import {
  createSqlInboxV2DeletionRunStateRepository,
  type InboxV2CommitDeletionStageOneInput,
  type InboxV2CreateDeletionRunInput,
  type InboxV2DeletionRunStateTransactionExecutor,
  type InboxV2DeletionRunStateTransitionInput
} from "./sql-inbox-v2-deletion-run-state-repository";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const tenantId = inboxV2TenantIdSchema.parse(`tenant:db009-run-${suffix}`);
const registryId = `registry:db009-run-${suffix}`;
const storageRootId = `core:db009-run-${suffix}`;
const dataClassId = "core:message-content";
const rootRecordId = `data_root:db009-run-${suffix}`;
const entityTypeId = "core:message";
const entityId = `message:db009-run-${suffix}`;
const deleteHandlerId = `handler:delete-db009-run-${suffix}`;
const verificationHandlerId = `handler:verify-db009-run-${suffix}`;
const contextId = `core:db009-run-context-${suffix}`;
const manifestId = `scope-manifest:db009-run-${suffix}`;
const currentPolicyId = `core:db009-run-policy-${suffix}`;
const currentActivationId = `core:db009-run-activation-${suffix}`;
const stalePolicyId = `core:db009-run-stale-policy-${suffix}`;
const staleActivationId = `core:db009-run-stale-activation-${suffix}`;
const currentPlanId = `plan:db009-run-${suffix}`;
const stalePlanId = `plan:db009-run-stale-${suffix}`;
const currentCheckpointId = `checkpoint:db009-run-${suffix}`;
const staleCheckpointId = `checkpoint:db009-run-stale-${suffix}`;

const baseClock = Date.now();
const registryCreatedAt = timestamp(baseClock - 10 * 60_000);
const registryActivatedAt = timestamp(baseClock - 9 * 60_000);
const contextEffectiveAt = timestamp(baseClock - 8 * 60_000);
const policyEffectiveAt = timestamp(baseClock - 7 * 60_000);
const activationApprovedAt = timestamp(baseClock - 6 * 60_000);
const activationNotBefore = timestamp(baseClock - 5 * 60_000);
const activationActivatedAt = timestamp(baseClock - 4 * 60_000);
const manifestFrozenAt = timestamp(baseClock - 3 * 60_000);
const planCreatedAt = timestamp(baseClock - 2 * 60_000);
const earliestExecutionAt = timestamp(baseClock - 90_000);
const startedAt = timestamp(baseClock - 60_000);
const stageOneCommittedAt = timestamp(baseClock - 45_000);
const stageOneUpdatedAt = timestamp(baseClock - 44_000);
const verificationUpdatedAt = timestamp(baseClock - 43_000);
const contextReviewAt = timestamp(baseClock + 24 * 60 * 60_000);

const registryHash = digest("a");
const contextHash = digest("b");
const currentPolicyHash = digest("c");
const currentActivationHash = digest("d");
const stalePolicyHash = digest("e");
const staleActivationHash = digest("f");
const manifestHash = digest("1");
const currentPlanHash = digest("2");
const stalePlanHash = digest("3");
const currentRequirementHash = digest("4");
const staleRequirementHash = digest("5");

describePostgres(
  "SQL Inbox V2 deletion-run/stage-one repository (PostgreSQL)",
  () => {
    let db: HuleeDatabase;

    beforeAll(async () => {
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) {
        throw new Error(
          "DATABASE_URL is required for the deletion-run integration test."
        );
      }
      db = createHuleeDatabase({
        connectionString: databaseUrl,
        poolConfig: { max: 8 }
      });
      const readiness = await db.execute<{
        controlHeads: string | null;
        deletionPlans: string | null;
        deletionRuns: string | null;
        stageOneTargets: string | null;
      }>(sql`
        select
          to_regclass(
            'public.inbox_v2_data_governance_control_set_heads'
          )::text as "controlHeads",
          to_regclass(
            'public.inbox_v2_data_governance_deletion_plans'
          )::text as "deletionPlans",
          to_regclass(
            'public.inbox_v2_data_governance_deletion_runs'
          )::text as "deletionRuns",
          to_regclass(
            'public.inbox_v2_data_governance_deletion_stage_one_targets'
          )::text as "stageOneTargets"
      `);
      expect(readiness.rows[0]).toEqual({
        controlHeads: "inbox_v2_data_governance_control_set_heads",
        deletionPlans: "inbox_v2_data_governance_deletion_plans",
        deletionRuns: "inbox_v2_data_governance_deletion_runs",
        stageOneTargets: "inbox_v2_data_governance_deletion_stage_one_targets"
      });
      await seedDeletionAuthority(db);
    }, 120_000);

    afterAll(async () => {
      if (db) await closeHuleeDatabase(db);
    });

    it("creates one exact run, retries it and serializes concurrent bootstraps", async () => {
      const repository = createSqlInboxV2DeletionRunStateRepository(db);
      const exact = createRunInput("exact");

      await expect(repository.createRun(exact)).resolves.toEqual({
        outcome: "applied",
        stateRevision: "1"
      });
      await expect(
        createSqlInboxV2DeletionRunStateRepository(db).createRun(exact)
      ).resolves.toEqual({
        outcome: "already_applied",
        stateRevision: "1"
      });
      await expect(
        repository.createRun({
          ...exact,
          startedAt: timestamp(Date.parse(exact.startedAt) + 1_000)
        })
      ).resolves.toMatchObject({ outcome: "conflict" });

      const persisted = await loadRun(db, exact.runId);
      expect(persisted).toMatchObject({
        operated_checkpoint_count: "1",
        backup_checkpoint_count: "0",
        external_checkpoint_count: "0",
        completed_checkpoint_count: "0",
        state_revision: "1",
        state: "executing",
        stage_one_state: "pending",
        primary_absence_verified: false,
        has_internal_residual: false,
        has_external_residual: false,
        has_backup_expiry_pending: false
      });
      expect(timestampValue(persisted.started_at)).toBe(exact.startedAt);
      expect(timestampValue(persisted.updated_at)).toBe(exact.startedAt);
      expect(persisted.state_hash).toBe(
        initialInboxV2DeletionRunMutableState(exact).stateHash
      );

      const concurrent = createRunInput("concurrent");
      const contenders = await Promise.all([
        repository.createRun(concurrent),
        repository.createRun(concurrent)
      ]);
      expect(contenders.map(({ outcome }) => outcome).sort()).toEqual([
        "already_applied",
        "applied"
      ]);
      expect(await runCount(db, concurrent.runId)).toBe(1);
    });

    it("rejects a wrong plan hash, stale authority and a future start", async () => {
      const repository = createSqlInboxV2DeletionRunStateRepository(db);
      const wrongPlan = createRunInput("wrong-plan");
      await expect(
        repository.createRun({
          ...wrongPlan,
          plan: { ...wrongPlan.plan, planHash: digest("6") }
        })
      ).resolves.toEqual({ outcome: "not_found" });
      expect(await runCount(db, wrongPlan.runId)).toBe(0);

      const staleAuthority = createRunInput("stale-authority", {
        planId: stalePlanId,
        planHash: stalePlanHash
      });
      await expect(repository.createRun(staleAuthority)).resolves.toEqual({
        outcome: "not_found"
      });
      expect(await runCount(db, staleAuthority.runId)).toBe(0);

      const future = createRunInput("future", {
        startedAt: timestamp(Date.now() + 60 * 60_000)
      });
      await expect(repository.createRun(future)).resolves.toEqual({
        outcome: "not_found"
      });
      expect(await runCount(db, future.runId)).toBe(0);
    });

    it("rolls back a created run when the transaction fails before commit", async () => {
      const input = createRunInput("rollback");
      const failure = new Error("forced deletion-run transaction rollback");
      const repository = createSqlInboxV2DeletionRunStateRepository(
        failAfterConstraintsExecutor(db, failure)
      );

      await expect(repository.createRun(input)).rejects.toBe(failure);
      expect(await runCount(db, input.runId)).toBe(0);
      await expect(
        createSqlInboxV2DeletionRunStateRepository(db).createRun(input)
      ).resolves.toEqual({ outcome: "applied", stateRevision: "1" });
    });

    it("rejects a direct SQL run that violates the initial-state invariant", async () => {
      const runId = runIdFor("direct-invalid");
      const client = await db.$client.connect();
      let databaseError: unknown;
      try {
        await client.query(
          `insert into inbox_v2_data_governance_deletion_runs (
             tenant_id, run_id, revision, state_revision, plan_id,
             plan_revision, state, result, stage_one_state,
             stage_one_committed_at, primary_absence_verified,
             has_internal_residual, has_external_residual,
             has_backup_expiry_pending, backup_latest_possible_expiry_at,
             operated_checkpoint_count, backup_checkpoint_count,
             external_checkpoint_count, completed_checkpoint_count,
             started_at, completed_at, updated_at, state_hash
           ) values (
             $1, $2, 1, 2, $3, 1, 'executing', null, 'pending', null,
             false, false, false, false, null, 1, 0, 0, 0,
             $4, null, $4, $5
           )`,
          [tenantId, runId, currentPlanId, startedAt, digest("7")]
        );
      } catch (error) {
        databaseError = error;
      } finally {
        client.release();
      }
      expect(databaseError).toMatchObject({ code: "23514" });
      expect(String((databaseError as Error | undefined)?.message)).toMatch(
        /exact frozen checkpoint set/u
      );
      expect(await runCount(db, runId)).toBe(0);
    });

    it("rolls back stage-one proofs with a failed CAS and then reaches verification_pending", async () => {
      const repository = createSqlInboxV2DeletionRunStateRepository(db);
      const run = createRunInput("stage-rollback");
      await expect(repository.createRun(run)).resolves.toMatchObject({
        outcome: "applied"
      });

      const invalid = stageOneInput(run, "rollback", {
        committedAt: run.startedAt,
        updatedAt: run.startedAt
      });
      await expect(repository.commitStageOne(invalid)).rejects.toMatchObject({
        cause: {
          code: "23514",
          message: expect.stringMatching(
            /updated_at must advance monotonically/u
          )
        }
      });
      expect(await stageOneTargetCount(db, run.runId)).toBe(0);
      expect(await loadRun(db, run.runId)).toMatchObject({
        state_revision: "1",
        stage_one_state: "pending"
      });

      const valid = stageOneInput(run, "rollback-retry");
      await expect(repository.commitStageOne(valid)).resolves.toEqual({
        outcome: "applied",
        stateRevision: "2"
      });
      await expect(
        repository.transition(verificationPendingInput(run, valid))
      ).resolves.toEqual({ outcome: "applied", stateRevision: "3" });
      expect(await loadRun(db, run.runId)).toMatchObject({
        state_revision: "3",
        state: "verification_pending",
        stage_one_state: "content_unavailable"
      });
    });

    it("serializes identical and competing stage-one commits", async () => {
      const repository = createSqlInboxV2DeletionRunStateRepository(db);
      const identicalRun = createRunInput("stage-identical");
      await repository.createRun(identicalRun);
      const identical = stageOneInput(identicalRun, "identical");
      const identicalContenders = await Promise.all([
        repository.commitStageOne(identical),
        repository.commitStageOne(identical)
      ]);
      expect(identicalContenders.map(({ outcome }) => outcome).sort()).toEqual([
        "already_applied",
        "applied"
      ]);
      expect(await stageOneTargetCount(db, identicalRun.runId)).toBe(1);

      const competingRun = createRunInput("stage-competing");
      await repository.createRun(competingRun);
      const left = stageOneInput(competingRun, "left");
      const right = stageOneInput(competingRun, "right");
      const competing = await Promise.all([
        repository.commitStageOne(left),
        repository.commitStageOne(right)
      ]);
      expect(competing.map(({ outcome }) => outcome).sort()).toEqual([
        "applied",
        "conflict"
      ]);
      expect(await stageOneTargetCount(db, competingRun.runId)).toBe(1);
    });
  }
);

async function seedDeletionAuthority(db: HuleeDatabase): Promise<void> {
  await db.transaction(async (transaction) => {
    await transaction.execute(sql`
      insert into tenants (id, slug, display_name, deployment_type)
      values (
        ${tenantId}, ${`db009-run-${suffix}`},
        'DB009 deletion-run integration tenant', 'saas_shared'
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_data_governance_registry_versions (
        id, revision, schema_version, composition_hash, canonical_snapshot,
        activated_at, created_at
      ) values (
        ${registryId}, 1, 'v1', ${registryHash}, '{}'::jsonb,
        ${registryActivatedAt}, ${registryCreatedAt}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_data_governance_storage_roots (
        registry_id, registry_revision, storage_root_id, kind, boundary,
        version_enumeration, configuration_profile_id, owner_module_id,
        canonical_snapshot
      ) values (
        ${registryId}, 1, ${storageRootId}, 'sql', 'operated_data_plane',
        'not_applicable', 'profile:db009-run', null, '{}'::jsonb
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_data_governance_lifecycle_handlers (
        registry_id, registry_revision, handler_id, kind, owner_module_id,
        handler_version, bounded, idempotent, checks_tenant_fence,
        checks_revision_fence, checks_hold_fence, verifies_absence,
        canonical_snapshot
      ) values
        (
          ${registryId}, 1, ${deleteHandlerId}, 'delete_execution', null,
          1, true, true, true, true, true, false, '{}'::jsonb
        ),
        (
          ${registryId}, 1, ${verificationHandlerId}, 'verification', null,
          1, true, true, true, true, true, true, '{}'::jsonb
        )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_data_governance_contexts (
        tenant_id, context_id, version, context_hash, policy_revision,
        registry_id, registry_revision, deployment_profile, time_zone,
        tzdb_version, approved_at, effective_at, review_at,
        canonical_snapshot
      ) values (
        ${tenantId}, ${contextId}, 1, ${contextHash}, 1,
        ${registryId}, 1, 'saas_shared', 'UTC', '2026a',
        ${registryCreatedAt}, ${contextEffectiveAt}, ${contextReviewAt},
        '{}'::jsonb
      )
    `);
    const rawTransaction = transaction as unknown as RawSqlExecutor;
    await seedPolicy(rawTransaction, {
      policyId: currentPolicyId,
      policyHash: currentPolicyHash,
      activationId: currentActivationId,
      activationHash: currentActivationHash
    });
    await seedPolicy(rawTransaction, {
      policyId: stalePolicyId,
      policyHash: stalePolicyHash,
      activationId: staleActivationId,
      activationHash: staleActivationHash
    });
    await transaction.execute(sql`
      insert into inbox_v2_data_governance_policy_activation_heads (
        tenant_id, policy_id, current_policy_version,
        current_activation_id, current_activation_revision,
        head_revision, updated_at
      ) values (
        ${tenantId}, ${currentPolicyId}, 1, ${currentActivationId}, 1,
        1, ${activationActivatedAt}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_data_governance_control_set_heads (
        tenant_id, legal_hold_set_revision, restriction_set_revision,
        last_changed_stream_position, head_revision, updated_at
      ) values (${tenantId}, 0, 0, 0, 1, ${activationActivatedAt})
    `);
    await transaction.execute(sql`
      insert into inbox_v2_data_governance_scope_manifests (
        tenant_id, manifest_id, revision, registry_id, registry_revision,
        kind, manifest_hash, stream_epoch, sync_generation,
        complete_through_position, frozen_at, canonical_snapshot
      ) values (
        ${tenantId}, ${manifestId}, 1, ${registryId}, 1, 'exact',
        ${manifestHash}, 'epoch:db009-run', 1, 0, ${manifestFrozenAt},
        '{}'::jsonb
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_data_governance_scope_manifest_roots (
        tenant_id, manifest_id, manifest_revision, registry_id,
        registry_revision, data_class_id, storage_root_id, root_record_id,
        root_kind, boundary, copy_role, entity_type_id, entity_id,
        expected_entity_revision, expected_lineage_revision
      ) values (
        ${tenantId}, ${manifestId}, 1, ${registryId}, 1, ${dataClassId},
        ${storageRootId}, ${rootRecordId}, 'sql', 'operated_data_plane',
        'primary', ${entityTypeId}, ${entityId}, 1, 1
      )
    `);
    await seedPlan(rawTransaction, {
      planId: currentPlanId,
      planHash: currentPlanHash,
      policyId: currentPolicyId,
      policyHash: currentPolicyHash,
      activationId: currentActivationId,
      activationHash: currentActivationHash,
      checkpointId: currentCheckpointId,
      requirementHash: currentRequirementHash
    });
    await seedPlan(rawTransaction, {
      planId: stalePlanId,
      planHash: stalePlanHash,
      policyId: stalePolicyId,
      policyHash: stalePolicyHash,
      activationId: staleActivationId,
      activationHash: staleActivationHash,
      checkpointId: staleCheckpointId,
      requirementHash: staleRequirementHash
    });
    await transaction.execute(sql.raw("set constraints all immediate"));
  });
}

async function seedPolicy(
  transaction: RawSqlExecutor,
  input: Readonly<{
    policyId: string;
    policyHash: string;
    activationId: string;
    activationHash: string;
  }>
): Promise<void> {
  await transaction.execute(sql`
    insert into inbox_v2_data_governance_effective_policies (
      tenant_id, policy_id, version, policy_hash, registry_id,
      registry_revision, governance_context_id, governance_context_version,
      deployment_profile, effective_at, canonical_snapshot, created_at
    ) values (
      ${tenantId}, ${input.policyId}, 1, ${input.policyHash}, ${registryId},
      1, ${contextId}, 1, 'saas_shared', ${policyEffectiveAt},
      '{}'::jsonb, ${contextEffectiveAt}
    )
  `);
  await transaction.execute(sql`
    insert into inbox_v2_data_governance_policy_activations (
      tenant_id, activation_id, revision, activation_hash, policy_id,
      policy_version, candidate_policy_hash, governance_context_id,
      governance_context_version, governance_context_hash, transition_kind,
      prior_activation_id, prior_activation_revision, prior_policy_version,
      requester_principal_kind, requester_principal_key,
      requester_decision_id, requester_decision_hash,
      approver_principal_kind, approver_principal_key,
      approver_decision_id, approver_decision_hash, reason_code,
      impact_preview_hash, impact_stream_epoch, impact_sync_generation,
      impact_complete_through_position, affected_root_count,
      affected_byte_count, held_root_count, backup_copy_count,
      earliest_destructive_at, requested_at, approved_at, not_before,
      activated_at, canonical_snapshot
    ) values (
      ${tenantId}, ${input.activationId}, 1, ${input.activationHash},
      ${input.policyId}, 1, ${input.policyHash}, ${contextId}, 1,
      ${contextHash}, 'initial_reviewed_bootstrap', null, null, null,
      'service', 'service:db009-run-requester', 'decision:db009-requester',
      ${digest("8")}, 'service', 'service:db009-run-approver',
      'decision:db009-approver', ${digest("9")}, 'db009_run_fixture',
      ${digest("0")}, 'epoch:db009-run', 1, 0, 1, 0, 0, 0,
      ${earliestExecutionAt}, ${registryCreatedAt}, ${activationApprovedAt},
      ${activationNotBefore}, ${activationActivatedAt}, '{}'::jsonb
    )
  `);
}

async function seedPlan(
  transaction: RawSqlExecutor,
  input: Readonly<{
    planId: string;
    planHash: string;
    policyId: string;
    policyHash: string;
    activationId: string;
    activationHash: string;
    checkpointId: string;
    requirementHash: string;
  }>
): Promise<void> {
  await transaction.execute(sql`
    insert into inbox_v2_data_governance_deletion_plans (
      tenant_id, plan_id, revision, plan_hash, cause,
      decision_basis_kind, decision_basis_id, decision_basis_hash,
      request_id, request_revision, manifest_id, manifest_revision,
      registry_id, registry_revision, registry_composition_hash,
      governance_context_id, governance_context_version,
      governance_context_hash, policy_id, policy_version, policy_hash,
      activation_id, activation_revision, activation_hash,
      legal_hold_set_revision, restriction_set_revision, stream_epoch,
      sync_generation, complete_through_position, earliest_execution_at,
      canonical_snapshot, created_at
    ) values (
      ${tenantId}, ${input.planId}, 1, ${input.planHash},
      'retention_expiry', 'lifecycle_policy',
      ${`lifecycle-decision:${input.planId}`}, ${digest("a")}, null, null,
      ${manifestId}, 1, ${registryId}, 1, ${registryHash}, ${contextId}, 1,
      ${contextHash}, ${input.policyId}, 1, ${input.policyHash},
      ${input.activationId}, 1, ${input.activationHash}, 0, 0,
      'epoch:db009-run', 1, 0, ${earliestExecutionAt}, '{}'::jsonb,
      ${planCreatedAt}
    )
  `);
  await transaction.execute(sql`
    insert into inbox_v2_data_governance_deletion_checkpoint_requirements (
      tenant_id, plan_id, plan_revision, checkpoint_id, requirement_hash,
      surface, registry_id, registry_revision, storage_root_id,
      data_class_id, root_kind, boundary, copy_role, root_record_id,
      entity_type_id, entity_id, expected_entity_revision,
      expected_lineage_revision, delete_handler_id,
      verification_handler_id, expiry_ledger_handler_id,
      external_delete_handler_id, canonical_snapshot
    ) values (
      ${tenantId}, ${input.planId}, 1, ${input.checkpointId},
      ${input.requirementHash}, 'operated', ${registryId}, 1,
      ${storageRootId}, ${dataClassId}, 'sql', 'operated_data_plane',
      'primary', ${rootRecordId}, ${entityTypeId}, ${entityId}, 1, 1,
      ${deleteHandlerId}, ${verificationHandlerId}, null, null,
      '{}'::jsonb
    )
  `);
}

function createRunInput(
  label: string,
  overrides: Readonly<{
    planId?: string;
    planHash?: string;
    startedAt?: string;
  }> = {}
): InboxV2CreateDeletionRunInput {
  const planId = overrides.planId ?? currentPlanId;
  const planHash = overrides.planHash ?? currentPlanHash;
  return inboxV2CreateDeletionRunInputSchema.parse({
    tenantId,
    runId: runIdFor(label),
    revision: "1",
    plan: { tenantId, planId, revision: "1", planHash },
    terminalExport: null,
    startedAt: overrides.startedAt ?? startedAt
  });
}

function stageOneInput(
  run: InboxV2CreateDeletionRunInput,
  label: string,
  overrides: Readonly<{
    committedAt?: string;
    updatedAt?: string;
  }> = {}
): InboxV2CommitDeletionStageOneInput {
  const committedAt = overrides.committedAt ?? stageOneCommittedAt;
  const updatedAt = overrides.updatedAt ?? stageOneUpdatedAt;
  const initial = initialInboxV2DeletionRunMutableState(run);
  const { stateHash: _stateHash, ...initialWithoutHash } = initial;
  const nextWithoutHash = {
    ...initialWithoutHash,
    stageOneState: "content_unavailable" as const,
    stageOneCommittedAt: committedAt,
    updatedAt
  };
  return inboxV2CommitDeletionStageOneInputSchema.parse({
    tenantId,
    runId: run.runId,
    revision: run.revision,
    expectedState: "executing",
    expectedStageOneState: "pending",
    expectedStateRevision: "1",
    next: {
      ...nextWithoutHash,
      stateHash: calculateInboxV2DeletionRunMutableStateHash(nextWithoutHash)
    },
    targets: [
      {
        checkpointId: currentCheckpointId,
        requirementHash: currentRequirementHash,
        root: {
          tenantId,
          dataClassId,
          storageRootId,
          recordId: rootRecordId
        },
        entity: { tenantId, entityTypeId, entityId },
        expectedRevision: "1",
        resultingRevision: "2",
        tombstoneManifest: {
          tenantId,
          recordId: `tombstone:${label}-${suffix}`,
          schemaId: "core:deletion-tombstone",
          schemaVersion: "v1",
          digest: labelDigest(label, "b")
        },
        invalidationDigest: labelDigest(label, "c"),
        committedAt
      }
    ]
  });
}

function verificationPendingInput(
  run: InboxV2CreateDeletionRunInput,
  stageOne: InboxV2CommitDeletionStageOneInput
): InboxV2DeletionRunStateTransitionInput {
  const { stateHash: _stateHash, ...stageOneWithoutHash } = stageOne.next;
  const nextWithoutHash = {
    ...stageOneWithoutHash,
    state: "verification_pending" as const,
    updatedAt: verificationUpdatedAt
  };
  return inboxV2DeletionRunStateTransitionInputSchema.parse({
    tenantId,
    runId: run.runId,
    revision: run.revision,
    expectedState: "executing",
    expectedStageOneState: "content_unavailable",
    expectedStateRevision: "2",
    next: {
      ...nextWithoutHash,
      stateHash: calculateInboxV2DeletionRunMutableStateHash(nextWithoutHash)
    }
  });
}

function failAfterConstraintsExecutor(
  db: HuleeDatabase,
  failure: Error
): InboxV2DeletionRunStateTransactionExecutor {
  const rawDatabase = db as unknown as RawSqlExecutor;
  return {
    async execute<Row extends Record<string, unknown>>(
      query: SQL
    ): Promise<RawSqlQueryResult<Row>> {
      return rawDatabase.execute<Row>(query);
    },
    async transaction<TResult>(
      work: (transaction: RawSqlExecutor) => Promise<TResult>
    ): Promise<TResult> {
      return db.transaction(async (transaction) => {
        const rawTransaction = transaction as unknown as RawSqlExecutor;
        const failingTransaction: RawSqlExecutor = {
          async execute<Row extends Record<string, unknown>>(
            query: SQL
          ): Promise<RawSqlQueryResult<Row>> {
            const result = await rawTransaction.execute<Row>(query);
            if (
              new PgDialect().sqlToQuery(query).sql.trim() ===
              "set constraints all immediate"
            ) {
              throw failure;
            }
            return result;
          }
        };
        return work(failingTransaction);
      });
    }
  };
}

async function loadRun(
  db: HuleeDatabase,
  runId: string
): Promise<Record<string, unknown>> {
  const result = await db.execute<Record<string, unknown>>(sql`
    select state_revision::text as state_revision,
           state, stage_one_state, started_at, updated_at, state_hash,
           operated_checkpoint_count::text as operated_checkpoint_count,
           backup_checkpoint_count::text as backup_checkpoint_count,
           external_checkpoint_count::text as external_checkpoint_count,
           completed_checkpoint_count::text as completed_checkpoint_count,
           primary_absence_verified, has_internal_residual,
           has_external_residual, has_backup_expiry_pending
      from inbox_v2_data_governance_deletion_runs
     where tenant_id = ${tenantId}
       and run_id = ${runId}
       and revision = 1
  `);
  const row = result.rows[0];
  if (row === undefined) throw new Error(`Deletion run ${runId} is missing.`);
  return row;
}

async function runCount(db: HuleeDatabase, runId: string): Promise<number> {
  const result = await db.execute<{ count: string }>(sql`
    select count(*)::text as count
      from inbox_v2_data_governance_deletion_runs
     where tenant_id = ${tenantId} and run_id = ${runId}
  `);
  return Number(result.rows[0]?.count ?? "0");
}

async function stageOneTargetCount(
  db: HuleeDatabase,
  runId: string
): Promise<number> {
  const result = await db.execute<{ count: string }>(sql`
    select count(*)::text as count
      from inbox_v2_data_governance_deletion_stage_one_targets
     where tenant_id = ${tenantId} and run_id = ${runId}
  `);
  return Number(result.rows[0]?.count ?? "0");
}

function runIdFor(label: string): string {
  return `run:db009-${label}-${suffix}`;
}

function labelDigest(label: string, fallback: string): string {
  return digest(`${fallback}:${label}`);
}

function digest(value: string) {
  return inboxV2Sha256DigestSchema.parse(
    `sha256:${createHash("sha256")
      .update(`db009-deletion-run:${suffix}:${value}`)
      .digest("hex")}`
  );
}

function timestamp(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}

function timestampValue(value: unknown): string {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error("Invalid timestamp.");
  return parsed.toISOString();
}
