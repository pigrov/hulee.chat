import {
  inboxV2SourceOccurrenceIdSchema,
  inboxV2SourceOccurrenceMaterializationCommitSchema,
  inboxV2SourceOccurrenceSchema,
  inboxV2TenantIdSchema,
  inboxV2TimestampSchema,
  type InboxV2SourceAccountId,
  type InboxV2SourceExternalIdentityId,
  type InboxV2SourceOccurrence,
  type InboxV2SourceOccurrenceId,
  type InboxV2SourceOccurrenceMaterializationCommit,
  type InboxV2TenantId
} from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import { sql, type SQL } from "drizzle-orm";
import { createHash } from "node:crypto";

import type { HuleeDatabase } from "../client";
import { InboxV2PersistenceInvariantError } from "./sql-inbox-v2-conversation-repository";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

const OCCURRENCE_TRANSACTION_CONFIG = {
  isolationLevel: "read committed"
} as const;
const OCCURRENCE_SNAPSHOT_TRANSACTION_CONFIG = {
  isolationLevel: "repeatable read"
} as const;
const OCCURRENCE_TRANSACTION_ATTEMPTS = 3;
const RETRYABLE_SQLSTATES = new Set(["40001", "40P01"]);
const SUPPORTED_ORIGIN_KINDS = new Set([
  "webhook",
  "stream",
  "poll",
  "history",
  "provider_echo",
  "provider_response"
]);

export type MaterializeInboxV2SourceOccurrenceResult =
  | Readonly<{
      kind: "materialized" | "already_materialized";
      occurrence: InboxV2SourceOccurrence;
    }>
  | Readonly<{
      kind: "occurrence_id_conflict";
      occurrenceId: InboxV2SourceOccurrenceId;
    }>
  | Readonly<{
      kind: "evidence_not_found";
      evidenceKind: "raw_inbound_event" | "normalized_inbound_event";
    }>
  | Readonly<{
      kind: "evidence_scope_conflict" | "evidence_pair_conflict";
      evidenceKind: "raw_inbound_event" | "normalized_inbound_event";
    }>
  | Readonly<{
      kind: "external_thread_not_found" | "thread_mapping_conflict";
    }>
  | Readonly<{
      kind:
        | "account_identity_not_found"
        | "account_identity_state_conflict"
        | "account_identity_snapshot_conflict";
      sourceAccountId: InboxV2SourceAccountId;
    }>
  | Readonly<{
      kind:
        | "binding_not_found"
        | "binding_snapshot_conflict"
        | "adapter_surface_conflict"
        | "capability_revision_conflict";
    }>
  | Readonly<{
      kind:
        | "provider_actor_not_found"
        | "provider_actor_scope_conflict"
        | "provider_actor_adapter_surface_conflict";
      sourceExternalIdentityId: InboxV2SourceExternalIdentityId;
    }>
  | Readonly<{
      kind: "outbound_attempt_not_found" | "outbound_proof_conflict";
    }>;

export type InboxV2SourceOccurrenceTransactionExecutor = RawSqlExecutor & {
  transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>,
    config: Readonly<{
      isolationLevel: "read committed" | "repeatable read";
    }>
  ): Promise<TResult>;
};

export type InboxV2SourceOccurrenceRepository = Readonly<{
  findOccurrence(input: {
    tenantId: InboxV2TenantId;
    occurrenceId: InboxV2SourceOccurrenceId;
  }): Promise<InboxV2SourceOccurrence | null>;
  materialize(
    input: InboxV2SourceOccurrenceMaterializationCommit
  ): Promise<MaterializeInboxV2SourceOccurrenceResult>;
}>;

type IdRow = { id: unknown };
type RawEventLockRow = {
  id: unknown;
  source_connection_id: unknown;
  source_account_id: unknown;
  evidence_at: unknown;
};
type NormalizedEventLockRow = RawEventLockRow & { raw_event_id: unknown };
type ExternalThreadLockRow = {
  id: unknown;
  conversation_id: unknown;
  revision: unknown;
  identity_declaration: unknown;
  created_at: unknown;
};
type AccountIdentityLockRow = {
  source_account_id: unknown;
  source_connection_id: unknown;
  state: unknown;
  revision: unknown;
  account_generation: unknown;
  canonical_key_digest_sha256: unknown;
  canonical_realm_id: unknown;
  canonical_realm_version: unknown;
  canonicalization_version: unknown;
  canonical_object_kind_id: unknown;
  canonical_scope_kind: unknown;
  canonical_scope_source_connection_id: unknown;
  canonical_external_subject: unknown;
  identity_declaration: unknown;
  updated_at: unknown;
};
type BindingLockRow = {
  binding_id: unknown;
  external_thread_id: unknown;
  source_connection_id: unknown;
  source_account_id: unknown;
  binding_revision: unknown;
  binding_generation: unknown;
  account_identity_revision: unknown;
  account_generation: unknown;
  account_identity_state: unknown;
  account_canonical_key_digest_sha256: unknown;
  capability_contract_id: unknown;
  capability_contract_version: unknown;
  capability_declaration_revision: unknown;
  capability_surface_id: unknown;
  capability_loaded_by_trusted_service_id: unknown;
  capability_loaded_at: unknown;
  capability_revision: unknown;
  created_at: unknown;
  updated_at: unknown;
  snapshot_binding_id: unknown;
  snapshot_external_thread_id: unknown;
  snapshot_source_connection_id: unknown;
  snapshot_source_account_id: unknown;
  snapshot_revision: unknown;
  snapshot_binding_generation: unknown;
  snapshot_account_identity_revision: unknown;
  snapshot_account_generation: unknown;
  snapshot_account_identity_state: unknown;
  snapshot_account_canonical_key_digest_sha256: unknown;
  snapshot_capability_contract_id: unknown;
  snapshot_capability_contract_version: unknown;
  snapshot_capability_declaration_revision: unknown;
  snapshot_capability_surface_id: unknown;
  snapshot_capability_loaded_by_trusted_service_id: unknown;
  snapshot_capability_loaded_at: unknown;
  snapshot_capability_revision: unknown;
  snapshot_created_at: unknown;
  snapshot_updated_at: unknown;
};
type ProviderActorLockRow = {
  id: unknown;
  scope_kind: unknown;
  scope_source_connection_id: unknown;
  scope_source_account_id: unknown;
  stability_kind: unknown;
  ephemeral_raw_inbound_event_id: unknown;
  ephemeral_normalized_inbound_event_id: unknown;
  declaration_contract_id: unknown;
  declaration_contract_version: unknown;
  declaration_surface_id: unknown;
  declaration_loaded_by_trusted_service_id: unknown;
  declaration_loaded_at: unknown;
  materialized_at: unknown;
  created_at: unknown;
};
type ExistingOccurrenceRow = Record<string, unknown>;
type ProviderReferenceRow = {
  ordinal: unknown;
  kind_id: unknown;
  subject: unknown;
};
type ProviderTimestampRow = {
  ordinal: unknown;
  kind_id: unknown;
  provider_timestamp: unknown;
};
type ResolutionCandidateRow = {
  ordinal: unknown;
  external_message_reference_id: unknown;
};

type LoadedOccurrenceAggregateRows = Readonly<{
  row: ExistingOccurrenceRow;
  references: readonly ProviderReferenceRow[];
  timestamps: readonly ProviderTimestampRow[];
  resolutionCandidates: readonly ResolutionCandidateRow[];
}>;

type NormalizedCommit = InboxV2SourceOccurrenceMaterializationCommit & {
  bindingMaterialization: Extract<
    InboxV2SourceOccurrenceMaterializationCommit["bindingMaterialization"],
    { kind: "existing" }
  >;
  occurrence: InboxV2SourceOccurrence & {
    resolution: Extract<
      InboxV2SourceOccurrence["resolution"],
      { state: "pending" }
    >;
  };
};

type EventBackedCommit = NormalizedCommit & {
  occurrence: NormalizedCommit["occurrence"] & {
    origin: Exclude<
      InboxV2SourceOccurrence["origin"],
      { kind: "provider_response" }
    >;
  };
};

type ProviderResponseCommit = NormalizedCommit & {
  occurrence: NormalizedCommit["occurrence"] & {
    origin: Extract<
      InboxV2SourceOccurrence["origin"],
      { kind: "provider_response" }
    >;
  };
};

type PersistenceRecord = ReturnType<typeof toPersistenceRecord>;

export function createSqlInboxV2SourceOccurrenceRepository(
  executor: InboxV2SourceOccurrenceTransactionExecutor | HuleeDatabase
): InboxV2SourceOccurrenceRepository {
  const transactionExecutor =
    executor as unknown as InboxV2SourceOccurrenceTransactionExecutor;

  return {
    async findOccurrence(input) {
      const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
      const occurrenceId = inboxV2SourceOccurrenceIdSchema.parse(
        input.occurrenceId
      );
      return runOccurrenceSnapshotTransaction(
        transactionExecutor,
        async (transaction) => {
          const aggregate = await loadOccurrenceAggregateRows(transaction, {
            tenantId,
            occurrenceId
          });
          return aggregate === null
            ? null
            : mapSourceOccurrenceAggregate(aggregate, tenantId);
        }
      );
    },

    async materialize(input) {
      const commit = normalizeMaterializationCommit(input);

      const existingBeforeTransaction = await loadExistingOccurrence(
        transactionExecutor,
        commit
      );
      if (existingBeforeTransaction !== null) {
        return existingBeforeTransaction;
      }

      return runOccurrenceTransaction(
        transactionExecutor,
        async (transaction) => {
          // Keep the same lock order as the database insert guard and binding
          // transition writers. Reversing head/identity/thread locks would make
          // an otherwise bounded materialization prone to avoidable deadlocks.
          const binding = await lockBinding(transaction, commit);
          if (binding === null) return { kind: "binding_not_found" } as const;

          const identity = await lockAccountIdentity(transaction, commit);
          if (identity === null) {
            return {
              kind: "account_identity_not_found",
              sourceAccountId: commit.sourceAccountIdentity.sourceAccount.id
            } as const;
          }
          if (identity.state !== "verified") {
            return {
              kind: "account_identity_state_conflict",
              sourceAccountId: commit.sourceAccountIdentity.sourceAccount.id
            } as const;
          }
          if (!accountIdentityMatchesCommit(identity, commit)) {
            return {
              kind: "account_identity_snapshot_conflict",
              sourceAccountId: commit.sourceAccountIdentity.sourceAccount.id
            } as const;
          }

          const bindingMismatch = classifyBindingMismatch(
            binding,
            commit,
            identity
          );
          if (bindingMismatch !== null)
            return { kind: bindingMismatch } as const;

          const thread = await lockExternalThread(transaction, commit);
          if (thread === null)
            return { kind: "external_thread_not_found" } as const;
          if (!threadMatchesCommit(thread, commit)) {
            return { kind: "thread_mapping_conflict" } as const;
          }

          if (isEventBackedCommit(commit)) {
            const raw = await lockRawEvent(transaction, commit);
            if (raw === null) {
              return {
                kind: "evidence_not_found",
                evidenceKind: "raw_inbound_event"
              } as const;
            }
            if (!eventScopeMatches(raw, commit)) {
              return {
                kind: "evidence_scope_conflict",
                evidenceKind: "raw_inbound_event"
              } as const;
            }

            const normalizedEvent = await lockNormalizedEvent(
              transaction,
              commit
            );
            if (normalizedEvent === null) {
              return {
                kind: "evidence_not_found",
                evidenceKind: "normalized_inbound_event"
              } as const;
            }
            if (!eventScopeMatches(normalizedEvent, commit)) {
              return {
                kind: "evidence_scope_conflict",
                evidenceKind: "normalized_inbound_event"
              } as const;
            }
            if (String(normalizedEvent.raw_event_id) !== String(raw.id)) {
              return {
                kind: "evidence_pair_conflict",
                evidenceKind: "normalized_inbound_event"
              } as const;
            }
          } else if (isProviderResponseCommit(commit)) {
            const outboundMismatch = await validateOutboundProof(
              transaction,
              commit
            );
            if (outboundMismatch !== null) return outboundMismatch;
          } else {
            throw invariantError("Unsupported SourceOccurrence origin branch.");
          }

          const actorMismatch = await validateProviderActor(
            transaction,
            commit
          );
          if (actorMismatch !== null) return actorMismatch;

          const persistence = toPersistenceRecord(
            commit,
            String(identity.canonical_key_digest_sha256)
          );
          const inserted = await transaction.execute<IdRow>(
            buildInsertInboxV2SourceOccurrenceSql(persistence)
          );
          if (inserted.rows.length > 1) {
            throw invariantError(
              "SourceOccurrence insert returned more than one row."
            );
          }
          if (inserted.rows.length === 0) {
            const concurrent = await loadExistingOccurrence(
              transaction,
              commit
            );
            if (concurrent === null) {
              throw invariantError(
                "SourceOccurrence insert conflicted, but the existing aggregate is missing."
              );
            }
            return concurrent;
          }

          for (const [
            ordinal,
            reference
          ] of commit.occurrence.descriptor.providerReferences.entries()) {
            await requireSingleInsert(
              transaction,
              buildInsertInboxV2SourceOccurrenceProviderReferenceSql({
                tenantId: commit.tenantId,
                occurrenceId: commit.occurrence.id,
                ordinal,
                kindId: reference.kindId,
                subject: reference.subject
              }),
              "SourceOccurrence provider reference insert"
            );
          }
          for (const [
            ordinal,
            providerTimestamp
          ] of commit.occurrence.providerTimestamps.entries()) {
            await requireSingleInsert(
              transaction,
              buildInsertInboxV2SourceOccurrenceProviderTimestampSql({
                tenantId: commit.tenantId,
                occurrenceId: commit.occurrence.id,
                ordinal,
                kindId: providerTimestamp.kindId,
                timestamp: providerTimestamp.timestamp
              }),
              "SourceOccurrence provider timestamp insert"
            );
          }

          return {
            kind: "materialized",
            occurrence: commit.occurrence
          } as const;
        }
      );
    }
  };
}

function normalizeMaterializationCommit(
  input: InboxV2SourceOccurrenceMaterializationCommit
): NormalizedCommit {
  const commit =
    inboxV2SourceOccurrenceMaterializationCommitSchema.parse(input);
  const origin = commit.occurrence.origin;

  if (commit.bindingMaterialization.kind !== "existing") {
    throw unsupported(
      "SourceOccurrence repository does not create SourceThreadBindings."
    );
  }
  if (!SUPPORTED_ORIGIN_KINDS.has(origin.kind)) {
    throw unsupported("Unsupported SourceOccurrence origin kind.");
  }
  if (
    commit.occurrence.resolution.state !== "pending" ||
    commit.occurrence.revision !== "1"
  ) {
    throw unsupported(
      "SourceOccurrence repository accepts only initial pending revision-1 observations."
    );
  }

  return commit as NormalizedCommit;
}

export function buildLockInboxV2SourceOccurrenceBindingSql(
  commit: NormalizedCommit
): SQL {
  const binding = commit.bindingMaterialization.currentProjection.binding;
  return sql`
    with head as materialized (
      select candidate.*
      from inbox_v2_source_thread_binding_heads candidate
      where candidate.tenant_id = ${commit.tenantId}
        and candidate.binding_id = ${binding.id}
      for share
    )
    select
      head.binding_id,
      head.external_thread_id,
      head.source_connection_id,
      head.source_account_id,
      head.revision as binding_revision,
      head.binding_generation,
      head.account_identity_revision,
      head.account_generation,
      head.account_identity_state,
      head.account_canonical_key_digest_sha256,
      head.capability_contract_id,
      head.capability_contract_version,
      head.capability_declaration_revision,
      head.capability_surface_id,
      head.capability_loaded_by_trusted_service_id,
      head.capability_loaded_at,
      head.capability_revision,
      head.created_at,
      head.updated_at,
      snapshot.binding_id as snapshot_binding_id,
      snapshot.external_thread_id as snapshot_external_thread_id,
      snapshot.source_connection_id as snapshot_source_connection_id,
      snapshot.source_account_id as snapshot_source_account_id,
      snapshot.revision as snapshot_revision,
      snapshot.binding_generation as snapshot_binding_generation,
      snapshot.account_identity_revision as snapshot_account_identity_revision,
      snapshot.account_generation as snapshot_account_generation,
      snapshot.account_identity_state as snapshot_account_identity_state,
      snapshot.account_canonical_key_digest_sha256 as snapshot_account_canonical_key_digest_sha256,
      snapshot.capability_contract_id as snapshot_capability_contract_id,
      snapshot.capability_contract_version as snapshot_capability_contract_version,
      snapshot.capability_declaration_revision as snapshot_capability_declaration_revision,
      snapshot.capability_surface_id as snapshot_capability_surface_id,
      snapshot.capability_loaded_by_trusted_service_id as snapshot_capability_loaded_by_trusted_service_id,
      snapshot.capability_loaded_at as snapshot_capability_loaded_at,
      snapshot.capability_revision as snapshot_capability_revision,
      snapshot.created_at as snapshot_created_at,
      snapshot.updated_at as snapshot_updated_at
    from head
    join inbox_v2_source_thread_binding_snapshots snapshot
      on snapshot.tenant_id = head.tenant_id
     and snapshot.binding_id = head.binding_id
     and snapshot.revision = head.revision
    for share of snapshot
  `;
}

export function buildLockInboxV2SourceOccurrenceAccountIdentitySql(
  commit: NormalizedCommit
): SQL {
  return sql`
    select
      source_account_id,
      source_connection_id,
      state,
      revision,
      account_generation,
      canonical_key_digest_sha256,
      canonical_realm_id,
      canonical_realm_version,
      canonicalization_version,
      canonical_object_kind_id,
      canonical_scope_kind,
      canonical_scope_source_connection_id,
      canonical_external_subject,
      identity_declaration,
      updated_at
    from inbox_v2_source_account_identities
    where tenant_id = ${commit.tenantId}
      and source_account_id = ${commit.sourceAccountIdentity.sourceAccount.id}
    for share
  `;
}

export function buildLockInboxV2SourceOccurrenceExternalThreadSql(
  commit: NormalizedCommit
): SQL {
  return sql`
    select id, conversation_id, revision, identity_declaration, created_at
    from inbox_v2_external_threads
    where tenant_id = ${commit.tenantId}
      and id = ${commit.externalThreadMapping.thread.id}
    for share
  `;
}

export function buildLockInboxV2SourceOccurrenceRawEventSql(
  commit: EventBackedCommit
): SQL {
  return sql`
    select id, source_connection_id, source_account_id, received_at as evidence_at
    from raw_inbound_events
    where tenant_id = ${commit.tenantId}
      and id = ${commit.occurrence.origin.rawInboundEvent.id}
    for key share
  `;
}

export function buildLockInboxV2SourceOccurrenceNormalizedEventSql(
  commit: EventBackedCommit
): SQL {
  return sql`
    select id, raw_event_id, source_connection_id, source_account_id, created_at as evidence_at
    from normalized_inbound_events
    where tenant_id = ${commit.tenantId}
      and id = ${commit.occurrence.origin.normalizedInboundEvent.id}
    for key share
  `;
}

export function buildLockInboxV2SourceOccurrenceProviderActorSql(input: {
  tenantId: InboxV2TenantId;
  sourceExternalIdentityId: InboxV2SourceExternalIdentityId;
}): SQL {
  return sql`
    select
      id,
      scope_kind,
      scope_source_connection_id,
      scope_source_account_id,
      stability_kind,
      ephemeral_raw_inbound_event_id,
      ephemeral_normalized_inbound_event_id,
      declaration_contract_id,
      declaration_contract_version,
      declaration_surface_id,
      declaration_loaded_by_trusted_service_id,
      declaration_loaded_at,
      materialized_at,
      created_at
    from inbox_v2_source_external_identities
    where tenant_id = ${input.tenantId}
      and id = ${input.sourceExternalIdentityId}
    for share
  `;
}

export function buildFindInboxV2SourceOccurrenceByIdSql(input: {
  tenantId: InboxV2TenantId;
  occurrenceId: InboxV2SourceOccurrenceId;
}): SQL {
  return sql`
    select *
    from inbox_v2_source_occurrences
    where tenant_id = ${input.tenantId}
      and id = ${input.occurrenceId}
  `;
}

export function buildListInboxV2SourceOccurrenceProviderReferencesSql(input: {
  tenantId: InboxV2TenantId;
  occurrenceId: InboxV2SourceOccurrenceId;
}): SQL {
  return sql`
    select ordinal, kind_id, subject
    from inbox_v2_source_occurrence_provider_references
    where tenant_id = ${input.tenantId}
      and source_occurrence_id = ${input.occurrenceId}
    order by ordinal asc
  `;
}

export function buildListInboxV2SourceOccurrenceProviderTimestampsSql(input: {
  tenantId: InboxV2TenantId;
  occurrenceId: InboxV2SourceOccurrenceId;
}): SQL {
  return sql`
    select ordinal, kind_id, timestamp as provider_timestamp
    from inbox_v2_source_occurrence_provider_timestamps
    where tenant_id = ${input.tenantId}
      and source_occurrence_id = ${input.occurrenceId}
    order by ordinal asc
  `;
}

export function buildListInboxV2SourceOccurrenceResolutionCandidatesSql(input: {
  tenantId: InboxV2TenantId;
  occurrenceId: InboxV2SourceOccurrenceId;
  resultingRevision: string;
}): SQL {
  return sql`
    select ordinal, external_message_reference_id
    from inbox_v2_source_occurrence_resolution_candidates
    where tenant_id = ${input.tenantId}
      and source_occurrence_id = ${input.occurrenceId}
      and resulting_revision = ${input.resultingRevision}
    order by ordinal asc
  `;
}

export function buildInsertInboxV2SourceOccurrenceSql(
  record: PersistenceRecord
): SQL {
  return sql`
    insert into inbox_v2_source_occurrences (
      tenant_id,
      id,
      conversation_id,
      external_thread_id,
      external_thread_revision,
      source_connection_id,
      source_account_id,
      source_thread_binding_id,
      binding_revision,
      binding_generation,
      account_identity_revision,
      account_generation,
      account_canonical_key_digest_sha256,
      message_realm_id,
      message_realm_version,
      message_canonicalization_version,
      message_scope_kind,
      message_scope_source_account_id,
      message_scope_source_thread_binding_id,
      message_object_kind_id,
      canonical_external_subject,
      adapter_contract_id,
      adapter_contract_version,
      adapter_declaration_revision,
      adapter_surface_id,
      adapter_loaded_by_trusted_service_id,
      adapter_loaded_at,
      message_decision_strength,
      origin_kind,
      raw_inbound_event_id,
      normalized_inbound_event_id,
      outbound_dispatch_attempt_id,
      provider_actor_kind,
      provider_actor_source_external_identity_id,
      provider_system_actor_kind_id,
      provider_system_actor_subject,
      direction,
      descriptor_schema_id,
      descriptor_version,
      capability_revision,
      provider_reference_count,
      descriptor_digest_sha256,
      provider_timestamp_count,
      reference_portability_kind,
      reference_portability_decision_strength,
      resolution_state,
      resolved_external_message_reference_id,
      resolution_candidate_count,
      resolution_candidate_digest_sha256,
      resolution_diagnostic_code_id,
      resolution_diagnostic_retryable,
      resolution_diagnostic_correlation_token,
      resolution_diagnostic_safe_operator_hint_id,
      materialized_by_trusted_service_id,
      materialization_authorization_token,
      observed_at,
      recorded_at,
      revision,
      created_at,
      updated_at
    ) values (
      ${record.tenant_id},
      ${record.id},
      ${record.conversation_id},
      ${record.external_thread_id},
      ${record.external_thread_revision},
      ${record.source_connection_id},
      ${record.source_account_id},
      ${record.source_thread_binding_id},
      ${record.binding_revision},
      ${record.binding_generation},
      ${record.account_identity_revision},
      ${record.account_generation},
      ${record.account_canonical_key_digest_sha256},
      ${record.message_realm_id},
      ${record.message_realm_version},
      ${record.message_canonicalization_version},
      ${record.message_scope_kind},
      ${record.message_scope_source_account_id},
      ${record.message_scope_source_thread_binding_id},
      ${record.message_object_kind_id},
      ${record.canonical_external_subject},
      ${record.adapter_contract_id},
      ${record.adapter_contract_version},
      ${record.adapter_declaration_revision},
      ${record.adapter_surface_id},
      ${record.adapter_loaded_by_trusted_service_id},
      ${record.adapter_loaded_at},
      ${record.message_decision_strength},
      ${record.origin_kind},
      ${record.raw_inbound_event_id},
      ${record.normalized_inbound_event_id},
      ${record.outbound_dispatch_attempt_id},
      ${record.provider_actor_kind},
      ${record.provider_actor_source_external_identity_id},
      ${record.provider_system_actor_kind_id},
      ${record.provider_system_actor_subject},
      ${record.direction},
      ${record.descriptor_schema_id},
      ${record.descriptor_version},
      ${record.capability_revision},
      ${record.provider_reference_count},
      ${record.descriptor_digest_sha256},
      ${record.provider_timestamp_count},
      ${record.reference_portability_kind},
      ${record.reference_portability_decision_strength},
      ${record.resolution_state},
      ${record.resolved_external_message_reference_id},
      ${record.resolution_candidate_count},
      ${record.resolution_candidate_digest_sha256},
      ${record.resolution_diagnostic_code_id},
      ${record.resolution_diagnostic_retryable},
      ${record.resolution_diagnostic_correlation_token},
      ${record.resolution_diagnostic_safe_operator_hint_id},
      ${record.materialized_by_trusted_service_id},
      ${record.materialization_authorization_token},
      ${record.observed_at},
      ${record.recorded_at},
      ${record.revision},
      ${record.created_at},
      ${record.updated_at}
    )
    on conflict (tenant_id, id) do nothing
    returning id
  `;
}

export function buildInsertInboxV2SourceOccurrenceProviderReferenceSql(input: {
  tenantId: InboxV2TenantId;
  occurrenceId: InboxV2SourceOccurrenceId;
  ordinal: number;
  kindId: string;
  subject: string;
}): SQL {
  return sql`
    insert into inbox_v2_source_occurrence_provider_references (
      tenant_id, source_occurrence_id, ordinal, kind_id, subject
    ) values (
      ${input.tenantId}, ${input.occurrenceId}, ${input.ordinal},
      ${input.kindId}, ${input.subject}
    )
    returning source_occurrence_id as id
  `;
}

export function buildInsertInboxV2SourceOccurrenceProviderTimestampSql(input: {
  tenantId: InboxV2TenantId;
  occurrenceId: InboxV2SourceOccurrenceId;
  ordinal: number;
  kindId: string;
  timestamp: string;
}): SQL {
  return sql`
    insert into inbox_v2_source_occurrence_provider_timestamps (
      tenant_id, source_occurrence_id, ordinal, kind_id, timestamp
    ) values (
      ${input.tenantId}, ${input.occurrenceId}, ${input.ordinal},
      ${input.kindId}, ${input.timestamp}
    )
    returning source_occurrence_id as id
  `;
}

async function lockBinding(
  executor: RawSqlExecutor,
  commit: NormalizedCommit
): Promise<BindingLockRow | null> {
  return requireAtMostOneRow(
    await executor.execute<BindingLockRow>(
      buildLockInboxV2SourceOccurrenceBindingSql(commit)
    ),
    "SourceThreadBinding head/snapshot lock"
  );
}

async function lockAccountIdentity(
  executor: RawSqlExecutor,
  commit: NormalizedCommit
): Promise<AccountIdentityLockRow | null> {
  return requireAtMostOneRow(
    await executor.execute<AccountIdentityLockRow>(
      buildLockInboxV2SourceOccurrenceAccountIdentitySql(commit)
    ),
    "SourceAccountIdentity lock"
  );
}

async function lockExternalThread(
  executor: RawSqlExecutor,
  commit: NormalizedCommit
): Promise<ExternalThreadLockRow | null> {
  return requireAtMostOneRow(
    await executor.execute<ExternalThreadLockRow>(
      buildLockInboxV2SourceOccurrenceExternalThreadSql(commit)
    ),
    "ExternalThread lock"
  );
}

async function lockRawEvent(
  executor: RawSqlExecutor,
  commit: EventBackedCommit
): Promise<RawEventLockRow | null> {
  return requireAtMostOneRow(
    await executor.execute<RawEventLockRow>(
      buildLockInboxV2SourceOccurrenceRawEventSql(commit)
    ),
    "raw inbound event lock"
  );
}

async function lockNormalizedEvent(
  executor: RawSqlExecutor,
  commit: EventBackedCommit
): Promise<NormalizedEventLockRow | null> {
  return requireAtMostOneRow(
    await executor.execute<NormalizedEventLockRow>(
      buildLockInboxV2SourceOccurrenceNormalizedEventSql(commit)
    ),
    "normalized inbound event lock"
  );
}

function eventScopeMatches(
  row: RawEventLockRow,
  commit: EventBackedCommit
): boolean {
  const binding = commit.bindingMaterialization.currentProjection.binding;
  return (
    String(row.source_connection_id) === String(binding.sourceConnection.id) &&
    String(row.source_account_id) === String(binding.sourceAccount.id) &&
    timestampAtOrBefore(row.evidence_at, commit.materializedAt)
  );
}

function isEventBackedCommit(
  commit: NormalizedCommit
): commit is EventBackedCommit {
  return commit.occurrence.origin.kind !== "provider_response";
}

function isProviderResponseCommit(
  commit: NormalizedCommit
): commit is ProviderResponseCommit {
  return commit.occurrence.origin.kind === "provider_response";
}

type OutboundProofRow = {
  attempt_id: unknown;
  attempt_dispatch_id: unknown;
  attempt_route_id: unknown;
  attempt_outcome_kind: unknown;
  attempt_revision: unknown;
  attempt_opened_at: unknown;
  dispatch_id: unknown;
  dispatch_route_id: unknown;
  dispatch_last_attempt_id: unknown;
  dispatch_state: unknown;
  dispatch_revision: unknown;
  route_id: unknown;
  route_external_thread_id: unknown;
  route_source_thread_binding_id: unknown;
  route_source_connection_id: unknown;
  route_source_account_id: unknown;
  route_adapter_contract_id: unknown;
  route_adapter_contract_version: unknown;
  route_adapter_declaration_revision: unknown;
  route_adapter_surface_id: unknown;
  route_adapter_loaded_by_trusted_service_id: unknown;
  route_adapter_loaded_at: unknown;
};

async function validateOutboundProof(
  executor: RawSqlExecutor,
  commit: ProviderResponseCommit
): Promise<Readonly<{
  kind: "outbound_attempt_not_found" | "outbound_proof_conflict";
}> | null> {
  const attempt = commit.outboundDispatchAttempt;
  const dispatch = commit.outboundDispatch;
  const route = commit.outboundRoute;
  if (attempt === null || dispatch === null || route === null) {
    throw invariantError(
      "Provider-response contract lost its outbound proof snapshots."
    );
  }
  const result = await executor.execute<OutboundProofRow>(sql`
    select
      attempt_row.id as attempt_id,
      attempt_row.dispatch_id as attempt_dispatch_id,
      attempt_row.route_id as attempt_route_id,
      attempt_row.outcome_kind as attempt_outcome_kind,
      attempt_row.revision as attempt_revision,
      attempt_row.opened_at as attempt_opened_at,
      dispatch_row.id as dispatch_id,
      dispatch_row.route_id as dispatch_route_id,
      dispatch_row.last_attempt_id as dispatch_last_attempt_id,
      dispatch_row.state as dispatch_state,
      dispatch_row.revision as dispatch_revision,
      route_row.id as route_id,
      route_row.external_thread_id as route_external_thread_id,
      route_row.source_thread_binding_id as route_source_thread_binding_id,
      route_row.source_connection_id as route_source_connection_id,
      route_row.source_account_id as route_source_account_id,
      route_row.adapter_contract_id as route_adapter_contract_id,
      route_row.adapter_contract_version as route_adapter_contract_version,
      route_row.adapter_declaration_revision as route_adapter_declaration_revision,
      route_row.adapter_surface_id as route_adapter_surface_id,
      route_row.adapter_loaded_by_trusted_service_id as route_adapter_loaded_by_trusted_service_id,
      route_row.adapter_loaded_at as route_adapter_loaded_at
    from inbox_v2_outbound_dispatch_attempts attempt_row
    join inbox_v2_outbound_dispatches dispatch_row
      on dispatch_row.tenant_id = attempt_row.tenant_id
     and dispatch_row.id = attempt_row.dispatch_id
     and dispatch_row.route_id = attempt_row.route_id
     and dispatch_row.message_id = attempt_row.message_id
    join inbox_v2_outbound_routes route_row
      on route_row.tenant_id = attempt_row.tenant_id
     and route_row.id = attempt_row.route_id
    where attempt_row.tenant_id = ${commit.tenantId}
      and attempt_row.id = ${attempt.id}
    for share of attempt_row, dispatch_row, route_row
  `);
  const row = requireAtMostOneRow(result, "provider response outbound proof");
  if (row === null) return { kind: "outbound_attempt_not_found" };

  const occurrence = commit.occurrence;
  const adapter = occurrence.messageIdentityDeclaration.adapterContract;
  const matches =
    String(row.attempt_id) === String(attempt.id) &&
    String(row.attempt_dispatch_id) === String(attempt.dispatch.id) &&
    String(row.attempt_route_id) === String(attempt.route.id) &&
    String(row.attempt_outcome_kind) === attempt.outcome.kind &&
    parseDatabaseBigint(row.attempt_revision, "OutboundAttempt.revision") ===
      String(attempt.revision) &&
    sameTimestamp(row.attempt_opened_at, attempt.openedAt) &&
    String(row.dispatch_id) === String(dispatch.id) &&
    String(row.dispatch_route_id) === String(dispatch.route.id) &&
    nullableString(row.dispatch_last_attempt_id) === String(attempt.id) &&
    String(row.dispatch_state) === dispatch.state &&
    parseDatabaseBigint(row.dispatch_revision, "OutboundDispatch.revision") ===
      String(dispatch.revision) &&
    String(row.route_id) === String(route.id) &&
    String(row.route_external_thread_id) ===
      String(occurrence.bindingContext.externalThread.id) &&
    String(row.route_source_thread_binding_id) ===
      String(occurrence.bindingContext.sourceThreadBinding.id) &&
    String(row.route_source_connection_id) ===
      String(route.sourceConnection.id) &&
    String(row.route_source_account_id) ===
      String(occurrence.bindingContext.sourceAccount.id) &&
    String(row.route_adapter_contract_id) === String(adapter.contractId) &&
    String(row.route_adapter_contract_version) ===
      String(adapter.contractVersion) &&
    parseDatabaseBigint(
      row.route_adapter_declaration_revision,
      "OutboundRoute.adapterDeclarationRevision"
    ) === String(adapter.declarationRevision) &&
    String(row.route_adapter_surface_id) === String(adapter.surfaceId) &&
    String(row.route_adapter_loaded_by_trusted_service_id) ===
      String(adapter.loadedByTrustedServiceId) &&
    sameTimestamp(row.route_adapter_loaded_at, adapter.loadedAt);

  return matches ? null : { kind: "outbound_proof_conflict" };
}

function threadMatchesCommit(
  row: ExternalThreadLockRow,
  commit: NormalizedCommit
): boolean {
  const expected = commit.externalThreadMapping.thread;
  return (
    String(row.id) === String(expected.id) &&
    String(row.conversation_id) === String(expected.conversation.id) &&
    parseDatabaseBigint(row.revision, "ExternalThread.revision") ===
      String(expected.revision) &&
    timestampAtOrBefore(row.created_at, commit.materializedAt) &&
    sameAdapterIdentityDeclaration(
      row.identity_declaration,
      expected.identityDeclaration
    )
  );
}

function accountIdentityMatchesCommit(
  row: AccountIdentityLockRow,
  commit: NormalizedCommit
): boolean {
  const expected = commit.sourceAccountIdentity;
  const canonical = expected.canonicalIdentity;
  const expectedScopeConnectionId =
    canonical.scope.kind === "source_connection"
      ? canonical.scope.owner.id
      : null;

  return (
    String(row.source_account_id) === String(expected.sourceAccount.id) &&
    String(row.source_connection_id) === String(expected.sourceConnection.id) &&
    parseDatabaseBigint(row.revision, "SourceAccountIdentity.revision") ===
      String(expected.revision) &&
    parseDatabaseBigint(
      row.account_generation,
      "SourceAccountIdentity.accountGeneration"
    ) === String(expected.accountGeneration) &&
    String(row.canonical_key_digest_sha256) ===
      computeInboxV2SourceAccountCanonicalKeyDigest(canonical) &&
    String(row.canonical_realm_id) === String(canonical.realm.realmId) &&
    String(row.canonical_realm_version) === canonical.realm.realmVersion &&
    String(row.canonicalization_version) ===
      canonical.realm.canonicalizationVersion &&
    String(row.canonical_object_kind_id) ===
      String(canonical.realm.objectKindId) &&
    String(row.canonical_scope_kind) === canonical.scope.kind &&
    nullableString(row.canonical_scope_source_connection_id) ===
      nullableString(expectedScopeConnectionId) &&
    String(row.canonical_external_subject) ===
      canonical.canonicalExternalSubject &&
    sameAdapterIdentityDeclaration(
      row.identity_declaration,
      expected.identityDeclaration
    ) &&
    sameTimestamp(row.updated_at, expected.updatedAt) &&
    timestampAtOrBefore(row.updated_at, commit.materializedAt)
  );
}

function classifyBindingMismatch(
  row: BindingLockRow,
  commit: NormalizedCommit,
  identity: AccountIdentityLockRow
):
  | "binding_snapshot_conflict"
  | "adapter_surface_conflict"
  | "capability_revision_conflict"
  | null {
  const binding = commit.bindingMaterialization.currentProjection.binding;
  const expectedDigest = String(identity.canonical_key_digest_sha256);
  const expectedRevision = String(binding.revision);
  const expectedIdentityRevision = String(
    commit.sourceAccountIdentity.revision
  );
  const expectedGeneration = String(binding.bindingGeneration);
  const expectedAccountGeneration = String(
    commit.sourceAccountIdentity.accountGeneration
  );

  const anchorMatches =
    String(row.binding_id) === String(binding.id) &&
    String(row.external_thread_id) === String(binding.externalThread.id) &&
    String(row.source_connection_id) === String(binding.sourceConnection.id) &&
    String(row.source_account_id) === String(binding.sourceAccount.id) &&
    String(row.snapshot_binding_id) === String(binding.id) &&
    String(row.snapshot_external_thread_id) ===
      String(binding.externalThread.id) &&
    String(row.snapshot_source_connection_id) ===
      String(binding.sourceConnection.id) &&
    String(row.snapshot_source_account_id) === String(binding.sourceAccount.id);
  if (!anchorMatches) return "binding_snapshot_conflict";

  const snapshotMatches =
    parseDatabaseBigint(row.binding_revision, "binding head revision") ===
      expectedRevision &&
    parseDatabaseBigint(row.snapshot_revision, "binding snapshot revision") ===
      expectedRevision &&
    parseDatabaseBigint(row.binding_generation, "binding generation") ===
      expectedGeneration &&
    parseDatabaseBigint(
      row.snapshot_binding_generation,
      "binding snapshot generation"
    ) === expectedGeneration &&
    parseDatabaseBigint(
      row.account_identity_revision,
      "binding account identity revision"
    ) === expectedIdentityRevision &&
    parseDatabaseBigint(
      row.snapshot_account_identity_revision,
      "binding snapshot account identity revision"
    ) === expectedIdentityRevision &&
    parseDatabaseBigint(
      row.account_generation,
      "binding account generation"
    ) === expectedAccountGeneration &&
    parseDatabaseBigint(
      row.snapshot_account_generation,
      "binding snapshot account generation"
    ) === expectedAccountGeneration &&
    row.account_identity_state === "verified" &&
    row.snapshot_account_identity_state === "verified" &&
    String(row.account_canonical_key_digest_sha256) === expectedDigest &&
    String(row.snapshot_account_canonical_key_digest_sha256) === expectedDigest;
  if (!snapshotMatches) return "binding_snapshot_conflict";
  if (
    !timestampAtOrBefore(row.created_at, commit.materializedAt) ||
    !timestampAtOrBefore(row.updated_at, commit.materializedAt) ||
    !timestampAtOrBefore(row.snapshot_created_at, commit.materializedAt) ||
    !timestampAtOrBefore(row.snapshot_updated_at, commit.materializedAt)
  ) {
    return "binding_snapshot_conflict";
  }
  if (
    !sameExactAdapterSurfaceRow(
      row,
      "",
      binding.capabilities.adapterContract
    ) ||
    !sameExactAdapterSurfaceRow(
      row,
      "snapshot_",
      binding.capabilities.adapterContract
    )
  ) {
    return "binding_snapshot_conflict";
  }

  const expectedCapabilityRevision = String(binding.capabilities.revision);
  if (
    parseDatabaseBigint(
      row.capability_revision,
      "binding capability revision"
    ) !== expectedCapabilityRevision ||
    parseDatabaseBigint(
      row.snapshot_capability_revision,
      "binding snapshot capability revision"
    ) !== expectedCapabilityRevision
  ) {
    return "capability_revision_conflict";
  }

  const occurrenceAdapter =
    commit.occurrence.messageIdentityDeclaration.adapterContract;
  if (
    !sameAdapterSurfaceRow(row, "", occurrenceAdapter) ||
    !sameAdapterSurfaceRow(row, "snapshot_", occurrenceAdapter)
  ) {
    return "adapter_surface_conflict";
  }

  return null;
}

async function validateProviderActor(
  executor: RawSqlExecutor,
  commit: NormalizedCommit
): Promise<Readonly<{
  kind:
    | "provider_actor_not_found"
    | "provider_actor_scope_conflict"
    | "provider_actor_adapter_surface_conflict";
  sourceExternalIdentityId: InboxV2SourceExternalIdentityId;
}> | null> {
  const actor = commit.occurrence.providerActor;
  if (actor === null || actor.kind === "provider_system") return null;

  const actorId = actor.sourceExternalIdentity.id;
  const row = requireAtMostOneRow(
    await executor.execute<ProviderActorLockRow>(
      buildLockInboxV2SourceOccurrenceProviderActorSql({
        tenantId: commit.tenantId,
        sourceExternalIdentityId: actorId
      })
    ),
    "SourceExternalIdentity actor lock"
  );
  if (row === null) {
    return {
      kind: "provider_actor_not_found",
      sourceExternalIdentityId: actorId
    };
  }

  const binding = commit.bindingMaterialization.currentProjection.binding;
  const adapterContract = binding.capabilities.adapterContract;
  if (
    row.scope_kind === "provider" &&
    (String(row.declaration_contract_id) !==
      String(adapterContract.contractId) ||
      String(row.declaration_contract_version) !==
        String(adapterContract.contractVersion) ||
      String(row.declaration_surface_id) !==
        String(adapterContract.surfaceId) ||
      String(row.declaration_loaded_by_trusted_service_id) !==
        String(adapterContract.loadedByTrustedServiceId))
  ) {
    return {
      kind: "provider_actor_adapter_surface_conflict",
      sourceExternalIdentityId: actorId
    };
  }
  const scopeMatches =
    row.scope_kind === "provider" ||
    (row.scope_kind === "source_connection" &&
      String(row.scope_source_connection_id) ===
        String(binding.sourceConnection.id)) ||
    (row.scope_kind === "source_account" &&
      String(row.scope_source_account_id) === String(binding.sourceAccount.id));
  const eventBacked = isEventBackedCommit(commit);
  const evidenceMatches =
    row.stability_kind !== "observation_ephemeral" ||
    (eventBacked &&
      (row.ephemeral_raw_inbound_event_id !== null ||
        row.ephemeral_normalized_inbound_event_id !== null) &&
      (row.ephemeral_raw_inbound_event_id === null ||
        String(row.ephemeral_raw_inbound_event_id) ===
          String(commit.occurrence.origin.rawInboundEvent.id)) &&
      (row.ephemeral_normalized_inbound_event_id === null ||
        String(row.ephemeral_normalized_inbound_event_id) ===
          String(commit.occurrence.origin.normalizedInboundEvent.id)));

  if (
    !scopeMatches ||
    !evidenceMatches ||
    !timestampAtOrBefore(row.declaration_loaded_at, commit.materializedAt) ||
    !timestampAtOrBefore(row.materialized_at, commit.materializedAt) ||
    !timestampAtOrBefore(row.created_at, commit.materializedAt)
  ) {
    return {
      kind: "provider_actor_scope_conflict",
      sourceExternalIdentityId: actorId
    };
  }

  return null;
}

function toPersistenceRecord(
  commit: NormalizedCommit,
  accountCanonicalKeyDigestSha256: string
) {
  const occurrence = commit.occurrence;
  const binding = commit.bindingMaterialization.currentProjection.binding;
  const mapping = commit.externalThreadMapping;
  const identity = commit.sourceAccountIdentity;
  const key = occurrence.messageKey;
  const adapter = occurrence.messageIdentityDeclaration.adapterContract;
  const actor = occurrence.providerActor;
  const diagnostic = occurrence.resolution.diagnostic;

  return {
    tenant_id: commit.tenantId,
    id: occurrence.id,
    conversation_id: mapping.thread.conversation.id,
    external_thread_id: mapping.thread.id,
    external_thread_revision: String(mapping.thread.revision),
    source_connection_id: binding.sourceConnection.id,
    source_account_id: binding.sourceAccount.id,
    source_thread_binding_id: binding.id,
    binding_revision: String(binding.revision),
    binding_generation: String(binding.bindingGeneration),
    account_identity_revision: String(identity.revision),
    account_generation: String(identity.accountGeneration),
    account_canonical_key_digest_sha256: accountCanonicalKeyDigestSha256,
    message_realm_id: key.realm.realmId,
    message_realm_version: key.realm.realmVersion,
    message_canonicalization_version: key.realm.canonicalizationVersion,
    message_scope_kind: key.scope.kind,
    message_scope_source_account_id:
      key.scope.kind === "source_account" ? key.scope.owner.id : null,
    message_scope_source_thread_binding_id:
      key.scope.kind === "source_thread_binding" ? key.scope.owner.id : null,
    message_object_kind_id: key.objectKindId,
    canonical_external_subject: key.canonicalExternalSubject,
    adapter_contract_id: adapter.contractId,
    adapter_contract_version: adapter.contractVersion,
    adapter_declaration_revision: String(adapter.declarationRevision),
    adapter_surface_id: adapter.surfaceId,
    adapter_loaded_by_trusted_service_id: adapter.loadedByTrustedServiceId,
    adapter_loaded_at: adapter.loadedAt,
    message_decision_strength:
      occurrence.messageIdentityDeclaration.decisionStrength,
    origin_kind: occurrence.origin.kind,
    raw_inbound_event_id:
      occurrence.origin.kind === "provider_response"
        ? null
        : occurrence.origin.rawInboundEvent.id,
    normalized_inbound_event_id:
      occurrence.origin.kind === "provider_response"
        ? null
        : occurrence.origin.normalizedInboundEvent.id,
    outbound_dispatch_attempt_id:
      occurrence.origin.kind === "provider_response"
        ? occurrence.origin.outboundDispatchAttempt.id
        : null,
    provider_actor_kind: actor === null ? null : actor.kind,
    provider_actor_source_external_identity_id:
      actor?.kind === "source_external_identity"
        ? actor.sourceExternalIdentity.id
        : null,
    provider_system_actor_kind_id:
      actor?.kind === "provider_system" ? actor.actorKindId : null,
    provider_system_actor_subject:
      actor?.kind === "provider_system" ? actor.actorSubject : null,
    direction: occurrence.direction,
    descriptor_schema_id: occurrence.descriptor.descriptorSchemaId,
    descriptor_version: occurrence.descriptor.descriptorVersion,
    capability_revision: String(occurrence.descriptor.capabilityRevision),
    provider_reference_count: occurrence.descriptor.providerReferences.length,
    descriptor_digest_sha256: occurrence.descriptor.descriptorDigestSha256,
    provider_timestamp_count: occurrence.providerTimestamps.length,
    reference_portability_kind: occurrence.referencePortability.kind,
    reference_portability_decision_strength:
      occurrence.referencePortability.decisionStrength,
    resolution_state: occurrence.resolution.state,
    resolved_external_message_reference_id: null,
    resolution_candidate_count: 0,
    resolution_candidate_digest_sha256: null,
    resolution_diagnostic_code_id: diagnostic.codeId,
    resolution_diagnostic_retryable: diagnostic.retryable,
    resolution_diagnostic_correlation_token: diagnostic.correlationToken,
    resolution_diagnostic_safe_operator_hint_id: diagnostic.safeOperatorHintId,
    materialized_by_trusted_service_id: commit.authority.trustedServiceId,
    materialization_authorization_token: commit.authority.authorizationToken,
    observed_at: occurrence.observedAt,
    recorded_at: occurrence.recordedAt,
    revision: String(occurrence.revision),
    created_at: occurrence.createdAt,
    updated_at: occurrence.updatedAt
  } as const;
}

async function loadOccurrenceAggregateRows(
  executor: RawSqlExecutor,
  input: Readonly<{
    tenantId: InboxV2TenantId;
    occurrenceId: InboxV2SourceOccurrenceId;
  }>
): Promise<LoadedOccurrenceAggregateRows | null> {
  const row = requireAtMostOneRow(
    await executor.execute<ExistingOccurrenceRow>(
      buildFindInboxV2SourceOccurrenceByIdSql(input)
    ),
    "SourceOccurrence lookup"
  );
  if (row === null) return null;

  const [references, timestamps] = await Promise.all([
    executor.execute<ProviderReferenceRow>(
      buildListInboxV2SourceOccurrenceProviderReferencesSql(input)
    ),
    executor.execute<ProviderTimestampRow>(
      buildListInboxV2SourceOccurrenceProviderTimestampsSql(input)
    )
  ]);
  const resolutionCandidates =
    row.resolution_state === "conflicted"
      ? await executor.execute<ResolutionCandidateRow>(
          buildListInboxV2SourceOccurrenceResolutionCandidatesSql({
            ...input,
            resultingRevision: parseDatabaseBigint(
              row.revision,
              "SourceOccurrence resolution revision"
            )
          })
        )
      : { rows: [] as readonly ResolutionCandidateRow[] };

  return {
    row,
    references: references.rows,
    timestamps: timestamps.rows,
    resolutionCandidates: resolutionCandidates.rows
  };
}

function mapSourceOccurrenceAggregate(
  aggregate: LoadedOccurrenceAggregateRows,
  expectedTenantId: InboxV2TenantId
): InboxV2SourceOccurrence {
  const { row, references, timestamps, resolutionCandidates } = aggregate;
  const tenantId = inboxV2TenantIdSchema.parse(row.tenant_id);
  if (tenantId !== expectedTenantId) {
    throw invariantError(
      "SourceOccurrence aggregate crossed its tenant boundary."
    );
  }
  assertOrderedRows(references, "SourceOccurrence provider references");
  assertOrderedRows(timestamps, "SourceOccurrence provider timestamps");
  assertOrderedRows(
    resolutionCandidates,
    "SourceOccurrence resolution candidates"
  );
  if (
    parseNonNegativeDatabaseInteger(
      row.provider_reference_count,
      "SourceOccurrence provider-reference count"
    ) !== references.length ||
    parseNonNegativeDatabaseInteger(
      row.provider_timestamp_count,
      "SourceOccurrence provider-timestamp count"
    ) !== timestamps.length
  ) {
    throw invariantError("SourceOccurrence child counts are incoherent.");
  }

  const reference = <const TKind extends string>(
    kind: TKind,
    id: unknown,
    field: string
  ) => ({ tenantId, kind, id: requireString(id, field) });
  const externalThread = reference(
    "external_thread",
    row.external_thread_id,
    "SourceOccurrence ExternalThread id"
  );
  const sourceAccount = reference(
    "source_account",
    row.source_account_id,
    "SourceOccurrence SourceAccount id"
  );
  const sourceThreadBinding = reference(
    "source_thread_binding",
    row.source_thread_binding_id,
    "SourceOccurrence SourceThreadBinding id"
  );
  const adapterContract = {
    contractId: requireString(
      row.adapter_contract_id,
      "SourceOccurrence adapter contract id"
    ),
    contractVersion: requireString(
      row.adapter_contract_version,
      "SourceOccurrence adapter contract version"
    ),
    declarationRevision: parseDatabaseBigint(
      row.adapter_declaration_revision,
      "SourceOccurrence adapter declaration revision"
    ),
    surfaceId: requireString(
      row.adapter_surface_id,
      "SourceOccurrence adapter surface id"
    ),
    loadedByTrustedServiceId: requireString(
      row.adapter_loaded_by_trusted_service_id,
      "SourceOccurrence adapter trusted service id"
    ),
    loadedAt: parseDatabaseTimestamp(
      row.adapter_loaded_at,
      "SourceOccurrence adapter loadedAt"
    )
  };

  let messageScope: Record<string, unknown>;
  switch (row.message_scope_kind) {
    case "provider_thread":
      messageScope = { kind: "provider_thread" };
      break;
    case "source_account":
      messageScope = {
        kind: "source_account",
        owner: reference(
          "source_account",
          row.message_scope_source_account_id,
          "SourceOccurrence Message scope SourceAccount id"
        )
      };
      break;
    case "source_thread_binding":
      messageScope = {
        kind: "source_thread_binding",
        owner: reference(
          "source_thread_binding",
          row.message_scope_source_thread_binding_id,
          "SourceOccurrence Message scope SourceThreadBinding id"
        )
      };
      break;
    default:
      throw invariantError("SourceOccurrence Message scope is unknown.");
  }

  let origin: Record<string, unknown>;
  if (row.origin_kind === "provider_response") {
    origin = {
      kind: "provider_response",
      sourceAccount,
      outboundDispatchAttempt: reference(
        "outbound_dispatch_attempt",
        row.outbound_dispatch_attempt_id,
        "SourceOccurrence outbound attempt id"
      )
    };
  } else if (
    typeof row.origin_kind === "string" &&
    SUPPORTED_ORIGIN_KINDS.has(row.origin_kind)
  ) {
    origin = {
      kind: row.origin_kind,
      sourceAccount,
      rawInboundEvent: reference(
        "raw_inbound_event",
        row.raw_inbound_event_id,
        "SourceOccurrence raw event id"
      ),
      normalizedInboundEvent: reference(
        "normalized_inbound_event",
        row.normalized_inbound_event_id,
        "SourceOccurrence normalized event id"
      )
    };
  } else {
    throw invariantError("SourceOccurrence origin is unknown.");
  }

  let providerActor: Record<string, unknown> | null;
  switch (row.provider_actor_kind) {
    case null:
    case undefined:
      providerActor = null;
      break;
    case "source_external_identity":
      providerActor = {
        kind: "source_external_identity",
        sourceExternalIdentity: reference(
          "source_external_identity",
          row.provider_actor_source_external_identity_id,
          "SourceOccurrence provider actor identity id"
        )
      };
      break;
    case "provider_system":
      providerActor = {
        kind: "provider_system",
        actorKindId: requireString(
          row.provider_system_actor_kind_id,
          "SourceOccurrence provider-system actor kind"
        ),
        actorSubject: requireString(
          row.provider_system_actor_subject,
          "SourceOccurrence provider-system actor subject"
        )
      };
      break;
    default:
      throw invariantError("SourceOccurrence provider actor is unknown.");
  }

  const diagnostic = () => ({
    codeId: requireString(
      row.resolution_diagnostic_code_id,
      "SourceOccurrence resolution diagnostic code"
    ),
    retryable: requireBoolean(
      row.resolution_diagnostic_retryable,
      "SourceOccurrence resolution diagnostic retryable"
    ),
    correlationToken: requireString(
      row.resolution_diagnostic_correlation_token,
      "SourceOccurrence resolution correlation token"
    ),
    safeOperatorHintId: nullableString(
      row.resolution_diagnostic_safe_operator_hint_id
    )
  });
  let resolution: Record<string, unknown>;
  switch (row.resolution_state) {
    case "pending":
      resolution = { state: "pending", diagnostic: diagnostic() };
      break;
    case "resolved":
      resolution = {
        state: "resolved",
        externalMessageReference: reference(
          "external_message_reference",
          row.resolved_external_message_reference_id,
          "SourceOccurrence resolved ExternalMessageReference id"
        )
      };
      break;
    case "conflicted": {
      const candidateIds = resolutionCandidates.map((candidate) =>
        requireString(
          candidate.external_message_reference_id,
          "SourceOccurrence resolution candidate id"
        )
      );
      const expectedDigest = digestOrdinalIds(candidateIds);
      if (
        parseNonNegativeDatabaseInteger(
          row.resolution_candidate_count,
          "SourceOccurrence resolution candidate count"
        ) !== candidateIds.length ||
        nullableString(row.resolution_candidate_digest_sha256) !==
          expectedDigest
      ) {
        throw invariantError(
          "SourceOccurrence resolution candidate projection is incoherent."
        );
      }
      resolution = {
        state: "conflicted",
        candidateExternalMessageReferences: candidateIds.map((id) =>
          reference(
            "external_message_reference",
            id,
            "SourceOccurrence resolution candidate id"
          )
        ),
        diagnostic: diagnostic()
      };
      break;
    }
    default:
      throw invariantError("SourceOccurrence resolution state is unknown.");
  }

  return inboxV2SourceOccurrenceSchema.parse({
    tenantId,
    id: row.id,
    messageKey: {
      realm: {
        realmId: row.message_realm_id,
        realmVersion: row.message_realm_version,
        canonicalizationVersion: row.message_canonicalization_version
      },
      scope: messageScope,
      objectKindId: row.message_object_kind_id,
      externalThread,
      canonicalExternalSubject: row.canonical_external_subject
    },
    messageIdentityDeclaration: {
      adapterContract,
      identityKind: "message",
      realmId: row.message_realm_id,
      realmVersion: row.message_realm_version,
      canonicalizationVersion: row.message_canonicalization_version,
      objectKindId: row.message_object_kind_id,
      scopeKind: row.message_scope_kind,
      decisionStrength: row.message_decision_strength
    },
    bindingContext: {
      externalThread,
      sourceAccount,
      sourceThreadBinding,
      bindingGeneration: parseDatabaseBigint(
        row.binding_generation,
        "SourceOccurrence binding generation"
      )
    },
    origin,
    descriptor: {
      adapterContract,
      descriptorSchemaId: row.descriptor_schema_id,
      descriptorVersion: row.descriptor_version,
      capabilityRevision: parseDatabaseBigint(
        row.capability_revision,
        "SourceOccurrence capability revision"
      ),
      providerReferences: references.map((providerReference) => ({
        kindId: providerReference.kind_id,
        subject: providerReference.subject
      })),
      descriptorDigestSha256: row.descriptor_digest_sha256
    },
    providerActor,
    direction: row.direction,
    providerTimestamps: timestamps.map((providerTimestamp) => ({
      kindId: providerTimestamp.kind_id,
      timestamp: parseDatabaseTimestamp(
        providerTimestamp.provider_timestamp,
        "SourceOccurrence provider timestamp"
      )
    })),
    referencePortability: {
      kind: row.reference_portability_kind,
      adapterContract,
      decisionStrength: row.reference_portability_decision_strength
    },
    resolution,
    observedAt: parseDatabaseTimestamp(
      row.observed_at,
      "SourceOccurrence observedAt"
    ),
    recordedAt: parseDatabaseTimestamp(
      row.recorded_at,
      "SourceOccurrence recordedAt"
    ),
    revision: parseDatabaseBigint(row.revision, "SourceOccurrence revision"),
    createdAt: parseDatabaseTimestamp(
      row.created_at,
      "SourceOccurrence createdAt"
    ),
    updatedAt: parseDatabaseTimestamp(
      row.updated_at,
      "SourceOccurrence updatedAt"
    )
  });
}

async function loadExistingOccurrence(
  executor: RawSqlExecutor,
  commit: NormalizedCommit
): Promise<MaterializeInboxV2SourceOccurrenceResult | null> {
  const aggregate = await loadOccurrenceAggregateRows(executor, {
    tenantId: commit.tenantId,
    occurrenceId: commit.occurrence.id
  });
  if (aggregate === null) return null;
  const { row, references, timestamps } = aggregate;
  const expected = toPersistenceRecord(
    commit,
    computeInboxV2SourceAccountCanonicalKeyDigest(
      commit.sourceAccountIdentity.canonicalIdentity
    )
  );

  if (
    !samePersistenceRecord(row, expected) ||
    !sameProviderReferences(
      references,
      commit.occurrence.descriptor.providerReferences
    ) ||
    !sameProviderTimestamps(timestamps, commit.occurrence.providerTimestamps)
  ) {
    return {
      kind: "occurrence_id_conflict",
      occurrenceId: commit.occurrence.id
    };
  }

  return { kind: "already_materialized", occurrence: commit.occurrence };
}

function samePersistenceRecord(
  row: ExistingOccurrenceRow,
  expected: PersistenceRecord
): boolean {
  const timestampFields = new Set([
    "adapter_loaded_at",
    "observed_at",
    "recorded_at",
    "created_at",
    "updated_at"
  ]);
  const bigintFields = new Set([
    "external_thread_revision",
    "binding_revision",
    "binding_generation",
    "account_identity_revision",
    "account_generation",
    "adapter_declaration_revision",
    "capability_revision",
    "revision"
  ]);
  const numberFields = new Set([
    "provider_reference_count",
    "provider_timestamp_count",
    "resolution_candidate_count"
  ]);

  for (const [field, expectedValue] of Object.entries(expected)) {
    const actual = row[field];
    if (timestampFields.has(field)) {
      if (!sameTimestamp(actual, String(expectedValue))) return false;
      continue;
    }
    if (bigintFields.has(field)) {
      if (
        parseDatabaseBigint(actual, `SourceOccurrence.${field}`) !==
        String(expectedValue)
      ) {
        return false;
      }
      continue;
    }
    if (numberFields.has(field)) {
      if (Number(actual) !== expectedValue) return false;
      continue;
    }
    if (expectedValue === null) {
      if (actual !== null) return false;
      continue;
    }
    if (typeof expectedValue === "boolean") {
      if (actual !== expectedValue) return false;
      continue;
    }
    if (String(actual) !== String(expectedValue)) return false;
  }
  return true;
}

function sameProviderReferences(
  rows: readonly ProviderReferenceRow[],
  expected: NormalizedCommit["occurrence"]["descriptor"]["providerReferences"]
): boolean {
  return (
    rows.length === expected.length &&
    rows.every(
      (row, index) =>
        Number(row.ordinal) === index &&
        String(row.kind_id) === String(expected[index]?.kindId) &&
        String(row.subject) === expected[index]?.subject
    )
  );
}

function sameProviderTimestamps(
  rows: readonly ProviderTimestampRow[],
  expected: NormalizedCommit["occurrence"]["providerTimestamps"]
): boolean {
  return (
    rows.length === expected.length &&
    rows.every(
      (row, index) =>
        Number(row.ordinal) === index &&
        String(row.kind_id) === String(expected[index]?.kindId) &&
        sameTimestamp(row.provider_timestamp, expected[index]?.timestamp ?? "")
    )
  );
}

/** Matches the generated digest in source-account-identity.ts byte for byte. */
export function computeInboxV2SourceAccountCanonicalKeyDigest(
  key: NormalizedCommit["sourceAccountIdentity"]["canonicalIdentity"]
): string {
  const scopeConnectionId =
    key.scope.kind === "source_connection" ? String(key.scope.owner.id) : null;
  const serialized = [
    "source-account-canonical-key:v1|",
    lengthPrefixed(String(key.realm.realmId)),
    lengthPrefixed(key.realm.realmVersion),
    lengthPrefixed(key.realm.canonicalizationVersion),
    lengthPrefixed(String(key.realm.objectKindId)),
    key.scope.kind === "provider" ? "8:provider" : "17:source_connection",
    nullableLengthPrefixed(scopeConnectionId),
    lengthPrefixed(key.canonicalExternalSubject)
  ].join("");

  return createHash("sha256").update(serialized, "utf8").digest("hex");
}

function lengthPrefixed(value: string): string {
  return `${Buffer.byteLength(value, "utf8")}:${value}`;
}

function nullableLengthPrefixed(value: string | null): string {
  return value === null ? "-1:" : lengthPrefixed(value);
}

function digestOrdinalIds(values: readonly string[]): string | null {
  if (values.length === 0) return null;
  const serialized = values
    .map(
      (value, ordinal) =>
        `${ordinal}:${Buffer.byteLength(value, "utf8")}:${value}`
    )
    .join("|");
  return createHash("sha256").update(serialized, "utf8").digest("hex");
}

function sameAdapterIdentityDeclaration(
  value: unknown,
  expected: {
    adapterContract: {
      contractId: string;
      contractVersion: string;
      declarationRevision: string;
      surfaceId: string;
      loadedByTrustedServiceId: string;
      loadedAt: string;
    };
    identityKind: string;
    realmId: string;
    realmVersion: string;
    canonicalizationVersion: string;
    objectKindId: string;
    scopeKind: string;
    decisionStrength: string;
  }
): boolean {
  if (!isRecord(value) || !isRecord(value.adapterContract)) return false;
  const adapter = value.adapterContract;
  return (
    String(value.identityKind) === expected.identityKind &&
    String(value.realmId) === String(expected.realmId) &&
    String(value.realmVersion) === expected.realmVersion &&
    String(value.canonicalizationVersion) ===
      expected.canonicalizationVersion &&
    String(value.objectKindId) === String(expected.objectKindId) &&
    String(value.scopeKind) === expected.scopeKind &&
    String(value.decisionStrength) === expected.decisionStrength &&
    String(adapter.contractId) ===
      String(expected.adapterContract.contractId) &&
    String(adapter.contractVersion) ===
      expected.adapterContract.contractVersion &&
    String(adapter.declarationRevision) ===
      String(expected.adapterContract.declarationRevision) &&
    String(adapter.surfaceId) === String(expected.adapterContract.surfaceId) &&
    String(adapter.loadedByTrustedServiceId) ===
      String(expected.adapterContract.loadedByTrustedServiceId) &&
    sameTimestamp(adapter.loadedAt, expected.adapterContract.loadedAt)
  );
}

function sameAdapterSurfaceRow(
  row: BindingLockRow,
  prefix: "" | "snapshot_",
  expected: {
    contractId: string;
    contractVersion: string;
    surfaceId: string;
  }
): boolean {
  const values = row as unknown as Record<string, unknown>;
  return (
    String(values[`${prefix}capability_contract_id`]) ===
      String(expected.contractId) &&
    String(values[`${prefix}capability_contract_version`]) ===
      expected.contractVersion &&
    String(values[`${prefix}capability_surface_id`]) ===
      String(expected.surfaceId)
  );
}

function sameExactAdapterSurfaceRow(
  row: BindingLockRow,
  prefix: "" | "snapshot_",
  expected: {
    contractId: string;
    contractVersion: string;
    declarationRevision: string;
    surfaceId: string;
    loadedByTrustedServiceId: string;
    loadedAt: string;
  }
): boolean {
  const values = row as unknown as Record<string, unknown>;
  return (
    sameAdapterSurfaceRow(row, prefix, expected) &&
    parseDatabaseBigint(
      values[`${prefix}capability_declaration_revision`],
      `${prefix}binding capability declaration revision`
    ) === String(expected.declarationRevision) &&
    String(values[`${prefix}capability_loaded_by_trusted_service_id`]) ===
      String(expected.loadedByTrustedServiceId) &&
    sameTimestamp(values[`${prefix}capability_loaded_at`], expected.loadedAt)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw invariantError(`${field} is not a non-empty string.`);
  }
  return value;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw invariantError(`${field} is not a boolean.`);
  }
  return value;
}

function parseNonNegativeDatabaseInteger(
  value: unknown,
  field: string
): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw invariantError(`${field} is not a non-negative safe integer.`);
  }
  return parsed;
}

function assertOrderedRows(
  rows: readonly Readonly<{ ordinal: unknown }>[],
  field: string
): void {
  if (rows.some((row, index) => Number(row.ordinal) !== index)) {
    throw invariantError(`${field} are not contiguous from ordinal zero.`);
  }
}

function timestampAtOrBefore(value: unknown, boundary: string): boolean {
  const timestamp = parseDatabaseTimestamp(value, "persistence timestamp");
  return Date.parse(timestamp) <= Date.parse(boundary);
}

function sameTimestamp(value: unknown, expected: string): boolean {
  if (!inboxV2TimestampSchema.safeParse(expected).success) return false;
  return (
    Date.parse(parseDatabaseTimestamp(value, "persistence timestamp")) ===
    Date.parse(expected)
  );
}

function parseDatabaseBigint(value: unknown, field: string): string {
  if (typeof value === "number") {
    throw invariantError(
      `${field} was decoded as a JavaScript number and may have lost precision.`
    );
  }
  if (typeof value !== "string" && typeof value !== "bigint") {
    throw invariantError(`${field} is not a PostgreSQL bigint value.`);
  }
  return String(value);
}

function parseDatabaseTimestamp(value: unknown, field: string): string {
  const parsed =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : null;
  if (parsed === null || Number.isNaN(parsed.getTime())) {
    throw invariantError(`${field} is not a PostgreSQL timestamp.`);
  }
  return parsed.toISOString();
}

function requireAtMostOneRow<TRow>(
  result: RawSqlQueryResult<TRow>,
  operation: string
): TRow | null {
  if (result.rows.length > 1) {
    throw invariantError(`${operation} returned more than one row.`);
  }
  return result.rows[0] ?? null;
}

async function requireSingleInsert(
  executor: RawSqlExecutor,
  statement: SQL,
  operation: string
): Promise<void> {
  const result = await executor.execute<IdRow>(statement);
  if (result.rows.length !== 1) {
    throw invariantError(`${operation} did not return exactly one row.`);
  }
}

async function runOccurrenceTransaction<TResult>(
  executor: InboxV2SourceOccurrenceTransactionExecutor,
  work: (transaction: RawSqlExecutor) => Promise<TResult>
): Promise<TResult> {
  for (
    let attempt = 1;
    attempt <= OCCURRENCE_TRANSACTION_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await executor.transaction(work, OCCURRENCE_TRANSACTION_CONFIG);
    } catch (error) {
      if (
        attempt === OCCURRENCE_TRANSACTION_ATTEMPTS ||
        !RETRYABLE_SQLSTATES.has(sqlState(error) ?? "")
      ) {
        throw error;
      }
    }
  }
  throw invariantError("SourceOccurrence transaction retry loop exhausted.");
}

async function runOccurrenceSnapshotTransaction<TResult>(
  executor: InboxV2SourceOccurrenceTransactionExecutor,
  work: (transaction: RawSqlExecutor) => Promise<TResult>
): Promise<TResult> {
  return executor.transaction(work, OCCURRENCE_SNAPSHOT_TRANSACTION_CONFIG);
}

function sqlState(error: unknown): string | null {
  if (!isRecord(error)) return null;
  if (typeof error.code === "string") return error.code;
  return "cause" in error ? sqlState(error.cause) : null;
}

function unsupported(message: string): CoreError {
  return new CoreError("validation.failed", message);
}

function invariantError(message: string): InboxV2PersistenceInvariantError {
  return new InboxV2PersistenceInvariantError(message);
}

export type { RawSqlExecutor, RawSqlQueryResult };
