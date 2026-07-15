import {
  calculateInboxV2DeletionRunMutableStateHash,
  inboxV2ClaimDestructiveCheckpointInputSchema,
  inboxV2CommitDeletionStageOneInputSchema,
  inboxV2CreateDeletionRunInputSchema,
  inboxV2PrivacyExportArtifactLifecycleRevisionSchema,
  inboxV2PrivacyExportLifecycleBootstrapInputSchema,
  inboxV2PrivacyExportLifecycleSnapshotSchema,
  inboxV2Sha256DigestSchema,
  inboxV2TenantIdSchema,
  initialInboxV2DeletionRunMutableState,
  type InboxV2ClaimDestructiveCheckpointInput,
  type InboxV2PrivacyExportLifecycleBootstrapInput,
  type InboxV2PrivacyExportLifecycleSnapshot
} from "@hulee/contracts";
import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHuleeDatabase,
  createHuleeDatabase,
  type HuleeDatabase
} from "../client";
import { createSqlInboxV2DeletionRunStateRepository } from "./sql-inbox-v2-deletion-run-state-repository";
import { createSqlInboxV2DestructiveCheckpointGuardRepository } from "./sql-inbox-v2-destructive-checkpoint-guard-repository";
import { createSqlInboxV2PrivacyExportLifecycleRepository } from "./sql-inbox-v2-privacy-export-lifecycle-repository";
import type { RawSqlExecutor } from "./sql-outbox-repository";

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const registryId = `core:db009-guard-registry-${suffix}`;
const registryHash = digest("registry");
const deleteHandlerId = `core:db009-guard-delete-${suffix}`;
const verificationHandlerId = `core:db009-guard-verify-${suffix}`;
const exportHandlerId = `core:db009-guard-export-${suffix}`;
const dataClassId = "core:message-content";
const entityTypeId = "core:message";

const clock = Date.now();
const registryCreatedAt = timestamp(clock - 10 * 60_000);
const registryActivatedAt = timestamp(clock - 9 * 60_000);
const contextEffectiveAt = timestamp(clock - 8 * 60_000);
const policyEffectiveAt = timestamp(clock - 7 * 60_000);
const activationApprovedAt = timestamp(clock - 6 * 60_000);
const activationNotBefore = timestamp(clock - 5 * 60_000);
const activationActivatedAt = timestamp(clock - 4 * 60_000);
const manifestFrozenAt = timestamp(clock - 3 * 60_000);
const planCreatedAt = timestamp(clock - 2 * 60_000);
const earliestExecutionAt = timestamp(clock - 60_000);
const reviewAt = timestamp(clock + 24 * 60 * 60_000);

type GuardFixture = Readonly<{
  label: string;
  tenantId: string;
  cause: "retention_expiry" | "tenant_offboarding";
  legalHoldSetRevision: "0" | "1";
  storageRootId: string;
  rootRecordId: string;
  entityId: string;
  contextId: string;
  contextHash: string;
  policyId: string;
  policyHash: string;
  activationId: string;
  activationHash: string;
  manifestId: string;
  manifestHash: string;
  rootSetHash: string;
  exportRootSetHash: string;
  scopeProofHash: string;
  planId: string;
  planHash: string;
  checkpointId: string;
  requirementHash: string;
  requestId: string | null;
  decisionBasisHash: string;
  streamEpoch: string;
}>;

type ExecutableRun = Readonly<{
  tenantId: string;
  runId: string;
  revision: "1";
  startedAt: string;
}>;

type ReadyTerminalExport = Readonly<{
  bootstrap: InboxV2PrivacyExportLifecycleBootstrapInput;
  ready: InboxV2PrivacyExportLifecycleSnapshot;
  jobId: string;
  manifestId: string;
  artifactId: string;
  artifactClaimKey: string;
  manifestHash: string;
  payloadChecksum: string;
  readyAt: string;
  expiresAt: string;
}>;

const normal = guardFixture("normal", "retention_expiry", "0");
const held = guardFixture("held", "retention_expiry", "1");
const offboarding = guardFixture("offboarding", "tenant_offboarding", "0");
const foreignTenantId = inboxV2TenantIdSchema.parse(
  `tenant:db009-guard-foreign-${suffix}`
);

describePostgres(
  "SQL Inbox V2 destructive checkpoint guard (PostgreSQL)",
  () => {
    let db: HuleeDatabase;
    let heldRun: ExecutableRun;
    let denialRun: ExecutableRun;
    let fencingRun: ExecutableRun;
    let currentExportRun: ExecutableRun;
    let revokedExportRun: ExecutableRun;
    let expiredExportRun: ExecutableRun;
    let currentExport: ReadyTerminalExport;
    let revokedExport: ReadyTerminalExport;
    let expiredExport: ReadyTerminalExport;

    beforeAll(async () => {
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) {
        throw new Error(
          "DATABASE_URL is required for the destructive-guard integration test."
        );
      }
      db = createHuleeDatabase({
        connectionString: databaseUrl,
        poolConfig: { max: 8 }
      });
      const readiness = await db.execute<{
        leases: string | null;
        legalHolds: string | null;
        terminalExports: string | null;
      }>(sql`
        select
          to_regclass(
            'public.inbox_v2_data_governance_destructive_checkpoint_leases'
          )::text as leases,
          to_regclass(
            'public.inbox_v2_data_governance_legal_hold_revisions'
          )::text as "legalHolds",
          to_regclass(
            'public.inbox_v2_data_governance_deletion_run_terminal_exports'
          )::text as "terminalExports"
      `);
      expect(readiness.rows[0]).toEqual({
        leases: "inbox_v2_data_governance_destructive_checkpoint_leases",
        legalHolds: "inbox_v2_data_governance_legal_hold_revisions",
        terminalExports:
          "inbox_v2_data_governance_deletion_run_terminal_exports"
      });

      await seedGuardAuthority(db);
      heldRun = await seedExecutableRun(db, held, "hold-race");
      denialRun = await seedExecutableRun(db, normal, "denials");
      fencingRun = await seedExecutableRun(db, normal, "fencing");

      currentExport = await seedReadyTerminalExport(
        db,
        "current",
        timestamp(Date.now() + 2 * 60_000)
      );
      revokedExport = await seedReadyTerminalExport(
        db,
        "revoked",
        timestamp(Date.now() + 2 * 60_000)
      );
      expiredExport = await seedReadyTerminalExport(
        db,
        "expired",
        timestamp(Date.now() + 5_000)
      );
      expiredExportRun = await seedExecutableRun(
        db,
        offboarding,
        "terminal-expired",
        expiredExport
      );
      currentExportRun = await seedExecutableRun(
        db,
        offboarding,
        "terminal-current",
        currentExport
      );
      revokedExportRun = await seedExecutableRun(
        db,
        offboarding,
        "terminal-revoked",
        revokedExport
      );
      await revokeTerminalExport(db, revokedExport);
    }, 120_000);

    afterAll(async () => {
      if (db) await closeHuleeDatabase(db);
    });

    it("blocks two concurrent lease claims on one exact active legal hold", async () => {
      const repository =
        createSqlInboxV2DestructiveCheckpointGuardRepository(db);
      const contenders = await Promise.all([
        repository.claim(claimFor(held, heldRun, "hold-left")),
        repository.claim(claimFor(held, heldRun, "hold-right"))
      ]);

      expect(contenders).toEqual([
        {
          outcome: "blocked_by_legal_hold",
          hold: {
            tenantId: held.tenantId,
            holdId: holdIdFor(held),
            revision: "1"
          },
          reviewAt
        },
        {
          outcome: "blocked_by_legal_hold",
          hold: {
            tenantId: held.tenantId,
            holdId: holdIdFor(held),
            revision: "1"
          },
          reviewAt
        }
      ]);
      expect(await leaseCount(db, held.tenantId, heldRun.runId)).toBe(0);
    });

    it("denies a substituted root, handler and cross-tenant lineage without a lease", async () => {
      const repository =
        createSqlInboxV2DestructiveCheckpointGuardRepository(db);
      const exact = claimFor(normal, denialRun, "denial-base");
      const missingRoot = inboxV2ClaimDestructiveCheckpointInputSchema.parse({
        ...exact,
        checkpoint: {
          ...exact.checkpoint,
          root: {
            ...exact.checkpoint.root,
            storageRootId: `core:missing-db009-guard-root-${suffix}`
          }
        }
      });
      const missingHandler = inboxV2ClaimDestructiveCheckpointInputSchema.parse(
        {
          ...exact,
          checkpoint: {
            ...exact.checkpoint,
            handlers: {
              ...exact.checkpoint.handlers,
              deleteHandlerId: `core:missing-db009-guard-handler-${suffix}`
            }
          }
        }
      );
      const crossTenant = crossTenantClaim(exact);

      await expect(repository.claim(missingRoot)).resolves.toEqual({
        outcome: "checkpoint_conflict",
        facet: "root"
      });
      await expect(repository.claim(missingHandler)).resolves.toEqual({
        outcome: "checkpoint_conflict",
        facet: "handler_set"
      });
      await expect(repository.claim(crossTenant)).resolves.toEqual({
        outcome: "not_found",
        subject: "plan"
      });
      expect(await leaseCount(db, normal.tenantId, denialRun.runId)).toBe(0);
      expect(await leaseCount(db, foreignTenantId, denialRun.runId)).toBe(0);
    });

    it("fences stale plan/control observations and an active competing lease token", async () => {
      const repository =
        createSqlInboxV2DestructiveCheckpointGuardRepository(db);
      const exact = claimFor(normal, fencingRun, "lease-owner", 30);
      const stalePlan = inboxV2ClaimDestructiveCheckpointInputSchema.parse({
        ...exact,
        plan: { ...exact.plan, planHash: digest("stale-plan-observation") }
      });
      const staleControl = inboxV2ClaimDestructiveCheckpointInputSchema.parse({
        ...exact,
        expectedControlSet: {
          legalHoldSetRevision: "1",
          restrictionSetRevision: "0"
        }
      });

      await expect(repository.claim(stalePlan)).resolves.toEqual({
        outcome: "checkpoint_conflict",
        facet: "plan_hash"
      });
      await expect(repository.claim(staleControl)).resolves.toEqual({
        outcome: "control_set_conflict",
        current: {
          legalHoldSetRevision: "0",
          restrictionSetRevision: "0"
        }
      });
      await expect(repository.claim(exact)).resolves.toMatchObject({
        outcome: "granted",
        lease: { claimRevision: "1" }
      });
      await expect(repository.claim(exact)).resolves.toMatchObject({
        outcome: "already_granted",
        lease: { claimRevision: "1" }
      });
      const competing = inboxV2ClaimDestructiveCheckpointInputSchema.parse({
        ...exact,
        leaseToken: leaseToken("lease-competitor")
      });
      await expect(repository.claim(competing)).resolves.toMatchObject({
        outcome: "lease_conflict",
        state: "claimed",
        claimRevision: "1"
      });
      expect(await leaseCount(db, normal.tenantId, fencingRun.runId)).toBe(1);
      expect(
        await persistedFenceHash(db, normal.tenantId, fencingRun.runId)
      ).not.toContain(exact.leaseToken);
    });

    it("requires a current terminal export and fails closed after revoke or expiry", async () => {
      const repository =
        createSqlInboxV2DestructiveCheckpointGuardRepository(db);
      await expect(
        terminalBinding(db, offboarding.tenantId, currentExportRun.runId)
      ).resolves.toEqual({
        job_id: currentExport.jobId,
        manifest_id: currentExport.manifestId,
        artifact_id: currentExport.artifactId,
        artifact_revision: "2"
      });
      await expect(
        repository.claim(
          claimFor(offboarding, currentExportRun, "terminal-current", 300)
        )
      ).resolves.toMatchObject({
        outcome: "granted",
        lease: { leaseExpiresAt: currentExport.expiresAt }
      });

      await expect(
        repository.claim(
          claimFor(offboarding, revokedExportRun, "terminal-revoked")
        )
      ).resolves.toEqual({
        outcome: "run_not_executable",
        reason: "terminal_export_not_current"
      });
      expect(
        await leaseCount(db, offboarding.tenantId, revokedExportRun.runId)
      ).toBe(0);

      await waitUntilAfter(expiredExport.expiresAt);
      await expect(
        repository.claim(
          claimFor(offboarding, expiredExportRun, "terminal-expired")
        )
      ).resolves.toEqual({
        outcome: "run_not_executable",
        reason: "terminal_export_not_current"
      });
      expect(
        await leaseCount(db, offboarding.tenantId, expiredExportRun.runId)
      ).toBe(0);
    });
  }
);

async function seedGuardAuthority(db: HuleeDatabase): Promise<void> {
  await db.transaction(async (transaction) => {
    const rawTransaction = transaction as unknown as RawSqlExecutor;
    await transaction.execute(sql`
      insert into tenants (id, slug, display_name, deployment_type)
      values
        (${normal.tenantId}, ${`db009-guard-normal-${suffix}`},
         'DB009 destructive guard tenant', 'saas_shared'),
        (${held.tenantId}, ${`db009-guard-held-${suffix}`},
         'DB009 destructive guard held tenant', 'saas_shared'),
        (${offboarding.tenantId}, ${`db009-guard-offboarding-${suffix}`},
         'DB009 destructive guard offboarding tenant', 'saas_shared'),
        (${foreignTenantId}, ${`db009-guard-foreign-${suffix}`},
         'DB009 destructive guard foreign tenant', 'saas_shared')
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
        ),
        (
          ${registryId}, 1, ${exportHandlerId}, 'export_execution', null,
          1, true, true, true, true, true, false, '{}'::jsonb
        )
    `);
    for (const fixture of [normal, held, offboarding]) {
      await transaction.execute(sql`
        insert into inbox_v2_data_governance_storage_roots (
          registry_id, registry_revision, storage_root_id, kind, boundary,
          version_enumeration, configuration_profile_id, owner_module_id,
          canonical_snapshot
        ) values (
          ${registryId}, 1, ${fixture.storageRootId}, 'sql',
          'operated_data_plane', 'not_applicable',
          ${`profile:db009-guard-${fixture.label}`}, null, '{}'::jsonb
        )
      `);
      await transaction.execute(sql`
        insert into inbox_v2_data_governance_contexts (
          tenant_id, context_id, version, context_hash, policy_revision,
          registry_id, registry_revision, deployment_profile, time_zone,
          tzdb_version, approved_at, effective_at, review_at,
          canonical_snapshot
        ) values (
          ${fixture.tenantId}, ${fixture.contextId}, 1,
          ${fixture.contextHash}, 1, ${registryId}, 1, 'saas_shared', 'UTC',
          '2026a', ${registryCreatedAt}, ${contextEffectiveAt}, ${reviewAt},
          '{}'::jsonb
        )
      `);
      await transaction.execute(sql`
        insert into inbox_v2_data_governance_effective_policies (
          tenant_id, policy_id, version, policy_hash, registry_id,
          registry_revision, governance_context_id, governance_context_version,
          deployment_profile, effective_at, canonical_snapshot, created_at
        ) values (
          ${fixture.tenantId}, ${fixture.policyId}, 1, ${fixture.policyHash},
          ${registryId}, 1, ${fixture.contextId}, 1, 'saas_shared',
          ${policyEffectiveAt}, '{}'::jsonb, ${contextEffectiveAt}
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
          ${fixture.tenantId}, ${fixture.activationId}, 1,
          ${fixture.activationHash}, ${fixture.policyId}, 1,
          ${fixture.policyHash}, ${fixture.contextId}, 1,
          ${fixture.contextHash}, 'initial_reviewed_bootstrap', null, null,
          null, 'service', ${`service:db009-guard-${fixture.label}-requester`},
          ${`decision:db009-guard-${fixture.label}-requester`},
          ${digest(`${fixture.label}:requester`)}, 'service',
          ${`service:db009-guard-${fixture.label}-approver`},
          ${`decision:db009-guard-${fixture.label}-approver`},
          ${digest(`${fixture.label}:approver`)}, 'db009_guard_fixture',
          ${digest(`${fixture.label}:impact`)}, ${fixture.streamEpoch}, 1, 0,
          1, 0, 0, 0, ${earliestExecutionAt}, ${registryCreatedAt},
          ${activationApprovedAt}, ${activationNotBefore},
          ${activationActivatedAt}, '{}'::jsonb
        )
      `);
      await transaction.execute(sql`
        insert into inbox_v2_data_governance_policy_activation_heads (
          tenant_id, policy_id, current_policy_version,
          current_activation_id, current_activation_revision,
          head_revision, updated_at
        ) values (
          ${fixture.tenantId}, ${fixture.policyId}, 1,
          ${fixture.activationId}, 1, 1, ${activationActivatedAt}
        )
      `);
      await transaction.execute(sql`
        insert into inbox_v2_data_governance_control_set_heads (
          tenant_id, legal_hold_set_revision, restriction_set_revision,
          last_changed_stream_position, head_revision, updated_at
        ) values (
          ${fixture.tenantId}, ${fixture.legalHoldSetRevision}, 0,
          ${fixture.legalHoldSetRevision}, 1, ${activationActivatedAt}
        )
      `);
      await transaction.execute(sql`
        insert into inbox_v2_data_governance_scope_manifests (
          tenant_id, manifest_id, revision, registry_id, registry_revision,
          kind, manifest_hash, stream_epoch, sync_generation,
          complete_through_position, frozen_at, canonical_snapshot
        ) values (
          ${fixture.tenantId}, ${fixture.manifestId}, 1, ${registryId}, 1,
          ${fixture.cause === "tenant_offboarding" ? "tenant_wide" : "exact"},
          ${fixture.manifestHash}, ${fixture.streamEpoch}, 1, 0,
          ${manifestFrozenAt}, '{}'::jsonb
        )
      `);
      await transaction.execute(sql`
        insert into inbox_v2_data_governance_scope_manifest_roots (
          tenant_id, manifest_id, manifest_revision, registry_id,
          registry_revision, data_class_id, storage_root_id, root_record_id,
          root_kind, boundary, copy_role, entity_type_id, entity_id,
          expected_entity_revision, expected_lineage_revision
        ) values (
          ${fixture.tenantId}, ${fixture.manifestId}, 1, ${registryId}, 1,
          ${dataClassId}, ${fixture.storageRootId}, ${fixture.rootRecordId},
          'sql', 'operated_data_plane', 'primary', ${entityTypeId},
          ${fixture.entityId}, 1, 1
        )
      `);
      if (fixture.cause === "tenant_offboarding") {
        await seedTenantTerminationAuthority(rawTransaction, fixture);
        await seedTenantTerminationRequest(rawTransaction, fixture);
      }
      await seedDeletionPlan(rawTransaction, fixture);
    }
    await seedExactLegalHold(rawTransaction, held);
    await transaction.execute(sql.raw("set constraints all immediate"));
  });
}

async function seedTenantTerminationAuthority(
  transaction: RawSqlExecutor,
  fixture: GuardFixture
): Promise<void> {
  await transaction.execute(sql`
    insert into inbox_v2_data_governance_tenant_termination_scope_authorities (
      tenant_id, manifest_id, manifest_revision, registry_composition_hash,
      root_set_hash, export_root_set_hash, proof_hash,
      governance_context_id, governance_context_version,
      governance_context_hash, policy_id, policy_version, policy_hash,
      activation_id, activation_revision, activation_hash
    ) values (
      ${fixture.tenantId}, ${fixture.manifestId}, 1, ${registryHash},
      ${fixture.rootSetHash}, ${fixture.exportRootSetHash},
      ${fixture.scopeProofHash}, ${fixture.contextId}, 1,
      ${fixture.contextHash}, ${fixture.policyId}, 1, ${fixture.policyHash},
      ${fixture.activationId}, 1, ${fixture.activationHash}
    )
  `);
}

async function seedTenantTerminationRequest(
  transaction: RawSqlExecutor,
  fixture: GuardFixture
): Promise<void> {
  await transaction.execute(sql`
    insert into inbox_v2_data_governance_privacy_request_revisions (
      tenant_id, request_id, revision, intent, state, subject_kind,
      subject_key, registry_id, registry_revision, governance_context_id,
      governance_context_version, governance_context_hash, policy_id,
      policy_version, policy_hash, scope_manifest_id, scope_manifest_revision,
      legal_hold_set_revision, restriction_set_revision, decision_hash,
      reason_code, due_at, completed_at, canonical_snapshot, created_at
    ) values (
      ${fixture.tenantId}, ${fixture.requestId}, 1,
      'tenant_termination_export_delete', 'approved', 'account',
      ${`account:db009-guard-${fixture.label}`}, ${registryId}, 1,
      ${fixture.contextId}, 1, ${fixture.contextHash}, ${fixture.policyId}, 1,
      ${fixture.policyHash}, ${fixture.manifestId}, 1, 0, 0,
      ${fixture.decisionBasisHash}, 'tenant_offboarding_fixture', ${reviewAt},
      null, '{}'::jsonb, ${contextEffectiveAt}
    )
  `);
}

async function seedDeletionPlan(
  transaction: RawSqlExecutor,
  fixture: GuardFixture
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
      ${fixture.tenantId}, ${fixture.planId}, 1, ${fixture.planHash},
      ${fixture.cause},
      ${fixture.cause === "tenant_offboarding" ? "privacy_request" : "lifecycle_policy"},
      ${fixture.requestId ?? `lifecycle-decision:${fixture.planId}`},
      ${fixture.decisionBasisHash}, ${fixture.requestId},
      ${fixture.requestId === null ? null : "1"}, ${fixture.manifestId}, 1,
      ${registryId}, 1, ${registryHash}, ${fixture.contextId}, 1,
      ${fixture.contextHash}, ${fixture.policyId}, 1, ${fixture.policyHash},
      ${fixture.activationId}, 1, ${fixture.activationHash},
      ${fixture.legalHoldSetRevision}, 0, ${fixture.streamEpoch}, 1, 0,
      ${earliestExecutionAt}, '{}'::jsonb, ${planCreatedAt}
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
      ${fixture.tenantId}, ${fixture.planId}, 1, ${fixture.checkpointId},
      ${fixture.requirementHash}, 'operated', ${registryId}, 1,
      ${fixture.storageRootId}, ${dataClassId}, 'sql',
      'operated_data_plane', 'primary', ${fixture.rootRecordId},
      ${entityTypeId}, ${fixture.entityId}, 1, 1, ${deleteHandlerId},
      ${verificationHandlerId}, null, null, '{}'::jsonb
    )
  `);
}

async function seedExactLegalHold(
  transaction: RawSqlExecutor,
  fixture: GuardFixture
): Promise<void> {
  const ownerId = `employee:db009-guard-owner-${suffix}`;
  const approverId = `employee:db009-guard-approver-${suffix}`;
  const holdId = holdIdFor(fixture);
  await transaction.execute(sql`
    insert into employees (id, tenant_id, email, display_name)
    values
      (${ownerId}, ${fixture.tenantId},
       ${`db009-guard-owner-${suffix}@example.test`}, 'DB009 hold owner'),
      (${approverId}, ${fixture.tenantId},
       ${`db009-guard-approver-${suffix}@example.test`}, 'DB009 hold approver')
  `);
  await transaction.execute(sql`
    insert into inbox_v2_data_governance_legal_hold_revisions (
      tenant_id, hold_id, revision, state, scope_kind, scope_manifest_id,
      scope_manifest_revision, registry_id, registry_revision, case_id,
      matcher_handler_id, matcher_version, predicate_hash, owner_employee_id,
      approver_employee_id, reason_code, legal_reference_code, anchor_from,
      anchor_through, end_condition_id, end_condition_hash, effective_at,
      review_at, released_at, canonical_snapshot
    ) values (
      ${fixture.tenantId}, ${holdId}, 1, 'active', 'exact',
      ${fixture.manifestId}, 1, ${registryId}, 1,
      ${`case:db009-guard-${suffix}`}, null, null, null, ${ownerId},
      ${approverId}, 'litigation_hold', 'legal:db009-guard',
      ${contextEffectiveAt}, null, ${`end-condition:db009-guard-${suffix}`},
      ${digest("hold:end-condition")}, ${activationActivatedAt}, ${reviewAt},
      null, '{}'::jsonb
    )
  `);
  await transaction.execute(sql`
    insert into inbox_v2_data_governance_legal_hold_data_classes (
      tenant_id, hold_id, hold_revision, data_class_id
    ) values (${fixture.tenantId}, ${holdId}, 1, ${dataClassId})
  `);
  await transaction.execute(sql`
    insert into inbox_v2_data_governance_legal_hold_targets (
      tenant_id, hold_id, hold_revision, state, scope_manifest_id,
      scope_manifest_revision, storage_root_id, root_record_id,
      entity_type_id, entity_id, expected_entity_revision,
      expected_lineage_revision
    ) values (
      ${fixture.tenantId}, ${holdId}, 1, 'active', ${fixture.manifestId}, 1,
      ${fixture.storageRootId}, ${fixture.rootRecordId}, ${entityTypeId},
      ${fixture.entityId}, 1, 1
    )
  `);
  await transaction.execute(sql`
    insert into inbox_v2_data_governance_legal_hold_heads (
      tenant_id, hold_id, current_revision, state, head_revision, updated_at
    ) values (
      ${fixture.tenantId}, ${holdId}, 1, 'active', 1,
      ${activationActivatedAt}
    )
  `);
}

async function seedReadyTerminalExport(
  db: HuleeDatabase,
  label: string,
  expiresAt: string
): Promise<ReadyTerminalExport> {
  const lifecycle = createSqlInboxV2PrivacyExportLifecycleRepository(db);
  const jobId = `privacy-export-job:db009-guard-${label}-${suffix}`;
  const manifestId = `privacy-export-manifest:db009-guard-${label}-${suffix}`;
  const artifactId = `privacy-export-artifact:db009-guard-${label}-${suffix}`;
  const artifactClaimKey = `artifact-claim:db009-guard-${label}-${suffix}`;
  const requestedAt = timestamp(Date.now() - 4_000);
  const buildingAt = timestamp(Date.now() - 3_000);
  const readyAt = timestamp(Date.now() - 2_000);
  const readyUpdatedAt = timestamp(Date.now() - 1_000);
  const bootstrap = inboxV2PrivacyExportLifecycleBootstrapInputSchema.parse({
    key: {
      tenantId: offboarding.tenantId,
      jobId,
      revision: "1",
      requestedAt
    },
    productKind: "tenant_deployment",
    productAuthority: {
      kind: "tenant_deployment",
      tenantScope: {
        kind: "tenant_termination_scope",
        tenantId: offboarding.tenantId,
        id: offboarding.manifestId,
        revision: "1",
        registryCompositionHash: registryHash,
        rootSetHash: offboarding.rootSetHash,
        exportRootSetHash: offboarding.exportRootSetHash,
        proofHash: offboarding.scopeProofHash
      },
      governance: {
        tenantId: offboarding.tenantId,
        id: offboarding.contextId,
        version: "1",
        contextHash: offboarding.contextHash
      },
      policy: {
        tenantId: offboarding.tenantId,
        id: offboarding.policyId,
        version: "1",
        policyHash: offboarding.policyHash
      },
      activation: {
        tenantId: offboarding.tenantId,
        id: offboarding.activationId,
        revision: "1",
        activationHash: offboarding.activationHash
      }
    },
    request: null,
    scopeManifest: null,
    registry: { id: registryId, revision: "1" },
    exportHandlerId,
    principalKey: `service:db009-guard-export-${label}`,
    createdAt: requestedAt
  });
  const initial = inboxV2PrivacyExportLifecycleSnapshotSchema.parse({
    stateRevision: "1",
    state: "queued",
    manifest: null,
    artifact: null,
    updatedAt: requestedAt
  });
  const buildingArtifact =
    inboxV2PrivacyExportArtifactLifecycleRevisionSchema.parse({
      tenantId: offboarding.tenantId,
      artifactId,
      revision: "1",
      job: bootstrap.key,
      artifactClaimKey,
      state: "building",
      manifest: null,
      payloadChecksum: null,
      payloadLocator: null,
      packagingProofHash: null,
      archiveCompositionHash: null,
      byteCount: "0",
      readyAt: null,
      expiresAt: null,
      deletedAt: null,
      recordedAt: buildingAt
    });
  const running = inboxV2PrivacyExportLifecycleSnapshotSchema.parse({
    stateRevision: "2",
    state: "running",
    manifest: null,
    artifact: {
      reference: {
        tenantId: offboarding.tenantId,
        artifactId,
        revision: "1",
        state: "building"
      },
      artifactClaimKey
    },
    updatedAt: buildingAt
  });
  const bootstrapped = await lifecycle.bootstrap(bootstrap);
  if (bootstrapped.outcome !== "applied") {
    throw new Error(`Terminal export ${label} failed to bootstrap.`);
  }
  const started = await lifecycle.compareAndSet({
    key: bootstrap.key,
    expected: initial,
    candidate: running,
    artifactRevision: buildingArtifact
  });
  if (started.outcome !== "applied") {
    throw new Error(`Terminal export ${label} failed to start.`);
  }

  const manifestHash = digest(`export:${label}:manifest`);
  const payloadChecksum = digest(`export:${label}:payload`);
  await db.execute(sql`
    insert into inbox_v2_data_governance_export_manifests (
      tenant_id, manifest_id, revision, manifest_hash, job_id, job_revision,
      scope_manifest_id, scope_manifest_revision, scope_proof_hash,
      root_set_hash, boundary, stream_epoch, sync_generation,
      complete_through_position, root_count, record_count,
      canonical_snapshot, created_at
    ) values (
      ${offboarding.tenantId}, ${manifestId}, 1, ${manifestHash}, ${jobId}, 1,
      ${offboarding.manifestId}, 1, ${offboarding.scopeProofHash},
      ${offboarding.exportRootSetHash}, 'operated_data_plane',
      ${offboarding.streamEpoch}, 1, 0, 1, 1, '{}'::jsonb, ${readyAt}
    )
  `);
  const manifest = {
    tenantId: offboarding.tenantId,
    manifestId,
    revision: "1",
    manifestHash
  } as const;
  const readyArtifact =
    inboxV2PrivacyExportArtifactLifecycleRevisionSchema.parse({
      tenantId: offboarding.tenantId,
      artifactId,
      revision: "2",
      job: bootstrap.key,
      artifactClaimKey,
      state: "ready",
      manifest,
      payloadChecksum,
      payloadLocator: `tenant/${offboarding.tenantId}/exports/${suffix}/${label}`,
      packagingProofHash: digest(`export:${label}:packaging`),
      archiveCompositionHash: digest(`export:${label}:archive`),
      byteCount: "1",
      readyAt,
      expiresAt,
      deletedAt: null,
      recordedAt: readyAt
    });
  const ready = inboxV2PrivacyExportLifecycleSnapshotSchema.parse({
    stateRevision: "3",
    state: "ready",
    manifest,
    artifact: {
      reference: {
        tenantId: offboarding.tenantId,
        artifactId,
        revision: "2",
        state: "ready"
      },
      artifactClaimKey
    },
    updatedAt: readyUpdatedAt
  });
  const completed = await lifecycle.compareAndSet({
    key: bootstrap.key,
    expected: running,
    candidate: ready,
    artifactRevision: readyArtifact
  });
  if (completed.outcome !== "applied") {
    throw new Error(`Terminal export ${label} failed to become ready.`);
  }
  return {
    bootstrap,
    ready,
    jobId,
    manifestId,
    artifactId,
    artifactClaimKey,
    manifestHash,
    payloadChecksum,
    readyAt,
    expiresAt
  };
}

async function revokeTerminalExport(
  db: HuleeDatabase,
  terminalExport: ReadyTerminalExport
): Promise<void> {
  const recordedAt = timestamp(
    Math.max(Date.now(), Date.parse(terminalExport.ready.updatedAt) + 1)
  );
  const updatedAt = timestamp(Date.parse(recordedAt) + 1);
  const quarantined = inboxV2PrivacyExportArtifactLifecycleRevisionSchema.parse(
    {
      tenantId: offboarding.tenantId,
      artifactId: terminalExport.artifactId,
      revision: "3",
      job: terminalExport.bootstrap.key,
      artifactClaimKey: terminalExport.artifactClaimKey,
      state: "quarantined",
      manifest: null,
      payloadChecksum: null,
      payloadLocator: `tenant/${offboarding.tenantId}/exports/${suffix}/revoked`,
      packagingProofHash: null,
      archiveCompositionHash: null,
      byteCount: "1",
      readyAt: null,
      expiresAt: null,
      deletedAt: null,
      recordedAt
    }
  );
  const revoked = inboxV2PrivacyExportLifecycleSnapshotSchema.parse({
    stateRevision: "4",
    state: "revoked",
    manifest: terminalExport.ready.manifest,
    artifact: {
      reference: {
        tenantId: offboarding.tenantId,
        artifactId: terminalExport.artifactId,
        revision: "3",
        state: "quarantined"
      },
      artifactClaimKey: terminalExport.artifactClaimKey
    },
    updatedAt
  });
  const result = await createSqlInboxV2PrivacyExportLifecycleRepository(
    db
  ).compareAndSet({
    key: terminalExport.bootstrap.key,
    expected: terminalExport.ready,
    candidate: revoked,
    artifactRevision: quarantined
  });
  if (result.outcome !== "applied") {
    throw new Error("Terminal export failed to revoke before guard claim.");
  }
}

async function seedExecutableRun(
  db: HuleeDatabase,
  fixture: GuardFixture,
  label: string,
  terminalExport: ReadyTerminalExport | null = null
): Promise<ExecutableRun> {
  const runInput = inboxV2CreateDeletionRunInputSchema.parse({
    tenantId: fixture.tenantId,
    runId: `privacy-deletion-run:db009-guard-${label}-${suffix}`,
    revision: "1",
    plan: {
      tenantId: fixture.tenantId,
      planId: fixture.planId,
      revision: "1",
      planHash: fixture.planHash
    },
    terminalExport:
      terminalExport === null
        ? null
        : {
            tenantId: fixture.tenantId,
            productKind: "tenant_deployment",
            job: { id: terminalExport.jobId, revision: "1" },
            manifest: {
              id: terminalExport.manifestId,
              revision: "1",
              manifestHash: terminalExport.manifestHash
            },
            artifact: {
              id: terminalExport.artifactId,
              revision: "2",
              checksum: terminalExport.payloadChecksum,
              readyAt: terminalExport.readyAt,
              expiresAt: terminalExport.expiresAt
            },
            governanceContext: {
              tenantId: fixture.tenantId,
              id: fixture.contextId,
              version: "1",
              contextHash: fixture.contextHash
            },
            policy: {
              tenantId: fixture.tenantId,
              id: fixture.policyId,
              version: "1",
              policyHash: fixture.policyHash
            },
            rootSetHash: fixture.exportRootSetHash,
            tenantScopeProofHash: fixture.scopeProofHash
          },
    startedAt: timestamp(Date.now() - 200)
  });
  const created =
    await createSqlInboxV2DeletionRunStateRepository(db).createRun(runInput);
  if (created.outcome !== "applied") {
    throw new Error(`Deletion run ${label} failed to create.`);
  }
  const run: ExecutableRun = {
    tenantId: runInput.tenantId,
    runId: runInput.runId,
    revision: "1",
    startedAt: runInput.startedAt
  };
  const initial = initialInboxV2DeletionRunMutableState(runInput);

  const committedAt = timestamp(Date.now() - 100);
  const updatedAt = timestamp(Date.now() - 50);
  const { stateHash: _stateHash, ...initialWithoutHash } = initial;
  const nextWithoutHash = {
    ...initialWithoutHash,
    stageOneState: "content_unavailable" as const,
    stageOneCommittedAt: committedAt,
    updatedAt
  };
  const stageOne = inboxV2CommitDeletionStageOneInputSchema.parse({
    tenantId: fixture.tenantId,
    runId: run.runId,
    revision: "1",
    expectedState: "executing",
    expectedStageOneState: "pending",
    expectedStateRevision: "1",
    next: {
      ...nextWithoutHash,
      stateHash: calculateInboxV2DeletionRunMutableStateHash(nextWithoutHash)
    },
    targets: [
      {
        checkpointId: fixture.checkpointId,
        requirementHash: fixture.requirementHash,
        root: {
          tenantId: fixture.tenantId,
          dataClassId,
          storageRootId: fixture.storageRootId,
          recordId: fixture.rootRecordId
        },
        entity: {
          tenantId: fixture.tenantId,
          entityTypeId,
          entityId: fixture.entityId
        },
        expectedRevision: "1",
        resultingRevision: "2",
        tombstoneManifest: {
          tenantId: fixture.tenantId,
          recordId: `tombstone:db009-guard-${label}-${suffix}`,
          schemaId: "core:deletion-tombstone",
          schemaVersion: "v1",
          digest: digest(`run:${label}:tombstone`)
        },
        invalidationDigest: digest(`run:${label}:invalidation`),
        committedAt
      }
    ]
  });
  const committed =
    await createSqlInboxV2DeletionRunStateRepository(db).commitStageOne(
      stageOne
    );
  if (committed.outcome !== "applied") {
    throw new Error(`Deletion run ${label} failed to commit stage one.`);
  }
  return run;
}

function claimFor(
  fixture: GuardFixture,
  run: ExecutableRun,
  label: string,
  leaseDurationSeconds = 60
): InboxV2ClaimDestructiveCheckpointInput {
  return inboxV2ClaimDestructiveCheckpointInputSchema.parse({
    tenantId: fixture.tenantId,
    plan: {
      tenantId: fixture.tenantId,
      planId: fixture.planId,
      revision: "1",
      planHash: fixture.planHash
    },
    run: {
      tenantId: fixture.tenantId,
      runId: run.runId,
      revision: "1"
    },
    checkpoint: {
      checkpointId: fixture.checkpointId,
      requirementHash: fixture.requirementHash,
      surface: "operated",
      registry: {
        id: registryId,
        revision: "1",
        compositionHash: registryHash
      },
      root: {
        tenantId: fixture.tenantId,
        dataClassId,
        storageRootId: fixture.storageRootId,
        recordId: fixture.rootRecordId
      },
      entity: {
        tenantId: fixture.tenantId,
        entityTypeId,
        entityId: fixture.entityId
      },
      observedEntityRevision: "1",
      observedLineageRevision: "1",
      rootKind: "sql",
      boundary: "operated_data_plane",
      copyRole: "primary",
      handlers: { deleteHandlerId, verificationHandlerId }
    },
    expectedAuthority: {
      tenantId: fixture.tenantId,
      registryCompositionHash: registryHash,
      governance: {
        tenantId: fixture.tenantId,
        id: fixture.contextId,
        version: "1",
        contextHash: fixture.contextHash
      },
      effectivePolicy: {
        tenantId: fixture.tenantId,
        id: fixture.policyId,
        version: "1",
        policyHash: fixture.policyHash
      },
      activation: {
        tenantId: fixture.tenantId,
        id: fixture.activationId,
        revision: "1",
        activationHash: fixture.activationHash
      }
    },
    expectedControlSet: {
      legalHoldSetRevision: fixture.legalHoldSetRevision,
      restrictionSetRevision: "0"
    },
    executionAuthorization: {
      tenantId: fixture.tenantId,
      id: `authorization-decision:db009-guard-${label}-${suffix}`,
      authorizationEpoch: `authorization-epoch:db009-guard-${suffix}`,
      principal: {
        kind: "trusted_service",
        trustedServiceId: "core:privacy-worker"
      },
      permissionId: "core:privacy.deletion.execute",
      resourceScopeId: "core:privacy-deletion-plan",
      resource: {
        tenantId: fixture.tenantId,
        entityTypeId: "core:privacy-deletion-plan",
        entityId: fixture.planId
      },
      resourceAccessRevision: "1",
      decisionRevision: "1",
      decisionHash: digest(`authorization:${label}`),
      outcome: "allowed",
      decidedAt: timestamp(Date.now() - 60_000),
      notAfter: timestamp(Date.now() + 10 * 60_000)
    },
    leaseToken: leaseToken(label),
    leaseDurationSeconds
  });
}

function crossTenantClaim(
  claim: InboxV2ClaimDestructiveCheckpointInput
): InboxV2ClaimDestructiveCheckpointInput {
  return inboxV2ClaimDestructiveCheckpointInputSchema.parse({
    ...claim,
    tenantId: foreignTenantId,
    plan: { ...claim.plan, tenantId: foreignTenantId },
    run: { ...claim.run, tenantId: foreignTenantId },
    checkpoint: {
      ...claim.checkpoint,
      root: { ...claim.checkpoint.root, tenantId: foreignTenantId },
      entity: { ...claim.checkpoint.entity, tenantId: foreignTenantId }
    },
    expectedAuthority: {
      ...claim.expectedAuthority,
      tenantId: foreignTenantId,
      governance: {
        ...claim.expectedAuthority.governance,
        tenantId: foreignTenantId
      },
      effectivePolicy: {
        ...claim.expectedAuthority.effectivePolicy,
        tenantId: foreignTenantId
      },
      activation: {
        ...claim.expectedAuthority.activation,
        tenantId: foreignTenantId
      }
    },
    executionAuthorization: {
      ...claim.executionAuthorization,
      tenantId: foreignTenantId,
      resource: {
        ...claim.executionAuthorization.resource,
        tenantId: foreignTenantId
      }
    }
  });
}

async function leaseCount(
  db: HuleeDatabase,
  tenantId: string,
  runId: string
): Promise<number> {
  const result = await db.execute<{ count: string }>(sql`
    select count(*)::text as count
      from inbox_v2_data_governance_destructive_checkpoint_leases
     where tenant_id = ${tenantId} and run_id = ${runId}
  `);
  return Number(result.rows[0]?.count ?? "0");
}

async function persistedFenceHash(
  db: HuleeDatabase,
  tenantId: string,
  runId: string
): Promise<string> {
  const result = await db.execute<{ execution_fence_hash: string }>(sql`
    select execution_fence_hash
      from inbox_v2_data_governance_destructive_checkpoint_leases
     where tenant_id = ${tenantId} and run_id = ${runId}
  `);
  const hash = result.rows[0]?.execution_fence_hash;
  if (hash === undefined) throw new Error("Destructive lease is missing.");
  return hash;
}

async function terminalBinding(
  db: HuleeDatabase,
  tenantId: string,
  runId: string
): Promise<{
  job_id: string;
  manifest_id: string;
  artifact_id: string;
  artifact_revision: string;
}> {
  const result = await db.execute<{
    job_id: string;
    manifest_id: string;
    artifact_id: string;
    artifact_revision: string;
  }>(sql`
    select job_id, manifest_id, artifact_id,
           artifact_revision::text as artifact_revision
      from inbox_v2_data_governance_deletion_run_terminal_exports
     where tenant_id = ${tenantId} and run_id = ${runId} and run_revision = 1
  `);
  const binding = result.rows[0];
  if (binding === undefined) {
    throw new Error("Atomic deletion-run terminal-export binding is missing.");
  }
  return binding;
}

function guardFixture(
  label: string,
  cause: GuardFixture["cause"],
  legalHoldSetRevision: GuardFixture["legalHoldSetRevision"]
): GuardFixture {
  const tenantId = inboxV2TenantIdSchema.parse(
    `tenant:db009-guard-${label}-${suffix}`
  );
  return {
    label,
    tenantId,
    cause,
    legalHoldSetRevision,
    storageRootId: `core:db009-guard-root-${label}-${suffix}`,
    rootRecordId: `data_root:db009-guard-${label}-${suffix}`,
    entityId: `message:db009-guard-${label}-${suffix}`,
    contextId: `core:db009-guard-context-${label}-${suffix}`,
    contextHash: digest(`${label}:context`),
    policyId: `core:db009-guard-policy-${label}-${suffix}`,
    policyHash: digest(`${label}:policy`),
    activationId: `core:db009-guard-activation-${label}-${suffix}`,
    activationHash: digest(`${label}:activation`),
    manifestId: `core:db009-guard-scope-${label}-${suffix}`,
    manifestHash: digest(`${label}:manifest`),
    rootSetHash: digest(`${label}:root-set`),
    exportRootSetHash: digest(`${label}:export-root-set`),
    scopeProofHash: digest(`${label}:scope-proof`),
    planId: `privacy-deletion-plan:db009-guard-${label}-${suffix}`,
    planHash: digest(`${label}:plan`),
    checkpointId: `privacy-deletion-checkpoint:db009-guard-${label}-${suffix}`,
    requirementHash: digest(`${label}:requirement`),
    requestId:
      cause === "tenant_offboarding"
        ? `privacy-request:db009-guard-${label}-${suffix}`
        : null,
    decisionBasisHash: digest(`${label}:decision-basis`),
    streamEpoch: `epoch:db009-guard-${label}-${suffix}`
  };
}

function holdIdFor(fixture: GuardFixture): string {
  return `legal-hold:db009-guard-${fixture.label}-${suffix}`;
}

function leaseToken(label: string): string {
  return `lease-token:db009-guard:${suffix}:${label}:${"x".repeat(32)}`;
}

async function waitUntilAfter(value: string): Promise<void> {
  const delay = Date.parse(value) - Date.now() + 50;
  if (delay > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
  }
}

function digest(value: string) {
  return inboxV2Sha256DigestSchema.parse(
    `sha256:${createHash("sha256")
      .update(`db009-destructive-guard:${suffix}:${value}`)
      .digest("hex")}`
  );
}

function timestamp(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}
