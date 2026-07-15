import {
  calculateInboxV2DestructiveCheckpointExecutionFenceHash,
  inboxV2ClaimDestructiveCheckpointInputSchema,
  inboxV2PolicyActivationAuthoritySchema,
  inboxV2Sha256DigestSchema,
  inboxV2TenantIdSchema
} from "@hulee/contracts";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  buildFindInboxV2DestructiveCheckpointGuardSql,
  buildFindInboxV2CurrentTerminalExportSql,
  buildFindInboxV2ExactLegalHoldSql,
  buildFindInboxV2ExactRestrictionsSql,
  buildFindInboxV2ProspectiveLegalHoldSql,
  buildInsertInboxV2DestructiveCheckpointLeaseSql,
  buildLockInboxV2DestructiveCheckpointSql,
  buildTakeOverInboxV2DestructiveCheckpointLeaseSql,
  createSqlInboxV2DestructiveCheckpointGuardRepository,
  type InboxV2DestructiveCheckpointGuardTransactionExecutor
} from "./sql-inbox-v2-destructive-checkpoint-guard-repository";

const tenantId = inboxV2TenantIdSchema.parse("tenant:tenant-1");
const hashA = inboxV2Sha256DigestSchema.parse(`sha256:${"a".repeat(64)}`);
const hashB = inboxV2Sha256DigestSchema.parse(`sha256:${"b".repeat(64)}`);
const hashC = inboxV2Sha256DigestSchema.parse(`sha256:${"c".repeat(64)}`);
const checkedAt = "2026-07-15T10:00:00.000Z";
const leaseExpiresAt = "2026-07-15T10:01:00.000Z";

const authority = inboxV2PolicyActivationAuthoritySchema.parse({
  tenantId,
  registryCompositionHash: hashA,
  governance: {
    tenantId,
    id: "core:governance-context.lifecycle",
    version: "3",
    contextHash: hashB
  },
  effectivePolicy: {
    tenantId,
    id: "core:lifecycle-policy.default",
    version: "8",
    policyHash: hashC
  },
  activation: {
    tenantId,
    id: "core:lifecycle-policy-activation.default",
    revision: "2",
    activationHash: hashA
  }
});

const claim = inboxV2ClaimDestructiveCheckpointInputSchema.parse({
  tenantId,
  plan: {
    tenantId,
    planId: "privacy-deletion-plan:plan-1",
    revision: "4",
    planHash: hashB
  },
  run: {
    tenantId,
    runId: "privacy-deletion-run:run-1",
    revision: "7"
  },
  checkpoint: {
    checkpointId: "privacy-deletion-checkpoint:checkpoint-1",
    requirementHash: hashC,
    surface: "operated",
    registry: {
      id: "core:data-lifecycle-registry",
      revision: "5",
      compositionHash: hashA
    },
    root: {
      tenantId,
      dataClassId: "core:message.content",
      storageRootId: "core:message-content",
      recordId: "data_root:message-1"
    },
    entity: {
      tenantId,
      entityTypeId: "core:message",
      entityId: "message:message-1"
    },
    observedEntityRevision: "11",
    observedLineageRevision: "6",
    rootKind: "sql",
    boundary: "operated_data_plane",
    copyRole: "primary",
    handlers: {
      deleteHandlerId: "core:message.delete",
      verificationHandlerId: "core:message.verify-absence"
    }
  },
  expectedAuthority: authority,
  expectedControlSet: {
    legalHoldSetRevision: "9",
    restrictionSetRevision: "12"
  },
  executionAuthorization: {
    tenantId,
    id: "authorization-decision:deletion-1",
    authorizationEpoch: "authorization-epoch-1",
    principal: {
      kind: "trusted_service",
      trustedServiceId: "core:privacy-worker"
    },
    permissionId: "core:privacy.deletion.execute",
    resourceScopeId: "core:privacy-deletion-plan",
    resource: {
      tenantId,
      entityTypeId: "core:privacy-deletion-plan",
      entityId: "privacy-deletion-plan:plan-1"
    },
    resourceAccessRevision: "4",
    decisionRevision: "3",
    decisionHash: hashA,
    outcome: "allowed",
    decidedAt: "2026-07-15T09:55:00.000Z",
    notAfter: "2026-07-15T10:05:00.000Z"
  },
  leaseToken: `lease-token-${"x".repeat(48)}`,
  leaseDurationSeconds: 60
});
if (claim.checkpoint.surface !== "operated") {
  throw new Error("The SQL guard fixture must use an operated checkpoint.");
}
const operatedCheckpoint = claim.checkpoint;

describe("Inbox V2 destructive checkpoint SQL guard", () => {
  it("locks, re-evaluates exact authority and persists an opaque lease before I/O", async () => {
    const executor = queuedExecutor([
      [],
      [guardRow()],
      [],
      [{ found: false }],
      [{ restriction_id: "restriction:one", restriction_revision: "2" }],
      [{ found: false }],
      [],
      [leaseRow()]
    ]);

    await expect(
      createSqlInboxV2DestructiveCheckpointGuardRepository(executor).claim(
        claim
      )
    ).resolves.toMatchObject({
      outcome: "granted",
      lease: {
        tenantId,
        claimRevision: "1",
        executionFenceHash:
          calculateInboxV2DestructiveCheckpointExecutionFenceHash(
            claim.leaseToken
          ),
        fence: {
          revision: { kind: "matched" },
          lineage: { kind: "matched" },
          hold: { kind: "clear" },
          restriction: {
            restrictions: [
              { tenantId, restrictionId: "restriction:one", revision: "2" }
            ],
            restrictionExtendedRetention: false
          }
        }
      }
    });
    expect(executor.transactionCount).toBe(1);
    expect(executor.queries).toHaveLength(8);
    expect(executor.queries[0]).toContain("pg_advisory_xact_lock");
    expect(executor.queries[1]).toContain(
      "for update of run_row, activation_head, control_head"
    );
    expect(executor.queries[7]).toContain("on conflict do nothing");
  });

  it("rejects a stale observed entity revision before any hold or lease lookup", async () => {
    const executor = queuedExecutor([
      [],
      [guardRow({ expected_entity_revision: "12" })]
    ]);

    await expect(
      createSqlInboxV2DestructiveCheckpointGuardRepository(executor).claim(
        claim
      )
    ).resolves.toEqual({
      outcome: "checkpoint_conflict",
      facet: "entity_revision"
    });
    expect(executor.queries).toHaveLength(2);
  });

  it("clamps the lease lifetime to the persisted authorization boundary", async () => {
    const authorizationNotAfter = "2026-07-15T10:00:30.000Z";
    const boundedClaim = inboxV2ClaimDestructiveCheckpointInputSchema.parse({
      ...claim,
      leaseDurationSeconds: 300,
      executionAuthorization: {
        ...claim.executionAuthorization,
        notAfter: authorizationNotAfter
      }
    });
    const executor = queuedExecutor([
      [],
      [guardRow()],
      [],
      [{ found: false }],
      [],
      [{ found: false }],
      [],
      [
        leaseRow({
          authorization_not_after: authorizationNotAfter,
          lease_expires_at: authorizationNotAfter
        })
      ]
    ]);

    await expect(
      createSqlInboxV2DestructiveCheckpointGuardRepository(executor).claim(
        boundedClaim
      )
    ).resolves.toMatchObject({
      outcome: "granted",
      lease: { leaseExpiresAt: authorizationNotAfter }
    });
  });

  it("fails tenant offboarding closed without its exact current terminal export", async () => {
    const executor = queuedExecutor([
      [],
      [guardRow({ plan_cause: "tenant_offboarding" })],
      []
    ]);

    await expect(
      createSqlInboxV2DestructiveCheckpointGuardRepository(executor).claim(
        claim
      )
    ).resolves.toEqual({
      outcome: "run_not_executable",
      reason: "terminal_export_not_current"
    });
    expect(executor.queries[2]).toContain(
      "inbox_v2_data_governance_deletion_run_terminal_exports"
    );
    expect(executor.queries[2]).toContain("artifact.expires_at >");
  });

  it("clamps a tenant-offboarding lease to the exclusive terminal-export expiry", async () => {
    const exportExpiresAt = "2026-07-15T10:00:20.000Z";
    const executor = queuedExecutor([
      [],
      [guardRow({ plan_cause: "tenant_offboarding" })],
      [{ expires_at: exportExpiresAt }],
      [],
      [{ found: false }],
      [],
      [{ found: false }],
      [],
      [leaseRow({ lease_expires_at: exportExpiresAt })]
    ]);

    await expect(
      createSqlInboxV2DestructiveCheckpointGuardRepository(executor).claim(
        claim
      )
    ).resolves.toMatchObject({
      outcome: "granted",
      lease: { leaseExpiresAt: exportExpiresAt }
    });
  });

  it("blocks an exact active hold and never creates a destructive lease", async () => {
    const executor = queuedExecutor([
      [],
      [guardRow()],
      [
        {
          hold_id: "legal-hold:case-1",
          hold_revision: "3",
          review_at: "2026-08-15T10:00:00.000Z"
        }
      ]
    ]);

    await expect(
      createSqlInboxV2DestructiveCheckpointGuardRepository(executor).claim(
        claim
      )
    ).resolves.toEqual({
      outcome: "blocked_by_legal_hold",
      hold: { tenantId, holdId: "legal-hold:case-1", revision: "3" },
      reviewAt: "2026-08-15T10:00:00.000Z"
    });
    expect(executor.queries).toHaveLength(3);
  });

  it("fails closed when an active prospective matcher cannot be evaluated generically", async () => {
    const executor = queuedExecutor([[], [guardRow()], [], [{ found: true }]]);

    await expect(
      createSqlInboxV2DestructiveCheckpointGuardRepository(executor).claim(
        claim
      )
    ).resolves.toEqual({
      outcome: "scope_ambiguous",
      controlKind: "legal_hold"
    });
    expect(executor.queries).toHaveLength(4);
  });

  it("is idempotent for the same active token and rejects a competing token", async () => {
    const commonRows = [
      [],
      [guardRow()],
      [],
      [{ found: false }],
      [],
      [{ found: false }]
    ] as const;
    const same = queuedExecutor([...commonRows, [leaseRow()]]);
    await expect(
      createSqlInboxV2DestructiveCheckpointGuardRepository(same).claim(claim)
    ).resolves.toMatchObject({ outcome: "already_granted" });
    expect(same.queries).toHaveLength(7);

    const different = inboxV2ClaimDestructiveCheckpointInputSchema.parse({
      ...claim,
      leaseToken: `other-lease-token-${"y".repeat(48)}`
    });
    const competing = queuedExecutor([...commonRows, [leaseRow()]]);
    await expect(
      createSqlInboxV2DestructiveCheckpointGuardRepository(competing).claim(
        different
      )
    ).resolves.toEqual({
      outcome: "lease_conflict",
      state: "claimed",
      claimRevision: "1",
      leaseExpiresAt
    });
    expect(competing.queries).toHaveLength(7);

    const changedAuthorization =
      inboxV2ClaimDestructiveCheckpointInputSchema.parse({
        ...claim,
        executionAuthorization: {
          ...claim.executionAuthorization,
          id: "authorization-decision:deletion-2",
          decisionRevision: "4",
          decisionHash: hashB
        }
      });
    const authorizationConflict = queuedExecutor([...commonRows, [leaseRow()]]);
    await expect(
      createSqlInboxV2DestructiveCheckpointGuardRepository(
        authorizationConflict
      ).claim(changedAuthorization)
    ).resolves.toEqual({
      outcome: "lease_conflict",
      state: "claimed",
      claimRevision: "1",
      leaseExpiresAt
    });
  });

  it("maps a takeover fence-hash uniqueness race to the typed token conflict", async () => {
    const uniqueViolation = Object.assign(new Error("duplicate fence token"), {
      code: "23505"
    });
    const executor = queuedExecutor([
      [],
      [guardRow()],
      [],
      [{ found: false }],
      [],
      [{ found: false }],
      [
        leaseRow({
          state: "expired",
          lease_expires_at: "2026-07-15T09:59:00.000Z"
        })
      ],
      uniqueViolation
    ]);

    await expect(
      createSqlInboxV2DestructiveCheckpointGuardRepository(executor).claim({
        ...claim,
        leaseToken: `takeover-lease-token-${"z".repeat(48)}`
      })
    ).resolves.toEqual({ outcome: "lease_token_conflict" });
    expect(executor.queries[7]).toContain(
      "update inbox_v2_data_governance_destructive_checkpoint_leases"
    );
  });

  it("renders tenant-fenced current-head, exact-control and lease CAS SQL", () => {
    const snapshot = snapshotFixture();
    const previous = leaseRow({ state: "expired" });
    const lockSql = render(buildLockInboxV2DestructiveCheckpointSql(claim));
    const guardSql = render(
      buildFindInboxV2DestructiveCheckpointGuardSql(claim)
    );
    const terminalExportSql = render(
      buildFindInboxV2CurrentTerminalExportSql({ claim, checkedAt })
    );
    const holdSql = render(
      buildFindInboxV2ExactLegalHoldSql({ claim, snapshot })
    );
    const prospectiveSql = render(
      buildFindInboxV2ProspectiveLegalHoldSql(claim)
    );
    const restrictionSql = render(
      buildFindInboxV2ExactRestrictionsSql({ claim, snapshot })
    );
    const insertSql = render(
      buildInsertInboxV2DestructiveCheckpointLeaseSql({
        claim,
        snapshot,
        executionFenceHash:
          calculateInboxV2DestructiveCheckpointExecutionFenceHash(
            claim.leaseToken
          ),
        leaseExpiresAt
      })
    );
    const takeoverSql = render(
      buildTakeOverInboxV2DestructiveCheckpointLeaseSql({
        claim,
        snapshot,
        previous,
        executionFenceHash: hashB,
        leaseExpiresAt
      })
    );

    expect(lockSql).toContain("pg_advisory_xact_lock(hashtextextended");
    expect(guardSql).toContain("scope_root.expected_entity_revision");
    expect(guardSql).toContain(
      "join inbox_v2_data_governance_policy_activation_heads activation_head"
    );
    expect(terminalExportSql).toContain(
      "join inbox_v2_data_governance_export_artifact_heads artifact_head"
    );
    expect(terminalExportSql).toContain("export_job.state = 'ready'");
    expect(terminalExportSql).toContain(
      "export_manifest.root_set_hash = scope.export_root_set_hash"
    );
    expect(holdSql).toContain(
      "join inbox_v2_data_governance_legal_hold_targets target"
    );
    expect(holdSql).toContain(
      "join inbox_v2_data_governance_legal_hold_data_classes hold_class"
    );
    expect(holdSql).toContain("scope_root.data_class_id =");
    expect(holdSql).toContain("scope_root.registry_revision =");
    expect(holdSql).toContain("scope_root.root_kind =");
    expect(holdSql).toContain("target.expected_lineage_revision =");
    expect(prospectiveSql).toContain("scope_kind = 'prospective'");
    expect(restrictionSql).toContain(
      "head.current_revision::text as restriction_revision"
    );
    expect(restrictionSql).toContain("scope_root.data_class_id =");
    expect(restrictionSql).toContain("scope_root.registry_id =");
    expect(restrictionSql).toContain("scope_root.copy_role =");
    expect(insertSql).toContain("requirement_hash");
    expect(insertSql).toContain("registry_composition_hash");
    expect(insertSql).toContain("entity_type_id");
    expect(insertSql).toContain("authorization_decision_id");
    expect(insertSql).toContain("authorization_principal_key");
    expect(insertSql).toContain("authorization_decision_hash");
    expect(takeoverSql).toContain("claim_revision = claim_revision + 1");
    expect(takeoverSql).toContain("and execution_fence_hash =");
    expect(takeoverSql).toContain("lease_expires_at <=");
  });
});

function guardRow(patch: Record<string, unknown> = {}) {
  return {
    plan_cause: "privacy_erasure",
    plan_hash: claim.plan.planHash,
    earliest_execution_at: "2026-07-15T09:00:00.000Z",
    run_state: "executing",
    stage_one_state: "content_unavailable",
    checked_at: checkedAt,
    requirement_hash: claim.checkpoint.requirementHash,
    surface: claim.checkpoint.surface,
    registry_id: claim.checkpoint.registry.id,
    registry_revision: claim.checkpoint.registry.revision,
    plan_registry_composition_hash: authority.registryCompositionHash,
    storage_root_id: claim.checkpoint.root.storageRootId,
    data_class_id: claim.checkpoint.root.dataClassId,
    root_kind: claim.checkpoint.rootKind,
    boundary: claim.checkpoint.boundary,
    copy_role: claim.checkpoint.copyRole,
    root_record_id: claim.checkpoint.root.recordId,
    entity_type_id: claim.checkpoint.entity.entityTypeId,
    entity_id: claim.checkpoint.entity.entityId,
    expected_entity_revision: claim.checkpoint.observedEntityRevision,
    expected_lineage_revision: claim.checkpoint.observedLineageRevision,
    delete_handler_id: operatedCheckpoint.handlers.deleteHandlerId,
    verification_handler_id: operatedCheckpoint.handlers.verificationHandlerId,
    expiry_ledger_handler_id: null,
    external_delete_handler_id: null,
    plan_governance_context_id: authority.governance.id,
    plan_governance_context_version: authority.governance.version,
    plan_governance_context_hash: authority.governance.contextHash,
    plan_policy_id: authority.effectivePolicy.id,
    plan_policy_version: authority.effectivePolicy.version,
    plan_policy_hash: authority.effectivePolicy.policyHash,
    plan_activation_id: authority.activation.id,
    plan_activation_revision: authority.activation.revision,
    plan_activation_hash: authority.activation.activationHash,
    plan_legal_hold_set_revision: claim.expectedControlSet.legalHoldSetRevision,
    plan_restriction_set_revision:
      claim.expectedControlSet.restrictionSetRevision,
    current_registry_composition_hash: authority.registryCompositionHash,
    current_governance_context_id: authority.governance.id,
    current_governance_context_version: authority.governance.version,
    current_governance_context_hash: authority.governance.contextHash,
    current_policy_id: authority.effectivePolicy.id,
    current_policy_version: authority.effectivePolicy.version,
    current_policy_hash: authority.effectivePolicy.policyHash,
    current_activation_id: authority.activation.id,
    current_activation_revision: authority.activation.revision,
    current_activation_hash: authority.activation.activationHash,
    current_legal_hold_set_revision:
      claim.expectedControlSet.legalHoldSetRevision,
    current_restriction_set_revision:
      claim.expectedControlSet.restrictionSetRevision,
    ...patch
  };
}

function leaseRow(patch: Record<string, unknown> = {}) {
  return {
    tenant_id: tenantId,
    run_id: claim.run.runId,
    run_revision: claim.run.revision,
    plan_id: claim.plan.planId,
    plan_revision: claim.plan.revision,
    checkpoint_id: claim.checkpoint.checkpointId,
    requirement_hash: claim.checkpoint.requirementHash,
    claim_revision: "1",
    state: "claimed",
    execution_fence_hash:
      calculateInboxV2DestructiveCheckpointExecutionFenceHash(claim.leaseToken),
    surface: claim.checkpoint.surface,
    registry_id: claim.checkpoint.registry.id,
    registry_revision: claim.checkpoint.registry.revision,
    registry_composition_hash: claim.checkpoint.registry.compositionHash,
    storage_root_id: claim.checkpoint.root.storageRootId,
    data_class_id: claim.checkpoint.root.dataClassId,
    root_record_id: claim.checkpoint.root.recordId,
    entity_type_id: claim.checkpoint.entity.entityTypeId,
    entity_id: claim.checkpoint.entity.entityId,
    execution_handler_id: operatedCheckpoint.handlers.deleteHandlerId,
    expected_entity_revision: claim.checkpoint.observedEntityRevision,
    expected_lineage_revision: claim.checkpoint.observedLineageRevision,
    governance_context_id: authority.governance.id,
    governance_context_version: authority.governance.version,
    governance_context_hash: authority.governance.contextHash,
    policy_id: authority.effectivePolicy.id,
    policy_version: authority.effectivePolicy.version,
    policy_hash: authority.effectivePolicy.policyHash,
    activation_id: authority.activation.id,
    activation_revision: authority.activation.revision,
    activation_hash: authority.activation.activationHash,
    legal_hold_set_revision: claim.expectedControlSet.legalHoldSetRevision,
    restriction_set_revision: claim.expectedControlSet.restrictionSetRevision,
    authorization_decision_id: claim.executionAuthorization.id,
    authorization_epoch: claim.executionAuthorization.authorizationEpoch,
    authorization_principal_kind: claim.executionAuthorization.principal.kind,
    authorization_principal_key: "core:privacy-worker",
    authorization_permission_id: claim.executionAuthorization.permissionId,
    authorization_resource_scope_id:
      claim.executionAuthorization.resourceScopeId,
    authorization_resource_entity_type_id:
      claim.executionAuthorization.resource.entityTypeId,
    authorization_resource_entity_id:
      claim.executionAuthorization.resource.entityId,
    authorization_resource_access_revision:
      claim.executionAuthorization.resourceAccessRevision,
    authorization_decision_revision:
      claim.executionAuthorization.decisionRevision,
    authorization_decision_hash: claim.executionAuthorization.decisionHash,
    authorization_outcome: claim.executionAuthorization.outcome,
    authorization_decided_at: claim.executionAuthorization.decidedAt,
    authorization_not_after: claim.executionAuthorization.notAfter,
    claimed_at: checkedAt,
    lease_expires_at: leaseExpiresAt,
    completed_at: null,
    updated_at: checkedAt,
    ...patch
  };
}

function snapshotFixture() {
  const row = guardRow();
  return {
    planCause: "privacy_erasure" as const,
    planHash: String(row.plan_hash),
    earliestExecutionAt: String(row.earliest_execution_at),
    runState: String(row.run_state),
    stageOneState: String(row.stage_one_state),
    checkedAt: String(row.checked_at),
    checkpoint: {
      requirementHash: String(row.requirement_hash),
      surface: String(row.surface),
      registryId: String(row.registry_id),
      registryRevision: String(row.registry_revision),
      registryCompositionHash: String(row.plan_registry_composition_hash),
      storageRootId: String(row.storage_root_id),
      dataClassId: String(row.data_class_id),
      rootKind: String(row.root_kind),
      boundary: String(row.boundary),
      copyRole: String(row.copy_role),
      rootRecordId: String(row.root_record_id),
      entityTypeId: String(row.entity_type_id),
      entityId: String(row.entity_id),
      expectedEntityRevision: String(row.expected_entity_revision),
      expectedLineageRevision: String(row.expected_lineage_revision),
      deleteHandlerId: String(row.delete_handler_id),
      verificationHandlerId: String(row.verification_handler_id),
      expiryLedgerHandlerId: null,
      externalDeleteHandlerId: null
    },
    planAuthority: authority,
    currentAuthority: authority,
    planControlSet: claim.expectedControlSet,
    currentControlSet: claim.expectedControlSet
  };
}

function queuedExecutor(
  rows: readonly (
    | readonly Record<string, unknown>[]
    | (Error & { code?: string })
  )[]
) {
  let index = 0;
  const queries: string[] = [];
  const executor: InboxV2DestructiveCheckpointGuardTransactionExecutor & {
    queries: string[];
    transactionCount: number;
  } = {
    queries,
    transactionCount: 0,
    async execute(query) {
      queries.push(render(query));
      const result = rows[index++] ?? [];
      if (result instanceof Error) throw result;
      return { rows: result as never };
    },
    async transaction(work) {
      executor.transactionCount += 1;
      return work(executor);
    }
  };
  return executor;
}

function render(query: Parameters<PgDialect["sqlToQuery"]>[0]): string {
  return new PgDialect().sqlToQuery(query).sql.replace(/\s+/gu, " ").trim();
}
