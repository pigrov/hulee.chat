import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHuleeDatabase,
  createHuleeDatabase,
  type HuleeDatabase
} from "../client";

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;

const tenantId = "tenant:binding-benchmark";
const bindingId = "source_thread_binding:binding-benchmark";

describePostgres(
  "Inbox V2 SourceThreadBinding PostgreSQL bounded materialization",
  () => {
    let db: HuleeDatabase;

    beforeAll(async () => {
      db = createHuleeDatabase();
      const catalog = await db.execute<{ snapshot_table: string | null }>(sql`
        select to_regclass(
          'inbox_v2_source_thread_binding_snapshots'
        )::text as snapshot_table
      `);
      expect(catalog.rows[0]?.snapshot_table).toBe(
        "inbox_v2_source_thread_binding_snapshots"
      );
    });

    afterAll(async () => {
      await closeHuleeDatabase(db);
    });

    it("closes 256 capabilities x 16 roles without lifetime scans and stays timezone-stable", async () => {
      let elapsedMs = Number.POSITIVE_INFINITY;

      await expect(
        db.transaction(async (transaction) => {
          // This benchmark isolates DB003. Upstream DB001/DB002 anchors are
          // check-valid but their own FK/trigger workflows are intentionally
          // bypassed while seeding; all binding constraints run in origin mode.
          await transaction.execute(sql.raw(UPSTREAM_FIXTURE_SQL));
          await transaction.execute(sql`set constraints all deferred`);
          await transaction.execute(sql`set local timezone = 'UTC'`);

          const startedAt = performance.now();
          await transaction.execute(sql.raw(MAX_BOUND_BINDING_SQL));
          await transaction.execute(sql`set constraints all immediate`);
          elapsedMs = performance.now() - startedAt;

          await transaction.execute(
            sql.raw(`
            create temp table inbox_v2_source_thread_binding_heads
              (like public.inbox_v2_source_thread_binding_heads including all)
          `)
          );
          await transaction.execute(sql`
              select public.inbox_v2_assert_source_thread_binding_integrity(
                ${tenantId},
                ${bindingId}
              )
            `);

          const counts = await transaction.execute<{
            capability_entries: string;
            required_roles: string;
            snapshots: string;
          }>(sql`
              select
                (
                  select count(*)::text
                    from inbox_v2_source_thread_binding_capability_entries
                   where tenant_id = ${tenantId}
                ) as capability_entries,
                (
                  select count(*)::text
                    from inbox_v2_source_thread_binding_capability_required_roles
                   where tenant_id = ${tenantId}
                ) as required_roles,
                (
                  select count(*)::text
                    from inbox_v2_source_thread_binding_snapshots
                   where tenant_id = ${tenantId}
                ) as snapshots
            `);
          expect(counts.rows[0]).toEqual({
            capability_entries: "256",
            required_roles: "4096",
            snapshots: "1"
          });

          await transaction.execute(
            sql`set local timezone = 'Pacific/Auckland'`
          );
          await transaction.execute(sql`
              select inbox_v2_assert_source_thread_binding_integrity(
                ${tenantId},
                ${bindingId}
              )
            `);

          let lateInsertError: unknown;
          try {
            await transaction.transaction(async (savepoint) => {
              await savepoint.execute(sql`
                  insert into inbox_v2_source_thread_binding_provider_roles (
                    tenant_id,
                    binding_id,
                    provider_access_revision,
                    materialized_by_binding_revision,
                    ordinal,
                    provider_role_id
                  ) values (
                    ${tenantId},
                    ${bindingId},
                    1,
                    1,
                    16,
                    'core:late_role'
                  )
                `);
            });
          } catch (error) {
            lateInsertError = error;
          }
          expect(databaseErrorMessages(lateInsertError)).toContain(
            "Inbox V2 binding collection materialization is already closed"
          );

          throw new Error("rollback-source-thread-binding-benchmark");
        })
      ).rejects.toThrow("rollback-source-thread-binding-benchmark");

      expect(elapsedMs).toBeLessThan(20_000);
    }, 30_000);
  }
);

function databaseErrorMessages(error: unknown): string {
  const messages: string[] = [];
  let current = error;

  for (let depth = 0; depth < 8 && current; depth += 1) {
    messages.push(current instanceof Error ? current.message : String(current));
    if (typeof current !== "object" || !("cause" in current)) break;
    const cause = (current as { cause?: unknown }).cause;
    if (!cause || cause === current) break;
    current = cause;
  }
  return messages.join("\n");
}

const UPSTREAM_FIXTURE_SQL = String.raw`
set local session_replication_role = replica;
insert into tenants (id, slug, display_name)
values ('tenant:binding-benchmark', 'binding-benchmark', 'Binding benchmark');
insert into source_connections (
  id, tenant_id, source_type, source_name, display_name
) values (
  'source_connection:binding-benchmark', 'tenant:binding-benchmark',
  'messenger', 'audit', 'Binding benchmark'
);
insert into source_accounts (
  id, tenant_id, source_connection_id, account_type, display_name
) values (
  'source_account:binding-benchmark', 'tenant:binding-benchmark',
  'source_connection:binding-benchmark', 'direct_number', 'Binding benchmark'
);
insert into inbox_v2_source_account_identity_transitions (
  tenant_id, id, source_account_id, provisional_key_digest_sha256,
  provisional_observed_at, intent, from_state, to_state, expected_revision,
  current_revision, resulting_revision, expected_account_generation,
  current_account_generation, resulting_account_generation,
  pinned_declaration_trusted_service_id,
  decision_actor_trusted_service_id, decision_policy_id,
  decision_policy_version, decision_reason_code_id,
  decision_verification_evidence_token, decision_decided_at, occurred_at
) values (
  'tenant:binding-benchmark',
  'source_account_identity_transition:binding-benchmark-promote',
  'source_account:binding-benchmark', repeat('a', 64),
  '2026-07-13 18:00:00+00', 'promote_verified', 'provisional', 'verified',
  1, 1, 2, 1, 1, 2, 'core:trusted', 'core:trusted', 'core:policy', 'v1',
  'core:promote', 'evidence-promote', '2026-07-13 18:05:00+00',
  '2026-07-13 18:05:00+00'
);
insert into inbox_v2_source_account_identity_verified_snapshots (
  tenant_id, source_account_id, source_connection_id, transition_id,
  identity_revision, account_generation, state, identity_declaration,
  declaration_contract_id, declaration_contract_version,
  declaration_revision, declaration_surface_id,
  declaration_loaded_by_trusted_service_id, declaration_loaded_at,
  declaration_realm_id, declaration_realm_version,
  declaration_canonicalization_version, declaration_object_kind_id,
  declaration_scope_kind, canonical_realm_id, canonical_realm_version,
  canonicalization_version, canonical_object_kind_id, canonical_scope_kind,
  canonical_scope_owner_key, canonical_external_subject,
  verified_decision_actor_trusted_service_id, verified_decision_policy_id,
  verified_decision_policy_version, verified_decision_reason_code_id,
  verified_decision_verification_evidence_token,
  verified_decision_decided_at, identity_created_at, verified_at
) values (
  'tenant:binding-benchmark', 'source_account:binding-benchmark',
  'source_connection:binding-benchmark',
  'source_account_identity_transition:binding-benchmark-promote', 2, 2,
  'verified',
  '{"adapterContract":{"contractId":"core:contract","contractVersion":"v1","declarationRevision":"1","surfaceId":"core:surface","loadedByTrustedServiceId":"core:trusted","loadedAt":"2026-07-13T18:00:00.000Z"},"identityKind":"source_account","realmId":"core:realm","realmVersion":"v1","canonicalizationVersion":"v1","objectKindId":"core:account","scopeKind":"provider","decisionStrength":"authoritative"}'::jsonb,
  'core:contract', 'v1', 1, 'core:surface', 'core:trusted',
  '2026-07-13 18:00:00+00', 'core:realm', 'v1', 'v1', 'core:account',
  'provider', 'core:realm', 'v1', 'v1', 'core:account', 'provider',
  'provider', 'provider:account-42', 'core:trusted', 'core:policy', 'v1',
  'core:promote', 'evidence-promote', '2026-07-13 18:05:00+00',
  '2026-07-13 18:00:00+00', '2026-07-13 18:05:00+00'
);
insert into inbox_v2_external_threads (
  tenant_id, id, key_registry_id, key_registry_entry_kind, realm_id,
  realm_version, canonicalization_version, scope_kind, scope_owner_key,
  object_kind_id, canonical_external_subject, identity_declaration,
  conversation_id, conversation_transport, conversation_topology,
  revision, created_at, updated_at
) values (
  'tenant:binding-benchmark', 'external_thread:binding-benchmark',
  'external_thread_key:binding-benchmark', 'canonical',
  'core:thread_realm', 'v1', 'v1', 'provider', 'provider', 'core:thread',
  'provider:thread-42',
  '{"adapterContract":{"contractId":"core:contract","contractVersion":"v1","declarationRevision":"1","surfaceId":"core:surface","loadedByTrustedServiceId":"core:trusted","loadedAt":"2026-07-13T18:00:00.000Z"},"identityKind":"external_thread","realmId":"core:thread_realm","realmVersion":"v1","canonicalizationVersion":"v1","objectKindId":"core:thread","scopeKind":"provider","decisionStrength":"authoritative"}'::jsonb,
  'conversation:binding-benchmark', 'external', 'group', 1,
  '2026-07-13 18:00:00+00', '2026-07-13 18:00:00+00'
);
set local session_replication_role = origin;
`;

const MAX_BOUND_BINDING_SQL = String.raw`
insert into inbox_v2_source_thread_bindings (
  tenant_id, id, external_thread_id, source_connection_id,
  source_account_id, created_at
) values (
  'tenant:binding-benchmark', 'source_thread_binding:binding-benchmark',
  'external_thread:binding-benchmark', 'source_connection:binding-benchmark',
  'source_account:binding-benchmark', '2026-07-13 18:10:00+00'
);
insert into inbox_v2_source_thread_binding_evidence_sets (
  tenant_id, id, binding_id, external_thread_id, source_connection_id,
  source_account_id, reference_count, ordered_reference_digest_sha256,
  created_at
) values (
  'tenant:binding-benchmark',
  'source_thread_binding_evidence_set:binding-benchmark',
  'source_thread_binding:binding-benchmark',
  'external_thread:binding-benchmark', 'source_connection:binding-benchmark',
  'source_account:binding-benchmark', 1,
  encode(sha256(convert_to(
    '0|source_account_identity_transition|' ||
    octet_length(
      'source_account_identity_transition:binding-benchmark-promote'
    )::text || ':' ||
    'source_account_identity_transition:binding-benchmark-promote',
    'UTF8'
  )), 'hex'),
  '2026-07-13 18:10:00+00'
);
insert into inbox_v2_source_thread_binding_evidence_references (
  tenant_id, evidence_set_id, binding_id, source_connection_id,
  source_account_id,
  ordinal, kind, source_account_identity_transition_id,
  source_account_identity_transition_resulting_revision,
  source_account_identity_transition_resulting_generation
) values (
  'tenant:binding-benchmark',
  'source_thread_binding_evidence_set:binding-benchmark',
  'source_thread_binding:binding-benchmark',
  'source_connection:binding-benchmark', 'source_account:binding-benchmark',
  0, 'source_account_identity_transition',
  'source_account_identity_transition:binding-benchmark-promote', 2, 2
);
insert into inbox_v2_source_thread_binding_remote_access_episodes (
  tenant_id, id, binding_id, state, started_at, start_evidence_set_id,
  revision, updated_at
) values (
  'tenant:binding-benchmark',
  'source_thread_binding_remote_access_episode:binding-benchmark',
  'source_thread_binding:binding-benchmark', 'active',
  '2026-07-13 18:10:00+00',
  'source_thread_binding_evidence_set:binding-benchmark', 1,
  '2026-07-13 18:10:00+00'
);
insert into inbox_v2_source_thread_binding_provider_roles (
  tenant_id, binding_id, provider_access_revision,
  materialized_by_binding_revision, ordinal, provider_role_id
)
select 'tenant:binding-benchmark', 'source_thread_binding:binding-benchmark',
       1, 1, role_no, 'core:role_' || lpad(role_no::text, 2, '0')
  from generate_series(0, 15) role_no;
insert into inbox_v2_source_thread_binding_capability_entries (
  tenant_id, binding_id, capability_revision,
  materialized_by_binding_revision, ordinal, capability_id, operation_id,
  state, reference_portability, valid_until,
  required_provider_role_count, evidence_set_id
)
select 'tenant:binding-benchmark', 'source_thread_binding:binding-benchmark',
       1, 1, entry_no,
       'core:capability_' || lpad(entry_no::text, 3, '0'), 'core:send',
       'supported', 'binding_only', '2026-07-14 18:10:00+00', 16,
       'source_thread_binding_evidence_set:binding-benchmark'
  from generate_series(0, 255) entry_no;
insert into inbox_v2_source_thread_binding_capability_required_roles (
  tenant_id, binding_id, capability_revision,
  materialized_by_binding_revision, capability_ordinal, capability_id,
  operation_id, content_kind_key, ordinal, provider_role_id
)
select 'tenant:binding-benchmark', 'source_thread_binding:binding-benchmark',
       1, 1, entry_no,
       'core:capability_' || lpad(entry_no::text, 3, '0'),
       'core:send', '0:', role_no,
       'core:role_' || lpad(role_no::text, 2, '0')
  from generate_series(0, 255) entry_no
 cross join generate_series(0, 15) role_no;
create temporary table binding_benchmark_digests (
  provider_digest text,
  capability_digest text,
  route_digest text,
  route_attributes_digest text
) on commit drop;
insert into binding_benchmark_digests
with entry_payload as (
  select e.ordinal, e.capability_id, e.operation_id, e.content_kind_key,
         e.capability_id || '|' || e.operation_id || '|' ||
         e.content_kind_key || '|' || e.state::text || '|' ||
         e.reference_portability::text || '|' ||
         coalesce(
           ((extract(epoch from e.valid_until) * 1000)::numeric(20, 0))::text,
           '-'
         ) || '|' || coalesce(e.diagnostic_code_id, '-') || '|' ||
         coalesce(e.diagnostic_retryable::text, '-') || '|' ||
         coalesce(e.diagnostic_correlation_token, '-') || '|' ||
         coalesce(e.diagnostic_safe_operator_hint_id, '-') || '|' ||
         coalesce((select string_agg(
           octet_length(r.provider_role_id)::text || ':' ||
             r.provider_role_id,
           '' order by r.provider_role_id)
           from inbox_v2_source_thread_binding_capability_required_roles r
          where r.tenant_id = e.tenant_id
            and r.binding_id = e.binding_id
            and r.capability_revision = e.capability_revision
            and r.capability_ordinal = e.ordinal), '') as payload
    from inbox_v2_source_thread_binding_capability_entries e
   where e.tenant_id = 'tenant:binding-benchmark'
     and e.binding_id = 'source_thread_binding:binding-benchmark'
     and e.capability_revision = 1
), capability_digest as (
  select encode(sha256(convert_to(
    octet_length('core:contract')::text || ':' || 'core:contract' ||
    octet_length('v1')::text || ':' || 'v1' || '1|' ||
    octet_length('core:surface')::text || ':' || 'core:surface' ||
    octet_length('core:trusted')::text || ':' || 'core:trusted' ||
    coalesce(string_agg(
      payload, '' order by capability_id, operation_id, content_kind_key
    ), ''), 'UTF8')), 'hex') digest
    from entry_payload
), provider_digest as (
  select encode(sha256(convert_to(coalesce(string_agg(
    octet_length(provider_role_id)::text || ':' || provider_role_id,
    '' order by provider_role_id
  ), ''), 'UTF8')), 'hex') digest
    from inbox_v2_source_thread_binding_provider_roles
   where tenant_id = 'tenant:binding-benchmark'
     and binding_id = 'source_thread_binding:binding-benchmark'
     and provider_access_revision = 1
), route_digest as (
  select encode(sha256(convert_to(
    octet_length('core:contract')::text || ':' || 'core:contract' ||
    octet_length('v1')::text || ':' || 'v1' ||
    octet_length('1')::text || ':' || '1' ||
    octet_length('core:surface')::text || ':' || 'core:surface' ||
    octet_length('core:trusted')::text || ':' || 'core:trusted' ||
    octet_length('core:route')::text || ':' || 'core:route' ||
    octet_length('v1')::text || ':' || 'v1' ||
    octet_length('1')::text || ':' || '1' ||
    octet_length('core:thread')::text || ':' || 'core:thread' ||
    octet_length('provider:thread-42')::text || ':' ||
      'provider:thread-42', 'UTF8')), 'hex') digest
)
select provider_digest.digest, capability_digest.digest, route_digest.digest,
       encode(sha256(convert_to('', 'UTF8')), 'hex')
  from provider_digest, capability_digest, route_digest;
insert into inbox_v2_source_thread_binding_heads (
  tenant_id, binding_id, external_thread_id, source_connection_id,
  source_account_id, account_identity_revision, account_generation,
  account_identity_state, account_canonical_key_digest_sha256,
  account_identity_trusted_service_id, account_verified_at,
  account_verification_evidence_set_id, binding_generation,
  current_remote_access_episode_id, current_remote_access_episode_revision,
  remote_access_state, remote_access_evidence_authority,
  remote_access_revision, remote_access_since, remote_access_evidence_set_id,
  administrative_state, administrative_revision, administrative_changed_at,
  runtime_health_state, runtime_health_revision, runtime_health_checked_at,
  history_sync_state, history_sync_revision, history_updated_at,
  provider_access_revision, provider_role_count, provider_roles_digest_sha256,
  provider_access_evidence_set_id, provider_access_observed_at,
  capability_contract_id, capability_contract_version,
  capability_declaration_revision, capability_surface_id,
  capability_loaded_by_trusted_service_id, capability_loaded_at,
  capability_revision, capability_entry_count,
  capability_semantic_digest_sha256, capability_captured_at,
  route_contract_id, route_contract_version, route_declaration_revision,
  route_surface_id, route_loaded_by_trusted_service_id, route_loaded_at,
  route_descriptor_schema_id, route_descriptor_version,
  route_descriptor_revision, route_destination_kind_id,
  route_destination_subject, route_descriptor_digest_sha256,
  route_attribute_count, route_attributes_digest_sha256,
  revision, created_at, updated_at
)
select 'tenant:binding-benchmark', 'source_thread_binding:binding-benchmark',
       'external_thread:binding-benchmark',
       'source_connection:binding-benchmark',
       'source_account:binding-benchmark', s.identity_revision,
       s.account_generation, s.state, s.canonical_key_digest_sha256,
       s.declaration_loaded_by_trusted_service_id,
       s.verified_decision_decided_at,
       'source_thread_binding_evidence_set:binding-benchmark', 1,
       'source_thread_binding_remote_access_episode:binding-benchmark', 1,
       'active', 'direct_observation', 1, '2026-07-13 18:10:00+00',
       'source_thread_binding_evidence_set:binding-benchmark',
       'enabled', 1, '2026-07-13 18:10:00+00',
       'ready', 1, '2026-07-13 18:10:00+00',
       'unsupported', 1, '2026-07-13 18:10:00+00',
       1, 16, d.provider_digest,
       'source_thread_binding_evidence_set:binding-benchmark',
       '2026-07-13 18:10:00+00', 'core:contract', 'v1', 1,
       'core:surface', 'core:trusted', '2026-07-13 18:00:00+00',
       1, 256, d.capability_digest, '2026-07-13 18:10:00+00',
       'core:contract', 'v1', 1, 'core:surface', 'core:trusted',
       '2026-07-13 18:00:00+00', 'core:route', 'v1', 1,
       'core:thread', 'provider:thread-42', d.route_digest, 0,
       d.route_attributes_digest, 1, '2026-07-13 18:10:00+00',
       '2026-07-13 18:10:00+00'
  from inbox_v2_source_account_identity_verified_snapshots s
 cross join binding_benchmark_digests d
 where s.tenant_id = 'tenant:binding-benchmark'
   and s.source_account_id = 'source_account:binding-benchmark'
   and s.identity_revision = 2;
insert into inbox_v2_source_thread_binding_snapshots
select (jsonb_populate_record(
  null::inbox_v2_source_thread_binding_snapshots,
  to_jsonb(h) || jsonb_build_object(
    'transition_id', null,
    'expected_binding_revision', null
  )
)).*
  from inbox_v2_source_thread_binding_heads h
 where h.tenant_id = 'tenant:binding-benchmark'
   and h.binding_id = 'source_thread_binding:binding-benchmark';
`;
