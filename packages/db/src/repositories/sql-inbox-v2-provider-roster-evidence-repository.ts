import {
  inboxV2ProviderRosterMaterializationCommitSchema,
  inboxV2TimestampSchema,
  type InboxV2ProviderRosterEvidence,
  type InboxV2ProviderRosterEvidenceId,
  type InboxV2ProviderRosterMaterializationCommit,
  type InboxV2ProviderRosterMemberEvidence,
  type InboxV2ProviderRosterMemberEvidenceId,
  type InboxV2SourceExternalIdentityId,
  type InboxV2TenantId
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";
import { createHash } from "node:crypto";

import type { HuleeDatabase } from "../client";
import {
  INBOX_V2_PROVIDER_ROSTER_MEMBER_DIGEST_DOMAIN_V1,
  orderInboxV2ProviderRosterMembersForDigest,
  serializeInboxV2ProviderRosterMemberForDigest,
  type InboxV2ProviderRosterMemberDigestInput
} from "../schema/inbox-v2/provider-roster-evidence";
import { InboxV2PersistenceInvariantError } from "./sql-inbox-v2-conversation-repository";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

const PROVIDER_ROSTER_TRANSACTION_CONFIG = {
  isolationLevel: "read committed"
} as const;
const PROVIDER_ROSTER_TRANSACTION_ATTEMPTS = 3;
const RETRYABLE_PROVIDER_ROSTER_SQLSTATES = new Set(["40001", "40P01"]);

export const INBOX_V2_PROVIDER_ROSTER_IDENTITY_LOCK_BATCH_SIZE = 2_000;
export const INBOX_V2_PROVIDER_ROSTER_MEMBER_INSERT_BATCH_SIZE = 1_000;

export type MaterializeInboxV2ProviderRosterEvidenceResult =
  | Readonly<{
      kind: "materialized" | "already_materialized";
      evidence: InboxV2ProviderRosterEvidence;
      members: readonly InboxV2ProviderRosterMemberEvidence[];
    }>
  | Readonly<{
      kind: "roster_evidence_id_conflict";
      evidenceId: InboxV2ProviderRosterEvidenceId;
    }>
  | Readonly<{
      kind: "roster_member_evidence_id_conflict";
      memberEvidenceId: InboxV2ProviderRosterMemberEvidenceId;
    }>
  | Readonly<{
      kind:
        | "binding_not_found"
        | "binding_snapshot_conflict"
        | "adapter_surface_conflict"
        | "capability_revision_conflict"
        | "authority_conflict";
    }>
  | Readonly<{
      kind: "observation_not_found" | "observation_scope_conflict";
      observationKind: "raw_inbound_event" | "normalized_inbound_event";
    }>
  | Readonly<{
      kind:
        | "member_identity_not_found"
        | "member_identity_scope_conflict"
        | "member_identity_provider_scope_unproven";
      sourceExternalIdentityId: InboxV2SourceExternalIdentityId;
    }>;

export type InboxV2ProviderRosterEvidenceTransactionExecutor =
  RawSqlExecutor & {
    transaction<TResult>(
      work: (transaction: RawSqlExecutor) => Promise<TResult>,
      config: Readonly<{ isolationLevel: "read committed" }>
    ): Promise<TResult>;
  };

export type InboxV2ProviderRosterEvidenceRepository = Readonly<{
  materialize(
    input: InboxV2ProviderRosterMaterializationCommit
  ): Promise<MaterializeInboxV2ProviderRosterEvidenceResult>;
}>;

type NormalizedCommit = ReturnType<
  typeof inboxV2ProviderRosterMaterializationCommitSchema.parse
> & {
  members: readonly InboxV2ProviderRosterMemberEvidence[];
};

type IdRow = { id: unknown };
type BindingLockRow = {
  binding_id: unknown;
  external_thread_id: unknown;
  source_connection_id: unknown;
  source_account_id: unknown;
  binding_revision: unknown;
  binding_generation: unknown;
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
type ObservationLockRow = {
  id: unknown;
  source_connection_id: unknown;
  source_account_id: unknown;
  evidence_at: unknown;
};
type SourceIdentityLockRow = {
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
  revision: unknown;
  created_at: unknown;
  updated_at: unknown;
};
type ExistingRosterRow = Record<string, unknown>;
type ExistingMemberRow = Record<string, unknown> & {
  id: unknown;
  roster_evidence_id: unknown;
  source_external_identity_id: unknown;
};

type CanonicalMember = Readonly<{
  member: InboxV2ProviderRosterMemberEvidence;
  ordinal: number;
  sourceIdentityRevision: bigint;
}>;

type RosterPersistenceRecord = ReturnType<typeof toRosterPersistenceRecord>;
type MemberPersistenceRecord = ReturnType<typeof toMemberPersistenceRecord>;

export function createSqlInboxV2ProviderRosterEvidenceRepository(
  executor: InboxV2ProviderRosterEvidenceTransactionExecutor | HuleeDatabase
): InboxV2ProviderRosterEvidenceRepository {
  const transactionExecutor =
    executor as unknown as InboxV2ProviderRosterEvidenceTransactionExecutor;

  return {
    async materialize(input) {
      const commit = normalizeProviderRosterMaterializationCommit(input);
      const existingBeforeTransaction = await loadExistingRoster(
        transactionExecutor,
        commit
      );
      if (existingBeforeTransaction !== null) return existingBeforeTransaction;

      try {
        return await runProviderRosterTransaction(
          transactionExecutor,
          async (transaction) => {
            const binding = requireAtMostOneRow(
              await transaction.execute<BindingLockRow>(
                buildLockInboxV2ProviderRosterBindingSql(commit)
              ),
              "Provider roster binding head/snapshot lock"
            );
            if (binding === null) return { kind: "binding_not_found" } as const;

            const bindingConflict = classifyBindingConflict(binding, commit);
            if (bindingConflict !== null) {
              return { kind: bindingConflict } as const;
            }

            const observation = requireAtMostOneRow(
              await transaction.execute<ObservationLockRow>(
                buildLockInboxV2ProviderRosterObservationSql(commit)
              ),
              "Provider roster observation lock"
            );
            if (observation === null) {
              return {
                kind: "observation_not_found",
                observationKind: commit.evidence.observation.kind
              } as const;
            }
            if (!observationMatchesCommit(observation, commit)) {
              return {
                kind: "observation_scope_conflict",
                observationKind: commit.evidence.observation.kind
              } as const;
            }

            const identityResult = await lockAndValidateSourceIdentities(
              transaction,
              commit
            );
            if (identityResult.kind !== "locked") return identityResult;

            const memberIdConflict = await findExistingMemberIdConflict(
              transaction,
              commit
            );
            if (memberIdConflict !== null) return memberIdConflict;

            const canonicalMembers = canonicalizeInboxV2ProviderRosterMembers(
              commit.members,
              identityResult.revisions
            );
            const digest =
              computeInboxV2ProviderRosterMemberDigest(canonicalMembers);
            const rosterRecord = toRosterPersistenceRecord(commit, digest);
            const insertedRoster = await transaction.execute<IdRow>(
              buildInsertInboxV2ProviderRosterEvidenceSql(rosterRecord)
            );
            if (insertedRoster.rows.length > 1) {
              throw invariantError(
                "Provider roster evidence insert returned more than one row."
              );
            }
            if (insertedRoster.rows.length === 0) {
              const concurrent = await loadExistingRoster(transaction, commit);
              if (concurrent === null) {
                throw invariantError(
                  "Provider roster evidence insert conflicted, but the existing aggregate is missing."
                );
              }
              return concurrent;
            }

            const memberRecords = canonicalMembers.map((member) =>
              toMemberPersistenceRecord(commit, member)
            );
            for (const batch of chunks(
              memberRecords,
              INBOX_V2_PROVIDER_ROSTER_MEMBER_INSERT_BATCH_SIZE
            )) {
              const insertedMembers = await transaction.execute<IdRow>(
                buildInsertInboxV2ProviderRosterMemberBatchSql(batch)
              );
              if (insertedMembers.rows.length !== batch.length) {
                throw invariantError(
                  "Provider roster member batch did not return exactly one row per member."
                );
              }
            }

            return {
              kind: "materialized",
              evidence: commit.evidence,
              members: canonicalMembers.map(({ member }) => member)
            } as const;
          }
        );
      } catch (error) {
        if (sqlState(error) !== "23505") throw error;
        const conflict = await resolveUniqueConflict(
          transactionExecutor,
          commit
        );
        if (conflict !== null) return conflict;
        throw error;
      }
    }
  };
}

export function buildLockInboxV2ProviderRosterBindingSql(
  commit: NormalizedCommit
): SQL {
  const bindingId = commit.currentBindingProjection.binding.id;
  return sql`
    with head as materialized (
      select candidate.*
      from inbox_v2_source_thread_binding_heads candidate
      where candidate.tenant_id = ${commit.tenantId}
        and candidate.binding_id = ${bindingId}
      for share
    ), exact_snapshot as materialized (
      select candidate.*
      from inbox_v2_source_thread_binding_snapshots candidate
      join head
        on candidate.tenant_id = head.tenant_id
       and candidate.binding_id = head.binding_id
       and candidate.revision = head.revision
      for share of candidate
    )
    select
      head.binding_id,
      head.external_thread_id,
      head.source_connection_id,
      head.source_account_id,
      head.revision as binding_revision,
      head.binding_generation,
      head.capability_contract_id,
      head.capability_contract_version,
      head.capability_declaration_revision,
      head.capability_surface_id,
      head.capability_loaded_by_trusted_service_id,
      head.capability_loaded_at,
      head.capability_revision,
      head.created_at,
      head.updated_at,
      exact_snapshot.binding_id as snapshot_binding_id,
      exact_snapshot.external_thread_id as snapshot_external_thread_id,
      exact_snapshot.source_connection_id as snapshot_source_connection_id,
      exact_snapshot.source_account_id as snapshot_source_account_id,
      exact_snapshot.revision as snapshot_revision,
      exact_snapshot.binding_generation as snapshot_binding_generation,
      exact_snapshot.capability_contract_id as snapshot_capability_contract_id,
      exact_snapshot.capability_contract_version as snapshot_capability_contract_version,
      exact_snapshot.capability_declaration_revision as snapshot_capability_declaration_revision,
      exact_snapshot.capability_surface_id as snapshot_capability_surface_id,
      exact_snapshot.capability_loaded_by_trusted_service_id as snapshot_capability_loaded_by_trusted_service_id,
      exact_snapshot.capability_loaded_at as snapshot_capability_loaded_at,
      exact_snapshot.capability_revision as snapshot_capability_revision,
      exact_snapshot.created_at as snapshot_created_at,
      exact_snapshot.updated_at as snapshot_updated_at
    from head
    left join exact_snapshot on true
  `;
}

export function buildLockInboxV2ProviderRosterObservationSql(
  commit: NormalizedCommit
): SQL {
  const observation = commit.evidence.observation;
  if (observation.kind === "raw_inbound_event") {
    return sql`
      select
        id,
        source_connection_id,
        source_account_id,
        received_at as evidence_at
      from raw_inbound_events
      where tenant_id = ${commit.tenantId}
        and id = ${observation.id}
      for share
    `;
  }

  return sql`
    select
      id,
      source_connection_id,
      source_account_id,
      created_at as evidence_at
    from normalized_inbound_events
    where tenant_id = ${commit.tenantId}
      and id = ${observation.id}
    for share
  `;
}

export function buildLockInboxV2ProviderRosterSourceIdentitiesSql(input: {
  tenantId: InboxV2TenantId;
  sourceExternalIdentityIds: readonly InboxV2SourceExternalIdentityId[];
}): SQL {
  if (input.sourceExternalIdentityIds.length === 0) {
    throw invariantError(
      "Provider roster identity lock batch cannot be empty."
    );
  }
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
      revision,
      created_at,
      updated_at
    from inbox_v2_source_external_identities
    where tenant_id = ${input.tenantId}
      and id in (${sql.join(
        input.sourceExternalIdentityIds.map((id) => sql`${id}`),
        sql`, `
      )})
    order by convert_to(id, 'UTF8')
    for share
  `;
}

export function buildLockInboxV2ProviderRosterSourceIdentityBatchesSql(input: {
  tenantId: InboxV2TenantId;
  sourceExternalIdentityIds: readonly InboxV2SourceExternalIdentityId[];
}): readonly SQL[] {
  return chunks(
    input.sourceExternalIdentityIds,
    INBOX_V2_PROVIDER_ROSTER_IDENTITY_LOCK_BATCH_SIZE
  ).map((sourceExternalIdentityIds) =>
    buildLockInboxV2ProviderRosterSourceIdentitiesSql({
      tenantId: input.tenantId,
      sourceExternalIdentityIds
    })
  );
}

export function buildFindInboxV2ProviderRosterEvidenceByIdSql(input: {
  tenantId: InboxV2TenantId;
  evidenceId: InboxV2ProviderRosterEvidenceId;
}): SQL {
  return sql`
    select *
    from inbox_v2_provider_roster_evidence
    where tenant_id = ${input.tenantId}
      and id = ${input.evidenceId}
  `;
}

export function buildListInboxV2ProviderRosterMembersSql(input: {
  tenantId: InboxV2TenantId;
  evidenceId: InboxV2ProviderRosterEvidenceId;
}): SQL {
  return sql`
    select *
    from inbox_v2_provider_roster_member_evidence
    where tenant_id = ${input.tenantId}
      and roster_evidence_id = ${input.evidenceId}
    order by ordinal
  `;
}

export function buildFindInboxV2ProviderRosterMemberIdsSql(input: {
  tenantId: InboxV2TenantId;
  memberEvidenceIds: readonly InboxV2ProviderRosterMemberEvidenceId[];
}): SQL {
  if (input.memberEvidenceIds.length === 0) {
    throw invariantError("Provider roster member-ID lookup cannot be empty.");
  }
  return sql`
    select id, roster_evidence_id, source_external_identity_id
    from inbox_v2_provider_roster_member_evidence
    where tenant_id = ${input.tenantId}
      and id in (${sql.join(
        input.memberEvidenceIds.map((id) => sql`${id}`),
        sql`, `
      )})
    order by convert_to(id, 'UTF8')
    for share
  `;
}

export function buildInsertInboxV2ProviderRosterEvidenceSql(
  record: RosterPersistenceRecord
): SQL {
  return sql`
    insert into inbox_v2_provider_roster_evidence (
      tenant_id,
      id,
      source_thread_binding_id,
      external_thread_id,
      source_connection_id,
      source_account_id,
      binding_revision,
      binding_generation,
      adapter_contract_id,
      adapter_contract_version,
      adapter_declaration_revision,
      adapter_surface_id,
      adapter_loaded_by_trusted_service_id,
      adapter_loaded_at,
      capability_revision,
      observation_kind,
      raw_inbound_event_id,
      normalized_inbound_event_id,
      completeness,
      authority,
      omission_policy,
      ordering_kind,
      ordering_scope_token,
      ordering_comparator_id,
      ordering_comparator_revision,
      ordering_position,
      watermark,
      member_count,
      ordered_member_digest_sha256,
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
      ${record.source_thread_binding_id},
      ${record.external_thread_id},
      ${record.source_connection_id},
      ${record.source_account_id},
      ${record.binding_revision},
      ${record.binding_generation},
      ${record.adapter_contract_id},
      ${record.adapter_contract_version},
      ${record.adapter_declaration_revision},
      ${record.adapter_surface_id},
      ${record.adapter_loaded_by_trusted_service_id},
      ${record.adapter_loaded_at},
      ${record.capability_revision},
      ${record.observation_kind},
      ${record.raw_inbound_event_id},
      ${record.normalized_inbound_event_id},
      ${record.completeness},
      ${record.authority},
      ${record.omission_policy},
      ${record.ordering_kind},
      ${record.ordering_scope_token},
      ${record.ordering_comparator_id},
      ${record.ordering_comparator_revision},
      ${record.ordering_position},
      ${record.watermark},
      ${record.member_count},
      ${record.ordered_member_digest_sha256},
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

export function buildInsertInboxV2ProviderRosterMemberBatchSql(
  records: readonly MemberPersistenceRecord[]
): SQL {
  if (records.length === 0) {
    throw invariantError(
      "Provider roster member insert batch cannot be empty."
    );
  }
  if (records.length > INBOX_V2_PROVIDER_ROSTER_MEMBER_INSERT_BATCH_SIZE) {
    throw invariantError(
      "Provider roster member insert batch exceeds its bound."
    );
  }

  const values = records.map(
    (record) => sql`(
      ${record.tenant_id},
      ${record.id},
      ${record.roster_evidence_id},
      ${record.source_thread_binding_id},
      ${record.external_thread_id},
      ${record.source_connection_id},
      ${record.source_account_id},
      ${record.ordinal},
      ${record.source_external_identity_id},
      ${record.source_external_identity_revision},
      ${record.state},
      ${record.normalized_role},
      ${record.provider_state_code},
      ${record.provider_role_code},
      ${record.observed_at},
      ${record.roster_recorded_at},
      ${record.revision},
      ${record.created_at},
      ${record.updated_at}
    )`
  );

  return sql`
    insert into inbox_v2_provider_roster_member_evidence (
      tenant_id,
      id,
      roster_evidence_id,
      source_thread_binding_id,
      external_thread_id,
      source_connection_id,
      source_account_id,
      ordinal,
      source_external_identity_id,
      source_external_identity_revision,
      state,
      normalized_role,
      provider_state_code,
      provider_role_code,
      observed_at,
      roster_recorded_at,
      revision,
      created_at,
      updated_at
    ) values ${sql.join(values, sql`, `)}
    returning id
  `;
}

export function buildInsertInboxV2ProviderRosterMemberBatchesSql(
  records: readonly MemberPersistenceRecord[]
): readonly SQL[] {
  return chunks(records, INBOX_V2_PROVIDER_ROSTER_MEMBER_INSERT_BATCH_SIZE).map(
    buildInsertInboxV2ProviderRosterMemberBatchSql
  );
}

export function canonicalizeInboxV2ProviderRosterMembers(
  members: readonly InboxV2ProviderRosterMemberEvidence[],
  sourceIdentityRevisions: ReadonlyMap<string, bigint>
): readonly CanonicalMember[] {
  return orderInboxV2ProviderRosterMembersForDigest(
    members.map((member) => ({
      member,
      id: String(member.id),
      sourceExternalIdentityId: String(member.sourceExternalIdentity.id)
    }))
  ).map(({ member }, ordinal) => {
    const identityId = String(member.sourceExternalIdentity.id);
    const sourceIdentityRevision = sourceIdentityRevisions.get(identityId);
    if (sourceIdentityRevision === undefined) {
      throw invariantError(
        `Provider roster source identity revision is missing for ${identityId}.`
      );
    }
    return { member, ordinal, sourceIdentityRevision };
  });
}

export function computeInboxV2ProviderRosterMemberDigest(
  members: readonly CanonicalMember[]
): string {
  const hash = createHash("sha256");
  hash.update(INBOX_V2_PROVIDER_ROSTER_MEMBER_DIGEST_DOMAIN_V1, "utf8");
  for (const canonical of members) {
    hash.update(
      serializeInboxV2ProviderRosterMemberForDigest(toDigestInput(canonical)),
      "utf8"
    );
  }
  return hash.digest("hex");
}

function normalizeProviderRosterMaterializationCommit(
  input: InboxV2ProviderRosterMaterializationCommit
): NormalizedCommit {
  return inboxV2ProviderRosterMaterializationCommitSchema.parse(
    input
  ) as NormalizedCommit;
}

async function lockAndValidateSourceIdentities(
  executor: RawSqlExecutor,
  commit: NormalizedCommit
): Promise<
  | Readonly<{
      kind: "locked";
      revisions: ReadonlyMap<string, bigint>;
    }>
  | Extract<
      MaterializeInboxV2ProviderRosterEvidenceResult,
      {
        kind:
          | "member_identity_not_found"
          | "member_identity_scope_conflict"
          | "member_identity_provider_scope_unproven";
      }
    >
> {
  const identityIds = orderInboxV2ProviderRosterMembersForDigest(
    commit.members.map((member) => ({
      id: String(member.id),
      sourceExternalIdentityId: String(member.sourceExternalIdentity.id)
    }))
  ).map(
    ({ sourceExternalIdentityId }) =>
      sourceExternalIdentityId as InboxV2SourceExternalIdentityId
  );
  const rows: SourceIdentityLockRow[] = [];
  for (const statement of buildLockInboxV2ProviderRosterSourceIdentityBatchesSql(
    {
      tenantId: commit.tenantId,
      sourceExternalIdentityIds: identityIds
    }
  )) {
    const result = await executor.execute<SourceIdentityLockRow>(statement);
    rows.push(...result.rows);
  }

  const rowsById = new Map(rows.map((row) => [String(row.id), row]));
  const revisions = new Map<string, bigint>();
  const binding = commit.currentBindingProjection.binding;
  const adapterContract = binding.capabilities.adapterContract;
  const observation = commit.evidence.observation;

  for (const member of commit.members) {
    const identityId = String(member.sourceExternalIdentity.id);
    const row = rowsById.get(identityId);
    if (row === undefined) {
      return {
        kind: "member_identity_not_found",
        sourceExternalIdentityId: member.sourceExternalIdentity.id
      };
    }
    const providerScopeProven =
      String(row.scope_kind) === "provider" &&
      String(row.declaration_contract_id) ===
        String(adapterContract.contractId) &&
      String(row.declaration_contract_version) ===
        String(adapterContract.contractVersion) &&
      String(row.declaration_surface_id) ===
        String(adapterContract.surfaceId) &&
      String(row.declaration_loaded_by_trusted_service_id) ===
        String(adapterContract.loadedByTrustedServiceId);
    if (String(row.scope_kind) === "provider" && !providerScopeProven) {
      return {
        kind: "member_identity_provider_scope_unproven",
        sourceExternalIdentityId: member.sourceExternalIdentity.id
      };
    }

    const scoped =
      providerScopeProven ||
      (String(row.scope_kind) === "source_connection" &&
        String(row.scope_source_connection_id) ===
          String(binding.sourceConnection.id) &&
        row.scope_source_account_id === null) ||
      (String(row.scope_kind) === "source_account" &&
        String(row.scope_source_account_id) ===
          String(binding.sourceAccount.id) &&
        row.scope_source_connection_id === null);
    const observationScoped =
      String(row.stability_kind) !== "observation_ephemeral" ||
      (observation.kind === "raw_inbound_event"
        ? String(row.ephemeral_raw_inbound_event_id) ===
            String(observation.id) &&
          row.ephemeral_normalized_inbound_event_id === null
        : String(row.ephemeral_normalized_inbound_event_id) ===
            String(observation.id) &&
          row.ephemeral_raw_inbound_event_id === null);
    if (
      !scoped ||
      !observationScoped ||
      !timestampAtOrBefore(row.declaration_loaded_at, commit.materializedAt) ||
      !timestampAtOrBefore(row.materialized_at, commit.materializedAt) ||
      !timestampAtOrBefore(row.created_at, commit.materializedAt) ||
      !timestampAtOrBefore(row.updated_at, commit.materializedAt)
    ) {
      return {
        kind: "member_identity_scope_conflict",
        sourceExternalIdentityId: member.sourceExternalIdentity.id
      };
    }

    revisions.set(
      identityId,
      BigInt(
        parseDatabaseBigint(
          row.revision,
          `SourceExternalIdentity(${identityId}).revision`
        )
      )
    );
  }

  return { kind: "locked", revisions };
}

async function findExistingMemberIdConflict(
  executor: RawSqlExecutor,
  commit: NormalizedCommit
): Promise<MaterializeInboxV2ProviderRosterEvidenceResult | null> {
  const ids = orderInboxV2ProviderRosterMemberEvidenceIdsForLock(
    commit.members
  );
  let firstForeignMemberId: InboxV2ProviderRosterMemberEvidenceId | null = null;

  for (const batch of chunks(
    ids,
    INBOX_V2_PROVIDER_ROSTER_IDENTITY_LOCK_BATCH_SIZE
  )) {
    if (batch.length === 0) continue;
    const result = await executor.execute<ExistingMemberRow>(
      buildFindInboxV2ProviderRosterMemberIdsSql({
        tenantId: commit.tenantId,
        memberEvidenceIds: batch
      })
    );

    // Under READ COMMITTED the root can become visible after the initial
    // idempotency lookup but before this member-ID statement. Preserve root-ID
    // precedence: a member from that same immutable aggregate means this is an
    // idempotent replay or a root payload conflict, not a foreign member-ID
    // collision.
    if (
      result.rows.some(
        (row) => String(row.roster_evidence_id) === String(commit.evidence.id)
      )
    ) {
      const existingRoster = await loadExistingRoster(executor, commit);
      if (existingRoster === null) {
        throw invariantError(
          "Provider roster member points to the current evidence ID, but its aggregate is missing."
        );
      }
      return existingRoster;
    }

    if (firstForeignMemberId === null && result.rows[0] !== undefined) {
      firstForeignMemberId = String(
        result.rows[0].id
      ) as InboxV2ProviderRosterMemberEvidenceId;
    }
  }
  return firstForeignMemberId === null
    ? null
    : {
        kind: "roster_member_evidence_id_conflict",
        memberEvidenceId: firstForeignMemberId
      };
}

/**
 * Member-ID locks use their own bytewise key, independently of whichever
 * source identity a competing command associates with the same immutable ID.
 */
export function orderInboxV2ProviderRosterMemberEvidenceIdsForLock(
  members: readonly InboxV2ProviderRosterMemberEvidence[]
): readonly InboxV2ProviderRosterMemberEvidenceId[] {
  return orderInboxV2ProviderRosterMembersForDigest(
    members.map((member) => ({
      id: String(member.id),
      sourceExternalIdentityId: String(member.id),
      memberEvidenceId: member.id
    }))
  ).map(({ memberEvidenceId }) => memberEvidenceId);
}

function classifyBindingConflict(
  row: BindingLockRow,
  commit: NormalizedCommit
):
  | "binding_snapshot_conflict"
  | "adapter_surface_conflict"
  | "capability_revision_conflict"
  | "authority_conflict"
  | null {
  const binding = commit.currentBindingProjection.binding;
  const adapter = binding.capabilities.adapterContract;
  const expectedRevision = String(binding.revision);

  if (
    String(row.binding_id) !== String(binding.id) ||
    String(row.external_thread_id) !== String(binding.externalThread.id) ||
    String(row.source_connection_id) !== String(binding.sourceConnection.id) ||
    String(row.source_account_id) !== String(binding.sourceAccount.id) ||
    String(row.snapshot_binding_id) !== String(binding.id) ||
    String(row.snapshot_external_thread_id) !==
      String(binding.externalThread.id) ||
    String(row.snapshot_source_connection_id) !==
      String(binding.sourceConnection.id) ||
    String(row.snapshot_source_account_id) !==
      String(binding.sourceAccount.id) ||
    parseDatabaseBigint(row.binding_revision, "binding head revision") !==
      expectedRevision ||
    parseDatabaseBigint(row.snapshot_revision, "binding snapshot revision") !==
      expectedRevision ||
    parseDatabaseBigint(row.binding_generation, "binding generation") !==
      String(binding.bindingGeneration) ||
    parseDatabaseBigint(
      row.snapshot_binding_generation,
      "binding snapshot generation"
    ) !== String(binding.bindingGeneration) ||
    !timestampAtOrBefore(row.created_at, commit.materializedAt) ||
    !timestampAtOrBefore(row.updated_at, commit.materializedAt) ||
    !timestampAtOrBefore(row.snapshot_created_at, commit.materializedAt) ||
    !timestampAtOrBefore(row.snapshot_updated_at, commit.materializedAt)
  ) {
    return "binding_snapshot_conflict";
  }

  if (
    !sameAdapterSnapshot(row, "", adapter) ||
    !sameAdapterSnapshot(row, "snapshot_", adapter)
  ) {
    return "adapter_surface_conflict";
  }

  if (
    parseDatabaseBigint(
      row.capability_revision,
      "binding capability revision"
    ) !== String(binding.capabilities.revision) ||
    parseDatabaseBigint(
      row.snapshot_capability_revision,
      "binding snapshot capability revision"
    ) !== String(binding.capabilities.revision)
  ) {
    return "capability_revision_conflict";
  }

  if (
    String(row.capability_loaded_by_trusted_service_id) !==
      String(commit.authority.trustedServiceId) ||
    String(row.snapshot_capability_loaded_by_trusted_service_id) !==
      String(commit.authority.trustedServiceId)
  ) {
    return "authority_conflict";
  }

  return null;
}

function sameAdapterSnapshot(
  row: BindingLockRow,
  prefix: "" | "snapshot_",
  adapter: NormalizedCommit["currentBindingProjection"]["binding"]["capabilities"]["adapterContract"]
): boolean {
  const values = row as unknown as Record<string, unknown>;
  return (
    String(values[`${prefix}capability_contract_id`]) ===
      String(adapter.contractId) &&
    String(values[`${prefix}capability_contract_version`]) ===
      String(adapter.contractVersion) &&
    parseDatabaseBigint(
      values[`${prefix}capability_declaration_revision`],
      `${prefix}capability declaration revision`
    ) === String(adapter.declarationRevision) &&
    String(values[`${prefix}capability_surface_id`]) ===
      String(adapter.surfaceId) &&
    sameTimestamp(values[`${prefix}capability_loaded_at`], adapter.loadedAt)
  );
}

function observationMatchesCommit(
  row: ObservationLockRow,
  commit: NormalizedCommit
): boolean {
  const binding = commit.currentBindingProjection.binding;
  return (
    String(row.id) === String(commit.evidence.observation.id) &&
    String(row.source_connection_id) === String(binding.sourceConnection.id) &&
    String(row.source_account_id) === String(binding.sourceAccount.id) &&
    timestampAtOrBefore(row.evidence_at, commit.materializedAt)
  );
}

function toRosterPersistenceRecord(
  commit: NormalizedCommit,
  orderedMemberDigestSha256: string
) {
  const binding = commit.currentBindingProjection.binding;
  const adapter = binding.capabilities.adapterContract;
  const observation = commit.evidence.observation;
  return {
    tenant_id: commit.tenantId,
    id: commit.evidence.id,
    source_thread_binding_id: binding.id,
    external_thread_id: binding.externalThread.id,
    source_connection_id: binding.sourceConnection.id,
    source_account_id: binding.sourceAccount.id,
    binding_revision: String(binding.revision),
    binding_generation: String(binding.bindingGeneration),
    adapter_contract_id: adapter.contractId,
    adapter_contract_version: adapter.contractVersion,
    adapter_declaration_revision: String(adapter.declarationRevision),
    adapter_surface_id: adapter.surfaceId,
    adapter_loaded_by_trusted_service_id: adapter.loadedByTrustedServiceId,
    adapter_loaded_at: adapter.loadedAt,
    capability_revision: String(binding.capabilities.revision),
    observation_kind: observation.kind,
    raw_inbound_event_id:
      observation.kind === "raw_inbound_event" ? observation.id : null,
    normalized_inbound_event_id:
      observation.kind === "normalized_inbound_event" ? observation.id : null,
    completeness: commit.evidence.completeness,
    authority: commit.evidence.authority,
    omission_policy: commit.evidence.omissionPolicy,
    ordering_kind: commit.evidence.ordering.kind,
    ordering_scope_token: commit.evidence.ordering.scopeToken,
    ordering_comparator_id: commit.evidence.ordering.comparatorId,
    ordering_comparator_revision: String(
      commit.evidence.ordering.comparatorRevision
    ),
    ordering_position: String(commit.evidence.ordering.position),
    watermark: commit.evidence.watermark,
    member_count: commit.members.length,
    ordered_member_digest_sha256: orderedMemberDigestSha256,
    materialized_by_trusted_service_id: commit.authority.trustedServiceId,
    materialization_authorization_token: commit.authority.authorizationToken,
    observed_at: commit.evidence.observedAt,
    recorded_at: commit.materializedAt,
    revision: String(commit.evidence.revision),
    created_at: commit.materializedAt,
    updated_at: commit.materializedAt
  } as const;
}

function toMemberPersistenceRecord(
  commit: NormalizedCommit,
  canonical: CanonicalMember
) {
  const binding = commit.currentBindingProjection.binding;
  const member = canonical.member;
  return {
    tenant_id: commit.tenantId,
    id: member.id,
    roster_evidence_id: commit.evidence.id,
    source_thread_binding_id: binding.id,
    external_thread_id: binding.externalThread.id,
    source_connection_id: binding.sourceConnection.id,
    source_account_id: binding.sourceAccount.id,
    ordinal: canonical.ordinal,
    source_external_identity_id: member.sourceExternalIdentity.id,
    source_external_identity_revision:
      canonical.sourceIdentityRevision.toString(),
    state: member.state,
    normalized_role: member.normalizedRole,
    provider_state_code: member.providerStateCode,
    provider_role_code: member.providerRoleCode,
    observed_at: member.observedAt,
    roster_recorded_at: commit.materializedAt,
    revision: String(member.revision),
    created_at: commit.materializedAt,
    updated_at: commit.materializedAt
  } as const;
}

function toDigestInput(
  canonical: CanonicalMember
): InboxV2ProviderRosterMemberDigestInput {
  const member = canonical.member;
  return {
    id: String(member.id),
    ordinal: canonical.ordinal,
    sourceExternalIdentityId: String(member.sourceExternalIdentity.id),
    sourceExternalIdentityRevision: canonical.sourceIdentityRevision,
    state: member.state,
    normalizedRole: member.normalizedRole,
    providerStateCode: member.providerStateCode,
    providerRoleCode: member.providerRoleCode,
    observedAtEpochMilliseconds: BigInt(Date.parse(member.observedAt))
  };
}

async function loadExistingRoster(
  executor: RawSqlExecutor,
  commit: NormalizedCommit
): Promise<MaterializeInboxV2ProviderRosterEvidenceResult | null> {
  const input = {
    tenantId: commit.tenantId,
    evidenceId: commit.evidence.id
  };
  const row = requireAtMostOneRow(
    await executor.execute<ExistingRosterRow>(
      buildFindInboxV2ProviderRosterEvidenceByIdSql(input)
    ),
    "Provider roster evidence lookup"
  );
  if (row === null) return null;

  const members = await executor.execute<ExistingMemberRow>(
    buildListInboxV2ProviderRosterMembersSql(input)
  );
  const digest = nullableString(row.ordered_member_digest_sha256);
  if (
    digest === null ||
    !/^[0-9a-f]{64}$/.test(digest) ||
    !sameRosterPersistenceRecord(row, commit, digest) ||
    !sameRosterMembers(members.rows, commit, digest)
  ) {
    return {
      kind: "roster_evidence_id_conflict",
      evidenceId: commit.evidence.id
    };
  }

  return {
    kind: "already_materialized",
    evidence: commit.evidence,
    members: canonicalizeMembersWithoutIdentityRevision(commit.members)
  };
}

function sameRosterPersistenceRecord(
  row: ExistingRosterRow,
  commit: NormalizedCommit,
  storedDigest: string
): boolean {
  return samePersistenceRecord(
    row,
    toRosterPersistenceRecord(commit, storedDigest),
    {
      timestampFields: new Set([
        "adapter_loaded_at",
        "observed_at",
        "recorded_at",
        "created_at",
        "updated_at"
      ]),
      bigintFields: new Set([
        "binding_revision",
        "binding_generation",
        "adapter_declaration_revision",
        "capability_revision",
        "ordering_comparator_revision",
        "ordering_position",
        "revision"
      ]),
      numberFields: new Set(["member_count"]),
      operation: "ProviderRosterEvidence"
    }
  );
}

function sameRosterMembers(
  rows: readonly ExistingMemberRow[],
  commit: NormalizedCommit,
  storedDigest: string
): boolean {
  const members = canonicalizeMembersWithoutIdentityRevision(commit.members);
  if (rows.length !== members.length) return false;

  const canonical: CanonicalMember[] = [];
  for (const [ordinal, member] of members.entries()) {
    const row = rows[ordinal];
    if (row === undefined) return false;
    const revision = BigInt(
      parseDatabaseBigint(
        row.source_external_identity_revision,
        `ProviderRosterMemberEvidence(${String(member.id)}).source_external_identity_revision`
      )
    );
    if (revision < 1n) return false;

    const expected: CanonicalMember = {
      member,
      ordinal,
      sourceIdentityRevision: revision
    };
    if (!sameRosterMemberPersistenceRecord(row, commit, expected)) {
      return false;
    }
    canonical.push(expected);
  }

  return computeInboxV2ProviderRosterMemberDigest(canonical) === storedDigest;
}

function sameRosterMemberPersistenceRecord(
  row: ExistingMemberRow,
  commit: NormalizedCommit,
  canonical: CanonicalMember
): boolean {
  return samePersistenceRecord(
    row,
    toMemberPersistenceRecord(commit, canonical),
    {
      timestampFields: new Set([
        "observed_at",
        "roster_recorded_at",
        "created_at",
        "updated_at"
      ]),
      bigintFields: new Set(["source_external_identity_revision", "revision"]),
      numberFields: new Set(["ordinal"]),
      operation: "ProviderRosterMemberEvidence"
    }
  );
}

function samePersistenceRecord(
  row: Record<string, unknown>,
  expected: Record<string, unknown>,
  options: Readonly<{
    timestampFields: ReadonlySet<string>;
    bigintFields: ReadonlySet<string>;
    numberFields: ReadonlySet<string>;
    operation: string;
  }>
): boolean {
  for (const [field, expectedValue] of Object.entries(expected)) {
    const actual = row[field];
    if (options.timestampFields.has(field)) {
      if (!sameTimestamp(actual, String(expectedValue))) return false;
      continue;
    }
    if (options.bigintFields.has(field)) {
      if (
        parseDatabaseBigint(actual, `${options.operation}.${field}`) !==
        String(expectedValue)
      ) {
        return false;
      }
      continue;
    }
    if (options.numberFields.has(field)) {
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

function canonicalizeMembersWithoutIdentityRevision(
  members: readonly InboxV2ProviderRosterMemberEvidence[]
): readonly InboxV2ProviderRosterMemberEvidence[] {
  return orderInboxV2ProviderRosterMembersForDigest(
    members.map((member) => ({
      member,
      id: String(member.id),
      sourceExternalIdentityId: String(member.sourceExternalIdentity.id)
    }))
  ).map(({ member }) => member);
}

async function resolveUniqueConflict(
  executor: RawSqlExecutor,
  commit: NormalizedCommit
): Promise<MaterializeInboxV2ProviderRosterEvidenceResult | null> {
  const roster = await loadExistingRoster(executor, commit);
  if (roster !== null) return roster;
  return findExistingMemberIdConflict(executor, commit);
}

async function runProviderRosterTransaction<TResult>(
  executor: InboxV2ProviderRosterEvidenceTransactionExecutor,
  work: (transaction: RawSqlExecutor) => Promise<TResult>
): Promise<TResult> {
  for (
    let attempt = 1;
    attempt <= PROVIDER_ROSTER_TRANSACTION_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await executor.transaction(
        work,
        PROVIDER_ROSTER_TRANSACTION_CONFIG
      );
    } catch (error) {
      if (
        attempt === PROVIDER_ROSTER_TRANSACTION_ATTEMPTS ||
        !RETRYABLE_PROVIDER_ROSTER_SQLSTATES.has(sqlState(error) ?? "")
      ) {
        throw error;
      }
    }
  }
  throw invariantError("Provider roster transaction retry loop exhausted.");
}

function timestampAtOrBefore(value: unknown, boundary: string): boolean {
  return (
    Date.parse(parseDatabaseTimestamp(value, "persistence timestamp")) <=
    Date.parse(boundary)
  );
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

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  if (!Number.isSafeInteger(size) || size < 1) {
    throw invariantError(
      "Provider roster batch size must be a positive integer."
    );
  }
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    result.push(values.slice(offset, offset + size));
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sqlState(error: unknown): string | null {
  if (!isRecord(error)) return null;
  if (typeof error.code === "string") return error.code;
  return "cause" in error ? sqlState(error.cause) : null;
}

function invariantError(message: string): InboxV2PersistenceInvariantError {
  return new InboxV2PersistenceInvariantError(message);
}

export type { RawSqlExecutor, RawSqlQueryResult };
