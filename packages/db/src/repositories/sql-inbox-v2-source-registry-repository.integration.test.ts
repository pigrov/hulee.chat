import {
  INBOX_V2_INITIAL_SCHEMA_VERSION,
  calculateInboxV2CanonicalSha256,
  inboxV2CompareAndSetRetainedPrefixInputSchema,
  inboxV2EmployeeIdSchema,
  inboxV2InitializeProjectionGenerationInputSchema,
  inboxV2OutboxWorkerIdSchema,
  inboxV2ProjectionIdSchema,
  inboxV2RecipientScopeIdSchema,
  inboxV2SchemaVersionTokenSchema,
  inboxV2Sha256DigestSchema,
  inboxV2SyncGenerationSchema,
  type TenantId
} from "@hulee/contracts";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHuleeDatabase,
  createHuleeDatabase,
  type HuleeDatabase
} from "../client";
import {
  computeInboxV2LeafHashDigest,
  createSqlInboxV2AuthorizedCommandCoordinator,
  type WithPrivilegedAuthorizationMutationInput
} from "./sql-inbox-v2-authorization-repository";
import { createSqlInboxV2RepositoryOutbox } from "./sql-inbox-v2-repository-outbox";
import {
  createSqlInboxV2RepositoryProjection,
  createSqlInboxV2RepositoryRetainedPrefix
} from "./sql-inbox-v2-repository-projection";
import {
  createInboxV2SourceRegistryOnboardingFixture,
  sourceRegistryFixtureOccurredAt
} from "./sql-inbox-v2-source-registry-repository.test-support";
import { createSqlInboxV2SourceRegistryRepository } from "./sql-inbox-v2-source-registry-repository";
import type { TenantSecretCipher } from "./sql-tenant-secret-repository";

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const suffix = `src010-${process.pid}`;
const registryId = "core:source-registry-lifecycle-src010";
const successTenantId = `tenant:${suffix}-success` as TenantId;
const successEmployeeId = inboxV2EmployeeIdSchema.parse(
  `employee:${suffix}-success`
);
const rollbackTenantId = `tenant:${suffix}-rollback` as TenantId;
const coordinatorRollbackTenantId =
  `tenant:${suffix}-coordinator-rollback` as TenantId;
const coordinatorRollbackEmployeeId = inboxV2EmployeeIdSchema.parse(
  `employee:${suffix}-coordinator-rollback`
);
const concurrentTenantId = `tenant:${suffix}-concurrent` as TenantId;
const concurrentEmployeeId = inboxV2EmployeeIdSchema.parse(
  `employee:${suffix}-concurrent`
);
const successFixture = createInboxV2SourceRegistryOnboardingFixture({
  tenantId: successTenantId,
  suffix: `${suffix}-success`,
  registryId,
  employeeId: successEmployeeId
});
const retentionBoundaryFixture = createInboxV2SourceRegistryOnboardingFixture({
  tenantId: successTenantId,
  suffix: `${suffix}-retention-boundary`,
  registryId,
  employeeId: successEmployeeId
});
const rollbackFixture = createInboxV2SourceRegistryOnboardingFixture({
  tenantId: rollbackTenantId,
  suffix: `${suffix}-rollback`,
  registryId,
  includeArtifact: true
});
const coordinatorRollbackFixture = createInboxV2SourceRegistryOnboardingFixture(
  {
    tenantId: coordinatorRollbackTenantId,
    suffix: `${suffix}-coordinator-rollback`,
    registryId,
    employeeId: coordinatorRollbackEmployeeId
  }
);
const concurrentFixtureA = createInboxV2SourceRegistryOnboardingFixture({
  tenantId: concurrentTenantId,
  suffix: `${suffix}-concurrent`,
  registryId,
  employeeId: concurrentEmployeeId
});
const concurrentFixtureB = createInboxV2SourceRegistryOnboardingFixture({
  tenantId: concurrentTenantId,
  suffix: `${suffix}-concurrent`,
  registryId,
  employeeId: concurrentEmployeeId
});
const registryCompositionHash = String(
  successFixture.input.lifecycleBinding.payload.registry.compositionHash
);
const policyId = `policy:${suffix}`;
const contextId = `context:${suffix}`;
const activationId = `activation:${suffix}`;
const policyHash = governanceDigest("b");
const contextHash = governanceDigest("c");
const activationHash = governanceDigest("d");
const t0 = new Date(sourceRegistryFixtureOccurredAt);
const t1 = new Date(t0.getTime() + 1_000);
const t2 = new Date(t0.getTime() + 2_000);
const t3 = new Date(t0.getTime() + 3_000);
const retentionProjectionId = inboxV2ProjectionIdSchema.parse(
  "core:src011.source-onboarding-retention-baseline"
);
const retentionProjectionScopeId = inboxV2RecipientScopeIdSchema.parse(
  `employee-inbox:src011-${process.pid}`
);
const retentionProjectionGeneration = inboxV2SyncGenerationSchema.parse("1");
const retentionProjectionSchemaVersion = inboxV2SchemaVersionTokenSchema.parse(
  INBOX_V2_INITIAL_SCHEMA_VERSION
);
const retentionWorkerId = inboxV2OutboxWorkerIdSchema.parse(
  "core:src011.retention-worker"
);
const retentionLeaseToken = `src011-retention-${"a".repeat(48)}`;

describePostgres("SQL Inbox V2 source-registry PostgreSQL invariants", () => {
  let database: HuleeDatabase;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL is required for the SRC-010 repository integration test."
      );
    }
    database = createHuleeDatabase({
      connectionString: process.env.DATABASE_URL,
      poolConfig: { max: 2 }
    });
    await cleanupFixture(database).catch(() => {});
    await assertSourceOnboardingMigrationReady(database);
    await seedLifecycleAuthority(database, successTenantId, successEmployeeId);
    await seedLifecycleAuthority(database, rollbackTenantId);
    await seedLifecycleAuthority(
      database,
      coordinatorRollbackTenantId,
      coordinatorRollbackEmployeeId
    );
    await seedLifecycleAuthority(
      database,
      concurrentTenantId,
      concurrentEmployeeId
    );
  }, 30_000);

  afterAll(async () => {
    if (database) {
      await cleanupFixture(database).catch(() => {});
      await closeHuleeDatabase(database);
    }
  }, 30_000);

  it("commits employee onboarding through the coordinator and replays its immutable snapshot", async () => {
    const repository = createSqlInboxV2SourceRegistryRepository(
      database,
      testCipher()
    );
    const coordinator = createSqlInboxV2AuthorizedCommandCoordinator(database);
    const commandInput = sourceOnboardingCommandInput(successFixture, {
      employeeId: successEmployeeId,
      label: `${suffix}-success`
    });
    let callbackCount = 0;

    const applied = await coordinator.withAuthorizedCommandMutation(
      commandInput,
      async (context) => {
        callbackCount += 1;
        return {
          result: await repository.persistSourceConnectionOnboarding(
            context,
            successFixture.authorizedInput
          )
        };
      },
      async () => {
        throw new Error("first execution must not load a replay snapshot");
      }
    );
    expect(applied).toMatchObject({
      kind: "applied",
      result: {
        id: successFixture.connectionId,
        tenantId: successTenantId,
        status: "onboarding"
      },
      status: {
        resultReference:
          successFixture.authorizedInput.resultSnapshot.resultReference,
        streamCommitId:
          successFixture.authorizedInput.resultSnapshot.streamCommitId,
        streamPosition: "1"
      }
    });
    expect(callbackCount).toBe(1);

    await database.execute(sql`
      update source_connections
         set display_name = 'Renamed after onboarding',
             updated_at = ${t1}
       where tenant_id = ${successTenantId}
         and id = ${successFixture.connectionId}
    `);
    await expect(
      repository.findCommittedSourceConnection({
        tenantId: successTenantId,
        sourceConnectionId: successFixture.connectionId
      })
    ).resolves.toMatchObject({ displayName: "Renamed after onboarding" });

    const replay = await coordinator.withAuthorizedCommandMutation(
      commandInput,
      async () => {
        callbackCount += 1;
        throw new Error("equal-hash replay must not repeat source writes");
      },
      async (context, status) => {
        if (status.resultReference === null) {
          throw new Error("source replay lost its canonical result reference");
        }
        const result = await repository.loadSourceOnboardingResultSnapshot(
          context,
          { resultReference: status.resultReference }
        );
        if (result === null) {
          throw new Error("source replay snapshot is missing");
        }
        return result;
      }
    );
    expect(replay).toMatchObject({
      kind: "already_applied",
      result: {
        id: successFixture.connectionId,
        displayName: "Synthetic",
        status: "onboarding"
      },
      status: { streamPosition: "1" }
    });
    expect(callbackCount).toBe(1);

    await expect(
      repository.resolveSourceOnboardingInternalReference({
        tenantId: successTenantId,
        internalReference:
          successFixture.authorizedInput.resultSnapshot.auditTargetRef
      })
    ).resolves.toEqual({
      entityTypeId: "core:source-connection",
      entityId: successFixture.connectionId
    });
    await expect(
      repository.resolveSourceOnboardingInternalReference({
        tenantId: rollbackTenantId,
        internalReference:
          successFixture.authorizedInput.resultSnapshot.auditTargetRef
      })
    ).resolves.toBeNull();

    const immutableSnapshot = await database.execute<{
      display_name: string;
      result_digest_sha256: string;
      mutable_display_name: string;
      copy_slot: string;
      data_class_id: string;
      storage_root_id: string;
      purpose_id: string;
      effective_rule_id: string;
    }>(sql`
      select result.display_name, result.result_digest_sha256,
             source.display_name as mutable_display_name,
             result.copy_slot, result.data_class_id,
             result.storage_root_id, result.purpose_id,
             result.effective_rule_id
        from inbox_v2_source_onboarding_result_snapshots result
        join source_connections source
          on source.tenant_id = result.tenant_id
         and source.id = result.source_connection_id
       where result.tenant_id = ${successTenantId}
         and result.id =
           ${successFixture.authorizedInput.resultSnapshot.resultReference.recordId}
    `);
    expect(immutableSnapshot.rows).toEqual([
      {
        display_name: "Synthetic",
        result_digest_sha256:
          successFixture.authorizedInput.resultSnapshot.resultReference.digest,
        mutable_display_name: "Renamed after onboarding",
        copy_slot: "source_onboarding_result_snapshot",
        data_class_id: "core:source_account_connector_metadata",
        storage_root_id: "core:source-registry-sql",
        purpose_id: "core:source_replay_and_diagnostics",
        effective_rule_id: "rule:source-registry-replay"
      }
    ]);

    // Restore the mutable projection before probing snapshot coherence so the
    // adversarial update can fail only on its malformed canonical payload.
    await database.execute(sql`
      update source_connections
         set display_name = 'Synthetic',
             updated_at = ${t0}
       where tenant_id = ${successTenantId}
         and id = ${successFixture.connectionId}
    `);

    const snapshotBeforeAdversarial = await database.execute<{
      state_payload: unknown;
      state_canonical_json: string;
    }>(sql`
      select state_payload, state_canonical_json
        from inbox_v2_source_onboarding_result_snapshots
       where tenant_id = ${successTenantId}
         and id =
           ${successFixture.authorizedInput.resultSnapshot.resultReference.recordId}
    `);
    expect(snapshotBeforeAdversarial.rows).toHaveLength(1);

    await expectDatabaseFailure(
      () =>
        database.execute(
          sql`truncate table inbox_v2_source_onboarding_result_snapshots`
        ),
      "55000",
      "inbox_v2.source_onboarding_result_immutable"
    );
    await expect(
      sourceOnboardingSnapshotCount(database, successTenantId)
    ).resolves.toBe(1);

    let immutableUpdateTriggerDisabled = false;
    try {
      await database.execute(sql`
        alter table inbox_v2_source_onboarding_result_snapshots
          disable trigger inbox_v2_source_onboarding_result_immutable_trigger
      `);
      immutableUpdateTriggerDisabled = true;
      await expectDatabaseFailure(
        () =>
          database.transaction(async (transaction) => {
            await transaction.execute(sql`
              with malformed(value) as (
                values (
                  jsonb_build_object(
                    'schemaId',
                    'core:inbox-v2.source-connection-registry-state',
                    'schemaVersion', 'v1',
                    'payload', '{}'::jsonb
                  )
                )
              ), canonical as (
                select value,
                       public.inbox_v2_source_onboarding_canonical_json_text(
                         value
                       ) as canonical_json
                  from malformed
              )
              update inbox_v2_source_onboarding_result_snapshots result
                 set state_payload = canonical.value,
                     state_canonical_json = canonical.canonical_json,
                     state_digest_sha256 = 'sha256:' || encode(
                       sha256(convert_to(canonical.canonical_json, 'UTF8')),
                       'hex'
                     )
                from canonical
               where result.tenant_id = ${successTenantId}
                 and result.id =
                   ${successFixture.authorizedInput.resultSnapshot.resultReference.recordId}
            `);
            await transaction.execute(sql`set constraints all immediate`);
          }),
        "23514",
        "inbox_v2.source_onboarding_result_mismatch"
      );
    } finally {
      if (immutableUpdateTriggerDisabled) {
        await database.execute(sql`
          alter table inbox_v2_source_onboarding_result_snapshots
            enable trigger inbox_v2_source_onboarding_result_immutable_trigger
        `);
      }
    }

    const snapshotAfterAdversarial = await database.execute<{
      state_payload: unknown;
      state_canonical_json: string;
    }>(sql`
      select state_payload, state_canonical_json
        from inbox_v2_source_onboarding_result_snapshots
       where tenant_id = ${successTenantId}
         and id =
           ${successFixture.authorizedInput.resultSnapshot.resultReference.recordId}
    `);
    expect(snapshotAfterAdversarial.rows).toEqual(
      snapshotBeforeAdversarial.rows
    );

    await expect(
      repository.resolveIngressRoute({
        material: successFixture.routeMaterial
      })
    ).resolves.toBeNull();

    const before = await database.execute<{
      secret_current: boolean;
      route_current: boolean;
      encrypted_value: string;
    }>(sql`
      select secret_row.revoked_at is null as secret_current,
             route_row.invalidated_at is null as route_current,
             tenant_secret.encrypted_value
        from inbox_v2_source_registry_secret_refs secret_row
        join tenant_secrets tenant_secret
          on tenant_secret.tenant_id = secret_row.tenant_id
         and tenant_secret.secret_ref = secret_row.secret_ref
        join inbox_v2_source_registry_ingress_routes route_row
          on route_row.tenant_id = secret_row.tenant_id
         and route_row.parent_authority_id = secret_row.authority_id
       where secret_row.tenant_id = ${successTenantId}
         and secret_row.authority_id = ${successFixture.connectionId}
    `);
    expect(before.rows).toEqual([
      expect.objectContaining({
        secret_current: true,
        route_current: true
      })
    ]);
    expect(before.rows[0]!.encrypted_value).not.toContain(
      new TextDecoder().decode(successFixture.secretMaterial)
    );

    const disableTransitionId = `source-registry-transition:disable-${suffix}`;
    await database.transaction(async (transaction) => {
      await transaction.execute(sql`
        insert into inbox_v2_source_registry_transitions
        select (
          jsonb_populate_record(
            null::public.inbox_v2_source_registry_transitions,
            to_jsonb(previous_transition) || jsonb_build_object(
              'transition_id', ${disableTransitionId}::text,
              'intent', 'disable',
              'expected_revision', 1,
              'expected_route_generation', 1,
              'resulting_revision', 2,
              'from_state', 'pending',
              'to_state', 'disabled',
              'route_generation', 2,
              'route_authority_state', 'denied',
              'route_authority_reason_code_id', 'core:disabled',
              'route_authority_changed_at', ${t1}::timestamptz,
              'transition_digest_sha256', ${rawDigest("e")}::text,
              'occurred_at', ${t1}::timestamptz
            )
          )
        ).*
          from inbox_v2_source_registry_transitions previous_transition
         where previous_transition.tenant_id = ${successTenantId}
           and previous_transition.transition_id =
             ${successFixture.input.transition.payload.transitionId}
      `);
      await transaction.execute(sql`
        update inbox_v2_source_registry_heads
           set revision = 2,
               state = 'disabled',
               route_generation = 2,
               route_authority_state = 'denied',
               route_authority_reason_code_id = 'core:disabled',
               route_authority_changed_at = ${t1},
               last_transition_id = ${disableTransitionId},
               updated_at = ${t1}
         where tenant_id = ${successTenantId}
           and authority_id = ${successFixture.connectionId}
      `);
      await transaction.execute(sql`set constraints all immediate`);
    });

    const after = await database.execute<{
      revoked: boolean;
      revoked_by_transition_id: string;
      invalidated: boolean;
      invalidated_by_transition_id: string;
      invalidation_reason_code: string;
    }>(sql`
      select secret_row.revoked_at is not null as revoked,
             secret_row.revoked_by_transition_id,
             route_row.invalidated_at is not null as invalidated,
             route_row.invalidated_by_transition_id,
             route_row.invalidation_reason_code
        from inbox_v2_source_registry_secret_refs secret_row
        join inbox_v2_source_registry_ingress_routes route_row
          on route_row.tenant_id = secret_row.tenant_id
         and route_row.parent_authority_id = secret_row.authority_id
       where secret_row.tenant_id = ${successTenantId}
         and secret_row.authority_id = ${successFixture.connectionId}
    `);
    expect(after.rows).toEqual([
      {
        revoked: true,
        revoked_by_transition_id: disableTransitionId,
        invalidated: true,
        invalidated_by_transition_id: disableTransitionId,
        invalidation_reason_code: "authority_not_routable"
      }
    ]);

    const closureIdentity = {
      tenantId: successTenantId,
      resultId:
        successFixture.authorizedInput.resultSnapshot.resultReference.recordId,
      commandId: commandInput.command.id,
      mutationId: commandInput.records.mutationId,
      streamCommitId: commandInput.records.streamCommitId,
      changeId: commandInput.records.changes[0]!.id,
      eventId: commandInput.records.events[0]!.id,
      outboxIntentId: commandInput.records.outboxIntents[0]!.id,
      auditEventId: commandInput.records.audit.id
    };

    await expectDatabaseFailure(
      () =>
        database.transaction(async (transaction) => {
          await transaction.execute(sql`
            delete from inbox_v2_source_onboarding_result_snapshots
             where tenant_id = ${successTenantId}
               and id =
                 ${successFixture.authorizedInput.resultSnapshot.resultReference.recordId}
          `);
          await transaction.execute(sql`set constraints all immediate`);
        }),
      "23514",
      "inbox_v2.source_onboarding_result_delete_forbidden"
    );
    await expect(
      sourceOnboardingSnapshotCount(database, successTenantId)
    ).resolves.toBe(1);

    const outbox = createSqlInboxV2RepositoryOutbox(database, {
      tokenSource: (count) =>
        Array.from({ length: count }, () => retentionLeaseToken)
    });
    const claimed = await outbox.claimAvailable({
      context: { tenantId: successTenantId },
      workerId: retentionWorkerId,
      leaseDurationSeconds: 30,
      batchSize: 1
    });
    if (
      claimed.outcome !== "claimed" ||
      claimed.claims[0] === undefined ||
      claimed.claims[0].work.lease === null
    ) {
      throw new Error("SRC-011 retention fixture outbox was not claimable.");
    }
    const firstClaim = claimed.claims[0];
    const firstLease = firstClaim.work.lease;
    if (firstLease === null) {
      throw new Error("SRC-011 retention fixture lease disappeared.");
    }
    await expect(
      outbox.finalize({
        context: { tenantId: successTenantId },
        intentId: closureIdentity.outboxIntentId,
        workerId: retentionWorkerId,
        leaseToken: firstClaim.leaseToken,
        expectedLeaseRevision: firstLease.leaseRevision,
        instruction: {
          kind: "processed",
          resultHash: sourceDigest(`${suffix}:retention-terminal`),
          resultReference: null
        }
      })
    ).resolves.toMatchObject({ outcome: "processed" });

    const retentionCommandInput = sourceOnboardingCommandInput(
      retentionBoundaryFixture,
      {
        employeeId: successEmployeeId,
        label: `${suffix}-retention-boundary`
      }
    );
    await expect(
      coordinator.withAuthorizedCommandMutation(
        retentionCommandInput,
        async (context) => ({
          result: await repository.persistSourceConnectionOnboarding(
            context,
            retentionBoundaryFixture.authorizedInput
          )
        }),
        async () => {
          throw new Error("retention boundary command must execute once");
        }
      )
    ).resolves.toMatchObject({
      kind: "applied",
      status: { streamPosition: "2" }
    });

    const baselineInitializedAt = await sourceOnboardingDatabaseClock(database);
    const projection = createSqlInboxV2RepositoryProjection(database, {
      applyProjectionRows: async () => undefined
    });
    await expect(
      projection.initializeGeneration(
        inboxV2InitializeProjectionGenerationInputSchema.parse({
          context: { tenantId: successTenantId },
          projectionId: retentionProjectionId,
          scopeId: retentionProjectionScopeId,
          streamEpoch: commandInput.records.expectedStreamEpoch,
          syncGeneration: retentionProjectionGeneration,
          projectionSchemaVersion: retentionProjectionSchemaVersion,
          initialPosition: "2",
          minRetainedPosition: "0",
          initialState: "active",
          initializedAt: baselineInitializedAt
        })
      )
    ).resolves.toMatchObject({
      outcome: "initialized",
      snapshot: { checkpoint: { position: "2" } }
    });

    let mutationRetentionTriggerDisabled = false;
    let auditRetentionTriggerDisabled = false;
    let auditFacetRetentionTriggerDisabled = false;
    let commandRetentionTriggerDisabled = false;
    try {
      await database.execute(sql`
        alter table inbox_v2_auth_mutation_commits
          disable trigger inbox_v2_auth_immutable_ef02df9ab538c8e3
      `);
      mutationRetentionTriggerDisabled = true;
      await database.execute(sql`
        alter table inbox_v2_auth_audit_events
          disable trigger inbox_v2_auth_immutable_a724ad2579ac19a8
      `);
      auditRetentionTriggerDisabled = true;
      await database.execute(sql`
        alter table inbox_v2_auth_audit_facets
          disable trigger inbox_v2_auth_immutable_b7060d104e2cd2ac
      `);
      auditFacetRetentionTriggerDisabled = true;
      await database.execute(sql`
        alter table inbox_v2_auth_command_records
          disable trigger inbox_v2_auth_command_guard_trigger
      `);
      commandRetentionTriggerDisabled = true;

      await expectDatabaseFailure(
        () =>
          database.transaction(async (transaction) => {
            await transaction.execute(sql`
              delete from inbox_v2_auth_mutation_commits
               where tenant_id = ${closureIdentity.tenantId}
                 and mutation_id = ${closureIdentity.mutationId}
            `);
            await transaction.execute(sql`
              delete from inbox_v2_auth_audit_events
               where tenant_id = ${closureIdentity.tenantId}
                 and id = ${closureIdentity.auditEventId}
            `);
            await transaction.execute(sql`
              delete from inbox_v2_auth_command_records
               where tenant_id = ${closureIdentity.tenantId}
                 and id = ${closureIdentity.commandId}
            `);
            await transaction.execute(sql`set constraints all immediate`);
          }),
        "23514",
        "inbox_v2.source_onboarding_result_delete_forbidden"
      );
      await expect(
        sourceOnboardingClosureCounts(database, closureIdentity)
      ).resolves.toEqual(sourceOnboardingLiveClosureCounts(1));

      const retainedPrefix = createSqlInboxV2RepositoryRetainedPrefix(
        database,
        {
          tenantStreamRetentionReasonId:
            "core:src011.source-onboarding-result-expiry"
        }
      );
      await expect(
        retainedPrefix.compareAndSetRetainedPrefix(
          inboxV2CompareAndSetRetainedPrefixInputSchema.parse({
            context: { tenantId: successTenantId },
            owner: {
              kind: "tenant_stream",
              streamEpoch: commandInput.records.expectedStreamEpoch
            },
            expectedRevision: "3",
            expectedMinRetainedPosition: "0",
            nextMinRetainedPosition: "2",
            mandatoryCheckpointFloor: "2",
            changedAt: baselineInitializedAt
          })
        )
      ).resolves.toMatchObject({
        outcome: "advanced",
        current: {
          headPosition: "2",
          minRetainedPosition: "2",
          revision: "4"
        }
      });
      await expect(
        sourceOnboardingRetainedStreamState(database, {
          tenantId: successTenantId,
          streamEpoch: commandInput.records.expectedStreamEpoch,
          prunedCommitId: closureIdentity.streamCommitId,
          retainedCommitId: retentionCommandInput.records.streamCommitId
        })
      ).resolves.toEqual({
        last_position: "2",
        min_retained_position: "2",
        head_revision: "4",
        advance_from_position: "0",
        advance_to_position: "2",
        advance_pruned_commit_count: "1",
        baseline_position: "2",
        baseline_last_commit_id: null,
        baseline_min_retained_position: "0",
        baseline_state: "active",
        pruned_skeleton_position: "1",
        pruned_skeleton_change_count: "1",
        pruned_skeleton_event_count: "1",
        pruned_skeleton_intent_count: "1",
        pruned_payload_change_count: 0,
        pruned_payload_event_count: 0,
        pruned_payload_intent_count: 0,
        retained_payload_change_count: 1,
        retained_payload_event_count: 1,
        retained_payload_intent_count: 1,
        retained_tail_has_no_gap: true
      });
      await expect(
        sourceOnboardingClosureCounts(database, closureIdentity)
      ).resolves.toEqual(sourceOnboardingPrefixPrunedClosureCounts());

      const retainedResultReference =
        retentionBoundaryFixture.authorizedInput.resultSnapshot.resultReference;
      let crossReferenceInjected = false;
      try {
        await database.execute(sql`
          update inbox_v2_auth_command_records
             set result_reference =
               ${JSON.stringify(successFixture.authorizedInput.resultSnapshot.resultReference)}::jsonb
           where tenant_id = ${successTenantId}
             and id = ${retentionCommandInput.command.id}
        `);
        crossReferenceInjected = true;
        await expect(
          sourceOnboardingClosureCounts(database, closureIdentity)
        ).resolves.toEqual({
          ...sourceOnboardingPrefixPrunedClosureCounts(),
          commands: 2
        });
        await expectDatabaseFailure(
          () => deleteSourceOnboardingCommandClosure(database, closureIdentity),
          "23514",
          "inbox_v2.source_onboarding_result_delete_forbidden"
        );
      } finally {
        if (crossReferenceInjected) {
          await database.execute(sql`
            update inbox_v2_auth_command_records
               set result_reference =
                 ${JSON.stringify(retainedResultReference)}::jsonb
             where tenant_id = ${successTenantId}
               and id = ${retentionCommandInput.command.id}
          `);
        }
      }

      await deleteSourceOnboardingCommandClosure(database, closureIdentity);
    } finally {
      if (commandRetentionTriggerDisabled) {
        await database.execute(sql`
          alter table inbox_v2_auth_command_records
            enable trigger inbox_v2_auth_command_guard_trigger
        `);
      }
      if (auditFacetRetentionTriggerDisabled) {
        await database.execute(sql`
          alter table inbox_v2_auth_audit_facets
            enable trigger inbox_v2_auth_immutable_b7060d104e2cd2ac
        `);
      }
      if (auditRetentionTriggerDisabled) {
        await database.execute(sql`
          alter table inbox_v2_auth_audit_events
            enable trigger inbox_v2_auth_immutable_a724ad2579ac19a8
        `);
      }
      if (mutationRetentionTriggerDisabled) {
        await database.execute(sql`
          alter table inbox_v2_auth_mutation_commits
            enable trigger inbox_v2_auth_immutable_ef02df9ab538c8e3
        `);
      }
    }
    await expect(
      sourceOnboardingClosureCounts(database, closureIdentity)
    ).resolves.toEqual(sourceOnboardingExpiredClosureCounts());
  }, 30_000);

  it("serializes concurrent equal-hash onboarding into one durable source and an immutable replay", async () => {
    expect(concurrentFixtureA.secretMaterial).not.toBe(
      concurrentFixtureB.secretMaterial
    );
    expect(concurrentFixtureA.routeMaterial).not.toBe(
      concurrentFixtureB.routeMaterial
    );
    expect(concurrentFixtureA.secretMaterial).toEqual(
      concurrentFixtureB.secretMaterial
    );
    expect(concurrentFixtureA.routeMaterial).toEqual(
      concurrentFixtureB.routeMaterial
    );

    const repository = createSqlInboxV2SourceRegistryRepository(
      database,
      testCipher()
    );
    const coordinator = createSqlInboxV2AuthorizedCommandCoordinator(database);
    const commandInputA = sourceOnboardingCommandInput(concurrentFixtureA, {
      employeeId: concurrentEmployeeId,
      label: `${suffix}-concurrent`
    });
    const commandInputB = sourceOnboardingCommandInput(concurrentFixtureB, {
      employeeId: concurrentEmployeeId,
      label: `${suffix}-concurrent`
    });
    let persistenceCallbackCount = 0;
    let replaySnapshotLoadCount = 0;

    const onboard = (
      fixture: ReturnType<typeof createInboxV2SourceRegistryOnboardingFixture>,
      commandInput: WithPrivilegedAuthorizationMutationInput
    ) =>
      coordinator.withAuthorizedCommandMutation(
        commandInput,
        async (context) => {
          persistenceCallbackCount += 1;
          return {
            result: await repository.persistSourceConnectionOnboarding(
              context,
              fixture.authorizedInput
            )
          };
        },
        async (context, status) => {
          replaySnapshotLoadCount += 1;
          if (status.resultReference === null) {
            throw new Error(
              "concurrent source replay lost its canonical result reference"
            );
          }
          const result = await repository.loadSourceOnboardingResultSnapshot(
            context,
            { resultReference: status.resultReference }
          );
          if (result === null) {
            throw new Error("concurrent source replay snapshot is missing");
          }
          return result;
        }
      );

    const results = await Promise.all([
      onboard(concurrentFixtureA, commandInputA),
      onboard(concurrentFixtureB, commandInputB)
    ]);
    expect(results.map(({ kind }) => kind).sort()).toEqual([
      "already_applied",
      "applied"
    ]);
    expect(persistenceCallbackCount).toBe(1);
    expect(replaySnapshotLoadCount).toBe(1);

    const applied = results.find(({ kind }) => kind === "applied");
    const replay = results.find(({ kind }) => kind === "already_applied");
    expect(applied).toMatchObject({
      kind: "applied",
      result: {
        id: concurrentFixtureA.connectionId,
        displayName: "Synthetic",
        status: "onboarding"
      },
      status: { streamPosition: "1" }
    });
    expect(replay).toMatchObject({
      kind: "already_applied",
      result: {
        id: concurrentFixtureA.connectionId,
        displayName: "Synthetic",
        status: "onboarding"
      },
      status: { streamPosition: "1" }
    });

    const durableRows = await database.execute<{
      sources: number;
      snapshots: number;
      commands: number;
    }>(sql`
      select
        (select count(*)::int from source_connections
          where tenant_id = ${concurrentTenantId}) as sources,
        (select count(*)::int
           from inbox_v2_source_onboarding_result_snapshots
          where tenant_id = ${concurrentTenantId}) as snapshots,
        (select count(*)::int from inbox_v2_auth_command_records
          where tenant_id = ${concurrentTenantId}) as commands
    `);
    expect(durableRows.rows[0]).toEqual({
      sources: 1,
      snapshots: 1,
      commands: 1
    });
  }, 30_000);

  it("rolls the source snapshot and every coordinator artifact back with its callback", async () => {
    const repository = createSqlInboxV2SourceRegistryRepository(
      database,
      testCipher()
    );
    const coordinator = createSqlInboxV2AuthorizedCommandCoordinator(database);
    const commandInput = sourceOnboardingCommandInput(
      coordinatorRollbackFixture,
      {
        employeeId: coordinatorRollbackEmployeeId,
        label: `${suffix}-coordinator-rollback`
      }
    );

    await expect(
      coordinator.withAuthorizedCommandMutation(
        commandInput,
        async (context) => {
          await repository.persistSourceConnectionOnboarding(
            context,
            coordinatorRollbackFixture.authorizedInput
          );
          throw new Error("injected coordinator callback rollback");
        }
      )
    ).rejects.toThrow("injected coordinator callback rollback");

    const residue = await database.execute<{
      connections: number;
      tenant_secrets: number;
      transitions: number;
      result_snapshots: number;
      commands: number;
      stream_commits: number;
    }>(sql`
      select
        (select count(*)::int from source_connections
          where tenant_id = ${coordinatorRollbackTenantId}) as connections,
        (select count(*)::int from tenant_secrets
          where tenant_id = ${coordinatorRollbackTenantId}) as tenant_secrets,
        (select count(*)::int from inbox_v2_source_registry_transitions
          where tenant_id = ${coordinatorRollbackTenantId}) as transitions,
        (select count(*)::int
           from inbox_v2_source_onboarding_result_snapshots
          where tenant_id = ${coordinatorRollbackTenantId}) as result_snapshots,
        (select count(*)::int from inbox_v2_auth_command_records
          where tenant_id = ${coordinatorRollbackTenantId}) as commands,
        (select count(*)::int from inbox_v2_tenant_stream_commits
          where tenant_id = ${coordinatorRollbackTenantId}) as stream_commits
    `);
    expect(residue.rows[0]).toEqual({
      connections: 0,
      tenant_secrets: 0,
      transitions: 0,
      result_snapshots: 0,
      commands: 0,
      stream_commits: 0
    });
  }, 30_000);

  it("rolls tenant secret and compatibility rows back when the payload writer fails", async () => {
    const repository = createSqlInboxV2SourceRegistryRepository(
      database,
      testCipher(),
      {
        classifiedPayloadWriter: {
          buildWriteSql() {
            return sql`
              select 1 / 0 as source_registry_classified_payload_write
            `;
          }
        }
      }
    );

    await expect(
      repository.commitSourceConnectionOnboarding(rollbackFixture.input)
    ).rejects.toThrow(/source_registry_classified_payload_write/iu);

    const residue = await database.execute<{
      connections: number;
      tenant_secrets: number;
      transitions: number;
      artifact_refs: number;
    }>(sql`
      select
        (select count(*)::int from source_connections
          where tenant_id = ${rollbackTenantId}) as connections,
        (select count(*)::int from tenant_secrets
          where tenant_id = ${rollbackTenantId}) as tenant_secrets,
        (select count(*)::int from inbox_v2_source_registry_transitions
          where tenant_id = ${rollbackTenantId}) as transitions,
        (select count(*)::int from inbox_v2_source_registry_artifact_refs
          where tenant_id = ${rollbackTenantId}) as artifact_refs
    `);
    expect(residue.rows[0]).toEqual({
      connections: 0,
      tenant_secrets: 0,
      transitions: 0,
      artifact_refs: 0
    });
  }, 30_000);
});

function sourceOnboardingCommandInput(
  fixture: ReturnType<typeof createInboxV2SourceRegistryOnboardingFixture>,
  input: { employeeId: string; label: string }
): WithPrivilegedAuthorizationMutationInput {
  const occurredAt = sourceRegistryFixtureOccurredAt;
  const notAfter = new Date(
    Date.parse(occurredAt) + 60 * 60 * 1_000
  ).toISOString();
  const transition = fixture.input.transition;
  const state = transition.payload.resultingState;
  const actor = transition.payload.actor;
  if (actor.kind !== "employee" || actor.employee.id !== input.employeeId) {
    throw new Error("Authorized source fixture lost its employee actor.");
  }
  const tenantId = fixture.input.compatibilityConnection.tenantId;
  const sourceConnectionId = fixture.connectionId;
  const commandId = sourceInternalId("command", tenantId, input.label);
  const mutationId = sourceInternalId(
    "source-onboarding-mutation",
    tenantId,
    input.label
  );
  const correlationId = sourceInternalId(
    "source-onboarding-correlation",
    tenantId,
    input.label
  );
  const changeId = sourceInternalId(
    "source-onboarding-change",
    tenantId,
    input.label
  );
  const eventId = sourceInternalId("event", tenantId, input.label);
  const outboxIntentId = sourceInternalId(
    "source-onboarding-outbox",
    tenantId,
    input.label
  );
  const clientMutationId = sourceInternalId(
    "client-mutation",
    tenantId,
    input.label
  );
  const requestHash = sourceDigest(`${tenantId}:${input.label}:request`);
  const decision = {
    tenantId,
    id: sourceInternalId("authorization-decision", tenantId, input.label),
    authorizationEpoch: actor.authorizationEpoch,
    principal: {
      kind: "employee" as const,
      employee: {
        tenantId,
        kind: "employee" as const,
        id: input.employeeId
      }
    },
    permissionId: "core:tenant.manage",
    resourceScopeId: "core:permission-scope.tenant",
    resource: {
      tenantId,
      entityTypeId: "core:source-connection",
      entityId: sourceConnectionId
    },
    resourceAccessRevision: "1",
    decisionRevision: "1",
    decisionHash: sourceDigest(`${tenantId}:${input.label}:decision`),
    outcome: "allowed" as const,
    decidedAt: occurredAt,
    notAfter
  };
  const stateHash = calculateInboxV2CanonicalSha256(state);
  const transitionHash = calculateInboxV2CanonicalSha256(transition);
  const stateReference = {
    tenantId,
    recordId: fixture.authorizedInput.resultSnapshot.resultReference.recordId,
    schemaId: state.schemaId,
    schemaVersion: state.schemaVersion,
    digest: stateHash
  };
  const transitionReference = {
    tenantId,
    recordId: fixture.authorizedInput.resultSnapshot.resultReference.recordId,
    schemaId: transition.schemaId,
    schemaVersion: transition.schemaVersion,
    digest: transitionHash
  };
  const sourceEntity = {
    tenantId,
    entityTypeId: "core:source-connection",
    entityId: sourceConnectionId
  };
  const eventHash = sourceDigest(`${tenantId}:${input.label}:event`);
  const intentHash = sourceDigest(`${tenantId}:${input.label}:intent`);
  const streamEpoch = sourceInternalId("stream-epoch", tenantId, "primary");
  const auditTargetRef = fixture.authorizedInput.resultSnapshot.auditTargetRef;
  const tenantFacetRef = fixture.authorizedInput.resultSnapshot.tenantFacetRef;

  return {
    tenantId,
    command: {
      id: commandId,
      requestId: sourceInternalId("request", tenantId, input.label),
      clientMutationId,
      commandTypeId: "core:source-connection.create",
      requestHash,
      actor: { kind: "employee", employeeId: input.employeeId },
      authorizationDecisionId: decision.id,
      authorizationEpoch: decision.authorizationEpoch,
      authorizedAt: occurredAt,
      publicResultCode: "core:source-connection.created",
      resultReference: fixture.authorizedInput.resultSnapshot.resultReference,
      sensitiveResultReference: null
    },
    revisions: {
      expectedTenantRbacRevision: "1",
      expectedSharedAccessRevision: "1",
      advanceTenantRbac: false,
      advanceSharedAccess: false,
      employees: [
        {
          employeeId: input.employeeId,
          expectedEmployeeAccessRevision: "1",
          expectedEmployeeInboxRelationRevision: "1",
          advanceEmployeeAccess: false,
          advanceEmployeeInboxRelation: false
        }
      ],
      resources: []
    },
    records: {
      mutationId,
      relationKind: null,
      streamCommitId: fixture.authorizedInput.resultSnapshot.streamCommitId,
      expectedStreamEpoch: streamEpoch,
      audienceImpact: { kind: "none" },
      commitHash: inboxV2Sha256DigestSchema.parse(
        computeInboxV2LeafHashDigest([stateHash, eventHash, intentHash])
      ),
      correlationId,
      changes: [
        {
          id: changeId,
          ordinal: 1,
          entity: sourceEntity,
          resultingRevision: "1",
          timeline: null,
          audience: "staff_only",
          state: {
            kind: "upsert",
            stateSchemaId: state.schemaId,
            stateSchemaVersion: state.schemaVersion,
            stateHash,
            payloadReference: stateReference,
            domainCommitReference: transitionReference
          }
        }
      ],
      events: [
        {
          id: eventId,
          typeId: "core:source-connection.changed",
          payloadSchemaId: "core:inbox-v2.source-connection-change",
          payloadSchemaVersion: "v1",
          ordinal: "1",
          changeIds: [changeId],
          subjects: [sourceEntity],
          payloadReference: null,
          correlationId,
          commandIds: [commandId],
          clientMutationIds: [clientMutationId],
          authorizationDecisionRefs: [decision],
          accessEffect: { kind: "none" },
          occurredAt,
          recordedAt: occurredAt,
          eventHash
        }
      ],
      outboxIntents: [
        {
          id: outboxIntentId,
          ordinal: 1,
          typeId: "core:projection.update",
          handlerId: "core:source-connection-projection",
          effectClass: "projection",
          eventId,
          changeIds: [changeId],
          payloadReference: null,
          consumerDedupeKey: sourceDigest(
            `${tenantId}:${input.label}:projection-dedupe`
          ),
          correlationId,
          availableAt: occurredAt,
          intentHash
        }
      ],
      audit: {
        id: sourceInternalId("source-onboarding-audit", tenantId, input.label),
        actionId: "core:source-connection.create",
        target: {
          tenantId,
          entityTypeId: "core:source-connection",
          entityId: auditTargetRef
        },
        reasonCodeId: "core:source-connection-created",
        matchedPermissionIds: ["core:tenant.manage"],
        grantSourceIds:
          fixture.authorizedInput.resultSnapshot.grantSourceMappings.map(
            (mapping) => mapping.internalReference
          ),
        authorizationScopeIds: ["core:permission-scope.tenant"],
        overrideReasonCodeId: null,
        policyVersion: "v1",
        evidenceReference: transitionReference,
        authorizationDecisionRefs: [decision],
        correlationId,
        outcome: "succeeded",
        revisionDeltaHash: inboxV2Sha256DigestSchema.parse(
          computeInboxV2LeafHashDigest([])
        ),
        previousAuditHash: null,
        auditHash: sourceDigest(`${tenantId}:${input.label}:audit`),
        occurredAt,
        recordedAt: occurredAt,
        expiresAt: notAfter,
        facets: [
          {
            ordinal: 1,
            dimension: "tenant",
            reference: {
              tenantId,
              entityTypeId: "core:tenant",
              entityId: tenantFacetRef
            },
            relation: "affected",
            facetHash: sourceDigest(`${tenantId}:${input.label}:tenant-facet`)
          }
        ]
      }
    },
    occurredAt
  } as unknown as WithPrivilegedAuthorizationMutationInput;
}

function sourceInternalId(
  prefix: string,
  tenantId: TenantId,
  label: string
): string {
  return `${prefix}:${createHash("sha256")
    .update(`${tenantId}\u001f${label}`, "utf8")
    .digest("hex")}`;
}

function sourceDigest(
  value: string
): ReturnType<typeof inboxV2Sha256DigestSchema.parse> {
  return inboxV2Sha256DigestSchema.parse(
    `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`
  );
}

async function assertSourceOnboardingMigrationReady(
  database: HuleeDatabase
): Promise<void> {
  const readiness = await database.execute<{
    commands: string | null;
    snapshots: string | null;
    stream_commits: string | null;
  }>(sql`
    select
      to_regclass('public.inbox_v2_auth_command_records')::text as commands,
      to_regclass(
        'public.inbox_v2_source_onboarding_result_snapshots'
      )::text as snapshots,
      to_regclass('public.inbox_v2_tenant_stream_commits')::text
        as stream_commits
  `);
  const row = readiness.rows[0];
  if (row === undefined || Object.values(row).some((value) => value === null)) {
    throw new Error(
      "Inbox V2 authorized-domain migration 0040 is not applied."
    );
  }
}

async function seedLifecycleAuthority(
  database: HuleeDatabase,
  tenantId: TenantId,
  employeeId?: string
): Promise<void> {
  const tenantSuffix = tenantId.replaceAll(/[^a-z0-9]+/gu, "-").slice(-50);
  await database.transaction(async (transaction) => {
    await transaction.execute(sql`
      insert into tenants (id, slug, display_name, deployment_type)
      values (${tenantId}, ${tenantSuffix}, 'SRC-010 integration', 'saas_shared')
    `);
    if (employeeId !== undefined) {
      await transaction.execute(sql`
        insert into employees (
          id, tenant_id, email, display_name, profile, created_at, updated_at
        ) values (
          ${employeeId}, ${tenantId},
          ${`${tenantSuffix}@example.test`}, 'SRC-011 operator', '{}'::jsonb,
          ${t0}, ${t0}
        )
      `);
    }
    await transaction.execute(sql`
      insert into inbox_v2_data_governance_registry_versions (
        id, revision, schema_version, composition_hash, canonical_snapshot,
        activated_at, created_at
      ) values (
        ${registryId}, 7, 'v1', ${registryCompositionHash}, '{}'::jsonb,
        ${t1}, ${t0}
      ) on conflict (id, revision) do nothing
    `);
    await transaction.execute(sql`
      insert into inbox_v2_data_governance_storage_roots (
        registry_id, registry_revision, storage_root_id, kind, boundary,
        version_enumeration, configuration_profile_id, canonical_snapshot
      ) values (
        ${registryId}, 7, 'core:source-registry-sql', 'sql',
        'operated_data_plane', 'not_applicable', 'core:storage-profile.sql',
        '{}'::jsonb
      ) on conflict (registry_id, registry_revision, storage_root_id) do nothing
    `);
    await transaction.execute(sql`
      insert into inbox_v2_data_governance_lifecycle_handlers (
        registry_id, registry_revision, handler_id, kind, handler_version,
        bounded, idempotent, checks_tenant_fence, checks_revision_fence,
        checks_hold_fence, verifies_absence, canonical_snapshot
      ) values
        (${registryId}, 7, 'core:source-registry-lifecycle', 'lifecycle', 1,
          true, true, true, true, true, false, '{}'::jsonb),
        (${registryId}, 7, 'core:source-registry-subject-discovery',
          'subject_discovery', 1, true, true, true, true, true, false,
          '{}'::jsonb),
        (${registryId}, 7, 'core:source-registry-export-projection',
          'export_projection', 1, true, true, true, true, true, false,
          '{}'::jsonb),
        (${registryId}, 7, 'core:source-registry-export', 'export_execution', 1,
          true, true, true, true, true, false, '{}'::jsonb),
        (${registryId}, 7, 'core:source-registry-delete', 'delete_execution', 1,
          true, true, true, true, true, false, '{}'::jsonb),
        (${registryId}, 7, 'core:source-registry-verify', 'verification', 1,
          true, true, true, true, true, true, '{}'::jsonb)
      on conflict (registry_id, registry_revision, handler_id) do nothing
    `);
    await transaction.execute(sql`
      insert into inbox_v2_data_governance_data_use_lineages (
        registry_id, registry_revision, data_class_id, storage_root_id,
        purpose_id, canonical_anchor_id, lineage_revision,
        lifecycle_handler_id, subject_discovery_handler_id,
        export_projection_handler_id, export_handler_id, delete_handler_id,
        verification_handler_id, operations_mask, canonical_snapshot
      ) values
        (${registryId}, 7, 'core:source_account_connector_metadata',
          'core:source-registry-sql', 'core:communication_delivery',
          'core:disconnect_or_account_termination', 11,
          'core:source-registry-lifecycle',
          'core:source-registry-subject-discovery',
          'core:source-registry-export-projection',
          'core:source-registry-export', 'core:source-registry-delete',
          'core:source-registry-verify', 31, '{}'::jsonb),
        (${registryId}, 7, 'core:source_account_connector_metadata',
          'core:source-registry-sql', 'core:source_replay_and_diagnostics',
          'core:disconnect_or_account_termination', 11,
          'core:source-registry-lifecycle',
          'core:source-registry-subject-discovery',
          'core:source-registry-export-projection',
          'core:source-registry-export', 'core:source-registry-delete',
          'core:source-registry-verify', 31, '{}'::jsonb),
        (${registryId}, 7,
          'core:auth_credential_session_challenge_secret',
          'core:source-registry-sql', 'core:security_and_fraud_prevention',
          'core:revoke_expiry_or_completion', 11,
          'core:source-registry-lifecycle', null, null, null,
          'core:source-registry-delete', 'core:source-registry-verify', 25,
          '{}'::jsonb)
      on conflict (
        registry_id, registry_revision, data_class_id, storage_root_id,
        purpose_id
      ) do nothing
    `);
    await transaction.execute(sql`
      insert into inbox_v2_data_governance_contexts (
        tenant_id, context_id, version, context_hash, policy_revision,
        registry_id, registry_revision, deployment_profile, time_zone,
        tzdb_version, approved_at, effective_at, review_at, canonical_snapshot
      ) values (
        ${tenantId}, ${contextId}, 1, ${contextHash}, 1, ${registryId}, 7,
        'saas_shared', 'UTC', '2026a', ${t0}, ${t1}, ${t3}, '{}'::jsonb
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_data_governance_effective_policies (
        tenant_id, policy_id, version, policy_hash, registry_id,
        registry_revision, governance_context_id, governance_context_version,
        deployment_profile, effective_at, canonical_snapshot, created_at
      ) values (
        ${tenantId}, ${policyId}, 1, ${policyHash}, ${registryId}, 7,
        ${contextId}, 1, 'saas_shared', ${t2}, '{}'::jsonb, ${t1}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_data_governance_effective_policy_rules (
        tenant_id, policy_id, policy_version, rule_id, rule_revision,
        data_class_id, purpose_id, retention_anchor_id, action_at_expiry,
        hold_eligible, canonical_snapshot
      ) values
        (${tenantId}, ${policyId}, 1, 'rule:source-registry-metadata', 1,
          'core:source_account_connector_metadata',
          'core:communication_delivery',
          'core:disconnect_or_account_termination', 'delete', true,
          '{}'::jsonb),
        (${tenantId}, ${policyId}, 1, 'rule:source-registry-replay', 1,
          'core:source_account_connector_metadata',
          'core:source_replay_and_diagnostics',
          'core:disconnect_or_account_termination', 'delete', true,
          '{}'::jsonb),
        (${tenantId}, ${policyId}, 1, 'rule:source-registry-secret', 1,
          'core:auth_credential_session_challenge_secret',
          'core:security_and_fraud_prevention',
          'core:revoke_expiry_or_completion', 'delete', false, '{}'::jsonb)
    `);
    await transaction.execute(sql`
      insert into inbox_v2_data_governance_policy_activations (
        tenant_id, activation_id, revision, activation_hash, policy_id,
        policy_version, candidate_policy_hash, governance_context_id,
        governance_context_version, governance_context_hash, transition_kind,
        requester_principal_kind, requester_principal_key,
        requester_decision_id, requester_decision_hash,
        approver_principal_kind, approver_principal_key,
        approver_decision_id, approver_decision_hash, reason_code,
        impact_preview_hash, impact_stream_epoch, impact_sync_generation,
        impact_complete_through_position, affected_root_count,
        affected_byte_count, held_root_count, backup_copy_count,
        requested_at, approved_at, not_before, activated_at,
        canonical_snapshot
      ) values (
        ${tenantId}, ${activationId}, 1, ${activationHash}, ${policyId}, 1,
        ${policyHash}, ${contextId}, 1, ${contextHash},
        'initial_reviewed_bootstrap', 'service', 'service:requester',
        'decision:requester', ${governanceDigest("1")}, 'service',
        'service:approver', 'decision:approver', ${governanceDigest("2")},
        'reviewed_bootstrap', ${governanceDigest("3")}, 'epoch:src010',
        1, 0, 0, 0, 0, 0,
        ${t0}, ${t1}, ${t2}, ${t3}, '{}'::jsonb
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_data_governance_policy_activation_heads (
        tenant_id, policy_id, current_policy_version,
        current_activation_id, current_activation_revision, head_revision,
        updated_at
      ) values (${tenantId}, ${policyId}, 1, ${activationId}, 1, 1, ${t3})
    `);
    await transaction.execute(sql`
      insert into inbox_v2_data_governance_control_set_heads (
        tenant_id, legal_hold_set_revision, restriction_set_revision,
        last_changed_stream_position, head_revision, updated_at
      ) values (${tenantId}, 0, 0, 0, 1, ${t3})
    `);
    await transaction.execute(sql`set constraints all immediate`);
  });
}

async function cleanupFixture(database: HuleeDatabase): Promise<void> {
  const tables = await database.execute<{ table_name: string }>(sql`
    select distinct columns.table_name
      from information_schema.columns columns
      join information_schema.tables tables
        on tables.table_schema = columns.table_schema
       and tables.table_name = columns.table_name
       and tables.table_type = 'BASE TABLE'
     where columns.table_schema = 'public'
       and columns.column_name = 'tenant_id'
     order by columns.table_name
  `);
  const tenantIds = [
    successTenantId,
    rollbackTenantId,
    coordinatorRollbackTenantId,
    concurrentTenantId
  ];
  await database.transaction(async (transaction) => {
    await transaction.execute(
      sql`set local session_replication_role = 'replica'`
    );
    for (const { table_name: tableName } of tables.rows) {
      if (!/^[a-z][a-z0-9_]*$/u.test(tableName)) {
        throw new Error(`Unsafe integration cleanup table: ${tableName}`);
      }
      for (const tenantId of tenantIds) {
        const literal = tenantId.replaceAll("'", "''");
        await transaction.execute(
          sql.raw(
            `delete from public.${tableName} where tenant_id = '${literal}'`
          )
        );
      }
    }
    for (const tenantId of tenantIds) {
      await transaction.execute(
        sql`delete from tenants where id = ${tenantId}`
      );
    }
  });

  await database.execute(sql`
    delete from inbox_v2_data_governance_data_use_lineages
     where registry_id in (
       select id from inbox_v2_data_governance_registry_versions
        where composition_hash = ${registryCompositionHash}
     );
    delete from inbox_v2_data_governance_lifecycle_handlers
     where registry_id in (
       select id from inbox_v2_data_governance_registry_versions
        where composition_hash = ${registryCompositionHash}
     );
    delete from inbox_v2_data_governance_storage_roots
     where registry_id in (
       select id from inbox_v2_data_governance_registry_versions
        where composition_hash = ${registryCompositionHash}
     );
    delete from inbox_v2_data_governance_registry_versions
     where composition_hash = ${registryCompositionHash};
  `);
}

async function sourceOnboardingSnapshotCount(
  database: HuleeDatabase,
  tenantId: TenantId
): Promise<number> {
  const result = await database.execute<{ count: number }>(sql`
    select count(*)::int as count
      from inbox_v2_source_onboarding_result_snapshots
     where tenant_id = ${tenantId}
  `);
  return result.rows[0]?.count ?? 0;
}

type SourceOnboardingClosureIdentity = Readonly<{
  tenantId: TenantId;
  resultId: string;
  commandId: string;
  mutationId: string;
  streamCommitId: string;
  changeId: string;
  eventId: string;
  outboxIntentId: string;
  auditEventId: string;
}>;

type SourceOnboardingLiveClosureCounts = Readonly<{
  result_snapshots: number;
  commands: number;
  mutation_commits: number;
  stream_commits: number;
  stream_changes: number;
  domain_events: number;
  outbox_intents: number;
  outbox_work_items: number;
  outbox_outcomes: number;
  audit_events: number;
  audit_facets: number;
}>;

async function sourceOnboardingClosureCounts(
  database: HuleeDatabase,
  input: SourceOnboardingClosureIdentity
): Promise<SourceOnboardingLiveClosureCounts> {
  const result = await database.execute<SourceOnboardingLiveClosureCounts>(sql`
    select
      (select count(*)::int
         from inbox_v2_source_onboarding_result_snapshots result_row
        where result_row.tenant_id = ${input.tenantId}
          and result_row.id = ${input.resultId}) as result_snapshots,
      (select count(*)::int
         from inbox_v2_auth_command_records command_row
        where command_row.tenant_id = ${input.tenantId}
          and (command_row.id = ${input.commandId}
            or command_row.result_reference->>'recordId' = ${input.resultId}))
        as commands,
      (select count(*)::int
         from inbox_v2_auth_mutation_commits mutation_row
        where mutation_row.tenant_id = ${input.tenantId}
          and mutation_row.mutation_id = ${input.mutationId})
        as mutation_commits,
      (select count(*)::int
         from inbox_v2_tenant_stream_commits stream_row
        where stream_row.tenant_id = ${input.tenantId}
          and (stream_row.id = ${input.streamCommitId}
            or stream_row.mutation_id = ${input.mutationId}
            or stream_row.command_ids @>
              jsonb_build_array(${input.commandId}::text)))
        as stream_commits,
      (select count(*)::int
         from inbox_v2_tenant_stream_changes change_row
        where change_row.tenant_id = ${input.tenantId}
          and (change_row.id = ${input.changeId}
            or change_row.stream_commit_id = ${input.streamCommitId}
            or change_row.mutation_id = ${input.mutationId}
            or change_row.payload_reference->>'recordId' = ${input.resultId}
            or change_row.domain_commit_reference->>'recordId' =
              ${input.resultId})) as stream_changes,
      (select count(*)::int
         from inbox_v2_domain_events event_row
        where event_row.tenant_id = ${input.tenantId}
          and (event_row.id = ${input.eventId}
            or event_row.stream_commit_id = ${input.streamCommitId}
            or event_row.mutation_id = ${input.mutationId}
            or event_row.command_ids @>
              jsonb_build_array(${input.commandId}::text)
            or event_row.payload_reference->>'recordId' = ${input.resultId}))
        as domain_events,
      (select count(*)::int
         from inbox_v2_outbox_intents intent_row
        where intent_row.tenant_id = ${input.tenantId}
          and (intent_row.id = ${input.outboxIntentId}
            or intent_row.stream_commit_id = ${input.streamCommitId}
            or intent_row.mutation_id = ${input.mutationId}
            or intent_row.change_ids @>
              jsonb_build_array(${input.changeId}::text)
            or intent_row.payload_reference->>'recordId' = ${input.resultId}))
        as outbox_intents,
      (select count(*)::int
         from inbox_v2_outbox_work_items work_row
        where work_row.tenant_id = ${input.tenantId}
          and (work_row.intent_id = ${input.outboxIntentId}
            or work_row.terminal_result_reference->>'recordId' =
              ${input.resultId}))
        as outbox_work_items,
      (select count(*)::int
         from inbox_v2_outbox_outcomes outcome_row
        where outcome_row.tenant_id = ${input.tenantId}
          and (outcome_row.intent_id = ${input.outboxIntentId}
            or outcome_row.result_reference->>'recordId' = ${input.resultId}))
        as outbox_outcomes,
      (select count(*)::int
         from inbox_v2_auth_audit_events audit_row
        where audit_row.tenant_id = ${input.tenantId}
          and (audit_row.id = ${input.auditEventId}
            or audit_row.mutation_id = ${input.mutationId}
            or audit_row.command_record_id = ${input.commandId}
            or audit_row.evidence_reference->>'recordId' = ${input.resultId}))
        as audit_events,
      (select count(*)::int
         from inbox_v2_auth_audit_facets facet_row
        where facet_row.tenant_id = ${input.tenantId}
          and facet_row.audit_event_id = ${input.auditEventId}) as audit_facets
  `);
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Source onboarding closure count query returned no row.");
  }
  return row;
}

function sourceOnboardingLiveClosureCounts(
  value: number
): SourceOnboardingLiveClosureCounts {
  return {
    result_snapshots: value,
    commands: value,
    mutation_commits: value,
    stream_commits: value,
    stream_changes: value,
    domain_events: value,
    outbox_intents: value,
    outbox_work_items: value,
    outbox_outcomes: value,
    audit_events: value,
    audit_facets: value
  };
}

function sourceOnboardingPrefixPrunedClosureCounts(): SourceOnboardingLiveClosureCounts {
  return {
    result_snapshots: 1,
    commands: 1,
    mutation_commits: 1,
    stream_commits: 1,
    stream_changes: 0,
    domain_events: 0,
    outbox_intents: 0,
    outbox_work_items: 0,
    outbox_outcomes: 0,
    audit_events: 1,
    audit_facets: 1
  };
}

function sourceOnboardingExpiredClosureCounts(): SourceOnboardingLiveClosureCounts {
  return {
    result_snapshots: 0,
    commands: 0,
    mutation_commits: 0,
    stream_commits: 1,
    stream_changes: 0,
    domain_events: 0,
    outbox_intents: 0,
    outbox_work_items: 0,
    outbox_outcomes: 0,
    audit_events: 0,
    audit_facets: 0
  };
}

type SourceOnboardingRetainedStreamIdentity = Readonly<{
  tenantId: TenantId;
  streamEpoch: string;
  prunedCommitId: string;
  retainedCommitId: string;
}>;

type SourceOnboardingRetainedStreamState = Readonly<{
  last_position: string;
  min_retained_position: string;
  head_revision: string;
  advance_from_position: string;
  advance_to_position: string;
  advance_pruned_commit_count: string;
  baseline_position: string;
  baseline_last_commit_id: string | null;
  baseline_min_retained_position: string;
  baseline_state: string;
  pruned_skeleton_position: string;
  pruned_skeleton_change_count: string;
  pruned_skeleton_event_count: string;
  pruned_skeleton_intent_count: string;
  pruned_payload_change_count: number;
  pruned_payload_event_count: number;
  pruned_payload_intent_count: number;
  retained_payload_change_count: number;
  retained_payload_event_count: number;
  retained_payload_intent_count: number;
  retained_tail_has_no_gap: boolean;
}>;

async function sourceOnboardingRetainedStreamState(
  database: HuleeDatabase,
  input: SourceOnboardingRetainedStreamIdentity
): Promise<SourceOnboardingRetainedStreamState> {
  const result =
    await database.execute<SourceOnboardingRetainedStreamState>(sql`
    select head_row.last_position::text as last_position,
           head_row.min_retained_position::text as min_retained_position,
           head_row.revision::text as head_revision,
           advance_row.from_position::text as advance_from_position,
           advance_row.to_position::text as advance_to_position,
           advance_row.pruned_commit_count::text as advance_pruned_commit_count,
           checkpoint_row.position::text as baseline_position,
           checkpoint_row.last_commit_id as baseline_last_commit_id,
           generation_row.min_retained_position::text
             as baseline_min_retained_position,
           generation_row.state::text as baseline_state,
           pruned_commit.position::text as pruned_skeleton_position,
           pruned_commit.change_count::text as pruned_skeleton_change_count,
           pruned_commit.event_count::text as pruned_skeleton_event_count,
           pruned_commit.outbox_intent_count::text
             as pruned_skeleton_intent_count,
           (select count(*)::int
              from inbox_v2_tenant_stream_changes change_row
             where change_row.tenant_id = pruned_commit.tenant_id
               and change_row.stream_commit_id = pruned_commit.id)
             as pruned_payload_change_count,
           (select count(*)::int
              from inbox_v2_domain_events event_row
             where event_row.tenant_id = pruned_commit.tenant_id
               and event_row.stream_commit_id = pruned_commit.id)
             as pruned_payload_event_count,
           (select count(*)::int
              from inbox_v2_outbox_intents intent_row
             where intent_row.tenant_id = pruned_commit.tenant_id
               and intent_row.stream_commit_id = pruned_commit.id)
             as pruned_payload_intent_count,
           (select count(*)::int
              from inbox_v2_tenant_stream_changes change_row
             where change_row.tenant_id = retained_commit.tenant_id
               and change_row.stream_commit_id = retained_commit.id)
             as retained_payload_change_count,
           (select count(*)::int
              from inbox_v2_domain_events event_row
             where event_row.tenant_id = retained_commit.tenant_id
               and event_row.stream_commit_id = retained_commit.id)
             as retained_payload_event_count,
           (select count(*)::int
              from inbox_v2_outbox_intents intent_row
             where intent_row.tenant_id = retained_commit.tenant_id
               and intent_row.stream_commit_id = retained_commit.id)
             as retained_payload_intent_count,
           not exists (
             select 1
               from generate_series(
                 head_row.min_retained_position,
                 head_row.last_position
               ) expected_position(position)
              where not exists (
                select 1
                  from inbox_v2_tenant_stream_commits tail_commit
                 where tail_commit.tenant_id = head_row.tenant_id
                   and tail_commit.stream_epoch = head_row.stream_epoch
                   and tail_commit.position = expected_position.position
              )
           ) as retained_tail_has_no_gap
      from inbox_v2_tenant_stream_heads head_row
      join inbox_v2_tenant_stream_commits pruned_commit
        on pruned_commit.tenant_id = head_row.tenant_id
       and pruned_commit.stream_epoch = head_row.stream_epoch
       and pruned_commit.id = ${input.prunedCommitId}
      join inbox_v2_tenant_stream_commits retained_commit
        on retained_commit.tenant_id = head_row.tenant_id
       and retained_commit.stream_epoch = head_row.stream_epoch
       and retained_commit.id = ${input.retainedCommitId}
      join inbox_v2_tenant_stream_retention_advances advance_row
        on advance_row.tenant_id = pruned_commit.tenant_id
       and advance_row.stream_epoch = pruned_commit.stream_epoch
       and pruned_commit.position >= greatest(advance_row.from_position, 1)
       and pruned_commit.position < advance_row.to_position
      join inbox_v2_projection_generations generation_row
        on generation_row.tenant_id = head_row.tenant_id
       and generation_row.projection_id = ${retentionProjectionId}
       and generation_row.scope_id = ${retentionProjectionScopeId}
       and generation_row.generation = ${retentionProjectionGeneration}
       and generation_row.stream_epoch = head_row.stream_epoch
      join inbox_v2_projection_checkpoints checkpoint_row
        on checkpoint_row.tenant_id = generation_row.tenant_id
       and checkpoint_row.projection_id = generation_row.projection_id
       and checkpoint_row.scope_id = generation_row.scope_id
       and checkpoint_row.generation = generation_row.generation
       and checkpoint_row.stream_epoch = generation_row.stream_epoch
     where head_row.tenant_id = ${input.tenantId}
       and head_row.stream_epoch = ${input.streamEpoch}
  `);
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("SRC-011 retained stream state query returned no row.");
  }
  return row;
}

async function sourceOnboardingDatabaseClock(
  database: HuleeDatabase
): Promise<string> {
  const result = await database.execute<{ db_now: Date | string }>(sql`
    select clock_timestamp() as db_now
  `);
  const dbNow = result.rows[0]?.db_now;
  if (dbNow === undefined) {
    throw new Error("SRC-011 database clock query returned no row.");
  }
  return new Date(dbNow).toISOString();
}

async function deleteSourceOnboardingCommandClosure(
  database: HuleeDatabase,
  input: SourceOnboardingClosureIdentity
): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction.execute(sql`
      delete from inbox_v2_auth_mutation_commits
       where tenant_id = ${input.tenantId}
         and mutation_id = ${input.mutationId}
    `);
    await transaction.execute(sql`
      delete from inbox_v2_auth_audit_events
       where tenant_id = ${input.tenantId}
         and id = ${input.auditEventId}
    `);
    await transaction.execute(sql`
      delete from inbox_v2_auth_command_records
       where tenant_id = ${input.tenantId}
         and id = ${input.commandId}
    `);
    await transaction.execute(sql`set constraints all immediate`);
  });
}

async function expectDatabaseFailure(
  operation: () => Promise<unknown>,
  expectedState: string,
  expectedMessage: string
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    expect(findSqlState(error)).toBe(expectedState);
    expect(databaseErrorMessages(error)).toContain(expectedMessage);
    return;
  }
  throw new Error(`Expected PostgreSQL ${expectedState}: ${expectedMessage}.`);
}

function findSqlState(error: unknown): string | null {
  const visited = new Set<unknown>();
  let current: unknown = error;
  while (
    current !== null &&
    typeof current === "object" &&
    !visited.has(current)
  ) {
    visited.add(current);
    const record = current as Readonly<Record<string, unknown>>;
    if (typeof record.code === "string" && /^\d{5}$/u.test(record.code)) {
      return record.code;
    }
    current = record.cause;
  }
  return null;
}

function databaseErrorMessages(error: unknown): string {
  const messages: string[] = [];
  const visited = new Set<unknown>();
  let current: unknown = error;
  while (
    current !== null &&
    typeof current === "object" &&
    !visited.has(current)
  ) {
    visited.add(current);
    const record = current as Readonly<Record<string, unknown>>;
    if (typeof record.message === "string") messages.push(record.message);
    current = record.cause;
  }
  return messages.join("\n");
}

function testCipher(): TenantSecretCipher {
  return {
    keyRef: "test-key:src010",
    encrypt(value) {
      return `sealed:${createHash("sha256").update(value).digest("hex")}`;
    },
    decrypt() {
      throw new Error("not used");
    }
  };
}

function governanceDigest(character: string): string {
  return `sha256:${rawDigest(character)}`;
}

function rawDigest(character: string): string {
  return character.repeat(64);
}
