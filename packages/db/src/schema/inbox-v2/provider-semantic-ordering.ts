import { sql, type SQLWrapper } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp
} from "drizzle-orm/pg-core";

import { normalizedInboundEvents, sourceAccounts, tenants } from "../tables";
import { inboxV2ExternalMessageReferences } from "./outbound-transport";
import { inboxV2SourceThreadBindings } from "./source-thread-binding";

function catalogIdSql(column: SQLWrapper) {
  return sql`coalesce((char_length(${column}) <= 256 and (
    (${column} ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part(${column}, ':', 2)) <= 160)
    or (${column} ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part(${column}, ':', 2)) <= 80
      and char_length(split_part(${column}, ':', 3)) <= 160
      and split_part(${column}, ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      ))
  )), false)`;
}

function routingTokenSql(column: SQLWrapper) {
  return sql`coalesce((char_length(${column}) between 8 and 256
    and ${column} ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'), false)`;
}

function sha256DigestSql(column: SQLWrapper) {
  return sql`coalesce((${column} ~ '^[a-f0-9]{64}$'), false)`;
}

/**
 * One provider-neutral CAS fence per external Message and semantic family.
 * Consumer rows keep the immutable commit audit; this compact row is the only
 * authoritative current ordering head shared by lifecycle and reaction writes.
 */
export const inboxV2ProviderSemanticOrderingHeads = pgTable(
  "inbox_v2_provider_semantic_ordering_heads",
  {
    tenantId: text("tenant_id").notNull(),
    externalMessageReferenceId: text("external_message_reference_id").notNull(),
    semanticFamilyId: text("semantic_family_id").notNull(),
    sourceAccountId: text("source_account_id").notNull(),
    sourceThreadBindingId: text("source_thread_binding_id").notNull(),
    bindingGeneration: bigint("binding_generation", {
      mode: "bigint"
    }).notNull(),
    scopeToken: text("scope_token").notNull(),
    comparatorId: text("comparator_id").notNull(),
    comparatorRevision: bigint("comparator_revision", {
      mode: "bigint"
    }).notNull(),
    position: text("position").notNull(),
    normalizedInboundEventId: text("normalized_inbound_event_id").notNull(),
    proofToken: text("proof_token").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    headDetail: jsonb("head_detail")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    headDetailDigestSha256: text("head_detail_digest_sha256").notNull(),
    lastChangedStreamPosition: bigint("last_changed_stream_position", {
      mode: "bigint"
    }).notNull(),
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
      name: "inbox_v2_provider_semantic_ordering_heads_pk",
      columns: [
        table.tenantId,
        table.externalMessageReferenceId,
        table.semanticFamilyId
      ]
    }),
    foreignKey({
      name: "inbox_v2_provider_semantic_ordering_heads_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }),
    foreignKey({
      name: "inbox_v2_provider_semantic_ordering_heads_reference_fk",
      columns: [table.tenantId, table.externalMessageReferenceId],
      foreignColumns: [
        inboxV2ExternalMessageReferences.tenantId,
        inboxV2ExternalMessageReferences.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_provider_semantic_ordering_heads_account_fk",
      columns: [table.tenantId, table.sourceAccountId],
      foreignColumns: [sourceAccounts.tenantId, sourceAccounts.id]
    }),
    foreignKey({
      name: "inbox_v2_provider_semantic_ordering_heads_binding_fk",
      columns: [
        table.tenantId,
        table.sourceThreadBindingId,
        table.sourceAccountId
      ],
      foreignColumns: [
        inboxV2SourceThreadBindings.tenantId,
        inboxV2SourceThreadBindings.id,
        inboxV2SourceThreadBindings.sourceAccountId
      ]
    }),
    foreignKey({
      name: "inbox_v2_provider_semantic_ordering_heads_event_fk",
      columns: [table.tenantId, table.normalizedInboundEventId],
      foreignColumns: [
        normalizedInboundEvents.tenantId,
        normalizedInboundEvents.id
      ]
    }),
    check(
      "inbox_v2_provider_semantic_ordering_heads_values_check",
      sql`${catalogIdSql(table.semanticFamilyId)}
        and ${table.bindingGeneration} >= 1
        and ${routingTokenSql(table.scopeToken)}
        and ${catalogIdSql(table.comparatorId)}
        and ${table.comparatorRevision} >= 1
        and ${table.position} ~ '^(0|[1-9][0-9]*)$'
        and ${routingTokenSql(table.proofToken)}
        and ${table.revision} >= 1
        and ${sha256DigestSql(table.headDetailDigestSha256)}
        and ${table.lastChangedStreamPosition} >= 1
        and jsonb_typeof(${table.headDetail}) = 'object'
        and pg_column_size(${table.headDetail}) <= 65536`
    ),
    check(
      "inbox_v2_provider_semantic_ordering_heads_detail_check",
      sql`(${table.headDetail} #>> '{tenantId}') = ${table.tenantId}
        and (${table.headDetail} #>> '{semanticFamilyId}') =
          ${table.semanticFamilyId}
        and (${table.headDetail} #>> '{externalMessageReference,tenantId}') =
          ${table.tenantId}
        and (${table.headDetail} #>> '{externalMessageReference,kind}') =
          'external_message_reference'
        and (${table.headDetail} #>> '{externalMessageReference,id}') =
          ${table.externalMessageReferenceId}
        and (${table.headDetail} #>> '{sourceAccount,tenantId}') =
          ${table.tenantId}
        and (${table.headDetail} #>> '{sourceAccount,kind}') = 'source_account'
        and (${table.headDetail} #>> '{sourceAccount,id}') =
          ${table.sourceAccountId}
        and (${table.headDetail} #>> '{sourceThreadBinding,tenantId}') =
          ${table.tenantId}
        and (${table.headDetail} #>> '{sourceThreadBinding,kind}') =
          'source_thread_binding'
        and (${table.headDetail} #>> '{sourceThreadBinding,id}') =
          ${table.sourceThreadBindingId}
        and (${table.headDetail} #>> '{bindingGeneration}') =
          ${table.bindingGeneration}::text
        and (${table.headDetail} #>> '{scopeToken}') = ${table.scopeToken}
        and (${table.headDetail} #>> '{comparatorId}') = ${table.comparatorId}
        and (${table.headDetail} #>> '{comparatorRevision}') =
          ${table.comparatorRevision}::text
        and (${table.headDetail} #>> '{position}') = ${table.position}
        and (${table.headDetail} #>> '{normalizedInboundEvent,tenantId}') =
          ${table.tenantId}
        and (${table.headDetail} #>> '{normalizedInboundEvent,kind}') =
          'normalized_inbound_event'
        and (${table.headDetail} #>> '{normalizedInboundEvent,id}') =
          ${table.normalizedInboundEventId}
        and (${table.headDetail} #>> '{proofToken}') = ${table.proofToken}
        and (${table.headDetail} #>> '{revision}') = ${table.revision}::text
        and ((${table.headDetail} #>> '{updatedAt}')::timestamptz) =
          ${table.updatedAt}`
    ),
    check(
      "inbox_v2_provider_semantic_ordering_heads_clock_check",
      sql`isfinite(${table.createdAt}) and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}`
    ),
    index("inbox_v2_provider_semantic_ordering_heads_binding_idx").on(
      table.tenantId,
      table.sourceThreadBindingId,
      table.semanticFamilyId,
      table.externalMessageReferenceId
    ),
    index("inbox_v2_provider_semantic_ordering_heads_event_idx").on(
      table.tenantId,
      table.normalizedInboundEventId
    )
  ]
);

/** Installed after the shared Timeline/Message JSON validators in migration 0031. */
export const INBOX_V2_PROVIDER_SEMANTIC_ORDERING_INVARIANTS_SQL = String.raw`
create or replace function public.inbox_v2_tm_provider_semantic_head_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    if not exists (
      select 1 from public.tenants tenant_row where tenant_row.id = old.tenant_id
    ) then
      return old;
    end if;
    raise exception using errcode = '23514',
      message = 'inbox_v2.provider_semantic_ordering_head_delete';
  end if;

  if tg_op = 'INSERT' then
    if new.revision <> 1 or new.created_at <> new.updated_at then
      raise exception using errcode = '23514',
        message = 'inbox_v2.provider_semantic_ordering_head_invalid_initial';
    end if;
    return new;
  end if;

  if row(
       new.tenant_id, new.external_message_reference_id,
       new.semantic_family_id, new.scope_token,
       new.comparator_id, new.comparator_revision,
       new.created_at
     ) is distinct from row(
       old.tenant_id, old.external_message_reference_id,
       old.semantic_family_id, old.scope_token,
       old.comparator_id, old.comparator_revision,
       old.created_at
     )
     or new.revision <> old.revision + 1
     or new.last_changed_stream_position <= old.last_changed_stream_position
     or new.updated_at < old.updated_at
     or char_length(new.position) < char_length(old.position)
     or (
       char_length(new.position) = char_length(old.position)
       and new.position collate "C" <= old.position collate "C"
     ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.provider_semantic_ordering_head_invalid_advance';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_tm_provider_semantic_proof_scope_valid(
  proof_detail jsonb,
  expected_tenant_id text
)
returns boolean
language sql
immutable
strict
set search_path = pg_catalog, public, pg_temp
as $function$
  select
    proof_detail #>> '{tenantId}' = expected_tenant_id
    and proof_detail #>> '{normalizedInboundEvent,tenantId}' =
      expected_tenant_id
    and proof_detail #>> '{normalizedInboundEvent,kind}' =
      'normalized_inbound_event'
    and proof_detail #>> '{externalMessageReference,tenantId}' =
      expected_tenant_id
    and proof_detail #>> '{externalMessageReference,kind}' =
      'external_message_reference'
    and proof_detail #>> '{sourceOccurrence,tenantId}' =
      expected_tenant_id
    and proof_detail #>> '{sourceOccurrence,kind}' = 'source_occurrence'
    and proof_detail #>> '{sourceAccount,tenantId}' = expected_tenant_id
    and proof_detail #>> '{sourceAccount,kind}' = 'source_account'
    and proof_detail #>> '{sourceThreadBinding,tenantId}' =
      expected_tenant_id
    and proof_detail #>> '{sourceThreadBinding,kind}' =
      'source_thread_binding'
    and (
      proof_detail -> 'actor' = 'null'::jsonb
      or (
        proof_detail #>> '{actor,tenantId}' = expected_tenant_id
        and proof_detail #>> '{actor,kind}' = 'source_external_identity'
      )
    );
$function$;

create or replace function public.inbox_v2_tm_provider_semantic_consumer_count(
  head_row public.inbox_v2_provider_semantic_ordering_heads,
  expected_before jsonb,
  require_before boolean
)
returns bigint
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $function$
  select
    (
      select count(*)
        from public.inbox_v2_message_provider_lifecycle_operations operation_row
       where operation_row.tenant_id = (head_row).tenant_id
         and operation_row.origin = 'provider_observed'
         and operation_row.external_message_reference_id =
           (head_row).external_message_reference_id
         and operation_row.source_account_id = (head_row).source_account_id
         and operation_row.source_thread_binding_id =
           (head_row).source_thread_binding_id
         and operation_row.binding_generation = (head_row).binding_generation
         and operation_row.provider_semantic_normalized_inbound_event_id =
           (head_row).normalized_inbound_event_id
         and operation_row.provider_semantic_proof_token =
           (head_row).proof_token
         and operation_row.provider_semantic_ordering_scope_token =
           (head_row).scope_token
         and operation_row.provider_semantic_ordering_position =
           (head_row).position
         and operation_row.provider_semantic_ordering_comparator_id =
           (head_row).comparator_id
         and operation_row.provider_semantic_ordering_comparator_revision =
           (head_row).comparator_revision
         and operation_row.semantic_ordering_commit_detail #>>
           '{semanticFamilyId}' = (head_row).semantic_family_id
         and operation_row.semantic_ordering_commit_detail #>>
           '{tenantId}' = (head_row).tenant_id
         and public.inbox_v2_tm_provider_semantic_proof_scope_valid(
           operation_row.provider_semantic_proof_detail,
           (head_row).tenant_id
         )
         and operation_row.semantic_ordering_commit_detail -> 'proof' =
           operation_row.provider_semantic_proof_detail
         and operation_row.semantic_ordering_commit_detail -> 'after' =
           (head_row).head_detail
         and (not require_before or
           operation_row.semantic_ordering_commit_detail -> 'before' =
             expected_before)
         and (operation_row.semantic_ordering_commit_detail #>>
           '{committedAt}')::timestamptz = (head_row).updated_at
         and operation_row.semantic_ordering_commit_digest_sha256 ~
           '^[a-f0-9]{64}$'
         and operation_row.provider_semantic_proof_digest_sha256 ~
           '^[a-f0-9]{64}$'
         and operation_row.created_stream_position =
           (head_row).last_changed_stream_position
    ) + (
      select count(*)
        from public.inbox_v2_message_provider_reaction_observations observation_row
        join public.inbox_v2_message_reaction_transitions transition_row
          on transition_row.tenant_id = observation_row.tenant_id
         and transition_row.id = observation_row.transition_id
        join public.inbox_v2_message_reactions reaction_row
          on reaction_row.tenant_id = transition_row.tenant_id
         and reaction_row.id = transition_row.reaction_id
        join public.inbox_v2_external_message_references reference_row
          on reference_row.tenant_id = transition_row.tenant_id
         and reference_row.id = transition_row.external_message_reference_id
         and reference_row.message_id = reaction_row.message_id
        join public.inbox_v2_action_attributions attribution_row
          on attribution_row.tenant_id = transition_row.tenant_id
         and attribution_row.id = transition_row.action_attribution_id
        join public.inbox_v2_source_occurrences occurrence_actor_row
          on occurrence_actor_row.tenant_id = observation_row.tenant_id
         and occurrence_actor_row.id = observation_row.source_occurrence_id
       where observation_row.tenant_id = (head_row).tenant_id
         and transition_row.mode = 'provider_observed'
         and transition_row.external_message_reference_id =
           (head_row).external_message_reference_id
         and transition_row.source_occurrence_id =
           observation_row.source_occurrence_id
         and transition_row.source_account_id = (head_row).source_account_id
         and transition_row.source_thread_binding_id =
           (head_row).source_thread_binding_id
         and transition_row.binding_generation =
           (head_row).binding_generation
         and transition_row.external_authority_detail #>>
           '{externalMessageReference,id}' =
             transition_row.external_message_reference_id
         and transition_row.external_authority_detail #>>
           '{externalMessageReference,tenantId}' = (head_row).tenant_id
         and transition_row.external_authority_detail #>>
           '{externalMessageReference,kind}' = 'external_message_reference'
         and transition_row.external_authority_detail #>>
           '{sourceOccurrence,id}' = transition_row.source_occurrence_id
         and transition_row.external_authority_detail #>>
           '{sourceOccurrence,tenantId}' = (head_row).tenant_id
         and transition_row.external_authority_detail #>>
           '{sourceOccurrence,kind}' = 'source_occurrence'
         and transition_row.external_authority_detail #>>
           '{sourceAccount,id}' = transition_row.source_account_id
         and transition_row.external_authority_detail #>>
           '{sourceAccount,tenantId}' = (head_row).tenant_id
         and transition_row.external_authority_detail #>>
           '{sourceAccount,kind}' = 'source_account'
         and transition_row.external_authority_detail #>>
           '{sourceThreadBinding,id}' =
             transition_row.source_thread_binding_id
         and transition_row.external_authority_detail #>>
           '{sourceThreadBinding,tenantId}' = (head_row).tenant_id
         and transition_row.external_authority_detail #>>
           '{sourceThreadBinding,kind}' = 'source_thread_binding'
         and transition_row.external_authority_detail #>>
           '{bindingGeneration}' = transition_row.binding_generation::text
         and transition_row.adapter_contract_id =
           observation_row.semantic_proof_detail #>>
             '{adapterContract,contractId}'
         and transition_row.adapter_contract_version =
           observation_row.semantic_proof_detail #>>
             '{adapterContract,contractVersion}'
         and transition_row.capability_id =
           observation_row.semantic_proof_detail #>> '{capabilityId}'
         and transition_row.capability_revision::text =
           observation_row.semantic_proof_detail #>> '{capabilityRevision}'
         and transition_row.external_authority_detail -> 'adapterContract' =
           observation_row.semantic_proof_detail -> 'adapterContract'
         and transition_row.external_authority_detail #>
           '{capabilityFence,adapterContract}' =
             observation_row.semantic_proof_detail -> 'adapterContract'
         and transition_row.external_authority_detail #>>
           '{capabilityFence,capabilityId}' = transition_row.capability_id
         and transition_row.external_authority_detail #>>
           '{capabilityFence,capabilityRevision}' =
             transition_row.capability_revision::text
         and transition_row.external_authority_detail #>>
           '{capabilityFence,decision}' = 'supported'
         and isfinite((transition_row.external_authority_detail #>>
           '{capabilityFence,evaluatedAt}')::timestamptz)
         and isfinite((transition_row.external_authority_detail #>>
           '{capabilityFence,notAfter}')::timestamptz)
         and (transition_row.external_authority_detail #>>
           '{capabilityFence,evaluatedAt}')::timestamptz <=
             transition_row.occurred_at
         and (transition_row.external_authority_detail #>>
           '{capabilityFence,notAfter}')::timestamptz >=
             transition_row.occurred_at
         and (observation_row.semantic_proof_detail #>>
           '{adapterContract,loadedAt}')::timestamptz <=
             transition_row.occurred_at
         and observation_row.semantic_proof_detail #>>
           '{declaredByTrustedServiceId}' =
             observation_row.semantic_proof_detail #>>
               '{adapterContract,loadedByTrustedServiceId}'
         and reaction_row.capability_kind = 'external'
         and reaction_row.capability_id = transition_row.capability_id
         and reaction_row.capability_revision =
           transition_row.capability_revision
         and reaction_row.adapter_contract_id =
           transition_row.adapter_contract_id
         and reaction_row.adapter_contract_version =
           transition_row.adapter_contract_version
         and reaction_row.capability_detail #>> '{kind}' = 'external'
         and reaction_row.capability_detail #>> '{capabilityId}' =
           transition_row.capability_id
         and reaction_row.capability_detail #>> '{capabilityRevision}' =
           transition_row.capability_revision::text
         and reaction_row.capability_detail #>> '{cardinality}' =
           reaction_row.cardinality::text
         and reaction_row.capability_detail -> 'adapterContract' =
           observation_row.semantic_proof_detail -> 'adapterContract'
         and transition_row.external_authority_detail -> 'outboundRoute' =
           'null'::jsonb
         and attribution_row.source_occurrence_id =
           observation_row.source_occurrence_id
         and attribution_row.conversation_id = reference_row.conversation_id
         and observation_row.normalized_inbound_event_id =
           (head_row).normalized_inbound_event_id
         and observation_row.ordering_position = (head_row).position
         and observation_row.semantic_proof_detail #>>
           '{normalizedInboundEvent,id}' =
             observation_row.normalized_inbound_event_id
         and observation_row.semantic_proof_detail #>>
           '{externalMessageReference,id}' =
             (head_row).external_message_reference_id
         and observation_row.semantic_proof_detail #>>
           '{sourceOccurrence,id}' = observation_row.source_occurrence_id
         and observation_row.semantic_proof_detail #>> '{semanticId}' =
           observation_row.semantic_id
         and observation_row.semantic_id =
           'core:message.reaction.' || transition_row.operation::text
         and observation_row.semantic_proof_detail #>> '{revision}' = '1'
         and observation_row.semantic_proof_detail #>> '{semanticRevision}'
           ~ '^[1-9][0-9]*$'
         and char_length(observation_row.semantic_proof_detail #>>
           '{semanticRevision}') <= 19
         and (
           char_length(observation_row.semantic_proof_detail #>>
             '{semanticRevision}') < 19
           or (observation_row.semantic_proof_detail #>>
             '{semanticRevision}') collate "C" <= '9223372036854775807'
         )
         and observation_row.semantic_proof_detail #>>
           '{ordering,position}' = observation_row.ordering_position
         and observation_row.semantic_proof_detail #>> '{sourceAccount,id}' =
           (head_row).source_account_id
         and observation_row.semantic_proof_detail #>>
           '{sourceThreadBinding,id}' = (head_row).source_thread_binding_id
         and observation_row.semantic_proof_detail #>> '{bindingGeneration}' =
           (head_row).binding_generation::text
         and observation_row.semantic_proof_detail #>> '{proofToken}' =
           (head_row).proof_token
         and observation_row.semantic_proof_detail #>> '{ordering,scopeToken}' =
           (head_row).scope_token
         and observation_row.semantic_proof_detail #>>
           '{ordering,comparatorId}' = (head_row).comparator_id
         and observation_row.semantic_proof_detail #>>
           '{ordering,comparatorRevision}' =
             (head_row).comparator_revision::text
         and observation_row.ordering_commit_detail #>>
           '{semanticFamilyId}' = (head_row).semantic_family_id
         and (head_row).semantic_family_id = 'core:message.reaction'
         and observation_row.ordering_commit_detail #>>
           '{tenantId}' = (head_row).tenant_id
         and public.inbox_v2_tm_provider_semantic_proof_scope_valid(
           observation_row.semantic_proof_detail,
           (head_row).tenant_id
         )
         and observation_row.ordering_commit_detail -> 'proof' =
           observation_row.semantic_proof_detail
         and observation_row.ordering_commit_detail -> 'after' =
           (head_row).head_detail
         and (not require_before or
           observation_row.ordering_commit_detail -> 'before' =
             expected_before)
         and (observation_row.ordering_commit_detail #>>
           '{committedAt}')::timestamptz = (head_row).updated_at
         and (observation_row.semantic_proof_detail #>>
           '{occurredAt}')::timestamptz = observation_row.observed_at
         and (observation_row.semantic_proof_detail #>>
           '{recordedAt}')::timestamptz = observation_row.recorded_at
         and transition_row.occurred_at = observation_row.observed_at
         and observation_row.recorded_at <= transition_row.recorded_at
         and transition_row.recorded_at = (head_row).updated_at
         and transition_row.after_state_kind =
           observation_row.normalized_state_kind
         and transition_row.value_kind = observation_row.normalized_value_kind
         and transition_row.unicode_value is not distinct from
           observation_row.normalized_unicode_value
         and transition_row.provider_reaction_kind_id is not distinct from
           observation_row.normalized_provider_reaction_kind_id
         and transition_row.provider_canonical_code is not distinct from
           observation_row.normalized_provider_canonical_code
         and transition_row.after_state_detail #>> '{kind}' =
           transition_row.after_state_kind::text
         and transition_row.after_state_detail #>> (
           case when transition_row.after_state_kind = 'active'
             then array['value', 'kind']
             else array['lastValue', 'kind']
           end
         ) = transition_row.value_kind::text
         and (
           (
             transition_row.value_kind = 'unicode'
             and transition_row.after_state_detail #>> (
               case when transition_row.after_state_kind = 'active'
                 then array['value', 'value']
                 else array['lastValue', 'value']
               end
             ) = transition_row.unicode_value
             and transition_row.provider_reaction_kind_id is null
             and transition_row.provider_canonical_code is null
           )
           or (
             transition_row.value_kind = 'provider_custom'
             and transition_row.unicode_value is null
             and transition_row.after_state_detail #>> (
               case when transition_row.after_state_kind = 'active'
                 then array['value', 'providerKindId']
                 else array['lastValue', 'providerKindId']
               end
             ) = transition_row.provider_reaction_kind_id
             and transition_row.after_state_detail #>> (
               case when transition_row.after_state_kind = 'active'
                 then array['value', 'canonicalCode']
                 else array['lastValue', 'canonicalCode']
               end
             ) = transition_row.provider_canonical_code
           )
         )
         and (
           transition_row.after_state_kind = 'active'
           or (transition_row.after_state_detail #>>
             '{clearedAt}')::timestamptz = transition_row.recorded_at
         )
         and (
           (
             coalesce(
               transition_row.before_state_kind = 'pending_external'
               or (
                 transition_row.before_state_kind = 'external_terminal'
                 and transition_row.before_state_detail #>> '{outcome}' =
                   'outcome_unknown'
               ),
               false
             )
             and (
               observation_row.semantic_proof_detail #>> '{actor,id}' is null
               or occurrence_actor_row.provider_actor_source_external_identity_id
                 is null
               or observation_row.semantic_proof_detail #>> '{actor,id}' =
                 occurrence_actor_row.provider_actor_source_external_identity_id
             )
             and (
               (
                 coalesce(
                   observation_row.semantic_proof_detail #>> '{actor,id}',
                   occurrence_actor_row.provider_actor_source_external_identity_id
                 ) is null
                 and observation_row.provider_actor_participant_id is null
                 and attribution_row.action_participant_id is null
               )
               or (
                 attribution_row.action_participant_id =
                   observation_row.provider_actor_participant_id
                 and exists (
                   select 1
                     from public.inbox_v2_conversation_participants participant_row
                    where participant_row.tenant_id =
                      observation_row.tenant_id
                      and participant_row.id =
                        observation_row.provider_actor_participant_id
                      and participant_row.conversation_id =
                        reference_row.conversation_id
                      and participant_row.subject_kind =
                        'source_external_identity'
                      and participant_row.subject_source_external_identity_id =
                        coalesce(
                          observation_row.semantic_proof_detail #>>
                            '{actor,id}',
                          occurrence_actor_row.provider_actor_source_external_identity_id
                        )
                 )
               )
             )
           )
           or (
             not coalesce(
               transition_row.before_state_kind = 'pending_external'
               or (
                 transition_row.before_state_kind = 'external_terminal'
                 and transition_row.before_state_detail #>> '{outcome}' =
                   'outcome_unknown'
               ),
               false
             )
             and (
               (
                 occurrence_actor_row.provider_actor_kind =
                   'source_external_identity'
                 and observation_row.semantic_proof_detail #>> '{actor,id}' =
                   occurrence_actor_row.provider_actor_source_external_identity_id
                 and attribution_row.action_participant_id =
                   observation_row.provider_actor_participant_id
                 and reaction_row.actor_kind = 'participant'
                 and reaction_row.actor_participant_id =
                   observation_row.provider_actor_participant_id
                 and exists (
                   select 1
                     from public.inbox_v2_conversation_participants participant_row
                    where participant_row.tenant_id =
                      observation_row.tenant_id
                      and participant_row.id =
                        observation_row.provider_actor_participant_id
                      and participant_row.conversation_id =
                        reference_row.conversation_id
                      and participant_row.subject_kind =
                        'source_external_identity'
                      and participant_row.subject_source_external_identity_id =
                        occurrence_actor_row.provider_actor_source_external_identity_id
                 )
               )
               or (
                 occurrence_actor_row.provider_actor_kind = 'provider_system'
                 and observation_row.semantic_proof_detail -> 'actor' =
                   'null'::jsonb
                 and observation_row.provider_actor_participant_id is null
                 and attribution_row.action_participant_id is null
                 and reaction_row.actor_kind = 'provider_system'
                 and reaction_row.actor_source_occurrence_id =
                   occurrence_actor_row.id
                 and reaction_row.provider_actor_kind_id =
                   occurrence_actor_row.provider_system_actor_kind_id
                 and reaction_row.provider_actor_subject =
                   occurrence_actor_row.provider_system_actor_subject
               )
               or (
                 occurrence_actor_row.provider_actor_kind is null
                 and observation_row.semantic_proof_detail -> 'actor' =
                   'null'::jsonb
                 and observation_row.provider_actor_participant_id is null
                 and attribution_row.action_participant_id is null
                 and reaction_row.actor_kind in (
                   'unattributed_source_observation', 'aggregate_only'
                 )
                 and reaction_row.actor_source_occurrence_id =
                   occurrence_actor_row.id
               )
             )
           )
         )
         and observation_row.ordering_proof_digest_sha256 ~
           '^[a-f0-9]{64}$'
         and observation_row.semantic_proof_digest_sha256 ~
           '^[a-f0-9]{64}$'
         and transition_row.recorded_stream_position =
           (head_row).last_changed_stream_position
         and exists (
           select 1
             from public.inbox_v2_source_occurrences occurrence_row
            where occurrence_row.tenant_id = observation_row.tenant_id
              and occurrence_row.id = observation_row.source_occurrence_id
              and occurrence_row.normalized_inbound_event_id =
                observation_row.normalized_inbound_event_id
              and occurrence_row.source_account_id =
                (head_row).source_account_id
              and occurrence_row.source_thread_binding_id =
                (head_row).source_thread_binding_id
              and occurrence_row.binding_generation =
                (head_row).binding_generation
              and occurrence_row.adapter_contract_id =
                observation_row.semantic_proof_detail #>>
                  '{adapterContract,contractId}'
              and occurrence_row.adapter_contract_version =
                observation_row.semantic_proof_detail #>>
                  '{adapterContract,contractVersion}'
              and occurrence_row.adapter_declaration_revision::text =
                observation_row.semantic_proof_detail #>>
                  '{adapterContract,declarationRevision}'
              and occurrence_row.adapter_surface_id =
                observation_row.semantic_proof_detail #>>
                  '{adapterContract,surfaceId}'
              and occurrence_row.adapter_loaded_by_trusted_service_id =
                observation_row.semantic_proof_detail #>>
                  '{adapterContract,loadedByTrustedServiceId}'
              and occurrence_row.adapter_loaded_at =
                (observation_row.semantic_proof_detail #>>
                  '{adapterContract,loadedAt}')::timestamptz
              and occurrence_row.capability_revision::text =
                observation_row.semantic_proof_detail #>>
                  '{capabilityRevision}'
              and occurrence_row.resolution_state = 'resolved'
              and occurrence_row.resolved_external_message_reference_id =
                (head_row).external_message_reference_id
         )
    );
$function$;

create or replace function public.inbox_v2_tm_provider_semantic_head_consumer_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  matching_consumer_count bigint;
  matching_before_count bigint;
  expected_before jsonb;
begin
  if not exists (
    select 1
      from public.inbox_v2_external_message_references reference_row
     where reference_row.tenant_id = new.tenant_id
       and reference_row.id = new.external_message_reference_id
  ) then
    return new;
  end if;

  expected_before := case tg_op
    when 'INSERT' then 'null'::jsonb
    else old.head_detail
  end;
  matching_consumer_count :=
    public.inbox_v2_tm_provider_semantic_consumer_count(
      new, 'null'::jsonb, false
    );
  matching_before_count :=
    public.inbox_v2_tm_provider_semantic_consumer_count(
      new, expected_before, true
    );

  if matching_consumer_count <> 1 or matching_before_count <> 1 then
    raise exception using errcode = '23514',
      message = 'inbox_v2.provider_semantic_ordering_head_consumer_invalid';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_tm_provider_semantic_consumer_head_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  matching_head_count bigint;
  matching_consumer_count bigint;
  matching_total_consumer_count bigint;
  consumer_before jsonb;
  consumer_after jsonb;
  consumer_stream_position bigint;
begin
  if tg_table_name = 'inbox_v2_message_provider_lifecycle_operations' then
    if new.semantic_ordering_commit_detail is null then
      return new;
    end if;
    if not exists (
      select 1
        from public.inbox_v2_messages message_row
       where message_row.tenant_id = new.tenant_id
         and message_row.id = new.message_id
    ) then
      return new;
    end if;
    consumer_before := new.semantic_ordering_commit_detail -> 'before';
    consumer_after := new.semantic_ordering_commit_detail -> 'after';
    consumer_stream_position := new.created_stream_position;
    select count(*)
      into matching_head_count
      from public.inbox_v2_provider_semantic_ordering_heads head_row
     where head_row.tenant_id = new.tenant_id
       and head_row.external_message_reference_id =
         new.external_message_reference_id
       and head_row.semantic_family_id =
         new.semantic_ordering_commit_detail #>> '{semanticFamilyId}'
       and new.semantic_ordering_commit_detail #>> '{tenantId}' =
         head_row.tenant_id
       and public.inbox_v2_tm_provider_semantic_proof_scope_valid(
         new.provider_semantic_proof_detail,
         head_row.tenant_id
       )
       and head_row.source_account_id = new.source_account_id
       and head_row.source_thread_binding_id = new.source_thread_binding_id
       and head_row.binding_generation = new.binding_generation
       and head_row.normalized_inbound_event_id =
         new.provider_semantic_normalized_inbound_event_id
       and head_row.proof_token = new.provider_semantic_proof_token
       and head_row.scope_token =
         new.provider_semantic_ordering_scope_token
       and head_row.position = new.provider_semantic_ordering_position
       and head_row.comparator_id =
         new.provider_semantic_ordering_comparator_id
       and head_row.comparator_revision =
         new.provider_semantic_ordering_comparator_revision
       and head_row.head_detail =
         new.semantic_ordering_commit_detail -> 'after'
       and new.semantic_ordering_commit_detail -> 'proof' =
         new.provider_semantic_proof_detail
       and (new.semantic_ordering_commit_detail #>>
         '{committedAt}')::timestamptz = head_row.updated_at
       and new.semantic_ordering_commit_digest_sha256 ~ '^[a-f0-9]{64}$'
       and new.provider_semantic_proof_digest_sha256 ~ '^[a-f0-9]{64}$'
       and head_row.last_changed_stream_position =
         new.created_stream_position;
  elsif tg_table_name =
    'inbox_v2_message_provider_reaction_observations' then
    if not exists (
      select 1
        from public.inbox_v2_message_reaction_transitions transition_row
       where transition_row.tenant_id = new.tenant_id
         and transition_row.id = new.transition_id
    ) then
      return new;
    end if;
    consumer_before := new.ordering_commit_detail -> 'before';
    consumer_after := new.ordering_commit_detail -> 'after';
    select transition_row.recorded_stream_position
      into consumer_stream_position
      from public.inbox_v2_message_reaction_transitions transition_row
     where transition_row.tenant_id = new.tenant_id
       and transition_row.id = new.transition_id;
    select count(*)
      into matching_head_count
      from public.inbox_v2_provider_semantic_ordering_heads head_row
      join public.inbox_v2_message_reaction_transitions transition_row
        on transition_row.tenant_id = new.tenant_id
       and transition_row.id = new.transition_id
      join public.inbox_v2_message_reactions reaction_row
        on reaction_row.tenant_id = transition_row.tenant_id
       and reaction_row.id = transition_row.reaction_id
      join public.inbox_v2_external_message_references reference_row
        on reference_row.tenant_id = transition_row.tenant_id
       and reference_row.id = transition_row.external_message_reference_id
       and reference_row.message_id = reaction_row.message_id
      join public.inbox_v2_action_attributions attribution_row
        on attribution_row.tenant_id = transition_row.tenant_id
       and attribution_row.id = transition_row.action_attribution_id
      join public.inbox_v2_source_occurrences occurrence_actor_row
        on occurrence_actor_row.tenant_id = new.tenant_id
       and occurrence_actor_row.id = new.source_occurrence_id
     where head_row.tenant_id = new.tenant_id
       and transition_row.mode = 'provider_observed'
       and head_row.external_message_reference_id =
         new.semantic_proof_detail #>> '{externalMessageReference,id}'
       and transition_row.external_message_reference_id =
         head_row.external_message_reference_id
       and transition_row.source_occurrence_id = new.source_occurrence_id
       and transition_row.source_account_id = head_row.source_account_id
       and transition_row.source_thread_binding_id =
         head_row.source_thread_binding_id
       and transition_row.binding_generation = head_row.binding_generation
       and transition_row.external_authority_detail #>>
         '{externalMessageReference,id}' =
           transition_row.external_message_reference_id
       and transition_row.external_authority_detail #>>
         '{externalMessageReference,tenantId}' = head_row.tenant_id
       and transition_row.external_authority_detail #>>
         '{externalMessageReference,kind}' = 'external_message_reference'
       and transition_row.external_authority_detail #>>
         '{sourceOccurrence,id}' = transition_row.source_occurrence_id
       and transition_row.external_authority_detail #>>
         '{sourceOccurrence,tenantId}' = head_row.tenant_id
       and transition_row.external_authority_detail #>>
         '{sourceOccurrence,kind}' = 'source_occurrence'
       and transition_row.external_authority_detail #>>
         '{sourceAccount,id}' = transition_row.source_account_id
       and transition_row.external_authority_detail #>>
         '{sourceAccount,tenantId}' = head_row.tenant_id
       and transition_row.external_authority_detail #>>
         '{sourceAccount,kind}' = 'source_account'
       and transition_row.external_authority_detail #>>
         '{sourceThreadBinding,id}' =
           transition_row.source_thread_binding_id
       and transition_row.external_authority_detail #>>
         '{sourceThreadBinding,tenantId}' = head_row.tenant_id
       and transition_row.external_authority_detail #>>
         '{sourceThreadBinding,kind}' = 'source_thread_binding'
       and transition_row.external_authority_detail #>>
         '{bindingGeneration}' = transition_row.binding_generation::text
       and transition_row.adapter_contract_id =
         new.semantic_proof_detail #>> '{adapterContract,contractId}'
       and transition_row.adapter_contract_version =
         new.semantic_proof_detail #>> '{adapterContract,contractVersion}'
       and transition_row.capability_id =
         new.semantic_proof_detail #>> '{capabilityId}'
       and transition_row.capability_revision::text =
         new.semantic_proof_detail #>> '{capabilityRevision}'
       and transition_row.external_authority_detail -> 'adapterContract' =
         new.semantic_proof_detail -> 'adapterContract'
       and transition_row.external_authority_detail #>
         '{capabilityFence,adapterContract}' =
           new.semantic_proof_detail -> 'adapterContract'
       and transition_row.external_authority_detail #>>
         '{capabilityFence,capabilityId}' = transition_row.capability_id
       and transition_row.external_authority_detail #>>
         '{capabilityFence,capabilityRevision}' =
           transition_row.capability_revision::text
       and transition_row.external_authority_detail #>>
         '{capabilityFence,decision}' = 'supported'
       and isfinite((transition_row.external_authority_detail #>>
         '{capabilityFence,evaluatedAt}')::timestamptz)
       and isfinite((transition_row.external_authority_detail #>>
         '{capabilityFence,notAfter}')::timestamptz)
       and (transition_row.external_authority_detail #>>
         '{capabilityFence,evaluatedAt}')::timestamptz <=
           transition_row.occurred_at
       and (transition_row.external_authority_detail #>>
         '{capabilityFence,notAfter}')::timestamptz >=
           transition_row.occurred_at
       and (new.semantic_proof_detail #>>
         '{adapterContract,loadedAt}')::timestamptz <=
           transition_row.occurred_at
       and new.semantic_proof_detail #>> '{declaredByTrustedServiceId}' =
         new.semantic_proof_detail #>>
           '{adapterContract,loadedByTrustedServiceId}'
       and reaction_row.capability_kind = 'external'
       and reaction_row.capability_id = transition_row.capability_id
       and reaction_row.capability_revision = transition_row.capability_revision
       and reaction_row.adapter_contract_id = transition_row.adapter_contract_id
       and reaction_row.adapter_contract_version =
         transition_row.adapter_contract_version
       and reaction_row.capability_detail #>> '{kind}' = 'external'
       and reaction_row.capability_detail #>> '{capabilityId}' =
         transition_row.capability_id
       and reaction_row.capability_detail #>> '{capabilityRevision}' =
         transition_row.capability_revision::text
       and reaction_row.capability_detail #>> '{cardinality}' =
         reaction_row.cardinality::text
       and reaction_row.capability_detail -> 'adapterContract' =
         new.semantic_proof_detail -> 'adapterContract'
       and transition_row.external_authority_detail -> 'outboundRoute' =
         'null'::jsonb
       and attribution_row.source_occurrence_id = new.source_occurrence_id
       and attribution_row.conversation_id = reference_row.conversation_id
       and new.semantic_proof_detail #>> '{normalizedInboundEvent,id}' =
         new.normalized_inbound_event_id
       and new.semantic_proof_detail #>> '{sourceOccurrence,id}' =
         new.source_occurrence_id
       and new.semantic_proof_detail #>> '{semanticId}' = new.semantic_id
       and new.semantic_id =
         'core:message.reaction.' || transition_row.operation::text
       and new.semantic_proof_detail #>> '{revision}' = '1'
       and new.semantic_proof_detail #>> '{semanticRevision}' ~
         '^[1-9][0-9]*$'
       and char_length(new.semantic_proof_detail #>> '{semanticRevision}') <=
         19
       and (
         char_length(new.semantic_proof_detail #>> '{semanticRevision}') < 19
         or (new.semantic_proof_detail #>> '{semanticRevision}') collate "C" <=
           '9223372036854775807'
       )
       and new.semantic_proof_detail #>> '{ordering,position}' =
         new.ordering_position
       and head_row.semantic_family_id =
         new.ordering_commit_detail #>> '{semanticFamilyId}'
       and head_row.semantic_family_id = 'core:message.reaction'
       and new.ordering_commit_detail #>> '{tenantId}' = head_row.tenant_id
       and public.inbox_v2_tm_provider_semantic_proof_scope_valid(
         new.semantic_proof_detail,
         head_row.tenant_id
       )
       and head_row.source_account_id =
         new.semantic_proof_detail #>> '{sourceAccount,id}'
       and head_row.source_thread_binding_id =
         new.semantic_proof_detail #>> '{sourceThreadBinding,id}'
       and head_row.binding_generation::text =
         new.semantic_proof_detail #>> '{bindingGeneration}'
       and head_row.normalized_inbound_event_id =
         new.normalized_inbound_event_id
       and head_row.proof_token =
         new.semantic_proof_detail #>> '{proofToken}'
       and head_row.scope_token =
         new.semantic_proof_detail #>> '{ordering,scopeToken}'
       and head_row.position = new.ordering_position
       and head_row.comparator_id =
         new.semantic_proof_detail #>> '{ordering,comparatorId}'
       and head_row.comparator_revision::text =
         new.semantic_proof_detail #>> '{ordering,comparatorRevision}'
       and head_row.head_detail = new.ordering_commit_detail -> 'after'
       and new.ordering_commit_detail -> 'proof' = new.semantic_proof_detail
       and (new.ordering_commit_detail #>> '{committedAt}')::timestamptz =
         head_row.updated_at
       and (new.semantic_proof_detail #>> '{occurredAt}')::timestamptz =
         new.observed_at
       and (new.semantic_proof_detail #>> '{recordedAt}')::timestamptz =
         new.recorded_at
       and transition_row.occurred_at = new.observed_at
       and new.recorded_at <= transition_row.recorded_at
       and transition_row.recorded_at = head_row.updated_at
       and transition_row.after_state_kind = new.normalized_state_kind
       and transition_row.value_kind = new.normalized_value_kind
       and transition_row.unicode_value is not distinct from
         new.normalized_unicode_value
       and transition_row.provider_reaction_kind_id is not distinct from
         new.normalized_provider_reaction_kind_id
       and transition_row.provider_canonical_code is not distinct from
         new.normalized_provider_canonical_code
       and transition_row.after_state_detail #>> '{kind}' =
         transition_row.after_state_kind::text
       and transition_row.after_state_detail #>> (
         case when transition_row.after_state_kind = 'active'
           then array['value', 'kind']
           else array['lastValue', 'kind']
         end
       ) = transition_row.value_kind::text
       and (
         (
           transition_row.value_kind = 'unicode'
           and transition_row.after_state_detail #>> (
             case when transition_row.after_state_kind = 'active'
               then array['value', 'value']
               else array['lastValue', 'value']
             end
           ) = transition_row.unicode_value
           and transition_row.provider_reaction_kind_id is null
           and transition_row.provider_canonical_code is null
         )
         or (
           transition_row.value_kind = 'provider_custom'
           and transition_row.unicode_value is null
           and transition_row.after_state_detail #>> (
             case when transition_row.after_state_kind = 'active'
               then array['value', 'providerKindId']
               else array['lastValue', 'providerKindId']
             end
           ) = transition_row.provider_reaction_kind_id
           and transition_row.after_state_detail #>> (
             case when transition_row.after_state_kind = 'active'
               then array['value', 'canonicalCode']
               else array['lastValue', 'canonicalCode']
             end
           ) = transition_row.provider_canonical_code
         )
       )
       and (
         transition_row.after_state_kind = 'active'
         or (transition_row.after_state_detail #>>
           '{clearedAt}')::timestamptz = transition_row.recorded_at
       )
       and (
         (
           coalesce(
             transition_row.before_state_kind = 'pending_external'
             or (
               transition_row.before_state_kind = 'external_terminal'
               and transition_row.before_state_detail #>> '{outcome}' =
                 'outcome_unknown'
             ),
             false
           )
           and (
             new.semantic_proof_detail #>> '{actor,id}' is null
             or occurrence_actor_row.provider_actor_source_external_identity_id
               is null
             or new.semantic_proof_detail #>> '{actor,id}' =
               occurrence_actor_row.provider_actor_source_external_identity_id
           )
           and (
             (
               coalesce(
                 new.semantic_proof_detail #>> '{actor,id}',
                 occurrence_actor_row.provider_actor_source_external_identity_id
               ) is null
               and new.provider_actor_participant_id is null
               and attribution_row.action_participant_id is null
             )
             or (
               attribution_row.action_participant_id =
                 new.provider_actor_participant_id
               and exists (
                 select 1
                   from public.inbox_v2_conversation_participants participant_row
                  where participant_row.tenant_id = new.tenant_id
                    and participant_row.id =
                      new.provider_actor_participant_id
                    and participant_row.conversation_id =
                      reference_row.conversation_id
                    and participant_row.subject_kind =
                      'source_external_identity'
                    and participant_row.subject_source_external_identity_id =
                      coalesce(
                        new.semantic_proof_detail #>> '{actor,id}',
                        occurrence_actor_row.provider_actor_source_external_identity_id
                      )
               )
             )
           )
         )
         or (
           not coalesce(
             transition_row.before_state_kind = 'pending_external'
             or (
               transition_row.before_state_kind = 'external_terminal'
               and transition_row.before_state_detail #>> '{outcome}' =
                 'outcome_unknown'
             ),
             false
           )
           and (
             (
               occurrence_actor_row.provider_actor_kind =
                 'source_external_identity'
               and new.semantic_proof_detail #>> '{actor,id}' =
                 occurrence_actor_row.provider_actor_source_external_identity_id
               and attribution_row.action_participant_id =
                 new.provider_actor_participant_id
               and reaction_row.actor_kind = 'participant'
               and reaction_row.actor_participant_id =
                 new.provider_actor_participant_id
               and exists (
                 select 1
                   from public.inbox_v2_conversation_participants participant_row
                  where participant_row.tenant_id = new.tenant_id
                    and participant_row.id =
                      new.provider_actor_participant_id
                    and participant_row.conversation_id =
                      reference_row.conversation_id
                    and participant_row.subject_kind =
                      'source_external_identity'
                    and participant_row.subject_source_external_identity_id =
                      occurrence_actor_row.provider_actor_source_external_identity_id
               )
             )
             or (
               occurrence_actor_row.provider_actor_kind = 'provider_system'
               and new.semantic_proof_detail -> 'actor' = 'null'::jsonb
               and new.provider_actor_participant_id is null
               and attribution_row.action_participant_id is null
               and reaction_row.actor_kind = 'provider_system'
               and reaction_row.actor_source_occurrence_id =
                 occurrence_actor_row.id
               and reaction_row.provider_actor_kind_id =
                 occurrence_actor_row.provider_system_actor_kind_id
               and reaction_row.provider_actor_subject =
                 occurrence_actor_row.provider_system_actor_subject
             )
             or (
               occurrence_actor_row.provider_actor_kind is null
               and new.semantic_proof_detail -> 'actor' = 'null'::jsonb
               and new.provider_actor_participant_id is null
               and attribution_row.action_participant_id is null
               and reaction_row.actor_kind in (
                 'unattributed_source_observation', 'aggregate_only'
               )
               and reaction_row.actor_source_occurrence_id =
                 occurrence_actor_row.id
             )
           )
         )
       )
       and new.ordering_proof_digest_sha256 ~ '^[a-f0-9]{64}$'
       and new.semantic_proof_digest_sha256 ~ '^[a-f0-9]{64}$'
       and head_row.last_changed_stream_position =
         transition_row.recorded_stream_position
       and exists (
         select 1
           from public.inbox_v2_source_occurrences occurrence_row
          where occurrence_row.tenant_id = new.tenant_id
            and occurrence_row.id = new.source_occurrence_id
            and occurrence_row.normalized_inbound_event_id =
              new.normalized_inbound_event_id
            and occurrence_row.source_account_id = head_row.source_account_id
            and occurrence_row.source_thread_binding_id =
              head_row.source_thread_binding_id
            and occurrence_row.binding_generation =
              head_row.binding_generation
            and occurrence_row.adapter_contract_id =
              new.semantic_proof_detail #>> '{adapterContract,contractId}'
            and occurrence_row.adapter_contract_version =
              new.semantic_proof_detail #>> '{adapterContract,contractVersion}'
            and occurrence_row.adapter_declaration_revision::text =
              new.semantic_proof_detail #>>
                '{adapterContract,declarationRevision}'
            and occurrence_row.adapter_surface_id =
              new.semantic_proof_detail #>> '{adapterContract,surfaceId}'
            and occurrence_row.adapter_loaded_by_trusted_service_id =
              new.semantic_proof_detail #>>
                '{adapterContract,loadedByTrustedServiceId}'
            and occurrence_row.adapter_loaded_at =
              (new.semantic_proof_detail #>>
                '{adapterContract,loadedAt}')::timestamptz
            and occurrence_row.capability_revision::text =
              new.semantic_proof_detail #>> '{capabilityRevision}'
            and occurrence_row.resolution_state = 'resolved'
            and occurrence_row.resolved_external_message_reference_id =
              head_row.external_message_reference_id
       );
  else
    raise exception using errcode = '23514',
      message = 'inbox_v2.provider_semantic_ordering_consumer_table_invalid';
  end if;

  if matching_head_count <> 1 then
    raise exception using errcode = '23514',
      message = 'inbox_v2.provider_semantic_ordering_consumer_head_invalid';
  end if;
  select
    public.inbox_v2_tm_provider_semantic_consumer_count(
      head_row, consumer_before, true
    ),
    public.inbox_v2_tm_provider_semantic_consumer_count(
      head_row, 'null'::jsonb, false
    )
    into matching_consumer_count, matching_total_consumer_count
    from public.inbox_v2_provider_semantic_ordering_heads head_row
   where head_row.tenant_id = new.tenant_id
     and head_row.head_detail = consumer_after
     and head_row.last_changed_stream_position = consumer_stream_position;
  if coalesce(matching_consumer_count, 0) <> 1
     or coalesce(matching_total_consumer_count, 0) <> 1 then
    raise exception using errcode = '23514',
      message = 'inbox_v2.provider_semantic_ordering_consumer_count_invalid';
  end if;
  return new;
end;
$function$;

create trigger inbox_v2_tm_provider_semantic_head_guard
before insert or update or delete
on public.inbox_v2_provider_semantic_ordering_heads
for each row execute function public.inbox_v2_tm_provider_semantic_head_guard();

create trigger inbox_v2_tm_provider_semantic_json_guard
before insert or update on public.inbox_v2_provider_semantic_ordering_heads
for each row execute function public.inbox_v2_tm_json_guard();

create constraint trigger inbox_v2_tm_provider_semantic_head_consumer_constraint
after insert or update on public.inbox_v2_provider_semantic_ordering_heads
deferrable initially deferred
for each row execute function
  public.inbox_v2_tm_provider_semantic_head_consumer_guard();

create constraint trigger inbox_v2_tm_provider_semantic_lifecycle_consumer_constraint
after insert on public.inbox_v2_message_provider_lifecycle_operations
deferrable initially deferred
for each row execute function
  public.inbox_v2_tm_provider_semantic_consumer_head_guard();

create constraint trigger inbox_v2_tm_provider_semantic_reaction_consumer_constraint
after insert on public.inbox_v2_message_provider_reaction_observations
deferrable initially deferred
for each row execute function
  public.inbox_v2_tm_provider_semantic_consumer_head_guard();
`;
