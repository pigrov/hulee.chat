import { sql, type SQLWrapper } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique
} from "drizzle-orm/pg-core";

import {
  normalizedInboundEvents,
  rawInboundEvents,
  sourceAccounts,
  sourceConnections,
  tenants
} from "../tables";
import { inboxV2SourceExternalIdentities } from "./identity-foundation";
import {
  inboxV2SourceThreadBindingSnapshots,
  inboxV2SourceThreadBindings
} from "./source-thread-binding";

export const inboxV2ProviderRosterObservationKind = pgEnum(
  "inbox_v2_provider_roster_observation_kind",
  ["raw_inbound_event", "normalized_inbound_event"]
);

export const inboxV2ProviderRosterCompleteness = pgEnum(
  "inbox_v2_provider_roster_completeness",
  ["unknown", "partial", "complete"]
);

export const inboxV2ProviderRosterAuthority = pgEnum(
  "inbox_v2_provider_roster_authority",
  ["advisory", "authoritative"]
);

export const inboxV2ProviderRosterOmissionPolicy = pgEnum(
  "inbox_v2_provider_roster_omission_policy",
  ["retain_missing", "close_missing"]
);

export const inboxV2ProviderRosterMemberState = pgEnum(
  "inbox_v2_provider_roster_member_state",
  ["present", "left", "removed", "unknown"]
);

/**
 * Provider roles are observation evidence only. Keeping this vocabulary in a
 * roster-owned enum prevents a provider role from becoming a Hulee RBAC grant.
 */
export const inboxV2ProviderRosterNormalizedRole = pgEnum(
  "inbox_v2_provider_roster_normalized_role",
  ["owner", "admin", "member", "guest", "observer", "unknown"]
);

export const INBOX_V2_PROVIDER_ROSTER_MEMBER_DIGEST_DOMAIN_V1 =
  "inbox-v2-provider-roster-members:v1|" as const;

export type InboxV2ProviderRosterMemberDigestInput = Readonly<{
  id: string;
  ordinal: number;
  sourceExternalIdentityId: string;
  sourceExternalIdentityRevision: bigint;
  state: "present" | "left" | "removed" | "unknown";
  normalizedRole:
    | "owner"
    | "admin"
    | "member"
    | "guest"
    | "observer"
    | "unknown";
  providerStateCode: string;
  providerRoleCode: string | null;
  observedAtEpochMilliseconds: bigint;
}>;

const utf8Encoder = new TextEncoder();

/**
 * Canonical repository mirror for the database digest below.
 *
 * Members are ordered by the unsigned UTF-8 bytes of
 * `sourceExternalIdentityId`, then by the unsigned UTF-8 bytes of `id` as a
 * deterministic fail-closed tie-breaker (a valid aggregate cannot contain the
 * same identity twice). After assigning contiguous zero-based ordinals, the
 * SHA-256 preimage is the exported domain prefix followed by these records in
 * ordinal order. Every nullable string uses `-1:`; every non-null string uses
 * `<UTF-8-byte-length>:<value>`. Numeric values are base-10 ASCII. The database
 * stores timestamps at millisecond precision, so the final numeric field is
 * Unix epoch milliseconds.
 */
export function serializeInboxV2ProviderRosterMemberForDigest(
  member: InboxV2ProviderRosterMemberDigestInput
): string {
  return [
    `${member.ordinal}|`,
    lengthPrefixUtf8(member.id),
    lengthPrefixUtf8(member.sourceExternalIdentityId),
    `${member.sourceExternalIdentityRevision.toString()}|`,
    lengthPrefixUtf8(member.state),
    lengthPrefixUtf8(member.normalizedRole),
    lengthPrefixUtf8(member.providerStateCode),
    lengthPrefixUtf8(member.providerRoleCode),
    `${member.observedAtEpochMilliseconds.toString()};`
  ].join("");
}

/** Returns a copy in the exact bytewise order enforced by PostgreSQL. */
export function orderInboxV2ProviderRosterMembersForDigest<
  T extends Pick<
    InboxV2ProviderRosterMemberDigestInput,
    "id" | "sourceExternalIdentityId"
  >
>(members: readonly T[]): T[] {
  return [...members].sort((left, right) => {
    const identityOrder = compareUtf8Bytes(
      left.sourceExternalIdentityId,
      right.sourceExternalIdentityId
    );
    return identityOrder === 0
      ? compareUtf8Bytes(left.id, right.id)
      : identityOrder;
  });
}

/**
 * One immutable roster observation for one exact binding/account snapshot.
 * SourceOccurrence is intentionally not required: providers may emit roster
 * snapshots or deltas without an external-message identity.
 */
export const inboxV2ProviderRosterEvidence = pgTable(
  "inbox_v2_provider_roster_evidence",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    sourceThreadBindingId: text("source_thread_binding_id").notNull(),
    externalThreadId: text("external_thread_id").notNull(),
    sourceConnectionId: text("source_connection_id").notNull(),
    sourceAccountId: text("source_account_id").notNull(),
    bindingRevision: bigint("binding_revision", { mode: "bigint" }).notNull(),
    bindingGeneration: bigint("binding_generation", {
      mode: "bigint"
    }).notNull(),
    adapterContractId: text("adapter_contract_id").notNull(),
    adapterContractVersion: text("adapter_contract_version").notNull(),
    adapterDeclarationRevision: bigint("adapter_declaration_revision", {
      mode: "bigint"
    }).notNull(),
    adapterSurfaceId: text("adapter_surface_id").notNull(),
    adapterLoadedByTrustedServiceId: text(
      "adapter_loaded_by_trusted_service_id"
    ).notNull(),
    adapterLoadedAt: timestamp("adapter_loaded_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    capabilityRevision: bigint("capability_revision", {
      mode: "bigint"
    }).notNull(),
    observationKind:
      inboxV2ProviderRosterObservationKind("observation_kind").notNull(),
    rawInboundEventId: text("raw_inbound_event_id"),
    normalizedInboundEventId: text("normalized_inbound_event_id"),
    completeness: inboxV2ProviderRosterCompleteness("completeness").notNull(),
    authority: inboxV2ProviderRosterAuthority("authority").notNull(),
    omissionPolicy:
      inboxV2ProviderRosterOmissionPolicy("omission_policy").notNull(),
    orderingKind: text("ordering_kind").notNull(),
    orderingScopeToken: text("ordering_scope_token").notNull(),
    orderingComparatorId: text("ordering_comparator_id").notNull(),
    orderingComparatorRevision: bigint("ordering_comparator_revision", {
      mode: "bigint"
    }).notNull(),
    orderingPosition: bigint("ordering_position", { mode: "bigint" }).notNull(),
    watermark: text("watermark"),
    memberCount: integer("member_count").notNull(),
    orderedMemberDigestSha256: text("ordered_member_digest_sha256").notNull(),
    materializedByTrustedServiceId: text(
      "materialized_by_trusted_service_id"
    ).notNull(),
    materializationAuthorizationToken: text(
      "materialization_authorization_token"
    ).notNull(),
    observedAt: timestamp("observed_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    recordedAt: timestamp("recorded_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_provider_roster_evidence_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_provider_roster_evidence_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_provider_roster_binding_edge_fk",
      columns: [
        table.tenantId,
        table.sourceThreadBindingId,
        table.externalThreadId,
        table.sourceConnectionId,
        table.sourceAccountId
      ],
      foreignColumns: [
        inboxV2SourceThreadBindings.tenantId,
        inboxV2SourceThreadBindings.id,
        inboxV2SourceThreadBindings.externalThreadId,
        inboxV2SourceThreadBindings.sourceConnectionId,
        inboxV2SourceThreadBindings.sourceAccountId
      ]
    }),
    foreignKey({
      name: "inbox_v2_provider_roster_binding_snapshot_fk",
      columns: [
        table.tenantId,
        table.sourceThreadBindingId,
        table.bindingRevision
      ],
      foreignColumns: [
        inboxV2SourceThreadBindingSnapshots.tenantId,
        inboxV2SourceThreadBindingSnapshots.bindingId,
        inboxV2SourceThreadBindingSnapshots.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_provider_roster_connection_fk",
      columns: [table.tenantId, table.sourceConnectionId],
      foreignColumns: [sourceConnections.tenantId, sourceConnections.id]
    }),
    foreignKey({
      name: "inbox_v2_provider_roster_account_edge_fk",
      columns: [
        table.tenantId,
        table.sourceAccountId,
        table.sourceConnectionId
      ],
      foreignColumns: [
        sourceAccounts.tenantId,
        sourceAccounts.id,
        sourceAccounts.sourceConnectionId
      ]
    }),
    foreignKey({
      name: "inbox_v2_provider_roster_raw_connection_fk",
      columns: [
        table.tenantId,
        table.rawInboundEventId,
        table.sourceConnectionId
      ],
      foreignColumns: [
        rawInboundEvents.tenantId,
        rawInboundEvents.id,
        rawInboundEvents.sourceConnectionId
      ]
    }),
    foreignKey({
      name: "inbox_v2_provider_roster_raw_account_fk",
      columns: [table.tenantId, table.rawInboundEventId, table.sourceAccountId],
      foreignColumns: [
        rawInboundEvents.tenantId,
        rawInboundEvents.id,
        rawInboundEvents.sourceAccountId
      ]
    }),
    foreignKey({
      name: "inbox_v2_provider_roster_normalized_connection_fk",
      columns: [
        table.tenantId,
        table.normalizedInboundEventId,
        table.sourceConnectionId
      ],
      foreignColumns: [
        normalizedInboundEvents.tenantId,
        normalizedInboundEvents.id,
        normalizedInboundEvents.sourceConnectionId
      ]
    }),
    foreignKey({
      name: "inbox_v2_provider_roster_normalized_account_fk",
      columns: [
        table.tenantId,
        table.normalizedInboundEventId,
        table.sourceAccountId
      ],
      foreignColumns: [
        normalizedInboundEvents.tenantId,
        normalizedInboundEvents.id,
        normalizedInboundEvents.sourceAccountId
      ]
    }),
    unique("inbox_v2_provider_roster_member_edge_unique").on(
      table.tenantId,
      table.id,
      table.sourceThreadBindingId,
      table.externalThreadId,
      table.sourceConnectionId,
      table.sourceAccountId,
      table.observedAt,
      table.recordedAt
    ),
    unique("inbox_v2_provider_roster_binding_target_unique").on(
      table.tenantId,
      table.id,
      table.sourceThreadBindingId
    ),
    unique("inbox_v2_provider_roster_exact_target_unique").on(
      table.tenantId,
      table.id,
      table.sourceThreadBindingId,
      table.sourceConnectionId,
      table.sourceAccountId
    ),
    unique("inbox_v2_provider_roster_ordering_position_unique").on(
      table.tenantId,
      table.sourceThreadBindingId,
      table.orderingScopeToken,
      table.orderingComparatorId,
      table.orderingComparatorRevision,
      table.orderingPosition
    ),
    check(
      "inbox_v2_provider_roster_evidence_id_check",
      sql`char_length(${table.id}) <= 256
        and ${table.id} ~ '^provider_roster_evidence:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'`
    ),
    check(
      "inbox_v2_provider_roster_observation_xor_check",
      sql`(
          ${table.observationKind} = 'raw_inbound_event'
          and ${table.rawInboundEventId} is not null
          and ${table.normalizedInboundEventId} is null
        ) or (
          ${table.observationKind} = 'normalized_inbound_event'
          and ${table.rawInboundEventId} is null
          and ${table.normalizedInboundEventId} is not null
        )`
    ),
    check(
      "inbox_v2_provider_roster_omission_semantics_check",
      sql`${table.omissionPolicy} = 'retain_missing'
        or (
          ${table.omissionPolicy} = 'close_missing'
          and ${table.completeness} = 'complete'
          and ${table.authority} = 'authoritative'
        )`
    ),
    check(
      "inbox_v2_provider_roster_adapter_check",
      sql`${catalogIdSql(table.adapterContractId)}
        and ${versionTokenSql(table.adapterContractVersion)}
        and ${table.adapterDeclarationRevision} >= 1
        and ${catalogIdSql(table.adapterSurfaceId)}
        and ${catalogIdSql(table.adapterLoadedByTrustedServiceId)}
        and ${table.capabilityRevision} >= 1
        and isfinite(${table.adapterLoadedAt})
        and ${table.adapterLoadedAt} <= ${table.observedAt}
        and ${table.adapterLoadedAt} <= ${table.recordedAt}`
    ),
    check(
      "inbox_v2_provider_roster_ordering_check",
      sql`${table.orderingKind} = 'adapter_monotonic'
        and char_length(${table.orderingScopeToken}) between 8 and 256
        and ${table.orderingScopeToken} ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
        and ${catalogIdSql(table.orderingComparatorId)}
        and ${table.orderingComparatorRevision} >= 1
        and ${table.orderingPosition} >= 1`
    ),
    check(
      "inbox_v2_provider_roster_materialization_check",
      sql`${table.materializedByTrustedServiceId} =
          ${table.adapterLoadedByTrustedServiceId}
        and ${catalogIdSql(table.materializedByTrustedServiceId)}
        and ${routingTokenSql(table.materializationAuthorizationToken)}`
    ),
    check(
      "inbox_v2_provider_roster_values_check",
      sql`${table.bindingRevision} >= 1
        and ${table.bindingGeneration} >= 1
        and ${table.memberCount} between 0 and 50000
        and ${sha256DigestSql(table.orderedMemberDigestSha256)}
        and (
          ${table.watermark} is null
          or (
            char_length(${table.watermark}) between 1 and 512
            and ${table.watermark} !~ '[\\x00-\\x1F\\x7F]'
          )
        )
        and ${table.revision} = 1`
    ),
    check(
      "inbox_v2_provider_roster_timestamps_check",
      sql`isfinite(${table.observedAt})
        and isfinite(${table.recordedAt})
        and isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.observedAt} <= ${table.recordedAt}
        and ${table.recordedAt} = ${table.createdAt}
        and ${table.createdAt} = ${table.updatedAt}`
    ),
    index("inbox_v2_provider_roster_tenant_binding_idx").on(
      table.tenantId,
      table.sourceThreadBindingId,
      table.observedAt.desc(),
      table.id
    ),
    index("inbox_v2_provider_roster_tenant_account_idx").on(
      table.tenantId,
      table.sourceAccountId,
      table.observedAt.desc(),
      table.id
    ),
    index("inbox_v2_provider_roster_tenant_raw_idx").on(
      table.tenantId,
      table.rawInboundEventId,
      table.id
    ),
    index("inbox_v2_provider_roster_tenant_normalized_idx").on(
      table.tenantId,
      table.normalizedInboundEventId,
      table.id
    )
  ]
);

/** One immutable, canonically ordered member of a roster observation. */
export const inboxV2ProviderRosterMemberEvidence = pgTable(
  "inbox_v2_provider_roster_member_evidence",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    rosterEvidenceId: text("roster_evidence_id").notNull(),
    sourceThreadBindingId: text("source_thread_binding_id").notNull(),
    externalThreadId: text("external_thread_id").notNull(),
    sourceConnectionId: text("source_connection_id").notNull(),
    sourceAccountId: text("source_account_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    sourceExternalIdentityId: text("source_external_identity_id").notNull(),
    sourceExternalIdentityRevision: bigint(
      "source_external_identity_revision",
      { mode: "bigint" }
    ).notNull(),
    state: inboxV2ProviderRosterMemberState("state").notNull(),
    normalizedRole:
      inboxV2ProviderRosterNormalizedRole("normalized_role").notNull(),
    providerStateCode: text("provider_state_code").notNull(),
    providerRoleCode: text("provider_role_code"),
    observedAt: timestamp("observed_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    rosterRecordedAt: timestamp("roster_recorded_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_provider_roster_member_evidence_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_provider_roster_member_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_provider_roster_member_roster_edge_fk",
      columns: [
        table.tenantId,
        table.rosterEvidenceId,
        table.sourceThreadBindingId,
        table.externalThreadId,
        table.sourceConnectionId,
        table.sourceAccountId,
        table.observedAt,
        table.rosterRecordedAt
      ],
      foreignColumns: [
        inboxV2ProviderRosterEvidence.tenantId,
        inboxV2ProviderRosterEvidence.id,
        inboxV2ProviderRosterEvidence.sourceThreadBindingId,
        inboxV2ProviderRosterEvidence.externalThreadId,
        inboxV2ProviderRosterEvidence.sourceConnectionId,
        inboxV2ProviderRosterEvidence.sourceAccountId,
        inboxV2ProviderRosterEvidence.observedAt,
        inboxV2ProviderRosterEvidence.recordedAt
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_provider_roster_member_identity_fk",
      columns: [table.tenantId, table.sourceExternalIdentityId],
      foreignColumns: [
        inboxV2SourceExternalIdentities.tenantId,
        inboxV2SourceExternalIdentities.id
      ]
    }),
    unique("inbox_v2_provider_roster_member_ordinal_unique").on(
      table.tenantId,
      table.rosterEvidenceId,
      table.ordinal
    ),
    unique("inbox_v2_provider_roster_member_identity_unique").on(
      table.tenantId,
      table.rosterEvidenceId,
      table.sourceExternalIdentityId
    ),
    unique("inbox_v2_provider_roster_member_target_unique").on(
      table.tenantId,
      table.id,
      table.rosterEvidenceId,
      table.sourceThreadBindingId,
      table.sourceExternalIdentityId
    ),
    unique("inbox_v2_provider_roster_member_exact_target_unique").on(
      table.tenantId,
      table.id,
      table.sourceThreadBindingId,
      table.sourceConnectionId,
      table.sourceAccountId
    ),
    check(
      "inbox_v2_provider_roster_member_id_check",
      sql`char_length(${table.id}) <= 256
        and ${table.id} ~ '^provider_roster_member_evidence:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'`
    ),
    check(
      "inbox_v2_provider_roster_member_values_check",
      sql`${table.ordinal} between 0 and 49999
        and ${table.sourceExternalIdentityRevision} >= 1
        and char_length(${table.providerStateCode}) between 1 and 512
        and ${table.providerStateCode} !~ '[\\x00-\\x1F\\x7F]'
        and (
          ${table.providerRoleCode} is null
          or (
            char_length(${table.providerRoleCode}) between 1 and 512
            and ${table.providerRoleCode} !~ '[\\x00-\\x1F\\x7F]'
          )
        )
        and ${table.revision} = 1`
    ),
    check(
      "inbox_v2_provider_roster_member_timestamps_check",
      sql`isfinite(${table.observedAt})
        and isfinite(${table.rosterRecordedAt})
        and isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.observedAt} <= ${table.rosterRecordedAt}
        and ${table.rosterRecordedAt} = ${table.createdAt}
        and ${table.createdAt} = ${table.updatedAt}`
    ),
    index("inbox_v2_provider_roster_member_tenant_roster_idx").on(
      table.tenantId,
      table.rosterEvidenceId,
      table.ordinal
    ),
    index("inbox_v2_provider_roster_member_tenant_identity_idx").on(
      table.tenantId,
      table.sourceExternalIdentityId,
      table.observedAt.desc(),
      table.id
    )
  ]
);

/**
 * Direct-DML fences for the immutable roster aggregate. Every lookup is scoped
 * to one tenant plus a primary/unique key, or to one bounded roster member set.
 *
 * Digest v1 mirrors `serializeInboxV2ProviderRosterMemberForDigest`: bytewise
 * identity/id order, zero-based ordinals, length-prefixed UTF-8 strings, epoch
 * milliseconds, and the exact domain prefix exported above.
 */
export const INBOX_V2_PROVIDER_ROSTER_EVIDENCE_INTEGRITY_SQL = String.raw`
alter table public.inbox_v2_source_thread_binding_evidence_references
  add constraint inbox_v2_binding_evidence_reference_roster_exact_fk
  foreign key (
    tenant_id,
    provider_roster_evidence_id,
    binding_id,
    source_connection_id,
    source_account_id
  )
  references public.inbox_v2_provider_roster_evidence (
    tenant_id,
    id,
    source_thread_binding_id,
    source_connection_id,
    source_account_id
  )
  on delete cascade;

alter table public.inbox_v2_source_thread_binding_evidence_references
  add constraint inbox_v2_binding_evidence_reference_roster_member_exact_fk
  foreign key (
    tenant_id,
    provider_roster_member_evidence_id,
    binding_id,
    source_connection_id,
    source_account_id
  )
  references public.inbox_v2_provider_roster_member_evidence (
    tenant_id,
    id,
    source_thread_binding_id,
    source_connection_id,
    source_account_id
  )
  on delete cascade;

create or replace function public.inbox_v2_provider_roster_guard_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  head_row public.inbox_v2_source_thread_binding_heads%rowtype;
  snapshot_row public.inbox_v2_source_thread_binding_snapshots%rowtype;
begin
  select * into head_row
    from public.inbox_v2_source_thread_binding_heads candidate_row
   where candidate_row.tenant_id = new.tenant_id
     and candidate_row.binding_id = new.source_thread_binding_id
   for share;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.provider_roster_binding_head_missing';
  end if;

  select * into snapshot_row
    from public.inbox_v2_source_thread_binding_snapshots candidate_row
   where candidate_row.tenant_id = new.tenant_id
     and candidate_row.binding_id = new.source_thread_binding_id
     and candidate_row.revision = new.binding_revision
   for share;

  if not found
     or head_row.revision <> new.binding_revision
     or head_row.external_thread_id <> new.external_thread_id
     or head_row.source_connection_id <> new.source_connection_id
     or head_row.source_account_id <> new.source_account_id
     or head_row.binding_generation <> new.binding_generation
     or head_row.capability_revision <> new.capability_revision
     or head_row.capability_contract_id <> new.adapter_contract_id
     or head_row.capability_contract_version <> new.adapter_contract_version
     or head_row.capability_declaration_revision <>
        new.adapter_declaration_revision
     or head_row.capability_surface_id <> new.adapter_surface_id
     or head_row.capability_loaded_by_trusted_service_id <>
        new.adapter_loaded_by_trusted_service_id
     or head_row.capability_loaded_at <> new.adapter_loaded_at
     or head_row.created_at > new.recorded_at
     or head_row.updated_at > new.recorded_at
     or snapshot_row.external_thread_id <> new.external_thread_id
     or snapshot_row.source_connection_id <> new.source_connection_id
     or snapshot_row.source_account_id <> new.source_account_id
     or snapshot_row.binding_generation <> new.binding_generation
     or snapshot_row.capability_revision <> new.capability_revision
     or snapshot_row.capability_contract_id <> new.adapter_contract_id
     or snapshot_row.capability_contract_version <>
        new.adapter_contract_version
     or snapshot_row.capability_declaration_revision <>
        new.adapter_declaration_revision
     or snapshot_row.capability_surface_id <> new.adapter_surface_id
     or snapshot_row.capability_loaded_by_trusted_service_id <>
        new.adapter_loaded_by_trusted_service_id
     or snapshot_row.capability_loaded_at <> new.adapter_loaded_at
     or snapshot_row.created_at > new.recorded_at
     or snapshot_row.updated_at > new.recorded_at then
    raise exception using
      errcode = '40001',
      message = 'inbox_v2.provider_roster_binding_fence_conflict';
  end if;

  if new.observation_kind = 'raw_inbound_event' then
    perform 1
      from public.raw_inbound_events event_row
     where event_row.tenant_id = new.tenant_id
       and event_row.id = new.raw_inbound_event_id
       and event_row.source_connection_id = new.source_connection_id
       and event_row.source_account_id = new.source_account_id
       and event_row.received_at <= new.recorded_at
     for share;
  else
    perform 1
      from public.normalized_inbound_events event_row
     where event_row.tenant_id = new.tenant_id
       and event_row.id = new.normalized_inbound_event_id
       and event_row.source_connection_id = new.source_connection_id
       and event_row.source_account_id = new.source_account_id
       and event_row.created_at <= new.recorded_at
     for share;
  end if;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.provider_roster_observation_scope_invalid';
  end if;

  return new;
end;
$function$;

create or replace function public.inbox_v2_provider_roster_member_guard_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  roster_row public.inbox_v2_provider_roster_evidence%rowtype;
  identity_scope_kind public.inbox_v2_source_identity_scope_kind;
  identity_scope_connection_id text;
  identity_scope_account_id text;
  identity_stability_kind public.inbox_v2_source_identity_stability_kind;
  identity_ephemeral_raw_event_id text;
  identity_ephemeral_normalized_event_id text;
  identity_declaration_contract_id text;
  identity_declaration_contract_version text;
  identity_declaration_surface_id text;
  identity_declaration_loaded_by_trusted_service_id text;
  identity_declaration_loaded_at timestamptz;
  identity_materialized_at timestamptz;
  identity_revision bigint;
  identity_created_at timestamptz;
  identity_updated_at timestamptz;
begin
  select * into roster_row
    from public.inbox_v2_provider_roster_evidence candidate_row
   where candidate_row.tenant_id = new.tenant_id
     and candidate_row.id = new.roster_evidence_id
   for share;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.provider_roster_member_roster_missing';
  end if;

  -- The root's deferred constraint seals every ordinal in [0, member_count).
  -- Once that root commits, the unique ordinal key leaves no slot for a late
  -- member insert. Keeping this bound in the row guard lets one root-level
  -- deferred scan validate the aggregate instead of repeating an O(N) digest
  -- for every member row.
  if new.ordinal < 0 or new.ordinal >= roster_row.member_count then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.provider_roster_member_ordinal_out_of_range';
  end if;

  select
    identity_row.scope_kind,
    identity_row.scope_source_connection_id,
    identity_row.scope_source_account_id,
    identity_row.stability_kind,
    identity_row.ephemeral_raw_inbound_event_id,
    identity_row.ephemeral_normalized_inbound_event_id,
    identity_row.declaration_contract_id,
    identity_row.declaration_contract_version,
    identity_row.declaration_surface_id,
    identity_row.declaration_loaded_by_trusted_service_id,
    identity_row.declaration_loaded_at,
    identity_row.materialized_at,
    identity_row.revision,
    identity_row.created_at,
    identity_row.updated_at
  into
    identity_scope_kind,
    identity_scope_connection_id,
    identity_scope_account_id,
    identity_stability_kind,
    identity_ephemeral_raw_event_id,
    identity_ephemeral_normalized_event_id,
    identity_declaration_contract_id,
    identity_declaration_contract_version,
    identity_declaration_surface_id,
    identity_declaration_loaded_by_trusted_service_id,
    identity_declaration_loaded_at,
    identity_materialized_at,
    identity_revision,
    identity_created_at,
    identity_updated_at
  from public.inbox_v2_source_external_identities identity_row
  where identity_row.tenant_id = new.tenant_id
    and identity_row.id = new.source_external_identity_id
  for share;

  if not found
     or identity_revision <> new.source_external_identity_revision
     or identity_created_at > roster_row.recorded_at
     or identity_updated_at > roster_row.recorded_at
     or identity_declaration_loaded_at > roster_row.recorded_at
     or identity_materialized_at > roster_row.recorded_at
     or (
       identity_scope_kind = 'provider'
       and (
         identity_declaration_contract_id <> roster_row.adapter_contract_id
         or identity_declaration_contract_version <>
            roster_row.adapter_contract_version
         or identity_declaration_surface_id <> roster_row.adapter_surface_id
         or identity_declaration_loaded_by_trusted_service_id <>
            roster_row.adapter_loaded_by_trusted_service_id
       )
     )
     or (
       identity_scope_kind = 'source_connection'
       and identity_scope_connection_id <> roster_row.source_connection_id
     )
     or (
       identity_scope_kind = 'source_account'
       and identity_scope_account_id <> roster_row.source_account_id
     )
     or (
       identity_stability_kind = 'observation_ephemeral'
       and not (
         (
           roster_row.observation_kind = 'raw_inbound_event'
           and identity_ephemeral_raw_event_id =
              roster_row.raw_inbound_event_id
           and identity_ephemeral_normalized_event_id is null
         ) or (
           roster_row.observation_kind = 'normalized_inbound_event'
           and identity_ephemeral_raw_event_id is null
           and identity_ephemeral_normalized_event_id =
              roster_row.normalized_inbound_event_id
         )
       )
     ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.provider_roster_member_identity_scope_invalid';
  end if;

  if new.source_thread_binding_id <> roster_row.source_thread_binding_id
     or new.external_thread_id <> roster_row.external_thread_id
     or new.source_connection_id <> roster_row.source_connection_id
     or new.source_account_id <> roster_row.source_account_id
     or new.observed_at <> roster_row.observed_at
     or new.roster_recorded_at <> roster_row.recorded_at
     or new.created_at <> roster_row.recorded_at
     or new.updated_at <> roster_row.recorded_at then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.provider_roster_member_exact_edge_invalid';
  end if;

  return new;
end;
$function$;

create or replace function public.inbox_v2_provider_roster_reject_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  old_row jsonb := to_jsonb(old);
begin
  if tg_op = 'DELETE' then
    if not exists (
      select 1 from public.tenants tenant_row
       where tenant_row.id = old_row->>'tenant_id'
    ) then
      return old;
    end if;

    if tg_table_name = 'inbox_v2_provider_roster_member_evidence'
       and not exists (
         select 1
           from public.inbox_v2_provider_roster_evidence roster_row
          where roster_row.tenant_id = old_row->>'tenant_id'
            and roster_row.id = old_row->>'roster_evidence_id'
       ) then
      return old;
    end if;
  end if;

  raise exception using
    errcode = '23514',
    message = format(
      'inbox_v2.provider_roster_immutable:%s:%s',
      tg_table_name,
      tg_op
    );
end;
$function$;

create or replace function public.inbox_v2_assert_provider_roster_member_set(
  checked_tenant_id text,
  checked_roster_evidence_id text
)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  expected_count integer;
  expected_digest text;
  actual_count bigint;
  minimum_ordinal integer;
  maximum_ordinal integer;
  noncanonical_ordinal_count bigint;
  actual_digest text;
begin
  select roster_row.member_count, roster_row.ordered_member_digest_sha256
    into expected_count, expected_digest
    from public.inbox_v2_provider_roster_evidence roster_row
   where roster_row.tenant_id = checked_tenant_id
     and roster_row.id = checked_roster_evidence_id;

  if not found then
    return;
  end if;

  select count(*), min(member_row.ordinal), max(member_row.ordinal)
    into actual_count, minimum_ordinal, maximum_ordinal
    from public.inbox_v2_provider_roster_member_evidence member_row
   where member_row.tenant_id = checked_tenant_id
     and member_row.roster_evidence_id = checked_roster_evidence_id;

  select count(*)
    into noncanonical_ordinal_count
    from (
      select
        member_row.ordinal,
        row_number() over (
          order by
            convert_to(member_row.source_external_identity_id, 'UTF8'),
            convert_to(member_row.id, 'UTF8')
        ) - 1 as canonical_ordinal
      from public.inbox_v2_provider_roster_member_evidence member_row
      where member_row.tenant_id = checked_tenant_id
        and member_row.roster_evidence_id = checked_roster_evidence_id
    ) ordered_member
   where ordered_member.ordinal <> ordered_member.canonical_ordinal;

  select encode(
           sha256(
             convert_to(
               'inbox-v2-provider-roster-members:v1|' ||
               coalesce(
                 string_agg(
                   member_row.ordinal::text || '|' ||
                   octet_length(member_row.id)::text || ':' ||
                     member_row.id ||
                   octet_length(member_row.source_external_identity_id)::text ||
                     ':' || member_row.source_external_identity_id ||
                   member_row.source_external_identity_revision::text || '|' ||
                   octet_length(member_row.state::text)::text || ':' ||
                     member_row.state::text ||
                   octet_length(member_row.normalized_role::text)::text || ':' ||
                     member_row.normalized_role::text ||
                   octet_length(member_row.provider_state_code)::text || ':' ||
                     member_row.provider_state_code ||
                   case
                     when member_row.provider_role_code is null then '-1:'
                     else octet_length(member_row.provider_role_code)::text ||
                       ':' || member_row.provider_role_code
                   end ||
                   trunc(
                     extract(epoch from member_row.observed_at) * 1000
                   )::bigint::text || ';',
                   '' order by member_row.ordinal
                 ),
                 ''
               ),
               'UTF8'
             )
           ),
           'hex'
         )
    into actual_digest
    from public.inbox_v2_provider_roster_member_evidence member_row
   where member_row.tenant_id = checked_tenant_id
     and member_row.roster_evidence_id = checked_roster_evidence_id;

  if actual_count <> expected_count
     or (
       expected_count = 0
       and (minimum_ordinal is not null or maximum_ordinal is not null)
     )
     or (
       expected_count > 0
       and (
         minimum_ordinal <> 0
         or maximum_ordinal <> expected_count - 1
       )
     )
     or noncanonical_ordinal_count <> 0
     or actual_digest <> expected_digest then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.provider_roster_member_set_invalid';
  end if;
end;
$function$;

create or replace function public.inbox_v2_provider_roster_deferred_member_set()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform public.inbox_v2_assert_provider_roster_member_set(
    new.tenant_id,
    new.id
  );
  return null;
end;
$function$;

create trigger inbox_v2_provider_roster_insert_guard_trigger
before insert on public.inbox_v2_provider_roster_evidence
for each row execute function public.inbox_v2_provider_roster_guard_insert();

create trigger inbox_v2_provider_roster_member_insert_guard_trigger
before insert on public.inbox_v2_provider_roster_member_evidence
for each row execute function public.inbox_v2_provider_roster_member_guard_insert();

create trigger inbox_v2_provider_roster_immutable_trigger
before update or delete on public.inbox_v2_provider_roster_evidence
for each row execute function public.inbox_v2_provider_roster_reject_immutable();

create trigger inbox_v2_provider_roster_member_immutable_trigger
before update or delete on public.inbox_v2_provider_roster_member_evidence
for each row execute function public.inbox_v2_provider_roster_reject_immutable();

create constraint trigger inbox_v2_provider_roster_member_set_constraint
after insert on public.inbox_v2_provider_roster_evidence
deferrable initially deferred for each row
execute function public.inbox_v2_provider_roster_deferred_member_set();
`;

function lengthPrefixUtf8(value: string | null): string {
  if (value === null) return "-1:";
  return `${utf8Encoder.encode(value).byteLength}:${value}`;
}

function compareUtf8Bytes(left: string, right: string): number {
  const leftBytes = utf8Encoder.encode(left);
  const rightBytes = utf8Encoder.encode(right);
  const sharedLength = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = (leftBytes[index] ?? 0) - (rightBytes[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

function catalogIdSql(column: SQLWrapper) {
  return sql`char_length(${column}) <= 256 and (
    (
      ${column} ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part(${column}, ':', 2)) <= 160
    ) or (
      ${column} ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part(${column}, ':', 2)) <= 80
      and char_length(split_part(${column}, ':', 3)) <= 160
      and split_part(${column}, ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )`;
}

function versionTokenSql(column: SQLWrapper) {
  return sql`${column} ~ '^v[1-9][0-9]*$'`;
}

function routingTokenSql(column: SQLWrapper) {
  return sql`char_length(${column}) between 8 and 256
    and ${column} ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'`;
}

function sha256DigestSql(column: SQLWrapper) {
  return sql`${column} ~ '^[a-f0-9]{64}$'`;
}
