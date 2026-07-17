import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrationJournal } from "../checks/db-check-lib.mjs";

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const checkedInMigrationsDirectory = resolve("packages/db/drizzle");
const migrationIndex = 45;

describePostgres(
  "Inbox V2 source-message reconciliation 0045 PostgreSQL behavior",
  () => {
    let adminClient;
    let databaseName;
    let databaseUrl;
    let migrationsDirectory;
    let temporaryRoot;

    beforeAll(async () => {
      if (!process.env.DATABASE_URL) {
        throw new Error(
          "DATABASE_URL is required for the SRC-006 migration behavior test."
        );
      }

      temporaryRoot = await mkdtemp(join(tmpdir(), "hulee-src006-migrations-"));
      migrationsDirectory = await prepareMigrationDirectory(temporaryRoot);

      adminClient = new pg.Client({
        connectionString: process.env.DATABASE_URL
      });
      await adminClient.connect();

      const baseUrl = new URL(process.env.DATABASE_URL);
      databaseName = `hulee_src006_${process.pid}_${Date.now()}`;
      await adminClient.query(
        `create database ${quoteDatabaseName(databaseName)}`
      );
      baseUrl.pathname = `/${databaseName}`;
      databaseUrl = baseUrl.toString();
      await applyMigrations(databaseUrl, migrationsDirectory);
    }, 120_000);

    afterAll(async () => {
      const cleanupErrors = [];
      if (adminClient && databaseName) {
        await adminClient
          .query(
            `drop database if exists ${quoteDatabaseName(databaseName)} with (force)`
          )
          .catch((error) => cleanupErrors.push(error));
      }
      await adminClient?.end().catch((error) => cleanupErrors.push(error));
      if (temporaryRoot) {
        await rm(temporaryRoot, { recursive: true, force: true }).catch(
          (error) => cleanupErrors.push(error)
        );
      }
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          cleanupErrors,
          "SRC-006 PostgreSQL behavior cleanup failed."
        );
      }
    }, 120_000);

    it("installs the exact evidence identity and an update-only action constraint", async () => {
      await withClient(databaseUrl, async (client) => {
        const result = await client.query(`
          select
            pg_get_constraintdef(identity_constraint.oid) as "identityConstraint",
            pg_get_triggerdef(action_trigger.oid) as "actionTrigger",
            pg_get_functiondef(action_assert.oid) as "actionAssert",
            (
              select indexdef
              from pg_catalog.pg_indexes
              where schemaname = 'public'
                and indexname = 'inbox_v2_deferred_actions_pending_key_idx'
            ) as "pendingKeyIndex"
          from pg_catalog.pg_constraint identity_constraint
          cross join pg_catalog.pg_trigger action_trigger
          cross join pg_catalog.pg_proc action_assert
          join pg_catalog.pg_namespace action_namespace
            on action_namespace.oid = action_assert.pronamespace
          where identity_constraint.conname =
              'inbox_v2_source_message_correlation_evidence_identity_unique'
            and action_trigger.tgname =
              'inbox_v2_deferred_source_action_constraint_trigger'
            and action_assert.proname = 'inbox_v2_deferred_source_action_assert'
            and action_namespace.nspname = 'public'
        `);

        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]).toMatchObject({
          identityConstraint:
            "UNIQUE (tenant_id, source_occurrence_id, code_id, evidence_hmac_sha256)"
        });
        expect(result.rows[0].actionTrigger).toContain(
          "AFTER UPDATE ON public.inbox_v2_deferred_message_source_actions"
        );
        expect(result.rows[0].actionTrigger).not.toContain("AFTER INSERT");
        expect(result.rows[0].actionAssert).toContain(
          "inbox_v2.deferred_source_action_occurrence_resolution_mismatch"
        );
        expect(result.rows[0].actionAssert).toContain(
          "occurrence_row.resolution_state <> 'resolved'"
        );
        expect(result.rows[0].actionAssert).toContain(
          "inbox_v2.deferred_source_action_historical_head_mismatch"
        );
        expect(result.rows[0].pendingKeyIndex).toContain(
          "(tenant_id, message_key_digest_sha256, id) WHERE (state = 'pending'"
        );
      });
    });

    it("accepts all-or-none stale target provenance without an applied effect", async () => {
      await withClient(databaseUrl, async (client) => {
        await client.query("set session_replication_role = replica");
        try {
          await client.query(staleTransitionInsertSql("valid", true));
          const accepted = await client.query(`
            select target_external_message_reference_id,
                   source_occurrence_resulting_revision,
                   applied_message_revision, effect_kind
              from public.inbox_v2_deferred_message_source_action_transitions
             where tenant_id = 'tenant:src006-pg'
               and action_id = 'deferred_message_source_action:pg-valid'
          `);
          expect(accepted.rows).toEqual([
            {
              target_external_message_reference_id:
                "external_message_reference:pg",
              source_occurrence_resulting_revision: "2",
              applied_message_revision: null,
              effect_kind: null
            }
          ]);

          const partialError = await captureDatabaseError(
            client.query(staleTransitionInsertSql("partial", false))
          );
          expect(partialError?.code).toBe("23514");
          expect(partialError?.constraint).toBe(
            "inbox_v2_deferred_action_transitions_state_check"
          );

          const missingHeadError = await captureDatabaseError(
            client.query(staleTransitionInsertSql("missing-head", true, false))
          );
          expect(missingHeadError?.code).toBe("23514");
          expect(missingHeadError?.constraint).toBe(
            "inbox_v2_deferred_action_transitions_ordering_check"
          );

          const oversizedPositionError = await captureDatabaseError(
            client.query(oversizedOrderingHeadInsertSql())
          );
          expect(oversizedPositionError?.code).toBe("23514");
          expect(oversizedPositionError?.constraint).toBe(
            "inbox_v2_deferred_action_ordering_heads_values_check"
          );

          const semanticMismatchError = await captureDatabaseError(
            client.query(advanceActionFixtureInsertSql("9"))
          );
          expect(semanticMismatchError?.code).toBe("23514");
          expect(semanticMismatchError?.constraint).toBe(
            "inbox_v2_deferred_actions_semantic_check"
          );
        } finally {
          await client.query("set session_replication_role = origin");
        }
      });
    });

    it("rejects expired weak evidence before it can be replayed", async () => {
      await withClient(databaseUrl, async (client) => {
        const error = await captureDatabaseError(
          client.query(`
            insert into public.inbox_v2_source_message_correlation_evidence (
              tenant_id, source_occurrence_id, ordinal, code_id,
              evidence_hmac_sha256, expires_at, created_at
            ) values (
              'tenant:src006-missing', 'source_occurrence:src006-missing', 0,
              'core:source.weak_correlation.synthetic',
              'hmac-sha256:${"a".repeat(64)}',
              clock_timestamp() - interval '1 second',
              clock_timestamp() - interval '1 day'
            )
          `)
        );
        expect(error?.code).toBe("23514");
        expect(error?.message).toBe(
          "inbox_v2.source_correlation_evidence_expired"
        );
      });
    });

    it("rejects a direct action insert whose immutable occurrence snapshot disagrees with occurrence facts", async () => {
      await withClient(databaseUrl, async (client) => {
        await client.query("begin");
        try {
          await client.query("set local session_replication_role = replica");
          await client.query(advanceBatchDependencyFixtureInsertSql());
          await client.query(pendingOccurrenceFixtureInsertSql());
          await client.query("set local session_replication_role = origin");
          await client.query("savepoint forged_occurrence_snapshot");

          const error = await captureDatabaseError(
            client.query(advanceActionFixtureInsertSql(null, true))
          );
          await client.query(
            "rollback to savepoint forged_occurrence_snapshot"
          );
          expect({ code: error?.code, message: error?.message }).toEqual({
            code: "23514",
            message:
              "inbox_v2.deferred_source_action_occurrence_snapshot_mismatch"
          });
        } finally {
          await client.query("rollback");
        }
      });
    });

    it("accepts two same-lane advances in one transaction and revalidates the earlier action after the head advances", async () => {
      await withClient(databaseUrl, async (client) => {
        await client.query("begin");
        try {
          await client.query("set local session_replication_role = replica");
          await client.query(advanceBatchDependencyFixtureInsertSql());
          await client.query(advanceActionFixtureInsertSql());
          await client.query(advanceBatchResolutionFixtureInsertSql());
          await client.query("set local session_replication_role = origin");
          await client.query("set constraints all deferred");

          await client.query(advanceTransitionInsertSql(1));
          await client.query(advanceActionTerminalUpdateSql(1));
          await client.query(advanceOrderingHeadInsertSql());

          await client.query(advanceTransitionInsertSql(2));
          await client.query(advanceActionTerminalUpdateSql(2));
          await client.query(advanceOrderingHeadUpdateSql());

          await client.query("set constraints all immediate");
          const persisted = await client.query(`
            select revision, latest_action_id, latest_position
              from public.inbox_v2_deferred_source_action_ordering_heads
             where tenant_id = 'tenant:src006-batch'
          `);
          expect(persisted.rows).toEqual([
            {
              revision: "2",
              latest_action_id:
                "deferred_message_source_action:src006-advance-2",
              latest_position: "20"
            }
          ]);

          const replay = await client.query(`
            update public.inbox_v2_deferred_message_source_actions
               set updated_at = updated_at
             where tenant_id = 'tenant:src006-batch'
               and id = 'deferred_message_source_action:src006-advance-1'
          `);
          expect(replay.rowCount).toBe(1);
        } finally {
          await client.query("rollback");
        }
      });
    });
  }
);

function staleTransitionInsertSql(label, completeResolution, pinHead = true) {
  const actionId = `deferred_message_source_action:pg-${label}`;
  const resolutionColumns = completeResolution
    ? `1, 2, 'sha256:${"c".repeat(64)}'`
    : "null, null, null";
  const orderingHeadColumns = pinHead
    ? "7, 7, 'scope:src006-pg', 'core:provider_ordering.synthetic', 1"
    : "null, null, null, null, null";
  return `
    insert into public.inbox_v2_deferred_message_source_action_transitions (
      tenant_id, action_id, expected_revision, resulting_revision,
      after_state, ordering_outcome,
      expected_ordering_head_revision, resulting_ordering_head_revision,
      ordering_head_scope_token, ordering_head_comparator_id,
      ordering_head_comparator_revision,
      target_external_message_reference_id, target_message_id,
      applied_message_revision, effect_kind, related_action_id, reason_id,
      conflict_candidate_count, conflict_candidate_digest_sha256,
      source_occurrence_expected_revision,
      source_occurrence_resulting_revision,
      source_occurrence_resolution_digest_sha256,
      effect_proof_digest_sha256, transition_detail,
      transition_detail_digest_sha256, commit_digest_sha256, recorded_at
    ) values (
      'tenant:src006-pg', '${actionId}', 1, 2,
      'stale', 'stale',
      ${orderingHeadColumns},
      'external_message_reference:pg', 'message:pg',
      null, null, 'deferred_message_source_action:pg-head', null,
      0, null, ${resolutionColumns}, null,
      '{"action":{"id":"${actionId}"},"expectedRevision":"1","resultingRevision":"2","afterState":{"state":"stale"},"orderingOutcome":"stale"}'::jsonb,
      'sha256:${"d".repeat(64)}', 'sha256:${"e".repeat(64)}',
      '2026-07-17T00:00:00.000Z'::timestamptz
    )
  `;
}

function oversizedOrderingHeadInsertSql() {
  const keyDetail = JSON.stringify({
    realm: {
      realmId: "core:provider_message",
      realmVersion: "v1",
      canonicalizationVersion: "v1"
    },
    scope: { kind: "provider_thread" },
    objectKindId: "core:message",
    externalThread: {
      tenantId: "tenant:src006-pg",
      kind: "external_thread",
      id: "external_thread:src006-pg"
    },
    canonicalExternalSubject: "provider-message-src006-pg"
  });
  return `
    insert into public.inbox_v2_deferred_source_action_ordering_heads (
      tenant_id, message_realm_id, message_realm_version,
      message_canonicalization_version, message_scope_kind,
      message_object_kind_id, external_thread_id, canonical_external_subject,
      external_message_key_detail, external_message_key_detail_digest_sha256,
      lane, scope_token, comparator_id, comparator_revision,
      latest_action_id, latest_normalized_inbound_event_id,
      latest_source_occurrence_id, latest_semantic_id,
      latest_event_fingerprint_sha256, latest_position,
      revision, created_at, updated_at
    ) values (
      'tenant:src006-pg', 'core:provider_message', 'v1', 'v1',
      'provider_thread', 'core:message', 'external_thread:src006-pg',
      'provider-message-src006-pg', '${keyDetail}'::jsonb,
      'sha256:${"f".repeat(64)}', 'message_lifecycle', 'scope:src006-pg',
      'core:provider_ordering.synthetic', 1,
      'deferred_message_source_action:pg-head',
      'normalized_inbound_event:src006-pg', 'source_occurrence:src006-pg',
      'core:message.lifecycle.edit.observed', '${"a".repeat(64)}',
      '${"9".repeat(129)}', 1,
      '2026-07-17T00:00:00.000Z'::timestamptz,
      '2026-07-17T00:00:00.000Z'::timestamptz
    )
  `;
}

function advanceBatchDependencyFixtureInsertSql() {
  const externalThreadDeclaration = JSON.stringify({
    adapterContract: {
      contractId: "module:synthetic:contract",
      contractVersion: "v1",
      declarationRevision: "1",
      surfaceId: "module:synthetic:surface",
      loadedByTrustedServiceId: "core:source_runtime",
      loadedAt: "2026-07-17T01:00:00.000Z"
    },
    identityKind: "external_thread",
    realmId: "core:provider_thread",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "core:thread",
    scopeKind: "provider",
    decisionStrength: "authoritative"
  });
  const messageKeyDetail = JSON.stringify({
    realm: {
      realmId: "core:provider_message",
      realmVersion: "v1",
      canonicalizationVersion: "v1"
    },
    scope: { kind: "provider_thread" },
    objectKindId: "core:message",
    externalThread: {
      kind: "external_thread",
      id: "external_thread:src006-batch"
    },
    canonicalExternalSubject: "provider-message-src006-batch"
  });
  return `
    insert into public.tenants (
      id, slug, display_name, deployment_type, created_at, updated_at
    ) values (
      'tenant:src006-batch', 'src006-batch', 'SRC-006 batch fixture',
      'saas_shared', '2026-07-17T01:00:00.000Z'::timestamptz,
      '2026-07-17T01:00:00.000Z'::timestamptz
    );

    insert into public.inbox_v2_external_threads (
      tenant_id, id, key_registry_id, key_registry_entry_kind,
      realm_id, realm_version, canonicalization_version, scope_kind,
      scope_owner_key, object_kind_id, canonical_external_subject,
      identity_declaration, conversation_id, conversation_transport,
      conversation_topology, revision, created_at, updated_at
    ) values (
      'tenant:src006-batch', 'external_thread:src006-batch',
      'external_thread_key:src006-batch', 'canonical',
      'core:provider_thread', 'v1', 'v1', 'provider', 'provider',
      'core:thread', 'provider-thread-src006-batch',
      '${externalThreadDeclaration}'::jsonb, 'conversation:src006-batch',
      'external', 'group', 1,
      '2026-07-17T01:00:00.000Z'::timestamptz,
      '2026-07-17T01:00:00.000Z'::timestamptz
    );

    insert into public.inbox_v2_source_message_key_registry (
      tenant_id, message_realm_id, message_realm_version,
      message_canonicalization_version, message_scope_kind,
      message_object_kind_id, external_thread_id,
      canonical_external_subject, external_message_key_detail,
      external_message_key_detail_digest_sha256, created_at
    ) values (
      'tenant:src006-batch', 'core:provider_message', 'v1', 'v1',
      'provider_thread', 'core:message', 'external_thread:src006-batch',
      'provider-message-src006-batch', '${messageKeyDetail}'::jsonb,
      'sha256:${"1".repeat(64)}',
      '2026-07-17T01:00:00.000Z'::timestamptz
    );

    insert into public.source_connections (
      id, tenant_id, source_type, source_name, display_name, status,
      auth_type, capabilities, config, diagnostics, metadata,
      created_at, updated_at
    ) values (
      'source_connection:src006-batch', 'tenant:src006-batch',
      'synthetic', 'src006', 'SRC-006 synthetic connection', 'active',
      'custom', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
      '2026-07-17T01:00:00.000Z'::timestamptz,
      '2026-07-17T01:00:00.000Z'::timestamptz
    );

    insert into public.source_accounts (
      id, tenant_id, source_connection_id, external_account_id,
      account_type, display_name, status, metadata, created_at, updated_at
    ) values (
      'source_account:src006-batch', 'tenant:src006-batch',
      'source_connection:src006-batch', 'src006-batch', 'direct_account',
      'SRC-006 synthetic account', 'active', '{}'::jsonb,
      '2026-07-17T01:00:00.000Z'::timestamptz,
      '2026-07-17T01:00:00.000Z'::timestamptz
    );

    insert into public.inbox_v2_source_thread_bindings (
      tenant_id, id, external_thread_id, source_connection_id,
      source_account_id, created_at
    ) values (
      'tenant:src006-batch', 'source_thread_binding:src006-batch',
      'external_thread:src006-batch', 'source_connection:src006-batch',
      'source_account:src006-batch',
      '2026-07-17T01:00:00.000Z'::timestamptz
    );

    insert into public.normalized_inbound_events (
      id, tenant_id, raw_event_id, source_connection_id, source_account_id,
      source_type, source_name, event_type, direction, visibility,
      idempotency_key, created_at, updated_at
    ) values
      (
        'normalized_inbound_event:src006-advance-1', 'tenant:src006-batch',
        'raw_inbound_event:src006-advance-1',
        'source_connection:src006-batch', 'source_account:src006-batch',
        'synthetic', 'src006', 'message_edit', 'outbound', 'private',
        'src006-advance-1', '2026-07-17T01:00:00.000Z'::timestamptz,
        '2026-07-17T01:00:00.000Z'::timestamptz
      ),
      (
        'normalized_inbound_event:src006-advance-2', 'tenant:src006-batch',
        'raw_inbound_event:src006-advance-2',
        'source_connection:src006-batch', 'source_account:src006-batch',
        'synthetic', 'src006', 'message_edit', 'outbound', 'private',
        'src006-advance-2', '2026-07-17T01:00:00.000Z'::timestamptz,
        '2026-07-17T01:00:00.000Z'::timestamptz
      );

    insert into public.inbox_v2_messages (
      tenant_id, id, conversation_id, timeline_item_id,
      author_participant_id, origin_kind, creation_attribution_id,
      content_id, content_revision, content_state, reference_kind, lifecycle,
      revision, last_changed_stream_position, created_at, updated_at
    ) values (
      'tenant:src006-batch', 'message:src006-batch',
      'conversation:src006-batch', 'timeline_item:src006-batch',
      'conversation_participant:src006-batch', 'internal',
      'action_attribution:src006-batch', 'timeline_content:src006-batch',
      1, 'available', 'none', 'active', 1, 1,
      '2026-07-17T01:00:00.000Z'::timestamptz,
      '2026-07-17T01:00:00.000Z'::timestamptz
    )
  `;
}

function pendingOccurrenceFixtureInsertSql() {
  const occurrences = [1, 2]
    .map(
      (ordinal) => `(
        'tenant:src006-batch', 'source_occurrence:src006-advance-${ordinal}',
        'conversation:src006-batch', 'external_thread:src006-batch', 1,
        'source_connection:src006-batch', 'source_account:src006-batch',
        'source_thread_binding:src006-batch', 1, 1, 1, 1,
        '${"7".repeat(64)}', 'core:provider_message', 'v1', 'v1',
        'provider_thread', 'core:message', 'provider-message-src006-batch',
        'module:synthetic:contract', 'v1', 1, 'module:synthetic:surface',
        'core:source_runtime', '2026-07-17T01:00:00.000Z'::timestamptz,
        'authoritative', 'provider_echo',
        'raw_inbound_event:src006-advance-${ordinal}',
        'normalized_inbound_event:src006-advance-${ordinal}', 'outbound',
        'core:source_occurrence_descriptor', 'v1', 1, 1,
        '${"8".repeat(64)}', 0, 'external_thread', 'authoritative',
        'pending', 0, 'core:source_reference_pending', true,
        'correlation:src006-advance-${ordinal}', 'core:source_runtime',
        'materialization:src006-batch-${ordinal}',
        '2026-07-17T01:00:00.000Z'::timestamptz,
        '2026-07-17T01:00:00.000Z'::timestamptz, 1,
        '2026-07-17T01:00:00.000Z'::timestamptz,
        '2026-07-17T01:00:00.000Z'::timestamptz
      )`
    )
    .join(",\n");
  const references = [1, 2]
    .map(
      (ordinal) => `(
        'tenant:src006-batch',
        'source_occurrence:src006-advance-${ordinal}', 0,
        'core:provider_message_id', 'provider-message-src006-batch'
      )`
    )
    .join(",\n");
  return `
    insert into public.inbox_v2_source_occurrences (
      tenant_id, id, conversation_id, external_thread_id,
      external_thread_revision, source_connection_id, source_account_id,
      source_thread_binding_id, binding_revision, binding_generation,
      account_identity_revision, account_generation,
      account_canonical_key_digest_sha256, message_realm_id,
      message_realm_version, message_canonicalization_version,
      message_scope_kind, message_object_kind_id, canonical_external_subject,
      adapter_contract_id, adapter_contract_version,
      adapter_declaration_revision, adapter_surface_id,
      adapter_loaded_by_trusted_service_id, adapter_loaded_at,
      message_decision_strength, origin_kind, raw_inbound_event_id,
      normalized_inbound_event_id, direction, descriptor_schema_id,
      descriptor_version, capability_revision, provider_reference_count,
      descriptor_digest_sha256, provider_timestamp_count,
      reference_portability_kind, reference_portability_decision_strength,
      resolution_state, resolution_candidate_count,
      resolution_diagnostic_code_id, resolution_diagnostic_retryable,
      resolution_diagnostic_correlation_token,
      materialized_by_trusted_service_id, materialization_authorization_token,
      observed_at, recorded_at, revision, created_at, updated_at
    ) values ${occurrences};

    insert into public.inbox_v2_source_occurrence_provider_references (
      tenant_id, source_occurrence_id, ordinal, kind_id, subject
    ) values ${references}
  `;
}

function advanceActionFixtureInsertSql(
  proofPositionOverride = null,
  tamperOccurrenceSnapshot = false
) {
  const keyDetail = JSON.stringify({
    realm: {
      realmId: "core:provider_message",
      realmVersion: "v1",
      canonicalizationVersion: "v1"
    },
    scope: { kind: "provider_thread" },
    objectKindId: "core:message",
    externalThread: {
      kind: "external_thread",
      id: "external_thread:src006-batch"
    },
    canonicalExternalSubject: "provider-message-src006-batch"
  });
  const values = [1, 2]
    .map((ordinal) => {
      const actionId = `deferred_message_source_action:src006-advance-${ordinal}`;
      const occurrenceId = `source_occurrence:src006-advance-${ordinal}`;
      const normalizedEventId = `normalized_inbound_event:src006-advance-${ordinal}`;
      const proofToken = `proof:src006-advance-${ordinal}`;
      const adapterContract = {
        contractId: "module:synthetic:contract",
        contractVersion: "v1",
        declarationRevision: "1",
        surfaceId: "module:synthetic:surface",
        loadedByTrustedServiceId: "core:source_runtime",
        loadedAt: "2026-07-17T01:00:00.000Z"
      };
      const occurrenceDetail = {
        tenantId: "tenant:src006-batch",
        id: occurrenceId,
        messageKey: {
          realm: {
            realmId: "core:provider_message",
            realmVersion: "v1",
            canonicalizationVersion: "v1"
          },
          scope: { kind: "provider_thread" },
          objectKindId: "core:message",
          externalThread: {
            tenantId: "tenant:src006-batch",
            kind: "external_thread",
            id: "external_thread:src006-batch"
          },
          canonicalExternalSubject: "provider-message-src006-batch"
        },
        messageIdentityDeclaration: {
          adapterContract,
          identityKind: "message",
          realmId: "core:provider_message",
          realmVersion: "v1",
          canonicalizationVersion: "v1",
          objectKindId: "core:message",
          scopeKind: "provider_thread",
          decisionStrength: "authoritative"
        },
        bindingContext: {
          externalThread: {
            tenantId: "tenant:src006-batch",
            kind: "external_thread",
            id: "external_thread:src006-batch"
          },
          sourceAccount: {
            tenantId: "tenant:src006-batch",
            kind: "source_account",
            id: "source_account:src006-batch"
          },
          sourceThreadBinding: {
            tenantId: "tenant:src006-batch",
            kind: "source_thread_binding",
            id: "source_thread_binding:src006-batch"
          },
          bindingGeneration: "1"
        },
        origin: {
          kind: "provider_echo",
          sourceAccount: {
            tenantId: "tenant:src006-batch",
            kind: "source_account",
            id: "source_account:src006-batch"
          },
          rawInboundEvent: {
            tenantId: "tenant:src006-batch",
            kind: "raw_inbound_event",
            id: `raw_inbound_event:src006-advance-${ordinal}`
          },
          normalizedInboundEvent: {
            tenantId: "tenant:src006-batch",
            kind: "normalized_inbound_event",
            id: normalizedEventId
          }
        },
        descriptor: {
          adapterContract,
          descriptorSchemaId: "core:source_occurrence_descriptor",
          descriptorVersion: "v1",
          capabilityRevision: "1",
          providerReferences: [
            {
              kindId: "core:provider_message_id",
              subject: "provider-message-src006-batch"
            }
          ],
          descriptorDigestSha256: "8".repeat(64)
        },
        providerActor: null,
        direction: "outbound",
        providerTimestamps: [],
        referencePortability: {
          kind: "external_thread",
          adapterContract,
          decisionStrength: "authoritative"
        },
        resolution: {
          state: "pending",
          diagnostic: {
            codeId: "core:source_reference_pending",
            retryable: !tamperOccurrenceSnapshot,
            correlationToken: `correlation:src006-advance-${ordinal}`,
            safeOperatorHintId: null
          }
        },
        observedAt: "2026-07-17T01:00:00.000Z",
        recordedAt: "2026-07-17T01:00:00.000Z",
        revision: "1",
        createdAt: "2026-07-17T01:00:00.000Z",
        updatedAt: "2026-07-17T01:00:00.000Z"
      };
      const actionDetail = JSON.stringify({
        kind: "edit",
        normalizedEvent: { id: normalizedEventId }
      });
      const semanticProofDetail = JSON.stringify({
        tenantId: "tenant:src006-batch",
        normalizedInboundEvent: {
          tenantId: "tenant:src006-batch",
          kind: "normalized_inbound_event",
          id: normalizedEventId
        },
        externalMessageReference: null,
        sourceOccurrence: null,
        sourceAccount: {
          tenantId: "tenant:src006-batch",
          kind: "source_account",
          id: "source_account:src006-batch"
        },
        sourceThreadBinding: {
          tenantId: "tenant:src006-batch",
          kind: "source_thread_binding",
          id: "source_thread_binding:src006-batch"
        },
        bindingGeneration: "1",
        adapterContract: {
          contractId: "module:synthetic:contract",
          contractVersion: "v1",
          declarationRevision: "1",
          surfaceId: "module:synthetic:surface",
          loadedByTrustedServiceId: "core:source_runtime",
          loadedAt: "2026-07-17T01:00:00.000Z"
        },
        capabilityId: "core:message_edit",
        capabilityRevision: "1",
        semanticId: "core:message.lifecycle.edit.observed",
        semanticRevision: "1",
        actor: null,
        proofToken,
        ordering: {
          kind: "monotonic_exact",
          scopeToken: "scope:src006-batch",
          position: proofPositionOverride ?? `${ordinal}0`,
          comparatorId: "core:provider_ordering.synthetic",
          comparatorRevision: "1"
        },
        declaredByTrustedServiceId: "core:source_runtime",
        occurredAt: "2026-07-17T01:00:00.000Z",
        recordedAt: "2026-07-17T01:00:00.000Z",
        revision: "1"
      });
      return `(
        'tenant:src006-batch', '${actionId}',
        'core:provider_message', 'v1', 'v1', 'provider_thread',
        'core:message', 'external_thread:src006-batch',
        'provider-message-src006-batch', '${keyDetail}'::jsonb,
        'sha256:${"1".repeat(64)}', '${occurrenceId}', 1,
        '${JSON.stringify(occurrenceDetail)}'::jsonb,
        'sha256:${"2".repeat(64)}',
        '${normalizedEventId}', 'edit', 'message_lifecycle',
        '${actionDetail}'::jsonb, 'sha256:${"3".repeat(64)}',
        'source_account:src006-batch', 'source_thread_binding:src006-batch', 1,
        'module:synthetic:contract', 'v1', 1, 'module:synthetic:surface',
        'core:source_runtime', '2026-07-17T01:00:00.000Z'::timestamptz,
        'core:message_edit', 1, 'core:message.lifecycle.edit.observed', 1,
        'monotonic_exact', 'scope:src006-batch', '${ordinal}0',
        'core:provider_ordering.synthetic', 1, 'core:source_runtime',
        '${proofToken}', '${semanticProofDetail}'::jsonb,
        'sha256:${"4".repeat(64)}', '${(ordinal === 1 ? "a" : "b").repeat(64)}',
        '2026-07-17T01:00:00.000Z'::timestamptz,
        '2026-07-17T01:00:00.000Z'::timestamptz,
        '2026-07-17T01:00:00.000Z'::timestamptz,
        '2026-07-17T01:00:00.000Z'::timestamptz
      )`;
    })
    .join(",\n");
  return `
    insert into public.inbox_v2_deferred_message_source_actions (
      tenant_id, id, message_realm_id, message_realm_version,
      message_canonicalization_version, message_scope_kind,
      message_object_kind_id, external_thread_id,
      canonical_external_subject, external_message_key_detail,
      external_message_key_detail_digest_sha256, source_occurrence_id,
      source_occurrence_revision, source_occurrence_detail,
      source_occurrence_detail_digest_sha256, normalized_inbound_event_id,
      action_kind, lane, action_detail, action_detail_digest_sha256,
      source_account_id, source_thread_binding_id, binding_generation,
      adapter_contract_id, adapter_contract_version,
      adapter_declaration_revision, adapter_surface_id,
      adapter_loaded_by_trusted_service_id, adapter_loaded_at,
      capability_id, capability_revision, semantic_id, semantic_revision,
      ordering_kind, ordering_scope_token, ordering_position,
      ordering_comparator_id, ordering_comparator_revision,
      declared_by_trusted_service_id, semantic_proof_token,
      semantic_proof_detail, semantic_proof_detail_digest_sha256,
      event_fingerprint_sha256, observed_at, recorded_at, created_at, updated_at
    ) values ${values}
  `;
}

function advanceBatchResolutionFixtureInsertSql() {
  const referenceDeclaration = JSON.stringify({
    adapterContract: {
      contractId: "module:synthetic:contract",
      contractVersion: "v1",
      declarationRevision: "1",
      surfaceId: "module:synthetic:surface",
      loadedByTrustedServiceId: "core:source_runtime",
      loadedAt: "2026-07-17T01:00:00.000Z"
    },
    identityKind: "message",
    realmId: "core:provider_message",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "core:message",
    scopeKind: "provider_thread",
    decisionStrength: "authoritative"
  });
  const occurrences = [1, 2]
    .map(
      (ordinal) => `(
        'tenant:src006-batch', 'source_occurrence:src006-advance-${ordinal}',
        'conversation:src006-batch', 'external_thread:src006-batch', 1,
        'source_connection:src006-batch', 'source_account:src006-batch',
        'source_thread_binding:src006-batch', 1, 1, 1, 1,
        '${"7".repeat(64)}', 'core:provider_message', 'v1', 'v1',
        'provider_thread', 'core:message', 'provider-message-src006-batch',
        'module:synthetic:contract', 'v1', 1, 'module:synthetic:surface',
        'core:source_runtime', '2026-07-17T01:00:00.000Z'::timestamptz,
        'authoritative', 'provider_response',
        'outbound_dispatch_attempt:src006-${ordinal}', 'outbound',
        'core:source_occurrence_descriptor', 'v1', 1, 1,
        '${"8".repeat(64)}', 0, 'external_thread', 'authoritative',
        'resolved', 'external_message_reference:src006-batch', 0,
        'core:source_runtime', 'materialization:src006-batch-${ordinal}',
        '2026-07-17T01:00:00.000Z'::timestamptz,
        '2026-07-17T01:00:00.000Z'::timestamptz, 2,
        '2026-07-17T01:00:00.000Z'::timestamptz,
        '2026-07-17T01:00:00.000Z'::timestamptz
      )`
    )
    .join(",\n");
  return `
    insert into public.inbox_v2_external_message_references (
      tenant_id, id, realm_id, realm_version, canonicalization_version,
      scope_kind, object_kind_id, canonical_external_subject,
      message_key_digest_sha256, identity_declaration, external_thread_id,
      external_thread_revision, conversation_id, timeline_item_id, message_id,
      revision, created_at
    )
    select tenant_id, 'external_message_reference:src006-batch',
           message_realm_id, message_realm_version,
           message_canonicalization_version, message_scope_kind,
           message_object_kind_id, canonical_external_subject,
           message_key_digest_sha256, '${referenceDeclaration}'::jsonb,
           external_thread_id, 1, 'conversation:src006-batch',
           'timeline_item:src006-batch', 'message:src006-batch', 1,
           '2026-07-17T01:00:00.000Z'::timestamptz
      from public.inbox_v2_deferred_message_source_actions
     where tenant_id = 'tenant:src006-batch'
       and id = 'deferred_message_source_action:src006-advance-1';

    insert into public.inbox_v2_source_occurrences (
      tenant_id, id, conversation_id, external_thread_id,
      external_thread_revision, source_connection_id, source_account_id,
      source_thread_binding_id, binding_revision, binding_generation,
      account_identity_revision, account_generation,
      account_canonical_key_digest_sha256, message_realm_id,
      message_realm_version, message_canonicalization_version,
      message_scope_kind, message_object_kind_id, canonical_external_subject,
      adapter_contract_id, adapter_contract_version,
      adapter_declaration_revision, adapter_surface_id,
      adapter_loaded_by_trusted_service_id, adapter_loaded_at,
      message_decision_strength, origin_kind, outbound_dispatch_attempt_id,
      direction, descriptor_schema_id, descriptor_version,
      capability_revision, provider_reference_count, descriptor_digest_sha256,
      provider_timestamp_count, reference_portability_kind,
      reference_portability_decision_strength, resolution_state,
      resolved_external_message_reference_id, resolution_candidate_count,
      materialized_by_trusted_service_id, materialization_authorization_token,
      observed_at, recorded_at, revision, created_at, updated_at
    ) values ${occurrences}
  `;
}

function advanceTransitionInsertSql(ordinal) {
  const expectedHeadRevision = ordinal === 1 ? "null" : "1";
  const recordedAt = `2026-07-17T01:00:0${ordinal}.000Z`;
  const actionId = `deferred_message_source_action:src006-advance-${ordinal}`;
  const transitionDetail = JSON.stringify({
    action: { id: actionId },
    expectedRevision: "1",
    resultingRevision: "2",
    afterState: { state: "applied" },
    orderingOutcome: "advance"
  });
  return `
    insert into public.inbox_v2_deferred_message_source_action_transitions (
      tenant_id, action_id, expected_revision, resulting_revision,
      after_state, ordering_outcome, expected_ordering_head_revision,
      resulting_ordering_head_revision, ordering_head_scope_token,
      ordering_head_comparator_id, ordering_head_comparator_revision,
      target_external_message_reference_id, target_message_id,
      applied_message_revision, effect_kind,
      source_occurrence_expected_revision,
      source_occurrence_resulting_revision,
      source_occurrence_resolution_digest_sha256,
      effect_proof_digest_sha256,
      transition_detail, transition_detail_digest_sha256,
      commit_digest_sha256, recorded_at
    ) values (
      'tenant:src006-batch', '${actionId}', 1, 2, 'applied', 'advance',
      ${expectedHeadRevision}, ${ordinal}, 'scope:src006-batch',
      'core:provider_ordering.synthetic', 1,
      'external_message_reference:src006-batch', 'message:src006-batch',
      1, 'message_lifecycle', 1, 2, 'sha256:${"9".repeat(64)}',
      'sha256:${"a".repeat(64)}', '${transitionDetail}'::jsonb,
      'sha256:${"5".repeat(64)}', 'sha256:${"6".repeat(64)}',
      '${recordedAt}'::timestamptz
    )
  `;
}

function advanceActionTerminalUpdateSql(ordinal) {
  const recordedAt = `2026-07-17T01:00:0${ordinal}.000Z`;
  return `
    update public.inbox_v2_deferred_message_source_actions
       set state = 'applied',
           applied_external_message_reference_id =
             'external_message_reference:src006-batch',
           applied_message_id = 'message:src006-batch',
           applied_message_revision = 1,
           effect_kind = 'message_lifecycle', revision = 2,
           terminal_at = '${recordedAt}'::timestamptz,
           updated_at = '${recordedAt}'::timestamptz
     where tenant_id = 'tenant:src006-batch'
       and id = 'deferred_message_source_action:src006-advance-${ordinal}'
  `;
}

function advanceOrderingHeadInsertSql() {
  const keyDetail = JSON.stringify({
    realm: {
      realmId: "core:provider_message",
      realmVersion: "v1",
      canonicalizationVersion: "v1"
    },
    scope: { kind: "provider_thread" },
    objectKindId: "core:message",
    externalThread: {
      kind: "external_thread",
      id: "external_thread:src006-batch"
    },
    canonicalExternalSubject: "provider-message-src006-batch"
  });
  return `
    insert into public.inbox_v2_deferred_source_action_ordering_heads (
      tenant_id, message_realm_id, message_realm_version,
      message_canonicalization_version, message_scope_kind,
      message_object_kind_id, external_thread_id, canonical_external_subject,
      external_message_key_detail, external_message_key_detail_digest_sha256,
      lane, scope_token, comparator_id, comparator_revision,
      latest_action_id, latest_normalized_inbound_event_id,
      latest_source_occurrence_id, latest_semantic_id,
      latest_event_fingerprint_sha256, latest_position,
      revision, created_at, updated_at
    ) values (
      'tenant:src006-batch', 'core:provider_message', 'v1', 'v1',
      'provider_thread', 'core:message', 'external_thread:src006-batch',
      'provider-message-src006-batch', '${keyDetail}'::jsonb,
      'sha256:${"1".repeat(64)}', 'message_lifecycle', 'scope:src006-batch',
      'core:provider_ordering.synthetic', 1,
      'deferred_message_source_action:src006-advance-1',
      'normalized_inbound_event:src006-advance-1',
      'source_occurrence:src006-advance-1',
      'core:message.lifecycle.edit.observed', '${"a".repeat(64)}', '10', 1,
      '2026-07-17T01:00:01.000Z'::timestamptz,
      '2026-07-17T01:00:01.000Z'::timestamptz
    )
  `;
}

function advanceOrderingHeadUpdateSql() {
  return `
    update public.inbox_v2_deferred_source_action_ordering_heads
       set latest_action_id =
             'deferred_message_source_action:src006-advance-2',
           latest_normalized_inbound_event_id =
             'normalized_inbound_event:src006-advance-2',
           latest_source_occurrence_id =
             'source_occurrence:src006-advance-2',
           latest_semantic_id = 'core:message.lifecycle.edit.observed',
           latest_event_fingerprint_sha256 = '${"b".repeat(64)}',
           latest_position = '20', revision = 2,
           updated_at = '2026-07-17T01:00:02.000Z'::timestamptz
     where tenant_id = 'tenant:src006-batch'
  `;
}

async function prepareMigrationDirectory(temporaryRoot) {
  const directory = join(temporaryRoot, `through-${migrationIndex}`);
  const metadataDirectory = join(directory, "meta");
  await mkdir(metadataDirectory, { recursive: true });
  const journal = JSON.parse(
    await readFile(
      join(checkedInMigrationsDirectory, "meta/_journal.json"),
      "utf8"
    )
  );
  const boundedJournal = migrationJournal(journal, migrationIndex);
  await Promise.all([
    writeFile(
      join(metadataDirectory, "_journal.json"),
      `${JSON.stringify(boundedJournal, null, 2)}\n`,
      "utf8"
    ),
    ...boundedJournal.entries.map(({ tag }) =>
      copyFile(
        join(checkedInMigrationsDirectory, `${tag}.sql`),
        join(directory, `${tag}.sql`)
      )
    )
  ]);
  return directory;
}

async function applyMigrations(databaseUrl, migrationsDirectory) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: migrationsDirectory });
  } finally {
    await pool.end();
  }
}

async function withClient(databaseUrl, callback) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

async function captureDatabaseError(promise) {
  try {
    await promise;
    return null;
  } catch (error) {
    return findDatabaseError(error);
  }
}

function findDatabaseError(error) {
  let current = error;
  while (current && typeof current === "object") {
    if (typeof current.code === "string") return current;
    current = current.cause;
  }
  return null;
}

function quoteDatabaseName(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}
