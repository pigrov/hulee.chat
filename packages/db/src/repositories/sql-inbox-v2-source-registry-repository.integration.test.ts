import type { TenantId } from "@hulee/contracts";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHuleeDatabase,
  createHuleeDatabase,
  type HuleeDatabase
} from "../client";
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
const rollbackTenantId = `tenant:${suffix}-rollback` as TenantId;
const successFixture = createInboxV2SourceRegistryOnboardingFixture({
  tenantId: successTenantId,
  suffix: `${suffix}-success`,
  registryId
});
const rollbackFixture = createInboxV2SourceRegistryOnboardingFixture({
  tenantId: rollbackTenantId,
  suffix: `${suffix}-rollback`,
  registryId,
  includeArtifact: true
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
    await seedLifecycleAuthority(database, successTenantId);
    await seedLifecycleAuthority(database, rollbackTenantId);
  }, 30_000);

  afterAll(async () => {
    if (database) {
      await cleanupFixture(database).catch(() => {});
      await closeHuleeDatabase(database);
    }
  }, 30_000);

  it("commits onboarding and revokes its secret and route through a real head update", async () => {
    const repository = createSqlInboxV2SourceRegistryRepository(
      database,
      testCipher()
    );

    await expect(
      repository.commitSourceConnectionOnboarding(successFixture.input)
    ).resolves.toMatchObject({
      id: successFixture.connectionId,
      tenantId: successTenantId,
      status: "onboarding"
    });
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
  }, 30_000);

  it("rolls tenant secret and compatibility rows back when the payload writer fails", async () => {
    const repository = createSqlInboxV2SourceRegistryRepository(
      database,
      testCipher(),
      {
        classifiedPayloadWriter: {
          async write(transaction) {
            await transaction.execute(
              sql`select 1 as source_registry_classified_payload_write`
            );
            throw new Error("injected PostgreSQL payload writer failure");
          }
        }
      }
    );

    await expect(
      repository.commitSourceConnectionOnboarding(rollbackFixture.input)
    ).rejects.toThrow("injected PostgreSQL payload writer failure");

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

async function seedLifecycleAuthority(
  database: HuleeDatabase,
  tenantId: TenantId
): Promise<void> {
  const tenantSuffix = tenantId.replaceAll(/[^a-z0-9]+/gu, "-").slice(-50);
  await database.transaction(async (transaction) => {
    await transaction.execute(sql`
      insert into tenants (id, slug, display_name, deployment_type)
      values (${tenantId}, ${tenantSuffix}, 'SRC-010 integration', 'saas_shared')
    `);
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
  await database.execute(sql`
    delete from inbox_v2_source_registry_related_authority_refs
     where tenant_id::text like 'tenant:src010-%-success'
        or tenant_id::text like 'tenant:src010-%-rollback';
    delete from inbox_v2_source_registry_ingress_routes
     where tenant_id::text like 'tenant:src010-%-success'
        or tenant_id::text like 'tenant:src010-%-rollback';
    delete from inbox_v2_source_registry_secret_refs
     where tenant_id::text like 'tenant:src010-%-success'
        or tenant_id::text like 'tenant:src010-%-rollback';
    delete from inbox_v2_source_registry_artifact_refs
     where tenant_id::text like 'tenant:src010-%-success'
        or tenant_id::text like 'tenant:src010-%-rollback';
    delete from inbox_v2_source_registry_heads
     where tenant_id::text like 'tenant:src010-%-success'
        or tenant_id::text like 'tenant:src010-%-rollback';
    delete from inbox_v2_source_registry_transitions
     where tenant_id::text like 'tenant:src010-%-success'
        or tenant_id::text like 'tenant:src010-%-rollback';
    delete from tenant_secrets
     where tenant_id::text like 'tenant:src010-%-success'
        or tenant_id::text like 'tenant:src010-%-rollback';
    delete from source_connections
     where tenant_id::text like 'tenant:src010-%-success'
        or tenant_id::text like 'tenant:src010-%-rollback';
    delete from inbox_v2_data_governance_control_set_heads
     where tenant_id::text like 'tenant:src010-%-success'
        or tenant_id::text like 'tenant:src010-%-rollback';
    delete from inbox_v2_data_governance_policy_activation_heads
     where tenant_id::text like 'tenant:src010-%-success'
        or tenant_id::text like 'tenant:src010-%-rollback';
    delete from inbox_v2_data_governance_policy_activations
     where tenant_id::text like 'tenant:src010-%-success'
        or tenant_id::text like 'tenant:src010-%-rollback';
    delete from inbox_v2_data_governance_effective_policy_rules
     where tenant_id::text like 'tenant:src010-%-success'
        or tenant_id::text like 'tenant:src010-%-rollback';
    delete from inbox_v2_data_governance_effective_policies
     where tenant_id::text like 'tenant:src010-%-success'
        or tenant_id::text like 'tenant:src010-%-rollback';
    delete from inbox_v2_data_governance_contexts
     where tenant_id::text like 'tenant:src010-%-success'
        or tenant_id::text like 'tenant:src010-%-rollback';
    delete from tenants
     where id::text like 'tenant:src010-%-success'
        or id::text like 'tenant:src010-%-rollback';
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
